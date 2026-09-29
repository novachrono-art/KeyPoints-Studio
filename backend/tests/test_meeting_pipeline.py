"""
test_meeting_pipeline.py

Automated tests for Meeting Upload, Pipeline, MOM Generation, Persistence, Export, and Dashboard.
"""

import io
import json
import pytest
from app.models.meeting import Meeting, Transcript, MOM, ActionItem as ActionItemModel
from app.schemas.mom import MOMResult, ActionItem as ActionItemSchema
from app.services import document_service, mom_service



def _create_synthetic_wav_bytes() -> bytes:
    """Create minimal valid 44-byte PCM WAV header + silence data."""
    # 44-byte standard RIFF WAVE header
    header = bytearray(b"RIFF\x24\x08\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00\x80>\x00\x00\x00}\x00\x00\x02\x00\x10\x00data\x00\x08\x00\x00")
    data = b"\x00" * 2048
    return bytes(header + data)


def test_upload_valid_wav_file(client, auth_headers):
    """Upload a valid WAV audio file and verify meeting record creation."""
    wav_content = _create_synthetic_wav_bytes()
    files = {"file": ("team_standup.wav", io.BytesIO(wav_content), "audio/wav")}

    res = client.post("/api/meetings/upload", files=files, headers=auth_headers)
    assert res.status_code == 200
    data = res.json()
    assert "meeting_id" in data
    assert data["status"] == "uploaded"
    assert data["original_filename"] == "team_standup.wav"


def test_upload_invalid_extension_and_spoofed_content(client, auth_headers):
    """Verify rejection of invalid extensions and mismatched container signatures."""
    # Invalid extension
    bad_ext_files = {"file": ("notes.txt", io.BytesIO(b"meeting notes"), "text/plain")}
    res_bad_ext = client.post("/api/meetings/upload", files=bad_ext_files, headers=auth_headers)
    assert res_bad_ext.status_code == 400

    # Spoofed magic bytes (plain text named as .mp3)
    spoofed_files = {"file": ("malicious.mp3", io.BytesIO(b"not an mp3 file"), "audio/mp3")}
    res_spoofed = client.post("/api/meetings/upload", files=spoofed_files, headers=auth_headers)
    assert res_spoofed.status_code == 400
    assert "Invalid or corrupted file content" in res_spoofed.json()["detail"]


def test_mom_service_persistence_and_action_items(db_session, test_user):
    """Direct service test for MOM saving, JSON serialization, and ActionItems."""
    # Create test meeting row
    meeting = Meeting(
        public_id="test-mom-uuid-1",
        title="Engineering Sync",
        original_filename="engineering_sync.wav",
        saved_filename="test-mom-uuid-1.wav",
        status="transcribed",
        user_id=test_user.id,
    )
    db_session.add(meeting)
    db_session.commit()
    db_session.refresh(meeting)

    # Save MOM via mom_service
    mom_data = MOMResult(
        meeting_title="Sprint 12 Review",
        meeting_date="2026-08-24",
        summary="Reviewed Phase 15-17 deliverable milestones.",
        participants=["Alice", "Bob", "Charlie"],
        discussion_points=["Whisper optimization", "Background workers"],
        decisions=["Enable background processing by default"],
        action_items=[
            ActionItemSchema(
                task="Write automated test suite",
                assignee="Alice",
                deadline="2026-08-25",
                status="in_progress",
                priority="high",
            ),
            ActionItemSchema(
                task="Benchmark long audio processing",
                assignee="Bob",
                deadline="2026-08-26",
                status="pending",
                priority="medium",
            ),
        ],
        pending_issues=["PostgreSQL migration timeline"],
    )

    mom_service.save_mom(db_session, meeting.id, mom_data)

    # Retrieve and verify through service
    retrieved = mom_service.get_mom(db_session, meeting.id)
    assert retrieved is not None
    assert retrieved.meeting_title == "Sprint 12 Review"
    assert len(retrieved.participants) == 3
    assert len(retrieved.action_items) == 2
    assert retrieved.action_items[0].priority == "high"
    assert retrieved.action_items[0].status == "in_progress"

    # Verify ActionItem database rows
    action_item_rows = db_session.query(ActionItemModel).all()
    assert len(action_item_rows) == 2
    assert action_item_rows[0].task == "Write automated test suite"



