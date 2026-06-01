(function (global) {
  'use strict';

  const ITER = 600000;
  const HASH = 'SHA-256';
  const SALT_BYTES = 16;
  const IV_BYTES = 12;
  const KEY_LENGTH = 256;
  const ENVELOPE_VERSION = 1;
  const MAX_PAYLOAD_BYTES = 32 * 1024 * 1024;

  const b64uEncode = (bytes) => {
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };

  const b64uDecode = (str) => {
    if (typeof str !== 'string') throw new Error('expected base64url string');
    const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    const pad = (4 - (b64.length % 4)) % 4;
    const decoded = atob(b64 + '='.repeat(pad));
    const out = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) out[i] = decoded.charCodeAt(i);
    return out;
  };

  const deriveKey = async (passphrase, saltBytes) => {
    if (typeof passphrase !== 'string' || passphrase.length < 8) {
      throw new Error('passphrase must be at least 8 characters');
    }
    const pw = new TextEncoder().encode(passphrase);
    const baseKey = await crypto.subtle.importKey('raw', pw, 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: saltBytes, iterations: ITER, hash: HASH },
      baseKey,
      { name: 'AES-GCM', length: KEY_LENGTH },
      false,
      ['encrypt', 'decrypt']
    );
  };

  const encryptBackup = async (data, passphrase) => {
    const json = JSON.stringify(data);
    const plaintext = new TextEncoder().encode(json);
    if (plaintext.byteLength > MAX_PAYLOAD_BYTES) {
      throw new Error('payload too large');
    }
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const key = await deriveKey(passphrase, salt);
    const ctBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, plaintext);
    return {
      v: ENVELOPE_VERSION,
      kdf: 'PBKDF2',
      iter: ITER,
      hash: HASH,
      salt: b64uEncode(salt),
      iv: b64uEncode(iv),
      ct: b64uEncode(new Uint8Array(ctBuf))
    };
  };

  const validateEnvelope = (env) => {
    if (!env || typeof env !== 'object') throw new Error('not an envelope');
    if (env.v !== ENVELOPE_VERSION) throw new Error('unsupported envelope version: ' + env.v);
    if (env.kdf !== 'PBKDF2') throw new Error('unsupported kdf: ' + env.kdf);
    if (env.hash !== 'SHA-256') throw new Error('unsupported hash: ' + env.hash);
    if (typeof env.iter !== 'number' || env.iter < 100000 || env.iter > 10000000) {
      throw new Error('iteration count out of range');
    }
    for (const k of ['salt', 'iv', 'ct']) {
      if (typeof env[k] !== 'string' || env[k].length === 0 || env[k].length > 8 * 1024 * 1024) {
        throw new Error('missing or oversized field: ' + k);
      }
    }
  };

  const decryptBackup = async (envelope, passphrase) => {
    validateEnvelope(envelope);
    const salt = b64uDecode(envelope.salt);
    const iv = b64uDecode(envelope.iv);
    const ct = b64uDecode(envelope.ct);
    if (salt.byteLength !== SALT_BYTES) throw new Error('bad salt length');
    if (iv.byteLength !== IV_BYTES) throw new Error('bad iv length');

    const pw = new TextEncoder().encode(passphrase);
    const baseKey = await crypto.subtle.importKey('raw', pw, 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: salt, iterations: envelope.iter, hash: envelope.hash },
      baseKey,
      { name: 'AES-GCM', length: KEY_LENGTH },
      false,
      ['decrypt']
    );

    let ptBuf;
    try {
      ptBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, ct);
    } catch (_) {
      throw new Error('wrong passphrase or corrupted file');
    }
    const text = new TextDecoder().decode(ptBuf);
    let parsed;
    try { parsed = JSON.parse(text); } catch (_) { throw new Error('decrypted payload is not valid JSON'); }
    if (!parsed || typeof parsed !== 'object') throw new Error('decrypted payload is not an object');
    return parsed;
  };

  const downloadBackupJson = (envelope, filenameStem) => {
    const blob = new Blob([JSON.stringify(envelope)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (filenameStem || 'mentria-backup') + '-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const scorePassphrase = (s) => {
    if (typeof s !== 'string' || s.length === 0) return { score: 0, label: 'weak' };
    let score = 0;
    if (s.length >= 8) score++;
    if (s.length >= 12) score++;
    if (s.length >= 16) score++;
    if (/[a-z]/.test(s) && /[A-Z]/.test(s)) score++;
    if (/\d/.test(s)) score++;
    if (/[^A-Za-z0-9]/.test(s)) score++;
    if (/(.)\1{2,}/.test(s)) score = Math.max(0, score - 1);
    if (score <= 2) return { score, label: 'weak' };
    if (score <= 4) return { score, label: 'medium' };
    return { score, label: 'strong' };
  };

  global.MentriaBackup = {
    encryptBackup, decryptBackup, validateEnvelope,
    downloadBackupJson, scorePassphrase,
    ITER, ENVELOPE_VERSION
  };
})(typeof window !== 'undefined' ? window : globalThis);
