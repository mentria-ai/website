import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as KitHeight from '../kit/heightfield.js';
import * as KitEnv from '../kit/env.js';
import * as KitTerrain from '../kit/terrain.js';
import * as KitProps from '../kit/props.js';
import * as KitMat from '../kit/materials.js';
import * as KitCollide from '../kit/collide.js';
import * as KitFx from '../kit/fx.js';
import { gateColliders, sceneryColliders } from './courses.js';
import { createGates } from './gates.js';

const BIOME_BY_COURSE = { meadow: 'meadow', yard: 'park', canyon: 'desert', freestyle: 'alpine' };
const SLABS_BY_COURSE = {
  yard: [{ x: -10, z: 20, w: 270, d: 480 }],
  freestyle: [{ x: 0, z: 150, w: 64, d: 104 }]
};
const FLAG_COLORS = [0x6ef3c5, 0xff5c8a, 0xffc94d, 0x4d8dff];
const CRANE_YELLOW = 0xf0b429;
const LIGHT_OFF = new THREE.Color(0.06, 0.06, 0.07);
const LIGHT_RED = new THREE.Color(2.2, 0.03, 0.02);
const LIGHT_GO = new THREE.Color(0.22, 2.4, 1.35);
const SUN_BY_COURSE = { canyon: { sunAzimuth: 95, sunElevation: 9 } };
const UP = new THREE.Vector3(0, 1, 0);

function nextFrame() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(resolve, ms))]);
}

function qualityName(q) {
  return q === 'low' || q === 'high' ? q : 'medium';
}

function boxGeometry(center, half, yaw, tile) {
  const g = new THREE.BoxGeometry(half.x * 2, half.y * 2, half.z * 2);
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const uv = g.attributes.uv;
  const t = tile || 4;
  for (let i = 0; i < pos.count; i++) {
    const ax = Math.abs(nor.getX(i));
    const ay = Math.abs(nor.getY(i));
    const x = pos.getX(i) + half.x;
    const y = pos.getY(i) + half.y;
    const z = pos.getZ(i) + half.z;
    let u;
    let v;
    if (ax > 0.5) { u = z; v = y; } else if (ay > 0.5) { u = x; v = z; } else { u = x; v = y; }
    uv.setXY(i, u / t, v / t);
  }
  if (yaw) g.rotateY(yaw);
  g.translate(center.x, center.y, center.z);
  return g;
}

function mergeInto(list) {
  if (!list.length) return null;
  const merged = mergeGeometries(list, false);
  for (const g of list) g.dispose();
  return merged;
}

function latticeTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = '#ffffff';
  ctx.lineCap = 'square';
  ctx.lineWidth = 14;
  ctx.strokeRect(7, 7, size - 14, size - 14);
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(8, 8);
  ctx.lineTo(size - 8, size - 8);
  ctx.moveTo(size - 8, 8);
  ctx.lineTo(8, size - 8);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

function padTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#15181d';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#6ef3c5';
  ctx.lineWidth = 10;
  ctx.strokeRect(14, 14, size - 28, size - 28);
  ctx.fillStyle = '#6ef3c5';
  for (let i = 0; i < 3; i++) {
    const y = 70 + i * 38;
    ctx.beginPath();
    ctx.moveTo(size / 2, y - 26);
    ctx.lineTo(size / 2 + 40, y + 6);
    ctx.lineTo(size / 2 + 26, y + 6);
    ctx.lineTo(size / 2, y - 12);
    ctx.lineTo(size / 2 - 26, y + 6);
    ctx.lineTo(size / 2 - 40, y + 6);
    ctx.closePath();
    ctx.globalAlpha = 1 - i * 0.28;
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function flagTexture() {
  const w = 64;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(0,0,0,0.38)';
  for (let y = 18; y < h - 20; y += 46) {
    ctx.beginPath();
    ctx.moveTo(w * 0.78, y);
    ctx.lineTo(w * 0.3, y + 16);
    ctx.lineTo(w * 0.78, y + 32);
    ctx.lineTo(w * 0.78, y + 24);
    ctx.lineTo(w * 0.5, y + 16);
    ctx.lineTo(w * 0.78, y + 8);
    ctx.closePath();
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function standardMaterial(name, fallback, opts) {
  if (typeof KitMat.gameMaterial === 'function') {
    try {
      const m = KitMat.gameMaterial(name, opts || {});
      if (m) return { material: m, shared: true };
    } catch (_) {}
  }
  return { material: new THREE.MeshStandardMaterial(fallback), shared: false };
}

function fallbackEnvironment(scene, preset) {
  const tints = {
    golden: [0xf2b27a, 0xe7b089, 0xffd2a0, 0x4b3a22],
    day: [0x9cc8ee, 0xb8d4ea, 0xffffff, 0x4a4a3a],
    sunset: [0xe98a5a, 0xd98f66, 0xffb07a, 0x5a3020],
    night: [0x0b1020, 0x10162a, 0x8899ff, 0x05060a]
  };
  const c = tints[preset] || tints.day;
  const group = new THREE.Group();
  scene.background = new THREE.Color(c[0]);
  scene.fog = new THREE.Fog(c[1], 160, 1100);
  const hemi = new THREE.HemisphereLight(0xffffff, c[3], 1.1);
  const sun = new THREE.DirectionalLight(c[2], 2.6);
  sun.position.set(-200, 260, 160);
  group.add(hemi, sun, sun.target);
  scene.add(group);
  return {
    sunDirection: sun.position.clone().normalize(),
    update() {},
    setHeightAt() {},
    dispose() {
      scene.remove(group);
      scene.background = null;
      scene.fog = null;
    }
  };
}

function fallbackTerrain(scene, hf, segments, preset) {
  const span = hf.size;
  const g = new THREE.PlaneGeometry(span, span, segments, segments);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, hf.heightAt(p.getX(i), p.getZ(i)));
  g.computeVertexNormals();
  const color = preset === 'sunset' ? 0xb07a4e : 0x5f7f38;
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 0.95 }));
  mesh.receiveShadow = true;
  scene.add(mesh);
  const cell = span / segments;
  const half = span / 2;
  const verts = segments + 1;
  const heights = new Float32Array(verts * verts);
  for (let iz = 0; iz < verts; iz++) for (let ix = 0; ix < verts; ix++) heights[iz * verts + ix] = hf.heightAt(-half + ix * cell, -half + iz * cell);
  function heightAt(x, z) {
    const gx = Math.min(segments - 1e-6, Math.max(0, (x + half) / cell));
    const gz = Math.min(segments - 1e-6, Math.max(0, (z + half) / cell));
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const fx = gx - ix;
    const fz = gz - iz;
    const h00 = heights[iz * verts + ix];
    const h10 = heights[iz * verts + ix + 1];
    const h01 = heights[(iz + 1) * verts + ix];
    const h11 = heights[(iz + 1) * verts + ix + 1];
    if (fx + fz <= 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
    return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
  }
  return {
    mesh,
    heightAt,
    normalAt: hf.normalAt,
    size: span,
    update() {},
    dispose() {
      scene.remove(mesh);
      g.dispose();
      mesh.material.dispose();
    }
  };
}

function areaRect(area) {
  if (!Array.isArray(area) || area.length < 4) return undefined;
  const [x0, z0, x1, z1] = area;
  return { x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: Math.abs(x1 - x0), d: Math.abs(z1 - z0) };
}

function yawToward(fromX, fromZ, toX, toZ) {
  return Math.atan2(-(toX - fromX), -(toZ - fromZ));
}

export function startYawToGate(course) {
  const s = course.start;
  const g = course.gates && course.gates[0];
  if (!g) return s.yaw || 0;
  return typeof s.yaw === 'number' ? s.yaw : yawToward(s.pos[0], s.pos[2], g.pos[0], g.pos[2]);
}

