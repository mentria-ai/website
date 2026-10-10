import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const mod = (name) => import(pathToFileURL(resolve(here, '../src/assets/vocal-tuner/' + name)).href);
const S = await import(pathToFileURL(resolve(here, 'vocal-signals.mjs')).href);

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const cents = (a, b) => 1200 * Math.log2(a / b);
const FS = 48000;

const F = await mod('dsp/fft.js');
const FL = await mod('dsp/filters.js');

test('fft: forward matches a direct DFT and inverse restores the input', () => {
  const n = 64, fft = F.createFFT(n);
  const re = new Float64Array(n), im = new Float64Array(n), x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = re[i] = Math.sin(i * 0.37) + 0.5 * Math.cos(i * 1.9);
  fft.forward(re, im);
  for (let k = 0; k < n; k++) {
    let a = 0, b = 0;
    for (let i = 0; i < n; i++) { a += x[i] * Math.cos((2 * Math.PI * k * i) / n); b -= x[i] * Math.sin((2 * Math.PI * k * i) / n); }
    assert.ok(Math.abs(re[k] - a) < 1e-9 && Math.abs(im[k] - b) < 1e-9, 'bin ' + k);
  }
  fft.inverse(re, im);
  for (let i = 0; i < n; i++) assert.ok(Math.abs(re[i] - x[i]) < 1e-12 && Math.abs(im[i]) < 1e-12);
  assert.throws(() => F.createFFT(100));
});

