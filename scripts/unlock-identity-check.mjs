import { rmSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
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
const FILES = join(tmpdir(), 'unlock-identity-check-files');
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
const LOCAL_IDENTITY = 'mentria.identity.local';
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
rmSync(FILES, { recursive: true, force: true });
mkdirSync(FILES, { recursive: true });
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
  await page.evaluate((k, v) => {
    let l = {};
    try { l = JSON.parse(localStorage.getItem(k) || '{}') || {}; } catch (_) { l = {}; }
    l.enabled = v;
    localStorage.setItem(k, JSON.stringify(l));
  }, LOCAL, on);
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

function deviceWrapKept(page) {
  return page.evaluate(async () => (await indexedDB.databases()).some((d) => d.name === 'mentria-identity') && new Promise((ok) => {
    const req = indexedDB.open('mentria-identity');
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('keys')) { db.close(); ok(false); return; }
      const g = db.transaction('keys', 'readonly').objectStore('keys').get('device-wrap');
      g.onsuccess = () => { ok(!!g.result); db.close(); };
      g.onerror = () => { ok(false); db.close(); };
    };
    req.onerror = () => ok(false);
  }));
}

function rememberUi(page) {
  return page.evaluate((k) => {
    const l = JSON.parse(localStorage.getItem(k) || 'null') || {};
    return {
      row: !!document.getElementById('about-identity-device-row').getClientRects().length,
      checked: document.getElementById('about-identity-device').checked,
      note: document.getElementById('about-identity-passkey-note').textContent.trim(),
      layer: !!document.querySelector('.m-ulayer'),
      pending: l.rememberPending === true,
      decision: l.remember || null
    };
  }, LOCAL);
}

async function seedLegacyDevice(page) {
  await openAdvanced(page);
  await press(page, '[data-reveal="about-identity-setup-form"]');
  await page.type('#about-identity-setup-pass', PASSPHRASE);
  await page.type('#about-identity-setup-pass2', PASSPHRASE);
  await page.click('#about-identity-setup-btn');
  await answerDialog(page);
  await waitVisible(page, '#about-identity-unlocked');
  await page.click('#about-identity-device');
  await until(() => readJson(page, IDENTITY).then((v) => !!(v && v.device)), 15000, 'seed: device unlock on');
  await until(() => deviceWrapKept(page), 10000, 'seed: device key stored');
  const vault0 = await readJson(page, IDENTITY);
  assert(vault0.pass && vault0.device, 'seed: pass and device wraps', Object.keys(vault0));
  return vault0;
}

async function dropKeyring(page) {
  await page.goto(ORIGIN + '/robots.txt', { waitUntil: 'load' });
  await page.evaluate(async (k) => {
    localStorage.removeItem(k);
    localStorage.removeItem(k.replace('mentria.store.', 'mentria.meta.'));
    await new Promise((ok) => {
      const req = indexedDB.deleteDatabase('mentria-keyring');
      req.onsuccess = req.onerror = req.onblocked = () => ok();
    });
  }, KEYRING);
}

async function seedSilentLink(page) {
  await openAdvanced(page);
  await press(page, '[data-reveal="about-identity-setup-form"]');
  await page.type('#about-identity-setup-pass', PASSPHRASE);
  await page.type('#about-identity-setup-pass2', PASSPHRASE);
  await page.click('#about-identity-setup-btn');
  await answerDialog(page);
  await waitVisible(page, '#about-identity-unlocked');
  await page.click('#about-identity-device');
  await until(() => readJson(page, IDENTITY).then((v) => !!(v && v.device)), 15000, 'seed: device unlock on');
  const vault0 = await readJson(page, IDENTITY);
  assert(vault0.pass && vault0.device, 'seed: pass and device wraps', Object.keys(vault0));
  await setSwitch(page, true);
  const tools = await open('/tools/');
  const code = await tools.evaluate(async (u) => {
    const m = await import(u);
    await m.ready();
    const made = await m.create({});
    if (!m.confirmCode(made.code.replace(/-/g, '').slice(-4))) throw new Error('code not confirmed');
    return made.code;
  }, RUNTIME);
  await page.bringToFront();
  await page.reload({ waitUntil: 'load' });
  await openAdvanced(page);
  await until(() => readJson(page, KEYRING).then((r) => !!(r && r.services.identity)), 20000, 'the identity opened by the old device key links into the open keyring');
  await waitVisible(page, '#about-identity-keyring', 15000);
  return { vault0, tools, code };
}

async function backdateIdentityLink(page) {
  await page.evaluate((k) => {
    const r = JSON.parse(localStorage.getItem(k));
    const old = new Date(Date.now() - 31 * 86400000).toISOString();
    r.services.identity.linked = old;
    for (const p of r.services.identity.prior || []) p.linked = old;
    localStorage.setItem(k, JSON.stringify(r));
  }, KEYRING);
}

function toastHas(page, t) {
  return page.evaluate((x) => [...document.querySelectorAll('.m-toast')].some((el) => el.textContent.includes(x)), t);
}

async function seedAboutPass(page, { passkey = false, pass = PASSPHRASE } = {}) {
  await openAdvanced(page);
  await press(page, '[data-reveal="about-identity-setup-form"]');
  await page.type('#about-identity-setup-pass', pass);
  await page.type('#about-identity-setup-pass2', pass);
  await page.click('#about-identity-setup-btn');
  await answerDialog(page);
  await waitVisible(page, '#about-identity-unlocked');
  if (passkey) {
    await page.click('#about-identity-passkey-add');
    await answerDialog(page);
  }
  const v = await readJson(page, IDENTITY);
  assert(v && v.pass && (!passkey || v.prf), 'seed: legacy About vault', v && Object.keys(v));
  return v;
}

async function seedCommsLegacy(page, name) {
  await commsOnboard(page, name);
  await waitVisible(page, '#comms-onboard-done', 40000);
  const code = await text(page, '#comms-onboard-code');
  await page.click('#comms-onboard-continue');
  await waitVisible(page, '#comms-id-on');
  const fp = await fingerprint(page);
  await until(() => readJson(page, IDKEYS).then((v) => !!v), 10000, 'seed: legacy comms keys');
  return { code, fp };
}

async function otherTabKeyring(link) {
  const tools = await open('/tools/');
  const code = await tools.evaluate(async (u, l) => {
    const m = await import(u);
    await m.ready();
    const made = await m.create({});
    if (!m.confirmCode(made.code.replace(/-/g, '').slice(-4))) throw new Error('code not confirmed');
    if (l === 'random') await m.link('identity', crypto.getRandomValues(new Uint8Array(32)));
    if (l !== 'open') await m.lock();
    return made.code;
  }, RUNTIME, link);
  return { tools, code };
}

