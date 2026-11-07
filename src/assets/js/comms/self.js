import { b64urlEncode } from '/assets/js/comms/wire.js';
import { base32 } from '/assets/js/comms/files.js';

const WEEK_MS = 604800000;
const DEVICE_KEY = 'mentria.comms.device';
const DEVICES_KEY = 'mentria.comms.devices';
const te = new TextEncoder();

export const SELF_THREAD = 'self';

export const kindFrom = (ua, touch) => {
  const u = String(ua || '');
  if (/iPhone|iPod/.test(u)) return 'iphone';
  if (/iPad/.test(u) || (/Macintosh/.test(u) && Number(touch) > 1)) return 'ipad';
  if (/Android/.test(u)) return 'android';
  if (/Macintosh|Mac OS X/.test(u)) return 'mac';
  if (/Windows/.test(u)) return 'windows';
  if (/Linux|X11|CrOS/.test(u)) return 'linux';
  return 'device';
};

export const selfRoomFor = async (secret, now = Date.now()) => {
  const bucket = String(Math.floor(Number(now) / WEEK_MS));
  const base = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits']);
  const idBits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: te.encode('mentria-self-room-v1'), info: te.encode('room-id|w' + bucket) }, base, 80));
  const keyBits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: te.encode('mentria-self-key-v1'), info: te.encode('aes-gcm-256|w' + bucket) }, base, 256));
  return { roomName: 'self-' + base32(idBits).slice(0, 16), b64Key: b64urlEncode(keyBits), threadId: SELF_THREAD };
};

const randomId = () => {
  const b = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
};

export const deviceInfo = (T) => {
  let id = null;
  try { id = localStorage.getItem(DEVICE_KEY); } catch (_) { id = null; }
  if (!id || !/^[0-9a-f]{8,64}$/.test(id)) {
    id = randomId();
    try { localStorage.setItem(DEVICE_KEY, id); } catch (_) {}
  }
  const kind = kindFrom(typeof navigator !== 'undefined' ? navigator.userAgent : '', typeof navigator !== 'undefined' ? navigator.maxTouchPoints : 0);
  const D = (T && T.devices) || {};
  return { id, kind, name: D['kind_' + kind] || kind };
};

export class Presence {
  constructor(key = DEVICES_KEY) {
    this._key = key;
    this._map = {};
    try { this._map = JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch (_) { this._map = {}; }
    for (const d of Object.values(this._map)) d.online = false;
  }

  _save() {
    try { localStorage.setItem(this._key, JSON.stringify(this._map)); } catch (_) {}
  }

  seen(device, online) {
    if (!device || !device.id) return;
    const prev = this._map[device.id] || {};
    this._map[device.id] = { id: device.id, name: String(device.name || prev.name || '').slice(0, 40), kind: device.kind || prev.kind || 'device', online: !!online, lastSeen: Date.now() };
    this._save();
  }

  gone(id) {
    const d = this._map[id];
    if (!d) return;
    d.online = false;
    d.lastSeen = Date.now();
    this._save();
  }

  list(meId) {
    return Object.values(this._map).map((d) => Object.assign({}, d, { me: d.id === meId })).sort((a, b) => (b.me - a.me) || (b.online - a.online) || (b.lastSeen - a.lastSeen));
  }
}

export const mergeMessage = (local, incoming) => {
  if (!incoming || !incoming.id) return 'skip';
  if (!local) return 'put';
  return (Number(incoming.ts) || 0) > (Number(local.ts) || 0) ? 'replace' : 'skip';
};

export const threadsToSend = (mine, theirs) => {
  const known = new Map((theirs || []).map((x) => [x.id, Number(x.updatedAt) || 0]));
  return (mine || []).filter((x) => !known.has(x.id) || (Number(x.updatedAt) || 0) > known.get(x.id)).map((x) => x.id);
};

const SYNC_KINDS = ['dm', 'room', 'model', 'self'];
const SYNC_PAGE = 200;
const SYNC_CHUNK = 50;
const SYNC_AGAIN_MS = 600000;
const ID_OK = (v) => typeof v === 'string' && v.length > 0 && v.length <= 200;
const syncable = (t) => !!t && ID_OK(t.id) && SYNC_KINDS.includes(t.kind) && !String(t.id).startsWith('!');

const cleanThread = (t) => {
  if (!syncable(t)) return null;
  return {
    id: t.id, kind: t.kind, title: String(t.title || '').slice(0, 200), participants: Array.isArray(t.participants) ? t.participants.slice(0, 50) : [],
    meta: t.meta && typeof t.meta === 'object' ? t.meta : {}, preview: String(t.preview || '').slice(0, 200),
    updatedAt: Number(t.updatedAt) || 0, lastReadTs: Number(t.lastReadTs) || 0, pinned: !!t.pinned
  };
};

const cleanMsg = (m, threadId) => {
  if (!m || !ID_OK(m.id) || m.threadId !== threadId || typeof m.t !== 'string' || m.t.length > 40000) return null;
  return { id: m.id, threadId, from: String(m.from || '').slice(0, 200), ts: Number(m.ts) || 0, t: m.t, parts: Array.isArray(m.parts) ? m.parts.slice(0, 40) : [{ type: 'text', text: m.t }], meta: m.meta && typeof m.meta === 'object' ? m.meta : undefined, v: Number(m.v) || 2 };
};

export class HistorySync {
  constructor({ store, onChange } = {}) {
    this._store = store;
    this._onChange = onChange || (() => {});
    this._act = null;
    this._done = new Map();
  }

