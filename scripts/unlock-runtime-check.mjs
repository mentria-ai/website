import http from 'node:http';
import { createReadStream, statSync, rmSync, readFileSync } from 'node:fs';
import { join, extname, normalize, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import puppeteer from 'puppeteer-core';

const BUILD = process.argv[2];
if (!BUILD) { console.log('usage: node scripts/unlock-runtime-check.mjs <beta build dir>'); process.exit(2); }
const PORT = Number(process.env.UNLOCK_PORT) || 8096;
const ORIGIN = 'http://localhost:' + PORT;
const PROFILE = join(tmpdir(), PORT === 8096 ? 'unlock-runtime-check-profile' : 'unlock-runtime-check-profile-' + PORT);
const MODULE = '/assets/js/mentria-unlock.js';
const EN = JSON.parse(readFileSync(new URL('../src/_data/i18n/en.json', import.meta.url), 'utf8')).unlock;

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

const RECORD = 'mentria.store.keyring.vault';
const WRITE_LOCK = 'mentria-keyring-write';

function writeLockState(page) {
  return page.evaluate(async (name) => {
    const q = await navigator.locks.query();
    return { held: (q.held || []).filter((l) => l.name === name).length, pending: (q.pending || []).filter((l) => l.name === name).length };
  }, WRITE_LOCK);
}

function writeLockPending(page) {
  return until(async () => (await writeLockState(page)).pending > 0, 5000);
}

function writeLockIdle(page) {
  return until(async () => { const s = await writeLockState(page); return s.held === 0 && s.pending === 0; }, 5000);
}

function holdWriteLock(page) {
  return page.evaluate((name) => new Promise((ok) => {
    navigator.locks.request(name, { mode: 'exclusive' }, () => new Promise((release) => { window.__wlRelease = release; ok(true); }));
  }), WRITE_LOCK);
}

function countRecordEvents(page) {
  return page.evaluate((key) => {
    window.__recEvents = [];
    if (window.__recCounting) return;
    window.__recCounting = true;
    window.addEventListener('storage', (e) => { if (e.key === key) window.__recEvents.push(e.newValue == null ? null : 'set'); });
  }, RECORD);
}

function installCryptoHold(page) {
  return page.evaluate(() => {
    window.__holdCrypto = (method, aad) => {
      const h = { state: 'armed' };
      h.gate = new Promise((r) => { h.release = r; });
      crypto.subtle[method] = function (alg, ...rest) {
        let label = '';
        try { label = new TextDecoder().decode(alg && alg.additionalData); } catch (_) {}
        if (label !== aad) return SubtleCrypto.prototype[method].call(crypto.subtle, alg, ...rest);
        delete crypto.subtle[method];
        h.state = 'held';
        return h.gate.then(() => SubtleCrypto.prototype[method].call(crypto.subtle, alg, ...rest));
      };
      return h;
    };
  });
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
    let kept = null;
    try { kept = JSON.parse(localStorage.getItem('mentria.keyring.others')); } catch (_) {}
    out.kept = Array.isArray(kept) ? kept.map((x) => x && x.kcv) : kept;
    const again = await window.__m.create({});
    out.again = !!again.code && window.__m.state().unlocked;
    out.others = window.__m.others().map((o) => o.kcv);
    return out;
  });
  assert(r.e && r.record === null && r.setUp === false, 'create rejects and removes the record', r);
  assert(!(r.tomb || '').includes('keyring.vault'), 'rollback writes no sync tombstone', r.tomb);
  assert(Array.isArray(r.kept) && r.kept.length === 1 && typeof r.kept[0] === 'string', 'the rolled-back record is kept on the side', r.kept);
  assert(r.again && JSON.stringify(r.others) === '[]', 'a later create works and never offers the kept one, which holds nothing to bring in', r);
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
  assert(await sees(b, e0), 'harness: the second page sees the first Lock before its own', e0);
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

check('link keeps the old secret under prior', async () => {
  await clean();
  const page = await open('/beta/unlock/');
  await enableOnLab(page);
  const c = await createOnLab(page);
  await runtime(page);
  const r = await page.evaluate(async (code) => {
    const m = window.__m;
    const C = await import('/assets/js/mentria-unlock-core.js');
    const rd = () => JSON.parse(localStorage.getItem('mentria.store.keyring.vault'));
    const hex = (b) => (b ? Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('') : null);
    const rnd = () => crypto.getRandomValues(new Uint8Array(32));
    const out = {};
    const s1 = rnd();
    const s2 = rnd();
    await m.link('notes', s1);
    const e1 = rd().services.notes;
    out.first = typeof e1.id === 'string' && e1.id.length === 11 && e1.prior === undefined && m.secretId('notes') === e1.id;
    const raw1 = localStorage.getItem('mentria.store.keyring.vault');
    await m.link('notes', new Uint8Array(s1));
    out.sameKept = localStorage.getItem('mentria.store.keyring.vault') === raw1;
    await m.link('notes', s2.buffer);
    const e2 = rd().services.notes;
    out.moved = e2.id !== e1.id && Array.isArray(e2.prior) && e2.prior.length === 1 && JSON.stringify(e2.prior[0]) === JSON.stringify(e1);
    out.current = hex(await m.secret('notes')) === hex(s2) && m.secretId('notes') === e2.id;
    const root = await C.rootKeyFrom(await C.openWithCode(rd().wraps.recovery, code));
    out.oldOpens = hex(await C.openService(root, 'notes', e2.prior[0])) === hex(s1);
    const other = rd();
    const so = rnd();
    other.services.notes = await C.sealService(root, 'notes', so, Date.now() + 86400000);
    const planted = C.mergeRecords(rd(), other);
    window.MentriaStore.set('keyring', 'vault', planted);
    const s4 = rnd();
    await m.link('notes', s4);
    const e4 = rd().services.notes;
    out.after = Date.parse(e4.linked) > Date.parse(other.services.notes.linked);
    out.stays = C.mergeRecords(planted, rd()).services.notes.id === e4.id && C.mergeRecords(rd(), planted).services.notes.id === e4.id;
    out.prior4 = e4.prior.map((p) => p.id).join() === [e1.id, e2.id, other.services.notes.id].join();
    const more = [];
    for (let i = 0; i < 9; i++) {
      more.push(rnd());
      await m.link('notes', more[i]);
    }
    const kept = await m.secrets('notes');
    out.count = [rd().services.notes.prior.length, kept.length];
    out.every = JSON.stringify(kept.map((x) => hex(x.bytes))) === JSON.stringify([s1, s2, so, s4].concat(more).reverse().map(hex));
    const ca = rnd();
    const cb = rnd();
    await Promise.all([m.link('totp', ca), m.link('totp', cb)]);
    const both = (await m.secrets('totp')).map((x) => hex(x.bytes)).sort();
    out.concurrent = JSON.stringify(both) === JSON.stringify([hex(ca), hex(cb)].sort());
    out.valid = C.isRecord(rd());
    return out;
  }, c);
  assert(r.first && r.sameKept, 'the first link has an id and no prior; linking the same secret again writes nothing', r);
  assert(r.moved && r.current && r.oldOpens, 'linking a different secret moves the old entry to prior', r);
  assert(r.after && r.stays && r.prior4, 'a new link is stamped after the entry it replaces and stays current through a merge', r);
  assert(JSON.stringify(r.count) === '[12,13]' && r.every, 'prior keeps every secret through links', { count: r.count, every: r.every });
  assert(r.concurrent && r.valid, 'two links at once keep both secrets', r);
});

