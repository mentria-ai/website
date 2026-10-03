export const MAX_DRIFT = 5 * 60 * 1000;
const CONFLICT_WINDOW = 24 * 60 * 60 * 1000;
const CONFLICT_CAP = 300;
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const SILENT_ENTITIES = new Set(['device']);

export class ClockDriftError extends Error {
  constructor(ms) { super('clock drift'); this.name = 'ClockDriftError'; this.drift = ms; }
}

export function hlcString(ms, counter, node) {
  return new Date(ms).toISOString() + '-' + counter.toString(16).padStart(4, '0') + '-' + node;
}

export function parseHlc(ts) {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)-([0-9a-f]{4})-([0-9a-f]{16})$/.exec(String(ts || ''));
  if (!m) return null;
  const ms = Date.parse(m[1]);
  if (!Number.isFinite(ms)) return null;
  return { ms, counter: parseInt(m[2], 16), node: m[3] };
}

export function createClock(node, now) {
  if (!/^[0-9a-f]{16}$/.test(node)) throw new Error('bad clock node');
  const phys = now || (() => Date.now());
  let lastMs = 0;
  let counter = 0;
  return {
    node,
    send() {
      const p = phys();
      if (lastMs - p > MAX_DRIFT) throw new ClockDriftError(lastMs - p);
      const ms = Math.max(lastMs, p);
      counter = ms === lastMs ? counter + 1 : 0;
      if (counter > 0xffff) throw new Error('clock counter overflow');
      lastMs = ms;
      return hlcString(ms, counter, node);
    },
    observe(ts) {
      const r = parseHlc(ts);
      if (!r) return;
      if (r.ms > lastMs || (r.ms === lastMs && r.counter > counter)) { lastMs = r.ms; counter = r.counter; }
    },
    drift() { return Math.max(0, lastMs - phys()); }
  };
}

export function createState() {
  return { ents: new Map(), conflicts: [], version: 0 };
}

function entityMap(state, e) {
  let m = state.ents.get(e);
  if (!m) { m = new Map(); state.ents.set(e, m); }
  return m;
}

function clone(v) {
  return v === undefined ? null : JSON.parse(JSON.stringify(v));
}

function sameValue(a, b) {
  return canonical(a) === canonical(b);
}

export function canonical(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
}

export function userConflicts(list) {
  return Array.isArray(list) ? list.filter((c) => c && !SILENT_ENTITIES.has(c.e)) : [];
}

function logConflict(state, e, id, f, win, lose) {
  if (SILENT_ENTITIES.has(e)) return;
  const wa = parseHlc(win.t);
  const la = parseHlc(lose.t);
  if (!wa || !la || wa.node === la.node) return;
  if (Math.abs(wa.ms - la.ms) > CONFLICT_WINDOW) return;
  if (sameValue(win.v, lose.v)) return;
  if (state.conflicts.some((c) => c.e === e && c.id === id && c.f === f && c.lose.t === lose.t)) return;
  state.conflicts.push({ e, id, f, win: { v: clone(win.v), t: win.t }, lose: { v: clone(lose.v), t: lose.t } });
  if (state.conflicts.length > CONFLICT_CAP) state.conflicts.splice(0, state.conflicts.length - CONFLICT_CAP);
}

function setField(state, e, r, k, v, t, quiet) {
  const cur = r.c[k];
  if (cur === t) return false;
  if (!cur || t > cur) {
    r.f[k] = clone(v);
    r.c[k] = t;
    return true;
  }
  if (!quiet) logConflict(state, e, r.id, k, { v: r.f[k], t: cur }, { v, t });
  return false;
}

function validRef(e, id) {
  return typeof e === 'string' && /^[a-z][a-z_]{0,31}$/.test(e) && typeof id === 'string' && !!id && id.length <= 200 && !BAD_KEYS.has(id);
}

export function validOp(op) {
  if (!op || typeof op !== 'object') return false;
  if (!parseHlc(op.t)) return false;
  if (!validRef(op.e, op.id)) return false;
  if (typeof op.f !== 'string' || !op.f || op.f.length > 64 || BAD_KEYS.has(op.f)) return false;
  if (op.f === '*') {
    if (!op.v || typeof op.v !== 'object' || Array.isArray(op.v)) return false;
    for (const k of Object.keys(op.v)) if (BAD_KEYS.has(k) || k === '*' || k === '~' || k === 'id') return false;
  } else if (op.f === 'id') return false;
  return true;
}

