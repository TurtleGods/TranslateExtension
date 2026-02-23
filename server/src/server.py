from __future__ import annotations

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import config
from .openai_service import create_timed_text_from_audio


MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024

app = FastAPI(title="translate-extension-backend")

app.add_middleware(
  CORSMiddleware,
  allow_origins=["*"],
  allow_credentials=True,
  allow_methods=["*"],
  allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, object]:
  return {
    "ok": True,
    "service": "translate-extension-backend",
    "openAiConfigured": bool(config.openai_api_key),
    "textSegmentTranslationEnabled": config.enable_text_segment_translation,
  }


@app.post("/api/openai/audio/timed-text")
async def openai_audio_timed_text(
  audio: UploadFile = File(...),
  mode: str = Form("transcribe"),
  sourceLanguage: str = Form(""),
  targetLanguage: str = Form(""),
):
  try:
    if mode not in {"transcribe", "translate_to_english"}:
      return JSONResponse(
        status_code=400,
        content={"ok": False, "error": "Invalid mode. Use 'transcribe' or 'translate_to_english'."},
      )

    audio_bytes = await audio.read()
    if not audio_bytes:
      return JSONResponse(
        status_code=400,
        content={"ok": False, "error": "Missing audio file field 'audio'."},
      )

    if len(audio_bytes) > MAX_FILE_SIZE_BYTES:
      return JSONResponse(
        status_code=400,
        content={"ok": False, "error": "Audio file too large (max 25MB)."},
      )

    result = create_timed_text_from_audio(
      buffer=audio_bytes,
      filename=audio.filename,
      mime_type=audio.content_type,
      mode=mode,
      source_language=sourceLanguage or "",
      target_language=targetLanguage or "",
    )

    return {"ok": True, "result": result}
  except Exception as exc:
    return JSONResponse(status_code=500, content={"ok": False, "error": str(exc) or "Unexpected server error."})


if __name__ == "__main__":
  import uvicorn

  uvicorn.run(app, host="127.0.0.1", port=config.port)
