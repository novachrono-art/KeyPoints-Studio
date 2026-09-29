"""
meeting_service.py

Database-backed persistence for Meeting and Transcript records.

Phase 9 Part 1 built the database layer (models + migrations) and
verified it standalone. This module is Phase 9 Part 2: the API
routes now call these functions to create/read Meeting and
Transcript rows, replacing the JSON-file-based storage used in
Phases 2-8 (storage/processed/{id}_transcript.json is no longer
written). Raw audio files (storage/uploads/, storage/processed/*.wav)
still live on disk as before - only structured metadata moved to the
database.

MOM/ActionItem persistence lives in mom_service.py, updated the same
way in this same phase.
"""

from typing import Optional

from sqlalchemy.orm import Session

from app.models.meeting import Meeting, Transcript


def create_meeting(db: Session, meeting_id: str, original_filename: str, saved_filename: str) -> Meeting:
    """Create a new Meeting row right after a file is uploaded."""
    meeting = Meeting(
        id=meeting_id,
        original_filename=original_filename,
        saved_filename=saved_filename,
        status="uploaded",
    )
    db.add(meeting)
    db.commit()
    db.refresh(meeting)
    return meeting


def get_meeting(db: Session, meeting_id: str) -> Optional[Meeting]:
    return db.query(Meeting).filter(Meeting.id == meeting_id).first()


def update_meeting_status(db: Session, meeting_id: str, status: str) -> None:
    db.query(Meeting).filter(Meeting.id == meeting_id).update({"status": status})
    db.commit()


def save_transcript(db: Session, meeting_id: str, transcript_result: dict) -> Transcript:
    """
    Create or replace the Transcript row for a meeting.

    A meeting has at most one transcript (unique constraint on
    meeting_id) - running /transcribe again overwrites the previous
    result rather than accumulating duplicates, matching the old
    JSON-file behavior (which also just overwrote the file).
    """
    existing = db.query(Transcript).filter(Transcript.meeting_id == meeting_id).first()

    if existing:
        existing.text = transcript_result["text"]
        existing.segments = transcript_result["segments"]
        existing.detected_language = transcript_result["detected_language"]
        existing.language_confidence = transcript_result["language_confidence"]
        db.commit()
        db.refresh(existing)
        return existing

    row = Transcript(
        meeting_id=meeting_id,
        text=transcript_result["text"],
        segments=transcript_result["segments"],
        detected_language=transcript_result["detected_language"],
        language_confidence=transcript_result["language_confidence"],
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def get_transcript(db: Session, meeting_id: str) -> Optional[Transcript]:
    return db.query(Transcript).filter(Transcript.meeting_id == meeting_id).first()


def transcript_to_dict(transcript: Transcript) -> dict:
    """
    Convert a Transcript ORM row into the same dict shape the API has
    always returned (text/segments/detected_language/
    language_confidence) - so the response format is identical for
    the frontend even though the storage mechanism underneath changed.
    """
    return {
        "text": transcript.text,
        "segments": transcript.segments,
        "detected_language": transcript.detected_language,
        "language_confidence": transcript.language_confidence,
    }