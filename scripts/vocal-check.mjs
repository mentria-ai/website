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
