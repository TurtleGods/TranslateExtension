from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


load_dotenv(Path(__file__).resolve().parent.parent / ".env")


def _get_bool(value: str | None, fallback: bool = False) -> bool:
  if value is None:
    return fallback

  normalized = value.strip().lower()
  if normalized in {"1", "true", "yes", "on"}:
    return True
  if normalized in {"0", "false", "no", "off"}:
    return False
  return fallback


@dataclass(frozen=True)
class ModelConfig:
  audio_transcribe: str
  audio_translate: str
  text_translate: str


@dataclass(frozen=True)
class AppConfig:
  port: int
  openai_api_key: str
  models: ModelConfig
  enable_text_segment_translation: bool


config = AppConfig(
  port=int(os.getenv("PORT", "8787")),
  openai_api_key=os.getenv("OPENAI_API_KEY", ""),
  models=ModelConfig(
    audio_transcribe=os.getenv("OPENAI_AUDIO_TRANSCRIBE_MODEL", "whisper-1"),
    audio_translate=os.getenv("OPENAI_AUDIO_TRANSLATE_MODEL", "whisper-1"),
    text_translate=os.getenv("OPENAI_TEXT_TRANSLATE_MODEL", "gpt-4o-mini"),
  ),
  enable_text_segment_translation=_get_bool(
    os.getenv("ENABLE_TEXT_SEGMENT_TRANSLATION"),
    False,
  ),
)
