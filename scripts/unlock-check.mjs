import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const U = await import(pathToFileURL(resolve(here, '../src/assets/js/mentria-unlock-core.js')).href);

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

const te = new TextEncoder();
const S = crypto.subtle;
const DAY = 86400000;
const NOW = Date.UTC(2026, 9, 21, 12, 0, 0);
const ITER = 2000;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const iso = (ms) => new Date(ms).toISOString();
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
const clone = (v) => JSON.parse(JSON.stringify(v));
const tamper = (box, field) => {
  const b = U.unb64u(box[field]);
  b[0] ^= 1;
  return Object.assign({}, box, { [field]: U.b64u(b) });
};
const b32decode = (s) => {
  const bits = Array.from(s, (c) => B32.indexOf(c).toString(2).padStart(5, '0')).join('');
  const out = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return new Uint8Array(out);
};
const hkdfAes = async (ikm, salt, info) => S.deriveKey(
  { name: 'HKDF', hash: 'SHA-256', salt, info: te.encode(info) },
  await S.importKey('raw', ikm, 'HKDF', false, ['deriveKey']),
  { name: 'AES-GCM', length: 256 }, false, ['decrypt']
);
const hkdfBits = async (ikm, salt, info, bits) => new Uint8Array(await S.deriveBits(
  { name: 'HKDF', hash: 'SHA-256', salt, info: te.encode(info) },
  await S.importKey('raw', ikm, 'HKDF', false, ['deriveBits']),
  bits
));
const aesOpen = async (key, box, aad) => new Uint8Array(await S.decrypt(
  { name: 'AES-GCM', iv: U.unb64u(box.iv), additionalData: te.encode(aad) }, key, U.unb64u(box.ct)
));
const deviceKey = () => S.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);

async function fresh(now = NOW) {
  const code = U.newRecoveryCode();
  const { record, rootBytes } = await U.createRecord({ code, deviceId: 'dev-a', deviceName: 'Laptop', app: 'v2026.10.21', now });
  return { code, record, rootBytes, rootKey: await U.rootKeyFrom(rootBytes) };
}

async function linked(service, linkedAt) {
  const f = await fresh();
  f.record.services[service] = await U.sealService(f.rootKey, service, rand(32), linkedAt);
  f.record.codeConfirmed = iso(linkedAt);
  return f;
}

check('constants', () => {
  assert.deepEqual(U.SERVICES, ['identity', 'totp', 'notes', 'finance']);
  assert.equal(U.GRACE_MS, 60000);
  assert.equal(U.RETIRE_AFTER_MS, 30 * 86400000);
});

check('base64url matches Node and has no padding', () => {
  for (let n = 0; n < 40; n++) {
    const b = rand(n);
    const s = U.b64u(b);
    assert.equal(s, Buffer.from(b).toString('base64url'));
    assert.ok(!/[=+/]/.test(s));
    assert.deepEqual(U.unb64u(s), b);
  }
  assert.equal(U.b64u(rand(16).buffer).length, 22);
});

check('code roundtrip b32', async () => {
  const code = U.newRecoveryCode();
  assert.match(code, /^[A-Z2-7]{4}(?:-[A-Z2-7]{4}){7}$/);
  assert.equal(code.length, 39);
  assert.equal(code.split('-').length - 1, 7);
  assert.notEqual(U.newRecoveryCode(), code);
  assert.deepEqual(U.normalizeCode(code), { kind: 'b32', text: code.replace(/-/g, '') });
  assert.equal(U.formatCode(U.normalizeCode(code.toLowerCase().replace(/-/g, ''))), code);
  const root = rand(32);
  const wrap = await U.wrapWithCode(root, code);
  assert.deepEqual(Object.keys(wrap).sort(), ['created', 'ct', 'fmt', 'iv', 'salt']);
  assert.equal(wrap.fmt, 'b32');
  assert.equal(U.unb64u(wrap.salt).length, 16);
  assert.equal(U.unb64u(wrap.iv).length, 12);
  assert.equal(wrap.created, iso(Date.parse(wrap.created)));
  assert.deepEqual(await U.openWithCode(wrap, code), root);
  assert.deepEqual(await U.openWithCode(wrap, code.toLowerCase()), root);
  assert.deepEqual(await U.openWithCode(wrap, ' ' + code.toLowerCase().replace(/-/g, ' ') + ' '), root);
  assert.deepEqual(await U.openWithCode(wrap, code.replace(/-/g, '')), root);
});

