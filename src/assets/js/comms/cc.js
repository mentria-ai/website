import { WORDS } from '/assets/js/comms/cc-words.js';
import { seal, open } from '/assets/js/comms/bridge.js';
import { signBody, verifyBody, validSpub } from '/assets/js/comms/sign.js';
import { b64urlEncode, b64urlDecode } from '/assets/js/comms/wire.js';
import { trustedFps } from '/assets/js/comms/devices.js';

export const CC_LINK = /^#cc1\.([A-Za-z0-9_-]{43})$/;
const SALT = 'mentria-cc-v1';
const LINK_MS = 600000;
const te = new TextEncoder();

const hkdfBits = async (ikm, info) => {
  const base = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: te.encode(SALT), info: te.encode(info) }, base, 256));
};
const aesKey = (raw, usages = ['encrypt', 'decrypt']) => crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, usages);
const samePub = (a, b) => validSpub(a) && validSpub(b) && a.x === b.x && a.y === b.y;
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

export const parseCcLink = (hash) => {
  const m = CC_LINK.exec(String(hash || ''));
  if (!m) return null;
  try { const S = b64urlDecode(m[1]); return S.length === 32 ? S : null; } catch (_) { return null; }
};

export const pairKeys = async (S) => {
  const mac = await crypto.subtle.importKey('raw', await hkdfBits(S, 'pair-topic'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return { key: await aesKey(await hkdfBits(S, 'pair-key')), topic: b64urlEncode(new Uint8Array(await crypto.subtle.sign('HMAC', mac, te.encode('mentria-cc-pair-topic-v1')))) };
};

export const commitOf = async (nonceB64u) => b64urlEncode(new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode('mentria-cc-commit-v1|' + nonceB64u))));

export const sasCode = async (S, cpub, dpub, nonce) => {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode('mentria-cc-sas-v1|' + b64urlEncode(S) + '|' + cpub.x + '|' + cpub.y + '|' + dpub.x + '|' + dpub.y + '|' + b64urlEncode(nonce))));
  return WORDS[h[0]] + '-' + String(h[1] % 100).padStart(2, '0') + '-' + WORDS[h[2]];
};

export const unwrapChannelKey = async (record, me) => {
  try {
    const w = record && record.wrapped && record.wrapped[me.sign.sigFp];
    if (!w || typeof w.iv !== 'string' || typeof w.ct !== 'string' || !validSpub(record.dh)) return null;
    const theirs = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: record.dh.x, y: record.dh.y }, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: theirs }, me.dh.privateKey, 256));
    const key = await aesKey(await hkdfBits(bits, 'wrap|' + record.cid + '|' + me.sign.sigFp), ['decrypt']);
    const K = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64urlDecode(w.iv) }, key, b64urlDecode(w.ct)));
    return K.length === 32 ? K : null;
  } catch (_) { return null; }
};

const okRecord = (r) => isObj(r) && typeof r.cid === 'string' && r.cid.length > 0;

const sgKey = (x) => (isObj(x) && isObj(x.sg) ? String(x.sg.s) : '');
const unionBy = (xs, cap) => { const out = new Map(); for (const x of xs) if (sgKey(x) && !out.has(sgKey(x))) out.set(sgKey(x), x); return Array.from(out.values()).slice(-cap); };

