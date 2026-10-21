import { rmSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { serve } from './unlock-serve.mjs';

const BUILD = process.argv[2];
const PLAIN = process.argv[3] || '';
if (!BUILD) { console.log('usage: node scripts/unlock-notes-check.mjs <beta build> [<non-beta build>]'); process.exit(2); }
const PORT = 8091;
const ORIGIN = 'http://localhost:' + PORT;
const PROFILE = join(tmpdir(), 'unlock-notes-check-profile');
const MODULE = '/assets/js/mentria-unlock.js';
const UI = '/assets/js/mentria-unlock-ui.js';
const CORE = '/assets/js/mentria-unlock-core.js';
const NOTES = '/tools/quick-notes/';
const BLOB = 'mentria.store.quick_notes.blob';
const RECORD = 'mentria.store.keyring.vault';
const LOCAL = 'mentria.keyring.local';
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const I18N = JSON.parse(readFileSync(join(REPO, 'src/_data/i18n/en.json'), 'utf8'));
const QN = I18N.tool['quick-notes'];
const UN = I18N.unlock;
const DAY = 86400000;
const AUTH = { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: true };

const PROBE = () => {
  window.__wa = [];
  window.__signals = [];
  const c = navigator.credentials;
  if (c) {
    const create = c.create.bind(c);
    const get = c.get.bind(c);
    c.create = (o) => { window.__wa.push('create'); return create(o); };
    c.get = (o) => { window.__wa.push('get'); return get(o); };
  }
  if (window.PublicKeyCredential) PublicKeyCredential.signalUnknownCredential = (o) => { window.__signals.push(o); return Promise.resolve(); };
};
const FAIL_REMOVE = () => {
  if (sessionStorage.getItem('t-fail-remove') !== '1') return;
  let held;
  Object.defineProperty(window, 'MentriaStore', {
    configurable: true,
    get() { return held; },
    set(x) {
      if (x && typeof x.remove === 'function') {
        const r = x.remove;
        x.remove = (ns, k, o) => (ns === 'quick_notes' ? false : r(ns, k, o));
      }
      held = x;
    }
  });
};
const SWITCH_ON = () => {
  try {
    const l = JSON.parse(localStorage.getItem('mentria.keyring.local') || '{}') || {};
    l.enabled = true;
    localStorage.setItem('mentria.keyring.local', JSON.stringify(l));
  } catch (_) {}
};

const srv = serve(PORT);
await srv.ready;
srv.setRoot(BUILD);
rmSync(PROFILE, { recursive: true, force: true });
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  userDataDir: PROFILE,
  protocolTimeout: 180000,
  args: ['--no-first-run', '--no-default-browser-check']
});

const checks = [];
const check = (name, fn) => checks.push([name, fn]);
const logs = new WeakMap();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function assert(cond, msg, extra) {
  if (!cond) throw new Error(msg + (extra === undefined ? '' : ' ' + JSON.stringify(extra).slice(0, 600)));
}

async function until(fn, ms, what) {
  const end = Date.now() + (ms || 15000);
  let v;
  while (Date.now() < end) {
    v = await fn();
    if (v) return v;
    await sleep(100);
  }
  v = await fn();
  if (!v && what) throw new Error('timed out: ' + what);
  return v;
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
  await blank.evaluate(async () => {
    try { for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); } catch (_) {}
    try { for (const k of await caches.keys()) await caches.delete(k); } catch (_) {}
    localStorage.clear();
    sessionStorage.clear();
  });
  return blank;
}

async function open(path, ...inits) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const log = { requests: [], errors: [] };
  logs.set(page, log);
  page.on('request', (r) => log.requests.push(r.url()));
  page.on('pageerror', (e) => log.errors.push(String(e && e.message || e)));
  await page.evaluateOnNewDocument(PROBE);
  for (const init of inits) await page.evaluateOnNewDocument(init);
  await page.goto(ORIGIN + path, { waitUntil: 'load' });
  return page;
}

async function authOn(page, cred) {
  const cdp = await page.createCDPSession();
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: AUTH });
  if (cred) await cdp.send('WebAuthn.addCredential', { authenticatorId, credential: cred });
  return { cdp, creds: async () => (await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials };
}

async function settle(page, want) {
  await page.waitForFunction(() => typeof window.mentriaConfirm === 'function', { timeout: 20000 });
  await page.waitForFunction((w) => {
    const t = document.getElementById('qn-tool');
    return !!t && t.dataset.lock === w;
  }, { timeout: 20000 }, want);
}

async function reload(page, want) {
  await page.reload({ waitUntil: 'load' });
  await settle(page, want);
}

function readJson(page, key) {
  return page.evaluate((k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } }, key);
}

function blob(page) { return readJson(page, BLOB).then((v) => (Array.isArray(v) ? v : [])); }

async function waitBlob(page, test, what, ms) {
  let last = null;
  const ok = await until(async () => { last = await blob(page); return test(last); }, ms || 20000);
  assert(ok, 'notes blob: ' + what, last);
  return last;
}

const byTitle = (list, title) => list.find((n) => n && n.title === title);

async function fill(page, sel, text) {
  await page.waitForFunction((s) => { const el = document.querySelector(s); return el && !el.hidden && el.getClientRects().length; }, { timeout: 10000 }, sel);
  await page.$eval(sel, (el) => { el.value = ''; });
  await page.click(sel);
  await page.type(sel, text);
}

async function writeNote(page, title, body, fresh) {
  if (fresh) {
    await page.click('#qn-new-btn');
    await page.waitForFunction(() => document.getElementById('qn-title-input').value === '' && document.getElementById('qn-textarea').value === '', { timeout: 5000 });
  }
  await fill(page, '#qn-title-input', title);
  await fill(page, '#qn-textarea', body);
  await waitBlob(page, (v) => { const n = byTitle(v, title); return n && n.body === body; }, 'saved ' + title);
}

const dialogOpen = (page) => page.evaluate(() => {
  const d = document.getElementById('m-dialog');
  return !!d && (d.matches(':popover-open') || d.hasAttribute('data-open'));
});

