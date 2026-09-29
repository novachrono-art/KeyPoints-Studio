"""
audio_service.py

Handles converting an uploaded recording (mp3/wav/m4a/mp4) into a
normalized WAV file that Whisper (Phase 4) can reliably transcribe.

Normalization target: 16kHz sample rate, mono channel, 16-bit PCM.
This is the format Whisper is trained to expect, and using one
consistent format means later phases don't need to special-case
different input file types.

This module talks to FFmpeg directly via subprocess, rather than
through the ffmpeg-python wrapper library, so we get FFmpeg's raw
error output when something goes wrong (see Documentation.txt for
the reasoning).
"""

import shutil
import subprocess
from pathlib import Path

from app.core.config import PROCESSED_DIR


class AudioProcessingError(Exception):
    """Raised when audio conversion fails for any reason."""


def check_ffmpeg_installed() -> bool:
    """
    Check whether the FFmpeg executable is available on the system PATH.

    Important: installing the Python package `ffmpeg-python` does NOT
    install FFmpeg itself. FFmpeg is a separate program that must be
    installed on the operating system. This function is how we detect
    that early and fail with a clear message instead of a confusing
    crash deep inside subprocess.
    """
    return shutil.which("ffmpeg") is not None


def convert_to_wav(meeting_id: str, input_path: Path) -> Path:
    """
    Convert an uploaded audio/video file into a normalized WAV file.

    Args:
        meeting_id: The UUID generated during upload (Phase 2).
                    Used to name the output file consistently.
        input_path: Path to the original uploaded file
                    (e.g. backend/storage/uploads/{meeting_id}.mp3)

    Returns:
        Path to the resulting WAV file in backend/storage/processed/

    Raises:
        AudioProcessingError: if FFmpeg is missing, the input file
        doesn't exist, or the conversion fails for any reason.
    """
    if not input_path.exists():
        raise AudioProcessingError(f"Input file not found: {input_path}")

    if not check_ffmpeg_installed():
        raise AudioProcessingError(
            "FFmpeg is not installed or not on your system PATH. "
            "Install it from https://ffmpeg.org/download.html "
            "(on Windows, the easiest way is: winget install Gyan.FFmpeg), "
            "then restart your terminal and try again."
        )

    output_path = PROCESSED_DIR / f"{meeting_id}.wav"

    # -y            overwrite output file if it already exists
    # -i             input file
    # -ar 16000      resample audio to 16kHz (what Whisper expects)
    # -ac 1          downmix to mono (1 audio channel)
    # -c:a pcm_s16le encode as 16-bit PCM (uncompressed, widely supported)
    command = [
        "ffmpeg",
        "-y",
        "-i", str(input_path),
        "-ar", "16000",
        "-ac", "1",
        "-c:a", "pcm_s16le",
        str(output_path),
    ]

    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
    )

    if result.returncode != 0:
        # FFmpeg writes its errors to stderr. We only show the last
        # part of it - FFmpeg's output can be long and mostly noise,
        # the actual error is almost always near the end.
        error_tail = result.stderr.strip().splitlines()[-5:]
        raise AudioProcessingError(
            "FFmpeg failed to convert this file. "
            "It may be corrupted or contain no audio. "
            "Details: " + " | ".join(error_tail)
        )

    if not output_path.exists() or output_path.stat().st_size == 0:
        raise AudioProcessingError(
            "FFmpeg reported success but produced no output file. "
            "Please check that the source file actually contains audio."
        )

    return output_path


def get_audio_duration(input_path: Path) -> float:
    """
    Return the duration (in seconds) of an audio/video file using ffprobe.

    Used by Phase 11 long-audio handling to decide whether a recording is
    long enough to benefit from chunked transcription.

    Raises:
        AudioProcessingError: if ffprobe is missing, the file doesn't
        exist, or the duration cannot be read/parsed.
    """
    if not input_path.exists():
        raise AudioProcessingError(f"Input file not found: {input_path}")

    if shutil.which("ffprobe") is None:
        raise AudioProcessingError(
            "FFprobe is not installed or not on your system PATH. "
            "It ships with FFmpeg - install it from https://ffmpeg.org/download.html "
            "(on Windows: winget install Gyan.FFmpeg), then restart your terminal."
        )

    result = subprocess.run(
        [
            "ffprobe",
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(input_path),
        ],
        capture_output=True,
        text=True,
    )

    if result.returncode != 0:
        raise AudioProcessingError(
            "Unable to read this file's duration. It may be corrupted."
        )

    try:
        return float(result.stdout.strip())
    except ValueError:
        raise AudioProcessingError(
            "Unable to parse this file's duration."
        )


def split_audio(
    input_path: Path,
    chunk_seconds: float,
    overlap_seconds: float = 0.0,
) -> list:
    """
    Split a WAV file into fixed-duration chunk WAVs (Phase 11 long audio).

    Each chunk after the first begins ``overlap_seconds`` before where the
    previous one ended, so a word that straddles a boundary is not clipped
    mid-word. The transcription service then merges the per-chunk results
    back together, de-duplicating the overlapping regions.

    Args:
        input_path: The normalized WAV to split (16kHz mono PCM).
        chunk_seconds: Target duration of each chunk.
        overlap_seconds: Seconds of audio to repeat at the start of each
            subsequent chunk (so boundaries are seen in context).

    Returns:
        A list of ``(chunk_path, start_offset)`` tuples. ``start_offset``
        is the absolute time in the original file that the chunk begins at.

    Raises:
        AudioProcessingError: if the file can't be read or a chunk fails.
    """
    duration = get_audio_duration(input_path)

    # Effective stride between chunk start times: chunk length minus the
    # overlap we re-record. Never let this collapse to zero.
    step = max(chunk_seconds - overlap_seconds, 1.0)

    chunks: list = []
    start = 0.0
    index = 1

    while start < duration - 1e-6:
        chunk_duration = min(chunk_seconds, duration - start)

        output_path = PROCESSED_DIR / f"{input_path.stem}_chunk_{index:03d}.wav"

        # -ss before -i does fast (accurate for WAV PCM) seeking, so each
        # chunk begins at the right absolute offset.
        command = [
            "ffmpeg",
            "-y",
            "-ss", f"{start:.3f}",
            "-i", str(input_path),
            "-t", f"{chunk_duration:.3f}",
            "-ar", "16000",
            "-ac", "1",
            "-c:a", "pcm_s16le",
            str(output_path),
        ]

        result = subprocess.run(command, capture_output=True, text=True)

        if result.returncode != 0:
            error_tail = result.stderr.strip().splitlines()[-5:]
            raise AudioProcessingError(
                "FFmpeg failed to split this file into chunks. Details: "
                + " | ".join(error_tail)
            )

        chunks.append((output_path, start))

        start += step
        index += 1

    if not chunks:
        raise AudioProcessingError("No audio chunks could be created from this file.")

    return chunks