export const mergeComputerRecords = (a, b) => {
  const la = isObj(a) && Array.isArray(a.list) ? a.list : null;
  const lb = isObj(b) && Array.isArray(b.list) ? b.list : null;
  if (!la) return lb ? b : (a || b || null);
  if (!lb) return a;
  const by = new Map();
  for (const r of la.concat(lb)) {
    if (!okRecord(r)) continue;
    const had = by.get(r.cid);
    if (!had) { by.set(r.cid, r); continue; }
    const removed = !!(had.removed || r.removed);
    const same = samePub(had.spub, r.spub) && samePub(had.dh, r.dh);
    const out = Object.assign({}, had, { removed });
    if (same) {
      const kr = Number(r.kver) || 0, kh = Number(had.kver) || 0;
      if (kr > kh) Object.assign(out, { kver: r.kver, wrapped: r.wrapped });
      else if (kr === kh && isObj(r.wrapped) && isObj(had.wrapped)) out.wrapped = Object.assign({}, r.wrapped, had.wrapped);
      out.approvals = unionBy([].concat(had.approvals || [], r.approvals || []), 16);
      out.proofs = unionBy([].concat(had.proofs || [], r.proofs || []).sort((x, y) => (Number(x.kver) || 0) - (Number(y.kver) || 0)), 8);
    }
    by.set(r.cid, out);
  }
  return { v: 1, list: Array.from(by.values()).sort((x, y) => (Number(x.added) || 0) - (Number(y.added) || 0) || (x.cid < y.cid ? -1 : 1)) };
};

export const approveComputer = (rec, me) => signBody(me.sign.signKey, me.sign.spub, 'cc-computer', rec.cid, { t: 'cc-computer', cid: rec.cid, spub: { x: rec.spub.x, y: rec.spub.y }, dh: { x: rec.dh.x, y: rec.dh.y } });

const proofSigned = async (rec, p) => {
  if (!isObj(p) || !isObj(p.sg)) return false;
  const v = p.t === 'cc-ready' ? await verifyBody(p, 'cc-pair:' + rec.cid, 'ready') : (p.t === 'cc-rekey' || p.t === 'cc-keys') && typeof p.cmid === 'string' ? await verifyBody(p, 'cc:' + rec.cid, p.cmid) : { ok: false };
  return !!v.ok && samePub(v.spub, rec.spub);
};

export const verifyComputer = async (rec, trust, myFp) => {
  if (!okRecord(rec) || rec.removed || !validSpub(rec.spub) || !validSpub(rec.dh)) return false;
  const fps = trustedFps(trust);
  let approved = false;
  for (const a of rec.approvals || []) {
    if (!isObj(a) || a.cid !== rec.cid || !samePub(a.spub, rec.spub) || !samePub(a.dh, rec.dh)) continue;
    const v = await verifyBody(a, 'cc-computer', rec.cid);
    if (v.ok && fps.includes(v.sigFp)) { approved = true; break; }
  }
  if (!approved) return false;
  const mine = isObj(rec.wrapped) ? rec.wrapped[myFp] : null;
  if (!isObj(mine)) return false;
  for (const p of rec.proofs || []) {
    if (!isObj(p) || p.kver !== rec.kver || !isObj(p.wrapped) || !isObj(p.wrapped[myFp])) continue;
    if (p.wrapped[myFp].iv !== mine.iv || p.wrapped[myFp].ct !== mine.ct) continue;
    if (await proofSigned(rec, p)) return true;
  }
  return false;
};

export const getComputers = () => {
  try { const v = window.MentriaStore.get('comms', 'computers'); return isObj(v) && Array.isArray(v.list) ? v : { v: 1, list: [] }; } catch (_) { return { v: 1, list: [] }; }
};

export const saveComputer = (record) => window.MentriaStore.set('comms', 'computers', mergeComputerRecords(getComputers(), { v: 1, list: [record] }));