async function answerDialog(page, ok = true) {
  await until(() => dialogOpen(page), 20000, 'a dialog');
  const message = await page.$eval('#m-dialog-msg', (e) => e.textContent.trim());
  await sleep(450);
  const msgNow = () => page.$eval('#m-dialog-msg', (e) => e.textContent.trim()).catch(() => '');
  for (let i = 0; i < 10; i++) {
    await page.click(ok ? '#m-dialog-ok' : '#m-dialog-cancel');
    if (await until(async () => !(await dialogOpen(page)) || (await msgNow()) !== message, 1000)) return message;
  }
  throw new Error('dialog did not close: ' + message);
}

async function pick(page, title) {
  const h = await page.waitForFunction((t) => [...document.querySelectorAll('#qn-note-list .qn-note-tab')].find((b) => b.querySelector('.qn-note-tab__title').textContent === t) || null, { timeout: 10000 }, title);
  await h.asElement().click();
  await page.waitForFunction((t) => document.getElementById('qn-title-input').value === t, { timeout: 5000 }, title);
}

async function view(page) {
  return page.evaluate(() => {
    const shown = (el) => !!el && !el.hidden && el.getClientRects().length > 0;
    const panel = document.getElementById('qn-locked');
    const card = document.querySelector('#qn-locked-card .m-unlock');
    const link = document.getElementById('qn-locked-link');
    const note = document.getElementById('qn-locked-note');
    const conv = document.getElementById('qn-convert');
    return {
      text: shown(document.getElementById('qn-textarea')) ? document.getElementById('qn-textarea').value : null,
      raw: document.getElementById('qn-textarea').value,
      panel: shown(panel),
      unlockBtn: shown(document.getElementById('qn-unlock-btn')),
      card: shown(card),
      later: shown(document.getElementById('qn-card-later')),
      link: shown(link) ? link.textContent.replace(/\s+/g, ' ').trim() : null,
      note: shown(note) ? note.textContent.trim() : null,
      lockBtn: shown(document.getElementById('qn-lock-btn')) ? document.getElementById('qn-lock-btn').textContent.trim() : null,
      lockTitle: document.getElementById('qn-lock-btn').title,
      removeBtn: shown(document.getElementById('qn-remove-lock-btn')) ? document.getElementById('qn-remove-lock-btn').textContent.trim() : null,
      convert: shown(conv) ? conv.textContent.trim() : null,
      layer: !!document.querySelector('.m-ulayer [role="dialog"]')
    };
  });
}

async function waitView(page, test, what, ms) {
  let last = null;
  const ok = await until(async () => { last = await view(page); return test(last); }, ms || 15000);
  assert(ok, what, last);
  return last;
}

function wa(page) { return page.evaluate(() => window.__wa.slice()); }
function resetWa(page) { return page.evaluate(() => { window.__wa.length = 0; }); }

async function makeKeyring(page) {
  return page.evaluate(async (M, C) => {
    const m = await import(M);
    const core = await import(C);
    const code = core.newRecoveryCode();
    await m.create({ code, confirmed: true });
    return code;
  }, MODULE, CORE);
}

async function runtime(page, op, arg) {
  return page.evaluate(async (M, o, a) => {
    const m = await import(M);
    if (o === 'unlocked') return m.state().unlocked;
    if (o === 'lock') { await m.lock(); return m.state().unlocked; }
    if (o === 'unlock') { await m.unlockWithCode(a); return m.state().unlocked; }
    if (o === 'retirement') return m.retirement('notes', a);
    if (o === 'nudge') { m.setAskAtLaunch(!m.state().askAtLaunch); return m.state().askAtLaunch; }
    throw new Error('unknown op ' + o);
  }, MODULE, op, arg);
}

async function lockKeyring(page) { await runtime(page, 'lock'); }
async function nudge(page) { await runtime(page, 'nudge'); }
async function unlockKeyring(page, code) { await runtime(page, 'unlock', code); }

async function openV2(page, note) {
  return page.evaluate(async (M, n) => {
    const m = await import(M);
    const raw = await m.secret('notes');
    if (!raw) return 'NO KEY';
    const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
    const b = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
    try {
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b(n.iv), additionalData: new TextEncoder().encode('mentria-notes|v2|' + n.id) }, key, b(n.body));
      return new TextDecoder().decode(pt);
    } catch (e) {
      return 'ERR ' + e.name;
    }
  }, MODULE, note);
}

async function cardCode(page, root, code) {
  const sel = root + ' input[name="recovery-code"]';
  await page.waitForSelector(root + ' .m-unlock', { timeout: 15000 });
  const toggle = root + ' [data-act="show-code"]';
  const t = await page.$(toggle);
  if (t && await page.$eval(toggle, (el) => el.getClientRects().length > 0 && el.getAttribute('aria-expanded') !== 'true')) await page.click(toggle);
  await page.waitForFunction((s) => { const el = document.querySelector(s); return el && el.getBoundingClientRect().height > 0; }, { timeout: 10000 }, sel);
  await page.$eval(sel, (el) => { el.value = ''; });
  await page.type(sel, code);
  await page.keyboard.press('Enter');
}

async function legacyNote(page, title, text) {
  await page.evaluate(async (t, x) => {
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(x)));
    const b = (u) => btoa(String.fromCharCode(...u));
    const list = JSON.parse(localStorage.getItem('mentria.store.quick_notes.blob') || '[]');
    list.push({ id: 'foreign' + Date.now().toString(36), title: t, body: b(ct), iv: b(iv), enc: true, createdAt: 1, updatedAt: 2 });
    window.MentriaStore.set('quick_notes', 'blob', list);
  }, title, text);
}

function store(page, ns, key) { return page.evaluate((n, k) => window.MentriaStore.get(n, k), ns, key); }

async function legacySeed(page) {
  await writeNote(page, 'Alpha', 'alpha secret text', false);
  await page.click('#qn-lock-btn');
  const confirm = await answerDialog(page);
  assert(confirm === QN.confirm_lock, 'old lock confirm text', confirm);
  await waitBlob(page, (v) => { const n = byTitle(v, 'Alpha'); return n && n.enc === true && n.iv && n.body !== 'alpha secret text'; }, 'Alpha locked the old way', 60000);
  await writeNote(page, 'Bravo', 'bravo secret text', true);
  await page.click('#qn-lock-btn');
  await answerDialog(page);
  await waitBlob(page, (v) => { const n = byTitle(v, 'Bravo'); return n && n.enc === true && n.iv && n.body !== 'bravo secret text'; }, 'Bravo locked the old way', 60000);
  await writeNote(page, 'Charlie', 'charlie plain text', true);
  return confirm;
}

