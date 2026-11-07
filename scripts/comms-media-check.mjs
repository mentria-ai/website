import http from 'node:http';
import { createReadStream, statSync, rmSync, mkdtempSync } from 'node:fs';
import { join, extname, normalize, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import puppeteer from 'puppeteer-core';

const BUILD = process.argv[2];
if (!BUILD) { console.log('usage: node scripts/comms-media-check.mjs <build dir>'); process.exit(2); }
const PORT = Number(process.env.MEDIA_PORT) || 8095;
const ORIGIN = 'http://127.0.0.1:' + PORT;
const PROFILE = mkdtempSync(join(tmpdir(), 'comms-media-check-'));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.txt': 'text/plain' };

function serve(dir, port) {
  const root = resolve(dir);
  const server = http.createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://local').pathname);
    let file = normalize(join(root, path));
    if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
    try {
      if (statSync(file).isDirectory()) file = join(file, 'index.html');
      statSync(file);
    } catch (_) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    createReadStream(file).pipe(res);
  });
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok(server)));
}

const HELPERS = `
  const tests = [];
  const test = (name, fn) => tests.push([name, fn]);
  const fail = (msg) => { throw new Error(msg); };
  const ok = (v, m) => { if (!v) fail(m || 'expected a true value'); };
  const no = (v, m) => { if (v) fail(m || 'expected a false value'); };
  const eq = (a, b) => { if (a !== b) fail('expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); };
  const rejects = async (p, code) => {
    let err = null;
    try { await p; } catch (e) { err = e; }
    if (!err) fail('expected a rejection with ' + code);
    if (err.code !== code) fail('expected code ' + code + ', got ' + (err.code || err.name || err.message));
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const openRaw = (name) => new Promise((res, rej) => { const r = indexedDB.open(name); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const all = (db, store) => new Promise((res, rej) => { const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const b64 = (v) => { const u = v instanceof ArrayBuffer ? new Uint8Array(v) : new Uint8Array(v.buffer, v.byteOffset, v.byteLength); let s = ''; for (const c of u) s += String.fromCharCode(c); return btoa(s); };
  const rawDump = async (name) => {
    const db = await openRaw(name);
    const out = {};
    for (const store of db.objectStoreNames) out[store] = await all(db, store);
    db.close();
    return JSON.stringify(out, (k, v) => (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) ? b64(v) : v);
  };
  const MARK = new TextEncoder().encode('PLAINTEXT-MARK');
  const bytes = (n, seed) => { const out = new Uint8Array(n); let x = seed * 2654435761 >>> 0; for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) >>> 0; out[i] = x >>> 24; } for (let i = 0; i + MARK.length <= n; i += 65536) out.set(MARK, i); return out; };
  const hex = (u) => { let h = ''; for (let i = 0; i < u.length; i++) h += u[i].toString(16).padStart(2, '0'); return h.length > 80 ? h.length + ':' + h.slice(0, 40) + h.slice(-40) : h; };
  const opfsFile = async (path) => { let d = await navigator.storage.getDirectory(); const parts = path.split('/'); for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p); return (await d.getFileHandle(parts[parts.length - 1])).getFile(); };
  const opfsText = async (path) => new TextDecoder('latin1').decode(await (await opfsFile(path)).arrayBuffer());
  const opfsExists = async (path) => { try { await opfsFile(path); return true; } catch (_) { return false; } };
  const ID1 = 'AQEBAQEBAQEBAQEBAQEBAQ';
  const ID2 = 'AgICAgICAgICAgICAgICAg';
  const ID3 = 'AwMDAwMDAwMDAwMDAwMDAw';
  const ID4 = 'BAQEBAQEBAQEBAQEBAQEBA';
  const ID5 = 'BQUFBQUFBQUFBQUFBQUFBQ';
`;

