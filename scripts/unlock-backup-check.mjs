import { statSync, rmSync, mkdirSync, readdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import puppeteer from 'puppeteer-core';
import { serve } from './unlock-serve.mjs';

const BUILD = process.argv[2];
const PROD = process.argv[3] || '';
if (!BUILD) { console.log('usage: node scripts/unlock-backup-check.mjs <beta build dir> [<production build dir>]'); process.exit(2); }
const PORT = 8094;
const ORIGIN = 'http://localhost:' + PORT;
const WORK = join(tmpdir(), 'unlock-backup-check-' + process.pid);
const PROFILE = join(WORK, 'profile');
const SHOTS = join(WORK, 'shots');
const MODULE = '/assets/js/mentria-unlock.js';
const CHECK_KEY = 'unlock_backup_check';
const PASS = 'backup check passphrase 2468';
const WRONG = 'AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA';
const CT_OPEN = ',"ct":[';
const EN = JSON.parse(readFileSync(new URL('../src/_data/i18n/en.json', import.meta.url), 'utf8'));

rmSync(WORK, { recursive: true, force: true });
mkdirSync(SHOTS, { recursive: true });
const server = serve(PORT);
await server.ready;
server.setRoot(BUILD);
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  userDataDir: PROFILE,
  protocolTimeout: 180000,
  args: ['--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE localhost', '--no-first-run', '--no-default-browser-check']
});

const checks = [];
const check = (name, fn, when = true) => checks.push([name, fn, when]);
const pageErrors = [];
const nativeDialogs = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function assert(cond, msg, extra) {
  if (!cond) throw new Error(msg + (extra === undefined ? '' : ' ' + JSON.stringify(extra)));
}

async function until(fn, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if (await fn()) return true; } catch (_) {}
    await sleep(100);
  }
  try { return !!(await fn()); } catch (_) { return false; }
}

async function device(name) {
  const dir = join(WORK, 'downloads-' + name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const context = await browser.createBrowserContext({ downloadBehavior: { policy: 'allow', downloadPath: dir } });
  return { name, context, dir };
}

async function open(dev, path, width = 1280, init) {
  const page = await dev.context.newPage();
  await page.setViewport({ width, height: 900 });
  if (init) await page.evaluateOnNewDocument(init);
  page.on('pageerror', (e) => pageErrors.push(dev.name + ' ' + path + ': ' + String(e && e.message || e).slice(0, 300)));
  page.on('dialog', async (d) => {
    nativeDialogs.push(d.type() + ': ' + d.message().slice(0, 200));
    try { await d.dismiss(); } catch (_) {}
  });
  await page.goto(ORIGIN + path, { waitUntil: 'load' });
  return page;
}

function bootLoaded(page) {
  return page.evaluate((url) => performance.getEntriesByType('resource').some((e) => new URL(e.name).pathname === url), MODULE);
}

async function setSwitch(page, on) {
  await page.waitForSelector('#unlock-switch');
  const cur = await page.$eval('#unlock-switch', (el) => el.checked);
  if (cur !== on) await page.click('#unlock-switch');
  await page.waitForFunction((want) => {
    try { return (JSON.parse(localStorage.getItem('mentria.keyring.local')) || {}).enabled === want; } catch (_) { return false; }
  }, {}, on);
}

async function createOnLab(page) {
  await page.click('#unlock-create');
  await page.waitForFunction(() => (document.getElementById('unlock-code').textContent || '').replace(/[^A-Z2-7]/g, '').length === 32, { timeout: 15000 });
  return page.$eval('#unlock-code', (el) => el.textContent.trim());
}

function runtimeState(page) {
  return page.evaluate(async (url) => {
    const m = await import(url);
    await m.ready();
    return m.state();
  }, MODULE);
}

function shown(page, sel) {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    return !!el && el.getClientRects().length > 0;
  }, sel);
}

async function ui(page, sels) {
  const out = {};
  for (const [k, s] of Object.entries(sels)) out[k] = await shown(page, s);
  return out;
}

const textOf = (page, sel) => page.$eval(sel, (el) => el.textContent.replace(/\s+/g, ' ').trim());
const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
const showsText = async (page, sel, text) => (await shown(page, sel)) && (await textOf(page, sel)) === text;

function clearDir(dir) {
  for (const n of readdirSync(dir)) rmSync(join(dir, n), { recursive: true, force: true });
}

async function waitDownload(dir, timeout = 60000) {
  const end = Date.now() + timeout;
  let last = -1;
  while (Date.now() < end) {
    const names = readdirSync(dir);
    const hit = names.find((n) => n.endsWith('.json'));
    if (hit && !names.some((n) => n.endsWith('.crdownload'))) {
      const size = statSync(join(dir, hit)).size;
      if (size > 0 && size === last) return join(dir, hit);
      last = size;
    }
    await sleep(200);
  }
  throw new Error('no download in ' + dir);
}

function keep(file, name) {
  const to = join(WORK, name);
  copyFileSync(file, to);
  return to;
}

function header(file) {
  const text = readFileSync(file, 'utf8');
  const first = text.slice(0, text.indexOf('\n')).trim();
  if (!first.endsWith(CT_OPEN)) throw new Error('not a chunked backup: ' + first.slice(0, 80));
  return JSON.parse(first.slice(0, -CT_OPEN.length) + '}');
}

function readStore(page, key) {
  return page.evaluate((k) => {
    try { return JSON.parse(localStorage.getItem('mentria.store.' + k)); } catch (_) { return null; }
  }, key);
}

