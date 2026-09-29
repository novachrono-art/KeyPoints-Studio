"""
progress.py

Thread-safe, in-memory progress store for long-running pipeline stages.

Phase 11 (Long Audio Handling) splits meeting-length recordings into
chunks, and each chunk (plus each pipeline stage) takes a meaningful
amount of time. Rather than the frontend inventing a fake percentage,
the backend records the REAL current stage/progress here and exposes it
through a lightweight polling endpoint (GET /{meeting_id}/progress).
The frontend reads that and only ever shows what the backend actually
reports - consistent with the project's "don't show fake progress"
principle.

Storage is intentionally in-memory (a process-local dict guarded by a
lock) because this is transient status, not durable data. It resets on
server restart, which is fine for development. If a distributed
deployment ever needs cross-process progress, this can be swapped for
Redis/etc. without changing callers.

Phase 15 (Background Processing): added is_running()/mark_running() to
guard against duplicate background jobs, and set_job_error() so worker
threads can surface terminal failures to the polling endpoint.

SEC-05 (Error-state retention): clear_progress() no longer instantly
wipes an error record. When a job ends in stage="error", the record is
preserved for ERROR_RETAIN_SECONDS (default: 5 minutes) so the frontend
can read the actual failure message on its next poll instead of receiving
a confusing 404. After the TTL the record is silently discarded.
"""

import threading
import time
from typing import Optional


_lock = threading.Lock()
_progress: dict[str, dict] = {}
_running: set[str] = set()  # Phase 15: tracks meetings with an active background job

# SEC-05: Retain error records this many seconds so the frontend can read
# the failure message before the progress entry is garbage-collected.
ERROR_RETAIN_SECONDS: int = 300  # 5 minutes


def set_progress(
    meeting_id: str,
    stage: str,
    message: str,
    current: Optional[int] = None,
    total: Optional[int] = None,
) -> None:
    """Record the current pipeline progress for a meeting."""
    percent = None
    if current is not None and total:
        percent = round((current / total) * 100, 1)

    with _lock:
        _progress[meeting_id] = {
            "stage": stage,
            "message": message,
            "current": current,
            "total": total,
            "percent": percent,
            "error": None,
            "_error_expires": None,  # internal; not surfaced to callers
        }


def set_job_error(meeting_id: str, message: str) -> None:
    """
    Record a terminal error for a background job.

    Phase 15: called by background worker threads when the pipeline fails
    so the frontend can display the real error message on the next poll
    instead of just seeing the progress disappear.

    SEC-05: stores a TTL timestamp so clear_progress() called in the
    worker's finally block does NOT immediately erase the error record.
    """
    with _lock:
        _progress[meeting_id] = {
            "stage": "error",
            "message": message,
            "current": None,
            "total": None,
            "percent": None,
            "error": message,
            "_error_expires": time.monotonic() + ERROR_RETAIN_SECONDS,
        }
        _running.discard(meeting_id)


def get_progress(meeting_id: str) -> Optional[dict]:
    """Return a copy of the stored progress, or None if none is set.

    SEC-05: expired error records are lazily discarded here on read so
    the caller always sees either a live record or None.
    """
    with _lock:
        if meeting_id not in _progress:
            return None

        record = _progress[meeting_id]

        # Lazily discard expired error records.
        expiry = record.get("_error_expires")
        if expiry is not None and time.monotonic() > expiry:
            del _progress[meeting_id]
            return None

        # Return a copy without the internal bookkeeping key.
        public = {k: v for k, v in record.items() if not k.startswith("_")}
        return public


def clear_progress(meeting_id: str) -> None:
    """Remove stored progress for a meeting.

    SEC-05: if the meeting currently has a stage="error" record, we
    honour the error TTL and skip the erasure — the record will be
    discarded lazily by get_progress() after ERROR_RETAIN_SECONDS.
    For all other stages (converting, transcribing, etc.) the record is
    removed immediately as before.
    """
    with _lock:
        record = _progress.get(meeting_id)
        if record is None:
            _running.discard(meeting_id)
            return

        # If the job ended in an error, let the TTL govern expiry.
        if record.get("stage") == "error" and record.get("_error_expires") is not None:
            # Only remove _running flag; leave error record intact for frontend.
            _running.discard(meeting_id)
            return

        # Normal completion: wipe the progress record immediately.
        _progress.pop(meeting_id, None)
        _running.discard(meeting_id)


def mark_running(meeting_id: str) -> bool:
    """
    Atomically mark a meeting as having an active background job.

    Phase 15: called before spawning a thread. Returns True if the meeting
    was successfully claimed (no job was running), False if a job is already
    active (the caller should abort and return 409 to the client).
    """
    with _lock:
        if meeting_id in _running:
            return False
        _running.add(meeting_id)
        return True


def is_running(meeting_id: str) -> bool:
    """Return True if a background job is currently active for this meeting."""
    with _lock:
        return meeting_id in _running
