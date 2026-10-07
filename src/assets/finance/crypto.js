const enc = new TextEncoder();
const dec = new TextDecoder();
const SALT = enc.encode('mentria-finance-v1');
export const PBKDF2_ITER = 600000;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function randomBytes(n) { return crypto.getRandomValues(new Uint8Array(n)); }

export function hex(bytes) { return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(''); }

export function randomId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = hex(b);
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
}

export function b64(bytes) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}

export function unb64(s) {
  const bin = atob(String(s || ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function b32(bytes) {
  let bits = 0, value = 0, out = '';
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function unb32(s) {
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

export function groupCode(s, size) {
  return String(s).match(new RegExp('.{1,' + (size || 4) + '}', 'g')).join('-');
}

async function hkdfBase(bytes) {
  return crypto.subtle.importKey('raw', bytes, 'HKDF', false, ['deriveBits', 'deriveKey']);
}

export async function hkdfBits(bytes, info, bits, salt) {
  const base = await hkdfBase(bytes);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: salt || SALT, info: enc.encode(info) }, base, bits));
}

export async function hkdfAesKey(bytes, info, salt, extractable) {
  const base = await hkdfBase(bytes);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: salt || SALT, info: enc.encode(info) }, base, { name: 'AES-GCM', length: 256 }, !!extractable, ['encrypt', 'decrypt']);
}

export async function deriveKeys(root) {
  const [dek, sync, inboxWrap, kcv, roomSeed] = await Promise.all([
    hkdfAesKey(root, 'dek'),
    hkdfAesKey(root, 'sync'),
    hkdfAesKey(root, 'inbox-wrap'),
    hkdfBits(root, 'kcv', 128),
    hkdfBits(root, 'room', 128)
  ]);
  return { dek, sync, inboxWrap, kcv: hex(kcv), roomSeed };
}

export async function aesEncrypt(key, plain, aad) {
  const iv = randomBytes(12);
  const params = { name: 'AES-GCM', iv };
  if (aad) params.additionalData = enc.encode(aad);
  const ct = new Uint8Array(await crypto.subtle.encrypt(params, key, plain));
  return { iv, ct };
}

export async function aesDecrypt(key, iv, ct, aad) {
  const params = { name: 'AES-GCM', iv };
  if (aad) params.additionalData = enc.encode(aad);
  return new Uint8Array(await crypto.subtle.decrypt(params, key, ct));
}

export async function encryptJson(key, obj, aad) {
  const r = await aesEncrypt(key, enc.encode(JSON.stringify(obj)), aad);
  return { iv: b64(r.iv), ct: b64(r.ct) };
}

export async function decryptJson(key, box, aad) {
  const pt = await aesDecrypt(key, unb64(box.iv), unb64(box.ct), aad);
  return JSON.parse(dec.decode(pt));
}

