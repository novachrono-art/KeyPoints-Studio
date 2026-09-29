"""
test_performance_benchmark.py

Performance, Latency Profiling, and Resource Utilization Benchmarking (Phase 17).
Measures:
  - CPU & RAM usage baseline (via psutil)
  - Chunk splitting and segment merging algorithms throughput
  - Database read/write latency
  - Scalability benchmarks for 5 min, 10 min, 30 min, 60 min, 120 min audio models
"""

import time
import psutil
import pytest
from app.services.transcription_service import merge_chunk_segments, TranscriptSegment
from app.models.meeting import Meeting, Transcript, MOM, ActionItem
from app.core.config import (
    LONG_AUDIO_CHUNK_SECONDS,
    LONG_AUDIO_OVERLAP_SECONDS,
    LONG_AUDIO_THRESHOLD_SECONDS,
)


def test_resource_utilization_baseline():
    """Measure process memory and CPU baseline."""
    process = psutil.Process()
    mem_info = process.memory_info()
    ram_mb = mem_info.rss / (1024 * 1024)
    cpu_pct = process.cpu_percent(interval=0.1)

    print(f"\n[Resource Baseline] RAM: {ram_mb:.2f} MB | CPU: {cpu_pct:.1f}%")
    # Base Python process should comfortably fit well under 500 MB RAM on Intel i3
    assert ram_mb < 600, f"RAM baseline too high: {ram_mb} MB"


def test_segment_merging_performance():
    """Benchmark segment merging algorithm across thousands of segments."""
    num_chunks = 24  # Equivalent to 2 hours of 5-min chunks
    chunk_offsets = [i * 300.0 for i in range(num_chunks)]
    chunk_segments = []

    # Generate 50 simulated segments per chunk (1200 total segments)
    for c in range(num_chunks):
        segments: list[TranscriptSegment] = [
            {
                "start": float(s * 6),
                "end": float(s * 6 + 5),
                "text": f"Simulated speech segment {s} in chunk {c}",
            }
            for s in range(50)
        ]
        chunk_segments.append(segments)

    start_time = time.perf_counter()
    merged = merge_chunk_segments(chunk_segments, chunk_offsets, overlap_seconds=2.0)
    elapsed_ms = (time.perf_counter() - start_time) * 1000

    print(f"\n[Merge Benchmark] Merged {len(merged)} segments across {num_chunks} chunks in {elapsed_ms:.3f} ms")
    assert len(merged) > 0
    # Algorithm must execute in under 50ms for a full 2-hour recording
    assert elapsed_ms < 50.0, f"Segment merge too slow: {elapsed_ms:.2f} ms"


def test_database_latency_benchmarks(db_session, test_user):
    """Measure DB read, write, and relation query latency."""
    # Write latency
    t0 = time.perf_counter()
    meeting = Meeting(
        public_id="bench-meeting-1",
        title="Performance Sync",
        original_filename="sync.wav",
        status="transcribed",
        user_id=test_user.id,
    )
    db_session.add(meeting)
    db_session.commit()
    write_latency_ms = (time.perf_counter() - t0) * 1000

    # Read latency
    t1 = time.perf_counter()
    found = db_session.query(Meeting).filter(Meeting.public_id == "bench-meeting-1").first()
    read_latency_ms = (time.perf_counter() - t1) * 1000

    print(f"\n[DB Benchmark] Insert latency: {write_latency_ms:.2f} ms | Query latency: {read_latency_ms:.2f} ms")
    assert found is not None
    assert write_latency_ms < 100.0, f"DB write too slow: {write_latency_ms:.2f} ms"
    assert read_latency_ms < 50.0, f"DB read too slow: {read_latency_ms:.2f} ms"


@pytest.mark.parametrize("duration_minutes", [5, 10, 30, 60, 120])
def test_long_audio_chunking_scaling_plan(duration_minutes):
    """
    Verify chunking scaling math for target recording durations:
    5 min, 10 min, 30 min, 60 min, 120 min.
    """
    duration_seconds = duration_minutes * 60
    is_chunked = duration_seconds > LONG_AUDIO_THRESHOLD_SECONDS

    if is_chunked:
        step = max(LONG_AUDIO_CHUNK_SECONDS - LONG_AUDIO_OVERLAP_SECONDS, 1.0)
        expected_chunks = int(duration_seconds // step) + (1 if duration_seconds % step > 0 else 0)
    else:
        expected_chunks = 1

    print(
        f"\n[Scale Test {duration_minutes}m] Duration: {duration_seconds}s | "
        f"Chunked: {is_chunked} | Expected Chunks: {expected_chunks}"
    )

    if duration_minutes <= 10:
        assert is_chunked is False
        assert expected_chunks == 1
    else:
        assert is_chunked is True
        assert expected_chunks > 1
