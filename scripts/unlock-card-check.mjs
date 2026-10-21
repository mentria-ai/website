import http from 'node:http';
import { createReadStream, statSync, rmSync, readFileSync } from 'node:fs';
import { join, extname, normalize, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const BUILD = process.argv[2];
if (!BUILD) { console.log('usage: node scripts/unlock-card-check.mjs <beta build dir>'); process.exit(2); }
const PORT = 8095;
const ORIGIN = 'http://localhost:' + PORT;
const PROFILE = join(tmpdir(), 'unlock-card-check-profile');
const MODULE = '/assets/js/mentria-unlock.js';
const UI = '/assets/js/mentria-unlock-ui.js';
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EN = JSON.parse(readFileSync(join(REPO, 'src/_data/i18n/en.json'), 'utf8')).unlock;
const JA = JSON.parse(readFileSync(join(REPO, 'src/_data/i18n/ja.json'), 'utf8')).unlock;
const AXE = readFileSync(join(REPO, 'node_modules/axe-core/axe.min.js'), 'utf8');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.txt': 'text/plain', '.xml': 'application/xml', '.ico': 'image/x-icon', '.pdf': 'application/pdf'
};

function serve(dir, port) {
  const root = resolve(dir);
  const server = http.createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://local').pathname);
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
const NO_PRF = () => {
  if (window.PublicKeyCredential) PublicKeyCredential.getClientCapabilities = async () => ({ 'extension:prf': false });
};
const NO_CLOSE_WATCHER = () => {
  try { delete window.CloseWatcher; } catch (_) {}
};
const CLICK_PROBE = () => {
  window.__tick = false;
  window.__wa = [];
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
const LIVE_PROBE = () => {
  window.__frame = 0;
  window.__live = [];
  const tick = () => { window.__frame += 1; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  const born = new WeakMap();
  const SEL = '.m-usheet__msg, .m-unlock__msg';
  new MutationObserver((list) => {
    for (const m of list) {
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        const found = (n.matches(SEL) ? [n] : []).concat([...n.querySelectorAll(SEL)]);
        for (const r of found) {
          if (!born.has(r)) born.set(r, window.__frame);
          if (r.textContent) window.__live.push({ born: born.get(r), frame: window.__frame, text: r.textContent });
        }
      }
      const t = m.target;
      if (t && t.nodeType === 1 && t.matches(SEL) && t.textContent) window.__live.push({ born: born.has(t) ? born.get(t) : -1, frame: window.__frame, text: t.textContent });
    }
  }).observe(document, { childList: true, subtree: true });
};
const AUTH = { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true };

function assert(cond, msg, extra) {
  if (!cond) throw new Error(msg + (extra === undefined ? '' : ' ' + JSON.stringify(extra)));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(path, init) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const log = { requests: [], errors: [] };
  pageLog.set(page, log);
  page.on('request', (r) => log.requests.push(r.url()));
  page.on('pageerror', (e) => log.errors.push(String(e && e.message || e)));
  if (init) await page.evaluateOnNewDocument(init);
  await page.goto(ORIGIN + path, { waitUntil: 'load' });
  return page;
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

async function until(fn, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(100);
  }
  return !!(await fn());
}

async function modules(target) {
  await target.waitForFunction(() => document.readyState === 'complete');
  return target.evaluate(async (m, u) => {
    window.__m = await import(m);
    await window.__m.ready();
    window.__ui = await import(u);
    return window.__m.state();
  }, MODULE, UI);
}

async function enableOnLab(page) {
  await page.waitForSelector('#unlock-switch');
  if (!(await page.$eval('#unlock-switch', (el) => el.checked))) await page.click('#unlock-switch');
  await page.waitForFunction(() => {
    try { return JSON.parse(localStorage.getItem('mentria.keyring.local')).enabled === true; } catch (_) { return false; }
  });
}

async function createOnLab(page) {
  await page.click('#unlock-create');
  await page.waitForFunction(() => (document.getElementById('unlock-code').textContent || '').replace(/[^A-Z2-7]/g, '').length === 32, { timeout: 15000 });
  return page.$eval('#unlock-code', (el) => el.textContent.trim());
}

async function labWithKeyring(init) {
  await clean();
  const page = await open('/beta/unlock/', init);
  await enableOnLab(page);
  const code = await createOnLab(page);
  await modules(page);
  return { page, code };
}

async function start(target, expr) {
  await target.evaluate((src) => {
    const old = document.getElementById('t-call');
    if (old) old.remove();
    const b = document.createElement('button');
    b.id = 't-call';
    b.type = 'button';
    b.textContent = 'call';
    b.style.cssText = 'position:fixed;top:0;left:0;z-index:2147483647;width:80px;height:40px';
    const fn = new Function('ui', 'm', 'return (' + src + ')(ui, m);');
    b.addEventListener('click', () => {
      window.__r = null;
      Promise.resolve().then(() => fn(window.__ui, window.__m)).then(
        (v) => { window.__r = { ok: true, v: v === undefined ? null : v }; },
        (e) => { window.__r = { ok: false, e: String(e && (e.message || e.name) || e) }; }
      );
    });
    document.body.appendChild(b);
  }, expr);
  await target.click('#t-call');
  await target.evaluate(() => { const b = document.getElementById('t-call'); if (b) b.remove(); });
}

async function settled(target, ms) {
  await target.waitForFunction(() => window.__r, { timeout: ms || 30000 });
  return target.evaluate(() => window.__r);
}

function readLocal(page, key) {
  return page.evaluate((k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } }, key);
}

function record(page) { return readLocal(page, 'mentria.store.keyring.vault'); }

async function text(target, sel) {
  return target.$eval(sel, (el) => el.textContent.trim());
}

async function visible(target, sel) {
  return target.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  }, sel);
}

async function openCode(target, root) {
  const toggle = root + ' [data-act="show-code"]';
  if (await target.$(toggle) && await visible(target, toggle)) {
    const expanded = await target.$eval(toggle, (el) => el.getAttribute('aria-expanded'));
    if (expanded !== 'true') await target.click(toggle);
  }
  await target.waitForFunction((s) => {
    const el = document.querySelector(s);
    return el && el.getBoundingClientRect().height > 0;
  }, {}, root + ' input[name="recovery-code"]');
}

async function typeInto(target, sel, value) {
  await target.$eval(sel, (el) => {
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await target.type(sel, value);
  const got = await target.$eval(sel, (el) => el.value);
  assert(got === value, 'typed value', { sel, got, value });
}

async function waitMsg(target, sel, want) {
  const ok = await until(async () => (await target.$(sel)) && (await text(target, sel)) === want, 15000);
  assert(ok, 'message ' + JSON.stringify(want), await target.$(sel) ? await text(target, sel) : 'no message element');
}

async function layerOpen(target) {
  return target.evaluate(() => !!document.querySelector('.m-ulayer [role="dialog"]'));
}

async function step(target) {
  await target.waitForSelector('.m-ulayer [data-step]', { timeout: 15000 });
  return target.$eval('.m-ulayer [data-step]', (el) => el.dataset.step);
}

async function waitStep(target, name) {
  await target.waitForFunction((n) => {
    const el = document.querySelector('.m-ulayer [data-step]');
    return el && el.dataset.step === n;
  }, { timeout: 15000 }, name);
}

async function shownCode(target) {
  return target.$eval('.m-ulayer .m-ucode', (el) => el.textContent.replace(/\s+/g, '').trim());
}

async function targets(target, root) {
  return target.evaluate((r) => [...document.querySelectorAll(r + ' button, ' + r + ' input:not([type="checkbox"]):not([type="radio"]), ' + r + ' label.m-uopt')]
    .filter((el) => el.getBoundingClientRect().height > 0)
    .map((el) => ({ tag: el.tagName, act: el.dataset.act || el.name || el.className, h: Math.round(el.getBoundingClientRect().height) }))
    .filter((x) => x.h < 44), root);
}

async function busyInfo(target) {
  return target.evaluate(() => {
    const d = document.querySelector('.m-ulayer [role="dialog"]');
    if (!d) return null;
    const m = d.querySelector('.m-usheet__msg');
    const fields = [...d.querySelectorAll('input')].filter((i) => i.getClientRects().length > 0).map((i) => ({
      name: i.name,
      locked: i.type === 'checkbox' || i.type === 'radio' ? i.disabled : i.readOnly || i.disabled
    }));
    return { buttons: [...d.querySelectorAll('button')].map((b) => b.disabled), fields, msg: m ? m.textContent : null, busy: d.hasAttribute('aria-busy') };
  });
}

async function busyNow(target, want) {
  const i = await busyInfo(target);
  return !!i && i.buttons.length > 0 && i.buttons.every(Boolean) && i.msg === (want || EN.saving) && i.busy;
}

async function focusInfo(target) {
  return target.evaluate(() => {
    const d = document.querySelector('.m-ulayer [role="dialog"]');
    const a = document.activeElement;
    const first = d ? [...d.querySelectorAll('button, a[href], input, select, textarea, [tabindex]')].find((n) => !n.disabled && n.tabIndex >= 0 && n.getClientRects().length > 0) : null;
    const name = (n) => (n ? n.dataset.act || n.name || n.tagName : null);
    return { active: name(a), first: name(first), isFirst: !!first && a === first, inside: !!d && d.contains(a) && a !== d && !a.disabled };
  });
}

const SLOW_ENCRYPT = (ms) => {
  const enc = crypto.subtle.encrypt.bind(crypto.subtle);
  window.__slow = true;
  crypto.subtle.encrypt = async (...a) => {
    if (window.__slow) await new Promise((r) => setTimeout(r, ms));
    return enc(...a);
  };
};

async function axe(target, sel) {
  await target.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'), { timeout: 5000 });
  await target.evaluate(AXE);
  return target.evaluate(async (s) => {
    const r = await window.axe.run(document.querySelector(s), { resultTypes: ['violations'] });
    return r.violations.map((v) => v.id + ': ' + v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', '));
  }, sel);
}

check('card unlocks with code', async () => {
  const { page, code } = await labWithKeyring();
  await page.evaluate(() => window.__m.lock());
  await page.click('#unlock-demo-card');
  await page.waitForSelector('#unlock-demo .m-unlock');
  const a11y = await page.evaluate(() => {
    const card = document.querySelector('#unlock-demo .m-unlock');
    const input = card.querySelector('input[name="recovery-code"]');
    const msg = card.querySelector('.m-unlock__msg');
    return {
      title: card.querySelector('.m-unlock__title').textContent.trim(),
      lede: card.querySelector('.m-unlock__lede').textContent.trim(),
      passkey: !!card.querySelector('[data-act="passkey"]') && card.querySelector('[data-act="passkey"]').getBoundingClientRect().height > 0,
      labelled: !!input && input.labels.length > 0 && input.labels[0].textContent.trim(),
      ac: input && input.getAttribute('autocomplete'),
      cap: input && input.getAttribute('autocapitalize'),
      live: msg && msg.getAttribute('aria-live'),
      form: !!input && !!input.form
    };
  });
  assert(a11y.title === EN.card_title && a11y.lede === EN.card_lede, 'card title and lede', a11y);
  assert(a11y.passkey === false, 'no passkey button when the record has no passkey', a11y);
  assert(a11y.labelled === EN.code_label && a11y.ac === 'one-time-code' && a11y.cap === 'characters', 'code field labelled with the right autocomplete', a11y);
  assert(a11y.live === 'polite' && a11y.form, 'live region and a form so Enter submits', a11y);
  const small = await targets(page, '#unlock-demo .m-unlock');
  assert(!small.length, '44 px targets on the card', small);
  await openCode(page, '#unlock-demo .m-unlock');
  await typeInto(page, '#unlock-demo input[name="recovery-code"]', code.toLowerCase());
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__m.state().unlocked === true, { timeout: 15000 });
  await until(() => page.evaluate(() => (window.__cardUnlocks || 0) >= 1), 5000);
  await sleep(600);
  const n = await page.evaluate(() => window.__cardUnlocks || 0);
  assert(n === 1, 'onUnlocked called exactly once', n);
  const st = await page.evaluate(() => window.__cardState);
  assert(st && st.unlocked === true, 'onUnlocked gets the state', st);
});

