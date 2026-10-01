import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { mulberry32, clamp, lerp, smoothstep, createNoise2D, fbm2D } from './math.js';

const FX_QUALITY_DEFAULTS = {
  low: { pixelRatio: 1, shadows: false, shadowMapSize: 1024, bloom: false, fxaa: false, drawDistance: 700, vegetation: 0.4, particles: 0.5, terrainRes: 0.5 },
  medium: { pixelRatio: 1.5, shadows: true, shadowMapSize: 1024, bloom: true, fxaa: true, drawDistance: 1100, vegetation: 0.7, particles: 0.75, terrainRes: 0.75 },
  high: { pixelRatio: 2, shadows: true, shadowMapSize: 2048, bloom: true, fxaa: true, drawDistance: 1800, vegetation: 1, particles: 1, terrainRes: 1 },
};

function resolveFxQuality(q) {
  if (q && typeof q === 'object') {
    const named = FX_QUALITY_DEFAULTS[q.name] ? q.name : 'medium';
    return { ...FX_QUALITY_DEFAULTS[named], ...q, name: q.name || named };
  }
  const name = FX_QUALITY_DEFAULTS[q] ? q : 'medium';
  return { ...FX_QUALITY_DEFAULTS[name], name };
}

function particleMultiplier(quality) {
  const v = Number(quality.particles);
  return clamp(Number.isFinite(v) ? v : 1, 0, 2);
}

const SHAPE_DOT = 0;
const SHAPE_STREAK = 1;
const SHAPE_PUFF = 2;
const SHAPE_CONFETTI = 3;

const CONFETTI_PALETTE = [
  [0.43, 0.95, 0.77], [1.0, 0.32, 0.55], [1.0, 0.84, 0.2], [0.25, 0.55, 1.0],
  [1.0, 0.55, 0.16], [0.95, 0.95, 0.95], [0.62, 0.38, 1.0], [0.2, 0.85, 0.35],
];

const PARTICLE_KINDS = {
  spark: { pool: 'add', shape: SHAPE_STREAK, life: [0.32, 0.8], speed: 13, speedVar: 0.65, spread: 0.38, gravity: -9.8, buoyancy: 0, drag: 1.1, size: [0.05, 0.085], grow: [1, 0.55], stretch: 0.055, bounce: 0.38, spin: 0, rate: 40 },
  flame: { pool: 'add', shape: SHAPE_PUFF, life: [0.32, 0.62], speed: 2.4, speedVar: 0.5, spread: 0.3, gravity: 0, buoyancy: 4.5, drag: 2.6, size: [0.32, 0.5], grow: [0.55, 1.5], stretch: 0, bounce: -1, spin: 2.2, rate: 70 },
  smoke: { pool: 'alpha', shape: SHAPE_PUFF, life: [2.4, 4.4], speed: 1.6, speedVar: 0.6, spread: 0.55, gravity: 0, buoyancy: 1.1, drag: 1.25, size: [0.55, 0.9], grow: [0.7, 3.6], stretch: 0, bounce: -1, spin: 0.45, rate: 28 },
  dust: { pool: 'alpha', shape: SHAPE_PUFF, life: [1.1, 2.3], speed: 3.2, speedVar: 0.6, spread: 0.9, gravity: -0.35, buoyancy: 0, drag: 2.4, size: [0.45, 0.75], grow: [0.6, 2.6], stretch: 0, bounce: -1, spin: 0.35, rate: 26 },
  confetti: { pool: 'alpha', shape: SHAPE_CONFETTI, life: [3.6, 6.2], speed: 7.5, speedVar: 0.55, spread: 0.32, gravity: -2.6, buoyancy: 0, drag: 2.1, size: [0.075, 0.12], grow: [1, 1], stretch: 0, bounce: 0, spin: 3.5, rate: 40 },
  debris: { pool: 'debris', life: [2.6, 4.2], speed: 7, speedVar: 0.6, spread: 0.5, gravity: -9.8, buoyancy: 0, drag: 0.25, size: [0.05, 0.2], bounce: 0.34, spin: 9, rate: 16 },
};

const KIND_INDEX = { spark: 0, flame: 1, smoke: 2, dust: 3, confetti: 4, debris: 5 };
const KIND_LIST = ['spark', 'flame', 'smoke', 'dust', 'confetti', 'debris'];

const STRIDE = 24;
const F_PX = 0, F_PY = 1, F_PZ = 2, F_VX = 3, F_VY = 4, F_VZ = 5, F_AGE = 6, F_LIFE = 7;
const F_S0 = 8, F_S1 = 9, F_ROT = 10, F_ROTV = 11, F_KIND = 12, F_SEED = 13, F_R = 14, F_G = 15, F_B = 16;
const F_GY = 17, F_OPA = 18, F_VAR = 19, F_AX = 20, F_AY = 21, F_AZ = 22, F_REST = 23;

