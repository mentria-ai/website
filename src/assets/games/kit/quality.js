export const QUALITY_LEVELS = ['low', 'medium', 'high'];

export const qualityPresets = Object.freeze({
  low: Object.freeze({
    name: 'low',
    pixelRatio: 1,
    minPixelRatio: 0.75,
    msaa: false,
    shadows: false,
    shadowMapSize: 512,
    bloom: false,
    fxaa: false,
    drawDistance: 650,
    fogScale: 0.8,
    vegetation: 0.35,
    particles: 0.4,
    terrainRes: 96,
    anisotropy: 1,
    envMapSize: 64,
    postScale: 0.5
  }),
  medium: Object.freeze({
    name: 'medium',
    pixelRatio: 1.5,
    minPixelRatio: 0.9,
    msaa: false,
    shadows: true,
    shadowMapSize: 1024,
    bloom: true,
    fxaa: true,
    drawDistance: 1100,
    fogScale: 1,
    vegetation: 0.65,
    particles: 0.7,
    terrainRes: 160,
    anisotropy: 4,
    envMapSize: 128,
    postScale: 0.5
  }),
  high: Object.freeze({
    name: 'high',
    pixelRatio: 2,
    minPixelRatio: 1,
    msaa: true,
    shadows: true,
    shadowMapSize: 2048,
    bloom: true,
    fxaa: true,
    drawDistance: 1800,
    fogScale: 1.15,
    vegetation: 1,
    particles: 1,
    terrainRes: 256,
    anisotropy: 8,
    envMapSize: 256,
    postScale: 1
  })
});

export const presets = qualityPresets;

const LOW_GPU = [
  /swiftshader/i, /llvmpipe/i, /software/i, /basic render/i, /microsoft basic/i,
  /mali-4/i, /mali-t[0-9]/i, /mali-g(31|51|52|57)\b/i,
  /adreno[^0-9]*(3|4)[0-9]{2}\b/i, /adreno[^0-9]*5[0-3][0-9]\b/i, /adreno[^0-9]*6[0-1][0-9]\b/i,
  /powervr/i, /sgx/i, /videocore/i, /intel.*\bhd graphics/i, /intel.*\bgma\b/i
];

const MID_GPU = [
  /adreno[^0-9]*6[2-9][0-9]\b/i, /mali-g(68|76|77|78)\b/i, /intel.*(uhd|iris)/i, /radeon.*vega [0-9]\b/i, /xclipse/i
];

let cachedDetect = null;
let cachedGpu = null;

export function qualityPreset(q) {
  return qualityPresets[normalizeQuality(q)];
}

export function normalizeQuality(q) {
  return q === 'low' || q === 'medium' || q === 'high' ? q : 'medium';
}

export function qualityBelow(q) {
  const i = QUALITY_LEVELS.indexOf(normalizeQuality(q));
  return QUALITY_LEVELS[Math.max(0, i - 1)];
}

export function isTouchDevice() {
  try {
    if (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) return true;
    if (typeof window !== 'undefined' && 'ontouchstart' in window) return true;
  } catch (_) {}
  return false;
}

export function isIOSDevice() {
  try {
    const ua = navigator.userAgent || '';
    if (/iPhone|iPad|iPod/.test(ua)) return true;
    return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  } catch (_) {}
  return false;
}

export function isIPhone() {
  try {
    return /iPhone|iPod/.test(navigator.userAgent || '');
  } catch (_) {}
  return false;
}

export function isPhoneDevice() {
  if (!isTouchDevice()) return false;
  try {
    const w = screen.width || 0;
    const h = screen.height || 0;
    const shortSide = Math.min(w, h);
    if (shortSide > 0 && shortSide <= 540) return true;
    const ua = navigator.userAgent || '';
    if (/Mobi|iPhone|Android.*Mobile/.test(ua)) return true;
  } catch (_) {}
  return false;
}