check('card wrong code shows err_code', async () => {
  const { page } = await labWithKeyring();
  await page.evaluate(() => window.__m.lock());
  await page.click('#unlock-demo-card');
  await page.waitForSelector('#unlock-demo .m-unlock');
  await openCode(page, '#unlock-demo .m-unlock');
  await typeInto(page, '#unlock-demo input[name="recovery-code"]', 'AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA');
  await page.keyboard.press('Enter');
  await waitMsg(page, '#unlock-demo .m-unlock__msg', EN.err_code);
  const r = await page.evaluate(() => ({ unlocked: window.__m.state().unlocked, calls: window.__cardUnlocks || 0, focus: document.activeElement && document.activeElement.name }));
  assert(!r.unlocked && r.calls === 0, 'still locked, onUnlocked not called', r);
  assert(r.focus === 'recovery-code', 'focus stays on the code field', r);
  await typeInto(page, '#unlock-demo input[name="recovery-code"]', 'not a code');
  await page.click('#unlock-demo form[data-form="code"] button[type="submit"]');
  await waitMsg(page, '#unlock-demo .m-unlock__msg', EN.err_code);
});

check('prf failure offers code', async () => {
  await clean();
  const page = await open('/beta/unlock/');
  const cdp = await page.createCDPSession();
  await cdp.send('WebAuthn.enable');
  const a1 = (await cdp.send('WebAuthn.addVirtualAuthenticator', { options: Object.assign({ hasPrf: true }, AUTH) })).authenticatorId;
  await enableOnLab(page);
  const code = await createOnLab(page);
  await modules(page);
  await start(page, "(ui, m) => m.addPasskey('')");
  const add = await settled(page, 30000);
  assert(add.ok, 'passkey enrolled with a PRF authenticator', add);
  const cred = (await cdp.send('WebAuthn.getCredentials', { authenticatorId: a1 })).credentials[0];
  await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: a1 });
  const a2 = (await cdp.send('WebAuthn.addVirtualAuthenticator', { options: Object.assign({ hasPrf: false }, AUTH) })).authenticatorId;
  await cdp.send('WebAuthn.addCredential', { authenticatorId: a2, credential: cred });
  await page.evaluate(() => window.__m.lock());
  await page.click('#unlock-demo-card');
  await page.waitForSelector('#unlock-demo .m-unlock [data-act="passkey"]');
  const before = await page.evaluate(() => {
    const card = document.querySelector('#unlock-demo .m-unlock');
    const t = card.querySelector('[data-act="show-code"]');
    const f = card.querySelector('form[data-form="code"]');
    return { expanded: t && t.getAttribute('aria-expanded'), formShown: !!f && f.getBoundingClientRect().height > 0, label: card.querySelector('[data-act="passkey"]').textContent.trim(), tag: card.querySelector('[data-act="passkey"]').tagName };
  });
  assert(before.expanded === 'false' && !before.formShown, 'code field starts closed when a passkey exists', before);
  assert(before.label === EN.passkey_button && before.tag === 'BUTTON', 'passkey is a native button', before);
  await page.click('#unlock-demo [data-act="passkey"]');
  await waitMsg(page, '#unlock-demo .m-unlock__msg', EN.err_prf);
  const after = await page.evaluate(() => {
    const card = document.querySelector('#unlock-demo .m-unlock');
    const input = card.querySelector('input[name="recovery-code"]');
    return { expanded: card.querySelector('[data-act="show-code"]').getAttribute('aria-expanded'), shown: input.getBoundingClientRect().height > 0, focus: document.activeElement === input, unlocked: window.__m.state().unlocked };
  });
  assert(after.expanded === 'true' && after.shown && after.focus && !after.unlocked, 'code field opened and focused', after);
  await page.type('#unlock-demo input[name="recovery-code"]', code);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__m.state().unlocked === true, { timeout: 15000 });
  await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: a2 });
});

check('launch overlay Not now stays away until reopen', async () => {
  const { page, code } = await labWithKeyring();
  await page.evaluate(() => window.__m.setAskAtLaunch(true));
  await closeAll();
  let about = await open('/about/');
  const shown = await until(() => layerOpen(about), 12000);
  assert(shown, 'launch overlay shows after a reopen with ask at launch on');
  const info = await about.evaluate(() => {
    const d = document.querySelector('.m-ulayer [role="dialog"]');
    const main = document.querySelector('main');
    const title = document.getElementById(d.getAttribute('aria-labelledby'));
    return {
      modal: d.getAttribute('aria-modal'),
      title: title && title.textContent.trim(),
      card: !!d.querySelector('.m-unlock'),
      notNow: (d.querySelector('[data-act="not-now"]') || {}).textContent,
      focusIn: d.contains(document.activeElement),
      inert: main.inert === true,
      filter: getComputedStyle(main).filter,
      backdrop: getComputedStyle(document.querySelector('.m-ulayer')).backdropFilter || 'none'
    };
  });
  assert(info.modal === 'true' && info.title === EN.card_title && info.card, 'dialog labelled by the card title', info);
  assert(info.notNow && info.notNow.trim() === EN.not_now, 'Not now button', info);
  assert(info.focusIn && info.inert, 'focus inside the dialog, page behind is inert', info);
  assert(info.filter !== 'none' && /blur/.test(info.filter) && info.backdrop === 'none', 'content is filtered, no backdrop-filter', info);
  for (let i = 0; i < 8; i++) {
    await about.keyboard.press('Tab');
    assert(await about.evaluate(() => document.querySelector('.m-ulayer [role="dialog"]').contains(document.activeElement)), 'Tab stays inside the dialog', i);
  }
  await about.keyboard.down('Shift');
  for (let i = 0; i < 4; i++) await about.keyboard.press('Tab');
  await about.keyboard.up('Shift');
  assert(await about.evaluate(() => document.querySelector('.m-ulayer [role="dialog"]').contains(document.activeElement)), 'Shift+Tab stays inside the dialog');
  const keys = () => about.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('mentria.keyring') || k.startsWith('mentria.store.keyring')).sort().map((k) => k + '=' + (k === 'mentria.keyring.seen' ? '' : localStorage.getItem(k))));
  const before = await keys();
  await about.click('.m-ulayer [data-act="not-now"]');
  await about.waitForFunction(() => !document.querySelector('.m-ulayer'), { timeout: 5000 });
  const gone = await about.evaluate(() => ({ inert: document.querySelector('main').inert, filter: getComputedStyle(document.querySelector('main')).filter, unlocked: window.__m ? window.__m.state().unlocked : null }));
  assert(!gone.inert && gone.filter === 'none', 'page restored after Not now', gone);
  assert(JSON.stringify(await keys()) === JSON.stringify(before), 'Not now stores nothing', { before, after: await keys() });
  await about.goto(ORIGIN + '/tools/', { waitUntil: 'load' });
  const s1 = await modules(about);
  await sleep(2500);
  assert(s1.launch === 'continue' && !(await layerOpen(about)), 'next page in the same tab does not ask', s1);
  const other = await open('/about/');
  const s2 = await modules(other);
  await sleep(2500);
  assert(s2.launch === 'continue' && !(await layerOpen(other)), 'a second tab does not ask', s2);
  await closeAll();
  about = await open('/about/');
  assert(await until(() => layerOpen(about), 12000), 'the overlay comes back after the next reopen');
  await openCode(about, '.m-ulayer');
  await about.type('.m-ulayer input[name="recovery-code"]', code);
  await about.keyboard.press('Enter');
  await about.waitForFunction(() => !document.querySelector('.m-ulayer'), { timeout: 15000 });
  const s3 = await modules(about);
  assert(s3.unlocked, 'unlocking in the overlay closes it and unlocks', s3);
});

check('setup with new code requires last four', async () => {
  await clean();
  const page = await open('/beta/unlock/');
  await enableOnLab(page);
  await modules(page);
  await page.click('#unlock-demo-setup');
  assert(await step(page) === 'intro', 'setup opens on the intro');
  const intro = await page.evaluate(() => {
    const d = document.querySelector('.m-ulayer [role="dialog"]');
    return { modal: d.getAttribute('aria-modal'), title: document.getElementById(d.getAttribute('aria-labelledby')).textContent.trim(), lede: d.querySelector('[data-step] p').textContent.trim() };
  });
  assert(intro.modal === 'true' && intro.title === EN.setup_title && intro.lede === EN.setup_lede, 'intro copy', intro);
  await page.click('.m-ulayer [data-act="next"]');
  await waitStep(page, 'code');
  const code = await shownCode(page);
  assert(/^([A-Z2-7]{4}-){7}[A-Z2-7]{4}$/.test(code), 'a new code is shown', code);
  const ui = await page.evaluate(() => {
    const d = document.querySelector('.m-ulayer [role="dialog"]');
    const check = d.querySelector('input[name="code-check"]');
    return {
      copy: (d.querySelector('[data-act="copy"]') || {}).textContent,
      save: (d.querySelector('[data-act="save"]') || {}).textContent,
      label: check && check.labels.length ? check.labels[0].textContent.trim() : null,
      next: d.querySelector('[data-act="next"]').disabled,
      record: localStorage.getItem('mentria.store.keyring.vault')
    };
  });
  assert(ui.copy && ui.copy.trim() === EN.code_copy && ui.save && ui.save.trim() === EN.code_save, 'Copy and Save as file', ui);
  assert(ui.label === EN.code_check && ui.next === true && ui.record === null, 'Next waits for the last four, nothing written yet', ui);
  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'deny' });
  await page.evaluate(() => {
    window.__saved = null;
    const orig = URL.createObjectURL;
    URL.createObjectURL = function (b) { b.text().then((t) => { window.__saved = t; }); return orig.call(URL, b); };
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { window.__savedName = this.download; return click.call(this); };
  });
  await page.click('.m-ulayer [data-act="save"]');
  await page.waitForFunction(() => window.__saved, { timeout: 5000 });
  const saved = await page.evaluate(() => ({ name: window.__savedName, text: window.__saved }));
  assert(saved.name === 'mentria-recovery-code.txt' && saved.text.includes(code) && saved.text.includes(EN.code_body), 'Save as file writes the code and what it is for', saved);
  await page.type('.m-ulayer input[name="code-check"]', 'ZZZZ' === code.slice(-4) ? 'YYYY' : 'ZZZZ');
  await waitMsg(page, '.m-ulayer .m-usheet__msg', EN.code_check_err);
  assert(await page.$eval('.m-ulayer [data-act="next"]', (b) => b.disabled), 'Next stays off with the wrong four');
  await typeInto(page, '.m-ulayer input[name="code-check"]', code.slice(-4).toLowerCase());
  await page.waitForFunction(() => !document.querySelector('.m-ulayer [data-act="next"]').disabled);
  assert(await record(page) === null, 'nothing written before Next');
  await page.evaluate(() => {
    const enc = crypto.subtle.encrypt.bind(crypto.subtle);
    window.__slow = true;
    crypto.subtle.encrypt = async (...a) => {
      if (window.__slow) await new Promise((r) => setTimeout(r, 700));
      return enc(...a);
    };
  });
  await page.keyboard.press('Enter');
  const busy = await until(() => busyNow(page, EN.saving), 5000);
  const busyState = await busyInfo(page);
  await page.evaluate(() => { window.__slow = false; });
  assert(busy, 'buttons off and the saving line shown while the keyring is made', busyState);
  assert(EN.saving !== EN.working && busyState.fields.length > 0 && busyState.fields.every((f) => f.locked), 'the last-four field is read-only while the keyring is made', busyState);
  await until(async () => ['passkey', 'no-prf'].includes(await step(page)), 15000);
  const made = await page.evaluate(() => ({ st: window.__m.state(), rec: !!localStorage.getItem('mentria.store.keyring.vault') }));
  assert(made.rec && made.st.setUp && made.st.unlocked && made.st.codeConfirmed, 'Next on the code step makes the confirmed keyring', made);
  const s3 = await step(page);
  if (s3 === 'passkey') {
    const pk = await page.evaluate(() => {
      const d = document.querySelector('.m-ulayer [role="dialog"]');
      return {
        title: document.getElementById(d.getAttribute('aria-labelledby')).textContent.trim(),
        add: (d.querySelector('[data-act="add-passkey"]') || {}).textContent,
        skip: (d.querySelector('[data-act="skip-passkey"]') || {}).textContent,
        notNow: !!d.querySelector('[data-act="not-now"]')
      };
    });
    assert(pk.title === EN.passkey_step_title && pk.title !== EN.add_passkey, 'the passkey step title differs from its button', pk);
    assert(pk.add && pk.add.trim() === EN.add_passkey && pk.skip && pk.skip.trim() === EN.skip_for_now && !pk.notNow, 'Add a passkey and Skip for now, no Later', pk);
    await page.click('.m-ulayer [data-act="skip-passkey"]');
  } else {
    await page.click('.m-ulayer [data-act="done"]');
  }
  await page.waitForFunction(() => !document.querySelector('.m-ulayer'), { timeout: 15000 });
  const res = await page.evaluate(() => window.__setupResult);
  const st = await page.evaluate(() => window.__m.state());
  assert(res === true && st.setUp && st.unlocked && st.codeConfirmed && st.passkeys === 0, 'skip finishes a confirmed keyring', { res, st });
  const r = await page.evaluate(async (c) => {
    await window.__m.lock();
    await window.__m.unlockWithCode(c);
    return window.__m.state().unlocked;
  }, code);
  assert(r, 'the shown code unlocks');
});

