import { rmSync, mkdirSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';
import { serve } from './unlock-serve.mjs';

export const PORT = 8099;
export const ORIGIN = 'http://localhost:' + PORT;
export const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const PROFILE = join(tmpdir(), 'unlock-check-profile');
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

const VAULT_IDENTITY = 'mentria.store.identity.vault';
const VAULT_TOTP = 'mentria.store.totp.vault';
const NOTES_BLOB = 'mentria.store.quick_notes.blob';
const COMMS_IDKEYS = 'mentria.store.comms.idkeys';
const CODE_SHAPE = /^[a-hj-km-np-z2-9]{5}(-[a-hj-km-np-z2-9]{5}){3}$/;
const FINANCE_CODE_SHAPE = /^[A-Z2-7]{4}(-[A-Z2-7]{4}){7}$/;

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

const RETRY_CLICK = /not clickable|not an Element|bounding box|detached/i;

async function tapFresh(find, tries = 40) {
  for (let i = 0; ; i++) {
    const el = await find();
    try {
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

async function pressText(scope, within, text, timeout = 20000) {
  const find = async () => (await scope.waitForFunction((within, text) => {
    const norm = (s) => s.replace(/\s+/g, ' ').trim();
    for (const b of document.querySelectorAll(within + ' button')) {
      if (b.disabled || !b.getClientRects().length) continue;
      if (norm(b.textContent) === norm(text)) return b;
    }
    return null;
  }, { timeout, polling: 100 }, within, text)).asElement();
  return tapFresh(find);
}

async function pollUntil(read, test, timeout, what) {
  const end = Date.now() + timeout;
  let v;
  while (Date.now() < end) {
    v = await read();
    if (test(v)) return v;
    await sleep(150);
  }
  throw new Error('timed out waiting for ' + what);
}

const dialogOpen = (page) => page.evaluate(() => {
  const d = document.getElementById('m-dialog');
  return !!d && (d.matches(':popover-open') || d.hasAttribute('data-open'));
});

async function answerDialog(page, ok = true, timeout = 20000) {
  await pollUntil(() => dialogOpen(page), (v) => v, timeout, 'a dialog');
  const message = await page.$eval('#m-dialog-msg', (e) => e.textContent.trim());
  await sleep(450);
  await tap(await page.$(ok ? '#m-dialog-ok' : '#m-dialog-cancel'));
  await pollUntil(() => dialogOpen(page), (v) => !v, 5000, 'the dialog to close');
  return message;
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
  const open = await page.$eval('#about-advanced', (d) => d.open);
  if (!open) await press(page, '#about-advanced > summary');
  await page.waitForFunction(() => document.getElementById('about-advanced').open, { timeout: 5000 });
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
    }, VAULT_TOTP), (r) => r.prf || r.err, 60000, 'the TOTP passkey enrolment');
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
    const tab = await page.waitForFunction((title) => [...document.querySelectorAll('#qn-note-list .qn-note-tab')].find((b) => b.querySelector('.qn-note-tab__title').textContent === title) || null, { timeout: 10000 }, N.locked.title);
    await tap(tab.asElement());
    await press(page, '#qn-unlock-btn');
    await page.waitForFunction((body) => document.getElementById('qn-textarea').value === body, { timeout: 30000 }, N.locked.body);
    return { confirmLock: confirm, reopenedAndDecrypted: true };
  }
  return {};
}

async function financeFrame(page) {
  await page.goto(ORIGIN + '/extensions/finance/', { waitUntil: 'load' });
  const handle = await shown(page, '#xr-frame');
  await page.waitForFunction(() => {
    const f = document.getElementById('xr-frame');
    try { return !!(f && f.contentWindow && f.contentWindow.FIN_COPY && f.contentDocument.querySelector('.flock, #fin-main')); } catch (_) { return false; }
  }, { timeout: 60000, polling: 200 });
  await handle.scrollIntoView();
  await pollUntil(() => page.evaluate(() => {
    const r = document.getElementById('xr-frame').getBoundingClientRect();
    return r.top >= 0 && r.bottom <= innerHeight + 1;
  }), (v) => v, 5000, 'the Finance frame to fit the viewport');
  const frame = await handle.contentFrame();
  const copy = (path) => frame.evaluate((p) => p.split('.').reduce((o, k) => (o == null ? o : o[k]), window.FIN_COPY), path);
  return { frame, copy };
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
      legacy: { totpVault: fields(t.vault), identityVault: fields(a.vault), financeWraps: f.state.wrapKinds, notes: 1 },
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
  const server = serve(PORT);
  await server.ready;
  server.setRoot(resolve(legacyBuild));
  console.log('legacy build ' + resolve(legacyBuild) + ' on ' + ORIGIN);
  const browser = await launch();
  const seeded = [];
  let failed = 0;
  try {
    for (const g of groups) {
      const t0 = Date.now();
      const rig = await openRig(browser, g);
      try {
        const out = await seed(rig.page, g);
        seeded.push({ rig, out });
        printSeeded(out, Date.now() - t0);
      } catch (e) {
        failed++;
        const where = String((e && e.stack) || '').split('\n').filter((l) => l.includes('unlock-browser-check')).slice(0, 2).map((l) => l.trim().replace(/^at /, '')).join(' < ');
        console.log('FAIL ' + g + ' (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)\n     ' + String((e && e.message) || e).split('\n')[0] + (where ? '\n     at ' + where : ''));
        if (rig.pageErrors.length) console.log('     page errors: ' + [...new Set(rig.pageErrors)].slice(0, 3).join(' | '));
      }
    }
    if (newBuild && newBuild !== '-') console.log('migrate phase: not implemented yet; new build ' + resolve(newBuild) + ' was not loaded');
  } finally {
    await browser.close();
    await server.close();
    rmSync(PROFILE, { recursive: true, force: true });
  }
  console.log(seeded.length + '/' + groups.length + ' groups seeded; fixture files under ' + FIXTURES);
  if (failed) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main(process.argv.slice(2));
}
