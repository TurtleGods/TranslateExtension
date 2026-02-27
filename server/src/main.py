from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

try:
    from .config import ALLOW_ORIGIN, BACKEND_HOST, BACKEND_PORT, ENABLE_MOCK_SUBTITLES, OPENAI_API_KEY
    from .media import download_audio
    from .schemas import SubtitleRequest, SubtitleResponse
    from .subtitles import (
        build_vtt,
        get_openai_client,
        get_test_audio_path,
        mock_segments,
        transcribe_audio,
        translate_segments,
    )
except ImportError:
    from config import ALLOW_ORIGIN, BACKEND_HOST, BACKEND_PORT, ENABLE_MOCK_SUBTITLES, OPENAI_API_KEY
    from media import download_audio
    from schemas import SubtitleRequest, SubtitleResponse
    from subtitles import (
        build_vtt,
        get_openai_client,
        get_test_audio_path,
        mock_segments,
        transcribe_audio,
        translate_segments,
    )


app = FastAPI(title="Translate Extension Backend", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if ALLOW_ORIGIN == "*" else [ALLOW_ORIGIN],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "host": BACKEND_HOST,
        "port": BACKEND_PORT,
        "openai_configured": bool(OPENAI_API_KEY),
        "mock_subtitles": ENABLE_MOCK_SUBTITLES,
    }


@app.post("/api/translate-subtitles", response_model=SubtitleResponse)
def translate_subtitles(payload: SubtitleRequest) -> SubtitleResponse:
    audio_path: Path | None = None

    try:
        audio_path = download_audio(payload.page_url)

        if ENABLE_MOCK_SUBTITLES and not OPENAI_API_KEY:
            base_segments = [
                {"index": 0, "start": 0.0, "end": 2.5, "text": "Mock subtitle output is enabled."},
                {"index": 1, "start": 2.5, "end": 5.5, "text": "Set OPENAI_API_KEY to generate real subtitles."},
            ]
            translated_segments = mock_segments(base_segments, payload.target_language)
            source_language = "en"
        else:
            client = get_openai_client()
            source_language, segments = transcribe_audio(client, audio_path)
            translated_segments = translate_segments(client, segments, payload.target_language)

        vtt = build_vtt(translated_segments)
        return SubtitleResponse(
            page_url=payload.page_url,
            source_language=source_language,
            target_language=payload.target_language,
            track_label=f"{payload.target_language} (AI)",
            vtt=vtt,
            segment_count=len(translated_segments),
        )
    finally:
        if audio_path and audio_path.exists():
            try:
                audio_path.unlink()
            except OSError:
                pass


@app.post("/api/test/translate-audio", response_model=SubtitleResponse)
def translate_test_audio(target_language: str = "Traditional Chinese") -> SubtitleResponse:
    if ENABLE_MOCK_SUBTITLES and not OPENAI_API_KEY:
        base_segments = [
            {"index": 0, "start": 0.0, "end": 2.5, "text": "Mock subtitle output is enabled."},
            {"index": 1, "start": 2.5, "end": 5.5, "text": "Set OPENAI_API_KEY to generate real subtitles."},
        ]
        translated_segments = mock_segments(base_segments, target_language)
        source_language = "en"
    else:
        client = get_openai_client()
        source_language, segments = transcribe_audio(client, get_test_audio_path())
        translated_segments = translate_segments(client, segments, target_language)

    vtt = build_vtt(translated_segments)
    return SubtitleResponse(
        page_url="server/tmp/test.webm",
        source_language=source_language,
        target_language=target_language,
        track_label=f"{target_language} (AI test)",
        vtt=vtt,
        segment_count=len(translated_segments),
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host=BACKEND_HOST, port=BACKEND_PORT, reload=False)
