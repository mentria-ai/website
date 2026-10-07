const NS = 'comms';
const KEYS_KEY = 'idkeys';
const PROFILE_KEY = 'profile';
const CONTACTS_KEY = 'contacts';
const FP_ALPHA = 'abcdefghjkmnpqrstuvwxyz234567890';

const te = new TextEncoder();

const b64uEnc = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const b64uDec = (str) => {
  const b64 = str.replaceAll('-', '+').replaceAll('_', '/');
  const padded = b64 + '='.repeat((4 - b64.length % 4) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
};

const store = () => window.MentriaStore;

const wrapKeyFromSecret = async () => {
  const secret = window.MentriaIdentity.getSecret();
  return crypto.subtle.importKey('raw', secret, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
};

export const idState = () => {
  const I = window.MentriaIdentity;
  if (!I || !window.MentriaStore) return 'unavailable';
  if (!I.isSetUp()) return 'none';
  if (!I.isUnlocked()) return 'locked';
  return 'unlocked';
};

export const ensureKeypair = async () => {
  const wrapKey = await wrapKeyFromSecret();
  const stored = store().get(NS, KEYS_KEY);
  if (stored && stored.pub && stored.wrapped) {
    const iv = b64uDec(stored.wrapped.iv);
    const ct = b64uDec(stored.wrapped.ct);
    const pkcs8 = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, wrapKey, ct);
    const privateKey = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
    return { publicJwk: stored.pub, privateKey };
  }
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', pair.privateKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrapKey, pkcs8);
  const saved = store().set(NS, KEYS_KEY, {
    v: 1,
    pub: { kty: publicJwk.kty, crv: publicJwk.crv, x: publicJwk.x, y: publicJwk.y },
    wrapped: { iv: b64uEnc(iv), ct: b64uEnc(new Uint8Array(ct)) }
  });
  if (!saved) throw new Error('storage-full');
  return { publicJwk, privateKey: pair.privateKey };
};

const fpSymbols = async (pubJwk) => {
  const digest = await crypto.subtle.digest('SHA-256', te.encode('mentria-id-v1|' + pubJwk.x + '|' + pubJwk.y));
  const bytes = new Uint8Array(digest).slice(0, 5);
  const out = [];
  let bits = 0, value = 0;
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i]; bits += 8;
    while (bits >= 5) { out.push((value >>> (bits - 5)) & 0x1f); bits -= 5; }
  }
  return out;
};

const fpFrom = (symbols, legacy) => {
  const s = symbols.map((v) => (legacy && v === 31 ? 'undefined' : FP_ALPHA[v])).join('');
  return s.slice(0, 4) + '-' + s.slice(4, 8);
};

export const fingerprint = async (pubJwk) => fpFrom(await fpSymbols(pubJwk), false);

export const legacyFingerprint = async (pubJwk) => fpFrom(await fpSymbols(pubJwk), true);

const samePub = (a, b) => !!(a && b && a.x === b.x && a.y === b.y);

export const deriveDm = async (privateKey, theirPubJwk) => {
  const theirKey = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', x: theirPubJwk.x, y: theirPubJwk.y },
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: theirKey }, privateKey, 256));
  const nameHash = new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode('mentria-dm-room-v1|' + b64uEnc(bits))));
  const keyHash = new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode('mentria-dm-key-v1|' + b64uEnc(bits))));
  return {
    roomName: 'dm-' + b64uEnc(nameHash.slice(0, 9)),
    b64Key: b64uEnc(keyHash)
  };
};

export const inboxTopic = async (pubJwk) => {
  const digest = await crypto.subtle.digest('SHA-256', te.encode('mentria-inbox-v1|' + pubJwk.x + '|' + pubJwk.y));
  return 'mentria-inbox-v1|' + b64uEnc(new Uint8Array(digest).slice(0, 12));
};

const importPub = (pub) => crypto.subtle.importKey(
  'jwk',
  { kty: 'EC', crv: 'P-256', x: pub.x, y: pub.y },
  { name: 'ECDH', namedCurve: 'P-256' },
  false,
  []
);

const pairProofKey = async (privateKey, theirPubJwk) => {
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: await importPub(theirPubJwk) }, privateKey, 256);
  const base = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: te.encode('mentria-pair-proof'), info: te.encode('mentria-pair-proof-v1') },
    base,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign', 'verify']
  );
};

export const pairProof = async (privateKey, theirPubJwk, parts) => {
  const key = await pairProofKey(privateKey, theirPubJwk);
  return b64uEnc(new Uint8Array(await crypto.subtle.sign('HMAC', key, te.encode(parts.join('|')))));
};

