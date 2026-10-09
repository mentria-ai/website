let worker = null;
let seq = 0;
const waiting = new Map();

function failAll(err) {
  for (const w of waiting.values()) w.reject(err);
  waiting.clear();
  worker = null;
}

function get() {
  if (worker) return worker;
  worker = new Worker(new URL('./detect-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    const d = e.data, w = waiting.get(d.id);
    if (!w) return;
    waiting.delete(d.id);
    if (d.ok) w.resolve(d);
    else w.reject(new Error(d.error || 'worker'));
  };
  worker.onerror = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    failAll(new Error('worker'));
  };
  return worker;
}

function call(msg, transfer) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    get().postMessage(Object.assign({ id }, msg), transfer || []);
  });
}

function canvas(w, h) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export async function detect(img) {
  const d = await call({ type: 'detect', data: img.data, w: img.width, h: img.height }, [img.data.buffer]);
  return d.result;
}

export async function detectIn(source, maxSide = 640) {
  const s = Math.min(1, maxSide / Math.max(source.width, source.height));
  const w = Math.max(1, Math.round(source.width * s)), h = Math.max(1, Math.round(source.height * s));
  const x = canvas(w, h).getContext('2d', { willReadFrequently: true });
  x.drawImage(source, 0, 0, w, h);
  const r = await detect(x.getImageData(0, 0, w, h));
  return { quad: r.quad ? r.quad.map((p) => [p[0] * source.width, p[1] * source.height]) : null, confidence: r.confidence };
}

export async function renderCPU(payload) {
  const d = await call(Object.assign({ type: 'render' }, payload), [payload.data.buffer]);
  return { data: d.data, width: d.width, height: d.height };
}
