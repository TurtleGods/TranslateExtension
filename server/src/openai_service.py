from __future__ import annotations

from typing import Any

from .config import settings
from .models import SubtitleCue


def _mock_chinese_cues(target_language: str) -> list[SubtitleCue]:
    lang = (target_language or "zh").strip() or "zh"
    text1 = "這是字幕原型。後端已收到影片請求，下一步會接上 yt-dlp 與 OpenAI。"
    text2 = "目前是測試字幕，用來驗證 Chrome 擴充功能的掃描、選取與字幕顯示流程。"
    if not lang.startswith("zh"):
        text1 = f"[{lang}] Subtitle prototype: backend request received."
        text2 = f"[{lang}] Mock subtitles are enabled for end-to-end UI testing."
    return [
        SubtitleCue(start=0.5, end=4.8, text=text1, lang=lang),
        SubtitleCue(start=5.1, end=11.5, text=text2, lang=lang),
    ]


def translate_audio_to_timed_text(
    *,
    target_language: str,
    extracted_audio_path: str | None,
    source_url: str,
) -> tuple[list[SubtitleCue], list[str], dict[str, Any]]:
    """
    Scaffold for OpenAI timed-text generation.

    Current behavior:
    - Returns mock subtitle cues by default (ENABLE_MOCK_SUBTITLES=true)
    - Returns a helpful warning when real integration is not yet implemented
    """
    warnings: list[str] = []
    debug: dict[str, Any] = {
        "source_url": source_url,
        "has_local_audio": bool(extracted_audio_path),
        "mock_enabled": settings.enable_mock_subtitles,
        "configured_model": settings.openai_model,
        "has_openai_key": bool(settings.openai_api_key),
    }

    if settings.enable_mock_subtitles:
        warnings.append("Mock subtitles enabled; no real yt-dlp audio extraction or OpenAI call was made.")
        return _mock_chinese_cues(target_language), warnings, debug

    warnings.append("Real OpenAI timed-text integration is not implemented yet in this scaffold.")
    return [], warnings, debug