check('setup Later writes nothing', async () => {
  await clean();
  const page = await open('/beta/unlock/');
  await enableOnLab(page);
  await modules(page);
  await page.click('#unlock-demo-setup');
  await waitStep(page, 'intro');
  await page.click('.m-ulayer [data-act="not-now"]');
  await page.waitForFunction(() => !document.querySelector('.m-ulayer'), { timeout: 5000 });
  assert(await page.evaluate(() => window.__setupResult) === false, 'Later returns false');
  await page.click('#unlock-demo-setup');
  await waitStep(page, 'intro');
  await page.click('.m-ulayer [data-act="next"]');
  await waitStep(page, 'code');
  const first = await shownCode(page);
  await page.type('.m-ulayer input[name="code-check"]', first.slice(-4));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.m-ulayer'), { timeout: 5000 });
  assert(await page.evaluate(() => window.__setupResult) === false, 'Escape on the code step returns false');
  await page.click('#unlock-demo-setup');
  await waitStep(page, 'intro');
  await page.click('.m-ulayer [data-act="next"]');
  await waitStep(page, 'code');
  const again = await shownCode(page);
  assert(again === first, 'reopening setup shows the code already shown', { first, again });
  await page.click('.m-ulayer [data-act="not-now"]');
  await page.waitForFunction(() => !document.querySelector('.m-ulayer'), { timeout: 5000 });
  const r = await page.evaluate(async () => ({
    res: window.__setupResult,
    rec: localStorage.getItem('mentria.store.keyring.vault'),
    dbs: (await indexedDB.databases()).map((d) => d.name),
    st: window.__m.state()
  }));
  assert(r.res === false && r.rec === null && !r.st.setUp && !r.dbs.includes('mentria-keyring'), 'nothing written on Later or Escape', r);
  await page.click('#unlock-demo-setup');
  await waitStep(page, 'intro');
  await page.click('.m-ulayer [data-act="next"]');
  await waitStep(page, 'code');
  await page.type('.m-ulayer input[name="code-check"]', first.slice(-4));
  await page.click('.m-ulayer [data-act="next"]');
  await until(async () => ['passkey', 'no-prf'].includes(await step(page)), 15000);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.m-ulayer'), { timeout: 5000 });
  const made = await page.evaluate(async (c) => {
    const out = { res: window.__setupResult, setUp: window.__m.state().setUp };
    await window.__m.lock();
    await window.__m.unlockWithCode(c);
    out.unlocked = window.__m.state().unlocked;
    return out;
  }, first);
  assert(made.res === true && made.setUp && made.unlocked, 'the reused code is the one the keyring was made with', made);
});

check('setup with knownCode skips the check', async () => {
  await clean();
  const page = await open('/beta/unlock/');
  await enableOnLab(page);
  await modules(page);
  const known = 'ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ23-4567';
  await start(page, "(ui) => ui.showSetup({ knownCode: '" + known + "', service: 'identity', secret: new Uint8Array(32).fill(7) })");
  await waitStep(page, 'intro');
  await page.click('.m-ulayer [data-act="next"]');
  await waitStep(page, 'code');
  const ui = await page.evaluate(() => {
    const d = document.querySelector('.m-ulayer [role="dialog"]');
    const keep = d.querySelector('input[name="code-choice"][value="keep"]');
    const check = d.querySelector('input[name="code-check"]');
    return {
      keep: !!keep && keep.checked,
      keepLabel: keep && keep.labels.length ? keep.labels[0].textContent.trim() : null,
      check: !!check && check.getBoundingClientRect().height > 0,
      code: !!d.querySelector('.m-ucode') && d.querySelector('.m-ucode').getBoundingClientRect().height > 0,
      next: d.querySelector('[data-act="next"]').disabled
    };
  });
  assert(ui.keep && ui.keepLabel && ui.keepLabel.startsWith(EN.keep_code), 'keep the saved code is preselected', ui);
  assert(!ui.check && !ui.code && ui.next === false, 'no last-four check and no new code', ui);
  await page.click('.m-ulayer [data-act="next"]');
  const s3 = await step(page);
  await until(async () => ['passkey', 'no-prf'].includes(await step(page)), 10000);
  if ((await step(page)) === 'passkey') await page.click('.m-ulayer [data-act="skip-passkey"]');
  else await page.click('.m-ulayer [data-act="done"]');
  const res = await settled(page, 15000);
  assert(res.ok && res.v === true, 'showSetup resolves true', { res, s3 });
  const r = await page.evaluate(async (c) => {
    const m = window.__m;
    const out = { st: m.state() };
    const s = await m.secret('identity');
    out.linked = !!s && s.length === 32 && s.every((b) => b === 7);
    await m.lock();
    await m.unlockWithCode(c);
    out.unlocked = m.state().unlocked;
    return out;
  }, known);
  assert(r.st.setUp && r.st.codeConfirmed && r.linked && r.unlocked, 'keyring made with the saved code, confirmed and linked', r);
});

check('setup with verifyCode checks the typed code', async () => {
  await clean();
  const page = await open('/beta/unlock/');
  await enableOnLab(page);
  await modules(page);
  const saved = 'WXYZ-2345-ABCD-EFGH-IJKL-MNOP-QRST-UV67';
  await start(page, "(ui) => ui.showSetup({ verifyCode: async (c) => { window.__verified = (window.__verified || []).concat([c]); await new Promise((r) => setTimeout(r, 700)); return c.replace(/-/g, '').toUpperCase() === '" + saved.replace(/-/g, '') + "'; } })");
  await waitStep(page, 'intro');
  await page.click('.m-ulayer [data-act="next"]');
  await waitStep(page, 'code');
  await page.waitForSelector('.m-ulayer input[name="saved-code"]');
  const attrs = await page.$eval('.m-ulayer input[name="saved-code"]', (el) => ({ ac: el.getAttribute('autocomplete'), cap: el.getAttribute('autocapitalize'), label: el.labels.length ? el.labels[0].textContent.trim() : null }));
  assert(attrs.ac === 'one-time-code' && attrs.cap === 'characters' && attrs.label === EN.code_label, 'saved code field', attrs);
  await page.type('.m-ulayer input[name="saved-code"]', 'AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA');
  await page.click('.m-ulayer [data-act="next"]');
  assert(await until(() => busyNow(page, EN.working), 3000), 'busy with the unlocking line while the saved code is checked', await busyInfo(page));
  await waitMsg(page, '.m-ulayer .m-usheet__msg', EN.err_code);
  assert(await step(page) === 'code' && await record(page) === null, 'a wrong saved code stays on the step, nothing written');
  await typeInto(page, '.m-ulayer input[name="saved-code"]', saved.toLowerCase());
  await page.click('.m-ulayer [data-act="next"]');
  await until(async () => ['passkey', 'no-prf'].includes(await step(page)), 10000);
  if ((await step(page)) === 'passkey') await page.click('.m-ulayer [data-act="skip-passkey"]');
  else await page.click('.m-ulayer [data-act="done"]');
  const res = await settled(page, 15000);
  const r = await page.evaluate(async (c) => {
    const m = window.__m;
    await m.lock();
    await m.unlockWithCode(c);
    return { unlocked: m.state().unlocked, confirmed: m.state().codeConfirmed, verified: window.__verified.length };
  }, saved);
  assert(res.ok && res.v === true && r.unlocked && r.confirmed && r.verified === 2, 'keyring made with the verified code', { res, r });
});

check('setup on a no-PRF device offers passphrase and remember', async () => {
  await clean();
  const page = await open('/beta/unlock/', NO_PRF);
  await enableOnLab(page);
  await modules(page);
  await page.click('#unlock-demo-setup');
  await waitStep(page, 'intro');
  await page.click('.m-ulayer [data-act="next"]');
  await waitStep(page, 'code');
  const code = await shownCode(page);
  await page.type('.m-ulayer input[name="code-check"]', code.slice(-4));
  await page.click('.m-ulayer [data-act="next"]');
  await waitStep(page, 'no-prf');
  const ui = await page.evaluate(() => {
    const d = document.querySelector('.m-ulayer [role="dialog"]');
    const lab = (n) => { const el = d.querySelector('input[name="' + n + '"]'); return el && el.labels.length ? el.labels[0].textContent.trim() : null; };
    return {
      title: document.getElementById(d.getAttribute('aria-labelledby')).textContent.trim(),
      body: d.querySelector('[data-step] p').textContent.trim(),
      pass: lab('set-pass'),
      remember: lab('remember'),
      passkey: !!d.querySelector('[data-act="add-passkey"]'),
      notNow: !!d.querySelector('[data-act="not-now"]'),
      rememberOn: d.querySelector('input[name="remember"]').checked,
      setUp: window.__m.state().setUp
    };
  });
  assert(ui.title === EN.no_prf_title && ui.body === EN.no_prf_body, 'no-PRF copy', ui);
  assert(ui.pass && ui.pass.startsWith(EN.set_passphrase) && ui.remember && ui.remember.startsWith(EN.remember_label), 'passphrase and remember offered', ui);
  assert(!ui.passkey && !ui.rememberOn && !ui.notNow && ui.setUp, 'keyring made, no passkey button, no Later, remember off by default', ui);
  await page.click('.m-ulayer input[name="set-pass"]');
  await page.waitForFunction(() => { const el = document.querySelector('.m-ulayer input[name="new-pass"]'); return el && el.getBoundingClientRect().height > 0; });
  const pa = await page.$eval('.m-ulayer input[name="new-pass"]', (el) => ({ type: el.type, ac: el.getAttribute('autocomplete'), label: el.labels.length ? el.labels[0].textContent.trim() : null }));
  assert(pa.type === 'password' && pa.ac === 'new-password' && pa.label === EN.passphrase_label, 'new passphrase field', pa);
  await page.type('.m-ulayer input[name="new-pass"]', 'short');
  await page.click('.m-ulayer [data-act="done"]');
  await waitMsg(page, '.m-ulayer .m-usheet__msg', EN.passphrase_rule);
  assert(!(await page.evaluate(() => window.__m.state().hasPass)), 'a short passphrase sets nothing');
  await typeInto(page, '.m-ulayer input[name="new-pass"]', 'correct horse battery');
  await page.click('.m-ulayer input[name="remember"]');
  await page.click('.m-ulayer [data-act="done"]');
  await page.waitForFunction(() => !document.querySelector('.m-ulayer'), { timeout: 20000 });
  const st = await page.evaluate(() => ({ res: window.__setupResult, s: window.__m.state() }));
  assert(st.res === true && st.s.setUp && st.s.hasPass && st.s.hasDevice && st.s.codeConfirmed && st.s.passkeys === 0, 'keyring with passphrase and remember', st);
  await page.evaluate(() => window.__m.lock());
  await page.click('#unlock-demo-card');
  await page.waitForSelector('#unlock-demo .m-unlock');
  const card = await page.evaluate(() => {
    const c = document.querySelector('#unlock-demo .m-unlock');
    const p = c.querySelector('input[name="passphrase"]');
    return { passkey: !!c.querySelector('[data-act="passkey"]') && c.querySelector('[data-act="passkey"]').getBoundingClientRect().height > 0, ac: p && p.getAttribute('autocomplete'), shown: !!p && p.getBoundingClientRect().height > 0, label: p && p.labels.length ? p.labels[0].textContent.trim() : null };
  });
  assert(!card.passkey && card.shown && card.ac === 'current-password' && card.label === EN.passphrase_label, 'card offers the passphrase', card);
  await page.type('#unlock-demo input[name="passphrase"]', 'wrong passphrase here');
  await page.keyboard.press('Enter');
  await waitMsg(page, '#unlock-demo .m-unlock__msg', EN.err_pass);
  await typeInto(page, '#unlock-demo input[name="passphrase"]', 'correct horse battery');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__m.state().unlocked === true, { timeout: 20000 });
});

