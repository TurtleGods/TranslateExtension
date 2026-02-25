from __future__ import annotations

import uuid

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .models import TranslateVideoRequest, TranslateVideoResponse
from .openai_service import translate_audio_to_timed_text
from .yt_dlp_service import extract_audio_for_translation


app = FastAPI(title="TranslateExtension Local Backend", version="0.1.0")

allow_origins = ["*"] if settings.allow_origin == "*" else [settings.allow_origin]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "service": "translate-extension-backend",
        "mockSubtitles": settings.enable_mock_subtitles,
        "openaiConfigured": bool(settings.openai_api_key),
        "port": settings.backend_port,
    }


@app.post("/api/translate-video", response_model=TranslateVideoResponse)
def translate_video(payload: TranslateVideoRequest) -> TranslateVideoResponse:
    job_id = str(uuid.uuid4())
    warnings: list[str] = []
    debug: dict = {"jobId": job_id}

    try:
        extraction = extract_audio_for_translation(payload.pageUrl, payload.videoUrl)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"yt-dlp extraction failed: {exc}") from exc

    warnings.extend(extraction.warnings)
    debug["extraction"] = extraction.debug
    debug["extractor"] = extraction.extractor

    try:
        cues, openai_warnings, openai_debug = translate_audio_to_timed_text(
            target_language=payload.targetLanguage,
            extracted_audio_path=extraction.local_audio_path,
            source_url=extraction.source_url,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"OpenAI processing failed: {exc}") from exc

    warnings.extend(openai_warnings)
    debug["openai"] = openai_debug
    debug["requestSummary"] = {
        "targetLanguage": payload.targetLanguage,
        "hasPageUrl": bool(payload.pageUrl),
        "hasVideoUrl": bool(payload.videoUrl),
        "selectedVideo": payload.selectedVideo.model_dump() if payload.selectedVideo else None,
    }

    return TranslateVideoResponse(
        jobId=job_id,
        status="completed" if cues else "completed_with_no_cues",
        cues=cues,
        warnings=warnings,
        debug=debug,
    )


def main() -> None:
    import uvicorn

    uvicorn.run(
        "src.server:app",
        host=settings.backend_host,
        port=settings.backend_port,
        reload=False,
    )


if __name__ == "__main__":
    main()

