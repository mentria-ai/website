export const CONSTANTS = { walk: 4.5, sprint: 6.7, slideBurst: 9.0, slideDecay: 0.9, jumpVel: 4.6,
  gravity: 20, accelGround: 45, accelAir: 12, friction: 8, capsuleR: 0.35, height: 1.8, crouchH: 1.2,
  eye: 1.62, crouchEye: 1.0, stepUp: 0.4, mantleMax: 1.1, rpm: 700, spreadHip: 0.022, spreadAds: 0.004,
  spreadMove: 0.02, recoilV: 0.011, recoilH: 0.004, magSize: 30, reloadTime: 1.8, staminaMax: 6 };

const TAU = Math.PI * 2;
const PITCH_LIMIT = 1.55;
const EPS = 1e-6;
const SNAP_DOWN = 0.18;
const MAX_SUBSTEP = 0.2;
const HEIGHT_RATE = 4.5;
const COYOTE = 0.08;
const MANTLE_TIME = 0.35;
const MANTLE_REACH = 0.9;
const ADS_TIME = 0.18;
const LAND_CLAMP = 0.15;
const LAND_MIN = 0.6;
const STEP_WALK = 2.2;
const STEP_SPRINT = 1.7;
const FIRST_SHOT_IDLE = 0.3;
const BLOOM_SHOT = 0.0016;
const BLOOM_MAX = 0.03;
const BLOOM_DECAY = 6.5;
const RECOIL_HZ = 8;
const RECOIL_PERM = 0.3;
const RECOIL_KICK = 2.2;
const SLIDE_STEER = 0.2618;
const SLIDE_RATE = 1.7;
const SLIDE_CD = 0.35;
const SLIDE_ENTRY = 0.85;
const DRY_CD = 0.45;
const HIT_RANGE = 220;
const STAMINA_REGEN = 1.5;
const CROUCH_SPEED = 0.55;
const EV_MAX = 40;
const SEED0 = 0x9e3779b9;
const PATTERN_N = 30;

const PATTERN_V = [1, 1, 0.96, 0.92, 0.88, 0.84, 0.8, 0.78, 0.76, 0.74,
  0.72, 0.7, 0.68, 0.67, 0.66, 0.65, 0.64, 0.63, 0.62, 0.61,
  0.6, 0.6, 0.59, 0.58, 0.58, 0.57, 0.56, 0.55, 0.54, 0.52];
const PATTERN_H = [0, 0, 0.06, 0.14, 0.26, 0.4, 0.55, 0.68, 0.79, 0.86,
  0.82, 0.62, 0.32, -0.08, -0.44, -0.7, -0.86, -0.92, -0.8, -0.55,
  -0.22, 0.14, 0.48, 0.74, 0.9, 0.86, 0.6, 0.24, -0.16, -0.5];

const NO_INTENT = {};

function num(v, d) { return (typeof v === 'number' && v === v && v !== Infinity && v !== -Infinity) ? v : d; }

function clampN(v, a, b) { return v < a ? a : (v > b ? b : v); }

function makePrims(list) {
  const out = [];
  if (!Array.isArray(list)) return out;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (!p || typeof p !== 'object') continue;
    const a = Array.isArray(p.min) ? p.min : null;
    const b = Array.isArray(p.max) ? p.max : null;
    if (!a || !b) continue;
    const ax = num(a[0], 0), ay = num(a[1], 0), az = num(a[2], 0);
    const bx = num(b[0], 0), by = num(b[1], 0), bz = num(b[2], 0);
    const mn = [Math.min(ax, bx), Math.min(ay, by), Math.min(az, bz)];
    const mx = [Math.max(ax, bx), Math.max(ay, by), Math.max(az, bz)];
    if (mx[0] - mn[0] < 1e-5 || mx[1] - mn[1] < 1e-5 || mx[2] - mn[2] < 1e-5) continue;
    const isRamp = p.type === 'ramp';
    const mat = typeof p.mat === 'string' ? p.mat : 'concrete';
    const planes = new Float32Array(24);
    planes[0] = -1; planes[3] = -mn[0];
    planes[4] = 1; planes[7] = mx[0];
    planes[10] = -1; planes[11] = -mn[2];
    planes[14] = 1; planes[15] = mx[2];
    planes[17] = -1; planes[19] = -mn[1];
    if (!isRamp) { planes[21] = 1; planes[23] = mx[1]; }
    else {
      const dir = (p.dir === '-x' || p.dir === '+z' || p.dir === '-z') ? p.dir : '+x';
      const rise = mx[1] - mn[1];
      let nx = 0, nz = 0, c = 0, s = 0;
      if (dir === '+x') { s = rise / (mx[0] - mn[0]); nx = -s; c = mn[1] - s * mn[0]; }
      else if (dir === '-x') { s = rise / (mx[0] - mn[0]); nx = s; c = mn[1] + s * mx[0]; }
      else if (dir === '+z') { s = rise / (mx[2] - mn[2]); nz = -s; c = mn[1] - s * mn[2]; }
      else { s = rise / (mx[2] - mn[2]); nz = s; c = mn[1] + s * mx[2]; }
      const L = Math.sqrt(nx * nx + 1 + nz * nz);
      planes[20] = nx / L; planes[21] = 1 / L; planes[22] = nz / L; planes[23] = c / L;
    }
    out.push({ t: isRamp ? 1 : 0, mn: mn, mx: mx, mat: mat, planes: planes });
  }
  return out;
}