function makePuffAtlas() {
  const size = 256;
  const cell = size / 2;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const noise = createNoise2D(7331);
  for (let v = 0; v < 4; v++) {
    const ox = (v % 2) * cell;
    const oy = Math.floor(v / 2) * cell;
    for (let y = 0; y < cell; y++) {
      for (let x = 0; x < cell; x++) {
        const u = (x + 0.5) / cell * 2 - 1;
        const w = (y + 0.5) / cell * 2 - 1;
        const r = Math.sqrt(u * u + w * w);
        const base = clamp(1 - r * r, 0, 1);
        const n = fbm2D(noise, u * 1.9 + v * 17.3, w * 1.9 - v * 9.1, 5, 2.1, 0.55);
        const lumps = fbm2D(noise, u * 0.9 + v * 5.7 + 40, w * 0.9 + 11, 3);
        const density = base * (0.62 + 0.38 * lumps) + n * 0.42 * base;
        const a = smoothstep(0.04, 0.62, density) * smoothstep(1.0, 0.72, r);
        const shade = clamp(0.78 + 0.22 * (n * 0.5 + 0.5) + (w * -0.12), 0, 1);
        const i = ((oy + y) * size + ox + x) * 4;
        d[i] = 255 * shade;
        d[i + 1] = 255 * shade;
        d[i + 2] = 255 * shade;
        d[i + 3] = 255 * a;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

const BILLBOARD_VERTEX = `
attribute vec4 iPosSize;
attribute vec4 iVelRot;
attribute vec4 iColor;
attribute vec4 iParams;
varying vec2 vUv;
varying vec4 vColor;
varying vec4 vParams;
varying float vNearFade;
#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
void main() {
  vec4 mvCenter = modelViewMatrix * vec4(iPosSize.xyz, 1.0);
  float size = iPosSize.w;
  vec2 corner = position.xy;
  vec2 offset;
  if (iParams.x > 0.5 && iParams.x < 1.5) {
    vec3 velView = (viewMatrix * vec4(iVelRot.xyz, 0.0)).xyz;
    float len2 = length(velView.xy);
    vec2 dir2 = len2 > 1e-4 ? velView.xy / len2 : vec2(0.0, 1.0);
    vec2 side = vec2(dir2.y, -dir2.x);
    float streak = size * 1.6 + len2 * iParams.y;
    offset = dir2 * (corner.y - 0.35) * streak + side * corner.x * size * 0.6;
  } else {
    float c = cos(iVelRot.w);
    float s = sin(iVelRot.w);
    vec2 cr = vec2(corner.x * iParams.z, corner.y);
    offset = vec2(c * cr.x - s * cr.y, s * cr.x + c * cr.y) * size;
  }
  vec4 mvPosition = mvCenter + vec4(offset, 0.0, 0.0);
  gl_Position = projectionMatrix * mvPosition;
  vUv = position.xy + 0.5;
  vColor = iColor;
  vParams = iParams;
  vNearFade = smoothstep(0.25, 0.9 + size * 1.2, -mvCenter.z);
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}
`;

const BILLBOARD_FRAGMENT_COMMON = `
uniform sampler2D puffMap;
uniform vec3 uLight;
varying vec2 vUv;
varying vec4 vColor;
varying vec4 vParams;
varying float vNearFade;
#include <common>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
float fxShapeAlpha(out float core) {
  vec2 p = vUv * 2.0 - 1.0;
  float shape = vParams.x;
  core = 0.0;
  if (shape < 0.5) {
    float r2 = dot(p, p);
    core = exp(-r2 * 9.0);
    return clamp(1.0 - r2, 0.0, 1.0) * clamp(1.0 - r2, 0.0, 1.0);
  }
  if (shape < 1.5) {
    float across = 1.0 - p.x * p.x;
    float along = smoothstep(-1.0, -0.1, p.y) * (1.0 - smoothstep(0.55, 1.0, p.y));
    core = across * across * across * along;
    return across * along;
  }
  if (shape < 2.5) {
    float variant = vParams.w;
    vec2 cellUv = vec2(mod(variant, 2.0), floor(variant / 2.0)) * 0.5 + vUv * 0.5;
    vec4 t = texture2D(puffMap, cellUv);
    core = t.a * t.r;
    return t.a;
  }
  vec2 q = abs(p);
  float edge = max(q.x, q.y);
  return 1.0 - smoothstep(0.82, 1.0, edge);
}
`;

const ALPHA_FRAGMENT = BILLBOARD_FRAGMENT_COMMON + `
void main() {
  #include <logdepthbuf_fragment>
  float core;
  float a = fxShapeAlpha(core);
  float lit = vParams.x < 2.5 ? mix(0.82, 1.08, core) : 1.0;
  vec3 light = vParams.x > 2.5 ? max(uLight, vec3(0.42)) : uLight;
  vec3 rgb = vColor.rgb * light * lit;
  float alpha = vColor.a * a * vNearFade;
  if (alpha < 0.003) discard;
  gl_FragColor = vec4(rgb, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

const ADD_FRAGMENT = BILLBOARD_FRAGMENT_COMMON + `
void main() {
  #include <logdepthbuf_fragment>
  float core;
  float a = fxShapeAlpha(core);
  vec3 rgb = vColor.rgb * (0.55 + 1.1 * core);
  float alpha = vColor.a * a * vNearFade;
  if (alpha < 0.003) discard;
  vec3 keep = vec3(1.0);
  #ifdef USE_FOG
  {
    gl_FragColor = vec4(1.0);
    {
      #include <fog_fragment>
    }
    vec3 fogWhite = gl_FragColor.rgb;
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    {
      #include <fog_fragment>
    }
    keep = clamp(fogWhite - gl_FragColor.rgb, 0.0, 1.0);
  }
  #endif
  gl_FragColor = vec4(rgb * keep, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function makeQuadGeometry(capacity) {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const attrs = {};
  for (const name of ['iPosSize', 'iVelRot', 'iColor', 'iParams']) {
    const attr = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    attr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute(name, attr);
    attrs[name] = attr;
  }
  geometry.instanceCount = 0;
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  return { geometry, attrs };
}

function createBillboardPool(capacity, additive, puffMap, lightUniform) {
  const { geometry, attrs } = makeQuadGeometry(capacity);
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { puffMap: { value: null }, uLight: { value: new THREE.Vector3(1, 1, 1) } }]);
  uniforms.puffMap.value = puffMap;
  uniforms.uLight = lightUniform;
  const material = new THREE.ShaderMaterial({
    name: additive ? 'kw-particles-add' : 'kw-particles-alpha',
    uniforms,
    vertexShader: BILLBOARD_VERTEX,
    fragmentShader: additive ? ADD_FRAGMENT : ALPHA_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    fog: true,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = additive ? 12 : 11;
  mesh.name = material.name;
  return { mesh, geometry, material, attrs, data: new Float32Array(capacity * STRIDE), count: 0, capacity, additive };
}

function createDebrisPool(capacity) {
  const base = new THREE.IcosahedronGeometry(1, 0);
  const geometry = base.index ? base.toNonIndexed() : base;
  if (geometry !== base) base.dispose();
  const pos = geometry.getAttribute('position');
  const jitter = mulberry32(99);
  for (let i = 0; i < pos.count; i++) {
    const k = 0.75 + jitter() * 0.5;
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * 0.6, pos.getZ(i) * k);
  }
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0.15, flatShading: true });
  material.name = 'kw-particles-debris';
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, capacity));
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.setColorAt(0, new THREE.Color(1, 1, 1));
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.name = 'kw-particles-debris';
  return { mesh, geometry, material, data: new Float32Array(Math.max(1, capacity) * STRIDE), count: 0, capacity };
}

function toVec(v, out) {
  if (!v) { out.x = 0; out.y = 0; out.z = 0; return out; }
  if (Array.isArray(v)) { out.x = v[0] || 0; out.y = v[1] || 0; out.z = v[2] || 0; return out; }
  out.x = v.x || 0; out.y = v.y || 0; out.z = v.z || 0;
  return out;
}

function toRgb(c, out) {
  if (c == null) return null;
  if (Array.isArray(c)) { out[0] = c[0]; out[1] = c[1]; out[2] = c[2]; return out; }
  if (typeof c === 'number' || typeof c === 'string') {
    const col = new THREE.Color(c);
    out[0] = col.r; out[1] = col.g; out[2] = col.b;
    return out;
  }
  if (c.isColor) { out[0] = c.r; out[1] = c.g; out[2] = c.b; return out; }
  if (c.r != null) { out[0] = c.r; out[1] = c.g; out[2] = c.b; return out; }
  return null;
}

export function createParticles(scene, opts = {}) {
  const quality = resolveFxQuality(opts.quality);
  const mult = particleMultiplier(quality);
  const max = Math.max(64, Math.round((opts.max || 3000) * Math.max(0.25, mult)));
  const heightAt = typeof opts.heightAt === 'function' ? opts.heightAt : null;
  const groundY = Number.isFinite(opts.groundY) ? opts.groundY : 0;
  const rng = mulberry32(opts.seed || 20261001);
  const puffMap = makePuffAtlas();
  const lightUniform = { value: new THREE.Vector3(1, 1, 1) };
  let lightOverride = null;
  let lightTimer = 0;

  const addPool = createBillboardPool(Math.round(max * 0.42), true, puffMap, lightUniform);
  const alphaPool = createBillboardPool(Math.round(max * 0.48), false, puffMap, lightUniform);
  const debrisPool = createDebrisPool(Math.min(400, Math.round(max * 0.1)));
  const group = new THREE.Group();
  group.name = 'kw-particles';
  group.add(alphaPool.mesh, addPool.mesh, debrisPool.mesh);
  scene.add(group);

  const emitters = new Map();
  const tmpPos = { x: 0, y: 0, z: 0 };
  const tmpDir = { x: 0, y: 0, z: 0 };
  const tmpVel = { x: 0, y: 0, z: 0 };
  const tmpRgb = [1, 1, 1];
  const mat4 = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const vecP = new THREE.Vector3();
  const vecS = new THREE.Vector3();
  const axis = new THREE.Vector3();
  const colorTmp = new THREE.Color();
  let clock = 0;
  let frame = 0;

  function groundAt(x, z) {
    return heightAt ? heightAt(x, z) : groundY;
  }

  function poolFor(kind) {
    const k = PARTICLE_KINDS[kind];
    if (k.pool === 'add') return addPool;
    if (k.pool === 'alpha') return alphaPool;
    return debrisPool;
  }

  function randomUnit(out) {
    const u = rng() * 2 - 1;
    const t = rng() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    out.x = s * Math.cos(t); out.y = u; out.z = s * Math.sin(t);
    return out;
  }

  const unitTmp = { x: 0, y: 0, z: 0 };

  function emitOne(kindName, px, py, pz, dir, o, inherit) {
    const kind = PARTICLE_KINDS[kindName];
    const pool = poolFor(kindName);
    if (pool.count >= pool.capacity) return false;
    const i = pool.count++;
    const d = pool.data;
    const b = i * STRIDE;
    const spread = o.spread != null ? o.spread : kind.spread;
    const speed = (o.speed != null ? o.speed : kind.speed) * (1 - kind.speedVar * 0.5 + kind.speedVar * rng());
    randomUnit(unitTmp);
    const dl = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
    let vx, vy, vz;
    if (dl > 1e-6) {
      vx = dir.x / dl + unitTmp.x * spread * 1.6;
      vy = dir.y / dl + unitTmp.y * spread * 1.6;
      vz = dir.z / dl + unitTmp.z * spread * 1.6;
      const l = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;
      vx /= l; vy /= l; vz /= l;
    } else {
      vx = unitTmp.x; vy = unitTmp.y; vz = unitTmp.z;
      if (kindName === 'dust') vy = Math.abs(vy) * 0.25;
      else if (kindName !== 'smoke' && kindName !== 'flame') vy = Math.abs(vy) * 0.8 + 0.2;
    }
    if (kindName === 'dust') vy *= 0.35;
    const lifeMul = o.life != null ? o.life : 1;
    const sizeMul = o.size != null ? o.size : 1;
    const life = lerp(kind.life[0], kind.life[1], rng()) * lifeMul;
    const s = lerp(kind.size[0], kind.size[1], rng()) * sizeMul;
    d[b + F_PX] = px; d[b + F_PY] = py; d[b + F_PZ] = pz;
    d[b + F_VX] = vx * speed + (inherit ? inherit.x : 0);
    d[b + F_VY] = vy * speed + (inherit ? inherit.y : 0);
    d[b + F_VZ] = vz * speed + (inherit ? inherit.z : 0);
    d[b + F_AGE] = 0;
    d[b + F_LIFE] = Math.max(0.05, life);
    d[b + F_S0] = s * (kind.grow ? kind.grow[0] : 1);
    d[b + F_S1] = s * (kind.grow ? kind.grow[1] : 1);
    d[b + F_ROT] = rng() * Math.PI * 2;
    d[b + F_ROTV] = (rng() * 2 - 1) * kind.spin;
    d[b + F_KIND] = KIND_INDEX[kindName];
    d[b + F_SEED] = rng();
    const tint = toRgb(o.color, tmpRgb);
    if (kindName === 'confetti' && !tint) {
      const palette = Array.isArray(o.colors) && o.colors.length ? o.colors : CONFETTI_PALETTE;
      const pick = palette[Math.floor(rng() * palette.length) % palette.length];
      const c = toRgb(pick, [1, 1, 1]) || [1, 1, 1];
      d[b + F_R] = c[0]; d[b + F_G] = c[1]; d[b + F_B] = c[2];
    } else if (kindName === 'debris' && !tint) {
      const tone = rng();
      if (tone < 0.45) { d[b + F_R] = 0.16; d[b + F_G] = 0.16; d[b + F_B] = 0.17; }
      else if (tone < 0.75) { d[b + F_R] = 0.32; d[b + F_G] = 0.22; d[b + F_B] = 0.15; }
      else { d[b + F_R] = 0.45; d[b + F_G] = 0.45; d[b + F_B] = 0.46; }
    } else if (tint) {
      d[b + F_R] = tint[0]; d[b + F_G] = tint[1]; d[b + F_B] = tint[2];
    } else {
      d[b + F_R] = 1; d[b + F_G] = 1; d[b + F_B] = 1;
    }
    d[b + F_GY] = kind.bounce >= 0 ? groundAt(px, pz) : -1e9;
    d[b + F_OPA] = o.opacity != null ? o.opacity : 1;
    d[b + F_VAR] = Math.floor(rng() * 4);
    randomUnit(unitTmp);
    d[b + F_AX] = unitTmp.x; d[b + F_AY] = unitTmp.y; d[b + F_AZ] = unitTmp.z;
    d[b + F_REST] = 0;
    if (kindName === 'debris') {
      d[b + F_ROTV] = (0.4 + rng()) * kind.spin * (rng() < 0.5 ? -1 : 1);
    }
    return true;
  }

  function burst(kind, pos, dir, count = 12, o = {}) {
    if (!PARTICLE_KINDS[kind]) return 0;
    toVec(pos, tmpPos);
    toVec(dir, tmpDir);
    const inherit = o.velocity ? toVec(o.velocity, tmpVel) : null;
    const n = Math.max(1, Math.round(count * mult));
    const jitter = o.radius || 0;
    let made = 0;
    for (let k = 0; k < n; k++) {
      let px = tmpPos.x, py = tmpPos.y, pz = tmpPos.z;
      if (jitter > 0) {
        randomUnit(unitTmp);
        const r = jitter * Math.cbrt(rng());
        px += unitTmp.x * r; py += unitTmp.y * r; pz += unitTmp.z * r;
      }
      if (emitOne(kind, px, py, pz, tmpDir, o, inherit)) made++;
      else break;
    }
    return made;
  }

  function trail(id, pos, o = {}) {
    let e = emitters.get(id);
    toVec(pos, tmpPos);
    if (!e) {
      e = { x: tmpPos.x, y: tmpPos.y, z: tmpPos.z, px: tmpPos.x, py: tmpPos.y, pz: tmpPos.z, accum: 0, touched: clock, opts: o, dir: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 } };
      emitters.set(id, e);
    }
    if (clock - e.touched > 0.3) {
      e.px = tmpPos.x; e.py = tmpPos.y; e.pz = tmpPos.z;
      e.accum = 0;
    }
    e.x = tmpPos.x; e.y = tmpPos.y; e.z = tmpPos.z;
    e.opts = o;
    e.touched = clock;
    return e;
  }

  function endTrail(id) {
    emitters.delete(id);
  }

  function runEmitters(dt) {
    for (const e of emitters.values()) {
      if (clock - e.touched > 0.3) continue;
      const o = e.opts || {};
      const kindName = PARTICLE_KINDS[o.kind] ? o.kind : 'smoke';
      const kind = PARTICLE_KINDS[kindName];
      const dx = e.x - e.px, dy = e.y - e.py, dz = e.z - e.pz;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const rate = (o.rate != null ? o.rate : kind.rate) * mult;
      const perMeter = (o.perMeter != null ? o.perMeter : 0) * mult;
      e.accum += rate * dt + perMeter * dist;
      let n = Math.floor(e.accum);
      e.accum -= n;
      if (n > 64) n = 64;
      const inheritK = o.inherit != null ? o.inherit : 0.15;
      const invDt = dt > 1e-5 ? 1 / dt : 0;
      e.vel.x = dx * invDt * inheritK; e.vel.y = dy * invDt * inheritK; e.vel.z = dz * invDt * inheritK;
      if (o.velocity) {
        toVec(o.velocity, tmpVel);
        e.vel.x += tmpVel.x; e.vel.y += tmpVel.y; e.vel.z += tmpVel.z;
      }
      toVec(o.dir, e.dir);
      const eo = { speed: o.speed != null ? o.speed : kind.speed * 0.35, spread: o.spread != null ? o.spread : Math.max(kind.spread, 0.6), size: o.size, life: o.life, color: o.color, colors: o.colors, opacity: o.opacity };
      for (let k = 0; k < n; k++) {
        const t = (k + rng()) / n;
        if (!emitOne(kindName, e.px + dx * t, e.py + dy * t, e.pz + dz * t, e.dir, eo, e.vel)) break;
      }
      e.px = e.x; e.py = e.y; e.pz = e.z;
    }
  }

  function killAt(pool, i) {
    const last = --pool.count;
    if (i !== last) {
      pool.data.copyWithin(i * STRIDE, last * STRIDE, last * STRIDE + STRIDE);
    }
  }

  function simulatePool(pool, dt) {
    const d = pool.data;
    let i = 0;
    while (i < pool.count) {
      const b = i * STRIDE;
      const age = d[b + F_AGE] + dt;
      if (age >= d[b + F_LIFE]) { killAt(pool, i); continue; }
      d[b + F_AGE] = age;
      const kind = PARTICLE_KINDS[KIND_LIST[d[b + F_KIND]]];
      const dragF = Math.exp(-kind.drag * dt);
      let vx = d[b + F_VX] * dragF;
      let vy = d[b + F_VY] * dragF + (kind.gravity + kind.buoyancy) * dt;
      let vz = d[b + F_VZ] * dragF;
      if (d[b + F_KIND] === 4 && d[b + F_REST] < 0.5) {
        const ph = d[b + F_SEED] * 6.2831;
        vx += Math.sin(age * 3.1 + ph) * 3.2 * dt;
        vz += Math.cos(age * 2.6 + ph * 1.7) * 3.2 * dt;
        if (vy < -1.6) vy = lerp(vy, -1.6, 1 - Math.exp(-6 * dt));
      }
      if (d[b + F_REST] > 0.5) { vx = 0; vy = 0; vz = 0; }
      let px = d[b + F_PX] + vx * dt;
      let py = d[b + F_PY] + vy * dt;
      let pz = d[b + F_PZ] + vz * dt;
      if (kind.bounce >= 0) {
        if (((frame + i) & 7) === 0) d[b + F_GY] = groundAt(px, pz);
        const gy = d[b + F_GY];
        if (py < gy) {
          py = gy;
          if (vy < 0) {
            if (-vy < 1.2 || kind.bounce === 0) {
              vy = 0;
              vx *= 0.5;
              vz *= 0.5;
              if (d[b + F_KIND] === 4 || (Math.abs(vx) + Math.abs(vz) < 0.3)) d[b + F_REST] = 1;
            } else {
              vy = -vy * kind.bounce;
              vx *= 0.62;
              vz *= 0.62;
              d[b + F_ROTV] *= 0.6;
            }
          }
        }
      }
      d[b + F_VX] = vx; d[b + F_VY] = vy; d[b + F_VZ] = vz;
      d[b + F_PX] = px; d[b + F_PY] = py; d[b + F_PZ] = pz;
      if (d[b + F_REST] < 0.5) d[b + F_ROT] += d[b + F_ROTV] * dt;
      i++;
    }
  }

  function writeBillboards(pool) {
    const d = pool.data;
    const ps = pool.attrs.iPosSize.array;
    const vr = pool.attrs.iVelRot.array;
    const cl = pool.attrs.iColor.array;
    const pr = pool.attrs.iParams.array;
    for (let i = 0; i < pool.count; i++) {
      const b = i * STRIDE;
      const o = i * 4;
      const kindIdx = d[b + F_KIND];
      const t = d[b + F_AGE] / d[b + F_LIFE];
      const kind = PARTICLE_KINDS[KIND_LIST[kindIdx]];
      const grow = 1 - (1 - t) * (1 - t);
      const size = lerp(d[b + F_S0], d[b + F_S1], grow);
      ps[o] = d[b + F_PX]; ps[o + 1] = d[b + F_PY]; ps[o + 2] = d[b + F_PZ]; ps[o + 3] = size;
      vr[o] = d[b + F_VX]; vr[o + 1] = d[b + F_VY]; vr[o + 2] = d[b + F_VZ]; vr[o + 3] = d[b + F_ROT];
      let r = d[b + F_R], g = d[b + F_G], bl = d[b + F_B], a = d[b + F_OPA];
      let flip = 1;
      if (kindIdx === 0) {
        const hot = 1 - t;
        r *= lerp(3.4, 7.5, hot); g *= lerp(0.75, 4.4, hot * hot); bl *= lerp(0.12, 1.9, hot * hot * hot);
        a *= 1 - smoothstep(0.55, 1, t);
      } else if (kindIdx === 1) {
        if (t < 0.28) {
          const k = t / 0.28;
          r *= lerp(5.2, 4.2, k); g *= lerp(3.9, 1.7, k); bl *= lerp(1.9, 0.38, k);
        } else {
          const k = (t - 0.28) / 0.72;
          r *= lerp(4.2, 0.9, k); g *= lerp(1.7, 0.16, k); bl *= lerp(0.38, 0.04, k);
        }
        a *= smoothstep(0, 0.07, t) * (1 - smoothstep(0.45, 1, t)) * 0.85;
      } else if (kindIdx === 2) {
        r *= 0.6; g *= 0.6; bl *= 0.62;
        a *= smoothstep(0, 0.1, t) * (1 - smoothstep(0.3, 1, t)) * 0.55;
      } else if (kindIdx === 3) {
        r *= 0.68; g *= 0.57; bl *= 0.42;
        a *= smoothstep(0, 0.06, t) * (1 - smoothstep(0.25, 1, t)) * 0.48;
      } else if (kindIdx === 4) {
        r *= 1.15; g *= 1.15; bl *= 1.15;
        a *= 1 - smoothstep(0.86, 1, t);
        flip = d[b + F_REST] > 0.5 ? 0.9 : Math.cos(d[b + F_AGE] * (7 + d[b + F_SEED] * 7) + d[b + F_SEED] * 9);
        if (Math.abs(flip) < 0.08) flip = flip < 0 ? -0.08 : 0.08;
      }
      cl[o] = r; cl[o + 1] = g; cl[o + 2] = bl; cl[o + 3] = a;
      pr[o] = kind.shape; pr[o + 1] = kind.stretch || 0; pr[o + 2] = flip; pr[o + 3] = d[b + F_VAR];
    }
    for (const name of ['iPosSize', 'iVelRot', 'iColor', 'iParams']) {
      const attr = pool.attrs[name];
      attr.clearUpdateRanges();
      if (pool.count > 0) attr.addUpdateRange(0, pool.count * 4);
      attr.needsUpdate = pool.count > 0;
    }
    pool.geometry.instanceCount = pool.count;
    pool.mesh.visible = pool.count > 0;
  }

  function writeDebris(pool) {
    const d = pool.data;
    const mesh = pool.mesh;
    for (let i = 0; i < pool.count; i++) {
      const b = i * STRIDE;
      const t = d[b + F_AGE] / d[b + F_LIFE];
      const shrink = 1 - smoothstep(0.82, 1, t);
      const s = d[b + F_S0] * shrink;
      axis.set(d[b + F_AX], d[b + F_AY], d[b + F_AZ]);
      quat.setFromAxisAngle(axis, d[b + F_ROT]);
      vecP.set(d[b + F_PX], d[b + F_PY] + s * 0.3, d[b + F_PZ]);
      vecS.set(s, s, s);
      mat4.compose(vecP, quat, vecS);
      mesh.setMatrixAt(i, mat4);
      colorTmp.setRGB(d[b + F_R], d[b + F_G], d[b + F_B]);
      mesh.setColorAt(i, colorTmp);
    }
    mesh.count = pool.count;
    mesh.visible = pool.count > 0;
    if (pool.count > 0) {
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, pool.count * 16);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.clearUpdateRanges();
      mesh.instanceColor.addUpdateRange(0, pool.count * 3);
      mesh.instanceColor.needsUpdate = true;
    }
  }

  function refreshLight() {
    if (lightOverride) {
      lightUniform.value.copy(lightOverride);
      return;
    }
    let r = 0, g = 0, b = 0;
    let found = false;
    let hemiSky = null;
    scene.traverse((o) => {
      if (!o.isLight || !o.visible) return;
      const I = o.intensity;
      if (o.isAmbientLight) {
        r += o.color.r * I; g += o.color.g * I; b += o.color.b * I; found = true;
      } else if (o.isHemisphereLight) {
        r += lerp(o.groundColor.r, o.color.r, 0.62) * I;
        g += lerp(o.groundColor.g, o.color.g, 0.62) * I;
        b += lerp(o.groundColor.b, o.color.b, 0.62) * I;
        hemiSky = o.color;
        found = true;
      } else if (o.isDirectionalLight) {
        r += o.color.r * I * 0.55; g += o.color.g * I * 0.55; b += o.color.b * I * 0.55; found = true;
      }
    });
    if (scene.environment) {
      const k = (scene.environmentIntensity != null ? scene.environmentIntensity : 1) * 0.9;
      const sky = hemiSky || { r: 0.8, g: 0.85, b: 1.0 };
      r += sky.r * k; g += sky.g * k; b += sky.b * k; found = true;
    }
    if (!found) { lightUniform.value.set(1, 1, 1); return; }
    const inv = 1 / Math.PI;
    lightUniform.value.set(clamp(r * inv, 0.03, 2.5), clamp(g * inv, 0.03, 2.5), clamp(b * inv, 0.03, 2.5));
  }

  function update(dt) {
    const step = clamp(Number(dt) || 0, 0, 0.1);
    clock += step;
    frame++;
    lightTimer -= step;
    if (lightTimer <= 0) { refreshLight(); lightTimer = 1; }
    runEmitters(step);
    simulatePool(addPool, step);
    simulatePool(alphaPool, step);
    simulatePool(debrisPool, step);
    writeBillboards(addPool);
    writeBillboards(alphaPool);
    writeDebris(debrisPool);
  }

  function clear() {
    addPool.count = 0;
    alphaPool.count = 0;
    debrisPool.count = 0;
    emitters.clear();
    writeBillboards(addPool);
    writeBillboards(alphaPool);
    writeDebris(debrisPool);
  }

  function setLight(c) {
    if (c == null) { lightOverride = null; refreshLight(); return; }
    const rgb = toRgb(typeof c === 'number' && c <= 4 ? [c, c, c] : c, [1, 1, 1]);
    lightOverride = new THREE.Vector3(rgb[0], rgb[1], rgb[2]);
    lightUniform.value.copy(lightOverride);
  }

  function dispose() {
    scene.remove(group);
    for (const p of [addPool, alphaPool]) { p.geometry.dispose(); p.material.dispose(); }
    debrisPool.geometry.dispose();
    debrisPool.material.dispose();
    debrisPool.mesh.dispose();
    puffMap.dispose();
    emitters.clear();
  }

  writeBillboards(addPool);
  writeBillboards(alphaPool);
  writeDebris(debrisPool);

  return {
    group,
    burst,
    trail,
    endTrail,
    update,
    clear,
    setLight,
    dispose,
    get active() { return addPool.count + alphaPool.count + debrisPool.count; },
    get capacity() { return addPool.capacity + alphaPool.capacity + debrisPool.capacity; },
  };
}

