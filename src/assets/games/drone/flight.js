import { DEG, clamp, lerp, smoothstep, wrapAngle, qcopy, qmul, qnorm, qconj, qRotate, qIntegrateBody, qFromYawPitchRoll, qSlerp, v3copy } from '../kit/math.js';

const RC_RATE_INCREMENTAL = 14.54;
const BODY_UP = { x: 0, y: 1, z: 0 };
const BODY_FWD = { x: 0, y: 0, z: -1 };
const BODY_RIGHT = { x: 1, y: 0, z: 0 };
const ZERO_INPUT = { throttle: 0, roll: 0, pitch: 0, yaw: 0, mode: 'acro' };

export const DRONE_DEFAULTS = {
  mass: 0.65,
  gravity: 9.81,
  thrustToWeight: 4.5,
  hoverThrottle: 0.35,
  idle: 0.055,
  motorTau: 0.03,
  rateTau: 0.026,
  maxAngularAccel: 240,
  rates: {
    roll: { rc: 1.0, superRate: 0.7, expo: 0.2 },
    pitch: { rc: 1.0, superRate: 0.7, expo: 0.2 },
    yaw: { rc: 1.0, superRate: 0.7, expo: 0.2 },
  },
  angleLimit: 55 * DEG,
  angleGain: 8,
  angleRateLimit: 500 * DEG,
  angleYawScale: 0.45,
  angleHeadingSlack: 0.6,
  angleTiltComp: 1,
  airDensity: 1.225,
  dragAreaSide: 0.01,
  dragAreaTop: 0.033,
  linearDrag: 0.03,
  rotorDrag: 0.12,
  inflowSpeed: 58,
  inflowGain: 0.3,
  propWash: 1,
  washAccel: 30,
  radius: 0.12,
  crashSpeed: 7,
  restitution: 0.3,
  friction: 0.6,
  tumble: 7,
  crashSpinDamping: 1.2,
  cameraTilt: 25 * DEG,
  cameraOffset: { x: 0, y: 0.028, z: -0.07 },
  batterySeconds: 95,
  cells: 6,
};

const T_UP = { x: 0, y: 1, z: 0 };
const T_A = { x: 0, y: 0, z: 0 };
const T_B = { x: 0, y: 0, z: 0 };
const T_N = { x: 0, y: 1, z: 0 };
const T_DRAG = { x: 0, y: 0, z: 0 };
const T_SP = { x: 0, y: 0, z: 0 };
const T_E = { x: 0, y: 0, z: 0 };
const Q_A = { x: 0, y: 0, z: 0, w: 1 };
const Q_B = { x: 0, y: 0, z: 0, w: 1 };
const Q_C = { x: 0, y: 0, z: 0, w: 1 };
const HIT = { depth: 0, nx: 0, ny: 1, nz: 0, terrain: false };

function num(v, d) {
  return typeof v === 'number' && Number.isFinite(v) ? v : d;
}

function mergeParams(base, over) {
  const o = over || {};
  const p = Object.assign({}, base, o);
  const r = o.rates || {};
  p.rates = {
    roll: Object.assign({}, base.rates.roll, r.roll || {}),
    pitch: Object.assign({}, base.rates.pitch, r.pitch || {}),
    yaw: Object.assign({}, base.rates.yaw, r.yaw || {}),
  };
  p.cameraOffset = Object.assign({}, base.cameraOffset, o.cameraOffset || {});
  delete p.pos;
  delete p.yaw;
  p.weight = p.mass * p.gravity;
  p.maxThrust = p.weight * p.thrustToWeight;
  const mh = p.idle + (1 - p.idle) * p.hoverThrottle;
  p.curveA = clamp((1 / p.thrustToWeight - mh * mh) / (mh - mh * mh), 0, 1);
  return p;
}

export function thrustCurve(m, a) {
  return m * (a + (1 - a) * m);
}

export function thrustCurveInverse(f, a) {
  if (f <= 0) return 0;
  if (a >= 0.9999) return f;
  return (-a + Math.sqrt(a * a + 4 * (1 - a) * f)) / (2 * (1 - a));
}

export function shapeStick(stick, expo) {
  const x = clamp(stick, -1, 1);
  const ax = Math.abs(x);
  const e = expo || 0;
  return x * ax * ax * ax * e + x * (1 - e);
}

export function rateCurve(stick, rates) {
  const x = clamp(num(stick, 0), -1, 1);
  const ax = Math.abs(x);
  let rc = rates.rc;
  if (rc > 2) rc += RC_RATE_INCREMENTAL * (rc - 2);
  let rate = 200 * rc * shapeStick(x, rates.expo);
  if (rates.superRate) rate /= clamp(1 - ax * rates.superRate, 0.01, 1);
  return rate;
}

export function maxRate(rates) {
  return rateCurve(1, rates);
}

export function rateToStick(rateDeg, rates) {
  const target = Math.abs(rateDeg);
  const top = rateCurve(1, rates);
  if (target >= top) return Math.sign(rateDeg) || 0;
  let lo = 0, hi = 1;
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) * 0.5;
    if (rateCurve(mid, rates) < target) lo = mid; else hi = mid;
  }
  return Math.sign(rateDeg) * (lo + hi) * 0.5;
}

