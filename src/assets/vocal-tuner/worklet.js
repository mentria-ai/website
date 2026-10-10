import { createEngine } from './dsp/engine.js';
import { createKeyFinder } from './dsp/keyfind.js';
import { createHowlGuard } from './dsp/howl.js';

const CHUNK = 8192;
const POOL = 8;
const TRAIL = 8;

function db(sum, n) {
  return n && sum > 0 ? 10 * Math.log10(sum / n) : -180;
}

class VocalTuner extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    this.engine = createEngine(sampleRate, opts.settings || null);
    this.keys = createKeyFinder();
    this.howl = createHowlGuard();
    this.out = new Float32Array(128);
    this.free = [];
    for (let i = 0; i < POOL; i++) this.free.push([new Int16Array(CHUNK), new Int16Array(CHUNK)]);
    this.cur = null;
    this.fill = 0;
    this.recording = false;
    this.keying = false;
    this.trail = new Float32Array(TRAIL * 2);
    this.trailN = 0;
    this.trailTick = 0;
    this.blocks = 0;
    this.sums = new Float64Array(3);
    this.clip = false;
    this.postEvery = Math.max(1, Math.round((0.05 * sampleRate) / 128));
    this.port.onmessage = (e) => this.onMessage(e.data || {});
  }

  onMessage(m) {
    if (m.type === 'settings') this.engine.setSettings(m.settings);
    else if (m.type === 'bypass') this.engine.bypass = !!m.on;
    else if (m.type === 'record') {
      if (m.on && !this.recording) { this.cur = this.take(); this.fill = 0; }
      if (!m.on && this.recording) this.flush();
      this.recording = !!m.on;
    } else if (m.type === 'return') {
      if (m.dry && m.tuned && m.dry.length === CHUNK && this.free.length < POOL * 2) this.free.push([m.dry, m.tuned]);
    } else if (m.type === 'monitor') {
      this.howl.armed = !!m.speaker;
      this.howl.monitorDb = typeof m.db === 'number' ? m.db : -120;
    } else if (m.type === 'howl-reset') this.howl.reset();
    else if (m.type === 'keyfind') {
      this.keying = !!m.on;
      if (m.on) this.keys.reset();
    } else if (m.type === 'keyresult') this.port.postMessage({ type: 'key', result: this.keys.result(), seconds: this.keys.voicedSeconds() });
  }

  take() {
    return this.free.pop() || [new Int16Array(CHUNK), new Int16Array(CHUNK)];
  }

  flush() {
    const cur = this.cur;
    const n = cur ? this.fill : 0;
    const dry = cur ? cur[0].slice(0, n) : new Int16Array(0);
    const tuned = cur ? cur[1].slice(0, n) : new Int16Array(0);
    this.port.postMessage({ type: 'chunk', dry, tuned, last: true }, [dry.buffer, tuned.buffer]);
    if (cur) this.free.push(cur);
    this.cur = null;
    this.fill = 0;
  }

  capture(input, n) {
    let i = 0;
    while (i < n) {
      if (!this.cur) this.cur = this.take();
      const d = this.cur[0], t = this.cur[1];
      const room = CHUNK - this.fill;
      const count = n - i < room ? n - i : room;
      for (let k = 0; k < count; k++) {
        let v = input[i + k];
        v = v < -1 ? -1 : v > 1 ? 1 : v;
        d[this.fill + k] = v < 0 ? v * 32768 : v * 32767;
        v = this.out[i + k];
        v = v < -1 ? -1 : v > 1 ? 1 : v;
        t[this.fill + k] = v < 0 ? v * 32768 : v * 32767;
      }
      this.fill += count;
      i += count;
      if (this.fill === CHUNK) {
        this.port.postMessage({ type: 'chunk', dry: d, tuned: t, last: false }, [d.buffer, t.buffer]);
        this.cur = null;
        this.fill = 0;
      }
    }
  }

  process(inputs, outputs) {
    const input = inputs[0] && inputs[0][0];
    const out = outputs[0];
    if (!input) {
      for (let c = 0; c < out.length; c++) out[c].fill(0);
      return true;
    }
    const n = input.length;
    const e = this.engine;
    e.process(input, this.out, n);
    for (let c = 0; c < out.length; c++) {
      const ch = out[c];
      for (let i = 0; i < n; i++) ch[i] = this.out[i];
    }
    const sums = this.sums;
    for (let i = 0; i < n; i++) {
      const a = input[i], b = this.out[i];
      sums[0] += a * a;
      sums[1] += b * b;
      if (a > 0.891 || a < -0.891) this.clip = true;
    }
    sums[2] += n;
    const seconds = n / sampleRate;
    if (this.keying) this.keys.add(e.voiced ? e.pitch : 0, e.clarity, seconds);
    if (this.howl.update(e.voiced, e.clarity, e.pitch, e.level, seconds)) this.port.postMessage({ type: 'howl' });
    if (++this.trailTick >= 4) {
      this.trailTick = 0;
      if (this.trailN < TRAIL) {
        const m = e.voiced && e.pitch > 0 ? 69 + 12 * Math.log2(e.pitch / 440) : 0;
        this.trail[2 * this.trailN] = m;
        this.trail[2 * this.trailN + 1] = m ? m + e.correctionCents / 100 : 0;
        this.trailN++;
      }
    }
    if (this.recording) this.capture(input, n);
    if (++this.blocks >= this.postEvery) {
      this.blocks = 0;
      const trail = this.trail.slice(0, 2 * this.trailN);
      this.port.postMessage({
        type: 'telemetry',
        pitch: e.pitch,
        note: e.note,
        voiced: e.voiced,
        clarity: e.clarity,
        errorCents: e.errorCents,
        correctionCents: e.correctionCents,
        level: db(sums[0], sums[2]),
        outLevel: db(sums[1], sums[2]),
        clip: this.clip,
        delayMs: e.delayMs,
        keySeconds: this.keying ? this.keys.voicedSeconds() : 0,
        trail
      }, [trail.buffer]);
      this.trailN = 0;
      sums[0] = sums[1] = sums[2] = 0;
      this.clip = false;
    }
    return true;
  }
}

registerProcessor('vocal-tuner', VocalTuner);
