## Project Overview
Build a cross-browser (Firefox + Chrome) extension that translates the audio of videos on the current page using OpenAI and outputs subtitles.

## Current Focus (Phase 1)
Implement and verify the first goal only:
- Detect video elements on the active tab (including HTML5 video).

## Current Direction (Prototype Evolution)
- Move from single-shot / short live subtitle experiments to "whole-video during page lifetime" subtitle generation.
- Process audio in fixed `60s` segments; overlap remains a planned refinement (default candidate: `5s`) for better subtitle stitching quality, but do not rewind visible playback after each chunk to simulate overlap.
- Build subtitles progressively across the full video timeline (e.g. `0-60`, `55-120`, `115-180`, ... until video end).
- Keep accumulated subtitle cues in session memory during processing, and checkpoint progress locally for recovery/export.

## Current Status
- Project scaffold created (`manifest.json`, `background.js`, `content.js`, `popup.html`, `popup.js`, `popup.css`).
- Implemented popup-triggered scan of the active tab.
- Implemented video metadata detection and popup result display.
- Implemented target video selection from the detected list (stored per active tab).
- Added browser-specific manifests: `manifest.firefox.json` and `manifest.chrome.json`.
- Added `switch-manifest.ps1` to switch the active `manifest.json` for local testing.
- Added local backend proxy scaffold in `server/` for OpenAI timed-text processing.
- Added backend `.env` config pattern for API key (`server/.env.example`).
- Added background message placeholder to send audio bytes to the backend (`REQUEST_TIMED_TEXT_FROM_BACKEND`).
- Added prototype audio capture and subtitle overlay rendering experiments (browser behavior varies by site/browser).
- Added continuous chunk-based translation prototype flow in extension background/popup (currently sequential chunks without seek-back overlap to avoid rewinding playback).
- Current subtitle accumulation needs overlap-aware stitching/dedup improvements for full-video quality.
- Firefox `video.captureStream()` audio behavior is unreliable on some sites (can mute page audio); Chrome testing is preferred for translation prototypes.

## Goals
- Detect video elements on the active tab (including HTML5 video).
- Capture audio from the video (tab audio capture).
- Send audio to an OpenAI translation endpoint and receive timed text.
- Render subtitles on top of the video or provide a subtitle track.
- Stitch chunked subtitle results into a coherent full-video subtitle timeline during page lifetime.
- Persist in-progress subtitle data locally (session memory + local persistence) so progress survives UI/popup closure.

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
- `server/`: local backend proxy for OpenAI audio transcription/translation requests.

## Key Components (prototype additions)
- Chunk scheduler (extension background): captures sequential `60s` segments and coordinates backend requests.
- Subtitle stitcher (extension, planned refinement): merges overlapping chunk outputs (e.g. `5s` overlap) and removes duplicates.
- Subtitle store (extension, planned refinement): in-memory runtime state plus local persistence (prefer IndexedDB for larger jobs).

## Permissions (Phase 1)
- `activeTab`
- `scripting`
- `storage`
- `tabs`

## Permissions (Backend Connectivity)
- `host_permissions`: `http://localhost:8787/*` (local backend during development)

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

## Data Flow (Prototype: Whole Video Chunk Translation)
1. User scans/selects a target video and starts continuous translation.
2. Background coordinates repeated audio capture in sequential `60s` chunks. Overlap (e.g. `5s`) remains planned, but current prototype does not seek the visible video backward after each chunk.
3. Each chunk is sent to local backend (`/api/openai/audio/timed-text`) for timed text generation.
4. Extension converts chunk-relative timestamps to absolute video timeline timestamps.
5. Extension stitches/merges overlapping cues and stores accumulated subtitle data in memory (and local persistence/checkpoints).
6. Content script renders/upgrades subtitle overlay from the accumulated cue set.
7. Processing continues until the video ends, the page/tab is left, or the user stops translation.

## Security & Privacy
- Phase 1 page inspection stays local to the browser.
- OpenAI API key should be stored in `server/.env` (backend), not in the extension.
- Backend remains a stateless proxy for audio->timed text requests; subtitle stitching/persistence logic stays in the extension.

## Initial Milestones (reordered)
1. Scaffolding: manifest + background + content + popup. (Done)
2. Video detection on active tab and popup display. (Done)
3. Select target video for future translation flow. (Done)
4. Audio capture prototype and mock subtitles overlay. (Prototype in progress)
5. Real OpenAI request and subtitle timing pipeline. (Backend + extension prototype in progress)
6. Overlap-aware chunk stitching and persistent subtitle accumulation for whole-video processing. (Planned)

## Assumptions / Open Questions
- How to handle pages with multiple videos (selection UI vs auto-pick).
- Whether iframe-hosted videos are in scope for Phase 1.
- Minimum metadata needed before audio capture integration.
- When to clear stored video selection (tab reload, URL change, manual reset).
- Whether to use direct OpenAI audio translation (English-only) or transcription + text translation for target-language subtitles.
- Exact overlap window for chunk stitching (`5s` default candidate), merge heuristics, and a non-playback-rewinding implementation strategy before escalating to AI-assisted merge.
- Storage strategy tradeoffs (`storage.local` vs IndexedDB) for long videos and checkpoint frequency.
- Whether to auto-rewind for subtitle review after processing or keep current playback position and store cues only.

