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

const ST = await mod('dsp/settings.js');
const CO = await mod('dsp/corrector.js');

function correct(c, pitchAt, seconds) {
  const det = { voiced: true, pitch: 0 };
  const out = [];
  for (let t = 0; t < seconds; t += 128 / FS) {
    det.pitch = pitchAt(t);
    c.update(det, 128);
    out.push({ t, note: c.note, corr: c.correctionCents, m: S.midi(det.pitch) });
  }
  return out;
}

test('settings: the correction curve hits its anchors and interpolates', () => {
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  let k = ST.curve(0.35);
  assert.ok(near(k.tau, 0.04) && near(k.humanize, 1) && near(k.keep, 40));
  k = ST.curve(1);
  assert.ok(near(k.tau, 0) && near(k.humanize, 0) && k.keep === 1000);
  k = ST.curve(0.5);
  assert.ok(near(k.tau, 0.0275) && near(k.humanize, 0.7) && near(k.keep, 55));
  assert.equal(ST.presetOf(0.65), 'tight');
  assert.equal(ST.presetOf(0.5), null);
  assert.deepEqual([...ST.scaleMask({ root: 9, mode: 'minor' })], [1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1]);
  assert.deepEqual([...ST.scaleMask(null)], new Array(12).fill(1));
  assert.deepEqual(ST.normalize({ correction: 7, key: { root: 13 } }), { correction: 1, key: null });
  assert.equal(ST.keyLabel({ root: 9, mode: 'minor' }), 'Am');
});

test('corrector: hard snaps a note sung 30 cents sharp onto the note', () => {
  const r = correct(CO.createCorrector(FS, { correction: 1, key: null }), () => S.hz(57.3), 0.5);
  const last = r[r.length - 1];
  assert.equal(last.note, 57);
  assert.ok(Math.abs(last.corr + 30) < 0.01, 'corr ' + last.corr);
});

test('corrector: vibrato around a sharp centre never flips notes', () => {
  const r = correct(CO.createCorrector(FS, { correction: 1, key: null }), (t) => S.hz(57.2 + 0.5 * Math.sin(2 * Math.PI * 6 * t)), 1.5).slice(20);
  let flips = 0;
  for (let i = 1; i < r.length; i++) if (r[i].note !== r[i - 1].note) flips++;
  assert.equal(flips, 0);
});

test('corrector: injected octave errors never move the voice by more than 2 semitones', () => {
  let i = 0;
  const r = correct(CO.createCorrector(FS, { correction: 1, key: null }), () => S.hz(57.3 + (++i % 20 === 7 ? 12 : 0)), 2);
  assert.ok(r.every((q) => Math.abs(q.corr) <= 200), 'max ' + Math.max(...r.map((q) => Math.abs(q.corr))));
});

test('corrector: unvoiced input releases the correction within about 100 ms', () => {
  const c = CO.createCorrector(FS, { correction: 1, key: null });
  correct(c, () => S.hz(57.3), 0.3);
  const det = { voiced: false, pitch: 0 };
  let t = 0;
  while (Math.abs(c.correctionCents) >= 0.5 && t < 0.5) { c.update(det, 128); t += 128 / FS; }
  assert.ok(t <= 0.11, 'released after ' + t);
});

test('corrector: a glide in hard mode becomes a staircase of notes', () => {
  const r = correct(CO.createCorrector(FS, { correction: 1, key: null }), (t) => S.hz(57 + 3 * Math.min(1, t / 0.4)), 0.5);
  assert.ok(r.every((q) => Math.abs(q.m + q.corr / 100 - Math.round(q.m + q.corr / 100)) < 0.05));
  assert.deepEqual([...new Set(r.map((q) => q.note))], [57, 58, 59, 60]);
});

test('corrector: natural keeps a deliberate C sharp in C major, hard pulls it in', () => {
  const nat = correct(CO.createCorrector(FS, { correction: 0.35, key: { root: 0, mode: 'major' } }), () => S.hz(61), 0.6);
  assert.ok(Math.abs(nat[nat.length - 1].corr) < 0.5, 'natural ' + nat[nat.length - 1].corr);
  const hard = correct(CO.createCorrector(FS, { correction: 1, key: { root: 0, mode: 'major' } }), () => S.hz(61), 0.6);
  assert.ok(Math.abs(Math.abs(hard[hard.length - 1].corr) - 100) < 0.5, 'hard ' + hard[hard.length - 1].corr);
});

