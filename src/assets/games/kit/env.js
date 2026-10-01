import * as THREE from 'three';
import { clamp, lerp, smoothstep, mulberry32 } from './math.js';
import { loadGameImage } from './materials.js';

const ENV_QUALITY = {
  low: { name: 'low', shadows: false, shadowMapSize: 1024, drawDistance: 700, envSize: 64, shadowRange: 60 },
  medium: { name: 'medium', shadows: true, shadowMapSize: 1024, drawDistance: 1100, envSize: 128, shadowRange: 85 },
  high: { name: 'high', shadows: true, shadowMapSize: 2048, drawDistance: 1800, envSize: 256, shadowRange: 120 },
};

function resolveEnvQuality(q) {
  if (typeof q === 'string') return { ...(ENV_QUALITY[q] || ENV_QUALITY.medium) };
  if (q && typeof q === 'object') {
    const base = ENV_QUALITY[q.name] || ENV_QUALITY.medium;
    return { ...base, ...q };
  }
  return { ...ENV_QUALITY.medium };
}

export const ENV_PRESETS = {
  golden: {
    elevation: 10, azimuth: 228, turbidity: 5, rayleigh: 2.2, mie: 0.004, mieG: 0.88,
    exposure: 1.0, sunIntensity: 5.2, sunTint: [1, 0.86, 0.66], hemiIntensity: 1.1, envIntensity: 1.2, skyScale: 0.3,
    groundTint: [0.32, 0.27, 0.16], fogDensity: 1 / 1700, fogFalloff: 1 / 160, cloudCoverage: 0.22, cloudDensity: 0.32,
    cloudSprites: 10, night: 0, horizonBand: 0.11, shadowStrength: 0.88,
  },
  day: {
    elevation: 54, azimuth: 165, turbidity: 2.1, rayleigh: 1.0, mie: 0.0032, mieG: 0.8,
    exposure: 0.72, sunIntensity: 4.6, sunTint: [1, 0.97, 0.92], hemiIntensity: 1.1, envIntensity: 1.3, skyScale: 0.3,
    groundTint: [0.3, 0.3, 0.22], fogDensity: 1 / 3200, fogFalloff: 1 / 220, cloudCoverage: 0.3, cloudDensity: 0.32,
    cloudSprites: 12, night: 0, horizonBand: 0.08, shadowStrength: 0.8,
  },
  sunset: {
    elevation: 5.5, azimuth: 250, turbidity: 7, rayleigh: 2.4, mie: 0.0045, mieG: 0.9,
    exposure: 1.15, sunIntensity: 5.0, sunTint: [1, 0.88, 0.76], hemiIntensity: 1.15, envIntensity: 1.2, skyScale: 0.32,
    groundTint: [0.3, 0.2, 0.14], fogDensity: 1 / 1500, fogFalloff: 1 / 150, cloudCoverage: 0.3, cloudDensity: 0.34,
    cloudSprites: 12, night: 0, horizonBand: 0.13, shadowStrength: 0.9,
  },
  night: {
    elevation: -16, azimuth: 250, turbidity: 3, rayleigh: 1, mie: 0.004, mieG: 0.8,
    exposure: 1.0, sunIntensity: 0.0, sunTint: [0.55, 0.66, 1], hemiIntensity: 1.4, envIntensity: 0.6,
    groundTint: [0.04, 0.045, 0.06], fogDensity: 1 / 1200, fogFalloff: 1 / 170, cloudCoverage: 0.3, cloudDensity: 0.5,
    cloudSprites: 8, night: 1, horizonBand: 0.12, shadowStrength: 0.7,
    moonElevation: 38, moonAzimuth: 135, moonIntensity: 0.75,
    nightZenith: [0.0022, 0.0042, 0.0125], nightHorizon: [0.009, 0.013, 0.026], cityGlow: [0.055, 0.03, 0.013],
  },
};

const RAYLEIGH_TOTAL = [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5];
const MIE_CONST = [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14];

function skyModel(p, sunDir) {
  const sunY = clamp(sunDir.y, -1, 1);
  const sunE = 1000 * Math.max(0, 1 - Math.exp(-((1.6110731556870734 - Math.acos(sunY)) / 1.5)));
  const c = 0.2 * p.turbidity * 10e-18;
  const betaR = RAYLEIGH_TOTAL.map((v) => v * p.rayleigh);
  const betaM = MIE_CONST.map((v) => 0.434 * c * v * p.mie);
  return { sunE, betaR, betaM, sunDir };
}

function skyRadiance(model, dir, out) {
  const { sunE, betaR, betaM, sunDir } = model;
  const scale = model.scale ?? 1;
  const zenith = Math.acos(Math.max(0, dir.y));
  const inv = 1 / (Math.cos(zenith) + 0.15 * Math.pow(93.885 - (zenith * 180) / Math.PI, -1.253));
  const sR = 8.4e3 * inv;
  const sM = 1.25e3 * inv;
  const cosT = dir.x * sunDir.x + dir.y * sunDir.y + dir.z * sunDir.z;
  const rc = cosT * 0.5 + 0.5;
  const rPhase = 0.05968310365946075 * (1 + rc * rc);
  const g = model.g;
  const g2 = g * g;
  const mPhase = 0.07957747154594767 * ((1 - g2) / Math.pow(1 - 2 * g * cosT + g2, 1.5));
  const horizonMix = clamp(Math.pow(1 - sunDir.y, 5), 0, 1);
  for (let i = 0; i < 3; i++) {
    const fex = Math.exp(-(betaR[i] * sR + betaM[i] * sM));
    const ratio = (betaR[i] * rPhase + betaM[i] * mPhase) / (betaR[i] + betaM[i]);
    let lin = Math.pow(Math.max(sunE * ratio * (1 - fex), 0), 1.5);
    lin *= lerp(1, Math.pow(Math.max(sunE * ratio * fex, 0), 0.5), horizonMix);
    const l0 = 0.1 * fex;
    out[i] = ((lin + l0) * 0.04 + (i === 1 ? 0.0003 : i === 2 ? 0.00075 : 0)) * scale;
  }
  return out;
}

function sunTransmittance(model, dir) {
  const zenith = Math.acos(Math.max(0, dir.y));
  const inv = 1 / (Math.cos(zenith) + 0.15 * Math.pow(93.885 - (zenith * 180) / Math.PI, -1.253));
  return [0, 1, 2].map((i) => Math.exp(-(model.betaR[i] * 8.4e3 * inv + model.betaM[i] * 1.25e3 * inv)));
}

function dirFromAngles(elevationDeg, azimuthDeg) {
  const el = (elevationDeg * Math.PI) / 180;
  const az = (azimuthDeg * Math.PI) / 180;
  return new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).normalize();
}

const worldFog = {
  params: { x: 0, y: 0.006, z: 0, w: 0 },
  sunDir: { x: 0, y: 1, z: 0 },
  toward: { x: 0.5, y: 0.5, z: 0.5 },
  side: { x: 0.5, y: 0.5, z: 0.5 },
  away: { x: 0.5, y: 0.5, z: 0.5 },
  extra: { x: 6, y: 0.4, z: 0.97, w: 0 },
  tone: { x: 1, y: 0, z: 0, w: 0 },
};

