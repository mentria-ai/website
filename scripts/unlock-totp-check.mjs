import { rmSync, mkdirSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHmac } from 'node:crypto';
import puppeteer from 'puppeteer-core';
import { serve } from './unlock-serve.mjs';

const BUILD = process.argv[2];
const PROD = process.argv[3] || '';
if (!BUILD) { console.log('usage: node scripts/unlock-totp-check.mjs <beta build dir> [<production build dir>]'); process.exit(2); }
const PORT = 8092;
const ORIGIN = 'http://localhost:' + PORT;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const WORK = join(tmpdir(), 'unlock-totp-check');
const PROFILE = join(WORK, 'profile');
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const I18N = JSON.parse(readFileSync(join(REPO, 'src/_data/i18n/en.json'), 'utf8'));
const T = I18N.tool.totp;
const U = I18N.unlock;
const RUNTIME = '/assets/js/mentria-unlock.js';
const VAULT = 'mentria.store.totp.vault';
const RECORD = 'mentria.store.keyring.vault';
const LOCAL = 'mentria.keyring.local';
const PASS = 'totp pass 1234';
const BACKUP_PASS = 'totp backup 5678';
const ACCOUNTS = [
  { issuer: 'Check Mail', account: 'one@example.test', secret: 'JBSWY3DPEHPK3PXP' },
  { issuer: 'Check Bank', account: 'two@example.test', secret: 'KRSXG5CTMVRXEZLU' }
];
const AUTH = { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true };
const ONLY = process.env.ONLY || '';
const DAY = 24 * 60 * 60 * 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function assert(cond, msg, extra) {
  if (!cond) throw new Error(msg + (extra === undefined ? '' : ' ' + JSON.stringify(extra)));
}

function b32(s) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const out = [];
  let bits = 0;
  let value = 0;
  for (const c of s.toUpperCase()) {
    const v = A.indexOf(c);
    if (v < 0) continue;
    value = ((value << 5) | v) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function totp(secret, step) {
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(step / 0x100000000), 0);
  buf.writeUInt32BE(step >>> 0, 4);
  const h = createHmac('sha1', b32(secret)).update(buf).digest();
  const o = h[h.length - 1] & 15;
  const n = (((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1000000;
  return String(n).padStart(6, '0');
}

function nearCodes(secret) {
  const s = Math.floor(Date.now() / 30000);
  return [s - 1, s, s + 1].map((x) => totp(secret, x));
}

const WATCH = () => {
  window.__seen = { locked: false, card: false, setup: false, unlock: false };
  const look = () => {
    const l = document.getElementById('totp-locked');
    const open = !!l && !l.hidden;
    if (open) window.__seen.locked = true;
    const s = document.getElementById('totp-setup');
    if (open && s && !s.hidden) window.__seen.setup = true;
    const u = document.getElementById('totp-unlock');
    if (open && u && !u.hidden) window.__seen.unlock = true;
    if (document.querySelector('.m-unlock, .m-ulayer')) window.__seen.card = true;
  };
  new MutationObserver(look).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden'] });
};

const SIGNALS = () => {
  window.__signals = [];
  if (!window.PublicKeyCredential) return;
  const orig = PublicKeyCredential.signalUnknownCredential;
  PublicKeyCredential.signalUnknownCredential = function (opts) {
    window.__signals.push({ rpId: opts && opts.rpId, credentialId: opts && opts.credentialId });
    return typeof orig === 'function' ? orig.call(PublicKeyCredential, opts).catch(() => {}) : Promise.resolve();
  };
};

rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });
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

const checks = [];
const check = (name, fn) => checks.push([name, fn]);
let rigs = [];

async function rig(name, { authenticator = true } = {}) {
  const downloads = join(WORK, 'downloads', name.replace(/[^a-z0-9]+/gi, '-').toLowerCase());
  rmSync(downloads, { recursive: true, force: true });
  mkdirSync(downloads, { recursive: true });
  const context = await browser.createBrowserContext({ downloadBehavior: { policy: 'allow', downloadPath: downloads } });
  const r = { context, downloads, errors: [], dialogs: [], requests: [] };
  rigs.push(r);
  r.page = await addPage(r, authenticator);
  return r;
}

async function addPage(r, authenticator) {
  const page = await r.context.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  page.on('pageerror', (e) => r.errors.push(String((e && e.message) || e).slice(0, 300)));
  page.on('dialog', async (d) => {
    r.dialogs.push(d.type() + ': ' + d.message().slice(0, 200));
    try { await d.dismiss(); } catch (_) {}
  });
  page.on('request', (q) => r.requests.push(q.url()));
  if (authenticator) {
    const cdp = await page.createCDPSession();
    await cdp.send('WebAuthn.enable', { enableUI: false });
    const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: AUTH });
    page.__auth = { cdp, authenticatorId };
  }
  return page;
}

async function done(r) {
  assert(!r.dialogs.length, 'no native dialogs', r.dialogs);
  assert(!r.errors.length, 'no page errors', r.errors);
  await r.context.close();
  rigs = rigs.filter((x) => x !== r);
}

async function setSwitch(page, on) {
  if (!page.url().startsWith(ORIGIN)) await page.goto(ORIGIN + '/robots.txt', { waitUntil: 'load' });
  await page.evaluate((k, v) => {
    let l = {};
    try { l = JSON.parse(localStorage.getItem(k) || '{}') || {}; } catch (_) { l = {}; }
    l.enabled = v;
    localStorage.setItem(k, JSON.stringify(l));
  }, LOCAL, on);
}

async function openTotp(page, init) {
  if (init) await page.evaluateOnNewDocument(init);
  await page.goto(ORIGIN + '/tools/totp/', { waitUntil: 'load' });
  await settle(page);
}

async function settle(page) {
  await page.waitForFunction(() => {
    const l = document.getElementById('totp-locked');
    const v = document.getElementById('totp-vault');
    return (l && !l.hidden) || (v && !v.hidden);
  }, { timeout: 20000, polling: 50 });
  await sleep(250);
}

async function shown(page, sel) {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  }, sel);
}

async function until(fn, ms, what) {
  const end = Date.now() + ms;
  let v;
  while (Date.now() < end) {
    v = await fn();
    if (v) return v;
    await sleep(100);
  }
  v = await fn();
  assert(v, 'timed out waiting for ' + what);
  return v;
}

