"""
config.py

Central place for settings that multiple parts of the backend need:
storage locations, allowed upload types, size limits, and API keys.

Keeping these here (instead of scattered inline in route files)
means later phases (audio processing, database, etc.) can import
the same constants instead of redefining them.
"""

import os
import secrets
from pathlib import Path

from dotenv import load_dotenv

# backend/app/core/config.py -> parents[2] gets us to backend/
BASE_DIR = Path(__file__).resolve().parents[2]

# Load environment variables from backend/.env (NOT the project
# root - the app's working directory is backend/, so loading from
# here is reliable regardless of what folder a terminal happens to
# be in when uvicorn is started). See .env.example for the template.
load_dotenv(BASE_DIR / ".env")

STORAGE_DIR = BASE_DIR / "storage"
UPLOAD_DIR = STORAGE_DIR / "uploads"
PROCESSED_DIR = STORAGE_DIR / "processed"

# Create these folders on import if they don't exist yet.
# This means the app never crashes just because a folder is missing.
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

# Only these file types are accepted, per the project's file handling rules.
ALLOWED_EXTENSIONS = {".mp3", ".wav", ".m4a", ".mp4"}

# 500 MB ceiling for Phase 2. This is a safety limit, not a target -
# real meeting recordings should usually be well under this.
MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024

# faster-whisper model size. Options (smallest/fastest to
# largest/most accurate): tiny, base, small, medium, large.
#
# Using "small" instead of "base" here specifically because this
# project's real meetings are expected to include Hindi speech, and
# "base" proved too inaccurate on Hindi during testing (confidently
# produced wrong English-sounding text despite correct language
# detection). "small" is noticeably more accurate on non-English
# languages at the cost of being slower per run - an acceptable
# tradeoff for MVP development on short clips.
WHISPER_MODEL_SIZE = "small"

# Language hint for transcription. Set to None to let Whisper
# auto-detect the spoken language (can be unreliable on shorter
# clips or with multilingual/code-switched speech). Set to a
# specific ISO 639-1 code (e.g. "hi" for Hindi, "en" for English)
# to force that language and skip auto-detection - usually more
# accurate when you know the meeting's primary language in advance.
WHISPER_LANGUAGE = None

# Which LLM provider to use for MOM extraction (Phase 6).
# "groq"   - free, no credit card ever required, runs open-weight
#            models (e.g. Llama 3.3) on Groq's fast LPU hardware.
#            DEFAULT, since it requires no billing setup at all.
# "gemini" - Google's Gemini API. Was the original default, but
#            Google's free tier now frequently returns a hard 0
#            quota unless billing is linked (see Documentation.txt
#            Phase 6 addendum) - switch to this only if you've set
#            up Gemini billing.
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "groq")

# Gemini API settings (used only if LLM_PROVIDER="gemini").
# GEMINI_API_KEY must be set in backend/.env - see .env.example.
# NEVER hardcode the actual key here or anywhere else in the code;
# never expose it to the frontend (Section 17 of the master prompt).
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

# Model name is a config value (not hardcoded in llm_service.py) so
# it can be changed in one place if Google renames/deprecates a
# model. Check https://ai.google.dev/gemini-api/docs/models for the
# current list if this ever needs updating.
GEMINI_MODEL_NAME = os.getenv("GEMINI_MODEL_NAME", "gemini-2.0-flash")

# Groq API settings (used only if LLM_PROVIDER="groq", the default).
# GROQ_API_KEY must be set in backend/.env - see .env.example.
# Get a free key (no credit card, ever) at https://console.groq.com/keys
GROQ_API_KEY = os.getenv("GROQ_API_KEY")

# llama-3.3-70b-versatile is a strong general-purpose model with a
# generous permanent free tier on Groq. Check
# https://console.groq.com/docs/models for the current model list
# if this ever needs updating.
# Groq API settings
GROQ_API_KEY = os.getenv("GROQ_API_KEY")

GROQ_MODEL_NAME = os.getenv(
    "GROQ_MODEL_NAME",
    "openai/gpt-oss-20b",
)

GROQ_MODEL = os.getenv(
    "GROQ_MODEL_NAME",
    "llama-3.1-8b-instant",
)