export function headingOf(quat) {
  qRotate(T_A, quat, BODY_RIGHT);
  if (Math.abs(T_A.y) < 0.9) return Math.atan2(-T_A.z, T_A.x);
  qRotate(T_B, quat, BODY_FWD);
  return Math.atan2(-T_B.x, -T_B.z);
}

function hashUnit(n) {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return ((h >>> 0) / 4294967295) * 2 - 1;
}

function noise1(t, k) {
  const i = Math.floor(t);
  const f = t - i;
  const u = f * f * (3 - 2 * f);
  return lerp(hashUnit(i * 131 + k * 7919), hashUnit((i + 1) * 131 + k * 7919), u);
}

function rotationError(qa, qd, out) {
  qconj(Q_C, qa);
  qmul(Q_C, Q_C, qd);
  if (Q_C.w < 0) { Q_C.x = -Q_C.x; Q_C.y = -Q_C.y; Q_C.z = -Q_C.z; Q_C.w = -Q_C.w; }
  const vn = Math.sqrt(Q_C.x * Q_C.x + Q_C.y * Q_C.y + Q_C.z * Q_C.z);
  const k = vn > 1e-9 ? (2 * Math.atan2(vn, Q_C.w)) / vn : 2;
  out.x = Q_C.x * k; out.y = Q_C.y * k; out.z = Q_C.z * k;
  return out;
}

export function dragForce(p, vel, up, motor, out) {
  const vx = vel.x, vy = vel.y, vz = vel.z;
  const spd = Math.sqrt(vx * vx + vy * vy + vz * vz);
  out.x = 0; out.y = 0; out.z = 0;
  if (spd < 1e-6) return out;
  const vAx = vx * up.x + vy * up.y + vz * up.z;
  const c = vAx / spd;
  const area = p.dragAreaSide + (p.dragAreaTop - p.dragAreaSide) * c * c;
  const k = 0.5 * p.airDensity * area * spd + p.linearDrag;
  const rd = p.rotorDrag * (0.3 + 0.7 * motor);
  const px = vx - vAx * up.x, py = vy - vAx * up.y, pz = vz - vAx * up.z;
  out.x = -k * vx - rd * px;
  out.y = -k * vy - rd * py;
  out.z = -k * vz - rd * pz;
  return out;
}

export function inflowFactor(p, vAxial, motor) {
  return clamp(1 - (p.inflowGain * vAxial) / (p.inflowSpeed * Math.max(motor, 0.25)), 0.3, 1.08);
}

export function createDrone(params = {}) {
  const p = mergeParams(DRONE_DEFAULTS, params);
  const s = {
    params: p,
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    quat: { x: 0, y: 0, z: 0, w: 1 },
    rate: { x: 0, y: 0, z: 0 },
    prevPos: { x: 0, y: 0, z: 0 },
    prevQuat: { x: 0, y: 0, z: 0, w: 1 },
    mode: 'acro',
    heading: 0,
    throttle: 0,
    motor: p.idle,
    motors: [p.idle, p.idle, p.idle, p.idle],
    rpm: 0,
    load: 0,
    thrust: 0,
    thrustFrac: 0,
    wash: 0,
    speed: 0,
    speedKmh: 0,
    altitude: 0,
    vspeed: 0,
    tilt: 0,
    gforce: 1,
    crashed: false,
    crashReason: '',
    crashSpeed: 0,
    contact: false,
    grounded: false,
    impact: 0,
    impactNormal: { x: 0, y: 1, z: 0 },
    impacts: 0,
    battery: 1,
    voltage: p.cells * 4.2,
    time: 0,
    steps: 0,
  };
  resetDrone(s, { pos: params.pos, yaw: params.yaw });
  return s;
}

export function configureDrone(s, patch) {
  s.params = mergeParams(Object.assign({}, s.params, { rates: s.params.rates, cameraOffset: s.params.cameraOffset }), patch);
  return s;
}

export function resetDrone(s, opts = {}) {
  const pos = opts.pos;
  if (Array.isArray(pos)) { s.pos.x = num(pos[0], 0); s.pos.y = num(pos[1], 0); s.pos.z = num(pos[2], 0); }
  else if (pos) { s.pos.x = num(pos.x, 0); s.pos.y = num(pos.y, 0); s.pos.z = num(pos.z, 0); }
  const yaw = num(opts.yaw, 0);
  v3copy(s.prevPos, s.pos);
  s.vel.x = 0; s.vel.y = 0; s.vel.z = 0;
  s.rate.x = 0; s.rate.y = 0; s.rate.z = 0;
  qFromYawPitchRoll(s.quat, yaw, 0, 0);
  qcopy(s.prevQuat, s.quat);
  s.heading = yaw;
  s.motor = s.params.idle;
  for (let i = 0; i < 4; i++) s.motors[i] = s.params.idle;
  s.rpm = s.params.idle;
  s.load = 0;
  s.thrust = 0;
  s.thrustFrac = 0;
  s.wash = 0;
  s.speed = 0;
  s.speedKmh = 0;
  s.vspeed = 0;
  s.tilt = 0;
  s.gforce = 1;
  s.crashed = false;
  s.crashReason = '';
  s.crashSpeed = 0;
  s.contact = false;
  s.grounded = opts.grounded !== false;
  s.impact = 0;
  s.impacts = 0;
  if (opts.battery !== false) { s.battery = 1; s.voltage = s.params.cells * 4.2; }
  s.time = 0;
  s.steps = 0;
  return s;
}