const EN = await mod('dsp/engine.js');

function render(x, settings, fs = FS, opts) {
  const eng = EN.createEngine(fs, settings, opts);
  const out = new Float32Array(x.length);
  const inB = new Float32Array(128), outB = new Float32Array(128);
  const delays = [];
  for (let i = 0; i + 128 <= x.length; i += 128) {
    for (let j = 0; j < 128; j++) inB[j] = x[i + j];
    eng.process(inB, outB);
    for (let j = 0; j < 128; j++) out[i + j] = outB[j];
    if (eng.voiced) delays.push(eng.delayMs);
  }
  return { out, delays, eng };
}

test('engine: notes sung 30 cents sharp come out within 2 cents of the note and stay clean', () => {
  for (const f0 of [110, 196, 330, 523]) {
    const off = S.hz(Math.round(S.midi(f0)) + 0.3), target = S.hz(Math.round(S.midi(f0)));
    const { out, delays } = render(S.makeSignal({ pitch: S.steady(off), seconds: 1.5 }), { correction: 1, key: null });
    const fr = S.analyzePitch(out, FS).filter((q) => q.t > 0.3 && q.f > 0);
    const errs = fr.map((q) => Math.abs(cents(q.f, target))).sort((a, b) => a - b);
    const clar = fr.map((q) => q.clarity).sort((a, b) => a - b);
    assert.ok(errs[Math.floor(errs.length * 0.95)] < 2, f0 + ' p95 ' + errs[Math.floor(errs.length * 0.95)]);
    assert.ok(clar[Math.floor(clar.length * 0.05)] >= 0.99, f0 + ' clarity ' + clar[Math.floor(clar.length * 0.05)]);
    const mean = delays.reduce((a, b) => a + b, 0) / delays.length;
    assert.ok(mean >= 1 && mean <= (f0 < 150 ? 6 : 3.5), f0 + ' delay ' + mean);
  }
});

test('engine: the shifter delay stays under 13 ms for an 82 Hz voice', () => {
  const { delays } = render(S.makeSignal({ pitch: S.steady(82.41 * Math.pow(2, 0.3 / 12)), seconds: 1.5 }), { correction: 1, key: null });
  assert.ok(Math.max(...delays) < 13, 'max ' + Math.max(...delays));
});

test('engine: an in-tune voice passes through unchanged apart from a short delay', () => {
  const x = S.makeSignal({ pitch: S.steady(220), seconds: 1 });
  const { out } = render(x, { correction: 1, key: null });
  let best = -1, bc = -2;
  for (let lag = 0; lag < 200; lag++) {
    let xy = 0, xx = 0, yy = 0;
    for (let i = 10000; i < 40000; i++) { xy += x[i] * out[i + lag]; xx += x[i] * x[i]; yy += out[i + lag] * out[i + lag]; }
    const c = xy / Math.sqrt(xx * yy);
    if (c > bc) { bc = c; best = lag; }
  }
  assert.ok(bc > 0.9999 && best > 0 && best < 200, 'lag ' + best + ' corr ' + bc);
});

test('engine: hard flattens vibrato, tight and natural keep it', () => {
  const x = S.makeSignal({ pitch: (t) => S.hz(57.2 + 0.5 * Math.sin(2 * Math.PI * 6 * t)), seconds: 2 });
  const extent = (c) => {
    const fr = S.analyzePitch(render(x, { correction: c, key: null }).out, FS).filter((q) => q.t > 0.4 && q.f > 0).map((q) => S.midi(q.f));
    return { centre: (fr.reduce((a, b) => a + b, 0) / fr.length - 57) * 100, ext: (Math.max(...fr) - Math.min(...fr)) * 50 };
  };
  const hard = extent(1), tight = extent(0.65);
  assert.ok(Math.abs(hard.centre) < 3 && hard.ext < 12, 'hard ' + JSON.stringify(hard));
  assert.ok(tight.ext > 35, 'tight ' + JSON.stringify(tight));
});

