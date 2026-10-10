export function createMonitor(fs, { ceilingDb = -3, releaseMs = 50, rampMs = 10 } = {}) {
  const ceiling = Math.pow(10, ceilingDb / 20);
  const release = Math.exp(-1 / ((releaseMs / 1000) * fs));
  const ramp = 1 - Math.exp(-1 / ((rampMs / 1000) * fs));
  const st = new Float64Array(3);
  const GAIN = 0, TARGET = 1, ENV = 2;
  const m = {};

  m.setTarget = (gain) => {
    st[TARGET] = gain > 0 ? gain : 0;
  };

  m.process = (input, output, n = input.length) => {
    let g = st[GAIN], env = st[ENV];
    const target = st[TARGET];
    for (let i = 0; i < n; i++) {
      g += ramp * (target - g);
      const y = input[i] * g;
      const a = y < 0 ? -y : y;
      const decayed = env * release;
      env = a > decayed ? a : decayed;
      output[i] = env > ceiling ? (y * ceiling) / env : y;
    }
    st[GAIN] = target === 0 && g < 1e-9 ? 0 : g;
    st[ENV] = env < 1e-12 ? 0 : env;
  };

  return m;
}
