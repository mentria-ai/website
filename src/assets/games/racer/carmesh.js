import * as THREE from 'three';
import { carById, paintById } from './cars.js';

const COLS = 8;
const ROWS = 4;
const SEG = 9;
const FLAKE = 1 / 0.16;
const CREASE_SEG = new Set([1, 2, 3, 5, 6]);

const PART = {
  paint: 0, glass: 1, trim: 2, matte: 3, carbon: 4, chrome: 5, lamp: 6, drl: 7,
  tail: 8, brake: 9, grille: 10, accent: 11, rubber: 12, rim: 13, disc: 14, caliper: 15,
  nozzle: 16, barrel: 17, lip: 18, sidewall: 19, mirror: 20, lens: 21, hub: 22, under: 23, stripe: 24
};

const BASE = {
  glass: [0x2b3239, 0.04, 0.85, 1],
  trim: [0x0c0c0e, 0.22, 0.1, 1],
  matte: [0x121314, 0.82, 0, 0],
  carbon: [0x1c1e22, 0.3, 0.4, 1],
  chrome: [0xd8d9dc, 0.12, 1, 0],
  lamp: [0xc4ccd5, 0.07, 0.95, 1],
  drl: [0xe2e8ef, 0.16, 0.4, 1],
  tail: [0x6a0a10, 0.12, 0.2, 1],
  brake: [0x4a060b, 0.12, 0.2, 1],
  grille: [0x0b0c0d, 0.6, 0.3, 0],
  accent: [0xd12a1f, 0.35, 0.2, 1],
  rubber: [0x171717, 0.9, 0, 0],
  rim: [0xc5c9ce, 0.25, 1, 0],
  disc: [0x76787b, 0.42, 1, 0],
  caliper: [0xc4161c, 0.35, 0.2, 1],
  nozzle: [0x070707, 0.9, 0, 0],
  barrel: [0x34373b, 0.5, 0.9, 0],
  lip: [0xe6e7e9, 0.08, 1, 0],
  sidewall: [0x1e1e1e, 0.8, 0, 0],
  mirror: [0xbfc3c8, 0.02, 1, 0],
  lens: [0x10161c, 0.05, 0.6, 1],
  hub: [0x2a2c30, 0.35, 0.9, 0],
  under: [0x0b0b0c, 0.9, 0, 0],
  stripe: [0xf2f2f2, 0.32, 0.25, 1]
};

const EMISSIVE_GAIN = 6;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const bump = (t) => { const q = 1 - t * t; return q * q; };
const flatBump = (t) => { const q = 1 - t * t * t * t; return q * q * q; };
const sin2 = (t) => { const s = Math.sin(Math.PI * clamp(t, 0, 1)); return s * s; };

