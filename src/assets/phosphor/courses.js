export const COURSE_IDS = ['c01', 'c02', 'c03', 'c04', 'c05'];

const NS = 'tools';
const BEST_KEY = 'phosphor_best';
const GHOST_PREFIX = 'phosphor_ghost_';
const MAX_PRIMS = 160;
const MIN_TARGETS = 4;
const MAX_TARGETS = 12;
const MAX_LIGHTS = 16;
const MAX_STRIPS = 40;
const MAX_PROPS = 12;
const MAX_GHOST_BYTES = 1048576;
const B64_CHUNK = 4096;
const EPS = 1e-4;
const RAMP_DIRS = ['+x', '-x', '+z', '-z'];
const PAR_KEYS = ['signal', 'gold', 'silver', 'bronze'];

const isNum = (v) => typeof v === 'number' && isFinite(v);
const isStr = (v) => typeof v === 'string' && v.length > 0;
const isVec3 = (v) => Array.isArray(v) && v.length === 3 && isNum(v[0]) && isNum(v[1]) && isNum(v[2]);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const knownId = (id) => typeof id === 'string' && COURSE_IDS.indexOf(id) >= 0;

const containerOf = (boxes, p) => {
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (p[0] > b.lo[0] + EPS && p[0] < b.hi[0] - EPS &&
      p[1] > b.lo[1] + EPS && p[1] < b.hi[1] - EPS &&
      p[2] > b.lo[2] + EPS && p[2] < b.hi[2] - EPS) return b.i;
  }
  return -1;
};