async function notesKeyring(extra) {
  await clean();
  const page = await open(NOTES, SWITCH_ON, ...(extra || []));
  await settle(page, 'one');
  const code = await makeKeyring(page);
  await until(() => runtime(page, 'unlocked'), 10000, 'keyring open');
  return { page, code };
}

async function lockActive(page, title, text) {
  await page.click('#qn-lock-btn');
  const msg = await answerDialog(page);
  const list = await waitBlob(page, (v) => { const n = byTitle(v, title); return n && n.enc === true && n.kv === 2 && n.iv && n.body !== text; }, title + ' locked with the notes key', 30000);
  return { msg, note: byTitle(list, title) };
}

check('switch off keeps the old flow', async () => {
  for (const [label, dir] of [['beta', BUILD]].concat(PLAIN ? [['non-beta', PLAIN]] : [])) {
    srv.setRoot(dir);
    await clean();
    const page = await open(NOTES);
    const auth = await authOn(page);
    await settle(page, 'old');
    await writeNote(page, 'Old', 'old secret text', false);
    let v = await view(page);
    assert(v.lockBtn === QN.lock_btn && v.lockTitle === QN.lock_title && v.removeBtn === null, label + ': plain note buttons as today', v);
    await page.click('#qn-lock-btn');
    const msg = await answerDialog(page);
    assert(msg === QN.confirm_lock, label + ': old confirm text', msg);
    const list = await waitBlob(page, (x) => { const n = byTitle(x, 'Old'); return n && n.enc === true && n.iv && n.body !== 'old secret text'; }, label + ': locked the old way', 60000);
    const n = byTitle(list, 'Old');
    assert(!('kv' in n), label + ': no kv on an old lock', n);
    assert((await wa(page)).join() === 'create', label + ': one passkey made by the lock', await wa(page));
    assert((await auth.creds()).length === 1, label + ': one credential on the authenticator');
    assert(typeof (await store(page, 'quick_notes', 'cred_id')) === 'string' && typeof (await store(page, 'quick_notes', 'salt')) === 'string', label + ': salt and cred_id stored');
    v = await waitView(page, (x) => x.text === 'old secret text', label + ': note stays open after locking');
    assert(v.lockBtn === QN.remove_lock_btn && v.removeBtn === null, label + ': lock button turns into Remove lock as today', v);
    await reload(page, 'old');
    await pick(page, 'Old');
    v = await view(page);
    assert(v.panel && v.unlockBtn && !v.card && v.link === null && v.note === null && v.text === null, label + ': old locked panel', v);
    await resetWa(page);
    await page.click('#qn-unlock-btn');
    await waitView(page, (x) => x.text === 'old secret text', label + ': old unlock opens the note', 30000);
    assert((await wa(page)).join() === 'get', label + ': one passkey tap', await wa(page));
    await page.evaluate(() => {
      const list = JSON.parse(localStorage.getItem('mentria.store.quick_notes.blob'));
      list.push({ id: 'kvtwo', title: 'New kind', body: 'AAAA', iv: 'AAAAAAAAAAAAAAAA', enc: true, kv: 2, createdAt: 1, updatedAt: 3 });
      window.MentriaStore.set('quick_notes', 'blob', list);
    });
    await reload(page, 'old');
    await pick(page, 'New kind');
    v = await view(page);
    assert(v.panel && !v.unlockBtn && v.note === QN.one_unlock_off, label + ': a note locked with the one unlock is not offered the old unlock', v);
    await resetWa(page);
    await page.evaluate(() => document.getElementById('qn-unlock-btn').click());
    await sleep(500);
    assert((await wa(page)).length === 0, label + ': no passkey prompt for it', await wa(page));
    const log = logs.get(page);
    assert(!log.requests.some((u) => u.includes(UI)), label + ': the card module is never loaded', log.requests.filter((u) => u.includes('unlock')));
    assert(!log.requests.some((u) => u.includes(MODULE)), label + ': the runtime is never loaded with the switch off');
    const dbs = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
    assert(!dbs.includes('mentria-keyring') && (await readJson(page, RECORD)) === null, label + ': no keyring storage touched', dbs);
    assert(!log.errors.length, label + ': no page errors', log.errors);
  }
  srv.setRoot(BUILD);
});

check('lock a note in keyring mode', async () => {
  const { page, code } = await notesKeyring();
  const auth = await authOn(page);
  await writeNote(page, 'Kilo', 'kilo secret text', false);
  let v = await view(page);
  assert(v.lockBtn === QN.lock_btn && v.lockTitle === QN.lock_title_one && v.removeBtn === null, 'plain note in keyring mode', v);
  await resetWa(page);
  const { msg, note } = await lockActive(page, 'Kilo', 'kilo secret text');
  assert(msg === QN.confirm_lock_one, 'keyring confirm text', msg);
  assert((await wa(page)).length === 0 && (await auth.creds()).length === 0, 'no passkey made or asked', await wa(page));
  assert((await store(page, 'quick_notes', 'cred_id')) == null && (await store(page, 'quick_notes', 'salt')) == null, 'no old salt or cred_id written');
  const rec = await readJson(page, RECORD);
  assert(rec && rec.services && rec.services.notes && rec.services.notes.ct, 'notes linked in the keyring', rec && rec.services);
  assert((await openV2(page, note)) === 'kilo secret text', 'stored note opens with the linked key and its AAD');
  assert(Uint8Array.from(atob(note.iv), (c) => c.charCodeAt(0)).length === 12, '12-byte IV');
  v = await waitView(page, (x) => x.text === 'kilo secret text', 'note stays open after locking');
  assert(v.lockBtn === QN.lock_btn && v.lockTitle === QN.relock_title && v.removeBtn === QN.remove_lock_btn, 'Lock and Remove lock are two actions', v);
  await page.type('#qn-textarea', ' more');
  const edited = await waitBlob(page, (x) => { const n = byTitle(x, 'Kilo'); return n && n.iv !== note.iv; }, 'edit saved');
  const e = byTitle(edited, 'Kilo');
  assert(e.kv === 2 && e.enc === true && (await openV2(page, e)) === 'kilo secret text more', 'edit re-encrypted with the notes key', e);
  await reload(page, 'one');
  await pick(page, 'Kilo');
  await waitView(page, (x) => x.text === 'kilo secret text more', 'reload opens the note without a screen');
  assert((await wa(page)).length === 0, 'no passkey on reload');
  await page.click('#qn-lock-btn');
  v = await waitView(page, (x) => x.card && x.text === null && x.raw === '', 'Lock locks again and shows the card');
  assert(!(await runtime(page, 'unlocked')), 'keyring locked by Lock');
  assert(!v.unlockBtn && v.lockBtn === null && v.removeBtn === null, 'card replaces the old unlock button', v);
  await cardCode(page, '#qn-locked-card', code);
  await waitView(page, (x) => x.text === 'kilo secret text more' && !x.card, 'card unlock opens the note');
  await lockKeyring(page);
  await waitView(page, (x) => x.card, 'card back after lock');
  await writeNote(page, 'Lima', 'lima secret text', true);
  await page.click('#qn-lock-btn');
  await answerDialog(page);
  await page.waitForSelector('.m-ulayer input[name="recovery-code"], .m-ulayer [data-act="show-code"]', { timeout: 15000 });
  await cardCode(page, '.m-ulayer', code);
  const lima = byTitle(await waitBlob(page, (x) => { const n = byTitle(x, 'Lima'); return n && n.kv === 2 && n.enc; }, 'Lima locked after the card'), 'Lima');
  assert((await openV2(page, lima)) === 'lima secret text', 'Lima opens with the same notes key');
  await waitView(page, (x) => x.text === 'lima secret text' && !x.layer, 'Lima open after the card');
  await page.click('#qn-remove-lock-btn');
  const rm = await answerDialog(page);
  assert(rm === QN.confirm_remove_lock, 'remove lock confirm', rm);
  const plain = byTitle(await waitBlob(page, (x) => { const n = byTitle(x, 'Lima'); return n && !n.enc && n.body === 'lima secret text'; }, 'Lima plain again'), 'Lima');
  assert(!('kv' in plain) && !('iv' in plain), 'remove lock drops kv and iv', plain);
  const log = logs.get(page);
  assert(!log.errors.length, 'no page errors', log.errors);
});

