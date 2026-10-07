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

const b64Encode = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
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
const RESCUE_MS = 14 * 24 * 3600 * 1000;
const VAULTS = ['totp.vault', 'identity.vault'];
const HELLO_FALLBACK_MS = 4000;

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
  approval: null,
  syncedSinceConnect: 0,
  partner: null,
  exchanged: false,
  joinTimer: 0,
  helloTimer: 0,
  refused: false,
  snapshotSent: false,
  vaultChoice: {},
  vaultLinked: new Set(),
  vaultKept: new Set(),
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

const CONFIRM_FALLBACK = 'This device already has its own {areas}. Pairing replaces them with the other device’s copy. Continue?';
const JOIN_TIMEOUT_MS = 25000;

const areaList = (suffixes) => {
  try { return window.MentriaStore.areaNames(suffixes).join(', '); } catch (_) { return Array.from(new Set(suffixes.map((k) => k.split('.')[0]))).join(', '); }
};

const sendToPartner = (payload) => {
  if (!state.action) return;
  if (state.partner) state.action.send(payload, state.partner);
  else state.action.send(payload);
};

const COPY_FALLBACK = {
  'about.sync_vault_totp': 'This device has its own TOTP vault, and the other device has a different one. Replace this device’s vault with the other device’s? TOTP accounts that are only on this device will be lost, and the other device’s passphrase will unlock it.',
  'about.sync_vault_identity': 'This device has its own Mentria identity, and the other device has a different one. Replace it with the other device’s? This device’s identity will be lost, and the other device’s passphrase will unlock it.',
  'about.sync_vault_keep': 'Keep this device’s',
  'about.sync_vault_replace': 'Replace'
};

const copyText = (key, fallback) => {
  try {
    const v = window.MentriaI18n && window.MentriaI18n.t && window.MentriaI18n.t(key);
    if (typeof v === 'string' && v && v !== key) return v;
  } catch (_) {}
  const pre = window.MentriaSyncCopy && window.MentriaSyncCopy[key];
  return typeof pre === 'string' && pre ? pre : (fallback || COPY_FALLBACK[key] || '');
};

const confirmReplaceText = (areas) => copyText('about.sync_confirm_replace', CONFIRM_FALLBACK).replace('{areas}', areas);

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

const STORE_PREFIX = 'mentria.store.';
const META_PREFIX = 'mentria.meta.';

const isVault = (suffix) => VAULTS.indexOf(suffix) >= 0;

const vaultId = (suffix, value) => {
  const v = (typeof value === 'string') ? parseRaw(value) : value;
  if (!v || typeof v !== 'object') return null;
  if (suffix === 'identity.vault') return typeof v.kcv === 'string' && v.kcv ? v.kcv : null;
  if (suffix === 'totp.vault') return v.pass && typeof v.pass.salt === 'string' && typeof v.pass.wrap === 'string' ? v.pass.salt + '.' + v.pass.wrap : null;
  return null;
};

const sameVault = (suffix, a, b) => {
  const x = vaultId(suffix, a);
  return !!x && x === vaultId(suffix, b);
};

const readRescue = () => {
  let rec = null;
  try { rec = JSON.parse(localStorage.getItem(RESCUE_KEY) || 'null'); } catch (_) { rec = null; }
  if (rec && typeof rec === 'object' && rec.v !== 2) {
    const store = (rec.store && typeof rec.store === 'object') ? rec.store : {};
    const entries = {};
    VAULTS.forEach((suffix) => {
      if (typeof store[suffix] !== 'string') return;
      let now = null;
      try { now = localStorage.getItem(STORE_PREFIX + suffix); } catch (_) {}
      if (now == null || sameVault(suffix, now, store[suffix])) return;
      entries[suffix] = { raw: store[suffix], meta: null };
    });
    const at = Date.parse(rec.exportedAt);
    rec = { v: 2, at: isFinite(at) ? at : 0, entries };
  }
  const fresh = rec && typeof rec === 'object' && typeof rec.at === 'number' && Date.now() - rec.at < RESCUE_MS;
  if (!fresh) {
    try { if (localStorage.getItem(RESCUE_KEY) != null) localStorage.removeItem(RESCUE_KEY); } catch (_) {}
    return null;
  }
  if (!rec.entries || typeof rec.entries !== 'object' || !Object.keys(rec.entries).length) return null;
  return rec;
};

