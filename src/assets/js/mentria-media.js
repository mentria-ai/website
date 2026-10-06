const DB_NAME = 'mentria-media';
const DB_VERSION = 1;
const MAX_FILES = 20000;
const THUMB_W = 400;
const EXIF_READ = 131072;
const EXTS = {
  video: ['mp4', 'm4v', 'webm', 'mkv', 'mov', 'ogv', 'avi'],
  audio: ['mp3', 'm4a', 'aac', 'flac', 'ogg', 'oga', 'opus', 'wav', 'aif', 'aiff', 'alac', 'weba'],
  image: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'heic', 'heif', 'bmp', 'jxl'],
  subtitle: ['srt', 'vtt'],
  playlist: ['m3u', 'm3u8']
};
const BOM = String.fromCharCode(65279);

const UA = navigator.userAgent || '';
const IOS = /iP(hone|ad|od)/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const SAFARI = /AppleWebKit/.test(UA) && !/Chrome|Chromium|Edg\/|Firefox|FxiOS|CriOS|EdgiOS/.test(UA);

export const caps = Object.freeze({
  folders: typeof window.showDirectoryPicker === 'function',
  fileHandles: typeof window.showOpenFilePicker === 'function',
  dirInput: 'webkitdirectory' in document.createElement('input'),
  launchQueue: 'launchQueue' in window,
  pip: !!document.pictureInPictureEnabled,
  mediaSession: 'mediaSession' in navigator,
  wakeLock: 'wakeLock' in navigator,
  ios: IOS,
  apple: IOS || SAFARI,
  standalone: (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true
});

export function extOf(name) {
  const m = /\.([a-z0-9]+)$/i.exec(String(name || ''));
  return m ? m[1].toLowerCase() : '';
}

export function baseName(name) {
  return String(name || '').replace(/\.[^.]+$/, '');
}

export function kindOf(file) {
  const ext = extOf(file && file.name);
  if (EXTS.playlist.indexOf(ext) !== -1) return 'playlist';
  if (EXTS.subtitle.indexOf(ext) !== -1) return 'subtitle';
  const type = String((file && file.type) || '');
  for (const k of ['video', 'audio', 'image']) if (type.indexOf(k + '/') === 0) return k;
  for (const k of Object.keys(EXTS)) if (EXTS[k].indexOf(ext) !== -1) return k;
  return '';
}

export function acceptFor(kinds) {
  const out = [];
  for (const k of kinds) {
    if (k === 'video' || k === 'audio' || k === 'image') out.push(k + '/*');
    for (const e of EXTS[k] || []) out.push('.' + e);
  }
  return out.join(',');
}

function hash(str) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

export function hashKey(str) {
  return hash(String(str || ''));
}

export function fingerprint(file) {
  return hash(file.name + '|' + file.size + '|' + (file.lastModified || 0));
}

let dbPromise = null;
function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('entries')) d.createObjectStore('entries', { keyPath: 'fp' });
        if (!d.objectStoreNames.contains('thumbs')) d.createObjectStore('thumbs');
        if (!d.objectStoreNames.contains('folders')) d.createObjectStore('folders', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbPromise.catch(() => { dbPromise = null; });
  }
  return dbPromise;
}

