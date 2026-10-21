import http from 'node:http';
import { createReadStream, statSync, rmSync } from 'node:fs';
import { join, extname, normalize, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import puppeteer from 'puppeteer-core';

const BUILD = process.argv[2];
if (!BUILD) { console.log('usage: node scripts/unlock-runtime-check.mjs <beta build dir>'); process.exit(2); }
const PORT = 8096;
const ORIGIN = 'http://localhost:' + PORT;
const PROFILE = join(tmpdir(), 'unlock-runtime-check-profile');
const MODULE = '/assets/js/mentria-unlock.js';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.txt': 'text/plain', '.xml': 'application/xml', '.ico': 'image/x-icon', '.pdf': 'application/pdf'
};

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

rmSync(PROFILE, { recursive: true, force: true });
const server = await serve(BUILD, PORT);
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  userDataDir: PROFILE,
  protocolTimeout: 180000,
  args: ['--no-first-run', '--no-default-browser-check']
});

const checks = [];
const check = (name, fn) => checks.push([name, fn]);
const pageLog = new WeakMap();

function assert(cond, msg, extra) {
  if (!cond) throw new Error(msg + (extra === undefined ? '' : ' ' + JSON.stringify(extra)));
}

async function open(path) {
  const page = await browser.newPage();
  const log = { requests: [], errors: [], console: [] };
  pageLog.set(page, log);
  page.on('request', (r) => log.requests.push(r.url()));
  page.on('pageerror', (e) => log.errors.push(String(e && e.message || e)));
  page.on('console', (m) => log.console.push(m.type() + ': ' + m.text()));
  await page.goto(ORIGIN + path, { waitUntil: 'load' });
  return page;
}

async function go(page, path) {
  await page.goto(ORIGIN + path, { waitUntil: 'load' });
}

async function closeAll() {
  for (const p of await browser.pages()) await p.close();
}

async function clean() {
  await closeAll();
  const blank = await browser.newPage();
  const s = await blank.createCDPSession();
  await s.send('Storage.clearDataForOrigin', { origin: ORIGIN, storageTypes: 'all' });
  await s.detach();
  await blank.close();
}

async function runtime(page) {
  await page.waitForFunction(() => document.readyState === 'complete');
  return page.evaluate(async (url) => {
    window.__m = await import(url);
    await window.__m.ready();
    return window.__m.state();
  }, MODULE);
}

async function bootLoaded(page) {
  return page.evaluate((url) => performance.getEntriesByType('resource').some((e) => new URL(e.name).pathname === url), MODULE);
}

async function databases(page) {
  return page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
}

async function enableOnLab(page) {
  await page.waitForSelector('#unlock-switch');
  const on = await page.$eval('#unlock-switch', (el) => el.checked);
  if (!on) await page.click('#unlock-switch');
  await page.waitForFunction(() => {
    try { return JSON.parse(localStorage.getItem('mentria.keyring.local')).enabled === true; } catch (_) { return false; }
  });
}

async function createOnLab(page) {
  await page.click('#unlock-create');
  await page.waitForFunction(() => (document.getElementById('unlock-code').textContent || '').replace(/[^A-Z2-7]/g, '').length === 32, { timeout: 15000 });
  return page.$eval('#unlock-code', (el) => el.textContent.trim());
}

async function clickCall(page, expr) {
  await page.evaluate((src) => {
    const old = document.getElementById('t-call');
    if (old) old.remove();
    const b = document.createElement('button');
    b.id = 't-call';
    b.type = 'button';
    b.textContent = 'call';
    b.style.cssText = 'position:fixed;top:0;left:0;z-index:2147483647;width:80px;height:40px';
    const fn = new Function('m', 'return (' + src + ')(m);');
    b.addEventListener('click', () => {
      window.__r = null;
      Promise.resolve().then(() => fn(window.__m)).then(
        (v) => { window.__r = { ok: true, v: v === undefined ? null : v }; },
        (e) => { window.__r = { ok: false, e: String(e && (e.message || e.name) || e) }; }
      );
    });
    document.body.appendChild(b);
  }, expr);
  await page.click('#t-call');
  await page.waitForFunction(() => window.__r, { timeout: 60000 });
  return page.evaluate(() => window.__r);
}

function readLocal(page, key) {
  return page.evaluate((k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } }, key);
}

let code = null;
let pageA = null;

