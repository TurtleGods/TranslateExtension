(function initContentScript() {
  if (globalThis.__translateVideoDetectorLoaded) {
    return;
  }
  globalThis.__translateVideoDetectorLoaded = true;

  function isVisible(element) {
    const style = globalThis.getComputedStyle(element);
    const rect = element.getBoundingClientRect();

    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
      return false;
    }

    return rect.width > 0 && rect.height > 0;
  }

  function toNumberOrNull(value) {
    return Number.isFinite(value) ? value : null;
  }

  function scanVideos() {
    const videos = Array.from(document.querySelectorAll("video"));

    return {
      count: videos.length,
      scannedAt: new Date().toISOString(),
      videos: videos.map((video, index) => {
        const rect = video.getBoundingClientRect();
        return {
          index,
          src: video.currentSrc || video.src || null,
          currentTime: toNumberOrNull(video.currentTime),
          duration: toNumberOrNull(video.duration),
          paused: !!video.paused,
          muted: !!video.muted,
          volume: toNumberOrNull(video.volume),
          readyState: video.readyState,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          visible: isVisible(video)
        };
      })
    };
  }

  const runtimeApi = globalThis.browser ?? globalThis.chrome;
  runtimeApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "SCAN_VIDEOS") {
      return false;
    }

    sendResponse(scanVideos());
    return false;
  });
})();