async function screen(page) {
  return page.evaluate(() => {
    const find = (id) => document.getElementById(id) || document.querySelector('.' + id.replace(/-h$/, '__h'));
    const vis = (id) => {
      const el = find(id);
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const text = (id) => { const el = find(id); return el ? el.textContent.trim() : null; };
    return {
      locked: vis('totp-locked'),
      vault: vis('totp-vault'),
      heading: vis('totp-locked-h'),
      lede: vis('totp-locked-lede') ? text('totp-locked-lede') : null,
      card: !!document.querySelector('#totp-ring-card .m-unlock') && vis('totp-ring-card'),
      setup: vis('totp-setup'),
      unlock: vis('totp-unlock'),
      prf: vis('totp-prf-btn'),
      linkNote: vis('totp-link-note') ? text('totp-link-note') : null,
      linkPanel: vis('totp-link-panel'),
      create: vis('totp-create'),
      autolock: vis('totp-autolock'),
      enrol: vis('totp-prf-enroll-btn'),
      rows: document.querySelectorAll('#totp-list .totp-row').length,
      layer: !!document.querySelector('.m-ulayer')
    };
  });
}

async function readJson(page, key) {
  return page.evaluate((k) => {
    const raw = localStorage.getItem(k);
    if (raw == null) return null;
    try { return JSON.parse(raw); } catch (_) { return { unparsable: raw }; }
  }, key);
}

async function readRaw(page, key) {
  return page.evaluate((k) => localStorage.getItem(k), key);
}

async function ringState(page) {
  return page.evaluate(async (u) => (await import(u)).state(), RUNTIME);
}

async function typeInto(page, sel, value) {
  await page.waitForSelector(sel, { visible: true, timeout: 20000 });
  await page.$eval(sel, (el) => {
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.type(sel, value);
}

async function press(page, sel) {
  await page.waitForSelector(sel, { visible: true, timeout: 20000 });
  for (let i = 0; ; i++) {
    try {
      await page.click(sel);
      return;
    } catch (e) {
      if (i > 20) throw e;
      await sleep(150);
    }
  }
}

async function waitRows(page, n) {
  await page.waitForFunction((k) => {
    const v = document.getElementById('totp-vault');
    if (!v || v.hidden) return false;
    const rows = [...document.querySelectorAll('#totp-list .totp-row')];
    return rows.length === k && rows.every((r) => /^\d{6}$/.test(r.querySelector('.totp-row__code').dataset.code || ''));
  }, { timeout: 20000, polling: 100 }, n);
}

async function expectCodes(page, accounts) {
  await waitRows(page, accounts.length);
  const rows = await page.evaluate(() => [...document.querySelectorAll('#totp-list .totp-row')].map((r) => ({
    issuer: r.querySelector('.totp-row__issuer').textContent.trim(),
    code: r.querySelector('.totp-row__code').dataset.code
  })));
  for (const a of accounts) {
    const row = rows.find((x) => x.issuer === a.issuer);
    assert(row && nearCodes(a.secret).includes(row.code), 'the code for ' + a.issuer + ' matches its secret', { rows });
  }
}

async function addAccount(page, a) {
  await press(page, '#totp-add-btn');
  await page.waitForSelector('#totp-add-modal:not([hidden])', { timeout: 10000 });
  await typeInto(page, '#totp-issuer', a.issuer);
  await typeInto(page, '#totp-account', a.account);
  await typeInto(page, '#totp-secret', a.secret);
  await press(page, '#totp-save-btn');
}

async function backupModal(page) {
  await page.waitForSelector('#totp-backup-modal:not([hidden])', { timeout: 15000 });
  await sleep(200);
  return page.evaluate(() => {
    const f = document.getElementById('totp-backup-pass').closest('label');
    const r = f ? f.getBoundingClientRect() : null;
    return {
      field: !!r && r.height > 0,
      lede: document.getElementById('totp-backup-lede').textContent.trim(),
      title: document.getElementById('totp-backup-title').textContent.trim()
    };
  });
}

async function closedBackup(page) {
  await page.waitForFunction(() => document.getElementById('totp-backup-modal').hidden, { timeout: 60000, polling: 100 });
}

async function waitFile(dir, prefix, timeout = 30000) {
  const end = Date.now() + timeout;
  let last = -1;
  while (Date.now() < end) {
    const names = readdirSync(dir);
    const hit = names.find((n) => n.startsWith(prefix) && n.endsWith('.json'));
    if (hit && !names.some((n) => n.endsWith('.crdownload'))) {
      const size = statSync(join(dir, hit)).size;
      if (size > 0 && size === last) return { name: hit, path: join(dir, hit), text: readFileSync(join(dir, hit), 'utf8') };
      last = size;
    }
    await sleep(200);
  }
  throw new Error('no download starting with ' + prefix);
}

function clearDownloads(dir) {
  for (const n of readdirSync(dir)) rmSync(join(dir, n), { force: true });
}

async function legacySetup(r, { passkey, accounts }) {
  const { page } = r;
  await setSwitch(page, false);
  await openTotp(page);
  const s0 = await screen(page);
  assert(s0.setup && !s0.unlock && s0.lede === T.locked_lede_setup, 'the old setup asks for a passphrase', s0);
  await typeInto(page, '#totp-setup-pass', PASS);
  await typeInto(page, '#totp-setup-pass2', PASS);
  await press(page, '#totp-setup-btn');
  await page.waitForFunction(() => !document.getElementById('totp-vault').hidden, { timeout: 20000 });
  if (passkey) {
    await press(page, '#totp-prf-enroll-btn');
    await until(async () => { const v = await readJson(page, VAULT); return v && v.prf; }, 30000, 'the old passkey enrolment');
  }
  for (let i = 0; i < accounts.length; i++) {
    await addAccount(page, accounts[i]);
    if (i === 0) {
      const m = await backupModal(page);
      assert(m.field && m.lede === T.backup_gate_lede, 'the old backup gate asks for a passphrase', m);
      await typeInto(page, '#totp-backup-pass', BACKUP_PASS);
      await press(page, '#totp-backup-confirm-btn');
      await closedBackup(page);
    }
    await waitRows(page, i + 1);
  }
  const vault = await readJson(page, VAULT);
  assert(vault && vault.v === 1 && vault.pass && vault.secrets && (!passkey || vault.prf), 'the old flow wrote a v1 vault', vault);
  return vault;
}

const KID = /^[A-Za-z0-9_-]{22}$/;

async function keptWithKid(page, before) {
  const now = await readRaw(page, VAULT);
  const old = JSON.parse(before);
  const got = JSON.parse(now);
  const kid = got.kid;
  delete got.kid;
  assert(JSON.stringify(got) === before && kid === old.pass.salt + '.' + old.pass.wrap, 'linking only adds the sync id; the old wraps are untouched', { kid, keys: Object.keys(got) });
  return now;
}

async function finishSetup(page) {
  await page.waitForSelector('.m-ulayer [data-step="intro"]', { timeout: 20000 });
  await press(page, '.m-ulayer [data-act="next"]');
  await page.waitForSelector('.m-ulayer [data-step="code"]', { timeout: 15000 });
  const code = await page.$eval('.m-ulayer .m-ucode', (el) => el.textContent.replace(/\s+/g, '').trim());
  await page.type('.m-ulayer input[name="code-check"]', code.slice(-4));
  await page.waitForFunction(() => !document.querySelector('.m-ulayer [data-act="next"]').disabled, { timeout: 10000 });
  await press(page, '.m-ulayer [data-act="next"]');
  await page.waitForFunction(() => {
    const el = document.querySelector('.m-ulayer [data-step]');
    return el && (el.dataset.step === 'passkey' || el.dataset.step === 'no-prf');
  }, { timeout: 30000 });
  const info = await page.evaluate(() => {
    const d = document.querySelector('.m-ulayer [role="dialog"]');
    const keep = d.querySelector('input[name="keep-pass"]');
    return { step: d.querySelector('[data-step]').dataset.step, keep: keep ? keep.checked : null };
  });
  await press(page, info.step === 'passkey' ? '.m-ulayer [data-act="skip-passkey"]' : '.m-ulayer [data-act="done"]');
  await page.waitForFunction(() => !document.querySelector('.m-ulayer'), { timeout: 30000 });
  return { code, keep: info.keep };
}

async function cardUnlock(page, root, { code, pass }) {
  await page.waitForSelector(root + ' .m-unlock', { visible: true, timeout: 20000 });
  const which = pass ? 'pass' : 'code';
  const input = root + (which === 'pass' ? ' input[name="passphrase"]' : ' input[name="recovery-code"]');
  const toggle = root + (which === 'pass' ? ' [data-act="show-pass"]' : ' [data-act="show-code"]');
  if (!(await shown(page, input)) && (await shown(page, toggle))) await page.click(toggle);
  await page.waitForFunction((s) => { const el = document.querySelector(s); return el && el.getBoundingClientRect().height > 0; }, { timeout: 10000 }, input);
  await typeInto(page, input, which === 'pass' ? pass : code);
  await page.keyboard.press('Enter');
}

async function makeKeyring(page) {
  return page.evaluate(async (u) => {
    const m = await import(u);
    const { code } = await m.create();
    m.confirmCode(code.slice(-4));
    return code;
  }, RUNTIME);
}

async function ringLock(page) {
  await page.evaluate(async (u) => { await (await import(u)).lock(); }, RUNTIME);
}

async function newLinkedVault(r) {
  const { page } = r;
  await setSwitch(page, true);
  await openTotp(page);
  const code = await makeKeyring(page);
  await until(async () => (await screen(page)).create, 10000, 'the create button with an open session');
  await press(page, '#totp-create-btn');
  await page.waitForFunction(() => !document.getElementById('totp-vault').hidden, { timeout: 20000 });
  return code;
}

async function switchOffFlow(prod) {
  const r = await rig(prod ? 'switch off prod' : 'switch off');
  const { page } = r;
  const vault = await legacySetup(r, { passkey: true, accounts: ACCOUNTS.slice(0, 1) });
  const file = await waitFile(r.downloads, 'mentria-totp-backup-');
  const env = JSON.parse(file.text);
  assert(env.kdf === 'PBKDF2' && (env.v === 1 || env.v === 2), 'the old backup is passphrase-protected', { v: env.v, kdf: env.kdf });
  const s1 = await screen(page);
  assert(s1.vault && s1.autolock && !s1.enrol && !s1.linkPanel, 'the old vault shows auto-lock, and enrol hides once a passkey exists', s1);
  await page.click('#totp-list .totp-row [data-export]');
  await page.waitForSelector('#totp-export-modal:not([hidden])', { timeout: 10000 });
  const gate = await page.evaluate(() => ({ gate: !document.getElementById('totp-export-gate').hidden, reveal: !document.getElementById('totp-export-reveal').hidden }));
  assert(gate.gate && !gate.reveal, 'export asks for the passphrase first', gate);
  await typeInto(page, '#totp-export-pass', PASS);
  await press(page, '#totp-export-show');
  await page.waitForFunction(() => !document.getElementById('totp-export-reveal').hidden, { timeout: 15000 });
  await press(page, '#totp-export-reveal [data-close]');
  await press(page, '#totp-lock-btn');
  const s2 = await screen(page);
  assert(s2.unlock && s2.prf && !s2.card && !s2.linkNote && s2.lede === T.locked_lede_unlock, 'Lock shows the old unlock with the passkey button', s2);
  await typeInto(page, '#totp-unlock-pass', PASS);
  await press(page, '#totp-unlock-btn');
  await expectCodes(page, ACCOUNTS.slice(0, 1));
  await page.evaluate(() => { window.__realNow = Date.now; const real = Date.now; Date.now = () => real() + 3600000; });
  await until(async () => (await screen(page)).unlock, 8000, 'auto-lock to fire on the old flow');
  await page.evaluate(() => { Date.now = window.__realNow; });
  await press(page, '#totp-prf-btn');
  await expectCodes(page, ACCOUNTS.slice(0, 1));
  if (prod) {
    assert(await page.evaluate(() => document.documentElement.dataset.release) === '', 'this is a production build');
    await page.evaluate(async () => {
      const c = await import('/assets/js/mentria-unlock-core.js');
      const { record } = await c.createRecord({ code: c.newRecoveryCode(), deviceId: 'dev-p', deviceName: 'Prod', app: '' });
      window.MentriaStore.set('keyring', 'vault', record);
    });
    await setSwitch(page, true);
  } else {
    await page.goto(ORIGIN + '/beta/unlock/', { waitUntil: 'load' });
    await setSwitch(page, true);
    await page.evaluate(async (u) => { const m = await import(u); await m.create(); }, RUNTIME);
    await setSwitch(page, false);
  }
  r.requests.length = 0;
  await openTotp(page);
  const s3 = await screen(page);
  assert(s3.unlock && !s3.card && !s3.linkNote && !s3.layer, prod ? 'a production page keeps the old unlock even with the switch and a keyring' : 'with a keyring present but the switch off, the old unlock stays', s3);
  await sleep(500);
  assert(!r.requests.some((u) => u.includes('/assets/js/mentria-unlock')), 'the switch-off page never loads the one unlock', r.requests.filter((u) => u.includes('unlock')));
  const after = await readJson(page, VAULT);
  assert(JSON.stringify(after) === JSON.stringify(vault), 'the vault is unchanged');
  await done(r);
}

check('switch off keeps the old flow', () => switchOffFlow(false));

check('switch off keeps the old flow on the production build', async () => {
  if (!PROD) throw new Error('SKIP no production build given');
  server.setRoot(PROD);
  try { await switchOffFlow(true); } finally { server.setRoot(BUILD); }
});

check('new vault with no keyring runs setup first', async () => {
  const r = await rig('setup first');
  const { page } = r;
  await setSwitch(page, true);
  await openTotp(page);
  const s0 = await screen(page);
  assert(s0.create && !s0.setup && !s0.unlock && !s0.card && s0.lede === T.create_lede, 'a new vault shows Create vault and no passphrase fields', s0);
  await press(page, '#totp-create-btn');
  const { code } = await finishSetup(page);
  await page.waitForFunction(() => !document.getElementById('totp-vault').hidden, { timeout: 20000 });
  const vault = await readJson(page, VAULT);
  const rec = await readJson(page, RECORD);
  const st = await ringState(page);
  assert(vault && JSON.stringify(Object.keys(vault).sort()) === '["kid","linked","secrets","v"]' && vault.v === 2 && vault.linked === true && KID.test(vault.kid), 'the vault is { v: 2, linked: true, kid, secrets }', vault);
  assert(rec && rec.services && rec.services.totp && st.linked.includes('totp') && st.unlocked && st.codeConfirmed, 'setup made the keyring and linked totp', st);
  const s1 = await screen(page);
  assert(s1.vault && !s1.autolock && !s1.enrol, 'linked vault hides auto-lock and the old passkey button', s1);
  await ringLock(page);
  await until(async () => (await screen(page)).card, 10000, 'the card after a lock');
  await cardUnlock(page, '#totp-ring-card', { code });
  await page.waitForFunction(() => !document.getElementById('totp-vault').hidden, { timeout: 20000 });
  await done(r);
});

check('setup Later falls back to the old passphrase setup', async () => {
  const r = await rig('setup later');
  const { page } = r;
  await setSwitch(page, true);
  await openTotp(page);
  await press(page, '#totp-create-btn');
  await page.waitForSelector('.m-ulayer [data-step="intro"]', { timeout: 20000 });
  await press(page, '.m-ulayer [data-act="not-now"]');
  await page.waitForFunction(() => !document.querySelector('.m-ulayer'), { timeout: 10000 });
  await until(async () => (await screen(page)).setup, 10000, 'the old setup after Later');
  const s = await screen(page);
  assert(s.setup && !s.create && s.lede === T.locked_lede_setup, 'Later shows the old passphrase setup', s);
  assert(await readRaw(page, RECORD) === null && await readRaw(page, VAULT) === null, 'Later writes nothing');
  await done(r);
});

check('new vault is linked and opens without a screen after reload', async () => {
  const r = await rig('new linked');
  const { page } = r;
  await setSwitch(page, true);
  await openTotp(page);
  await makeKeyring(page);
  await until(async () => (await screen(page)).create, 10000, 'the create button with an open session');
  const s0 = await screen(page);
  assert(!s0.setup && !s0.unlock && !s0.card, 'no passphrase fields with an open session', s0);
  await press(page, '#totp-create-btn');
  await page.waitForFunction(() => !document.getElementById('totp-vault').hidden, { timeout: 20000 });
  const vault = await readJson(page, VAULT);
  const st = await ringState(page);
  assert(vault && JSON.stringify(Object.keys(vault).sort()) === '["kid","linked","secrets","v"]' && vault.v === 2 && vault.linked === true && KID.test(vault.kid) && !vault.pass && !vault.prf, 'the new vault has a kid and no legacy wraps', vault);
  assert(st.linked.includes('totp'), 'totp is linked', st);
  const secretOk = await page.evaluate(async (u, v) => {
    const m = await import(u);
    const bytes = await m.secret('totp');
    const key = await crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['decrypt']);
    const d = (s) => { const t = s.replace(/-/g, '+').replace(/_/g, '/'); const b = atob(t + '='.repeat((4 - (t.length % 4)) % 4)); return Uint8Array.from(b, (c) => c.charCodeAt(0)); };
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: d(v.secrets.iv) }, key, d(v.secrets.ct));
    return { len: bytes.length, json: new TextDecoder().decode(pt) };
  }, RUNTIME, vault);
  assert(secretOk.len === 32 && secretOk.json === '[]', 'secret("totp") is the 32-byte master key', secretOk);
  await addAccount(page, ACCOUNTS[0]);
  const m = await backupModal(page);
  assert(!m.field && m.lede === T.backup_gate_lede_code, 'the backup gate is one click', m);
  await press(page, '#totp-backup-confirm-btn');
  await closedBackup(page);
  await expectCodes(page, ACCOUNTS.slice(0, 1));
  await page.evaluateOnNewDocument(WATCH);
  await page.reload({ waitUntil: 'load' });
  await settle(page);
  await expectCodes(page, ACCOUNTS.slice(0, 1));
  const seen = await page.evaluate(() => window.__seen);
  const st2 = await ringState(page);
  assert(!seen.locked && !seen.card && !seen.setup && !seen.unlock, 'the reload opened the vault without any screen', seen);
  assert(st2.unlocked && st2.launch === 'continue', 'the session continued', st2);
  await page.evaluate(() => { window.__realNow = Date.now; const real = Date.now; Date.now = () => real() + 3600000; });
  await sleep(3000);
  const s3 = await screen(page);
  await page.evaluate(() => { Date.now = window.__realNow; });
  assert(s3.vault && !s3.locked && !s3.autolock, 'auto-lock never fires on a linked vault', s3);
  await done(r);
});

