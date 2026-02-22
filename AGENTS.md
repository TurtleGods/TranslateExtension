## Project Overview
Build a cross-browser (Firefox + Chrome) extension that translates the audio of videos on the current page using OpenAI and outputs subtitles.

## Current Focus (Phase 1)
Implement and verify the first goal only:
- Detect video elements on the active tab (including HTML5 video).

## Current Status
- Project scaffold created (`manifest.json`, `background.js`, `content.js`, `popup.html`, `popup.js`, `popup.css`).
- Implemented popup-triggered scan of the active tab.
- Implemented video metadata detection and popup result display.
- Implemented target video selection from the detected list (stored per active tab).
- Added browser-specific manifests: `manifest.firefox.json` and `manifest.chrome.json`.
- Added `switch-manifest.ps1` to switch the active `manifest.json` for local testing.
- OpenAI/audio capture is not implemented yet.

## Goals
- Detect video elements on the active tab (including HTML5 video).
- Capture audio from the video (tab audio capture).
- Send audio to an OpenAI translation endpoint and receive timed text.
- Render subtitles on top of the video or provide a subtitle track.

## Non-Goals (for now)
- Full offline transcription/translation.
- Support for DRM-protected media.
- Advanced subtitle editing UI.

## Target Browsers
- Chrome (Manifest V3).
- Firefox (Manifest V3 where supported; otherwise MV2 fallback if needed).

## Key Components (initial)
- `manifest.json`: active manifest used by the browser during local testing.
- `manifest.firefox.json`: Firefox dev manifest (`background.scripts`).
- `manifest.chrome.json`: Chrome MV3 manifest (`background.service_worker`).
- Content script: scans the page for `video` elements and reports metadata.
- Background worker: coordinates extension actions and future API calls.
- Popup UI: trigger scan and show detected videos.

## Permissions (Phase 1)
- `activeTab`
- `scripting`
- `storage`
- `tabs`

## Local Dev Notes
- Firefox (current `web-ext` compatibility): use `manifest.firefox.json`.
- Chrome MV3: use `manifest.chrome.json`.
- Switch active manifest with:
  - `.\switch-manifest.ps1 firefox`
  - `.\switch-manifest.ps1 chrome`

## Data Flow (Phase 1: Video Detection)
1. User clicks the extension popup and selects "Scan Videos".
2. Background script injects `content.js` into the active tab using `scripting.executeScript`.
3. Content script finds all visible `video` elements on the page.
4. Content script returns metadata (index, src/currentSrc, duration, size, paused state).
5. Popup displays the detected video list.
6. User selects one video as the future translation target.
7. Background script stores the selected video index per tab in extension storage.

## Security & Privacy
- No audio capture or upload in Phase 1.
- No OpenAI API calls in Phase 1.
- Keep page inspection local to the browser.

## Initial Milestones (reordered)
1. Scaffolding: manifest + background + content + popup. (Done)
2. Video detection on active tab and popup display. (Done)
3. Select target video for future translation flow. (Done)
4. Audio capture prototype and mock subtitles overlay.
5. Real OpenAI request and subtitle timing pipeline.

## Assumptions / Open Questions
- How to handle pages with multiple videos (selection UI vs auto-pick).
- Whether iframe-hosted videos are in scope for Phase 1.
- Minimum metadata needed before audio capture integration.
- When to clear stored video selection (tab reload, URL change, manual reset).
