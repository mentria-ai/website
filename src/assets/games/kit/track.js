import { clamp, lerp, smoothstep, wrapAngle, mulberry32 } from './math.js';

const TRACK_DEG = Math.PI / 180;
const TRACK_CELL = 20;

function trackCellKey(cx, cz) {
  return (cx + 4096) * 8192 + (cz + 4096);
}

function crKnot(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  return Math.max(Math.pow(dx * dx + dy * dy + dz * dz, 0.25), 1e-4);
}

function crEval(p0, p1, p2, p3, t0, t1, t2, t3, t, key) {
  const a1 = ((t1 - t) * p0[key] + (t - t0) * p1[key]) / (t1 - t0);
  const a2 = ((t2 - t) * p1[key] + (t - t1) * p2[key]) / (t2 - t1);
  const a3 = ((t3 - t) * p2[key] + (t - t2) * p3[key]) / (t3 - t2);
  const b1 = ((t2 - t) * a1 + (t - t0) * a2) / (t2 - t0);
  const b2 = ((t3 - t) * a2 + (t - t1) * a3) / (t3 - t1);
  return ((t2 - t) * b1 + (t - t1) * b2) / (t2 - t1);
}

export function makeTrackSample() {
  return {
    s: 0,
    pos: { x: 0, y: 0, z: 0 },
    tangent: { x: 0, y: 0, z: -1 },
    up: { x: 0, y: 1, z: 0 },
    right: { x: 1, y: 0, z: 0 },
    rightFlat: { x: 1, y: 0, z: 0 },
    normal: null,
    width: 14,
    bank: 0,
    curvature: 0,
    grade: 0,
    heading: 0
  };
}

function normalizeRanges(list, length) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((r) => r && r.s1 > r.s0)
    .map((r) => Object.assign({}, r, { s0: clamp(r.s0, 0, length), s1: clamp(r.s1, 0, length) }))
    .sort((a, b) => a.s0 - b.s0);
}