const saveRescue = (suffixes) => {
  const list = (suffixes || []).filter((s) => typeof s === 'string' && s);
  if (!list.length) return;
  try {
    const rec = readRescue() || { v: 2, at: 0, entries: {} };
    let added = 0;
    list.forEach((suffix) => {
      if (rec.entries[suffix]) return;
      const raw = localStorage.getItem(STORE_PREFIX + suffix);
      if (raw == null) return;
      rec.entries[suffix] = { raw, meta: localStorage.getItem(META_PREFIX + suffix) };
      added++;
    });
    if (!added && rec.at) return;
    rec.at = Date.now();
    if (Object.keys(rec.entries).length) localStorage.setItem(RESCUE_KEY, JSON.stringify(rec));
  } catch (_) {}
};

const rescueInfo = () => {
  const rec = readRescue();
  if (!rec) return null;
  return { at: rec.at, until: rec.at + RESCUE_MS, suffixes: Object.keys(rec.entries) };
};

const restoreRescue = () => {
  const rec = readRescue();
  if (!rec) return null;
  let restored = 0;
  Object.keys(rec.entries).forEach((suffix) => {
    const e = rec.entries[suffix];
    if (!e || typeof e.raw !== 'string') return;
    const { ns, key } = splitSuffix(suffix);
    let mtime = null;
    try { const m = JSON.parse(e.meta || 'null'); if (m && typeof m.m === 'number') mtime = m.m; } catch (_) {}
    if (window.MentriaStore.set(ns, key, parseRaw(e.raw), { remote: true, mtime: mtime != null ? mtime : Date.now() })) restored++;
    state.vaultLinked.delete(suffix);
    if (isVault(suffix)) state.vaultKept.add(suffix);
  });
  try { localStorage.removeItem(RESCUE_KEY); } catch (_) {}
  return { restored };
};

const approveReplace = (suffixes) => {
  if (!state.approval) {
    const decision = new Promise((resolve) => {
      resolve(typeof window.mentriaConfirm === 'function' ? window.mentriaConfirm(confirmReplaceText(areaList(suffixes)), { danger: true }) : false);
    }).catch(() => false).then((ok) => {
      if (ok && state.approval === decision) state.applyApproved = true;
      return !!ok;
    });
    state.approval = decision;
  }
  return state.approval;
};

const approveVault = (suffix) => {
  if (!state.vaultChoice[suffix]) {
    const text = copyText(suffix === 'totp.vault' ? 'about.sync_vault_totp' : 'about.sync_vault_identity');
    state.vaultChoice[suffix] = new Promise((resolve) => {
      resolve(typeof window.mentriaConfirm === 'function'
        ? window.mentriaConfirm(text, { danger: true, ok: copyText('about.sync_vault_replace'), cancel: copyText('about.sync_vault_keep') })
        : false);
    }).catch(() => false).then((ok) => !!ok);
  }
  return state.vaultChoice[suffix];
};

const sendVaultChoice = async (suffix, keep) => {
  if (!state.action || !state.key) return;
  try { sendToPartner(await encryptPayload(state.key, { op: 'vault', suffix, keep: !!keep })); } catch (_) {}
};

const vaultFollows = (suffix, incoming) => {
  if (state.vaultKept.has(suffix)) return false;
  let local = null;
  try { local = localStorage.getItem(STORE_PREFIX + suffix); } catch (_) {}
  if (local == null) return true;
  if (state.vaultLinked.has(suffix)) return true;
  if (state.vaultChoice[suffix]) return false;
  return incoming !== undefined && sameVault(suffix, local, incoming);
};

const TOMB_KEY = 'mentria-sync-tombstones';
const TOMB_CAP = 500;

const loadTombs = () => {
  try {
    const raw = localStorage.getItem(TOMB_KEY);
    const o = raw ? JSON.parse(raw) : null;
    return (o && typeof o === 'object') ? o : {};
  } catch (_) { return {}; }
};

