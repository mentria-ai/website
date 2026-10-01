export const GFX_CLASSIC = 'classic';
export const GFX_ENHANCED = 'enhanced';

export const TEXTURE_URLS = {
  panel: '/assets/games/textures/ph-panel.webp',
  floor: '/assets/games/textures/ph-floor.webp',
  void: '/assets/games/backdrops/ph-void.webp'
};

const NOISE = `
float h21(vec2 p){ vec3 q = fract(vec3(p.x, p.y, p.x) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float h11(float n){ return fract(sin(n * 91.3458) * 47453.5453); }
float n2(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = h21(i); float b = h21(i + vec2(1.0, 0.0)); float c = h21(i + vec2(0.0, 1.0)); float d = h21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float triNoise(vec3 p, vec3 w, float s){ return n2(p.yz * s) * w.x + n2(p.xz * s) * w.y + n2(p.xy * s) * w.z; }
float fbm4(vec2 p){
  float s = 0.0; float a = 0.5;
  for (int i = 0; i < 4; i++){ s += n2(p) * a; p = p * 2.03 + vec2(17.1, 9.7); a *= 0.5; }
  return s / 0.9375;
}
`;

const FOG = `
uniform vec3 uFogColor;
uniform vec3 uFogParam;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uTime;
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
  float wisp = n2(wpos.xz * 0.055 + uTime * vec2(0.035, 0.012)) * 0.6 + n2(wpos.xz * 0.16 - uTime * vec2(0.02, 0.045)) * 0.4;
  float low = exp(-max(wpos.y - uFogParam.z, 0.0) * 0.8);
  float f = 1.0 - exp(-uFogParam.x * max(optical, 0.0) * (1.0 + (wisp - 0.45) * 0.95 * low));
  float sd = max(dot(rd, -uSunDir), 0.0);
  vec3 fc = mix(uFogColor, uSunColor * 0.85, pow(sd, 9.0) * 0.30);
  return mix(col, fc, clamp(f, 0.0, 1.0));
}
`;

