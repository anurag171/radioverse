"use strict";

(function () {
  const $ = (id) => document.getElementById(id);

  const MIME_CANDIDATES = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];

  const els = {
    screen: $("singalong-screen"),
    station: $("singalong-station"),
    wave: $("singalong-wave"),
    waveIdle: $("singalong-wave-idle"),
    status: $("singalong-status"),
    time: $("singalong-time"),
    start: $("singalong-start"),
    stop: $("singalong-stop"),
    play: $("singalong-play"),
    save: $("singalong-save"),
    msg: $("singalong-msg"),
    close: $("singalong-close"),
    trigger: $("player-singalong"),
  };

  let audioCtx = null;
  let analyser = null;
  let analyserSource = null;
  let micStream = null;
  let mediaRecorder = null;
  let audioChunks = [];
  let recordedBlob = null;
  let recordedUrl = null;
  let playback = null;
  let rafId = null;
  let timerId = null;
  let startedAt = 0;
  let isRecording = false;
  let msgTimer = null;

  function getContext() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AC();
    }
    if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
    return audioCtx;
  }

  function pickMimeType() {
    if (typeof MediaRecorder === "undefined") return null;
    for (const m of MIME_CANDIDATES) {
      if (MediaRecorder.isTypeSupported(m)) return m;
    }
    return "";
  }

  function setStatus(text) {
    els.status.textContent = text;
  }

  function showMsg(text, isError) {
    clearTimeout(msgTimer);
    els.msg.textContent = text;
    els.msg.classList.toggle("error", !!isError);
    els.msg.hidden = false;
    msgTimer = setTimeout(() => {
      els.msg.hidden = true;
    }, isError ? 7000 : 4000);
  }

  function fmtTime(totalSec) {
    const m = String(Math.floor(totalSec / 60)).padStart(2, "0");
    const s = String(totalSec % 60).padStart(2, "0");
    return `${m}:${s}`;
  }

  function makeFileName() {
    const raw = els.station.textContent.trim();
    const slug = (raw && raw !== "\u2026" ? raw : "radio")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    return `singalong-${slug || "take"}-${ts}.wav`;
  }

  /* ---------------- Waveform ---------------- */

  function setupCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const rect = els.wave.getBoundingClientRect();
    els.wave.width = Math.max(320, Math.floor((rect.width || 600) * dpr));
    els.wave.height = Math.floor((rect.height || 120) * dpr);
  }

  function clearCanvas() {
    const g = els.wave.getContext("2d");
    g.clearRect(0, 0, els.wave.width, els.wave.height);
  }

  function drawPcm(data) {
    const canvas = els.wave;
    const g = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    g.clearRect(0, 0, w, h);
    const mid = h / 2;
    const step = Math.max(1, Math.floor(data.length / w));

    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "#00e5ff");
    grad.addColorStop(0.5, "#7c4dff");
    grad.addColorStop(1, "#ff2bd6");
    g.strokeStyle = grad;
    g.lineWidth = 2;
    g.shadowColor = "rgba(0, 229, 255, 0.55)";
    g.shadowBlur = 6;

    g.beginPath();
    for (let x = 0; x < w; x++) {
      const v = (data[Math.floor((x * data.length) / w)] - 128) / 128;
      const y = mid + v * (h / 2 - 6);
      if (x === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    g.shadowBlur = 0;
  }

  function startVisualizer() {
    const ctx = getContext();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.72;
    analyserSource = ctx.createMediaStreamSource(micStream);
    analyserSource.connect(analyser);

    const data = new Uint8Array(analyser.frequencyBinCount);
    els.waveIdle.hidden = true;

    const frame = () => {
      if (!isRecording) return;
      analyser.getByteTimeDomainData(data);
      drawPcm(data);
      rafId = requestAnimationFrame(frame);
    };
    rafId = requestAnimationFrame(frame);
  }

  function drawStaticWave(buffer) {
    els.waveIdle.hidden = true;
    const canvas = els.wave;
    const g = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    g.clearRect(0, 0, w, h);
    const data = buffer.getChannelData(0);
    const mid = h / 2;
    const amp = (h / 2) - 8;

    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "#00e5ff");
    grad.addColorStop(0.5, "#7c4dff");
    grad.addColorStop(1, "#ff2bd6");
    g.strokeStyle = grad;
    g.lineWidth = 2;
    g.shadowColor = "rgba(124, 77, 255, 0.5)";
    g.shadowBlur = 5;
    g.beginPath();
    const bucket = Math.max(1, Math.floor(data.length / w));
    for (let x = 0; x < w; x++) {
      let min = 1;
      let max = -1;
      for (let i = 0; i < bucket; i++) {
        const idx = x * bucket + i;
        if (idx >= data.length) break;
        const v = data[idx];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      g.moveTo(x, mid + min * amp);
      g.lineTo(x, mid + max * amp);
    }
    g.stroke();
    g.shadowBlur = 0;
  }

  /* ---------------- Recording ---------------- */

  async function startRecording() {
    if (isRecording) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showMsg("Recording is not supported in this browser.", true);
      return;
    }
    const mime = pickMimeType();
    if (mime === null) {
      showMsg("This browser does not support audio recording.", true);
      return;
    }

    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (err) {
      const name = err && err.name;
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        showMsg("Microphone access was denied. Please allow the microphone to sing along.", true);
      } else if (name === "NotFoundError") {
        showMsg("No microphone was found on this device.", true);
      } else {
        showMsg(`Could not start the microphone: ${err.message || name}`, true);
      }
      return;
    }

    audioChunks = [];
    recordedBlob = null;
    if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    recordedUrl = null;
    if (playback) stopPlayback();

    try {
      mediaRecorder = new MediaRecorder(micStream, mime ? { mimeType: mime } : undefined);
    } catch (err) {
      try {
        mediaRecorder = new MediaRecorder(micStream);
      } catch (err2) {
        micStream.getTracks().forEach((t) => t.stop());
        showMsg("This browser cannot record audio.", true);
        return;
      }
    }

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) audioChunks.push(e.data);
    };
    mediaRecorder.onstop = handleStop;

    startVisualizer();
    mediaRecorder.start(250);
    isRecording = true;
    startedAt = Date.now();
    els.time.textContent = "00:00";
    setStatus("Recording \u2014 the radio stays out of your take");
    els.wave.classList.add("live");
    updateButtons();
    tickTimer();
  }

  function tickTimer() {
    if (!isRecording) return;
    const sec = Math.floor((Date.now() - startedAt) / 1000);
    els.time.textContent = fmtTime(sec);
    timerId = setTimeout(tickTimer, 500);
  }

  function stopRecording() {
    if (!isRecording || !mediaRecorder) return;
    isRecording = false;
    clearTimeout(timerId);
    cancelAnimationFrame(rafId);
    try {
      mediaRecorder.stop();
    } catch (e) {
      /* already stopped */
    }
    if (micStream) micStream.getTracks().forEach((t) => t.stop());
    if (analyserSource) {
      analyserSource.disconnect();
      analyserSource = null;
    }
    setStatus("Processing\u2026");
  }

  async function handleStop() {
    const rawBlob = new Blob(audioChunks, {
      type: mediaRecorder && mediaRecorder.mimeType ? mediaRecorder.mimeType : "audio/webm",
    });
    audioChunks = [];

    try {
      const buffer = await decodeAudio(rawBlob);
      const wav = encodeWav(buffer);
      recordedBlob = wav;
      if (recordedUrl) URL.revokeObjectURL(recordedUrl);
      recordedUrl = URL.createObjectURL(wav);
      drawStaticWave(buffer);
      setStatus("Recording ready \u2014 your voice, saved locally");
    } catch (e) {
      console.warn("WAV conversion failed, keeping original format.", e);
      recordedBlob = rawBlob;
      if (recordedUrl) URL.revokeObjectURL(recordedUrl);
      recordedUrl = URL.createObjectURL(rawBlob);
      setStatus("Recording ready (original format)");
    }
    els.wave.classList.remove("live");
    updateButtons();
  }

  function decodeAudio(blob) {
    const ctx = getContext();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => ctx.decodeAudioData(reader.result, resolve, reject);
      reader.onerror = reject;
      reader.readAsArrayBuffer(blob);
    });
  }

  function encodeWav(buffer) {
    const numCh = Math.min(Math.max(buffer.numberOfChannels, 1), 2);
    const sampleRate = buffer.sampleRate;
    const numFrames = buffer.length;
    const bytesPerSample = 2;
    const blockAlign = numCh * bytesPerSample;
    const dataSize = numFrames * blockAlign;
    const ab = new ArrayBuffer(44 + dataSize);
    const view = new DataView(ab);

    const writeString = (o, s) => {
      for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i));
    };

    writeString(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numCh, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeString(36, "data");
    view.setUint32(40, dataSize, true);

    const channels = [];
    for (let c = 0; c < numCh; c++) channels.push(buffer.getChannelData(c));
    let offset = 44;
    for (let i = 0; i < numFrames; i++) {
      for (let c = 0; c < numCh; c++) {
        const s = Math.max(-1, Math.min(1, channels[c][i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        offset += 2;
      }
    }
    return new Blob([ab], { type: "audio/wav" });
  }

  /* ---------------- Playback ---------------- */

  function setPlayLabel(playing) {
    const span = els.play.querySelector("span");
    span.textContent = playing ? "Stop playback" : "Play recording";
    els.play.classList.toggle("is-playing", playing);
  }

  function playRecording() {
    if (playback) {
      stopPlayback();
      return;
    }
    if (!recordedUrl) return;
    playback = new Audio(recordedUrl);
    playback.onended = stopPlayback;
    playback.play().catch(() => {
      playback = null;
      setPlayLabel(false);
      showMsg("Playback failed for this recording.", true);
    });
    setPlayLabel(true);
    setStatus("Playing your take\u2026");
  }

  function stopPlayback() {
    if (!playback) return;
    playback.pause();
    playback.onended = null;
    playback = null;
    setPlayLabel(false);
    setStatus(recordedBlob ? "Recording ready \u2014 your voice, saved locally" : "Ready");
  }

  /* ---------------- Save ---------------- */

  async function saveRecording() {
    if (!recordedBlob) return;
    const fileName = makeFileName();
    const file = new File([recordedBlob], fileName, { type: recordedBlob.type });

    const canShare = navigator.share && navigator.canShare && navigator.canShare({ files: [file] });
    if (canShare) {
      try {
        await navigator.share({
          files: [file],
          title: "My sing-along recording",
          text: "A RadioVerse sing-along take, recorded locally.",
        });
        showMsg("Saved to your device.");
        return;
      } catch (e) {
        if (e.name === "AbortError") return;
        /* fall through to download */
      }
    }

    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15000);
    showMsg("Download started \u2014 check your downloads folder.");
  }

  /* ---------------- Modal ---------------- */

  function open() {
    const title = $("player-title");
    els.station.textContent = title && title.textContent.trim()
      ? title.textContent.trim()
      : "No station playing \u2014 hum away anyway!";
    els.screen.hidden = false;
    document.body.style.overflow = "hidden";
    els.trigger.setAttribute("aria-pressed", "true");
    requestAnimationFrame(() => {
      setupCanvas();
      clearCanvas();
      els.waveIdle.hidden = !recordedBlob;
      if (recordedBlob) {
        setStatus("Recording ready \u2014 your voice, saved locally");
      } else {
        setStatus("Ready");
      }
    });
    els.close.focus();
  }

  function close() {
    els.screen.hidden = true;
    document.body.style.overflow = "";
    els.trigger.setAttribute("aria-pressed", "false");
    if (isRecording) stopRecording();
    else if (playback) stopPlayback();
    if (micStream) {
      micStream.getTracks().forEach((t) => t.stop());
      micStream = null;
    }
    cancelAnimationFrame(rafId);
    clearTimeout(timerId);
    els.wave.classList.remove("live");
  }

  function updateButtons() {
    els.start.disabled = isRecording;
    els.stop.disabled = !isRecording;
    const hasRecording = !!recordedBlob;
    els.play.disabled = !hasRecording;
    els.save.disabled = !hasRecording;
  }

  /* ---------------- Events ---------------- */

  els.start.addEventListener("click", startRecording);
  els.stop.addEventListener("click", stopRecording);
  els.play.addEventListener("click", playRecording);
  els.save.addEventListener("click", saveRecording);
  els.close.addEventListener("click", close);
  els.trigger.addEventListener("click", open);

  els.screen.addEventListener("click", (e) => {
    if (e.target === els.screen) close();
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !els.screen.hidden) close();
  });

  window.addEventListener("resize", () => {
    if (!els.screen.hidden) setupCanvas();
  });

  updateButtons();
})();
