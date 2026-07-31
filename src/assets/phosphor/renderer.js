const MAT_ID = { concrete: 0, metal: 1, paint: 2, emissive: 3 };
const SHADOW_SIZE = 2048;
const MAX_LIGHTS = 16;
const CHUNK_LIGHTS = 8;
const MAX_TRACERS = 96;
const MAX_SPARKS = 384;
const CELL_SIZE = 24;
const TESS_TARGET = 1.5;
const TESS_MAX = 24;
const MINT = [0.431, 0.953, 0.773];
const AMBER = [0.969, 0.690, 0.082];
const VSTRIDE = 12;
const VBYTES = 48;
const STRIP_MAX = 40;
const STRIP_WIDTH = 0.06;
const PROP_MAX = 12;
const TRAIL_MAX = 26;
const TRAIL_LIFE = 0.7;
const TRAIL_STEP = 0.028;
const SPEC_HEADROOM = 0.32;
const LDR_SCALE = 0.58;

const GLSL_NOISE = `
float h21(vec2 p){ vec3 q = fract(vec3(p.x, p.y, p.x) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float h11(float n){ return fract(sin(n * 91.3458) * 47453.5453); }
float n2(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = h21(i); float b = h21(i + vec2(1.0, 0.0)); float c = h21(i + vec2(0.0, 1.0)); float d = h21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float triNoise(vec3 p, vec3 w, float s){ return n2(p.yz * s) * w.x + n2(p.xz * s) * w.y + n2(p.xy * s) * w.z; }
`;

const GLSL_FOG = `
uniform vec3 uFogColor;
uniform vec3 uFogParam;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
vec3 applyFog(vec3 col, vec3 wpos, vec3 campos){
  vec3 d = wpos - campos;
  float dist = length(d);
  if (dist < 0.0001) return col;
  vec3 rd = d / dist;
  float hf = uFogParam.y;
  float dy = wpos.y - campos.y;
  float ha = exp(-clamp((campos.y - uFogParam.z) * hf, -12.0, 12.0));
  float hb = exp(-clamp((wpos.y - uFogParam.z) * hf, -12.0, 12.0));
  float optical = (abs(dy) > 0.001 && hf > 0.0001) ? dist * (ha - hb) / (dy * hf) : dist * ha;
  float f = 1.0 - exp(-uFogParam.x * max(optical, 0.0));
  vec3 fc = mix(uFogColor, uSunColor * 0.85, pow(max(dot(rd, -uSunDir), 0.0), 9.0) * 0.30);
  return mix(col, fc, clamp(f, 0.0, 1.0));
}
`;

const VS_WORLD = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in float aAO;
layout(location=3) in vec3 aTint;
layout(location=4) in vec2 aDetail;
uniform mat4 uViewProj;
uniform mat4 uShadowMat;
out vec3 vPos;
out vec3 vNormal;
out float vAO;
out vec3 vTint;
out vec2 vDetail;
out vec4 vShadow;
void main(){
  vPos = aPos;
  vNormal = aNormal;
  vAO = aAO;
  vTint = aTint;
  vDetail = aDetail;
  vShadow = uShadowMat * vec4(aPos + aNormal * 0.04, 1.0);
  gl_Position = uViewProj * vec4(aPos, 1.0);
}`;

const FS_WORLD = `#version 300 es
precision highp float;
precision highp sampler2DShadow;
in vec3 vPos;
in vec3 vNormal;
in float vAO;
in vec3 vTint;
in vec2 vDetail;
in vec4 vShadow;
uniform vec3 uCamPos;
uniform vec3 uAmbient;
uniform int uMat;
uniform sampler2DShadow uShadow;
uniform vec2 uShadowTexel;
uniform int uLightCount;
uniform vec3 uLightPos[8];
uniform vec3 uLightColor[8];
uniform float uLightRadius[8];
uniform vec4 uMuzzle;
uniform vec3 uMuzzleColor;
uniform float uPreExpose;
uniform float uSpecCap;
out vec4 oColor;
${GLSL_NOISE}
${GLSL_FOG}
float shadowAt(){
  if (vShadow.w <= 0.0) return 1.0;
  vec3 pc = vShadow.xyz / vShadow.w;
  if (pc.x < 0.002 || pc.x > 0.998 || pc.y < 0.002 || pc.y > 0.998 || pc.z > 1.0) return 1.0;
  float d = pc.z - 0.0018;
  float s = 0.0;
  for (int y = -1; y <= 1; y++){
    for (int x = -1; x <= 1; x++){
      s += texture(uShadow, vec3(pc.xy + vec2(float(x), float(y)) * uShadowTexel, d));
    }
  }
  return s * 0.11111;
}
void main(){
  vec3 n = normalize(vNormal);
  if (uMat == 3){
    float core = clamp(vDetail.y, 0.0, 1.0);
    vec3 e = vTint * (1.95 + 0.66 * core * (2.0 - core));
    oColor = vec4(applyFog(e, vPos, uCamPos) * uPreExpose, 1.0);
    return;
  }
  vec3 vd = uCamPos - vPos;
  float dcam = length(vd);
  vec3 v = dcam > 0.0001 ? vd / dcam : vec3(0.0, 0.0, 1.0);
  float dNear = 1.0 - smoothstep(16.0, 42.0, dcam);
  vec3 w = abs(n);
  w = w / max(w.x + w.y + w.z, 0.0001);
  float nA = triNoise(vPos, w, 1.7);
  float nB = triNoise(vPos, w, 7.9);
  float nC = triNoise(vPos, w, 0.155);
  vec2 puv = w.y > 0.5 ? vPos.xz : (w.x > w.z ? vPos.zy : vPos.xy);
  vec3 albedo;
  float specK;
  float gloss;
  float aniso = 1.0;
  if (uMat == 1){
    float streak = n2(vec2(vPos.y * 26.0, (vPos.x + vPos.z) * 1.3));
    float g = 0.185 + (nB - 0.5) * 0.05 + (streak - 0.5) * 0.055 + (nC - 0.5) * 0.05;
    float seam = 0.0;
    if (dNear > 0.0){
      float pl = n2(puv * 0.55);
      seam = (smoothstep(0.468, 0.497, pl) - smoothstep(0.503, 0.532, pl)) * dNear;
    }
    g *= 1.0 - seam * 0.44;
    vec3 temp = mix(vec3(0.92, 0.97, 1.10), vec3(1.09, 1.00, 0.90), smoothstep(0.36, 0.72, nC));
    albedo = vec3(g) * temp;
    specK = (0.30 + (nA - 0.5) * 0.14) * (1.0 - seam * 0.6);
    gloss = 54.0;
    vec3 bt = normalize(cross(n, vec3(0.0, 1.0, 0.0)) + vec3(0.0001, 0.0, 0.0));
    vec3 shv = normalize(-uSunDir + v);
    aniso = 0.55 + 1.10 * pow(1.0 - abs(dot(shv, bt)), 3.0);
  } else if (uMat == 2){
    float g = 0.355 + (nC - 0.5) * 0.034;
    albedo = vec3(g, g * 0.99, g * 0.96);
    float chip = clamp(smoothstep(0.66, 0.30, vAO) * smoothstep(0.52, 0.82, nB) * (1.0 - vDetail.y * 0.7), 0.0, 1.0);
    albedo = mix(albedo, vec3(0.166, 0.162, 0.157), chip * 0.78);
    specK = 0.10 - chip * 0.05;
    gloss = 26.0;
  } else {
    float g = 0.300 + (nC - 0.5) * 0.105 + (nA - 0.5) * 0.045 + (nB - 0.5) * 0.026;
    if (dNear > 0.0){
      float vert = clamp(1.0 - abs(n.y) * 1.6, 0.0, 1.0);
      float grain = n2(puv * 31.0);
      float sk = n2(vec2(puv.x * 4.2, puv.y * 0.20));
      float run = smoothstep(0.52, 0.94, sk) * exp(-max(vDetail.x, 0.0) * 0.85) * vert;
      g += ((grain - 0.5) * 0.055 - run * 0.115) * dNear;
    }
    albedo = vec3(g, g * 0.995, g * 0.965);
    specK = 0.035;
    gloss = 13.0;
  }
  albedo *= vTint;
  float sh = shadowAt();
  float ndl = max(dot(n, -uSunDir), 0.0);
  vec3 hv = normalize(-uSunDir + v);
  float spec = pow(max(dot(n, hv), 0.0), gloss) * specK * ndl * sh * aniso;
  spec = spec * uSpecCap / (uSpecCap + spec);
  float sky = 0.62 + 0.38 * n.y;
  vec3 col = albedo * (uAmbient * sky * vAO * (0.55 + 0.45 * vAO) + uSunColor * ndl * sh) + uSunColor * spec;
  for (int i = 0; i < 8; i++){
    if (i >= uLightCount) break;
    vec3 ld = uLightPos[i] - vPos;
    float dl = length(ld);
    float att = clamp(1.0 - dl / max(uLightRadius[i], 0.001), 0.0, 1.0);
    att *= att;
    if (att <= 0.0) continue;
    vec3 l = ld / max(dl, 0.0001);
    float nl = max(dot(n, l), 0.0);
    vec3 hl = normalize(l + v);
    float sp = pow(max(dot(n, hl), 0.0), gloss) * specK;
    col += uLightColor[i] * att * (albedo * nl + sp * nl) * vAO;
  }
  if (uMuzzle.w > 0.001){
    vec3 ld = uMuzzle.xyz - vPos;
    float dl = length(ld);
    float att = clamp(1.0 - dl / 11.0, 0.0, 1.0);
    att *= att * uMuzzle.w;
    if (att > 0.0){
      vec3 l = ld / max(dl, 0.0001);
      float nl = max(dot(n, l), 0.0);
      vec3 hl = normalize(l + v);
      col += uMuzzleColor * att * (albedo * nl + pow(max(dot(n, hl), 0.0), gloss) * specK * nl) * 2.2;
    }
  }
  oColor = vec4(applyFog(col, vPos, uCamPos) * uPreExpose, 1.0);
}`;

const VS_SHADOW = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uLightMat;
void main(){ gl_Position = uLightMat * vec4(aPos, 1.0); }`;

const FS_SHADOW = `#version 300 es
precision highp float;
void main(){}`;

const VS_FULL = `#version 300 es
out vec2 vUv;
void main(){
  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  vUv = (p + 1.0) * 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const VS_SKY = `#version 300 es
uniform vec3 uRight;
uniform vec3 uUp;
uniform vec3 uFwd;
uniform vec2 uTanFov;
out vec3 vRay;
void main(){
  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  vRay = uFwd + uRight * (p.x * uTanFov.x) + uUp * (p.y * uTanFov.y);
  gl_Position = vec4(p, 1.0, 1.0);
}`;

const FS_SKY = `#version 300 es
precision highp float;
in vec3 vRay;
uniform vec3 uZenith;
uniform vec3 uGround;
uniform float uPreExpose;
out vec4 oColor;
${GLSL_NOISE}
${GLSL_FOG}
void main(){
  vec3 rd = normalize(vRay);
  float up = clamp(rd.y, 0.0, 1.0);
  float sd = max(dot(rd, -uSunDir), 0.0);
  float sunUp = clamp(-uSunDir.y, -1.0, 1.0);
  float day = smoothstep(-0.09, 0.06, sunUp);
  vec3 col = mix(uFogColor, uZenith, pow(up, 0.55));
  col = mix(col, uZenith * 0.34 + vec3(0.003, 0.006, 0.018), pow(up, 2.6) * 0.5);
  float hazeA = exp(-abs(rd.y) * 17.0);
  float hazeB = exp(-abs(rd.y) * 4.4);
  float hazeC = exp(-abs(rd.y) * 1.5);
  vec3 warm = mix(uFogColor, uSunColor, 0.55);
  float lowSun = mix(0.62, 1.0, smoothstep(0.04, 0.34, sunUp));
  float toward = 0.24 + 0.76 * pow(sd * 0.5 + 0.5, 4.5);
  col += warm * (hazeA * 0.42 + hazeB * 0.15 + hazeC * 0.05) * toward * day * lowSun;
  float band = n2(rd.xz * 3.0 + rd.y * 2.0) - 0.5;
  col *= 1.0 + band * 0.05;
  col = mix(col, uGround, clamp(-rd.y * 3.2, 0.0, 1.0));
  float disc = smoothstep(0.99988, 0.99997, sd);
  col += uSunColor * (disc * 5.5 + pow(sd, 260.0) * 0.85 + (pow(sd, 34.0) * 0.26 + pow(sd, 7.0) * 0.045) * lowSun) * day;
  oColor = vec4(col * uPreExpose, 1.0);
}`;

const VS_TARGET = `#version 300 es
layout(location=0) in vec2 aCorner;
uniform mat4 uViewProj;
uniform vec3 uCenter;
uniform vec3 uRight;
uniform vec3 uUp;
uniform float uRadius;
out vec2 vUv;
out vec3 vPos;
void main(){
  vUv = aCorner;
  vPos = uCenter + uRight * (aCorner.x * uRadius) + uUp * (aCorner.y * uRadius);
  gl_Position = uViewProj * vec4(vPos, 1.0);
}`;

const FS_TARGET = `#version 300 es
precision highp float;
in vec2 vUv;
in vec3 vPos;
uniform vec3 uCamPos;
uniform vec3 uAmbient;
uniform vec3 uMint;
uniform vec3 uAmberC;
uniform float uDown;
uniform float uDownAge;
uniform float uSeed;
uniform float uTime;
uniform float uPreExpose;
out vec4 oColor;
${GLSL_NOISE}
${GLSL_FOG}
void main(){
  float sq = max(abs(vUv.x), abs(vUv.y));
  float rd = length(vUv);
  vec3 w = vec3(0.0, 0.0, 1.0);
  float grain = triNoise(vPos * 3.0, w, 4.0);
  vec3 plate = vec3(0.085, 0.090, 0.098) * (0.86 + grain * 0.28);
  plate *= mix(0.55, 1.0, smoothstep(0.995, 0.90, sq));
  plate *= 1.0 - 0.28 * (smoothstep(0.62, 0.665, rd) - smoothstep(0.695, 0.735, rd));
  vec3 col = plate * (uAmbient * 3.2 + vec3(0.10));
  float ring = smoothstep(0.735, 0.756, rd) * (1.0 - smoothstep(0.844, 0.866, rd));
  float ang = atan(vUv.y, vUv.x);
  float tk = abs(fract(ang * 1.9098593 + 0.5) - 0.5) * 2.0;
  float tick = (1.0 - smoothstep(0.16, 0.30, tk)) * smoothstep(0.560, 0.578, rd) * (1.0 - smoothstep(0.668, 0.688, rd));
  float pulse = 0.86 + 0.14 * sin(uTime * 3.1415927 + uSeed);
  float core = (1.0 - smoothstep(0.215, 0.268, rd)) * pulse;
  float coreRing = smoothstep(0.300, 0.316, rd) * (1.0 - smoothstep(0.336, 0.354, rd));
  float halo = pow(max(0.0, 1.0 - rd * 0.80), 3.6) * 0.26;
  vec3 emis = uMint * (ring * 3.0 + tick * 2.1 + coreRing * 1.1 + halo) + uAmberC * core * 2.5;
  float flick = step(0.58, h11(floor(uTime * 21.0) + uSeed * 13.0)) * max(0.0, 1.0 - uDownAge) * uDown;
  col += emis * (1.0 - uDown * 0.96);
  col += uMint * (ring + tick * 0.7 + core * 0.5) * flick * 0.85;
  col *= mix(1.0, 0.30, uDown);
  oColor = vec4(applyFog(col, vPos, uCamPos) * uPreExpose, 1.0);
}`;

const VS_TRACER = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in float aSide;
layout(location=2) in float aFade;
uniform mat4 uViewProj;
out float vSide;
out float vFade;
void main(){
  vSide = aSide;
  vFade = aFade;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}`;

