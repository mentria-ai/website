import * as THREE from 'three';
import { clamp, lerp, smoothstep, mulberry32 } from './math.js';

const assetConfig = { root: '/assets/games', enabled: true, version: '', timeoutMs: 8000 };
const textureCache = new Map();
const pendingLoads = new Set();
const materialCache = new Map();
const imageCache = new Map();
const resultCache = new Map();
const proceduralStats = { genMs: 0, perTexture: {} };
const PROCEDURAL_ONLY = new Set(['facade-office', 'facade-apartment', 'facade-night', 'facade-office-lit', 'facade-apartment-lit', 'container', 'container-doors', 'carbon', 'rubber', 'paint-flake']);

const FACADE_LAYOUTS = {
  office: { x: 12, y: 14.4, bays: 4, floors: 4 },
  apartment: { x: 12.8, y: 12, bays: 4, floors: 4 },
};

export function configureGameAssets(opts = {}) {
  if (typeof opts.root === 'string') assetConfig.root = opts.root.replace(/\/$/, '');
  if (typeof opts.enabled === 'boolean') assetConfig.enabled = opts.enabled;
  if (typeof opts.version === 'string') assetConfig.version = opts.version;
  if (typeof opts.timeoutMs === 'number') assetConfig.timeoutMs = opts.timeoutMs;
  return { ...assetConfig };
}

export function gameAssetsEnabled() {
  return assetConfig.enabled;
}

export function gameAssetUrl(folder, name, ext = 'webp') {
  const v = assetConfig.version ? '?v=' + encodeURIComponent(assetConfig.version) : '';
  return assetConfig.root + '/' + folder + '/' + name + '.' + ext + v;
}

export function loadGameImage(folder, name, ext = 'webp') {
  if (!assetConfig.enabled || typeof Image === 'undefined') return Promise.resolve(null);
  const url = gameAssetUrl(folder, name, ext);
  if (imageCache.has(url)) return imageCache.get(url);
  const promise = new Promise((resolve) => {
    const img = new Image();
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), assetConfig.timeoutMs);
    img.decoding = 'async';
    img.onload = () => finish(img);
    img.onerror = () => finish(null);
    img.src = url;
  });
  imageCache.set(url, promise);
  return promise;
}

function hash2(ix, iy, seed) {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function periodicValueNoise(x, y, period, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const x0 = ((ix % period) + period) % period;
  const y0 = ((iy % period) + period) % period;
  const x1 = (x0 + 1) % period;
  const y1 = (y0 + 1) % period;
  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
}

export function tileableFbm(u, v, baseCells, octaves, seed, gain = 0.5) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let cells = baseCells;
  for (let o = 0; o < octaves; o++) {
    sum += amp * periodicValueNoise(u * cells, v * cells, cells, seed + o * 31);
    norm += amp;
    amp *= gain;
    cells *= 2;
  }
  return sum / norm;
}

function noiseField(size, cellsX, cellsY, octaves, seed, gain = 0.5) {
  const n = size * size;
  const out = new Float32Array(n);
  const x0 = new Int32Array(size);
  const x1 = new Int32Array(size);
  const wx = new Float32Array(size);
  let amp = 1;
  let norm = 0;
  let cx = Math.max(1, Math.round(cellsX));
  let cy = Math.max(1, Math.round(cellsY));
  for (let o = 0; o < octaves; o++) {
    const lat = new Float32Array(cx * cy);
    const s = seed + o * 1013;
    for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) lat[j * cx + i] = hash2(i, j, s);
    for (let x = 0; x < size; x++) {
      const f = (x / size) * cx;
      const i = Math.floor(f);
      const t = f - i;
      x0[x] = i % cx;
      x1[x] = (i + 1) % cx;
      wx[x] = t * t * (3 - 2 * t);
    }
    for (let y = 0; y < size; y++) {
      const f = (y / size) * cy;
      const j = Math.floor(f);
      const t = f - j;
      const wy = t * t * (3 - 2 * t);
      const r0 = (j % cy) * cx;
      const r1 = ((j + 1) % cy) * cx;
      const row = y * size;
      for (let x = 0; x < size; x++) {
        const a = lat[r0 + x0[x]];
        const b = lat[r0 + x1[x]];
        const c = lat[r1 + x0[x]];
        const d = lat[r1 + x1[x]];
        const top = a + (b - a) * wx[x];
        const bot = c + (d - c) * wx[x];
        out[row + x] += amp * (top + (bot - top) * wy);
      }
    }
    norm += amp;
    amp *= gain;
    cx *= 2;
    cy *= 2;
  }
  const inv = 1 / norm;
  for (let i = 0; i < n; i++) out[i] *= inv;
  return out;
}

function normalizeField(f) {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < f.length; i++) {
    const v = f[i];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const s = hi > lo ? 1 / (hi - lo) : 0;
  for (let i = 0; i < f.length; i++) f[i] = (f[i] - lo) * s;
  return f;
}

function cellNoise(size, cells, seed) {
  const n = size * size;
  const px = new Float32Array(cells * cells);
  const py = new Float32Array(cells * cells);
  const pid = new Float32Array(cells * cells);
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const k = j * cells + i;
      px[k] = hash2(i, j, seed);
      py[k] = hash2(i, j, seed + 7);
      pid[k] = hash2(i, j, seed + 13);
    }
  }
  const f1 = new Float32Array(n);
  const f2 = new Float32Array(n);
  const id = new Float32Array(n);
  for (let y = 0; y < size; y++) {
    const gy = (y + 0.5) / size * cells;
    const cj = Math.floor(gy);
    for (let x = 0; x < size; x++) {
      const gx = (x + 0.5) / size * cells;
      const ci = Math.floor(gx);
      let best = 9;
      let second = 9;
      let bestId = 0;
      for (let dj = -1; dj <= 1; dj++) {
        const nj = cj + dj;
        const wj = ((nj % cells) + cells) % cells;
        for (let di = -1; di <= 1; di++) {
          const ni = ci + di;
          const wi = ((ni % cells) + cells) % cells;
          const k = wj * cells + wi;
          const dx = ni + px[k] - gx;
          const dy = nj + py[k] - gy;
          const d = dx * dx + dy * dy;
          if (d < best) { second = best; best = d; bestId = pid[k]; } else if (d < second) second = d;
        }
      }
      const idx = y * size + x;
      f1[idx] = Math.sqrt(best);
      f2[idx] = Math.sqrt(second);
      id[idx] = bestId;
    }
  }
  return { f1, f2, id };
}

function makeCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function createSurface(size) {
  const n = size * size;
  const ro = new Float32Array(n);
  const me = new Float32Array(n);
  ro.fill(1);
  me.fill(1);
  return { size, n, r: new Float32Array(n), g: new Float32Array(n), b: new Float32Array(n), h: new Float32Array(n), ro, me, a: null };
}

function wrapIndex(v, size) {
  return ((v % size) + size) % size;
}

function stampEllipse(s, cx, cy, rx, ry, angle, fn) {
  const size = s.size;
  const R = Math.ceil(Math.max(rx, ry)) + 1;
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  const icx = Math.floor(cx);
  const icy = Math.floor(cy);
  const rmax = Math.max(rx, ry);
  for (let dy = -R; dy <= R; dy++) {
    const py = icy + dy;
    const wy = wrapIndex(py, size);
    const fy = py + 0.5 - cy;
    for (let dx = -R; dx <= R; dx++) {
      const px = icx + dx;
      const fx = px + 0.5 - cx;
      const lx = (fx * ca + fy * sa) / rx;
      const ly = (-fx * sa + fy * ca) / ry;
      const t2 = lx * lx + ly * ly;
      if (t2 >= 1) continue;
      fn(wy * size + wrapIndex(px, size), Math.sqrt(t2), fx / rmax, fy / rmax, lx, ly);
    }
  }
}

function stampSegment(s, x0, y0, x1, y1, w, fn) {
  const size = s.size;
  const minx = Math.floor(Math.min(x0, x1) - w - 1);
  const maxx = Math.ceil(Math.max(x0, x1) + w + 1);
  const miny = Math.floor(Math.min(y0, y1) - w - 1);
  const maxy = Math.ceil(Math.max(y0, y1) + w + 1);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy || 1e-9;
  for (let py = miny; py <= maxy; py++) {
    const wy = wrapIndex(py, size);
    const fy = py + 0.5;
    for (let px = minx; px <= maxx; px++) {
      const fx = px + 0.5;
      let t = ((fx - x0) * dx + (fy - y0) * dy) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = x0 + dx * t - fx;
      const ey = y0 + dy * t - fy;
      const d = Math.sqrt(ex * ex + ey * ey);
      if (d >= w) continue;
      fn(wy * size + wrapIndex(px, size), t, d / w);
    }
  }
}

function domeShade(ix, iy, t) {
  const nz = Math.sqrt(Math.max(0, 1 - t * t));
  const lit = -0.45 * ix - 0.55 * iy + 0.7 * nz;
  return 0.62 + 0.5 * Math.max(-0.4, lit);
}

