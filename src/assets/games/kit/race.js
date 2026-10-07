const RACE_TIME_EPS = 1e-9;
const RACE_GO_HOLD = 1;
const RACE_PARALLEL_EPS = 1e-9;

function raceNum(v, d) {
  return typeof v === 'number' && v === v && v !== Infinity && v !== -Infinity ? v : d;
}

function raceVec(a, fallback) {
  if (Array.isArray(a)) return { x: raceNum(a[0], 0), y: raceNum(a[1], 0), z: raceNum(a[2], 0) };
  if (a && typeof a === 'object') return { x: raceNum(a.x, 0), y: raceNum(a.y, 0), z: raceNum(a.z, 0) };
  return { x: fallback.x, y: fallback.y, z: fallback.z };
}

function raceX(a) {
  return Array.isArray(a) ? a[0] : a.x;
}

function raceY(a) {
  return Array.isArray(a) ? a[1] : a.y;
}

function raceZ(a) {
  return Array.isArray(a) ? a[2] : a.z;
}

function raceOrthoUnit(v, n) {
  const d = v.x * n.x + v.y * n.y + v.z * n.z;
  const x = v.x - n.x * d;
  const y = v.y - n.y * d;
  const z = v.z - n.z * d;
  const l = Math.sqrt(x * x + y * y + z * z);
  if (l < 1e-6) return null;
  return { x: x / l, y: y / l, z: z / l };
}

function raceHalf(v) {
  if (v === null || v === undefined) return Infinity;
  const n = Number(v);
  if (n !== n) return Infinity;
  return Math.abs(n);
}

function raceGate(src, index) {
  const g = src && typeof src === 'object' ? src : {};
  const pos = raceVec(g.pos, { x: 0, y: 0, z: 0 });
  const n = raceVec(g.normal, { x: 0, y: 0, z: -1 });
  let l = Math.sqrt(n.x * n.x + n.y * n.y + n.z * n.z);
  if (l < 1e-12) {
    n.x = 0; n.y = 0; n.z = -1; l = 1;
  }
  n.x /= l; n.y /= l; n.z /= l;
  let up = null;
  if (g.up) up = raceOrthoUnit(raceVec(g.up, { x: 0, y: 1, z: 0 }), n);
  if (!up) up = raceOrthoUnit({ x: 0, y: 1, z: 0 }, n);
  if (!up) up = raceOrthoUnit({ x: 0, y: 0, z: 1 }, n);
  const right = {
    x: n.y * up.z - n.z * up.y,
    y: n.z * up.x - n.x * up.z,
    z: n.x * up.y - n.y * up.x
  };
  return {
    index,
    pos,
    normal: n,
    up,
    right,
    halfW: raceHalf(g.halfW),
    halfH: raceHalf(g.halfH)
  };
}

