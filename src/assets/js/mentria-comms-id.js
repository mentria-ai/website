const NS = 'comms';
const KEYS_KEY = 'idkeys';
const PROFILE_KEY = 'profile';
const CONTACTS_KEY = 'contacts';

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
  store().set(NS, KEYS_KEY, {
    v: 1,
    pub: { kty: publicJwk.kty, crv: publicJwk.crv, x: publicJwk.x, y: publicJwk.y },
    wrapped: { iv: b64uEnc(iv), ct: b64uEnc(new Uint8Array(ct)) }
  });
  return { publicJwk, privateKey: pair.privateKey };
};

export const fingerprint = async (pubJwk) => {
  const digest = await crypto.subtle.digest('SHA-256', te.encode('mentria-id-v1|' + pubJwk.x + '|' + pubJwk.y));
  const bytes = new Uint8Array(digest).slice(0, 5);
  const alpha = 'abcdefghjkmnpqrstuvwxyz23456789';
  let bits = 0, value = 0, out = '';
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i]; bits += 8;
    while (bits >= 5) { out += alpha[(value >>> (bits - 5)) & 0x1f]; bits -= 5; }
  }
  return out.slice(0, 4) + '-' + out.slice(4, 8);
};

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
    roomName: '!dm-' + b64uEnc(nameHash.slice(0, 9)),
    b64Key: b64uEnc(keyHash)
  };
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

export const addContact = async (payload) => {
  if (!payload || !payload.pub || !payload.pub.x || !payload.pub.y) throw new Error('bad contact code');
  const fp = await fingerprint(payload.pub);
  const contacts = getContacts();
  const existing = contacts.find((c) => c.fp === fp);
  if (existing) {
    existing.name = String(payload.name || existing.name || '').slice(0, 32);
    if (payload.ring) existing.ring = String(payload.ring).slice(0, 64);
  } else {
    contacts.push({
      fp,
      name: String(payload.name || '').slice(0, 32),
      pub: { x: payload.pub.x, y: payload.pub.y },
      ring: payload.ring ? String(payload.ring).slice(0, 64) : undefined,
      addedAt: Date.now()
    });
  }
  store().set(NS, CONTACTS_KEY, contacts);
  return contacts.find((c) => c.fp === fp);
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