const PAGE_TESTS = new Function('HELPERS', `return (async () => {
  ${HELPERS}
  const S = await import('/assets/js/comms/store.js');
  const M = await import('/assets/js/comms/media.js');
  const MF = await M.ensureFormat();
  const A = new Uint8Array(32).fill(7);
  const PIECE = 262144;
  const inRec = (id, n, threadId = 'dm-1') => ({ id, threadId, role: 'in', state: 'moving', complete: false, updatedAt: Date.now(), name: 'c.bin', mime: 'application/octet-stream', size: (n - 1) * PIECE + 1000, pieceSize: PIECE, hashes: '', mh: '', have: MF.bfB64(MF.bfNew(n)) });
  const markHave = async (s, id, list) => { const rec = await s.getMedia(id); const n = MF.pieceCount(rec.size); const bf = MF.bfFrom(rec.have, n); list.forEach((i) => MF.bfSet(bf, i)); rec.have = MF.bfB64(bf); await s.putMedia(rec); };
  const bits = (rec) => { const n = MF.pieceCount(rec.size); const bf = MF.bfFrom(rec.have, n); let s = ''; for (let i = 0; i < n; i++) s += MF.bfHas(bf, i) ? '1' : '0'; return s; };
  const fromB64 = (s) => { const raw = atob(s); const all = Uint8Array.from(raw, (c) => c.charCodeAt(0)); const out = []; for (let i = 0; i < all.length; i += 32) out.push(all.subarray(i, i + 32)); return out; };

  test('round trip over three pieces', async () => { const s = await S.openStore(A); const m = await M.openMedia(s); const f = new File([bytes(600000, 1)], 'a.bin'); const r = await m.importFile(f, { threadId: 'dm-1', id: ID1 }); eq(r.hashes.length, 3); eq(hex(await m.readPiece(ID1, 2)), hex(bytes(600000, 1).slice(524288))); });
  test('ciphertext at rest', async () => { await sleep(1800); ok(!(await opfsText('comms-media/' + ID1 + '.bin')).includes('PLAINTEXT-MARK')); ok(!(await rawDump('mentria-comms')).includes('a.bin')); });
  test('manifest hash is stable', async () => { const s = await S.openStore(A); const rec = await s.getMedia(ID1); eq(rec.mh, await MF.manifestHash(fromB64(rec.hashes))); });
  test('resume keeps the bitfield', async () => { let s = await S.openStore(A); let m = await M.openMedia(s); await s.putMedia(inRec(ID2, 4)); await m.writePiece(ID2, 0, bytes(262144, 2)); await m.writePiece(ID2, 3, bytes(1000, 3)); await markHave(s, ID2, [0, 3]); s.close(); s = await S.openStore(A); eq(bits(await s.getMedia(ID2)), '1001'); });
  test('the IndexedDB fallback works the same', async () => { const s = await S.openStore(A); const m = await M.openMedia(s, { noSync: true }); eq(m.sync, false); await m.importFile(new File([bytes(300000, 4)], 'b.bin'), { threadId: 'dm-1', id: ID3 }); eq(hex(await m.readPiece(ID3, 1)), hex(bytes(300000, 4).slice(262144))); });
  test('quota', async () => { const s = await S.openStore(A); const m = await M.openMedia(s); await setQuota((await navigator.storage.estimate()).usage + 100000); try { await rejects(m.writePiece(ID5, 0, bytes(262144, 5)), 'quota'); } finally { await setQuota(null); } });
  test('remove', async () => { const s = await S.openStore(A); const m = await M.openMedia(s); await m.removeFiles([ID1]); await s.deleteMedia([ID1]); no(await opfsExists('comms-media/' + ID1 + '.bin')); eq(await s.getMedia(ID1), null); });
  test('deleteThread returns its media', async () => { const s = await S.openStore(A); await s.putMedia(inRec(ID4, 1, 'dm-9')); eq((await s.deleteThread('dm-9')).join(), ID4); });
  test('a locked worker refuses', async () => { const s = await S.openStore(A); const m = await M.openMedia(s); m.forget(); await rejects(m.readPiece(ID3, 0), 'locked'); });

  let media = null;
  const swReady = async () => { if (!media) media = await M.openMedia(await S.openStore(A)); await navigator.serviceWorker.ready; ok(!!navigator.serviceWorker.controller, 'no controlling service worker'); };
  test('sw: whole file', async () => { await swReady(); const b = await (await fetch('/comms-media/' + ID3)).arrayBuffer(); eq(hex(new Uint8Array(b)), hex(bytes(300000, 4))); });
  test('sw: a range across a piece edge', async () => { await swReady(); const r = await fetch('/comms-media/' + ID3, { headers: { Range: 'bytes=262100-262299' } }); eq(r.status, 206); eq(r.headers.get('content-range'), 'bytes 262100-262299/300000'); eq(hex(new Uint8Array(await r.arrayBuffer())), hex(bytes(300000, 4).slice(262100, 262300))); });
  test('sw: download name', async () => { await swReady(); ok(((await fetch('/comms-media/' + ID3 + '?dl=1')).headers.get('content-disposition') || '').includes('b.bin')); });
  test('sw: an incomplete file is 404', async () => { await swReady(); eq((await fetch('/comms-media/' + ID2)).status, 404); });
  test('sw: a restarted worker asks for the key again', async () => { await swReady(); await stopServiceWorkers(); eq((await fetch('/comms-media/' + ID3)).status, 200); });
  test('sw: forget means 403', async () => { await swReady(); media.forget(); await sleep(100); eq((await fetch('/comms-media/' + ID3)).status, 403); });

  const out = [];
  for (const [name, fn] of tests) {
    try { await fn(); out.push({ name, ok: true }); } catch (e) { out.push({ name, ok: false, err: String(e && e.message || e) }); }
  }
  return out;
})();`);