function run(store, mode, fn) {
  return openDb().then((d) => new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req && typeof req === 'object' && 'readyState' in req ? req.result : req);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

const live = new Map();

export function fileFor(fp) {
  return live.get(fp) || null;
}

export function getEntry(fp) {
  return run('entries', 'readonly', (s) => s.get(fp)).then((e) => e || null).catch(() => null);
}

export function listEntries(kind) {
  return run('entries', 'readonly', (s) => s.getAll())
    .then((all) => (all || []).filter((e) => !kind || e.kind === kind))
    .catch(() => []);
}

export function patchEntry(fp, patch) {
  return openDb().then((d) => new Promise((resolve) => {
    const t = d.transaction('entries', 'readwrite');
    const s = t.objectStore('entries');
    let out = null;
    const g = s.get(fp);
    g.onsuccess = () => {
      if (!g.result) return;
      out = Object.assign(g.result, patch);
      s.put(out);
    };
    t.oncomplete = () => resolve(out);
    t.onerror = () => resolve(null);
    t.onabort = () => resolve(null);
  })).catch(() => null);
}

export function patchEntries(list) {
  if (!list.length) return Promise.resolve();
  return openDb().then((d) => new Promise((resolve) => {
    const t = d.transaction('entries', 'readwrite');
    const s = t.objectStore('entries');
    list.forEach(([fp, patch]) => {
      const g = s.get(fp);
      g.onsuccess = () => { if (g.result) s.put(Object.assign(g.result, patch)); };
    });
    t.oncomplete = () => resolve();
    t.onerror = () => resolve();
    t.onabort = () => resolve();
  })).catch(() => {});
}

export function forgetEntry(fp) {
  live.delete(fp);
  return Promise.all([
    run('entries', 'readwrite', (s) => s.delete(fp)),
    run('thumbs', 'readwrite', (s) => s.delete(fp))
  ]).then(() => true, () => false);
}

export function register(items, ctx) {
  ctx = ctx || {};
  const now = Date.now();
  const rows = items.slice(0, MAX_FILES).map(({ file, relPath, fp }) => ({ file, relPath: relPath || file.webkitRelativePath || file.name, fp: fp || fingerprint(file) }));
  rows.forEach((r) => live.set(r.fp, r.file));
  return openDb().then((d) => new Promise((resolve) => {
    const t = d.transaction('entries', 'readwrite');
    const s = t.objectStore('entries');
    const out = new Array(rows.length);
    rows.forEach((r, i) => {
      const g = s.get(r.fp);
      g.onsuccess = () => {
        const prev = g.result || { fp: r.fp, addedAt: now, position: 0, watched: false };
        const next = Object.assign(prev, {
          name: r.file.name,
          size: r.file.size,
          lastModified: r.file.lastModified || 0,
          type: r.file.type || '',
          kind: ctx.kind || kindOf(r.file),
          relPath: r.relPath,
          folderId: ctx.folderId || prev.folderId || '',
          folderName: ctx.folderName || prev.folderName || '',
          seenAt: now
        });
        s.put(next);
        out[i] = next;
      };
    });
    t.oncomplete = () => resolve(out.filter(Boolean));
    t.onerror = () => resolve(out.filter(Boolean));
    t.onabort = () => resolve(out.filter(Boolean));
  })).catch(() => rows.map((r) => ({ fp: r.fp, name: r.file.name, size: r.file.size, kind: ctx.kind || kindOf(r.file), relPath: r.relPath, position: 0 })));
}

export function listFolders(kind) {
  return run('folders', 'readonly', (s) => s.getAll())
    .then((all) => (all || []).filter((f) => !kind || f.kind === kind).sort((a, b) => (b.usedAt || 0) - (a.usedAt || 0)))
    .catch(() => []);
}

export async function addFolder(kind) {
  const handle = await window.showDirectoryPicker({ id: 'mentria-' + kind, mode: 'read' });
  const folders = await listFolders(kind);
  for (const f of folders) {
    try { if (await f.handle.isSameEntry(handle)) { await touchFolder(f); return f; } } catch (_) {}
  }
  const folder = { id: hash(handle.name + '|' + Date.now() + '|' + Math.random()), name: handle.name, kind, handle, addedAt: Date.now(), usedAt: Date.now() };
  await run('folders', 'readwrite', (s) => s.put(folder));
  return folder;
}

export function touchFolder(folder) {
  folder.usedAt = Date.now();
  return run('folders', 'readwrite', (s) => s.put(folder)).catch(() => {});
}

export function forgetFolder(id) {
  return run('folders', 'readwrite', (s) => s.delete(id)).then(() => true, () => false);
}

export async function folderAccess(folder, ask) {
  const opts = { mode: 'read' };
  try {
    let state = await folder.handle.queryPermission(opts);
    if (state === 'prompt' && ask) state = await folder.handle.requestPermission(opts);
    return state === 'granted';
  } catch (_) {
    return false;
  }
}

async function walk(dir, kinds, prefix, depth, out, onProgress) {
  for await (const [name, h] of dir.entries()) {
    if (out.length >= MAX_FILES) return;
    if (name.charAt(0) === '.') continue;
    if (h.kind === 'file') {
      if (kinds.indexOf(kindOf({ name })) === -1) continue;
      try { out.push({ file: await h.getFile(), relPath: prefix + name }); } catch (_) {}
      if (onProgress && out.length % 100 === 0) onProgress(out.length);
    } else if (h.kind === 'directory' && depth < 6) {
      await walk(h, kinds, prefix + name + '/', depth + 1, out, onProgress);
    }
  }
}

export async function scanFolder(folder, kinds, onProgress) {
  const out = [];
  await walk(folder.handle, kinds, '', 0, out, onProgress);
  return out;
}

function pickWithInput(accept, directory) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    if (accept) input.accept = accept;
    if (directory) input.webkitdirectory = true;
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    let settled = false;
    const finish = (files) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => finish(Array.from(input.files || []).map((file) => ({ file, relPath: file.webkitRelativePath || file.name }))));
    input.addEventListener('cancel', () => finish([]));
    document.body.appendChild(input);
    input.click();
  });
}

