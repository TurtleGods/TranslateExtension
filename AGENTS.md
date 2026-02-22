## Project Overview
Build a cross‑browser (Firefox + Chrome) extension that translates the audio of videos on the current page using OpenAI and outputs subtitles.

## Goals
- Detect video elements on the active tab (including HTML5 video).
- Capture audio from the video (tab audio capture).
- Send audio to an OpenAI translation endpoint and receive timed text.
- Render subtitles on top of the video or provide a subtitle track.

## Non‑Goals (for now)
- Full offline transcription/translation.
- Support for DRM‑protected media.
- Advanced subtitle editing UI.

## Target Browsers
- Chrome (Manifest V3).
- Firefox (Manifest V3 where supported; otherwise MV2 fallback if needed).

## Key Components
- `manifest.json`: permissions, content scripts, background service worker.
- Background worker: handles OpenAI API calls and streaming.
- Content script: injects subtitle renderer overlay.
- UI (popup/options): API key configuration, language selection, start/stop.

## Permissions (initial guess)
- `activeTab`, `scripting`, `storage`, `tabs`
- `tabCapture` or `offscreen` (Chrome) / `tabCapture` (Firefox)
- `webRequest` only if needed for special cases

## Data Flow (initial)
1. User clicks "Translate Video" in the extension.
2. Extension captures tab audio.
3. Audio is chunked and sent to OpenAI.
4. Returned translation with timing is stored.
5. Content script overlays subtitles on the video.

## Security & Privacy
- API key stored in extension storage (local only).
- Minimize data retention; do not log raw audio.
- Provide a clear disclosure in the UI.

## Initial Milestones
1. Scaffolding: manifest + background + content + popup.
2. Simple audio capture and mock subtitles overlay.
3. Real OpenAI request wired up.
4. Subtitle timing and sync improvements.
5. Packaging for Chrome and Firefox.

## Assumptions / Open Questions
- Which OpenAI endpoint to use for translation (speech‑to‑text + translate).
- Expected latency and buffering strategy.
- Subtitle format preference (WebVTT vs custom overlay).