const FS_TRACER = `#version 300 es
precision highp float;
in float vSide;
in float vFade;
uniform float uPreExpose;
out vec4 oColor;
void main(){
  float p = 1.0 - abs(vSide);
  float i = p * p * vFade;
  vec3 c = mix(vec3(1.0, 0.80, 0.45), vec3(0.55, 1.0, 0.85), 0.35) * i * 2.4;
  oColor = vec4(c * uPreExpose, 1.0);
}`;

const VS_SPARK = `#version 300 es
layout(location=0) in vec2 aCorner;
layout(location=1) in vec3 aIPos;
layout(location=2) in float aIAge;
uniform mat4 uViewProj;
uniform vec3 uRight;
uniform vec3 uUp;
out vec2 vUv;
out float vAge;
void main(){
  vUv = aCorner;
  vAge = aIAge;
  float s = mix(0.055, 0.012, aIAge);
  vec3 p = aIPos + vec3(0.0, aIAge * 0.55, 0.0) + uRight * (aCorner.x * s) + uUp * (aCorner.y * s);
  gl_Position = uViewProj * vec4(p, 1.0);
}`;

const FS_SPARK = `#version 300 es
precision highp float;
in vec2 vUv;
in float vAge;
uniform float uPreExpose;
out vec4 oColor;
void main(){
  float r = length(vUv);
  float a = max(0.0, 1.0 - r);
  float f = 1.0 - vAge;
  vec3 c = mix(vec3(1.0, 0.82, 0.42), vec3(0.85, 0.35, 0.14), vAge);
  oColor = vec4(c * pow(a, 2.4) * f * f * 3.0 * uPreExpose, 1.0);
}`;

const VS_FLASH = `#version 300 es
layout(location=0) in vec2 aCorner;
uniform mat4 uProj;
uniform vec3 uCenter;
uniform float uSize;
out vec2 vUv;
void main(){
  vUv = aCorner;
  gl_Position = uProj * vec4(uCenter + vec3(aCorner * uSize, 0.0), 1.0);
}`;

const FS_FLASH = `#version 300 es
precision highp float;
in vec2 vUv;
uniform float uIntensity;
uniform float uPreExpose;
out vec4 oColor;
void main(){
  float r = length(vUv);
  float core = pow(max(0.0, 1.0 - r), 2.6);
  float bx = pow(max(0.0, 1.0 - abs(vUv.x)) * max(0.0, 1.0 - abs(vUv.y) * 5.5), 3.0);
  float by = pow(max(0.0, 1.0 - abs(vUv.y)) * max(0.0, 1.0 - abs(vUv.x) * 5.5), 3.0);
  float s = core + (bx + by) * 0.55;
  oColor = vec4(vec3(1.0, 0.80, 0.46) * s * uIntensity * 4.0 * uPreExpose, 1.0);
}`;

const VS_VIEWMODEL = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in float aAO;
layout(location=3) in vec3 aTint;
uniform mat4 uProj;
uniform mat4 uModel;
out vec3 vNormal;
out vec3 vTint;
out float vAO;
out vec3 vLocal;
out vec3 vView;
void main(){
  vNormal = mat3(uModel) * aNormal;
  vTint = aTint;
  vAO = aAO;
  vLocal = aPos;
  vec4 cp = uModel * vec4(aPos, 1.0);
  vView = cp.xyz;
  gl_Position = uProj * cp;
}`;

const FS_VIEWMODEL = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vTint;
in float vAO;
in vec3 vLocal;
in vec3 vView;
uniform int uMat;
uniform vec3 uSunCam;
uniform vec3 uSunColor;
uniform vec3 uAmbient;
uniform float uFlash;
uniform vec3 uFlashPos;
uniform float uPreExpose;
uniform float uSpecCap;
out vec4 oColor;
${GLSL_NOISE}
void main(){
  vec3 n = normalize(vNormal);
  vec3 v = normalize(-vView);
  float wear = n2(vLocal.xz * 120.0) * 0.5 + n2(vLocal.yz * 95.0) * 0.5;
  vec3 albedo = vTint * (0.90 + wear * 0.18);
  float specK = uMat == 1 ? 0.42 : 0.09;
  float gloss = uMat == 1 ? 58.0 : 20.0;
  float key = max(dot(n, -uSunCam), 0.0);
  float fill = max(dot(n, normalize(vec3(0.45, 0.55, 0.70))), 0.0);
  vec3 hv = normalize(-uSunCam + v);
  float spec = pow(max(dot(n, hv), 0.0), gloss) * specK;
  spec = spec * uSpecCap / (uSpecCap + spec);
  vec3 col = albedo * (uAmbient * 1.7 * vAO + uSunColor * key * 0.85 + vec3(0.20, 0.24, 0.31) * fill * 0.6) + uSunColor * spec;
  vec3 fd = vView - uFlashPos;
  float fl = uFlash / (1.0 + dot(fd, fd) * 14.0);
  col += albedo * vec3(1.0, 0.74, 0.38) * fl * 3.4;
  float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  col += vec3(0.30, 0.40, 0.50) * rim * 0.14;
  oColor = vec4(col * uPreExpose, 1.0);
}`;

const VS_GHOST = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
uniform mat4 uViewProj;
uniform mat4 uModel;
uniform vec3 uPart;
out vec3 vNormal;
out vec3 vPos;
out float vLocalY;
void main(){
  vec3 lp = vec3(aPos.x * uPart.z, aPos.y * uPart.x + uPart.y, aPos.z * uPart.z);
  vNormal = mat3(uModel) * aNormal;
  vec4 wp = uModel * vec4(lp, 1.0);
  vPos = wp.xyz;
  vLocalY = lp.y;
  gl_Position = uViewProj * wp;
}`;

const FS_GHOST = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vPos;
in float vLocalY;
uniform vec3 uCamPos;
uniform vec3 uMint;
uniform float uTime;
uniform float uAlpha;
uniform float uPreExpose;
out vec4 oColor;
void main(){
  vec3 n = normalize(vNormal);
  vec3 v = normalize(uCamPos - vPos);
  float f = 1.0 - abs(dot(n, v));
  float rim = pow(f, 2.4);
  float edge = smoothstep(0.62, 0.98, f);
  float scan = 0.5 + 0.5 * sin(vLocalY * 52.0 - uTime * 6.0);
  float band = 0.72 + 0.28 * scan;
  float body = (0.22 + 0.70 * rim) * band + edge * 0.68;
  oColor = vec4(uMint * body * uAlpha * uPreExpose, 1.0);
}`;

const VS_TRAIL = `#version 300 es
layout(location=0) in vec2 aCorner;
layout(location=1) in vec3 aIPos;
layout(location=2) in float aIAge;
uniform mat4 uViewProj;
uniform vec3 uRight;
uniform vec3 uUp;
out vec2 vUv;
out float vAge;
void main(){
  vUv = aCorner;
  vAge = aIAge;
  float s = mix(0.155, 0.045, aIAge);
  vec3 p = aIPos + uRight * (aCorner.x * s) + uUp * (aCorner.y * s);
  gl_Position = uViewProj * vec4(p, 1.0);
}`;

const FS_TRAIL = `#version 300 es
precision highp float;
in vec2 vUv;
in float vAge;
uniform vec3 uMint;
uniform float uAlpha;
uniform float uPreExpose;
out vec4 oColor;
void main(){
  float r = length(vUv);
  float a = max(0.0, 1.0 - r);
  float f = 1.0 - vAge;
  oColor = vec4(uMint * pow(a, 2.2) * f * f * 0.95 * uAlpha * uPreExpose, 1.0);
}`;

