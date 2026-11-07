import { blank } from '/assets/js/comms/location.js';

const FORMAT_URL = '/assets/js/comms/media-format.js';
const WORKER_URL = '/assets/js/comms/media-worker.js';

let formatP = null;
export const ensureFormat = () => {
  if (globalThis.MentriaMediaFormat) return Promise.resolve(globalThis.MentriaMediaFormat);
  if (formatP) return formatP;
  formatP = new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = FORMAT_URL;
    el.onload = () => (globalThis.MentriaMediaFormat ? resolve(globalThis.MentriaMediaFormat) : reject(new Error('format')));
    el.onerror = () => { formatP = null; reject(new Error('format')); };
    document.head.append(el);
  });
  return formatP;
};

const coded = (code, msg) => Object.assign(new Error(msg || code), { code });

let pageKey = null;
let answering = false;
const swOf = () => (typeof navigator !== 'undefined' ? navigator.serviceWorker : null);
const answerOnce = () => {
  const sw = swOf();
  if (!sw || answering) return;
  answering = true;
  sw.addEventListener('message', (e) => {
    const d = e.data || {};
    if (d.type !== 'comms-media-need-key' || !e.ports || !e.ports[0]) return;
    e.ports[0].postMessage(pageKey ? { key: pageKey } : {});
  });
};

class Media {
  constructor(store, MF, worker, sync) {
    this._store = store;
    this._MF = MF;
    this._worker = worker;
    this._seq = 0;
    this._wait = new Map();
    this._sizes = new Map();
    this._where = new Map();
    this._locked = false;
    this.sync = sync;
    if (worker) {
      worker.onmessage = (e) => {
        const d = e.data || {};
        const done = this._wait.get(d.seq);
        if (!done) return;
        this._wait.delete(d.seq);
        if (d.ok) done.resolve(d);
        else done.reject(coded(d.code || 'unavailable', d.msg));
      };
      worker.onerror = () => {
        for (const w of this._wait.values()) w.reject(coded('unavailable'));
        this._wait.clear();
      };
    }
  }

  _call(op, data, transfer) {
    if (!this._worker) return Promise.reject(coded('unavailable'));
    const seq = ++this._seq;
    return new Promise((resolve, reject) => {
      this._wait.set(seq, { resolve, reject });
      this._worker.postMessage(Object.assign({ op, seq }, data || {}), transfer || []);
    });
  }

  async _info(id) {
    if (this._sizes.has(id)) return { size: this._sizes.get(id), where: this._where.get(id) };
    const rec = await this._store.getMedia(id);
    if (!rec) throw coded('missing');
    this._sizes.set(id, rec.size);
    this._where.set(id, rec.where || (this.sync ? 'opfs' : 'idb'));
    return { size: rec.size, where: this._where.get(id) };
  }

  _remember(id, size, where) {
    this._sizes.set(id, size);
    this._where.set(id, where);
  }

  async importFile(file, { threadId, id, ranges, onProgress, record } = {}) {
    const MF = this._MF;
    const size = file.size;
    const n = MF.pieceCount(size);
    const where = this.sync ? 'opfs' : 'idb';
    this._remember(id, size, where);
    const hashes = [];
    for (let i = 0; i < n; i += 1) {
      const start = i * MF.PIECE;
      const plain = new Uint8Array(await file.slice(start, start + MF.pieceLength(size, i)).arrayBuffer());
      if (ranges && ranges.length) blank(plain, start, ranges);
      hashes.push(await MF.sha256(plain));
      await this.writePiece(id, i, plain);
      if (onProgress) onProgress(i + 1, n);
    }
    if (this.sync) await this._call('close', { id }).catch(() => {});
    const mh = await MF.manifestHash(hashes);
    const have = MF.bfNew(n);
    for (let i = 0; i < n; i += 1) MF.bfSet(have, i);
    await this._store.putMedia(Object.assign({
      id, threadId, role: 'out', state: 'done', complete: true, updatedAt: Date.now(),
      name: file.name || '', mime: file.type || 'application/octet-stream', size, pieceSize: MF.PIECE,
      hashes: MF.b64(MF.joinHashes(hashes)), mh, have: MF.bfB64(have), where
    }, record || {}));
    return { id, size, pieceSize: MF.PIECE, hashes, mh };
  }