function curve(pts) {
  if (typeof pts === 'number') return () => pts;
  const n = pts.length;
  const X = new Float64Array(n), Y = new Float64Array(n), M = new Float64Array(n);
  for (let i = 0; i < n; i++) { X[i] = pts[i][0]; Y[i] = pts[i][1]; }
  if (n === 1) return () => Y[0];
  const S = new Float64Array(n - 1);
  for (let i = 0; i < n - 1; i++) S[i] = (Y[i + 1] - Y[i]) / (X[i + 1] - X[i]);
  M[0] = S[0];
  M[n - 1] = S[n - 2];
  for (let i = 1; i < n - 1; i++) M[i] = S[i - 1] * S[i] <= 0 ? 0 : (S[i - 1] + S[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (S[i] === 0) { M[i] = 0; M[i + 1] = 0; continue; }
    const a = M[i] / S[i], b = M[i + 1] / S[i], h = a * a + b * b;
    if (h > 9) { const t = 3 / Math.sqrt(h); M[i] = t * a * S[i]; M[i + 1] = t * b * S[i]; }
  }
  const fn = (x) => {
    if (x <= X[0]) return Y[0];
    if (x >= X[n - 1]) return Y[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (X[mid] <= x) lo = mid; else hi = mid; }
    const h = X[hi] - X[lo], t = (x - X[lo]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * Y[lo] + (t3 - 2 * t2 + t) * h * M[lo] + (3 * t2 - 2 * t3) * Y[hi] + (t3 - t2) * h * M[hi];
  };
  fn.d0 = X[0];
  fn.d1 = X[n - 1];
  return fn;
}

function buildShape(spec) {
  const b = spec.body;
  const L = b.length;
  const dF = b.frontOverhang;
  const dR = dF + b.wheelbase;
  const S = {
    spec, b, L, dF, dR,
    zShift: dF + b.wheelbase / 2,
    f: {
      bottom: curve(b.bottom), deck: curve(b.deck), roof: curve(b.roof), rail: curve(b.rail),
      fender: curve(b.fender), char: curve(b.char), half: curve(b.half), r5: curve(b.r5), r6: curve(b.r6)
    },
    tuckLow: b.tuckLow ?? 0.05,
    tuckUp: b.tuckUp ?? 0.06,
    upPow: b.upPow ?? 1,
    shoulderDrop: b.shoulderDrop ?? 0.05,
    rocker: b.rocker ?? 0.07,
    hoodPow: b.hoodPow ?? 2.5,
    noseRound: b.noseRound ?? 0.4,
    nosePow: b.nosePow ?? 2.4,
    tailRound: b.tailRound ?? 0.25,
    tailPow: b.tailPow ?? 3,
    flareLen: b.flareLen ?? 0.6,
    boxFlare: !!b.boxFlare,
    scoop: b.scoop || null,
    arches: [],
    cache: new Map()
  };
  const radius = b.wheel.radius, width = b.wheel.width;
  for (let k = 0; k < 2; k++) {
    const r = Array.isArray(radius) ? radius[k] : radius;
    const w = Array.isArray(width) ? width[k] : width;
    S.arches.push({ d: k ? dR : dF, r, w, ra: r + (b.archGap ?? 0.034), yc: r, flare: b.flare[k], front: k === 0, x: 0, xin: 0 });
  }
  const saved = S.arches.slice();
  S.arches = saved.map((a) => ({ ...a, ra: 0 }));
  for (let k = 0; k < 2; k++) {
    const a = saved[k];
    S.arches = saved.map((q) => ({ ...q, ra: -1 }));
    const K = keysAt(S, a.d);
    const top = a.yc + a.ra;
    const outer = K.xSide(Math.min(top - 0.02, K.ys - 0.01)) - (b.tireInset ?? 0.016);
    a.x = outer - a.w / 2;
    a.xin = a.x - a.w / 2 - (a.front ? 0.055 : 0.028);
  }
  S.arches = saved;
  S.cache.clear();
  return S;
}

function inRange(fn, d) {
  return d >= fn.d0 && d <= fn.d1;
}

function endFactor(S, d) {
  let f = 1;
  if (d < S.noseRound) {
    const t = 1 - d / S.noseRound;
    f *= Math.pow(Math.max(0, 1 - Math.pow(t, S.nosePow)), 1 / S.nosePow);
  }
  const dt = S.L - d;
  if (dt < S.tailRound) {
    const t = 1 - dt / S.tailRound;
    f *= Math.pow(Math.max(0, 1 - Math.pow(t, S.tailPow)), 1 / S.tailPow);
  }
  return f;
}

function keysAt(S, d) {
  const hit = S.cache.get(d);
  if (hit) return hit;
  const f = S.f;
  const yb = f.bottom(d);
  const yPeak = f.fender(d);
  const ys = yPeak - S.shoulderDrop;
  const yh = f.deck(d);
  const yt = inRange(f.roof, d) ? Math.max(yh, f.roof(d)) : yh;
  const wBase = f.half(d);
  let w = wBase;
  for (const a of S.arches) {
    const t = (d - a.d) / S.flareLen;
    if (t > -1 && t < 1) w += a.flare * (S.boxFlare ? flatBump(t) : bump(t));
  }
  const yc = Math.min(f.char(d), ys - 0.05);
  const yr = yb + S.rocker;
  const lowSpan = Math.max(0.04, yc - yb);
  const upSpan = Math.max(0.04, ys - yc);
  const sc = S.scoop;
  const tuckLow = S.tuckLow, tuckUp = S.tuckUp, upPow = S.upPow;
  const xSide = (y) => {
    let x = y < yc ? w - tuckLow * ((yc - y) / lowSpan) ** 2 : w - tuckUp * Math.pow(Math.min(1.4, (y - yc) / upSpan), upPow);
    if (sc && d > sc.d0 && d < sc.d1 && y > sc.y0 && y < sc.y1) {
      x -= sc.depth * sin2((d - sc.d0) / (sc.d1 - sc.d0)) * sin2((y - sc.y0) / (sc.y1 - sc.y0));
    }
    return x;
  };
  let arch = null;
  for (const a of S.arches) {
    if (a.ra <= 0) continue;
    const dz = d - a.d;
    if (dz >= -a.ra && dz <= a.ra) arch = { a, ya: Math.max(yb + 0.004, a.yc + Math.sqrt(Math.max(0, a.ra * a.ra - dz * dz))) };
  }
  const P = new Array(10);
  let D, yr2;
  P[0] = [0, yb];
  if (arch) {
    const ya = arch.ya;
    const xl = xSide(ya) - 0.024;
    const xin = Math.min(arch.a.xin, xl - 0.03);
    P[1] = [xin * 0.999, yb];
    P[2] = [xin, ya];
    P[3] = [xl, ya];
    yr2 = ya + 0.028;
    P[4] = [xSide(yr2), yr2];
    D = [xSide(ya) + 0.005, ya - 0.002];
  } else {
    const xr = xSide(yr);
    const xF = xr - S.rocker * 0.9;
    P[1] = [xF * 0.5, yb];
    P[2] = [xF * 0.8, yb];
    P[3] = [xF, yb];
    yr2 = yr;
    P[4] = [xr, yr];
    D = [xr, yb];
  }
  const yc2 = Math.max(yc, yr2 + 0.03);
  const ys2 = Math.max(ys, yc2 + 0.03);
  P[5] = [xSide(yc2), yc2];
  P[6] = [xSide(ys2), ys2];
  const yf = Math.max(yPeak, ys2 + 0.01);
  const G = [P[6][0] - 0.012, yf];
  const x5 = f.r5(d) * wBase;
  const x6 = Math.min(x5 - 0.02, f.r6(d) * wBase);
  const xsh = P[6][0];
  const hoodPow = S.hoodPow;
  const yTop = (x) => yh + (yf - yh) * Math.pow(clamp(x / xsh, 0, 1), hoodPow);
  P[7] = [x5, yTop(x5)];
  let lift = inRange(f.rail, d) ? Math.max(0, f.rail(d) - yTop(x6)) : 0;
  lift = Math.min(lift, Math.max(0, yt - yh));
  P[8] = [x6, yTop(x6) + lift];
  P[9] = [0, yt];
  const K = { d, yb, ys: ys2, yh, yt, yc: yc2, w, wBase, xSide, arch, P, D, G, x5, x6, lift, yTop, end: endFactor(S, d) };
  if (S.cache.size > 4096) S.cache.clear();
  S.cache.set(d, K);
  return K;
}

function bez(a, c, b, t, out) {
  const u = 1 - t;
  out[0] = u * u * a[0] + 2 * u * t * c[0] + t * t * b[0];
  out[1] = u * u * a[1] + 2 * u * t * c[1] + t * t * b[1];
}

function segPoint(K, k, t, out) {
  const P = K.P;
  if (k <= 2) {
    out[0] = P[k][0] + (P[k + 1][0] - P[k][0]) * t;
    out[1] = P[k][1] + (P[k + 1][1] - P[k][1]) * t;
  } else if (k === 3) {
    bez(P[3], K.D, P[4], t, out);
  } else if (k === 4 || k === 5) {
    const y = P[k][1] + (P[k + 1][1] - P[k][1]) * t;
    out[0] = K.xSide(y);
    out[1] = y;
  } else if (k === 6) {
    bez(P[6], K.G, P[7], t, out);
  } else if (k === 7) {
    const x = K.x5 + (K.x6 - K.x5) * t;
    out[0] = x;
    out[1] = K.yTop(x) + K.lift * (t + 0.18 * t * (1 - t));
  } else {
    const x = K.x6 * (1 - t);
    const c = 1 - (1 - t) * (1 - t);
    out[0] = x;
    out[1] = K.yTop(x) + K.lift + (K.yt - K.yh - K.lift) * c;
  }
  out[0] *= K.end;
}

const tmp2 = [0, 0];

function surf(S, d, s, out) {
  d = clamp(d, 0, S.L);
  s = clamp(s, 0, SEG);
  const K = keysAt(S, d);
  let k = Math.floor(s);
  if (k >= SEG) k = SEG - 1;
  segPoint(K, k, s - k, tmp2);
  out[0] = tmp2[0];
  out[1] = tmp2[1];
  out[2] = d - S.zShift;
  return out;
}

const sa = [0, 0, 0], sb = [0, 0, 0], sc3 = [0, 0, 0], sd = [0, 0, 0];

function surfNormal(S, d, s, out) {
  const e = 0.004, es = 0.012;
  d = clamp(d, 0, S.L);
  s = clamp(s, 0, SEG);
  const d0 = Math.max(0, d - e), d1 = Math.min(S.L, d + e);
  const s0 = Math.max(0, s - es), s1 = Math.min(SEG, s + es);
  surf(S, d0, s, sa);
  surf(S, d1, s, sb);
  surf(S, d, s0, sc3);
  surf(S, d, s1, sd);
  const ax = sd[0] - sc3[0], ay = sd[1] - sc3[1], az = sd[2] - sc3[2];
  const bx = sb[0] - sa[0], by = sb[1] - sa[1], bz = sb[2] - sa[2];
  let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
  if (d < 1e-4 || d > S.L - 1e-4 || s > SEG - 1e-6 || s < 1e-6) nx = 0;
  const l = Math.hypot(nx, ny, nz);
  if (l < 1e-12) {
    out[0] = 0; out[1] = s > 4.5 ? 1 : -1; out[2] = 0;
    return out;
  }
  out[0] = nx / l; out[1] = ny / l; out[2] = nz / l;
  return out;
}

class GeoBuilder {
  constructor() {
    this.p = [];
    this.n = [];
    this.uv = [];
    this.uv1 = [];
    this.ix = [];
    this.count = 0;
  }

  vert(x, y, z, nx, ny, nz, part) {
    this.p.push(x, y, z);
    this.n.push(nx, ny, nz);
    const c = part % COLS, r = (part / COLS) | 0;
    this.uv.push((c + 0.5) / COLS, (r + 0.5) / ROWS);
    if (part === PART.paint) this.uv1.push((z + x * 0.37) * FLAKE, (y + Math.abs(x) * 0.61) * FLAKE);
    else this.uv1.push(0, 0);
    return this.count++;
  }

  tri(a, b, c) {
    const p = this.p;
    const ax = p[b * 3] - p[a * 3], ay = p[b * 3 + 1] - p[a * 3 + 1], az = p[b * 3 + 2] - p[a * 3 + 2];
    const bx = p[c * 3] - p[a * 3], by = p[c * 3 + 1] - p[a * 3 + 1], bz = p[c * 3 + 2] - p[a * 3 + 2];
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    if (cx * cx + cy * cy + cz * cz < 1e-14) return;
    this.ix.push(a, b, c);
  }

  triFacing(a, b, c) {
    const p = this.p, n = this.n;
    const ax = p[b * 3] - p[a * 3], ay = p[b * 3 + 1] - p[a * 3 + 1], az = p[b * 3 + 2] - p[a * 3 + 2];
    const bx = p[c * 3] - p[a * 3], by = p[c * 3 + 1] - p[a * 3 + 1], bz = p[c * 3 + 2] - p[a * 3 + 2];
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    if (cx * cx + cy * cy + cz * cz < 1e-14) return;
    const rx = n[a * 3] + n[b * 3] + n[c * 3], ry = n[a * 3 + 1] + n[b * 3 + 1] + n[c * 3 + 1], rz = n[a * 3 + 2] + n[b * 3 + 2] + n[c * 3 + 2];
    if (cx * rx + cy * ry + cz * rz < 0) this.ix.push(a, c, b);
    else this.ix.push(a, b, c);
  }

  get triangles() {
    return this.ix.length / 3;
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('uv1', new THREE.Float32BufferAttribute(this.uv1, 2));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.ix, 1) : new THREE.Uint16BufferAttribute(this.ix, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

function stationList(S, hi) {
  const L = S.L;
  const out = [];
  const add = (d, crease) => out.push({ d: clamp(d, 0, L), crease: !!crease });
  const nN = hi ? 7 : 3, nT = hi ? 5 : 2;
  for (let k = 0; k <= nN; k++) add(S.noseRound * Math.pow(k / nN, 1.6));
  for (let k = 0; k <= nT; k++) add(L - S.tailRound * Math.pow(k / nT, 1.6));
  const nA = hi ? 12 : 5;
  for (const a of S.arches) {
    add(a.d - a.ra - 0.003, true);
    add(a.d + a.ra + 0.003, true);
    for (let k = 0; k <= nA; k++) add(a.d - a.ra * 0.9995 * Math.cos(Math.PI * k / nA), k === 0 || k === nA);
  }
  if (hi) {
    const g = S.b.glass;
    if (g) {
      add(g.ws[0]); add(g.ws[1]);
      if (g.rear) { add(g.rear[0]); add(g.rear[1]); }
    }
  }
  out.sort((p, q) => p.d - q.d);
  const merged = [];
  for (const s of out) {
    const last = merged[merged.length - 1];
    if (last && s.d - last.d < 0.0015) { last.crease = last.crease || s.crease; continue; }
    merged.push(s);
  }
  const maxGap = hi ? 0.14 : 0.34;
  const res = [];
  for (let i = 0; i < merged.length; i++) {
    res.push(merged[i]);
    if (i < merged.length - 1) {
      const gap = merged[i + 1].d - merged[i].d;
      const n = Math.ceil(gap / maxGap);
      for (let k = 1; k < n; k++) res.push({ d: merged[i].d + gap * k / n, crease: false });
    }
  }
  return res;
}

function buildBody(S, B, hi) {
  const segRows = hi ? [1, 2, 2, 3, 3, 4, 4, 3, 4] : [1, 1, 1, 1, 1, 2, 2, 1, 2];
  const sig = [], segOf = [], crease = [];
  for (let k = 0; k < SEG; k++) {
    for (let m = 0; m < segRows[k]; m++) {
      sig.push(k + m / segRows[k]);
      segOf.push(k);
      crease.push(m === 0 && CREASE_SEG.has(k));
    }
  }
  sig.push(SEG);
  segOf.push(SEG - 1);
  crease.push(false);
  const H = sig.length - 1;
  const nJ = 2 * H + 1;
  const st = stationList(S, hi);
  const nI = st.length;
  const P = new Float64Array(nI * nJ * 3);
  const archAt = new Uint8Array(nI);
  const pt = [0, 0];
  for (let i = 0; i < nI; i++) {
    const d = st[i].d;
    const K = keysAt(S, d);
    archAt[i] = K.arch ? 1 : 0;
    const z = d - S.zShift;
    for (let jj = 0; jj <= H; jj++) {
      const s = sig[jj];
      let k = Math.floor(s);
      if (k >= SEG) k = SEG - 1;
      segPoint(K, k, s - k, pt);
      let o = (i * nJ + jj) * 3;
      P[o] = pt[0]; P[o + 1] = pt[1]; P[o + 2] = z;
      o = (i * nJ + (2 * H - jj)) * 3;
      P[o] = -pt[0]; P[o + 1] = pt[1]; P[o + 2] = z;
    }
  }
  const nF = (nI - 1) * (nJ - 1);
  const FN = new Float64Array(nF * 3);
  for (let i = 0; i < nI - 1; i++) {
    for (let j = 0; j < nJ - 1; j++) {
      const o00 = (i * nJ + j) * 3, o10 = ((i + 1) * nJ + j) * 3, o11 = ((i + 1) * nJ + j + 1) * 3, o01 = (i * nJ + j + 1) * 3;
      const ax = P[o01] - P[o10], ay = P[o01 + 1] - P[o10 + 1], az = P[o01 + 2] - P[o10 + 2];
      const bx = P[o11] - P[o00], by = P[o11 + 1] - P[o00 + 1], bz = P[o11 + 2] - P[o00 + 2];
      const f = (i * (nJ - 1) + j) * 3;
      FN[f] = ay * bz - az * by;
      FN[f + 1] = az * bx - ax * bz;
      FN[f + 2] = ax * by - ay * bx;
    }
  }
  const rowCrease = (vj) => crease[vj <= H ? vj : 2 * H - vj];
  const nrm = [0, 0, 0];
  const cornerNormal = (vi, vj, fi, fj) => {
    let nx = 0, ny = 0, nz = 0;
    for (let ci = vi - 1; ci <= vi; ci++) {
      if (ci < 0 || ci > nI - 2) continue;
      if (ci !== fi && st[vi].crease) continue;
      for (let cj = vj - 1; cj <= vj; cj++) {
        if (cj < 0 || cj > nJ - 2) continue;
        if (cj !== fj && rowCrease(vj)) continue;
        const f = (ci * (nJ - 1) + cj) * 3;
        nx += FN[f]; ny += FN[f + 1]; nz += FN[f + 2];
      }
    }
    if (vi === 0 || vi === nI - 1) nx = 0;
    let l = Math.hypot(nx, ny, nz);
    if (l < 1e-12) {
      const f = (fi * (nJ - 1) + fj) * 3;
      nx = FN[f]; ny = FN[f + 1]; nz = FN[f + 2];
      l = Math.hypot(nx, ny, nz) || 1;
    }
    nrm[0] = nx / l; nrm[1] = ny / l; nrm[2] = nz / l;
    return nrm;
  };
  const corner = (vi, vj, fi, fj, part) => {
    const n = cornerNormal(vi, vj, fi, fj);
    const o = (vi * nJ + vj) * 3;
    return B.vert(P[o], P[o + 1], P[o + 2], n[0], n[1], n[2], part);
  };
  let maxX = 0, maxY = 0;
  for (let i = 0; i < P.length; i += 3) { maxX = Math.max(maxX, P[i]); maxY = Math.max(maxY, P[i + 1]); }
  for (let i = 0; i < nI - 1; i++) {
    for (let j = 0; j < nJ - 1; j++) {
      const seg = j < H ? segOf[j] : segOf[2 * H - j - 1];
      const a0 = archAt[i], a1 = archAt[i + 1];
      let part = PART.paint;
      if (seg === 0) part = PART.under;
      else if (seg <= 2) part = a0 || a1 ? PART.matte : PART.under;
      else if (seg === 3) part = a0 && a1 ? PART.paint : a0 || a1 ? PART.matte : PART.paint;
      const v00 = corner(i, j, i, j, part);
      const v10 = corner(i + 1, j, i, j, part);
      const v11 = corner(i + 1, j + 1, i, j, part);
      const v01 = corner(i, j + 1, i, j, part);
      B.tri(v00, v11, v10);
      B.tri(v00, v01, v11);
    }
  }
  return { maxX, maxY, stations: nI, rows: nJ };
}

const pp = [0, 0, 0], pn = [0, 0, 0];

function bilinear(q, u, v) {
  const a = (1 - u) * (1 - v), b = u * (1 - v), c = u * v, e = (1 - u) * v;
  return [a * q[0][0] + b * q[1][0] + c * q[2][0] + e * q[3][0], a * q[0][1] + b * q[1][1] + c * q[2][1] + e * q[3][1]];
}

function arcParams(S, q, alongU, n) {
  const fine = 40;
  const pts = [];
  for (let i = 0; i <= fine; i++) {
    const t = i / fine;
    const [d, s] = alongU ? bilinear(q, t, 0.5) : bilinear(q, 0.5, t);
    pts.push(surf(S, d, s, [0, 0, 0]));
  }
  const cum = [0];
  for (let i = 1; i <= fine; i++) {
    const a = pts[i], b = pts[i - 1];
    cum.push(cum[i - 1] + Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
  }
  const total = cum[fine] || 1;
  const out = [];
  let i = 1;
  for (let k = 0; k <= n; k++) {
    const target = total * k / n;
    while (i < fine && cum[i] < target) i++;
    const f = (target - cum[i - 1]) / Math.max(1e-9, cum[i] - cum[i - 1]);
    out.push(clamp((i - 1 + clamp(f, 0, 1)) / fine, 0, 1));
  }
  out[0] = 0;
  out[n] = 1;
  return out;
}

function addPatch(S, B, q, part, off, nu, nv, mirror = true) {
  const n = (nu + 1) * (nv + 1);
  const us = arcParams(S, q, true, nu), vs = arcParams(S, q, false, nv);
  const pos = new Float64Array(n * 3), nor = new Float64Array(n * 3);
  let o = 0;
  for (let iv = 0; iv <= nv; iv++) {
    for (let iu = 0; iu <= nu; iu++) {
      const [d, s] = bilinear(q, us[iu], vs[iv]);
      surf(S, d, s, pp);
      surfNormal(S, d, s, pn);
      const k = off * S.offScale;
      pos[o] = pp[0] + pn[0] * k;
      pos[o + 1] = pp[1] + pn[1] * k;
      pos[o + 2] = pp[2] + pn[2] * k;
      nor[o] = pn[0]; nor[o + 1] = pn[1]; nor[o + 2] = pn[2];
      if (s >= SEG - 1e-6) pos[o] = 0;
      o += 3;
    }
  }
  const sides = mirror ? [1, -1] : [1];
  for (const sx of sides) {
    const base = [];
    for (let k = 0; k < n; k++) base.push(B.vert(pos[k * 3] * sx, pos[k * 3 + 1], pos[k * 3 + 2], nor[k * 3] * sx, nor[k * 3 + 1], nor[k * 3 + 2], part));
    for (let iv = 0; iv < nv; iv++) {
      for (let iu = 0; iu < nu; iu++) {
        const a = base[iv * (nu + 1) + iu], b = base[iv * (nu + 1) + iu + 1];
        const c = base[(iv + 1) * (nu + 1) + iu + 1], e = base[(iv + 1) * (nu + 1) + iu];
        if (sx > 0) { B.tri(a, c, b); B.tri(a, e, c); }
        else { B.tri(a, b, c); B.tri(a, c, e); }
      }
    }
  }
}

function prism(B, contour, holes, axis, a0, a1, part, opts = {}) {
  const map = (p, q, a) => (axis === 'x' ? [a, q, p] : axis === 'y' ? [p, a, q] : [p, q, a]);
  const mapN = (np, nq, na) => (axis === 'x' ? [na, nq, np] : axis === 'y' ? [np, na, nq] : [np, nq, na]);
  const toV = (pts) => pts.map((p) => new THREE.Vector2(p[0], p[1]));
  let outer = contour.slice();
  if (THREE.ShapeUtils.isClockWise(toV(outer))) outer.reverse();
  const inner = (holes || []).map((h) => {
    const c = h.slice();
    if (!THREE.ShapeUtils.isClockWise(toV(c))) c.reverse();
    return c;
  });
  const deform = opts.deform || null;
  const capNormal = opts.capNormal || null;
  const all = outer.concat(...inner);
  const faces = THREE.ShapeUtils.triangulateShape(toV(outer), inner.map(toV));
  const caps = opts.caps || [true, true];
  for (const [ai, sign, on] of [[a0, -1, caps[0]], [a1, 1, caps[1]]]) {
    if (!on) continue;
    const idx = all.map((p) => {
      let v = map(p[0], p[1], ai);
      let nn = mapN(0, 0, sign);
      if (deform) v = deform(v, sign);
      if (capNormal && sign > 0) nn = capNormal(v, nn);
      return B.vert(v[0], v[1], v[2], nn[0], nn[1], nn[2], part);
    });
    for (const f of faces) B.triFacing(idx[f[0]], idx[f[1]], idx[f[2]]);
  }
  if (opts.sides === false) return;
  const loops = opts.skipOuterSide ? inner : [outer, ...inner];
  for (const loop of loops) {
    const m = loop.length;
    for (let i = 0; i < m; i++) {
      const p0 = loop[i], p1 = loop[(i + 1) % m];
      const ex = p1[0] - p0[0], ey = p1[1] - p0[1];
      const el = Math.hypot(ex, ey) || 1;
      let n0 = [ey / el, -ex / el], n1 = n0;
      if (opts.smooth) {
        const pm = loop[(i - 1 + m) % m], p2 = loop[(i + 2) % m];
        const e0x = p0[0] - pm[0], e0y = p0[1] - pm[1], l0 = Math.hypot(e0x, e0y) || 1;
        const e2x = p2[0] - p1[0], e2y = p2[1] - p1[1], l2 = Math.hypot(e2x, e2y) || 1;
        n0 = [(e0y / l0 + ey / el) / 2, (-e0x / l0 - ex / el) / 2];
        n1 = [(ey / el + e2y / l2) / 2, (-ex / el - e2x / l2) / 2];
        const k0 = Math.hypot(n0[0], n0[1]) || 1, k1 = Math.hypot(n1[0], n1[1]) || 1;
        n0 = [n0[0] / k0, n0[1] / k0];
        n1 = [n1[0] / k1, n1[1] / k1];
      }
      const q = [[p0, a0, n0], [p1, a0, n1], [p1, a1, n1], [p0, a1, n0]].map(([p, a, nn]) => {
        let v = map(p[0], p[1], a);
        if (deform) v = deform(v, 0);
        const N = mapN(nn[0], nn[1], 0);
        return B.vert(v[0], v[1], v[2], N[0], N[1], N[2], part);
      });
      B.triFacing(q[0], q[1], q[2]);
      B.triFacing(q[0], q[2], q[3]);
    }
  }
}

function lathe(B, profile, segs, parts, xf, phi0 = 0, phiLen = Math.PI * 2) {
  const m = profile.length;
  const pn2 = [];
  for (let i = 0; i < m; i++) {
    const a = profile[Math.max(0, i - 1)], b = profile[Math.min(m - 1, i + 1)];
    const dr = b[0] - a[0], da = b[1] - a[1];
    const l = Math.hypot(dr, da) || 1;
    pn2.push([-da / l, dr / l]);
  }
  const closed = phiLen >= Math.PI * 2 - 1e-6;
  const cols = closed ? segs : segs + 1;
  const v = new THREE.Vector3(), nv = new THREE.Vector3();
  const nm = xf ? new THREE.Matrix3().getNormalMatrix(xf) : null;
  for (let i = 0; i < m - 1; i++) {
    const part = Array.isArray(parts) ? parts[i] : parts;
    const ids = [];
    for (const r of [i, i + 1]) {
      const row = [];
      for (let k = 0; k < cols; k++) {
        const th = phi0 + phiLen * k / segs;
        const c = Math.cos(th), s = Math.sin(th);
        const pr = profile[r];
        v.set(pr[1], pr[0] * c, pr[0] * s);
        nv.set(pn2[r][1], pn2[r][0] * c, pn2[r][0] * s);
        if (xf) { v.applyMatrix4(xf); nv.applyMatrix3(nm).normalize(); }
        row.push(B.vert(v.x, v.y, v.z, nv.x, nv.y, nv.z, part));
      }
      ids.push(row);
    }
    for (let k = 0; k < segs; k++) {
      const k1 = closed ? (k + 1) % cols : k + 1;
      B.triFacing(ids[0][k], ids[1][k], ids[1][k1]);
      B.triFacing(ids[0][k], ids[1][k1], ids[0][k1]);
    }
  }
}

function addBox(B, cx, cy, cz, hx, hy, hz, part, rotY = 0) {
  const c = Math.cos(rotY), s = Math.sin(rotY);
  const faces = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (const [fx, fy, fz] of faces) {
    const ax = fx ? [0, 1, 0] : fy ? [1, 0, 0] : [1, 0, 0];
    const bx = fx ? [0, 0, 1] : fy ? [0, 0, 1] : [0, 1, 0];
    const ids = [];
    for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const lx = (fx + ax[0] * su + bx[0] * sv) * hx;
      const ly = (fy + ax[1] * su + bx[1] * sv) * hy;
      const lz = (fz + ax[2] * su + bx[2] * sv) * hz;
      const nx = fx * c + fz * s, nz = -fx * s + fz * c;
      ids.push(B.vert(cx + lx * c + lz * s, cy + ly, cz - lx * s + lz * c, nx, fy, nz, part));
    }
    B.triFacing(ids[0], ids[1], ids[2]);
    B.triFacing(ids[0], ids[2], ids[3]);
  }
}

function topAt(S, d, x) {
  const K = keysAt(S, d);
  const ax = Math.abs(x);
  let prevX = 0, prevY = K.yt;
  for (let s = SEG; s >= 6; s -= 0.05) {
    surf(S, d, s, pp);
    if (pp[0] >= ax) {
      const t = (ax - prevX) / Math.max(1e-6, pp[0] - prevX);
      return prevY + (pp[1] - prevY) * t;
    }
    prevX = pp[0];
    prevY = pp[1];
  }
  return prevY;
}

function airfoil(chord, thick, n) {
  const up = [], lo = [];
  for (let i = 0; i <= n; i++) {
    const x = (1 - Math.cos(Math.PI * i / n)) / 2;
    const t = 5 * thick * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x * x * x - 0.1036 * x * x * x * x);
    const camber = -0.06 * 4 * x * (1 - x);
    up.push([x * chord, (camber + t) * chord]);
    lo.push([x * chord, (camber - t) * chord]);
  }
  const pts = up.slice();
  for (let i = n - 1; i >= 1; i--) pts.push(lo[i]);
  return pts;
}

function addGlassAndTrim(S, B, hi) {
  const g = S.b.glass;
  if (!g) return;
  const nu = hi ? 10 : 4, nv = hi ? 4 : 2;
  const ws = g.ws;
  addPatch(S, B, [[ws[0] - 0.01, 7.86], [ws[1] + 0.035, 7.86], [ws[1] + 0.035, 9], [ws[0] - 0.01, 9]], PART.trim, 0.006, nu, hi ? 5 : 2);
  addPatch(S, B, [[ws[0] + 0.03, 8.1], [ws[1], 8.1], [ws[1], 9], [ws[0] + 0.03, 9]], PART.glass, 0.0095, nu, hi ? 5 : 2);
  const sd = g.side;
  const wins = [];
  if (g.split) {
    const [sp, sw] = g.split;
    wins.push([[sd[0], 7.08], [sp - sw / 2, 7.08], [sp - sw / 2 - 0.03, 7.92], [sd[1], 7.92]]);
    wins.push([[sp + sw / 2, 7.08], [sd[3], 7.08], [sd[2], 7.92], [sp + sw / 2 - 0.03, 7.92]]);
  } else {
    wins.push([[sd[0], 7.08], [sd[3], 7.08], [sd[2], 7.92], [sd[1], 7.92]]);
  }
  addPatch(S, B, [[sd[0] - 0.035, 7.0], [sd[3] + 0.03, 7.0], [sd[2] + 0.03, 8.06], [sd[1] - 0.04, 8.06]], PART.trim, 0.0025, nu, nv);
  for (const w of wins) addPatch(S, B, w, PART.glass, 0.0055, hi ? 8 : 3, nv);
  if (g.rear) {
    const [r0, r1, wf] = g.rear;
    const sOuter = 8 + (1 - wf);
    addPatch(S, B, [[r0 - 0.03, sOuter - 0.08], [r1 + 0.03, sOuter - 0.08], [r1 + 0.03, 9], [r0 - 0.03, 9]], PART.trim, 0.0025, hi ? 6 : 3, hi ? 4 : 2);
    addPatch(S, B, [[r0, sOuter], [r1, sOuter], [r1, 9], [r0, 9]], PART.glass, 0.0055, hi ? 6 : 3, hi ? 4 : 2);
  }
}

function addLamps(S, B, hi) {
  const lp = S.b.lamps;
  if (!lp) return;
  const nu = hi ? 8 : 3, nv = hi ? 3 : 1;
  const grow = (q, e) => q.map((c, i) => [clamp(c[0] + (i === 0 || i === 3 ? -e : e), 0, S.L), c[1] + (i < 2 ? -e * 2 : e * 2)]);
  if (hi) addPatch(S, B, grow(lp.head, 0.012), PART.trim, 0.0075, nu, nv);
  addPatch(S, B, lp.head, PART.lamp, 0.0095, nu, nv);
  if (lp.drl) addPatch(S, B, lp.drl, PART.drl, 0.012, nu, 1);
  if (hi) addPatch(S, B, grow(lp.tail, 0.01), PART.trim, 0.0075, nu, nv);
  addPatch(S, B, lp.tail, PART.tail, 0.0095, nu, nv);
  if (lp.brake) addPatch(S, B, lp.brake, PART.brake, 0.012, nu, 1);
}

function addSurfaceDetails(S, B, hi) {
  const b = S.b;
  for (const it of b.intakes || []) addPatch(S, B, it.q, PART[it.part] ?? PART.grille, it.off ?? 0.012, hi ? 8 : 3, hi ? 4 : 2);
  if (b.grilleFull) {
    const gd = Math.min(0.3, S.noseRound - 0.015);
    addPatch(S, B, [[0.0, 4.95], [gd, 4.95], [gd, 5.95], [0.0, 5.95]], PART.grille, 0.003, hi ? 6 : 2, hi ? 3 : 1);
    if (hi) {
      for (let k = 0; k < 4; k++) {
        const s0 = 5.08 + k * 0.22;
        addPatch(S, B, [[0.0, s0], [gd - 0.02, s0], [gd - 0.02, s0 + 0.035], [0.0, s0 + 0.035]], PART.chrome, 0.0055, 6, 1);
      }
    }
  }
  if (hi) {
    for (const v of b.vents || []) {
      addPatch(S, B, v.q, PART.matte, 0.0025, 4, 2);
      const n = v.slats || 4;
      for (let k = 0; k < n; k++) {
        const t0 = (k + 0.3) / n, t1 = (k + 0.62) / n;
        const q = v.q;
        const l = (t) => [q[0][0] + (q[1][0] - q[0][0]) * t, q[0][1] + (q[1][1] - q[0][1]) * t];
        const r = (t) => [q[3][0] + (q[2][0] - q[3][0]) * t, q[3][1] + (q[2][1] - q[3][1]) * t];
        addPatch(S, B, [l(t0), l(t1), r(t1), r(t0)], PART.carbon, 0.006, 1, 2);
      }
    }
    for (const [d0, d1] of b.lines || []) {
      for (const d of [d0, d1]) addPatch(S, B, [[d - 0.0035, 3.75], [d + 0.0035, 3.75], [d + 0.0035, 7.0], [d - 0.0035, 7.0]], PART.under, 0.003, 1, 6);
    }
  }
  if (b.skirt) {
    const a0 = S.arches[0], a1 = S.arches[1];
    const d0 = a0.d + a0.ra + 0.02, d1 = a1.d - a1.ra - 0.02;
    addPatch(S, B, [[d0, 3.25], [d1, 3.25], [d1, 4.15], [d0, 4.15]], PART.carbon, 0.008, hi ? 8 : 2, hi ? 2 : 1);
  }
  const a0 = S.arches[0], a1 = S.arches[1];
  const lv = S.spec.livery;
  if (lv && lv.stripes === 'twin') {
    addPatch(S, B, [[0.02, 8.42], [S.L - 0.02, 8.42], [S.L - 0.02, 8.86], [0.02, 8.86]], PART.stripe, 0.0018, hi ? 40 : 14, 1);
  } else if (lv && lv.stripes === 'rally') {
    addPatch(S, B, [[0.02, 8.74], [S.L - 0.02, 8.74], [S.L - 0.02, 9], [0.02, 9]], PART.stripe, 0.0018, hi ? 36 : 12, 1);
    addPatch(S, B, [[a0.d + a0.ra + 0.06, 4.35], [a1.d - a1.ra - 0.06, 4.35], [a1.d - a1.ra - 0.06, 4.75], [a0.d + a0.ra + 0.06, 4.75]], PART.stripe, 0.0018, hi ? 10 : 3, 1);
  }
}

function addParts(S, B, hi) {
  const b = S.b;
  const zOf = (d) => d - S.zShift;
  const a0 = S.arches[0], a1 = S.arches[1];
  if (b.mirror) {
    const md = b.mirror.d;
    const part = PART[b.mirror.part] ?? PART.paint;
    const base = surf(S, md, 7.05, [0, 0, 0]);
    const cx = base[0] + 0.13, cy = base[1] + 0.065, cz = base[2] + 0.035;
    const segs = hi ? 12 : 6;
    for (const sx of [1, -1]) {
      const geo = new THREE.SphereGeometry(1, segs, hi ? 6 : 3, 0, Math.PI * 2, 0, Math.PI / 2);
      geo.rotateX(-Math.PI / 2);
      geo.scale(0.1, 0.056, 0.085);
      geo.translate(cx * sx, cy, cz);
      addGeometry(B, geo, part);
      geo.dispose();
      const gl = new THREE.CircleGeometry(1, segs);
      gl.scale(0.088, 0.046, 1);
      gl.translate(cx * sx, cy, cz + 0.002);
      addGeometry(B, gl, PART.mirror);
      gl.dispose();
      addBox(B, (base[0] + 0.05) * sx, base[1] + 0.03, cz - 0.01, 0.05, 0.012, 0.03, PART.trim);
    }
  }
  if (b.wing) {
    const w = b.wing;
    const part = PART[w.part] ?? PART.carbon;
    const yBase = topAt(S, w.d, w.posts);
    const y = yBase + w.height;
    const zl = zOf(w.d) - w.chord / 2;
    const foil = airfoil(w.chord, 0.11, hi ? 10 : 4).map(([x, yy]) => [zl + x, y + yy - x * 0.12]);
    prism(B, foil, null, 'x', -w.span, w.span, part, { smooth: true });
    const plateH = 0.06 + w.height * 0.2;
    const plate = [[zl - 0.02, y + 0.025], [zl + w.chord + 0.03, y + 0.01], [zl + w.chord + 0.02, y - plateH], [zl + 0.03, y - plateH * 0.55]];
    for (const sx of [1, -1]) prism(B, plate, null, 'x', sx > 0 ? w.span - 0.004 : -w.span - 0.008, sx > 0 ? w.span + 0.008 : -w.span + 0.004, part);
    for (const sx of [1, -1]) {
      const yb2 = topAt(S, w.d, w.posts) - 0.02;
      const post = [[zl + w.chord * 0.3, yb2], [zl + w.chord * 0.62, yb2], [zl + w.chord * 0.5, y - 0.01], [zl + w.chord * 0.32, y - 0.01]];
      prism(B, post, null, 'x', sx * w.posts - 0.009, sx * w.posts + 0.009, part);
    }
  }
  if (b.fin) {
    const fn = b.fin;
    const n = hi ? 10 : 4;
    const bottom = [], top = [];
    for (let i = 0; i <= n; i++) {
      const d = fn.d0 + (fn.d1 - fn.d0) * i / n;
      const yb2 = topAt(S, d, 0) - 0.02;
      bottom.push([zOf(d), yb2]);
      top.push([zOf(d), yb2 + 0.02 + fn.height * Math.pow(i / n, 0.85)]);
    }
    const contour = bottom.concat(top.reverse());
    prism(B, contour, null, 'x', -0.007, 0.007, PART[fn.part] ?? PART.paint, { smooth: false });
  }
  if (b.spoiler) {
    const sp = b.spoiler;
    const span = keysAt(S, sp.d).x6 * 1.25;
    const y = topAt(S, sp.d, 0);
    const z = zOf(sp.d);
    const shape = [[z - 0.1, y - 0.01], [z + 0.06, y + sp.h], [z + 0.075, y + sp.h - 0.012], [z - 0.02, y - 0.015]];
    prism(B, shape, null, 'x', -span, span, PART.paint, { smooth: true });
  }
  if (b.hoodScoop) {
    const hs = b.hoodScoop;
    const n = 6;
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const d = hs.d0 + (hs.d1 - hs.d0) * i / n;
      pts.push([zOf(d), topAt(S, d, hs.w * 0.5) - 0.012]);
    }
    const yFront = topAt(S, hs.d0, 0);
    const ordered = [pts[0], [zOf(hs.d0) + 0.04, yFront + hs.h], [zOf(hs.d1) - 0.08, topAt(S, hs.d1, 0) + hs.h * 0.55], pts[n]];
    prism(B, ordered.concat(pts.slice(1, n).reverse()), null, 'x', -hs.w / 2, hs.w / 2, PART.paint, { smooth: false });
    prism(B, [[zOf(hs.d0) + 0.012, yFront + 0.005], [zOf(hs.d0) + 0.04, yFront + hs.h - 0.012], [zOf(hs.d0) + 0.05, yFront + hs.h - 0.014], [zOf(hs.d0) + 0.03, yFront + 0.004]], null, 'x', -hs.w / 2 + 0.025, hs.w / 2 - 0.025, PART.matte);
  }
  if (b.roofScoop) {
    const rs = b.roofScoop;
    const d0 = rs.d, d1 = rs.d + rs.len;
    const y0 = topAt(S, d0, 0), y1 = topAt(S, d1, 0);
    const shape = [[zOf(d0), y0 - 0.01], [zOf(d0) + 0.05, y0 + rs.h], [zOf(d1), y1 + rs.h * 0.5], [zOf(d1), y1 - 0.01]];
    prism(B, shape, null, 'x', -rs.w / 2, rs.w / 2, PART.paint);
    prism(B, [[zOf(d0) + 0.012, y0 + 0.004], [zOf(d0) + 0.045, y0 + rs.h - 0.01], [zOf(d0) + 0.052, y0 + rs.h - 0.012], [zOf(d0) + 0.03, y0 + 0.002]], null, 'x', -rs.w / 2 + 0.02, rs.w / 2 - 0.02, PART.matte);
  }
  if (b.splitter) {
    const sp = b.splitter;
    const dEnd = a0.d - a0.ra - 0.04;
    const n = hi ? 12 : 5;
    const outline = [];
    for (let i = 0; i <= n; i++) {
      const d = dEnd * Math.pow(i / n, 1.4);
      const K = keysAt(S, d);
      outline.push([K.P[3][0] * K.end, zOf(d)]);
    }
    const off = [];
    for (let i = 0; i <= n; i++) {
      const a = outline[Math.max(0, i - 1)], c = outline[Math.min(n, i + 1)];
      let tx = c[0] - a[0], tz = c[1] - a[1];
      const l = Math.hypot(tx, tz) || 1;
      tx /= l; tz /= l;
      let nx = -tz, nz = tx;
      if (nx < 0 || (i === 0 && nz > 0)) { nx = -nx; nz = -nz; }
      if (i === 0) { nx = 0; nz = -1; }
      off.push([outline[i][0] + nx * sp.out, outline[i][1] + nz * sp.out]);
    }
    const right = off.slice();
    const innerZ = zOf(Math.min(dEnd, sp.depth));
    const contour = [];
    for (let i = n; i >= 0; i--) contour.push([-right[i][0], right[i][1]]);
    for (let i = 1; i <= n; i++) contour.push(right[i]);
    contour.push([right[n][0] - 0.06, zOf(dEnd) + 0.02]);
    contour.push([0.25, innerZ]);
    contour.push([-0.25, innerZ]);
    contour.push([-right[n][0] + 0.06, zOf(dEnd) + 0.02]);
    const ySp = S.f.bottom(dEnd * 0.6);
    prism(B, contour, null, 'y', ySp - 0.016, ySp - 0.002, PART.carbon);
  }
  if (b.diffuser && hi) {
    const df = b.diffuser;
    const d0 = S.L - df.len, d1 = S.L - 0.03;
    const yFlat = S.f.bottom(d0);
    const n = 6;
    const half = keysAt(S, d0).wBase;
    for (let k = 0; k < df.fins; k++) {
      const x = df.fins === 1 ? 0 : (-0.62 + 1.24 * k / (df.fins - 1)) * half;
      const top = [];
      for (let i = 0; i <= n; i++) {
        const d = d0 + (d1 - d0) * i / n;
        top.push([zOf(d), S.f.bottom(d) + 0.004]);
      }
      const lowEdge = top.map(([z, y]) => [z, Math.max(yFlat - 0.002, y - 0.085)]);
      const contour = [...lowEdge, ...top.reverse()];
      prism(B, contour, null, 'x', x - 0.006, x + 0.006, PART.matte);
    }
  }
  if (b.exhaust) {
    const ex = b.exhaust;
    const segs = hi ? 14 : 6;
    const xs = [];
    for (const x of ex.x) { xs.push(x); if (!ex.single) xs.push(-x); }
    for (const x of xs) {
      const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0));
      m.setPosition(x, ex.y, zOf(ex.d));
      const r = ex.r;
      lathe(B, [[r * 0.98, 0.16], [r, -0.05], [r * 1.02, -0.062], [r * 0.8, -0.07], [r * 0.78, -0.03]], segs, [PART.chrome, PART.chrome, PART.chrome, PART.nozzle], m);
      lathe(B, [[0.001, -0.03], [r * 0.78, -0.03]], segs, PART.nozzle, m);
    }
  }
  if (b.flaps) {
    for (const a of S.arches) {
      for (const sx of [1, -1]) {
        const z = zOf(a.d + a.ra * 0.92);
        addBox(B, sx * (a.x + 0.01), 0.2, z, a.w * 0.5, 0.11, 0.005, PART.matte);
      }
    }
  }
}