export async function buildWorld(course, opts = {}) {
  const scene = opts.scene;
  const renderer = opts.renderer;
  const camera = opts.camera || null;
  const q = qualityName(opts.quality);
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};
  const t0 = performance.now();
  const disposers = [];
  const props = [];
  const geometries = [];
  const ownMaterials = [];
  const textures = [];
  const meshes = [];
  const lights = [];
  const root = new THREE.Group();
  root.name = 'skyrush-world-' + course.id;
  scene.add(root);

  const report = async (p, label) => {
    onProgress(p, label);
    await nextFrame();
  };

  await report(0.04, 'terrain');
  const hfOpts = course.env.terrain;
  const hf = KitHeight.createHeightfield(hfOpts);

  let env = null;
  if (typeof KitEnv.createEnvironment === 'function') {
    try {
      env = KitEnv.createEnvironment(scene, renderer, Object.assign({
        preset: course.env.preset,
        quality: q,
        backdrop: course.env.backdrop,
        heightAt: hf.heightAt,
        seed: hfOpts.seed
      }, SUN_BY_COURSE[course.id] || null));
    } catch (err) {
      console.error('[skyrush] environment', err);
      env = null;
    }
  }
  if (!env) env = fallbackEnvironment(scene, course.env.preset);
  disposers.push(() => env.dispose());
  await report(0.16, 'sky');

  const segments = Math.max(192, Math.min(384, Math.round(hf.size / 4.7 / 32) * 32));
  let terrain = null;
  if (typeof KitTerrain.createTerrain === 'function') {
    try {
      terrain = KitTerrain.createTerrain({
        heightfield: hf,
        segments,
        quality: q,
        biome: BIOME_BY_COURSE[course.id] || 'meadow',
        sunDirection: env.lightDirection || env.sunDirection,
        cloudShadows: env.cloudShadows,
        scene
      });
      if (terrain && terrain.mesh && !terrain.mesh.parent) scene.add(terrain.mesh);
    } catch (err) {
      console.error('[skyrush] terrain', err);
      terrain = null;
    }
  }
  if (!terrain || typeof terrain.heightAt !== 'function') terrain = fallbackTerrain(scene, hf, Math.min(segments, 220), course.env.preset);
  disposers.push(() => terrain.dispose());
  const heightAt = terrain.heightAt;
  if (typeof env.setHeightAt === 'function') env.setHeightAt(heightAt);
  const groundTerrain = { heightAt, normalAt: terrain.normalAt || hf.normalAt, size: hf.size };
  await report(0.36, 'terrain');

  const collision = typeof KitCollide.createCollisionWorld === 'function' ? KitCollide.createCollisionWorld({ cellSize: 16 }) : null;
  const addColliders = (list) => {
    if (collision && Array.isArray(list) && list.length) collision.addColliders(list);
  };

  const sc = course.scenery || {};
  const avoid = (sc.avoid || []).map((a) => ({ x: a[0], z: a[1], radius: a[2] }));
  avoid.push({ x: course.start.pos[0], z: course.start.pos[2], radius: 10 });
  for (const g of course.gates) avoid.push({ x: g.pos[0], z: g.pos[2], radius: Math.max(8, (g.w || 3) * 1.6) });

  for (const slab of SLABS_BY_COURSE[course.id] || []) {
    const mat = standardMaterial('asphalt', { color: 0x4a4c4e, roughness: 0.95 }, { repeat: [slab.w / 8, slab.d / 8], color: 0x9a9a98 });
    const g = new THREE.PlaneGeometry(slab.w, slab.d, 1, 1);
    g.rotateX(-Math.PI / 2);
    g.translate(slab.x, heightAt(slab.x, slab.z) + 0.035, slab.z);
    const m = new THREE.Mesh(g, mat.material);
    m.receiveShadow = true;
    root.add(m);
    geometries.push(g);
    if (!mat.shared) ownMaterials.push(mat.material);
  }

  if (typeof KitProps.setPropsRenderer === 'function') {
    try { KitProps.setPropsRenderer(renderer); } catch (_) {}
  }
  const scatterList = sc.scatter || [];
  for (let i = 0; i < scatterList.length; i++) {
    const s = scatterList[i];
    if (typeof KitProps.scatter !== 'function') break;
    try {
      const res = KitProps.scatter(scene, groundTerrain, {
        kind: s.kind,
        count: s.count,
        area: areaRect(s.area),
        seed: s.seed,
        avoid,
        quality: q,
        renderer
      });
      if (res) {
        props.push(res);
        addColliders(res.colliders);
      }
    } catch (err) {
      console.error('[skyrush] scatter', s.kind, err);
    }
    await report(0.36 + 0.24 * ((i + 1) / scatterList.length), 'trees');
  }

  if ((sc.containers || []).length && typeof KitProps.containers === 'function') {
    try {
      const stacks = sc.containers.map((c) => ({ x: c[0], z: c[1], yaw: c[2] || 0, rows: 1, cols: 1, tiers: c[3] || 1, ragged: false, mix20: false, length: 12.2, gap: 0 }));
      const res = KitProps.containers(scene, { stacks, terrain: groundTerrain, quality: q, seed: hfOpts.seed });
      if (res) props.push(res);
    } catch (err) {
      console.error('[skyrush] containers', err);
    }
  }
  await report(0.66, 'yard');

  if ((sc.lights || []).length && typeof KitProps.lampPosts === 'function') {
    try {
      const items = sc.lights.map((l) => ({ x: l[0], z: l[1], yaw: yawToward(l[0], l[1], 0, 0) }));
      const res = KitProps.lampPosts(scene, { items, terrain: groundTerrain, height: 10, night: course.env.preset === 'night', quality: q });
      if (res) props.push(res);
    } catch (err) {
      console.error('[skyrush] lamps', err);
    }
  }

  const structures = buildStructures(course, heightAt, q);
  root.add(structures.group);
  disposers.push(() => structures.dispose());
  lights.push(...structures.lights);
  await report(0.78, 'structures');

  addColliders(sceneryColliders(sc, heightAt));
  addColliders(gateColliders(course.gates, heightAt));

  const gates = createGates(scene, course.gates, { heightAt });
  disposers.push(() => gates.dispose());

  const pad = buildStartPad(course, heightAt);
  root.add(pad.group);
  disposers.push(() => pad.dispose());
  await report(0.86, 'gates');

  let particles = null;
  if (typeof KitFx.createParticles === 'function') {
    try {
      particles = KitFx.createParticles(scene, { quality: q, heightAt, max: 2400 });
      disposers.push(() => particles.dispose());
    } catch (err) {
      console.error('[skyrush] particles', err);
      particles = null;
    }
  }

  if (typeof KitMat.texturesReady === 'function') {
    try { await withTimeout(KitMat.texturesReady(), 6000); } catch (_) {}
  }
  await report(0.93, 'shaders');
  if (camera && renderer && typeof renderer.compileAsync === 'function') {
    try { await withTimeout(renderer.compileAsync(scene, camera), 8000); } catch (_) {}
  }
  await report(1, 'ready');

  const buildMs = Math.round(performance.now() - t0);
  let disposed = false;

  function update(cam, dt, time) {
    if (disposed) return;
    if (env && typeof env.update === 'function') env.update(cam, dt);
    if (terrain && typeof terrain.update === 'function') terrain.update(cam, dt);
    for (let i = 0; i < props.length; i++) {
      const p = props[i];
      if (p && typeof p.update === 'function') p.update(cam, dt);
    }
    gates.update(time);
    if (particles) particles.update(dt, cam);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const p of props) {
      try { if (p && typeof p.dispose === 'function') p.dispose(); } catch (_) {}
    }
    for (const fn of disposers.reverse()) {
      try { fn(); } catch (_) {}
    }
    scene.remove(root);
    for (const g of geometries) g.dispose();
    for (const m of ownMaterials) m.dispose();
    for (const t of textures) t.dispose();
    if (collision && typeof collision.clear === 'function') collision.clear();
  }

  return {
    course,
    hf,
    heightAt,
    normalAt: groundTerrain.normalAt,
    size: hf.size,
    env,
    terrain,
    collision,
    gates,
    particles,
    startLights: pad.lights,
    padTop: pad.top,
    buildMs,
    sphereVsWorld: collision ? (pos, r) => collision.sphereVsWorld(pos, r) : null,
    raycast: collision ? (o, d, m) => collision.raycast(o, d, m) : null,
    update,
    dispose
  };
}