function stepMat(m) { return m === 'metal' ? 'metal' : 'concrete'; }

export function createSim(worldDef, constants) {
  const C = (constants && typeof constants === 'object') ? constants : CONSTANTS;
  const world = (worldDef && typeof worldDef === 'object') ? worldDef : NO_INTENT;
  const prims = makePrims(world.prims);
  const nPrims = prims.length;

  const tId = [], tX = [], tY = [], tZ = [], tRad = [], tHp = [], tHp0 = [];
  const srcT = Array.isArray(world.targets) ? world.targets : null;
  if (srcT) {
    for (let i = 0; i < srcT.length; i++) {
      const t = srcT[i];
      if (!t || typeof t !== 'object') continue;
      const p = Array.isArray(t.pos) ? t.pos : null;
      tId.push(typeof t.id === 'string' && t.id.length ? t.id : 't' + i);
      tX.push(p ? num(p[0], 0) : 0);
      tY.push(p ? num(p[1], 1) : 1);
      tZ.push(p ? num(p[2], 0) : 0);
      tRad.push(Math.max(0.05, num(t.radius, 0.35)));
      const hp = Math.max(1, Math.round(num(t.hp, 1)));
      tHp0.push(hp); tHp.push(hp);
    }
  }
  const nT = tId.length;

  const spawnDef = (world.spawn && typeof world.spawn === 'object') ? world.spawn : NO_INTENT;
  const spawnPos = Array.isArray(spawnDef.pos) ? spawnDef.pos : null;
  const spawnX = spawnPos ? num(spawnPos[0], 0) : 0;
  const spawnY = spawnPos ? num(spawnPos[1], 1) : 1;
  const spawnZ = spawnPos ? num(spawnPos[2], 0) : 0;
  const spawnYaw = num(spawnDef.yaw, 0);

  const k = { walk: 4.5, sprint: 6.7, slideBurst: 9, slideDecay: 0.9, jumpVel: 4.6, gravity: 20,
    accelGround: 45, accelAir: 12, friction: 8, capsuleR: 0.35, height: 1.8, crouchH: 1.2, eye: 1.62,
    crouchEye: 1, stepUp: 0.4, mantleMax: 1.1, rpm: 700, spreadHip: 0.022, spreadAds: 0.004,
    spreadMove: 0.02, recoilV: 0.011, recoilH: 0.004, magSize: 30, reloadTime: 1.8, staminaMax: 6 };

  function readK() {
    k.walk = Math.max(0.2, num(C.walk, CONSTANTS.walk));
    k.sprint = Math.max(k.walk, num(C.sprint, CONSTANTS.sprint));
    k.slideBurst = Math.max(k.walk, num(C.slideBurst, CONSTANTS.slideBurst));
    k.slideDecay = Math.max(0.05, num(C.slideDecay, CONSTANTS.slideDecay));
    k.jumpVel = Math.max(0, num(C.jumpVel, CONSTANTS.jumpVel));
    k.gravity = Math.max(0.1, num(C.gravity, CONSTANTS.gravity));
    k.accelGround = Math.max(1, num(C.accelGround, CONSTANTS.accelGround));
    k.accelAir = Math.max(0, num(C.accelAir, CONSTANTS.accelAir));
    k.friction = Math.max(0, num(C.friction, CONSTANTS.friction));
    k.height = clampN(num(C.height, CONSTANTS.height), 0.7, 4);
    k.crouchH = clampN(num(C.crouchH, CONSTANTS.crouchH), 0.4, k.height);
    k.capsuleR = clampN(num(C.capsuleR, CONSTANTS.capsuleR), 0.05, 0.9);
    k.eye = clampN(num(C.eye, CONSTANTS.eye), 0.2, k.height);
    k.crouchEye = clampN(num(C.crouchEye, CONSTANTS.crouchEye), 0.15, k.eye);
    k.stepUp = clampN(num(C.stepUp, CONSTANTS.stepUp), 0, Math.min(1.2, k.crouchH - 0.1));
    k.mantleMax = clampN(num(C.mantleMax, CONSTANTS.mantleMax), k.stepUp, 2.5);
    k.rpm = clampN(num(C.rpm, CONSTANTS.rpm), 30, 3000);
    k.spreadHip = Math.max(0, num(C.spreadHip, CONSTANTS.spreadHip));
    k.spreadAds = Math.max(0, num(C.spreadAds, CONSTANTS.spreadAds));
    k.spreadMove = Math.max(0, num(C.spreadMove, CONSTANTS.spreadMove));
    k.recoilV = num(C.recoilV, CONSTANTS.recoilV);
    k.recoilH = num(C.recoilH, CONSTANTS.recoilH);
    k.magSize = Math.max(1, Math.round(num(C.magSize, CONSTANTS.magSize)));
    k.reloadTime = Math.max(0.05, num(C.reloadTime, CONSTANTS.reloadTime));
    k.staminaMax = Math.max(0.1, num(C.staminaMax, CONSTANTS.staminaMax));
  }

  let px = 0, py = 0, pz = 0, vx = 0, vy = 0, vz = 0;
  let yawBase = 0, pitchBase = 0, yaw = 0, pitch = 0;
  let recP = 0, recPv = 0, recY = 0, recYv = 0;
  let grounded = false, coyoteT = 0;
  let capH = 1.8, eyeH = 1.62, crouchLock = false;
  let moveState = 'idle';
  let sliding = false, slideSpeed = 0, slideHead = 0, slideHead0 = 0, slideCd = 0;
  let mantleT = 0, mFx = 0, mFy = 0, mFz = 0, mTx = 0, mTy = 0, mTz = 0;
  let stamina = 6;
  let ammo = 30, shotsInMag = 0, reloading = false, reloadT = 0;
  let fireCd = 0, sinceShot = 9, bloom = 0, dryCd = 0;
  let adsRaw = 0, adsBlend = 0;
  let stepDist = 0;
  let landClampT = 0, landClampFrom = 0;
  let groundMat = 'concrete';
  let curSpread = 0;
  let seed = SEED0;

  let contactGround = false, contactWall = false;
  let gMat = 'concrete';
  let gndNx = 0, gndNy = 1, gndNz = 0;
  let wnx = 0, wnz = 0, wDepth = 0;
  let supTop = 0, supMat = 'concrete', supNx = 0, supNy = 1, supNz = 0;
  let rnx = 0, rny = 0, rnz = 0;

  const events = [];
  const evPool = [];
  for (let i = 0; i < EV_MAX; i++) {
    evPool.push({ t: '', mat: 'concrete', speed: 0, id: '', origin: [0, 0, 0], dir: [0, 0, 0],
      hit: null, store: { point: [0, 0, 0], normal: [0, 0, 0], targetId: null } });
  }
  let evN = 0;

  function ev(t) {
    if (evN >= EV_MAX) return evPool[EV_MAX - 1];
    const e = evPool[evN++];
    e.t = t; e.hit = null; e.id = ''; e.mat = 'concrete'; e.speed = 0;
    events.push(e);
    return e;
  }

  const stPos = [0, 0, 0], stVel = [0, 0, 0];
  const targetsAlive = {};
  const state = { pos: stPos, vel: stVel, yaw: 0, pitch: 0, eye: 1.62, move: 'idle', grounded: false,
    stamina01: 1, ammo: 30, reloading01: null, adsBlend01: 0, speed: 0, spread: 0, targetsAlive: targetsAlive };

  function rnd() {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  }

  function primTopAt(prim, x, z) {
    if (prim.t === 0) return prim.mx[1];
    const pl = prim.planes;
    return clampN((pl[23] - pl[20] * x - pl[22] * z) / pl[21], prim.mn[1], prim.mx[1]);
  }

  function probeSupport(x, z, loY, hiY) {
    let best = -Infinity;
    for (let i = 0; i < nPrims; i++) {
      const prim = prims[i];
      const mn = prim.mn, mx = prim.mx;
      if (x < mn[0] || x > mx[0] || z < mn[2] || z > mx[2]) continue;
      if (mn[1] > hiY) continue;
      if (mx[1] < loY) continue;
      const top = primTopAt(prim, x, z);
      if (top > hiY || top < loY) continue;
      if (top > best) {
        best = top;
        supMat = prim.mat;
        if (prim.t === 0) { supNx = 0; supNy = 1; supNz = 0; }
        else { supNx = prim.planes[20]; supNy = prim.planes[21]; supNz = prim.planes[22]; }
      }
    }
    supTop = best;
    return best;
  }

  function ceilingAt(x, z, y, R) {
    let lo = Infinity;
    for (let i = 0; i < nPrims; i++) {
      const prim = prims[i];
      const mn = prim.mn;
      if (mn[1] <= y + 0.06 || mn[1] >= lo) continue;
      const cx = clampN(x, mn[0], prim.mx[0]);
      const cz = clampN(z, mn[2], prim.mx[2]);
      const dx = x - cx, dz = z - cz;
      if (dx * dx + dz * dz > R * R) continue;
      lo = mn[1];
    }
    return lo;
  }

  function freeAt(x, y, z, H, R) {
    for (let i = 0; i < nPrims; i++) {
      const prim = prims[i];
      const mn = prim.mn, mx = prim.mx;
      if (mn[1] >= y + H || mx[1] <= y + 0.06) continue;
      const cx = clampN(x, mn[0], mx[0]);
      const cz = clampN(z, mn[2], mx[2]);
      if (primTopAt(prim, cx, cz) <= y + 0.06) continue;
      const dx = x - cx, dz = z - cz;
      if (dx * dx + dz * dz > R * R) continue;
      return false;
    }
    return true;
  }

  function wallPush(prim, x, z, R, bandLo, bandHi) {
    const mn = prim.mn, mx = prim.mx;
    if (mn[1] >= bandHi || mx[1] <= bandLo) return false;
    const cx = clampN(x, mn[0], mx[0]);
    const cz = clampN(z, mn[2], mx[2]);
    if (primTopAt(prim, cx, cz) <= bandLo) return false;
    const dx = x - cx, dz = z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 > R * R) return false;
    if (d2 > 1e-10) {
      const dd = Math.sqrt(d2);
      wnx = dx / dd; wnz = dz / dd; wDepth = R - dd;
      return true;
    }
    let best = x - mn[0]; wnx = -1; wnz = 0;
    let t = mx[0] - x;
    if (t < best) { best = t; wnx = 1; wnz = 0; }
    t = z - mn[2];
    if (t < best) { best = t; wnx = 0; wnz = -1; }
    t = mx[2] - z;
    if (t < best) { best = t; wnx = 0; wnz = 1; }
    wDepth = best + R;
    return true;
  }

  function resolveWalls(R, bandLo, bandHi) {
    for (let iter = 0; iter < 3; iter++) {
      let any = false;
      for (let i = 0; i < nPrims; i++) {
        const prim = prims[i];
        if (px + R < prim.mn[0] || px - R > prim.mx[0]) continue;
        if (pz + R < prim.mn[2] || pz - R > prim.mx[2]) continue;
        if (!wallPush(prim, px, pz, R, bandLo, bandHi)) continue;
        if (wDepth <= 1e-7) continue;
        px += wnx * wDepth;
        pz += wnz * wDepth;
        const vn = vx * wnx + vz * wnz;
        if (vn < 0) { vx -= wnx * vn; vz -= wnz * vn; }
        contactWall = true;
        any = true;
      }
      if (!any) break;
    }
  }

  function moveH(dt, R, H) {
    const bandLo = py + k.stepUp;
    const bandHi = py + H;
    const dist = Math.sqrt(vx * vx + vz * vz) * dt;
    let steps = 1;
    if (dist > MAX_SUBSTEP) {
      steps = Math.ceil(dist / MAX_SUBSTEP);
      if (steps > 12) steps = 12;
    }
    const sdt = dt / steps;
    for (let s = 0; s < steps; s++) {
      px += vx * sdt;
      pz += vz * sdt;
      resolveWalls(R, bandLo, bandHi);
    }
  }

  function moveV(dt, R, H, wasG) {
    const pyStart = py;
    const ceil = ceilingAt(px, pz, py, R);
    const top = probeSupport(px, pz, -Infinity, pyStart + k.stepUp + 0.02);
    const hasSup = top > -Infinity;
    const sMat = supMat, sNx = supNx, sNy = supNy, sNz = supNz;
    py += vy * dt;
    if (ceil < Infinity) {
      let lim = ceil - H;
      if (hasSup && lim < top) lim = top;
      if (py > lim) {
        py = lim;
        if (vy > 0) vy = 0;
      }
    }
    contactGround = false;
    if (hasSup && (py <= top + 1e-4 || (wasG && vy <= 0.01 && py <= top + SNAP_DOWN))) {
      py = top;
      if (vy < 0) vy = 0;
      contactGround = true;
      gMat = sMat;
      gndNx = sNx; gndNy = sNy; gndNz = sNz;
    }
  }

  function tryMantle(R) {
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const loY = py + k.stepUp + 0.02;
    const hiY = py + k.mantleMax + 0.02;
    for (let s = 0; s < 3; s++) {
      const d = R + 0.1 + s * (MANTLE_REACH - 0.1) * 0.5;
      const qx = px + fx * d, qz = pz + fz * d;
      if (probeSupport(qx, qz, loY, hiY) === -Infinity) continue;
      const ty = supTop + 0.02;
      if (!freeAt(qx, ty, qz, k.crouchH, R)) continue;
      mFx = px; mFy = py; mFz = pz;
      mTx = qx; mTy = ty; mTz = qz;
      return true;
    }
    return false;
  }

  function rayPrim(prim, ox, oy, oz, dx, dy, dz, maxT) {
    const pl = prim.planes;
    let t0 = 0, t1 = maxT, bi = -1;
    for (let i = 0; i < 24; i += 4) {
      const nx = pl[i], ny = pl[i + 1], nz = pl[i + 2], c = pl[i + 3];
      const den = nx * dx + ny * dy + nz * dz;
      const dist = nx * ox + ny * oy + nz * oz - c;
      if (den > -1e-9 && den < 1e-9) {
        if (dist > 0) return -1;
        continue;
      }
      const t = -dist / den;
      if (den > 0) { if (t < t1) t1 = t; }
      else if (t > t0) { t0 = t; bi = i; }
      if (t0 > t1) return -1;
    }
    if (bi < 0) return -1;
    rnx = pl[bi]; rny = pl[bi + 1]; rnz = pl[bi + 2];
    return t0;
  }

  function syncLook() {
    yaw = yawBase + recY;
    pitch = clampN(pitchBase + recP, -PITCH_LIMIT, PITCH_LIMIT);
  }

  function applyLook(dx, dy) {
    yawBase -= num(dx, 0);
    yawBase -= TAU * Math.round(yawBase / TAU);
    pitchBase = clampN(pitchBase + num(dy, 0), -PITCH_LIMIT, PITCH_LIMIT);
    syncLook();
  }

  function startReload() {
    if (reloading || ammo >= k.magSize) return false;
    reloading = true;
    reloadT = 0;
    ev('reload_start');
    return true;
  }

  function shoot() {
    const idx = shotsInMag % PATTERN_N;
    const first = sinceShot >= FIRST_SHOT_IDLE;
    let sp = 0;
    if (!first) {
      const base = adsBlend > 0.5 ? k.spreadAds : k.spreadHip;
      const mv = Math.sqrt(vx * vx + vz * vz);
      sp = base + k.spreadMove * Math.min(mv / k.sprint, 1) + bloom;
    }
    const cp = Math.cos(pitch), sip = Math.sin(pitch);
    const siy = Math.sin(yaw), cy = Math.cos(yaw);
    let dx = -siy * cp, dy = sip, dz = -cy * cp;
    if (sp > 0) {
      const rad = sp * Math.sqrt(rnd());
      const ang = rnd() * TAU;
      const ox = rad * Math.cos(ang), oy = rad * Math.sin(ang);
      const rx = cy, rz = -siy;
      const upx = -rz * dy;
      const upy = rz * dx - rx * dz;
      const upz = rx * dy;
      dx += rx * ox + upx * oy;
      dy += upy * oy;
      dz += rz * ox + upz * oy;
    }
    const dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    dx /= dl; dy /= dl; dz /= dl;

    const ox2 = px, oy2 = py + eyeH, oz2 = pz;
    let bestT = HIT_RANGE, hitT = -1;
    let hnx = 0, hny = 0, hnz = 0;
    for (let i = 0; i < nT; i++) {
      if (tHp[i] <= 0) continue;
      const ex = tX[i] - ox2, ey = tY[i] - oy2, ez = tZ[i] - oz2;
      const b = ex * dx + ey * dy + ez * dz;
      if (b <= 0) continue;
      const r = tRad[i];
      const cc = ex * ex + ey * ey + ez * ez - r * r;
      const disc = b * b - cc;
      if (disc < 0) continue;
      const t = b - Math.sqrt(disc);
      if (t > 0.05 && t < bestT) {
        bestT = t;
        hitT = i;
        hnx = (ox2 + dx * t - tX[i]) / r;
        hny = (oy2 + dy * t - tY[i]) / r;
        hnz = (oz2 + dz * t - tZ[i]) / r;
      }
    }
    for (let i = 0; i < nPrims; i++) {
      const t = rayPrim(prims[i], ox2, oy2, oz2, dx, dy, dz, bestT);
      if (t > 0.05 && t < bestT) { bestT = t; hitT = -1; hnx = rnx; hny = rny; hnz = rnz; }
    }

    const e = ev('fire');
    e.origin[0] = ox2; e.origin[1] = oy2; e.origin[2] = oz2;
    e.dir[0] = dx; e.dir[1] = dy; e.dir[2] = dz;
    if (bestT < HIT_RANGE) {
      const st = e.store;
      st.point[0] = ox2 + dx * bestT;
      st.point[1] = oy2 + dy * bestT;
      st.point[2] = oz2 + dz * bestT;
      st.normal[0] = hnx; st.normal[1] = hny; st.normal[2] = hnz;
      st.targetId = hitT >= 0 ? tId[hitT] : null;
      e.hit = st;
    }

    if (hitT >= 0) {
      tHp[hitT] -= 1;
      const id = tId[hitT];
      ev('hit_target').id = id;
      if (tHp[hitT] <= 0) {
        tHp[hitT] = 0;
        delete targetsAlive[id];
        ev('target_down').id = id;
      } else targetsAlive[id] = tHp[hitT];
    }

    ammo -= 1;
    shotsInMag += 1;
    sinceShot = 0;
    bloom = Math.min(BLOOM_MAX, bloom + BLOOM_SHOT);

    const w = TAU * RECOIL_HZ;
    const pv = k.recoilV * PATTERN_V[idx];
    const ph = k.recoilH * PATTERN_H[idx];
    pitchBase = clampN(pitchBase + pv * RECOIL_PERM, -PITCH_LIMIT, PITCH_LIMIT);
    yawBase -= ph * RECOIL_PERM;
    recPv += pv * RECOIL_KICK * w * Math.E;
    recYv -= ph * RECOIL_KICK * w * Math.E;
    syncLook();
  }

  function tick(intents, dt) {
    events.length = 0;
    evN = 0;
    let d = num(dt, 1 / 120);
    if (!(d > 0)) return events;
    if (d > 0.05) d = 0.05;
    readK();

    const it = (intents && typeof intents === 'object') ? intents : NO_INTENT;
    const fwdIn = clampN(num(it.forward, 0), -1, 1);
    const strIn = clampN(num(it.strafe, 0), -1, 1);
    const jumpPressed = !!it.jumpPressed;
    const crouchHeld = !!it.crouchHeld;
    const sprintHeld = !!it.sprintHeld;
    const fireHeld = !!it.fireHeld;
    const adsHeld = !!it.adsHeld;
    const reloadPressed = !!it.reloadPressed;

    adsRaw = clampN(adsRaw + (adsHeld ? d / ADS_TIME : -d / ADS_TIME), 0, 1);
    adsBlend = adsRaw * adsRaw * (3 - 2 * adsRaw);

    const w = TAU * RECOIL_HZ;
    recPv += (-w * w * recP - 2 * w * recPv) * d;
    recP += recPv * d;
    recYv += (-w * w * recY - 2 * w * recYv) * d;
    recY += recYv * d;

    bloom -= bloom * BLOOM_DECAY * d;
    if (bloom < 1e-7) bloom = 0;
    sinceShot += d;
    if (dryCd > 0) dryCd -= d;
    if (slideCd > 0) slideCd -= d;
    if (coyoteT > 0) coyoteT -= d;

    const R = k.capsuleR;
    const wasGrounded = grounded;
    const preVy = vy;
    let jumped = false;

    const fwdX = -Math.sin(yaw), fwdZ = -Math.cos(yaw);
    const rgtX = Math.cos(yaw), rgtZ = -Math.sin(yaw);
    let wx = fwdX * fwdIn + rgtX * strIn;
    let wz = fwdZ * fwdIn + rgtZ * strIn;
    let wl = Math.sqrt(wx * wx + wz * wz);
    if (wl > EPS) { wx /= wl; wz /= wl; } else { wx = 0; wz = 0; wl = 0; }
    if (wl > 1) wl = 1;

    if (mantleT > 0) {
      mantleT -= d;
      const u = clampN(1 - mantleT / MANTLE_TIME, 0, 1);
      const uy = clampN(u / 0.6, 0, 1);
      const ey = 1 - (1 - uy) * (1 - uy);
      const uh = clampN((u - 0.3) / 0.7, 0, 1);
      const eh = uh * uh * (3 - 2 * uh);
      px = mFx + (mTx - mFx) * eh;
      py = mFy + (mTy - mFy) * ey;
      pz = mFz + (mTz - mFz) * eh;
      vx = 0; vy = 0; vz = 0;
      capH = Math.max(k.crouchH, capH - HEIGHT_RATE * 2 * d);
      eyeH = k.crouchEye + (k.eye - k.crouchEye) *
        clampN((capH - k.crouchH) / Math.max(0.01, k.height - k.crouchH), 0, 1);
      moveState = 'air';
      if (mantleT <= 0) {
        mantleT = 0;
        px = mTx; py = mTy; pz = mTz;
        moveV(d, R, capH, true);
        grounded = contactGround;
        if (grounded) {
          groundMat = gMat;
          coyoteT = COYOTE;
        }
        vx = fwdX * k.walk * 0.35;
        vz = fwdZ * k.walk * 0.35;
        vy = 0;
        stepDist = 0;
      }
    } else {
      const speedH0 = Math.sqrt(vx * vx + vz * vz);
      const wantSprint = sprintHeld && fwdIn > 0.1 && !crouchHeld;

      let slideFresh = false;
      if (!sliding && wasGrounded && crouchHeld && sprintHeld && fwdIn > 0.1 &&
          speedH0 >= k.walk * SLIDE_ENTRY && slideCd <= 0) {
        sliding = true;
        slideFresh = true;
        slideSpeed = Math.max(speedH0, k.slideBurst);
        slideHead0 = speedH0 > 0.2 ? Math.atan2(-vx, -vz) : yaw;
        slideHead = slideHead0;
        landClampT = 0;
        ev('slide_start');
      }

      if (sliding) {
        if (!slideFresh) slideSpeed -= ((k.slideBurst - k.walk) / k.slideDecay) * d;
        let want = yaw;
        if (wl > EPS) want = Math.atan2(-wx, -wz);
        let rel = want - slideHead0;
        rel -= TAU * Math.round(rel / TAU);
        rel = clampN(rel, -SLIDE_STEER, SLIDE_STEER);
        let dh = slideHead0 + rel - slideHead;
        dh -= TAU * Math.round(dh / TAU);
        const maxStep = SLIDE_RATE * d;
        if (dh > maxStep) dh = maxStep; else if (dh < -maxStep) dh = -maxStep;
        slideHead += dh;
        vx = -Math.sin(slideHead) * slideSpeed;
        vz = -Math.cos(slideHead) * slideSpeed;
        vy = 0;
        if (wasGrounded) {
          const vdn = vx * gndNx + vz * gndNz;
          vx -= gndNx * vdn; vy -= gndNy * vdn; vz -= gndNz * vdn;
        }
      }

      if (jumpPressed && tryMantle(R)) {
        mantleT = MANTLE_TIME;
        mFx = px; mFy = py; mFz = pz;
        if (sliding) { sliding = false; slideCd = SLIDE_CD; ev('slide_end'); }
        grounded = false;
        coyoteT = 0;
        vx = 0; vy = 0; vz = 0;
        moveState = 'air';
        ev('mantle');
      } else {
        if (jumpPressed && (wasGrounded || coyoteT > 0)) {
          vy = k.jumpVel;
          grounded = false;
          coyoteT = 0;
          jumped = true;
          if (sliding) { sliding = false; slideCd = SLIDE_CD; ev('slide_end'); }
          ev('jump');
        }

        if (sliding && (!crouchHeld || slideSpeed <= k.walk)) {
          sliding = false;
          slideCd = SLIDE_CD;
          ev('slide_end');
        }

        let target = k.walk;
        if (crouchHeld && grounded) target = k.walk * CROUCH_SPEED;
        else if (wantSprint) target = k.sprint;
        if (adsBlend > 0.05 && target > k.walk) target = k.walk;
        const wishSpeed = target * wl;

        if (!sliding) {
          const drop = 1 - Math.min(1, k.friction * d);
          if (grounded) {
            const gnx = gndNx, gny = gndNy, gnz = gndNz;
            const vdn = vx * gnx + vy * gny + vz * gnz;
            vx -= gnx * vdn; vy -= gny * vdn; vz -= gnz * vdn;
            if (wl > EPS) {
              let w3x = wx, w3y = 0, w3z = wz;
              const wdn = w3x * gnx + w3z * gnz;
              w3x -= gnx * wdn; w3y -= gny * wdn; w3z -= gnz * wdn;
              const w3l = Math.sqrt(w3x * w3x + w3y * w3y + w3z * w3z);
              if (w3l > EPS) { w3x /= w3l; w3y /= w3l; w3z /= w3l; }
              const along = vx * w3x + vy * w3y + vz * w3z;
              let perpX = vx - w3x * along, perpY = vy - w3y * along, perpZ = vz - w3z * along;
              perpX *= drop; perpY *= drop; perpZ *= drop;
              let newAlong = along;
              if (along < wishSpeed) newAlong = along + Math.min(k.accelGround * d, wishSpeed - along);
              else if (along > wishSpeed) {
                newAlong = Math.max(wishSpeed, along - Math.max(k.friction * d * along, k.friction * d * 0.5));
              }
              vx = w3x * newAlong + perpX;
              vy = w3y * newAlong + perpY;
              vz = w3z * newAlong + perpZ;
            } else {
              vx *= drop; vy *= drop; vz *= drop;
              if (vx * vx + vy * vy + vz * vz < 0.0004) { vx = 0; vy = 0; vz = 0; }
            }
          } else if (wl > EPS) {
            const along = vx * wx + vz * wz;
            const airTarget = Math.min(wishSpeed, k.sprint);
            if (along < airTarget) {
              const a = Math.min(k.accelAir * d, airTarget - along);
              vx += wx * a;
              vz += wz * a;
            }
          }
        }

        if (!grounded && !jumped) vy -= k.gravity * d;

        if (landClampT > 0) {
          if (grounded) {
            landClampT -= d;
            const u = clampN(1 - Math.max(0, landClampT) / LAND_CLAMP, 0, 1);
            const cap = landClampFrom + (k.sprint - landClampFrom) * u;
            const sp = Math.sqrt(vx * vx + vz * vz);
            if (sp > cap && sp > EPS) {
              const f = cap / sp;
              vx *= f; vz *= f;
              if (sliding) slideSpeed = cap;
            }
            if (landClampT <= 0) landClampT = 0;
          } else landClampT = 0;
        }

        let targetH = (crouchHeld || sliding) ? k.crouchH : k.height;
        const headCeil = ceilingAt(px, pz, py, R);
        crouchLock = headCeil < Infinity && headCeil - py < targetH;
        if (crouchLock) targetH = k.crouchH;
        if (targetH > capH) capH = Math.min(targetH, capH + HEIGHT_RATE * d);
        else if (targetH < capH) capH = Math.max(targetH, capH - HEIGHT_RATE * d);
        eyeH = k.crouchEye + (k.eye - k.crouchEye) *
          clampN((capH - k.crouchH) / Math.max(0.01, k.height - k.crouchH), 0, 1);

        const sx = px, sz = pz;
        contactWall = false;
        moveH(d, R, capH);
        moveV(d, R, capH, wasGrounded && !jumped);

        if (contactGround) {
          groundMat = gMat;
          coyoteT = COYOTE;
          if (!wasGrounded) {
            const impact = preVy < 0 ? -preVy : 0;
            if (impact > LAND_MIN) ev('land').speed = impact;
            const sp = Math.sqrt(vx * vx + vz * vz);
            if (sp > k.sprint + 0.02) { landClampT = LAND_CLAMP; landClampFrom = sp; }
            stepDist = 0;
          }
        } else if (sliding) {
          sliding = false;
          slideCd = SLIDE_CD;
          ev('slide_end');
        }
        grounded = contactGround;

        const mdx = px - sx, mdz = pz - sz;
        const moved = Math.sqrt(mdx * mdx + mdz * mdz);
        const speedH = Math.sqrt(vx * vx + vz * vz);

        if (sliding) moveState = 'slide';
        else if (!grounded) moveState = 'air';
        else if (crouchHeld || crouchLock) moveState = 'crouch';
        else if (wantSprint && speedH > k.walk * 0.6) moveState = 'sprint';
        else if (speedH > 0.4) moveState = 'walk';
        else moveState = 'idle';

        if (grounded && !sliding && speedH > 0.5) {
          stepDist += moved;
          if (stepDist >= (moveState === 'sprint' ? STEP_SPRINT : STEP_WALK)) {
            stepDist = 0;
            ev('step').mat = stepMat(groundMat);
          }
        } else if (!grounded) stepDist = 0;
      }
    }

    if (moveState === 'sprint') stamina = Math.max(0, stamina - d);
    else stamina = Math.min(k.staminaMax, stamina + d * STAMINA_REGEN);

    if (reloadPressed) startReload();
    if (reloading) {
      reloadT += d;
      if (reloadT >= k.reloadTime) {
        reloading = false;
        reloadT = 0;
        ammo = k.magSize;
        shotsInMag = 0;
        ev('reload_done');
      }
    }

    const interval = 60 / k.rpm;
    fireCd -= d;
    if (fireCd < -interval) fireCd = -interval;
    if (fireHeld && !reloading && mantleT <= 0) {
      if (ammo > 0) {
        let guard = 0;
        while (fireCd <= 0 && ammo > 0 && guard < 4) {
          shoot();
          fireCd += interval;
          guard++;
        }
        if (fireCd < 0) fireCd = 0;
      } else if (dryCd <= 0) {
        dryCd = DRY_CD;
        ev('dry');
        startReload();
      }
    }

    const baseSp = adsBlend > 0.5 ? k.spreadAds : k.spreadHip;
    const spNow = Math.sqrt(vx * vx + vz * vz);
    curSpread = baseSp + k.spreadMove * Math.min(spNow / k.sprint, 1) + bloom;

    if (px !== px || py !== py || pz !== pz) { px = spawnX; py = spawnY; pz = spawnZ; }
    if (vx !== vx || vy !== vy || vz !== vz) { vx = 0; vy = 0; vz = 0; }

    syncLook();
    return events;
  }

  function getState() {
    stPos[0] = px; stPos[1] = py; stPos[2] = pz;
    stVel[0] = vx; stVel[1] = vy; stVel[2] = vz;
    state.yaw = yaw;
    state.pitch = pitch;
    state.eye = eyeH;
    state.move = moveState;
    state.grounded = grounded;
    state.stamina01 = clampN(stamina / k.staminaMax, 0, 1);
    state.ammo = ammo;
    state.reloading01 = reloading ? clampN(reloadT / k.reloadTime, 0, 1) : null;
    state.adsBlend01 = adsBlend;
    state.speed = Math.sqrt(vx * vx + vz * vz);
    state.spread = curSpread;
    return state;
  }

  function reset() {
    readK();
    px = spawnX; py = spawnY; pz = spawnZ;
    vx = 0; vy = 0; vz = 0;
    yawBase = spawnYaw; pitchBase = 0;
    recP = 0; recPv = 0; recY = 0; recYv = 0;
    syncLook();
    grounded = false;
    coyoteT = 0;
    capH = k.height;
    eyeH = k.eye;
    crouchLock = false;
    moveState = 'idle';
    sliding = false; slideSpeed = 0; slideHead = 0; slideHead0 = 0; slideCd = 0;
    mantleT = 0;
    stamina = k.staminaMax;
    ammo = k.magSize;
    shotsInMag = 0;
    reloading = false;
    reloadT = 0;
    fireCd = 0;
    sinceShot = 9;
    bloom = 0;
    dryCd = 0;
    adsRaw = 0;
    adsBlend = 0;
    stepDist = 0;
    landClampT = 0;
    landClampFrom = 0;
    groundMat = 'concrete';
    curSpread = k.spreadHip;
    seed = SEED0;
    events.length = 0;
    evN = 0;
    contactGround = false;
    contactWall = false;
    gMat = 'concrete';
    gndNx = 0; gndNy = 1; gndNz = 0;
    for (const id in targetsAlive) delete targetsAlive[id];
    for (let i = 0; i < nT; i++) {
      tHp[i] = tHp0[i];
      targetsAlive[tId[i]] = tHp0[i];
    }
    if (probeSupport(px, pz, -Infinity, py + 0.02) > -Infinity && py - supTop < 1.0) {
      py = supTop;
      grounded = true;
      groundMat = supMat;
      gndNx = supNx; gndNy = supNy; gndNz = supNz;
    }
  }

  reset();

  return { tick: tick, applyLook: applyLook, getState: getState, reset: reset };
}
