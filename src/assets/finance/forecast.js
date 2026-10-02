export function mulberry32(a) {
  let s = a | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randn(r) { return Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r()); }

export function median(a) {
  const s = a.slice().sort((x, y) => x - y);
  if (!s.length) return 0;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function quantile(sorted, p) {
  if (!sorted.length) return 0;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

export function mad(a) {
  const m = median(a);
  return median(a.map((x) => Math.abs(x - m)));
}

export function hampel(y) {
  const m = median(y);
  const d = 3 * 1.4826 * mad(y);
  if (!d) return y.slice();
  return y.map((v) => Math.max(m - d, Math.min(m + d, v)));
}

export function sesFit(y) {
  let best = null;
  for (let a = 0.05; a <= 0.951; a += 0.05) {
    let l = y[0];
    let sse = 0;
    const fitted = [];
    for (let t = 0; t < y.length; t++) {
      fitted.push(l);
      const e = y[t] - l;
      if (t > 0) sse += e * e;
      l += a * e;
    }
    if (!best || sse < best.sse) best = { alpha: a, level: l, sse, fitted };
  }
  const resid = y.map((v, i) => v - best.fitted[i]).slice(1);
  return { alpha: best.alpha, level: best.level, resid, sigma: Math.sqrt(best.sse / Math.max(1, y.length - 1)) };
}

function logistic(x, lo, hi) { return lo + (hi - lo) / (1 + Math.exp(-x)); }

export function nelderMead(f, x0, iters) {
  const n = x0.length;
  let pts = [x0.slice()];
  for (let i = 0; i < n; i++) { const p = x0.slice(); p[i] += 0.8; pts.push(p); }
  let vals = pts.map(f);
  for (let k = 0; k < (iters || 200 * n); k++) {
    const order = vals.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
    pts = order.map((i) => pts[i]);
    vals = order.map((i) => vals[i]);
    if (Math.abs(vals[n] - vals[0]) < 1e-9 * (1 + Math.abs(vals[0]))) break;
    const c = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += pts[i][j] / n;
    const xr = c.map((v, j) => v + (v - pts[n][j]));
    const fr = f(xr);
    if (fr < vals[0]) {
      const xe = c.map((v, j) => v + 2 * (v - pts[n][j]));
      const fe = f(xe);
      if (fe < fr) { pts[n] = xe; vals[n] = fe; } else { pts[n] = xr; vals[n] = fr; }
    } else if (fr < vals[n - 1]) { pts[n] = xr; vals[n] = fr; }
    else {
      const xc = c.map((v, j) => v + 0.5 * (pts[n][j] - v));
      const fc = f(xc);
      if (fc < vals[n]) { pts[n] = xc; vals[n] = fc; }
      else {
        for (let i = 1; i <= n; i++) { pts[i] = pts[i].map((v, j) => pts[0][j] + 0.5 * (v - pts[0][j])); vals[i] = f(pts[i]); }
      }
    }
  }
  let bi = 0;
  for (let i = 1; i < vals.length; i++) if (vals[i] < vals[bi]) bi = i;
  return { x: pts[bi], f: vals[bi] };
}

function hwRun(y, m, a, bs, g, phi, collect) {
  const mean = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;
  let l = mean(y.slice(0, m));
  let b = (mean(y.slice(m, 2 * m)) - l) / m;
  const s = y.slice(0, m).map((v) => v - l);
  let sse = 0;
  const resid = [];
  for (let t = 0; t < y.length; t++) {
    const si = t % m;
    const yhat = l + phi * b + s[si];
    const e = y[t] - yhat;
    if (t >= m) { sse += e * e; if (collect) resid.push(e); }
    l = l + phi * b + a * e;
    b = phi * b + a * bs * e;
    s[si] += g * e;
  }
  return { sse, l, b, s, resid };
}

export function hwFit(y, m) {
  const unpack = (x) => {
    const a = logistic(x[0], 0.01, 0.99);
    const bs = logistic(x[1], 0.01, 0.99);
    const g = logistic(x[2], 0.001, Math.max(0.002, 0.99 - a));
    const phi = logistic(x[3], 0.8, 0.98);
    return [a, bs, g, phi];
  };
  const f = (x) => { const p = unpack(x); const r = hwRun(y, m, p[0], p[1], p[2], p[3]); return isFinite(r.sse) ? r.sse : 1e30; };
  const best = nelderMead(f, [-1, -2, -2, 0], 400);
  const [a, bs, g, phi] = unpack(best.x);
  const run = hwRun(y, m, a, bs, g, phi, true);
  return {
    alpha: a, beta: bs, gamma: g, phi, resid: run.resid,
    forecast(h) {
      const out = [];
      let damp = 0;
      for (let k = 1; k <= h; k++) {
        damp += Math.pow(phi, k);
        out.push(run.l + damp * run.b + run.s[(y.length + k - 1) % m]);
      }
      return out;
    }
  };
}

export function forecastSeries(y0, h, opts) {
  const o = opts || {};
  const m = o.season || 12;
  let first = y0.findIndex((v) => v !== 0);
  if (first < 0) return { method: 'none', point: new Array(h).fill(0), resid: [0], n: 0 };
  const y = hampel(y0.slice(first));
  const n = y.length;
  const zeros = y.filter((v) => v === 0).length / n;
  if (n >= 6 && zeros >= 0.3) {
    const nz = y.filter((v) => v !== 0);
    const p = median(nz) * (1 - zeros);
    return { method: 'intermittent', point: new Array(h).fill(p), resid: y.map((v) => v - p), n };
  }
  if (n < 6) {
    const p = median(y.slice(-6));
    return { method: 'median', point: new Array(h).fill(p), resid: y.map((v) => v - p), n };
  }
  const ses = sesFit(y);
  const sesPoint = new Array(h).fill(ses.level);
  if (n < 12) return { method: 'ses', point: sesPoint, resid: ses.resid, n };
  const sn = [];
  for (let k = 0; k < h; k++) sn.push(y[n - m + (k % m)]);
  if (n < 24) {
    const point = sesPoint.map((v, i) => (v + sn[i]) / 2);
    const resid = [];
    for (let t = m; t < n; t++) resid.push(y[t] - (y[t - m] + ses.level) / 2);
    return { method: 'ses+snaive', point, resid: resid.length ? resid : ses.resid, n };
  }
  const hw = hwFit(y, m);
  const hwPoint = hw.forecast(h);
  const point = sesPoint.map((v, i) => (v + sn[i] + hwPoint[i]) / 3);
  return { method: 'ses+snaive+hw', point, resid: hw.resid.length ? hw.resid : ses.resid, n };
}

export function fan(paths, steps) {
  const out = [];
  for (let t = 0; t < steps; t++) {
    const col = paths.map((p) => p[t]).sort((a, b) => a - b);
    out.push({ p10: quantile(col, 0.1), p50: quantile(col, 0.5), p90: quantile(col, 0.9) });
  }
  return out;
}

export function backtest(y, folds, h) {
  const H = h || 1;
  const n = y.length;
  if (n < 9) return null;
  const errs = [];
  const scaleErr = [];
  const m = n > 24 ? 12 : 1;
  for (let i = Math.max(1, m); i < n; i++) scaleErr.push(Math.abs(y[i] - y[i - m]));
  const scale = scaleErr.reduce((s, v) => s + v, 0) / Math.max(1, scaleErr.length);
  if (!scale) return null;
  const start = Math.max(6, n - (folds || 6) - H + 1);
  let covered = 0;
  let total = 0;
  for (let origin = start; origin + H <= n; origin++) {
    const train = y.slice(0, origin);
    const f = forecastSeries(train, H);
    const r = f.resid.slice().sort((a, b) => a - b);
    for (let k = 0; k < H; k++) {
      const actual = y[origin + k];
      errs.push(Math.abs(actual - f.point[k]));
      const lo = f.point[k] + quantile(r, 0.1);
      const hi = f.point[k] + quantile(r, 0.9);
      total++;
      if (actual >= lo && actual <= hi) covered++;
    }
  }
  if (!errs.length) return null;
  return { mase: errs.reduce((s, v) => s + v, 0) / errs.length / scale, coverage: covered / total, folds: errs.length };
}

export function simulateGbm(opts) {
  const o = opts;
  const N = o.paths || 1000;
  const r = mulberry32(o.seed || 1);
  const dt = 1 / 12;
  const T = o.months;
  const classes = o.classes;
  const out = [];
  for (let k = 0; k < N; k++) {
    const vals = classes.map((c) => c.start);
    const path = [vals.reduce((s, v) => s + v, 0)];
    for (let t = 1; t <= T; t++) {
      let total = 0;
      for (let j = 0; j < classes.length; j++) {
        const c = classes[j];
        const mu = Math.log(1 + c.ret);
        const sig = c.sigma;
        const shock = sig > 0 ? Math.exp((mu - (sig * sig) / 2) * dt + sig * Math.sqrt(dt) * randn(r)) : Math.exp(mu * dt);
        vals[j] = (vals[j] + (c.contrib || 0)) * shock;
        total += vals[j];
      }
      path.push(total + (o.fixed ? o.fixed[t] || 0 : 0));
    }
    out.push(path);
  }
  const f = fan(out, T + 1);
  if (o.inflation) {
    for (let t = 0; t <= T; t++) {
      const d = Math.pow(1 + o.inflation, t / 12);
      f[t] = { p10: f[t].p10 / d, p50: f[t].p50 / d, p90: f[t].p90 / d };
    }
  }
  if (o.target != null) {
    const hit = out.filter((p) => p[T] / (o.inflation ? Math.pow(1 + o.inflation, T / 12) : 1) >= o.target).length;
    return { fan: f, probability: hit / N };
  }
  return { fan: f };
}

export function bootstrapCash(opts) {
  const o = opts;
  const N = o.paths || 1000;
  const r = mulberry32(o.seed || 7);
  const H = o.months;
  const K = o.residualMonths;
  const paths = [];
  for (let k = 0; k < N; k++) {
    let bal = o.start;
    const p = [];
    for (let t = 0; t < H; t++) {
      const draw = K ? Math.floor(r() * K) : -1;
      let shock = 0;
      if (draw >= 0) for (const series of o.residuals) shock += series[draw] || 0;
      bal += o.net[t] + shock * (o.partial && t === 0 ? o.partial : 1);
      p.push(bal);
    }
    paths.push(p);
  }
  const f = fan(paths, H);
  const below = [];
  for (let t = 0; t < H; t++) below.push(paths.filter((p) => p[t] < (o.buffer || 0)).length / N);
  return { fan: f, below };
}