const dialogOpen = (page) => page.evaluate(() => {
  const d = document.getElementById('m-dialog');
  return !!d && (d.matches(':popover-open') || d.hasAttribute('data-open'));
});

async function lockDuringRestore(page, lab, clickSel, fieldSel) {
  await page.click(clickSel);
  assert(await until(() => dialogOpen(page), 20000), 'the restore asks before changing anything');
  await lab.evaluate((url) => import(url).then((m) => m.lock()), MODULE);
  await sleep(1200);
  await page.click('#m-dialog-cancel');
  assert(await until(async () => !(await dialogOpen(page)), 5000), 'the dialog closes');
  return until(() => shown(page, fieldSel), 5000);
}

async function settle(page, read, final, timeout = 60000) {
  const asked = [];
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await dialogOpen(page)) {
      asked.push(await textOf(page, '#m-dialog-msg'));
      await sleep(300);
      await page.click('#m-dialog-ok');
      await until(async () => !(await dialogOpen(page)), 5000);
      continue;
    }
    const st = await read();
    if (final(st)) return { ...st, asked };
    await sleep(150);
  }
  throw new Error('restore did not finish: ' + JSON.stringify(await read()));
}

const aboutStatus = (page, id) => page.$eval('#' + id, (s) => ({ tone: s.dataset.tone || '', text: s.textContent.replace(/\s+/g, ' ').trim() }));
const aboutFinal = (st) => st.tone === 'ok' || st.tone === 'err' || st.text === norm(EN.common.restore_cancelled);
const filesStatus = (page) => page.$eval('#files-restore-status', (s) => ({ text: s.textContent.replace(/\s+/g, ' ').trim() }));
const filesFinal = (st) => !!st.text && !/^(Decrypting|Restoring)/.test(st.text);

async function aboutPage(dev, width) {
  const page = await open(dev, '/about/#backup', width);
  await page.waitForFunction(() => { const d = document.getElementById('about-advanced'); return !!d && d.open; });
  return page;
}

async function reveal(page, id) {
  await page.bringToFront();
  if (!(await shown(page, '#' + id))) await page.click('[data-reveal="' + id + '"]');
  await page.waitForSelector('#' + id + ':not([hidden])');
}

async function aboutExport(page, dev) {
  clearDir(dev.dir);
  await page.$eval('#about-data-export-status', (s) => { s.textContent = ''; delete s.dataset.tone; });
  await page.click('#about-data-export-btn');
  await page.waitForFunction(() => { const s = document.getElementById('about-data-export-status'); return s.dataset.tone === 'ok' || s.dataset.tone === 'err'; }, { timeout: 60000 });
  const st = await aboutStatus(page, 'about-data-export-status');
  assert(st.tone === 'ok', 'About export finished', st);
  return waitDownload(dev.dir);
}

async function aboutRestore(page) {
  await page.$eval('#about-data-import-status', (s) => { s.textContent = ''; delete s.dataset.tone; });
  await page.click('#about-data-import-btn');
  return settle(page, () => aboutStatus(page, 'about-data-import-status'), aboutFinal);
}

function reloaded(page) {
  const p = page.waitForNavigation({ waitUntil: 'load', timeout: 30000 });
  p.catch(() => {});
  return p;
}

async function fillIn(page, sel, text) {
  await page.$eval(sel, (el) => { el.value = ''; });
  await page.type(sel, text);
}

async function upload(page, sel, file) {
  const input = await page.$(sel);
  await input.uploadFile(file);
}

async function filesExportOpen(page) {
  await page.click('#files-export-all');
  await page.waitForSelector('#files-export-modal:not([hidden])');
}

async function filesExport(page, dev) {
  clearDir(dev.dir);
  await page.click('#files-export-confirm');
  await page.waitForFunction(() => document.getElementById('files-export-modal').hidden || document.getElementById('files-export-strength').dataset.level === 'weak', { timeout: 60000 });
  const err = await page.$eval('#files-export-strength', (s) => (s.dataset.level === 'weak' ? s.textContent : ''));
  assert(!err, 'Files export finished', err);
  return waitDownload(dev.dir);
}

async function filesRestoreOpen(page) {
  await page.click('#files-restore');
  await page.waitForSelector('#files-restore-modal:not([hidden])');
}

async function filesRestore(page) {
  await page.$eval('#files-restore-status', (s) => { s.textContent = ''; });
  await page.click('#files-restore-confirm');
  return settle(page, () => filesStatus(page), filesFinal);
}

async function shot(page, name, sel) {
  const el = await page.$(sel);
  await el.evaluate((e) => e.scrollIntoView({ block: 'center' }));
  await page.evaluate(() => document.querySelectorAll('.reveal').forEach((r) => r.classList.add('revealed')));
  await sleep(900);
  await el.screenshot({ path: join(SHOTS, name + '.png') });
}

function clean() {
  const errs = pageErrors.splice(0);
  const dialogs = nativeDialogs.splice(0);
  assert(!errs.length, 'no page errors', errs);
  assert(!dialogs.length, 'no native dialogs', dialogs);
}

let A = null;
let code = null;
let kcv = null;
let salt = null;
let v5About = null;
let v5Files = null;
let v3About = null;
let recordRaw = null;

