import { rmSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { serve } from './unlock-serve.mjs';

const BUILD = process.argv[2];
if (!BUILD) { console.log('usage: node scripts/unlock-identity-check.mjs <beta build> [<legacy build>]'); process.exit(2); }
const LEGACY = process.argv[3] || join(tmpdir(), 'unlock-legacy-build');
const PORT = 8093;
const ORIGIN = 'http://localhost:' + PORT;
const PROFILE = join(tmpdir(), 'unlock-identity-check-profile');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const RUNTIME = '/assets/js/mentria-unlock.js';
const UI = '/assets/js/mentria-unlock-ui.js';
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EN = JSON.parse(readFileSync(join(REPO, 'src/_data/i18n/en.json'), 'utf8'));
const ONLY = (process.env.ONLY || '').split('|').filter(Boolean);
const SHOTS = process.env.SHOTS || '';
const IDENTITY = 'mentria.store.identity.vault';
const KEYRING = 'mentria.store.keyring.vault';
const IDKEYS = 'mentria.store.comms.idkeys';
const LOCAL = 'mentria.keyring.local';
const CODE_SHAPE = /^[a-hj-km-np-z2-9]{5}(-[a-hj-km-np-z2-9]{5}){3}$/;
const AUTH = { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true };
const PASSPHRASE = 'correct horse 42';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rigs = new WeakMap();
const checks = [];
const check = (name, fn) => checks.push([name, fn]);
const shared = {};

function assert(cond, msg, extra) {
  if (!cond) throw new Error(msg + (extra === undefined ? '' : ' ' + JSON.stringify(extra)));
}

if (SHOTS) mkdirSync(SHOTS, { recursive: true });
rmSync(PROFILE, { recursive: true, force: true });
const server = serve(PORT);
await server.ready;
server.setRoot(BUILD);
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  userDataDir: PROFILE,
  protocolTimeout: 240000,
  args: ['--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE localhost', '--no-first-run', '--no-default-browser-check']
});

const CRED_PROBE = () => {
  window.__wa = [];
  window.__tick = false;
  window.addEventListener('click', () => {
    window.__tick = true;
    setTimeout(() => { window.__tick = false; }, 0);
  }, true);
  const c = navigator.credentials;
  if (!c) return;
  const create = c.create.bind(c);
  const get = c.get.bind(c);
  c.create = (o) => { window.__wa.push('create:' + window.__tick); return create(o); };
  c.get = (o) => { window.__wa.push('get:' + window.__tick); return get(o); };
};

const SIGNAL_PROBE = () => {
  window.__signals = [];
  if (window.PublicKeyCredential) {
    PublicKeyCredential.signalUnknownCredential = async (o) => { window.__signals.push(o); };
  }
};

async function open(path, { auth = false, init } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const rig = { page, cdp: null, auth: null, errors: [], dialogs: [] };
  rigs.set(page, rig);
  page.on('pageerror', (e) => rig.errors.push(String((e && e.message) || e).slice(0, 300)));
  page.on('dialog', async (d) => {
    rig.dialogs.push(d.type() + ': ' + d.message().slice(0, 120));
    try { if (d.type() === 'beforeunload') await d.accept(); else await d.dismiss(); } catch (_) {}
  });
  if (auth) {
    rig.cdp = await page.createCDPSession();
    await rig.cdp.send('WebAuthn.enable', { enableUI: false });
    rig.auth = (await rig.cdp.send('WebAuthn.addVirtualAuthenticator', { options: AUTH })).authenticatorId;
  }
  await page.evaluateOnNewDocument(CRED_PROBE);
  if (init) await page.evaluateOnNewDocument(init);
  if (path) await page.goto(ORIGIN + path, { waitUntil: 'load' });
  return page;
}

async function closeAll() {
  for (const p of await browser.pages()) await p.close();
}

async function clean() {
  await closeAll();
  const blank = await browser.newPage();
  await blank.goto(ORIGIN + '/robots.txt');
  const s = await blank.createCDPSession();
  await s.send('Storage.clearDataForOrigin', { origin: ORIGIN, storageTypes: 'all' });
  await s.detach();
  await blank.close();
}

async function fresh(on) {
  await clean();
  const p = await browser.newPage();
  await p.goto(ORIGIN + '/robots.txt');
  await p.evaluate((k, v) => { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); }, LOCAL, on ? JSON.stringify({ enabled: true }) : null);
  await p.close();
}

async function setSwitch(page, on) {
  await page.evaluate((k, v) => { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); }, LOCAL, on ? JSON.stringify({ enabled: true }) : null);
}

function readJson(page, key) {
  return page.evaluate((k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } }, key);
}

async function until(fn, ms, what) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if (await fn()) return true; } catch (_) {}
    await sleep(120);
  }
  let last = null;
  try { last = await fn(); } catch (e) { last = String(e && e.message); }
  if (!last) throw new Error('timed out: ' + what);
  return true;
}

function visible(page, sel) {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  }, sel);
}

async function waitVisible(page, sel, ms = 20000) {
  await until(() => visible(page, sel), ms, sel + ' visible');
}

async function waitHidden(page, sel, ms = 20000) {
  await until(async () => !(await visible(page, sel)), ms, sel + ' hidden');
}

async function text(page, sel) {
  return page.$eval(sel, (el) => el.textContent.trim());
}

