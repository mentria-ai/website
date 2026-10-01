import * as THREE from 'three';
import { createHeightfield } from '../kit/heightfield.js';
import { smoothstep } from '../kit/math.js';
import { createEnvironment } from '../kit/env.js';
import { createTerrain } from '../kit/terrain.js';
import * as props from '../kit/props.js';
import * as mats from '../kit/materials.js';
import { buildTrackMeshes } from '../kit/track.js';

const TRACK_BIOMES = { 'neon-city': 'urban', coast: 'coast', 'canyon-run': 'desert' };
const PRESET_BIOMES = { night: 'urban', day: 'coast', sunset: 'desert', golden: 'meadow' };
const NEON_INDEX = { 'neon-1': 0, 'neon-2': 1, 'neon-3': 2, 'neon-4': 3 };
const NEON_TINTS = ['#ff3aa8', '#36e6ff', '#ffb347', '#8a63ff'];
const CELL_BY_QUALITY = { low: 7, medium: 5.5, high: 4.5 };
const ENV_TWEAKS = { 'canyon-run': { sunElevation: 9, sunAzimuth: 95 } };

function worldNow() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function yieldFrame() {
  return new Promise(function (resolve) {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(function () { setTimeout(resolve, 0); });
    else setTimeout(resolve, 0);
  });
}

function vecFrom(v) {
  if (!v) return null;
  if (Array.isArray(v)) return { x: v[0], y: v[1], z: v[2] };
  if (typeof v === 'object' && typeof v.x === 'number') return { x: v.x, y: v.y, z: v.z };
  return null;
}

