import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createVehicle, stepVehicle, vehicleParamsFromStats, placeVehicle } from '../src/assets/games/racer/vehicle.js';
import { createTrack } from '../src/assets/games/kit/track.js';
import { TRACKS } from '../src/assets/games/racer/tracks.js';
import { CARS } from '../src/assets/games/racer/cars.js';
import { createAIDriver } from '../src/assets/games/racer/ai.js';
import { mulberry32, wrapAngle } from '../src/assets/games/kit/math.js';

const DT = 1 / 120;
const GOLDEN = '829eeb37f238675f';
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const flat = (width = 20) => ({
  length: 1e6,
  sample(s, o = {}) {
    o.heading = 0; o.grade = 0; o.width = width; o.bank = 0;
    o.rightFlat = { x: 1, z: 0 }; o.x = 0; o.y = 0; o.z = -s;
    return o;
  },
  project(car, s, o) { o.s = -car.z; o.lateral = car.x; return o; },
  surfaceY() { return 0; },
  rampSlope() { return 0; },
  pointAt(s, lat) { return { x: lat || 0, y: 0, z: -s }; },
  wrapS(s) { return s; }
});

const params = () => vehicleParamsFromStats(CARS[0].stats);
const carOn = (track, s = 100, lat = 0) => placeVehicle(createVehicle(params()), track, s, lat, 0);
const pos = (car) => -car.z;

const steady = (label) => (car, ev, y0) => {
  assert.ok(Number.isFinite(car.x) && Number.isFinite(car.z) && Number.isFinite(car.yaw) && Number.isFinite(car.speed), label + ': NaN');
  const d = Math.abs(wrapAngle(car.yaw - y0));
  if (d > 0.3 && !ev.crash) throw new Error(label + ': the car turned ' + d.toFixed(2) + ' rad in one step (speed ' + car.speed.toFixed(2) + ', reverse ' + car.reverse + ')');
};

function drive(car, track, secs, input, onStep) {
  const n = Math.round(secs / DT);
  for (let i = 0; i < n; i++) {
    const y0 = car.yaw;
    const ev = stepVehicle(car, input, DT, track);
    if (onStep) onStep(car, ev, y0);
  }
}

test('reverse: braking to a stop and holding brake backs the car up the track without turning it', () => {
  const track = flat();
  const car = carOn(track);
  const check = steady('brake into reverse');
  drive(car, track, 3, { throttle: 1 }, check);
  let engagedAt = null;
  drive(car, track, 6, { brake: 1 }, (c, ev, y0) => { check(c, ev, y0); if (c.reverse && engagedAt == null) engagedAt = pos(c); });
  assert.ok(car.reverse, 'in reverse');
  assert.ok(engagedAt != null, 'reverse engaged');
  assert.ok(pos(car) < engagedAt - 5, 'moved back: engaged at ' + engagedAt.toFixed(1) + ', now ' + pos(car).toFixed(1));
  assert.ok(Math.abs(wrapAngle(car.yaw)) < 0.05, 'still facing forward: yaw ' + car.yaw.toFixed(2));
});

test('reverse: gas after reversing drives forward without turning', () => {
  const track = flat();
  const car = carOn(track);
  const check = steady('gas after reverse');
  drive(car, track, 2, { brake: 1 }, check);
  assert.ok(car.reverse && car.speed > 1, 'reversing');
  const back = pos(car);
  drive(car, track, 4, { throttle: 1 }, check);
  assert.equal(car.reverse, false);
  assert.ok(pos(car) > back + 5, 'moved forward');
  assert.ok(Math.abs(wrapAngle(car.yaw)) < 0.05, 'still facing forward: yaw ' + car.yaw.toFixed(2));
});

test('reverse: steering while reversing turns the car smoothly both ways', () => {
  const track = flat(60);
  const car = carOn(track);
  const check = steady('steer in reverse');
  drive(car, track, 2, { brake: 1 }, check);
  drive(car, track, 2, { brake: 1, steer: -1 }, check);
  drive(car, track, 2, { brake: 1, steer: 1 }, check);
  assert.ok(car.reverse);
});

test('walls: reversing into a wall at an angle never flips the car', () => {
  const track = flat(10);
  const car = carOn(track);
  const check = steady('reverse into wall');
  let toggles = 0, was = car.reverse;
  const count = (c, ev, y0) => { check(c, ev, y0); if (c.reverse !== was) { toggles++; was = c.reverse; } };
  drive(car, track, 1.5, { brake: 1 }, count);
  drive(car, track, 3, { brake: 1, steer: -1 }, count);
  drive(car, track, 3, { brake: 1, steer: 1 }, count);
  assert.ok(toggles <= 1, 'reverse toggled ' + toggles + ' times');
});

