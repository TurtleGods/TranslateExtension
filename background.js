const extApi = globalThis.browser ?? globalThis.chrome;
const SELECTED_VIDEO_STORAGE_KEY = "selectedVideoByTabId";
const SETTINGS_STORAGE_KEY = "appSettings";
const LIVE_TRANSLATION_BY_TAB = new Map();
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

async function renderSubtitleOverlayOnActiveTab({
  tabId,
  videoIndex,
  result,
  offsetSeconds,
  replace,
  liveAlignToNow,
  displayLeadSeconds
}) {
  if (!tabId || !Number.isInteger(videoIndex) || videoIndex < 0) {
    throw new Error("Missing tabId/videoIndex for subtitle overlay render.");
  }

  await executeContentScript(tabId);
  const response = await sendTabMessage(tabId, {
    type: "RENDER_SUBTITLE_OVERLAY",
    videoIndex,
    result,
    offsetSeconds,
    replace,
    liveAlignToNow,
    displayLeadSeconds
  });

  if (!response?.ok) {
    throw new Error(response?.error || "Failed to render subtitle overlay.");
  }

  return response;
}

async function clearSubtitleOverlayOnTab({ tabId, videoIndex }) {
  if (!tabId || !Number.isInteger(videoIndex) || videoIndex < 0) {
    throw new Error("Missing tabId/videoIndex for subtitle overlay clear.");
  }

  await executeContentScript(tabId);
  const response = await sendTabMessage(tabId, {
    type: "CLEAR_SUBTITLE_OVERLAY",
    videoIndex
  });

  if (!response?.ok) {
    throw new Error(response?.error || "Failed to clear subtitle overlay.");
  }

  return response;
}

function getLiveTranslationState(tabId) {
  return LIVE_TRANSLATION_BY_TAB.get(String(tabId)) || null;
}

function setLiveTranslationState(tabId, state) {
  LIVE_TRANSLATION_BY_TAB.set(String(tabId), state);
}

function deleteLiveTranslationState(tabId) {
  LIVE_TRANSLATION_BY_TAB.delete(String(tabId));
}

async function startLiveTranslationOnActiveTab(payload = {}) {
  const tab = await queryActiveTab();
  if (!tab?.id) {
    throw new Error("No active tab found.");
  }
  if (!isSupportedTab(tab)) {
    throw new Error("Open a regular http/https page to start translation.");
  }

  const tabId = tab.id;
  const selectedVideoIndex = await getSelectedVideoIndexForTab(tabId);
  if (!Number.isInteger(selectedVideoIndex) || selectedVideoIndex < 0) {
    throw new Error("No selected video for this tab. Scan and select a video first.");
  }

  const existing = getLiveTranslationState(tabId);
  if (existing?.running && !existing.stopRequested) {
    return {
      started: false,
      alreadyRunning: true,
      tabId,
      videoIndex: selectedVideoIndex
    };
  }

  const state = {
    running: true,
    stopRequested: false,
    tabId,
    videoIndex: selectedVideoIndex,
    chunkIndex: 0,
    durationMs: Math.max(1500, Number(payload.durationMs) || 4000),
    mode: payload.mode || "translate_to_english",
    sourceLanguage: payload.sourceLanguage || "",
    targetLanguage: payload.targetLanguage || "",
    startedAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    lastError: "",
    lastOverlayCueCount: 0
  };
  setLiveTranslationState(tabId, state);

  clearSubtitleOverlayOnTab({ tabId, videoIndex: selectedVideoIndex }).catch(() => {});

  (async () => {
    const pendingChunkTasks = new Set();
    let chunkSequence = 0;

    const scheduleChunkProcessing = (capture, seq) => {
      const task = (async () => {
        const backend = await requestTimedTextFromBackend({
          audioBase64: capture.audioBase64,
          mimeType: capture.mimeType,
          mode: state.mode,
          sourceLanguage: state.sourceLanguage,
          targetLanguage: state.targetLanguage
        });

        const overlay = await renderSubtitleOverlayOnActiveTab({
          tabId,
          videoIndex: state.videoIndex,
          result: backend?.result,
          offsetSeconds: capture.videoCurrentTimeStart || 0,
          replace: false,
          liveAlignToNow: true,
          displayLeadSeconds: 0.6
        });

        state.chunkIndex += 1;
        state.lastUpdatedAt = new Date().toISOString();
        state.lastError = "";
        state.lastOverlayCueCount = overlay?.totalCueCount || overlay?.cueCount || 0;
        state.lastProcessedChunkSequence = seq;
      })()
        .catch((error) => {
          state.lastError = error?.message || String(error);
          state.lastUpdatedAt = new Date().toISOString();
          state.stopRequested = true;
          console.error("[translate-extension] live translation chunk failed:", error);
        })
        .finally(() => {
          pendingChunkTasks.delete(task);
        });

      pendingChunkTasks.add(task);
    };

    try {
      while (!state.stopRequested) {
        await executeContentScript(tabId);
        const capture = await sendTabMessage(tabId, {
          type: "CAPTURE_VIDEO_AUDIO_SAMPLE",
          videoIndex: state.videoIndex,
          durationMs: state.durationMs
        });

        if (!capture?.ok) {
          throw new Error(capture?.error || "Failed to capture video audio sample.");
        }

        scheduleChunkProcessing(capture, chunkSequence);
        chunkSequence += 1;
      }
    } catch (error) {
      state.lastError = error?.message || String(error);
      state.lastUpdatedAt = new Date().toISOString();
      console.error("[translate-extension] live translation stopped with error:", error);
    } finally {
      if (pendingChunkTasks.size > 0) {
        await Promise.allSettled(Array.from(pendingChunkTasks));
      }
      state.running = false;
      state.stopRequested = true;
    }
  })();

  return {
    started: true,
    tabId,
    videoIndex: selectedVideoIndex,
    durationMs: state.durationMs
  };
}