async function typeInto(page, sel, value) {
  await page.$eval(sel, (el) => {
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.type(sel, value);
}

async function runtime(page) {
  return page.evaluate(async (u) => {
    const m = await import(u);
    await m.ready();
    return m.state();
  }, RUNTIME);
}

function loaded(page, path) {
  return page.evaluate((p) => performance.getEntriesByType('resource').some((e) => new URL(e.name).pathname === p), path);
}

function databases(page) {
  return page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
}

async function keyringSecret(page) {
  return page.evaluate(async (u) => {
    const m = await import(u);
    await m.ready();
    const b = await m.secret('identity');
    return b ? Array.from(b) : null;
  }, RUNTIME);
}

async function identityBytes(page) {
  return page.evaluate(() => (window.MentriaIdentity && MentriaIdentity.isUnlocked() ? Array.from(MentriaIdentity.getSecret()) : null));
}

async function lockAndWaitReload(page) {
  const nav = page.waitForNavigation({ waitUntil: 'load', timeout: 30000 });
  await page.evaluate(async (u) => { const m = await import(u); await m.lock(); }, RUNTIME).catch(() => {});
  await nav;
}

async function stepName(page) {
  return page.evaluate(() => {
    const el = document.querySelector('.m-ulayer [data-step]');
    return el ? el.dataset.step : null;
  });
}

async function waitStep(page, name, ms = 20000) {
  await until(async () => (await stepName(page)) === name, ms, 'sheet step ' + name);
}

async function sheetClosed(page, ms = 60000) {
  await until(() => page.evaluate(() => !document.querySelector('.m-ulayer')), ms, 'sheet closed');
}

async function press(page, sel) {
  await waitVisible(page, sel);
  await page.click(sel);
}

async function setupNew(page, { passkey = false, keepPass = null } = {}) {
  await waitStep(page, 'intro');
  await press(page, '.m-ulayer [data-act="next"]');
  await waitStep(page, 'code');
  const code = await page.$eval('.m-ulayer .m-ucode', (el) => el.textContent.replace(/\s+/g, ''));
  const last4 = code.replace(/[^A-Z2-7]/g, '').slice(-4);
  await page.type('.m-ulayer input[name="code-check"]', last4.toLowerCase());
  await until(() => page.$eval('.m-ulayer [data-act="next"]', (b) => !b.disabled), 5000, 'Next enabled');
  await page.click('.m-ulayer [data-act="next"]');
  await finishMethod(page, { passkey, keepPass });
  return code;
}

async function setupKeep(page, { passkey = false } = {}) {
  await waitStep(page, 'intro');
  await press(page, '.m-ulayer [data-act="next"]');
  await waitStep(page, 'code');
  const info = await page.evaluate(() => {
    const keep = document.querySelector('.m-ulayer input[name="code-choice"][value="keep"]');
    const chk = document.querySelector('.m-ulayer input[name="code-check"]');
    return { keep: !!keep && keep.checked, check: !!chk && chk.getBoundingClientRect().height > 0, next: !document.querySelector('.m-ulayer [data-act="next"]').disabled };
  });
  assert(info.keep && !info.check && info.next, 'setup offers the saved code, preselected, with no last-four check', info);
  await page.click('.m-ulayer [data-act="next"]');
  await finishMethod(page, { passkey });
}

async function finishMethod(page, { passkey, keepPass }) {
  await until(async () => ['passkey', 'no-prf'].includes(await stepName(page)), 30000, 'method step');
  if (keepPass !== null && keepPass !== undefined) {
    const on = await page.evaluate(() => {
      const el = document.querySelector('.m-ulayer input[name="keep-pass"]');
      return el ? el.checked : null;
    });
    assert(on === keepPass, 'keep passphrase box', on);
  }
  if (passkey) await page.click('.m-ulayer [data-act="add-passkey"]');
  else await page.click('.m-ulayer [data-act="skip-passkey"]');
  await sheetClosed(page);
}

async function cardCode(page, root, code) {
  const toggle = root + ' [data-act="show-code"]';
  if (await visible(page, toggle) && (await page.$eval(toggle, (el) => el.getAttribute('aria-expanded'))) !== 'true') await page.click(toggle);
  await waitVisible(page, root + ' input[name="recovery-code"]');
  await typeInto(page, root + ' input[name="recovery-code"]', code);
  await page.keyboard.press('Enter');
}

async function openAdvanced(page) {
  await page.waitForFunction(() => !!window.MentriaIdentity && document.getElementById('about-identity-status').textContent.trim() !== '\u2014', { timeout: 20000 });
  await until(async () => {
    if (await page.$eval('#about-advanced', (d) => d.open)) return true;
    await page.click('#about-advanced > summary');
    await sleep(300);
    return page.$eval('#about-advanced', (d) => d.open);
  }, 10000, 'advanced section open');
}

async function answerDialog(page, ok = true) {
  await until(() => page.evaluate(() => {
    const d = document.getElementById('m-dialog');
    return !!d && (d.matches(':popover-open') || d.hasAttribute('data-open'));
  }), 20000, 'site dialog');
  await sleep(450);
  await page.click(ok ? '#m-dialog-ok' : '#m-dialog-cancel');
  await until(() => page.evaluate(() => {
    const d = document.getElementById('m-dialog');
    return !d || !(d.matches(':popover-open') || d.hasAttribute('data-open'));
  }), 8000, 'site dialog closed');
}

async function shot(page, name, sel) {
  if (!SHOTS) return;
  const settle = async () => {
    if (sel) await page.evaluate((q) => { const el = document.querySelector(q); if (el) el.scrollIntoView({ block: 'start' }); window.scrollBy(0, -12); }, sel);
    await sleep(250);
    await page.evaluate(() => document.getAnimations().forEach((a) => { try { a.finish(); } catch (_) {} }));
  };
  await settle();
  await page.screenshot({ path: join(SHOTS, name + '-1280.png'), fullPage: false });
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await settle();
  await page.screenshot({ path: join(SHOTS, name + '-390.png'), fullPage: false });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await page.setViewport({ width: 1280, height: 900 });
  await sleep(200);
  assert(overflow <= 0, 'no sideways scroll at 390 px on ' + name, overflow);
}

function clean_(rig) {
  assert(!rig.dialogs.length, 'no native dialogs', rig.dialogs);
}

async function aboutCreate(page, { passkey }) {
  await openAdvanced(page);
  await waitVisible(page, '#about-identity-create');
  await page.click('#about-identity-create');
  const code = await setupNew(page, { passkey });
  await waitVisible(page, '#about-identity-unlocked');
  return code;
}

async function commsOnboard(page, name) {
  await press(page, '#comms-onboard-start');
  await waitVisible(page, '#comms-onboard-name');
  await page.type('#comms-onboard-name', name);
  await page.click('#comms-onboard-create');
}

async function fingerprint(page) {
  await waitVisible(page, '#comms-id-fp');
  await until(async () => (await text(page, '#comms-id-fp')).length > 3, 10000, 'fingerprint');
  return text(page, '#comms-id-fp');
}

async function idkeysOpenWith(page, bytes) {
  return page.evaluate(async (k, arr) => {
    const v = JSON.parse(localStorage.getItem(k));
    const unb = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey('raw', new Uint8Array(arr), { name: 'AES-GCM' }, false, ['decrypt']);
    try {
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb(v.wrapped.iv) }, key, unb(v.wrapped.ct));
      return true;
    } catch (_) { return false; }
  }, IDKEYS, bytes);
}

async function vaultKcvMatches(page, bytes) {
  return page.evaluate(async (k, arr) => {
    const v = JSON.parse(localStorage.getItem(k));
    const pre = new TextEncoder().encode('mentria-kcv-v1');
    const data = new Uint8Array(pre.length + arr.length);
    data.set(pre, 0);
    data.set(arr, pre.length);
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', data)).slice(0, 16);
    let s = '';
    for (const b of d) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') === v.kcv;
  }, IDENTITY, bytes);
}

async function legacyOnRoot(page) {
  await page.evaluate(async () => {
    for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    for (const k of await caches.keys()) await caches.delete(k);
  });
}

check('about new identity via setup is linked', async () => {
  await fresh(true);
  const page = await open('/about/', { auth: true });
  const rig = rigs.get(page);
  await openAdvanced(page);
  await waitVisible(page, '#about-identity-create');
  const before = await page.evaluate(() => ({
    reveal: !!document.querySelector('[data-reveal="about-identity-setup-form"]').getClientRects().length,
    pass: !!document.getElementById('about-identity-setup-pass').getClientRects().length,
    wa: window.__wa.slice()
  }));
  assert(!before.reveal && !before.pass, 'no passphrase fields on a keyring setup', before);
  assert(!before.wa.length, 'no passkey prompt on load', before.wa);
  await shot(page, 'about-none', '.about-identity-card');
  await page.click('#about-identity-create');
  const code = await setupNew(page, { passkey: true });
  await waitVisible(page, '#about-identity-unlocked');
  const vault = await readJson(page, IDENTITY);
  const rec = await readJson(page, KEYRING);
  assert(vault && vault.v === 3 && vault.linked === true && typeof vault.kcv === 'string', 'identity vault is a linked v3 record', vault);
  assert(!vault.pass && !vault.prf && !vault.device, 'identity vault has no legacy wraps', Object.keys(vault));
  assert(rec && rec.services && rec.services.identity && rec.services.identity.ct, 'keyring links identity', rec && Object.keys(rec.services || {}));
  const fromRing = await keyringSecret(page);
  const inPage = await identityBytes(page);
  assert(fromRing && fromRing.length === 32 && JSON.stringify(fromRing) === JSON.stringify(inPage), 'the page holds the keyring identity secret');
  assert(await vaultKcvMatches(page, fromRing), 'vault kcv matches the keyring secret');
  const ui = await page.evaluate(() => ({
    status: document.getElementById('about-identity-status').textContent.trim(),
    keyring: !!document.getElementById('about-identity-keyring').getClientRects().length,
    passkeys: document.querySelectorAll('#about-identity-passkeys li').length,
    legacyAdd: !!document.getElementById('about-identity-passkey-add').getClientRects().length,
    remember: !!document.getElementById('about-identity-device-row').getClientRects().length,
    lock: !!document.getElementById('about-identity-lock-btn').getClientRects().length,
    sync: !!document.getElementById('about-identity-sync-btn').getClientRects().length,
    wa: window.__wa.slice()
  }));
  assert(ui.status === EN.about.identity_status_unlocked && ui.keyring && ui.passkeys === 1 && !ui.legacyAdd && ui.lock && ui.sync, 'unlocked keyring settings', ui);
  assert(!ui.remember, 'remember this device hidden on a passkey device without a device key', ui);
  assert(ui.wa[0] === 'create:true', 'the passkey prompt comes from the click', ui.wa);
  assert(CODE_SHAPE.test(code) === false && /^([A-Z2-7]{4}-){7}[A-Z2-7]{4}$/.test(code), 'a new keyring code was shown', code);
  await shot(page, 'about-unlocked', '.about-identity-card');
  await page.reload({ waitUntil: 'load' });
  await openAdvanced(page);
  await until(() => page.evaluate(() => window.MentriaIdentity && MentriaIdentity.isUnlocked()), 15000, 'identity opens from the session after reload');
  const after = await page.evaluate(() => ({ card: !!document.querySelector('#about-identity-card-slot .m-unlock'), layer: !!document.querySelector('.m-ulayer'), wa: window.__wa.slice() }));
  assert(!after.card && !after.layer && !after.wa.length, 'reload continues the session without any screen', after);
  clean_(rig);
  shared.about = { code };
});