check('secrets() returns current then prior', async () => {
  await clean();
  const page = await open('/beta/unlock/');
  await enableOnLab(page);
  const c = await createOnLab(page);
  await runtime(page);
  const r = await page.evaluate(async (code) => {
    const m = window.__m;
    const C = await import('/assets/js/mentria-unlock-core.js');
    const rd = () => JSON.parse(localStorage.getItem('mentria.store.keyring.vault'));
    const put = (rec) => window.MentriaStore.set('keyring', 'vault', rec);
    const hex = (b) => (b ? Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('') : null);
    const rnd = () => crypto.getRandomValues(new Uint8Array(32));
    const flip = (s) => (s[0] === 'A' ? 'B' : 'A') + s.slice(1);
    const pairs = async (name) => (await m.secrets(name || 'identity')).map((x) => [x.id, hex(x.bytes)]);
    const err = async (fn) => { try { await fn(); return 'no error'; } catch (e) { return e.message; } };
    const out = {};
    out.none = { list: await m.secrets('identity'), id: m.secretId('identity') };
    const root = await C.rootKeyFrom(await C.openWithCode(rd().wraps.recovery, code));
    const sa = rnd();
    const sb = rnd();
    await m.link('identity', sa);
    const mine = rd();
    const other = JSON.parse(JSON.stringify(mine));
    other.services.identity = await C.sealService(root, 'identity', sb, Date.parse(mine.services.identity.linked) + 1000);
    const merged = C.mergeRecords(mine, other);
    put(merged);
    const ia = mine.services.identity.id;
    const ib = other.services.identity.id;
    out.merged = { id: m.secretId('identity'), secret: hex(await m.secret('identity')), list: await pairs(), want: [[ib, hex(sb)], [ia, hex(sa)]], ib, sb: hex(sb) };
    const legacy = rd();
    delete legacy.services.identity.id;
    put(legacy);
    out.legacy = { id: m.secretId('identity'), list: await pairs(), want: [[null, hex(sb)], [ia, hex(sa)]] };
    const badPrior = rd();
    badPrior.services.identity.prior[0].ct = flip(badPrior.services.identity.prior[0].ct);
    put(badPrior);
    out.badPrior = { list: await pairs(), want: [[null, hex(sb)]] };
    const badCur = rd();
    badCur.services.identity.ct = flip(badCur.services.identity.ct);
    put(badCur);
    out.badCur = { list: await err(() => m.secrets('identity')), one: await err(() => m.secret('identity')) };
    put(merged);
    out.unknown = { list: await m.secrets('backup'), id: m.secretId('backup'), unlinked: await m.secrets('totp') };
    await m.lock();
    out.locked = { list: await m.secrets('identity'), id: m.secretId('identity') };
    await m.unlockWithCode(code);
    out.again = JSON.stringify(await pairs()) === JSON.stringify(out.merged.want);
    m.setEnabled(false);
    out.off = { list: await m.secrets('identity'), id: m.secretId('identity') };
    m.setEnabled(true);
    return out;
  }, c);
  assert(JSON.stringify(r.none) === '{"list":[],"id":null}', 'nothing linked gives an empty list and no id', r.none);
  assert(r.merged.id === r.merged.ib && r.merged.secret === r.merged.sb, 'after a merge secret() and secretId() give the newer entry', r.merged);
  assert(JSON.stringify(r.merged.list) === JSON.stringify(r.merged.want), 'secrets() gives the current entry then the other device\'s', r.merged);
  assert(r.legacy.id === null && JSON.stringify(r.legacy.list) === JSON.stringify(r.legacy.want), 'an entry without an id lists with a null id', r.legacy);
  assert(JSON.stringify(r.badPrior.list) === JSON.stringify(r.badPrior.want), 'a prior entry that does not open is skipped', r.badPrior);
  assert(r.badCur.list === 'bad-service' && r.badCur.one === 'bad-service', 'a current entry that does not open throws bad-service like secret()', r.badCur);
  assert(JSON.stringify(r.unknown) === '{"list":[],"id":null,"unlinked":[]}', 'unknown or unlinked services give nothing', r.unknown);
  assert(JSON.stringify(r.locked.list) === '[]' && r.locked.id === r.merged.ib, 'locked: secrets() is empty, secretId() still names the current entry', r.locked);
  assert(r.again, 'after unlocking again secrets() lists both', r);
  assert(JSON.stringify(r.off) === '{"list":[],"id":null}', 'switch off gives nothing', r.off);
});

check('a stale write from another page is healed', async () => {
  await clean();
  const a = await open('/beta/unlock/');
  await enableOnLab(a);
  await createOnLab(a);
  await runtime(a);
  const b = await open('/about/');
  const sb = await runtime(b);
  assert(sb.launch === 'continue' && sb.unlocked, 'setup: the second page is unlocked', sb);
  const stale = await b.evaluate((k) => localStorage.getItem(k), RECORD);
  const want = await a.evaluate(async () => {
    const s = crypto.getRandomValues(new Uint8Array(32));
    await window.__m.link('notes', s);
    return Array.from(s).join();
  });
  const linked = await a.evaluate((k) => localStorage.getItem(k), RECORD);
  assert(linked !== stale && JSON.parse(linked).services.notes, 'setup: the first page linked notes');
  assert(await until(() => b.evaluate(([k, raw]) => localStorage.getItem(k) === raw, [RECORD, linked]), 5000), 'harness: the second page sees the link');
  for (const p of [a, b]) await countRecordEvents(p);
  await holdWriteLock(b);
  await b.evaluate((raw) => {
    const rec = JSON.parse(raw);
    const reordered = {};
    for (const k of Object.keys(rec).reverse()) reordered[k] = rec[k];
    if (window.MentriaStore.set('keyring', 'vault', reordered) !== true) throw new Error('write failed');
  }, stale);
  assert(await until(() => a.evaluate(() => window.__recEvents.length === 1), 5000), 'harness: the first page sees the stale write');
  assert(await writeLockPending(a), 'the heal waits for the keyring write lock');
  const mid = await a.evaluate((k) => JSON.parse(localStorage.getItem(k)).services.notes || null, RECORD);
  assert(mid === null, 'nothing is written back while another page holds the write lock', mid);
  await b.evaluate(() => window.__wlRelease());
  const reads = (p) => until(() => p.evaluate(async (w) => { const s = await window.__m.secret('notes'); return !!s && Array.from(s).join() === w; }, want), 5000);
  assert(await reads(a), 'the first page puts its link back');
  assert(await reads(b), 'the second page reads the restored link');
  assert(await until(() => b.evaluate(() => window.__recEvents.length === 1), 5000), 'the second page sees the heal write');
  assert(await writeLockIdle(a), 'the write lock settles');
  await new Promise((r) => setTimeout(r, 800));
  assert(await writeLockIdle(a), 'the write lock stays idle');
  const end = { a: await a.evaluate((k) => ({ n: window.__recEvents.length, raw: localStorage.getItem(k) }), RECORD), b: await b.evaluate((k) => ({ n: window.__recEvents.length, raw: localStorage.getItem(k) }), RECORD) };
  assert(end.a.n === 1 && end.b.n === 1, 'one heal write and no write loop', { a: end.a.n, b: end.b.n });
  assert(end.a.raw === end.b.raw && end.a.raw !== stale, 'both pages hold the same healed record');
  const s = await b.evaluate(() => window.__m.state());
  assert(s.unlocked && JSON.stringify(s.linked) === '["notes"]', 'the session stays open', s);
});

check('healing never brings back a removed or different keyring', async () => {
  await clean();
  const a = await open('/beta/unlock/');
  await enableOnLab(a);
  await createOnLab(a);
  await runtime(a);
  await a.evaluate(() => window.__m.link('identity', crypto.getRandomValues(new Uint8Array(32))));
  const b = await open('/about/');
  const sb = await runtime(b);
  assert(sb.unlocked, 'setup: the second page is unlocked', sb);
  await countRecordEvents(a);
  const other = await b.evaluate(async () => {
    const C = await import('/assets/js/mentria-unlock-core.js');
    const { record } = await C.createRecord({ code: C.newRecoveryCode(), deviceId: 'other-keyring' });
    if (window.MentriaStore.set('keyring', 'vault', record) !== true) throw new Error('write failed');
    return localStorage.getItem('mentria.store.keyring.vault');
  });
  assert(await until(() => a.evaluate(() => window.__recEvents.length === 1), 5000), 'harness: the first page sees the other keyring');
  assert(await writeLockIdle(a), 'harness: no write in flight');
  await new Promise((r) => setTimeout(r, 500));
  const r1 = { a: await a.evaluate((k) => localStorage.getItem(k), RECORD), b: await b.evaluate((k) => localStorage.getItem(k), RECORD), n: await a.evaluate(() => window.__recEvents.length) };
  assert(r1.a === other && r1.b === other && r1.n === 1, 'a different keyring is left in place', { same: [r1.a === other, r1.b === other], n: r1.n });
  await b.evaluate(() => window.MentriaStore.remove('keyring', 'vault'));
  assert(await until(() => a.evaluate(() => window.__recEvents.length === 2), 5000), 'harness: the first page sees the removal');
  assert(await writeLockIdle(a), 'harness: no write in flight after the removal');
  await new Promise((r) => setTimeout(r, 500));
  const r2 = { a: await a.evaluate((k) => localStorage.getItem(k), RECORD), b: await b.evaluate((k) => localStorage.getItem(k), RECORD), n: await a.evaluate(() => window.__recEvents.length) };
  assert(r2.a === null && r2.b === null && r2.n === 2, 'a removed keyring stays removed', r2);
});

