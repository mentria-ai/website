import { signBody, verifyBody, sigFingerprint, validSpub } from '/assets/js/comms/sign.js';

export const MAX_DEVICES = 32;
const MAX_REMOVED = 256;
const INVITE_MS = 24 * 3600 * 1000;
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

const signList = (me, ver, devices, removed) => {
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

export const resign = async (list, me) => {
  assertTrusted(list, me);
  return signList(me, list.ver + 1, list.devices, list.removed || []);
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

const bodyKey = (l) => JSON.stringify([order(l.devices || []).map((d) => d.sigFp), Array.from(new Set(l.removed || [])).sort()]);

export const mergeDeviceRecords = (a, b) => {
  const okA = isObj(a) && Number.isInteger(a.ver) && Array.isArray(a.devices);
  const okB = isObj(b) && Number.isInteger(b.ver) && Array.isArray(b.devices);
  if (!okA) return okB ? b : (a || b || null);
  if (!okB) return a;
  if (a.ver !== b.ver) return a.ver > b.ver ? a : b;
  if (!a.needsSign && !b.needsSign && bodyKey(a) === bodyKey(b)) return ((a.sg && a.sg.s) || '') <= ((b.sg && b.sg.s) || '') ? a : b;
  const removed = Array.from(new Set([].concat(a.removed || [], b.removed || []))).sort();
  const gone = new Set(removed);
  const byFp = new Map();
  for (const d of [].concat(a.devices, b.devices)) {
    if (!okEntry(d) || gone.has(d.sigFp)) continue;
    const had = byFp.get(d.sigFp);
    if (!had || (Number(d.added) || 0) < had.added) byFp.set(d.sigFp, clean(d));
  }
  return { v: 1, kind: 'mentria-devices', ver: a.ver, ts: Math.max(Number(a.ts) || 0, Number(b.ts) || 0), devices: order(Array.from(byFp.values())), removed, by: a.by <= b.by ? a.by : b.by, needsSign: true };
};

export const makeInvite = async (me) => {
  const nonce = b64uEnc(crypto.getRandomValues(new Uint8Array(16)));
  return signBody(me.sign.signKey, me.sign.spub, 'devinvite', nonce, { v: 1, nonce, exp: Date.now() + INVITE_MS, by: me.sign.sigFp });
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
  if (!isObj(invite) || !nonce || invite.nonce !== nonce || !(invite.exp > Date.now()) || invite.exp - Date.now() > INVITE_MS + 60000) return false;
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
    if (await inviteOk(list, invite, join.nonce)) return { list: await withDevice(list, me, entry) };
    return { ask: clean(entry) };
  } catch (_) { return {}; }
};

export const acceptList = async (current, candidate, myFp) => {
  if (!(await verifyList(candidate))) return false;
  if (!isObj(current)) return true;
  if (candidate.ver <= current.ver) return false;
  const trusted = trustedFps(current);
  if (trusted.includes(candidate.by)) return true;
  return trusted.length === 1 && trusted[0] === myFp && trustedFps(candidate).includes(myFp);
};

export const foldUnion = async (current, union, me) => {
  assertTrusted(current, me);
  const removed = new Set([].concat(current.removed || [], (isObj(union) && Array.isArray(union.removed)) ? union.removed : []));
  if (removed.has(me.sign.sigFp)) return { asks: [], removedSelf: true };
  const known = new Set(current.devices.map((d) => d.sigFp));
  const asks = ((isObj(union) && Array.isArray(union.devices)) ? union.devices : []).filter((d) => okEntry(d) && !known.has(d.sigFp) && !removed.has(d.sigFp)).map(clean);
  const ver = Math.max(current.ver, (isObj(union) && Number.isInteger(union.ver)) ? union.ver : 0) + 1;
  const list = await signList(me, ver, current.devices.filter((d) => !removed.has(d.sigFp)), Array.from(removed));
  return { list, asks };
};
