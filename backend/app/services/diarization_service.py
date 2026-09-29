"""
diarization_service.py

Phase 14 — Speaker Diarization.

Identifies which speaker is talking during each segment of a meeting
transcript. Each Whisper segment is assigned a stable "Speaker N" label,
where Speaker 1 is always the person who speaks first.

Algorithm:
    1. For every transcript segment (start/end timestamps from Whisper),
       slice the corresponding audio window from the normalized WAV.
    2. Compute a 40-dim log-mel spectrogram mean — a compact speaker
       fingerprint — using only numpy (no torch, no external models).
    3. Normalize embeddings with StandardScaler.
    4. Cluster with AgglomerativeClustering (ward linkage):
         - Fixed n_clusters if the caller specifies num_speakers.
         - Auto-detect via distance_threshold otherwise, clamped to
           DIARIZATION_MAX_SPEAKERS.
    5. Map integer cluster IDs to stable "Speaker N" strings, sorted by
       first occurrence so the ordering is deterministic.

Dependencies (all CPU-only, no GPU, no HuggingFace token):
    - soundfile   — already a faster-whisper transitive dependency
    - numpy       — already present everywhere
    - scikit-learn — added to requirements.txt in Phase 14
    - scipy       — added to requirements.txt in Phase 14 (used by sklearn)

Design follows the project's service-abstraction principle:
    - Abstract DiarizationService interface
    - MFCCDiarizationService: real implementation (used when DIARIZATION_ENABLED=true)
    - NoDiarizationService:   no-op fallback (used by default)
    - get_diarization_service(): factory — callers never instantiate directly

When DIARIZATION_ENABLED is False (the default), the factory returns
NoDiarizationService, which returns an empty list instantly.  The
transcription pipeline then behaves identically to Phase 13.
"""

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional

import numpy as np

