const enc = new TextEncoder();
const SALT = enc.encode('mentria-keyring-v1');
const KCV_PREFIX = 'mentria-keyring-kcv-v1';
const PBKDF2_ITER = 600000;
const ITER_MIN = 1000;
const ITER_MAX = 10000000;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const B32_RE = /^[A-Za-z2-7]{32}$/;
const C20_RE = /^[abcdefghjkmnpqrstuvwxyz23456789]{20}$/i;

export const SERVICES = ['identity', 'totp', 'notes', 'finance'];
export const GRACE_MS = 60000;
export const RETIRE_AFTER_MS = 30 * 86400000;

function randomBytes(n) { return crypto.getRandomValues(new Uint8Array(n)); }

function bytesOf(v) {
  if (v instanceof Uint8Array) return v;
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  if (Object.prototype.toString.call(v) === '[object ArrayBuffer]') return new Uint8Array(v);
  return null;
}

function needBytes(v, min, max) {
  const b = bytesOf(v);
  if (!b || b.length < min || b.length > max) throw new Error('bad-input');
  return b;
}

function needRoot(v) { return needBytes(v, 32, 32); }

function needKey(k, alg) {
  const shaped = typeof CryptoKey === 'function' ? k instanceof CryptoKey : !!k && typeof k === 'object' && typeof k.type === 'string';
  if (!shaped || !k.algorithm || k.algorithm.name !== alg) throw new Error('bad-input');
  return k;
}

function iterOk(n) { return Number.isInteger(n) && n >= ITER_MIN && n <= ITER_MAX; }

function stamp(now) { return new Date(now == null ? Date.now() : now).toISOString(); }

function idText(v) {
  const s = typeof v === 'string' ? v : b64u(needBytes(v, 1, Infinity));
  if (!s) throw new Error('bad-input');
  return s;
}

function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

function isBox(v) { return isObj(v) && typeof v.iv === 'string' && typeof v.ct === 'string'; }

function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined; }

function clone(v) { return JSON.parse(JSON.stringify(v)); }

