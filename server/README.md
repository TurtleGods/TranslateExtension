# Local Backend (OpenAI Proxy) - Python

This backend keeps your OpenAI API key out of the browser extension.

## Setup (Python)

1. Create a virtual environment
2. Install dependencies
3. Copy `.env.example` to `.env`
4. Put your OpenAI key in `OPENAI_API_KEY`
5. Start the server

```powershell
cd server
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
python -m uvicorn src.server:app --host 127.0.0.1 --port 8787 --reload
```

If your PowerShell execution policy blocks activation, you can run without activation:

```powershell
cd server
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
copy .env.example .env
.\.venv\Scripts\python.exe -m uvicorn src.server:app --host 127.0.0.1 --port 8787 --reload
```

## Endpoint

- `GET /health`
- `POST /api/openai/audio/timed-text` (multipart form)

Form fields:
- `audio` (file, required)
- `mode` = `transcribe` or `translate_to_english`
- `sourceLanguage` (optional, e.g. `ja`)
- `targetLanguage` (optional, used only when segment translation is enabled)

## Recommended Extension Strategy (Current Prototype Direction)

The backend is intentionally stateless. For whole-video subtitle generation, the extension should:

1. Capture audio in fixed chunks (current target: `60s`)
2. Add overlap between chunks (planned default: `5s`) to improve stitching quality, but avoid rewinding the visible page video after each chunk to simulate overlap
3. Send each chunk to `POST /api/openai/audio/timed-text`
4. Convert chunk-relative timestamps to absolute video timeline timestamps in the extension
5. Stitch/deduplicate overlapping cues in the extension
6. Keep accumulated subtitle data in session memory and checkpoint locally (prefer IndexedDB for larger videos)

Example chunk windows for a future `60s` chunk strategy with `5s` overlap (target behavior):
- `0s - 60s`
- `55s - 120s`
- `115s - 180s`
- continue until video end (or user stop)

This backend does **not** currently store jobs, merge subtitles, or track long-running video state.

## Performance Notes

- Smaller uploads improve transfer time, but end-to-end latency is still dominated by chunk duration plus model processing time.
- `60s` chunks are good for continuity, but first subtitle availability is slower than short-chunk "live" mode.
- For long videos, prefer compressed audio (`webm/opus` or `ogg/opus`) to stay under upload limits.

## Notes

- `translate_to_english` uses OpenAI audio translation and returns `vtt` timed text (English).
- `transcribe` returns timestamped segments (`verbose_json`) and can optionally run a second text-translation step if enabled.
- The extension prototype now drives chunk capture/upload (currently sequential chunks without seek-back overlap); backend remains focused on per-chunk timed text generation.
- Current backend upload limit is `25MB` per request; adjust chunk size/bitrate accordingly for long-video processing.

