# Local Backend (FastAPI)

Local backend for the Chrome extension:
- Receives `POST /api/translate-video`
- Uses `yt-dlp` to resolve/extract audio (scaffolded hook)
- Uses OpenAI to produce timed subtitles (scaffolded hook)
- Returns subtitle cues to the extension (default target `zh`)

## Prerequisites

- Python 3.10+
- `ffmpeg` installed and available in `PATH`
- OpenAI API key in `server/.env`

## Setup

```powershell
cd server
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Create/update `server/.env`:

```env
OPENAI_API_KEY=your_key_here
BACKEND_HOST=127.0.0.1
BACKEND_PORT=8787
ALLOW_ORIGIN=*
ENABLE_MOCK_SUBTITLES=true
```

`ENABLE_MOCK_SUBTITLES=true` lets you test the extension UI before wiring real OpenAI/yt-dlp flow.

## Run

```powershell
cd server
.\.venv\Scripts\Activate.ps1
python -m src.server
```

Server URL:
- `http://localhost:8787`

## API

### `GET /health`

Health + configuration summary.

### `POST /api/translate-video`

Request body (from extension):
- `pageUrl`
- `videoUrl`
- `targetLanguage` (default `zh`)
- `selectedVideo` (metadata from page scan)

Response:
- `jobId`
- `status`
- `cues` (`[{ start, end, text }]`)
- `warnings`
- `debug`

## Notes

- This scaffold intentionally avoids DRM bypass and does not implement it.
- Real `yt-dlp` extraction and OpenAI timed-text parsing should be added incrementally.

