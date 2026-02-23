const extApi = globalThis.browser ?? globalThis.chrome;

const scanButton = document.getElementById("scanButton");
const translateButton = document.getElementById("translateButton");
const stopTranslateButton = document.getElementById("stopTranslateButton");
const resultLanguageSelect = document.getElementById("resultLanguageSelect");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
let lastScanData = null;
let liveStatusPollTimer = 0;

function setStatus(text) {
  statusEl.textContent = text;
}

function clearResults() {
  resultsEl.innerHTML = "";
}

function getSelectedResultLanguage() {
  return String(resultLanguageSelect?.value || "zh-TW");
}

function addResultItem(html, options = {}) {
  const li = document.createElement("li");
  li.innerHTML = html;
  if (options.className) {
    li.className = options.className;
  }
  if (options.videoIndex !== undefined) {
    li.dataset.videoIndex = String(options.videoIndex);
  }
  resultsEl.appendChild(li);
  return li;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sendRuntimeMessage(message) {
  if (extApi.runtime.sendMessage.length <= 1) {
    return extApi.runtime.sendMessage(message);
  }

  return new Promise((resolve, reject) => {
    extApi.runtime.sendMessage(message, (response) => {
      const err = globalThis.chrome?.runtime?.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve(response);
    });
  });
}

function setLiveControlState({ running }) {
  translateButton.disabled = !!running;
  stopTranslateButton.disabled = !running;
  resultLanguageSelect.disabled = !!running;
}

function renderResults(scanData) {
  clearResults();
  lastScanData = scanData;

  const videos = scanData?.videos || [];
  if (videos.length === 0) {
    addResultItem('<span class="empty">No video elements found on this page.</span>');
    return;
  }

  videos.forEach((video) => {
    const src = video.src ? `<code>${escapeHtml(video.src)}</code>` : "<em>No src</em>";
    const isSelected = scanData?.selectedVideoIndex === video.index;
    addResultItem(
      [
        `<strong>Video ${video.index + 1}</strong>`,
        `Visible: ${video.visible ? "Yes" : "No"} | ${video.width}x${video.height}`,
        `Paused: ${video.paused ? "Yes" : "No"} | Duration: ${video.duration ?? "unknown"}s`,
        `Source: ${src}`,
        isSelected ? '<span class="selected-pill">Selected for translation</span>' : "",
        `<div class="result-actions"><button type="button" data-action="select-video" data-video-index="${video.index}">Select This Video</button></div>`
      ].filter(Boolean).join("<br>"),
      {
        className: isSelected ? "selected" : "",
        videoIndex: video.index
      }
    );
  });
}

async function onSelectVideo(videoIndex) {
  setStatus(`Selecting video ${videoIndex + 1}...`);

  const response = await sendRuntimeMessage({
    type: "SET_ACTIVE_TAB_TARGET_VIDEO",
    videoIndex
  });

  if (!response?.ok) {
    throw new Error(response?.error || "Failed to select video.");
  }

  if (lastScanData) {
    lastScanData = { ...lastScanData, selectedVideoIndex: videoIndex };
    renderResults(lastScanData);
  }

  setStatus(`Selected video ${videoIndex + 1} for live translation.`);
}

async function onScanClick() {
  scanButton.disabled = true;
  setStatus("Scanning active tab...");
  clearResults();

  try {
    const response = await sendRuntimeMessage({ type: "SCAN_ACTIVE_TAB_VIDEOS" });
    if (!response?.ok) {
      throw new Error(response?.error || "Scan failed.");
    }

    const { tab, count, scannedAt } = response.data;
    renderResults(response.data);
    setStatus(`Found ${count} video(s) in "${tab.title || tab.url}" at ${new Date(scannedAt).toLocaleTimeString()}.`);
  } catch (error) {
    setStatus(`Error: ${error.message || String(error)}`);
    addResultItem('<span class="empty">Scan did not complete.</span>');
  } finally {
    scanButton.disabled = false;
  }
}

async function refreshLiveTranslationStatus() {
  const response = await sendRuntimeMessage({ type: "GET_SELECTED_VIDEO_TRANSLATION_LIVE_STATUS" });
  if (!response?.ok) {
    throw new Error(response?.error || "Failed to get live translation status.");
  }

  const data = response.data || {};
  const running = !!data.running && !data.stopRequested;
  setLiveControlState({ running });

  if (running) {
    setStatus(
      `Live translating... chunks: ${Number(data.chunkIndex || 0)}, overlay cues: ${Number(data.lastOverlayCueCount || 0)}`
    );
  } else if (data.lastError) {
    setStatus(`Live translation stopped: ${data.lastError}`);
  }

  return data;
}

function ensureLiveStatusPolling() {
  if (liveStatusPollTimer) {
    return;
  }

  liveStatusPollTimer = globalThis.setInterval(() => {
    refreshLiveTranslationStatus().catch((error) => {
      setStatus(`Status error: ${error.message || String(error)}`);
    });
  }, 1500);
}

async function onTranslateClick() {
  translateButton.disabled = true;
  stopTranslateButton.disabled = true;
  scanButton.disabled = true;

  const resultLanguage = getSelectedResultLanguage();
  setStatus(`Starting live translation (${resultLanguage})...`);

  try {
    const isEnglish = resultLanguage === "en";
    const response = await sendRuntimeMessage({
      type: "START_SELECTED_VIDEO_TRANSLATION_LIVE",
      payload: {
        durationMs: 4000,
        mode: isEnglish ? "translate_to_english" : "transcribe",
        targetLanguage: isEnglish ? "" : resultLanguage
      }
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Failed to start live translation.");
    }

    const data = response.data || {};
    if (data.alreadyRunning) {
      setStatus("Live translation is already running for this tab.");
    } else {
      setStatus(`Live translation started for video ${Number(data.videoIndex) + 1}. Subtitles will appear on the page.`);
    }

    await refreshLiveTranslationStatus();
    ensureLiveStatusPolling();
  } catch (error) {
    setStatus(`Error: ${error.message || String(error)}`);
    setLiveControlState({ running: false });
  } finally {
    scanButton.disabled = false;
  }
}

async function onStopTranslateClick() {
  stopTranslateButton.disabled = true;
  setStatus("Stopping live translation...");

  try {
    const response = await sendRuntimeMessage({ type: "STOP_SELECTED_VIDEO_TRANSLATION_LIVE" });
    if (!response?.ok) {
      throw new Error(response?.error || "Failed to stop live translation.");
    }

    setStatus("Stop requested. The current chunk may finish before updates stop.");
    await refreshLiveTranslationStatus();
  } catch (error) {
    setStatus(`Error: ${error.message || String(error)}`);
  }
}

scanButton.addEventListener("click", onScanClick);
translateButton.addEventListener("click", onTranslateClick);
stopTranslateButton.addEventListener("click", onStopTranslateClick);

resultsEl.addEventListener("click", async (event) => {
  const button = event.target.closest('button[data-action="select-video"]');
  if (!button) {
    return;
  }

  const videoIndex = Number(button.dataset.videoIndex);
  if (!Number.isInteger(videoIndex)) {
    return;
  }

  button.disabled = true;
  try {
    await onSelectVideo(videoIndex);
  } catch (error) {
    setStatus(`Error: ${error.message || String(error)}`);
  } finally {
    button.disabled = false;
  }
});

setLiveControlState({ running: false });
ensureLiveStatusPolling();
refreshLiveTranslationStatus().catch(() => {});