check('sync button still joins with the linked secret', async () => {
  await fresh(true);
  const page = await open('/about/', { auth: true });
  const rig = rigs.get(page);
  await aboutCreate(page, { passkey: false });
  await page.waitForFunction(() => !!window.MentriaSync, { timeout: 20000 });
  await page.evaluate(() => {
    window.__joins = [];
    window.MentriaSync.joinWithIdentity = async (b) => { window.__joins.push({ ok: b instanceof Uint8Array, bytes: Array.from(b) }); };
  });
  await page.click('#about-identity-sync-btn');
  await until(() => page.evaluate(() => window.__joins.length === 1), 10000, 'joinWithIdentity called');
  const join = await page.evaluate(() => window.__joins[0]);
  const ring = await keyringSecret(page);
  assert(join.ok && join.bytes.length === 32, 'joinWithIdentity gets 32 bytes', join);
  assert(JSON.stringify(join.bytes) === JSON.stringify(ring), 'the bytes are the linked identity secret');
  clean_(rig);
});

check('about keyring settings: passkeys, new code, ask at launch', async () => {
  await fresh(true);
  const page = await open('/about/', { auth: true });
  const rig = rigs.get(page);
  const code = await aboutCreate(page, { passkey: true });
  await page.reload({ waitUntil: 'load' });
  await openAdvanced(page);
  await waitVisible(page, '#about-identity-keyring', 15000);
  await page.click('#about-identity-launch');
  assert((await runtime(page)).askAtLaunch === true, 'ask at launch turns on');
  await page.click('#about-identity-launch');
  assert((await runtime(page)).askAtLaunch === false, 'ask at launch turns off');
  await page.click('#about-identity-kr-add');
  await waitVisible(page, '.m-ulayer .m-unlock', 15000);
  let wa = await page.evaluate(() => window.__wa.slice());
  assert(!wa.length, 'no passkey prompt before the confirm', wa);
  await cardCode(page, '.m-ulayer', code);
  await sheetClosed(page, 20000);
  await until(() => page.evaluate(() => !document.getElementById('about-identity-kr-add').disabled && document.activeElement === document.getElementById('about-identity-kr-add')), 10000, 'a fresh Add a passkey button takes focus');
  await rig.cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: rig.auth });
  rig.auth = (await rig.cdp.send('WebAuthn.addVirtualAuthenticator', { options: AUTH })).authenticatorId;
  await page.click('#about-identity-kr-add');
  await until(() => page.evaluate(() => document.querySelectorAll('#about-identity-passkeys li').length === 2), 20000, 'second passkey listed');
  wa = await page.evaluate(() => window.__wa.slice());
  assert(wa[0] === 'create:true', 'the second add reaches the passkey prompt inside its click', wa);
  await page.reload({ waitUntil: 'load' });
  await openAdvanced(page);
  await waitVisible(page, '#about-identity-passkeys li button');
  await page.click('#about-identity-passkeys li button');
  await answerDialog(page);
  await waitVisible(page, '.m-ulayer .m-unlock', 15000);
  await cardCode(page, '.m-ulayer', code);
  await until(() => page.evaluate(() => document.querySelectorAll('#about-identity-passkeys li').length === 1), 20000, 'passkey removed after the confirm');
  assert((await runtime(page)).passkeys === 1, 'one live passkey');
  await page.click('#about-identity-regen');
  await answerDialog(page);
  await waitStep(page, 'code', 20000);
  const next = await page.$eval('.m-ulayer .m-ucode', (el) => el.textContent.replace(/\s+/g, ''));
  assert(next !== code && /^([A-Z2-7]{4}-){7}[A-Z2-7]{4}$/.test(next), 'a new code is shown', next);
  await page.type('.m-ulayer input[name="code-check"]', next.replace(/[^A-Z2-7]/g, '').slice(-4));
  await page.click('.m-ulayer [data-act="done"]');
  await sheetClosed(page, 20000);
  assert((await runtime(page)).codeConfirmed === true, 'new code confirmed');
  const res = await page.evaluate(async (u, oldCode, newCode) => {
    const m = await import(u);
    await m.lock();
    let old = 'opened';
    try { await m.unlockWithCode(oldCode); } catch (e) { old = e.message; }
    await m.unlockWithCode(newCode);
    return { old, unlocked: m.state().unlocked };
  }, RUNTIME, code, next);
  assert(res.old === 'bad-code' && res.unlocked, 'only the new code opens the keyring', res);
  await until(() => page.evaluate(() => MentriaIdentity.isUnlocked()), 10000, 'identity reopens');
  clean_(rig);
  shared.settings = { code: next };
});

check('about remember this device on a device without passkey support', async () => {
  await fresh(true);
  const noPrf = () => {
    if (window.PublicKeyCredential) PublicKeyCredential.getClientCapabilities = async () => ({ 'extension:prf': false });
  };
  const page = await open('/about/', { init: noPrf });
  const rig = rigs.get(page);
  await openAdvanced(page);
  await page.click('#about-identity-create');
  await waitStep(page, 'intro');
  await page.click('.m-ulayer [data-act="next"]');
  await waitStep(page, 'code');
  const code = await page.$eval('.m-ulayer .m-ucode', (el) => el.textContent.replace(/\s+/g, ''));
  await page.type('.m-ulayer input[name="code-check"]', code.replace(/[^A-Z2-7]/g, '').slice(-4));
  await until(() => page.$eval('.m-ulayer [data-act="next"]', (b) => !b.disabled), 5000, 'Next enabled');
  await page.click('.m-ulayer [data-act="next"]');
  await waitStep(page, 'no-prf', 20000);
  await page.click('.m-ulayer [data-act="done"]');
  await sheetClosed(page);
  await waitVisible(page, '#about-identity-keyring', 15000);
  const ui = await page.evaluate(() => ({
    remember: !!document.getElementById('about-identity-device-row').getClientRects().length,
    note: document.getElementById('about-identity-passkey-note').textContent.trim(),
    add: !!document.getElementById('about-identity-kr-add').getClientRects().length
  }));
  assert(ui.remember && ui.note === EN.unlock.remember_note && !ui.add, 'remember shown with the one-level note, no Add a passkey', ui);
  await page.reload({ waitUntil: 'load' });
  await openAdvanced(page);
  await waitVisible(page, '#about-identity-device', 15000);
  await page.click('#about-identity-device');
  await waitVisible(page, '.m-ulayer .m-unlock', 15000);
  await cardCode(page, '.m-ulayer', code);
  await until(() => runtime(page).then((s) => s.hasDevice === true), 20000, 'device key on after the confirm');
  assert(await page.$eval('#about-identity-device', (el) => el.checked), 'toggle shows on');
  await page.click('#about-identity-device');
  await until(() => runtime(page).then((s) => s.hasDevice === false), 20000, 'device key off');
  clean_(rig);
});

