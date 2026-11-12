import { signBody, verifyBody, sigFingerprint, validSpub } from '/assets/js/comms/sign.js';

export const MAX_DEVICES = 32;
const MAX_REMOVED = 256;
const INVITE_MS = 15 * 60 * 1000;
export const MAX_JUMP = 64;
const JOIN_KEEP_MS = 7 * 24 * 3600 * 1000;
const MAX_JOINS = 16;

const b64uEnc = (bytes) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const samePub = (a, b) => validSpub(a) && validSpub(b) && a.x === b.x && a.y === b.y;
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

const clean = (e) => ({
  sigFp: String(e.sigFp),
  spub: { x: e.spub.x, y: e.spub.y },
  dh: { x: e.dh.x, y: e.dh.y },
  name: String(e.name || '').slice(0, 40),
  kind: String(e.kind || '').slice(0, 16),
  added: Number(e.added) || 0
});

const okEntry = (e) => isObj(e) && typeof e.sigFp === 'string' && validSpub(e.spub) && validSpub(e.dh);

const order = (devices) => devices.slice().sort((a, b) => (a.added - b.added) || (a.sigFp < b.sigFp ? -1 : a.sigFp > b.sigFp ? 1 : 0));

export const signList = (me, ver, devices, removed) => {
  const body = { v: 1, kind: 'mentria-devices', ver, ts: Date.now(), devices: order(devices), removed: Array.from(new Set(removed)).slice(-MAX_REMOVED), by: me.sign.sigFp };
  return signBody(me.sign.signKey, me.sign.spub, 'devices', 'v' + ver, body);
};

export const trustedFps = (list) => {
  if (!isObj(list) || !Array.isArray(list.devices)) return [];
  const removed = new Set(Array.isArray(list.removed) ? list.removed : []);
  return list.devices.map((d) => d && d.sigFp).filter((fp) => typeof fp === 'string' && !removed.has(fp));
};

const assertTrusted = (list, me) => { if (!trustedFps(list).includes(me.sign.sigFp)) throw new Error('not-trusted'); };

export const makeGenesis = async (me, entry) => {
  if (!okEntry(entry) || entry.sigFp !== me.sign.sigFp) throw new Error('bad-entry');
  return signList(me, 1, [clean(entry)], []);
};

export const withDevice = async (list, me, entry) => {
  assertTrusted(list, me);
  if (!okEntry(entry)) throw new Error('bad-entry');
  if ((list.removed || []).includes(entry.sigFp)) throw new Error('removed');
  if (list.devices.some((d) => d.sigFp === entry.sigFp)) return list;
  if (list.devices.length >= MAX_DEVICES) throw new Error('too-many');
  return signList(me, list.ver + 1, list.devices.concat([clean(entry)]), list.removed || []);
};

export const withoutDevice = async (list, me, sigFp) => {
  assertTrusted(list, me);
  if (sigFp === me.sign.sigFp) throw new Error('self');
  return signList(me, list.ver + 1, list.devices.filter((d) => d.sigFp !== sigFp), (list.removed || []).concat([sigFp]));
};

export const verifyList = async (list) => {
  try {
    if (!isObj(list) || list.v !== 1 || list.kind !== 'mentria-devices' || !Number.isInteger(list.ver) || list.ver < 1) return false;
    if (!Array.isArray(list.devices) || !list.devices.length || list.devices.length > MAX_DEVICES) return false;
    if (!Array.isArray(list.removed) || list.removed.length > MAX_REMOVED || typeof list.by !== 'string') return false;
    const seen = new Set();
    for (const d of list.devices) {
      if (!okEntry(d) || seen.has(d.sigFp) || list.removed.includes(d.sigFp)) return false;
      if (await sigFingerprint(d.spub) !== d.sigFp) return false;
      seen.add(d.sigFp);
    }
    const signer = list.devices.find((d) => d.sigFp === list.by);
    if (!signer) return false;
    const v = await verifyBody(list, 'devices', 'v' + list.ver);
    return !!v.ok && v.sigFp === list.by && samePub(v.spub, signer.spub);
  } catch (_) { return false; }
};

const signed = (x) => isObj(x) && Number.isInteger(x.ver) && Array.isArray(x.devices) && !x.needsSign && isObj(x.sg) && typeof x.sg.s === 'string';

export const mergeDeviceRecords = (a, b) => {
  if (!signed(a)) return signed(b) ? b : (a || b || null);
  if (!signed(b)) return a;
  if (a.ver !== b.ver) return a.ver > b.ver ? a : b;
  return a.sg.s <= b.sg.s ? a : b;
};

