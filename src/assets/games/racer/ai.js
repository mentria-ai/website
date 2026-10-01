import { clamp, lerp, wrapAngle, mulberry32 } from '../kit/math.js';

export const AI_DIFFICULTY = {
  easy: { corner: 0.8, brake: 0.8, line: 0.72, nitro: 0.4, rubber: 1, mistakes: 0.07, power: 0.95, reaction: 0.2, drift: 0.35, launch: [0.25, 0.6] },
  normal: { corner: 0.88, brake: 0.88, line: 0.86, nitro: 0.65, rubber: 0.85, mistakes: 0.035, power: 0.98, reaction: 0.14, drift: 0.7, launch: [0.15, 0.4] },
  hard: { corner: 0.94, brake: 0.94, line: 0.95, nitro: 0.85, rubber: 0.7, mistakes: 0.012, power: 1, reaction: 0.09, drift: 0.9, launch: [0.08, 0.25] },
  pro: { corner: 0.975, brake: 0.98, line: 1, nitro: 1, rubber: 0.55, mistakes: 0, power: 1.01, reaction: 0.06, drift: 1, launch: [0.04, 0.16] }
};

const lineCache = new WeakMap();
const ptA = { x: 0, y: 0, z: 0 };
const ptB = { x: 0, y: 0, z: 0 };

export function createRacingLine(track, opts = {}) {
  const cached = lineCache.get(track);
  if (cached && !opts.force) return cached;
  const n = Math.max(64, Math.round(track.length / 2));
  const step = track.length / n;
  const cx = new Float64Array(n), cz = new Float64Array(n), rx = new Float64Array(n), rz = new Float64Array(n);
  const half = new Float64Array(n), off = new Float64Array(n), vy = new Float64Array(n);
  const margin = opts.margin == null ? 2.7 : opts.margin;
  for (let i = 0; i < n; i++) {
    const sm = track.sample(i * step);
    cx[i] = sm.pos.x; cz[i] = sm.pos.z; vy[i] = sm.pos.y;
    rx[i] = sm.rightFlat.x; rz[i] = sm.rightFlat.z;
    half[i] = Math.max(0.5, sm.width / 2 * Math.cos(sm.bank) - margin);
  }
  const schedule = [[16, 120], [8, 160], [4, 200], [2, 200]];
  for (let q = 0; q < schedule.length; q++) {
    const k = schedule[q][0];
    for (let it = 0; it < schedule[q][1]; it++) {
      for (let i = 0; i < n; i++) {
        const a2 = (i - 2 * k + 2 * n) % n, a1 = (i - k + n) % n, b1 = (i + k) % n, b2 = (i + 2 * k) % n;
        const mx = (-(cx[a2] + rx[a2] * off[a2]) + 4 * (cx[a1] + rx[a1] * off[a1]) + 4 * (cx[b1] + rx[b1] * off[b1]) - (cx[b2] + rx[b2] * off[b2])) / 6;
        const mz = (-(cz[a2] + rz[a2] * off[a2]) + 4 * (cz[a1] + rz[a1] * off[a1]) + 4 * (cz[b1] + rz[b1] * off[b1]) - (cz[b2] + rz[b2] * off[b2])) / 6;
        const want = (mx - cx[i]) * rx[i] + (mz - cz[i]) * rz[i];
        off[i] = clamp(off[i] + (want - off[i]) * 0.6, -half[i], half[i]);
      }
    }
  }
  const head = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i - 1 + n) % n, b = (i + 1) % n;
    const ax = cx[a] + rx[a] * off[a], az = cz[a] + rz[a] * off[a];
    const bx = cx[b] + rx[b] * off[b], bz = cz[b] + rz[b] * off[b];
    head[i] = Math.atan2(-(bx - ax), -(bz - az));
  }
  const raw = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i - 2 + n) % n, b = (i + 2) % n;
    const ax = cx[a] + rx[a] * off[a], az = cz[a] + rz[a] * off[a];
    const bx = cx[b] + rx[b] * off[b], bz = cz[b] + rz[b] * off[b];
    const len = Math.max(Math.hypot(bx - ax, bz - az), 1e-6);
    raw[i] = wrapAngle(head[b] - head[a]) / len;
  }
  const kappa = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let o = -3; o <= 3; o++) sum += raw[(i + o + n) % n];
    kappa[i] = sum / 7;
  }
  const vcurv = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i - 3 + n) % n, b = (i + 3) % n;
    vcurv[i] = (vy[b] - 2 * vy[i] + vy[a]) / ((3 * step) * (3 * step));
  }
  const line = {
    n, step, off, kappa, vcurv,
    offsetAt(s) {
      let u = s / step;
      u -= Math.floor(u / n) * n;
      const i = Math.floor(u) % n, j = (i + 1) % n, f = u - Math.floor(u);
      return off[i] + (off[j] - off[i]) * f;
    },
    kappaAt(s) {
      let u = s / step;
      u -= Math.floor(u / n) * n;
      const i = Math.floor(u) % n, j = (i + 1) % n, f = u - Math.floor(u);
      return kappa[i] + (kappa[j] - kappa[i]) * f;
    }
  };
  lineCache.set(track, line);
  return line;
}