check('lock with no keyring runs setup first', async () => {
  await clean();
  const page = await open(NOTES, SWITCH_ON);
  await authOn(page);
  await settle(page, 'one');
  await writeNote(page, 'Mike', 'mike secret text', false);
  await page.click('#qn-lock-btn');
  await answerDialog(page);
  await page.waitForSelector('.m-ulayer [data-step="intro"]', { timeout: 15000 });
  await page.click('.m-ulayer [data-act="not-now"]');
  await until(async () => !(await view(page)).layer, 10000, 'setup closed');
  await sleep(300);
  let m = byTitle(await blob(page), 'Mike');
  assert(m && !m.enc && m.body === 'mike secret text' && (await readJson(page, RECORD)) === null, 'Later leaves the note plain and writes no keyring', m);
  assert((await wa(page)).length === 0 && (await store(page, 'quick_notes', 'cred_id')) == null, 'no old passkey made');
  await page.click('#qn-lock-btn');
  await answerDialog(page);
  await page.waitForSelector('.m-ulayer [data-step="intro"]', { timeout: 15000 });
  await page.click('.m-ulayer [data-act="next"]');
  await page.waitForSelector('.m-ulayer [data-step="code"] .m-ucode', { timeout: 15000 });
  const code = await page.$eval('.m-ulayer .m-ucode', (el) => el.textContent.replace(/\s+/g, '').trim());
  await page.type('.m-ulayer input[name="code-check"]', code.replace(/-/g, '').slice(-4));
  await page.waitForFunction(() => { const b = document.querySelector('.m-ulayer [data-act="next"]'); return b && !b.disabled; }, { timeout: 5000 });
  await page.click('.m-ulayer [data-act="next"]');
  await page.waitForFunction(() => { const s = document.querySelector('.m-ulayer [data-step]'); return s && (s.dataset.step === 'passkey' || s.dataset.step === 'no-prf'); }, { timeout: 20000 });
  const stepName = await page.$eval('.m-ulayer [data-step]', (el) => el.dataset.step);
  await page.click(stepName === 'passkey' ? '.m-ulayer [data-act="skip-passkey"]' : '.m-ulayer [data-act="done"]');
  const list = await waitBlob(page, (x) => { const n = byTitle(x, 'Mike'); return n && n.enc && n.kv === 2; }, 'Mike locked after setup', 30000);
  m = byTitle(list, 'Mike');
  const rec = await readJson(page, RECORD);
  assert(rec && rec.services.notes, 'setup linked notes', rec && rec.services);
  assert((await openV2(page, m)) === 'mike secret text', 'Mike opens with the linked key');
  assert((await wa(page)).length === 0 && (await store(page, 'quick_notes', 'cred_id')) == null, 'still no old passkey');
  await waitView(page, (x) => x.text === 'mike secret text' && !x.layer, 'Mike open after setup');
  await lockKeyring(page);
  await waitView(page, (x) => x.card, 'card after lock');
  await cardCode(page, '#qn-locked-card', code);
  await waitView(page, (x) => x.text === 'mike secret text', 'the code from setup opens it');
});

check('locked note opens after unlock elsewhere', async () => {
  const { page, code } = await notesKeyring();
  await writeNote(page, 'Echo', 'echo secret text', false);
  await lockActive(page, 'Echo', 'echo secret text');
  await waitView(page, (x) => x.text === 'echo secret text', 'Echo open');
  await lockKeyring(page);
  await waitView(page, (x) => x.card && x.raw === '' && x.text === null, 'card shown and text cleared after lock');
  const other = await open('/about/');
  await unlockKeyring(other, code);
  await waitView(page, (x) => x.text === 'echo secret text' && !x.card, 'unlock in another tab opens the note');
  await page.bringToFront();
  await page.focus('#qn-textarea');
  await page.keyboard.press('End');
  await page.type('#qn-textarea', ' tail');
  await lockKeyring(other);
  await waitView(page, (x) => x.card && x.raw === '', 'lock in another tab hides the note');
  await unlockKeyring(other, code);
  await waitView(page, (x) => x.text === 'echo secret text tail', 'typing before the lock was saved');
  const e = byTitle(await blob(page), 'Echo');
  assert((await openV2(page, e)) === 'echo secret text tail', 'stored copy has the typing', e);
});

