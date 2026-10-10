import { curve, scaleMask, normalize } from './settings.js';

export function createCorrector(fs, settings) {
  const mask = new Uint8Array(12);
  const st = new Float64Array(11);
  const TAU = 0, HUM = 1, KEEP = 2, MS = 3, PREV = 4, CORR = 5, CAND_T = 6, FAST_T = 7, HELD_T = 8, UNV_T = 9;
  let note = -1;
  st[KEEP] = 1000;
  st[UNV_T] = 1;
  const c = { note: -1, targetHz: 0, errorCents: 0, correctionCents: 0, ratio: 1 };

  c.setSettings = (s) => {
    const n = normalize(s);
    const k = curve(n.correction);
    st[TAU] = k.tau;
    st[HUM] = k.humanize;
    st[KEEP] = k.keep;
    scaleMask(n.key, mask);
  };
  c.setSettings(settings);

  function nearest(x) {
    const base = Math.round(x);
    let best = -1, bestD = 1e9;
    for (let d = -6; d <= 6; d++) {
      const cand = base + d;
      if (!mask[((cand % 12) + 12) % 12]) continue;
      const dist = Math.abs(cand - x);
      if (dist < bestD) { bestD = dist; best = cand; }
    }
    return best;
  }

  c.update = (det, hop) => {
    const dt = hop / fs;
    if (!det.voiced || !(det.pitch > 0)) {
      st[UNV_T] += dt;
      if (st[UNV_T] > 0.04) {
        st[CORR] += (1 - Math.exp(-dt / 0.015)) * -st[CORR];
        note = -1;
      }
      c.note = note;
      c.errorCents = 0;
      c.correctionCents = 100 * st[CORR];
      c.ratio = Math.pow(2, st[CORR] / 12);
      return;
    }
    const m = 69 + 12 * Math.log2(det.pitch / 440);
    if (note < 0 || st[UNV_T] > 0.04) {
      st[MS] = m;
      st[PREV] = m;
      note = nearest(m);
      st[HELD_T] = 0;
      st[CAND_T] = 0;
      st[FAST_T] = 0;
    }
    st[UNV_T] = 0;
    st[MS] += (1 - Math.exp(-dt / 0.06)) * (m - st[MS]);
    const rate = Math.abs(st[MS] - st[PREV]) / dt;
    st[PREV] = st[MS];
    const cand = nearest(st[MS]);
    if (cand !== note && Math.abs(st[MS] - cand) + 0.3 < Math.abs(st[MS] - note)) {
      st[CAND_T] += dt;
      if (st[CAND_T] >= 0.02) { note = cand; st[HELD_T] = 0; st[CAND_T] = 0; }
    } else st[CAND_T] = 0;
    if (Math.abs(m - note) > 0.85) {
      st[FAST_T] += dt;
      if (st[FAST_T] >= 0.015) {
        note = nearest(m);
        st[MS] = m;
        st[PREV] = m;
        st[HELD_T] = 0;
        st[FAST_T] = 0;
      }
    } else st[FAST_T] = 0;
    st[HELD_T] += dt;
    let e = note - m;
    e = ((((e + 6) % 12) + 12) % 12) - 6;
    if (e > 2) e = 2;
    else if (e < -2) e = -2;
    const cents = Math.abs(100 * e);
    const keep = st[KEEP];
    let w = keep >= 1000 || cents <= keep ? 1 : cents < keep + 40 ? 1 - (cents - keep) / 40 : 0;
    if (rate > 8) w *= Math.max(0, 1 - (rate - 8) / 8);
    const held = st[HELD_T];
    const ramp = held <= 0.2 ? 0 : held >= 0.3 ? 1 : (held - 0.2) / 0.1;
    const tEff = st[TAU] + st[HUM] * 0.1 * ramp;
    if (tEff <= 0) st[CORR] = w * e;
    else st[CORR] += (1 - Math.exp(-dt / tEff)) * (w * e - st[CORR]);
    c.note = note;
    c.targetHz = 440 * Math.pow(2, (note - 69) / 12);
    c.errorCents = 100 * e;
    c.correctionCents = 100 * st[CORR];
    c.ratio = Math.pow(2, st[CORR] / 12);
  };

  c.reset = () => {
    note = -1;
    st[CORR] = 0;
    st[UNV_T] = 1;
    c.ratio = 1;
  };

  return c;
}