check('locked shows card then codes', async () => {
  const r = await rig('locked card');
  const { page } = r;
  const code = await newLinkedVault(r);
  await addAccount(page, ACCOUNTS[0]);
  await backupModal(page);
  await press(page, '#totp-backup-confirm-btn');
  await closedBackup(page);
  await expectCodes(page, ACCOUNTS.slice(0, 1));
  await press(page, '#totp-lock-btn');
  await until(async () => (await screen(page)).card, 10000, 'the card after Lock');
  const s1 = await screen(page);
  const st1 = await ringState(page);
  assert(!s1.vault && !s1.heading && !s1.setup && !s1.unlock && !s1.create && s1.rows === 0, 'Lock shows only the card', s1);
  assert(!st1.unlocked, 'Lock locked the one unlock', st1);
  const toast = await page.evaluate(() => [...document.querySelectorAll('.m-toast')].map((t) => t.textContent.trim()).join('|'));
  assert(toast.includes(U.locked_toast), 'Lock says it locked everything', toast);
  await cardUnlock(page, '#totp-ring-card', { code: code.toLowerCase() });
  await expectCodes(page, ACCOUNTS.slice(0, 1));
  const other = await addPage(r, false);
  await other.goto(ORIGIN + '/about/', { waitUntil: 'load' });
  await ringLock(other);
  await until(async () => (await screen(page)).card, 10000, 'the card after a lock in another tab');
  assert((await screen(page)).rows === 0, 'a lock elsewhere drops the codes');
  await other.evaluate(async (u, c) => { await (await import(u)).unlockWithCode(c); }, RUNTIME, code);
  await expectCodes(page, ACCOUNTS.slice(0, 1));
  await other.close();
  await page.evaluateOnNewDocument(WATCH);
  await ringLock(page);
  await until(async () => (await screen(page)).card, 10000, 'the card');
  await page.reload({ waitUntil: 'load' });
  await settle(page);
  const s2 = await screen(page);
  assert(s2.card && !s2.unlock && !s2.setup, 'a locked reload shows the card', s2);
  await cardUnlock(page, '#totp-ring-card', { code });
  await expectCodes(page, ACCOUNTS.slice(0, 1));
  await done(r);
});