test('engine: works at 44.1 kHz too', () => {
  const fs = 44100, off = S.hz(57.3), target = S.hz(57);
  const { out } = render(S.makeSignal({ fs, pitch: S.steady(off), seconds: 1.5 }), { correction: 1, key: null }, fs);
  const fr = S.analyzePitch(out, fs).filter((q) => q.t > 0.3 && q.f > 0);
  const errs = fr.map((q) => Math.abs(cents(q.f, target))).sort((a, b) => a - b);
  assert.ok(errs[Math.floor(errs.length * 0.95)] < 2, 'p95 ' + errs[Math.floor(errs.length * 0.95)]);
});

test('engine: changing the key while singing does not click', () => {
  const x = S.makeSignal({ pitch: S.steady(S.hz(57.3)), seconds: 1.5 });
  const eng = EN.createEngine(FS, { correction: 1, key: null });
  const inB = new Float32Array(128), outB = new Float32Array(128);
  let prev = 0, maxJump = 0, maxJumpIn = 0;
  for (let i = 0, b = 0; i + 128 <= x.length; i += 128, b++) {
    for (let j = 0; j < 128; j++) inB[j] = x[i + j];
    if (b === 280) eng.setSettings({ correction: 1, key: { root: 7, mode: 'major' } });
    if (b === 400) eng.setSettings({ correction: 0.35, key: null });
    eng.process(inB, outB);
    for (let j = 0; j < 128; j++) {
      if (i + j > 4800) {
        maxJump = Math.max(maxJump, Math.abs(outB[j] - prev));
        if (i + j > 0) maxJumpIn = Math.max(maxJumpIn, Math.abs(x[i + j] - x[i + j - 1]));
      }
      prev = outB[j];
    }
  }
  assert.ok(maxJump < maxJumpIn * 1.1, 'jump ' + maxJump + ' vs input ' + maxJumpIn);
});

test('engine: splices are seamless on a pure tone', () => {
  const x = S.makeSignal({ kind: 'sine', pitch: S.steady(680), seconds: 1.5 });
  const eng = EN.createEngine(FS, { correction: 1, key: null });
  const inB = new Float32Array(128), outB = new Float32Array(128);
  let p1 = 0, p2 = 0, worst = 0, worstIn = 0;
  for (let i = 0; i + 128 <= x.length; i += 128) {
    for (let j = 0; j < 128; j++) inB[j] = x[i + j];
    eng.process(inB, outB);
    for (let j = 0; j < 128; j++) {
      const k = i + j;
      if (k > 4800) {
        worst = Math.max(worst, Math.abs(outB[j] - 2 * p1 + p2));
        worstIn = Math.max(worstIn, Math.abs(x[k] - 2 * x[k - 1] + x[k - 2]));
      }
      p2 = p1;
      p1 = outB[j];
    }
  }
  assert.ok(worst < worstIn * 1.5, 'second difference ' + worst + ' vs input ' + worstIn);
});

const KF = await mod('dsp/keyfind.js');
const HG = await mod('dsp/howl.js');
const WV = await mod('wav.js');
const RC = await mod('recorder.js');

test('keyfind: tonal melodies in all 24 keys find the key or its relative', () => {
  const MAJ = [0, 2, 4, 5, 7, 9, 11], MIN = [0, 2, 3, 5, 7, 8, 10];
  let ok = 0, total = 0;
  for (let root = 0; root < 12; root++) for (const mode of ['major', 'minor']) for (let seed = 1; seed <= 4; seed++) {
    const r = S.rng(root * 100 + seed * 7 + (mode === 'minor' ? 50 : 0));
    const scale = mode === 'major' ? MAJ : MIN;
    const kf = KF.createKeyFinder();
    let deg = 0, t = 0, n = 0;
    while (t < 15) {
      n++;
      const u = r();
      if (n % 8 === 0 || u < 0.25) deg = 0;
      else if (u < 0.4) deg = 4;
      else if (u < 0.5) deg = 2;
      else deg = Math.max(-3, Math.min(9, deg + [-2, -1, -1, 1, 1, 2][Math.floor(r() * 6)]));
      const m = 60 + root + scale[((deg % 7) + 7) % 7] + 12 * Math.floor(deg / 7) + (r() - 0.5) * 0.4;
      const dur = (n % 8 === 0 ? 0.6 : 0.15) + r() * 0.4;
      for (let q = 0; q < dur; q += 0.00267) kf.add(S.hz(m), 0.95, 0.00267);
      t += dur;
    }
    const res = kf.result(), rel = KF.relativeOf({ root, mode });
    total++;
    if ((res.key.root === root && res.key.mode === mode) || (res.key.root === rel.root && res.key.mode === rel.mode)) ok++;
  }
  assert.ok(ok / total >= 0.95, ok + '/' + total);
});

