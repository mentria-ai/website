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
