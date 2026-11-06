export const CHAT_TOPIC_V2 = 'mentria-comms-topic-v2|';
export const CHAT_KIND = 3838;
export const EPHEMERAL_PREFIX = '!';
export const HISTORY_LOOKBACK_SEC = 7 * 24 * 60 * 60;
export const HISTORY_LIMIT = 100;

export const isEphemeralRoom = (name) => typeof name === 'string' && name.startsWith(EPHEMERAL_PREFIX);
export const isDmRoom = (name) => typeof name === 'string' && (name.startsWith('!dm-') || name.startsWith('dm-'));

export const b64encode = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
export const b64decode = (str) => Uint8Array.from(atob(str), c => c.charCodeAt(0));
export const b64urlEncode = (bytes) => b64encode(bytes).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
export const b64urlDecode = (str) => {
  const b64 = str.replaceAll('-','+').replaceAll('_','/');
  const padded = b64 + '='.repeat((4 - b64.length % 4) % 4);
  return b64decode(padded);
};

const decodeRoom = (part) => {
  try { return decodeURIComponent(part); } catch (_) { return part; }
};

export const parseHash = (hash) => {
  const raw = (hash || '').slice(1).trim();
  if (!raw) return { room: null, b64Key: null };
  const colonIdx = raw.indexOf(':');
  if (colonIdx === -1) return { room: decodeRoom(raw) || null, b64Key: null };
  return { room: decodeRoom(raw.slice(0, colonIdx)) || null, b64Key: raw.slice(colonIdx + 1) || null };
};

export const formatHash = (room, b64Key) => '#' + encodeURIComponent(room) + (b64Key ? ':' + b64Key : '');

export const deriveKey = async (b64Key) => {
  try {
    const raw = b64urlDecode(b64Key);
    if (raw.length !== 32) throw new Error('key must be 32 bytes');
    return await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  } catch (err) {
    console.warn('key parse failed:', err);
    return null;
  }
};

const topicCache = new Map();
export const chatTopicFor = (roomName, b64Key) => {
  const id = b64Key + ':' + roomName;
  if (!topicCache.has(id)) {
    topicCache.set(id, (async () => {
      const raw = b64urlDecode(b64Key);
      if (raw.length !== 32) return null;
      const mac = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      return b64urlEncode(new Uint8Array(await crypto.subtle.sign('HMAC', mac, new TextEncoder().encode(CHAT_TOPIC_V2 + roomName))));
    })().catch(() => null));
  }
  return topicCache.get(id);
};

export const expiryTags = () => [['expiration', String(Math.floor(Date.now() / 1000) + HISTORY_LOOKBACK_SEC)]];

export const encryptText = async (key, plaintext) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  return { v: 1, iv: b64encode(iv), ct: b64encode(new Uint8Array(ct)) };
};

export const decryptText = async (key, payload) => {
  if (!payload || payload.v !== 1) throw new Error('bad payload');
  const iv = b64decode(payload.iv);
  const ct = b64decode(payload.ct);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(pt);
};

export const packChatPlain = (text, { fp, legacyFp } = {}, extra) => JSON.stringify(Object.assign({ v: 2, t: text, sfp: legacyFp || undefined, sfp2: (fp && fp !== legacyFp) ? fp : undefined }, extra || {}));
export const unpackChatPlain = (raw) => {
  try {
    const o = JSON.parse(raw);
    if (o && o.v === 2 && typeof o.t === 'string') {
      return { text: o.t, sfp: typeof o.sfp === 'string' ? o.sfp : null, sfp2: typeof o.sfp2 === 'string' ? o.sfp2 : null, ctl: (o.ctl && typeof o.ctl === 'object') ? o.ctl : null };
    }
  } catch (_) {}
  return { text: raw, sfp: null, sfp2: null, ctl: null };
};

export const certFingerprints = (sdp) => {
  const out = new Set();
  String(sdp || '').split(/\r?\n/).forEach((line) => {
    const m = /^a=fingerprint:(\S+)\s+([0-9A-Fa-f:]+)/.exec(line.trim());
    if (m) out.add(m[1].toLowerCase() + ' ' + m[2].toUpperCase());
  });
  return Array.from(out).sort().join(',');
};

export const samePubOf = (a, b) => !!(a && b && a.x === b.x && a.y === b.y);
