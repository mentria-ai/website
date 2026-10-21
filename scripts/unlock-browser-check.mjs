import { rmSync, mkdirSync, readdirSync, statSync, readFileSync, realpathSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHmac } from 'node:crypto';
import puppeteer from 'puppeteer-core';
import { serve } from './unlock-serve.mjs';

export const PORT = Number(process.env.UNLOCK_PORT) || 8099;
export const ORIGIN = 'http://localhost:' + PORT;
export const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const PROFILE = join(tmpdir(), PORT === 8099 ? 'unlock-check-profile' : 'unlock-check-profile-' + PORT);
export const FIXTURES = join(tmpdir(), 'unlock-fixtures');
export const AUTHENTICATOR = { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true };
export const GROUPS = ['G2a', 'G2b', 'G2c', 'G3', 'G4', 'G4n', 'G5', 'G6', 'G6p', 'G9'];

export const CHOSEN = {
  identityPassphrase: 'correct horse 42',
  totpPassphrase: 'totp pass 1234',
  totpBackupPassphrase: 'totp backup 5678',
  financePassphrase: 'finance pass 12345',
  fullBackupPassphrase: 'full backup 24680',
  totpAccounts: [
    { issuer: 'Fixture Mail', account: 'one@example.test', secret: 'JBSWY3DPEHPK3PXP' },
    { issuer: 'Fixture Bank', account: 'two@example.test', secret: 'KRSXG5CTMVRXEZLU' }
  ],
  notes: {
    plain: { title: 'Fixture plain note', body: 'Plain body written by the legacy fixture.' },
    locked: { title: 'Fixture locked note', body: 'Locked body 7341 written by the legacy fixture.' }
  }
};

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EN = JSON.parse(readFileSync(join(REPO, 'src/_data/i18n/en.json'), 'utf8'));
const UK = EN.unlock;
const VAULT_IDENTITY = 'mentria.store.identity.vault';
const VAULT_TOTP = 'mentria.store.totp.vault';
const NOTES_BLOB = 'mentria.store.quick_notes.blob';
const COMMS_IDKEYS = 'mentria.store.comms.idkeys';
const RECORD = 'mentria.store.keyring.vault';
const RUNTIME = '/assets/js/mentria-unlock.js';
const CODE_SHAPE = /^[a-hj-km-np-z2-9]{5}(-[a-hj-km-np-z2-9]{5}){3}$/;
const FINANCE_CODE_SHAPE = /^[A-Z2-7]{4}(-[A-Z2-7]{4}){7}$/;
const KEYRING_CODE_SHAPE = /^[A-Z2-7]{4}(-[A-Z2-7]{4}){7}$/;
const DAY = 86400000;
const GRACE_WAIT_MS = 62000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rigs = new Map();

export function rigOf(page) {
  return rigs.get(page) || null;
}

export async function launch() {
  rmSync(PROFILE, { recursive: true, force: true });
  return puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    userDataDir: PROFILE,
    protocolTimeout: 600000,
    args: ['--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE localhost', '--no-first-run', '--no-default-browser-check']
  });
}

export async function openRig(browser, group) {
  const downloads = join(FIXTURES, group);
  rmSync(downloads, { recursive: true, force: true });
  mkdirSync(downloads, { recursive: true });
  const context = await browser.createBrowserContext({ downloadBehavior: { policy: 'allow', downloadPath: downloads } });
  const page = await context.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const cdp = await page.createCDPSession();
  await cdp.send('WebAuthn.enable', { enableUI: false });
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: AUTHENTICATOR });
  const rig = { group, context, page, cdp, authenticatorId, removedAuthenticatorIds: [], downloads, pageErrors: [], nativeDialogs: [] };
  page.on('pageerror', (e) => rig.pageErrors.push(String((e && e.message) || e).slice(0, 300)));
  page.on('dialog', async (d) => {
    rig.nativeDialogs.push(d.type() + ': ' + d.message().slice(0, 200));
    try { if (d.type() === 'beforeunload') await d.accept(); else await d.dismiss(); } catch (_) {}
  });
  rigs.set(page, rig);
  return rig;
}

const RETRY_CLICK = /not clickable|not an Element|bounding box|detached|Node is either not visible/i;

async function tapFresh(find, tries = 40) {
  for (let i = 0; ; i++) {
    const el = await find();
    try {
      await el.evaluate((e) => e.scrollIntoView({ block: 'center', inline: 'nearest' }));
      await el.click();
      return el;
    } catch (e) {
      if (i >= tries || !RETRY_CLICK.test(String(e && e.message))) throw e;
      await sleep(150);
    }
  }
}

async function tap(el) {
  return tapFresh(async () => el, 20);
}

async function shown(scope, sel, timeout = 20000) {
  return scope.waitForSelector(sel, { visible: true, timeout });
}

async function press(scope, sel, timeout) {
  return tapFresh(() => shown(scope, sel, timeout));
}

async function fill(scope, sel, text) {
  const el = await shown(scope, sel);
  await tap(el);
  await el.type(text);
  return el;
}

async function fillNew(scope, sel, text) {
  const el = await shown(scope, sel);
  await el.evaluate((n) => { n.value = ''; n.dispatchEvent(new Event('input', { bubbles: true })); });
  await tap(el);
  await el.type(text);
  return el;
}

async function pressText(scope, within, text, timeout = 20000, contains = false) {
  const find = async () => (await scope.waitForFunction((within, text, contains) => {
    const norm = (s) => s.replace(/\s+/g, ' ').trim();
    for (const b of document.querySelectorAll(within + ' button')) {
      if (b.disabled || !b.getClientRects().length) continue;
      const t = norm(b.textContent);
      if (contains ? t.includes(norm(text)) : t === norm(text)) return b;
    }
    return null;
  }, { timeout, polling: 100 }, within, text, contains)).asElement();
  return tapFresh(find);
}

async function pollUntil(read, test, timeout, what) {
  const end = Date.now() + timeout;
  let v;
  let err = null;
  while (Date.now() < end) {
    try {
      v = await read();
      err = null;
    } catch (e) {
      v = undefined;
      err = String((e && e.message) || e).split('\n')[0].slice(0, 200);
    }
    if (test(v)) return v;
    await sleep(150);
  }
  throw new Error('timed out waiting for ' + what + (v === undefined ? '' : ' (last: ' + JSON.stringify(v).slice(0, 300) + ')') + (err ? ' (last error: ' + err + ')' : ''));
}

const dialogOpen = (page) => page.evaluate(() => {
  const d = document.getElementById('m-dialog');
  return !!d && (d.matches(':popover-open') || d.hasAttribute('data-open'));
});

const dialogText = (page) => page.$eval('#m-dialog-msg', (e) => e.textContent.trim()).catch(() => '');

async function answerDialog(page, ok = true, timeout = 20000) {
  await pollUntil(() => dialogOpen(page), (v) => v, timeout, 'a dialog');
  const message = await dialogText(page);
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    try { await (await page.$(ok ? '#m-dialog-ok' : '#m-dialog-cancel')).click(); } catch (_) {}
    const t0 = Date.now();
    while (Date.now() - t0 < 800) {
      if (!(await dialogOpen(page)) || (await dialogText(page)) !== message) return message;
      await sleep(100);
    }
  }
  throw new Error('the dialog did not close: ' + message.slice(0, 120));
}

async function readJson(page, key) {
  return page.evaluate((k) => {
    const raw = localStorage.getItem(k);
    if (raw == null) return null;
    try { return JSON.parse(raw); } catch (_) { return { unparsable: true }; }
  }, key);
}

async function waitJson(page, key, test, timeout = 30000) {
  return pollUntil(() => readJson(page, key), test, timeout, key);
}

export async function storageSummary(page) {
  return page.evaluate(async () => {
    const localStorageKeys = Object.keys(localStorage).sort();
    let databases = [];
    try { databases = (await indexedDB.databases()).map((d) => d.name).sort(); } catch (_) {}
    let serviceWorkers = [];
    try { serviceWorkers = (await navigator.serviceWorker.getRegistrations()).map((r) => r.scope).sort(); } catch (_) {}
    let cacheNames = [];
    try { cacheNames = (await caches.keys()).sort(); } catch (_) {}
    return { localStorageKeys, databases, serviceWorkers, caches: cacheNames };
  });
}

