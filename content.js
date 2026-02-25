(() => {
  if (window.__videoAudioTranslatorInjected) {
    return;
  }
  window.__videoAudioTranslatorInjected = true;

  const STATE = {
    selectedVideoId: null,
    subtitlesByVideoId: new Map(),
    listenersBound: new Set()
  };

  function getVideos() {
    return Array.from(document.querySelectorAll("video"));
  }

  function getVideoId(index) {
    return `video-${index}`;
  }

  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0"
    );
  }

  function ensureContainer(video) {
    const parent = video.parentElement;
    if (!parent) return null;

    const style = window.getComputedStyle(parent);
    if (style.position === "static") {
      parent.dataset.vatOriginalPosition = "static";
      parent.style.position = "relative";
    }
    return parent;
  }

  function overlayId(videoId) {
    return `vat-overlay-${videoId}`;
  }

  function ensureOverlay(videoId) {
    const videos = getVideos();
    const index = Number(videoId.split("-")[1]);
    const video = videos[index];
    if (!video) return null;

    const container = ensureContainer(video);
    if (!container) return null;

    let overlay = container.querySelector(`#${CSS.escape(overlayId(videoId))}`);
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = overlayId(videoId);
      overlay.className = "vat-overlay";
      overlay.innerHTML = `
        <div class="vat-status"></div>
        <div class="vat-subtitle"></div>
      `;
      container.appendChild(overlay);
    }

    bindTimeUpdate(videoId, video, overlay);
    return { overlay, video };
  }

  function bindTimeUpdate(videoId, video, overlay) {
    if (STATE.listenersBound.has(videoId)) return;
    const subtitleEl = overlay.querySelector(".vat-subtitle");
    if (!subtitleEl) return;

    video.addEventListener("timeupdate", () => {
      const cues = STATE.subtitlesByVideoId.get(videoId) || [];
      const t = video.currentTime;
      const cue = cues.find((item) => t >= item.start && t <= item.end);
      subtitleEl.textContent = cue ? cue.text : "";
    });

    STATE.listenersBound.add(videoId);
  }

  function setTargetVideo(videoId) {
    STATE.selectedVideoId = videoId;
    for (const [idx, video] of getVideos().entries()) {
      const id = getVideoId(idx);
      if (id === videoId) {
        video.dataset.vatSelected = "true";
        video.style.outline = "2px solid #0ea5e9";
        video.style.outlineOffset = "2px";
        ensureOverlay(videoId);
      } else if (video.dataset.vatSelected === "true") {
        delete video.dataset.vatSelected;
        video.style.outline = "";
        video.style.outlineOffset = "";
      }
    }
  }

  function setStatus(status, error) {
    if (!STATE.selectedVideoId) return;
    const bundle = ensureOverlay(STATE.selectedVideoId);
    if (!bundle) return;
    const statusEl = bundle.overlay.querySelector(".vat-status");
    if (!statusEl) return;
    statusEl.textContent = error ? `${status}: ${error}` : status;
    statusEl.style.display = status || error ? "block" : "none";
  }

  function clearOverlay() {
    if (!STATE.selectedVideoId) return;
    const bundle = ensureOverlay(STATE.selectedVideoId);
    if (!bundle) return;
    const statusEl = bundle.overlay.querySelector(".vat-status");
    const subtitleEl = bundle.overlay.querySelector(".vat-subtitle");
    if (statusEl) statusEl.textContent = "";
    if (subtitleEl) subtitleEl.textContent = "";
    STATE.subtitlesByVideoId.set(STATE.selectedVideoId, []);
  }

  function normalizeCue(cue) {
    return {
      start: Number(cue.start || 0),
      end: Number(cue.end || 0),
      text: String(cue.text || "").trim()
    };
  }

  function renderCues(videoId, cues) {
    const normalized = cues
      .map(normalizeCue)
      .filter((cue) => cue.text && Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.end >= cue.start)
      .sort((a, b) => a.start - b.start);

    STATE.subtitlesByVideoId.set(videoId, normalized);
    STATE.selectedVideoId = videoId;

    const bundle = ensureOverlay(videoId);
    if (!bundle) return { cueCount: 0 };

    const currentCue = normalized.find(
      (cue) => bundle.video.currentTime >= cue.start && bundle.video.currentTime <= cue.end
    );
    const subtitleEl = bundle.overlay.querySelector(".vat-subtitle");
    if (subtitleEl) {
      subtitleEl.textContent = currentCue ? currentCue.text : "";
    }

    return { cueCount: normalized.length };
  }

  function scanVideos() {
    const videos = getVideos();
    return videos.map((video, index) => {
      const rect = video.getBoundingClientRect();
      return {
        id: getVideoId(index),
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

  function injectStyles() {
    if (document.getElementById("vat-styles")) return;
    const style = document.createElement("style");
    style.id = "vat-styles";
    style.textContent = `
      .vat-overlay {
        position: absolute;
        inset: 0;
        pointer-events: none;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        gap: 8px;
        padding: 12px;
        box-sizing: border-box;
        z-index: 2147483646;
      }
      .vat-status {
        align-self: flex-start;
        max-width: 100%;
        color: #fff;
        background: rgba(0, 0, 0, 0.72);
        border: 1px solid rgba(255, 255, 255, 0.18);
        border-radius: 6px;
        padding: 6px 8px;
        font: 12px/1.3 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        display: none;
      }
      .vat-subtitle {
        align-self: center;
        max-width: min(90%, 980px);
        color: #fff;
        background: rgba(0, 0, 0, 0.7);
        border-radius: 8px;
        padding: 8px 12px;
        text-align: center;
        font: 600 20px/1.35 "Noto Sans TC", "Microsoft JhengHei", sans-serif;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
        white-space: pre-wrap;
      }
    `;
    document.documentElement.appendChild(style);
  }

  injectStyles();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    switch (message?.type) {
      case "PING":
        sendResponse({ ok: true });
        return;
      case "SCAN_VIDEOS":
        sendResponse({ ok: true, videos: scanVideos() });
        return;
      case "SET_TARGET_VIDEO":
        setTargetVideo(message.videoId);
        sendResponse({ ok: true });
        return;
      case "SHOW_TRANSLATION_STATUS":
        setStatus(String(message.status || ""), String(message.error || ""));
        sendResponse({ ok: true });
        return;
      case "RENDER_SUBTITLE_CUES":
        sendResponse({ ok: true, ...renderCues(message.videoId, Array.isArray(message.cues) ? message.cues : []) });
        return;
      case "CLEAR_SUBTITLE_OVERLAY":
        clearOverlay();
        sendResponse({ ok: true });
        return;
      default:
        sendResponse({ ok: false, error: "Unknown content message." });
    }
  });
})();