check('readAll returns ciphertext for locked notes', async () => {
  const { page } = await notesKeyring();
  await writeNote(page, 'Delta', 'delta plain text', false);
  await writeNote(page, 'Foxtrot', 'foxtrot secret text', true);
  const { note } = await lockActive(page, 'Foxtrot', 'foxtrot secret text');
  await legacyNote(page, 'Golf', 'golf secret text');
  await waitView(page, (x) => x.text === 'foxtrot secret text', 'Foxtrot open');
  const other = await open('/about/');
  const ask = () => other.evaluate(async () => {
    const { MentriaBus } = await import('/assets/js/mentria-bus.js');
    return { all: await MentriaBus.invoke('notes.readAll'), list: await MentriaBus.invoke('notes.list') };
  });
  const verify = async (label) => {
    const cur = await blob(page);
    const fox = byTitle(cur, 'Foxtrot');
    const golf = byTitle(cur, 'Golf');
    const r = await ask();
    const a = r.all.find((x) => x.title === 'Foxtrot');
    const g = r.all.find((x) => x.title === 'Golf');
    const d = r.all.find((x) => x.title === 'Delta');
    const raw = JSON.stringify(r);
    assert(a && a.body === fox.body && !raw.includes('foxtrot secret') && !raw.includes('golf secret'), label + ': readAll and list carry only ciphertext for locked notes', r);
    assert(g && g.body === golf.body, label + ': old-style locked note as ciphertext', g);
    assert(d && d.body === 'delta plain text', label + ': plain notes as text', d);
  };
  await verify('open');
  assert(byTitle(await blob(page), 'Foxtrot').body === note.body, 'unchanged ciphertext');
  await lockKeyring(page);
  await waitView(page, (x) => x.card, 'card after lock');
  await verify('locked');
  const local = await page.evaluate(async () => {
    const { MentriaBus } = await import('/assets/js/mentria-bus.js');
    return JSON.stringify(await MentriaBus.invoke('notes.readAll'));
  });
  assert(!local.includes('foxtrot secret'), 'same answer in the notes tab');
});

check('legacy notes convert after one tap', async () => {
  await clean();
  const page = await open(NOTES);
  const auth = await authOn(page);
  await settle(page, 'old');
  await legacySeed(page);
  await legacyNote(page, 'Foreign', 'from another device');
  const before = await blob(page);
  const cred = await store(page, 'quick_notes', 'cred_id');
  assert(typeof cred === 'string' && (await auth.creds()).length === 1, 'one old passkey');
  await page.evaluate(SWITCH_ON);
  await reload(page, 'one');
  const code = await makeKeyring(page);
  await lockKeyring(page);
  await pick(page, 'Alpha');
  let v = await view(page);
  assert(v.panel && v.unlockBtn && v.link && v.link.includes(UN.link_title) && v.link.includes(UN.link_body) && !v.card, 'old lock UI with the link line', v);
  await resetWa(page);
  await page.click('#qn-unlock-btn');
  v = await waitView(page, (x) => x.card && x.later, 'card after the old tap while the keyring is locked', 30000);
  assert((await wa(page)).join() === 'get', 'exactly one old passkey tap', await wa(page));
  await cardCode(page, '#qn-locked-card', code);
  const after = await waitBlob(page, (x) => ['Alpha', 'Bravo'].every((t) => { const n = byTitle(x, t); return n && n.kv === 2; }), 'Alpha and Bravo converted', 30000);
  for (const t of ['Alpha', 'Bravo']) {
    const o = byTitle(before, t);
    const n = byTitle(after, t);
    assert(n.enc === true && n.iv !== o.iv && n.body !== o.body && n.updatedAt > o.updatedAt && n.id === o.id, t + ': fresh IV, new body, newer updatedAt', { o, n });
    assert((await openV2(page, n)) === t.toLowerCase() + ' secret text', t + ': opens with the notes key');
  }
  const f0 = byTitle(before, 'Foreign');
  const f1 = byTitle(after, 'Foreign');
  assert(JSON.stringify(f0) === JSON.stringify(f1), 'a note the old key cannot open is left untouched', { f0, f1 });
  assert(JSON.stringify(byTitle(before, 'Charlie')) === JSON.stringify(byTitle(after, 'Charlie')), 'plain note untouched');
  v = await waitView(page, (x) => x.text === 'alpha secret text', 'Alpha open after conversion');
  assert(v.convert === QN.convert_skipped.replace('{n}', '1'), 'skipped line', v);
  assert((await wa(page)).join() === 'get', 'no further passkey prompts', await wa(page));
  await pick(page, 'Bravo');
  await waitView(page, (x) => x.text === 'bravo secret text', 'Bravo opens without a tap');
  assert((await wa(page)).join() === 'get', 'still one tap');
  assert((await store(page, 'quick_notes', 'cred_id')) === cred && typeof (await store(page, 'quick_notes', 'salt')) === 'string', 'old lock kept while a note is unconverted');
  await pick(page, 'Foreign');
  v = await view(page);
  assert(v.panel && v.unlockBtn && v.link, 'unconverted note keeps the old unlock', v);
  await resetWa(page);
  await page.click('#qn-unlock-btn');
  await until(async () => (await wa(page)).length === 1, 15000, 'old key forgotten, so a new tap');
  await sleep(800);
  v = await view(page);
  assert(v.panel && v.convert === QN.convert_skipped.replace('{n}', '1') && !byTitle(await blob(page), 'Foreign').kv, 'still skipped', v);
  await reload(page, 'one');
  await resetWa(page);
  await pick(page, 'Alpha');
  await waitView(page, (x) => x.text === 'alpha secret text', 'converted note opens after reload with no tap');
  assert((await wa(page)).length === 0, 'no tap after reload');
  const log = logs.get(page);
  assert(!log.errors.length, 'no page errors', log.errors);
});

