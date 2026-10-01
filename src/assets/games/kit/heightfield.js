import { createNoise2D, fbm2D, ridged2D, smoothstep, lerp } from './math.js';

function terrace(h, steps, sharpness) {
  const s = h * steps;
  const base = Math.floor(s);
  const frac = s - base;
  return (base + smoothstep(0.5 - sharpness, 0.5 + sharpness, frac)) / steps;
}

export function createHeightfield(opts = {}) {
  const seed = opts.seed == null ? 1 : opts.seed;
  const size = opts.size || 1200;
  const height = opts.height == null ? 60 : opts.height;
  const shape = opts.shape || 'hills';
  const scale = opts.scale || 1 / 420;
  const rim = opts.rim == null ? 1 : opts.rim;
  const flatten = Array.isArray(opts.flatten) ? opts.flatten : [];
  const modify = typeof opts.modify === 'function' ? opts.modify : null;
  const canyonWidth = opts.canyonWidth || 80;
  const half = size / 2;
  const n1 = createNoise2D(seed);
  const n2 = createNoise2D(seed + 101);
  const n3 = createNoise2D(seed + 202);

  function canyonCenter(z) {
    return fbm2D(n2, z * scale * 0.55, 7.3, 3) * size * 0.11;
  }

  function base(x, z) {
    const u = x * scale;
    const v = z * scale;
    if (shape === 'flat') {
      return height * 0.05 * fbm2D(n1, u * 2, v * 2, 3);
    }
    if (shape === 'canyon') {
      const d = Math.abs(x - canyonCenter(z));
      const wall = smoothstep(canyonWidth * 0.32, canyonWidth, d);
      const plateau = 0.72 + 0.28 * ridged2D(n1, u * 1.6, v * 1.6, 4);
      const h = terrace(wall * plateau, 6, 0.18);
      return height * h + 1.2 * fbm2D(n3, u * 14, v * 14, 3);
    }
    if (shape === 'valley') {
      const d = Math.abs(x) / half;
      const sides = smoothstep(0.08, 0.85, d) * (0.55 + 0.45 * ridged2D(n1, u, v, 5));
      return height * (sides + 0.06 * fbm2D(n3, u * 4, v * 4, 3));
    }
    if (shape === 'dunes') {
      const warp = fbm2D(n1, u * 0.8, v * 0.8, 3) * 3.5;
      const ripple = 0.5 + 0.5 * Math.sin(u * 7 + v * 2.2 + warp);
      return height * (0.22 * ripple * ripple + 0.3 * (0.5 + 0.5 * fbm2D(n2, u * 0.6, v * 0.6, 4)));
    }
    if (shape === 'coast') {
      const shore = fbm2D(n2, z * scale * 0.7, 3.1, 3) * size * 0.08;
      const land = smoothstep(-half * 0.12, half * 0.18, x - shore);
      const hills = 0.55 + 0.45 * fbm2D(n1, u, v, 5);
      return height * land * hills - 10 * (1 - land);
    }
    return height * (0.55 * fbm2D(n1, u, v, 5) + 0.45 * ridged2D(n2, u * 0.7, v * 0.7, 4) - 0.2);
  }

  function heightAt(x, z) {
    let h = base(x, z);
    if (rim > 0) {
      const e = Math.max(Math.abs(x), Math.abs(z)) / half;
      h += smoothstep(0.8, 1.0, e) * Math.max(height, 30) * 1.3 * rim;
    }
    for (let i = 0; i < flatten.length; i++) {
      const f = flatten[i];
      const dx = x - f.x;
      const dz = z - f.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      const r = f.radius;
      const fall = f.falloff == null ? r * 0.8 : f.falloff;
      if (d < r + fall) {
        const t = d <= r ? 1 : 1 - smoothstep(0, 1, (d - r) / Math.max(fall, 1e-6));
        h = lerp(h, f.height == null ? 0 : f.height, t);
      }
    }
    if (modify) h = modify(x, z, h);
    return h;
  }

  function normalAt(x, z, out) {
    const o = out || { x: 0, y: 1, z: 0 };
    const e = 0.75;
    const hx = heightAt(x + e, z) - heightAt(x - e, z);
    const hz = heightAt(x, z + e) - heightAt(x, z - e);
    const nx = -hx;
    const ny = 2 * e;
    const nz = -hz;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
    o.x = nx / l; o.y = ny / l; o.z = nz / l;
    return o;
  }

  return { seed, size, height, shape, heightAt, normalAt, canyonCenter };
}
