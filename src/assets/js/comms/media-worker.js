importScripts('/assets/js/comms/media-format.js');

const MF = self.MentriaMediaFormat;
const IDLE_MS = 1500;
let key = null;
let dirP = null;
const handles = new Map();
const gone = new Map();
const GONE_MS = 10000;

const coded = (code) => Object.assign(new Error(code), { code });
const codeOf = (e) => {
  if (e && typeof e.code === 'string') return e.code;
  if (e && e.name === 'QuotaExceededError') return 'quota';
  if (e && e.name === 'NotFoundError') return 'missing';
  if (e && e.name === 'OperationError') return 'missing';
  return 'unavailable';
};

const root = () => dirP || (dirP = navigator.storage.getDirectory().then((r) => r.getDirectoryHandle('comms-media', { create: true })));
const tmpDir = async (id, create) => (await (await root()).getDirectoryHandle('tmp', { create: true })).getDirectoryHandle(id, { create });

const closeHandle = async (id) => {
  const entry = handles.get(id);
  if (!entry) return;
  handles.delete(id);
  clearTimeout(entry.timer);
  try { (await entry.p).close(); } catch (_) {}
};

const touch = (id) => {
  const entry = handles.get(id);
  if (!entry) return;
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => { closeHandle(id); }, IDLE_MS);
};

const handleFor = (id, create) => {
  let entry = handles.get(id);
  if (!entry) {
    const p = (async () => {
      const fh = await (await root()).getFileHandle(id + '.bin', { create });
      for (let tries = 0; ; tries += 1) {
        try {
          return await fh.createSyncAccessHandle();
        } catch (e) {
          if (!(e && e.name === 'NoModificationAllowedError') || tries >= 10) throw e;
          await new Promise((r) => setTimeout(r, 300));
        }
      }
    })();
    entry = { p, timer: 0 };
    handles.set(id, entry);
    p.catch(() => { if (handles.get(id) === entry) handles.delete(id); });
  }
  touch(id);
  return entry.p;
};

const needKey = () => { if (!key) throw coded('locked'); };

const OPS = {
  async key(m) { key = m.key || null; return {}; },
  async forget() {
    key = null;
    await Promise.all(Array.from(handles.keys()).map(closeHandle));
    return {};
  },
  async probe() {
    try {
      const dir = await root();
      const fh = await dir.getFileHandle('.probe', { create: true });
      const h = await fh.createSyncAccessHandle();
      h.close();
      await dir.removeEntry('.probe');
      return { sync: true };
    } catch (_) {
      return { sync: false };
    }
  },
  async write(m) {
    needKey();
    if (Date.now() - (gone.get(m.id) || 0) < GONE_MS) throw coded('missing');
    const slot = await MF.sealPiece(key, m.id, m.i, m.plain);
    const h = await handleFor(m.id, true);
    const at = MF.slotOffset(m.i);
    const n = h.write(slot, { at });
    if (n !== slot.length) {
      h.truncate(Math.min(h.getSize(), at));
      throw coded('quota');
    }
    h.flush();
    return {};
  },
  async read(m) {
    needKey();
    const len = MF.slotLength(m.size, m.i);
    if (!len) throw coded('missing');
    const h = await handleFor(m.id, false);
    const slot = new Uint8Array(len);
    const n = h.read(slot, { at: MF.slotOffset(m.i) });
    if (n !== len) throw coded('missing');
    const plain = await MF.openPiece(key, m.id, m.i, slot);
    return { plain, transfer: [plain.buffer] };
  },
  async close(m) { await closeHandle(m.id); return {}; },
  async delete(m) {
    const dir = await root();
    for (const id of m.ids || []) {
      gone.set(id, Date.now());
      await closeHandle(id);
      try { await dir.removeEntry(id + '.bin'); } catch (_) {}
      try { await (await dir.getDirectoryHandle('tmp')).removeEntry(id, { recursive: true }); } catch (_) {}
    }
    return {};
  },
  async plain(m) {
    needKey();
    const n = MF.pieceCount(m.size);
    const src = await handleFor(m.id, false);
    const dir = await tmpDir(m.id, true);
    const fh = await dir.getFileHandle(m.name, { create: true });
    const out = await fh.createSyncAccessHandle();
    try {
      out.truncate(0);
      let at = 0;
      for (let i = 0; i < n; i += 1) {
        touch(m.id);
        const len = MF.slotLength(m.size, i);
        const slot = new Uint8Array(len);
        if (src.read(slot, { at: MF.slotOffset(i) }) !== len) throw coded('missing');
        const plain = await MF.openPiece(key, m.id, i, slot);
        if (out.write(plain, { at }) !== plain.length) throw coded('quota');
        at += plain.length;
      }
      out.flush();
    } finally {
      out.close();
    }
    return { done: true };
  },
  async deleteAll() {
    await Promise.all(Array.from(handles.keys()).map(closeHandle));
    const top = await navigator.storage.getDirectory();
    try { await top.removeEntry('comms-media', { recursive: true }); } catch (_) {}
    dirP = null;
    return {};
  },
  async dropPlain(m) {
    try { await (await (await root()).getDirectoryHandle('tmp')).removeEntry(m.id, { recursive: true }); } catch (_) {}
    return {};
  }
};

self.onmessage = async (e) => {
  const m = e.data || {};
  const op = OPS[m.op];
  let out;
  let transfer = [];
  try {
    if (!op) throw coded('unavailable');
    const res = await op(m);
    transfer = res.transfer || [];
    delete res.transfer;
    out = Object.assign({ ok: true }, res);
  } catch (err) {
    out = { ok: false, code: codeOf(err), msg: String((err && err.message) || err).slice(0, 200) };
  }
  self.postMessage(Object.assign({ seq: m.seq }, out), transfer);
};