export function pickFiles(kinds) {
  return pickWithInput(acceptFor(kinds), false);
}

export async function pickFileHandles(kinds, kind) {
  const accept = {};
  for (const k of kinds) {
    if (k === 'video' || k === 'audio' || k === 'image') accept[k + '/*'] = EXTS[k].map((e) => '.' + e);
  }
  let handles = [];
  try { handles = await window.showOpenFilePicker({ id: 'mentria-' + kind, multiple: true, types: [{ accept }] }); } catch (e) { return e && e.name === 'AbortError' ? [] : pickFiles(kinds); }
  const out = [];
  for (const handle of handles) {
    try {
      const file = await handle.getFile();
      if (kinds.indexOf(kindOf(file)) !== -1) out.push({ file, relPath: file.name, handle });
    } catch (_) {}
  }
  return out;
}

const SET_ID = 'files:';

export function fileSet(kind) {
  return run('folders', 'readonly', (s) => s.get(SET_ID + kind))
    .then((r) => (r && Array.isArray(r.items) && r.items.length ? r : null))
    .catch(() => null);
}

function setItems(items) {
  return items.filter((it) => it.handle).map((it) => ({ handle: it.handle, relPath: it.relPath || it.file.name, fp: it.fp || fingerprint(it.file) }));
}

export function saveFileSet(kind, items) {
  const rec = { id: SET_ID + kind, kind: SET_ID + kind, items: setItems(items).slice(0, MAX_FILES), usedAt: Date.now() };
  return run('folders', 'readwrite', (s) => s.put(rec)).catch(() => {});
}

export async function addToFileSet(kind, items) {
  const cur = await fileSet(kind);
  const list = cur ? cur.items.slice() : [];
  const seen = new Set(list.map((it) => it.fp));
  setItems(items).forEach((it) => { if (!seen.has(it.fp)) { seen.add(it.fp); list.push(it); } });
  const rec = { id: SET_ID + kind, kind: SET_ID + kind, items: list.slice(0, MAX_FILES), usedAt: Date.now() };
  return run('folders', 'readwrite', (s) => s.put(rec)).catch(() => {});
}

export async function fileSetAccess(set) {
  const states = await Promise.all(set.items.map((it) => it.handle.queryPermission({ mode: 'read' }).catch(() => 'denied')));
  if (states.every((st) => st === 'granted')) return 'granted';
  return states.some((st) => st === 'prompt') ? 'prompt' : 'denied';
}

export async function openFileSet(set, ask, prefer) {
  const opts = { mode: 'read' };
  const lead = set.items.find((it) => it.fp === prefer) || set.items[0];
  if (ask && lead) {
    try { if (await lead.handle.queryPermission(opts) === 'prompt') await lead.handle.requestPermission(opts); } catch (_) {}
  }
  const got = await Promise.all(set.items.map(async (it) => {
    try {
      if (await it.handle.queryPermission(opts) !== 'granted') return null;
      return { file: await it.handle.getFile(), relPath: it.relPath, handle: it.handle };
    } catch (_) {
      return null;
    }
  }));
  return got.filter(Boolean);
}

export async function pickDirectory(kinds) {
  const items = await pickWithInput('', true);
  return items.filter((it) => kinds.indexOf(kindOf(it.file)) !== -1).slice(0, MAX_FILES);
}