check('setup adds a passkey and the card unlocks with it', async () => {
  await clean();
  const page = await open('/beta/unlock/');
  const cdp = await page.createCDPSession();
  await cdp.send('WebAuthn.enable');
  const a = (await cdp.send('WebAuthn.addVirtualAuthenticator', { options: Object.assign({ hasPrf: true }, AUTH) })).authenticatorId;
  await enableOnLab(page);
  await modules(page);
  await start(page, "(ui) => ui.showSetup({ knownCode: 'ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ23-4567', knownPassphrase: 'an old passphrase kept' })");
  await waitStep(page, 'intro');
  await page.click('.m-ulayer [data-act="next"]');
  await waitStep(page, 'code');
  await page.click('.m-ulayer [data-act="next"]');
  await waitStep(page, 'passkey');
  const ui = await page.evaluate(() => {
    const d = document.querySelector('.m-ulayer [role="dialog"]');
    const k = d.querySelector('input[name="keep-pass"]');
    return { title: document.getElementById(d.getAttribute('aria-labelledby')).textContent.trim(), btn: (d.querySelector('[data-act="add-passkey"]') || {}).textContent, keep: !!k && k.checked, keepLabel: k && k.labels.length ? k.labels[0].textContent.trim() : null };
  });
  assert(ui.title === EN.passkey_step_title && ui.btn && ui.btn.trim() === EN.add_passkey && ui.keep && ui.keepLabel === EN.keep_passphrase, 'passkey step with keep passphrase on', ui);
  await page.click('.m-ulayer [data-act="add-passkey"]');
  const res = await settled(page, 40000);
  const st = await page.evaluate(() => window.__m.state());
  assert(res.ok && res.v === true && st.passkeys === 1 && st.hasPass && st.unlocked, 'keyring with a passkey and the kept passphrase', { res, st });
  await page.evaluate(() => window.__m.lock());
  await page.click('#unlock-demo-card');
  await page.waitForSelector('#unlock-demo [data-act="passkey"]');
  await page.click('#unlock-demo [data-act="passkey"]');
  await page.waitForFunction(() => window.__m.state().unlocked === true, { timeout: 30000 });
  await until(() => page.evaluate(() => (window.__cardUnlocks || 0) === 1), 5000);
  assert(await page.evaluate(() => window.__cardUnlocks) === 1, 'card reports the passkey unlock once');
  await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: a });
});

check('setup falls back when the passkey has no PRF', async () => {
  await clean();
  const page = await open('/beta/unlock/', LIVE_PROBE);
  const cdp = await page.createCDPSession();
  await cdp.send('WebAuthn.enable');
  const a = (await cdp.send('WebAuthn.addVirtualAuthenticator', { options: Object.assign({ hasPrf: false }, AUTH) })).authenticatorId;
  await enableOnLab(page);
  await modules(page);
  const support = await page.evaluate(() => window.__m.prfSupport());
  if (support === 'no') throw new Error('this browser reports no PRF support, so the fallback cannot be reached from the passkey step');
  await page.click('#unlock-demo-setup');
  await waitStep(page, 'intro');
  await page.click('.m-ulayer [data-act="next"]');
  await waitStep(page, 'code');
  const code = await shownCode(page);
  await page.type('.m-ulayer input[name="code-check"]', code.slice(-4));
  await page.click('.m-ulayer [data-act="next"]');
  await waitStep(page, 'passkey');
  await page.click('.m-ulayer [data-act="add-passkey"]');
  await waitStep(page, 'no-prf');
  const mid = await page.evaluate(() => ({ s: window.__m.state(), notNow: !!document.querySelector('.m-ulayer [data-act="not-now"]') }));
  assert(mid.s.setUp && mid.s.passkeys === 0 && !mid.notNow, 'keyring made, no-PRF options offered, no Later once written', mid);
  assert(EN.passkey_unusable && EN.passkey_unusable !== EN.passkey_skipped, 'the unusable-passkey line has its own copy');
  await waitMsg(page, '.m-ulayer .m-usheet__msg', EN.passkey_unusable);
  const warn = await page.$eval('.m-ulayer .m-usheet__msg', (el) => ({ warn: el.classList.contains('is-warn'), error: el.classList.contains('is-error') }));
  assert(warn.warn && !warn.error, 'the device saved a passkey Mentria cannot use, said as a warning', warn);
  const live = await page.evaluate(() => window.__live.filter((x) => x.text === document.querySelector('.m-ulayer .m-usheet__msg').textContent));
  assert(live.length > 0 && live.every((x) => x.frame > x.born), 'the new step fills its live region a frame after the region is in the DOM', live);
  await page.click('.m-ulayer input[name="remember"]');
  await page.click('.m-ulayer [data-act="done"]');
  await page.waitForFunction(() => !document.querySelector('.m-ulayer'), { timeout: 15000 });
  const st = await page.evaluate(() => ({ res: window.__setupResult, s: window.__m.state() }));
  assert(st.res === true && st.s.hasDevice && st.s.codeConfirmed, 'remember turned on after the fallback', st);
  await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: a });
  await clean();
  const p2 = await open('/beta/unlock/');
  await enableOnLab(p2);
  await modules(p2);
  await p2.click('#unlock-demo-setup');
  await waitStep(p2, 'intro');
  await p2.click('.m-ulayer [data-act="next"]');
  await waitStep(p2, 'code');
  const c2 = await shownCode(p2);
  await p2.type('.m-ulayer input[name="code-check"]', c2.slice(-4));
  await p2.click('.m-ulayer [data-act="next"]');
  await waitStep(p2, 'passkey');
  await p2.evaluate(() => { delete window.PublicKeyCredential; });
  await p2.click('.m-ulayer [data-act="add-passkey"]');
  await waitStep(p2, 'no-prf');
  await waitMsg(p2, '.m-ulayer .m-usheet__msg', EN.passkey_skipped);
});

check('confirm and a regenerated code', async () => {
  const { page, code } = await labWithKeyring();
  await page.reload({ waitUntil: 'load' });
  await modules(page);
  assert(await page.evaluate(() => window.__m.state().unlocked && !window.__m.hasRootBytes()), 'after a reload the page holds no R bytes');
  await start(page, '(ui) => ui.showConfirm()');
  await page.waitForSelector('.m-ulayer .m-unlock');
  const c = await page.evaluate(() => {
    const d = document.querySelector('.m-ulayer [role="dialog"]');
    return { title: document.getElementById(d.getAttribute('aria-labelledby')).textContent.trim(), body: d.querySelector('.m-unlock__lede').textContent.trim() };
  });
  assert(c.title === EN.confirm_title && c.body === EN.confirm_body, 'confirm copy', c);
  await openCode(page, '.m-ulayer');
  await page.type('.m-ulayer input[name="recovery-code"]', 'AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA');
  await page.keyboard.press('Enter');
  await waitMsg(page, '.m-ulayer .m-unlock__msg', EN.err_code);
  await typeInto(page, '.m-ulayer input[name="recovery-code"]', code);
  await page.keyboard.press('Enter');
  const ok = await settled(page, 15000);
  assert(ok.ok && ok.v === true && await page.evaluate(() => window.__m.hasRootBytes()), 'confirm brings R back', ok);
  const fresh = await page.evaluate(async () => { window.__fresh = await window.__m.regenerateCode(); return window.__fresh; });
  await start(page, '(ui) => ui.showCode(window.__fresh)');
  await page.waitForSelector('.m-ulayer .m-ucode');
  assert(await shownCode(page) === fresh, 'the regenerated code is shown');
  assert(await page.$eval('.m-ulayer [data-act="done"]', (b) => b.disabled), 'Done waits for the last four');
  await page.type('.m-ulayer input[name="code-check"]', fresh.slice(-4));
  await page.click('.m-ulayer [data-act="done"]');
  const shown = await settled(page, 10000);
  assert(shown.ok && shown.v === true && await page.evaluate(() => window.__m.state().codeConfirmed), 'last four confirms the new code', shown);
  await start(page, '(ui) => ui.showConfirm()');
  const already = await settled(page, 5000);
  assert(already.ok && already.v === true && !(await layerOpen(page)), 'confirm with R bytes in memory asks nothing', already);
  await page.evaluate(() => window.__m.lock());
  await page.reload({ waitUntil: 'load' });
  await modules(page);
  await page.evaluate((c) => window.__m.unlockWithCode(c), fresh);
  await page.reload({ waitUntil: 'load' });
  await modules(page);
  await start(page, '(ui) => ui.showConfirm()');
  await page.waitForSelector('.m-ulayer [data-act="not-now"]');
  await page.click('.m-ulayer [data-act="not-now"]');
  const no = await settled(page, 5000);
  assert(no.ok && no.v === false && !(await layerOpen(page)), 'Not now returns false', no);
});

check('lockNow locks and tells', async () => {
  const { page } = await labWithKeyring();
  await page.evaluate(() => window.__ui.lockNow());
  const r = await page.evaluate(() => ({ unlocked: window.__m.state().unlocked, toast: (document.querySelector('.m-toast') || {}).textContent }));
  assert(!r.unlocked && r.toast === EN.locked_toast, 'locked with the toast', r);
});