function angleSetpoint(s, roll, pitch, yaw, dt, out) {
  const p = s.params;
  const yawRate = -rateCurve(yaw, p.rates.yaw) * DEG * p.angleYawScale;
  const cur = headingOf(s.quat);
  let h = wrapAngle(s.heading + yawRate * dt);
  const lag = wrapAngle(h - cur);
  if (lag > p.angleHeadingSlack) h = wrapAngle(cur + p.angleHeadingSlack);
  else if (lag < -p.angleHeadingSlack) h = wrapAngle(cur - p.angleHeadingSlack);
  s.heading = h;
  const pa = -shapeStick(pitch, p.rates.pitch.expo) * p.angleLimit;
  const ra = -shapeStick(roll, p.rates.roll.expo) * p.angleLimit;
  qFromYawPitchRoll(Q_A, h, pa, ra);
  rotationError(s.quat, Q_A, T_E);
  qconj(Q_B, s.quat);
  T_B.x = 0; T_B.y = yawRate; T_B.z = 0;
  qRotate(T_B, Q_B, T_B);
  const lim = p.angleRateLimit;
  out.x = clamp(T_E.x * p.angleGain + T_B.x, -lim, lim);
  out.y = clamp(T_E.y * p.angleGain + T_B.y, -lim, lim);
  out.z = clamp(T_E.z * p.angleGain + T_B.z, -lim, lim);
  return out;
}

function probe(world, p, x, y, z, r) {
  let best = 0;
  if (world.heightAt) {
    const h = world.heightAt(x, z);
    if (y - h < r * 2) {
      const e = 0.4;
      const hx = world.heightAt(x + e, z) - world.heightAt(x - e, z);
      const hz = world.heightAt(x, z + e) - world.heightAt(x, z - e);
      let nx = -hx, ny = 2 * e, nz = -hz;
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx /= l; ny /= l; nz /= l;
      const depth = r - (y - h) * ny;
      if (depth > 0) {
        best = depth;
        HIT.depth = depth; HIT.nx = nx; HIT.ny = ny; HIT.nz = nz; HIT.terrain = true;
      }
    }
  }
  if (world.sphereVsWorld) {
    T_N.x = x; T_N.y = y; T_N.z = z;
    const res = world.sphereVsWorld(T_N, r);
    if (res && res.hit && res.normal && res.depth > best) {
      best = res.depth;
      HIT.depth = res.depth; HIT.nx = res.normal.x; HIT.ny = res.normal.y; HIT.nz = res.normal.z; HIT.terrain = false;
    }
  }
  return best > 0;
}

function collide(s, world) {
  const p = s.params;
  const r = p.radius;
  s.contact = false;
  s.impact = 0;
  const fx = s.prevPos.x, fy = s.prevPos.y, fz = s.prevPos.z;
  const dx = s.pos.x - fx, dy = s.pos.y - fy, dz = s.pos.z - fz;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const n = Math.min(8, Math.max(1, Math.ceil(dist / (r * 0.8))));
  let hit = false;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const x = fx + dx * t, y = fy + dy * t, z = fz + dz * t;
    if (probe(world, p, x, y, z, r)) {
      s.pos.x = x; s.pos.y = y; s.pos.z = z;
      hit = true;
      break;
    }
  }
  if (!hit) { s.grounded = false; return; }
  const nx = HIT.nx, ny = HIT.ny, nz = HIT.nz;
  s.contact = true;
  s.pos.x += nx * (HIT.depth + 1e-4);
  s.pos.y += ny * (HIT.depth + 1e-4);
  s.pos.z += nz * (HIT.depth + 1e-4);
  s.impactNormal.x = nx; s.impactNormal.y = ny; s.impactNormal.z = nz;
  const v = s.vel;
  const vn = v.x * nx + v.y * ny + v.z * nz;
  if (vn < 0) {
    const speedIn = -vn;
    s.impact = speedIn;
    if (speedIn > 1) s.impacts++;
    if (speedIn > p.crashSpeed && !s.crashed) {
      s.crashed = true;
      s.crashReason = 'impact';
      s.crashSpeed = speedIn;
    }
    const e = speedIn < 0.6 ? 0 : (s.crashed ? p.restitution * 0.5 : p.restitution);
    v.x -= (1 + e) * vn * nx; v.y -= (1 + e) * vn * ny; v.z -= (1 + e) * vn * nz;
    const vt = v.x * nx + v.y * ny + v.z * nz;
    const tx = v.x - vt * nx, ty = v.y - vt * ny, tz = v.z - vt * nz;
    const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
    if (tl > 1e-6) {
      const mu = s.crashed ? p.friction * 1.6 : p.friction;
      const keep = Math.max(0, 1 - (mu * (1 + e) * speedIn) / tl);
      v.x = vt * nx + tx * keep; v.y = vt * ny + ty * keep; v.z = vt * nz + tz * keep;
      if (speedIn > 1 || tl > 2.5) {
        const k = p.tumble * clamp(speedIn / 4, 0.15, 1.5);
        T_A.x = (ny * tz - nz * ty) / tl * k;
        T_A.y = (nz * tx - nx * tz) / tl * k;
        T_A.z = (nx * ty - ny * tx) / tl * k;
        qconj(Q_B, s.quat);
        qRotate(T_A, Q_B, T_A);
        s.rate.x += T_A.x; s.rate.y += T_A.y; s.rate.z += T_A.z;
      }
    }
  }
  qRotate(T_UP, s.quat, BODY_UP);
  const upDotN = T_UP.x * nx + T_UP.y * ny + T_UP.z * nz;
  const spd = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  const lift = s.thrust * Math.max(0, upDotN);
  if (HIT.terrain && ny > 0.6 && spd < 2 && upDotN < -0.3 && !s.crashed) {
    s.crashed = true;
    s.crashReason = 'flipped';
    s.crashSpeed = spd;
  }
  s.grounded = HIT.terrain && ny > 0.6 && spd < 2.2 && upDotN > 0.4 && lift < p.weight * ny * 1.02;
}