check('legacy notes keep working on Later and survive a failed write', async () => {
  await clean();
  const page = await open(NOTES);
  await authOn(page);
  await settle(page, 'old');
  await legacySeed(page);
  const before = await blob(page);
  await page.evaluate(SWITCH_ON);
  await reload(page, 'one');
  await pick(page, 'Alpha');
  await resetWa(page);
  await page.click('#qn-unlock-btn');
  await page.waitForSelector('.m-ulayer [data-step="intro"]', { timeout: 20000 });
  assert((await wa(page)).join() === 'get', 'one old tap before setup', await wa(page));
  await page.click('.m-ulayer [data-act="not-now"]');
  const lv = await waitView(page, (x) => x.text === 'alpha secret text' && !x.layer, 'Later opens the note the old way');
  assert(lv.lockTitle === QN.lock_title && lv.removeBtn === QN.remove_lock_btn, 'without a keyring the Lock title is the old one', lv);
  assert((await readJson(page, RECORD)) === null && JSON.stringify(await blob(page)) === JSON.stringify(before), 'Later writes nothing');
  await page.focus('#qn-textarea');
  await page.keyboard.press('End');
  await page.type('#qn-textarea', ' later');
  const edited = byTitle(await waitBlob(page, (x) => { const n = byTitle(x, 'Alpha'); return n && n.iv !== byTitle(before, 'Alpha').iv; }, 'edit saved the old way'), 'Alpha');
  assert(edited.enc && !('kv' in edited), 'edit kept under the old key while not linked', edited);
  const mid = await blob(page);
  await page.evaluate(() => {
    const S = window.MentriaStore;
    window.__set = S.set;
    S.set = (ns, k, val, o) => (ns === 'quick_notes' && k === 'blob' ? false : window.__set.call(S, ns, k, val, o));
  });
  await makeKeyring(page);
  await until(async () => { const r = await readJson(page, RECORD); return r && r.services && r.services.notes; }, 15000, 'notes linked for the conversion');
  await sleep(1200);
  assert(JSON.stringify(await blob(page)) === JSON.stringify(mid), 'a failed write leaves the old notes untouched');
  await waitView(page, (x) => x.text === 'alpha secret text later', 'note still open after the failed write');
  const held = await page.evaluate(async () => {
    const { MentriaBus } = await import('/assets/js/mentria-bus.js');
    return MentriaBus.invoke('notes.readAll');
  });
  assert(held.find((x) => x.title === 'Alpha').body === byTitle(mid, 'Alpha').body && held.find((x) => x.title === 'Bravo').body === byTitle(mid, 'Bravo').body, 'notes in memory stay the old copies after the failed write');
  await pick(page, 'Bravo');
  await waitView(page, (x) => x.text === 'bravo secret text', 'old key still held after the failed write');
  await pick(page, 'Alpha');
  await waitView(page, (x) => x.text === 'alpha secret text later', 'Alpha open again');
  await page.evaluate(() => { window.MentriaStore.set = window.__set; });
  await nudge(page);
  const after = await waitBlob(page, (x) => ['Alpha', 'Bravo'].every((t) => { const n = byTitle(x, t); return n && n.kv === 2; }), 'converted once writes work again', 20000);
  assert((await openV2(page, byTitle(after, 'Alpha'))) === 'alpha secret text later', 'Alpha converted with the edit');
  assert((await openV2(page, byTitle(after, 'Bravo'))) === 'bravo secret text', 'Bravo converted without a second tap');
  assert((await wa(page)).join() === 'get', 'one tap in all', await wa(page));
});

async function failBlobWrites(page, on) {
  await page.evaluate((v) => {
    const S = window.MentriaStore;
    if (!window.__set) window.__set = S.set;
    S.set = v ? (ns, k, val, o) => (ns === 'quick_notes' && k === 'blob' ? false : window.__set.call(S, ns, k, val, o)) : window.__set;
  }, on);
}

async function oneLegacy(page) {
  await writeNote(page, 'Alpha', 'alpha secret text', false);
  await page.click('#qn-lock-btn');
  await answerDialog(page);
  await waitBlob(page, (v) => { const n = byTitle(v, 'Alpha'); return n && n.enc === true && n.iv && n.body !== 'alpha secret text'; }, 'Alpha locked the old way', 60000);
}

async function failedConversion() {
  await clean();
  const page = await open(NOTES);
  await authOn(page);
  await settle(page, 'old');
  await oneLegacy(page);
  const before = await blob(page);
  await page.evaluate(SWITCH_ON);
  await reload(page, 'one');
  const code = await makeKeyring(page);
  await failBlobWrites(page, true);
  await pick(page, 'Alpha');
  await resetWa(page);
  await page.click('#qn-unlock-btn');
  await until(async () => { const r = await readJson(page, RECORD); return r && r.services && r.services.notes; }, 15000, 'notes linked for the conversion');
  await waitView(page, (x) => x.text === 'alpha secret text', 'Alpha open with the old key after the failed write', 20000);
  assert((await wa(page)).join() === 'get', 'one old tap', await wa(page));
  assert(JSON.stringify(await blob(page)) === JSON.stringify(before), 'stored notes unchanged');
  return { page, code, before };
}

check('conversion keeps later edits and deletions', async () => {
  await clean();
  const page = await open(NOTES);
  await authOn(page);
  await settle(page, 'old');
  await legacySeed(page);
  const before = await blob(page);
  await page.evaluate(SWITCH_ON);
  await reload(page, 'one');
  await makeKeyring(page);
  await pick(page, 'Alpha');
  const tClick = await page.evaluate(() => Date.now());
  await page.click('#qn-unlock-btn');
  const after = await waitBlob(page, (x) => ['Alpha', 'Bravo'].every((t) => { const n = byTitle(x, t); return n && n.kv === 2; }), 'converted', 30000);
  const a0 = byTitle(before, 'Alpha');
  const b0 = byTitle(before, 'Bravo');
  const other = await open('/about/');
  const sent = await other.evaluate((a, b, until) => {
    const now = Date.now();
    const tA = a.updatedAt + Math.floor((until - a.updatedAt) / 2);
    const tB = b.updatedAt + Math.floor((until - b.updatedAt) / 2);
    const edited = Object.assign({}, a, { updatedAt: tA, body: a.body.split('').reverse().join('') });
    window.MentriaStore.importAll({ version: 1, exportedAt: new Date().toISOString(), store: { 'quick_notes.blob': JSON.stringify([edited]), 'quick_notes.deleted': JSON.stringify({ [b.id]: tB }) }, legacy: {} }, { mode: 'merge' });
    return { tA, tB, now, edited };
  }, a0, b0, tClick);
  assert(sent.tA > a0.updatedAt + 1 && sent.tA < tClick && sent.tB > b0.updatedAt + 1 && sent.tB < tClick, 'edit and deletion fall after the old time and before the conversion', { sent, tClick });
  const merged = await blob(other);
  const ma = byTitle(merged, 'Alpha');
  assert(ma && ma.updatedAt === sent.tA && ma.body === sent.edited.body && !('kv' in ma), 'a later edit made elsewhere wins over the re-encryption', ma);
  assert(!byTitle(merged, 'Bravo'), 'a later deletion made elsewhere stays deleted', merged.map((n) => n.title));
  assert(byTitle(merged, 'Charlie'), 'plain note kept');
  assert(byTitle(after, 'Alpha').updatedAt === a0.updatedAt + 1 && byTitle(after, 'Bravo').updatedAt === b0.updatedAt + 1, 'conversion moves updatedAt by one', { a: [a0.updatedAt, byTitle(after, 'Alpha').updatedAt], b: [b0.updatedAt, byTitle(after, 'Bravo').updatedAt] });
  await reload(page, 'one');
  await until(async () => !(await page.evaluate(() => [...document.querySelectorAll('#qn-note-list .qn-note-tab__title')].some((t) => t.textContent === 'Bravo'))), 5000, 'Bravo gone from the list');
  const fin = await blob(page);
  assert(!byTitle(fin, 'Bravo') && byTitle(fin, 'Alpha').updatedAt === sent.tA, 'notes page keeps the merge', fin.map((n) => [n.title, n.updatedAt]));
});