export function createTrack(def, opts = {}) {
  const pts = def.points;
  const n = pts.length;
  if (!Array.isArray(pts) || n < 4) throw new Error('track needs at least 4 points');
  const step = opts.step || 1;
  const P = pts.map((p) => ({ x: p[0], y: p[1], z: p[2] }));
  const Wd = pts.map((p) => (p[3] == null ? 14 : p[3]));
  const Bd = pts.map((p) => (p[4] || 0) * TRACK_DEG);

  const dX = [], dY = [], dZ = [], dW = [], dB = [], dL = [];
  const pointS = new Float64Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const p0 = P[(i - 1 + n) % n], p1 = P[i], p2 = P[(i + 1) % n], p3 = P[(i + 2) % n];
    const t0 = 0;
    const t1 = t0 + crKnot(p0, p1);
    const t2 = t1 + crKnot(p1, p2);
    const t3 = t2 + crKnot(p2, p3);
    const chord = Math.hypot(p2.x - p1.x, p2.y - p1.y, p2.z - p1.z);
    const m = Math.max(6, Math.ceil(chord / 0.4));
    const w0 = Wd[i], w1 = Wd[(i + 1) % n];
    const b0 = Bd[i], b1 = Bd[(i + 1) % n];
    for (let j = 0; j < m; j++) {
      const u = j / m;
      const t = t1 + (t2 - t1) * u;
      const x = crEval(p0, p1, p2, p3, t0, t1, t2, t3, t, 'x');
      const y = crEval(p0, p1, p2, p3, t0, t1, t2, t3, t, 'y');
      const z = crEval(p0, p1, p2, p3, t0, t1, t2, t3, t, 'z');
      if (dX.length) {
        const k = dX.length - 1;
        acc += Math.hypot(x - dX[k], y - dY[k], z - dZ[k]);
      }
      if (j === 0) pointS[i] = acc;
      const e = smoothstep(0, 1, u);
      dX.push(x); dY.push(y); dZ.push(z);
      dW.push(lerp(w0, w1, e)); dB.push(lerp(b0, b1, e)); dL.push(acc);
    }
  }
  const M = dX.length;
  const length = acc + Math.hypot(dX[0] - dX[M - 1], dY[0] - dY[M - 1], dZ[0] - dZ[M - 1]);
  const N = Math.max(16, Math.round(length / step));
  const ds = length / N;

  const X = new Float64Array(N), Y = new Float64Array(N), Z = new Float64Array(N);
  const WID = new Float64Array(N), BNK = new Float64Array(N);
  let j = 0;
  for (let k = 0; k < N; k++) {
    const s = k * ds;
    while (j + 1 < M && dL[j + 1] <= s) j++;
    const nx = j + 1 < M ? j + 1 : 0;
    const segEnd = j + 1 < M ? dL[j + 1] : length;
    const f = clamp((s - dL[j]) / Math.max(segEnd - dL[j], 1e-9), 0, 1);
    X[k] = lerp(dX[j], dX[nx], f);
    Y[k] = lerp(dY[j], dY[nx], f);
    Z[k] = lerp(dZ[j], dZ[nx], f);
    WID[k] = lerp(dW[j], dW[nx], f);
    BNK[k] = lerp(dB[j], dB[nx], f);
  }

  const HEAD = new Float64Array(N);
  const TX = new Float64Array(N), TY = new Float64Array(N), TZ = new Float64Array(N);
  const UX = new Float64Array(N), UY = new Float64Array(N), UZ = new Float64Array(N);
  const RX = new Float64Array(N), RY = new Float64Array(N), RZ = new Float64Array(N);
  const CURV = new Float64Array(N), GRADE = new Float64Array(N);
  for (let k = 0; k < N; k++) {
    const a = k + 1 === N ? 0 : k + 1;
    const b = k === 0 ? N - 1 : k - 1;
    let tx = X[a] - X[b], ty = Y[a] - Y[b], tz = Z[a] - Z[b];
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl; ty /= tl; tz /= tl;
    TX[k] = tx; TY[k] = ty; TZ[k] = tz;
    const hl = Math.hypot(tx, tz) || 1e-9;
    GRADE[k] = ty / hl;
    const psi = Math.atan2(-tx, -tz);
    HEAD[k] = psi;
    const rfx = Math.cos(psi), rfz = -Math.sin(psi);
    let ux = -rfz * ty;
    let uy = rfz * tx - rfx * tz;
    let uz = rfx * ty;
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul; uy /= ul; uz /= ul;
    const cb = Math.cos(BNK[k]), sb = Math.sin(BNK[k]);
    RX[k] = rfx * cb + ux * sb;
    RY[k] = uy * sb;
    RZ[k] = rfz * cb + uz * sb;
    UX[k] = ux * cb - rfx * sb;
    UY[k] = uy * cb;
    UZ[k] = uz * cb - rfz * sb;
  }
  const rawCurv = new Float64Array(N);
  for (let k = 0; k < N; k++) {
    const a = k + 1 === N ? 0 : k + 1;
    const b = k === 0 ? N - 1 : k - 1;
    rawCurv[k] = wrapAngle(HEAD[a] - HEAD[b]) / (2 * ds);
  }
  const win = Math.max(1, Math.round(3 / ds));
  for (let k = 0; k < N; k++) {
    let sum = 0;
    for (let o = -win; o <= win; o++) sum += rawCurv[(k + o + N) % N];
    CURV[k] = sum / (2 * win + 1);
  }

  const ramps = normalizeRanges(def.ramps, length).map((r) => Object.assign({ height: 1.6 }, r));
  const tunnels = normalizeRanges(def.tunnels, length).map((r) => Object.assign({ height: 7.5 }, r));
  const edgeDefault = Object.assign({ left: 'barrier', right: 'barrier' }, def.edge || {});
  const edges = normalizeRanges(def.edges, length);

  function wrapS(s) {
    const r = s % length;
    return r < 0 ? r + length : r;
  }

  function deltaS(a, b) {
    let d = (b - a) % length;
    if (d > length / 2) d -= length;
    else if (d < -length / 2) d += length;
    return d;
  }

  function idxOf(s) {
    let u = s / ds;
    u -= Math.floor(u / N) * N;
    return u;
  }

  function sample(s, out) {
    const o = out || makeTrackSample();
    const u = idxOf(s);
    let i = Math.floor(u);
    if (i >= N) i = N - 1;
    const f = u - i;
    const a = i + 1 === N ? 0 : i + 1;
    o.s = u * ds;
    o.pos.x = X[i] + (X[a] - X[i]) * f;
    o.pos.y = Y[i] + (Y[a] - Y[i]) * f;
    o.pos.z = Z[i] + (Z[a] - Z[i]) * f;
    let x = TX[i] + (TX[a] - TX[i]) * f, y = TY[i] + (TY[a] - TY[i]) * f, z = TZ[i] + (TZ[a] - TZ[i]) * f;
    let l = Math.hypot(x, y, z) || 1;
    o.tangent.x = x / l; o.tangent.y = y / l; o.tangent.z = z / l;
    x = UX[i] + (UX[a] - UX[i]) * f; y = UY[i] + (UY[a] - UY[i]) * f; z = UZ[i] + (UZ[a] - UZ[i]) * f;
    l = Math.hypot(x, y, z) || 1;
    o.up.x = x / l; o.up.y = y / l; o.up.z = z / l;
    x = RX[i] + (RX[a] - RX[i]) * f; y = RY[i] + (RY[a] - RY[i]) * f; z = RZ[i] + (RZ[a] - RZ[i]) * f;
    l = Math.hypot(x, y, z) || 1;
    o.right.x = x / l; o.right.y = y / l; o.right.z = z / l;
    const h = HEAD[i] + wrapAngle(HEAD[a] - HEAD[i]) * f;
    o.heading = wrapAngle(h);
    o.rightFlat.x = Math.cos(h); o.rightFlat.y = 0; o.rightFlat.z = -Math.sin(h);
    o.normal = o.up;
    o.width = WID[i] + (WID[a] - WID[i]) * f;
    o.bank = BNK[i] + (BNK[a] - BNK[i]) * f;
    o.curvature = CURV[i] + (CURV[a] - CURV[i]) * f;
    o.grade = GRADE[i] + (GRADE[a] - GRADE[i]) * f;
    return o;
  }

  function rampAt(s) {
    const w = wrapS(s);
    for (let i = 0; i < ramps.length; i++) {
      const r = ramps[i];
      if (w >= r.s0 && w <= r.s1) return r;
    }
    return null;
  }

  function rampHeight(s) {
    const r = rampAt(s);
    if (!r) return 0;
    const u = (wrapS(s) - r.s0) / (r.s1 - r.s0);
    return r.height * u * u;
  }

  function rampSlope(s) {
    const r = rampAt(s);
    if (!r) return 0;
    const u = (wrapS(s) - r.s0) / (r.s1 - r.s0);
    return 2 * r.height * u / (r.s1 - r.s0);
  }

  function tunnelAt(s) {
    const w = wrapS(s);
    for (let i = 0; i < tunnels.length; i++) {
      const t = tunnels[i];
      if (w >= t.s0 && w <= t.s1) return t;
    }
    return null;
  }

  function edgeAt(s, side) {
    const w = wrapS(s);
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      if (w >= e.s0 && w <= e.s1 && e[side]) return e[side];
    }
    return edgeDefault[side];
  }

  function widthAt(s) {
    const u = idxOf(s);
    const i = Math.min(N - 1, Math.floor(u));
    const a = i + 1 === N ? 0 : i + 1;
    return WID[i] + (WID[a] - WID[i]) * (u - i);
  }

  function curvatureAt(s) {
    const u = idxOf(s);
    const i = Math.min(N - 1, Math.floor(u));
    const a = i + 1 === N ? 0 : i + 1;
    return CURV[i] + (CURV[a] - CURV[i]) * (u - i);
  }

  function surfaceY(s, lateral) {
    const u = idxOf(s);
    const i = Math.min(N - 1, Math.floor(u));
    const f = u - i;
    const a = i + 1 === N ? 0 : i + 1;
    const y = Y[i] + (Y[a] - Y[i]) * f;
    const ry = RY[i] + (RY[a] - RY[i]) * f;
    const uy = UY[i] + (UY[a] - UY[i]) * f;
    return y + ry * lateral + rampHeight(s) * uy;
  }

  const grid = new Map();
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let k = 0; k < N; k++) {
    const key = trackCellKey(Math.floor(X[k] / TRACK_CELL), Math.floor(Z[k] / TRACK_CELL));
    let list = grid.get(key);
    if (!list) { list = []; grid.set(key, list); }
    list.push(k);
    if (X[k] < minX) minX = X[k];
    if (X[k] > maxX) maxX = X[k];
    if (Z[k] < minZ) minZ = Z[k];
    if (Z[k] > maxZ) maxZ = Z[k];
    if (Y[k] < minY) minY = Y[k];
    if (Y[k] > maxY) maxY = Y[k];
  }

  function dist2(k, x, y, z) {
    const ax = x - X[k], ay = y - Y[k], az = z - Z[k];
    return ax * ax + az * az + 0.25 * ay * ay;
  }

  function nearestIndex(x, y, z) {
    const cx = Math.floor(x / TRACK_CELL), cz = Math.floor(z / TRACK_CELL);
    let best = -1, bestD = Infinity;
    for (let r = 0; r < 40; r++) {
      for (let gx = cx - r; gx <= cx + r; gx++) {
        for (let gz = cz - r; gz <= cz + r; gz++) {
          if (r > 0 && gx > cx - r && gx < cx + r && gz > cz - r && gz < cz + r) continue;
          const list = grid.get(trackCellKey(gx, gz));
          if (!list) continue;
          for (let q = 0; q < list.length; q++) {
            const d = dist2(list[q], x, y, z);
            if (d < bestD) { bestD = d; best = list[q]; }
          }
        }
      }
      if (best >= 0 && (r * TRACK_CELL) * (r * TRACK_CELL) > bestD) break;
    }
    if (best < 0) {
      for (let k = 0; k < N; k++) {
        const d = dist2(k, x, y, z);
        if (d < bestD) { bestD = d; best = k; }
      }
    }
    return best;
  }

  const projTmp = makeTrackSample();

  function project(p, hintS, out) {
    const o = out || { s: 0, lateral: 0, height: 0 };
    const py = p.y == null ? 0 : p.y;
    let i = (hintS == null || hintS !== hintS) ? nearestIndex(p.x, py, p.z) : Math.round(idxOf(hintS)) % N;
    let d = dist2(i, p.x, py, p.z);
    for (let it = 0; it < 2048; it++) {
      const a = i + 1 === N ? 0 : i + 1;
      const da = dist2(a, p.x, py, p.z);
      if (da < d) { i = a; d = da; continue; }
      const b = i === 0 ? N - 1 : i - 1;
      const db = dist2(b, p.x, py, p.z);
      if (db < d) { i = b; d = db; continue; }
      break;
    }
    const a = i + 1 === N ? 0 : i + 1;
    let ex = X[a] - X[i], ez = Z[a] - Z[i];
    let t = ((p.x - X[i]) * ex + (p.z - Z[i]) * ez) / Math.max(ex * ex + ez * ez, 1e-9);
    let s;
    if (t >= 0) s = (i + Math.min(t, 1)) * ds;
    else {
      const b = i === 0 ? N - 1 : i - 1;
      ex = X[i] - X[b]; ez = Z[i] - Z[b];
      t = ((p.x - X[b]) * ex + (p.z - Z[b]) * ez) / Math.max(ex * ex + ez * ez, 1e-9);
      s = (b + clamp(t, 0, 1)) * ds;
    }
    s = wrapS(s);
    sample(s, projTmp);
    const rx = p.x - projTmp.pos.x, ry = py - projTmp.pos.y, rz = p.z - projTmp.pos.z;
    o.s = s;
    o.lateral = rx * projTmp.right.x + ry * projTmp.right.y + rz * projTmp.right.z;
    o.height = rx * projTmp.up.x + ry * projTmp.up.y + rz * projTmp.up.z;
    return o;
  }

  function progress(s) {
    return wrapS(s) / length;
  }

  function pointAt(s, lateral, lift, out) {
    const o = out || { x: 0, y: 0, z: 0 };
    sample(s, projTmp);
    const h = (lift || 0) + rampHeight(s);
    o.x = projTmp.pos.x + projTmp.right.x * lateral + projTmp.up.x * h;
    o.y = projTmp.pos.y + projTmp.right.y * lateral + projTmp.up.y * h;
    o.z = projTmp.pos.z + projTmp.right.z * lateral + projTmp.up.z * h;
    return o;
  }

  function checkpoints(count) {
    const c = Math.max(2, count || Math.max(6, Math.round(length / 280)));
    const out = [];
    for (let k = 0; k < c; k++) {
      let s = (k * length) / c;
      if (k > 0) {
        for (let guard = 0; guard < 40 && (rampAt(s) || rampAt(s - 140)); guard++) s = wrapS(s + 10);
      }
      const sm = sample(s);
      out.push({
        s,
        pos: { x: sm.pos.x + sm.up.x * 4, y: sm.pos.y + sm.up.y * 4, z: sm.pos.z + sm.up.z * 4 },
        normal: { x: sm.tangent.x, y: sm.tangent.y, z: sm.tangent.z },
        halfW: sm.width / 2 + 2,
        halfH: 10
      });
    }
    return out;
  }

  function startGrid(count, o = {}) {
    const lead = o.lead == null ? 9 : o.lead;
    const rowGap = o.rowGap == null ? 10 : o.rowGap;
    const stagger = o.stagger == null ? 4.5 : o.stagger;
    const out = [];
    for (let i = 0; i < count; i++) {
      const row = Math.floor(i / 2);
      const col = i % 2;
      const s = wrapS(-(lead + row * rowGap + col * stagger));
      const sm = sample(s);
      const lat = (col === 0 ? -1 : 1) * sm.width * 0.22;
      const pos = pointAt(s, lat, 0);
      out.push({ s, lateral: lat, pos, yaw: sm.heading });
    }
    return out;
  }

  function minimap(count) {
    const c = Math.max(32, count || 240);
    const raw = [];
    for (let k = 0; k < c; k++) {
      const u = Math.floor((k * N) / c);
      raw.push([X[u], Z[u]]);
    }
    const span = Math.max(maxX - minX, maxZ - minZ) || 1;
    const offX = (span - (maxX - minX)) / 2;
    const offZ = (span - (maxZ - minZ)) / 2;
    function toMap(x, z) {
      return [(x - minX + offX) / span, (z - minZ + offZ) / span];
    }
    return {
      points: raw.map((p) => toMap(p[0], p[1])),
      world: raw,
      bounds: { minX, maxX, minZ, maxZ },
      toMap
    };
  }

  const reachGrids = new Map();

  function reachGrid(reach) {
    const key = Math.round(reach);
    if (reachGrids.has(key)) return reachGrids.get(key);
    const g = new Map();
    const stride = Math.max(1, Math.round(2 / ds));
    for (let k = 0; k < N; k += stride) {
      const r = WID[k] / 2 + reach + TRACK_CELL;
      const x0 = Math.floor((X[k] - r) / TRACK_CELL), x1 = Math.floor((X[k] + r) / TRACK_CELL);
      const z0 = Math.floor((Z[k] - r) / TRACK_CELL), z1 = Math.floor((Z[k] + r) / TRACK_CELL);
      for (let gx = x0; gx <= x1; gx++) {
        for (let gz = z0; gz <= z1; gz++) {
          const ck = trackCellKey(gx, gz);
          let list = g.get(ck);
          if (!list) { list = []; g.set(ck, list); }
          list.push(k);
        }
      }
    }
    reachGrids.set(key, g);
    return g;
  }

  const nearTmp = makeTrackSample();

  function nearestFlat(x, z, reach, out) {
    const g = reachGrid(reach);
    const list = g.get(trackCellKey(Math.floor(x / TRACK_CELL), Math.floor(z / TRACK_CELL)));
    if (!list) return null;
    let best = -1, bestD = Infinity;
    for (let q = 0; q < list.length; q++) {
      const k = list[q];
      const ax = x - X[k], az = z - Z[k];
      const d = ax * ax + az * az;
      if (d < bestD) { bestD = d; best = k; }
    }
    if (best < 0) return null;
    let i = best;
    for (let it = 0; it < 8; it++) {
      const a = i + 1 === N ? 0 : i + 1;
      const b = i === 0 ? N - 1 : i - 1;
      const da = (x - X[a]) ** 2 + (z - Z[a]) ** 2;
      const db = (x - X[b]) ** 2 + (z - Z[b]) ** 2;
      const di = (x - X[i]) ** 2 + (z - Z[i]) ** 2;
      if (da < di) i = a;
      else if (db < di) i = b;
      else break;
    }
    const a = i + 1 === N ? 0 : i + 1;
    let ex = X[a] - X[i], ez = Z[a] - Z[i];
    let t = ((x - X[i]) * ex + (z - Z[i]) * ez) / Math.max(ex * ex + ez * ez, 1e-9);
    let s;
    if (t >= 0) s = (i + Math.min(t, 1)) * ds;
    else {
      const b = i === 0 ? N - 1 : i - 1;
      ex = X[i] - X[b]; ez = Z[i] - Z[b];
      t = ((x - X[b]) * ex + (z - Z[b]) * ez) / Math.max(ex * ex + ez * ez, 1e-9);
      s = (b + clamp(t, 0, 1)) * ds;
    }
    s = wrapS(s);
    sample(s, nearTmp);
    const latH = (x - nearTmp.pos.x) * nearTmp.rightFlat.x + (z - nearTmp.pos.z) * nearTmp.rightFlat.z;
    const cb = Math.cos(nearTmp.bank);
    const halfH = (nearTmp.width / 2) * cb;
    const o = out || {};
    o.s = s;
    o.lateralFlat = latH;
    o.edgeDist = Math.abs(latH) - halfH;
    o.halfWidthFlat = halfH;
    o.roadY = nearTmp.pos.y + Math.tan(nearTmp.bank) * clamp(latH, -halfH, halfH);
    o.width = nearTmp.width;
    return o;
  }

  function nearest(x, z, reach) {
    return nearestFlat(x, z, reach == null ? 60 : reach);
  }

  function tunnelRidge(s) {
    let best = 0;
    for (let i = 0; i < tunnels.length; i++) {
      const t = tunnels[i];
      const w = wrapS(s);
      const along = w < t.s0 ? t.s0 - w : w > t.s1 ? w - t.s1 : 0;
      if (along > 45) continue;
      const v = ((t.height || 7.5) + 2.4) * (1 - smoothstep(0, 45, along));
      if (v > best) best = v;
    }
    return best;
  }

  function terrainModify(o = {}) {
    const shoulder = o.shoulder == null ? 5 : o.shoulder;
    const blend = o.blend == null ? 38 : o.blend;
    const drop = o.drop == null ? 0.45 : o.drop;
    const tunnelShoulder = o.tunnelShoulder == null ? 6 : o.tunnelShoulder;
    const tunnelBlend = o.tunnelBlend == null ? 12 : o.tunnelBlend;
    const ridgeReach = o.ridgeReach == null ? 70 : o.ridgeReach;
    const reach = Math.max(shoulder + blend, tunnelShoulder + ridgeReach) + 2;
    const tmp = {};
    reachGrid(reach);
    return function modifyTerrainForTrack(x, z, h) {
      const r = nearestFlat(x, z, reach, tmp);
      if (!r) return h;
      const tun = tunnels.length ? tunnelAt(r.s) : null;
      const sh = tun ? tunnelShoulder : shoulder;
      const bl = tun ? tunnelBlend : blend;
      const target = r.roadY - drop;
      let out;
      if (r.edgeDist <= sh) out = target;
      else {
        const d = r.edgeDist - sh;
        out = d >= bl ? h : lerp(target, h, smoothstep(0, bl, d));
        if (tunnels.length) {
          const ridge = tunnelRidge(r.s);
          if (ridge > 0) {
            const rise = tun ? 1 : smoothstep(0, 6, d);
            out = Math.max(out, r.roadY + ridge * rise * (1 - smoothstep(0, ridgeReach, d)));
          }
        }
      }
      return out;
    };
  }

  function clearOfRoad(x, z, clearance) {
    const r = nearestFlat(x, z, clearance + 4);
    return !r || r.edgeDist > clearance;
  }

  function layoutScenery(rules, seed) {
    return layoutTrackScenery(api, rules || {}, seed == null ? 1 : seed);
  }

  const api = {
    id: def.id,
    def,
    length,
    count: N,
    ds,
    pointS,
    ramps,
    tunnels,
    edges,
    edgeDefault,
    bounds: { minX, maxX, minY, maxY, minZ, maxZ },
    wrapS,
    deltaS,
    sample,
    project,
    progress,
    surfaceY,
    pointAt,
    widthAt,
    curvatureAt,
    rampAt,
    rampHeight,
    rampSlope,
    tunnelAt,
    edgeAt,
    nearest,
    clearOfRoad,
    checkpoints,
    startGrid,
    minimap,
    terrainModify,
    layoutScenery
  };
  return api;
}

