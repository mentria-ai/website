import * as THREE from 'three';
import { clamp } from './math.js';
import { loadTexture, NO_TILE_GLSL } from './materials.js';

const TERRAIN_QUALITY = {
  low: { name: 'low', shadows: false, terrainRes: 0.5, noTile: false, farBlend: false, castShadow: false },
  medium: { name: 'medium', shadows: true, terrainRes: 0.75, noTile: true, farBlend: false, castShadow: false },
  high: { name: 'high', shadows: true, terrainRes: 1, noTile: true, farBlend: true, castShadow: true },
};

function resolveTerrainQuality(q) {
  if (typeof q === 'string') return { ...(TERRAIN_QUALITY[q] || TERRAIN_QUALITY.medium) };
  if (q && typeof q === 'object') {
    const base = TERRAIN_QUALITY[q.name] || TERRAIN_QUALITY.medium;
    return { ...base, ...q, noTile: q.noTile ?? base.noTile, farBlend: q.farBlend ?? base.farBlend, castShadow: q.castShadow ?? base.castShadow };
  }
  return { ...TERRAIN_QUALITY.medium };
}

export const TERRAIN_BIOMES = {
  meadow: {
    layers: {
      grass: { tex: 'grass', tint: [1.0, 1.0, 0.92], fileTint: [0.78, 0.8, 0.6], fileSat: 0.62, scale: 7 },
      dirt: { tex: 'dirt', tint: [1, 1, 1], scale: 6 },
      rock: { tex: 'rock', tint: [1.0, 0.98, 0.95], scale: 11 },
      sand: { tex: 'sand', tint: [0.95, 0.92, 0.85], scale: 8 },
    },
    rockSlope: 0.3, dirtAmount: 0.32, sandTop: -1000, snowLine: 1e9, macro: 0.32, macroTint: [0.92, 1.06, 0.78],
  },
  desert: {
    layers: {
      grass: { tex: 'sand', tint: [1.04, 0.86, 0.68], fileTint: [0.98, 0.86, 0.74], scale: 9 },
      dirt: { tex: 'dirt', tint: [1.12, 0.84, 0.64], fileTint: [1.08, 0.86, 0.7], scale: 6 },
      rock: { tex: 'sandstone', procedural: 'rock', tint: [1.22, 0.8, 0.6], fileTint: [0.9, 0.84, 0.84], fileSat: 0.82, scale: 9 },
      sand: { tex: 'sand', tint: [1.1, 0.94, 0.76], fileTint: [1.0, 0.92, 0.82], scale: 7 },
    },
    rockSlope: 0.22, dirtAmount: 0.4, sandTop: 6, snowLine: 1e9, macro: 0.26, macroTint: [1.08, 0.92, 0.8], strata: 1, rockAbove: 5.5,
  },
  coast: {
    layers: {
      grass: { tex: 'grass', tint: [0.98, 1.02, 0.86], fileTint: [0.8, 0.82, 0.62], fileSat: 0.62, scale: 7 },
      dirt: { tex: 'dirt', tint: [1, 0.96, 0.92], scale: 6 },
      rock: { tex: 'rock', tint: [0.92, 0.92, 0.9], scale: 10 },
      sand: { tex: 'sand', tint: [1.02, 0.98, 0.9], scale: 7 },
    },
    rockSlope: 0.26, dirtAmount: 0.25, sandTop: 2.2, snowLine: 1e9, macro: 0.28, macroTint: [0.94, 1.04, 0.82],
  },
  urban: {
    layers: {
      grass: { tex: 'asphalt', tint: [1.05, 1.05, 1.05], scale: 8 },
      dirt: { tex: 'concrete', tint: [0.82, 0.82, 0.8], scale: 9 },
      rock: { tex: 'rock', tint: [0.9, 0.9, 0.9], scale: 9 },
      sand: { tex: 'dirt', tint: [0.8, 0.78, 0.76], scale: 6 },
    },
    rockSlope: 0.3, dirtAmount: 0.3, sandTop: -1000, snowLine: 1e9, macro: 0.18, macroTint: [0.96, 0.96, 0.94],
  },
  park: {
    layers: {
      grass: { tex: 'grass', tint: [0.9, 0.95, 0.82], fileTint: [0.78, 0.82, 0.62], fileSat: 0.7, scale: 6 },
      dirt: { tex: 'dirt', tint: [0.9, 0.88, 0.86], scale: 5 },
      rock: { tex: 'concrete', tint: [0.9, 0.9, 0.9], scale: 8 },
      sand: { tex: 'dirt', tint: [0.8, 0.78, 0.76], scale: 6 },
    },
    rockSlope: 0.3, dirtAmount: 0.55, sandTop: -1000, snowLine: 1e9, macro: 0.2, macroTint: [0.95, 0.97, 0.9],
  },
  alpine: {
    layers: {
      grass: { tex: 'grass', tint: [0.92, 1.0, 0.86], fileTint: [0.74, 0.8, 0.62], fileSat: 0.6, scale: 7 },
      dirt: { tex: 'forest-floor', tint: [1, 1, 1], scale: 5 },
      rock: { tex: 'rock', tint: [0.95, 0.96, 1.0], scale: 12 },
      sand: { tex: 'sand', tint: [0.9, 0.88, 0.84], scale: 8 },
    },
    rockSlope: 0.26, dirtAmount: 0.3, sandTop: -1000, snowLine: 1e9, macro: 0.3, macroTint: [0.9, 1.05, 0.85],
  },
};

