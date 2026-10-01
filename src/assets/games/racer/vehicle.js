import { clamp, lerp, approach, wrapAngle, qFromYawPitchRoll } from '../kit/math.js';

const RAD = Math.PI / 180;
const KMH = 3.6;
const SPRING_K = 520;
const SPRING_C = 46;
const GEAR_SPLITS = [0.2, 0.35, 0.5, 0.65, 0.81, 1.0];

export const VEHICLE_SIZE = { halfWidth: 1.0, halfLength: 2.3, circleOffset: 1.18, circleRadius: 1.06, wheelRadius: 0.34 };

function statOf(stats, key) {
  const v = stats && typeof stats[key] === 'number' && stats[key] === stats[key] ? stats[key] : 5;
  return clamp(v, 1, 10);
}

export function vehicleParamsFromStats(stats) {
  const a = statOf(stats, 'accel');
  const t = statOf(stats, 'top');
  const h = statOf(stats, 'handling');
  const n = statOf(stats, 'nitro');
  return {
    topSpeed: (226 + 5.4 * t) / KMH,
    accel: 8.4 + 0.62 * a,
    accelCurve: 2.6,
    brake: 15.5 + 0.3 * h,
    coastDrag: 1.0,
    airDrag: 0.00042,
    overTopDecay: 0.42,
    reverseTop: 9,
    grip: 9.81 * (2.1 + 0.085 * h),
    driftGrip: 9.81 * (3.05 + 0.1 * h),
    maxTurn: 1.5 + 0.045 * h,
    steerRate: 5.2 + 0.25 * h,
    driftAngleMin: 12 * RAD,
    driftAngleMax: (30 + 1.3 * h) * RAD,
    driftSwing: 4.2 + 0.12 * h,
    driftDrag: 2.7 - 0.09 * h,
    gripRecover: 7.5 + 0.3 * h,
    nitroTopMult: 1.11 + 0.009 * n,
    nitroAccelMult: 1.45 + 0.05 * n,
    nitroBurn: 1 / (8.6 + 0.24 * n),
    nitroGain: 0.85 + 0.03 * n,
    gravity: 9.81 * 1.28,
    mass: 1 + 0.02 * (t - 5),
    halfWidth: VEHICLE_SIZE.halfWidth,
    halfLength: VEHICLE_SIZE.halfLength,
    circleOffset: VEHICLE_SIZE.circleOffset,
    circleRadius: VEHICLE_SIZE.circleRadius,
    wheelRadius: VEHICLE_SIZE.wheelRadius,
    stats: { accel: a, top: t, handling: h, nitro: n }
  };
}

export function makeVehicleEvents() {
  return {
    scrape: 0,
    bump: 0,
    bumpWith: -1,
    land: 0,
    takeoff: false,
    crash: 0,
    driftStart: false,
    driftEnd: false,
    driftTime: 0,
    nitroFull: false,
    nitroStart: false,
    nitroEnd: false,
    nitroGained: 0,
    nearMiss: false,
    overtake: false,
    overtaken: false,
    takedown: false,
    wrecked: false,
    lap: false,
    wrongWay: false
  };
}

function resetEvents(ev) {
  ev.scrape = 0; ev.bump = 0; ev.bumpWith = -1; ev.land = 0; ev.takeoff = false; ev.crash = 0;
  ev.driftStart = false; ev.driftEnd = false; ev.driftTime = 0;
  ev.nitroFull = false; ev.nitroStart = false; ev.nitroEnd = false; ev.nitroGained = 0;
  ev.nearMiss = false; ev.overtake = false; ev.overtaken = false; ev.takedown = false; ev.wrecked = false;
  ev.lap = false; ev.wrongWay = false;
  return ev;
}