check('code roundtrip c20', async () => {
  const code = 'abcde-fghjk-mnpqr-stuvw';
  const norm = U.normalizeCode(code);
  assert.deepEqual(norm, { kind: 'c20', text: 'abcdefghjkmnpqrstuvw' });
  assert.deepEqual(U.normalizeCode('ABCDE FGHJK MNPQR STUVW'), norm);
  assert.equal(U.formatCode(norm), code);
  assert.deepEqual(U.normalizeCode('abcde\u2011fghjk\u2013mnpqr\u2212stuvw'), norm);
  const root = rand(32);
  const wrap = await U.wrapWithCode(root, code);
  assert.equal(wrap.fmt, 'c20');
  assert.deepEqual(await U.openWithCode(wrap, code), root);
  assert.deepEqual(await U.openWithCode(wrap, 'ABCDEFGHJKMNPQRSTUVW'), root);
});

check('wrong code throws bad-code', async () => {
  const root = rand(32);
  const code = U.newRecoveryCode();
  const wrap = await U.wrapWithCode(root, code);
  await assert.rejects(U.openWithCode(wrap, U.newRecoveryCode()), { message: 'bad-code' });
  await assert.rejects(U.openWithCode(wrap, 'abcde-fghjk-mnpqr-stuvw'), { message: 'bad-code' });
  await assert.rejects(U.openWithCode(wrap, 'not a code'), { message: 'bad-code' });
  await assert.rejects(U.openWithCode(tamper(wrap, 'ct'), code), { message: 'bad-code' });
  await assert.rejects(U.openWithCode(tamper(wrap, 'salt'), code), { message: 'bad-code' });
  await assert.rejects(U.openWithCode({}, code), { message: 'bad-code' });
  await assert.rejects(U.wrapWithCode(root, 'short'), { message: 'bad-code' });
});

check('normalizeCode rejects 31 and 21 symbol inputs', () => {
  const b = U.newRecoveryCode().replace(/-/g, '');
  assert.equal(U.normalizeCode(b.slice(0, 31)), null);
  assert.equal(U.normalizeCode('abcdefghjkmnpqrstuvwx'), null);
  assert.equal(U.normalizeCode(b + 'A'), null);
  assert.equal(U.normalizeCode('abcdefghjkmnpqrstuv'), null);
  assert.equal(U.normalizeCode('abcde-fghjk-mnpqr-stuvi'), null);
  assert.equal(U.normalizeCode('abcde-fghjk-mnpqr-stuv0'), null);
  assert.equal(U.normalizeCode(b.slice(0, 31) + '1'), null);
  assert.equal(U.normalizeCode(b.slice(0, 31) + '.'), null);
  assert.equal(U.normalizeCode(b.slice(0, 31) + '\u017f'), null);
  assert.equal(U.normalizeCode('abcde-fghj\u212a-mnpqr-stuvw'), null);
  assert.equal(U.normalizeCode(''), null);
  assert.equal(U.normalizeCode(null), null);
  assert.equal(U.normalizeCode(undefined), null);
  assert.equal(U.normalizeCode(12345), null);
  assert.deepEqual(U.normalizeCode(b.toLowerCase()), { kind: 'b32', text: b });
  assert.deepEqual(U.normalizeCode('abcdefghjkmnpqrstuvwxyz234567abc'), { kind: 'b32', text: 'ABCDEFGHJKMNPQRSTUVWXYZ234567ABC' });
});

check('passphrase roundtrip and NFC', async () => {
  const root = rand(32);
  const composed = 'mon caf\u00e9 du matin';
  const decomposed = 'mon cafe\u0301 du matin';
  assert.notEqual(composed, decomposed);
  const wrap = await U.wrapWithPassphrase(root, composed, ITER);
  assert.deepEqual(Object.keys(wrap).sort(), ['created', 'ct', 'iter', 'iv', 'salt']);
  assert.equal(wrap.iter, ITER);
  assert.equal(U.unb64u(wrap.salt).length, 32);
  assert.equal(U.unb64u(wrap.iv).length, 12);
  assert.deepEqual(await U.openWithPassphrase(wrap, composed), root);
  assert.deepEqual(await U.openWithPassphrase(wrap, decomposed), root);
  const other = await U.wrapWithPassphrase(root, decomposed, ITER);
  assert.deepEqual(await U.openWithPassphrase(other, composed), root);
  await assert.rejects(U.openWithPassphrase(wrap, 'mon cafe du matin'), { message: 'bad-pass' });
  await assert.rejects(U.openWithPassphrase(tamper(wrap, 'ct'), composed), { message: 'bad-pass' });
});