test('filters: the highpass removes DC and keeps the voice band', () => {
  const hp = FL.createHighpass(FS, 60);
  const n = 4800, a = new Float32Array(n), out = new Float32Array(n);
  a.fill(0.5);
  hp.process(a, out);
  assert.ok(Math.abs(out[n - 1]) < 0.01, 'dc ' + out[n - 1]);
  const hp2 = FL.createHighpass(FS, 60);
  for (let i = 0; i < n; i++) a[i] = Math.sin((2 * Math.PI * 440 * i) / FS);
  hp2.process(a, out);
  let peak = 0;
  for (let i = n / 2; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  assert.ok(peak > 0.98 && peak < 1.01, 'peak ' + peak);
});

test('filters: the decimator halves the rate, passes 4 kHz and rejects 20 kHz', () => {
  const run = (f) => {
    const dec = FL.createDecimator(47, 256), inB = new Float32Array(128), outB = new Float32Array(64);
    let sum = 0, count = 0;
    for (let b = 0; b < 40; b++) {
      for (let i = 0; i < 128; i++) inB[i] = Math.sin((2 * Math.PI * f * (b * 128 + i)) / FS);
      dec.process(inB, outB, 128);
      if (b > 4) for (let i = 0; i < 64; i++) { sum += outB[i] * outB[i]; count++; }
    }
    return Math.sqrt((2 * sum) / count);
  };
  assert.ok(run(4000) > 0.97, 'passband');
  assert.ok(run(20000) < 0.01, 'stopband');
});

test('signals: generated pitches and noise levels are what they claim', () => {
  for (const kind of ['sine', 'saw', 'vocal']) {
    const x = S.makeSignal({ pitch: S.steady(220), kind, seconds: 0.5 });
    const fr = S.analyzePitch(x, FS).filter((q) => q.f > 0);
    const med = fr.map((q) => q.f).sort((a, b) => a - b)[fr.length >> 1];
    assert.ok(Math.abs(cents(med, 220)) < 2, kind + ' ' + med);
  }
  const clean = S.makeSignal({ pitch: S.steady(220), seconds: 1 });
  const noisy = S.makeSignal({ pitch: S.steady(220), seconds: 1, snr: 10 });
  let sp = 0, np = 0;
  for (let i = 0; i < clean.length; i++) { sp += clean[i] * clean[i]; np += (noisy[i] - clean[i]) ** 2; }
  assert.ok(Math.abs(10 * Math.log10(sp / np) - 10) < 0.5);
});

const DT = await mod('dsp/detector.js');

function track(x, fs = FS, opts) {
  const det = DT.createDetector(fs, opts);
  const out = [];
  const blk = new Float32Array(128);
  for (let i = 0; i + 128 <= x.length; i += 128) {
    for (let j = 0; j < 128; j++) blk[j] = x[i + j];
    det.push(blk);
    det.analyze();
    out.push({ t: (i + 128) / fs, voiced: det.voiced, pitch: det.pitch, clarity: det.clarity, level: det.level });
  }
  return out;
}

test('detector: voice, sawtooth and sine from 82 to 1000 Hz down to 10 dB SNR, no octave errors', () => {
  for (const kind of ['sine', 'saw', 'vocal']) {
    for (const f of [82, 110, 165, 220, 330, 440, 660, 880, 1000]) {
      for (const snr of [Infinity, 20, 10]) {
        const tr = track(S.makeSignal({ pitch: S.steady(f), kind, snr, seconds: 1, seed: f })).filter((r) => r.t > 0.1);
        const voiced = tr.filter((r) => r.voiced);
        const gross = voiced.filter((r) => Math.abs(cents(r.pitch, f)) > 50).length;
        const octave = voiced.filter((r) => Math.abs(Math.abs(cents(r.pitch, f)) - 1200) < 100).length;
        assert.ok(voiced.length >= tr.length * 0.95, kind + ' ' + f + ' ' + snr + ' voiced ' + voiced.length + '/' + tr.length);
        assert.ok(gross <= voiced.length * 0.02, kind + ' ' + f + ' ' + snr + ' gross ' + gross);
        assert.equal(octave, 0, kind + ' ' + f + ' ' + snr + ' octave errors');
      }
    }
  }
});

test('detector: clean pitch is within 2 cents (p95) and vibrato is tracked', () => {
  let worst = 0;
  for (const kind of ['saw', 'vocal']) {
    for (const f of [82, 147, 220, 440, 880]) {
      const e = track(S.makeSignal({ pitch: S.steady(f), kind, seconds: 1 })).filter((r) => r.t > 0.1 && r.voiced).map((r) => Math.abs(cents(r.pitch, f))).sort((a, b) => a - b);
      worst = Math.max(worst, e[Math.floor(e.length * 0.95)]);
    }
  }
  assert.ok(worst < 2, 'p95 ' + worst);
  const vib = S.vibrato(220, 6, 50);
  const e = track(S.makeSignal({ pitch: vib, seconds: 2 })).filter((r) => r.t > 0.2 && r.voiced).map((r) => Math.abs(cents(r.pitch, vib(r.t - 0.008)))).sort((a, b) => a - b);
  assert.ok(e[Math.floor(e.length * 0.95)] < 8, 'vibrato p95 ' + e[Math.floor(e.length * 0.95)]);
});

test('detector: settles within 30 ms of a note change', () => {
  for (const [a, b] of [[220, 262], [147, 196], [330, 247]]) {
    const tr = track(S.makeSignal({ pitch: S.steps([a, b], 0.5), seconds: 1 }));
    const hit = tr.find((r) => r.t > 0.5 && r.voiced && Math.abs(cents(r.pitch, b)) < 50);
    assert.ok(hit && hit.t - 0.5 <= 0.03, a + '->' + b + ' ' + (hit ? (hit.t - 0.5) * 1000 : 'never'));
  }
});

test('detector: noise alone and thirds stay unvoiced', () => {
  const r = S.rng(99);
  const white = new Float32Array(FS * 3);
  for (let i = 0; i < white.length; i++) white[i] = (r() - 0.5) * 0.2;
  assert.ok(track(white).filter((q) => q.voiced).length <= 11, 'white noise');
  for (const pair of [[220, 277.18], [220, 261.63]]) {
    const tr = track(S.makeChord(pair)).filter((q) => q.t > 0.1);
    assert.ok(tr.filter((q) => !q.voiced).length >= tr.length * 0.9, 'third ' + pair);
  }
});

test('detector: quiet singing around -40 dBFS is detected and silence below the gate is not', () => {
  const quiet = S.makeSignal({ pitch: S.steady(196), seconds: 1, amp: 0.02 });
  const tr = track(quiet).filter((q) => q.t > 0.1);
  assert.ok(tr.filter((q) => q.voiced && Math.abs(cents(q.pitch, 196)) < 10).length >= tr.length * 0.95, 'quiet voice');
  const faint = S.makeSignal({ pitch: S.steady(196), seconds: 1, amp: 0.002 });
  assert.equal(track(faint).filter((q) => q.voiced).length, 0, 'below gate');
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log('ok   ' + name);
  } catch (e) {
    failed++;
    console.log('FAIL ' + name);
    console.log('     ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n     ') : e));
  }
}
console.log(tests.length - failed + '/' + tests.length + ' passed');
if (failed) process.exit(1);
