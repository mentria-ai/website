import { encodeWav } from './wav.js';

const WORKER_URL = new URL('./render-worker.js', import.meta.url).href;

export function renderTake(dry, settings, onProgress) {
  const worker = new Worker(WORKER_URL, { type: 'module' });
  let fail = null;
  const promise = new Promise((resolve, reject) => {
    fail = reject;
    worker.onmessage = (e) => {
      const m = e.data || {};
      if (m.type === 'progress') {
        if (onProgress) onProgress(m.value);
      } else if (m.type === 'done') {
        worker.terminate();
        resolve(encodeWav([m.pcm], m.sampleRate));
      } else if (m.type === 'error') {
        worker.terminate();
        reject(new Error(m.message));
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error((e && e.message) || 'render failed'));
    };
    dry.arrayBuffer().then((buf) => worker.postMessage({ wav: buf, settings }, [buf]), (err) => {
      worker.terminate();
      reject(err);
    });
  });
  return {
    promise,
    cancel() {
      worker.terminate();
      fail(new DOMException('cancelled', 'AbortError'));
    }
  };
}
