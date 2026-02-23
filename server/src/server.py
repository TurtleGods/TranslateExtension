from __future__ import annotations

from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from fastapi import Body, FastAPI, File, Form, UploadFile
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


def _fetch_source_media_bytes(source_url: str) -> tuple[bytes, str | None, str | None]:
  parsed = urlparse(source_url)
  if parsed.scheme not in {"http", "https"}:
    raise RuntimeError("Only http(s) source URLs are supported for direct-source processing.")

  lower_path = (parsed.path or "").lower()
  if lower_path.endswith(".m3u8") or lower_path.endswith(".mpd"):
    raise RuntimeError("HLS/DASH manifest URLs are not supported yet for direct-source processing.")

  req = Request(
    source_url,
    headers={
      "User-Agent": "TranslateExtensionBackend/0.1",
      "Accept": "*/*",
    },
  )

  try:
    with urlopen(req, timeout=30) as response:
      content_length = response.headers.get("Content-Length")
      if content_length:
        try:
          if int(content_length) > MAX_FILE_SIZE_BYTES:
            raise RuntimeError("Source media file too large (max 25MB direct-source limit).")
        except ValueError:
          pass

      data = response.read(MAX_FILE_SIZE_BYTES + 1)
      if len(data) > MAX_FILE_SIZE_BYTES:
        raise RuntimeError("Source media file too large (max 25MB direct-source limit).")

      content_type = response.headers.get("Content-Type")
  except HTTPError as exc:
    raise RuntimeError(f"Failed to fetch source media URL (HTTP {exc.code}).") from exc
  except URLError as exc:
    raise RuntimeError(f"Failed to fetch source media URL: {exc.reason}") from exc

  filename = Path(parsed.path).name or "source-media"
  return data, filename, content_type


@app.post("/api/openai/source-url/timed-text")
async def openai_source_url_timed_text(payload: dict = Body(...)):
  try:
    source_url = str(payload.get("sourceUrl") or "").strip()
    mode = str(payload.get("mode") or "transcribe").strip() or "transcribe"
    source_language = str(payload.get("sourceLanguage") or "").strip()
    target_language = str(payload.get("targetLanguage") or "").strip()

    if not source_url:
      return JSONResponse(status_code=400, content={"ok": False, "error": "Missing sourceUrl."})
    if mode not in {"transcribe", "translate_to_english"}:
      return JSONResponse(
        status_code=400,
        content={"ok": False, "error": "Invalid mode. Use 'transcribe' or 'translate_to_english'."},
      )

    media_bytes, filename, mime_type = _fetch_source_media_bytes(source_url)
    result = create_timed_text_from_audio(
      buffer=media_bytes,
      filename=filename,
      mime_type=mime_type,
      mode=mode,
      source_language=source_language,
      target_language=target_language,
    )

    return {
      "ok": True,
      "result": result,
      "sourceUrl": source_url,
      "bytes": len(media_bytes),
      "filename": filename,
      "mimeType": mime_type,
    }
  except Exception as exc:
    return JSONResponse(status_code=500, content={"ok": False, "error": str(exc) or "Unexpected server error."})


if __name__ == "__main__":
  import uvicorn

  uvicorn.run(app, host="127.0.0.1", port=config.port)
