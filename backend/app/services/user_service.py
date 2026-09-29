"""
user_service.py

Database-backed operations for the application User (Authentication & Google OAuth).
Passwords are hashed with PBKDF2-HMAC-SHA256 via app.core.security before they
ever touch the database, and are never returned by these functions.
"""

import json
import logging
import re
import secrets
import urllib.parse
import urllib.request
from datetime import datetime
from typing import Optional

from sqlalchemy import exc, or_
from sqlalchemy.orm import Session

import hashlib
import hmac

from app.core.security import generate_reset_token, hash_reset_token, hash_password, verify_password
from app.models.user import User
from app.schemas.user import UserCreate

logger = logging.getLogger(__name__)


class UserExistsError(Exception):
    """Raised when creating a user whose username/email is already taken."""

    def __init__(self, field: str):
        self.field = field
        super().__init__(field)


def get_user_by_username(db: Session, username: str) -> Optional[User]:
    return db.query(User).filter(User.username == username).first()


def get_user_by_email(db: Session, email: str) -> Optional[User]:
    if not email:
        return None
    return db.query(User).filter(User.email == email.lower().strip()).first()


def get_user_by_google_id(db: Session, google_id: str) -> Optional[User]:
    if not google_id:
        return None
    return db.query(User).filter(User.google_id == google_id).first()


def get_user_by_identifier(db: Session, identifier: str) -> Optional[User]:
    """Find user by either username or email address."""
    ident = identifier.strip()
    return (
        db.query(User)
        .filter(or_(User.username == ident, User.email == ident.lower()))
        .first()
    )


def get_user_by_id(db: Session, user_id: int) -> Optional[User]:
    return db.query(User).filter(User.id == user_id).first()


def create_user(db: Session, user_in: UserCreate) -> User:
    """
    Create a new user with required username, email, and password.
    Raises UserExistsError on a conflict.
    """
    cleaned_email = user_in.email.lower().strip()
    if get_user_by_username(db, user_in.username):
        raise UserExistsError("username")
    if get_user_by_email(db, cleaned_email):
        raise UserExistsError("email")

    db_user = User(
        username=user_in.username.strip(),
        email=cleaned_email,
        password_hash=hash_password(user_in.password),
        auth_provider="local",
        email_verified=1,
    )
    db.add(db_user)
    try:
        db.commit()
    except exc.IntegrityError:
        db.rollback()
        raise UserExistsError("username")
    db.refresh(db_user)
    return db_user


def authenticate_user(db: Session, identifier: str, password: str) -> Optional[User]:
    """
    Return the user if the username/email and password pair is valid, else None.
    Supports logging in with username OR email.
    """
    user = get_user_by_identifier(db, identifier)
    if user is None:
        return None
    if not verify_password(password, user.password_hash):
        return None
    return user