function settleOnGround(s, dt) {
  const n = s.impactNormal;
  const h = headingOf(s.quat);
  qFromYawPitchRoll(Q_A, h, 0, 0);
  T_A.x = 0; T_A.y = 1; T_A.z = 0;
  const cx = T_A.y * n.z - T_A.z * n.y;
  const cy = T_A.z * n.x - T_A.x * n.z;
  const cz = T_A.x * n.y - T_A.y * n.x;
  const sn = Math.sqrt(cx * cx + cy * cy + cz * cz);
  if (sn > 1e-6) {
    const ang = Math.atan2(sn, n.y);
    const hs = Math.sin(ang / 2) / sn;
    Q_B.x = cx * hs; Q_B.y = cy * hs; Q_B.z = cz * hs; Q_B.w = Math.cos(ang / 2);
    qmul(Q_A, Q_B, Q_A);
  }
  qSlerp(s.quat, s.quat, Q_A, 1 - Math.exp(-14 * dt));
  const k = Math.exp(-10 * dt);
  s.vel.x *= k; s.vel.z *= k;
  if (s.vel.y < 0) s.vel.y *= k;
}

export function step(s, input, dt, world) {
  const p = s.params;
  if (!(dt > 0)) return s;
  if (dt > 0.05) dt = 0.05;
  const w0 = world || {};
  v3copy(s.prevPos, s.pos);
  qcopy(s.prevQuat, s.quat);
  const inp = input || ZERO_INPUT;
  const thr = clamp(num(inp.throttle, 0), 0, 1);
  const sr = clamp(num(inp.roll, 0), -1, 1);
  const sp = clamp(num(inp.pitch, 0), -1, 1);
  const sy = clamp(num(inp.yaw, 0), -1, 1);
  const mode = inp.mode === 'angle' ? 'angle' : 'acro';
  if (mode !== s.mode) { s.mode = mode; s.heading = headingOf(s.quat); }
  s.throttle = thr;
  const w = s.rate;
  const v = s.vel;
  let tx = 0, ty = 0, tz = 0;
  if (!s.crashed) {
    if (mode === 'acro') {
      tx = -rateCurve(sp, p.rates.pitch) * DEG;
      ty = -rateCurve(sy, p.rates.yaw) * DEG;
      tz = -rateCurve(sr, p.rates.roll) * DEG;
    } else {
      angleSetpoint(s, sr, sp, sy, dt, T_SP);
      tx = T_SP.x; ty = T_SP.y; tz = T_SP.z;
    }
  }
  const w0x = w.x, w0y = w.y, w0z = w.z;
  if (s.crashed) {
    const k = Math.exp(-p.crashSpinDamping * dt);
    w.x *= k; w.y *= k; w.z *= k;
  } else if (s.grounded) {
    const k = Math.exp(-30 * dt);
    w.x *= k; w.y *= k; w.z *= k;
    if (mode === 'angle') s.heading = headingOf(s.quat);
  } else {
    const k = 1 - Math.exp(-dt / p.rateTau);
    const lim = p.maxAngularAccel * dt;
    w.x += clamp((tx - w.x) * k, -lim, lim);
    w.y += clamp((ty - w.y) * k, -lim, lim);
    w.z += clamp((tz - w.z) * k, -lim, lim);
  }
  qRotate(T_UP, s.quat, BODY_UP);
  const spd0 = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  const vAx0 = v.x * T_UP.x + v.y * T_UP.y + v.z * T_UP.z;
  const vPerp0 = Math.sqrt(Math.max(0, spd0 * spd0 - vAx0 * vAx0));
  let wash = 0;
  if (!s.crashed && !s.grounded && p.propWash > 0) {
    wash = smoothstep(1.5, 5, -vAx0) * (1 - smoothstep(3, 8, vPerp0)) * smoothstep(0.12, 0.35, s.thrustFrac) * p.propWash;
    if (wash > 0) {
      const t = s.time * 19;
      const a = p.washAccel * wash * dt;
      w.x += noise1(t, 11) * a;
      w.z += noise1(t, 23) * a;
      w.y += noise1(t, 37) * a * 0.4;
    }
  }
  s.wash = wash;
  qIntegrateBody(s.quat, s.quat, (w0x + w.x) * 0.5, (w0y + w.y) * 0.5, (w0z + w.z) * 0.5, dt);
  qRotate(T_UP, s.quat, BODY_UP);
  let cmd = 0;
  if (!s.crashed) {
    cmd = p.idle + (1 - p.idle) * thr;
    if (mode === 'angle' && p.angleTiltComp > 0 && T_UP.y > 0.2 && !s.grounded) {
      const f = thrustCurve(cmd, p.curveA) * (1 + p.angleTiltComp * (1 / Math.max(T_UP.y, 0.55) - 1));
      cmd = thrustCurveInverse(Math.min(f, 1), p.curveA);
    }
  }
  const m0 = s.motor;
  s.motor += (cmd - s.motor) * (1 - Math.exp(-dt / p.motorTau));
  const vAx = v.x * T_UP.x + v.y * T_UP.y + v.z * T_UP.z;
  const tf = thrustCurve(s.motor, p.curveA);
  s.thrustFrac = tf;
  const thrust = p.maxThrust * tf * inflowFactor(p, vAx, s.motor) * (1 - 0.12 * wash);
  s.thrust = thrust;
  dragForce(p, v, T_UP, s.motor, T_DRAG);
  const fx = T_UP.x * thrust + T_DRAG.x;
  const fy = T_UP.y * thrust + T_DRAG.y;
  const fz = T_UP.z * thrust + T_DRAG.z;
  s.gforce = Math.sqrt(fx * fx + fy * fy + fz * fz) / p.weight;
  v.x += (fx / p.mass) * dt;
  v.y += (fy / p.mass - p.gravity) * dt;
  v.z += (fz / p.mass) * dt;
  s.pos.x += v.x * dt;
  s.pos.y += v.y * dt;
  s.pos.z += v.z * dt;
  if (w0.heightAt || w0.sphereVsWorld) collide(s, w0);
  else { s.contact = false; s.grounded = false; s.impact = 0; }
  if (s.grounded) settleOnGround(s, dt);
  if (!(Number.isFinite(s.pos.x) && Number.isFinite(s.pos.y) && Number.isFinite(s.pos.z) && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z) && Number.isFinite(s.quat.w) && Number.isFinite(w.x) && Number.isFinite(w.y) && Number.isFinite(w.z))) {
    v3copy(s.pos, s.prevPos);
    qcopy(s.quat, s.prevQuat);
    v.x = 0; v.y = 0; v.z = 0;
    w.x = 0; w.y = 0; w.z = 0;
  }
  qnorm(s.quat, s.quat);
  const iw = 1 / dt;
  const ax = (w.x - w0x) * iw, ay = (w.y - w0y) * iw, az = (w.z - w0z) * iw;
  const kd = 0.16 / p.maxAngularAccel;
  const pitchUp = ax * kd, rollRight = -az * kd, yawLeft = ay * kd * 0.6;
  const mm = s.motor;
  s.motors[0] = clamp(mm - pitchUp - rollRight + yawLeft, 0, 1);
  s.motors[1] = clamp(mm + pitchUp - rollRight - yawLeft, 0, 1);
  s.motors[2] = clamp(mm - pitchUp + rollRight - yawLeft, 0, 1);
  s.motors[3] = clamp(mm + pitchUp + rollRight + yawLeft, 0, 1);
  s.rpm = (s.motors[0] + s.motors[1] + s.motors[2] + s.motors[3]) * 0.25;
  const effort = Math.sqrt(ax * ax + ay * ay + az * az) / p.maxAngularAccel;
  s.load = clamp(0.55 * effort + 6 * Math.abs(s.motor - m0) * iw * p.motorTau * 0.2 + 0.25 * tf, 0, 1);
  const spd = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  s.speed = spd;
  s.speedKmh = spd * 3.6;
  s.vspeed = v.y;
  s.tilt = Math.acos(clamp(T_UP.y, -1, 1)) / DEG;
  s.altitude = w0.heightAt ? s.pos.y - w0.heightAt(s.pos.x, s.pos.z) : s.pos.y;
  s.battery = Math.max(0, s.battery - ((0.12 + 0.88 * Math.pow(tf, 1.5)) * dt) / p.batterySeconds);
  s.voltage = p.cells * Math.max(3.0, 3.3 + 0.9 * s.battery - 0.45 * tf);
  s.time += dt;
  s.steps++;
  return s;
}

