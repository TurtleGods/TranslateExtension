const extApi = globalThis.browser ?? globalThis.chrome;
const SELECTED_VIDEO_STORAGE_KEY = "selectedVideoByTabId";
const SETTINGS_STORAGE_KEY = "appSettings";
const LIVE_TRANSLATION_BY_TAB = new Map();
const CONTINUOUS_60S_TRANSLATION_BY_TAB = new Map();
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

async function getSelectedVideoSourceInfoOnActiveTab() {
  const tab = await queryActiveTab();

  if (!tab?.id) {
    throw new Error("No active tab found.");
  }

  if (!isSupportedTab(tab)) {
    throw new Error("Open a regular http/https page to inspect video source.");
  }

  const selectedVideoIndex = await getSelectedVideoIndexForTab(tab.id);
  if (!Number.isInteger(selectedVideoIndex) || selectedVideoIndex < 0) {
    throw new Error("No selected video for this tab. Scan and select a video first.");
  }

  await executeContentScript(tab.id);
  const response = await sendTabMessage(tab.id, {
    type: "GET_VIDEO_SOURCE_INFO",
    videoIndex: selectedVideoIndex
  });

  if (!response?.ok) {
    throw new Error(response?.error || "Failed to inspect selected video source.");
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

async function requestTimedTextFromBackendBySourceUrl(payload) {
  const settings = await getAppSettings();
  const backendBaseUrl = String(settings.backendBaseUrl || DEFAULT_APP_SETTINGS.backendBaseUrl).replace(/\/+$/, "");

  if (!payload?.sourceUrl) {
    throw new Error("Missing sourceUrl payload.");
  }

  const response = await fetch(`${backendBaseUrl}/api/openai/source-url/timed-text`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sourceUrl: payload.sourceUrl,
      mode: payload.mode || "transcribe",
      sourceLanguage: payload.sourceLanguage || "",
      targetLanguage: payload.targetLanguage || ""
    })
  });

  let data;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const message = data?.error || `Backend source-url request failed (${response.status})`;
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
  trimLeadingSeconds,
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
    trimLeadingSeconds,
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

async function releaseVideoAudioCaptureOnTab({ tabId, videoIndex }) {
  if (!tabId || !Number.isInteger(videoIndex) || videoIndex < 0) {
    throw new Error("Missing tabId/videoIndex for audio capture release.");
  }

  await executeContentScript(tabId);
  const response = await sendTabMessage(tabId, {
    type: "RELEASE_VIDEO_AUDIO_CAPTURE",
    videoIndex
  });

  if (!response?.ok) {
    throw new Error(response?.error || "Failed to release video audio capture.");
  }

  return response;
}

