const API_BASE = "http://127.0.0.1:8787";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  debugger;
  if (message?.type !== "GENERATE_SUBTITLES") {
    return false;
  }

  handleGenerateSubtitles(message)
    .then((payload) => sendResponse({ ok: true, payload }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});

async function handleGenerateSubtitles(message) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error("No active tab is available.");
  }

  const videoContext = await chrome.tabs.sendMessage(tab.id, { type: "GET_VIDEO_CONTEXT" });
  if (!videoContext?.hasVideo) {
    throw new Error("No <video> element was found on the current page.");
  }

  const response = await fetch(`${API_BASE}/api/translate-subtitles`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      page_url: videoContext.pageUrl,
      target_language: message.targetLanguage
    })
  });

  if (!response.ok) {
    const details = await safeJson(response);
    throw new Error(details?.detail || `Backend request failed with ${response.status}.`);
  }

  const payload = await response.json();
  const applyResponse = await chrome.tabs.sendMessage(tab.id, {
    type: "APPLY_SUBTITLES",
    vtt: payload.vtt,
    trackLabel: payload.track_label,
    trackLanguage: normalizeLanguageCode(message.targetLanguage),
    sourceLanguage: payload.source_language
  });

  if (!applyResponse?.ok) {
    throw new Error(applyResponse?.error || "The content script failed to attach subtitles.");
  }

  return {
    ...payload,
    pageTitle: videoContext.title
  };
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch (error) {
    return null;
  }
}

function normalizeLanguageCode(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z-]/g, "");
  return normalized || "und";
}
