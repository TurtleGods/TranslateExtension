const extApi = globalThis.browser ?? globalThis.chrome;

const scanButton = document.getElementById("scanButton");
const translateButton = document.getElementById("translateButton");
const resultLanguageSelect = document.getElementById("resultLanguageSelect");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const translationOutputEl = document.getElementById("translationOutput");
let lastScanData = null;

function setStatus(text) {
  statusEl.textContent = text;
}

function clearResults() {
  resultsEl.innerHTML = "";
}

function setTranslationOutput(value) {
  translationOutputEl.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function getSelectedResultLanguage() {
  return String(resultLanguageSelect?.value || "zh-TW");
}

function formatBackendResultForOutput(backend) {
  const result = backend?.result;
  if (!result) {
    return backend || {};
  }

  if (result.format === "vtt") {
    return result.timedText || "(empty VTT response)";
  }

  if (result.format === "segments") {
    const translatedSegments = result?.translation?.enabled ? result.translation.segments : null;
    if (Array.isArray(translatedSegments) && translatedSegments.length) {
      return translatedSegments
        .map((segment) => `${segment.start?.toFixed?.(2) ?? segment.start} --> ${segment.end?.toFixed?.(2) ?? segment.end}\n${segment.translatedText || segment.text || ""}`)
        .join("\n\n");
    }

    if (Array.isArray(result.segments) && result.segments.length) {
      return result.segments
        .map((segment) => `${segment.start?.toFixed?.(2) ?? segment.start} --> ${segment.end?.toFixed?.(2) ?? segment.end}\n${segment.text || ""}`)
        .join("\n\n");
    }

    return result.transcriptText || "(empty transcript response)";
  }

  return backend;
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

  setStatus(`Selected video ${videoIndex + 1} for future translation flow.`);
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
  translateButton.disabled = true;
  scanButton.disabled = true;
  resultLanguageSelect.disabled = true;
  const resultLanguage = getSelectedResultLanguage();
  setStatus(`Capturing selected video audio sample and sending to backend (${resultLanguage})...`);
  setTranslationOutput("Running prototype...");

  try {
    const isEnglish = resultLanguage === "en";
    const response = await sendRuntimeMessage({
      type: "START_SELECTED_VIDEO_TRANSLATION_PROTOTYPE",
      payload: {
        durationMs: 6000,
        mode: isEnglish ? "translate_to_english" : "transcribe",
        targetLanguage: isEnglish ? "" : resultLanguage
      }
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Prototype translation failed.");
    }

    const data = response.data || {};
    const backendResult = data.backend?.result || {};
    setTranslationOutput(formatBackendResultForOutput(data.backend));

    if (!isEnglish && backendResult?.translation?.enabled !== true) {
      setStatus(
        "Request completed, but Chinese translation is not enabled on backend. Set ENABLE_TEXT_SEGMENT_TRANSLATION=true in server/.env."
      );
      return;
    }

    setStatus(
      `Captured ${data.capture?.bytes || 0} bytes from video ${Number(data.capture?.selectedVideoIndex) + 1} and received ${backendResult.format || "backend"} output.`
    );
  } catch (error) {
    setStatus(`Error: ${error.message || String(error)}`);
    setTranslationOutput(`Error: ${error.message || String(error)}`);
  } finally {
    translateButton.disabled = false;
    scanButton.disabled = false;
    resultLanguageSelect.disabled = false;
  }
}

scanButton.addEventListener("click", onScanClick);
translateButton.addEventListener("click", onTranslateClick);
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
