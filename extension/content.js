const TRACK_ID = "translate-extension-track";
const STATUS_ID = "translate-extension-status";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "GET_VIDEO_CONTEXT") {
    const video = findBestVideo();
    sendResponse({
      hasVideo: Boolean(video),
      pageUrl: window.location.href,
      title: document.title
    });
    return true;
  }

  if (message?.type === "APPLY_SUBTITLES") {
    try {
      const video = findBestVideo();
      if (!video) {
        sendResponse({ ok: false, error: "No <video> element is available to attach subtitles." });
        return true;
      }

      applyTrack(video, message);
      sendResponse({ ok: true });
    } catch (error) {
      sendResponse({ ok: false, error: error.message });
    }
    return true;
  }

  return false;
});

function findBestVideo() {
  const videos = [...document.querySelectorAll("video")];
  if (!videos.length) {
    return null;
  }

  const playing = videos.find((video) => !video.paused && !video.ended);
  return playing || videos[0];
}

function applyTrack(video, payload) {
  const existing = document.getElementById(TRACK_ID);
  if (existing) {
    existing.remove();
  }

  const blob = new Blob([payload.vtt], { type: "text/vtt" });
  const blobUrl = URL.createObjectURL(blob);

  const track = document.createElement("track");
  track.id = TRACK_ID;
  track.kind = "subtitles";
  track.label = payload.trackLabel || "Translated";
  track.srclang = payload.trackLanguage || "und";
  track.src = blobUrl;
  track.default = true;

  video.appendChild(track);

  const activateTrack = () => {
    for (const textTrack of video.textTracks) {
      textTrack.mode = "disabled";
    }
    const newestTrack = video.textTracks[video.textTracks.length - 1];
    if (newestTrack) {
      newestTrack.mode = "showing";
    }
  };

  track.addEventListener("load", activateTrack, { once: true });
  setTimeout(activateTrack, 150);
  showStatus(`Applied ${track.label} subtitles`);
}

function showStatus(text) {
  let status = document.getElementById(STATUS_ID);
  if (!status) {
    status = document.createElement("div");
    status.id = STATUS_ID;
    status.style.position = "fixed";
    status.style.right = "16px";
    status.style.bottom = "16px";
    status.style.zIndex = "2147483647";
    status.style.background = "rgba(17, 24, 39, 0.9)";
    status.style.color = "#f9fafb";
    status.style.padding = "10px 14px";
    status.style.borderRadius = "10px";
    status.style.fontFamily = "Segoe UI, sans-serif";
    status.style.fontSize = "13px";
    status.style.boxShadow = "0 8px 24px rgba(0, 0, 0, 0.22)";
    document.documentElement.appendChild(status);
  }

  status.textContent = text;
  status.hidden = false;

  window.clearTimeout(showStatus.timer);
  showStatus.timer = window.setTimeout(() => {
    status.hidden = true;
  }, 3000);
}

showStatus.timer = 0;