function readAllEntries(reader) {
  return new Promise((resolve) => {
    const all = [];
    const next = () => reader.readEntries((batch) => {
      if (!batch.length) { resolve(all); return; }
      all.push(...batch);
      next();
    }, () => resolve(all));
    next();
  });
}

async function collectEntry(entry, prefix, kinds, out, depth) {
  if (out.length >= MAX_FILES) return;
  if (entry.isFile) {
    if (kinds.indexOf(kindOf({ name: entry.name })) === -1) return;
    const file = await new Promise((resolve) => entry.file(resolve, () => resolve(null)));
    if (file) out.push({ file, relPath: prefix + entry.name });
  } else if (entry.isDirectory && depth < 6) {
    const children = await readAllEntries(entry.createReader());
    for (const child of children) await collectEntry(child, prefix + entry.name + '/', kinds, out, depth + 1);
  }
}

export async function filesFromDrop(dataTransfer, kinds) {
  const out = [];
  const items = Array.from((dataTransfer && dataTransfer.items) || []);
  const entries = items.map((it) => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null)).filter(Boolean);
  if (entries.length) {
    for (const entry of entries) await collectEntry(entry, '', kinds, out, 0);
    return out;
  }
  return Array.from((dataTransfer && dataTransfer.files) || [])
    .filter((file) => kinds.indexOf(kindOf(file)) !== -1)
    .map((file) => ({ file, relPath: file.name }));
}

export function naturalSort(list, key) {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return list.slice().sort((a, b) => collator.compare(key(a), key(b)));
}

function captureFrame(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    let done = false;
    let meta = { duration: 0, width: 0, height: 0 };
    const finish = (blob) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      v.removeAttribute('src');
      try { v.load(); } catch (_) {}
      URL.revokeObjectURL(url);
      resolve(Object.assign({ blob }, meta));
    };
    const timer = setTimeout(() => finish(null), 10000);
    v.addEventListener('loadedmetadata', () => {
      meta = { duration: isFinite(v.duration) ? v.duration : 0, width: v.videoWidth || 0, height: v.videoHeight || 0 };
      const target = meta.duration > 0 ? Math.min(Math.max(1, meta.duration * 0.1), Math.max(0, meta.duration - 0.25)) : 0;
      try { v.currentTime = target; } catch (_) { finish(null); }
    }, { once: true });
    v.addEventListener('seeked', () => {
      if (!v.videoWidth) { finish(null); return; }
      const w = 320;
      const h = Math.max(1, Math.round(w * v.videoHeight / v.videoWidth));
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      try {
        c.getContext('2d').drawImage(v, 0, 0, w, h);
        c.toBlob((b) => finish(b), 'image/jpeg', 0.72);
      } catch (_) {
        finish(null);
      }
    }, { once: true });
    v.addEventListener('error', () => finish(null), { once: true });
    v.src = url;
  });
}

let thumbChain = Promise.resolve();
export function videoThumb(entry) {
  const job = thumbChain.then(async () => {
    const cached = await run('thumbs', 'readonly', (s) => s.get(entry.fp)).catch(() => null);
    if (cached) return cached;
    const file = live.get(entry.fp);
    if (!file) return null;
    const shot = await captureFrame(file);
    const patch = {};
    if (shot.duration) patch.duration = shot.duration;
    if (shot.width) { patch.width = shot.width; patch.height = shot.height; }
    if (Object.keys(patch).length) { Object.assign(entry, patch); await patchEntry(entry.fp, patch); }
    if (shot.blob) await run('thumbs', 'readwrite', (s) => s.put(shot.blob, entry.fp)).catch(() => {});
    return shot.blob;
  });
  thumbChain = job.catch(() => null);
  return job;
}

export function cachedThumb(fp) {
  return run('thumbs', 'readonly', (s) => s.get(fp)).catch(() => null);
}

export function cachedThumbs(fps) {
  const out = new Map();
  if (!fps.length) return Promise.resolve(out);
  return openDb().then((d) => new Promise((resolve) => {
    const t = d.transaction('thumbs', 'readonly');
    const s = t.objectStore('thumbs');
    fps.forEach((fp) => {
      const g = s.get(fp);
      g.onsuccess = () => { if (g.result) out.set(fp, g.result); };
    });
    t.oncomplete = () => resolve(out);
    t.onerror = () => resolve(out);
    t.onabort = () => resolve(out);
  })).catch(() => out);
}