check('retirement checks what is stored', async () => {
  const { page } = await failedConversion();
  await page.evaluate(() => {
    const rec = window.MentriaStore.get('keyring', 'vault');
    rec.services.notes.linked = new Date(Date.now() - 31 * 86400000).toISOString();
    window.MentriaStore.set('keyring', 'vault', rec);
  });
  await page.focus('#qn-textarea');
  await page.keyboard.press('End');
  await page.type('#qn-textarea', ' edit');
  await sleep(1500);
  const mem = await page.evaluate(async () => {
    const { MentriaBus } = await import('/assets/js/mentria-bus.js');
    return MentriaBus.invoke('notes.readAll');
  });
  const stored = byTitle(await blob(page), 'Alpha');
  assert(mem.find((x) => x.title === 'Alpha').body !== stored.body && !stored.kv, 'the save converted Alpha in memory only', { mem, stored });
  const ready = await runtime(page, 'retirement', { notesConverted: true });
  assert(ready.ready === true, 'only the notes block retirement here', ready);
  await nudge(page);
  await sleep(1500);
  let rec = await readJson(page, RECORD);
  assert(!(rec.retired && rec.retired.notes) && typeof (await store(page, 'quick_notes', 'cred_id')) === 'string' && typeof (await store(page, 'quick_notes', 'salt')) === 'string', 'nothing retired while the stored copy is old-style', rec.retired);
  assert((await page.evaluate(() => window.__signals.length)) === 0, 'no signal while the stored copy is old-style');
  await failBlobWrites(page, false);
  await page.type('#qn-textarea', '!');
  const saved = await waitBlob(page, (x) => { const n = byTitle(x, 'Alpha'); return n && n.kv === 2; }, 'Alpha saved under the notes key');
  assert((await openV2(page, byTitle(saved, 'Alpha'))) === 'alpha secret text edit!', 'stored copy opens with the notes key');
  await nudge(page);
  rec = await until(async () => { const r = await readJson(page, RECORD); return r && r.retired && r.retired.notes ? r : null; }, 15000, 'retired once the stored copy is converted');
  const left = await page.evaluate(() => ({ cred: window.MentriaStore.get('quick_notes', 'cred_id'), salt: window.MentriaStore.get('quick_notes', 'salt'), signals: window.__signals.length }));
  assert(left.cred == null && left.salt == null && left.signals === 1, 'old lock removed and signalled after a good write', left);
});

check('lock elsewhere drops the old key', async () => {
  const { page, code } = await failedConversion();
  const other = await open('/about/');
  await lockKeyring(other);
  await waitView(page, (x) => x.text === null && x.raw === '' && x.unlockBtn && x.link, 'old-style note hides when another tab locks');
  await failBlobWrites(page, false);
  await unlockKeyring(other, code);
  await sleep(1500);
  let v = await view(page);
  assert(v.text === null && v.unlockBtn && !byTitle(await blob(page), 'Alpha').kv, 'the old key is gone, so the note waits for a new tap', v);
  await page.bringToFront();
  await resetWa(page);
  await page.click('#qn-unlock-btn');
  const after = await waitBlob(page, (x) => { const n = byTitle(x, 'Alpha'); return n && n.kv === 2; }, 'converted after the new tap', 30000);
  assert((await wa(page)).join() === 'get' && (await openV2(page, byTitle(after, 'Alpha'))) === 'alpha secret text', 'one new tap converts it', await wa(page));
});

check('export and print leak no locked text while locked', async () => {
  const { page } = await notesKeyring();
  await writeNote(page, 'Delta', 'delta plain text', false);
  await writeNote(page, 'Foxtrot', 'foxtrot secret text', true);
  await lockActive(page, 'Foxtrot', 'foxtrot secret text');
  await waitView(page, (x) => x.text === 'foxtrot secret text', 'Foxtrot open');
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  assert((await page.$eval('#qn-print', (el) => el.textContent)).includes('foxtrot secret text'), 'print copy made while open');
  await lockKeyring(page);
  await waitView(page, (x) => x.card && x.raw === '', 'locked');
  const after = await page.evaluate(() => ({ print: document.getElementById('qn-print').textContent, html: document.documentElement.outerHTML.includes('foxtrot secret') }));
  assert(!after.print.includes('foxtrot secret') && !after.html, 'locking clears the print copy', after);
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await page.emulateMediaType('print');
  const printed = await page.evaluate(() => document.body.innerText);
  await page.emulateMediaType(null);
  assert(!printed.includes('foxtrot secret'), 'printing while locked shows no locked text');
  await page.evaluate(() => {
    window.__downloads = [];
    window.MentriaUI.downloadFile = (name, b) => { b.text().then((t) => window.__downloads.push({ name, t })); };
  });
  await page.click('#qn-export-all-btn');
  const got = await until(() => page.evaluate(() => window.__downloads[0] || null), 5000, 'export file');
  assert(got.t.includes('delta plain text') && !got.t.includes('foxtrot secret'), 'Export all leaves the locked note out', got);
  await until(async () => (await page.evaluate(() => [...document.querySelectorAll('.m-toast')].map((t) => t.textContent).join(' '))).includes(QN.export_all_skipped.replace('{n}', '1')), 5000, 'skipped toast');
});

