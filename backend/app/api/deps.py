"""
deps.py

Request-scoped dependencies shared by the API routes.

Phase 12 (Authentication) adds `get_current_user`, which turns the JWT the
frontend sends on every request into the SQLAlchemy `User` that owns the
resource being acted on. Protected routes declare it via:

    current_user: User = Depends(get_current_user)

so authentication (is this a real token?) and authorization (does this
user own this meeting?) are both enforced server-side, never in the browser.
"""

from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.config import SECRET_KEY
from app.core.database import get_db
from app.core.security import AuthError, decode_access_token
from app.models.user import User


# Parse the `Authorization: Bearer <token>` header for us. auto_error=False
# lets us raise a clean 401 ourselves (instead of FastAPI's default 403) so
# the frontend can show a proper "log in" prompt.
bearer_scheme = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    """
    Resolve the authenticated user for the current request.

    Returns the User row for the token's subject, or raises 401 if the
    token is absent, malformed, forged, or expired. The DB session opened
    here is closed by FastAPI's dependency machinery (get_db yields/closes).
    """
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated. Please log in.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = credentials.credentials

    try:
        payload = decode_access_token(token, SECRET_KEY)
    except AuthError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token. Please log in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # `sub` holds the user id we stored at token-creation time.
    try:
        user_id = int(payload.get("sub"))
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token subject.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User no longer exists.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return user