const FS_BRIGHT = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;
uniform float uThreshold;
uniform float uKnee;
out vec4 oColor;
void main(){
  vec3 c = texture(uScene, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float k = smoothstep(uThreshold, uThreshold + uKnee, l);
  oColor = vec4(c * k, 1.0);
}`;

const FS_BLUR = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
uniform vec2 uStep;
out vec4 oColor;
void main(){
  vec3 c = texture(uSrc, vUv).rgb * 0.2270270;
  vec2 o1 = uStep * 1.3846153;
  vec2 o2 = uStep * 3.2307692;
  c += (texture(uSrc, vUv + o1).rgb + texture(uSrc, vUv - o1).rgb) * 0.3162162;
  c += (texture(uSrc, vUv + o2).rgb + texture(uSrc, vUv - o2).rgb) * 0.0702702;
  oColor = vec4(c, 1.0);
}`;

const FS_COMPOSITE = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uExposure;
uniform float uBloomStrength;
uniform float uGrain;
uniform float uTime;
uniform vec2 uRes;
uniform float uAspect;
uniform float uGlitch;
out vec4 oColor;
${GLSL_NOISE}
vec3 aces(vec3 x){
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
void main(){
  vec2 uv = vUv;
  vec3 c;
#ifdef GLITCH
  float g = clamp(uGlitch, 0.0, 1.0);
  float row = floor(uv.y * uRes.y / 3.0);
  float pick = step(0.74, h11(row * 1.7 + floor(uTime * 13.0)));
  float tear = (h11(row + floor(uTime * 24.0)) - 0.5) * 0.075 * g * pick;
  uv.x = clamp(uv.x + tear, 0.0, 1.0);
  float sp = 0.009 * g;
  c.r = texture(uScene, vec2(clamp(uv.x + sp, 0.0, 1.0), uv.y)).r;
  c.g = texture(uScene, uv).g;
  c.b = texture(uScene, vec2(clamp(uv.x - sp, 0.0, 1.0), uv.y)).b;
  c *= uExposure;
  c += texture(uBloom, uv).rgb * uBloomStrength;
#else
  c = texture(uScene, uv).rgb * uExposure;
  c += texture(uBloom, uv).rgb * uBloomStrength;
#endif
  c = aces(c);
  c = pow(max(c, vec3(0.0)), vec3(0.4545454));
  vec2 vd = (uv - 0.5) * vec2(uAspect, 1.0) * 2.0;
  float vig = 1.0 - smoothstep(0.75, 1.85, length(vd)) * 0.42;
  c *= vig;
  c += (h21(uv * uRes + uTime * 60.0) - 0.5) * uGrain;
#ifdef GLITCH
  float edge = smoothstep(0.30, 1.05, length(vd));
  c += (h21(uv * uRes * 1.7 + uTime * 91.0) - 0.5) * edge * g * 0.75;
  c *= 1.0 - 0.16 * g * step(0.5, fract(uv.y * uRes.y * 0.5));
  c = mix(c, vec3(dot(c, vec3(0.3, 0.6, 0.1))), g * 0.25);
#endif
  oColor = vec4(max(c, vec3(0.0)), 1.0);
}`;

function clamp(v, lo, hi){ return v < lo ? lo : (v > hi ? hi : v); }

function m4Identity(o){
  o[0] = 1; o[1] = 0; o[2] = 0; o[3] = 0;
  o[4] = 0; o[5] = 1; o[6] = 0; o[7] = 0;
  o[8] = 0; o[9] = 0; o[10] = 1; o[11] = 0;
  o[12] = 0; o[13] = 0; o[14] = 0; o[15] = 1;
  return o;
}

function m4Perspective(o, fovy, aspect, near, far){
  const f = 1 / Math.tan(fovy * 0.5);
  const nf = 1 / (near - far);
  o[0] = f / aspect; o[1] = 0; o[2] = 0; o[3] = 0;
  o[4] = 0; o[5] = f; o[6] = 0; o[7] = 0;
  o[8] = 0; o[9] = 0; o[10] = (far + near) * nf; o[11] = -1;
  o[12] = 0; o[13] = 0; o[14] = 2 * far * near * nf; o[15] = 0;
  return o;
}

function m4Ortho(o, l, r, b, t, n, f){
  o[0] = 2 / (r - l); o[1] = 0; o[2] = 0; o[3] = 0;
  o[4] = 0; o[5] = 2 / (t - b); o[6] = 0; o[7] = 0;
  o[8] = 0; o[9] = 0; o[10] = -2 / (f - n); o[11] = 0;
  o[12] = -(r + l) / (r - l); o[13] = -(t + b) / (t - b); o[14] = -(f + n) / (f - n); o[15] = 1;
  return o;
}

function m4LookAt(o, ex, ey, ez, tx, ty, tz, ux, uy, uz){
  let zx = ex - tx, zy = ey - ty, zz = ez - tz;
  let li = 1 / Math.max(Math.sqrt(zx * zx + zy * zy + zz * zz), 1e-6);
  zx *= li; zy *= li; zz *= li;
  let xx = uy * zz - uz * zy, xy = uz * zx - ux * zz, xz = ux * zy - uy * zx;
  li = Math.sqrt(xx * xx + xy * xy + xz * xz);
  if (li < 1e-6){ xx = 1; xy = 0; xz = 0; } else { li = 1 / li; xx *= li; xy *= li; xz *= li; }
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  o[0] = xx; o[1] = yx; o[2] = zx; o[3] = 0;
  o[4] = xy; o[5] = yy; o[6] = zy; o[7] = 0;
  o[8] = xz; o[9] = yz; o[10] = zz; o[11] = 0;
  o[12] = -(xx * ex + xy * ey + xz * ez);
  o[13] = -(yx * ex + yy * ey + yz * ez);
  o[14] = -(zx * ex + zy * ey + zz * ez);
  o[15] = 1;
  return o;
}

function m4Mul(o, a, b){
  for (let c = 0; c < 4; c++){
    const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
    o[c * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    o[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    o[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    o[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  return o;
}

function m4TR(o, px, py, pz, rx, ry, rz){
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);
  o[0] = cy * cz + sy * sx * sz;
  o[1] = cx * sz;
  o[2] = -sy * cz + cy * sx * sz;
  o[3] = 0;
  o[4] = -cy * sz + sy * sx * cz;
  o[5] = cx * cz;
  o[6] = sy * sz + cy * sx * cz;
  o[7] = 0;
  o[8] = sy * cx;
  o[9] = -sx;
  o[10] = cy * cx;
  o[11] = 0;
  o[12] = px; o[13] = py; o[14] = pz; o[15] = 1;
  return o;
}

function m4Point(out, m, x, y, z){
  out[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
  out[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
  out[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  return out;
}

function frustumFrom(planes, m){
  const r00 = m[0], r01 = m[4], r02 = m[8], r03 = m[12];
  const r10 = m[1], r11 = m[5], r12 = m[9], r13 = m[13];
  const r20 = m[2], r21 = m[6], r22 = m[10], r23 = m[14];
  const r30 = m[3], r31 = m[7], r32 = m[11], r33 = m[15];
  planes[0] = r30 + r00; planes[1] = r31 + r01; planes[2] = r32 + r02; planes[3] = r33 + r03;
  planes[4] = r30 - r00; planes[5] = r31 - r01; planes[6] = r32 - r02; planes[7] = r33 - r03;
  planes[8] = r30 + r10; planes[9] = r31 + r11; planes[10] = r32 + r12; planes[11] = r33 + r13;
  planes[12] = r30 - r10; planes[13] = r31 - r11; planes[14] = r32 - r12; planes[15] = r33 - r13;
  planes[16] = r30 + r20; planes[17] = r31 + r21; planes[18] = r32 + r22; planes[19] = r33 + r23;
  planes[20] = r30 - r20; planes[21] = r31 - r21; planes[22] = r32 - r22; planes[23] = r33 - r23;
}

function aabbVisible(planes, mnx, mny, mnz, mxx, mxy, mxz){
  for (let i = 0; i < 24; i += 4){
    const a = planes[i], b = planes[i + 1], c = planes[i + 2], d = planes[i + 3];
    const px = a > 0 ? mxx : mnx;
    const py = b > 0 ? mxy : mny;
    const pz = c > 0 ? mxz : mnz;
    if (a * px + b * py + c * pz + d < 0) return false;
  }
  return true;
}

function sphereVisible(planes, x, y, z, r){
  for (let i = 0; i < 24; i += 4){
    const a = planes[i], b = planes[i + 1], c = planes[i + 2], d = planes[i + 3];
    const len = Math.sqrt(a * a + b * b + c * c) || 1;
    if ((a * x + b * y + c * z + d) / len < -r) return false;
  }
  return true;
}

const PROBE_DIRS = new Float32Array([
  0.76, 0.0, 0.65, -0.76, 0.0, 0.65, 0.0, 0.76, 0.65, 0.0, -0.76, 0.65,
  0.55, 0.55, 0.63, -0.55, 0.55, 0.63, 0.55, -0.55, 0.63, -0.55, -0.55, 0.63
]);
const PROBE_DIST = [0.22, 0.60];
const PROBE_WEIGHT = [0.68, 0.32];

function numOr(v, d){ return typeof v === 'number' && isFinite(v) ? v : d; }

function rgbOr(c, dr, dg, db){
  if (!c || c.length < 3) return [dr, dg, db];
  return [
    Math.max(0, numOr(c[0], dr)),
    Math.max(0, numOr(c[1], dg)),
    Math.max(0, numOr(c[2], db))
  ];
}

function primNormalized(p){
  const mn = p && p.min, mx = p && p.max;
  if (!mn || !mx || mn.length < 3 || mx.length < 3) return null;
  const o = {
    type: p.type === 'ramp' ? 'ramp' : 'box',
    min: [Math.min(mn[0], mx[0]), Math.min(mn[1], mx[1]), Math.min(mn[2], mx[2])],
    max: [Math.max(mn[0], mx[0]), Math.max(mn[1], mx[1]), Math.max(mn[2], mx[2])],
    mat: typeof p.mat === 'string' && MAT_ID[p.mat] !== undefined ? p.mat : 'concrete',
    axis: 0,
    sign: 1,
    emissive: p.emissive && p.emissive.length >= 3 ? p.emissive : null,
    tint: rgbOr(p.tint, 1, 1, 1)
  };
  const d = typeof p.dir === 'string' ? p.dir : '+x';
  o.axis = d.indexOf('z') >= 0 ? 2 : 0;
  o.sign = d.indexOf('-') >= 0 ? -1 : 1;
  if (o.max[0] - o.min[0] < 1e-4) o.max[0] = o.min[0] + 1e-4;
  if (o.max[1] - o.min[1] < 1e-4) o.max[1] = o.min[1] + 1e-4;
  if (o.max[2] - o.min[2] < 1e-4) o.max[2] = o.min[2] + 1e-4;
  return o;
}

function insidePrim(p, x, y, z, eps){
  if (x < p.min[0] + eps || x > p.max[0] - eps) return false;
  if (y < p.min[1] + eps || y > p.max[1] - eps) return false;
  if (z < p.min[2] + eps || z > p.max[2] - eps) return false;
  if (p.type !== 'ramp') return true;
  const a = p.axis;
  const span = p.max[a] - p.min[a];
  const v = a === 0 ? x : z;
  let t = (v - p.min[a]) / span;
  if (p.sign < 0) t = 1 - t;
  return y <= p.min[1] + (p.max[1] - p.min[1]) * t - eps;
}

function buildNeighbors(prims, pad){
  const out = [];
  for (let i = 0; i < prims.length; i++){
    const a = prims[i];
    const list = [];
    for (let j = 0; j < prims.length; j++){
      if (j === i) continue;
      const b = prims[j];
      if (b.max[0] + pad < a.min[0] - pad || b.min[0] - pad > a.max[0] + pad) continue;
      if (b.max[1] + pad < a.min[1] - pad || b.min[1] - pad > a.max[1] + pad) continue;
      if (b.max[2] + pad < a.min[2] - pad || b.min[2] - pad > a.max[2] + pad) continue;
      list.push(b);
    }
    out.push(list);
  }
  return out;
}

function occlusionAt(nbrs, x, y, z, nx, ny, nz){
  if (nbrs.length === 0) return 0;
  let ax = 0, ay = 1, az = 0;
  if (Math.abs(ny) > 0.9){ ax = 1; ay = 0; az = 0; }
  let t1x = ay * nz - az * ny, t1y = az * nx - ax * nz, t1z = ax * ny - ay * nx;
  let li = Math.sqrt(t1x * t1x + t1y * t1y + t1z * t1z);
  if (li < 1e-5){ t1x = 1; t1y = 0; t1z = 0; } else { li = 1 / li; t1x *= li; t1y *= li; t1z *= li; }
  const t2x = ny * t1z - nz * t1y, t2y = nz * t1x - nx * t1z, t2z = nx * t1y - ny * t1x;
  let occ = 0, wsum = 0;
  for (let p = 0; p < 8; p++){
    const a = PROBE_DIRS[p * 3], b = PROBE_DIRS[p * 3 + 1], c = PROBE_DIRS[p * 3 + 2];
    const dx = t1x * a + t2x * b + nx * c;
    const dy = t1y * a + t2y * b + ny * c;
    const dz = t1z * a + t2z * b + nz * c;
    for (let s = 0; s < 2; s++){
      const dist = PROBE_DIST[s];
      const wt = PROBE_WEIGHT[s];
      wsum += wt;
      const sx = x + dx * dist, sy = y + dy * dist, sz = z + dz * dist;
      for (let k = 0; k < nbrs.length; k++){
        if (insidePrim(nbrs[k], sx, sy, sz, 0.004)){ occ += wt; break; }
      }
    }
  }
  return wsum > 0 ? occ / wsum : 0;
}

function aoValue(nbrs, x, y, z, nx, ny, nz, borderDist){
  const occ = occlusionAt(nbrs, x, y, z, nx, ny, nz);
  let ao = 1 - occ * 0.78;
  const edge = 0.86 + 0.14 * Math.min(1, borderDist / 0.30);
  ao *= edge;
  return clamp(ao, 0.16, 1);
}

function newMesh(){ return { v: [], i: [] }; }

function pushVert(m, x, y, z, nx, ny, nz, ao, tr, tg, tb, td, bd){
  m.v.push(x, y, z, nx, ny, nz, ao, tr, tg, tb, td, bd);
}

function pushQuadGrid(m, ax, ay, az, e1x, e1y, e1z, e2x, e2y, e2z, nx, ny, nz, tr, tg, tb, nbrs){
  let cx = e1y * e2z - e1z * e2y, cy = e1z * e2x - e1x * e2z, cz = e1x * e2y - e1y * e2x;
  if (cx * nx + cy * ny + cz * nz < 0){
    const sx = e1x, sy = e1y, sz = e1z;
    e1x = e2x; e1y = e2y; e1z = e2z;
    e2x = sx; e2y = sy; e2z = sz;
  }
  const w = Math.sqrt(e1x * e1x + e1y * e1y + e1z * e1z);
  const h = Math.sqrt(e2x * e2x + e2y * e2y + e2z * e2z);
  const nu = clamp(Math.round(w / TESS_TARGET), 1, TESS_MAX);
  const nv = clamp(Math.round(h / TESS_TARGET), 1, TESS_MAX);
  const topY = ay + Math.max(0, e1y) + Math.max(0, e2y);
  const base = m.v.length / VSTRIDE;
  for (let j = 0; j <= nv; j++){
    const fv = j / nv;
    for (let i = 0; i <= nu; i++){
      const fu = i / nu;
      const x = ax + e1x * fu + e2x * fv;
      const y = ay + e1y * fu + e2y * fv;
      const z = az + e1z * fu + e2z * fv;
      const bd = Math.min(fu * w, (1 - fu) * w, fv * h, (1 - fv) * h);
      pushVert(m, x, y, z, nx, ny, nz, aoValue(nbrs, x, y, z, nx, ny, nz, bd), tr, tg, tb,
        clamp(topY - y, 0, 8), clamp(bd / 0.35, 0, 1));
    }
  }
  const row = nu + 1;
  for (let j = 0; j < nv; j++){
    for (let i = 0; i < nu; i++){
      const v00 = base + j * row + i;
      const v10 = v00 + 1;
      const v01 = v00 + row;
      const v11 = v01 + 1;
      m.i.push(v00, v10, v11, v00, v11, v01);
    }
  }
}

function pushTri(m, ax, ay, az, bx, by, bz, cx, cy, cz, nx, ny, nz, tr, tg, tb, nbrs){
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const vx = cx - ax, vy = cy - ay, vz = cz - az;
  const kx = uy * vz - uz * vy, ky = uz * vx - ux * vz, kz = ux * vy - uy * vx;
  let p1x = bx, p1y = by, p1z = bz, p2x = cx, p2y = cy, p2z = cz;
  if (kx * nx + ky * ny + kz * nz < 0){
    p1x = cx; p1y = cy; p1z = cz;
    p2x = bx; p2y = by; p2z = bz;
  }
  const topY = Math.max(ay, Math.max(p1y, p2y));
  const base = m.v.length / VSTRIDE;
  pushVert(m, ax, ay, az, nx, ny, nz, aoValue(nbrs, ax, ay, az, nx, ny, nz, 0.02), tr, tg, tb, clamp(topY - ay, 0, 8), 1);
  pushVert(m, p1x, p1y, p1z, nx, ny, nz, aoValue(nbrs, p1x, p1y, p1z, nx, ny, nz, 0.02), tr, tg, tb, clamp(topY - p1y, 0, 8), 1);
  pushVert(m, p2x, p2y, p2z, nx, ny, nz, aoValue(nbrs, p2x, p2y, p2z, nx, ny, nz, 0.02), tr, tg, tb, clamp(topY - p2y, 0, 8), 1);
  m.i.push(base, base + 1, base + 2);
}

function pushFlatQuad(m, ax, ay, az, e1x, e1y, e1z, e2x, e2y, e2z, nx, ny, nz, ao, tr, tg, tb){
  let cx = e1y * e2z - e1z * e2y, cy = e1z * e2x - e1x * e2z, cz = e1x * e2y - e1y * e2x;
  if (cx * nx + cy * ny + cz * nz < 0){
    const sx = e1x, sy = e1y, sz = e1z;
    e1x = e2x; e1y = e2y; e1z = e2z;
    e2x = sx; e2y = sy; e2z = sz;
  }
  const base = m.v.length / VSTRIDE;
  pushVert(m, ax, ay, az, nx, ny, nz, ao, tr, tg, tb, 0, 1);
  pushVert(m, ax + e1x, ay + e1y, az + e1z, nx, ny, nz, ao, tr, tg, tb, 0, 1);
  pushVert(m, ax + e2x, ay + e2y, az + e2z, nx, ny, nz, ao, tr, tg, tb, 0, 1);
  pushVert(m, ax + e1x + e2x, ay + e1y + e2y, az + e1z + e2z, nx, ny, nz, ao, tr, tg, tb, 0, 1);
  m.i.push(base, base + 1, base + 3, base, base + 3, base + 2);
}

function pushPlainBox(m, x0, y0, z0, x1, y1, z1, tr, tg, tb){
  const w = x1 - x0, h = y1 - y0, d = z1 - z0;
  pushFlatQuad(m, x1, y0, z0, 0, h, 0, 0, 0, d, 1, 0, 0, 0.74, tr, tg, tb);
  pushFlatQuad(m, x0, y0, z0, 0, h, 0, 0, 0, d, -1, 0, 0, 0.70, tr, tg, tb);
  pushFlatQuad(m, x0, y1, z0, w, 0, 0, 0, 0, d, 0, 1, 0, 0.94, tr, tg, tb);
  pushFlatQuad(m, x0, y0, z0, w, 0, 0, 0, 0, d, 0, -1, 0, 0.46, tr, tg, tb);
  pushFlatQuad(m, x0, y0, z1, w, 0, 0, 0, h, 0, 0, 0, 1, 0.74, tr, tg, tb);
  pushFlatQuad(m, x0, y0, z0, w, 0, 0, 0, h, 0, 0, 0, -1, 0.70, tr, tg, tb);
}

function stripNormalized(s){
  const a = s && s.from, b = s && s.to;
  if (!a || !b || a.length < 3 || b.length < 3) return null;
  const ax = numOr(a[0], 0), ay = numOr(a[1], 0), az = numOr(a[2], 0);
  const bx = numOr(b[0], 0), by = numOr(b[1], 0), bz = numOr(b[2], 0);
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1e-4) return null;
  const c = rgbOr(s.color, MINT[0], MINT[1], MINT[2]);
  const wid = typeof s.width === 'number' && s.width > 0.004 && isFinite(s.width) ? Math.min(s.width, 1.5) : STRIP_WIDTH;
  return { ax: ax, ay: ay, az: az, dx: dx, dy: dy, dz: dz, len: len, r: c[0], g: c[1], b: c[2], w: wid };
}

function emitStrip(m, s){
  const ux = s.dx / s.len, uy = s.dy / s.len, uz = s.dz / s.len;
  let sx, sy, sz, nx, ny, nz;
  if (Math.abs(uy) < 0.7){
    nx = 0; ny = 1; nz = 0;
    sx = ny * uz - nz * uy; sy = nz * ux - nx * uz; sz = nx * uy - ny * ux;
  } else {
    const rx = Math.abs(uz) < 0.9 ? 0 : 1;
    const rz = Math.abs(uz) < 0.9 ? 1 : 0;
    sx = uy * rz - uz * 0; sy = uz * rx - ux * rz; sz = ux * 0 - uy * rx;
    nx = sy * uz - sz * uy; ny = sz * ux - sx * uz; nz = sx * uy - sy * ux;
  }
  let sl = Math.sqrt(sx * sx + sy * sy + sz * sz);
  if (sl < 1e-5) return;
  sl = 1 / sl;
  sx *= sl; sy *= sl; sz *= sl;
  let nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (nl < 1e-5) return;
  nl = 1 / nl;
  nx *= nl; ny *= nl; nz *= nl;
  const hw = s.w * 0.5;
  const ox = s.ax - sx * hw, oy = s.ay - sy * hw, oz = s.az - sz * hw;
  const tr = s.r * 1.35, tg = s.g * 1.35, tb = s.b * 1.35;
  pushFlatQuad(m, ox, oy, oz, s.dx, s.dy, s.dz, sx * s.w, sy * s.w, sz * s.w, nx, ny, nz, 1, tr, tg, tb);
  pushFlatQuad(m, ox, oy, oz, s.dx, s.dy, s.dz, sx * s.w, sy * s.w, sz * s.w, -nx, -ny, -nz, 1, tr, tg, tb);
}

function emitLampLens(m, x, y, z, cr, cg, cb){
  pushPlainBox(m, x - 0.105, y - 0.030, z - 0.050, x + 0.105, y + 0.030, z + 0.050, cr * 1.25, cg * 1.25, cb * 1.25);
}

function emitLampBody(m, x, y, z){
  const g = 0.82;
  pushPlainBox(m, x - 0.128, y + 0.030, z - 0.064, x + 0.128, y + 0.076, z + 0.064, g, g, g);
  pushPlainBox(m, x - 0.018, y + 0.076, z - 0.018, x + 0.018, y + 0.146, z + 0.018, g * 0.9, g * 0.9, g * 0.9);
  pushPlainBox(m, x - 0.128, y - 0.040, z - 0.064, x - 0.110, y + 0.030, z + 0.064, g * 0.8, g * 0.8, g * 0.8);
  pushPlainBox(m, x + 0.110, y - 0.040, z - 0.064, x + 0.128, y + 0.030, z + 0.064, g * 0.8, g * 0.8, g * 0.8);
}

function emitBoxFace(m, p, face, tr, tg, tb, nbrs){
  const x0 = p.min[0], y0 = p.min[1], z0 = p.min[2];
  const x1 = p.max[0], y1 = p.max[1], z1 = p.max[2];
  const w = x1 - x0, h = y1 - y0, d = z1 - z0;
  if (face === 0) pushQuadGrid(m, x1, y0, z0, 0, h, 0, 0, 0, d, 1, 0, 0, tr, tg, tb, nbrs);
  else if (face === 1) pushQuadGrid(m, x0, y0, z0, 0, h, 0, 0, 0, d, -1, 0, 0, tr, tg, tb, nbrs);
  else if (face === 2) pushQuadGrid(m, x0, y1, z0, w, 0, 0, 0, 0, d, 0, 1, 0, tr, tg, tb, nbrs);
  else if (face === 3) pushQuadGrid(m, x0, y0, z0, w, 0, 0, 0, 0, d, 0, -1, 0, tr, tg, tb, nbrs);
  else if (face === 4) pushQuadGrid(m, x0, y0, z1, w, 0, 0, 0, h, 0, 0, 0, 1, tr, tg, tb, nbrs);
  else pushQuadGrid(m, x0, y0, z0, w, 0, 0, 0, h, 0, 0, 0, -1, tr, tg, tb, nbrs);
}

function emitPrim(m, p, tr, tg, tb, nbrs){
  if (p.type !== 'ramp'){
    for (let f = 0; f < 6; f++) emitBoxFace(m, p, f, tr, tg, tb, nbrs);
    return;
  }
  const x0 = p.min[0], y0 = p.min[1], z0 = p.min[2];
  const x1 = p.max[0], y1 = p.max[1], z1 = p.max[2];
  const w = x1 - x0, h = y1 - y0, d = z1 - z0;
  emitBoxFace(m, p, 3, tr, tg, tb, nbrs);
  if (p.axis === 0){
    if (p.sign > 0){
      emitBoxFace(m, p, 0, tr, tg, tb, nbrs);
      let nl = Math.sqrt(h * h + w * w);
      pushQuadGrid(m, x0, y0, z0, 0, 0, d, w, h, 0, -h / nl, w / nl, 0, tr, tg, tb, nbrs);
      pushTri(m, x0, y0, z1, x1, y0, z1, x1, y1, z1, 0, 0, 1, tr, tg, tb, nbrs);
      pushTri(m, x0, y0, z0, x1, y0, z0, x1, y1, z0, 0, 0, -1, tr, tg, tb, nbrs);
    } else {
      emitBoxFace(m, p, 1, tr, tg, tb, nbrs);
      let nl = Math.sqrt(h * h + w * w);
      pushQuadGrid(m, x0, y1, z0, 0, 0, d, w, -h, 0, h / nl, w / nl, 0, tr, tg, tb, nbrs);
      pushTri(m, x1, y0, z1, x0, y0, z1, x0, y1, z1, 0, 0, 1, tr, tg, tb, nbrs);
      pushTri(m, x1, y0, z0, x0, y0, z0, x0, y1, z0, 0, 0, -1, tr, tg, tb, nbrs);
    }
  } else {
    if (p.sign > 0){
      emitBoxFace(m, p, 4, tr, tg, tb, nbrs);
      let nl = Math.sqrt(h * h + d * d);
      pushQuadGrid(m, x0, y0, z0, 0, h, d, w, 0, 0, 0, d / nl, -h / nl, tr, tg, tb, nbrs);
      pushTri(m, x1, y0, z0, x1, y0, z1, x1, y1, z1, 1, 0, 0, tr, tg, tb, nbrs);
      pushTri(m, x0, y0, z0, x0, y0, z1, x0, y1, z1, -1, 0, 0, tr, tg, tb, nbrs);
    } else {
      emitBoxFace(m, p, 5, tr, tg, tb, nbrs);
      let nl = Math.sqrt(h * h + d * d);
      pushQuadGrid(m, x0, y1, z0, 0, -h, d, w, 0, 0, 0, d / nl, h / nl, tr, tg, tb, nbrs);
      pushTri(m, x1, y0, z1, x1, y0, z0, x1, y1, z0, 1, 0, 0, tr, tg, tb, nbrs);
      pushTri(m, x0, y0, z1, x0, y0, z0, x0, y1, z0, -1, 0, 0, tr, tg, tb, nbrs);
    }
  }
}

function vmAO(ny, ay, lo, hi){
  const t = hi > lo ? (ay - lo) / (hi - lo) : 0.5;
  return clamp(0.42 + 0.34 * (0.5 + 0.5 * ny) + 0.24 * clamp(t, 0, 1), 0.2, 1);
}

function vmQuad(m, ax, ay, az, e1x, e1y, e1z, e2x, e2y, e2z, nx, ny, nz, tr, tg, tb, lo, hi){
  let cx = e1y * e2z - e1z * e2y, cy = e1z * e2x - e1x * e2z, cz = e1x * e2y - e1y * e2x;
  if (cx * nx + cy * ny + cz * nz < 0){
    const sx = e1x, sy = e1y, sz = e1z;
    e1x = e2x; e1y = e2y; e1z = e2z;
    e2x = sx; e2y = sy; e2z = sz;
  }
  const base = m.v.length / VSTRIDE;
  for (let j = 0; j < 2; j++){
    for (let i = 0; i < 2; i++){
      const x = ax + e1x * i + e2x * j;
      const y = ay + e1y * i + e2y * j;
      const z = az + e1z * i + e2z * j;
      pushVert(m, x, y, z, nx, ny, nz, vmAO(ny, y, lo, hi), tr, tg, tb, 0, 1);
    }
  }
  m.i.push(base, base + 1, base + 3, base, base + 3, base + 2);
}

function vmBox(m, x0, y0, z0, x1, y1, z1, tr, tg, tb){
  const w = x1 - x0, h = y1 - y0, d = z1 - z0;
  vmQuad(m, x1, y0, z0, 0, h, 0, 0, 0, d, 1, 0, 0, tr, tg, tb, y0, y1);
  vmQuad(m, x0, y0, z0, 0, h, 0, 0, 0, d, -1, 0, 0, tr, tg, tb, y0, y1);
  vmQuad(m, x0, y1, z0, w, 0, 0, 0, 0, d, 0, 1, 0, tr, tg, tb, y0, y1);
  vmQuad(m, x0, y0, z0, w, 0, 0, 0, 0, d, 0, -1, 0, tr, tg, tb, y0, y1);
  vmQuad(m, x0, y0, z1, w, 0, 0, 0, h, 0, 0, 0, 1, tr, tg, tb, y0, y1);
  vmQuad(m, x0, y0, z0, w, 0, 0, 0, h, 0, 0, 0, -1, tr, tg, tb, y0, y1);
}

function vmCyl(m, cx, cy, za, zb, r, segs, tr, tg, tb){
  const base = m.v.length / VSTRIDE;
  for (let i = 0; i <= segs; i++){
    const a = (i / segs) * Math.PI * 2;
    const nx = Math.cos(a), ny = Math.sin(a);
    const px = cx + nx * r, py = cy + ny * r;
    pushVert(m, px, py, za, nx, ny, 0, vmAO(ny, py, cy - r, cy + r), tr, tg, tb, 0, 1);
    pushVert(m, px, py, zb, nx, ny, 0, vmAO(ny, py, cy - r, cy + r), tr, tg, tb, 0, 1);
  }
  for (let i = 0; i < segs; i++){
    const a0 = base + i * 2, a1 = a0 + 1, b0 = a0 + 2, b1 = a0 + 3;
    m.i.push(a0, b0, b1, a0, b1, a1);
  }
  for (let s = 0; s < 2; s++){
    const z = s === 0 ? zb : za;
    const nz = s === 0 ? 1 : -1;
    const c = m.v.length / VSTRIDE;
    pushVert(m, cx, cy, z, 0, 0, nz, 0.72, tr, tg, tb, 0, 1);
    for (let i = 0; i <= segs; i++){
      const a = (i / segs) * Math.PI * 2;
      pushVert(m, cx + Math.cos(a) * r, cy + Math.sin(a) * r, z, 0, 0, nz, 0.66, tr, tg, tb, 0, 1);
    }
    for (let i = 0; i < segs; i++){
      if (nz > 0) m.i.push(c, c + 1 + i, c + 2 + i);
      else m.i.push(c, c + 2 + i, c + 1 + i);
    }
  }
}

function rotateRangeX(m, fromVert, angle, pivotY, pivotZ){
  const c = Math.cos(angle), s = Math.sin(angle);
  for (let i = fromVert; i < m.v.length / VSTRIDE; i++){
    const o = i * VSTRIDE;
    const y = m.v[o + 1] - pivotY, z = m.v[o + 2] - pivotZ;
    m.v[o + 1] = pivotY + y * c - z * s;
    m.v[o + 2] = pivotZ + y * s + z * c;
    const ny = m.v[o + 4], nz = m.v[o + 5];
    m.v[o + 4] = ny * c - nz * s;
    m.v[o + 5] = ny * s + nz * c;
  }
}

function buildViewmodel(){
  const m = newMesh();
  const parts = [];
  const gunMetal = [0.115, 0.120, 0.130];
  const polymer = [0.145, 0.150, 0.152];
  const dark = [0.075, 0.078, 0.082];
  function begin(){ return m.i.length; }
  function end(start, mat, dyn){ parts.push({ start: start, count: m.i.length - start, mat: mat, dyn: dyn ? 1 : 0 }); }

  let s = begin();
  vmBox(m, -0.029, -0.030, -0.205, 0.029, 0.041, 0.165, gunMetal[0], gunMetal[1], gunMetal[2]);
  vmBox(m, -0.031, 0.041, -0.115, 0.031, 0.053, 0.105, dark[0], dark[1], dark[2]);
  end(s, 1, false);

  s = begin();
  vmBox(m, -0.025, -0.024, -0.425, 0.025, 0.022, -0.205, polymer[0], polymer[1], polymer[2]);
  vmBox(m, -0.026, 0.022, -0.400, 0.026, 0.031, -0.230, dark[0], dark[1], dark[2]);
  end(s, 2, false);

  s = begin();
  vmCyl(m, 0.0, 0.004, -0.620, -0.400, 0.0115, 10, gunMetal[0] * 0.9, gunMetal[1] * 0.9, gunMetal[2] * 0.95);
  vmCyl(m, 0.0, 0.004, -0.672, -0.620, 0.0180, 10, dark[0], dark[1], dark[2]);
  end(s, 1, false);

  s = begin();
  vmBox(m, -0.004, 0.053, -0.412, 0.004, 0.092, -0.396, dark[0], dark[1], dark[2]);
  vmBox(m, -0.014, 0.053, 0.020, -0.008, 0.086, 0.036, dark[0], dark[1], dark[2]);
  vmBox(m, 0.008, 0.053, 0.020, 0.014, 0.086, 0.036, dark[0], dark[1], dark[2]);
  end(s, 1, false);

  s = begin();
  let v0 = m.v.length / VSTRIDE;
  vmBox(m, -0.021, -0.150, 0.010, 0.021, -0.026, 0.098, polymer[0] * 0.9, polymer[1] * 0.9, polymer[2] * 0.9);
  rotateRangeX(m, v0, -0.30, -0.026, 0.055);
  end(s, 2, false);

  s = begin();
  vmBox(m, -0.024, -0.008, 0.165, 0.024, 0.044, 0.238, polymer[0], polymer[1], polymer[2]);
  vmBox(m, -0.031, -0.020, 0.238, 0.031, 0.058, 0.300, polymer[0] * 0.95, polymer[1] * 0.95, polymer[2] * 0.95);
  end(s, 2, false);

  s = begin();
  v0 = m.v.length / VSTRIDE;
  vmBox(m, -0.020, -0.168, -0.108, 0.020, -0.028, -0.010, dark[0] * 1.15, dark[1] * 1.15, dark[2] * 1.15);
  rotateRangeX(m, v0, 0.14, -0.028, -0.060);
  end(s, 2, true);

  return {
    verts: new Float32Array(m.v),
    idx: new Uint32Array(m.i),
    parts: parts,
    muzzle: [0, 0.004, -0.678]
  };
}

function ghostCapsule(m, cx, cz, y0, y1, r, segs, rings){
  const base = m.v.length / 6;
  for (let j = 0; j <= rings; j++){
    const a = -Math.PI * 0.5 + (j / rings) * Math.PI;
    const ca = Math.cos(a), sa = Math.sin(a);
    const cy = j * 2 < rings ? y0 : y1;
    for (let i = 0; i <= segs; i++){
      const t = (i / segs) * Math.PI * 2;
      const nx = Math.cos(t) * ca, nz = Math.sin(t) * ca;
      m.v.push(cx + nx * r, cy + sa * r, cz + nz * r, nx, sa, nz);
    }
  }
  const row = segs + 1;
  for (let j = 0; j < rings; j++){
    for (let i = 0; i < segs; i++){
      const v00 = base + j * row + i;
      const v10 = v00 + 1;
      const v01 = v00 + row;
      const v11 = v01 + 1;
      m.i.push(v00, v01, v11, v00, v11, v10);
    }
  }
}

function buildGhost(){
  const m = { v: [], i: [] };
  const parts = [];
  let s = m.i.length;
  ghostCapsule(m, -0.095, 0, 0.20, 0.62, 0.098, 9, 6);
  ghostCapsule(m, 0.095, 0, 0.20, 0.62, 0.098, 9, 6);
  parts.push({ start: s, count: m.i.length - s, tuck: 1 });
  s = m.i.length;
  ghostCapsule(m, 0, 0, 0.95, 1.36, 0.195, 11, 7);
  ghostCapsule(m, -0.245, 0, 1.03, 1.30, 0.058, 7, 5);
  ghostCapsule(m, 0.245, 0, 1.03, 1.30, 0.058, 7, 5);
  parts.push({ start: s, count: m.i.length - s, tuck: 0 });
  s = m.i.length;
  ghostCapsule(m, 0, 0, 1.655, 1.665, 0.118, 11, 8);
  parts.push({ start: s, count: m.i.length - s, tuck: 0 });
  return { verts: new Float32Array(m.v), idx: new Uint32Array(m.i), parts: parts };
}

function makeProgram(gl, vsSrc, fsSrc){
  const vs = gl.createShader(gl.VERTEX_SHADER);
  gl.shaderSource(vs, vsSrc);
  gl.compileShader(vs);
  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(fs, fsSrc);
  gl.compileShader(fs);
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  const ok = gl.getProgramParameter(p, gl.LINK_STATUS);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!ok){
    const log = gl.getProgramInfoLog(p) || '';
    gl.deleteProgram(p);
    throw 'phosphor renderer: shader link failed ' + log;
  }
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++){
    const info = gl.getActiveUniform(p, i);
    if (!info) continue;
    let name = info.name;
    const br = name.indexOf('[');
    if (br >= 0) name = name.slice(0, br);
    u[name] = gl.getUniformLocation(p, info.name);
  }
  return { p: p, u: u };
}

export function createRenderer(canvas){
  if (!canvas || typeof canvas.getContext !== 'function') throw 'phosphor renderer: no canvas';
  let gl = canvas.getContext('webgl2', {
    alpha: false,
    depth: true,
    stencil: false,
    antialias: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
    failIfMajorPerformanceCaveat: false
  });
  if (!gl) throw 'phosphor renderer: WebGL2 unavailable';

  const lostCbs = [];
  const restoredCbs = [];
  let contextLost = false;
  let worldDef = null;
  let world = null;
  let vm = buildViewmodel();
  let gm = buildGhost();

  const P = {};
  const GLB = {
    staticVAO: null, staticVBO: null, staticIBO: null,
    vmVAO: null, vmVBO: null, vmIBO: null,
    quadVBO: null, quadVAO: null, sparkVAO: null, sparkVBO: null,
    tracerVAO: null, tracerVBO: null, tracerIBO: null,
    ghostVAO: null, ghostVBO: null, ghostIBO: null,
    trailVAO: null, trailVBO: null,
    emptyVAO: null,
    shadowFB: null, shadowTex: null,
    scene: null, bloomA: null, bloomB: null,
    sceneW: 0, sceneH: 0, bloomW: 0, bloomH: 0
  };
  let hdr = false;

  const mProj = new Float32Array(16);
  const mView = new Float32Array(16);
  const mVP = new Float32Array(16);
  const mLightView = new Float32Array(16);
  const mLightProj = new Float32Array(16);
  const mLightVP = new Float32Array(16);
  const mShadow = new Float32Array(16);
  const mBias = new Float32Array([0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0.5, 0, 0.5, 0.5, 0.5, 1]);
  const mGunProj = new Float32Array(16);
  const mGun = new Float32Array(16);
  const mMagLocal = new Float32Array(16);
  const mMag = new Float32Array(16);
  const mTmpA = new Float32Array(16);
  const planes = new Float32Array(24);
  const tmp3 = new Float32Array(3);
  const tmp3b = new Float32Array(3);
  const sunCam = new Float32Array(3);
  const tracerData = new Float32Array(MAX_TRACERS * 4 * 5);
  const sparkData = new Float32Array(MAX_SPARKS * 4);
  const trailData = new Float32Array(TRAIL_MAX * 4);
  const trailHist = new Float32Array(TRAIL_MAX * 4);
  const mGhost = new Float32Array(16);
  const QUAD = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);

  let trailHead = -1;
  let trailCount = 0;
  let time = 0;
  let qScale = 1;
  let drawW = 1;
  let drawH = 1;
  let lastClientW = -1;
  let lastClientH = -1;
  let sizeDirty = true;

  function s1i(pr, n, v){ const l = pr.u[n]; if (l) gl.uniform1i(l, v); }
  function s1f(pr, n, v){ const l = pr.u[n]; if (l) gl.uniform1f(l, v); }
  function s2f(pr, n, a, b){ const l = pr.u[n]; if (l) gl.uniform2f(l, a, b); }
  function s3f(pr, n, a, b, c){ const l = pr.u[n]; if (l) gl.uniform3f(l, a, b, c); }
  function s3v(pr, n, v){ const l = pr.u[n]; if (l) gl.uniform3fv(l, v); }
  function s4f(pr, n, a, b, c, d){ const l = pr.u[n]; if (l) gl.uniform4f(l, a, b, c, d); }
  function s1fv(pr, n, v){ const l = pr.u[n]; if (l) gl.uniform1fv(l, v); }
  function sm4(pr, n, v){ const l = pr.u[n]; if (l) gl.uniformMatrix4fv(l, false, v); }

  function meshVAO(vbo, ibo){
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, VBYTES, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, VBYTES, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, VBYTES, 24);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 3, gl.FLOAT, false, VBYTES, 28);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 2, gl.FLOAT, false, VBYTES, 40);
    gl.bindVertexArray(null);
    return vao;
  }

  function makeTarget(w, h, float, depth){
    const t = { fb: gl.createFramebuffer(), tex: gl.createTexture(), depth: null, w: w, h: h };
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    if (float && hdr) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
    if (depth){
      t.depth = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, t.depth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, t.depth);
      gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return t;
  }

  function dropTarget(t){
    if (!t) return;
    if (t.depth) gl.deleteRenderbuffer(t.depth);
    if (t.tex) gl.deleteTexture(t.tex);
    if (t.fb) gl.deleteFramebuffer(t.fb);
  }

  function initGL(){
    hdr = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
    P.world = makeProgram(gl, VS_WORLD, FS_WORLD);
    P.shadow = makeProgram(gl, VS_SHADOW, FS_SHADOW);
    P.sky = makeProgram(gl, VS_SKY, FS_SKY);
    P.target = makeProgram(gl, VS_TARGET, FS_TARGET);
    P.tracer = makeProgram(gl, VS_TRACER, FS_TRACER);
    P.spark = makeProgram(gl, VS_SPARK, FS_SPARK);
    P.flash = makeProgram(gl, VS_FLASH, FS_FLASH);
    P.viewmodel = makeProgram(gl, VS_VIEWMODEL, FS_VIEWMODEL);
    P.ghost = makeProgram(gl, VS_GHOST, FS_GHOST);
    P.trail = makeProgram(gl, VS_TRAIL, FS_TRAIL);
    P.bright = makeProgram(gl, VS_FULL, FS_BRIGHT);
    P.blur = makeProgram(gl, VS_FULL, FS_BLUR);
    P.composite = makeProgram(gl, VS_FULL, FS_COMPOSITE);
    P.glitch = makeProgram(gl, VS_FULL, '#version 300 es\n#define GLITCH 1\n' + FS_COMPOSITE.slice(FS_COMPOSITE.indexOf('\n') + 1));

    GLB.emptyVAO = gl.createVertexArray();

    GLB.quadVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, GLB.quadVBO);
    gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW);

    GLB.quadVAO = gl.createVertexArray();
    gl.bindVertexArray(GLB.quadVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, GLB.quadVBO);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    gl.bindVertexArray(null);

    GLB.sparkVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, GLB.sparkVBO);
    gl.bufferData(gl.ARRAY_BUFFER, sparkData.byteLength, gl.DYNAMIC_DRAW);
    GLB.sparkVAO = gl.createVertexArray();
    gl.bindVertexArray(GLB.sparkVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, GLB.quadVBO);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, GLB.sparkVBO);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 16, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 16, 12);
    gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);

    GLB.tracerVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, GLB.tracerVBO);
    gl.bufferData(gl.ARRAY_BUFFER, tracerData.byteLength, gl.DYNAMIC_DRAW);
    const tidx = new Uint32Array(MAX_TRACERS * 6);
    for (let i = 0; i < MAX_TRACERS; i++){
      const b = i * 4;
      tidx[i * 6] = b; tidx[i * 6 + 1] = b + 1; tidx[i * 6 + 2] = b + 2;
      tidx[i * 6 + 3] = b; tidx[i * 6 + 4] = b + 2; tidx[i * 6 + 5] = b + 3;
    }
    GLB.tracerIBO = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, GLB.tracerIBO);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, tidx, gl.STATIC_DRAW);
    GLB.tracerVAO = gl.createVertexArray();
    gl.bindVertexArray(GLB.tracerVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, GLB.tracerVBO);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, GLB.tracerIBO);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 20, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 20, 16);
    gl.bindVertexArray(null);

    GLB.trailVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, GLB.trailVBO);
    gl.bufferData(gl.ARRAY_BUFFER, trailData.byteLength, gl.DYNAMIC_DRAW);
    GLB.trailVAO = gl.createVertexArray();
    gl.bindVertexArray(GLB.trailVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, GLB.quadVBO);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, GLB.trailVBO);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 16, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 16, 12);
    gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);

    GLB.ghostVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, GLB.ghostVBO);
    gl.bufferData(gl.ARRAY_BUFFER, gm.verts, gl.STATIC_DRAW);
    GLB.ghostIBO = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, GLB.ghostIBO);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, gm.idx, gl.STATIC_DRAW);
    GLB.ghostVAO = gl.createVertexArray();
    gl.bindVertexArray(GLB.ghostVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, GLB.ghostVBO);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, GLB.ghostIBO);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    gl.bindVertexArray(null);

    GLB.vmVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, GLB.vmVBO);
    gl.bufferData(gl.ARRAY_BUFFER, vm.verts, gl.STATIC_DRAW);
    GLB.vmIBO = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, GLB.vmIBO);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, vm.idx, gl.STATIC_DRAW);
    GLB.vmVAO = meshVAO(GLB.vmVBO, GLB.vmIBO);

    GLB.shadowTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, GLB.shadowTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, SHADOW_SIZE, SHADOW_SIZE, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    GLB.shadowFB = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, GLB.shadowFB);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, GLB.shadowTex, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.clearDepth(1);
    gl.depthFunc(gl.LEQUAL);
    gl.frontFace(gl.CCW);
    gl.cullFace(gl.BACK);
    gl.disable(gl.DITHER);
    sizeDirty = true;
  }

  function onLost(e){
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    contextLost = true;
    for (let i = 0; i < lostCbs.length; i++) lostCbs[i]();
  }

  function onRestored(){
    contextLost = false;
    GLB.sceneW = 0;
    GLB.sceneH = 0;
    GLB.scene = null;
    GLB.bloomA = null;
    GLB.bloomB = null;
    GLB.staticVAO = null;
    GLB.staticVBO = null;
    GLB.staticIBO = null;
    initGL();
    const def = worldDef;
    world = null;
    if (def) compileWorld(def);
    resize();
    for (let i = 0; i < restoredCbs.length; i++) restoredCbs[i]();
  }

  canvas.addEventListener('webglcontextlost', onLost, false);
  canvas.addEventListener('webglcontextrestored', onRestored, false);
  initGL();

  function hash01(i){
    const x = Math.sin(i * 12.9898 + 4.1414) * 43758.5453;
    return x - Math.floor(x);
  }

  function releaseStatic(){
    if (GLB.staticVAO){ gl.deleteVertexArray(GLB.staticVAO); GLB.staticVAO = null; }
    if (GLB.staticVBO){ gl.deleteBuffer(GLB.staticVBO); GLB.staticVBO = null; }
    if (GLB.staticIBO){ gl.deleteBuffer(GLB.staticIBO); GLB.staticIBO = null; }
  }

  function chunkLights(lights, mnx, mny, mnz, mxx, mxy, mxz){
    const sel = [];
    for (let li = 0; li < lights.length; li++){
      const l = lights[li];
      const qx = l.x < mnx ? mnx : (l.x > mxx ? mxx : l.x);
      const qy = l.y < mny ? mny : (l.y > mxy ? mxy : l.y);
      const qz = l.z < mnz ? mnz : (l.z > mxz ? mxz : l.z);
      const dx = l.x - qx, dy = l.y - qy, dz = l.z - qz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < l.radius * l.radius) sel.push({ i: li, d: d2 });
    }
    sel.sort(function(a, b){ return a.d - b.d; });
    const n = Math.min(sel.length, CHUNK_LIGHTS);
    const lp = new Float32Array(n * 3);
    const lc = new Float32Array(n * 3);
    const lr = new Float32Array(n);
    for (let k = 0; k < n; k++){
      const l = lights[sel[k].i];
      lp[k * 3] = l.x; lp[k * 3 + 1] = l.y; lp[k * 3 + 2] = l.z;
      lc[k * 3] = l.r; lc[k * 3 + 1] = l.g; lc[k * 3 + 2] = l.b;
      lr[k] = l.radius;
    }
    return { lightCount: n, lp: lp, lc: lc, lr: lr };
  }

  function compileWorld(def){
    worldDef = def || null;
    trailCount = 0;
    trailHead = -1;
    if (contextLost) return;
    if (!def){ releaseStatic(); world = null; return; }
    const rawPrims = Array.isArray(def.prims) ? def.prims : [];
    const prims = [];
    for (let i = 0; i < rawPrims.length; i++){
      const np = primNormalized(rawPrims[i]);
      if (np) prims.push(np);
    }
    const nbrs = buildNeighbors(prims, 0.8);

    const rawLights = Array.isArray(def.lights) ? def.lights : [];
    const lights = [];
    for (let i = 0; i < rawLights.length && lights.length < MAX_LIGHTS; i++){
      const l = rawLights[i];
      if (!l || !l.pos || l.pos.length < 3) continue;
      const c = l.color && l.color.length >= 3 ? l.color : [1, 0.92, 0.78];
      const inten = typeof l.intensity === 'number' ? l.intensity : 1;
      lights.push({
        x: l.pos[0], y: l.pos[1], z: l.pos[2],
        r: c[0] * inten, g: c[1] * inten, b: c[2] * inten,
        radius: typeof l.radius === 'number' && l.radius > 0.01 ? l.radius : 8
      });
    }

    const groups = new Map();
    for (let i = 0; i < prims.length; i++){
      const p = prims[i];
      const cx = Math.floor((p.min[0] + p.max[0]) * 0.5 / CELL_SIZE);
      const cz = Math.floor((p.min[2] + p.max[2]) * 0.5 / CELL_SIZE);
      const key = p.mat + '|' + cx + '|' + cz;
      let g = groups.get(key);
      if (!g){ g = { mat: MAT_ID[p.mat], items: [] }; groups.set(key, g); }
      g.items.push(i);
    }

    const mesh = newMesh();
    const chunks = [];
    groups.forEach(function(g){
      const start = mesh.i.length;
      let mnx = Infinity, mny = Infinity, mnz = Infinity;
      let mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
      for (let k = 0; k < g.items.length; k++){
        const idx = g.items[k];
        const p = prims[idx];
        let tr = 1, tg = 1, tb = 1;
        if (g.mat === 3){
          const e = p.emissive || MINT;
          tr = e[0]; tg = e[1]; tb = e[2];
        } else {
          const j = 0.955 + hash01(idx + 1) * 0.09;
          tr = j; tg = j; tb = j;
        }
        tr *= p.tint[0]; tg *= p.tint[1]; tb *= p.tint[2];
        emitPrim(mesh, p, tr, tg, tb, nbrs[idx]);
        if (p.min[0] < mnx) mnx = p.min[0];
        if (p.min[1] < mny) mny = p.min[1];
        if (p.min[2] < mnz) mnz = p.min[2];
        if (p.max[0] > mxx) mxx = p.max[0];
        if (p.max[1] > mxy) mxy = p.max[1];
        if (p.max[2] > mxz) mxz = p.max[2];
      }
      const count = mesh.i.length - start;
      if (count === 0) return;
      const cl = chunkLights(lights, mnx, mny, mnz, mxx, mxy, mxz);
      chunks.push({
        mat: g.mat, start: start * 4, count: count,
        mnx: mnx - 0.02, mny: mny - 0.02, mnz: mnz - 0.02,
        mxx: mxx + 0.02, mxy: mxy + 0.02, mxz: mxz + 0.02,
        lightCount: cl.lightCount, lp: cl.lp, lc: cl.lc, lr: cl.lr
      });
    });

    const shadowCount = mesh.i.length;

    const rawStrips = Array.isArray(def.strips) ? def.strips : [];
    const rawProps = Array.isArray(def.props) ? def.props : [];
    const props = [];
    for (let i = 0; i < rawProps.length && props.length < PROP_MAX; i++){
      const pr = rawProps[i];
      if (!pr || !pr.pos || pr.pos.length < 3) continue;
      if (pr.type !== undefined && pr.type !== 'lamp') continue;
      const c = rgbOr(pr.color, 1, 0.86, 0.62);
      props.push({
        x: numOr(pr.pos[0], 0), y: numOr(pr.pos[1], 0), z: numOr(pr.pos[2], 0),
        r: c[0], g: c[1], b: c[2]
      });
    }

    let gstart = mesh.i.length;
    let gmnx = Infinity, gmny = Infinity, gmnz = Infinity;
    let gmxx = -Infinity, gmxy = -Infinity, gmxz = -Infinity;
    function growGlow(x, y, z, pad){
      if (x - pad < gmnx) gmnx = x - pad;
      if (y - pad < gmny) gmny = y - pad;
      if (z - pad < gmnz) gmnz = z - pad;
      if (x + pad > gmxx) gmxx = x + pad;
      if (y + pad > gmxy) gmxy = y + pad;
      if (z + pad > gmxz) gmxz = z + pad;
    }
    let stripCount = 0;
    for (let i = 0; i < rawStrips.length && stripCount < STRIP_MAX; i++){
      const st = stripNormalized(rawStrips[i]);
      if (!st) continue;
      emitStrip(mesh, st);
      growGlow(st.ax, st.ay, st.az, st.w);
      growGlow(st.ax + st.dx, st.ay + st.dy, st.az + st.dz, st.w);
      stripCount++;
    }
    for (let i = 0; i < props.length; i++){
      const pr = props[i];
      emitLampLens(mesh, pr.x, pr.y, pr.z, pr.r, pr.g, pr.b);
      growGlow(pr.x, pr.y, pr.z, 0.16);
    }
    if (mesh.i.length > gstart){
      chunks.push({
        mat: 3, start: gstart * 4, count: mesh.i.length - gstart,
        mnx: gmnx, mny: gmny, mnz: gmnz, mxx: gmxx, mxy: gmxy, mxz: gmxz,
        lightCount: 0, lp: null, lc: null, lr: null
      });
    }

    gstart = mesh.i.length;
    let pmnx = Infinity, pmny = Infinity, pmnz = Infinity;
    let pmxx = -Infinity, pmxy = -Infinity, pmxz = -Infinity;
    for (let i = 0; i < props.length; i++){
      const pr = props[i];
      emitLampBody(mesh, pr.x, pr.y, pr.z);
      if (pr.x - 0.14 < pmnx) pmnx = pr.x - 0.14;
      if (pr.y - 0.06 < pmny) pmny = pr.y - 0.06;
      if (pr.z - 0.08 < pmnz) pmnz = pr.z - 0.08;
      if (pr.x + 0.14 > pmxx) pmxx = pr.x + 0.14;
      if (pr.y + 0.16 > pmxy) pmxy = pr.y + 0.16;
      if (pr.z + 0.08 > pmxz) pmxz = pr.z + 0.08;
    }
    if (mesh.i.length > gstart){
      const cl = chunkLights(lights, pmnx, pmny, pmnz, pmxx, pmxy, pmxz);
      chunks.push({
        mat: 1, start: gstart * 4, count: mesh.i.length - gstart,
        mnx: pmnx, mny: pmny, mnz: pmnz, mxx: pmxx, mxy: pmxy, mxz: pmxz,
        lightCount: cl.lightCount, lp: cl.lp, lc: cl.lc, lr: cl.lr
      });
    }

    releaseStatic();
    GLB.staticVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, GLB.staticVBO);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.v), gl.STATIC_DRAW);
    GLB.staticIBO = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, GLB.staticIBO);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(mesh.i), gl.STATIC_DRAW);
    GLB.staticVAO = meshVAO(GLB.staticVBO, GLB.staticIBO);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);

    const rawTargets = Array.isArray(def.targets) ? def.targets : [];
    const targets = [];
    for (let i = 0; i < rawTargets.length; i++){
      const t = rawTargets[i];
      if (!t || !t.pos || t.pos.length < 3) continue;
      targets.push({
        id: typeof t.id === 'string' ? t.id : 't' + i,
        x: t.pos[0], y: t.pos[1], z: t.pos[2],
        radius: typeof t.radius === 'number' && t.radius > 0.02 ? t.radius : 0.5,
        phase: hash01(i + 7) * Math.PI * 2,
        bobRate: 0.9 + hash01(i + 19) * 0.5,
        seed: hash01(i + 31) * 6.283,
        downAt: -1
      });
    }

    const sun = def.sun || null;
    let sx = sun && sun.dir && sun.dir.length >= 3 ? sun.dir[0] : 0.42;
    let sy = sun && sun.dir && sun.dir.length >= 3 ? sun.dir[1] : -0.62;
    let sz = sun && sun.dir && sun.dir.length >= 3 ? sun.dir[2] : 0.66;
    let sl = Math.sqrt(sx * sx + sy * sy + sz * sz);
    if (sl < 1e-5){ sx = 0.42; sy = -0.62; sz = 0.66; sl = 1; }
    sx /= sl; sy /= sl; sz /= sl;
    const sunI = sun && typeof sun.intensity === 'number' ? sun.intensity : 1;
    const sunC = sun && sun.color && sun.color.length >= 3 ? sun.color : [1, 0.86, 0.68];
    const sunR = sunC[0] * sunI, sunG = sunC[1] * sunI, sunB = sunC[2] * sunI;
    const amb = def.ambient && def.ambient.length >= 3 ? def.ambient : [0.10, 0.125, 0.17];
    const fog = def.fog || null;
    const fogC = fog && fog.color && fog.color.length >= 3 ? fog.color : [0.055, 0.068, 0.088];

    world = {
      chunks: chunks,
      indexCount: mesh.i.length,
      shadowCount: shadowCount,
      targets: targets,
      sunX: sx, sunY: sy, sunZ: sz,
      sunR: sunR, sunG: sunG, sunB: sunB,
      ambR: amb[0], ambG: amb[1], ambB: amb[2],
      fogR: fogC[0], fogG: fogC[1], fogB: fogC[2],
      fogDensity: fog && typeof fog.density === 'number' ? fog.density : 0.014,
      fogFalloff: fog && typeof fog.heightFalloff === 'number' ? fog.heightFalloff : 0.07,
      fogRef: fog && typeof fog.heightRef === 'number' ? fog.heightRef : 0,
      zenR: fogC[0] * 0.18 + 0.006, zenG: fogC[1] * 0.18 + 0.012, zenB: fogC[2] * 0.20 + 0.032,
      grdR: fogC[0] * 0.45, grdG: fogC[1] * 0.45, grdB: fogC[2] * 0.45,
      exposure: typeof def.exposure === 'number' && def.exposure > 0 ? def.exposure : 1.05,
      specCap: SPEC_HEADROOM / Math.max(0.2126 * sunR + 0.7152 * sunG + 0.0722 * sunB, 0.001)
    };

    let amnx = Infinity, amny = Infinity, amnz = Infinity;
    let amxx = -Infinity, amxy = -Infinity, amxz = -Infinity;
    for (let i = 0; i < prims.length; i++){
      const p = prims[i];
      if (p.min[0] < amnx) amnx = p.min[0];
      if (p.min[1] < amny) amny = p.min[1];
      if (p.min[2] < amnz) amnz = p.min[2];
      if (p.max[0] > amxx) amxx = p.max[0];
      if (p.max[1] > amxy) amxy = p.max[1];
      if (p.max[2] > amxz) amxz = p.max[2];
    }
    if (!isFinite(amnx)){ amnx = -20; amny = -2; amnz = -20; amxx = 20; amxy = 12; amxz = 20; }
    const ccx = (amnx + amxx) * 0.5, ccy = (amny + amxy) * 0.5, ccz = (amnz + amxz) * 0.5;
    const rad = Math.max(3, 0.5 * Math.sqrt(
      (amxx - amnx) * (amxx - amnx) + (amxy - amny) * (amxy - amny) + (amxz - amnz) * (amxz - amnz)
    )) + 1.5;
    const dist = rad * 2.2;
    const upY = Math.abs(sy) > 0.985 ? 0 : 1;
    const upZ = Math.abs(sy) > 0.985 ? 1 : 0;
    m4LookAt(mLightView, ccx - sx * dist, ccy - sy * dist, ccz - sz * dist, ccx, ccy, ccz, 0, upY, upZ);
    m4Point(tmp3, mLightView, ccx, ccy, ccz);
    const texel = (rad * 2) / SHADOW_SIZE;
    const snapX = tmp3[0] - Math.round(tmp3[0] / texel) * texel;
    const snapY = tmp3[1] - Math.round(tmp3[1] / texel) * texel;
    m4Ortho(mLightProj, -rad + snapX, rad + snapX, -rad + snapY, rad + snapY, 0.05, dist + rad * 2);
    m4Mul(mLightVP, mLightProj, mLightView);
    m4Mul(mShadow, mBias, mLightVP);
    renderShadowMap();
  }

  function renderShadowMap(){
    if (!world || contextLost) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, GLB.shadowFB);
    gl.viewport(0, 0, SHADOW_SIZE, SHADOW_SIZE);
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1.6, 4.0);
    gl.useProgram(P.shadow.p);
    sm4(P.shadow, 'uLightMat', mLightVP);
    gl.bindVertexArray(GLB.staticVAO);
    gl.drawElements(gl.TRIANGLES, world.shadowCount, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(0, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, drawW, drawH);
  }

  function resize(){
    const dpr = Math.max(1, Math.min(typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1, 3));
    lastClientW = canvas.clientWidth;
    lastClientH = canvas.clientHeight;
    const cw = Math.max(1, lastClientW || canvas.width || 1);
    const ch = Math.max(1, lastClientH || canvas.height || 1);
    const w = Math.max(2, Math.round(cw * dpr * qScale));
    const h = Math.max(2, Math.round(ch * dpr * qScale));
    sizeDirty = false;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    drawW = w;
    drawH = h;
    if (contextLost) return;
    if (GLB.scene && GLB.sceneW === w && GLB.sceneH === h) return;
    dropTarget(GLB.scene);
    dropTarget(GLB.bloomA);
    dropTarget(GLB.bloomB);
    GLB.sceneW = w;
    GLB.sceneH = h;
    GLB.bloomW = Math.max(2, w >> 1);
    GLB.bloomH = Math.max(2, h >> 1);
    GLB.scene = makeTarget(w, h, true, true);
    GLB.bloomA = makeTarget(GLB.bloomW, GLB.bloomH, true, false);
    GLB.bloomB = makeTarget(GLB.bloomW, GLB.bloomH, true, false);
    gl.viewport(0, 0, w, h);
  }

  function render(scene, dt){
    if (contextLost || !scene) return;
    if (gl.isContextLost && gl.isContextLost()){ contextLost = true; return; }
    const step = typeof dt === 'number' && isFinite(dt) && dt > 0 && dt < 0.5 ? dt : 0.0166;
    time += step;
    const qs = scene.quality && typeof scene.quality.scale === 'number' && isFinite(scene.quality.scale)
      ? clamp(scene.quality.scale, 0.35, 1) : 1;
    if (Math.abs(qs - qScale) > 0.002){ qScale = qs; sizeDirty = true; }
    if (canvas.clientWidth !== lastClientW || canvas.clientHeight !== lastClientH) sizeDirty = true;
    if (sizeDirty) resize();
    if (!GLB.scene) return;

    const cam = scene.camera || null;
    const cpos = cam && cam.pos && cam.pos.length >= 3 ? cam.pos : null;
    const px = cpos ? fnum(cpos[0], 0) : 0;
    const py = cpos ? fnum(cpos[1], 1.62) : 1.62;
    const pz = cpos ? fnum(cpos[2], 0) : 0;
    const yaw = cam ? fnum(cam.yaw, 0) : 0;
    const pitch = clamp(cam ? fnum(cam.pitch, 0) : 0, -1.55, 1.55);
    const fovY = clamp(cam ? fnum(cam.fovY, 1.745) : 1.745, 0.35, 2.6);
    const cpit = Math.cos(pitch), spit = Math.sin(pitch);
    const cyaw = Math.cos(yaw), syaw = Math.sin(yaw);
    const fx = -syaw * cpit, fy = spit, fz = -cyaw * cpit;
    const rx = cyaw, ry = 0, rz = -syaw;
    const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;
    const aspect = drawW / drawH;

    m4Perspective(mProj, fovY, aspect, 0.045, 420);
    m4LookAt(mView, px, py, pz, px + fx, py + fy, pz + fz, ux, uy, uz);
    m4Mul(mVP, mProj, mView);
    frustumFrom(planes, mVP);

    if (!world){
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, drawW, drawH);
      gl.depthMask(true);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      return;
    }

    const muzzle = clamp(fnum(scene.muzzle, 0), 0, 1);
    const glitch = clamp(fnum(scene.glitch, 0), 0, 1);
    const preExpose = hdr ? 1 : world.exposure * LDR_SCALE;
    const postExpose = hdr ? world.exposure : 1 / LDR_SCALE;
    const mzx = px + fx * 0.5 + rx * 0.12;
    const mzy = py + fy * 0.5 + ry * 0.12 - 0.06;
    const mzz = pz + fz * 0.5 + rz * 0.12;

    gl.bindFramebuffer(gl.FRAMEBUFFER, GLB.scene.fb);
    gl.viewport(0, 0, drawW, drawH);
    gl.depthMask(true);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.depthMask(false);
    gl.useProgram(P.sky.p);
    gl.bindVertexArray(GLB.emptyVAO);
    const tanH = Math.tan(fovY * 0.5);
    s3f(P.sky, 'uRight', rx, ry, rz);
    s3f(P.sky, 'uUp', ux, uy, uz);
    s3f(P.sky, 'uFwd', fx, fy, fz);
    s2f(P.sky, 'uTanFov', tanH * aspect, tanH);
    s3f(P.sky, 'uZenith', world.zenR, world.zenG, world.zenB);
    s3f(P.sky, 'uGround', world.grdR, world.grdG, world.grdB);
    s3f(P.sky, 'uFogColor', world.fogR, world.fogG, world.fogB);
    s3f(P.sky, 'uFogParam', world.fogDensity, world.fogFalloff, world.fogRef);
    s3f(P.sky, 'uSunDir', world.sunX, world.sunY, world.sunZ);
    s3f(P.sky, 'uSunColor', world.sunR, world.sunG, world.sunB);
    s1f(P.sky, 'uPreExpose', preExpose);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.useProgram(P.world.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, GLB.shadowTex);
    s1i(P.world, 'uShadow', 0);
    s2f(P.world, 'uShadowTexel', 1 / SHADOW_SIZE, 1 / SHADOW_SIZE);
    sm4(P.world, 'uViewProj', mVP);
    sm4(P.world, 'uShadowMat', mShadow);
    s3f(P.world, 'uCamPos', px, py, pz);
    s3f(P.world, 'uSunDir', world.sunX, world.sunY, world.sunZ);
    s3f(P.world, 'uSunColor', world.sunR, world.sunG, world.sunB);
    s3f(P.world, 'uAmbient', world.ambR, world.ambG, world.ambB);
    s3f(P.world, 'uFogColor', world.fogR, world.fogG, world.fogB);
    s3f(P.world, 'uFogParam', world.fogDensity, world.fogFalloff, world.fogRef);
    s4f(P.world, 'uMuzzle', mzx, mzy, mzz, muzzle);
    s3f(P.world, 'uMuzzleColor', 1.0, 0.76, 0.42);
    s1f(P.world, 'uPreExpose', preExpose);
    s1f(P.world, 'uSpecCap', world.specCap);
    gl.bindVertexArray(GLB.staticVAO);
    const chunks = world.chunks;
    for (let i = 0; i < chunks.length; i++){
      const c = chunks[i];
      if (!aabbVisible(planes, c.mnx, c.mny, c.mnz, c.mxx, c.mxy, c.mxz)) continue;
      s1i(P.world, 'uMat', c.mat);
      s1i(P.world, 'uLightCount', c.lightCount);
      if (c.lightCount > 0){
        s3v(P.world, 'uLightPos', c.lp);
        s3v(P.world, 'uLightColor', c.lc);
        s1fv(P.world, 'uLightRadius', c.lr);
      }
      gl.drawElements(gl.TRIANGLES, c.count, gl.UNSIGNED_INT, c.start);
    }

    const targets = world.targets;
    if (targets.length > 0){
      const down = scene.targetsDown || null;
      gl.disable(gl.CULL_FACE);
      gl.useProgram(P.target.p);
      gl.bindVertexArray(GLB.quadVAO);
      sm4(P.target, 'uViewProj', mVP);
      s3f(P.target, 'uCamPos', px, py, pz);
      s3f(P.target, 'uAmbient', world.ambR, world.ambG, world.ambB);
      s3f(P.target, 'uMint', MINT[0], MINT[1], MINT[2]);
      s3f(P.target, 'uAmberC', AMBER[0], AMBER[1], AMBER[2]);
      s3f(P.target, 'uFogColor', world.fogR, world.fogG, world.fogB);
      s3f(P.target, 'uFogParam', world.fogDensity, world.fogFalloff, world.fogRef);
      s3f(P.target, 'uSunDir', world.sunX, world.sunY, world.sunZ);
      s3f(P.target, 'uSunColor', world.sunR, world.sunG, world.sunB);
      s1f(P.target, 'uPreExpose', preExpose);
      s1f(P.target, 'uTime', time);
      s3f(P.target, 'uRight', rx, ry, rz);
      s3f(P.target, 'uUp', ux, uy, uz);
      for (let i = 0; i < targets.length; i++){
        const t = targets[i];
        const isDown = down && down[t.id] ? 1 : 0;
        if (isDown){
          if (t.downAt < 0) t.downAt = time;
        } else if (t.downAt >= 0) t.downAt = -1;
        const by = t.y + Math.sin(time * t.bobRate + t.phase) * 0.055;
        if (!sphereVisible(planes, t.x, by, t.z, t.radius * 1.5)) continue;
        s3f(P.target, 'uCenter', t.x, by, t.z);
        s1f(P.target, 'uRadius', t.radius);
        s1f(P.target, 'uDown', isDown);
        s1f(P.target, 'uDownAge', isDown ? time - t.downAt : 0);
        s1f(P.target, 'uSeed', t.seed);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    }

    drawGhost(scene, px, py, pz, rx, ry, rz, ux, uy, uz, preExpose);

    let tc = 0;
    const tracers = scene.tracers;
    if (tracers && tracers.length > 0){
      for (let i = 0; i < tracers.length && tc < MAX_TRACERS; i++){
        const t = tracers[i];
        if (!t || !t.from || !t.to || t.from.length < 3 || t.to.length < 3) continue;
        const a01 = clamp(fnum(t.age01, 0), 0, 1);
        const fade = (1 - a01) * (1 - a01);
        if (fade < 0.003) continue;
        const ax = t.from[0], ay = t.from[1], az = t.from[2];
        const bx = t.to[0], by2 = t.to[1], bz = t.to[2];
        const dx = bx - ax, dy = by2 - ay, dz = bz - az;
        const vx = (ax + bx) * 0.5 - px, vy = (ay + by2) * 0.5 - py, vz = (az + bz) * 0.5 - pz;
        let sxv = dy * vz - dz * vy, syv = dz * vx - dx * vz, szv = dx * vy - dy * vx;
        const sl = Math.sqrt(sxv * sxv + syv * syv + szv * szv);
        if (sl < 1e-7) continue;
        const hw = 0.026 / sl;
        sxv *= hw; syv *= hw; szv *= hw;
        const o = tc * 20;
        tracerData[o] = ax - sxv; tracerData[o + 1] = ay - syv; tracerData[o + 2] = az - szv;
        tracerData[o + 3] = -1; tracerData[o + 4] = fade * 0.28;
        tracerData[o + 5] = ax + sxv; tracerData[o + 6] = ay + syv; tracerData[o + 7] = az + szv;
        tracerData[o + 8] = 1; tracerData[o + 9] = fade * 0.28;
        tracerData[o + 10] = bx + sxv; tracerData[o + 11] = by2 + syv; tracerData[o + 12] = bz + szv;
        tracerData[o + 13] = 1; tracerData[o + 14] = fade;
        tracerData[o + 15] = bx - sxv; tracerData[o + 16] = by2 - syv; tracerData[o + 17] = bz - szv;
        tracerData[o + 18] = -1; tracerData[o + 19] = fade;
        tc++;
      }
    }
    let sc = 0;
    const sparks = scene.sparks;
    if (sparks && sparks.length > 0){
      for (let i = 0; i < sparks.length && sc < MAX_SPARKS; i++){
        const s = sparks[i];
        if (!s || !s.pos || s.pos.length < 3) continue;
        const a01 = clamp(fnum(s.age01, 0), 0, 1);
        if (a01 >= 0.999) continue;
        const o = sc * 4;
        sparkData[o] = s.pos[0];
        sparkData[o + 1] = s.pos[1];
        sparkData[o + 2] = s.pos[2];
        sparkData[o + 3] = a01;
        sc++;
      }
    }

    if (tc > 0 || sc > 0){
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.depthMask(false);
      gl.disable(gl.CULL_FACE);
      if (tc > 0){
        gl.bindVertexArray(GLB.tracerVAO);
        gl.bindBuffer(gl.ARRAY_BUFFER, GLB.tracerVBO);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, tracerData, 0, tc * 20);
        gl.useProgram(P.tracer.p);
        sm4(P.tracer, 'uViewProj', mVP);
        s1f(P.tracer, 'uPreExpose', preExpose);
        gl.drawElements(gl.TRIANGLES, tc * 6, gl.UNSIGNED_INT, 0);
      }
      if (sc > 0){
        gl.bindVertexArray(GLB.sparkVAO);
        gl.bindBuffer(gl.ARRAY_BUFFER, GLB.sparkVBO);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, sparkData, 0, sc * 4);
        gl.useProgram(P.spark.p);
        sm4(P.spark, 'uViewProj', mVP);
        s3f(P.spark, 'uRight', rx, ry, rz);
        s3f(P.spark, 'uUp', ux, uy, uz);
        s1f(P.spark, 'uPreExpose', preExpose);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, sc);
      }
      gl.disable(gl.BLEND);
    }

    drawViewmodel(scene, aspect, muzzle, preExpose);
    postProcess(postExpose, glitch, aspect);
  }

  function fnum(v, d){ return typeof v === 'number' && isFinite(v) ? v : d; }

  function sstep(t){
    const x = clamp(t, 0, 1);
    return x * x * (3 - 2 * x);
  }

  function seg(v, a, b){ return b > a ? sstep((v - a) / (b - a)) : (v >= b ? 1 : 0); }

  function trailPush(gx, gy, gz){
    if (trailCount === 0){
      trailHead = 0;
      trailCount = 1;
      trailHist[0] = gx; trailHist[1] = gy; trailHist[2] = gz; trailHist[3] = time;
      return;
    }
    const o = trailHead * 4;
    const dx = gx - trailHist[o], dy = gy - trailHist[o + 1], dz = gz - trailHist[o + 2];
    if (dx * dx + dy * dy + dz * dz > 25){
      trailHead = 0;
      trailCount = 1;
      trailHist[0] = gx; trailHist[1] = gy; trailHist[2] = gz; trailHist[3] = time;
      return;
    }
    if (time - trailHist[o + 3] < TRAIL_STEP) return;
    trailHead = trailHead + 1 >= TRAIL_MAX ? 0 : trailHead + 1;
    const n = trailHead * 4;
    trailHist[n] = gx; trailHist[n + 1] = gy; trailHist[n + 2] = gz; trailHist[n + 3] = time;
    if (trailCount < TRAIL_MAX) trailCount++;
  }

  function drawGhost(scene, px, py, pz, rx, ry, rz, ux, uy, uz, preExpose){
    const g = scene.ghost;
    if (!g || !g.active || !g.pos || g.pos.length < 3){
      trailCount = 0;
      trailHead = -1;
      return;
    }
    const gx = fnum(g.pos[0], 0), gy = fnum(g.pos[1], 0), gz = fnum(g.pos[2], 0);
    trailPush(gx, gy, gz);
    if (!sphereVisible(planes, gx, gy + 0.9, gz, 8)) return;
    const flags = fnum(g.flags, 0) | 0;
    const slide = (flags & 2) !== 0;
    const crouch = (flags & 1) !== 0;
    const air = (flags & 4) !== 0;
    let squash = 1;
    let tilt = 0;
    if (slide){ squash = 0.52; tilt = -0.58; }
    else if (crouch){ squash = 0.68; tilt = -0.09; }
    const dxc = gx - px, dyc = gy + 0.9 - py, dzc = gz - pz;
    const dist = Math.sqrt(dxc * dxc + dyc * dyc + dzc * dzc);
    const alpha = clamp(dist * 0.45, 0.12, 1);
    m4TR(mGhost, gx, gy, gz, tilt, fnum(g.yaw, 0), 0);

    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.disable(gl.CULL_FACE);
    gl.useProgram(P.ghost.p);
    gl.bindVertexArray(GLB.ghostVAO);
    sm4(P.ghost, 'uViewProj', mVP);
    sm4(P.ghost, 'uModel', mGhost);
    s3f(P.ghost, 'uCamPos', px, py, pz);
    s3f(P.ghost, 'uMint', MINT[0], MINT[1], MINT[2]);
    s1f(P.ghost, 'uTime', time);
    s1f(P.ghost, 'uAlpha', alpha);
    s1f(P.ghost, 'uPreExpose', preExpose);
    const parts = gm.parts;
    for (let i = 0; i < parts.length; i++){
      const pt = parts[i];
      const tuck = pt.tuck && air;
      s3f(P.ghost, 'uPart', squash * (tuck ? 0.58 : 1), squash * (tuck ? 0.19 : 0), tuck ? 1.1 : 1);
      gl.drawElements(gl.TRIANGLES, pt.count, gl.UNSIGNED_INT, pt.start * 4);
    }

    let n = 0;
    for (let i = 0; i < trailCount; i++){
      const o = i * 4;
      const age = (time - trailHist[o + 3]) / TRAIL_LIFE;
      if (age < 0 || age >= 1) continue;
      const d = n * 4;
      trailData[d] = trailHist[o];
      trailData[d + 1] = trailHist[o + 1] + 0.95;
      trailData[d + 2] = trailHist[o + 2];
      trailData[d + 3] = age;
      n++;
    }
    if (n > 0){
      gl.bindVertexArray(GLB.trailVAO);
      gl.bindBuffer(gl.ARRAY_BUFFER, GLB.trailVBO);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, trailData, 0, n * 4);
      gl.useProgram(P.trail.p);
      sm4(P.trail, 'uViewProj', mVP);
      s3f(P.trail, 'uRight', rx, ry, rz);
      s3f(P.trail, 'uUp', ux, uy, uz);
      s3f(P.trail, 'uMint', MINT[0], MINT[1], MINT[2]);
      s1f(P.trail, 'uAlpha', alpha);
      s1f(P.trail, 'uPreExpose', preExpose);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
    }
    gl.disable(gl.BLEND);
    gl.depthMask(true);
  }

  function drawViewmodel(scene, aspect, muzzle, preExpose){
    const vs = scene.viewmodel || null;
    const ads = clamp(vs ? fnum(vs.adsBlend, 0) : 0, 0, 1);
    const recoil = clamp(vs ? fnum(vs.recoil, 0) : 0, 0, 1);
    const bobPhase = vs ? fnum(vs.bobPhase, 0) : 0;
    const sprint = clamp(vs ? fnum(vs.sprintBlend, 0) : 0, 0, 1);
    const swayX = vs && vs.sway && vs.sway.length >= 2 ? clamp(fnum(vs.sway[0], 0), -3, 3) : 0;
    const swayY = vs && vs.sway && vs.sway.length >= 2 ? clamp(fnum(vs.sway[1], 0), -3, 3) : 0;
    const reload = vs && typeof vs.reloadPhase === 'number' && isFinite(vs.reloadPhase)
      ? clamp(vs.reloadPhase, 0, 1) : -1;

    const e = sstep(ads);
    const hip = 1 - e;
    let gx = 0.148 + (0.0 - 0.148) * e;
    let gy = -0.128 + (-0.092 + 0.128) * e;
    let gz = -0.315 + (-0.175 + 0.315) * e;
    let grx = 0, gry = 0, grz = 0;

    const bobAmp = 0.016 * hip;
    gx += Math.sin(bobPhase) * bobAmp;
    gy += Math.sin(bobPhase * 2) * bobAmp * 0.55;
    grz += Math.sin(bobPhase) * 0.022 * hip;

    const swayMul = 0.34 + 0.66 * hip;
    gx -= swayX * 0.05 * swayMul;
    gy -= swayY * 0.05 * swayMul;
    gry -= swayX * 0.09 * swayMul;
    grx += swayY * 0.09 * swayMul;

    const spB = sprint * hip;
    gx += 0.022 * spB;
    gy -= 0.058 * spB;
    gz += 0.010 * spB;
    grz -= 0.42 * spB;
    gry += 0.22 * spB;
    grx -= 0.12 * spB;

    gz += recoil * 0.052 * (1 - 0.3 * e);
    gy += recoil * 0.011;
    grx += recoil * 0.13;
    grz += Math.sin(time * 41) * recoil * 0.018;

    let magOut = 0;
    if (reload >= 0){
      const bw = Math.pow(Math.sin(Math.PI * reload), 0.75);
      grz += 0.62 * bw;
      gry += 0.30 * bw;
      grx += 0.12 * bw;
      gy -= 0.105 * bw;
      gx += 0.018 * bw;
      gz += 0.022 * bw;
      magOut = clamp(seg(reload, 0.08, 0.30) - seg(reload, 0.50, 0.78), 0, 1);
    }

    m4TR(mGun, gx, gy, gz, grx, gry, grz);
    m4TR(mMagLocal, 0, -0.30 * magOut, 0.03 * magOut, -0.55 * magOut, 0, 0.22 * magOut);
    m4Mul(mMag, mGun, mMagLocal);
    m4Perspective(mGunProj, clamp(1.02 - 0.14 * e, 0.4, 1.6), aspect, 0.006, 8);
    m4Point(tmp3, mGun, vm.muzzle[0], vm.muzzle[1], vm.muzzle[2]);

    sunCam[0] = mView[0] * world.sunX + mView[4] * world.sunY + mView[8] * world.sunZ;
    sunCam[1] = mView[1] * world.sunX + mView[5] * world.sunY + mView[9] * world.sunZ;
    sunCam[2] = mView[2] * world.sunX + mView[6] * world.sunY + mView[10] * world.sunZ;

    gl.depthMask(true);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.disable(gl.BLEND);
    gl.useProgram(P.viewmodel.p);
    gl.bindVertexArray(GLB.vmVAO);
    sm4(P.viewmodel, 'uProj', mGunProj);
    s3v(P.viewmodel, 'uSunCam', sunCam);
    s3f(P.viewmodel, 'uSunColor', world.sunR, world.sunG, world.sunB);
    s3f(P.viewmodel, 'uAmbient', world.ambR, world.ambG, world.ambB);
    s1f(P.viewmodel, 'uFlash', muzzle);
    s3v(P.viewmodel, 'uFlashPos', tmp3);
    s1f(P.viewmodel, 'uPreExpose', preExpose);
    s1f(P.viewmodel, 'uSpecCap', world.specCap);
    const parts = vm.parts;
    let boundMag = -1;
    for (let i = 0; i < parts.length; i++){
      const pt = parts[i];
      if (pt.dyn !== boundMag){
        sm4(P.viewmodel, 'uModel', pt.dyn ? mMag : mGun);
        boundMag = pt.dyn;
      }
      s1i(P.viewmodel, 'uMat', pt.mat);
      gl.drawElements(gl.TRIANGLES, pt.count, gl.UNSIGNED_INT, pt.start * 4);
    }

    if (muzzle > 0.003){
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.depthMask(false);
      gl.disable(gl.CULL_FACE);
      gl.useProgram(P.flash.p);
      gl.bindVertexArray(GLB.quadVAO);
      sm4(P.flash, 'uProj', mGunProj);
      s3v(P.flash, 'uCenter', tmp3);
      s1f(P.flash, 'uSize', 0.085 + 0.075 * muzzle);
      s1f(P.flash, 'uIntensity', muzzle);
      s1f(P.flash, 'uPreExpose', preExpose);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disable(gl.BLEND);
    }
  }

  function postProcess(exposure, glitch, aspect){
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.depthMask(false);
    gl.bindVertexArray(GLB.emptyVAO);

    gl.bindFramebuffer(gl.FRAMEBUFFER, GLB.bloomA.fb);
    gl.viewport(0, 0, GLB.bloomW, GLB.bloomH);
    gl.useProgram(P.bright.p);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, GLB.scene.tex);
    s1i(P.bright, 'uScene', 1);
    s1f(P.bright, 'uThreshold', hdr ? 1.20 : 0.80);
    s1f(P.bright, 'uKnee', hdr ? 0.55 : 0.16);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.useProgram(P.blur.p);
    s1i(P.blur, 'uSrc', 2);
    gl.bindFramebuffer(gl.FRAMEBUFFER, GLB.bloomB.fb);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, GLB.bloomA.tex);
    s2f(P.blur, 'uStep', 1 / GLB.bloomW, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, GLB.bloomA.fb);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, GLB.bloomB.tex);
    s2f(P.blur, 'uStep', 0, 1 / GLB.bloomH);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, drawW, drawH);
    const prog = glitch > 0.002 ? P.glitch : P.composite;
    gl.useProgram(prog.p);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, GLB.scene.tex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, GLB.bloomA.tex);
    s1i(prog, 'uScene', 1);
    s1i(prog, 'uBloom', 2);
    s1f(prog, 'uExposure', exposure);
    s1f(prog, 'uBloomStrength', hdr ? 0.52 : 0.52 / LDR_SCALE);
    s1f(prog, 'uGrain', 0.024);
    s1f(prog, 'uTime', time);
    s2f(prog, 'uRes', drawW, drawH);
    s1f(prog, 'uAspect', aspect);
    s1f(prog, 'uGlitch', glitch);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindVertexArray(null);
    gl.depthMask(true);
  }

  function onContextLost(cb){ if (typeof cb === 'function') lostCbs.push(cb); }

  function onContextRestored(cb){ if (typeof cb === 'function') restoredCbs.push(cb); }

  return {
    compileWorld: compileWorld,
    render: render,
    resize: resize,
    onContextLost: onContextLost,
    onContextRestored: onContextRestored
  };
}