check('card works inside the Finance frame', async () => {
  const { page, code } = await labWithKeyring();
  await page.evaluate(() => window.__m.lock());
  await page.evaluate(() => new Promise((res) => {
    const f = document.createElement('iframe');
    f.src = '/extensions/finance/app/';
    f.style.cssText = 'width:420px;height:640px;border:0';
    f.onload = () => res();
    document.body.appendChild(f);
  }));
  const frame = page.frames().find((f) => f.url().includes('/extensions/finance/app/'));
  await modules(frame);
  const r = await frame.evaluate(async () => {
    const box = document.createElement('div');
    box.id = 't-box';
    box.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#04060a;overflow:auto;padding:16px';
    document.body.appendChild(box);
    window.__fu = 0;
    window.__card = await window.__ui.mountCard(box, { onUnlocked: () => { window.__fu++; } });
    return { ui: typeof window.MentriaUI, card: !!box.querySelector('.m-unlock'), radius: getComputedStyle(box.querySelector('.m-unlock')).borderRadius };
  });
  assert(r.ui === 'undefined' && r.card && r.radius !== '0px', 'card mounts and is styled in a frame without the site UI', r);
  await openCode(frame, '#t-box');
  await frame.type('#t-box input[name="recovery-code"]', code);
  await page.keyboard.press('Enter');
  await frame.waitForFunction(() => window.__fu === 1, { timeout: 15000 });
  await frame.evaluate(() => window.__ui.lockNow());
  const t = await until(() => page.evaluate((w) => (document.querySelector('.m-toast') || {}).textContent === w, EN.locked_toast), 3000);
  assert(t, 'lockNow in the frame uses the parent toast');
  await frame.evaluate(() => { window.__card.destroy(); });
  assert(await frame.evaluate(() => !document.querySelector('#t-box .m-unlock')), 'destroy removes the card');
});

check('card text follows the page locale', async () => {
  const { page } = await labWithKeyring();
  await page.evaluate(() => window.__m.lock());
  const ja = await open('/ja/about/');
  await modules(ja);
  const r = await ja.evaluate(async () => {
    const box = document.createElement('div');
    document.querySelector('main').prepend(box);
    await window.__ui.mountCard(box, { onUnlocked: () => {} });
    const copy = (await import('/assets/js/unlock-copy.ja.js')).default;
    return { code: document.documentElement.dataset.siteCode, title: box.querySelector('.m-unlock__title').textContent.trim(), toggle: box.querySelector('[data-act="show-code"]') ? box.querySelector('[data-act="show-code"]').textContent.trim() : null, label: box.querySelector('input[name="recovery-code"]').labels[0].textContent.trim(), copyTitle: copy.card_title };
  });
  assert(r.code === 'ja' && r.title === JA.card_title && r.copyTitle === JA.card_title && r.title !== EN.card_title, 'Japanese card title', r);
  assert(r.label === JA.code_label, 'Japanese field label', r);
  const en = await page.evaluate(async () => (await import('/assets/js/unlock-copy.en.js')).default.card_title);
  assert(en === EN.card_title, 'English copy module', en);
});

check('card and sheets pass axe', async () => {
  const { page } = await labWithKeyring();
  await page.evaluate(() => window.__m.lock());
  await page.click('#unlock-demo-card');
  await page.waitForSelector('#unlock-demo .m-unlock');
  await openCode(page, '#unlock-demo .m-unlock');
  const v1 = await axe(page, '#unlock-demo .m-unlock');
  assert(!v1.length, 'card', v1);
  await start(page, '(ui) => ui.showLaunch()');
  await page.waitForSelector('.m-ulayer .m-unlock');
  const v2 = await axe(page, '.m-ulayer');
  assert(!v2.length, 'launch overlay', v2);
  await page.click('.m-ulayer [data-act="not-now"]');
  await page.waitForFunction(() => !document.querySelector('.m-ulayer'));
  await clean();
  const p2 = await open('/beta/unlock/');
  await enableOnLab(p2);
  await modules(p2);
  await p2.click('#unlock-demo-setup');
  await waitStep(p2, 'intro');
  await p2.click('.m-ulayer [data-act="next"]');
  await waitStep(p2, 'code');
  const v3 = await axe(p2, '.m-ulayer');
  assert(!v3.length, 'setup code step', v3);
  const small = await targets(p2, '.m-ulayer');
  assert(!small.length, '44 px targets on the setup sheet', small);
});

check('passkey clicks reach WebAuthn first', async () => {
  await clean();
  const page = await open('/beta/unlock/', CLICK_PROBE);
  const cdp = await page.createCDPSession();
  await cdp.send('WebAuthn.enable');
  const a = (await cdp.send('WebAuthn.addVirtualAuthenticator', { options: Object.assign({ hasPrf: true }, AUTH) })).authenticatorId;
  await enableOnLab(page);
  await modules(page);
  await page.click('#unlock-demo-setup');
  await waitStep(page, 'intro');
  await page.click('.m-ulayer [data-act="next"]');
  await waitStep(page, 'code');
  const code = await shownCode(page);
  await page.type('.m-ulayer input[name="code-check"]', code.slice(-4));
  await page.click('.m-ulayer [data-act="next"]');
  await waitStep(page, 'passkey');
  await page.evaluate(() => { window.__wa = []; });
  await page.click('.m-ulayer [data-act="add-passkey"]');
  await until(() => page.evaluate(() => window.__wa.length > 0), 30000);
  const setupCalls = await page.evaluate(() => window.__wa);
  assert(setupCalls[0] === 'create:true', 'setup: Add a passkey reaches navigator.credentials.create inside the click', setupCalls);
  await page.waitForFunction(() => !document.querySelector('.m-ulayer'), { timeout: 30000 });
  await page.evaluate(() => window.__m.lock());
  await page.click('#unlock-demo-card');
  await page.waitForSelector('#unlock-demo [data-act="passkey"]');
  await page.evaluate(() => { window.__wa = []; });
  await page.click('#unlock-demo [data-act="passkey"]');
  await until(() => page.evaluate(() => window.__wa.length > 0), 30000);
  const cardCalls = await page.evaluate(() => window.__wa);
  assert(cardCalls[0] === 'get:true', 'card: the passkey button reaches navigator.credentials.get inside the click', cardCalls);
  await page.waitForFunction(() => window.__m.state().unlocked === true, { timeout: 30000 });
  await page.reload({ waitUntil: 'load' });
  await modules(page);
  await start(page, '(ui) => ui.showConfirm()');
  await page.waitForSelector('.m-ulayer [data-act="passkey"]');
  await page.evaluate(() => { window.__wa = []; });
  await page.click('.m-ulayer [data-act="passkey"]');
  await until(() => page.evaluate(() => window.__wa.length > 0), 30000);
  const confirmCalls = await page.evaluate(() => window.__wa);
  assert(confirmCalls[0] === 'get:true', 'confirm: the passkey button reaches navigator.credentials.get inside the click', confirmCalls);
  await settled(page, 30000);
  const cred = (await cdp.send('WebAuthn.getCredentials', { authenticatorId: a })).credentials[0];
  await page.evaluate(async () => { window.__m.setAskAtLaunch(true); await window.__m.lock(); });
  await closeAll();
  const about = await open('/about/', CLICK_PROBE);
  const cdp2 = await about.createCDPSession();
  await cdp2.send('WebAuthn.enable');
  const a2 = (await cdp2.send('WebAuthn.addVirtualAuthenticator', { options: Object.assign({ hasPrf: true }, AUTH) })).authenticatorId;
  await cdp2.send('WebAuthn.addCredential', { authenticatorId: a2, credential: cred });
  assert(await until(() => layerOpen(about), 12000), 'launch overlay shows');
  await about.waitForSelector('.m-ulayer [data-act="passkey"]');
  await about.evaluate(() => { window.__wa = []; });
  await about.click('.m-ulayer [data-act="passkey"]');
  await until(() => about.evaluate(() => window.__wa.length > 0), 30000);
  const launchCalls = await about.evaluate(() => window.__wa);
  assert(launchCalls[0] === 'get:true', 'launch: the passkey button reaches navigator.credentials.get inside the click', launchCalls);
});

check('showCode warns once before a close keeps the old code', async () => {
  await clean();
  const page = await open('/beta/unlock/', NO_CLOSE_WATCHER);
  await enableOnLab(page);
  const old = await createOnLab(page);
  await modules(page);
  const raw0 = await page.evaluate(() => localStorage.getItem('mentria.store.keyring.vault'));
  const fresh = await page.evaluate(async () => { window.__fresh = await window.__m.regenerateCode(); return window.__fresh; });
  await start(page, '(ui) => ui.showCode(window.__fresh)');
  await page.waitForSelector('.m-ulayer .m-ucode');
  const ui = await page.evaluate(() => {
    const d = document.querySelector('.m-ulayer [role="dialog"]');
    return { notNow: !!d.querySelector('[data-act="not-now"]'), copy: !!d.querySelector('[data-act="copy"]'), save: !!d.querySelector('[data-act="save"]'), closeWatcher: typeof window.CloseWatcher };
  });
  assert(!ui.notNow && ui.copy && ui.save && ui.closeWatcher === 'undefined', 'no Not now; Copy and Save as file stay', ui);
  await page.keyboard.press('Escape');
  await waitMsg(page, '.m-ulayer .m-usheet__msg', EN.code_close_again);
  assert(await layerOpen(page) && await page.evaluate(() => window.__r === null), 'the first Escape keeps the code on screen and says what a close does');
  await page.evaluate(() => history.back());
  const closed = await settled(page, 5000);
  assert(closed.ok && closed.v === false && !(await layerOpen(page)), 'Back then closes it with false', closed);
  const kept = await page.evaluate(async ([raw0, old, fresh]) => {
    const C = await import('/assets/js/mentria-unlock-core.js');
    const rec = JSON.parse(localStorage.getItem('mentria.store.keyring.vault'));
    return {
      same: localStorage.getItem('mentria.store.keyring.vault') === raw0,
      old: await C.openWithCode(rec.wraps.recovery, old).then(() => true, () => false),
      fresh: await C.openWithCode(rec.wraps.recovery, fresh).then(() => true, () => false)
    };
  }, [raw0, old, fresh]);
  assert(kept.same && kept.old && !kept.fresh, 'closing keeps the old code', kept);
  const late = await page.evaluate((f) => ({ ok: window.__m.confirmCode(f.replace(/-/g, '').slice(-4)), raw: localStorage.getItem('mentria.store.keyring.vault') }), fresh);
  assert(late.ok === false && late.raw === raw0, 'closing drops the new code, so its last four confirm nothing later', { ok: late.ok, same: late.raw === raw0 });
  const next = await page.evaluate(async () => { window.__fresh = await window.__m.regenerateCode(); return window.__fresh; });
  await start(page, '(ui) => ui.showCode(window.__fresh)');
  await page.waitForSelector('.m-ulayer .m-ucode');
  await page.type('.m-ulayer input[name="code-check"]', next.slice(-4));
  await page.click('.m-ulayer [data-act="done"]');
  const r = await settled(page, 10000);
  assert(r.ok && r.v === true && !(await layerOpen(page)) && await page.evaluate(() => window.__m.state().codeConfirmed), 'the last four close it and confirm the code', r);
  const now = await page.evaluate(async (next) => {
    const C = await import('/assets/js/mentria-unlock-core.js');
    const rec = JSON.parse(localStorage.getItem('mentria.store.keyring.vault'));
    return C.openWithCode(rec.wraps.recovery, next).then(() => true, () => false);
  }, next);
  assert(now, 'the confirmed code is the one that opens');
});

