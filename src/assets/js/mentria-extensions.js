const NS = 'ext';
const DATA_NS_PREFIX = 'extdata.';
const KNOWN_PERMISSIONS = ['storage', 'ai', 'bluetooth', 'usb', 'serial', 'network', 'notifications', 'share', 'camera', 'microphone'];
const RESERVED_IDS = ['extensions', 'run', 'tools', 'feed', 'search', 'about', 'comms'];
const WARN_BYTES = 512 * 1024;
const REJECT_BYTES = 1536 * 1024;
const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const VERSION_RE = /^\d+\.\d+\.\d+$/;
const CMD_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DB_NAME = 'mentria-ext-db';
const DB_STORE = 'kv';
const FILES_CACHE = 'mentria-ext-files';
const FILES_KEY = 'files.';

function codedError(code, message, vars) {
  const err = new Error(message);
  err.code = code;
  if (vars) err.vars = vars;
  return err;
}

function store() {
  if (!window.MentriaStore) throw codedError('store-unavailable', 'MentriaStore unavailable');
  return window.MentriaStore;
}

function storageError() {
  let blocked = false;
  try { blocked = store().status() === 'blocked'; } catch (_) {}
  return blocked
    ? codedError('storage-blocked', 'storage blocked — allow site data for this site')
    : codedError('storage-full', 'storage full — remove an extension or free space');
}

export function parseManifest(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const el = doc.querySelector('script#mentria-ext[type="application/json"]');
  if (!el) throw codedError('no-manifest', 'no manifest block found (script#mentria-ext)');
  let m;
  try { m = JSON.parse(el.textContent); } catch (e) { throw codedError('bad-json', 'manifest is not valid JSON'); }
  return m;
}

export function validateManifest(m, sizeBytes) {
  const fail = (code, msg, vars) => { throw codedError(code, msg, vars); };
  if (!m || typeof m !== 'object' || Array.isArray(m)) fail('bad-manifest', 'manifest must be a JSON object');
  if (typeof m.id !== 'string' || !ID_RE.test(m.id) || m.id.length < 3 || m.id.length > 48) fail('bad-id', 'id must be kebab-case, 3-48 chars');
  if (RESERVED_IDS.includes(m.id)) fail('reserved-id', 'id "' + m.id + '" is reserved', { id: m.id });
  if (typeof m.name !== 'string' || !m.name.trim() || m.name.length > 40) fail('bad-name', 'name is required (max 40 chars)');
  if (typeof m.version !== 'string' || !VERSION_RE.test(m.version)) fail('bad-version', 'version must be major.minor.patch');
  if (m.icon !== undefined) {
    const okEmoji = typeof m.icon === 'string' && m.icon.length <= 8 && !/^data:/.test(m.icon);
    const okData = typeof m.icon === 'string' && /^data:image\//.test(m.icon) && m.icon.length <= 8192;
    if (!okEmoji && !okData) fail('bad-manifest', 'icon must be an emoji or a data:image/ URI up to 8 KB', { field: 'icon' });
  }
  for (const k of ['author', 'description']) {
    if (m[k] !== undefined && (typeof m[k] !== 'string' || m[k].length > 200)) fail('bad-manifest', k + ' must be a string up to 200 chars', { field: k });
  }
  if (m.permissions !== undefined) {
    if (!Array.isArray(m.permissions) || m.permissions.some((p) => typeof p !== 'string' || p.length > 32)) fail('bad-manifest', 'permissions must be an array of short strings', { field: 'permissions' });
    if (m.permissions.length > 16) fail('bad-manifest', 'too many permissions', { field: 'permissions' });
  }
  if (m.mounts !== undefined) {
    if (!m.mounts || typeof m.mounts !== 'object' || Array.isArray(m.mounts)) fail('bad-manifest', 'mounts must be an object', { field: 'mounts' });
    if (m.mounts.commands !== undefined) {
      if (!Array.isArray(m.mounts.commands)) fail('bad-manifest', 'mounts.commands must be an array', { field: 'mounts.commands' });
      for (const c of m.mounts.commands) {
        if (!c || typeof c.name !== 'string' || !CMD_RE.test(c.name) || c.name.length < 2 || c.name.length > 16) fail('bad-manifest', 'command names must be kebab-case, 2-16 chars', { field: 'mounts.commands' });
        if (typeof c.description !== 'string' || !c.description) fail('bad-manifest', 'each command needs a description', { field: 'mounts.commands' });
      }
    }
    if (m.mounts.widget !== undefined) {
      const w = m.mounts.widget;
      if (!w || typeof w !== 'object' || Array.isArray(w)) fail('bad-manifest', 'mounts.widget must be an object', { field: 'mounts.widget' });
      if (typeof w.key !== 'string' || w.key.length < 1 || w.key.length > 64) fail('bad-manifest', 'mounts.widget.key must be a string, 1-64 chars', { field: 'mounts.widget' });
      if (typeof w.label !== 'string' || w.label.length < 1 || w.label.length > 48) fail('bad-manifest', 'mounts.widget.label must be a string, 1-48 chars', { field: 'mounts.widget' });
    }
  }
  if (m.app !== undefined && m.app !== '/extensions/' + m.id + '/app/') fail('bad-manifest', 'app must be /extensions/' + m.id + '/app/', { field: 'app' });
  if (sizeBytes > REJECT_BYTES) {
    const kb = Math.round(sizeBytes / 1024);
    fail('too-large', 'file is ' + kb + ' KB — extensions are stored in local storage, keep them under 1536 KB', { kb });
  }
  return true;
}