function buildStructures(course, heightAt, q) {
  const sc = course.scenery || {};
  const group = new THREE.Group();
  group.name = 'skyrush-structures';
  const geos = [];
  const mats = [];
  const texs = [];
  const lights = [];

  const walls = [];
  const roofs = [];
  const floors = [];
  const strips = [];
  for (const b of sc.warehouses || []) {
    const boxes = sceneryColliders({ warehouses: [b] }, heightAt);
    const gy = heightAt(b.x, b.z);
    for (const c of boxes) {
      const isRoof = c.center.y > gy + b.h;
      const target = isRoof ? roofs : walls;
      target.push(boxGeometry(c.center, c.half, c.yaw, isRoof ? 6 : 3.2));
    }
    const floor = new THREE.PlaneGeometry(b.w - 0.6, b.d - 0.6);
    floor.rotateX(-Math.PI / 2);
    floor.rotateY(b.yaw || 0);
    floor.translate(b.x, gy + 0.03, b.z);
    floors.push(floor);
    const yaw = b.yaw || 0;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const rows = Math.max(2, Math.round(b.d / 10));
    for (let k = 0; k < rows; k++) {
      const lz = -b.d / 2 + (b.d * (k + 0.5)) / rows;
      for (const lx of [-b.w * 0.22, b.w * 0.22]) {
        const strip = new THREE.BoxGeometry(0.35, 0.12, 4.5);
        strip.rotateY(yaw);
        strip.translate(b.x + lx * c + lz * s, gy + b.h - 0.5, b.z - lx * s + lz * c);
        strips.push(strip);
      }
    }
    if (q !== 'low') {
      for (const lz of [-b.d * 0.25, b.d * 0.25]) {
        const light = new THREE.PointLight(0xdff3ff, 140, b.d * 0.9, 1.6);
        light.position.set(b.x + lz * s, gy + b.h - 2, b.z + lz * c);
        group.add(light);
        lights.push(light);
      }
    }
  }
  if (walls.length) {
    const g = mergeInto(walls);
    const m = standardMaterial('metal-panel', { color: 0x7d858c, roughness: 0.6, metalness: 0.6 }, { color: 0xb9c0c6 });
    const mesh = new THREE.Mesh(g, m.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    geos.push(g);
    if (!m.shared) mats.push(m.material);
  }
  if (roofs.length) {
    const g = mergeInto(roofs);
    const m = standardMaterial('metal-panel', { color: 0x4a5056, roughness: 0.65, metalness: 0.6 }, { color: 0x6c737a });
    const mesh = new THREE.Mesh(g, m.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    geos.push(g);
    if (!m.shared) mats.push(m.material);
  }
  if (floors.length) {
    const g = mergeInto(floors);
    const m = standardMaterial('concrete', { color: 0x6f716d, roughness: 0.9 }, { color: 0x77797a });
    const mesh = new THREE.Mesh(g, m.material);
    mesh.receiveShadow = true;
    group.add(mesh);
    geos.push(g);
    if (!m.shared) mats.push(m.material);
  }
  if (strips.length) {
    const g = mergeInto(strips);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.6, 2.7) });
    group.add(new THREE.Mesh(g, mat));
    geos.push(g);
    mats.push(mat);
  }

  const lattice = [];
  const solid = [];
  for (const k of sc.cranes || []) {
    const boxes = sceneryColliders({ cranes: [k] }, heightAt);
    for (const c of boxes) {
      const minor = Math.min(c.half.x, c.half.y, c.half.z) * 2;
      lattice.push(boxGeometry(c.center, c.half, c.yaw, Math.max(0.9, minor)));
    }
    const gy = heightAt(k.x, k.z);
    const yaw = k.yaw || 0;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    if (k.kind === 'tower') {
      solid.push(boxGeometry({ x: k.x + 1.9 * c, y: gy + k.h - 1.2, z: k.z - 1.9 * s }, { x: 1.2, y: 1.1, z: 1.3 }, yaw, 2));
      solid.push(boxGeometry({ x: k.x + 9 * s, y: gy + k.h + 0.4, z: k.z + 9 * c }, { x: 1.4, y: 1.3, z: 2.2 }, yaw, 2));
    } else {
      const lx = k.span * 0.32;
      solid.push(boxGeometry({ x: k.x + lx * c + 5 * s, y: gy + k.h - 2.6, z: k.z - lx * s + 5 * c }, { x: 1.1, y: 1, z: 1.1 }, yaw, 2));
    }
  }
  if (lattice.length) {
    const g = mergeInto(lattice);
    const tex = latticeTexture();
    texs.push(tex);
    const mat = new THREE.MeshStandardMaterial({ color: CRANE_YELLOW, map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.55, metalness: 0.35 });
    const mesh = new THREE.Mesh(g, mat);
    mesh.castShadow = true;
    group.add(mesh);
    geos.push(g);
    mats.push(mat);
  }
  if (solid.length) {
    const g = mergeInto(solid);
    const mat = new THREE.MeshStandardMaterial({ color: 0xd9a01c, roughness: 0.5, metalness: 0.3 });
    const mesh = new THREE.Mesh(g, mat);
    mesh.castShadow = true;
    group.add(mesh);
    geos.push(g);
    mats.push(mat);
  }

  const poles = [];
  const banners = [];
  for (const f of sc.flags || []) {
    const [x, z, ci] = f;
    const gy = heightAt(x, z);
    const pole = new THREE.CylinderGeometry(0.035, 0.05, 5.2, 6, 1, false);
    pole.translate(x, gy + 2.6, z);
    poles.push(pole);
    const banner = new THREE.PlaneGeometry(0.85, 3.4, 1, 6);
    const p = banner.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const vy = p.getY(i);
      const vx = p.getX(i);
      p.setZ(i, Math.sin((vy + 1.7) * 1.3 + x) * 0.12 * (vx + 0.43));
    }
    banner.computeVertexNormals();
    banner.translate(0.46, 0, 0);
    banner.rotateY(((x * 13 + z * 7) % 6) * 0.5);
    banner.translate(x, gy + 3.4, z);
    const col = new THREE.Color(FLAG_COLORS[(ci || 0) % FLAG_COLORS.length]);
    const n = banner.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
    banner.setAttribute('color', new THREE.Float32BufferAttribute(arr, 3));
    banners.push(banner);
  }
  if (poles.length) {
    const g = mergeInto(poles);
    const mat = new THREE.MeshStandardMaterial({ color: 0x2b2f35, roughness: 0.4, metalness: 0.8 });
    const mesh = new THREE.Mesh(g, mat);
    mesh.castShadow = true;
    group.add(mesh);
    geos.push(g);
    mats.push(mat);
  }
  if (banners.length) {
    const g = mergeInto(banners);
    const tex = flagTexture();
    texs.push(tex);
    const mat = new THREE.MeshStandardMaterial({ map: tex, vertexColors: true, side: THREE.DoubleSide, roughness: 0.85 });
    const mesh = new THREE.Mesh(g, mat);
    mesh.castShadow = true;
    group.add(mesh);
    geos.push(g);
    mats.push(mat);
  }

  return {
    group,
    lights,
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of mats) m.dispose();
      for (const t of texs) t.dispose();
    }
  };
}