const saveTombs = (tombs) => {
  try {
    const keys = Object.keys(tombs);
    if (keys.length > TOMB_CAP) {
      keys.sort((a, b) => (Number(tombs[a]) || 0) - (Number(tombs[b]) || 0));
      keys.slice(0, keys.length - TOMB_CAP).forEach((k) => { delete tombs[k]; });
    }
    localStorage.setItem(TOMB_KEY, JSON.stringify(tombs));
  } catch (_) {}
};

const recordTomb = (ns, key, mtime) => {
  const tombs = loadTombs();
  const suffix = ns + '.' + key;
  const m = (typeof mtime === 'number') ? mtime : Date.now();
  if (!(suffix in tombs) || m > tombs[suffix]) {
    tombs[suffix] = m;
    saveTombs(tombs);
  }
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

const mergePalette = (localArr, localMtime, incomingArr, incomingMtime, deletedMap) => {
  const out = [];
  const seen = new Set();
  const push = (h, srcMtime) => {
    if (seen.has(h)) return;
    const del = (deletedMap && typeof deletedMap[h] === 'number') ? deletedMap[h] : null;
    if (del != null && !(typeof srcMtime === 'number' && srcMtime > del)) return;
    seen.add(h);
    out.push(h);
  };
  (Array.isArray(localArr) ? localArr : []).forEach((h) => push(h, localMtime));
  (Array.isArray(incomingArr) ? incomingArr : []).forEach((h) => push(h, incomingMtime));
  return out;
};

const sendBack = async (store, meta, legacy, tombs) => {
  if (!state.action || !state.key) return;
  try {
    const payload = await encryptPayload(state.key, {
      op: 'snapshot-back', v: 2,
      data: { version: 1, exportedAt: new Date().toISOString(), store, legacy },
      meta,
      tombs: tombs || {}
    });
    sendToPartner(payload);
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
  const localTombs = loadTombs();
  const incomingTombs = (msg.tombs && typeof msg.tombs === 'object') ? msg.tombs : {};
  const summary = { applied: 0, kept: 0, merged: 0, removed: 0, flagged: [] };

  const { mergeNotes, maxMergeMap } = window.MentriaStore;
  const mergedDeletedNotes = maxMergeMap(parseRaw(localStore['quick_notes.deleted']), parseRaw(incoming['quick_notes.deleted']), 200);
  const mergedDeletedColors = maxMergeMap(parseRaw(localStore['tools.color_picker_deleted']), parseRaw(incoming['tools.color_picker_deleted']), 200);

  const additions = [];
  const unions = [];
  const lwwReplace = [];
  const vaultAsks = [];
  const keeps = [];
  const deletions = [];

  Object.keys(incoming).forEach((suffix) => {
    if (window.MentriaStore.isLocalOnly(suffix)) return;
    const rawIn = window.MentriaStore.adopt(suffix, String(incoming[suffix]));
    const rawLocal = localStore[suffix];
    const { ns, key } = splitSuffix(suffix);
    const inMtime = (typeof meta[suffix] === 'number') ? meta[suffix] : null;
    const localTomb = (typeof localTombs[suffix] === 'number') ? localTombs[suffix] : null;

    if (localTomb != null && localTomb > ((inMtime != null) ? inMtime : -Infinity)) return;
    if (rawLocal != null && rawLocal === String(rawIn)) {
      if (isVault(suffix)) state.vaultLinked.add(suffix);
      return;
    }

    if (rawLocal == null) {
      additions.push({ ns, key, raw: rawIn, mtime: inMtime });
      if (isVault(suffix)) state.vaultLinked.add(suffix);
      return;
    }

    const localMtime = localMtimeOf(ns, key);

    if (isVault(suffix) && (suffix === 'totp.vault' || !sameVault(suffix, rawLocal, rawIn))) {
      if (state.vaultKept.has(suffix)) {
        keeps.push(suffix); summary.kept++;
      } else if (inMtime != null && localMtime != null && inMtime > localMtime) {
        vaultAsks.push({ suffix, ns, key, raw: rawIn, mtime: inMtime });
      } else {
        keeps.push(suffix); summary.kept++; summary.flagged.push(suffix);
      }
      return;
    }

    if (suffix === 'quick_notes.blob' || suffix === 'quick_notes.inbox') {
      unions.push({ suffix, ns, key, value: mergeNotes(parseRaw(rawLocal), parseRaw(rawIn), mergedDeletedNotes) });
      return;
    }
    if (suffix === 'tools.color_picker_palette') {
      unions.push({ suffix, ns, key, value: mergePalette(parseRaw(rawLocal), localMtime, parseRaw(rawIn), inMtime, mergedDeletedColors) });
      return;
    }
    if (suffix === 'quick_notes.deleted' || suffix === 'tools.color_picker_deleted') {
      unions.push({ suffix, ns, key, value: maxMergeMap(parseRaw(rawLocal), parseRaw(rawIn), 200) });
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

  Object.keys(incomingTombs).forEach((suffix) => {
    const tm = Number(incomingTombs[suffix]);
    if (!isFinite(tm) || window.MentriaStore.isLocalOnly(suffix)) return;
    const { ns, key } = splitSuffix(suffix);
    const rawLocal = localStore[suffix];
    if (rawLocal != null) {
      if (isVault(suffix) && !state.vaultLinked.has(suffix)) return;
      const localMtime = localMtimeOf(ns, key);
      if (localMtime == null || tm > localMtime) deletions.push({ suffix, ns, key, mtime: tm });
    } else {
      recordTomb(ns, key, tm);
    }
  });

  if (lwwReplace.length && !state.applyApproved) {
    const ok = await approveReplace(lwwReplace.map((x) => x.suffix));
    if (!ok) {
      lwwReplace.forEach((x) => { keeps.push(x.suffix); summary.kept++; });
      lwwReplace.length = 0;
    }
  }

  const vaultReplace = [];
  for (const v of vaultAsks) {
    const ok = await approveVault(v.suffix);
    if (ok) {
      vaultReplace.push(v);
      state.vaultLinked.add(v.suffix);
      state.vaultKept.delete(v.suffix);
    } else {
      keeps.push(v.suffix); summary.kept++;
      state.vaultKept.add(v.suffix);
      state.vaultLinked.delete(v.suffix);
    }
    sendVaultChoice(v.suffix, !ok);
  }

  saveRescue(lwwReplace.concat(vaultReplace, deletions).map((x) => x.suffix));

  additions.forEach((a) => {
    window.MentriaStore.set(a.ns, a.key, parseRaw(a.raw), { mtime: a.mtime != null ? a.mtime : Date.now(), remote: true });
    summary.applied++;
  });
  unions.forEach((u) => {
    window.MentriaStore.set(u.ns, u.key, u.value, { mtime: Date.now(), remote: true });
    summary.merged++;
  });
  lwwReplace.concat(vaultReplace).forEach((l) => {
    window.MentriaStore.set(l.ns, l.key, parseRaw(l.raw), { mtime: l.mtime != null ? l.mtime : Date.now(), remote: true });
    summary.applied++;
  });
  deletions.forEach((del) => {
    window.MentriaStore.remove(del.ns, del.key, { remote: true });
    recordTomb(del.ns, del.key, del.mtime);
    summary.removed++;
  });

  Object.keys(incomingLegacy).forEach((k) => {
    if (typeof k !== 'string' || k.indexOf('mentria_') !== 0 || window.MentriaStore.isLocalLegacy(k)) return;
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

    const replyTombs = loadTombs();
    if (Object.keys(replyStore).length || Object.keys(replyLegacy).length || Object.keys(replyTombs).length) {
      await sendBack(replyStore, replyMeta, replyLegacy, replyTombs);
    }
  }

  state.syncedSinceConnect += (summary.applied + summary.merged + summary.removed);
  emit('synced', { restored: summary.applied + summary.merged, summary });
};

const handleIncoming = async (payload, from) => {
  let msg;
  try {
    msg = await decryptPayload(state.key, payload);
  } catch (err) {
    emit('error', new Error('decrypt failed: ' + err.message));
    return;
  }
  if (!msg || typeof msg !== 'object') return;

  if (state.code && from) {
    if (msg.op === 'hello' || msg.op === 'welcome' || msg.op === 'busy') { await handshake(msg, from); return; }
    if (state.partner && from !== state.partner) return;
    if (!state.partner) {
      if (state.isInitiator || msg.op !== 'snapshot') return;
      acceptPartner(from);
    }
  }

  if (msg.op === 'vault' && typeof msg.suffix === 'string' && isVault(msg.suffix)) {
    if (msg.keep) { state.vaultKept.add(msg.suffix); state.vaultLinked.delete(msg.suffix); }
    else { state.vaultLinked.add(msg.suffix); state.vaultKept.delete(msg.suffix); }
    return;
  }

  if ((msg.op === 'snapshot' || msg.op === 'snapshot-back') && msg.v === 2 && msg.data) {
    try {
      await mergeV2(msg, msg.op === 'snapshot-back');
      state.exchanged = true;
    } catch (err) {
      emit('error', new Error('merge failed: ' + err.message));
    }
    return;
  }

  if (msg.op === 'snapshot' && msg.data) {
    try {
      const conflicts = collectConflicts(msg.data).filter((k) => !window.MentriaStore.isLocalOnly(k) && !window.MentriaStore.isLocalLegacy(k));
      const vaultSkip = conflicts.filter(isVault);
      const others = conflicts.filter((k) => !isVault(k));
      if (!state.applyApproved && others.length && !(await approveReplace(others))) { emit('synced', { restored: 0, declined: true }); return; }
      state.applyApproved = true;
      saveRescue(others.filter((k) => k.indexOf('mentria_') !== 0));
      const result = window.MentriaStore.importAll(msg.data, { mode: 'merge', skip: vaultSkip });
      state.syncedSinceConnect += result.restored;
      state.exchanged = true;
      emit('synced', { restored: result.restored });
    } catch (err) {
      emit('error', new Error('snapshot import failed: ' + err.message));
    }
    return;
  }

  if ((msg.op === 'set' || msg.op === 'remove') && typeof msg.ns === 'string' && typeof msg.key === 'string' && window.MentriaStore.isLocalOnly(msg.ns + '.' + msg.key)) return;
  if (msg.op === 'set' && typeof msg.ns === 'string' && typeof msg.key === 'string') {
    let value = msg.value;
    const suffix = msg.ns + '.' + msg.key;
    if (isVault(suffix)) {
      if (!vaultFollows(suffix, value)) return;
      state.vaultLinked.add(suffix);
    }
    if (msg.ns === 'identity' && msg.key === 'vault') {
      try { value = JSON.parse(window.MentriaStore.adopt('identity.vault', JSON.stringify(value))); } catch (_) {}
    }
    window.MentriaStore.set(msg.ns, msg.key, value, { remote: true, mtime: msg.mtime });
    state.syncedSinceConnect++;
    emit('synced', { restored: 1 });
    return;
  }
  if (msg.op === 'remove' && typeof msg.ns === 'string' && typeof msg.key === 'string') {
    const gone = msg.ns + '.' + msg.key;
    if (isVault(gone) && (state.vaultKept.has(gone) || !state.vaultLinked.has(gone))) return;
    window.MentriaStore.remove(msg.ns, msg.key, { remote: true });
    recordTomb(msg.ns, msg.key, (typeof msg.mtime === 'number') ? msg.mtime : Date.now());
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
  if (window.MentriaStore.isLocalOnly(d.ns + '.' + d.key)) return;
  if (state.vaultKept.has(d.ns + '.' + d.key)) return;
  try {
    const mtime = (typeof d.mtime === 'number') ? d.mtime : Date.now();
    let value = d.value;
    if (d.ns === 'identity' && d.key === 'vault' && value && typeof value === 'object' && value.device) {
      value = Object.assign({}, value);
      delete value.device;
    }
    const payload = await encryptPayload(state.key, { op: d.op, ns: d.ns, key: d.key, value, mtime });
    sendToPartner(payload);
  } catch (err) {
    emit('error', err);
  }
};

const sendSnapshot = async () => {
  if (!state.action || !state.key) return;
  try {
    const snap = window.MentriaStore.exportAll();
    const payload = await encryptPayload(state.key, { op: 'snapshot', v: 2, data: snap, meta: buildMeta(snap.store || {}), tombs: loadTombs() });
    sendToPartner(payload);
  } catch (err) {
    emit('error', err);
  }
};

const resetSession = () => {
  clearTimeout(state.joinTimer);
  clearTimeout(state.helloTimer);
  state.applyApproved = false;
  state.approval = null;
  state.syncedSinceConnect = 0;
  state.partner = null;
  state.exchanged = false;
  state.refused = false;
  state.snapshotSent = false;
  state.vaultChoice = {};
  state.vaultLinked.clear();
  state.vaultKept.clear();
  state.peers.clear();
};

const sendControl = async (op, to) => {
  if (!state.action || !state.key) return;
  try { state.action.send(await encryptPayload(state.key, { op, initiator: state.isInitiator }), to); } catch (_) {}
};

const armJoinTimer = () => {
  if (state.isInitiator) return;
  clearTimeout(state.joinTimer);
  state.joinTimer = setTimeout(async () => {
    if (state.partner || state.status !== 'connecting') return;
    await disconnect();
    const err = new Error('no-peer');
    err.code = 'no-peer';
    emit('error', err);
  }, JOIN_TIMEOUT_MS);
};

const acceptPartner = (peerId) => {
  if (state.partner === peerId) return;
  clearTimeout(state.joinTimer);
  clearTimeout(state.helloTimer);
  state.partner = peerId;
  state.peers.clear();
  state.peers.add(peerId);
  setStatus('connected');
};

const startSync = () => {
  if (!state.isInitiator || state.snapshotSent) return;
  state.snapshotSent = true;
  sendSnapshot();
};

const handshake = async (msg, from) => {
  if (msg.op === 'hello') {
    if (!state.isInitiator || msg.initiator) return;
    if (state.partner && state.partner !== from) { sendControl('busy', from); return; }
    acceptPartner(from);
    sendControl('welcome', from);
    startSync();
    return;
  }
  if (state.isInitiator || !msg.initiator) return;
  if (msg.op === 'welcome') {
    if (state.partner && state.partner !== from) return;
    acceptPartner(from);
    return;
  }
  if (msg.op === 'busy' && !state.partner && !state.refused) {
    state.refused = true;
    await disconnect();
    const err = new Error('code-busy');
    err.code = 'busy';
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
  resetSession();

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
  state.action.onMessage = (data, ctx) => {
    handleIncoming(data, (ctx && ctx.peerId) || null);
  };

  state.room.onPeerJoin = (peerId) => {
    if (state.partner) return;
    if (!state.isInitiator) { sendControl('hello', peerId); return; }
    clearTimeout(state.helloTimer);
    state.helloTimer = setTimeout(() => {
      if (state.partner || !state.room) return;
      acceptPartner(peerId);
      startSync();
    }, HELLO_FALLBACK_MS);
  };
  state.room.onPeerLeave = (peerId) => {
    if (peerId !== state.partner) return;
    state.peers.delete(peerId);
    if (state.exchanged) { disconnect(); return; }
    state.partner = null;
    state.snapshotSent = false;
    setStatus(state.isInitiator ? 'pairing' : 'connecting');
    armJoinTimer();
  };

  window.addEventListener('mentria:write', onLocalWrite);

  armJoinTimer();
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
  resetSession();
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
  clearTimeout(state.joinTimer);
  clearTimeout(state.helloTimer);
  window.removeEventListener('mentria:write', onLocalWrite);
  const room = state.room;
  state.room = null;
  state.action = null;
  if (room) {
    try { await room.leave(); } catch (_) {}
  }
  state.peers.clear();
  state.code = null;
  state.roomId = null;
  state.key = null;
  state.isInitiator = false;
  state.applyApproved = false;
  state.approval = null;
  state.partner = null;
  state.exchanged = false;
  state.snapshotSent = false;
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
  formatCode, normalizeCode, restoreRescue, rescueInfo
};