test('walls: a slow head-on hit does not flip the car', () => {
  const track = flat(12);
  const car = carOn(track);
  car.yaw = -Math.PI / 2; car.vHeading = -Math.PI / 2;
  drive(car, track, 4, { throttle: 0.35 }, steady('head-on'));
  assert.ok(Math.abs(wrapAngle(car.yaw + Math.PI / 2)) < 0.6, 'still facing the wall: yaw ' + car.yaw.toFixed(2));
});

test('braking hard while steering or drifting keeps the car steady', () => {
  const track = flat(80);
  const car = carOn(track);
  const check = steady('hard braking');
  drive(car, track, 6, { throttle: 1 }, check);
  drive(car, track, 4, { brake: 1, steer: 0.8 }, check);
  const car2 = carOn(track);
  drive(car2, track, 6, { throttle: 1 }, check);
  drive(car2, track, 1.2, { throttle: 1, steer: -1, drift: true }, check);
  drive(car2, track, 4, { brake: 1, steer: -1, drift: true }, check);
});

test('random drives on every track never flip the car or break the numbers', () => {
  for (let seed = 1; seed <= 150; seed++) {
    const rng = mulberry32(seed);
    const def = TRACKS[seed % TRACKS.length];
    const track = createTrack(def);
    const car = carOn(track, rng() * track.length * 0.9, (rng() - 0.5) * 6);
    const check = steady('seed ' + seed + ' on ' + def.id);
    for (let t = 0; t < 15; t += 0.5) {
      const r = rng();
      const input = r < 0.45 ? { throttle: 1, steer: rng() * 2 - 1 } : r < 0.75 ? { brake: rng(), steer: rng() * 2 - 1 } : r < 0.9 ? { throttle: 1, steer: rng() < 0.5 ? -1 : 1, drift: true } : {};
      drive(car, track, 0.5, input, check);
    }
  }
});

test('forward driving is unchanged: an AI lap on each track matches its fingerprint', () => {
  const h = createHash('sha256');
  for (const def of TRACKS) {
    const track = createTrack(def);
    const car = carOn(track, 20, 0);
    const ai = createAIDriver(track, car, { difficulty: 'hard', seed: 7 });
    const ctx = { time: 0, cars: [car] };
    for (let i = 0; i < 40 * 120; i++) {
      ctx.time = 3 + i * DT;
      stepVehicle(car, ai.update(DT, ctx), DT, track);
      if (i % 60 === 0) h.update([car.x, car.z, car.yaw, car.speed].map((v) => v.toFixed(6)).join(',') + ';');
    }
  }
  const got = h.digest('hex').slice(0, 16);
  assert.equal(got, GOLDEN, 'forward handling changed (fingerprint ' + got + ')');
});

test('AI: a rival wedged nose-first against a wall backs out and drives on', () => {
  for (const def of TRACKS) {
    const track = createTrack(def);
    const s0 = track.length * 0.3;
    const sm = track.sample(s0);
    const lat = sm.width / 2 - 1.3;
    const car = carOn(track, s0, lat);
    car.yaw = wrapAngle(sm.heading - Math.PI / 2);
    car.vHeading = car.yaw;
    const ai = createAIDriver(track, car, { difficulty: 'normal', seed: 3 });
    const ctx = { time: 0, cars: [car] };
    const check = steady('wedged rival on ' + def.id);
    const start = car.progress;
    for (let i = 0; i < 14 * 120; i++) {
      ctx.time = 10 + i * DT;
      const y0 = car.yaw;
      const ev = stepVehicle(car, ai.update(DT, ctx), DT, track);
      check(car, ev, y0);
    }
    assert.ok(car.progress > start + 40, def.id + ': moved on ' + (car.progress - start).toFixed(1) + ' m');
    assert.equal(car.reverse, false, def.id + ': driving forward again');
  }
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log('ok   ' + name);
  } catch (e) {
    failed++;
    console.log('FAIL ' + name);
    console.log('     ' + (e && e.message ? e.message.split('\n')[0] : e));
  }
}
console.log(tests.length - failed + '/' + tests.length + ' passed');
if (failed) process.exit(1);