export function getRegistry() {
  return store().get(NS, 'registry') || [];
}

export function getEntry(id) {
  return getRegistry().find((e) => e.manifest.id === id) || null;
}

export function getSource(id) {
  return store().get(NS, 'src.' + id);
}

function mountSummary(m) {
  const mounts = (m && m.mounts) || {};
  const out = [];
  if (mounts.tool) out.push('tool');
  if (Array.isArray(mounts.commands) && mounts.commands.length) out.push('commands');
  if (mounts.widget) out.push('widget');
  return out;
}

export function inspect(html) {
  const size = new Blob([html]).size;
  const manifest = parseManifest(html);
  validateManifest(manifest, size);
  if (manifest.app) throw codedError('app-only', 'app extensions install from their page in the extension store');
  return { manifest, size, warnLarge: size > WARN_BYTES, existing: getEntry(manifest.id), mounts: mountSummary(manifest) };
}

export function install(html, manifest) {
  const size = new Blob([html]).size;
  validateManifest(manifest, size);
  const prevSource = store().get(NS, 'src.' + manifest.id);
  const ok = store().set(NS, 'src.' + manifest.id, html);
  if (!ok) throw storageError();
  const prev = getEntry(manifest.id);
  const registry = getRegistry().filter((e) => e.manifest.id !== manifest.id);
  const entry = {
    manifest,
    enabled: prev ? prev.enabled : true,
    installedAt: prev ? prev.installedAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    size
  };
  registry.push(entry);
  if (!store().set(NS, 'registry', registry)) {
    const err = storageError();
    if (prevSource != null) store().set(NS, 'src.' + manifest.id, prevSource);
    else store().remove(NS, 'src.' + manifest.id);
    throw err;
  }
  return entry;
}

export function isApp(entry) {
  const m = entry && (entry.manifest || entry);
  return !!(m && m.app);
}

export function installApp(manifest) {
  validateManifest(manifest, 0);
  if (!manifest.app) throw codedError('not-app', 'not an app extension');
  const prev = getEntry(manifest.id);
  const registry = getRegistry().filter((e) => e.manifest.id !== manifest.id);
  const entry = {
    manifest,
    enabled: prev ? prev.enabled : true,
    installedAt: prev ? prev.installedAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    size: 0
  };
  registry.push(entry);
  if (!store().set(NS, 'registry', registry)) throw storageError();
  return entry;
}

export async function fetchPackage(id) {
  const res = await fetch('/extensions/' + encodeURIComponent(id) + '/files.json', { cache: 'no-store' });
  if (!res.ok) throw codedError('package-unavailable', 'package unavailable (' + res.status + ')', { status: res.status });
  return res.json();
}

function ownedFiles(id) {
  return store().get(NS, FILES_KEY + id) || null;
}

export function offlineReady(id) {
  const owned = ownedFiles(id);
  return !!(owned && owned.complete);
}

function usedElsewhere(id) {
  const used = new Set();
  for (const e of getRegistry()) {
    if (e.manifest.id === id) continue;
    const owned = ownedFiles(e.manifest.id);
    if (owned && Array.isArray(owned.list)) for (const f of owned.list) used.add(f.u);
  }
  return used;
}

async function prune(id, urls, keep) {
  if (typeof caches === 'undefined') return;
  const cache = await caches.open(FILES_CACHE);
  const used = usedElsewhere(id);
  for (const u of urls) {
    if (keep.has(u) || used.has(u)) continue;
    try { await cache.delete(u); } catch (_) {}
  }
}