check('setup resolves true only when the service is linked', async () => {
  for (const retry of [true, false]) {
    await clean();
    const page = await open('/beta/unlock/');
    await enableOnLab(page);
    await modules(page);
    await page.evaluate(() => {
      const S = window.MentriaStore;
      const set = S.set.bind(S);
      window.__failLink = true;
      S.set = (ns, key, v, o) => (window.__failLink && ns === 'keyring' && v && v.services && v.services.identity ? false : set(ns, key, v, o));
    });
    await start(page, "(ui) => ui.showSetup({ service: 'identity', secret: new Uint8Array(32).fill(9) })");
    await waitStep(page, 'intro');
    await page.click('.m-ulayer [data-act="next"]');
    await waitStep(page, 'code');
    const code = await shownCode(page);
    await page.type('.m-ulayer input[name="code-check"]', code.slice(-4));
    if (retry) await page.keyboard.press('Enter');
    else await page.click('.m-ulayer [data-act="next"]');
    await waitMsg(page, '.m-ulayer .m-usheet__msg', EN.err_storage);
    const mid = await page.evaluate(() => ({ step: document.querySelector('.m-ulayer [data-step]').dataset.step, notNow: !!document.querySelector('.m-ulayer [data-act="not-now"]'), s: window.__m.state(), r: window.__r }));
    assert(mid.step === 'code' && !mid.notNow && mid.s.setUp && mid.s.linked.length === 0 && mid.r === null, 'the link error stays on the step with a retry, no Later', mid);
    const f = await focusInfo(page);
    if (retry) assert(f.isFirst, 'focus returns to the first control after a link failure from the last-four field', f);
    else assert(f.inside && f.active === 'next', 'focus stays on Next after a link failure from Next', f);
    if (retry) {
      const before = await page.evaluate(() => JSON.parse(localStorage.getItem('mentria.store.keyring.vault')).kcv);
      await page.evaluate(() => { window.__failLink = false; });
      await page.click('.m-ulayer [data-act="next"]');
      await until(async () => ['passkey', 'no-prf'].includes(await step(page)), 15000);
      if ((await step(page)) === 'passkey') await page.click('.m-ulayer [data-act="skip-passkey"]');
      else await page.click('.m-ulayer [data-act="done"]');
      const res = await settled(page, 15000);
      const after = await page.evaluate(async () => {
        const s = await window.__m.secret('identity');
        return { kcv: JSON.parse(localStorage.getItem('mentria.store.keyring.vault')).kcv, linked: !!s && s.every((b) => b === 9) };
      });
      assert(res.ok && res.v === true && after.linked && after.kcv === before, 'the retry links without a new keyring and resolves true', { res, after, before });
    } else {
      await page.keyboard.press('Escape');
      const res = await settled(page, 10000);
      const s = await page.evaluate(() => window.__m.state());
      assert(res.ok && res.v === false && s.setUp && s.linked.length === 0, 'closing with the service unlinked resolves false', { res, s });
    }
  }
});

check('setup passkey cancel and the short passphrase line', async () => {
  await clean();
  const page = await open('/beta/unlock/', LIVE_PROBE);
  await enableOnLab(page);
  await modules(page);
  await page.evaluate(() => {
    navigator.credentials.create = () => Promise.reject(new DOMException('The operation either timed out or was not allowed.', 'NotAllowedError'));
  });
  await start(page, "(ui) => ui.showSetup({ knownCode: 'ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ23-4567', knownPassphrase: 'short one' })");
  await waitStep(page, 'intro');
  await page.click('.m-ulayer [data-act="next"]');
  await waitStep(page, 'code');
  await page.click('.m-ulayer [data-act="next"]');
  await waitStep(page, 'passkey');
  const ui = await page.evaluate(() => {
    const d = document.querySelector('.m-ulayer [role="dialog"]');
    return { keep: !!d.querySelector('input[name="keep-pass"]'), text: d.textContent };
  });
  assert(!ui.keep && ui.text.includes(EN.passphrase_too_short_keep), 'a short old passphrase is not offered and the sheet says why', ui);
  await page.click('.m-ulayer [data-act="add-passkey"]');
  await waitMsg(page, '.m-ulayer .m-usheet__msg', EN.passkey_skipped);
  const mid = await page.evaluate(() => ({ step: document.querySelector('.m-ulayer [data-step]').dataset.step, add: !!document.querySelector('.m-ulayer [data-act="add-passkey"]'), skip: !!document.querySelector('.m-ulayer [data-act="skip-passkey"]') }));
  assert(mid.step === 'passkey' && mid.add && mid.skip, 'after a cancel the step offers Add again and Skip', mid);
  const live = await page.evaluate(() => window.__live);
  const early = live.filter((x) => x.text && x.frame <= x.born);
  assert(live.length > 0 && !early.length, 'live-region text is filled at least one frame after the region is in the DOM', live);
  await page.click('.m-ulayer [data-act="skip-passkey"]');
  const res = await settled(page, 15000);
  const st = await page.evaluate(() => window.__m.state());
  assert(res.ok && res.v === true && st.passkeys === 0 && !st.hasPass, 'skip finishes without a passkey or a passphrase', { res, st });
});

check('back while busy keeps the handler', async () => {
  await clean();
  const page = await open('/beta/unlock/', NO_CLOSE_WATCHER);
  await enableOnLab(page);
  await modules(page);
  await start(page, '(ui) => ui.showSetup({ verifyCode: () => new Promise((r) => { window.__release = () => r(false); }) })');
  await waitStep(page, 'intro');
  await page.click('.m-ulayer [data-act="next"]');
  await waitStep(page, 'code');
  await page.type('.m-ulayer input[name="saved-code"]', 'WXYZ-2345-ABCD-EFGH-IJKL-MNOP-QRST-UV67');
  await page.click('.m-ulayer [data-act="next"]');
  assert(await until(() => busyNow(page, EN.working), 3000), 'busy while the code is checked', await busyInfo(page));
  await page.evaluate(() => history.back());
  await sleep(600);
  assert(await layerOpen(page) && await busyNow(page, EN.working) && await page.evaluate(() => window.__r === null), 'Back while busy is ignored');
  await page.evaluate(() => window.__release());
  await waitMsg(page, '.m-ulayer .m-usheet__msg', EN.err_code);
  await page.evaluate(() => history.back());
  const res = await settled(page, 5000);
  assert(res.ok && res.v === false && !(await layerOpen(page)) && await page.evaluate(() => location.pathname) === '/beta/unlock/', 'the next Back still closes the sheet', res);
});

check('a storage AbortError is not shown as cancelled', async () => {
  await clean();
  const page = await open('/beta/unlock/');
  const cdp = await page.createCDPSession();
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: Object.assign({ hasPrf: true }, AUTH) });
  await enableOnLab(page);
  const code = await createOnLab(page);
  await modules(page);
  await start(page, "(ui, m) => m.addPasskey('')");
  assert((await settled(page, 30000)).ok, 'passkey enrolled');
  await page.evaluate(() => window.__m.lock());
  await page.click('#unlock-demo-card');
  await page.waitForSelector('#unlock-demo [data-act="passkey"]');
  await page.evaluate(() => {
    window.__get = navigator.credentials.get.bind(navigator.credentials);
    navigator.credentials.get = () => Promise.reject(new DOMException('aborted', 'AbortError'));
  });
  await page.click('#unlock-demo [data-act="passkey"]');
  await waitMsg(page, '#unlock-demo .m-unlock__msg', EN.err_cancelled);
  await page.evaluate(() => {
    navigator.credentials.get = window.__get;
    const t = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...a) {
      if (a[1] === 'readwrite') throw new DOMException('aborted', 'AbortError');
      return t.apply(this, a);
    };
  });
  await openCode(page, '#unlock-demo .m-unlock');
  await page.type('#unlock-demo input[name="recovery-code"]', code);
  await page.keyboard.press('Enter');
  await waitMsg(page, '#unlock-demo .m-unlock__msg', EN.err_storage);
});

const KNOWN = 'ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ23-4567';
const KEPT = 'an old passphrase kept';
const NO_PRF_NO_CW = () => {
  if (window.PublicKeyCredential) PublicKeyCredential.getClientCapabilities = async () => ({ 'extension:prf': false });
  try { delete window.CloseWatcher; } catch (_) {}
};

async function setupTo(page, args, want) {
  await start(page, '(ui) => ui.showSetup(' + args + ')');
  await waitStep(page, 'intro');
  await page.click('.m-ulayer [data-act="next"]');
  await waitStep(page, 'code');
  await page.click('.m-ulayer [data-act="next"]');
  await waitStep(page, want);
}

check('closing the passkey or no-PRF step keeps the passphrase, never Remember', async () => {
  await clean();
  const page = await open('/beta/unlock/');
  await enableOnLab(page);
  await modules(page);
  await setupTo(page, "{ knownCode: '" + KNOWN + "', knownPassphrase: '" + KEPT + "' }", 'passkey');
  assert(await page.$eval('.m-ulayer input[name="keep-pass"]', (el) => el.checked), 'keep my passphrase is on by default');
  await page.evaluate(SLOW_ENCRYPT, 700);
  await page.keyboard.press('Escape');
  const busy = await until(() => busyNow(page, EN.saving), 5000);
  const during = await busyInfo(page);
  await page.evaluate(() => { window.__slow = false; });
  const res = await settled(page, 20000);
  const r = await page.evaluate(async (p) => {
    const m = window.__m;
    const out = { st: m.state(), layer: !!document.querySelector('.m-ulayer') };
    await m.lock();
    try { await m.unlockWithPassphrase(p); } catch (e) { out.err = String(e && e.message); }
    out.unlocked = m.state().unlocked;
    return out;
  }, KEPT);
  assert(res.ok && res.v === true && !r.layer && r.st.hasPass && r.st.passkeys === 0 && r.unlocked, 'Escape on the passkey step keeps the passphrase', { res, r });
  assert(await page.evaluate((w) => (document.querySelector('.m-toast') || {}).textContent !== w, EN.not_saved), 'a close that saved the passphrase shows no not-saved toast');
  assert(busy, 'the sheet stays open with the saving line while the passphrase is kept', during);

  await clean();
  const p2 = await open('/beta/unlock/', NO_PRF_NO_CW);
  await enableOnLab(p2);
  await modules(p2);
  await setupTo(p2, "{ knownCode: '" + KNOWN + "', knownPassphrase: '" + KEPT + "' }", 'no-prf');
  const opts = await p2.evaluate(() => ({ keep: document.querySelector('.m-ulayer input[name="keep-pass"]').checked, cw: typeof window.CloseWatcher }));
  assert(opts.keep && opts.cw === 'undefined', 'keep my passphrase is on by default on the no-PRF step', opts);
  await p2.click('.m-ulayer input[name="remember"]');
  await p2.evaluate(() => history.back());
  const res2 = await settled(p2, 20000);
  await sleep(400);
  const r2 = await p2.evaluate(() => ({ st: window.__m.state(), layer: !!document.querySelector('.m-ulayer'), path: location.pathname }));
  assert(res2.ok && res2.v === true && !r2.layer && r2.path === '/beta/unlock/', 'Back closes the no-PRF step and stays on the page', { res2, r2 });
  assert(r2.st.hasPass && !r2.st.hasDevice, 'Back keeps the passphrase and never turns on Remember', r2);

  await clean();
  const p3 = await open('/beta/unlock/');
  await enableOnLab(p3);
  await modules(p3);
  await setupTo(p3, "{ knownCode: '" + KNOWN + "', knownPassphrase: '" + KEPT + "' }", 'passkey');
  await p3.click('.m-ulayer input[name="keep-pass"]');
  await p3.keyboard.press('Escape');
  const res3 = await settled(p3, 10000);
  const s3 = await p3.evaluate(() => window.__m.state());
  assert(res3.ok && res3.v === true && !s3.hasPass, 'with keep my passphrase off, closing sets no passphrase', { res3, s3 });
  await sleep(300);
  assert(await p3.evaluate((w) => (document.querySelector('.m-toast') || {}).textContent !== w, EN.not_saved), 'closing with keep my passphrase off shows no not-saved toast');
});

check('a failed save on close: the next close closes and says so', async () => {
  const errors = [];
  for (const back of [false, true]) {
    try {
      await failedSaveClose(back);
    } catch (e) {
      errors.push(String(e && e.message || e).slice(0, 260));
    }
  }
  assert(!errors.length, errors.join(' || '));
});