export const FS_WORLD_E = `#version 300 es
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
uniform sampler2D uPanelA;
uniform sampler2D uPanelN;
uniform sampler2D uFloorA;
uniform sampler2D uFloorN;
uniform sampler2D uMetalA;
uniform sampler2D uMetalN;
uniform sampler2D uPlateA;
uniform sampler2D uPlateN;
uniform vec3 uPanelAvg;
uniform vec3 uFloorAvg;
uniform vec3 uMetalAvg;
uniform vec3 uPlateAvg;
uniform vec2 uGen;
uniform vec3 uZenith;
out vec4 oColor;
${NOISE}
${FOG}
const vec2 POISSON[12] = vec2[12](
  vec2(-0.326, -0.406), vec2(-0.840, -0.074), vec2(-0.696, 0.457), vec2(-0.203, 0.621),
  vec2(0.962, -0.195), vec2(0.473, -0.480), vec2(0.519, 0.767), vec2(0.185, -0.893),
  vec2(0.507, 0.064), vec2(0.896, 0.412), vec2(-0.322, -0.933), vec2(-0.792, -0.598)
);
float shadowAt(){
  if (vShadow.w <= 0.0) return 1.0;
  vec3 pc = vShadow.xyz / vShadow.w;
  if (pc.x < 0.002 || pc.x > 0.998 || pc.y < 0.002 || pc.y > 0.998 || pc.z > 1.0) return 1.0;
  float d = pc.z - 0.0018;
  float a = h21(gl_FragCoord.xy) * 6.2831853;
  float ca = cos(a), sa = sin(a);
  mat2 rot = mat2(ca, sa, -sa, ca);
  float s = 0.0;
  for (int i = 0; i < 12; i++){
    s += texture(uShadow, vec3(pc.xy + rot * POISSON[i] * uShadowTexel * 1.9, d));
  }
  return s / 12.0;
}
vec3 skyTint(vec3 r){
  float up = clamp(r.y, 0.0, 1.0);
  vec3 c = mix(uFogColor, uZenith, pow(up, 0.55));
  float sd = max(dot(r, -uSunDir), 0.0);
  c += uSunColor * (pow(sd, 24.0) * 0.45 + pow(sd, 5.0) * 0.07);
  return mix(c, uFogColor * 0.45, clamp(-r.y * 3.0, 0.0, 1.0));
}
float seamLine(vec2 uv, vec2 cell, float w, float pw){
  vec2 f = fract(uv / cell);
  vec2 d = min(f, 1.0 - f) * cell;
  float ww = max(w, pw * 1.6);
  return (1.0 - smoothstep(ww * 0.45, ww, min(d.x, d.y))) * (w / ww);
}
float structH(vec2 uv, int kind, float pw){
  float dotFade = 1.0 - smoothstep(0.006, 0.016, pw);
  if (kind == 0){
    float s = seamLine(uv, vec2(2.4, 1.2), 0.016, pw);
    vec2 f = fract(uv / vec2(2.4, 1.2));
    vec2 q = vec2(f.x < 0.5 ? f.x - 0.2 : f.x - 0.8, f.y < 0.5 ? f.y - 0.25 : f.y - 0.75) * vec2(2.4, 1.2);
    float hole = (1.0 - smoothstep(0.016, 0.026, length(q))) * dotFade;
    return -s * 0.9 - hole * 0.7;
  }
  if (kind == 1){
    float s = seamLine(uv, vec2(4.0, 4.0), 0.014, pw);
    return -s;
  }
  if (kind == 2){
    float s = seamLine(uv, vec2(1.0, 2.0), 0.010, pw);
    vec2 g = uv / vec2(1.0, 2.0);
    vec2 f = fract(g);
    vec2 d = min(f, 1.0 - f) * vec2(1.0, 2.0);
    float ax = d.x < d.y ? 1.0 : 0.0;
    float along = ax > 0.5 ? uv.y : uv.x;
    float across = ax > 0.5 ? d.x : d.y;
    float rv = fract(along / 0.25) - 0.5;
    float rd = length(vec2(rv * 0.25, across - 0.045));
    float rivet = (1.0 - smoothstep(0.006, 0.011, rd)) * dotFade;
    return -s * 0.8 + rivet * 0.6;
  }
  return 0.0;
}
void main(){
  vec3 n = normalize(vNormal);
  if (uMat == 3){
    float core = clamp(vDetail.y, 0.0, 1.0);
    float flow = 0.84 + 0.16 * sin(dot(vPos.xz, vec2(0.71, 0.93)) * 1.25 + vPos.y * 0.8 - uTime * 3.4);
    vec3 e = vTint * (2.45 + 0.9 * core * (2.0 - core)) * flow;
    oColor = vec4(applyFog(e, vPos, uCamPos) * uPreExpose, 1.0);
    return;
  }
  vec3 vd = uCamPos - vPos;
  float dcam = length(vd);
  vec3 v = dcam > 0.0001 ? vd / dcam : vec3(0.0, 0.0, 1.0);
  float dNear = 1.0 - smoothstep(16.0, 42.0, dcam);
  float dMid = 1.0 - smoothstep(30.0, 70.0, dcam);
  vec3 w = abs(n);
  w = w / max(w.x + w.y + w.z, 0.0001);
  float nA = triNoise(vPos, w, 1.7);
  float nB = triNoise(vPos, w, 7.9);
  float nC = triNoise(vPos, w, 0.155);
  vec2 puv = w.y > 0.5 ? vPos.xz : (w.x > w.z ? vPos.zy : vPos.xy);
  vec3 an = abs(n);
  bool floorish = an.y > 0.5 && uMat != 1;
  vec3 T = vec3(1.0, 0.0, 0.0);
  vec3 B = vec3(0.0, 0.0, 1.0);
  vec2 uv = vPos.xz;
  if (an.y <= 0.5){
    if (an.x > an.z){ uv = vPos.zy; T = vec3(0.0, 0.0, 1.0); B = vec3(0.0, 1.0, 0.0); }
    else { uv = vPos.xy; T = vec3(1.0, 0.0, 0.0); B = vec3(0.0, 1.0, 0.0); }
  }
  float pw = max(fwidth(uv.x), fwidth(uv.y));
  int tset = uMat == 1 ? (an.y > 0.5 ? 3 : 2) : (floorish ? 1 : 0);
  float tsc = tset == 1 ? 1.0 / 3.2 : (tset == 3 && uGen.y > 0.5 ? 1.0 / 1.6 : 1.0 / 2.4);
  vec2 tuv = uv * tsc;
  vec2 gdx = dFdx(tuv);
  vec2 gdy = dFdy(tuv);
  vec4 ta;
  vec4 tn;
  vec3 tavg;
  if (tset == 1){
    ta = textureGrad(uFloorA, tuv, gdx, gdy);
    tn = textureGrad(uFloorN, tuv, gdx, gdy);
    tavg = uFloorAvg;
  } else if (tset == 2){
    ta = textureGrad(uMetalA, tuv, gdx, gdy);
    tn = textureGrad(uMetalN, tuv, gdx, gdy);
    tavg = uMetalAvg;
  } else if (tset == 3){
    ta = textureGrad(uPlateA, tuv, gdx, gdy);
    tn = textureGrad(uPlateN, tuv, gdx, gdy);
    tavg = uPlateAvg;
  } else {
    ta = textureGrad(uPanelA, tuv, gdx, gdy);
    tn = textureGrad(uPanelN, tuv, gdx, gdy);
    tavg = uPanelAvg;
  }
  vec3 ratio = ta.rgb / max(tavg, vec3(0.03));
  float rl = dot(ratio, vec3(0.299, 0.587, 0.114));
  vec3 detail = mix(vec3(rl), ratio, 0.3);
  vec3 albedo;
  float specK;
  float gloss;
  float aniso = 1.0;
  float detK;
  int sk = uMat == 1 ? ((an.y > 0.5 ? uGen.y : uGen.x) > 0.5 ? 3 : 2) : (floorish ? 1 : 0);
  float wet = 0.0;
  if (uMat == 1){
    float streak = n2(vec2(vPos.y * 26.0, (vPos.x + vPos.z) * 1.3));
    float g = 0.185 + (nB - 0.5) * 0.05 + (streak - 0.5) * 0.055 + (nC - 0.5) * 0.05;
    vec3 temp = mix(vec3(0.92, 0.97, 1.10), vec3(1.09, 1.00, 0.90), smoothstep(0.36, 0.72, nC));
    albedo = vec3(g) * temp;
    specK = 0.34 + (nA - 0.5) * 0.16;
    gloss = 58.0;
    vec3 bt = normalize(cross(n, vec3(0.0, 1.0, 0.0)) + vec3(0.0001, 0.0, 0.0));
    vec3 shv = normalize(-uSunDir + v);
    aniso = 0.55 + 1.0 * pow(1.0 - abs(dot(shv, bt)), 3.0);
    detK = (an.y > 0.5 ? uGen.y : uGen.x) > 0.5 ? 0.72 : 0.5;
  } else if (uMat == 2){
    float g = 0.355 + (nC - 0.5) * 0.034;
    albedo = vec3(g, g * 0.99, g * 0.96);
    float chip = clamp(smoothstep(0.66, 0.30, vAO) * smoothstep(0.52, 0.82, nB) * (1.0 - vDetail.y * 0.7), 0.0, 1.0);
    albedo = mix(albedo, vec3(0.166, 0.162, 0.157), chip * 0.78);
    specK = 0.12 - chip * 0.06;
    gloss = 30.0;
    detK = 0.3;
  } else {
    float g = 0.300 + (nC - 0.5) * 0.105 + (nA - 0.5) * 0.045 + (nB - 0.5) * 0.026;
    if (dNear > 0.0){
      float vert = clamp(1.0 - abs(n.y) * 1.6, 0.0, 1.0);
      float grain = n2(puv * 31.0);
      float skn = n2(vec2(puv.x * 4.2, puv.y * 0.20));
      float run = smoothstep(0.52, 0.94, skn) * exp(-max(vDetail.x, 0.0) * 0.85) * vert;
      g += ((grain - 0.5) * 0.04 - run * 0.13) * dNear;
    }
    albedo = vec3(g, g * 0.995, g * 0.965);
    specK = 0.04;
    gloss = 14.0;
    detK = 0.62;
    if (floorish){
      wet = smoothstep(0.58, 0.80, n2(vPos.xz * 0.19 + 4.0)) * smoothstep(0.35, 0.6, n2(vPos.xz * 0.9));
      specK = mix(0.05, 0.30, wet);
      gloss = mix(16.0, 96.0, wet);
      albedo *= 1.0 - wet * 0.18;
    }
    float edge = (1.0 - clamp(vDetail.y, 0.0, 1.0)) * smoothstep(0.45, 0.75, nB);
    albedo *= 1.0 + edge * 0.10;
  }
  albedo *= mix(vec3(1.0), detail, detK);
  albedo *= vTint;
  vec3 tnn = tn.xyz * 2.0 - 1.0;
  float bumpK = (uMat == 1 ? 0.95 : 0.8) * (0.35 + 0.65 * dMid);
  vec3 nb = n * max(tnn.z, 0.25) + (T * tnn.x + B * tnn.y) * bumpK;
  float cav = 0.78 + 0.22 * tn.a;
  if (dNear > 0.0){
    float e = max(0.01, pw * 0.5);
    float h0 = structH(uv, sk, pw);
    float hu = structH(uv + vec2(e, 0.0), sk, pw);
    float hv = structH(uv + vec2(0.0, e), sk, pw);
    vec2 gr = vec2(hu - h0, hv - h0) / e;
    nb -= (T * gr.x + B * gr.y) * 0.016 * dNear;
    float grooveK = uMat == 1 ? 0.30 : 0.42;
    albedo *= 1.0 - clamp(-h0, 0.0, 1.0) * grooveK * dNear;
    albedo *= 1.0 + clamp(h0, 0.0, 1.0) * 0.25 * dNear;
    cav *= 1.0 - clamp(-h0, 0.0, 1.0) * 0.35 * dNear;
  }
  nb = normalize(nb);
  float sh = shadowAt();
  float ndl = max(dot(nb, -uSunDir), 0.0) * smoothstep(-0.02, 0.12, dot(n, -uSunDir));
  vec3 hv = normalize(-uSunDir + v);
  float spec = pow(max(dot(nb, hv), 0.0), gloss) * specK * ndl * sh * aniso;
  spec = spec * uSpecCap / (uSpecCap + spec);
  float sky = 0.60 + 0.40 * nb.y;
  vec3 amb = uAmbient * sky * vAO * (0.55 + 0.45 * vAO) * cav;
  amb += uSunColor * albedo.g * 0.035 * clamp(1.0 - nb.y, 0.0, 1.0) * vAO;
  vec3 col = albedo * (amb + uSunColor * ndl * sh * mix(1.0, cav, 0.5)) + uSunColor * spec;
  float fres = pow(1.0 - max(dot(nb, v), 0.0), 5.0);
  float refK = uMat == 1 ? 0.20 : (floorish ? 0.05 + wet * 0.45 : 0.025);
  col += skyTint(reflect(-v, nb)) * fres * refK * mix(0.6, 1.0, sh) * vAO;
  for (int i = 0; i < 8; i++){
    if (i >= uLightCount) break;
    vec3 ld = uLightPos[i] - vPos;
    float dl = length(ld);
    float att = clamp(1.0 - dl / max(uLightRadius[i], 0.001), 0.0, 1.0);
    att *= att;
    if (att <= 0.0) continue;
    vec3 l = ld / max(dl, 0.0001);
    float nl = max(dot(nb, l), 0.0);
    vec3 hl = normalize(l + v);
    float sp = pow(max(dot(nb, hl), 0.0), gloss) * (specK + 0.04);
    col += uLightColor[i] * att * (albedo * nl + sp * nl) * vAO * cav;
  }
  if (uMuzzle.w > 0.001){
    vec3 ld = uMuzzle.xyz - vPos;
    float dl = length(ld);
    float att = clamp(1.0 - dl / 14.0, 0.0, 1.0);
    att *= att * uMuzzle.w;
    if (att > 0.0){
      vec3 l = ld / max(dl, 0.0001);
      float nl = max(dot(nb, l), 0.0);
      vec3 hl = normalize(l + v);
      col += uMuzzleColor * att * (albedo * nl + pow(max(dot(nb, hl), 0.0), gloss) * specK * nl) * 2.9;
    }
  }
  oColor = vec4(applyFog(col, vPos, uCamPos) * uPreExpose, 1.0);
}`;