check('comms onboarding creates keyring and identity', async () => {
  await fresh(true);
  const page = await open('/comms/', { auth: true });
  const rig = rigs.get(page);
  await commsOnboard(page, 'Keyring Kim');
  await shot(page, 'comms-setup-intro');
  const code = await setupNew(page, { passkey: true });
  await waitVisible(page, '#comms-id-on', 30000);
  const ui = await page.evaluate(() => ({
    onboard: !!document.getElementById('comms-onboard').getClientRects().length,
    done: !!document.getElementById('comms-onboard-done').getClientRects().length,
    oldCode: document.getElementById('comms-onboard-code').textContent,
    lock: !!document.getElementById('comms-id-lock').getClientRects().length,
    wa: window.__wa.slice()
  }));
  assert(!ui.onboard && !ui.done && ui.oldCode === '', 'no 20-symbol code step', ui);
  assert(ui.lock, 'identity card has a Lock button', ui);
  assert(ui.wa[0] === 'create:true', 'the passkey prompt comes from the click', ui.wa);
  const vault = await readJson(page, IDENTITY);
  const rec = await readJson(page, KEYRING);
  assert(vault && vault.v === 3 && vault.linked === true && !vault.pass && !vault.prf && !vault.device, 'identity created linked, no legacy wrap', vault);
  assert(rec.services.identity && rec.services.identity.ct, 'keyring links identity');
  assert(rec.wraps.prf.filter((e) => !e.removed).length === 1, 'one keyring passkey', rec.wraps.prf.length);
  const ring = await keyringSecret(page);
  await until(() => readJson(page, IDKEYS).then((v) => !!(v && v.wrapped)), 10000, 'comms keys written');
  assert(await idkeysOpenWith(page, ring), 'comms keys are wrapped with the linked identity secret');
  const profile = await readJson(page, 'mentria.store.comms.profile');
  assert(profile && profile.name === 'Keyring Kim', 'profile name kept', profile);
  const fp = await fingerprint(page);
  await shot(page, 'comms-unlocked', '.comms');
  clean_(rig);
  shared.comms = { page, code, fp };
});

check('comms welcome back card unlocks', async () => {
  assert(shared.comms, 'needs the onboarding check');
  const { page, code, fp } = shared.comms;
  const rig = rigs.get(page);
  await lockAndWaitReload(page);
  await waitVisible(page, '#comms-id-card-slot .m-unlock', 20000);
  const lockUi = await page.evaluate(() => ({
    title: !!document.getElementById('comms-lock-title').getClientRects().length,
    alt: !!document.getElementById('comms-lock-alt').getClientRects().length,
    oldPk: !!document.getElementById('comms-id-passkey').getClientRects().length,
    link: !!document.getElementById('comms-lock-link').getClientRects().length,
    app: !!document.getElementById('comms-app').getClientRects().length,
    cardTitle: document.querySelector('#comms-id-card-slot .m-unlock__title').textContent.trim(),
    pk: !!document.querySelector('#comms-id-card-slot [data-act="passkey"]').getClientRects().length,
    wa: window.__wa.slice()
  }));
  assert(!lockUi.title && !lockUi.alt && !lockUi.oldPk && !lockUi.link && !lockUi.app, 'the card replaces the old lock screen', lockUi);
  assert(lockUi.cardTitle === EN.unlock.card_title && lockUi.pk, 'card with the passkey button', lockUi);
  assert(!lockUi.wa.length, 'no passkey prompt on load', lockUi.wa);
  await shot(page, 'comms-card', '.comms');
  await page.click('#comms-id-card-slot [data-act="passkey"]');
  await waitVisible(page, '#comms-id-on', 30000);
  assert(await fingerprint(page) === fp, 'the same identity opens');
  const wa = await page.evaluate(() => window.__wa.slice());
  assert(wa.length === 1 && wa[0] === 'get:true', 'passkey prompt only from the click', wa);
  await lockAndWaitReload(page);
  await waitVisible(page, '#comms-id-card-slot .m-unlock', 20000);
  await cardCode(page, '#comms-id-card-slot', code.toLowerCase());
  await waitVisible(page, '#comms-id-on', 30000);
  assert(await fingerprint(page) === fp, 'the code opens the same identity');
  await waitHidden(page, '#comms-id-locked');
  clean_(rig);
});

check('identity card lock locks everything', async () => {
  assert(shared.comms, 'needs the onboarding check');
  const { page } = shared.comms;
  const about = await open('/about/');
  await openAdvanced(about);
  await until(() => about.evaluate(() => window.MentriaIdentity && MentriaIdentity.isUnlocked()), 15000, 'About opens from the same session');
  await waitVisible(about, '#about-identity-keyring');
  await page.bringToFront();
  await page.evaluate(() => { window.__before = 1; });
  const nav = page.waitForNavigation({ waitUntil: 'load', timeout: 30000 });
  await page.click('#comms-id-lock');
  await nav;
  const reloaded = await page.evaluate(() => window.__before === undefined);
  assert(reloaded, 'Comms reloads on lock');
  await waitVisible(page, '#comms-id-card-slot .m-unlock', 20000);
  const s = await runtime(page);
  assert(s.unlocked === false && s.setUp === true, 'keyring locked', s);
  await until(() => about.evaluate(() => !MentriaIdentity.isUnlocked()), 10000, 'About drops the secret');
  await waitVisible(about, '#about-identity-card-slot .m-unlock', 10000);
  const a = await about.evaluate(() => ({
    status: document.getElementById('about-identity-status').textContent.trim(),
    unlocked: !!document.getElementById('about-identity-unlocked').getClientRects().length,
    legacy: !!document.getElementById('about-identity-unlock').getClientRects().length,
    cardH: document.querySelector('#about-identity-card-slot .m-unlock__title').tagName,
    cardH2: document.querySelectorAll('.about-identity-card h2').length,
    cardText: document.querySelector('#about-identity-card-slot .m-unlock__title').textContent.trim()
  }));
  assert(a.status === EN.about.identity_status_locked && !a.unlocked && !a.legacy, 'About shows the card, not the old unlock', a);
  assert(a.cardH === 'H4' && a.cardH2 === 0 && a.cardText === EN.unlock.card_title, 'the card title is a level below the identity card heading', a);
  await about.bringToFront();
  await shot(about, 'about-card', '.about-identity-card');
  await cardCode(about, '#about-identity-card-slot', shared.comms.code);
  await until(() => about.evaluate(() => MentriaIdentity.isUnlocked()), 15000, 'About unlocks with the card');
  await waitVisible(page, '#comms-id-on', 20000);
  clean_(rigs.get(about));
  clean_(rigs.get(page));
});

check('comms onboarding with a locked keyring asks with the card', async () => {
  await fresh(true);
  const tools = await open('/tools/');
  const code = await tools.evaluate(async (u) => {
    const m = await import(u);
    await m.ready();
    const made = await m.create({});
    await m.lock();
    return made.code;
  }, RUNTIME);
  await tools.close();
  const page = await open('/comms/', { auth: true });
  const rig = rigs.get(page);
  await commsOnboard(page, 'Card Cam');
  await waitVisible(page, '#comms-onboard-card .m-unlock', 20000);
  assert(!(await page.$('.m-ulayer')) && !(await readJson(page, IDENTITY)), 'no setup sheet and nothing written before the unlock');
  await cardCode(page, '#comms-onboard-card', code);
  await waitVisible(page, '#comms-id-on', 30000);
  const vault = await readJson(page, IDENTITY);
  const ring = await keyringSecret(page);
  assert(vault && vault.v === 3 && vault.linked === true && await vaultKcvMatches(page, ring), 'identity created and linked into the existing keyring', vault);
  await until(() => readJson(page, IDKEYS).then((v) => !!(v && v.wrapped)), 10000, 'comms keys written');
  assert(await idkeysOpenWith(page, ring), 'comms keys wrapped with the linked secret');
  assert(!(await visible(page, '#comms-onboard')), 'onboarding finished');
  clean_(rig);
});

