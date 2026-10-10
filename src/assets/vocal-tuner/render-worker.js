import { createEngine } from './dsp/engine.js';
import { decodeWav } from './wav.js';

self.onmessage = (e) => {
  const d = e.data || {};
  try {
    const { sampleRate, samples } = decodeWav(d.wav);
    const engine = createEngine(sampleRate, d.settings, { detectEvery: 2 });
    const n = samples.length;
    const pcm = new Int16Array(n);
    const inp = new Float32Array(128);
    const out = new Float32Array(128);
    let last = Date.now();
    for (let i = 0; i < n; i += 128) {
      const m = n - i < 128 ? n - i : 128;
      for (let k = 0; k < 128; k++) inp[k] = k < m ? samples[i + k] : 0;
      engine.process(inp, out, 128);
      for (let k = 0; k < m; k++) {
        const v = out[k] < -1 ? -1 : out[k] > 1 ? 1 : out[k];
        pcm[i + k] = v < 0 ? v * 32768 : v * 32767;
      }
      const now = Date.now();
      if (now - last >= 250) {
        last = now;
        self.postMessage({ type: 'progress', value: i / n });
      }
    }
    self.postMessage({ type: 'done', pcm, sampleRate }, [pcm.buffer]);
  } catch (err) {
    self.postMessage({ type: 'error', message: String((err && err.message) || err) });
  }
};
