import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { register } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const OLD_COMMIT = '9570a53e6e846d421cd25ef638d808d5ff55bcba';
const tmp = mkdtempSync(join(tmpdir(), 'unlock-storage-'));
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));

const stubPath = join(tmp, 'trystero.mjs');
writeFileSync(stubPath, [
  "export const selfId = 'self-peer';",
  'export function joinRoom(config, roomId) { return globalThis.__fakeRoom(config, roomId); }'
].join('\n'));
const hooksPath = join(tmp, 'hooks.mjs');
writeFileSync(hooksPath, [
  "let root = '';",
  "let stub = '';",
  'export async function initialize(data) { root = data.root; stub = data.stub; }',
  'export async function resolve(specifier, context, next) {',
  "  if (specifier === '/assets/vendor/trystero-nostr.js') return { url: stub, shortCircuit: true };",
  "  if (specifier === '/assets/js/mentria-unlock-core.js' && String(context.parentURL || '').includes('nocore=1')) return { url: root + '/assets/js/no-core-for-this-check.js', shortCircuit: true };",
  "  if (specifier.startsWith('/assets/')) return { url: root + specifier, shortCircuit: true };",
  '  return next(specifier, context);',
  '}'
].join('\n'));
register(pathToFileURL(hooksPath).href, import.meta.url, { data: { root: pathToFileURL(join(repo, 'src')).href, stub: pathToFileURL(stubPath).href } });

class MemoryStorage {
  constructor() { this.map = new Map(); }
  get length() { return this.map.size; }
  key(i) { const k = Array.from(this.map.keys())[i]; return k === undefined ? null : k; }
  getItem(k) { return this.map.has(String(k)) ? this.map.get(String(k)) : null; }
  setItem(k, v) { this.map.set(String(k), String(v)); }
  removeItem(k) { this.map.delete(String(k)); }
  clear() { this.map.clear(); }
}
const ls = new MemoryStorage();
Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true, writable: true });
const bus = new EventTarget();
globalThis.window = globalThis;
globalThis.addEventListener = bus.addEventListener.bind(bus);
globalThis.removeEventListener = bus.removeEventListener.bind(bus);
globalThis.dispatchEvent = bus.dispatchEvent.bind(bus);
const RELEASE = 'v2026.10.28';
const IDB = { databases: async () => [] };
globalThis.indexedDB = IDB;
globalThis.document = { documentElement: { dataset: { release: RELEASE }, lang: 'en' } };
globalThis.fetch = async () => { throw new Error('offline'); };
const asked = [];
let answer = () => true;
globalThis.mentriaConfirm = async (msg, opts) => { asked.push(msg); return answer(msg, opts); };
const rooms = [];
globalThis.__fakeRoom = (config, roomId) => {
  const room = {
    roomId, sent: [], action: null, onPeerJoin: null, onPeerLeave: null,
    makeAction(name) {
      const a = { name, onMessage: null, send: (payload, to) => { room.sent.push({ payload, to }); } };
      room.action = a;
      return a;
    },
    leave: async () => {}
  };
  rooms.push(room);
  return room;
};

const fileUrl = (rel) => pathToFileURL(join(repo, rel)).href;
const U = await import(fileUrl('src/assets/js/mentria-unlock-core.js'));
await import(fileUrl('src/assets/js/mentria-store.js'));
const Store = globalThis.MentriaStore;
const oldPath = join(tmp, 'old-backup.cjs');
writeFileSync(oldPath, execFileSync('git', ['show', OLD_COMMIT + ':src/assets/js/mentria-backup.js'], { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 26 }));
await import(pathToFileURL(oldPath).href);
const OLD = globalThis.MentriaBackup;
delete globalThis.MentriaBackup;
await import(fileUrl('src/assets/js/mentria-backup.js'));
const BK = globalThis.MentriaBackup;
await import(fileUrl('src/assets/js/mentria-sync.js'));
const Sync = globalThis.MentriaSync;

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

const te = new TextEncoder();
const td = new TextDecoder();
const PASS = 'old pass 1234';
const SECRET = new Uint8Array(32).fill(7);
const COPY = {
  replace: 'REPLACE {areas}', totpVault: 'TOTP?', identityVault: 'IDENTITY?', keyringVault: 'KEYRING?',
  finance: 'FINANCE?', summary: 'SUMMARY {date} {areas}'
};
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
const clone = (v) => JSON.parse(JSON.stringify(v));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 4000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out');
    await sleep(10);
  }
};
const raw = (suffix) => ls.getItem('mentria.store.' + suffix);
const put = (suffix, value, mtime) => {
  const dot = suffix.indexOf('.');
  assert.ok(Store.set(suffix.slice(0, dot), suffix.slice(dot + 1), value, { remote: true, mtime: mtime == null ? Date.now() : mtime }));
};
const reset = (opts = {}) => {
  ls.clear();
  asked.length = 0;
  answer = () => true;
  delete globalThis.MentriaSyncCopy;
  globalThis.document.documentElement.dataset.release = RELEASE;
  if (opts.capable === false) {
    delete globalThis.indexedDB;
  } else {
    globalThis.indexedDB = IDB;
    ls.setItem('mentria.keyring.local', JSON.stringify(Object.assign({ deviceId: 'dev-a' }, opts.local)));
  }
};
const errCode = async (p, mod = BK) => {
  try { await p; } catch (e) { return mod.restoreErrorCode(e); }
  throw new Error('expected a failure');
};
const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const unb64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));

async function keyring(deviceId = 'dev-a', deviceName = 'Laptop') {
  const code = U.newRecoveryCode();
  const { record, rootBytes } = await U.createRecord({ code, deviceId, deviceName, app: 'beta' });
  const rootKey = await U.rootKeyFrom(rootBytes);
  const key = await U.backupKeyFromEntry(rootKey, record.backup);
  return { code, record, rootBytes, rootKey, secret: { keyring: { key, salt: record.backup.salt, kcv: record.kcv } } };
}

async function withPasskey(k, record) {
  const r = clone(record);
  r.wraps.prf.push(await U.wrapWithPrf(k.rootBytes, rand(32), { id: U.b64u(rand(16)), salt: U.b64u(rand(32)), label: 'key' }));
  return r;
}

const legacyIdentity = (kcv) => ({ v: 1, kcv, pass: { salt: U.b64u(rand(16)), iv: U.b64u(rand(12)), ct: U.b64u(rand(48)) } });
const legacyTotp = () => ({ v: 1, pass: { salt: U.b64u(rand(16)), wrap: U.b64u(rand(48)) }, iv: U.b64u(rand(12)), ct: U.b64u(rand(64)) });
const bigValue = () => randomBytes(4700000).toString('base64url');

async function roomKey(secret) {
  const bucket = String(Math.floor(Date.now() / (7 * 24 * 3600 * 1000)));
  const base = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: te.encode('mentria-identity-key-v1'), info: te.encode('aes-gcm-256|w' + bucket) },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}
const sealMsg = async (key, obj) => {
  const iv = rand(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(JSON.stringify(obj)));
  return { iv: b64(iv), ct: b64(new Uint8Array(ct)) };
};
const openMsg = async (key, p) => JSON.parse(td.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(p.iv) }, key, unb64(p.ct))));

async function joinRoom() {
  const before = rooms.length;
  await Sync.joinWithIdentity(SECRET);
  const room = rooms[before];
  assert.ok(room && room.action, 'room joined');
  const key = await roomKey(SECRET);
  const messages = async () => Promise.all(room.sent.map((s) => openMsg(key, s.payload)));
  const deliver = async (msg) => {
    const n = Sync.status().handled;
    room.action.onMessage(await sealMsg(key, msg), { peerId: 'peer-1' });
    await until(() => Sync.status().handled > n);
  };
  return { room, key, messages, deliver };
}

const snapshotOf = (store, extra) => Object.assign({
  op: 'snapshot', v: 2,
  data: { version: 1, exportedAt: new Date().toISOString(), store, legacy: {} },
  meta: Object.fromEntries(Object.keys(store).map((k) => [k, Date.now() - 60000])),
  tombs: {}
}, extra || {});