check('comms offers a keyring passkey after a code unlock', async () => {
  await fresh(true);
  const page = await open('/comms/', { auth: true });
  const rig = rigs.get(page);
  await commsOnboard(page, 'Offer Ola');
  const code = await setupNew(page, { passkey: false });
  await waitVisible(page, '#comms-id-on', 30000);
  assert((await runtime(page)).passkeys === 0, 'no passkey yet');
  await lockAndWaitReload(page);
  await waitVisible(page, '#comms-id-card-slot .m-unlock', 20000);
  await cardCode(page, '#comms-id-card-slot', code);
  await waitVisible(page, '#comms-id-on', 30000);
  await waitVisible(page, '#comms-pk-upgrade', 10000);
  await page.click('#comms-pk-enroll');
  await until(() => runtime(page).then((s) => s.passkeys === 1), 20000, 'keyring passkey added from the offer');
  await waitHidden(page, '#comms-pk-upgrade');
  let wa = await page.evaluate(() => window.__wa.slice());
  assert(wa[0] === 'create:true', 'the offer reaches the passkey prompt inside its click', wa);
  const rec = await readJson(page, KEYRING);
  const vault = await readJson(page, IDENTITY);
  assert(!vault.prf, 'no identity passkey was made', Object.keys(vault));
  assert(rec.wraps.prf.filter((e) => !e.removed).length === 1, 'the passkey belongs to the keyring');
  await page.evaluate(async (u, c) => {
    const m = await import(u);
    await m.confirmWithCode(c);
    for (const p of m.passkeys()) await m.removePasskey(p.id);
  }, RUNTIME, code);
  await rig.cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: rig.auth });
  rig.auth = (await rig.cdp.send('WebAuthn.addVirtualAuthenticator', { options: AUTH })).authenticatorId;
  await page.reload({ waitUntil: 'load' });
  await waitVisible(page, '#comms-id-on', 20000);
  await page.click('#comms-adv-toggle');
  await waitVisible(page, '#comms-pk-settings', 10000);
  await page.click('#comms-pk-settings');
  await waitVisible(page, '.m-ulayer .m-unlock', 15000);
  wa = await page.evaluate(() => window.__wa.slice());
  assert(!wa.length, 'no passkey prompt before the confirm', wa);
  await cardCode(page, '.m-ulayer', code);
  await sheetClosed(page, 20000);
  await waitVisible(page, '#comms-pk-upgrade', 10000);
  assert(await page.evaluate(() => document.activeElement === document.getElementById('comms-pk-enroll')), 'a fresh add button takes focus');
  await page.click('#comms-pk-enroll');
  await until(() => runtime(page).then((s) => s.passkeys === 1), 20000, 'passkey added after the confirm');
  wa = await page.evaluate(() => window.__wa.slice());
  assert(wa[0] === 'create:true', 'the second click reaches the passkey prompt', wa);
  clean_(rig);
});

check('switch off keeps the old comms flow', async () => {
  await fresh(false);
  const page = await open('/comms/', { auth: true });
  const rig = rigs.get(page);
  await commsOnboard(page, 'Legacy Lee');
  await waitVisible(page, '#comms-onboard-done', 40000);
  const code = await text(page, '#comms-onboard-code');
  assert(CODE_SHAPE.test(code), 'the 20-symbol code is shown', code);
  assert(!(await page.$('.m-ulayer')), 'no setup sheet');
  await page.click('#comms-onboard-continue');
  await waitVisible(page, '#comms-id-on');
  const vault = await readJson(page, IDENTITY);
  assert(vault && vault.v === 2 && vault.pass && vault.prf && !vault.linked, 'legacy vault with pass and prf', vault && Object.keys(vault));
  assert(!(await readJson(page, KEYRING)), 'no keyring record');
  assert(!(await loaded(page, RUNTIME)) && !(await loaded(page, UI)), 'runtime and card never load');
  assert(!(await visible(page, '#comms-id-lock')), 'no Lock button');
  await page.reload({ waitUntil: 'load' });
  await waitVisible(page, '#comms-id-locked');
  const lockUi = {
    title: await visible(page, '#comms-id-locked .comms__lock-h'),
    pk: await visible(page, '#comms-id-passkey'),
    link: await visible(page, '#comms-lock-link'),
    slot: await visible(page, '#comms-id-card-slot')
  };
  assert(lockUi.title && lockUi.pk && !lockUi.link && !lockUi.slot, 'old welcome back card', lockUi);
  await page.click('#comms-lock-alt summary');
  await typeInto(page, '#comms-id-pass', code);
  await page.click('#comms-id-unlock');
  await waitVisible(page, '#comms-id-on', 20000);
  assert(!(await page.$('.m-ulayer')), 'no setup sheet after the old unlock');
  assert(!(await loaded(page, RUNTIME)), 'runtime still not loaded');
  const about = await open('/about/');
  await openAdvanced(about);
  await waitVisible(about, '#about-identity-unlock');
  const a = {
    pass: await visible(about, '#about-identity-unlock-pass'),
    link: await visible(about, '#about-identity-link'),
    create: await visible(about, '#about-identity-create')
  };
  assert(a.pass && !a.link && !a.create, 'About keeps the old unlock', a);
  assert(!(await loaded(about, RUNTIME)), 'About does not load the runtime');
  assert(!(await databases(about)).includes('mentria-keyring'), 'no keyring database');
  clean_(rig);
  clean_(rigs.get(about));
});

check('legacy comms code links on first unlock', async () => {
  if (!existsSync(LEGACY)) throw new Error('legacy build missing at ' + LEGACY);
  await fresh(false);
  server.setRoot(LEGACY);
  let page;
  let code;
  let fp;
  try {
    page = await open('/comms/', { auth: true });
    await commsOnboard(page, 'Old Olive');
    await waitVisible(page, '#comms-onboard-done', 40000);
    code = await text(page, '#comms-onboard-code');
    assert(CODE_SHAPE.test(code), 'legacy code shown', code);
    await page.click('#comms-onboard-continue');
    await waitVisible(page, '#comms-id-on');
    fp = await fingerprint(page);
    await until(() => readJson(page, IDKEYS).then((v) => !!v), 10000, 'legacy comms keys');
    await legacyOnRoot(page);
  } finally {
    server.setRoot(BUILD);
  }
  const rig = rigs.get(page);
  const vault0 = await readJson(page, IDENTITY);
  assert(vault0.pass && vault0.prf, 'legacy vault seeded with pass and prf', Object.keys(vault0));
  await setSwitch(page, true);
  await page.goto(ORIGIN + '/comms/', { waitUntil: 'load' });
  await waitVisible(page, '#comms-id-locked');
  const lockUi = await page.evaluate(() => ({
    link: !!document.getElementById('comms-lock-link').getClientRects().length,
    pk: !!document.getElementById('comms-id-passkey').getClientRects().length,
    slot: !!document.getElementById('comms-id-card-slot').getClientRects().length
  }));
  assert(lockUi.link && lockUi.pk && !lockUi.slot, 'old card with the link line above it', lockUi);
  await shot(page, 'comms-legacy-lock', '.comms');
  await page.click('#comms-lock-alt summary');
  await typeInto(page, '#comms-id-pass', code.replace(/-/g, '').toUpperCase());
  await page.click('#comms-id-unlock');
  await waitStep(page, 'intro', 40000);
  await shot(page, 'comms-legacy-setup');
  await setupKeep(page, { passkey: true });
  await waitVisible(page, '#comms-id-on', 20000);
  assert(await fingerprint(page) === fp, 'the same identity after linking');
  const rec = await readJson(page, KEYRING);
  const vault = await readJson(page, IDENTITY);
  assert(rec.services.identity && rec.services.identity.ct, 'identity linked');
  assert(vault.pass && vault.prf && vault.kcv === vault0.kcv, 'old wraps kept until retirement', Object.keys(vault));
  await lockAndWaitReload(page);
  await waitVisible(page, '#comms-id-card-slot .m-unlock', 20000);
  await cardCode(page, '#comms-id-card-slot', code);
  await waitVisible(page, '#comms-id-on', 30000);
  assert(await fingerprint(page) === fp, 'the saved Comms code is now the recovery code');
  clean_(rig);
});

