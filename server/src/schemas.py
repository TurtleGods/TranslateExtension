from pydantic import BaseModel, Field


class SubtitleRequest(BaseModel):
    page_url: str = Field(..., description="The page that hosts the video")
    target_language: str = Field(..., description="The desired subtitle language")


class SubtitleResponse(BaseModel):
    page_url: str
    source_language: str
    target_language: str
    track_label: str
    vtt: str
    segment_count: int