const headerOf = async (blob) => JSON.parse((await blob.slice(0, 4096).text()).split('\n')[0].replace(/,"ct":\[$/, '}'));
const seedForBackup = (big) => {
  put('quick_notes.blob', [{ id: 'n1', body: 'hello', updatedAt: 5 }]);
  put('tools.color_picker_palette', ['#6ef3c5']);
  if (big) put('tools.big', bigValue());
};

check('v3 file still opens after the change', async () => {
  reset();
  seedForBackup(true);
  const expected = Store.exportAll().store;
  const out = await OLD.sealBackup(await OLD.prepareBackup(), PASS);
  const head = await headerOf(out.blob);
  assert.equal(head.v, 3);
  assert.equal(head.kdf, 'PBKDF2');
  assert.ok(head.n >= 2, 'several chunks');
  const data = await BK.readBackupFile(out.blob, PASS);
  assert.equal(data.format, 'mentria-backup');
  assert.deepEqual(data.local.store, expected);
  const oneLine = new Blob([JSON.stringify(JSON.parse(await out.blob.text()))]);
  assert.deepEqual((await BK.readBackupFile(oneLine, PASS)).local.store, expected);
  assert.equal(await errCode(BK.readBackupFile(out.blob, 'wrong pass 1234')), 'pass');
});

check('v2 envelope still opens after the change', async () => {
  const data = { version: 1, exportedAt: new Date().toISOString(), store: { 'totp.vault': '{"v":1}' }, legacy: {} };
  const env = await BK.encryptBackup(data, PASS);
  assert.equal(env.v, 2);
  assert.equal(env.kdf, 'PBKDF2');
  assert.deepEqual(await BK.readBackupFile(new Blob([JSON.stringify(env)]), PASS), data);
  const old = await OLD.encryptBackup(data, PASS);
  assert.deepEqual(await BK.readBackupFile(new Blob([JSON.stringify(old)]), PASS), data);
});

check('v4 roundtrip with recovery code', async () => {
  const k = await keyring();
  const data = { version: 1, exportedAt: new Date().toISOString(), store: { 'totp.vault': JSON.stringify(legacyTotp()) }, legacy: {} };
  const env = await BK.encryptBackup(data, k.secret);
  assert.deepEqual(Object.keys(env).sort(), ['ct', 'iv', 'kcv', 'kdf', 'salt', 'v']);
  assert.equal(env.v, 4);
  assert.equal(env.kdf, 'keyring-code');
  assert.equal(env.salt, k.record.backup.salt);
  assert.equal(env.kcv, k.record.kcv);
  const file = new Blob([JSON.stringify(env)]);
  assert.deepEqual(await BK.readBackupFile(file, k.code), data);
  assert.deepEqual(await BK.readBackupFile(file, '  ' + k.code.toLowerCase().replace(/-/g, ' ') + ' '), data);
  assert.deepEqual(await BK.readBackupFile(file, k.secret), data);
  const fileKey = await crypto.subtle.importKey('raw', await U.backupKeyFromCode(k.code, env.salt), 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: U.unb64u(env.iv), additionalData: te.encode('mentria-backup/4') }, fileKey, U.unb64u(env.ct)));
  assert.equal(plain[0], 0x1f);
  assert.equal(plain[1], 0x8b);
  await assert.rejects(crypto.subtle.decrypt({ name: 'AES-GCM', iv: U.unb64u(env.iv) }, fileKey, U.unb64u(env.ct)));
});

check('v5 roundtrip with keyring key and with code', async () => {
  reset();
  seedForBackup(true);
  const expected = Store.exportAll().store;
  const k = await keyring();
  let last = 0;
  const out = await BK.sealBackup(await BK.prepareBackup(), k.secret, { onProgress: (p) => { last = p; } });
  assert.equal(last, 1);
  const head = await headerOf(out.blob);
  assert.deepEqual(Object.keys(head).sort(), ['iv', 'kcv', 'kdf', 'n', 'salt', 'v', 'z']);
  assert.equal(head.v, 5);
  assert.equal(head.kdf, 'keyring-code');
  assert.equal(head.salt, k.record.backup.salt);
  assert.equal(head.kcv, k.record.kcv);
  assert.ok(head.n >= 2, 'several chunks');
  assert.deepEqual((await BK.readBackupFile(out.blob, k.secret)).local.store, expected);
  assert.deepEqual((await BK.readBackupFile(out.blob, k.code)).local.store, expected);
  const oneLine = new Blob([JSON.stringify(JSON.parse(await out.blob.text()))]);
  assert.deepEqual((await BK.readBackupFile(oneLine, k.code)).local.store, expected);
  assert.equal(BK.FILE_VERSION, 5);
  const info = await BK.backupHeader(out.blob);
  assert.deepEqual(info, { v: 5, code: true, salt: k.record.backup.salt, kcv: k.record.kcv });
  const v3 = await BK.backupHeader((await BK.sealBackup(await BK.prepareBackup(), PASS)).blob);
  assert.deepEqual(v3, { v: 3, code: false, salt: null, kcv: null });
});

check('v4 wrong code fails with restore_err_pass code', async () => {
  const k = await keyring();
  const other = await keyring();
  const data = { version: 1, exportedAt: new Date().toISOString(), store: {}, legacy: {} };
  const file = new Blob([JSON.stringify(await BK.encryptBackup(data, k.secret))]);
  assert.equal(await errCode(BK.readBackupFile(file, other.code)), 'pass');
  assert.equal(await errCode(BK.readBackupFile(file, 'nope')), 'pass');
  assert.equal(await errCode(BK.readBackupFile(file, PASS)), 'pass');
  assert.equal(await errCode(BK.readBackupFile(file, '')), 'pass');
  assert.equal(await errCode(BK.readBackupFile(file, other.secret)), 'pass');
  const wrongKey = { keyring: Object.assign({}, k.secret.keyring, { key: rand(32) }) };
  assert.equal(await errCode(BK.readBackupFile(file, wrongKey)), 'pass');
  reset();
  seedForBackup(false);
  const v5 = (await BK.sealBackup(await BK.prepareBackup(), k.secret)).blob;
  assert.equal(await errCode(BK.readBackupFile(v5, other.code)), 'pass');
  assert.equal(await errCode(BK.readBackupFile(v5, wrongKey)), 'pass');
  const v3 = (await BK.sealBackup(await BK.prepareBackup(), PASS)).blob;
  assert.equal(await errCode(BK.readBackupFile(v3, k.secret)), 'pass');
});

check('old reader says newer for v4 and v5', async () => {
  reset();
  seedForBackup(false);
  const k = await keyring();
  const v4 = new Blob([JSON.stringify(await BK.encryptBackup({ version: 1, store: {}, legacy: {} }, k.secret))]);
  const v5 = (await BK.sealBackup(await BK.prepareBackup(), k.secret)).blob;
  assert.equal(await errCode(OLD.readBackupFile(v4, k.code), OLD), 'newer');
  assert.equal(await errCode(OLD.readBackupFile(v5, k.code), OLD), 'newer');
  const v6 = new Blob([JSON.stringify({ v: 6, kdf: 'keyring-code', salt: 'a', kcv: 'b', iv: 'c', ct: 'd' })]);
  assert.equal(await errCode(BK.readBackupFile(v6, k.code)), 'newer');
});

check('planImport same-kcv keyring goes to merge', async () => {
  reset();
  const k = await keyring();
  put('keyring.vault', k.record);
  const same = await withPasskey(k, k.record);
  const plan = Store.planImport({ version: 1, store: { 'keyring.vault': JSON.stringify(same) }, legacy: {} });
  assert.deepEqual(plan.merge, ['keyring.vault']);
  assert.deepEqual(plan.vaults, []);
  const other = await keyring();
  const conflict = Store.planImport({ version: 1, store: { 'keyring.vault': JSON.stringify(other.record) }, legacy: {} });
  assert.deepEqual(conflict.vaults, ['keyring.vault']);
  assert.deepEqual(conflict.merge, []);
  const equal = Store.planImport({ version: 1, store: { 'keyring.vault': raw('keyring.vault') }, legacy: {} });
  assert.deepEqual(equal.same, ['keyring.vault']);
  assert.deepEqual(Store.areaNames(['keyring.vault']), ['one unlock']);
});

check('importAll mergeVault unions passkeys', async () => {
  reset();
  const k = await keyring();
  const local = await withPasskey(k, k.record);
  const incoming = await withPasskey(k, k.record);
  put('keyring.vault', local);
  const before = raw('keyring.vault');
  const payload = { version: 1, exportedAt: new Date().toISOString(), store: { 'keyring.vault': JSON.stringify(incoming) }, legacy: {} };
  Store.importAll(payload, { mode: 'merge' });
  assert.equal(raw('keyring.vault'), before, 'no merge function keeps this device\'s copy');
  const calls = [];
  const mergeVault = (suffix, a, b) => { calls.push(suffix); return JSON.stringify(U.mergeRecords(JSON.parse(a), JSON.parse(b))); };
  Store.importAll(payload, { mode: 'merge', mergeVault });
  assert.deepEqual(calls, ['keyring.vault']);
  const merged = Store.get('keyring', 'vault');
  assert.deepEqual(merged.wraps.prf.map((p) => p.id).sort(), [local.wraps.prf[0].id, incoming.wraps.prf[0].id].sort());
  assert.ok(Store.getMeta('keyring', 'vault'));
  Store.importAll(payload, { mode: 'merge', mergeVault: () => null });
  assert.equal(raw('keyring.vault'), JSON.stringify(merged), 'a failed merge keeps this device\'s copy');
  Store.importAll(payload, { mode: 'merge', mergeVault: () => { throw new Error('boom'); } });
  assert.equal(raw('keyring.vault'), JSON.stringify(merged));
});