export const checkPairProof = async (privateKey, theirPubJwk, parts, proof) => {
  if (typeof proof !== 'string' || !proof || proof.length > 100) return false;
  try {
    const key = await pairProofKey(privateKey, theirPubJwk);
    return await crypto.subtle.verify('HMAC', key, b64uDec(proof), te.encode(parts.join('|')));
  } catch (_) {
    return false;
  }
};

const inboxProofParts = async (epkX, senderPub, recipientPub, payload) => [
  'mentria-inbox-proof-v1',
  epkX,
  await fingerprint(senderPub),
  await fingerprint(recipientPub),
  JSON.stringify([String(payload.kind || ''), String(payload.name || ''), String(payload.ring || ''), String(payload.note || ''), Number(payload.ts) || 0])
];

const sealKey = async (bits, epkX) => {
  const base = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: te.encode(epkX), info: te.encode('mentria-inbox-seal-v1') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
};

export const sealToInbox = async (theirPubJwk, payload, myPrivateKey) => {
  const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const epk = await crypto.subtle.exportKey('jwk', eph.publicKey);
  const theirKey = await importPub(theirPubJwk);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: theirKey }, eph.privateKey, 256));
  const key = await sealKey(bits, epk.x);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = Object.assign({}, payload);
  if (myPrivateKey && body.pub) body.proof = await pairProof(myPrivateKey, theirPubJwk, await inboxProofParts(epk.x, body.pub, theirPubJwk, body));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(JSON.stringify(body)));
  return { v: 1, epk: { x: epk.x, y: epk.y }, iv: b64uEnc(iv), ct: b64uEnc(new Uint8Array(ct)) };
};

export const openInboxEnvelope = async (myPrivateKey, envelope, myPubJwk) => {
  if (!envelope || envelope.v !== 1 || !envelope.epk || !envelope.iv || !envelope.ct) return null;
  try {
    const ephKey = await importPub(envelope.epk);
    const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: ephKey }, myPrivateKey, 256));
    const key = await sealKey(bits, envelope.epk.x);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64uDec(envelope.iv) }, key, b64uDec(envelope.ct));
    const payload = JSON.parse(new TextDecoder().decode(pt));
    if (!payload || payload.v !== 1 || !payload.pub || !payload.pub.x || !payload.pub.y) return null;
    payload.verified = !!myPubJwk && await checkPairProof(myPrivateKey, payload.pub, await inboxProofParts(envelope.epk.x, payload.pub, myPubJwk, payload), payload.proof);
    return payload;
  } catch (_) {
    return null;
  }
};

export const getRequests = () => {
  const r = store() && store().get(NS, 'requests');
  return Array.isArray(r) ? r : [];
};

export const saveRequest = async (payload) => {
  const fp = await fingerprint(payload.pub);
  if (getContacts().some((c) => samePub(c.pub, payload.pub))) return null;
  const list = getRequests();
  if (list.some((r) => samePub(r.pub, payload.pub))) return null;
  const entry = {
    fp,
    name: String(payload.name || '').slice(0, 32),
    pub: { x: payload.pub.x, y: payload.pub.y },
    ring: payload.ring ? String(payload.ring).slice(0, 64) : undefined,
    note: payload.note ? String(payload.note).slice(0, 140) : undefined,
    ts: Date.now()
  };
  list.push(entry);
  if (!store().set(NS, 'requests', list.slice(-20))) return null;
  return entry;
};

export const dropRequest = (fp) => {
  const list = getRequests().filter((r) => r.fp !== fp);
  if (list.length) store().set(NS, 'requests', list);
  else store().remove(NS, 'requests');
};

export const getUnread = () => {
  const u = store() && store().get(NS, 'unread');
  return (u && typeof u === 'object') ? u : {};
};

export const setUnread = (map) => {
  store().set(NS, 'unread', map || {});
};

export const getProfile = () => {
  const p = store() && store().get(NS, PROFILE_KEY);
  return (p && typeof p.name === 'string') ? p : { name: '' };
};

export const setProfile = (profile) => {
  const name = String(profile.name || '').trim().slice(0, 32);
  store().set(NS, PROFILE_KEY, { name });
  return { name };
};

export const getContacts = () => {
  const c = store() && store().get(NS, CONTACTS_KEY);
  return Array.isArray(c) ? c : [];
};

export const contactByPub = (pub) => getContacts().find((c) => samePub(c.pub, pub)) || null;