export const FS_SKY_E = `#version 300 es
precision highp float;
in vec3 vRay;
uniform vec3 uZenith;
uniform vec3 uGround;
uniform float uPreExpose;
uniform float uStars;
uniform sampler2D uVoid;
uniform float uVoidOn;
uniform vec3 uVoidBand;
out vec4 oColor;
${NOISE}
${FOG}
void main(){
  vec3 rd = normalize(vRay);
  float up = clamp(rd.y, 0.0, 1.0);
  float sd = max(dot(rd, -uSunDir), 0.0);
  float sunUp = clamp(-uSunDir.y, -1.0, 1.0);
  float day = smoothstep(-0.09, 0.06, sunUp);
  vec3 col = mix(uFogColor, uZenith, pow(up, 0.55));
  col = mix(col, uZenith * 0.30 + vec3(0.003, 0.005, 0.016), pow(up, 2.2) * 0.62);
  float hazeA = exp(-abs(rd.y) * 17.0);
  float hazeB = exp(-abs(rd.y) * 4.4);
  float hazeC = exp(-abs(rd.y) * 1.5);
  vec3 warm = mix(uFogColor, uSunColor, 0.55);
  float lowSun = mix(0.62, 1.0, smoothstep(0.04, 0.34, sunUp));
  float toward = 0.20 + 0.80 * pow(sd * 0.5 + 0.5, 5.0);
  col += warm * (hazeA * 0.46 + hazeB * 0.16 + hazeC * 0.05) * toward * day * lowSun;
  float elev = rd.y / max(length(rd.xz), 0.0001);
  float az = atan(rd.x, rd.z);
  float u = az * 0.15915494 + 0.5;
  if (uStars > 0.001 && rd.y > 0.05){
    vec2 sp = vec2(u * 900.0, elev * 140.0);
    vec2 ci = floor(sp);
    vec2 cf = fract(sp) - 0.5;
    float hs = h21(ci + 13.0);
    vec2 off = vec2(h21(ci + 7.1), h21(ci + 3.3)) - 0.5;
    float star = step(0.986, hs) * (1.0 - smoothstep(0.05, 0.22, length(cf - off * 0.5)));
    float tw = 0.55 + 0.45 * sin(uTime * (1.7 + hs * 6.0) + hs * 40.0);
    col += vec3(0.75, 0.82, 1.0) * star * tw * uStars * smoothstep(0.05, 0.5, rd.y) * 0.9;
  }
  if (rd.y > 0.0){
    vec2 cp = rd.xz / (rd.y + 0.16) * 0.85 + vec2(uTime * 0.0045, uTime * 0.0016);
    float c = fbm4(cp * 1.6);
    float c2 = n2(cp * 7.0 + 3.1);
    float dens = smoothstep(0.50, 0.80, c * 0.86 + c2 * 0.14);
    float hor = smoothstep(0.0, 0.16, rd.y) * (1.0 - smoothstep(0.75, 1.0, rd.y) * 0.5);
    float a = dens * hor * 0.82 * (1.0 - 0.75 * pow(sd, 60.0));
    float tw2 = pow(sd, 2.5);
    vec3 lit = mix(uFogColor * 0.92 + uZenith * 0.25, uSunColor * 0.26 + uFogColor * 0.55, clamp(tw2 * 0.9 + 0.1, 0.0, 1.0));
    vec3 cc = lit * (0.78 + 0.30 * (1.0 - c2));
    cc += uSunColor * pow(sd, 10.0) * (1.0 - dens) * dens * 0.9 * day;
    col = mix(col, cc, a);
  }
  float band = n2(rd.xz * 3.0 + rd.y * 2.0) - 0.5;
  col *= 1.0 + band * 0.05;
  float farCell = floor(u * 170.0);
  float fh = h11(farCell * 1.37 + 3.0);
  float farH = 0.010 + fh * fh * 0.052;
  float nearCell = floor(u * 58.0);
  float nh = h11(nearCell * 2.17 + 11.0);
  float nearH = nh > 0.55 ? 0.016 + (nh - 0.55) * 0.17 : 0.006 + nh * 0.022;
  float sub = fract(u * 58.0);
  float mast = h11(nearCell * 5.3 + 1.0) > 0.80 ? 0.20 + h11(nearCell * 7.7) * 0.17 : 0.0;
  float mastW = 0.022;
  float isMast = mast > 0.0 && abs(sub - 0.5) < mastW ? 1.0 : 0.0;
  float topNear = max(nearH, mast * isMast);
  vec3 silFar = mix(uFogColor, uGround, 0.22) * (0.94 + 0.10 * toward);
  vec3 silNear = mix(uFogColor, uGround, 0.55) * (0.86 + 0.12 * toward);
  if (uVoidOn > 0.5){
    float vv = 1.0 - (elev - uVoidBand.x) / (uVoidBand.y - uVoidBand.x);
    if (vv > 0.0 && vv < 1.0){
      vec4 bd = textureLod(uVoid, vec2(u * uVoidBand.z, vv), 0.0);
      bd.a *= smoothstep(0.02, 0.30, vv);
      vec3 bl = pow(bd.rgb, vec3(2.2)) * 0.55;
      bl = mix(bl, uFogColor, 0.35 + 0.25 * hazeB);
      col = mix(col, bl, bd.a);
    }
  } else {
    if (elev < farH && elev > -0.02) col = mix(col, silFar, 0.55);
    if (elev < topNear && elev > -0.02){
      col = mix(col, silNear, 0.8);
      vec2 wg = vec2(u * 58.0 * 9.0, elev * 260.0);
      float win = step(0.972, h21(floor(wg) + nearCell)) * (1.0 - isMast) * step(elev, nearH - 0.006);
      col += vec3(1.0, 0.72, 0.34) * win * 0.06;
    }
    if (mast > 0.0){
      vec2 bq = vec2((sub - 0.5) * 6.2, (elev - mast) * 57.3);
      float blink = step(0.45, fract(uTime * 0.55 + h11(nearCell * 3.1)));
      float bcn = exp(-dot(bq, bq) * 22.0) * blink;
      vec3 bc = h11(nearCell * 9.1) > 0.5 ? vec3(1.0, 0.25, 0.12) : vec3(0.43, 0.95, 0.77);
      col += bc * bcn * 2.2;
    }
  }
  col = mix(col, uGround, clamp(-rd.y * 3.2, 0.0, 1.0));
  float disc = smoothstep(0.99988, 0.99997, sd);
  col += uSunColor * (disc * 5.5 + pow(sd, 260.0) * 0.85 + (pow(sd, 34.0) * 0.26 + pow(sd, 7.0) * 0.05) * lowSun) * day;
  oColor = vec4(col * uPreExpose, 1.0);
}`;

export const FS_TARGET_E = `#version 300 es
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
uniform float uPreExpose;
uniform float uHit;
uniform float uSpawn;
out vec4 oColor;
${NOISE}
${FOG}
void main(){
  float sq = max(abs(vUv.x), abs(vUv.y));
  float rd = length(vUv);
  float dis = clamp(uDownAge / 0.62, 0.0, 1.0) * uDown;
  float nz = n2(vUv * 5.5 + uSeed * 3.0) * 0.65 + n2(vUv * 17.0 - uSeed) * 0.35;
  float front = dis * 1.12 - 0.06;
  if (uDown > 0.5 && nz < front) discard;
  float scan = uSpawn < 1.0 ? step(vUv.y * 0.5 + 0.5, uSpawn * 1.15) : 1.0;
  if (scan < 0.5) discard;
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
  float spin = abs(fract((ang + uTime * 0.6) * 0.15915494 * 3.0) - 0.5) * 2.0;
  float sweep = smoothstep(0.75, 1.0, spin) * smoothstep(0.735, 0.756, rd) * (1.0 - smoothstep(0.844, 0.866, rd));
  float pulse = 0.86 + 0.14 * sin(uTime * 3.1415927 + uSeed);
  float core = (1.0 - smoothstep(0.215, 0.268, rd)) * pulse;
  float coreRing = smoothstep(0.300, 0.316, rd) * (1.0 - smoothstep(0.336, 0.354, rd));
  float halo = pow(max(0.0, 1.0 - rd * 0.80), 3.6) * 0.30;
  vec3 emis = uMint * (ring * 3.3 + sweep * 1.6 + tick * 2.3 + coreRing * 1.25 + halo) + uAmberC * core * 2.8;
  col += emis * (1.0 - uDown);
  col += vec3(1.0, 0.95, 0.85) * uHit * (ring * 4.0 + core * 2.5 + 0.35);
  if (uDown > 0.5){
    float crack = 1.0 - smoothstep(0.0, 0.06, abs(n2(vUv * 9.0 + uSeed * 7.0) - 0.5));
    col += uMint * crack * 3.0 * (1.0 - dis);
    float edge = 1.0 - smoothstep(0.0, 0.09, nz - front);
    col += mix(uMint, uAmberC, 0.35) * edge * 5.0;
    col *= mix(1.0, 0.55, dis);
  }
  col += uMint * (1.0 - smoothstep(0.0, 0.05, abs(vUv.y * 0.5 + 0.5 - uSpawn * 1.15))) * step(uSpawn, 0.999) * 3.0;
  oColor = vec4(applyFog(col, vPos, uCamPos) * uPreExpose, 1.0);
}`;