export function cameraQuat(s, out, tilt) {
  const t = tilt == null ? s.params.cameraTilt : tilt;
  Q_A.x = Math.sin(t / 2); Q_A.y = 0; Q_A.z = 0; Q_A.w = Math.cos(t / 2);
  const o = out || { x: 0, y: 0, z: 0, w: 1 };
  return qmul(o, s.quat, Q_A);
}

export function cameraPos(s, out) {
  const o = out || { x: 0, y: 0, z: 0 };
  qRotate(o, s.quat, s.params.cameraOffset);
  o.x += s.pos.x; o.y += s.pos.y; o.z += s.pos.z;
  return o;
}

export function interpolateDrone(s, alpha, outPos, outQuat) {
  const a = clamp(num(alpha, 1), 0, 1);
  if (outPos) {
    outPos.x = lerp(s.prevPos.x, s.pos.x, a);
    outPos.y = lerp(s.prevPos.y, s.pos.y, a);
    outPos.z = lerp(s.prevPos.z, s.pos.z, a);
  }
  if (outQuat) qSlerp(outQuat, s.prevQuat, s.quat, a);
  return s;
}

export function gateFrame(gate, out) {
  const o = out || {};
  const pos = gate.pos;
  const yaw = num(gate.yaw, 0);
  const pitch = num(gate.pitch, 0);
  const q = qFromYawPitchRoll({ x: 0, y: 0, z: 0, w: 1 }, yaw, pitch, 0);
  o.pos = { x: pos[0], y: pos[1], z: pos[2] };
  o.quat = q;
  o.normal = qRotate({ x: 0, y: 0, z: 0 }, q, BODY_FWD);
  o.right = qRotate({ x: 0, y: 0, z: 0 }, q, BODY_RIGHT);
  o.up = qRotate({ x: 0, y: 0, z: 0 }, q, BODY_UP);
  o.halfW = (gate.w || 3) / 2;
  o.halfH = (gate.h || 3) / 2;
  return o;
}