check('missing keys are never replaced', async () => {
  const { page } = await notesKeyring();
  await writeNote(page, 'Juliet', 'juliet secret text', false);
  await lockActive(page, 'Juliet', 'juliet secret text');
  await page.evaluate(() => {
    const rec = window.MentriaStore.get('keyring', 'vault');
    rec.services = {};
    window.MentriaStore.set('keyring', 'vault', rec);
  });
  await reload(page, 'one');
  await pick(page, 'Juliet');
  let v = await waitView(page, (x) => x.panel && x.note === QN.key_missing, 'note whose key is not here says so');
  assert(!v.unlockBtn && !v.card, 'no unlock offered for it', v);
  await writeNote(page, 'Kappa', 'kappa plain text', true);
  await resetWa(page);
  await page.click('#qn-lock-btn');
  await answerDialog(page);
  const alert = await answerDialog(page);
  assert(alert === QN.lock_key_missing, 'locking says another note\'s key is missing', alert);
  await sleep(500);
  const rec = await readJson(page, RECORD);
  assert(!rec.services.notes, 'no new notes key linked over notes that need the old one', rec.services);
  assert(!byTitle(await blob(page), 'Kappa').enc, 'Kappa stays plain');
  await legacyNote(page, 'Lambda', 'lambda text');
  await reload(page, 'one');
  await pick(page, 'Lambda');
  v = await view(page);
  assert(v.unlockBtn && v.link, 'old note offers the old unlock', v);
  await page.click('#qn-unlock-btn');
  v = await waitView(page, (x) => x.convert === QN.convert_skipped.replace('{n}', '1'), 'no old lock here: counted as not opened');
  assert((await wa(page)).length === 0, 'no passkey made or asked in keyring mode', await wa(page));
  assert((await store(page, 'quick_notes', 'salt')) == null && (await store(page, 'quick_notes', 'cred_id')) == null, 'no old salt or cred_id created');
});

check('old lock retires once every note converted', async () => {
  const { page } = await notesKeyring([FAIL_REMOVE]);
  await writeNote(page, 'Hotel', 'hotel secret text', false);
  await lockActive(page, 'Hotel', 'hotel secret text');
  const credStd = btoa(String.fromCharCode(0xfb, 0xff, 0xfe, 0x01, 0x02, 0x03, 0xfb, 0xef, 0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x70, 0x80));
  const credUrl = credStd.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  await page.evaluate((c) => {
    const salt = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
    window.MentriaStore.set('quick_notes', 'salt', salt);
    window.MentriaStore.set('quick_notes', 'cred_id', c);
    localStorage.setItem('mentria-qn-salt', salt);
    localStorage.setItem('mentria-qn-cred', c);
    const rec = window.MentriaStore.get('keyring', 'vault');
    rec.services.notes.linked = new Date(Date.now() - 31 * 86400000).toISOString();
    window.MentriaStore.set('keyring', 'vault', rec);
  }, credStd);
  await legacyNote(page, 'India', 'india text');
  await reload(page, 'one');
  await pick(page, 'Hotel');
  await waitView(page, (x) => x.text === 'hotel secret text', 'Hotel open');
  await sleep(1500);
  let rec = await readJson(page, RECORD);
  assert(!(rec.retired && rec.retired.notes) && (await store(page, 'quick_notes', 'cred_id')) === credStd && (await page.evaluate(() => localStorage.getItem('mentria-qn-cred'))) === credStd, 'an unconverted note keeps the old lock', rec.retired);
  assert((await page.evaluate(() => window.__signals.length)) === 0, 'no signal yet');
  const blocked = await runtime(page, 'retirement', { notesConverted: true });
  assert(blocked.ready === true, 'nothing else blocks retirement in this setup', blocked);
  await page.evaluate(() => {
    const list = JSON.parse(localStorage.getItem('mentria.store.quick_notes.blob')).filter((n) => n.title !== 'India');
    window.MentriaStore.set('quick_notes', 'blob', list);
    sessionStorage.setItem('t-fail-remove', '1');
  });
  await reload(page, 'one');
  await pick(page, 'Hotel');
  await waitView(page, (x) => x.text === 'hotel secret text', 'Hotel open while removals fail');
  await sleep(1500);
  const kept = await page.evaluate(() => ({ cred: window.MentriaStore.get('quick_notes', 'cred_id'), signals: window.__signals.length }));
  rec = await readJson(page, RECORD);
  assert(kept.cred === credStd && kept.signals === 0 && !(rec.retired && rec.retired.notes), 'no signal and no retired mark when the removals fail', { kept, retired: rec.retired });
  await page.evaluate(() => sessionStorage.removeItem('t-fail-remove'));
  await reload(page, 'one');
  rec = await until(async () => { const r = await readJson(page, RECORD); return r && r.retired && r.retired.notes ? r : null; }, 15000, 'notes marked retired');
  const left = await page.evaluate(() => ({
    salt: window.MentriaStore.get('quick_notes', 'salt'),
    cred: window.MentriaStore.get('quick_notes', 'cred_id'),
    lsSalt: localStorage.getItem('mentria-qn-salt'),
    lsCred: localStorage.getItem('mentria-qn-cred'),
    signals: window.__signals
  }));
  assert(left.salt == null && left.cred == null && left.lsSalt == null && left.lsCred == null, 'old salt and credential ids deleted', left);
  assert(left.signals.length === 1 && left.signals[0].credentialId === credUrl && left.signals[0].rpId === 'localhost', 'old passkey signalled unknown in base64url', left.signals);
  const blobNow = await blob(page);
  assert(blobNow.some((n) => n.title === 'Hotel' && n.kv === 2), 'notes kept');
  await pick(page, 'Hotel');
  await waitView(page, (x) => x.text === 'hotel secret text', 'Hotel still opens after retirement');
});

let failed = 0;
const ONLY = process.env.ONLY || '';
const run = checks.filter(([n]) => !ONLY || n.includes(ONLY));
for (const [name, fn] of run) {
  try {
    await fn();
    console.log('PASS ' + name);
  } catch (e) {
    failed++;
    console.log('FAIL ' + name + ': ' + String(e && e.message || e).slice(0, 700));
  }
}
console.log((run.length - failed) + '/' + run.length + ' passed');
await browser.close();
await srv.close();
rmSync(PROFILE, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
