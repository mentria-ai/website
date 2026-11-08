import { b64urlEncode, b64urlDecode } from '/assets/js/comms/wire.js';

export const BRIDGE_KIND = 23838;
export const FRAME_MAX = 36000;
export const HERE_TTL_MS = 75000;
const SALT = 'mentria-bridge-v1';
const te = new TextEncoder();
const td = new TextDecoder();

const hkdf = async (ikm, info, bits = 256) => {
  const base = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: te.encode(SALT), info: te.encode(info) }, base, bits));
};

export const bridgeKeyFromSecret = (secret) => hkdf(secret, 'bridge-key|v1');

export const keysFromBridgeKey = async (k) => {
  const aes = await crypto.subtle.importKey('raw', await hkdf(k, 'aes'), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  const mac = await crypto.subtle.importKey('raw', await hkdf(k, 'topic'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const topic = b64urlEncode(new Uint8Array(await crypto.subtle.sign('HMAC', mac, te.encode('mentria-bridge-topic-v1'))));
  return { aes, topic };
};

export const bridgeCode = ({ k, spub, sigFp }) => 'MB1.' + b64urlEncode(te.encode(JSON.stringify({ v: 1, k: b64urlEncode(k), spub: { x: spub.x, y: spub.y }, sigFp })));

export const seal = async (aes, obj) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, te.encode(JSON.stringify(obj))));
  return JSON.stringify({ v: 1, iv: b64urlEncode(iv), ct: b64urlEncode(ct) });
};

export const open = async (aes, content) => {
  try {
    const env = typeof content === 'string' ? JSON.parse(content) : content;
    if (!env || env.v !== 1 || typeof env.iv !== 'string' || typeof env.ct !== 'string') return null;
    return JSON.parse(td.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64urlDecode(env.iv) }, aes, b64urlDecode(env.ct))));
  } catch (_) { return null; }
};

export const splitFrames = (msg, max = FRAME_MAX) => {
  const buf = te.encode(JSON.stringify(msg));
  const id = b64urlEncode(crypto.getRandomValues(new Uint8Array(9)));
  const chunks = [];
  let at = 0;
  while (at < buf.length) {
    let end = Math.min(buf.length, at + max);
    while (end < buf.length && end > at && (buf[end] & 0xc0) === 0x80) end--;
    chunks.push(td.decode(buf.subarray(at, end)));
    at = end;
  }
  if (!chunks.length) chunks.push('');
  return chunks.map((d, i) => ({ id, i, n: chunks.length, d }));
};

export class Reassembler {
  constructor({ ttlMs = 60000, maxSets = 64 } = {}) { this.ttl = ttlMs; this.max = maxSets; this.sets = new Map(); this.done = new Set(); }
  push(f) {
    if (!f || typeof f.id !== 'string' || !Number.isInteger(f.i) || !Number.isInteger(f.n) || f.n < 1 || f.n > 512 || f.i < 0 || f.i >= f.n || typeof f.d !== 'string') return null;
    const now = Date.now();
    for (const [id, s] of this.sets) if (now - s.at > this.ttl) { this.sets.delete(id); this.done.add(id); }
    if (this.done.has(f.id)) return null;
    let s = this.sets.get(f.id);
    if (!s) {
      while (this.sets.size >= this.max) this.sets.delete(this.sets.keys().next().value);
      s = { at: now, n: f.n, parts: new Map() };
      this.sets.set(f.id, s);
    }
    if (s.n !== f.n) return null;
    s.parts.set(f.i, f.d);
    if (s.parts.size < s.n) return null;
    this.sets.delete(f.id);
    this.done.add(f.id);
    if (this.done.size > 512) this.done.delete(this.done.values().next().value);
    let json = '';
    for (let i = 0; i < s.n; i++) json += s.parts.get(i);
    try { return JSON.parse(json); } catch (_) { return null; }
  }
}