export async function downloadFiles(id, files, extra, onProgress) {
  if (typeof caches === 'undefined') throw codedError('no-offline-storage', 'offline storage unavailable in this browser');
  const cache = await caches.open(FILES_CACHE);
  const list = (files || []).map((f) => ({ u: f.u, b: f.b || 0, h: f.h || '' }));
  for (const u of extra || []) if (!list.some((f) => f.u === u)) list.push({ u, b: 0, h: '' });
  const prev = ownedFiles(id);
  const prevHash = new Map(((prev && prev.list) || []).map((f) => [f.u, f.h]));
  const weight = (f) => f.b || 24000;
  const total = list.reduce((n, f) => n + weight(f), 0) || 1;
  let done = 0;
  let failed = null;
  const fetched = [];
  const queue = list.slice();
  const report = () => { if (onProgress) { try { onProgress(Math.min(1, done / total)); } catch (_) {} } };
  async function worker() {
    while (queue.length && !failed) {
      const f = queue.shift();
      try {
        const fresh = f.h && prevHash.get(f.u) === f.h && await cache.match(f.u);
        if (!fresh) {
          const resp = await fetch(f.u, { cache: 'no-cache' });
          if (!resp.ok) throw codedError('download-failed', f.u + ' (' + resp.status + ')', { url: f.u, status: resp.status });
          const body = await resp.arrayBuffer();
          await cache.put(f.u, new Response(body, { status: resp.status, statusText: resp.statusText, headers: { 'content-type': resp.headers.get('content-type') || 'application/octet-stream' } }));
          fetched.push(f.u);
        }
      } catch (e) {
        failed = e;
        break;
      }
      done += weight(f);
      report();
    }
  }
  report();
  await Promise.all([worker(), worker(), worker(), worker()]);
  const dropFetched = async () => {
    try { await prune(id, fetched, new Set(((prev && prev.list) || []).map((f) => f.u))); } catch (_) {}
  };
  if (failed) {
    await dropFetched();
    throw failed;
  }
  if (!store().set(NS, FILES_KEY + id, { complete: true, at: new Date().toISOString(), list: list.map((f) => ({ u: f.u, h: f.h })) })) {
    const err = storageError();
    await dropFetched();
    throw err;
  }
  if (prev && Array.isArray(prev.list)) await prune(id, prev.list.map((f) => f.u), new Set(list.map((f) => f.u)));
  return list.length;
}

export function appPages(app) {
  const locales = (typeof window !== 'undefined' && Array.isArray(window.MENTRIA_LOCALES)) ? window.MENTRIA_LOCALES : [];
  const prefixes = locales.map((l) => (l && typeof l.prefix === 'string' ? l.prefix : '')).concat(['']);
  return Array.from(new Set(prefixes.map((p) => p + app)));
}

export async function ensureAppPages(id) {
  const entry = getEntry(id);
  const owned = ownedFiles(id);
  if (!entry || !isApp(entry) || !owned || !owned.complete || !Array.isArray(owned.list) || typeof caches === 'undefined') return false;
  const have = new Set(owned.list.map((f) => f.u));
  if (appPages(entry.manifest.app).every((u) => have.has(u))) return false;
  const pkg = await fetchPackage(id);
  const now = getEntry(id);
  if (!now || pkg.kind !== 'app') return false;
  if (pkg.manifest && pkg.manifest.version !== now.manifest.version) installApp(pkg.manifest);
  const files = new Set((pkg.files || []).map((f) => f.u));
  const extra = owned.list.map((f) => f.u).filter((u) => !files.has(u)).concat(appPages(pkg.app));
  await downloadFiles(id, pkg.files, extra);
  if (!getEntry(id)) await removeFiles(id);
  return true;
}

export async function removeFiles(id) {
  const owned = ownedFiles(id);
  store().remove(NS, FILES_KEY + id);
  if (owned && Array.isArray(owned.list)) await prune(id, owned.list.map((f) => f.u), new Set());
}

export function setEnabled(id, enabled) {
  const registry = getRegistry();
  const entry = registry.find((e) => e.manifest.id === id);
  if (!entry) return false;
  entry.enabled = !!enabled;
  return store().set(NS, 'registry', registry);
}

export function clearData(id) {
  store().clear(DATA_NS_PREFIX + id);
  clearDb(id);
  if (id !== 'db' && id !== 'files') { try { indexedDB.deleteDatabase('mentria-ext-' + id); } catch (_) {} }
}

export function remove(id, opts) {
  if (!getEntry(id)) return false;
  const srcOk = getSource(id) == null ? true : store().remove(NS, 'src.' + id);
  removeFiles(id).catch(() => {});
  if (!(opts && opts.keepData)) clearData(id);
  const registry = getRegistry().filter((e) => e.manifest.id !== id);
  const regOk = registry.length
    ? store().set(NS, 'registry', registry)
    : store().remove(NS, 'registry');
  return srcOk && regOk;
}

export function compareVersions(a, b) {
  if (!VERSION_RE.test(a) || !VERSION_RE.test(b)) throw codedError('bad-version', 'invalid version');
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) { if (pa[i] !== pb[i]) return pa[i] - pb[i]; }
  return 0;
}

