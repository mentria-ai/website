(function (global) {
  'use strict';

  const NS = 'identity';
  const KEY = 'vault';
  const PBKDF2_ITER = 600000;
  const SALT_BYTES = 16;
  const IV_BYTES = 12;
  const SECRET_BYTES = 32;
  const KCV_PREFIX = 'mentria-kcv-v1';
  const HKDF_INFO = 'mentria-vault-prf-v1';
  const RP_NAME = 'Mentria';
  const IDB_NAME = 'mentria-identity';
  const IDB_STORE = 'keys';
  const IDB_DEVICE_KEY = 'device-wrap';

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
  async function hkdfKey(ikm, salt) {
    const baseKey = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode(HKDF_INFO) },
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

  async function kcvOf(secret) {
    const data = new Uint8Array(KCV_PREFIX.length + secret.length);
    data.set(new TextEncoder().encode(KCV_PREFIX), 0);
    data.set(secret, KCV_PREFIX.length);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
    return b64uEnc(digest.slice(0, 16));
  }
  function timingSafeEq(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
  }

  const state = { secret: null };

  function cryptoReady() {
    try {
      return !!(global.crypto && global.crypto.subtle && typeof global.crypto.subtle.importKey === 'function');
    } catch (_) { return false; }
  }
  function requireCrypto() {
    if (!cryptoReady()) throw new Error('insecure-context');
  }

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

  async function acceptSecret(secret, vault) {
    if (vault.kcv) {
      const kcv = await kcvOf(secret);
      if (!timingSafeEq(b64uDec(kcv), b64uDec(vault.kcv))) throw new Error('kcv-mismatch');
    }
    state.secret = secret;
  }

  async function setup(passphrase) {
    requireCrypto();
    if (isSetUp()) throw new Error('already-set-up');
    if (!passphrase || passphrase.length < 8) throw new Error('passphrase-too-short');
    const secret = crypto.getRandomValues(new Uint8Array(SECRET_BYTES));
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const wrapKey = await pbkdf2(passphrase, salt, PBKDF2_ITER);
    const payload = new TextEncoder().encode(JSON.stringify({ sk: b64uEnc(secret), created: new Date().toISOString() }));
    const enc = await encryptWith(wrapKey, payload);
    const vault = {
      v: 2,
      kcv: await kcvOf(secret),
      pass: { salt: b64uEnc(salt), iter: PBKDF2_ITER, hash: 'SHA-256', iv: enc.iv, ct: enc.ct }
    };
    saveVault(vault);
    state.secret = secret;
    return true;
  }

  async function unlock(passphrase) {
    requireCrypto();
    const vault = loadVault();
    if (!vault || !vault.pass) throw new Error('no-vault');
    const wrapKey = await pbkdf2(passphrase, b64uDec(vault.pass.salt), vault.pass.iter);
    const ptBytes = await decryptWith(wrapKey, { iv: vault.pass.iv, ct: vault.pass.ct });
    const data = JSON.parse(new TextDecoder().decode(ptBytes));
    if (!data || typeof data.sk !== 'string') throw new Error('corrupt-vault');
    const secret = b64uDec(data.sk);
    if (!vault.kcv || vault.v !== 2) {
      vault.v = 2;
      vault.kcv = await kcvOf(secret);
      saveVault(vault);
    }
    await acceptSecret(secret, vault);
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
    idbDelete().catch(function () {});
  }

  async function passkeySupport() {
    try {
      if (!cryptoReady()) return 'no';
      if (!global.PublicKeyCredential) return 'no';
      if (typeof PublicKeyCredential.getClientCapabilities === 'function') {
        const caps = await PublicKeyCredential.getClientCapabilities();
        if (caps && caps['extension:prf'] === false) return 'no';
        if (caps && caps['extension:prf'] === true) return 'likely';
      }
      return 'unknown';
    } catch (_) {
      return 'unknown';
    }
  }

  function hasPasskey() {
    const v = loadVault();
    return !!(v && v.prf && v.prf.credId);
  }

  function prfFromCredential(cred) {
    try {
      const ext = cred.getClientExtensionResults();
      if (ext && ext.prf && ext.prf.results && ext.prf.results.first) return new Uint8Array(ext.prf.results.first);
    } catch (_) {}
    return null;
  }

  async function assertPrf(credId, prfSalt) {
    const cred = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rpId: location.hostname,
        allowCredentials: [{ type: 'public-key', id: credId }],
        userVerification: 'required',
        extensions: { prf: { eval: { first: prfSalt } } }
      }
    });
    if (!cred) throw new Error('no-credential');
    return prfFromCredential(cred);
  }

  async function enrollPasskey() {
    requireCrypto();
    if (!state.secret) throw new Error('locked');
    const vault = loadVault();
    if (!vault) throw new Error('no-vault');
    if (!global.PublicKeyCredential || !navigator.credentials) throw new Error('prf-unsupported');
    const prfSalt = crypto.getRandomValues(new Uint8Array(32));
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { id: location.hostname, name: RP_NAME },
        user: {
          id: crypto.getRandomValues(new Uint8Array(16)),
          name: 'mentria identity',
          displayName: 'Mentria identity'
        },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        extensions: { prf: { eval: { first: prfSalt } } }
      }
    });
    if (!cred) throw new Error('prf-unsupported');
    const credId = new Uint8Array(cred.rawId);
    const k1bytes = prfFromCredential(cred);
    const k2bytes = await assertPrf(credId, prfSalt);
    if (!k2bytes) throw new Error('prf-unsupported');
    if (k1bytes && !timingSafeEq(k1bytes, k2bytes)) throw new Error('prf-mismatch');
    const hkdfSalt = crypto.getRandomValues(new Uint8Array(32));
    const wrapKey = await hkdfKey(k2bytes, hkdfSalt);
    const enc = await encryptWith(wrapKey, state.secret);
    const fresh = loadVault();
    if (!fresh) throw new Error('no-vault');
    fresh.prf = {
      credId: b64uEnc(credId),
      prfSalt: b64uEnc(prfSalt),
      hkdfSalt: b64uEnc(hkdfSalt),
      iv: enc.iv,
      ct: enc.ct,
      created: new Date().toISOString()
    };
    if (!fresh.kcv) fresh.kcv = await kcvOf(state.secret);
    fresh.v = 2;
    saveVault(fresh);
    return true;
  }

  async function unlockWithPasskey() {
    requireCrypto();
    const vault = loadVault();
    if (!vault || !vault.prf) throw new Error('no-passkey');
    const prf = await assertPrf(b64uDec(vault.prf.credId), b64uDec(vault.prf.prfSalt));
    if (!prf) throw new Error('prf-unsupported');
    const wrapKey = await hkdfKey(prf, b64uDec(vault.prf.hkdfSalt));
    const secret = await decryptWith(wrapKey, { iv: vault.prf.iv, ct: vault.prf.ct });
    await acceptSecret(secret, vault);
    return true;
  }

  function removePasskey() {
    const vault = loadVault();
    if (!vault || !vault.prf) return;
    delete vault.prf;
    saveVault(vault);
  }

  function idbOpen() {
    return new Promise(function (resolve, reject) {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore(IDB_STORE); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function idbGet(db, key) {
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key);
      tx.onsuccess = function () { resolve(tx.result); };
      tx.onerror = function () { reject(tx.error); };
    });
  }
  function idbSet(db, key, value) {
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE).put(value, key);
      tx.onsuccess = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
    });
  }
  function idbDel(db, key) {
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE).delete(key);
      tx.onsuccess = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
    });
  }
  function idbDelete() {
    return idbOpen().then(function (db) { return idbDel(db, IDB_DEVICE_KEY).then(function () { db.close(); }); });
  }

  function hasDeviceUnlock() {
    const v = loadVault();
    return !!(v && v.device);
  }

  async function setDeviceUnlock(on) {
    const vault = loadVault();
    if (!vault) throw new Error('no-vault');
    if (!on) {
      delete vault.device;
      saveVault(vault);
      await idbDelete().catch(function () {});
      return false;
    }
    if (!state.secret) throw new Error('locked');
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const enc = await encryptWith(key, state.secret);
    const db = await idbOpen();
    await idbSet(db, IDB_DEVICE_KEY, key);
    db.close();
    const fresh = loadVault();
    if (!fresh) throw new Error('no-vault');
    fresh.device = { iv: enc.iv, ct: enc.ct, created: new Date().toISOString() };
    if (!fresh.kcv) fresh.kcv = await kcvOf(state.secret);
    fresh.v = 2;
    saveVault(fresh);
    return true;
  }

  async function tryDeviceUnlock() {
    try {
      if (state.secret) return true;
      const vault = loadVault();
      if (!vault || !vault.device) return false;
      const db = await idbOpen();
      const key = await idbGet(db, IDB_DEVICE_KEY);
      db.close();
      if (!key) return false;
      const secret = await decryptWith(key, { iv: vault.device.iv, ct: vault.device.ct });
      await acceptSecret(secret, vault);
      return true;
    } catch (_) {
      return false;
    }
  }

  global.MentriaIdentity = {
    cryptoReady,
    setup, unlock, lock, isSetUp, isUnlocked, getSecret, clearVault,
    passkeySupport, hasPasskey, enrollPasskey, unlockWithPasskey, removePasskey,
    hasDeviceUnlock, setDeviceUnlock, tryDeviceUnlock
  };
})(typeof window !== 'undefined' ? window : globalThis);