const TERRAIN_SPLAT_GLSL = `
uniform sampler2D kwGrassMap;
uniform sampler2D kwDirtMap;
uniform sampler2D kwRockMap;
uniform sampler2D kwSandMap;
uniform vec3 kwGrassTint;
uniform vec3 kwDirtTint;
uniform vec3 kwRockTint;
uniform vec3 kwSandTint;
uniform vec4 kwScales;
uniform vec4 kwSplat;
uniform vec4 kwMacro;
uniform vec3 kwMacroTint;
uniform vec4 kwLayerSat;
uniform vec4 kwCloudShadow;
uniform vec3 kwCloudWind;
uniform sampler2D kwShapeTex;
uniform vec3 kwShapeGrid;
varying vec3 vKwWorld;
${NO_TILE_GLSL}
vec4 kwSampleLayer(sampler2D s, vec2 uv, float dist) {
#ifdef KW_NO_TILE
  vec4 c = textureNoTile(s, uv);
#else
  vec4 c = texture2D(s, uv);
#endif
#ifdef KW_FAR_BLEND
  float far = smoothstep(40.0, 260.0, dist);
  if (far > 0.0) {
    vec4 cf = texture2D(s, uv * 0.137 + 0.31);
    c = mix(c, mix(c, cf, 0.5), far);
  }
#endif
  return c;
}
vec3 kwPerturbNormal(vec3 surfPos, vec3 surfNorm, vec2 dHdxy) {
  vec3 sigX = dFdx(surfPos);
  vec3 sigY = dFdy(surfPos);
  vec3 r1 = cross(sigY, surfNorm);
  vec3 r2 = cross(surfNorm, sigX);
  float det = dot(sigX, r1);
  vec3 grad = sign(det) * (dHdxy.x * r1 + dHdxy.y * r2);
  return normalize(abs(det) * surfNorm - grad);
}
float kwFbmTerrain(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * kwValueNoise(p);
    p = p * 2.03 + 17.1;
    a *= 0.5;
  }
  return v;
}
`;