async function failedSaveClose(back) {
  await clean();
  const page = await open('/beta/unlock/', back ? NO_CLOSE_WATCHER : undefined);
  await enableOnLab(page);
  await modules(page);
  await page.evaluate(() => {
    const S = window.MentriaStore;
    const set = S.set.bind(S);
    S.set = (ns, key, v, o) => (ns === 'keyring' && v && v.wraps && v.wraps.pass && typeof v.wraps.pass.ct === 'string' ? false : set(ns, key, v, o));
  });
  await setupTo(page, "{ knownCode: '" + KNOWN + "', knownPassphrase: '" + KEPT + "' }", 'passkey');
  const how = back ? 'Back' : 'Escape';
  const pre = await page.evaluate(() => ({ keep: document.querySelector('.m-ulayer input[name="keep-pass"]').checked, cw: typeof window.CloseWatcher }));
  assert(pre.keep && (!back || pre.cw === 'undefined'), 'keep my passphrase is on', pre);
  const close = () => (back ? page.evaluate(() => history.back()) : page.keyboard.press('Escape'));
  await close();
  await waitMsg(page, '.m-ulayer .m-usheet__msg', EN.err_storage);
  await sleep(400);
  const mid = await page.evaluate(() => ({ layer: !!document.querySelector('.m-ulayer'), r: window.__r, hasPass: window.__m.state().hasPass, path: location.pathname, toast: (document.querySelector('.m-toast') || {}).textContent || '' }));
  assert(mid.layer && mid.r === null && !mid.hasPass && mid.path === '/beta/unlock/', how + ': the first close shows the error and keeps the sheet', mid);
  assert(mid.toast !== EN.not_saved, how + ': no not-saved toast while the sheet stays', mid);
  await close();
  const closed = await until(() => page.evaluate(() => !!window.__r && !document.querySelector('.m-ulayer')), 10000);
  const after2 = await page.evaluate(() => ({ layer: !!document.querySelector('.m-ulayer'), r: window.__r, msg: (document.querySelector('.m-ulayer .m-usheet__msg') || {}).textContent || null }));
  assert(closed, how + ': the second close closes the sheet instead of trying again', after2);
  const res = await settled(page, 1000);
  await sleep(400);
  const end = await page.evaluate(() => ({ layer: !!document.querySelector('.m-ulayer'), hasPass: window.__m.state().hasPass, setUp: window.__m.state().setUp, path: location.pathname }));
  assert(res.ok && res.v === true && !end.layer && !end.hasPass && end.setUp && end.path === '/beta/unlock/', how + ': the second close closes without the passphrase and the page stays', { res, end });
  const told = await until(() => page.evaluate((w) => (document.querySelector('.m-toast') || {}).textContent === w, EN.not_saved), 3000);
  assert(EN.not_saved && told, how + ': the second close says the passphrase was not saved', await page.evaluate(() => (document.querySelector('.m-toast') || {}).textContent));
}

check('Add a passkey stays off once a passkey was added', async () => {
  await clean();
  const page = await open('/beta/unlock/');
  const cdp = await page.createCDPSession();
  await cdp.send('WebAuthn.enable');
  const a = (await cdp.send('WebAuthn.addVirtualAuthenticator', { options: Object.assign({ hasPrf: true }, AUTH) })).authenticatorId;
  await enableOnLab(page);
  await modules(page);
  await page.evaluate(() => {
    const S = window.MentriaStore;
    const set = S.set.bind(S);
    window.__failPass = true;
    S.set = (ns, key, v, o) => (window.__failPass && ns === 'keyring' && v && v.wraps && v.wraps.pass && typeof v.wraps.pass.ct === 'string' ? false : set(ns, key, v, o));
  });
  await setupTo(page, "{ knownCode: '" + KNOWN + "', knownPassphrase: '" + KEPT + "' }", 'passkey');
  await page.evaluate(() => {
    const c = navigator.credentials;
    const create = c.create.bind(c);
    window.__creates = 0;
    c.create = (o) => {
      window.__creates += 1;
      const p = create(o);
      return new Promise((res, rej) => setTimeout(() => p.then(res, rej), 700));
    };
  });
  await page.click('.m-ulayer [data-act="add-passkey"]');
  const adding = await until(() => busyNow(page, EN.saving), 5000);
  const addingInfo = await busyInfo(page);
  await waitMsg(page, '.m-ulayer .m-usheet__msg', EN.err_storage);
  const mid = await page.evaluate(() => {
    const d = document.querySelector('.m-ulayer [role="dialog"]');
    const ghost = d.querySelector('[data-act="skip-passkey"]');
    return { step: d.querySelector('[data-step]').dataset.step, add: d.querySelector('[data-act="add-passkey"]').disabled, skip: ghost.disabled, label: ghost.textContent.trim(), ghost: ghost.classList.contains('m-unlock__btn--ghost'), passkeys: window.__m.state().passkeys, r: window.__r };
  });
  assert(mid.step === 'passkey' && mid.passkeys === 1 && mid.r === null, 'the passkey is added and the passphrase error stays on the step', mid);
  assert(mid.add === true && mid.skip === false, 'Add a passkey is off once a passkey was added; the ghost button stays', mid);
  assert(mid.label === EN.done && mid.ghost, 'the ghost button reads Done once a passkey was added', mid);
  const f = await focusInfo(page);
  assert(f.inside, 'focus stays on a control in the sheet', f);
  await page.evaluate(() => document.querySelector('.m-ulayer form[data-step="passkey"]').requestSubmit());
  await sleep(1200);
  const again = await page.evaluate(() => ({ creates: window.__creates, passkeys: window.__m.state().passkeys }));
  assert(again.creates === 1 && again.passkeys === 1, 'submitting the step again adds no second passkey', again);
  assert(adding, 'the saving line shows while the passkey is added', addingInfo);
  await page.evaluate(() => { window.__failPass = false; });
  await page.click('.m-ulayer [data-act="skip-passkey"]');
  const res = await settled(page, 20000);
  const st = await page.evaluate(() => window.__m.state());
  assert(res.ok && res.v === true && st.passkeys === 1 && st.hasPass, 'Skip for now then keeps the passphrase with the one passkey', { res, st });
  await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: a });
});

check('setup says no passkey was added after a timeout or no credential', async () => {
  await clean();
  const page = await open('/beta/unlock/');
  await enableOnLab(page);
  await modules(page);
  await setupTo(page, "{ knownCode: '" + KNOWN + "' }", 'passkey');
  for (const kind of ['webauthn-timeout', 'no-credential']) {
    await page.evaluate((k) => {
      const el = document.querySelector('.m-ulayer .m-usheet__msg');
      el.textContent = '';
      navigator.credentials.create = () => (k === 'no-credential' ? Promise.resolve(null) : Promise.reject(new Error(k)));
    }, kind);
    await page.click('.m-ulayer [data-act="add-passkey"]');
    await waitMsg(page, '.m-ulayer .m-usheet__msg', EN.passkey_skipped);
    const m = await page.evaluate(() => {
      const d = document.querySelector('.m-ulayer [role="dialog"]');
      const msg = d.querySelector('.m-usheet__msg');
      return { step: d.querySelector('[data-step]').dataset.step, warn: msg.classList.contains('is-warn'), error: msg.classList.contains('is-error'), add: !d.querySelector('[data-act="add-passkey"]').disabled, skip: !d.querySelector('[data-act="skip-passkey"]').disabled };
    });
    assert(m.step === 'passkey' && m.warn && !m.error && m.add && m.skip, kind + ' says no passkey was added and offers Add and Skip', m);
  }
  await page.click('.m-ulayer [data-act="skip-passkey"]');
  const res = await settled(page, 15000);
  assert(res.ok && res.v === true && await page.evaluate(() => window.__m.state().passkeys) === 0, 'skip finishes without a passkey', res);
});

check('inputs are read-only while busy', async () => {
  await clean();
  const page = await open('/beta/unlock/');
  await enableOnLab(page);
  await modules(page);
  const saved = 'WXYZ-2345-ABCD-EFGH-IJKL-MNOP-QRST-UV67';
  await start(page, '(ui) => ui.showSetup({ verifyCode: () => new Promise((r) => { window.__release = r; }) })');
  await waitStep(page, 'intro');
  await page.click('.m-ulayer [data-act="next"]');
  await waitStep(page, 'code');
  await page.type('.m-ulayer input[name="saved-code"]', saved);
  await page.click('.m-ulayer [data-act="next"]');
  assert(await until(() => busyNow(page, EN.working), 3000), 'busy while the saved code is checked', await busyInfo(page));
  const during = await busyInfo(page);
  assert(during.fields.length >= 3 && during.fields.every((f) => f.locked), 'the saved-code field is read-only and the choices are off while busy', during);
  await page.focus('.m-ulayer input[name="saved-code"]');
  await page.keyboard.type('ZZ');
  await page.evaluate(() => document.querySelector('.m-ulayer input[name="code-choice"][value="new"]').click());
  const kept = await page.evaluate(() => ({ v: document.querySelector('.m-ulayer input[name="saved-code"]').value, keep: document.querySelector('.m-ulayer input[name="code-choice"][value="keep"]').checked }));
  assert(kept.v === saved && kept.keep, 'typing and choosing change nothing while busy', kept);
  await page.evaluate(() => window.__release(false));
  await waitMsg(page, '.m-ulayer .m-usheet__msg', EN.err_code);
  const after = await busyInfo(page);
  assert(after.fields.length >= 3 && after.fields.every((f) => !f.locked) && !after.busy, 'fields work again after the check', after);

  await clean();
  const p2 = await open('/beta/unlock/', NO_PRF);
  await enableOnLab(p2);
  await modules(p2);
  await setupTo(p2, "{ knownCode: '" + KNOWN + "' }", 'no-prf');
  await p2.click('.m-ulayer input[name="set-pass"]');
  await p2.waitForFunction(() => { const el = document.querySelector('.m-ulayer input[name="new-pass"]'); return el && el.getBoundingClientRect().height > 0; });
  await p2.type('.m-ulayer input[name="new-pass"]', 'correct horse battery');
  await p2.click('.m-ulayer input[name="remember"]');
  await p2.evaluate(SLOW_ENCRYPT, 1500);
  await p2.click('.m-ulayer [data-act="done"]');
  const busy2 = await until(() => busyNow(p2, EN.saving), 5000);
  const d2 = await busyInfo(p2);
  await p2.evaluate(() => document.querySelector('.m-ulayer input[name="remember"]').click());
  const rememberOn = await p2.evaluate(() => document.querySelector('.m-ulayer input[name="remember"]').checked);
  await p2.evaluate(() => { window.__slow = false; });
  const res = await settled(p2, 20000);
  const st = await p2.evaluate(() => window.__m.state());
  assert(res.ok && res.v === true && st.hasPass, 'the no-PRF options are applied', { res, st });
  assert(busy2, 'busy with the saving line while the options are applied', d2);
  assert(d2.fields.length >= 3 && d2.fields.every((f) => f.locked), 'the passphrase field is read-only and the boxes are off while busy', d2);
  assert(rememberOn && st.hasDevice, 'Remember stays as chosen while busy', { rememberOn, st });

  const { page: p3, code } = await labWithKeyring();
  await p3.evaluate(() => window.__m.lock());
  await p3.click('#unlock-demo-card');
  await p3.waitForSelector('#unlock-demo .m-unlock');
  await openCode(p3, '#unlock-demo .m-unlock');
  await typeInto(p3, '#unlock-demo input[name="recovery-code"]', code);
  await p3.evaluate(() => {
    const dec = crypto.subtle.decrypt.bind(crypto.subtle);
    window.__slow = true;
    crypto.subtle.decrypt = async (...a) => {
      if (window.__slow) await new Promise((r) => setTimeout(r, 700));
      return dec(...a);
    };
  });
  await p3.keyboard.press('Enter');
  await p3.waitForFunction(() => document.querySelector('#unlock-demo .m-unlock').hasAttribute('aria-busy'), { timeout: 5000 });
  const card = await p3.evaluate(() => {
    const c = document.querySelector('#unlock-demo .m-unlock');
    return { msg: c.querySelector('.m-unlock__msg').textContent, code: c.querySelector('input[name="recovery-code"]').readOnly, pass: c.querySelector('input[name="passphrase"]').readOnly };
  });
  await p3.keyboard.type('ZZ');
  const typed = await p3.$eval('#unlock-demo input[name="recovery-code"]', (el) => el.value);
  await p3.evaluate(() => { window.__slow = false; });
  await p3.waitForFunction(() => window.__m.state().unlocked === true, { timeout: 15000 });
  assert(card.msg === EN.working && card.code && card.pass && typed === code, 'card fields are read-only while it unlocks', { card, typed });
});
const PASSKEY_EXISTS = () => {
  if (window.PublicKeyCredential) PublicKeyCredential.getClientCapabilities = async () => ({ 'extension:prf': true });
  const c = navigator.credentials;
  if (c) c.create = () => Promise.reject(new DOMException('The authenticator already holds a credential for this account', 'InvalidStateError'));
};