async function streamBytes(bytes, transform) {
  const stream = new Blob([bytes]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export const canCompress = typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

export async function gzip(bytes) {
  return canCompress ? streamBytes(bytes, new CompressionStream('gzip')) : bytes;
}

export async function gunzip(bytes) {
  return canCompress ? streamBytes(bytes, new DecompressionStream('gzip')) : bytes;
}

export async function sealPayload(key, obj, aad) {
  const raw = enc.encode(JSON.stringify(obj));
  const z = canCompress ? 1 : 0;
  const body = z ? await gzip(raw) : raw;
  const r = await aesEncrypt(key, body, aad);
  return { z, iv: r.iv, ct: r.ct, bytes: raw.length };
}

export async function openPayload(key, box, aad) {
  const iv = box.iv instanceof Uint8Array ? box.iv : unb64(box.iv);
  const ct = box.ct instanceof Uint8Array ? box.ct : unb64(box.ct);
  const body = await aesDecrypt(key, iv, ct, aad);
  const raw = box.z ? await gunzip(body) : body;
  return JSON.parse(dec.decode(raw));
}

export async function passKey(passphrase, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', enc.encode(String(passphrase).normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iterations || PBKDF2_ITER }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function wrapRoot(root, key, label) {
  const r = await aesEncrypt(key, root, 'mentria-finance|wrap|' + label);
  return { iv: b64(r.iv), ct: b64(r.ct) };
}

export async function unwrapRoot(wrap, key, label) {
  return aesDecrypt(key, unb64(wrap.iv), unb64(wrap.ct), 'mentria-finance|wrap|' + label);
}

export async function makePassWrap(root, passphrase, iterations) {
  const salt = randomBytes(32);
  const iter = iterations || PBKDF2_ITER;
  const key = await passKey(passphrase, salt, iter);
  return Object.assign({ kind: 'pass', salt: b64(salt), iter }, await wrapRoot(root, key, 'pass'));
}

export async function openPassWrap(wrap, passphrase) {
  const key = await passKey(passphrase, unb64(wrap.salt), wrap.iter || PBKDF2_ITER);
  return unwrapRoot(wrap, key, 'pass');
}

export function newRecoveryCode() {
  return groupCode(b32(randomBytes(20)), 4);
}

export function normalizeRecovery(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
}

async function recoveryKey(code, salt) {
  const bytes = unb32(normalizeRecovery(code));
  if (bytes.length < 20) throw new Error('bad recovery code');
  return hkdfAesKey(bytes, 'mentria-finance-recovery-v1', salt);
}

export async function makeRecoveryWrap(root, code) {
  const salt = randomBytes(16);
  const key = await recoveryKey(code, salt);
  return Object.assign({ kind: 'recovery', salt: b64(salt) }, await wrapRoot(root, key, 'recovery'));
}

export async function openRecoveryWrap(wrap, code) {
  const key = await recoveryKey(code, unb64(wrap.salt));
  return unwrapRoot(wrap, key, 'recovery');
}

export async function prfWrapKey(prfOutput) {
  return hkdfAesKey(new Uint8Array(prfOutput), 'mentria-finance-prf-v1', new Uint8Array(0));
}

export async function makeDeviceWrap(root) {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  return Object.assign({ kind: 'device', key }, await wrapRoot(root, key, 'device'));
}

export async function openDeviceWrap(wrap) {
  return unwrapRoot(wrap, wrap.key, 'device');
}

export async function newInboxKeys(inboxWrapKey) {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
  const pub = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const priv = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const sealed = await encryptJson(inboxWrapKey, priv, 'mentria-finance|inbox-key');
  return { pub, sealed };
}

export async function sealToInbox(pubJwk, obj) {
  const pub = await crypto.subtle.importKey('jwk', pubJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'ECDH', public: pub }, eph.privateKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const box = await encryptJson(key, obj, 'mentria-finance|inbox');
  return Object.assign({ epk: await crypto.subtle.exportKey('jwk', eph.publicKey) }, box);
}

export async function openInbox(inboxWrapKey, sealedPriv, entries) {
  const privJwk = await decryptJson(inboxWrapKey, sealedPriv, 'mentria-finance|inbox-key');
  const priv = await crypto.subtle.importKey('jwk', privJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']);
  const out = [];
  for (const e of entries) {
    try {
      const epk = await crypto.subtle.importKey('jwk', e.box.epk, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
      const key = await crypto.subtle.deriveKey({ name: 'ECDH', public: epk }, priv, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
      out.push({ id: e.id, value: await decryptJson(key, e.box, 'mentria-finance|inbox') });
    } catch (_) { out.push({ id: e.id, value: null }); }
  }
  return out;
}

export async function sha256Hex(bytes) {
  const d = await crypto.subtle.digest('SHA-256', bytes instanceof Uint8Array ? bytes : enc.encode(String(bytes)));
  return hex(new Uint8Array(d));
}

export async function pairDerive(code) {
  const bytes = unb32(normalizeRecovery(code));
  if (bytes.length < 10) throw new Error('code too short');
  const room = await hkdfBits(bytes, 'room-id', 80, enc.encode('mentria-finance-pair-room-v1'));
  const key = await hkdfAesKey(bytes, 'aes-gcm-256', enc.encode('mentria-finance-pair-key-v1'));
  const check = await hkdfBits(bytes, 'confirm', 32, enc.encode('mentria-finance-pair-check-v1'));
  const num = ((check[0] << 24) | (check[1] << 16) | (check[2] << 8) | check[3]) >>> 0;
  return { roomId: b32(room).toLowerCase().slice(0, 16), key, confirm: String(num % 1000000).padStart(6, '0') };
}

export function newPairCode() {
  return groupCode(b32(randomBytes(10)), 4);
}

export async function weeklyRoom(roomSeed, now) {
  const week = Math.floor((now || Date.now()) / (7 * 86400000));
  const bits = await hkdfBits(roomSeed, 'room-week-' + week, 80, enc.encode('mentria-finance-room-v1'));
  return b32(bits).toLowerCase().slice(0, 16);
}
