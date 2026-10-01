import * as THREE from 'three';
import * as KitRace from '../kit/race.js';
import * as KitGhost from '../kit/ghost.js';
import { clamp } from '../kit/math.js';
import { courseCheckpoints, gateCrossing, createDrone, resetDrone, step as stepDrone, createFlightBot, throttleCurve, DRONE_DEFAULTS } from './flight.js';
import { createDroneMesh } from './mesh.js';

const TRAIL_POINTS = 28;
const TRAIL_STEP = 0.045;
const GHOST_HZ = 20;
const MID_STICK = { hoverAtMidStick: true, hoverThrottle: DRONE_DEFAULTS.hoverThrottle, throttleMid: 0.5, throttleExpo: 0 };

export function midStickThrottle(stick) {
  return throttleCurve(stick, MID_STICK);
}

export function deadband(v, d) {
  const a = Math.abs(v);
  if (a <= d) return 0;
  return Math.sign(v) * (a - d) / (1 - d);
}

export function createHeightAssist() {
  let integ = 0;
  let holdY = null;

  function reset() {
    integ = 0;
    holdY = null;
  }

  function throttle(drone, climb, dt) {
    if (drone.grounded && climb <= 0.05) {
      reset();
      return 0;
    }
    const vy = drone.vel.y;
    let vz;
    if (Math.abs(climb) > 0.02) {
      holdY = null;
      vz = climb >= 0 ? climb * 6.5 : climb * 5;
    } else {
      if (holdY == null) holdY = drone.pos.y + (vy > 0 ? (vy * vy) / 19 : -(vy * vy) / 50);
      vz = clamp((holdY - drone.pos.y) * 1.6, -3, 3);
    }
    const alt = drone.altitude;
    if (vz < 0 && alt < 6) vz = Math.max(vz, -Math.max(0.9, alt * 0.85));
    const err = vz - vy;
    integ = clamp(integ + err * dt * 0.1, -0.32, 0.32);
    return midStickThrottle(clamp(0.5 + err * 0.16 + integ, 0, 1));
  }

  return { reset, throttle };
}

export function buildDroneLayout(base, stickMode) {
  const src = base || {};
  const baseAxes = src.axes || {};
  const mode1 = Number(stickMode) === 1;
  const axes = {
    throttle: {
      range: 'unsigned',
      keys: { neg: [], pos: [] },
      pad: { axis: mode1 ? 3 : 1, invert: true, center: 0.5, deadzone: 0.04 }
    },
    climb: {
      keys: { neg: ['KeyS'], pos: ['KeyW'] },
      keyRate: 5,
      keyReturn: 8
    },
    yaw: Object.assign({ keys: { neg: ['KeyA'], pos: ['KeyD'] }, keyRate: 6, keyReturn: 10 }, baseAxes.yaw || {}, { pad: { axis: 0, deadzone: 0.06 } }),
    pitch: Object.assign({ keys: { neg: ['ArrowDown', 'KeyK'], pos: ['ArrowUp', 'KeyI'] }, keyRate: 7, keyReturn: 12, invertSetting: 'invertPitch' }, baseAxes.pitch || {}, { pad: { axis: mode1 ? 1 : 3, invert: true, deadzone: 0.05 } }),
    roll: Object.assign({ keys: { neg: ['ArrowLeft', 'KeyJ'], pos: ['ArrowRight', 'KeyL'] }, keyRate: 7, keyReturn: 12 }, baseAxes.roll || {}, { pad: { axis: 2, deadzone: 0.05 } })
  };
  const buttons = {
    camera: { keys: ['KeyC'], pad: [3] },
    mode: { keys: ['KeyM'], pad: [5] },
    restart: { keys: ['KeyR'], pad: [8] }
  };
  const touch = [];
  for (const c of Array.isArray(src.touch) ? src.touch : []) {
    if (c.type === 'stick') {
      const s = Object.assign({}, c);
      const left = c.side === 'left';
      const throttleHere = left !== mode1;
      s.axes = left ? ['yaw', mode1 ? 'pitch' : 'throttle'] : ['roll', mode1 ? 'throttle' : 'pitch'];
      s.spring = { x: true, y: !throttleHere };
      s.caption = mode1 ? '' : c.caption;
      s.gate = throttleHere ? 'square' : undefined;
      touch.push(s);
    } else if (c.type === 'button' && (c.id === 'camera' || c.id === 'mode' || c.id === 'restart')) {
      touch.push(c);
    }
  }
  if (!touch.length) {
    touch.push({ type: 'stick', id: 'left', side: 'left', axes: ['yaw', 'throttle'], spring: { x: true, y: false }, gate: 'square', caption: 'throttleYaw' });
    touch.push({ type: 'stick', id: 'right', side: 'right', axes: ['roll', 'pitch'], spring: { x: true, y: true }, caption: 'pitchRoll' });
  }
  return Object.assign({}, src, { id: 'drone', axes, buttons, touch });
}

export function createRings(course) {
  const cps = courseCheckpoints(course);
  return {
    cps,
    passed: cps.map(() => false),
    count: 0,
    done: false,
    nearest: cps.length ? 0 : -1
  };
}

