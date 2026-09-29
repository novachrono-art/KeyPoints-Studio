"""
auth.py

Authentication routes:
    POST /api/auth/register        - register a new user with email, returns a JWT (+ user)
    POST /api/auth/login           - log in by username or email, returns a JWT (+ user)
    POST /api/auth/google          - authenticate / register with Google OAuth
    GET  /api/auth/me              - current-user endpoint (requires a valid token)
    POST /api/auth/verify          - server-side token validity check
    POST /api/auth/forgot-password - issue password reset token
    POST /api/auth/reset-password  - reset password with token
    POST /api/auth/change-password - change password for logged-in user
"""

from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import (
    ACCESS_TOKEN_EXPIRE_MINUTES,
    PASSWORD_RESET_EXPIRE_MINUTES,
    SECRET_KEY,
)
from app.core.database import get_db
from app.core.rate_limiter import rate_limit
from app.core.security import AuthError, create_access_token, decode_access_token
from app.models.user import User
from app.schemas.user import (
    ChangePassword,
    ForgotPassword,
    GoogleAuthRequest,
    ResetPassword,
    Token,
    UserCreate,
    UserLogin,
    UserOut,
)
from app.services import user_service

router = APIRouter(
    prefix="/api/auth",
    tags=["auth"],
)


def _issue_token(user: User) -> str:
    return create_access_token(
        str(user.id),
        SECRET_KEY,
        ACCESS_TOKEN_EXPIRE_MINUTES,
    )


@router.post(
    "/register",
    response_model=Token,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(rate_limit(max_requests=5, window_seconds=60))],
)
def register(user_in: UserCreate, db: Session = Depends(get_db)):
    """
    Register a new user with username, required email, and password.
    """
    try:
        user = user_service.create_user(db, user_in)
    except user_service.UserExistsError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"{e.field.capitalize()} already registered.",
        )

    return Token(
        access_token=_issue_token(user),
        token_type="bearer",
        user=UserOut.model_validate(user),
    )


@router.post(
    "/login",
    response_model=Token,
    dependencies=[Depends(rate_limit(max_requests=10, window_seconds=60))],
)
def login(user_in: UserLogin, db: Session = Depends(get_db)):
    """
    Log in an existing user with username OR email address and password.
    """
    user = user_service.authenticate_user(db, user_in.username, user_in.password)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username/email or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return Token(
        access_token=_issue_token(user),
        token_type="bearer",
        user=UserOut.model_validate(user),
    )


@router.post(
    "/google",
    response_model=Token,
    dependencies=[Depends(rate_limit(max_requests=15, window_seconds=60))],
)
def google_auth(payload: GoogleAuthRequest, db: Session = Depends(get_db)):
    """
    Authenticate or register a user using a verified Google OAuth ID token.
    """
    try:
        google_data = user_service.verify_google_id_token(payload.credential, payload.client_id)
        user = user_service.authenticate_or_create_google_user(db, google_data)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to authenticate with Google.",
        )

    return Token(
        access_token=_issue_token(user),
        token_type="bearer",
        user=UserOut.model_validate(user),
    )


@router.get("/me", response_model=UserOut)
def read_current_user(current_user: User = Depends(get_current_user)):
    """
    Return the currently authenticated user.
    """
    return UserOut.model_validate(current_user)


@router.post("/verify")
def verify(token: str):
    """
    Server-side token verification helper.
    """
    try:
        payload = decode_access_token(token, SECRET_KEY)
    except AuthError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return {"valid": True, "sub": payload.get("sub")}


@router.post(
    "/forgot-password",
    dependencies=[Depends(rate_limit(max_requests=5, window_seconds=60))],
)
def forgot_password(user_in: ForgotPassword, db: Session = Depends(get_db)):
    """
    Start a password reset flow for a username or email.

    SEC-01: The plaintext reset token is NEVER returned in this response.
    Both the "user found" and "user not found" branches return an identical
    generic message to prevent user-enumeration timing attacks.

    In a production deployment the token must be dispatched via a
    separate out-of-band channel (email). Wire it into your SMTP/email
    service by passing `token` to send_mom_email or an equivalent helper.
    """
    # Generic response — returned regardless of whether the user exists
    # so callers cannot enumerate valid usernames via differing replies.
    _generic = {
        "message": (
            "If that account exists, reset instructions have been sent. "
            f"The link expires in {PASSWORD_RESET_EXPIRE_MINUTES} minutes."
        )
    }

    user = user_service.get_user_by_username(db, user_in.username)
    if user is None:
        return _generic

    expires = datetime.utcnow() + timedelta(minutes=PASSWORD_RESET_EXPIRE_MINUTES)
    # issue_password_reset_token stores only the SHA-256 hash in the DB and
    # returns the plaintext token that must be sent out-of-band (e.g. email).
    token = user_service.issue_password_reset_token(db, user, expires)  # noqa: F841

    # TODO: replace this comment with your email dispatch call, e.g.:
    #   email_service.send_password_reset(to=user.email, token=token)
    # Do NOT log or return `token` in any HTTP response body.

    return _generic



@router.post(
    "/reset-password",
    dependencies=[Depends(rate_limit(max_requests=5, window_seconds=60))],
)
def reset_password(user_in: ResetPassword, db: Session = Depends(get_db)):
    """
    Complete a password reset using the token from /forgot-password.
    """
    user = user_service.reset_password_with_token(db, user_in.token, user_in.new_password)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset token. Request a new one.",
        )
    return {
        "message": "Password reset successfully. You can now log in.",
        "username": user.username,
    }


@router.post(
    "/change-password",
    dependencies=[Depends(rate_limit(max_requests=5, window_seconds=60))],
)
def change_password_endpoint(
    user_in: ChangePassword,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Change the current user's password after verifying the current one.
    """
    ok = user_service.change_password(
        db, current_user, user_in.current_password, user_in.new_password
    )
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect.",
        )
    return {"message": "Password changed successfully."}
