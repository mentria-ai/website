import { rmSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { serve } from './unlock-serve.mjs';

const BUILD = process.argv[2];
if (!BUILD) { console.log('usage: node scripts/unlock-notes-check.mjs <production build>'); process.exit(2); }
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
const WATCH_REMOVE = () => {
  window.__removed = [];
  let held;
  Object.defineProperty(window, 'MentriaStore', {
    configurable: true,
    get() { return held; },
    set(x) {
      if (x && typeof x.remove === 'function') {
        const r = x.remove;
        x.remove = (ns, k, o) => {
          if (ns === 'quick_notes') window.__removed.push(k);
          return r.call(x, ns, k, o);
        };
      }
      if (x && typeof x.set === 'function') {
        const w = x.set;
        x.set = (ns, k, v, o) => {
          if (ns === 'keyring' && k === 'vault' && sessionStorage.getItem('t-fail-record') === '1') {
            window.__recordFails = (window.__recordFails || 0) + 1;
            return false;
          }
          return w.call(x, ns, k, v, o);
        };
      }
      held = x;
    }
  });
};
const NOPRF = () => {
  const c = navigator.credentials;
  if (!c) return;
  const get = c.get.bind(c);
  c.get = (o) => {
    const pk = o && o.publicKey;
    const id = pk && pk.allowCredentials && pk.allowCredentials[0] && pk.allowCredentials[0].id;
    const skip = sessionStorage.getItem('t-noprf');
    if (skip && id && btoa(String.fromCharCode(...new Uint8Array(id))) === skip) {
      const plain = Object.assign({}, pk);
      delete plain.extensions;
      return get({ publicKey: plain });
    }
    return get(o);
  };
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

let runtimeOff = false;
const blocked = new Map();

async function blockRuntime(page) {
  const s = await page.createCDPSession();
  await s.send('Network.enable');
  await page.setBypassServiceWorker(true);
  await s.send('Network.setBlockedURLs', { urls: ['*' + MODULE + '*'] });
  blocked.set(page, s);
}

async function runtimeOn() {
  runtimeOff = false;
  for (const [p, s] of blocked) if (!p.isClosed()) await s.send('Network.setBlockedURLs', { urls: [] }).catch(() => {});
  blocked.clear();
}

async function clean() {
  runtimeOff = false;
  blocked.clear();
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
  if (runtimeOff) await blockRuntime(page);
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
      readOnly: document.getElementById('qn-textarea').readOnly,
      titleReadOnly: document.getElementById('qn-title-input').readOnly,
      readOnlyLine: shown(document.getElementById('qn-readonly')) ? document.getElementById('qn-readonly').textContent.trim() : null,
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

const OTHER_DEVICE = async (title, text, pairOnly) => {
  const b = (u) => btoa(String.fromCharCode(...new Uint8Array(u)));
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const prf = { prf: { eval: { first: salt } } };
  const cred = await navigator.credentials.create({ publicKey: { challenge: crypto.getRandomValues(new Uint8Array(32)), rp: { name: 'Mentria Quick Notes' }, user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'quick-notes', displayName: 'Quick Notes' }, pubKeyCredParams: [{ type: 'public-key', alg: -7 }], authenticatorSelection: { residentKey: 'required', userVerification: 'required' }, extensions: prf } });
  if (pairOnly) return { salt: b(salt), cred: b(cred.rawId) };
  const r = cred.getClientExtensionResults().prf;
  let first = r && r.results && r.results.first;
  if (!first) {
    const a = await navigator.credentials.get({ publicKey: { challenge: crypto.getRandomValues(new Uint8Array(32)), allowCredentials: [{ type: 'public-key', id: cred.rawId }], userVerification: 'required', extensions: prf } });
    first = a.getClientExtensionResults().prf.results.first;
  }
  const key = await crypto.subtle.importKey('raw', first, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
  const now = Date.now();
  const note = { id: 'other' + now.toString(36), title, body: b(ct), iv: b(iv), enc: true, salt: b(salt), credId: b(cred.rawId), createdAt: now, updatedAt: now };
  const S = window.MentriaStore;
  S.set('quick_notes', 'salt', note.salt, { remote: true });
  S.set('quick_notes', 'cred_id', note.credId, { remote: true });
  const list = JSON.parse(localStorage.getItem('mentria.store.quick_notes.blob') || '[]');
  S.set('quick_notes', 'blob', list.concat([note]), { remote: true });
  return { salt: note.salt, cred: note.credId, note };
};

async function oldLock(page, title, text) {
  await page.click('#qn-lock-btn');
  const msg = await answerDialog(page);
  assert(msg === QN.confirm_lock, title + ': old confirm text', msg);
  const list = await waitBlob(page, (v) => { const n = byTitle(v, title); return n && n.enc === true && n.iv && n.body !== text; }, title + ' locked the old way', 60000);
  return byTitle(list, title);
}

async function unlockOld(page, title, text) {
  await pick(page, title);
  const v = await view(page);
  if (v.text !== text) {
    assert(v.panel && v.unlockBtn, title + ': old locked panel', v);
    await page.click('#qn-unlock-btn');
  }
  return waitView(page, (x) => x.text === text, title + ' opens with its passkey', 30000);
}

const PAIR = 'mentria.qn.pair';

const SYNC_PAIR = (p) => {
  const S = window.MentriaStore;
  S.set('quick_notes', 'salt', p.salt, { remote: true });
  S.set('quick_notes', 'cred_id', p.cred, { remote: true });
};

async function stripPairs(page, titles) {
  await page.evaluate((ts) => {
    const cur = JSON.parse(localStorage.getItem('mentria.store.quick_notes.blob'));
    for (const n of cur) if (ts.includes(n.title)) { delete n.salt; delete n.credId; }
    window.MentriaStore.set('quick_notes', 'blob', cur);
  }, titles);
}

async function storedPair(page) {
  return { salt: await store(page, 'quick_notes', 'salt'), cred: await store(page, 'quick_notes', 'cred_id') };
}

async function typeEnd(page, text) {
  await page.focus('#qn-textarea');
  await page.keyboard.press('End');
  await page.type('#qn-textarea', text);
}

const b64u = (s) => s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const gonePair = () => ({ salt: randomBytes(32).toString('base64'), cred: randomBytes(16).toString('base64') });

const pairShape = (p) => JSON.stringify({ salt: p.salt, credId: p.cred });

async function preFixNote(page, title, text) {
  await writeNote(page, title, text, false);
  await oldLock(page, title, text);
  const mine = await storedPair(page);
  await stripPairs(page, [title]);
  await page.evaluate((k) => localStorage.removeItem(k), PAIR);
  return mine;
}

async function leaveNotes(page) {
  await page.goto(ORIGIN + '/privacy/', { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.MentriaStore, { timeout: 10000 });
}

async function backToNotes(page) {
  await page.goto(ORIGIN + NOTES, { waitUntil: 'load' });
  await settle(page, 'old');
}

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
  const page = await open(NOTES, ...(extra || []));
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

check('Quick Notes keeps the old flow while the one unlock cannot load, and runs the one unlock with no switch', async () => {
  {
    const label = 'no one unlock';
    await clean();
    runtimeOff = true;
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
    assert(log.requests.some((u) => new URL(u).pathname === MODULE) && (await page.evaluate(() => document.getElementById('qn-tool').dataset.lock)) === 'old', label + ': the page tries the one unlock and, when it cannot load, keeps the old way');
    const dbs = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
    assert(!dbs.includes('mentria-keyring') && (await readJson(page, RECORD)) === null, label + ': no keyring storage touched', dbs);
    assert(!log.errors.length, label + ': no page errors', log.errors);
    assert((await readJson(page, LOCAL)) === null, 'no switch is seeded');
    await runtimeOn();
    log.requests.length = 0;
    await reload(page, 'one');
    assert(log.requests.some((u) => new URL(u).pathname === MODULE), 'with no switch the page loads the one unlock');
    await pick(page, 'New kind');
    v = await view(page);
    assert(v.panel && v.note !== QN.one_unlock_off, 'a note locked with the one unlock is no longer called off', v);
    await pick(page, 'Old');
    v = await view(page);
    assert(v.panel && v.unlockBtn && v.link && v.link.includes(UN.link_title), 'an old lock shows the line that brings it into the one unlock', v);
    assert(!/"enabled"/.test(JSON.stringify((await readJson(page, LOCAL)) || {})), 'nothing writes a switch');
  }
});

check('old locks keep their own salt and passkey through a sync', async () => {
  try {
    await clean();
    runtimeOff = true;
    const page = await open(NOTES);
    const auth = await authOn(page);
    await settle(page, 'old');
    await writeNote(page, 'One', 'one secret text', false);
    await oldLock(page, 'One', 'one secret text');
    const mine = { salt: await store(page, 'quick_notes', 'salt'), cred: await store(page, 'quick_notes', 'cred_id') };
    assert(typeof mine.salt === 'string' && typeof mine.cred === 'string', 'device A made its salt and passkey', mine);
    const other = await page.evaluate(OTHER_DEVICE, 'Two', 'two secret text');
    assert(other.salt !== mine.salt && other.cred !== mine.cred, 'the other device has its own salt and passkey');
    await waitBlob(page, (v) => !!byTitle(v, 'Two'), 'Two arrived by sync');
    assert((await store(page, 'quick_notes', 'salt')) === other.salt && (await store(page, 'quick_notes', 'cred_id')) === other.cred, 'the sync replaced the stored salt and cred_id');
    await resetWa(page);
    await writeNote(page, 'Three', 'three secret text', true);
    await oldLock(page, 'Three', 'three secret text');
    assert((await wa(page)).length === 0, 'locking in the same visit asks no passkey', await wa(page));
    await reload(page, 'old');
    await resetWa(page);
    await unlockOld(page, 'One', 'one secret text');
    await unlockOld(page, 'Three', 'three secret text');
    assert((await wa(page)).join() === 'get', 'One and Three open with one tap of the first passkey', await wa(page));
    await unlockOld(page, 'Two', 'two secret text');
    assert((await wa(page)).join() === 'get,get', 'Two opens with its own passkey', await wa(page));
    assert((await auth.creds()).length === 2, 'two passkeys on the authenticator');
    const list = await blob(page);
    for (const [t, want] of [['One', mine], ['Three', mine], ['Two', other]]) {
      const n = byTitle(list, t);
      assert(n.salt === want.salt && n.credId === want.cred, t + ' records the salt and passkey it was locked with', n);
    }
    assert((await store(page, 'quick_notes', 'salt')) === other.salt && (await store(page, 'quick_notes', 'cred_id')) === other.cred, 'the synced salt and cred_id are not replaced');
    const two = byTitle(list, 'Two');
    await page.focus('#qn-textarea');
    await page.keyboard.press('End');
    await page.type('#qn-textarea', ' edit');
    await waitBlob(page, (x) => { const n = byTitle(x, 'Two'); return n && n.iv !== two.iv; }, 'Two edit saved');
    await sleep(800);
    const edited = byTitle(await blob(page), 'Two');
    assert(edited.enc && !('kv' in edited) && edited.salt === other.salt && edited.credId === other.cred, 'an edit keeps the salt and passkey of the note', edited);
    await page.evaluate(() => {
      const cur = JSON.parse(localStorage.getItem('mentria.store.quick_notes.blob'));
      for (const n of cur) if (n.title === 'Two') { delete n.salt; delete n.credId; }
      window.MentriaStore.set('quick_notes', 'blob', cur);
    });
    await reload(page, 'old');
    await resetWa(page);
    await unlockOld(page, 'Two', 'two secret text edit');
    assert((await wa(page)).join() === 'get', 'a note without its own salt and passkey opens with the stored ones', await wa(page));
    const log = logs.get(page);
    assert(!log.errors.length, 'no page errors', log.errors);
  } finally {
    runtimeOff = false;
  }
});

check('a note with stale salt and passkey opens with the stored ones', async () => {
  try {
    await clean();
    runtimeOff = true;
    const page = await open(NOTES);
    await authOn(page);
    await settle(page, 'old');
    await writeNote(page, 'Stale', 'stale secret text', false);
    await oldLock(page, 'Stale', 'stale secret text');
    const mine = { salt: await store(page, 'quick_notes', 'salt'), cred: await store(page, 'quick_notes', 'cred_id') };
    const stale = await page.evaluate(OTHER_DEVICE, '', '', true);
    assert(stale.salt !== mine.salt && stale.cred !== mine.cred, 'a second salt and passkey', stale);
    await page.evaluate((p) => {
      const cur = JSON.parse(localStorage.getItem('mentria.store.quick_notes.blob'));
      for (const n of cur) if (n.title === 'Stale') { n.salt = p.salt; n.credId = p.cred; }
      window.MentriaStore.set('quick_notes', 'blob', cur);
    }, stale);
    assert((await store(page, 'quick_notes', 'salt')) === mine.salt && (await store(page, 'quick_notes', 'cred_id')) === mine.cred, 'the stored salt and cred_id are the ones the note was locked with');
    const locked = byTitle(await blob(page), 'Stale');
    await reload(page, 'old');
    await resetWa(page);
    await unlockOld(page, 'Stale', 'stale secret text');
    assert((await wa(page)).join() === 'get,get', 'the stale passkey is tried, then the stored one once', await wa(page));
    const before = await waitBlob(page, (x) => { const n = byTitle(x, 'Stale'); return n && n.salt === mine.salt; }, 'opening records the salt and passkey that opened it').then((x) => byTitle(x, 'Stale'));
    assert(before.credId === mine.cred && before.updatedAt === locked.updatedAt + 1 && before.iv === locked.iv, 'opening records the pair with updatedAt + 1 and keeps the sealed text', { before, locked });
    await page.focus('#qn-textarea');
    await page.keyboard.press('End');
    await page.type('#qn-textarea', ' edit');
    await waitBlob(page, (x) => { const n = byTitle(x, 'Stale'); return n && n.iv !== before.iv; }, 'Stale edit saved');
    await sleep(800);
    const saved = byTitle(await blob(page), 'Stale');
    assert(saved.salt === mine.salt && saved.credId === mine.cred, 'the next save records the salt and passkey that opened it', saved);
    await reload(page, 'old');
    await resetWa(page);
    await unlockOld(page, 'Stale', 'stale secret text edit');
    assert((await wa(page)).join() === 'get', 'after the save one tap of the stored passkey opens it', await wa(page));
    const log = logs.get(page);
    assert(!log.errors.length, 'no page errors', log.errors);
  } finally {
    runtimeOff = false;
  }
});

check('a sync during a visit keeps old notes opening and their edits saved', async () => {
  try {
    await clean();
    runtimeOff = true;
    const page = await open(NOTES);
    await authOn(page);
    await settle(page, 'old');
    await writeNote(page, 'Alpha', 'alpha secret text', false);
    await oldLock(page, 'Alpha', 'alpha secret text');
    await writeNote(page, 'Bravo', 'bravo secret text', true);
    await oldLock(page, 'Bravo', 'bravo secret text');
    const mine = await storedPair(page);
    await stripPairs(page, ['Alpha', 'Bravo']);
    await reload(page, 'old');
    await resetWa(page);
    await unlockOld(page, 'Alpha', 'alpha secret text');
    assert((await wa(page)).join() === 'get', 'one tap opens Alpha', await wa(page));
    const other = await page.evaluate(OTHER_DEVICE, '', '', true);
    await page.evaluate(SYNC_PAIR, other);
    await page.evaluate((k) => localStorage.removeItem(k), PAIR);
    assert((await store(page, 'quick_notes', 'salt')) === other.salt, 'a sync replaced the stored salt and cred_id');
    const a0 = byTitle(await blob(page), 'Alpha');
    await resetWa(page);
    await typeEnd(page, ' edit');
    await waitBlob(page, (x) => { const n = byTitle(x, 'Alpha'); return n && n.iv !== a0.iv; }, 'the edit to Alpha is saved after the sync');
    await sleep(800);
    const a1 = byTitle(await blob(page), 'Alpha');
    assert(a1.enc && !('kv' in a1) && a1.salt === mine.salt && a1.credId === mine.cred, 'Alpha is sealed again with the passkey that opened it', a1);
    await pick(page, 'Bravo');
    await waitView(page, (x) => x.text === 'bravo secret text', 'Bravo opens with the passkey already held this visit');
    const b0 = byTitle(await blob(page), 'Bravo');
    await typeEnd(page, ' edit');
    await waitBlob(page, (x) => { const n = byTitle(x, 'Bravo'); return n && n.iv !== b0.iv; }, 'the edit to Bravo is saved');
    await sleep(800);
    const b1 = byTitle(await blob(page), 'Bravo');
    assert(b1.salt === mine.salt && b1.credId === mine.cred, 'Bravo is sealed with the passkey that opened it', b1);
    assert((await wa(page)).length === 0, 'no passkey asked after the sync', await wa(page));
    await reload(page, 'old');
    await resetWa(page);
    await unlockOld(page, 'Alpha', 'alpha secret text edit');
    await unlockOld(page, 'Bravo', 'bravo secret text edit');
    assert((await wa(page)).join() === 'get', 'both open again with one tap of their own passkey', await wa(page));
    const log = logs.get(page);
    assert(!log.errors.length, 'no page errors', log.errors);
  } finally {
    runtimeOff = false;
  }
});

check('old notes without a pair find this device\'s pair after a sync', async () => {
  try {
    await clean();
    runtimeOff = true;
    const page = await open(NOTES);
    await authOn(page);
    await settle(page, 'old');
    await writeNote(page, 'Alpha', 'alpha secret text', false);
    await oldLock(page, 'Alpha', 'alpha secret text');
    const mine = await storedPair(page);
    await stripPairs(page, ['Alpha']);
    await page.evaluate((k) => localStorage.removeItem(k), PAIR);
    await reload(page, 'old');
    assert(JSON.stringify(await readJson(page, PAIR)) === JSON.stringify({ salt: mine.salt, credId: mine.cred }), 'loading keeps this device\'s pair on the device', await readJson(page, PAIR));
    const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes('quick_notes')).sort());
    assert(!keys.some((k) => k.includes('pair')), 'the pair is not a synced key', keys);
    const other = await page.evaluate(OTHER_DEVICE, '', '', true);
    await page.evaluate(SYNC_PAIR, other);
    const a0 = byTitle(await blob(page), 'Alpha');
    await reload(page, 'old');
    assert(JSON.stringify(await readJson(page, PAIR)) === JSON.stringify({ salt: mine.salt, credId: mine.cred }), 'a synced pair does not replace this device\'s pair', await readJson(page, PAIR));
    await resetWa(page);
    await unlockOld(page, 'Alpha', 'alpha secret text');
    assert((await wa(page)).join() === 'get,get', 'the synced passkey is tried, then this device\'s', await wa(page));
    const a1 = byTitle(await waitBlob(page, (x) => { const n = byTitle(x, 'Alpha'); return n && n.salt === mine.salt; }, 'the first open records the pair'), 'Alpha');
    assert(a1.credId === mine.cred && a1.updatedAt === a0.updatedAt + 1 && a1.iv === a0.iv && a1.body === a0.body, 'the first open records the pair with updatedAt + 1 and nothing else', { a0, a1 });
    await reload(page, 'old');
    await resetWa(page);
    await unlockOld(page, 'Alpha', 'alpha secret text');
    assert((await wa(page)).join() === 'get', 'after that one tap of its own passkey opens it', await wa(page));
    await reload(page, 'old');
    await resetWa(page);
    await writeNote(page, 'Charlie', 'charlie secret text', true);
    await oldLock(page, 'Charlie', 'charlie secret text');
    const c = byTitle(await blob(page), 'Charlie');
    assert(c.salt === mine.salt && c.credId === mine.cred, 'a new lock uses this device\'s pair while the stored one came from elsewhere', c);
    assert((await wa(page)).join() === 'get', 'one tap of this device\'s passkey, none made', await wa(page));
    assert((await store(page, 'quick_notes', 'salt')) === other.salt && (await store(page, 'quick_notes', 'cred_id')) === other.cred, 'the synced salt and cred_id stay', await storedPair(page));
    const log = logs.get(page);
    assert(!log.errors.length, 'no page errors', log.errors);
  } finally {
    runtimeOff = false;
  }
});

check('a pair replaced while Quick Notes is closed keeps old notes opening', async () => {
  try {
    for (const how of ['sync', 'import']) {
      await clean();
      runtimeOff = true;
      const page = await open(NOTES);
      await authOn(page);
      await settle(page, 'old');
      const mine = await preFixNote(page, 'Alpha', 'alpha secret text');
      await leaveNotes(page);
      const other = await page.evaluate(OTHER_DEVICE, '', '', true);
      if (how === 'sync') await page.evaluate(SYNC_PAIR, other);
      else {
        await page.evaluate((p) => window.MentriaStore.importAll({
          version: 1,
          exportedAt: new Date().toISOString(),
          store: { 'quick_notes.salt': JSON.stringify(p.salt), 'quick_notes.cred_id': JSON.stringify(p.cred) },
          legacy: {}
        }, { mode: 'merge' }), other);
      }
      assert(JSON.stringify(await storedPair(page)) === JSON.stringify(other), how + ': the other device\'s salt and cred_id are stored', await storedPair(page));
      await backToNotes(page);
      assert(JSON.stringify(await readJson(page, PAIR)) === pairShape(mine), how + ': this device\'s pair was kept when it was replaced', await readJson(page, PAIR));
      await resetWa(page);
      await unlockOld(page, 'Alpha', 'alpha secret text');
      assert((await wa(page)).join() === 'get,get', how + ': the synced passkey is tried, then this device\'s', await wa(page));
      const log = logs.get(page);
      assert(!log.errors.length, how + ': no page errors', log.errors);
    }
  } finally {
    runtimeOff = false;
  }
});

check('a pair a sync replaced before this release is found in the sync rescue', async () => {
  try {
    await clean();
    runtimeOff = true;
    const page = await open(NOTES);
    await authOn(page);
    await settle(page, 'old');
    const mine = await preFixNote(page, 'Alpha', 'alpha secret text');
    await leaveNotes(page);
    const other = await page.evaluate(OTHER_DEVICE, '', '', true);
    await page.evaluate((m, o) => {
      const raw = (v) => JSON.stringify(v);
      localStorage.setItem('mentria-sync-rescue', JSON.stringify({ v: 2, at: Date.now(), entries: { 'quick_notes.salt': { raw: raw(m.salt), meta: null }, 'quick_notes.cred_id': { raw: raw(m.cred), meta: null } } }));
      localStorage.setItem('mentria.store.quick_notes.salt', raw(o.salt));
      localStorage.setItem('mentria.store.quick_notes.cred_id', raw(o.cred));
    }, mine, other);
    assert((await readJson(page, PAIR)) === null, 'harness: no device pair stored yet');
    await backToNotes(page);
    assert(JSON.stringify(await readJson(page, PAIR)) === pairShape(mine), 'the device pair comes from the sync rescue', await readJson(page, PAIR));
    await resetWa(page);
    await unlockOld(page, 'Alpha', 'alpha secret text');
    assert((await wa(page)).join() === 'get,get', 'the synced passkey is tried, then the one the rescue kept', await wa(page));
    const log = logs.get(page);
    assert(!log.errors.length, 'no page errors', log.errors);
  } finally {
    runtimeOff = false;
  }
});

check('a new lock uses the stored passkey when this device\'s passkey does not answer', async () => {
  try {
    await clean();
    runtimeOff = true;
    const page = await open(NOTES, NOPRF);
    await authOn(page);
    await settle(page, 'old');
    await writeNote(page, 'Alpha', 'alpha secret text', false);
    await oldLock(page, 'Alpha', 'alpha secret text');
    const mine = await storedPair(page);
    const cases = [['gone', 'Bravo', gonePair()], ['no extension', 'Charlie', await page.evaluate(OTHER_DEVICE, '', '', true)]];
    for (const [how, title, dev] of cases) {
      await page.evaluate((k, p, noprf) => {
        localStorage.setItem(k, JSON.stringify({ salt: p.salt, credId: p.cred }));
        if (noprf) sessionStorage.setItem('t-noprf', p.cred);
        else sessionStorage.removeItem('t-noprf');
      }, PAIR, dev, how === 'no extension');
      await reload(page, 'old');
      await writeNote(page, title, title.toLowerCase() + ' secret text', true);
      await resetWa(page);
      await page.click('#qn-lock-btn');
      assert((await answerDialog(page)) === QN.confirm_lock, how + ': old confirm text');
      const list = await waitBlob(page, (v) => { const n = byTitle(v, title); return n && n.enc === true && n.iv; }, how + ': ' + title + ' locked with the stored passkey', 20000);
      const n = byTitle(list, title);
      assert(n.salt === mine.salt && n.credId === mine.cred, how + ': the note records the stored pair', n);
      assert((await wa(page)).join() === 'get,get', how + ': this device\'s passkey is tried, then the stored one', await wa(page));
      await sleep(300);
      assert(!(await dialogOpen(page)), how + ': no message');
    }
    await page.evaluate(() => sessionStorage.removeItem('t-noprf'));
    await reload(page, 'old');
    await resetWa(page);
    await unlockOld(page, 'Bravo', 'bravo secret text');
    await unlockOld(page, 'Charlie', 'charlie secret text');
    assert((await wa(page)).join() === 'get', 'both open with one tap of the stored passkey', await wa(page));
    const log = logs.get(page);
    assert(!log.errors.length, 'no page errors', log.errors);
  } finally {
    runtimeOff = false;
  }
});

check('old notes open when the stored or their own passkey is not on this device', async () => {
  try {
    await clean();
    runtimeOff = true;
    const page = await open(NOTES);
    await authOn(page);
    await settle(page, 'old');
    await writeNote(page, 'Alpha', 'alpha secret text', false);
    await oldLock(page, 'Alpha', 'alpha secret text');
    await writeNote(page, 'Bravo', 'bravo secret text', true);
    await oldLock(page, 'Bravo', 'bravo secret text');
    const mine = await storedPair(page);
    await stripPairs(page, ['Alpha']);
    const gone = gonePair();
    await page.evaluate((p) => {
      const cur = JSON.parse(localStorage.getItem('mentria.store.quick_notes.blob'));
      for (const n of cur) if (n.title === 'Bravo') { n.salt = p.salt; n.credId = p.cred; }
      window.MentriaStore.set('quick_notes', 'blob', cur);
    }, gone);
    await reload(page, 'old');
    await resetWa(page);
    await unlockOld(page, 'Bravo', 'bravo secret text');
    assert((await wa(page)).join() === 'get,get', 'its own passkey is not here, so the stored one opens it', await wa(page));
    const b = byTitle(await waitBlob(page, (x) => { const n = byTitle(x, 'Bravo'); return n && n.credId === mine.cred; }, 'Bravo records the pair that opened it'), 'Bravo');
    assert(b.salt === mine.salt, 'Bravo records the stored salt', b);
    await page.evaluate(SYNC_PAIR, gone);
    assert(JSON.stringify(await readJson(page, PAIR)) === pairShape(mine), 'this device\'s pair stays', await readJson(page, PAIR));
    await reload(page, 'old');
    await resetWa(page);
    await unlockOld(page, 'Alpha', 'alpha secret text');
    assert((await wa(page)).join() === 'get,get', 'the stored passkey is not here, so this device\'s opens it', await wa(page));
    await sleep(300);
    assert(!(await dialogOpen(page)), 'no message');
    const log = logs.get(page);
    assert(!log.errors.length, 'no page errors', log.errors);
  } finally {
    runtimeOff = false;
  }
});

check('an old unlock moves on when a passkey answers without the extension', async () => {
  try {
    await clean();
    runtimeOff = true;
    const page = await open(NOTES, NOPRF);
    await authOn(page);
    await settle(page, 'old');
    await writeNote(page, 'Alpha', 'alpha secret text', false);
    await oldLock(page, 'Alpha', 'alpha secret text');
    const mine = await storedPair(page);
    await stripPairs(page, ['Alpha']);
    const other = await page.evaluate(OTHER_DEVICE, '', '', true);
    await page.evaluate(SYNC_PAIR, other);
    await page.evaluate((c) => sessionStorage.setItem('t-noprf', c), other.cred);
    await reload(page, 'old');
    await resetWa(page);
    await unlockOld(page, 'Alpha', 'alpha secret text');
    assert((await wa(page)).join() === 'get,get', 'the stored passkey answers without the extension, then this device\'s opens it', await wa(page));
    await sleep(300);
    assert(!(await dialogOpen(page)), 'no message');
    const a = byTitle(await waitBlob(page, (x) => { const n = byTitle(x, 'Alpha'); return n && n.credId === mine.cred; }, 'Alpha records the pair that opened it'), 'Alpha');
    assert(a.salt === mine.salt, 'Alpha records this device\'s salt', a);
    const log = logs.get(page);
    assert(!log.errors.length, 'no page errors', log.errors);
  } finally {
    runtimeOff = false;
  }
});

check('an old unlock that opens nothing says so', async () => {
  try {
    await clean();
    runtimeOff = true;
    const page = await open(NOTES);
    await authOn(page);
    await settle(page, 'old');
    await writeNote(page, 'Alpha', 'alpha secret text', false);
    await oldLock(page, 'Alpha', 'alpha secret text');
    await legacyNote(page, 'Lambda', 'lambda text');
    await reload(page, 'old');
    await pick(page, 'Lambda');
    await resetWa(page);
    await page.click('#qn-unlock-btn');
    assert((await answerDialog(page)) === QN.unlock_failed, 'unlock says it failed');
    assert((await wa(page)).join() === 'get', 'one passkey tap', await wa(page));
    const v = await view(page);
    assert(v.panel && v.unlockBtn && v.text === null, 'the note stays locked', v);
    await page.click('#qn-unlock-btn');
    assert((await answerDialog(page)) === QN.unlock_failed, 'a second tap says so again');
    assert((await wa(page)).join() === 'get', 'without another prompt', await wa(page));
    await pick(page, 'Alpha');
    await waitView(page, (x) => x.text === 'alpha secret text', 'the passkey that answered still opens its own note');
    const log = logs.get(page);
    assert(!log.errors.length, 'no page errors', log.errors);
  } finally {
    runtimeOff = false;
  }
});

check('unlock never makes a passkey or a new salt', async () => {
  try {
    await clean();
    runtimeOff = true;
    const page = await open(NOTES);
    const auth = await authOn(page);
    await settle(page, 'old');
    await legacyNote(page, 'Lambda', 'lambda text');
    await reload(page, 'old');
    await pick(page, 'Lambda');
    let v = await view(page);
    assert(v.panel && v.unlockBtn, 'old locked panel', v);
    await resetWa(page);
    await page.click('#qn-unlock-btn');
    const msg = await answerDialog(page);
    assert(msg === QN.unlock_failed, 'unlock says it failed', msg);
    assert((await wa(page)).length === 0 && (await auth.creds()).length === 0, 'no passkey made or asked', await wa(page));
    const left = await page.evaluate((k) => ({ salt: window.MentriaStore.get('quick_notes', 'salt'), cred: window.MentriaStore.get('quick_notes', 'cred_id'), lsSalt: localStorage.getItem('mentria-qn-salt'), lsCred: localStorage.getItem('mentria-qn-cred'), pair: localStorage.getItem(k) }), PAIR);
    assert(left.salt == null && left.cred == null && left.lsSalt == null && left.lsCred == null && left.pair == null, 'no salt, cred_id or pair written', left);
    v = await view(page);
    assert(v.panel && v.unlockBtn && v.text === null, 'the note stays locked', v);
    const log = logs.get(page);
    assert(!log.errors.length, 'no page errors', log.errors);
  } finally {
    runtimeOff = false;
  }
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
  const kidRec = await readJson(page, RECORD);
  assert(note.kid && note.kid === kidRec.services.notes.id, 'the note records the id of its key', { kid: note.kid, id: kidRec.services.notes.id });
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
  const page = await open(NOTES);
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
  runtimeOff = true;
  const page = await open(NOTES);
  const auth = await authOn(page);
  await settle(page, 'old');
  await legacySeed(page);
  await legacyNote(page, 'Foreign', 'from another device');
  const before = await blob(page);
  const cred = await store(page, 'quick_notes', 'cred_id');
  assert(typeof cred === 'string' && (await auth.creds()).length === 1, 'one old passkey');
  await runtimeOn();
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

check('old locks under two salts convert with their own passkeys', async () => {
  await clean();
  runtimeOff = true;
  const page = await open(NOTES);
  await authOn(page);
  await settle(page, 'old');
  await writeNote(page, 'One', 'one secret text', false);
  await oldLock(page, 'One', 'one secret text');
  const mine = { salt: await store(page, 'quick_notes', 'salt'), cred: await store(page, 'quick_notes', 'cred_id') };
  const other = await page.evaluate(OTHER_DEVICE, 'Two', 'two secret text');
  assert(typeof mine.salt === 'string' && mine.salt !== other.salt && mine.cred !== other.cred, 'the other device has its own salt and passkey', mine);
  await waitBlob(page, (v) => !!byTitle(v, 'Two'), 'Two arrived by sync');
  await legacyNote(page, 'Foreign', 'from a lost key');
  const before = await blob(page);
  await runtimeOn();
  await reload(page, 'one');
  await makeKeyring(page);
  await pick(page, 'One');
  await resetWa(page);
  await page.click('#qn-unlock-btn');
  let after = await waitBlob(page, (x) => { const n = byTitle(x, 'One'); return n && n.kv === 2; }, 'One converted after a tap of its own passkey', 30000);
  await waitView(page, (x) => x.text === 'one secret text' && x.convert === QN.convert_skipped.replace('{n}', '2'), 'One open, Two and Foreign counted as not opened');
  assert((await wa(page)).join() === 'get', 'one tap', await wa(page));
  const one = byTitle(before, 'One');
  assert(one.salt === mine.salt && one.credId === mine.cred, 'One was locked with its salt and passkey on the note', one);
  let n = byTitle(after, 'One');
  assert(!('salt' in n) && !('credId' in n) && (await openV2(page, n)) === 'one secret text', 'converted One drops its salt and passkey and opens with the notes key', n);
  assert(JSON.stringify(byTitle(after, 'Two')) === JSON.stringify(byTitle(before, 'Two')), 'Two untouched until its passkey is used');
  await pick(page, 'Two');
  const v = await view(page);
  assert(v.panel && v.unlockBtn && v.link, 'Two keeps the old unlock', v);
  await resetWa(page);
  await page.click('#qn-unlock-btn');
  after = await waitBlob(page, (x) => { const t = byTitle(x, 'Two'); return t && t.kv === 2; }, 'Two converted after a tap of its own passkey', 30000);
  await waitView(page, (x) => x.text === 'two secret text' && x.convert === QN.convert_skipped.replace('{n}', '1'), 'Two open, Foreign still counted');
  assert((await wa(page)).join() === 'get', 'one tap for Two', await wa(page));
  n = byTitle(after, 'Two');
  assert(!('salt' in n) && !('credId' in n) && (await openV2(page, n)) === 'two secret text', 'converted Two drops its salt and passkey and opens with the notes key', n);
  assert(JSON.stringify(byTitle(after, 'Foreign')) === JSON.stringify(byTitle(before, 'Foreign')), 'a note no passkey here opens is left untouched');
  const log = logs.get(page);
  assert(!log.errors.length, 'no page errors', log.errors);
  await page.evaluate(() => {
    const S = window.MentriaStore;
    S.set('quick_notes', 'blob', JSON.parse(localStorage.getItem('mentria.store.quick_notes.blob')).filter((x) => x.title !== 'Foreign'));
    const rec = S.get('keyring', 'vault');
    rec.services.notes.linked = new Date(Date.now() - 31 * 86400000).toISOString();
    S.set('keyring', 'vault', rec);
  });
  await reload(page, 'one');
  await until(async () => { const r = await readJson(page, RECORD); return r && r.retired && r.retired.notes; }, 15000, 'notes retired once every note converted');
  await sleep(800);
  const got = (await page.evaluate(() => window.__signals.map((s) => s.credentialId))).sort();
  const want = [b64u(mine.cred), b64u(other.cred)].sort();
  assert(JSON.stringify(got) === JSON.stringify(want), 'retirement signals every old passkey that answered during the conversion', { got, want });
});

check('old notes convert with the passkey that opened them after a sync', async () => {
  await clean();
  runtimeOff = true;
  const page = await open(NOTES);
  await authOn(page);
  await settle(page, 'old');
  await writeNote(page, 'Alpha', 'alpha secret text', false);
  await oldLock(page, 'Alpha', 'alpha secret text');
  await writeNote(page, 'Bravo', 'bravo secret text', true);
  await oldLock(page, 'Bravo', 'bravo secret text');
  await stripPairs(page, ['Alpha', 'Bravo']);
  await runtimeOn();
  await reload(page, 'one');
  const before = await blob(page);
  const code = await makeKeyring(page);
  await lockKeyring(page);
  await pick(page, 'Alpha');
  await resetWa(page);
  await page.click('#qn-unlock-btn');
  await waitView(page, (x) => x.card && x.later, 'card after the old tap', 30000);
  assert((await wa(page)).join() === 'get', 'one tap', await wa(page));
  const other = await page.evaluate(OTHER_DEVICE, '', '', true);
  await page.evaluate(SYNC_PAIR, other);
  await page.evaluate((k) => localStorage.removeItem(k), PAIR);
  await resetWa(page);
  await cardCode(page, '#qn-locked-card', code);
  const after = await waitBlob(page, (x) => ['Alpha', 'Bravo'].every((t) => { const n = byTitle(x, t); return n && n.kv === 2; }), 'Alpha and Bravo converted with the passkey held before the sync', 30000);
  for (const t of ['Alpha', 'Bravo']) {
    const n = byTitle(after, t);
    assert((await openV2(page, n)) === t.toLowerCase() + ' secret text' && n.updatedAt === byTitle(before, t).updatedAt + 1, t + ' opens with the notes key, updatedAt + 1', n);
  }
  await waitView(page, (x) => x.text === 'alpha secret text' && x.convert === null, 'Alpha open and nothing counted');
  assert((await wa(page)).length === 0, 'no passkey asked after the sync', await wa(page));
  const log = logs.get(page);
  assert(!log.errors.length, 'no page errors', log.errors);
});

check('an old note opened on Later keeps saving with its passkey after a sync', async () => {
  await clean();
  runtimeOff = true;
  const page = await open(NOTES);
  await authOn(page);
  await settle(page, 'old');
  await writeNote(page, 'Alpha', 'alpha secret text', false);
  await oldLock(page, 'Alpha', 'alpha secret text');
  const mine = await storedPair(page);
  await stripPairs(page, ['Alpha']);
  await runtimeOn();
  await reload(page, 'one');
  const before = await blob(page);
  await pick(page, 'Alpha');
  await page.click('#qn-unlock-btn');
  await page.waitForSelector('.m-ulayer [data-step="intro"]', { timeout: 20000 });
  await page.click('.m-ulayer [data-act="not-now"]');
  await waitView(page, (x) => x.text === 'alpha secret text' && !x.layer, 'Later opens the note the old way');
  await sleep(500);
  assert(JSON.stringify(await blob(page)) === JSON.stringify(before), 'Later writes nothing');
  const other = await page.evaluate(OTHER_DEVICE, '', '', true);
  await page.evaluate(SYNC_PAIR, other);
  await page.evaluate((k) => localStorage.removeItem(k), PAIR);
  await typeEnd(page, ' later');
  await waitBlob(page, (x) => { const n = byTitle(x, 'Alpha'); return n && n.iv !== byTitle(before, 'Alpha').iv; }, 'the edit is saved after the sync');
  await sleep(800);
  const a = byTitle(await blob(page), 'Alpha');
  assert(a.enc && !('kv' in a) && a.salt === mine.salt && a.credId === mine.cred, 'sealed with the passkey that opened it, which the note now records', a);
  const log = logs.get(page);
  assert(!log.errors.length, 'no page errors', log.errors);
});

check('a tap with no old lock here counts every old note', async () => {
  const { page } = await notesKeyring();
  await authOn(page);
  await page.evaluate(OTHER_DEVICE, 'Xray', 'xray secret text');
  await waitBlob(page, (v) => !!byTitle(v, 'Xray'), 'Xray arrived by sync');
  await page.evaluate(() => { window.MentriaStore.remove('quick_notes', 'salt'); window.MentriaStore.remove('quick_notes', 'cred_id'); });
  await legacyNote(page, 'Lambda', 'lambda text');
  await reload(page, 'one');
  const before = await blob(page);
  await pick(page, 'Lambda');
  const v = await view(page);
  assert(v.unlockBtn && v.link && v.convert === null, 'old note offers the old unlock', v);
  await resetWa(page);
  await page.click('#qn-unlock-btn');
  await waitView(page, (x) => x.convert === QN.convert_skipped.replace('{n}', '2'), 'both old notes counted as not opened');
  assert((await wa(page)).length === 0, 'no passkey made or asked', await wa(page));
  assert(JSON.stringify(await blob(page)) === JSON.stringify(before), 'nothing written');
});

check('an old unlock that opens nothing keeps the count and shows no card', async () => {
  await clean();
  runtimeOff = true;
  const page = await open(NOTES);
  await authOn(page);
  await settle(page, 'old');
  await writeNote(page, 'Alpha', 'alpha secret text', false);
  await oldLock(page, 'Alpha', 'alpha secret text');
  await legacyNote(page, 'Lambda', 'lambda text');
  await runtimeOn();
  await reload(page, 'one');
  await makeKeyring(page);
  await pick(page, 'Alpha');
  await page.click('#qn-unlock-btn');
  await waitBlob(page, (x) => { const n = byTitle(x, 'Alpha'); return n && n.kv === 2; }, 'Alpha converted', 30000);
  const one = QN.convert_skipped.replace('{n}', '1');
  await waitView(page, (x) => x.text === 'alpha secret text' && x.convert === one, 'Alpha open and Lambda counted');
  await lockKeyring(page);
  await pick(page, 'Lambda');
  await waitView(page, (x) => x.unlockBtn && !x.card && x.convert === one, 'Lambda offers the old unlock and stays counted');
  const before = await blob(page);
  await resetWa(page);
  await page.click('#qn-unlock-btn');
  assert((await answerDialog(page)) === QN.unlock_failed, 'unlock says it failed');
  assert((await wa(page)).join() === 'get', 'one passkey tap', await wa(page));
  await sleep(800);
  const v = await view(page);
  assert(v.unlockBtn && !v.card && !v.later && v.convert === one, 'no card, and the count stays', v);
  assert(JSON.stringify(await blob(page)) === JSON.stringify(before), 'nothing written');
  const log = logs.get(page);
  assert(!log.errors.length, 'no page errors', log.errors);
});

check('legacy notes keep working on Later and survive a failed write', async () => {
  await clean();
  runtimeOff = true;
  const page = await open(NOTES);
  await authOn(page);
  await settle(page, 'old');
  await legacySeed(page);
  const before = await blob(page);
  await runtimeOn();
  await reload(page, 'one');
  await pick(page, 'Alpha');
  await resetWa(page);
  await page.click('#qn-unlock-btn');
  await page.waitForSelector('.m-ulayer [data-step="intro"]', { timeout: 20000 });
  assert((await wa(page)).join() === 'get', 'one old tap before setup', await wa(page));
  await page.click('.m-ulayer [data-act="not-now"]');
  const lv = await waitView(page, (x) => x.text === 'alpha secret text' && !x.layer, 'Later opens the note the old way');
  assert(lv.lockTitle === QN.relock_old_title && lv.removeBtn === QN.remove_lock_btn, 'without a keyring the Lock title says it locks the notes again', lv);
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
  runtimeOff = true;
  const page = await open(NOTES);
  await authOn(page);
  await settle(page, 'old');
  await oneLegacy(page);
  const before = await blob(page);
  await runtimeOn();
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
  runtimeOff = true;
  const page = await open(NOTES);
  await authOn(page);
  await settle(page, 'old');
  await legacySeed(page);
  const before = await blob(page);
  await runtimeOn();
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
  assert(typeof left.cred === 'string' && typeof left.salt === 'string' && left.signals === 1, 'old lock signalled after a good write, with its salt and credential id kept', left);
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
  const { page, code } = await notesKeyring();
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
  await cardCode(page, '#qn-locked-card', code);
  await waitView(page, (x) => x.text === 'foxtrot secret text', 'Foxtrot open again');
  await page.evaluate(async (M) => {
    window.__downloads = [];
    const m = await import(M);
    await m.lock();
    document.getElementById('qn-export-all-btn').click();
  }, MODULE);
  const raced = await until(() => page.evaluate(() => window.__downloads[0] || null), 5000, 'export file after the lock');
  assert(!raced.t.includes('foxtrot secret') && raced.t.includes('delta plain text'), 'Export all right after a lock leaves the locked note out', raced);
});

check('a key that arrives later still opens its notes', async () => {
  const { page } = await notesKeyring();
  await writeNote(page, 'Juliet', 'juliet secret text', false);
  const { note: juliet } = await lockActive(page, 'Juliet', 'juliet secret text');
  const saved = await readJson(page, RECORD);
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
  const { msg, note: kappa } = await lockActive(page, 'Kappa', 'kappa plain text');
  assert(msg === QN.confirm_lock_one, 'locking goes ahead with a new key', msg);
  const mid = await readJson(page, RECORD);
  assert(mid.services.notes && mid.services.notes.id && mid.services.notes.id !== saved.services.notes.id && kappa.kid === mid.services.notes.id, 'a new key is linked and Kappa records it', { kid: kappa.kid, rec: mid.services.notes });
  await waitView(page, (x) => x.convert === QN.convert_skipped.replace('{n}', '1'), 'Juliet counted while its key is away');
  assert(JSON.stringify(byTitle(await blob(page), 'Juliet')) === JSON.stringify(juliet), 'Juliet untouched while its key is away');
  await page.evaluate(async (C, old) => {
    const core = await import(C);
    const merged = core.mergeRecords(window.MentriaStore.get('keyring', 'vault'), old);
    window.MentriaStore.set('keyring', 'vault', merged, { remote: true });
  }, CORE, saved);
  const after = await waitBlob(page, (x) => { const n = byTitle(x, 'Juliet'); return n && n.kid === mid.services.notes.id; }, 'Juliet moved to the current key once its key arrived', 20000);
  const j = byTitle(after, 'Juliet');
  assert(j.updatedAt === juliet.updatedAt + 1 && (await openV2(page, j)) === 'juliet secret text', 'Juliet opens with the current key, updatedAt + 1', j);
  const rec = await readJson(page, RECORD);
  assert(rec.services.notes.id === mid.services.notes.id && JSON.stringify(rec.services.notes.prior || []).includes(saved.services.notes.id), 'both keys kept in the record', rec.services.notes);
  await pick(page, 'Juliet');
  await waitView(page, (x) => x.text === 'juliet secret text' && x.convert === null, 'Juliet opens and nothing is counted');
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

const SLOW = (kind, ms) => {
  const s = crypto.subtle;
  if (!window.__decrypt) window.__decrypt = s.decrypt.bind(s);
  const d = window.__decrypt;
  s.decrypt = async (alg, key, data) => {
    const aad = alg && alg.additionalData ? new TextDecoder().decode(alg.additionalData) : '';
    const hit = kind === 'old' ? !aad : aad.startsWith('mentria-notes|v2|');
    if (hit) await new Promise((r) => setTimeout(r, ms));
    return d(alg, key, data);
  };
};

const LINK_NEW = async (M) => {
  const m = await import(M);
  await m.ready();
  for (let i = 0; i < 100 && !m.state().unlocked; i++) await new Promise((r) => setTimeout(r, 100));
  const raw = crypto.getRandomValues(new Uint8Array(32));
  await m.link('notes', raw);
  const list = await m.secrets('notes');
  const b = (u) => btoa(String.fromCharCode(...u));
  return { mine: b(raw), ring: list.map((x) => ({ id: x.id, key: b(x.bytes) })) };
};

async function sealWith(target, keyB64, id, text) {
  return target.evaluate(async (k, i, t) => {
    const u = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
    const b = (x) => btoa(String.fromCharCode(...new Uint8Array(x)));
    const key = await crypto.subtle.importKey('raw', u(k), 'AES-GCM', false, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode('mentria-notes|v2|' + i) }, key, new TextEncoder().encode(t));
    return { body: b(ct), iv: b(iv) };
  }, keyB64, id, text);
}

async function openWith(target, keyB64, note) {
  return target.evaluate(async (k, n) => {
    const u = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
    try {
      const key = await crypto.subtle.importKey('raw', u(k), 'AES-GCM', false, ['decrypt']);
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u(n.iv), additionalData: new TextEncoder().encode('mentria-notes|v2|' + n.id) }, key, u(n.body));
      return new TextDecoder().decode(pt);
    } catch (e) {
      return 'ERR ' + e.name;
    }
  }, keyB64, note);
}

async function addNotes(target, list) {
  await target.evaluate((add) => {
    const cur = JSON.parse(localStorage.getItem('mentria.store.quick_notes.blob') || '[]');
    window.MentriaStore.set('quick_notes', 'blob', cur.concat(add));
  }, list);
}

async function keyedNote(target, keyB64, title, text, kid, at) {
  const id = 'k' + title.toLowerCase() + Date.now().toString(36);
  const sealed = await sealWith(target, keyB64, id, text);
  const n = { id, title, body: sealed.body, iv: sealed.iv, enc: true, kv: 2, createdAt: at, updatedAt: at };
  if (kid) n.kid = kid;
  return n;
}

check('two devices\' keys all open and move to the current key', async () => {
  const { page } = await notesKeyring();
  await writeNote(page, 'One', 'one secret text', false);
  const { note: one } = await lockActive(page, 'One', 'one secret text');
  const id1 = (await readJson(page, RECORD)).services.notes.id;
  assert(id1 && one.kid === id1, 'One records the id of its key', { kid: one.kid, id1 });
  const other = await open('/about/');
  const two = await other.evaluate(LINK_NEW, MODULE);
  assert(two.ring.length === 2 && two.ring[0].key === two.mine && two.ring[0].id !== id1 && two.ring[1].id === id1, 'the record holds the new key and keeps the first', two.ring.map((x) => x.id));
  const [k2, k1] = two.ring;
  const t0 = Date.now() - 60000;
  await addNotes(other, [
    await keyedNote(other, k2.key, 'Two', 'two secret text', k2.id, t0),
    await keyedNote(other, k1.key, 'Nokid', 'nokid secret text', null, t0 + 1)
  ]);
  const want = { One: 'one secret text', Two: 'two secret text', Nokid: 'nokid secret text' };
  const moved = await waitBlob(page, (x) => Object.keys(want).every((t) => { const n = byTitle(x, t); return n && n.kv === 2 && n.kid === k2.id; }), 'every note under the second key', 20000);
  for (const t of Object.keys(want)) assert((await openWith(page, k2.key, byTitle(moved, t))) === want[t], t + ' opens with the current key');
  assert(byTitle(moved, 'One').updatedAt === one.updatedAt + 1 && byTitle(moved, 'Nokid').updatedAt === t0 + 2 && byTitle(moved, 'Two').updatedAt === t0, 'moved notes gain one ms, current ones are untouched', moved.map((n) => [n.title, n.updatedAt]));
  await page.bringToFront();
  for (const t of Object.keys(want)) {
    await pick(page, t);
    await waitView(page, (x) => x.text === want[t], t + ' opens in the editor');
  }
  const three = await other.evaluate(LINK_NEW, MODULE);
  const k3 = three.ring[0];
  assert(three.ring.length === 3 && k3.key === three.mine && three.ring.some((x) => x.id === k1.id) && three.ring.some((x) => x.id === k2.id), 'a third key keeps both earlier ones', three.ring.map((x) => x.id));
  await addNotes(other, [await keyedNote(other, k1.key, 'Late', 'late secret text', k1.id, t0 + 5)]);
  want.Late = 'late secret text';
  const final = await waitBlob(page, (x) => Object.keys(want).every((t) => { const n = byTitle(x, t); return n && n.kid === k3.id; }), 'every note under the third key', 20000);
  for (const t of Object.keys(want)) assert((await openWith(page, k3.key, byTitle(final, t))) === want[t], t + ' opens with the third key');
  await page.bringToFront();
  await pick(page, 'Late');
  await waitView(page, (x) => x.text === 'late secret text' && x.convert === null, 'a note under the first key opens after the third merge');
  const stray = await keyedNote(other, btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i))), 'Stray', 'stray secret text', 'unknownkid', t0 + 7);
  await addNotes(other, [stray]);
  await other.close();
  await waitView(page, (x) => x.convert === QN.convert_skipped.replace('{n}', '1'), 'a note no key opens is counted');
  assert(JSON.stringify(byTitle(await blob(page), 'Stray')) === JSON.stringify(stray), 'that note is left untouched');
  await pick(page, 'Stray');
  await waitView(page, (x) => x.panel && x.note === QN.key_missing, 'and says its key is not here');
  await page.evaluate(() => {
    window.MentriaStore.set('quick_notes', 'salt', btoa('s'.repeat(32)));
    window.MentriaStore.set('quick_notes', 'cred_id', btoa('c'.repeat(16)));
    const rec = window.MentriaStore.get('keyring', 'vault');
    rec.services.notes.linked = new Date(Date.now() - 31 * 86400000).toISOString();
    window.MentriaStore.set('keyring', 'vault', rec);
  });
  assert((await runtime(page, 'retirement', { notesConverted: true })).ready === true, 'only the notes block retirement here');
  await reload(page, 'one');
  await sleep(1500);
  let rec = await readJson(page, RECORD);
  assert(!(rec.retired && rec.retired.notes) && (await store(page, 'quick_notes', 'cred_id')) != null, 'no retirement while a note is not under the current key', rec.retired);
  await page.evaluate(() => {
    const list = JSON.parse(localStorage.getItem('mentria.store.quick_notes.blob')).filter((n) => n.title !== 'Stray');
    window.MentriaStore.set('quick_notes', 'blob', list);
  });
  await reload(page, 'one');
  rec = await until(async () => { const r = await readJson(page, RECORD); return r && r.retired && r.retired.notes ? r : null; }, 15000, 'retired once every note is under the current key');
});