export const FS_VIEWMODEL_E = `#version 300 es
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
uniform float uTime;
uniform vec3 uRimColor;
out vec4 oColor;
${NOISE}
void main(){
  if (uMat == 3){
    float pulse = 0.88 + 0.12 * sin(uTime * 2.6 + vLocal.z * 30.0);
    oColor = vec4(vTint * 2.4 * pulse * uPreExpose, 1.0);
    return;
  }
  vec3 n = normalize(vNormal);
  vec3 v = normalize(-vView);
  float wear = n2(vLocal.xz * 120.0) * 0.5 + n2(vLocal.yz * 95.0) * 0.5;
  float machined = n2(vec2(vLocal.z * 900.0, vLocal.y * 20.0));
  vec3 albedo = vTint * (0.86 + wear * 0.20 + machined * 0.05);
  float edge = smoothstep(0.62, 0.92, wear) * (uMat == 1 ? 1.0 : 0.4);
  albedo = mix(albedo, albedo * 1.9 + vec3(0.02), edge * 0.25);
  n = normalize(n + vec3((n2(vLocal.zy * 300.0) - 0.5) * 0.10, (n2(vLocal.xz * 280.0) - 0.5) * 0.10, 0.0));
  float specK = uMat == 1 ? 0.48 : 0.11;
  float gloss = uMat == 1 ? 64.0 : 22.0;
  float key = max(dot(n, -uSunCam), 0.0);
  float fill = max(dot(n, normalize(vec3(0.45, 0.55, 0.70))), 0.0);
  vec3 hv = normalize(-uSunCam + v);
  float spec = pow(max(dot(n, hv), 0.0), gloss) * specK * (0.6 + edge);
  spec = spec * uSpecCap / (uSpecCap + spec);
  vec3 col = albedo * (uAmbient * 1.8 * vAO + uSunColor * key * 0.85 + vec3(0.20, 0.24, 0.31) * fill * 0.6) + uSunColor * spec;
  vec3 fd = vView - uFlashPos;
  float fl = uFlash / (1.0 + dot(fd, fd) * 11.0);
  col += albedo * vec3(1.0, 0.74, 0.38) * fl * 4.2;
  float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  col += uRimColor * rim * 0.22 + vec3(0.30, 0.40, 0.50) * rim * 0.08;
  oColor = vec4(col * uPreExpose, 1.0);
}`;

export const FS_FLASH_E = `#version 300 es
precision highp float;
in vec2 vUv;
uniform float uIntensity;
uniform float uPreExpose;
uniform float uSpin;
out vec4 oColor;
void main(){
  float c = cos(uSpin), s = sin(uSpin);
  vec2 p = vec2(vUv.x * c - vUv.y * s, vUv.x * s + vUv.y * c);
  float r = length(p);
  float core = pow(max(0.0, 1.0 - r * 1.15), 2.4);
  float a = atan(p.y, p.x);
  float petals = pow(abs(cos(a * 2.5)), 6.0) * pow(max(0.0, 1.0 - r), 1.6);
  float bx = pow(max(0.0, 1.0 - abs(p.x)) * max(0.0, 1.0 - abs(p.y) * 6.5), 3.0);
  float s2 = core * 1.2 + petals * 0.9 + bx * 0.5;
  vec3 hot = mix(vec3(1.0, 0.62, 0.26), vec3(1.0, 0.93, 0.78), core);
  oColor = vec4(hot * s2 * uIntensity * 4.6 * uPreExpose, 1.0);
}`;

export const FS_TRACER_E = `#version 300 es
precision highp float;
in float vSide;
in float vFade;
uniform float uPreExpose;
out vec4 oColor;
void main(){
  float p = 1.0 - abs(vSide);
  float core = pow(p, 6.0);
  float glow = p * p * 0.45;
  vec3 c = (vec3(1.0, 0.86, 0.58) * core * 3.4 + mix(vec3(1.0, 0.70, 0.36), vec3(0.45, 1.0, 0.82), 0.35) * glow * 1.6) * vFade;
  oColor = vec4(c * uPreExpose, 1.0);
}`;

export const VS_PART = `#version 300 es
layout(location=0) in vec2 aCorner;
layout(location=1) in vec3 aIPos;
layout(location=2) in vec3 aIVel;
layout(location=3) in vec3 aISize;
layout(location=4) in vec4 aIColor;
uniform mat4 uViewProj;
uniform vec3 uCamPos;
uniform vec3 uRight;
uniform vec3 uUp;
out vec2 vUv;
out vec4 vColor;
out float vShape;
void main(){
  vUv = aCorner;
  vColor = aIColor;
  vShape = aISize.z;
  vec3 p = aIPos;
  float s = aISize.x;
  if (aISize.y > 0.0){
    vec3 toCam = normalize(uCamPos - p);
    vec3 vel = aIVel - toCam * dot(aIVel, toCam);
    float vl = length(vel);
    if (vl > 0.01){
      vec3 dir = vel / vl;
      vec3 ax = normalize(cross(dir, toCam));
      float hl = vl * aISize.y * 0.5 + (aISize.z > 3.5 ? 0.0 : s);
      vec3 c = p - dir * (vl * aISize.y * 0.5);
      gl_Position = uViewProj * vec4(c + ax * (aCorner.x * s) + dir * (aCorner.y * hl), 1.0);
      return;
    }
  }
  gl_Position = uViewProj * vec4(p + uRight * (aCorner.x * s) + uUp * (aCorner.y * s), 1.0);
}`;

export const FS_PART = `#version 300 es
precision highp float;
in vec2 vUv;
in vec4 vColor;
in float vShape;
uniform float uPreExpose;
out vec4 oColor;
void main(){
  float a;
  if (vShape < 0.5){
    float r = length(vUv);
    a = pow(max(0.0, 1.0 - r), 1.8);
  } else if (vShape < 1.5){
    a = (1.0 - smoothstep(0.35, 1.0, abs(vUv.x))) * (1.0 - smoothstep(0.55, 1.0, abs(vUv.y)));
  } else if (vShape < 2.5){
    a = 1.0 - smoothstep(0.70, 1.0, max(abs(vUv.x), abs(vUv.y)));
  } else if (vShape < 3.5){
    float r = length(vUv);
    a = smoothstep(0.55, 0.85, r) * (1.0 - smoothstep(0.85, 1.0, r));
  } else {
    float t = vUv.y * 0.5 + 0.5;
    float w = mix(0.16, 1.0, t);
    float ax = abs(vUv.x) / w;
    a = (1.0 - smoothstep(0.0, 1.0, ax)) * (1.0 - ax * 0.35) * smoothstep(0.0, 0.10, t) * (1.0 - smoothstep(0.70, 1.0, t)) * (1.0 - t * 0.55);
  }
  oColor = vec4(vColor.rgb * a * uPreExpose, vColor.a * a);
}`;

export const VS_DECAL = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec2 aUv;
layout(location=2) in float aAlpha;
layout(location=3) in float aHeat;
uniform mat4 uViewProj;
out vec2 vUv;
out float vAlpha;
out float vHeat;
out vec3 vPos;
void main(){
  vUv = aUv;
  vAlpha = aAlpha;
  vHeat = aHeat;
  vPos = aPos;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}`;

export const FS_DECAL = `#version 300 es
precision highp float;
in vec2 vUv;
in float vAlpha;
in float vHeat;
in vec3 vPos;
uniform vec3 uCamPos;
uniform float uPreExpose;
uniform vec3 uTint;
out vec4 oColor;
${NOISE}
${FOG}
void main(){
  float r = length(vUv);
  float nz = n2(vUv * 3.2 + vPos.xz * 5.0 + vPos.y * 3.0);
  float a = (1.0 - smoothstep(0.50, 1.0, r + (nz - 0.5) * 0.45)) * vAlpha;
  if (a <= 0.003) discard;
  float core = 1.0 - smoothstep(0.16, 0.34, r + (nz - 0.5) * 0.16);
  vec3 c = mix(uTint, vec3(0.008, 0.008, 0.009), core);
  a *= mix(0.72, 1.0, core);
  vec3 glow = vec3(1.9, 0.62, 0.16) * vHeat * core * 2.2;
  oColor = vec4((applyFog(c, vPos, uCamPos) * a + glow) * uPreExpose, a);
}`;

export const FS_DOWN = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
uniform vec2 uTexel;
out vec4 oColor;
void main(){
  vec2 t = uTexel;
  vec3 a = texture(uSrc, vUv + t * vec2(-2.0, -2.0)).rgb;
  vec3 b = texture(uSrc, vUv + t * vec2(0.0, -2.0)).rgb;
  vec3 c = texture(uSrc, vUv + t * vec2(2.0, -2.0)).rgb;
  vec3 d = texture(uSrc, vUv + t * vec2(-2.0, 0.0)).rgb;
  vec3 e = texture(uSrc, vUv).rgb;
  vec3 f = texture(uSrc, vUv + t * vec2(2.0, 0.0)).rgb;
  vec3 g = texture(uSrc, vUv + t * vec2(-2.0, 2.0)).rgb;
  vec3 h = texture(uSrc, vUv + t * vec2(0.0, 2.0)).rgb;
  vec3 i = texture(uSrc, vUv + t * vec2(2.0, 2.0)).rgb;
  vec3 j = texture(uSrc, vUv + t * vec2(-1.0, -1.0)).rgb;
  vec3 k = texture(uSrc, vUv + t * vec2(1.0, -1.0)).rgb;
  vec3 l = texture(uSrc, vUv + t * vec2(-1.0, 1.0)).rgb;
  vec3 m = texture(uSrc, vUv + t * vec2(1.0, 1.0)).rgb;
  vec3 o = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  oColor = vec4(o, 1.0);
}`;

