"""
user.py

SQLAlchemy model for an application user (Phase 12 - Authentication).

A user owns many meetings:
    User
      └── Meetings
          ├── Transcript
          └── MOM
              └── ActionItem

Authorization is enforced on the server: every meeting the API returns
or mutates is scoped to the requesting user's id, so users can only ever
reach their own meetings/files.
"""

from datetime import datetime

from sqlalchemy import Column, DateTime, Integer, String
from sqlalchemy.orm import relationship

from app.core.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)

    username = Column(
        String(50),
        unique=True,
        index=True,
        nullable=False,
    )

    email = Column(
        String(255),
        unique=True,
        index=True,
        nullable=True,
    )

    # Never store a raw password. This is the PBKDF2-HMAC-SHA256 encoded
    # hash produced by app.core.security.hash_password.
    password_hash = Column(String(255), nullable=False)

    # Google OAuth & Identity fields
    google_id = Column(String(128), unique=True, index=True, nullable=True)
    auth_provider = Column(String(32), default="local", nullable=False)
    avatar_url = Column(String(512), nullable=True)
    email_verified = Column(Integer, default=0, nullable=False)  # 1 = verified, 0 = unverified

    # Phase 12 follow-up (forgot/change password): a short-lived reset token
    # and its expiry. When set, this lets a user prove they control the
    # account (via an emailed/link token) and reset their password without
    # knowing the old one. Cleared on successful reset.
    password_reset_token = Column(String(128), nullable=True, index=True)
    password_reset_expires = Column(DateTime, nullable=True)

    created_at = Column(
        DateTime,
        default=datetime.utcnow,
        nullable=False,
    )

    meetings = relationship(
        "Meeting",
        back_populates="owner",
    )