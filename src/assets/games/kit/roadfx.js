const ROAD_GLSL = `
varying vec2 vRdP;
varying float vRdHalf;
uniform float rdLanes;
float rdHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float rdNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(rdHash(i), rdHash(i + vec2(1.0, 0.0)), f.x), mix(rdHash(i + vec2(0.0, 1.0)), rdHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;

const ROAD_MAIN = `
float rdWear = 0.0;
float rdMark = 0.0;
{
  float lat = vRdP.x;
  float s = vRdP.y;
  float hw = max(vRdHalf, 1.0);
  float lanes = max(rdLanes, 1.0);
  float laneW = 2.0 * hw / lanes;
  for (int k = 0; k < 4; k++) {
    if (float(k) >= lanes) break;
    float c = -hw + laneW * (float(k) + 0.5);
    float d = abs(abs(lat - c) - min(0.9, laneW * 0.24));
    rdWear = max(rdWear, 1.0 - smoothstep(0.16, 0.46, d));
  }
  rdWear *= 0.65 + 0.35 * rdNoise(vec2(lat * 0.7, s * 0.05));
  float pcell = floor(s / 13.0);
  float lane = floor((lat + hw) / laneW);
  float ph = rdHash(vec2(pcell, lane + 7.0));
  float plen = 3.0 + 6.0 * fract(ph * 7.1);
  float pz = mod(s, 13.0);
  float px = (lat + hw) - lane * laneW;
  float patchIn = step(0.82, ph) * step(1.0, pz) * step(pz, 1.0 + plen) * step(0.25, px) * step(px, laneW - 0.25);
  vec2 cp = vec2(lat * 0.55, s * 0.55);
  float cn = rdNoise(cp) * 0.65 + rdNoise(cp * 2.3 + 4.1) * 0.35;
  float crackMask = smoothstep(0.7, 0.86, rdNoise(vec2(lat * 0.08, s * 0.03) + 9.0));
  float fw = fwidth(cn) * 1.4 + 0.004;
  float crack = (1.0 - smoothstep(0.0, fw, abs(cn - 0.5))) * crackMask;
  float edge = smoothstep(hw - 0.9, hw - 0.1, abs(lat));
  float scell = floor(s / 47.0);
  float sh = rdHash(vec2(scell, 3.3));
  float sz = mod(s, 47.0);
  float sOn = step(0.7, sh) * smoothstep(0.0, 4.0, sz) * (1.0 - smoothstep(14.0, 24.0, sz));
  float sOff = (fract(sh * 13.1) - 0.5) * hw * 0.9 + sin(sz * 0.12 + sh * 6.0) * 0.6;
  float skid = 0.0;
  for (int w = 0; w < 2; w++) {
    float wl = sOff + (float(w) - 0.5) * 1.6;
    skid = max(skid, 1.0 - smoothstep(0.08, 0.16, abs(lat - wl)));
  }
  skid *= sOn * (0.6 + 0.4 * rdNoise(vec2(lat * 3.0, s * 0.4)));
  rdMark = skid;
  vec3 tint = vec3(1.0);
  tint *= 1.0 - 0.16 * rdWear;
  tint *= mix(1.0, 0.8, patchIn);
  tint *= 1.0 - 0.32 * crack * (1.0 - patchIn);
  tint = mix(tint, tint * vec3(1.12, 1.06, 0.96), edge * 0.6);
  tint *= 1.0 - 0.42 * skid;
  diffuseColor.rgb *= tint;
}
#include <alphamap_fragment>`;

export function detailRoad(material, opts = {}) {
  if (!material) return material;
  const lanes = { value: Math.max(1, Math.min(4, opts.lanes || 2)) };
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (typeof prev === 'function') prev(shader, renderer);
    shader.uniforms.rdLanes = lanes;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vRdP;\nvarying float vRdHalf;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRdP = uv * 10.0;\nvRdHalf = abs(uv.x) * 10.0;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + ROAD_GLSL)
      .replace('#include <alphamap_fragment>', ROAD_MAIN)
      .replace('#include <normal_fragment_begin>', 'roughnessFactor *= 1.0 - 0.22 * rdWear - 0.15 * rdMark;\n#include <normal_fragment_begin>');
  };
  const prevKey = material.customProgramCacheKey ? material.customProgramCacheKey.bind(material) : null;
  material.customProgramCacheKey = () => (prevKey ? prevKey() : '') + '|road-detail';
  material.needsUpdate = true;
  return material;
}