const WORKER_URL = new URL('mentria-media-worker.js' + new URL(import.meta.url).search, import.meta.url).href;
let pool = null;

function makePool() {
  pool = { all: [], idle: [], queue: [], jobs: new Map(), seq: 0 };
  if (typeof Worker !== 'function' || typeof OffscreenCanvas !== 'function') return pool;
  const n = IOS ? 1 : Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 2) - 1));
  for (let i = 0; i < n; i++) {
    let w;
    try { w = new Worker(WORKER_URL); } catch (_) { break; }
    w.onmessage = (e) => {
      const job = pool.jobs.get(e.data && e.data.id);
      if (job) { pool.jobs.delete(job.id); job.resolve(e.data.blob || null); }
      pool.idle.push(w);
      drainPool();
    };
    w.onerror = (e) => {
      if (e && e.preventDefault) e.preventDefault();
      pool.all = pool.all.filter((x) => x !== w);
      pool.idle = pool.idle.filter((x) => x !== w);
      pool.jobs.forEach((job) => { if (job.worker === w) { pool.jobs.delete(job.id); job.resolve(null); } });
      try { w.terminate(); } catch (_) {}
      if (!pool.all.length) { pool.queue.splice(0).forEach((job) => job.resolve(null)); }
      else drainPool();
    };
    pool.all.push(w);
    pool.idle.push(w);
  }
  return pool;
}

function drainPool() {
  while (pool.idle.length && pool.queue.length) {
    const w = pool.idle.shift();
    const job = pool.queue.shift();
    job.worker = w;
    pool.jobs.set(job.id, job);
    try { w.postMessage({ id: job.id, file: job.file, width: THUMB_W }); }
    catch (_) { pool.jobs.delete(job.id); pool.idle.push(w); job.resolve(null); }
  }
}

function viaWorker(file) {
  const p = pool || makePool();
  if (!p.all.length) return Promise.resolve(null);
  return new Promise((resolve) => {
    p.queue.push({ id: ++p.seq, file, resolve, worker: null });
    drainPool();
  });
}

function decodeOnMain(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    const done = (b) => { URL.revokeObjectURL(url); resolve(b || null); };
    img.decoding = 'async';
    img.onload = () => {
      try {
        const nw = img.naturalWidth;
        const nh = img.naturalHeight;
        if (!nw || !nh) { done(null); return; }
        const w = Math.min(THUMB_W, nw);
        const h = Math.max(1, Math.round(w * nh / nw));
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#16181d';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        c.toBlob((b) => done(b), 'image/jpeg', 0.8);
      } catch (_) {
        done(null);
      }
    };
    img.onerror = () => done(null);
    img.src = url;
  });
}

let mainChain = Promise.resolve();
function viaMain(file) {
  const job = mainChain.then(() => decodeOnMain(file));
  mainChain = job.catch(() => null);
  return job;
}

export async function imageThumb(entry) {
  const cached = await cachedThumb(entry.fp);
  if (cached) return cached;
  const file = live.get(entry.fp);
  if (!file) return null;
  let blob = await viaWorker(file);
  if (!blob) blob = await viaMain(file);
  if (blob) await run('thumbs', 'readwrite', (s) => s.put(blob, entry.fp)).catch(() => {});
  return blob;
}

export async function storeArt(key, blob) {
  if (!key || !blob) return null;
  let out = await viaWorker(blob);
  if (!out) out = await viaMain(blob);
  if (out) await run('thumbs', 'readwrite', (s) => s.put(out, key)).catch(() => {});
  return out;
}

export function thumbFor(entry) {
  return entry.kind === 'video' ? videoThumb(entry) : imageThumb(entry);
}

export function thumbSlots() {
  const p = pool || makePool();
  return Math.max(1, p.all.length);
}