export function createVehicle(params, spawn = {}) {
  const car = {
    params,
    index: spawn.index == null ? 0 : spawn.index,
    x: 0, y: 0, z: 0,
    vx: 0, vy: 0, vz: 0,
    yaw: 0,
    vHeading: 0,
    speed: 0,
    slip: 0,
    spin: 0,
    reverse: false,
    steer: 0,
    steerAngle: 0,
    throttle: 0,
    brake: 0,
    grounded: true,
    airTime: 0,
    surf: 0,
    s: 0,
    lateral: 0,
    lap: 0,
    progress: 0,
    drift: false,
    driftDir: 0,
    driftT: 0,
    driftRelease: 0,
    driftCounter: 0,
    driftReleaseT: 0,
    driftWallT: 0,
    nitroFullFlag: false,
    nitro: spawn.nitro == null ? 0.34 : spawn.nitro,
    boosting: false,
    crashT: 0,
    wallT: 0,
    contactT: 9,
    wrongT: 0,
    latAccel: 0,
    longAccel: 0,
    pitch: 0,
    roll: 0,
    lean: { roll: 0, pitch: 0 },
    quat: { x: 0, y: 0, z: 0, w: 1 },
    wheelSpin: 0,
    rpm: 0.2,
    gear: 1,
    skid: 0,
    topSpeedSeen: 0,
    ev: makeVehicleEvents()
  };
  if (spawn.track) placeVehicle(car, spawn.track, spawn.s || 0, spawn.lateral || 0, spawn.lap);
  else if (spawn.pos) {
    car.x = spawn.pos.x; car.y = spawn.pos.y; car.z = spawn.pos.z;
    car.yaw = spawn.yaw || 0; car.vHeading = car.yaw;
  }
  return car;
}

export function placeVehicle(car, track, s, lateral, lap, keepSpeed) {
  const sm = track.sample(s);
  const p = track.pointAt(s, lateral || 0, 0);
  car.x = p.x; car.y = p.y; car.z = p.z;
  car.surf = p.y;
  car.yaw = sm.heading;
  car.vHeading = sm.heading;
  car.slip = 0; car.spin = 0; car.reverse = false;
  car.vy = 0;
  if (!keepSpeed) { car.speed = 0; car.vx = 0; car.vz = 0; }
  else {
    car.vx = -Math.sin(car.vHeading) * car.speed;
    car.vz = -Math.cos(car.vHeading) * car.speed;
  }
  car.s = track.wrapS(s);
  car.lateral = lateral || 0;
  car.lap = lap == null ? (car.s > track.length * 0.5 ? -1 : 0) : lap;
  car.progress = car.lap * track.length + car.s;
  car.grounded = true; car.airTime = 0;
  car.drift = false; car.crashT = 0; car.wallT = 0; car.wrongT = 0;
  updatePose(car, track, 1);
  return car;
}

export function vehicleSpeedKmh(car) {
  return car.speed * KMH;
}

const projScratch = { s: 0, lateral: 0, height: 0 };
const sampleScratch = {
  s: 0, pos: { x: 0, y: 0, z: 0 }, tangent: { x: 0, y: 0, z: -1 }, up: { x: 0, y: 1, z: 0 },
  right: { x: 1, y: 0, z: 0 }, rightFlat: { x: 1, y: 0, z: 0 }, normal: null,
  width: 14, bank: 0, curvature: 0, grade: 0, heading: 0
};

function accelCurve(p, v, top, mult) {
  const u = clamp(v / top, 0, 1.2);
  const f = 1 - Math.pow(Math.min(u, 1), p.accelCurve);
  return p.accel * mult * Math.max(f, 0);
}

function updateGear(car, top) {
  const v = car.speed;
  let g = 1;
  for (let i = 0; i < GEAR_SPLITS.length; i++) {
    if (v > GEAR_SPLITS[i] * top * 1.02) g = i + 2;
  }
  g = Math.min(g, GEAR_SPLITS.length);
  car.gear = g;
  const lo = g === 1 ? 0 : GEAR_SPLITS[g - 2] * top;
  const hi = GEAR_SPLITS[g - 1] * top;
  const f = clamp((v - lo) / Math.max(hi - lo, 1), 0, 1.15);
  let rpm = 0.28 + 0.72 * f;
  if (!car.grounded) rpm = lerp(car.rpm, 0.55 + 0.45 * car.throttle, 0.05);
  if (car.speed < 0.5) rpm = 0.18 + 0.22 * car.throttle;
  car.rpm = lerp(car.rpm, clamp(rpm, 0, 1.1), 0.25);
}