function sideList(side) {
  if (side === 'left') return [-1];
  if (side === 'right') return [1];
  return [-1, 1];
}

function placeBeside(track, s, side, offset, lift) {
  const sm = track.sample(s);
  const lat = side * (sm.width / 2 + offset);
  const x = sm.pos.x + sm.rightFlat.x * lat;
  const z = sm.pos.z + sm.rightFlat.z * lat;
  const y = track.surfaceY(s, side * sm.width / 2) + (lift || 0);
  const facing = sm.heading + (side < 0 ? -Math.PI / 2 : Math.PI / 2);
  return { x, y, z, yaw: wrapAngle(facing), s, side, heading: sm.heading };
}

export function layoutTrackScenery(track, rules, seed) {
  const rng = mulberry32((seed >>> 0) || 1);
  const out = {};
  const L = track.length;

  function inRange(s, r) {
    if (!r) return true;
    const w = track.wrapS(s);
    for (let i = 0; i < r.length; i++) if (w >= r[i][0] && w <= r[i][1]) return true;
    return false;
  }

  function skipTunnel(s) {
    return !!track.tunnelAt(s);
  }

  function alongRule(rule, make) {
    const list = [];
    const every = Math.max(4, rule.every || 40);
    const start = rule.start || 0;
    const sides = sideList(rule.side);
    for (let s = start; s < L; s += every) {
      if (!inRange(s, rule.ranges)) continue;
      if (rule.avoidTunnels !== false && skipTunnel(s)) continue;
      for (let q = 0; q < sides.length; q++) {
        const side = sides[q];
        const ss = rule.stagger && side > 0 ? track.wrapS(s + every / 2) : s;
        if (rule.chance != null && rng() > rule.chance) continue;
        const jitter = rule.jitter ? (rng() - 0.5) * 2 * rule.jitter : 0;
        const p = placeBeside(track, ss, side, (rule.offset || 2) + jitter, 0);
        const clear = rule.clearance == null ? (rule.offset || 2) * 0.6 : rule.clearance;
        if (!track.clearOfRoad(p.x, p.z, clear)) continue;
        const item = make(p, rule);
        if (item) list.push(item);
      }
    }
    return list;
  }

  if (rules.lampPosts) {
    out.lampPosts = alongRule(rules.lampPosts, (p, r) => ({
      x: p.x, y: p.y, z: p.z, yaw: p.yaw, style: r.style || 'street', color: r.color || null
    }));
  }

  if (rules.buildings) {
    const r = rules.buildings;
    const list = [];
    const sides = sideList(r.side);
    const styles = r.styles || ['office'];
    for (let q = 0; q < sides.length; q++) {
      const side = sides[q];
      let s = r.start || 0;
      while (s < L) {
        const w = lerp(r.width[0], r.width[1], rng());
        const d = lerp(r.depth[0], r.depth[1], rng());
        const h = lerp(r.height[0], r.height[1], Math.pow(rng(), r.heightBias || 1));
        const gap = lerp(r.gap ? r.gap[0] : 2, r.gap ? r.gap[1] : 6, rng());
        const sc = track.wrapS(s + w / 2);
        if (inRange(sc, r.ranges) && !skipTunnel(sc)) {
          const setback = lerp(r.setback[0], r.setback[1], rng());
          const p = placeBeside(track, sc, side, setback + d / 2, 0);
          const rad = Math.hypot(w, d) / 2;
          if (track.clearOfRoad(p.x, p.z, rad + (r.clearance == null ? 3 : r.clearance))) {
            list.push({
              x: p.x, y: p.y, z: p.z, yaw: wrapAngle(p.heading), w, d, h,
              style: styles[Math.floor(rng() * styles.length)],
              seed: Math.floor(rng() * 1e6)
            });
          }
        }
        s += w + gap;
      }
    }
    out.buildings = list;
  }

  function explicitList(items, make) {
    const list = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const side = it.side === 'left' ? -1 : 1;
      const p = placeBeside(track, it.s, side, it.offset == null ? 4 : it.offset, 0);
      const item = make(p, it);
      if (item) list.push(item);
    }
    return list;
  }

  if (rules.neonSigns) {
    out.neonSigns = explicitList(rules.neonSigns, (p, it) => ({
      x: p.x, y: p.y + (it.y == null ? 6 : it.y), z: p.z, yaw: p.yaw, w: it.w || 6, h: it.h || 3,
      image: it.image || 'neon-1', color: it.color || null
    }));
  }

  if (rules.billboards) {
    out.billboards = explicitList(rules.billboards, (p, it) => ({
      x: p.x, y: p.y + (it.y == null ? 4 : it.y), z: p.z, yaw: p.yaw, w: it.w || 12, h: it.h || 6,
      image: it.image || 'billboard-1'
    }));
  }

  if (rules.containers) {
    const list = [];
    for (let i = 0; i < rules.containers.length; i++) {
      const it = rules.containers[i];
      const side = it.side === 'left' ? -1 : 1;
      const count = it.count || 1;
      for (let c = 0; c < count; c++) {
        const s = track.wrapS(it.s + c * (it.spacing || 7));
        const p = placeBeside(track, s, side, it.offset == null ? 8 : it.offset, 0);
        if (!track.clearOfRoad(p.x, p.z, 4)) continue;
        const stack = it.stack ? 1 + Math.floor(rng() * it.stack) : 1;
        for (let k = 0; k < stack; k++) {
          list.push({ x: p.x, y: p.y + k * 2.6, z: p.z, yaw: wrapAngle(p.heading + (it.across ? Math.PI / 2 : 0)), color: Math.floor(rng() * 6) });
        }
      }
    }
    out.containers = list;
  }

  if (rules.cones) {
    out.cones = explicitList(rules.cones, (p, it) => ({ x: p.x, y: p.y, z: p.z, yaw: p.yaw }));
  }

  if (rules.scatter) {
    out.scatter = rules.scatter.map((rule) => {
      const pts = [];
      const count = rule.count || 50;
      const band = rule.band || [8, 60];
      let guard = 0;
      while (pts.length < count && guard < count * 30) {
        guard++;
        const s = rng() * L;
        if (!inRange(s, rule.ranges)) continue;
        if (rule.side === 'left' || rule.side === 'right') {
          const side = rule.side === 'left' ? -1 : 1;
          const dist = lerp(band[0], band[1], rng());
          const p = placeBeside(track, s, side, dist, 0);
          if (!track.clearOfRoad(p.x, p.z, band[0] * 0.8)) continue;
          pts.push({ x: p.x, y: p.y, z: p.z, yaw: rng() * Math.PI * 2, scale: lerp(rule.scale ? rule.scale[0] : 0.8, rule.scale ? rule.scale[1] : 1.3, rng()) });
        } else {
          const side = rng() < 0.5 ? -1 : 1;
          const dist = lerp(band[0], band[1], rng());
          const p = placeBeside(track, s, side, dist, 0);
          if (!track.clearOfRoad(p.x, p.z, band[0] * 0.8)) continue;
          pts.push({ x: p.x, y: p.y, z: p.z, yaw: rng() * Math.PI * 2, scale: lerp(rule.scale ? rule.scale[0] : 0.8, rule.scale ? rule.scale[1] : 1.3, rng()) });
        }
      }
      return { kind: rule.kind, points: pts };
    });
  }

  return out;
}

