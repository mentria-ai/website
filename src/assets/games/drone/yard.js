import * as THREE from 'three';
import * as KitProps from '../kit/props.js';

const MAX_MARKS = 32;

const MARK_GLSL = `
uniform vec4 dmSeg[${MAX_MARKS}];
uniform vec4 dmStyle[${MAX_MARKS}];
uniform int dmCount;
varying vec3 vDmPos;
float dmHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float dmNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(dmHash(i), dmHash(i + vec2(1.0, 0.0)), f.x), mix(dmHash(i + vec2(0.0, 1.0)), dmHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;

const MARK_MAIN = `
{
  vec2 dmP = vDmPos.xz;
  float dmPx = length(fwidth(dmP)) * 0.75 + 0.002;
  float dmA = 0.0;
  vec3 dmCol = vec3(0.0);
  for (int i = 0; i < ${MAX_MARKS}; i++) {
    if (i >= dmCount) break;
    vec4 s = dmSeg[i];
    vec4 st = dmStyle[i];
    vec2 ab = s.zw - s.xy;
    float len2 = max(dot(ab, ab), 1e-4);
    float t = clamp(dot(dmP - s.xy, ab) / len2, 0.0, 1.0);
    float d = length(dmP - (s.xy + ab * t));
    float line = 1.0 - smoothstep(st.x * 0.5 - dmPx, st.x * 0.5 + dmPx, d);
    if (st.y > 0.0) {
      float u = mod(t * sqrt(len2), st.y + st.z);
      line *= smoothstep(0.0, dmPx * 2.0, u) * (1.0 - smoothstep(st.y - dmPx * 2.0, st.y, u));
    }
    if (line > dmA) {
      dmA = line;
      dmCol = st.w > 0.5 ? vec3(0.9, 0.64, 0.12) : vec3(0.86, 0.86, 0.82);
    }
  }
  float dmWear = dmNoise(dmP * 0.8) * 0.6 + dmNoise(dmP * 3.1) * 0.4;
  dmA *= 0.4 + 0.6 * smoothstep(0.2, 0.7, dmWear);
  float dmPatch = dmNoise(dmP * 0.031) * 0.55 + dmNoise(dmP * 0.13 + 3.7) * 0.3 + dmNoise(dmP * 0.6) * 0.15;
  vec2 dmCell = floor(dmP / 7.0);
  float dmRepair = step(0.86, dmHash(dmCell)) * (1.0 - smoothstep(2.6, 3.0, max(abs(dmP.x - (dmCell.x + 0.5) * 7.0), abs(dmP.y - (dmCell.y + 0.5) * 7.0))));
  float dmOil = smoothstep(0.78, 0.92, dmNoise(dmP * 0.21 + 11.0)) * 0.35;
  diffuseColor.rgb *= (0.84 + 0.3 * dmPatch) * (1.0 - dmRepair * 0.22) * (1.0 - dmOil);
  diffuseColor.rgb = mix(diffuseColor.rgb, dmCol, dmA * 0.9);
}
#include <alphamap_fragment>`;

export function paintMarkings(material, marks) {
  const list = (Array.isArray(marks) ? marks : []).slice(0, MAX_MARKS);
  const seg = [];
  const style = [];
  for (const m of list) {
    seg.push(new THREE.Vector4(m.a[0], m.a[1], m.b[0], m.b[1]));
    style.push(new THREE.Vector4(m.w || 0.15, m.dash ? m.dash[0] : 0, m.dash ? m.dash[1] : 0, m.color === 'yellow' ? 1 : 0));
  }
  while (seg.length < MAX_MARKS) { seg.push(new THREE.Vector4()); style.push(new THREE.Vector4()); }
  const uniforms = { dmSeg: { value: seg }, dmStyle: { value: style }, dmCount: { value: list.length } };
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (typeof prev === 'function') prev(shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDmPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvDmPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + MARK_GLSL)
      .replace('#include <alphamap_fragment>', MARK_MAIN);
  };
  const prevKey = material.customProgramCacheKey ? material.customProgramCacheKey.bind(material) : null;
  material.customProgramCacheKey = () => (prevKey ? prevKey() : '') + '|dm-marks';
  material.needsUpdate = true;
  return material;
}

export function yardProps(scene, dressing, terrain, quality) {
  const out = [];
  const d = dressing || {};
  const run = (fn, opts) => {
    if (typeof fn !== 'function') return;
    try {
      const res = fn(scene, Object.assign({ terrain, quality }, opts));
      if (res) out.push(res);
    } catch (err) {
      console.error('[skyrush] yard', err);
    }
  };
  for (const f of d.fences || []) run(KitProps.fences, { kind: f.kind || 'chainlink', line: { points: f.points, closed: !!f.closed } });
  for (const b of d.barriers || []) run(KitProps.barriers, { kind: b.kind || 'jersey', line: { points: b.points } });
  if ((d.cones || []).length) run(KitProps.cones, { items: d.cones.map((c) => ({ x: c[0], z: c[1] })), colliders: true });
  if ((d.crates || []).length) run(KitProps.crates, { items: d.crates.map((c) => ({ x: c[0], z: c[1], yaw: c[2] || 0, stack: c[3] || 1, size: c[4] || 1.2 })) });
  return out;
}
