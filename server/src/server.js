const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { config } = require("./config");
const { createTimedTextFromAudio } = require("./openaiService");

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024
  }
});

app.use(cors({ origin: true }));
app.use(express.json({ limit: "2mb" }));

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "translate-extension-backend",
    openAiConfigured: Boolean(config.openAiApiKey),
    textSegmentTranslationEnabled: config.enableTextSegmentTranslation
  });
});

app.post("/api/openai/audio/timed-text", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file?.buffer) {
      res.status(400).json({ ok: false, error: "Missing audio file field 'audio'." });
      return;
    }

    const mode = req.body.mode || "transcribe";
    if (!["transcribe", "translate_to_english"].includes(mode)) {
      res.status(400).json({ ok: false, error: "Invalid mode. Use 'transcribe' or 'translate_to_english'." });
      return;
    }

    const result = await createTimedTextFromAudio({
      buffer: req.file.buffer,
      filename: req.file.originalname,
      mimeType: req.file.mimetype,
      mode,
      sourceLanguage: req.body.sourceLanguage || "",
      targetLanguage: req.body.targetLanguage || ""
    });

    res.json({
      ok: true,
      result
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message || "Unexpected server error."
    });
  }
});

app.listen(config.port, () => {
  console.log(`Server listening on http://localhost:${config.port}`);
});
