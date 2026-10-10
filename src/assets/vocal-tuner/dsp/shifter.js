const RING = 8192;
const MASK = RING - 1;

export function createShifter(fs, opts = {}) {
  const F = opts.fade || 128;
  const rhoMax = Math.pow(2, 2 / 12);
  const dlo = 4 + F * (rhoMax - 1) + 2;
  const ring = new Float32Array(RING);
  const fade = new Float32Array(F + 1);
  for (let i = 0; i <= F; i++) fade[i] = 0.5 - 0.5 * Math.cos((Math.PI * i) / F);
  const pos = new Float64Array(2);
  let w = 0, xf = -1;
  pos[0] = -(dlo + 64);
  const s = { delay: dlo + 64, dlo };

  function read(pos) {
    const i = Math.floor(pos), f = pos - i;
    const y0 = ring[(i - 1) & MASK], y1 = ring[i & MASK], y2 = ring[(i + 1) & MASK], y3 = ring[(i + 2) & MASK];
    const c1 = 0.5 * (y2 - y0);
    const c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
    const c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
    return ((c3 * f + c2) * f + c1) * f + y1;
  }

  function jumpLength(period, r) {
    let J = period;
    while (J < F) J += period;
    const lo = Math.max(F, Math.floor(J * 0.92)), hi = Math.ceil(J * 1.08);
    const len = Math.min(Math.round(period), 256);
    let best = J, bestC = -2;
    for (let j = lo; j <= hi; j++) {
      let xy = 0, xx = 0, yy = 0;
      for (let k = 0; k < len; k++) {
        const a = ring[(Math.floor(r) - k) & MASK], b = ring[(Math.floor(r) - k - j) & MASK];
        xy += a * b; xx += a * a; yy += b * b;
      }
      const c = xx > 0 && yy > 0 ? xy / Math.sqrt(xx * yy) : 0;
      if (c > bestC) { bestC = c; best = j; }
    }
    return best;
  }

  s.process = (input, output, ratio, period, voiced, n = input.length) => {
    let r = pos[0], r2 = pos[1];
    let sum = 0;
    for (let i = 0; i < n; i++) {
      ring[w & MASK] = input[i];
      w++;
      let y;
      if (xf >= 0) {
        const g = fade[xf];
        y = (1 - g) * read(r) + g * read(r2);
        r2 += ratio;
        xf++;
        if (xf > F) { r = r2; xf = -1; }
      } else y = read(r);
      r += ratio;
      const d = w - r;
      if (xf < 0 && voiced && period > 1) {
        if (ratio > 1 && d < dlo) {
          r2 = r - jumpLength(period, r);
          xf = 0;
        } else if (ratio < 1 && d > dlo + Math.max(F, period * Math.ceil(F / period))) {
          r2 = r + jumpLength(period, r);
          xf = 0;
        }
      }
      if (xf < 0 && (d < 3 || d > RING - 512)) r = w - (dlo + 64);
      output[i] = y;
      sum += d;
    }
    if (w > 0x40000000) {
      w -= 0x20000000;
      r -= 0x20000000;
      r2 -= 0x20000000;
    }
    pos[0] = r;
    pos[1] = r2;
    s.delay = sum / n;
  };

  return s;
}
