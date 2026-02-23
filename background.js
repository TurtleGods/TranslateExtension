const extApi = globalThis.browser ?? globalThis.chrome;
const SELECTED_VIDEO_STORAGE_KEY = "selectedVideoByTabId";
const SETTINGS_STORAGE_KEY = "appSettings";
const DEFAULT_APP_SETTINGS = {
  backendBaseUrl: "http://localhost:8787"
};

function queryActiveTab() {
  if (extApi.tabs.query.length === 1) {
    return extApi.tabs.query({ active: true, currentWindow: true }).then((tabs) => tabs[0]);
  }

  return new Promise((resolve, reject) => {
    extApi.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const err = globalThis.chrome?.runtime?.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve(tabs?.[0]);
    });
  });
}

function executeContentScript(tabId) {
  const details = {
    target: { tabId },
    files: ["content.js"]
  };

  if (extApi.scripting.executeScript.length === 1) {
    return extApi.scripting.executeScript(details);
  }

  return new Promise((resolve, reject) => {
    extApi.scripting.executeScript(details, (result) => {
      const err = globalThis.chrome?.runtime?.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve(result);
    });
  });
}

function sendTabMessage(tabId, message) {
  if (extApi.tabs.sendMessage.length <= 2) {
    return extApi.tabs.sendMessage(tabId, message);
  }

  return new Promise((resolve, reject) => {
    extApi.tabs.sendMessage(tabId, message, (response) => {
      const err = globalThis.chrome?.runtime?.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve(response);
    });
  });
}

function isSupportedTab(tab) {
  return !!tab?.id && /^https?:/i.test(tab.url || "");
}

function storageLocalGet(keys) {
  if (extApi.storage.local.get.length <= 1) {
    return extApi.storage.local.get(keys);
  }

  return new Promise((resolve, reject) => {
    extApi.storage.local.get(keys, (result) => {
      const err = globalThis.chrome?.runtime?.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve(result);
    });
  });
}

function storageLocalSet(value) {
  if (extApi.storage.local.set.length <= 1) {
    return extApi.storage.local.set(value);
  }

  return new Promise((resolve, reject) => {
    extApi.storage.local.set(value, () => {
      const err = globalThis.chrome?.runtime?.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve();
    });
  });
}

async function getSelectedVideoByTabMap() {
  const result = await storageLocalGet({ [SELECTED_VIDEO_STORAGE_KEY]: {} });
  return result?.[SELECTED_VIDEO_STORAGE_KEY] || {};
}

async function getAppSettings() {
  const result = await storageLocalGet({ [SETTINGS_STORAGE_KEY]: DEFAULT_APP_SETTINGS });
  return {
    ...DEFAULT_APP_SETTINGS,
    ...(result?.[SETTINGS_STORAGE_KEY] || {})
  };
}

async function updateAppSettings(patch) {
  const current = await getAppSettings();
  const next = { ...current, ...patch };
  await storageLocalSet({ [SETTINGS_STORAGE_KEY]: next });
  return next;
}

async function getSelectedVideoIndexForTab(tabId) {
  const selectedByTab = await getSelectedVideoByTabMap();
  const value = selectedByTab[String(tabId)];
  return Number.isInteger(value) ? value : null;
}

async function setSelectedVideoIndexForTab(tabId, videoIndex) {
  const selectedByTab = await getSelectedVideoByTabMap();
  selectedByTab[String(tabId)] = videoIndex;
  await storageLocalSet({ [SELECTED_VIDEO_STORAGE_KEY]: selectedByTab });
}

async function scanActiveTabVideos() {
  const tab = await queryActiveTab();

  if (!tab) {
    throw new Error("No active tab found.");
  }

  if (!isSupportedTab(tab)) {
    throw new Error("Open a regular http/https page to scan for videos.");
  }

  await executeContentScript(tab.id);
  const response = await sendTabMessage(tab.id, { type: "SCAN_VIDEOS" });
  const selectedVideoIndex = await getSelectedVideoIndexForTab(tab.id);

  return {
    tab: {
      id: tab.id,
      title: tab.title || "",
      url: tab.url || ""
    },
    selectedVideoIndex,
    ...response
  };
}

async function setActiveTabTargetVideo(videoIndex) {
  if (!Number.isInteger(videoIndex) || videoIndex < 0) {
    throw new Error("Invalid video index.");
  }

  const tab = await queryActiveTab();
  if (!tab?.id) {
    throw new Error("No active tab found.");
  }

  if (!isSupportedTab(tab)) {
    throw new Error("Open a regular http/https page to select a video.");
  }

  await setSelectedVideoIndexForTab(tab.id, videoIndex);
  return {
    tabId: tab.id,
    videoIndex
  };
}