function surfaceCanvas(s) {
  const size = s.size;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const a = s.a;
  for (let i = 0, j = 0; i < s.n; i++, j += 4) {
    d[j] = s.r[i] * 255;
    d[j + 1] = s.g[i] * 255;
    d[j + 2] = s.b[i] * 255;
    d[j + 3] = a ? 128 + a[i] * 127 : 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function finishSurface(s, extra = {}) {
  return { canvas: surfaceCanvas(s), height: s.h, rough: s.ro, metal: s.me, size: s.size, ...extra };
}

function setRGB(s, i, r, g, b) {
  s.r[i] = r;
  s.g[i] = g;
  s.b[i] = b;
}

function paintGrass(size) {
  const s = createSurface(size);
  const sc = size / 512;
  const patch = normalizeField(noiseField(size, 6, 6, 3, 101));
  const mid = noiseField(size, 10, 10, 3, 102);
  const fine = noiseField(size, 48, 48, 2, 103);
  for (let i = 0; i < s.n; i++) {
    const dry = 0.6 * smoothstep(0.55, 0.95, patch[i]);
    const v = 0.72 + 0.4 * fine[i] + 0.2 * (mid[i] - 0.5);
    setRGB(s, i, lerp(0.11, 0.22, dry) * v, lerp(0.16, 0.18, dry) * v, lerp(0.05, 0.09, dry) * v);
    s.h[i] = 0.1 * fine[i];
  }
  const rand = mulberry32(104);
  const blades = Math.round(12500 * sc * sc);
  for (let k = 0; k < blades; k++) {
    const x = rand() * size;
    const y = rand() * size;
    const idx = wrapIndex(Math.floor(y), size) * size + wrapIndex(Math.floor(x), size);
    const dry = 0.65 * smoothstep(0.5, 0.95, patch[idx] + (rand() - 0.5) * 0.35);
    const ang = rand() * Math.PI * 2;
    const len = (4.5 + rand() * 9) * sc;
    const w = (0.65 + rand() * 0.7) * sc;
    const x1 = x + Math.cos(ang) * len;
    const y1 = y + Math.sin(ang) * len;
    const bright = 0.72 + rand() * 0.5;
    const hue = rand();
    const r0 = lerp(0.17, 0.4, dry) * bright;
    const g0 = lerp(0.3, 0.36, dry) * bright;
    const b0 = lerp(0.08, 0.16, dry) * bright;
    const rt = lerp(lerp(0.32, 0.4, hue), 0.6, dry) * bright;
    const gt = lerp(0.48, 0.53, dry) * bright;
    const bt = lerp(0.13, 0.28, dry) * bright;
    stampSegment(s, x, y, x1, y1, w, (i, t, d) => {
      const hh = 0.25 + 0.75 * t;
      if (hh < s.h[i]) return;
      const edge = 1 - 0.3 * d;
      setRGB(s, i, lerp(r0 * 0.55, rt, t) * edge, lerp(g0 * 0.55, gt, t) * edge, lerp(b0 * 0.55, bt, t) * edge);
      s.h[i] = hh;
    });
  }
  const flowers = Math.round(26 * sc * sc);
  for (let k = 0; k < flowers; k++) {
    const x = rand() * size;
    const y = rand() * size;
    const yellow = rand() < 0.6;
    stampEllipse(s, x, y, 1.3 * sc + 0.4, 1.3 * sc + 0.4, 0, (i, t) => {
      const f = 1 - 0.3 * t;
      if (yellow) setRGB(s, i, 0.86 * f, 0.76 * f, 0.22 * f);
      else setRGB(s, i, 0.86 * f, 0.86 * f, 0.82 * f);
      s.h[i] = 1;
    });
  }
  return finishSurface(s);
}

function paintDirt(size) {
  const s = createSurface(size);
  const sc = size / 512;
  const big = normalizeField(noiseField(size, 3, 3, 4, 201));
  const mid = noiseField(size, 12, 12, 3, 202);
  const fine = noiseField(size, 96, 96, 2, 203);
  const cracks = cellNoise(size, 7, 204);
  for (let i = 0; i < s.n; i++) {
    const damp = 0.55 * smoothstep(0.58, 0.95, big[i]);
    const v = 0.84 + 0.3 * (mid[i] - 0.5) + 0.3 * (fine[i] - 0.5);
    let r = lerp(0.4, 0.27, damp) * v;
    let g = lerp(0.31, 0.2, damp) * v;
    let b = lerp(0.22, 0.14, damp) * v;
    const edge = cracks.f2[i] - cracks.f1[i];
    const cm = 0.65 * (1 - smoothstep(0, 0.032, edge)) * smoothstep(0.5, 0.68, mid[i]) * (1 - damp);
    r *= 1 - 0.5 * cm;
    g *= 1 - 0.5 * cm;
    b *= 1 - 0.5 * cm;
    setRGB(s, i, r, g, b);
    s.h[i] = 0.45 + 0.3 * (mid[i] - 0.5) + 0.15 * fine[i] - 0.35 * cm;
  }
  const rand = mulberry32(205);
  const pebbles = Math.round(700 * sc * sc);
  for (let k = 0; k < pebbles; k++) {
    const x = rand() * size;
    const y = rand() * size;
    const rr = (1 + Math.pow(rand(), 2.2) * 4.5) * sc;
    const ratio = 0.6 + rand() * 0.4;
    const l = 0.25 + rand() * 0.2;
    const warm = rand();
    const pr = l * lerp(0.98, 1.1, warm);
    const pg = l * lerp(0.98, 1.0, warm);
    const pb = l * lerp(0.98, 0.86, warm);
    stampEllipse(s, x, y, rr, rr * ratio, rand() * Math.PI, (i, t, ix, iy) => {
      const shade = domeShade(ix, iy, t) * (t > 0.82 ? 0.72 : 1);
      setRGB(s, i, pr * shade, pg * shade, pb * shade);
      s.h[i] = Math.max(s.h[i], 0.55 + 0.45 * Math.sqrt(1 - t * t));
    });
  }
  return finishSurface(s);
}

function paintRock(size) {
  const s = createSurface(size);
  const warp = noiseField(size, 4, 4, 4, 301);
  const mid = noiseField(size, 8, 8, 4, 302);
  const fine = noiseField(size, 64, 64, 3, 303);
  const cells = cellNoise(size, 5, 304);
  const lichenN = normalizeField(noiseField(size, 20, 20, 3, 305));
  const crackMask = normalizeField(noiseField(size, 6, 6, 3, 308));
  const palette = [[0.47, 0.44, 0.4], [0.4, 0.37, 0.33], [0.55, 0.51, 0.46], [0.36, 0.34, 0.31], [0.5, 0.46, 0.39], [0.44, 0.42, 0.4]];
  const layers = 9;
  const layerColors = [];
  for (let li = 0; li < layers; li++) layerColors.push(palette[Math.floor(hash2(li, 3, 306) * palette.length)]);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const lc = (v + (warp[i] - 0.5) * 0.28) * layers;
      const lf = Math.floor(lc);
      const li = wrapIndex(lf, layers);
      const f = lc - lf;
      const c = layerColors[li];
      const ledge = 0.86 + 0.22 * smoothstep(0, 0.12, f) - 0.22 * smoothstep(0.86, 1, f);
      const detail = 0.68 + 0.55 * fine[i] + 0.25 * (mid[i] - 0.5);
      const e = cells.f2[i] - cells.f1[i];
      const crack = Math.max((1 - smoothstep(0, 0.03, e)) * smoothstep(0.5, 0.66, crackMask[i]), (1 - smoothstep(0, 0.035, f)) * smoothstep(0.45, 0.6, mid[i]));
      const lichen = smoothstep(0.74, 0.82, lichenN[i]) * smoothstep(0.35, 0.55, fine[i]);
      const lichenOrange = hash2(Math.floor(x / 37), Math.floor(y / 41), 307) < 0.3;
      let r = c[0] * ledge * detail;
      let g = c[1] * ledge * detail;
      let b = c[2] * ledge * detail;
      if (lichenOrange) {
        r = lerp(r, 0.66, lichen * 0.7);
        g = lerp(g, 0.47, lichen * 0.7);
        b = lerp(b, 0.24, lichen * 0.7);
      } else {
        r = lerp(r, 0.6, lichen * 0.75);
        g = lerp(g, 0.63, lichen * 0.75);
        b = lerp(b, 0.5, lichen * 0.75);
      }
      const dk = 1 - 0.5 * crack;
      setRGB(s, i, r * dk, g * dk, b * dk);
      s.h[i] = 0.5 + 0.3 * (fine[i] - 0.5) + 0.2 * (mid[i] - 0.5) + 0.12 * smoothstep(0, 0.12, f) - 0.45 * crack;
      s.ro[i] = 1 - 0.1 * lichen;
    }
  }
  return finishSurface(s);
}

function paintSand(size) {
  const s = createSurface(size);
  const warp = noiseField(size, 3, 3, 3, 401);
  const big = noiseField(size, 4, 4, 3, 402);
  const fine = noiseField(size, 128, 128, 1, 403);
  const rand = mulberry32(404);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const u = x / size;
      const phase = u * 9 + v * 4 + (warp[i] - 0.5) * 2.4;
      const p = phase - Math.floor(phase);
      const ripple = p < 0.72 ? smoothstep(0, 0.72, p) : 1 - smoothstep(0.72, 1, p);
      const shade = p < 0.72 ? 1.02 : 0.95;
      let k = (0.9 + 0.18 * big[i]) * (0.94 + 0.12 * fine[i]) * shade;
      const rr = rand();
      if (rr < 0.035) k *= 0.6;
      else if (rr < 0.06) k *= 1.12;
      setRGB(s, i, 0.77 * k, 0.61 * k, 0.42 * k);
      s.h[i] = 0.55 * ripple + 0.12 * fine[i];
    }
  }
  return finishSurface(s);
}

function paintForestFloor(size) {
  const s = createSurface(size);
  const sc = size / 512;
  const mid = noiseField(size, 8, 8, 3, 501);
  const fine = noiseField(size, 64, 64, 2, 502);
  const moss = normalizeField(noiseField(size, 4, 4, 4, 503));
  for (let i = 0; i < s.n; i++) {
    const v = 0.78 + 0.45 * fine[i] + 0.2 * (mid[i] - 0.5);
    const m = smoothstep(0.62, 0.78, moss[i]);
    setRGB(s, i, lerp(0.19, 0.2, m) * v, lerp(0.14, 0.27, m) * v, lerp(0.09, 0.1, m) * v);
    s.h[i] = 0.2 * fine[i] + 0.2 * m;
  }
  const rand = mulberry32(504);
  const needles = Math.round(7500 * sc * sc);
  for (let k = 0; k < needles; k++) {
    const x = rand() * size;
    const y = rand() * size;
    const ang = rand() * Math.PI;
    const len = (3.5 + rand() * 6.5) * sc;
    const w = (0.5 + rand() * 0.45) * sc + 0.15;
    const pick = rand();
    const c = pick < 0.55 ? [0.47, 0.3, 0.15] : pick < 0.85 ? [0.3, 0.2, 0.11] : [0.52, 0.45, 0.35];
    const br = 0.78 + rand() * 0.4;
    const hh = 0.3 + rand() * 0.4;
    stampSegment(s, x, y, x + Math.cos(ang) * len, y + Math.sin(ang) * len, w, (i, t, d) => {
      if (hh < s.h[i]) return;
      const e = 1 - 0.3 * d;
      setRGB(s, i, c[0] * br * e, c[1] * br * e, c[2] * br * e);
      s.h[i] = hh;
    });
  }
  const leaves = Math.round(230 * sc * sc);
  for (let k = 0; k < leaves; k++) {
    const x = rand() * size;
    const y = rand() * size;
    const rx = (4 + rand() * 5) * sc;
    const ry = rx * (0.45 + rand() * 0.2);
    const pick = rand();
    const c = pick < 0.4 ? [0.56, 0.38, 0.16] : pick < 0.75 ? [0.4, 0.26, 0.13] : [0.46, 0.2, 0.12];
    const br = 0.8 + rand() * 0.35;
    const hh = 0.55 + rand() * 0.3;
    stampEllipse(s, x, y, rx, ry, rand() * Math.PI, (i, t, ix, iy, lx, ly) => {
      if (hh < s.h[i]) return;
      let f = br * (t > 0.8 ? 0.72 : 1);
      if (Math.abs(ly) < 0.09) f *= 0.74;
      setRGB(s, i, c[0] * f, c[1] * f, c[2] * f);
      s.h[i] = hh + 0.1 * (1 - t);
    });
  }
  const twigs = Math.round(45 * sc * sc);
  for (let k = 0; k < twigs; k++) {
    let x = rand() * size;
    let y = rand() * size;
    let ang = rand() * Math.PI * 2;
    const w = (0.8 + rand() * 0.8) * sc;
    const br = 0.75 + rand() * 0.45;
    for (let seg = 0; seg < 3; seg++) {
      const len = (6 + rand() * 12) * sc;
      const nx = x + Math.cos(ang) * len;
      const ny = y + Math.sin(ang) * len;
      stampSegment(s, x, y, nx, ny, w, (i, t, d) => {
        const f = br * (1 - 0.35 * d);
        setRGB(s, i, 0.25 * f, 0.18 * f, 0.11 * f);
        s.h[i] = 0.95 - 0.2 * d;
      });
      x = nx;
      y = ny;
      ang += (rand() - 0.5) * 0.8;
    }
  }
  return finishSurface(s);
}

