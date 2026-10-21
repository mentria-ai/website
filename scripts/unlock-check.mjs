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
const passWrap = async (root, pass, iter) => {
  const salt = rand(32);
  const iv = rand(12);
  const base = await S.importKey('raw', te.encode(pass.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  const key = await S.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const ct = new Uint8Array(await S.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode('mentria-keyring|wrap|pass') }, key, root));
  return { salt: U.b64u(salt), iter, iv: U.b64u(iv), ct: U.b64u(ct), created: iso(NOW) };
};

async function fresh(now = NOW) {
  const code = U.newRecoveryCode();
  const { record, rootBytes } = await U.createRecord({ code, deviceId: 'dev-a', deviceName: 'Laptop', app: 'v2026.10.21', now });
  return { code, record, rootBytes, rootKey: await U.rootKeyFrom(rootBytes) };
}

async function linked(service, linkedAt) {
  const f = await fresh(linkedAt);
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

check('passphrase iterations stay in range', async () => {
  const root = rand(32);
  const pass = 'a long passphrase';
  for (const bad of [999, 0, -1, 1.5, 10000001, '2000', NaN]) {
    await assert.rejects(U.wrapWithPassphrase(root, pass, bad), { message: 'bad-input' }, String(bad));
  }
  assert.deepEqual(await U.openWithPassphrase(await U.wrapWithPassphrase(root, pass, 1000), pass), root);
  assert.deepEqual(await U.openWithPassphrase(await passWrap(root, pass, 1000), pass), root);
  await assert.rejects(U.openWithPassphrase(await passWrap(root, pass, 999), pass), { message: 'bad-pass' });
  const legacy = await passWrap(root, pass, 600000);
  delete legacy.iter;
  await assert.rejects(U.openWithPassphrase(legacy, pass), { message: 'bad-pass' });
  for (const iter of [10000001, '1000', 1000.5, null]) {
    await assert.rejects(U.openWithPassphrase(Object.assign(await passWrap(root, pass, 1000), { iter }), pass), { message: 'bad-pass' }, String(iter));
  }
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

check('wrapWithPrf with missing output throws bad-input', async () => {
  const root = rand(32);
  const opts = { id: 'cred-1', salt: U.b64u(rand(32)), label: 'Laptop' };
  for (const bad of [undefined, null, '', 'a prf output passed as a long string', 32, rand(31), new ArrayBuffer(0), {}]) {
    await assert.rejects(U.wrapWithPrf(root, bad, opts), { message: 'bad-input' }, String(bad));
  }
  for (const part of [{ id: undefined }, { id: '' }, { id: new Uint8Array(0) }, { salt: undefined }, { salt: '' }, { salt: 5 }]) {
    await assert.rejects(U.wrapWithPrf(root, rand(32), Object.assign({}, opts, part)), { message: 'bad-input' }, JSON.stringify(part));
  }
  await assert.rejects(U.wrapWithPrf(root, rand(32)), { message: 'bad-input' });
  const long = rand(64);
  assert.deepEqual(await U.openWithPrf(await U.wrapWithPrf(root, long, opts), long), root);
  await assert.rejects(U.openWithPrf(await U.wrapWithPrf(root, long, opts), long.subarray(0, 31)), { message: 'bad-prf' });
});

check('device wrap roundtrip and wrong key throws bad-device', async () => {
  const root = rand(32);
  const key = await deviceKey();
  const box = await U.wrapWithDeviceKey(root, key);
  assert.deepEqual(Object.keys(box).sort(), ['created', 'ct', 'iv']);
  assert.deepEqual(await U.openWithDeviceKey(box, key), root);
  await assert.rejects(U.openWithDeviceKey(box, await deviceKey()), { message: 'bad-device' });
  await assert.rejects(U.openWithDeviceKey(tamper(box, 'ct'), key), { message: 'bad-device' });
  await assert.rejects(U.openWithDeviceKey(box, undefined), { message: 'bad-device' });
});

check('wrapWithCode with a CryptoKey as root throws bad-input', async () => {
  const root = rand(32);
  const rootKey = await U.rootKeyFrom(root);
  const aes = await deviceKey();
  const code = U.newRecoveryCode();
  for (const bad of [rootKey, undefined, null, 'x'.repeat(32), 32, rand(31), rand(33), new ArrayBuffer(0), Array.from(root)]) {
    const label = String(bad && bad.constructor && bad.constructor.name);
    await assert.rejects(U.wrapWithCode(bad, code), { message: 'bad-input' }, label);
    await assert.rejects(U.wrapWithPassphrase(bad, 'a long passphrase', ITER), { message: 'bad-input' }, label);
    await assert.rejects(U.wrapWithPrf(bad, rand(32), { id: 'c', salt: 's' }), { message: 'bad-input' }, label);
    await assert.rejects(U.wrapWithDeviceKey(bad, aes), { message: 'bad-input' }, label);
    await assert.rejects(U.kcvOf(bad), { message: 'bad-input' }, label);
    await assert.rejects(U.rootKeyFrom(bad), { message: 'bad-input' }, label);
  }
  for (const bad of [rootKey, root, undefined, { type: 'secret', algorithm: { name: 'AES-GCM' } }]) {
    await assert.rejects(U.wrapWithDeviceKey(root, bad), { message: 'bad-input' });
  }
  const view = new DataView(new Uint8Array([0, ...root, 0]).buffer, 1, 32);
  assert.deepEqual(await U.openWithCode(await U.wrapWithCode(view, code), code), root);
  assert.deepEqual(await U.openWithCode(await U.wrapWithCode(root.buffer, code), code), root);
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
  assert.deepEqual(Object.keys(entry).sort(), ['ct', 'id', 'iv', 'linked']);
  assert.equal(entry.linked, iso(NOW));
  assert.equal(U.unb64u(entry.id).length, 8);
  assert.equal(U.b64u(U.unb64u(entry.id)), entry.id);
  assert.notEqual((await U.sealService(rootKey, 'identity', secret, NOW)).id, entry.id);
  assert.deepEqual(await U.openService(rootKey, 'identity', entry), secret);
  const legacy = clone(entry);
  delete legacy.id;
  assert.deepEqual(await U.openService(rootKey, 'identity', legacy), secret);
  assert.deepEqual(await U.openService(rootKey, 'identity', Object.assign(clone(entry), { id: 'other' })), secret);
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

check('sealService with empty secret throws bad-input', async () => {
  const rootKey = await U.rootKeyFrom(rand(32));
  for (const bad of [undefined, null, new Uint8Array(0), new ArrayBuffer(0), 'secret', 7, {}]) {
    await assert.rejects(U.sealService(rootKey, 'identity', bad, NOW), { message: 'bad-input' }, String(bad));
  }
  const one = new Uint8Array([7]);
  assert.deepEqual(await U.openService(rootKey, 'identity', await U.sealService(rootKey, 'identity', one, NOW)), one);
  const buf = rand(32);
  assert.deepEqual(await U.openService(rootKey, 'totp', await U.sealService(rootKey, 'totp', buf.buffer, NOW)), buf);
});

check('sealService with bytes as rootKey throws bad-input', async () => {
  const root = rand(32);
  const secret = rand(32);
  const aes = await deviceKey();
  const entry = { salt: U.b64u(rand(16)), iv: U.b64u(rand(12)), ct: U.b64u(rand(48)) };
  for (const bad of [root, root.buffer, aes, undefined, null, {}, { type: 'secret', algorithm: { name: 'HKDF' } }]) {
    const label = String(bad && bad.constructor && bad.constructor.name);
    await assert.rejects(U.sealService(bad, 'identity', secret, NOW), { message: 'bad-input' }, label);
    await assert.rejects(U.openService(bad, 'identity', entry), { message: 'bad-input' }, label);
    await assert.rejects(U.makeBackupEntry(bad, U.newRecoveryCode()), { message: 'bad-input' }, label);
    await assert.rejects(U.backupKeyFromEntry(bad, entry), { message: 'bad-input' }, label);
  }
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

check('backup key from a malformed salt throws bad-backup', async () => {
  const code = U.newRecoveryCode();
  for (const bad of ['!!!!', 'a', 123, undefined, null, {}, rand(8), U.b64u(rand(8))]) {
    await assert.rejects(U.backupKeyFromCode(code, bad), { message: 'bad-backup' }, String(bad));
  }
  await assert.rejects(U.backupKeyFromCode('nope', '!!!!'), { message: 'bad-code' });
  assert.equal((await U.backupKeyFromCode(code, rand(16).buffer)).length, 32);
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
  b.wraps.prf = [{ id: 'cred-a', removed: iso(NOW + 2000) }];
  for (const m of [U.mergeRecords(a, b), U.mergeRecords(b, a)]) {
    assert.deepEqual(m.wraps.prf, [{ id: 'cred-a', removed: iso(NOW + 2000) }]);
  }
  const c = clone(record);
  c.wraps.prf = [Object.assign(clone(live), { created: iso(NOW + 3000) })];
  for (const m of [U.mergeRecords(b, c), U.mergeRecords(c, b)]) {
    assert.deepEqual(m.wraps.prf, c.wraps.prf);
  }
});

check('merged tombstone carries no ciphertext', async () => {
  const { record, rootBytes } = await fresh();
  const live = Object.assign(await U.wrapWithPrf(rootBytes, rand(32), { id: 'cred-a', salt: U.b64u(rand(32)), label: 'Laptop' }), { created: iso(NOW + 1000) });
  const other = Object.assign(await U.wrapWithPrf(rootBytes, rand(32), { id: 'cred-b', salt: U.b64u(rand(32)), label: 'Phone' }), { created: iso(NOW + 1500) });
  const pass = Object.assign(await U.wrapWithPassphrase(rootBytes, 'first passphrase', ITER), { created: iso(NOW + 1000) });
  const a = clone(record);
  a.wraps.prf = [live];
  a.wraps.pass = pass;
  const b = clone(record);
  b.wraps.prf = [Object.assign(clone(live), { removed: iso(NOW + 2000) }), Object.assign(clone(other), { removed: iso(NOW + 2500) })];
  b.wraps.pass = Object.assign(clone(pass), { removed: iso(NOW + 2000) });
  for (const m of [U.mergeRecords(a, b), U.mergeRecords(b, a)]) {
    assert.ok(U.isRecord(m));
    assert.deepEqual(m.wraps.prf, [{ id: 'cred-a', removed: iso(NOW + 2000) }, { id: 'cred-b', removed: iso(NOW + 2500) }]);
    assert.deepEqual(m.wraps.pass, { removed: iso(NOW + 2000) });
  }
  const back = clone(record);
  back.wraps.pass = Object.assign(clone(pass), { created: iso(NOW + 3000) });
  assert.deepEqual(U.mergeRecords(U.mergeRecords(a, b), back).wraps.pass, back.wraps.pass);
});

check('merge different kcv returns null', async () => {
  const one = await fresh();
  const two = await fresh();
  assert.equal(U.mergeRecords(one.record, two.record), null);
  assert.equal(U.mergeRecords(two.record, one.record), null);
  assert.equal(U.mergeRecords(one.record, null), null);
  assert.equal(U.mergeRecords(null, one.record), null);
  assert.equal(U.mergeRecords(one.record, Object.assign(clone(one.record), { v: 2 })), null);
  assert.equal(U.mergeRecords(null, { v: 1 }), null);
});

check('merge takes the backup entry only from the winning recovery side', async () => {
  const { record, rootBytes } = await fresh();
  const a = clone(record);
  const b = clone(record);
  b.wraps.recovery = Object.assign(await U.wrapWithCode(rootBytes, U.newRecoveryCode()), { created: iso(NOW + DAY) });
  delete b.backup;
  for (const m of [U.mergeRecords(a, b), U.mergeRecords(b, a)]) {
    assert.ok(U.isRecord(m));
    assert.deepEqual(m.wraps.recovery, b.wraps.recovery);
    assert.equal(m.backup, undefined);
  }
});

check('regenerated code is unconfirmed after merge with an older confirmation', async () => {
  const { record, rootBytes, rootKey } = await fresh();
  const a = clone(record);
  a.codeConfirmed = iso(NOW + 1000);
  const b = clone(record);
  const code2 = U.newRecoveryCode();
  b.wraps.recovery = Object.assign(await U.wrapWithCode(rootBytes, code2), { created: iso(NOW + DAY) });
  b.backup = await U.makeBackupEntry(rootKey, code2);
  b.codeConfirmed = null;
  for (const m of [U.mergeRecords(a, b), U.mergeRecords(b, a)]) {
    assert.deepEqual(m.wraps.recovery, b.wraps.recovery);
    assert.equal(m.codeConfirmed, null);
  }
  b.codeConfirmed = iso(NOW + DAY + 5000);
  a.codeConfirmed = iso(NOW + DAY + 9000);
  for (const m of [U.mergeRecords(a, b), U.mergeRecords(b, a)]) assert.equal(m.codeConfirmed, iso(NOW + DAY + 5000));
  b.codeConfirmed = iso(NOW + DAY);
  a.codeConfirmed = iso(NOW + 1000);
  for (const m of [U.mergeRecords(a, b), U.mergeRecords(b, a)]) assert.equal(m.codeConfirmed, iso(NOW + DAY));
  const c = clone(record);
  c.codeConfirmed = iso(NOW + 500);
  a.codeConfirmed = iso(NOW + 600);
  assert.equal(U.mergeRecords(a, c).codeConfirmed, iso(NOW + 500));
  c.codeConfirmed = iso(NOW - 1);
  assert.equal(U.mergeRecords(a, c).codeConfirmed, iso(NOW + 600));
});

check('merge keeps the newest wraps and services and the earliest dates', async () => {
  const { record, rootBytes, rootKey } = await fresh();
  const a = clone(record);
  const b = clone(record);
  const code2 = U.newRecoveryCode();
  b.wraps.recovery = Object.assign(await U.wrapWithCode(rootBytes, code2), { created: iso(NOW + DAY) });
  b.backup = await U.makeBackupEntry(rootKey, code2);
  a.wraps.pass = Object.assign(await U.wrapWithPassphrase(rootBytes, 'first passphrase', ITER), { created: iso(NOW + 1000) });
  b.wraps.pass = { removed: iso(NOW + 2000) };
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
    assert.deepEqual(m.wraps.pass, { removed: iso(NOW + 2000) });
    assert.deepEqual(m.services.identity, Object.assign({}, a.services.identity, { prior: [b.services.identity] }));
    assert.deepEqual(m.services.totp, b.services.totp);
    assert.deepEqual(m.retired, { identity: iso(NOW + 8000), totp: iso(NOW + 7000) });
    assert.equal(m.codeConfirmed, null);
    assert.equal(m.changed, iso(NOW + 200));
  }
  const c = clone(record);
  c.wraps.pass = Object.assign(await U.wrapWithPassphrase(rootBytes, 'second passphrase', ITER), { created: iso(NOW + 3000) });
  for (const m of [U.mergeRecords(b, c), U.mergeRecords(c, b)]) {
    assert.deepEqual(m.wraps.pass, c.wraps.pass);
  }
  assert.equal(U.mergeRecords(record, clone(record)).wraps.pass, undefined);
});

check('merge keeps the other device\'s service secret under prior', async () => {
  const { record, rootKey } = await fresh();
  const sa = rand(32);
  const sb = rand(32);
  const a = clone(record);
  const b = clone(record);
  a.services.notes = await U.sealService(rootKey, 'notes', sa, NOW + 1000);
  b.services.notes = await U.sealService(rootKey, 'notes', sb, NOW + 2000);
  const m = U.mergeRecords(a, b);
  assert.ok(U.isRecord(m));
  assert.equal(JSON.stringify(U.mergeRecords(b, a)), JSON.stringify(m));
  assert.deepEqual(m.services.notes, Object.assign({}, b.services.notes, { prior: [a.services.notes] }));
  assert.deepEqual(await U.openService(rootKey, 'notes', m.services.notes), sb);
  assert.deepEqual(await U.openService(rootKey, 'notes', m.services.notes.prior[0]), sa);
  const got = [];
  for (const { id, entry } of U.listServiceEntries(m, 'notes')) got.push([id, await U.openService(rootKey, 'notes', entry)]);
  assert.deepEqual(got, [[b.services.notes.id, sb], [a.services.notes.id, sa]]);
  for (const x of [m, a, b, U.mergeRecords(m, a), U.mergeRecords(b, m)]) {
    assert.equal(JSON.stringify(U.mergeRecords(m, x)), JSON.stringify(m));
    assert.equal(JSON.stringify(U.mergeRecords(x, m)), JSON.stringify(m));
  }
  const flipped = clone(record);
  flipped.services.notes = Object.assign(clone(a.services.notes), { prior: [clone(b.services.notes), clone(a.services.notes)] });
  assert.deepEqual(U.mergeRecords(flipped, clone(record)).services.notes, Object.assign({}, a.services.notes, { prior: [b.services.notes] }));
  for (const x of [U.mergeRecords(m, flipped), U.mergeRecords(flipped, m)]) assert.deepEqual(x.services.notes, m.services.notes);
  const relinked = clone(b);
  relinked.services.notes = Object.assign(clone(b.services.notes), { linked: iso(NOW + 3000) });
  for (const x of [U.mergeRecords(b, relinked), U.mergeRecords(relinked, b)]) assert.deepEqual(x.services.notes, relinked.services.notes);
  const oldA = clone(a);
  const oldB = clone(b);
  delete oldA.services.notes.id;
  delete oldB.services.notes.id;
  for (const x of [U.mergeRecords(oldA, oldB), U.mergeRecords(oldB, oldA)]) {
    assert.ok(U.isRecord(x));
    assert.deepEqual(x.services.notes, Object.assign({}, oldB.services.notes, { prior: [oldA.services.notes] }));
  }
  assert.equal(JSON.stringify(U.mergeRecords(oldA, oldB)), JSON.stringify(U.mergeRecords(oldB, oldA)));
  assert.deepEqual(U.mergeRecords(oldA, clone(oldA)).services.notes, oldA.services.notes);
  const twin = clone(oldA);
  twin.services.notes = await U.sealService(rootKey, 'notes', sb, NOW + 1000);
  delete twin.services.notes.id;
  const [lo, hi] = [oldA.services.notes, twin.services.notes].sort((p, q) => (JSON.stringify(p) < JSON.stringify(q) ? -1 : 1));
  for (const x of [U.mergeRecords(oldA, twin), U.mergeRecords(twin, oldA)]) assert.deepEqual(x.services.notes, Object.assign({}, hi, { prior: [lo] }));
  for (const x of [U.mergeRecords(oldA, b), U.mergeRecords(b, oldA)]) {
    assert.deepEqual(x.services.notes, Object.assign({}, b.services.notes, { prior: [oldA.services.notes] }));
  }
  const none = clone(record);
  for (const x of [U.mergeRecords(none, a), U.mergeRecords(a, none)]) assert.deepEqual(x.services.notes, a.services.notes);
});

check('prior keeps every distinct entry', async () => {
  const { record, rootKey } = await fresh();
  const e = [];
  for (let i = 0; i < 12; i++) e.push(await U.sealService(rootKey, 'totp', te.encode('secret ' + i), NOW + i * 1000));
  const withPrior = (cur, list) => Object.assign(clone(cur), { prior: list.map(clone) });
  const opened = async (r) => {
    const out = [];
    for (const { entry } of U.listServiceEntries(r, 'totp')) out.push(new TextDecoder().decode(await U.openService(rootKey, 'totp', entry)));
    return out;
  };
  const every = e.map((_, i) => 'secret ' + (11 - i));
  const c = clone(record);
  const d = clone(record);
  c.services.totp = withPrior(e[5], [e[1], e[3]]);
  d.services.totp = withPrior(e[4], [e[3], e[2]]);
  for (const m of [U.mergeRecords(c, d), U.mergeRecords(d, c)]) assert.deepEqual(m.services.totp, withPrior(e[5], [e[1], e[2], e[3], e[4]]));
  assert.equal(JSON.stringify(U.mergeRecords(c, d)), JSON.stringify(U.mergeRecords(d, c)));
  const a = clone(record);
  const b = clone(record);
  a.services.totp = withPrior(e[10], [e[0], e[2], e[4], e[6], e[8]]);
  b.services.totp = withPrior(e[11], [e[9], e[7], e[5], e[3], e[1], e[2]]);
  const m = U.mergeRecords(a, b);
  assert.equal(JSON.stringify(U.mergeRecords(b, a)), JSON.stringify(m));
  assert.deepEqual(m.services.totp, withPrior(e[11], e.slice(0, 11)));
  assert.equal(JSON.stringify(U.mergeRecords(m, m)), JSON.stringify(m));
  assert.deepEqual(await opened(m), every);
  for (const x of [a, b, U.mergeRecords(m, a), U.mergeRecords(b, m)]) {
    assert.equal(JSON.stringify(U.mergeRecords(m, x)), JSON.stringify(m));
    assert.equal(JSON.stringify(U.mergeRecords(x, m)), JSON.stringify(m));
  }
  const parts = [[e[3], [e[0], e[7], e[11]]], [e[11], [e[1]]], [e[5], [e[9], e[2], e[10], e[3]]], [e[8], [e[4], e[6], e[8]]]].map(([cur, list]) => {
    const r = clone(record);
    r.services.totp = withPrior(cur, list);
    return r;
  });
  const perms = (xs) => (xs.length < 2 ? [xs] : xs.flatMap((x, i) => perms(xs.slice(0, i).concat(xs.slice(i + 1))).map((p) => [x].concat(p))));
  const want = JSON.stringify(m);
  for (const p of perms([0, 1, 2, 3])) {
    const [w, x, y, z] = p.map((i) => clone(parts[i]));
    const folded = [x, y, z].reduce((acc, r, i) => (i % 2 ? U.mergeRecords(r, acc) : U.mergeRecords(acc, r)), w);
    assert.equal(JSON.stringify(folded), want, p.join());
    assert.equal(JSON.stringify(U.mergeRecords(U.mergeRecords(w, x), U.mergeRecords(y, z))), want, p.join());
    assert.equal(JSON.stringify(U.mergeRecords(folded, folded)), want, p.join());
  }
  let chain = clone(record);
  const linked = [];
  for (let i = 0; i < 20; i++) {
    const dev = clone(record);
    dev.services.notes = await U.sealService(rootKey, 'notes', te.encode('link ' + i), NOW + i * 1000);
    linked.push(dev.services.notes);
    chain = i % 2 ? U.mergeRecords(dev, chain) : U.mergeRecords(chain, dev);
  }
  assert.deepEqual(chain.services.notes, withPrior(linked[19], linked.slice(0, 19)));
  const notes = [];
  for (const { id, entry } of U.listServiceEntries(chain, 'notes')) notes.push([id, new TextDecoder().decode(await U.openService(rootKey, 'notes', entry))]);
  assert.deepEqual(notes, linked.map((x, i) => [x.id, 'link ' + i]).reverse());
  const big = clone(record);
  big.services.totp = withPrior(e[11], e.slice(0, 11).reverse());
  assert.deepEqual(U.mergeRecords(big, clone(record)).services.totp, withPrior(e[11], e.slice(0, 11)));
  const undated = clone(record);
  const noDate = Object.assign(clone(e[0]), { linked: 'not a date' });
  undated.services.totp = withPrior(e[11], [noDate].concat(e.slice(1, 9)));
  for (const x of [U.mergeRecords(undated, clone(record)), U.mergeRecords(clone(record), undated)]) assert.deepEqual(x.services.totp, withPrior(e[11], [noDate].concat(e.slice(1, 9))));
  const messy = clone(record);
  messy.services.totp = withPrior(e[6], [Object.assign(clone(e[2]), { prior: [clone(e[1])] }), e[6], e[2], { id: 'no-box' }, { iv: 'x' }]);
  messy.services.totp.prior.push('junk', null, 7);
  for (const x of [U.mergeRecords(messy, clone(record)), U.mergeRecords(clone(record), messy)]) {
    assert.ok(U.isRecord(x));
    assert.deepEqual(x.services.totp, withPrior(e[6], [e[1], e[2]]));
  }
  const broken = clone(record);
  broken.services.totp = { linked: iso(NOW + 99000), prior: [clone(e[0])] };
  for (const x of [U.mergeRecords(broken, c), U.mergeRecords(c, broken)]) assert.deepEqual(x.services.totp, withPrior(e[5], [e[0], e[1], e[3]]));
});

check('isRecord accepts service entries with and without id or prior', async () => {
  const { record, rootKey } = await fresh();
  const entry = await U.sealService(rootKey, 'identity', rand(32), NOW);
  const old = clone(entry);
  delete old.id;
  const shapes = [entry, old, Object.assign(clone(entry), { prior: [] }), Object.assign(clone(entry), { prior: [old] }), Object.assign(clone(old), { prior: [clone(entry), clone(old)] })];
  for (const svc of shapes) {
    const r = Object.assign(clone(record), { services: { identity: svc } });
    assert.ok(U.isRecord(r), JSON.stringify(svc));
    assert.ok(U.isRecord(U.mergeRecords(r, clone(r))));
  }
});

check('listServiceEntries lists current then prior', async () => {
  const { record, rootKey } = await fresh();
  const e = [];
  for (let i = 0; i < 4; i++) e.push(await U.sealService(rootKey, 'identity', rand(32), NOW + i * 1000));
  assert.deepEqual(U.listServiceEntries(record, 'identity'), []);
  const r = clone(record);
  r.services.identity = Object.assign(clone(e[3]), { prior: [clone(e[0]), clone(e[1]), clone(e[2])] });
  const list = U.listServiceEntries(r, 'identity');
  assert.deepEqual(list.map((x) => x.id), [e[3].id, e[2].id, e[1].id, e[0].id]);
  assert.deepEqual(list.map((x) => x.entry), [e[3], e[2], e[1], e[0]]);
  list[0].entry.ct = 'changed';
  list[1].entry.ct = 'changed';
  assert.equal(r.services.identity.ct, e[3].ct);
  assert.equal(r.services.identity.prior[2].ct, e[2].ct);
  const old = clone(e[0]);
  delete old.id;
  r.services.identity = Object.assign(clone(old), { prior: [clone(e[1]), clone(old), clone(e[1]), { id: 'x' }, null] });
  assert.deepEqual(U.listServiceEntries(r, 'identity'), [{ id: null, entry: old }, { id: e[1].id, entry: e[1] }]);
  for (const name of ['totp', 'backup', '__proto__', 'constructor', undefined]) assert.deepEqual(U.listServiceEntries(r, name), [], String(name));
  for (const bad of [null, undefined, {}, 'x', { services: null }]) assert.deepEqual(U.listServiceEntries(bad, 'identity'), []);
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
  assert.equal(withOld.changed, iso(NOW - 5 * DAY));
  assert.equal(U.touchDevice(withOld, 'dev-a', { now: NOW - 10 * DAY }).changed, iso(NOW - 5 * DAY));
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

check('retirement blocked when confirmation predates the recovery wrap', async () => {
  const { record, rootBytes } = await linked('identity', NOW - 31 * DAY);
  assert.deepEqual(U.retirementStatus(record, 'identity', { now: NOW }), { ready: true, blockers: [] });
  const regen = clone(record);
  regen.wraps.recovery = Object.assign(await U.wrapWithCode(rootBytes, U.newRecoveryCode()), { created: iso(NOW - DAY) });
  assert.deepEqual(U.retirementStatus(regen, 'identity', { now: NOW }), { ready: false, blockers: ['code-unconfirmed'] });
  regen.codeConfirmed = iso(NOW - DAY - 1);
  assert.deepEqual(U.retirementStatus(regen, 'identity', { now: NOW }), { ready: false, blockers: ['code-unconfirmed'] });
  regen.codeConfirmed = iso(NOW - DAY);
  assert.deepEqual(U.retirementStatus(regen, 'identity', { now: NOW }), { ready: true, blockers: [] });
  regen.codeConfirmed = 'not a date';
  assert.deepEqual(U.retirementStatus(regen, 'identity', { now: NOW }), { ready: false, blockers: ['code-unconfirmed'] });
  const undated = clone(record);
  delete undated.wraps.recovery.created;
  assert.deepEqual(U.retirementStatus(undated, 'identity', { now: NOW }), { ready: false, blockers: ['code-unconfirmed'] });
});

check('retirement of an unknown service is not-linked only', async () => {
  const { record } = await fresh();
  record.retired.backup = iso(NOW);
  for (const name of ['backup', 'constructor', '__proto__', 'Identity', undefined]) {
    assert.deepEqual(U.retirementStatus(record, name, { now: NOW }), { ready: false, blockers: ['not-linked'] }, String(name));
  }
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

check('addOther keeps every other keyring once by kcv', async () => {
  assert.equal(typeof U.addOther, 'function');
  const a = await fresh();
  const b = await fresh();
  const one = U.addOther(undefined, a.record);
  assert.equal(one.length, 1);
  assert.equal(one[0].kcv, a.record.kcv);
  assert.notEqual(one[0], a.record, 'stores a copy');
  const two = U.addOther(one, b.record);
  assert.deepEqual(two.map((r) => r.kcv), [a.record.kcv, b.record.kcv]);
  assert.equal(one.length, 1, 'the list passed in is not changed');
  const more = clone(a.record);
  more.services.notes = await U.sealService(a.rootKey, 'notes', rand(32), NOW);
  const merged = U.addOther(two, more);
  assert.equal(merged.length, 2);
  assert.ok(merged[0].services.notes, 'the same kcv merges into its entry');
  const older = clone(a.record);
  const again = U.addOther(merged, older);
  assert.ok(again[0].services.notes, 'an older copy never drops what the entry has');
  assert.deepEqual(U.addOther(two, { v: 1, kcv: 'x' }), two, 'an invalid record is not added');
  const junk = U.addOther(['junk', null], a.record);
  assert.equal(junk.length, 3, 'unreadable entries stay');
  assert.equal(junk[2].kcv, a.record.kcv);
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
