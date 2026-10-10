import { createFFT } from './fft.js';
import { createHighpass, createDecimator } from './filters.js';

const RING = 4096;
const MASK = RING - 1;

export function createDetector(fs, opts = {}) {
  const fsd = fs / 2;
  const W = Math.round(0.032 * fsd);
  const N = 2 * W <= 2048 ? 2048 : 4096;
  const fmin = opts.fmin || 65;
  const fmax = opts.fmax || 1500;
  const gate = opts.gate == null ? -50 : opts.gate;
  const enterAt = 0.8, leaveAt = 0.7, holdS = 0.04, k = 0.9;
  const fft = createFFT(N);
  const re = new Float64Array(N), im = new Float64Array(N);
  const seg = new Float64Array(W);
  const nsdf = new Float64Array(W + 2);
  const peakT = new Int32Array(W), peakV = new Float64Array(W);
  const fine = new Float64Array(1536);
  const fineN = new Float64Array(160);
  const dRing = new Float32Array(RING), fRing = new Float32Array(RING);
  const hp = createHighpass(fs, 60);
  const dec = createDecimator(47, 512);
  const hpBuf = new Float32Array(512), decBuf = new Float32Array(256);
  let dw = 0, fw = 0, since = 0;
  const st = new Float64Array(4);
  const SMOOTH = 0, VOICED_T = 1, LOW_T = 2, FOLD_T = 3;
  const d = { pitch: 0, clarity: 0, voiced: false, level: -120, age: 0, period: 0 };

  d.push = (block, n = block.length) => {
    hp.process(block, hpBuf, n);
    for (let i = 0; i < n; i++) { fRing[fw & MASK] = hpBuf[i]; fw++; }
    dec.process(hpBuf, decBuf, n);
    const h = n >> 1;
    for (let i = 0; i < h; i++) { dRing[dw & MASK] = decBuf[i]; dw++; }
    since += n;
  };

  function unvoice() {
    d.voiced = false;
    d.pitch = 0;
    d.period = 0;
    st[VOICED_T] = 0;
    st[LOW_T] = 0;
    st[FOLD_T] = 0;
  }

  function coarse() {
    for (let j = 0; j < W; j++) seg[j] = dRing[(dw - W + j) & MASK];
    re.fill(0);
    im.fill(0);
    for (let j = 0; j < W; j++) re[j] = seg[j];
    fft.forward(re, im);
    for (let i = 0; i < N; i++) { re[i] = re[i] * re[i] + im[i] * im[i]; im[i] = 0; }
    fft.inverse(re, im);
    let m = 0;
    for (let j = 0; j < W; j++) m += 2 * seg[j] * seg[j];
    const tMax = Math.min(W - 2, Math.ceil(fsd / fmin) + 1);
    const tMin = Math.max(2, Math.floor(fsd / fmax));
    for (let t = 0; t <= tMax; t++) {
      if (t > 0) m -= seg[t - 1] * seg[t - 1] + seg[W - t] * seg[W - t];
      nsdf[t] = m > 1e-12 ? (2 * re[t]) / m : 0;
    }
    let t = 0, count = 0, top = 0;
    while (t <= tMax && nsdf[t] > 0) t++;
    while (t <= tMax) {
      while (t <= tMax && nsdf[t] <= 0) t++;
      let pk = -1, pv = -1;
      while (t <= tMax && nsdf[t] > 0) {
        if (nsdf[t] > pv) { pv = nsdf[t]; pk = t; }
        t++;
      }
      if (pk >= tMin && pk < tMax) {
        peakT[count] = pk;
        peakV[count] = pv;
        count++;
        if (pv > top) top = pv;
      }
    }
    if (!count) return 0;
    let best = -1;
    for (let i = 0; i < count; i++) if (peakV[i] >= k * top) { best = peakT[i]; break; }
    const a = nsdf[best - 1], b = nsdf[best], c = nsdf[best + 1];
    const den = a - 2 * b + c;
    const shift = den !== 0 ? (0.5 * (a - c)) / den : 0;
    d.clarity = Math.min(1, b - 0.25 * (a - c) * shift);
    return best + shift;
  }

  function refine(T0) {
    const L = Math.max(256, Math.min(1536, Math.round(2.5 * T0)));
    const range = 0.06 * T0 + 2;
    let lo = Math.max(2, Math.floor(T0 - range) - 1);
    let hi = Math.ceil(T0 + range) + 1;
    if (hi > L - 16) hi = L - 16;
    if (hi - lo + 1 > fineN.length) hi = lo + fineN.length - 1;
    if (hi <= lo + 2) return T0;
    for (let j = 0; j < L; j++) fine[j] = fRing[(fw - L + j) & MASK];
    let best = -1, bestV = -2;
    for (let t = lo; t <= hi; t++) {
      let r = 0, m = 0;
      const end = L - t;
      for (let j = 0; j < end; j++) {
        const x = fine[j], y = fine[j + t];
        r += x * y;
        m += x * x + y * y;
      }
      const v = m > 1e-12 ? (2 * r) / m : 0;
      fineN[t - lo] = v;
      if (t > lo && t < hi && v > bestV) { bestV = v; best = t; }
    }
    if (best < 0) return T0;
    const a = fineN[best - 1 - lo], b = fineN[best - lo], c = fineN[best + 1 - lo];
    if (b < a || b < c) return T0;
    const den = a - 2 * b + c;
    const shift = den !== 0 ? (0.5 * (a - c)) / den : 0;
    d.age = L >> 1;
    return best + shift;
  }

  d.analyze = () => {
    const dt = since / fs;
    since = 0;
    let ss = 0;
    for (let i = 1; i <= 1024; i++) { const v = fRing[(fw - i) & MASK]; ss += v * v; }
    const rms = Math.sqrt(ss / 1024);
    d.level = rms > 1e-9 ? 20 * Math.log10(rms) : -180;
    if (d.level < gate) { d.clarity = 0; unvoice(); return; }
    d.clarity = 0;
    const tc = coarse();
    const clarity = d.clarity;
    if (tc > 0 && clarity >= leaveAt && (d.voiced || clarity >= enterAt)) {
      d.age = W;
      const T = refine(2 * tc);
      let pitch = fs / T;
      let m = 69 + 12 * Math.log2(pitch / 440);
      if (d.voiced && st[VOICED_T] >= 0.03) {
        const diff = m - st[SMOOTH];
        const ad = Math.abs(diff);
        if (Math.abs(ad - 12) < 0.5 || Math.abs(ad - 24) < 0.5) {
          st[FOLD_T] += dt;
          if (st[FOLD_T] < 0.08) {
            const oct = Math.round(diff / 12);
            pitch /= Math.pow(2, oct);
            m -= 12 * oct;
          } else {
            st[FOLD_T] = 0;
            st[SMOOTH] = m;
          }
        } else st[FOLD_T] = 0;
      }
      if (!d.voiced) { st[SMOOTH] = m; st[VOICED_T] = 0; }
      st[SMOOTH] += (1 - Math.exp(-dt / 0.04)) * (m - st[SMOOTH]);
      d.voiced = true;
      d.pitch = pitch;
      d.period = fs / pitch;
      st[VOICED_T] += dt;
      st[LOW_T] = 0;
      return;
    }
    if (d.voiced) {
      st[LOW_T] += dt;
      if (st[LOW_T] >= holdS) unvoice();
    }
  };

  return d;
}