export function courseCheckpoints(course) {
  return course.gates.map((g) => {
    const f = gateFrame(g);
    return { pos: f.pos, normal: f.normal, right: f.right, up: f.up, halfW: f.halfW, halfH: f.halfH };
  });
}

export function gateCrossing(cp, a, b) {
  const n = cp.normal;
  const da = (a.x - cp.pos.x) * n.x + (a.y - cp.pos.y) * n.y + (a.z - cp.pos.z) * n.z;
  const db = (b.x - cp.pos.x) * n.x + (b.y - cp.pos.y) * n.y + (b.z - cp.pos.z) * n.z;
  if (!(da < 0 && db >= 0)) return -1;
  const t = da / (da - db);
  const x = a.x + (b.x - a.x) * t - cp.pos.x;
  const y = a.y + (b.y - a.y) * t - cp.pos.y;
  const z = a.z + (b.z - a.z) * t - cp.pos.z;
  const u = x * cp.right.x + y * cp.right.y + z * cp.right.z;
  const h = x * cp.up.x + y * cp.up.y + z * cp.up.z;
  if (Math.abs(u) > cp.halfW || Math.abs(h) > cp.halfH) return -1;
  return t;
}

function catmull(p0, p1, p2, p3, t, out) {
  const d01 = Math.max(Math.pow(dist3(p0, p1), 0.5), 1e-4);
  const d12 = Math.max(Math.pow(dist3(p1, p2), 0.5), 1e-4);
  const d23 = Math.max(Math.pow(dist3(p2, p3), 0.5), 1e-4);
  for (const k of ['x', 'y', 'z']) {
    const m1 = (p2[k] - p1[k] + d12 * ((p1[k] - p0[k]) / d01 - (p2[k] - p0[k]) / (d01 + d12)));
    const m2 = (p2[k] - p1[k] + d12 * ((p3[k] - p2[k]) / d23 - (p3[k] - p1[k]) / (d12 + d23)));
    const a = 2 * p1[k] - 2 * p2[k] + m1 + m2;
    const b = -3 * p1[k] + 3 * p2[k] - 2 * m1 - m2;
    out[k] = ((a * t + b) * t + m1) * t + p1[k];
  }
  return out;
}

function dist3(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function buildRacingLine(course, opts = {}) {
  const o = Object.assign({ approach: 7, minApproach: 2.5, takeoff: 1.8, runout: 12, ds: 0.5 }, opts);
  const frames = course.gates.map((g) => gateFrame(g));
  const st = course.start;
  const sp = Array.isArray(st.pos) ? { x: st.pos[0], y: st.pos[1], z: st.pos[2] } : st.pos;
  const sy = num(st.yaw, 0);
  const fwd = { x: -Math.sin(sy), y: 0, z: -Math.cos(sy) };
  const pts = [{ x: sp.x, y: sp.y, z: sp.z }];
  pts.push({ x: sp.x + fwd.x * 1.5, y: sp.y + o.takeoff, z: sp.z + fwd.z * 1.5 });
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const prev = i === 0 ? pts[pts.length - 1] : frames[i - 1].pos;
    const next = i + 1 < frames.length ? frames[i + 1].pos : null;
    const dPrev = dist3(prev, f.pos);
    const dNext = next ? dist3(next, f.pos) : dPrev;
    const g = course.gates[i];
    const a = clamp(0.3 * Math.min(dPrev, dNext), o.minApproach, g.approach || o.approach);
    pts.push({ x: f.pos.x - f.normal.x * a, y: f.pos.y - f.normal.y * a, z: f.pos.z - f.normal.z * a });
    pts.push({ x: f.pos.x, y: f.pos.y, z: f.pos.z });
    pts.push({ x: f.pos.x + f.normal.x * a, y: f.pos.y + f.normal.y * a, z: f.pos.z + f.normal.z * a });
    if (g.via) for (const v of g.via) pts.push({ x: v[0], y: v[1], z: v[2] });
  }
  const last = frames[frames.length - 1];
  pts.push({ x: last.pos.x + last.normal.x * o.runout, y: last.pos.y + last.normal.y * o.runout, z: last.pos.z + last.normal.z * o.runout });
  const dense = [];
  const tmp = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    const q0 = i === 0 ? { x: 2 * p1.x - p2.x, y: 2 * p1.y - p2.y, z: 2 * p1.z - p2.z } : p0;
    const q3 = i + 2 >= pts.length ? { x: 2 * p2.x - p1.x, y: 2 * p2.y - p1.y, z: 2 * p2.z - p1.z } : p3;
    const segs = Math.max(4, Math.ceil(dist3(p1, p2) / (o.ds * 0.5)));
    for (let j = 0; j < segs; j++) {
      catmull(q0, p1, p2, q3, j / segs, tmp);
      dense.push(tmp.x, tmp.y, tmp.z);
    }
  }
  const lp = pts[pts.length - 1];
  dense.push(lp.x, lp.y, lp.z);
  const cum = [0];
  for (let i = 3; i < dense.length; i += 3) {
    const dx = dense[i] - dense[i - 3], dy = dense[i + 1] - dense[i - 2], dz = dense[i + 2] - dense[i - 1];
    cum.push(cum[cum.length - 1] + Math.sqrt(dx * dx + dy * dy + dz * dz));
  }
  const total = cum[cum.length - 1];
  const n = Math.max(2, Math.ceil(total / o.ds) + 1);
  const pos = new Float64Array(n * 3);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const s = Math.min(total, i * o.ds);
    while (k < cum.length - 2 && cum[k + 1] < s) k++;
    const seg = cum[k + 1] - cum[k];
    const t = seg > 1e-9 ? (s - cum[k]) / seg : 0;
    pos[i * 3] = lerp(dense[k * 3], dense[k * 3 + 3], t);
    pos[i * 3 + 1] = lerp(dense[k * 3 + 1], dense[k * 3 + 4], t);
    pos[i * 3 + 2] = lerp(dense[k * 3 + 2], dense[k * 3 + 5], t);
  }
  const gateIndex = frames.map((f) => {
    let bi = 0, bd = Infinity;
    for (let i = 0; i < n; i++) {
      const dx = pos[i * 3] - f.pos.x, dy = pos[i * 3 + 1] - f.pos.y, dz = pos[i * 3 + 2] - f.pos.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bd) { bd = d; bi = i; }
    }
    return bi;
  });
  return { pos, count: n, ds: o.ds, length: (n - 1) * o.ds, gateIndex, frames };
}

