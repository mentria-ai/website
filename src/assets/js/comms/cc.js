import { WORDS } from '/assets/js/comms/cc-words.js';
import { seal, open } from '/assets/js/comms/bridge.js';
import { signBody, verifyBody, validSpub } from '/assets/js/comms/sign.js';
import { b64urlEncode, b64urlDecode } from '/assets/js/comms/wire.js';

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

export const sasCode = async (S, cpub, dpub) => {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode('mentria-cc-sas-v1|' + b64urlEncode(S) + '|' + cpub.x + '|' + cpub.y + '|' + dpub.x + '|' + dpub.y)));
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
    const win = (Number(r.kver) || 0) > (Number(had.kver) || 0) ? r : had;
    by.set(r.cid, removed && !win.removed ? Object.assign({}, win, { removed: true }) : win);
  }
  return { v: 1, list: Array.from(by.values()).sort((x, y) => (Number(x.added) || 0) - (Number(y.added) || 0) || (x.cid < y.cid ? -1 : 1)) };
};

export const getComputers = () => {
  try { const v = window.MentriaStore.get('comms', 'computers'); return isObj(v) && Array.isArray(v.list) ? v : { v: 1, list: [] }; } catch (_) { return { v: 1, list: [] }; }
};

export const saveComputer = (record) => window.MentriaStore.set('comms', 'computers', mergeComputerRecords(getComputers(), { v: 1, list: [record] }));

export const acceptPairing = ({ S, me, entry, list, ring = '', transport, now = () => Date.now(), save = saveComputer }) => {
  const on = { offer: new Set(), ready: new Set(), denied: new Set(), conflict: new Set() };
  const fire = (k, x) => { for (const fn of on[k]) { try { fn(x); } catch (_) {} } };
  const offers = new Map();
  let state = 'waiting';
  let chosen = null;
  let off = null;
  let chain = Promise.resolve();
  const keysP = pairKeys(S);
  const handle = async (content) => {
    const { key } = await keysP;
    const m = await open(key, content);
    if (!isObj(m) || m.v !== 1 || typeof m.cid !== 'string') return;
    if (m.t === 'cc-offer') {
      if (!validSpub(m.spub) || !validSpub(m.dh) || !Number.isFinite(m.exp) || m.exp <= now() || m.exp - now() > LINK_MS + 60000) return;
      if (offers.has(m.cid) || state === 'conflict') return;
      offers.set(m.cid, m);
      if (offers.size > 1) {
        if (state === 'waiting' || state === 'approved') { state = 'conflict'; fire('conflict', {}); }
        return;
      }
      if (state === 'waiting') fire('offer', { cid: m.cid, name: String(m.name || '').slice(0, 40), code: await sasCode(S, m.spub, me.sign.spub), exp: m.exp });
      return;
    }
    if (!chosen || m.cid !== chosen.cid || state !== 'approved') return;
    if (m.t === 'cc-ready') {
      const v = await verifyBody(m, 'cc-pair:' + m.cid, 'ready');
      if (!v.ok || !samePub(v.spub, chosen.spub) || !Number.isInteger(m.kver) || !isObj(m.wrapped)) return;
      const record = { cid: m.cid, name: String(chosen.name || '').slice(0, 40), spub: { x: chosen.spub.x, y: chosen.spub.y }, dh: { x: chosen.dh.x, y: chosen.dh.y }, kver: m.kver, wrapped: m.wrapped, added: now(), removed: false };
      if (!(await unwrapChannelKey(record, me))) return;
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