function addGeometry(B, geo, part) {
  const pos = geo.getAttribute('position');
  if (!geo.getAttribute('normal')) geo.computeVertexNormals();
  const nor = geo.getAttribute('normal');
  const base = [];
  for (let i = 0; i < pos.count; i++) base.push(B.vert(pos.getX(i), pos.getY(i), pos.getZ(i), nor.getX(i), nor.getY(i), nor.getZ(i), part));
  const idx = geo.getIndex();
  if (idx) {
    for (let i = 0; i < idx.count; i += 3) B.triFacing(base[idx.getX(i)], base[idx.getX(i + 1)], base[idx.getX(i + 2)]);
  } else {
    for (let i = 0; i < pos.count; i += 3) B.triFacing(base[i], base[i + 1], base[i + 2]);
  }
}

function spokeHoles(style, rIn, rOut, hi) {
  const holes = [];
  const arcN = hi ? 5 : 2;
  const win = (a0, a1, r0, r1, hw0, hw1, twist) => {
    const pts = [];
    const edge = (r) => {
      const t = (r - r0) / (r1 - r0);
      return { hw: (hw0 + (hw1 - hw0) * t) / r, tw: twist * t };
    };
    const eo = edge(r1), ei = edge(r0);
    for (let i = 0; i <= arcN; i++) {
      const a = a0 + eo.hw + eo.tw + (a1 - a0 - 2 * eo.hw) * i / arcN;
      pts.push([Math.cos(a) * r1, Math.sin(a) * r1]);
    }
    const mids = hi && twist ? 3 : 1;
    for (let i = mids; i >= 1; i--) {
      const r = r0 + (r1 - r0) * i / (mids + 1);
      const e = edge(r);
      const a = a1 - e.hw + e.tw;
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    const inN = Math.max(1, arcN - 2);
    for (let i = 0; i <= inN; i++) {
      const a = a1 - ei.hw + ei.tw - (a1 - a0 - 2 * ei.hw) * i / inN;
      pts.push([Math.cos(a) * r0, Math.sin(a) * r0]);
    }
    for (let i = 1; i <= mids; i++) {
      const r = r0 + (r1 - r0) * i / (mids + 1);
      const e = edge(r);
      const a = a0 + e.hw + e.tw;
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    holes.push(pts);
  };
  if (style === 'dish') {
    const n = 8, rc = (rIn + rOut) / 2 + 0.01, rh = (rOut - rIn) * 0.3;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const pts = [];
      const m = hi ? 10 : 5;
      for (let i = 0; i < m; i++) {
        const b = (i / m) * Math.PI * 2;
        pts.push([Math.cos(a) * rc + Math.cos(b) * rh, Math.sin(a) * rc + Math.sin(b) * rh]);
      }
      holes.push(pts);
    }
    return holes;
  }
  if (style === 'split') {
    const n = 5, gap = 0.16;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const next = ((k + 1) / n) * Math.PI * 2;
      win(a + gap / 2, next - gap / 2, rIn, rOut, 0.012, 0.009, 0);
      win(next - gap / 2, next + gap / 2, rIn + (rOut - rIn) * 0.42, rOut, 0.012, 0.009, 0);
    }
    return holes;
  }
  const cfg = {
    five: { n: 5, hw0: 0.03, hw1: 0.021, twist: 0 },
    ten: { n: 10, hw0: 0.0125, hw1: 0.0095, twist: 0 },
    blade: { n: 7, hw0: 0.02, hw1: 0.01, twist: 0.42 },
    star: { n: 6, hw0: 0.026, hw1: 0.012, twist: 0 }
  }[style] || { n: 5, hw0: 0.03, hw1: 0.02, twist: 0 };
  for (let k = 0; k < cfg.n; k++) {
    const a = (k / cfg.n) * Math.PI * 2;
    const next = ((k + 1) / cfg.n) * Math.PI * 2;
    win(a, next, rIn, rOut, cfg.hw0, cfg.hw1, cfg.twist);
  }
  return holes;
}