check('restore merges a same-kcv keyring and asks for a different one', async () => {
  reset();
  const k = await keyring();
  const local = await withPasskey(k, k.record);
  const incoming = await withPasskey(k, k.record);
  put('keyring.vault', local);
  const payload = (rec) => ({ version: 1, exportedAt: new Date().toISOString(), store: { 'keyring.vault': JSON.stringify(rec) }, legacy: {} });
  await BK.applyRestore(payload(incoming), COPY);
  assert.ok(!asked.includes('KEYRING?'));
  assert.equal(Store.get('keyring', 'vault').wraps.prf.length, 2);
  const merged = raw('keyring.vault');
  const other = await keyring('dev-z');
  asked.length = 0;
  answer = (msg) => msg !== 'KEYRING?';
  await BK.applyRestore(payload(other.record), COPY);
  assert.ok(asked.includes('KEYRING?'));
  assert.equal(raw('keyring.vault'), merged);
  asked.length = 0;
  await BK.applyRestore(payload(other.record), Object.assign({}, COPY, { keyringVault: undefined }));
  assert.equal(raw('keyring.vault'), merged, 'no keyring copy never replaces it');
  answer = () => true;
  await BK.applyRestore(payload(other.record), COPY);
  assert.equal(Store.get('keyring', 'vault').kcv, other.record.kcv);
});

check('restore v3 with keyring present', async () => {
  reset();
  const backupIdentity = legacyIdentity('kcv-backup');
  put('identity.vault', backupIdentity);
  put('quick_notes.blob', [{ id: 'n1', body: 'old', updatedAt: 1 }]);
  const file = (await OLD.sealBackup(await OLD.prepareBackup(), PASS)).blob;
  reset();
  const k = await keyring();
  put('keyring.vault', k.record);
  put('identity.vault', legacyIdentity('kcv-local'));
  const before = raw('keyring.vault');
  const data = await BK.readBackupFile(file, PASS);
  const result = await BK.applyRestore(data, COPY);
  assert.ok(result.restored >= 2);
  assert.ok(asked.includes('IDENTITY?'));
  assert.ok(!asked.includes('KEYRING?'));
  assert.equal(raw('keyring.vault'), before);
  assert.deepEqual(Store.get('identity', 'vault'), backupIdentity);
  assert.equal(Store.get('quick_notes', 'blob')[0].body, 'old');
});

check('snapshot carries app, keyring and device', async () => {
  reset();
  const k = await keyring();
  put('keyring.vault', k.record);
  const r = await joinRoom();
  r.room.onPeerJoin('peer-1');
  const snap = await until(async () => (await r.messages()).find((m) => m.op === 'snapshot'));
  assert.equal(snap.app, RELEASE);
  assert.equal(snap.keyring, 1, 'a production release says keyring with no switch');
  assert.deepEqual(snap.device, { id: 'dev-a', name: 'Laptop' });
  assert.equal(snap.v, 2);
  await Sync.disconnect();
  reset({ local: { enabled: false } });
  put('keyring.vault', k.record);
  const was = await joinRoom();
  was.room.onPeerJoin('peer-1');
  const still = await until(async () => (await was.messages()).find((m) => m.op === 'snapshot'));
  assert.equal(still.keyring, 1, 'a tester switch left off on beta no longer turns it off');
  assert.deepEqual(still.device, { id: 'dev-a', name: 'Laptop' });
  await Sync.disconnect();
  reset({ capable: false });
  globalThis.document.documentElement.dataset.release = 'v2026.10.21';
  put('keyring.vault', k.record);
  const off = await joinRoom();
  off.room.onPeerJoin('peer-1');
  const plain = await until(async () => (await off.messages()).find((m) => m.op === 'snapshot'));
  assert.equal(plain.app, 'v2026.10.21');
  assert.equal(plain.keyring, undefined);
  assert.equal(plain.device, undefined);
  await off.deliver(snapshotOf({ 'keyring.vault': JSON.stringify(k.record) }));
  assert.equal(raw('keyring.vault'), JSON.stringify(k.record), 'a browser that cannot run the one unlock records nobody');
  await Sync.disconnect();
});

check('old peer keeps legacy wraps', async () => {
  reset();
  const k = await keyring();
  put('keyring.vault', k.record);
  const identity = JSON.stringify(legacyIdentity('kcv-id'));
  const totp = JSON.stringify(legacyTotp());
  put('identity.vault', JSON.parse(identity));
  put('totp.vault', JSON.parse(totp));
  const idRaw = raw('identity.vault');
  const totpRaw = raw('totp.vault');
  const r = await joinRoom();
  r.room.onPeerJoin('peer-1');
  await r.deliver(snapshotOf({ 'identity.vault': idRaw, 'totp.vault': totpRaw, 'keyring.vault': raw('keyring.vault') }));
  const rec = Store.get('keyring', 'vault');
  assert.ok(rec.devices.legacy, 'legacy entry written');
  assert.equal(rec.devices.legacy.name, '');
  assert.equal(rec.devices.legacy.app, '');
  assert.equal(rec.devices.legacy.keyring, 0);
  assert.ok(Math.abs(Date.parse(rec.devices.legacy.lastSeen) - Date.now()) < 60000);
  assert.equal(rec.devices['dev-a'].keyring, 1);
  assert.ok(U.retirementStatus(rec, 'identity').blockers.includes('old-device'));
  assert.equal(raw('identity.vault'), idRaw);
  assert.equal(raw('totp.vault'), totpRaw);
  const sent = await until(async () => (await r.messages()).find((m) => m.op === 'set' && m.ns === 'keyring' && m.key === 'vault'));
  assert.equal(sent.value.devices.legacy.keyring, 0);
  const again = raw('keyring.vault');
  await r.deliver(snapshotOf({ 'identity.vault': idRaw }));
  assert.equal(raw('keyring.vault'), again, 'seen today is not written again');
  await r.deliver(snapshotOf({ 'identity.vault': idRaw }, { app: 'v2026.10.07' }));
  assert.equal(raw('keyring.vault'), again, 'the legacy entry keeps a stable app');
  await r.deliver(snapshotOf({ 'keyring.vault': raw('keyring.vault') }, { app: 'beta', keyring: 1, device: { id: 'dev-b', name: 'Phone' } }));
  const both = Store.get('keyring', 'vault');
  assert.ok(both.devices['dev-b'], 'modern peer recorded');
  assert.deepEqual({ name: both.devices['dev-b'].name, app: both.devices['dev-b'].app, keyring: both.devices['dev-b'].keyring }, { name: 'Phone', app: 'beta', keyring: 1 });
  assert.equal(both.devices.legacy.keyring, 0);
  await r.deliver(snapshotOf({ 'keyring.vault': raw('keyring.vault') }, { keyring: 1, device: { id: 'legacy', name: 'x' } }));
  await r.deliver(snapshotOf({ 'keyring.vault': raw('keyring.vault') }, { keyring: 1, device: { id: '__proto__', name: 'x' } }));
  const last = Store.get('keyring', 'vault');
  assert.equal(last.devices.legacy.keyring, 0);
  assert.deepEqual(Object.keys(last.devices).sort(), ['dev-a', 'dev-b', 'legacy']);
  assert.ok(U.isRecord(last));
  await Sync.disconnect();
});

check('sync merges a same-kcv keyring', async () => {
  reset();
  const k = await keyring();
  const local = await withPasskey(k, k.record);
  put('keyring.vault', local, Date.now());
  const incoming = U.touchDevice(await withPasskey(k, k.record), 'dev-b', { name: 'Phone', app: 'beta', keyring: 1 });
  const r = await joinRoom();
  await r.deliver(snapshotOf({ 'keyring.vault': JSON.stringify(incoming) }, { app: 'beta', keyring: 1, device: { id: 'dev-b', name: 'Phone' } }));
  const merged = Store.get('keyring', 'vault');
  assert.equal(merged.wraps.prf.length, 2);
  assert.ok(merged.devices['dev-a'] && merged.devices['dev-b']);
  assert.deepEqual(asked, []);
  const back = await until(async () => (await r.messages()).find((m) => m.op === 'snapshot-back' && m.data.store['keyring.vault']));
  assert.equal(JSON.parse(back.data.store['keyring.vault']).wraps.prf.length, 2);
  assert.equal(back.keyring, 1);
  const third = await withPasskey(k, incoming);
  await r.deliver({ op: 'set', ns: 'keyring', key: 'vault', value: third, mtime: Date.now() });
  assert.equal(Store.get('keyring', 'vault').wraps.prf.length, 3);
  const kept = raw('keyring.vault');
  const other = await keyring('dev-z');
  await r.deliver({ op: 'set', ns: 'keyring', key: 'vault', value: other.record, mtime: Date.now() });
  assert.equal(raw('keyring.vault'), kept, 'a different keyring never replaces it silently');
  const broken = clone(third);
  delete broken.wraps;
  await r.deliver({ op: 'set', ns: 'keyring', key: 'vault', value: broken, mtime: Date.now() });
  assert.equal(raw('keyring.vault'), kept, 'an unreadable copy never overwrites it');
  await r.deliver({ op: 'remove', ns: 'keyring', key: 'vault', mtime: Date.now() });
  await r.deliver(Object.assign(snapshotOf({ 'keyring.vault': kept }, { app: 'beta', keyring: 1, device: { id: 'dev-b', name: 'Phone' } }), { tombs: { 'keyring.vault': Date.now() + 60000 } }));
  assert.equal(raw('keyring.vault'), kept, 'a peer never deletes it');
  await Sync.disconnect();
});