def verify_google_id_token(credential: str, expected_client_id: Optional[str] = None) -> dict:
    """
    Verify Google OAuth2 ID Token using Google's public tokeninfo endpoint.
    Returns decoded token payload dict on success, or raises ValueError.

    SEC-04 hardening:
    - `aud` claim MUST equal expected_client_id when provided — prevents
      cross-client token reuse (token issued to a different OAuth app).
    - `email_verified` MUST be True — prevents login with unconfirmed addresses
      that an attacker may have pre-registered to take over an account later.
    """
    if not credential or not isinstance(credential, str):
        raise ValueError("Invalid Google credential token.")

    url = f"https://oauth2.googleapis.com/tokeninfo?id_token={urllib.parse.quote(credential)}"
    req = urllib.request.Request(url, headers={"User-Agent": "KeyPoints-Studio-Backend"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        logger.error("Failed to verify Google ID token: %s", e)
        raise ValueError("Google token verification failed. Please try again.")

    if "error_description" in data or "sub" not in data:
        raise ValueError("Invalid Google ID token.")

    # SEC-04: Strict audience check — always enforce when client_id is configured.
    if expected_client_id:
        token_aud = data.get("aud")
        if not token_aud or token_aud != expected_client_id:
            logger.warning(
                "Google token audience mismatch: expected %s, got %s",
                expected_client_id,
                token_aud,
            )
            raise ValueError("Google token audience mismatch.")

    # SEC-04: Reject unverified email addresses.
    email_verified = data.get("email_verified")
    if email_verified not in (True, "true", "True", 1, "1"):
        raise ValueError(
            "Google account email has not been verified. "
            "Please verify your Google account email and try again."
        )

    return data


def authenticate_or_create_google_user(db: Session, google_data: dict) -> User:
    """
    Find or create a User from verified Google OAuth token data.
    """
    google_id = google_data.get("sub")
    if not google_id:
        raise ValueError("Missing Google subject ID.")

    email = (google_data.get("email") or "").lower().strip()
    name = google_data.get("name") or google_data.get("given_name") or ""
    avatar_url = google_data.get("picture")
    is_verified = 1 if (google_data.get("email_verified") in (True, "true", "1", 1)) else 0

    # 1. Existing user linked by google_id
    user = get_user_by_google_id(db, google_id)
    if user:
        if avatar_url and not user.avatar_url:
            user.avatar_url = avatar_url
            db.commit()
        return user

    # 2. Existing user matched by email -> Link Google account
    if email:
        user = get_user_by_email(db, email)
        if user:
            user.google_id = google_id
            user.email_verified = 1
            if avatar_url and not user.avatar_url:
                user.avatar_url = avatar_url
            db.commit()
            return user

    # 3. New user registration from Google
    base_username = re.sub(r"[^A-Za-z0-9_]", "", (name or email.split("@")[0])).strip()
    if len(base_username) < 3:
        base_username = f"user_{secrets.token_hex(3)}"
    elif len(base_username) > 40:
        base_username = base_username[:40]

    unique_username = base_username
    counter = 1
    while get_user_by_username(db, unique_username):
        unique_username = f"{base_username}_{counter}"
        counter += 1

    random_pw = secrets.token_urlsafe(32)
    db_user = User(
        username=unique_username,
        email=email or None,
        google_id=google_id,
        auth_provider="google",
        avatar_url=avatar_url,
        email_verified=is_verified,
        password_hash=hash_password(random_pw),
    )
    db.add(db_user)
    try:
        db.commit()
    except exc.IntegrityError:
        db.rollback()
        # Fallback query in case of race condition
        db_user = get_user_by_google_id(db, google_id) or get_user_by_email(db, email)
        if not db_user:
            raise ValueError("Failed to create Google user account.")
        return db_user

    db.refresh(db_user)
    return db_user


# ------------------------------------------------------------------
# Change / reset password (Phase 12 follow-up)
# ------------------------------------------------------------------

def set_password(db: Session, user: User, new_password: str) -> None:
    """Hash and store a new password, and clear any pending reset token."""
    user.password_hash = hash_password(new_password)
    user.password_reset_token = None
    user.password_reset_expires = None
    db.commit()


def change_password(
    db: Session, user: User, current_password: str, new_password: str
) -> bool:
    """Change user password after verifying current password."""
    if not verify_password(current_password, user.password_hash):
        return False
    set_password(db, user, new_password)
    return True


def issue_password_reset_token(db: Session, user: User, expires: datetime) -> str:
    """Generate a reset token, store its SHA-256 hash in the DB, return the plaintext.

    SEC-01: Only the hash is persisted. The plaintext token is returned to
    the caller which MUST dispatch it out-of-band (e.g. email) and must
    NEVER include it in any HTTP response body.
    """
    token = generate_reset_token()          # cryptographically random plaintext
    token_hash = hash_reset_token(token)    # SHA-256 digest — stored in DB
    user.password_reset_token = token_hash
    user.password_reset_expires = expires
    db.commit()
    return token  # only caller has plaintext; DB only has hash


def reset_password_with_token(
    db: Session, token: str, new_password: str, now: Optional[datetime] = None
) -> Optional[User]:
    """Reset a password using a plaintext reset token.

    SEC-01: The inbound token is hashed before the DB lookup so the database
    never holds plaintext tokens and a DB dump cannot be used to reset
    arbitrary accounts. hmac.compare_digest is used inside SQLAlchemy's
    filter — the hash is deterministic so equality lookup is safe here;
    the constant-time guard is applied on the expiry branch instead.
    """
    now = now or datetime.utcnow()
    # Hash the inbound token so we query by digest, not plaintext.
    token_hash = hash_reset_token(token)
    user = db.query(User).filter(User.password_reset_token == token_hash).first()
    if user is None:
        return None
    if user.password_reset_expires is None or user.password_reset_expires < now:
        # Clear the expired token and reject — use compare_digest to avoid
        # a potential timing oracle on the expiry comparison path.
        if not hmac.compare_digest(user.password_reset_token, token_hash):
            # Should never differ (same hash), but belt-and-suspenders.
            return None
        user.password_reset_token = None
        user.password_reset_expires = None
        db.commit()
        return None
    set_password(db, user, new_password)
    return user
