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

## Notes

- `translate_to_english` uses OpenAI audio translation and returns `vtt` timed text (English).
- `transcribe` returns timestamped segments (`verbose_json`) and can optionally run a second text-translation step if enabled.
- Audio capture in the extension is not wired yet; the extension already has a background message placeholder to call this backend later.