export const addContact = async (payload) => {
  if (!payload || !payload.pub || !payload.pub.x || !payload.pub.y) throw new Error('bad contact code');
  const fp = await fingerprint(payload.pub);
  const contacts = getContacts();
  let entry = contacts.find((c) => samePub(c.pub, payload.pub));
  if (entry) {
    if (typeof payload.annTs === 'number' && payload.annTs <= (entry.annTs || 0)) return entry;
    entry.name = String(payload.name || entry.name || '').slice(0, 32);
    if (payload.ring) entry.ring = String(payload.ring).slice(0, 64);
  } else {
    entry = {
      fp,
      name: String(payload.name || '').slice(0, 32),
      pub: { x: payload.pub.x, y: payload.pub.y },
      ring: payload.ring ? String(payload.ring).slice(0, 64) : undefined,
      addedAt: Date.now()
    };
    contacts.push(entry);
  }
  if (typeof payload.annTs === 'number' && payload.annTs > (entry.annTs || 0)) entry.annTs = payload.annTs;
  if (!store().set(NS, CONTACTS_KEY, contacts)) throw new Error('storage-full');
  return entry;
};

const pubKey = (pub) => pub.x + '|' + pub.y;
const hasPub = (item) => !!(item && item.pub && item.pub.x && item.pub.y);
const has = (map, k) => Object.prototype.hasOwnProperty.call(map, k);
const maxOf = (a, b, k) => Math.max((a && a[k]) || 0, (b && b[k]) || 0);
const MERGE = {
  unread: (a, b) => ({ n: maxOf(a, b, 'n'), lastTs: maxOf(a, b, 'lastTs') }),
  missed: (a, b) => ({ n: maxOf(a, b, 'n'), ts: maxOf(a, b, 'ts') }),
  sentlog: (a, b) => Array.from(new Set([].concat(Array.isArray(b) ? b : [], Array.isArray(a) ? a : []))).slice(-300)
};

export const migrateFingerprints = async () => {
  const contacts = getContacts();
  const requests = getRequests();
  const fps = new Map();
  for (const item of contacts.concat(requests)) {
    if (!hasPub(item) || fps.has(pubKey(item.pub))) continue;
    const symbols = await fpSymbols(item.pub);
    fps.set(pubKey(item.pub), { fp: fpFrom(symbols, false), old: fpFrom(symbols, true) });
  }
  const moves = new Map();
  const fixList = (list) => {
    const out = [];
    let changed = false;
    for (const item of list) {
      const f = hasPub(item) ? fps.get(pubKey(item.pub)) : null;
      if (!f) { out.push(item); continue; }
      [item.fp, f.old].forEach((from) => { if (typeof from === 'string' && from !== f.fp) moves.set(from, f.fp); });
      const twin = out.find((o) => hasPub(o) && samePub(o.pub, item.pub));
      if (twin) {
        if (!twin.name && item.name) twin.name = item.name;
        if (!twin.ring && item.ring) twin.ring = item.ring;
        changed = true;
        continue;
      }
      if (item.fp !== f.fp) { item.fp = f.fp; changed = true; }
      out.push(item);
    }
    return { out, changed };
  };
  const fixedContacts = fixList(contacts);
  const fixedRequests = fixList(requests);
  if (fixedContacts.changed && !store().set(NS, CONTACTS_KEY, fixedContacts.out)) return;
  if (fixedRequests.changed) store().set(NS, 'requests', fixedRequests.out);
  fixedContacts.out.concat(fixedRequests.out).forEach((item) => { if (item && item.fp) moves.delete(item.fp); });
  if (!moves.size) return;
  for (const key of Object.keys(MERGE)) {
    const map = store().get(NS, key);
    if (!map || typeof map !== 'object' || Array.isArray(map)) continue;
    let changed = false;
    moves.forEach((to, from) => {
      if (!has(map, from)) return;
      map[to] = has(map, to) ? MERGE[key](map[to], map[from]) : map[from];
      delete map[from];
      changed = true;
    });
    if (changed) store().set(NS, key, map);
  }
};

export const removeContact = (fp) => {
  const contacts = getContacts().filter((c) => c.fp !== fp);
  if (contacts.length) store().set(NS, CONTACTS_KEY, contacts);
  else store().remove(NS, CONTACTS_KEY);
};

export const encodeContactCode = (profile, pubJwk, ring) => {
  const payload = { v: 1, name: profile.name || '', pub: { x: pubJwk.x, y: pubJwk.y } };
  if (ring) payload.ring = ring;
  return 'MC1.' + b64uEnc(te.encode(JSON.stringify(payload)));
};

export const decodeContactCode = (code) => {
  const raw = String(code || '').trim();
  if (!raw.startsWith('MC1.')) throw new Error('not a contact code');
  const json = new TextDecoder().decode(b64uDec(raw.slice(4)));
  const payload = JSON.parse(json);
  if (!payload || payload.v !== 1 || !payload.pub) throw new Error('bad contact code');
  return payload;
};
