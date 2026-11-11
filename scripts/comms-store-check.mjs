import http from 'node:http';
import { createReadStream, statSync, rmSync, mkdtempSync } from 'node:fs';
import { join, extname, normalize, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import puppeteer from 'puppeteer-core';

const BUILD = process.argv[2];
if (!BUILD) { console.log('usage: node scripts/comms-store-check.mjs <build dir>'); process.exit(2); }
const PORT = Number(process.env.STORE_PORT) || 8091;
const ORIGIN = 'http://127.0.0.1:' + PORT;
const PROFILE = mkdtempSync(join(tmpdir(), 'comms-store-check-'));
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

const PAGE_TESTS = async () => {
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
  const swapEnc = async (name, store, a, b) => {
    const db = await openRaw(name);
    await new Promise((res, rej) => {
      const tx = db.transaction(store, 'readwrite');
      const st = tx.objectStore(store);
      const ra = st.get(a);
      const rb = st.get(b);
      rb.onsuccess = () => { const x = ra.result, y = rb.result; const e = x.enc; x.enc = y.enc; y.enc = e; st.put(x); st.put(y); };
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  };
  const S = await import('/assets/js/comms/store.js');
  const A = new Uint8Array(32).fill(7);
  const B = new Uint8Array(32).fill(9);
  const msg = (i) => ({ id: 'c' + i, threadId: 'dm-1', from: 'fpS', ts: i, t: 'secret words ' + i, parts: [{ type: 'text', text: 'secret words ' + i }], v: 2 });
  const loadScript = (src) => new Promise((res, rej) => { const el = document.createElement('script'); el.src = src; el.onload = res; el.onerror = () => rej(new Error('load ' + src)); document.head.append(el); });
  const identity = { locked: false };
  window.MentriaIdentity = { isSetUp: () => true, isUnlocked: () => !identity.locked, getSecret: () => { if (identity.locked) throw new Error('locked'); return A; } };
  window.mentriaConfirm = async () => true;
  await loadScript('/assets/js/mentria-store.js');
  await loadScript('/assets/js/mentria-backup.js');
  const PASS = 'correct horse battery staple';
  const seedHistory = async (n) => { const s = await S.openStore(A); await s.wipe(); await s.putThread({ id: 'dm-1', kind: 'dm', title: 'Sam', participants: [], meta: { fp: 'fpS' }, updatedAt: 0, lastReadTs: 0, pinned: false }); for (let i = 1; i <= n; i++) await s.putMessage(msg(i)); s.close(); };
  const emptyStore = async () => { const s = await S.openStore(A); await s.wipe(); s.close(); };
  const fileOf = (sealed) => new File([sealed.blob], 'backup.json', { type: 'application/json' });

  test('round trip', async () => { let s = await S.openStore(A); await s.putThread({ id: 'dm-1', kind: 'dm', title: 'Sam', participants: [], meta: {}, updatedAt: 1, lastReadTs: 0, pinned: false }); ok(await s.putMessage(msg(10))); s.close(); s = await S.openStore(A); eq((await s.listMessages('dm-1'))[0].t, 'secret words 10'); eq((await s.listThreads())[0].preview, 'secret words 10'); });
  test('ciphertext at rest', async () => { const raw = await rawDump('mentria-comms'); no(raw.includes('secret words')); no(raw.includes('Sam')); });
  test('dedupe', async () => { const s = await S.openStore(A); eq(await s.putMessage(msg(10)), false); eq((await s.listMessages('dm-1')).length, 1); });
  test('replace', async () => { const s = await S.openStore(A); ok(await s.putMessage({ ...msg(10), t: 'edited' }, { replace: true })); eq((await s.listMessages('dm-1'))[0].t, 'edited'); });
  test('saving a thread again keeps its activity and preview', async () => { const s = await S.openStore(A); await s.putThread({ id: 'dm-1', kind: 'dm', title: 'Sam', participants: [], meta: {}, updatedAt: 1, lastReadTs: 0, pinned: false }); const t = await s.getThread('dm-1'); eq(t.updatedAt, 10); eq(t.preview, 'edited'); eq(t.title, 'Sam'); });
  test('paging', async () => { const s = await S.openStore(A); for (let i = 100; i < 550; i++) await s.putMessage(msg(i)); const page = await s.listMessages('dm-1', { limit: 200 }); eq(page.length, 200); eq(page[199].ts, 549); const prev = await s.listMessages('dm-1', { before: page[0].ts, limit: 200 }); eq(prev[199].ts, page[0].ts - 1); });
  test('swapped ciphertext is skipped', async () => { await swapEnc('mentria-comms', 'messages', 'c100', 'c101'); const s = await S.openStore(A); const ids = (await s.listMessages('dm-1', { limit: 1000 })).map((m) => m.id); no(ids.includes('c100')); ok(s.skipped >= 1); });
  test('foreign secret', async () => { const s = await S.openStore(B); eq(s.status, 'foreign'); await rejects(s.listMessages('dm-1'), 'foreign'); await s.wipe(); eq(s.status, 'open'); eq((await s.listThreads()).length, 0); });
  test('unavailable', async () => { const real = indexedDB.open; indexedDB.open = () => { throw new DOMException('no', 'InvalidStateError'); }; try { eq(await S.storeAvailable(), false); await rejects(S.openStore(A), 'unavailable'); } finally { indexedDB.open = real; } });
  test('quota', async () => { const s = await S.openStore(B); const real = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function () { throw new DOMException('full', 'QuotaExceededError'); }; try { await rejects(s.putMessage(msg(9999)), 'quota'); } finally { IDBObjectStore.prototype.put = real; } });

  test('backup: history survives export and restore', async () => { await seedHistory(3); const sealed = await MentriaBackup.exportFull(PASS, {}); await emptyStore(); const data = await MentriaBackup.readBackupFile(fileOf(sealed), PASS); const res = await MentriaBackup.applyRestore(data, {}); const s = await S.openStore(A); eq((await s.listMessages('dm-1')).length, 3); eq((await s.getThread('dm-1')).title, 'Sam'); s.close(); ok(res.restored >= 4); });
  test('backup: a locked identity leaves history out', async () => { identity.locked = true; try { const prepared = await MentriaBackup.prepareBackup(); ok((prepared.lockedAreas || []).includes('comms_history')); no(prepared.areas.some((a) => a.area === 'comms_history')); } finally { identity.locked = false; } });
  test('backup: restoring while locked skips history and says so', async () => { await seedHistory(2); const sealed = await MentriaBackup.exportFull(PASS, {}); await emptyStore(); identity.locked = true; let res = null; try { res = await MentriaBackup.applyRestore(await MentriaBackup.readBackupFile(fileOf(sealed), PASS), {}); } finally { identity.locked = false; } ok((res.lockedAreas || []).includes('comms_history')); const s = await S.openStore(A); eq((await s.listMessages('dm-1')).length, 0); s.close(); });

  const DV = await import('/assets/js/comms/devices.js');
  const SGN = await import('/assets/js/comms/sign.js');
  const DKM = await import('/assets/js/comms/devkey.js');
  await import('/assets/js/mentria-sync.js');
  const fakeDevice = async (name, kind) => {
    const s = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const d = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const sj = await crypto.subtle.exportKey('jwk', s.publicKey);
    const dj = await crypto.subtle.exportKey('jwk', d.publicKey);
    const spub = { x: sj.x, y: sj.y };
    const sigFp = await SGN.sigFingerprint(spub);
    return { me: { sign: { spub, signKey: s.privateKey, sigFp }, dh: { pub: { x: dj.x, y: dj.y } } }, entry: { sigFp, spub, dh: { x: dj.x, y: dj.y }, name, kind, added: Date.now() } };
  };
  test('sync: comms.devices conflicts merge without the replace prompt', async () => {
    const A = await fakeDevice('Mac', 'mac');
    const B = await fakeDevice('iPhone', 'iphone');
    const C = await fakeDevice('iPad', 'ipad');
    const base = await DV.makeGenesis(A.me, A.entry);
    const mine = await DV.withDevice(base, A.me, B.entry);
    const theirs = await DV.withDevice(base, A.me, C.entry);
    MentriaStore.set('comms', 'devices', mine, { mtime: Date.now() - 5000 });
    let asked = 0;
    const real = window.mentriaConfirm;
    window.mentriaConfirm = async () => { asked++; return false; };
    try {
      await MentriaSync.applySnapshot({ v: 2, data: { store: { 'comms.devices': JSON.stringify(theirs) } }, meta: { 'comms.devices': Date.now() + 1000 } });
    } finally { window.mentriaConfirm = real; }
    eq(asked, 0);
    const got = MentriaStore.get('comms', 'devices');
    eq(got.needsSign, true);
    eq(got.devices.length, 3);
    const newer = await DV.resign(got, A.me);
    await MentriaSync.applySnapshot({ v: 2, data: { store: { 'comms.devices': JSON.stringify(mine) } }, meta: { 'comms.devices': Date.now() + 2000 } });
    MentriaStore.set('comms', 'devices', newer);
    await MentriaSync.applySnapshot({ v: 2, data: { store: { 'comms.devices': JSON.stringify(mine) } }, meta: { 'comms.devices': Date.now() + 3000 } });
    eq(MentriaStore.get('comms', 'devices').ver, newer.ver);
    eq(asked, 0);
  });
  test('sync: comms.devkey never leaves the device', async () => {
    const me = await DKM.ensureDeviceKeys();
    const rec = MentriaStore.get('comms', 'devkey');
    ok(rec && rec.sign);
    const dump = MentriaStore.exportAll();
    no('comms.devkey' in (dump.store || {}));
    no(JSON.stringify(dump).includes(rec.sign.wrapped.ct));
    const other = Object.assign({}, rec, { created: 1, sign: Object.assign({}, rec.sign, { pub: { x: 'X', y: 'Y' } }) });
    await MentriaSync.applySnapshot({ v: 2, data: { store: { 'comms.devkey': JSON.stringify(other) } }, meta: { 'comms.devkey': Date.now() + 9000 } });
    eq(MentriaStore.get('comms', 'devkey').sign.pub.x, rec.sign.pub.x);
    eq((await DKM.ensureDeviceKeys()).sign.sigFp, me.sign.sigFp);
  });

  const out = [];
  for (const [name, fn] of tests) {
    try { await fn(); out.push({ name, ok: true }); } catch (e) { out.push({ name, ok: false, err: String(e && e.message || e) }); }
  }
  return out;
};

const server = await serve(BUILD, PORT);
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, userDataDir: PROFILE, args: ['--no-first-run', '--no-default-browser-check'] });
let results = [];
try {
  const page = await browser.newPage();
  await page.goto(ORIGIN + '/manifest.json');
  results = await page.evaluate(PAGE_TESTS).catch((e) => [{ name: 'load the store module', ok: false, err: String(e && e.message || e).split('\n')[0] }]);
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
console.log('comms store: ' + (results.length - failed) + '/' + results.length + ' passed');
process.exit(failed || !results.length ? 1 : 0);
