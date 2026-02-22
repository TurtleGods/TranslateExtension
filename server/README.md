# Local Backend (OpenAI Proxy)

This backend keeps your OpenAI API key out of the browser extension.

## Setup

1. Install dependencies
2. Copy `.env.example` to `.env`
3. Put your OpenAI key in `OPENAI_API_KEY`
4. Start the server

```powershell
cd server
npm install
copy .env.example .env
npm run dev
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
- Audio capture in the extension is not wired yet; the extension now has a background message placeholder to call this backend later.