check('gate off without the tester switch', async () => {
  await clean();
  const lab = await open('/beta/unlock/');
  assert(await lab.evaluate(() => document.documentElement.dataset.release) === 'beta', 'lab page is not a beta build');
  await lab.evaluate(() => localStorage.setItem('mentria.store.keyring.vault', JSON.stringify({ v: 1, id: 'x', kcv: 'y' })));
  const about = await open('/about/');
  await about.waitForFunction(() => document.readyState === 'complete');
  await new Promise((r) => setTimeout(r, 300));
  assert(!(await bootLoaded(about)), 'bootstrap loaded the runtime without the tester switch');
  const s = await runtime(about);
  const r = await about.evaluate(() => ({ enabled: window.__m.enabled(), unlocked: window.__m.state().unlocked }));
  assert(r.enabled === false && s.enabled === false && r.unlocked === false, 'enabled() should be false', r);
  const dbs = await databases(about);
  assert(!dbs.includes('mentria-keyring'), 'ready() created the keyring database', dbs);
  await about.evaluate(() => {
    localStorage.removeItem('mentria.store.keyring.vault');
    localStorage.setItem('mentria.keyring.local', JSON.stringify({ enabled: true }));
  });
  const tools = await open('/tools/');
  await tools.waitForFunction(() => document.readyState === 'complete');
  await new Promise((r) => setTimeout(r, 300));
  assert(!(await bootLoaded(tools)), 'bootstrap loaded the runtime with no keyring record');
  assert(!(await databases(tools)).includes('mentria-keyring'), 'keyring database exists with no record');
});

