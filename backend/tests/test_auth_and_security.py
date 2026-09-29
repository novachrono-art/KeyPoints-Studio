"""
test_auth_and_security.py

Automated tests for Health, Authentication, Authorization, and Security Hardening (Phase 16/17).
"""

import io
from pathlib import Path
from app.core.file_security import validate_magic_bytes, sanitize_filename, safe_path
from app.core.logging_config import SecretRedactingFilter
from app.core.rate_limiter import limiter


def test_health_check(client):
    """Confirm health endpoint returns OK with security headers."""
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "phase" in data
    assert response.headers.get("X-Content-Type-Options") == "nosniff"
    assert response.headers.get("X-Frame-Options") == "DENY"
    assert response.headers.get("Referrer-Policy") == "strict-origin-when-cross-origin"


def test_auth_registration_and_login(client):
    """Test user registration, duplicate rejection, and login."""
    # Register
    reg_payload = {
        "username": "new_sec_user",
        "email": "new_sec_user@example.com",
        "password": "SecurePassword123!",
    }
    reg_res = client.post("/api/auth/register", json=reg_payload)
    assert reg_res.status_code == 201
    token_data = reg_res.json()
    assert "access_token" in token_data
    assert token_data["user"]["username"] == "new_sec_user"

    # Duplicate register rejected with 409
    dup_res = client.post("/api/auth/register", json=reg_payload)
    assert dup_res.status_code == 409

    # Login with valid credentials (by username)
    login_res = client.post(
        "/api/auth/login",
        json={"username": "new_sec_user", "password": "SecurePassword123!"},
    )
    assert login_res.status_code == 200
    assert "access_token" in login_res.json()

    # Login with valid credentials (by email address)
    login_email_res = client.post(
        "/api/auth/login",
        json={"username": "new_sec_user@example.com", "password": "SecurePassword123!"},
    )
    assert login_email_res.status_code == 200
    assert "access_token" in login_email_res.json()

    # Login with bad password rejected with 401
    bad_login = client.post(
        "/api/auth/login",
        json={"username": "new_sec_user", "password": "WrongPassword!"},
    )
    assert bad_login.status_code == 401


def test_google_oauth_flow(client, monkeypatch):
    """Test Google OAuth authentication & automatic user creation."""
    from app.services import user_service

    # Mock verify_google_id_token to simulate valid Google OAuth response
    def mock_verify_google(credential, client_id=None):
        return {
            "sub": "google_1234567890",
            "email": "google_user@company.com",
            "name": "Google Tester",
            "picture": "https://lh3.googleusercontent.com/a/sample",
            "email_verified": True,
        }

    monkeypatch.setattr(user_service, "verify_google_id_token", mock_verify_google)

    response = client.post(
        "/api/auth/google",
        json={"credential": "mock_google_id_token_jwt"},
    )
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["user"]["email"] == "google_user@company.com"
    assert data["user"]["auth_provider"] == "google"
    assert data["user"]["avatar_url"] == "https://lh3.googleusercontent.com/a/sample"


def test_auth_me_endpoint(client, auth_headers, test_user):
    """Test GET /api/auth/me returns current user info."""
    res = client.get("/api/auth/me", headers=auth_headers)
    assert res.status_code == 200
    assert res.json()["username"] == test_user.username


def test_magic_byte_validation():
    """Verify container signature checks for valid and invalid audio bytes."""
    # Valid WAV RIFF header
    valid_wav = b"RIFF\x24\x08\x00\x00WAVEfmt \x10\x00\x00\x00"
    assert validate_magic_bytes(valid_wav, ".wav") is True

    # Valid MP3 ID3 header
    valid_id3_mp3 = b"ID3\x03\x00\x00\x00\x00\x00\x00"
    assert validate_magic_bytes(valid_id3_mp3, ".mp3") is True

    # Valid MP3 sync word header (0xFF 0xFB)
    valid_sync_mp3 = b"\xff\xfb\x90\x44" + b"\x00" * 20
    assert validate_magic_bytes(valid_sync_mp3, ".mp3") is True

    # Valid MP4 / M4A ftyp header
    valid_m4a = b"\x00\x00\x00\x20ftypM4A \x00\x00\x00\x00"
    assert validate_magic_bytes(valid_m4a, ".m4a") is True
    assert validate_magic_bytes(valid_m4a, ".mp4") is True

    # Invalid executable/text renamed to .mp3
    fake_mp3 = b"MZ\x90\x00\x03\x00\x00\x00"  # Windows PE binary header
    assert validate_magic_bytes(fake_mp3, ".mp3") is False
    assert validate_magic_bytes(b"<html><body>test</body></html>", ".wav") is False


def test_filename_sanitization_and_path_safety():
    """Verify traversal patterns and unsafe chars are cleaned."""
    dirty_name = "../../../etc/passwd%00.wav"
    clean = sanitize_filename(dirty_name)
    assert ".." not in clean
    assert "/" not in clean
    assert clean.endswith(".wav")

    # Safe path resolver verifies containment
    base = Path("c:/Users/tilak/OneDrive/Desktop/MOM/backend/storage/uploads").resolve()
    resolved = safe_path(base, "meeting_123.wav")
    assert resolved.parent == base


def test_secret_redaction_logging():
    """Verify log filter masks API keys, tokens, and passwords."""
    sample_log = (
        "Calling Groq with key gsk_AbCdEfGhIjKlMnOpQrStUvWxYz123456 "
        "and user password: \"SuperSecretPassword!\" with Bearer eyJhbGciOiJIUzI1NiJ9.token"
    )
    redacted = SecretRedactingFilter.redact(sample_log)
    assert "gsk_" not in redacted
    assert "[REDACTED_KEY]" in redacted
    assert "SuperSecretPassword!" not in redacted
    assert "******" in redacted
    assert "[REDACTED_TOKEN]" in redacted