check('legacy comms passkey unlock checks the saved code', async () => {
  if (!existsSync(LEGACY)) throw new Error('legacy build missing at ' + LEGACY);
  await fresh(false);
  server.setRoot(LEGACY);
  let page;
  let code;
  try {
    page = await open('/comms/', { auth: true });
    await commsOnboard(page, 'Old Otto');
    await waitVisible(page, '#comms-onboard-done', 40000);
    code = await text(page, '#comms-onboard-code');
    await page.click('#comms-onboard-continue');
    await waitVisible(page, '#comms-id-on');
    await until(() => readJson(page, IDKEYS).then((v) => !!v), 10000, 'legacy comms keys');
    await legacyOnRoot(page);
  } finally {
    server.setRoot(BUILD);
  }
  const rig = rigs.get(page);
  await setSwitch(page, true);
  await page.goto(ORIGIN + '/comms/', { waitUntil: 'load' });
  await waitVisible(page, '#comms-id-passkey');
  await page.click('#comms-id-passkey');
  await waitStep(page, 'intro', 40000);
  await page.click('.m-ulayer [data-act="next"]');
  await waitStep(page, 'code');
  const keep = await page.evaluate(() => {
    const r = document.querySelector('.m-ulayer input[name="code-choice"][value="keep"]');
    const f = document.querySelector('.m-ulayer input[name="saved-code"]');
    return { keep: !!r && r.checked, field: !!f && f.getBoundingClientRect().height > 0 };
  });
  assert(keep.keep && keep.field, 'the saved code is asked for, preselected', keep);
  await page.type('.m-ulayer input[name="saved-code"]', 'aaaaa-bbbbb-ccccc-ddddd');
  await page.click('.m-ulayer [data-act="next"]');
  await until(() => page.evaluate((t) => (document.querySelector('.m-ulayer .m-usheet__msg') || {}).textContent === t, EN.unlock.err_code), 15000, 'a wrong saved code is refused');
  assert(!(await readJson(page, KEYRING)), 'nothing written for a wrong code');
  await typeInto(page, '.m-ulayer input[name="saved-code"]', code.toUpperCase());
  await page.click('.m-ulayer [data-act="next"]');
  await finishMethod(page, { passkey: false });
  await until(() => readJson(page, KEYRING).then((r) => !!(r && r.services.identity)), 15000, 'identity linked');
  await lockAndWaitReload(page);
  await waitVisible(page, '#comms-id-card-slot .m-unlock', 20000);
  await cardCode(page, '#comms-id-card-slot', code);
  await waitVisible(page, '#comms-id-on', 30000);
  clean_(rig);
});

check('legacy about passphrase carries over', async () => {
  await fresh(false);
  const page = await open('/about/', { auth: true });
  const rig = rigs.get(page);
  await openAdvanced(page);
  await press(page, '[data-reveal="about-identity-setup-form"]');
  await page.type('#about-identity-setup-pass', PASSPHRASE);
  await page.type('#about-identity-setup-pass2', PASSPHRASE);
  await page.click('#about-identity-setup-btn');
  await answerDialog(page);
  await waitVisible(page, '#about-identity-unlocked');
  await page.click('#about-identity-passkey-add');
  await answerDialog(page);
  const vault0 = await readJson(page, IDENTITY);
  assert(vault0.pass && vault0.prf && vault0.prf.credId, 'legacy About vault with a passkey', Object.keys(vault0));
  await setSwitch(page, true);
  await page.reload({ waitUntil: 'load' });
  await openAdvanced(page);
  await waitVisible(page, '#about-identity-unlock');
  assert(await visible(page, '#about-identity-link'), 'link line above the old unlock');
  await shot(page, 'about-legacy-lock', '.about-identity-card');
  await page.type('#about-identity-unlock-pass', PASSPHRASE);
  await page.click('#about-identity-unlock-btn');
  await waitStep(page, 'intro', 30000);
  await setupNew(page, { passkey: false, keepPass: true });
  await until(async () => {
    const r = await readJson(page, KEYRING);
    return !!(r && r.services.identity && r.wraps.pass && r.wraps.pass.ct);
  }, 30000, 'linked with the passphrase kept');
  await waitVisible(page, '#about-identity-keyring');
  await page.evaluate(async (u) => { const m = await import(u); await m.lock(); }, RUNTIME);
  await waitVisible(page, '#about-identity-card-slot .m-unlock', 15000);
  await waitVisible(page, '#about-identity-card-slot input[name="passphrase"]');
  await typeInto(page, '#about-identity-card-slot input[name="passphrase"]', PASSPHRASE);
  await page.keyboard.press('Enter');
  await until(() => page.evaluate(() => MentriaIdentity.isUnlocked()), 30000, 'the kept passphrase opens the keyring');
  const vault = await readJson(page, IDENTITY);
  assert(vault.pass && vault.prf, 'old wraps kept', Object.keys(vault));
  clean_(rig);
  shared.g3 = { page, credId: vault0.prf.credId };
});

check('retirement drops the old lock after 30 days', async () => {
  assert(shared.g3, 'needs the About passphrase check');
  const { page, credId } = shared.g3;
  const rig = rigs.get(page);
  const before = await page.evaluate((k) => {
    const r = JSON.parse(localStorage.getItem(k));
    return { blockers: null, linked: r.services.identity.linked, confirmed: r.codeConfirmed };
  }, KEYRING);
  assert(before.confirmed, 'recovery code confirmed at setup', before);
  await page.evaluate((k) => {
    const r = JSON.parse(localStorage.getItem(k));
    r.services.identity.linked = new Date(Date.now() - 31 * 86400000).toISOString();
    localStorage.setItem(k, JSON.stringify(r));
  }, KEYRING);
  await page.evaluateOnNewDocument(SIGNAL_PROBE);
  await page.reload({ waitUntil: 'load' });
  await openAdvanced(page);
  await until(async () => {
    const r = await readJson(page, KEYRING);
    return !!(r && r.retired && r.retired.identity);
  }, 20000, 'identity marked retired');
  const vault = await readJson(page, IDENTITY);
  assert(vault.v === 3 && vault.linked === true && !vault.pass && !vault.prf && !vault.device && vault.kcv, 'legacy wraps deleted, kcv kept', vault);
  const signals = await page.evaluate(() => window.__signals);
  assert(signals.length === 1 && signals[0].credentialId === credId && signals[0].rpId === 'localhost', 'legacy passkey signalled unknown', signals);
  assert(await page.evaluate(() => MentriaIdentity.isUnlocked()), 'identity still open');
  await page.evaluate(async (u) => { const m = await import(u); await m.lock(); }, RUNTIME);
  await page.reload({ waitUntil: 'load' });
  await openAdvanced(page);
  await waitVisible(page, '#about-identity-card-slot .m-unlock', 15000);
  assert(!(await visible(page, '#about-identity-unlock')), 'no old unlock after retirement');
  const n = await page.evaluate(() => window.__signals.length);
  assert(n === 0, 'retirement runs once', n);
  clean_(rig);
});