function paintAsphalt(size) {
  const s = createSurface(size);
  const sc = size / 512;
  const big = normalizeField(noiseField(size, 4, 4, 4, 601));
  const mid = noiseField(size, 16, 16, 3, 602);
  const fine = noiseField(size, 128, 128, 2, 603);
  for (let i = 0; i < s.n; i++) {
    const tar = smoothstep(0.7, 0.86, big[i]) * 0.65;
    const v = 0.9 + 0.2 * (mid[i] - 0.5) + 0.26 * (fine[i] - 0.5) + 0.08 * (big[i] - 0.5);
    const c = lerp(0.19, 0.145, tar) * v;
    setRGB(s, i, c, c, c * 1.03);
    s.h[i] = 0.3 + 0.2 * fine[i];
    s.ro[i] = lerp(1, 0.78, tar);
  }
  const rand = mulberry32(606);
  const stones = Math.round(15000 * sc * sc);
  for (let k = 0; k < stones; k++) {
    const x = rand() * size;
    const y = rand() * size;
    const rr = (0.45 + Math.pow(rand(), 2.6) * 2.1) * sc + 0.15;
    const pick = rand();
    const l = pick < 0.8 ? 0.19 + rand() * 0.1 : pick < 0.985 ? 0.26 + rand() * 0.1 : 0.34 + rand() * 0.08;
    const tint = (rand() - 0.5) * 0.04;
    const ratio = 0.6 + rand() * 0.4;
    stampEllipse(s, x, y, rr, rr * ratio, rand() * Math.PI, (i, t, ix, iy) => {
      const shade = 0.84 + 0.4 * (domeShade(ix, iy, t) - 0.62);
      setRGB(s, i, (l + tint) * shade, l * shade, (l - tint * 0.6) * shade);
      s.h[i] = Math.max(s.h[i], 0.45 + 0.5 * Math.sqrt(1 - t * t) * Math.min(1, rr / (1.4 * sc)));
      s.ro[i] = 0.95;
    });
  }
  for (let k = 0; k < 3; k++) {
    let x = rand() * size;
    let y = rand() * size;
    let ang = rand() * Math.PI * 2;
    for (let seg = 0; seg < 14; seg++) {
      const len = (8 + rand() * 16) * sc;
      const nx = x + Math.cos(ang) * len;
      const ny = y + Math.sin(ang) * len;
      stampSegment(s, x, y, nx, ny, 2.2 * sc + 0.3, (i, t, d) => {
        const core = d < 0.35;
        const c = core ? 0.07 : 0.11;
        setRGB(s, i, c, c, c * 1.03);
        s.h[i] = core ? 0.05 : 0.25;
        s.ro[i] = 0.68;
      });
      x = nx;
      y = ny;
      ang += (rand() - 0.5) * 1.2;
    }
  }
  return finishSurface(s);
}

function paintConcrete(size) {
  const s = createSurface(size);
  const sc = size / 512;
  const big = noiseField(size, 3, 3, 4, 701);
  const mid = noiseField(size, 12, 12, 3, 702);
  const fine = noiseField(size, 128, 128, 2, 703);
  const streakN = normalizeField(noiseField(size, 24, 3, 3, 704));
  const blotch = normalizeField(noiseField(size, 5, 5, 4, 705));
  const half = size / 2;
  for (let y = 0; y < size; y++) {
    const panelY = (y % half) / half;
    const dyS = Math.min(y % half, half - (y % half));
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const dxS = Math.min(x % half, half - (x % half));
      const seam = 1 - smoothstep(0.6 * sc, 2 * sc, Math.min(dxS, dyS));
      const streak = smoothstep(0.62, 0.92, streakN[i]) * (0.4 + 0.6 * big[i]) * smoothstep(0.05, 0.4, panelY);
      const damp = smoothstep(0.68, 0.85, blotch[i]);
      const grime = smoothstep(0.8, 1, panelY) * 0.08;
      const v = 0.9 + 0.16 * (mid[i] - 0.5) + 0.12 * (big[i] - 0.5) + 0.1 * (fine[i] - 0.5);
      let r = 0.53 * v;
      let g = 0.52 * v;
      let b = 0.495 * v;
      const dk = 1 - 0.13 * streak - 0.1 * damp - grime - 0.22 * seam;
      r *= dk * (1 + 0.03 * streak);
      g *= dk;
      b *= dk * (1 - 0.04 * streak);
      setRGB(s, i, r, g, b);
      s.h[i] = 0.5 + 0.2 * (fine[i] - 0.5) + 0.1 * (mid[i] - 0.5) - 0.35 * seam;
      s.ro[i] = 1 - 0.12 * damp;
    }
  }
  const rand = mulberry32(706);
  const ties = [0.125, 0.375, 0.625, 0.875];
  for (const tu of ties) {
    for (const tv of [0.25, 0.75]) {
      const cx = tu * size;
      const cy = tv * size;
      const rr = 2.6 * sc + 0.5;
      const sl = (25 + rand() * 50) * sc;
      stampSegment(s, cx, cy, cx + (rand() - 0.5) * 3 * sc, cy + sl, 1.6 * sc + 0.5, (i, t, d) => {
        const k = 1 - 0.16 * (1 - t) * (1 - d);
        s.r[i] *= k;
        s.g[i] *= k * 0.99;
        s.b[i] *= k * 0.97;
      });
      stampEllipse(s, cx, cy, rr * 1.5, rr * 1.5, 0, (i, t) => {
        const k = t < 0.66 ? 0.32 : 1.06;
        s.r[i] *= k;
        s.g[i] *= k;
        s.b[i] *= k;
        s.h[i] = t < 0.66 ? 0.1 : s.h[i];
      });
    }
  }
  const pores = Math.round(2600 * sc * sc);
  for (let k = 0; k < pores; k++) {
    const x = Math.floor(rand() * size);
    const y = Math.floor(rand() * size);
    const i = y * size + x;
    const f = 0.62 + rand() * 0.2;
    s.r[i] *= f;
    s.g[i] *= f;
    s.b[i] *= f;
    s.h[i] -= 0.15;
  }
  for (let k = 0; k < 4; k++) {
    let x = rand() * size;
    let y = rand() * size;
    let ang = rand() * Math.PI * 2;
    for (let seg = 0; seg < 10; seg++) {
      const len = (6 + rand() * 12) * sc;
      const nx = x + Math.cos(ang) * len;
      const ny = y + Math.sin(ang) * len;
      stampSegment(s, x, y, nx, ny, 0.7 * sc + 0.2, (i, t, d) => {
        const f = 1 - 0.32 * (1 - d);
        s.r[i] *= f;
        s.g[i] *= f;
        s.b[i] *= f;
        s.h[i] -= 0.2 * (1 - d);
      });
      x = nx;
      y = ny;
      ang += (rand() - 0.5) * 1.1;
    }
  }
  return finishSurface(s);
}

function paintMetalPanel(size) {
  const s = createSurface(size);
  const sc = size / 512;
  const brushed = noiseField(size, 2, 160, 2, 801);
  const big = normalizeField(noiseField(size, 3, 3, 4, 802));
  const rough = noiseField(size, 8, 8, 3, 803);
  const half = size / 2;
  for (let y = 0; y < size; y++) {
    const dyS = Math.min(y % half, half - (y % half));
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const dxS = Math.min(x % half, half - (x % half));
      const d = Math.min(dxS, dyS);
      const seam = 1 - smoothstep(0.8 * sc, 2 * sc, d);
      const grime = (1 - smoothstep(0, 14 * sc, d)) * 0.08;
      const stain = smoothstep(0.7, 0.9, big[i]);
      const v = (0.93 + 0.1 * (brushed[i] - 0.5) + 0.06 * (big[i] - 0.5)) * (1 - 0.68 * seam - grime);
      setRGB(s, i, lerp(0.55, 0.5, stain) * v, lerp(0.57, 0.47, stain) * v, lerp(0.6, 0.42, stain) * v);
      s.h[i] = 0.6 - 0.55 * seam + 0.05 * brushed[i];
      s.ro[i] = 0.62 + 0.38 * rough[i] + 0.2 * stain;
      s.me[i] = 1 - 0.5 * stain;
    }
  }
  const spacing = 22 * sc;
  for (const line of [0, half]) {
    for (let t = spacing / 2; t < size; t += spacing) {
      for (const off of [-6 * sc, 6 * sc]) {
        const rivet = (cx, cy) => stampEllipse(s, cx, cy, 1.8 * sc + 0.3, 1.8 * sc + 0.3, 0, (i, tt, ix, iy) => {
          const sh = domeShade(ix, iy, tt) * 1.05;
          setRGB(s, i, 0.6 * sh, 0.62 * sh, 0.65 * sh);
          s.h[i] = 0.7 + 0.3 * Math.sqrt(1 - tt * tt);
        });
        rivet(line + off, t);
        rivet(t, line + off);
      }
    }
  }
  return finishSurface(s);
}

function paintBrick(size) {
  const s = createSurface(size);
  const sc = size / 512;
  const fine = noiseField(size, 96, 96, 2, 901);
  const mid = noiseField(size, 12, 12, 3, 902);
  const bricksX = 4;
  const courses = 12;
  const bw = size / bricksX;
  const ch = size / courses;
  const mortar = 2.6 * sc;
  for (let y = 0; y < size; y++) {
    const course = Math.floor(y / ch);
    const ly = y - course * ch;
    const offset = (course % 2) * bw * 0.5;
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const xx = (x + offset) % size;
      const bi = Math.floor(xx / bw);
      const lx = xx - bi * bw;
      const d = Math.min(lx, bw - lx, ly, ch - ly);
      if (d < mortar) {
        const m = 0.86 + 0.28 * fine[i];
        setRGB(s, i, 0.58 * m, 0.56 * m, 0.52 * m);
        s.h[i] = 0.12 + 0.1 * fine[i];
        continue;
      }
      const id = hash2(bi, course, 903);
      const id2 = hash2(bi, course, 904);
      let c;
      if (id < 0.12) c = [0.32, 0.19, 0.15];
      else if (id < 0.35) c = [0.42, 0.22, 0.16];
      else if (id < 0.8) c = [0.52, 0.27, 0.19];
      else c = [0.6, 0.34, 0.22];
      const pit = smoothstep(0.78, 0.9, fine[i]) * 0.25;
      const v = (0.84 + 0.3 * fine[i] + 0.16 * (mid[i] - 0.5) + 0.1 * (id2 - 0.5)) * (1 - pit);
      const edgeShade = 0.88 + 0.12 * smoothstep(mortar, mortar + 3 * sc, d);
      setRGB(s, i, c[0] * v * edgeShade, c[1] * v * edgeShade, c[2] * v * edgeShade);
      s.h[i] = 0.55 + 0.35 * smoothstep(mortar, mortar + 3 * sc, d) + 0.08 * fine[i] - 0.2 * pit;
    }
  }
  return finishSurface(s);
}