async function financeState(page) {
  return page.evaluate(async () => {
    const names = (await indexedDB.databases()).map((d) => d.name);
    if (!names.includes('mentria-ext-finance')) return null;
    const db = await new Promise((ok, no) => { const r = indexedDB.open('mentria-ext-finance'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
    const store = (name) => db.transaction(name, 'readonly').objectStore(name);
    const req = (r) => new Promise((ok, no) => { r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
    const metaKeys = (await req(store('meta').getAllKeys())).map(String).sort();
    const wraps = (await req(store('meta').get('wraps'))) || {};
    const kcv = await req(store('meta').get('kcv'));
    const deviceId = await req(store('meta').get('device_id'));
    const linked = await req(store('meta').get('linked'));
    const pages = await req(store('pages').count());
    db.close();
    return {
      metaKeys,
      wrapKinds: Object.keys(wraps).filter((k) => wraps[k] != null && !(Array.isArray(wraps[k]) && !wraps[k].length)).sort(),
      hasPass: !!wraps.pass,
      hasRecovery: !!wraps.recovery,
      prfIds: Array.isArray(wraps.prf) ? wraps.prf.map((p) => p.id) : [],
      hasDevice: !!wraps.device,
      hasKcv: !!kcv,
      kcv: kcv || null,
      linked: linked === true,
      hasDeviceId: !!deviceId,
      pages
    };
  });
}

export async function credentials(rig) {
  if (!rig.authenticatorId) return [];
  const { credentials: list } = await rig.cdp.send('WebAuthn.getCredentials', { authenticatorId: rig.authenticatorId });
  return list.map((c) => ({ credentialId: c.credentialId, rpId: c.rpId, userHandle: c.userHandle, userName: c.userName, isResidentCredential: c.isResidentCredential, signCount: c.signCount }));
}

function b64uToStd(s) {
  const t = String(s).replace(/-/g, '+').replace(/_/g, '/');
  return t + '='.repeat((4 - (t.length % 4)) % 4);
}

function stdToB64u(s) {
  return String(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fields(obj) {
  return obj && typeof obj === 'object' ? Object.keys(obj).filter((k) => obj[k] != null).sort() : [];
}

async function waitFile(dir, prefix, timeout = 30000) {
  const end = Date.now() + timeout;
  let last = -1;
  while (Date.now() < end) {
    const names = readdirSync(dir);
    const hit = names.find((n) => n.startsWith(prefix) && n.endsWith('.json'));
    if (hit && !names.some((n) => n.endsWith('.crdownload'))) {
      const size = statSync(join(dir, hit)).size;
      if (size > 0 && size === last) return join(dir, hit);
      last = size;
    }
    await sleep(250);
  }
  throw new Error('no download starting with ' + prefix + ' in ' + dir);
}

async function commsOnboard(rig, name, failPasskey) {
  const { page, cdp } = rig;
  await page.goto(ORIGIN + '/comms/', { waitUntil: 'load' });
  await press(page, '#comms-onboard-start');
  await fill(page, '#comms-onboard-name', name);
  let removed = null;
  if (failPasskey) {
    removed = rig.authenticatorId;
    await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: removed });
    rig.authenticatorId = null;
    rig.removedAuthenticatorIds.push(removed);
  }
  await press(page, '#comms-onboard-create');
  await shown(page, '#comms-onboard-done', failPasskey ? 150000 : 30000);
  const recoveryCode = await page.$eval('#comms-onboard-code', (e) => e.textContent.trim());
  const fallbackOffered = await page.$eval('#comms-onboard-passkey', (e) => !e.hidden);
  if (!CODE_SHAPE.test(recoveryCode)) throw new Error('recovery code has an unexpected shape');
  await press(page, '#comms-onboard-continue');
  await shown(page, '#comms-id-on');
  await waitJson(page, COMMS_IDKEYS, (v) => !!v);
  if (failPasskey) {
    await page.goto('about:blank');
    rig.authenticatorId = (await cdp.send('WebAuthn.addVirtualAuthenticator', { options: AUTHENTICATOR })).authenticatorId;
    await page.goto(ORIGIN + '/comms/', { waitUntil: 'load' });
    await shown(page, '#comms-id-locked');
    if (await page.$eval('#comms-id-passkey', (e) => !e.hidden)) throw new Error('Comms offers a passkey unlock although none was enrolled');
  }
  const vault = await readJson(page, VAULT_IDENTITY);
  if (!vault || !vault.pass) throw new Error('identity vault has no pass wrap');
  if (failPasskey && vault.prf) throw new Error('identity vault has a prf wrap although enrolment was made to fail');
  if (!failPasskey && !(vault.prf && vault.prf.credId)) throw new Error('identity vault has no prf wrap after onboarding');
  return { recoveryCode, fallbackOffered, vault };
}

async function openAdvanced(page) {
  await page.waitForFunction(() => !!window.MentriaIdentity && !!window.MentriaBackup, { timeout: 20000 });
  await pollUntil(async () => {
    if (await page.$eval('#about-advanced', (d) => d.open)) return true;
    await page.$eval('#about-advanced > summary', (s) => s.click());
    await sleep(250);
    return page.$eval('#about-advanced', (d) => d.open);
  }, (v) => v, 10000, 'the advanced section to open');
}

async function aboutSetup(rig, pass, passkey) {
  const { page } = rig;
  await page.goto(ORIGIN + '/about/', { waitUntil: 'load' });
  await openAdvanced(page);
  await press(page, '[data-reveal="about-identity-setup-form"]');
  await fill(page, '#about-identity-setup-pass', pass);
  await fill(page, '#about-identity-setup-pass2', pass);
  await press(page, '#about-identity-setup-btn');
  const reminder = await answerDialog(page);
  await shown(page, '#about-identity-unlocked');
  let passkeyMessage = null;
  if (passkey) {
    await press(page, '#about-identity-passkey-add');
    passkeyMessage = await answerDialog(page, true, 60000);
  }
  const vault = await readJson(page, VAULT_IDENTITY);
  if (!vault || !vault.pass) throw new Error('About did not write an identity vault');
  if (passkey && !(vault.prf && vault.prf.credId)) throw new Error('About passkey enrolment left no prf wrap: ' + passkeyMessage);
  return { reminder, passkeyMessage, vault };
}

async function totpSetup(rig, { pass, passkey, accounts, backupPass }) {
  const { page } = rig;
  await page.goto(ORIGIN + '/tools/totp/', { waitUntil: 'load' });
  await fill(page, '#totp-setup-pass', pass);
  await fill(page, '#totp-setup-pass2', pass);
  await press(page, '#totp-setup-btn');
  await shown(page, '#totp-vault');
  let enrol = null;
  if (passkey) {
    await press(page, '#totp-prf-enroll-btn');
    const seen = await pollUntil(() => page.evaluate((k) => {
      let v = null;
      try { v = JSON.parse(localStorage.getItem(k) || 'null'); } catch (_) {}
      const s = document.getElementById('totp-status');
      return { prf: !!(v && v.prf), err: s && s.dataset.tone === 'err' ? s.textContent.trim() : null };
    }, VAULT_TOTP), (r) => r && (r.prf || r.err), 60000, 'the TOTP passkey enrolment');
    enrol = seen.prf ? 'ok' : seen.err;
  }
  let backupFile = null;
  for (let i = 0; i < accounts.length; i++) {
    const a = accounts[i];
    await press(page, '#totp-add-btn');
    await shown(page, '#totp-add-modal');
    await fill(page, '#totp-issuer', a.issuer);
    await fill(page, '#totp-account', a.account);
    await fill(page, '#totp-secret', a.secret);
    await press(page, '#totp-save-btn');
    if (i === 0) {
      await shown(page, '#totp-backup-modal');
      await fill(page, '#totp-backup-pass', backupPass);
      await press(page, '#totp-backup-confirm-btn');
      await page.waitForFunction(() => document.getElementById('totp-backup-modal').hidden, { timeout: 60000, polling: 150 });
      backupFile = await waitFile(rig.downloads, 'mentria-totp-backup-');
    } else {
      await page.waitForFunction(() => document.getElementById('totp-add-modal').hidden, { timeout: 20000, polling: 150 });
    }
    await page.waitForFunction((n) => document.querySelectorAll('#totp-list .totp-row').length === n, { timeout: 20000, polling: 150 }, i + 1);
  }
  const vault = await readJson(page, VAULT_TOTP);
  if (!vault || !vault.pass || !vault.secrets) throw new Error('TOTP vault is missing pass or secrets');
  if (passkey && !vault.prf) throw new Error('TOTP passkey enrolment right after setup failed: ' + enrol);
  let backupHeader = null;
  if (backupFile) {
    const env = JSON.parse(readFileSync(backupFile, 'utf8'));
    backupHeader = { v: env.v, kdf: env.kdf, iter: env.iter, fields: fields(env) };
  }
  return { enrol, vault, backupFile, backupHeader };
}

async function pickNote(page, title) {
  const tab = await page.waitForFunction((t) => [...document.querySelectorAll('#qn-note-list .qn-note-tab')].find((b) => b.querySelector('.qn-note-tab__title').textContent === t) || null, { timeout: 15000 }, title);
  await tap(tab.asElement());
  await page.waitForFunction((t) => document.getElementById('qn-title-input').value === t, { timeout: 10000 }, title);
}

async function notesSeed(rig, lockSecond) {
  const { page } = rig;
  const N = CHOSEN.notes;
  await page.goto(ORIGIN + '/tools/quick-notes/', { waitUntil: 'load' });
  await shown(page, '#qn-title-input');
  await page.waitForFunction(() => typeof window.mentriaConfirm === 'function', { timeout: 20000 });
  await fill(page, '#qn-title-input', N.plain.title);
  await fill(page, '#qn-textarea', N.plain.body);
  await waitJson(page, NOTES_BLOB, (v) => Array.isArray(v) && v.some((n) => n.title === N.plain.title && n.body === N.plain.body));
  if (lockSecond) {
    await press(page, '#qn-new-btn');
    await page.waitForFunction(() => document.getElementById('qn-title-input').value === '', { timeout: 5000 });
    await fill(page, '#qn-title-input', N.locked.title);
    await fill(page, '#qn-textarea', N.locked.body);
    await waitJson(page, NOTES_BLOB, (v) => Array.isArray(v) && v.some((n) => n.title === N.locked.title && n.body === N.locked.body));
    await press(page, '#qn-lock-btn');
    const confirm = await answerDialog(page);
    await waitJson(page, NOTES_BLOB, (v) => Array.isArray(v) && v.some((n) => n.title === N.locked.title && n.enc === true && n.iv && n.body !== N.locked.body), 60000);
    await page.reload({ waitUntil: 'load' });
    await pickNote(page, N.locked.title);
    await press(page, '#qn-unlock-btn');
    await page.waitForFunction((body) => document.getElementById('qn-textarea').value === body, { timeout: 30000 }, N.locked.body);
    return { confirmLock: confirm, reopenedAndDecrypted: true };
  }
  return {};
}

async function financeFrameOf(page, timeout = 60000) {
  const handle = await shown(page, '#xr-frame', timeout);
  await page.waitForFunction(() => {
    const f = document.getElementById('xr-frame');
    try { return !!(f && f.contentWindow && f.contentWindow.FIN_COPY && f.contentDocument.querySelector('.flock, #fin-main')); } catch (_) { return false; }
  }, { timeout, polling: 200 });
  await handle.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  const frame = await handle.contentFrame();
  const copy = (path) => frame.evaluate((p) => p.split('.').reduce((o, k) => (o == null ? o : o[k]), window.FIN_COPY), path);
  return { frame, copy };
}

async function financeFrame(page) {
  await page.goto(ORIGIN + '/extensions/finance/', { waitUntil: 'load' });
  return financeFrameOf(page);
}

async function financeSetup(rig, { pass, passkey, device }) {
  const { page } = rig;
  const { frame, copy } = await financeFrame(page);
  await pressText(frame, '.flock', await copy('setup.start'));
  await frame.waitForSelector('.flock input[type="password"]', { visible: true });
  const [p1, p2] = await frame.$$('.flock input[type="password"]');
  await p1.type(pass);
  await p2.type(pass);
  await pressText(frame, '.flock', await copy('common.next'));
  await frame.waitForSelector('.flock__code span', { visible: true });
  const recoveryCode = (await frame.$$eval('.flock__code span', (s) => s.map((x) => x.textContent.trim()))).join('-');
  if (!FINANCE_CODE_SHAPE.test(recoveryCode)) throw new Error('Finance recovery code has an unexpected shape');
  const check = await shown(frame, '.flock input[maxlength="9"]');
  await check.type(recoveryCode.split('-').pop());
  await pressText(frame, '.flock', await copy('common.next'));
  const finish = await copy('setup.finish');
  await frame.waitForFunction((text) => [...document.querySelectorAll('.flock button')].some((b) => b.textContent.trim() === text), { timeout: 10000 }, finish);
  const boxes = await frame.$$('.flock .fcheck input[type="checkbox"]');
  if (boxes.length !== 2) throw new Error('Finance setup shows ' + boxes.length + ' checkboxes, expected passkey and device unlock');
  const want = [passkey, device];
  for (let i = 0; i < 2; i++) {
    const on = await boxes[i].evaluate((b) => b.checked);
    if (on !== want[i]) await tap(boxes[i]);
  }
  await pressText(frame, '.flock', finish);
  await frame.waitForSelector('#fin-main', { timeout: 90000 });
  await page.waitForFunction(() => {
    const f = document.getElementById('xr-frame');
    try { return !f.contentDocument.querySelector('.flock'); } catch (_) { return false; }
  }, { timeout: 30000, polling: 200 });
  const state = await financeState(page);
  if (!state || !state.hasPass || !state.hasRecovery || !state.hasKcv) throw new Error('Finance meta is missing pass, recovery or kcv');
  if (passkey && state.prfIds.length !== 1) throw new Error('Finance has ' + state.prfIds.length + ' passkeys after setup, expected 1');
  if (state.hasDevice !== device) throw new Error('Finance device unlock is ' + state.hasDevice + ', expected ' + device);
  return { frame, copy, recoveryCode, state };
}

async function financeAddPasskey(rig, frame, copy) {
  const { page } = rig;
  const before = (await financeState(page)).prfIds.length;
  const nav = await frame.waitForFunction(() => [...document.querySelectorAll('.fin-nav [data-route="settings"]')].find((b) => b.getClientRects().length) || null, { timeout: 10000 });
  await tap(nav.asElement());
  await pressText(frame, '#fin-main', await copy('settings.add_passkey'), 20000);
  return pollUntil(() => financeState(page), (s) => s && s.prfIds.length === before + 1, 60000, 'the second Finance passkey');
}

async function financeReopen(rig, expectDevice) {
  const { page } = rig;
  const { frame } = await financeFrame(page);
  if (expectDevice) {
    await frame.waitForSelector('#fin-main', { timeout: 30000 });
    return 'device unlock opened Finance on reload';
  }
  await shown(frame, '#fin-pass', 20000);
  return 'unlock screen shown on reload';
}

function result(rig, extra) {
  return Object.assign({ group: rig.group, origin: ORIGIN, authenticatorId: rig.authenticatorId, removedAuthenticatorIds: rig.removedAuthenticatorIds.slice() }, extra);
}

async function finish(rig, out) {
  out.credentials = await credentials(rig);
  const onAuth = new Set(out.credentials.map((c) => c.credentialId));
  const legacyIds = Object.entries(out.legacy).filter(([k]) => /CredId$|PrfIds$/.test(k)).flatMap(([, v]) => (Array.isArray(v) ? v : [v]));
  const missing = legacyIds.filter((id) => !onAuth.has(id));
  if (missing.length) throw new Error(missing.length + ' legacy passkey id(s) are not on the virtual authenticator');
  out.storage = await storageSummary(rig.page);
  out.pageErrors = rig.pageErrors.slice();
  out.nativeDialogs = rig.nativeDialogs.slice();
  return out;
}

const SEEDERS = {
  async G2a(rig) {
    const c = await commsOnboard(rig, 'Fixture G2a', false);
    return result(rig, {
      secrets: { recoveryCode: c.recoveryCode },
      legacy: { identityVault: fields(c.vault), identityPrfCredId: b64uToStd(c.vault.prf.credId), fallbackOffered: c.fallbackOffered }
    });
  },
  async G2b(rig) {
    const c = await commsOnboard(rig, 'Fixture G2b', true);
    return result(rig, {
      secrets: { recoveryCode: c.recoveryCode },
      legacy: { identityVault: fields(c.vault), fallbackOffered: c.fallbackOffered, lockScreenOnReopen: true }
    });
  },
  async G2c(rig) {
    const c = await commsOnboard(rig, 'Fixture G2c', false);
    const { page } = rig;
    await page.goto(ORIGIN + '/about/', { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.MentriaIdentity, { timeout: 20000 });
    await press(page, '#about-identity-passkey-unlock', 20000);
    await shown(page, '#about-identity-unlocked', 60000);
    await press(page, '#about-identity-device');
    const vault = await waitJson(page, VAULT_IDENTITY, (v) => !!(v && v.device));
    await page.reload({ waitUntil: 'load' });
    await shown(page, '#about-identity-unlocked', 20000);
    return result(rig, {
      secrets: { recoveryCode: c.recoveryCode },
      legacy: { identityVault: fields(vault), identityPrfCredId: b64uToStd(vault.prf.credId), unlockedOnAboutWith: 'passkey', deviceUnlockOnReload: true }
    });
  },
  async G3(rig) {
    const pass = CHOSEN.identityPassphrase;
    const a = await aboutSetup(rig, pass, true);
    return result(rig, {
      secrets: { passphrase: pass },
      legacy: { identityVault: fields(a.vault), identityPrfCredId: b64uToStd(a.vault.prf.credId) },
      messages: { setupReminder: a.reminder, passkeyAdded: a.passkeyMessage }
    });
  },
  async G4(rig) {
    const t = await totpSetup(rig, { pass: CHOSEN.totpPassphrase, passkey: true, accounts: CHOSEN.totpAccounts, backupPass: CHOSEN.totpBackupPassphrase });
    return result(rig, {
      secrets: { passphrase: CHOSEN.totpPassphrase, backupPassphrase: CHOSEN.totpBackupPassphrase, accounts: CHOSEN.totpAccounts },
      legacy: { totpVault: fields(t.vault), totpPrfCredId: b64uToStd(t.vault.prf.cred_id), passkeyEnrol: t.enrol, accounts: 2 },
      files: { totpBackup: t.backupFile },
      backupHeaders: { totpBackup: t.backupHeader }
    });
  },
  async G4n(rig) {
    const accounts = CHOSEN.totpAccounts.slice(0, 1);
    const t = await totpSetup(rig, { pass: CHOSEN.totpPassphrase, passkey: false, accounts, backupPass: CHOSEN.totpBackupPassphrase });
    if (t.vault.prf) throw new Error('TOTP vault has a prf wrap in the passphrase-only group');
    return result(rig, {
      secrets: { passphrase: CHOSEN.totpPassphrase, backupPassphrase: CHOSEN.totpBackupPassphrase, accounts },
      legacy: { totpVault: fields(t.vault), accounts: 1 },
      files: { totpBackup: t.backupFile },
      backupHeaders: { totpBackup: t.backupHeader }
    });
  },
  async G5(rig) {
    const n = await notesSeed(rig, true);
    const blob = await readJson(rig.page, NOTES_BLOB);
    const credId = await readJson(rig.page, 'mentria.store.quick_notes.cred_id');
    const salt = await readJson(rig.page, 'mentria.store.quick_notes.salt');
    const locked = blob.filter((x) => x.enc);
    if (blob.length !== 2 || locked.length !== 1) throw new Error('Quick Notes holds ' + blob.length + ' notes and ' + locked.length + ' locked, expected 2 and 1');
    if (!credId || !salt) throw new Error('Quick Notes is missing cred_id or salt');
    return result(rig, {
      secrets: { notes: CHOSEN.notes },
      legacy: { notes: blob.length, lockedNotes: locked.length, lockedNoteFields: fields(locked[0]), notesCredId: credId, reopenedAndDecrypted: n.reopenedAndDecrypted },
      messages: { confirmLock: n.confirmLock }
    });
  },
  async G6(rig) {
    const f = await financeSetup(rig, { pass: CHOSEN.financePassphrase, passkey: true, device: true });
    const reopen = await financeReopen(rig, true);
    return result(rig, {
      secrets: { passphrase: CHOSEN.financePassphrase, recoveryCode: f.recoveryCode },
      legacy: { financeWraps: f.state.wrapKinds, financePrfIds: f.state.prfIds, deviceUnlock: f.state.hasDevice, metaKeys: f.state.metaKeys, reopen }
    });
  },
  async G6p(rig) {
    const f = await financeSetup(rig, { pass: CHOSEN.financePassphrase, passkey: true, device: false });
    const state = await financeAddPasskey(rig, f.frame, f.copy);
    if (state.prfIds.length !== 2) throw new Error('Finance has ' + state.prfIds.length + ' passkeys, expected 2');
    const reopen = await financeReopen(rig, false);
    return result(rig, {
      secrets: { passphrase: CHOSEN.financePassphrase, recoveryCode: f.recoveryCode },
      legacy: { financeWraps: state.wrapKinds, financePrfIds: state.prfIds, deviceUnlock: state.hasDevice, metaKeys: state.metaKeys, reopen }
    });
  },
  async G9(rig) {
    const { page } = rig;
    const accounts = CHOSEN.totpAccounts.slice(0, 1);
    const t = await totpSetup(rig, { pass: CHOSEN.totpPassphrase, passkey: false, accounts, backupPass: CHOSEN.totpBackupPassphrase });
    await notesSeed(rig, false);
    const blob = await readJson(page, NOTES_BLOB);
    const f = await financeSetup(rig, { pass: CHOSEN.financePassphrase, passkey: false, device: false });
    const a = await aboutSetup(rig, CHOSEN.identityPassphrase, false);
    await press(page, '[data-reveal="about-export-form"]');
    await fill(page, '#about-data-pass', CHOSEN.fullBackupPassphrase);
    await fill(page, '#about-data-pass2', CHOSEN.fullBackupPassphrase);
    await press(page, '#about-data-export-btn');
    await page.waitForFunction(() => ['ok', 'err'].includes(document.getElementById('about-data-export-status').dataset.tone), { timeout: 180000, polling: 250 });
    const tone = await page.$eval('#about-data-export-status', (e) => e.dataset.tone);
    if (tone !== 'ok') throw new Error('About export failed: ' + (await page.$eval('#about-data-export-status', (e) => e.textContent.trim())));
    const fullBackup = await waitFile(rig.downloads, 'mentria-backup-', 60000);
    const head = JSON.parse(readFileSync(fullBackup, 'utf8'));
    if (head.v !== 3) throw new Error('full backup header is v' + head.v + ', expected v3');
    return result(rig, {
      secrets: {
        totpPassphrase: CHOSEN.totpPassphrase, totpBackupPassphrase: CHOSEN.totpBackupPassphrase, totpAccounts: accounts,
        identityPassphrase: CHOSEN.identityPassphrase, financePassphrase: CHOSEN.financePassphrase, financeRecoveryCode: f.recoveryCode,
        fullBackupPassphrase: CHOSEN.fullBackupPassphrase, notes: { plain: CHOSEN.notes.plain }
      },
      legacy: { totpVault: fields(t.vault), identityVault: fields(a.vault), financeWraps: f.state.wrapKinds, notes: Array.isArray(blob) ? blob.length : 0 },
      files: { totpBackup: t.backupFile, fullBackup },
      backupHeaders: { totpBackup: t.backupHeader, fullBackup: { v: head.v, kdf: head.kdf, iter: head.iter, chunks: Array.isArray(head.ct) ? head.ct.length : 0, fields: fields(head) } }
    });
  }
};

export async function seed(page, group) {
  const rig = rigOf(page);
  if (!rig) throw new Error('page was not opened with openRig');
  if (!SEEDERS[group]) throw new Error('unknown group ' + group);
  const out = await SEEDERS[group](rig);
  return finish(rig, out);
}

const SHOWN_SECRETS = new Set(Object.values(CHOSEN).filter((v) => typeof v === 'string'));

function describeSecrets(secrets) {
  return Object.entries(secrets).map(([k, v]) => {
    if (typeof v === 'string') return k + (SHOWN_SECRETS.has(v) ? '="' + v + '"' : '=<captured, ' + v.length + ' chars>');
    return k + '=<chosen, see CHOSEN>';
  }).join(', ');
}

export function printSeeded(out, ms) {
  const lines = ['SEEDED ' + out.group + ' (' + (ms / 1000).toFixed(1) + ' s)'];
  lines.push('  localStorage: ' + (out.storage.localStorageKeys.join(', ') || '(none)'));
  lines.push('  indexedDB:    ' + (out.storage.databases.join(', ') || '(none)'));
  lines.push('  sw + caches:  ' + (out.storage.serviceWorkers.length ? out.storage.serviceWorkers.join(', ') : 'no worker') + '; ' + (out.storage.caches.join(', ') || 'no caches'));
  lines.push('  legacy:       ' + Object.entries(out.legacy).map(([k, v]) => k + '=' + (Array.isArray(v) ? '[' + v.join(' ') + ']' : v)).join('; '));
  lines.push('  passkeys:     ' + out.credentials.length + (out.credentials.length ? ' (' + out.credentials.map((c) => c.rpId + ' ' + (c.userName || '?')).join(', ') + ')' : '') + ' on authenticator ' + out.authenticatorId + (out.removedAuthenticatorIds.length ? ', removed ' + out.removedAuthenticatorIds.join(' ') : ''));
  lines.push('  secrets:      ' + describeSecrets(out.secrets));
  if (out.files) lines.push('  files:        ' + Object.entries(out.files).map(([k, v]) => k + '=' + v).join(', '));
  if (out.backupHeaders) lines.push('  headers:      ' + Object.entries(out.backupHeaders).map(([k, v]) => k + ' v' + v.v + ' ' + v.kdf + ' ' + v.iter).join(', '));
  if (out.pageErrors.length) lines.push('  page errors:  ' + out.pageErrors.length + ' (' + [...new Set(out.pageErrors)].slice(0, 3).join(' | ') + ')');
  if (out.nativeDialogs.length) lines.push('  NATIVE DIALOGS: ' + out.nativeDialogs.join(' | '));
  console.log(lines.join('\n'));
}

function assert(cond, msg, extra) {
  if (!cond) throw new Error(msg + (extra === undefined ? '' : ' ' + JSON.stringify(extra).slice(0, 600)));
}

const PROBE = () => {
  window.__signals = [];
  window.__wa = [];
  window.__screens = [];
  try {
    if (window.PublicKeyCredential) window.PublicKeyCredential.signalUnknownCredential = async (o) => { window.__signals.push({ rpId: o && o.rpId, credentialId: o && o.credentialId }); };
  } catch (_) {}
  try {
    const c = navigator.credentials;
    if (c) {
      const create = c.create.bind(c);
      const get = c.get.bind(c);
      c.create = (o) => { window.__wa.push('create'); return create(o); };
      c.get = (o) => { window.__wa.push('get'); return get(o); };
    }
  } catch (_) {}
  const SCREENS = ['.m-unlock', '.m-ulayer', '#about-identity-unlock', '#comms-id-locked', '#comms-onboard', '#totp-locked', '#qn-unlock-btn', '.flock'];
  const look = () => {
    for (const s of SCREENS) {
      if (window.__screens.includes(s)) continue;
      for (const el of document.querySelectorAll(s)) {
        if (!el.closest('[hidden]') && el.getClientRects().length) { window.__screens.push(s); break; }
      }
    }
  };
  new MutationObserver(look).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden'] });
};

async function snapshot(page) {
  return page.evaluate(async () => {
    const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); };
    const enc = (v) => {
      if (v === undefined) return { undef: true };
      if (v === null || typeof v !== 'object') return v;
      if (typeof CryptoKey === 'function' && v instanceof CryptoKey) return { cryptoKey: [v.type, v.algorithm && v.algorithm.name, v.extractable, v.usages.join(',')].join('|') };
      if (v instanceof ArrayBuffer) return { bytes: b64(new Uint8Array(v)) };
      if (ArrayBuffer.isView(v)) return { bytes: b64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
      if (typeof Blob === 'function' && v instanceof Blob) return { blob: v.size + '|' + v.type };
      if (v instanceof Date) return { date: v.toISOString() };
      if (Array.isArray(v)) return v.map(enc);
      const o = {};
      for (const k of Object.keys(v).sort()) o[k] = enc(v[k]);
      return o;
    };
    const ls = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      ls[k] = localStorage.getItem(k);
    }
    const idb = {};
    let names = [];
    try { names = (await indexedDB.databases()).map((d) => d.name); } catch (_) {}
    for (const name of names) {
      let db = null;
      try {
        db = await new Promise((ok, no) => { const r = indexedDB.open(name); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
      } catch (_) {
        idb[name] = 'unreadable';
        continue;
      }
      for (const s of Array.from(db.objectStoreNames)) {
        const got = await new Promise((ok, no) => {
          const st = db.transaction(s, 'readonly').objectStore(s);
          const rk = st.getAllKeys();
          const rv = st.getAll();
          rv.onsuccess = () => ok({ keys: rk.result, values: rv.result });
          rv.onerror = () => no(rv.error);
        });
        got.keys.forEach((k, i) => { idb[name + '/' + s + '/' + JSON.stringify(k)] = JSON.stringify(enc(got.values[i])); });
      }
      db.close();
    }
    return { ls, idb };
  });
}

function diffSnap(a, b) {
  const out = [];
  for (const [kind, A, B] of [['ls', a.ls, b.ls], ['idb', a.idb, b.idb]]) {
    for (const k of new Set([...Object.keys(A), ...Object.keys(B)])) {
      if (A[k] === B[k]) continue;
      out.push(kind + ':' + k + (A[k] === undefined ? ' added' : B[k] === undefined ? ' removed' : ' changed'));
    }
  }
  return out.sort();
}

const VOLATILE = [
  /^ls:mentria_seen /, /^ls:mentria_tool_usage /, /^ls:mentria_caps /,
  /^ls:mentria\.keyring\.(local|seen|epoch) /,
  /^ls:mentria\.(store|meta)\.extdata\.finance\.widget /,
  /^idb:mentria-push\//
];

function unexpected(changes, allowed) {
  return changes.filter((c) => !VOLATILE.some((r) => r.test(c)) && !allowed.some((r) => r.test(c)));
}

function J(v) { return v === undefined || v === null ? null : JSON.stringify(v); }
function parse(raw) { try { return raw == null ? null : JSON.parse(raw); } catch (_) { return null; } }

const LEGACY_OF = {
  identity(snap) {
    const v = parse(snap.ls[VAULT_IDENTITY]) || {};
    return { pass: J(v.pass), prf: J(v.prf), device: J(v.device), kcv: J(v.kcv), deviceWrap: snap.idb['mentria-identity/keys/"device-wrap"'] || null };
  },
  totp(snap) {
    const v = parse(snap.ls[VAULT_TOTP]) || {};
    return { pass: J(v.pass), prf: J(v.prf), secrets: J(v.secrets) };
  },
  notes(snap) {
    return {
      salt: snap.ls['mentria.store.quick_notes.salt'] || null,
      credId: snap.ls['mentria.store.quick_notes.cred_id'] || null,
      oldSalt: snap.ls['mentria-qn-salt'] || null,
      oldCred: snap.ls['mentria-qn-cred'] || null
    };
  },
  finance(snap) {
    const w = parse(snap.idb['mentria-ext-finance/meta/"wraps"']) || {};
    const prf = Array.isArray(w.prf) && w.prf.length ? w.prf : null;
    return { pass: J(w.pass), recovery: J(w.recovery), prf: J(prf), device: J(w.device), kcv: snap.idb['mentria-ext-finance/meta/"kcv"'] || null };
  }
};

const RETIRES = { identity: ['pass', 'prf', 'device', 'deviceWrap'], totp: ['pass', 'prf'], notes: ['salt', 'credId', 'oldSalt', 'oldCred'], finance: ['pass', 'recovery', 'prf', 'device'] };
const DEVICE_FIELDS = { identity: ['device', 'deviceWrap'], finance: ['device'] };

const LINK_ALLOWED = {
  common: [/^ls:mentria\.(store|meta)\.keyring\.vault added$/, /^idb:mentria-keyring\/session\/"current" added$/],
  remember: [/^idb:mentria-keyring\/keys\/"device" added$/],
  identity: [],
  identityHandover: [/^ls:mentria\.(store|meta)\.identity\.vault changed$/, /^idb:mentria-identity\/keys\/"device-wrap" removed$/],
  totp: [/^ls:mentria\.(store|meta)\.totp\.vault changed$/],
  notes: [/^ls:mentria\.(store|meta)\.quick_notes\.blob changed$/],
  finance: [/^idb:mentria-ext-finance\/meta\/"linked" added$/],
  financeHandover: [/^idb:mentria-ext-finance\/meta\/"wraps" changed$/]
};

function handedOver(G, name) {
  if (!DEVICE_FIELDS[name] || !G.rememberOn) return false;
  const was = LEGACY_OF[name](G.legacySnap);
  return DEVICE_FIELDS[name].some((k) => was[k] != null);
}

function assertLegacyKept(G, name, snap, when) {
  const was = LEGACY_OF[name](G.legacySnap);
  const is = LEGACY_OF[name](snap);
  const handed = handedOver(G, name);
  for (const k of Object.keys(was)) {
    if (was[k] == null) continue;
    if (handed && DEVICE_FIELDS[name].includes(k)) {
      assert(is[k] == null || is[k] === was[k], name + ' ' + k + ' is either kept as it was or gone after the hand-over to Remember this device (' + when + ')', { was: was[k].slice(0, 80), is: (is[k] || '').slice(0, 80) });
      continue;
    }
    assert(is[k] === was[k], name + ' ' + k + ' is unchanged ' + when, { was: was[k].slice(0, 80), is: (is[k] || '').slice(0, 80) });
  }
  return Object.keys(was).filter((k) => was[k] != null);
}

async function identityDeviceOpens(page) {
  return page.evaluate(async (vk) => {
    const v = JSON.parse(localStorage.getItem(vk) || 'null');
    if (!v || !v.device) return { device: false };
    const names = (await indexedDB.databases()).map((d) => d.name);
    if (!names.includes('mentria-identity')) return { device: true, key: false };
    const db = await new Promise((ok, no) => { const r = indexedDB.open('mentria-identity'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
    const key = await new Promise((ok, no) => { const r = db.transaction('keys', 'readonly').objectStore('keys').get('device-wrap'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
    db.close();
    if (!key) return { device: true, key: false };
    const unb = (x) => Uint8Array.from(atob(x.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (x.length % 4)) % 4)), (c) => c.charCodeAt(0));
    let secret;
    try {
      secret = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb(v.device.iv) }, key, unb(v.device.ct)));
    } catch (_) {
      return { device: true, key: true, opens: false };
    }
    const pre = new TextEncoder().encode('mentria-kcv-v1');
    const data = new Uint8Array(pre.length + secret.length);
    data.set(pre, 0);
    data.set(secret, pre.length);
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', data)).slice(0, 16);
    let t = '';
    for (const b of d) t += String.fromCharCode(b);
    secret.fill(0);
    return { device: true, key: true, opens: btoa(t).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') === v.kcv };
  }, VAULT_IDENTITY);
}

async function assertDeviceWrapWorks(G, when) {
  const was = LEGACY_OF.identity(G.legacySnap);
  if (!G.linked.includes('identity') || was.device == null) return null;
  const r = await identityDeviceOpens(G.rig.page);
  if (handedOver(G, 'identity') && !r.device) return 'identity device wrap handed over';
  assert(r.device && r.key && r.opens, 'the old identity device key still decrypts the vault\'s device wrap to the identity (kcv) ' + when, r);
  return 'the old identity device key still opens the identity';
}

function legacyPasskeyIds(name, snap) {
  if (name === 'identity') { const v = parse(snap.ls[VAULT_IDENTITY]); return v && v.prf && v.prf.credId ? [v.prf.credId] : []; }
  if (name === 'totp') { const v = parse(snap.ls[VAULT_TOTP]); return v && v.prf && v.prf.cred_id ? [v.prf.cred_id] : []; }
  if (name === 'notes') { const c = parse(snap.ls['mentria.store.quick_notes.cred_id']); return typeof c === 'string' && c ? [stdToB64u(c)] : []; }
  const w = parse(snap.idb['mentria-ext-finance/meta/"wraps"']) || {};
  return Array.isArray(w.prf) ? w.prf.map((p) => stdToB64u(p.id)) : [];
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

function totpCode(secret, step) {
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
  return [s - 1, s, s + 1].map((x) => totpCode(secret, x));
}

async function keyringState(scope) {
  return scope.evaluate(async (u) => {
    const m = await import(u);
    await m.ready();
    return Object.assign(m.state(), { diag: m.diagnostics() });
  }, RUNTIME);
}

async function retirementOf(scope, name, notesConverted) {
  return scope.evaluate(async (u, n, c) => {
    const m = await import(u);
    await m.ready();
    return m.retirement(n, c === undefined ? undefined : { notesConverted: c });
  }, RUNTIME, name, notesConverted);
}

async function probe(scope) {
  const p = await scope.evaluate(() => (Array.isArray(window.__screens) ? { screens: window.__screens.slice(), wa: window.__wa.slice(), signals: window.__signals.slice() } : null));
  assert(p, 'the page probe is installed');
  return p;
}

async function stepName(scope) {
  return scope.evaluate(() => {
    const el = document.querySelector('.m-ulayer [data-step]');
    return el ? el.dataset.step : null;
  });
}

async function waitStep(scope, name, timeout = 30000) {
  await pollUntil(() => stepName(scope), (s) => s === name, timeout, 'setup step ' + name);
}

async function sheetGone(scope, timeout = 90000) {
  await pollUntil(() => scope.evaluate(() => !document.querySelector('.m-ulayer')), (v) => v, timeout, 'the setup sheet to close');
}

async function setupLater(scope) {
  await waitStep(scope, 'intro', 60000);
  await press(scope, '.m-ulayer [data-act="not-now"]');
  await sheetGone(scope, 20000);
}

async function setupFinish(scope, { code, known, passkey, keepPass }) {
  await waitStep(scope, 'intro', 60000);
  await press(scope, '.m-ulayer [data-act="next"]');
  await waitStep(scope, 'code');
  const info = await scope.evaluate(() => {
    const on = (el) => !!el && !el.closest('[hidden]') && el.getClientRects().length > 0;
    const keep = document.querySelector('.m-ulayer input[name="code-choice"][value="keep"]');
    return { keep: keep ? keep.checked : null, check: on(document.querySelector('.m-ulayer input[name="code-check"]')), saved: on(document.querySelector('.m-ulayer input[name="saved-code"]')) };
  });
  let used;
  if (code === 'new') {
    assert(info.keep === null && info.check, 'the setup sheet shows a new code with its last-four check', info);
    used = await scope.$eval('.m-ulayer .m-ucode', (el) => el.textContent.replace(/\s+/g, ''));
    assert(KEYRING_CODE_SHAPE.test(used), 'the new recovery code has the keyring shape', used.length);
    await fillNew(scope, '.m-ulayer input[name="code-check"]', used.replace(/[^A-Z2-7]/g, '').slice(-4).toLowerCase());
  } else if (code === 'verify') {
    assert(info.keep === true && info.saved && !info.check, 'the setup sheet offers the saved code, asks for it, and needs no last-four check', info);
    await fillNew(scope, '.m-ulayer input[name="saved-code"]', known);
    used = known;
  } else {
    assert(info.keep === true && !info.saved && !info.check, 'the setup sheet preselects the code already typed, with no check', info);
    used = known;
  }
  await pollUntil(() => scope.$eval('.m-ulayer [data-act="next"]', (b) => !b.disabled), (v) => v, 10000, 'Next to be enabled');
  await press(scope, '.m-ulayer [data-act="next"]');
  await pollUntil(() => stepName(scope), (s) => s === 'passkey' || s === 'no-prf', 60000, 'the passkey step');
  const keep = await scope.evaluate(() => {
    const el = document.querySelector('.m-ulayer input[name="keep-pass"]');
    return el ? el.checked : null;
  });
  if (keepPass !== undefined) assert(keep === keepPass, 'keep my passphrase is ' + (keepPass === null ? 'not offered' : keepPass ? 'offered and checked' : 'offered and unchecked'), keep);
  await press(scope, passkey ? '.m-ulayer [data-act="add-passkey"]' : '.m-ulayer [data-act="skip-passkey"]');
  await sheetGone(scope);
  return used;
}

async function cardUnlock(scope, root, method, secret) {
  await shown(scope, root + ' .m-unlock', 30000);
  if (method === 'passkey') {
    await press(scope, root + ' [data-act="passkey"]');
    return;
  }
  const kind = method === 'pass' ? 'pass' : 'code';
  const input = root + ' input[name="' + (kind === 'pass' ? 'passphrase' : 'recovery-code') + '"]';
  const toggle = await scope.$(root + ' [data-act="show-' + kind + '"]');
  if (toggle && await toggle.evaluate((el) => el.getClientRects().length > 0 && el.getAttribute('aria-expanded') !== 'true')) await tap(toggle);
  const el = await fillNew(scope, input, secret);
  await el.evaluate((n) => n.form.requestSubmit());
}

async function identityOk(page) {
  return page.evaluate(async (vk, ik) => {
    const I = window.MentriaIdentity;
    if (!I || !I.isUnlocked()) return { open: false };
    const s = new Uint8Array(I.getSecret());
    const v = JSON.parse(localStorage.getItem(vk));
    const pre = new TextEncoder().encode('mentria-kcv-v1');
    const data = new Uint8Array(pre.length + s.length);
    data.set(pre, 0);
    data.set(s, pre.length);
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', data)).slice(0, 16);
    let t = '';
    for (const b of d) t += String.fromCharCode(b);
    const kcv = btoa(t).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') === (v && v.kcv);
    let idkeys = null;
    const raw = localStorage.getItem(ik);
    if (raw) {
      const w = JSON.parse(raw).wrapped;
      const unb = (x) => Uint8Array.from(atob(x.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (x.length % 4)) % 4)), (c) => c.charCodeAt(0));
      try {
        const key = await crypto.subtle.importKey('raw', s, { name: 'AES-GCM' }, false, ['decrypt']);
        await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb(w.iv) }, key, unb(w.ct));
        idkeys = true;
      } catch (_) { idkeys = false; }
    }
    return { open: true, kcv, idkeys };
  }, VAULT_IDENTITY, COMMS_IDKEYS);
}

const SVC = {
  about: {
    name: 'identity',
    path: '/about/',
    card: '#about-identity-card-slot',
    linkLine: '#about-identity-link',
    oldForms: ['#about-identity-unlock', '#about-identity-passkey-unlock'],
    async ready(rig) {
      await openAdvanced(rig.page);
      await pollUntil(() => rig.page.$eval('#about-identity-status', (e) => e.textContent.trim()), (t) => t && t !== '\u2014', 20000, 'the identity status');
    },
    async oldUnlock(rig, how, G) {
      const { page } = rig;
      if (how === 'pass') {
        await shown(page, '#about-identity-unlock', 20000);
        await fillNew(page, '#about-identity-unlock-pass', G.secret('identityPass'));
        await press(page, '#about-identity-unlock-btn');
      } else if (how === 'passkey') {
        await press(page, '#about-identity-passkey-unlock', 20000);
      } else {
        await pollUntil(() => identityOk(page), (r) => r && r.open, 30000, 'the old device key to open the identity');
        await press(page, '#about-identity-link-btn', 20000);
      }
    },
    async opened(rig) {
      const r = await pollUntil(() => identityOk(rig.page), (x) => x && x.open, 40000, 'the identity to open');
      assert(r.kcv, 'the open identity matches its vault', r);
      await shown(rig.page, '#about-identity-unlocked', 20000);
      return 'identity open, kcv matches the vault' + (r.idkeys === true ? ', Comms keys open with it' : '');
    }
  },
  comms: {
    name: 'identity',
    path: '/comms/',
    card: '#comms-id-card-slot',
    linkLine: '#comms-lock-link',
    oldForms: ['#comms-id-passkey', '#comms-lock-alt'],
    async ready(rig) {
      await pollUntil(() => rig.page.evaluate(() => ['comms-id-locked', 'comms-id-on', 'comms-onboard'].some((id) => { const el = document.getElementById(id); return el && !el.closest('[hidden]') && el.getClientRects().length; })), (v) => v, 30000, 'Comms to settle');
    },
    async oldUnlock(rig, how, G) {
      const { page } = rig;
      await shown(page, '#comms-id-locked', 30000);
      if (how === 'passkey') {
        await press(page, '#comms-id-passkey');
        return;
      }
      if (!(await page.$eval('#comms-lock-alt', (d) => d.open))) await press(page, '#comms-lock-alt > summary');
      await fillNew(page, '#comms-id-pass', G.secret('commsCode'));
      await press(page, '#comms-id-unlock');
    },
    async opened(rig, G) {
      const { page } = rig;
      await shown(page, '#comms-id-on', 40000);
      const fp = await pollUntil(() => page.$eval('#comms-id-fp', (e) => e.textContent.trim()), (t) => t && t.length > 3, 15000, 'the fingerprint');
      const r = await pollUntil(() => identityOk(page), (x) => x && x.open, 20000, 'the identity to open');
      assert(r.kcv && r.idkeys === true, 'the open identity matches its vault and opens the Comms keys', r);
      if (G.fp) assert(fp === G.fp, 'the same Comms identity as before', { before: G.fp, now: fp });
      G.fp = fp;
      return 'Comms identity open, fingerprint ' + fp.slice(0, 9) + '..., Comms keys open with it';
    }
  },
  totp: {
    name: 'totp',
    path: '/tools/totp/',
    card: '#totp-ring-card',
    linkLine: '#totp-link-note',
    oldForms: ['#totp-unlock', '#totp-setup'],
    async ready() {},
    async oldUnlock(rig, how, G) {
      const { page } = rig;
      await shown(page, '#totp-unlock', 30000);
      if (how === 'passkey') {
        await press(page, '#totp-prf-btn');
        return;
      }
      await fillNew(page, '#totp-unlock-pass', G.secret('totpPass'));
      await press(page, '#totp-unlock-btn');
    },
    async opened(rig, G) {
      const { page } = rig;
      const accounts = G.secret('totpAccounts');
      const rows = await pollUntil(() => page.evaluate(() => {
        const v = document.getElementById('totp-vault');
        if (!v || v.hidden) return null;
        return [...document.querySelectorAll('#totp-list .totp-row')].map((r) => ({ issuer: r.querySelector('.totp-row__issuer').textContent.trim(), code: r.querySelector('.totp-row__code').dataset.code || '' }));
      }), (r) => r && r.length === accounts.length && r.every((x) => /^\d{6}$/.test(x.code)), 40000, 'the TOTP codes');
      for (const a of accounts) {
        const row = rows.find((x) => x.issuer === a.issuer);
        assert(row && nearCodes(a.secret).includes(row.code), 'the code for ' + a.issuer + ' matches its secret', rows);
      }
      return accounts.length + ' TOTP code(s) match their secrets';
    }
  },
  notes: {
    name: 'notes',
    path: '/tools/quick-notes/',
    card: '#qn-locked-card',
    linkLine: '#qn-locked-link',
    oldForms: ['#qn-unlock-btn'],
    async ready(rig) {
      await rig.page.waitForFunction(() => typeof window.mentriaConfirm === 'function' && !!(document.getElementById('qn-tool') || {}).dataset && !!document.getElementById('qn-tool').dataset.lock, { timeout: 30000 });
    },
    async oldUnlock(rig) {
      const { page } = rig;
      await pickNote(page, CHOSEN.notes.locked.title);
      await press(page, '#qn-unlock-btn', 20000);
    },
    async opened(rig) {
      const { page } = rig;
      const want = CHOSEN.notes.locked.body;
      const now = await page.$eval('#qn-title-input', (e) => e.value);
      if (now !== CHOSEN.notes.locked.title) await pickNote(page, CHOSEN.notes.locked.title);
      await page.waitForFunction((b) => { const t = document.getElementById('qn-textarea'); return t && !t.hidden && t.getClientRects().length && t.value === b; }, { timeout: 40000, polling: 150 }, want);
      return 'the locked note opens with its text';
    }
  },
  finance: {
    name: 'finance',
    path: '/extensions/finance/',
    card: '.flock',
    linkLine: '.flock .fbanner--mint',
    oldForms: ['#fin-pass'],
    frame: true,
    async ready(rig) {
      rig.fin = await financeFrameOf(rig.page);
    },
    async oldUnlock(rig, how, G) {
      const { frame, copy } = rig.fin;
      if (how === 'pass') {
        const el = await fillNew(frame, '#fin-pass', G.secret('financePass'));
        await el.press('Enter');
      } else if (how === 'passkey') {
        await pressText(frame, '.flock', await copy('lock.passkey'), 20000, true);
      }
    },
    async opened(rig) {
      const { page } = rig;
      const { frame } = await financeFrameOf(page);
      rig.fin.frame = frame;
      await frame.waitForSelector('#fin-main', { timeout: 60000 });
      await frame.waitForFunction(() => !document.querySelector('.flock'), { timeout: 30000 });
      return 'the Finance ledger is open';
    }
  }
};

async function ledgerWraps(rig) {
  if (new URL(rig.page.url()).pathname !== SVC.finance.path) await visit(rig, SVC.finance);
  const { frame } = await financeFrameOf(rig.page);
  await frame.waitForSelector('#fin-main', { timeout: 60000 });
  return frame.evaluate(async (u) => {
    const V = await import('/assets/finance/vault.js');
    const E = await import('/assets/finance/engine.js');
    const L = await import('/assets/finance/oplog.js');
    const D = await import('/assets/finance/db.js');
    const M = await import(u);
    await M.ready();
    const list = await M.secrets('finance');
    let s = null;
    try { s = await V.openLinked(list); } finally { for (const x of list) x.bytes.fill(0); }
    const engine = new E.Engine({ root: s.root, keys: s.keys, deviceId: await D.getMeta('device_id') });
    await engine.load();
    const st = engine.state;
    return {
      pass: !!L.exists(st, 'vaultwrap', 'pass'),
      recovery: !!L.exists(st, 'vaultwrap', 'recovery'),
      passRemoved: !!L.removed(st, 'vaultwrap', 'pass'),
      recoveryRemoved: !!L.removed(st, 'vaultwrap', 'recovery')
    };
  }, RUNTIME);
}

function scopeOf(rig, svc) {
  return svc.frame ? rig.fin.frame : rig.page;
}

async function visit(rig, svc) {
  await rig.page.goto(ORIGIN + svc.path, { waitUntil: 'load' });
  await svc.ready(rig);
}

async function linkLineShown(rig, svc) {
  const scope = scopeOf(rig, svc);
  await pollUntil(() => scope.evaluate((sel, t) => {
    const el = document.querySelector(sel);
    return !!el && !el.closest('[hidden]') && el.getClientRects().length > 0 && el.textContent.replace(/\s+/g, ' ').includes(t);
  }, svc.linkLine, UK.link_title), (v) => v, 20000, 'the link line above the old unlock');
}

async function openedQuietly(rig, svc, G) {
  const note = await svc.opened(rig, G);
  const scope = scopeOf(rig, svc);
  await sleep(600);
  const top = await probe(rig.page);
  const inner = svc.frame ? await probe(scope) : { screens: [], wa: [] };
  const screens = [...top.screens, ...inner.screens];
  const wa = [...top.wa, ...inner.wa];
  assert(!screens.length && !wa.length, 'opened with no lock screen, card, sheet or passkey prompt', { screens, wa });
  return note;
}

function recordOf(page) {
  return readJson(page, RECORD);
}

async function writeRecord(rig, patch) {
  const { page } = rig;
  const others = (await rig.context.pages()).filter((p) => p !== page);
  assert(!others.length, 'no other page of this device is open while the record is edited', others.length);
  await page.goto(ORIGIN + '/robots.txt', { waitUntil: 'load' });
  const next = await page.evaluate((k, p) => {
    const rec = JSON.parse(localStorage.getItem(k));
    for (const [n, at] of Object.entries(p.linked || {})) rec.services[n].linked = at;
    for (const [id, d] of Object.entries(p.devices || {})) rec.devices[id] = Object.assign({}, rec.devices[id], d);
    localStorage.setItem(k, JSON.stringify(rec));
    return localStorage.getItem(k);
  }, RECORD, patch);
  return JSON.parse(next);
}

const PLANS = {
  G2a: { svc: 'comms', pages: ['comms', 'about'], chip: false, later: 'code', link: 'passkey', setup: { code: 'verify', known: 'commsCode', passkey: true, keepPass: null }, unlock: 'passkey' },
  G2b: { svc: 'comms', pages: ['comms', 'about'], chip: false, later: 'code', link: 'code', setup: { code: 'keep', known: 'commsCode', passkey: true, keepPass: null }, unlock: 'code' },
  G2c: { svc: 'about', pages: ['about', 'comms'], chip: false, later: 'device', link: 'device', setup: { code: 'new', passkey: true, keepPass: null }, unlock: 'passkey' },
  G3: { svc: 'about', chip: false, later: 'passkey', link: 'pass', setup: { code: 'new', passkey: false, keepPass: true }, unlock: 'pass', unlockSecret: 'identityPass' },
  G4: { svc: 'totp', chip: true, later: 'pass', link: 'passkey', setup: { code: 'new', passkey: true, keepPass: null }, unlock: 'passkey' },
  G4n: { svc: 'totp', chip: false, later: 'pass', link: 'pass', setup: { code: 'new', passkey: false, keepPass: true }, unlock: 'pass', unlockSecret: 'totpPass' },
  G5: { svc: 'notes', chip: false, later: 'tap', link: 'tap', setup: { code: 'new', passkey: false, keepPass: null }, unlock: 'code' },
  G6: { svc: 'finance', chip: true, later: 'device', link: 'device', setup: { code: 'verify', known: 'financeCode', passkey: false, keepPass: null }, unlock: 'device' },
  G6p: { svc: 'finance', chip: false, later: 'pass', link: 'passkey', setup: { code: 'verify', known: 'financeCode', passkey: false, keepPass: null }, unlock: 'code' },
  G9: {
    svc: 'about', chip: false, multi: true,
    laterOn: { svc: 'totp', how: 'pass' },
    link: 'pass', setup: { code: 'new', passkey: false, keepPass: true },
    alsoLink: [{ svc: 'totp', how: 'pass', locked: true }, { svc: 'finance', how: 'pass' }],
    unlock: 'pass', unlockSecret: 'identityPass'
  }
};

function secretsOf(out) {
  const s = out.secrets || {};
  return {
    commsCode: s.recoveryCode,
    identityPass: s.identityPassphrase || s.passphrase || CHOSEN.identityPassphrase,
    totpPass: s.totpPassphrase || (out.group.startsWith('G4') ? s.passphrase : CHOSEN.totpPassphrase),
    totpAccounts: s.totpAccounts || s.accounts || CHOSEN.totpAccounts,
    financePass: s.financePassphrase || (out.group.startsWith('G6') ? s.passphrase : CHOSEN.financePassphrase),
    financeCode: s.financeRecoveryCode || (out.group.startsWith('G6') ? s.recoveryCode : null)
  };
}

function groupServices(G) {
  if (G.plan.pages) return G.plan.pages.slice();
  const list = [G.plan.svc];
  if (G.plan.alsoLink) for (const x of G.plan.alsoLink) list.push(x.svc);
  return list;
}

async function step(G, name, fn, soft) {
  const t0 = Date.now();
  const secs = () => ((Date.now() - t0) / 1000).toFixed(1) + ' s';
  if (G.failed) {
    console.log('SKIP ' + G.g + ': ' + name + ' (needs "' + G.failed + '")');
    G.results.push({ name, status: 'SKIP' });
    return;
  }
  const errs0 = G.rig.pageErrors.length;
  const dialogs0 = G.rig.nativeDialogs.length;
  try {
    try { await G.rig.page.bringToFront(); } catch (_) {}
    const note = await fn();
    const dialogs = G.rig.nativeDialogs.slice(dialogs0);
    assert(!dialogs.length, 'no native dialogs', dialogs);
    const errs = [...new Set(G.rig.pageErrors.slice(errs0))];
    assert(!errs.length, 'no uncaught page errors', errs.slice(0, 3));
    console.log('PASS ' + G.g + ': ' + name + ' (' + secs() + ')' + (note ? '\n     ' + note : ''));
    G.results.push({ name, status: 'PASS', note });
  } catch (e) {
    if (!soft) G.failed = name;
    const where = String((e && e.stack) || '').split('\n').filter((l) => l.includes('unlock-browser-check')).slice(0, 3).map((l) => l.trim().replace(/^at /, '').replace(/\(?file:\/\/[^)]*\//, '').replace(/\)$/, '')).join(' < ');
    const errs = [...new Set(G.rig.pageErrors.slice(errs0))];
    console.log('FAIL ' + G.g + ': ' + name + ' (' + secs() + ')\n     ' + String((e && e.message) || e).split('\n')[0] + (where ? '\n     at ' + where : '') + (errs.length ? '\n     page errors: ' + errs.slice(0, 3).join(' | ') : ''));
    G.results.push({ name, status: 'FAIL', error: String((e && e.message) || e) });
  }
}

async function toNewBuild(G) {
  const { page } = G.rig;
  const legacyCaches = (G.out.storage.caches || []).filter((n) => n.startsWith('mentria-cache-'));
  if (!G.plan.chip) {
    await page.evaluate(async () => {
      for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
      for (const k of await caches.keys()) await caches.delete(k);
    });
    await page.goto(ORIGIN + '/robots.txt', { waitUntil: 'load' });
    const left = await storageSummary(page);
    assert(!left.serviceWorkers.length && !left.caches.length, 'the legacy worker and its caches are gone', left);
    G.baseSnap = await snapshot(page);
    return 'legacy worker unregistered and Cache Storage cleared; site data left alone';
  }
  const svc = SVC[G.plan.svc];
  G.baseSnap = await snapshot(page);
  await page.goto(ORIGIN + svc.path, { waitUntil: 'load' });
  const before = await page.evaluate(async () => ({ release: document.documentElement.dataset.release || '', controlled: !!navigator.serviceWorker.controller, caches: await caches.keys() }));
  assert(before.controlled && legacyCaches.length && legacyCaches.every((n) => before.caches.includes(n)), 'the legacy worker still controls the page', before);
  await pollUntil(() => page.evaluate(() => { const c = document.getElementById('m-update'); return !!c && !c.hidden && c.getClientRects().length > 0; }), (v) => v, 120000, 'the Update chip');
  const nav = page.waitForNavigation({ waitUntil: 'load', timeout: 60000 });
  await press(page, '#m-update-go');
  await nav;
  const after = await pollUntil(() => page.evaluate(async () => ({
    release: document.documentElement.dataset.release || '',
    controlled: !!navigator.serviceWorker.controller,
    caches: await caches.keys()
  })), (v) => v && v.release === 'beta' && v.controlled && !v.caches.some((n) => legacyCaches.includes(n)), 60000, 'the new worker to take over');
  return 'legacy worker served ' + svc.path + (before.release === 'beta' ? ' from the network (not precached)' : ' from its cache') + '; Update chip pressed: the page reloaded under the new worker (' + after.caches.filter((n) => n.startsWith('mentria-cache-')).join(', ') + '), legacy caches ' + legacyCaches.join(', ') + ' gone';
}

async function switchOn(G) {
  const { page } = G.rig;
  await page.goto(ORIGIN + '/beta/unlock/', { waitUntil: 'load' });
  await shown(page, '#unlock-switch');
  if (!(await page.$eval('#unlock-switch', (e) => e.checked))) await press(page, '#unlock-switch');
  await pollUntil(() => readJson(page, 'mentria.keyring.local'), (v) => v && v.enabled === true, 10000, 'the tester switch');
  assert(!(await readJson(page, RECORD)), 'no keyring before the first setup');
}

async function stepLater(G) {
  const { rig, plan } = G;
  const where = plan.laterOn || { svc: plan.svc, how: plan.later };
  const svc = SVC[where.svc];
  await visit(rig, svc);
  await sleep(800);
  const before = await snapshot(rig.page);
  G.legacySnap = before;
  if (where.how !== 'device') await linkLineShown(rig, svc);
  await svc.oldUnlock(rig, where.how, G);
  if (svc.name === 'finance') rig.fin = await financeFrameOf(rig.page);
  await setupLater(scopeOf(rig, svc));
  await svc.opened(rig, G);
  await sleep(1500);
  const after = await snapshot(rig.page);
  const changes = diffSnap(before, after);
  assert(!after.ls[RECORD] && !Object.keys(after.idb).some((k) => k.startsWith('mentria-keyring')), 'Later writes no keyring', changes);
  const bad = unexpected(changes, []);
  assert(!bad.length, 'Later leaves the stored data exactly as it was', bad);
  const since = diffSnap(G.baseSnap, after);
  const badSince = unexpected(since, []);
  assert(!badSince.length, 'nothing but the tester switch changed since the new build arrived', badSince);
  const st = await keyringState(rig.page);
  assert(st.enabled && !st.setUp, 'the switch is on and there is still no keyring', st);
  const seen = await probe(scopeOf(rig, svc));
  return 'old unlock (' + where.how + ') then Later: service opened the old way; ' + (changes.length ? 'only ' + changes.join(', ') + ' changed' : 'storage byte-identical') + '; since the new build arrived: ' + (since.length ? since.join(', ') : 'nothing') + ' (old screens seen: ' + seen.screens.join(' ') + ')';
}

async function stepLink(G) {
  const { rig, plan } = G;
  const svc = SVC[plan.svc];
  await visit(rig, svc);
  if (plan.link !== 'device') await linkLineShown(rig, svc);
  await svc.oldUnlock(rig, plan.link, G);
  if (svc.frame) rig.fin = await financeFrameOf(rig.page);
  const s = plan.setup;
  const used = await setupFinish(scopeOf(rig, svc), { code: s.code, known: s.known ? G.secret(s.known) : null, passkey: s.passkey, keepPass: s.keepPass });
  G.code = used;
  const note = await svc.opened(rig, G);
  const rec = await pollUntil(() => recordOf(rig.page), (r) => r && r.services && r.services[svc.name] && r.services[svc.name].ct, 30000, 'the ' + svc.name + ' link');
  const st = await keyringState(rig.page);
  assert(st.unlocked && st.codeConfirmed, 'the keyring is open and its recovery code confirmed', st);
  assert(st.passkeys === (s.passkey ? 1 : 0), 'the keyring has ' + (s.passkey ? 'one passkey' : 'no passkey'), st);
  assert(st.hasPass === (s.keepPass === true), 'the keyring ' + (s.keepPass ? 'kept the passphrase' : 'has no passphrase'), st);
  const linked = [svc.name];
  if (plan.alsoLink) {
    for (const x of plan.alsoLink) {
      const o = SVC[x.svc];
      if (x.locked) {
        await rig.page.evaluate(async (u) => { const m = await import(u); await m.ready(); await m.lock(); }, RUNTIME);
        assert(!(await keyringState(rig.page)).unlocked, 'the keyring is locked before the next old unlock');
      }
      await visit(rig, o);
      await linkLineShown(rig, o);
      await o.oldUnlock(rig, x.how, G);
      if (x.locked) {
        await o.opened(rig, G);
        await shown(rig.page, '#totp-link-panel #totp-link-card .m-unlock', 30000);
        assert(!(await recordOf(rig.page)).services[o.name], 'nothing is linked before the card unlocks');
        await cardUnlock(rig.page, '#totp-link-card', plan.unlock, G.secret(plan.unlockSecret));
        await pollUntil(() => rig.page.evaluate(() => document.getElementById('totp-link-panel').hidden), (v) => v, 30000, 'the link panel to close');
      }
      await o.opened(rig, G);
      await pollUntil(() => recordOf(rig.page), (r) => r && r.services && r.services[o.name] && r.services[o.name].ct, 30000, 'the ' + o.name + ' link');
      const sheet = await probe(scopeOf(rig, o));
      assert(!sheet.screens.includes('.m-ulayer'), 'the old unlock links with no setup sheet', sheet.screens);
      linked.push(o.name + (x.locked ? ' (keyring locked: old unlock, then the card)' : ' (keyring open: no sheet)'));
    }
  }
  G.linked = linked.map((n) => n.split(' ')[0]);
  G.linkNotes = linked;
  G.unlockSecret = plan.unlock === 'pass' ? G.secret(plan.unlockSecret) : G.code;
  const recNow = await recordOf(rig.page);
  return 'old unlock (' + plan.link + ') then setup (' + s.code + ' code' + (s.passkey ? ', keyring passkey' : '') + (s.keepPass ? ', passphrase kept' : '') + '); ' + note + '; linked: ' + G.linkNotes.join(', ') + '; record services: ' + Object.keys(recNow.services).sort().join(', ');
}

async function stepKept(G) {
  const { rig } = G;
  const st0 = await keyringState(rig.page);
  G.rememberOn = !!st0.hasDevice;
  const now = await snapshot(rig.page);
  const notes = [];
  for (const name of G.linked) {
    const kept = assertLegacyKept(G, name, now, 'after linking');
    notes.push(name + ': ' + kept.join(', ') + (handedOver(G, name) ? ' (device unlock handed to Remember this device)' : ''));
  }
  const dev = await assertDeviceWrapWorks(G, 'after linking');
  if (dev) notes.push(dev);
  if (G.linked.includes('totp')) {
    const v = parse(now.ls[VAULT_TOTP]);
    const w = parse(G.legacySnap.ls[VAULT_TOTP]);
    assert(J(Object.keys(v).sort()) === J(Object.keys(w).concat(['kid']).sort()), 'the TOTP vault gained only its sync id', { was: Object.keys(w), now: Object.keys(v) });
    assert(v.v === w.v && v.kid === w.pass.salt + '.' + w.pass.wrap, 'the TOTP sync id is the old pass id and the version is unchanged', { v: v.v, kid: v.kid && v.kid.length });
  }
  if (G.linked.includes('notes')) {
    const blob = parse(now.ls[NOTES_BLOB]) || [];
    const was = parse(G.legacySnap.ls[NOTES_BLOB]) || [];
    assert(blob.length === 2 && !blob.some((n) => n.enc && !n.kv) && blob.some((n) => n.enc && n.kv === 2 && n.body !== CHOSEN.notes.locked.body), 'the locked note moved to the notes key and stays encrypted', blob.map((n) => ({ t: n.title, enc: n.enc, kv: n.kv })));
    const plainWas = was.find((n) => !n.enc);
    const plainNow = blob.find((n) => !n.enc);
    assert(plainWas && J(plainNow) === J(plainWas), 'the plain note is byte-identical', { was: plainWas, now: plainNow });
    const lockedWas = was.find((n) => n.enc);
    const lockedNow = blob.find((n) => n.enc);
    assert(lockedNow.id === lockedWas.id && lockedNow.title === lockedWas.title && lockedNow.updatedAt === lockedWas.updatedAt + 1, 'the converted note keeps its id and title and moves updatedAt by one', { was: lockedWas.updatedAt, now: lockedNow.updatedAt });
    notes.push('notes: plain note identical, locked note re-sealed (kv 2, updatedAt + 1)');
  }
  if (G.linked.includes('finance')) {
    await visit(rig, SVC.finance);
    const fin = await financeState(rig.page);
    assert(fin.linked, 'the Finance meta is marked linked', fin);
    const l = await ledgerWraps(rig);
    assert(l.pass && l.recovery, 'the ledger still holds its synced passphrase and recovery wraps', l);
    G.ledgerHad = l;
    notes.push('finance ledger vaultwrap pass, recovery');
    if (parse(G.legacySnap.idb['mentria-ext-finance/meta/"wraps"']).device) {
      const st = await keyringState(rig.page);
      assert(st.hasDevice, 'Remember this device is on in the keyring', st);
    }
  }
  const changes = diffSnap(G.legacySnap, now);
  const allowed = LINK_ALLOWED.common.concat(G.rememberOn ? LINK_ALLOWED.remember : []);
  for (const n of G.linked) {
    allowed.push(...LINK_ALLOWED[n]);
    if (handedOver(G, n) && LINK_ALLOWED[n + 'Handover']) allowed.push(...LINK_ALLOWED[n + 'Handover']);
  }
  const bad = unexpected(changes, allowed);
  assert(!bad.length, 'linking writes nothing outside LINK_ALLOWED', bad);
  return 'legacy wraps kept: ' + notes.join('; ') + '\n     changed since the legacy state: ' + unexpected(changes, []).join(', ');
}

function deviceUnlocks(G) {
  const had = [];
  if (!G.legacySnap || !G.linked) return had;
  const id = parse(G.legacySnap.ls[VAULT_IDENTITY]);
  if (id && id.device && G.linked.includes('identity')) had.push('identity');
  const fw = parse(G.legacySnap.idb['mentria-ext-finance/meta/"wraps"']);
  if (fw && fw.device && G.linked.includes('finance')) had.push('finance');
  return had;
}

async function stepRemember(G) {
  const { rig } = G;
  const had = deviceUnlocks(G);
  const st = await keyringState(rig.page);
  let toggle = null;
  if (had.includes('identity')) {
    await visit(rig, SVC.about);
    toggle = await rig.page.evaluate(() => { const r = document.getElementById('about-identity-device-row'); return !!r && !r.closest('[hidden]') && r.getClientRects().length > 0; });
  }
  assert(st.hasDevice, 'the device unlock this person had on (' + had.join(', ') + ') carries over to Remember this device', { hasDevice: st.hasDevice, prf: st.prf, rememberToggleShownOnAbout: toggle });
  return had.join(', ') + ' device unlock became Remember this device';
}

async function stepReload(G) {
  const { rig } = G;
  const notes = [];
  for (const key of groupServices(G)) {
    const o = SVC[key];
    await visit(rig, o);
    await rig.page.reload({ waitUntil: 'load' });
    await o.ready(rig);
    notes.push(await openedQuietly(rig, o, G));
    const st = await keyringState(rig.page);
    assert(st.unlocked && st.diag.decision === 'continue', 'the session continues across the reload of ' + o.path, st.diag);
  }
  return notes.join('; ');
}

async function park(G) {
  const { rig } = G;
  await rig.page.goto('about:blank');
  const open = (await rig.context.pages()).map((p) => p.url());
  assert(open.length === 1 && open[0] === 'about:blank', 'no page of this device is open', open);
  G.parkedAt = Date.now();
}

async function stepRelock(G) {
  const { rig, plan } = G;
  const svc = SVC[plan.svc];
  const away = Date.now() - G.parkedAt;
  await visit(rig, svc);
  const st = await keyringState(rig.page);
  assert(st.diag.decision === 'reopen' && st.diag.marker && st.diag.seenAgeMs >= 60000, 'the page decides the app was reopened after the grace', st.diag);
  G.remembered = st.hasDevice;
  if (plan.unlock === 'device' || st.hasDevice) {
    assert(st.unlocked && st.hasDevice, 'the remembered device reopens the session by itself', st);
    const note = await openedQuietly(rig, svc, G);
    return 'all pages closed ' + (away / 1000).toFixed(0) + ' s: decision reopen (epoch ' + st.epoch + '), Remember this device opened it again with no screen; ' + note;
  }
  assert(!st.unlocked, 'the keyring is locked after the reopen', st);
  const scope = scopeOf(rig, svc);
  if (svc.name === 'notes') await pickNote(rig.page, CHOSEN.notes.locked.title);
  await shown(scope, svc.card + ' .m-unlock', 30000);
  const seen = await probe(scope);
  assert(seen.screens.includes('.m-unlock'), 'the page probe sees the card', seen.screens);
  return 'all pages closed ' + (away / 1000).toFixed(0) + ' s: decision reopen (seen ' + (st.diag.seenAgeMs / 1000).toFixed(0) + ' s ago), the card shows';
}

async function stepOneUnlock(G) {
  const { rig, plan } = G;
  const svc = SVC[plan.svc];
  if (plan.unlock !== 'device' && !G.remembered) {
    await cardUnlock(scopeOf(rig, svc), svc.card, plan.unlock, G.unlockSecret);
    await svc.opened(rig, G);
  }
  const visited = [];
  for (const key of groupServices(G)) {
    const o = SVC[key];
    await visit(rig, o);
    await openedQuietly(rig, o, G);
    visited.push(o.name + ' (' + o.path + ')');
  }
  return 'one unlock (' + (G.remembered ? 'device' : plan.unlock) + ') on ' + svc.path + ', then opened with no screen: ' + visited.join(', ');
}

async function openAll(G) {
  for (const key of groupServices(G)) {
    const o = SVC[key];
    await visit(G.rig, o);
    await o.opened(G.rig, G);
  }
}

async function stepOldDevice(G) {
  const { rig } = G;
  const at = new Date(Date.now() - 31 * DAY).toISOString();
  const seen = new Date(Date.now() - 5 * DAY).toISOString();
  const rec = await writeRecord(rig, { linked: Object.fromEntries(G.linked.map((n) => [n, at])), devices: { legacy: { name: '', lastSeen: seen, app: '', keyring: 0 } } });
  assert(G.linked.every((n) => rec.services[n].linked === at) && rec.devices.legacy.lastSeen === seen, 'the record holds the back-dated links and the old device', rec.devices);
  const before = await snapshot(rig.page);
  for (const n of G.linked) assertLegacyKept(G, n, before, 'from linking until the 31-day mark');
  await openAll(G);
  const dev = await assertDeviceWrapWorks(G, 'before retirement');
  await sleep(3000);
  const r = await recordOf(rig.page);
  assert(G.linked.every((n) => r.services[n].linked === at), 'the back-dated link times held', G.linked.map((n) => r.services[n].linked));
  assert(r.devices.legacy && r.devices.legacy.lastSeen === seen, 'the old device entry held', r.devices.legacy);
  const plans = {};
  for (const n of G.linked) {
    plans[n] = await retirementOf(rig.page, n, n === 'notes' ? true : undefined);
    assert(!plans[n].ready && plans[n].blockers.join() === 'old-device', n + ' waits only for the old device', plans[n]);
  }
  const after = await snapshot(rig.page);
  for (const n of G.linked) {
    const was = LEGACY_OF[n](before);
    const is = LEGACY_OF[n](after);
    assert(J(was) === J(is), n + ': nothing is deleted while an old device was seen 5 days ago', { was: Object.keys(was).filter((k) => was[k]), is: Object.keys(is).filter((k) => is[k]) });
  }
  assert(!r.retired || !G.linked.some((n) => r.retired[n]), 'nothing is marked retired', r.retired);
  const sig = await probe(rig.page);
  assert(!sig.signals.length, 'no passkey is signalled', sig.signals);
  return 'links back-dated 31 days, devices.legacy seen 5 days ago: blockers ' + G.linked.map((n) => n + '=[' + plans[n].blockers.join(',') + ']').join(' ') + '; old wraps kept and still the ones from link time' + (dev ? '; ' + dev : '');
}

const RETIRE_ALLOWED = {
  identity: [/^ls:mentria\.(store|meta)\.identity\.vault /, /^idb:mentria-identity\/keys\/"device-wrap" removed/],
  totp: [/^ls:mentria\.(store|meta)\.totp\.vault /],
  notes: [/^ls:mentria\.(store|meta)\.quick_notes\.(salt|cred_id) removed/, /^ls:mentria-qn-(salt|cred) removed/, /^ls:mentria-sync-tombstones /],
  finance: [/^idb:mentria-ext-finance\/meta\/"(wraps|seq)" changed/, /^idb:mentria-ext-finance\/pages\/"[^"]+" added/]
};

async function stepRetire(G) {
  const { rig } = G;
  const old = new Date(Date.now() - 31 * DAY).toISOString();
  await writeRecord(rig, { devices: { legacy: { lastSeen: old } } });
  const before = await snapshot(rig.page);
  const ids = {};
  for (const n of G.linked) ids[n] = legacyPasskeyIds(n, before);
  const signals = [];
  for (const key of groupServices(G)) {
    const o = SVC[key];
    await visit(rig, o);
    await o.opened(rig, G);
    await pollUntil(() => recordOf(rig.page), (r) => r && r.retired && r.retired[o.name], 30000, o.name + ' to be marked retired');
    await sleep(800);
    const p = await probe(o.frame ? rig.fin.frame : rig.page);
    signals.push(...p.signals);
  }
  const after = await snapshot(rig.page);
  G.retiredAt = (await recordOf(rig.page)).retired;
  const notes = [];
  for (const n of G.linked) {
    const was = LEGACY_OF[n](before);
    const is = LEGACY_OF[n](after);
    const gone = RETIRES[n].filter((k) => was[k] != null);
    const atLink = LEGACY_OF[n](G.legacySnap);
    const want = RETIRES[n].filter((k) => atLink[k] != null && !(handedOver(G, n) && DEVICE_FIELDS[n].includes(k) && was[k] == null));
    assert(want.length > 0 && J(gone) === J(want), n + ': the wraps deleted are exactly the legacy wraps present at link time', { gone, want });
    for (const k of RETIRES[n]) assert(is[k] == null, n + ' ' + k + ' is deleted', is);
    for (const k of Object.keys(was)) if (!RETIRES[n].includes(k)) assert(is[k] === was[k], n + ' ' + k + ' is kept', { was: was[k], is: is[k] });
    notes.push(n + ' deleted ' + (gone.join(', ') || 'nothing (no legacy wraps)'));
  }
  if (G.linked.includes('identity')) {
    const v = parse(after.ls[VAULT_IDENTITY]);
    const w = parse(before.ls[VAULT_IDENTITY]);
    assert(J(Object.keys(v).sort()) === J(['kcv', 'linked', 'v']) && v.v === 3 && v.linked === true && v.kcv === w.kcv, 'the identity vault keeps only its kcv', v);
  }
  if (G.linked.includes('totp')) {
    const v = parse(after.ls[VAULT_TOTP]);
    const w = parse(before.ls[VAULT_TOTP]);
    assert(J(Object.keys(v).sort()) === J(['kid', 'linked', 'secrets', 'v']) && J(v.secrets) === J(w.secrets) && v.kid === w.kid, 'the TOTP vault keeps its accounts and sync id', Object.keys(v));
  }
  if (G.linked.includes('notes')) assert(after.ls[NOTES_BLOB] === before.ls[NOTES_BLOB], 'the notes are untouched');
  if (G.linked.includes('finance')) {
    const l = await ledgerWraps(rig);
    assert(!l.pass && !l.recovery && l.passRemoved && l.recoveryRemoved, 'the ledger deletes its synced passphrase and recovery wraps', l);
    notes.push('finance ledger vaultwrap pass, recovery deleted');
  }
  const allowed = [/^ls:mentria\.(store|meta)\.keyring\.vault /].concat(...G.linked.map((n) => RETIRE_ALLOWED[n]));
  const changes = diffSnap(before, after);
  const bad = unexpected(changes, allowed);
  assert(!bad.length, 'retirement changes nothing else', bad);
  const want = Object.values(ids).flat().sort();
  const got = signals.map((s) => s.credentialId).sort();
  assert(J(want) === J(got) && signals.every((s) => s.rpId === 'localhost'), 'each old passkey is signalled unknown once', { want, got });
  const onAuth = (await credentials(rig)).map((c) => stdToB64u(c.credentialId));
  const ring = ((await recordOf(rig.page)).wraps.prf || []).map((e) => e && e.id).filter(Boolean);
  assert(got.every((id) => onAuth.includes(id)), 'every signalled id is a credential on this device\'s authenticator', { got, onAuth });
  assert(!got.some((id) => ring.includes(id)), 'no keyring passkey is signalled', { got, ring });
  for (const key of groupServices(G)) {
    const o = SVC[key];
    await visit(rig, o);
    await openedQuietly(rig, o, G);
    await sleep(1500);
    const again = await probe(scopeOf(rig, o));
    assert(!again.signals.length, 'retirement runs once (' + o.name + ')', again.signals);
    const r = await recordOf(rig.page);
    assert(r.retired[o.name] === G.retiredAt[o.name], 'the retirement date holds (' + o.name + ')', r.retired);
  }
  return notes.join('; ') + '; signalled ' + (got.length ? got.length + ' old passkey(s)' : 'no passkey (none existed)') + '; data still opens\n     changed: ' + unexpected(changes, []).join(', ');
}

async function stepAfterRetire(G) {
  const { rig, plan } = G;
  const svc = SVC[plan.svc];
  await rig.page.evaluate(async (u) => { const m = await import(u); await m.ready(); await m.lock(); }, RUNTIME);
  await visit(rig, svc);
  const scope = scopeOf(rig, svc);
  if (svc.name === 'notes') await pickNote(rig.page, CHOSEN.notes.locked.title);
  await shown(scope, svc.card + ' .m-unlock', 30000);
  const old = await scope.evaluate((list) => list.filter((sel) => { const el = document.querySelector(sel); return !!el && !el.closest('[hidden]') && el.getClientRects().length > 0; }), svc.oldForms);
  assert(!old.length, 'no old unlock is offered once the old locks are gone', old);
  const method = plan.unlock === 'device' ? 'code' : plan.unlock;
  await cardUnlock(scope, svc.card, method, method === 'pass' ? G.secret(plan.unlockSecret) : G.code);
  await svc.opened(rig, G);
  for (const key of groupServices(G)) {
    const o = SVC[key];
    await visit(rig, o);
    await openedQuietly(rig, o, G);
  }
  return 'Lock, then only the card on ' + svc.path + ' (no old unlock); ' + method + ' opened ' + groupServices(G).map((k) => SVC[k].path).join(', ');
}

async function freshDevice(browser, name) {
  const rig = await openRig(browser, name);
  await rig.page.evaluateOnNewDocument(PROBE);
  const G = { g: name, rig, results: [], failed: null, secret: (k) => ({ identityPass: CHOSEN.identityPassphrase, totpPass: CHOSEN.totpPassphrase, financePass: CHOSEN.financePassphrase, totpAccounts: CHOSEN.totpAccounts.slice(0, 1) })[k] };
  return G;
}

async function makeKeyring(G) {
  const { page } = G.rig;
  await page.goto(ORIGIN + '/beta/unlock/', { waitUntil: 'load' });
  await press(page, '#unlock-switch');
  await pollUntil(() => readJson(page, 'mentria.keyring.local'), (v) => v && v.enabled === true, 10000, 'the tester switch');
  await press(page, '#unlock-create');
  await shown(page, '#unlock-code', 30000);
  const code = await page.$eval('#unlock-code', (e) => e.textContent.trim());
  assert(KEYRING_CODE_SHAPE.test(code), 'the test keyring shows a recovery code', code.length);
  const rec = await recordOf(page);
  assert(rec && rec.kcv && !Object.keys(rec.services).length, 'a keyring with nothing linked', rec && Object.keys(rec.services));
  return rec;
}

async function aboutRestore(G, file, pass) {
  const { page } = G.rig;
  await page.goto(ORIGIN + '/about/', { waitUntil: 'load' });
  await openAdvanced(page);
  await press(page, '[data-reveal="about-import-form"]');
  const input = await page.$('#about-data-import-file');
  await input.uploadFile(file);
  await shown(page, '#about-data-import-pass', 15000);
  await fillNew(page, '#about-data-import-pass', pass);
  const nav = page.waitForNavigation({ waitUntil: 'load', timeout: 180000 });
  nav.catch(() => {});
  await press(page, '#about-data-import-btn');
  const asked = [];
  const end = Date.now() + 170000;
  let st = null;
  while (Date.now() < end) {
    if (await dialogOpen(page).catch(() => false)) {
      asked.push((await answerDialog(page)).slice(0, 60));
      continue;
    }
    st = await page.$eval('#about-data-import-status', (s) => ({ tone: s.dataset.tone || '', text: s.textContent.replace(/\s+/g, ' ').trim() })).catch(() => st);
    if (st && (st.tone === 'ok' || st.tone === 'err')) break;
    await sleep(200);
  }
  assert(st && st.tone === 'ok', 'the restore finished', st);
  await nav;
  return { status: st.text, asked };
}

async function restoreFull(browser, seededG9) {
  const G = await freshDevice(browser, 'G9-restore');
  await step(G, 'the v3 full backup restores on a device with a keyring', async () => {
    const rec0 = await makeKeyring(G);
    const r = await aboutRestore(G, seededG9.out.files.fullBackup, CHOSEN.fullBackupPassphrase);
    const { page } = G.rig;
    const rec1 = await recordOf(page);
    assert(rec1.kcv === rec0.kcv && rec1.id === rec0.id, 'the device keeps its own keyring', { before: rec0.kcv, after: rec1.kcv });
    const snap = await snapshot(page);
    assert(parse(snap.ls[VAULT_IDENTITY]) && parse(snap.ls[VAULT_IDENTITY]).pass, 'the identity vault is back', Object.keys(snap.ls));
    assert(parse(snap.ls[VAULT_TOTP]) && parse(snap.ls[VAULT_TOTP]).pass, 'the TOTP vault is back');
    const blob = parse(snap.ls[NOTES_BLOB]) || [];
    assert(blob.some((n) => n.title === CHOSEN.notes.plain.title && n.body === CHOSEN.notes.plain.body), 'the plain note is back', blob.map((n) => n.title));
    const fin = await financeState(page);
    assert(fin && fin.hasPass && fin.hasRecovery && fin.hasKcv, 'the Finance ledger is back', fin);
    const linked = [];
    for (const key of ['about', 'totp', 'finance']) {
      const o = SVC[key];
      await visit(G.rig, o);
      await linkLineShown(G.rig, o);
      await o.oldUnlock(G.rig, 'pass', G);
      await o.opened(G.rig, G);
      await pollUntil(() => recordOf(page), (x) => x && x.services && x.services[o.name], 30000, o.name + ' to link into this keyring');
      linked.push(o.name);
    }
    const rec2 = await recordOf(page);
    assert(rec2.kcv === rec0.kcv, 'still this device\'s keyring');
    await visit(G.rig, SVC.notes);
    await pickNote(page, CHOSEN.notes.plain.title);
    await page.waitForFunction((b) => document.getElementById('qn-textarea').value === b, { timeout: 15000 }, CHOSEN.notes.plain.body);
    return 'restored (' + r.status + '; asked: ' + (r.asked.join(' | ') || 'nothing') + '); identity, TOTP and Finance opened with their old passphrases and linked into this device\'s keyring (' + linked.join(', ') + '); the plain note reads back';
  });
  return G;
}

async function restoreTotp(browser, seededG9) {
  const G = await freshDevice(browser, 'G9-totp');
  await step(G, 'the TOTP-only backup restores on a device with a keyring', async () => {
    const rec0 = await makeKeyring(G);
    const env = JSON.parse(readFileSync(seededG9.out.files.totpBackup, 'utf8'));
    assert(env.v === 2, 'the TOTP-only file is the legacy v2 envelope', env.v);
    const r = await aboutRestore(G, seededG9.out.files.totpBackup, CHOSEN.totpBackupPassphrase);
    const { page } = G.rig;
    const rec1 = await recordOf(page);
    assert(rec1.kcv === rec0.kcv, 'the device keeps its own keyring');
    const v = await readJson(page, VAULT_TOTP);
    assert(v && v.pass && v.secrets, 'the TOTP vault is back', v && Object.keys(v));
    const o = SVC.totp;
    await visit(G.rig, o);
    await linkLineShown(G.rig, o);
    await o.oldUnlock(G.rig, 'pass', G);
    const note = await o.opened(G.rig, G);
    await pollUntil(() => recordOf(page), (x) => x && x.services && x.services.totp, 30000, 'TOTP to link into this keyring');
    await page.reload({ waitUntil: 'load' });
    await openedQuietly(G.rig, o, G);
    return 'restored (' + r.status + '; asked: ' + (r.asked.join(' | ') || 'nothing') + '); ' + note + '; linked into this device\'s keyring and reopens with no screen';
  });
  return G;
}

export async function migrate(browser, seeded) {
  const groups = seeded.map(({ rig, out }) => ({ g: out.group, rig, out, plan: PLANS[out.group], results: [], failed: null }));
  for (const G of groups) {
    const s = secretsOf(G.out);
    G.secret = (k) => s[k];
    await G.rig.page.evaluateOnNewDocument(PROBE);
  }
  for (const G of groups) {
    await step(G, G.plan.chip ? 'the new build arrives through the Update chip' : 'the new build replaces the legacy worker', () => toNewBuild(G));
    await step(G, 'the tester switch turns on', () => switchOn(G));
    await step(G, 'Later leaves everything exactly as before', () => stepLater(G));
    await step(G, 'one old unlock and setup link the service, and it opens', () => stepLink(G));
    await step(G, 'every legacy wrap is still present', () => stepKept(G));
    if (deviceUnlocks(G).length) await step(G, 'a device unlock the person had on carries over to Remember this device', () => stepRemember(G), true);
    await step(G, 'a reload opens without a screen', () => stepReload(G));
    if (!G.failed) await park(G);
  }
  const parked = groups.filter((G) => G.parkedAt);
  if (parked.length) {
    const wait = Math.max(0, GRACE_WAIT_MS - (Date.now() - Math.max(...parked.map((G) => G.parkedAt))));
    if (wait) console.log('     waiting ' + (wait / 1000).toFixed(0) + ' s with every page closed (grace 60 s)');
    await sleep(wait);
  }
  for (const G of groups) {
    await step(G, 'closing all pages and opening one after the grace relocks', () => stepRelock(G));
    await step(G, 'one unlock then opens every linked service', () => stepOneUnlock(G));
  }
  for (const G of groups) {
    await step(G, 'an old device seen 5 days ago keeps the old locks', () => stepOldDevice(G));
    await step(G, 'after 31 days the service deletes exactly its old locks', () => stepRetire(G));
    await step(G, 'after retirement the one unlock is the only lock and still opens everything', () => stepAfterRetire(G));
  }
  const extra = [];
  const g9 = groups.find((G) => G.g === 'G9');
  if (g9) {
    extra.push(await restoreFull(browser, g9));
    extra.push(await restoreTotp(browser, g9));
  }
  return groups.concat(extra);
}

async function main(argv) {
  const positional = argv.filter((a) => !a.startsWith('--'));
  const onlyArg = argv.find((a) => a.startsWith('--only='));
  const [newBuild, legacyBuild] = positional;
  if (!legacyBuild) {
    console.log('usage: node scripts/unlock-browser-check.mjs <new build|-> <legacy build> [--only=<group>[,<group>]]');
    process.exit(2);
  }
  const groups = onlyArg ? onlyArg.slice(7).split(',').filter(Boolean) : GROUPS;
  const unknown = groups.filter((g) => !GROUPS.includes(g));
  if (unknown.length) { console.log('unknown group: ' + unknown.join(', ') + ' (known: ' + GROUPS.join(', ') + ')'); process.exit(2); }
  const migrating = newBuild && newBuild !== '-';
  if (migrating && !existsSync(join(resolve(newBuild), 'beta', 'unlock', 'index.html'))) {
    console.log('the new build must be a beta build (RELEASE_TAG=beta): ' + resolve(newBuild));
    process.exit(2);
  }
  const server = serve(PORT);
  await server.ready;
  server.setRoot(resolve(legacyBuild));
  console.log('legacy build ' + resolve(legacyBuild) + ' on ' + ORIGIN);
  const browser = await launch();
  const seeded = [];
  let failed = 0;
  let checks = [];
  const t0 = Date.now();
  let seedMs = 0;
  let migrateMs = 0;
  try {
    for (const g of groups) {
      const s0 = Date.now();
      const rig = await openRig(browser, g);
      try {
        const out = await seed(rig.page, g);
        seeded.push({ rig, out });
        printSeeded(out, Date.now() - s0);
      } catch (e) {
        failed++;
        const where = String((e && e.stack) || '').split('\n').filter((l) => l.includes('unlock-browser-check')).slice(0, 2).map((l) => l.trim().replace(/^at /, '')).join(' < ');
        console.log('FAIL ' + g + ' (' + ((Date.now() - s0) / 1000).toFixed(1) + ' s)\n     ' + String((e && e.message) || e).split('\n')[0] + (where ? '\n     at ' + where : ''));
        if (rig.pageErrors.length) console.log('     page errors: ' + [...new Set(rig.pageErrors)].slice(0, 3).join(' | '));
      }
    }
    seedMs = Date.now() - t0;
    console.log(seeded.length + '/' + groups.length + ' groups seeded; fixture files under ' + FIXTURES);
    if (migrating && seeded.length) {
      server.setRoot(resolve(newBuild));
      console.log('migrate: new build ' + resolve(newBuild) + ' on ' + ORIGIN);
      const m0 = Date.now();
      const done = await migrate(browser, seeded);
      migrateMs = Date.now() - m0;
      checks = done.flatMap((G) => G.results.map((r) => Object.assign({ group: G.g }, r)));
    }
  } finally {
    await browser.close();
    await server.close();
    rmSync(PROFILE, { recursive: true, force: true });
  }
  if (checks.length) {
    const by = (s) => checks.filter((c) => c.status === s).length;
    console.log('seed: ' + seeded.length + '/' + groups.length + ' groups (' + (seedMs / 1000).toFixed(0) + ' s); migrate: ' + by('PASS') + ' passed, ' + by('FAIL') + ' failed, ' + by('SKIP') + ' skipped (' + (migrateMs / 1000).toFixed(0) + ' s); total ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s');
    for (const g of [...new Set(checks.map((c) => c.group))]) {
      const mine = checks.filter((c) => c.group === g);
      const bad = mine.filter((c) => c.status !== 'PASS');
      console.log('  ' + g + ': ' + (bad.length ? 'FAIL (' + bad.map((c) => c.status + ' ' + c.name).join('; ') + ')' : 'PASS (' + mine.length + ')'));
    }
    failed += by('FAIL') + by('SKIP');
  }
  if (failed) process.exit(1);
}

function isMain() {
  if (!process.argv[1]) return false;
  try { return import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href; } catch (_) { return false; }
}

if (isMain()) {
  await main(process.argv.slice(2));
}
