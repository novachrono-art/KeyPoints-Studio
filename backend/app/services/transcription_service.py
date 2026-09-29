"""
transcription_service.py

Converts a normalized WAV file (produced by audio_service in Phase 3)
into a text transcript with timestamped segments.

Following the project's service-abstraction principle: this module
defines an abstract TranscriptionService interface, plus one concrete
implementation (FasterWhisperService). A different provider (cloud
speech API, plain openai-whisper, etc.) can be added later as another
class implementing the same interface - callers never need to change,
only the factory function at the bottom does.
"""

import logging
from abc import ABC, abstractmethod
from functools import lru_cache
from pathlib import Path
from typing import Callable, List, Optional, TypedDict

try:
    # Python 3.11+ built-in; gracefully degrade on older runtimes.
    from typing import NotRequired
except ImportError:
    from typing_extensions import NotRequired

logger = logging.getLogger(__name__)

from app.core.config import (
    LONG_AUDIO_CHUNK_SECONDS,
    LONG_AUDIO_OVERLAP_SECONDS,
    LONG_AUDIO_THRESHOLD_SECONDS,
    WHISPER_LANGUAGE,
    WHISPER_MODEL_SIZE,
)
from app.services import audio_service


class TranscriptSegment(TypedDict, total=False):
    """
    One timestamped span of speech from a transcription provider.

    ``start``, ``end``, and ``text`` are always present.
    ``speaker`` is only present when diarization has been applied
    (Phase 14); callers must treat it as optional.
    """
    start: float
    end: float
    text: str
    speaker: str  # Optional — only present when has_diarization is True


class TranscriptResult(TypedDict, total=False):
    """
    Complete transcription result from any TranscriptionService implementation.

    ``text``, ``segments``, ``detected_language``, and ``language_confidence``
    are always populated by every provider.
    ``has_diarization`` is only set to True after apply_diarization() has run
    and speaker labels have been added to each segment (Phase 14).
    """
    text: str
    segments: List[TranscriptSegment]
    detected_language: str
    language_confidence: float
    has_diarization: bool  # Optional — defaults to False when absent


def merge_chunk_segments(
    chunk_segments: List[List[TranscriptSegment]],
    chunk_offsets: List[float],
    overlap_seconds: float,
) -> List[TranscriptSegment]:
    """
    Combine per-chunk transcript segments into one chronological list
    (Phase 11 long audio).

    Each chunk's segment timestamps are offset to their absolute time in
    the original recording. Because consecutive chunks overlap by
    ``overlap_seconds``, segments that fall inside the overlapping region
    at the start of every chunk after the first are dropped - the previous
    chunk already captured that audio - so words aren't duplicated.

    This is a pure function (no I/O, no model), so it is unit-testable in
    isolation.
    """
    merged: List[TranscriptSegment] = []

    for segments, offset in zip(chunk_segments, chunk_offsets):
        for segment in segments:
            start = segment["start"] + offset
            end = segment["end"] + offset

            # Skip the overlap region at the start of every chunk except
            # the first (offset == 0).
            if offset > 0 and start < offset + overlap_seconds:
                continue

            merged.append(
                {
                    "start": round(start, 2),
                    "end": round(end, 2),
                    "text": segment["text"],
                }
            )

    # Chunks are processed in order, so this should already be sorted,
    # but sort defensively so the merged result is always chronological.
    merged.sort(key=lambda s: s["start"])
    return merged


class TranscriptionService(ABC):
    """Abstract interface every transcription provider must implement."""

    @abstractmethod
    def transcribe(
        self,
        audio_path: Path,
        language: Optional[str] = None,
        progress_callback: Optional[Callable[[int, int], None]] = None,
    ) -> TranscriptResult:
        """
        Transcribe an audio file.

        Args:
            audio_path: path to the WAV file to transcribe.
            language: optional ISO 639-1 language code (e.g. "hi",
                "en") to force. If None, falls back to
                WHISPER_LANGUAGE in config.py, and if that is also
                None, the provider auto-detects the language.
            progress_callback: optional (current, total) callback invoked
                as transcription progresses (e.g. once per chunk), so
                callers can report honest progress to the user.

        Returns a dict with:
          - "text": the full transcript as one string
          - "segments": a list of {start, end, text} dicts with
            timestamps in seconds
          - "detected_language": the language code Whisper used
          - "language_confidence": 0.0-1.0, how confident Whisper
            was in that language detection (useful for diagnosing
            garbled transcripts - low confidence is a red flag)
        """
        raise NotImplementedError


