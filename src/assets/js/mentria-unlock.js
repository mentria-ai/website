import {
  SERVICES, b64u, unb64u, newRecoveryCode, normalizeCode, formatCode, rootKeyFrom,
  wrapWithCode, openWithCode, wrapWithPassphrase, openWithPassphrase, wrapWithPrf, openWithPrf,
  wrapWithDeviceKey, openWithDeviceKey, sealService, openService, makeBackupEntry, backupKeyFromEntry,
  createRecord, verifyRoot, isRecord, mergeRecords, listServiceEntries, addOther, touchDevice, retirementStatus, decideLaunch
} from './mentria-unlock-core.js';

const NS = 'keyring';
const KEY = 'vault';
const RECORD_KEY = 'mentria.store.keyring.vault';
const LOCAL_KEY = 'mentria.keyring.local';
const EPOCH_KEY = 'mentria.keyring.epoch';
const SEEN_KEY = 'mentria.keyring.seen';
const TAB_KEY = 'mentria.keyring.tab';
const OTHERS_KEY = 'mentria.keyring.others';
const DB_NAME = 'mentria-keyring';
const CHANNEL = 'mentria-unlock';
const LOCK_NAME = 'mentria-open';
const WRITE_LOCK = 'mentria-keyring-write';
const LINK_TRIES = 4;
const RP_NAME = 'Mentria';
const WEBAUTHN_MS = 90000;
const SEEN_MS = 15000;
const DAY_MS = 86400000;
const PROBE_MS = 2000;
const IDB_MS = 4000;
const IDB_OPEN_MS = 10000;

const mem = { root: null, bytes: null, kcv: null, epoch: null, code: null, codeSalt: null, pending: null, hasDevice: false, prf: 'unknown', launch: null };
const diag = { liveOther: null, marker: null, seenAgeMs: null, wasDiscarded: null, mobile: null, navType: null, standalone: null, decision: null };
const listeners = new Set();
let lastKey = null;
let attached = false;
let started = false;
let bootP = null;
let decided = null;
let channel = null;
let releaseLock = null;
let prfP = null;
let queue = Promise.resolve();

function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function own(o, k) { return isObj(o) && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined; }
function parse(raw) { try { return raw == null ? null : JSON.parse(raw); } catch (_) { return null; } }
function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (_) { return false; } }
function ssGet(k) { try { return sessionStorage.getItem(k); } catch (_) { return null; } }
function ssSet(k, v) { try { sessionStorage.setItem(k, v); return true; } catch (_) { return false; } }
function random(n) { return crypto.getRandomValues(new Uint8Array(n)); }
function iso() { return new Date().toISOString(); }
function release() { return document.documentElement.dataset.release || ''; }

function local() {
  const v = parse(lsGet(LOCAL_KEY));
  return isObj(v) ? v : {};
}

function saveLocal(patch) {
  const next = Object.assign(local(), patch);
  lsSet(LOCAL_KEY, JSON.stringify(next));
  return next;
}

function writeLocal(l) {
  lsSet(LOCAL_KEY, JSON.stringify(l));
}

function decide(v) {
  const l = local();
  l.remember = v;
  delete l.rememberPending;
  writeLocal(l);
}

function readOthers() {
  const raw = lsGet(OTHERS_KEY);
  if (raw == null) return [];
  const v = parse(raw);
  return Array.isArray(v) ? v : null;
}

function keepOther(rec) {
  const list = readOthers();
  if (!isRecord(rec) || !list) return false;
  return lsSet(OTHERS_KEY, JSON.stringify(addOther(list, rec)));
}

function clearManualLock(epoch) {
  const l = local();
  if (!Object.prototype.hasOwnProperty.call(l, 'manualLock')) return;
  if (typeof l.manualLock === 'number' && l.manualLock > epoch) return;
  delete l.manualLock;
  lsSet(LOCAL_KEY, JSON.stringify(l));
}

function manuallyLocked() {
  const m = local().manualLock;
  return typeof m === 'number' && m >= readEpoch();
}

function framed() {
  try { return window.top !== window && !!window.parent.document; } catch (_) { return false; }
}