function updatePose(car, track, blend) {
  const sm = track.sample(car.s, sampleScratch);
  const rel = wrapAngle(car.yaw - sm.heading);
  const c = Math.cos(rel);
  const slope = (sm.grade + track.rampSlope(car.s)) * c;
  let pitchT, rollT;
  if (car.grounded) {
    pitchT = Math.atan(slope);
    rollT = sm.bank * c;
  } else {
    const hv = Math.max(car.speed, 1);
    pitchT = clamp(Math.atan2(car.vy, hv) * 0.85, -0.6, 0.6);
    rollT = car.roll * 0.98;
  }
  const k = blend == null ? 0.35 : blend;
  car.pitch = lerp(car.pitch, pitchT, car.grounded ? Math.max(k, 0.6) : 0.06);
  car.roll = lerp(car.roll, rollT, car.grounded ? Math.max(k, 0.6) : 0.04);
  car.lean.roll = lerp(car.lean.roll, clamp(-car.latAccel / 9.81 * 0.035, -0.09, 0.09), 0.12);
  car.lean.pitch = lerp(car.lean.pitch, clamp(-car.longAccel / 9.81 * 0.03, -0.05, 0.05), 0.12);
  qFromYawPitchRoll(car.quat, car.yaw, car.pitch, car.roll);
}