export function createCheckpoints(list, opts = {}) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const src = Array.isArray(list) ? list : [];
  const gates = [];
  for (let i = 0; i < src.length; i++) gates.push(raceGate(src[i], i));
  const count = gates.length;
  const loop = !!o.loop;
  const laps = Math.max(1, Math.floor(raceNum(o.laps, 1)));
  const margin = Math.max(0, raceNum(o.margin, 0));
  const twoWay = !!o.twoWay;
  let startAt = Math.floor(raceNum(o.startAt, 0));
  if (startAt < 0 || startAt >= count) startAt = 0;

  function crossing(i, prevPos, pos) {
    const g = gates[i];
    if (!g || !prevPos || !pos) return null;
    const ax = raceX(prevPos), ay = raceY(prevPos), az = raceZ(prevPos);
    const bx = raceX(pos), by = raceY(pos), bz = raceZ(pos);
    const n = g.normal;
    const p = g.pos;
    const d0 = (ax - p.x) * n.x + (ay - p.y) * n.y + (az - p.z) * n.z;
    const d1 = (bx - p.x) * n.x + (by - p.y) * n.y + (bz - p.z) * n.z;
    if (!(d0 === d0) || !(d1 === d1)) return null;
    if (Math.abs(d1 - d0) < RACE_PARALLEL_EPS) return null;
    let forward;
    if (d0 < 0 && d1 >= 0) forward = true;
    else if (d0 > 0 && d1 <= 0) forward = false;
    else return null;
    const t = d0 / (d0 - d1);
    const x = ax + (bx - ax) * t;
    const y = ay + (by - ay) * t;
    const z = az + (bz - az) * t;
    const rx = x - p.x, ry = y - p.y, rz = z - p.z;
    const u = rx * g.right.x + ry * g.right.y + rz * g.right.z;
    const v = rx * g.up.x + ry * g.up.y + rz * g.up.z;
    if (Math.abs(u) > g.halfW + margin || Math.abs(v) > g.halfH + margin) return null;
    return { t, x, y, z, u, v, forward };
  }

  function advance(i) {
    const before = cp.passed;
    cp.passed = before + 1;
    if (loop) {
      if (i === 0 && before > 0) {
        cp.lap += 1;
        if (cp.lap >= laps) {
          cp.finished = true;
          cp.next = -1;
          return;
        }
      }
      cp.next = (i + 1) % count;
      return;
    }
    if (i >= count - 1) {
      cp.lap = 1;
      cp.finished = true;
      cp.next = -1;
      return;
    }
    cp.next = i + 1;
  }

  function test(prevPos, pos) {
    cp.lastReverse = -1;
    if (cp.finished || !count || cp.next < 0) return -1;
    const i = cp.next;
    const c = crossing(i, prevPos, pos);
    if (!c) return -1;
    if (!c.forward && !twoWay) {
      cp.lastReverse = i;
      return -1;
    }
    advance(i);
    return i;
  }

  function testAny(prevPos, pos) {
    let best = -1;
    let bestT = Infinity;
    for (let i = 0; i < count; i++) {
      const c = crossing(i, prevPos, pos);
      if (!c) continue;
      if (!c.forward && !twoWay) continue;
      if (c.t < bestT) {
        bestT = c.t;
        best = i;
      }
    }
    return best;
  }

  function progress() {
    if (!count) return 0;
    if (loop) {
      if (cp.finished) return cp.lap;
      if (cp.passed === 0 && startAt === 0) return cp.lap;
      return cp.lap + ((cp.next - 1 + count) % count) / count;
    }
    if (cp.finished) return 1;
    return cp.next / count;
  }

  function reset() {
    cp.next = count ? startAt : -1;
    cp.lap = 0;
    cp.passed = 0;
    cp.finished = false;
    cp.lastReverse = -1;
  }

  const cp = {
    gates,
    count,
    loop,
    laps,
    margin,
    twoWay,
    startAt,
    next: count ? startAt : -1,
    lap: 0,
    passed: 0,
    finished: false,
    lastReverse: -1,
    test,
    testAny,
    crossing,
    progress,
    reset,
    dispose: function () {}
  };
  return cp;
}

export function createRaceClock(opts = {}) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const length = Math.max(0, raceNum(o.countdown, 3));
  const evt = { tick: null, go: false };
  let elapsed = 0;
  let lastTick = null;
  let goPending = false;
  let lapStart = 0;

  const clock = {
    countdownLength: length,
    phase: 'idle',
    time: 0,
    remaining: 0,
    count: -1,
    splits: [],
    laps: [],
    start,
    step,
    split,
    lap,
    finish,
    reset,
    dispose: function () { reset(); }
  };

  function reset() {
    clock.phase = 'idle';
    clock.time = 0;
    clock.remaining = 0;
    clock.count = -1;
    clock.splits = [];
    clock.laps = [];
    elapsed = 0;
    lastTick = null;
    goPending = false;
    lapStart = 0;
  }

  function start() {
    reset();
    if (length > 0) {
      clock.phase = 'countdown';
      clock.remaining = length;
      clock.count = Math.ceil(length - RACE_TIME_EPS);
    } else {
      clock.phase = 'running';
      clock.count = 0;
      goPending = true;
    }
    return clock;
  }

  function step(dt) {
    evt.tick = null;
    evt.go = false;
    const d = raceNum(dt, 0);
    if (clock.phase === 'countdown') {
      if (d > 0) elapsed += d;
      if (elapsed >= length - RACE_TIME_EPS) {
        clock.phase = 'running';
        clock.remaining = 0;
        clock.count = 0;
        clock.time = Math.max(0, elapsed - length);
        lapStart = 0;
        evt.go = true;
      } else {
        clock.remaining = length - elapsed;
        const n = Math.ceil(clock.remaining - RACE_TIME_EPS);
        clock.count = n;
        if (n !== lastTick) {
          lastTick = n;
          evt.tick = n;
        }
      }
      return evt;
    }
    if (clock.phase === 'running') {
      if (goPending) {
        goPending = false;
        evt.go = true;
      }
      if (d > 0) clock.time += d;
      if (clock.count === 0 && clock.time >= RACE_GO_HOLD - RACE_TIME_EPS) clock.count = -1;
    }
    return evt;
  }

  function split() {
    if (clock.phase !== 'running') return null;
    clock.splits.push(clock.time);
    return { time: clock.time, index: clock.splits.length - 1 };
  }

  function lap() {
    if (clock.phase !== 'running') return null;
    const lapTime = clock.time - lapStart;
    lapStart = clock.time;
    clock.laps.push(lapTime);
    return { lapTime, total: clock.time, index: clock.laps.length - 1 };
  }

  function finish() {
    if (clock.phase === 'running') {
      clock.phase = 'finished';
      clock.count = -1;
      return clock.time;
    }
    if (clock.phase === 'finished') return clock.time;
    return null;
  }

  return clock;
}

