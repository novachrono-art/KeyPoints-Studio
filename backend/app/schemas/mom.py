"""
mom.py

Pydantic schema for a structured Minutes of Meeting (MOM), matching
the format defined in the master prompt (Section 8).

This is the validation safety net between "whatever text the LLM
happened to return" and the rest of the application. If a response
from Gemini doesn't match this shape, it is rejected and retried
(see llm_service.py) rather than silently accepted.
"""

from typing import List, Optional

from pydantic import BaseModel, Field, field_validator


# Controlled vocabularies for ActionItem status/priority (Phase 11 -
# Advanced MOM intelligence). Anything the LLM returns outside these
# sets is normalized to None below, so we never persist a value it
# invented imprecisely - the "do not trust arbitrary LLM JSON" rule.
ALLOWED_ACTION_ITEM_STATUS = {"pending", "in_progress", "done", "blocked"}
ALLOWED_ACTION_ITEM_PRIORITY = {"low", "medium", "high"}


def _normalize_enum(value, allowed):
    """Lowercase/trim a string and return it only if it is in `allowed`."""
    if value is None:
        return None
    if isinstance(value, str):
        cleaned = value.strip().lower()
        if cleaned in allowed:
            return cleaned
    return None


class ActionItem(BaseModel):
    task: str
    # assignee/deadline are Optional and default to None rather than
    # being required - per the project's hallucination-control rules,
    # the LLM is instructed to use null here instead of guessing, so
    # the schema must allow that.
    assignee: Optional[str] = None
    deadline: Optional[str] = None
    # Phase 11: status/priority are normalized to a controlled set (or
    # None if unknown) so the stored values are always trustworthy.
    status: Optional[str] = None
    priority: Optional[str] = None

    @field_validator("task")
    @classmethod
    def _trim_task(cls, v):
        return v.strip() if isinstance(v, str) else v

    @field_validator("status")
    @classmethod
    def _normalize_status(cls, v):
        return _normalize_enum(v, ALLOWED_ACTION_ITEM_STATUS)

    @field_validator("priority")
    @classmethod
    def _normalize_priority(cls, v):
        return _normalize_enum(v, ALLOWED_ACTION_ITEM_PRIORITY)


class MOMResult(BaseModel):
    meeting_title: Optional[str] = None
    meeting_date: Optional[str] = None
    summary: str

    participants: List[str] = Field(default_factory=list)
    discussion_points: List[str] = Field(default_factory=list)

    # Empty lists here are meaningful and expected - they mean "the
    # LLM found none of these in the transcript", NOT "the LLM forgot
    # to fill this in". Never post-process an empty list into a fake
    # placeholder entry.
    decisions: List[str] = Field(default_factory=list)
    action_items: List[ActionItem] = Field(default_factory=list)
    pending_issues: List[str] = Field(default_factory=list)