async function seekVideoPlaybackOnTab({ tabId, videoIndex, currentTime, play }) {
  if (!tabId || !Number.isInteger(videoIndex) || videoIndex < 0) {
    throw new Error("Missing tabId/videoIndex for seek.");
  }

  await executeContentScript(tabId);
  const response = await sendTabMessage(tabId, {
    type: "SEEK_VIDEO_PLAYBACK",
    videoIndex,
    currentTime,
    play
  });

  if (!response?.ok) {
    throw new Error(response?.error || "Failed to seek video playback.");
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

function getContinuous60sTranslationState(tabId) {
  return CONTINUOUS_60S_TRANSLATION_BY_TAB.get(String(tabId)) || null;
}

function setContinuous60sTranslationState(tabId, state) {
  CONTINUOUS_60S_TRANSLATION_BY_TAB.set(String(tabId), state);
}

function deleteContinuous60sTranslationState(tabId) {
  CONTINUOUS_60S_TRANSLATION_BY_TAB.delete(String(tabId));
}

async function startContinuous60sTranslationOnActiveTab(payload = {}) {
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

  const existing = getContinuous60sTranslationState(tabId);
  if (existing?.running && !existing.stopRequested) {
    return {
      started: false,
      alreadyRunning: true,
      tabId,
      videoIndex: selectedVideoIndex
    };
  }

  const segmentDurationMs = Math.max(1000, Number(payload.durationMs) || 60000);

  const state = {
    running: true,
    stopRequested: false,
    finished: false,
    finishedReason: "",
    tabId,
    videoIndex: selectedVideoIndex,
    segmentDurationMs,
    overlapSeconds: 0,
    mode: payload.mode || "translate_to_english",
    sourceLanguage: payload.sourceLanguage || "",
    targetLanguage: payload.targetLanguage || "",
    autoSeekAfterComplete: payload.autoSeekAfterComplete !== false,
    startedAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    lastError: "",
    capturedSegments: 0,
    completedSegments: 0,
    lastOverlayCueCount: 0,
    consecutiveNoProgressCaptures: 0,
    firstCaptureStartTime: null,
    videoDuration: null,
    rewound: false
  };
  setContinuous60sTranslationState(tabId, state);

  (async () => {
    let sourceJob = null;

    try {
      sourceJob = await getSelectedVideoSourceInfoOnActiveTab();
      state.firstCaptureStartTime = Number(sourceJob.currentTime || 0);
      state.videoDuration = Number.isFinite(sourceJob.duration) ? Number(sourceJob.duration) : null;
      state.lastUpdatedAt = new Date().toISOString();

      if (!sourceJob.directSourceSupported || !sourceJob.directSourceCandidate?.url) {
        throw new Error(sourceJob.unsupportedReason || "Selected video source is not supported for direct-source processing.");
      }

      await clearSubtitleOverlayOnTab({
        tabId: sourceJob.tab?.id,
        videoIndex: sourceJob.selectedVideoIndex
      }).catch(() => {});

      const backend = await requestTimedTextFromBackendBySourceUrl({
        sourceUrl: sourceJob.directSourceCandidate.url,
        mode: state.mode,
        sourceLanguage: state.sourceLanguage,
        targetLanguage: state.targetLanguage
      });

      const overlay = await renderSubtitleOverlayOnActiveTab({
        tabId: sourceJob.tab?.id,
        videoIndex: sourceJob.selectedVideoIndex,
        result: backend?.result,
        offsetSeconds: 0,
        replace: true,
        trimLeadingSeconds: 0
      });

      state.capturedSegments = 1;
      state.completedSegments = 1;
      state.lastOverlayCueCount = overlay?.totalCueCount || overlay?.cueCount || 0;
      state.consecutiveNoProgressCaptures = 0;
      state.finishedReason = "source_complete";
      state.lastUpdatedAt = new Date().toISOString();
    } catch (error) {
      state.lastError = error?.message || String(error);
      state.lastUpdatedAt = new Date().toISOString();
      state.finishedReason = state.finishedReason || "error";
      console.error("[translate-extension] source-first translation stopped:", error);
    } finally {
      if (state.stopRequested && !state.finishedReason) {
        state.finishedReason = "manual_stop";
      }
      if (state.autoSeekAfterComplete && sourceJob && state.finishedReason === "video_end") {
        const playback = await seekVideoPlaybackOnTab({
          tabId: sourceJob.tab?.id,
          videoIndex: sourceJob.selectedVideoIndex,
          currentTime: sourceJob.currentTime || 0,
          play: true
        }).catch(() => null);
        state.rewound = Boolean(playback?.ok);
      }
      state.running = false;
      state.finished = true;
      state.stopRequested = true;
      state.lastUpdatedAt = new Date().toISOString();
    }
  })();

  return {
    started: true,
    tabId,
    videoIndex: selectedVideoIndex,
    segmentDurationMs: state.segmentDurationMs,
    overlapSeconds: state.overlapSeconds
  };
}

async function stopContinuous60sTranslationOnActiveTab() {
  const tab = await queryActiveTab();
  if (!tab?.id) {
    throw new Error("No active tab found.");
  }

  const state = getContinuous60sTranslationState(tab.id);
  if (!state) {
    return { tabId: tab.id, stopped: false, running: false };
  }

  state.stopRequested = true;
  state.finishedReason = state.finishedReason || "manual_stop";
  state.lastUpdatedAt = new Date().toISOString();

  return {
    tabId: tab.id,
    stopped: true,
    running: !!state.running
  };
}

async function getContinuous60sTranslationStatusForActiveTab() {
  const tab = await queryActiveTab();
  if (!tab?.id) {
    return { tabId: null, running: false };
  }

  const state = getContinuous60sTranslationState(tab.id);
  if (!state) {
    return { tabId: tab.id, running: false };
  }

  const snapshot = {
    tabId: tab.id,
    running: !!state.running,
    stopRequested: !!state.stopRequested,
    finished: !!state.finished,
    finishedReason: state.finishedReason || "",
    lastError: state.lastError || "",
    segmentDurationMs: state.segmentDurationMs,
    overlapSeconds: Number(state.overlapSeconds || 0),
    capturedSegments: Number(state.capturedSegments || 0),
    completedSegments: Number(state.completedSegments || 0),
    lastOverlayCueCount: Number(state.lastOverlayCueCount || 0),
    consecutiveNoProgressCaptures: Number(state.consecutiveNoProgressCaptures || 0),
    firstCaptureStartTime: state.firstCaptureStartTime,
    videoDuration: state.videoDuration,
    rewound: !!state.rewound,
    startedAt: state.startedAt,
    lastUpdatedAt: state.lastUpdatedAt
  };

  if (state.finished && !state.running) {
    // Keep the final state available for one status read after completion, then clean up.
    deleteContinuous60sTranslationState(tab.id);
  }

  return snapshot;
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
      await releaseVideoAudioCaptureOnTab({ tabId, videoIndex: state.videoIndex }).catch(() => {});
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
  releaseVideoAudioCaptureOnTab({ tabId: tab.id, videoIndex: state.videoIndex }).catch(() => {});

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

async function clearSelectedVideoSubtitlesOnActiveTab() {
  const tab = await queryActiveTab();
  if (!tab?.id) {
    throw new Error("No active tab found.");
  }

  if (!isSupportedTab(tab)) {
    throw new Error("Open a regular http/https page to clear subtitles.");
  }

  const videoIndex = await getSelectedVideoIndexForTab(tab.id);
  if (!Number.isInteger(videoIndex) || videoIndex < 0) {
    throw new Error("No selected video for this tab. Scan and select a video first.");
  }

  const overlay = await clearSubtitleOverlayOnTab({ tabId: tab.id, videoIndex });
  const captureRelease = await releaseVideoAudioCaptureOnTab({ tabId: tab.id, videoIndex }).catch(() => null);

  return {
    tabId: tab.id,
    videoIndex,
    overlay,
    captureRelease
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
    (async () => {
      const segmentDurationMs = Math.max(1000, Number(message.payload?.durationMs) || 60000);
      const requestedSegmentCountRaw = Number(message.payload?.segmentCount);
      const fixedSegmentCount = Number.isFinite(requestedSegmentCountRaw) && requestedSegmentCountRaw > 0
        ? Math.max(1, Math.min(20, Math.floor(requestedSegmentCountRaw)))
        : null;
      const mode = message.payload?.mode || "translate_to_english";
      const sourceLanguage = message.payload?.sourceLanguage || "";
      const targetLanguage = message.payload?.targetLanguage || "";
      const autoSeekAfterComplete = message.payload?.autoSeekAfterComplete !== false;

      let firstCapture = null;
      let lastCapture = null;
      const captureSummaries = [];
      const chunkTasks = [];

      let segmentIndex = 0;
      while (true) {
        if (fixedSegmentCount != null && segmentIndex >= fixedSegmentCount) {
          break;
        }

        const capture = await captureSelectedVideoAudioSampleOnActiveTab({
          durationMs: segmentDurationMs
        });

        if (!firstCapture) {
          firstCapture = capture;
          await clearSubtitleOverlayOnTab({
            tabId: capture.tab?.id,
            videoIndex: capture.selectedVideoIndex
          }).catch(() => {});
        }

        lastCapture = capture;
        captureSummaries.push({
          segmentIndex,
          capturedAt: capture.capturedAt,
          bytes: capture.bytes,
          mimeType: capture.mimeType,
          durationMsRequested: capture.durationMsRequested,
          durationMsActual: capture.durationMsActual,
          videoCurrentTimeStart: capture.videoCurrentTimeStart
        });

        const chunkTask = (async () => {
          const backend = await requestTimedTextFromBackend({
            audioBase64: capture.audioBase64,
            mimeType: capture.mimeType,
            mode,
            sourceLanguage,
            targetLanguage
          });

          const overlay = await renderSubtitleOverlayOnActiveTab({
            tabId: capture.tab?.id,
            videoIndex: capture.selectedVideoIndex,
            result: backend?.result,
            offsetSeconds: capture.videoCurrentTimeStart || 0,
            replace: false
          });

          return {
            segmentIndex,
            backend,
            overlay
          };
        })();

        chunkTasks.push(chunkTask);
        segmentIndex += 1;

        if (capture.videoEnded) {
          break;
        }

        const noProgress = Number.isFinite(capture.videoCurrentTimeStart)
          && Number.isFinite(capture.videoCurrentTimeEnd)
          && (capture.videoCurrentTimeEnd - capture.videoCurrentTimeStart) < 0.25;
        if (noProgress) {
          throw new Error("Video playback did not advance during capture. Keep the video playing and this tab active.");
        }
      }

      const settled = await Promise.allSettled(chunkTasks);
      const rejected = settled.find((item) => item.status === "rejected");
      if (rejected) {
        throw rejected.reason instanceof Error ? rejected.reason : new Error(String(rejected.reason));
      }

      const chunkResults = settled.map((item) => item.value).sort((a, b) => a.segmentIndex - b.segmentIndex);
      const lastChunkResult = chunkResults[chunkResults.length - 1] || null;

      const playback =
        autoSeekAfterComplete && firstCapture
          ? await seekVideoPlaybackOnTab({
              tabId: firstCapture.tab?.id,
              videoIndex: firstCapture.selectedVideoIndex,
              currentTime: firstCapture.videoCurrentTimeStart || 0,
              play: true
            }).catch(() => null)
          : null;

      sendResponse({
        ok: true,
        data: {
          batch: {
            segmentCount: captureSummaries.length,
            fixedSegmentCount,
            segmentDurationMs,
            totalDurationMsRequested: captureSummaries.length * segmentDurationMs,
            stoppedBecause: fixedSegmentCount != null && captureSummaries.length >= fixedSegmentCount ? "segment_limit" : "video_end_or_error"
          },
          capture: firstCapture
            ? {
                capturedAt: firstCapture.capturedAt,
                bytes: firstCapture.bytes,
                mimeType: firstCapture.mimeType,
                  durationMsRequested: firstCapture.durationMsRequested,
                  durationMsActual: firstCapture.durationMsActual,
                  videoCurrentTimeStart: firstCapture.videoCurrentTimeStart,
                  videoCurrentTimeEnd: firstCapture.videoCurrentTimeEnd,
                  videoDuration: firstCapture.videoDuration,
                  videoEnded: firstCapture.videoEnded,
                  selectedVideoIndex: firstCapture.selectedVideoIndex,
                  tab: firstCapture.tab
                }
            : null,
          captures: captureSummaries,
          backend: lastChunkResult?.backend || null,
          overlay: lastChunkResult?.overlay || null,
          chunkResults,
          playback
        }
      });
    })()
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

  if (message?.type === "START_CONTINUOUS_60S_TRANSLATION") {
    startContinuous60sTranslationOnActiveTab(message.payload || {})
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

  if (message?.type === "STOP_CONTINUOUS_60S_TRANSLATION") {
    stopContinuous60sTranslationOnActiveTab()
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

  if (message?.type === "GET_CONTINUOUS_60S_TRANSLATION_STATUS") {
    getContinuous60sTranslationStatusForActiveTab()
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

  if (message?.type === "CLEAR_SELECTED_VIDEO_SUBTITLES") {
    clearSelectedVideoSubtitlesOnActiveTab()
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

  return false;
});