export const createBridgeClient = ({ transport, keys, sign, device = 'phone', now = () => Date.now() }) => {
  const reasm = new Reassembler();
  const handlers = new Map();
  const sessions = new Map();
  const turns = new Map();
  let chain = Promise.resolve();
  const emit = (t, m) => { for (const fn of handlers.get(t) || []) { try { fn(m); } catch (_) {} } };
  const keyOf = (sid, sub) => sid + '|' + (sub || '');
  const turnOf = (sid, n, make, sub) => {
    let bySid = turns.get(keyOf(sid, sub));
    if (!bySid) { if (!make) return null; bySid = new Map(); turns.set(keyOf(sid, sub), bySid); }
    let t = bySid.get(n);
    if (!t && make) { t = { n, slots: [], earlier: false, done: false, ts: 0 }; bySid.set(n, t); }
    return t;
  };
  const apply = (m) => {
    if (m.t === 'here' && Array.isArray(m.sessions)) {
      for (const s of m.sessions) if (s && typeof s.sid === 'string') sessions.set(s.sid, { sid: s.sid, name: String(s.name || ''), busy: !!s.busy, lastTs: Number(s.lastTs) || 0, hereAt: now(), host: String(m.host || '') });
    } else if (m.t === 'turn' && typeof m.sid === 'string' && Number.isInteger(m.n) && Number.isInteger(m.from) && Array.isArray(m.msgs)) {
      const t = turnOf(m.sid, m.n, true, m.sub);
      const tail = m.from + m.msgs.length >= t.slots.length;
      if (tail) t.slots.length = m.from;
      m.msgs.forEach((x, i) => { t.slots[m.from + i] = x; });
      if (m.from === 0 || !t.slots.slice(0, m.from).some(Boolean)) t.earlier = !!m.earlier;
      t.done = !!m.done;
      t.ts = Number(m.ts) || t.ts;
      t.first = t.slots.findIndex(Boolean);
    }
    emit(m.t, m);
  };
  transport.onEvent((content) => {
    chain = chain.then(async () => {
      const f = await open(keys.aes, content);
      const m = f && reasm.push(f);
      if (m && typeof m.t === 'string') apply(m);
    }).catch(() => {});
  });
  const send = async (msg) => { for (const f of splitFrames(msg)) await transport.publish(await seal(keys.aes, f)); };
  const cmidNew = () => 'p:' + b64urlEncode(crypto.getRandomValues(new Uint8Array(9)));
  return {
    on: (t, fn) => { if (!handlers.has(t)) handlers.set(t, new Set()); handlers.get(t).add(fn); return () => handlers.get(t).delete(fn); },
    hello: (sid) => send(sid ? { t: 'hello', sid } : { t: 'hello' }),
    list: (sid, before, sub) => send(Object.assign({ t: 'list', sid }, Number.isInteger(before) ? { before } : {}, sub ? { sub } : {})),
    open: (sid, n, before, sub) => send(Object.assign({ t: 'open', sid, n }, Number.isInteger(before) ? { before } : {}, sub ? { sub } : {})),
    get: (sid, ref, sub) => send(Object.assign({ t: 'get', sid, ref }, sub ? { sub } : {})),
    say: async (sid, text) => { const cmid = cmidNew(); await send(await sign(sid, cmid, { t: 'say', sid, cmid, text, device })); return cmid; },
    verdict: async (sid, request_id, behavior) => { const cmid = cmidNew(); await send(await sign(sid, cmid, { t: 'verdict', sid, cmid, request_id, behavior })); return cmid; },
    sessions: () => Array.from(sessions.values()).map((s) => Object.assign({}, s, { online: now() - s.hereAt < HERE_TTL_MS })),
    turn: (sid, n, sub) => {
      const t = turnOf(sid, n, false, sub);
      if (!t) return null;
      return { n, msgs: t.slots.filter(Boolean), first: t.first, earlier: t.earlier || t.first > 0, done: t.done, ts: t.ts };
    },
    turns: (sid, sub) => Array.from((turns.get(keyOf(sid, sub)) || new Map()).keys()).sort((a, b) => a - b)
  };
};