check('a passkey this device already holds gets its own message', async () => {
  await clean();
  const page = await open('/beta/unlock/', PASSKEY_EXISTS);
  await enableOnLab(page);
  await modules(page);
  await start(page, "(ui) => ui.showSetup({ knownCode: 'ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ23-4567' })");
  await waitStep(page, 'intro');
  await page.click('.m-ulayer [data-act="next"]');
  await waitStep(page, 'code');
  await page.click('.m-ulayer [data-act="next"]');
  await waitStep(page, 'passkey');
  await page.click('.m-ulayer [data-act="add-passkey"]');
  await waitMsg(page, '.m-ulayer .m-usheet__msg', EN.err_passkey_exists);
  assert(EN.err_passkey_exists === 'This device already has a passkey for Mentria.', 'the copy', EN.err_passkey_exists);
});

const GET_INVALID = () => {
  const c = navigator.credentials;
  if (c) c.get = () => Promise.reject(new DOMException('The request is not valid in this state', 'InvalidStateError'));
};

check('only adding a passkey calls InvalidStateError a passkey this device has', async () => {
  const { page, code } = await labWithKeyring(GET_INVALID);
  await page.evaluate(async (code) => {
    const C = await import('/assets/js/mentria-unlock-core.js');
    const rnd = (n) => crypto.getRandomValues(new Uint8Array(n));
    const rec = JSON.parse(localStorage.getItem('mentria.store.keyring.vault'));
    const bytes = await C.openWithCode(rec.wraps.recovery, code);
    rec.wraps.prf.push(await C.wrapWithPrf(bytes, rnd(32), { id: C.b64u(rnd(16)), salt: C.b64u(rnd(32)), label: 'x' }));
    window.MentriaStore.set('keyring', 'vault', rec);
    await window.__m.lock();
  }, code);
  await page.click('#unlock-demo-card');
  await page.waitForSelector('#unlock-demo [data-act="passkey"]');
  await page.click('#unlock-demo [data-act="passkey"]');
  await until(async () => (await text(page, '#unlock-demo .m-unlock__msg')) !== EN.working && (await text(page, '#unlock-demo .m-unlock__msg')) !== '', 15000);
  const signIn = await text(page, '#unlock-demo .m-unlock__msg');
  assert(signIn !== EN.err_passkey_exists, 'a sign-in InvalidStateError is not called a passkey this device has', signIn);
  await page.evaluate((c) => window.__m.unlockWithCode(c), code);
  await plantOther(page, true);
  await start(page, '(ui) => ui.showFoldIn()');
  await page.waitForSelector('.m-ulayer [data-act="fold-passkey"]');
  await page.click('.m-ulayer [data-act="fold-passkey"]');
  await until(async () => { const t = await text(page, '.m-ulayer .m-usheet__msg'); return t && t !== EN.working; }, 15000);
  const fold = await text(page, '.m-ulayer .m-usheet__msg');
  assert(fold !== EN.err_passkey_exists && fold === EN.err_other, 'a fold-in InvalidStateError is not called a passkey this device has', fold);
});

check('setup offers the card when another page locked before the link', async () => {
  await clean();
  const page = await open('/beta/unlock/');
  await enableOnLab(page);
  await modules(page);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    window.__lockOnce = true;
    IDBObjectStore.prototype.put = function (...a) {
      if (window.__lockOnce && this.name === 'session') {
        window.__lockOnce = false;
        const n = Number(localStorage.getItem('mentria.keyring.epoch') || 0) + 1;
        const l = JSON.parse(localStorage.getItem('mentria.keyring.local'));
        l.manualLock = n;
        localStorage.setItem('mentria.keyring.local', JSON.stringify(l));
        localStorage.setItem('mentria.keyring.epoch', String(n));
      }
      return put.apply(this, a);
    };
  });
  await start(page, "(ui) => ui.showSetup({ service: 'identity', secret: new Uint8Array(32).fill(9) })");
  await waitStep(page, 'intro');
  await page.click('.m-ulayer [data-act="next"]');
  await waitStep(page, 'code');
  const code = await shownCode(page);
  await page.type('.m-ulayer input[name="code-check"]', code.slice(-4));
  await page.click('.m-ulayer [data-act="next"]');
  const card = await page.waitForSelector('.m-ulayer:not([hidden]) .m-unlock', { timeout: 15000 }).then(() => true, () => false);
  const msgs = await page.evaluate(() => [...document.querySelectorAll('.m-usheet__msg')].map((m) => m.textContent));
  assert(await page.evaluate(() => window.__lockOnce === false), 'harness: the other page\'s lock landed during create');
  assert(card && !msgs.includes(EN.err_other), 'the link failure offers the unlock card, not a generic error', { card, msgs });
  await openCode(page, '.m-ulayer:not([hidden])');
  await page.type('.m-ulayer:not([hidden]) input[name="recovery-code"]', code);
  await page.keyboard.press('Enter');
  await until(async () => ['passkey', 'no-prf'].includes(await step(page)), 15000);
  if ((await step(page)) === 'passkey') await page.click('.m-ulayer [data-act="skip-passkey"]');
  else await page.click('.m-ulayer [data-act="done"]');
  const res = await settled(page, 15000);
  const linked = await page.evaluate(async () => { const s = await window.__m.secret('identity'); return !!s && s.every((b) => b === 9); });
  assert(res.ok && res.v === true && linked, 'after the card the setup links and finishes', { res, linked });
});

async function plantOther(page, fakePasskey) {
  return page.evaluate(async (fake) => {
    const m = window.__m;
    const C = await import('/assets/js/mentria-unlock-core.js');
    const rnd = () => crypto.getRandomValues(new Uint8Array(32));
    const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    const na = rnd();
    await m.link('notes', na);
    const recA = JSON.parse(localStorage.getItem('mentria.store.keyring.vault'));
    const codeB = C.newRecoveryCode();
    const made = await C.createRecord({ code: codeB, deviceId: 'dev-b' });
    if (fake) recA.wraps.prf.push(await C.wrapWithPrf(made.rootBytes, rnd(), { id: C.b64u(rnd().slice(0, 16)), salt: C.b64u(rnd()), label: 'x' }));
    localStorage.setItem('mentria.keyring.others', JSON.stringify([recA]));
    window.MentriaStore.set('keyring', 'vault', made.record);
    await m.unlockWithCode(codeB);
    return { codeB, kcvA: recA.kcv, na: hex(na) };
  }, !!fakePasskey);
}

check('fold-in sheet brings in another keyring', async () => {
  const { page, code } = await labWithKeyring();
  assert(await page.evaluate(() => typeof window.__ui.showFoldIn === 'function'), 'the card module exports showFoldIn');
  await start(page, '(ui) => ui.showFoldIn()');
  const none = await settled(page, 5000);
  assert(none.ok && none.v === false && !(await layerOpen(page)), 'nothing to bring in: no sheet, false', none);
  const f = await plantOther(page, false);
  await start(page, '(ui) => ui.showFoldIn()');
  await page.waitForSelector('.m-ulayer [data-step="fold-in"]');
  const c = await page.evaluate(() => {
    const d = document.querySelector('.m-ulayer [role="dialog"]');
    return {
      title: document.getElementById(d.getAttribute('aria-labelledby')).textContent.trim(),
      lede: document.getElementById(d.getAttribute('aria-describedby')).textContent.trim(),
      passkey: !!d.querySelector('[data-act="fold-passkey"]'),
      code: !!d.querySelector('input[name="fold-code"]'),
      notNow: !!d.querySelector('[data-act="not-now"]')
    };
  });
  assert(c.title === EN.foldin_title && c.lede === EN.foldin_lede && !c.passkey && c.code && c.notNow, 'the sheet asks for that keyring\'s code; no passkey button when it has none', c);
  const v = await axe(page, '.m-ulayer');
  assert(v.length === 0, 'fold-in sheet passes axe', v);
  assert(!(await targets(page, '.m-ulayer')).length, 'targets are at least 44 px', await targets(page, '.m-ulayer'));
  await page.click('.m-ulayer [data-act="not-now"]');
  const no = await settled(page, 5000);
  assert(no.ok && no.v === false && !(await layerOpen(page)) && (await page.evaluate(() => window.__m.others().length)) === 1, 'Not now closes and keeps the other keyring', no);
  await start(page, '(ui) => ui.showFoldIn()');
  await page.waitForSelector('.m-ulayer input[name="fold-code"]');
  await page.type('.m-ulayer input[name="fold-code"]', f.codeB);
  await page.keyboard.press('Enter');
  await waitMsg(page, '.m-ulayer .m-usheet__msg', EN.err_code);
  assert(await page.$eval('.m-ulayer input[name="fold-code"]', (el) => el.getAttribute('aria-invalid')) === 'true', 'a wrong code marks the field');
  await typeInto(page, '.m-ulayer input[name="fold-code"]', code.toLowerCase());
  await page.keyboard.press('Enter');
  const ok = await settled(page, 15000);
  assert(ok.ok && ok.v === true && !(await layerOpen(page)), 'the right code brings it in and closes', ok);
  const after = await page.evaluate(async () => {
    const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return { others: window.__m.others().length, notes: (await window.__m.secrets('notes')).map((x) => hex(x.bytes)), toast: (document.querySelector('.m-toast') || {}).textContent };
  });
  assert(after.others === 0 && after.notes.includes(f.na) && after.toast === EN.foldin_done, 'its secrets open here and the page says so', after);
  await page.evaluate(() => window.__m.lock());
  await start(page, '(ui) => ui.showFoldIn()');
  const locked = await settled(page, 5000);
  assert(locked.ok && locked.v === false && !(await layerOpen(page)), 'locked: no sheet', locked);
});

check('fold-in sheet offers the other keyring\'s passkey', async () => {
  const { page } = await labWithKeyring();
  await plantOther(page, true);
  await start(page, '(ui) => ui.showFoldIn()');
  await page.waitForSelector('.m-ulayer [data-step="fold-in"]');
  const c = await page.evaluate(() => {
    const d = document.querySelector('.m-ulayer [role="dialog"]');
    const b = d.querySelector('[data-act="fold-passkey"]');
    return { passkey: !!b, label: b ? b.textContent.trim() : '', code: !!d.querySelector('input[name="fold-code"]') };
  });
  assert(c.passkey && c.label === EN.foldin_passkey && c.code, 'a passkey button and the code field', c);
  await page.keyboard.press('Escape');
  const no = await settled(page, 5000);
  assert(no.ok && no.v === false && !(await layerOpen(page)), 'Escape closes', no);
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
    console.log('FAIL ' + name + ': ' + String(e && e.message || e).slice(0, 400));
  }
}
console.log((run.length - failed) + '/' + run.length + ' passed');
await browser.close();
server.close();
rmSync(PROFILE, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
