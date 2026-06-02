import { joinRoom, selfId } from '/assets/vendor/trystero-nostr.js';

const RELAY = 'wss://relay.mentria.ai';
const TURN_CRED_URL = 'https://relay.mentria.ai/turn-cred';
const FALLBACK_ICE = [{ urls: 'stun:turn.mentria.ai:3478' }];
const APP_ID = 'mentria-sync';
const CODE_BYTES = 10;
const ROOM_ID_LEN = 16;
const KEY_BYTES = 32;
const IV_BYTES = 12;

const B32 = 'abcdefghijklmnopqrstuvwxyz234567';

const b32Encode = (bytes) => {
  let bits = 0, value = 0, out = '';
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 0x1f];
  return out;
};

const b32Decode = (s) => {
  const clean = String(s || '').toLowerCase().replace(/[^a-z2-7]/g, '');
  const out = [];
  let bits = 0, value = 0;
  for (let i = 0; i < clean.length; i++) {
    const v = B32.indexOf(clean[i]);
    if (v < 0) throw new Error('bad code char');
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
};

const formatCode = (raw) => raw.match(/.{1,4}/g).join('-').toUpperCase();
const normalizeCode = (s) => String(s || '').toLowerCase().replace(/[^a-z2-7]/g, '');

const generateCode = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_BYTES));
  return formatCode(b32Encode(bytes));
};

const deriveFromCode = async (codeRaw) => {
  const bytes = b32Decode(codeRaw);
  if (bytes.length < CODE_BYTES) throw new Error('code too short');
  const baseKey = await crypto.subtle.importKey('raw', bytes, 'HKDF', false, ['deriveBits', 'deriveKey']);
  const roomBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('mentria-sync-room-v1'), info: new TextEncoder().encode('room-id') },
    baseKey, 80
  );
  const roomId = b32Encode(new Uint8Array(roomBits)).slice(0, ROOM_ID_LEN);
  const key = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('mentria-sync-key-v1'), info: new TextEncoder().encode('aes-gcm-256') },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
  return { roomId, key };
};

const b64Encode = (bytes) => btoa(String.fromCharCode.apply(null, bytes));
const b64Decode = (s) => {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const encryptPayload = async (key, obj) => {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const pt = new TextEncoder().encode(JSON.stringify(obj));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, pt);
  return { iv: b64Encode(iv), ct: b64Encode(new Uint8Array(ct)) };
};

const decryptPayload = async (key, payload) => {
  if (!payload || typeof payload.iv !== 'string' || typeof payload.ct !== 'string') {
    throw new Error('bad payload');
  }
  const iv = b64Decode(payload.iv);
  const ct = b64Decode(payload.ct);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return JSON.parse(new TextDecoder().decode(pt));
};

let iceCached = null;
let iceExpiry = 0;
const getIce = async () => {
  const nowSec = Date.now() / 1000;
  if (iceCached && nowSec < iceExpiry - 60) return iceCached;
  try {
    const r = await fetch(TURN_CRED_URL, { cache: 'no-store' });
    if (!r.ok) throw new Error('status ' + r.status);
    const data = await r.json();
    iceExpiry = nowSec + (data.ttl || 3600);
    iceCached = data.iceServers || FALLBACK_ICE;
    return iceCached;
  } catch (_) {
    return FALLBACK_ICE;
  }
};

const state = {
  status: 'idle',
  code: null,
  roomId: null,
  key: null,
  room: null,
  action: null,
  peers: new Set(),
  isInitiator: false,
  syncedSinceConnect: 0,
  listeners: { state: [], error: [], synced: [] }
};

const emit = (event, payload) => {
  (state.listeners[event] || []).forEach((fn) => {
    try { fn(payload); } catch (_) {}
  });
};

const setStatus = (status) => {
  state.status = status;
  emit('state', { status, code: state.code, peers: state.peers.size, syncedSinceConnect: state.syncedSinceConnect });
};

