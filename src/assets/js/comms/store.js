export const DB_NAME = 'mentria-comms';
const DB_VERSION = 2;
const SALT = 'mentria-comms-store-v1';
const PREVIEW_LEN = 120;
const PAGE = 200;
const te = new TextEncoder();
const td = new TextDecoder();

const failure = (code, cause) => Object.assign(new Error(code), { code, cause });
const mapError = (e) => (e && typeof e.code === 'string' ? e : failure(e && e.name === 'QuotaExceededError' ? 'quota' : 'unavailable', e));

const request = (r) => new Promise((ok, no) => { r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });

const openDb = () => new Promise((resolve, reject) => {
  let r;
  try { r = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { reject(failure('unavailable', e)); return; }
  r.onupgradeneeded = () => {
    const db = r.result;
    if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'k' });
    if (!db.objectStoreNames.contains('threads')) db.createObjectStore('threads', { keyPath: 'id' }).createIndex('updatedAt', 'updatedAt');
    if (!db.objectStoreNames.contains('messages')) db.createObjectStore('messages', { keyPath: 'id' }).createIndex('thread_ts', ['threadId', 'ts']);
    if (!db.objectStoreNames.contains('thumbs')) db.createObjectStore('thumbs', { keyPath: 'hash' }).createIndex('threadId', 'threadId');
    if (!db.objectStoreNames.contains('media')) db.createObjectStore('media', { keyPath: 'id' }).createIndex('threadId', 'threadId');
    if (!db.objectStoreNames.contains('pieces')) db.createObjectStore('pieces', { keyPath: ['id', 'i'] });
  };
  r.onsuccess = () => {
    const db = r.result;
    db.onversionchange = () => db.close();
    resolve(db);
  };
  r.onerror = () => reject(failure('unavailable', r.error));
});

export const storeAvailable = async () => {
  try {
    (await openDb()).close();
    return true;
  } catch (_) {
    return false;
  }
};

const deriveWrap = async (secret) => {
  const base = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: te.encode(SALT), info: te.encode('wrap') }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
};

const seal = async (key, bytes, ad) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(ad) }, key, bytes));
  return { iv, ct };
};

const unseal = async (key, enc, ad) => new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: enc.iv, additionalData: te.encode(ad) }, key, enc.ct));

const sealJson = (key, value, ad) => seal(key, te.encode(JSON.stringify(value)), ad);
const unsealJson = async (key, enc, ad) => JSON.parse(td.decode(await unseal(key, enc, ad)));

const newWrappedKey = async (wrap) => {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  try {
    const sealed = await seal(wrap, raw, 'meta|storeKey');
    const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
    return { record: { k: 'storeKey', v: 1, iv: sealed.iv, ct: sealed.ct }, key };
  } finally {
    raw.fill(0);
  }
};

const unwrapKey = async (wrap, record) => {
  const raw = await unseal(wrap, record, 'meta|storeKey');
  try {
    return await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  } finally {
    raw.fill(0);
  }
};

class Store {
  constructor(db, wrap) {
    this._db = db;
    this._wrap = wrap;
    this._key = null;
    this._queue = Promise.resolve();
    this.status = 'foreign';
    this.skipped = 0;
  }

  _usable() {
    if (this.status === 'foreign') throw failure('foreign');
  }

  _write(fn) {
    const run = this._queue.then(() => { this._usable(); return fn(); });
    this._queue = run.catch(() => {});
    return run;
  }

  _get(store, key) {
    try { return request(this._db.transaction(store).objectStore(store).get(key)).catch((e) => { throw mapError(e); }); } catch (e) { return Promise.reject(mapError(e)); }
  }

  _commit(work, stores) {
    return new Promise((resolve, reject) => {
      let tx = null;
      try {
        tx = this._db.transaction(stores, 'readwrite');
        work(tx);
      } catch (e) {
        try { if (tx) tx.abort(); } catch (_) {}
        reject(mapError(e));
        return;
      }
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(mapError(tx.error));
    });
  }

  async _init() {
    const fresh = await newWrappedKey(this._wrap);
    await this._commit((tx) => {
      const st = tx.objectStore('meta');
      const got = st.get('storeKey');
      got.onsuccess = () => { if (!got.result) st.put(fresh.record); };
    }, ['meta']);
    const record = await this._get('meta', 'storeKey');
    try {
      this._key = await unwrapKey(this._wrap, record);
      this.status = 'open';
    } catch (_) {
      this._key = null;
      this.status = 'foreign';
    }
    return this;
  }

  async _openThread(rec) {
    const rest = await unsealJson(this._key, rec.enc, 'threads|' + rec.id);
    return { ...rest, id: rec.id, kind: rec.kind, updatedAt: rec.updatedAt, lastReadTs: rec.lastReadTs, pinned: rec.pinned, preview: typeof rest.preview === 'string' ? rest.preview : '' };
  }

