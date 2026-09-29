"""
meetings.py

Routes related to meeting recordings.

Phase 2: POST /upload - accept and save an uploaded recording.
Phase 5: POST /{meeting_id}/transcribe - run FFmpeg + Whisper on an
         uploaded recording and save the transcript.
         GET /{meeting_id}/transcript - retrieve a saved transcript.
Phase 10.2: Store upload metadata and public_id in the database.
Phase 15: POST /{meeting_id}/transcribe and POST /{meeting_id}/generate-mom
          now spawn background threads and return immediately with
          {status: "processing"}.  The frontend polls GET /progress.
"""

from datetime import datetime
import concurrent.futures
import json
import math
import re
import threading
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import asc, desc, func, or_
from sqlalchemy.orm import Session, joinedload, selectinload
from app.core.config import (
    ALLOWED_EXTENSIONS,
    MAX_FILE_SIZE_BYTES,
    PROCESSED_DIR,
    UPLOAD_DIR,
)

from app.core.database import SessionLocal, get_db
from app.core.file_security import (
    safe_path,
    sanitize_filename,
    validate_magic_bytes,
)
from app.core.progress import (
    clear_progress,
    get_progress,
    is_running,
    mark_running,
    set_job_error,
    set_progress,
)
from app.core.rate_limiter import rate_limit
from app.models.meeting import Meeting, Transcript, MOM
from app.api.deps import get_current_user
from app.models.user import User

from app.schemas.mom import MOMResult
from app.services.audio_service import AudioProcessingError, convert_to_wav
from app.services.llm_service import LLMExtractionError
from app.services.transcription_service import apply_diarization, get_transcription_service
from app.services import document_service, email_service, mom_service, webhook_service


router = APIRouter(
    prefix="/api/meetings",
    tags=["meetings"],
)

# SEC-03: Bounded executor for CPU-heavy background jobs (Whisper transcription
# and LLM MOM generation). Limiting concurrent workers prevents unbounded thread
# spawning under load from exhausting CPU resources or crashing the host.
# Adjust MAX_WORKERS via env/config if you add more CPU cores.
_MAX_PIPELINE_WORKERS = 2
_pipeline_executor = concurrent.futures.ThreadPoolExecutor(
    max_workers=_MAX_PIPELINE_WORKERS,
    thread_name_prefix="kps-pipeline",
)


# Read uploaded files in 1 MB chunks.
CHUNK_SIZE = 1024 * 1024


def _get_user_meeting(db: Session, meeting_id: str, user_id: int) -> Optional[Meeting]:
    """Look up a meeting by public id, scoped to the owning user.

    Phase 12 (Authentication): authorization is enforced at every lookup so
    a user can never reach another user's meeting by guessing a UUID.
    Returns None (-> 404) when the meeting doesn't exist or belongs to
    someone else, so the two cases are indistinguishable to the caller.
    """
    return (
        db.query(Meeting)
        .filter(Meeting.public_id == meeting_id, Meeting.user_id == user_id)
        .first()
    )



# ============================================================
# UPLOAD
# ============================================================