async function holdRuntime(page, ms, all) {
  await page.setBypassServiceWorker(true);
  await page.setRequestInterception(true);
  const held = [];
  page.on('request', (q) => {
    if (q.isInterceptResolutionHandled()) return;
    const u = q.url();
    if (all ? u.includes('/assets/js/mentria-unlock') : u.includes('/assets/js/mentria-unlock.js')) {
      held.push(u);
      if (ms != null) setTimeout(() => { try { q.continue(); } catch (_) {} }, ms);
      return;
    }
    q.continue();
  });
  return held;
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
  const api = await page.evaluate(() => ({ useSecret: typeof MentriaIdentity.useSecret, isLinked: typeof MentriaIdentity.isLinked }));
  assert(api.useSecret === 'undefined' && api.isLinked === 'undefined', 'the identity module has no unused secret setter and no raw link test', api);
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
  assert(JSON.stringify(join.bytes) === JSON.stringify(await identityBytes(page)), 'the bytes are the identity this page opened');
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
  await until(() => toastHas(page, EN.about.identity_passkey_again), 5000, 'About says to press Add a passkey again');
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
  await until(() => toastHas(page, EN.tool.comms.passkey.again), 5000, 'Comms says to press add again');
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
  assert(!(await visible(page, '#about-identity-old')), 'no old-unlock disclosure after retirement');
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
  await commsOnboard(page, 'Other Name');
  await waitVisible(page, '#comms-onboard-card .m-unlock', 20000);
  assert(!(await page.$('.m-ulayer')), 'no setup sheet for a keyring that exists');
  await cardCode(page, '#comms-onboard-card', code);
  await waitVisible(page, '#comms-id-on', 30000);
  assert(await fingerprint(page) === fp, 'the same Comms identity comes back');
  const prof = await readJson(page, 'mentria.store.comms.profile');
  assert(prof && prof.name === 'Same Sam', 'a rebuild keeps the profile name', prof);
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
  await waitVisible(page, '#about-identity-setup-pass');
  assert(!(await visible(page, '#about-identity-create')), 'Not now falls back to the passphrase setup');
  await nothing('Not now');
  await page.reload({ waitUntil: 'load' });
  await openAdvanced(page);
  await waitVisible(page, '#about-identity-create');
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
        const orig = v.isSetUp;
        v.isSetUp = function () {
          if (armed && /krBootSteps/.test(new Error().stack || '')) { armed = false; throw new Error('boot fault'); }
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

check('a replaced identity entry still opens from its prior', async () => {
  await fresh(true);
  const page = await open('/comms/', { auth: true });
  const rig = rigs.get(page);
  await commsOnboard(page, 'Prior Pia');
  await setupNew(page, { passkey: false });
  await waitVisible(page, '#comms-id-on', 30000);
  const fp = await fingerprint(page);
  await until(() => readJson(page, IDKEYS).then((v) => !!(v && v.wrapped)), 10000, 'comms keys written');
  const mine = await keyringSecret(page);
  const vault0 = await page.evaluate((k) => localStorage.getItem(k), IDENTITY);
  await page.evaluate(async (u, k) => {
    const m = await import(u);
    await m.link('identity', crypto.getRandomValues(new Uint8Array(32)));
    const r = JSON.parse(localStorage.getItem(k));
    const old = new Date(Date.now() - 31 * 86400000).toISOString();
    r.services.identity.linked = old;
    for (const p of r.services.identity.prior || []) p.linked = old;
    localStorage.setItem(k, JSON.stringify(r));
  }, RUNTIME, KEYRING);
  const rec = await readJson(page, KEYRING);
  const current = await keyringSecret(page);
  assert(JSON.stringify(current) !== JSON.stringify(mine), 'seed: the current entry is another identity');
  assert(Array.isArray(rec.services.identity.prior) && rec.services.identity.prior.length >= 1, 'seed: this identity is kept as a prior entry', rec.services.identity);
  assert((await page.evaluate(async (u) => (await import(u)).retirement('identity'), RUNTIME)).ready === true, 'seed: retirement would be ready for the current entry');
  await page.reload({ waitUntil: 'load' });
  await waitVisible(page, '#comms-id-on', 30000);
  assert(await fingerprint(page) === fp, 'the same Comms identity and keypair open');
  await sleep(800);
  assert(!((await readJson(page, KEYRING)).retired || {}).identity, 'Comms does not retire through a prior entry');
  assert(await idkeysOpenWith(page, mine), 'the ECDH keypair is still wrapped by this identity');
  assert(await page.evaluate((k) => localStorage.getItem(k), IDENTITY) === vault0, 'the vault is not rebuilt');
  assert(JSON.stringify(await page.evaluate(() => Array.from(MentriaIdentity.getSecret()))) === JSON.stringify(mine), 'Comms holds the prior secret, not the current one');
  const about = await open('/about/');
  await openAdvanced(about);
  await until(() => about.evaluate(() => window.MentriaIdentity && MentriaIdentity.isUnlocked()), 15000, 'About opens it too');
  await about.waitForFunction(() => !!window.MentriaSync, { timeout: 20000 });
  await about.evaluate(() => {
    window.__joins = [];
    window.MentriaSync.joinWithIdentity = async (b) => { window.__joins.push(Array.from(b)); };
  });
  await about.click('#about-identity-sync-btn');
  await until(() => about.evaluate(() => window.__joins.length === 1), 10000, 'joinWithIdentity called');
  assert(JSON.stringify(await about.evaluate(() => window.__joins[0])) === JSON.stringify(mine), 'sync joins with the identity this device holds');
  clean_(rig);
  clean_(rigs.get(about));
});

check('about opens from a prior entry and never retires through it', async () => {
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
  await page.click('#about-identity-device');
  await until(() => readJson(page, IDENTITY).then((v) => !!(v && v.device)), 15000, 'seed: device unlock on');
  const vault0 = await readJson(page, IDENTITY);
  assert(vault0.pass && vault0.prf && vault0.device, 'seed: pass, prf and device wraps', Object.keys(vault0));
  await setSwitch(page, true);
  await page.reload({ waitUntil: 'load' });
  await openAdvanced(page);
  await waitVisible(page, '#about-identity-link-btn', 20000);
  await page.click('#about-identity-link-btn');
  await waitStep(page, 'intro', 30000);
  await setupNew(page, { passkey: false });
  await waitVisible(page, '#about-identity-keyring', 30000);
  const mine = await identityBytes(page);
  await page.evaluate(async (u, k) => {
    const m = await import(u);
    await m.link('identity', crypto.getRandomValues(new Uint8Array(32)));
    const r = JSON.parse(localStorage.getItem(k));
    const old = new Date(Date.now() - 31 * 86400000).toISOString();
    r.services.identity.linked = old;
    for (const p of r.services.identity.prior || []) p.linked = old;
    localStorage.setItem(k, JSON.stringify(r));
  }, RUNTIME, KEYRING);
  const status = await page.evaluate(async (u) => (await import(u)).retirement('identity'), RUNTIME);
  assert(status.ready === true, 'seed: retirement would be ready for the current entry', status);
  await page.evaluateOnNewDocument(SIGNAL_PROBE);
  await page.reload({ waitUntil: 'load' });
  await openAdvanced(page);
  await until(() => page.evaluate(() => MentriaIdentity.isUnlocked()), 15000, 'the identity opens from its prior entry');
  await sleep(1000);
  assert(JSON.stringify(await identityBytes(page)) === JSON.stringify(mine), 'About holds this vault\'s secret');
  assert(await visible(page, '#about-identity-keyring'), 'opened from the keyring, not the old way');
  const vault = await readJson(page, IDENTITY);
  const rec = await readJson(page, KEYRING);
  assert(JSON.stringify(vault.pass) === JSON.stringify(vault0.pass) && JSON.stringify(vault.prf) === JSON.stringify(vault0.prf) && !!vault.device, 'pass, prf and device are kept', Object.keys(vault));
  assert(!(rec.retired || {}).identity, 'identity is not retired', rec.retired);
  assert(!(await page.evaluate(() => window.__signals.length)), 'no passkey signal');
  const key = await page.evaluate(() => new Promise((ok) => {
    const req = indexedDB.open('mentria-identity');
    req.onsuccess = () => {
      const g = req.result.transaction('keys', 'readonly').objectStore('keys').get('device-wrap');
      g.onsuccess = () => { ok(!!g.result); req.result.close(); };
      g.onerror = () => ok(false);
    };
    req.onerror = () => ok(false);
  }));
  assert(key, 'the device key is kept');
  clean_(rig);
});

check('a rebuild prefers the identity that opens the comms keys', async () => {
  await fresh(true);
  const page = await open('/comms/', { auth: true });
  const rig = rigs.get(page);
  await commsOnboard(page, 'Keys Kai');
  const code = await setupNew(page, { passkey: false });
  await waitVisible(page, '#comms-id-on', 30000);
  const fp = await fingerprint(page);
  await until(() => readJson(page, IDKEYS).then((v) => !!(v && v.wrapped)), 10000, 'comms keys written');
  const mine = await keyringSecret(page);
  await page.evaluate(async (u) => {
    const m = await import(u);
    await m.link('identity', crypto.getRandomValues(new Uint8Array(32)));
    window.MentriaStore.remove('identity', 'vault');
  }, RUNTIME);
  assert(JSON.stringify(await keyringSecret(page)) !== JSON.stringify(mine), 'seed: the current entry is another identity');
  await lockAndWaitReload(page);
  await waitVisible(page, '#comms-onboard', 20000);
  await commsOnboard(page, 'Keys Kai');
  await waitVisible(page, '#comms-onboard-card .m-unlock', 20000);
  await cardCode(page, '#comms-onboard-card', code);
  await waitVisible(page, '#comms-id-on', 30000);
  assert(await fingerprint(page) === fp, 'Create rebuilds the identity that opens the comms keys');
  assert(await vaultKcvMatches(page, mine), 'the rebuilt vault uses the prior identity');
  await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({ v: 3, kcv: 'AAAAAAAAAAAAAAAAAAAAAA', linked: true })), IDENTITY);
  await page.reload({ waitUntil: 'load' });
  await waitVisible(page, '#comms-id-on', 30000);
  assert(await fingerprint(page) === fp, 'the open-time rebuild picks it too');
  assert(await vaultKcvMatches(page, mine), 'the vault uses the prior identity again');
  clean_(rig);
});

check('retireLegacy only touches the vault it was checked against', async () => {
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
  const r = await page.evaluate((k) => {
    const out = {};
    out.none = MentriaIdentity.retireLegacy();
    out.noneKept = !!JSON.parse(localStorage.getItem(k)).pass;
    out.wrong = MentriaIdentity.retireLegacy('AAAAAAAAAAAAAAAAAAAAAA');
    out.wrongKept = !!JSON.parse(localStorage.getItem(k)).pass;
    out.right = MentriaIdentity.retireLegacy(JSON.parse(localStorage.getItem(k)).kcv);
    const v = JSON.parse(localStorage.getItem(k));
    out.after = { pass: !!v.pass, v: v.v, linked: v.linked };
    return out;
  }, IDENTITY);
  assert(r.none === false && r.noneKept && r.wrong === false && r.wrongKept, 'nothing is deleted without the matching kcv', r);
  assert(r.right === true && !r.after.pass && r.after.v === 3 && r.after.linked === true, 'the matching kcv retires', r);
  clean_(rig);
});

check('openLinked skips malformed candidates and wipes the others', async () => {
  await fresh(true);
  const page = await open('/about/', { auth: true });
  const rig = rigs.get(page);
  await aboutCreate(page, { passkey: false });
  const mine = await keyringSecret(page);
  const r = await page.evaluate(async (good) => {
    MentriaIdentity.lock();
    const fills = [];
    const orig = Uint8Array.prototype.fill;
    Uint8Array.prototype.fill = function (v) {
      if (v === 0 && this.length === 32) fills.push(Array.from(this.slice(0, 4)).join(','));
      return orig.apply(this, arguments);
    };
    const other = crypto.getRandomValues(new Uint8Array(32));
    let at = null;
    let err = null;
    try { at = await MentriaIdentity.openLinked([new Uint8Array(3), 'nope', null, other, new Uint8Array(good)]); } catch (e) { err = e.message; }
    const held = MentriaIdentity.isUnlocked() ? Array.from(MentriaIdentity.getSecret()) : null;
    let all = null;
    try { await MentriaIdentity.openLinked([new Uint8Array(3), 'nope']); all = 'opened'; } catch (e) { all = e.message; }
    Uint8Array.prototype.fill = orig;
    return { at, err, held, fills: fills.length, other: Array.from(other.slice(0, 4)).join(','), all };
  }, mine);
  assert(r.err === null && r.at === 4, 'the good candidate is used after malformed ones', r);
  assert(JSON.stringify(r.held) === JSON.stringify(mine), 'the page holds the chosen secret', r.held && r.held.length);
  assert(r.fills >= 1, 'the copy of the candidate not chosen is wiped', r);
  assert(r.all === 'locked', 'only malformed candidates throws', r);
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
    delete r.services.identity.prior;
    localStorage.setItem(k, JSON.stringify(r));
  }, RUNTIME, KEYRING);
  assert(!(await readJson(page, KEYRING)).services.identity.prior, 'seed: no keyring entry opens this vault');
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

check('comms carries a remembered identity over to Remember this device', async () => {
  await fresh(false);
  const page = await open('/comms/', { auth: true });
  const rig = rigs.get(page);
  await commsOnboard(page, 'Device Dee');
  await waitVisible(page, '#comms-onboard-done', 40000);
  const code = await text(page, '#comms-onboard-code');
  await page.click('#comms-onboard-continue');
  await waitVisible(page, '#comms-id-on');
  const fp = await fingerprint(page);
  await page.evaluate(() => MentriaIdentity.setDeviceUnlock(true));
  const vault0 = await readJson(page, IDENTITY);
  assert(vault0.pass && vault0.prf && vault0.device, 'seed: pass, prf and device wraps', Object.keys(vault0));
  assert(await deviceWrapKept(page), 'seed: the device key is stored');
  await setSwitch(page, true);
  await page.goto(ORIGIN + '/comms/', { waitUntil: 'load' });
  await waitVisible(page, '#comms-link-go', 30000);
  assert(await page.evaluate(() => MentriaIdentity.isUnlocked()), 'the old device key opens the identity');
  await page.click('#comms-link-go');
  await waitStep(page, 'intro', 30000);
  await page.click('.m-ulayer [data-act="next"]');
  await waitStep(page, 'code');
  await page.type('.m-ulayer input[name="saved-code"]', code);
  await page.click('.m-ulayer [data-act="next"]');
  await finishMethod(page, { passkey: false });
  await until(() => readJson(page, KEYRING).then((r) => !!(r && r.services.identity)), 15000, 'identity linked');
  await until(() => runtime(page).then((st) => st.hasDevice === true), 15000, 'Remember this device on in the keyring');
  const vault = await readJson(page, IDENTITY);
  assert(JSON.stringify(vault.device) === JSON.stringify(vault0.device) && vault.pass && vault.prf, 'the old wraps are kept until retirement', Object.keys(vault));
  assert(await deviceWrapKept(page), 'the old device key is kept until retirement');
  assert(await fingerprint(page) === fp, 'the same Comms identity');
  await backdateIdentityLink(page);
  await page.evaluateOnNewDocument(SIGNAL_PROBE);
  await page.reload({ waitUntil: 'load' });
  await until(async () => {
    const r = await readJson(page, KEYRING);
    return !!(r && r.retired && r.retired.identity);
  }, 20000, 'identity marked retired');
  const after = await readJson(page, IDENTITY);
  assert(JSON.stringify(Object.keys(after).sort()) === JSON.stringify(['kcv', 'linked', 'v']) && after.kcv === vault0.kcv && after.v === 3, 'retirement deletes the old device wrap with the others', after);
  await until(async () => !(await deviceWrapKept(page)), 10000, 'the old device key is deleted');
  assert((await runtime(page)).hasDevice === true, 'Remember this device stays on');
  await lockAndWaitReload(page);
  await waitVisible(page, '#comms-id-card-slot .m-unlock', 20000);
  await sleep(400);
  assert(!(await visible(page, '#comms-lock-old')) && !(await visible(page, '#comms-lock-alt')), 'no old-unlock disclosure once the old wraps are gone');
  clean_(rig);
});