check('sync asks before replacing a different keyring', async () => {
  reset();
  globalThis.MentriaSyncCopy = { 'about.sync_vault_keyring': 'SYNC KEYRING?' };
  const k = await keyring();
  put('keyring.vault', k.record, Date.now() - 3600000);
  const before = raw('keyring.vault');
  const other = await keyring('dev-z');
  answer = () => false;
  const r = await joinRoom();
  await r.deliver(Object.assign(snapshotOf({ 'keyring.vault': JSON.stringify(other.record) }, { keyring: 1 }), { meta: { 'keyring.vault': Date.now() } }));
  await until(() => asked.length);
  assert.deepEqual(asked, ['SYNC KEYRING?']);
  const choice = await until(async () => (await r.messages()).find((m) => m.op === 'vault'));
  assert.deepEqual({ suffix: choice.suffix, keep: choice.keep }, { suffix: 'keyring.vault', keep: true });
  const after = Store.get('keyring', 'vault');
  assert.equal(after.kcv, k.record.kcv);
  assert.deepEqual(after.wraps, JSON.parse(before).wraps);
  assert.equal(after.devices.legacy.keyring, 0, 'a peer holding another keyring blocks retirement');
  await Sync.disconnect();
});

check('keyring merge happens at apply time', async () => {
  reset();
  const k = await keyring();
  const local = await withPasskey(k, k.record);
  put('keyring.vault', local, Date.now() - 3600000);
  put('tools.x', { a: 1 }, Date.now() - 3600000);
  const incoming = await withPasskey(k, k.record);
  let otherTab = null;
  answer = async () => {
    otherTab = await withPasskey(k, JSON.parse(raw('keyring.vault')));
    ls.setItem('mentria.store.keyring.vault', JSON.stringify(otherTab));
    return true;
  };
  const r = await joinRoom();
  const snap = snapshotOf({ 'keyring.vault': JSON.stringify(incoming), 'tools.x': JSON.stringify({ a: 2 }) }, { keyring: 1 });
  snap.meta['tools.x'] = Date.now();
  await r.deliver(snap);
  assert.ok(otherTab, 'the prompt ran');
  assert.equal(Store.get('tools', 'x').a, 2);
  const ids = Store.get('keyring', 'vault').wraps.prf.map((p) => p.id).sort();
  const want = [local.wraps.prf[0].id, incoming.wraps.prf[0].id, otherTab.wraps.prf[1].id].sort();
  assert.deepEqual(ids, want, 'a passkey added during the prompt survives');
  await Sync.disconnect();
});

check('peer tombstones never block a keyring', async () => {
  reset();
  const k = await keyring();
  const r = await joinRoom();
  await r.deliver(Object.assign(snapshotOf({}, { keyring: 1 }), { tombs: { 'keyring.vault': Date.now() + 3600000 } }));
  const tombs = JSON.parse(ls.getItem('mentria-sync-tombstones') || '{}');
  assert.equal(tombs['keyring.vault'], undefined);
  await r.deliver(snapshotOf({ 'keyring.vault': JSON.stringify(k.record) }, { keyring: 1 }));
  assert.equal(Store.get('keyring', 'vault').kcv, k.record.kcv);
  await Sync.disconnect();
});

check('an invalid keyring is never a first copy', async () => {
  reset();
  const k = await keyring();
  const broken = clone(k.record);
  delete broken.wraps;
  const r = await joinRoom();
  await r.deliver(snapshotOf({ 'keyring.vault': JSON.stringify(broken) }, { keyring: 1 }));
  assert.equal(raw('keyring.vault'), null, 'snapshot add');
  await r.deliver({ op: 'set', ns: 'keyring', key: 'vault', value: broken, mtime: Date.now() });
  assert.equal(raw('keyring.vault'), null, 'live set add');
  await r.deliver({ op: 'set', ns: 'keyring', key: 'vault', value: 'not a record', mtime: Date.now() });
  assert.equal(raw('keyring.vault'), null, 'live set of a string');
  await r.deliver({ op: 'snapshot', data: { version: 1, exportedAt: new Date().toISOString(), store: { 'keyring.vault': JSON.stringify(broken), 'tools.z': '1' }, legacy: {} } });
  assert.equal(raw('tools.z'), '1');
  assert.equal(raw('keyring.vault'), null, 'old protocol snapshot add');
  await Sync.disconnect();
  const payload = (rec) => ({ version: 1, exportedAt: new Date().toISOString(), store: { 'keyring.vault': JSON.stringify(rec), 'tools.y': '1' }, legacy: {} });
  const result = await BK.applyRestore(payload(broken), COPY);
  assert.equal(raw('keyring.vault'), null, 'restore add');
  assert.equal(raw('tools.y'), '1');
  assert.ok(result.restored >= 1);
  assert.ok(!asked.includes('KEYRING?'));
  put('keyring.vault', k.record);
  const before = raw('keyring.vault');
  const other = await keyring('dev-z');
  const otherBroken = clone(other.record);
  otherBroken.wraps.prf = 'x';
  await BK.applyRestore(payload(otherBroken), COPY);
  assert.ok(!asked.includes('KEYRING?'), 'no prompt for an invalid replacement');
  assert.equal(raw('keyring.vault'), before);
  ls.removeItem('mentria.store.keyring.vault');
  await BK.applyRestore(payload(k.record), COPY);
  assert.equal(Store.get('keyring', 'vault').kcv, k.record.kcv, 'a valid one is added');
  const r2 = await joinRoom();
  ls.removeItem('mentria.store.keyring.vault');
  await r2.deliver({ op: 'set', ns: 'keyring', key: 'vault', value: k.record, mtime: Date.now() });
  assert.equal(Store.get('keyring', 'vault').kcv, k.record.kcv, 'a valid live set is added');
  await Sync.disconnect();
});

check('a peer that cannot open this keyring blocks retirement', async () => {
  reset();
  const k = await keyring();
  put('keyring.vault', k.record);
  const other = await keyring('dev-z');
  answer = () => false;
  const r = await joinRoom();
  const dev = (id) => ({ app: 'beta', keyring: 1, device: { id, name: id } });
  await r.deliver(Object.assign(snapshotOf({ 'keyring.vault': JSON.stringify(other.record) }, dev('dev-b')), { meta: {} }));
  await r.deliver(snapshotOf({}, dev('dev-c')));
  await r.deliver(Object.assign(snapshotOf({}, dev('dev-d')), { op: 'snapshot-back' }));
  await r.deliver(snapshotOf({ 'keyring.vault': raw('keyring.vault') }, dev('dev-e')));
  await r.deliver(snapshotOf({}, { app: 'beta', keyring: 1 }));
  const d = Store.get('keyring', 'vault').devices;
  assert.equal(d['dev-b'].keyring, 0, 'holds a different keyring');
  assert.equal(d['dev-c'].keyring, 0, 'holds no keyring');
  assert.equal(d['dev-d'].keyring, 1, 'a reply leaves out what both sides share');
  assert.equal(d['dev-e'].keyring, 1, 'holds this keyring');
  assert.deepEqual(d.legacy, Object.assign({}, d.legacy, { name: '', app: '', keyring: 0 }), 'no device id');
  assert.ok(U.retirementStatus(Store.get('keyring', 'vault'), 'identity').blockers.includes('old-device'));
  await r.deliver(snapshotOf({ 'keyring.vault': raw('keyring.vault') }, dev('dev-b')));
  assert.equal(Store.get('keyring', 'vault').devices['dev-b'].keyring, 1, 'flips once it holds this keyring');
  await Sync.disconnect();
});

check('a linked totp vault keeps its sync id through retirement', async () => {
  reset();
  const legacy = legacyTotp();
  const kid = legacy.pass.salt + '.' + legacy.pass.wrap;
  put('totp.vault', Object.assign(clone(legacy), { kid }));
  const retired = { v: 2, linked: true, kid, secrets: { iv: U.b64u(rand(12)), ct: U.b64u(rand(64)) } };
  let r = await joinRoom();
  await r.deliver({ op: 'set', ns: 'totp', key: 'vault', value: retired, mtime: Date.now() });
  assert.deepEqual(Store.get('totp', 'vault'), retired, 'a retired copy has the same id as the linked legacy vault');
  await Sync.disconnect();
  const again = Object.assign(clone(legacy), { kid, iv: U.b64u(rand(12)) });
  r = await joinRoom();
  await r.deliver({ op: 'set', ns: 'totp', key: 'vault', value: again, mtime: Date.now() });
  assert.deepEqual(Store.get('totp', 'vault'), again, 'a copy that still has its pass wrap matches a retired one');
  await Sync.disconnect();
});

