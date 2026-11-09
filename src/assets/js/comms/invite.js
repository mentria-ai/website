import { b64urlEncode, b64urlDecode } from '/assets/js/comms/wire.js';

export const INVITE_TTL_S = 86400;
export const INVITE_KIND = 3838;

const SALT = 'mentria-invite-v1';
const TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;
const te = new TextEncoder();

export const newInviteToken = () => b64urlEncode(crypto.getRandomValues(new Uint8Array(16)));

export const inviteUrl = (origin, token) => String(origin || '').replace(/\/+$/, '') + '/comms/#:i1.' + token;

export const parseInvite = (text) => {
  const m = String(text || '').trim().match(/(?:#:|^)i1\.([A-Za-z0-9_-]{22})$/);
  return m ? m[1] : null;
};

export const inviteKeys = async (token) => {
  if (!TOKEN_RE.test(String(token || ''))) return null;
  const raw = b64urlDecode(token);
  if (raw.length !== 16) return null;
  const base = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveBits']);
  const bits = async (info, n) => new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: te.encode(SALT), info: te.encode(info) }, base, n * 8));
  const [topicKey, aesRaw, sk, idRaw] = await Promise.all([bits('invite-topic', 32), bits('invite-key', 32), bits('invite-nostr', 32), bits('invite-id', 9)]);
  const mac = await crypto.subtle.importKey('raw', topicKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const topic = b64urlEncode(new Uint8Array(await crypto.subtle.sign('HMAC', mac, te.encode(SALT))));
  const aes = await crypto.subtle.importKey('raw', aesRaw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  return { topic, aes, sk, id: b64urlEncode(idRaw) };
};

export const sealInvite = async (aes, body) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, te.encode(JSON.stringify(body))));
  return JSON.stringify({ v: 1, iv: b64urlEncode(iv), ct: b64urlEncode(ct) });
};

const keyOk = (k) => {
  if (typeof k !== 'string' || !/^[A-Za-z0-9_+/=-]{40,48}$/.test(k)) return false;
  try { return b64urlDecode(k.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')).length === 32; } catch (_) { return false; }
};

const pubOk = (p) => !!p && typeof p === 'object' && typeof p.x === 'string' && typeof p.y === 'string' && p.x.length <= 64 && p.y.length <= 64;

export const openInvite = async (aes, content, nowMs = Date.now()) => {
  try {
    const env = typeof content === 'string' ? JSON.parse(content) : content;
    if (!env || env.v !== 1 || typeof env.iv !== 'string' || typeof env.ct !== 'string') return null;
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64urlDecode(env.iv) }, aes, b64urlDecode(env.ct));
    const body = JSON.parse(new TextDecoder().decode(plain));
    if (!body || body.v !== 1) return null;
    if (typeof body.room !== 'string' || body.room.length < 1 || body.room.length > 64 || body.room === 'self') return null;
    if (!keyOk(body.key)) return null;
    if (body.kv !== 1 && body.kv !== 2) return null;
    if (typeof body.exp !== 'number' || body.exp * 1000 <= nowMs) return null;
    const by = body.by && typeof body.by === 'object' ? body.by : {};
    return {
      v: 1,
      room: body.room,
      key: body.key,
      kv: body.kv,
      label: String(body.label || body.room).slice(0, 40),
      by: { name: String(by.name || '').slice(0, 32), pub: pubOk(by.pub) ? { x: by.pub.x, y: by.pub.y } : undefined, spub: pubOk(by.spub) ? { x: by.spub.x, y: by.spub.y } : undefined },
      exp: body.exp,
      once: true
    };
  } catch (_) { return null; }
};

export const envelopeTemplate = (topic, content, nowS) => ({ kind: INVITE_KIND, created_at: nowS, tags: [['x', topic], ['expiration', String(nowS + INVITE_TTL_S)]], content });

export const deletionTemplate = (evId, nowS) => ({ kind: 5, created_at: nowS, tags: [['e', evId], ['k', String(INVITE_KIND)]], content: '' });

export const fetchInvite = (sockets, topic, aes, { timeoutMs = 8000, retryMs = 3000, now = () => Date.now(), author = null } = {}) => new Promise((resolve) => {
  const list = (sockets || []).filter(Boolean);
  if (!list.length || !topic || !aes) { resolve({ status: 'offline' }); return; }
  const sub = 'iv-' + Math.random().toString(36).slice(2);
  const filter = { kinds: [INVITE_KIND], '#x': [topic], limit: 5 };
  if (author) filter.authors = [author];
  const req = JSON.stringify(['REQ', sub, filter]);
  const asked = new Set();
  const ended = new Set();
  const timers = [];
  let done = false;
  const finish = (v) => {
    if (done) return;
    done = true;
    timers.forEach((t) => clearTimeout(t));
    for (const ws of asked) {
      try { ws.removeEventListener('message', onMsg); } catch (_) {}
      try { ws.send(JSON.stringify(['CLOSE', sub])); } catch (_) {}
    }
    resolve(v);
  };
  const askRest = () => { for (const ws of list) if (!asked.has(ws)) ask(ws); };
  const onMsg = async (e) => {
    let m;
    try { m = JSON.parse(e.data); } catch (_) { return; }
    if (!Array.isArray(m) || m[1] !== sub) return;
    if (m[0] === 'EOSE') {
      ended.add(e.target || e.currentTarget || m);
      if (ended.size >= asked.size) {
        if (asked.size < list.length) askRest();
        else setTimeout(() => { if (ended.size >= list.length) finish({ status: 'gone' }); }, 400);
      }
      return;
    }
    if (m[0] !== 'EVENT' || !m[2]) return;
    ended.add(e.target || e.currentTarget || m);
    if (author && m[2].pubkey !== author) return;
    const body = await openInvite(aes, m[2].content, now());
    if (body) finish({ status: 'found', body, evId: m[2].id });
  };
  const ask = (ws) => {
    try { ws.addEventListener('message', onMsg); ws.send(req); asked.add(ws); } catch (_) {}
  };
  ask(list[0]);
  if (list.length > 1) timers.push(setTimeout(() => { if (!done) askRest(); }, retryMs));
  timers.push(setTimeout(() => finish({ status: ended.size ? 'gone' : 'offline' }), timeoutMs));
});