export const makeInvite = async (me, { ttlMs = INVITE_MS } = {}) => {
  const nonce = b64uEnc(crypto.getRandomValues(new Uint8Array(16)));
  return signBody(me.sign.signKey, me.sign.spub, 'devinvite', nonce, { v: 1, nonce, exp: Date.now() + ttlMs, by: me.sign.sigFp });
};

export const mergeInvites = (a, b) => {
  const ok = (x) => isObj(x) && typeof x.nonce === 'string' && Number.isFinite(x.exp);
  if (!ok(a)) return ok(b) ? b : null;
  if (!ok(b)) return a;
  return b.exp > a.exp ? b : a;
};

export const makeJoin = async (entry, nonce, me) => {
  if (!okEntry(entry) || entry.sigFp !== me.sign.sigFp) throw new Error('bad-entry');
  return signBody(me.sign.signKey, me.sign.spub, 'devjoin', entry.sigFp, { v: 1, entry: clean(entry), nonce: String(nonce || ''), ts: Date.now() });
};

export const mergeJoins = (a, b, now = Date.now()) => {
  const out = {};
  for (const m of [a, b]) {
    if (!isObj(m)) continue;
    for (const [fp, j] of Object.entries(m)) {
      if (!isObj(j) || !isObj(j.entry) || j.entry.sigFp !== fp || !Number.isFinite(j.ts) || now - j.ts > JOIN_KEEP_MS) continue;
      if (!out[fp] || j.ts > out[fp].ts) out[fp] = j;
    }
  }
  const keys = Object.keys(out).sort((x, y) => out[y].ts - out[x].ts).slice(0, MAX_JOINS);
  return Object.fromEntries(keys.map((k) => [k, out[k]]));
};

const inviteOk = async (list, invite, nonce) => {
  if (!isObj(invite) || !nonce || invite.nonce !== nonce || !(invite.exp > Date.now()) || invite.exp - Date.now() > INVITE_MS + 5000) return false;
  if (!trustedFps(list).includes(invite.by)) return false;
  const signer = list.devices.find((d) => d.sigFp === invite.by);
  const v = await verifyBody(invite, 'devinvite', invite.nonce);
  return !!v.ok && v.sigFp === invite.by && !!signer && samePub(v.spub, signer.spub);
};

export const handleJoin = async (list, join, invite, me) => {
  try {
    if (!isObj(join) || !okEntry(join.entry)) return {};
    const entry = join.entry;
    const v = await verifyBody(join, 'devjoin', entry.sigFp);
    if (!v.ok || !samePub(v.spub, entry.spub) || v.sigFp !== entry.sigFp) return {};
    if ((list.removed || []).includes(entry.sigFp) || list.devices.some((d) => d.sigFp === entry.sigFp)) return {};
    if (await inviteOk(list, invite, join.nonce)) return { list: await withDevice(list, me, entry), consumed: true };
    return { ask: clean(entry) };
  } catch (_) { return {}; }
};

const keepsRemovals = (current, candidate) => {
  const was = new Set(current.removed || []);
  for (const fp of was) if (!(candidate.removed || []).includes(fp)) return false;
  return !candidate.devices.some((d) => was.has(d.sigFp));
};

export const acceptList = async (current, candidate) => {
  if (!isObj(current) || !(await verifyList(candidate))) return false;
  if (candidate.ver <= current.ver || candidate.ver > current.ver + MAX_JUMP) return false;
  if (!trustedFps(current).includes(candidate.by)) return false;
  return keepsRemovals(current, candidate);
};

export const foldLists = async (current, other, me) => {
  if (!isObj(current) || !trustedFps(current).includes(me.sign.sigFp)) return null;
  if (!(await verifyList(other)) || !trustedFps(current).includes(other.by)) return null;
  if (other.ver > current.ver + MAX_JUMP) return null;
  const removed = new Set([].concat(current.removed || [], other.removed || []));
  if (removed.has(me.sign.sigFp)) return null;
  const byFp = new Map();
  for (const d of [].concat(current.devices, other.devices)) if (!removed.has(d.sigFp) && !byFp.has(d.sigFp)) byFp.set(d.sigFp, clean(d));
  const list = await signList(me, Math.max(current.ver, other.ver) + 1, Array.from(byFp.values()), Array.from(removed));
  return { list, removed: current.devices.filter((d) => removed.has(d.sigFp)).map(clean) };
};

export const canAdopt = async (current, candidate, myFp) => {
  if (!isObj(current) || current.devices.length !== 1 || current.devices[0].sigFp !== myFp || (current.removed || []).length) return null;
  if (!(await verifyList(candidate)) || candidate.by === myFp || !trustedFps(candidate).includes(myFp)) return null;
  return clean(candidate.devices.find((d) => d.sigFp === candidate.by));
};