const TRACK_STYLE_DEFAULT = {
  apron: 'gravel',
  apronWidth: 5,
  wallGlow: null,
  line: '#f2f2f2',
  laneCount: 2,
  curbColors: ['#d8232e', '#f2f2f2'],
  lightsColor: '#ffe2b0'
};

function trackCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function trackNoiseFill(ctx, w, h, base, spread, count, seed, size) {
  const rng = mulberry32(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < count; i++) {
    const x = rng() * w, y = rng() * h;
    const v = Math.floor((rng() - 0.5) * spread);
    const a = 0.25 + rng() * 0.5;
    ctx.fillStyle = v >= 0 ? 'rgba(255,255,255,' + (a * v / spread).toFixed(3) + ')' : 'rgba(0,0,0,' + (a * -v / spread).toFixed(3) + ')';
    const r = (size || 1.5) * (0.5 + rng());
    ctx.fillRect(x, y, r, r);
  }
}

function trackTexture(THREE, canvas, repeat, srgb) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  if (srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  t.needsUpdate = true;
  return t;
}

function makeTrackTextures(THREE) {
  const asphalt = trackCanvas(512, 512);
  let g = asphalt.getContext('2d');
  trackNoiseFill(g, 512, 512, '#34363b', 70, 26000, 11, 1.6);
  const rng = mulberry32(5);
  for (let i = 0; i < 40; i++) {
    g.fillStyle = 'rgba(0,0,0,' + (0.04 + rng() * 0.06).toFixed(3) + ')';
    const x = rng() * 512, y = rng() * 512, r = 20 + rng() * 70;
    for (let ox = -512; ox <= 512; ox += 512) for (let oy = -512; oy <= 512; oy += 512) {
      g.beginPath(); g.ellipse(x + ox, y + oy, r, r * (0.4 + rng() * 0.6), rng() * 3, 0, Math.PI * 2); g.fill();
    }
  }
  const concrete = trackCanvas(256, 256);
  g = concrete.getContext('2d');
  trackNoiseFill(g, 256, 256, '#a7a49d', 60, 9000, 21, 1.4);
  g.fillStyle = 'rgba(0,0,0,0.18)';
  g.fillRect(0, 0, 2, 256);
  g.fillStyle = 'rgba(0,0,0,0.08)';
  g.fillRect(0, 250, 256, 6);
  const chevron = trackCanvas(256, 256);
  g = chevron.getContext('2d');
  g.fillStyle = '#16171a';
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#f2c018';
  for (let k = -4; k < 8; k++) {
    g.beginPath();
    g.moveTo(k * 64, 256); g.lineTo(k * 64 + 32, 256); g.lineTo(k * 64 + 32 + 128, 128); g.lineTo(k * 64 + 32, 0);
    g.lineTo(k * 64, 0); g.lineTo(k * 64 + 128, 128); g.closePath(); g.fill();
  }
  const checker = trackCanvas(128, 32);
  g = checker.getContext('2d');
  for (let x = 0; x < 16; x++) for (let y = 0; y < 4; y++) {
    g.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4';
    g.fillRect(x * 8, y * 8, 8, 8);
  }
  const sidewalk = trackCanvas(256, 256);
  g = sidewalk.getContext('2d');
  trackNoiseFill(g, 256, 256, '#8d8c88', 50, 7000, 31, 1.3);
  g.fillStyle = 'rgba(0,0,0,0.22)';
  for (let k = 0; k < 4; k++) { g.fillRect(0, k * 64, 256, 2); g.fillRect(k * 64, 0, 2, 256); }
  const gravel = trackCanvas(256, 256);
  g = gravel.getContext('2d');
  trackNoiseFill(g, 256, 256, '#7b746a', 120, 14000, 41, 2.2);
  const dirt = trackCanvas(256, 256);
  g = dirt.getContext('2d');
  trackNoiseFill(g, 256, 256, '#a0714a', 90, 12000, 51, 2.4);
  const rock = trackCanvas(256, 256);
  g = rock.getContext('2d');
  trackNoiseFill(g, 256, 256, '#7d6f62', 140, 16000, 61, 3.2);
  return {
    asphalt: trackTexture(THREE, asphalt),
    concrete: trackTexture(THREE, concrete),
    chevron: trackTexture(THREE, chevron),
    checker: trackTexture(THREE, checker),
    sidewalk: trackTexture(THREE, sidewalk),
    gravel: trackTexture(THREE, gravel),
    dirt: trackTexture(THREE, dirt),
    rock: trackTexture(THREE, rock)
  };
}