function buildWheel(spec, k, hi) {
  const w = spec.body.wheel;
  const R = Array.isArray(w.radius) ? w.radius[k] : w.radius;
  const W = Array.isArray(w.width) ? w.width[k] : w.width;
  const rr = R * (w.rim ?? 0.72);
  const h = W / 2;
  const B = new GeoBuilder();
  const segs = hi ? 28 : 12;
  const side = R - rr;
  if (hi) {
    lathe(B, [[rr - 0.004, h * 0.84], [rr + side * 0.45, h * 0.99], [R - 0.016, h * 0.96], [R, h * 0.78], [R, -h * 0.78], [R - 0.016, -h * 0.96], [rr + side * 0.45, -h * 0.99], [rr - 0.004, -h * 0.84]], segs,
      [PART.sidewall, PART.sidewall, PART.rubber, PART.rubber, PART.rubber, PART.sidewall, PART.sidewall]);
  } else {
    lathe(B, [[rr - 0.004, h * 0.86], [R - 0.02, h], [R, h * 0.6], [R, -h * 0.6], [R - 0.02, -h]], segs, [PART.sidewall, PART.rubber, PART.rubber, PART.rubber]);
  }
  const face = h * 0.84;
  const dish = w.dish ?? 0.04;
  const rFace = rr - 0.012;
  if (hi) {
    lathe(B, [[rr - 0.016, face + 0.002], [rr + 0.005, face - 0.004]], segs, PART.lip);
    lathe(B, [[rr - 0.012, -h * 0.72], [rr - 0.012, face]], segs, PART.barrel);
    const rDisc = Math.min(rr * 0.8, rr - 0.045);
    const aDisc = -h * 0.05;
    lathe(B, [[0.06, aDisc], [rDisc, aDisc]], segs, PART.disc);
    lathe(B, [[0.07, aDisc + 0.002], [0.07, face - dish - 0.03]], 12, PART.hub);
  }
  const circle = [];
  const cN = hi ? 28 : 12;
  for (let i = 0; i < cN; i++) {
    const a = (i / cN) * Math.PI * 2;
    circle.push([Math.cos(a) * rFace, Math.sin(a) * rFace]);
  }
  const rIn = rr * 0.3, rOut = rFace - 0.016;
  const holes = spokeHoles(w.style || 'five', rIn, rOut, hi);
  const front = face - 0.002, back = face - (hi ? 0.03 : 0.006);
  const slope = dish / rFace;
  const deform = (v) => {
    const r = Math.hypot(v[1], v[2]);
    const t = Math.max(0, 1 - r / rFace);
    return [v[0] - dish * Math.pow(t, 1.2), v[1], v[2]];
  };
  const capNormal = (v, n) => {
    const r = Math.hypot(v[1], v[2]) || 1;
    const t = Math.max(0, 1 - r / rFace);
    const k2 = slope * 1.2 * Math.pow(t, 0.2);
    const l = Math.hypot(1, k2);
    return [1 / l, (-k2 * v[1] / r) / l, (-k2 * v[2] / r) / l];
  };
  prism(B, circle, holes, 'x', back, front, PART.rim, { deform, capNormal, caps: [false, true], sides: hi, skipOuterSide: true });
  const capN = hi ? 16 : 8;
  const cap = [];
  for (let i = 0; i < capN; i++) {
    const a = (i / capN) * Math.PI * 2;
    cap.push([Math.cos(a) * rIn * 0.62, Math.sin(a) * rIn * 0.62]);
  }
  const capX = front - dish + 0.004;
  prism(B, cap, null, 'x', capX - 0.006, capX, PART.hub, { caps: [false, true], sides: hi });
  const spin = B.build();
  const spinTris = B.triangles;
  let caliper = null, caliperTris = 0;
  if (hi) {
    const C = new GeoBuilder();
    const rDisc = Math.min(rr * 0.8, rr - 0.045);
    const r0 = rDisc * 0.6, r1 = rDisc + 0.018;
    const mid = Math.PI * 0.32, span = 0.42;
    const pts = [];
    const n = 6;
    for (let i = 0; i <= n; i++) {
      const a = mid - span / 2 + span * i / n;
      pts.push([Math.sin(a) * r1, Math.cos(a) * r1]);
    }
    for (let i = n; i >= 0; i--) {
      const a = mid - span / 2 + span * i / n;
      pts.push([Math.sin(a) * r0, Math.cos(a) * r0]);
    }
    const aDisc = -h * 0.05;
    prism(C, pts, null, 'x', aDisc - 0.035, Math.min(aDisc + 0.034, face - dish - 0.012), PART.caliper);
    caliper = C.build();
    caliperTris = C.triangles;
  }
  return { spin, caliper, radius: R, width: W, tris: spinTris + caliperTris };
}

