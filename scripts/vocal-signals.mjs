import { createFFT } from '../src/assets/vocal-tuner/dsp/fft.js';

export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const midi = (hz) => 69 + 12 * Math.log2(hz / 440);
export const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

export const steady = (f) => () => f;
export const vibrato = (f, rate, cents) => (t) => f * Math.pow(2, (cents / 1200) * Math.sin(2 * Math.PI * rate * t));
export const glide = (f1, f2, start, dur) => (t) => (t <= start ? f1 : t >= start + dur ? f2 : f1 * Math.pow(f2 / f1, (t - start) / dur));
export const steps = (list, each) => (t) => list[Math.min(list.length - 1, Math.floor(t / each))];

function resonator(fs, f0, bw) {
  const w = (2 * Math.PI * f0) / fs, q = f0 / bw, alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  const b0 = alpha / a0, b2 = -alpha / a0, a1 = (-2 * Math.cos(w)) / a0, a2 = (1 - alpha) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x) => {
    const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y;
  };
}

export function makeSignal({ fs = 48000, seconds = 2, pitch = steady(220), kind = 'vocal', snr = Infinity, noise = 'white', amp = 0.3, seed = 1, voicedFrom = 0, voicedTo = Infinity } = {}) {
  const n = Math.round(fs * seconds);
  const out = new Float32Array(n);
  const r = rng(seed);
  const f1 = resonator(fs, 700, 80), f2 = resonator(fs, 1220, 90), f3 = resonator(fs, 2600, 120);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / fs;
    const f = pitch(t);
    phase += (2 * Math.PI * f) / fs;
    if (phase > 2 * Math.PI * 1e6) phase -= 2 * Math.PI * 1e6;
    let v = 0;
    if (t >= voicedFrom && t < voicedTo && f > 0) {
      if (kind === 'sine' || kind === 'whistle') v = Math.sin(phase);
      else {
        const H = Math.min(40, Math.floor(fs / 2 / f));
        for (let h = 1; h <= H; h++) v += Math.sin(h * phase) / (kind === 'saw' ? h : h * h);
        if (kind === 'vocal') v = 0.25 * v + f1(v) * 2.2 + f2(v) * 1.6 + f3(v) * 1.1;
      }
    }
    out[i] = v;
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0) for (let i = 0; i < n; i++) out[i] *= amp / peak;
  if (snr !== Infinity) {
    let sp = 0, cnt = 0;
    for (let i = 0; i < n; i++) if (out[i] !== 0) { sp += out[i] * out[i]; cnt++; }
    const sigRms = Math.sqrt(sp / Math.max(1, cnt)) || amp * 0.3;
    const noiseRms = sigRms / Math.pow(10, snr / 20);
    const raw = new Float32Array(n);
    let b = 0;
    for (let i = 0; i < n; i++) {
      const g = Math.sqrt(-2 * Math.log(r() || 1e-12)) * Math.cos(2 * Math.PI * r());
      if (noise === 'brown') { b = 0.995 * b + g * 0.1; raw[i] = b; } else raw[i] = g;
    }
    let np = 0;
    for (let i = 0; i < n; i++) np += raw[i] * raw[i];
    const k = noiseRms / Math.sqrt(np / n);
    for (let i = 0; i < n; i++) out[i] += raw[i] * k;
  }
  return out;
}

export function makeChord(freqs, { fs = 48000, seconds = 1.5, amp = 0.3 } = {}) {
  const n = Math.round(fs * seconds), out = new Float32Array(n);
  freqs.forEach((f, j) => {
    const s = makeSignal({ fs, seconds, pitch: steady(f), kind: 'vocal', amp: 1, seed: 7 + j });
    for (let i = 0; i < n; i++) out[i] += s[i];
  });
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  for (let i = 0; i < n; i++) out[i] *= amp / peak;
  return out;
}

export function analyzePitch(x, fs = 48000, { window = 1536, hop = 96, fmin = 60, fmax = 1600 } = {}) {
  const N = 4096, fft = createFFT(N);
  const re = new Float64Array(N), im = new Float64Array(N);
  const frames = [];
  const tmin = Math.floor(fs / fmax), tmax = Math.min(window - 2, Math.ceil(fs / fmin));
  for (let start = 0; start + window <= x.length; start += hop) {
    re.fill(0); im.fill(0);
    for (let j = 0; j < window; j++) re[j] = x[start + j];
    fft.forward(re, im);
    for (let k = 0; k < N; k++) { re[k] = re[k] * re[k] + im[k] * im[k]; im[k] = 0; }
    fft.inverse(re, im);
    let m = 0;
    for (let j = 0; j < window; j++) m += 2 * x[start + j] * x[start + j];
    const nsdf = new Float64Array(tmax + 2);
    for (let tau = 0; tau <= tmax + 1; tau++) {
      if (tau > 0) m -= x[start + tau - 1] * x[start + tau - 1] + x[start + window - tau] * x[start + window - tau];
      nsdf[tau] = m > 1e-12 ? (2 * re[tau]) / m : 0;
    }
    let best = -1, bestV = 0, tau = 0;
    while (tau < tmax && nsdf[tau] > 0) tau++;
    const peaks = [];
    while (tau < tmax) {
      while (tau < tmax && nsdf[tau] <= 0) tau++;
      let pk = -1, pv = -Infinity;
      while (tau < tmax && nsdf[tau] > 0) { if (nsdf[tau] > pv) { pv = nsdf[tau]; pk = tau; } tau++; }
      if (pk >= tmin) peaks.push([pk, pv]);
    }
    const top = peaks.reduce((a, p) => Math.max(a, p[1]), 0);
    for (const [pk, pv] of peaks) if (pv >= 0.93 * top) { best = pk; bestV = pv; break; }
    let f = 0;
    if (best > 0) {
      const a = nsdf[best - 1], b = nsdf[best], c = nsdf[best + 1];
      const d = a - 2 * b + c;
      const shift = d !== 0 ? (0.5 * (a - c)) / d : 0;
      f = fs / (best + shift);
    }
    frames.push({ t: (start + window / 2) / fs, f, clarity: bestV });
  }
  return frames;
}
