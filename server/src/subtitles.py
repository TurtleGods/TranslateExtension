from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from openai import BadRequestError, OpenAI

try:
    from .config import OPENAI_API_KEY, OPENAI_MODEL, OPENAI_TEXT_MODEL, TEST_AUDIO_PATH
except ImportError:
    from config import OPENAI_API_KEY, OPENAI_MODEL, OPENAI_TEXT_MODEL, TEST_AUDIO_PATH


def read_field(value: Any, key: str, default: Any = None) -> Any:
    if hasattr(value, key):
        return getattr(value, key)
    if isinstance(value, dict):
        return value.get(key, default)
    return default


def get_openai_client() -> OpenAI:
    if not OPENAI_API_KEY:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY is not configured.")
    return OpenAI(api_key=OPENAI_API_KEY)


def transcription_to_segments(transcript: Any) -> tuple[str, list[dict[str, Any]]]:
    source_language = read_field(transcript, "language", "unknown")
    raw_segments = read_field(transcript, "segments", []) or []
    segments: list[dict[str, Any]] = []

    if raw_segments:
        for idx, segment in enumerate(raw_segments):
            start = float(read_field(segment, "start", 0.0))
            end = float(read_field(segment, "end", start + 2.0))
            text = str(read_field(segment, "text", "")).strip()
            if text:
                segments.append({"index": idx, "start": start, "end": max(end, start + 0.5), "text": text})
    else:
        text = str(read_field(transcript, "text", "")).strip()
        if text:
            segments.append({"index": 0, "start": 0.0, "end": 5.0, "text": text})

    if not segments:
        raise HTTPException(status_code=502, detail="OpenAI returned an empty transcript.")

    return source_language, segments


def split_text_into_segments(text: str) -> list[dict[str, Any]]:
    chunks = [item.strip() for item in re.split(r"(?<=[.!?])\s+", text) if item.strip()]
    if not chunks:
        chunks = [text.strip()]

    segments: list[dict[str, Any]] = []
    start = 0.0
    for index, chunk in enumerate(chunks):
        duration = max(2.5, min(6.0, len(chunk) / 12))
        end = start + duration
        segments.append(
            {
                "index": index,
                "start": start,
                "end": end,
                "text": chunk,
            }
        )
        start = end
    return segments


def transcribe_audio(client: OpenAI, audio_path: Path) -> tuple[str, list[dict[str, Any]]]:
    with audio_path.open("rb") as audio_file:
        try:
            transcript = client.audio.transcriptions.create(
                model=OPENAI_MODEL,
                file=audio_file,
                response_format="verbose_json",
                timestamp_granularities=["segment"],
            )
            return transcription_to_segments(transcript)
        except BadRequestError as exc:
            error_body = getattr(exc, "body", None) or {}
            error_detail = error_body.get("error", {}) if isinstance(error_body, dict) else {}
            unsupported_response_format = (
                error_detail.get("param") == "response_format"
                and error_detail.get("code") == "unsupported_value"
            )
            if not unsupported_response_format:
                raise

        audio_file.seek(0)
        transcript = client.audio.transcriptions.create(
            model=OPENAI_MODEL,
            file=audio_file,
            response_format="json",
        )

    source_language = read_field(transcript, "language", "unknown")
    text = str(read_field(transcript, "text", "")).strip()
    if not text:
        raise HTTPException(status_code=502, detail="OpenAI returned an empty transcript.")
    return source_language, split_text_into_segments(text)


def get_test_audio_path() -> Path:
    if not TEST_AUDIO_PATH.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Test audio file was not found: {TEST_AUDIO_PATH}",
        )
    return TEST_AUDIO_PATH


def translate_segments(
    client: OpenAI,
    segments: list[dict[str, Any]],
    target_language: str,
) -> list[dict[str, Any]]:
    translated: list[dict[str, Any]] = []
    chunk_size = 80

    for offset in range(0, len(segments), chunk_size):
        chunk = segments[offset : offset + chunk_size]
        payload = [{"index": item["index"], "text": item["text"]} for item in chunk]
        response = client.responses.create(
            model=OPENAI_TEXT_MODEL,
            input=[
                {
                    "role": "system",
                    "content": [
                        {
                            "type": "input_text",
                            "text": (
                                "Translate subtitle lines into the requested language. "
                                "Return strict JSON as an array of objects with keys index and text. "
                                "Keep the same array length and preserve the index values."
                            ),
                        }
                    ],
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "input_text",
                            "text": json.dumps(
                                {
                                    "target_language": target_language,
                                    "segments": payload,
                                },
                                ensure_ascii=False,
                            ),
                        }
                    ],
                },
            ],
        )
        text = (response.output_text or "").strip()
        try:
            translated_chunk = json.loads(text)
        except json.JSONDecodeError as exc:
            raise HTTPException(
                status_code=502,
                detail="OpenAI translation response was not valid JSON.",
            ) from exc

        if len(translated_chunk) != len(chunk):
            raise HTTPException(
                status_code=502,
                detail="OpenAI translation response length did not match the transcript chunk.",
            )

        by_index = {item["index"]: item["text"].strip() for item in translated_chunk}
        for item in chunk:
            translated_text = by_index.get(item["index"], "").strip()
            if not translated_text:
                translated_text = item["text"]
            translated.append({**item, "text": translated_text})

    return translated


def mock_segments(segments: list[dict[str, Any]], target_language: str) -> list[dict[str, Any]]:
    return [
        {
            **segment,
            "text": f"[{target_language}] {segment['text']}",
        }
        for segment in segments
    ]


def format_timestamp(value: float) -> str:
    total_ms = max(int(value * 1000), 0)
    hours, rem = divmod(total_ms, 3_600_000)
    minutes, rem = divmod(rem, 60_000)
    seconds, milliseconds = divmod(rem, 1_000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}.{milliseconds:03d}"


def build_vtt(segments: list[dict[str, Any]]) -> str:
    lines = ["WEBVTT", ""]
    for number, segment in enumerate(segments, start=1):
        lines.append(str(number))
        lines.append(f"{format_timestamp(segment['start'])} --> {format_timestamp(segment['end'])}")
        lines.append(segment["text"])
        lines.append("")
    return "\n".join(lines)