class FasterWhisperService(TranscriptionService):
    """
    Transcription using faster-whisper, running on CPU.

    Chosen over plain openai-whisper specifically because this
    project's target machine (Intel i3, no guaranteed GPU) needs
    CPU-efficient inference. faster-whisper uses the CTranslate2
    engine under the hood and is noticeably faster on CPU while
    producing comparable transcript quality.
    """

    def __init__(self, model_size: str = WHISPER_MODEL_SIZE):
        # Imported here rather than at the top of the file, so that
        # simply importing transcription_service.py doesn't force
        # faster-whisper's (fairly heavy) import machinery to load
        # unless a FasterWhisperService is actually created.
        from faster_whisper import WhisperModel

        # compute_type="int8" trades a small amount of numerical
        # precision for a meaningful CPU speed improvement - a
        # sensible default with no GPU available.
        self._model = WhisperModel(model_size, device="cpu", compute_type="int8")

    def transcribe(
        self,
        audio_path: Path,
        language: Optional[str] = None,
        progress_callback: Optional[Callable[[int, int], None]] = None,
    ) -> TranscriptResult:
        # Fall back to the config default if no explicit override was
        # given. Both can still be None, which means "auto-detect".
        effective_language = language if language is not None else WHISPER_LANGUAGE

        # Phase 11 (Long Audio): recordings longer than the threshold are
        # split into fixed-duration chunks, transcribed per chunk (each of
        # which is a natural progress unit), and merged back together.
        duration = audio_service.get_audio_duration(audio_path)

        if duration > LONG_AUDIO_THRESHOLD_SECONDS:
            return self._transcribe_in_chunks(
                audio_path,
                effective_language,
                progress_callback,
            )

        # Short audio: single pass, same behavior as before Phase 11.
        if progress_callback:
            progress_callback(1, 1)

        return self._transcribe_single(audio_path, effective_language)

    def _transcribe_single(self, audio_path: Path, language: Optional[str]) -> TranscriptResult:
        """Transcribe one file in a single pass and return a TranscriptResult."""
        segments_iter, info = self._model.transcribe(str(audio_path), language=language)

        segments: List[TranscriptSegment] = []
        text_parts: List[str] = []

        for segment in segments_iter:
            text = segment.text.strip()
            segments.append(
                {
                    "start": round(segment.start, 2),
                    "end": round(segment.end, 2),
                    "text": text,
                }
            )
            text_parts.append(text)

        return {
            "text": " ".join(text_parts).strip(),
            "segments": segments,
            "detected_language": info.language,
            "language_confidence": round(info.language_probability, 3),
        }

    def _transcribe_in_chunks(
        self,
        audio_path: Path,
        language: Optional[str],
        progress_callback: Optional[Callable[[int, int], None]],
    ) -> TranscriptResult:
        """
        Split a long recording into chunks and merge the per-chunk results.

        Chunks are transcribed in order; each invocation of
        ``progress_callback(current, total)`` reflects real completed
        chunks so the reported progress is honest, never fabricated.
        """
        chunks = audio_service.split_audio(
            audio_path,
            LONG_AUDIO_CHUNK_SECONDS,
            LONG_AUDIO_OVERLAP_SECONDS,
        )
        total = len(chunks)

        chunk_segments: List[List[TranscriptSegment]] = []
        chunk_offsets: List[float] = []
        detected_language: Optional[str] = None
        confidence_sum = 0.0

        try:
            for index, (chunk_path, start_offset) in enumerate(chunks, start=1):
                if progress_callback:
                    progress_callback(index, total)

                result = self._transcribe_single(chunk_path, language)

                chunk_segments.append(result["segments"])
                chunk_offsets.append(start_offset)

                if detected_language is None:
                    detected_language = result["detected_language"]
                confidence_sum += result["language_confidence"]
        finally:
            # Chunk files are intermediates - remove them once we no
            # longer need them so storage doesn't fill up with copies.
            for chunk_path, _ in chunks:
                chunk_path.unlink(missing_ok=True)

        merged = merge_chunk_segments(
            chunk_segments,
            chunk_offsets,
            LONG_AUDIO_OVERLAP_SECONDS,
        )

        return {
            "text": " ".join(s["text"] for s in merged).strip(),
            "segments": merged,
            "detected_language": detected_language or "unknown",
            "language_confidence": round(confidence_sum / total, 3),
        }