export function createSpeedProfile(track, params, diff, opts = {}) {
  const line = createRacingLine(track);
  const n = line.n, step = line.step;
  const v = new Float64Array(n);
  const vMax = params.topSpeed * params.nitroTopMult * 1.02;
  const driftUse = diff.drift == null ? 0.7 : diff.drift;
  const g = params.gravity;
  for (let i = 0; i < n; i++) {
    let k = 0;
    for (let o = -4; o <= 4; o++) k = Math.max(k, Math.abs(line.kappa[(i + o + n) % n]));
    const r = 1 / Math.max(k, 1e-6);
    let aLat = params.grip;
    if (r < 160) aLat = lerp(params.grip, params.driftGrip * 0.86, driftUse * clamp((160 - r) / 90, 0, 1));
    aLat *= diff.corner;
    const turnCap = params.maxTurn * (r < 160 ? lerp(1, 1.2, driftUse) : 1) * 0.92;
    v[i] = Math.min(vMax, Math.sqrt(aLat / Math.max(k, 1e-6)), turnCap * r);
  }
  const noBrake = new Uint8Array(n);
  for (const ramp of track.ramps) {
    const iLip = Math.floor(ramp.s1 / step) % n;
    const vl = Math.min(v[iLip], vMax);
    const slope = 2 * ramp.height / Math.max(ramp.s1 - ramp.s0, 1);
    const vyl = vl * slope;
    const T = (vyl + Math.sqrt(vyl * vyl + 2 * g * ramp.height)) / g;
    const dist = vl * T * 1.15 + 15;
    for (let d = -Math.ceil((ramp.s1 - ramp.s0) / step); d <= Math.ceil(dist / step); d++) noBrake[(iLip + d + n) % n] = 1;
  }
  for (let i = 0; i < n; i++) {
    if (line.vcurv[i] < 0 && v[i] * v[i] * -line.vcurv[i] > g * 0.9) {
      const span = Math.ceil((v[i] * 0.55) / step);
      for (let d = 0; d <= span; d++) noBrake[(i + d) % n] = 1;
    }
  }
  const aBrake = params.brake * diff.brake * 0.82;
  for (let pass = 0; pass < 3; pass++) {
    for (let c = n - 1; c >= 0; c--) {
      const i = c, j = (c + 1) % n;
      const allowed = noBrake[i] ? v[j] : Math.sqrt(v[j] * v[j] + 2 * aBrake * step);
      if (v[i] > allowed) v[i] = allowed;
    }
  }
  return {
    n, step, v, noBrake,
    at(s) {
      let u = s / step;
      u -= Math.floor(u / n) * n;
      const i = Math.floor(u) % n, j = (i + 1) % n, f = u - Math.floor(u);
      return v[i] + (v[j] - v[i]) * f;
    },
    minAhead(s, dist) {
      let m = Infinity;
      const c = Math.max(1, Math.ceil(dist / step));
      let u = s / step;
      u -= Math.floor(u / n) * n;
      const i0 = Math.floor(u) % n;
      for (let d = 0; d <= c; d++) m = Math.min(m, v[(i0 + d) % n]);
      return m;
    }
  };
}