export function stepVehicle(car, input, dt, track) {
  const p = car.params;
  const ev = resetEvents(car.ev);
  const g = p.gravity;
  let thr = clamp(input && input.throttle || 0, 0, 1);
  let brk = clamp(input && input.brake || 0, 0, 1);
  let st = clamp(input && input.steer || 0, -1, 1);
  const wantNitro = !!(input && input.nitro);
  const wantDrift = !!(input && input.drift);
  const powerMult = input && input.power ? clamp(input.power, 0.8, 1.08) : 1;

  if (car.crashT > 0) {
    car.crashT = Math.max(0, car.crashT - dt);
    thr *= 0.2; brk *= 0.2; st *= 0.25;
  }
  const returning = Math.abs(st) < Math.abs(car.steer) || st * car.steer < 0;
  car.steer = approach(car.steer, st, p.steerRate * (returning ? 1.8 : 1) * dt);
  car.throttle = thr;
  car.brake = brk;

  let speed = Math.hypot(car.vx, car.vz);
  if (speed > 0.25) car.vHeading = Math.atan2(-car.vx, -car.vz);
  else car.vHeading = car.reverse ? wrapAngle(car.yaw + Math.PI) : car.yaw;

  if (speed < 0.6) {
    if (brk > 0.1 && thr < 0.1) car.reverse = true;
    else if (thr > 0.1) car.reverse = false;
  }

  const wasBoosting = car.boosting;
  car.boosting = wantNitro && car.nitro > 0.002 && car.crashT <= 0 && !car.reverse;
  if (car.boosting) car.nitro = Math.max(0, car.nitro - p.nitroBurn * dt);
  if (car.boosting && !wasBoosting) ev.nitroStart = true;
  if (!car.boosting && wasBoosting) ev.nitroEnd = true;

  const top = p.topSpeed * (car.boosting ? p.nitroTopMult : 1) * (powerMult > 1 ? 1 + (powerMult - 1) * 0.5 : 1);
  const turn = -car.steer;
  const prevSpeed = speed;
  let omega = 0;

  if (car.grounded) {
    const align = Math.max(0, Math.cos(car.slip));
    if (!car.reverse) {
      let a = 0;
      if (thr > 0) a += accelCurve(p, speed, top, (car.boosting ? p.nitroAccelMult : 1) * powerMult) * thr * align;
      if (car.boosting && thr <= 0) a += accelCurve(p, speed, top, p.nitroAccelMult * 0.7) * align;
      if (brk > 0) a -= p.brake * brk * (car.drift ? 0.45 : 1);
      if (thr <= 0 && brk <= 0 && !car.boosting) a -= p.coastDrag;
      a -= p.airDrag * speed * speed * 0.4;
      if (speed > top) a -= (speed - top) * p.overTopDecay;
      if (car.drift) a -= p.driftDrag * Math.abs(Math.sin(car.slip)) / Math.sin(35 * RAD);
      if (car.crashT > 0) a -= 6;
      const sm = track.sample(car.s, sampleScratch);
      const along = Math.cos(wrapAngle(car.vHeading - sm.heading));
      a -= g * clamp(sm.grade * along, -0.3, 0.3) * 0.85;
      speed += a * dt;
      if (speed < 0) speed = 0;
    } else {
      let a = 0;
      if (brk > 0) a += p.accel * 0.55 * brk * (speed < p.reverseTop ? 1 : 0);
      if (thr > 0) a -= p.brake * thr;
      if (brk <= 0) a -= p.coastDrag * 2;
      speed = Math.max(0, speed + a * dt);
    }

    const fade = clamp(speed / 4, 0, 1);
    if (car.drift) {
      const f = clamp((1 + turn * car.driftDir) / 2, 0, 1);
      const avail = Math.min(p.maxTurn * 1.2, p.driftGrip / Math.max(speed, 1));
      omega = car.driftDir * f * avail * fade;
      const target = car.driftDir * lerp(p.driftAngleMin, p.driftAngleMax, f);
      car.slip += wrapAngle(target - car.slip) * (1 - Math.exp(-p.driftSwing * dt));
    } else {
      const avail = Math.min(p.maxTurn, p.grip / Math.max(speed, 1));
      omega = turn * avail * fade * (car.reverse ? -1 : 1);
      const target = car.reverse ? 0 : clamp(omega * speed / p.grip, -1, 1) * 0.07;
      const rate = car.crashT > 0 ? 1.2 : p.gripRecover * (car.driftRelease > 0 ? 0.55 : 1);
      car.slip += (wrapAngle(target - car.slip)) * (1 - Math.exp(-rate * dt));
    }
    car.vHeading = wrapAngle(car.vHeading + omega * dt);
  } else {
    speed -= p.airDrag * speed * speed * 0.3 * dt;
    car.slip += turn * 0.9 * dt;
  }

  car.spin *= Math.exp(-2.4 * dt);
  car.slip = wrapAngle(car.slip + car.spin * dt);
  car.yaw = wrapAngle(car.vHeading + car.slip + (car.reverse ? Math.PI : 0));
  car.latAccel = omega * speed;
  car.longAccel = (speed - prevSpeed) / dt;
  car.speed = speed;
  const dirSign = car.reverse ? -1 : 1;
  car.vx = -Math.sin(car.vHeading) * speed;
  car.vz = -Math.cos(car.vHeading) * speed;

  car.x += car.vx * dt;
  car.z += car.vz * dt;

  const prevS = car.s;
  track.project(car, car.s, projScratch);
  car.s = projScratch.s;
  let lat = projScratch.lateral;
  const sm = track.sample(car.s, sampleScratch);
  const limit = sm.width / 2 - p.halfWidth;
  if (Math.abs(lat) > limit) {
    const side = lat > 0 ? 1 : -1;
    const push = (side * limit - lat) * Math.cos(sm.bank);
    car.x += sm.rightFlat.x * push;
    car.z += sm.rightFlat.z * push;
    lat = side * limit;
    const nx = -side * sm.rightFlat.x, nz = -side * sm.rightFlat.z;
    const vn = car.vx * nx + car.vz * nz;
    if (vn < 0) {
      const impact = -vn;
      const angle = Math.asin(clamp(impact / Math.max(speed, 0.01), 0, 1));
      const hard = angle > 0.42 && speed > 22 && impact > 9 && car.crashT <= 0;
      if (hard) {
        car.vx -= nx * vn * 1.32;
        car.vz -= nz * vn * 1.32;
        car.vx *= 0.62; car.vz *= 0.62;
        car.spin += side * (3 + 3 * Math.min(1, impact / 25));
        car.crashT = 0.85;
        ev.crash = clamp(impact / 25, 0.3, 1);
        if (car.drift) { car.drift = false; ev.driftEnd = true; ev.driftTime = car.driftT; }
      } else {
        car.vx -= nx * vn * 1.04;
        car.vz -= nz * vn * 1.04;
        const keep = 1 - 0.3 * Math.sin(angle) - 2.2 * dt / Math.max(speed, 3);
        car.vx *= keep; car.vz *= keep;
        car.slip *= 0.9;
        ev.scrape = clamp(0.25 + impact / 14, 0, 1);
      }
      car.wallT = 0.12;
    } else if (speed > 4 && Math.abs(projScratch.lateral) > limit + 0.02) {
      ev.scrape = Math.max(ev.scrape, 0.12);
    }
    car.speed = Math.hypot(car.vx, car.vz);
    if (car.speed > 0.25) car.vHeading = Math.atan2(-car.vx, -car.vz);
    car.yaw = wrapAngle(car.vHeading + car.slip + (car.reverse ? Math.PI : 0));
  }
  car.wallT = Math.max(0, car.wallT - dt);
  car.lateral = lat;

  const surf = track.surfaceY(car.s, lat);
  const jumpEdge = Math.abs(surf - car.surf) > 0.8;
  const vSurf = jumpEdge ? 0 : (surf - car.surf) / dt;
  const pen = surf - car.y;
  const wasAir = car.airTime > 0.22;
  if (pen > -0.04 && !jumpEdge) {
    const rel = car.vy - vSurf;
    let aS = SPRING_K * pen - SPRING_C * rel;
    if (aS < 0) aS = 0;
    car.vy += (aS - g) * dt;
  } else {
    car.vy -= g * dt;
  }
  car.y += car.vy * dt;
  if (car.y < surf - 0.45) {
    car.y = surf - 0.45;
    if (car.vy < vSurf) car.vy = vSurf;
  }
  car.surf = surf;
  const contact = surf - car.y > -0.12;
  if (contact) {
    if (wasAir) {
      ev.land = clamp(Math.abs(car.vy - vSurf) / 14 + car.airTime * 0.15, 0.15, 1);
      const off = Math.abs(car.slip);
      if (off > 0.6 && !car.drift) {
        const loss = clamp((off - 0.6) * 0.35, 0, 0.3);
        car.vx *= 1 - loss; car.vz *= 1 - loss;
        car.speed = Math.hypot(car.vx, car.vz);
      }
    }
    car.airTime = 0;
    car.grounded = true;
  } else {
    if (car.grounded && surf - car.y < -0.3) {
      car.grounded = false;
      ev.takeoff = true;
    }
    if (!car.grounded) {
      car.airTime += dt;
      if (car.airTime > 0.2) {
        const gain = 0.1 * p.nitroGain * dt;
        car.nitro = Math.min(1, car.nitro + gain);
        ev.nitroGained += gain;
      }
    }
  }

  updateDrift(car, input, dt, wantDrift, brk, ev);
  if (car.drift) {
    const gain = 0.13 * p.nitroGain * clamp(Math.abs(car.slip) / (30 * RAD), 0.3, 1.3) * clamp(car.speed / 30, 0, 1.1) * dt;
    car.nitro = Math.min(1, car.nitro + gain);
    ev.nitroGained += gain;
  }

  const L = track.length;
  if (prevS > L - 80 && car.s < 80) { car.lap += 1; ev.lap = true; }
  else if (prevS < 80 && car.s > L - 80) car.lap -= 1;
  car.progress = car.lap * L + car.s;

  const rel = Math.cos(wrapAngle(car.yaw - sm.heading));
  if (rel < -0.35 && car.speed > 3 && !car.reverse) {
    car.wrongT += dt;
    if (car.wrongT > 1.5) ev.wrongWay = true;
  } else car.wrongT = 0;

  if (car.nitro >= 0.999 && !car.nitroFullFlag) { ev.nitroFull = true; car.nitroFullFlag = true; }
  if (car.nitro < 0.95) car.nitroFullFlag = false;

  car.driftRelease = Math.max(0, car.driftRelease - dt);
  car.contactT += dt;
  car.wheelSpin = (car.wheelSpin + dirSign * car.speed / p.wheelRadius * dt) % (Math.PI * 2);
  car.steerAngle = car.steer * lerp(0.55, 0.16, clamp(car.speed / 60, 0, 1)) * -1;
  car.skid = car.drift ? clamp(Math.abs(car.slip) / 0.55, 0.35, 1) : clamp((brk > 0.5 && car.speed > 12 ? 0.35 : 0) + (car.crashT > 0 ? 0.8 : 0) + ev.scrape * 0.5, 0, 1);
  if (car.speed > car.topSpeedSeen) car.topSpeedSeen = car.speed;
  updateGear(car, p.topSpeed);
  updatePose(car, track);
  return ev;
}

