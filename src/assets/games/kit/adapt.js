export const ADAPT_MIN_SCALE = 0.5;
export const ADAPT_SLOW_FPS = 45;
export const ADAPT_FAST_FPS = 57;

export function judgeWindow({ frames, spanMs, maxMs }) {
  const span = Math.max(1, spanMs || 0);
  const n = Math.max(0, frames || 0);
  const fps = n * 1000 / span;
  const rest = n > 1 ? (n - 1) * 1000 / Math.max(1, span - (maxMs || 0)) : fps;
  const stall = (maxMs || 0) > 120 && rest >= ADAPT_SLOW_FPS;
  return { fps, stall, slow: !stall && fps < ADAPT_SLOW_FPS, fast: !stall && fps > ADAPT_FAST_FPS };
}

export function nextScale(scale, dir) {
  let s = Number.isFinite(scale) ? scale : 1;
  if (dir === 'down') s -= 0.15;
  else if (dir === 'up') s += 0.1;
  s = Math.round(s * 100) / 100;
  return Math.min(1, Math.max(ADAPT_MIN_SCALE, s));
}

export function parseStored(v) {
  if (typeof v !== 'string' || !v) return { scale: 1, locked: false };
  const parts = v.split('|');
  return { scale: nextScale(parseFloat(parts[0]), 'keep'), locked: parts[1] === 'lock' };
}

export function formatStored(scale, locked) {
  const s = nextScale(scale, 'keep');
  if (s >= 1 && !locked) return null;
  return String(s) + (locked ? '|lock' : '');
}