const FOG_RING_GLSL = `
vec3 kwFogRing(vec3 dir, vec3 sunDir, vec3 toward, vec3 side, vec3 away, vec4 extra) {
  vec2 hz = dir.xz;
  float hl = length(hz);
  hz = hl > 1e-5 ? hz / hl : vec2(1.0, 0.0);
  vec2 sh = sunDir.xz;
  float sl = length(sh);
  sh = sl > 1e-5 ? sh / sl : vec2(1.0, 0.0);
  float c = dot(hz, sh);
  vec3 col = c > 0.0 ? mix(side, toward, pow(c, extra.x)) : mix(side, away, -c);
  float glow = pow(max(dot(dir, sunDir), 0.0), 12.0);
  return col + toward * glow * extra.y;
}
`;

let worldFogInstalled = false;

function installWorldFog() {
  if (worldFogInstalled) return;
  worldFogInstalled = true;
  const extraUniforms = {
    kwFogParams: { value: worldFog.params },
    kwFogSunDir: { value: worldFog.sunDir },
    kwFogToward: { value: worldFog.toward },
    kwFogSide: { value: worldFog.side },
    kwFogAway: { value: worldFog.away },
    kwFogExtra: { value: worldFog.extra },
    kwFogTone: { value: worldFog.tone },
  };
  Object.assign(THREE.UniformsLib.fog, extraUniforms);
  for (const key of Object.keys(THREE.ShaderLib)) {
    const lib = THREE.ShaderLib[key];
    if (lib && lib.uniforms && lib.uniforms.fogColor) Object.assign(lib.uniforms, extraUniforms);
  }
  THREE.ShaderChunk.fog_pars_vertex = `#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorldOffset;
#endif`;
  THREE.ShaderChunk.fog_vertex = `#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogWorldOffset = ( vec4( mvPosition.xyz, 0.0 ) * viewMatrix ).xyz;
#endif`;
  THREE.ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogWorldOffset;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  uniform vec4 kwFogParams;
  uniform vec3 kwFogSunDir;
  uniform vec3 kwFogToward;
  uniform vec3 kwFogSide;
  uniform vec3 kwFogAway;
  uniform vec4 kwFogExtra;
  uniform vec4 kwFogTone;
  ${FOG_RING_GLSL}
#endif`;
  THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
  if ( kwFogParams.w > 0.5 ) {
    float kwDist = length( vFogWorldOffset );
    vec3 kwDir = vFogWorldOffset / max( kwDist, 1e-4 );
    float kwFall = kwFogParams.y;
    float kwH0 = cameraPosition.y - kwFogParams.z;
    float kwK = kwFall * kwDir.y * kwDist;
    float kwInteg = abs( kwK ) > 1e-4 ? ( 1.0 - exp( - kwK ) ) / kwK : 1.0 - 0.5 * kwK;
    float kwOptical = kwFogParams.x * exp( - kwFall * max( kwH0, -40.0 ) ) * kwDist * kwInteg;
    float kwAmount = min( 1.0 - exp( - max( kwOptical, 0.0 ) ), kwFogExtra.z );
    if ( kwFogExtra.w > 0.0 ) kwAmount = max( kwAmount, smoothstep( kwFogExtra.w * 0.5, kwFogExtra.w * 0.85, kwDist ) );
    vec3 kwCol = kwFogRing( kwDir, kwFogSunDir, kwFogToward, kwFogSide, kwFogAway, kwFogExtra );
    #if defined( TONE_MAPPING )
      kwCol = toneMapping( kwCol );
      kwCol = linearToOutputTexel( vec4( kwCol, 1.0 ) ).rgb;
      gl_FragColor.rgb = mix( gl_FragColor.rgb, kwCol, kwAmount );
    #else
      float kwE = max( kwFogTone.x, 1e-3 );
      vec3 kwSurf = max( gl_FragColor.rgb, vec3( 0.0 ) ) * kwE;
      vec3 kwFogC = kwCol * kwE;
      kwSurf = kwSurf / ( 1.0 + kwSurf );
      kwFogC = kwFogC / ( 1.0 + kwFogC );
      vec3 kwMixed = mix( kwSurf, kwFogC, kwAmount );
      gl_FragColor.rgb = kwMixed / max( vec3( 1.0 ) - kwMixed, vec3( 1e-3 ) ) / kwE;
    #endif
  } else {
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
    #else
      float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
    #endif
    gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
  }
#endif`;
}

export function worldFogState() {
  return worldFog;
}

const SKY_VERTEX = `
varying vec3 vWorldPosition;
void main() {
  vec4 worldPosition = modelMatrix * vec4( position, 1.0 );
  vWorldPosition = worldPosition.xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  gl_Position.z = gl_Position.w;
}
`;