function readEpoch() {
  const n = parseInt(lsGet(EPOCH_KEY), 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function bumpEpoch() {
  const n = readEpoch() + 1;
  lsSet(EPOCH_KEY, String(n));
  return n;
}

function readRecord() {
  const S = window.MentriaStore;
  const v = S && typeof S.get === 'function' ? S.get(NS, KEY) : parse(lsGet(RECORD_KEY));
  return isRecord(v) ? v : null;
}

function storeReady() {
  if (window.MentriaStore) return Promise.resolve(window.MentriaStore);
  if (document.readyState !== 'loading') return Promise.resolve(null);
  return new Promise((resolve) => {
    document.addEventListener('DOMContentLoaded', () => resolve(window.MentriaStore || null), { once: true });
  });
}

function store(S, rec) {
  if (!S || S.set(NS, KEY, rec) !== true) throw new Error('storage');
  post('record');
}

async function writeRecord(rec) {
  const S = await storeReady();
  await exclusive(async () => {
    const now = readRecord();
    if (!now) throw new Error('no-keyring');
    const next = now.kcv === rec.kcv ? mergeRecords(now, rec) : null;
    if (!next) throw new Error('wrong-key');
    if (canon(next) === canon(now)) return;
    store(S, next);
  });
}

function exclusive(fn) {
  if (!navigator.locks || typeof navigator.locks.request !== 'function') return Promise.resolve().then(fn);
  return navigator.locks.request(WRITE_LOCK, { mode: 'exclusive' }, fn);
}

function canon(v) {
  if (Array.isArray(v)) return '[' + v.map((x) => (x === undefined ? 'null' : canon(x))).join(',') + ']';
  if (isObj(v)) return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v);
}

function heal(e) {
  if (e.newValue == null || e.oldValue == null || !enabled()) return;
  const sides = [parse(e.oldValue), parse(e.newValue)].filter(isRecord);
  if (!sides.length) return;
  exclusive(async () => {
    const S = await storeReady();
    const now = readRecord();
    if (!now) return;
    let next = now;
    for (const side of sides) next = mergeRecords(next, side) || next;
    if (canon(next) === canon(now)) return;
    store(S, next);
    notify(true);
  }).catch(() => {});
}

function livePasskeys(rec) {
  return rec.wraps.prf.filter((e) => isObj(e) && !e.removed && typeof e.id === 'string' && typeof e.salt === 'string' && e.ct);
}

function livePass(w) { return isObj(w) && !w.removed && typeof w.ct === 'string'; }

function linkedEntry(rec, name) {
  const e = own(rec.services, name);
  return isObj(e) && e.ct ? e : null;
}

function linkedOf(rec) { return SERVICES.filter((n) => !!linkedEntry(rec, n)); }

function bytesOf(v) {
  if (v instanceof Uint8Array) return v;
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  if (Object.prototype.toString.call(v) === '[object ArrayBuffer]') return new Uint8Array(v);
  return null;
}

function sameBytes(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

function codeOk(rec) { return !retirementStatus(rec, SERVICES[0]).blockers.includes('code-unconfirmed'); }

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('session')) db.createObjectStore('session');
      if (!db.objectStoreNames.contains('keys')) db.createObjectStore('keys');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('idb'));
  });
}

function timed(p, ms, onLate) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      onLate();
      reject(new Error('idb'));
    }, ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

async function idb(store, mode, fn) {
  const opening = openDb();
  const db = await timed(opening, IDB_OPEN_MS, () => { opening.then((d) => d.close(), () => {}); });
  let tx = null;
  try {
    return await timed(new Promise((resolve, reject) => {
      tx = db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error || new Error('idb'));
      tx.onabort = () => reject(tx.error || new Error('idb'));
    }), IDB_MS, () => { try { if (tx) tx.abort(); } catch (_) {} });
  } finally {
    db.close();
  }
}

const idbGet = (store, key) => idb(store, 'readonly', (s) => s.get(key));
const idbPut = (store, key, value) => idb(store, 'readwrite', (s) => s.put(value, key));
const idbDel = (store, key) => idb(store, 'readwrite', (s) => s.delete(key));
const idbDelIf = (store, key, test) => idb(store, 'readwrite', (s) => {
  const g = s.get(key);
  g.onsuccess = () => { if (test(g.result)) s.delete(key); };
  return null;
});

