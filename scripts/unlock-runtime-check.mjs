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

const delays = new Map();

function serve(dir, port) {
  const root = resolve(dir);
  const server = http.createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://local').pathname);
    if (delays.has(path)) await new Promise((r) => setTimeout(r, delays.get(path)));
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

async function open(path, init) {
  const page = await browser.newPage();
  const log = { requests: [], frameRequests: [], errors: [], console: [] };
  pageLog.set(page, log);
  page.on('request', (r) => {
    log.requests.push(r.url());
    const f = r.frame();
    if (f && f !== page.mainFrame()) log.frameRequests.push(r.url());
  });
  page.on('pageerror', (e) => log.errors.push(String(e && e.message || e)));
  page.on('console', (m) => log.console.push(m.type() + ': ' + m.text()));
  if (init) await page.evaluateOnNewDocument(init);
  try {
    await page.goto(ORIGIN + path, { waitUntil: 'load' });
  } catch (e) {
    if (!init) throw e;
  }
  return page;
}

async function until(fn, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return !!(await fn());
}

function bootFrom(target) {
  return target.waitForFunction((url) => performance.getEntriesByType('resource').some((e) => new URL(e.name).pathname === url), { timeout: 10000 }, MODULE);
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

function sessionRow(page) {
  return page.evaluate(async () => {
    if (!(await indexedDB.databases()).some((d) => d.name === 'mentria-keyring')) return null;
    const d = await new Promise((res, rej) => { const q = indexedDB.open('mentria-keyring', 1); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    const s = await new Promise((res) => { const g = d.transaction('session').objectStore('session').get('current'); g.onsuccess = () => res(g.result || null); });
    d.close();
    return s ? { epoch: s.epoch, kcv: s.kcv, openedAt: s.openedAt } : null;
  });
}

function installHold(page) {
  return page.evaluate(() => {
    window.__hold = (match) => {
      const open = IDBFactory.prototype.open;
      const h = { state: 'armed', tx: null };
      h.gate = new Promise((r) => { h.release = r; });
      IDBFactory.prototype.open = function (...a) {
        const req = open.apply(this, a);
        if (!String(new Error().stack).includes(match)) return req;
        IDBFactory.prototype.open = open;
        h.state = 'caught';
        let fn = null;
        Object.defineProperty(req, 'onsuccess', { configurable: true, get: () => fn, set: (v) => { fn = v; } });
        req.addEventListener('success', (e) => {
          const db = req.result;
          const t = db.transaction;
          db.transaction = function (...b) { h.tx = [String(b[0]), b[1] || 'readonly']; db.transaction = t; return t.apply(db, b); };
          h.state = 'held';
          h.gate.then(() => { h.state = 'released'; if (fn) fn.call(req, e); });
        });
        return req;
      };
      return h;
    };
  });
}

function sees(page, epoch) {
  return until(() => page.evaluate((n) => {
    try { return Number(localStorage.getItem('mentria.keyring.epoch')) === n && JSON.parse(localStorage.getItem('mentria.keyring.local')).manualLock === n; } catch (_) { return false; }
  }, epoch), 5000);
}

let code = null;
let pageA = null;

check('gate off without the tester switch', async () => {
  await clean();
  const lab = await open('/beta/unlock/');
  assert(await lab.evaluate(() => document.documentElement.dataset.release) === 'beta', 'lab page is not a beta build');
  await lab.evaluate(async () => {
    const C = await import('/assets/js/mentria-unlock-core.js');
    const { record } = await C.createRecord({ code: C.newRecoveryCode(), deviceId: 'gate-check' });
    if (!C.isRecord(record)) throw new Error('planted record is not valid');
    localStorage.setItem('mentria.store.keyring.vault', JSON.stringify(record));
    window.__planted = localStorage.getItem('mentria.store.keyring.vault');
  });
  const planted = await lab.evaluate(() => window.__planted);
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
  await tools.evaluate((raw) => localStorage.setItem('mentria.store.keyring.vault', raw), planted);
  const control = await open('/tools/');
  await control.waitForFunction((url) => performance.getEntriesByType('resource').some((e) => new URL(e.name).pathname === url), { timeout: 10000 }, MODULE);
  const sc = await runtime(control);
  assert(sc.enabled && sc.setUp && (sc.launch === 'reopen' || sc.launch === 'continue'), 'control: the same record with the switch on boots the runtime', sc);
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
  const silent = await page.evaluate(async () => {
    const m = window.__m;
    const err = async (fn) => { try { await fn(); return 'no error'; } catch (e) { return e.message; } };
    return {
      root: m.hasRootBytes(),
      add: await err(() => m.addPasskey('x')),
      pass: await err(() => m.setPassphrase('another long passphrase')),
      remember: await err(() => m.setRemember(true)),
      regen: await err(() => m.regenerateCode())
    };
  });
  assert(silent.root === false && silent.add === 'confirm-needed' && silent.pass === 'confirm-needed' && silent.remember === 'confirm-needed' && silent.regen === 'confirm-needed', 'a silent device unlock keeps no R bytes', silent);
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

check('remembered device stays locked after Lock until reopen', async () => {
  await clean();
  let page = await open('/beta/unlock/');
  await enableOnLab(page);
  const c = await createOnLab(page);
  await runtime(page);
  await page.evaluate(async () => { await window.__m.setRemember(true); await window.__m.lock(); });
  const ml = await readLocal(page, 'mentria.keyring.local');
  const ep = await readLocal(page, 'mentria.keyring.epoch');
  assert(ml.manualLock === ep, 'lock records manualLock at the new epoch', { ml, ep });
  await page.reload({ waitUntil: 'load' });
  const s1 = await runtime(page);
  assert(s1.launch === 'continue' && !s1.unlocked && s1.hasDevice, 'reload after Lock stays locked although remembered', s1);
  const other = await open('/tools/');
  const s2 = await runtime(other);
  assert(s2.launch === 'continue' && !s2.unlocked, 'a new page while one is open stays locked', s2);
  await closeAll();
  page = await open('/about/');
  const s3 = await runtime(page);
  assert(s3.launch === 'reopen' && s3.unlocked, 'a reopen unlocks the remembered device again', s3);
  await page.evaluate(() => window.__m.lock());
  await page.evaluate((x) => window.__m.unlockWithCode(x), c);
  const ml2 = await readLocal(page, 'mentria.keyring.local');
  assert(ml2.manualLock == null, 'an explicit unlock clears manualLock', ml2);
});

check('create refuses any stored record value', async () => {
  await clean();
  const page = await open('/beta/unlock/');
  await enableOnLab(page);
  await runtime(page);
  const r = await page.evaluate(async () => {
    const out = [];
    for (const raw of ['not json', JSON.stringify({ v: 2, kcv: 'future' }), 'null']) {
      localStorage.setItem('mentria.store.keyring.vault', raw);
      let e = null;
      try { await window.__m.create({}); } catch (x) { e = x.message; }
      out.push({ raw, e, same: localStorage.getItem('mentria.store.keyring.vault') === raw });
    }
    localStorage.removeItem('mentria.store.keyring.vault');
    return out;
  });
  assert(r.every((x) => x.e === 'exists' && x.same), 'create refuses and leaves the stored value', r);
});

check('create rolls back when the session write fails', async () => {
  await clean();
  const page = await open('/beta/unlock/');
  await enableOnLab(page);
  await runtime(page);
  const r = await page.evaluate(async () => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function () { throw new DOMException('blocked for the check', 'UnknownError'); };
    let e = null;
    try { await window.__m.create({}); } catch (x) { e = x.message || x.name; }
    IDBObjectStore.prototype.put = put;
    const out = { e, record: localStorage.getItem('mentria.store.keyring.vault'), tomb: localStorage.getItem('mentria-sync-tombstones'), setUp: window.__m.state().setUp };
    const again = await window.__m.create({});
    out.again = !!again.code && window.__m.state().unlocked;
    return out;
  });
  assert(r.e && r.record === null && r.setUp === false, 'create rejects and removes the record', r);
  assert(!(r.tomb || '').includes('keyring.vault'), 'rollback writes no sync tombstone', r.tomb);
  assert(r.again, 'a later create works', r);
});

check('unlock rejects when another tab locks during the write', async () => {
  await clean();
  const page = await open('/beta/unlock/');
  await enableOnLab(page);
  const c = await createOnLab(page);
  await runtime(page);
  const r = await page.evaluate(async (x) => {
    await window.__m.lock();
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...a) {
      if (this.name === 'session') localStorage.setItem('mentria.keyring.epoch', String(Number(localStorage.getItem('mentria.keyring.epoch') || 0) + 1));
      return put.apply(this, a);
    };
    let e = null;
    try { await window.__m.unlockWithCode(x); } catch (err) { e = err.message; }
    IDBObjectStore.prototype.put = put;
    return { e, unlocked: window.__m.state().unlocked };
  }, c);
  assert(r.e === 'locked' && r.unlocked === false, 'unlock rejects with locked', r);
  const row = await sessionRow(page);
  assert(row === null, 'the rejected unlock deletes the session row it wrote', row);
});

check('addPasskey fails fast without PRF', async () => {
  await clean();
  const page = await open('/beta/unlock/');
  const cdp = await page.createCDPSession();
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: false, automaticPresenceSimulation: true }
  });
  await enableOnLab(page);
  await createOnLab(page);
  await runtime(page);
  await page.evaluate(() => {
    window.__gets = 0;
    window.__ext = null;
    const g = navigator.credentials.get.bind(navigator.credentials);
    const c = navigator.credentials.create.bind(navigator.credentials);
    navigator.credentials.get = (o) => { window.__gets++; return g(o); };
    navigator.credentials.create = async (o) => {
      const cred = await c(o);
      try { window.__ext = JSON.stringify(cred.getClientExtensionResults()); } catch (_) {}
      return cred;
    };
  });
  const r = await clickCall(page, "(m) => m.addPasskey('No PRF')");
  const info = await page.evaluate(() => ({ gets: window.__gets, ext: window.__ext, stored: JSON.parse(localStorage.getItem('mentria.store.keyring.vault')).wraps.prf.length }));
  assert(!r.ok && r.e === 'no-prf', 'addPasskey rejects with no-prf', { r, info });
  assert(info.gets === 0 && info.stored === 0, 'no follow-up get and nothing stored', info);
  await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
});

check('capability probe cannot hang ready()', async () => {
  await clean();
  const lab = await open('/beta/unlock/');
  await enableOnLab(lab);
  await createOnLab(lab);
  await closeAll();
  const page = await open('/about/', () => {
    if (window.PublicKeyCredential) PublicKeyCredential.getClientCapabilities = () => new Promise(() => {});
  });
  const t0 = Date.now();
  const s = await page.evaluate(async (url) => {
    const m = await import(url);
    return Promise.race([m.ready(), new Promise((r) => setTimeout(() => r('hung'), 6000))]);
  }, MODULE);
  assert(s !== 'hung' && s.prf === 'unknown' && s.launch === 'reopen', 'ready() resolves with prf unknown', s);
  assert(Date.now() - t0 < 6000, 'within the probe timeout');
});

check('frame pages leave the launch decision to the parent', async () => {
  await clean();
  const FRAME = '/extensions/finance/app/';
  const lab = await open('/beta/unlock/');
  await enableOnLab(lab);
  await createOnLab(lab);
  await runtime(lab);
  await lab.evaluate(() => window.__m.setAskAtLaunch(true));
  await closeAll();
  const inFrame = async (page) => {
    await page.evaluate((src) => new Promise((res) => {
      const f = document.createElement('iframe');
      f.src = src;
      f.onload = () => res();
      document.body.appendChild(f);
    }), FRAME);
    const frame = page.frames().find((f) => f.url().includes(FRAME));
    await bootFrom(frame);
    return frame.evaluate(async (url) => { const m = await import(url); await m.ready(); return { s: m.state(), d: m.diagnostics() }; }, MODULE);
  };
  const host = await open('/robots.txt');
  const e0 = await readLocal(host, 'mentria.keyring.epoch');
  const fb = await inFrame(host);
  const e1 = await readLocal(host, 'mentria.keyring.epoch');
  assert(fb.s.launch === 'continue' && fb.d.decision === 'continue' && e1 === e0, 'a frame never bumps the epoch', { fb, e0, e1 });
  await new Promise((r) => setTimeout(r, 500));
  assert(!pageLog.get(host).frameRequests.some((u) => u.includes('mentria-unlock-ui.js')), 'a frame never asks for the launch screen');
  await host.evaluate((n) => {
    const l = JSON.parse(localStorage.getItem('mentria.keyring.local'));
    l.declinedEpoch = n;
    localStorage.setItem('mentria.keyring.local', JSON.stringify(l));
  }, e1 + 1);
  await closeAll();
  const top = await open('/about/');
  const st = await runtime(top);
  const e2 = await readLocal(top, 'mentria.keyring.epoch');
  assert(st.launch === 'reopen' && e2 === e1 + 1, 'the parent page decides the reopen', { st, e1, e2 });
  const fa = await inFrame(top);
  const e3 = await readLocal(top, 'mentria.keyring.epoch');
  assert(fa.s.launch === 'continue' && e3 === e2, 'one epoch bump per reopen with a frame', { fa, e2, e3 });
  const topAsked = await until(() => pageLog.get(top).requests.some((u) => u.includes('mentria-unlock-ui.js')), 3000);
  assert(topAsked, 'the parent shows the launch screen although an old declinedEpoch matches');
  assert(!pageLog.get(top).frameRequests.some((u) => u.includes('mentria-unlock-ui.js')), 'the frame never asks for the launch screen');
});

check('locale redirect makes one launch decision', async () => {
  await clean();
  const lab = await open('/beta/unlock/');
  await enableOnLab(lab);
  await createOnLab(lab);
  const flagged = await open('/about/', () => { window.__mentriaRedirecting = true; });
  await new Promise((r) => setTimeout(r, 800));
  assert(!(await bootLoaded(flagged)), 'a page marked as redirecting does not load the runtime');
  await flagged.close();
  const e0 = await readLocal(lab, 'mentria.keyring.epoch');
  await lab.evaluate(() => localStorage.setItem('mentria_lang', 'ja'));
  await closeAll();
  delays.set('/ja/', 1500);
  const page = await open('/', () => {
    if (!navigator.locks) return;
    const q = navigator.locks.query.bind(navigator.locks);
    navigator.locks.query = function () {
      try {
        const a = JSON.parse(sessionStorage.getItem('__t4_decisions') || '[]');
        a.push(location.pathname);
        sessionStorage.setItem('__t4_decisions', JSON.stringify(a));
      } catch (_) {}
      return q();
    };
  });
  await page.waitForFunction(() => location.pathname === '/ja/', { timeout: 15000 });
  delays.clear();
  await bootFrom(page);
  const s = await runtime(page);
  const d = JSON.parse(await page.evaluate(() => sessionStorage.getItem('__t4_decisions')));
  const e1 = await readLocal(page, 'mentria.keyring.epoch');
  assert(JSON.stringify(d) === '["/ja/"]', 'exactly one launch decision, made by the localized page', d);
  assert(s.launch === 'reopen' && e1 === e0 + 1, 'one reopen bump', { s, e0, e1 });
});

check('silent unlock loses to a Lock in another page', async () => {
  await clean();
  const lab = await open('/beta/unlock/');
  await enableOnLab(lab);
  await createOnLab(lab);
  await runtime(lab);
  await lab.evaluate(() => window.__m.setRemember(true));
  await closeAll();
  const a = await open('/about/');
  const sa = await runtime(a);
  assert(sa.launch === 'reopen' && sa.unlocked && sa.hasDevice, 'setup: a reopen unlocks the remembered device', sa);
  const b = await open('/tools/');
  const sb = await runtime(b);
  assert(sb.launch === 'continue' && sb.unlocked, 'setup: the second page is unlocked', sb);
  await installHold(a);
  const e0 = await readLocal(a, 'mentria.keyring.epoch');
  const caught = await a.evaluate(() => {
    window.__h = window.__hold('unlockWithDevice');
    window.__res = undefined;
    window.__m.unlockWithDevice().then((v) => { window.__res = v; }, (e) => { window.__res = 'error ' + e.message; });
    return window.__h.state;
  });
  assert(caught === 'caught', 'harness: the device key read is held', caught);
  await b.evaluate(() => window.__m.lock());
  const e1 = await readLocal(b, 'mentria.keyring.epoch');
  assert(e1 === e0 + 1, 'harness: Lock bumps the epoch', { e0, e1 });
  assert(await sees(a, e1), 'harness: the first page sees the Lock before the release');
  await a.evaluate(() => window.__h.release());
  assert(await until(() => a.evaluate(() => window.__res !== undefined), 15000), 'harness: the call settles');
  const r = await a.evaluate(() => ({ res: window.__res, tx: window.__h.tx, unlocked: window.__m.state().unlocked }));
  const row = await sessionRow(a);
  assert(JSON.stringify(r.tx) === '["keys","readonly"]', 'harness: the held connection read the device key', r.tx);
  assert(r.res === false && r.unlocked === false, 'a silent unlock that lands after a Lock reports false and stays locked', r);
  assert(row === null, 'no session row is left at the locked epoch', row);
  await b.reload({ waitUntil: 'load' });
  const s2 = await runtime(b);
  assert(s2.launch === 'continue' && !s2.unlocked, 'a reload after the race stays locked', s2);
});

check('a rejected unlock leaves no session row', async () => {
  await clean();
  const a = await open('/beta/unlock/');
  await enableOnLab(a);
  const c = await createOnLab(a);
  await runtime(a);
  const b = await open('/about/');
  const sb = await runtime(b);
  assert(sb.launch === 'continue' && sb.unlocked, 'setup: the second page is unlocked', sb);
  await a.evaluate(() => window.__m.lock());
  await installHold(a);
  const e0 = await readLocal(a, 'mentria.keyring.epoch');
  await a.evaluate((x) => {
    window.__h = window.__hold('idbPut');
    window.__res = undefined;
    window.__m.unlockWithCode(x).then(() => { window.__res = 'no error'; }, (e) => { window.__res = e.message; });
  }, c);
  assert(await until(() => a.evaluate(() => window.__h.state !== 'armed'), 15000), 'harness: the session write is held');
  await b.evaluate(() => window.__m.lock());
  const e1 = await readLocal(b, 'mentria.keyring.epoch');
  assert(e1 === e0 + 1, 'harness: Lock bumps the epoch', { e0, e1 });
  assert(await sees(a, e1), 'harness: the first page sees the Lock before the release');
  await a.evaluate(() => window.__h.release());
  assert(await until(() => a.evaluate(() => window.__res !== undefined), 15000), 'harness: the call settles');
  const r = await a.evaluate(() => ({ res: window.__res, tx: window.__h.tx, unlocked: window.__m.state().unlocked }));
  const row = await sessionRow(a);
  assert(JSON.stringify(r.tx) === '["session","readwrite"]', 'harness: the held connection wrote the session', r.tx);
  assert(r.res === 'locked' && r.unlocked === false, 'the unlock rejects with locked', r);
  assert(row === null, 'the rejected unlock leaves no session row', row);
});

check('a Lock caught between its two writes still wins', async () => {
  await clean();
  const a = await open('/beta/unlock/');
  await enableOnLab(a);
  const c = await createOnLab(a);
  await runtime(a);
  await a.evaluate(() => window.__m.setRemember(true));
  const b = await open('/about/');
  const sb = await runtime(b);
  assert(sb.launch === 'continue' && sb.unlocked, 'setup: the second page is unlocked', sb);
  const e0 = Number(await readLocal(b, 'mentria.keyring.epoch') || 0);
  const paused = await b.evaluate(async () => {
    const set = Storage.prototype.setItem;
    window.__set = set;
    window.__deferred = null;
    Storage.prototype.setItem = function (k, v) {
      if (k === 'mentria.keyring.epoch' && !window.__deferred) {
        window.__deferred = [k, v];
        Storage.prototype.setItem = set;
        return;
      }
      return set.call(this, k, v);
    };
    await window.__m.lock();
    return window.__deferred;
  });
  assert(paused && paused[1] === String(e0 + 1), 'harness: the epoch write of the Lock is paused', paused);
  assert(await until(() => a.evaluate((n) => {
    try { return Number(localStorage.getItem('mentria.keyring.epoch') || 0) === n && JSON.parse(localStorage.getItem('mentria.keyring.local')).manualLock === n + 1 && !window.__m.state().unlocked; } catch (_) { return false; }
  }, e0), 5000), 'harness: the first page sees the manual lock, the old epoch and no session');
  const r = await a.evaluate(async (x) => {
    const out = { device: await window.__m.unlockWithDevice() };
    out.deviceUnlocked = window.__m.state().unlocked;
    try { await window.__m.unlockWithCode(x); out.code = 'no error'; } catch (err) { out.code = err.message; }
    out.ml = JSON.parse(localStorage.getItem('mentria.keyring.local')).manualLock;
    return out;
  }, c);
  await b.evaluate(() => window.__set.call(localStorage, window.__deferred[0], window.__deferred[1]));
  assert(r.device === false && r.deviceUnlocked === false, 'a silent unlock refuses while a Lock is half written', r);
  assert(r.code === 'no error' && r.ml === e0 + 1, 'an explicit unlock at the old epoch keeps the newer manual lock', { r, e0 });
  await b.reload({ waitUntil: 'load' });
  const s2 = await runtime(b);
  assert(s2.launch === 'continue' && !s2.unlocked && s2.hasDevice, 'a remembered page still honours the Lock', s2);
});

check('another page never sees the new epoch without the manual lock', async () => {
  await clean();
  const a = await open('/beta/unlock/');
  await enableOnLab(a);
  await createOnLab(a);
  await runtime(a);
  const b = await open('/about/');
  const sb = await runtime(b);
  assert(sb.launch === 'continue' && sb.unlocked, 'setup: the second page is unlocked', sb);
  await a.evaluate(() => {
    window.__seen = [];
    window.addEventListener('storage', (e) => {
      if (e.key !== 'mentria.keyring.epoch' && e.key !== 'mentria.keyring.local') return;
      let ml = null;
      try { ml = JSON.parse(localStorage.getItem('mentria.keyring.local')).manualLock; } catch (_) {}
      window.__seen.push({ key: e.key, epoch: Number(localStorage.getItem('mentria.keyring.epoch') || 0), ml });
    });
  });
  await b.evaluate(() => window.__m.lock());
  const e1 = Number(await readLocal(b, 'mentria.keyring.epoch'));
  assert(await until(() => a.evaluate(() => window.__seen.some((x) => x.key === 'mentria.keyring.epoch')), 5000), 'harness: the first page saw the epoch change');
  const seen = await a.evaluate(() => window.__seen);
  const keys = seen.map((x) => x.key);
  const at = seen.find((x) => x.key === 'mentria.keyring.epoch');
  assert(keys.includes('mentria.keyring.local') && keys.indexOf('mentria.keyring.local') < keys.indexOf('mentria.keyring.epoch'), 'the manual lock is written before the epoch', seen);
  assert(at.epoch === e1 && at.ml === e1, 'the page that sees the new epoch also sees the manual lock', { at, e1 });
});

check('ready() makes no decision on a redirecting page', async () => {
  await clean();
  const lab = await open('/beta/unlock/');
  await enableOnLab(lab);
  await createOnLab(lab);
  const e0 = await readLocal(lab, 'mentria.keyring.epoch');
  await closeAll();
  const page = await open('/about/', () => {
    window.__mentriaRedirecting = true;
    window.__queries = 0;
    if (!navigator.locks) return;
    const q = navigator.locks.query.bind(navigator.locks);
    navigator.locks.query = function () { window.__queries++; return q(); };
  });
  const s = await runtime(page);
  const r = await page.evaluate(async () => {
    const again = await window.__m.ready();
    return { again: again.launch, d: window.__m.diagnostics().decision, q: window.__queries, marker: sessionStorage.getItem('mentria.keyring.tab') };
  });
  const e1 = await readLocal(page, 'mentria.keyring.epoch');
  assert(s.launch === null && r.again === null && r.d === null, 'ready() returns without a launch decision', { s, r });
  assert(r.q === 0 && r.marker === null && e1 === e0, 'a redirecting page queries no lock, writes no marker and bumps nothing', { r, e0, e1 });
});

check('create re-checks for a record right before its write', async () => {
  await clean();
  const a = await open('/beta/unlock/');
  await enableOnLab(a);
  await runtime(a);
  const b = await open('/about/');
  await b.waitForFunction(() => document.readyState === 'complete' && !!window.MentriaStore);
  await runtime(b);
  await a.evaluate(() => {
    const h = { state: 'armed' };
    h.gate = new Promise((r) => { h.release = r; });
    window.__h = h;
    const digest = crypto.subtle.digest;
    crypto.subtle.digest = function (...x) {
      if (!String(new Error().stack).includes('kcvOf')) return digest.apply(crypto.subtle, x);
      delete crypto.subtle.digest;
      h.state = 'held';
      return h.gate.then(() => crypto.subtle.digest(...x));
    };
    window.__res = undefined;
    window.__m.create({}).then((v) => { window.__res = { ok: true, code: !!(v && v.code) }; }, (e) => { window.__res = { ok: false, e: e.message || e.name }; });
  });
  assert(await until(() => a.evaluate(() => window.__h.state === 'held'), 15000), 'harness: the record crypto is held');
  const other = await b.evaluate(async () => {
    const r = await window.__m.create({});
    return { code: !!(r && r.code), raw: localStorage.getItem('mentria.store.keyring.vault') };
  });
  assert(other.code && other.raw, 'setup: the other page created a keyring', other);
  assert(await until(() => a.evaluate((raw) => localStorage.getItem('mentria.store.keyring.vault') === raw, other.raw), 5000), 'harness: the first page sees the other record');
  await a.evaluate(() => window.__h.release());
  assert(await until(() => a.evaluate(() => window.__res !== undefined), 15000), 'harness: the create settles');
  const r = await a.evaluate(() => ({ res: window.__res, same: localStorage.getItem('mentria.store.keyring.vault') }));
  const bUnlocked = await b.evaluate(() => window.__m.state().unlocked);
  assert(r.res.ok === false && r.res.e === 'exists', 'the late create rejects with exists and returns no code', r.res);
  assert(r.same === other.raw && bUnlocked === true, 'the other record stays and its page stays unlocked', { same: r.same === other.raw, bUnlocked });
});

check('create reports exists when another tab\'s create wins', async () => {
  await clean();
  const a = await open('/beta/unlock/');
  await enableOnLab(a);
  await runtime(a);
  const b = await open('/about/');
  await b.waitForFunction(() => document.readyState === 'complete' && !!window.MentriaStore);
  await installHold(a);
  const cases = [
    { failPut: false, valid: true },
    { failPut: true, valid: true },
    { failPut: false, valid: false },
    { failPut: true, valid: false }
  ];
  for (const { failPut, valid } of cases) {
    const tag = (valid ? 'with a valid record ' : 'with a value isRecord rejects ') + (failPut ? 'when the session write also fails' : 'after the session write');
    await b.evaluate(async (ok) => {
      localStorage.removeItem('mentria.store.keyring.vault');
      if (ok) {
        const C = await import('/assets/js/mentria-unlock-core.js');
        window.__rec = (await C.createRecord({ code: C.newRecoveryCode(), deviceId: 'other-tab' })).record;
      } else {
        window.__rec = null;
      }
    }, valid);
    assert(await until(() => a.evaluate(() => localStorage.getItem('mentria.store.keyring.vault') === null), 5000), 'harness: the first page sees no record ' + tag);
    await a.evaluate((fail) => {
      window.__h = window.__hold('idbPut');
      window.__res = undefined;
      window.__put = IDBObjectStore.prototype.put;
      if (fail) {
        const put = window.__put;
        IDBObjectStore.prototype.put = function (...x) {
          if (this.name === 'session') throw new DOMException('blocked for the check', 'UnknownError');
          return put.apply(this, x);
        };
      }
      window.__m.create({}).then((v) => { window.__res = { ok: true, code: !!(v && v.code) }; }, (e) => { window.__res = { ok: false, e: e.message || e.name }; });
    }, failPut);
    assert(await until(() => a.evaluate(() => window.__h.state !== 'armed'), 15000), 'harness: the session write is held ' + tag);
    const winner = await b.evaluate(() => {
      if (window.__rec) {
        if (window.MentriaStore.set('keyring', 'vault', window.__rec) !== true) throw new Error('write failed');
      } else {
        localStorage.setItem('mentria.store.keyring.vault', JSON.stringify({ v: 2, kcv: 'future' }));
      }
      return localStorage.getItem('mentria.store.keyring.vault');
    });
    assert(await until(() => a.evaluate((raw) => localStorage.getItem('mentria.store.keyring.vault') === raw, winner), 5000), 'harness: the first page sees the other value ' + tag);
    await a.evaluate(() => window.__h.release());
    assert(await until(() => a.evaluate(() => window.__res !== undefined), 15000), 'harness: the create settles ' + tag);
    const r = await a.evaluate(() => {
      IDBObjectStore.prototype.put = window.__put;
      return { res: window.__res, tx: window.__h.tx, raw: localStorage.getItem('mentria.store.keyring.vault'), unlocked: window.__m.state().unlocked };
    });
    const row = await sessionRow(a);
    assert(JSON.stringify(r.tx) === '["session","readwrite"]', 'harness: the held connection wrote the session ' + tag, r.tx);
    assert(r.res.ok === false && r.res.e === 'exists', 'the losing create rejects with exists and returns no code ' + tag, r);
    assert(r.raw === winner && r.unlocked === false, 'the other value stays and nothing is unlocked ' + tag, { res: r.res, kept: r.raw === winner, unlocked: r.unlocked });
    assert(row === null, 'the losing create leaves no session row ' + tag, row);
  }
});

check('a rejected unlock keeps another page\'s newer row', async () => {
  await clean();
  const lab = await open('/beta/unlock/');
  await enableOnLab(lab);
  const c = await createOnLab(lab);
  await runtime(lab);
  await lab.evaluate(() => window.__m.setRemember(true));
  await closeAll();
  const a = await open('/about/');
  const sa = await runtime(a);
  assert(sa.launch === 'reopen' && sa.unlocked, 'setup: a reopen unlocks the remembered device', sa);
  const b = await open('/tools/');
  const sb = await runtime(b);
  assert(sb.launch === 'continue' && sb.unlocked, 'setup: the second page is unlocked', sb);
  await installHold(a);
  const T = Date.now();
  for (const p of [a, b]) await p.evaluate((t) => { window.__now = Date.now; Date.now = () => t; }, T);
  const caught = await a.evaluate(() => {
    window.__h1 = window.__hold('unlockWithDevice');
    window.__res = undefined;
    window.__m.unlockWithDevice().then((v) => { window.__res = v; }, (e) => { window.__res = 'error ' + e.message; });
    return window.__h1.state;
  });
  assert(caught === 'caught', 'harness: the device key read is held', caught);
  await b.evaluate(() => window.__m.lock());
  const e1 = await readLocal(b, 'mentria.keyring.epoch');
  assert(await sees(a, e1), 'harness: the first page sees the Lock before the release');
  await a.evaluate(() => { window.__h2 = window.__hold('idbDelIf'); window.__h1.release(); });
  assert(await until(() => a.evaluate(() => window.__h2.state !== 'armed'), 15000), 'harness: the delete of the rejected row is held');
  await b.evaluate((x) => window.__m.unlockWithCode(x), c);
  const mid = await sessionRow(a);
  assert(mid && mid.epoch === e1 && mid.openedAt === T, 'harness: the other page wrote its row at the same epoch and time', { mid, e1, T });
  await a.evaluate(() => window.__h2.release());
  assert(await until(() => a.evaluate(() => window.__res !== undefined), 15000), 'harness: the call settles');
  for (const p of [a, b]) await p.evaluate(() => { Date.now = window.__now; });
  const r = await a.evaluate(() => ({ res: window.__res, tx: window.__h2.tx }));
  const row = await sessionRow(a);
  assert(JSON.stringify(r.tx) === '["session","readwrite"]', 'harness: the held connection deleted from the session store', r.tx);
  assert(r.res === false, 'the silent unlock still loses', r);
  assert(row && row.epoch === e1, 'the other page\'s row survives the delete', row);
  assert(await until(() => a.evaluate(() => window.__m.state().unlocked), 5000), 'the first page follows the other page\'s unlock');
  await b.reload({ waitUntil: 'load' });
  const s2 = await runtime(b);
  assert(s2.launch === 'continue' && s2.unlocked, 'a reload continues the surviving session', s2);
});

check('removing a passkey or the passphrase after a silent unlock asks for a confirm', async () => {
  await clean();
  let page = await open('/beta/unlock/');
  const cdp = await page.createCDPSession();
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true }
  });
  await enableOnLab(page);
  const c = await createOnLab(page);
  await runtime(page);
  const add = await clickCall(page, "(m) => m.addPasskey('Keep me')");
  assert(add.ok, 'setup: passkey added', add);
  await page.evaluate(async () => { await window.__m.setPassphrase('correct horse battery'); await window.__m.setRemember(true); });
  const id = (await readLocal(page, 'mentria.store.keyring.vault')).wraps.prf[0].id;
  await closeAll();
  page = await open('/tools/');
  const s = await runtime(page);
  assert(s.launch === 'reopen' && s.unlocked && s.passkeys === 1 && s.hasPass, 'setup: a silent unlock after a reopen', s);
  const r = await page.evaluate(async ({ id, c }) => {
    const m = window.__m;
    const err = async (fn) => { try { await fn(); return 'no error'; } catch (e) { return e.message; } };
    const out = { root: m.hasRootBytes() };
    out.key = await err(() => m.removePasskey(id));
    out.pass = await err(() => m.setPassphrase(null));
    out.empty = await err(() => m.setPassphrase(''));
    out.kept = m.state().passkeys === 1 && m.state().hasPass;
    await m.confirmWithCode(c);
    out.keyAfter = await err(() => m.removePasskey(id));
    out.passAfter = await err(() => m.setPassphrase(null));
    out.gone = m.state().passkeys === 0 && !m.state().hasPass;
    await m.lock();
    out.keyLocked = await err(() => m.removePasskey(id));
    out.passLocked = await err(() => m.setPassphrase(null));
    return out;
  }, { id, c });
  assert(r.root === false && r.key === 'confirm-needed' && r.pass === 'confirm-needed' && r.empty === 'confirm-needed' && r.kept, 'removal after a silent unlock needs R bytes', r);
  assert(r.keyAfter === 'no error' && r.passAfter === 'no error' && r.gone, 'removal works after a confirm', r);
  assert(r.keyLocked === 'locked' && r.passLocked === 'locked', 'removal while locked still reports locked', r);
});

let failed = 0;
const ONLY = process.env.ONLY || '';
for (const [name, fn] of checks.filter(([n]) => !ONLY || n.includes(ONLY))) {
  try {
    await fn();
    console.log('PASS ' + name);
  } catch (e) {
    failed++;
    console.log('FAIL ' + name + ': ' + (e && e.message || e));
  }
}
const ran = checks.filter(([n]) => !ONLY || n.includes(ONLY)).length;
console.log((ran - failed) + '/' + ran + ' passed');
await browser.close();
server.close();
rmSync(PROFILE, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