const TERRAIN_SPLAT_MAIN = `
  vec3 kwW = vKwWorld;
  vec4 kwShape = texture2D(kwShapeTex, ((kwW.xz + kwShapeGrid.x) / kwShapeGrid.y + 0.5) / kwShapeGrid.z);
  vec3 kwN = normalize(kwShape.xyz * 2.0 - 1.0);
  float kwDist = length(kwW - cameraPosition);
  float kwSlope = 1.0 - kwN.y;
  float kwN1 = kwFbmTerrain(kwW.xz * 0.012);
  float kwN2 = kwValueNoise(kwW.xz * 0.09);
  float kwN3 = kwFbmTerrain(kwW.xz * 0.0035 + 41.0);
  float kwN4 = kwValueNoise(kwW.xz * 0.37 + 7.3);
  float kwRockW = smoothstep(kwSplat.x - 0.1, kwSplat.x + 0.1, kwSlope + (kwN2 - 0.5) * 0.16 + (kwN1 - 0.5) * 0.12 + (kwN4 - 0.5) * 0.07);
  if (kwMacro.w > 0.0) kwRockW = max(kwRockW, smoothstep(kwMacro.w - 0.8, kwMacro.w + 1.6, kwW.y + (kwN2 - 0.5) * 3.0 + (kwN4 - 0.5) * 1.2));
  float kwSandW = 1.0 - smoothstep(kwSplat.z - 1.2, kwSplat.z + 1.4, kwW.y + (kwN2 - 0.5) * 2.4);
  float kwDirtW = smoothstep(1.0 - kwSplat.y, 1.0 - kwSplat.y + 0.16, kwN1 * 0.75 + kwN2 * 0.35 + kwSlope * 0.7);
  kwDirtW = max(kwDirtW, smoothstep(0.12, 0.24, kwSlope) * 0.65);
  vec4 kwWeights = vec4(1.0, kwDirtW, 0.0, 0.0);
  kwWeights.x = (1.0 - kwDirtW);
  kwWeights *= (1.0 - kwSandW);
  kwWeights.w = kwSandW;
  kwWeights.xyw *= (1.0 - kwRockW);
  kwWeights.z = kwRockW;
  vec3 kwCol = vec3(0.0);
  float kwRough = 0.0;
  if (kwWeights.x > 0.004) {
    vec3 kwG = kwSampleLayer(kwGrassMap, kwW.xz / kwScales.x, kwDist).rgb;
    kwG = mix(vec3(dot(kwG, vec3(0.2126, 0.7152, 0.0722))), kwG, kwLayerSat.x);
    kwCol += kwG * kwGrassTint * kwWeights.x;
    kwRough += 0.96 * kwWeights.x;
  }
  if (kwWeights.y > 0.004) {
    vec3 kwD = kwSampleLayer(kwDirtMap, kwW.xz / kwScales.y, kwDist).rgb;
    kwD = mix(vec3(dot(kwD, vec3(0.2126, 0.7152, 0.0722))), kwD, kwLayerSat.y);
    kwCol += kwD * kwDirtTint * kwWeights.y;
    kwRough += 0.94 * kwWeights.y;
  }
  if (kwWeights.z > 0.004) {
    vec3 kwBw = pow(abs(kwN), vec3(4.0));
    kwBw /= kwBw.x + kwBw.y + kwBw.z + 1e-4;
    vec3 kwTop = kwSampleLayer(kwRockMap, kwW.xz / kwScales.z, kwDist).rgb;
    vec3 kwR = kwTop * kwBw.y;
    if (kwBw.x > 0.01) kwR += kwSampleLayer(kwRockMap, kwW.zy / kwScales.z * vec2(1.0, 1.6), kwDist).rgb * kwBw.x;
    if (kwBw.z > 0.01) kwR += kwSampleLayer(kwRockMap, kwW.xy / kwScales.z * vec2(1.0, 1.6) + 0.37, kwDist).rgb * kwBw.z;
    if (kwSplat.w > 0.0) {
      float kwStr = kwSplat.w * (1.0 - kwBw.y);
      float kwBand = sin(kwW.y * 1.35 + kwN1 * 5.0 + kwN3 * 9.0) * 0.5 + 0.5;
      float kwFine = sin(kwW.y * 6.1 + kwN2 * 3.0 + kwN4 * 2.0) * 0.5 + 0.5;
      vec3 kwStrata = mix(vec3(0.82, 0.74, 0.72), vec3(1.14, 1.06, 0.98), kwBand) * (1.0 - 0.1 * kwFine);
      kwR *= mix(vec3(1.0), kwStrata, kwStr);
    }
    kwR = mix(vec3(dot(kwR, vec3(0.2126, 0.7152, 0.0722))), kwR, kwLayerSat.z);
    kwCol += kwR * kwRockTint * kwWeights.z;
    kwRough += 0.86 * kwWeights.z;
  }
  if (kwWeights.w > 0.004) {
    vec3 kwS = kwSampleLayer(kwSandMap, kwW.xz / kwScales.w, kwDist).rgb;
    kwS = mix(vec3(dot(kwS, vec3(0.2126, 0.7152, 0.0722))), kwS, kwLayerSat.w);
    kwCol += kwS * kwSandTint * kwWeights.w;
    kwRough += 0.92 * kwWeights.w;
  }
  float kwMacroV = (kwN3 - 0.5) * 2.0;
  vec3 kwMacroCol = mix(vec3(1.0), kwMacroTint, smoothstep(-0.3, 0.8, kwMacroV));
  kwCol *= kwMacroCol * (1.0 + kwMacroV * kwMacro.x * 0.5);
  kwCol *= 1.0 + (kwN2 - 0.5) * kwMacro.y;
  diffuseColor.rgb *= kwCol;
  float kwBumpLum = dot(kwCol, vec3(0.3333)) * kwMacro.z * (1.0 - smoothstep(6.0, 40.0, kwDist));
`;