const SKY_FRAGMENT = `
varying vec3 vWorldPosition;
uniform vec3 sunDirection;
uniform float rayleigh;
uniform float turbidity;
uniform float mieCoefficient;
uniform float mieDirectionalG;
uniform float cloudScale;
uniform float cloudSpeed;
uniform float cloudCoverage;
uniform float cloudDensity;
uniform float cloudElevation;
uniform float showSunDisc;
uniform float time;
uniform float nightAmount;
uniform vec3 nightZenith;
uniform vec3 nightHorizon;
uniform vec3 cityGlow;
uniform vec3 moonDirection;
uniform float moonVisible;
uniform float starIntensity;
uniform float horizonBand;
uniform vec3 ringToward;
uniform vec3 ringSide;
uniform vec3 ringAway;
uniform vec4 ringExtra;
uniform vec3 cloudLitColor;
uniform vec3 cloudShadeColor;
uniform float skyClamp;
uniform float skyScale;

const float pi = 3.141592653589793;
const vec3 totalRayleigh = vec3( 5.804542996261093E-6, 1.3562911419845635E-5, 3.0265902468824876E-5 );
const vec3 MieConst = vec3( 1.8399918514433978E14, 2.7798023919660528E14, 4.0790479543861094E14 );
const float rayleighZenithLength = 8.4E3;
const float mieZenithLength = 1.25E3;
const float sunAngularDiameterCos = 0.99995;

${FOG_RING_GLSL}

vec2 kwGradient( vec2 i ) {
  vec3 p = fract( i.xyx * vec3( 0.1031, 0.1030, 0.0973 ) );
  p += dot( p, p.yzx + 33.33 );
  return fract( ( p.xx + p.yz ) * p.zy ) * 2.0 - 1.0;
}

float kwNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  vec2 u = f * f * f * ( f * ( f * 6.0 - 15.0 ) + 10.0 );
  float a = dot( kwGradient( i ), f );
  float b = dot( kwGradient( i + vec2( 1.0, 0.0 ) ), f - vec2( 1.0, 0.0 ) );
  float c = dot( kwGradient( i + vec2( 0.0, 1.0 ) ), f - vec2( 0.0, 1.0 ) );
  float d = dot( kwGradient( i + vec2( 1.0, 1.0 ) ), f - vec2( 1.0, 1.0 ) );
  return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y ) * 1.6;
}

float kwFbm( vec2 p, float drift ) {
  float result = 0.0;
  float amplitude = 1.0;
  for ( int i = 0; i < 4; i ++ ) {
    result += amplitude * kwNoise( p );
    amplitude *= 0.5;
    p = p * 2.0 + drift;
  }
  return result;
}

float rayleighPhase( float cosTheta ) {
  return 0.05968310365946075 * ( 1.0 + pow( cosTheta, 2.0 ) );
}

float hgPhase( float cosTheta, float g ) {
  float g2 = pow( g, 2.0 );
  float inverse = 1.0 / pow( 1.0 - 2.0 * g * cosTheta + g2, 1.5 );
  return 0.07957747154594767 * ( ( 1.0 - g2 ) * inverse );
}

float kwStarField( vec3 dir ) {
  vec3 p = dir * 230.0;
  vec3 cell = floor( p );
  vec3 f = fract( p ) - 0.5;
  float h = fract( sin( dot( cell, vec3( 127.1, 311.7, 74.7 ) ) ) * 43758.5453 );
  float h2 = fract( h * 91.37 );
  vec3 jitter = vec3( fract( h * 13.17 ), fract( h * 71.73 ), fract( h * 3.31 ) ) - 0.5;
  float d = length( f - jitter * 0.5 );
  float present = step( 0.9935, h );
  float b = present * smoothstep( 0.22, 0.0, d ) * ( 0.25 + 1.6 * h2 * h2 * h2 );
  b *= 0.8 + 0.2 * sin( time * 1.7 + h * 500.0 );
  return b;
}

void main() {
  vec3 direction = normalize( vWorldPosition - cameraPosition );
  vec3 vSunDirection = normalize( sunDirection );
  float sunY = clamp( vSunDirection.y, -1.0, 1.0 );
  float vSunE = 1000.0 * max( 0.0, 1.0 - exp( -( ( 1.6110731556870734 - acos( sunY ) ) / 1.5 ) ) );
  vec3 vBetaR = totalRayleigh * rayleigh;
  vec3 vBetaM = 0.434 * ( 0.2 * turbidity * 10E-18 ) * MieConst * mieCoefficient;

  float zenithAngle = acos( max( 0.0, direction.y ) );
  float inverse = 1.0 / ( cos( zenithAngle ) + 0.15 * pow( 93.885 - ( ( zenithAngle * 180.0 ) / pi ), -1.253 ) );
  float sR = rayleighZenithLength * inverse;
  float sM = mieZenithLength * inverse;
  vec3 Fex = exp( -( vBetaR * sR + vBetaM * sM ) );
  float cosTheta = dot( direction, vSunDirection );
  float rPhase = rayleighPhase( cosTheta * 0.5 + 0.5 );
  vec3 betaRTheta = vBetaR * rPhase;
  float mPhase = hgPhase( cosTheta, mieDirectionalG );
  vec3 betaMTheta = vBetaM * mPhase;
  vec3 Lin = pow( vSunE * ( ( betaRTheta + betaMTheta ) / ( vBetaR + vBetaM ) ) * ( 1.0 - Fex ), vec3( 1.5 ) );
  Lin *= mix( vec3( 1.0 ), pow( vSunE * ( ( betaRTheta + betaMTheta ) / ( vBetaR + vBetaM ) ) * Fex, vec3( 0.5 ) ), clamp( pow( 1.0 - vSunDirection.y, 5.0 ), 0.0, 1.0 ) );
  vec3 L0 = vec3( 0.1 ) * Fex;
  vec3 sky = ( ( Lin + L0 ) * 0.04 + vec3( 0.0, 0.0003, 0.00075 ) ) * skyScale;
  float skyLum = dot( sky, vec3( 0.2126, 0.7152, 0.0722 ) );
  if ( skyLum > skyClamp * 0.5 ) sky *= ( skyClamp * 0.5 + ( skyLum - skyClamp * 0.5 ) / ( 1.0 + ( skyLum - skyClamp * 0.5 ) / ( skyClamp * 0.5 ) ) ) / skyLum;

  float up = max( direction.y, 0.0 );
  vec3 nightSky = mix( nightHorizon, nightZenith, pow( up, 0.45 ) );
  vec2 hzDir = normalize( direction.xz + vec2( 1e-5 ) );
  nightSky += cityGlow * exp( - up * 9.0 ) * ( 0.75 + 0.25 * kwNoise( hzDir * 3.0 + 7.0 ) );
  sky = mix( sky, nightSky, nightAmount );

  vec3 ring = kwFogRing( direction, vSunDirection, ringToward, ringSide, ringAway, ringExtra );
  float band = smoothstep( -0.015, horizonBand, direction.y );
  sky = mix( ring, sky, band );

  float sunVis = smoothstep( -0.01, 0.02, direction.y ) * ( 1.0 - nightAmount );
  float sundisc = smoothstep( sunAngularDiameterCos, sunAngularDiameterCos + 0.00002, cosTheta ) * showSunDisc * sunVis;
  sky += ( 380.0 * sundisc ) * min( vSunE * Fex, 60.0 ) * 0.04 * skyScale;

  float starFade = smoothstep( 0.02, 0.25, direction.y ) * nightAmount * starIntensity;
  float md = dot( direction, normalize( moonDirection ) );
  float moonDisc = smoothstep( 0.99968, 0.99976, md ) * moonVisible;
  vec2 moonUv = ( direction.xz - normalize( moonDirection ).xz ) * 90.0;
  float maria = 0.72 + 0.28 * smoothstep( -0.4, 0.6, kwNoise( moonUv * 1.3 + 3.0 ) + 0.5 * kwNoise( moonUv * 3.1 ) );
  vec3 moonCol = vec3( 1.0, 0.96, 0.88 ) * 2.4 * maria * moonDisc;
  vec3 moonHalo = vec3( 0.55, 0.65, 0.9 ) * ( pow( max( md, 0.0 ), 900.0 ) * 0.18 + pow( max( md, 0.0 ), 60.0 ) * 0.025 ) * moonVisible;
  sky += ( kwStarField( direction ) * 1.6 * ( 1.0 - moonDisc ) * starFade ) + ( moonCol + moonHalo ) * nightAmount * smoothstep( -0.01, 0.03, direction.y );

  if ( direction.y > 0.0 && cloudCoverage > 0.0 ) {
    float elevation = mix( 1.0, 0.1, cloudElevation );
    vec2 cloudUV = direction.xz / ( direction.y * elevation );
    cloudUV *= cloudScale;
    cloudUV += time * cloudSpeed;
    float evolve = time * cloudSpeed * 300.0;
    float cloudNoise = clamp( kwFbm( cloudUV * 1000.0, evolve ) * 0.7 + 0.5, 0.0, 1.0 );
    float region = kwNoise( cloudUV * 300.0 ) * 0.37 + 0.5;
    float cov = clamp( cloudCoverage + ( region - 0.5 ) * 0.6, 0.0, 1.0 );
    float threshold = 1.0 - cov;
    float cloudMask = smoothstep( threshold, threshold + 0.3, cloudNoise );
    float horizonFade = smoothstep( 0.0, 0.03 + 0.06 * cloudElevation, direction.y );
    cloudMask *= horizonFade;
    float depth = max( 0.0, cloudNoise - threshold );
    float beer = exp( depth * -4.0 );
    float powder = 1.0 - beer * beer;
    float shade = mix( 0.45, 1.0, clamp( beer * powder * 2.6, 0.0, 1.0 ) );
    float silver = clamp( 0.51 / pow( 1.49 - cosTheta * 1.4, 1.5 ), 0.0, 3.0 );
    float edge = cloudMask * ( 1.0 - cloudMask ) * 4.0;
    vec3 dayCloud = cloudShadeColor + cloudLitColor * shade;
    dayCloud += cloudLitColor * silver * edge * 0.5;
    vec3 nightCloud = nightHorizon * 1.4 + cityGlow * 1.6 * exp( - up * 4.0 ) + vec3( 0.03, 0.035, 0.05 ) * pow( max( md, 0.0 ), 6.0 ) * moonVisible;
    vec3 cloudColor = mix( dayCloud, nightCloud * shade, nightAmount );
    float alpha = ( 1.0 - exp( depth * cloudDensity * -12.0 ) ) * horizonFade;
    float aerial = smoothstep( 0.0, 0.35, direction.y );
    cloudColor = mix( ring, cloudColor, mix( 0.35, 1.0, aerial ) );
    sky = mix( sky, cloudColor, alpha );
  }

  gl_FragColor = vec4( sky, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function makeSkyMaterial() {
  return new THREE.ShaderMaterial({
    name: 'KwSky',
    uniforms: {
      sunDirection: { value: new THREE.Vector3(0, 1, 0) },
      rayleigh: { value: 1 },
      turbidity: { value: 2 },
      mieCoefficient: { value: 0.005 },
      mieDirectionalG: { value: 0.8 },
      cloudScale: { value: 0.00018 },
      cloudSpeed: { value: 0.000025 },
      cloudCoverage: { value: 0.3 },
      cloudDensity: { value: 0.45 },
      cloudElevation: { value: 0.55 },
      showSunDisc: { value: 1 },
      time: { value: 0 },
      nightAmount: { value: 0 },
      nightZenith: { value: new THREE.Vector3() },
      nightHorizon: { value: new THREE.Vector3() },
      cityGlow: { value: new THREE.Vector3() },
      moonDirection: { value: new THREE.Vector3(0, 1, 0) },
      moonVisible: { value: 0 },
      starIntensity: { value: 1 },
      horizonBand: { value: 0.1 },
      ringToward: { value: new THREE.Vector3() },
      ringSide: { value: new THREE.Vector3() },
      ringAway: { value: new THREE.Vector3() },
      ringExtra: { value: new THREE.Vector4(6, 0.4, 0.97, 0) },
      cloudLitColor: { value: new THREE.Vector3(0.5, 0.5, 0.5) },
      cloudShadeColor: { value: new THREE.Vector3(0.2, 0.2, 0.25) },
      skyClamp: { value: 1e6 },
      skyScale: { value: 1 },
    },
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
}

function luminance(c) {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

function cloudAtlasFallback(size) {
  const canvas = document.createElement('canvas');
  canvas.width = size * 2;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  for (let k = 0; k < 2; k++) {
    const rng = mulberry32(77 + k * 13);
    const ox = k * size;
    const puffs = 26;
    for (let i = 0; i < puffs; i++) {
      const t = i / (puffs - 1);
      const cx = ox + size * (0.16 + 0.68 * t + (rng() - 0.5) * 0.08);
      const bulge = Math.sin(t * Math.PI);
      const cy = size * (0.66 - bulge * (0.18 + rng() * 0.16));
      const r = size * (0.07 + 0.12 * bulge * (0.6 + rng() * 0.6));
      const g = ctx.createRadialGradient(cx, cy - r * 0.2, r * 0.1, cx, cy, r);
      g.addColorStop(0, 'rgba(255,255,255,0.95)');
      g.addColorStop(0.55, 'rgba(240,242,246,0.75)');
      g.addColorStop(1, 'rgba(225,228,236,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
    const base = ctx.createLinearGradient(0, size * 0.5, 0, size * 0.8);
    base.addColorStop(0, 'rgba(0,0,0,0)');
    base.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = base;
    ctx.fillRect(ox, size * 0.5, size, size * 0.5);
    ctx.globalCompositeOperation = 'source-over';
  }
  return canvas;
}

function makeCloudSprites(count, seed) {
  const rng = mulberry32(seed);
  const positions = [];
  const uvs = [];
  const corners = [];
  const indices = [];
  for (let i = 0; i < count; i++) {
    const az = (i / count) * Math.PI * 2 + (rng() - 0.5) * 0.5;
    const el = (2.5 + rng() * 7) * (Math.PI / 180);
    const w = 0.22 + rng() * 0.22;
    const h = w * (0.38 + rng() * 0.12);
    const atlas = rng() < 0.5 ? 0 : 0.5;
    const dx = Math.sin(az);
    const dz = Math.cos(az);
    const dy = Math.sin(el);
    const base = positions.length / 3;
    const quad = [[-1, 0], [1, 0], [1, 1], [-1, 1]];
    for (const [qx, qy] of quad) {
      positions.push(dx, dy, dz);
      corners.push(qx * w, qy * h - h * 0.12);
      uvs.push(atlas + (qx * 0.5 + 0.5) * 0.5, qy);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('corner', new THREE.Float32BufferAttribute(corners, 2));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

const CLOUD_VERTEX = `
attribute vec2 corner;
uniform float radius;
varying vec2 vUv;
varying vec3 vDir;
void main() {
  vec3 dir = normalize( position );
  vec3 side = normalize( vec3( dir.z, 0.0, - dir.x ) );
  vec3 world = cameraPosition + dir * radius + side * corner.x * radius + vec3( 0.0, corner.y * radius, 0.0 );
  vDir = normalize( world - cameraPosition );
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * vec4( world, 1.0 );
}
`;

const CLOUD_FRAGMENT = `
uniform sampler2D map;
uniform vec3 litColor;
uniform vec3 shadeColor;
uniform vec3 sunDir;
uniform float opacity;
uniform vec3 ringToward;
uniform vec3 ringSide;
uniform vec3 ringAway;
uniform vec4 ringExtra;
uniform float haze;
varying vec2 vUv;
varying vec3 vDir;
${FOG_RING_GLSL}
void main() {
  vec4 tex = texture2D( map, vUv );
  float lum = dot( tex.rgb, vec3( 0.3333 ) );
  float facing = pow( max( dot( vDir, sunDir ), 0.0 ), 3.0 );
  vec3 col = mix( shadeColor, litColor, clamp( vUv.y * 0.85 + lum * 0.35, 0.0, 1.0 ) );
  col += litColor * facing * 0.6 * ( 1.0 - tex.a );
  vec3 ring = kwFogRing( vDir, sunDir, ringToward, ringSide, ringAway, ringExtra );
  col = mix( col, ring, haze * ( 1.0 - smoothstep( 0.0, 0.25, vDir.y ) ) );
  float a = tex.a * opacity;
  if ( a < 0.01 ) discard;
  gl_FragColor = vec4( col, a );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const BACKDROP_VERTEX = `
varying vec2 vUv;
varying vec3 vDir;
void main() {
  vec4 world = modelMatrix * vec4( position, 1.0 );
  vDir = normalize( world.xyz - cameraPosition );
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const BACKDROP_FRAGMENT = `
uniform sampler2D map;
uniform vec2 uvScale;
uniform vec3 tint;
uniform float hazeBottom;
uniform float hazeTop;
uniform vec3 sunDir;
uniform vec3 ringToward;
uniform vec3 ringSide;
uniform vec3 ringAway;
uniform vec4 ringExtra;
varying vec2 vUv;
varying vec3 vDir;
${FOG_RING_GLSL}
void main() {
  vec4 tex = texture2D( map, vUv * uvScale );
  if ( tex.a < 0.04 ) discard;
  vec3 ring = kwFogRing( vDir, sunDir, ringToward, ringSide, ringAway, ringExtra );
  float haze = mix( hazeBottom, hazeTop, smoothstep( 0.0, 0.8, vUv.y ) );
  vec3 col = mix( tex.rgb * tint, ring, haze );
  gl_FragColor = vec4( col, tex.a );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function backdropNoiseTable(seed, cells) {
  const r = mulberry32(seed);
  const t = new Float32Array(cells + 1);
  for (let i = 0; i < cells; i++) t[i] = r();
  t[cells] = t[0];
  return t;
}

function sampleNoiseTable(t, x) {
  const cells = t.length - 1;
  const f = (x - Math.floor(x)) * cells;
  const i = Math.floor(f);
  const u = f - i;
  const s = u * u * (3 - 2 * u);
  return t[i] * (1 - s) + t[i + 1] * s;
}

function paintBackdropFallback(kind, w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const rng = mulberry32(kind.length * 977 + 13);
  if (kind === 'city-night') {
    for (let layer = 0; layer < 2; layer++) {
      let x = 0;
      const shade = layer === 0 ? 22 : 12;
      while (x < w) {
        const bw = 8 + rng() * 34;
        const bh = h * (0.18 + Math.pow(rng(), 1.8) * (layer === 0 ? 0.55 : 0.75));
        ctx.fillStyle = `rgb(${shade},${shade + 2},${shade + 8})`;
        ctx.fillRect(x, h - bh, bw, bh);
        for (let wy = h - bh + 4; wy < h - 3; wy += 4) {
          for (let wx = x + 2; wx < x + bw - 2; wx += 3) {
            if (rng() < 0.22) {
              const warm = rng() < 0.7;
              ctx.fillStyle = warm ? `rgba(255,${190 + rng() * 40},${110 + rng() * 40},${0.5 + rng() * 0.5})` : `rgba(${170 + rng() * 40},${210 + rng() * 30},255,${0.5 + rng() * 0.4})`;
              ctx.fillRect(wx, wy, 1.5, 1.5);
            }
          }
        }
        if (rng() < 0.12) {
          ctx.fillStyle = 'rgba(255,40,40,0.9)';
          ctx.fillRect(x + bw / 2 - 1, h - bh - 3, 2, 2);
        }
        x += bw + rng() * 3;
      }
    }
    return canvas;
  }
  const layers = kind === 'desert-mesas'
    ? [{ base: 0.3, amp: 0.45, sharp: false, col: [176, 122, 92], seed: 3, terrace: true }, { base: 0.14, amp: 0.32, sharp: false, col: [140, 92, 68], seed: 9, terrace: true }]
    : kind === 'coast-cliffs'
      ? [{ base: 0.16, amp: 0.38, sharp: false, col: [118, 130, 126], seed: 4 }, { base: 0.06, amp: 0.26, sharp: false, col: [92, 104, 96], seed: 8 }]
      : kind === 'forest-hills'
        ? [{ base: 0.26, amp: 0.4, sharp: false, col: [96, 116, 110], seed: 5 }, { base: 0.12, amp: 0.34, sharp: false, col: [60, 80, 70], seed: 11 }]
        : [{ base: 0.3, amp: 0.65, sharp: true, col: [128, 138, 152], seed: 6, snow: true }, { base: 0.14, amp: 0.42, sharp: true, col: [88, 98, 106], seed: 12 }];
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (const layer of layers) {
    const tables = [];
    for (let o = 0; o < 6; o++) tables.push(backdropNoiseTable(layer.seed + o * 17, 5 * Math.pow(2, o)));
    const shadeTable = backdropNoiseTable(layer.seed + 99, 512);
    const ridgeRow = new Float32Array(w);
    let rMin = 1e9;
    let rMax = -1e9;
    for (let x = 0; x < w; x++) {
      const u = x / w;
      let v = 0;
      let a = 1;
      let n = 0;
      for (let o = 0; o < 6; o++) {
        let sv = sampleNoiseTable(tables[o], u);
        if (layer.sharp) sv = 1 - Math.abs(sv * 2 - 1);
        v += sv * a;
        n += a;
        a *= 0.55;
      }
      ridgeRow[x] = v / n;
      rMin = Math.min(rMin, ridgeRow[x]);
      rMax = Math.max(rMax, ridgeRow[x]);
    }
    for (let x = 0; x < w; x++) {
      const u = x / w;
      let r = (ridgeRow[x] - rMin) / Math.max(rMax - rMin, 1e-6);
      r = Math.pow(r, layer.sharp ? 1.6 : 1.2);
      if (layer.terrace) r = (Math.round(r * 5) / 5) * 0.7 + r * 0.3;
      const top = h * (1 - (layer.base + layer.amp * r));
      const streak = sampleNoiseTable(shadeTable, u * 3);
      for (let y = Math.max(0, Math.floor(top)); y < h; y++) {
        const i = (y * w + x) * 4;
        const depth = (y - top) / Math.max(h - top, 1);
        const shade = 0.84 + 0.16 * streak - depth * 0.12;
        let cr = layer.col[0] * shade;
        let cg = layer.col[1] * shade;
        let cb = layer.col[2] * shade;
        if (layer.snow && depth < 0.18 && r > 0.55) {
          const sn = (1 - depth / 0.18) * smoothstep(0.55, 0.75, r);
          cr = lerp(cr, 236, sn);
          cg = lerp(cg, 240, sn);
          cb = lerp(cb, 246, sn);
        }
        const edge = clamp(y - top, 0, 1);
        d[i] = lerp(d[i], cr, edge);
        d[i + 1] = lerp(d[i + 1], cg, edge);
        d[i + 2] = lerp(d[i + 2], cb, edge);
        d[i + 3] = Math.max(d[i + 3], 255 * edge);
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function prepareBackdropImage(img, heightDeg) {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) return null;
  const probeW = 128;
  const probeH = Math.max(16, Math.round((h / w) * probeW * 2));
  const probe = document.createElement('canvas');
  probe.width = probeW;
  probe.height = probeH;
  const pctx = probe.getContext('2d', { willReadFrequently: true });
  pctx.drawImage(img, 0, 0, probeW, probeH);
  const data = pctx.getImageData(0, 0, probeW, probeH).data;
  const rowAlpha = new Float32Array(probeH);
  for (let y = 0; y < probeH; y++) {
    let a = 0;
    for (let x = 0; x < probeW; x++) a += data[(y * probeW + x) * 4 + 3];
    rowAlpha[y] = a / (probeW * 255);
  }
  const headRows = Math.max(1, Math.round(probeH * 0.06));
  let head = 0;
  for (let y = 0; y < headRows; y++) head += rowAlpha[y];
  if (head / headRows > 0.5) return null;
  let top = 0;
  while (top < probeH && rowAlpha[top] < 0.02) top++;
  let bottom = probeH - 1;
  while (bottom > top && rowAlpha[bottom] < 0.5) bottom--;
  if (bottom - top < 2) return null;
  const y0 = Math.max(0, Math.floor(((top - 1) / probeH) * h));
  const y1 = Math.min(h, Math.ceil(((bottom + 1) / probeH) * h));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = y1 - y0;
  canvas.getContext('2d').drawImage(img, 0, y0, w, y1 - y0, 0, 0, w, y1 - y0);
  const repeat = Math.max(2, Math.min(12, 2 * Math.round((360 * (y1 - y0)) / (w * heightDeg) / 2)));
  return { canvas, repeat };
}

export function createEnvironment(scene, renderer, opts = {}) {
  installWorldFog();
  const presetName = ENV_PRESETS[opts.preset] ? opts.preset : 'day';
  const preset = { ...ENV_PRESETS[presetName], ...(opts.overrides || {}) };
  const quality = resolveEnvQuality(opts.quality);
  const isNight = preset.night > 0.5;
  const group = new THREE.Group();
  group.name = 'kw-environment';
  scene.add(group);

  let sunDir;
  if (opts.sunDirection) {
    sunDir = new THREE.Vector3(opts.sunDirection.x, opts.sunDirection.y, opts.sunDirection.z).normalize();
  } else {
    sunDir = dirFromAngles(opts.sunElevation ?? preset.elevation, opts.sunAzimuth ?? preset.azimuth);
  }
  const moonDir = dirFromAngles(preset.moonElevation ?? 35, opts.moonAzimuth ?? preset.moonAzimuth ?? 135);
  const lightDir = isNight ? moonDir.clone() : sunDir.clone();

  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = opts.exposure ?? preset.exposure;

  const model = skyModel({ turbidity: preset.turbidity, rayleigh: preset.rayleigh, mie: preset.mie }, sunDir);
  model.g = preset.mieG;
  model.scale = opts.skyScale ?? preset.skyScale ?? 1;

  const tmp = [0, 0, 0];
  const horizonEl = Math.sin(1.2 * Math.PI / 180);
  const sunAz = Math.atan2(sunDir.x, sunDir.z);
  const ringAt = (deltaDeg) => {
    const a = sunAz + (deltaDeg * Math.PI) / 180;
    const c = Math.sqrt(1 - horizonEl * horizonEl);
    return skyRadiance(model, { x: Math.sin(a) * c, y: horizonEl, z: Math.cos(a) * c }, [0, 0, 0]).slice();
  };
  let toward;
  let side;
  let away;
  let mid;
  if (isNight) {
    const nh = preset.nightHorizon;
    const cg = preset.cityGlow;
    const glow = opts.cityGlow ?? 1;
    side = [nh[0] + cg[0] * glow, nh[1] + cg[1] * glow, nh[2] + cg[2] * glow];
    toward = side.map((v) => v * 1.12);
    away = side.map((v) => v * 0.94);
    mid = side.map((v) => v * 1.05);
  } else {
    toward = ringAt(0);
    mid = ringAt(35);
    side = ringAt(90);
    away = ringAt(180);
  }
  const sideLum = Math.max(luminance(side), 1e-6);
  const ringCap = sideLum * 4.5;
  const capColor = (c) => {
    const l = luminance(c);
    if (l <= ringCap) return c;
    const k = (ringCap + (l - ringCap) / (1 + (l - ringCap) / ringCap)) / l;
    return c.map((v) => v * k);
  };
  toward = capColor(toward);
  mid = capColor(mid);
  const lt = luminance(toward);
  const ls = luminance(side);
  const lm = luminance(mid);
  let towardPower = 4;
  if (lt - ls > 1e-6) {
    const t = clamp((lm - ls) / (lt - ls), 0.02, 0.98);
    towardPower = clamp(Math.log(t) / Math.log(Math.cos((35 * Math.PI) / 180)), 1, 24);
  }
  const fogGlow = isNight ? 0 : 0.22;
  worldFog.toward.x = toward[0]; worldFog.toward.y = toward[1]; worldFog.toward.z = toward[2];
  worldFog.side.x = side[0]; worldFog.side.y = side[1]; worldFog.side.z = side[2];
  worldFog.away.x = away[0]; worldFog.away.y = away[1]; worldFog.away.z = away[2];
  worldFog.sunDir.x = lightDir.x; worldFog.sunDir.y = lightDir.y; worldFog.sunDir.z = lightDir.z;
  if (!isNight) { worldFog.sunDir.x = sunDir.x; worldFog.sunDir.y = sunDir.y; worldFog.sunDir.z = sunDir.z; }
  const fogDensity = opts.fogDensity ?? preset.fogDensity;
  worldFog.params.x = fogDensity;
  worldFog.params.y = opts.fogFalloff ?? preset.fogFalloff;
  worldFog.params.z = opts.fogBase ?? 0;
  worldFog.params.w = 1;
  worldFog.extra.x = towardPower;
  worldFog.extra.y = fogGlow;
  worldFog.extra.z = opts.fogMax ?? 1;
  worldFog.tone.x = renderer.toneMappingExposure;

  const fogColor = new THREE.Color().setRGB(side[0], side[1], side[2]);
  const fog = new THREE.FogExp2(fogColor, Math.sqrt(fogDensity) * 0.6);
  scene.fog = fog;

  const skyMaterial = makeSkyMaterial();
  const su = skyMaterial.uniforms;
  su.sunDirection.value.copy(sunDir);
  su.rayleigh.value = preset.rayleigh;
  su.turbidity.value = preset.turbidity;
  su.mieCoefficient.value = preset.mie;
  su.mieDirectionalG.value = preset.mieG;
  su.cloudCoverage.value = opts.clouds === false ? 0 : (typeof opts.clouds === 'number' ? opts.clouds : preset.cloudCoverage);
  su.cloudDensity.value = preset.cloudDensity;
  su.nightAmount.value = preset.night;
  if (isNight) {
    su.nightZenith.value.fromArray(preset.nightZenith);
    su.nightHorizon.value.fromArray(preset.nightHorizon);
    su.cityGlow.value.fromArray(preset.cityGlow).multiplyScalar(opts.cityGlow ?? 1);
    su.moonDirection.value.copy(moonDir);
    su.moonVisible.value = opts.moon === false ? 0 : 1;
  }
  su.starIntensity.value = opts.stars === false ? 0 : 1;
  su.horizonBand.value = preset.horizonBand;
  su.ringToward.value.fromArray(toward);
  su.ringSide.value.fromArray(side);
  su.ringAway.value.fromArray(away);
  su.ringExtra.value.set(towardPower, fogGlow, 1, 0);
  su.skyClamp.value = isNight ? 1e6 : sideLum * (opts.skyClamp ?? 16);
  su.skyScale.value = model.scale;

  const sunTrans = sunTransmittance(model, sunDir);
  const transMax = Math.max(...sunTrans, 1e-6);
  const sunHue = sunTrans.map((v, i) => lerp(1, v / transMax, preset.sunSaturation ?? 0.55) * preset.sunTint[i]);
  const hueMax = Math.max(...sunHue, 1e-6);
  const sunColor = new THREE.Color().setRGB(sunHue[0] / hueMax, sunHue[1] / hueMax, sunHue[2] / hueMax);
  const zenithCol = skyRadiance(model, { x: 0, y: 1, z: 0 }, tmp).slice();
  const lowSun = 1 - clamp(sunDir.y * 3.5, 0, 1);
  const skyLevel = lerp(Math.max(luminance(side), luminance(zenithCol)), luminance(toward) * 0.8, lowSun);
  const cloudLit = isNight ? [0.04, 0.045, 0.06] : sunHue.map((v) => (v / hueMax) * skyLevel * (1.1 + 0.3 * clamp(sunDir.y * 2, 0, 1)));
  const cloudShade = isNight ? [0.01, 0.012, 0.018] : zenithCol.map((v, i) => (v * 0.45 + side[i] * 0.45) * 0.85);
  su.cloudLitColor.value.fromArray(cloudLit);
  su.cloudShadeColor.value.fromArray(cloudShade);

  const sky = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), skyMaterial);
  sky.name = 'kw-sky';
  sky.scale.setScalar(5000);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  group.add(sky);

  const sun = new THREE.DirectionalLight(isNight ? new THREE.Color().setRGB(0.62, 0.72, 1.0) : sunColor, isNight ? (preset.moonIntensity ?? 0.5) : preset.sunIntensity * smoothstep(-0.04, 0.06, sunDir.y) * (0.6 + 0.4 * clamp(luminance(sunTrans) * 1.4, 0, 1)));
  sun.name = 'kw-sun';
  const shadowRange = opts.shadowRange ?? quality.shadowRange;
  if (quality.shadows) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    sun.castShadow = true;
    sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
    const cam = sun.shadow.camera;
    cam.left = -shadowRange;
    cam.right = shadowRange;
    cam.top = shadowRange;
    cam.bottom = -shadowRange;
    cam.near = 1;
    cam.far = 1400;
    cam.updateProjectionMatrix();
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.6 * (shadowRange * 2 / quality.shadowMapSize) * 2;
    sun.shadow.radius = quality.name === 'high' ? 2.2 : 1.6;
    sun.shadow.intensity = preset.shadowStrength;
  }
  group.add(sun);
  group.add(sun.target);

  const hemiSky = new THREE.Color();
  const hemiGround = new THREE.Color();
  if (isNight) {
    hemiSky.setRGB(0.07, 0.1, 0.2);
    hemiGround.setRGB(0.07, 0.05, 0.035);
  } else {
    const skyAvg = zenithCol.map((v, i) => v * 0.8 + side[i] * 0.2);
    const sl = Math.max(luminance(skyAvg), 1e-6);
    hemiSky.setRGB(skyAvg[0] / sl, skyAvg[1] / sl, skyAvg[2] / sl).multiplyScalar(0.6);
    hemiGround.setRGB(preset.groundTint[0], preset.groundTint[1], preset.groundTint[2]).multiply(sunColor);
  }
  const hemi = new THREE.HemisphereLight(hemiSky, hemiGround, preset.hemiIntensity);
  hemi.name = 'kw-hemi';
  group.add(hemi);

  let cloudMesh = null;
  let cloudTexture = null;
  const cloudCount = opts.cloudSprites === false ? 0 : (typeof opts.cloudSprites === 'number' ? opts.cloudSprites : preset.cloudSprites);
  if (cloudCount > 0) {
    cloudTexture = new THREE.CanvasTexture(cloudAtlasFallback(256));
    cloudTexture.colorSpace = THREE.SRGBColorSpace;
    const cloudMaterial = new THREE.ShaderMaterial({
      name: 'KwCloudSprites',
      uniforms: {
        map: { value: cloudTexture },
        radius: { value: 1800 },
        litColor: { value: new THREE.Vector3().fromArray(cloudLit).multiplyScalar(isNight ? 1 : 1.1) },
        shadeColor: { value: new THREE.Vector3().fromArray(cloudShade) },
        sunDir: { value: lightDir.clone() },
        opacity: { value: isNight ? 0.45 : 0.75 },
        ringToward: { value: new THREE.Vector3().fromArray(toward) },
        ringSide: { value: new THREE.Vector3().fromArray(side) },
        ringAway: { value: new THREE.Vector3().fromArray(away) },
        ringExtra: { value: new THREE.Vector4(towardPower, fogGlow, 1, 0) },
        haze: { value: 0.7 },
      },
      vertexShader: CLOUD_VERTEX,
      fragmentShader: CLOUD_FRAGMENT,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      fog: false,
    });
    cloudMesh = new THREE.Mesh(makeCloudSprites(cloudCount, opts.seed ?? 5), cloudMaterial);
    cloudMesh.name = 'kw-cloud-sprites';
    cloudMesh.frustumCulled = false;
    cloudMesh.renderOrder = -9;
    group.add(cloudMesh);
    Promise.all([loadGameImage('sprites', 'cloud-1'), loadGameImage('sprites', 'cloud-2')]).then(([a, b]) => {
      if (!a && !b) return;
      const size = 512;
      const canvas = document.createElement('canvas');
      canvas.width = size * 2;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(a || b, 0, 0, size, size);
      ctx.drawImage(b || a, size, 0, size, size);
      cloudTexture.dispose();
      cloudTexture.image = canvas;
      cloudTexture.needsUpdate = true;
    });
  }

  let disposed = false;
  let backdrop = null;
  let backdropTexture = null;
  const backdropName = opts.backdrop || null;
  const backdropHeightDeg = opts.backdropHeight ?? 7;
  if (backdropName) {
    backdropTexture = new THREE.CanvasTexture(paintBackdropFallback(backdropName, 2048, 256));
    backdropTexture.colorSpace = THREE.SRGBColorSpace;
    backdropTexture.wrapS = THREE.RepeatWrapping;
    backdropTexture.anisotropy = 4;
    backdropTexture.wrapT = THREE.ClampToEdgeWrapping;
    const tintBase = isNight ? [0.9, 0.9, 1.0] : sunColor.toArray().map((v) => v * 0.3 + 0.2);
    const backdropMaterial = new THREE.ShaderMaterial({
      name: 'KwBackdrop',
      uniforms: {
        map: { value: backdropTexture },
        uvScale: { value: new THREE.Vector2(opts.backdropRepeat ?? 2, 1) },
        tint: { value: new THREE.Vector3().fromArray(isNight ? [0.55, 0.55, 0.62] : tintBase.map((v, i) => v * (0.45 + zenithCol[i] * 0.5))) },
        hazeBottom: { value: opts.backdropHaze ?? (isNight ? 0.4 : 0.82) },
        hazeTop: { value: (opts.backdropHaze ?? (isNight ? 0.4 : 0.82)) * 0.62 },
        sunDir: { value: lightDir.clone() },
        ringToward: { value: new THREE.Vector3().fromArray(toward) },
        ringSide: { value: new THREE.Vector3().fromArray(side) },
        ringAway: { value: new THREE.Vector3().fromArray(away) },
        ringExtra: { value: new THREE.Vector4(towardPower, fogGlow, 1, 0) },
      },
      vertexShader: BACKDROP_VERTEX,
      fragmentShader: BACKDROP_FRAGMENT,
      transparent: true,
      depthWrite: false,
      fog: false,
      side: THREE.BackSide,
    });
    const tan = Math.tan((backdropHeightDeg * Math.PI) / 180);
    const geo = new THREE.CylinderGeometry(1, 1, 1, 96, 2, true);
    geo.translate(0, 0.5, 0);
    const bpos = geo.attributes.position;
    const buv = geo.attributes.uv;
    for (let i = 0; i < bpos.count; i++) {
      const y = bpos.getY(i);
      if (y < 0.25) {
        bpos.setY(i, -2.5);
        buv.setY(i, 0);
      } else if (y < 0.75) {
        bpos.setY(i, 0);
        buv.setY(i, 0);
      }
    }
    bpos.needsUpdate = true;
    buv.needsUpdate = true;
    backdrop = new THREE.Mesh(geo, backdropMaterial);
    backdrop.name = 'kw-backdrop';
    backdrop.frustumCulled = false;
    backdrop.renderOrder = -8;
    backdrop.userData.tan = tan;
    group.add(backdrop);
    loadGameImage('backdrops', backdropName).then((img) => {
      if (!img || disposed) return;
      const prepared = prepareBackdropImage(img, backdropHeightDeg);
      if (!prepared) return;
      backdropTexture.dispose();
      backdropTexture.image = prepared.canvas;
      backdropTexture.wrapS = THREE.MirroredRepeatWrapping;
      backdropTexture.needsUpdate = true;
      backdrop.material.uniforms.uvScale.value.set(prepared.repeat, 1);
    });
  }

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envSkyMaterial = skyMaterial.clone();
  envSkyMaterial.uniforms.showSunDisc.value = 0;
  envSkyMaterial.uniforms.starIntensity.value = 0;
  envSkyMaterial.uniforms.moonVisible.value = 0;
  envSkyMaterial.uniforms.skyClamp.value = isNight ? 1e6 : sideLum * 3;
  const envSky = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), envSkyMaterial);
  envSky.scale.setScalar(50);
  envScene.add(envSky);
  const groundRadiance = new THREE.Color().setRGB(preset.groundTint[0], preset.groundTint[1], preset.groundTint[2]);
  if (!isNight) {
    const irr = sun.intensity * Math.max(sunDir.y, 0.05) + preset.hemiIntensity * 0.6;
    groundRadiance.multiply(sunColor).multiplyScalar(irr / Math.PI);
  } else {
    groundRadiance.setRGB(0.012, 0.01, 0.009);
  }
  const envGround = new THREE.Mesh(
    new THREE.SphereGeometry(20, 32, 16, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5),
    new THREE.MeshBasicMaterial({ color: groundRadiance, side: THREE.BackSide, fog: false }),
  );
  envGround.position.y = -0.5;
  envScene.add(envGround);
  const envTarget = pmrem.fromScene(envScene, 0, 0.1, 100, { size: quality.envSize });
  scene.environment = envTarget.texture;
  scene.environmentIntensity = opts.envIntensity ?? preset.envIntensity;
  envSky.geometry.dispose();
  envSkyMaterial.dispose();
  envGround.geometry.dispose();
  envGround.material.dispose();
  pmrem.dispose();

  const tmpForward = new THREE.Vector3();
  const tmpCenter = new THREE.Vector3();
  const lightRight = new THREE.Vector3();
  const lightUp = new THREE.Vector3();
  const worldUp = new THREE.Vector3(0, 1, 0);
  lightRight.crossVectors(worldUp, lightDir);
  if (lightRight.lengthSq() < 1e-6) lightRight.set(1, 0, 0);
  lightRight.normalize();
  lightUp.crossVectors(lightDir, lightRight).normalize();
  let elapsed = 0;
  let currentRange = shadowRange;

  function update(target, dt = 1 / 60) {
    elapsed += dt;
    su.time.value = elapsed;
    let pos;
    let camera = null;
    if (target && target.isCamera) {
      camera = target;
      pos = target.position;
    } else {
      pos = target || tmpCenter.set(0, 0, 0);
    }
    sky.position.set(pos.x, pos.y, pos.z);
    if (camera) {
      const far = camera.far || 2000;
      worldFog.extra.w = opts.farFade === false ? 0 : far;
      if (cloudMesh) cloudMesh.material.uniforms.radius.value = Math.min(far * 0.88, 2600);
      if (backdrop) {
        const r = Math.min(far * 0.86, opts.backdropRadius ?? 2800);
        backdrop.scale.set(r, r * (backdrop.userData.tan + 0.04), r);
        backdrop.position.set(pos.x, pos.y - r * 0.04, pos.z);
      }
    } else if (backdrop) {
      const r = opts.backdropRadius ?? 2000;
      backdrop.scale.set(r, r * (backdrop.userData.tan + 0.04), r);
      backdrop.position.set(pos.x, pos.y - r * 0.04, pos.z);
    }
    if (sun.castShadow) {
      tmpCenter.set(pos.x, pos.y, pos.z);
      const groundHere = opts.heightAt ? opts.heightAt(pos.x, pos.z) : pos.y - 2;
      const above = Math.max(0, pos.y - groundHere);
      const wanted = shadowRange * Math.min(3, 1 + above / 70);
      const stepped = shadowRange * Math.pow(1.25, Math.round(Math.log(wanted / shadowRange) / Math.log(1.25)));
      if (Math.abs(stepped - currentRange) > 1e-3) {
        currentRange = stepped;
        const sc = sun.shadow.camera;
        sc.left = -currentRange;
        sc.right = currentRange;
        sc.top = currentRange;
        sc.bottom = -currentRange;
        sc.updateProjectionMatrix();
        sun.shadow.normalBias = 1.2 * (currentRange * 2 / quality.shadowMapSize);
      }
      if (camera) {
        camera.getWorldDirection(tmpForward);
        tmpForward.y = 0;
        if (tmpForward.lengthSq() > 1e-6) tmpForward.normalize();
        tmpCenter.addScaledVector(tmpForward, currentRange * 0.6);
        const groundY = opts.heightAt ? opts.heightAt(tmpCenter.x, tmpCenter.z) : pos.y - 20;
        tmpCenter.y = lerp(groundY, pos.y, 0.35);
      }
      const texel = (currentRange * 2) / sun.shadow.mapSize.x;
      const rx = Math.round(tmpCenter.dot(lightRight) / texel) * texel;
      const ry = Math.round(tmpCenter.dot(lightUp) / texel) * texel;
      const rz = tmpCenter.dot(lightDir);
      tmpCenter.set(0, 0, 0).addScaledVector(lightRight, rx).addScaledVector(lightUp, ry).addScaledVector(lightDir, rz);
      sun.target.position.copy(tmpCenter);
      sun.position.copy(tmpCenter).addScaledVector(lightDir, 600);
      sun.target.updateMatrixWorld();
      sun.updateMatrixWorld();
    } else {
      sun.position.copy(lightDir).multiplyScalar(600).add(tmpCenter.set(pos.x, 0, pos.z));
      sun.target.position.set(pos.x, 0, pos.z);
    }
  }

  function horizonColor(dir) {
    const d = dir || new THREE.Vector3(0, 0, -1);
    const col = new THREE.Color().setRGB(side[0], side[1], side[2]);
    if (!dir) return col;
    const hz = Math.hypot(d.x, d.z) || 1;
    const sh = Math.hypot(sunDir.x, sunDir.z) || 1;
    const c = (d.x * sunDir.x + d.z * sunDir.z) / (hz * sh);
    const target = c > 0 ? toward : away;
    const t = c > 0 ? Math.pow(c, towardPower) : -c;
    return col.setRGB(lerp(side[0], target[0], t), lerp(side[1], target[1], t), lerp(side[2], target[2], t));
  }

  function setHeightAt(fn) {
    opts.heightAt = fn;
  }

  function setFogDensity(d) {
    worldFog.params.x = d;
    fog.density = Math.sqrt(d) * 0.6;
  }

  function dispose() {
    disposed = true;
    scene.remove(group);
    sky.geometry.dispose();
    skyMaterial.dispose();
    if (cloudMesh) { cloudMesh.geometry.dispose(); cloudMesh.material.dispose(); }
    if (cloudTexture) cloudTexture.dispose();
    if (backdrop) { backdrop.geometry.dispose(); backdrop.material.dispose(); }
    if (backdropTexture) backdropTexture.dispose();
    if (scene.environment === envTarget.texture) scene.environment = null;
    envTarget.dispose();
    if (scene.fog === fog) scene.fog = null;
    if (sun.shadow && sun.shadow.map) sun.shadow.map.dispose();
    worldFog.params.w = 0;
  }

  update(new THREE.Vector3(0, 0, 0), 0);

  return {
    preset: presetName,
    isNight,
    group,
    sky,
    sun,
    hemi,
    fog,
    sunDirection: sunDir.clone(),
    lightDirection: lightDir.clone(),
    moonDirection: moonDir.clone(),
    sunColor: sunColor.clone(),
    envMap: envTarget.texture,
    exposure: renderer.toneMappingExposure,
    shadowRange,
    horizonColor,
    setFogDensity,
    setHeightAt,
    update,
    dispose,
  };
}