export function validateCourse(def) {
  const issues = [];
  if (!isObj(def)) return ['course must be an object'];

  if (!isStr(def.id)) issues.push('id must be a non-empty string');
  if (!isNum(def.version)) issues.push('version must be a number');
  if (!isStr(def.nameKey)) issues.push('nameKey must be a non-empty string');
  if (!isNum(def.order)) issues.push('order must be a number');

  const par = def.par;
  if (!isObj(par)) {
    issues.push('par must be an object with signal, gold, silver, bronze');
  } else {
    let parOk = true;
    for (let i = 0; i < PAR_KEYS.length; i++) {
      const k = PAR_KEYS[i];
      if (!isNum(par[k]) || par[k] <= 0) {
        issues.push('par.' + k + ' must be a positive number of seconds');
        parOk = false;
      }
    }
    if (parOk) {
      if (!(par.signal < par.gold)) issues.push('par ordering: signal must be less than gold');
      if (!(par.gold < par.silver)) issues.push('par ordering: gold must be less than silver');
      if (!(par.silver < par.bronze)) issues.push('par ordering: silver must be less than bronze');
    }
  }

  const w = def.worldDef;
  if (!isObj(w)) {
    issues.push('worldDef must be an object');
    return issues;
  }

  const boxes = [];
  const prims = w.prims;
  if (!Array.isArray(prims) || prims.length === 0) {
    issues.push('worldDef.prims must be a non-empty array');
  } else {
    if (prims.length > MAX_PRIMS) issues.push('worldDef.prims: ' + prims.length + ' exceeds max ' + MAX_PRIMS);
    for (let i = 0; i < prims.length; i++) {
      const p = prims[i];
      const at = 'prims[' + i + ']';
      if (!isObj(p)) { issues.push(at + ' must be an object'); continue; }
      if (p.type !== 'box' && p.type !== 'ramp') { issues.push(at + '.type must be box or ramp'); continue; }
      if (!isVec3(p.min) || !isVec3(p.max)) { issues.push(at + ' needs min and max as [x,y,z]'); continue; }
      if (p.type === 'ramp' && RAMP_DIRS.indexOf(p.dir) < 0) issues.push(at + '.dir must be one of +x, -x, +z, -z');
      if (p.mat !== undefined && !isStr(p.mat)) issues.push(at + '.mat must be a string');
      if (p.emissive !== undefined && !isVec3(p.emissive)) issues.push(at + '.emissive must be [r,g,b]');
      if (p.tint !== undefined && !isVec3(p.tint)) issues.push(at + '.tint must be [r,g,b]');
      const lo = [Math.min(p.min[0], p.max[0]), Math.min(p.min[1], p.max[1]), Math.min(p.min[2], p.max[2])];
      const hi = [Math.max(p.min[0], p.max[0]), Math.max(p.min[1], p.max[1]), Math.max(p.min[2], p.max[2])];
      if (hi[0] - lo[0] <= 0 || hi[1] - lo[1] <= 0 || hi[2] - lo[2] <= 0) {
        issues.push(at + ' has zero extent on at least one axis');
        continue;
      }
      boxes.push({ i: i, lo: lo, hi: hi });
    }
  }

  const targets = w.targets;
  if (!Array.isArray(targets)) {
    issues.push('worldDef.targets must be an array');
  } else {
    if (targets.length < MIN_TARGETS || targets.length > MAX_TARGETS) {
      issues.push('worldDef.targets: ' + targets.length + ' outside ' + MIN_TARGETS + '..' + MAX_TARGETS);
    }
    const seen = Object.create(null);
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      const at = 'targets[' + i + ']';
      if (!isObj(t)) { issues.push(at + ' must be an object'); continue; }
      if (!isStr(t.id)) issues.push(at + '.id must be a non-empty string');
      else if (seen[t.id]) issues.push(at + '.id duplicates "' + t.id + '"');
      else seen[t.id] = true;
      if (!isVec3(t.pos)) { issues.push(at + '.pos must be [x,y,z]'); continue; }
      if (!isNum(t.radius) || t.radius <= 0) issues.push(at + '.radius must be a positive number');
      if (t.hp !== 1 && t.hp !== 2) issues.push(at + '.hp must be 1 or 2');
      const hit = containerOf(boxes, t.pos);
      if (hit >= 0) issues.push(at + ' centre is inside prims[' + hit + ']');
    }
  }

  const lights = w.lights;
  if (lights !== undefined) {
    if (!Array.isArray(lights)) {
      issues.push('worldDef.lights must be an array');
    } else {
      if (lights.length > MAX_LIGHTS) issues.push('worldDef.lights: ' + lights.length + ' exceeds max ' + MAX_LIGHTS);
      for (let i = 0; i < lights.length; i++) {
        const l = lights[i];
        const at = 'lights[' + i + ']';
        if (!isObj(l)) { issues.push(at + ' must be an object'); continue; }
        if (!isVec3(l.pos)) issues.push(at + '.pos must be [x,y,z]');
        if (!isVec3(l.color)) issues.push(at + '.color must be [r,g,b]');
        if (!isNum(l.intensity)) issues.push(at + '.intensity must be a number');
        if (!isNum(l.radius) || l.radius <= 0) issues.push(at + '.radius must be a positive number');
      }
    }
  }

  const strips = w.strips;
  if (strips !== undefined) {
    if (!Array.isArray(strips)) {
      issues.push('worldDef.strips must be an array');
    } else {
      if (strips.length > MAX_STRIPS) issues.push('worldDef.strips: ' + strips.length + ' exceeds max ' + MAX_STRIPS);
      for (let i = 0; i < strips.length; i++) {
        const s = strips[i];
        const at = 'strips[' + i + ']';
        if (!isObj(s)) { issues.push(at + ' must be an object'); continue; }
        if (!isVec3(s.from) || !isVec3(s.to)) issues.push(at + ' needs from and to as [x,y,z]');
        if (s.color !== undefined && !isVec3(s.color)) issues.push(at + '.color must be [r,g,b]');
        if (s.width !== undefined && (!isNum(s.width) || s.width <= 0)) issues.push(at + '.width must be a positive number');
      }
    }
  }

  const props = w.props;
  if (props !== undefined) {
    if (!Array.isArray(props)) {
      issues.push('worldDef.props must be an array');
    } else {
      if (props.length > MAX_PROPS) issues.push('worldDef.props: ' + props.length + ' exceeds max ' + MAX_PROPS);
      for (let i = 0; i < props.length; i++) {
        const p = props[i];
        const at = 'props[' + i + ']';
        if (!isObj(p)) { issues.push(at + ' must be an object'); continue; }
        if (!isStr(p.type)) issues.push(at + '.type must be a non-empty string');
        if (!isVec3(p.pos)) issues.push(at + '.pos must be [x,y,z]');
        if (p.color !== undefined && !isVec3(p.color)) issues.push(at + '.color must be [r,g,b]');
      }
    }
  }

  const sun = w.sun;
  if (sun !== undefined) {
    if (!isObj(sun)) issues.push('worldDef.sun must be an object');
    else {
      if (!isVec3(sun.dir)) issues.push('worldDef.sun.dir must be [x,y,z]');
      if (!isVec3(sun.color)) issues.push('worldDef.sun.color must be [r,g,b]');
      if (!isNum(sun.intensity)) issues.push('worldDef.sun.intensity must be a number');
    }
  }
  if (w.ambient !== undefined && !isVec3(w.ambient)) issues.push('worldDef.ambient must be [r,g,b]');
  if (w.exposure !== undefined && !isNum(w.exposure)) issues.push('worldDef.exposure must be a number');
  if (w.fog !== undefined && !isObj(w.fog)) issues.push('worldDef.fog must be an object');

  const spawn = w.spawn;
  if (!isObj(spawn)) {
    issues.push('worldDef.spawn must be an object');
  } else {
    if (!isNum(spawn.yaw)) issues.push('worldDef.spawn.yaw must be a number');
    if (!isVec3(spawn.pos)) {
      issues.push('worldDef.spawn.pos must be [x,y,z]');
    } else {
      const hit = containerOf(boxes, spawn.pos);
      if (hit >= 0) issues.push('worldDef.spawn.pos is inside prims[' + hit + ']');
    }
  }

  return issues;
}

