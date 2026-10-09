import { homography, applyH, orderQuad, isConvex } from '../src/assets/scanner/geometry.js';

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KINDS = ['noise', 'gradient', 'stripes', 'lowcontrast'];

function gauss(r) {
  let u = 0, v = 0;
  while (!u) u = r();
  while (!v) v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function background(kind, r, w, h) {
  const out = new Float32Array(w * h * 3);
  const base = 70 + r() * 60;
  const tint = [r() * 20 - 10, r() * 20 - 10, r() * 20 - 10];
  const ang = r() * Math.PI, period = 18 + r() * 20;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      let c;
      if (kind === 'noise') {
        const n = gauss(r) * 14;
        c = [base + tint[0] + n, base + tint[1] + n, base + tint[2] + n];
      } else if (kind === 'gradient') {
        const v = 40 + 110 * (0.6 * x / w + 0.4 * y / h) + gauss(r) * 6;
        c = [v + tint[0], v + tint[1], v + tint[2]];
      } else if (kind === 'stripes') {
        const s = 18 * Math.sin((x * Math.cos(ang) + y * Math.sin(ang)) / period * 2 * Math.PI) + gauss(r) * 5;
        c = [130 + s, 90 + s * 0.8, 55 + s * 0.6];
      } else {
        const n = gauss(r) * 4;
        c = [185 + n, 185 + n, 188 + n];
      }
      out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2];
    }
  }
  return out;
}

function placePage(r, w, h) {
  for (let attempt = 0; attempt < 400; attempt++) {
    const aspect = r() < 0.5 ? 1.414 : 0.6 + r() * 1.1;
    const frac = 0.25 + r() * 0.6;
    const pw = Math.sqrt(frac * w * h / aspect), ph = pw * aspect;
    const ang = (r() * 60 - 30) * Math.PI / 180;
    const cx = w / 2 + (r() - 0.5) * w * 0.2, cy = h / 2 + (r() - 0.5) * h * 0.2;
    const jit = 0.08 * Math.min(pw, ph);
    const q = [[-pw / 2, -ph / 2], [pw / 2, -ph / 2], [pw / 2, ph / 2], [-pw / 2, ph / 2]].map(([x, y]) => [
      cx + x * Math.cos(ang) - y * Math.sin(ang) + (r() - 0.5) * 2 * jit,
      cy + x * Math.sin(ang) + y * Math.cos(ang) + (r() - 0.5) * 2 * jit
    ]);
    const m = 0.03;
    if (q.every(([x, y]) => x > m * w && x < (1 - m) * w && y > m * h && y < (1 - m) * h) && isConvex(q)) return orderQuad(q);
  }
  return orderQuad([[0.2 * w, 0.2 * h], [0.8 * w, 0.2 * h], [0.8 * w, 0.8 * h], [0.2 * w, 0.8 * h]]);
}

function drawPage(img, w, h, q, r) {
  const H = homography(q, [[0, 0], [1, 0], [1, 1], [0, 1]]);
  const paper = [238 + r() * 12, 236 + r() * 12, 230 + r() * 14];
  const ink = 40 + r() * 30;
  const xs = q.map((p) => p[0]), ys = q.map((p) => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(w - 1, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(h - 1, Math.ceil(Math.max(...ys)));
  const inside = (x, y) => {
    for (let i = 0; i < 4; i++) {
      const a = q[i], b = q[(i + 1) % 4];
      if ((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) < 0) return false;
    }
    return true;
  };
  const sub = [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      let cov = 0;
      for (const s of sub) if (inside(x + s[0], y + s[1])) cov++;
      if (!cov) continue;
      const [u, v] = applyH(H, x + 0.5, y + 0.5);
      let col = paper;
      if (u > 0.1 && u < 0.9 && v > 0.12 && v < 0.88) {
        const line = Math.floor(v * 28), f = v * 28 - line, word = Math.floor(u * 14);
        const hsh = Math.sin(line * 12.9898 + word * 78.233) * 43758.5453;
        if (f < 0.35 && hsh - Math.floor(hsh) > 0.25) col = [ink, ink, ink];
      }
      const i = (y * w + x) * 3, a = cov / 4;
      img[i] = img[i] * (1 - a) + col[0] * a;
      img[i + 1] = img[i + 1] * (1 - a) + col[1] * a;
      img[i + 2] = img[i + 2] * (1 - a) + col[2] * a;
    }
  }
}

function clutter(img, w, h, r) {
  const n = 2 + Math.floor(r() * 3);
  for (let k = 0; k < n; k++) {
    const bw = 12 + r() * 30, bh = 12 + r() * 30;
    const bx = r() * (w - bw), by = r() * (h - bh);
    const v = r() < 0.5 ? 30 + r() * 40 : 200 + r() * 40;
    for (let y = Math.floor(by); y < by + bh; y++) {
      for (let x = Math.floor(bx); x < bx + bw; x++) {
        const i = (y * w + x) * 3;
        img[i] = v; img[i + 1] = v; img[i + 2] = v;
      }
    }
  }
}

function blurRGB(img, w, h, sigma) {
  if (sigma <= 0.05) return img;
  const rad = Math.ceil(sigma * 2.5), k = [];
  let sum = 0;
  for (let i = -rad; i <= rad; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); k.push(v); sum += v; }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const tmp = new Float32Array(img.length), out = new Float32Array(img.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        let s = 0;
        for (let j = -rad; j <= rad; j++) { const xx = Math.min(w - 1, Math.max(0, x + j)); s += img[(y * w + xx) * 3 + c] * k[j + rad]; }
        tmp[(y * w + x) * 3 + c] = s;
      }
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) {
        let s = 0;
        for (let j = -rad; j <= rad; j++) { const yy = Math.min(h - 1, Math.max(0, y + j)); s += tmp[(yy * w + x) * 3 + c] * k[j + rad]; }
        out[(y * w + x) * 3 + c] = s;
      }
    }
  }
  return out;
}

export function makeScene(seed, opts = {}) {
  const w = opts.w || 384, h = opts.h || 288;
  const r = rng(seed);
  const kind = opts.kind || KINDS[Math.floor(r() * KINDS.length)];
  let img = background(kind, r, w, h);
  let truth = null;
  if (opts.empty) clutter(img, w, h, r);
  else { truth = placePage(r, w, h); drawPage(img, w, h, truth, r); }
  const light = 0.85 + r() * 0.1, dir = r() < 0.5;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const f = light + (1 - light) * (dir ? x / w : 1 - x / w);
      const i = (y * w + x) * 3;
      img[i] *= f; img[i + 1] *= f; img[i + 2] *= f;
    }
  }
  const sig = r();
  img = blurRGB(img, w, h, opts.blur != null ? opts.blur : 0.6 + sig * 0.6);
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) {
    for (let c = 0; c < 3; c++) rgba[p * 4 + c] = img[p * 3 + c] + gauss(r) * 3;
    rgba[p * 4 + 3] = 255;
  }
  return { rgba, w, h, truth, kind };
}
