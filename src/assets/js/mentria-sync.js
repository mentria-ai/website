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

const RESCUE_KEY = 'mentria-sync-rescue';

const state = {
  status: 'idle',
  code: null,
  roomId: null,
  key: null,
  room: null,
  action: null,
  peers: new Set(),
  isInitiator: false,
  applyApproved: false,
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

const CONFIRM_FALLBACK = 'This device already has data for: {areas}. Pairing will replace it with the other device’s copy — a rescue copy is saved on this device. Continue?';

const confirmReplaceText = (areas) => {
  let s = CONFIRM_FALLBACK;
  try {
    const v = window.MentriaI18n && window.MentriaI18n.t && window.MentriaI18n.t('about.sync_confirm_replace');
    if (v) s = v;
  } catch (_) {}
  return s.replace('{areas}', areas);
};

const collectConflicts = (payload) => {
  const local = window.MentriaStore.exportAll();
  const conflicts = [];
  const store = (payload && payload.store) || {};
  Object.keys(store).forEach((k) => {
    if (local.store[k] != null && local.store[k] !== String(store[k])) conflicts.push(k);
  });
  const legacy = (payload && payload.legacy) || {};
  Object.keys(legacy).forEach((k) => {
    if (local.legacy[k] != null && local.legacy[k] !== String(legacy[k])) conflicts.push(k);
  });
  return conflicts;
};

const saveRescue = () => {
  try { localStorage.setItem(RESCUE_KEY, JSON.stringify(window.MentriaStore.exportAll())); } catch (_) {}
};

const restoreRescue = () => {
  const raw = localStorage.getItem(RESCUE_KEY);
  if (!raw) return null;
  return window.MentriaStore.importAll(JSON.parse(raw), { mode: 'replace' });
};

const splitSuffix = (suffix) => {
  const parts = String(suffix).split('.');
  let ns = parts[0];
  let rest = parts.slice(1);
  if (parts[0] === 'extdata' && parts.length > 1 && parts[1]) {
    ns = parts[0] + '.' + parts[1];
    rest = parts.slice(2);
  }
  return { ns, key: rest.join('.') };
};

const parseRaw = (raw) => {
  if (typeof raw !== 'string') return raw;
  try { return JSON.parse(raw); } catch (_) { return raw; }
};

const localMtimeOf = (ns, key) => {
  const m = window.MentriaStore.getMeta(ns, key);
  return m ? m.mtime : null;
};

const buildMeta = (store) => {
  const meta = {};
  Object.keys(store).forEach((suffix) => {
    const { ns, key } = splitSuffix(suffix);
    meta[suffix] = localMtimeOf(ns, key);
  });
  return meta;
};

const mergeNotes = (localArr, incomingArr) => {
  const byId = new Map();
  const consider = (note) => {
    if (!note || typeof note !== 'object') return;
    const id = note.id;
    if (id == null) return;
    const key = String(id);
    const existing = byId.get(key);
    if (!existing) { byId.set(key, note); return; }
    const eu = Number(existing.updatedAt) || 0;
    const nu = Number(note.updatedAt) || 0;
    if (nu > eu) byId.set(key, note);
  };
  (Array.isArray(localArr) ? localArr : []).forEach(consider);
  (Array.isArray(incomingArr) ? incomingArr : []).forEach(consider);
  const arr = Array.from(byId.values());
  arr.sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));
  return arr;
};

const mergePalette = (localArr, incomingArr) => {
  const out = [];
  const seen = new Set();
  const push = (h) => { if (!seen.has(h)) { seen.add(h); out.push(h); } };
  (Array.isArray(localArr) ? localArr : []).forEach(push);
  (Array.isArray(incomingArr) ? incomingArr : []).forEach(push);
  return out;
};

const sendBack = async (store, meta, legacy) => {
  if (!state.action || !state.key) return;
  try {
    const payload = await encryptPayload(state.key, {
      op: 'snapshot-back', v: 2,
      data: { version: 1, exportedAt: new Date().toISOString(), store, legacy },
      meta
    });
    state.action.send(payload);
  } catch (err) {
    emit('error', err);
  }
};

