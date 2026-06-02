(function (global) {
  'use strict';

  const NS = 'identity';
  const KEY = 'vault';
  const PBKDF2_ITER = 600000;
  const SALT_BYTES = 16;
  const IV_BYTES = 12;
  const SECRET_BYTES = 32;

  function b64uEnc(bytes) {
    const u8 = new Uint8Array(bytes);
    let s = '';
    for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64uDec(str) {
    const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
    const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/') + pad);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }

  async function pbkdf2(pass, salt, iter) {
    const baseKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }
  async function encryptWith(key, plaintextBytes) {
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintextBytes);
    return { iv: b64uEnc(iv), ct: b64uEnc(new Uint8Array(ct)) };
  }
  async function decryptWith(key, env) {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64uDec(env.iv) }, key, b64uDec(env.ct));
    return new Uint8Array(pt);
  }

  const state = { secret: null };

  function loadVault() {
    if (!global.MentriaStore) return null;
    return global.MentriaStore.get(NS, KEY);
  }
  function saveVault(v) {
    if (!global.MentriaStore) throw new Error('storage unavailable');
    global.MentriaStore.set(NS, KEY, v);
  }

  function isSetUp() { return !!loadVault(); }
  function isUnlocked() { return !!state.secret; }

  async function setup(passphrase) {
    if (isSetUp()) throw new Error('already-set-up');
    if (!passphrase || passphrase.length < 8) throw new Error('passphrase-too-short');
    const secret = crypto.getRandomValues(new Uint8Array(SECRET_BYTES));
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const wrapKey = await pbkdf2(passphrase, salt, PBKDF2_ITER);
    const payload = new TextEncoder().encode(JSON.stringify({ sk: b64uEnc(secret), created: new Date().toISOString() }));
    const enc = await encryptWith(wrapKey, payload);
    const vault = {
      v: 1,
      pass: { salt: b64uEnc(salt), iter: PBKDF2_ITER, hash: 'SHA-256', iv: enc.iv, ct: enc.ct }
    };
    saveVault(vault);
    state.secret = secret;
    return true;
  }

  async function unlock(passphrase) {
    const vault = loadVault();
    if (!vault || !vault.pass) throw new Error('no-vault');
    const wrapKey = await pbkdf2(passphrase, b64uDec(vault.pass.salt), vault.pass.iter);
    const ptBytes = await decryptWith(wrapKey, { iv: vault.pass.iv, ct: vault.pass.ct });
    const data = JSON.parse(new TextDecoder().decode(ptBytes));
    if (!data || typeof data.sk !== 'string') throw new Error('corrupt-vault');
    state.secret = b64uDec(data.sk);
    return true;
  }

  function lock() { state.secret = null; }

  function getSecret() {
    if (!state.secret) throw new Error('locked');
    return state.secret;
  }

  function clearVault() {
    if (global.MentriaStore) global.MentriaStore.remove(NS, KEY);
    state.secret = null;
  }

  global.MentriaIdentity = { setup, unlock, lock, isSetUp, isUnlocked, getSecret, clearVault };
})(typeof window !== 'undefined' ? window : globalThis);