@router.post(
    "/upload",
    dependencies=[Depends(rate_limit(max_requests=10, window_seconds=60))],
)
async def upload_meeting(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Upload a meeting recording with secure file validation.

    Flow:
        1. Sanitize filename and validate extension
        2. Read initial chunk & validate magic bytes BEFORE creating file on disk
        3. Stream remaining upload to safe destination path
        4. Validate size limits and non-empty content
        5. Create Meeting database record
        6. Return upload information
    """

    # 1. Sanitize filename and validate extension
    original_name = sanitize_filename(file.filename or "")
    extension = Path(original_name).suffix.lower()

    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unsupported file type '{extension or 'unknown'}'. "
                f"Allowed types: {', '.join(sorted(ALLOWED_EXTENSIONS))}"
            ),
        )

    # 2. Read first chunk to validate magic bytes and empty check before opening file
    first_chunk = await file.read(CHUNK_SIZE)
    if not first_chunk:
        raise HTTPException(
            status_code=400,
            detail="Uploaded file is empty.",
        )

    if not validate_magic_bytes(first_chunk[:32], extension):
        raise HTTPException(
            status_code=400,
            detail=(
                f"Invalid or corrupted file content. The uploaded file does not "
                f"match expected audio/video container headers for '{extension}'."
            ),
        )

    # 3. Generate public UUID & safe path (Phase 16 path traversal protection)
    meeting_id = str(uuid.uuid4())
    saved_filename = f"{meeting_id}{extension}"
    saved_path = safe_path(UPLOAD_DIR, saved_filename)

    size_bytes = len(first_chunk)
    if size_bytes > MAX_FILE_SIZE_BYTES:
        max_mb = MAX_FILE_SIZE_BYTES // (1024 * 1024)
        raise HTTPException(
            status_code=400,
            detail=f"File too large. Maximum allowed size is {max_mb} MB.",
        )

    # 4. Stream remainder of file to disk
    try:
        with open(saved_path, "wb") as out_file:
            out_file.write(first_chunk)
            while True:
                chunk = await file.read(CHUNK_SIZE)
                if not chunk:
                    break

                size_bytes += len(chunk)
                if size_bytes > MAX_FILE_SIZE_BYTES:
                    break

                out_file.write(chunk)

        if size_bytes > MAX_FILE_SIZE_BYTES:
            saved_path.unlink(missing_ok=True)
            max_mb = MAX_FILE_SIZE_BYTES // (1024 * 1024)
            raise HTTPException(
                status_code=400,
                detail=f"File too large. Maximum allowed size is {max_mb} MB.",
            )

    except HTTPException:
        saved_path.unlink(missing_ok=True)
        raise

    except Exception:
        saved_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=500,
            detail="Unable to save the uploaded file. Please try again.",
        )

    # 5. Create Meeting database record
    try:
        meeting = Meeting(
            public_id=meeting_id,
            title=Path(original_name).stem or "Untitled meeting",
            original_filename=original_name,
            saved_filename=saved_filename,
            status="uploaded",
            user_id=current_user.id,
        )

        db.add(meeting)
        db.commit()
        db.refresh(meeting)

    except Exception:
        db.rollback()
        saved_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=500,
            detail="Unable to create the meeting record.",
        )

    # 6. Return upload information
    return {
        "meeting_id": meeting_id,
        "original_filename": original_name,
        "saved_filename": saved_filename,
        "size_bytes": size_bytes,
        "status": "uploaded",
    }



# ============================================================
# FILE HELPERS
# ============================================================

def _find_uploaded_file(meeting_id: str) -> Optional[Path]:
    """
    Find the uploaded recording using its public meeting ID safely.
    """
    # Sanitize meeting_id to alphanumeric/hyphen only (UUID pattern)
    safe_id = re.sub(r"[^a-zA-Z0-9\-]", "", meeting_id)
    if not safe_id:
        return None

    matches = list(UPLOAD_DIR.glob(f"{safe_id}.*"))
    if not matches:
        return None

    try:
        return safe_path(UPLOAD_DIR, matches[0].name)
    except ValueError:
        return None


def _transcript_path(meeting_id: str) -> Path:
    """
    Return the path where the transcript JSON is stored safely.
    """
    safe_id = re.sub(r"[^a-zA-Z0-9\-]", "", meeting_id)
    return safe_path(PROCESSED_DIR, f"{safe_id}_transcript.json")



# ============================================================
# TRANSCRIPTION
# ============================================================
# ---------------------------------------------------------------------------
# TRANSCRIPTION BACKGROUND WORKER (Phase 15)
# ---------------------------------------------------------------------------

def _run_transcribe(
    meeting_id: str,
    internal_meeting_id: int,
    input_path: Path,
    language: Optional[str],
    diarize: bool,
) -> None:
    """
    Background worker that runs the full transcription pipeline.

    This function runs in a daemon thread (spawned by transcribe_meeting
    below).  It opens its own DB session, drives the existing FFmpeg +
    Whisper + diarization pipeline, updates meeting.status, and writes the
    Transcript row — exactly the same work that was previously done
    synchronously inside the request-response cycle.

    Errors surface via set_job_error() so the frontend can display them on
    the next progress poll, and via meeting.status = "transcription_failed"
    so the dashboard reflects the correct end state.
    """
    db = SessionLocal()
    try:
        meeting = db.query(Meeting).filter(Meeting.id == internal_meeting_id).first()
        if meeting is None:
            set_job_error(meeting_id, "Meeting record not found by background worker.")
            return

        # ---- 1. Convert audio to WAV ----
        set_progress(meeting_id, "converting", "Converting audio…")
        try:
            wav_path = convert_to_wav(meeting_id, input_path)
        except AudioProcessingError as exc:
            meeting.status = "transcription_failed"
            db.commit()
            set_job_error(meeting_id, str(exc))
            return

        # ---- 2. Whisper transcription ----
        service = get_transcription_service()

        def _on_progress(current: int, total: int) -> None:
            msg = (
                "Transcribing…"
                if total <= 1
                else f"Transcribing chunk {current} of {total}…"
            )
            set_progress(meeting_id, "transcribing", msg, current, total)

        set_progress(meeting_id, "transcribing", "Starting transcription…")
        try:
            result = service.transcribe(
                wav_path,
                language=language,
                progress_callback=_on_progress,
            )
        except Exception as exc:
            meeting.status = "transcription_failed"
            db.commit()
            set_job_error(
                meeting_id,
                "Unable to process this recording. "
                "Please verify that the audio contains clear speech and try again.",
            )
            return

        # ---- 3. Optional speaker diarization (Phase 14) ----
        if diarize:
            set_progress(meeting_id, "diarizing", "Identifying speakers…")
            result = apply_diarization(result, wav_path)

        # ---- 4. Validate transcript text ----
        transcript_text = result.get("text", "")
        if not transcript_text.strip():
            meeting.status = "transcription_failed"
            db.commit()
            set_job_error(meeting_id, "Transcription produced empty text.")
            return

        # ---- 5. Persist transcript to database ----
        has_diarization = bool(result.get("has_diarization", False))
        segments_json_str = json.dumps(result.get("segments", []), ensure_ascii=False)

        existing_transcript = (
            db.query(Transcript)
            .filter(Transcript.meeting_id == internal_meeting_id)
            .first()
        )
        if existing_transcript:
            existing_transcript.content = transcript_text
            existing_transcript.segments_json = segments_json_str
            existing_transcript.has_diarization = has_diarization
        else:
            db.add(Transcript(
                meeting_id=internal_meeting_id,
                content=transcript_text,
                segments_json=segments_json_str,
                has_diarization=has_diarization,
            ))

        # ---- 6. Update meeting status ----
        meeting.status = "transcribed"
        db.commit()

        # ---- 7. Keep legacy JSON file for backward compatibility ----
        _transcript_path(meeting_id).write_text(
            json.dumps(result, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    except Exception as exc:
        try:
            db.rollback()
            meeting = db.query(Meeting).filter(Meeting.id == internal_meeting_id).first()
            if meeting:
                meeting.status = "transcription_failed"
                db.commit()
        except Exception:
            pass
        set_job_error(meeting_id, "An unexpected error occurred during transcription.")
    finally:
        clear_progress(meeting_id)
        db.close()


@router.post(
    "/{meeting_id}/transcribe",
    dependencies=[Depends(rate_limit(max_requests=10, window_seconds=60))],
)
def transcribe_meeting(
    meeting_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    language: Optional[str] = None,
    diarize: bool = False,
):
    """
    Kick off transcription for an uploaded meeting.

    Phase 15 (Background Processing): the transcription pipeline now runs
    in a background thread so this endpoint returns immediately.  The
    frontend should poll GET /{meeting_id}/progress for live status and
    GET /{meeting_id}/transcript once meeting.status == "transcribed".
    """
    try:
        # 1. Verify ownership.
        meeting = _get_user_meeting(db, meeting_id, current_user.id)
        if meeting is None:
            raise HTTPException(status_code=404, detail="Meeting not found.")

        # 2. Locate uploaded audio.
        input_path = _find_uploaded_file(meeting_id)
        if input_path is None:
            raise HTTPException(
                status_code=404, detail="Uploaded audio file not found."
            )

        # 3. Guard against duplicate jobs.
        if not mark_running(meeting_id):
            raise HTTPException(
                status_code=409,
                detail="Transcription is already in progress for this meeting.",
            )

        # 4. Capture internal id before closing the session.
        internal_id = meeting.id

        # 5. Set status synchronously so the dashboard is immediately correct.
        meeting.status = "transcribing"
        db.commit()

    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            status_code=500, detail="Unable to start transcription."
        )

    # 6. Submit to the bounded pipeline executor.
    # If all worker slots are taken, BrokenExecutor is not raised here — the
    # Future simply queues. However we enforce a backpressure limit by
    # checking _running count before accepting the job (mark_running guard
    # above already prevents duplicates for the same meeting).
    try:
        _pipeline_executor.submit(
            _run_transcribe,
            meeting_id, internal_id, input_path, language, diarize,
        )
    except RuntimeError:
        # Executor was shut down (only happens during server shutdown).
        clear_progress(meeting_id)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Server is shutting down. Please retry in a moment.",
        )

    return {"status": "processing", "meeting_id": meeting_id}


# ============================================================
# GET PROGRESS
# ============================================================

@router.get("/{meeting_id}/progress")
def get_progress_endpoint(
    meeting_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Retrieve real-time pipeline progress for a meeting (Phase 11).
    """
    meeting = _get_user_meeting(db, meeting_id, current_user.id)
    if meeting is None:
        raise HTTPException(
            status_code=404,
            detail="Meeting not found.",
        )

    progress = get_progress(meeting_id)
    if progress is None:
        raise HTTPException(
            status_code=404,
            detail="No progress is currently available for this meeting.",
        )
    return progress


# ============================================================
# GET TRANSCRIPT
# ============================================================

@router.get("/{meeting_id}/transcript")
def get_transcript(
    meeting_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Retrieve the transcript for a meeting from the database.
    """
    meeting = _get_user_meeting(db, meeting_id, current_user.id)
    if meeting is None:
        raise HTTPException(
            status_code=404,
            detail="Meeting not found.",
        )

    transcript = (
        db.query(Transcript)
        .filter(Transcript.meeting_id == meeting.id)
        .first()
    )

    if transcript is None:
        raise HTTPException(
            status_code=404,
            detail="No transcript found for this meeting. Run /transcribe first.",
        )

    segments = []
    if transcript.segments_json:
        try:
            segments = json.loads(transcript.segments_json)
        except (ValueError, TypeError):
            segments = []

    return {
        "meeting_id": meeting.public_id,
        "transcript_id": transcript.id,
        "text": transcript.content,
        "status": meeting.status,
        "created_at": transcript.created_at,
        "segments": segments,
        "has_diarization": bool(transcript.has_diarization) if transcript.has_diarization is not None else False,
    }


# ============================================================
# GENERATE MOM
# ============================================================

# ---------------------------------------------------------------------------
# MOM GENERATION BACKGROUND WORKER (Phase 15)
# ---------------------------------------------------------------------------

def _run_generate_mom(
    meeting_id: str,
    internal_meeting_id: int,
    transcript_text: str,
) -> None:
    """
    Background worker that runs LLM extraction and saves the MOM.

    This function runs in a daemon thread (spawned by generate_mom_endpoint
    below).  It opens its own DB session and calls the same mom_service
    pipeline that was previously synchronous, then updates meeting.status.

    Errors surface via set_job_error() and meeting.status = "mom_generation_failed".
    """
    db = SessionLocal()
    try:
        meeting = db.query(Meeting).filter(Meeting.id == internal_meeting_id).first()
        if meeting is None:
            set_job_error(meeting_id, "Meeting record not found by background worker.")
            return

        set_progress(meeting_id, "generating_mom", "Generating minutes of meeting\u2026")

        try:
            mom_service.generate_mom(db, internal_meeting_id, transcript_text)
        except LLMExtractionError as exc:
            meeting.status = "mom_generation_failed"
            db.commit()
            set_job_error(meeting_id, str(exc))
            return
        except Exception as exc:
            try:
                db.rollback()
                meeting = db.query(Meeting).filter(Meeting.id == internal_meeting_id).first()
                if meeting:
                    meeting.status = "mom_generation_failed"
                    db.commit()
            except Exception:
                pass
            set_job_error(meeting_id, "Unable to generate minutes for this meeting.")
            return

        # Reload meeting after generate_mom committed
        meeting = db.query(Meeting).filter(Meeting.id == internal_meeting_id).first()
        if meeting:
            meeting.status = "mom_generated"
            db.commit()

    except Exception:
        try:
            db.rollback()
            meeting = db.query(Meeting).filter(Meeting.id == internal_meeting_id).first()
            if meeting:
                meeting.status = "mom_generation_failed"
                db.commit()
        except Exception:
            pass
        set_job_error(meeting_id, "An unexpected error occurred during MOM generation.")
    finally:
        clear_progress(meeting_id)
        db.close()


@router.post(
    "/{meeting_id}/generate-mom",
    dependencies=[Depends(rate_limit(max_requests=10, window_seconds=60))],
)
def generate_mom_endpoint(
    meeting_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Kick off MOM generation from the transcript stored in the database.
    """
    try:
        # 1. Verify ownership.
        meeting = _get_user_meeting(db, meeting_id, current_user.id)
        if meeting is None:
            raise HTTPException(status_code=404, detail="Meeting not found.")

        # 2. Load and validate transcript.
        transcript = (
            db.query(Transcript)
            .filter(Transcript.meeting_id == meeting.id)
            .first()
        )
        if transcript is None:
            raise HTTPException(
                status_code=404,
                detail="No transcript found for this meeting. Run /transcribe first.",
            )
        transcript_text = transcript.content
        if not transcript_text or not transcript_text.strip():
            raise HTTPException(status_code=400, detail="Transcript is empty.")

        # 3. Guard against duplicate jobs.
        if not mark_running(meeting_id):
            raise HTTPException(
                status_code=409,
                detail="MOM generation is already in progress for this meeting.",
            )

        # 4. Capture internal id before closing the session.
        internal_id = meeting.id

        # 5. Set status synchronously.
        meeting.status = "generating_mom"
        db.commit()

    except HTTPException:
        raise
    except Exception:
        raise HTTPException(
            status_code=500, detail="Unable to start MOM generation."
        )

    # 6. Submit MOM generation to the bounded pipeline executor.
    try:
        _pipeline_executor.submit(
            _run_generate_mom,
            meeting_id, internal_id, transcript_text,
        )
    except RuntimeError:
        clear_progress(meeting_id)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Server is shutting down. Please retry in a moment.",
        )

    return {"status": "processing", "meeting_id": meeting_id}


# ============================================================
# GET MOM
# ============================================================

@router.get("/{meeting_id}/mom")
def get_mom_endpoint(
    meeting_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Retrieve a generated or edited MOM.
    """
    meeting = _get_user_meeting(db, meeting_id, current_user.id)
    if meeting is None:
        raise HTTPException(status_code=404, detail="Meeting not found.")

    mom = mom_service.get_mom(db, meeting.id)
    if mom is None:
        raise HTTPException(
            status_code=404,
            detail="No MOM found for this meeting. Run /generate-mom first.",
        )
    return mom.model_dump()


# ============================================================
# UPDATE MOM
# ============================================================

class ActionItemStatusUpdate(BaseModel):
    status: str


@router.put("/{meeting_id}/mom")
def update_mom_endpoint(
    meeting_id: str,
    updated_mom: MOMResult,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Save user edits to a MOM permanently in the database.
    """
    meeting = _get_user_meeting(db, meeting_id, current_user.id)
    if meeting is None:
        raise HTTPException(status_code=404, detail="Meeting not found.")
    if mom_service.get_mom(db, meeting.id) is None:
        raise HTTPException(
            status_code=404,
            detail="No MOM found for this meeting. Run /generate-mom first.",
        )

    mom_service.save_mom(db, meeting.id, updated_mom)
    meeting.status = "mom_generated"
    if updated_mom.meeting_title and updated_mom.meeting_title.strip():
        meeting.title = updated_mom.meeting_title.strip()
    meeting.updated_at = datetime.utcnow()
    db.commit()
    return updated_mom.model_dump()


@router.patch("/{meeting_id}/action-items/{item_index}")
def update_action_item_status_endpoint(
    meeting_id: str,
    item_index: int,
    payload: ActionItemStatusUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Persist action item status changes directly to the database.
    """
    meeting = _get_user_meeting(db, meeting_id, current_user.id)
    if meeting is None:
        raise HTTPException(status_code=404, detail="Meeting not found.")

    mom_row = db.query(MOM).filter(MOM.meeting_id == meeting.id).first()
    if mom_row is None:
        raise HTTPException(status_code=404, detail="No MOM found for this meeting.")

    action_items = mom_row.action_items
    if item_index < 0 or item_index >= len(action_items):
        raise HTTPException(status_code=404, detail="Action item index out of range.")

    target_item = action_items[item_index]
    target_item.status = payload.status
    meeting.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(target_item)
    return {
        "meeting_id": meeting_id,
        "item_index": item_index,
        "status": target_item.status,
    }


# ============================================================
# SEND MOM VIA EMAIL TO TEAM MEMBERS
# ============================================================

class SendMomEmailRequest(BaseModel):
    recipients: list[str]
    custom_note: Optional[str] = None
    include_pdf: bool = True


@router.post("/{meeting_id}/send-mom")
def send_mom_to_team(
    meeting_id: str,
    payload: SendMomEmailRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Send generated Minutes of Meeting to team members on their email addresses.
    """
    meeting = _get_user_meeting(db, meeting_id, current_user.id)
    if meeting is None:
        raise HTTPException(status_code=404, detail="Meeting not found.")

    mom = mom_service.get_mom(db, meeting.id)
    if mom is None:
        raise HTTPException(
            status_code=400,
            detail="No MOM found for this meeting. Please generate a MOM first.",
        )

    pdf_bytes = None
    if payload.include_pdf:
        try:
            pdf_bytes = document_service.generate_pdf(mom)
        except Exception as exc:
            logger.warning("Could not generate PDF attachment for email: %s", exc)
            pdf_bytes = None

    sender_name = current_user.username or "Meeting Host"

    try:
        result = email_service.send_mom_email(
            recipients=payload.recipients,
            mom=mom,
            sender_name=sender_name,
            custom_note=payload.custom_note,
            pdf_bytes=pdf_bytes,
        )
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Unable to send email: {str(exc)}",
        )


class TestSlackWebhookRequest(BaseModel):
    webhook_url: str


@router.post("/slack/test")
def test_slack_webhook_endpoint(
    payload: TestSlackWebhookRequest,
    current_user: User = Depends(get_current_user),
):
    """
    Test and verify a Slack Incoming Webhook URL.
    """
    try:
        return webhook_service.test_slack_webhook(payload.webhook_url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to ping Slack: {str(exc)}",
        )


class SendSlackMomRequest(BaseModel):
    webhook_url: str
    custom_note: Optional[str] = None


@router.post("/{meeting_id}/send-slack")
def send_mom_to_slack(
    meeting_id: str,
    payload: SendSlackMomRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Post generated Minutes of Meeting to a connected Slack channel via webhook.
    """
    meeting = _get_user_meeting(db, meeting_id, current_user.id)
    if meeting is None:
        raise HTTPException(status_code=404, detail="Meeting not found.")

    mom = mom_service.get_mom(db, meeting.id)
    if mom is None:
        raise HTTPException(
            status_code=400,
            detail="No MOM found for this meeting. Please generate a MOM first.",
        )

    sender_name = current_user.username or "Meeting Host"

    try:
        result = webhook_service.send_slack_mom(
            webhook_url=payload.webhook_url,
            mom=mom,
            sender_name=sender_name,
            custom_note=payload.custom_note,
        )
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Unable to send to Slack: {str(exc)}",
        )


# ============================================================
# EXPORT PDF
# ============================================================

@router.get("/{meeting_id}/export/pdf")
def export_mom_pdf(
    meeting_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Download MOM as PDF.
    """
    meeting = _get_user_meeting(db, meeting_id, current_user.id)
    if meeting is None:
        raise HTTPException(status_code=404, detail="Meeting not found.")
    mom = mom_service.get_mom(db, meeting.id)
    if mom is None:
        raise HTTPException(status_code=404, detail="No MOM found for this meeting. Generate one first.")
    pdf_bytes = document_service.generate_pdf(mom)

    filename = f"MOM_{meeting_id}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"'
        },
    )


# ============================================================
# EXPORT DOCX
# ============================================================

@router.get("/{meeting_id}/export/docx")
def export_mom_docx(
    meeting_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Download MOM as DOCX.
    """
    meeting = _get_user_meeting(db, meeting_id, current_user.id)
    if meeting is None:
        raise HTTPException(status_code=404, detail="Meeting not found.")
    mom = mom_service.get_mom(db, meeting.id)
    if mom is None:
        raise HTTPException(status_code=404, detail="No MOM found for this meeting. Generate one first.")
    docx_bytes = document_service.generate_docx(mom)

    filename = f"MOM_{meeting_id}.docx"
    return Response(
        content=docx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"'
        },
    )


# ============================================================
# DASHBOARD / HISTORY (Phase 13)
# ============================================================

COMPLETED_STATUSES = {"mom_generated"}
FAILED_STATUSES = {"transcription_failed", "mom_generation_failed"}


def _meeting_to_dict(meeting: Meeting) -> dict:
    """Serialize a Meeting row for the dashboard, with lightweight children."""
    mom = meeting.mom
    return {
        "meeting_id": meeting.public_id,
        "title": meeting.title,
        "original_filename": meeting.original_filename,
        "status": meeting.status,
        "created_at": meeting.created_at.isoformat() if meeting.created_at else None,
        "updated_at": meeting.updated_at.isoformat() if meeting.updated_at else None,
        "has_transcript": meeting.transcript is not None,
        "has_mom": mom is not None,
        "action_items": len(mom.action_items) if mom is not None else 0,
        "summary": mom.summary if mom is not None else None,
    }


@router.get("")
def list_meetings(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    q: Optional[str] = None,
    status: Optional[str] = None,
    sort: str = "updated_at",
    order: str = "desc",
    page: int = 1,
    page_size: int = 10,
):
    """
    Phase 13: dashboard + history for the current user.
    """
    owned = Meeting.user_id == current_user.id

    # ---- Stats (across ALL of the user's meetings, unfiltered) ----
    base = db.query(Meeting).filter(owned)
    total = base.count()
    completed = base.filter(Meeting.status.in_(COMPLETED_STATUSES)).count()
    failed = base.filter(Meeting.status.in_(FAILED_STATUSES)).count()
    in_progress = total - completed - failed

    # ---- Recent meetings (5 most recently updated, unfiltered) ----
    recent = (
        db.query(Meeting)
        .filter(owned)
        .order_by(Meeting.updated_at.desc())
        .limit(5)
        .options(
            joinedload(Meeting.transcript),
            joinedload(Meeting.mom).selectinload(MOM.action_items),
        )
        .all()
    )

    # ---- Filtered, sorted, paginated list ----
    query = db.query(Meeting).filter(owned)

    if q:
        like = f"%{q}%"
        query = query.filter(
            or_(Meeting.title.like(like), Meeting.original_filename.like(like))
        )

    if status:
        if status == "completed":
            query = query.filter(Meeting.status.in_(COMPLETED_STATUSES))
        elif status == "failed":
            query = query.filter(Meeting.status.in_(FAILED_STATUSES))
        elif status == "in_progress":
            query = query.filter(
                ~Meeting.status.in_(COMPLETED_STATUSES | FAILED_STATUSES)
            )
        else:
            query = query.filter(Meeting.status == status)

    total_filtered = query.count()

    col = {
        "created_at": Meeting.created_at,
        "title": Meeting.title,
        "updated_at": Meeting.updated_at,
    }.get(sort, Meeting.updated_at)
    query = query.order_by(col.asc() if order == "asc" else col.desc())

    page_size = min(max(page_size, 1), 50)
    page = max(page, 1)
    items = (
        query.offset((page - 1) * page_size)
        .limit(page_size)
        .options(
            joinedload(Meeting.transcript),
            joinedload(Meeting.mom).selectinload(MOM.action_items),
        )
        .all()
    )

    return {
        "items": [_meeting_to_dict(m) for m in items],
        "total": total_filtered,
        "page": page,
        "page_size": page_size,
        "pages": max(1, math.ceil(total_filtered / page_size)) if total_filtered else 0,
        "stats": {
            "total": total,
            "completed": completed,
            "failed": failed,
            "in_progress": in_progress,
        },
        "recent": [_meeting_to_dict(m) for m in recent],
    }


@router.get("/{meeting_id}")
def get_meeting_detail(
    meeting_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Phase 13: meeting details / summary for a single meeting.
    """
    meeting = (
        db.query(Meeting)
        .filter(
            Meeting.public_id == meeting_id,
            Meeting.user_id == current_user.id,
        )
        .options(
            joinedload(Meeting.transcript),
            joinedload(Meeting.mom).selectinload(MOM.action_items),
        )
        .first()
    )
    if meeting is None:
        raise HTTPException(status_code=404, detail="Meeting not found.")
    return _meeting_to_dict(meeting)


@router.delete("/{meeting_id}")
def delete_meeting(
    meeting_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Phase 13: delete a meeting and everything attached to it.
    """
    meeting = _get_user_meeting(db, meeting_id, current_user.id)
    if meeting is None:
        raise HTTPException(status_code=404, detail="Meeting not found.")

    input_path = _find_uploaded_file(meeting_id)
    if input_path is not None:
        try:
            input_path.unlink()
        except OSError:
            pass

    wav_path = PROCESSED_DIR / f"{meeting_id}.wav"
    try:
        wav_path.unlink(missing_ok=True)
    except OSError:
        pass

    transcript_json = _transcript_path(meeting_id)
    try:
        transcript_json.unlink(missing_ok=True)
    except OSError:
        pass

    db.delete(meeting)
    db.commit()

    return {"deleted": True, "meeting_id": meeting_id}


class RenameMeetingRequest(BaseModel):
    title: str


@router.patch("/{meeting_id}")
def rename_meeting(
    meeting_id: str,
    payload: RenameMeetingRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Rename a meeting title.
    """
    meeting = (
        db.query(Meeting)
        .filter(
            Meeting.public_id == meeting_id,
            Meeting.user_id == current_user.id,
        )
        .options(
            joinedload(Meeting.transcript),
            joinedload(Meeting.mom).selectinload(MOM.action_items),
        )
        .first()
    )
    if meeting is None:
        raise HTTPException(status_code=404, detail="Meeting not found.")

    new_title = payload.title.strip()
    if not new_title:
        raise HTTPException(status_code=400, detail="Meeting title cannot be empty.")

    meeting.title = new_title

    # Keep MOM title synchronized if present
    if meeting.mom:
        meeting.mom.meeting_title = new_title

    db.commit()
    db.refresh(meeting)

    return _meeting_to_dict(meeting)