export function b64u(bytes) {
  const u = bytesOf(bytes);
  if (!u) throw new Error('bad-input');
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function unb64u(str) {
  const s = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b32(bytes) {
  let bits = 0, value = 0, out = '';
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function unb32(s) {
  const clean = String(s || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  const out = [];
  let bits = 0, value = 0;
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return new Uint8Array(out);
}

function group(s, size) { return (String(s).match(new RegExp('.{1,' + size + '}', 'g')) || []).join('-'); }

export function newRecoveryCode() {
  return group(b32(randomBytes(20)), 4);
}

export function normalizeCode(input) {
  if (typeof input !== 'string') return null;
  const s = input.replace(/[\s\u2010-\u2015\u2212-]+/g, '');
  if (B32_RE.test(s)) return { kind: 'b32', text: s.toUpperCase() };
  if (C20_RE.test(s)) return { kind: 'c20', text: s.toLowerCase() };
  return null;
}

export function formatCode(norm) {
  const n = typeof norm === 'string' ? normalizeCode(norm) : norm;
  if (!n || typeof n.text !== 'string') return '';
  return group(n.text, n.kind === 'c20' ? 5 : 4);
}

function needCode(code) {
  const n = normalizeCode(code);
  if (!n) throw new Error('bad-code');
  return n;
}

function codeBytes(n) { return n.kind === 'b32' ? unb32(n.text) : enc.encode(n.text); }

async function hkdfBase(bytes) {
  return crypto.subtle.importKey('raw', bytes, 'HKDF', false, ['deriveKey', 'deriveBits']);
}

function hkdfParams(salt, info) {
  return { name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode(info) };
}

async function aesFrom(base, salt, info) {
  return crypto.subtle.deriveKey(hkdfParams(salt, info), base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function seal(key, plain, aad) {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, key, plain));
  return { iv: b64u(iv), ct: b64u(ct) };
}

async function open(key, box, aad) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64u(box.iv), additionalData: enc.encode(aad) }, key, unb64u(box.ct));
  return new Uint8Array(pt);
}

async function guarded(code, fn) {
  try { return await fn(); } catch (_) { throw new Error(code); }
}

export async function rootKeyFrom(bytes) {
  return hkdfBase(needRoot(bytes));
}

export async function kcvOf(rootBytes) {
  const r = needRoot(rootBytes);
  const prefix = enc.encode(KCV_PREFIX);
  const data = new Uint8Array(prefix.length + r.length);
  data.set(prefix, 0);
  data.set(r, prefix.length);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return b64u(digest.slice(0, 16));
}

async function codeKey(n, salt) {
  return aesFrom(await hkdfBase(codeBytes(n)), salt, 'mentria-keyring-recovery-v1');
}

export async function wrapWithCode(rootBytes, code) {
  const root = needRoot(rootBytes);
  const n = needCode(code);
  const salt = randomBytes(16);
  const box = await seal(await codeKey(n, salt), root, 'mentria-keyring|wrap|recovery');
  return { fmt: n.kind, salt: b64u(salt), iv: box.iv, ct: box.ct, created: stamp() };
}

export async function openWithCode(wrap, code) {
  return guarded('bad-code', async () => {
    const n = needCode(code);
    if (wrap.fmt && wrap.fmt !== n.kind) throw new Error('bad-code');
    return open(await codeKey(n, unb64u(wrap.salt)), wrap, 'mentria-keyring|wrap|recovery');
  });
}

function nfc(pass) { return String(pass == null ? '' : pass).normalize('NFC'); }

async function passKey(pass, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function wrapWithPassphrase(rootBytes, pass, iterations) {
  const root = needRoot(rootBytes);
  const iter = iterations == null ? PBKDF2_ITER : iterations;
  if (!iterOk(iter)) throw new Error('bad-input');
  const p = nfc(pass);
  if (Array.from(p).length < 12) throw new Error('weak-pass');
  const salt = randomBytes(32);
  const box = await seal(await passKey(p, salt, iter), root, 'mentria-keyring|wrap|pass');
  return { salt: b64u(salt), iter, iv: box.iv, ct: box.ct, created: stamp() };
}

export async function openWithPassphrase(wrap, pass) {
  return guarded('bad-pass', async () => {
    if (!iterOk(wrap.iter)) throw new Error('bad-pass');
    return open(await passKey(nfc(pass), unb64u(wrap.salt), wrap.iter), wrap, 'mentria-keyring|wrap|pass');
  });
}

async function prfKey(prfOutput, hkdf) {
  return aesFrom(await hkdfBase(prfOutput), hkdf, 'mentria-keyring-prf-v1');
}

export async function wrapWithPrf(rootBytes, prfOutput, { id, salt, label } = {}) {
  const root = needRoot(rootBytes);
  const output = needBytes(prfOutput, 32, Infinity);
  const meta = { id: idText(id), salt: idText(salt) };
  const hkdf = randomBytes(32);
  const box = await seal(await prfKey(output, hkdf), root, 'mentria-keyring|wrap|prf');
  return { id: meta.id, salt: meta.salt, hkdf: b64u(hkdf), label: label == null ? '' : String(label), created: stamp(), iv: box.iv, ct: box.ct };
}

export async function openWithPrf(wrap, prfOutput) {
  return guarded('bad-prf', async () => open(await prfKey(needBytes(prfOutput, 32, Infinity), unb64u(wrap.hkdf)), wrap, 'mentria-keyring|wrap|prf'));
}

export async function wrapWithDeviceKey(rootBytes, aesKey) {
  const root = needRoot(rootBytes);
  const box = await seal(needKey(aesKey, 'AES-GCM'), root, 'mentria-keyring|wrap|device');
  return { iv: box.iv, ct: box.ct, created: stamp() };
}

export async function openWithDeviceKey(box, aesKey) {
  return guarded('bad-device', async () => open(needKey(aesKey, 'AES-GCM'), box, 'mentria-keyring|wrap|device'));
}

function serviceKey(rootKey, name) {
  if (!SERVICES.includes(name)) throw new Error('bad-service');
  return aesFrom(rootKey, SALT, 'svc:' + name);
}

export async function sealService(rootKey, name, secretBytes, now) {
  needKey(rootKey, 'HKDF');
  const secret = needBytes(secretBytes, 1, Infinity);
  const box = await seal(await serviceKey(rootKey, name), secret, 'mentria-keyring|svc|' + name);
  return { iv: box.iv, ct: box.ct, linked: stamp(now) };
}

export async function openService(rootKey, name, entry) {
  needKey(rootKey, 'HKDF');
  return guarded('bad-service', async () => open(await serviceKey(rootKey, name), entry, 'mentria-keyring|svc|' + name));
}

async function backupBits(n, salt) {
  const bits = await crypto.subtle.deriveBits(hkdfParams(salt, 'mentria-keyring-backup-v1'), await hkdfBase(codeBytes(n)), 256);
  return new Uint8Array(bits);
}

function backupSalt(salt) {
  try {
    const s = typeof salt === 'string' ? unb64u(salt) : bytesOf(salt);
    if (s && s.length >= 16) return s;
  } catch (_) {}
  throw new Error('bad-backup');
}

export async function makeBackupEntry(rootKey, code) {
  needKey(rootKey, 'HKDF');
  const n = needCode(code);
  const salt = randomBytes(16);
  const box = await seal(await aesFrom(rootKey, SALT, 'svc:backup'), await backupBits(n, salt), 'mentria-keyring|backup');
  return { salt: b64u(salt), iv: box.iv, ct: box.ct };
}

export async function backupKeyFromEntry(rootKey, entry) {
  needKey(rootKey, 'HKDF');
  return guarded('bad-backup', async () => {
    const key = await open(await aesFrom(rootKey, SALT, 'svc:backup'), entry, 'mentria-keyring|backup');
    if (key.length !== 32) throw new Error('bad-backup');
    return key;
  });
}

export async function backupKeyFromCode(code, salt) {
  const n = needCode(code);
  return backupBits(n, backupSalt(salt));
}

export async function createRecord({ code, deviceId, deviceName, app, now } = {}) {
  needCode(code);
  const created = stamp(now);
  const rootBytes = randomBytes(32);
  const rootKey = await rootKeyFrom(rootBytes);
  const record = {
    v: 1,
    id: b64u(randomBytes(16)),
    kcv: await kcvOf(rootBytes),
    created,
    changed: created,
    codeConfirmed: null,
    wraps: { recovery: Object.assign(await wrapWithCode(rootBytes, code), { created }), prf: [] },
    backup: await makeBackupEntry(rootKey, code),
    services: {},
    retired: {},
    devices: {}
  };
  if (deviceId) record.devices[deviceId] = { name: deviceName == null ? '' : String(deviceName), lastSeen: created, app: app == null ? '' : String(app), keyring: 1 };
  return { record, rootBytes };
}

export async function verifyRoot(record, rootBytes) {
  if (!record || await kcvOf(rootBytes) !== record.kcv) throw new Error('wrong-key');
}

export function isRecord(value) {
  if (!isObj(value) || value.v !== 1 || typeof value.id !== 'string' || typeof value.kcv !== 'string' || !value.kcv) return false;
  const w = value.wraps;
  if (!isObj(w) || !isBox(w.recovery) || typeof w.recovery.salt !== 'string' || !Array.isArray(w.prf)) return false;
  if (w.pass != null && !isObj(w.pass)) return false;
  if (!isObj(value.services) || !isObj(value.devices)) return false;
  if (value.backup != null && !isBox(value.backup)) return false;
  if (value.retired != null && !isObj(value.retired)) return false;
  return true;
}

function ms(v) {
  const n = Date.parse(v);
  return Number.isFinite(n) ? n : -Infinity;
}

function later(a, b, when) {
  if (a == null) return b;
  if (b == null) return a;
  const x = when(a), y = when(b);
  if (x !== y) return x > y ? a : b;
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
}

function earlier(a, b) {
  if (a == null) return b;
  if (b == null) return a;
  const x = ms(a), y = ms(b);
  if (x !== y) return x < y ? a : b;
  return String(a) <= String(b) ? a : b;
}

function prfWinner(a, b) {
  if (a.removed && !b.removed) return ms(b.created) > ms(a.removed) ? b : a;
  if (b.removed && !a.removed) return ms(a.created) > ms(b.removed) ? a : b;
  return later(a, b, (e) => ms(e.created));
}

function mergePrf(a, b) {
  const byId = new Map();
  for (const e of [].concat(a || [], b || [])) {
    if (!isObj(e) || typeof e.id !== 'string') continue;
    byId.set(e.id, byId.has(e.id) ? prfWinner(byId.get(e.id), e) : e);
  }
  return [...byId.values()]
    .map((e) => (e.removed ? { id: e.id, removed: e.removed } : e))
    .sort((x, y) => (ms(x.created) - ms(y.created)) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
}

function mergeMap(a, b, pick) {
  const x = isObj(a) ? a : {};
  const y = isObj(b) ? b : {};
  const keys = [...new Set(Object.keys(x).concat(Object.keys(y)))].sort();
  return Object.fromEntries(keys.map((k) => [k, pick(own(x, k), own(y, k))]).filter((e) => e[1] != null));
}

function firstRecord(a, b) {
  const x = ms(a.created), y = ms(b.created);
  if (x !== y) return x < y ? a : b;
  return String(a.id) <= String(b.id) ? a : b;
}

export function mergeRecords(local, incoming) {
  if (!isRecord(local) || !isRecord(incoming) || local.kcv !== incoming.kcv) return null;
  const a = local, b = incoming;
  const wa = a.wraps, wb = b.wraps;
  const recovery = later(wa.recovery, wb.recovery, (w) => ms(w.created));
  const sameRecovery = JSON.stringify(wa.recovery) === JSON.stringify(wb.recovery);
  const backup = sameRecovery ? later(a.backup, b.backup, () => 0) : recovery === wa.recovery ? a.backup : b.backup;
  const since = Date.parse(recovery.created);
  const current = (c) => (c != null && Date.parse(c) >= since ? c : null);
  const pass = later(wa.pass, wb.pass, (w) => Math.max(ms(w.created), ms(w.removed)));
  const first = firstRecord(a, b);
  return clone(Object.assign({}, b, a, {
    v: 1,
    id: first.id,
    kcv: a.kcv,
    created: first.created,
    changed: later(a.changed, b.changed, ms),
    codeConfirmed: earlier(current(a.codeConfirmed), current(b.codeConfirmed)) || null,
    wraps: Object.assign({}, wb, wa, {
      recovery,
      prf: mergePrf(wa.prf, wb.prf),
      pass: pass && pass.removed ? { removed: pass.removed } : pass
    }),
    backup,
    services: mergeMap(a.services, b.services, (x, y) => later(x, y, (e) => ms(e.linked))),
    retired: mergeMap(a.retired, b.retired, earlier),
    devices: mergeMap(a.devices, b.devices, (x, y) => later(x, y, (d) => ms(d.lastSeen)))
  }));
}

export function touchDevice(record, deviceId, { name, app, keyring, now } = {}) {
  const devices = isObj(record.devices) ? record.devices : {};
  const prev = isObj(own(devices, deviceId)) ? devices[deviceId] : {};
  const seen = stamp(now);
  const entry = {
    name: name == null ? (prev.name == null ? '' : prev.name) : String(name),
    lastSeen: seen,
    app: app == null ? (prev.app == null ? '' : prev.app) : String(app),
    keyring: keyring == null ? (prev.keyring === 1 ? 1 : 0) : (keyring ? 1 : 0)
  };
  return Object.assign({}, record, { changed: later(record.changed, seen, ms), devices: Object.assign({}, devices, { [deviceId]: entry }) });
}

export function retirementStatus(record, service, { now, notesConverted } = {}) {
  if (!SERVICES.includes(service)) return { ready: false, blockers: ['not-linked'] };
  const at = now == null ? Date.now() : now;
  const rec = isObj(record) ? record : {};
  const entry = isObj(rec.services) ? own(rec.services, service) : undefined;
  const recovery = isObj(rec.wraps) && isObj(rec.wraps.recovery) ? rec.wraps.recovery : {};
  const settled = (iso) => at - Date.parse(iso) >= RETIRE_AFTER_MS;
  const blockers = [];
  if (!entry) blockers.push('not-linked');
  if (!rec.codeConfirmed || !(Date.parse(rec.codeConfirmed) >= Date.parse(recovery.created))) blockers.push('code-unconfirmed');
  if (entry && !settled(entry.linked)) blockers.push('too-recent');
  if (Object.values(isObj(rec.devices) ? rec.devices : {}).some((d) => isObj(d) && d.keyring !== 1 && !settled(d.lastSeen))) blockers.push('old-device');
  if (service === 'notes' && notesConverted !== true) blockers.push('notes-unconverted');
  if (isObj(rec.retired) && own(rec.retired, service)) blockers.push('already-retired');
  return { ready: blockers.length === 0, blockers };
}

export function decideLaunch({ liveOther, marker, seenAgeMs, wasDiscarded, mobile } = {}) {
  if (liveOther) return 'continue';
  if (marker && (seenAgeMs < GRACE_MS || wasDiscarded || mobile)) return 'continue';
  return 'reopen';
}
