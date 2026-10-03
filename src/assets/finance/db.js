const NAME = 'mentria-ext-finance';
const VERSION = 1;
let dbp = null;

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });
}

export function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const r = indexedDB.open(NAME, VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('pages')) {
        const s = db.createObjectStore('pages', { keyPath: 'id' });
        s.createIndex('by_dev', ['device', 'seq'], { unique: false });
      }
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      if (!db.objectStoreNames.contains('inbox')) db.createObjectStore('inbox', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('feeds')) db.createObjectStore('feeds');
    };
    r.onsuccess = () => {
      const db = r.result;
      db.onversionchange = () => { db.close(); dbp = null; };
      resolve(db);
    };
    r.onerror = () => { dbp = null; reject(r.error); };
    r.onblocked = () => reject(new Error('database blocked by another tab'));
  });
  return dbp;
}

function tx(db, stores, mode) {
  try { return db.transaction(stores, mode, mode === 'readwrite' ? { durability: 'strict' } : undefined); }
  catch (_) { return db.transaction(stores, mode); }
}

export async function getMeta(key) {
  const db = await open();
  return req(tx(db, ['meta'], 'readonly').objectStore('meta').get(key));
}

export async function getMetaMany(keys) {
  const db = await open();
  const store = tx(db, ['meta'], 'readonly').objectStore('meta');
  const vals = await Promise.all(keys.map((k) => req(store.get(k))));
  const out = {};
  keys.forEach((k, i) => { out[k] = vals[i]; });
  return out;
}

export async function setMeta(entries) {
  const db = await open();
  const t = tx(db, ['meta'], 'readwrite');
  const s = t.objectStore('meta');
  for (const k of Object.keys(entries)) {
    if (entries[k] === undefined) s.delete(k);
    else s.put(entries[k], k);
  }
  return done(t);
}

export async function writePage(page, meta) {
  const db = await open();
  const t = tx(db, ['pages', 'meta'], 'readwrite');
  t.objectStore('pages').put(page);
  if (meta) for (const k of Object.keys(meta)) t.objectStore('meta').put(meta[k], k);
  return done(t);
}

export async function putPages(pages) {
  if (!pages.length) return;
  const db = await open();
  const t = tx(db, ['pages'], 'readwrite');
  const s = t.objectStore('pages');
  for (const p of pages) s.put(p);
  return done(t);
}

export async function hasPage(id) {
  const db = await open();
  const n = await req(tx(db, ['pages'], 'readonly').objectStore('pages').count(id));
  return n > 0;
}

export async function getPage(id) {
  const db = await open();
  return req(tx(db, ['pages'], 'readonly').objectStore('pages').get(id));
}

export async function allPages() {
  const db = await open();
  return req(tx(db, ['pages'], 'readonly').objectStore('pages').getAll());
}

export async function pageHeads() {
  const pages = await allPages();
  return pages.map((p) => ({ id: p.id, kind: p.kind, device: p.device, seq: p.seq, created: p.created, n: p.n, bytes: p.bytes, covers: p.covers || null }));
}

export async function deletePages(ids) {
  if (!ids.length) return;
  const db = await open();
  const t = tx(db, ['pages'], 'readwrite');
  const s = t.objectStore('pages');
  for (const id of ids) s.delete(id);
  return done(t);
}

export async function addInbox(entry) {
  const db = await open();
  const t = tx(db, ['inbox'], 'readwrite');
  t.objectStore('inbox').put(entry);
  return done(t);
}

export async function allInbox() {
  const db = await open();
  return req(tx(db, ['inbox'], 'readonly').objectStore('inbox').getAll());
}

export async function clearInbox(ids) {
  if (!ids.length) return;
  const db = await open();
  const t = tx(db, ['inbox'], 'readwrite');
  for (const id of ids) t.objectStore('inbox').delete(id);
  return done(t);
}

export async function getFeed(name) {
  const db = await open();
  return req(tx(db, ['feeds'], 'readonly').objectStore('feeds').get(name));
}

export async function setFeed(name, value) {
  const db = await open();
  const t = tx(db, ['feeds'], 'readwrite');
  t.objectStore('feeds').put(value, name);
  return done(t);
}

export async function wipe() {
  const db = await open();
  const t = tx(db, ['pages', 'meta', 'inbox', 'feeds'], 'readwrite');
  for (const s of ['pages', 'meta', 'inbox', 'feeds']) t.objectStore(s).clear();
  return done(t);
}

export async function estimate() {
  try {
    const e = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null;
    const persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false;
    return { usage: e ? e.usage : 0, quota: e ? e.quota : 0, persisted };
  } catch (_) { return { usage: 0, quota: 0, persisted: false }; }
}

export async function requestPersist() {
  try {
    const st = navigator.storage;
    if (!st || !st.persist) return false;
    if (st.persisted && await st.persisted()) return true;
    return await st.persist();
  } catch (_) { return false; }
}
