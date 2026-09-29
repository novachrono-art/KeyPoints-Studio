"""
main.py

Entry point for the AI Meeting MOM Generator backend.

Phase 1: Added /api/health.
Phase 2: Added /api/meetings/upload (via the meetings router).
Phase 12: Added the auth router (`/api/auth` register/login/me) and
          protected every meetings route behind get_current_user, scoping
          all meeting lookups to the requesting user's id.
Phase 15: Transcription and MOM generation now run in background threads;
          the API returns immediately and clients poll GET /progress.
Phase 16: Production Security:
          - Configurable CORS origins via .env
          - HTTP Security headers (nosniff, DENY frame options, referrer policy)
          - Safe global exception handling (no raw internal tracebacks/secrets leaked)
          - Secret-redacting logging filter
"""

import logging
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes import auth, meetings
from app.core.config import CORS_ORIGINS, ENV
from app.core.database import check_database_health, engine
from app.core.logging_config import setup_secure_logging

# Configure logging with secret redacting filter (Phase 16)
setup_secure_logging()
logger = logging.getLogger(__name__)

# Create the FastAPI application instance.
app = FastAPI(
    title="KeyPoints Studio",
    description="Backend API for KeyPoints Studio — Minutes of Meeting and action item intelligence from recordings.",
    version="0.1.0",
)

# ---------------------------------------------------------------------------
# Security Headers Middleware (Phase 16)
# ---------------------------------------------------------------------------
@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    """
    Attach standard defensive HTTP security headers to all responses.
    """
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    return response


# ---------------------------------------------------------------------------
# Configurable CORS (Phase 16)
# ---------------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Global Secure Exception Handler (Phase 16)
# ---------------------------------------------------------------------------
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """
    Catch-all exception handler to prevent leaking raw internal Python
    tracebacks, database error details, or credentials to production clients.
    """
    logger.error("Unhandled server error processing %s: %s", request.url.path, exc, exc_info=True)

    # In development mode or for client-facing HTTP exceptions, standard detail is fine.
    # In production, unhandled 500s return a sanitized, safe message.
    detail = "An internal server error occurred. Please try again later."
    if ENV == "development":
        detail = f"Internal error: {str(exc)}"

    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": detail},
    )


# Register routes
app.include_router(meetings.router)
app.include_router(auth.router)


@app.get("/api/health")
def health_check():
    """
    Health check endpoint reporting service status, database connectivity, and engine dialect.
    """
    db_ok = check_database_health()
    return {
        "status": "ok" if db_ok else "degraded",
        "service": "keypoints-studio-backend",
        "phase": "Phase 18 - Production Deployment & Dockerization",
        "database": {
            "status": "connected" if db_ok else "disconnected",
            "dialect": engine.dialect.name,
        },
    }