check('create then unlock with code', async () => {
  await clean();
  pageA = await open('/beta/unlock/');
  await enableOnLab(pageA);
  code = await createOnLab(pageA);
  assert(/^([A-Z2-7]{4}-){7}[A-Z2-7]{4}$/.test(code), 'code format', code);
  await runtime(pageA);
  const r = await pageA.evaluate(async (code) => {
    const m = window.__m;
    const out = { afterCreate: m.state() };
    const rec = JSON.parse(localStorage.getItem('mentria.store.keyring.vault'));
    out.recordOk = !!rec && rec.v === 1 && typeof rec.kcv === 'string' && !!rec.devices[m.deviceId()];
    out.local = JSON.parse(localStorage.getItem('mentria.keyring.local'));
    await m.lock();
    out.afterLock = m.state();
    out.secretLocked = await m.secret('identity');
    try { await m.link('identity', new Uint8Array(32)); out.linkLocked = 'no error'; } catch (e) { out.linkLocked = e.message; }
    try { await m.unlockWithCode('AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA'); out.wrong = 'no error'; } catch (e) { out.wrong = e.message; }
    await m.unlockWithCode(code.toLowerCase());
    out.afterUnlock = m.state();
    out.nothingLinked = await m.secret('identity');
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    await m.link('identity', bytes);
    const back = await m.secret('identity');
    out.same = !!back && back.length === 32 && back.every((b, i) => b === bytes[i]);
    out.linked = m.state().linked;
    const db = await new Promise((res, rej) => { const q = indexedDB.open('mentria-keyring', 1); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    const sess = await new Promise((res) => { const g = db.transaction('session').objectStore('session').get('current'); g.onsuccess = () => res(g.result); });
    db.close();
    out.session = sess ? { epoch: sess.epoch, kcv: sess.kcv === rec.kcv, isKey: sess.root instanceof CryptoKey, extractable: sess.root.extractable } : null;
    out.epoch = Number(localStorage.getItem('mentria.keyring.epoch'));
    return out;
  }, code);
  assert(r.afterCreate.setUp && r.afterCreate.unlocked && r.afterCreate.enabled, 'create opens the session', r.afterCreate);
  assert(r.recordOk, 'record written with this device');
  assert(typeof r.local.deviceId === 'string' && r.local.deviceId.length > 10, 'deviceId stored locally', r.local);
  assert(!r.afterLock.unlocked, 'lock() locks', r.afterLock);
  assert(r.secretLocked === null, 'secret() is null while locked');
  assert(r.linkLocked === 'locked', 'link() throws locked', r.linkLocked);
  assert(r.wrong === 'bad-code', 'wrong code throws bad-code', r.wrong);
  assert(r.afterUnlock.unlocked, 'unlockWithCode unlocks', r.afterUnlock);
  assert(r.nothingLinked === null, 'secret() null when nothing is linked');
  assert(r.same, 'link then secret returns the same bytes');
  assert(JSON.stringify(r.linked) === '["identity"]', 'state().linked', r.linked);
  assert(r.session && r.session.kcv && r.session.isKey && r.session.extractable === false && r.session.epoch === r.epoch, 'session record shape', r.session);
  await pageA.click('#unlock-lock');
  await pageA.waitForFunction(() => !window.__m.state().unlocked);
  await pageA.evaluate((c) => window.__m.unlockWithCode(c), code);
});

check('two tabs share unlock and lock', async () => {
  await pageA.evaluate(() => window.__m.lock());
  const pageB = await open('/about/');
  await pageB.waitForFunction((url) => performance.getEntriesByType('resource').some((e) => new URL(e.name).pathname === url), {}, MODULE);
  const sB = await runtime(pageB);
  assert(!sB.unlocked, 'second tab starts locked', sB);
  assert(sB.launch === 'continue', 'second tab continues (another page is live)', sB.launch);
  await pageB.evaluate(() => { window.__changes = []; window.__m.onChange((s) => window.__changes.push(s.unlocked)); });
  await pageA.evaluate((c) => window.__m.unlockWithCode(c), code);
  await pageB.waitForFunction(() => window.__m.state().unlocked === true, { timeout: 5000 });
  const secretB = await pageB.evaluate(async () => { const s = await window.__m.secret('identity'); return s ? s.length : null; });
  assert(secretB === 32, 'second tab reads the linked secret without asking', secretB);
  await pageB.evaluate(() => window.__m.lock());
  await pageA.waitForFunction(() => window.__m.state().unlocked === false, { timeout: 5000 });
  const changes = await pageB.evaluate(() => window.__changes);
  assert(changes.includes(true) && changes[changes.length - 1] === false, 'onChange saw unlock then lock', changes);
  assert(await pageA.evaluate(async () => (await window.__m.secret('identity')) === null), 'first tab drops the secret after lock');
  await pageB.close();
});

check('reload continues the session', async () => {
  await pageA.evaluate((c) => window.__m.unlockWithCode(c), code);
  const before = await readLocal(pageA, 'mentria.keyring.epoch');
  await pageA.reload({ waitUntil: 'load' });
  await pageA.waitForFunction((url) => performance.getEntriesByType('resource').some((e) => new URL(e.name).pathname === url), {}, MODULE);
  const s = await runtime(pageA);
  const d = await pageA.evaluate(() => window.__m.diagnostics());
  assert(s.unlocked && s.launch === 'continue', 'reload keeps the session', s);
  assert(d.liveOther === false && !!d.marker && d.seenAgeMs < 60000 && d.decision === 'continue' && d.navType === 'reload', 'reload decided by marker and seen', d);
  assert(await readLocal(pageA, 'mentria.keyring.epoch') === before, 'epoch unchanged on reload');
  const r = await pageA.evaluate(async (c) => {
    const m = window.__m;
    const out = { rootBefore: m.hasRootBytes() };
    try { await m.addPasskey('x'); out.add = 'no error'; } catch (e) { out.add = e.message; }
    try { await m.regenerateCode(); out.regen = 'no error'; } catch (e) { out.regen = e.message; }
    await m.confirmWithCode(c);
    out.rootAfter = m.hasRootBytes();
    out.unlocked = m.state().unlocked;
    return out;
  }, code);
  assert(r.rootBefore === false && r.add === 'confirm-needed' && r.regen === 'confirm-needed', 'actions that need R ask for a confirm after reload', r);
  assert(r.rootAfter && r.unlocked, 'confirmWithCode brings R back', r);
});

check('new page while another is open continues', async () => {
  const pageC = await open('/tools/');
  await pageC.waitForFunction((url) => performance.getEntriesByType('resource').some((e) => new URL(e.name).pathname === url), {}, MODULE);
  const s = await runtime(pageC);
  const d = await pageC.evaluate(() => window.__m.diagnostics());
  assert(s.unlocked && s.launch === 'continue', 'new tab continues the session', s);
  assert(d.liveOther === true && !d.marker && d.decision === 'continue', 'new tab decided by the live lock', d);
  await pageC.close();
});

check('closing every page then opening one relocks', async () => {
  const epoch0 = await readLocal(pageA, 'mentria.keyring.epoch');
  await go(pageA, '/robots.txt');
  await pageA.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('mentria.keyring.seen'));
    s.t = Date.now() - 61000;
    localStorage.setItem('mentria.keyring.seen', JSON.stringify(s));
  });
  await go(pageA, '/about/');
  const s1 = await runtime(pageA);
  const d1 = await pageA.evaluate(() => window.__m.diagnostics());
  const epoch1 = await readLocal(pageA, 'mentria.keyring.epoch');
  assert(!s1.unlocked && s1.launch === 'reopen', 'same tab after the grace relocks', s1);
  assert(d1.liveOther === false && !!d1.marker && d1.seenAgeMs > 60000 && d1.decision === 'reopen', 'decided by an old seen', d1);
  assert(epoch1 === epoch0 + 1, 'epoch bumped', { epoch0, epoch1 });
  const uiAsked = pageLog.get(pageA).requests.some((u) => u.includes('mentria-unlock-ui.js'));
  assert(!uiAsked, 'launch screen requested although askAtLaunch is off');
  await pageA.evaluate(async (c) => { window.__m.setAskAtLaunch(true); await window.__m.unlockWithCode(c); }, code);
  await closeAll();
  pageA = await open('/tools/');
  const s2 = await runtime(pageA);
  const d2 = await pageA.evaluate(() => window.__m.diagnostics());
  const epoch2 = await readLocal(pageA, 'mentria.keyring.epoch');
  assert(!s2.unlocked && s2.launch === 'reopen', 'a new page after closing every page relocks', s2);
  assert(d2.liveOther === false && !d2.marker && d2.decision === 'reopen', 'decided with no marker and nobody live', d2);
  assert(epoch2 === epoch1 + 1, 'epoch bumped again', { epoch1, epoch2 });
  let uiAsked2 = false;
  for (let i = 0; i < 30 && !uiAsked2; i++) {
    uiAsked2 = pageLog.get(pageA).requests.some((u) => u.includes('mentria-unlock-ui.js'));
    if (!uiAsked2) await new Promise((r) => setTimeout(r, 100));
  }
  assert(uiAsked2, 'launch screen module requested with askAtLaunch on');
  const errs = pageLog.get(pageA).errors.filter((e) => /unlock/i.test(e));
  assert(!errs.length, 'missing launch module raised an error', errs);
  const db = await pageA.evaluate(async () => {
    const d = await new Promise((res, rej) => { const q = indexedDB.open('mentria-keyring', 1); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    const sess = await new Promise((res) => { const g = d.transaction('session').objectStore('session').get('current'); g.onsuccess = () => res(g.result); });
    d.close();
    return sess || null;
  });
  assert(db === null, 'session record deleted on reopen');
});

check('passkey enrol and unlock', async () => {
  await clean();
  const page = await open('/beta/unlock/');
  const cdp = await page.createCDPSession();
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true }
  });
  await enableOnLab(page);
  const c = await createOnLab(page);
  await runtime(page);
  const support = await page.evaluate(() => window.__m.prfSupport());
  assert(['yes', 'unknown'].includes(support), 'prfSupport with a PRF authenticator', support);
  const add = await clickCall(page, "(m) => m.addPasskey('Test device')");
  assert(add.ok, 'addPasskey right after create', add);
  const rec = await readLocal(page, 'mentria.store.keyring.vault');
  const entry = rec.wraps.prf[0];
  assert(rec.wraps.prf.length === 1 && entry.label === 'Test device' && entry.id && entry.salt && entry.hkdf && entry.iv && entry.ct, 'prf wrap stored', entry);
  const creds = (await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials;
  assert(creds.length === 1 && creds[0].isResidentCredential && creds[0].rpId === 'localhost', 'resident credential for this host', creds.map((x) => ({ rp: x.rpId, rk: x.isResidentCredential })));
  const handle = Buffer.from(creds[0].userHandle, 'base64').toString('base64url');
  assert(handle === rec.id, 'user.id is the keyring id', { handle, id: rec.id });
  const credId = Buffer.from(creds[0].credentialId, 'base64').toString('base64url');
  assert(credId === entry.id, 'stored id is the credential id (base64url)');
  const st = await page.evaluate(() => ({ s: window.__m.state(), list: window.__m.passkeys() }));
  assert(st.s.passkeys === 1 && st.list.length === 1 && st.list[0].label === 'Test device' && st.list[0].id === entry.id, 'passkeys()', st);
  await page.evaluate(() => window.__m.lock());
  const un = await clickCall(page, '(m) => m.unlockWithPasskey()');
  assert(un.ok, 'unlockWithPasskey from a click', un);
  assert(await page.evaluate(() => window.__m.state().unlocked && window.__m.hasRootBytes()), 'unlocked with R in memory after the passkey');
  const again = await clickCall(page, "(m) => m.addPasskey('Second')");
  assert(!again.ok, 'excludeCredentials blocks the same authenticator twice', again);
  const rm = await page.evaluate(async (id) => {
    await window.__m.removePasskey(id);
    const r = JSON.parse(localStorage.getItem('mentria.store.keyring.vault'));
    return { entry: r.wraps.prf.find((e) => e.id === id), list: window.__m.passkeys(), count: window.__m.state().passkeys };
  }, entry.id);
  assert(rm.entry && rm.entry.removed && Object.keys(rm.entry).sort().join() === 'id,removed' && rm.list.length === 0 && rm.count === 0, 'removePasskey leaves a tombstone', rm);
  await page.evaluate(() => window.__m.lock());
  const none = await clickCall(page, '(m) => m.unlockWithPasskey()');
  assert(!none.ok && none.e === 'no-passkey', 'no live passkey', none);
  await page.evaluate((x) => window.__m.unlockWithCode(x), c);
  await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
});