function serial(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

function sessionLive() {
  if (!mem.root || !enabled() || mem.epoch !== readEpoch()) return false;
  const rec = readRecord();
  return !!rec && rec.kcv === mem.kcv;
}

function sessionTag() { return mem.root ? mem.epoch + '|' + mem.kcv : ''; }

function drop() {
  mem.root = null;
  mem.bytes = null;
  mem.kcv = null;
  mem.epoch = null;
}

function forget() {
  drop();
  mem.code = null;
  mem.codeSalt = null;
  mem.pending = null;
}

function notify(force) {
  const s = state();
  const k = JSON.stringify(s);
  if (!force && k === lastKey) return;
  lastKey = k;
  for (const fn of [...listeners]) {
    try { fn(s); } catch (_) {}
  }
}

async function sync(force) {
  const rec = enabled() ? readRecord() : null;
  if (!rec) {
    drop();
    mem.hasDevice = false;
  } else {
    if (!bootP) {
      bootP = Promise.resolve();
      start();
    }
    const epoch = readEpoch();
    let session = null;
    let device = null;
    try { session = await idbGet('session', 'current'); } catch (_) {}
    try { device = await idbGet('keys', 'device'); } catch (_) {}
    mem.hasDevice = isObj(device) && device.kcv === rec.kcv && !!device.key && isObj(device.box);
    const valid = isObj(session) && session.epoch === epoch && session.kcv === rec.kcv && typeof CryptoKey === 'function' && session.root instanceof CryptoKey;
    if (valid) {
      if (mem.epoch !== epoch || mem.kcv !== rec.kcv) mem.bytes = null;
      mem.root = session.root;
      mem.kcv = rec.kcv;
      mem.epoch = epoch;
    } else {
      drop();
    }
  }
  if (started) mark();
  notify(force);
}

function refresh(force) { return serial(() => sync(force)); }

function openChannel() {
  if (channel || typeof BroadcastChannel !== 'function') return;
  channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (e) => {
    const t = e.data && e.data.type;
    if (t === 'lock' || t === 'unlock' || t === 'record') refresh(true);
  };
}

function closeChannel() {
  if (!channel) return;
  try { channel.close(); } catch (_) {}
  channel = null;
}

function post(type) {
  openChannel();
  try { if (channel) channel.postMessage({ type, epoch: readEpoch() }); } catch (_) {}
}

function hold() {
  if (releaseLock || !navigator.locks || typeof navigator.locks.request !== 'function') return;
  let done;
  const held = new Promise((resolve) => { done = resolve; });
  releaseLock = done;
  navigator.locks.request(LOCK_NAME, { mode: 'shared' }, () => held).catch(() => {});
}

function letGo() {
  if (!releaseLock) return;
  releaseLock();
  releaseLock = null;
}

async function othersLive() {
  try {
    if (!navigator.locks || typeof navigator.locks.query !== 'function') return false;
    const q = await navigator.locks.query();
    return (q.held || []).some((l) => l.name === LOCK_NAME);
  } catch (_) {
    return false;
  }
}

function seen() { lsSet(SEEN_KEY, JSON.stringify({ t: Date.now(), epoch: readEpoch() })); }
function mark() { ssSet(TAB_KEY, JSON.stringify({ epoch: readEpoch() })); }

function attach() {
  if (attached) return;
  attached = true;
  openChannel();
  window.addEventListener('storage', (e) => {
    if (e.key === RECORD_KEY) heal(e);
    if (e.key === null || e.key === EPOCH_KEY || e.key === RECORD_KEY) refresh(true);
    else if (e.key === LOCAL_KEY) refresh(false);
  });
  window.addEventListener('mentria:write', (e) => {
    const d = e.detail || {};
    if (d.ns === NS && d.key === KEY && d.remote) refresh(true);
  });
  window.addEventListener('pagehide', () => {
    if (started) seen();
    letGo();
    closeChannel();
  });
  window.addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    openChannel();
    if (started) {
      if (!framed()) hold();
      seen();
    }
    refresh(false);
  });
  document.addEventListener('visibilitychange', () => {
    if (started) seen();
    if (document.visibilityState === 'visible') refresh(false);
  });
}

function start() {
  if (started) return;
  started = true;
  attach();
  if (!framed()) hold();
  mark();
  seen();
  prfP = prfSupport().then(() => notify(false), () => {});
  setInterval(() => { if (document.visibilityState === 'visible') seen(); }, SEEN_MS);
}

function isMobile() {
  let coarse = false;
  try { coarse = window.matchMedia('(pointer: coarse)').matches; } catch (_) {}
  return coarse || /iPhone|iPad|Android/i.test(navigator.userAgent || '');
}

function navType() {
  try {
    const n = performance.getEntriesByType('navigation')[0];
    return n && n.type ? n.type : null;
  } catch (_) {
    return null;
  }
}