check('export reveals without asking', async () => {
  const r = await rig('export');
  const { page } = r;
  await newLinkedVault(r);
  await addAccount(page, ACCOUNTS[0]);
  await backupModal(page);
  await press(page, '#totp-backup-confirm-btn');
  await closedBackup(page);
  await waitRows(page, 1);
  for (const pass of [1, 2]) {
    await page.click('#totp-list .totp-row [data-export]');
    await page.waitForSelector('#totp-export-modal:not([hidden])', { timeout: 10000 });
    await page.waitForFunction(() => !document.getElementById('totp-export-reveal').hidden, { timeout: 5000 });
    const ex = await page.evaluate(() => ({
      gate: !document.getElementById('totp-export-gate').hidden,
      uri: document.getElementById('totp-export-uri').textContent,
      qr: document.getElementById('totp-export-qr').width > 1
    }));
    assert(!ex.gate && ex.qr && ex.uri.includes('secret=' + ACCOUNTS[0].secret), 'the secret shows at once (' + pass + ')', ex);
    await press(page, '#totp-export-reveal [data-close]');
    await page.waitForFunction(() => document.getElementById('totp-export-modal').hidden, { timeout: 5000 });
    if (pass === 1) {
      await page.reload({ waitUntil: 'load' });
      await settle(page);
      await waitRows(page, 1);
    }
  }
  await done(r);
});

