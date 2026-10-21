import { rmSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { serve } from './unlock-serve.mjs';

const BUILD = process.argv[2];
if (!BUILD) { console.log('usage: node scripts/unlock-finance-check.mjs <beta build dir>'); process.exit(2); }
const PORT = 8090;
const ORIGIN = 'http://localhost:' + PORT;
const PROFILE = join(tmpdir(), 'unlock-finance-check-profile');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EN = JSON.parse(readFileSync(join(REPO, 'src/_data/i18n/en.json'), 'utf8'));
const FIN = EN.tool.finance;
const UK = EN.unlock;
const AUTH = { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true };
const PASS = 'finance pass 12345';
const STORE = '/extensions/finance/';
const RECORD = 'mentria.store.keyring.vault';

const PROBE = () => {
  window.__sawLock = false;
  window.__signals = [];
  const seen = (n) => n && n.nodeType === 1 && (n.classList.contains('flock') || !!n.querySelector('.flock'));
  const watch = () => new MutationObserver((list) => {
    for (const m of list) for (const n of m.addedNodes) if (seen(n)) window.__sawLock = true;
  }).observe(document, { childList: true, subtree: true });
  watch();
  try {
    if (window.PublicKeyCredential) window.PublicKeyCredential.signalUnknownCredential = async (o) => { window.__signals.push(o); };
  } catch (_) {}
  let hold = false;
  try { hold = /\/extensions\/finance\/app\//.test(location.pathname) && localStorage.getItem('test.holdPages') === '1'; } catch (_) {}
  if (!hold) return;
  window.__holding = 'waiting';
  const req = indexedDB.open('mentria-ext-finance');
  req.onsuccess = () => {
    const db = req.result;
    const tx = db.transaction('pages', 'readwrite');
    const store = tx.objectStore('pages');
    window.__holding = 'held';
    const spin = () => {
      if (localStorage.getItem('test.holdPages') !== '1') { window.__holding = 'released'; return; }
      store.count().onsuccess = spin;
    };
    spin();
    tx.oncomplete = () => db.close();
  };
};

const server = serve(PORT);
await server.ready;
server.setRoot(BUILD);
rmSync(PROFILE, { recursive: true, force: true });
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  userDataDir: PROFILE,
  protocolTimeout: 300000,
  args: ['--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE localhost', '--no-first-run', '--no-default-browser-check']
});

const checks = [];
const check = (name, fn) => checks.push([name, fn]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function assert(cond, msg, extra) {
  if (!cond) throw new Error(msg + (extra === undefined ? '' : ' ' + JSON.stringify(extra)));
}

let stage = '';
function at(s) {
  stage = s;
  if (process.env.DEBUG) console.log('  .. ' + s);
}

async function shown(scope, sel, timeout) {
  at('shown ' + sel);
  const h = await scope.waitForFunction((q) => {
    const el = document.querySelector(q);
    return el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' ? el : null;
  }, { timeout: timeout || 20000, polling: 150 }, sel);
  return h.asElement();
}

async function present(scope, sel, timeout) {
  at('present ' + sel);
  await scope.waitForFunction((q) => !!document.querySelector(q), { timeout: timeout || 20000, polling: 150 }, sel);
}

async function until(fn, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if (await fn()) return true; } catch (_) {}
    await sleep(150);
  }
  try { return !!(await fn()); } catch (_) { return false; }
}

async function rig(opts) {
  const o = opts || {};
  const context = await browser.createBrowserContext();
  const r = { context, pages: [], errors: [], dialogs: [] };
  r.page = await newPage(r, o.authenticator !== false);
  if (o.switchOn) await setSwitch(r.page, true);
  return r;
}

async function newPage(r, withAuth) {
  const page = await r.context.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  page.on('pageerror', (e) => r.errors.push(String((e && e.message) || e).slice(0, 300)));
  page.on('dialog', async (d) => { r.dialogs.push(d.type() + ': ' + d.message()); try { await d.dismiss(); } catch (_) {} });
  await page.evaluateOnNewDocument(PROBE);
  if (withAuth !== false) {
    const cdp = await page.createCDPSession();
    await cdp.send('WebAuthn.enable', { enableUI: false });
    const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: AUTH });
    page.__cdp = cdp;
    page.__auth = authenticatorId;
  }
  r.pages.push(page);
  return page;
}

async function done(r) {
  try { await r.context.close(); } catch (_) {}
}

async function setSwitch(page, on) {
  if (!page.url().startsWith(ORIGIN)) await page.goto(ORIGIN + '/robots.txt', { waitUntil: 'load' });
  await page.evaluate((v) => {
    let l = {};
    try { l = JSON.parse(localStorage.getItem('mentria.keyring.local') || '{}') || {}; } catch (_) {}
    l.enabled = v;
    localStorage.setItem('mentria.keyring.local', JSON.stringify(l));
  }, on);
}

async function store(page) {
  at('store');
  await page.goto(ORIGIN + STORE, { waitUntil: 'load' });
  return frameOf(page);
}

async function frameOf(page) {
  at('frame');
  await page.bringToFront();
  await page.waitForFunction(() => {
    const f = document.getElementById('xr-frame');
    try { return !!(f && f.contentWindow && f.contentWindow.FIN_COPY && f.contentDocument.querySelector('.flock, #fin-main')); } catch (_) { return false; }
  }, { timeout: 60000, polling: 150 });
  const handle = await page.$('#xr-frame');
  await handle.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  const frame = await handle.contentFrame();
  frame.__page = page;
  return frame;
}

async function buttonByText(scope, within, text, timeout) {
  const h = await scope.waitForFunction((w, t) => {
    const norm = (s) => s.replace(/\s+/g, ' ').trim();
    for (const b of document.querySelectorAll(w + ' button')) {
      if (b.disabled || !b.getClientRects().length) continue;
      if (norm(b.textContent) === norm(t)) return b;
    }
    return null;
  }, { timeout: timeout || 20000, polling: 100 }, within, text);
  return h.asElement();
}

async function pressText(scope, within, text, timeout) {
  at('press ' + text);
  for (let i = 0; i < 30; i++) {
    const el = await buttonByText(scope, within, text, timeout);
    try { await el.click(); return; } catch (e) {
      if (!/not clickable|not an Element|detached|bounding box/i.test(String(e && e.message)) || i === 29) throw e;
      await sleep(150);
    }
  }
}

async function press(scope, sel, timeout) {
  at('press ' + sel);
  for (let i = 0; i < 30; i++) {
    const el = await shown(scope, sel, timeout);
    try { await el.click(); return; } catch (e) {
      if (!/not clickable|not an Element|detached|bounding box/i.test(String(e && e.message)) || i === 29) throw e;
      await sleep(150);
    }
  }
}

async function typeIn(scope, sel, text) {
  at('type ' + sel);
  const el = await shown(scope, sel, 20000);
  await el.evaluate((n) => { n.value = ''; n.dispatchEvent(new Event('input', { bubbles: true })); });
  await el.type(text);
  return el;
}

async function opened(frame, timeout) {
  at('opened');
  await present(frame, '#fin-main', timeout || 60000);
  await frame.waitForFunction(() => !document.querySelector('.flock'), { timeout: 20000 });
}