export function ringStep(rings, prevPos, pos) {
  let hit = -1;
  const cps = rings.cps;
  for (let i = 0; i < cps.length; i++) {
    if (rings.passed[i]) continue;
    const cp = cps[i];
    if (gateCrossing(cp, prevPos, pos) >= 0 || gateCrossing(cp, pos, prevPos) >= 0) {
      hit = i;
      break;
    }
  }
  if (hit >= 0) {
    rings.passed[hit] = true;
    rings.count++;
    rings.done = rings.count >= cps.length;
  }
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < cps.length; i++) {
    if (rings.passed[i]) continue;
    const p = cps[i].pos;
    const dx = p.x - pos.x;
    const dy = p.y - pos.y;
    const dz = p.z - pos.z;
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  rings.nearest = best;
  return hit;
}

export function decodeGhostString(str) {
  if (!str || typeof KitGhost.decodeGhost !== 'function') return null;
  try { return KitGhost.decodeGhost(str); } catch (_) { return null; }
}

export function createGhostRecorder() {
  return typeof KitGhost.createRecorder === 'function' ? KitGhost.createRecorder(GHOST_HZ) : null;
}

export function simulatePaceGhost(course, world, startYaw) {
  if (typeof KitGhost.createRecorder !== 'function') return null;
  const d = createDrone({ pos: course.start.pos, yaw: startYaw });
  resetDrone(d, { pos: course.start.pos, yaw: startYaw });
  const bot = createFlightBot(course);
  const rec = KitGhost.createRecorder(GHOST_HZ);
  const cp = typeof KitRace.createCheckpoints === 'function' ? KitRace.createCheckpoints(courseCheckpoints(course)) : null;
  const dt = 1 / 120;
  const limit = (course.botTime || 60) + 15;
  let t = 0;
  let after = -1;
  while (t < limit) {
    stepDrone(d, bot.control(d, dt), dt, world);
    t += dt;
    rec.push(t, d.pos, d.quat, [d.rpm]);
    if (d.crashed) break;
    if (cp && after < 0) {
      cp.test(d.prevPos, d.pos);
      if (cp.finished) after = t;
    }
    if (after >= 0 && t > after + 0.8) break;
  }
  return after >= 0 ? decodeGhostString(rec.encode({ c: course.id, pace: 1 })) : null;
}

function glowTexture() {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.22, 'rgba(255,255,255,0.75)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.18)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createGhostView(scene, color) {
  const col = new THREE.Color(color);
  const mesh = createDroneMesh({ color, ghost: true, lod: 'low' });
  mesh.group.visible = false;
  scene.add(mesh.group);
  const glowTex = glowTexture();
  const glowMat = new THREE.SpriteMaterial({ map: glowTex, color: col.clone().multiplyScalar(1.6), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: false });
  const glow = new THREE.Sprite(glowMat);
  glow.scale.set(0.045, 0.045, 1);
  glow.renderOrder = 6;
  glow.visible = false;
  scene.add(glow);
  const pos = new Float32Array(TRAIL_POINTS * 3);
  const colors = new Float32Array(TRAIL_POINTS * 3);
  for (let i = 0; i < TRAIL_POINTS; i++) {
    const k = Math.pow(1 - i / (TRAIL_POINTS - 1), 1.6) * 1.4;
    colors[i * 3] = col.r * k;
    colors[i * 3 + 1] = col.g * k;
    colors[i * 3 + 2] = col.b * k;
  }
  const geo = new THREE.BufferGeometry();
  const attr = new THREE.BufferAttribute(pos, 3);
  attr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', attr);
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const lineMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const trail = new THREE.Line(geo, lineMat);
  trail.frustumCulled = false;
  trail.renderOrder = 6;
  trail.visible = false;
  scene.add(trail);
  const sample = { pos: { x: 0, y: 0, z: 0 }, quat: { x: 0, y: 0, z: 0, w: 1 }, extra: [0] };

  function hide() {
    mesh.group.visible = false;
    glow.visible = false;
    trail.visible = false;
  }

  function prime() {
    mesh.group.visible = true;
    glow.visible = true;
    trail.visible = true;
  }

  function update(player, t, show, dt) {
    const alive = !!player && show && t <= player.duration + 1.5;
    if (!alive) {
      hide();
      return;
    }
    mesh.group.visible = true;
    glow.visible = true;
    trail.visible = t > 0.2;
    player.sample(t, sample);
    mesh.group.position.set(sample.pos.x, sample.pos.y, sample.pos.z);
    mesh.group.quaternion.set(sample.quat.x, sample.quat.y, sample.quat.z, sample.quat.w);
    mesh.setProps(sample.extra && sample.extra.length ? sample.extra[0] : 0.4, dt);
    glow.position.set(sample.pos.x, sample.pos.y, sample.pos.z);
    if (!trail.visible) return;
    const arr = attr.array;
    for (let i = 0; i < TRAIL_POINTS; i++) {
      player.sample(Math.max(0, t - i * TRAIL_STEP), sample);
      arr[i * 3] = sample.pos.x;
      arr[i * 3 + 1] = sample.pos.y;
      arr[i * 3 + 2] = sample.pos.z;
    }
    attr.needsUpdate = true;
  }

  function dispose() {
    for (const o of [mesh.group, glow, trail]) if (o.parent) o.parent.remove(o);
    mesh.dispose();
    glowTex.dispose();
    glowMat.dispose();
    geo.dispose();
    lineMat.dispose();
  }

  return { update, hide, prime, dispose, get visible() { return mesh.group.visible; } };
}