check('backup gate downloads a v4 file that restores with the code', async () => {
  const r = await rig('backup v4');
  const { page } = r;
  const code = await newLinkedVault(r);
  clearDownloads(r.downloads);
  await addAccount(page, ACCOUNTS[0]);
  const m = await backupModal(page);
  assert(!m.field && m.title === T.backup_gate_title && m.lede === T.backup_gate_lede_code, 'the gate has no passphrase field', m);
  await press(page, '#totp-backup-confirm-btn');
  await closedBackup(page);
  await expectCodes(page, ACCOUNTS.slice(0, 1));
  const file = await waitFile(r.downloads, 'mentria-totp-backup-');
  const expected = await page.evaluate(() => window.MentriaBackup.backupName('mentria-totp-backup'));
  assert(file.name === expected && /^mentria-totp-backup-\d{4}-\d{2}-\d{2}\.json$/.test(file.name), 'the file name carries the date', { name: file.name, expected });
  const env = JSON.parse(file.text);
  const rec = await readJson(page, RECORD);
  assert(env.v === 4 && env.kdf === 'keyring-code' && env.kcv === rec.kcv && env.salt === rec.backup.salt, 'the file is a v4 envelope for this keyring', { v: env.v, kdf: env.kdf });
  await addAccount(page, ACCOUNTS[1]);
  await waitRows(page, 2);
  assert(!(await page.evaluate(() => !document.getElementById('totp-backup-modal').hidden)), 'only the first account asks for a backup');

  const dev = await rig('backup v4 restore', { authenticator: false });
  const p2 = dev.page;
  await setSwitch(p2, false);
  await openTotp(p2);
  const res = await p2.evaluate(async (text, name, good) => {
    window.mentriaConfirm = async () => { window.__asked = (window.__asked || 0) + 1; return true; };
    const B = window.MentriaBackup;
    const file = () => new File([text], name, { type: 'application/json' });
    let wrong = null;
    try { await B.readBackupFile(file(), 'AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA'); } catch (e) { wrong = B.restoreErrorCode(e); }
    const data = await B.readBackupFile(file(), good.toLowerCase());
    const keys = Object.keys(data.store).sort();
    const out = await B.applyRestore(data, { totpVault: 'totp?', keyringVault: 'keyring?', identityVault: 'identity?', replace: 'replace {areas}?', areas: {} });
    return { wrong, keys, out, asked: window.__asked || 0 };
  }, file.text, file.name, code);
  assert(res.wrong === 'pass', 'a wrong code fails as a wrong passphrase', res);
  assert(JSON.stringify(res.keys) === '["keyring.vault","totp.vault"]' && res.out.restored >= 2 && !res.asked, 'the file restores the vault and its keyring', res);
  await setSwitch(p2, true);
  await openTotp(p2);
  const s = await screen(p2);
  assert(s.card && !s.unlock && !s.setup, 'the restored vault asks with the card', s);
  await cardUnlock(p2, '#totp-ring-card', { code });
  await expectCodes(p2, ACCOUNTS.slice(0, 1));
  await done(dev);
  await done(r);
});

check('backup gate falls back to a passphrase without a backup key', async () => {
  const r = await rig('backup fallback');
  const { page } = r;
  await newLinkedVault(r);
  await page.evaluate(() => {
    const rec = window.MentriaStore.get('keyring', 'vault');
    delete rec.backup;
    window.MentriaStore.set('keyring', 'vault', rec);
  });
  assert(await page.evaluate(async (u) => (await (await import(u)).backupKey()) === null, RUNTIME), 'the record has no backup key');
  clearDownloads(r.downloads);
  await addAccount(page, ACCOUNTS[0]);
  const m0 = await backupModal(page);
  assert(!m0.field, 'the gate starts as one click', m0);
  await press(page, '#totp-backup-confirm-btn');
  await page.waitForFunction(() => document.getElementById('totp-backup-pass-field').getBoundingClientRect().height > 0, { timeout: 10000 });
  const m1 = await backupModal(page);
  assert(m1.field && m1.lede === T.backup_gate_lede, 'without a backup key the passphrase field comes back', m1);
  await typeInto(page, '#totp-backup-pass', BACKUP_PASS);
  await press(page, '#totp-backup-confirm-btn');
  await closedBackup(page);
  await expectCodes(page, ACCOUNTS.slice(0, 1));
  const file = await waitFile(r.downloads, 'mentria-totp-backup-');
  const env = JSON.parse(file.text);
  assert(env.kdf === 'PBKDF2', 'the fallback file is passphrase-protected', { v: env.v, kdf: env.kdf });
  const keys = await page.evaluate(async (e, p) => Object.keys((await window.MentriaBackup.decryptBackup(e, p)).store).sort(), env, BACKUP_PASS);
  assert(JSON.stringify(keys) === '["keyring.vault","totp.vault"]', 'the fallback file opens with its passphrase', keys);
  await done(r);
});