check('export while unlocked makes a v5 file', async () => {
  A = await device('a');
  const lab = await open(A, '/beta/unlock/');
  await setSwitch(lab, true);
  code = await createOnLab(lab);
  await lab.evaluate((k) => window.MentriaStore.set('tools', k, { n: 1 }), CHECK_KEY);
  recordRaw = await lab.evaluate(() => localStorage.getItem('mentria.store.keyring.vault'));
  const rec = JSON.parse(recordRaw);
  kcv = rec.kcv;
  salt = rec.backup.salt;
  assert(typeof kcv === 'string' && typeof salt === 'string', 'keyring record has a kcv and a backup salt', rec && Object.keys(rec));
  const api = await lab.evaluate(async (url, pass) => {
    const m = await import(url);
    await m.ready();
    const B = window.MentriaBackup;
    const v5 = await B.sealBackup(await B.prepareBackup(), { keyring: await m.backupKey() });
    const v3 = await B.sealBackup(await B.prepareBackup(), pass);
    return { v5: await v5.blob.text(), v3: await v3.blob.text() };
  }, MODULE, PASS);
  writeFileSync(join(WORK, 'api-v5.json'), api.v5);
  writeFileSync(join(WORK, 'api-v3.json'), api.v3);
  v5About = v5Files = join(WORK, 'api-v5.json');
  v3About = join(WORK, 'api-v3.json');

  const about = await aboutPage(A);
  await reveal(about, 'about-export-form');
  assert(await until(() => shown(about, '#about-data-code'), 10000), 'About shows the recovery code line while unlocked');
  const u = await ui(about, { code: '#about-data-code', other: '#about-data-other', pass: '#about-data-pass', pass2: '#about-data-pass2' });
  assert(u.code && u.other && !u.pass && !u.pass2, 'About export: code line and disclosure, no passphrase fields', u);
  assert(await textOf(about, '#about-data-code') === norm(EN.unlock.backup_default), 'About code line text');
  assert(await textOf(about, '#about-data-other') === norm(EN.unlock.backup_other), 'About disclosure text');
  assert(await about.$eval('#about-data-other', (b) => b.getAttribute('aria-expanded')) === 'false', 'disclosure starts collapsed');
  assert(await showsText(about, '#about-data-export-lede-code', norm(EN.about.data_export_lede_code)) && !(await shown(about, '#about-data-export-lede')), 'About export lede for a code-protected file');
  await shot(about, 'about-export-code-1280', '.about-data-card:has(#about-export-form)');
  const v5 = await aboutExport(about, A);
  const h = header(v5);
  assert(h.v === 5 && h.kdf === 'keyring-code' && h.salt === salt && h.kcv === kcv && !('iter' in h), 'About file is v5 with the keyring salt and kcv', h);
  v5About = keep(v5, 'v5-about.json');

  await about.click('#about-data-other');
  const u2 = await ui(about, { code: '#about-data-code', pass: '#about-data-pass', pass2: '#about-data-pass2' });
  assert(!u2.code && u2.pass && u2.pass2, 'disclosure shows both passphrase fields and drops the code line', u2);
  assert(await about.$eval('#about-data-other', (b) => b.getAttribute('aria-expanded')) === 'true', 'disclosure expanded');
  assert(await shown(about, '#about-data-export-lede') && !(await shown(about, '#about-data-export-lede-code')), 'the disclosure brings back the passphrase lede');
  await shot(about, 'about-export-other-1280', '.about-data-card:has(#about-export-form)');
  await about.type('#about-data-pass', 'short');
  await about.click('#about-data-export-btn');
  const st = await aboutStatus(about, 'about-data-export-status');
  assert(st.tone === 'err' && st.text === norm(EN.about.data_pass_too_short), 'the disclosure keeps the passphrase rules', st);
  await fillIn(about, '#about-data-pass', PASS);
  await fillIn(about, '#about-data-pass2', PASS);
  const v3 = await aboutExport(about, A);
  const h3 = header(v3);
  assert(h3.v === 3 && h3.kdf === 'PBKDF2' && h3.salt !== salt && !('kcv' in h3), 'different passphrase makes a v3 file', h3);
  v3About = keep(v3, 'v3-about.json');
  await about.click('#about-data-other');
  const u3 = await ui(about, { code: '#about-data-code', pass: '#about-data-pass' });
  assert(u3.code && !u3.pass, 'collapsing the disclosure goes back to the code line', u3);

  const phone = await aboutPage(A, 390);
  await reveal(phone, 'about-export-form');
  assert(await until(() => shown(phone, '#about-data-code'), 10000), 'phone width shows the code line');
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert(overflow <= 0, 'no horizontal scroll at 390 px', overflow);
  await shot(phone, 'about-export-code-390', '.about-data-card:has(#about-export-form)');
  await phone.close();

  const files = await open(A, '/tools/files/');
  await filesExportOpen(files);
  assert(await until(() => shown(files, '#files-export-code'), 10000), 'Files shows the recovery code line while unlocked');
  const f = await ui(files, { code: '#files-export-code', other: '#files-export-other', pass: '#files-export-pass' });
  assert(f.code && f.other && !f.pass, 'Files export: code line and disclosure, no passphrase field', f);
  assert(await textOf(files, '#files-export-code') === norm(EN.unlock.backup_default), 'Files code line text');
  assert(await showsText(files, '#files-export-lede-code', norm(EN.tool.files.export_modal_lede_code)) && !(await shown(files, '#files-export-lede')), 'Files export lede for a code-protected file');
  await shot(files, 'files-export-code-1280', '#files-export-modal .m-modal__card');
  const fv5 = await filesExport(files, A);
  const fh = header(fv5);
  assert(fh.v === 5 && fh.kdf === 'keyring-code' && fh.salt === salt && fh.kcv === kcv, 'Files file is v5 with the keyring salt and kcv', fh);
  v5Files = keep(fv5, 'v5-files.json');
  await filesExportOpen(files);
  await until(() => shown(files, '#files-export-other'), 5000);
  await files.click('#files-export-other');
  const f2 = await ui(files, { code: '#files-export-code', pass: '#files-export-pass' });
  assert(!f2.code && f2.pass, 'Files disclosure shows the passphrase field', f2);
  assert(await shown(files, '#files-export-lede') && !(await shown(files, '#files-export-lede-code')), 'Files disclosure brings back the passphrase lede');
  await files.type('#files-export-pass', PASS);
  const fv3 = await filesExport(files, A);
  const fh3 = header(fv3);
  assert(fh3.v === 3 && fh3.kdf === 'PBKDF2', 'Files different passphrase makes a v3 file', fh3);
  await filesExportOpen(files);
  const f3 = await ui(files, { code: '#files-export-code', pass: '#files-export-pass' });
  assert(f3.code && !f3.pass, 'reopening the Files export collapses the disclosure', f3);
  await files.keyboard.press('Escape');
  await files.close();
  await about.close();
  for (const path of ['/about/#backup', '/tools/files/']) {
    const p = await open(A, path, 1280, () => { window.__mentriaRedirecting = true; });
    await sleep(800);
    assert(!(await bootLoaded(p)), 'a page marked as redirecting does not load the runtime: ' + path);
    await p.close();
  }
  clean();
});