export function dataApiFor(id) {
  const ns = DATA_NS_PREFIX + id;
  return {
    get: (key) => store().get(ns, key),
    set: (key, value) => store().set(ns, key, value),
    remove: (key) => store().remove(ns, key),
    list: () => store().list(ns)
  };
}

let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(codedError('no-indexeddb', 'IndexedDB unavailable')); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(DB_STORE)) req.result.createObjectStore(DB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbPromise.catch(() => { dbPromise = null; });
  }
  return dbPromise;
}

function dbRun(mode, run) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, mode);
    const req = run(tx.objectStore(DB_STORE));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

function idRange(id) {
  return IDBKeyRange.bound(id + '/', id + '/\uffff');
}

export function clearDb(id) {
  return dbRun('readwrite', (s) => s.delete(idRange(id))).then(() => true, () => false);
}

function hasBlob(v, seen = new Set()) {
  if (v instanceof Blob) return true;
  if (!v || typeof v !== 'object' || seen.has(v)) return false;
  seen.add(v);
  if (v instanceof Map) {
    for (const [k, x] of v) if (hasBlob(k, seen) || hasBlob(x, seen)) return true;
    return false;
  }
  if (v instanceof Set) {
    for (const x of v) if (hasBlob(x, seen)) return true;
    return false;
  }
  if (Array.isArray(v) || Object.getPrototypeOf(v) === Object.prototype) {
    for (const k of Object.keys(v)) if (hasBlob(v[k], seen)) return true;
  }
  return false;
}

async function freshBlobs(v, seen = new Map()) {
  if (!v || typeof v !== 'object') return v;
  if (seen.has(v)) return seen.get(v);
  if (v instanceof Blob) {
    const buf = await v.arrayBuffer();
    const out = v instanceof File ? new File([buf], v.name, { type: v.type, lastModified: v.lastModified }) : new Blob([buf], { type: v.type });
    seen.set(v, out);
    return out;
  }
  if (v instanceof Map) {
    const out = new Map();
    seen.set(v, out);
    for (const [k, x] of v) out.set(await freshBlobs(k, seen), await freshBlobs(x, seen));
    return out;
  }
  if (v instanceof Set) {
    const out = new Set();
    seen.set(v, out);
    for (const x of v) out.add(await freshBlobs(x, seen));
    return out;
  }
  if (Array.isArray(v)) {
    const out = [];
    seen.set(v, out);
    for (const x of v) out.push(await freshBlobs(x, seen));
    return out;
  }
  if (Object.getPrototypeOf(v) === Object.prototype) {
    const out = {};
    seen.set(v, out);
    for (const k of Object.keys(v)) out[k] = await freshBlobs(v[k], seen);
    return out;
  }
  return v;
}

function adoptBlobs(v, seen, done = new Set()) {
  if (!v || typeof v !== 'object' || v instanceof Blob || done.has(v)) return;
  done.add(v);
  const swap = (x) => (x instanceof Blob && seen.has(x) ? seen.get(x) : x);
  try {
    if (v instanceof Map) {
      for (const [k, x] of [...v]) {
        if (x instanceof Blob) v.set(k, swap(x));
        else adoptBlobs(x, seen, done);
      }
    } else if (v instanceof Set) {
      const items = [...v];
      if (items.some((x) => x instanceof Blob)) {
        v.clear();
        for (const x of items) v.add(swap(x));
      }
      for (const x of items) adoptBlobs(x, seen, done);
    } else if (Array.isArray(v) || Object.getPrototypeOf(v) === Object.prototype) {
      for (const k of Object.keys(v)) {
        const x = v[k];
        if (x instanceof Blob) v[k] = swap(x);
        else adoptBlobs(x, seen, done);
      }
    }
  } catch (_) {}
}

async function storable(value) {
  if (!hasBlob(value)) return value;
  const seen = new Map();
  const copy = await freshBlobs(value, seen);
  adoptBlobs(value, seen);
  return copy;
}

export function dbApiFor(id) {
  const full = (key) => id + '/' + String(key);
  const cut = id.length + 1;
  return Object.freeze({
    get: (key) => dbRun('readonly', (s) => s.get(full(key))).then((v) => (v === undefined ? null : v)),
    set: (key, value) => storable(value).then((v) => dbRun('readwrite', (s) => s.put(v, full(key)))).then(() => true, () => false),
    remove: (key) => dbRun('readwrite', (s) => s.delete(full(key))).then(() => true, () => false),
    keys: () => dbRun('readonly', (s) => s.getAllKeys(idRange(id))).then((list) => (list || []).map((k) => String(k).slice(cut))),
    clear: () => clearDb(id)
  });
}

export { KNOWN_PERMISSIONS, WARN_BYTES, REJECT_BYTES, FILES_CACHE };