check('passphrase, new code, backup key and remember this device', async () => {
  await clean();
  let page = await open('/beta/unlock/');
  await enableOnLab(page);
  const first = await createOnLab(page);
  await runtime(page);
  const r = await page.evaluate(async (oldCode) => {
    const m = window.__m;
    const out = {};
    const err = async (fn) => { try { await fn(); return 'no error'; } catch (e) { return e.message; } };
    out.weak = await err(() => m.setPassphrase('short'));
    await m.setPassphrase('correct horse battery');
    out.hasPass = m.state().hasPass;
    await m.lock();
    out.badPass = await err(() => m.unlockWithPassphrase('wrong passphrase here'));
    await m.unlockWithPassphrase('correct horse battery');
    out.passUnlocked = m.state().unlocked;
    out.confirmedBefore = m.state().codeConfirmed;
    const fresh = await m.regenerateCode();
    out.fresh = fresh;
    out.confirmedAfterNew = m.state().codeConfirmed;
    out.wrongLast4 = m.confirmCode('ZZZZ');
    out.rightLast4 = m.confirmCode(fresh.replace(/-/g, '').slice(-4).toLowerCase());
    out.confirmed = m.state().codeConfirmed;
    await m.lock();
    out.oldCode = await err(() => m.unlockWithCode(oldCode));
    await m.unlockWithCode(fresh);
    const bk = await m.backupKey();
    const rec = JSON.parse(localStorage.getItem('mentria.store.keyring.vault'));
    out.backup = bk && bk.key instanceof Uint8Array && bk.key.length === 32 && bk.salt === rec.backup.salt && bk.kcv === rec.kcv;
    out.retireUnlinked = m.retirement('identity').blockers;
    await m.link('identity', crypto.getRandomValues(new Uint8Array(32)));
    out.retireLinked = m.retirement('identity').blockers;
    await m.markRetired('identity');
    out.retired = !!JSON.parse(localStorage.getItem('mentria.store.keyring.vault')).retired.identity;
    await m.setPassphrase(null);
    const after = JSON.parse(localStorage.getItem('mentria.store.keyring.vault')).wraps.pass;
    out.passTomb = Object.keys(after).join() === 'removed' && !m.state().hasPass;
    await m.setRemember(true);
    out.hasDevice = m.state().hasDevice;
    return out;
  }, first);
  assert(r.weak === 'weak-pass' && r.hasPass && r.badPass === 'bad-pass' && r.passUnlocked, 'passphrase set and unlock', r);
  assert(r.confirmedBefore === false && /^([A-Z2-7]{4}-){7}[A-Z2-7]{4}$/.test(r.fresh) && r.fresh !== first, 'regenerateCode returns a new code', r);
  assert(r.confirmedAfterNew === false && r.wrongLast4 === false && r.rightLast4 === true && r.confirmed === true, 'confirmCode against the new code', r);
  assert(r.oldCode === 'bad-code', 'the old code stops unlocking', r.oldCode);
  assert(r.backup, 'backupKey matches the record');
  assert(r.retireUnlinked.includes('not-linked') && JSON.stringify(r.retireLinked) === '["too-recent"]' && r.retired, 'retirement and markRetired', r);
  assert(r.passTomb, 'removing the passphrase leaves a tombstone');
  assert(r.hasDevice, 'remember this device on');
  await closeAll();
  page = await open('/tools/');
  const s1 = await runtime(page);
  assert(s1.launch === 'reopen' && s1.unlocked && s1.hasDevice, 'remembered device unlocks silently after a reopen', s1);
  assert(await page.evaluate(() => window.__m.hasRootBytes()), 'device unlock keeps R in memory');
  await page.evaluate(() => window.__m.setRemember(false));
  await closeAll();
  page = await open('/tools/');
  const s2 = await runtime(page);
  assert(s2.launch === 'reopen' && !s2.unlocked && !s2.hasDevice, 'remember off relocks after a reopen', s2);
});