check('a legacy device key survives retirement while the keyring has none', async () => {
  await fresh(false);
  const page = await open('/about/', { auth: true });
  const rig = rigs.get(page);
  const { vault0, tools } = await seedSilentLink(page);
  const st = await page.evaluate(async (u) => {
    const m = await import(u);
    return { hasDevice: m.state().hasDevice, bytes: m.hasRootBytes() };
  }, RUNTIME);
  assert(!st.bytes && !st.hasDevice, 'seed: the keyring could not take Remember this device without a confirm', st);
  const ui = await rememberUi(page);
  assert(ui.row && ui.checked && ui.pending && !ui.layer, 'Remember this device shows as on, pending the next unlock, with no sheet', ui);
  const kept = await readJson(page, IDENTITY);
  assert(JSON.stringify(kept.device) === JSON.stringify(vault0.device), 'the old device wrap is kept at link time');
  await tools.close();
  await backdateIdentityLink(page);
  await page.evaluateOnNewDocument(SIGNAL_PROBE);
  await page.reload({ waitUntil: 'load' });
  await openAdvanced(page);
  await until(async () => {
    const r = await readJson(page, KEYRING);
    return !!(r && r.retired && r.retired.identity);
  }, 20000, 'identity marked retired');
  const vault = await readJson(page, IDENTITY);
  assert(!vault.pass && !vault.prf && vault.v === 3 && vault.linked === true && vault.kcv === vault0.kcv, 'the other old wraps retire', vault);
  assert(JSON.stringify(vault.device) === JSON.stringify(vault0.device), 'the old device wrap survives retirement', Object.keys(vault));
  await sleep(500);
  assert(await deviceWrapKept(page), 'the old device key survives retirement');
  await setSwitch(page, false);
  await page.reload({ waitUntil: 'load' });
  await openAdvanced(page);
  await until(() => page.evaluate(() => MentriaIdentity.isUnlocked()), 15000, 'with the switch off the old device key still opens the identity');
  clean_(rig);
  clean_(rigs.get(tools));
});

check('a silent link turns Remember this device on at the next unlock on About', async () => {
  await fresh(false);
  const page = await open('/about/', { auth: true });
  const rig = rigs.get(page);
  const { vault0, tools, code } = await seedSilentLink(page);
  const st0 = await runtime(page);
  assert(!st0.hasDevice, 'seed: the link could not take Remember this device without a confirm', st0);
  const ui0 = await rememberUi(page);
  assert(ui0.checked && ui0.pending, 'seed: Remember this device shows as on, pending', ui0);
  await tools.close();
  await page.evaluate(async (u) => { const m = await import(u); await m.lock(); }, RUNTIME);
  await waitVisible(page, '#about-identity-card-slot .m-unlock', 15000);
  await cardCode(page, '#about-identity-card-slot', code);
  await until(() => page.evaluate(() => MentriaIdentity.isUnlocked()), 20000, 'the card opens the identity');
  await until(() => runtime(page).then((s) => s.hasDevice === true), 15000, 'Remember this device turns on after the unlock');
  await until(() => rememberUi(page).then((u) => !u.pending), 10000, 'the pending flag clears');
  const ui = await rememberUi(page);
  assert(ui.row && ui.checked && !ui.layer, 'Remember this device shows on, with no extra sheet', ui);
  assert(JSON.stringify((await readJson(page, IDENTITY)).device) === JSON.stringify(vault0.device), 'the old device wrap is kept until retirement');
  await closeAll();
  const again = await open('/about/');
  await openAdvanced(again);
  await until(() => again.evaluate(() => MentriaIdentity.isUnlocked()), 20000, 'the next reopen opens the identity by itself');
  const r = await again.evaluate(async (u) => {
    const m = await import(u);
    const s = m.state();
    return { unlocked: s.unlocked, hasDevice: s.hasDevice, launch: s.launch, card: !!document.querySelector('#about-identity-card-slot .m-unlock'), layer: !!document.querySelector('.m-ulayer'), wa: window.__wa.slice() };
  }, RUNTIME);
  assert(r.launch === 'reopen' && r.unlocked && r.hasDevice && !r.card && !r.layer && !r.wa.length, 'a reopen opens without asking', r);
  clean_(rig);
  clean_(rigs.get(tools));
  clean_(rigs.get(again));
});

check('a device that receives a linked identity with its own device unlock gets Remember on at its next unlock', async () => {
  await fresh(false);
  const page = await open('/about/', { auth: true });
  const rig = rigs.get(page);
  const vault0 = await seedLegacyDevice(page);
  const secret = await identityBytes(page);
  await setSwitch(page, true);
  const tools = await open('/tools/');
  const code = await tools.evaluate(async (u, b) => {
    const m = await import(u);
    await m.ready();
    const made = await m.create({});
    if (!m.confirmCode(made.code.replace(/-/g, '').slice(-4))) throw new Error('code not confirmed');
    await m.link('identity', new Uint8Array(b));
    return made.code;
  }, RUNTIME, secret);
  await page.bringToFront();
  await page.reload({ waitUntil: 'load' });
  await openAdvanced(page);
  await until(() => page.evaluate(() => MentriaIdentity.isUnlocked()), 20000, 'the identity opens from the keyring');
  await until(() => rememberUi(page).then((u) => u.pending), 10000, 'Remember this device is pending on this device');
  const ui0 = await rememberUi(page);
  assert(ui0.row && ui0.checked && ui0.note === EN.about.identity_remember_pending && !ui0.layer && !ui0.decision, 'the toggle shows on, with the next-unlock note and no sheet', ui0);
  assert(!(await runtime(page)).hasDevice, 'seed: the keyring does not remember this device yet');
  await tools.close();
  await backdateIdentityLink(page);
  await page.reload({ waitUntil: 'load' });
  await openAdvanced(page);
  await until(async () => {
    const r = await readJson(page, KEYRING);
    return !!(r && r.retired && r.retired.identity);
  }, 20000, 'identity marked retired');
  const retired = await readJson(page, IDENTITY);
  assert(!retired.pass && JSON.stringify(retired.device) === JSON.stringify(vault0.device) && await deviceWrapKept(page), 'retirement keeps the device unlock while Remember is pending', Object.keys(retired));
  await page.evaluate(async (u) => { const m = await import(u); await m.lock(); }, RUNTIME);
  await waitVisible(page, '#about-identity-card-slot .m-unlock', 15000);
  await cardCode(page, '#about-identity-card-slot', code);
  await until(() => runtime(page).then((st) => st.hasDevice === true), 20000, 'Remember this device turns on after the card unlock');
  await until(() => rememberUi(page).then((u) => !u.pending), 10000, 'the pending flag clears');
  await until(() => readJson(page, IDENTITY).then((v) => !v.device), 10000, 'the leftover old device wrap is deleted');
  await until(async () => !(await deviceWrapKept(page)), 10000, 'the leftover old device key is deleted');
  const ui = await rememberUi(page);
  assert(ui.row && ui.checked && ui.note === EN.unlock.remember_note, 'the toggle shows on with the usual note', ui);
  await closeAll();
  const again = await open('/about/');
  await openAdvanced(again);
  await until(() => again.evaluate(() => MentriaIdentity.isUnlocked()), 20000, 'the next reopen opens the identity by itself');
  const r = await again.evaluate(async (u) => {
    const m = await import(u);
    const s = m.state();
    return { unlocked: s.unlocked, launch: s.launch, card: !!document.querySelector('#about-identity-card-slot .m-unlock'), wa: window.__wa.slice() };
  }, RUNTIME);
  assert(r.launch === 'reopen' && r.unlocked && !r.card && !r.wa.length, 'a reopen opens without asking', r);
  clean_(rig);
  clean_(rigs.get(tools));
  clean_(rigs.get(again));
});

check('Remember turned off stays off and lets retirement delete the old device key', async () => {
  await fresh(false);
  const page = await open('/about/', { auth: true });
  const rig = rigs.get(page);
  await seedLegacyDevice(page);
  await setSwitch(page, true);
  await page.reload({ waitUntil: 'load' });
  await openAdvanced(page);
  await waitVisible(page, '#about-identity-link-btn', 20000);
  await page.click('#about-identity-link-btn');
  await setupNew(page, { passkey: false });
  await until(() => runtime(page).then((st) => st.hasDevice === true), 15000, 'seed: Remember this device carried over');
  await waitVisible(page, '#about-identity-device', 15000);
  await page.click('#about-identity-device');
  await until(() => runtime(page).then((st) => st.hasDevice === false), 15000, 'Remember this device turns off');
  const off = await rememberUi(page);
  assert(off.decision === 'off' && !off.checked && !off.pending, 'the off decision is recorded on this device', off);
  await page.reload({ waitUntil: 'load' });
  await openAdvanced(page);
  await waitVisible(page, '#about-identity-device', 15000);
  await page.evaluate((k) => {
    const l = JSON.parse(localStorage.getItem(k) || 'null') || {};
    l.remember = 'on';
    localStorage.setItem(k, JSON.stringify(l));
  }, LOCAL);
  await page.click('#about-identity-device');
  await waitVisible(page, '.m-ulayer [data-act="not-now"]', 15000);
  await page.click('.m-ulayer [data-act="not-now"]');
  await sheetClosed(page, 15000);
  await until(() => page.$eval('#about-identity-device', (el) => !el.disabled), 10000, 'the toggle settles');
  const cancelled = await rememberUi(page);
  assert(cancelled.decision === 'off' && !cancelled.checked && !(await runtime(page)).hasDevice, 'cancelling the confirm for Remember records off', cancelled);
  await dropKeyring(page);
  await page.goto(ORIGIN + '/about/', { waitUntil: 'load' });
  await openAdvanced(page);
  await waitVisible(page, '#about-identity-link-btn', 20000);
  assert(await page.evaluate(() => MentriaIdentity.isUnlocked()), 'the old device key still opens the unlinked identity');
  await page.click('#about-identity-link-btn');
  await setupNew(page, { passkey: false });
  await until(() => readJson(page, KEYRING).then((r) => !!(r && r.services.identity)), 15000, 'linked again');
  await sleep(800);
  const st = await runtime(page);
  const again = await rememberUi(page);
  assert(!st.hasDevice && !again.pending && again.decision === 'off' && !again.checked, 're-linking does not turn Remember back on', { hasDevice: st.hasDevice, again });
  await backdateIdentityLink(page);
  await page.reload({ waitUntil: 'load' });
  await openAdvanced(page);
  await until(async () => {
    const r = await readJson(page, KEYRING);
    return !!(r && r.retired && r.retired.identity);
  }, 20000, 'identity marked retired');
  const vault = await readJson(page, IDENTITY);
  assert(JSON.stringify(Object.keys(vault).sort()) === JSON.stringify(['kcv', 'linked', 'v']), 'retirement deletes the old device wrap after an off', vault);
  await until(async () => !(await deviceWrapKept(page)), 10000, 'the old device key is deleted');
  clean_(rig);
});

