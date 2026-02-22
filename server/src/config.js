const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

function getBoolean(value, fallback = false) {
  if (value == null) {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

const config = {
  port: Number(process.env.PORT || 8787),
  openAiApiKey: process.env.OPENAI_API_KEY || "",
  models: {
    audioTranscribe: process.env.OPENAI_AUDIO_TRANSCRIBE_MODEL || "whisper-1",
    audioTranslate: process.env.OPENAI_AUDIO_TRANSLATE_MODEL || "whisper-1",
    textTranslate: process.env.OPENAI_TEXT_TRANSLATE_MODEL || "gpt-4o-mini"
  },
  enableTextSegmentTranslation: getBoolean(process.env.ENABLE_TEXT_SEGMENT_TRANSLATION, false)
};

module.exports = {
  config
};