export function applyOp(state, op, quiet) {
  if (!validOp(op)) return false;
  const recs = entityMap(state, op.e);
  let r = recs.get(op.id);
  if (!r) { r = { id: op.id, f: Object.create(null), c: Object.create(null), del: null }; recs.set(op.id, r); }
  let changed = false;
  if (op.f === '~') {
    if (!r.del || op.t > r.del) { r.del = op.t; changed = true; }
  } else if (op.f === '*') {
    for (const k of Object.keys(op.v)) changed = setField(state, op.e, r, k, op.v[k], op.t, quiet) || changed;
  } else {
    changed = setField(state, op.e, r, op.f, op.v, op.t, quiet);
  }
  if (changed) state.version++;
  return changed;
}

export function applyOps(state, ops, quiet) {
  let n = 0;
  for (const op of ops) if (applyOp(state, op, quiet)) n++;
  return n;
}

export function view(r) {
  const out = { id: r.id };
  for (const k of Object.keys(r.f)) out[k] = r.f[k];
  return out;
}

export function get(state, e, id) {
  const m = state.ents.get(e);
  const r = m && m.get(id);
  return r && !r.del ? view(r) : null;
}

export function known(state, e, id) {
  const m = state.ents.get(e);
  return !!(m && m.has(id));
}

export function exists(state, e, id) {
  const m = state.ents.get(e);
  const r = m && m.get(id);
  return !!(r && !r.del);
}

export function list(state, e) {
  const m = state.ents.get(e);
  const out = [];
  if (!m) return out;
  for (const r of m.values()) if (!r.del) out.push(view(r));
  return out;
}

export function clockOf(state, e, id, f) {
  const m = state.ents.get(e);
  const r = m && m.get(id);
  return r ? r.c[f] || null : null;
}

export function snapshot(state) {
  const recs = [];
  for (const [e, m] of state.ents) {
    for (const r of m.values()) recs.push([e, r.id, Object.assign({}, r.f), Object.assign({}, r.c), r.del]);
  }
  return { v: 1, recs, conflicts: state.conflicts.slice() };
}

export function mergeSnapshot(state, snap) {
  if (!snap || !Array.isArray(snap.recs)) return 0;
  let n = 0;
  for (const row of snap.recs) {
    const [e, id, f, c, del] = row;
    if (!validRef(e, id)) continue;
    for (const k of Object.keys(c || {})) {
      if (BAD_KEYS.has(k)) continue;
      if (applyOp(state, { t: c[k], e, id, f: k, v: f[k] }, true)) n++;
    }
    if (del && applyOp(state, { t: del, e, id, f: '~', v: null }, true)) n++;
  }
  if (Array.isArray(snap.conflicts)) {
    for (const cf of userConflicts(snap.conflicts)) {
      if (!cf.win || !cf.lose) continue;
      if (state.conflicts.some((x) => x.e === cf.e && x.id === cf.id && x.f === cf.f && x.lose.t === cf.lose.t)) continue;
      state.conflicts.push(cf);
    }
    if (state.conflicts.length > CONFLICT_CAP) state.conflicts.splice(0, state.conflicts.length - CONFLICT_CAP);
  }
  return n;
}

export function snapshotOps(snap) {
  const ops = [];
  for (const [e, id, f, c, del] of snap.recs || []) {
    for (const k of Object.keys(c || {})) ops.push({ t: c[k], e, id, f: k, v: f[k] });
    if (del) ops.push({ t: del, e, id, f: '~', v: null });
  }
  return ops;
}

export function canonicalState(state) {
  const ents = Array.from(state.ents.keys()).sort();
  const parts = [];
  for (const e of ents) {
    const m = state.ents.get(e);
    const ids = Array.from(m.keys()).sort();
    for (const id of ids) {
      const r = m.get(id);
      if (r.del) { parts.push(e + '|' + id + '|~'); continue; }
      parts.push(e + '|' + id + '|' + canonical(Object.assign({}, r.f)));
    }
  }
  return parts.join('\n');
}

export async function stateHash(state) {
  const bytes = new TextEncoder().encode(canonicalState(state));
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function resolveConflict(state, idx) {
  state.conflicts.splice(idx, 1);
  state.version++;
}
