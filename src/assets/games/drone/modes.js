import * as THREE from 'three';
import * as KitRace from '../kit/race.js';
import * as KitGhost from '../kit/ghost.js';
import { courseCheckpoints, gateCrossing, createDrone, resetDrone, step as stepDrone, createFlightBot } from './flight.js';
import { createDroneMesh } from './mesh.js';

const TRAIL_POINTS = 28;
const TRAIL_STEP = 0.045;
const GHOST_HZ = 20;

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

  return { update, hide, dispose, get visible() { return mesh.group.visible; } };
}