  async _sealThread(t) {
    const { id, kind, updatedAt, lastReadTs, pinned, ...rest } = t;
    return { id, kind, updatedAt: Number(updatedAt) || 0, lastReadTs: Number(lastReadTs) || 0, pinned: !!pinned, enc: await sealJson(this._key, rest, 'threads|' + id) };
  }

  async _openMessage(rec) {
    const rest = await unsealJson(this._key, rec.enc, 'messages|' + rec.id);
    return { ...rest, id: rec.id, threadId: rec.threadId, ts: rec.ts };
  }

  putThread(t) {
    return this._write(async () => {
      const prev = await this._get('threads', t.id);
      let old = null;
      if (prev) {
        try { old = await this._openThread(prev); } catch (_) { this.skipped++; }
      }
      const next = { ...t };
      if (old) {
        next.updatedAt = Math.max(Number(old.updatedAt) || 0, Number(t.updatedAt) || 0);
        if (typeof t.preview !== 'string') next.preview = old.preview;
      }
      const rec = await this._sealThread(next);
      await this._commit((tx) => { tx.objectStore('threads').put(rec); }, ['threads']);
    });
  }

  async getMessage(id) {
    this._usable();
    const rec = await this._get('messages', id);
    if (!rec) return null;
    try { return await this._openMessage(rec); } catch (_) { this.skipped++; return null; }
  }

  async getThread(id) {
    this._usable();
    const rec = await this._get('threads', id);
    if (!rec) return null;
    try { return await this._openThread(rec); } catch (_) { this.skipped++; return null; }
  }

  async listThreads({ kinds } = {}) {
    this._usable();
    let recs;
    try { recs = await request(this._db.transaction('threads').objectStore('threads').index('updatedAt').getAll()); } catch (e) { throw mapError(e); }
    const out = [];
    for (let i = recs.length - 1; i >= 0; i--) {
      const rec = recs[i];
      if (kinds && !kinds.includes(rec.kind)) continue;
      try { out.push(await this._openThread(rec)); } catch (_) { this.skipped++; }
    }
    return out;
  }

  putMessage(m, opts = {}) {
    return this._write(async () => {
      const { id, threadId, ts, ...rest } = m;
      const when = Number(ts) || 0;
      if ((await this._get('messages', id)) && !opts.replace) return false;
      const rec = { id, threadId, ts: when, enc: await sealJson(this._key, rest, 'messages|' + id) };
      let threadRec = null;
      const prev = await this._get('threads', threadId);
      if (prev && (!prev.updatedAt || when > prev.updatedAt || (opts.replace && when >= prev.updatedAt))) {
        try {
          const t = await this._openThread(prev);
          t.preview = String(m.t || '').slice(0, PREVIEW_LEN);
          t.updatedAt = when;
          threadRec = await this._sealThread(t);
        } catch (_) { this.skipped++; }
      }
      await this._commit((tx) => {
        tx.objectStore('messages').put(rec);
        if (threadRec) tx.objectStore('threads').put(threadRec);
      }, threadRec ? ['messages', 'threads'] : ['messages']);
      return true;
    });
  }

  _page(threadId, upper, open, count, seen) {
    return new Promise((resolve, reject) => {
      const out = [];
      try {
        const range = IDBKeyRange.bound([threadId, -Infinity], [threadId, upper], false, open);
        const cur = this._db.transaction('messages').objectStore('messages').index('thread_ts').openCursor(range, 'prev');
        cur.onsuccess = () => {
          const c = cur.result;
          if (!c || out.length >= count) { resolve(out); return; }
          if (!seen.has(c.value.id)) out.push(c.value);
          c.continue();
        };
        cur.onerror = () => reject(mapError(cur.error));
      } catch (e) {
        reject(mapError(e));
      }
    });
  }