export function createFlightBot(course, opts = {}) {
  const o = Object.assign({
    cruise: 27, latAccel: 19, accel: 12, decel: 15, climbAccel: 9,
    posGain: 9, velGain: 5.5, attGain: 11, lookTime: 0.06, maxTilt: 82 * DEG, rateFeed: 1,
  }, opts);
  const line = buildRacingLine(course, o);
  const n = line.count, ds = line.ds, P = line.pos;
  const tan = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    let x = P[b * 3] - P[a * 3], y = P[b * 3 + 1] - P[a * 3 + 1], z = P[b * 3 + 2] - P[a * 3 + 2];
    const l = Math.sqrt(x * x + y * y + z * z) || 1;
    tan[i * 3] = x / l; tan[i * 3 + 1] = y / l; tan[i * 3 + 2] = z / l;
  }
  const curv = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 2), b = Math.min(n - 1, i + 2);
    const span = (b - a) * ds || 1;
    curv[i * 3] = (tan[b * 3] - tan[a * 3]) / span;
    curv[i * 3 + 1] = (tan[b * 3 + 1] - tan[a * 3 + 1]) / span;
    curv[i * 3 + 2] = (tan[b * 3 + 2] - tan[a * 3 + 2]) / span;
  }
  const speed = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let kMax = 0;
    for (let j = Math.max(0, i - 3); j <= Math.min(n - 1, i + 3); j++) {
      const kx = curv[j * 3], ky = curv[j * 3 + 1], kz = curv[j * 3 + 2];
      kMax = Math.max(kMax, Math.sqrt(kx * kx + ky * ky + kz * kz));
    }
    speed[i] = Math.min(o.cruise, Math.sqrt(o.latAccel / Math.max(kMax, 1e-4)));
  }
  speed[0] = 0;
  for (let i = 1; i < n; i++) {
    const climb = Math.max(0, tan[i * 3 + 1]);
    const acc = o.accel - (o.accel - o.climbAccel) * climb;
    speed[i] = Math.min(speed[i], Math.sqrt(speed[i - 1] * speed[i - 1] + 2 * acc * ds));
  }
  for (let i = n - 2; i >= 0; i--) speed[i] = Math.min(speed[i], Math.sqrt(speed[i + 1] * speed[i + 1] + 2 * o.decel * ds));
  const acc = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = speed[i];
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    const dv = (speed[b] - speed[a]) / (((b - a) * ds) || 1);
    acc[i * 3] = v * v * curv[i * 3] + v * dv * tan[i * 3];
    acc[i * 3 + 1] = v * v * curv[i * 3 + 1] + v * dv * tan[i * 3 + 1];
    acc[i * 3 + 2] = v * v * curv[i * 3 + 2] + v * dv * tan[i * 3 + 2];
  }
  let idx = 0;
  let heading = num(course.start.yaw, 0);
  const out = { throttle: 0, roll: 0, pitch: 0, yaw: 0, mode: 'acro' };
  const F = { x: 0, y: 0, z: 0 }, D = { x: 0, y: 0, z: 0 }, U = { x: 0, y: 1, z: 0 };
  const qd = { x: 0, y: 0, z: 0, w: 1 }, qp = { x: 0, y: 0, z: 0, w: 1 }, E = { x: 0, y: 0, z: 0 }, W = { x: 0, y: 0, z: 0 };
  let hasPrev = false;
  function nearest(pos) {
    let bi = idx, bd = Infinity;
    const hi = Math.min(n - 1, idx + 80);
    for (let i = Math.max(0, idx - 6); i <= hi; i++) {
      const dx = P[i * 3] - pos.x, dy = P[i * 3 + 1] - pos.y, dz = P[i * 3 + 2] - pos.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bd) { bd = d; bi = i; }
    }
    idx = Math.max(idx, bi);
    return Math.sqrt(bd);
  }
  function control(s, dt) {
    const p = s.params;
    const h = dt > 0 ? dt : 1 / 120;
    const err = nearest(s.pos);
    const look = Math.min(n - 1, idx + Math.round((s.speed * o.lookTime) / ds) + 1);
    const i3 = look * 3;
    const vd = speed[look];
    let axc = acc[i3] + o.posGain * (P[i3] - s.pos.x) + o.velGain * (tan[i3] * vd - s.vel.x);
    let ayc = acc[i3 + 1] + o.posGain * (P[i3 + 1] - s.pos.y) + o.velGain * (tan[i3 + 1] * vd - s.vel.y);
    let azc = acc[i3 + 2] + o.posGain * (P[i3 + 2] - s.pos.z) + o.velGain * (tan[i3 + 2] * vd - s.vel.z);
    const am = Math.sqrt(axc * axc + ayc * ayc + azc * azc);
    const amax = 40;
    if (am > amax) { axc *= amax / am; ayc *= amax / am; azc *= amax / am; }
    qRotate(U, s.quat, BODY_UP);
    dragForce(p, s.vel, U, s.motor, D);
    F.x = p.mass * axc - D.x;
    F.y = p.mass * (ayc + p.gravity) - D.y;
    F.z = p.mass * azc - D.z;
    let fm = Math.sqrt(F.x * F.x + F.y * F.y + F.z * F.z);
    if (fm < 1e-6) { F.x = 0; F.y = 1; F.z = 0; fm = 1e-6; }
    let ux = F.x / fm, uy = F.y / fm, uz = F.z / fm;
    const minY = Math.cos(o.maxTilt);
    let clamped = false;
    if (uy < minY) {
      const hl = Math.sqrt(ux * ux + uz * uz) || 1;
      const sh = Math.sqrt(1 - minY * minY);
      ux = (ux / hl) * sh; uz = (uz / hl) * sh; uy = minY;
      clamped = true;
    }
    let fAlong = F.x * ux + F.y * uy + F.z * uz;
    if (clamped) fAlong = Math.min(fAlong, Math.max(0, F.y) / uy);
    const vAx = s.vel.x * ux + s.vel.y * uy + s.vel.z * uz;
    const need = Math.max(0, fAlong) / (p.maxThrust * inflowFactor(p, vAx, s.motor));
    const m = thrustCurveInverse(clamp(need, 0, 1), p.curveA);
    out.throttle = clamp((m - p.idle) / (1 - p.idle), 0, 1);
    const ahead = Math.min(n - 1, look + 6) * 3;
    const hx = tan[ahead], hz = tan[ahead + 2];
    if (hx * hx + hz * hz > 0.04) heading = Math.atan2(-hx, -hz);
    let fx = -Math.sin(heading), fy = 0, fz = -Math.cos(heading);
    const d = fx * ux + fy * uy + fz * uz;
    fx -= d * ux; fy -= d * uy; fz -= d * uz;
    const fl = Math.sqrt(fx * fx + fy * fy + fz * fz) || 1;
    fx /= fl; fy /= fl; fz /= fl;
    const rx = fy * uz - fz * uy, ry = fz * ux - fx * uz, rz = fx * uy - fy * ux;
    matToQuat(rx, ry, rz, ux, uy, uz, -fx, -fy, -fz, qd);
    W.x = 0; W.y = 0; W.z = 0;
    if (hasPrev && o.rateFeed > 0) {
      rotationError(qp, qd, W);
      const k = o.rateFeed / h;
      const wl = Math.sqrt(W.x * W.x + W.y * W.y + W.z * W.z) * k;
      const cap = 8;
      const sc = wl > cap ? (k * cap) / wl : k;
      W.x *= sc; W.y *= sc; W.z *= sc;
    }
    qcopy(qp, qd);
    hasPrev = true;
    rotationError(s.quat, qd, E);
    const lim = maxRate(p.rates.roll) * DEG * 0.95;
    const wx = clamp(E.x * o.attGain + W.x, -lim, lim);
    const wy = clamp(E.y * o.attGain + W.y, -lim, lim);
    const wz = clamp(E.z * o.attGain + W.z, -lim, lim);
    out.pitch = rateToStick(-wx / DEG, p.rates.pitch);
    out.yaw = rateToStick(-wy / DEG, p.rates.yaw);
    out.roll = rateToStick(-wz / DEG, p.rates.roll);
    out.mode = 'acro';
    out.trackError = err;
    out.progress = idx / (n - 1);
    return out;
  }
  function reset() {
    idx = 0;
    hasPrev = false;
    heading = num(course.start.yaw, 0);
  }
  return { line, speed, control, reset, get index() { return idx; } };
}

function matToQuat(m00, m10, m20, m01, m11, m21, m02, m12, m22, out) {
  const tr = m00 + m11 + m22;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    out.w = 0.25 * s; out.x = (m21 - m12) / s; out.y = (m02 - m20) / s; out.z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    out.w = (m21 - m12) / s; out.x = 0.25 * s; out.y = (m01 + m10) / s; out.z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    out.w = (m02 - m20) / s; out.x = (m01 + m10) / s; out.y = 0.25 * s; out.z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    out.w = (m10 - m01) / s; out.x = (m02 + m20) / s; out.y = (m12 + m21) / s; out.z = 0.25 * s;
  }
  return qnorm(out, out);
}
