"""
mom_service.py

Database-backed persistence for MOM and ActionItem records.

Phase 9 Part 2: replaces the JSON-file storage
(storage/processed/{id}_mom.json, used in Phases 6-8) with real
database rows via the models built in Phase 9 Part 1. The public
function names (generate_mom, save_mom, get_mom) are UNCHANGED from
before - only their internals, and the fact that they now take a
db Session, changed. This kept the update to meetings.py's routes
small and mechanical rather than a rewrite.
"""

import json
from typing import Optional

from sqlalchemy.orm import Session

from app.models.meeting import MOM, ActionItem
from app.schemas.mom import MOMResult
from app.services.llm_service import get_llm_service


def _encode_list(items: list[str]) -> str:
    """Store list-valued MOM fields safely in their SQLite TEXT columns."""
    return json.dumps(items, ensure_ascii=False)


def _decode_list(value: Optional[str]) -> list[str]:
    """Read current JSON values and tolerate legacy empty/plain-text values."""
    if not value:
        return []
    try:
        decoded = json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return [value]
    return decoded if isinstance(decoded, list) else []

def generate_mom(db: Session, meeting_id: str, transcript_text: str) -> MOMResult:
    """
    Run LLM extraction on a transcript and save the resulting MOM.

    Raises:
        LLMExtractionError (from llm_service) if extraction fails.
    """
    service = get_llm_service()
    mom_result = service.extract_mom(transcript_text)
    save_mom(db, meeting_id, mom_result)
    return mom_result


def save_mom(db: Session, meeting_id: str, mom: MOMResult) -> None:
    """
    Persist a MOM to the database - used both right after generation
    and whenever the user saves edits from the UI (Phase 7).

    A meeting has at most one MOM (unique constraint on meeting_id):
    this updates the existing row if present, or creates a new one.
    action_items are fully replaced (deleted, then re-created) rather
    than diffed - the UI always sends the COMPLETE list on save
    (Phase 7's MomView holds the whole array in state), so a full
    replace is simpler and just as correct as a diff would be.
    """
    existing = db.query(MOM).filter(MOM.meeting_id == meeting_id).first()
     
    if existing:
        existing.meeting_title = mom.meeting_title
        existing.meeting_date = mom.meeting_date
        existing.summary = mom.summary
        existing.participants = _encode_list(mom.participants)
        existing.discussion_points = _encode_list(mom.discussion_points)
        existing.decisions = _encode_list(mom.decisions)
        existing.pending_issues = _encode_list(mom.pending_issues)

        db.query(ActionItem).filter(ActionItem.mom_id == existing.id).delete()
        db.flush()
        mom_row = existing
    else:
        mom_row = MOM(
            meeting_id=meeting_id,
            meeting_title=mom.meeting_title,
            meeting_date=mom.meeting_date,
            summary=mom.summary,
            participants=_encode_list(mom.participants),
            discussion_points=_encode_list(mom.discussion_points),
            decisions=_encode_list(mom.decisions),
            pending_issues=_encode_list(mom.pending_issues),
        )
        db.add(mom_row)
        db.flush()  # populates mom_row.id, needed for the action_items below

    for item in mom.action_items:
        db.add(
            ActionItem(
                mom_id=mom_row.id,
                task=item.task,
                assignee=item.assignee,
                deadline=item.deadline,
                # DB status column is NOT NULL; normalize an unspecified
                # status to the safe "pending" default.
                status=item.status or "pending",
                priority=item.priority,
            )
        )

    db.commit()


def get_mom(db: Session, meeting_id: str) -> Optional[MOMResult]:
    """Retrieve a previously saved MOM as a validated MOMResult, or None."""
    mom_row = db.query(MOM).filter(MOM.meeting_id == meeting_id).first()
    if mom_row is None:
        return None

    return MOMResult(
        meeting_title=mom_row.meeting_title,
        meeting_date=mom_row.meeting_date,
        summary=mom_row.summary,
        participants=_decode_list(mom_row.participants),
        discussion_points=_decode_list(mom_row.discussion_points),
        decisions=_decode_list(mom_row.decisions),
        action_items=[
            {
                "task": ai.task,
                "assignee": ai.assignee,
                "deadline": ai.deadline,
                "status": ai.status,
                "priority": ai.priority,
            }
            for ai in mom_row.action_items
        ],
        pending_issues=_decode_list(mom_row.pending_issues),
    )