const cache = new Map();

export function loadCourse(id) {
  if (!knownId(id)) return Promise.reject(new Error('unknown course: ' + String(id)));
  const hit = cache.get(id);
  if (hit) return hit;
  const pending = import('./courses/' + id + '.js').then((mod) => {
    const def = mod ? mod.default : null;
    if (!isObj(def)) throw new Error('course ' + id + ' has no default export');
    const issues = validateCourse(def);
    if (issues.length) throw new Error('course ' + id + ' invalid: ' + issues.join('; '));
    return def;
  }).catch((err) => {
    cache.delete(id);
    if (err instanceof Error) throw err;
    throw new Error('course ' + id + ' failed to load: ' + String(err));
  });
  cache.set(id, pending);
  return pending;
}

const softLoad = (id) => loadCourse(id).then((def) => def, () => null);

export function medalFor(def, timeMs) {
  if (!isObj(def) || !isObj(def.par)) return null;
  if (!isNum(timeMs) || timeMs <= 0) return null;
  const par = def.par;
  for (let i = 0; i < PAR_KEYS.length; i++) {
    const v = par[PAR_KEYS[i]];
    if (!isNum(v) || v <= 0) return null;
  }
  const secs = timeMs / 1000;
  if (secs <= par.signal) return 'signal';
  if (secs <= par.gold) return 'gold';
  if (secs <= par.silver) return 'silver';
  if (secs <= par.bronze) return 'bronze';
  return null;
}

const adapter = () => {
  try {
    const g = typeof globalThis !== 'undefined' ? globalThis : null;
    const s = g ? g.MentriaStore : null;
    if (s && typeof s.get === 'function' && typeof s.set === 'function') return s;
  } catch (_) {}
  return null;
};

const readKey = (key) => {
  const s = adapter();
  if (!s) return Promise.resolve(null);
  let raw;
  try { raw = s.get(NS, key); } catch (_) { return Promise.resolve(null); }
  return Promise.resolve(raw).then((v) => (v === undefined ? null : v), () => null);
};