function tiffValue(dv, base, at, le) {
  const type = dv.getUint16(at + 2, le);
  const count = dv.getUint32(at + 4, le);
  const unit = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8][type] || 0;
  if (!unit || count > 4096) return null;
  const len = unit * count;
  const off = len <= 4 ? at + 8 : base + dv.getUint32(at + 8, le);
  if (off + len > dv.byteLength) return null;
  if (type === 2) {
    let str = '';
    for (let i = 0; i < count; i++) {
      const c = dv.getUint8(off + i);
      if (!c) break;
      str += String.fromCharCode(c);
    }
    return str.trim();
  }
  const vals = [];
  for (let i = 0; i < Math.min(count, 16); i++) {
    if (type === 1 || type === 7) vals.push(dv.getUint8(off + i));
    else if (type === 3) vals.push(dv.getUint16(off + i * 2, le));
    else if (type === 4) vals.push(dv.getUint32(off + i * 4, le));
    else if (type === 9) vals.push(dv.getInt32(off + i * 4, le));
    else if (type === 5) { const b = dv.getUint32(off + i * 8 + 4, le); vals.push(b ? dv.getUint32(off + i * 8, le) / b : 0); }
    else if (type === 10) { const b = dv.getInt32(off + i * 8 + 4, le); vals.push(b ? dv.getInt32(off + i * 8, le) / b : 0); }
    else return null;
  }
  return count === 1 ? vals[0] : vals;
}

function tiffIfd(dv, base, off, le, out) {
  const at = base + off;
  if (!off || at + 2 > dv.byteLength) return;
  const n = dv.getUint16(at, le);
  if (n > 400) return;
  for (let i = 0; i < n; i++) {
    const e = at + 2 + i * 12;
    if (e + 12 > dv.byteLength) return;
    try { out[dv.getUint16(e, le)] = tiffValue(dv, base, e, le); } catch (_) {}
  }
}

function parseTiff(dv, base) {
  if (base + 8 > dv.byteLength) return null;
  const mark = dv.getUint16(base, false);
  const le = mark === 0x4949;
  if (!le && mark !== 0x4d4d) return null;
  if (dv.getUint16(base + 2, le) !== 42) return null;
  const i0 = {};
  const ex = {};
  const gps = {};
  tiffIfd(dv, base, dv.getUint32(base + 4, le), le, i0);
  if (typeof i0[0x8769] === 'number') tiffIfd(dv, base, i0[0x8769], le, ex);
  if (typeof i0[0x8825] === 'number') tiffIfd(dv, base, i0[0x8825], le, gps);
  return { i0, ex, gps };
}

function exifDate(v) {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(typeof v === 'string' ? v : '');
  if (!m) return 0;
  const t = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
  return t > 0 && t < Date.now() + 86400000 ? t : 0;
}

function gpsDeg(v, ref) {
  if (!Array.isArray(v) || v.length < 3) return null;
  const d = v[0] + v[1] / 60 + v[2] / 3600;
  return ref === 'S' || ref === 'W' ? -d : d;
}