check('legacy vault from the old flow links after one old unlock', async () => {
  const r = await rig('legacy setup');
  const { page } = r;
  await legacySetup(r, { passkey: true, accounts: ACCOUNTS });
  const before = await readRaw(page, VAULT);
  await setSwitch(page, true);
  await openTotp(page);
  const s0 = await screen(page);
  assert(s0.unlock && s0.prf && s0.linkNote && s0.linkNote.includes(U.link_title) && s0.linkNote.includes(U.link_body) && !s0.card, 'the old unlock stays with the link line', s0);
  await typeInto(page, '#totp-unlock-pass', PASS);
  await press(page, '#totp-unlock-btn');
  const { code, keep } = await finishSetup(page);
  assert(keep === true, 'setup offers to keep the passphrase', { keep });
  await until(async () => (await ringState(page)).linked.includes('totp'), 10000, 'totp linked');
  const st = await ringState(page);
  assert(st.unlocked && st.hasPass && st.codeConfirmed, 'the keyring keeps the passphrase', st);
  const linkedRaw = await keptWithKid(page, before);
  const s1 = await screen(page);
  assert(s1.vault && !s1.autolock && !s1.enrol, 'the vault now behaves as linked', s1);
  await expectCodes(page, ACCOUNTS);
  await page.click('#totp-list .totp-row [data-export]');
  await page.waitForFunction(() => !document.getElementById('totp-export-reveal').hidden, { timeout: 5000 });
  await press(page, '#totp-export-reveal [data-close]');
  await page.evaluateOnNewDocument(WATCH);
  await page.reload({ waitUntil: 'load' });
  await settle(page);
  await expectCodes(page, ACCOUNTS);
  const seen = await page.evaluate(() => window.__seen);
  assert(!seen.locked && !seen.card, 'the reload opens without a screen', seen);
  await press(page, '#totp-lock-btn');
  await cardUnlock(page, '#totp-ring-card', { pass: PASS });
  await expectCodes(page, ACCOUNTS);
  await press(page, '#totp-lock-btn');
  await cardUnlock(page, '#totp-ring-card', { code });
  await expectCodes(page, ACCOUNTS);
  await setSwitch(page, false);
  await openTotp(page);
  const s2 = await screen(page);
  assert(s2.unlock && !s2.card, 'with the switch off the old unlock is back', s2);
  await typeInto(page, '#totp-unlock-pass', PASS);
  await press(page, '#totp-unlock-btn');
  await expectCodes(page, ACCOUNTS);
  assert(await readRaw(page, VAULT) === linkedRaw, 'the linked vault is still byte for byte the same');
  await done(r);
});

check('legacy unlock links into an open session', async () => {
  const r = await rig('legacy open session');
  const { page } = r;
  await legacySetup(r, { passkey: false, accounts: ACCOUNTS.slice(0, 1) });
  const before = await readRaw(page, VAULT);
  await setSwitch(page, true);
  await openTotp(page);
  await makeKeyring(page);
  await sleep(300);
  const s0 = await screen(page);
  assert(s0.unlock && s0.linkNote && !s0.card, 'the old unlock stays while totp is not linked', s0);
  await typeInto(page, '#totp-unlock-pass', PASS);
  await press(page, '#totp-unlock-btn');
  await until(async () => (await ringState(page)).linked.includes('totp'), 10000, 'totp linked');
  const s1 = await screen(page);
  assert(s1.vault && !s1.layer && !s1.linkPanel && !s1.autolock, 'it links without another screen', s1);
  await keptWithKid(page, before);
  await page.evaluateOnNewDocument(WATCH);
  await page.reload({ waitUntil: 'load' });
  await settle(page);
  await expectCodes(page, ACCOUNTS.slice(0, 1));
  assert(!(await page.evaluate(() => window.__seen.locked)), 'the reload opens without a screen');
  await done(r);
});

check('legacy passkey unlock with a locked keyring links after the card', async () => {
  const r = await rig('legacy locked ring');
  const { page } = r;
  await legacySetup(r, { passkey: true, accounts: ACCOUNTS.slice(0, 1) });
  const before = await readRaw(page, VAULT);
  await setSwitch(page, true);
  await openTotp(page);
  const code = await makeKeyring(page);
  await ringLock(page);
  await sleep(300);
  const s0 = await screen(page);
  assert(s0.unlock && s0.prf && s0.linkNote && !s0.card, 'the old unlock with its passkey button', s0);
  await press(page, '#totp-prf-btn');
  await until(async () => (await screen(page)).linkPanel, 15000, 'the link panel');
  const s1 = await screen(page);
  assert(s1.vault && s1.rows === 1 && s1.autolock, 'the vault opens the old way while the panel waits', s1);
  await cardUnlock(page, '#totp-link-panel', { code });
  await until(async () => (await ringState(page)).linked.includes('totp'), 10000, 'totp linked');
  await until(async () => !(await screen(page)).linkPanel, 10000, 'the panel to close');
  const s2 = await screen(page);
  assert(s2.vault && !s2.autolock, 'the vault switches to linked', s2);
  await keptWithKid(page, before);
  await page.reload({ waitUntil: 'load' });
  await settle(page);
  await expectCodes(page, ACCOUNTS.slice(0, 1));
  await done(r);
});

check('Later keeps the legacy vault working', async () => {
  const r = await rig('legacy later');
  const { page } = r;
  await legacySetup(r, { passkey: false, accounts: ACCOUNTS.slice(0, 1) });
  const before = await readRaw(page, VAULT);
  await setSwitch(page, true);
  await openTotp(page);
  await typeInto(page, '#totp-unlock-pass', PASS);
  await press(page, '#totp-unlock-btn');
  await page.waitForSelector('.m-ulayer [data-step="intro"]', { timeout: 20000 });
  await press(page, '.m-ulayer [data-act="not-now"]');
  await page.waitForFunction(() => !document.querySelector('.m-ulayer'), { timeout: 10000 });
  await expectCodes(page, ACCOUNTS.slice(0, 1));
  const s = await screen(page);
  assert(s.vault && s.autolock && s.enrol, 'the vault keeps today\'s tools', s);
  assert(await readRaw(page, RECORD) === null && await readRaw(page, VAULT) === before, 'Later writes nothing');
  await page.click('#totp-list .totp-row [data-export]');
  await page.waitForSelector('#totp-export-modal:not([hidden])', { timeout: 10000 });
  const gate = await page.evaluate(() => !document.getElementById('totp-export-gate').hidden);
  assert(gate, 'export still asks for the passphrase');
  await press(page, '#totp-export-gate [data-close]');
  await press(page, '#totp-lock-btn');
  const s2 = await screen(page);
  assert(s2.unlock && s2.linkNote && !s2.card, 'Lock shows the old unlock again', s2);
  await done(r);
});