check('link waits for the keyring write lock', async () => {
  await clean();
  const a = await open('/beta/unlock/');
  await enableOnLab(a);
  await createOnLab(a);
  await runtime(a);
  const b = await open('/tools/');
  await holdWriteLock(b);
  await a.evaluate(() => {
    window.__res = undefined;
    window.__m.link('totp', crypto.getRandomValues(new Uint8Array(32))).then(() => { window.__res = 'ok'; }, (e) => { window.__res = e.message; });
  });
  assert(await writeLockPending(a), 'link asks for the keyring write lock');
  const mid = await a.evaluate((k) => ({ res: window.__res === undefined ? null : window.__res, totp: !!JSON.parse(localStorage.getItem(k)).services.totp }), RECORD);
  assert(mid.res === null && mid.totp === false, 'link writes nothing while another page holds the lock', mid);
  await b.evaluate(() => window.__wlRelease());
  assert(await until(() => a.evaluate(() => window.__res !== undefined), 5000), 'harness: the link settles');
  const r = await a.evaluate((k) => ({ res: window.__res, totp: !!JSON.parse(localStorage.getItem(k)).services.totp }), RECORD);
  assert(r.res === 'ok' && r.totp, 'link writes once the lock is free', r);
});

check('secret() and secrets() give nothing when a Lock lands mid-call', async () => {
  await clean();
  const a = await open('/beta/unlock/');
  await enableOnLab(a);
  const c = await createOnLab(a);
  await runtime(a);
  await a.evaluate(() => window.__m.link('notes', crypto.getRandomValues(new Uint8Array(32))));
  const b = await open('/about/');
  const sb = await runtime(b);
  assert(sb.unlocked, 'setup: the second page is unlocked', sb);
  await installCryptoHold(a);
  const AAD = 'mentria-keyring|svc|notes';
  const start = (call) => a.evaluate(([aad, which]) => {
    window.__h = window.__holdCrypto('decrypt', aad);
    window.__res = undefined;
    const m = window.__m;
    (which === 'one' ? m.secret('notes') : m.secrets('notes')).then(
      (v) => { window.__res = { v: v == null ? null : Array.isArray(v) ? v.length : 'bytes' }; },
      (e) => { window.__res = { e: e.message }; }
    );
  }, [AAD, call]);
  const held = () => until(() => a.evaluate(() => window.__h.state === 'held'), 5000);
  const finish = async () => {
    await a.evaluate(() => window.__h.release());
    assert(await until(() => a.evaluate(() => window.__res !== undefined), 5000), 'harness: the call settles');
    return a.evaluate(() => window.__res);
  };
  await start('one');
  assert(await held(), 'harness: the decrypt of secret() is held');
  const control = await finish();
  assert(control.v === 'bytes', 'control: secret() with no Lock gives the bytes', control);
  await a.evaluate(() => { window.__changes = 0; window.__m.onChange(() => { window.__changes++; }); });
  await start('one');
  assert(await held(), 'harness: held before another page writes');
  await b.evaluate(() => window.__m.link('identity', crypto.getRandomValues(new Uint8Array(32))));
  assert(await until(() => a.evaluate(() => window.__changes > 0), 5000), 'harness: the first page refreshed on the other write');
  const kept = await finish();
  assert(kept.v === 'bytes', 'secret() keeps its bytes when another page writes the record mid-call', kept);
  await start('one');
  assert(await held(), 'harness: held again');
  await a.evaluate(() => window.__m.lock());
  const own = await finish();
  assert(own.v === null, 'secret() gives null when this page locks mid-call', own);
  await a.evaluate((x) => window.__m.unlockWithCode(x), c);
  await start('one');
  assert(await held(), 'harness: held before a relock');
  await a.evaluate(async (x) => { await window.__m.lock(); await window.__m.unlockWithCode(x); }, c);
  const relocked = await finish();
  assert(relocked.v === null, 'secret() gives null when the session was replaced mid-call', relocked);
  await start('many');
  assert(await held(), 'harness: the decrypt of secrets() is held');
  await b.evaluate(() => window.__m.lock());
  const e1 = await readLocal(b, 'mentria.keyring.epoch');
  assert(await sees(a, e1), 'harness: the first page sees the other Lock before the release');
  const many = await finish();
  assert(many.v === 0, 'secrets() gives an empty list when another page locks mid-call', many);
  await a.evaluate((x) => window.__m.unlockWithCode(x), c);
  await start('many');
  assert(await held(), 'harness: held for the control');
  const ok = await finish();
  assert(ok.v === 1, 'control: secrets() with no Lock lists the entry', ok);
});

check('link stamps and compares against the record it writes over', async () => {
  await clean();
  const a = await open('/beta/unlock/');
  await enableOnLab(a);
  const c = await createOnLab(a);
  await runtime(a);
  await a.evaluate(() => window.__m.link('notes', crypto.getRandomValues(new Uint8Array(32))));
  const b = await open('/tools/');
  await b.waitForFunction(() => document.readyState === 'complete' && !!window.MentriaStore);
  await installCryptoHold(a);
  const AAD = 'mentria-keyring|svc|notes';
  const begin = (bytes) => a.evaluate(([aad, s]) => {
    window.__h = window.__holdCrypto('encrypt', aad);
    window.__res = undefined;
    window.__m.link('notes', new Uint8Array(s)).then(() => { window.__res = 'ok'; }, (e) => { window.__res = e.message; });
  }, [AAD, bytes]);
  const plant = (args) => b.evaluate(async ({ code, secret, ahead }) => {
    const C = await import('/assets/js/mentria-unlock-core.js');
    const rec = JSON.parse(localStorage.getItem('mentria.store.keyring.vault'));
    const root = await C.rootKeyFrom(await C.openWithCode(rec.wraps.recovery, code));
    const other = JSON.parse(JSON.stringify(rec));
    other.services.notes = await C.sealService(root, 'notes', new Uint8Array(secret), Date.parse(rec.services.notes.linked) + ahead);
    if (window.MentriaStore.set('keyring', 'vault', C.mergeRecords(rec, other)) !== true) throw new Error('write failed');
    return { raw: localStorage.getItem('mentria.store.keyring.vault'), id: other.services.notes.id, linked: other.services.notes.linked };
  }, args);
  const sealHeld = async () => assert(await until(() => a.evaluate(() => window.__h.state === 'held'), 5000), 'harness: the seal is held');
  const rnd = () => Array.from(crypto.getRandomValues(new Uint8Array(32)));
  const s2 = rnd();
  await begin(s2);
  await sealHeld();
  const p1 = await plant({ code: c, secret: rnd(), ahead: 86400000 });
  assert(await until(() => a.evaluate(([k, raw]) => localStorage.getItem(k) === raw, [RECORD, p1.raw]), 5000), 'harness: the first page sees the planted entry');
  await a.evaluate(() => window.__h.release());
  assert(await until(() => a.evaluate(() => window.__res !== undefined), 10000), 'harness: the link settles');
  const r1 = await a.evaluate(async (k) => {
    const rec = JSON.parse(localStorage.getItem(k));
    const s = await window.__m.secret('notes');
    return { res: window.__res, id: window.__m.secretId('notes'), linked: rec.services.notes.linked, prior: (rec.services.notes.prior || []).map((p) => p.id), bytes: s ? Array.from(s).join() : null };
  }, RECORD);
  assert(r1.res === 'ok' && r1.bytes === s2.join() && r1.id !== p1.id, 'the new link stays current over an entry that arrived mid-call', r1);
  assert(Date.parse(r1.linked) > Date.parse(p1.linked) && r1.prior.includes(p1.id), 'it is stamped after that entry and keeps it under prior', { r1, p1 });
  const sx = rnd();
  await begin(sx);
  await sealHeld();
  const p2 = await plant({ code: c, secret: sx, ahead: 1000 });
  assert(await until(() => a.evaluate(([k, raw]) => localStorage.getItem(k) === raw, [RECORD, p2.raw]), 5000), 'harness: the first page sees the second planted entry');
  await a.evaluate(() => window.__h.release());
  assert(await until(() => a.evaluate(() => window.__res !== undefined), 10000), 'harness: the second link settles');
  assert(await writeLockIdle(a), 'harness: no write in flight');
  const r2 = await a.evaluate(async ([k, want]) => {
    const list = await window.__m.secrets('notes');
    return { res: window.__res, raw: localStorage.getItem(k), id: window.__m.secretId('notes'), copies: list.filter((x) => Array.from(x.bytes).join() === want).length };
  }, [RECORD, sx.join()]);
  assert(r2.res === 'ok' && r2.raw === p2.raw && r2.id === p2.id && r2.copies === 1, 'a link whose bytes arrived mid-call writes nothing', { res: r2.res, same: r2.raw === p2.raw, id: [r2.id, p2.id], copies: r2.copies });
});

