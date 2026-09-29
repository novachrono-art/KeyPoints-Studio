"""
conftest.py

Shared pytest fixtures for Phase 17 automated testing suite.
Provides test database sessions, client fixtures, and test users.
"""

import os
import sys
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

# Ensure backend root is on sys.path
BASE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BASE_DIR))

from app.core.database import Base, get_db
from app.main import app
from app.models.user import User
from app.core.security import hash_password, create_access_token
from app.core.config import SECRET_KEY


# In-memory SQLite database dedicated to tests
TEST_DB_URL = "sqlite:///:memory:"
test_engine = create_engine(
    TEST_DB_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)


@pytest.fixture(scope="session", autouse=True)
def init_test_db():
    """Create all tables in the in-memory test database."""
    Base.metadata.create_all(bind=test_engine)
    yield
    Base.metadata.drop_all(bind=test_engine)


@pytest.fixture
def db_session():
    """Yield a transactional database session for tests."""
    connection = test_engine.connect()
    transaction = connection.begin()
    session = TestingSessionLocal(bind=connection)

    yield session

    session.close()
    transaction.rollback()
    connection.close()


@pytest.fixture
def client(db_session):
    """FastAPI TestClient with overridden get_db dependency."""
    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def test_user(db_session):
    """Create and return a standard test user."""
    user = User(
        username="testuser_p17",
        email="testuser_p17@example.com",
        password_hash=hash_password("Password123!"),
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture
def auth_headers(test_user):
    """Return Authorization Bearer header for test_user."""
    token = create_access_token(str(test_user.id), SECRET_KEY, expires_minutes=60)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def test_user_2(db_session):
    """Create and return a second test user for isolation tests."""
    user = User(
        username="testuser_other",
        email="testuser_other@example.com",
        password_hash=hash_password("Password123!"),
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture
def auth_headers_2(test_user_2):
    """Return Authorization Bearer header for test_user_2."""
    token = create_access_token(str(test_user_2.id), SECRET_KEY, expires_minutes=60)
    return {"Authorization": f"Bearer {token}"}