export function createAIDriver(track, car, opts = {}) {
  const diffName = opts.difficulty && AI_DIFFICULTY[opts.difficulty] ? opts.difficulty : 'normal';
  const base = AI_DIFFICULTY[diffName];
  const rng = mulberry32(((opts.seed == null ? 1 : opts.seed) * 2654435761 + (car.index || 0) * 97) >>> 0);
  const skill = 1 + ((opts.skill == null ? rng() * 2 - 1 : opts.skill) * 0.018);
  const diff = Object.assign({}, base, { corner: Math.min(0.985, base.corner * skill) });
  const line = createRacingLine(track);
  const profile = createSpeedProfile(track, car.params, diff);
  const input = { throttle: 0, brake: 0, steer: 0, nitro: false, drift: false, power: 1, brakeDrift: false };
  const L = track.length;
  const sideBias = (rng() - 0.5) * 1.6;
  const launchDelay = lerp(diff.launch[0], diff.launch[1], rng());
  let avoid = 0;
  let mistakeLap = -99;
  let mistakeTable = null;
  let nitroCommit = 0;
  let recoverT = 0;
  let stuckT = 0;
  let clock = 0;

  function mistakeFactor(s) {
    if (!diff.mistakes) return 1;
    if (car.lap !== mistakeLap) {
      mistakeLap = car.lap;
      const r = mulberry32(((opts.seed || 1) * 31 + (car.index || 0) * 7 + (car.lap + 5) * 1013) >>> 0);
      mistakeTable = new Float64Array(Math.ceil(L / 150) + 1);
      for (let i = 0; i < mistakeTable.length; i++) mistakeTable[i] = 1 - r() * diff.mistakes * 1.4;
    }
    return mistakeTable[Math.floor(track.wrapS(s) / 150) % mistakeTable.length];
  }

  function rubber(ctx) {
    const pi = ctx && ctx.playerIndex != null ? ctx.playerIndex : -1;
    if (pi < 0 || !ctx.cars || !ctx.cars[pi] || ctx.cars[pi] === car) return { speed: 1, power: diff.power, nitro: 1 };
    const player = ctx.cars[pi];
    const gap = car.progress - player.progress;
    const x = clamp(gap / 170, -1, 1) * diff.rubber;
    if (x > 0) return { speed: 1 - 0.075 * x, power: diff.power * (1 - 0.05 * x), nitro: 1 - 0.7 * x };
    return { speed: 1 + 0.03 * -x, power: Math.min(1.06, diff.power * (1 + 0.065 * -x)), nitro: 1 + 0.8 * -x };
  }

  function update(dt, ctx) {
    clock += dt;
    const p = car.params;
    const time = ctx && ctx.time != null ? ctx.time : clock;
    if (time < launchDelay) {
      input.throttle = 0; input.brake = 0; input.steer = 0; input.nitro = false; input.drift = false;
      return input;
    }
    const rb = rubber(ctx);
    input.power = rb.power;
    const speed = car.speed;

    if (recoverT > 0) {
      recoverT -= dt;
      const sm = track.sample(car.s);
      const err = wrapAngle(sm.heading - car.yaw);
      input.throttle = 0; input.brake = 1; input.nitro = false; input.drift = false;
      input.steer = clamp(err * 1.5, -1, 1);
      if (recoverT <= 0) stuckT = 0;
      return input;
    }
    if (speed < 2.2 && time > launchDelay + 2) {
      stuckT += dt;
      if (stuckT > 2.2) { recoverT = 1.3; stuckT = 0; }
    } else stuckT = Math.max(0, stuckT - dt * 2);

    let wantOff = line.offsetAt(car.s + 8) * diff.line + sideBias * (1 - diff.line);
    const halfW = track.widthAt(car.s) / 2 - p.halfWidth - 0.5;
    let target = 0;
    let blocked = null;
    let blockedDist = Infinity;
    const cars = ctx && ctx.cars ? ctx.cars : null;
    if (cars) {
      for (let i = 0; i < cars.length; i++) {
        const o = cars[i];
        if (o === car || o.disabled) continue;
        const dS = track.deltaS(car.s, o.s);
        if (dS < -8 || dS > 40) continue;
        const dLat = o.lateral - (wantOff + avoid);
        if (Math.abs(dLat) > 3.2) continue;
        const closing = speed - o.speed;
        if (dS > 0 && (closing > 0.5 || dS < 10)) {
          if (dS < blockedDist) { blockedDist = dS; blocked = o; }
        } else if (dS <= 0 && dS > -6) {
          target += (o.lateral > car.lateral ? -1 : 1) * (3.2 - Math.abs(dLat));
        }
      }
    }
    if (blocked) {
      const leftRoom = (blocked.lateral - 3) + halfW;
      const rightRoom = halfW - (blocked.lateral + 3);
      const goLeft = leftRoom > rightRoom ? leftRoom > 0 : rightRoom <= 0 && leftRoom > rightRoom;
      const passLat = goLeft ? blocked.lateral - 3 : blocked.lateral + 3;
      target += passLat - wantOff;
    }
    let kAhead = 0;
    for (let d = 0; d <= 60; d += 10) kAhead = Math.max(kAhead, Math.abs(line.kappaAt(car.s + d)));
    const room = clamp(1 - kAhead * 110, 0.2, 1);
    target = clamp(target, -halfW * 2, halfW * 2) * room;
    avoid = avoid + clamp(target - avoid, -3.2 * dt, 3.2 * dt);
    if (!blocked && Math.abs(target) < 0.01) avoid *= Math.exp(-0.8 * dt);
    let latGoal = clamp(wantOff + avoid, -halfW, halfW);

    const lead = Math.max(speed, 4) * 0.1;
    const offA = clamp(line.offsetAt(car.s + lead) * diff.line + sideBias * (1 - diff.line) + avoid, -halfW, halfW);
    const offB = clamp(line.offsetAt(car.s + lead + 5) * diff.line + sideBias * (1 - diff.line) + avoid, -halfW, halfW);
    const pa = track.pointAt(car.s + lead, offA, 0, ptA);
    const pb = track.pointAt(car.s + lead + 5, offB, 0, ptB);
    const lineHead = Math.atan2(-(pb.x - pa.x), -(pb.z - pa.z));
    const e = latGoal - car.lateral;
    const phi = wrapAngle(car.vHeading - lineHead);
    const phiTarget = -Math.atan(1.25 * e / Math.max(speed, 8));
    const kff = line.kappaAt(car.s + lead * 1.5) * diff.line;
    const omegaNeed = Math.max(speed, 1) * kff + 4.2 * (phiTarget - phi);
    const gripAvail = Math.min(p.maxTurn, p.grip / Math.max(speed, 1));
    const driftAvail = Math.min(p.maxTurn * 1.2, p.driftGrip / Math.max(speed, 1));

    let steerCmd = clamp(-omegaNeed / gripAvail, -1, 1);
    let drift = false;
    if (car.drift) {
      const f = clamp(Math.abs(omegaNeed) / driftAvail, 0, 1);
      const sameDir = Math.sign(omegaNeed) === car.driftDir;
      if (sameDir && f > 0.28) {
        drift = true;
        const turn = car.driftDir * (2 * f - 1);
        steerCmd = clamp(-turn, -1, 1);
      } else {
        drift = false;
        steerCmd = car.driftDir * 0.75;
      }
    } else if (diff.drift > 0 && car.grounded && speed > 18 && Math.abs(omegaNeed) > gripAvail * 1.04 && rng() < diff.drift) {
      drift = true;
      steerCmd = omegaNeed > 0 ? -1 : 1;
    }

    const react = speed * diff.reaction;
    const vT = Math.min(profile.at(car.s + react), profile.at(car.s + react * 0.4)) * rb.speed * mistakeFactor(car.s);
    const err = vT - speed;
    const dLook = Math.max(12, speed * 0.8);
    const vAhead = profile.minAhead(car.s, dLook) * rb.speed;
    const aNeed = Math.max(0, (speed * speed - vAhead * vAhead) / (2 * dLook));
    let thr = 0, brk = 0;
    if (err > 1.2 && aNeed < p.brake * 0.3) thr = 1;
    else if (err > -0.6 && aNeed < p.brake * 0.45) thr = clamp(0.45 + err * 0.4, 0, 1);
    else brk = clamp(Math.max(-err / 2.2, aNeed / p.brake * 1.15), 0.15, 1);
    if (car.drift && brk > 0) { brk *= 0.6; thr = Math.max(thr, 0.3); }

    if (blocked && room < 0.6 && blockedDist < 18 && speed > blocked.speed) thr = Math.min(thr, 0.5);
    if (blocked && blockedDist < 12 && Math.abs(blocked.lateral - car.lateral) < 2.4 && speed > blocked.speed + 1) {
      thr = Math.min(thr, 0.2);
      if (blockedDist < 7) brk = Math.max(brk, 0.3);
    }

    let useNitro = false;
    if (nitroCommit > 0) {
      nitroCommit -= dt;
      useNitro = car.nitro > 0.01;
    } else if (car.nitro > 0.12 && car.grounded && !car.drift && thr > 0.9) {
      const ahead = profile.minAhead(car.s, Math.max(120, speed * 3));
      const clear = !blocked || blockedDist > 25;
      const want = diff.nitro * rb.nitro;
      if (clear && ahead > speed * 1.04 && rng() < want * dt * 3) {
        nitroCommit = 1 + rng() * 2;
        useNitro = true;
      }
    }
    if (!car.grounded) { brk = 0; }
    input.throttle = thr;
    input.brake = brk;
    input.steer = steerCmd;
    input.nitro = useNitro;
    input.drift = drift;
    return input;
  }

  return {
    car,
    difficulty: diffName,
    line,
    profile,
    input,
    update,
    reset() { avoid = 0; nitroCommit = 0; recoverT = 0; stuckT = 0; clock = 0; }
  };
}
