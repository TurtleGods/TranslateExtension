const BACKEND_BASE_URL = "http://localhost:8787";

function tabKey(tabId) {
  return `tabState:${tabId}`;
}

async function getTabState(tabId) {
  const key = tabKey(tabId);
  const result = await chrome.storage.local.get(key);
  return (
    result[key] || {
      tabId,
      pageUrl: "",
      videos: [],
      selectedVideoId: null,
      targetLanguage: "zh",
      status: "Idle",
      error: ""
    }
  );
}

async function setTabState(tabId, patch) {
  const key = tabKey(tabId);
  const current = await getTabState(tabId);
  const next = { ...current, ...patch, tabId };
  await chrome.storage.local.set({ [key]: next });
  return next;
}

function safeRemoveTabState(tabId) {
  try {
    const maybePromise = chrome.storage.local.remove(tabKey(tabId));
    if (maybePromise && typeof maybePromise.then === "function") {
      maybePromise.catch(() => {});
    }
  } catch {
    // Ignore cleanup failures.
  }
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs.length || !tabs[0].id) {
    throw new Error("No active tab.");
  }
  return tabs[0];
}

async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "PING" });
    return;
  } catch {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"]
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Cannot inject content script on this page. Try a normal website tab (not chrome:// pages). ${message}`
      );
    }
  }
}

async function sendToContent(tabId, message) {
  await ensureContentScript(tabId);
  return chrome.tabs.sendMessage(tabId, message);
}

async function scanVideosOnActiveTab() {
  const tab = await getActiveTab();
  if (!tab.url || /^(chrome|edge|about|chrome-extension):/i.test(tab.url)) {
    throw new Error("This page does not allow extension script injection. Open a normal website page with a video.");
  }

  let videos = [];
  let directScanError = "";

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const isVisible = (el) => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            style.opacity !== "0"
          );
        };

        return Array.from(document.querySelectorAll("video")).map((video, index) => {
          const rect = video.getBoundingClientRect();
          return {
            id: `video-${index}`,
            index,
            src: video.getAttribute("src") || "",
            currentSrc: video.currentSrc || "",
            duration: Number.isFinite(video.duration) ? Number(video.duration.toFixed(2)) : null,
            paused: video.paused,
            muted: video.muted,
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            visible: isVisible(video)
          };
        });
      }
    });

    videos = Array.isArray(results?.[0]?.result) ? results[0].result : [];
  } catch (error) {
    directScanError = error instanceof Error ? error.message : String(error);
    console.warn("Direct scan via scripting.executeScript failed; falling back to content script scan.", error);
  }

  if (!videos.length) {
    try {
      await ensureContentScript(tab.id);
      const response = await chrome.tabs.sendMessage(tab.id, { type: "SCAN_VIDEOS" });
      const fallbackVideos = Array.isArray(response?.videos) ? response.videos : [];
      if (fallbackVideos.length) {
        videos = fallbackVideos;
      }
    } catch (fallbackError) {
      const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      if (directScanError) {
        throw new Error(`Scan failed. Direct scan error: ${directScanError}. Fallback scan error: ${fallbackMessage}`);
      }
      throw new Error(`Scan failed: ${fallbackMessage}`);
    }
  }

  const state = await setTabState(tab.id, {
    pageUrl: tab.url || "",
    videos,
    status: videos.length ? "Idle" : "No videos found",
    error: ""
  });

  if (state.selectedVideoId != null && !videos.some((v) => v.id === state.selectedVideoId)) {
    await setTabState(tab.id, { selectedVideoId: null });
  }

  return { tabId: tab.id, pageUrl: tab.url || "", videos };
}

async function setSelectedVideo(tabId, videoId) {
  const state = await getTabState(tabId);
  if (!state.videos.some((v) => v.id === videoId)) {
    throw new Error("Selected video not found in last scan.");
  }

  const next = await setTabState(tabId, {
    selectedVideoId: videoId,
    error: ""
  });

  await sendToContent(tabId, { type: "SET_TARGET_VIDEO", videoId });
  return next;
}