check('retirement deletes the old wraps after the grace', async () => {
  const r = await rig('retire');
  const { page } = r;
  const legacy = await legacySetup(r, { passkey: true, accounts: ACCOUNTS.slice(0, 1) });
  await setSwitch(page, true);
  await openTotp(page);
  await makeKeyring(page);
  await typeInto(page, '#totp-unlock-pass', PASS);
  await press(page, '#totp-unlock-btn');
  await until(async () => (await ringState(page)).linked.includes('totp'), 10000, 'totp linked');
  await page.evaluateOnNewDocument(SIGNALS);
  await page.reload({ waitUntil: 'load' });
  await settle(page);
  await expectCodes(page, ACCOUNTS.slice(0, 1));
  await sleep(800);
  const early = await readJson(page, VAULT);
  const block = await page.evaluate(async (u) => (await import(u)).retirement('totp'), RUNTIME);
  assert(early.pass && early.prf && JSON.stringify(block.blockers) === '["too-recent"]', 'a fresh link keeps the old wraps', { block, keys: Object.keys(early) });
  assert(early.kid === legacy.pass.salt + '.' + legacy.pass.wrap, 'linking set the sync id from the pass wrap', { kid: early.kid });
  await page.evaluate((days) => {
    const rec = window.MentriaStore.get('keyring', 'vault');
    const at = new Date(Date.now() - days).toISOString();
    rec.services.totp.linked = at;
    window.MentriaStore.set('keyring', 'vault', rec);
  }, 31 * DAY);
  const ready = await page.evaluate(async (u) => (await import(u)).retirement('totp'), RUNTIME);
  assert(ready.ready, 'retirement is ready after the grace', ready);
  await page.reload({ waitUntil: 'load' });
  await settle(page);
  await expectCodes(page, ACCOUNTS.slice(0, 1));
  const vault = await until(async () => { const v = await readJson(page, VAULT); return v && !v.pass && !v.prf ? v : null; }, 10000, 'the old wraps to go');
  assert(JSON.stringify(Object.keys(vault).sort()) === '["kid","linked","secrets","v"]' && vault.v === 2 && vault.linked === true, 'the vault becomes a linked vault', vault);
  assert(vault.kid === legacy.pass.salt + '.' + legacy.pass.wrap && vault.kid === early.kid, 'the sync id survives retirement', { kid: vault.kid });
  assert(JSON.stringify(vault.secrets) === JSON.stringify(legacy.secrets), 'retirement keeps the encrypted accounts as they were');
  const rec = await readJson(page, RECORD);
  const signals = await until(async () => { const s = await page.evaluate(() => window.__signals); return s && s.length ? s : null; }, 5000, 'the old passkey signal');
  assert(rec.retired && rec.retired.totp, 'totp is marked retired', rec.retired);
  assert(signals.length === 1 && signals[0].rpId === 'localhost' && signals[0].credentialId === legacy.prf.cred_id, 'the old passkey is signalled unknown', signals);
  await page.reload({ waitUntil: 'load' });
  await settle(page);
  await expectCodes(page, ACCOUNTS.slice(0, 1));
  assert((await page.evaluate(() => window.__signals.length)) === 0, 'retirement runs once');
  await done(r);
});

check('a new vault reuses an existing totp link', async () => {
  const r = await rig('link reused', { authenticator: false });
  const { page } = r;
  await setSwitch(page, true);
  await openTotp(page);
  await makeKeyring(page);
  const known = await page.evaluate(async (u) => {
    const m = await import(u);
    const b = crypto.getRandomValues(new Uint8Array(32));
    await m.link('totp', b);
    return Array.from(b);
  }, RUNTIME);
  await until(async () => (await screen(page)).create, 10000, 'the create button');
  await press(page, '#totp-create-btn');
  await page.waitForFunction(() => !document.getElementById('totp-vault').hidden, { timeout: 20000 });
  const got = await page.evaluate(async (u, k) => {
    const m = await import(u);
    const now = Array.from(await m.secret('totp'));
    const v = JSON.parse(localStorage.getItem('mentria.store.totp.vault'));
    const key = await crypto.subtle.importKey('raw', new Uint8Array(k), { name: 'AES-GCM' }, false, ['decrypt']);
    const d = (s) => { const t = s.replace(/-/g, '+').replace(/_/g, '/'); const b = atob(t + '='.repeat((4 - (t.length % 4)) % 4)); return Uint8Array.from(b, (c) => c.charCodeAt(0)); };
    let json = null;
    try { json = new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: d(v.secrets.iv) }, key, d(v.secrets.ct))); } catch (_) {}
    return { same: JSON.stringify(now) === JSON.stringify(k), json };
  }, RUNTIME, known);
  assert(got.same && got.json === '[]', 'the vault uses the key already linked', got);
  await done(r);
});

check('a link that does not open the vault is never replaced', async () => {
  const r = await rig('link not replaced');
  const { page } = r;
  await legacySetup(r, { passkey: false, accounts: ACCOUNTS.slice(0, 1) });
  await setSwitch(page, true);
  await openTotp(page);
  await makeKeyring(page);
  await page.evaluate(async (u) => { await (await import(u)).link('totp', crypto.getRandomValues(new Uint8Array(32))); }, RUNTIME);
  const entry = (await readJson(page, RECORD)).services.totp;
  await openTotp(page);
  const s0 = await screen(page);
  assert(s0.unlock && !s0.linkNote && !s0.card, 'the old unlock stays when the link cannot open this vault', s0);
  await typeInto(page, '#totp-unlock-pass', PASS);
  await press(page, '#totp-unlock-btn');
  await expectCodes(page, ACCOUNTS.slice(0, 1));
  await sleep(800);
  const s1 = await screen(page);
  const after = (await readJson(page, RECORD)).services.totp;
  assert(JSON.stringify(after) === JSON.stringify(entry), 'the existing link is kept', { entry, after });
  assert(!(await readJson(page, VAULT)).kid, 'an unlinked vault gets no sync id');
  assert(s1.autolock && !s1.layer && !s1.linkPanel, 'the vault works as today', s1);
  await done(r);
});

check('a linked vault without its keyring says so', async () => {
  const r = await rig('missing keyring', { authenticator: false });
  const { page } = r;
  await setSwitch(page, true);
  await page.evaluate((k) => {
    localStorage.setItem(k, JSON.stringify({ v: 2, linked: true, secrets: { iv: 'AAAAAAAAAAAAAAAA', ct: 'AAAAAAAAAAAAAAAAAAAAAAAA' } }));
  }, VAULT);
  await openTotp(page);
  const s = await screen(page);
  assert(s.locked && s.lede === T.linked_missing && !s.setup && !s.unlock && !s.card && !s.create, 'the page says where the unlock is', s);
  await done(r);
});

check('the vault opens with an earlier link when another key is current', async () => {
  const r = await rig('prior link', { authenticator: false });
  const { page } = r;
  await newLinkedVault(r);
  await addAccount(page, ACCOUNTS[0]);
  await backupModal(page);
  await press(page, '#totp-backup-confirm-btn');
  await closedBackup(page);
  await expectCodes(page, ACCOUNTS.slice(0, 1));
  const first = (await readJson(page, RECORD)).services.totp;
  await page.evaluate(async (u) => { await (await import(u)).link('totp', crypto.getRandomValues(new Uint8Array(32))); }, RUNTIME);
  const moved = (await readJson(page, RECORD)).services.totp;
  assert(moved.id !== first.id && Array.isArray(moved.prior) && moved.prior.some((p) => p.id === first.id), 'another key is current and this vault\'s key is prior', { first: first.id, moved: moved.id });
  await page.evaluateOnNewDocument(WATCH);
  await page.reload({ waitUntil: 'load' });
  await settle(page);
  await expectCodes(page, ACCOUNTS.slice(0, 1));
  const seen = await page.evaluate(() => window.__seen);
  assert(!seen.locked && !seen.card, 'the vault opens without a screen', seen);
  assert(JSON.stringify((await readJson(page, RECORD)).services.totp) === JSON.stringify(moved), 'opening does not change the link');
  await done(r);
});