function fxHash1(n, seed) {
  let h = Math.imul(n | 0, 374761393) + Math.imul(seed | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return ((h >>> 0) / 4294967296) * 2 - 1;
}

function fxNoise1(x, seed) {
  const i = Math.floor(x);
  const f = x - i;
  const g0 = fxHash1(i, seed);
  const g1 = fxHash1(i + 1, seed);
  const u = f * f * (3 - 2 * f);
  return lerp(g0 * f, g1 * (f - 1), u) * 2.2;
}

export function createCameraShake(opts = {}) {
  const maxOffset = opts.maxOffset != null ? opts.maxOffset : 0.3;
  const maxAngle = opts.maxAngle != null ? opts.maxAngle : 0.045;
  const frequency = opts.frequency != null ? opts.frequency : 16;
  const decay = opts.decay != null ? opts.decay : 1.5;
  let trauma = 0;
  let time = 0;
  const offset = { x: 0, y: 0, z: 0, pitch: 0, yaw: 0, roll: 0 };

  function add(amount = 0.3) {
    trauma = clamp(trauma + amount, 0, 1);
  }

  function update(dt) {
    const step = clamp(Number(dt) || 0, 0, 0.1);
    time += step;
    trauma = Math.max(0, trauma - decay * step);
    const s = trauma * trauma;
    const t = time * frequency;
    offset.x = maxOffset * s * fxNoise1(t, 11);
    offset.y = maxOffset * s * fxNoise1(t + 31.7, 23);
    offset.z = maxOffset * 0.5 * s * fxNoise1(t + 71.3, 37);
    offset.pitch = maxAngle * s * fxNoise1(t + 13.1, 41);
    offset.yaw = maxAngle * s * fxNoise1(t + 47.9, 53);
    offset.roll = maxAngle * 1.4 * s * fxNoise1(t + 89.2, 67);
    return offset;
  }

  function apply(camera) {
    if (!camera || trauma <= 0) return;
    camera.translateX(offset.x);
    camera.translateY(offset.y);
    camera.translateZ(offset.z);
    camera.rotateX(offset.pitch);
    camera.rotateY(offset.yaw);
    camera.rotateZ(offset.roll);
    camera.updateMatrixWorld();
  }

  function reset() {
    trauma = 0;
    offset.x = offset.y = offset.z = offset.pitch = offset.yaw = offset.roll = 0;
  }

  return {
    add,
    update,
    apply,
    reset,
    offset,
    get trauma() { return trauma; },
    set trauma(v) { trauma = clamp(v, 0, 1); },
    dispose() { reset(); },
  };
}

const FX_POST_PRESETS = {
  day: { strength: 0.11, radius: 0.15, threshold: 2.9, knee: 1.0, adapt: 2.6, saturation: 0.5, vignette: 0.22 },
  golden: { strength: 0.15, radius: 0.2, threshold: 2.5, knee: 0.9, adapt: 2.4, saturation: 0.55, vignette: 0.28 },
  sunset: { strength: 0.22, radius: 0.35, threshold: 1.7, knee: 0.7, adapt: 2.1, saturation: 0.65, vignette: 0.3 },
  night: { strength: 0.6, radius: 0.55, threshold: 0.8, knee: 0.45, adapt: 2.2, saturation: 0.9, vignette: 0.34 },
};

const SOFT_HIGHPASS_FRAGMENT = `
uniform sampler2D tDiffuse;
uniform sampler2D tAverage;
uniform vec3 defaultColor;
uniform float defaultOpacity;
uniform float luminosityThreshold;
uniform float smoothWidth;
uniform float adaptK;
uniform float satWeight;
varying vec2 vUv;
void main() {
  vec3 c = min(texture2D(tDiffuse, vUv).rgb, vec3(12.0));
  float avg = textureLod(tAverage, vec2(0.5), 12.0).r;
  float threshold = max(luminosityThreshold, avg * adaptK);
  float l = max(dot(c, vec3(0.2126, 0.7152, 0.0722)), max(max(c.r, c.g), c.b) * satWeight);
  float knee = max(smoothWidth, 1e-4);
  float over = max(l - threshold + knee * 0.25, 0.0);
  float contrib = clamp(over * over / max(l * (threshold + knee), 1e-4), 0.0, 1.0);
  gl_FragColor = vec4(c * contrib, 1.0);
}
`;

class FxLuminancePass extends Pass {
  constructor() {
    super();
    this.needsSwap = false;
    this.target = new THREE.WebGLRenderTarget(64, 32, {
      type: THREE.HalfFloatType,
      depthBuffer: false,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.target.texture.name = 'kw-post-luminance';
    this.material = new THREE.ShaderMaterial({
      name: 'kw-post-luminance',
      uniforms: { tDiffuse: { value: null } },
      vertexShader: 'varying vec2 vUv;\nvoid main() {\n  vUv = uv;\n  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);\n}\n',
      fragmentShader: 'uniform sampler2D tDiffuse;\nvarying vec2 vUv;\nvoid main() {\n  vec3 c = min(texture2D(tDiffuse, vUv).rgb, vec3(30.0));\n  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));\n  gl_FragColor = vec4(l, l, l, 1.0);\n}\n',
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
  }

  render(renderer, writeBuffer, readBuffer) {
    this.material.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.target);
    this.quad.render(renderer);
  }

  dispose() {
    this.target.dispose();
    this.material.dispose();
    this.quad.dispose();
  }
}

const FINISH_UNIFORMS_GLSL = `
uniform sampler2D tDiffuse;
uniform vec2 resolution;
uniform float uSpeed;
uniform float uVignette;
uniform float uTime;
uniform float uAspect;
varying vec2 vUv;
`;

const SPEED_FUNCS_GLSL = `
float fxHash11(float n) {
  return fract(sin(n * 127.1 + 11.7) * 43758.5453);
}
float fxSpeedLines(vec2 c, float speed, float time, float aspect) {
  vec2 pc = c * vec2(aspect, 1.0);
  float r = length(pc);
  float ang = atan(pc.y, pc.x);
  float cells = 180.0;
  float a = (ang / 6.2831853 + 0.5) * cells;
  float cell = floor(a);
  float h = fxHash11(cell);
  float h2 = fxHash11(cell + 17.3);
  float h3 = fxHash11(cell + 41.9);
  float present = step(h, 0.06 + 0.4 * speed);
  float across = abs(fract(a) - 0.5) * 2.0;
  float width = (0.07 + 0.1 * h2) * (0.45 + 0.7 * r);
  float line = 1.0 - smoothstep(width * 0.3, width, across);
  float travel = fract(r * (0.55 + h3 * 0.8) - time * (1.1 + 1.6 * h2) * (0.8 + speed) + h * 3.7);
  float dash = smoothstep(0.0, 0.03, travel) * (1.0 - smoothstep(0.1, 0.38, travel));
  float mask = smoothstep(0.45, 1.05, r);
  return line * dash * present * mask * (0.5 + 0.5 * h3);
}
float fxVignette(vec2 c, float aspect, float amount, float speed) {
  vec2 pc = c * vec2(mix(1.0, aspect, 0.55), 1.0);
  float r = length(pc) * (1.0 + speed * 0.18);
  float v = smoothstep(0.98, 0.32, r);
  return mix(1.0 - amount, 1.0, v);
}
`;

const FINISH_MAIN_GLSL = `
vec3 fxSampleBase(vec2 uv) {
#ifdef USE_FXAA
  return ApplyFXAA(tDiffuse, resolution, uv).rgb;
#else
  return texture2D(tDiffuse, uv).rgb;
#endif
}
void main() {
  vec2 uv = vUv;
  vec2 c = uv - 0.5;
  vec3 col = fxSampleBase(uv);
  if (uSpeed > 0.002) {
    float edgeR = length(c * vec2(uAspect, 1.0));
    float edge = smoothstep(0.2, 0.85, edgeR);
    float blur = uSpeed * uSpeed * 0.06 * edge;
    if (blur > 0.0005) {
      vec3 acc = col;
      float wsum = 1.0;
      for (int i = 1; i <= 7; i++) {
        float k = float(i) / 7.0;
        float w = 1.0 - k * 0.6;
        acc += texture2D(tDiffuse, uv - c * blur * k).rgb * w;
        wsum += w;
      }
      col = acc / wsum;
    }
    float ca = smoothstep(0.55, 1.0, uSpeed) * 0.0032 * edge;
    if (ca > 0.0001) {
      col.r = mix(col.r, texture2D(tDiffuse, uv + c * ca).r, 0.85);
      col.b = mix(col.b, texture2D(tDiffuse, uv - c * ca).b, 0.85);
    }
    float lines = fxSpeedLines(c, uSpeed, uTime, uAspect);
    col += vec3(0.92, 0.98, 1.0) * lines * uSpeed * uSpeed * 0.5;
  }
  col *= fxVignette(c, uAspect, uVignette, uSpeed);
  gl_FragColor = vec4(col, 1.0);
}
`;

const OVERLAY_VERTEX = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const OVERLAY_FRAGMENT = `
uniform float uSpeed;
uniform float uVignette;
uniform float uTime;
uniform float uAspect;
varying vec2 vUv;
` + SPEED_FUNCS_GLSL + `
void main() {
  vec2 c = vUv - 0.5;
  float keep = fxVignette(c, uAspect, uVignette, uSpeed);
  float lines = uSpeed > 0.002 ? fxSpeedLines(c, uSpeed, uTime, uAspect) * uSpeed * uSpeed * 0.5 : 0.0;
  float dark = 1.0 - keep;
  gl_FragColor = vec4(vec3(0.92, 0.98, 1.0) * lines * keep, dark);
}
`;

function fxaaFunctions() {
  const src = FXAAShader.fragmentShader || '';
  const at = src.lastIndexOf('void main()');
  if (at < 0) return null;
  const head = src.slice(0, at);
  return head
    .replace(/uniform\s+sampler2D\s+tDiffuse\s*;/, '')
    .replace(/uniform\s+vec2\s+resolution\s*;/, '')
    .replace(/varying\s+vec2\s+vUv\s*;/, '');
}

function makeFinishShader(useFxaa) {
  const fxaa = useFxaa ? fxaaFunctions() : null;
  const defines = fxaa ? { USE_FXAA: '' } : {};
  return {
    name: 'KwFinishShader',
    defines,
    uniforms: {
      tDiffuse: { value: null },
      resolution: { value: new THREE.Vector2(1 / 1024, 1 / 512) },
      uSpeed: { value: 0 },
      uVignette: { value: 0.25 },
      uTime: { value: 0 },
      uAspect: { value: 16 / 9 },
    },
    vertexShader: `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`,
    fragmentShader: FINISH_UNIFORMS_GLSL + (fxaa || '') + SPEED_FUNCS_GLSL + FINISH_MAIN_GLSL,
  };
}

export function createPostFx(renderer, scene, camera, opts = {}) {
  let quality = resolveFxQuality(opts.quality);
  let presetName = FX_POST_PRESETS[opts.preset] ? opts.preset : 'day';
  let currentCamera = camera;
  let speed = 0;
  let speedTarget = 0;
  let vignette = FX_POST_PRESETS[presetName].vignette;
  let vignetteOverride = null;
  let bloomOverride = null;
  const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const sizeTmp = new THREE.Vector2();
  let lastW = 0, lastH = 0, lastPr = 0;

  let composer = null;
  let renderPass = null;
  let luminancePass = null;
  let bloomPass = null;
  let outputPass = null;
  let finishPass = null;

  const overlayUniforms = {
    uSpeed: { value: 0 },
    uVignette: { value: vignette },
    uTime: { value: 0 },
    uAspect: { value: 16 / 9 },
  };
  const overlayMaterial = new THREE.ShaderMaterial({
    name: 'kw-post-overlay',
    uniforms: overlayUniforms,
    vertexShader: OVERLAY_VERTEX,
    fragmentShader: OVERLAY_FRAGMENT,
    transparent: true,
    premultipliedAlpha: true,
    blending: THREE.NormalBlending,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const overlayGeometry = new THREE.BufferGeometry();
  overlayGeometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
  overlayGeometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));
  const overlayMesh = new THREE.Mesh(overlayGeometry, overlayMaterial);
  overlayMesh.frustumCulled = false;
  const overlayScene = new THREE.Scene();
  overlayScene.add(overlayMesh);
  const overlayCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  function now() {
    return ((typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime) / 1000;
  }

  function bloomParams() {
    const p = FX_POST_PRESETS[presetName];
    const pick = (k) => (bloomOverride && bloomOverride[k] != null ? bloomOverride[k] : p[k]);
    return { strength: pick('strength'), radius: pick('radius'), threshold: pick('threshold'), knee: pick('knee'), adapt: pick('adapt'), saturation: pick('saturation') };
  }

  function applyBloom() {
    if (!bloomPass) return;
    const b = bloomParams();
    const exposure = Math.max(0.05, renderer.toneMappingExposure || 1);
    bloomPass.strength = b.strength;
    bloomPass.radius = b.radius;
    bloomPass.threshold = b.threshold / exposure;
    bloomPass.highPassUniforms.smoothWidth.value = b.knee / exposure;
    if (bloomPass.highPassUniforms.adaptK) bloomPass.highPassUniforms.adaptK.value = b.adapt;
    if (bloomPass.highPassUniforms.satWeight) bloomPass.highPassUniforms.satWeight.value = b.saturation;
  }

  function currentVignette() {
    return vignetteOverride != null ? vignetteOverride : FX_POST_PRESETS[presetName].vignette;
  }

  function build() {
    teardown();
    vignette = currentVignette();
    const usePost = !!(quality.bloom || quality.fxaa);
    renderer.getSize(sizeTmp);
    const pr = renderer.getPixelRatio();
    lastW = sizeTmp.x; lastH = sizeTmp.y; lastPr = pr;
    if (!usePost) return;
    const w = Math.max(1, Math.round(sizeTmp.x * pr));
    const h = Math.max(1, Math.round(sizeTmp.y * pr));
    const target = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: quality.msaa ? 4 : 0 });
    target.texture.name = 'kw-post-main';
    composer = new EffectComposer(renderer, target);
    composer.setPixelRatio(pr);
    composer.setSize(sizeTmp.x, sizeTmp.y);
    renderPass = new RenderPass(scene, currentCamera);
    composer.addPass(renderPass);
    if (quality.bloom) {
      const b = bloomParams();
      bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), b.strength, b.radius, b.threshold);
      const scale = quality.name === 'high' ? 1 : 0.75;
      if (scale !== 1) {
        const originalSetSize = bloomPass.setSize.bind(bloomPass);
        bloomPass.setSize = (sw, sh) => originalSetSize(Math.max(2, Math.round(sw * scale)), Math.max(2, Math.round(sh * scale)));
        bloomPass.setSize(w, h);
      }
      luminancePass = new FxLuminancePass();
      composer.addPass(luminancePass);
      bloomPass.highPassUniforms.tAverage = { value: luminancePass.target.texture };
      bloomPass.highPassUniforms.adaptK = { value: b.adapt };
      bloomPass.highPassUniforms.satWeight = { value: b.saturation };
      bloomPass.materialHighPassFilter.fragmentShader = SOFT_HIGHPASS_FRAGMENT;
      bloomPass.materialHighPassFilter.needsUpdate = true;
      const originalBloomRender = bloomPass.render.bind(bloomPass);
      bloomPass.render = (r, writeBuffer, readBuffer, deltaTime, maskActive) => {
        applyBloom();
        originalBloomRender(r, writeBuffer, readBuffer, deltaTime, maskActive);
      };
      composer.addPass(bloomPass);
      applyBloom();
    }
    outputPass = new OutputPass();
    composer.addPass(outputPass);
    finishPass = new ShaderPass(makeFinishShader(!!quality.fxaa));
    finishPass.material.name = 'kw-post-finish';
    finishPass.setSize = (fw, fh) => {
      finishPass.uniforms.resolution.value.set(1 / Math.max(1, fw), 1 / Math.max(1, fh));
      finishPass.uniforms.uAspect.value = fw / Math.max(1, fh);
    };
    const originalRender = finishPass.render.bind(finishPass);
    finishPass.render = (r, writeBuffer, readBuffer, deltaTime, maskActive) => {
      finishPass.uniforms.uTime.value = now();
      finishPass.uniforms.uSpeed.value = speed;
      finishPass.uniforms.uVignette.value = vignette;
      originalRender(r, writeBuffer, readBuffer, deltaTime, maskActive);
    };
    composer.addPass(finishPass);
  }

  function teardown() {
    if (composer) {
      for (const p of composer.passes) if (p.dispose) p.dispose();
      composer.dispose();
    }
    composer = null;
    renderPass = null;
    luminancePass = null;
    bloomPass = null;
    outputPass = null;
    finishPass = null;
  }

  function syncSize() {
    renderer.getSize(sizeTmp);
    const pr = renderer.getPixelRatio();
    if (sizeTmp.x === lastW && sizeTmp.y === lastH && pr === lastPr) return;
    lastW = sizeTmp.x; lastH = sizeTmp.y; lastPr = pr;
    if (composer) {
      composer.setPixelRatio(pr);
      composer.setSize(sizeTmp.x, sizeTmp.y);
    }
  }

  function setSize(w, h) {
    if (composer) composer.setSize(w, h);
    lastW = w; lastH = h;
  }

  function setPixelRatio(pr) {
    if (composer) composer.setPixelRatio(pr);
    lastPr = pr;
  }

  function stepSpeed(dt) {
    const k = 1 - Math.exp(-(speedTarget > speed ? 6 : 3.5) * clamp(dt, 0, 0.1));
    speed = lerp(speed, speedTarget, k);
    if (Math.abs(speed - speedTarget) < 0.002) speed = speedTarget;
  }

  function render(dt) {
    const step = Number.isFinite(dt) ? dt : 1 / 60;
    stepSpeed(step);
    syncSize();
    if (composer) {
      composer.render(step);
      return;
    }
    renderer.render(scene, currentCamera);
    if (vignette <= 0.001 && speed <= 0.002) return;
    overlayUniforms.uSpeed.value = speed;
    overlayUniforms.uVignette.value = vignette;
    overlayUniforms.uTime.value = now();
    overlayUniforms.uAspect.value = lastW / Math.max(1, lastH);
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(overlayScene, overlayCamera);
    renderer.autoClear = auto;
  }

  function setSpeedFx(v, immediate = false) {
    speedTarget = clamp(Number(v) || 0, 0, 1);
    if (immediate) speed = speedTarget;
  }

  function setBloom(b = {}) {
    bloomOverride = { ...(bloomOverride || {}), ...b };
    applyBloom();
  }

  function setVignette(amount) {
    vignetteOverride = amount == null ? null : clamp(Number(amount) || 0, 0, 1);
    vignette = currentVignette();
  }

  function setPreset(name) {
    if (!FX_POST_PRESETS[name]) return;
    presetName = name;
    bloomOverride = null;
    vignette = currentVignette();
    applyBloom();
  }

  function setQuality(q) {
    quality = resolveFxQuality(q);
    build();
  }

  function setCamera(cam) {
    currentCamera = cam;
    if (renderPass) renderPass.camera = cam;
  }

  function dispose() {
    teardown();
    overlayGeometry.dispose();
    overlayMaterial.dispose();
  }

  build();

  return {
    get composer() { return composer; },
    get bloomPass() { return bloomPass; },
    get quality() { return quality; },
    get preset() { return presetName; },
    get speedFx() { return speed; },
    render,
    setSize,
    setPixelRatio,
    setCamera,
    setSpeedFx,
    setBloom,
    setVignette,
    setPreset,
    setQuality,
    dispose,
  };
}