async function legacySetup(frame, { passkey, device }) {
  await pressText(frame, '.flock', FIN.setup.start);
  await shown(frame, '.flock input[type="password"]');
  await sleep(300);
  for (const el of await frame.$$('.flock input[type="password"]')) {
    await el.evaluate((n) => { n.value = ''; n.dispatchEvent(new Event('input', { bubbles: true })); });
    await el.type(PASS);
  }
  const typed = await frame.$$eval('.flock input[type="password"]', (l) => l.map((n) => n.value));
  assert(typed.length === 2 && typed.every((v) => v === PASS), 'the passphrase is typed twice', typed.length);
  await pressText(frame, '.flock', FIN.common.next);
  await shown(frame, '.flock__code span');
  const code = (await frame.$$eval('.flock__code span', (s) => s.map((x) => x.textContent.trim()))).join('-');
  await (await shown(frame, '.flock input[maxlength="9"]')).type(code.split('-').pop());
  await pressText(frame, '.flock', FIN.common.next);
  await buttonByText(frame, '.flock', FIN.setup.finish);
  const boxes = await frame.$$('.flock .fcheck input[type="checkbox"]');
  assert(boxes.length === 2, 'today\'s setup offers a passkey and device unlock', boxes.length);
  const want = [passkey, device];
  for (let i = 0; i < 2; i++) if ((await boxes[i].evaluate((b) => b.checked)) !== want[i]) await boxes[i].click();
  await pressText(frame, '.flock', FIN.setup.finish);
  await opened(frame, 90000);
  return code;
}