def test_document_exports_pdf_and_docx():
    """Verify ReportLab PDF and python-docx document generation."""
    sample_mom = MOMResult(
        meeting_title="Architecture Review",
        meeting_date="2026-08-24",
        summary="Discussed system scalability and production security.",
        participants=["Lead Architect", "Backend Lead"],
        discussion_points=["Rate limiting", "Threaded background workers"],
        decisions=["Adopt sliding window limiter"],
        action_items=[
            ActionItemSchema(
                task="Apply rate limiter middleware",
                assignee="Backend Lead",
                deadline="Tomorrow",
                status="done",
                priority="high",
            )
        ],
        pending_issues=[],
    )

    pdf_bytes = document_service.generate_pdf(sample_mom)
    assert isinstance(pdf_bytes, bytes)
    assert len(pdf_bytes) > 500
    assert pdf_bytes.startswith(b"%PDF")

    docx_bytes = document_service.generate_docx(sample_mom)
    assert isinstance(docx_bytes, bytes)
    assert len(docx_bytes) > 500
    # DOCX is a zip file (magic bytes PK\x03\x04)
    assert docx_bytes.startswith(b"PK\x03\x04")


def test_dashboard_filtering_and_sorting(client, auth_headers, db_session, test_user):
    """Verify dashboard pagination, filtering by status, and search."""
    # Seed 3 meetings with different statuses
    m1 = Meeting(public_id="dash-1", title="Alpha Standup", original_filename="alpha.wav", status="mom_generated", user_id=test_user.id)
    m2 = Meeting(public_id="dash-2", title="Beta Planning", original_filename="beta.wav", status="transcribed", user_id=test_user.id)
    m3 = Meeting(public_id="dash-3", title="Gamma Retro", original_filename="gamma.wav", status="transcription_failed", user_id=test_user.id)
    db_session.add_all([m1, m2, m3])
    db_session.commit()

    # List all
    res_all = client.get("/api/meetings", headers=auth_headers)
    assert res_all.status_code == 200
    data = res_all.json()
    assert data["total"] == 3
    assert data["stats"]["completed"] == 1
    assert data["stats"]["failed"] == 1

    # Search filter by title 'Alpha'
    res_search = client.get("/api/meetings?q=Alpha", headers=auth_headers)
    assert res_search.status_code == 200
    assert res_search.json()["total"] == 1
    assert res_search.json()["items"][0]["title"] == "Alpha Standup"

    # Status filter 'completed'
    res_completed = client.get("/api/meetings?status=completed", headers=auth_headers)
    assert res_completed.status_code == 200
    assert res_completed.json()["total"] == 1


def test_rename_meeting_endpoint(client, auth_headers, db_session, test_user):
    """Verify renaming a meeting title via PATCH /api/meetings/{meeting_id}."""
    meeting = Meeting(
        public_id="rename-test-1",
        title="Original Standup Name",
        original_filename="standup.wav",
        status="uploaded",
        user_id=test_user.id,
    )
    db_session.add(meeting)
    db_session.commit()

    # Rename meeting
    res = client.patch(
        "/api/meetings/rename-test-1",
        json={"title": "Q3 Product Architecture Strategy"},
        headers=auth_headers,
    )
    assert res.status_code == 200
    data = res.json()
    assert data["title"] == "Q3 Product Architecture Strategy"

    # Verify empty title rejection
    res_empty = client.patch(
        "/api/meetings/rename-test-1",
        json={"title": "   "},
        headers=auth_headers,
    )
    assert res_empty.status_code == 400