check('Later on the card keeps the old note, with the old Lock title', async () => {
  await clean();
  runtimeOff = true;
  const page = await open(NOTES);
  await authOn(page);
  await settle(page, 'old');
  await oneLegacy(page);
  await runtimeOn();
  await reload(page, 'one');
  await makeKeyring(page);
  await lockKeyring(page);
  await pick(page, 'Alpha');
  await page.click('#qn-unlock-btn');
  await waitView(page, (x) => x.card && x.later, 'card and Not now after the old tap', 30000);
  await page.click('#qn-card-later');
  const v = await waitView(page, (x) => x.text === 'alpha secret text', 'Not now opens the note the old way');
  assert(v.lockTitle === QN.relock_old_title && v.removeBtn === QN.remove_lock_btn, 'Lock only forgets the old key here, and its title says so', v);
  assert(!v.readOnly && !v.titleReadOnly && v.readOnlyLine === null, 'with notes not linked yet the old note stays editable', v);
  await page.click('#qn-lock-btn');
  await waitView(page, (x) => x.text === null && x.raw === '' && x.unlockBtn, 'Lock hides the note again');
});

check('Not now with notes linked opens old notes read only, and a lock elsewhere closes them', async () => {
  await clean();
  runtimeOff = true;
  const page = await open(NOTES);
  await authOn(page);
  await settle(page, 'old');
  await oneLegacy(page);
  await runtimeOn();
  await reload(page, 'one');
  const code = await makeKeyring(page);
  await page.evaluate(async (M) => {
    const m = await import(M);
    await m.link('notes', crypto.getRandomValues(new Uint8Array(32)));
  }, MODULE);
  assert((await readJson(page, RECORD)).services.notes, 'notes are linked in the one unlock');
  await lockKeyring(page);
  await pick(page, 'Alpha');
  await resetWa(page);
  await page.click('#qn-unlock-btn');
  await waitView(page, (x) => x.card && x.later, 'card and Not now after the old tap', 30000);
  await page.click('#qn-card-later');
  let v = await waitView(page, (x) => x.text === 'alpha secret text', 'Not now opens the old note');
  assert(v.readOnly && v.titleReadOnly && v.readOnlyLine === QN.read_only_old, 'the old note opens read only, with a line that says so', v);
  assert(v.removeBtn === null, 'no Remove lock while read only', v);
  const before = await blob(page);
  await page.evaluate(() => {
    const ta = document.getElementById('qn-textarea');
    ta.value += ' changed';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(1500);
  assert(JSON.stringify(await blob(page)) === JSON.stringify(before), 'nothing is sealed again with the old key', { before, after: await blob(page) });
  const other = await open('/about/');
  await lockKeyring(other);
  await page.bringToFront();
  v = await waitView(page, (x) => x.text === null && x.raw === '' && x.unlockBtn, 'a lock in another tab closes the old note');
  assert(v.readOnlyLine === null, 'the read only line goes with it', v);
  await resetWa(page);
  await page.click('#qn-unlock-btn');
  await waitView(page, (x) => x.card && x.later, 'the old tap is needed again', 30000);
  assert((await wa(page)).join() === 'get', 'the old key was forgotten', await wa(page));
  await cardCode(page, '#qn-locked-card', code);
  const after = await waitBlob(page, (x) => { const n = byTitle(x, 'Alpha'); return n && n.kv === 2; }, 'Alpha converted once the session opens', 30000);
  assert((await openV2(page, byTitle(after, 'Alpha'))) === 'alpha secret text', 'the unsaved change was never kept');
  v = await waitView(page, (x) => x.text === 'alpha secret text' && !x.readOnly && !x.titleReadOnly && x.readOnlyLine === null, 'editable once the session is open');
  await other.close();
});

check('Export all right after a lock leaves old-style notes out', async () => {
  const { page } = await failedConversion();
  await page.evaluate(() => {
    window.__downloads = [];
    window.MentriaUI.downloadFile = (name, b) => { b.text().then((t) => window.__downloads.push({ name, t })); };
  });
  await page.evaluate(SLOW, 'old', 2500);
  await nudge(page);
  await page.evaluate(async (M) => {
    const m = await import(M);
    await m.lock();
    document.getElementById('qn-export-all-btn').click();
  }, MODULE);
  await sleep(6000);
  const got = await page.evaluate(() => window.__downloads.slice());
  assert(!JSON.stringify(got).includes('alpha secret'), 'no old-style locked text in the file', got);
  await waitView(page, (x) => x.text === null && x.raw === '' && x.unlockBtn, 'note hidden after the lock');
});

check('a just-locked note shows the card', async () => {
  const { page } = await notesKeyring();
  await writeNote(page, 'Mike', 'mike secret text', false);
  await lockActive(page, 'Mike', 'mike secret text');
  await writeNote(page, 'November', 'november secret text', true);
  await lockActive(page, 'November', 'november secret text');
  await waitView(page, (x) => x.text === 'november secret text', 'November open');
  await page.evaluate(SLOW, 'v2', 2500);
  await addNotes(page, [await keyedNote(page, btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => 255 - i))), 'Stray', 'stray text', 'unknownkid', Date.now())]);
  await sleep(300);
  const seen = await page.evaluate(async (M) => {
    const note = document.getElementById('qn-locked-note');
    const texts = [];
    new MutationObserver(() => { if (note.textContent) texts.push(note.textContent); }).observe(note, { childList: true, characterData: true, subtree: true });
    window.__noteTexts = texts;
    const ta = document.getElementById('qn-textarea');
    ta.value += ' more';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    const m = await import(M);
    await m.lock();
    const tab = [...document.querySelectorAll('#qn-note-list .qn-note-tab')].find((b) => b.querySelector('.qn-note-tab__title').textContent === 'Mike');
    tab.click();
    return true;
  }, MODULE);
  assert(seen, 'switched notes right after the lock');
  await waitView(page, (x) => x.card && x.raw === '', 'card for Mike', 20000);
  await sleep(500);
  const texts = await page.evaluate(() => window.__noteTexts.slice());
  assert(!texts.includes(QN.key_missing), 'never says the key is on another device', texts);
});