const mergeV2 = async (msg, isBack) => {
  const local = window.MentriaStore.exportAll();
  const localStore = local.store || {};
  const localLegacy = local.legacy || {};
  const incoming = (msg.data && msg.data.store) || {};
  const incomingLegacy = (msg.data && msg.data.legacy) || {};
  const meta = (msg.meta && typeof msg.meta === 'object') ? msg.meta : {};
  const summary = { applied: 0, kept: 0, merged: 0, flagged: [] };

  const additions = [];
  const unions = [];
  const lwwReplace = [];
  const keeps = [];

  Object.keys(incoming).forEach((suffix) => {
    const rawIn = incoming[suffix];
    const rawLocal = localStore[suffix];
    if (rawLocal != null && rawLocal === String(rawIn)) return;
    const { ns, key } = splitSuffix(suffix);
    const inMtime = (typeof meta[suffix] === 'number') ? meta[suffix] : null;

    if (rawLocal == null) {
      additions.push({ ns, key, raw: rawIn, mtime: inMtime });
      return;
    }

    const localMtime = localMtimeOf(ns, key);

    if (suffix === 'quick_notes.blob') {
      unions.push({ suffix, ns, key, value: mergeNotes(parseRaw(rawLocal), parseRaw(rawIn)) });
      return;
    }
    if (suffix === 'tools.color_picker_palette') {
      unions.push({ suffix, ns, key, value: mergePalette(parseRaw(rawLocal), parseRaw(rawIn)) });
      return;
    }
    if (suffix === 'totp.vault') {
      if (inMtime != null && localMtime != null && inMtime > localMtime) {
        lwwReplace.push({ suffix, ns, key, raw: rawIn, mtime: inMtime });
      } else {
        keeps.push(suffix); summary.kept++; summary.flagged.push(suffix);
      }
      return;
    }

    const inWins = (inMtime != null) && (localMtime == null || inMtime > localMtime);
    if (inWins) {
      lwwReplace.push({ suffix, ns, key, raw: rawIn, mtime: inMtime });
    } else {
      keeps.push(suffix); summary.kept++;
      const tie = (inMtime != null && localMtime != null && inMtime === localMtime) || (inMtime == null && localMtime == null);
      if (tie) summary.flagged.push(suffix);
    }
  });

  if (lwwReplace.length && !state.applyApproved) {
    const areas = Array.from(new Set(lwwReplace.map((x) => x.suffix.split('.')[0]))).join(', ');
    const ok = typeof window.mentriaConfirm === 'function'
      ? await window.mentriaConfirm(confirmReplaceText(areas))
      : false;
    if (!ok) {
      lwwReplace.forEach((x) => { keeps.push(x.suffix); summary.kept++; });
      lwwReplace.length = 0;
    } else {
      state.applyApproved = true;
      saveRescue();
    }
  }

  additions.forEach((a) => {
    window.MentriaStore.set(a.ns, a.key, parseRaw(a.raw), { mtime: a.mtime != null ? a.mtime : Date.now(), remote: true });
    summary.applied++;
  });
  unions.forEach((u) => {
    window.MentriaStore.set(u.ns, u.key, u.value, { mtime: Date.now(), remote: true });
    summary.merged++;
  });
  lwwReplace.forEach((l) => {
    window.MentriaStore.set(l.ns, l.key, parseRaw(l.raw), { mtime: l.mtime != null ? l.mtime : Date.now(), remote: true });
    summary.applied++;
  });

  Object.keys(incomingLegacy).forEach((k) => {
    if (typeof k !== 'string' || k.indexOf('mentria_') !== 0) return;
    try {
      if (window.localStorage.getItem(k) != null) return;
      window.localStorage.setItem(k, String(incomingLegacy[k]));
      summary.applied++;
    } catch (_) {}
  });

  if (!isBack) {
    const after = window.MentriaStore.exportAll();
    const afterStore = after.store || {};
    const replySuffixes = new Set();
    keeps.forEach((s) => replySuffixes.add(s));
    unions.forEach((u) => replySuffixes.add(u.suffix));
    Object.keys(localStore).forEach((s) => { if (!(s in incoming)) replySuffixes.add(s); });

    const replyStore = {};
    const replyMeta = {};
    replySuffixes.forEach((suffix) => {
      if (!(suffix in afterStore)) return;
      const { ns, key } = splitSuffix(suffix);
      replyStore[suffix] = afterStore[suffix];
      replyMeta[suffix] = localMtimeOf(ns, key);
    });

    const replyLegacy = {};
    Object.keys(localLegacy).forEach((k) => {
      if (!(k in incomingLegacy)) replyLegacy[k] = localLegacy[k];
    });

    if (Object.keys(replyStore).length || Object.keys(replyLegacy).length) {
      await sendBack(replyStore, replyMeta, replyLegacy);
    }
  }

  state.syncedSinceConnect += (summary.applied + summary.merged);
  emit('synced', { restored: summary.applied + summary.merged, summary });
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

  if ((msg.op === 'snapshot' || msg.op === 'snapshot-back') && msg.v === 2 && msg.data) {
    try {
      await mergeV2(msg, msg.op === 'snapshot-back');
    } catch (err) {
      emit('error', new Error('merge failed: ' + err.message));
    }
    return;
  }

  if (msg.op === 'snapshot' && msg.data) {
    try {
      if (!state.applyApproved) {
        const conflicts = collectConflicts(msg.data);
        if (conflicts.length) {
          const areas = Array.from(new Set(conflicts.map((k) => k.split('.')[0]))).join(', ');
          const ok = typeof window.mentriaConfirm === 'function'
            ? await window.mentriaConfirm(confirmReplaceText(areas))
            : false;
          if (!ok) { emit('synced', { restored: 0, declined: true }); return; }
          saveRescue();
        }
        state.applyApproved = true;
      }
      const result = window.MentriaStore.importAll(msg.data, { mode: 'merge' });
      state.syncedSinceConnect += result.restored;
      emit('synced', { restored: result.restored });
    } catch (err) {
      emit('error', new Error('snapshot import failed: ' + err.message));
    }
    return;
  }

  if (msg.op === 'set' && typeof msg.ns === 'string' && typeof msg.key === 'string') {
    window.MentriaStore.set(msg.ns, msg.key, msg.value, { remote: true, mtime: msg.mtime });
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
    const payload = await encryptPayload(state.key, { op: d.op, ns: d.ns, key: d.key, value: d.value, mtime: d.mtime });
    state.action.send(payload);
  } catch (err) {
    emit('error', err);
  }
};

