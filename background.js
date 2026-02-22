const extApi = globalThis.browser ?? globalThis.chrome;

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

  return {
    tab: {
      id: tab.id,
      title: tab.title || "",
      url: tab.url || ""
    },
    ...response
  };
}

extApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "SCAN_ACTIVE_TAB_VIDEOS") {
    return false;
  }

  scanActiveTabVideos()
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));

  return true;
});
