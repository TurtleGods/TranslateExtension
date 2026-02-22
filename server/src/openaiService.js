const OpenAI = require("openai");
const { toFile } = require("openai/uploads");
const { config } = require("./config");

let client = null;

function getClient() {
  if (!config.openAiApiKey) {
    throw new Error("OPENAI_API_KEY is not configured in server/.env");
  }

  if (!client) {
    client = new OpenAI({ apiKey: config.openAiApiKey });
  }

  return client;
}

function normalizeSegments(verboseResult) {
  const rawSegments = Array.isArray(verboseResult?.segments) ? verboseResult.segments : [];

  if (rawSegments.length > 0) {
    return rawSegments.map((segment, index) => ({
      index,
      start: Number(segment.start ?? 0),
      end: Number(segment.end ?? 0),
      text: String(segment.text || "").trim()
    }));
  }

  const text = String(verboseResult?.text || "").trim();
  if (!text) {
    return [];
  }

  return [
    {
      index: 0,
      start: 0,
      end: 0,
      text
    }
  ];
}

async function translateSegmentsWithTextModel(segments, targetLanguage) {
  if (!config.enableTextSegmentTranslation || !targetLanguage || segments.length === 0) {
    return {
      enabled: false,
      reason: "Text segment translation disabled or no targetLanguage provided."
    };
  }

  const client = getClient();
  const inputSegments = segments.map((segment) => segment.text);

  const prompt = [
    "Translate each item in the JSON array into the requested target language.",
    "Keep the same array length and order.",
    "Return JSON only with shape: {\"translations\": [\"...\"]}.",
    `Target language: ${targetLanguage}`
  ].join(" ");

  const completion = await client.chat.completions.create({
    model: config.models.textTranslate,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "You are a precise subtitle translator." },
      { role: "user", content: `${prompt}\n\n${JSON.stringify(inputSegments)}` }
    ]
  });

  const content = completion?.choices?.[0]?.message?.content || "{}";
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Failed to parse segment translation JSON from OpenAI.");
  }

  const translations = Array.isArray(parsed.translations) ? parsed.translations : [];
  if (translations.length !== segments.length) {
    throw new Error("Segment translation count mismatch.");
  }

  return {
    enabled: true,
    model: config.models.textTranslate,
    targetLanguage,
    segments: segments.map((segment, index) => ({
      ...segment,
      translatedText: String(translations[index] || "")
    }))
  };
}

async function createTimedTextFromAudio({ buffer, filename, mimeType, mode, sourceLanguage, targetLanguage }) {
  const client = getClient();
  const file = await toFile(buffer, filename || "audio.webm", { type: mimeType || "audio/webm" });

  if (mode === "translate_to_english") {
    const translation = await client.audio.translations.create({
      file,
      model: config.models.audioTranslate,
      response_format: "vtt"
    });

    return {
      mode,
      format: "vtt",
      timedText: typeof translation === "string" ? translation : String(translation || ""),
      note: "OpenAI audio translation endpoint returns English output."
    };
  }

  const transcription = await client.audio.transcriptions.create({
    file,
    model: config.models.audioTranscribe,
    response_format: "verbose_json",
    timestamp_granularities: ["segment"],
    ...(sourceLanguage ? { language: sourceLanguage } : {})
  });

  const segments = normalizeSegments(transcription);
  const translation = await translateSegmentsWithTextModel(segments, targetLanguage);

  return {
    mode: "transcribe",
    format: "segments",
    transcriptText: String(transcription?.text || ""),
    sourceLanguage: sourceLanguage || null,
    detectedLanguage: transcription?.language || null,
    segments,
    translation
  };
}

module.exports = {
  createTimedTextFromAudio
};
