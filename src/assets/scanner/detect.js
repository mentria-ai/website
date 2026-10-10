import { orderQuad, validQuad, quadArea } from './geometry.js';

export const DETECT_SIZE = 384;
const G5 = [0.1102, 0.2369, 0.3058, 0.2369, 0.1102];
const MIN_SUPPORT = 0.45;

function channels(rgba, w, h) {
  const n = w * h, Y = new Float32Array(n), C = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const r = rgba[j], g = rgba[j + 1], b = rgba[j + 2];
    Y[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    const mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
    const mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
    C[i] = mx - mn;
  }
  return { Y, C };
}

function blur(src, w, h) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -2; k <= 2; k++) {
        let xx = x + k;
        if (xx < 0) xx = 0; else if (xx >= w) xx = w - 1;
        s += src[row + xx] * G5[k + 2];
      }
      tmp[row + x] = s;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -2; k <= 2; k++) {
        let yy = y + k;
        if (yy < 0) yy = 0; else if (yy >= h) yy = h - 1;
        s += tmp[yy * w + x] * G5[k + 2];
      }
      out[y * w + x] = s;
    }
  }
  return out;
}

function gradients(Y, C, w, h, k) {
  const n = w * h, mag = new Float32Array(n), dir = new Uint8Array(n);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const ax = (Y[i - w + 1] + 2 * Y[i + 1] + Y[i + w + 1] - Y[i - w - 1] - 2 * Y[i - 1] - Y[i + w - 1]) / 4;
      const ay = (Y[i + w - 1] + 2 * Y[i + w] + Y[i + w + 1] - Y[i - w - 1] - 2 * Y[i - w] - Y[i - w + 1]) / 4;
      const bx = k * (C[i - w + 1] + 2 * C[i + 1] + C[i + w + 1] - C[i - w - 1] - 2 * C[i - 1] - C[i + w - 1]) / 4;
      const by = k * (C[i + w - 1] + 2 * C[i + w] + C[i + w + 1] - C[i - w - 1] - 2 * C[i - w] - C[i - w + 1]) / 4;
      const m1 = Math.hypot(ax, ay), m2 = Math.hypot(bx, by);
      const gx = m1 >= m2 ? ax : bx, gy = m1 >= m2 ? ay : by;
      mag[i] = m1 >= m2 ? m1 : m2;
      let a = Math.atan2(gy, gx) * 180 / Math.PI;
      if (a < 0) a += 180;
      dir[i] = a < 22.5 || a >= 157.5 ? 0 : a < 67.5 ? 1 : a < 112.5 ? 2 : 3;
    }
  }
  return { mag, dir };
}

function thin(mag, dir, w, h) {
  const out = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x, m = mag[i];
      if (!m) continue;
      let a, b;
      if (dir[i] === 0) { a = mag[i - 1]; b = mag[i + 1]; }
      else if (dir[i] === 1) { a = mag[i - w - 1]; b = mag[i + w + 1]; }
      else if (dir[i] === 2) { a = mag[i - w]; b = mag[i + w]; }
      else { a = mag[i - w + 1]; b = mag[i + w - 1]; }
      if (m >= a && m >= b) out[i] = m;
    }
  }
  return out;
}

function percentile(values, p) {
  let max = 0;
  for (let i = 0; i < values.length; i++) if (values[i] > max) max = values[i];
  if (!max) return 0;
  const bins = new Uint32Array(1024);
  let count = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v > 0) { bins[Math.min(1023, Math.floor(v / max * 1023))]++; count++; }
  }
  const target = count * p;
  let acc = 0;
  for (let b = 0; b < 1024; b++) {
    acc += bins[b];
    if (acc >= target) return (b + 0.5) / 1023 * max;
  }
  return max;
}

function hysteresis(t, w, h, low, high) {
  const out = new Uint8Array(w * h), stack = [];
  for (let i = 0; i < t.length; i++) {
    if (t[i] < high || out[i]) continue;
    out[i] = 1;
    stack.push(i);
    while (stack.length) {
      const j = stack.pop(), x = j % w, y = (j - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const k = yy * w + xx;
          if (!out[k] && t[k] >= low) { out[k] = 1; stack.push(k); }
        }
      }
    }
  }
  return out;
}

function dilate(e, w, h) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!e[y * w + x]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < w) out[yy * w + xx] = 1;
        }
      }
    }
  }
  return out;
}