check('the no-passkey setup sheet starts Remember checked for a device unlock and records an uncheck', async () => {
  await fresh(false);
  const noPrf = () => {
    if (window.PublicKeyCredential) PublicKeyCredential.getClientCapabilities = async () => ({ 'extension:prf': false });
  };
  const page = await open('/about/', { init: noPrf });
  const rig = rigs.get(page);
  await seedLegacyDevice(page);
  await setSwitch(page, true);
  await page.reload({ waitUntil: 'load' });
  await openAdvanced(page);
  await waitVisible(page, '#about-identity-link-btn', 20000);
  await page.click('#about-identity-link-btn');
  await waitStep(page, 'intro');
  await page.click('.m-ulayer [data-act="next"]');
  await waitStep(page, 'code');
  const code = await page.$eval('.m-ulayer .m-ucode', (el) => el.textContent.replace(/\s+/g, ''));
  await page.type('.m-ulayer input[name="code-check"]', code.replace(/[^A-Z2-7]/g, '').slice(-4));
  await until(() => page.$eval('.m-ulayer [data-act="next"]', (b) => !b.disabled), 5000, 'Next enabled');
  await page.click('.m-ulayer [data-act="next"]');
  await waitStep(page, 'no-prf', 20000);
  assert(await page.$eval('.m-ulayer input[name="remember"]', (el) => el.checked), 'Remember starts checked for a device that had it on');
  await page.click('.m-ulayer input[name="remember"]');
  await page.click('.m-ulayer [data-act="done"]');
  await sheetClosed(page);
  await until(() => readJson(page, KEYRING).then((r) => !!(r && r.services.identity)), 15000, 'identity linked');
  await sleep(800);
  const st = await runtime(page);
  const ui = await rememberUi(page);
  assert(!st.hasDevice && ui.decision === 'off' && !ui.pending && !ui.checked, 'the uncheck is recorded and Remember stays off', { hasDevice: st.hasDevice, ui });
  const cleared = await page.evaluate((k) => { MentriaIdentity.clearVault(); return localStorage.getItem(k); }, LOCAL_IDENTITY);
  assert(cleared === null, 'clearing the identity clears its device-local settings', cleared);
  clean_(rig);
});

check('a legacy switch-off clears a pending Remember', async () => {
  await fresh(false);
  const page = await open('/about/', { auth: true });
  const rig = rigs.get(page);
  const { tools, code } = await seedSilentLink(page);
  assert((await rememberUi(page)).pending, 'seed: Remember is pending');
  await tools.close();
  await setSwitch(page, false);
  await page.reload({ waitUntil: 'load' });
  await openAdvanced(page);
  await until(() => page.evaluate(() => MentriaIdentity.isUnlocked()), 15000, 'the old device key opens the identity with the switch off');
  await waitVisible(page, '#about-identity-device', 15000);
  assert(await page.$eval('#about-identity-device', (el) => el.checked), 'seed: the old Remember toggle shows on');
  await page.click('#about-identity-device');
  await until(() => readJson(page, IDENTITY).then((v) => !v.device), 15000, 'the old device unlock turns off');
  await until(() => rememberUi(page).then((u) => u.decision === 'off'), 10000, 'the old toggle records off');
  await setSwitch(page, true);
  await page.reload({ waitUntil: 'load' });
  await openAdvanced(page);
  await until(() => page.evaluate(() => MentriaIdentity.isUnlocked()), 20000, 'the identity opens from the keyring again');
  await page.evaluate(async (u) => { const m = await import(u); await m.lock(); }, RUNTIME);
  await waitVisible(page, '#about-identity-card-slot .m-unlock', 15000);
  await cardCode(page, '#about-identity-card-slot', code);
  await until(() => page.evaluate(() => MentriaIdentity.isUnlocked()), 20000, 'the card opens the identity');
  await sleep(1200);
  const st = await runtime(page);
  const ui = await rememberUi(page);
  assert(!st.hasDevice && !ui.pending && !ui.checked, 'Remember stays off after the card unlock', { hasDevice: st.hasDevice, ui });
  clean_(rig);
  clean_(rigs.get(tools));
});

check('turning the old Remember back on clears an off and keeps the pending Remember', async () => {
  await fresh(false);
  const page = await open('/about/', { auth: true });
  const rig = rigs.get(page);
  const { tools, code } = await seedSilentLink(page);
  assert((await rememberUi(page)).pending, 'seed: Remember is pending');
  await tools.close();
  await setSwitch(page, false);
  await page.reload({ waitUntil: 'load' });
  await openAdvanced(page);
  await until(() => page.evaluate(() => MentriaIdentity.isUnlocked()), 15000, 'the old device key opens the identity with the switch off');
  await waitVisible(page, '#about-identity-device', 15000);
  await page.click('#about-identity-device');
  await until(() => readJson(page, IDENTITY).then((v) => !v.device), 15000, 'the old device unlock turns off');
  await until(() => rememberUi(page).then((u) => u.decision === 'off'), 10000, 'the old toggle records off');
  await until(() => page.$eval('#about-identity-device', (el) => !el.disabled), 10000, 'the toggle settles');
  await page.click('#about-identity-device');
  await until(() => readJson(page, IDENTITY).then((v) => !!(v && v.device)), 15000, 'the old device unlock turns back on');
  await until(() => rememberUi(page).then((u) => u.decision === null), 10000, 'turning it back on clears the off');
  await until(() => deviceWrapKept(page), 10000, 'the new old-style device key is stored');
  const vault1 = await readJson(page, IDENTITY);
  await setSwitch(page, true);
  await page.reload({ waitUntil: 'load' });
  await openAdvanced(page);
  await until(() => page.evaluate(() => MentriaIdentity.isUnlocked()), 20000, 'the identity opens from the keyring again');
  await page.evaluate(async (u) => { const m = await import(u); await m.lock(); }, RUNTIME);
  await waitVisible(page, '#about-identity-card-slot .m-unlock', 15000);
  await cardCode(page, '#about-identity-card-slot', code);
  await until(() => page.evaluate(() => MentriaIdentity.isUnlocked()), 20000, 'the card opens the identity');
  await until(() => runtime(page).then((st) => st.hasDevice === true), 20000, 'Remember this device turns on after the card unlock');
  const ui = await rememberUi(page);
  assert(!ui.pending && ui.decision === 'on' && ui.checked, 'the pending Remember is carried out', ui);
  assert(JSON.stringify((await readJson(page, IDENTITY)).device) === JSON.stringify(vault1.device) && await deviceWrapKept(page), 'the old device key is kept until retirement');
  clean_(rig);
  clean_(rigs.get(tools));
});

check('Comms turns a pending Remember on at its next card unlock', async () => {
  await fresh(false);
  const page = await open('/comms/', { auth: true });
  const rig = rigs.get(page);
  await commsOnboard(page, 'Pending Pia');
  await waitVisible(page, '#comms-onboard-done', 40000);
  await page.click('#comms-onboard-continue');
  await waitVisible(page, '#comms-id-on');
  const fp = await fingerprint(page);
  await page.evaluate(() => MentriaIdentity.setDeviceUnlock(true));
  await until(() => deviceWrapKept(page), 10000, 'seed: device key stored');
  const secret = await identityBytes(page);
  await setSwitch(page, true);
  const tools = await open('/tools/');
  const code = await tools.evaluate(async (u, b) => {
    const m = await import(u);
    await m.ready();
    const made = await m.create({});
    if (!m.confirmCode(made.code.replace(/-/g, '').slice(-4))) throw new Error('code not confirmed');
    await m.link('identity', new Uint8Array(b));
    return made.code;
  }, RUNTIME, secret);
  await page.bringToFront();
  await page.goto(ORIGIN + '/comms/', { waitUntil: 'load' });
  await waitVisible(page, '#comms-id-on', 30000);
  await until(() => page.evaluate((k) => (JSON.parse(localStorage.getItem(k) || 'null') || {}).rememberPending === true, LOCAL), 10000, 'Comms marks Remember pending');
  assert(!(await runtime(page)).hasDevice, 'seed: the keyring does not remember this device yet');
  await tools.close();
  await lockAndWaitReload(page);
  await waitVisible(page, '#comms-id-card-slot .m-unlock', 20000);
  await cardCode(page, '#comms-id-card-slot', code);
  await waitVisible(page, '#comms-id-on', 30000);
  await until(() => runtime(page).then((st) => st.hasDevice === true), 20000, 'Remember this device turns on after the Comms card unlock');
  const l = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null') || {}, LOCAL);
  assert(!l.rememberPending && l.remember === 'on', 'the pending flag clears and on is recorded', l);
  assert(await fingerprint(page) === fp, 'the same Comms identity');
  clean_(rig);
  clean_(rigs.get(tools));
});

check('about keeps the old unlock under the card and links through the card', async () => {
  await fresh(false);
  const page = await open('/about/', { auth: true });
  const rig = rigs.get(page);
  await seedAboutPass(page, { passkey: true });
  await setSwitch(page, true);
  await page.reload({ waitUntil: 'load' });
  await openAdvanced(page);
  await waitVisible(page, '#about-identity-unlock');
  await page.type('#about-identity-unlock-pass', PASSPHRASE);
  await page.click('#about-identity-unlock-btn');
  const code = await setupNew(page, { passkey: false, keepPass: true });
  await waitVisible(page, '#about-identity-keyring', 30000);
  await page.evaluate(async (u) => { const m = await import(u); await m.lock(); }, RUNTIME);
  await waitVisible(page, '#about-identity-card-slot .m-unlock', 15000);
  const lockUi = await page.evaluate(() => ({
    old: !!document.getElementById('about-identity-old') && !!document.getElementById('about-identity-old').getClientRects().length,
    expanded: document.getElementById('about-identity-old') ? document.getElementById('about-identity-old').getAttribute('aria-expanded') : null,
    unlock: !!document.getElementById('about-identity-unlock').getClientRects().length
  }));
  assert(lockUi.old && lockUi.expanded === 'false' && !lockUi.unlock, 'the card shows with the old unlock folded under it', lockUi);
  assert(await text(page, '#about-identity-old') === EN.about.identity_old_unlock, 'the disclosure says what it is');
  await page.click('#about-identity-old');
  await waitVisible(page, '#about-identity-unlock-pass');
  assert(await page.$eval('#about-identity-old', (b) => b.getAttribute('aria-expanded')) === 'true', 'the disclosure is expanded');
  assert(await visible(page, '#about-identity-passkey-unlock'), 'the old passkey button is offered too');
  await shot(page, 'about-old-under-card', '.about-identity-card');
  await page.type('#about-identity-unlock-pass', PASSPHRASE);
  await page.click('#about-identity-unlock-btn');
  await until(() => page.evaluate(() => MentriaIdentity.isUnlocked()), 30000, 'the old passphrase opens the identity');
  await waitVisible(page, '#about-identity-card-slot .m-unlock', 15000);
  await waitVisible(page, '#about-identity-later');
  const mid = await page.evaluate(() => ({ keyring: !!document.getElementById('about-identity-keyring').getClientRects().length, old: !!document.getElementById('about-identity-old').getClientRects().length }));
  assert(!mid.keyring && !mid.old, 'the card now asks to bring the old unlock into the one unlock', mid);
  assert(!(await runtime(page)).unlocked, 'the one unlock is still locked');
  await cardCode(page, '#about-identity-card-slot', code);
  await waitVisible(page, '#about-identity-keyring', 20000);
  assert(JSON.stringify(await identityBytes(page)) === JSON.stringify(await keyringSecret(page)), 'the identity is the keyring\'s again');
  await page.click('#about-identity-lock-btn');
  await waitVisible(page, '#about-identity-card-slot .m-unlock', 15000);
  assert(!(await runtime(page)).unlocked, 'Lock locks the one unlock again');
  clean_(rig);
});

