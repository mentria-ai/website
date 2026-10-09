import { quadToRect, outputSize, fullQuad, scaleQuad } from './geometry.js';
import { stats } from './cpu.js';
import { renderCPU } from './detector.js';

const MODES = { original: 0, auto: 1, gray: 2, bw: 3, whiteboard: 4 };

const VS = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

const FS_WARP = `#version 300 es
precision highp float;
uniform sampler2D src;
uniform mat3 H;
uniform vec2 srcSize;
out vec4 o;
void main() {
  vec3 q = H * vec3(gl_FragCoord.xy, 1.0);
  o = vec4(texture(src, (q.xy / q.z) / srcSize).rgb, 1.0);
}`;

const FS_FILTER = `#version 300 es
precision highp float;
uniform sampler2D img;
uniform vec2 inSize;
uniform int mode;
uniform int rot;
uniform vec3 lo;
uniform vec3 hi;
uniform vec2 ylr;
uniform float bgLod;
out vec4 o;
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
void main() {
  vec2 f = gl_FragCoord.xy;
  vec2 ip = f;
  if (rot == 1) ip = vec2(f.y, inSize.y - f.x);
  else if (rot == 2) ip = inSize - f;
  else if (rot == 3) ip = vec2(inSize.x - f.y, f.x);
  vec2 uv = ip / inSize;
  vec3 c = textureLod(img, uv, 0.0).rgb;
  vec3 v = c;
  if (mode == 1) {
    vec3 span = max(hi - lo, vec3(1.0 / 255.0));
    v = clamp((c - lo) / span, 0.0, 1.0);
    float y = luma(v);
    v = clamp(vec3(y) + (v - vec3(y)) * 1.15, 0.0, 1.0);
    vec3 b = clamp((textureLod(img, uv, 1.0).rgb - lo) / span, 0.0, 1.0);
    v = clamp(v + 0.6 * (v - b), 0.0, 1.0);
  } else if (mode == 2) {
    float y = clamp((luma(c) - ylr.x) / max(ylr.y - ylr.x, 1.0 / 255.0), 0.0, 1.0);
    y = mix(y, y * y * (3.0 - 2.0 * y), 0.5);
    v = vec3(y);
  } else if (mode == 3) {
    float bg = luma(textureLod(img, uv, bgLod).rgb);
    v = vec3(smoothstep(0.78, 0.92, luma(c) / max(bg, 1.0 / 255.0)));
  } else if (mode == 4) {
    vec3 bg = textureLod(img, uv, bgLod).rgb;
    v = clamp(c / max(bg, vec3(1.0 / 255.0)), 0.0, 1.0);
    float y = luma(v);
    v = clamp(vec3(y) + (v - vec3(y)) * 1.4, 0.0, 1.0);
  }
  o = vec4(v, 1.0);
}`;

let gl = null;
let progs = null;
let buf = null;
let failed = false;

function compile(type, text) {
  const s = gl.createShader(type);
  gl.shaderSource(s, text);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
  return s;
}

function program(fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, VS));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, 'p');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link');
  return p;
}

function setup() {
  if (gl) return true;
  if (failed) return false;
  try {
    const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
    gl = canvas.getContext('webgl2', { antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('webgl2');
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      gl = null;
      progs = null;
      failed = true;
    });
    progs = { warp: program(FS_WARP), filter: program(FS_FILTER) };
    buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    return true;
  } catch (_) {
    gl = null;
    failed = true;
    return false;
  }
}

export function gpuAvailable() {
  return setup();
}

function params() {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

function sourceTexture(source) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
  params();
  gl.generateMipmap(gl.TEXTURE_2D);
  return t;
}

function target(w, h, mips) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texStorage2D(gl.TEXTURE_2D, mips ? Math.floor(Math.log2(Math.max(w, h))) + 1 : 1, gl.RGBA8, w, h);
  params();
  if (!mips) gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  const f = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, f);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('framebuffer');
  return { t, f, w, h };
}

function free(items) {
  for (const it of items) {
    if (!it) continue;
    gl.deleteFramebuffer(it.f);
    gl.deleteTexture(it.t);
  }
}

function draw(prog, out, set) {
  gl.useProgram(prog);
  gl.bindFramebuffer(gl.FRAMEBUFFER, out.f);
  gl.viewport(0, 0, out.w, out.h);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  set((name) => gl.getUniformLocation(prog, name));
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  if (gl.getError() !== gl.NO_ERROR) throw new Error('draw');
}