async function captureSelectedVideoAudioSampleOnActiveTab(options = {}) {
  const tab = await queryActiveTab();

  if (!tab?.id) {
    throw new Error("No active tab found.");
  }

  if (!isSupportedTab(tab)) {
    throw new Error("Open a regular http/https page to capture video audio.");
  }

  const selectedVideoIndex = await getSelectedVideoIndexForTab(tab.id);
  if (!Number.isInteger(selectedVideoIndex) || selectedVideoIndex < 0) {
    throw new Error("No selected video for this tab. Scan and select a video first.");
  }

  await executeContentScript(tab.id);
  const response = await sendTabMessage(tab.id, {
    type: "CAPTURE_VIDEO_AUDIO_SAMPLE",
    videoIndex: selectedVideoIndex,
    durationMs: options.durationMs
  });

  if (!response?.ok) {
    throw new Error(response?.error || "Failed to capture video audio sample.");
  }

  return {
    tab: {
      id: tab.id,
      title: tab.title || "",
      url: tab.url || ""
    },
    selectedVideoIndex,
    ...response
  };
}

function base64ToUint8Array(base64) {
  const binaryString = globalThis.atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i += 1) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function requestTimedTextFromBackend(payload) {
  const settings = await getAppSettings();
  const backendBaseUrl = String(settings.backendBaseUrl || DEFAULT_APP_SETTINGS.backendBaseUrl).replace(/\/+$/, "");

  if (!payload?.audioBase64) {
    throw new Error("Missing audioBase64 payload.");
  }

  const mimeType = payload.mimeType || "audio/webm";
  const fileExtension = mimeType.includes("wav") ? "wav" : mimeType.includes("mp4") ? "m4a" : "webm";
  const audioBytes = base64ToUint8Array(payload.audioBase64);
  const audioBlob = new Blob([audioBytes], { type: mimeType });

  const form = new FormData();
  form.append("audio", audioBlob, `segment.${fileExtension}`);
  form.append("mode", payload.mode || "transcribe");
  if (payload.sourceLanguage) {
    form.append("sourceLanguage", payload.sourceLanguage);
  }
  if (payload.targetLanguage) {
    form.append("targetLanguage", payload.targetLanguage);
  }

  const response = await fetch(`${backendBaseUrl}/api/openai/audio/timed-text`, {
    method: "POST",
    body: form
  });

  let data;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const message = data?.error || `Backend request failed (${response.status})`;
    throw new Error(message);
  }

  return {
    backendBaseUrl,
    ...data
  };
}

extApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "SCAN_ACTIVE_TAB_VIDEOS") {
    scanActiveTabVideos()
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));

    return true;
  }

  if (message?.type === "SET_ACTIVE_TAB_TARGET_VIDEO") {
    setActiveTabTargetVideo(message.videoIndex)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));

    return true;
  }

  if (message?.type === "GET_APP_SETTINGS") {
    getAppSettings()
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));

    return true;
  }

  if (message?.type === "UPDATE_APP_SETTINGS") {
    updateAppSettings(message.patch || {})
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));

    return true;
  }

  if (message?.type === "REQUEST_TIMED_TEXT_FROM_BACKEND") {
    requestTimedTextFromBackend(message.payload || {})
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));

    return true;
  }

  if (message?.type === "START_SELECTED_VIDEO_TRANSLATION_PROTOTYPE") {
    captureSelectedVideoAudioSampleOnActiveTab({
      durationMs: message.payload?.durationMs
    })
      .then(async (capture) => {
        const backend = await requestTimedTextFromBackend({
          audioBase64: capture.audioBase64,
          mimeType: capture.mimeType,
          mode: message.payload?.mode || "translate_to_english",
          sourceLanguage: message.payload?.sourceLanguage || "",
          targetLanguage: message.payload?.targetLanguage || ""
        });

        sendResponse({
          ok: true,
          data: {
            capture: {
              capturedAt: capture.capturedAt,
              bytes: capture.bytes,
              mimeType: capture.mimeType,
              durationMsRequested: capture.durationMsRequested,
              durationMsActual: capture.durationMsActual,
              selectedVideoIndex: capture.selectedVideoIndex,
              tab: capture.tab
            },
            backend
          }
        });
      })
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));

    return true;
  }

  return false;
});
