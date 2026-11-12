import { sigFingerprint } from '/assets/js/comms/sign.js';

const NS = 'comms';
const KEY = 'devkey';
const SIGN = { name: 'ECDSA', namedCurve: 'P-256' };
const DH = { name: 'ECDH', namedCurve: 'P-256' };

const b64uEnc = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const b64uDec = (str) => {
  const b64 = String(str).replaceAll('-', '+').replaceAll('_', '/');
  return Uint8Array.from(atob(b64 + '='.repeat((4 - b64.length % 4) % 4)), (c) => c.charCodeAt(0));
};

const wrapKey = () => crypto.subtle.importKey('raw', window.MentriaIdentity.getSecret(), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);

const pubOf = (jwk) => ({ x: jwk.x, y: jwk.y });
const okPub = (p) => !!p && typeof p.x === 'string' && typeof p.y === 'string';
const okWrapped = (w) => !!w && typeof w.iv === 'string' && typeof w.ct === 'string';

const seal = async (wk, privateKey) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wk, await crypto.subtle.exportKey('pkcs8', privateKey));
  return { iv: b64uEnc(iv), ct: b64uEnc(new Uint8Array(ct)) };
};

const unseal = async (wk, wrapped, algo, usages) => {
  const pkcs8 = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64uDec(wrapped.iv) }, wk, b64uDec(wrapped.ct));
  return crypto.subtle.importKey('pkcs8', pkcs8, algo, false, usages);
};

const load = async (wk, rec) => {
  const signKey = await unseal(wk, rec.sign.wrapped, SIGN, ['sign']);
  const privateKey = await unseal(wk, rec.dh.wrapped, DH, ['deriveBits']);
  const spub = pubOf(rec.sign.pub);
  return { sign: { spub, signKey, sigFp: await sigFingerprint(spub) }, dh: { pub: pubOf(rec.dh.pub), privateKey } };
};

const make = async (wk) => {
  const s = await crypto.subtle.generateKey(SIGN, true, ['sign', 'verify']);
  const d = await crypto.subtle.generateKey(DH, true, ['deriveBits']);
  const rec = {
    v: 1,
    sign: { pub: pubOf(await crypto.subtle.exportKey('jwk', s.publicKey)), wrapped: await seal(wk, s.privateKey) },
    dh: { pub: pubOf(await crypto.subtle.exportKey('jwk', d.publicKey)), wrapped: await seal(wk, d.privateKey) },
    created: Date.now()
  };
  if (!window.MentriaStore.set(NS, KEY, rec)) throw new Error('storage-full');
  return rec;
};

const run = async () => {
  const wk = await wrapKey();
  const rec = window.MentriaStore.get(NS, KEY);
  if (rec && rec.v === 1 && rec.sign && rec.dh && okPub(rec.sign.pub) && okPub(rec.dh.pub) && okWrapped(rec.sign.wrapped) && okWrapped(rec.dh.wrapped)) return load(wk, rec);
  return load(wk, await make(wk));
};

export const ensureDeviceKeys = () => {
  const locks = typeof navigator !== 'undefined' && navigator.locks;
  return locks && typeof locks.request === 'function' ? locks.request('mentria-comms-devkey', run) : run();
};