export function gpuInfo() {
  if (cachedGpu) return cachedGpu;
  const info = { renderer: '', vendor: '', webgl2: false, maxTexture: 0 };
  try {
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 4;
    let gl = c.getContext('webgl2', { failIfMajorPerformanceCaveat: false });
    if (gl) info.webgl2 = true;
    else gl = c.getContext('webgl') || c.getContext('experimental-webgl');
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      info.renderer = String((ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || '');
      info.vendor = String((ext && gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)) || gl.getParameter(gl.VENDOR) || '');
      info.maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 0;
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    }
  } catch (_) {}
  cachedGpu = info;
  return info;
}

const PROBE_VS = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}';
const PROBE_FS = [
  'precision highp float;',
  'uniform float k;',
  'void main(){',
  'vec2 uv=gl_FragCoord.xy*0.0137+k;',
  'float a=0.0;',
  'for(int i=0;i<48;i++){',
  'uv=vec2(sin(uv.y*1.7+a)+cos(uv.x*1.3),cos(uv.x*1.1-a)+sin(uv.y*0.9));',
  'a+=fract(sin(dot(uv,vec2(12.9898,78.233)))*43758.5453)*0.01;',
  '}',
  'gl_FragColor=vec4(fract(uv),a,1.0);',
  '}'
].join('\n');

export function probeGpuMs(size = 256) {
  let gl = null;
  try {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    gl = c.getContext('webgl', { antialias: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    if (!gl) return -1;
    const sh = function (type, src) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, PROBE_VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, PROBE_FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return -1;
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const uk = gl.getUniformLocation(prog, 'k');
    gl.viewport(0, 0, size, size);
    const px = new Uint8Array(4);
    gl.uniform1f(uk, 0.5);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const t0 = performance.now();
    for (let i = 0; i < 4; i++) {
      gl.uniform1f(uk, i * 0.37);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const ms = (performance.now() - t0) / 4;
    return ms;
  } catch (_) {
    return -1;
  } finally {
    try {
      const lose = gl && gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    } catch (_) {}
  }
}

export function detectQuality(opts = {}) {
  if (cachedDetect && !opts.fresh) return cachedDetect.quality;
  const reasons = [];
  const touch = isTouchDevice();
  const phone = isPhoneDevice();
  const gpu = gpuInfo();
  let mem = 0;
  let cores = 0;
  try {
    mem = Number(navigator.deviceMemory) || 0;
    cores = Number(navigator.hardwareConcurrency) || 0;
  } catch (_) {}
  let q = 'high';
  if (phone) {
    q = 'medium';
    reasons.push('phone');
  } else if (touch) {
    let shortSide = 0;
    try { shortSide = Math.min(screen.width, screen.height); } catch (_) {}
    if (shortSide && shortSide < 900) {
      q = 'medium';
      reasons.push('tablet');
    }
  }
  const r = gpu.renderer;
  if (!r) {
    reasons.push('no-gpu-string');
  } else if (LOW_GPU.some(function (re) { return re.test(r); })) {
    q = 'low';
    reasons.push('low-gpu');
  } else if (MID_GPU.some(function (re) { return re.test(r); }) && q === 'high') {
    q = 'medium';
    reasons.push('mid-gpu');
  }
  if (mem && mem <= 2) {
    q = 'low';
    reasons.push('memory');
  } else if (mem && mem <= 4 && q === 'high') {
    q = 'medium';
    reasons.push('memory');
  }
  if (cores && cores <= 2) {
    q = 'low';
    reasons.push('cores');
  }
  let probeMs = -1;
  if (opts.probe !== false && q !== 'low') {
    probeMs = probeGpuMs(256);
    if (probeMs < 0) {
      q = 'low';
      reasons.push('probe-failed');
    } else if (probeMs > 9) {
      q = 'low';
      reasons.push('probe-slow');
    } else if (probeMs > 3.5 && q === 'high') {
      q = 'medium';
      reasons.push('probe-mid');
    }
  }
  cachedDetect = { quality: q, reasons, probeMs, gpu: gpu.renderer, phone, touch, memory: mem, cores };
  return q;
}

export function qualityReport() {
  if (!cachedDetect) detectQuality();
  return Object.assign({}, cachedDetect);
}