check('the healing page tells its own listeners', async () => {
  await clean();
  const a = await open('/beta/unlock/');
  await enableOnLab(a);
  await createOnLab(a);
  await runtime(a);
  const b = await open('/about/');
  const sb = await runtime(b);
  assert(sb.unlocked, 'setup: the second page is unlocked', sb);
  const stale = await b.evaluate((k) => localStorage.getItem(k), RECORD);
  await a.evaluate(() => window.__m.link('notes', crypto.getRandomValues(new Uint8Array(32))));
  const linked = await a.evaluate((k) => localStorage.getItem(k), RECORD);
  assert(await until(() => b.evaluate(([k, raw]) => localStorage.getItem(k) === raw, [RECORD, linked]), 5000), 'harness: the second page sees the link');
  await a.evaluate(() => { window.__seen = []; window.__m.onChange((s) => window.__seen.push(s.linked.join())); });
  await countRecordEvents(a);
  await holdWriteLock(b);
  await b.evaluate((raw) => { if (window.MentriaStore.set('keyring', 'vault', JSON.parse(raw)) !== true) throw new Error('write failed'); }, stale);
  assert(await until(() => a.evaluate(() => window.__seen.length > 0 && window.__seen[window.__seen.length - 1] === ''), 5000), 'harness: the listener saw the stale record first');
  assert(await writeLockPending(a), 'harness: the heal waits for the lock');
  await b.evaluate(() => window.__wlRelease());
  assert(await writeLockIdle(a), 'harness: the heal ran');
  const r = await until(() => a.evaluate(() => window.__seen[window.__seen.length - 1] === 'notes'), 3000);
  const info = await a.evaluate(() => ({ seen: window.__seen, events: window.__recEvents.length, linked: window.__m.state().linked }));
  assert(info.linked.join() === 'notes' && info.events === 1, 'harness: the record is healed with no other write', info);
  assert(r, 'a listener on the healing page sees the restored link', info);
});

check('link gives up with busy when the entry keeps changing', async () => {
  await clean();
  const a = await open('/beta/unlock/');
  await enableOnLab(a);
  const c = await createOnLab(a);
  await runtime(a);
  await a.evaluate(() => window.__m.link('notes', crypto.getRandomValues(new Uint8Array(32))));
  const b = await open('/tools/');
  await b.waitForFunction(() => document.readyState === 'complete' && !!window.MentriaStore);
  await installCryptoHold(a);
  const AAD = 'mentria-keyring|svc|notes';
  await a.evaluate((aad) => {
    window.__h = window.__holdCrypto('encrypt', aad);
    window.__res = undefined;
    window.__m.link('notes', crypto.getRandomValues(new Uint8Array(32))).then(() => { window.__res = 'ok'; }, (e) => { window.__res = e.message; });
  }, AAD);
  let planted = null;
  for (let k = 1; k <= 4; k++) {
    assert(await until(() => a.evaluate(() => window.__h.state === 'held'), 5000), 'harness: seal ' + k + ' is held');
    planted = await b.evaluate(async (code) => {
      const C = await import('/assets/js/mentria-unlock-core.js');
      const rec = JSON.parse(localStorage.getItem('mentria.store.keyring.vault'));
      const root = await C.rootKeyFrom(await C.openWithCode(rec.wraps.recovery, code));
      const other = JSON.parse(JSON.stringify(rec));
      other.services.notes = await C.sealService(root, 'notes', crypto.getRandomValues(new Uint8Array(32)), Date.parse(rec.services.notes.linked) + 1000);
      if (window.MentriaStore.set('keyring', 'vault', C.mergeRecords(rec, other)) !== true) throw new Error('write failed');
      return { raw: localStorage.getItem('mentria.store.keyring.vault'), id: other.services.notes.id };
    }, c);
    assert(await until(() => a.evaluate(([key, raw]) => localStorage.getItem(key) === raw, [RECORD, planted.raw]), 5000), 'harness: the first page sees planted entry ' + k);
    await a.evaluate(([aad, more]) => {
      const held = window.__h;
      if (more) window.__h = window.__holdCrypto('encrypt', aad);
      held.release();
    }, [AAD, k < 4]);
  }
  assert(await until(() => a.evaluate(() => window.__res !== undefined), 10000), 'harness: the link settles');
  assert(await writeLockIdle(a), 'harness: no write in flight');
  const r = await a.evaluate((key) => ({ res: window.__res, raw: localStorage.getItem(key), id: window.__m.secretId('notes') }), RECORD);
  assert(r.res === 'busy', 'link rejects with busy after the entry changed on every try', { res: r.res });
  assert(r.raw === planted.raw && r.id === planted.id, 'nothing is written over the newest entry', { same: r.raw === planted.raw, id: [r.id, planted.id] });
});

check('remember decision and pending flags', async () => {
  await clean();
  let page = await open('/beta/unlock/');
  await enableOnLab(page);
  await createOnLab(page);
  await runtime(page);
  const r = await page.evaluate(async () => {
    const m = window.__m;
    const loc = () => JSON.parse(localStorage.getItem('mentria.keyring.local'));
    const out = {};
    out.api = ['rememberDecision', 'setRememberDecision', 'rememberPending', 'setRememberPending'].every((k) => typeof m[k] === 'function');
    if (!out.api) return out;
    out.start = [m.rememberDecision(), m.rememberPending()];
    m.setRememberDecision('on');
    out.on = [m.rememberDecision(), loc().remember];
    m.setRememberDecision('off');
    out.off = [m.rememberDecision(), loc().remember];
    m.setRememberDecision('maybe');
    out.bad = [m.rememberDecision(), 'remember' in loc()];
    m.setRememberPending(true);
    out.pending = [m.rememberPending(), loc().rememberPending];
    m.setRememberPending(false);
    out.unpending = [m.rememberPending(), 'rememberPending' in loc()];
    await m.setRemember(true);
    out.plainOn = [m.rememberDecision(), m.rememberPending(), m.state().hasDevice];
    m.setRememberPending(true);
    await m.setRemember(false, { decided: true });
    out.decidedOff = [m.rememberDecision(), m.rememberPending(), m.state().hasDevice];
    m.setRememberPending(true);
    await m.setRemember(true, { decided: true });
    out.decidedOn = [m.rememberDecision(), m.rememberPending(), m.state().hasDevice];
    await m.setRemember(false);
    out.plainOff = [m.rememberDecision(), m.state().hasDevice];
    out.kept = loc().enabled === true && typeof loc().deviceId === 'string';
    m.setRememberDecision('');
    return out;
  });
  assert(r.api, 'the runtime has the remember decision API', r);
  assert(JSON.stringify(r.start) === '["",false]', 'nothing decided and nothing pending at first', r.start);
  assert(JSON.stringify(r.on) === '["on","on"]' && JSON.stringify(r.off) === '["off","off"]', 'setRememberDecision stores on and off in mentria.keyring.local', r);
  assert(JSON.stringify(r.bad) === '["",false]', 'any other value clears the decision', r.bad);
  assert(JSON.stringify(r.pending) === '[true,true]' && JSON.stringify(r.unpending) === '[false,false]', 'setRememberPending sets and clears the flag', r);
  assert(JSON.stringify(r.plainOn) === '["",false,true]', 'setRemember without decided records nothing', r.plainOn);
  assert(JSON.stringify(r.decidedOff) === '["off",false,false]', 'setRemember(false, decided) records off and clears pending', r.decidedOff);
  assert(JSON.stringify(r.decidedOn) === '["on",false,true]', 'setRemember(true, decided) records on and clears pending', r.decidedOn);
  assert(JSON.stringify(r.plainOff) === '["on",false]' && r.kept, 'setRemember(false) without decided keeps the decision and the other local fields', r);
  await page.reload({ waitUntil: 'load' });
  await runtime(page);
  const silent = await page.evaluate(async () => {
    const m = window.__m;
    m.setRememberPending(true);
    let e = 'no error';
    try { await m.setRemember(true, { decided: true }); } catch (x) { e = x.message; }
    return { e, decision: m.rememberDecision(), pending: m.rememberPending(), root: m.hasRootBytes() };
  });
  assert(silent.e === 'confirm-needed' && silent.decision === '' && silent.pending === true && silent.root === false, 'a decided turn-on that needs a confirm records nothing', silent);
});

