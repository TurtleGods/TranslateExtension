const extApi = globalThis.browser ?? globalThis.chrome;
const SELECTED_VIDEO_STORAGE_KEY = "selectedVideoByTabId";

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

  return false;
});