check('a new linked totp vault is identified by its kid', async () => {
  reset();
  const kid = U.b64u(rand(16));
  const mine = { v: 2, linked: true, kid, secrets: { iv: U.b64u(rand(12)), ct: U.b64u(rand(64)) } };
  put('totp.vault', mine);
  const r = await joinRoom();
  const kept = raw('totp.vault');
  await r.deliver({ op: 'set', ns: 'totp', key: 'vault', value: { v: 2, linked: true, kid: U.b64u(rand(16)), secrets: { iv: 'x', ct: 'y' } }, mtime: Date.now() });
  assert.equal(raw('totp.vault'), kept, 'a vault with another kid is not followed');
  await r.deliver({ op: 'set', ns: 'totp', key: 'vault', value: { v: 2, linked: true, kid: '', secrets: { iv: 'x', ct: 'y' } }, mtime: Date.now() });
  assert.equal(raw('totp.vault'), kept, 'an empty kid is no id');
  const next = { v: 2, linked: true, kid, secrets: { iv: U.b64u(rand(12)), ct: U.b64u(rand(64)) } };
  await r.deliver({ op: 'set', ns: 'totp', key: 'vault', value: next, mtime: Date.now() });
  assert.deepEqual(Store.get('totp', 'vault'), next, 'the same kid is followed');
  await Sync.disconnect();
});

check('a legacy peer never receives wrap-less linked vaults', async () => {
  reset();
  const k = await keyring();
  const idLinked = { v: 3, kcv: 'kcv-linked', linked: true };
  const totpLinked = { v: 2, linked: true, kid: U.b64u(rand(16)), secrets: { iv: U.b64u(rand(12)), ct: U.b64u(rand(64)) } };
  const seed = () => {
    put('keyring.vault', k.record);
    put('identity.vault', idLinked);
    put('totp.vault', totpLinked);
    put('tools.mine', { a: 1 });
  };
  seed();
  let r = await joinRoom();
  await r.deliver(snapshotOf({ 'tools.theirs': JSON.stringify({ b: 2 }) }));
  const back = await until(async () => (await r.messages()).find((m) => m.op === 'snapshot-back'));
  assert.ok(back.data.store['tools.mine'], 'other data still goes back');
  assert.equal(back.data.store['identity.vault'], undefined, 'no wrap-less identity vault in the reply to a legacy peer');
  assert.equal(back.data.store['totp.vault'], undefined, 'no wrap-less totp vault in the reply to a legacy peer');
  assert.equal(back.meta['identity.vault'], undefined);
  const n = (await r.messages()).length;
  assert.ok(Store.set('identity', 'vault', Object.assign({}, idLinked, { n: 2 })));
  assert.ok(Store.set('totp', 'vault', Object.assign({}, totpLinked, { n: 2 })));
  assert.ok(Store.set('tools', 'later', { c: 3 }));
  const after = await until(async () => {
    const all = (await r.messages()).slice(n);
    return all.find((m) => m.op === 'set' && m.ns === 'tools' && m.key === 'later') ? all : null;
  });
  assert.ok(!after.some((m) => m.op === 'set' && (m.ns === 'identity' || m.ns === 'totp')), 'no live wrap-less vault writes to a legacy peer');
  assert.ok(Store.set('identity', 'vault', legacyIdentity('kcv-linked')));
  await until(async () => (await r.messages()).find((m) => m.op === 'set' && m.ns === 'identity' && m.value && m.value.pass));
  await Sync.disconnect();
  reset();
  seed();
  r = await joinRoom();
  await r.deliver(snapshotOf({ 'tools.theirs': JSON.stringify({ b: 2 }) }, { app: 'beta', keyring: 1, device: { id: 'dev-b', name: 'Phone' } }));
  const back2 = await until(async () => (await r.messages()).find((m) => m.op === 'snapshot-back'));
  assert.equal(back2.data.store['identity.vault'], raw('identity.vault'), 'a keyring peer still gets the linked identity vault');
  assert.equal(back2.data.store['totp.vault'], raw('totp.vault'), 'a keyring peer still gets the linked totp vault');
  assert.ok(Store.set('identity', 'vault', Object.assign({}, idLinked, { n: 3 })));
  await until(async () => (await r.messages()).find((m) => m.op === 'set' && m.ns === 'identity' && m.value && m.value.n === 3));
  await Sync.disconnect();
});

