from datetime import datetime
from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import relationship

from app.core.database import Base


class Meeting(Base):
    __tablename__ = "meetings"

    id = Column(Integer, primary_key=True, index=True)

    public_id = Column(
        String(36),
        unique=True,
        index=True,
        nullable=True
    )

    title = Column(String(255), nullable=False)

    original_filename = Column(String(255), nullable=True)

    saved_filename = Column(String(255), nullable=True)

    # Phase 12 (Authentication): every meeting belongs to a user,
    # and authorization scopes all access to this id. Nullable so
    # rows created before Phase 12 still load (and can be backfilled
    # later).
    user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )

    status = Column(
        String(50),
        default="uploaded",
        nullable=False
    )

    created_at = Column(
        DateTime,
        default=datetime.utcnow,
        nullable=False
    )

    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False
    )

    transcript = relationship(
        "Transcript",
        back_populates="meeting",
        uselist=False,
        cascade="all, delete-orphan"
    )

    mom = relationship(
        "MOM",
        back_populates="meeting",
        uselist=False,
        cascade="all, delete-orphan"
    )

    owner = relationship(
        "User",
        back_populates="meetings",
    )

    # PERF-01: Composite index to accelerate the dashboard query:
    #   SELECT * FROM meetings WHERE user_id = ? ORDER BY updated_at DESC
    # Without this index SQLAlchemy/SQLite performs a full-table scan for
    # every page load; with it the lookup is O(log n) on user_id then
    # updated_at is pre-sorted within that range.
    __table_args__ = (
        Index("ix_meetings_user_updated_at", "user_id", "updated_at"),
    )


class Transcript(Base):
    __tablename__ = "transcripts"

    id = Column(Integer, primary_key=True, index=True)

    meeting_id = Column(
        Integer,
        ForeignKey("meetings.id", ondelete="CASCADE"),
        nullable=False,
        unique=True
    )

    content = Column(Text, nullable=False)

    created_at = Column(
        DateTime,
        default=datetime.utcnow,
        nullable=False
    )

    # Phase 14 (Speaker Diarization): stores per-segment data (JSON-encoded
    # list of {start, end, text, speaker?}) for rich frontend display.
    # Null for transcripts created before Phase 14 — handled gracefully.
    segments_json = Column(Text, nullable=True)

    # True when diarization ran successfully and segments carry speaker labels.
    has_diarization = Column(Boolean, default=False, nullable=True)

    meeting = relationship(
        "Meeting",
        back_populates="transcript"
    )


class MOM(Base):
    __tablename__ = "moms"

    id = Column(Integer, primary_key=True, index=True)

    meeting_id = Column(
        Integer,
        ForeignKey("meetings.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )

    meeting_title = Column(String(255), nullable=True)

    meeting_date = Column(String(100), nullable=True)

    summary = Column(Text, nullable=True)

    participants = Column(Text, nullable=True)

    discussion_points = Column(Text, nullable=True)

    decisions = Column(Text, nullable=True)

    pending_issues = Column(Text, nullable=True)

    created_at = Column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    meeting = relationship(
        "Meeting",
        back_populates="mom",
    )

    action_items = relationship(
        "ActionItem",
        back_populates="mom",
        cascade="all, delete-orphan",
    )

class ActionItem(Base):
    __tablename__ = "action_items"

    id = Column(Integer, primary_key=True, index=True)

    mom_id = Column(
        Integer,
        ForeignKey("moms.id", ondelete="CASCADE"),
        nullable=True,
    )


    task = Column(Text, nullable=False)

    assignee = Column(String(255), nullable=True)

    deadline = Column(String(100), nullable=True)

    status = Column(
        String(50),
        default="pending",
        nullable=False,
    )

    # Phase 11 (Advanced MOM intelligence): priority of the action item,
    # normalized to a controlled set (low/medium/high) or None.
    priority = Column(String(20), nullable=True)

    created_at = Column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    mom = relationship(
        "MOM",
        back_populates="action_items",
    )