check('short passphrase throws weak-pass', async () => {
  const root = rand(32);
  await assert.rejects(U.wrapWithPassphrase(root, 'elevenchars', ITER), { message: 'weak-pass' });
  await assert.rejects(U.wrapWithPassphrase(root, 'cafe\u0301cafe\u0301ab', ITER), { message: 'weak-pass' });
  await assert.rejects(U.wrapWithPassphrase(root, '', ITER), { message: 'weak-pass' });
  await assert.rejects(U.wrapWithPassphrase(root, undefined, ITER), { message: 'weak-pass' });
  const ok = await U.wrapWithPassphrase(root, 'twelve chars', ITER);
  assert.deepEqual(await U.openWithPassphrase(ok, 'twelve chars'), root);
});

check('passphrase default is 600000 iterations', async () => {
  const wrap = await U.wrapWithPassphrase(rand(32), 'a long passphrase');
  assert.equal(wrap.iter, 600000);
});

check('openWithPrf wrong output throws bad-prf', async () => {
  const root = rand(32);
  const prf = rand(32);
  const salt = U.b64u(rand(32));
  const wrap = await U.wrapWithPrf(root, prf, { id: 'cred-1', salt, label: 'Laptop' });
  assert.deepEqual(Object.keys(wrap).sort(), ['created', 'ct', 'hkdf', 'id', 'iv', 'label', 'salt']);
  assert.equal(wrap.id, 'cred-1');
  assert.equal(wrap.salt, salt);
  assert.equal(wrap.label, 'Laptop');
  assert.equal(U.unb64u(wrap.hkdf).length, 32);
  assert.deepEqual(await U.openWithPrf(wrap, prf), root);
  assert.deepEqual(await U.openWithPrf(wrap, prf.buffer), root);
  await assert.rejects(U.openWithPrf(wrap, rand(32)), { message: 'bad-prf' });
  await assert.rejects(U.openWithPrf(tamper(wrap, 'hkdf'), prf), { message: 'bad-prf' });
  await assert.rejects(U.openWithPrf(wrap, undefined), { message: 'bad-prf' });
  const rawId = rand(16);
  const fromBytes = await U.wrapWithPrf(root, prf.buffer, { id: rawId.buffer, salt: rand(32), label: 'Phone' });
  assert.equal(fromBytes.id, U.b64u(rawId));
  assert.equal(U.unb64u(fromBytes.salt).length, 32);
  assert.deepEqual(await U.openWithPrf(fromBytes, prf), root);
});

check('device wrap roundtrip and wrong key throws bad-device', async () => {
  const root = rand(32);
  const key = await deviceKey();
  const box = await U.wrapWithDeviceKey(root, key);
  assert.deepEqual(Object.keys(box).sort(), ['created', 'ct', 'iv']);
  assert.deepEqual(await U.openWithDeviceKey(box, key), root);
  await assert.rejects(U.openWithDeviceKey(box, await deviceKey()), { message: 'bad-device' });
  await assert.rejects(U.openWithDeviceKey(tamper(box, 'ct'), key), { message: 'bad-device' });
});

check('service seal/open per name', async () => {
  const root = rand(32);
  const rootKey = await U.rootKeyFrom(root);
  assert.equal(rootKey.extractable, false);
  assert.equal(rootKey.algorithm.name, 'HKDF');
  assert.deepEqual([...rootKey.usages].sort(), ['deriveBits', 'deriveKey']);
  await assert.rejects(S.exportKey('raw', rootKey));
  const secret = rand(32);
  const entry = await U.sealService(rootKey, 'identity', secret, NOW);
  assert.deepEqual(Object.keys(entry).sort(), ['ct', 'iv', 'linked']);
  assert.equal(entry.linked, iso(NOW));
  assert.deepEqual(await U.openService(rootKey, 'identity', entry), secret);
  await assert.rejects(U.openService(rootKey, 'totp', entry), { message: 'bad-service' });
  await assert.rejects(U.openService(await U.rootKeyFrom(rand(32)), 'identity', entry), { message: 'bad-service' });
  await assert.rejects(U.openService(rootKey, 'identity', tamper(entry, 'iv')), { message: 'bad-service' });
  for (const name of U.SERVICES) {
    const s = rand(name === 'totp' ? 20 : 32);
    assert.deepEqual(await U.openService(rootKey, name, await U.sealService(rootKey, name, s, NOW)), s);
  }
  await assert.rejects(U.sealService(rootKey, 'backup', secret, NOW), { message: 'bad-service' });
  await assert.rejects(U.openService(rootKey, 'backup', entry), { message: 'bad-service' });
});

