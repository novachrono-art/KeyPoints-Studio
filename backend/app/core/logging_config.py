"""
logging_config.py

Security logging configuration for Phase 16 (Production Security).

Ensures that API keys, passwords, auth tokens, and sensitive headers
are never logged to standard output or logfiles while preserving formatting
types (integers, floats) for logger arguments.
"""

import logging
import re
from typing import Any


# Patterns for sensitive keys to mask
_SENSITIVE_PATTERNS = [
    re.compile(r"(gsk_[a-zA-Z0-9]{20,})"),                         # Groq keys
    re.compile(r"(AIzaSy[a-zA-Z0-9_\-]{30,})"),                    # Google/Gemini keys
    re.compile(r'(password["\']?\s*[:=]\s*["\'])([^"\']+)(["\'])', re.IGNORECASE),
    re.compile(r'(Bearer\s+)([a-zA-Z0-9_\-\.]{20,})', re.IGNORECASE), # JWT tokens
    re.compile(r'(secret_key["\']?\s*[:=]\s*["\'])([^"\']+)(["\'])', re.IGNORECASE),
]


class SecretRedactingFilter(logging.Filter):
    """Logging filter that automatically redacts API keys and secrets from log messages."""

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            record.msg = self.redact(record.msg)
        if record.args:
            if isinstance(record.args, dict):
                record.args = {
                    k: (self.redact(v) if isinstance(v, str) else v)
                    for k, v in record.args.items()
                }
            elif isinstance(record.args, tuple):
                record.args = tuple(
                    (self.redact(arg) if isinstance(arg, str) else arg)
                    for arg in record.args
                )
        return True

    @classmethod
    def redact(cls, text: Any) -> Any:
        if not isinstance(text, str):
            return text
        result = text
        for pattern in _SENSITIVE_PATTERNS:
            if "password" in pattern.pattern.lower() or "secret_key" in pattern.pattern.lower():
                result = pattern.sub(r"\g<1>******\g<3>", result)
            elif "bearer" in pattern.pattern.lower():
                result = pattern.sub(r"\g<1>[REDACTED_TOKEN]", result)
            else:
                result = pattern.sub("[REDACTED_KEY]", result)
        return result


def setup_secure_logging(level: int = logging.INFO):
    """Attach the secret redacting filter to the root logger."""
    root_logger = logging.getLogger()
    root_logger.setLevel(level)

    filter_instance = SecretRedactingFilter()
    for handler in root_logger.handlers:
        handler.addFilter(filter_instance)

    if not root_logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(
            logging.Formatter("[%(asctime)s] [%(levelname)s] [%(name)s]: %(message)s")
        )
        handler.addFilter(filter_instance)
        root_logger.addHandler(handler)