check('an old unlock under the card never takes over another identity\'s link', async () => {
  await fresh(false);
  const page = await open('/about/', { auth: true });
  const rig = rigs.get(page);
  const vault0 = await seedAboutPass(page);
  await setSwitch(page, true);
  const { tools, code } = await otherTabKeyring('random');
  const entry0 = (await readJson(page, KEYRING)).services.identity;
  await page.bringToFront();
  await page.reload({ waitUntil: 'load' });
  await openAdvanced(page);
  await waitVisible(page, '#about-identity-card-slot .m-unlock', 20000);
  await waitVisible(page, '#about-identity-old', 10000);
  await page.click('#about-identity-old');
  await waitVisible(page, '#about-identity-unlock-pass');
  await page.type('#about-identity-unlock-pass', PASSPHRASE);
  await page.click('#about-identity-unlock-btn');
  await until(() => page.evaluate(() => MentriaIdentity.isUnlocked()), 30000, 'the old passphrase opens this vault');
  await waitVisible(page, '#about-identity-card-slot .m-unlock', 15000);
  await cardCode(page, '#about-identity-card-slot', code);
  await until(() => runtime(page).then((s) => s.unlocked), 20000, 'the card unlocks the one unlock');
  await sleep(1200);
  const r = await page.evaluate(() => ({ unlocked: MentriaIdentity.isUnlocked(), keyring: !!document.getElementById('about-identity-keyring').getClientRects().length, card: !!document.querySelector('#about-identity-card-slot .m-unlock') }));
  assert(r.unlocked && !r.keyring && !r.card, 'the old-way session stays and is not shown as the keyring', r);
  assert(JSON.stringify((await readJson(page, KEYRING)).services.identity) === JSON.stringify(entry0), 'the other identity link is untouched');
  const vault = await readJson(page, IDENTITY);
  assert(vault.pass && vault.kcv === vault0.kcv, 'the old wrap is kept', Object.keys(vault));
  clean_(rig);
  clean_(rigs.get(tools));
});

check('comms keeps the old unlock under the card and links through the card', async () => {
  await fresh(false);
  const page = await open('/comms/', { auth: true });
  const rig = rigs.get(page);
  const { code, fp } = await seedCommsLegacy(page, 'Old Ola');
  await setSwitch(page, true);
  await page.goto(ORIGIN + '/comms/', { waitUntil: 'load' });
  await waitVisible(page, '#comms-id-locked');
  await page.click('#comms-lock-alt summary');
  await typeInto(page, '#comms-id-pass', code);
  await page.click('#comms-id-unlock');
  await setupKeep(page, { passkey: false });
  await waitVisible(page, '#comms-id-on', 20000);
  await lockAndWaitReload(page);
  await waitVisible(page, '#comms-id-card-slot .m-unlock', 20000);
  const lockUi = await page.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); return !!el && !!el.getClientRects().length; };
    const b = document.getElementById('comms-lock-old');
    return { old: vis('comms-lock-old'), expanded: b ? b.getAttribute('aria-expanded') : null, pk: vis('comms-id-passkey'), alt: vis('comms-lock-alt') };
  });
  assert(lockUi.old && lockUi.expanded === 'false' && !lockUi.pk && !lockUi.alt, 'the card shows with the old unlock folded under it', lockUi);
  assert(await text(page, '#comms-lock-old') === EN.tool.comms.lock.old_unlock, 'the disclosure says what it is');
  assert(await page.$eval('#comms-lock-old', (b) => b.getAttribute('aria-controls')) === 'comms-id-passkey comms-lock-alt', 'the disclosure names what it opens');
  await shot(page, 'comms-old-folded', '.comms');
  await page.click('#comms-lock-old');
  await waitVisible(page, '#comms-id-passkey');
  await waitVisible(page, '#comms-lock-alt');
  await shot(page, 'comms-old-open', '.comms');
  if (!(await visible(page, '#comms-id-pass'))) await page.click('#comms-lock-alt summary');
  await typeInto(page, '#comms-id-pass', code);
  await page.click('#comms-id-unlock');
  await waitVisible(page, '#comms-id-on', 30000);
  await waitVisible(page, '#comms-link-card .m-unlock', 15000);
  assert(!(await visible(page, '#comms-id-lock')), 'no Lock button before the identity is the keyring\'s');
  await cardCode(page, '#comms-link-card', code);
  await waitVisible(page, '#comms-id-lock', 20000);
  await waitHidden(page, '#comms-link');
  assert(await fingerprint(page) === fp, 'the same identity');
  clean_(rig);
});

check('a keyring record the one unlock cannot read never hides the old unlock', async () => {
  await fresh(false);
  const page = await open('/about/', { auth: true });
  const rig = rigs.get(page);
  await seedAboutPass(page);
  await setSwitch(page, true);
  await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({ v: 1, services: { identity: { id: 'x', ct: 'y', linked: new Date().toISOString() } } })), KEYRING);
  await page.reload({ waitUntil: 'load' });
  await openAdvanced(page);
  await waitVisible(page, '#about-identity-unlock', 15000);
  assert(!(await page.$('#about-identity-card-slot .m-unlock')), 'About shows no card for a record it cannot read');
  await page.type('#about-identity-unlock-pass', PASSPHRASE);
  await page.click('#about-identity-unlock-btn');
  await until(() => page.evaluate(() => MentriaIdentity.isUnlocked()), 20000, 'the old passphrase opens it');
  const comms = await open('/comms/', { auth: true });
  await waitVisible(comms, '#comms-id-locked', 20000);
  const c = await comms.evaluate(() => ({ card: !!document.querySelector('#comms-id-card-slot .m-unlock'), alt: !!document.getElementById('comms-lock-alt').getClientRects().length }));
  assert(!c.card && c.alt, 'Comms shows the old unlock for a record it cannot read', c);
  clean_(rig);
  clean_(rigs.get(comms));
});

check('a stalled one unlock falls back to the old unlock on About and Comms', async () => {
  await fresh(false);
  const page = await open('/about/', { auth: true });
  const rig = rigs.get(page);
  await seedAboutPass(page);
  await setSwitch(page, true);
  const held = await holdRuntime(page, null, true);
  const t0 = Date.now();
  await page.reload({ waitUntil: 'load' });
  await openAdvanced(page);
  await waitVisible(page, '#about-identity-unlock', 15000);
  const waited = Date.now() - t0;
  assert(held.length > 0 && waited >= 4000, 'About waited for the one unlock first', { held: held.length, waited });
  await page.type('#about-identity-unlock-pass', PASSPHRASE);
  await page.click('#about-identity-unlock-btn');
  await until(() => page.evaluate(() => MentriaIdentity.isUnlocked()), 20000, 'the old passphrase opens the identity');
  const comms = await open(null, { auth: true });
  const held2 = await holdRuntime(comms, null, true);
  const t1 = Date.now();
  await comms.goto(ORIGIN + '/comms/', { waitUntil: 'load' });
  await waitVisible(comms, '#comms-id-locked', 15000);
  const waited2 = Date.now() - t1;
  assert(held2.length > 0 && waited2 >= 4000, 'Comms waited for the one unlock first', { held: held2.length, waited: waited2 });
  assert(await visible(comms, '#comms-lock-alt'), 'Comms shows the old unlock');
  clean_(rig);
  clean_(rigs.get(comms));
});

check('a late one unlock replaces the old unlock with the card without a reload', async () => {
  await fresh(true);
  const page = await open('/about/', { auth: true });
  const code = await aboutCreate(page, { passkey: false });
  await page.evaluate(async (u) => { const m = await import(u); await m.lock(); }, RUNTIME);
  await waitVisible(page, '#about-identity-card-slot .m-unlock', 15000);
  await closeAll();
  const about = await open(null, { auth: true });
  await holdRuntime(about, 7500, false);
  await about.goto(ORIGIN + '/about/', { waitUntil: 'load' });
  await openAdvanced(about);
  await waitVisible(about, '#about-identity-unlock', 4000);
  assert(!(await about.$('#about-identity-card-slot .m-unlock')), 'the old unlock shows while the one unlock is still loading');
  await waitVisible(about, '#about-identity-card-slot .m-unlock', 15000);
  assert(!(await visible(about, '#about-identity-unlock')), 'the card replaces the old form without a reload');
  await cardCode(about, '#about-identity-card-slot', code);
  await until(() => about.evaluate(() => MentriaIdentity.isUnlocked()), 20000, 'the card opens the identity');
  await waitVisible(about, '#about-identity-keyring', 15000);
  clean_(rigs.get(about));
  await fresh(true);
  const comms = await open('/comms/', { auth: true });
  await commsOnboard(comms, 'Late Lee');
  const ccode = await setupNew(comms, { passkey: false });
  await waitVisible(comms, '#comms-id-on', 30000);
  const fp = await fingerprint(comms);
  await lockAndWaitReload(comms);
  await waitVisible(comms, '#comms-id-card-slot .m-unlock', 20000);
  await closeAll();
  const c2 = await open(null, { auth: true });
  await holdRuntime(c2, 7500, false);
  await c2.goto(ORIGIN + '/comms/', { waitUntil: 'load' });
  await waitVisible(c2, '#comms-id-locked', 7000);
  assert(!(await c2.$('#comms-id-card-slot .m-unlock')), 'Comms shows its old lock screen while the one unlock is still loading');
  await waitVisible(c2, '#comms-id-card-slot .m-unlock', 15000);
  await cardCode(c2, '#comms-id-card-slot', ccode);
  await waitVisible(c2, '#comms-id-on', 30000);
  assert(await fingerprint(c2) === fp, 'the same identity');
  await waitVisible(c2, '#comms-id-lock', 10000);
  clean_(rigs.get(c2));
});

