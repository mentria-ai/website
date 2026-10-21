import {
  SERVICES, b64u, unb64u, newRecoveryCode, normalizeCode, formatCode, rootKeyFrom,
  wrapWithCode, openWithCode, wrapWithPassphrase, openWithPassphrase, wrapWithPrf, openWithPrf,
  wrapWithDeviceKey, openWithDeviceKey, sealService, openService, makeBackupEntry, backupKeyFromEntry,
  createRecord, verifyRoot, isRecord, touchDevice, retirementStatus, decideLaunch
} from './mentria-unlock-core.js';

const NS = 'keyring';
const KEY = 'vault';
const RECORD_KEY = 'mentria.store.keyring.vault';
const LOCAL_KEY = 'mentria.keyring.local';
const EPOCH_KEY = 'mentria.keyring.epoch';
const SEEN_KEY = 'mentria.keyring.seen';
const TAB_KEY = 'mentria.keyring.tab';
const DB_NAME = 'mentria-keyring';
const CHANNEL = 'mentria-unlock';
const LOCK_NAME = 'mentria-open';
const RP_NAME = 'Mentria';
const WEBAUTHN_MS = 90000;
const SEEN_MS = 15000;
const DAY_MS = 86400000;
const PROBE_MS = 2000;

const mem = { root: null, bytes: null, kcv: null, epoch: null, code: null, codeSalt: null, hasDevice: false, prf: 'unknown', launch: null };
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

function clearManualLock(epoch) {
  const l = local();
  if (!Object.prototype.hasOwnProperty.call(l, 'manualLock')) return;
  if (typeof l.manualLock === 'number' && l.manualLock > epoch) return;
  delete l.manualLock;
  lsSet(LOCAL_KEY, JSON.stringify(l));
}

function manuallyLocked() { return local().manualLock === readEpoch(); }

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

async function writeRecord(rec) {
  const S = await storeReady();
  if (!S || S.set(NS, KEY, rec) !== true) throw new Error('storage');
  post('record');
}

function livePasskeys(rec) {
  return rec.wraps.prf.filter((e) => isObj(e) && !e.removed && typeof e.id === 'string' && typeof e.salt === 'string' && e.ct);
}

function livePass(w) { return isObj(w) && !w.removed && typeof w.ct === 'string'; }

function linkedOf(rec) { return SERVICES.filter((n) => isObj(own(rec.services, n)) && own(rec.services, n).ct); }

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

async function idb(store, mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error || new Error('idb'));
      tx.onabort = () => reject(tx.error || new Error('idb'));
    });
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
      hold();
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
  hold();
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
    const openedAt = Date.now();
    await idbPut('session', 'current', { epoch, openedAt, kcv: rec.kcv, root });
    mem.root = root;
    mem.bytes = silent ? null : new Uint8Array(bytes);
    mem.kcv = rec.kcv;
    mem.epoch = epoch;
    if (sessionLive() && !(silent && manuallyLocked())) {
      if (!silent) clearManualLock(epoch);
      return true;
    }
    drop();
    try { await idbDelIf('session', 'current', (row) => isObj(row) && row.epoch === epoch && row.openedAt === openedAt); } catch (_) {}
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
  if (!S || S.set(NS, KEY, record) !== true) throw new Error('storage');
  if (!bootP) {
    bootP = Promise.resolve();
    start();
  }
  post('record');
  try {
    await openSession(rootBytes, record);
  } catch (e) {
    const now = readRecord();
    if (now && now.kcv !== record.kcv) throw new Error('exists');
    if (now && e && e.message === 'locked') {
      mem.code = text;
      mem.codeSalt = record.wraps.recovery.salt;
      return { code: text };
    }
    try { S.remove(NS, KEY, { remote: true }); } catch (_) {}
    post('record');
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
  saveLocal({ manualLock: bumpEpoch() });
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
  return openService(mem.root, name, entry);
}

export async function link(name, bytes) {
  const rec = enabled() ? readRecord() : null;
  if (!rec || !sessionLive()) throw new Error('locked');
  if (!SERVICES.includes(name)) throw new Error('bad-service');
  const entry = await sealService(mem.root, name, bytes);
  const fresh = readRecord();
  if (!fresh || fresh.kcv !== mem.kcv) throw new Error('locked');
  fresh.services = Object.assign({}, fresh.services, { [name]: entry });
  fresh.changed = entry.linked;
  await writeRecord(fresh);
  notify(true);
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

export async function setRemember(on) {
  const rec = need();
  if (!on) {
    try { await idbDel('keys', 'device'); } catch (_) {}
    mem.hasDevice = false;
    post('record');
    notify(false);
    return;
  }
  if (!hasRootBytes()) throw new Error('confirm-needed');
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const box = await wrapWithDeviceKey(mem.bytes, key);
  await idbPut('keys', 'device', { kcv: rec.kcv, key, box });
  mem.hasDevice = true;
  post('record');
  notify(false);
}

export async function regenerateCode() {
  const rec = need();
  if (!hasRootBytes()) throw new Error('confirm-needed');
  const text = newRecoveryCode();
  const wrap = await wrapWithCode(mem.bytes, text);
  const backup = await makeBackupEntry(mem.root, text);
  const fresh = sameKeyring(rec);
  fresh.wraps.recovery = wrap;
  fresh.backup = backup;
  fresh.codeConfirmed = null;
  fresh.changed = wrap.created;
  await writeRecord(fresh);
  mem.code = text;
  mem.codeSalt = wrap.salt;
  notify(true);
  return text;
}

export function confirmCode(last4) {
  if (!mem.code) return false;
  const want = mem.code.replace(/-/g, '').slice(-4).toUpperCase();
  const got = String(last4 == null ? '' : last4).replace(/[\s-]/g, '').toUpperCase();
  if (got.length !== 4 || got !== want) return false;
  const S = window.MentriaStore;
  const rec = readRecord();
  if (!S || !rec || rec.wraps.recovery.salt !== mem.codeSalt) return false;
  const at = iso();
  rec.codeConfirmed = at;
  rec.changed = at;
  if (S.set(NS, KEY, rec) !== true) return false;
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