function exifSummary(t) {
  const { i0, ex, gps } = t;
  const out = { taken: exifDate(ex[0x9003]) || exifDate(ex[0x9004]) || exifDate(i0[0x0132]) };
  const text = (v) => (typeof v === 'string' && v ? v : '');
  const num = (v) => (typeof v === 'number' && v > 0 ? v : 0);
  if (text(i0[0x010f])) out.make = i0[0x010f];
  if (text(i0[0x0110])) out.model = i0[0x0110];
  if (text(ex[0xa434])) out.lens = ex[0xa434];
  if (num(ex[0x829a])) out.exposure = ex[0x829a];
  if (num(ex[0x829d])) out.fnumber = ex[0x829d];
  const iso = Array.isArray(ex[0x8827]) ? ex[0x8827][0] : ex[0x8827];
  if (num(iso)) out.iso = iso;
  if (num(ex[0x920a])) out.focal = ex[0x920a];
  if (num(i0[0x0112])) out.orientation = i0[0x0112];
  if (num(ex[0xa002]) && num(ex[0xa003])) { out.width = ex[0xa002]; out.height = ex[0xa003]; }
  const lat = gpsDeg(gps[2], gps[1]);
  const lon = gpsDeg(gps[4], gps[3]);
  if (lat !== null && lon !== null && (lat || lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) { out.lat = lat; out.lon = lon; }
  return out;
}

function tag4(u8, at) {
  return String.fromCharCode(u8[at], u8[at + 1], u8[at + 2], u8[at + 3]);
}

export async function readExif(file) {
  try {
    const buf = await file.slice(0, EXIF_READ).arrayBuffer();
    const dv = new DataView(buf);
    const u8 = new Uint8Array(buf);
    let tiff = null;
    if (u8[0] === 0xff && u8[1] === 0xd8) {
      let p = 2;
      while (p + 10 <= u8.length && u8[p] === 0xff) {
        const mk = u8[p + 1];
        if (mk === 0xda || mk === 0xd9) break;
        if (mk === 0xd8 || mk === 0x01 || (mk >= 0xd0 && mk <= 0xd7)) { p += 2; continue; }
        const len = dv.getUint16(p + 2, false);
        if (len < 2) break;
        if (mk === 0xe1 && tag4(u8, p + 4) === 'Exif' && u8[p + 8] === 0 && u8[p + 9] === 0) { tiff = parseTiff(dv, p + 10); break; }
        p += 2 + len;
      }
    } else if (u8[0] === 0x89 && tag4(u8, 1) === 'PNG\r') {
      let p = 8;
      while (p + 8 <= u8.length) {
        const len = dv.getUint32(p, false);
        const type = tag4(u8, p + 4);
        if (type === 'eXIf') { tiff = parseTiff(dv, p + 8); break; }
        if (type === 'IDAT' || type === 'IEND') break;
        p += 12 + len;
      }
    } else if (tag4(u8, 0) === 'RIFF' && tag4(u8, 8) === 'WEBP') {
      let p = 12;
      while (p + 8 <= u8.length) {
        const type = tag4(u8, p);
        const len = dv.getUint32(p + 4, true);
        if (type === 'EXIF') {
          let b = p + 8;
          if (tag4(u8, b) === 'Exif') b += 6;
          tiff = parseTiff(dv, b);
          break;
        }
        p += 8 + len + (len & 1);
      }
    }
    return tiff ? exifSummary(tiff) : null;
  } catch (_) {
    return null;
  }
}

async function boxAt(file, off) {
  if (off + 8 > file.size) return null;
  const dv = new DataView(await file.slice(off, off + 16).arrayBuffer());
  let size = dv.getUint32(0, false);
  const type = String.fromCharCode(dv.getUint8(4), dv.getUint8(5), dv.getUint8(6), dv.getUint8(7));
  let header = 8;
  if (size === 1 && dv.byteLength >= 16) { size = dv.getUint32(8, false) * 4294967296 + dv.getUint32(12, false); header = 16; }
  else if (size === 0) size = file.size - off;
  return size < header ? null : { type, size, header };
}

export async function mediaDate(file) {
  try {
    let off = 0;
    for (let i = 0; i < 64 && off < file.size; i++) {
      const box = await boxAt(file, off);
      if (!box) return 0;
      if (box.type === 'moov') {
        let p = off + box.header;
        const end = Math.min(file.size, off + box.size);
        for (let j = 0; j < 64 && p < end; j++) {
          const child = await boxAt(file, p);
          if (!child) return 0;
          if (child.type === 'mvhd') {
            const dv = new DataView(await file.slice(p + child.header, p + child.header + 12).arrayBuffer());
            const secs = dv.getUint8(0) === 1 ? dv.getUint32(4, false) * 4294967296 + dv.getUint32(8, false) : dv.getUint32(4, false);
            const ms = (secs - 2082844800) * 1000;
            return ms > 0 && ms < Date.now() + 86400000 ? ms : 0;
          }
          p += child.size;
        }
        return 0;
      }
      off += box.size;
    }
  } catch (_) {}
  return 0;
}

export function formatBytes(n, lang) {
  const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte'];
  let v = Number(n) || 0;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) { v /= 1000; i++; }
  try {
    return new Intl.NumberFormat(lang, { style: 'unit', unit: units[i], unitDisplay: 'short', maximumFractionDigits: i ? 1 : 0 }).format(v);
  } catch (_) {
    return v.toFixed(i ? 1 : 0) + ' ' + ['B', 'kB', 'MB', 'GB'][i];
  }
}

async function findCodes(file, codes) {
  const size = file.size;
  const span = 4 * 1024 * 1024;
  const ranges = size <= span * 2 ? [[0, size]] : [[0, span], [size - span, size]];
  const needles = codes.map((c) => Array.from(c).map((ch) => ch.charCodeAt(0)));
  for (const [a, b] of ranges) {
    const bytes = new Uint8Array(await file.slice(a, b).arrayBuffer());
    for (let i = 0; i < bytes.length - 4; i++) {
      for (const n of needles) {
        if (bytes[i] === n[0] && bytes[i + 1] === n[1] && bytes[i + 2] === n[2] && bytes[i + 3] === n[3]) return true;
      }
    }
  }
  return false;
}