check('restore v5 on a fresh profile with the code', async () => {
  assert(v5About && v5Files && code, 'needs the files from the first check');
  const B = await device('b');
  const lab = await open(B, '/beta/unlock/');
  await setSwitch(lab, true);
  assert(await lab.evaluate(() => localStorage.getItem('mentria.store.keyring.vault')) === null, 'fresh profile has no keyring');
  const about = await aboutPage(B);
  await reveal(about, 'about-import-form');
  await upload(about, '#about-data-import-file', v5About);
  assert(await until(() => shown(about, '#about-data-import-code'), 10000), 'a v5 file asks for the recovery code');
  const u = await ui(about, { pass: '#about-data-import-pass', code: '#about-data-import-code', prompt: '#about-data-import-code-note', key: '#about-data-import-key' });
  assert(!u.pass && u.code && u.prompt && !u.key, 'the code field replaces the passphrase field', u);
  assert(await textOf(about, '#about-data-import-code-note') === norm(EN.unlock.backup_code_prompt), 'About code prompt text');
  const attrs = await about.$eval('#about-data-import-code', (el) => ({
    type: el.type, ac: el.getAttribute('autocomplete'), cap: el.getAttribute('autocapitalize'), cor: el.getAttribute('autocorrect'), spell: el.getAttribute('spellcheck'),
    label: el.closest('label') ? el.closest('label').querySelector('span').textContent.trim() : ''
  }));
  assert(attrs.type === 'text' && attrs.ac === 'one-time-code' && attrs.cap === 'characters' && attrs.cor === 'off' && attrs.spell === 'false' && attrs.label === norm(EN.unlock.code_label), 'About code field attributes', attrs);
  assert(await showsText(about, '#about-data-import-lede-code', norm(EN.about.data_import_lede_code)) && !(await shown(about, '#about-data-import-lede')), 'About restore lede for a code file');
  await shot(about, 'about-restore-code-1280', '.about-data-card:has(#about-import-form)');
  await about.setViewport({ width: 390, height: 900 });
  assert(await about.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth) <= 0, 'About restore: no horizontal scroll at 390 px');
  await shot(about, 'about-restore-code-390', '.about-data-card:has(#about-import-form)');
  await about.setViewport({ width: 1280, height: 900 });
  await about.type('#about-data-import-code', WRONG);
  const bad = await aboutRestore(about);
  assert(bad.tone === 'err' && bad.text === norm(EN.common.restore_err_code), 'a wrong code shows the wrong-code error', bad);
  assert(await about.$eval('#about-data-import-code', (el) => el.value) === '', 'the code field is cleared after a try');
  assert(await readStore(about, 'tools.' + CHECK_KEY) === null, 'nothing restored after a wrong code');
  await about.type('#about-data-import-code', code.toLowerCase());
  const nav = reloaded(about);
  const ok = await aboutRestore(about);
  assert(ok.tone === 'ok', 'the right code restores', ok);
  const data = await readStore(about, 'tools.' + CHECK_KEY);
  const rec = await readStore(about, 'keyring.vault');
  assert(data && data.n === 1, 'tool data restored', data);
  assert(rec && rec.kcv === kcv, 'keyring restored', rec && rec.kcv);
  await nav;
  await about.close();

  const C = await device('c');
  const lab2 = await open(C, '/beta/unlock/');
  await setSwitch(lab2, true);
  const files = await open(C, '/tools/files/');
  await filesRestoreOpen(files);
  await upload(files, '#files-restore-file', v5Files);
  assert(await until(() => shown(files, '#files-restore-code'), 10000), 'Files asks for the recovery code for a v5 file');
  const f = await ui(files, { pass: '#files-restore-pass', code: '#files-restore-code', prompt: '#files-restore-code-note', key: '#files-restore-key' });
  assert(!f.pass && f.code && f.prompt && !f.key, 'Files code field replaces the passphrase field', f);
  const fattrs = await files.$eval('#files-restore-code', (el) => ({
    type: el.type, ac: el.getAttribute('autocomplete'), cap: el.getAttribute('autocapitalize'), cor: el.getAttribute('autocorrect'), spell: el.getAttribute('spellcheck'),
    label: document.querySelector('label[for="files-restore-code"]').textContent.trim()
  }));
  assert(fattrs.type === 'text' && fattrs.ac === 'one-time-code' && fattrs.cap === 'characters' && fattrs.cor === 'off' && fattrs.spell === 'false' && fattrs.label === norm(EN.unlock.code_label), 'Files code field attributes', fattrs);
  assert(await showsText(files, '#files-restore-lede-code', norm(EN.about.data_import_lede_code)) && !(await shown(files, '#files-restore-lede')), 'Files restore lede for a code file');
  assert(await textOf(files, '#files-restore-code-note') === norm(EN.unlock.backup_code_prompt), 'Files code prompt text');
  await shot(files, 'files-restore-code-1280', '#files-restore-modal .m-modal__card');
  await files.setViewport({ width: 390, height: 900 });
  assert(await files.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth) <= 0, 'Files restore: no horizontal scroll at 390 px');
  await shot(files, 'files-restore-code-390', '#files-restore-modal .m-modal__card');
  await files.setViewport({ width: 1280, height: 900 });
  await files.type('#files-restore-code', WRONG);
  const fbad = await filesRestore(files);
  assert(fbad.text === norm(EN.common.restore_err_code), 'Files wrong code shows the wrong-code error', fbad);
  await files.type('#files-restore-code', code);
  await files.$eval('#files-restore-status', (el) => { el.textContent = ''; });
  const fnav = reloaded(files);
  await files.keyboard.press('Enter');
  const fok = await settle(files, () => filesStatus(files), filesFinal);
  assert(fok.text === norm(EN.about.data_import_done), 'Files restores with the code', fok);
  const fdata = await readStore(files, 'tools.' + CHECK_KEY);
  assert(fdata && fdata.n === 1, 'Files restored the tool data', fdata);
  await fnav;
  await B.context.close();
  await C.context.close();
  clean();
});