export const acceptPairing = ({ S, me, entry, list, ring = '', transport, now = () => Date.now(), save = saveComputer }) => {
  const on = { offer: new Set(), code: new Set(), ready: new Set(), denied: new Set(), conflict: new Set() };
  const fire = (k, x) => { for (const fn of on[k]) { try { fn(x); } catch (_) {} } };
  const offers = new Map();
  let state = 'waiting';
  let chosen = null;
  let code = null;
  let off = null;
  let chain = Promise.resolve();
  const keysP = pairKeys(S);
  const handle = async (content) => {
    const { key } = await keysP;
    const m = await open(key, content);
    if (!isObj(m) || m.v !== 1 || typeof m.cid !== 'string') return;
    if (m.t === 'cc-offer') {
      if (!validSpub(m.spub) || !validSpub(m.dh) || !Number.isFinite(m.exp) || m.exp <= now() || m.exp - now() > LINK_MS + 60000 || typeof m.commit !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(m.commit)) return;
      if (offers.has(m.cid) || state === 'conflict') return;
      offers.set(m.cid, m);
      if (offers.size > 1) {
        if (state === 'waiting' || state === 'approved') { state = 'conflict'; fire('conflict', {}); }
        return;
      }
      if (state === 'waiting') fire('offer', { cid: m.cid, name: String(m.name || '').slice(0, 40), exp: m.exp });
      return;
    }
    if (!chosen || m.cid !== chosen.cid || state !== 'approved') return;
    if (m.t === 'cc-reveal') {
      if (code || typeof m.nonce !== 'string' || (await commitOf(m.nonce)) !== chosen.commit) return;
      let nonce;
      try { nonce = b64urlDecode(m.nonce); } catch (_) { return; }
      code = await sasCode(S, chosen.spub, me.sign.spub, nonce);
      fire('code', { code });
      return;
    }
    if (m.t === 'cc-ready') {
      if (!code) return;
      const v = await verifyBody(m, 'cc-pair:' + m.cid, 'ready');
      if (!v.ok || !samePub(v.spub, chosen.spub) || !Number.isInteger(m.kver) || !isObj(m.wrapped)) return;
      const record = { cid: m.cid, name: String(chosen.name || '').slice(0, 40), spub: { x: chosen.spub.x, y: chosen.spub.y }, dh: { x: chosen.dh.x, y: chosen.dh.y }, kver: m.kver, wrapped: m.wrapped, added: now(), removed: false, proofs: [m] };
      if (!(await unwrapChannelKey(record, me))) return;
      record.approvals = [await approveComputer(record, me)];
      state = 'ready';
      if (off) off();
      save(record);
      fire('ready', record);
    } else if (m.t === 'cc-denied') {
      const v = await verifyBody(m, 'cc-pair:' + m.cid, 'denied');
      if (!v.ok || !samePub(v.spub, chosen.spub)) return;
      state = 'denied';
      if (off) off();
      fire('denied', {});
    }
  };
  keysP.then(({ topic }) => {
    if (state === 'cancelled') return;
    off = transport.subscribe(topic, (content) => { chain = chain.then(() => handle(content)).catch(() => {}); });
  });
  return {
    onOffer: (fn) => { on.offer.add(fn); },
    onCode: (fn) => { on.code.add(fn); },
    onReady: (fn) => { on.ready.add(fn); },
    onDenied: (fn) => { on.denied.add(fn); },
    onConflict: (fn) => { on.conflict.add(fn); },
    state: () => state,
    approve: async () => {
      if (state !== 'waiting' || offers.size !== 1) throw new Error(state === 'waiting' ? 'no-offer' : state);
      chosen = offers.values().next().value;
      if (chosen.exp <= now()) throw new Error('expired');
      state = 'approved';
      const { key, topic } = await keysP;
      const body = { t: 'cc-accept', v: 1, cid: chosen.cid, device: entry, list, ring: String(ring || '') };
      await transport.publish(topic, await seal(key, await signBody(me.sign.signKey, me.sign.spub, 'cc-pair:' + chosen.cid, 'accept', body)));
    },
    cancel: () => { state = 'cancelled'; if (off) off(); }
  };
};

export const liveComputers = () => getComputers().list.filter((r) => !r.removed);

export const markRemoved = (cid) => {
  const cur = getComputers();
  const rec = cur.list.find((r) => r.cid === cid);
  if (!rec) return false;
  return window.MentriaStore.set('comms', 'computers', mergeComputerRecords(cur, { v: 1, list: [Object.assign({}, rec, { removed: true })] }));
};

