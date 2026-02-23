from __future__ import annotations

import io
import json
from typing import Any

from openai import OpenAI

from .config import config


_client: OpenAI | None = None


def _get_client() -> OpenAI:
  global _client

  if not config.openai_api_key:
    raise RuntimeError("OPENAI_API_KEY is not configured in server/.env")

  if _client is None:
    _client = OpenAI(api_key=config.openai_api_key)

  return _client


def _read_field(obj: Any, field: str, default: Any = None) -> Any:
  if isinstance(obj, dict):
    return obj.get(field, default)
  return getattr(obj, field, default)


def _normalize_segments(verbose_result: Any) -> list[dict[str, Any]]:
  raw_segments = _read_field(verbose_result, "segments", []) or []

  if raw_segments:
    normalized: list[dict[str, Any]] = []
    for index, segment in enumerate(raw_segments):
      normalized.append(
        {
          "index": index,
          "start": float(_read_field(segment, "start", 0) or 0),
          "end": float(_read_field(segment, "end", 0) or 0),
          "text": str(_read_field(segment, "text", "") or "").strip(),
        }
      )
    return normalized

  text = str(_read_field(verbose_result, "text", "") or "").strip()
  if not text:
    return []

  return [{"index": 0, "start": 0, "end": 0, "text": text}]


def _translate_segments_with_text_model(
  segments: list[dict[str, Any]],
  target_language: str,
) -> dict[str, Any]:
  if (
    not config.enable_text_segment_translation
    or not target_language
    or len(segments) == 0
  ):
    return {
      "enabled": False,
      "reason": "Text segment translation disabled or no targetLanguage provided.",
    }

  client = _get_client()
  input_segments = [segment["text"] for segment in segments]

  prompt = " ".join(
    [
      "Translate each item in the JSON array into the requested target language.",
      "Keep the same array length and order.",
      'Return JSON only with shape: {"translations": ["..."]}.',
      f"Target language: {target_language}",
    ]
  )

  completion = client.chat.completions.create(
    model=config.models.text_translate,
    response_format={"type": "json_object"},
    messages=[
      {"role": "system", "content": "You are a precise subtitle translator."},
      {"role": "user", "content": f"{prompt}\n\n{json.dumps(input_segments)}"},
    ],
  )

  content = (
    completion.choices[0].message.content
    if completion.choices and completion.choices[0].message
    else "{}"
  ) or "{}"

  try:
    parsed = json.loads(content)
  except json.JSONDecodeError as exc:
    raise RuntimeError("Failed to parse segment translation JSON from OpenAI.") from exc

  translations = parsed.get("translations", []) if isinstance(parsed, dict) else []
  if not isinstance(translations, list) or len(translations) != len(segments):
    raise RuntimeError("Segment translation count mismatch.")

  return {
    "enabled": True,
    "model": config.models.text_translate,
    "targetLanguage": target_language,
    "segments": [
      {
        **segment,
        "translatedText": str(translations[index] or ""),
      }
      for index, segment in enumerate(segments)
    ],
  }


def create_timed_text_from_audio(
  *,
  buffer: bytes,
  filename: str | None,
  mime_type: str | None,
  mode: str,
  source_language: str,
  target_language: str,
) -> dict[str, Any]:
  client = _get_client()

  file_obj = io.BytesIO(buffer)
  file_obj.name = filename or "audio.webm"

  if mode == "translate_to_english":
    translation = client.audio.translations.create(
      file=file_obj,
      model=config.models.audio_translate,
      response_format="vtt",
    )

    return {
      "mode": mode,
      "format": "vtt",
      "timedText": translation if isinstance(translation, str) else str(translation or ""),
      "note": "OpenAI audio translation endpoint returns English output.",
    }

  transcription_kwargs: dict[str, Any] = {
    "file": file_obj,
    "model": config.models.audio_transcribe,
    "response_format": "verbose_json",
    "timestamp_granularities": ["segment"],
  }
  if source_language:
    transcription_kwargs["language"] = source_language

  transcription = client.audio.transcriptions.create(**transcription_kwargs)
  segments = _normalize_segments(transcription)
  translation = _translate_segments_with_text_model(segments, target_language)

  return {
    "mode": "transcribe",
    "format": "segments",
    "transcriptText": str(_read_field(transcription, "text", "") or ""),
    "sourceLanguage": source_language or None,
    "detectedLanguage": _read_field(transcription, "language", None),
    "segments": segments,
    "translation": translation,
  }