check('restore v5 while unlocked opens without asking', async () => {
  assert(A && v5About && v5Files, 'needs the first check');
  const about = await aboutPage(A);
  const s = await runtimeState(about);
  assert(s.enabled && s.unlocked, 'device A is still unlocked', s);
  await about.evaluate((k) => window.MentriaStore.remove('tools', k), CHECK_KEY);
  assert(await readStore(about, 'tools.' + CHECK_KEY) === null, 'test data removed before the restore');
  await reveal(about, 'about-import-form');
  await upload(about, '#about-data-import-file', v5About);
  assert(await until(() => shown(about, '#about-data-import-key'), 10000), 'the session opens the file: no field to fill');
  const u = await ui(about, { pass: '#about-data-import-pass', code: '#about-data-import-code', key: '#about-data-import-key' });
  assert(!u.pass && !u.code && u.key, 'no passphrase or code field while unlocked', u);
  assert(await textOf(about, '#about-data-import-key') === norm(EN.unlock.backup_default), 'About key line text');
  await shot(about, 'about-restore-key-1280', '.about-data-card:has(#about-import-form)');
  const nav = reloaded(about);
  const ok = await aboutRestore(about);
  assert(ok.tone === 'ok', 'restored without asking for a secret', ok);
  const data = await readStore(about, 'tools.' + CHECK_KEY);
  assert(data && data.n === 1, 'tool data back', data);
  await nav;
  await about.waitForFunction(() => { const d = document.getElementById('about-advanced'); return !!d && d.open; });

  const other = await about.evaluate(async () => {
    const B = window.MentriaBackup;
    const b64u = (a) => btoa(String.fromCharCode.apply(null, a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const keyring = { key: crypto.getRandomValues(new Uint8Array(32)), salt: b64u(crypto.getRandomValues(new Uint8Array(16))), kcv: 'another-keyring-kcv' };
    const out = await B.sealBackup(await B.prepareBackup(), { keyring });
    return out.blob.text();
  });
  const otherFile = join(WORK, 'v5-other.json');
  writeFileSync(otherFile, other);
  await reveal(about, 'about-import-form');
  await upload(about, '#about-data-import-file', otherFile);
  assert(await until(() => shown(about, '#about-data-import-code'), 10000), 'a file from another keyring asks for its code while unlocked');
  assert(!(await shown(about, '#about-data-import-key')) && !(await shown(about, '#about-data-import-pass')), 'only the code field for another keyring');
  await upload(about, '#about-data-import-file', v5About);
  assert(await until(() => shown(about, '#about-data-import-key'), 10000), 'own file opens without asking again');
  await about.evaluate((url) => import(url).then((m) => m.lock()), MODULE);
  assert(await until(() => shown(about, '#about-data-import-code'), 10000), 'after Lock the same file asks for the code');
  assert(!(await shown(about, '#about-data-import-key')), 'key line gone after Lock');
  await reveal(about, 'about-export-form');
  assert(await until(async () => (await shown(about, '#about-data-pass')) && !(await shown(about, '#about-data-code')), 5000), 'after Lock the export asks for a passphrase');
  await about.focus('#about-data-import-code');
  await about.evaluate((url, c) => import(url).then((m) => m.unlockWithCode(c)), MODULE, code);
  assert(await until(() => shown(about, '#about-data-import-key'), 10000), 'unlocking again opens the file without asking');
  assert(await about.evaluate(() => document.activeElement && document.activeElement.id) === 'about-data-import-btn', 'focus moves to Restore when the focused code field goes away');
  assert(await until(() => shown(about, '#about-data-code'), 5000), 'unlocking again brings back the code line on export');

  const files = await open(A, '/tools/files/');
  await files.evaluate((k) => window.MentriaStore.remove('tools', k), CHECK_KEY);
  await filesRestoreOpen(files);
  await upload(files, '#files-restore-file', v5Files);
  assert(await until(() => shown(files, '#files-restore-key'), 10000), 'Files: the session opens the file');
  const f = await ui(files, { pass: '#files-restore-pass', code: '#files-restore-code', key: '#files-restore-key' });
  assert(!f.pass && !f.code && f.key, 'Files: no passphrase or code field while unlocked', f);
  await shot(files, 'files-restore-key-1280', '#files-restore-modal .m-modal__card');
  const fnav = reloaded(files);
  const fok = await filesRestore(files);
  assert(fok.text === norm(EN.about.data_import_done), 'Files restored without asking', fok);
  const fdata = await readStore(files, 'tools.' + CHECK_KEY);
  assert(fdata && fdata.n === 1, 'Files: tool data back', fdata);
  await fnav;
  await files.close();
  await about.close();
  clean();
});

check('flow on: v3 and v2 files use the passphrase, a v4 envelope follows the session', async () => {
  assert(A && v3About && code, 'needs the first check');
  const lab = await open(A, '/beta/unlock/');
  await lab.evaluate((k) => window.MentriaStore.set('tools', k, { n: 1 }), CHECK_KEY);
  const made = await lab.evaluate(async (url, pass) => {
    const m = await import(url);
    await m.ready();
    const B = window.MentriaBackup;
    const local = window.MentriaStore.exportAll();
    const v2 = await B.encryptBackup(local, pass);
    const v4 = await B.encryptBackup(local, { keyring: await m.backupKey() });
    return { unlocked: m.state().unlocked, v2: JSON.stringify(v2), v4: JSON.stringify(v4) };
  }, MODULE, PASS);
  assert(made.unlocked, 'device A is unlocked for this check');
  const v2 = join(WORK, 'v2-envelope.json');
  const v4 = join(WORK, 'v4-envelope.json');
  writeFileSync(v2, made.v2);
  writeFileSync(v4, made.v4);
  const e2 = JSON.parse(made.v2);
  const e4 = JSON.parse(made.v4);
  assert(e2.v === 2 && e2.kdf === 'PBKDF2', 'v2 envelope fixture', { v: e2.v, kdf: e2.kdf });
  assert(e4.v === 4 && e4.kdf === 'keyring-code' && e4.salt === salt && e4.kcv === kcv, 'v4 envelope fixture', { v: e4.v, kdf: e4.kdf });

  const aboutPass = async (file, label) => {
    const about = await aboutPage(A);
    await reveal(about, 'about-import-form');
    await upload(about, '#about-data-import-file', file);
    await sleep(800);
    const u = await ui(about, { pass: '#about-data-import-pass', code: '#about-data-import-code', key: '#about-data-import-key', lede: '#about-data-import-lede', ledeCode: '#about-data-import-lede-code' });
    assert(u.pass && !u.code && !u.key && u.lede && !u.ledeCode, 'About ' + label + ': the passphrase field while unlocked', u);
    await about.evaluate((k) => window.MentriaStore.remove('tools', k), CHECK_KEY);
    await about.type('#about-data-import-pass', PASS);
    const nav = reloaded(about);
    const ok = await aboutRestore(about);
    assert(ok.tone === 'ok', 'About ' + label + ' restores with the passphrase', ok);
    assert((await readStore(about, 'tools.' + CHECK_KEY) || {}).n === 1, 'About ' + label + ': data back');
    await nav;
    await about.close();
  };
  await aboutPass(v3About, 'v3 file');
  await aboutPass(v2, 'v2 envelope');

  const filesPass = async (file, label) => {
    const files = await open(A, '/tools/files/');
    await filesRestoreOpen(files);
    await upload(files, '#files-restore-file', file);
    await sleep(800);
    const f = await ui(files, { pass: '#files-restore-pass', code: '#files-restore-code', key: '#files-restore-key', lede: '#files-restore-lede', ledeCode: '#files-restore-lede-code' });
    assert(f.pass && !f.code && !f.key && f.lede && !f.ledeCode, 'Files ' + label + ': the passphrase field while unlocked', f);
    await files.evaluate((k) => window.MentriaStore.remove('tools', k), CHECK_KEY);
    await files.type('#files-restore-pass', PASS);
    const nav = reloaded(files);
    const ok = await filesRestore(files);
    assert(ok.text === norm(EN.about.data_import_done), 'Files ' + label + ' restores with the passphrase', ok);
    assert((await readStore(files, 'tools.' + CHECK_KEY) || {}).n === 1, 'Files ' + label + ': data back');
    await nav;
    await files.close();
  };
  await filesPass(v3About, 'v3 file');
  await filesPass(v2, 'v2 envelope');

  const about = await aboutPage(A);
  await reveal(about, 'about-import-form');
  await upload(about, '#about-data-import-file', v4);
  assert(await until(() => shown(about, '#about-data-import-key'), 10000), 'About v4 envelope opens without asking while the session matches');
  assert(!(await shown(about, '#about-data-import-pass')) && !(await shown(about, '#about-data-import-code')), 'About v4: no field while unlocked');
  assert(await lockDuringRestore(about, lab, '#about-data-import-btn', '#about-data-import-code'), 'About: a Lock during a cancelled restore shows the code field afterwards');
  assert(await textOf(about, '#about-data-import-status') === norm(EN.common.restore_cancelled), 'About: the restore was cancelled');
  await lab.evaluate((url, c) => import(url).then((m) => m.unlockWithCode(c)), MODULE, code);
  assert(await until(() => shown(about, '#about-data-import-key'), 10000), 'About v4: unlocking again opens it without asking');
  await about.evaluate((k) => window.MentriaStore.remove('tools', k), CHECK_KEY);
  const nav = reloaded(about);
  const ok = await aboutRestore(about);
  assert(ok.tone === 'ok', 'About v4 restores without asking', ok);
  assert((await readStore(about, 'tools.' + CHECK_KEY) || {}).n === 1, 'About v4: data back');
  await nav;
  await about.waitForFunction(() => { const d = document.getElementById('about-advanced'); return !!d && d.open; });

  const files = await open(A, '/tools/files/');
  await filesRestoreOpen(files);
  await upload(files, '#files-restore-file', v4);
  assert(await until(() => shown(files, '#files-restore-key'), 10000), 'Files v4 envelope opens without asking while the session matches');
  assert(await lockDuringRestore(files, lab, '#files-restore-confirm', '#files-restore-code'), 'Files: a Lock during a cancelled restore shows the code field afterwards');
  assert(await textOf(files, '#files-restore-status') === norm(EN.common.restore_cancelled), 'Files: the restore was cancelled');
  await lab.evaluate((url, c) => import(url).then((m) => m.unlockWithCode(c)), MODULE, code);
  assert(await until(() => shown(files, '#files-restore-key'), 10000), 'Files v4: unlocking again opens it without asking');

  await about.evaluate((url) => import(url).then((m) => m.lock()), MODULE);
  assert(await until(() => shown(files, '#files-restore-code'), 10000), 'Files v4 envelope asks for the code after Lock');
  await reveal(about, 'about-import-form');
  await upload(about, '#about-data-import-file', v4);
  assert(await until(() => shown(about, '#about-data-import-code'), 10000), 'About v4 envelope asks for the code when locked');
  assert(!(await shown(about, '#about-data-import-pass')) && !(await shown(about, '#about-data-import-key')), 'About v4 locked: only the code field');
  await about.type('#about-data-import-code', WRONG);
  const bad = await aboutRestore(about);
  assert(bad.tone === 'err' && bad.text === norm(EN.common.restore_err_code), 'About v4: a wrong code shows the wrong-code error', bad);
  assert(await until(() => shown(about, '#about-data-import-code'), 5000), 'About v4: the code field stays after a wrong code');
  await about.evaluate((k) => window.MentriaStore.remove('tools', k), CHECK_KEY);
  await about.type('#about-data-import-code', code);
  const nav2 = reloaded(about);
  const ok2 = await aboutRestore(about);
  assert(ok2.tone === 'ok', 'About v4 restores with the code when locked', ok2);
  assert((await readStore(about, 'tools.' + CHECK_KEY) || {}).n === 1, 'About v4 locked: data back');
  await nav2;
  await lab.evaluate((url, c) => import(url).then((m) => m.unlockWithCode(c)), MODULE, code);
  await files.close();
  await about.close();
  await lab.close();
  clean();
});

check('switch off keeps the passphrase export', async () => {
  assert(A && v5About && v3About, 'needs the first check');
  const lab = await open(A, '/beta/unlock/');
  await setSwitch(lab, false);
  await lab.evaluate((k) => window.MentriaStore.set('tools', k, { n: 1 }), CHECK_KEY);
  const about = await aboutPage(A);
  await reveal(about, 'about-export-form');
  assert(await about.evaluate(() => document.activeElement && document.activeElement.id) === 'about-data-pass', 'opening the export focuses the passphrase as today');
  await sleep(800);
  assert(!(await bootLoaded(about)), 'About does not load the runtime with the switch off');
  const u = await ui(about, { code: '#about-data-code', other: '#about-data-other', pass: '#about-data-pass', pass2: '#about-data-pass2' });
  assert(!u.code && !u.other && u.pass && u.pass2, 'About export shows the two passphrase fields as today', u);
  assert(await shown(about, '#about-data-export-lede') && !(await shown(about, '#about-data-export-lede-code')), 'About export lede as today');
  await shot(about, 'about-export-off-1280', '.about-data-card:has(#about-export-form)');
  await about.click('#about-data-export-btn');
  const st = await aboutStatus(about, 'about-data-export-status');
  assert(st.tone === 'err' && st.text === norm(EN.about.data_pass_too_short), 'an empty passphrase is refused as today', st);
  await about.type('#about-data-pass', PASS);
  await about.type('#about-data-pass2', PASS + 'x');
  await about.click('#about-data-export-btn');
  const st2 = await aboutStatus(about, 'about-data-export-status');
  assert(st2.tone === 'err' && st2.text === norm(EN.about.data_pass_mismatch), 'mismatched passphrases are refused as today', st2);
  await fillIn(about, '#about-data-pass', PASS);
  await fillIn(about, '#about-data-pass2', PASS);
  const v3 = await aboutExport(about, A);
  const h = header(v3);
  assert(h.v === 3 && h.kdf === 'PBKDF2' && h.iter === 600000, 'switch off makes a v3 file', h);
  await reveal(about, 'about-import-form');
  await upload(about, '#about-data-import-file', v5About);
  await sleep(800);
  const r = await ui(about, { pass: '#about-data-import-pass', code: '#about-data-import-code', key: '#about-data-import-key' });
  assert(r.pass && !r.code && !r.key, 'switch off: a v5 file shows the passphrase field as today', r);
  assert(await shown(about, '#about-data-import-lede') && !(await shown(about, '#about-data-import-lede-code')), 'About restore lede as today');
  assert(!(await bootLoaded(about)), 'choosing a v5 file does not load the runtime with the switch off');
  await upload(about, '#about-data-import-file', v3);
  await about.click('#about-data-import-btn');
  const empty = await aboutStatus(about, 'about-data-import-status');
  assert(empty.tone === 'err' && empty.text === norm(EN.about.data_pass_too_short), 'restore without a passphrase is refused as today', empty);
  await about.evaluate((k) => window.MentriaStore.remove('tools', k), CHECK_KEY);
  await about.type('#about-data-import-pass', PASS);
  const nav = reloaded(about);
  const ok = await aboutRestore(about);
  assert(ok.tone === 'ok', 'switch off: the v3 file restores with its passphrase', ok);
  assert((await readStore(about, 'tools.' + CHECK_KEY) || {}).n === 1, 'switch off: data back');
  await nav;
  await about.close();

  const files = await open(A, '/tools/files/');
  await filesExportOpen(files);
  await sleep(600);
  const f = await ui(files, { code: '#files-export-code', other: '#files-export-other', pass: '#files-export-pass' });
  assert(!f.code && !f.other && f.pass, 'Files export shows the passphrase field as today', f);
  assert(await shown(files, '#files-export-lede') && !(await shown(files, '#files-export-lede-code')), 'Files export lede as today');
  assert(await files.evaluate(() => document.activeElement && document.activeElement.id) === 'files-export-pass', 'Files export focuses the passphrase as today');
  await shot(files, 'files-export-off-1280', '#files-export-modal .m-modal__card');
  await files.type('#files-export-pass', PASS);
  const fv3 = await filesExport(files, A);
  assert(header(fv3).v === 3, 'Files switch off makes a v3 file');
  await filesRestoreOpen(files);
  await upload(files, '#files-restore-file', v5Files);
  await sleep(800);
  const fr = await ui(files, { pass: '#files-restore-pass', code: '#files-restore-code', key: '#files-restore-key' });
  assert(fr.pass && !fr.code && !fr.key, 'Files switch off: a v5 file shows the passphrase field as today', fr);
  assert(!(await bootLoaded(files)), 'Files does not load the runtime with the switch off');
  await files.close();
  await lab.close();
  clean();
});

check('production build never loads the runtime', async () => {
  server.setRoot(PROD);
  try {
    const D = await device('d');
    const first = await open(D, '/about/');
    assert(await first.evaluate(() => document.documentElement.dataset.release) !== 'beta', 'second build is not a beta build');
    await first.evaluate((r) => {
      localStorage.setItem('mentria.keyring.local', JSON.stringify({ enabled: true }));
      localStorage.setItem('mentria.store.keyring.vault', r);
    }, recordRaw);
    await first.close();
    const about = await aboutPage(D);
    await reveal(about, 'about-export-form');
    await reveal(about, 'about-import-form');
    await upload(about, '#about-data-import-file', v5About);
    await sleep(1000);
    const u = await ui(about, { code: '#about-data-code', other: '#about-data-other', pass: '#about-data-pass', ipass: '#about-data-import-pass', icode: '#about-data-import-code' });
    assert(!u.code && !u.other && u.pass && u.ipass && !u.icode, 'production About is as today', u);
    assert(!(await bootLoaded(about)), 'production About never loads the runtime');
    const files = await open(D, '/tools/files/');
    await filesRestoreOpen(files);
    await upload(files, '#files-restore-file', v5Files);
    await sleep(800);
    const f = await ui(files, { pass: '#files-restore-pass', code: '#files-restore-code' });
    assert(f.pass && !f.code, 'production Files is as today', f);
    assert(!(await bootLoaded(files)), 'production Files never loads the runtime');
    await D.context.close();
    clean();
  } finally {
    server.setRoot(BUILD);
  }
}, !!PROD);

let failed = 0;
let ran = 0;
const ONLY = process.env.ONLY || '';
for (const [name, fn, when] of checks.filter(([n]) => !ONLY || n.includes(ONLY))) {
  if (!when) { console.log('SKIP ' + name); continue; }
  ran++;
  try {
    await fn();
    console.log('PASS ' + name);
  } catch (e) {
    failed++;
    pageErrors.splice(0);
    nativeDialogs.splice(0);
    console.log('FAIL ' + name + ': ' + String(e && e.message || e).slice(0, 600));
  }
}
console.log((ran - failed) + '/' + ran + ' passed');
await browser.close();
await server.close();
rmSync(PROFILE, { recursive: true, force: true });
for (const n of readdirSync(WORK)) if (n.startsWith('downloads-')) rmSync(join(WORK, n), { recursive: true, force: true });
console.log('screenshots: ' + SHOTS);
process.exit(failed ? 1 : 0);