async function foldSetup(page, codeA, opts) {
  return page.evaluate(async ([codeA, opts]) => {
    const m = window.__m;
    const C = await import('/assets/js/mentria-unlock-core.js');
    const rd = () => JSON.parse(localStorage.getItem('mentria.store.keyring.vault'));
    const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    const rnd = () => crypto.getRandomValues(new Uint8Array(32));
    const na0 = rnd();
    const na = rnd();
    const ia = rnd();
    await m.link('notes', na0);
    await m.link('notes', na);
    await m.link('identity', ia);
    const recA = rd();
    const codeB = C.newRecoveryCode();
    const made = await C.createRecord({ code: codeB, deviceId: 'dev-b', deviceName: 'Phone' });
    const b0 = made.record;
    const kb = await C.rootKeyFrom(made.rootBytes);
    const nb = rnd();
    const tb = rnd();
    b0.services.notes = await C.sealService(kb, 'notes', nb, Date.now() - 5000);
    b0.services.totp = await C.sealService(kb, 'totp', tb, Date.now() - 5000);
    if (opts && opts.fakePasskey) b0.wraps.prf.push(await C.wrapWithPrf(made.rootBytes, rnd(), { id: C.b64u(rnd().slice(0, 16)), salt: C.b64u(rnd()), label: 'x' }));
    localStorage.setItem('mentria.keyring.others', JSON.stringify([recA]));
    if (window.MentriaStore.set('keyring', 'vault', b0) !== true) throw new Error('harness: write failed');
    window.__fold = { codeB, kcvA: recA.kcv, kcvB: b0.kcv, b0, ids: { na0: recA.services.notes.prior[0].id, na: recA.services.notes.id, ia: recA.services.identity.id, nb: b0.services.notes.id }, hex: { na0: hex(na0), na: hex(na), ia: hex(ia), nb: hex(nb), tb: hex(tb) } };
    return { codeB, kcvA: recA.kcv, kcvB: b0.kcv };
  }, [codeA, opts || {}]);
}

check('fold in another keyring with its recovery code', async () => {
  await clean();
  const page = await open('/beta/unlock/');
  await enableOnLab(page);
  const codeA = await createOnLab(page);
  await runtime(page);
  const api = await page.evaluate(() => typeof window.__m.others === 'function' && typeof window.__m.foldIn === 'function');
  assert(api, 'the runtime has others() and foldIn()');
  const none = await page.evaluate(() => window.__m.others());
  assert(Array.isArray(none) && none.length === 0, 'no other keyring at first', none);
  await foldSetup(page, codeA);
  const r = await page.evaluate(async (codeA) => {
    const m = window.__m;
    const F = window.__fold;
    const C = await import('/assets/js/mentria-unlock-core.js');
    const rd = () => JSON.parse(localStorage.getItem('mentria.store.keyring.vault'));
    const hex = (b) => (b ? Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('') : null);
    const err = async (fn) => { try { await fn(); return 'no error'; } catch (e) { return e.message; } };
    const out = { kcvB: F.kcvB };
    out.locked = m.state().unlocked;
    out.lockedFold = await err(() => m.foldIn(F.kcvA, { code: codeA }));
    await m.unlockWithCode(F.codeB);
    out.list = m.others();
    const empty = (await C.createRecord({ code: C.newRecoveryCode(), deviceId: 'dev-e' })).record;
    localStorage.setItem('mentria.keyring.others', JSON.stringify([rd(), JSON.parse(localStorage.getItem('mentria.keyring.others'))[0], { junk: 1 }, empty]));
    out.listMixed = m.others().map((o) => o.kcv);
    out.emptyKept = JSON.parse(localStorage.getItem('mentria.keyring.others')).some((x) => x && x.kcv === empty.kcv);
    out.wrong = await err(() => m.foldIn(F.kcvA, { code: F.codeB }));
    out.unknown = await err(() => m.foldIn('nope', { code: codeA }));
    out.noPass = await err(() => m.foldIn(F.kcvA, { passphrase: 'a long passphrase here' }));
    out.noMethod = await err(() => m.foldIn(F.kcvA, {}));
    out.stashed = JSON.parse(localStorage.getItem('mentria.keyring.others')).length;
    const before = Date.now();
    out.fold = await err(() => m.foldIn(F.kcvA, { code: codeA }));
    out.after = m.others();
    out.stash = JSON.parse(localStorage.getItem('mentria.keyring.others'));
    out.notes = (await m.secrets('notes')).map((x) => [x.id, hex(x.bytes)]);
    out.wantNotes = [[F.ids.nb, F.hex.nb], [F.ids.na, F.hex.na], [F.ids.na0, F.hex.na0]];
    out.notesCur = hex(await m.secret('notes')) === F.hex.nb && m.secretId('notes') === F.ids.nb;
    out.identity = hex(await m.secret('identity')) === F.hex.ia && m.secretId('identity') === F.ids.ia;
    out.totp = hex(await m.secret('totp')) === F.hex.tb;
    out.linked = m.state().linked;
    const rec = rd();
    out.older = rec.services.notes.prior.every((p) => Date.parse(p.linked) < Date.parse(rec.services.notes.linked));
    out.fresh = Date.parse(rec.services.identity.linked) >= before - 1000;
    out.valid = C.isRecord(rec) && rec.kcv === F.kcvB;
    out.again = await err(() => m.foldIn(F.kcvA, { code: codeA }));
    out.peer = C.mergeRecords(F.b0, rec).services.notes.prior.length === 2 && C.mergeRecords(rec, F.b0).services.identity.id === F.ids.ia;
    m.setEnabled(false);
    out.off = m.others();
    m.setEnabled(true);
    return out;
  }, codeA);
  assert(r.locked === false && r.lockedFold === 'locked', 'foldIn needs the current session', r);
  assert(r.list.length === 1 && r.list[0].kcv !== undefined && JSON.stringify(r.list[0].services) === '["identity","notes"]' && typeof r.list[0].created === 'string', 'others() lists the stashed keyring and what it holds', r.list);
  assert(r.listMixed.length === 1 && r.emptyKept, 'others() skips the current keyring, unreadable entries and a keyring with nothing to bring in (which stays stored)', r);
  assert(r.wrong === 'bad-code' && r.unknown === 'no-keyring' && r.noPass === 'no-pass' && r.noMethod === 'bad-input' && r.stashed === 4, 'failed fold-ins keep the stash', r);
  assert(r.fold === 'no error' && r.after.length === 0, 'the fold-in succeeds and others() is empty', r);
  assert(Array.isArray(r.stash) && r.stash.length === 3 && r.stash[0].kcv === r.kcvB && r.stash[1].junk === 1 && r.stash[2].kcv !== r.kcvB, 'only the folded entry leaves the stash', r.stash);
  assert(JSON.stringify(r.notes) === JSON.stringify(r.wantNotes) && r.notesCur && r.older, 'the other keyring\'s notes secrets join as prior entries with their ids, the current one stays', r);
  assert(r.identity && r.fresh && r.totp && JSON.stringify(r.linked) === '["identity","totp","notes"]', 'a service only the other keyring had becomes current here', r);
  assert(r.valid && r.again === 'no-keyring' && r.peer, 'the record stays valid and merges with another device on this keyring', r);
  assert(JSON.stringify(r.off) === '[]', 'switch off lists nothing', r.off);
});

check('fold in another keyring with its passkey', async () => {
  await clean();
  const page = await open('/beta/unlock/');
  const cdp = await page.createCDPSession();
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true }
  });
  await enableOnLab(page);
  const codeA = await createOnLab(page);
  await runtime(page);
  const add = await clickCall(page, "(m) => m.addPasskey('Old')");
  assert(add.ok, 'setup: passkey on the first keyring', add);
  const f = await foldSetup(page, codeA);
  await page.evaluate((c) => window.__m.unlockWithCode(c), f.codeB);
  const list = await page.evaluate(() => window.__m.others());
  assert(list.length === 1 && list[0].passkeys === 1, 'others() says the stashed keyring has a passkey', list);
  const fold = await clickCall(page, "(m) => m.foldIn(window.__fold.kcvA, { passkey: true })");
  assert(fold.ok, 'foldIn with the stashed keyring\'s passkey from a click', fold);
  const r = await page.evaluate(async () => {
    const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return { others: window.__m.others().length, notes: (await window.__m.secrets('notes')).map((x) => hex(x.bytes)), want: window.__fold.hex };
  });
  assert(r.others === 0 && r.notes.includes(r.want.na) && r.notes.includes(r.want.nb), 'the passkey fold-in brings the secrets', r);
});