function createStrips() {
  return { pos: [], uv: [], col: [], idx: [], hasColor: false };
}

function stripAdd(b, rows, color) {
  const base = b.pos.length / 3;
  const n = rows.length;
  for (let i = 0; i < n; i++) {
    const r = rows[i];
    b.pos.push(r[0], r[1], r[2], r[3], r[4], r[5]);
    b.uv.push(r[6], r[7], r[8], r[9]);
    const c = r[10] || color || null;
    if (c) { b.hasColor = true; b.col.push(c[0], c[1], c[2], c[0], c[1], c[2]); }
    else b.col.push(1, 1, 1, 1, 1, 1);
  }
  for (let i = 0; i < n - 1; i++) {
    const a0 = base + i * 2, b0 = a0 + 1, a1 = a0 + 2, b1 = a0 + 3;
    b.idx.push(a0, b0, a1, b0, b1, a1);
  }
}

function stripQuad(b, p, uv, color) {
  const base = b.pos.length / 3;
  for (let k = 0; k < 4; k++) {
    b.pos.push(p[k][0], p[k][1], p[k][2]);
    b.uv.push(uv[k][0], uv[k][1]);
    const c = color || [1, 1, 1];
    b.col.push(c[0], c[1], c[2]);
  }
  if (color) b.hasColor = true;
  b.idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
}

