(function (g) {
  'use strict';

  const PIECE = 262144;
  const SLOT = PIECE + 28;
  const te = new TextEncoder();
  const td = new TextDecoder();

  const pieceCount = (size) => Math.max(0, Math.ceil((Number(size) || 0) / PIECE));
  const pieceLength = (size, i) => Math.max(0, Math.min(PIECE, (Number(size) || 0) - i * PIECE));
  const slotLength = (size, i) => {
    const n = pieceLength(size, i);
    return n ? n + 28 : 0;
  };
  const slotOffset = (i) => i * SLOT;
  const piecesFor = (size, start, end) => {
    const last = Math.min(Number(end), Number(size) - 1);
    return { first: Math.floor(Number(start) / PIECE), last: Math.floor(last / PIECE) };
  };

  const adFor = (id, i) => te.encode('media|' + id + '|' + i);

  const sealPiece = async (key, id, i, plain) => {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: adFor(id, i) }, key, plain));
    const out = new Uint8Array(12 + ct.length);
    out.set(iv, 0);
    out.set(ct, 12);
    return out;
  };

  const openPiece = async (key, id, i, slot) => {
    const s = slot instanceof Uint8Array ? slot : new Uint8Array(slot);
    if (s.length < 28) throw Object.assign(new Error('missing'), { code: 'missing' });
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: s.subarray(0, 12), additionalData: adFor(id, i) }, key, s.subarray(12)));
  };

  const openJson = async (key, enc, ad) => JSON.parse(td.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: enc.iv, additionalData: te.encode(ad) }, key, enc.ct)));

  const sha256 = async (bytes) => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));

  const b64url = (bytes) => {
    let s = '';
    for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };

  const b64 = (bytes) => {
    let s = '';
    const step = 32768;
    for (let i = 0; i < bytes.length; i += step) s += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
    return btoa(s);
  };

  const fromB64 = (str) => {
    const raw = atob(String(str || ''));
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
    return out;
  };

  const joinHashes = (hashes) => {
    const out = new Uint8Array(hashes.length * 32);
    hashes.forEach((h, i) => out.set(h, i * 32));
    return out;
  };

  const splitHashes = (bytes) => {
    const out = [];
    for (let i = 0; i + 32 <= bytes.length; i += 32) out.push(bytes.slice(i, i + 32));
    return out;
  };

  const manifestHash = async (hashes) => b64url(await sha256(joinHashes(hashes)));

  const bfNew = (n) => new Uint8Array(Math.ceil(Math.max(0, n) / 8));
  const bfSet = (bf, i) => { bf[i >> 3] |= 0x80 >> (i & 7); return bf; };
  const bfHas = (bf, i) => !!(bf[i >> 3] & (0x80 >> (i & 7)));
  const bfCount = (bf) => {
    let c = 0;
    for (let i = 0; i < bf.length; i += 1) {
      let v = bf[i];
      while (v) { c += v & 1; v >>= 1; }
    }
    return c;
  };
  const bfB64 = (bf) => b64(bf);
  const bfFrom = (str, n) => {
    const out = bfNew(n);
    try { out.set(fromB64(str).subarray(0, out.length)); } catch (_) {}
    const spare = out.length * 8 - n;
    if (spare > 0 && out.length) out[out.length - 1] &= (0xFF << spare) & 0xFF;
    return out;
  };
  const bfFull = (bf, n) => {
    for (let i = 0; i < n; i += 1) if (!bfHas(bf, i)) return false;
    return true;
  };

  g.MentriaMediaFormat = {
    PIECE, SLOT,
    pieceCount, pieceLength, slotLength, slotOffset, piecesFor,
    sealPiece, openPiece, openJson, sha256, manifestHash,
    b64url, b64, fromB64, joinHashes, splitHashes,
    bfNew, bfSet, bfHas, bfCount, bfB64, bfFrom, bfFull
  };
})(typeof self !== 'undefined' ? self : globalThis);