@lru_cache(maxsize=1)
def get_transcription_service() -> TranscriptionService:
    """
    Returns the currently active transcription provider.

    Callers should always go through this function instead of
    instantiating FasterWhisperService directly - that way, switching
    providers later (e.g. to a cloud API) means changing this one
    function, not every place transcription is used.

    Cached with lru_cache so the (fairly large) Whisper model is only
    loaded into memory once per running process, not on every single
    API request - loading it repeatedly would add several seconds of
    delay to every transcription call.
    """
    return FasterWhisperService()


# ---------------------------------------------------------------------------
# Phase 14 — Speaker Diarization integration
# ---------------------------------------------------------------------------

def apply_diarization(
    result: TranscriptResult,
    wav_path: Path,
    num_speakers: Optional[int] = None,
) -> TranscriptResult:
    """
    Assign speaker labels to each segment in ``result`` and reformat the
    transcript text so the LLM receives "Speaker N: sentence" lines.

    This is a pure post-processing step: it never re-runs Whisper.  When
    DIARIZATION_ENABLED is False, get_diarization_service() returns a
    NoDiarizationService that immediately returns [], so this function
    returns the original result completely unchanged — no cost, no risk.

    On any error (import failure, audio read error, clustering failure),
    a warning is logged and the original result is returned unchanged so
    the transcription is never broken by an optional feature.

    Args:
        result:       TranscriptResult from the transcription service.
        wav_path:     Path to the 16kHz mono WAV file (same one Whisper used).
        num_speakers: Optional forced speaker count.  If None, auto-detected.

    Returns:
        The same result dict, potentially enriched with:
          - ``speaker`` key on every segment
          - reformatted ``text`` with "Speaker N: ..." lines
          - ``has_diarization: True``
        Or the original result unchanged if diarization was disabled/failed.
    """
    # Lazy import so the server never loads diarization_service unless this
    # function is actually called.
    from app.services.diarization_service import DiarizationError, get_diarization_service

    try:
        service = get_diarization_service()
        speaker_segments = service.diarize(
            wav_path,
            result["segments"],
            num_speakers=num_speakers,
        )
    except DiarizationError as exc:
        logger.warning(
            "Diarization failed (%s) — returning plain transcript.", exc
        )
        return result
    except Exception as exc:  # pragma: no cover
        logger.warning(
            "Unexpected diarization error (%r) — returning plain transcript.", exc
        )
        return result

    if not speaker_segments:
        # NoDiarizationService or empty — no-op.
        return result

    # --- Attach speaker label to each segment ----------------------------
    labeled_segments: List[TranscriptSegment] = []
    for seg, spk in zip(result["segments"], speaker_segments):
        labeled: TranscriptSegment = {**seg, "speaker": spk.speaker}  # type: ignore[misc]
        labeled_segments.append(labeled)

    # --- Reformat the full transcript text for the LLM -------------------
    # Format: "Speaker N: sentence" on each line so the LLM can attribute
    # decisions and action items to specific participants.
    lines: List[str] = []
    for seg in labeled_segments:
        text = seg.get("text", "").strip()  # type: ignore[union-attr]
        if text:
            speaker = seg.get("speaker", "Speaker 1")  # type: ignore[union-attr]
            lines.append(f"{speaker}: {text}")

    formatted_text = "\n".join(lines)

    return {
        **result,
        "segments": labeled_segments,
        "text": formatted_text,
        "has_diarization": True,
    }