check('backup key from entry equals key from code', async () => {
  const rootKey = await U.rootKeyFrom(rand(32));
  for (const code of [U.newRecoveryCode(), 'abcde-fghjk-mnpqr-stuvw']) {
    const entry = await U.makeBackupEntry(rootKey, code);
    assert.deepEqual(Object.keys(entry).sort(), ['ct', 'iv', 'salt']);
    const fromEntry = await U.backupKeyFromEntry(rootKey, entry);
    assert.ok(fromEntry instanceof Uint8Array);
    assert.equal(fromEntry.length, 32);
    assert.deepEqual(await U.backupKeyFromCode(code, entry.salt), fromEntry);
    assert.deepEqual(await U.backupKeyFromCode(code.toUpperCase().replace(/-/g, ' '), U.unb64u(entry.salt)), fromEntry);
  }
});

check('backup key from a wrong code differs', async () => {
  const rootKey = await U.rootKeyFrom(rand(32));
  const code = U.newRecoveryCode();
  const entry = await U.makeBackupEntry(rootKey, code);
  const right = await U.backupKeyFromEntry(rootKey, entry);
  const wrong = await U.backupKeyFromCode(U.newRecoveryCode(), entry.salt);
  assert.equal(wrong.length, 32);
  assert.notDeepEqual(wrong, right);
  assert.notDeepEqual(await U.backupKeyFromEntry(rootKey, await U.makeBackupEntry(rootKey, code)), right);
  await assert.rejects(U.backupKeyFromCode('nope', entry.salt), { message: 'bad-code' });
  await assert.rejects(U.backupKeyFromEntry(await U.rootKeyFrom(rand(32)), entry), { message: 'bad-backup' });
});

check('createRecord shape', async () => {
  const code = U.newRecoveryCode();
  const { record, rootBytes } = await U.createRecord({ code, deviceId: 'dev-a', deviceName: 'Laptop', app: 'v2026.10.21', now: NOW });
  assert.ok(rootBytes instanceof Uint8Array);
  assert.equal(rootBytes.length, 32);
  assert.deepEqual(Object.keys(record).sort(), ['backup', 'changed', 'codeConfirmed', 'created', 'devices', 'id', 'kcv', 'retired', 'services', 'v', 'wraps']);
  assert.equal(record.v, 1);
  assert.equal(U.unb64u(record.id).length, 16);
  assert.equal(record.kcv, await U.kcvOf(rootBytes));
  assert.equal(record.kcv.length, 22);
  assert.equal(record.created, iso(NOW));
  assert.equal(record.changed, iso(NOW));
  assert.equal(record.codeConfirmed, null);
  assert.deepEqual(Object.keys(record.wraps).sort(), ['prf', 'recovery']);
  assert.deepEqual(record.wraps.prf, []);
  assert.equal(record.wraps.recovery.fmt, 'b32');
  assert.equal(record.wraps.recovery.created, iso(NOW));
  assert.deepEqual(await U.openWithCode(record.wraps.recovery, code), rootBytes);
  const rootKey = await U.rootKeyFrom(rootBytes);
  assert.deepEqual(await U.backupKeyFromEntry(rootKey, record.backup), await U.backupKeyFromCode(code, record.backup.salt));
  assert.deepEqual(record.services, {});
  assert.deepEqual(record.retired, {});
  assert.deepEqual(record.devices, { 'dev-a': { name: 'Laptop', lastSeen: iso(NOW), app: 'v2026.10.21', keyring: 1 } });
  assert.ok(U.isRecord(record));
  assert.ok(U.isRecord(clone(record)));
  assert.ok(!JSON.stringify(record).includes(U.b64u(rootBytes)));
  const again = await U.createRecord({ code, deviceId: 'dev-a', deviceName: 'Laptop', app: 'v2026.10.21', now: NOW });
  assert.notEqual(again.record.kcv, record.kcv);
  assert.notEqual(again.record.id, record.id);
  const c20 = await U.createRecord({ code: 'abcde-fghjk-mnpqr-stuvw', deviceId: 'dev-b', now: NOW });
  assert.equal(c20.record.wraps.recovery.fmt, 'c20');
  await assert.rejects(U.createRecord({ code: 'nope', deviceId: 'dev-a', now: NOW }), { message: 'bad-code' });
});