test('keyfind: under 5 seconds of singing gives no clear key', () => {
  const kf = KF.createKeyFinder();
  for (let q = 0; q < 3; q += 0.00267) kf.add(261.63, 0.95, 0.00267);
  assert.equal(kf.result().confidence, 'none');
  assert.ok(Math.abs(kf.voicedSeconds() - 3) < 0.01);
});

test('howl: a rising pure tone trips the guard; singing and quiet monitors never do', () => {
  const step = 128 / FS;
  const run = (g, fn, seconds) => { for (let t = 0; t < seconds; t += step) { const s = fn(t); if (g.update(s.voiced, s.clarity, s.pitch, s.level, step)) return t; } return -1; };
  const make = (armed, db) => { const g = HG.createHowlGuard(); g.armed = armed; g.monitorDb = db; return g; };
  const rising = (t) => ({ voiced: true, clarity: 0.99, pitch: 1000, level: -40 + 20 * t });
  const at = run(make(true, -12), rising, 2);
  assert.ok(at >= 0.25 && at <= 0.4, 'tripped at ' + at);
  assert.equal(run(make(true, -12), (t) => ({ voiced: true, clarity: 0.97, pitch: 220 * Math.pow(2, (40 / 1200) * Math.sin(2 * Math.PI * 5 * t)), level: -20 }), 5), -1);
  assert.equal(run(make(true, -12), () => ({ voiced: true, clarity: 0.99, pitch: 440, level: -20 }), 5), -1);
  assert.equal(run(make(true, -36), rising, 2), -1);
  assert.equal(run(make(false, -6), rising, 2), -1);
});

test('wav: encode and decode round trip, chunked input and stereo files', async () => {
  const a = new Float32Array(1001).map((_, i) => Math.sin(i / 7) * 0.8);
  const c = new Int16Array(1001);
  WV.floatToInt16(a, c);
  const blob = WV.encodeWav([c.slice(0, 600), c.slice(600)], 44100);
  assert.equal(blob.type, 'audio/wav');
  const buf = await blob.arrayBuffer();
  assert.equal(buf.byteLength, 44 + 1001 * 2);
  const back = WV.decodeWav(buf);
  assert.equal(back.sampleRate, 44100);
  assert.equal(back.samples.length, 1001);
  for (let i = 0; i < 1001; i++) assert.ok(Math.abs(back.samples[i] - a[i]) < 1e-4);
  const st = new ArrayBuffer(44 + 8);
  const v = new DataView(st);
  const text = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  text(0, 'RIFF'); v.setUint32(4, 44, true); text(8, 'WAVE'); text(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 2, true); v.setUint32(24, 48000, true); v.setUint32(28, 192000, true);
  v.setUint16(32, 4, true); v.setUint16(34, 16, true); text(36, 'data'); v.setUint32(40, 8, true);
  v.setInt16(44, 16384, true); v.setInt16(46, -16384, true); v.setInt16(48, -8192, true); v.setInt16(50, 8192, true);
  assert.deepEqual([...WV.decodeWav(st).samples], [0.5, -0.25]);
  assert.throws(() => WV.decodeWav(new ArrayBuffer(10)));
});

test('recorder: stops exactly at the cap and writes both WAVs', async () => {
  const rec = RC.createRecorder(48000, 1);
  const chunk = new Int16Array(8192).map((_, i) => (i % 100) * 10);
  let full = false, adds = 0;
  while (!full) { full = rec.add(chunk, chunk); adds++; }
  assert.equal(adds, 6);
  assert.equal(rec.add(chunk, chunk), true);
  const out = rec.finish();
  assert.equal(out.frames, 48000);
  assert.equal(out.duration, 1);
  assert.equal(WV.decodeWav(await out.tuned.arrayBuffer()).samples.length, 48000);
  assert.equal(WV.decodeWav(await out.dry.arrayBuffer()).samples.length, 48000);
  assert.equal(rec.frames(), 0);
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