check('a lock during conversion does not stop it', async () => {
  const { page } = await notesKeyring();
  await writeNote(page, 'Oscar', 'oscar secret text', false);
  await lockActive(page, 'Oscar', 'oscar secret text');
  const other = await open('/about/');
  const two = await other.evaluate(LINK_NEW, MODULE);
  const [k2, k1] = two.ring;
  await waitBlob(page, (x) => { const n = byTitle(x, 'Oscar'); return n && n.kid === k2.id; }, 'Oscar moved to the second key', 20000);
  await page.bringToFront();
  await writeNote(page, 'Papa', 'papa plain text', true);
  await sleep(1500);
  await page.evaluate(() => {
    const s = crypto.subtle;
    const d = s.decrypt.bind(s);
    s.decrypt = async (alg, key, data) => {
      if (window.__slow && alg && alg.additionalData && new TextDecoder().decode(alg.additionalData).startsWith('mentria-notes|v2|')) await new Promise((r) => setTimeout(r, 4000));
      return d(alg, key, data);
    };
    window.__slow = true;
  });
  const quebec = await keyedNote(other, k1.key, 'Quebec', 'quebec secret text', k1.id, Date.now() - 5000);
  await addNotes(other, [quebec]);
  await until(() => page.evaluate(() => [...document.querySelectorAll('#qn-note-list .qn-note-tab__title')].some((t) => t.textContent === 'Quebec')), 5000, 'Quebec arrived');
  await sleep(500);
  await page.click('#qn-lock-btn');
  await answerDialog(page);
  const papa = byTitle(await waitBlob(page, (x) => { const n = byTitle(x, 'Papa'); return n && n.kv === 2; }, 'Papa locked during the conversion', 20000), 'Papa');
  assert(papa.kid === k2.id, 'Papa uses the current key', papa);
  const moved = await waitBlob(page, (x) => { const n = byTitle(x, 'Quebec'); return n && n.kid === k2.id; }, 'Quebec still moved to the current key', 20000);
  assert(byTitle(moved, 'Quebec').updatedAt === quebec.updatedAt + 1 && (await openWith(page, k2.key, byTitle(moved, 'Quebec'))) === 'quebec secret text', 'Quebec opens with the current key');
  await page.evaluate(() => { window.__slow = false; });
});