check('create fails cleanly when localStorage write fails', async () => {
  await clean();
  const page = await open('/beta/unlock/');
  await enableOnLab(page);
  await runtime(page);
  const r = await page.evaluate(async () => {
    const S = window.MentriaStore;
    const orig = S.set;
    S.set = () => false;
    let err = null;
    try { await window.__m.create({}); } catch (e) { err = e.message; }
    S.set = orig;
    const names = (await indexedDB.databases()).map((d) => d.name);
    let session = null;
    if (names.includes('mentria-keyring')) {
      const d = await new Promise((res, rej) => { const q = indexedDB.open('mentria-keyring', 1); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
      session = await new Promise((res) => { const g = d.transaction('session').objectStore('session').get('current'); g.onsuccess = () => res(g.result || null); });
      d.close();
    }
    return { err, session, record: localStorage.getItem('mentria.store.keyring.vault'), state: window.__m.state() };
  });
  assert(r.err === 'storage', 'create rejects with storage', r.err);
  assert(r.session === null, 'no IndexedDB session written');
  assert(r.record === null, 'no record written');
  assert(!r.state.setUp && !r.state.unlocked, 'state stays empty', r.state);
});

check('bfcache keeps working', async () => {
  await clean();
  const page = await open('/beta/unlock/');
  await enableOnLab(page);
  await createOnLab(page);
  await go(page, '/about/');
  await page.waitForFunction((url) => performance.getEntriesByType('resource').some((e) => new URL(e.name).pathname === url), {}, MODULE);
  const s0 = await runtime(page);
  assert(s0.unlocked, 'session open before navigating away', s0);
  await page.waitForFunction(() => !('serviceWorker' in navigator) || !!navigator.serviceWorker.controller, { timeout: 60000 });
  await page.evaluate(() => {
    window.__shows = [];
    window.__marker = Math.random();
    window.addEventListener('pageshow', (e) => window.__shows.push(e.persisted));
  });
  const cdp = await page.createCDPSession();
  await cdp.send('Page.enable');
  const notUsed = [];
  cdp.on('Page.backForwardCacheNotUsed', (e) => notUsed.push(e));
  await go(page, '/tools/');
  await page.goBack({ waitUntil: 'load' });
  await page.waitForFunction(() => document.readyState === 'complete');
  const r = await page.evaluate(async () => {
    const nav = performance.getEntriesByType('navigation')[0];
    const held = ((await navigator.locks.query()).held || []).filter((l) => l.name === 'mentria-open').length;
    return {
      restored: typeof window.__marker === 'number',
      shows: window.__shows || null,
      reasons: nav && nav.notRestoredReasons ? JSON.stringify(nav.notRestoredReasons) : null,
      held,
      unlocked: window.__m ? window.__m.state().unlocked : null
    };
  });
  const reasons = notUsed.map((e) => (e.notRestoredExplanations || []).map((x) => x.reason)).flat();
  assert(!reasons.some((x) => /lock/i.test(x)), 'not-restored reasons list a lock', reasons);
  assert(r.restored && r.shows && r.shows.includes(true), 'page restored from the back/forward cache', { r, reasons });
  assert(!(r.reasons || '').toLowerCase().includes('lock'), 'notRestoredReasons lists a lock', r.reasons);
  await page.waitForFunction(async () => ((await navigator.locks.query()).held || []).some((l) => l.name === 'mentria-open'), { timeout: 5000 });
  assert(r.unlocked === true, 'session still open after restore', r);
});

let failed = 0;
for (const [name, fn] of checks) {
  try {
    await fn();
    console.log('PASS ' + name);
  } catch (e) {
    failed++;
    console.log('FAIL ' + name + ': ' + (e && e.message || e));
  }
}
console.log((checks.length - failed) + '/' + checks.length + ' passed');
await browser.close();
server.close();
rmSync(PROFILE, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
