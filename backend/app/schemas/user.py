"""
user.py

Pydantic schemas for authentication: registration, login,
Google OAuth, current-user response, and issued access tokens.
"""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=50, pattern=r"^[A-Za-z0-9_]+$")
    password: str = Field(min_length=6, max_length=128)
    email: str = Field(min_length=5, max_length=255, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class UserLogin(BaseModel):
    username: str  # Can be username or email address
    password: str


class GoogleAuthRequest(BaseModel):
    credential: str  # Google ID token / JWT
    client_id: Optional[str] = None


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    email: Optional[str] = None
    auth_provider: str = "local"
    avatar_url: Optional[str] = None
    email_verified: int = 0
    created_at: datetime


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class ChangePassword(BaseModel):
    current_password: str
    new_password: str = Field(min_length=6, max_length=128)


class ForgotPassword(BaseModel):
    username: str


class ResetPassword(BaseModel):
    token: str
    new_password: str = Field(min_length=6, max_length=128)