function paintCarbon(size) {
  const s = createSurface(size);
  const fine = noiseField(size, 4, 256, 1, 1001);
  const cell = size / 32;
  for (let y = 0; y < size; y++) {
    const cj = Math.floor(y / cell);
    const ly = (y - cj * cell) / cell;
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const ci = Math.floor(x / cell);
      const lx = (x - ci * cell) / cell;
      const horizontal = ((ci + cj) & 3) < 2;
      const across = horizontal ? ly : lx;
      const bulge = Math.sin(across * Math.PI);
      const fib = horizontal ? fine[i] : fine[x * size + y];
      const base = horizontal ? 1 : 0.74;
      const l = (0.05 + 0.1 * Math.pow(bulge, 0.8) + 0.03 * (fib - 0.5)) * base;
      setRGB(s, i, l, l * 1.02, l * 1.08);
      s.h[i] = 0.6 * bulge;
    }
  }
  return finishSurface(s);
}

function paintRubber(size) {
  const s = createSurface(size);
  const fine = noiseField(size, 96, 96, 2, 1101);
  const mid = noiseField(size, 12, 12, 2, 1102);
  for (let i = 0; i < s.n; i++) {
    const v = 0.85 + 0.25 * fine[i] + 0.1 * (mid[i] - 0.5);
    setRGB(s, i, 0.11 * v, 0.11 * v, 0.115 * v);
    s.h[i] = 0.3 * fine[i];
  }
  return finishSurface(s);
}

