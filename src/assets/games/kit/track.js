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

  function terrainModify(o = {}) {
    const shoulder = o.shoulder == null ? 5 : o.shoulder;
    const blend = o.blend == null ? 38 : o.blend;
    const drop = o.drop == null ? 0.45 : o.drop;
    const tunnelShoulder = o.tunnelShoulder == null ? 10 : o.tunnelShoulder;
    const tunnelBlend = o.tunnelBlend == null ? 12 : o.tunnelBlend;
    const reach = Math.max(shoulder + blend, tunnelShoulder + tunnelBlend) + 2;
    const tmp = {};
    reachGrid(reach);
    return function modifyTerrainForTrack(x, z, h) {
      const r = nearestFlat(x, z, reach, tmp);
      if (!r) return h;
      const tun = tunnels.length ? tunnelAt(r.s) : null;
      const sh = tun ? tunnelShoulder : shoulder;
      const bl = tun ? tunnelBlend : blend;
      const target = r.roadY - drop;
      if (r.edgeDist <= sh) return target;
      const d = r.edgeDist - sh;
      if (d >= bl) return h;
      return lerp(target, h, smoothstep(0, bl, d));
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
