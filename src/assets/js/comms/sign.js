export const SIG_LABEL = 'mentria-sig-v1';

const te = new TextEncoder();
const FP_ALPHA = 'abcdefghjkmnpqrstuvwxyz234567890';
const ALG = { name: 'ECDSA', hash: 'SHA-256' };

const b64uEnc = (bytes) => {
  const u = new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
};
const b64uDec = (str) => {
  const b64 = String(str).replaceAll('-', '+').replaceAll('_', '/');
  return Uint8Array.from(atob(b64 + '='.repeat((4 - b64.length % 4) % 4)), (c) => c.charCodeAt(0));
};

const sigInput = (room, cmid, ts, body) => te.encode(SIG_LABEL + '|' + room + '|' + cmid + '|' + ts + '|' + JSON.stringify(body));

const pubCache = new Map();
const importPub = (spub) => {
  const id = spub.x + '|' + spub.y;
  if (!pubCache.has(id)) {
    pubCache.set(id, crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: spub.x, y: spub.y, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']).catch(() => null));
    if (pubCache.size > 200) pubCache.delete(pubCache.keys().next().value);
  }
  return pubCache.get(id);
};

export const validSpub = (spub) => !!spub && typeof spub === 'object' && typeof spub.x === 'string' && typeof spub.y === 'string' && spub.x.length > 0 && spub.y.length > 0 && spub.x.length <= 64 && spub.y.length <= 64;

export const sigFingerprint = async (spub) => {
  const digest = await crypto.subtle.digest('SHA-256', te.encode(SIG_LABEL + '|' + spub.x + '|' + spub.y));
  const bytes = new Uint8Array(digest).slice(0, 5);
  let bits = 0, value = 0, out = '';
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i]; bits += 8;
    while (bits >= 5) { out += FP_ALPHA[(value >>> (bits - 5)) & 0x1f]; bits -= 5; }
  }
  return out.slice(0, 4) + '-' + out.slice(4, 8);
};

const LINK_LABEL = 'mentria-link-v1';
const linkInput = (pub) => te.encode(LINK_LABEL + '|' + pub.x + '|' + pub.y);

export const signLink = async (signKey, pub) => b64uEnc(await crypto.subtle.sign(ALG, signKey, linkInput(pub)));

export const verifyLink = async (pub, spub, s) => {
  if (!validSpub(pub) || !validSpub(spub) || typeof s !== 'string') return false;
  try {
    const key = await importPub(spub);
    if (!key) return false;
    const raw = b64uDec(s);
    if (raw.length !== 64) return false;
    return await crypto.subtle.verify(ALG, key, raw, linkInput(pub));
  } catch (_) { return false; }
};

export const signBody = async (signKey, spub, room, cmid, body, ts = Date.now()) => {
  const sig = await crypto.subtle.sign(ALG, signKey, sigInput(room, cmid, ts, body));
  return Object.assign({}, body, { sg: { pub: { x: spub.x, y: spub.y }, ts, s: b64uEnc(sig) } });
};

export const verifyBody = async (obj, room, cmid) => {
  const no = { ok: false };
  if (!obj || typeof obj !== 'object' || !obj.sg || typeof obj.sg !== 'object') return no;
  const { sg, ...body } = obj;
  if (!validSpub(sg.pub) || typeof sg.s !== 'string' || typeof sg.ts !== 'number' || !Number.isFinite(sg.ts)) return no;
  try {
    const key = await importPub(sg.pub);
    if (!key) return no;
    const s = b64uDec(sg.s);
    if (s.length !== 64) return no;
    if (!(await crypto.subtle.verify(ALG, key, s, sigInput(room, cmid, sg.ts, body)))) return no;
    const spub = { x: sg.pub.x, y: sg.pub.y };
    return { ok: true, spub, sigFp: await sigFingerprint(spub), ts: sg.ts };
  } catch (_) { return no; }
};

export const signRoomBody = async (body, room, cmid, ident, dev, ts = Date.now()) => {
  let out = body;
  if (dev && dev.signKey && validSpub(dev.spub)) {
    const d = await signBody(dev.signKey, dev.spub, room, cmid, body, ts);
    out = Object.assign({}, body, { dsg: d.sg });
  }
  return ident && ident.signKey && validSpub(ident.spub) ? signBody(ident.signKey, ident.spub, room, cmid, out, ts) : out;
};