function decalGeometry(S, hi) {
  const b = S.b;
  const a0 = S.arches[0], a1 = S.arches[1];
  const door = b.lines && b.lines[0];
  const dc = door ? (door[0] + door[1]) / 2 : (a0.d + a1.d) / 2;
  const fine = 64, s0 = 3.9, s1 = 7.0;
  const pts = [];
  for (let i = 0; i <= fine; i++) pts.push(surf(S, dc, s0 + (s1 - s0) * i / fine, [0, 0, 0]));
  const cum = [0];
  for (let i = 1; i <= fine; i++) {
    const p = pts[i], q = pts[i - 1];
    cum.push(cum[i - 1] + Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]));
  }
  const total = cum[fine];
  const size = Math.min(0.4, total * 0.6);
  const mid = total * 0.5;
  const sAt = (len) => {
    let i = 1;
    while (i < fine && cum[i] < len) i++;
    const f = clamp((len - cum[i - 1]) / Math.max(1e-9, cum[i] - cum[i - 1]), 0, 1);
    return s0 + (s1 - s0) * (i - 1 + f) / fine;
  };
  const sa = sAt(mid - size / 2), sb = sAt(mid + size / 2);
  const q = [[dc - size / 2, sa], [dc + size / 2, sa], [dc + size / 2, sb], [dc - size / 2, sb]];
  const n = hi ? 6 : 2;
  const pos = [], nor = [], uv = [], idx = [];
  for (const sx of [1, -1]) {
    const base = pos.length / 3;
    for (let iv = 0; iv <= n; iv++) {
      for (let iu = 0; iu <= n; iu++) {
        const u = iu / n, v = iv / n;
        const [d, s] = bilinear(q, u, v);
        surf(S, d, s, pp);
        surfNormal(S, d, s, pn);
        const k = 0.006 * S.offScale;
        pos.push((pp[0] + pn[0] * k) * sx, pp[1] + pn[1] * k, pp[2] + pn[2] * k);
        nor.push(pn[0] * sx, pn[1], pn[2]);
        uv.push(sx > 0 ? 1 - u : u, v);
      }
    }
    for (let iv = 0; iv < n; iv++) {
      for (let iu = 0; iu < n; iu++) {
        const a = base + iv * (n + 1) + iu, bb = a + 1, c = a + n + 2, e = a + n + 1;
        if (sx > 0) idx.push(a, c, bb, a, e, c);
        else idx.push(a, bb, c, a, c, e);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function numberCanvas(canvas, num, ink) {
  const g = canvas.getContext('2d');
  const w = canvas.width;
  g.clearRect(0, 0, w, w);
  if (num == null || num === '') return;
  g.fillStyle = '#f3f3f0';
  g.beginPath();
  g.arc(w / 2, w / 2, w * 0.47, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = w * 0.035;
  g.strokeStyle = ink;
  g.beginPath();
  g.arc(w / 2, w / 2, w * 0.42, 0, Math.PI * 2);
  g.stroke();
  const text = String(num).slice(0, 2);
  g.fillStyle = ink;
  g.font = `900 ${Math.round(w * (text.length > 1 ? 0.48 : 0.58))}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, w * 0.535);
}

let flakeTexture = null;
let glowTexture = null;
let flameTexture = null;
let poolTexture = null;

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function flakeTex() {
  if (flakeTexture) return flakeTexture;
  const n = 128;
  const data = new Uint8Array(n * n * 4);
  let seed = 1234567;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < n * n; i++) {
    const a = rnd() * Math.PI * 2, r = Math.pow(rnd(), 0.6) * 0.55;
    const x = Math.cos(a) * r, y = Math.sin(a) * r, z = Math.sqrt(Math.max(0, 1 - x * x - y * y));
    data[i * 4] = Math.round((x * 0.5 + 0.5) * 255);
    data[i * 4 + 1] = Math.round((y * 0.5 + 0.5) * 255);
    data[i * 4 + 2] = Math.round((z * 0.5 + 0.5) * 255);
    data[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, n, n);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.channel = 1;
  t.needsUpdate = true;
  flakeTexture = t;
  return t;
}

function radialTex(size, stops) {
  const c = makeCanvas(size, size);
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) gr.addColorStop(o, col);
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function glowTex() {
  if (!glowTexture) glowTexture = radialTex(64, [[0, 'rgba(255,255,255,1)'], [0.18, 'rgba(255,255,255,0.55)'], [0.45, 'rgba(255,255,255,0.12)'], [1, 'rgba(255,255,255,0)']]);
  return glowTexture;
}

function flameTex() {
  if (flameTexture) return flameTexture;
  const c = makeCanvas(8, 128);
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 128, 0, 0);
  gr.addColorStop(0, 'rgba(235,245,255,1)');
  gr.addColorStop(0.18, 'rgba(120,190,255,0.95)');
  gr.addColorStop(0.5, 'rgba(150,90,255,0.55)');
  gr.addColorStop(0.8, 'rgba(255,90,170,0.18)');
  gr.addColorStop(1, 'rgba(255,80,160,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 8, 128);
  flameTexture = new THREE.CanvasTexture(c);
  flameTexture.colorSpace = THREE.SRGBColorSpace;
  return flameTexture;
}

function poolTex() {
  if (poolTexture) return poolTexture;
  const w = 128, h = 256;
  const c = makeCanvas(w, h);
  const g = c.getContext('2d');
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w * 2 - 1;
      const v = (y + 0.5) / h;
      const spread = 0.25 + 0.75 * v;
      let a = 0;
      for (const cx of [-0.32, 0.32]) {
        const du = (u - cx * (0.4 + 0.6 * v)) / (spread * 0.62);
        a += Math.exp(-du * du * 2.2);
      }
      a *= Math.pow(1 - v, 1.15) * Math.min(1, v * 9);
      const o = (y * w + x) * 4;
      img.data[o] = 255; img.data[o + 1] = 244; img.data[o + 2] = 225;
      img.data[o + 3] = Math.round(clamp(a * 0.75, 0, 1) * 255);
    }
  }
  g.putImageData(img, 0, 0);
  poolTexture = new THREE.CanvasTexture(c);
  poolTexture.colorSpace = THREE.SRGBColorSpace;
  return poolTexture;
}

function shadowTex(dims, wheels) {
  const w = 128, h = 256;
  const c = makeCanvas(w, h);
  const g = c.getContext('2d');
  const img = g.createImageData(w, h);
  const ext = dims.shadowExtent;
  const hx = dims.width / 2 - 0.06, hz = dims.length / 2 - 0.08, rc = 0.42;
  const zc = dims.centerZ;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = ((x + 0.5) / w * 2 - 1) * ext[0];
      const pz = ((y + 0.5) / h * 2 - 1) * ext[1] + zc;
      const qx = Math.abs(px) - (hx - rc), qz = Math.abs(pz - zc) - (hz - rc);
      const sdist = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - rc;
      let a = 0.62 * (1 - clamp((sdist + 0.12) / 0.5, 0, 1)) ** 1.6;
      for (const wh of wheels) {
        const ex = (Math.abs(px) - Math.abs(wh.x)) / (wh.w * 0.7), ez = (pz - wh.z) / (wh.r * 0.95);
        const e = Math.sqrt(ex * ex + ez * ez);
        a += 0.45 * (1 - clamp(e, 0, 1)) ** 2;
      }
      const o = (y * w + x) * 4;
      img.data[o] = 0; img.data[o + 1] = 0; img.data[o + 2] = 0;
      img.data[o + 3] = Math.round(clamp(a, 0, 0.92) * 255);
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const srgbToByte = (v) => Math.round(clamp(v, 0, 1) * 255);
const linToByte = (v) => {
  v = clamp(v, 0, 1);
  return Math.round((v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255);
};

function makeAtlas() {
  const n = COLS * ROWS * 4;
  const mk = (srgb) => {
    const t = new THREE.DataTexture(new Uint8Array(n), COLS, ROWS);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  };
  return { color: mk(true), pbr: mk(false), emissive: mk(true) };
}

function writeTexel(tex, part, r, g, b) {
  const o = part * 4;
  tex.image.data[o] = r;
  tex.image.data[o + 1] = g;
  tex.image.data[o + 2] = b;
  tex.image.data[o + 3] = 255;
}

function hexBytes(hex) {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

const geometryCache = new Map();

function hashBody(spec) {
  const s = JSON.stringify([spec.id, spec.body, spec.livery && spec.livery.stripes]);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(36);
}

function buildAssets(spec, hi) {
  const S = buildShape(spec);
  S.offScale = hi ? 1 : 2.6;
  const B = new GeoBuilder();
  const body = buildBody(S, B, hi);
  const bodyTris = B.triangles;
  addGlassAndTrim(S, B, hi);
  addLamps(S, B, hi);
  addSurfaceDetails(S, B, hi);
  addParts(S, B, hi);
  const geometry = B.build();
  const decal = decalGeometry(S, hi);
  const zOf = (d) => d - S.zShift;
  const wheels = S.arches.map((a, k) => ({ x: a.x, z: zOf(a.d), r: a.r, w: a.w, front: a.front, k }));
  const wheelGeo = [buildWheel(spec, 0, hi), buildWheel(spec, 1, hi)];
  const bb = geometry.boundingBox;
  const dims = {
    length: S.L,
    width: 2 * Math.max(body.maxX, ...wheels.map((w) => w.x + w.w / 2)),
    widthWithMirrors: bb.max.x - bb.min.x,
    height: bb.max.y,
    roofHeight: body.maxY,
    wheelbase: S.b.wheelbase,
    frontOverhang: S.dF,
    rearOverhang: S.L - S.dR,
    track: [wheels[0].x * 2, wheels[1].x * 2],
    wheelRadius: [wheels[0].r, wheels[1].r],
    wheelWidth: [wheels[0].w, wheels[1].w],
    groundClearance: Math.min(S.f.bottom(S.dF + S.b.wheelbase / 2), S.f.bottom(S.dF + 0.5)),
    front: zOf(0),
    rear: zOf(S.L),
    centerZ: (zOf(0) + zOf(S.L)) / 2
  };
  dims.shadowExtent = [dims.width / 2 + 0.35, dims.length / 2 + 0.35];
  const lp = S.b.lamps || {};
  const center = (q) => {
    if (!q) return null;
    const c = bilinear(q, 0.5, 0.5);
    const p = surf(S, c[0], c[1], [0, 0, 0]);
    const n = surfNormal(S, c[0], c[1], [0, 0, 0]);
    return [p[0] + n[0] * 0.03, p[1] + n[1] * 0.03, p[2] + n[2] * 0.03];
  };
  const glows = { head: center(lp.head), tail: center(lp.tail), brake: center(lp.brake) };
  const ex = S.b.exhaust;
  const tips = [];
  if (ex) for (const x of ex.x) { tips.push([x, ex.y, zOf(ex.d) + 0.16]); if (!ex.single) tips.push([-x, ex.y, zOf(ex.d) + 0.16]); }
  return {
    geometry,
    decal,
    wheels,
    wheelGeo,
    dims,
    glows,
    tips,
    stats: { bodyTriangles: bodyTris, carTriangles: B.triangles, stations: body.stations, rows: body.rows },
    shadow: shadowTex(dims, wheels),
    refs: 0
  };
}

function acquireAssets(spec, lod) {
  const hi = lod !== 'low';
  const key = `${hashBody(spec)}|${hi ? 'h' : 'l'}`;
  let a = geometryCache.get(key);
  if (!a) {
    a = buildAssets(spec, hi);
    a.key = key;
    geometryCache.set(key, a);
  }
  a.refs++;
  return a;
}

function releaseAssets(a) {
  a.refs--;
  if (a.refs > 0) return;
  geometryCache.delete(a.key);
  a.geometry.dispose();
  a.decal.dispose();
  for (const w of a.wheelGeo) { w.spin.dispose(); if (w.caliper) w.caliper.dispose(); }
  a.shadow.dispose();
}

function flameGeometry(tips, hi) {
  const segs = hi ? 10 : 6;
  const pos = [], uv = [], idx = [];
  for (const [x, y, z] of tips) {
    for (const [len, rad] of [[0.95, 0.07], [0.5, 0.04]]) {
      const base = pos.length / 3;
      const rings = 5;
      for (let r = 0; r <= rings; r++) {
        const t = r / rings;
        const rr = rad * (1 - t) * (0.75 + 0.6 * Math.sin(Math.PI * Math.min(1, t * 1.6)));
        for (let k = 0; k <= segs; k++) {
          const a = (k / segs) * Math.PI * 2;
          pos.push(x + Math.cos(a) * rr, y + Math.sin(a) * rr, z + t * len);
          uv.push(k / segs, 1 - t);
        }
      }
      for (let r = 0; r < rings; r++) {
        for (let k = 0; k < segs; k++) {
          const a = base + r * (segs + 1) + k, b = a + segs + 1;
          idx.push(a, b, a + 1, a + 1, b, b + 1);
        }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export function createCar(specIn, opts = {}) {
  const spec = typeof specIn === 'string' ? carById(specIn) : specIn || carById();
  const lod = opts.lod === 'low' ? 'low' : 'high';
  const hi = lod === 'high';
  const cheap = !!opts.cheap;
  const assets = acquireAssets(spec, lod);
  const group = new THREE.Group();
  group.name = `car-${spec.id}-${lod}`;
  const atlas = makeAtlas();
  const state = { head: false, brake: 0, nitro: false, reverse: false, paint: null, stripe: null };
  const setPartColor = (part, hex) => {
    const [r, g, b] = hexBytes(hex);
    writeTexel(atlas.color, part, r, g, b);
  };
  const setPartPbr = (part, rough, metal, coat) => writeTexel(atlas.pbr, part, srgbToByte(coat), srgbToByte(rough), srgbToByte(metal));
  for (const [name, part] of Object.entries(PART)) {
    const base = BASE[name];
    if (!base) continue;
    setPartColor(part, base[0]);
    setPartPbr(part, base[1], base[2], base[3]);
  }
  if (spec.rim != null) setPartColor(PART.rim, spec.rim);
  if (spec.caliper != null) setPartColor(PART.caliper, spec.caliper);
  const paintIn = opts.color ?? spec.color ?? (spec.paints && spec.paints[0]) ?? 'crimson';
  const applyPaint = (p) => {
    let def;
    if (typeof p === 'string') def = paintById(p);
    else if (typeof p === 'number') def = { hex: p, metal: state.paint ? state.paint.metal : 0.6, rough: state.paint ? state.paint.rough : 0.32 };
    else def = { hex: p.hex ?? 0x9a0a14, metal: p.metal ?? 0.6, rough: p.rough ?? 0.32 };
    state.paint = def;
    setPartColor(PART.paint, def.hex);
    setPartPbr(PART.paint, cheap ? def.rough * 0.55 : def.rough, def.metal, 1);
    if (state.stripe == null) setPartColor(PART.stripe, def.hex);
    atlas.color.needsUpdate = true;
    atlas.pbr.needsUpdate = true;
  };
  const applyStripe = (hex) => {
    state.stripe = hex;
    setPartColor(PART.stripe, hex == null ? state.paint.hex : hex);
    atlas.color.needsUpdate = true;
  };
  applyPaint(paintIn);
  const liveryColor = opts.stripeColor !== undefined ? opts.stripeColor : spec.livery ? spec.livery.color : null;
  if (liveryColor != null) applyStripe(liveryColor);
  const writeEmissive = () => {
    const e = atlas.emissive;
    const set = (part, r, g, b) => writeTexel(e, part, linToByte(r), linToByte(g), linToByte(b));
    const head = state.head ? 1 : 0;
    set(PART.lamp, 0.62 * head, 0.66 * head, 0.72 * head);
    const drl = state.head ? 0.6 : 0.3;
    set(PART.drl, drl * 0.92, drl * 0.96, drl);
    const tail = state.brake > 0 ? 0.32 + 0.3 * state.brake : state.head ? 0.17 : 0.05;
    set(PART.tail, tail, tail * 0.04, tail * 0.05);
    const br = state.brake;
    set(PART.brake, 0.7 * br, 0.02 * br, 0.03 * br);
    const nz = state.nitro ? 1 : 0;
    set(PART.nozzle, 0.25 * nz, 0.6 * nz, 1.0 * nz);
    e.needsUpdate = true;
  };
  writeEmissive();
  const shared = {
    color: 0xffffff,
    map: atlas.color,
    roughness: 1,
    roughnessMap: atlas.pbr,
    metalness: 1,
    metalnessMap: atlas.pbr,
    emissive: 0xffffff,
    emissiveMap: atlas.emissive,
    emissiveIntensity: EMISSIVE_GAIN,
    envMapIntensity: opts.envMapIntensity ?? 1
  };
  const material = cheap
    ? new THREE.MeshStandardMaterial(shared)
    : new THREE.MeshPhysicalMaterial({
      ...shared,
      clearcoat: 1,
      clearcoatMap: atlas.pbr,
      clearcoatRoughness: 0.035,
      normalMap: hi ? flakeTex() : null,
      normalScale: new THREE.Vector2(0.07, 0.07)
    });
  if (opts.envMap) material.envMap = opts.envMap;
  material.name = 'car-atlas';
  const body = new THREE.Mesh(assets.geometry, material);
  body.name = 'car-body';
  body.castShadow = opts.castShadow !== false;
  body.receiveShadow = opts.receiveShadow !== false;
  group.add(body);
  const wheels = [];
  const order = [[0, 1], [0, -1], [1, 1], [1, -1]];
  for (const [k, sx] of order) {
    const wd = assets.wheels[k];
    const wg = assets.wheelGeo[k];
    const pivot = new THREE.Group();
    pivot.name = `wheel-${k ? 'rear' : 'front'}-${sx > 0 ? 'right' : 'left'}`;
    pivot.position.set(wd.x * sx, wd.r, wd.z);
    const spin = new THREE.Group();
    const mesh = new THREE.Mesh(wg.spin, material);
    mesh.scale.x = sx;
    mesh.castShadow = body.castShadow;
    mesh.receiveShadow = body.receiveShadow;
    spin.add(mesh);
    pivot.add(spin);
    if (wg.caliper) {
      const cal = new THREE.Mesh(wg.caliper, material);
      cal.scale.x = sx;
      pivot.add(cal);
    }
    group.add(pivot);
    wheels.push({ pivot, spin, front: k === 0, side: sx, radius: wd.r, base: pivot.position.clone() });
  }
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, map: assets.shadow, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false });
  const shadowGeo = new THREE.PlaneGeometry(assets.dims.shadowExtent[0] * 2, assets.dims.shadowExtent[1] * 2);
  shadowGeo.rotateX(-Math.PI / 2);
  const shadow = new THREE.Mesh(shadowGeo, shadowMat);
  shadow.position.set(0, 0.006, assets.dims.centerZ);
  shadow.renderOrder = -1;
  shadow.name = 'car-contact-shadow';
  if (opts.contactShadow !== false) group.add(shadow);
  const glowPos = [], glowCol = [];
  const glowSlots = {};
  const pushGlow = (name, p) => {
    if (!p) return;
    glowSlots[name] = glowSlots[name] || [];
    for (const sx of [1, -1]) {
      glowSlots[name].push(glowPos.length / 3);
      glowPos.push(p[0] * sx, p[1], p[2]);
      glowCol.push(0, 0, 0);
    }
  };
  pushGlow('head', assets.glows.head);
  pushGlow('tail', assets.glows.tail);
  const glowGeo = new THREE.BufferGeometry();
  glowGeo.setAttribute('position', new THREE.Float32BufferAttribute(glowPos, 3));
  glowGeo.setAttribute('color', new THREE.Float32BufferAttribute(glowCol, 3));
  const glowMat = new THREE.PointsMaterial({ size: hi ? 0.55 : 0.65, map: glowTex(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, toneMapped: false });
  const glows = new THREE.Points(glowGeo, glowMat);
  glows.name = 'car-lamp-glow';
  glows.frustumCulled = false;
  glows.visible = false;
  group.add(glows);
  const poolMat = new THREE.MeshBasicMaterial({ map: poolTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.3, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, toneMapped: false });
  const poolGeo = new THREE.PlaneGeometry(7, 16);
  poolGeo.rotateX(-Math.PI / 2);
  const pool = new THREE.Mesh(poolGeo, poolMat);
  pool.position.set(0, 0.012, assets.dims.front - 8.1);
  pool.rotation.y = Math.PI;
  pool.visible = false;
  pool.name = 'car-headlight-pool';
  if (opts.lightPool !== false) group.add(pool);
  let flames = null;
  if (assets.tips.length) {
    const flameMat = new THREE.MeshBasicMaterial({ map: flameTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false });
    flames = new THREE.Mesh(flameGeometry(assets.tips, hi), flameMat);
    flames.visible = false;
    flames.name = 'car-nitro-flames';
    flames.frustumCulled = false;
    const tips = assets.tips;
    flames.onBeforeRender = () => {
      const t = performance.now() * 0.001;
      const f = 0.82 + 0.22 * Math.sin(t * 61) * Math.sin(t * 23 + 1.3) + 0.08 * Math.sin(t * 137);
      flames.scale.set(1, 1, f);
      if (tips.length) flames.position.z = tips[0][2] * (1 - f);
      flames.updateMatrixWorld();
    };
    group.add(flames);
  }
  let decal = null, decalTex = null, decalCanvas = null;
  const applyNumber = (num) => {
    if (num == null || num === '') {
      if (decal) decal.visible = false;
      return;
    }
    if (!decal) {
      decalCanvas = makeCanvas(hi ? 128 : 64, hi ? 128 : 64);
      decalTex = new THREE.CanvasTexture(decalCanvas);
      decalTex.colorSpace = THREE.SRGBColorSpace;
      decalTex.anisotropy = 4;
      const decalMat = new THREE.MeshPhysicalMaterial({ map: decalTex, transparent: true, depthWrite: false, roughness: 0.35, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      if (opts.envMap) decalMat.envMap = opts.envMap;
      decal = new THREE.Mesh(assets.decal, decalMat);
      decal.name = 'car-number';
      group.add(decal);
    }
    numberCanvas(decalCanvas, num, '#111214');
    decalTex.needsUpdate = true;
    decal.visible = true;
  };
  const startNumber = opts.number !== undefined ? opts.number : spec.livery ? spec.livery.number : null;
  if (startNumber != null) applyNumber(startNumber);
  const updateGlows = () => {
    const col = glowGeo.getAttribute('color');
    const head = state.head ? 1 : 0;
    for (const i of glowSlots.head || []) col.setXYZ(i, 0.55 * head, 0.57 * head, 0.6 * head);
    const tail = state.brake > 0 ? 0.2 + 0.22 * state.brake : state.head ? 0.12 : 0;
    for (const i of glowSlots.tail || []) col.setXYZ(i, tail, tail * 0.05, tail * 0.06);
    col.needsUpdate = true;
    glows.visible = state.head || state.brake > 0;
  };
  const steerState = { angle: 0 };
  const track = assets.dims.track[0], wb = assets.dims.wheelbase;
  const api = {
    group,
    wheels,
    dims: assets.dims,
    spec,
    lod,
    material,
    shadow,
    stats: {
      triangles: assets.stats.carTriangles + 4 * assets.wheelGeo.reduce((s, w) => s + w.tris, 0) / 2,
      bodyTriangles: assets.stats.bodyTriangles,
      drawCalls: 1 + 4 + (hi ? 4 : 0) + (opts.contactShadow !== false ? 1 : 0)
    },
    setSteer(rad) {
      steerState.angle = rad;
      const a = Math.abs(rad);
      if (a < 1e-5) { for (const w of wheels) if (w.front) w.pivot.rotation.y = 0; return; }
      const R = wb / Math.tan(a);
      const inner = Math.atan(wb / Math.max(0.1, R - track / 2));
      const outer = Math.atan(wb / (R + track / 2));
      const left = rad > 0;
      for (const w of wheels) {
        if (!w.front) continue;
        const isInner = left ? w.side < 0 : w.side > 0;
        w.pivot.rotation.y = Math.sign(rad) * (isInner ? inner : outer);
      }
    },
    setSpin(rad) {
      for (const w of wheels) w.spin.rotation.x = -rad;
    },
    setBrake(b) {
      const v = typeof b === 'number' ? clamp(b, 0, 1) : b ? 1 : 0;
      if (v === state.brake) return;
      state.brake = v;
      writeEmissive();
      updateGlows();
    },
    setNitro(b) {
      const v = !!b;
      if (v === state.nitro) return;
      state.nitro = v;
      if (flames) flames.visible = v;
      writeEmissive();
    },
    setHeadlights(b) {
      const v = !!b;
      if (v === state.head) return;
      state.head = v;
      pool.visible = v;
      writeEmissive();
      updateGlows();
    },
    setColor(c) {
      applyPaint(c);
    },
    setStripe(hex) {
      applyStripe(hex);
    },
    setNumber(num) {
      applyNumber(num);
    },
    setEnvMap(tex, intensity) {
      material.envMap = tex || null;
      if (intensity != null) material.envMapIntensity = intensity;
      material.needsUpdate = true;
      if (decal) { decal.material.envMap = tex || null; decal.material.needsUpdate = true; }
    },
    setShadowStrength(v) {
      shadowMat.opacity = clamp(v, 0, 1);
      shadow.visible = v > 0.01;
    },
    dispose() {
      group.removeFromParent();
      material.dispose();
      atlas.color.dispose();
      atlas.pbr.dispose();
      atlas.emissive.dispose();
      shadowMat.dispose();
      shadowGeo.dispose();
      glowGeo.dispose();
      glowMat.dispose();
      poolGeo.dispose();
      poolMat.dispose();
      if (flames) { flames.geometry.dispose(); flames.material.dispose(); }
      if (decal) { decal.material.dispose(); decalTex.dispose(); }
      releaseAssets(assets);
    }
  };
  updateGlows();
  return api;
}

export function createCarLOD(spec, opts = {}) {
  const near = createCar(spec, { ...opts, lod: 'high' });
  const far = createCar(spec, { ...opts, lod: 'low' });
  const lod = new THREE.LOD();
  lod.name = `car-lod-${near.spec.id}`;
  lod.addLevel(near.group, 0);
  lod.addLevel(far.group, opts.lodDistance ?? 30);
  const both = (fn) => (...args) => { near[fn](...args); far[fn](...args); };
  return {
    group: lod,
    levels: [near, far],
    wheels: near.wheels,
    dims: near.dims,
    spec: near.spec,
    setSteer: both('setSteer'),
    setSpin: both('setSpin'),
    setBrake: both('setBrake'),
    setNitro: both('setNitro'),
    setHeadlights: both('setHeadlights'),
    setColor: both('setColor'),
    setStripe: both('setStripe'),
    setNumber: both('setNumber'),
    setEnvMap: both('setEnvMap'),
    setShadowStrength: both('setShadowStrength'),
    dispose() {
      lod.removeFromParent();
      near.dispose();
      far.dispose();
    }
  };
}

export function carStats(specIn, lod = 'high') {
  const spec = typeof specIn === 'string' ? carById(specIn) : specIn;
  const a = acquireAssets(spec, lod);
  const out = { ...a.stats, dims: a.dims, wheelTriangles: a.wheelGeo.map((w) => w.tris) };
  releaseAssets(a);
  return out;
}

