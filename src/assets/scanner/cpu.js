export function warpCPU(src, sw, sh, H, ow, oh) {
  const out = new Uint8ClampedArray(ow * oh * 4);
  const [m0, m1, m2, m3, m4, m5, m6, m7, m8] = H;
  for (let y = 0; y < oh; y++) {
    const py = y + 0.5;
    for (let x = 0; x < ow; x++) {
      const px = x + 0.5;
      const d = m6 * px + m7 * py + m8;
      const fx = (m0 * px + m1 * py + m2) / d - 0.5, fy = (m3 * px + m4 * py + m5) / d - 0.5;
      let x0 = Math.floor(fx), y0 = Math.floor(fy);
      const ax = fx - x0, ay = fy - y0;
      let x1 = x0 + 1, y1 = y0 + 1;
      if (x0 < 0) x0 = 0; else if (x0 >= sw) x0 = sw - 1;
      if (x1 < 0) x1 = 0; else if (x1 >= sw) x1 = sw - 1;
      if (y0 < 0) y0 = 0; else if (y0 >= sh) y0 = sh - 1;
      if (y1 < 0) y1 = 0; else if (y1 >= sh) y1 = sh - 1;
      const p00 = (y0 * sw + x0) * 4, p10 = (y0 * sw + x1) * 4, p01 = (y1 * sw + x0) * 4, p11 = (y1 * sw + x1) * 4;
      const o = (y * ow + x) * 4;
      for (let k = 0; k < 3; k++) {
        const top = src[p00 + k] * (1 - ax) + src[p10 + k] * ax;
        const bot = src[p01 + k] * (1 - ax) + src[p11 + k] * ax;
        out[o + k] = top * (1 - ay) + bot * ay;
      }
      out[o + 3] = 255;
    }
  }
  return out;
}

export function rotateCPU(data, w, h, quarter) {
  const q = ((quarter % 4) + 4) % 4;
  if (!q) return { data, w, h };
  const ow = q % 2 ? h : w, oh = q % 2 ? w : h;
  const out = new Uint8ClampedArray(ow * oh * 4);
  for (let Y = 0; Y < oh; Y++) {
    for (let X = 0; X < ow; X++) {
      let sx, sy;
      if (q === 1) { sx = Y; sy = h - 1 - X; }
      else if (q === 2) { sx = w - 1 - X; sy = h - 1 - Y; }
      else { sx = w - 1 - Y; sy = X; }
      const s = (sy * w + sx) * 4, o = (Y * ow + X) * 4;
      out[o] = data[s]; out[o + 1] = data[s + 1]; out[o + 2] = data[s + 2]; out[o + 3] = data[s + 3];
    }
  }
  return { data: out, w: ow, h: oh };
}

const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export function stats(data, w, h) {
  const n = w * h;
  const hr = new Uint32Array(256), hg = new Uint32Array(256), hb = new Uint32Array(256), hy = new Uint32Array(256);
  for (let p = 0; p < n; p++) {
    const r = data[p * 4], g = data[p * 4 + 1], b = data[p * 4 + 2];
    hr[r]++; hg[g]++; hb[b]++;
    hy[Math.round(lum(r, g, b))]++;
  }
  const at = (hist, frac) => {
    const target = n * frac;
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc >= target) return v;
    }
    return 255;
  };
  return { lo: [at(hr, 0.01), at(hg, 0.01), at(hb, 0.01)], hi: [at(hr, 0.98), at(hg, 0.98), at(hb, 0.98)], ylo: at(hy, 0.01), yhi: at(hy, 0.99) };
}

export function boxBlur(ch, w, h, r) {
  const W = w + 1, I = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += ch[y * w + x];
      I[(y + 1) * W + x + 1] = I[y * W + x + 1] + row;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      out[y * w + x] = (I[y1 * W + x1] - I[y0 * W + x1] - I[y1 * W + x0] + I[y0 * W + x0]) / ((y1 - y0) * (x1 - x0));
    }
  }
  return out;
}

export function filterCPU(data, w, h, mode, st) {
  const n = w * h, out = new Uint8ClampedArray(n * 4);
  if (mode === 'gray') {
    const span = Math.max(1, st.yhi - st.ylo);
    for (let p = 0; p < n; p++) {
      let y = clamp01((lum(data[p * 4], data[p * 4 + 1], data[p * 4 + 2]) - st.ylo) / span);
      y += (y * y * (3 - 2 * y) - y) * 0.5;
      out[p * 4] = out[p * 4 + 1] = out[p * 4 + 2] = y * 255;
      out[p * 4 + 3] = 255;
    }
    return out;
  }
  if (mode === 'auto') {
    const lv = new Float32Array(n * 3);
    const span = [0, 1, 2].map((c) => Math.max(1, st.hi[c] - st.lo[c]));
    for (let p = 0; p < n; p++) {
      for (let c = 0; c < 3; c++) lv[p * 3 + c] = clamp01((data[p * 4 + c] - st.lo[c]) / span[c]);
      const y = lum(lv[p * 3], lv[p * 3 + 1], lv[p * 3 + 2]);
      for (let c = 0; c < 3; c++) lv[p * 3 + c] = clamp01(y + (lv[p * 3 + c] - y) * 1.15);
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        for (let c = 0; c < 3; c++) {
          let s = 0, k = 0;
          for (let dy = -1; dy <= 1; dy++) {
            const yy = y + dy;
            if (yy < 0 || yy >= h) continue;
            for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx;
              if (xx < 0 || xx >= w) continue;
              s += lv[(yy * w + xx) * 3 + c];
              k++;
            }
          }
          const v = lv[p * 3 + c];
          out[p * 4 + c] = clamp01(v + 0.6 * (v - s / k)) * 255;
        }
        out[p * 4 + 3] = 255;
      }
    }
    return out;
  }
  if (mode !== 'bw' && mode !== 'whiteboard') {
    out.set(data);
    return out;
  }
  const r = Math.max(8, Math.round(w / 30));
  if (mode === 'bw') {
    const Y = new Float32Array(n);
    for (let p = 0; p < n; p++) Y[p] = lum(data[p * 4], data[p * 4 + 1], data[p * 4 + 2]);
    const bg = boxBlur(Y, w, h, r);
    for (let p = 0; p < n; p++) {
      const v = smooth(0.78, 0.92, Y[p] / Math.max(1, bg[p])) * 255;
      out[p * 4] = out[p * 4 + 1] = out[p * 4 + 2] = v;
      out[p * 4 + 3] = 255;
    }
    return out;
  }
  const bgs = [0, 1, 2].map((c) => {
    const a = new Float32Array(n);
    for (let p = 0; p < n; p++) a[p] = data[p * 4 + c];
    return boxBlur(a, w, h, r);
  });
  for (let p = 0; p < n; p++) {
    const v = [0, 1, 2].map((c) => clamp01(data[p * 4 + c] / Math.max(1, bgs[c][p])));
    const y = lum(v[0], v[1], v[2]);
    for (let c = 0; c < 3; c++) out[p * 4 + c] = clamp01(y + (v[c] - y) * 1.4) * 255;
    out[p * 4 + 3] = 255;
  }
  return out;
}