  setStore(store) {
    this._store = store;
  }

  bind(room) {
    const idx = room.makeAction('fhs');
    const thr = room.makeAction('fht');
    const msg = room.makeAction('fhm');
    this._act = { idx, thr, msg };
    this._done = new Map();
    idx.onMessage = (d, m) => { this._onIndex(d, m.peerId).catch(() => {}); };
    thr.onMessage = (d) => { this._onThread(d).catch(() => {}); };
    msg.onMessage = (d) => { this._onMessages(d).catch(() => {}); };
  }

  async _mine() {
    return (await this._store.listThreads()).filter(syncable);
  }

  async hello(peerId) {
    if (!this._act || !this._store) return;
    const last = this._done.get(peerId) || 0;
    if (Date.now() - last < SYNC_AGAIN_MS) return;
    this._done.set(peerId, Date.now());
    const mine = await this._mine();
    await this._act.idx.send({ idx: mine.map((t) => ({ id: t.id, updatedAt: t.updatedAt || 0 })) }, { target: peerId });
  }

  async _onIndex(d, peerId) {
    if (!this._act || !d || !Array.isArray(d.idx)) return;
    const theirs = d.idx.filter((x) => x && ID_OK(x.id)).slice(0, 2000);
    const mine = await this._mine();
    for (const id of threadsToSend(mine, theirs)) {
      const t = mine.find((x) => x.id === id);
      if (!t) continue;
      await this._act.thr.send({ thread: cleanThread(t) }, { target: peerId });
      const msgs = await this._store.listMessages(id, { limit: SYNC_PAGE });
      const newest = msgs.slice().reverse();
      for (let i = 0; i < newest.length; i += SYNC_CHUNK) {
        await this._act.msg.send({ threadId: id, msgs: newest.slice(i, i + SYNC_CHUNK) }, { target: peerId });
      }
    }
  }

  async _onThread(d) {
    const t = cleanThread(d && d.thread);
    if (!t || !this._store) return;
    await this._store.putThread(t);
    this._onChange(t.id);
  }

  async _onMessages(d) {
    if (!d || !ID_OK(d.threadId) || !Array.isArray(d.msgs) || !this._store) return;
    let changed = 0;
    for (const raw of d.msgs.slice(0, SYNC_CHUNK)) {
      const m = cleanMsg(raw, d.threadId);
      if (!m) continue;
      const local = await this._store.getMessage(m.id);
      const how = mergeMessage(local, m);
      if (how === 'skip') continue;
      await this._store.putMessage(m, { replace: how === 'replace' });
      changed += 1;
    }
    if (changed) this._onChange(d.threadId);
  }
}