check('a new recovery code takes effect only after its last four', async () => {
  await clean();
  const page = await open('/beta/unlock/');
  await enableOnLab(page);
  const first = await createOnLab(page);
  await runtime(page);
  const r = await page.evaluate(async (oldCode) => {
    const m = window.__m;
    const C = await import('/assets/js/mentria-unlock-core.js');
    const key = 'mentria.store.keyring.vault';
    const rd = () => JSON.parse(localStorage.getItem(key));
    const opens = (code) => C.openWithCode(rd().wraps.recovery, code).then(() => true, () => false);
    const out = {};
    out.firstConfirm = m.confirmCode(oldCode.replace(/-/g, '').slice(-4));
    const raw0 = localStorage.getItem(key);
    const fresh = await m.regenerateCode();
    out.unchanged = localStorage.getItem(key) === raw0;
    out.confirmedMeanwhile = m.state().codeConfirmed;
    out.oldOpens = await opens(oldCode);
    out.newOpens = await opens(fresh);
    out.wrong = m.confirmCode('ZZZZ');
    out.unchangedAfterWrong = localStorage.getItem(key) === raw0;
    out.right = m.confirmCode(fresh.replace(/-/g, '').slice(-4));
    out.newNow = await opens(fresh);
    out.oldNow = await opens(oldCode);
    out.confirmed = m.state().codeConfirmed;
    const bk = await m.backupKey();
    const fromCode = await C.backupKeyFromCode(fresh, bk.salt);
    out.backup = bk.key.length === 32 && bk.key.every((b, i) => b === fromCode[i]);
    window.__fresh = fresh;
    window.__second = await m.regenerateCode();
    return out;
  }, first);
  assert(r.firstConfirm && r.unchanged && r.confirmedMeanwhile, 'regenerateCode writes nothing before the last four', r);
  assert(r.oldOpens && !r.newOpens, 'until then the old code still opens and the new one does not', r);
  assert(r.wrong === false && r.unchangedAfterWrong, 'a wrong last four writes nothing', r);
  assert(r.right && r.newNow && !r.oldNow && r.confirmed && r.backup, 'the right last four writes the new code and its backup entry', r);
  const fresh = await page.evaluate(() => window.__fresh);
  const second = await page.evaluate(() => window.__second);
  const raw1 = await page.evaluate(() => localStorage.getItem('mentria.store.keyring.vault'));
  await page.reload({ waitUntil: 'load' });
  await runtime(page);
  const after = await page.evaluate(async ([fresh, second]) => {
    const m = window.__m;
    const C = await import('/assets/js/mentria-unlock-core.js');
    const rec = JSON.parse(localStorage.getItem('mentria.store.keyring.vault'));
    return {
      late: m.confirmCode(second.replace(/-/g, '').slice(-4)),
      raw: localStorage.getItem('mentria.store.keyring.vault'),
      fresh: await C.openWithCode(rec.wraps.recovery, fresh).then(() => true, () => false),
      second: await C.openWithCode(rec.wraps.recovery, second).then(() => true, () => false)
    };
  }, [fresh, second]);
  assert(after.late === false && after.raw === raw1 && after.fresh && !after.second, 'a reload drops a code that was never confirmed', after);
});

check('every record write merges with what is stored now', async () => {
  await clean();
  const page = await open('/beta/unlock/');
  await enableOnLab(page);
  const c = await createOnLab(page);
  await runtime(page);
  const r = await page.evaluate(async (code) => {
    const m = window.__m;
    const C = await import('/assets/js/mentria-unlock-core.js');
    const S = window.MentriaStore;
    const key = 'mentria.store.keyring.vault';
    const rd = () => JSON.parse(localStorage.getItem(key));
    const rnd = () => crypto.getRandomValues(new Uint8Array(32));
    const bytes = await C.openWithCode(rd().wraps.recovery, code);
    const root = await C.rootKeyFrom(bytes);
    let n = 0;
    const arm = async () => {
      const name = ['identity', 'totp', 'notes', 'finance'][n++ % 4];
      const entry = await C.sealService(root, name, rnd(), Date.now() + n);
      const get = S.get;
      S.get = function (...a) {
        const v = get.apply(this, a);
        if (a[0] === 'keyring' && a[1] === 'vault') {
          S.get = get;
          const cur = JSON.parse(localStorage.getItem(key));
          cur.services[name] = entry;
          localStorage.setItem(key, JSON.stringify(cur));
        }
        return v;
      };
      return () => !!rd().services[name] && rd().services[name].id === entry.id;
    };
    const out = {};
    let kept = await arm();
    out.confirm = m.confirmCode(code.replace(/-/g, '').slice(-4)) && !!rd().codeConfirmed;
    out.confirmKept = kept();
    const fake = await C.wrapWithPrf(bytes, rnd(), { id: C.b64u(rnd().slice(0, 16)), salt: C.b64u(rnd()), label: 'fake' });
    const withKey = rd();
    withKey.wraps.prf.push(fake);
    S.set('keyring', 'vault', withKey);
    kept = await arm();
    await m.removePasskey(fake.id);
    out.removed = !!rd().wraps.prf.find((e) => e.id === fake.id && e.removed);
    out.removeKept = kept();
    await m.setPassphrase('correct horse battery');
    kept = await arm();
    await m.setPassphrase(null);
    out.passGone = !!rd().wraps.pass.removed;
    out.passKept = kept();
    kept = await arm();
    await m.markRetired('totp');
    out.retired = !!rd().retired.totp;
    out.retireKept = kept();
    const base = rd();
    const lost = JSON.parse(JSON.stringify(base));
    lost.services.notes = await C.sealService(root, 'notes', rnd(), Date.now() + 99999);
    const newer = JSON.stringify(lost);
    const stale = JSON.parse(JSON.stringify(base));
    delete stale.services.notes;
    stale.devices.other = { name: 'x', lastSeen: new Date().toISOString(), app: '', keyring: 1 };
    localStorage.setItem(key, JSON.stringify(stale));
    window.dispatchEvent(new StorageEvent('storage', { key, oldValue: JSON.stringify(base), newValue: newer, storageArea: localStorage }));
    const end = Date.now() + 3000;
    while (Date.now() < end && !(rd().services.notes && rd().services.notes.id === lost.services.notes.id)) await new Promise((res) => setTimeout(res, 50));
    out.healNew = !!rd().services.notes && rd().services.notes.id === lost.services.notes.id && !!rd().devices.other;
    out.valid = C.isRecord(rd());
    return out;
  }, c);
  assert(r.confirm && r.confirmKept, 'confirmCode keeps a write that landed after its read', r);
  assert(r.removed && r.removeKept, 'removePasskey keeps a write that landed after its read', r);
  assert(r.passGone && r.passKept, 'removing the passphrase keeps a write that landed after its read', r);
  assert(r.retired && r.retireKept, 'markRetired keeps a write that landed after its read', r);
  assert(r.healNew && r.valid, 'healing merges the event\'s new value too', r);
});