const sendSnapshot = async () => {
  if (!state.action || !state.key) return;
  try {
    const snap = window.MentriaStore.exportAll();
    const payload = await encryptPayload(state.key, { op: 'snapshot', v: 2, data: snap, meta: buildMeta(snap.store || {}) });
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
  state.applyApproved = false;
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

const WEEK_MS = 7 * 24 * 3600 * 1000;
const currentBucket = () => String(Math.floor(Date.now() / WEEK_MS));

const deriveFromIdentity = async (secretBytes) => {
  if (!(secretBytes instanceof Uint8Array) || secretBytes.length < 16) throw new Error('bad identity');
  const bucket = currentBucket();
  const baseKey = await crypto.subtle.importKey('raw', secretBytes, 'HKDF', false, ['deriveBits', 'deriveKey']);
  const roomBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('mentria-identity-room-v1'), info: new TextEncoder().encode('room-id|w' + bucket) },
    baseKey, 80
  );
  const roomId = b32Encode(new Uint8Array(roomBits)).slice(0, ROOM_ID_LEN);
  const key = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('mentria-identity-key-v1'), info: new TextEncoder().encode('aes-gcm-256|w' + bucket) },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
  return { roomId, key };
};

const joinWithIdentity = async (secretBytes) => {
  if (state.status !== 'idle') await disconnect();
  const derived = await deriveFromIdentity(secretBytes);
  state.code = null;
  state.roomId = derived.roomId;
  state.key = derived.key;
  state.isInitiator = false;
  state.applyApproved = false;
  state.syncedSinceConnect = 0;
  state.peers.clear();
  setStatus('pairing');
  const ice = await getIce();
  try {
    state.room = joinRoom(
      { appId: APP_ID, relayConfig: { urls: [RELAY] }, rtcConfig: { iceServers: ice } },
      derived.roomId
    );
  } catch (err) {
    setStatus('idle');
    state.key = null;
    throw err;
  }
  state.action = state.room.makeAction('sync');
  state.action.onMessage = (data) => handleIncoming(data);
  state.room.onPeerJoin = (peerId) => {
    state.peers.add(peerId);
    setStatus('connected');
    sendSnapshot();
  };
  state.room.onPeerLeave = (peerId) => {
    state.peers.delete(peerId);
    if (state.peers.size === 0) setStatus('pairing');
  };
  window.addEventListener('mentria:write', onLocalWrite);
  return 'identity';
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
  state.applyApproved = false;
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
  start, joinWithCode, joinWithIdentity, disconnect, on, status,
  formatCode, normalizeCode, restoreRescue
};
