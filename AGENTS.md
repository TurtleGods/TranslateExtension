# Translate Extension

This repository now contains a local Chrome extension plus a local Python backend for generating translated subtitles for videos on the current page.

## What it does

1. The Chrome extension finds the active tab and confirms there is a `<video>` element on the page.
2. It sends the current page URL to a local FastAPI backend at `http://127.0.0.1:8787`.
3. The backend uses `yt-dlp` to download the best available audio stream from that page.
4. The backend sends the audio file to OpenAI for transcription, translates the transcript into your target language, and builds a WebVTT subtitle file.
5. The extension injects that VTT as a `<track kind="subtitles">` onto the page video element and enables it.

## Files

- `extension/`: Manifest V3 Chrome extension.
- `server/src/main.py`: FastAPI backend.
- `server/requirements.txt`: Python dependencies.

## Run the backend

From `F:\TranslateExtension`:

```powershell
server\.venv\Scripts\python.exe -m pip install -r server\requirements.txt
server\.venv\Scripts\python.exe server\src\main.py
```

The backend reads `server\.env`.

Important:
- Keep the OpenAI key only in `server\.env`, never in the extension files.
- The current `server\.env` contains a real-looking key. Rotate it if it has been exposed or committed.
- `ENABLE_MOCK_SUBTITLES=true` only falls back to mock output when no API key is configured.

## Load the extension

1. Open Chrome.
2. Go to `chrome://extensions`.
3. Enable `Developer mode`.
4. Click `Load unpacked`.
5. Select `F:\TranslateExtension\extension`.

## Use it

1. Open a page that contains a normal HTML5 `<video>` element.
2. Click the extension icon.
3. Enter a target language.
4. Click `Generate for current tab`.
5. Wait for the backend to return subtitles. The extension will attach them to the page video.

## Known limits

- `yt-dlp` must be able to extract the page. DRM-protected streams, auth-only pages, or blob-only players may fail.
- This implementation uses the page URL, not browser-captured media bytes.
- Very long videos can be slow or expensive because the full audio is downloaded and sent to OpenAI.
- The backend expects OpenAI transcription support for `verbose_json` segment timestamps.

## Next improvements

- Trim or chunk long audio before transcription.
- Add per-site cookie support for authenticated pages.
- Add a page action that lets the user select which video element should receive the subtitle track.