check('switch off deletes the session and the lab names retired locks', async () => {
  await clean();
  const page = await open('/beta/unlock/');
  await enableOnLab(page);
  await createOnLab(page);
  await runtime(page);
  assert(await sessionRow(page), 'setup: a session row');
  await page.evaluate(() => window.__m.setEnabled(false));
  assert(await until(async () => (await sessionRow(page)) === null, 6000), 'turning the switch off deletes the session row');
  const s = await page.evaluate(() => { window.__m.setEnabled(true); return window.__m.state(); });
  assert(s.enabled && s.setUp && !s.unlocked, 'turning it on again finds the keyring locked', s);
  const warn0 = await page.evaluate(() => { const el = document.getElementById('unlock-retired'); return el ? { hidden: el.hidden, text: el.textContent.trim() } : null; });
  assert(warn0 && warn0.hidden, 'no retired line while nothing is retired', warn0);
  await page.evaluate(() => {
    const rec = JSON.parse(localStorage.getItem('mentria.store.keyring.vault'));
    rec.retired = { notes: new Date().toISOString(), totp: new Date().toISOString() };
    localStorage.setItem('mentria.store.keyring.vault', JSON.stringify(rec));
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => { const el = document.getElementById('unlock-retired'); return el && !el.hidden; }, { timeout: 5000 }).catch(() => {});
  const warn = await page.evaluate(() => { const el = document.getElementById('unlock-retired'); return el ? { hidden: el.hidden, text: el.textContent.trim() } : null; });
  const lang = await page.evaluate(() => document.documentElement.lang || 'en');
  const want = EN.tester_retired.replace('{services}', new Intl.ListFormat(lang, { type: 'conjunction' }).format([EN.services.totp, EN.services.notes]));
  assert(warn && !warn.hidden && warn.text === want, 'the lab says which old locks are gone', { warn, want });
});

check('a stuck database times out and Lock still tells other pages', async () => {
  await clean();
  const a = await open('/beta/unlock/');
  await enableOnLab(a);
  const c = await createOnLab(a);
  await runtime(a);
  const b = await open('/about/');
  await runtime(b);
  await b.evaluate(() => {
    window.__bc = [];
    const ch = new BroadcastChannel('mentria-unlock');
    ch.onmessage = (e) => window.__bc.push(e.data && e.data.type);
    window.__bcKeep = ch;
  });
  await installHold(a);
  await a.evaluate(() => { window.__h = window.__hold('mentria-unlock.js'); });
  const r = await a.evaluate(() => new Promise((res) => {
    const t = Date.now();
    window.__m.lock().then(() => res({ ok: true, ms: Date.now() - t }), (e) => res({ ok: false, e: e.message, ms: Date.now() - t }));
    setTimeout(() => res({ ok: false, e: 'hung', ms: Date.now() - t }), 25000);
  }));
  assert(await a.evaluate(() => window.__h.state) === 'held', 'harness: a database open is stuck');
  assert(r.ok && r.ms < 22000, 'Lock settles after the database timeout', r);
  assert(await until(() => b.evaluate(() => window.__bc.includes('lock')), 3000), 'the other page hears the lock');
  await a.evaluate(() => { window.__h2 = window.__hold('mentria-unlock.js'); });
  const u = await a.evaluate((code) => new Promise((res) => {
    const t = Date.now();
    window.__m.unlockWithCode(code).then(() => res({ ok: true }), (e) => res({ ok: false, e: e.message, ms: Date.now() - t }));
    setTimeout(() => res({ ok: false, e: 'hung' }), 25000);
  }), c);
  assert(!u.ok && u.e === 'idb' && u.ms >= 9500 && u.ms < 22000, 'an unlock with a stuck database open rejects with idb after the 10 s open timeout', u);
});

check('a slow database open gets 10 s; a stuck transaction gives up after 4 s', async () => {
  await clean();
  const a = await open('/beta/unlock/');
  await enableOnLab(a);
  await createOnLab(a);
  await runtime(a);
  await installHold(a);
  await a.evaluate(() => {
    window.__h = window.__hold('mentria-unlock.js');
    setTimeout(() => window.__h.release(), 6000);
  });
  const slow = await a.evaluate(() => new Promise((res) => {
    const t = Date.now();
    window.__m.lock().then(() => res({ ok: true, ms: Date.now() - t }), (e) => res({ ok: false, e: e.message, ms: Date.now() - t }));
    setTimeout(() => res({ ok: false, e: 'hung' }), 20000);
  }));
  assert(slow.ok && slow.ms >= 5500, 'Lock waits for a slow open', slow);
  assert(await sessionRow(a) === null, 'the slow open still deletes the session row', await sessionRow(a));
  await a.evaluate(() => window.__m.unlockWithCode(document.getElementById('unlock-code').textContent.trim()));
  assert(await sessionRow(a), 'setup: unlocked again with a session row');
  await a.evaluate(() => new Promise((res, rej) => {
    const q = indexedDB.open('mentria-keyring', 1);
    q.onerror = () => rej(q.error);
    q.onsuccess = () => {
      const st = q.result.transaction('session', 'readwrite').objectStore('session');
      window.__spin = true;
      const spin = () => { if (window.__spin) st.get('nothing').onsuccess = spin; };
      spin();
      res();
    };
  }));
  const stuck = await a.evaluate(() => new Promise((res) => {
    const t = Date.now();
    window.__m.lock().then(() => res({ ok: true, ms: Date.now() - t }), (e) => res({ ok: false, e: e.message, ms: Date.now() - t }));
    setTimeout(() => res({ ok: false, e: 'hung' }), 20000);
  }));
  await a.evaluate(() => { window.__spin = false; });
  assert(stuck.ok && stuck.ms >= 3500 && stuck.ms < 9000, 'a stuck transaction gives up after about 4 s and Lock settles', stuck);
});

check('create waits for the keyring write lock', async () => {
  await clean();
  const a = await open('/beta/unlock/');
  await enableOnLab(a);
  await runtime(a);
  const b = await open('/about/');
  await b.waitForFunction(() => document.readyState === 'complete' && !!window.MentriaStore);
  await holdWriteLock(b);
  await a.evaluate(() => {
    window.__res = undefined;
    window.__m.create({}).then(() => { window.__res = { ok: true }; }, (e) => { window.__res = { ok: false, e: e.message }; });
  });
  await new Promise((r) => setTimeout(r, 1500));
  const mid = await a.evaluate(() => ({ raw: localStorage.getItem('mentria.store.keyring.vault'), res: window.__res === undefined ? 'pending' : window.__res }));
  assert(mid.raw === null && mid.res === 'pending', 'create writes nothing while another page holds the write lock', mid);
  const planted = await b.evaluate(async () => {
    const C = await import('/assets/js/mentria-unlock-core.js');
    const { record } = await C.createRecord({ code: C.newRecoveryCode(), deviceId: 'other' });
    localStorage.setItem('mentria.store.keyring.vault', JSON.stringify(record));
    window.__wlRelease();
    return localStorage.getItem('mentria.store.keyring.vault');
  });
  assert(await until(() => a.evaluate(() => window.__res !== undefined), 10000), 'harness: the create settles');
  const r = await a.evaluate(() => ({ res: window.__res, raw: localStorage.getItem('mentria.store.keyring.vault') }));
  assert(r.res.ok === false && r.res.e === 'exists' && r.raw === planted, 'after the lock it sees the other record and stops', r);
});

check('frames never hold the open lock', async () => {
  await clean();
  const FRAME = '/extensions/finance/app/';
  const lab = await open('/beta/unlock/');
  await enableOnLab(lab);
  await createOnLab(lab);
  await closeAll();
  const host = await open('/robots.txt');
  await host.evaluate((src) => new Promise((res) => {
    const f = document.createElement('iframe');
    f.src = src;
    f.onload = () => res();
    document.body.appendChild(f);
  }), FRAME);
  const frame = host.frames().find((f) => f.url().includes(FRAME));
  await bootFrom(frame);
  const fs = await frame.evaluate(async (url) => { const m = await import(url); await m.ready(); return m.state(); }, MODULE);
  await new Promise((r) => setTimeout(r, 300));
  const held = await host.evaluate(async () => ((await navigator.locks.query()).held || []).filter((l) => l.name === 'mentria-open').length);
  assert(fs.setUp && held === 0, 'a frame holds no open lock', { held, fs });
  const top = await open('/tools/');
  await runtime(top);
  const held2 = await top.evaluate(async () => ((await navigator.locks.query()).held || []).filter((l) => l.name === 'mentria-open').length);
  assert(held2 === 1, 'control: a top page holds it', held2);
});

check('a fold-in keeps the stash when one of its entries does not open', async () => {
  await clean();
  const page = await open('/beta/unlock/');
  await enableOnLab(page);
  const codeA = await createOnLab(page);
  await runtime(page);
  await foldSetup(page, codeA);
  const r = await page.evaluate(async (codeA) => {
    const m = window.__m;
    const F = window.__fold;
    const hex = (b) => (b ? Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('') : null);
    const list = JSON.parse(localStorage.getItem('mentria.keyring.others'));
    const bad = list[0].services.notes.prior[0];
    bad.ct = (bad.ct[0] === 'A' ? 'B' : 'A') + bad.ct.slice(1);
    localStorage.setItem('mentria.keyring.others', JSON.stringify(list));
    await m.unlockWithCode(F.codeB);
    let e = 'no error';
    try { await m.foldIn(F.kcvA, { code: codeA }); } catch (x) { e = x.message; }
    const notes = (await m.secrets('notes')).map((x) => hex(x.bytes));
    return { e, others: m.others().map((o) => o.kcv), kcvA: F.kcvA, na: notes.includes(F.hex.na), ia: hex(await m.secret('identity')) === F.hex.ia };
  }, codeA);
  assert(r.e === 'no error' && r.na && r.ia, 'what opened is brought in', r);
  assert(r.others.length === 1 && r.others[0] === r.kcvA, 'the stash stays while one of its entries did not open', r);
});

check('create drops a pending new code', async () => {
  await clean();
  const page = await open('/beta/unlock/');
  await enableOnLab(page);
  await createOnLab(page);
  await runtime(page);
  const r = await page.evaluate(async () => {
    const m = window.__m;
    const pending = await m.regenerateCode();
    localStorage.removeItem('mentria.store.keyring.vault');
    const made = await m.create({});
    const fresh = m.confirmCode(made.code.replace(/-/g, '').slice(-4));
    return { fresh, stale: m.confirmCode(pending.replace(/-/g, '').slice(-4)), confirmed: m.state().codeConfirmed };
  });
  assert(r.stale === false && r.fresh === true && r.confirmed, 'after create only the new keyring\'s code confirms', r);
});

check('an unreadable stash is never overwritten', async () => {
  await clean();
  const page = await open('/beta/unlock/');
  await enableOnLab(page);
  await runtime(page);
  const r = await page.evaluate(async () => {
    localStorage.setItem('mentria.keyring.others', '{broken');
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function () { throw new DOMException('blocked for the check', 'UnknownError'); };
    let e = null;
    try { await window.__m.create({}); } catch (x) { e = x.message || x.name; }
    IDBObjectStore.prototype.put = put;
    return { e, stash: localStorage.getItem('mentria.keyring.others'), others: window.__m.others() };
  });
  assert(r.e && r.stash === '{broken' && JSON.stringify(r.others) === '[]', 'a rollback leaves an unreadable stash as it is', r);
});

const TRYSTERO_STUB = "export const selfId = 'self-peer';\nexport function joinRoom(config, roomId) { return window.__fakeRoom(config, roomId); }\n";

async function device(name, services) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setBypassServiceWorker(true);
  await page.setRequestInterception(true);
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.origin !== ORIGIN) { r.abort().catch(() => {}); return; }
    if (u.pathname === '/assets/vendor/trystero-nostr.js') { r.respond({ status: 200, contentType: 'text/javascript', body: TRYSTERO_STUB }).catch(() => {}); return; }
    r.continue().catch(() => {});
  });
  await page.goto(ORIGIN + '/beta/unlock/', { waitUntil: 'load' });
  await enableOnLab(page);
  const c = await createOnLab(page);
  await runtime(page);
  const secrets = await page.evaluate(async (list) => {
    const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    const out = {};
    for (const n of list) {
      const s = crypto.getRandomValues(new Uint8Array(32));
      await window.__m.link(n, s);
      out[n] = hex(s);
    }
    window.mentriaConfirm = async (msg) => { (window.__asked = window.__asked || []).push(msg); return true; };
    return out;
  }, services);
  const rec = await readLocal(page, 'mentria.store.keyring.vault');
  return { name, ctx, page, code: c, secrets, kcv: rec.kcv, raw: await page.evaluate(() => localStorage.getItem('mentria.store.keyring.vault')) };
}

