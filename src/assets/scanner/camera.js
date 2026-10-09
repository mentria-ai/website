let stream = null;
let track = null;
let video = null;
let gen = 0;
let grabber = null;
let capturer = null;

function safe(fn) {
  try { return fn(); } catch (_) { return null; }
}

function named(name) {
  const e = new Error(name);
  e.name = name;
  return e;
}

export async function open(videoEl) {
  const my = ++gen;
  if (!window.isSecureContext) throw named('InsecureError');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw named('NotFoundError');
  const sizes = [{ width: { ideal: 3840 }, height: { ideal: 2160 } }, { width: { ideal: 1920 }, height: { ideal: 1080 } }, {}];
  let s = null, last = null;
  for (const size of sizes) {
    try {
      s = await navigator.mediaDevices.getUserMedia({ audio: false, video: Object.assign({ facingMode: 'environment' }, size) });
      break;
    } catch (e) {
      last = e;
      if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError' || e.name === 'NotFoundError')) throw e;
    }
  }
  if (!s) throw last || named('NotReadableError');
  if (my !== gen) { s.getTracks().forEach((t) => t.stop()); return null; }
  stream = s;
  track = s.getVideoTracks()[0];
  video = videoEl;
  videoEl.setAttribute('playsinline', '');
  videoEl.muted = true;
  videoEl.srcObject = s;
  try { await videoEl.play(); } catch (_) {}
  if (!videoEl.videoWidth) {
    await Promise.race([
      new Promise((r) => videoEl.addEventListener('loadedmetadata', r, { once: true })),
      new Promise((r) => setTimeout(r, 3000))
    ]);
  }
  const caps = safe(() => track.getCapabilities()) || {};
  if (caps.focusMode && caps.focusMode.includes('continuous')) {
    try { await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch (_) {}
  }
  capturer = typeof ImageCapture === 'function' ? safe(() => new ImageCapture(track)) : null;
  if (my !== gen) return null;
  return { torch: !!caps.torch, width: videoEl.videoWidth, height: videoEl.videoHeight };
}

export function close() {
  gen++;
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  track = null;
  capturer = null;
  if (video) {
    try { video.pause(); } catch (_) {}
    video.srcObject = null;
    video = null;
  }
}

export async function setTorch(on) {
  if (!track) return false;
  try {
    await track.applyConstraints({ advanced: [{ torch: !!on }] });
    return true;
  } catch (_) {
    return false;
  }
}

export function frame(maxSide) {
  const vw = video.videoWidth, vh = video.videoHeight;
  const s = Math.min(1, maxSide / Math.max(vw, vh));
  const w = Math.max(1, Math.round(vw * s)), h = Math.max(1, Math.round(vh * s));
  if (!grabber || grabber.width !== w || grabber.height !== h) {
    if (typeof OffscreenCanvas === 'function') grabber = new OffscreenCanvas(w, h);
    else { grabber = document.createElement('canvas'); grabber.width = w; grabber.height = h; }
  }
  const x = grabber.getContext('2d', { willReadFrequently: true });
  x.drawImage(video, 0, 0, w, h);
  return x.getImageData(0, 0, w, h);
}

export async function still() {
  if (capturer) {
    try {
      const blob = await capturer.takePhoto();
      return await createImageBitmap(blob, { imageOrientation: 'from-image' });
    } catch (_) {}
  }
  return createImageBitmap(video);
}
