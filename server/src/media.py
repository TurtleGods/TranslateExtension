from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from yt_dlp import YoutubeDL

try:
    from .config import TEMP_DIR
except ImportError:
    from config import TEMP_DIR


def safe_stem(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]+", "-", value).strip("-") or "video"


def first_video_entry(info: dict[str, Any]) -> dict[str, Any]:
    if "entries" in info and info["entries"]:
        for entry in info["entries"]:
            if entry:
                return entry
        raise HTTPException(status_code=400, detail="No downloadable video entries were found.")
    return info


def download_audio(page_url: str) -> Path:
    TEMP_DIR.mkdir(parents=True, exist_ok=True)
    stem = safe_stem(page_url)[:48]
    template = f"{stem}-%(id)s.%(ext)s"
    options = {
        "format": "bestaudio[acodec!=none]/bestaudio/best",
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "paths": {"home": str(TEMP_DIR)},
        "outtmpl": {"default": template},
    }

    try:
        with YoutubeDL(options) as ydl:
            info = first_video_entry(ydl.extract_info(page_url, download=True))
            file_path = Path(ydl.prepare_filename(info))
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Failed to download audio from the page URL: {exc}",
        ) from exc

    if not file_path.exists():
        matches = sorted(TEMP_DIR.glob(f"{stem}-*"))
        if not matches:
            raise HTTPException(status_code=500, detail="yt-dlp did not produce an audio file.")
        file_path = matches[-1]

    return file_path