async function allSecrets(page) {
  return page.evaluate(async () => {
    const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    const out = {};
    for (const n of ['identity', 'totp', 'notes', 'finance']) out[n] = (await window.__m.secrets(n)).map((x) => hex(x.bytes));
    return out;
  });
}

function opensAll(have, ...devices) {
  const missing = [];
  for (const d of devices) for (const [n, s] of Object.entries(d.secrets)) if (!(have[n] || []).includes(s)) missing.push(d.name + ':' + n);
  return missing;
}

async function syncSnapshot(page, raw) {
  return page.evaluate(async (raw) => {
    window.__rooms = [];
    window.__fakeRoom = (config, roomId) => {
      const room = { roomId, sent: [], action: null, onPeerJoin: null, onPeerLeave: null, leave: async () => {} };
      room.makeAction = (name) => { const a = { name, onMessage: null, send: (p, to) => room.sent.push({ p, to }) }; room.action = a; return a; };
      window.__rooms.push(room);
      return room;
    };
    await import('/assets/js/mentria-sync.js');
    const S = window.MentriaSync;
    const secret = new Uint8Array(32).fill(7);
    await S.joinWithIdentity(secret);
    const room = window.__rooms[window.__rooms.length - 1];
    const te = new TextEncoder();
    const bucket = String(Math.floor(Date.now() / (7 * 24 * 3600 * 1000)));
    const base = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: te.encode('mentria-identity-key-v1'), info: te.encode('aes-gcm-256|w' + bucket) }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const b64 = (u) => { let s = ''; for (const x of u) s += String.fromCharCode(x); return btoa(s); };
    const msg = { op: 'snapshot', v: 2, data: { version: 1, exportedAt: new Date().toISOString(), store: { 'keyring.vault': raw }, legacy: {} }, meta: { 'keyring.vault': Date.now() + 60000 }, tombs: {}, app: 'beta', keyring: 1, device: { id: 'dev-other', name: 'Other' } };
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(JSON.stringify(msg))));
    const n = S.status().handled;
    room.action.onMessage({ iv: b64(iv), ct: b64(ct) }, { peerId: 'peer-1' });
    for (let i = 0; i < 200 && S.status().handled === n; i++) await new Promise((r) => setTimeout(r, 50));
    const handled = S.status().handled > n;
    await S.disconnect();
    return { handled, asked: (window.__asked || []).length };
  }, raw);
}

check('two keyrings meeting through sync or restore: everything opens after a fold-in', async () => {
  await clean();
  const A = await device('A', ['notes', 'totp']);
  const B = await device('B', ['notes', 'identity']);
  const C = await device('C', ['notes', 'finance']);
  try {
    const s = await syncSnapshot(A.page, B.raw);
    assert(s.handled && s.asked === 1, 'harness: the snapshot was handled and the replace prompt answered', s);
    const a1 = await A.page.evaluate(() => ({ kcv: JSON.parse(localStorage.getItem('mentria.store.keyring.vault')).kcv, others: window.__m.others(), unlocked: window.__m.state().unlocked }));
    assert(a1.kcv === B.kcv && !a1.unlocked, 'sync replaced A\'s keyring with B\'s', a1);
    assert(a1.others.length === 1 && a1.others[0].kcv === A.kcv && JSON.stringify(a1.others[0].services) === '["totp","notes"]', 'A\'s own keyring is kept on the side', a1.others);
    await A.page.evaluate((c) => window.__m.unlockWithCode(c), B.code);
    const before = await allSecrets(A.page);
    assert(opensAll(before, A).length === 2 && !opensAll(before, B).length, 'before the fold-in only B\'s secrets open on A', { missing: opensAll(before, A, B) });
    await A.page.evaluate(([k, c]) => window.__m.foldIn(k, { code: c }), [A.kcv, A.code]);
    const after = await allSecrets(A.page);
    assert(!opensAll(after, A, B).length, 'after the fold-in A opens its own and B\'s secrets', { missing: opensAll(after, A, B) });
    assert(after.notes[0] === B.secrets.notes, 'B\'s notes secret stays current', after.notes);
    await A.page.reload({ waitUntil: 'load' });
    await runtime(A.page);
    await A.page.evaluate(() => window.__m.lock());
    await A.page.evaluate((c) => window.__m.unlockWithCode(c), B.code);
    const again = await allSecrets(A.page);
    assert(!opensAll(again, A, B).length && (await A.page.evaluate(() => window.__m.others().length)) === 0, 'it all still opens after a reload and a fresh unlock', { missing: opensAll(again, A, B) });

    const r = await C.page.evaluate(async (raw) => {
      const data = { version: 1, exportedAt: new Date().toISOString(), store: { 'keyring.vault': raw }, legacy: {} };
      const res = await window.MentriaBackup.applyRestore(data, { replace: 'R {areas}', keyringVault: 'KEYRING?', totpVault: 'T?', identityVault: 'I?' });
      return { res, asked: window.__asked || [], kcv: JSON.parse(localStorage.getItem('mentria.store.keyring.vault')).kcv, others: window.__m.others().map((o) => o.kcv) };
    }, B.raw);
    assert(r.asked.includes('KEYRING?') && r.kcv === B.kcv && JSON.stringify(r.others) === JSON.stringify([C.kcv]), 'restore replaced C\'s keyring and kept C\'s on the side', r);
    await C.page.evaluate((c) => window.__m.unlockWithCode(c), B.code);
    await C.page.evaluate(([k, c]) => window.__m.foldIn(k, { code: c }), [C.kcv, C.code]);
    const c2 = await allSecrets(C.page);
    assert(!opensAll(c2, C, B).length, 'after the fold-in C opens its own and B\'s secrets', { missing: opensAll(c2, C, B) });
  } finally {
    for (const d of [A, B, C]) await d.ctx.close().catch(() => {});
  }
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
