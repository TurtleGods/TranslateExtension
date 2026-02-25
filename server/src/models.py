from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class SelectedVideoMeta(BaseModel):
    id: str | None = None
    duration: float | None = None
    width: int | None = None
    height: int | None = None


class TranslateVideoRequest(BaseModel):
    pageUrl: str = Field(default="")
    videoUrl: str = Field(default="")
    targetLanguage: str = Field(default="zh")
    selectedVideo: SelectedVideoMeta | None = None


class SubtitleCue(BaseModel):
    start: float
    end: float
    text: str
    lang: str | None = None


class TranslateVideoResponse(BaseModel):
    jobId: str
    status: str
    cues: list[SubtitleCue]
    warnings: list[str] = Field(default_factory=list)
    debug: dict[str, Any] = Field(default_factory=dict)