  async listMessages(threadId, { before, limit = PAGE } = {}) {
    this._usable();
    const out = [];
    const seen = new Set();
    let upper = before == null ? Infinity : Number(before);
    let open = before != null;
    while (out.length < limit) {
      const want = limit - out.length;
      const raw = await this._page(threadId, upper, open, want, seen);
      for (const rec of raw) {
        seen.add(rec.id);
        try { out.push(await this._openMessage(rec)); } catch (_) { this.skipped++; }
      }
      if (raw.length < want) break;
      upper = raw[raw.length - 1].ts;
      open = false;
    }
    return out.sort((a, b) => (a.ts - b.ts) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  deleteThread(id) {
    return this._write(async () => {
      const gone = [];
      await this._commit((tx) => {
        tx.objectStore('threads').delete(id);
        const m = tx.objectStore('messages').index('thread_ts').openCursor(IDBKeyRange.bound([id, -Infinity], [id, Infinity]));
        m.onsuccess = () => { const c = m.result; if (c) { c.delete(); c.continue(); } };
        const t = tx.objectStore('thumbs').index('threadId').openCursor(IDBKeyRange.only(id));
        t.onsuccess = () => { const c = t.result; if (c) { c.delete(); c.continue(); } };
        const pieces = tx.objectStore('pieces');
        const md = tx.objectStore('media').index('threadId').openCursor(IDBKeyRange.only(id));
        md.onsuccess = () => {
          const c = md.result;
          if (!c) return;
          gone.push(c.value.id);
          pieces.delete(IDBKeyRange.bound([c.value.id, -Infinity], [c.value.id, Infinity]));
          c.delete();
          c.continue();
        };
      }, ['threads', 'messages', 'thumbs', 'media', 'pieces']);
      return gone;
    });
  }

  get key() {
    return this._key;
  }

  async _openMedia(rec) {
    const rest = await unsealJson(this._key, rec.enc, 'media|' + rec.id);
    return { ...rest, id: rec.id, threadId: rec.threadId, role: rec.role, state: rec.state, complete: !!rec.complete, updatedAt: rec.updatedAt };
  }

  putMedia(m) {
    return this._write(async () => {
      const { id, threadId, role, state, complete, updatedAt, ...rest } = m;
      const rec = { id, threadId, role, state, complete: !!complete, updatedAt: Number(updatedAt) || Date.now(), enc: await sealJson(this._key, rest, 'media|' + id) };
      await this._commit((tx) => { tx.objectStore('media').put(rec); }, ['media']);
    });
  }

  async getMedia(id) {
    this._usable();
    const rec = await this._get('media', id);
    if (!rec) return null;
    try { return await this._openMedia(rec); } catch (_) { this.skipped++; return null; }
  }

  async mediaIds() {
    this._usable();
    try { return await request(this._db.transaction('media').objectStore('media').getAllKeys()); } catch (e) { throw mapError(e); }
  }

  async listMedia({ threadId, states } = {}) {
    this._usable();
    let recs;
    try {
      const st = this._db.transaction('media').objectStore('media');
      recs = await request(threadId == null ? st.getAll() : st.index('threadId').getAll(IDBKeyRange.only(threadId)));
    } catch (e) { throw mapError(e); }
    const out = [];
    for (const rec of recs) {
      if (states && !states.includes(rec.state)) continue;
      try { out.push(await this._openMedia(rec)); } catch (_) { this.skipped++; }
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  deleteMedia(ids) {
    return this._write(() => this._commit((tx) => {
      const media = tx.objectStore('media');
      const pieces = tx.objectStore('pieces');
      for (const id of ids || []) {
        media.delete(id);
        pieces.delete(IDBKeyRange.bound([id, -Infinity], [id, Infinity]));
      }
    }, ['media', 'pieces']));
  }

  deletePieces(ids) {
    return this._write(() => this._commit((tx) => {
      const pieces = tx.objectStore('pieces');
      for (const id of ids || []) pieces.delete(IDBKeyRange.bound([id, -Infinity], [id, Infinity]));
    }, ['pieces']));
  }

  putPiece(id, i, slot) {
    return this._write(() => this._commit((tx) => {
      const st = tx.objectStore('pieces');
      const got = st.getKey([id, i]);
      got.onsuccess = () => { if (got.result === undefined) st.put({ id, i, slot }); };
    }, ['pieces']));
  }

  async getPiece(id, i) {
    this._usable();
    const rec = await this._get('pieces', [id, i]);
    return rec ? rec.slot : null;
  }

  putThumb(hash, threadId, blob) {
    return this._write(async () => {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const type = te.encode(String(blob.type || '').slice(0, 200));
      const plain = new Uint8Array(2 + type.length + bytes.length);
      plain[0] = type.length >> 8;
      plain[1] = type.length & 255;
      plain.set(type, 2);
      plain.set(bytes, 2 + type.length);
      const enc = await seal(this._key, plain, 'thumbs|' + hash);
      await this._commit((tx) => { tx.objectStore('thumbs').put({ hash, threadId, enc }); }, ['thumbs']);
    });
  }

  async getThumb(hash) {
    this._usable();
    const rec = await this._get('thumbs', hash);
    if (!rec) return null;
    try {
      const plain = await unseal(this._key, rec.enc, 'thumbs|' + hash);
      const n = (plain[0] << 8) | plain[1];
      return new Blob([plain.subarray(2 + n)], { type: td.decode(plain.subarray(2, 2 + n)) });
    } catch (_) {
      this.skipped++;
      return null;
    }
  }

  wipe() {
    const run = this._queue.then(async () => {
      const fresh = await newWrappedKey(this._wrap);
      await this._commit((tx) => {
        for (const name of ['threads', 'messages', 'thumbs', 'media', 'pieces', 'meta']) tx.objectStore(name).clear();
        tx.objectStore('meta').put(fresh.record);
      }, ['meta', 'threads', 'messages', 'thumbs', 'media', 'pieces']);
      this._key = fresh.key;
      this.status = 'open';
      this.skipped = 0;
    });
    this._queue = run.catch(() => {});
    return run;
  }

  close() {
    try { this._db.close(); } catch (_) {}
  }
}

export const openStore = async (secret) => {
  const db = await openDb();
  try {
    return await new Store(db, await deriveWrap(secret))._init();
  } catch (e) {
    db.close();
    throw mapError(e);
  }
};
