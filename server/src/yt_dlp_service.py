from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class AudioExtractionResult:
    source_url: str
    local_audio_path: str | None
    extractor: str
    warnings: list[str]
    debug: dict[str, Any]


def extract_audio_for_translation(page_url: str, video_url: str) -> AudioExtractionResult:
    """
    Scaffold hook for yt-dlp integration.

    Current behavior:
    - Validates inputs
    - Returns metadata/warnings only (no file extraction yet)
    - Keeps API stable so the extension can integrate now
    """
    source = (video_url or page_url or "").strip()
    if not source:
        raise ValueError("Missing pageUrl/videoUrl.")

    warnings: list[str] = []
    if not video_url:
        warnings.append("videoUrl missing; backend will rely on pageUrl for future yt-dlp extraction.")

    return AudioExtractionResult(
        source_url=source,
        local_audio_path=None,
        extractor="yt-dlp (scaffold placeholder)",
        warnings=warnings,
        debug={
            "page_url_present": bool(page_url),
            "video_url_present": bool(video_url),
        },
    )