async function stopLiveTranslationOnActiveTab() {
  const tab = await queryActiveTab();
  if (!tab?.id) {
    throw new Error("No active tab found.");
  }

  const state = getLiveTranslationState(tab.id);
  if (!state) {
    return {
      stopped: false,
      running: false,
      tabId: tab.id
    };
  }

  state.stopRequested = true;
  state.lastUpdatedAt = new Date().toISOString();

  return {
    stopped: true,
    running: !!state.running,
    tabId: tab.id
  };
}

async function getLiveTranslationStatusForActiveTab() {
  const tab = await queryActiveTab();
  if (!tab?.id) {
    return { tabId: null, running: false };
  }

  const state = getLiveTranslationState(tab.id);
  if (!state) {
    return { tabId: tab.id, running: false };
  }

  if (!state.running && state.stopRequested) {
    const snapshot = {
      tabId: tab.id,
      running: false,
      stopRequested: true,
      chunkIndex: state.chunkIndex,
      durationMs: state.durationMs,
      lastUpdatedAt: state.lastUpdatedAt,
      lastError: state.lastError || "",
      lastOverlayCueCount: state.lastOverlayCueCount || 0
    };
    if (!state.lastError) {
      deleteLiveTranslationState(tab.id);
    }
    return snapshot;
  }

  return {
    tabId: tab.id,
    running: !!state.running,
    stopRequested: !!state.stopRequested,
    chunkIndex: state.chunkIndex,
    durationMs: state.durationMs,
    lastUpdatedAt: state.lastUpdatedAt,
    lastError: state.lastError || "",
    lastOverlayCueCount: state.lastOverlayCueCount || 0
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

        const overlay = await renderSubtitleOverlayOnActiveTab({
          tabId: capture.tab?.id,
          videoIndex: capture.selectedVideoIndex,
          result: backend?.result,
          offsetSeconds: capture.videoCurrentTimeStart || 0
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
              videoCurrentTimeStart: capture.videoCurrentTimeStart,
              selectedVideoIndex: capture.selectedVideoIndex,
              tab: capture.tab
            },
            backend,
            overlay
          }
        });
      })
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));

    return true;
  }

  if (message?.type === "START_SELECTED_VIDEO_TRANSLATION_LIVE") {
    startLiveTranslationOnActiveTab(message.payload || {})
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

  if (message?.type === "STOP_SELECTED_VIDEO_TRANSLATION_LIVE") {
    stopLiveTranslationOnActiveTab()
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

  if (message?.type === "GET_SELECTED_VIDEO_TRANSLATION_LIVE_STATUS") {
    getLiveTranslationStatusForActiveTab()
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

  return false;
});