function isStandalone() {
  try { return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch (_) { return false; }
}

function inputs() {
  const tab = parse(ssGet(TAB_KEY));
  const last = parse(lsGet(SEEN_KEY));
  const age = isObj(last) && Number.isFinite(last.t) ? Math.max(0, Date.now() - last.t) : Infinity;
  return {
    marker: isObj(tab) ? tab : null,
    seenAgeMs: age,
    wasDiscarded: document.wasDiscarded === true,
    mobile: isMobile()
  };
}

async function launchScreen() {
  try {
    const ui = await import('./mentria-unlock-ui.js');
    await ui.showLaunch();
  } catch (_) {}
}

async function boot(markDecided) {
  attach();
  const inFrame = framed();
  const liveOther = inFrame ? null : await othersLive();
  const got = inputs();
  const decision = inFrame ? 'continue' : decideLaunch({ liveOther, marker: !!got.marker, seenAgeMs: got.seenAgeMs, wasDiscarded: got.wasDiscarded, mobile: got.mobile });
  Object.assign(diag, {
    liveOther,
    marker: got.marker,
    seenAgeMs: Number.isFinite(got.seenAgeMs) ? got.seenAgeMs : null,
    wasDiscarded: got.wasDiscarded,
    mobile: got.mobile,
    navType: navType(),
    standalone: isStandalone(),
    decision
  });
  if (decision === 'reopen') {
    forget();
    bumpEpoch();
    try { await idbDel('session', 'current'); } catch (_) {}
    post('lock');
  }
  mem.launch = decision;
  start();
  markDecided();
  await refresh(false);
  if (!sessionLive() && mem.hasDevice) await unlockWithDevice();
  await prfP;
  const s = state();
  if (!inFrame && decision === 'reopen' && s.askAtLaunch && !s.unlocked && !document.documentElement.hasAttribute('data-unlock-tool')) launchScreen();
  notify(false);
  return state();
}

async function decidedFirst() {
  if (!bootP) ready();
  if (decided) await decided;
}

async function openSession(bytes, rec, silent) {
  await decidedFirst();
  await verifyRoot(rec, bytes);
  const root = await rootKeyFrom(bytes);
  const live = await serial(async () => {
    const epoch = readEpoch();
    const nonce = b64u(random(16));
    await idbPut('session', 'current', { epoch, openedAt: Date.now(), kcv: rec.kcv, root, nonce });
    mem.root = root;
    mem.bytes = silent ? null : new Uint8Array(bytes);
    mem.kcv = rec.kcv;
    mem.epoch = epoch;
    if (sessionLive() && !(silent && manuallyLocked())) {
      if (!silent) clearManualLock(epoch);
      return true;
    }
    drop();
    try { await idbDelIf('session', 'current', (row) => isObj(row) && row.epoch === epoch && row.nonce === nonce); } catch (_) {}
    return false;
  });
  if (!live) {
    notify(false);
    throw new Error('locked');
  }
  if (started) mark();
  post('unlock');
  touch(rec);
  notify(true);
}

function touch(rec) {
  try {
    const id = deviceId();
    const d = own(rec.devices, id);
    if (isObj(d) && d.keyring === 1 && Date.now() - Date.parse(d.lastSeen) < DAY_MS) return;
    const fresh = readRecord();
    if (!fresh || fresh.kcv !== rec.kcv) return;
    writeRecord(touchDevice(fresh, id, { app: release(), keyring: 1 })).catch(() => {});
  } catch (_) {}
}

function need() {
  if (!enabled()) throw new Error('disabled');
  const rec = readRecord();
  if (!rec) throw new Error('no-keyring');
  return rec;
}

function sameKeyring(rec) {
  const fresh = readRecord();
  if (!fresh || fresh.kcv !== rec.kcv) throw new Error('wrong-key');
  return fresh;
}

function extOf(cred) {
  try { return cred.getClientExtensionResults() || null; } catch (_) { return null; }
}

function prfOf(cred) {
  const r = extOf(cred);
  const first = r && r.prf && r.prf.results && r.prf.results.first;
  return first ? new Uint8Array(first) : null;
}

function ceremony(kind, publicKey) {
  const ac = typeof AbortController === 'function' ? new AbortController() : null;
  const call = navigator.credentials[kind](ac ? { publicKey, signal: ac.signal } : { publicKey });
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      try { if (ac) ac.abort(); } catch (_) {}
      reject(new Error('webauthn-timeout'));
    }, WEBAUTHN_MS);
    call.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

function webauthnReady() {
  if (!window.PublicKeyCredential || !navigator.credentials) throw new Error('no-prf');
}

async function passkeyRoot(rec) {
  const list = livePasskeys(rec);
  if (!list.length) throw new Error('no-passkey');
  webauthnReady();
  const evalByCredential = {};
  for (const e of list) evalByCredential[e.id] = { first: unb64u(e.salt) };
  const cred = await ceremony('get', {
    challenge: random(32),
    rpId: location.hostname,
    allowCredentials: list.map((e) => ({ type: 'public-key', id: unb64u(e.id) })),
    userVerification: 'required',
    timeout: WEBAUTHN_MS,
    extensions: { prf: { evalByCredential } }
  });
  if (!cred) throw new Error('no-credential');
  const id = b64u(new Uint8Array(cred.rawId));
  const entry = list.find((e) => e.id === id);
  if (!entry) throw new Error('unknown-passkey');
  const out = prfOf(cred);
  if (!out) throw new Error('no-prf');
  return openWithPrf(entry, out);
}

async function adopt(bytes, rec) {
  await verifyRoot(rec, bytes);
  if (sessionLive() && mem.kcv === rec.kcv) {
    mem.bytes = new Uint8Array(bytes);
    notify(false);
    return;
  }
  await openSession(bytes, rec);
}

export function enabled() {
  return document.documentElement.dataset.release === 'beta' && local().enabled === true;
}

export function setEnabled(on) {
  saveLocal({ enabled: !!on });
  if (!on) {
    forget();
    if (readRecord()) serial(async () => { try { await idbDel('session', 'current'); } catch (_) {} });
  }
  if (on && readRecord()) ready().catch(() => {});
  refresh(false);
}

export function ready() {
  if (bootP) return bootP.then(() => state());
  if (window.__mentriaRedirecting || !enabled() || !readRecord()) return Promise.resolve(state());
  let markDecided;
  decided = new Promise((resolve) => { markDecided = resolve; });
  bootP = boot(markDecided).catch(() => {
    markDecided();
    return state();
  });
  return bootP;
}

export function state() {
  const on = enabled();
  const rec = readRecord();
  return {
    enabled: on,
    setUp: !!rec,
    unlocked: !!rec && sessionLive(),
    epoch: readEpoch(),
    linked: rec ? linkedOf(rec) : [],
    prf: mem.prf,
    passkeys: rec ? livePasskeys(rec).length : 0,
    hasPass: !!rec && livePass(rec.wraps.pass),
    hasDevice: !!rec && on && mem.hasDevice,
    codeConfirmed: !!rec && codeOk(rec),
    askAtLaunch: local().askAtLaunch === true,
    launch: mem.launch
  };
}