check('a keyring identity entry without a vault is rebuilt, never replaced', async () => {
  await fresh(true);
  const page = await open('/about/', { auth: true });
  const rig = rigs.get(page);
  const code = await aboutCreate(page, { passkey: false });
  const ring0 = await keyringSecret(page);
  const entry0 = (await readJson(page, KEYRING)).services.identity;
  await page.evaluate(() => window.MentriaStore.remove('identity', 'vault'));
  const tomb0 = await readJson(page, 'mentria-sync-tombstones');
  assert(tomb0 && typeof tomb0['identity.vault'] === 'number', 'seed: a local identity tombstone', tomb0);
  await page.evaluate(async (u) => { const m = await import(u); await m.lock(); }, RUNTIME);
  await page.reload({ waitUntil: 'load' });
  await openAdvanced(page);
  await waitVisible(page, '#about-identity-create');
  await sleep(500);
  const r = await page.evaluate((k) => ({
    status: document.getElementById('about-identity-status').textContent.trim(),
    card: !!document.querySelector('.m-unlock'),
    vault: localStorage.getItem(k)
  }), IDENTITY);
  assert(r.status === EN.about.identity_status_none && !r.card && r.vault === null, 'not set up, no card, nothing written', r);
  assert(!(await loaded(page, UI)), 'the card module is not loaded on page load');
  await page.click('#about-identity-create');
  await waitVisible(page, '#about-identity-card-slot .m-unlock');
  await cardCode(page, '#about-identity-card-slot', code);
  await until(() => page.evaluate(() => MentriaIdentity.isUnlocked()), 20000, 'the identity reopens');
  const rec = await readJson(page, KEYRING);
  const vault = await readJson(page, IDENTITY);
  const meta = await readJson(page, 'mentria.meta.identity.vault');
  const ring = await keyringSecret(page);
  assert(JSON.stringify(rec.services.identity) === JSON.stringify(entry0), 'the keyring identity entry is never overwritten', { before: entry0.linked, after: rec.services.identity.linked });
  assert(JSON.stringify(ring) === JSON.stringify(ring0), 'the keyring secret is unchanged');
  assert(vault && vault.v === 3 && vault.linked === true && !vault.pass && await vaultKcvMatches(page, ring), 'the rebuilt vault opens with the keyring secret', vault);
  assert(meta && meta.m === 0, 'the rebuilt vault cannot win against a real vault elsewhere', meta);
  assert(JSON.stringify(await identityBytes(page)) === JSON.stringify(ring), 'the page holds the keyring secret');
  assert(!(await visible(page, '#about-identity-card-slot')), 'the card is gone');
  clean_(rig);
});

check('a wrap-less vault that does not match is rebuilt from the keyring', async () => {
  await fresh(true);
  const page = await open('/about/', { auth: true });
  const rig = rigs.get(page);
  await aboutCreate(page, { passkey: false });
  const entry0 = (await readJson(page, KEYRING)).services.identity;
  await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({ v: 3, kcv: 'AAAAAAAAAAAAAAAAAAAAAA', linked: true })), IDENTITY);
  await page.reload({ waitUntil: 'load' });
  await openAdvanced(page);
  await until(() => page.evaluate(() => MentriaIdentity.isUnlocked()), 15000, 'the identity opens from the keyring');
  const vault = await readJson(page, IDENTITY);
  const meta = await readJson(page, 'mentria.meta.identity.vault');
  assert(await vaultKcvMatches(page, await keyringSecret(page)) && vault.linked === true, 'the vault is rebuilt with the keyring secret', vault);
  assert(meta && meta.m === 0, 'the rebuilt vault has mtime 0', meta);
  assert(JSON.stringify((await readJson(page, KEYRING)).services.identity) === JSON.stringify(entry0), 'the keyring entry is untouched');
  assert(await visible(page, '#about-identity-keyring'), 'keyring settings shown');
  clean_(rig);
});

check('comms rebuilds a linked identity instead of making a new one', async () => {
  await fresh(true);
  const page = await open('/comms/', { auth: true });
  const rig = rigs.get(page);
  await commsOnboard(page, 'Same Sam');
  const code = await setupNew(page, { passkey: false });
  await waitVisible(page, '#comms-id-on', 30000);
  const fp = await fingerprint(page);
  await until(() => readJson(page, IDKEYS).then((v) => !!(v && v.wrapped)), 10000, 'comms keys written');
  const entry0 = (await readJson(page, KEYRING)).services.identity;
  await page.evaluate(() => window.MentriaStore.remove('identity', 'vault'));
  await lockAndWaitReload(page);
  await waitVisible(page, '#comms-onboard', 20000);
  await commsOnboard(page, 'Same Sam');
  await waitVisible(page, '#comms-onboard-card .m-unlock', 20000);
  assert(!(await page.$('.m-ulayer')), 'no setup sheet for a keyring that exists');
  await cardCode(page, '#comms-onboard-card', code);
  await waitVisible(page, '#comms-id-on', 30000);
  assert(await fingerprint(page) === fp, 'the same Comms identity comes back');
  const rec = await readJson(page, KEYRING);
  assert(JSON.stringify(rec.services.identity) === JSON.stringify(entry0), 'the keyring identity entry is never overwritten');
  const vault = await readJson(page, IDENTITY);
  assert(vault && vault.v === 3 && await vaultKcvMatches(page, await keyringSecret(page)), 'rebuilt from the keyring', vault);
  clean_(rig);
});

check('leaving setup partway stores nothing', async () => {
  await fresh(true);
  const page = await open('/about/', { auth: true });
  const rig = rigs.get(page);
  const nothing = async (what) => {
    const r = await page.evaluate((a, b) => ({ vault: localStorage.getItem(a), ring: localStorage.getItem(b), unlocked: !!(window.MentriaIdentity && MentriaIdentity.isUnlocked()) }), IDENTITY, KEYRING);
    assert(r.vault === null && r.ring === null && !r.unlocked, 'nothing stored after ' + what, r);
  };
  await openAdvanced(page);
  await waitVisible(page, '#about-identity-create');
  await page.click('#about-identity-create');
  await waitStep(page, 'intro');
  await nothing('opening setup');
  await page.reload({ waitUntil: 'load' });
  await openAdvanced(page);
  await waitVisible(page, '#about-identity-create');
  await nothing('a reload on the intro');
  await page.click('#about-identity-create');
  await waitStep(page, 'intro');
  await page.click('.m-ulayer [data-act="next"]');
  await waitStep(page, 'code');
  await page.reload({ waitUntil: 'load' });
  await openAdvanced(page);
  await waitVisible(page, '#about-identity-create');
  await nothing('a reload on the code step');
  await page.click('#about-identity-create');
  await waitStep(page, 'intro');
  await page.keyboard.press('Escape');
  await sheetClosed(page, 10000);
  await waitVisible(page, '#about-identity-create');
  await nothing('Not now');
  await page.click('#about-identity-create');
  await waitStep(page, 'intro');
  await page.click('.m-ulayer [data-act="next"]');
  await waitStep(page, 'code');
  const code = await page.$eval('.m-ulayer .m-ucode', (el) => el.textContent.replace(/\s+/g, ''));
  await page.type('.m-ulayer input[name="code-check"]', code.replace(/[^A-Z2-7]/g, '').slice(-4));
  await until(() => page.$eval('.m-ulayer [data-act="next"]', (b) => !b.disabled), 5000, 'Next enabled');
  await page.click('.m-ulayer [data-act="next"]');
  await waitStep(page, 'passkey', 20000);
  const entry0 = (await readJson(page, KEYRING)).services.identity;
  await page.reload({ waitUntil: 'load' });
  await openAdvanced(page);
  await waitVisible(page, '#about-identity-create');
  assert(!(await readJson(page, IDENTITY)), 'no half-made identity vault after leaving on the passkey step');
  await page.click('#about-identity-create');
  await until(() => page.evaluate(() => MentriaIdentity.isUnlocked()), 20000, 'Create finishes the linked identity');
  const rec = await readJson(page, KEYRING);
  assert(JSON.stringify(rec.services.identity) === JSON.stringify(entry0), 'the link made during setup is kept');
  assert(await vaultKcvMatches(page, await keyringSecret(page)), 'the vault opens with the keyring secret');
  await fresh(true);
  const comms = await open('/comms/', { auth: true });
  await commsOnboard(comms, 'Half Hal');
  await waitStep(comms, 'intro');
  await comms.reload({ waitUntil: 'load' });
  await waitVisible(comms, '#comms-onboard', 20000);
  const c = await comms.evaluate((a, b) => ({ vault: localStorage.getItem(a), ring: localStorage.getItem(b), state: document.getElementById('comms-onboard-intro').hidden }), IDENTITY, KEYRING);
  assert(c.vault === null && c.ring === null && c.state === false, 'Comms starts onboarding again with nothing stored', c);
  clean_(rig);
  clean_(rigs.get(comms));
});

