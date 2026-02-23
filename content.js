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

  function pickSupportedAudioMimeType() {
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/ogg;codecs=opus",
      "audio/webm",
      "audio/ogg"
    ];

    if (!globalThis.MediaRecorder?.isTypeSupported) {
      return "";
    }

    for (const candidate of candidates) {
      if (globalThis.MediaRecorder.isTypeSupported(candidate)) {
        return candidate;
      }
    }

    return "";
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Failed to read recorded audio."));
      reader.onload = () => {
        const result = String(reader.result || "");
        const commaIndex = result.indexOf(",");
        resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
      };
      reader.readAsDataURL(blob);
    });
  }

  async function captureVideoAudioSample({ videoIndex, durationMs = 6000 }) {
    if (!Number.isInteger(videoIndex) || videoIndex < 0) {
      throw new Error("Invalid video index for audio capture.");
    }

    const videos = Array.from(document.querySelectorAll("video"));
    const video = videos[videoIndex];
    if (!video) {
      throw new Error("Selected video was not found on the page.");
    }

    const captureStreamFn = video.captureStream || video.mozCaptureStream;
    if (typeof captureStreamFn !== "function") {
      throw new Error("This browser/page does not support video.captureStream() for the selected video.");
    }

    if (typeof globalThis.MediaRecorder !== "function") {
      throw new Error("MediaRecorder is not available in this browser.");
    }

    const capturedStream = captureStreamFn.call(video);
    const audioTracks = capturedStream.getAudioTracks();
    if (!audioTracks.length) {
      throw new Error("No audio track detected on the selected video. Play the video first and try again.");
    }

    const audioStream = new MediaStream(audioTracks);
    const chunks = [];
    const mimeType = pickSupportedAudioMimeType();
    const recorder = mimeType ? new MediaRecorder(audioStream, { mimeType }) : new MediaRecorder(audioStream);
    const startedAt = Date.now();

    const stopAllTracks = () => {
      for (const track of capturedStream.getTracks()) {
        track.stop();
      }
      for (const track of audioStream.getTracks()) {
        track.stop();
      }
    };

    const recordedBlob = await new Promise((resolve, reject) => {
      let timeoutId = null;

      recorder.addEventListener("dataavailable", (event) => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data);
        }
      });

      recorder.addEventListener("error", () => {
        if (timeoutId) {
          globalThis.clearTimeout(timeoutId);
        }
        stopAllTracks();
        reject(new Error("MediaRecorder failed while capturing video audio."));
      });

      recorder.addEventListener("stop", () => {
        if (timeoutId) {
          globalThis.clearTimeout(timeoutId);
        }
        stopAllTracks();

        if (!chunks.length) {
          reject(new Error("No audio data captured. Make sure the selected video is playing and has audible audio."));
          return;
        }

        resolve(new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" }));
      });

      recorder.start(250);
      timeoutId = globalThis.setTimeout(() => {
        if (recorder.state !== "inactive") {
          recorder.stop();
        }
      }, Math.max(500, Number(durationMs) || 6000));
    });

    const audioBase64 = await blobToBase64(recordedBlob);

    return {
      ok: true,
      capturedAt: new Date().toISOString(),
      videoIndex,
      durationMsRequested: Math.max(500, Number(durationMs) || 6000),
      durationMsActual: Date.now() - startedAt,
      bytes: recordedBlob.size,
      mimeType: recordedBlob.type || mimeType || "audio/webm",
      audioBase64
    };
  }

  const runtimeApi = globalThis.browser ?? globalThis.chrome;
  runtimeApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "SCAN_VIDEOS") {
      sendResponse(scanVideos());
      return false;
    }

    if (message?.type === "CAPTURE_VIDEO_AUDIO_SAMPLE") {
      captureVideoAudioSample({
        videoIndex: message.videoIndex,
        durationMs: message.durationMs
      })
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
      return true;
    }

    return false;
  });
})();