function updateDrift(car, input, dt, wantDrift, brk, ev) {
  const turn = -car.steer;
  const brakeDrift = !(input && input.brakeDrift === false);
  if (!car.drift) {
    const canStart = car.grounded && !car.reverse && car.crashT <= 0 && car.speed > 15 && Math.abs(turn) > 0.32;
    if (canStart && (wantDrift || (brakeDrift && brk > 0.25))) {
      car.drift = true;
      car.driftDir = turn > 0 ? 1 : -1;
      car.driftT = 0;
      car.driftReleaseT = 0;
      car.driftCounter = 0;
      car.driftWallT = 0;
      ev.driftStart = true;
    }
    return;
  }
  car.driftT += dt;
  const into = turn * car.driftDir;
  if (Math.abs(turn) < 0.12 && !wantDrift) car.driftReleaseT += dt;
  else car.driftReleaseT = 0;
  if (into < -0.3) car.driftCounter += dt * (into < -0.6 ? 1.6 : 1);
  else car.driftCounter = Math.max(0, car.driftCounter - dt);
  if (car.wallT > 0) car.driftWallT = (car.driftWallT || 0) + dt;
  else car.driftWallT = 0;
  const end = car.speed < 10 || car.reverse || car.crashT > 0 ||
    car.driftReleaseT > 0.32 || car.driftCounter > 0.2 || car.driftWallT > 0.3 ||
    (!car.grounded && car.airTime > 0.6);
  if (end) {
    car.drift = false;
    car.driftRelease = 0.5;
    ev.driftEnd = true;
    ev.driftTime = car.driftT;
  }
}

