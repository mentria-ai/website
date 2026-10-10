export function createHighpass(fs, fc = 60) {
  const rc = 1 / (2 * Math.PI * fc), dt = 1 / fs;
  const a = rc / (rc + dt);
  let px = 0, py = 0;
  return {
    process(input, output, n = input.length) {
      for (let i = 0; i < n; i++) {
        const x = input[i];
        py = a * (py + x - px);
        px = x;
        output[i] = py;
      }
    },
    reset() { px = 0; py = 0; }
  };
}

export function createDecimator(taps = 47, maxBlock = 256) {
  const M = (taps - 1) / 2;
  const h = new Float64Array(taps);
  let sum = 0;
  for (let k = 0; k < taps; k++) {
    const x = k - M;
    const s = x === 0 ? 0.5 : Math.sin((Math.PI * x) / 2) / (Math.PI * x);
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * k) / (taps - 1)) + 0.08 * Math.cos((4 * Math.PI * k) / (taps - 1));
    h[k] = s * w;
    sum += h[k];
  }
  for (let k = 0; k < taps; k++) h[k] /= sum;
  const keep = taps - 1;
  const buf = new Float64Array(keep + maxBlock);
  return {
    delay: M / 2,
    process(input, output, n = input.length) {
      for (let i = 0; i < n; i++) buf[keep + i] = input[i];
      for (let o = 0, p = 1; p < n; o++, p += 2) {
        let acc = 0;
        for (let k = 0; k < taps; k++) acc += h[k] * buf[p + k];
        output[o] = acc;
      }
      for (let k = 0; k < keep; k++) buf[k] = buf[n + k];
    }
  };
}