async function getPopupState() {
  const tab = await getActiveTab();
  const state = await getTabState(tab.id);
  return {
    ...state,
    tabId: tab.id,
    pageUrl: tab.url || state.pageUrl || "",
    backendBaseUrl: BACKEND_BASE_URL
  };
}

async function updateStatus(tabId, status, error = "") {
  const next = await setTabState(tabId, { status, error });
  await sendToContent(tabId, {
    type: "SHOW_TRANSLATION_STATUS",
    status,
    error
  }).catch(() => {});
  return next;
}

async function startTranslationForActiveTab(targetLanguage) {
  const tab = await getActiveTab();
  const tabId = tab.id;
  const state = await getTabState(tabId);

  if (state.selectedVideoId == null) {
    throw new Error("Select a target video first.");
  }

  const selectedVideo = state.videos.find((v) => v.id === state.selectedVideoId);
  if (!selectedVideo) {
    throw new Error("Selected video is missing. Scan videos again.");
  }

  const normalizedTargetLanguage = (targetLanguage || state.targetLanguage || "zh").trim() || "zh";
  await setTabState(tabId, { targetLanguage: normalizedTargetLanguage, error: "" });

  await sendToContent(tabId, {
    type: "SET_TARGET_VIDEO",
    videoId: state.selectedVideoId
  });
  await sendToContent(tabId, {
    type: "SHOW_TRANSLATION_STATUS",
    status: "Extracting audio",
    error: ""
  });

  await setTabState(tabId, { status: "Extracting audio", error: "" });

  const payload = {
    pageUrl: tab.url || "",
    videoUrl: selectedVideo.currentSrc || selectedVideo.src || "",
    targetLanguage: normalizedTargetLanguage,
    selectedVideo: {
      id: selectedVideo.id,
      duration: selectedVideo.duration,
      width: selectedVideo.width,
      height: selectedVideo.height
    }
  };

  try {
    const response = await fetch(`${BACKEND_BASE_URL}/api/translate-video`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Backend error ${response.status}${text ? `: ${text}` : ""}`);
    }

    const data = await response.json();
    const cues = Array.isArray(data?.cues) ? data.cues : [];

    await setTabState(tabId, {
      status: "Rendering subtitles",
      error: ""
    });

    await sendToContent(tabId, {
      type: "RENDER_SUBTITLE_CUES",
      videoId: state.selectedVideoId,
      cues,
      language: normalizedTargetLanguage
    });

    await updateStatus(tabId, "Idle", "");

    return { ok: true, cueCount: cues.length, backendResponse: data };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateStatus(tabId, "Error", message);
    throw new Error(message);
  }
}

async function stopTranslationForActiveTab() {
  const tab = await getActiveTab();
  await updateStatus(tab.id, "Idle", "");
  await sendToContent(tab.id, { type: "CLEAR_SUBTITLE_OVERLAY" }).catch(() => {});
  return { ok: true };
}

chrome.tabs.onRemoved.addListener((tabId) => {
  safeRemoveTabState(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    safeRemoveTabState(tabId);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case "GET_POPUP_STATE": {
        sendResponse({ ok: true, state: await getPopupState() });
        return;
      }
      case "SCAN_VIDEOS": {
        const result = await scanVideosOnActiveTab();
        sendResponse({ ok: true, ...result });
        return;
      }
      case "SELECT_VIDEO": {
        const tab = await getActiveTab();
        const state = await setSelectedVideo(tab.id, message.videoId);
        sendResponse({ ok: true, state });
        return;
      }
      case "START_TRANSLATION": {
        const result = await startTranslationForActiveTab(message.targetLanguage);
        sendResponse({ ok: true, ...result });
        return;
      }
      case "STOP_TRANSLATION": {
        const result = await stopTranslationForActiveTab();
        sendResponse({ ok: true, ...result });
        return;
      }
      default:
        sendResponse({ ok: false, error: "Unknown message type." });
    }
  })().catch((error) => {
    console.error("runtime.onMessage handler failed", message?.type, error);
    sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  });

  return true;
});