check('about restore keeps working when the one unlock stalls', async () => {
  await fresh(true);
  const page = await open('/about/', { auth: true });
  const rig = rigs.get(page);
  const code = await aboutCreate(page, { passkey: false });
  await page.evaluate(() => window.MentriaStore.set('tools', 'fixb_check', { n: 7 }));
  const v5 = await page.evaluate(async (u) => {
    const m = await import(u);
    const B = window.MentriaBackup;
    const out = await B.sealBackup(await B.prepareBackup(), { keyring: await m.backupKey() });
    return out.blob.text();
  }, RUNTIME);
  const file = join(FILES, 'v5.json');
  writeFileSync(file, v5);
  await closeAll();
  const about = await open(null, { auth: true });
  await holdRuntime(about, null, false);
  await about.goto(ORIGIN + '/about/#backup', { waitUntil: 'load' });
  await about.waitForFunction(() => { const d = document.getElementById('about-advanced'); return !!d && d.open; });
  if (!(await visible(about, '#about-import-form'))) await about.click('[data-reveal="about-import-form"]');
  const input = await about.$('#about-data-import-file');
  await input.uploadFile(file);
  await until(() => visible(about, '#about-data-import-code'), 9000, 'the code field after the wait');
  await about.evaluate(() => window.MentriaStore.remove('tools', 'fixb_check'));
  await about.type('#about-data-import-code', code);
  const nav = about.waitForNavigation({ waitUntil: 'load', timeout: 60000 }).catch(() => {});
  await about.click('#about-data-import-btn');
  await until(async () => {
    if (await about.evaluate(() => { const d = document.getElementById('m-dialog'); return !!d && (d.matches(':popover-open') || d.hasAttribute('data-open')); })) { await sleep(300); await about.click('#m-dialog-ok'); }
    return about.evaluate(() => { const s = document.getElementById('about-data-import-status'); return s && s.dataset.tone === 'ok'; }).catch(() => false);
  }, 60000, 'the code restores while the one unlock is stalled');
  await nav;
  clean_(rigs.get(about));
  clean_(rig);
});

check('about export without a backup key and a damaged own file say so', async () => {
  await fresh(true);
  const page = await open('/about/#backup', { auth: true });
  const rig = rigs.get(page);
  await aboutCreate(page, { passkey: false });
  const v5 = await page.evaluate(async (u) => {
    const m = await import(u);
    const B = window.MentriaBackup;
    const out = await B.sealBackup(await B.prepareBackup(), { keyring: await m.backupKey() });
    return out.blob.text();
  }, RUNTIME);
  const lines = v5.split('\n');
  const i = lines.findIndex((l, n) => n > 0 && l.length > 40);
  assert(i > 0, 'seed: the file has a body line');
  const pos = Math.floor(lines[i].length / 2);
  const ch = lines[i][pos];
  lines[i] = lines[i].slice(0, pos) + (ch === 'A' ? 'B' : 'A') + lines[i].slice(pos + 1);
  const bad = join(FILES, 'v5-damaged.json');
  writeFileSync(bad, lines.join('\n'));
  if (!(await visible(page, '#about-import-form'))) await page.click('[data-reveal="about-import-form"]');
  await (await page.$('#about-data-import-file')).uploadFile(bad);
  await until(() => visible(page, '#about-data-import-key'), 10000, 'the session opens the file without a field');
  await page.click('#about-data-import-btn');
  await until(() => page.evaluate(() => document.getElementById('about-data-import-status').dataset.tone === 'err'), 30000, 'the restore fails');
  assert(await text(page, '#about-data-import-status') === EN.common.restore_err_damaged, 'a damaged file is not called a wrong passphrase', await text(page, '#about-data-import-status'));
  await page.evaluate(() => {
    const rec = window.MentriaStore.get('keyring', 'vault');
    delete rec.backup;
    window.MentriaStore.set('keyring', 'vault', rec);
  });
  if (!(await visible(page, '#about-export-form'))) await page.click('[data-reveal="about-export-form"]');
  await until(() => visible(page, '#about-data-code'), 10000, 'code mode on export');
  await page.click('#about-data-export-btn');
  await until(() => page.evaluate(() => document.getElementById('about-data-export-status').dataset.tone === 'err'), 20000, 'the export stops');
  assert(await text(page, '#about-data-export-status') === EN.common.backup_code_unavailable, 'the export says the code cannot protect it now', await text(page, '#about-data-export-status'));
  assert(await visible(page, '#about-data-pass'), 'the passphrase fields come back');
  clean_(rig);
});

check('about falls back to the passphrase setup after Not now', async () => {
  await fresh(true);
  const page = await open('/about/', { auth: true });
  const rig = rigs.get(page);
  await openAdvanced(page);
  await waitVisible(page, '#about-identity-create');
  await page.click('#about-identity-create');
  await waitStep(page, 'intro');
  await page.click('.m-ulayer [data-act="not-now"]');
  await sheetClosed(page, 10000);
  await waitVisible(page, '#about-identity-setup-pass', 10000);
  assert(await page.evaluate(() => document.activeElement && document.activeElement.id) === 'about-identity-setup-pass', 'the passphrase field takes focus');
  assert(!(await visible(page, '#about-identity-create')), 'Create is replaced by the passphrase setup');
  await page.type('#about-identity-setup-pass', PASSPHRASE);
  await page.type('#about-identity-setup-pass2', PASSPHRASE);
  await page.click('#about-identity-setup-btn');
  await answerDialog(page);
  await waitVisible(page, '#about-identity-unlocked');
  const vault = await readJson(page, IDENTITY);
  assert(vault && vault.pass && !vault.linked, 'an identity made the old way', vault && Object.keys(vault));
  assert(!(await readJson(page, KEYRING)), 'no keyring record');
  clean_(rig);
});

check('comms falls back to today\'s onboarding after Not now', async () => {
  await fresh(true);
  const page = await open('/comms/', { auth: true });
  const rig = rigs.get(page);
  await commsOnboard(page, 'Later Lou');
  await waitStep(page, 'intro');
  await page.click('.m-ulayer [data-act="not-now"]');
  await sheetClosed(page, 10000);
  await waitVisible(page, '#comms-onboard-done', 40000);
  const code = await text(page, '#comms-onboard-code');
  assert(CODE_SHAPE.test(code), 'the 20-symbol code is shown', code);
  const vault = await readJson(page, IDENTITY);
  assert(vault && vault.pass && !vault.linked, 'an identity made the old way', vault && Object.keys(vault));
  assert(!(await readJson(page, KEYRING)), 'no keyring record');
  const profile = await readJson(page, 'mentria.store.comms.profile');
  assert(profile && profile.name === 'Later Lou', 'profile name kept', profile);
  clean_(rig);
});

check('about offers keep the saved code only for a code', async () => {
  await fresh(false);
  const page = await open('/about/', { auth: true });
  const rig = rigs.get(page);
  const looksLikeCode = 'ABCDE FGHJK MNPQR STUVW';
  await seedAboutPass(page, { pass: looksLikeCode });
  await setSwitch(page, true);
  await page.reload({ waitUntil: 'load' });
  await openAdvanced(page);
  await waitVisible(page, '#about-identity-unlock');
  await page.type('#about-identity-unlock-pass', looksLikeCode);
  await page.click('#about-identity-unlock-btn');
  await waitStep(page, 'intro', 30000);
  await page.click('.m-ulayer [data-act="next"]');
  await waitStep(page, 'code');
  assert(!(await page.$('.m-ulayer input[name="code-choice"]')), 'a passphrase that looks like a code is not offered as the saved code');
  await page.keyboard.press('Escape');
  await sheetClosed(page, 10000);
  clean_(rig);
});

check('about\'s passkey unlock asks for the saved code', async () => {
  await fresh(false);
  const comms = await open('/comms/', { auth: true });
  const { code } = await seedCommsLegacy(comms, 'Code Cleo');
  await setSwitch(comms, true);
  const about = comms;
  await about.goto(ORIGIN + '/about/', { waitUntil: 'load' });
  await openAdvanced(about);
  await waitVisible(about, '#about-identity-passkey-unlock');
  await about.click('#about-identity-passkey-unlock');
  await waitStep(about, 'intro', 30000);
  await about.click('.m-ulayer [data-act="next"]');
  await waitStep(about, 'code');
  const keep = await about.evaluate(() => {
    const r = document.querySelector('.m-ulayer input[name="code-choice"][value="keep"]');
    const f = document.querySelector('.m-ulayer input[name="saved-code"]');
    return { keep: !!r && r.checked, field: !!f && f.getBoundingClientRect().height > 0 };
  });
  assert(keep.keep && keep.field, 'About\'s passkey unlock asks for the saved code', keep);
  await about.type('.m-ulayer input[name="saved-code"]', code);
  await about.click('.m-ulayer [data-act="next"]');
  await finishMethod(about, { passkey: false });
  await until(() => readJson(about, KEYRING).then((r) => !!(r && r.services.identity)), 15000, 'identity linked');
  const ok = await about.evaluate(async (u, c) => { const m = await import(u); await m.lock(); await m.unlockWithCode(c); return m.state().unlocked; }, RUNTIME, code);
  assert(ok, 'the saved Comms code is now the recovery code');
  clean_(rigs.get(comms));
});

check('a link that fails says so on About and Comms', async () => {
  await fresh(false);
  const page = await open('/about/', { auth: true });
  const rig = rigs.get(page);
  await seedAboutPass(page);
  await setSwitch(page, true);
  const { tools } = await otherTabKeyring('open');
  await page.bringToFront();
  await page.reload({ waitUntil: 'load' });
  await openAdvanced(page);
  await waitVisible(page, '#about-identity-unlock');
  await page.evaluate(() => {
    const S = window.MentriaStore;
    const orig = S.set.bind(S);
    S.set = (ns, k, v, o) => (ns === 'keyring' ? false : orig(ns, k, v, o));
  });
  await page.type('#about-identity-unlock-pass', PASSPHRASE);
  await page.click('#about-identity-unlock-btn');
  await until(() => toastHas(page, EN.unlock.err_storage), 20000, 'About says the link failed');
  assert(!(await readJson(page, KEYRING)).services.identity, 'nothing was linked');
  assert(await page.evaluate(() => MentriaIdentity.isUnlocked()), 'the identity still opened the old way');
  await fresh(false);
  const comms = await open('/comms/', { auth: true });
  const { code } = await seedCommsLegacy(comms, 'Fail Fay');
  await setSwitch(comms, true);
  const t2 = await otherTabKeyring('open');
  await comms.bringToFront();
  await comms.goto(ORIGIN + '/comms/', { waitUntil: 'load' });
  await waitVisible(comms, '#comms-id-locked');
  await comms.evaluate(() => {
    const S = window.MentriaStore;
    const orig = S.set.bind(S);
    S.set = (ns, k, v, o) => (ns === 'keyring' ? false : orig(ns, k, v, o));
  });
  await comms.click('#comms-lock-alt summary');
  await typeInto(comms, '#comms-id-pass', code);
  await comms.click('#comms-id-unlock');
  await waitVisible(comms, '#comms-id-on', 20000);
  await until(() => toastHas(comms, EN.unlock.err_storage), 20000, 'Comms says the link failed');
  assert(!(await readJson(comms, KEYRING)).services.identity, 'nothing was linked in Comms');
  clean_(rig);
  clean_(rigs.get(tools));
  clean_(rigs.get(comms));
  clean_(rigs.get(t2.tools));
});

