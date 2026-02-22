const extApi = globalThis.browser ?? globalThis.chrome;

const scanButton = document.getElementById("scanButton");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");

function setStatus(text) {
  statusEl.textContent = text;
}

function clearResults() {
  resultsEl.innerHTML = "";
}

function addResultItem(html) {
  const li = document.createElement("li");
  li.innerHTML = html;
  resultsEl.appendChild(li);
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

  const videos = scanData?.videos || [];
  if (videos.length === 0) {
    addResultItem('<span class="empty">No video elements found on this page.</span>');
    return;
  }

  videos.forEach((video) => {
    const src = video.src ? `<code>${escapeHtml(video.src)}</code>` : "<em>No src</em>";
    addResultItem(
      [
        `<strong>Video ${video.index + 1}</strong>`,
        `Visible: ${video.visible ? "Yes" : "No"} | ${video.width}x${video.height}`,
        `Paused: ${video.paused ? "Yes" : "No"} | Duration: ${video.duration ?? "unknown"}s`,
        `Source: ${src}`
      ].join("<br>")
    );
  });
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

scanButton.addEventListener("click", onScanClick);