const V1_TEST = new Function('HELPERS', `return (async () => {
  ${HELPERS}
  const te = new TextEncoder();
  const A = new Uint8Array(32).fill(7);
  const base = await crypto.subtle.importKey('raw', A, 'HKDF', false, ['deriveKey']);
  const wrap = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: te.encode('mentria-comms-store-v1'), info: te.encode('wrap') }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const seal = async (key, data, ad) => { const iv = crypto.getRandomValues(new Uint8Array(12)); return { iv, ct: new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(ad) }, key, data)) }; };
  const wrapped = await seal(wrap, raw, 'meta|storeKey');
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
  const db = await new Promise((res, rej) => { const r = indexedDB.open('mentria-comms', 1); r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('meta', { keyPath: 'k' }); d.createObjectStore('threads', { keyPath: 'id' }).createIndex('updatedAt', 'updatedAt'); d.createObjectStore('messages', { keyPath: 'id' }).createIndex('thread_ts', ['threadId', 'ts']); d.createObjectStore('thumbs', { keyPath: 'hash' }).createIndex('threadId', 'threadId'); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const msgEnc = await seal(key, te.encode(JSON.stringify({ from: 'self', t: 'old words', parts: [{ type: 'text', text: 'old words' }], v: 2 })), 'messages|old-1');
  const thrEnc = await seal(key, te.encode(JSON.stringify({ title: 'Old', participants: [], meta: {}, preview: 'old words' })), 'threads|dm-1');
  await new Promise((res, rej) => { const tx = db.transaction(['meta', 'threads', 'messages'], 'readwrite'); tx.objectStore('meta').put({ k: 'storeKey', v: 1, iv: wrapped.iv, ct: wrapped.ct }); tx.objectStore('threads').put({ id: 'dm-1', kind: 'dm', updatedAt: 5, lastReadTs: 0, pinned: false, enc: thrEnc }); tx.objectStore('messages').put({ id: 'old-1', threadId: 'dm-1', ts: 5, enc: msgEnc }); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  db.close();
  const S = await import('/assets/js/comms/store.js');
  test('v1 data survives the upgrade', async () => { const s = await S.openStore(A); eq((await s.listMessages('dm-1')).length, 1); eq((await s.listMessages('dm-1'))[0].t, 'old words'); eq(await s.getMedia('nothing'), null); s.close(); });
  const out = [];
  for (const [name, fn] of tests) {
    try { await fn(); out.push({ name, ok: true }); } catch (e) { out.push({ name, ok: false, err: String(e && e.message || e) }); }
  }
  return out;
})();`);

const server = await serve(BUILD, PORT);
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, userDataDir: PROFILE, args: ['--no-first-run', '--no-default-browser-check'] });
let results = [];
try {
  const page = await browser.newPage();
  const cdp = await page.createCDPSession();
  await page.exposeFunction('setQuota', async (bytes) => { await cdp.send('Storage.overrideQuotaForOrigin', bytes == null ? { origin: ORIGIN } : { origin: ORIGIN, quotaSize: bytes }); return true; });
  await cdp.send('ServiceWorker.enable');
  await page.exposeFunction('stopServiceWorkers', async () => { await cdp.send('ServiceWorker.stopAllWorkers'); await new Promise((r) => setTimeout(r, 300)); return true; });
  await page.goto(ORIGIN + '/about/');
  for (let i = 0; i < 3; i++) {
    const controlled = await page.waitForFunction(() => !!navigator.serviceWorker.controller, { timeout: 60000 }).then(() => true, () => false);
    if (controlled) break;
    await page.reload();
  }
  results = await page.evaluate(PAGE_TESTS, HELPERS).catch((e) => [{ name: 'load the media modules', ok: false, err: String(e && e.message || e).split('\n')[0] }]);
  const ctx = await browser.createBrowserContext();
  const fresh = await ctx.newPage();
  await fresh.goto(ORIGIN + '/manifest.json');
  results = results.concat(await fresh.evaluate(V1_TEST, HELPERS).catch((e) => [{ name: 'v1 data survives the upgrade', ok: false, err: String(e && e.message || e).split('\n')[0] }]));
  await ctx.close();
} finally {
  await browser.close();
  server.close();
  rmSync(PROFILE, { recursive: true, force: true });
}
let failed = 0;
for (const r of results) {
  if (r.ok) console.log('PASS ' + r.name);
  else { failed++; console.log('FAIL ' + r.name + ': ' + r.err); }
}
console.log('comms media: ' + (results.length - failed) + '/' + results.length + ' passed');
process.exit(failed || !results.length ? 1 : 0);
