const extApi = globalThis.browser ?? globalThis.chrome;

const scanButton = document.getElementById("scanButton");
const translateButton = document.getElementById("translateButton");
const stopTranslateButton = document.getElementById("stopTranslateButton");
const hideSubtitlesButton = document.getElementById("hideSubtitlesButton");
const resultLanguageSelect = document.getElementById("resultLanguageSelect");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
let lastScanData = null;
let continuousStatusPollTimer = 0;

function setStatus(text) {
  if (statusEl) {
    statusEl.textContent = text;
  }
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

function setContinuousControls({ running }) {
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

  setStatus(`Selected video ${videoIndex + 1} for continuous translation (60s chunks).`);
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

async function onTranslateClick() {
  console.log("Translate button clicked");
  translateButton.disabled = true;
  stopTranslateButton.disabled = true;
  scanButton.disabled = true;

  const resultLanguage = getSelectedResultLanguage();
  const isEnglish = resultLanguage === "en";
  setStatus(`Recording/translating continuously in 60s chunks (${resultLanguage})... Keep the video playing and this tab active.`);

  try {
    const response = await sendRuntimeMessage({
      type: "START_CONTINUOUS_60S_TRANSLATION",
      payload: {
        durationMs: 60000,
        mode: isEnglish ? "translate_to_english" : "transcribe",
        targetLanguage: isEnglish ? "" : resultLanguage,
        autoSeekAfterComplete: true
      }
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Failed to start continuous translation.");
    }

    if (response.data?.alreadyRunning) {
      setStatus("Continuous translation is already running for this tab.");
    } else {
      setStatus("Continuous translation started. Popup will show completed chunk count.");
    }
    setContinuousControls({ running: true });
    ensureContinuousStatusPolling();
    await refreshContinuousTranslationStatus();
  } catch (error) {
    setStatus(`Error: ${error.message || String(error)}`);
    setContinuousControls({ running: false });
  } finally {
    scanButton.disabled = false;
  }
}

async function onStopTranslateClick() {
  stopTranslateButton.disabled = true;
  setStatus("Stopping translation... The current 60s chunk may need to finish first.");

  try {
    const response = await sendRuntimeMessage({ type: "STOP_CONTINUOUS_60S_TRANSLATION" });
    if (!response?.ok) {
      throw new Error(response?.error || "Failed to stop translation.");
    }
    await refreshContinuousTranslationStatus();
  } catch (error) {
    setStatus(`Error: ${error.message || String(error)}`);
  }
}

async function refreshContinuousTranslationStatus() {
  const response = await sendRuntimeMessage({ type: "GET_CONTINUOUS_60S_TRANSLATION_STATUS" });
  if (!response?.ok) {
    throw new Error(response?.error || "Failed to get translation status.");
  }

  const data = response.data || {};
  const running = !!data.running && !data.stopRequested;
  setContinuousControls({ running });

  if (running) {
    setStatus(
      `Translating... completed chunks: ${Number(data.completedSegments || 0)}, captured chunks: ${Number(data.capturedSegments || 0)}, subtitles: ${Number(data.lastOverlayCueCount || 0)} cues`
    );
    return data;
  }

  if (data.stopRequested && !data.finished) {
    setStatus(
      `Stopping... completed chunks: ${Number(data.completedSegments || 0)}, captured chunks: ${Number(data.capturedSegments || 0)}`
    );
    return data;
  }

  if (data.finished) {
    if (data.lastError) {
      setStatus(`Stopped with error after ${Number(data.completedSegments || 0)} chunks: ${data.lastError}`);
    } else if (data.finishedReason === "video_end") {
      setStatus(`Completed at video end. Total chunks: ${Number(data.completedSegments || 0)}.`);
    } else if (data.finishedReason === "manual_stop") {
      setStatus(`Stopped. Total completed chunks: ${Number(data.completedSegments || 0)}.`);
    } else {
      setStatus(`Translation finished. Total completed chunks: ${Number(data.completedSegments || 0)}.`);
    }
    setContinuousControls({ running: false });
    return data;
  }

  setContinuousControls({ running: false });
  return data;
}

function ensureContinuousStatusPolling() {
  if (continuousStatusPollTimer) {
    return;
  }

  continuousStatusPollTimer = globalThis.setInterval(() => {
    refreshContinuousTranslationStatus().catch(() => {});
  }, 3000);
}

async function onHideSubtitlesClick() {
  hideSubtitlesButton.disabled = true;
  setStatus("Hiding subtitles...");

  try {
    const response = await sendRuntimeMessage({ type: "CLEAR_SELECTED_VIDEO_SUBTITLES" });
    if (!response?.ok) {
      throw new Error(response?.error || "Failed to hide subtitles.");
    }

    setStatus(`Subtitles hidden for video ${Number(response.data?.videoIndex) + 1}.`);
  } catch (error) {
    setStatus(`Error: ${error.message || String(error)}`);
  } finally {
    hideSubtitlesButton.disabled = false;
  }
}

scanButton.addEventListener("click", onScanClick);
translateButton.addEventListener("click", onTranslateClick);
stopTranslateButton.addEventListener("click", onStopTranslateClick);
hideSubtitlesButton.addEventListener("click", onHideSubtitlesClick);

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

setContinuousControls({ running: false });
ensureContinuousStatusPolling();
refreshContinuousTranslationStatus().catch(() => {});