const B32A = 'abcdefghijklmnopqrstuvwxyz234567';
const b32e = (bytes) => {
  let bits = 0, value = 0, out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) { out += B32A[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32A[(value << (5 - bits)) & 31];
  return out;
};
const b32d = (s) => {
  const clean = String(s).toLowerCase().replace(/[^a-z2-7]/g, '');
  const out = [];
  let bits = 0, value = 0;
  for (const ch of clean) {
    value = (value << 5) | B32A.indexOf(ch);
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return new Uint8Array(out);
};
async function codeKey(code) {
  const base = await crypto.subtle.importKey('raw', b32d(code), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: te.encode('mentria-sync-key-v1'), info: te.encode('aes-gcm-256') }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function pairRoom(asInitiator) {
  const before = rooms.length;
  let code;
  if (asInitiator) code = await Sync.start();
  else {
    code = b32e(rand(10)).match(/.{1,4}/g).join('-').toUpperCase();
    await Sync.joinWithCode(code);
  }
  const room = rooms[before];
  assert.ok(room && room.action, 'pairing room joined');
  const key = await codeKey(code);
  const messages = async () => Promise.all(room.sent.map((s) => openMsg(key, s.payload)));
  const deliver = async (msg, peerId) => {
    const n = Sync.status().handled;
    room.action.onMessage(await sealMsg(key, msg), { peerId: peerId || 'peer-1' });
    await until(() => Sync.status().handled > n);
  };
  return { room, key, messages, deliver };
}
const linkedVaults = () => ({
  id: { v: 3, kcv: 'kcv-linked', linked: true },
  totp: { v: 2, linked: true, kid: U.b64u(rand(16)), secrets: { iv: U.b64u(rand(12)), ct: U.b64u(rand(64)) } }
});
const seedLinked = async () => {
  const k = await keyring();
  const v = linkedVaults();
  put('keyring.vault', k.record);
  put('identity.vault', v.id);
  put('totp.vault', v.totp);
  put('tools.mine', { a: 1 });
};
const lastSnapshot = async (r, n) => (await r.messages()).slice(n).filter((m) => m.op === 'snapshot').pop();

check('code pairing: the joiner says keyring in its hello', async () => {
  reset();
  let p = await pairRoom(false);
  p.room.onPeerJoin('peer-1');
  const hello = await until(async () => (await p.messages()).find((m) => m.op === 'hello'));
  assert.equal(hello.keyring, 1, 'a keyring device says so');
  assert.equal(hello.initiator, false);
  await Sync.disconnect();
  reset({ capable: false });
  p = await pairRoom(false);
  p.room.onPeerJoin('peer-1');
  const plain = await until(async () => (await p.messages()).find((m) => m.op === 'hello'));
  assert.equal(plain.keyring, undefined, 'a browser that cannot run the one unlock sends the hello as before');
  await Sync.disconnect();
});

check('code pairing: an old joiner gets no wrap-less vaults in the first snapshot', async () => {
  reset();
  await seedLinked();
  let p = await pairRoom(true);
  await p.deliver({ op: 'hello', initiator: false });
  const snap = await until(async () => (await p.messages()).find((m) => m.op === 'snapshot'));
  assert.ok(snap.data.store['tools.mine'], 'other data is still sent');
  assert.equal(snap.data.store['identity.vault'], undefined, 'no wrap-less identity vault for an old joiner');
  assert.equal(snap.data.store['totp.vault'], undefined, 'no wrap-less totp vault for an old joiner');
  assert.equal(snap.meta['identity.vault'], undefined);
  await Sync.disconnect();
  reset();
  await seedLinked();
  p = await pairRoom(true);
  await p.deliver({ op: 'hello', initiator: false, keyring: 1 });
  const snap2 = await until(async () => (await p.messages()).find((m) => m.op === 'snapshot'));
  assert.equal(snap2.data.store['identity.vault'], raw('identity.vault'), 'a keyring joiner gets the identity vault');
  assert.equal(snap2.data.store['totp.vault'], raw('totp.vault'), 'a keyring joiner gets the totp vault');
  await Sync.disconnect();
});

check('after an old peer, later snapshots omit wrap-less vaults', async () => {
  reset();
  await seedLinked();
  const r = await joinRoom();
  r.room.onPeerJoin('peer-0');
  const first = await until(async () => lastSnapshot(r, 0));
  assert.equal(first.data.store['identity.vault'], raw('identity.vault'), 'before any old peer the snapshot is as before');
  await r.deliver(snapshotOf({ 'tools.theirs': JSON.stringify({ b: 2 }) }));
  const n = (await r.messages()).length;
  r.room.onPeerJoin('peer-2');
  const next = await until(async () => lastSnapshot(r, n));
  assert.ok(next.data.store['tools.mine'], 'other data is still sent');
  assert.equal(next.data.store['identity.vault'], undefined, 'no wrap-less identity vault after an old peer');
  assert.equal(next.data.store['totp.vault'], undefined, 'no wrap-less totp vault after an old peer');
  await Sync.disconnect();
});

check('a v1 snapshot marks an old peer', async () => {
  reset();
  await seedLinked();
  const r = await joinRoom();
  await r.deliver({ op: 'snapshot', data: { version: 1, exportedAt: new Date().toISOString(), store: { 'tools.theirs': JSON.stringify({ b: 2 }) }, legacy: {} } });
  const n = (await r.messages()).length;
  assert.ok(Store.set('identity', 'vault', { v: 3, kcv: 'kcv-linked', linked: true, n: 2 }));
  assert.ok(Store.set('tools', 'later', { c: 3 }));
  const after = await until(async () => {
    const all = (await r.messages()).slice(n);
    return all.find((m) => m.op === 'set' && m.ns === 'tools' && m.key === 'later') ? all : null;
  });
  assert.ok(!after.some((m) => m.op === 'set' && m.ns === 'identity'), 'no live wrap-less identity vault after a v1 snapshot');
  const m2 = (await r.messages()).length;
  r.room.onPeerJoin('peer-2');
  const next = await until(async () => lastSnapshot(r, m2));
  assert.equal(next.data.store['identity.vault'], undefined, 'the next snapshot omits it too');
  assert.equal(next.data.store['totp.vault'], undefined);
  await Sync.disconnect();
});

const OTHERS = 'mentria.keyring.others';
const stash = () => { try { return JSON.parse(ls.getItem(OTHERS)); } catch (_) { return 'unreadable'; } };
const stashKcvs = () => (Array.isArray(stash()) ? stash().map((r) => r && r.kcv) : stash());
const enNow = () => JSON.parse(readFileSync(join(repo, 'src/_data/i18n/en.json'), 'utf8'));

check('sync replace keeps this device\'s keyring on the side', async () => {
  reset();
  const k = await keyring();
  const mine = await withPasskey(k, k.record);
  put('keyring.vault', mine, Date.now() - 3600000);
  const other = await keyring('dev-z');
  answer = () => true;
  const r = await joinRoom();
  await r.deliver(Object.assign(snapshotOf({ 'keyring.vault': JSON.stringify(other.record) }, { keyring: 1 }), { meta: { 'keyring.vault': Date.now() } }));
  assert.equal(Store.get('keyring', 'vault').kcv, other.record.kcv, 'replaced');
  assert.deepEqual(stashKcvs(), [mine.kcv], 'this device\'s keyring is kept in mentria.keyring.others');
  assert.equal(stash()[0].wraps.prf.length, 1, 'kept whole');
  assert.equal(Store.exportAll().store[OTHERS.slice('mentria.store.'.length)], undefined);
  assert.ok(!Object.keys(Store.exportAll().store).some((s) => s.indexOf('others') >= 0) && !Object.keys(Store.exportAll().legacy).some((s) => s.indexOf('others') >= 0), 'never exported, synced or backed up');
  await Sync.disconnect();
});

check('sync keep keeps the other keyring on the side', async () => {
  reset();
  const k = await keyring();
  put('keyring.vault', k.record, Date.now() - 3600000);
  const before = raw('keyring.vault');
  const other = await keyring('dev-z');
  answer = () => false;
  const r = await joinRoom();
  await r.deliver(Object.assign(snapshotOf({ 'keyring.vault': JSON.stringify(other.record) }, { keyring: 1 }), { meta: { 'keyring.vault': Date.now() } }));
  assert.equal(Store.get('keyring', 'vault').kcv, k.record.kcv);
  assert.deepEqual(stashKcvs(), [other.record.kcv], 'Keep stashes the other device\'s keyring');
  const more = clone(other.record);
  more.services.notes = await U.sealService(other.rootKey, 'notes', rand(32), Date.now());
  await r.deliver({ op: 'set', ns: 'keyring', key: 'vault', value: more, mtime: Date.now() });
  assert.deepEqual(stashKcvs(), [other.record.kcv], 'one entry per kcv');
  assert.ok(stash()[0].services.notes, 'a later copy of the kept keyring merges into its entry');
  assert.equal(raw('keyring.vault').length > 0 && Store.get('keyring', 'vault').kcv, k.record.kcv);
  assert.deepEqual(JSON.parse(raw('keyring.vault')).wraps, JSON.parse(before).wraps);
  await Sync.disconnect();
});

check('an older different keyring kept without asking goes on the side', async () => {
  reset();
  const k = await keyring();
  put('keyring.vault', k.record, Date.now());
  const other = await keyring('dev-z');
  const r = await joinRoom();
  await r.deliver(Object.assign(snapshotOf({ 'keyring.vault': JSON.stringify(other.record) }, { keyring: 1 }), { meta: { 'keyring.vault': Date.now() - 3600000 } }));
  assert.deepEqual(asked, []);
  assert.equal(Store.get('keyring', 'vault').kcv, k.record.kcv);
  assert.deepEqual(stashKcvs(), [other.record.kcv]);
  await Sync.disconnect();
});

check('a v1 snapshot with a different keyring keeps it on the side', async () => {
  reset();
  const k = await keyring();
  put('keyring.vault', k.record);
  const other = await keyring('dev-z');
  const r = await joinRoom();
  await r.deliver({ op: 'snapshot', data: { version: 1, exportedAt: new Date().toISOString(), store: { 'keyring.vault': JSON.stringify(other.record) }, legacy: {} } });
  assert.equal(Store.get('keyring', 'vault').kcv, k.record.kcv);
  assert.deepEqual(stashKcvs(), [other.record.kcv]);
  await Sync.disconnect();
});

check('a different keyring that arrives after this device made one goes on the side', async () => {
  reset();
  const other = await keyring('dev-z');
  const k = await keyring();
  const r = await joinRoom();
  answer = async () => {
    ls.setItem('mentria.store.keyring.vault', JSON.stringify(k.record));
    return true;
  };
  put('tools.x', { a: 1 }, Date.now() - 3600000);
  const snap = snapshotOf({ 'keyring.vault': JSON.stringify(other.record), 'tools.x': JSON.stringify({ a: 2 }) }, { keyring: 1 });
  snap.meta['tools.x'] = Date.now();
  await r.deliver(snap);
  assert.equal(Store.get('keyring', 'vault').kcv, k.record.kcv, 'the keyring made during the prompt stays');
  assert.deepEqual(stashKcvs(), [other.record.kcv], 'the arriving one is kept on the side');
  await Sync.disconnect();
});

check('sync never replaces the keyring when it cannot keep this device\'s copy', async () => {
  reset();
  const k = await keyring();
  put('keyring.vault', k.record, Date.now() - 3600000);
  const before = raw('keyring.vault');
  const other = await keyring('dev-z');
  const set = ls.setItem.bind(ls);
  ls.setItem = (key, v) => { if (key === OTHERS) throw new Error('QuotaExceededError'); return set(key, v); };
  try {
    const r = await joinRoom();
    await r.deliver(Object.assign(snapshotOf({ 'keyring.vault': JSON.stringify(other.record) }, { keyring: 1 }), { meta: { 'keyring.vault': Date.now() } }));
    assert.equal(Store.get('keyring', 'vault').kcv, k.record.kcv, 'no stash, no replace');
    assert.deepEqual(Store.get('keyring', 'vault').wraps, JSON.parse(before).wraps);
  } finally {
    ls.setItem = set;
    await Sync.disconnect();
  }
});

check('undoing a sync keeps the keyring it took away on the side', async () => {
  reset();
  const k = await keyring();
  put('keyring.vault', k.record, Date.now() - 3600000);
  const other = await keyring('dev-z');
  const r = await joinRoom();
  await r.deliver(Object.assign(snapshotOf({ 'keyring.vault': JSON.stringify(other.record) }, { keyring: 1 }), { meta: { 'keyring.vault': Date.now() } }));
  await Sync.disconnect();
  assert.equal(Store.get('keyring', 'vault').kcv, other.record.kcv);
  ls.removeItem(OTHERS);
  const back = await Sync.restoreRescue();
  assert.ok(back && back.restored >= 1);
  assert.equal(Store.get('keyring', 'vault').kcv, k.record.kcv, 'the undo brings this device\'s keyring back');
  assert.deepEqual(stashKcvs(), [other.record.kcv], 'the replaced one is kept on the side');
});

check('restore replace and keep both keep the other keyring on the side', async () => {
  reset();
  const k = await keyring();
  put('keyring.vault', k.record);
  const other = await keyring('dev-z');
  const payload = (rec) => ({ version: 1, exportedAt: new Date().toISOString(), store: { 'keyring.vault': JSON.stringify(rec) }, legacy: {} });
  answer = (msg) => msg !== 'KEYRING?';
  await BK.applyRestore(payload(other.record), COPY);
  assert.equal(Store.get('keyring', 'vault').kcv, k.record.kcv);
  assert.deepEqual(stashKcvs(), [other.record.kcv], 'Keep stashes the backup\'s keyring');
  ls.removeItem(OTHERS);
  await BK.applyRestore(payload(other.record), Object.assign({}, COPY, { keyringVault: undefined }));
  assert.deepEqual(stashKcvs(), [other.record.kcv], 'a restore that cannot ask stashes it too');
  ls.removeItem(OTHERS);
  answer = () => true;
  await BK.applyRestore(payload(other.record), COPY);
  assert.equal(Store.get('keyring', 'vault').kcv, other.record.kcv, 'replaced');
  assert.deepEqual(stashKcvs(), [k.record.kcv], 'Replace stashes this device\'s keyring');
  const set = ls.setItem.bind(ls);
  const third = await keyring('dev-y');
  const now = raw('keyring.vault');
  ls.setItem = (key, v) => { if (key === OTHERS) throw new Error('QuotaExceededError'); return set(key, v); };
  try {
    await BK.applyRestore(payload(third.record), COPY);
  } finally {
    ls.setItem = set;
  }
  assert.equal(raw('keyring.vault'), now, 'no stash, no replace');
});

check('recording a peer keeps a keyring write that landed after its read', async () => {
  reset();
  const k = await keyring();
  put('keyring.vault', k.record, Date.now() - 3600000);
  const extra = await U.sealService(k.rootKey, 'notes', rand(32), Date.now());
  const get = Store.get;
  let seen = 0;
  Store.get = function (ns, key) {
    const v = get.call(this, ns, key);
    if (ns === 'keyring' && key === 'vault' && String(new Error().stack).includes('notePeer') && ++seen === 2) {
      const cur = JSON.parse(raw('keyring.vault'));
      cur.services.notes = extra;
      ls.setItem('mentria.store.keyring.vault', JSON.stringify(cur));
    }
    return v;
  };
  try {
    const r = await joinRoom();
    await r.deliver(snapshotOf({ 'keyring.vault': raw('keyring.vault') }, { app: 'beta', keyring: 1, device: { id: 'dev-b', name: 'Phone' } }));
    await Sync.disconnect();
  } finally {
    Store.get = get;
  }
  const rec = Store.get('keyring', 'vault');
  assert.ok(seen >= 2, 'harness: the peer write read the record');
  assert.ok(rec.devices['dev-b'], 'the peer is recorded');
  assert.ok(rec.services.notes && rec.services.notes.id === extra.id, 'the write that landed after the read is kept');
});

check('the fold-in line names no other device and the unused code key is gone', async () => {
  const OLD = {
    en: 'You have another one unlock from a different device — bring it in',
    es: 'Tienes otro desbloqueo único de otro dispositivo: inclúyelo aquí',
    fr: 'Vous avez un autre déverrouillage unique venant d\'un autre appareil : intégrez-le',
    ja: '別のデバイスのひとつのロック解除があります。こちらにまとめましょう',
    'pt-BR': 'Você tem outro desbloqueio único de outro dispositivo: traga-o para cá'
  };
  const all = Object.fromEntries(Object.keys(OLD).map((l) => [l, JSON.parse(readFileSync(join(repo, 'src/_data/i18n/' + l + '.json'), 'utf8')).unlock]));
  assert.equal(all.en.foldin_line, 'Some locked things use another one unlock kept on this device. Bring them in.');
  for (const [l, u] of Object.entries(all)) {
    assert.ok(typeof u.foldin_line === 'string' && u.foldin_line && u.foldin_line !== OLD[l], l + ' foldin_line reworded');
    if (l !== 'en') assert.notEqual(u.foldin_line, all.en.foldin_line, l + ' foldin_line translated');
    assert.ok(!('code_save_first' in u), l + ' has no code_save_first');
  }
});

check('both keyring prompts say what stops opening until it is brought back in', async () => {
  const en = enNow();
  for (const text of [en.about.sync_vault_keyring, en.common.restore_keyring_vault]) {
    assert.ok(/won['’]t open here until you bring that unlock back in from About/.test(text), text);
    assert.ok(/kept on this device/.test(text), text);
  }
  reset();
  const k = await keyring();
  put('keyring.vault', k.record, Date.now() - 3600000);
  const other = await keyring('dev-z');
  answer = () => false;
  const r = await joinRoom();
  await r.deliver(Object.assign(snapshotOf({ 'keyring.vault': JSON.stringify(other.record) }, { keyring: 1 }), { meta: { 'keyring.vault': Date.now() } }));
  assert.equal(asked.length, 1);
  assert.equal(asked[0], en.about.sync_vault_keyring, 'the built-in English prompt matches the copy');
  await Sync.disconnect();
});

const freshSync = async (query) => {
  const keep = globalThis.MentriaSync;
  await import(fileUrl('src/assets/js/mentria-sync.js') + '?' + query + '&n=' + Math.random().toString(36).slice(2));
  const mod = globalThis.MentriaSync;
  globalThis.MentriaSync = keep;
  assert.notEqual(mod, keep, 'harness: a fresh sync module');
  return mod;
};

async function undoScene() {
  reset();
  const A = await keyring('dev-a');
  const B = await keyring('dev-b');
  const bOld = clone(B.record);
  const bNew = clone(B.record);
  bNew.services.notes = await U.sealService(B.rootKey, 'notes', rand(32), Date.now());
  put('keyring.vault', bNew);
  ls.setItem(OTHERS, JSON.stringify([bOld]));
  ls.setItem('mentria-sync-rescue', JSON.stringify({ v: 2, at: Date.now(), entries: { 'keyring.vault': { raw: JSON.stringify(A.record), meta: null }, 'tools.undo': { raw: JSON.stringify({ u: 1 }), meta: null } } }));
  const hasNew = (rec) => !!(rec && rec.services && rec.services.notes && rec.services.notes.id === bNew.services.notes.id);
  return { A, B, bOld, bNew, hasNew };
}

check('undo sync on a fresh page keeps the newer copy of the keyring it takes away', async () => {
  const sc = await undoScene();
  const S2 = await freshSync('fresh=1');
  assert.ok(S2.rescueInfo(), 'harness: a rescue is waiting');
  const back = await S2.restoreRescue();
  assert.ok(back && back.restored >= 2, 'the undo ran');
  const cur = Store.get('keyring', 'vault');
  const kept = stash();
  assert.equal(cur.kcv, sc.A.record.kcv, 'the undo brings the rescued keyring back');
  assert.ok(kept.some((r) => r.kcv === sc.B.record.kcv && sc.hasNew(r)), 'the stash holds the newer copy of the keyring it took away');
  assert.equal(Store.get('tools', 'undo').u, 1);
});

check('undo sync without the core leaves the keyring alone when that keyring is already kept', async () => {
  const sc = await undoScene();
  const S2 = await freshSync('nocore=1');
  const back = await S2.restoreRescue();
  const cur = Store.get('keyring', 'vault');
  assert.ok(back, 'the undo ran');
  assert.equal(cur.kcv, sc.B.record.kcv, 'the keyring is left alone');
  assert.ok(sc.hasNew(cur), 'its newer content stays');
  assert.equal(Store.get('tools', 'undo').u, 1, 'the rest of the undo still applies');
});

check('undo sync merges a rescued copy of the same keyring', async () => {
  reset();
  const k = await keyring('dev-a');
  const older = await withPasskey(k, k.record);
  const newer = clone(k.record);
  newer.services.notes = await U.sealService(k.rootKey, 'notes', rand(32), Date.now());
  put('keyring.vault', newer);
  ls.setItem('mentria-sync-rescue', JSON.stringify({ v: 2, at: Date.now(), entries: { 'keyring.vault': { raw: JSON.stringify(older), meta: null } } }));
  const S2 = await freshSync('fresh=1');
  await S2.restoreRescue();
  const cur = Store.get('keyring', 'vault');
  assert.ok(cur.services.notes && cur.services.notes.id === newer.services.notes.id, 'what this device had stays');
  assert.equal(cur.wraps.prf.length, 1, 'what the rescued copy had comes back');
});

const QN_PAIR = 'mentria.qn.pair';
const qnHeld = () => { try { return JSON.parse(ls.getItem(QN_PAIR)); } catch (_) { return 'unreadable'; } };
const qnNew = () => ({ salt: b64(rand(32)), cred: b64(rand(16)) });
const qnShape = (p) => ({ salt: p.salt, credId: p.cred });
const qnSeed = (p, mtime) => {
  put('quick_notes.salt', p.salt, mtime);
  put('quick_notes.cred_id', p.cred, mtime);
  assert.equal(ls.getItem(QN_PAIR), null, 'harness: no device pair yet');
};
const qnRescue = (p, halves) => ls.setItem('mentria-sync-rescue', JSON.stringify({
  v: 2,
  at: Date.now(),
  entries: Object.fromEntries((halves || ['salt', 'cred_id']).map((h) => ['quick_notes.' + h, { raw: JSON.stringify(h === 'salt' ? p.salt : p.cred), meta: null }]))
}));
const qnPayload = (p, extra) => ({
  version: 1,
  exportedAt: new Date().toISOString(),
  store: Object.assign({ 'quick_notes.salt': JSON.stringify(p.salt), 'quick_notes.cred_id': JSON.stringify(p.cred) }, extra || {}),
  legacy: {}
});
const freshStore = async () => {
  const keep = globalThis.MentriaStore;
  const copy = join(tmp, 'store-' + Math.random().toString(36).slice(2) + '.cjs');
  writeFileSync(copy, readFileSync(join(repo, 'src/assets/js/mentria-store.js'), 'utf8'));
  await import(pathToFileURL(copy).href);
  const mod = globalThis.MentriaStore;
  globalThis.MentriaStore = keep;
  assert.notEqual(mod, keep, 'harness: a fresh store module');
  return mod;
};

check('a sync that replaces the notes salt and passkey keeps this device\'s pair', async () => {
  reset();
  const mine = qnNew();
  const other = qnNew();
  qnSeed(mine, Date.now() - 3600000);
  let r = await joinRoom();
  await r.deliver(snapshotOf({ 'quick_notes.salt': JSON.stringify(other.salt), 'quick_notes.cred_id': JSON.stringify(other.cred) }));
  assert.equal(Store.get('quick_notes', 'salt'), other.salt, 'the sync replaced the salt');
  assert.equal(Store.get('quick_notes', 'cred_id'), other.cred, 'the sync replaced the passkey id');
  assert.deepEqual(qnHeld(), qnShape(mine), 'this device\'s pair is kept on the device');
  const third = qnNew();
  await r.deliver({ op: 'set', ns: 'quick_notes', key: 'salt', value: third.salt, mtime: Date.now() });
  assert.equal(Store.get('quick_notes', 'salt'), third.salt);
  assert.deepEqual(qnHeld(), qnShape(mine), 'a later sync never moves it');
  await Sync.disconnect();
  reset();
  qnSeed(mine, Date.now() - 3600000);
  r = await joinRoom();
  await r.deliver({ op: 'set', ns: 'quick_notes', key: 'cred_id', value: other.cred, mtime: Date.now() });
  assert.equal(Store.get('quick_notes', 'cred_id'), other.cred);
  assert.deepEqual(qnHeld(), qnShape(mine), 'a live write keeps the pair it replaces');
  await Sync.disconnect();
  reset();
  qnSeed(mine, Date.now() - 3600000);
  r = await joinRoom();
  await r.deliver({ op: 'snapshot', data: qnPayload(other) });
  assert.equal(Store.get('quick_notes', 'salt'), other.salt, 'an older peer\'s snapshot replaced the salt');
  assert.deepEqual(qnHeld(), qnShape(mine), 'an older peer\'s snapshot keeps the pair it replaces');
  await Sync.disconnect();
});

check('an import that replaces or drops the notes pair keeps this device\'s pair', async () => {
  for (const mode of ['merge', 'replace']) {
    reset();
    const mine = qnNew();
    qnSeed(mine);
    put('quick_notes.blob', [{ id: 'n1', body: 'hello', updatedAt: 5 }]);
    const other = qnNew();
    Store.importAll(qnPayload(other, { 'quick_notes.blob': raw('quick_notes.blob') }), { mode });
    assert.equal(Store.get('quick_notes', 'salt'), other.salt, mode + ': the import replaced the salt');
    assert.deepEqual(qnHeld(), qnShape(mine), mode + ': this device\'s pair is kept');
  }
  reset();
  const mine = qnNew();
  qnSeed(mine);
  Store.importAll({ version: 1, exportedAt: new Date().toISOString(), store: { 'tools.x': JSON.stringify({ a: 1 }) }, legacy: {} }, { mode: 'replace' });
  assert.equal(Store.get('quick_notes', 'salt'), null, 'harness: the replace dropped the pair');
  assert.deepEqual(qnHeld(), qnShape(mine), 'a replace that drops the pair keeps it on the device');
  for (const mode of ['merge', 'replace']) {
    reset();
    const same = qnNew();
    qnSeed(same);
    Store.importAll(qnPayload(same, { 'tools.x': JSON.stringify({ a: 1 }) }), { mode });
    assert.equal(Store.get('tools', 'x').a, 1, 'harness: the import ran');
    assert.equal(ls.getItem(QN_PAIR), null, mode + ': an import that leaves the pair as it is writes no device pair');
  }
});

check('undoing a sync keeps the pair it brings back as this device\'s', async () => {
  reset();
  const mine = qnNew();
  const other = qnNew();
  qnSeed(other);
  qnRescue(mine);
  const S2 = await freshSync('fresh=1');
  const back = await S2.restoreRescue();
  assert.ok(back && back.restored === 2, 'the undo ran');
  assert.equal(Store.get('quick_notes', 'salt'), mine.salt, 'the undo brought the salt back');
  assert.deepEqual(qnHeld(), qnShape(mine), 'the device pair is the one the rescue kept');
});

check('a page load finds the pair a sync replaced before this release', async () => {
  reset();
  const mine = qnNew();
  const other = qnNew();
  ls.setItem('mentria.store.quick_notes.salt', JSON.stringify(other.salt));
  ls.setItem('mentria.store.quick_notes.cred_id', JSON.stringify(other.cred));
  qnRescue(mine);
  await freshStore();
  assert.deepEqual(qnHeld(), qnShape(mine), 'the device pair comes from the rescue');
  reset();
  const shared = qnNew();
  ls.setItem('mentria.store.quick_notes.salt', JSON.stringify(shared.salt));
  ls.setItem('mentria.store.quick_notes.cred_id', JSON.stringify(other.cred));
  qnRescue(mine, ['cred_id']);
  await freshStore();
  assert.deepEqual(qnHeld(), { salt: shared.salt, credId: mine.cred }, 'a rescue of the passkey id alone pairs it with the salt it kept');
  reset();
  ls.setItem('mentria.store.quick_notes.salt', JSON.stringify(other.salt));
  ls.setItem('mentria.store.quick_notes.cred_id', JSON.stringify(other.cred));
  ls.setItem('mentria-sync-rescue', JSON.stringify({ v: 2, at: Date.now(), entries: { 'tools.undo': { raw: JSON.stringify({ u: 1 }), meta: null } } }));
  await freshStore();
  assert.equal(ls.getItem(QN_PAIR), null, 'a rescue without the pair writes no device pair');
  reset();
  ls.setItem('mentria.store.quick_notes.salt', JSON.stringify(other.salt));
  ls.setItem('mentria.store.quick_notes.cred_id', JSON.stringify(other.cred));
  await freshStore();
  assert.equal(ls.getItem(QN_PAIR), null, 'a page load alone writes no device pair');
  reset();
  const kept = JSON.stringify(qnShape(other));
  ls.setItem(QN_PAIR, kept);
  qnRescue(mine);
  await freshStore();
  assert.equal(ls.getItem(QN_PAIR), kept, 'a stored device pair is never replaced');
});

check('keeping the notes pair leaves every other write alone', async () => {
  reset();
  const before = new Map(ls.map);
  put('tools.x', { a: 1 });
  put('quick_notes.blob', [{ id: 'n1', body: 'hello', updatedAt: 5 }]);
  put('quick_notes.deleted', { n0: 1 });
  Store.importAll({ version: 1, exportedAt: new Date().toISOString(), store: { 'tools.y': JSON.stringify({ b: 2 }) }, legacy: {} }, { mode: 'merge' });
  const added = [...ls.map.keys()].filter((k) => !before.has(k)).sort();
  assert.deepEqual(added, ['mentria.meta.quick_notes.blob', 'mentria.meta.quick_notes.deleted', 'mentria.meta.tools.x', 'mentria.meta.tools.y', 'mentria.store.quick_notes.blob', 'mentria.store.quick_notes.deleted', 'mentria.store.tools.x', 'mentria.store.tools.y'], 'other writes add only their own keys');
  reset();
  const mine = qnNew();
  qnSeed(mine);
  put('quick_notes.salt', mine.salt);
  assert.equal(ls.getItem(QN_PAIR), null, 'writing the same salt keeps no pair');
  reset();
  put('quick_notes.salt', mine.salt);
  put('quick_notes.salt', qnNew().salt);
  assert.equal(ls.getItem(QN_PAIR), null, 'a salt with no passkey id is not a pair');
  reset();
  const legacy = qnNew();
  ls.setItem('mentria-qn-salt', legacy.salt);
  ls.setItem('mentria-qn-cred', legacy.cred);
  put('quick_notes.salt', mine.salt);
  assert.deepEqual(qnHeld(), qnShape(legacy), 'the older raw keys count as this device\'s pair');
});

let failed = 0;
for (const [name, fn] of checks) {
  try {
    await fn();
    console.log('PASS ' + name);
  } catch (e) {
    failed++;
    console.log('FAIL ' + name);
    console.log('     ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n     ') : e));
    try { await Sync.disconnect(); } catch (_) {}
  }
}
console.log(checks.length - failed + '/' + checks.length + ' passed');
process.exit(failed ? 1 : 0);
