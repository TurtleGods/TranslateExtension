# AGENT.md

## Project: Chrome Extension Video Audio Translation (Restart Plan)

Build a Chrome extension that:
- Targets a video on the current page
- Extracts audio (via `yt-dlp` in a local Python service)
- Sends audio to OpenAI for transcription/translation
- Displays subtitles on the page
- Defaults target language to Chinese (`zh-CN` / Traditional Chinese UI text optional)

## Important Architecture Constraint

`yt-dlp` cannot run inside a Chrome extension.

Use this split architecture:
- **Chrome extension (frontend/controller)**: page scan, video selection, subtitle overlay UI
- **Local Python backend**: runs `yt-dlp`, audio extraction, chunking, OpenAI API calls

## v1 Goal (Restart Scope)

Implement a reliable end-to-end prototype for supported sites (non-DRM):
1. User scans/selects a video on the page
2. Extension sends page/video URL to local backend
3. Backend uses `yt-dlp` to extract/download audio
4. Backend chunks audio and calls OpenAI
5. Backend returns timed subtitles translated to Chinese
6. Extension renders subtitles overlay on target video

## Non-Goals (v1)

- DRM-protected platforms (e.g., Netflix, many paid streams)
- Perfect subtitle editing UI
- Firefox support (Chrome first)
- Pure in-browser extraction without backend

## Tech Stack

### Chrome Extension (MV3)
- `manifest.json` (MV3)
- `background.js` (service worker)
- `content.js` (video detection + subtitle overlay)
- `popup.html` / `popup.js` / `popup.css` (controls)
- `chrome.storage` for settings + selected target video

### Local Backend (Python)
- Python 3.10+
- `yt-dlp` (download/extract audio)
- `ffmpeg` (audio conversion/chunking; system dependency)
- Minimal web API (FastAPI or Flask; FastAPI preferred)
- OpenAI API client for transcription/translation

## Default Product Behavior

- Default target language: Chinese
- Popup action flow:
  - Scan videos
  - Select target video
  - Start translation
  - Stop translation
- Show status:
  - `Idle`, `Extracting audio`, `Transcribing`, `Translating`, `Rendering subtitles`, `Error`

## Recommended Subtitle Pipeline (v1)

1. Backend resolves media from page/video URL using `yt-dlp`
2. Extract audio track to a stable format (e.g., `wav` or `m4a`)
3. Chunk audio (e.g., 30-60s chunks)
4. Send each chunk to OpenAI for timed text generation (transcription or translation)
5. Convert chunk-relative timestamps to absolute timestamps
6. Merge all cues into a single subtitle timeline
7. Return cues to extension progressively (streaming/polling can be added later)

## OpenAI Integration Notes

- Keep API key in backend `.env`, never in the extension
- Prefer backend-owned OpenAI calls only
- Return normalized subtitle cues:
  - `start` (seconds)
  - `end` (seconds)
  - `text`
  - optional `lang`

## Security / Legal Notes

- Respect site terms and copyright law
- Do not attempt DRM bypass
- Process only user-requested URLs
- Avoid logging raw audio or sensitive page data unless needed for debugging

## Suggested API Contract (Backend)

### `POST /api/translate-video`
Request (example):
- `pageUrl`
- `videoUrl` (if available)
- `targetLanguage` (default `zh`)

Response (initial synchronous prototype):
- `jobId`
- `status`
- `cues`: array of `{ start, end, text }`

Later improvement:
- async job + polling / SSE for progressive subtitle updates

## Implementation Plan (Practical Order)

1. Rebuild minimal Chrome extension scaffold (scan/select video + popup)
2. Create Python backend with health endpoint
3. Add `yt-dlp` extraction endpoint (URL -> local audio file)
4. Add OpenAI timed-text endpoint (audio chunk -> cues in Chinese)
5. Connect extension to backend and render subtitle overlay
6. Add chunked full-video processing + progress UI
7. Add local persistence/checkpointing

## Development Assumptions

- Chrome desktop only (first target)
- Local backend runs on `http://localhost:8787`
- `ffmpeg` installed and available in PATH
- Supported sites are non-DRM and accessible to `yt-dlp`

## Out-of-Scope Site Types (Expected Failures)

- DRM-protected streaming services
- Sites requiring browser-only decrypted media pipelines
- Videos embedded in complex auth/session flows that `yt-dlp` cannot access

## Coding Rules for This Repo

- Keep extension code and backend code clearly separated
- Keep OpenAI and `yt-dlp` logic in backend only
- Prefer small, testable functions
- Surface actionable errors to popup UI
- Store only minimal metadata in extension storage

## Success Criteria (Restart Milestone 1)

A user can:
1. Open a page with a supported video
2. Select the video in the extension popup
3. Start translation
4. See Chinese subtitles rendered on the video within a reasonable wait time