function bigComponents(e, w, h, minBox) {
  const label = new Int32Array(w * h), boxes = [null], stack = [];
  let next = 0;
  for (let i = 0; i < e.length; i++) {
    if (!e[i] || label[i]) continue;
    next++;
    label[i] = next;
    stack.push(i);
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    while (stack.length) {
      const j = stack.pop(), x = j % w, y = (j - x) / w;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const k = yy * w + xx;
          if (e[k] && !label[k]) { label[k] = next; stack.push(k); }
        }
      }
    }
    boxes.push([x0, y0, x1, y1]);
  }
  const keep = new Map();
  for (let l = 1; l <= next; l++) {
    const b = boxes[l];
    if ((b[2] - b[0] + 1) * (b[3] - b[1] + 1) >= minBox) keep.set(l, { minX: new Int32Array(h).fill(-1), maxX: new Int32Array(h).fill(-1) });
  }
  if (!keep.size) return [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = keep.get(label[y * w + x]);
      if (!k) continue;
      if (k.minX[y] < 0 || x < k.minX[y]) k.minX[y] = x;
      if (x > k.maxX[y]) k.maxX[y] = x;
    }
  }
  return [...keep.values()].map((k) => {
    const pts = [];
    for (let y = 0; y < h; y++) {
      if (k.minX[y] < 0) continue;
      pts.push([k.minX[y], y]);
      if (k.maxX[y] !== k.minX[y]) pts.push([k.maxX[y], y]);
    }
    return pts;
  });
}

function hull(points) {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

function perimeter(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    s += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return s;
}

function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = dx * dx + dy * dy;
  let t = len ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

function dp(points, eps) {
  if (points.length < 3) return points.slice();
  const a = points[0], b = points[points.length - 1];
  let d = 0, idx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const dist = segDist(points[i], a, b);
    if (dist > d) { d = dist; idx = i; }
  }
  if (d > eps) {
    const l = dp(points.slice(0, idx + 1), eps), r = dp(points.slice(idx), eps);
    return l.slice(0, -1).concat(r);
  }
  return [a, b];
}

function approxClosed(poly, eps) {
  let i0 = 0, i1 = 0, best = -1;
  for (let i = 0; i < poly.length; i++) {
    for (let j = i + 1; j < poly.length; j++) {
      const d = (poly[i][0] - poly[j][0]) ** 2 + (poly[i][1] - poly[j][1]) ** 2;
      if (d > best) { best = d; i0 = i; i1 = j; }
    }
  }
  const first = poly.slice(i0, i1 + 1), second = poly.slice(i1).concat(poly.slice(0, i0 + 1));
  return dp(first, eps).slice(0, -1).concat(dp(second, eps).slice(0, -1));
}

function maxAreaQuad(pts) {
  let best = null, area = -1;
  const n = pts.length;
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      for (let c = b + 1; c < n; c++) {
        for (let d = c + 1; d < n; d++) {
          const q = [pts[a], pts[b], pts[c], pts[d]];
          const s = quadArea(q);
          if (s > area) { area = s; best = q; }
        }
      }
    }
  }
  return best;
}

function hullQuad(hp) {
  const per = perimeter(hp);
  let spare = null;
  for (let f = 0.01; f <= 0.0601; f += 0.005) {
    const ap = approxClosed(hp, f * per);
    if (ap.length === 4) return ap;
    if (ap.length < 4) return spare ? maxAreaQuad(spare) : null;
    if (ap.length <= 6) spare = ap;
  }
  return spare ? maxAreaQuad(spare) : null;
}

function support(q, mag, w, h, low) {
  let hit = 0, total = 0;
  for (let s = 0; s < 4; s++) {
    const a = q[s], b = q[(s + 1) % 4];
    for (let k = 0; k < 30; k++) {
      const t = (k + 0.5) / 30;
      const x = Math.round(a[0] + (b[0] - a[0]) * t), y = Math.round(a[1] + (b[1] - a[1]) * t);
      total++;
      let m = 0;
      for (let dy = -2; dy <= 2; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const v = mag[yy * w + xx];
          if (v > m) m = v;
        }
      }
      if (m >= low) hit++;
    }
  }
  return hit / total;
}