export const disconnectComputer = async ({ cid, client, me }) => {
  const cmid = 'r:' + b64urlEncode(crypto.getRandomValues(new Uint8Array(9)));
  if (client) {
    try { await client.post(await signBody(me.sign.signKey, me.sign.spub, 'cc:' + cid, cmid, { t: 'cc-revoke', cid, cmid })); } catch (_) {}
  }
  markRemoved(cid);
};

const ROUTED = ['watch', 'list', 'open', 'get', 'say', 'answer', 'verdict'];

export const createMultiClient = () => {
  const clients = new Map();
  const subs = new Set();
  const ownerOf = (sid) => { for (const c of clients.values()) if (c.sessions().some((s) => s.sid === sid)) return c; return null; };
  const remove = (cid) => {
    for (const s of subs) { const off = s.offs.get(cid); if (off) off(); s.offs.delete(cid); }
    clients.delete(cid);
  };
  const api = {
    add: (cid, client) => { remove(cid); clients.set(cid, client); for (const s of subs) s.offs.set(cid, client.on(s.t, s.fn)); },
    remove,
    has: (cid) => clients.has(cid),
    cids: () => Array.from(clients.keys()),
    client: (cid) => clients.get(cid) || null,
    ownerCid: (sid) => { for (const [cid, c] of clients) if (c.sessions().some((s) => s.sid === sid)) return cid; return null; },
    on: (t, fn) => {
      const s = { t, fn, offs: new Map() };
      subs.add(s);
      for (const [cid, c] of clients) s.offs.set(cid, c.on(t, fn));
      return () => { for (const off of s.offs.values()) off(); subs.delete(s); };
    },
    hello: async (sid) => {
      if (sid) { const c = ownerOf(sid); if (c) return c.hello(sid); }
      await Promise.all(Array.from(clients.values()).map((c) => (sid ? c.hello(sid) : c.hello())));
    },
    reset: (sid, sub) => { const c = ownerOf(sid); if (c) c.reset(sid, sub); },
    channel: (sid) => { const c = ownerOf(sid); return !!c && c.channel(sid); },
    sessions: () => Array.from(clients.entries()).flatMap(([cid, c]) => c.sessions().map((s) => Object.assign({}, s, { cid }))),
    turn: (sid, n, sub) => { const c = ownerOf(sid); return c ? c.turn(sid, n, sub) : null; },
    turns: (sid, sub) => { const c = ownerOf(sid); return c ? c.turns(sid, sub) : []; }
  };
  const SHARED = new Set(['watch', 'list', 'open', 'get']);
  for (const name of ROUTED) {
    api[name] = async (sid, ...rest) => {
      const c = ownerOf(sid);
      if (c) return c[name](sid, ...rest);
      if (!SHARED.has(name) || !clients.size) throw new Error('no-session');
      await Promise.all(Array.from(clients.values()).map((x) => x[name](sid, ...rest)));
    };
  }
  return api;
};

export const helloFields = ({ ring, list }) => Object.assign({}, ring ? { ring } : {}, list && !list.needsSign ? { list } : {});

export const applyHostKeys = async (cid, msg) => {
  if (!isObj(msg) || !Number.isInteger(msg.kver) || !isObj(msg.wrapped)) return false;
  const cur = getComputers();
  const rec = cur.list.find((r) => r.cid === cid);
  if (!rec || rec.removed || !(await proofSigned(rec, msg))) return false;
  const kver = Number(rec.kver) || 0;
  let next = null;
  if (msg.t === 'cc-rekey' && msg.kver > kver) next = Object.assign({}, rec, { kver: msg.kver, wrapped: msg.wrapped });
  else if (msg.t === 'cc-keys' && msg.kver === kver) next = Object.assign({}, rec, { wrapped: Object.assign({}, rec.wrapped || {}, msg.wrapped) });
  if (!next) return false;
  next.proofs = unionBy([].concat(rec.proofs || [], [msg]), 8);
  return window.MentriaStore.set('comms', 'computers', { v: 1, list: cur.list.map((r) => (r.cid === cid ? next : r)) });
};