check('retirement keeps the old wraps when it cannot prove the key', async () => {
  const r = await rig('retire unproven');
  const { page } = r;
  await legacySetup(r, { passkey: false, accounts: ACCOUNTS.slice(0, 1) });
  await setSwitch(page, true);
  await openTotp(page);
  await makeKeyring(page);
  await page.evaluate(async (u, k, days) => {
    const m = await import(u);
    await m.link('totp', crypto.getRandomValues(new Uint8Array(32)));
    const v = JSON.parse(localStorage.getItem(k));
    delete v.secrets;
    localStorage.setItem(k, JSON.stringify(v));
    const rec = window.MentriaStore.get('keyring', 'vault');
    rec.services.totp.linked = new Date(Date.now() - days).toISOString();
    window.MentriaStore.set('keyring', 'vault', rec);
  }, RUNTIME, VAULT, 31 * DAY);
  const before = await readRaw(page, VAULT);
  assert((await page.evaluate(async (u) => (await import(u)).retirement('totp'), RUNTIME)).ready, 'retirement is ready');
  await openTotp(page);
  await sleep(1500);
  const after = await readJson(page, VAULT);
  assert(await readRaw(page, VAULT) === before && after.pass, 'the pass wrap stays when the stored accounts do not decrypt', Object.keys(after));
  assert(!((await readJson(page, RECORD)).retired || {}).totp, 'totp is not marked retired');
  await done(r);
});

check('the sync id is never written over a newer vault', async () => {
  const r = await rig('kid fresh', { authenticator: false });
  const { page } = r;
  await legacySetup(r, { passkey: false, accounts: ACCOUNTS.slice(0, 1) });
  await setSwitch(page, true);
  await openTotp(page);
  const code = await makeKeyring(page);
  await ringLock(page);
  await sleep(300);
  await typeInto(page, '#totp-unlock-pass', PASS);
  await press(page, '#totp-unlock-btn');
  await until(async () => (await screen(page)).linkPanel, 15000, 'the link panel');
  const newer = await page.evaluate((k) => {
    const v = JSON.parse(localStorage.getItem(k));
    v.note = 'written by another tab';
    const raw = JSON.stringify(v);
    localStorage.setItem(k, raw);
    return raw;
  }, VAULT);
  await cardUnlock(page, '#totp-link-panel', { code });
  await until(async () => (await ringState(page)).linked.includes('totp'), 10000, 'totp linked');
  await sleep(800);
  assert(await readRaw(page, VAULT) === newer, 'the newer vault is kept and gets no sync id from a stale copy');
  await done(r);
});

check('a stalled one unlock falls back to the old unlock', async () => {
  const r = await rig('stalled runtime', { authenticator: false });
  const { page } = r;
  await legacySetup(r, { passkey: false, accounts: ACCOUNTS.slice(0, 1) });
  await setSwitch(page, true);
  await openTotp(page);
  await makeKeyring(page);
  await page.setBypassServiceWorker(true);
  await page.setRequestInterception(true);
  const held = [];
  page.on('request', (q) => {
    if (q.isInterceptResolutionHandled()) return;
    if (q.url().includes('/assets/js/mentria-unlock')) { held.push(q.url()); return; }
    q.continue();
  });
  const t0 = Date.now();
  await page.goto(ORIGIN + '/tools/totp/', { waitUntil: 'load' });
  await until(async () => (await screen(page)).unlock, 12000, 'the old unlock after the wait');
  const waited = Date.now() - t0;
  assert(held.length > 0 && waited >= 4000, 'the page waited for the one unlock first', { held: held.length, waited });
  await typeInto(page, '#totp-unlock-pass', PASS);
  await press(page, '#totp-unlock-btn');
  await expectCodes(page, ACCOUNTS.slice(0, 1));
  await done(r);
});

check('a card that cannot load still says what to do', async () => {
  const r = await rig('card fails', { authenticator: false });
  const { page } = r;
  await newLinkedVault(r);
  await ringLock(page);
  await until(async () => (await screen(page)).card, 10000, 'the card');
  await page.setBypassServiceWorker(true);
  await page.setRequestInterception(true);
  page.on('request', (q) => {
    if (q.isInterceptResolutionHandled()) return;
    if (q.url().includes('/assets/js/unlock-copy.')) { q.abort(); return; }
    q.continue();
  });
  await page.reload({ waitUntil: 'load' });
  await until(async () => (await screen(page)).lede === T.linked_missing, 10000, 'the missing line');
  const s1 = await screen(page);
  assert(!s1.card && !s1.setup && !s1.unlock, 'no empty card and no old forms', s1);
  await page.evaluate((k) => localStorage.removeItem(k), VAULT);
  await page.reload({ waitUntil: 'load' });
  await until(async () => (await screen(page)).create, 10000, 'Create vault');
  await done(r);
});

check('a lock closes the backup gate', async () => {
  const r = await rig('lock closes gate', { authenticator: false });
  const { page } = r;
  const code = await newLinkedVault(r);
  await addAccount(page, ACCOUNTS[0]);
  await backupModal(page);
  await ringLock(page);
  await until(async () => (await screen(page)).card, 10000, 'the card');
  const st = await page.evaluate(() => ({ gate: !document.getElementById('totp-backup-modal').hidden, inert: !!document.getElementById('totp-ring-card').closest('[inert]') }));
  assert(!st.gate && !st.inert, 'the gate closes and the card can be used', st);
  await cardUnlock(page, '#totp-ring-card', { code });
  await page.waitForFunction(() => !document.getElementById('totp-vault').hidden, { timeout: 20000 });
  await sleep(500);
  assert((await screen(page)).rows === 0, 'the account that was never backed up is dropped');
  await done(r);
});

let failed = 0;
let ran = 0;
for (const [name, fn] of checks) {
  if (ONLY && !name.includes(ONLY)) continue;
  ran++;
  try {
    await fn();
    console.log('PASS ' + name);
  } catch (e) {
    if (String(e && e.message).startsWith('SKIP')) { ran--; console.log('SKIP ' + name + ': ' + e.message.slice(5)); continue; }
    failed++;
    console.log('FAIL ' + name + ': ' + String((e && e.message) || e).slice(0, 600));
    for (const x of rigs) {
      if (x.errors.length) console.log('  page errors: ' + JSON.stringify(x.errors.slice(0, 3)));
      try { await x.context.close(); } catch (_) {}
    }
    rigs = [];
  }
}
console.log((ran - failed) + '/' + ran + ' passed');
await browser.close();
await server.close();
rmSync(WORK, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
