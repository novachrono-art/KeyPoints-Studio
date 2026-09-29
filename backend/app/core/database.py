"""
database.py

SQLAlchemy database engine and session setup.
Supports SQLite (development/tests) and PostgreSQL (production/docker).
"""

from sqlalchemy import create_engine, text
from sqlalchemy.orm import declarative_base, sessionmaker

from app.core.config import DATABASE_URL


def _build_engine(url: str):
    # Normalize postgres:// to postgresql:// for SQLAlchemy compatibility
    normalized_url = url
    if url.startswith("postgres://"):
        normalized_url = url.replace("postgres://", "postgresql://", 1)

    if normalized_url.startswith("sqlite"):
        return create_engine(
            normalized_url,
            connect_args={"check_same_thread": False},
        )
    else:
        # PostgreSQL production engine with connection pooling and health checks
        return create_engine(
            normalized_url,
            pool_size=10,
            max_overflow=20,
            pool_pre_ping=True,
            pool_recycle=300,
        )


engine = _build_engine(DATABASE_URL)

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
)

Base = declarative_base()


def get_db():
    """FastAPI request-scoped database session dependency."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def check_database_health() -> bool:
    """Quick database connectivity check for readiness and health endpoints."""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False