check('isRecord rejects other values', async () => {
  const { record } = await fresh();
  const without = (path) => {
    const r = clone(record);
    const keys = path.split('.');
    const last = keys.pop();
    delete keys.reduce((o, k) => o[k], r)[last];
    return r;
  };
  const bad = [null, undefined, 1, 'x', [], {}, Object.assign(clone(record), { v: 2 }), Object.assign(clone(record), { kcv: 5 }),
    without('id'), without('kcv'), without('wraps'), without('wraps.recovery'), without('wraps.prf'), without('services'), without('devices'),
    Object.assign(clone(record), { wraps: Object.assign(clone(record.wraps), { prf: {} }) })];
  for (const v of bad) assert.equal(U.isRecord(v), false, JSON.stringify(v));
  assert.ok(U.isRecord(without('retired')));
});

check('verifyRoot wrong key throws wrong-key', async () => {
  const { record, rootBytes } = await fresh();
  assert.equal(await U.verifyRoot(record, rootBytes), undefined);
  await assert.rejects(U.verifyRoot(record, rand(32)), { message: 'wrong-key' });
});

check('derivations match the spec', async () => {
  const root = rand(32);
  const kcv = createHash('sha256').update(Buffer.concat([Buffer.from('mentria-keyring-kcv-v1'), Buffer.from(root)])).digest().subarray(0, 16).toString('base64url');
  assert.equal(await U.kcvOf(root), kcv);
  const code = U.newRecoveryCode();
  const codeBytes = b32decode(code.replace(/-/g, ''));
  assert.equal(codeBytes.length, 20);
  const rw = await U.wrapWithCode(root, code);
  assert.deepEqual(await aesOpen(await hkdfAes(codeBytes, U.unb64u(rw.salt), 'mentria-keyring-recovery-v1'), rw, 'mentria-keyring|wrap|recovery'), root);
  const cw = await U.wrapWithCode(root, 'ABCDE-FGHJK-MNPQR-STUVW');
  assert.deepEqual(await aesOpen(await hkdfAes(te.encode('abcdefghjkmnpqrstuvw'), U.unb64u(cw.salt), 'mentria-keyring-recovery-v1'), cw, 'mentria-keyring|wrap|recovery'), root);
  const pass = 'cafe\u0301 au lait, sans sucre';
  const pw = await U.wrapWithPassphrase(root, pass, ITER);
  const pbase = await S.importKey('raw', te.encode(pass.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  const pkey = await S.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: U.unb64u(pw.salt), iterations: ITER }, pbase, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  assert.deepEqual(await aesOpen(pkey, pw, 'mentria-keyring|wrap|pass'), root);
  const prf = rand(32);
  const fw = await U.wrapWithPrf(root, prf, { id: 'cred', salt: U.b64u(rand(32)), label: '' });
  assert.deepEqual(await aesOpen(await hkdfAes(prf, U.unb64u(fw.hkdf), 'mentria-keyring-prf-v1'), fw, 'mentria-keyring|wrap|prf'), root);
  const dkey = await deviceKey();
  assert.deepEqual(await aesOpen(dkey, await U.wrapWithDeviceKey(root, dkey), 'mentria-keyring|wrap|device'), root);
  const rootKey = await U.rootKeyFrom(root);
  const salt = te.encode('mentria-keyring-v1');
  for (const name of U.SERVICES) {
    const secret = rand(32);
    const entry = await U.sealService(rootKey, name, secret, NOW);
    assert.deepEqual(await aesOpen(await hkdfAes(root, salt, 'svc:' + name), entry, 'mentria-keyring|svc|' + name), secret);
  }
  const be = await U.makeBackupEntry(rootKey, code);
  const fileKey = await hkdfBits(codeBytes, U.unb64u(be.salt), 'mentria-keyring-backup-v1', 256);
  assert.deepEqual(await aesOpen(await hkdfAes(root, salt, 'svc:backup'), be, 'mentria-keyring|backup'), fileKey);
  assert.deepEqual(await U.backupKeyFromCode(code, be.salt), fileKey);
});

check('merge same kcv unions passkeys and devices', async () => {
  const { record, rootBytes } = await fresh();
  const a = clone(record);
  const b = clone(record);
  a.wraps.prf.push(Object.assign(await U.wrapWithPrf(rootBytes, rand(32), { id: 'cred-a', salt: U.b64u(rand(32)), label: 'Laptop' }), { created: iso(NOW + 1000) }));
  b.wraps.prf.push(Object.assign(await U.wrapWithPrf(rootBytes, rand(32), { id: 'cred-b', salt: U.b64u(rand(32)), label: 'Phone' }), { created: iso(NOW + 2000) }));
  const a2 = U.touchDevice(a, 'dev-a', { now: NOW + 5000 });
  const b2 = U.touchDevice(b, 'dev-b', { name: 'Phone', app: 'v2026.10.21', keyring: 1, now: NOW + 3000 });
  assert.deepEqual(a2.devices['dev-a'], { name: 'Laptop', lastSeen: iso(NOW + 5000), app: 'v2026.10.21', keyring: 1 });
  const m = U.mergeRecords(a2, b2);
  assert.ok(U.isRecord(m));
  assert.equal(m.kcv, record.kcv);
  assert.equal(m.id, record.id);
  assert.equal(m.created, record.created);
  assert.deepEqual(m.wraps.prf.map((p) => p.id), ['cred-a', 'cred-b']);
  assert.deepEqual(Object.keys(m.devices).sort(), ['dev-a', 'dev-b']);
  assert.equal(m.devices['dev-a'].lastSeen, iso(NOW + 5000));
  assert.equal(m.devices['dev-b'].name, 'Phone');
  assert.equal(m.changed, iso(NOW + 5000));
  assert.deepEqual(U.mergeRecords(b2, a2), m);
  assert.equal(JSON.stringify(U.mergeRecords(b2, a2)), JSON.stringify(m));
  assert.deepEqual(U.mergeRecords(m, m), m);
  assert.equal(a2.wraps.prf.length, 1);
  assert.equal(b2.wraps.prf.length, 1);
  const renamed = U.touchDevice(b2, 'dev-a', { name: 'Work laptop', now: NOW + 9000 });
  assert.equal(U.mergeRecords(a2, renamed).devices['dev-a'].name, 'Work laptop');
  assert.equal(U.mergeRecords(renamed, a2).devices['dev-a'].name, 'Work laptop');
});

check('merge removed passkey wins over older live copy', async () => {
  const { record, rootBytes } = await fresh();
  const live = Object.assign(await U.wrapWithPrf(rootBytes, rand(32), { id: 'cred-a', salt: U.b64u(rand(32)), label: 'Laptop' }), { created: iso(NOW + 1000) });
  const a = clone(record);
  a.wraps.prf = [live];
  const b = clone(record);
  b.wraps.prf = [Object.assign(clone(live), { removed: iso(NOW + 2000) })];
  for (const m of [U.mergeRecords(a, b), U.mergeRecords(b, a)]) {
    assert.equal(m.wraps.prf.length, 1);
    assert.equal(m.wraps.prf[0].removed, iso(NOW + 2000));
  }
  const c = clone(record);
  c.wraps.prf = [Object.assign(clone(live), { created: iso(NOW + 3000) })];
  for (const m of [U.mergeRecords(b, c), U.mergeRecords(c, b)]) {
    assert.equal(m.wraps.prf.length, 1);
    assert.equal(m.wraps.prf[0].removed, undefined);
    assert.equal(m.wraps.prf[0].created, iso(NOW + 3000));
  }
});

check('merge different kcv returns null', async () => {
  const one = await fresh();
  const two = await fresh();
  assert.equal(U.mergeRecords(one.record, two.record), null);
  assert.equal(U.mergeRecords(two.record, one.record), null);
  assert.deepEqual(U.mergeRecords(one.record, null), one.record);
  assert.deepEqual(U.mergeRecords(null, one.record), one.record);
  assert.equal(U.mergeRecords(null, { v: 1 }), null);
});

check('merge keeps the newest wraps and services and the earliest dates', async () => {
  const { record, rootBytes, rootKey } = await fresh();
  const a = clone(record);
  const b = clone(record);
  const code2 = U.newRecoveryCode();
  b.wraps.recovery = Object.assign(await U.wrapWithCode(rootBytes, code2), { created: iso(NOW + DAY) });
  b.backup = await U.makeBackupEntry(rootKey, code2);
  a.wraps.pass = Object.assign(await U.wrapWithPassphrase(rootBytes, 'first passphrase', ITER), { created: iso(NOW + 1000) });
  b.wraps.pass = Object.assign(clone(a.wraps.pass), { removed: iso(NOW + 2000) });
  a.services.identity = await U.sealService(rootKey, 'identity', rand(32), NOW + 5000);
  b.services.identity = await U.sealService(rootKey, 'identity', rand(32), NOW + 4000);
  b.services.totp = await U.sealService(rootKey, 'totp', rand(20), NOW + 4000);
  a.retired = { identity: iso(NOW + 9000) };
  b.retired = { identity: iso(NOW + 8000), totp: iso(NOW + 7000) };
  a.codeConfirmed = iso(NOW + 600);
  b.codeConfirmed = null;
  a.changed = iso(NOW + 100);
  b.changed = iso(NOW + 200);
  for (const m of [U.mergeRecords(a, b), U.mergeRecords(b, a)]) {
    assert.deepEqual(m.wraps.recovery, b.wraps.recovery);
    assert.deepEqual(m.backup, b.backup);
    assert.deepEqual(await U.openWithCode(m.wraps.recovery, code2), rootBytes);
    assert.deepEqual(await U.backupKeyFromEntry(rootKey, m.backup), await U.backupKeyFromCode(code2, m.backup.salt));
    assert.equal(m.wraps.pass.removed, iso(NOW + 2000));
    assert.deepEqual(m.services.identity, a.services.identity);
    assert.deepEqual(m.services.totp, b.services.totp);
    assert.deepEqual(m.retired, { identity: iso(NOW + 8000), totp: iso(NOW + 7000) });
    assert.equal(m.codeConfirmed, iso(NOW + 600));
    assert.equal(m.changed, iso(NOW + 200));
  }
  const c = clone(record);
  c.wraps.pass = Object.assign(await U.wrapWithPassphrase(rootBytes, 'second passphrase', ITER), { created: iso(NOW + 3000) });
  c.codeConfirmed = iso(NOW + 500);
  for (const m of [U.mergeRecords(b, c), U.mergeRecords(c, b)]) {
    assert.deepEqual(m.wraps.pass, c.wraps.pass);
    assert.equal(m.codeConfirmed, iso(NOW + 500));
  }
  assert.equal(U.mergeRecords(a, c).codeConfirmed, iso(NOW + 500));
  assert.equal(U.mergeRecords(record, clone(record)).wraps.pass, undefined);
});

check('retirement blockers in order', async () => {
  const { record } = await fresh();
  assert.deepEqual(U.retirementStatus(record, 'identity', { now: NOW, notesConverted: false }), { ready: false, blockers: ['not-linked', 'code-unconfirmed'] });
  const old = (await linked('identity', NOW - 31 * DAY)).record;
  assert.deepEqual(U.retirementStatus(old, 'identity', { now: NOW, notesConverted: false }), { ready: true, blockers: [] });
  const edge = (await linked('identity', NOW - U.RETIRE_AFTER_MS)).record;
  assert.deepEqual(U.retirementStatus(edge, 'identity', { now: NOW }), { ready: true, blockers: [] });
  const recent = (await linked('identity', NOW - 29 * DAY)).record;
  assert.deepEqual(U.retirementStatus(recent, 'identity', { now: NOW }), { ready: false, blockers: ['too-recent'] });
  const garbled = clone(old);
  garbled.services.identity.linked = 'not a date';
  assert.deepEqual(U.retirementStatus(garbled, 'identity', { now: NOW }), { ready: false, blockers: ['too-recent'] });
  const done = clone(old);
  done.retired.identity = iso(NOW - DAY);
  assert.deepEqual(U.retirementStatus(done, 'identity', { now: NOW }), { ready: false, blockers: ['already-retired'] });
  const all = (await linked('notes', NOW - DAY)).record;
  all.codeConfirmed = null;
  all.retired.notes = iso(NOW);
  const allOld = U.touchDevice(all, 'old-phone', { name: 'Phone', app: 'v2026.10.07', keyring: 0, now: NOW - DAY });
  assert.deepEqual(U.retirementStatus(allOld, 'notes', { now: NOW, notesConverted: false }).blockers, ['code-unconfirmed', 'too-recent', 'old-device', 'notes-unconverted', 'already-retired']);
  const none = clone(allOld);
  delete none.services.notes;
  assert.deepEqual(U.retirementStatus(none, 'notes', { now: NOW, notesConverted: false }), { ready: false, blockers: ['not-linked', 'code-unconfirmed', 'old-device', 'notes-unconverted', 'already-retired'] });
});

check('retirement blocked by keyring-0 device', async () => {
  const { record } = await linked('identity', NOW - 31 * DAY);
  const withOld = U.touchDevice(record, 'old-phone', { name: 'Phone', app: 'v2026.10.07', keyring: 0, now: NOW - 5 * DAY });
  assert.notEqual(withOld, record);
  assert.equal(record.devices['old-phone'], undefined);
  assert.deepEqual(withOld.devices['old-phone'], { name: 'Phone', lastSeen: iso(NOW - 5 * DAY), app: 'v2026.10.07', keyring: 0 });
  assert.equal(withOld.changed, record.changed);
  assert.deepEqual(U.retirementStatus(withOld, 'identity', { now: NOW }), { ready: false, blockers: ['old-device'] });
  const gone = U.touchDevice(record, 'old-phone', { name: 'Phone', app: 'v2026.10.07', keyring: 0, now: NOW - 31 * DAY });
  assert.deepEqual(U.retirementStatus(gone, 'identity', { now: NOW }), { ready: true, blockers: [] });
  const upgraded = U.touchDevice(withOld, 'old-phone', { app: 'v2026.10.21', keyring: 1, now: NOW - DAY });
  assert.deepEqual(upgraded.devices['old-phone'], { name: 'Phone', lastSeen: iso(NOW - DAY), app: 'v2026.10.21', keyring: 1 });
  assert.deepEqual(U.retirementStatus(upgraded, 'identity', { now: NOW }), { ready: true, blockers: [] });
  const unknown = clone(record);
  unknown.devices.stranger = { name: 'Tablet', lastSeen: iso(NOW - 2 * DAY), app: '' };
  assert.deepEqual(U.retirementStatus(unknown, 'identity', { now: NOW }).blockers, ['old-device']);
  const later = U.touchDevice(record, 'dev-a', { now: NOW + DAY });
  assert.equal(later.changed, iso(NOW + DAY));
});

check('retirement notes needs conversion', async () => {
  const { record } = await linked('notes', NOW - 31 * DAY);
  assert.deepEqual(U.retirementStatus(record, 'notes', { now: NOW, notesConverted: false }), { ready: false, blockers: ['notes-unconverted'] });
  assert.deepEqual(U.retirementStatus(record, 'notes', { now: NOW }), { ready: false, blockers: ['notes-unconverted'] });
  assert.deepEqual(U.retirementStatus(record, 'notes', { now: NOW, notesConverted: true }), { ready: true, blockers: [] });
  const id = (await linked('identity', NOW - 31 * DAY)).record;
  assert.deepEqual(U.retirementStatus(id, 'identity', { now: NOW, notesConverted: false }), { ready: true, blockers: [] });
});

check('decideLaunch table', () => {
  const stale = 10 * 60000;
  const rows = [
    [{ liveOther: true, marker: false, seenAgeMs: Infinity, wasDiscarded: false, mobile: false }, 'continue'],
    [{ liveOther: true, marker: true, seenAgeMs: stale, wasDiscarded: false, mobile: false }, 'continue'],
    [{ liveOther: false, marker: true, seenAgeMs: 5000, wasDiscarded: false, mobile: false }, 'continue'],
    [{ liveOther: false, marker: true, seenAgeMs: U.GRACE_MS - 1, wasDiscarded: false, mobile: false }, 'continue'],
    [{ liveOther: false, marker: true, seenAgeMs: stale, wasDiscarded: true, mobile: false }, 'continue'],
    [{ liveOther: false, marker: true, seenAgeMs: stale, wasDiscarded: false, mobile: true }, 'continue'],
    [{ liveOther: false, marker: true, seenAgeMs: stale, wasDiscarded: false, mobile: false }, 'reopen'],
    [{ liveOther: false, marker: true, seenAgeMs: U.GRACE_MS, wasDiscarded: false, mobile: false }, 'reopen'],
    [{ liveOther: false, marker: true, seenAgeMs: Infinity, wasDiscarded: false, mobile: false }, 'reopen'],
    [{ liveOther: false, marker: false, seenAgeMs: 1000, wasDiscarded: true, mobile: true }, 'reopen'],
    [{ liveOther: false, marker: false, seenAgeMs: Infinity, wasDiscarded: false, mobile: false }, 'reopen']
  ];
  for (const [input, want] of rows) assert.equal(U.decideLaunch(input), want, JSON.stringify(input));
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
  }
}
console.log(checks.length - failed + '/' + checks.length + ' passed');
if (failed) process.exit(1);
