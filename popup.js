const els = {
  scanBtn: document.getElementById("scanBtn"),
  refreshBtn: document.getElementById("refreshBtn"),
  startBtn: document.getElementById("startBtn"),
  stopBtn: document.getElementById("stopBtn"),
  targetLanguage: document.getElementById("targetLanguage"),
  videoList: document.getElementById("videoList"),
  videoCount: document.getElementById("videoCount"),
  statusLine: document.getElementById("statusLine"),
  errorLine: document.getElementById("errorLine"),
  pageUrl: document.getElementById("pageUrl"),
  backendLine: document.getElementById("backendLine")
};

let popupState = {
  tabId: null,
  pageUrl: "",
  videos: [],
  selectedVideoId: null,
  targetLanguage: "zh",
  status: "Idle",
  error: "",
  backendBaseUrl: "http://localhost:8787"
};

function sendMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response?.ok) {
        reject(new Error(response?.error || "Unknown error"));
        return;
      }
      resolve(response);
    });
  });
}

function formatDuration(value) {
  if (typeof value !== "number" || Number.isNaN(value)) return "unknown";
  const sec = Math.round(value);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

function shortenUrl(url) {
  if (!url) return "(no src)";
  return url.length > 90 ? `${url.slice(0, 87)}...` : url;
}

function renderVideos() {
  const { videos, selectedVideoId } = popupState;
  els.videoCount.textContent = String(videos.length);

  if (!videos.length) {
    els.videoList.className = "video-list empty";
    els.videoList.textContent = "No videos found. Click Scan Videos.";
    return;
  }

  els.videoList.className = "video-list";
  els.videoList.textContent = "";

  videos.forEach((video) => {
    const item = document.createElement("div");
    item.className = "video-item";

    const label = document.createElement("label");
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "selectedVideo";
    radio.value = video.id;
    radio.checked = video.id === selectedVideoId;

    radio.addEventListener("change", async () => {
      if (!radio.checked) return;
      await runAction(async () => {
        await sendMessage({ type: "SELECT_VIDEO", videoId: video.id });
        popupState.selectedVideoId = video.id;
      });
      render();
    });

    const meta = document.createElement("div");
    meta.className = "video-meta";

    const title = document.createElement("div");
    title.className = "video-title";
    title.textContent = `Video ${video.index + 1}${video.visible ? "" : " (hidden)"}`;

    const line1 = document.createElement("div");
    line1.className = "video-sub";
    line1.textContent = `${video.width}x${video.height} | ${formatDuration(video.duration)} | ${video.paused ? "paused" : "playing"}`;

    const line2 = document.createElement("div");
    line2.className = "video-sub";
    line2.textContent = shortenUrl(video.currentSrc || video.src);

    meta.append(title, line1, line2);
    label.append(radio, meta);
    item.append(label);
    els.videoList.append(item);
  });
}

function renderStatus() {
  els.statusLine.textContent = `Status: ${popupState.status || "Idle"}`;

  if (popupState.error) {
    els.errorLine.hidden = false;
    els.errorLine.textContent = popupState.error;
  } else {
    els.errorLine.hidden = true;
    els.errorLine.textContent = "";
  }
}

function renderMeta() {
  els.pageUrl.textContent = popupState.pageUrl ? `Page: ${shortenUrl(popupState.pageUrl)}` : "Page: (unknown)";
  els.targetLanguage.value = popupState.targetLanguage || "zh";
  els.backendLine.textContent = `Backend: ${popupState.backendBaseUrl}`;
}

function render() {
  renderMeta();
  renderVideos();
  renderStatus();
}

async function loadState() {
  const response = await sendMessage({ type: "GET_POPUP_STATE" });
  popupState = { ...popupState, ...response.state };
  render();
}

async function runAction(fn) {
  try {
    popupState.error = "";
    renderStatus();
    await fn();
  } catch (error) {
    popupState.error = error instanceof Error ? error.message : String(error);
    popupState.status = "Error";
  } finally {
    await loadState().catch(() => {
      render();
    });
  }
}

els.scanBtn.addEventListener("click", async () => {
  await runAction(async () => {
    const response = await sendMessage({ type: "SCAN_VIDEOS" });
    popupState.videos = response.videos || [];
    popupState.pageUrl = response.pageUrl || "";
    popupState.status = popupState.videos.length ? "Idle" : "No videos found";
  });
});

els.refreshBtn.addEventListener("click", async () => {
  await runAction(async () => {
    await loadState();
  });
});

els.startBtn.addEventListener("click", async () => {
  await runAction(async () => {
    popupState.status = "Extracting audio";
    popupState.targetLanguage = (els.targetLanguage.value || "zh").trim() || "zh";
    renderStatus();

    const response = await sendMessage({
      type: "START_TRANSLATION",
      targetLanguage: popupState.targetLanguage
    });

    if (typeof response.cueCount === "number") {
      popupState.status = `Idle (${response.cueCount} cues)`;
    }
  });
});

els.stopBtn.addEventListener("click", async () => {
  await runAction(async () => {
    await sendMessage({ type: "STOP_TRANSLATION" });
    popupState.status = "Idle";
    popupState.error = "";
  });
});

document.addEventListener("DOMContentLoaded", () => {
  loadState().catch((error) => {
    popupState.status = "Error";
    popupState.error = error instanceof Error ? error.message : String(error);
    render();
  });
});