check('the old device-local Remember setting moves into the one unlock', async () => {
  await fresh(true);
  const page = await open('/about/', { auth: true });
  const rig = rigs.get(page);
  await aboutCreate(page, { passkey: false });
  await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({ remember: 'off', rememberPending: true })), LOCAL_IDENTITY);
  await page.reload({ waitUntil: 'load' });
  await openAdvanced(page);
  await until(() => page.evaluate(() => MentriaIdentity.isUnlocked()), 15000, 'the identity opens');
  await sleep(500);
  const r = await page.evaluate((a, b) => ({ old: localStorage.getItem(a), ring: JSON.parse(localStorage.getItem(b) || '{}') }), LOCAL_IDENTITY, LOCAL);
  assert(r.old === null && r.ring.remember === 'off' && !r.ring.rememberPending, 'the decision moved and the old key is gone; off drops the pending flag', r);
  const r2 = await page.evaluate(async (u) => { const m = await import(u); return { d: m.rememberDecision(), p: m.rememberPending() }; }, RUNTIME);
  assert(r2.d === 'off' && r2.p === false, 'the runtime reports the moved decision', r2);
  clean_(rig);
});

check('about offers to bring in another one unlock', async () => {
  await fresh(true);
  const page = await open('/about/', { auth: true });
  const rig = rigs.get(page);
  const code = await aboutCreate(page, { passkey: false });
  const otherCode = await page.evaluate(async () => {
    const c = await import('/assets/js/mentria-unlock-core.js');
    const made = c.newRecoveryCode();
    const { record, rootBytes } = await c.createRecord({ code: made, deviceId: 'dev-other', deviceName: 'Other', app: 'beta' });
    const root = await c.rootKeyFrom(rootBytes);
    record.services.notes = await c.sealService(root, 'notes', crypto.getRandomValues(new Uint8Array(32)), Date.now());
    localStorage.setItem('mentria.keyring.others', JSON.stringify([record]));
    return made;
  });
  await page.reload({ waitUntil: 'load' });
  await openAdvanced(page);
  await waitVisible(page, '#about-identity-foldin', 15000);
  assert(await text(page, '#about-identity-foldin-later') === EN.about.identity_foldin_later, 'a Not now sits beside the line');
  assert(await text(page, '#about-identity-foldin') === EN.unlock.foldin_line, 'the fold-in line text');
  await shot(page, 'about-foldin-line', '.about-identity-card');
  await page.evaluate(async (u) => { const m = await import(u); await m.lock(); }, RUNTIME);
  await waitVisible(page, '#about-identity-card-slot .m-unlock', 15000);
  assert(!(await visible(page, '#about-identity-foldin')), 'no fold-in line while locked');
  await cardCode(page, '#about-identity-card-slot', code);
  await waitVisible(page, '#about-identity-foldin', 15000);
  await page.click('#about-identity-foldin-later');
  await waitHidden(page, '#about-identity-foldin', 5000);
  const kept = await page.evaluate(() => ({ others: JSON.parse(localStorage.getItem('mentria.keyring.others') || '[]').length, layer: !!document.querySelector('.m-ulayer') }));
  assert(kept.others === 1 && !kept.layer, 'Not now hides the line and deletes nothing', kept);
  await page.reload({ waitUntil: 'load' });
  await openAdvanced(page);
  await until(() => page.evaluate(() => MentriaIdentity.isUnlocked()), 15000, 'the identity reopens in the same tab');
  await sleep(600);
  assert(!(await visible(page, '#about-identity-foldin')), 'Not now holds for this tab');
  const tab2 = await open('/about/');
  await openAdvanced(tab2);
  await waitVisible(tab2, '#about-identity-foldin', 15000);
  await tab2.click('#about-identity-foldin');
  await waitVisible(tab2, '.m-ulayer input[name="fold-code"]', 15000);
  await typeInto(tab2, '.m-ulayer input[name="fold-code"]', otherCode);
  await tab2.keyboard.press('Enter');
  await sheetClosed(tab2, 30000);
  await waitHidden(tab2, '#about-identity-foldin', 10000);
  const left = await tab2.evaluate(() => JSON.parse(localStorage.getItem('mentria.keyring.others') || '[]').length);
  assert(left === 0, 'the other one unlock is no longer listed', left);
  clean_(rig);
  clean_(rigs.get(tab2));
});

check('about shows the undo as done only after it finishes', async () => {
  await fresh(false);
  const seed = await open('/robots.txt');
  await seed.evaluate(() => localStorage.setItem('mentria-sync-rescue', JSON.stringify({ v: 2, at: Date.now(), entries: { 'tools.fixb_undo': { raw: JSON.stringify({ u: 1 }), meta: null } } })));
  await seed.close();
  const page = await open('/about/');
  const rig = rigs.get(page);
  await waitVisible(page, '#about-rescue-btn', 20000);
  await page.evaluate(() => {
    const S = window.MentriaSync;
    const real = S.restoreRescue;
    window.__undo = { started: 0, finish: null };
    S.restoreRescue = () => {
      window.__undo.started++;
      return new Promise((ok, no) => { window.__undo.finish = () => Promise.resolve(real()).then(ok, no); });
    };
  });
  await page.click('#about-rescue-btn');
  await answerDialog(page);
  await until(() => page.evaluate(() => window.__undo.started === 1), 5000, 'the undo starts');
  await sleep(500);
  const mid = await page.evaluate(() => ({ status: document.getElementById('about-rescue-status').textContent.trim(), btn: !document.getElementById('about-rescue-btn').hidden }));
  assert(!mid.status && mid.btn, 'the undo is not shown as done while it runs', mid);
  await page.evaluate(() => window.__undo.finish());
  await until(() => page.evaluate(() => !!document.getElementById('about-rescue-status').textContent.trim()), 5000, 'the done line after the undo finishes');
  const done = await page.evaluate(() => ({ status: document.getElementById('about-rescue-status').textContent.trim(), btn: !document.getElementById('about-rescue-btn').hidden, value: localStorage.getItem('mentria.store.tools.fixb_undo') }));
  assert(!done.btn && done.status.startsWith(EN.about.sync_rescue_done.split('{')[0].trim().slice(0, 12)) && JSON.parse(done.value).u === 1, 'the done line comes after the undo restored the data', done);
  clean_(rig);
});

check('during the wait a keyring that names the identity is waited for, not set up again', async () => {
  await fresh(true);
  const page = await open('/about/', { auth: true });
  const code = await aboutCreate(page, { passkey: false });
  const ring0 = await keyringSecret(page);
  await page.evaluate(() => window.MentriaStore.remove('identity', 'vault'));
  await page.evaluate(async (u) => { const m = await import(u); await m.lock(); }, RUNTIME);
  await closeAll();
  const about = await open(null, { auth: true });
  await holdRuntime(about, 7500, false);
  await about.goto(ORIGIN + '/about/', { waitUntil: 'load' });
  await about.evaluate(() => { document.getElementById('about-advanced').open = true; });
  await sleep(6200);
  const mid = await about.evaluate(() => ({ setup: document.getElementById('about-identity-setup').hidden, unlock: document.getElementById('about-identity-unlock').hidden, vault: localStorage.getItem('mentria.store.identity.vault') }));
  assert(mid.setup && mid.unlock && mid.vault === null, 'About offers no setup of its own while the one unlock is loading', mid);
  await waitVisible(about, '#about-identity-create', 15000);
  await about.click('#about-identity-create');
  await waitVisible(about, '#about-identity-card-slot .m-unlock', 15000);
  await cardCode(about, '#about-identity-card-slot', code);
  await until(() => about.evaluate(() => MentriaIdentity.isUnlocked()), 20000, 'the identity comes back from the keyring');
  assert(JSON.stringify(await identityBytes(about)) === JSON.stringify(ring0), 'the same identity');
  clean_(rigs.get(about));
  await fresh(true);
  const comms = await open('/comms/', { auth: true });
  await commsOnboard(comms, 'Wait Wes');
  const ccode = await setupNew(comms, { passkey: false });
  await waitVisible(comms, '#comms-id-on', 30000);
  const fp = await fingerprint(comms);
  await comms.evaluate(() => window.MentriaStore.remove('identity', 'vault'));
  await lockAndWaitReload(comms);
  await closeAll();
  const c2 = await open(null, { auth: true });
  await holdRuntime(c2, 7500, false);
  await c2.goto(ORIGIN + '/comms/', { waitUntil: 'load' });
  await commsOnboard(c2, 'Wait Wes');
  await sleep(6500);
  const cm = await c2.evaluate(() => ({ done: !!document.getElementById('comms-onboard-done').getClientRects().length, vault: localStorage.getItem('mentria.store.identity.vault'), code: document.getElementById('comms-onboard-code').textContent }));
  assert(!cm.done && cm.vault === null && !cm.code, 'Comms makes no identity of its own while the one unlock is loading', cm);
  await waitVisible(c2, '#comms-onboard-card .m-unlock', 15000);
  await cardCode(c2, '#comms-onboard-card', ccode);
  await waitVisible(c2, '#comms-id-on', 30000);
  assert(await fingerprint(c2) === fp, 'Comms brings back the same identity from the keyring');
  clean_(rigs.get(c2));
});