export function rank(entries) {
  const src = Array.isArray(entries) ? entries : [];
  const rows = [];
  for (let i = 0; i < src.length; i++) {
    const e = src[i] && typeof src[i] === 'object' ? src[i] : {};
    rows.push({
      e,
      i,
      fin: !!e.finished,
      ft: raceNum(e.finishTime, Infinity),
      lap: raceNum(e.lap, 0),
      prog: raceNum(e.progress, 0)
    });
  }
  rows.sort(function (a, b) {
    if (a.fin !== b.fin) return a.fin ? -1 : 1;
    if (a.fin && a.ft !== b.ft) return a.ft < b.ft ? -1 : 1;
    if (a.lap !== b.lap) return b.lap - a.lap;
    if (a.prog !== b.prog) return b.prog - a.prog;
    return a.i - b.i;
  });
  const out = [];
  for (let k = 0; k < rows.length; k++) {
    const copy = Object.assign({}, rows[k].e);
    copy.position = k + 1;
    out.push(copy);
  }
  return out;
}

export function medalFor(time, medals) {
  if (typeof time !== 'number' || time !== time) return null;
  if (!medals || typeof medals !== 'object') return null;
  if (typeof medals.gold === 'number' && time <= medals.gold) return 'gold';
  if (typeof medals.silver === 'number' && time <= medals.silver) return 'silver';
  if (typeof medals.bronze === 'number' && time <= medals.bronze) return 'bronze';
  return null;
}

function raceDigits(digits) {
  const d = Math.floor(raceNum(digits, 3));
  return d < 0 ? 0 : d > 6 ? 6 : d;
}

function racePad(n, width) {
  let s = String(n);
  while (s.length < width) s = '0' + s;
  return s;
}

function raceUnits(t, digits) {
  const p = Math.pow(10, digits);
  const units = Math.floor(t * p + 1e-7);
  const frac = units % p;
  const sec = (units - frac) / p;
  return { sec, frac, p };
}

export function formatRaceTime(t, digits = 3) {
  const dg = raceDigits(digits);
  if (typeof t !== 'number' || t !== t || t < 0 || t === Infinity) {
    return '-:--' + (dg > 0 ? '.' + '-'.repeat(dg) : '');
  }
  const u = raceUnits(t, dg);
  const m = Math.floor(u.sec / 60);
  const s = u.sec - m * 60;
  return m + ':' + racePad(s, 2) + (dg > 0 ? '.' + racePad(u.frac, dg) : '');
}

export function formatSplitDelta(d, digits = 3) {
  const dg = raceDigits(digits);
  if (typeof d !== 'number' || d !== d || d === Infinity || d === -Infinity) return '';
  const sign = d < 0 ? '−' : '+';
  const u = raceUnits(Math.abs(d), dg);
  const tail = dg > 0 ? '.' + racePad(u.frac, dg) : '';
  if (u.sec >= 60) {
    const m = Math.floor(u.sec / 60);
    const s = u.sec - m * 60;
    return sign + m + ':' + racePad(s, 2) + tail;
  }
  return sign + u.sec + tail;
}