async function metaOf(frame) {
  return frame.evaluate(async () => {
    const db = await new Promise((ok, no) => { const r = indexedDB.open('mentria-ext-finance'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
    const get = (k) => new Promise((ok, no) => { const r = db.transaction('meta', 'readonly').objectStore('meta').get(k); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
    const wraps = (await get('wraps')) || {};
    const out = {
      linked: (await get('linked')) === true,
      kcv: await get('kcv'),
      local: await get('local'),
      wrapKinds: Object.keys(wraps).filter((k) => wraps[k] != null && !(Array.isArray(wraps[k]) && !wraps[k].length)).sort(),
      prfIds: Array.isArray(wraps.prf) ? wraps.prf.map((p) => p.id) : []
    };
    db.close();
    return out;
  });
}

async function rawWraps(frame) {
  return frame.evaluate(async () => {
    const db = await new Promise((ok, no) => { const q = indexedDB.open('mentria-ext-finance'); q.onsuccess = () => ok(q.result); q.onerror = () => no(q.error); });
    const w = await new Promise((ok, no) => { const q = db.transaction('meta', 'readonly').objectStore('meta').get('wraps'); q.onsuccess = () => ok(q.result); q.onerror = () => no(q.error); });
    db.close();
    return JSON.parse(JSON.stringify(w));
  });
}

async function ledgerOf(frame, pass) {
  at('ledger');
  return frame.evaluate(async (pw) => {
    const V = await import('/assets/finance/vault.js');
    const E = await import('/assets/finance/engine.js');
    const L = await import('/assets/finance/oplog.js');
    const D = await import('/assets/finance/db.js');
    let s = null;
    if (pw) s = await V.unlockPass(pw);
    else {
      const M = await import('/assets/js/mentria-unlock.js');
      const list = await M.secrets('finance');
      try { s = await V.openLinked(list); } finally { for (const x of list) x.bytes.fill(0); }
    }
    const engine = new E.Engine({ root: s.root, keys: s.keys, deviceId: await D.getMeta('device_id') });
    await engine.load();
    const st = engine.state;
    return {
      pass: L.exists(st, 'vaultwrap', 'pass'),
      recovery: L.exists(st, 'vaultwrap', 'recovery'),
      passRemoved: !!L.removed(st, 'vaultwrap', 'pass'),
      recoveryRemoved: !!L.removed(st, 'vaultwrap', 'recovery'),
      anyWrap: L.known(st, 'vaultwrap', 'pass') || L.known(st, 'vaultwrap', 'recovery'),
      notes: L.list(st, 'transaction').map((t) => t.note)
    };
  }, pass || null);
}

async function keptFinance(scope) {
  at('kept');
  return scope.evaluate(async () => {
    const M = await import('/assets/js/mentria-unlock.js');
    await M.ready();
    const C = await import('/assets/finance/crypto.js');
    const out = [];
    for (const x of await M.secrets('finance')) {
      out.push({ id: x.id, kcv: (await C.deriveKeys(x.bytes)).kcv });
      x.bytes.fill(0);
    }
    return { list: out, current: M.secretId('finance') };
  });
}

async function runtimeState(scope) {
  at('runtime state');
  return scope.evaluate(async () => {
    const M = await import('/assets/js/mentria-unlock.js');
    await M.ready();
    return M.state();
  });
}

function record(page) {
  return page.evaluate((k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } }, RECORD);
}

async function waitStep(frame, name) {
  at('step ' + name);
  await frame.waitForFunction((n) => {
    const el = document.querySelector('.m-ulayer [data-step]');
    return el && el.dataset.step === n;
  }, { timeout: 30000 }, name);
}

async function layerGone(frame) {
  at('layer gone');
  await frame.waitForFunction(() => !document.querySelector('.m-ulayer'), { timeout: 90000 });
}

async function cardShown(frame) {
  await shown(frame, '.flock .m-unlock', 30000);
}

async function cardCode(frame, root, code) {
  const toggle = root + ' [data-act="show-code"]';
  const t = await frame.$(toggle);
  if (t && await t.evaluate((el) => el.getClientRects().length > 0 && el.getAttribute('aria-expanded') !== 'true')) await t.click();
  await typeIn(frame, root + ' input[name="recovery-code"]', code);
  await frame.$eval(root + ' input[name="recovery-code"]', (el) => el.form.requestSubmit());
}

async function lockTop(frame) {
  await frame.click('.fin-top button[aria-label="' + FIN.lock.lock_now + '"]');
}

async function route(frame, name) {
  at('route ' + name);
  await frame.evaluate((n) => { location.hash = '#/' + n; }, name);
  await frame.waitForFunction((n) => location.hash === '#/' + n && document.querySelector('.fin-page'), { timeout: 20000 }, name);
}

async function settingsInfo(frame) {
  await route(frame, 'settings');
  await sleep(600);
  return frame.evaluate((F) => {
    const main = document.getElementById('fin-main');
    const txt = main.textContent;
    const labels = [...main.querySelectorAll('.ff__label, label')].map((l) => l.textContent.trim());
    const buttons = [...main.querySelectorAll('button')].map((b) => b.textContent.trim());
    return {
      autoLock: labels.includes(F.settings.auto_lock),
      changePass: buttons.some((b) => b.includes(F.settings.change_pass)),
      newCode: buttons.some((b) => b.includes(F.settings.new_code)),
      keyringNote: txt.includes(F.settings.keyring_note),
      lock: buttons.some((b) => b.includes(F.lock.lock_now)),
      addPasskey: buttons.some((b) => b.includes(F.settings.add_passkey)),
      passkeyRows: main.querySelectorAll('.frow--static').length
    };
  }, FIN);
}

async function fakeAway(frame, minutes) {
  at('away');
  await frame.evaluate((mins) => {
    const real = Date.now.bind(Date);
    const fire = (hidden) => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
      document.dispatchEvent(new Event('visibilitychange'));
    };
    fire(true);
    const shift = mins * 60000;
    Date.now = () => real() + shift;
    fire(false);
    Date.now = real;
    delete document.hidden;
    delete document.visibilityState;
  }, minutes);
  await sleep(800);
}

const shared = {};

check('the Finance package leaves the runtime to the site', async () => {
  const r = await rig({ authenticator: false });
  try {
    await r.page.goto(ORIGIN + '/robots.txt', { waitUntil: 'load' });
    const urls = await r.page.evaluate(async () => (await (await fetch('/extensions/finance/files.json')).json()).files.map((f) => f.u));
    assert(urls.includes('/assets/finance/keyring.js') && !urls.some((u) => /mentria-unlock|unlock-copy/.test(u)), 'files.json lists Finance files only', urls.filter((u) => !u.startsWith('/assets/finance/')));
  } finally {
    await done(r);
  }
});

check('switch off keeps the old flow', async () => {
  const r = await rig();
  shared.legacy = r;
  const page = r.page;
  let frame = await store(page);
  assert(await frame.$('.flock') && !(await frame.$('.m-unlock')), 'welcome screen without the card');
  shared.code = await legacySetup(frame, { passkey: true, device: false });
  const meta = await metaOf(frame);
  assert(meta.wrapKinds.join() === 'pass,prf,recovery' && !meta.linked && meta.prfIds.length === 1, 'today\'s ledger has a passphrase, a recovery code and its passkey', meta);
  const facts = await page.evaluate(async (k) => ({ record: localStorage.getItem(k), dbs: (await indexedDB.databases()).map((d) => d.name) }), RECORD);
  assert(facts.record === null && !facts.dbs.includes('mentria-keyring'), 'nothing is written for the one unlock', facts);
  const s = await settingsInfo(frame);
  assert(s.autoLock && s.changePass && s.newCode && !s.keyringNote, 'settings show auto-lock and the Finance passphrase tools', s);
  const wraps = await until(async () => (await ledgerOf(frame, PASS)).pass, 15000);
  assert(wraps, 'the passphrase wrap is mirrored into the ledger as today');
  await fakeAway(frame, 10);
  await shown(frame, '#fin-pass', 20000);
  assert(!(await frame.$('.flock .fbanner--mint')) && !(await frame.$('.m-unlock')), 'auto-lock shows today\'s unlock screen with no link line');
  await (await typeIn(frame, '#fin-pass', PASS)).press('Enter');
  await opened(frame);
  await lockTop(frame);
  await shown(frame, '#fin-pass', 20000);
  await (await typeIn(frame, '#fin-pass', PASS)).press('Enter');
  await opened(frame);
  assert(!r.dialogs.length, 'no native dialogs', r.dialogs);
});

check('legacy ledger links after one old unlock', async () => {
  const r = shared.legacy;
  assert(r && shared.code, 'needs the ledger from the switch-off check');
  const page = r.page;
  await setSwitch(page, true);
  const frame = await store(page);
  await shown(frame, '#fin-pass', 20000);
  await frame.waitForFunction((t) => { const b = document.querySelector('.flock .fbanner--mint'); return b && !b.hidden && b.textContent.includes(t); }, { timeout: 15000 }, UK.link_title);
  assert(!(await frame.$('.flock .m-unlock')), 'the old unlock stays, with the link line above it');
  await (await typeIn(frame, '#fin-pass', PASS)).press('Enter');
  await present(frame, '#fin-main', 60000);
  await waitStep(frame, 'intro');
  await press(frame, '.m-ulayer [data-act="next"]');
  await waitStep(frame, 'code');
  const keep = await frame.$eval('.m-ulayer input[name="code-choice"][value="keep"]', (el) => el.checked);
  assert(keep, 'keeping the saved code is preselected');
  await typeIn(frame, '.m-ulayer input[name="saved-code"]', '2222-2222-2222-2222-2222-2222-2222-2222');
  await press(frame, '.m-ulayer [data-act="next"]');
  await frame.waitForFunction((t) => (document.querySelector('.m-ulayer .m-usheet__msg') || {}).textContent === t, { timeout: 30000 }, UK.err_code);
  assert(await record(page) === null, 'a wrong Finance code writes nothing');
  await typeIn(frame, '.m-ulayer input[name="saved-code"]', shared.code.toLowerCase());
  await press(frame, '.m-ulayer [data-act="next"]');
  await waitStep(frame, 'passkey');
  const keepPass = await frame.$('.m-ulayer input[name="keep-pass"]');
  assert(keepPass && await keepPass.evaluate((el) => el.checked), 'the Finance passphrase is offered to keep');
  await press(frame, '.m-ulayer [data-act="add-passkey"]');
  await layerGone(frame);
  await until(async () => (await metaOf(frame)).linked, 15000);
  const rec = await record(page);
  const st = await runtimeState(frame);
  const meta = await metaOf(frame);
  assert(rec && rec.services && rec.services.finance && st.unlocked && st.linked.includes('finance'), 'the one unlock holds Finance', { st, services: rec && Object.keys(rec.services) });
  assert(st.codeConfirmed && st.passkeys === 1 && st.hasPass, 'the saved code, a passkey and the kept passphrase', st);
  assert(meta.linked && meta.wrapKinds.join() === 'pass,prf,recovery', 'old wraps stay until retirement', meta);
  const s = await settingsInfo(frame);
  assert(s.keyringNote && !s.autoLock && !s.changePass && !s.newCode && s.lock && s.passkeyRows === 1, 'settings switch to the one unlock', s);
  const l = await ledgerOf(frame);
  assert(l.pass && l.recovery, 'the mirrored wraps are still in the ledger', l);
  shared.legacyLinked = true;
});

check('locked shows card and quick add', async () => {
  const r = shared.legacy;
  assert(shared.legacyLinked, 'needs the linked ledger');
  const page = r.page;
  let frame = await frameOf(page);
  await lockTop(frame);
  await cardShown(frame);
  assert(await frame.$('.flock details.flock__qa'), 'quick add sits below the card');
  assert(!(await frame.$('#fin-pass')), 'no Finance passphrase field');
  const st = await runtimeState(page);
  assert(!st.unlocked, 'Lock locked the site too', st);
  await frame.click('.flock__qa summary');
  await typeIn(frame, '.flock__qa input[aria-label="' + FIN.entry.amount + '"]', '12.50');
  await typeIn(frame, '.flock__qa input[maxlength="200"]', 'locked coffee');
  await pressText(frame, '.flock__qa', FIN.lock.qa_save);
  await frame.waitForFunction(() => /1/.test((document.querySelector('.flock__qa summary') || {}).textContent || ''), { timeout: 10000 });
  await page.reload({ waitUntil: 'load' });
  frame = await frameOf(page);
  await cardShown(frame);
  await cardCode(frame, '.flock .m-unlock', shared.code);
  await opened(frame);
  const l = await until(async () => (await ledgerOf(frame)).notes.includes('locked coffee'), 15000);
  assert(l, 'the quick entry lands in the ledger after the card unlocks');
  await page.reload({ waitUntil: 'load' });
  frame = await frameOf(page);
  await opened(frame);
  assert(!(await frame.evaluate(() => window.__sawLock)), 'a reload opens Finance without any screen');
  await frame.evaluate(() => { document.getElementById('fin-main').dataset.kept = '1'; });
  await fakeAway(frame, 10);
  await sleep(1500);
  const kept = await frame.evaluate(() => { const m = document.getElementById('fin-main'); return !!m && m.dataset.kept === '1'; });
  assert(kept && !(await frame.$('.flock')), 'auto-lock is off with the one unlock: the open ledger was never closed');
});

check('new ledger is linked', async () => {
  const r = await rig({ switchOn: true });
  shared.fresh = r;
  const page = r.page;
  let frame = await store(page);
  await pressText(frame, '.flock', FIN.setup.start);
  await waitStep(frame, 'intro');
  await press(frame, '.m-ulayer [data-act="next"]');
  await waitStep(frame, 'code');
  const code = await frame.$eval('.m-ulayer .m-ucode', (el) => el.textContent.replace(/\s+/g, '').trim());
  assert(/^[A-Z2-7]{4}(-[A-Z2-7]{4}){7}$/.test(code), 'a Mentria code is shown', code);
  shared.freshCode = code;
  await typeIn(frame, '.m-ulayer input[name="code-check"]', code.slice(-4).toLowerCase());
  await press(frame, '.m-ulayer [data-act="next"]');
  await waitStep(frame, 'passkey');
  await press(frame, '.m-ulayer [data-act="add-passkey"]');
  await layerGone(frame);
  await buttonByText(frame, '.flock', FIN.setup.finish);
  assert(!(await frame.$('.flock .fcheck input[type="checkbox"]')) && !(await frame.$('.flock input[type="password"]')), 'no Finance passphrase, passkey or device options');
  assert(!(await frame.$('.flock .fbanner')), 'no note when the one unlock holds no other ledger');
  await pressText(frame, '.flock', FIN.setup.finish);
  await opened(frame);
  const meta = await metaOf(frame);
  const st = await runtimeState(frame);
  assert(meta.linked && meta.wrapKinds.length === 0, 'the ledger has no passphrase or recovery wrap', meta);
  assert(st.unlocked && st.linked.includes('finance') && st.passkeys === 1, 'Finance is in the one unlock', st);
  await sleep(1500);
  const l = await ledgerOf(frame);
  assert(!l.anyWrap, 'the ledger publishes no wraps', l);
  await page.reload({ waitUntil: 'load' });
  frame = await frameOf(page);
  await opened(frame);
  assert(!(await frame.evaluate(() => window.__sawLock)), 'a reload opens without any screen');
  const s = await settingsInfo(frame);
  assert(s.keyringNote && !s.autoLock && s.passkeyRows === 1 && s.addPasskey, 'settings show the one unlock passkeys', s);
});

check('lock in one tab locks the other', async () => {
  const r = shared.fresh;
  assert(r, 'needs the new ledger');
  const a = r.page;
  const b = await newPage(r, false);
  const fb = await store(b);
  await opened(fb);
  assert(!(await fb.evaluate(() => window.__sawLock)), 'a second tab opens without any screen');
  const fa = await frameOf(a);
  await lockTop(fa);
  await cardShown(fa);
  await cardShown(fb);
  const sb = await runtimeState(b);
  assert(!sb.unlocked, 'the other tab\'s page is locked too', sb);
  await b.bringToFront();
  await cardCode(fb, '.flock .m-unlock', shared.freshCode);
  await opened(fb);
  await opened(fa);
  await b.close();
});

check('a lock while a linked ledger opens still locks it', async () => {
  const r = shared.fresh;
  assert(r, 'needs the new ledger');
  const a = r.page;
  const fa = await frameOf(a);
  await opened(fa);
  await a.evaluate(() => localStorage.setItem('test.holdPages', '1'));
  const b = await newPage(r, false);
  try {
    at('hold');
    await b.goto(ORIGIN + STORE, { waitUntil: 'load' });
    await b.waitForFunction(() => {
      const f = document.getElementById('xr-frame');
      try { return !!(f && f.contentWindow && f.contentWindow.__holding === 'held' && f.contentWindow.FIN_COPY); } catch (_) { return false; }
    }, { timeout: 60000, polling: 150 });
    const fb = await (await b.$('#xr-frame')).contentFrame();
    await sleep(2500);
    const mid = await fb.evaluate(() => ({ main: !!document.getElementById('fin-main'), lock: !!document.querySelector('.flock') }));
    assert(!mid.main && !mid.lock, 'the second tab is still opening its ledger', mid);
    await a.bringToFront();
    await lockTop(fa);
    await cardShown(fa);
    const locked = await until(async () => !(await runtimeState(fb)).unlocked, 15000);
    assert(locked, 'the opening tab heard the lock');
    await a.evaluate(() => localStorage.removeItem('test.holdPages'));
    await b.bringToFront();
    await cardShown(fb);
    await sleep(800);
    assert(!(await fb.$('#fin-main')), 'the ledger that was opening ends locked');
  } finally {
    await a.evaluate(() => localStorage.removeItem('test.holdPages')).catch(() => {});
    await b.close().catch(() => {});
  }
  const fa2 = await frameOf(a);
  await cardCode(fa2, '.flock .m-unlock', shared.freshCode);
  await opened(fa2);
});

check('export with keys works while unlocked', async () => {
  const r = shared.fresh;
  assert(r, 'needs the new ledger');
  const page = r.page;
  const frame = await frameOf(page);
  await opened(frame);
  await page.evaluate(() => {
    window.__dl = null;
    const ui = window.MentriaUI;
    ui.downloadFile = (name, blob) => { blob.text().then((t) => { window.__dl = { name, text: t }; }); };
  });
  await route(frame, 'settings');
  await pressText(frame, '#fin-main', FIN.settings.export);
  await shown(frame, 'dialog.fsheet input[type="password"]');
  await sleep(300);
  for (const el of await frame.$$('dialog.fsheet input[type="password"]')) await el.type('export pass 2468');
  const typed = await frame.$$eval('dialog.fsheet input[type="password"]', (l) => l.map((n) => n.value));
  assert(typed.length === 2 && typed.every((v) => v === 'export pass 2468'), 'the file passphrase is typed twice', typed.length);
  assert(await frame.$eval('dialog.fsheet .fcheck input[type="checkbox"]', (el) => el.checked), 'keys are included by default');
  await pressText(frame, 'dialog.fsheet', FIN.settings.export_go);
  await page.waitForFunction(() => window.__dl, { timeout: 60000 });
  const out = await page.evaluate(async () => {
    const env = JSON.parse(window.__dl.text);
    const payload = await window.MentriaBackup.decryptBackup(env, 'export pass 2468');
    const M = await import('/assets/js/mentria-unlock.js');
    const root = await M.secret('finance');
    let s = '';
    for (const b of root) s += String.fromCharCode(b);
    return { name: window.__dl.name, format: payload.format, root: payload.root === btoa(s), recs: payload.snapshot.recs.length, wraps: payload.snapshot.recs.filter((x) => x[0] === 'vaultwrap').length };
  });
  assert(/^mentria-finance-\d{8}\.json$/.test(out.name) && out.format === 'mentria-finance' && out.root && out.recs > 0 && out.wraps === 0, 'the file holds the ledger and its key', out);
});

check('adding a passkey after a reload asks to confirm', async () => {
  const r = shared.fresh;
  assert(r, 'needs the new ledger');
  const page = r.page;
  await page.__cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: page.__auth });
  page.__auth = (await page.__cdp.send('WebAuthn.addVirtualAuthenticator', { options: AUTH })).authenticatorId;
  await page.reload({ waitUntil: 'load' });
  const frame = await frameOf(page);
  await opened(frame);
  await route(frame, 'settings');
  await pressText(frame, '#fin-main', FIN.settings.add_passkey);
  await shown(frame, '.m-ulayer .m-unlock', 20000);
  await cardCode(frame, '.m-ulayer .m-unlock', shared.freshCode);
  await layerGone(frame);
  await frame.waitForFunction((t) => [...document.querySelectorAll('.ftoast, [role="status"]')].some((n) => n.textContent.includes(t)), { timeout: 10000 }, FIN.settings.keyring_again);
  await pressText(frame, '#fin-main', FIN.settings.add_passkey);
  const ok = await until(async () => (await runtimeState(frame)).passkeys === 2, 30000);
  assert(ok, 'a fresh click adds the second passkey', await runtimeState(frame));
  await sleep(400);
  const s = await settingsInfo(frame);
  assert(s.passkeyRows === 2, 'both passkeys are listed', s);
});

check('a ledger kept under prior still opens', async () => {
  const r = shared.fresh;
  assert(r, 'needs the new ledger');
  const page = r.page;
  let frame = await frameOf(page);
  await opened(frame);
  const mine = (await metaOf(frame)).kcv;
  await page.evaluate(async () => {
    const M = await import('/assets/js/mentria-unlock.js');
    await M.ready();
    await M.link('finance', crypto.getRandomValues(new Uint8Array(32)));
  });
  const kept = await keptFinance(page);
  assert(kept.list.length >= 2 && kept.list[0].id === kept.current && kept.list[0].kcv !== mine && kept.list.slice(1).some((x) => x.kcv === mine), 'another ledger is current and this one is kept under prior', { kept, mine });
  await page.reload({ waitUntil: 'load' });
  frame = await frameOf(page);
  await opened(frame);
  assert(!(await frame.evaluate(() => window.__sawLock)), 'this ledger opens with the session and no screen');
  assert((await metaOf(frame)).kcv === mine, 'the same ledger is open');
  const l = await ledgerOf(frame);
  assert(Array.isArray(l.notes), 'the ledger reads with its kept secret', l);
});

check('after Erase a new ledger links normally', async () => {
  const r = shared.fresh;
  assert(r, 'needs the new ledger');
  const page = r.page;
  let frame = await frameOf(page);
  await opened(frame);
  const old = (await metaOf(frame)).kcv;
  const before = await keptFinance(page);
  await route(frame, 'settings');
  await pressText(frame, '#fin-main', FIN.lock.erase);
  await pressText(frame, 'dialog.fsheet', FIN.lock.erase_ok);
  at('welcome after erase');
  await page.waitForFunction((start) => {
    const f = document.getElementById('xr-frame');
    try { return [...f.contentDocument.querySelectorAll('.flock button')].some((b) => b.textContent.trim() === start); } catch (_) { return false; }
  }, { timeout: 60000, polling: 150 }, FIN.setup.start);
  frame = await frameOf(page);
  await pressText(frame, '.flock', FIN.setup.start);
  at('basics after erase');
  await buttonByText(frame, '.flock', FIN.setup.finish);
  assert(!(await frame.$('.flock input[type="password"]')) && !(await frame.$('.m-ulayer')), 'setup goes straight to the basics with the session open');
  assert(await frame.evaluate((note) => [...document.querySelectorAll('.flock .fbanner')].some((b) => b.textContent.trim() === note), FIN.setup.keyring_other), 'a note points to adding this device instead');
  await pressText(frame, '.flock', FIN.setup.finish);
  await opened(frame);
  const meta = await metaOf(frame);
  const kept = await keptFinance(page);
  assert(meta.linked && meta.wrapKinds.length === 0 && meta.kcv !== old, 'a new linked ledger with no old wraps', meta);
  assert(kept.list[0].kcv === meta.kcv && kept.list[0].id === kept.current, 'the new ledger is the current Finance entry', kept);
  assert(before.list.every((b) => kept.list.some((k) => k.kcv === b.kcv)), 'every earlier entry is still kept', { before, kept });
  await page.reload({ waitUntil: 'load' });
  frame = await frameOf(page);
  await opened(frame);
  assert(!(await frame.evaluate(() => window.__sawLock)), 'the new ledger opens with the session');
  assert((await metaOf(frame)).kcv === meta.kcv, 'the new ledger is the one that opens');
});

check('legacy device unlock turns on remember', async () => {
  const r = await rig();
  const page = r.page;
  let frame = await store(page);
  const code = await legacySetup(frame, { passkey: false, device: true });
  assert((await metaOf(frame)).wrapKinds.includes('device'), 'today\'s device unlock is on');
  await setSwitch(page, true);
  frame = await store(page);
  await present(frame, '#fin-main', 60000);
  await waitStep(frame, 'intro');
  await press(frame, '.m-ulayer [data-act="next"]');
  await waitStep(frame, 'code');
  await typeIn(frame, '.m-ulayer input[name="saved-code"]', code);
  await press(frame, '.m-ulayer [data-act="next"]');
  await waitStep(frame, 'passkey');
  assert(!(await frame.$('.m-ulayer input[name="keep-pass"]')), 'no passphrase to keep after a device unlock');
  await press(frame, '.m-ulayer [data-act="skip-passkey"]');
  await layerGone(frame);
  const ok = await until(async () => !(await metaOf(frame)).wrapKinds.includes('device'), 15000);
  const meta = await metaOf(frame);
  const st = await runtimeState(frame);
  assert(ok && meta.linked && meta.wrapKinds.join() === 'pass,recovery', 'Finance\'s device wrap is gone and the others stay', meta);
  assert(st.hasDevice && st.unlocked, 'Remember this device is on', st);
  const fresh = await newPage(r, false);
  await page.close();
  await sleep(1500);
  const f2 = await store(fresh);
  await opened(f2);
  const d = await fresh.evaluate(async () => (await import('/assets/js/mentria-unlock.js')).diagnostics());
  assert(d.decision === 'reopen', 'the app was reopened', d);
  assert(!(await f2.evaluate(() => window.__sawLock)), 'the remembered device opens Finance without a screen');
  await done(r);
});

check('adopting a linked ledger hands its device unlock to Remember', async () => {
  const r = await rig();
  try {
    const page = r.page;
    let frame = await store(page);
    await legacySetup(frame, { passkey: false, device: true });
    await setSwitch(page, true);
    await page.goto(ORIGIN + '/beta/unlock/', { waitUntil: 'load' });
    const made = await page.evaluate(async () => {
      const M = await import('/assets/js/mentria-unlock.js');
      const V = await import('/assets/finance/vault.js');
      await M.create({});
      await M.setRemember(true);
      const s = await V.unlockDevice();
      await M.link('finance', s.root);
      return M.state();
    });
    assert(made.unlocked && made.hasDevice && made.linked.includes('finance'), 'a remembered keyring already holds this ledger', made);
    frame = await store(page);
    await opened(frame);
    const ok = await until(async () => !(await metaOf(frame)).wrapKinds.includes('device'), 15000);
    const meta = await metaOf(frame);
    const st = await runtimeState(frame);
    const facts = await frame.evaluate(async () => ({ sheet: !!document.querySelector('.m-ulayer'), bytes: (await import('/assets/js/mentria-unlock.js')).hasRootBytes() }));
    assert(!(await frame.evaluate(() => window.__sawLock)) && !facts.sheet, 'the ledger opens with no screen and no setup sheet', facts);
    assert(ok && meta.linked && meta.wrapKinds.join() === 'pass,recovery', 'Finance\'s device unlock is gone and its passphrase stays', meta);
    assert(st.hasDevice && !facts.bytes, 'Remember stays on without asking to confirm', { st, facts });
  } finally {
    await done(r);
  }
});

check('recovery code unlock keeps the Finance code', async () => {
  const r = await rig();
  try {
    const page = r.page;
    let frame = await store(page);
    const code = await legacySetup(frame, { passkey: false, device: false });
    await setSwitch(page, true);
    frame = await store(page);
    await shown(frame, '#fin-pass', 20000);
    await pressText(frame, '.flock', FIN.lock.use_recovery);
    await (await typeIn(frame, '#fin-pass', code.toLowerCase().replace(/-/g, ' '))).press('Enter');
    await present(frame, '#fin-main', 60000);
    await waitStep(frame, 'intro');
    await press(frame, '.m-ulayer [data-act="next"]');
    await waitStep(frame, 'code');
    const info = await frame.evaluate(() => {
      const keep = document.querySelector('.m-ulayer input[name="code-choice"][value="keep"]');
      const next = document.querySelector('.m-ulayer [data-act="next"]');
      return { keep: !!keep && keep.checked, saved: !!document.querySelector('.m-ulayer input[name="saved-code"]'), next: !!next && !next.disabled };
    });
    assert(info.keep && !info.saved && info.next, 'the Finance code is kept without typing it again', info);
    await press(frame, '.m-ulayer [data-act="next"]');
    await waitStep(frame, 'passkey');
    assert(!(await frame.$('.m-ulayer input[name="keep-pass"]')), 'no passphrase to keep after a code unlock');
    await press(frame, '.m-ulayer [data-act="skip-passkey"]');
    await layerGone(frame);
    const ok = await until(async () => (await metaOf(frame)).linked, 15000);
    const st = await runtimeState(frame);
    assert(ok && st.linked.includes('finance') && st.codeConfirmed && st.passkeys === 0 && !st.hasPass, 'linked with the Finance code as the Mentria code', st);
    await sleep(1200);
    const ask = await frame.evaluate((title) => [...document.querySelectorAll('dialog.fsheet')].some((d) => d.textContent.includes(title)), FIN.lock.new_pass_title);
    assert(!ask, 'no new Finance passphrase is asked for');
    await lockTop(frame);
    await cardShown(frame);
    await cardCode(frame, '.flock .m-unlock', code);
    await opened(frame);
  } finally {
    await done(r);
  }
});

check('old locks stay while this ledger sits under prior', async () => {
  const r = shared.legacy;
  assert(shared.legacyLinked, 'needs the linked ledger');
  const page = r.page;
  let frame = await frameOf(page);
  await opened(frame);
  const before = await metaOf(frame);
  assert(before.wrapKinds.join() === 'pass,prf,recovery', 'the old wraps are here', before);
  await page.evaluate(async () => {
    const M = await import('/assets/js/mentria-unlock.js');
    await M.ready();
    await M.link('finance', crypto.getRandomValues(new Uint8Array(32)));
  });
  const kept = await keptFinance(page);
  assert(kept.list[0].kcv !== before.kcv && kept.list.slice(1).some((x) => x.kcv === before.kcv), 'this ledger now sits under prior', kept);
  await page.goto(ORIGIN + '/robots.txt', { waitUntil: 'load' });
  const dated = await page.evaluate((k) => {
    const rec = JSON.parse(localStorage.getItem(k));
    rec.services.finance.linked = new Date(Date.now() - 31 * 86400000).toISOString();
    localStorage.setItem(k, JSON.stringify(rec));
    return rec.services.finance.linked;
  }, RECORD);
  frame = await store(page);
  await opened(frame);
  await sleep(3000);
  const meta = await metaOf(frame);
  const rec = await record(page);
  assert(meta.wrapKinds.join() === 'pass,prf,recovery', 'the old wraps stay while another ledger is current', meta);
  assert(!(rec.retired && rec.retired.finance), 'Finance is not marked retired', rec.retired);
  assert(rec.services.finance.linked === dated, 'the backdated link time held');
  const plan = await frame.evaluate(async () => (await import('/assets/js/mentria-unlock.js')).retirement('finance'));
  assert(plan.ready, 'the record alone would allow retirement', plan);
  assert(!(await frame.evaluate(() => window.__signals.length)), 'no passkey is signalled');
  await frame.evaluate(async (pw) => {
    const M = await import('/assets/js/mentria-unlock.js');
    const V = await import('/assets/finance/vault.js');
    const s = await V.unlockPass(pw);
    await M.link('finance', s.root);
    s.root.fill(0);
  }, PASS);
  const back = await keptFinance(page);
  assert(back.list[0].kcv === before.kcv, 'this ledger is current again', back);
});

check('retirement deletes the old locks', async () => {
  const r = shared.legacy;
  assert(shared.legacyLinked, 'needs the linked ledger');
  const page = r.page;
  let frame = await frameOf(page);
  await opened(frame);
  const before = await metaOf(frame);
  assert(before.wrapKinds.join() === 'pass,prf,recovery', 'nothing retires inside 30 days', before);
  shared.wrapsBefore = await rawWraps(frame);
  const legacyIds = before.prfIds.map((id) => id.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
  await page.goto(ORIGIN + '/robots.txt', { waitUntil: 'load' });
  const dated = await page.evaluate((k) => {
    const rec = JSON.parse(localStorage.getItem(k));
    rec.services.finance.linked = new Date(Date.now() - 31 * 86400000).toISOString();
    localStorage.setItem(k, JSON.stringify(rec));
    return rec.services.finance.linked;
  }, RECORD);
  frame = await store(page);
  await opened(frame);
  const ok = await until(async () => (await metaOf(frame)).wrapKinds.length === 0, 20000);
  assert((await record(page)).services.finance.linked === dated, 'the backdated link time held');
  const meta = await metaOf(frame);
  const rec = await record(page);
  const l = await ledgerOf(frame);
  const signals = await frame.evaluate(() => window.__signals);
  assert(ok && meta.linked, 'every old wrap is gone from this device', meta);
  assert(!l.pass && !l.recovery && l.passRemoved && l.recoveryRemoved, 'the mirrored wraps are deleted in the ledger', l);
  assert(rec.retired && rec.retired.finance, 'Finance is marked retired', rec.retired);
  assert(signals.length === legacyIds.length && signals.every((s, i) => s.credentialId === legacyIds[i] && s.rpId === 'localhost'), 'the old passkeys are signalled as unknown', { signals, legacyIds });
  await page.reload({ waitUntil: 'load' });
  frame = await frameOf(page);
  await opened(frame);
  const again = await frame.evaluate(() => window.__signals.length);
  assert(again === 0, 'retirement runs once', again);
  assert(!r.errors.length, 'no page errors', r.errors);
  shared.retired = rec.retired.finance;
});

check('retired elsewhere: leftover wraps go and stay gone', async () => {
  const r = shared.legacy;
  assert(shared.retired && shared.wrapsBefore, 'needs the retired ledger');
  const page = r.page;
  let frame = await frameOf(page);
  await opened(frame);
  await frame.evaluate(async (wraps) => {
    const db = await new Promise((ok, no) => { const q = indexedDB.open('mentria-ext-finance'); q.onsuccess = () => ok(q.result); q.onerror = () => no(q.error); });
    await new Promise((ok, no) => { const tx = db.transaction('meta', 'readwrite'); tx.objectStore('meta').put(wraps, 'wraps'); tx.oncomplete = ok; tx.onerror = () => no(tx.error); });
    db.close();
  }, shared.wrapsBefore);
  const planted = await metaOf(frame);
  assert(planted.wrapKinds.join() === 'pass,prf,recovery', 'this device still holds its old wraps', planted);
  const ids = planted.prfIds.map((id) => id.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
  await page.reload({ waitUntil: 'load' });
  frame = await frameOf(page);
  await opened(frame);
  const ok = await until(async () => (await metaOf(frame)).wrapKinds.length === 0, 20000);
  await sleep(1500);
  const l = await ledgerOf(frame);
  const rec = await record(page);
  const signals = await frame.evaluate(() => window.__signals);
  assert(ok, 'the leftover wraps are deleted', await metaOf(frame));
  assert(!l.pass && !l.recovery && l.passRemoved && l.recoveryRemoved, 'they are not published back into the ledger', l);
  assert(rec.retired.finance === shared.retired, 'the retirement date is unchanged', rec.retired);
  assert(signals.length === ids.length && signals.every((s, i) => s.credentialId === ids[i]), 'this device signals its own old passkeys', { signals, ids });
});

async function keyringOn(page, lockAfter) {
  at('keyring on the lab page');
  await page.goto(ORIGIN + '/beta/unlock/', { waitUntil: 'load' });
  return page.evaluate(async (l) => {
    const M = await import('/assets/js/mentria-unlock.js');
    const core = await import('/assets/js/mentria-unlock-core.js');
    await M.ready();
    const code = core.newRecoveryCode();
    await M.create({ code, confirmed: true });
    if (l) await M.lock();
    return code;
  }, !!lockAfter);
}

async function onLab(page, fn, arg) {
  if (!page.url().startsWith(ORIGIN + '/beta/unlock/')) await page.goto(ORIGIN + '/beta/unlock/', { waitUntil: 'load' });
  return page.evaluate(fn, arg);
}

const LATER = () => sessionStorage.getItem('mentria.finance.linkLater');

const NUDGE = async () => {
  const M = await import('/assets/js/mentria-unlock.js');
  await M.ready();
  M.setAskAtLaunch(!M.state().askAtLaunch);
};

async function declinedTab(r, prep) {
  const page = r.page;
  let frame = await store(page);
  await legacySetup(frame, { passkey: false, device: false });
  await setSwitch(page, true);
  const code = await keyringOn(page, !prep);
  if (prep) await onLab(page, prep, PASS);
  frame = await store(page);
  await shown(frame, '#fin-pass', 20000);
  await (await typeIn(frame, '#fin-pass', PASS)).press('Enter');
  await present(frame, '#fin-main', 60000);
  await shown(frame, 'dialog.fsheet .m-unlock', 30000);
  await pressText(frame, 'dialog.fsheet', FIN.common.later);
  await frame.waitForFunction(() => !document.querySelector('dialog.fsheet'), { timeout: 15000 });
  await opened(frame);
  assert(!(await metaOf(frame)).linked, 'Later keeps today\'s ledger');
  assert((await frame.evaluate(LATER)) === '1', 'Later is kept for this tab');
  return { frame, code };
}

check('a tab that said Later locks once another tab linked the ledger', async () => {
  const r = await rig();
  try {
    const page = r.page;
    const { frame, code } = await declinedTab(r);
    const other = await newPage(r, false);
    await onLab(other, async (c) => {
      const M = await import('/assets/js/mentria-unlock.js');
      await M.ready();
      await M.unlockWithCode(c);
    }, code);
    await sleep(1000);
    await page.bringToFront();
    assert(await frame.$('#fin-main'), 'the ledger stays open while it is not linked');
    await onLab(other, async () => {
      const db = await new Promise((ok, no) => { const q = indexedDB.open('mentria-ext-finance'); q.onsuccess = () => ok(q.result); q.onerror = () => no(q.error); });
      await new Promise((ok, no) => { const tx = db.transaction('meta', 'readwrite'); tx.objectStore('meta').put(true, 'linked'); tx.oncomplete = ok; tx.onerror = () => no(tx.error); });
      db.close();
    });
    await onLab(other, async () => {
      const M = await import('/assets/js/mentria-unlock.js');
      await M.lock();
    });
    await page.bringToFront();
    await shown(frame, '.flock', 20000);
    assert(!(await frame.$('#fin-main')), 'the ledger closed with the lock');
  } finally {
    await done(r);
  }
});

check('a tab that said Later takes up a link made in another tab', async () => {
  const r = await rig();
  try {
    const page = r.page;
    const { frame, code } = await declinedTab(r);
    const before = await settingsInfo(frame);
    assert(before.autoLock && !before.keyringNote, 'today\'s settings while not linked', before);
    const other = await newPage(r, false);
    await onLab(other, async (a) => {
      const M = await import('/assets/js/mentria-unlock.js');
      const V = await import('/assets/finance/vault.js');
      await M.ready();
      await M.unlockWithCode(a.code);
      const s = await V.unlockPass(a.pass);
      await V.markLinked();
      await M.link('finance', s.root);
      s.root.fill(0);
    }, { code, pass: PASS });
    await page.bringToFront();
    const took = await until(async () => (await settingsInfo(frame)).keyringNote, 15000);
    assert(took, 'the open ledger switches to the one unlock', await settingsInfo(frame));
    await frame.evaluate(() => { document.getElementById('fin-main').dataset.kept = '1'; });
    await fakeAway(frame, 10);
    await sleep(1500);
    const kept = await frame.evaluate(() => { const m = document.getElementById('fin-main'); return !!m && m.dataset.kept === '1'; });
    assert(kept, 'its own auto-lock is off once it follows the one unlock');
    await onLab(other, async () => {
      const M = await import('/assets/js/mentria-unlock.js');
      await M.lock();
    });
    await page.bringToFront();
    await cardShown(frame);
    assert(!(await frame.$('#fin-main')), 'a lock elsewhere locks it');
  } finally {
    await done(r);
  }
});

check('Later after a device unlock is not asked again in this tab', async () => {
  const r = await rig();
  try {
    const page = r.page;
    let frame = await store(page);
    await legacySetup(frame, { passkey: false, device: true });
    await setSwitch(page, true);
    frame = await store(page);
    await present(frame, '#fin-main', 60000);
    await waitStep(frame, 'intro');
    await press(frame, '.m-ulayer [data-act="not-now"]');
    await layerGone(frame);
    await page.reload({ waitUntil: 'load' });
    frame = await frameOf(page);
    await opened(frame);
    await sleep(3000);
    assert(!(await frame.$('.m-ulayer')), 'the setup sheet stays away after a reload');
    assert(!(await metaOf(frame)).linked && (await record(page)) === null, 'nothing was linked or made');
    const fresh = await newPage(r, false);
    const f2 = await store(fresh);
    await present(f2, '#fin-main', 60000);
    await waitStep(f2, 'intro');
  } finally {
    await done(r);
  }
});

check('retired elsewhere: this ledger\'s synced wraps go too', async () => {
  const r = await rig();
  try {
    const page = r.page;
    let frame = await store(page);
    await legacySetup(frame, { passkey: false, device: false });
    assert(await until(async () => (await ledgerOf(frame, PASS)).pass, 15000), 'the wraps are mirrored into the ledger');
    await setSwitch(page, true);
    await keyringOn(page, false);
    await onLab(page, async (pw) => {
      const M = await import('/assets/js/mentria-unlock.js');
      const V = await import('/assets/finance/vault.js');
      const s = await V.unlockPass(pw);
      await M.link('finance', s.root);
      s.root.fill(0);
    }, PASS);
    await page.goto(ORIGIN + '/robots.txt', { waitUntil: 'load' });
    await page.evaluate((k) => {
      const rec = JSON.parse(localStorage.getItem(k));
      rec.services.finance.linked = new Date(Date.now() - 31 * 86400000).toISOString();
      rec.retired = { finance: new Date(Date.now() - 86400000).toISOString() };
      rec.changed = new Date().toISOString();
      localStorage.setItem(k, JSON.stringify(rec));
    }, RECORD);
    frame = await store(page);
    await opened(frame);
    const plan = await frame.evaluate(async () => (await import('/assets/js/mentria-unlock.js')).retirement('finance'));
    assert(plan.blockers.join() === 'already-retired', 'only the retirement elsewhere is left', plan);
    const gone = await until(async () => (await metaOf(frame)).wrapKinds.length === 0, 20000);
    assert(gone, 'the old wraps on this device are deleted', await metaOf(frame));
    const ok = await until(async () => { const l = await ledgerOf(frame); return !l.pass && !l.recovery && l.passRemoved && l.recoveryRemoved; }, 15000);
    assert(ok, 'the synced copies in the ledger are deleted too', await ledgerOf(frame));
    assert(!r.errors.length, 'no page errors', r.errors);
  } finally {
    await done(r);
  }
});

check('a Lock closes a tab that said Later once the one unlock holds Finance from another device', async () => {
  const r = await rig();
  try {
    const page = r.page;
    const { frame, code } = await declinedTab(r, async (pw) => {
      const M = await import('/assets/js/mentria-unlock.js');
      const V = await import('/assets/finance/vault.js');
      const s = await V.unlockPass(pw);
      await M.link('finance', s.root);
      s.root.fill(0);
      await M.lock();
    });
    const other = await newPage(r, false);
    await onLab(other, NUDGE);
    await sleep(1500);
    await page.bringToFront();
    assert(await frame.$('#fin-main'), 'a change that is not a lock leaves the ledger open');
    await onLab(other, async (c) => {
      const M = await import('/assets/js/mentria-unlock.js');
      await M.unlockWithCode(c);
    }, code);
    await sleep(1500);
    await page.bringToFront();
    assert(await frame.$('#fin-main'), 'an unlock leaves it open');
    await onLab(other, async () => {
      const M = await import('/assets/js/mentria-unlock.js');
      await M.lock();
    });
    await page.bringToFront();
    await shown(frame, '.flock', 20000);
    assert(!(await frame.$('#fin-main')), 'the Lock closed the ledger');
  } finally {
    await done(r);
  }
});

check('a ledger the one unlock cannot open keeps its own lock', async () => {
  const r = await rig();
  try {
    const page = r.page;
    let frame = await store(page);
    await legacySetup(frame, { passkey: false, device: false });
    await setSwitch(page, true);
    await keyringOn(page, false);
    await onLab(page, async () => {
      const M = await import('/assets/js/mentria-unlock.js');
      await M.link('finance', crypto.getRandomValues(new Uint8Array(32)));
      const db = await new Promise((ok, no) => { const q = indexedDB.open('mentria-ext-finance'); q.onsuccess = () => ok(q.result); q.onerror = () => no(q.error); });
      await new Promise((ok, no) => { const tx = db.transaction('meta', 'readwrite'); tx.objectStore('meta').put(true, 'linked'); tx.oncomplete = ok; tx.onerror = () => no(tx.error); });
      db.close();
    });
    frame = await store(page);
    await shown(frame, '#fin-pass', 30000);
    await (await typeIn(frame, '#fin-pass', PASS)).press('Enter');
    await opened(frame);
    const other = await newPage(r, false);
    await onLab(other, NUDGE);
    await sleep(1500);
    await page.bringToFront();
    const s = await settingsInfo(frame);
    assert(s.autoLock && s.changePass && !s.keyringNote, 'the ledger keeps its own settings', s);
    await fakeAway(frame, 10);
    await shown(frame, '#fin-pass', 20000);
    assert(!(await frame.$('#fin-main')), 'its own auto-lock still runs');
  } finally {
    await done(r);
  }
});

check('a lock while the link sheet is open is not a Later', async () => {
  const r = await rig();
  try {
    const page = r.page;
    let frame = await store(page);
    await legacySetup(frame, { passkey: false, device: false });
    await setSwitch(page, true);
    await keyringOn(page, true);
    frame = await store(page);
    await shown(frame, '#fin-pass', 20000);
    await (await typeIn(frame, '#fin-pass', PASS)).press('Enter');
    await present(frame, '#fin-main', 60000);
    await shown(frame, 'dialog.fsheet .m-unlock', 30000);
    await fakeAway(frame, 10);
    await shown(frame, '#fin-pass', 20000);
    assert(!(await frame.$('dialog.fsheet')), 'the auto-lock closed the sheet');
    assert((await frame.evaluate(LATER)) === null, 'a lock is not a Later');
    await (await typeIn(frame, '#fin-pass', PASS)).press('Enter');
    await present(frame, '#fin-main', 60000);
    await shown(frame, 'dialog.fsheet .m-unlock', 30000);
    await page.keyboard.press('Escape');
    await frame.waitForFunction(() => !document.querySelector('dialog.fsheet'), { timeout: 15000 });
    assert((await frame.evaluate(LATER)) === '1', 'Escape counts as Later');
  } finally {
    await done(r);
  }
});

async function rememberOf(scope) {
  return scope.evaluate(async () => {
    const M = await import('/assets/js/mentria-unlock.js');
    await M.ready();
    return { decision: M.rememberDecision(), pending: M.rememberPending(), hasDevice: M.state().hasDevice, unlocked: M.state().unlocked, linked: M.state().linked };
  });
}

check('Remember turned off stays off when a device-unlock ledger links', async () => {
  const r = await rig();
  try {
    const page = r.page;
    let frame = await store(page);
    await legacySetup(frame, { passkey: false, device: true });
    await setSwitch(page, true);
    const code = await keyringOn(page, false);
    await onLab(page, async () => {
      const M = await import('/assets/js/mentria-unlock.js');
      await M.setRemember(false, { decided: true });
      await M.lock();
    });
    frame = await store(page);
    await present(frame, '#fin-main', 60000);
    await shown(frame, 'dialog.fsheet .m-unlock', 30000);
    await cardCode(frame, 'dialog.fsheet .m-unlock', code);
    await frame.waitForFunction(() => !document.querySelector('dialog.fsheet'), { timeout: 30000 });
    assert(await until(async () => (await metaOf(frame)).linked, 15000), 'the ledger is linked');
    await sleep(800);
    const rem = await rememberOf(frame);
    const meta = await metaOf(frame);
    assert(rem.decision === 'off' && !rem.hasDevice && rem.linked.includes('finance'), 'Remember stays off', rem);
    assert(meta.wrapKinds.includes('device'), 'Finance\'s own device unlock waits for retirement', meta);
  } finally {
    await done(r);
  }
});

check('a Remember that needed a confirm turns on at the next card unlock', async () => {
  const r = await rig();
  try {
    const page = r.page;
    let frame = await store(page);
    await legacySetup(frame, { passkey: false, device: true });
    await setSwitch(page, true);
    const code = await keyringOn(page, false);
    frame = await store(page);
    await opened(frame);
    assert(await until(async () => (await metaOf(frame)).linked, 15000), 'the ledger links with the open session');
    await sleep(800);
    let rem = await rememberOf(frame);
    let meta = await metaOf(frame);
    assert(rem.pending && !rem.hasDevice && rem.decision === '', 'Remember waits for an unlock on this device', rem);
    assert(meta.wrapKinds.includes('device'), 'Finance\'s own device unlock stays meanwhile', meta);
    await lockTop(frame);
    await cardShown(frame);
    await cardCode(frame, '.flock .m-unlock', code);
    await opened(frame);
    const on = await until(async () => (await rememberOf(frame)).hasDevice, 15000);
    rem = await rememberOf(frame);
    meta = await metaOf(frame);
    assert(on && !rem.pending && rem.decision === '', 'Remember turns on after the card unlock', rem);
    assert(!meta.wrapKinds.includes('device') && meta.wrapKinds.includes('pass'), 'Finance\'s own device unlock is handed over', meta);
  } finally {
    await done(r);
  }
});

let failed = 0;
const ONLY = process.env.ONLY || '';
const run = checks.filter(([n]) => !ONLY || ONLY.split('|').some((o) => n.includes(o)));
for (const [name, fn] of run) {
  stage = '';
  try {
    await fn();
    console.log('PASS finance: ' + name);
  } catch (e) {
    failed++;
    console.log('FAIL finance: ' + name + ': ' + String((e && e.message) || e).slice(0, 500) + (stage ? ' [at ' + stage + ']' : ''));
  }
}
console.log((run.length - failed) + '/' + run.length + ' passed');
for (const r of [shared.legacy, shared.fresh]) if (r) await done(r);
await browser.close();
await server.close();
rmSync(PROFILE, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