check('the wait for a keyring that names the identity gives up after 10 s, then carries on', async () => {
  await fresh(true);
  const page = await open('/about/', { auth: true });
  const code = await aboutCreate(page, { passkey: false });
  const ring0 = await keyringSecret(page);
  await page.evaluate(() => window.MentriaStore.remove('identity', 'vault'));
  await page.evaluate(async (u) => { const m = await import(u); await m.lock(); }, RUNTIME);
  await closeAll();
  const about = await open(null, { auth: true });
  await holdRuntime(about, 14000, false);
  const t0 = Date.now();
  await about.goto(ORIGIN + '/about/', { waitUntil: 'load' });
  await about.evaluate(() => { document.getElementById('about-advanced').open = true; });
  await until(() => about.evaluate((t) => document.getElementById('about-identity-lede').textContent.trim() === t && !!document.getElementById('about-identity-lede').getClientRects().length, EN.unlock.load_failed), 13000, 'About says the one unlock did not load');
  const waited = Date.now() - t0;
  const mid = await about.evaluate(() => ({ setup: document.getElementById('about-identity-setup').hidden, unlock: document.getElementById('about-identity-unlock').hidden, vault: localStorage.getItem('mentria.store.identity.vault') }));
  assert(waited >= 9000 && mid.setup && mid.unlock && mid.vault === null, 'About gives up after the wait and offers no setup of its own', { waited, mid });
  await waitVisible(about, '#about-identity-create', 15000);
  assert(await about.evaluate((t) => document.getElementById('about-identity-lede').textContent.trim() !== t, EN.unlock.load_failed), 'the line goes once the one unlock arrives');
  await about.click('#about-identity-create');
  await waitVisible(about, '#about-identity-card-slot .m-unlock', 15000);
  await cardCode(about, '#about-identity-card-slot', code);
  await until(() => about.evaluate(() => MentriaIdentity.isUnlocked()), 20000, 'the identity comes back from the keyring');
  assert(JSON.stringify(await identityBytes(about)) === JSON.stringify(ring0), 'the same identity');
  clean_(rigs.get(about));
  await fresh(true);
  const comms = await open('/comms/', { auth: true });
  await commsOnboard(comms, 'Give Up Gus');
  const ccode = await setupNew(comms, { passkey: false });
  await waitVisible(comms, '#comms-id-on', 30000);
  const fp = await fingerprint(comms);
  await comms.evaluate(() => window.MentriaStore.remove('identity', 'vault'));
  await lockAndWaitReload(comms);
  await closeAll();
  const c2 = await open(null, { auth: true });
  await holdRuntime(c2, 14000, false);
  const t1 = Date.now();
  await c2.goto(ORIGIN + '/comms/', { waitUntil: 'load' });
  await commsOnboard(c2, 'Give Up Gus');
  await until(() => c2.evaluate((t) => { const e = document.getElementById('comms-onboard-err'); return !e.hidden && e.textContent.trim() === t; }, EN.unlock.load_failed), 13000, 'Comms says the one unlock did not load');
  const cwait = Date.now() - t1;
  const cm = await c2.evaluate(() => ({ done: !!document.getElementById('comms-onboard-done').getClientRects().length, vault: localStorage.getItem('mentria.store.identity.vault'), busy: document.getElementById('comms-onboard-create').disabled }));
  assert(cwait >= 9000 && !cm.done && cm.vault === null && !cm.busy, 'Comms gives up after the wait and makes no identity of its own', { cwait, cm });
  await until(() => c2.evaluate(() => document.getElementById('comms-onboard-err').hidden), 10000, 'the line goes once the one unlock arrives');
  await c2.click('#comms-onboard-create');
  await waitVisible(c2, '#comms-onboard-card .m-unlock', 15000);
  await cardCode(c2, '#comms-onboard-card', ccode);
  await waitVisible(c2, '#comms-id-on', 30000);
  assert(await fingerprint(c2) === fp, 'Comms brings back the same identity from the keyring');
  clean_(rigs.get(c2));
});

check('a broken keyring link is tried again after the next lock', async () => {
  await fresh(false);
  const page = await open('/about/', { auth: true });
  const rig = rigs.get(page);
  await seedAboutPass(page);
  await setSwitch(page, true);
  await page.reload({ waitUntil: 'load' });
  await openAdvanced(page);
  await waitVisible(page, '#about-identity-unlock');
  await page.type('#about-identity-unlock-pass', PASSPHRASE);
  await page.click('#about-identity-unlock-btn');
  const code = await setupNew(page, { passkey: false });
  await waitVisible(page, '#about-identity-keyring', 30000);
  const mine = await identityBytes(page);
  await page.evaluate(async (u, k) => {
    const m = await import(u);
    await m.link('identity', crypto.getRandomValues(new Uint8Array(32)));
    const r = JSON.parse(localStorage.getItem(k));
    delete r.services.identity.prior;
    localStorage.setItem(k, JSON.stringify(r));
  }, RUNTIME, KEYRING);
  await page.reload({ waitUntil: 'load' });
  await openAdvanced(page);
  await waitVisible(page, '#about-identity-unlock', 15000);
  await sleep(500);
  assert(!(await page.evaluate(() => MentriaIdentity.isUnlocked())), 'seed: the link does not open this vault, so the old unlock shows');
  const tools = await open('/tools/');
  await tools.evaluate(async (u, b) => {
    const m = await import(u);
    await m.ready();
    await m.link('identity', new Uint8Array(b));
    await m.lock();
  }, RUNTIME, mine);
  await waitVisible(page, '#about-identity-card-slot .m-unlock', 15000);
  await tools.evaluate(async (u, c) => { const m = await import(u); await m.unlockWithCode(c); }, RUNTIME, code);
  await waitVisible(page, '#about-identity-keyring', 20000);
  assert(JSON.stringify(await identityBytes(page)) === JSON.stringify(mine), 'About opens the identity from the keyring again');
  clean_(rig);
  clean_(rigs.get(tools));
  await fresh(false);
  const comms = await open('/comms/', { auth: true });
  const { code: ccode, fp } = await seedCommsLegacy(comms, 'Broken Bo');
  await setSwitch(comms, true);
  await comms.goto(ORIGIN + '/comms/', { waitUntil: 'load' });
  await waitVisible(comms, '#comms-id-locked');
  await comms.click('#comms-lock-alt summary');
  await typeInto(comms, '#comms-id-pass', ccode);
  await comms.click('#comms-id-unlock');
  await setupKeep(comms, { passkey: false });
  await waitVisible(comms, '#comms-id-on', 20000);
  const cmine = await identityBytes(comms);
  await comms.evaluate(async (u, k) => {
    const m = await import(u);
    await m.link('identity', crypto.getRandomValues(new Uint8Array(32)));
    const r = JSON.parse(localStorage.getItem(k));
    delete r.services.identity.prior;
    localStorage.setItem(k, JSON.stringify(r));
  }, RUNTIME, KEYRING);
  await comms.goto(ORIGIN + '/comms/', { waitUntil: 'load' });
  await waitVisible(comms, '#comms-id-locked', 15000);
  await sleep(800);
  const b0 = await comms.evaluate(() => ({ card: !!document.querySelector('#comms-id-card-slot .m-unlock'), alt: !!document.getElementById('comms-lock-alt').getClientRects().length }));
  assert(!b0.card && b0.alt, 'seed: Comms shows the old unlock for a link that does not open it', b0);
  const t2 = await open('/tools/');
  await t2.evaluate(async (u, b) => {
    const m = await import(u);
    await m.ready();
    await m.link('identity', new Uint8Array(b));
    await m.lock();
  }, RUNTIME, cmine);
  await waitVisible(comms, '#comms-id-card-slot .m-unlock', 15000);
  await t2.evaluate(async (u, c) => { const m = await import(u); await m.unlockWithCode(c); }, RUNTIME, ccode);
  await waitVisible(comms, '#comms-id-on', 30000);
  assert(await fingerprint(comms) === fp, 'Comms opens the same identity from the keyring');
  await waitVisible(comms, '#comms-id-lock', 10000);
  clean_(rigs.get(comms));
  clean_(rigs.get(t2));
});

check('a late one unlock keeps a half-typed old passphrase on About and Comms', async () => {
  await fresh(false);
  const page = await open('/about/', { auth: true });
  await seedAboutPass(page);
  await setSwitch(page, true);
  await page.reload({ waitUntil: 'load' });
  await openAdvanced(page);
  await waitVisible(page, '#about-identity-unlock');
  await page.type('#about-identity-unlock-pass', PASSPHRASE);
  await page.click('#about-identity-unlock-btn');
  await setupNew(page, { passkey: false, keepPass: true });
  await waitVisible(page, '#about-identity-keyring', 30000);
  await page.evaluate(async (u) => { const m = await import(u); await m.lock(); }, RUNTIME);
  await waitVisible(page, '#about-identity-card-slot .m-unlock', 15000);
  await closeAll();
  const about = await open(null, { auth: true });
  await holdRuntime(about, 7500, false);
  await about.goto(ORIGIN + '/about/', { waitUntil: 'load' });
  await openAdvanced(about);
  await waitVisible(about, '#about-identity-unlock-pass', 4000);
  await about.type('#about-identity-unlock-pass', 'half');
  await waitVisible(about, '#about-identity-card-slot .m-unlock', 15000);
  const a = await about.evaluate(() => ({ shown: !!document.getElementById('about-identity-unlock').getClientRects().length, value: document.getElementById('about-identity-unlock-pass').value, expanded: document.getElementById('about-identity-old').getAttribute('aria-expanded') }));
  assert(a.shown && a.value === 'half' && a.expanded === 'true', 'the old unlock stays open with what was typed', a);
  clean_(rigs.get(about));
  await fresh(false);
  const comms = await open('/comms/', { auth: true });
  const { code } = await seedCommsLegacy(comms, 'Late Lu');
  await setSwitch(comms, true);
  await comms.goto(ORIGIN + '/comms/', { waitUntil: 'load' });
  await waitVisible(comms, '#comms-id-locked');
  await comms.click('#comms-lock-alt summary');
  await typeInto(comms, '#comms-id-pass', code);
  await comms.click('#comms-id-unlock');
  await setupKeep(comms, { passkey: false });
  await waitVisible(comms, '#comms-id-on', 20000);
  await lockAndWaitReload(comms);
  await waitVisible(comms, '#comms-id-card-slot .m-unlock', 20000);
  await closeAll();
  const c2 = await open(null, { auth: true });
  await holdRuntime(c2, 7500, false);
  await c2.goto(ORIGIN + '/comms/', { waitUntil: 'load' });
  await waitVisible(c2, '#comms-id-locked', 7000);
  if (!(await visible(c2, '#comms-id-pass'))) await c2.click('#comms-lock-alt summary');
  await c2.type('#comms-id-pass', 'half');
  await waitVisible(c2, '#comms-id-card-slot .m-unlock', 15000);
  const c = await c2.evaluate(() => ({ shown: !!document.getElementById('comms-id-pass').getClientRects().length, value: document.getElementById('comms-id-pass').value, expanded: document.getElementById('comms-lock-old').getAttribute('aria-expanded') }));
  assert(c.shown && c.value === 'half' && c.expanded === 'true', 'Comms keeps the old unlock open with what was typed', c);
  clean_(rigs.get(c2));
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
    await about.evaluate(async () => {
      const c = await import('/assets/js/mentria-unlock-core.js');
      const { record } = await c.createRecord({ code: c.newRecoveryCode(), deviceId: 'dev-p', deviceName: 'Prod', app: '' });
      window.MentriaStore.set('keyring', 'vault', record);
    });
    const lsAll = (p) => p.evaluate(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } return o; });
    const VOL = /^(mentria_seen|mentria_tool_usage|mentria_caps)/;
    const before = await lsAll(about);
    await page.goto(ORIGIN + '/comms/', { waitUntil: 'load' });
    await waitVisible(page, '#comms-id-locked', 20000);
    await about.goto(ORIGIN + '/about/', { waitUntil: 'load' });
    await openAdvanced(about);
    const totp = await open('/tools/totp/');
    await sleep(1500);
    const after = await lsAll(about);
    const added = Object.keys(after).filter((k) => !(k in before) && !VOL.test(k));
    const changed = Object.keys(before).filter((k) => /keyring|identity/.test(k) && before[k] !== after[k]);
    assert(!added.length && !changed.length, 'About, Comms and TOTP write nothing new on a production build', { added, changed });
    for (const p of [page, about, totp]) assert(!(await loaded(p, RUNTIME)) && !(await loaded(p, UI)), 'still no runtime or card request');
    clean_(rig);
    clean_(rigs.get(totp));
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
  rmSync(FILES, { recursive: true, force: true });
}
console.log(passed + '/' + (passed + failed) + ' passed');
process.exit(failed ? 1 : 0);
