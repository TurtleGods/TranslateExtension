from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv


PROJECT_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(PROJECT_ROOT / "server" / ".env")

BACKEND_HOST = os.getenv("BACKEND_HOST", "127.0.0.1")
BACKEND_PORT = int(os.getenv("BACKEND_PORT", "8787"))
ALLOW_ORIGIN = os.getenv("ALLOW_ORIGIN", "*")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini-transcribe")
OPENAI_TEXT_MODEL = os.getenv("OPENAI_TEXT_MODEL", "gpt-4.1-mini")
ENABLE_MOCK_SUBTITLES = os.getenv("ENABLE_MOCK_SUBTITLES", "false").lower() == "true"

_temp_dir_value = Path(os.getenv("TEMP_DIR", "server/tmp"))
TEMP_DIR = _temp_dir_value if _temp_dir_value.is_absolute() else PROJECT_ROOT / _temp_dir_value
TEST_AUDIO_PATH = TEMP_DIR / "test.webm"
