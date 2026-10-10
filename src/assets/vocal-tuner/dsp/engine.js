import { createDetector } from './detector.js';
import { createCorrector } from './corrector.js';
import { createShifter } from './shifter.js';

export function createEngine(fs, settings, opts = {}) {
  const det = createDetector(fs, opts);
  const cor = createCorrector(fs, settings);
  const sh = createShifter(fs);
  const hp = new Float32Array(1024);
  let count = 0, held = 0;
  const e = {
    fs,
    bypass: false,
    detectEvery: opts.detectEvery || 1,
    pitch: 0,
    clarity: 0,
    voiced: false,
    level: -180,
    note: -1,
    targetHz: 0,
    errorCents: 0,
    correctionCents: 0,
    ratio: 1,
    delayMs: 0
  };

  e.setSettings = (s) => cor.setSettings(s);

  e.process = (input, output, n = input.length) => {
    det.push(input, n);
    held += n;
    if (++count >= e.detectEvery) {
      count = 0;
      det.analyze();
      cor.update(det, held);
      held = 0;
    }
    for (let i = 0; i < n; i++) hp[i] = input[i];
    const ratio = e.bypass ? 1 : cor.ratio;
    sh.process(hp, output, ratio, det.period, det.voiced && !e.bypass, n);
    e.pitch = det.pitch;
    e.clarity = det.clarity;
    e.voiced = det.voiced;
    e.level = det.level;
    e.note = cor.note;
    e.targetHz = cor.targetHz;
    e.errorCents = cor.errorCents;
    e.correctionCents = cor.correctionCents;
    e.ratio = ratio;
    e.delayMs = (1000 * sh.delay) / fs;
  };

  e.reset = () => cor.reset();
  return e;
}
