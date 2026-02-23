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

  function parseVttTimestamp(value) {
    const text = String(value || "").trim().replace(",", ".");
    const parts = text.split(":");
    if (parts.length < 2 || parts.length > 3) {
      return NaN;
    }

    const numbers = parts.map((part) => Number(part));
    if (numbers.some((num) => !Number.isFinite(num))) {
      return NaN;
    }

    if (numbers.length === 2) {
      const [minutes, seconds] = numbers;
      return minutes * 60 + seconds;
    }

    const [hours, minutes, seconds] = numbers;
    return hours * 3600 + minutes * 60 + seconds;
  }

  function parseVttCues(vttText) {
    const text = String(vttText || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const lines = text.split("\n");
    const cues = [];

    let i = 0;
    while (i < lines.length) {
      let line = lines[i].trim();

      if (!line || line === "WEBVTT" || line.startsWith("NOTE")) {
        i += 1;
        continue;
      }

      if (!line.includes("-->") && i + 1 < lines.length && lines[i + 1].includes("-->")) {
        i += 1;
        line = lines[i].trim();
      }

      if (!line.includes("-->")) {
        i += 1;
        continue;
      }

      const [rawStart, rawEndWithSettings] = line.split("-->");
      const start = parseVttTimestamp(rawStart);
      const end = parseVttTimestamp(String(rawEndWithSettings || "").trim().split(/\s+/)[0]);
      i += 1;

      const textLines = [];
      while (i < lines.length && lines[i].trim() !== "") {
        textLines.push(lines[i]);
        i += 1;
      }

      if (Number.isFinite(start) && Number.isFinite(end)) {
        cues.push({
          start,
          end,
          text: textLines.join("\n").trim()
        });
      }
    }

    return cues;
  }

  function normalizeCuesFromBackend(result) {
    if (!result || typeof result !== "object") {
      return [];
    }

    if (result.format === "vtt") {
      return parseVttCues(result.timedText || "");
    }

    if (result.format === "segments") {
      const translatedSegments = result?.translation?.enabled ? result.translation.segments : null;
      const inputSegments = Array.isArray(translatedSegments) ? translatedSegments : result.segments;
      if (!Array.isArray(inputSegments)) {
        return [];
      }

      return inputSegments
        .map((segment) => ({
          start: Number(segment?.start ?? 0),
          end: Number(segment?.end ?? 0),
          text: String(segment?.translatedText || segment?.text || "").trim()
        }))
        .filter((cue) => Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.text);
    }

    return [];
  }

  function normalizeCueTextForCompare(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/[.,!?;:()[\]{}"'`~\-]/g, "")
      .trim();
  }

  function trimLeadingRelativeCues(cues, trimLeadingSeconds = 0) {
    const trim = Math.max(0, Number(trimLeadingSeconds) || 0);
    if (!trim) {
      return cues;
    }

    return cues
      .map((cue) => ({
        ...cue,
        start: Math.max(0, cue.start),
        end: Math.max(0, cue.end)
      }))
      .filter((cue) => cue.end > trim)
      .map((cue) => ({
        ...cue,
        start: Math.max(cue.start, trim)
      }))
      .filter((cue) => cue.end > cue.start);
  }

  function formatCueWindowText(cues, nowRelativeSeconds) {
    const active = cues.filter((cue) => nowRelativeSeconds >= cue.start && nowRelativeSeconds <= cue.end);
    if (active.length === 0) {
      // Keep the most recent cue briefly to reduce flicker between chunk boundaries.
      const recent = cues
        .filter((cue) => nowRelativeSeconds > cue.end && nowRelativeSeconds - cue.end <= 0.9)
        .sort((a, b) => b.end - a.end)
        .slice(0, 1);
      return recent.length ? recent[0].text : "";
    }
    return active.map((cue) => cue.text).join("\n");
  }

  function ensureOverlayState(video) {
    if (!globalThis.__translateVideoOverlayState) {
      globalThis.__translateVideoOverlayState = new WeakMap();
    }

    const existing = globalThis.__translateVideoOverlayState.get(video);
    if (existing) {
      return existing;
    }

    const container = document.createElement("div");
    container.className = "translate-video-subtitle-overlay";
    Object.assign(container.style, {
      position: "fixed",
      left: "0px",
      top: "0px",
      width: "0px",
      height: "0px",
      pointerEvents: "none",
      zIndex: "2147483647",
      display: "none"
    });

    const box = document.createElement("div");
    Object.assign(box.style, {
      position: "absolute",
      left: "50%",
      top: "80%",
      transform: "translate(-50%, -50%)",
      maxWidth: "92%",
      padding: "0.45em 0.8em",
      borderRadius: "0.35em",
      background: "rgba(0, 0, 0, 0.72)",
      color: "#fff",
      fontWeight: "600",
      textAlign: "center",
      lineHeight: "1.35",
      whiteSpace: "pre-wrap",
      textShadow: "0 1px 2px rgba(0,0,0,0.75)",
      fontFamily: "Segoe UI, sans-serif",
      fontSize: "16px"
    });

    container.appendChild(box);
    document.documentElement.appendChild(container);

    const state = {
      container,
      box,
      cues: [],
      rafId: 0,
      lastText: "",
      disposed: false
    };

    globalThis.__translateVideoOverlayState.set(video, state);
    return state;
  }

  function ensureCaptureSourceState(video) {
    if (!globalThis.__translateVideoCaptureSourceState) {
      globalThis.__translateVideoCaptureSourceState = new WeakMap();
    }

    const existing = globalThis.__translateVideoCaptureSourceState.get(video);
    const existingTrack = existing?.capturedAudioTracks?.find((track) => track?.readyState === "live");
    if (existing && existingTrack) {
      return existing;
    }

    const captureStreamFn = video.captureStream || video.mozCaptureStream;
    if (typeof captureStreamFn !== "function") {
      throw new Error("This browser/page does not support video.captureStream() for the selected video.");
    }

    const capturedStream = captureStreamFn.call(video);
    const capturedAudioTracks = capturedStream.getAudioTracks();
    if (!capturedAudioTracks.length) {
      throw new Error("No audio track detected on the selected video. Play the video first and try again.");
    }

    const state = {
      capturedStream,
      capturedAudioTracks
    };
    globalThis.__translateVideoCaptureSourceState.set(video, state);
    return state;
  }

  async function releaseCaptureSourceState(video, { tryResumePlayback = true } = {}) {
    const state = globalThis.__translateVideoCaptureSourceState?.get?.(video);
    if (!state) {
      return { released: false };
    }

    try {
      for (const track of state.capturedStream?.getTracks?.() || []) {
        try {
          track.stop();
        } catch {}
      }
    } finally {
      globalThis.__translateVideoCaptureSourceState.delete(video);
    }

    if (tryResumePlayback && !video.paused) {
      try {
        await video.play();
      } catch {}
    }

    return { released: true };
  }

  function syncOverlayLayout(video, state) {
    if (!video.isConnected || state.disposed) {
      state.container.style.display = "none";
      return false;
    }

    const rect = video.getBoundingClientRect();
    if (!isVisible(video) || rect.width <= 0 || rect.height <= 0) {
      state.container.style.display = "none";
      return true;
    }

    state.container.style.display = "block";
    state.container.style.left = `${Math.round(rect.left)}px`;
    state.container.style.top = `${Math.round(rect.top)}px`;
    state.container.style.width = `${Math.round(rect.width)}px`;
      state.container.style.height = `${Math.round(rect.height)}px`;

      const fontPx = Math.max(14, Math.min(28, Math.round(rect.width * 0.035)));
      state.box.style.fontSize = `${fontPx}px`;
      return true;
  }

  function startSubtitleOverlayLoop(video, state) {
    if (state.rafId) {
      globalThis.cancelAnimationFrame(state.rafId);
      state.rafId = 0;
    }

    const tick = () => {
      if (!syncOverlayLayout(video, state)) {
        return;
      }

      const nowSeconds = Number(video.currentTime || 0);
      if (state.cues.length > 300) {
        state.cues = state.cues.filter((cue) => cue.end >= nowSeconds - 10);
      }

      const text = formatCueWindowText(state.cues, nowSeconds);
      if (text !== state.lastText) {
        state.lastText = text;
        state.box.textContent = text;
        state.box.style.display = text ? "block" : "none";
      }

      state.rafId = globalThis.requestAnimationFrame(tick);
    };

    state.rafId = globalThis.requestAnimationFrame(tick);
  }

  function renderSubtitleOverlay({
    videoIndex,
    result,
    offsetSeconds = 0,
    replace = false,
    trimLeadingSeconds = 0,
    liveAlignToNow = false,
    displayLeadSeconds = 0.4
  }) {
    if (!Number.isInteger(videoIndex) || videoIndex < 0) {
      throw new Error("Invalid video index for subtitle overlay.");
    }

    const videos = Array.from(document.querySelectorAll("video"));
    const video = videos[videoIndex];
    if (!video) {
      throw new Error("Selected video was not found for subtitle overlay.");
    }

    const rawRelativeCues = normalizeCuesFromBackend(result);
    if (!rawRelativeCues.length) {
      throw new Error("No subtitle cues found in backend response.");
    }
    const relativeCues = trimLeadingRelativeCues(rawRelativeCues, trimLeadingSeconds);

    let effectiveOffsetSeconds = Number(offsetSeconds) || 0;
    const state = ensureOverlayState(video);
    if (!relativeCues.length) {
      return {
        ok: true,
        videoIndex,
        cueCount: 0,
        totalCueCount: state.cues.length
      };
    }

    const cueSpanEnd = relativeCues.reduce((max, cue) => Math.max(max, Number(cue.end) || 0), 0);

    if (liveAlignToNow) {
      // For near-real-time mode, shift the returned chunk close to "now" so backend latency
      // doesn't make every cue land in the past by the time it arrives.
      effectiveOffsetSeconds = Number(video.currentTime || 0) - cueSpanEnd + (Number(displayLeadSeconds) || 0);
    }

    const absoluteCues = relativeCues.map((cue) => {
      const start = cue.start + effectiveOffsetSeconds;
      let end = cue.end + effectiveOffsetSeconds;

      if (liveAlignToNow) {
        // Backend chunks often come back with short cue windows; extend slightly for readability.
        end = Math.max(end, start + 1.2);
      }

      return {
        start,
        end,
        text: cue.text
      };
    });

    const nextCues = replace ? absoluteCues : state.cues.concat(absoluteCues);
    nextCues.sort((a, b) => (a.start - b.start) || (a.end - b.end));

    const deduped = [];
    for (const cue of nextCues) {
      const prev = deduped[deduped.length - 1];
      const prevNorm = prev ? normalizeCueTextForCompare(prev.text) : "";
      const cueNorm = normalizeCueTextForCompare(cue.text);
      const overlapsInTime = prev
        ? (Math.min(prev.end, cue.end) - Math.max(prev.start, cue.start)) > 0.15
        : false;
      if (
        prev &&
        Math.abs(prev.start - cue.start) < 0.001 &&
        Math.abs(prev.end - cue.end) < 0.001 &&
        prev.text === cue.text
      ) {
        continue;
      }

      if (prev && prevNorm && cueNorm && prevNorm === cueNorm && overlapsInTime) {
        // Prefer the most recent chunk's timing in overlap windows.
        deduped[deduped.length - 1] = cue;
        continue;
      }

      deduped.push(cue);
    }

    state.cues = deduped;
    state.lastText = "";
    state.box.textContent = "";
    state.box.style.display = "none";
    startSubtitleOverlayLoop(video, state);

    return {
      ok: true,
      videoIndex,
      cueCount: absoluteCues.length,
      totalCueCount: state.cues.length
    };
  }

  function clearSubtitleOverlay({ videoIndex }) {
    if (!Number.isInteger(videoIndex) || videoIndex < 0) {
      throw new Error("Invalid video index for clearing subtitle overlay.");
    }

    const videos = Array.from(document.querySelectorAll("video"));
    const video = videos[videoIndex];
    if (!video) {
      throw new Error("Selected video was not found for subtitle overlay clear.");
    }

    const state = globalThis.__translateVideoOverlayState?.get?.(video);
    if (!state) {
      return { ok: true, videoIndex, cleared: false };
    }

    state.cues = [];
    state.lastText = "";
    state.box.textContent = "";
    state.box.style.display = "none";
    return { ok: true, videoIndex, cleared: true };
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

    if (typeof globalThis.MediaRecorder !== "function") {
      throw new Error("MediaRecorder is not available in this browser.");
    }

    const captureSource = ensureCaptureSourceState(video);
    const capturedAudioTracks = captureSource.capturedAudioTracks;

    // Record from cloned tracks so stopping the recorder does not stop the video's own audio output.
    const clonedAudioTracks = capturedAudioTracks.map((track) => track.clone());
    const audioStream = new MediaStream(clonedAudioTracks);
    const chunks = [];
    const mimeType = pickSupportedAudioMimeType();
    const recorder = mimeType ? new MediaRecorder(audioStream, { mimeType }) : new MediaRecorder(audioStream);
    const startedAt = Date.now();
    const videoCurrentTimeStart = Number(video.currentTime || 0);

    const stopAllTracks = () => {
      for (const track of audioStream.getTracks()) {
        track.stop();
      }
      // Keep the shared capture source alive during live mode and release it explicitly on stop.
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
    const videoCurrentTimeEnd = Number(video.currentTime || 0);
    const videoDuration = Number.isFinite(video.duration) ? Number(video.duration) : null;
    const videoEnded = !!video.ended || (videoDuration != null && videoCurrentTimeEnd >= Math.max(0, videoDuration - 0.25));

    return {
      ok: true,
      capturedAt: new Date().toISOString(),
      videoIndex,
      durationMsRequested: Math.max(500, Number(durationMs) || 6000),
      durationMsActual: Date.now() - startedAt,
      bytes: recordedBlob.size,
      mimeType: recordedBlob.type || mimeType || "audio/webm",
      audioBase64,
      videoCurrentTimeStart,
      videoCurrentTimeEnd,
      videoDuration,
      videoEnded
    };
  }

  async function releaseVideoAudioCapture({ videoIndex }) {
    if (!Number.isInteger(videoIndex) || videoIndex < 0) {
      throw new Error("Invalid video index for capture release.");
    }

    const videos = Array.from(document.querySelectorAll("video"));
    const video = videos[videoIndex];
    if (!video) {
      throw new Error("Selected video was not found for capture release.");
    }

    const result = await releaseCaptureSourceState(video, { tryResumePlayback: true });
    return {
      ok: true,
      videoIndex,
      ...result
    };
  }

  async function seekVideoPlayback({ videoIndex, currentTime, play = true }) {
    if (!Number.isInteger(videoIndex) || videoIndex < 0) {
      throw new Error("Invalid video index for seek.");
    }

    const videos = Array.from(document.querySelectorAll("video"));
    const video = videos[videoIndex];
    if (!video) {
      throw new Error("Selected video was not found for seek.");
    }

    const targetTime = Number(currentTime);
    if (!Number.isFinite(targetTime) || targetTime < 0) {
      throw new Error("Invalid seek time.");
    }

    video.currentTime = targetTime;
    if (play) {
      try {
        await video.play();
      } catch {}
    }

    return {
      ok: true,
      videoIndex,
      currentTime: video.currentTime,
      playing: !video.paused
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

    if (message?.type === "RENDER_SUBTITLE_OVERLAY") {
      try {
        sendResponse(
          renderSubtitleOverlay({
            videoIndex: message.videoIndex,
            result: message.result,
            offsetSeconds: message.offsetSeconds,
            replace: !!message.replace,
            trimLeadingSeconds: message.trimLeadingSeconds,
            liveAlignToNow: !!message.liveAlignToNow,
            displayLeadSeconds: message.displayLeadSeconds
          })
        );
      } catch (error) {
        sendResponse({ ok: false, error: error.message || String(error) });
      }
      return false;
    }

    if (message?.type === "CLEAR_SUBTITLE_OVERLAY") {
      try {
        sendResponse(clearSubtitleOverlay({ videoIndex: message.videoIndex }));
      } catch (error) {
        sendResponse({ ok: false, error: error.message || String(error) });
      }
      return false;
    }

    if (message?.type === "RELEASE_VIDEO_AUDIO_CAPTURE") {
      releaseVideoAudioCapture({ videoIndex: message.videoIndex })
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
      return true;
    }

    if (message?.type === "SEEK_VIDEO_PLAYBACK") {
      seekVideoPlayback({
        videoIndex: message.videoIndex,
        currentTime: message.currentTime,
        play: message.play !== false
      })
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
      return true;
    }

    return false;
  });
})();