function houghQuads(edges, w, h) {
  const diag = Math.ceil(Math.hypot(w, h)), nr = 2 * diag + 1, nt = 180;
  const cos = new Float32Array(nt), sin = new Float32Array(nt);
  for (let t = 0; t < nt; t++) { cos[t] = Math.cos(t * Math.PI / 180); sin[t] = Math.sin(t * Math.PI / 180); }
  const acc = new Uint32Array(nt * nr);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!edges[y * w + x]) continue;
      for (let t = 0; t < nt; t++) acc[t * nr + Math.round(x * cos[t] + y * sin[t]) + diag]++;
    }
  }
  const minVotes = Math.round(0.25 * Math.min(w, h));
  const used = new Uint8Array(acc.length), lines = [];
  for (let n = 0; n < 12; n++) {
    let best = 0, bi = -1;
    for (let i = 0; i < acc.length; i++) if (!used[i] && acc[i] > best) { best = acc[i]; bi = i; }
    if (bi < 0 || best < minVotes) break;
    const t = Math.floor(bi / nr), r = (bi % nr) - diag;
    lines.push({ t, r });
    for (let dt = -5; dt <= 5; dt++) {
      for (let dr = -8; dr <= 8; dr++) {
        let tt = t + dt, rr = r + dr;
        if (tt < 0) { tt += nt; rr = -rr; } else if (tt >= nt) { tt -= nt; rr = -rr; }
        const ri = rr + diag;
        if (ri >= 0 && ri < nr) used[tt * nr + ri] = 1;
      }
    }
  }
  const horiz = lines.filter((l) => l.t >= 45 && l.t < 135), vert = lines.filter((l) => l.t < 45 || l.t >= 135);
  const meet = (a, b) => {
    const det = cos[a.t] * sin[b.t] - cos[b.t] * sin[a.t];
    if (Math.abs(det) < 1e-6) return null;
    return [(a.r * sin[b.t] - b.r * sin[a.t]) / det, (cos[a.t] * b.r - cos[b.t] * a.r) / det];
  };
  const out = [];
  for (let i = 0; i < horiz.length; i++) {
    for (let j = i + 1; j < horiz.length; j++) {
      for (let k = 0; k < vert.length; k++) {
        for (let l = k + 1; l < vert.length; l++) {
          const pts = [meet(horiz[i], vert[k]), meet(horiz[i], vert[l]), meet(horiz[j], vert[l]), meet(horiz[j], vert[k])];
          if (pts.some((p) => !p)) continue;
          out.push(orderQuad(pts));
        }
      }
    }
  }
  return out;
}

function pick(cands, mag, w, h, low) {
  let best = null;
  for (const q of cands) {
    const s = support(q, mag, w, h, low);
    const score = quadArea(q) / (w * h) * s;
    if (!best || score > best.score) best = { quad: q, support: s, score };
  }
  return best;
}

function laplacianVar(Y, w, h, q) {
  let x0 = 1, y0 = 1, x1 = w - 2, y1 = h - 2;
  if (q) {
    x0 = Math.max(1, Math.floor(Math.min(...q.map((p) => p[0]))));
    x1 = Math.min(w - 2, Math.ceil(Math.max(...q.map((p) => p[0]))));
    y0 = Math.max(1, Math.floor(Math.min(...q.map((p) => p[1]))));
    y1 = Math.min(h - 2, Math.ceil(Math.max(...q.map((p) => p[1]))));
  }
  let s = 0, s2 = 0, n = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * w + x;
      const v = 4 * Y[i] - Y[i - 1] - Y[i + 1] - Y[i - w] - Y[i + w];
      s += v; s2 += v * v; n++;
    }
  }
  return n ? s2 / n - (s / n) ** 2 : 0;
}

export function detectQuad(rgba, w, h) {
  const raw = channels(rgba, w, h);
  const Y = blur(raw.Y, w, h), C = blur(raw.C, w, h);
  const { mag, dir } = gradients(Y, C, w, h, 1.5);
  const t = thin(mag, dir, w, h);
  const high = Math.min(36, Math.max(14, 0.5 * percentile(t, 0.9)));
  const low = Math.max(5, 0.4 * high);
  const edges = dilate(hysteresis(t, w, h, low, high), w, h);
  const cands = [];
  for (const pts of bigComponents(edges, w, h, 0.1 * w * h)) {
    const hp = hull(pts);
    if (hp.length < 4) continue;
    const q = hullQuad(hp);
    if (!q) continue;
    const o = orderQuad(q);
    if (validQuad(o, w, h)) cands.push(o);
  }
  let best = pick(cands, mag, w, h, low);
  if (!best || best.support < 0.5) {
    const hb = pick(houghQuads(edges, w, h).filter((q) => validQuad(q, w, h)), mag, w, h, low);
    if (hb && (!best || hb.score > best.score)) best = hb;
  }
  const sharpness = laplacianVar(raw.Y, w, h, best && best.support >= MIN_SUPPORT ? best.quad : null);
  if (!best || best.support < MIN_SUPPORT) return { quad: null, confidence: 0, sharpness, w, h };
  return { quad: best.quad.map((p) => [p[0] / w, p[1] / h]), confidence: best.support, sharpness, w, h };
}