  async writePiece(id, i, plain) {
    if (this._locked) throw coded('locked');
    const where = this._where.get(id) || (this.sync ? 'opfs' : 'idb');
    if (!this._where.has(id)) this._where.set(id, where);
    if (where === 'opfs') {
      const copy = plain.slice();
      await this._call('write', { id, i, plain: copy }, [copy.buffer]);
      return;
    }
    const slot = await this._MF.sealPiece(this._store.key, id, i, plain);
    await this._store.putPiece(id, i, slot);
  }

  async readPiece(id, i) {
    if (this._locked) throw coded('locked');
    const { size, where } = await this._info(id);
    if (where === 'opfs') {
      const res = await this._call('read', { id, i, size });
      return res.plain;
    }
    const slot = await this._store.getPiece(id, i);
    if (!slot) throw coded('missing');
    return this._MF.openPiece(this._store.key, id, i, slot);
  }

  async closeFile(id) {
    if (this.sync) await this._call('close', { id }).catch(() => {});
  }

  async removeFiles(ids) {
    const list = Array.from(ids || []);
    if (!list.length) return;
    for (const id of list) { this._sizes.delete(id); this._where.delete(id); }
    if (this._worker) await this._call('delete', { ids: list }).catch(() => {});
  }

  async removeAll() {
    this._sizes.clear();
    this._where.clear();
    if (this._worker) await this._call('deleteAll').catch(() => {});
  }

  async usage(threadId) {
    const MF = this._MF;
    let total = 0;
    for (const rec of await this._store.listMedia(threadId == null ? {} : { threadId })) {
      if (rec.state === 'removed') continue;
      if (rec.complete) { total += rec.size; continue; }
      const n = MF.pieceCount(rec.size);
      const bf = MF.bfFrom(rec.have, n);
      for (let i = 0; i < n; i += 1) if (MF.bfHas(bf, i)) total += MF.pieceLength(rec.size, i);
    }
    return total;
  }

  async plainFile(id, name, mime) {
    if (this._locked) throw coded('locked');
    const safe = String(name || 'file').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').slice(0, 120) || 'file';
    const { size, where } = await this._info(id);
    if (where === 'opfs') {
      await this._call('plain', { id, size, name: safe });
      const root = await navigator.storage.getDirectory();
      const dir = await (await (await root.getDirectoryHandle('comms-media')).getDirectoryHandle('tmp')).getDirectoryHandle(id);
      const file = await (await dir.getFileHandle(safe)).getFile();
      return new File([file], safe, { type: mime || file.type || 'application/octet-stream' });
    }
    const parts = [];
    for (let i = 0; i < this._MF.pieceCount(size); i += 1) parts.push(await this.readPiece(id, i));
    return new File(parts, safe, { type: mime || 'application/octet-stream' });
  }

  async dropPlain(id) {
    if (this._worker) await this._call('dropPlain', { id }).catch(() => {});
  }

  shareKey() {
    const sw = swOf();
    if (!sw || this._locked || !this._store) return;
    pageKey = this._store.key;
    answerOnce();
    const post = (w) => { try { if (w) w.postMessage({ type: 'comms-media-key', key: pageKey }); } catch (_) {} };
    post(sw.controller);
    sw.ready.then((reg) => { if (reg.active && reg.active !== sw.controller) post(reg.active); }, () => {});
  }

  forget() {
    this._locked = true;
    pageKey = null;
    if (this._worker) this._call('forget').catch(() => {});
    const sw = swOf();
    try { if (sw && sw.controller) sw.controller.postMessage({ type: 'comms-media-forget' }); } catch (_) {}
  }

  async unlock(store) {
    this._store = store || this._store;
    this._locked = false;
    if (this._worker) await this._call('key', { key: this._store.key });
    this.shareKey();
  }

  close() {
    if (this._worker) this._worker.terminate();
    this._worker = null;
  }
}

export const openMedia = async (store, { noSync = false } = {}) => {
  const MF = await ensureFormat();
  let worker = null;
  try { worker = new Worker(WORKER_URL); } catch (_) { worker = null; }
  const media = new Media(store, MF, worker, false);
  if (worker) {
    try {
      await media._call('key', { key: store.key });
      const probe = await media._call('probe');
      media.sync = !noSync && !!probe.sync;
    } catch (_) {
      media.sync = false;
    }
  }
  media.shareKey();
  return media;
};