function buildStartPad(course, heightAt) {
  const group = new THREE.Group();
  group.name = 'skyrush-start';
  const sp = course.start.pos;
  const yaw = startYawToGate(course);
  const gy = heightAt(sp[0], sp[2]);
  const tex = padTexture();
  const padGeo = new THREE.PlaneGeometry(1.2, 1.2);
  padGeo.rotateX(-Math.PI / 2);
  const padMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.18, polygonOffset: true, polygonOffsetFactor: -2 });
  const pad = new THREE.Mesh(padGeo, padMat);
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  pad.rotation.y = yaw;
  pad.position.set(sp[0] - fx * 0.45, heightAt(sp[0] - fx * 0.45, sp[2] - fz * 0.45) + 0.012, sp[2] - fz * 0.45);
  pad.receiveShadow = true;
  group.add(pad);

  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  const sx = sp[0] + fx * 4.2 - rx * 1.7;
  const sz = sp[2] + fz * 4.2 - rz * 1.7;
  const sg = heightAt(sx, sz);
  const standGeos = [];
  for (const side of [-0.75, 0.75]) {
    const leg = new THREE.CylinderGeometry(0.03, 0.04, 2.2, 6);
    leg.translate(side, 1.1, 0);
    standGeos.push(leg);
  }
  const bar = new THREE.BoxGeometry(1.9, 0.42, 0.14);
  bar.translate(0, 2.25, 0);
  standGeos.push(bar);
  const standGeo = mergeInto(standGeos);
  const standMat = new THREE.MeshStandardMaterial({ color: 0x1b1e23, roughness: 0.5, metalness: 0.6 });
  const stand = new THREE.Mesh(standGeo, standMat);
  stand.castShadow = true;
  const standRoot = new THREE.Group();
  standRoot.position.set(sx, sg, sz);
  standRoot.rotation.y = yaw;
  standRoot.add(stand);
  group.add(standRoot);

  const lampGeo = new THREE.CircleGeometry(0.15, 18);
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: true });
  const lamps = new THREE.InstancedMesh(lampGeo, lampMat, 3);
  const m = new THREE.Matrix4();
  for (let i = 0; i < 3; i++) {
    m.makeTranslation((i - 1) * 0.55, 2.25, 0.075);
    lamps.setMatrixAt(i, m);
    lamps.setColorAt(i, LIGHT_OFF);
  }
  lamps.instanceMatrix.needsUpdate = true;
  if (lamps.instanceColor) lamps.instanceColor.needsUpdate = true;
  standRoot.add(lamps);

  function set(stateName, count) {
    for (let i = 0; i < 3; i++) {
      let c = LIGHT_OFF;
      if (stateName === 'go') c = LIGHT_GO;
      else if (stateName === 'count' && i < count) c = LIGHT_RED;
      lamps.setColorAt(i, c);
    }
    if (lamps.instanceColor) lamps.instanceColor.needsUpdate = true;
  }

  return {
    group,
    top: gy,
    lights: { set },
    dispose() {
      padGeo.dispose();
      padMat.dispose();
      tex.dispose();
      standGeo.dispose();
      standMat.dispose();
      lampGeo.dispose();
      lampMat.dispose();
      lamps.dispose();
    }
  };
}

export function gateFacing(course, index) {
  const gates = course.gates;
  const g = gates[index];
  const next = gates[index + 1];
  if (!g) return startYawToGate(course);
  if (!next) return g.yaw || 0;
  return yawToward(g.pos[0], g.pos[2], next.pos[0], next.pos[2]);
}

export { UP as WORLD_UP };
