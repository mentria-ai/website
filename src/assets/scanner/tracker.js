import { quadArea } from './geometry.js';

export const STEADY_WINDOW_MS = 500;
export const FIRE_AFTER_MS = 600;
export const LOST_AFTER_MS = 300;
export const COOLDOWN_MS = 1500;

export function shift(a, b, w, h) {
  const L = Math.max(w, h) || 1;
  let m = 0;
  for (let i = 0; i < 4; i++) {
    const d = Math.hypot((a[i][0] - b[i][0]) * w / L, (a[i][1] - b[i][1]) * h / L);
    if (d > m) m = d;
  }
  return m;
}

export function createTracker() {
  let smooth = null;
  let lastSeen = -Infinity;
  let hist = [];
  let steadySince = 0;
  let captured = null;
  let cooldownUntil = 0;
  let changed = true;
  let dipped = false;
  let dims = [1, 1];

  function clear() {
    smooth = null;
    hist = [];
    steadySince = 0;
  }

  function push(r, t) {
    const ok = !!(r && r.quad && r.confidence > 0);
    if (r && r.w) dims = [r.w, r.h];
    const [w, h] = dims;
    if (!ok) {
      if (captured && t - lastSeen > LOST_AFTER_MS) dipped = true;
      if (t - lastSeen > LOST_AFTER_MS) clear();
      steadySince = 0;
      return { quad: smooth, state: smooth ? 'found' : 'none', progress: 0 };
    }
    lastSeen = t;
    if (!smooth || shift(smooth, r.quad, w, h) > 0.1) {
      smooth = r.quad.map((p) => [p[0], p[1]]);
      hist = [];
      steadySince = 0;
    } else {
      smooth = smooth.map((p, i) => [(p[0] + r.quad[i][0]) / 2, (p[1] + r.quad[i][1]) / 2]);
    }
    hist.push({ t, quad: smooth.map((p) => [p[0], p[1]]), conf: r.confidence, sharp: r.sharpness || 0, area: quadArea(smooth) });
    while (hist.length && t - hist[0].t > 2000) hist.shift();
    if (captured) {
      if (shift(captured, smooth, w, h) > 0.15) changed = true;
      if (dipped && r.confidence >= 0.6) changed = true;
    }
    const win = hist.filter((e) => t - e.t <= STEADY_WINDOW_MS);
    const spans = t - hist[0].t >= STEADY_WINDOW_MS;
    const maxSharp = hist.reduce((m, e) => Math.max(m, e.sharp), 0);
    const still = win.every((e) => shift(win[0].quad, e.quad, w, h) < 0.015);
    const good = win.every((e) => e.conf >= 0.6 && e.area >= 0.2);
    const sharp = (r.sharpness || 0) >= 0.8 * maxSharp;
    if (!(spans && win.length >= 3 && still && good && sharp)) {
      steadySince = 0;
      return { quad: smooth, state: 'found', progress: 0 };
    }
    if (!steadySince) steadySince = t;
    if (!(changed && t >= cooldownUntil)) return { quad: smooth, state: 'steady', progress: 0 };
    const progress = Math.min(1, (t - steadySince) / FIRE_AFTER_MS);
    return { quad: smooth, state: progress >= 1 ? 'fire' : 'steady', progress };
  }

  function markCaptured(t) {
    captured = smooth ? smooth.map((p) => [p[0], p[1]]) : null;
    cooldownUntil = t + COOLDOWN_MS;
    changed = false;
    dipped = false;
    steadySince = 0;
  }

  function reset() {
    clear();
    captured = null;
    cooldownUntil = 0;
    changed = true;
    dipped = false;
    lastSeen = -Infinity;
  }

  return { push, markCaptured, reset };
}