export function resolveVehicleContacts(cars, dt, opts = {}) {
  const n = cars.length;
  const takedownImpulse = opts.takedownImpulse == null ? 6.2 : opts.takedownImpulse;
  for (let i = 0; i < n; i++) {
    const a = cars[i];
    if (a.disabled) continue;
    for (let j = i + 1; j < n; j++) {
      const b = cars[j];
      if (b.disabled) continue;
      if (Math.abs(a.y - b.y) > 1.6) continue;
      const dx = b.x - a.x, dz = b.z - a.z;
      const reach = a.params.circleOffset + b.params.circleOffset + a.params.circleRadius + b.params.circleRadius;
      if (dx * dx + dz * dz > reach * reach) continue;
      const afx = -Math.sin(a.yaw), afz = -Math.cos(a.yaw);
      const bfx = -Math.sin(b.yaw), bfz = -Math.cos(b.yaw);
      let best = 0, bnx = 0, bnz = 0, bax = 0, baz = 0;
      for (let ca = -1; ca <= 1; ca += 2) {
        const ax = a.x + afx * a.params.circleOffset * ca, az = a.z + afz * a.params.circleOffset * ca;
        for (let cb = -1; cb <= 1; cb += 2) {
          const bx = b.x + bfx * b.params.circleOffset * cb, bz = b.z + bfz * b.params.circleOffset * cb;
          const ex = bx - ax, ez = bz - az;
          const d = Math.hypot(ex, ez);
          const pen = a.params.circleRadius + b.params.circleRadius - d;
          if (pen > best && d > 1e-6) {
            best = pen; bnx = ex / d; bnz = ez / d;
            bax = ax + bnx * a.params.circleRadius - a.x;
            baz = az + bnz * a.params.circleRadius - a.z;
          }
        }
      }
      if (best <= 0) continue;
      const ma = a.params.mass, mb = b.params.mass;
      const wa = mb / (ma + mb), wb = ma / (ma + mb);
      a.x -= bnx * best * wa; a.z -= bnz * best * wa;
      b.x += bnx * best * wb; b.z += bnz * best * wb;
      const rvx = b.vx - a.vx, rvz = b.vz - a.vz;
      const vn = rvx * bnx + rvz * bnz;
      a.contactT = 0; b.contactT = 0;
      if (vn >= 0) continue;
      const e = 0.28;
      const J = -(1 + e) * vn / (1 / ma + 1 / mb);
      const towardA = a.vx * bnx + a.vz * bnz;
      const towardB = -(b.vx * bnx + b.vz * bnz);
      a.vx -= bnx * J / ma; a.vz -= bnz * J / ma;
      b.vx += bnx * J / mb; b.vz += bnz * J / mb;
      const tA = (baz * -bnx * J - bax * -bnz * J);
      const bbx = bax + a.x - b.x, bbz = baz + a.z - b.z;
      const tB = (bbz * bnx * J - bbx * bnz * J);
      a.spin += clamp(tA * 0.08 / ma, -2.5, 2.5);
      b.spin += clamp(tB * 0.08 / mb, -2.5, 2.5);
      for (const c of [a, b]) {
        c.speed = Math.hypot(c.vx, c.vz);
        if (c.speed > 0.25) c.vHeading = Math.atan2(-c.vx, -c.vz);
        c.yaw = wrapAngle(c.vHeading + c.slip + (c.reverse ? Math.PI : 0));
      }
      const hit = clamp(J / 9, 0, 1);
      if (hit > a.ev.bump) { a.ev.bump = hit; a.ev.bumpWith = j; }
      if (hit > b.ev.bump) { b.ev.bump = hit; b.ev.bumpWith = i; }
      if (J > takedownImpulse) {
        const attacker = towardA >= towardB ? a : b;
        const victim = attacker === a ? b : a;
        if (victim.crashT <= 0 && !victim.shielded) {
          victim.crashT = 1.25;
          const torque = victim === a ? tA : tB;
          victim.spin += (torque < 0 ? -1 : 1) * 5.5;
          victim.vx *= 0.6; victim.vz *= 0.6;
          victim.speed = Math.hypot(victim.vx, victim.vz);
          if (victim.drift) { victim.drift = false; victim.ev.driftEnd = true; victim.ev.driftTime = victim.driftT; }
          victim.ev.wrecked = true;
          attacker.ev.takedown = true;
          const gain = 0.3 * attacker.params.nitroGain;
          attacker.nitro = Math.min(1, attacker.nitro + gain);
          attacker.ev.nitroGained += gain;
        }
      }
    }
  }
}