function markingCanvas(size, worldW, worldH, draw) {
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const pxm = size / worldW;
  const pym = size / worldH;
  ctx.setTransform(pxm / pym, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#ffffff';
  draw(ctx, pym);
  const data = ctx.getImageData(0, 0, size, size).data;
  const out = new Float32Array(size * size);
  for (let i = 0, j = 3; i < out.length; i++, j += 4) out[i] = data[j] / 255;
  return out;
}

function stencilText(ctx, text, x, y, h, align = 'left') {
  ctx.font = '700 ' + Math.max(4, h).toFixed(1) + 'px monospace';
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  ctx.fillText(text, x, y);
}

function containerWear(s, size, rand, fine, rustCount, rustTopMax) {
  const sc = size / 512;
  for (let k = 0; k < rustCount; k++) {
    const x = rand() * size;
    const y0 = rand() * size * rustTopMax;
    const len = (40 + rand() * 170) * sc;
    const w = (0.7 + rand() * 1.3) * sc;
    stampSegment(s, x, y0, x + (rand() - 0.5) * 2 * sc, y0 + len, w, (i, t, d) => {
      const amt = (1 - 0.75 * t) * (1 - d * d) * (0.35 + 0.65 * fine[i]);
      if (amt < 0.22) return;
      const k2 = 0.8 * smoothstep(0.22, 0.7, amt);
      s.r[i] = lerp(s.r[i], 0.42 * (0.8 + 0.4 * fine[i]), k2);
      s.g[i] = lerp(s.g[i], 0.24 * (0.8 + 0.4 * fine[i]), k2);
      s.b[i] = lerp(s.b[i], 0.12 * (0.8 + 0.4 * fine[i]), k2);
      s.a[i] = Math.min(s.a[i], 1 - k2);
      s.me[i] = Math.min(s.me[i], 1 - k2);
      s.ro[i] = 1;
    });
  }
}

function paintContainerSide(size) {
  const s = createSurface(size);
  const sc = size / 512;
  s.a = new Float32Array(s.n).fill(1);
  const W = 12.19;
  const H = 2.59;
  const pxm = size / W;
  const pym = size / H;
  const big = noiseField(size, 6, 2, 4, 1201);
  const mid = normalizeField(noiseField(size, 24, 6, 3, 1202));
  const fine = noiseField(size, 128, 64, 2, 1203);
  const spots = normalizeField(noiseField(size, 40, 10, 2, 1204));
  const post = 0.16 * pxm;
  const topRail = 0.11 * pym;
  const botRail = 0.15 * pym;
  const ribs = 44;
  const pitch = (size - 2 * post) / ribs;
  const marks = markingCanvas(size, W, H, (ctx, u) => {
    const xr = (W - 1.25) * u;
    stencilText(ctx, 'KWTU 482913 4', xr, 0.3 * u, 0.12 * u, 'right');
    stencilText(ctx, '45G1', xr, 0.47 * u, 0.09 * u, 'right');
    ctx.lineWidth = 0.05 * u;
    ctx.beginPath();
    ctx.arc(3.2 * u, 1.25 * u, 0.5 * u, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(3.2 * u, 1.45 * u, 0.32 * u, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(3.2 * u, 1.75 * u, 0.32 * u, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
    stencilText(ctx, 'KW LINES', 3.85 * u, 1.05 * u, 0.32 * u, 'left');
    ctx.fillRect(0.9 * u, 1.9 * u, 0.32 * u, 0.2 * u);
  });
  for (let y = 0; y < size; y++) {
    const yn = y / size;
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      let shade = 1;
      let h = 0.5;
      if (x < post || x > size - post) {
        shade = 0.9;
        h = 0.85;
      } else if (y < topRail) {
        shade = y > topRail - 2 * sc ? 0.7 : 0.92;
        h = 0.9;
      } else if (y > size - botRail) {
        shade = y < size - botRail + 2 * sc ? 0.78 : 0.86;
        h = 0.9;
      } else {
        const local = ((x - post) / pitch) % 1;
        if (local < 0.32) { shade = 1; h = 1; } else if (local < 0.5) { shade = 0.84; h = 1 - (local - 0.32) / 0.18; } else if (local < 0.82) { shade = 0.93; h = 0; } else { shade = 1.08; h = (local - 0.82) / 0.18; }
      }
      const paint = 0.82 * (0.93 + 0.1 * big[i] + 0.06 * (mid[i] - 0.5) + 0.04 * (fine[i] - 0.5));
      const dirt = smoothstep(0.55, 1, yn) * (0.25 + 0.6 * mid[i]);
      let r = lerp(paint, 0.4, dirt * 0.45) * shade;
      let g = lerp(paint, 0.35, dirt * 0.45) * shade;
      let b = lerp(paint, 0.28, dirt * 0.45) * shade;
      const m = marks[i] * smoothstep(0.12, 0.3, fine[i] + 0.15);
      if (m > 0.35) {
        const k = smoothstep(0.35, 0.8, m);
        r = lerp(r, 0.9 * shade, k);
        g = lerp(g, 0.9 * shade, k);
        b = lerp(b, 0.88 * shade, k);
        s.a[i] = 1 - k;
      }
      const spot = smoothstep(0.82, 0.92, spots[i]) * (smoothstep(0.7, 1, yn) + (x < post * 2 || x > size - post * 2 ? 0.6 : 0.15));
      if (spot > 0.2) {
        const k = smoothstep(0.2, 0.6, spot);
        r = lerp(r, 0.4 * shade, k);
        g = lerp(g, 0.22 * shade, k);
        b = lerp(b, 0.11 * shade, k);
        s.a[i] = Math.min(s.a[i], 1 - k);
        s.me[i] = 1 - k;
      }
      setRGB(s, i, r, g, b);
      s.h[i] = h;
      s.ro[i] = 0.85 + 0.15 * fine[i];
    }
  }
  const rand = mulberry32(1205);
  containerWear(s, size, rand, fine, Math.round(16 * sc + 4), 0.3);
  return finishSurface(s);
}

function paintContainerDoors(size) {
  const s = createSurface(size);
  const sc = size / 512;
  s.a = new Float32Array(s.n).fill(1);
  const W = 2.44;
  const H = 2.59;
  const pxm = size / W;
  const pym = size / H;
  const big = noiseField(size, 3, 3, 4, 1301);
  const mid = normalizeField(noiseField(size, 8, 8, 3, 1302));
  const fine = noiseField(size, 96, 96, 2, 1303);
  const header = 0.13 * pym;
  const sill = 0.12 * pym;
  const post = 0.11 * pxm;
  const center = size / 2;
  const bars = [0.42, 0.86, 1.58, 2.02].map((m) => m * pxm);
  const barW = 0.024 * pxm;
  const guides = [0.38, 1.3, 2.2].map((m) => m * pym);
  const hinges = [0.3, 0.95, 1.65, 2.3].map((m) => m * pym);
  const handleY = 1.28 * pym;
  const marks = markingCanvas(size, W, H, (ctx, u) => {
    stencilText(ctx, 'KWTU 482913 4', 2.25 * u, 0.24 * u, 0.09 * u, 'right');
    stencilText(ctx, '45G1', 2.25 * u, 0.36 * u, 0.07 * u, 'right');
    stencilText(ctx, 'MAX GROSS 30480 KG', 1.32 * u, 1.62 * u, 0.04 * u, 'left');
    stencilText(ctx, 'TARE 3750 KG', 1.32 * u, 1.68 * u, 0.04 * u, 'left');
    stencilText(ctx, 'NET 26730 KG', 1.32 * u, 1.74 * u, 0.04 * u, 'left');
    ctx.fillRect(0.5 * u, 1.62 * u, 0.2 * u, 0.13 * u);
  });
  const colBar = new Int8Array(size).fill(-1);
  const handleBar = new Int8Array(size).fill(-1);
  const hingeCol = new Uint8Array(size);
  for (let x = 0; x < size; x++) {
    for (let k = 0; k < bars.length; k++) {
      const bx = bars[k];
      if (Math.abs(x - bx) < barW * 2.2) colBar[x] = k;
      const dir = bx < center ? 1 : -1;
      const along = (x - bx) * dir;
      if (along > 0 && along < 0.26 * pxm) handleBar[x] = k;
    }
    if (Math.abs(x - post - 0.035 * pxm) < 0.035 * pxm || Math.abs(x - (size - post) + 0.035 * pxm) < 0.035 * pxm) hingeCol[x] = 1;
  }
  const guideH = 0.035 * pym;
  const guideCore = 0.025 * pym;
  for (let y = 0; y < size; y++) {
    const yn = y / size;
    let guideRow = -1;
    for (let g = 0; g < guides.length; g++) if (Math.abs(y - guides[g]) < guideH) guideRow = g;
    let hingeRow = -1;
    for (let g = 0; g < hinges.length; g++) if (Math.abs(y - hinges[g]) < 0.06 * pym) hingeRow = g;
    const inHandleRow = Math.abs(y - handleY) < 0.016 * pym;
    const barRow = y > header * 0.6 && y < size - sill * 0.6;
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      let shade = 1;
      let h = 0.5;
      let metal = false;
      if (x < post || x > size - post) { shade = 0.88; h = 0.85; } else if (y < header) { shade = y > header - 2 * sc ? 0.66 : 0.9; h = 0.9; } else if (y > size - sill) { shade = 0.85; h = 0.9; } else if (Math.abs(x - center) < 1.3 * sc) { shade = 0.35; h = 0.1; } else {
        const doorX = x < center ? (x - post) / (center - post) : (x - center) / (size - post - center);
        const local = (doorX * 5) % 1;
        shade = local < 0.1 ? 0.9 : local > 0.9 ? 1.06 : 1;
        h = local < 0.1 || local > 0.9 ? 0.55 : 0.65;
      }
      const cb = colBar[x];
      if (cb >= 0) {
        const bx = bars[cb];
        const dx = Math.abs(x - bx);
        if (dx < barW && barRow) {
          const t = dx / barW;
          shade = 0.7 + 0.45 * Math.sqrt(Math.max(0, 1 - t * t)) - 0.15 * (x < bx ? 0 : t);
          h = 1;
          metal = true;
        }
        if (guideRow >= 0) {
          shade = Math.abs(y - guides[guideRow]) > guideCore ? 0.7 : 0.96;
          h = 0.95;
        }
      }
      if (inHandleRow && handleBar[x] >= 0) {
        shade = Math.abs(y - handleY) < 0.008 * pym ? 1.1 : 0.78;
        h = 1;
        metal = true;
      }
      if (hingeRow >= 0 && hingeCol[x]) {
        shade = Math.abs(y - hinges[hingeRow]) > 0.045 * pym ? 0.6 : 0.85;
        h = 0.95;
      }
      const paint = 0.82 * (0.93 + 0.1 * big[i] + 0.05 * (mid[i] - 0.5) + 0.04 * (fine[i] - 0.5));
      const dirt = smoothstep(0.6, 1, yn) * (0.25 + 0.6 * mid[i]);
      let r = lerp(paint, 0.4, dirt * 0.45) * shade;
      let g = lerp(paint, 0.35, dirt * 0.45) * shade;
      let b = lerp(paint, 0.28, dirt * 0.45) * shade;
      const m = marks[i] * smoothstep(0.12, 0.3, fine[i] + 0.15);
      if (m > 0.35) {
        const k = smoothstep(0.35, 0.8, m);
        r = lerp(r, 0.9 * shade, k);
        g = lerp(g, 0.9 * shade, k);
        b = lerp(b, 0.88 * shade, k);
        s.a[i] = 1 - k;
      }
      setRGB(s, i, r, g, b);
      s.h[i] = h;
      s.ro[i] = metal ? 0.6 : 0.85 + 0.15 * fine[i];
    }
  }
  const rand = mulberry32(1304);
  for (const hy of hinges) {
    for (const hx of [post + 0.035 * pxm, size - post - 0.035 * pxm]) {
      if (rand() < 0.6) containerWearStreak(s, hx, hy + 0.06 * pym, (30 + rand() * 60) * sc, (1.5 + rand() * 1.5) * sc, fine);
    }
  }
  for (const bx of bars) for (const gy of guides) if (rand() < 0.35) containerWearStreak(s, bx, gy + 0.035 * pym, (20 + rand() * 50) * sc, 1.8 * sc, fine);
  return finishSurface(s);
}

function containerWearStreak(s, x, y0, len, w, fine) {
  stampSegment(s, x, y0, x, y0 + len, w, (i, t, d) => {
    const amt = (1 - t) * (1 - d) * (0.55 + 0.45 * fine[i]);
    if (amt < 0.15) return;
    const k = smoothstep(0.15, 0.55, amt);
    s.r[i] = lerp(s.r[i], 0.42, k);
    s.g[i] = lerp(s.g[i], 0.24, k);
    s.b[i] = lerp(s.b[i], 0.12, k);
    s.a[i] = Math.min(s.a[i], 1 - k);
    s.me[i] = Math.min(s.me[i], 1 - k);
  });
}

const LIT_TONES = {
  warm: [1.0, 0.72, 0.42],
  neutral: [1.0, 0.86, 0.64],
  cool: [0.8, 0.9, 1.0],
  tv: [0.55, 0.68, 1.0],
};

function emptyRGB(n) {
  return { r: new Float32Array(n), g: new Float32Array(n), b: new Float32Array(n) };
}

function rgbCanvas(size, c) {
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let i = 0, j = 0; i < c.r.length; i++, j += 4) {
    d[j] = c.r[i] * 255;
    d[j + 1] = c.g[i] * 255;
    d[j + 2] = c.b[i] * 255;
    d[j + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function paintOfficeFacade(size, seed, litFraction) {
  const s = createSurface(size);
  const lit = emptyRGB(s.n);
  const L = FACADE_LAYOUTS.office;
  const pxm = size / L.x;
  const pym = size / L.y;
  const floorH = L.y / L.floors;
  const bayW = L.x / L.bays;
  const glassTop = 0.38;
  const glassBot = 2.78;
  const glassH = glassBot - glassTop;
  const finW = 0.2;
  const mullW = 0.07;
  const transomY = glassTop + 0.5;
  const big = noiseField(size, 3, 3, 3, 1401);
  const fine = noiseField(size, 96, 96, 2, 1402);
  const streak = normalizeField(noiseField(size, 40, 4, 2, 1403));
  const roomCount = L.bays * L.floors;
  const roomLitA = new Uint8Array(roomCount);
  const toneA = new Float32Array(roomCount);
  const brightA = new Float32Array(roomCount);
  const personA = new Float32Array(roomCount);
  const paneIdA = new Float32Array(roomCount * 2);
  const blindsA = new Uint8Array(roomCount * 2);
  const blindsDepthA = new Float32Array(roomCount * 2);
  for (let fi = 0; fi < L.floors; fi++) {
    for (let bi = 0; bi < L.bays; bi++) {
      const r = fi * L.bays + bi;
      roomLitA[r] = hash2(bi, fi, seed * 7 + 1405) < litFraction ? 1 : 0;
      toneA[r] = hash2(bi, fi, seed * 7 + 1406);
      brightA[r] = 0.6 + 0.4 * hash2(bi, fi, seed * 7 + 1407);
      personA[r] = hash2(bi, fi, seed * 7 + 1410);
      for (let pane = 0; pane < 2; pane++) {
        const q = r * 2 + pane;
        paneIdA[q] = hash2(bi * 2 + pane, fi, 1404);
        blindsA[q] = hash2(bi * 2 + pane, fi, 1408) < 0.28 ? 1 : 0;
        blindsDepthA[q] = 0.25 + 0.6 * hash2(bi * 2 + pane, fi, 1409);
      }
    }
  }
  for (let y = 0; y < size; y++) {
    const ym = y / pym;
    const fi = Math.floor(ym / floorH);
    const yy = ym - fi * floorH;
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const xm = x / pxm;
      const bi = Math.floor(xm / bayW);
      const xx = xm - bi * bayW;
      const pane = xx < bayW / 2 ? 0 : 1;
      const room = fi * L.bays + bi;
      const q = room * 2 + pane;
      const paneId = paneIdA[q];
      const roomLit = roomLitA[room] === 1;
      const tone = toneA[room];
      const bright = brightA[room];
      const blinds = blindsA[q] === 1;
      const blindsDepth = blindsDepthA[q];
      const fin = xx < finW / 2 || xx > bayW - finW / 2;
      const mull = Math.abs(xx - bayW / 2) < mullW / 2;
      const inGlass = yy > glassTop && yy < glassBot;
      const transom = Math.abs(yy - transomY) < 0.03;
      let r;
      let g;
      let b;
      if (fin) {
        const v = 0.4 * (0.92 + 0.1 * fine[i] + 0.06 * big[i]) * (1 - 0.1 * smoothstep(0.7, 0.95, streak[i]));
        r = v;
        g = v * 1.01;
        b = v * 1.03;
        s.h[i] = 1;
        s.ro[i] = 0.5;
        s.me[i] = 0.7;
      } else if (!inGlass) {
        const joint = Math.abs(xx - bayW / 2) < 0.015 || Math.abs(yy - glassBot - 0.4) < 0.012;
        const v = (0.21 + 0.03 * big[i]) * (joint ? 0.6 : 1);
        r = v * 0.95;
        g = v * 1.05;
        b = v * 1.18;
        s.h[i] = 0.55;
        s.ro[i] = 0.35;
        s.me[i] = 0.75;
      } else if (mull || transom) {
        r = 0.27;
        g = 0.28;
        b = 0.3;
        s.h[i] = 0.75;
        s.ro[i] = 0.45;
        s.me[i] = 0.9;
      } else {
        const gy = (yy - glassTop) / glassH;
        const k = (0.85 + 0.27 * paneId) * (0.94 + 0.12 * big[i]);
        r = lerp(0.47, 0.19, Math.pow(gy, 0.8)) * k;
        g = lerp(0.55, 0.24, Math.pow(gy, 0.8)) * k;
        b = lerp(0.63, 0.3, Math.pow(gy, 0.8)) * k;
        if (blinds && gy < blindsDepth) {
          const slat = (yy * 25) % 1 < 0.18 ? 0.78 : 1;
          r = lerp(r, 0.6 * slat, 0.45);
          g = lerp(g, 0.6 * slat, 0.45);
          b = lerp(b, 0.58 * slat, 0.45);
        }
        s.h[i] = 0.3;
        s.ro[i] = 0.06;
        s.me[i] = 1;
        if (roomLit) {
          const c = tone < 0.5 ? LIT_TONES.cool : tone < 0.85 ? LIT_TONES.neutral : LIT_TONES.warm;
          let e = bright * 0.62 * (0.7 + 0.4 * (1 - gy));
          const fixtureRow = gy < 0.08 && ((xm * 0.85) % 1) < 0.6;
          if (fixtureRow) e *= 1.35;
          if (gy > 0.76) e *= 0.35;
          if (blinds && gy < blindsDepth) e *= (yy * 25) % 1 < 0.18 ? 0.25 : 0.6;
          const personSeed = personA[room];
          if (personSeed < 0.18) {
            const px = 0.35 + personSeed * 4.5;
            const pxx = Math.abs(xx - px);
            const headY = glassTop + glassH * 0.52;
            if ((pxx < 0.14 && yy > headY + 0.18) || (Math.hypot(pxx * 1.2, yy - headY) < 0.12)) e *= 0.45;
          }
          lit.r[i] = c[0] * e;
          lit.g[i] = c[1] * e;
          lit.b[i] = c[2] * e;
        }
      }
      setRGB(s, i, r, g, b);
    }
  }
  return { day: finishSurface(s), lit };
}

function paintApartmentFacade(size, seed, litFraction) {
  const s = createSurface(size);
  const lit = emptyRGB(s.n);
  const L = FACADE_LAYOUTS.apartment;
  const pxm = size / L.x;
  const pym = size / L.y;
  const floorH = L.y / L.floors;
  const bayW = L.x / L.bays;
  const winW = 1.5;
  const winTop = 0.62;
  const winBot = 2.08;
  const frame = 0.065;
  const big = noiseField(size, 3, 3, 4, 1501);
  const fine = noiseField(size, 128, 128, 2, 1502);
  const streakN = normalizeField(noiseField(size, 48, 4, 2, 1503));
  const curtainPalette = [[0.74, 0.67, 0.54], [0.55, 0.22, 0.19], [0.3, 0.38, 0.52], [0.45, 0.5, 0.38], [0.84, 0.83, 0.79]];
  const rooms = [];
  for (let fi = 0; fi < L.floors; fi++) {
    for (let bi = 0; bi < L.bays; bi++) {
      const wid = hash2(bi, fi, 1504);
      const balcony = hash2(bi, fi, 1505) < 0.3;
      rooms.push({
        balcony,
        ac: !balcony && hash2(bi, fi, 1506) < 0.22,
        acSide: hash2(bi, fi, 1507) < 0.5 ? -1 : 1,
        curtain: wid < 0.45,
        blinds: wid >= 0.45 && wid < 0.66,
        curtainColor: curtainPalette[Math.floor(hash2(bi, fi, 1508) * curtainPalette.length)],
        curtainW: 0.18 + 0.14 * hash2(bi, fi, 1509),
        blindsDepth: 0.3 + 0.5 * hash2(bi, fi, 1510),
        roomLit: hash2(bi, fi, seed * 11 + 1511) < litFraction,
        tone: hash2(bi, fi, seed * 11 + 1512),
        bright: 0.55 + 0.45 * hash2(bi, fi, seed * 11 + 1513),
        glassK: 0.9 + 0.2 * hash2(bi, fi, 1514),
      });
    }
  }
  for (let y = 0; y < size; y++) {
    const ym = y / pym;
    const fi = Math.floor(ym / floorH);
    const yy = ym - fi * floorH;
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const xm = x / pxm;
      const bi = Math.floor(xm / bayW);
      const xx = xm - bi * bayW - bayW / 2;
      const R = rooms[fi * L.bays + bi];
      const { balcony, ac, acSide, curtain, blinds, curtainColor, curtainW, blindsDepth, roomLit, tone, bright } = R;
      const wall = 0.93 + 0.08 * big[i] + 0.06 * (fine[i] - 0.5);
      let r = 0.75 * wall;
      let g = 0.69 * wall;
      let b = 0.6 * wall;
      let h = 0.55 + 0.1 * fine[i];
      let ro = 1;
      let me = 0;
      const inWinX = Math.abs(xx) < winW / 2;
      const inWinY = yy > winTop && yy < winBot;
      const underSill = Math.abs(xx) < winW / 2 + 0.1 && yy > winBot + 0.07 && yy < winBot + 1.0;
      if (underSill) {
        const st = smoothstep(0.62, 0.86, streakN[i]) * (1 - (yy - winBot) / 1.0);
        r *= 1 - 0.18 * st;
        g *= 1 - 0.18 * st;
        b *= 1 - 0.16 * st;
      }
      if (yy > floorH - 0.16) {
        r *= 0.9;
        g *= 0.9;
        b *= 0.9;
        h = 0.65;
      }
      if (Math.abs(xx) < winW / 2 + 0.1 && yy >= winBot && yy < winBot + 0.07) {
        const v = 0.8 * (0.95 + 0.08 * fine[i]);
        r = v;
        g = v;
        b = v * 0.97;
        h = 0.85;
      } else if (Math.abs(xx) < winW / 2 + 0.1 && yy >= winBot + 0.07 && yy < winBot + 0.1) {
        r *= 0.62;
        g *= 0.62;
        b *= 0.62;
      } else if (inWinX && inWinY) {
        const fx = Math.abs(xx) > winW / 2 - frame || Math.abs(xx) < 0.025 || yy < winTop + frame || yy > winBot - frame;
        if (fx) {
          r = 0.86;
          g = 0.86;
          b = 0.84;
          h = 0.45;
          ro = 0.5;
        } else {
          const gy = (yy - winTop) / (winBot - winTop);
          const k = R.glassK;
          r = lerp(0.32, 0.1, gy) * k;
          g = lerp(0.37, 0.12, gy) * k;
          b = lerp(0.42, 0.14, gy) * k;
          h = 0.2;
          ro = 0.08;
          me = 1;
          let glow = 1;
          let glowTint = null;
          const edgeDist = winW / 2 - frame - Math.abs(xx);
          if (curtain && edgeDist < curtainW) {
            const fold = 0.85 + 0.15 * Math.sin(xx * 70);
            r = lerp(r, curtainColor[0] * fold, 0.78);
            g = lerp(g, curtainColor[1] * fold, 0.78);
            b = lerp(b, curtainColor[2] * fold, 0.78);
            ro = 0.6;
            me = 0.2;
            glow = 0.55;
            glowTint = curtainColor;
          } else if (blinds && gy < blindsDepth) {
            const slat = (yy * 28) % 1 < 0.2 ? 0.7 : 1;
            r = lerp(r, 0.8 * slat, 0.7);
            g = lerp(g, 0.8 * slat, 0.7);
            b = lerp(b, 0.78 * slat, 0.7);
            glow = slat < 1 ? 0.3 : 0.65;
          }
          if (roomLit) {
            const c = tone < 0.75 ? LIT_TONES.warm : tone < 0.93 ? LIT_TONES.neutral : LIT_TONES.tv;
            const lampD = Math.hypot(xx * 0.9, (yy - winTop) * 1.2) / 1.2;
            let e = bright * glow * (0.62 + 0.5 * Math.max(0, 1 - lampD));
            let cr = c[0];
            let cg = c[1];
            let cb = c[2];
            if (glowTint) {
              cr *= 0.4 + 0.75 * glowTint[0];
              cg *= 0.4 + 0.75 * glowTint[1];
              cb *= 0.4 + 0.75 * glowTint[2];
            }
            if (gy > 0.82) e *= 0.6;
            lit.r[i] = cr * e;
            lit.g[i] = cg * e;
            lit.b[i] = cb * e;
          }
        }
      }
      if (ac && Math.abs(xx - acSide * 0.42) < 0.38 && yy > winBot + 0.18 && yy < winBot + 0.66) {
        const grille = ((yy - winBot) * 30) % 1 < 0.3;
        const v = grille ? 0.55 : 0.78;
        r = v;
        g = v;
        b = v * 0.98;
        h = 1;
        ro = 0.6;
        me = 0;
      }
      if (balcony) {
        if (yy > floorH - 0.2) {
          const v = 0.7 * (0.95 + 0.1 * fine[i]);
          r = v;
          g = v * 0.99;
          b = v * 0.95;
          h = 1;
          ro = 1;
          me = 0;
        } else if (yy < 0.14 && fi > 0) {
          r *= 0.55;
          g *= 0.55;
          b *= 0.55;
        } else if (yy > floorH - 1.2 && Math.abs(xx) < bayW / 2 - 0.12) {
          const bar = ((xx + 4) * 8.3) % 1 < 0.22;
          const topRail = yy < floorH - 1.15;
          if (bar || topRail) {
            r = 0.14;
            g = 0.14;
            b = 0.15;
            h = 0.95;
            ro = 0.5;
            me = 1;
            if (lit.r[i] > 0) {
              lit.r[i] = 0;
              lit.g[i] = 0;
              lit.b[i] = 0;
            }
          }
        }
      }
      setRGB(s, i, r, g, b);
      s.h[i] = h;
      s.ro[i] = ro;
      s.me[i] = me;
    }
  }
  return { day: finishSurface(s), lit };
}

function facadeResult(kind, size, seed, litFraction) {
  const key = 'facade:' + kind + '@' + size + '@' + seed + '@' + litFraction;
  if (resultCache.has(key)) return resultCache.get(key);
  const t0 = nowMs();
  const raw = kind === 'apartment' ? paintApartmentFacade(size, seed, litFraction) : paintOfficeFacade(size, seed, litFraction);
  const out = { day: raw.day, litCanvas: rgbCanvas(size, raw.lit), lit: raw.lit };
  recordStat('facade-' + kind + (seed !== 1 || litFraction !== 0.45 ? '#' + seed + '/' + litFraction : ''), nowMs() - t0);
  resultCache.set(key, out);
  return out;
}

function paintFacadeNight(size) {
  const f = facadeResult('office', size, 3, 0.55);
  const s = createSurface(size);
  const day = f.day.canvas.getContext('2d').getImageData(0, 0, size, size).data;
  for (let i = 0, j = 0; i < s.n; i++, j += 4) {
    setRGB(s, i, day[j] / 255 * 0.07 + f.lit.r[i], day[j + 1] / 255 * 0.07 + f.lit.g[i], day[j + 2] / 255 * 0.08 + f.lit.b[i]);
  }
  s.h = f.day.height;
  return finishSurface(s);
}

function flakeSurface(size) {
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const rand = mulberry32(1601);
  const cell = 2;
  for (let y = 0; y < size; y += cell) {
    for (let x = 0; x < size; x += cell) {
      const th = rand() * Math.PI * 2;
      const tilt = Math.pow(rand(), 1.6) * 0.55;
      const nx = Math.cos(th) * Math.sin(tilt);
      const ny = Math.sin(th) * Math.sin(tilt);
      const nz = Math.cos(tilt);
      for (let yy = 0; yy < cell; yy++) {
        for (let xx = 0; xx < cell; xx++) {
          const j = ((y + yy) * size + x + xx) * 4;
          d[j] = (nx * 0.5 + 0.5) * 255;
          d[j + 1] = (ny * 0.5 + 0.5) * 255;
          d[j + 2] = (nz * 0.5 + 0.5) * 255;
          d[j + 3] = 255;
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return { canvas, height: null, normalCanvas: canvas };
}

const proceduralPainters = {
  grass: paintGrass,
  dirt: paintDirt,
  rock: paintRock,
  sand: paintSand,
  'forest-floor': paintForestFloor,
  asphalt: paintAsphalt,
  concrete: paintConcrete,
  'metal-panel': paintMetalPanel,
  brick: paintBrick,
  carbon: paintCarbon,
  rubber: paintRubber,
  container: paintContainerSide,
  'container-doors': paintContainerDoors,
  'facade-office': (size) => facadeResult('office', size, 1, 0.45).day,
  'facade-apartment': (size) => facadeResult('apartment', size, 1, 0.45).day,
  'facade-office-lit': (size) => ({ canvas: facadeResult('office', size, 1, 0.45).litCanvas, height: null }),
  'facade-apartment-lit': (size) => ({ canvas: facadeResult('apartment', size, 1, 0.45).litCanvas, height: null }),
  'facade-night': paintFacadeNight,
  'paint-flake': flakeSurface,
  'ph-panel': paintMetalPanel,
  'ph-floor': paintConcrete,
};

function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function recordStat(name, ms) {
  proceduralStats.perTexture[name] = Math.round((proceduralStats.perTexture[name] || 0) + ms);
  proceduralStats.genMs = Math.round(proceduralStats.genMs + ms);
}

function proceduralResult(name, size = 512) {
  const key = name + '@' + size;
  if (resultCache.has(key)) return resultCache.get(key);
  const painter = proceduralPainters[name] || proceduralPainters.concrete;
  const t0 = nowMs();
  const result = painter(size);
  if (!name.startsWith('facade-office') && !name.startsWith('facade-apartment')) recordStat(name, nowMs() - t0);
  resultCache.set(key, result);
  return result;
}

export function proceduralTexture(name, size = 512) {
  return proceduralResult(name, size).canvas;
}

export function proceduralTextureNames() {
  return Object.keys(proceduralPainters);
}

export function proceduralTextureStats() {
  return { genMs: proceduralStats.genMs, perTexture: { ...proceduralStats.perTexture } };
}

export function registerProceduralTexture(name, painter) {
  proceduralPainters[name] = (size) => {
    const out = painter(size);
    return out && out.canvas ? out : { canvas: out, height: null };
  };
}

export function containerTextureMeters() {
  return { side: { x: 12.19, y: 2.59 }, doors: { x: 2.44, y: 2.59 } };
}

export function facadeTileMeters(kind = 'office') {
  const L = FACADE_LAYOUTS[kind === 'apartment' ? 'apartment' : 'office'];
  return { x: L.x, y: L.y };
}

function placeholderImage(color) {
  const c = makeCanvas(4);
  const ctx = c.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 4, 4);
  return c;
}

function applyRepeat(texture, repeat) {
  if (repeat == null) return;
  if (Array.isArray(repeat)) texture.repeat.set(repeat[0], repeat[1]);
  else texture.repeat.set(repeat, repeat);
}

function baseTexture(name, image, srgb, opts) {
  const texture = new THREE.Texture(image);
  texture.name = name;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.anisotropy = opts.anisotropy ?? 8;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  applyRepeat(texture, opts.repeat);
  texture.needsUpdate = true;
  return texture;
}

function swapTextureImage(texture, image) {
  texture.dispose();
  texture.image = image;
  texture.needsUpdate = true;
}

function track(ready) {
  pendingLoads.add(ready);
  ready.finally(() => pendingLoads.delete(ready));
  return ready;
}

function fileOrNull(folder, name) {
  if (folder === 'textures' && PROCEDURAL_ONLY.has(name)) return Promise.resolve(null);
  return loadGameImage(folder, name);
}

export function loadTexture(name, opts = {}) {
  const srgb = opts.srgb !== false;
  const folder = opts.folder || 'textures';
  const size = opts.size || 512;
  const procedural = opts.procedural || name;
  const key = ['map', folder, name, srgb ? 's' : 'l', size, procedural, JSON.stringify(opts.repeat ?? null)].join('|');
  if (textureCache.has(key)) return textureCache.get(key);
  const texture = baseTexture(name, placeholderImage('#808080'), srgb, opts);
  texture.userData.source = 'pending';
  texture.userData.ready = track(fileOrNull(folder, name).then((img) => {
    if (img) {
      swapTextureImage(texture, img);
      texture.userData.source = 'file';
    } else {
      swapTextureImage(texture, proceduralTexture(procedural, size));
      texture.userData.source = 'procedural';
    }
    return texture;
  }));
  textureCache.set(key, texture);
  return texture;
}

export function texturesReady() {
  return Promise.all([...pendingLoads]).then(() => undefined);
}

function heightFromImage(img, maxSize = 1024) {
  const w = Math.min(maxSize, img.naturalWidth || img.width);
  const h = Math.min(maxSize, img.naturalHeight || img.height);
  const size = Math.min(w, h);
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, size, size);
  const d = ctx.getImageData(0, 0, size, size).data;
  const out = new Float32Array(size * size);
  for (let i = 0, j = 0; i < out.length; i++, j += 4) out[i] = (0.2126 * d[j] + 0.7152 * d[j + 1] + 0.0722 * d[j + 2]) / 255;
  return { height: out, size };
}

function heightFromCanvas(canvas) {
  const size = canvas.width;
  const d = canvas.getContext('2d').getImageData(0, 0, size, size).data;
  const out = new Float32Array(size * size);
  for (let i = 0, j = 0; i < out.length; i++, j += 4) out[i] = (0.2126 * d[j] + 0.7152 * d[j + 1] + 0.0722 * d[j + 2]) / 255;
  return out;
}

function normalCanvasFromHeight(h, size, strength) {
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const k = strength * size / 256;
  for (let y = 0; y < size; y++) {
    const ym = ((y - 1 + size) % size) * size;
    const yp = ((y + 1) % size) * size;
    const row = y * size;
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size;
      const xp = (x + 1) % size;
      const dx = (h[row + xp] - h[row + xm]) * 0.5 * k;
      const dy = (h[ym + x] - h[yp + x]) * 0.5 * k;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const j = (row + x) * 4;
      d[j] = (-dx * inv * 0.5 + 0.5) * 255;
      d[j + 1] = (-dy * inv * 0.5 + 0.5) * 255;
      d[j + 2] = (inv * 0.5 + 0.5) * 255;
      d[j + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function ormCanvas(result) {
  const size = result.size;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let i = 0, j = 0; i < size * size; i++, j += 4) {
    d[j] = 255;
    d[j + 1] = clamp(result.rough[i], 0, 1) * 255;
    d[j + 2] = clamp(result.metal[i], 0, 1) * 255;
    d[j + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export function loadNormalMap(name, opts = {}) {
  const folder = opts.folder || 'textures';
  const strength = opts.strength ?? 2;
  const size = opts.size || 512;
  const procedural = opts.procedural || name;
  const key = ['normal', folder, name, strength, size, procedural, JSON.stringify(opts.repeat ?? null)].join('|');
  if (textureCache.has(key)) return textureCache.get(key);
  const texture = baseTexture(name + '-normal', placeholderImage('#8080ff'), false, opts);
  texture.userData.source = 'pending';
  texture.userData.ready = track(fileOrNull(folder, name).then((img) => {
    const t0 = nowMs();
    if (img) {
      const hf = heightFromImage(img);
      swapTextureImage(texture, normalCanvasFromHeight(hf.height, hf.size, strength * 0.6));
      texture.userData.source = 'file';
    } else {
      const result = proceduralResult(procedural, size);
      if (result.normalCanvas) swapTextureImage(texture, result.normalCanvas);
      else swapTextureImage(texture, normalCanvasFromHeight(result.height || heightFromCanvas(result.canvas), result.canvas.width, strength));
      texture.userData.source = 'procedural';
    }
    recordStat('normal:' + name, nowMs() - t0);
    return texture;
  }));
  textureCache.set(key, texture);
  return texture;
}

export function loadRoughnessMap(name, opts = {}) {
  const folder = opts.folder || 'textures';
  const size = opts.size || 512;
  const procedural = opts.procedural || name;
  const key = ['orm', folder, name, size, procedural, JSON.stringify(opts.repeat ?? null)].join('|');
  if (textureCache.has(key)) return textureCache.get(key);
  const texture = baseTexture(name + '-orm', placeholderImage('#ffffff'), false, opts);
  texture.userData.source = 'pending';
  texture.userData.ready = track(fileOrNull(folder, name).then((img) => {
    if (img) {
      swapTextureImage(texture, placeholderImage('#ffffff'));
      texture.userData.source = 'file';
    } else {
      const result = proceduralResult(procedural, size);
      swapTextureImage(texture, result.rough ? ormCanvas(result) : placeholderImage('#ffffff'));
      texture.userData.source = 'procedural';
    }
    return texture;
  }));
  textureCache.set(key, texture);
  return texture;
}

function canvasTexture(name, canvas, srgb, opts = {}) {
  const key = ['canvas', name, srgb ? 's' : 'l', JSON.stringify(opts.repeat ?? null)].join('|');
  if (textureCache.has(key)) return textureCache.get(key);
  const texture = baseTexture(name, canvas, srgb, opts);
  texture.userData.source = 'procedural';
  texture.userData.ready = Promise.resolve(texture);
  textureCache.set(key, texture);
  return texture;
}

export const NO_TILE_GLSL = `
float kwHash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float kwValueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = kwHash12(i);
  float b = kwHash12(i + vec2(1.0, 0.0));
  float c = kwHash12(i + vec2(0.0, 1.0));
  float d = kwHash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
vec4 textureNoTile(sampler2D samp, vec2 uv) {
  float k = kwValueNoise(uv * 1.05 + 0.31);
  vec2 dx = dFdx(uv);
  vec2 dy = dFdy(uv);
  float l = k * 8.0;
  float f = fract(l);
  float ia = floor(l);
  float ib = ia + 1.0;
  vec2 offa = sin(vec2(3.0, 7.0) * ia);
  vec2 offb = sin(vec2(3.0, 7.0) * ib);
  vec4 cola = textureGrad(samp, uv + offa, dx, dy);
  vec4 colb = textureGrad(samp, uv + offb, dx, dy);
  float diff = dot(cola.rgb - colb.rgb, vec3(1.0));
  return mix(cola, colb, smoothstep(0.2, 0.8, f - 0.1 * diff));
}
`;

function chainCompile(material, key, patch) {
  const previous = material.onBeforeCompile;
  const hadPrevious = previous && previous !== THREE.Material.prototype.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (hadPrevious) previous.call(material, shader, renderer);
    patch(shader);
  };
  const ownKey = material.customProgramCacheKey !== THREE.Material.prototype.customProgramCacheKey ? material.customProgramCacheKey.bind(material) : null;
  const previousSource = hadPrevious ? String(previous) : '';
  material.customProgramCacheKey = () => (ownKey ? ownKey() : previousSource) + '|' + key;
  material.needsUpdate = true;
  return material;
}

export function stochasticTiling(material) {
  if (material.userData.kwNoTile) return material;
  material.userData.kwNoTile = true;
  return chainCompile(material, 'kwNoTile', (shader) => {
    let fs = shader.fragmentShader;
    for (const chunk of ['map_fragment', 'roughnessmap_fragment', 'metalnessmap_fragment', 'normal_fragment_maps']) fs = fs.replace('#include <' + chunk + '>', THREE.ShaderChunk[chunk]);
    shader.fragmentShader = fs
      .replace('#include <common>', '#include <common>\n' + NO_TILE_GLSL)
      .replace('vec4 sampledDiffuseColor = texture2D( map, vMapUv );', 'vec4 sampledDiffuseColor = textureNoTile( map, vMapUv );')
      .replace('vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );', 'vec4 texelRoughness = textureNoTile( roughnessMap, vRoughnessMapUv );')
      .replace('vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );', 'vec4 texelMetalness = textureNoTile( metalnessMap, vMetalnessMapUv );')
      .replace('vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;', 'vec3 mapN = textureNoTile( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;');
  });
}

export function paintMaskTint(material) {
  if (material.userData.kwPaintMask) return material;
  material.userData.kwPaintMask = true;
  return chainCompile(material, 'kwPaintMask', (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( 1.0, 1.0, 1.0, opacity );\n\tfloat kwPaintMask = 1.0;')
      .replace('#include <map_fragment>', '#ifdef USE_MAP\n\tvec4 kwMapTexel = texture2D( map, vMapUv );\n\tdiffuseColor.rgb *= kwMapTexel.rgb;\n\tkwPaintMask = smoothstep( 0.6, 0.95, kwMapTexel.a );\n#endif\n\tdiffuseColor.rgb *= mix( vec3( 1.0 ), diffuse, kwPaintMask );')
      .replace('#include <color_fragment>', '#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )\n\tdiffuseColor.rgb *= mix( vec3( 1.0 ), vColor.rgb, kwPaintMask );\n#endif');
  });
}

const materialSpecs = {
  asphalt: { tex: 'asphalt', normal: 1.8, orm: true, roughness: 0.95, metalness: 0, noTile: true },
  concrete: { tex: 'concrete', normal: 1.2, orm: true, roughness: 0.92, metalness: 0 },
  grass: { tex: 'grass', normal: 0.9, roughness: 0.98, metalness: 0, noTile: true },
  dirt: { tex: 'dirt', normal: 1.8, roughness: 0.97, metalness: 0, noTile: true },
  rock: { tex: 'rock', normal: 2.4, orm: true, roughness: 0.92, metalness: 0, noTile: true },
  sand: { tex: 'sand', normal: 1.2, roughness: 0.98, metalness: 0, noTile: true },
  'forest-floor': { tex: 'forest-floor', normal: 1.5, roughness: 0.98, metalness: 0, noTile: true },
  brick: { tex: 'brick', normal: 2.2, roughness: 0.92, metalness: 0 },
  'metal-panel': { tex: 'metal-panel', normal: 1.6, orm: true, roughness: 0.62, metalness: 0.8 },
  container: { tex: 'container', normal: 2.6, orm: true, roughness: 0.72, metalness: 0.25, paintMask: true },
  'container-doors': { tex: 'container-doors', normal: 2.4, orm: true, roughness: 0.72, metalness: 0.25, paintMask: true },
  metal: { color: 0xa9afb6, roughness: 0.34, metalness: 0.92 },
  carbon: { tex: 'carbon', normal: 1.0, physical: true, roughness: 0.42, metalness: 0.25, clearcoat: 1, clearcoatRoughness: 0.04, repeat: 6 },
  rubber: { tex: 'rubber', normal: 0.6, roughness: 0.93, metalness: 0 },
  glass: { physical: true, color: 0x0b1116, roughness: 0.03, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.02 },
  chrome: { color: 0xf3f5f8, roughness: 0.05, metalness: 1 },
};

export function gameMaterialNames() {
  return Object.keys(materialSpecs);
}

export function gameMaterial(name, opts = {}) {
  const key = name + JSON.stringify(opts);
  if (!opts.unique && materialCache.has(key)) return materialCache.get(key);
  const spec = materialSpecs[name] || materialSpecs.concrete;
  const repeat = opts.repeat ?? spec.repeat;
  const params = {
    color: opts.color ?? spec.color ?? 0xffffff,
    roughness: opts.roughness ?? spec.roughness,
    metalness: opts.metalness ?? spec.metalness,
  };
  if (spec.tex) {
    params.map = loadTexture(spec.tex, { repeat, size: opts.size });
    if (spec.normal) {
      params.normalMap = loadNormalMap(spec.tex, { repeat, strength: spec.normal, size: opts.size });
      params.normalScale = new THREE.Vector2(opts.normalScale ?? 1, opts.normalScale ?? 1);
    }
    if (spec.orm) {
      const orm = loadRoughnessMap(spec.tex, { repeat, size: opts.size });
      params.roughnessMap = orm;
      params.metalnessMap = orm;
    }
  }
  let material;
  if (spec.physical) {
    material = new THREE.MeshPhysicalMaterial({
      ...params,
      clearcoat: spec.clearcoat || 0,
      clearcoatRoughness: spec.clearcoatRoughness ?? 0.05,
      transparent: !!opts.transparent,
      opacity: opts.transparent ? opts.opacity ?? 0.55 : 1,
    });
  } else {
    material = new THREE.MeshStandardMaterial(params);
  }
  if (opts.envMapIntensity != null) material.envMapIntensity = opts.envMapIntensity;
  if (spec.paintMask) paintMaskTint(material);
  if (opts.stochastic === true || (spec.noTile && opts.stochastic !== false)) stochasticTiling(material);
  material.name = 'kw-' + name;
  if (!opts.unique) materialCache.set(key, material);
  return material;
}

export function paintMaterial(opts = {}) {
  const metallic = opts.metallic !== false;
  const flake = opts.flake ?? 0.5;
  const material = new THREE.MeshPhysicalMaterial({
    color: opts.color ?? 0xc81e2a,
    metalness: metallic ? 0.62 : 0.02,
    roughness: opts.roughness ?? (metallic ? 0.36 : 0.42),
    clearcoat: opts.clearcoat ?? 1,
    clearcoatRoughness: opts.clearcoatRoughness ?? 0.04,
  });
  if (metallic && flake > 0) {
    material.normalMap = canvasTexture('paint-flake', proceduralTexture('paint-flake', 256), false, { repeat: opts.flakeRepeat ?? 28 });
    material.normalScale = new THREE.Vector2(flake * 0.5, flake * 0.5);
  }
  material.name = 'kw-paint';
  return material;
}

function litTexture(kind, seed, litFraction) {
  const f = facadeResult(kind, 512, seed, litFraction);
  return canvasTexture('facade-' + kind + '-lit#' + seed + '/' + litFraction, f.litCanvas, true);
}

export function facadeMaterial(kind = 'office', opts = {}) {
  const k = kind === 'apartment' ? 'apartment' : 'office';
  const name = 'facade-' + k;
  const night = !!opts.night;
  const seed = opts.seed ?? 1;
  const litFraction = opts.litFraction ?? 0.45;
  const map = loadTexture(name);
  const orm = loadRoughnessMap(name);
  const normalMap = loadNormalMap(name, { strength: 1.4 });
  const material = new THREE.MeshStandardMaterial({
    map,
    normalMap,
    roughnessMap: orm,
    metalnessMap: orm,
    roughness: 0.92,
    metalness: k === 'office' ? 0.62 : 0.5,
    envMapIntensity: opts.envMapIntensity ?? 1.15,
  });
  material.name = 'kw-' + name + (night ? '-night' : '');
  material.userData.tileMeters = facadeTileMeters(k);
  const roomUniforms = { kwLitFraction: { value: litFraction }, kwRooms: { value: new THREE.Vector2(FACADE_LAYOUTS[k].bays, FACADE_LAYOUTS[k].floors) }, kwRoomSeed: { value: seed * 0.731 } };
  material.userData.facadeUniforms = roomUniforms;
  if (night) {
    material.emissive = new THREE.Color(1, 1, 1);
    material.emissiveIntensity = opts.emissiveIntensity ?? (k === 'office' ? 2.4 : 2.8);
    material.emissiveMap = litTexture(k, seed, 1);
    chainCompile(material, 'kwFacadeRooms', (shader) => {
      shader.uniforms.kwLitFraction = roomUniforms.kwLitFraction;
      shader.uniforms.kwRooms = roomUniforms.kwRooms;
      shader.uniforms.kwRoomSeed = roomUniforms.kwRoomSeed;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vKwSeed;\nuniform float kwRoomSeed;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n#ifdef USE_INSTANCING\n\tvKwSeed = kwRoomSeed + instanceMatrix[3].x * 0.137 + instanceMatrix[3].z * 0.311;\n#else\n\tvKwSeed = kwRoomSeed + modelMatrix[3].x * 0.137 + modelMatrix[3].z * 0.311;\n#endif');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vKwSeed;\nuniform float kwLitFraction;\nuniform vec2 kwRooms;\nfloat kwRoomHash(vec2 p) {\n\tvec3 p3 = fract(vec3(p.xyx) * 0.1031);\n\tp3 += dot(p3, p3.yzx + 33.33);\n\treturn fract((p3.x + p3.y) * p3.z);\n}')
        .replace('#include <emissivemap_fragment>', '#ifdef USE_EMISSIVEMAP\n\tvec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );\n\tvec2 kwRoom = floor( vEmissiveMapUv * kwRooms );\n\tfloat kwOn = step( kwRoomHash( kwRoom + vec2( vKwSeed, vKwSeed * 1.73 ) ), kwLitFraction );\n\ttotalEmissiveRadiance *= emissiveColor.rgb * kwOn;\n#endif');
    });
  }
  map.userData.ready.then((t) => {
    if (t.userData.source !== 'file') return;
    material.roughnessMap = null;
    material.metalnessMap = null;
    material.roughness = 0.62;
    material.metalness = 0.15;
    material.needsUpdate = true;
    if (!night) return;
    const nightMap = loadTexture('facade-night');
    nightMap.userData.ready.then((nt) => {
      if (nt.userData.source === 'file') {
        material.map = nt;
        material.emissiveMap = nt;
        material.normalMap = null;
        roomUniforms.kwLitFraction.value = 1;
      } else {
        material.map = canvasTexture(name + '-procedural', proceduralTexture(name), true);
        material.normalMap = canvasTexture(name + '-procedural-normal', normalCanvasFromHeight(proceduralResult(name).height, 512, 1.4), false);
        material.roughnessMap = canvasTexture(name + '-procedural-orm', ormCanvas(proceduralResult(name)), false);
        material.metalnessMap = material.roughnessMap;
        material.roughness = 0.92;
        material.metalness = k === 'office' ? 0.62 : 0.5;
      }
      material.needsUpdate = true;
    });
  });
  return material;
}

export function disposeGameMaterials() {
  for (const m of materialCache.values()) m.dispose();
  materialCache.clear();
  for (const t of textureCache.values()) t.dispose();
  textureCache.clear();
  resultCache.clear();
}