from app.core.config import (
    DIARIZATION_DISTANCE_THRESHOLD,
    DIARIZATION_ENABLED,
    DIARIZATION_MAX_SPEAKERS,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Public data types
# ---------------------------------------------------------------------------

class DiarizationError(Exception):
    """Raised when speaker diarization cannot be completed."""


@dataclass
class SpeakerSegment:
    """
    One contiguous audio span attributed to a single speaker.

    ``start`` and ``end`` match the corresponding Whisper segment
    boundaries (seconds from the start of the recording).
    ``speaker`` is a stable human-readable label such as "Speaker 1".
    """
    start: float
    end: float
    speaker: str


# ---------------------------------------------------------------------------
# Abstract interface
# ---------------------------------------------------------------------------

class DiarizationService(ABC):
    """Abstract interface every diarization implementation must satisfy."""

    @abstractmethod
    def diarize(
        self,
        audio_path: Path,
        segments: List[dict],
        num_speakers: Optional[int] = None,
    ) -> List[SpeakerSegment]:
        """
        Assign a speaker label to each transcript segment.

        Args:
            audio_path:   Path to the normalized 16kHz mono WAV file produced
                          by audio_service.convert_to_wav().
            segments:     List of {start, end, text} dicts from Whisper.
                          These define the time windows to analyze.
            num_speakers: If given, force exactly this many speaker clusters.
                          If None, auto-detect (up to DIARIZATION_MAX_SPEAKERS).

        Returns:
            A list of SpeakerSegment — same length as ``segments`` — with a
            stable "Speaker N" label for each.  Returns an empty list when
            there is nothing to diarize (e.g. NoDiarizationService).
        """
        raise NotImplementedError


# ---------------------------------------------------------------------------
# No-op implementation (default when DIARIZATION_ENABLED = false)
# ---------------------------------------------------------------------------

class NoDiarizationService(DiarizationService):
    """
    Passthrough implementation used when DIARIZATION_ENABLED is False.

    Returns an empty list instantly so the transcription pipeline continues
    exactly as it did before Phase 14, with no behavioral change whatsoever.
    """

    def diarize(self, audio_path, segments, num_speakers=None) -> List[SpeakerSegment]:
        return []


# ---------------------------------------------------------------------------
# MFCC-based implementation
# ---------------------------------------------------------------------------

class MFCCDiarizationService(DiarizationService):
    """
    Speaker diarization via log-mel feature extraction + agglomerative
    clustering.  Runs entirely on CPU without any external AI model files.

    Feature extraction:
        Each Whisper segment is turned into a 40-dimensional vector by:
          1. Pre-emphasis filtering (boosts high-frequency detail).
          2. Framing into 25 ms windows with a 10 ms hop.
          3. Hann windowing to reduce spectral leakage.
          4. 512-point FFT → power spectrum.
          5. 40-band mel filterbank (80 Hz – 8 kHz).
          6. Log compression.
          7. Mean across all frames → one 40-dim embedding per segment.

    Clustering:
        - Embeddings are L2-normalized with StandardScaler.
        - AgglomerativeClustering (ward linkage) groups them into speaker
          clusters either by a fixed count (if num_speakers is supplied) or
          automatically via distance_threshold (clamped to MAX_SPEAKERS).
        - Cluster IDs are remapped to stable "Speaker N" strings ordered by
          first appearance so that Speaker 1 always speaks first.
    """

    # Mel filterbank / FFT parameters
    _N_MELS = 40
    _N_FFT = 512
    _FRAME_LENGTH_S = 0.025   # 25 ms
    _HOP_LENGTH_S = 0.010     # 10 ms
    _F_MIN = 80.0             # Hz
    _F_MAX = 8000.0           # Hz (Nyquist for 16 kHz audio)
    _PRE_EMPHASIS = 0.97

    # Minimum clip length (seconds) we bother embedding.
    # Segments shorter than this are assigned the previous speaker's label.
    _MIN_CLIP_SECONDS = 0.3

    def __init__(self):
        # Defer heavy imports to constructor so simply importing this module
        # at server startup (when DIARIZATION_ENABLED is False) is free.
        try:
            from sklearn.cluster import AgglomerativeClustering
            from sklearn.preprocessing import StandardScaler
        except ImportError as exc:
            raise DiarizationError(
                "scikit-learn is required for speaker diarization. "
                "Run: pip install scikit-learn"
            ) from exc

        try:
            import soundfile as sf  # noqa: F401
        except ImportError as exc:
            raise DiarizationError(
                "soundfile is required for speaker diarization. "
                "Run: pip install soundfile"
            ) from exc

        self._AgglomerativeClustering = AgglomerativeClustering
        self._StandardScaler = StandardScaler

    # ------------------------------------------------------------------
    # Public method
    # ------------------------------------------------------------------

    def diarize(
        self,
        audio_path: Path,
        segments: List[dict],
        num_speakers: Optional[int] = None,
    ) -> List[SpeakerSegment]:
        if not segments:
            return []

        import soundfile as sf

        # Load the full audio once and slice per segment below.
        try:
            audio, sr = sf.read(str(audio_path), dtype="float32")
        except Exception as exc:
            raise DiarizationError(f"Cannot read audio file: {exc}") from exc

        # Flatten to mono (should already be mono from FFmpeg normalization,
        # but guard against edge cases).
        if audio.ndim > 1:
            audio = audio[:, 0]

        # Build the mel filterbank once; it only depends on sr which is
        # constant for a given file.
        filterbank = self._build_mel_filterbank(sr)

        # Extract one embedding vector per segment.
        embeddings: list = []
        valid_indices: list = []

        for i, seg in enumerate(segments):
            start_s = int(seg["start"] * sr)
            end_s = int(seg["end"] * sr)
            clip = audio[start_s:end_s]

            if len(clip) < int(self._MIN_CLIP_SECONDS * sr):
                # Too short to embed reliably — mark as needing a fill-in.
                embeddings.append(None)
                continue

            emb = self._embed(clip, sr, filterbank)
            embeddings.append(emb)
            valid_indices.append(i)

        if not valid_indices:
            # Every segment was too short — label them all Speaker 1.
            return [
                SpeakerSegment(start=s["start"], end=s["end"], speaker="Speaker 1")
                for s in segments
            ]

        # Stack valid embeddings and cluster them.
        X = np.stack([embeddings[i] for i in valid_indices])
        labels = self._cluster(X, num_speakers)

        # Map cluster IDs → stable "Speaker N" strings (first-occurrence order).
        label_map: dict = {}
        counter = 1
        stable_labels: list = []
        for lab in labels:
            if lab not in label_map:
                label_map[lab] = f"Speaker {counter}"
                counter += 1
            stable_labels.append(label_map[lab])

        # Build the result list for ALL segments, including the short ones.
        result: list = [None] * len(segments)
        for order, seg_idx in enumerate(valid_indices):
            seg = segments[seg_idx]
            result[seg_idx] = SpeakerSegment(
                start=seg["start"],
                end=seg["end"],
                speaker=stable_labels[order],
            )

        # Fill gaps (short segments): use the nearest preceding speaker, or
        # fall forward to the next valid speaker if leading gaps exist.
        fallback = "Speaker 1"
        for i in range(len(result)):
            if result[i] is None:
                result[i] = SpeakerSegment(
                    start=segments[i]["start"],
                    end=segments[i]["end"],
                    speaker=fallback,
                )
            else:
                fallback = result[i].speaker

        return result

    # ------------------------------------------------------------------
    # Feature extraction helpers
    # ------------------------------------------------------------------

    def _embed(
        self,
        clip: np.ndarray,
        sr: int,
        filterbank: np.ndarray,
    ) -> np.ndarray:
        """
        Compute a 40-dim log-mel spectrogram mean for one audio clip.

        This is a lightweight, self-contained MFCC-adjacent embedding that
        captures the spectral shape of a speaker's voice.  Using the mean
        over time gives us a fixed-size vector regardless of segment length.
        """
        # Pre-emphasis: boosts high frequencies so spectral features don't
        # get swamped by the low-frequency energy that varies a lot with
        # recording level, reducing sensitivity to volume differences.
        clip = np.concatenate([[clip[0]], clip[1:] - self._PRE_EMPHASIS * clip[:-1]])

        frame_len = int(self._FRAME_LENGTH_S * sr)
        hop_len = int(self._HOP_LENGTH_S * sr)

        # Collect overlapping frames.
        starts = range(0, len(clip) - frame_len + 1, hop_len)
        if not starts:
            return np.zeros(self._N_MELS)

        frames = np.stack([clip[s: s + frame_len] for s in starts])

        # Hann window reduces spectral leakage at frame boundaries.
        frames = frames * np.hanning(frame_len)

        # Power spectrum via FFT.
        power = np.abs(np.fft.rfft(frames, n=self._N_FFT)) ** 2 / self._N_FFT

        # Apply mel filterbank and take log.
        mel = np.dot(power, filterbank.T)
        log_mel = np.log(mel + 1e-10)

        # Mean across time → compact speaker fingerprint.
        return np.mean(log_mel, axis=0)

    def _build_mel_filterbank(self, sr: int) -> np.ndarray:
        """
        Build a (N_MELS × (N_FFT//2+1)) triangular mel filterbank matrix.

        Each row is one mel-spaced triangular filter that spans a range of
        FFT bins.  Multiplying a power spectrum by this matrix projects it
        into the mel domain, which approximates human auditory perception.
        """
        def hz_to_mel(hz: float) -> float:
            return 2595.0 * np.log10(1.0 + hz / 700.0)

        def mel_to_hz(mel: float) -> float:
            return 700.0 * (10.0 ** (mel / 2595.0) - 1.0)

        f_max = min(self._F_MAX, sr / 2.0)
        mel_min = hz_to_mel(self._F_MIN)
        mel_max = hz_to_mel(f_max)

        # N_MELS + 2 evenly-spaced points in mel-space → convert to Hz → FFT bins.
        mel_pts = np.linspace(mel_min, mel_max, self._N_MELS + 2)
        hz_pts = np.array([mel_to_hz(m) for m in mel_pts])
        bins = np.floor((self._N_FFT + 1) * hz_pts / sr).astype(int)
        bins = np.clip(bins, 0, self._N_FFT // 2)

        fbank = np.zeros((self._N_MELS, self._N_FFT // 2 + 1))
        for m in range(1, self._N_MELS + 1):
            lo, mid, hi = bins[m - 1], bins[m], bins[m + 1]
            if mid > lo:
                fbank[m - 1, lo:mid] = (np.arange(lo, mid) - lo) / (mid - lo)
            if hi > mid:
                fbank[m - 1, mid:hi] = (hi - np.arange(mid, hi)) / (hi - mid)

        return fbank

    # ------------------------------------------------------------------
    # Clustering helper
    # ------------------------------------------------------------------

    def _cluster(self, X: np.ndarray, num_speakers: Optional[int]) -> np.ndarray:
        """
        Cluster embedding vectors and return an integer label per row.

        Uses ward linkage (minimises within-cluster variance) which tends
        to produce compact, equal-sized clusters — a reasonable assumption
        for meeting speakers who each talk for a similar total duration.
        """
        n = len(X)

        # Normalize features so no single dimension dominates.
        scaler = self._StandardScaler()
        X_scaled = scaler.fit_transform(X)

        # Trivial cases — no clustering needed.
        if n == 1:
            return np.array([0])

        if num_speakers is not None:
            # Caller explicitly requested a fixed number of speakers.
            k = max(1, min(num_speakers, n))
            return self._AgglomerativeClustering(
                n_clusters=k, linkage="ward"
            ).fit_predict(X_scaled)

        # Auto-detect: use distance_threshold to let the algorithm find its
        # own cut-off, then clamp to MAX_SPEAKERS if it went too high.
        max_k = min(DIARIZATION_MAX_SPEAKERS, n)
        labels = self._AgglomerativeClustering(
            n_clusters=None,
            distance_threshold=DIARIZATION_DISTANCE_THRESHOLD,
            linkage="ward",
        ).fit_predict(X_scaled)

        n_detected = len(np.unique(labels))
        if n_detected > max_k:
            # Too many clusters — re-run with the hard cap.
            logger.debug(
                "Diarization auto-detected %d speakers; clamping to %d.",
                n_detected,
                max_k,
            )
            labels = self._AgglomerativeClustering(
                n_clusters=max_k, linkage="ward"
            ).fit_predict(X_scaled)

        return labels


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------

def get_diarization_service() -> DiarizationService:
    """
    Return the active diarization implementation.

    When DIARIZATION_ENABLED is False (the default), returns NoDiarizationService
    so the transcription pipeline is completely unchanged from Phase 13.

    Callers must always use this factory rather than instantiating either
    concrete class directly, so that enabling or disabling diarization is a
    one-line change in backend/.env, not a code change.
    """
    if DIARIZATION_ENABLED:
        logger.debug("Diarization enabled — using MFCCDiarizationService.")
        return MFCCDiarizationService()
    return NoDiarizationService()
