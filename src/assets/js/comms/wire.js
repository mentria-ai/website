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

const B64U = /^[A-Za-z0-9_-]+$/;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const MAX_PARTS = 40;
const MAX_ITEMS = 40;
const isB64u = (v, bytes) => typeof v === 'string' && B64U.test(v) && v.length === Math.ceil(bytes * 4 / 3);
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const str = (v, max) => (typeof v === 'string' && v.length <= max ? v : undefined);
const b64str = (v) => (typeof v === 'string' && v.length <= 16384 && B64.test(v) ? v : undefined);
const put = (o, k, v) => { if (v !== undefined) o[k] = v; };

const cleanMedia = (p, type) => {
  if (!isB64u(p.ref, 16) || !isB64u(p.mh, 32) || !isInt(p.size, 0, 2147483648) || str(p.mime, 100) === undefined) return null;
  const o = { type, ref: p.ref, mh: p.mh, size: p.size, mime: p.mime };
  put(o, 'name', str(p.name, 200));
  if (type !== 'file') {
    put(o, 'w', isInt(p.w, 1, 100000) ? p.w : undefined);
    put(o, 'h', isInt(p.h, 1, 100000) ? p.h : undefined);
    put(o, 'caption', str(p.caption, 2000));
  }
  if (type === 'image') {
    put(o, 'thumb', b64str(p.thumb));
    if (typeof p.hd === 'boolean') o.hd = p.hd;
  }
  if (type === 'video') {
    put(o, 'poster', b64str(p.poster));
    put(o, 'duration', typeof p.duration === 'number' && Number.isFinite(p.duration) && p.duration >= 0 && p.duration <= 1e6 ? p.duration : undefined);
  }
  return o;
};

const cleanPart = (p) => {
  if (!p || typeof p !== 'object' || typeof p.type !== 'string') return null;
  if (p.type === 'text') return typeof p.text === 'string' && p.text.length <= 20000 ? { type: 'text', text: p.text } : null;
  if (p.type === 'image' || p.type === 'video' || p.type === 'file') return cleanMedia(p, p.type);
  if (p.type === 'album') {
    if (str(p.aid, 32) === undefined || !p.aid || !isInt(p.n, 1, 200) || !Array.isArray(p.items)) return null;
    const items = p.items.slice(0, MAX_ITEMS).map((x) => (x && (x.type === 'image' || x.type === 'video') ? cleanMedia(x, x.type) : null)).filter(Boolean);
    return items.length ? { type: 'album', aid: p.aid, n: p.n, items } : null;
  }
  return { type: 'unknown' };
};

export const cleanParts = (p) => {
  if (!Array.isArray(p)) return null;
  const out = p.slice(0, MAX_PARTS).map(cleanPart).filter(Boolean);
  return out.length ? out : null;
};

export const splitOffer = async (parts, measure, budget = 60000) => {
  const texts = parts.filter((x) => x.type === 'text');
  const rest = parts.filter((x) => x.type !== 'text');
  const msgs = [];
  let cur = texts.slice();
  const flush = () => { if (cur.length) msgs.push(cur); cur = []; };
  const fits = async (m) => (await measure(m)) <= budget;
  for (const part of rest) {
    if (part.type !== 'album') {
      if (cur.length && !(await fits(cur.concat([part])))) flush();
      cur.push(part);
      continue;
    }
    let chunk = [];
    const withChunk = (items) => cur.concat([{ type: 'album', aid: part.aid, n: part.n, items }]);
    for (const item of part.items) {
      if (chunk.length && !(await fits(withChunk(chunk.concat([item]))))) {
        cur = withChunk(chunk);
        flush();
        chunk = [];
      } else if (!chunk.length && cur.length && !(await fits(withChunk([item])))) {
        flush();
      }
      chunk.push(item);
    }
    if (chunk.length) cur = withChunk(chunk);
  }
  flush();
  return msgs;
};

const countOf = (parts) => {
  const c = { photo: 0, video: 0, file: 0 };
  for (const p of parts || []) {
    if (p.type === 'album') for (const x of p.items || []) c[x.type === 'video' ? 'video' : 'photo'] += 1;
    else if (p.type === 'image') c.photo += 1;
    else if (p.type === 'video') c.video += 1;
    else if (p.type === 'file') c.file += 1;
  }
  return c;
};

export const offerText = (parts, T) => {
  const F = (T && T.files) || {};
  const c = countOf(parts);
  const n = c.photo + c.video + c.file;
  const fill = (tpl) => String(tpl || '').replace('{n}', String(n));
  let line;
  if (c.photo === n) line = fill(n === 1 ? F.offer_photo || F.offer_photos : F.offer_photos);
  else if (c.video === n) line = fill(n === 1 ? F.offer_video || F.offer_videos : F.offer_videos);
  else if (c.file === n) line = fill(n === 1 ? F.offer_file || F.offer_files : F.offer_files);
  else line = fill(F.offer_mixed);
  const caption = (parts || []).filter((x) => x.type === 'text').map((x) => x.text).join('\n').trim();
  return caption ? line + '\n' + caption : line;
};

export const packChatPlain = (text, { fp, legacyFp } = {}, extra) => {
  const more = Object.assign({}, extra || {});
  if ('p' in more) {
    const p = cleanParts(more.p);
    if (p) more.p = p;
    else delete more.p;
  }
  return JSON.stringify(Object.assign({ v: 2, t: text, sfp: legacyFp || undefined, sfp2: (fp && fp !== legacyFp) ? fp : undefined }, more));
};
export const unpackChatPlain = (raw) => {
  try {
    const o = JSON.parse(raw);
    if (o && o.v === 2 && typeof o.t === 'string') {
      return { text: o.t, sfp: typeof o.sfp === 'string' ? o.sfp : null, sfp2: typeof o.sfp2 === 'string' ? o.sfp2 : null, ctl: (o.ctl && typeof o.ctl === 'object') ? o.ctl : null, parts: cleanParts(o.p) };
    }
  } catch (_) {}
  return { text: raw, sfp: null, sfp2: null, ctl: null, parts: null };
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