export function createTerrain(opts = {}) {
  const hf = opts.heightfield;
  if (!hf) throw new Error('createTerrain needs a heightfield');
  const quality = resolveTerrainQuality(opts.quality);
  const size = hf.size;
  const half = size / 2;
  const segments = Math.max(16, Math.round(opts.segments || 256));
  const cell = size / segments;
  const verts = segments + 1;
  const heights = new Float32Array(verts * verts);
  for (let iz = 0; iz < verts; iz++) {
    const z = -half + iz * cell;
    for (let ix = 0; ix < verts; ix++) {
      heights[iz * verts + ix] = hf.heightAt(-half + ix * cell, z);
    }
  }

  function gridH(ix, iz) {
    ix = ix < 0 ? 0 : ix > segments ? segments : ix;
    iz = iz < 0 ? 0 : iz > segments ? segments : iz;
    return heights[iz * verts + ix];
  }

  function heightAt(x, z) {
    let gx = (x + half) / cell;
    let gz = (z + half) / cell;
    gx = clamp(gx, 0, segments - 1e-6);
    gz = clamp(gz, 0, segments - 1e-6);
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

  function normalAt(x, z, out) {
    const o = out || { x: 0, y: 1, z: 0 };
    let gx = (x + half) / cell;
    let gz = (z + half) / cell;
    gx = clamp(gx, 0, segments - 1e-6);
    gz = clamp(gz, 0, segments - 1e-6);
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const fx = gx - ix;
    const fz = gz - iz;
    const h00 = heights[iz * verts + ix];
    const h10 = heights[iz * verts + ix + 1];
    const h01 = heights[(iz + 1) * verts + ix];
    const h11 = heights[(iz + 1) * verts + ix + 1];
    let dhdx;
    let dhdz;
    if (fx + fz <= 1) {
      dhdx = (h10 - h00) / cell;
      dhdz = (h01 - h00) / cell;
    } else {
      dhdx = (h11 - h01) / cell;
      dhdz = (h11 - h10) / cell;
    }
    const nx = -dhdx;
    const ny = 1;
    const nz = -dhdz;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
    o.x = nx / l; o.y = ny / l; o.z = nz / l;
    return o;
  }

  let sunVis = null;
  if (opts.sunDirection && opts.sunShadows !== false) {
    sunVis = bakeSunVisibility(heights, verts, segments, cell, half, opts.sunDirection, quality.name === 'low' ? 2 : 1);
  }

  const shapeData = new Uint8Array(verts * verts * 4);
  for (let iz = 0; iz < verts; iz++) {
    for (let ix = 0; ix < verts; ix++) {
      const hx = gridH(ix + 1, iz) - gridH(ix - 1, iz);
      const hz = gridH(ix, iz + 1) - gridH(ix, iz - 1);
      const ny = 2 * cell;
      const l = Math.sqrt(hx * hx + ny * ny + hz * hz);
      const o = (iz * verts + ix) * 4;
      shapeData[o] = Math.round((-hx / l * 0.5 + 0.5) * 255);
      shapeData[o + 1] = Math.round((ny / l * 0.5 + 0.5) * 255);
      shapeData[o + 2] = Math.round((-hz / l * 0.5 + 0.5) * 255);
      shapeData[o + 3] = Math.round((sunVis ? sunVis[iz * verts + ix] : 1) * 255);
    }
  }
  const shapeTex = new THREE.DataTexture(shapeData, verts, verts, THREE.RGBAFormat, THREE.UnsignedByteType);
  shapeTex.magFilter = THREE.LinearFilter;
  shapeTex.minFilter = THREE.LinearFilter;
  shapeTex.wrapS = THREE.ClampToEdgeWrapping;
  shapeTex.wrapT = THREE.ClampToEdgeWrapping;
  shapeTex.generateMipmaps = false;
  shapeTex.name = 'kw-terrain-shape';
  shapeTex.needsUpdate = true;

  const biome = TERRAIN_BIOMES[opts.biome] || TERRAIN_BIOMES.meadow;
  const layerSpec = { ...biome.layers, ...(opts.layers || opts.materials || {}) };
  const texSize = quality.name === 'low' ? 256 : 512;
  const tex = {};
  for (const key of ['grass', 'dirt', 'rock', 'sand']) {
    const spec = layerSpec[key];
    const t = loadTexture(spec.tex, { size: texSize, procedural: spec.procedural || spec.tex });
    tex[key] = t;
  }

  const uniforms = {
    kwGrassMap: { value: tex.grass },
    kwDirtMap: { value: tex.dirt },
    kwRockMap: { value: tex.rock },
    kwSandMap: { value: tex.sand },
    kwGrassTint: { value: new THREE.Vector3().fromArray(layerSpec.grass.tint) },
    kwDirtTint: { value: new THREE.Vector3().fromArray(layerSpec.dirt.tint) },
    kwRockTint: { value: new THREE.Vector3().fromArray(layerSpec.rock.tint) },
    kwSandTint: { value: new THREE.Vector3().fromArray(layerSpec.sand.tint) },
    kwScales: { value: new THREE.Vector4(layerSpec.grass.scale, layerSpec.dirt.scale, layerSpec.rock.scale, layerSpec.sand.scale) },
    kwSplat: { value: new THREE.Vector4(opts.rockSlope ?? biome.rockSlope, opts.dirtAmount ?? biome.dirtAmount, opts.sandTop ?? biome.sandTop, opts.strata ?? biome.strata ?? 0) },
    kwMacro: { value: new THREE.Vector4(opts.macro ?? biome.macro, 0.12, opts.bump ?? 0.5, opts.rockAbove ?? biome.rockAbove ?? 0) },
    kwMacroTint: { value: new THREE.Vector3().fromArray(opts.macroTint ?? biome.macroTint) },
    kwLayerSat: { value: new THREE.Vector4(1, 1, 1, 1) },
    kwCloudShadow: { value: new THREE.Vector4(clamp(opts.cloudShadows ?? 0, 0, 1) * 0.55, 1 / (opts.cloudShadowScale ?? 260), 0.62 - clamp(opts.cloudShadows ?? 0, 0, 1) * 0.25, 0) },
    kwCloudWind: { value: new THREE.Vector3(0.6, 0.25, 0) },
    kwShapeTex: { value: shapeTex },
    kwShapeGrid: { value: new THREE.Vector3(half, cell, verts) },
  };
  const tintUniform = { grass: uniforms.kwGrassTint, dirt: uniforms.kwDirtTint, rock: uniforms.kwRockTint, sand: uniforms.kwSandTint };
  const satIndex = { grass: 'x', dirt: 'y', rock: 'z', sand: 'w' };
  for (const key of ['grass', 'dirt', 'rock', 'sand']) {
    const spec = layerSpec[key];
    if (!spec.fileTint && spec.fileSat == null) continue;
    tex[key].userData.ready.then((t) => {
      if (t.userData.source !== 'file') return;
      if (spec.fileTint) tintUniform[key].value.fromArray(spec.fileTint);
      if (spec.fileSat != null) uniforms.kwLayerSat.value[satIndex[key]] = spec.fileSat;
    });
  }

  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
  material.name = 'kw-terrain';
  if (quality.noTile) material.defines = { ...(material.defines || {}), KW_NO_TILE: '' };
  if (quality.farBlend) material.defines = { ...(material.defines || {}), KW_FAR_BLEND: '' };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vKwWorld;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvKwWorld = (modelMatrix * vec4(position, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + TERRAIN_SPLAT_GLSL)
      .replace('#include <map_fragment>', TERRAIN_SPLAT_MAIN)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = kwRough;')
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize((viewMatrix * vec4(kwN, 0.0)).xyz);\nnonPerturbedNormal = normal;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = kwPerturbNormal(-vViewPosition, normal, vec2(dFdx(kwBumpLum), dFdy(kwBumpLum)));')
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
  float kwShade = kwShape.a;
  if (kwCloudShadow.x > 0.0) {
    vec2 kwCp = vKwWorld.xz * kwCloudShadow.y + kwCloudWind.xy * kwCloudWind.z;
    float kwCn = kwValueNoise(kwCp) * 0.55 + kwValueNoise(kwCp * 2.13 + 5.7) * 0.3 + kwValueNoise(kwCp * 4.7 + 1.3) * 0.15;
    float kwCover = smoothstep(kwCloudShadow.z, kwCloudShadow.z + 0.16, kwCn);
    kwShade *= 1.0 - kwCover * kwCloudShadow.x;
  }
  reflectedLight.directDiffuse *= kwShade;
  reflectedLight.directSpecular *= kwShade;`);
  };
  material.customProgramCacheKey = () => 'kw-terrain-px-' + (quality.noTile ? 'nt' : 't') + (quality.farBlend ? 'f' : 'n');

  const chunkCells = opts.chunkCells || Math.min(128, Math.max(16, Math.pow(2, Math.ceil(Math.log2(Math.ceil(segments / 7))))));
  const chunksPerSide = Math.ceil(segments / chunkCells);
  const group = new THREE.Group();
  group.name = 'kw-terrain';
  const lods = [];
  const geometries = [];
  const rawRes = quality.terrainRes ?? 1;
  const resFactor = clamp(rawRes > 4 ? rawRes / 256 : rawRes, 0.3, 2);
  const chunkWorld = chunkCells * cell;
  const lodSteps = [1, 2, 4, 8].filter((s) => s <= chunkCells / 2);
  const lodDistances = lodSteps.map((s, i) => (i === 0 ? 0 : chunkWorld * (0.9 + i * 1.25) * resFactor * (i >= 2 ? 1.6 : 1)));

  function buildChunk(cx, cz, step, ox, oz) {
    const x0 = cx * chunkCells;
    const z0 = cz * chunkCells;
    const x1 = Math.min(x0 + chunkCells, segments);
    const z1 = Math.min(z0 + chunkCells, segments);
    const nx = Math.ceil((x1 - x0) / step) + 1;
    const nz = Math.ceil((z1 - z0) / step) + 1;
    const skirtCount = 2 * (nx + nz);
    const total = nx * nz + skirtCount;
    const pos = new Float32Array(total * 3);
    const nor = new Float32Array(total * 3);
    const index = [];
    let v = 0;
    const normalOf = (ix, iz) => {
      const s = Math.max(1, step);
      const hx = gridH(ix + s, iz) - gridH(ix - s, iz);
      const hz = gridH(ix, iz + s) - gridH(ix, iz - s);
      const nxv = -hx;
      const nyv = 2 * s * cell;
      const nzv = -hz;
      const l = Math.sqrt(nxv * nxv + nyv * nyv + nzv * nzv);
      return [nxv / l, nyv / l, nzv / l];
    };
    for (let j = 0; j < nz; j++) {
      const iz = Math.min(z0 + j * step, z1);
      for (let i = 0; i < nx; i++) {
        const ix = Math.min(x0 + i * step, x1);
        pos[v * 3] = -half + ix * cell - ox;
        pos[v * 3 + 1] = gridH(ix, iz);
        pos[v * 3 + 2] = -half + iz * cell - oz;
        const n = normalOf(ix, iz);
        nor[v * 3] = n[0]; nor[v * 3 + 1] = n[1]; nor[v * 3 + 2] = n[2];
        v++;
      }
    }
    for (let j = 0; j < nz - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i;
        const b = a + 1;
        const c = a + nx;
        const d = c + 1;
        index.push(a, c, b, b, c, d);
      }
    }
    const skirtDepth = cell * step * 1.5 + 2;
    const edge = (list) => {
      const startV = v;
      for (const k of list) {
        pos[v * 3] = pos[k * 3];
        pos[v * 3 + 1] = pos[k * 3 + 1] - skirtDepth;
        pos[v * 3 + 2] = pos[k * 3 + 2];
        nor[v * 3] = nor[k * 3]; nor[v * 3 + 1] = nor[k * 3 + 1]; nor[v * 3 + 2] = nor[k * 3 + 2];
        v++;
      }
      for (let k = 0; k < list.length - 1; k++) {
        const a = list[k];
        const b = list[k + 1];
        const as = startV + k;
        const bs = startV + k + 1;
        index.push(a, b, as, b, bs, as);
        index.push(a, as, b, b, as, bs);
      }
    };
    const top = [];
    const bottom = [];
    const left = [];
    const right = [];
    for (let i = 0; i < nx; i++) { top.push(i); bottom.push((nz - 1) * nx + i); }
    for (let j = 0; j < nz; j++) { left.push(j * nx); right.push(j * nx + nx - 1); }
    edge(top);
    edge(bottom);
    edge(left);
    edge(right);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, v * 3), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor.subarray(0, v * 3), 3));
    geo.setIndex(index);
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    geometries.push(geo);
    return geo;
  }

  for (let cz = 0; cz < chunksPerSide; cz++) {
    for (let cx = 0; cx < chunksPerSide; cx++) {
      const lod = new THREE.LOD();
      lod.name = 'kw-terrain-chunk';
      const cxw = -half + Math.min((cx + 0.5) * chunkWorld, size - chunkWorld * 0.25);
      const czw = -half + Math.min((cz + 0.5) * chunkWorld, size - chunkWorld * 0.25);
      const cyw = gridH(Math.min(Math.round((cxw + half) / cell), segments), Math.min(Math.round((czw + half) / cell), segments));
      lodSteps.forEach((step, i) => {
        const mesh = new THREE.Mesh(buildChunk(cx, cz, step, cxw, czw), material);
        mesh.receiveShadow = !!quality.shadows;
        mesh.castShadow = !!quality.castShadow && i === 0;
        mesh.matrixAutoUpdate = false;
        lod.addLevel(mesh, lodDistances[i]);
      });
      lod.position.set(cxw, 0, czw);
      lod.matrixAutoUpdate = false;
      lod.updateMatrix();
      lod.userData.center = new THREE.Vector3(cxw, cyw, czw);
      group.add(lod);
      lods.push(lod);
    }
  }

  let water = null;
  let waterMaterial = null;
  let waterNormal = null;
  if (opts.waterLevel != null) {
    waterNormal = makeWaterNormalTexture(256);
    waterMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setRGB(0.012, 0.05, 0.07),
      roughness: 0.06,
      metalness: 0.0,
      normalMap: waterNormal,
      normalScale: new THREE.Vector2(0.35, 0.35),
      transparent: true,
      opacity: 0.92,
      envMapIntensity: 1.35,
    });
    waterMaterial.name = 'kw-water';
    const waterUniforms = { kwTime: { value: 0 }, kwShallow: { value: new THREE.Vector3(0.05, 0.16, 0.16) } };
    waterMaterial.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, waterUniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vKwWaterWorld;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvKwWaterWorld = (modelMatrix * vec4(position, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float kwTime;\nuniform vec3 kwShallow;\nvarying vec3 vKwWaterWorld;')
        .replace('#include <normal_fragment_maps>', `
          vec2 kwUvA = vKwWaterWorld.xz * 0.045 + vec2(kwTime * 0.012, kwTime * 0.007);
          vec2 kwUvB = vKwWaterWorld.xz * 0.11 + vec2(-kwTime * 0.017, kwTime * 0.013);
          vec2 kwUvC = vKwWaterWorld.xz * 0.006 + vec2(kwTime * 0.003, -kwTime * 0.002);
          vec3 kwNa = texture2D(normalMap, kwUvA).xyz * 2.0 - 1.0;
          vec3 kwNb = texture2D(normalMap, kwUvB).xyz * 2.0 - 1.0;
          vec3 kwNc = texture2D(normalMap, kwUvC).xyz * 2.0 - 1.0;
          vec3 kwWn = normalize(vec3((kwNa.xy + kwNb.xy * 0.6 + kwNc.xy * 0.8) * normalScale.x, 1.0));
          normal = normalize((viewMatrix * vec4(kwWn.x, kwWn.z, -kwWn.y, 0.0)).xyz);
        `)
        .replace('#include <opaque_fragment>', `
          vec3 kwViewDirW = normalize(vKwWaterWorld - cameraPosition);
          float kwFres = pow(1.0 - clamp(-kwViewDirW.y, 0.0, 1.0), 4.0);
          outgoingLight = mix(outgoingLight + kwShallow * 0.05 * (1.0 - kwFres), outgoingLight, kwFres);
          diffuseColor.a = mix(0.82, 1.0, kwFres);
          #include <opaque_fragment>
        `);
    };
    const waterSize = size * 3;
    const wgeo = new THREE.PlaneGeometry(waterSize, waterSize, 1, 1);
    wgeo.rotateX(-Math.PI / 2);
    water = new THREE.Mesh(wgeo, waterMaterial);
    water.name = 'kw-water';
    water.position.y = opts.waterLevel;
    water.receiveShadow = !!quality.shadows;
    water.renderOrder = 1;
    water.userData.uniforms = waterUniforms;
    group.add(water);
  }

  if (opts.scene) opts.scene.add(group);

  let time = 0;
  function update(camera, dt = 1 / 60) {
    time += dt;
    uniforms.kwCloudWind.value.z = time * (opts.cloudShadowSpeed ?? 0.012);
    if (water) water.userData.uniforms.kwTime.value = time;
    if (camera && water) {
      water.position.x = Math.round(camera.position.x / 50) * 50;
      water.position.z = Math.round(camera.position.z / 50) * 50;
    }
  }

  function setCloudShadows(amount) {
    const a = clamp(amount || 0, 0, 1);
    uniforms.kwCloudShadow.value.x = a * 0.55;
    uniforms.kwCloudShadow.value.z = 0.62 - a * 0.25;
  }

  function dispose() {
    if (group.parent) group.parent.remove(group);
    for (const g of geometries) g.dispose();
    material.dispose();
    shapeTex.dispose();
    if (water) { water.geometry.dispose(); waterMaterial.dispose(); }
    if (waterNormal) waterNormal.dispose();
  }

  return {
    mesh: group,
    group,
    water,
    material,
    heightAt,
    normalAt,
    update,
    setCloudShadows,
    size,
    segments,
    cell,
    heights,
    biome: opts.biome || 'meadow',
    dispose,
  };
}

function bakeSunVisibility(heights, verts, segments, cell, half, sunDirection, stride) {
  const vis = new Float32Array(verts * verts);
  const sx = sunDirection.x;
  const sy = sunDirection.y;
  const sz = sunDirection.z;
  const horiz = Math.hypot(sx, sz);
  if (horiz < 1e-4) { vis.fill(1); return vis; }
  const dx = sx / horiz;
  const dz = sz / horiz;
  const tanSun = sy / horiz;
  const soft = 0.04;
  const sample = (x, z) => {
    let gx = (x + half) / cell;
    let gz = (z + half) / cell;
    if (gx < 0 || gz < 0 || gx > segments || gz > segments) return -1e9;
    gx = Math.min(gx, segments - 1e-6);
    gz = Math.min(gz, segments - 1e-6);
    const ix = gx | 0;
    const iz = gz | 0;
    const fx = gx - ix;
    const fz = gz - iz;
    const i0 = iz * verts + ix;
    const a = heights[i0];
    const b = heights[i0 + 1];
    const c = heights[i0 + verts];
    const d = heights[i0 + verts + 1];
    return (a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz;
  };
  const maxDist = Math.min(half * 2.2, 1400);
  for (let iz = 0; iz < verts; iz += stride) {
    for (let ix = 0; ix < verts; ix += stride) {
      const x0 = -half + ix * cell;
      const z0 = -half + iz * cell;
      const h0 = heights[iz * verts + ix] + 0.4;
      let maxTan = -1e9;
      let t = cell * 0.9;
      let step = cell * 0.9;
      while (t < maxDist) {
        const h = sample(x0 + dx * t, z0 + dz * t);
        if (h < -1e8) break;
        const tn = (h - h0) / t;
        if (tn > maxTan) {
          maxTan = tn;
          if (maxTan > tanSun + soft) break;
        }
        step *= 1.09;
        t += step;
      }
      const v = Math.min(Math.max((tanSun - maxTan + soft) / (2 * soft), 0), 1);
      vis[iz * verts + ix] = v * v * (3 - 2 * v);
    }
  }
  if (stride > 1) {
    for (let iz = 0; iz < verts; iz++) {
      for (let ix = 0; ix < verts; ix++) {
        if (iz % stride === 0 && ix % stride === 0) continue;
        const bx = Math.min(ix - (ix % stride), verts - 1);
        const bz = Math.min(iz - (iz % stride), verts - 1);
        vis[iz * verts + ix] = vis[bz * verts + bx];
      }
    }
  }
  return vis;
}

function makeWaterNormalTexture(size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const h = new Float32Array(size * size);
  const waves = [];
  let seed = 1337;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 14; i++) {
    const kx = Math.round((rnd() - 0.5) * (4 + i * 2));
    const ky = Math.round((rnd() - 0.5) * (4 + i * 2));
    waves.push({ kx: kx || 1, ky, amp: 1 / (1 + i * 0.6), ph: rnd() * Math.PI * 2 });
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0;
      for (const w of waves) v += w.amp * Math.sin(((x * w.kx + y * w.ky) / size) * Math.PI * 2 + w.ph);
      h[y * size + x] = v;
    }
  }
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = h[y * size + ((x - 1 + size) % size)];
      const r = h[y * size + ((x + 1) % size)];
      const u = h[((y - 1 + size) % size) * size + x];
      const b = h[((y + 1) % size) * size + x];
      let nx = (l - r) * 0.35;
      let ny = (u - b) * 0.35;
      let nz = 1;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx /= len; ny /= len; nz /= len;
      const i = (y * size + x) * 4;
      d[i] = (nx * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * 0.5 + 0.5) * 255;
      d[i + 2] = (nz * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 4;
  return tex;
}
