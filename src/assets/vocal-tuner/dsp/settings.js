export const PRESETS = { natural: 0.35, tight: 0.65, hard: 1 };
export const DEFAULT_SETTINGS = { correction: 0.35, key: null };
export const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const ANCHORS = [
  [0, 80, 1, 30],
  [0.35, 40, 1, 40],
  [0.65, 15, 0.4, 70],
  [1, 0, 0, 1000]
];

export function curve(c) {
  const x = Math.max(0, Math.min(1, Number(c) || 0));
  for (let i = 1; i < ANCHORS.length; i++) {
    const a = ANCHORS[i - 1], b = ANCHORS[i];
    if (x <= b[0]) {
      const f = (x - a[0]) / (b[0] - a[0]);
      return { tau: (a[1] + f * (b[1] - a[1])) / 1000, humanize: a[2] + f * (b[2] - a[2]), keep: a[3] + f * (b[3] - a[3]) };
    }
  }
  return { tau: 0, humanize: 0, keep: 1000 };
}

export function presetOf(c) {
  for (const name of Object.keys(PRESETS)) if (Math.abs(PRESETS[name] - c) < 1e-6) return name;
  return null;
}

export function scaleMask(key, out = new Uint8Array(12)) {
  if (!key || key.root == null) { out.fill(1); return out; }
  out.fill(0);
  for (const step of key.mode === 'minor' ? MINOR : MAJOR) out[(key.root + step) % 12] = 1;
  return out;
}

export function normalize(s) {
  const src = s || {};
  const c = Math.max(0, Math.min(1, Number(src.correction)));
  const key = src.key && Number.isInteger(src.key.root) && src.key.root >= 0 && src.key.root < 12
    ? { root: src.key.root, mode: src.key.mode === 'minor' ? 'minor' : 'major' }
    : null;
  return { correction: Number.isFinite(c) ? c : DEFAULT_SETTINGS.correction, key };
}

export function keyLabel(key) {
  return key ? NOTE_NAMES[key.root] + (key.mode === 'minor' ? 'm' : '') : '';
}