const handleIncoming = async (payload) => {
  let msg;
  try {
    msg = await decryptPayload(state.key, payload);
  } catch (err) {
    emit('error', new Error('decrypt failed: ' + err.message));
    return;
  }
  if (!msg || typeof msg !== 'object') return;
  if (msg.op === 'snapshot' && msg.data) {
    try {
      const result = window.MentriaStore.importAll(msg.data, { mode: 'merge' });
      state.syncedSinceConnect += result.restored;
      emit('synced', { restored: result.restored });
    } catch (err) {
      emit('error', new Error('snapshot import failed: ' + err.message));
    }
    return;
  }
  if (msg.op === 'set' && typeof msg.ns === 'string' && typeof msg.key === 'string') {
    window.MentriaStore.set(msg.ns, msg.key, msg.value, { remote: true });
    state.syncedSinceConnect++;
    emit('synced', { restored: 1 });
    return;
  }
  if (msg.op === 'remove' && typeof msg.ns === 'string' && typeof msg.key === 'string') {
    window.MentriaStore.remove(msg.ns, msg.key, { remote: true });
    state.syncedSinceConnect++;
    emit('synced', { restored: 1 });
    return;
  }
};

const onLocalWrite = async (event) => {
  if (!state.action || !state.key) return;
  const d = event.detail || {};
  if (d.remote) return;
  if (!d.ns || !d.key) return;
  if (d.op !== 'set' && d.op !== 'remove') return;
  try {
    const payload = await encryptPayload(state.key, { op: d.op, ns: d.ns, key: d.key, value: d.value });
    state.action.send(payload);
  } catch (err) {
    emit('error', err);
  }
};

const sendSnapshot = async () => {
  if (!state.action || !state.key) return;
  try {
    const snap = window.MentriaStore.exportAll();
    const payload = await encryptPayload(state.key, { op: 'snapshot', data: snap });
    state.action.send(payload);
  } catch (err) {
    emit('error', err);
  }
};

const joinRoomWithCode = async (codeRaw, opts) => {
  opts = opts || {};
  const derived = await deriveFromCode(codeRaw);
  state.code = formatCode(normalizeCode(codeRaw));
  state.roomId = derived.roomId;
  state.key = derived.key;
  state.isInitiator = !!opts.initiator;
  state.syncedSinceConnect = 0;
  state.peers.clear();

  setStatus(opts.initiator ? 'pairing' : 'connecting');

  const ice = await getIce();
  try {
    state.room = joinRoom(
      {
        appId: APP_ID,
        relayConfig: { urls: [RELAY] },
        rtcConfig: { iceServers: ice }
      },
      derived.roomId
    );
  } catch (err) {
    setStatus('idle');
    state.code = null;
    state.key = null;
    throw err;
  }

  state.action = state.room.makeAction('sync');
  state.action.onMessage = (data, ctx) => handleIncoming(data);

  state.room.onPeerJoin = (peerId) => {
    state.peers.add(peerId);
    setStatus('connected');
    if (state.isInitiator) sendSnapshot();
  };
  state.room.onPeerLeave = (peerId) => {
    state.peers.delete(peerId);
    if (state.peers.size === 0) setStatus(state.isInitiator ? 'pairing' : 'connecting');
  };

  window.addEventListener('mentria:write', onLocalWrite);
};

const start = async () => {
  if (state.status !== 'idle') return state.code;
  const code = generateCode();
  await joinRoomWithCode(code, { initiator: true });
  return code;
};

const joinWithCode = async (codeInput) => {
  if (state.status !== 'idle') {
    await disconnect();
  }
  const normalized = normalizeCode(codeInput);
  if (normalized.length < Math.ceil(CODE_BYTES * 8 / 5)) {
    throw new Error('code too short');
  }
  await joinRoomWithCode(codeInput, { initiator: false });
  return state.code;
};

const disconnect = async () => {
  window.removeEventListener('mentria:write', onLocalWrite);
  if (state.room) {
    try { await state.room.leave(); } catch (_) {}
  }
  state.room = null;
  state.action = null;
  state.peers.clear();
  state.code = null;
  state.roomId = null;
  state.key = null;
  state.isInitiator = false;
  setStatus('idle');
};

const on = (event, handler) => {
  if (!state.listeners[event]) state.listeners[event] = [];
  state.listeners[event].push(handler);
  return () => {
    state.listeners[event] = state.listeners[event].filter((h) => h !== handler);
  };
};

const status = () => ({
  status: state.status,
  code: state.code,
  peers: state.peers.size,
  syncedSinceConnect: state.syncedSinceConnect,
  selfId
});

window.MentriaSync = {
  start, joinWithCode, disconnect, on, status,
  formatCode, normalizeCode
};
