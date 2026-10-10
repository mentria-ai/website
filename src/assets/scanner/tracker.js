import { quadArea } from './geometry.js';

export const STEADY_WINDOW_MS = 400;
export const FIRE_AFTER_MS = 500;
export const LOST_AFTER_MS = 300;
export const COOLDOWN_MS = 1500;
export const GRACE_MS = 200;
const SPREAD = 0.025;
const DRIFT = 0.012;

export function shift(a, b, w, h) {
  const L = Math.max(w, h) || 1;
  let m = 0;
  for (let i = 0; i < 4; i++) {
    const d = Math.hypot((a[i][0] - b[i][0]) * w / L, (a[i][1] - b[i][1]) * h / L);
    if (d > m) m = d;
  }
  return m;
}

function median(a) {
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function medianQuad(qs) {
  return [0, 1, 2, 3].map((i) => [median(qs.map((q) => q[i][0])), median(qs.map((q) => q[i][1]))]);
}

function quantile(a, p) {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

export function createTracker() {
  let smooth = null;
  let lastSeen = -Infinity;
  let hist = [];
  let steadySince = 0;
  let lastSteady = 0;
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

  function step(r, t) {
    const ok = !!(r && r.quad && r.confidence > 0);
    if (r && r.w) dims = [r.w, r.h];
    const [w, h] = dims;
    if (!ok) {
      if (captured && t - lastSeen > LOST_AFTER_MS) dipped = true;
      if (t - lastSeen > LOST_AFTER_MS) clear();
      if (!smooth) return { quad: null, state: 'none', progress: 0 };
      const armed = steadySince && changed && t >= cooldownUntil;
      return { quad: smooth, state: steadySince ? 'steady' : 'found', progress: armed ? Math.min(0.99, (t - steadySince) / FIRE_AFTER_MS) : 0 };
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
    const most = (n) => n >= Math.ceil(win.length * 0.8);
    const half = win.length >> 1;
    const mid = medianQuad(win.map((e) => e.quad));
    const still = half > 0
      && most(win.filter((e) => shift(mid, e.quad, w, h) < SPREAD).length)
      && shift(medianQuad(win.slice(0, half).map((e) => e.quad)), medianQuad(win.slice(half).map((e) => e.quad)), w, h) < DRIFT;
    const good = most(win.filter((e) => e.conf >= 0.6).length) && quadArea(smooth) >= 0.2;
    const sharp = (r.sharpness || 0) >= 0.7 * quantile(hist.map((e) => e.sharp), 0.8);
    const steadyNow = spans && win.length >= 3 && still && good;
    if (steadyNow) {
      lastSteady = t;
      if (!steadySince) steadySince = t;
    } else if (steadySince && t - lastSteady > GRACE_MS) {
      steadySince = 0;
    }
    if (!steadySince) return { quad: smooth, state: 'found', progress: 0 };
    if (!(changed && t >= cooldownUntil)) return { quad: smooth, state: 'steady', progress: 0 };
    const progress = Math.min(1, (t - steadySince) / FIRE_AFTER_MS);
    if (progress >= 1 && steadyNow && sharp) return { quad: smooth, state: 'fire', progress: 1 };
    return { quad: smooth, state: 'steady', progress: Math.min(0.99, progress) };
  }

  function push(r, t) {
    const s = step(r, t);
    s.captured = !!captured && !changed;
    return s;
  }

  function markCaptured(t) {
    captured = smooth ? smooth.map((p) => [p[0], p[1]]) : null;
    cooldownUntil = t + COOLDOWN_MS;
    changed = !captured;
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