function stripGeometry(THREE, b) {
  if (!b.idx.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
  if (b.hasColor) g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
  g.setIndex(b.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(b.idx, 1) : new THREE.Uint16BufferAttribute(b.idx, 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

function hexRgb(hex) {
  const h = String(hex || '#ffffff').replace('#', '');
  const v = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

const BARRIER_PROFILE = [[0, 0], [0, 0.08], [0.07, 0.32], [0.2, 0.84], [0.36, 0.84], [0.5, 0.32], [0.58, 0.08], [0.58, 0]];
const WALL_PROFILE = [[0, -0.2], [0, 1.45], [0.42, 1.45], [0.42, -0.2]];
const NEON_PROFILE = [[0, -0.2], [0, 1.15], [0.36, 1.15], [0.36, -0.2]];
const RAIL_PROFILE = [[0.16, 0.52], [0.2, 0.6], [0.16, 0.68], [0.2, 0.76], [0.16, 0.84]];

export function buildTrackMeshes(THREE, track, opts = {}) {
  const style = Object.assign({}, TRACK_STYLE_DEFAULT, track.def && track.def.style || {}, opts.style || {});
  const step = opts.step || 2;
  const L = track.length;
  const N = Math.max(8, Math.round(L / step));
  const ds = L / N;
  const group = new THREE.Group();
  group.name = 'track';
  const disposables = [];
  const mats = opts.materials || {};
  const tex = makeTrackTextures(THREE);
  Object.values(tex).forEach((t) => disposables.push(t));
  const sm = makeTrackSample();
  const shadows = opts.shadows !== false;

  function own(m) { disposables.push(m); return m; }

  const roadMat = mats.road || own(new THREE.MeshStandardMaterial({ map: tex.asphalt, roughness: 0.86, metalness: 0.02, color: 0xffffff }));
  const lineMat = mats.line || own(new THREE.MeshStandardMaterial({ color: new THREE.Color(style.line), roughness: 0.6, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  const curbMat = mats.curb || own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0, side: THREE.DoubleSide }));
  const concreteMat = mats.concrete || own(new THREE.MeshStandardMaterial({ map: tex.concrete, roughness: 0.9, metalness: 0, side: THREE.DoubleSide }));
  const railMat = mats.guardrail || own(new THREE.MeshStandardMaterial({ color: 0xc9ced4, roughness: 0.35, metalness: 0.85, side: THREE.DoubleSide, envMap: opts.envMap || null }));
  const postMat = mats.post || own(new THREE.MeshStandardMaterial({ color: 0x8f959c, roughness: 0.5, metalness: 0.6 }));
  const glowMat = mats.glow || own(new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
  const apronTex = style.apron === 'sidewalk' ? tex.sidewalk : style.apron === 'dirt' ? tex.dirt : tex.gravel;
  const apronMat = mats.apron || own(new THREE.MeshStandardMaterial({ map: apronTex, roughness: 0.95, metalness: 0, side: THREE.DoubleSide }));
  const rampMat = mats.ramp || own(new THREE.MeshStandardMaterial({ map: tex.chevron, roughness: 0.6, metalness: 0.1 }));
  const rampSideMat = own(new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.7, metalness: 0.3, side: THREE.DoubleSide }));
  const checkerMat = own(new THREE.MeshStandardMaterial({ map: tex.checker, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
  const tunnelMat = mats.tunnel || own(new THREE.MeshStandardMaterial({ map: tex.concrete, color: 0x9a978f, emissive: 0x2a2014, roughness: 0.92, metalness: 0, side: THREE.DoubleSide }));
  const rockMat = mats.rock || own(new THREE.MeshStandardMaterial({ map: tex.rock, color: style.hillColor || 0x8a8f68, roughness: 0.96, metalness: 0, side: THREE.DoubleSide }));
  const lampMat = own(new THREE.MeshBasicMaterial({ color: new THREE.Color(style.lightsColor), toneMapped: false, side: THREE.DoubleSide }));

  function addMesh(geo, mat, name, cast, receive) {
    if (!geo) return null;
    disposables.push(geo);
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    m.castShadow = shadows && !!cast;
    m.receiveShadow = shadows && receive !== false;
    group.add(m);
    return m;
  }

  function edgePoint(s, side, out, lateralExtra, height, lift) {
    track.sample(s, sm);
    const half = sm.width / 2;
    const e = side * half;
    const yRamp = lift ? track.rampHeight(s) : 0;
    out[0] = sm.pos.x + sm.right.x * e + sm.rightFlat.x * side * lateralExtra;
    out[1] = sm.pos.y + sm.right.y * e + height + yRamp * sm.up.y;
    out[2] = sm.pos.z + sm.right.z * e + sm.rightFlat.z * side * lateralExtra;
    return out;
  }

  function surfacePoint(s, lat, lift, out) {
    track.sample(s, sm);
    out[0] = sm.pos.x + sm.right.x * lat + sm.up.x * lift;
    out[1] = sm.pos.y + sm.right.y * lat + sm.up.y * lift;
    out[2] = sm.pos.z + sm.right.z * lat + sm.up.z * lift;
    return out;
  }

  const road = createStrips();
  {
    const rows = [];
    const a = [0, 0, 0], b = [0, 0, 0];
    for (let i = 0; i <= N; i++) {
      const s = i * ds;
      track.sample(s, sm);
      const half = sm.width / 2;
      surfacePoint(s, -half - 0.05, 0, a);
      surfacePoint(s, half + 0.05, 0, b);
      rows.push([a[0], a[1], a[2], b[0], b[1], b[2], -half / 10, s / 10, half / 10, s / 10]);
    }
    stripAdd(road, rows);
  }
  const roadMesh = addMesh(stripGeometry(THREE, road), roadMat, 'road', false, true);

  const lines = createStrips();
  const curbRanges = [];
  {
    const raw = new Int8Array(N + 1);
    for (let i = 0; i <= N; i++) {
      const k = track.curvatureAt(i * ds);
      raw[i] = Math.abs(k) > 1 / 150 ? (k > 0 ? 1 : -1) : 0;
    }
    const reach = Math.max(1, Math.round(14 / ds));
    for (let i = 0; i <= N; i++) {
      let v = 0;
      for (let d = 0; d <= reach && !v; d++) {
        if (i - d >= 0 && raw[i - d]) v = raw[i - d];
        else if (i + d <= N && raw[i + d]) v = raw[i + d];
      }
      curbRanges.push(v);
    }
    const lc = Math.max(1, style.laneCount | 0);
    const a = [0, 0, 0], b = [0, 0, 0];
    for (const side of [-1, 1]) {
      let rows = [];
      for (let i = 0; i <= N; i++) {
        const s = i * ds;
        const curbHere = curbRanges[i] && (curbRanges[i] === -side || Math.abs(track.curvatureAt(s)) > 1 / 80);
        if (curbHere || track.rampAt(s)) {
          if (rows.length > 1) stripAdd(lines, rows);
          rows = [];
          continue;
        }
        track.sample(s, sm);
        const half = sm.width / 2;
        surfacePoint(s, side * (half - 0.55), 0.02, a);
        surfacePoint(s, side * (half - 0.33), 0.02, b);
        rows.push(side < 0 ? [a[0], a[1], a[2], b[0], b[1], b[2], 0, s, 1, s] : [b[0], b[1], b[2], a[0], a[1], a[2], 0, s, 1, s]);
      }
      if (rows.length > 1) stripAdd(lines, rows);
    }
    const dash = 4, gap = 8;
    for (let k = 1; k < lc; k++) {
      const f = k / lc;
      for (let s = 3; s < L - 2; s += dash + gap) {
        if (track.rampAt(s) || track.rampAt(s + dash)) continue;
        const rows = [];
        for (let q = 0; q <= 2; q++) {
          const ss = s + (dash * q) / 2;
          track.sample(ss, sm);
          const lat = -sm.width / 2 + sm.width * f;
          surfacePoint(ss, lat - 0.08, 0.02, a);
          surfacePoint(ss, lat + 0.08, 0.02, b);
          rows.push([a[0], a[1], a[2], b[0], b[1], b[2], 0, ss, 1, ss]);
        }
        stripAdd(lines, rows);
      }
    }
  }
  addMesh(stripGeometry(THREE, lines), lineMat, 'lines', false, true);

  {
    const start = createStrips();
    const a = [0, 0, 0], b = [0, 0, 0];
    const rows = [];
    for (let q = 0; q <= 1; q++) {
      const s = track.wrapS(-1 + q * 2);
      track.sample(s, sm);
      const half = sm.width / 2;
      surfacePoint(s, -half + 0.3, 0.025, a);
      surfacePoint(s, half - 0.3, 0.025, b);
      rows.push([a[0], a[1], a[2], b[0], b[1], b[2], 0, q, Math.round(sm.width / 2), q]);
    }
    stripAdd(start, rows);
    addMesh(stripGeometry(THREE, start), checkerMat, 'start-line', false, true);
  }

  const curbs = createStrips();
  {
    const cA = hexRgb(style.curbColors[0]), cB = hexRgb(style.curbColors[1]);
    const p0 = [0, 0, 0], p1 = [0, 0, 0], p2 = [0, 0, 0];
    for (const side of [-1, 1]) {
      let i = 0;
      while (i <= N) {
        if (!curbRanges[i] || track.tunnelAt(i * ds)) { i++; continue; }
        const inner = curbRanges[i] === -side;
        let j = i;
        while (j <= N && curbRanges[j] && !track.tunnelAt(j * ds)) j++;
        const tight = (() => { for (let q = i; q < j; q++) if (Math.abs(track.curvatureAt(q * ds)) > 1 / 80) return true; return false; })();
        if (inner || tight) {
          const rowsA = [], rowsB = [];
          for (let q = i; q < j; q++) {
            const s = q * ds;
            track.sample(s, sm);
            const half = sm.width / 2;
            const c = Math.floor(s / 2) % 2 ? cA : cB;
            surfacePoint(s, side * (half - 1.15), 0.0, p0);
            surfacePoint(s, side * (half - 0.55), 0.07, p1);
            surfacePoint(s, side * (half + 0.02), 0.07, p2);
            rowsA.push([p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], 0, s, 1, s, c]);
            rowsB.push([p1[0], p1[1], p1[2], p2[0], p2[1], p2[2], 0, s, 1, s, c]);
          }
          for (let q = 0; q < rowsA.length - 1; q++) {
            stripAdd(curbs, [rowsA[q], Object.assign(rowsA[q + 1].slice(), { 10: rowsA[q][10] })]);
            stripAdd(curbs, [rowsB[q], Object.assign(rowsB[q + 1].slice(), { 10: rowsB[q][10] })]);
          }
        }
        i = j;
      }
    }
  }
  addMesh(stripGeometry(THREE, curbs), curbMat, 'curbs', false, true);

  const concrete = createStrips();
  const rails = createStrips();
  const glow = createStrips();
  const apron = createStrips();
  const posts = [];
  {
    const glowColors = (style.wallGlow || []).map(hexRgb);
    const pa = [0, 0, 0], pb = [0, 0, 0];
    for (const side of [-1, 1]) {
      const sideName = side < 0 ? 'left' : 'right';
      const kindAt = (q) => (track.tunnelAt(q * ds) ? 'tunnel' : track.edgeAt(q * ds, sideName));
      let i = 0;
      while (i < N) {
        const kind = kindAt(i);
        let j = i + 1;
        while (j < N && kindAt(j) === kind) j++;
        const end = j;
        if (kind !== 'tunnel') {
          const profile = kind === 'wall' ? WALL_PROFILE : kind === 'neon' ? NEON_PROFILE : kind === 'guardrail' ? null : BARRIER_PROFILE;
          if (profile) {
            for (let k = 0; k < profile.length - 1; k++) {
              const rows = [];
              for (let q = i; q <= end; q++) {
                const s = q * ds;
                edgePoint(s, side, pa, profile[k][0], profile[k][1], false);
                edgePoint(s, side, pb, profile[k + 1][0], profile[k + 1][1], false);
                rows.push([pa[0], pa[1], pa[2], pb[0], pb[1], pb[2], s / 4, k * 0.25, s / 4, (k + 1) * 0.25]);
              }
              stripAdd(concrete, rows);
            }
            if (kind === 'neon' && glowColors.length) {
              const rows = [];
              for (let q = i; q <= end; q++) {
                const s = q * ds;
                const c = glowColors[Math.floor(s / 90) % glowColors.length];
                edgePoint(s, side, pa, -0.012, 0.86, false);
                edgePoint(s, side, pb, -0.012, 0.98, false);
                rows.push([pa[0], pa[1], pa[2], pb[0], pb[1], pb[2], 0, 0, 1, 1, c]);
              }
              stripAdd(glow, rows);
              const top = [];
              for (let q = i; q <= end; q++) {
                const s = q * ds;
                const c = glowColors[Math.floor(s / 90) % glowColors.length];
                edgePoint(s, side, pa, 0.06, 1.16, false);
                edgePoint(s, side, pb, 0.3, 1.16, false);
                top.push([pa[0], pa[1], pa[2], pb[0], pb[1], pb[2], 0, 0, 1, 1, c]);
              }
              stripAdd(glow, top);
            }
          } else {
            for (let k = 0; k < RAIL_PROFILE.length - 1; k++) {
              const rows = [];
              for (let q = i; q <= end; q++) {
                const s = q * ds;
                edgePoint(s, side, pa, RAIL_PROFILE[k][0], RAIL_PROFILE[k][1], false);
                edgePoint(s, side, pb, RAIL_PROFILE[k + 1][0], RAIL_PROFILE[k + 1][1], false);
                rows.push([pa[0], pa[1], pa[2], pb[0], pb[1], pb[2], s / 4, 0, s / 4, 1]);
              }
              stripAdd(rails, rows);
            }
            for (let s = Math.ceil(i * ds / 4) * 4; s < end * ds; s += 4) {
              edgePoint(s, side, pa, 0.34, 0, false);
              track.sample(s, sm);
              posts.push([pa[0], pa[1], pa[2], sm.heading]);
            }
          }
          const ap0 = kind === 'guardrail' ? 0.5 : profile ? profile[profile.length - 1][0] : 0.5;
          const raise = style.apron === 'sidewalk' ? 0.16 : 0.02;
          const width = style.apronWidth || 5;
          const rowsTop = [], rowsSkirt = [];
          const pc = [0, 0, 0];
          for (let q = i; q <= end; q++) {
            const s = q * ds;
            edgePoint(s, side, pa, ap0, raise, false);
            edgePoint(s, side, pb, ap0 + width, raise, false);
            edgePoint(s, side, pc, ap0 + width + 0.6, -1.6, false);
            rowsTop.push([pa[0], pa[1], pa[2], pb[0], pb[1], pb[2], s / 6, 0, s / 6, width / 6]);
            rowsSkirt.push([pb[0], pb[1], pb[2], pc[0], pc[1], pc[2], s / 6, width / 6, s / 6, (width + 1.6) / 6]);
          }
          stripAdd(apron, rowsTop);
          stripAdd(apron, rowsSkirt);
        }
        i = end;
      }
    }
  }
  addMesh(stripGeometry(THREE, concrete), concreteMat, 'walls', true, true);
  addMesh(stripGeometry(THREE, rails), railMat, 'guardrails', true, true);
  addMesh(stripGeometry(THREE, glow), glowMat, 'wall-glow', false, false);
  addMesh(stripGeometry(THREE, apron), apronMat, 'apron', false, true);
  if (posts.length) {
    const pg = new THREE.BoxGeometry(0.12, 0.9, 0.12);
    pg.translate(0, 0.45, 0);
    disposables.push(pg);
    const inst = new THREE.InstancedMesh(pg, postMat, posts.length);
    const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), pv = new THREE.Vector3();
    posts.forEach((p, k) => {
      qq.setFromAxisAngle(up, p[3]);
      pv.set(p[0], p[1], p[2]);
      m4.compose(pv, qq, one);
      inst.setMatrixAt(k, m4);
    });
    inst.castShadow = shadows;
    inst.name = 'guardrail-posts';
    group.add(inst);
  }

  const ramps = createStrips();
  const rampSides = createStrips();
  for (const r of track.ramps) {
    const pa = [0, 0, 0], pb = [0, 0, 0];
    const rows = [], left = [], right = [];
    const n = Math.max(4, Math.ceil((r.s1 - r.s0) / 0.5));
    for (let q = 0; q <= n; q++) {
      const s = r.s0 + (r.s1 - r.s0) * q / n;
      track.sample(s, sm);
      const half = sm.width / 2 - 0.25;
      const h = track.rampHeight(s);
      surfacePoint(s, -half, h + 0.01, pa);
      surfacePoint(s, half, h + 0.01, pb);
      const v = (s - r.s0) / 4;
      rows.push([pa[0], pa[1], pa[2], pb[0], pb[1], pb[2], 0, v, sm.width / 8, v]);
      const ga = [0, 0, 0], gb = [0, 0, 0];
      surfacePoint(s, -half, -0.05, ga);
      surfacePoint(s, half, -0.05, gb);
      left.push([ga[0], ga[1], ga[2], pa[0], pa[1], pa[2], 0, 0, 1, 1]);
      right.push([pb[0], pb[1], pb[2], gb[0], gb[1], gb[2], 0, 0, 1, 1]);
    }
    stripAdd(ramps, rows);
    stripAdd(rampSides, left);
    stripAdd(rampSides, right);
    const last = rows[rows.length - 1];
    track.sample(r.s1, sm);
    const half = sm.width / 2 - 0.25;
    const ga = [0, 0, 0], gb = [0, 0, 0];
    surfacePoint(r.s1, -half, -0.05, ga);
    surfacePoint(r.s1, half, -0.05, gb);
    stripQuad(rampSides, [[ga[0], ga[1], ga[2]], [gb[0], gb[1], gb[2]], [last[0], last[1], last[2]], [last[3], last[4], last[5]]], [[0, 0], [1, 0], [0, 1], [1, 1]]);
  }
  addMesh(stripGeometry(THREE, ramps), rampMat, 'ramps', true, true);
  addMesh(stripGeometry(THREE, rampSides), rampSideMat, 'ramp-sides', true, true);

  const tunnelShell = createStrips();
  const tunnelRock = createStrips();
  const tunnelLights = createStrips();
  const portals = [];
  for (const t of track.tunnels) {
    const height = t.height || 7.5;
    const n = Math.max(4, Math.ceil((t.s1 - t.s0) / 2));
    const arc = 10;
    const shoulder = 6;
    const profileAt = (s) => {
      track.sample(s, sm);
      const half = sm.width / 2 + 0.6;
      const wallH = height * 0.55;
      const pts = [[-half, -0.3], [-half, wallH]];
      for (let k = 1; k < arc; k++) {
        const ang = Math.PI * k / arc;
        pts.push([-half * Math.cos(ang), wallH + Math.sin(ang) * (height - wallH)]);
      }
      pts.push([half, wallH], [half, -0.3]);
      return pts;
    };
    const outerAt = (s) => {
      track.sample(s, sm);
      const half = sm.width / 2 + shoulder;
      const top = height + 2.4;
      const pts = [[-half - 8, -0.8], [-half, top]];
      const m = 14;
      for (let k = 1; k < m; k++) {
        const u = k / m;
        const bump = Math.sin(Math.PI * u);
        pts.push([-half + 2 * half * u, top + 1.8 * bump + Math.sin(u * 17 + s * 0.05) * 0.35 * bump]);
      }
      pts.push([half, top], [half + 8, -0.8]);
      return pts;
    };
    const pa = [0, 0, 0], pb = [0, 0, 0];
    const addProfileSweep = (b, fn, uScale) => {
      const first = fn(t.s0);
      for (let k = 0; k < first.length - 1; k++) {
        const rows = [];
        for (let q = 0; q <= n; q++) {
          const s = t.s0 + (t.s1 - t.s0) * q / n;
          const prof = fn(s);
          track.sample(s, sm);
          for (const [pt, out] of [[prof[k], pa], [prof[k + 1], pb]]) {
            out[0] = sm.pos.x + sm.rightFlat.x * pt[0];
            out[1] = sm.pos.y + pt[1];
            out[2] = sm.pos.z + sm.rightFlat.z * pt[0];
          }
          rows.push([pa[0], pa[1], pa[2], pb[0], pb[1], pb[2], s / uScale, k / 4, s / uScale, (k + 1) / 4]);
        }
        stripAdd(b, rows);
      }
    };
    addProfileSweep(tunnelShell, profileAt, 4);
    addProfileSweep(tunnelRock, outerAt, 8);
    for (let s = t.s0 + 6; s < t.s1 - 4; s += 10) {
      const c = [];
      for (const [lat, ds2] of [[-1.1, 0], [1.1, 0], [-1.1, 4], [1.1, 4]]) {
        track.sample(s + ds2, sm);
        c.push([sm.pos.x + sm.rightFlat.x * lat, sm.pos.y + height - 0.15, sm.pos.z + sm.rightFlat.z * lat]);
      }
      stripQuad(tunnelLights, c, [[0, 0], [1, 0], [0, 1], [1, 1]]);
    }
    for (const sEnd of [t.s0, t.s1]) {
      const outer = outerAt(sEnd);
      const hole = profileAt(sEnd);
      const shape = new THREE.Shape(outer.map((p) => new THREE.Vector2(p[0], p[1])));
      shape.holes.push(new THREE.Path(hole.slice().reverse().map((p) => new THREE.Vector2(p[0], p[1] + 0.001))));
      const geo = new THREE.ShapeGeometry(shape, 4);
      track.sample(sEnd, sm);
      const m4 = new THREE.Matrix4().makeBasis(
        new THREE.Vector3(sm.rightFlat.x, 0, sm.rightFlat.z),
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(Math.sin(sm.heading), 0, Math.cos(sm.heading))
      );
      m4.setPosition(sm.pos.x, sm.pos.y, sm.pos.z);
      geo.applyMatrix4(m4);
      portals.push(geo);
    }
  }
  addMesh(stripGeometry(THREE, tunnelShell), tunnelMat, 'tunnel', true, true);
  addMesh(stripGeometry(THREE, tunnelRock), rockMat, 'tunnel-hill', true, true);
  addMesh(stripGeometry(THREE, tunnelLights), lampMat, 'tunnel-lights', false, false);
  portals.forEach((geo) => {
    const m = addMesh(geo, concreteMat, 'tunnel-portal', true, true);
    if (m) m.material = concreteMat;
  });

  const lights = [];
  const gantry = new THREE.Group();
  gantry.name = 'gantry';
  {
    track.sample(0, sm);
    const half = sm.width / 2;
    const span = half + 1.6;
    const frameMat = own(new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.45, metalness: 0.7, envMap: opts.envMap || null }));
    const bannerMat = own(new THREE.MeshStandardMaterial({ map: tex.checker, roughness: 0.6 }));
    const pillar = new THREE.BoxGeometry(0.7, 8, 0.7);
    pillar.translate(0, 4, 0);
    const beam = new THREE.BoxGeometry(span * 2 + 0.7, 1.1, 1.0);
    const banner = new THREE.BoxGeometry(span * 2 - 1, 0.9, 0.12);
    disposables.push(pillar, beam, banner);
    for (const side of [-1, 1]) {
      const p = new THREE.Mesh(pillar, frameMat);
      p.position.set(side * span, 0, 0);
      p.castShadow = shadows;
      gantry.add(p);
    }
    const bm = new THREE.Mesh(beam, frameMat);
    bm.position.set(0, 7.4, 0);
    bm.castShadow = shadows;
    gantry.add(bm);
    const bn = new THREE.Mesh(banner, bannerMat);
    bn.position.set(0, 6.4, 0);
    gantry.add(bn);
    const lightGeo = new THREE.BoxGeometry(0.55, 0.55, 0.2);
    disposables.push(lightGeo);
    for (let k = 0; k < 5; k++) {
      const lm = own(new THREE.MeshBasicMaterial({ color: 0x220707, toneMapped: false }));
      const l = new THREE.Mesh(lightGeo, lm);
      l.position.set((k - 2) * 1.0, 7.4, 0.58);
      gantry.add(l);
      lights.push(l);
    }
    const roadY = sm.pos.y;
    gantry.position.set(sm.pos.x, roadY, sm.pos.z);
    gantry.rotation.y = sm.heading;
    group.add(gantry);
  }

  function setStartLights(state) {
    for (let k = 0; k < lights.length; k++) {
      const m = lights[k].material;
      if (state === 'go') m.color.setHex(0x22ff66);
      else if (state === 'off' || state == null) m.color.setHex(0x220707);
      else m.color.setHex(k < state ? 0xff2020 : 0x220707);
    }
  }

  const checkpoints = track.checkpoints(opts.checkpoints);
  if (opts.showCheckpoints) {
    const cpMat = own(new THREE.MeshBasicMaterial({ color: 0x6ef3c5, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
    for (const c of checkpoints) {
      const geo = new THREE.PlaneGeometry(c.halfW * 2, c.halfH * 2);
      disposables.push(geo);
      const m = new THREE.Mesh(geo, cpMat);
      m.position.set(c.pos.x, c.pos.y, c.pos.z);
      m.lookAt(c.pos.x + c.normal.x, c.pos.y + c.normal.y, c.pos.z + c.normal.z);
      group.add(m);
    }
  }

  return {
    group,
    road: roadMesh,
    checkpoints,
    minimap: track.minimap(opts.minimapPoints || 256),
    grid: track.startGrid(opts.gridSize || 6),
    setStartLights,
    dispose() {
      group.removeFromParent();
      disposables.forEach((d) => d && d.dispose && d.dispose());
      group.traverse((o) => { if (o.isInstancedMesh) o.dispose(); });
    }
  };
}
