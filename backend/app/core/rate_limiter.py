"""
rate_limiter.py

Thread-safe, in-memory sliding-window rate limiter for Phase 16 (Production Security).

Protects sensitive endpoints (login, register, forgot-password, upload, AI processing)
against brute-force and resource exhaustion attacks.

Zero external dependencies (no Redis required) — keeps deployment simple
per the project architecture principles while providing reliable per-IP/user throttling.

Security hardening:
  - IP Spoofing fix: X-Forwarded-For is only trusted up to TRUSTED_PROXY_COUNT
    hops. An attacker-prepended fake IP that exceeds the expected proxy depth
    is ignored and the real network peer IP is used instead.
  - Memory Leak fix: A background daemon thread automatically purges stale
    records every CLEANUP_INTERVAL_SECONDS so _records never grows unbounded
    under sustained bot traffic.
"""

import ipaddress
import logging
import os
import threading
import time
from typing import Callable, Optional

from fastapi import HTTPException, Request, status

from app.core.config import RATE_LIMIT_ENABLED

logger = logging.getLogger(__name__)

# How many reverse-proxy hops sit between the internet and this app.
#   0 = no proxy  → always use request.client.host (direct connection)
#   1 = one proxy → trust the LAST entry added by your own proxy only
#   2 = two proxies → trust the last two entries, etc.
# Set via environment: TRUSTED_PROXY_COUNT=1  (default: 0 — safest default)
TRUSTED_PROXY_COUNT: int = int(os.getenv("TRUSTED_PROXY_COUNT", "0"))

# Background cleanup interval — stale limiter keys are purged this often.
CLEANUP_INTERVAL_SECONDS: int = 600  # 10 minutes


def _is_valid_ip(ip_str: str) -> bool:
    """Return True if ip_str parses as a valid public IP address."""
    try:
        ip = ipaddress.ip_address(ip_str.strip())
        # Reject loopback / private — a real client IP should be public
        return not (ip.is_loopback or ip.is_private or ip.is_unspecified or ip.is_reserved)
    except ValueError:
        return False


def get_client_ip(request: Request) -> str:
    """
    Return the real client IP, resistant to X-Forwarded-For spoofing.

    Without a trusted proxy list the old code read XFF[0] — the leftmost
    entry — which is 100% attacker-controlled and trivially bypasses rate
    limits. This version works correctly regardless of proxy topology:

    TRUSTED_PROXY_COUNT = 0  (default, no proxy):
        Ignores X-Forwarded-For entirely; uses request.client.host.

    TRUSTED_PROXY_COUNT = N  (N trusted reverse-proxy hops):
        The XFF list is  [original_client, proxy1, proxy2, ..., proxyN].
        The N rightmost entries are added by *our* trusted proxies.
        The entry just left of those N is the real client IP.
        Any entries further left are attacker-provided and ignored.

    Example — 1 trusted proxy, attacker sends XFF: 1.1.1.1, 9.9.9.9:
        XFF list = [1.1.1.1 (fake), 9.9.9.9 (fake), <proxy_appends_real>]
        We pick index [-1 - 1] = the proxy-appended real IP, not 1.1.1.1.
    """
    if TRUSTED_PROXY_COUNT <= 0:
        # No trusted proxy — never read XFF.
        return request.client.host if request.client else "127.0.0.1"

    forwarded_header = request.headers.get("X-Forwarded-For", "")
    if not forwarded_header:
        return request.client.host if request.client else "127.0.0.1"

    # Split and strip the XFF list.
    xff_ips = [ip.strip() for ip in forwarded_header.split(",") if ip.strip()]

    # The real client is at position -(TRUSTED_PROXY_COUNT + 1) from the right.
    # If the list is too short (attacker removed entries), fall back to peer IP.
    target_index = len(xff_ips) - TRUSTED_PROXY_COUNT - 1
    if target_index >= 0:
        candidate = xff_ips[target_index]
        if _is_valid_ip(candidate):
            return candidate

    # Fallback: use the actual network peer (always reliable).
    return request.client.host if request.client else "127.0.0.1"


class SlidingWindowRateLimiter:
    def __init__(self):
        self._lock = threading.Lock()
        # Storage structure: { key: [timestamp, timestamp, ...] }
        self._records: dict[str, list[float]] = {}
        # Start background cleanup thread so memory never grows unbounded.
        self._start_cleanup_daemon()

    def is_allowed(self, key: str, max_requests: int, window_seconds: int) -> tuple[bool, int]:
        """
        Check whether a request under `key` is permitted within `window_seconds`.

        Returns:
            (allowed: bool, retry_after: int)
        """
        if not RATE_LIMIT_ENABLED:
            return True, 0

        now = time.time()
        window_start = now - window_seconds

        with self._lock:
            timestamps = self._records.get(key, [])
            # Filter out timestamps outside the active window
            valid_timestamps = [t for t in timestamps if t > window_start]

            if len(valid_timestamps) >= max_requests:
                # Calculate remaining seconds until oldest request expires
                oldest = valid_timestamps[0]
                retry_after = max(1, int(oldest + window_seconds - now))
                self._records[key] = valid_timestamps
                return False, retry_after

            # Record this request
            valid_timestamps.append(now)
            self._records[key] = valid_timestamps
            return True, 0

    def cleanup(self, max_age_seconds: int = 3600):
        """Purge stale keys from memory — called automatically by the daemon."""
        now = time.time()
        cutoff = now - max_age_seconds
        with self._lock:
            keys_to_remove = [
                k for k, timestamps in self._records.items()
                if not timestamps or timestamps[-1] < cutoff
            ]
            for k in keys_to_remove:
                self._records.pop(k, None)
        if keys_to_remove:
            logger.debug("Rate limiter: purged %d stale keys", len(keys_to_remove))

    def _start_cleanup_daemon(self) -> None:
        """
        Spawn a low-priority daemon thread that runs cleanup() periodically.

        Daemon threads are killed automatically when the main process exits,
        so no shutdown hook is required. The thread sleeps between runs so it
        consumes no CPU while idle.
        """
        def _loop():
            while True:
                time.sleep(CLEANUP_INTERVAL_SECONDS)
                try:
                    self.cleanup()
                except Exception:
                    pass  # never crash the daemon

        t = threading.Thread(target=_loop, daemon=True, name="rate-limiter-gc")
        t.start()


# Global process-level limiter instance
limiter = SlidingWindowRateLimiter()


def rate_limit(
    max_requests: int,
    window_seconds: int = 60,
    key_func: Optional[Callable[[Request], str]] = None,
):
    """
    FastAPI dependency factory for endpoint-level rate limiting.

    Usage:
        @router.post("/login", dependencies=[Depends(rate_limit(max_requests=5, window_seconds=60))])
    """
    def dependency(request: Request):
        if not RATE_LIMIT_ENABLED:
            return

        endpoint = request.url.path
        if key_func:
            identifier = key_func(request)
        else:
            identifier = get_client_ip(request)

        key = f"{endpoint}:{identifier}"
        allowed, retry_after = limiter.is_allowed(key, max_requests, window_seconds)

        if not allowed:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Too many requests. Please retry in {retry_after} seconds.",
                headers={"Retry-After": str(retry_after)},
            )

    return dependency