export const FS_UP = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
uniform sampler2D uBase;
uniform vec2 uTexel;
uniform float uScatter;
out vec4 oColor;
void main(){
  vec2 t = uTexel;
  vec3 s = texture(uSrc, vUv).rgb * 4.0;
  s += (texture(uSrc, vUv + vec2(-t.x, 0.0)).rgb + texture(uSrc, vUv + vec2(t.x, 0.0)).rgb + texture(uSrc, vUv + vec2(0.0, -t.y)).rgb + texture(uSrc, vUv + vec2(0.0, t.y)).rgb) * 2.0;
  s += texture(uSrc, vUv + vec2(-t.x, -t.y)).rgb + texture(uSrc, vUv + vec2(t.x, -t.y)).rgb + texture(uSrc, vUv + vec2(-t.x, t.y)).rgb + texture(uSrc, vUv + vec2(t.x, t.y)).rgb;
  s *= 0.0625;
  oColor = vec4(texture(uBase, vUv).rgb + s * uScatter, 1.0);
}`;

export const FS_RAYS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;
uniform vec2 uSun;
uniform float uThreshold;
uniform float uAspect;
out vec4 oColor;
void main(){
  vec2 uv = vUv;
  vec2 d = (uSun - vUv) * (0.92 / 36.0);
  float decay = 1.0;
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 36; i++){
    vec3 s = texture(uScene, uv).rgb;
    float l = dot(s, vec3(0.2126, 0.7152, 0.0722));
    float m = max(l - uThreshold, 0.0);
    acc += s * (min(m, 6.0) / max(l, 0.0001)) * decay;
    decay *= 0.962;
    uv += d;
  }
  vec2 dd = (vUv - uSun) * vec2(uAspect, 1.0);
  float prox = exp(-dot(dd, dd) * 2.6);
  oColor = vec4(acc * (prox / 36.0), 1.0);
}`;