check('old lock retires once every note converted', async () => {
  const { page } = await notesKeyring([WATCH_REMOVE]);
  await writeNote(page, 'Hotel', 'hotel secret text', false);
  await lockActive(page, 'Hotel', 'hotel secret text');
  const credStd = btoa(String.fromCharCode(0xfb, 0xff, 0xfe, 0x01, 0x02, 0x03, 0xfb, 0xef, 0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x70, 0x80));
  const credUrl = credStd.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const salt = await page.evaluate((c) => {
    const s = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
    window.MentriaStore.set('quick_notes', 'salt', s);
    window.MentriaStore.set('quick_notes', 'cred_id', c);
    localStorage.setItem('mentria-qn-salt', s);
    localStorage.setItem('mentria-qn-cred', c);
    const rec = window.MentriaStore.get('keyring', 'vault');
    rec.services.notes.linked = new Date(Date.now() - 31 * 86400000).toISOString();
    window.MentriaStore.set('keyring', 'vault', rec);
    return s;
  }, credStd);
  await legacyNote(page, 'Romeo', 'romeo text');
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
    const list = JSON.parse(localStorage.getItem('mentria.store.quick_notes.blob')).filter((n) => n.title !== 'Romeo');
    window.MentriaStore.set('quick_notes', 'blob', list);
    sessionStorage.setItem('t-fail-record', '1');
  });
  await reload(page, 'one');
  await pick(page, 'Hotel');
  await waitView(page, (x) => x.text === 'hotel secret text', 'Hotel open while the record cannot be written');
  await sleep(1500);
  const failedMark = await page.evaluate(() => ({ tries: window.__recordFails || 0, signals: window.__signals.length, retired: (JSON.parse(localStorage.getItem('mentria.store.keyring.vault')).retired || {}).notes || null }));
  assert(failedMark.tries > 0, 'retirement tried to write the retired mark', failedMark);
  assert(failedMark.signals === 0 && failedMark.retired === null, 'no signal while the retired mark cannot be written', failedMark);
  await page.evaluate(() => sessionStorage.removeItem('t-fail-record'));
  await reload(page, 'one');
  rec = await until(async () => { const r = await readJson(page, RECORD); return r && r.retired && r.retired.notes ? r : null; }, 15000, 'notes marked retired');
  await sleep(800);
  const left = await page.evaluate(() => ({
    salt: window.MentriaStore.get('quick_notes', 'salt'),
    cred: window.MentriaStore.get('quick_notes', 'cred_id'),
    lsSalt: localStorage.getItem('mentria-qn-salt'),
    lsCred: localStorage.getItem('mentria-qn-cred'),
    removed: window.__removed.filter((k) => k === 'salt' || k === 'cred_id'),
    signals: window.__signals
  }));
  assert(left.salt === salt && left.cred === credStd && left.lsSalt === salt && left.lsCred === credStd, 'retirement keeps the old salt and credential ids', left);
  assert(!left.removed.length, 'retirement removes nothing from the store', left.removed);
  assert(left.signals.length === 1 && left.signals[0].credentialId === credUrl && left.signals[0].rpId === 'localhost', 'old passkey signalled unknown in base64url', left.signals);
  const blobNow = await blob(page);
  assert(blobNow.some((n) => n.title === 'Hotel' && n.kv === 2), 'notes kept');
  await pick(page, 'Hotel');
  await waitView(page, (x) => x.text === 'hotel secret text', 'Hotel still opens after retirement');
  await reload(page, 'one');
  await pick(page, 'Hotel');
  await waitView(page, (x) => x.text === 'hotel secret text', 'Hotel opens after a reload');
  await sleep(1200);
  assert((await page.evaluate(() => window.__signals.length)) === 0, 'retirement signals once');
});

let failed = 0;
const ONLY = process.env.ONLY || '';
const run = checks.filter(([n]) => !ONLY || ONLY.split('|').some((o) => n.includes(o)));
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