const writeKey = (key, value) => {
  const s = adapter();
  if (!s) return Promise.resolve(false);
  let raw;
  try { raw = s.set(NS, key, value); } catch (_) { return Promise.resolve(false); }
  return Promise.resolve(raw).then((v) => v !== false, () => false);
};

const toBase64 = (bytes) => {
  const enc = typeof btoa === 'function' ? btoa : null;
  if (!enc) return null;
  let bin = '';
  for (let i = 0; i < bytes.length; i += B64_CHUNK) {
    const end = Math.min(i + B64_CHUNK, bytes.length);
    let chunk = '';
    for (let j = i; j < end; j++) chunk += String.fromCharCode(bytes[j] & 255);
    bin += chunk;
  }
  try { return enc(bin); } catch (_) { return null; }
};

const fromBase64 = (str) => {
  if (!isStr(str)) return null;
  const dec = typeof atob === 'function' ? atob : null;
  if (!dec) return null;
  let bin;
  try { bin = dec(str); } catch (_) { return null; }
  if (!bin.length) return null;
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 255;
  return out;
};

const asBytes = (bytes) => {
  if (bytes instanceof Uint8Array) return bytes;
  if (typeof ArrayBuffer !== 'undefined') {
    if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
    if (ArrayBuffer.isView(bytes)) return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  if (Array.isArray(bytes)) return Uint8Array.from(bytes, (v) => (isNum(v) ? v & 255 : 0));
  return null;
};

const readBestMap = () => readKey(BEST_KEY).then((raw) => {
  const map = Object.create(null);
  if (!isObj(raw)) return map;
  for (let i = 0; i < COURSE_IDS.length; i++) {
    const id = COURSE_IDS[i];
    const v = raw[id];
    if (isNum(v) && v > 0) map[id] = v;
    else if (isObj(v) && isNum(v.timeMs) && v.timeMs > 0) map[id] = v.timeMs;
  }
  return map;
});

export function getBest(id) {
  if (!knownId(id)) return Promise.resolve(null);
  return readBestMap().then((map) => {
    const timeMs = map[id];
    if (!isNum(timeMs) || timeMs <= 0) return null;
    return softLoad(id).then((def) => ({ timeMs: timeMs, medal: def ? medalFor(def, timeMs) : null }));
  }).catch(() => null);
}

export function saveBest(id, timeMs) {
  const blank = { improved: false, medal: null };
  if (!knownId(id) || !isNum(timeMs) || timeMs <= 0) return Promise.resolve(blank);
  const value = Math.round(timeMs);
  return softLoad(id).then((def) => {
    const medal = def ? medalFor(def, value) : null;
    if (!adapter()) return { improved: false, medal: medal };
    return readBestMap().then((map) => {
      const prev = map[id];
      if (isNum(prev) && prev <= value) return { improved: false, medal: medal };
      const next = {};
      for (let i = 0; i < COURSE_IDS.length; i++) {
        const k = COURSE_IDS[i];
        if (isNum(map[k]) && map[k] > 0) next[k] = map[k];
      }
      next[id] = value;
      return writeKey(BEST_KEY, next).then((ok) => ({ improved: !!ok, medal: medal }));
    });
  }).catch(() => blank);
}

export function getGhostBytes(id) {
  if (!knownId(id)) return Promise.resolve(null);
  return readKey(GHOST_PREFIX + id).then((raw) => fromBase64(raw)).catch(() => null);
}

export function saveGhostBytes(id, bytes) {
  if (!knownId(id)) return Promise.resolve(false);
  const view = asBytes(bytes);
  if (!view || !view.length || view.length > MAX_GHOST_BYTES) return Promise.resolve(false);
  const b64 = toBase64(view);
  if (!b64) return Promise.resolve(false);
  return writeKey(GHOST_PREFIX + id, b64).catch(() => false);
}