export const FS_COMPOSITE_E = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform sampler2D uRays;
uniform float uExposure;
uniform float uBloomStrength;
uniform float uGrain;
uniform float uTime;
uniform vec2 uRes;
uniform float uAspect;
uniform float uGlitch;
uniform vec3 uRayColor;
uniform float uRayStrength;
out vec4 oColor;
${NOISE}
vec3 aces(vec3 x){
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
void main(){
  vec2 uv = vUv;
  vec3 c;
  vec2 dc = uv - 0.5;
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
#else
  c = texture(uScene, uv).rgb;
#endif
  c *= uExposure;
  c += texture(uBloom, uv).rgb * uBloomStrength;
  c += texture(uRays, uv).rgb * uRayColor * uRayStrength;
  c = aces(c);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(c, c * vec3(0.90, 1.0, 1.08), (1.0 - l) * 0.30);
  c = mix(c, c * vec3(1.05, 1.0, 0.94), l * 0.22);
  c = pow(max(c, vec3(0.0)), vec3(0.4545454));
  vec2 vd = dc * vec2(uAspect, 1.0) * 2.0;
  float vig = 1.0 - smoothstep(0.62, 1.85, length(vd)) * 0.50;
  c *= vig;
  c += (h21(uv * uRes + fract(uTime * 7.31) * 113.0) - 0.5) * uGrain;
#ifdef GLITCH
  float edge = smoothstep(0.30, 1.05, length(vd));
  c += (h21(uv * uRes * 1.7 + uTime * 91.0) - 0.5) * edge * g * 0.75;
  c *= 1.0 - 0.16 * g * step(0.5, fract(uv.y * uRes.y * 0.5));
  c = mix(c, vec3(dot(c, vec3(0.3, 0.6, 0.1))), g * 0.25);
#endif
  oColor = vec4(max(c, vec3(0.0)), 1.0);
}`;

function hashU(i){
  let x = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

function rng(seed){
  let s = seed >>> 0;
  return function(){
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function periodicNoise(size, cells, seed){
  const out = new Float32Array(size * size);
  const lat = new Float32Array(cells * cells);
  for (let i = 0; i < lat.length; i++) lat[i] = hashU(i * 7919 + seed * 104729);
  const step = cells / size;
  for (let y = 0; y < size; y++){
    const fy = y * step;
    const iy = Math.floor(fy);
    let ty = fy - iy;
    ty = ty * ty * (3 - 2 * ty);
    const y0 = iy % cells, y1 = (iy + 1) % cells;
    for (let x = 0; x < size; x++){
      const fx = x * step;
      const ix = Math.floor(fx);
      let tx = fx - ix;
      tx = tx * tx * (3 - 2 * tx);
      const x0 = ix % cells, x1 = (ix + 1) % cells;
      const a = lat[y0 * cells + x0], b = lat[y0 * cells + x1];
      const c = lat[y1 * cells + x0], d = lat[y1 * cells + x1];
      out[y * size + x] = (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty;
    }
  }
  return out;
}

function fbm(size, cells, octaves, seed){
  const out = new Float32Array(size * size);
  let amp = 0.5, total = 0;
  for (let o = 0; o < octaves; o++){
    const n = periodicNoise(size, Math.min(size, cells << o), seed + o * 31);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

function stamp(size, buf, cx, cy, r, fn){
  const r2 = r * r;
  const x0 = Math.floor(cx - r), x1 = Math.ceil(cx + r);
  const y0 = Math.floor(cy - r), y1 = Math.ceil(cy + r);
  for (let y = y0; y <= y1; y++){
    for (let x = x0; x <= x1; x++){
      const dx = x - cx, dy = y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const wx = ((x % size) + size) % size, wy = ((y % size) + size) % size;
      fn(wy * size + wx, 1 - Math.sqrt(d2) / r);
    }
  }
}

function heightToNormal(size, height, strength){
  const out = new Uint8Array(size * size * 4);
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < height.length; i++){ const v = height[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
  const span = mx - mn > 1e-6 ? mx - mn : 1;
  for (let y = 0; y < size; y++){
    const ym = ((y - 1 + size) % size) * size, yp = ((y + 1) % size) * size;
    for (let x = 0; x < size; x++){
      const xm = (x - 1 + size) % size, xp = (x + 1) % size;
      const dx = (height[y * size + xm] - height[y * size + xp]) * strength;
      const dy = (height[ym + x] - height[yp + x]) * strength;
      const l = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const o = (y * size + x) * 4;
      out[o] = Math.round((dx * l * 0.5 + 0.5) * 255);
      out[o + 1] = Math.round((dy * l * 0.5 + 0.5) * 255);
      out[o + 2] = Math.round((l * 0.5 + 0.5) * 255);
      out[o + 3] = Math.round(((height[y * size + x] - mn) / span) * 255);
    }
  }
  return out;
}

function packAlbedo(size, lum, tint){
  const out = new Uint8Array(size * size * 4);
  let sr = 0, sg = 0, sb = 0;
  for (let i = 0; i < size * size; i++){
    const v = Math.max(0, Math.min(1, lum[i]));
    const r = Math.round(v * tint[0] * 255), g = Math.round(v * tint[1] * 255), b = Math.round(v * tint[2] * 255);
    out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b; out[i * 4 + 3] = 255;
    sr += r; sg += g; sb += b;
  }
  const n = size * size * 255;
  return { data: out, avg: [sr / n, sg / n, sb / n] };
}

export function makePanelTexture(size){
  const S = size || 512;
  const r = rng(1337);
  const mott = fbm(S, 4, 4, 11);
  const grain = periodicNoise(S, 128, 5);
  const streakU = periodicNoise(S, 64, 9);
  const streakV = periodicNoise(S, 4, 17);
  const lum = new Float32Array(S * S);
  const h = new Float32Array(S * S);
  for (let y = 0; y < S; y++){
    for (let x = 0; x < S; x++){
      const i = y * S + x;
      const st = Math.max(0, streakU[(y % S) * S + x] - 0.55) * streakV[i] * 2.2;
      lum[i] = 0.5 + (mott[i] - 0.5) * 0.22 + (grain[i] - 0.5) * 0.07 + (r() - 0.5) * 0.035 - st * 0.12;
      h[i] = mott[i] * 0.6 + grain[i] * 0.35 + (r() - 0.5) * 0.08;
    }
  }
  for (let k = 0; k < 380; k++){
    const cx = r() * S, cy = r() * S, rad = 0.9 + r() * 2.2;
    stamp(S, lum, cx, cy, rad, (i, f) => { lum[i] -= 0.09 * f; h[i] -= 0.8 * f; });
  }
  for (let k = 0; k < 70; k++){
    let x = r() * S, y = r() * S;
    const a = r() * Math.PI * 2, len = 10 + r() * 50;
    const dx = Math.cos(a), dy = Math.sin(a);
    for (let s = 0; s < len; s++){
      const wx = ((Math.round(x) % S) + S) % S, wy = ((Math.round(y) % S) + S) % S;
      lum[wy * S + wx] += 0.05;
      h[wy * S + wx] -= 0.25;
      x += dx; y += dy;
    }
  }
  const alb = packAlbedo(S, lum, [1, 1, 1]);
  return { size: S, albedo: alb.data, avg: alb.avg, normal: heightToNormal(S, h, 1.7) };
}

export function makeFloorTexture(size){
  const S = size || 512;
  const r = rng(4242);
  const mott = fbm(S, 3, 5, 23);
  const grain = periodicNoise(S, 160, 29);
  const lum = new Float32Array(S * S);
  const h = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++){
    lum[i] = 0.5 + (mott[i] - 0.5) * 0.20 + (grain[i] - 0.5) * 0.06 + (r() - 0.5) * 0.03;
    h[i] = mott[i] * 0.5 + grain[i] * 0.3;
  }
  for (let k = 0; k < 4200; k++){
    const cx = r() * S, cy = r() * S, rad = 0.7 + r() * 1.6;
    const sgn = r() < 0.55 ? 1 : -1;
    const amt = 0.05 + r() * 0.10;
    stamp(S, lum, cx, cy, rad, (i, f) => { lum[i] += sgn * amt * f; h[i] += sgn * 0.35 * f; });
  }
  for (let k = 0; k < 28; k++){
    const cx = r() * S, cy = r() * S;
    const a = r() * Math.PI, len = 20 + r() * 60, wid = 3 + r() * 6;
    const dx = Math.cos(a), dy = Math.sin(a);
    for (let s = -len; s < len; s += 1.5){
      stamp(S, lum, cx + dx * s, cy + dy * s, wid * (1 - Math.abs(s) / len), (i, f) => { lum[i] -= 0.012 * f; });
    }
  }
  for (let k = 0; k < 4; k++){
    let x = r() * S, y = r() * S;
    let a = r() * Math.PI * 2;
    const steps = 90 + Math.floor(r() * 160);
    for (let s = 0; s < steps; s++){
      a += (r() - 0.5) * 0.35;
      x += Math.cos(a); y += Math.sin(a);
      const wx = ((Math.round(x) % S) + S) % S, wy = ((Math.round(y) % S) + S) % S;
      lum[wy * S + wx] *= 0.88;
      h[wy * S + wx] -= 0.5;
    }
  }
  const alb = packAlbedo(S, lum, [1, 0.995, 0.97]);
  return { size: S, albedo: alb.data, avg: alb.avg, normal: heightToNormal(S, h, 2.2) };
}

export function textureFromImage(img, maxSize){
  const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
  if (!(w0 > 0 && h0 > 0)) return null;
  const S = Math.min(maxSize || 768, w0, h0);
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, S, S);
  const px = ctx.getImageData(0, 0, S, S).data;
  const albedo = new Uint8Array(px.length);
  const lum = new Float32Array(S * S);
  let sr = 0, sg = 0, sb = 0;
  for (let i = 0; i < S * S; i++){
    const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
    albedo[i * 4] = r; albedo[i * 4 + 1] = g; albedo[i * 4 + 2] = b; albedo[i * 4 + 3] = 255;
    sr += r; sg += g; sb += b;
    lum[i] = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
  }
  const blur = new Float32Array(S * S);
  for (let y = 0; y < S; y++){
    for (let x = 0; x < S; x++){
      let s = 0;
      for (let oy = -1; oy <= 1; oy++){
        const yy = ((y + oy + S) % S) * S;
        for (let ox = -1; ox <= 1; ox++) s += lum[yy + ((x + ox + S) % S)];
      }
      blur[y * S + x] = s / 9;
    }
  }
  const n = S * S * 255;
  return { size: S, albedo: albedo, avg: [sr / n, sg / n, sb / n], normal: heightToNormal(S, blur, 3.2 * (S / 512)) };
}

export function horizonOf(img){
  try {
    const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
    if (!(w0 > 0 && h0 > 0)) return 0.7;
    const W = 96, H = Math.max(8, Math.min(256, h0));
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return 0.7;
    ctx.drawImage(img, 0, 0, W, H);
    const d = ctx.getImageData(0, 0, W, H).data;
    for (let y = 0; y < H; y++){
      let a = 0;
      for (let x = 0; x < W; x++) a += d[(y * W + x) * 4 + 3];
      if (a / W >= 204) return y / H;
    }
  } catch (_) {}
  return 0.7;
}

export function loadImage(url){
  return new Promise((resolve) => {
    if (typeof Image === 'undefined') { resolve(null); return; }
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export function defaultGraphics(gl){
  try {
    const nav = typeof navigator !== 'undefined' ? navigator : {};
    const touch = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches;
    const mem = typeof nav.deviceMemory === 'number' ? nav.deviceMemory : 8;
    const cores = typeof nav.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : 8;
    let gpu = '';
    if (gl){
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      gpu = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) || '').toLowerCase();
      const hdrOk = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
      if (!hdrOk) return GFX_CLASSIC;
      if (gl.getParameter(gl.MAX_TEXTURE_SIZE) < 4096) return GFX_CLASSIC;
    }
    if (/swiftshader|llvmpipe|software|basic render/.test(gpu)) return GFX_CLASSIC;
    if (!touch) return GFX_ENHANCED;
    if (mem < 4 || cores < 4) return GFX_CLASSIC;
    const adreno = /adreno[^0-9]{0,8}(\d{3})/.exec(gpu);
    if (adreno && +adreno[1] < 615) return GFX_CLASSIC;
    if (/mali-(t|4|g3\d\b|g5\d\b|g7[12]\b)|powervr|sgx|videocore/.test(gpu)) return GFX_CLASSIC;
    return GFX_ENHANCED;
  } catch (_) {
    return GFX_ENHANCED;
  }
}

export const PART_FLOATS = 13;
const KIND_SOFT = 0;
const KIND_STREAK = 1;
const KIND_CHUNK = 2;

export function createParticles(max){
  const N = max || 900;
  const px = new Float32Array(N), py = new Float32Array(N), pz = new Float32Array(N);
  const vx = new Float32Array(N), vy = new Float32Array(N), vz = new Float32Array(N);
  const age = new Float32Array(N), life = new Float32Array(N);
  const s0 = new Float32Array(N), s1 = new Float32Array(N), stretch = new Float32Array(N);
  const shape = new Float32Array(N), grav = new Float32Array(N), drag = new Float32Array(N);
  const cr = new Float32Array(N), cg = new Float32Array(N), cb = new Float32Array(N), ca = new Float32Array(N);
  const blend = new Uint8Array(N), live = new Uint8Array(N), fadeIn = new Float32Array(N);
  const floorY = new Float32Array(N);
  const add = new Float32Array(N * PART_FLOATS);
  const alpha = new Float32Array(N * PART_FLOATS);
  let cursor = 0;
  let count = 0;
  const rnd = rng(77);

  function alloc(){
    for (let k = 0; k < N; k++){
      const i = (cursor + k) % N;
      if (!live[i]){ cursor = (i + 1) % N; return i; }
    }
    const i = cursor;
    cursor = (cursor + 1) % N;
    return i;
  }

  function spawn(o){
    const i = alloc();
    if (!live[i]) count++;
    live[i] = 1;
    px[i] = o.x; py[i] = o.y; pz[i] = o.z;
    vx[i] = o.vx || 0; vy[i] = o.vy || 0; vz[i] = o.vz || 0;
    age[i] = 0; life[i] = o.life || 0.5;
    s0[i] = o.size || 0.02; s1[i] = o.size1 !== undefined ? o.size1 : s0[i];
    stretch[i] = o.stretch || 0;
    shape[i] = o.shape || 0;
    grav[i] = o.gravity || 0;
    drag[i] = o.drag !== undefined ? o.drag : 0;
    cr[i] = o.r; cg[i] = o.g; cb[i] = o.b; ca[i] = o.a !== undefined ? o.a : 1;
    blend[i] = o.alpha ? 1 : 0;
    fadeIn[i] = o.fadeIn || 0;
    floorY[i] = o.floorY !== undefined ? o.floorY : -1e9;
    return i;
  }

  function clear(){
    live.fill(0);
    count = 0;
  }

  function update(dt){
    if (count === 0) return;
    let c = 0;
    for (let i = 0; i < N; i++){
      if (!live[i]) continue;
      age[i] += dt;
      if (age[i] >= life[i]){ live[i] = 0; continue; }
      c++;
      vy[i] -= 9.8 * grav[i] * dt;
      if (drag[i] > 0){
        const k = Math.exp(-drag[i] * dt);
        vx[i] *= k; vy[i] *= k; vz[i] *= k;
      }
      px[i] += vx[i] * dt; py[i] += vy[i] * dt; pz[i] += vz[i] * dt;
      if (py[i] < floorY[i]){
        py[i] = floorY[i];
        if (vy[i] < 0){ vy[i] = -vy[i] * 0.32; vx[i] *= 0.6; vz[i] *= 0.6; }
      }
    }
    count = c;
  }

  function fill(){
    let na = 0, nb = 0;
    for (let i = 0; i < N; i++){
      if (!live[i]) continue;
      const t = age[i] / life[i];
      let f = 1 - t;
      if (shape[i] === KIND_SOFT && blend[i]) f = f * f;
      else f = f * f * (3 - 2 * f);
      if (fadeIn[i] > 0) f *= Math.min(1, age[i] / fadeIn[i]);
      const size = s0[i] + (s1[i] - s0[i]) * t;
      const dst = blend[i] ? alpha : add;
      const o = (blend[i] ? nb++ : na++) * PART_FLOATS;
      dst[o] = px[i]; dst[o + 1] = py[i]; dst[o + 2] = pz[i];
      dst[o + 3] = vx[i]; dst[o + 4] = vy[i]; dst[o + 5] = vz[i];
      dst[o + 6] = size; dst[o + 7] = stretch[i]; dst[o + 8] = shape[i];
      const a = ca[i] * f;
      if (blend[i]){
        dst[o + 9] = cr[i] * a; dst[o + 10] = cg[i] * a; dst[o + 11] = cb[i] * a; dst[o + 12] = a;
      } else {
        dst[o + 9] = cr[i] * a; dst[o + 10] = cg[i] * a; dst[o + 11] = cb[i] * a; dst[o + 12] = 0;
      }
    }
    return { add: add, addCount: na, alpha: alpha, alphaCount: nb };
  }

  function impact(p, n, inDir, kind, light){
    const r = rnd;
    const metal = kind === 'metal';
    const target = kind === 'target';
    let rx = inDir[0], ry = inDir[1], rz = inDir[2];
    const dn = rx * n[0] + ry * n[1] + rz * n[2];
    rx -= 2 * dn * n[0]; ry -= 2 * dn * n[1]; rz -= 2 * dn * n[2];
    const fy = n[1] > 0.5 ? p[1] + 0.004 : 0.004;
    const sparks = target ? 16 : (metal ? 22 : 14);
    for (let k = 0; k < sparks; k++){
      const sp = (metal ? 4.5 : 3.0) + r() * (metal ? 7 : 4.5);
      let dx = n[0] * 0.8 + rx * 0.7 + (r() - 0.5) * 1.3;
      let dy = n[1] * 0.8 + ry * 0.7 + (r() - 0.5) * 1.3 + 0.35;
      let dz = n[2] * 0.8 + rz * 0.7 + (r() - 0.5) * 1.3;
      const l = 1 / Math.max(Math.sqrt(dx * dx + dy * dy + dz * dz), 1e-4);
      dx *= l; dy *= l; dz *= l;
      const hot = 0.6 + r() * 0.4;
      const mint = target && r() < 0.6;
      spawn({ x: p[0], y: p[1], z: p[2], vx: dx * sp, vy: dy * sp, vz: dz * sp, life: 0.16 + r() * 0.30,
        size: 0.010 + r() * 0.008, stretch: 0.032, shape: KIND_STREAK, gravity: 1.1, drag: 1.2,
        r: mint ? 0.43 * 3.2 : 3.2 * hot, g: mint ? 0.95 * 3.2 : 2.0 * hot, b: mint ? 0.77 * 3.2 : 0.8 * hot, floorY: fy });
    }
    spawn({ x: p[0] + n[0] * 0.03, y: p[1] + n[1] * 0.03, z: p[2] + n[2] * 0.03, life: 0.08, size: 0.16, size1: 0.30,
      shape: KIND_SOFT, r: target ? 0.8 : 3.0, g: target ? 2.0 : 2.1, b: target ? 1.6 : 1.1 });
    if (target) return;
    const dustC = metal ? [0.34, 0.33, 0.32] : [0.58, 0.52, 0.45];
    const lr = light ? light[0] : 1, lg = light ? light[1] : 1, lb = light ? light[2] : 1;
    for (let k = 0; k < (metal ? 3 : 5); k++){
      const sp = 0.3 + r() * 0.8;
      spawn({ x: p[0] + n[0] * 0.05, y: p[1] + n[1] * 0.05, z: p[2] + n[2] * 0.05,
        vx: n[0] * sp + (r() - 0.5) * 0.35, vy: n[1] * sp + 0.15 + r() * 0.25, vz: n[2] * sp + (r() - 0.5) * 0.35,
        life: 0.8 + r() * 0.7, size: 0.06 + r() * 0.04, size1: 0.42 + r() * 0.32, shape: KIND_SOFT, drag: 2.2, alpha: true,
        r: dustC[0] * lr, g: dustC[1] * lg, b: dustC[2] * lb, a: 0.40 + r() * 0.14, fadeIn: 0.04 });
    }
    for (let k = 0; k < (metal ? 3 : 6); k++){
      const sp = 1.6 + r() * 3.2;
      spawn({ x: p[0] + n[0] * 0.02, y: p[1] + n[1] * 0.02, z: p[2] + n[2] * 0.02,
        vx: (n[0] + (r() - 0.5) * 1.4) * sp, vy: (n[1] + (r() - 0.5) * 1.4 + 0.6) * sp, vz: (n[2] + (r() - 0.5) * 1.4) * sp,
        life: 0.55 + r() * 0.5, size: 0.010 + r() * 0.012, shape: KIND_CHUNK, gravity: 1, drag: 0.4, alpha: true,
        r: dustC[0] * 0.55 * lr, g: dustC[1] * 0.55 * lg, b: dustC[2] * 0.55 * lb, a: 1, floorY: fy + 0.008 });
    }
  }

  function burst(center, radius, right, up, mint, amber){
    const r = rnd;
    for (let k = 0; k < 30; k++){
      const a = r() * Math.PI * 2;
      const rr = Math.sqrt(r()) * radius * 0.8;
      const ox = Math.cos(a) * rr, oy = Math.sin(a) * rr;
      const x = center[0] + right[0] * ox + up[0] * oy;
      const y = center[1] + right[1] * ox + up[1] * oy;
      const z = center[2] + right[2] * ox + up[2] * oy;
      const sp = 1.5 + r() * 4.5;
      const ux = right[0] * Math.cos(a) + up[0] * Math.sin(a);
      const uy = right[1] * Math.cos(a) + up[1] * Math.sin(a) + 0.4;
      const uz = right[2] * Math.cos(a) + up[2] * Math.sin(a);
      const useAmber = r() < 0.25;
      const c = useAmber ? amber : mint;
      const k2 = 2.4 + r() * 2.2;
      spawn({ x: x, y: y, z: z, vx: ux * sp, vy: uy * sp, vz: uz * sp, life: 0.35 + r() * 0.55,
        size: 0.010 + r() * 0.012, stretch: 0.035, shape: KIND_STREAK, gravity: 0.7, drag: 1.4,
        r: c[0] * k2, g: c[1] * k2, b: c[2] * k2 });
    }
    for (let k = 0; k < 10; k++){
      const a = r() * Math.PI * 2;
      const sp = 0.8 + r() * 2.2;
      spawn({ x: center[0], y: center[1], z: center[2],
        vx: (right[0] * Math.cos(a) + up[0] * Math.sin(a)) * sp, vy: (right[1] * Math.cos(a) + up[1] * Math.sin(a)) * sp + 1.0,
        vz: (right[2] * Math.cos(a) + up[2] * Math.sin(a)) * sp,
        life: 0.7 + r() * 0.5, size: 0.016 + r() * 0.02, shape: KIND_CHUNK, gravity: 1, drag: 0.5, alpha: true,
        r: 0.05, g: 0.055, b: 0.06, a: 1, floorY: 0.012 });
    }
    spawn({ x: center[0], y: center[1], z: center[2], life: 0.16, size: radius * 1.2, size1: radius * 3.4, shape: 3,
      r: mint[0] * 2.6, g: mint[1] * 2.6, b: mint[2] * 2.6 });
    spawn({ x: center[0], y: center[1], z: center[2], life: 0.10, size: radius * 1.0, size1: radius * 1.9, shape: KIND_SOFT,
      r: mint[0] * 1.6, g: mint[1] * 1.6, b: mint[2] * 1.6 });
  }

  function muzzle(p, fwd, right, up, ambient){
    const r = rnd;
    spawn({ x: p[0] + fwd[0] * 0.05, y: p[1] + fwd[1] * 0.05, z: p[2] + fwd[2] * 0.05,
      vx: fwd[0] * (0.8 + r() * 0.6) + up[0] * 0.2, vy: fwd[1] * (0.8 + r() * 0.6) + 0.25, vz: fwd[2] * (0.8 + r() * 0.6) + up[2] * 0.2,
      life: 0.45 + r() * 0.3, size: 0.03, size1: 0.20 + r() * 0.1, shape: KIND_SOFT, drag: 2.6, alpha: true,
      r: 0.5 * ambient, g: 0.5 * ambient, b: 0.52 * ambient, a: 0.20, fadeIn: 0.03 });
  }

  function casing(p, fwd, right, up, light){
    const r = rnd;
    const sp = 1.8 + r() * 0.8;
    spawn({ x: p[0], y: p[1], z: p[2],
      vx: right[0] * sp + up[0] * 1.4 + fwd[0] * 0.3 + (r() - 0.5) * 0.4,
      vy: right[1] * sp + up[1] * 1.4 + fwd[1] * 0.3 + 0.6,
      vz: right[2] * sp + up[2] * 1.4 + fwd[2] * 0.3 + (r() - 0.5) * 0.4,
      life: 0.55 + r() * 0.2, size: 0.0032, stretch: 0.006, shape: KIND_STREAK, gravity: 1, drag: 0.3, alpha: true,
      r: 0.42 * light, g: 0.31 * light, b: 0.13 * light, a: 1 });
  }

  function mote(x, y, z, cR, cG, cB){
    const r = rnd;
    spawn({ x: x, y: y, z: z, vx: (r() - 0.5) * 0.08, vy: (r() - 0.5) * 0.05 + 0.01, vz: (r() - 0.5) * 0.08,
      life: 3 + r() * 4, size: 0.008 + r() * 0.008, shape: KIND_SOFT, fadeIn: 1.0,
      r: cR, g: cG, b: cB });
  }

  return { spawn: spawn, update: update, fill: fill, clear: clear, impact: impact, burst: burst, muzzle: muzzle,
    casing: casing, mote: mote, max: N, get count(){ return count; }, rnd: rnd };
}

export function createMotion(){
  const m = { dip: 0, dipV: 0, roll: 0, lat: 0, ready: false, x: 0, y: 0, z: 0, vy: 0, vyHist: new Float32Array(8),
    tHist: new Float32Array(8), head: 0, n: 0, gunDip: 0, gunDipV: 0, jump: 0 };

  function reset(){
    m.ready = false; m.dip = 0; m.dipV = 0; m.roll = 0; m.lat = 0; m.vy = 0; m.n = 0; m.gunDip = 0; m.gunDipV = 0;
  }

  function kick(amount){
    m.dipV += amount;
    m.gunDipV += amount * 1.6;
  }

  function update(x, y, z, rx, rz, dt, now){
    if (!(dt > 0)) return;
    if (!m.ready){ m.ready = true; m.x = x; m.y = y; m.z = z; m.vy = 0; m.n = 0; return; }
    const dx = x - m.x, dy = y - m.y, dz = z - m.z;
    m.x = x; m.y = y; m.z = z;
    if (dx * dx + dy * dy + dz * dz > 9){ reset(); m.ready = true; m.x = x; m.y = y; m.z = z; return; }
    const vy = dy / dt;
    const lat = (dx * rx + dz * rz) / dt;
    m.lat += (lat - m.lat) * (1 - Math.exp(-dt / 0.10));
    const prevVy = m.vy;
    m.vy = vy;
    m.vyHist[m.head] = vy;
    m.tHist[m.head] = now;
    m.head = (m.head + 1) % 8;
    if (m.n < 8) m.n++;
    let older = prevVy, olderT = now, minVy = prevVy;
    for (let k = 2; k <= m.n; k++){
      const idx = (m.head - k + 16) % 8;
      older = m.vyHist[idx];
      olderT = m.tHist[idx];
      if (older < minVy) minVy = older;
      if (now - olderT >= 0.09) break;
    }
    if (minVy < -2.6 && prevVy < -1.2 && vy > -0.8 && older - minVy > 0.8 && now - olderT > 0.04){
      const impact = -minVy;
      kick(Math.min(1.9, (impact - 1.5) * 0.30));
    }
    if (prevVy > -0.5 && prevVy < 1.0 && vy > 3.2) m.gunDipV += 0.35;
    const k = 170, c = 2 * Math.sqrt(k) * 0.62;
    const a = -k * m.dip - c * m.dipV;
    m.dipV += a * dt;
    m.dip += m.dipV * dt;
    const k2 = 120, c2 = 2 * Math.sqrt(k2) * 0.5;
    const a2 = -k2 * m.gunDip - c2 * m.gunDipV;
    m.gunDipV += a2 * dt;
    m.gunDip += m.gunDipV * dt;
    const targetRoll = Math.max(-0.024, Math.min(0.024, -m.lat * 0.0034));
    m.roll += (targetRoll - m.roll) * (1 - Math.exp(-dt / 0.12));
  }

  return { state: m, update: update, reset: reset };
}

export function createRecoilSpring(){
  const s = { rot: 0, rotV: 0, back: 0, backV: 0, roll: 0, rollV: 0, side: 1 };
  function shot(rnd){
    s.rotV += 2.2 + rnd() * 0.8;
    s.backV += 0.55 + rnd() * 0.15;
    s.side = -s.side;
    s.rollV += s.side * (1.2 + rnd() * 1.2);
  }
  function update(dt){
    if (!(dt > 0)) return;
    const st = Math.min(dt, 0.05);
    const k = 210, c = 2 * Math.sqrt(k) * 0.55;
    s.rotV += (-k * s.rot - c * s.rotV) * st;
    s.rot += s.rotV * st;
    s.backV += (-k * s.back - c * s.backV) * st;
    s.back += s.backV * st;
    s.rollV += (-k * s.roll - c * s.rollV) * st;
    s.roll += s.rollV * st;
  }
  function reset(){ s.rot = 0; s.rotV = 0; s.back = 0; s.backV = 0; s.roll = 0; s.rollV = 0; }
  return { state: s, shot: shot, update: update, reset: reset };
}

export function surfaceAt(prims, x, y, z){
  let best = 0.02, nx = 0, ny = 1, nz = 0, mat = 'concrete', found = false;
  for (let i = 0; i < prims.length; i++){
    const p = prims[i];
    const mn = p.min, mx = p.max;
    if (x < mn[0] - 0.02 || x > mx[0] + 0.02 || y < mn[1] - 0.02 || y > mx[1] + 0.02 || z < mn[2] - 0.02 || z > mx[2] + 0.02) continue;
    const d = [x - mn[0], mx[0] - x, y - mn[1], mx[1] - y, z - mn[2], mx[2] - z];
    const N = [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]];
    for (let f = 0; f < 6; f++){
      const dd = Math.abs(d[f]);
      if (dd < best){ best = dd; nx = N[f][0]; ny = N[f][1]; nz = N[f][2]; mat = p.mat; found = true; }
    }
    if (p.type === 'ramp'){
      const a = p.axis;
      const span = p.max[a] - p.min[a];
      const h = p.max[1] - p.min[1];
      const v = a === 0 ? x : z;
      let t = (v - p.min[a]) / span;
      if (p.sign < 0) t = 1 - t;
      const top = p.min[1] + h * t;
      const dd = Math.abs(y - top) * span / Math.sqrt(span * span + h * h);
      if (dd < best){
        best = dd;
        const l = Math.sqrt(span * span + h * h);
        const g = -h / l * p.sign;
        nx = a === 0 ? g : 0; nz = a === 2 ? g : 0; ny = span / l;
        mat = p.mat; found = true;
      }
    }
  }
  return found ? { n: [nx, ny, nz], mat: mat } : null;
}
