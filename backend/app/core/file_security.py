"""
file_security.py

Security helpers for file validation and path safety (Phase 16 - Production Security).

1. Magic Byte / MIME Validation:
   Inspects the initial bytes of uploaded files to ensure they genuinely match
   their claimed audio/video container format (preventing executable or polyglot uploads).
2. Safe Filename Sanitization:
   Strips control characters, directory separators, and path traversal sequences.
3. Path Traversal Guard:
   Guarantees that any path resolution stays strictly within its designated directory.
"""

import os
import re
from pathlib import Path
from typing import Optional


# Known magic byte signatures for supported audio/video formats
def validate_magic_bytes(header: bytes, extension: str) -> bool:
    """
    Validate that the file header begins with expected magic bytes for `extension`.

    Supported extensions: .mp3, .wav, .m4a, .mp4
    """
    if not header or len(header) < 4:
        return False

    ext = extension.lower()

    if ext == ".wav":
        # WAV files begin with 'RIFF' at offset 0 and 'WAVE' at offset 8
        if len(header) >= 12:
            return header[:4] == b"RIFF" and header[8:12] == b"WAVE"
        return header[:4] == b"RIFF"

    if ext == ".mp3":
        # MP3 files either start with ID3 metadata tag: 'ID3' (bytes [0x49, 0x44, 0x33])
        # or an MPEG frame sync word: 11 bits set (0xFF 0xFB, 0xFF 0xF3, 0xFF 0xF2, etc.)
        if header.startswith(b"ID3"):
            return True
        if len(header) >= 2 and header[0] == 0xFF and (header[1] & 0xE0) == 0xE0:
            return True
        return False

    if ext in {".m4a", ".mp4"}:
        # ISO Base Media File Format (MP4 / M4A) has 'ftyp' at offset 4
        if len(header) >= 8 and header[4:8] == b"ftyp":
            return True
        # Some raw AAC/ADTS files may start with 0xFF 0xF1 / 0xFF 0xF9
        if len(header) >= 2 and header[0] == 0xFF and (header[1] & 0xF6) == 0xF0:
            return True
        return False

    return False


def sanitize_filename(filename: Optional[str]) -> str:
    """
    Sanitize an uploaded filename to prevent directory traversal and injection.

    - Strips path components (removes directory separators `\\` and `/`)
    - Replaces unsafe characters with underscores
    - Preserves basic alphanumeric characters, periods, dashes, and underscores
    - Limits length to 200 characters
    """
    if not filename:
        return "unnamed_file"

    # Extract only the base name (handles both Windows and POSIX separators)
    clean = os.path.basename(filename.replace("\\", "/"))

    # Remove non-alphanumeric/safe characters
    clean = re.sub(r"[^\w\.\-\s]", "_", clean)

    # Collapse multiple spaces or dots
    clean = re.sub(r"\s+", " ", clean).strip()
    clean = re.sub(r"\.{2,}", ".", clean)  # prevent '..'

    # Ensure it's not empty and length is bounded
    if not clean or clean == ".":
        clean = "unnamed_file"

    return clean[:200]


def safe_path(base_dir: Path, target_filename: str) -> Path:
    """
    Resolve `target_filename` inside `base_dir` and verify it does not escape `base_dir`.

    Raises:
        ValueError: if path traversal is detected.
    """
    base_resolved = base_dir.resolve()
    target_resolved = (base_dir / target_filename).resolve()

    try:
        target_resolved.relative_to(base_resolved)
    except ValueError:
        raise ValueError(f"Path traversal detected for filename: {target_filename}")

    return target_resolved