check('a mismatched link never takes over an old-way session', async () => {
  await fresh(false);
  const page = await open('/about/', { auth: true });
  const rig = rigs.get(page);
  await openAdvanced(page);
  await press(page, '[data-reveal="about-identity-setup-form"]');
  await page.type('#about-identity-setup-pass', PASSPHRASE);
  await page.type('#about-identity-setup-pass2', PASSPHRASE);
  await page.click('#about-identity-setup-btn');
  await answerDialog(page);
  await waitVisible(page, '#about-identity-unlocked');
  await setSwitch(page, true);
  const tools = await open('/tools/');
  const code = await tools.evaluate(async (u) => {
    const m = await import(u);
    await m.ready();
    const made = await m.create({});
    await m.lock();
    return made.code;
  }, RUNTIME);
  await page.bringToFront();
  await page.reload({ waitUntil: 'load' });
  await openAdvanced(page);
  await waitVisible(page, '#about-identity-unlock');
  await page.type('#about-identity-unlock-pass', PASSPHRASE);
  await page.click('#about-identity-unlock-btn');
  await waitVisible(page, '#about-identity-card-slot .m-unlock', 20000);
  await page.click('#about-identity-later');
  await waitHidden(page, '#about-identity-card-slot');
  await tools.evaluate(async (u, c) => {
    const m = await import(u);
    await m.unlockWithCode(c);
    await m.link('identity', crypto.getRandomValues(new Uint8Array(32)));
  }, RUNTIME, code);
  await sleep(1200);
  const mid = await page.evaluate(() => ({ unlocked: MentriaIdentity.isUnlocked(), keyring: !!document.getElementById('about-identity-keyring').getClientRects().length }));
  assert(mid.unlocked && !mid.keyring, 'the old-way session stays and is not shown as the keyring', mid);
  await tools.evaluate(async (u) => { const m = await import(u); await m.lock(); }, RUNTIME);
  await sleep(1200);
  assert(await page.evaluate(() => MentriaIdentity.isUnlocked()), 'a keyring lock does not drop the old-way session');
  const vault = await readJson(page, IDENTITY);
  assert(vault.pass && !(((await readJson(page, KEYRING)).retired || {}).identity), 'nothing retired', Object.keys(vault));
  clean_(rig);
});

check('comms shows its lock screen even when the keyring boot fails', async () => {
  await fresh(false);
  const page = await open('/comms/', { auth: true });
  const rig = rigs.get(page);
  await commsOnboard(page, 'Boot Bea');
  await waitVisible(page, '#comms-onboard-done', 40000);
  await page.click('#comms-onboard-continue');
  await waitVisible(page, '#comms-id-on');
  await setSwitch(page, true);
  await page.evaluateOnNewDocument(() => {
    let held;
    let armed = true;
    Object.defineProperty(window, 'MentriaIdentity', {
      configurable: true,
      get() { return held; },
      set(v) {
        const orig = v.isLinked;
        v.isLinked = function () {
          if (armed) { armed = false; throw new Error('boot fault'); }
          return orig.apply(this, arguments);
        };
        held = v;
      }
    });
  });
  await page.reload({ waitUntil: 'load' });
  await waitVisible(page, '#comms-id-locked', 15000);
  clean_(rig);
});

check('a link that does not open the vault keeps the old lock', async () => {
  await fresh(false);
  const page = await open('/about/', { auth: true });
  const rig = rigs.get(page);
  await openAdvanced(page);
  await press(page, '[data-reveal="about-identity-setup-form"]');
  await page.type('#about-identity-setup-pass', PASSPHRASE);
  await page.type('#about-identity-setup-pass2', PASSPHRASE);
  await page.click('#about-identity-setup-btn');
  await answerDialog(page);
  await waitVisible(page, '#about-identity-unlocked');
  await setSwitch(page, true);
  await page.reload({ waitUntil: 'load' });
  await openAdvanced(page);
  await waitVisible(page, '#about-identity-unlock');
  await page.type('#about-identity-unlock-pass', PASSPHRASE);
  await page.click('#about-identity-unlock-btn');
  await waitStep(page, 'intro', 30000);
  await setupNew(page, { passkey: false });
  await waitVisible(page, '#about-identity-keyring', 30000);
  const vault0 = await readJson(page, IDENTITY);
  await page.evaluate(async (u, k) => {
    const m = await import(u);
    await m.link('identity', crypto.getRandomValues(new Uint8Array(32)));
    const r = JSON.parse(localStorage.getItem(k));
    r.services.identity.linked = new Date(Date.now() - 31 * 86400000).toISOString();
    localStorage.setItem(k, JSON.stringify(r));
  }, RUNTIME, KEYRING);
  await page.reload({ waitUntil: 'load' });
  await openAdvanced(page);
  await waitVisible(page, '#about-identity-unlock', 15000);
  await sleep(500);
  const r = await page.evaluate((k, ki) => ({
    unlocked: MentriaIdentity.isUnlocked(),
    card: !!document.querySelector('#about-identity-card-slot .m-unlock'),
    retired: !!(JSON.parse(localStorage.getItem(k)).retired || {}).identity,
    pass: !!JSON.parse(localStorage.getItem(ki)).pass
  }), KEYRING, IDENTITY);
  assert(!r.unlocked && !r.card && !r.retired && r.pass, 'the old unlock stays and nothing is retired', r);
  const ringBefore = (await readJson(page, KEYRING)).services.identity.ct;
  await page.type('#about-identity-unlock-pass', PASSPHRASE);
  await page.click('#about-identity-unlock-btn');
  await until(() => page.evaluate(() => MentriaIdentity.isUnlocked()), 20000, 'the old passphrase still opens the vault');
  await sleep(500);
  const after = await readJson(page, KEYRING);
  const vault = await readJson(page, IDENTITY);
  assert(after.services.identity.ct === ringBefore && !(after.retired || {}).identity, 'the keyring link is not overwritten', after.services.identity);
  assert(vault.pass && vault.kcv === vault0.kcv, 'the old wrap is kept', Object.keys(vault));
  assert(!(await page.$('.m-ulayer')), 'no setup sheet for an already linked identity');
  clean_(rig);
});

check('production build never loads the runtime', async () => {
  const prod = process.env.PROD;
  if (!prod) return 'skip';
  await fresh(true);
  server.setRoot(prod);
  try {
    const page = await open('/comms/', { auth: true });
    const rig = rigs.get(page);
    assert(await page.evaluate(() => document.documentElement.dataset.release !== 'beta'), 'PROD is not a beta build');
    await commsOnboard(page, 'Prod Pat');
    await waitVisible(page, '#comms-onboard-done', 40000);
    assert(CODE_SHAPE.test(await text(page, '#comms-onboard-code')), 'the old onboarding code step');
    await page.click('#comms-onboard-continue');
    await waitVisible(page, '#comms-id-on');
    const about = await open('/about/');
    await openAdvanced(about);
    await waitVisible(about, '#about-identity-unlock');
    for (const p of [page, about]) {
      assert(!(await loaded(p, RUNTIME)) && !(await loaded(p, UI)), 'no runtime or card request');
    }
    assert(!(await visible(about, '#about-identity-link')) && !(await visible(page, '#comms-id-lock')), 'no keyring controls');
    assert(!(await readJson(page, KEYRING)), 'no keyring record');
    clean_(rig);
  } finally {
    server.setRoot(BUILD);
  }
});

let failed = 0;
let passed = 0;
try {
  for (const [name, fn] of checks) {
    if (ONLY.length && !ONLY.some((o) => name.includes(o))) continue;
    const t0 = Date.now();
    try {
      if (await fn() === 'skip') {
        console.log('SKIP ' + name + ' (set PROD=<non-beta build>)');
        continue;
      }
      passed++;
      console.log('PASS ' + name + ' (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)');
    } catch (e) {
      failed++;
      console.log('FAIL ' + name + ': ' + String((e && e.message) || e).split('\n')[0].slice(0, 400));
    }
  }
} finally {
  await browser.close();
  await server.close();
  rmSync(PROFILE, { recursive: true, force: true });
}
console.log(passed + '/' + (passed + failed) + ' passed');
process.exit(failed ? 1 : 0);