function safeCall(name, list, args) {
  const fn = props[name];
  if (typeof fn !== 'function') return null;
  try {
    const r = fn.apply(null, args);
    if (r) list.push(r);
    return r;
  } catch (err) {
    try { console.warn('[nitro-racer] ' + name + ' failed: ' + (err && err.message)); } catch (_) {}
    return null;
  }
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 64, 2, 32, 64, 62);
  grad.addColorStop(0, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function buildRoadGlows(track, items, tintFor, intensity) {
  if (!items || !items.length) return null;
  const tex = glowTexture();
  const pos = [];
  const uv = [];
  const col = [];
  const idx = [];
  const color = new THREE.Color();
  let v = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const near = track.nearest(it.x, it.z, 40);
    if (!near) continue;
    const s = near.s;
    const smp = track.sample(s);
    const side = near.lateralFlat >= 0 ? 1 : -1;
    const halfW = smp.width / 2;
    const len = it.len || Math.min(halfW * 1.7, 13);
    const wid = it.wid || 3.2;
    const lat0 = side * (halfW - 0.4);
    const lat1 = side * (halfW - 0.4 - len);
    const along = wid / 2;
    const p = [
      track.pointAt(s - along, lat0, 0.06),
      track.pointAt(s + along, lat0, 0.06),
      track.pointAt(s + along, lat1, 0.06),
      track.pointAt(s - along, lat1, 0.06)
    ];
    color.set(tintFor(it, i));
    const k = intensity * (it.strength || 1);
    for (let q = 0; q < 4; q++) {
      pos.push(p[q].x, p[q].y, p[q].z);
      col.push(color.r * k, color.g * k, color.b * k);
    }
    uv.push(0, 0.5, 1, 0.5, 1, 0, 0, 0);
    idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
    v += 4;
  }
  if (!v) { tex.dispose(); return null; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  const mat = new THREE.MeshBasicMaterial({
    map: tex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'nr-road-glow';
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;
  return {
    mesh,
    dispose() {
      mesh.removeFromParent();
      geo.dispose();
      mat.dispose();
      tex.dispose();
    }
  };
}

export function createSkidMarks(scene, opts = {}) {
  const max = Math.max(64, opts.max || 1400);
  const positions = new Float32Array(max * 4 * 3);
  const colors = new Float32Array(max * 4 * 4);
  const index = new Uint32Array(max * 6);
  for (let i = 0; i < max; i++) {
    const v = i * 4;
    const o = i * 6;
    index[o] = v; index[o + 1] = v + 1; index[o + 2] = v + 2;
    index[o + 3] = v; index[o + 4] = v + 2; index[o + 5] = v + 3;
  }
  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(positions, 3);
  const colAttr = new THREE.BufferAttribute(colors, 4);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  colAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('color', colAttr);
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  const mat = new THREE.MeshBasicMaterial({
    color: opts.color == null ? 0x0a0a0a : opts.color,
    vertexColors: true, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'nr-skids';
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  scene.add(mesh);
  const tracks = new Map();
  let head = 0;
  let dirtyLo = Infinity;
  let dirtyHi = -1;

  function mark(lo, hi) {
    if (lo < dirtyLo) dirtyLo = lo;
    if (hi > dirtyHi) dirtyHi = hi;
  }

  function add(id, x, y, z, rx, rz, width, alpha) {
    let t = tracks.get(id);
    if (!t) {
      t = { x: 0, y: 0, z: 0, rx: 1, rz: 0, live: false };
      tracks.set(id, t);
    }
    if (!t.live) {
      t.x = x; t.y = y; t.z = z; t.rx = rx; t.rz = rz; t.live = true;
      return;
    }
    const dx = x - t.x;
    const dz = z - t.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < 0.36) return;
    if (d2 > 36) {
      t.x = x; t.y = y; t.z = z; t.rx = rx; t.rz = rz;
      return;
    }
    const hw = width / 2;
    const q = head;
    head = (head + 1) % max;
    const p = q * 12;
    positions[p] = t.x - t.rx * hw; positions[p + 1] = t.y; positions[p + 2] = t.z - t.rz * hw;
    positions[p + 3] = t.x + t.rx * hw; positions[p + 4] = t.y; positions[p + 5] = t.z + t.rz * hw;
    positions[p + 6] = x + rx * hw; positions[p + 7] = y; positions[p + 8] = z + rz * hw;
    positions[p + 9] = x - rx * hw; positions[p + 10] = y; positions[p + 11] = z - rz * hw;
    const c = q * 16;
    for (let k = 0; k < 4; k++) {
      colors[c + k * 4] = 1; colors[c + k * 4 + 1] = 1; colors[c + k * 4 + 2] = 1;
      colors[c + k * 4 + 3] = alpha;
    }
    mark(q, q);
    t.x = x; t.y = y; t.z = z; t.rx = rx; t.rz = rz;
  }

  function lift(id) {
    const t = tracks.get(id);
    if (t) t.live = false;
  }

  function flush() {
    if (dirtyHi < 0) return;
    posAttr.clearUpdateRanges();
    colAttr.clearUpdateRanges();
    posAttr.addUpdateRange(dirtyLo * 12, (dirtyHi - dirtyLo + 1) * 12);
    colAttr.addUpdateRange(dirtyLo * 16, (dirtyHi - dirtyLo + 1) * 16);
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    dirtyLo = Infinity;
    dirtyHi = -1;
  }

  function clear() {
    positions.fill(0);
    colors.fill(0);
    tracks.clear();
    head = 0;
    posAttr.clearUpdateRanges();
    colAttr.clearUpdateRanges();
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    dirtyLo = Infinity;
    dirtyHi = -1;
  }

  return {
    mesh,
    add,
    lift,
    flush,
    clear,
    dispose() {
      mesh.removeFromParent();
      geo.dispose();
      mat.dispose();
      tracks.clear();
    }
  };
}

function groupContainers(list) {
  const stacks = new Map();
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    const key = Math.round(c.x * 2) + ',' + Math.round(c.z * 2);
    const st = stacks.get(key);
    if (st) st.tiers += 1;
    else stacks.set(key, { x: c.x, z: c.z, yaw: c.yaw || 0, rows: 1, cols: 1, tiers: 1, color: c.color });
  }
  return Array.from(stacks.values());
}

function trackArea(track, pad) {
  const b = track.bounds;
  return {
    x: (b.minX + b.maxX) / 2,
    z: (b.minZ + b.maxZ) / 2,
    w: (b.maxX - b.minX) + pad * 2,
    d: (b.maxZ - b.minZ) + pad * 2
  };
}

export async function buildRacerWorld(opts = {}) {
  const t0 = worldNow();
  const scene = opts.scene;
  const renderer = opts.renderer;
  const def = opts.def;
  const track = opts.track;
  const quality = opts.quality || {};
  const qualityName = opts.qualityName || quality.name || 'medium';
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : function () {};
  const envDef = def.env || {};
  const night = envDef.preset === 'night';
  const parts = [];
  const timings = {};
  let mark = worldNow();
  function lap(name) {
    const n = worldNow();
    timings[name] = Math.round(n - mark);
    mark = n;
  }

  if (typeof props.setPropsRenderer === 'function') {
    try { props.setPropsRenderer(renderer); } catch (_) {}
  }

  onProgress(0.08);
  const terrainDef = Object.assign({}, envDef.terrain || { shape: 'flat', seed: 1, size: 1600, height: 8 });
  let modify = null;
  try { modify = typeof track.terrainModify === 'function' ? track.terrainModify() : null; } catch (_) { modify = null; }
  let landRim = null;
  if (terrainDef.shape === 'coast' && terrainDef.rim == null) {
    const half = (terrainDef.size || 1200) / 2;
    const lift = Math.max(terrainDef.height || 60, 30) * 1.3;
    terrainDef.rim = 0;
    landRim = function (x, z, h) {
      const w = smoothstep(-half * 0.1, half * 0.1, x);
      const e = Math.max(x / half, (Math.abs(z) / half) * w);
      return h + smoothstep(0.8, 1, e) * lift;
    };
  }
  const prevModify = typeof terrainDef.modify === 'function' ? terrainDef.modify : null;
  if (modify || landRim || prevModify) {
    terrainDef.modify = function (x, z, h) {
      let v = prevModify ? prevModify(x, z, h) : h;
      if (landRim) v = landRim(x, z, v);
      return modify ? modify(x, z, v) : v;
    };
  }
  const heightfield = createHeightfield(terrainDef);
  lap('heightfield');

  const sunDirection = vecFrom(envDef.sunDirection);
  const envOpts = {
    preset: envDef.preset || 'day',
    quality,
    backdrop: envDef.backdrop || null,
    heightAt: heightfield.heightAt,
    seed: terrainDef.seed || 1
  };
  const tweak = ENV_TWEAKS[def.id] || null;
  if (tweak) Object.assign(envOpts, tweak);
  else if (sunDirection) envOpts.sunDirection = sunDirection;
  if (envDef.overrides) envOpts.overrides = envDef.overrides;
  const env = createEnvironment(scene, renderer, envOpts);
  lap('env');
  onProgress(0.2);
  await yieldFrame();

  const biome = envDef.biome || TRACK_BIOMES[def.id] || PRESET_BIOMES[envDef.preset] || 'meadow';
  const cellSize = CELL_BY_QUALITY[qualityName] || 5.5;
  const segments = opts.segments || Math.max(192, Math.min(600, Math.round((heightfield.size || 1600) / cellSize)));
  const terrain = createTerrain({
    heightfield,
    segments,
    quality,
    biome,
    waterLevel: envDef.waterLevel == null ? undefined : envDef.waterLevel,
    sunDirection: env.lightDirection || env.sunDirection,
    cloudShadows: env.cloudShadows
  });
  scene.add(terrain.mesh);
  lap('terrain');
  onProgress(0.45);
  await yieldFrame();

  const trackOpts = { envMap: env.envMap, shadows: !!quality.shadows };
  if (opts.roadMaterial) trackOpts.materials = { road: opts.roadMaterial };
  const trackMeshes = buildTrackMeshes(THREE, track, trackOpts);
  scene.add(trackMeshes.group);
  trackMeshes.group.traverse(function (o) {
    if (o.isMesh && !o.isInstancedMesh) {
      if (!quality.shadows) o.castShadow = false;
    }
  });
  lap('track');
  onProgress(0.6);
  await yieldFrame();

  const sc = def.scenery || {};
  let layout = {};
  try { layout = track.layoutScenery(sc, (terrainDef.seed || 1) * 31 + 7) || {}; } catch (err) {
    try { console.warn('[nitro-racer] scenery layout failed: ' + (err && err.message)); } catch (_) {}
    layout = {};
  }
  const builders = [];
  const groundAt = terrain.heightAt;

  if (layout.buildings && layout.buildings.length) {
    const lots = layout.buildings.map(function (b) {
      const style = b.style === 'night' ? 'office' : b.style;
      return { x: b.x, z: b.z, w: b.w, d: b.d, h: b.h, yaw: b.yaw || 0, style: style || 'office' };
    });
    safeCall('buildings', builders, [scene, { terrain, lots, night, quality, seed: 11 }]);
  }
  onProgress(0.68);
  await yieldFrame();

  if (layout.lampPosts && layout.lampPosts.length) {
    const items = layout.lampPosts.map(function (l) { return { x: l.x, z: l.z, yaw: (l.yaw || 0) + Math.PI }; });
    safeCall('lampPosts', builders, [scene, { terrain, items, night, quality, height: 9 }]);
  }

  if (layout.neonSigns && layout.neonSigns.length) {
    const items = layout.neonSigns.map(function (n, i) {
      const idx = typeof n.image === 'number' ? n.image : (NEON_INDEX[n.image] == null ? i % 4 : NEON_INDEX[n.image]);
      return { x: n.x, y: n.y, z: n.z, yaw: (n.yaw || 0) + Math.PI, width: n.w || 6, height: n.h || 3, image: idx };
    });
    safeCall('neonSigns', builders, [scene, { items, night }]);
  }

  if (layout.billboards && layout.billboards.length) {
    const images = [];
    const items = layout.billboards.map(function (b) {
      const base = groundAt(b.x, b.z);
      const h = b.h || 6;
      images.push(b.image || 'billboard-1');
      return { x: b.x, z: b.z, yaw: (b.yaw || 0) + Math.PI, width: b.w || 12, height: h, elevation: Math.max(2, b.y - base - h / 2) };
    });
    safeCall('billboards', builders, [scene, { terrain, items, images, night, quality }]);
  }

  if (layout.containers && layout.containers.length) {
    safeCall('containers', builders, [scene, { terrain, stacks: groupContainers(layout.containers), seed: 5, quality }]);
  }

  if (layout.cones && layout.cones.length) {
    const items = layout.cones.map(function (c) { return { x: c.x, z: c.z }; });
    safeCall('cones', builders, [scene, { terrain, items, quality }]);
  }
  onProgress(0.76);
  await yieldFrame();

  const rules = Array.isArray(sc.scatter) ? sc.scatter : [];
  const area = trackArea(track, 260);
  const vegScale = opts.vegetationScale == null ? 1 : opts.vegetationScale;
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    if (!rule || !rule.kind) continue;
    const band = rule.band || [8, 70];
    const near = band[0];
    const far = band[1];
    const reach = far + 12;
    const avoid = function (x, z) {
      const r = track.nearest(x, z, reach);
      if (!r) return true;
      return r.edgeDist < near || r.edgeDist > far;
    };
    const count = Math.round((rule.count || 200) * vegScale);
    safeCall('scatter', builders, [scene, terrain, {
      kind: rule.kind,
      count,
      seed: (rule.seed || 3) + i * 17,
      area,
      avoid,
      quality,
      renderer,
      maxSlope: rule.maxSlope,
      minHeight: rule.minHeight,
      maxHeight: rule.maxHeight,
      exactCount: rule.exactCount
    }]);
    if (i % 2 === 1) await yieldFrame();
  }
  lap('scenery');
  onProgress(0.88);

  let glows = null;
  if (night) {
    const glowItems = [];
    const neon = layout.neonSigns || [];
    for (let i = 0; i < neon.length; i++) {
      glowItems.push({ x: neon[i].x, z: neon[i].z, tint: NEON_TINTS[(NEON_INDEX[neon[i].image] == null ? i : NEON_INDEX[neon[i].image]) % NEON_TINTS.length], strength: 0.9, len: 10, wid: 4.2 });
    }
    const lamps = layout.lampPosts || [];
    const lampTint = (def.style && def.style.lightsColor) || '#ffd8a6';
    for (let i = 0; i < lamps.length; i++) {
      glowItems.push({ x: lamps[i].x, z: lamps[i].z, tint: lampTint, strength: 0.42, len: 7, wid: 5.5 });
    }
    glows = buildRoadGlows(track, glowItems, function (it) { return it.tint; }, 0.5);
    if (glows) {
      scene.add(glows.mesh);
      parts.push(glows);
    }
  }

  const skids = createSkidMarks(scene, { max: qualityName === 'low' ? 600 : 1400 });
  parts.push(skids);
  lap('extras');

  if (typeof mats.texturesReady === 'function') {
    try { await Promise.race([mats.texturesReady(), new Promise(function (r) { setTimeout(r, 3500); })]); } catch (_) {}
  }
  onProgress(1);
  const buildMs = Math.round(worldNow() - t0);
  let elapsed = 0;

  function update(camera, dt) {
    elapsed += dt;
    try { env.update(camera, dt); } catch (_) {}
    if (terrain.update) {
      try { terrain.update(camera, dt); } catch (_) {}
    }
    for (let i = 0; i < builders.length; i++) {
      const b = builders[i];
      if (b && typeof b.update === 'function') {
        try { b.update(camera, dt, elapsed); } catch (_) {}
      }
    }
  }

  function dispose() {
    for (let i = 0; i < builders.length; i++) {
      const b = builders[i];
      if (b && typeof b.dispose === 'function') {
        try { b.dispose(); } catch (_) {}
      }
    }
    builders.length = 0;
    for (let i = 0; i < parts.length; i++) {
      try { parts[i].dispose(); } catch (_) {}
    }
    parts.length = 0;
    try { trackMeshes.dispose(); } catch (_) {}
    try { scene.remove(terrain.mesh); terrain.dispose(); } catch (_) {}
    try { env.dispose(); } catch (_) {}
  }

  return {
    def,
    track,
    env,
    terrain,
    heightfield,
    trackMeshes,
    skids,
    night,
    biome,
    builders,
    buildMs,
    timings,
    update,
    dispose
  };
}