export function trackPassing(cars, state, length) {
  const n = cars.length;
  const st = state || { order: null, contact: new Map() };
  for (let i = 0; i < n; i++) {
    const a = cars[i];
    if (a.disabled) continue;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const b = cars[j];
      if (b.disabled) continue;
      const key = i * 64 + j;
      const d = a.progress - b.progress;
      const prev = st.contact.get(key);
      st.contact.set(key, d);
      if (prev == null) continue;
      if (prev < 0 && d >= 0 && d < 25 && a.speed > 15) {
        a.ev.overtake = true;
        b.ev.overtaken = true;
        const gain = 0.06 * a.params.nitroGain;
        a.nitro = Math.min(1, a.nitro + gain);
        a.ev.nitroGained += gain;
        const gap = Math.abs(a.lateral - b.lateral);
        if (gap < 3.6 && a.contactT > 1 && a.speed > 25 && a.speed - b.speed > 2) {
          a.ev.nearMiss = true;
          const g2 = 0.05 * a.params.nitroGain;
          a.nitro = Math.min(1, a.nitro + g2);
          a.ev.nitroGained += g2;
        }
      }
    }
  }
  return st;
}

export function stepVehicles(cars, inputs, dt, track, passing) {
  for (let i = 0; i < cars.length; i++) {
    if (cars[i].disabled) continue;
    stepVehicle(cars[i], inputs[i] || null, dt, track);
  }
  resolveVehicleContacts(cars, dt);
  return trackPassing(cars, passing, track.length);
}