# --------------------------------------------------------------------
# Long-audio handling (Phase 11)
# --------------------------------------------------------------------
# Meeting-length recordings are split into fixed-duration chunks and
# transcribed separately (then merged), instead of one very long single
# transcription call. This keeps any one model call short and
# memory-safe on CPU, and gives us a real per-chunk unit of progress to
# report to the frontend. Recordings shorter than the threshold are
# unaffected (still transcribed in one pass).
LONG_AUDIO_THRESHOLD_SECONDS = 10 * 60  # only chunk recordings longer than this
LONG_AUDIO_CHUNK_SECONDS = 5 * 60       # 5-minute chunks
LONG_AUDIO_OVERLAP_SECONDS = 2.0        # overlap so words on a boundary aren't clipped


# --------------------------------------------------------------------
# Authentication (Phase 12)
# --------------------------------------------------------------------
# Secret used to sign JWT access tokens. In production this MUST be set
# via the SECRET_KEY environment variable (see .env.example) to a long,
# random value. If it is not set in the environment, we persist a generated
# secret in storage/.secret_key so it remains stable across server reboots.
def _get_persistent_secret() -> str:
    env_secret = os.getenv("SECRET_KEY")
    if env_secret:
        return env_secret
    secret_file = STORAGE_DIR / ".secret_key"
    if secret_file.exists():
        try:
            stored = secret_file.read_text(encoding="utf-8").strip()
            if stored:
                return stored
        except Exception:
            pass
    new_secret = secrets.token_urlsafe(48)
    try:
        secret_file.write_text(new_secret, encoding="utf-8")
        # Restrict to owner read/write only (rw-------).
        # On Linux/macOS this prevents other OS users from reading the JWT
        # signing key and forging tokens. os.chmod is a no-op on Windows.
        os.chmod(secret_file, 0o600)
    except Exception:
        pass
    return new_secret

SECRET_KEY = _get_persistent_secret()

# Lifetime of an issued access token, in minutes. After expiry, the user
# must log in again. Configurable via the env for development.
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))

# Lifetime of a password-reset token, in minutes. After this a forgot-
# password link stops working and a new one must be requested.
PASSWORD_RESET_EXPIRE_MINUTES = int(
    os.getenv("PASSWORD_RESET_EXPIRE_MINUTES", "30")
)


# Resolve the default from BASE_DIR so launching Uvicorn from another
# folder never creates a second SQLite database in that folder.
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    f"sqlite:///{(BASE_DIR / 'mom_generator.db').as_posix()}",
)


# --------------------------------------------------------------------
# Speaker Diarization (Phase 14)
# --------------------------------------------------------------------
# When DIARIZATION_ENABLED is False (the default), the transcription
# pipeline is byte-for-byte identical to Phase 13 — no new code paths
# are executed, no new packages are loaded.
#
# To enable: add DIARIZATION_ENABLED=true to backend/.env.
# scikit-learn and scipy must also be installed (they are now in
# requirements.txt, so `pip install -r requirements.txt` suffices).
DIARIZATION_ENABLED = os.getenv("DIARIZATION_ENABLED", "false").lower() == "true"

# Upper bound on the number of speakers auto-detected. Keep small to
# avoid over-splitting — most business meetings have 2-5 speakers.
DIARIZATION_MAX_SPEAKERS = int(os.getenv("DIARIZATION_MAX_SPEAKERS", "6"))

# AgglomerativeClustering (ward linkage) distance threshold used when
# num_speakers is not explicitly supplied. Increase this value to merge
# more clusters (fewer speakers), decrease to split into more clusters.
# A value of 15.0 works well for typical meetings with 2-4 speakers.
DIARIZATION_DISTANCE_THRESHOLD = float(
    os.getenv("DIARIZATION_DISTANCE_THRESHOLD", "15.0")
)


# --------------------------------------------------------------------
# Production Security (Phase 16)
# --------------------------------------------------------------------
# Environment: 'development' or 'production'
ENV = os.getenv("ENV", "development").lower()

# CORS allowed origins. Comma-separated in .env, e.g. "http://localhost:5173,https://app.example.com"
raw_cors = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
CORS_ORIGINS = [origin.strip() for origin in raw_cors.split(",") if origin.strip()]

# Rate limiting toggle (enabled by default)
RATE_LIMIT_ENABLED = os.getenv("RATE_LIMIT_ENABLED", "true").lower() == "true"

# --------------------------------------------------------------------
# Email / SMTP Configuration
# --------------------------------------------------------------------
SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM_EMAIL = os.getenv("SMTP_FROM_EMAIL", os.getenv("SMTP_USER", "noreply@momstudio.ai"))
SMTP_FROM_NAME = os.getenv("SMTP_FROM_NAME", "AI Meeting MOM Studio")

