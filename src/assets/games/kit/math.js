export const DEG = Math.PI / 180;
export const TAU = Math.PI * 2;

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function invLerp(a, b, v) {
  return b === a ? 0 : (v - a) / (b - a);
}

export function smoothstep(a, b, v) {
  const t = clamp(invLerp(a, b, v), 0, 1);
  return t * t * (3 - 2 * t);
}

export function damp(current, target, lambda, dt) {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

export function approach(current, target, step) {
  if (current < target) return Math.min(target, current + step);
  return Math.max(target, current - step);
}

export function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

export function expo(v, amount) {
  return v * (1 - amount) + v * v * v * amount;
}

export function deadzone(v, dz) {
  const a = Math.abs(v);
  if (a <= dz) return 0;
  return Math.sign(v) * (a - dz) / (1 - dz);
}

export function v3(x = 0, y = 0, z = 0) {
  return { x, y, z };
}

export function v3copy(out, a) {
  out.x = a.x; out.y = a.y; out.z = a.z;
  return out;
}

export function v3set(out, x, y, z) {
  out.x = x; out.y = y; out.z = z;
  return out;
}

export function v3add(out, a, b) {
  out.x = a.x + b.x; out.y = a.y + b.y; out.z = a.z + b.z;
  return out;
}

export function v3sub(out, a, b) {
  out.x = a.x - b.x; out.y = a.y - b.y; out.z = a.z - b.z;
  return out;
}

export function v3scale(out, a, s) {
  out.x = a.x * s; out.y = a.y * s; out.z = a.z * s;
  return out;
}

export function v3addScaled(out, a, b, s) {
  out.x = a.x + b.x * s; out.y = a.y + b.y * s; out.z = a.z + b.z * s;
  return out;
}

export function v3dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function v3cross(out, a, b) {
  const x = a.y * b.z - a.z * b.y;
  const y = a.z * b.x - a.x * b.z;
  const z = a.x * b.y - a.y * b.x;
  out.x = x; out.y = y; out.z = z;
  return out;
}

export function v3len(a) {
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
}

export function v3dist(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function v3norm(out, a) {
  const l = v3len(a);
  if (l > 1e-12) { out.x = a.x / l; out.y = a.y / l; out.z = a.z / l; }
  else { out.x = 0; out.y = 0; out.z = 0; }
  return out;
}

export function v3lerp(out, a, b, t) {
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  out.z = a.z + (b.z - a.z) * t;
  return out;
}

export function q(x = 0, y = 0, z = 0, w = 1) {
  return { x, y, z, w };
}

export function qcopy(out, a) {
  out.x = a.x; out.y = a.y; out.z = a.z; out.w = a.w;
  return out;
}

export function qmul(out, a, b) {
  const x = a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y;
  const y = a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x;
  const z = a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w;
  const w = a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z;
  out.x = x; out.y = y; out.z = z; out.w = w;
  return out;
}

export function qnorm(out, a) {
  const l = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z + a.w * a.w) || 1;
  out.x = a.x / l; out.y = a.y / l; out.z = a.z / l; out.w = a.w / l;
  return out;
}

export function qconj(out, a) {
  out.x = -a.x; out.y = -a.y; out.z = -a.z; out.w = a.w;
  return out;
}

export function qFromAxisAngle(out, ax, ay, az, angle) {
  const h = angle / 2;
  const s = Math.sin(h);
  out.x = ax * s; out.y = ay * s; out.z = az * s; out.w = Math.cos(h);
  return out;
}

export function qFromYawPitchRoll(out, yaw, pitch, roll) {
  const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2);
  const cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
  const cr = Math.cos(roll / 2), sr = Math.sin(roll / 2);
  out.x = cy * sp * cr + sy * cp * sr;
  out.y = sy * cp * cr - cy * sp * sr;
  out.z = cy * cp * sr - sy * sp * cr;
  out.w = cy * cp * cr + sy * sp * sr;
  return out;
}

export function qRotate(out, qa, v) {
  const ix = qa.w * v.x + qa.y * v.z - qa.z * v.y;
  const iy = qa.w * v.y + qa.z * v.x - qa.x * v.z;
  const iz = qa.w * v.z + qa.x * v.y - qa.y * v.x;
  const iw = -qa.x * v.x - qa.y * v.y - qa.z * v.z;
  out.x = ix * qa.w + iw * -qa.x + iy * -qa.z - iz * -qa.y;
  out.y = iy * qa.w + iw * -qa.y + iz * -qa.x - ix * -qa.z;
  out.z = iz * qa.w + iw * -qa.z + ix * -qa.y - iy * -qa.x;
  return out;
}

export function qIntegrateBody(out, qa, wx, wy, wz, dt) {
  const ang = Math.sqrt(wx * wx + wy * wy + wz * wz);
  if (ang < 1e-9) return qcopy(out, qa);
  const dq = qFromAxisAngle({ x: 0, y: 0, z: 0, w: 1 }, wx / ang, wy / ang, wz / ang, ang * dt);
  qmul(out, qa, dq);
  return qnorm(out, out);
}

export function qSlerp(out, a, b, t) {
  let bx = b.x, by = b.y, bz = b.z, bw = b.w;
  let cos = a.x * bx + a.y * by + a.z * bz + a.w * bw;
  if (cos < 0) { cos = -cos; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  let k0, k1;
  if (cos > 0.9995) { k0 = 1 - t; k1 = t; }
  else {
    const th = Math.acos(cos);
    const s = Math.sin(th);
    k0 = Math.sin((1 - t) * th) / s;
    k1 = Math.sin(t * th) / s;
  }
  out.x = a.x * k0 + bx * k1; out.y = a.y * k0 + by * k1; out.z = a.z * k0 + bz * k1; out.w = a.w * k0 + bw * k1;
  return qnorm(out, out);
}

export function forwardOf(out, qa) {
  return qRotate(out, qa, { x: 0, y: 0, z: -1 });
}

export function rightOf(out, qa) {
  return qRotate(out, qa, { x: 1, y: 0, z: 0 });
}

export function upOf(out, qa) {
  return qRotate(out, qa, { x: 0, y: 1, z: 0 });
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

const GRAD = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

export function createNoise2D(seed = 1) {
  const rng = mulberry32(seed);
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  return function noise2D(x, y) {
    const s = (x + y) * F2;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const t = (i + j) * G2;
    const x0 = x - (i - t);
    const y0 = y - (j - t);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;
    let n = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) { const g = GRAD[perm[ii + perm[jj]] & 7]; t0 *= t0; n += t0 * t0 * (g[0] * x0 + g[1] * y0); }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) { const g = GRAD[perm[ii + i1 + perm[jj + j1]] & 7]; t1 *= t1; n += t1 * t1 * (g[0] * x1 + g[1] * y1); }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) { const g = GRAD[perm[ii + 1 + perm[jj + 1]] & 7]; t2 *= t2; n += t2 * t2 * (g[0] * x2 + g[1] * y2); }
    return 70 * n;
  };
}

export function fbm2D(noise, x, y, octaves = 5, lacunarity = 2, gain = 0.5) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(x * freq, y * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

export function ridged2D(noise, x, y, octaves = 5, lacunarity = 2, gain = 0.5) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    const n = 1 - Math.abs(noise(x * freq, y * freq));
    sum += amp * n * n;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}
