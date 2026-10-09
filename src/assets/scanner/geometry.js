export function orderQuad(pts) {
  const cx = (pts[0][0] + pts[1][0] + pts[2][0] + pts[3][0]) / 4;
  const cy = (pts[0][1] + pts[1][1] + pts[2][1] + pts[3][1]) / 4;
  const sorted = pts.map((p) => [p[0], p[1]]).sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
  let first = 0;
  for (let i = 1; i < 4; i++) if (sorted[i][0] + sorted[i][1] < sorted[first][0] + sorted[first][1]) first = i;
  return [0, 1, 2, 3].map((k) => sorted[(first + k) % 4]);
}

export function quadArea(q) {
  let s = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s) / 2;
}

export function isConvex(q) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) < 1e-9) return false;
    const s = Math.sign(cross);
    if (!sign) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

export function interiorAngles(q) {
  return q.map((p, i) => {
    const a = q[(i + 3) % 4], c = q[(i + 1) % 4];
    const v1 = [a[0] - p[0], a[1] - p[1]], v2 = [c[0] - p[0], c[1] - p[1]];
    const d = Math.hypot(v1[0], v1[1]) * Math.hypot(v2[0], v2[1]) || 1;
    return Math.acos(Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / d))) * 180 / Math.PI;
  });
}

export function sideLengths(q) {
  return [0, 1, 2, 3].map((i) => Math.hypot(q[(i + 1) % 4][0] - q[i][0], q[(i + 1) % 4][1] - q[i][1]));
}

function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => row.concat([b[i]]));
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    const tmp = M[c]; M[c] = M[p]; M[p] = tmp;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

export function homography(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const x = src[i][0], y = src[i][1], u = dst[i][0], v = dst[i][1];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const h = solve(A, b);
  return h ? h.concat([1]) : null;
}

export function applyH(h, x, y) {
  const w = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
}

export function invert3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-15) return null;
  return [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map((v) => v / det);
}

export function fullQuad(w, h) {
  return [[0, 0], [w, 0], [w, h], [0, h]];
}

export function quadToRect(q, width, height) {
  return homography(fullQuad(width, height), q);
}

export function outputSize(q, maxSide) {
  const [top, right, bottom, left] = sideLengths(q);
  const w = Math.max(top, bottom), h = Math.max(left, right);
  const s = maxSide && Math.max(w, h) > maxSide ? maxSide / Math.max(w, h) : 1;
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
}

export function validQuad(q, w, h, minArea = 0.15) {
  if (!isConvex(q)) return false;
  if (quadArea(q) < minArea * w * h) return false;
  if (interiorAngles(q).some((a) => a < 45 || a > 135)) return false;
  const s = sideLengths(q);
  if (Math.max(...s) > 5 * Math.min(...s)) return false;
  let inside = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4];
    const border = (a[0] < 0.02 * w && b[0] < 0.02 * w) || (a[0] > 0.98 * w && b[0] > 0.98 * w) ||
      (a[1] < 0.02 * h && b[1] < 0.02 * h) || (a[1] > 0.98 * h && b[1] > 0.98 * h);
    if (!border) inside++;
  }
  return inside >= 3;
}

export function scaleQuad(q, sx, sy) {
  return q.map((p) => [p[0] * sx, p[1] * sy]);
}

export function mapVideoQuadToPhoto(q, vw, vh, pw, ph) {
  const va = vw / vh, pa = pw / ph;
  if (Math.abs(va - pa) < 0.01) return q.map((p) => [p[0] * pw, p[1] * ph]);
  if (pa < va) {
    const bh = pw / va, oy = (ph - bh) / 2;
    return q.map((p) => [p[0] * pw, oy + p[1] * bh]);
  }
  const bw = ph * va, ox = (pw - bw) / 2;
  return q.map((p) => [ox + p[0] * bw, p[1] * ph]);
}

export function fitPixels(w, h, max) {
  if (w * h <= max) return { width: w, height: h };
  const s = Math.sqrt(max / (w * h));
  return { width: Math.max(1, Math.floor(w * s)), height: Math.max(1, Math.floor(h * s)) };
}

export function agrees(a, b, w, h, tol = 0.05) {
  const p = orderQuad(a), q = orderQuad(b), lim = tol * Math.max(w, h);
  return p.every((c, i) => Math.hypot(c[0] - q[i][0], c[1] - q[i][1]) <= lim);
}