export async function preflight(file) {
  const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  const text = (a, b) => String.fromCharCode.apply(null, Array.from(head.slice(a, b)));
  let container = '';
  if (text(4, 8) === 'ftyp') container = text(8, 12) === 'qt  ' ? 'mov' : 'mp4';
  else if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) container = text(0, 64).indexOf('webm') !== -1 ? 'webm' : 'mkv';
  else if (text(0, 4) === 'RIFF' && text(8, 11) === 'AVI') container = 'avi';
  else if (text(0, 4) === 'OggS') container = 'ogg';
  const issues = [];
  if (container === 'mkv' && caps.apple) issues.push('mkv_apple');
  if (container === 'avi') issues.push('avi');
  if ((container === 'mp4' || container === 'mov' || container === 'mkv') && !caps.apple) {
    try { if (await findCodes(file, ['ac-3', 'ec-3', 'dtsc', 'dtsh', 'dtsl', 'dtse', 'A_AC', 'A_DT'])) issues.push('dolby'); } catch (_) {}
    try { if (container !== 'mkv' && await findCodes(file, ['alac'])) issues.push('alac'); } catch (_) {}
  }
  return { container, issues };
}

export async function readText(file) {
  const buf = await file.arrayBuffer();
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (_) { text = new TextDecoder('windows-1252').decode(buf); }
  return text.charAt(0) === BOM ? text.slice(1) : text;
}

export function toVtt(text) {
  const body = String(text).replace(/\r\n?/g, '\n').trim();
  if (/^WEBVTT/.test(body)) return body;
  const cues = body.split(/\n{2,}/).map((block) => {
    const lines = block.split('\n');
    if (/^\d+$/.test(lines[0].trim())) lines.shift();
    if (lines.length && lines[0].indexOf('-->') !== -1) lines[0] = lines[0].replace(/(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/g, (m, h, mi, se, ms) => h.padStart(2, '0') + ':' + mi + ':' + se + '.' + ms.padEnd(3, '0'));
    return lines.join('\n');
  }).filter((b) => b.indexOf('-->') !== -1);
  return 'WEBVTT\n\n' + cues.join('\n\n');
}

let wakeLock = null;
let wantAwake = false;
function grabWake() {
  if (wakeLock || !wantAwake || !navigator.wakeLock || document.visibilityState !== 'visible') return;
  navigator.wakeLock.request('screen').then((lock) => {
    if (!wantAwake) { lock.release().catch(() => {}); return; }
    wakeLock = lock;
    lock.addEventListener('release', () => { if (wakeLock === lock) wakeLock = null; });
  }).catch(() => {});
}

export function keepAwake(on) {
  wantAwake = !!on;
  if (wantAwake) grabWake();
  else if (wakeLock) { const lock = wakeLock; wakeLock = null; lock.release().catch(() => {}); }
}

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') grabWake(); });

export function playbackAudioSession() {
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (_) {}
}

export function setSession(info) {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: info.title || '',
      artist: info.artist || '',
      album: info.album || '',
      artwork: info.artwork ? [{ src: info.artwork, sizes: info.artworkSize || '320x180', type: info.artworkType || 'image/jpeg' }] : []
    });
  } catch (_) {}
  const actions = info.actions || {};
  for (const name of ['play', 'pause', 'previoustrack', 'nexttrack', 'seekbackward', 'seekforward', 'seekto', 'stop']) {
    try { navigator.mediaSession.setActionHandler(name, actions[name] || null); } catch (_) {}
  }
}

export function sessionState(playing, duration, position, rate) {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
    if (duration > 0 && isFinite(duration) && 'setPositionState' in navigator.mediaSession) {
      navigator.mediaSession.setPositionState({ duration, position: Math.max(0, Math.min(position || 0, duration)), playbackRate: rate || 1 });
    }
  } catch (_) {}
}

export function formatTime(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return (h ? h + ':' : '') + mm + ':' + String(s).padStart(2, '0');
}
