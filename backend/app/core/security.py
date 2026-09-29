"""
security.py

Password hashing and JWT handling for Phase 12 (Authentication).

Deliberately implemented with ONLY the Python standard library (no new
dependencies - see master prompt rule "avoid unnecessary dependencies"):

  - Passwords: PBKDF2-HMAC-SHA256 with a random 16-byte salt and a high
    iteration count. Stored as a self-describing string:
        pbkdf2_sha256$<iterations>$<salt_b64>$<hash_b64>
    Verification uses hmac.compare_digest to avoid timing attacks.

  - Tokens: signed JWT (HS256, RFC 7519) with `sub` (user id) and an `exp`
    (expiration) claim. Signature = HMAC-SHA256 over the base64url
    header.payload using the application secret key.

These are intentionally small, correct, and testable. If production
threat modeling later demands a vetted crypto library (a natural fit for
Phase 16 "Production security"), swap the internals here - the function
signatures make that a localized change.
"""

import base64
import hashlib
import hmac
import json
import secrets
import time
from typing import Any, Dict

# PBKDF2 iterations. ~260k is a reasonable cost on the dev's i3 CPU
# while still being strong; raise it on faster hardware.
PBKDF2_ITERATIONS = 260_000
PBKDF2_ALGORITHM = "pbkdf2_sha256"


class AuthError(Exception):
    """Raised when a token is invalid, expired, or malformed."""


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(data: str) -> bytes:
    pad = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + pad)


def generate_reset_token() -> str:
    """Return a cryptographically-secure random reset token string (plaintext).

    The *caller* is responsible for hashing this value (via hash_reset_token)
    before persisting it to the database. Only the hash is stored; the
    plaintext token is dispatched out-of-band to the user (e.g. via email).
    """
    return secrets.token_urlsafe(32)


def hash_reset_token(token: str) -> str:
    """Return the SHA-256 hex digest of a plaintext reset token.

    Only the digest is stored in the database. On verification the inbound
    token is hashed with this function and compared against the stored digest
    using hmac.compare_digest to prevent timing-oracle attacks.
    """
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


# ------------------------------------------------------------------
# Password hashing
# ------------------------------------------------------------------

def hash_password(password: str) -> str:
    """Hash a password and return a self-describing encoded string."""
    salt = secrets.token_bytes(16)
    derived = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS
    )
    return "$".join(
        [
            PBKDF2_ALGORITHM,
            str(PBKDF2_ITERATIONS),
            _b64url_encode(salt),
            _b64url_encode(derived),
        ]
    )


def verify_password(password: str, encoded: str) -> bool:
    """Return True if `password` matches the stored encoded hash."""
    try:
        algorithm, iterations_part, salt_b64, hash_b64 = encoded.split("$")
        if algorithm != PBKDF2_ALGORITHM:
            return False
        iterations = int(iterations_part)
        salt = _b64url_decode(salt_b64)
        expected = _b64url_decode(hash_b64)
    except Exception:
        return False

    derived = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, iterations
    )
    return hmac.compare_digest(derived, expected)


# ------------------------------------------------------------------
# JWT (HS256)
# ------------------------------------------------------------------

def _sign(signing_input: str, secret_key: str) -> str:
    digest = hmac.new(
        secret_key.encode("utf-8"),
        signing_input.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    return _b64url_encode(digest)


def create_access_token(subject: str, secret_key: str, expires_minutes: int) -> str:
    """Create a signed HS256 JWT with a subject and an expiration claim."""
    header = {"alg": "HS256", "typ": "JWT"}
    now = int(time.time())
    payload = {
        "sub": str(subject),
        "iat": now,
        "exp": now + (int(expires_minutes) * 60),
    }

    header_segment = _b64url_encode(
        json.dumps(header, separators=(",", ":")).encode("utf-8")
    )
    payload_segment = _b64url_encode(
        json.dumps(payload, separators=(",", ":")).encode("utf-8")
    )
    signing_input = header_segment + "." + payload_segment

    return signing_input + "." + _sign(signing_input, secret_key)


def decode_access_token(token: str, secret_key: str) -> Dict[str, Any]:
    """
    Verify a JWT's signature and expiration and return its payload.

    Raises AuthError if the token is malformed, forged, or expired.
    """
    parts = token.split(".")
    if len(parts) != 3:
        raise AuthError("Malformed token.")

    signing_input = parts[0] + "." + parts[1]

    try:
        supplied = _b64url_decode(parts[2])
    except Exception:
        raise AuthError("Malformed signature.")

    expected = hmac.new(
        secret_key.encode("utf-8"),
        signing_input.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    if not hmac.compare_digest(supplied, expected):
        raise AuthError("Invalid signature.")

    try:
        payload = json.loads(_b64url_decode(parts[1]))
    except Exception:
        raise AuthError("Malformed payload.")

    exp = payload.get("exp")
    if not isinstance(exp, int) or exp < int(time.time()):
        raise AuthError("Token expired.")

    return payload