function warpPass(tex, sw, sh, q, out) {
  const H = quadToRect(q, out.w, out.h);
  draw(progs.warp, out, (u) => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(u('src'), 0);
    gl.uniformMatrix3fv(u('H'), false, [H[0], H[3], H[6], H[1], H[4], H[7], H[2], H[5], H[8]]);
    gl.uniform2f(u('srcSize'), sw, sh);
  });
}

function read(out) {
  const px = new Uint8Array(out.w * out.h * 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, out.f);
  gl.readPixels(0, 0, out.w, out.h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return new Uint8ClampedArray(px.buffer);
}

async function renderGL(source, q, size, turn, filter) {
  const max = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  let src = source, sq = q, scaled = null;
  if (source.width > max || source.height > max) {
    const s = max / Math.max(source.width, source.height);
    scaled = await createImageBitmap(source, { resizeWidth: Math.max(1, Math.floor(source.width * s)), resizeHeight: Math.max(1, Math.floor(source.height * s)), resizeQuality: 'high' });
    sq = scaleQuad(q, scaled.width / source.width, scaled.height / source.height);
    src = scaled;
  }
  const tex = sourceTexture(src);
  let small = null, a = null, b = null;
  try {
    let st = null;
    if (filter === 'auto' || filter === 'gray') {
      const ss = outputSize(sq, 256);
      small = target(ss.width, ss.height, false);
      warpPass(tex, src.width, src.height, sq, small);
      st = stats(read(small), ss.width, ss.height);
    }
    a = target(size.width, size.height, true);
    warpPass(tex, src.width, src.height, sq, a);
    gl.bindTexture(gl.TEXTURE_2D, a.t);
    gl.generateMipmap(gl.TEXTURE_2D);
    const rw = turn % 2 ? size.height : size.width, rh = turn % 2 ? size.width : size.height;
    b = target(rw, rh, false);
    const bgLod = Math.log2(2 * Math.max(8, Math.round(size.width / 30)));
    draw(progs.filter, b, (u) => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, a.t);
      gl.uniform1i(u('img'), 0);
      gl.uniform2f(u('inSize'), size.width, size.height);
      gl.uniform1i(u('mode'), MODES[filter]);
      gl.uniform1i(u('rot'), turn);
      gl.uniform3f(u('lo'), st ? st.lo[0] / 255 : 0, st ? st.lo[1] / 255 : 0, st ? st.lo[2] / 255 : 0);
      gl.uniform3f(u('hi'), st ? st.hi[0] / 255 : 1, st ? st.hi[1] / 255 : 1, st ? st.hi[2] / 255 : 1);
      gl.uniform2f(u('ylr'), st ? st.ylo / 255 : 0, st ? st.yhi / 255 : 1);
      gl.uniform1f(u('bgLod'), bgLod);
    });
    return { data: read(b), width: rw, height: rh };
  } finally {
    free([small, a, b]);
    gl.deleteTexture(tex);
    if (scaled) scaled.close();
  }
}

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

async function renderWorker(source, q, size, turn, filter) {
  const k = Math.min(1, (2 * Math.max(size.width, size.height)) / Math.max(source.width, source.height));
  const sw = Math.max(1, Math.round(source.width * k)), sh = Math.max(1, Math.round(source.height * k));
  const x = makeCanvas(sw, sh).getContext('2d', { willReadFrequently: true });
  x.drawImage(source, 0, 0, sw, sh);
  const img = x.getImageData(0, 0, sw, sh);
  const sq = scaleQuad(q, sw / source.width, sh / source.height);
  return renderCPU({ data: img.data, sw, sh, H: quadToRect(sq, size.width, size.height), ow: size.width, oh: size.height, rotation: turn, filter });
}

async function encode(data, w, h, mime, quality) {
  const c = makeCanvas(w, h);
  c.getContext('2d').putImageData(new ImageData(data, w, h), 0, 0);
  if (c.convertToBlob) return c.convertToBlob({ type: mime, quality });
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode'))), mime, quality));
}

export async function render(source, quad, opts = {}) {
  const turn = ((Math.round((opts.rotation || 0) / 90) % 4) + 4) % 4;
  const filter = MODES[opts.filter] != null ? opts.filter : 'original';
  const q = quad || fullQuad(source.width, source.height);
  const size = outputSize(q, opts.maxSide || 3500);
  let px = null;
  if (!opts.cpu && setup()) {
    try { px = await renderGL(source, q, size, turn, filter); } catch (_) { px = null; }
  }
  if (!px) px = await renderWorker(source, q, size, turn, filter);
  const blob = await encode(px.data, px.width, px.height, opts.mime || 'image/jpeg', opts.quality == null ? 0.9 : opts.quality);
  return { blob, width: px.width, height: px.height };
}
