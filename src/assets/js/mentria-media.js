const DB_NAME = 'mentria-media';
const DB_VERSION = 1;
const MAX_FILES = 5000;
const EXTS = {
  video: ['mp4', 'm4v', 'webm', 'mkv', 'mov', 'ogv', 'avi'],
  audio: ['mp3', 'm4a', 'aac', 'flac', 'ogg', 'oga', 'opus', 'wav', 'aif', 'aiff', 'alac', 'weba'],
  image: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'heic', 'heif', 'bmp', 'jxl'],
  subtitle: ['srt', 'vtt']
};
const BOM = String.fromCharCode(65279);

const UA = navigator.userAgent || '';
const IOS = /iP(hone|ad|od)/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const SAFARI = /AppleWebKit/.test(UA) && !/Chrome|Chromium|Edg\/|Firefox|FxiOS|CriOS|EdgiOS/.test(UA);

export const caps = Object.freeze({
  folders: typeof window.showDirectoryPicker === 'function',
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
  const type = String((file && file.type) || '');
  for (const k of ['video', 'audio', 'image']) if (type.indexOf(k + '/') === 0) return k;
  const ext = extOf(file && file.name);
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
  const rows = items.slice(0, MAX_FILES).map(({ file, relPath }) => ({ file, relPath: relPath || file.webkitRelativePath || file.name, fp: fingerprint(file) }));
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

async function walk(dir, kinds, prefix, depth, out) {
  for await (const [name, h] of dir.entries()) {
    if (out.length >= MAX_FILES) return;
    if (name.charAt(0) === '.') continue;
    if (h.kind === 'file') {
      if (kinds.indexOf(kindOf({ name })) === -1) continue;
      try { out.push({ file: await h.getFile(), relPath: prefix + name }); } catch (_) {}
    } else if (h.kind === 'directory' && depth < 6) {
      await walk(h, kinds, prefix + name + '/', depth + 1, out);
    }
  }
}

export async function scanFolder(folder, kinds) {
  const out = [];
  await walk(folder.handle, kinds, '', 0, out);
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
    if (Object.keys(patch).length) await patchEntry(entry.fp, patch);
    if (shot.blob) await run('thumbs', 'readwrite', (s) => s.put(shot.blob, entry.fp)).catch(() => {});
    return shot.blob;
  });
  thumbChain = job.catch(() => null);
  return job;
}

export function cachedThumb(fp) {
  return run('thumbs', 'readonly', (s) => s.get(fp)).catch(() => null);
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