export function onChange(fn) {
  attach();
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export async function create({ code, confirmed, deviceName } = {}) {
  if (!enabled()) throw new Error('disabled');
  mem.pending = null;
  if (lsGet(RECORD_KEY) != null || readRecord()) throw new Error('exists');
  const given = code != null && code !== '';
  let text;
  if (given) {
    const n = normalizeCode(String(code));
    if (!n) throw new Error('bad-code');
    text = formatCode(n);
  } else {
    text = newRecoveryCode();
  }
  const { record, rootBytes } = await createRecord({ code: text, deviceId: deviceId(), deviceName, app: release() });
  if (given && confirmed === true) record.codeConfirmed = record.wraps.recovery.created;
  const S = await storeReady();
  await exclusive(async () => {
    if (lsGet(RECORD_KEY) != null || readRecord()) throw new Error('exists');
    if (!S || S.set(NS, KEY, record) !== true) throw new Error('storage');
  });
  if (!bootP) {
    bootP = Promise.resolve();
    start();
  }
  post('record');
  try {
    await openSession(rootBytes, record);
  } catch (e) {
    const now = readRecord();
    const mine = !!now && now.kcv === record.kcv;
    if (!mine && lsGet(RECORD_KEY) != null) throw new Error('exists');
    if (mine && e && e.message === 'locked') {
      mem.code = text;
      mem.codeSalt = record.wraps.recovery.salt;
      return { code: text };
    }
    if (mine) {
      keepOther(now);
      try { S.remove(NS, KEY, { remote: true }); } catch (_) {}
      post('record');
    }
    throw e;
  }
  mem.code = text;
  mem.codeSalt = record.wraps.recovery.salt;
  notify(true);
  return { code: text };
}

export async function unlockWithPasskey() {
  const rec = need();
  const bytes = await passkeyRoot(rec);
  await openSession(bytes, rec);
}

export async function unlockWithCode(code) {
  const rec = need();
  const bytes = await openWithCode(rec.wraps.recovery, String(code == null ? '' : code));
  await openSession(bytes, rec);
}

export async function unlockWithPassphrase(pass) {
  const rec = need();
  if (!livePass(rec.wraps.pass)) throw new Error('no-pass');
  const bytes = await openWithPassphrase(rec.wraps.pass, pass);
  await openSession(bytes, rec);
}

export async function unlockWithDevice() {
  if (!enabled() || manuallyLocked()) return false;
  const rec = readRecord();
  if (!rec) return false;
  let entry = null;
  try { entry = await idbGet('keys', 'device'); } catch (_) { return false; }
  if (!isObj(entry) || entry.kcv !== rec.kcv || !entry.key || !isObj(entry.box)) return false;
  try {
    const bytes = await openWithDeviceKey(entry.box, entry.key);
    await openSession(bytes, rec, true);
    return true;
  } catch (_) {
    return false;
  }
}

export async function lock() {
  forget();
  const next = readEpoch() + 1;
  saveLocal({ manualLock: next });
  lsSet(EPOCH_KEY, String(next));
  if (started) {
    mark();
    seen();
  }
  await serial(async () => {
    forget();
    if (enabled() && readRecord()) {
      try { await idbDel('session', 'current'); } catch (_) {}
    }
  });
  post('lock');
  notify(true);
}

export async function secret(name) {
  if (!enabled() || !SERVICES.includes(name)) return null;
  const rec = readRecord();
  if (!rec || !sessionLive()) return null;
  const entry = own(rec.services, name);
  if (!isObj(entry) || !entry.ct) return null;
  const root = mem.root;
  const tag = sessionTag();
  const bytes = await openService(root, name, entry);
  if (sessionLive() && sessionTag() === tag) return bytes;
  bytes.fill(0);
  return null;
}

export async function secrets(name) {
  if (!enabled() || !SERVICES.includes(name)) return [];
  const rec = readRecord();
  if (!rec || !sessionLive()) return [];
  const root = mem.root;
  const tag = sessionTag();
  const cur = linkedEntry(rec, name);
  const list = listServiceEntries(rec, name);
  const out = [];
  for (let i = 0; i < list.length; i++) {
    try {
      out.push({ id: list[i].id, bytes: await openService(root, name, list[i].entry) });
    } catch (e) {
      if (i === 0 && cur) throw e;
    }
  }
  if (sessionLive() && sessionTag() === tag) return out;
  for (const x of out) x.bytes.fill(0);
  return [];
}

export function secretId(name) {
  if (!enabled() || !SERVICES.includes(name)) return null;
  const rec = readRecord();
  const cur = rec ? linkedEntry(rec, name) : null;
  return cur && typeof cur.id === 'string' && cur.id ? cur.id : null;
}

export async function link(name, bytes) {
  const rec = enabled() ? readRecord() : null;
  if (!rec || !sessionLive()) throw new Error('locked');
  if (!SERVICES.includes(name)) throw new Error('bad-service');
  const given = bytesOf(bytes);
  if (given && given.every((x) => x === 0)) throw new Error('bad-input');
  const root = mem.root;
  const tag = sessionTag();
  const live = () => {
    const fresh = readRecord();
    if (!fresh || !sessionLive() || sessionTag() !== tag) throw new Error('locked');
    return fresh;
  };
  const wrote = await exclusive(async () => {
    const S = await storeReady();
    let prev = linkedEntry(live(), name);
    for (let i = 1; ; i++) {
      const entry = await sealOver(root, name, prev, bytes);
      const fresh = live();
      const now = linkedEntry(fresh, name);
      if (entrySig(now) !== entrySig(prev)) {
        if (i >= LINK_TRIES) throw new Error('busy');
        prev = now;
        continue;
      }
      if (!entry) return false;
      const next = mergeRecords(fresh, Object.assign({}, fresh, { services: Object.assign({}, fresh.services, { [name]: entry }), changed: entry.linked }));
      if (!next) throw new Error('locked');
      store(S, next);
      return true;
    }
  });
  if (wrote) notify(true);
}

function entrySig(e) { return e ? [e.id, e.ct, e.linked].join('|') : ''; }

async function sealOver(root, name, prev, bytes) {
  let at = Date.now();
  if (prev) {
    let have = null;
    try { have = await openService(root, name, prev); } catch (_) {}
    if (sameBytes(have, bytesOf(bytes))) return null;
    const t = Date.parse(prev.linked);
    if (Number.isFinite(t) && t >= at) at = t + 1;
  }
  return sealService(root, name, bytes, at);
}

export function hasRootBytes() {
  return !!mem.bytes && sessionLive();
}

export async function confirmWithPasskey() {
  const rec = need();
  const bytes = await passkeyRoot(rec);
  await adopt(bytes, rec);
}

export async function confirmWithCode(code) {
  const rec = need();
  const bytes = await openWithCode(rec.wraps.recovery, String(code == null ? '' : code));
  await adopt(bytes, rec);
}

export async function addPasskey(label) {
  const rec = need();
  if (!hasRootBytes()) throw new Error('confirm-needed');
  webauthnReady();
  const bytes = mem.bytes;
  const salt = random(32);
  const cred = await ceremony('create', {
    challenge: random(32),
    rp: { id: location.hostname, name: RP_NAME },
    user: { id: unb64u(rec.id), name: RP_NAME, displayName: RP_NAME },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    timeout: WEBAUTHN_MS,
    excludeCredentials: livePasskeys(rec).map((e) => ({ type: 'public-key', id: unb64u(e.id) })),
    extensions: { prf: { eval: { first: salt } } }
  });
  if (!cred) throw new Error('no-credential');
  const made = extOf(cred);
  if (made && made.prf && made.prf.enabled === false) throw new Error('no-prf');
  const rawId = new Uint8Array(cred.rawId);
  let out = prfOf(cred);
  if (!out) {
    const got = await ceremony('get', {
      challenge: random(32),
      rpId: location.hostname,
      allowCredentials: [{ type: 'public-key', id: rawId }],
      userVerification: 'required',
      timeout: WEBAUTHN_MS,
      extensions: { prf: { eval: { first: salt } } }
    });
    out = got ? prfOf(got) : null;
  }
  if (!out) throw new Error('no-prf');
  const id = b64u(rawId);
  const entry = await wrapWithPrf(bytes, out, { id, salt: b64u(salt), label: label == null ? '' : String(label) });
  const fresh = sameKeyring(rec);
  fresh.wraps.prf = fresh.wraps.prf.filter((e) => !(isObj(e) && e.id === id)).concat([entry]);
  fresh.changed = iso();
  await writeRecord(fresh);
  notify(true);
}

export async function removePasskey(id) {
  const rec = need();
  if (!sessionLive()) throw new Error('locked');
  if (!hasRootBytes()) throw new Error('confirm-needed');
  const at = iso();
  let hit = false;
  rec.wraps.prf = rec.wraps.prf.map((e) => {
    if (isObj(e) && e.id === id && !e.removed) {
      hit = true;
      return { id, removed: at };
    }
    return e;
  });
  if (!hit) return;
  rec.changed = at;
  await writeRecord(rec);
  notify(true);
}

export async function setPassphrase(pass) {
  const rec = need();
  if (pass == null || pass === '') {
    if (!sessionLive()) throw new Error('locked');
    if (!hasRootBytes()) throw new Error('confirm-needed');
    if (!livePass(rec.wraps.pass)) return;
    const at = iso();
    rec.wraps.pass = { removed: at };
    rec.changed = at;
    await writeRecord(rec);
    notify(true);
    return;
  }
  if (!hasRootBytes()) throw new Error('confirm-needed');
  const wrap = await wrapWithPassphrase(mem.bytes, pass);
  const fresh = sameKeyring(rec);
  fresh.wraps.pass = wrap;
  fresh.changed = wrap.created;
  await writeRecord(fresh);
  notify(true);
}

export async function setRemember(on, opts) {
  const decided = isObj(opts) && opts.decided === true;
  const rec = need();
  if (!on) {
    try { await idbDel('keys', 'device'); } catch (_) {}
    mem.hasDevice = false;
    if (decided) decide('off');
    post('record');
    notify(false);
    return;
  }
  if (!hasRootBytes()) throw new Error('confirm-needed');
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const box = await wrapWithDeviceKey(mem.bytes, key);
  await idbPut('keys', 'device', { kcv: rec.kcv, key, box });
  mem.hasDevice = true;
  if (decided) decide('on');
  post('record');
  notify(false);
}

export function rememberDecision() {
  const v = local().remember;
  return v === 'on' || v === 'off' ? v : '';
}

export function setRememberDecision(v) {
  const l = local();
  if (v === 'on' || v === 'off') l.remember = v;
  else delete l.remember;
  writeLocal(l);
}

export function rememberPending() {
  return local().rememberPending === true;
}

export function setRememberPending(on) {
  const l = local();
  if (on) l.rememberPending = true;
  else delete l.rememberPending;
  writeLocal(l);
}

export function others() {
  if (!enabled()) return [];
  const rec = readRecord();
  const seen = new Set();
  const out = [];
  for (const o of readOthers() || []) {
    if (!isRecord(o) || (rec && o.kcv === rec.kcv) || seen.has(o.kcv)) continue;
    const services = SERVICES.filter((n) => listServiceEntries(o, n).length > 0);
    if (!services.length) continue;
    seen.add(o.kcv);
    out.push({
      kcv: o.kcv,
      created: typeof o.created === 'string' ? o.created : null,
      services,
      passkeys: livePasskeys(o).length
    });
  }
  return out;
}

function otherRoot(other, m) {
  if (m.passkey === true) return passkeyRoot(other);
  if (typeof m.passphrase === 'string') {
    if (!livePass(other.wraps.pass)) return Promise.reject(new Error('no-pass'));
    return openWithPassphrase(other.wraps.pass, m.passphrase);
  }
  if (m.code != null && m.code !== '') return openWithCode(other.wraps.recovery, String(m.code));
  return Promise.reject(new Error('bad-input'));
}

async function openAll(root, rec, name, missed) {
  const out = [];
  for (const x of listServiceEntries(rec, name)) {
    try {
      out.push({ id: x.id, linked: x.entry.linked, bytes: await openService(root, name, x.entry) });
    } catch (_) {
      if (missed) missed.count += 1;
    }
  }
  return out;
}

async function sealFolded(root, name, item, at) {
  const e = await sealService(root, name, item.bytes, at);
  if (item.id) e.id = item.id;
  else delete e.id;
  return e;
}

async function foldService(root, fresh, name, found) {
  const have = await openAll(root, fresh, name);
  const add = found.filter((f) => !have.some((h) => sameBytes(h.bytes, f.bytes)));
  for (const h of have) h.bytes.fill(0);
  if (!add.length) return null;
  const cur = linkedEntry(fresh, name);
  const was = own(fresh.services, name);
  const before = isObj(was) && Array.isArray(was.prior) ? was.prior : [];
  const sealed = [];
  if (cur) {
    const top = Date.parse(cur.linked);
    for (let i = 0; i < add.length; i++) {
      const t = Date.parse(add[i].linked);
      const cap = Number.isFinite(top) ? top - 1 - i : Date.now() - 1 - i;
      sealed.push(await sealFolded(root, name, add[i], Number.isFinite(t) ? Math.min(t, cap) : cap));
    }
    return Object.assign({}, cur, { prior: before.concat(sealed) });
  }
  const now = Date.now();
  const head = await sealFolded(root, name, add[0], now);
  for (let i = 1; i < add.length; i++) {
    const t = Date.parse(add[i].linked);
    const cap = now - i;
    sealed.push(await sealFolded(root, name, add[i], Number.isFinite(t) ? Math.min(t, cap) : cap));
  }
  const prior = before.concat(sealed);
  return prior.length ? Object.assign(head, { prior }) : head;
}

export async function foldIn(kcv, method) {
  const rec = need();
  if (!sessionLive()) throw new Error('locked');
  const other = (readOthers() || []).find((o) => isRecord(o) && o.kcv === kcv && o.kcv !== rec.kcv);
  if (!other) throw new Error('no-keyring');
  const bytes = await otherRoot(other, isObj(method) ? method : {});
  let theirs;
  try {
    await verifyRoot(other, bytes);
    theirs = await rootKeyFrom(bytes);
  } finally {
    bytes.fill(0);
  }
  const found = {};
  const missed = { count: 0 };
  for (const n of SERVICES) {
    const list = await openAll(theirs, other, n, missed);
    if (list.length) found[n] = list;
  }
  const root = mem.root;
  const tag = sessionTag();
  const live = () => {
    const fresh = readRecord();
    if (!fresh || fresh.kcv !== rec.kcv || !sessionLive() || sessionTag() !== tag) throw new Error('locked');
    return fresh;
  };
  try {
    const wrote = await exclusive(async () => {
      const S = await storeReady();
      let base = live();
      let services;
      let fresh;
      for (let i = 1; ; i++) {
        services = {};
        for (const n of Object.keys(found)) {
          const next = await foldService(root, base, n, found[n]);
          if (next) services[n] = next;
        }
        fresh = live();
        if (!Object.keys(found).some((n) => entrySig(linkedEntry(fresh, n)) !== entrySig(linkedEntry(base, n)))) break;
        if (i >= LINK_TRIES) throw new Error('busy');
        base = fresh;
      }
      if (Object.keys(services).length) {
        const next = mergeRecords(fresh, Object.assign({}, fresh, { services: Object.assign({}, fresh.services, services), changed: iso() }));
        if (!next) throw new Error('locked');
        store(S, next);
      }
      const list = readOthers();
      if (list && !missed.count && !lsSet(OTHERS_KEY, JSON.stringify(list.filter((o) => !(isObj(o) && o.kcv === kcv))))) throw new Error('storage');
      return Object.keys(services).length > 0;
    });
    notify(wrote);
  } finally {
    for (const n of Object.keys(found)) for (const f of found[n]) f.bytes.fill(0);
  }
}

export async function regenerateCode() {
  const rec = need();
  if (!hasRootBytes()) throw new Error('confirm-needed');
  const text = newRecoveryCode();
  const wrap = await wrapWithCode(mem.bytes, text);
  const backup = await makeBackupEntry(mem.root, text);
  const fresh = sameKeyring(rec);
  mem.pending = { text, wrap, backup, kcv: fresh.kcv, base: fresh.wraps.recovery.salt };
  notify(true);
  return text;
}

export function dropPendingCode() {
  mem.pending = null;
}

export function confirmCode(last4) {
  const cur = readRecord();
  if (mem.pending && (!cur || cur.kcv !== mem.pending.kcv)) mem.pending = null;
  const p = mem.pending;
  const text = p ? p.text : mem.code;
  if (!text) return false;
  const want = text.replace(/-/g, '').slice(-4).toUpperCase();
  const got = String(last4 == null ? '' : last4).replace(/[\s-]/g, '').toUpperCase();
  if (got.length !== 4 || got !== want) return false;
  const S = window.MentriaStore;
  const rec = readRecord();
  if (!S || !rec) return false;
  if (p ? rec.kcv !== p.kcv || rec.wraps.recovery.salt !== p.base : rec.wraps.recovery.salt !== mem.codeSalt) {
    if (p) mem.pending = null;
    return false;
  }
  const at = iso();
  const cand = Object.assign({}, rec, { codeConfirmed: at, changed: at });
  if (p) {
    cand.wraps = Object.assign({}, rec.wraps, { recovery: p.wrap });
    cand.backup = p.backup;
  }
  const now = readRecord();
  const next = now && now.kcv === rec.kcv ? mergeRecords(now, cand) : null;
  if (!next || S.set(NS, KEY, next) !== true) return false;
  if (p) {
    mem.pending = null;
    mem.code = p.text;
    mem.codeSalt = p.wrap.salt;
  }
  post('record');
  notify(true);
  return true;
}

export async function backupKey() {
  const rec = enabled() ? readRecord() : null;
  if (!rec || !isObj(rec.backup) || !sessionLive()) return null;
  try {
    const key = await backupKeyFromEntry(mem.root, rec.backup);
    return { key, salt: rec.backup.salt, kcv: rec.kcv };
  } catch (_) {
    return null;
  }
}

export function passkeys() {
  const rec = readRecord();
  if (!rec) return [];
  return livePasskeys(rec).map((e) => ({ id: e.id, label: typeof e.label === 'string' ? e.label : '', created: e.created || null }));
}

export async function prfSupport() {
  let out = 'unknown';
  try {
    if (!window.PublicKeyCredential || !navigator.credentials || !window.crypto || !crypto.subtle) {
      out = 'no';
    } else if (typeof PublicKeyCredential.getClientCapabilities === 'function') {
      const caps = await Promise.race([
        PublicKeyCredential.getClientCapabilities(),
        new Promise((resolve) => setTimeout(() => resolve(null), PROBE_MS))
      ]);
      if (caps && caps['extension:prf'] === true) out = 'yes';
      else if (caps && caps['extension:prf'] === false) out = 'no';
    }
  } catch (_) {
    out = 'unknown';
  }
  mem.prf = out;
  return out;
}

export function setAskAtLaunch(on) {
  saveLocal({ askAtLaunch: !!on });
  notify(false);
}

export function retirement(service, { notesConverted } = {}) {
  if (!enabled()) return { ready: false, blockers: ['disabled'] };
  return retirementStatus(readRecord(), service, { notesConverted });
}

export async function markRetired(service) {
  const rec = need();
  if (!SERVICES.includes(service)) throw new Error('bad-service');
  if (own(rec.retired, service)) return;
  const at = iso();
  rec.retired = Object.assign({}, rec.retired, { [service]: at });
  rec.changed = at;
  await writeRecord(rec);
  notify(true);
}

export function deviceId() {
  const l = local();
  if (typeof l.deviceId === 'string' && l.deviceId) return l.deviceId;
  const id = b64u(random(16));
  saveLocal({ deviceId: id });
  return id;
}

export function diagnostics() {
  if (diag.decision) return Object.assign({}, diag, { epoch: readEpoch() });
  const got = inputs();
  return {
    liveOther: null,
    marker: got.marker,
    seenAgeMs: Number.isFinite(got.seenAgeMs) ? got.seenAgeMs : null,
    wasDiscarded: got.wasDiscarded,
    mobile: got.mobile,
    navType: navType(),
    standalone: isStandalone(),
    decision: null,
    epoch: readEpoch()
  };
}
