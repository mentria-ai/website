import http from 'node:http';
import { createReadStream, statSync, rmSync, mkdtempSync, existsSync } from 'node:fs';
import { join, extname, normalize, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const BUILD = process.argv[2];
const CC = process.env.MENTRIA_CC ? resolve(process.env.MENTRIA_CC) : '';
const GW = process.env.MENTRIA_GW ? resolve(process.env.MENTRIA_GW) : '';
if (!BUILD || !CC || !GW || !existsSync(GW)) { console.log('usage: MENTRIA_CC=<plugin repo> MENTRIA_GW=<gateway.js> node scripts/comms-cc-page-check.mjs <build dir>'); process.exit(2); }
const PORT = Number(process.env.CC_PAGE_PORT) || 8096;
const GW_PORT = Number(process.env.CC_GW_PORT) || 8097;
const ORIGIN = 'http://127.0.0.1:' + PORT;
const PROFILE = mkdtempSync(join(tmpdir(), 'comms-cc-page-'));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const lib = (f) => import(pathToFileURL(join(CC, 'plugins/mentria/lib', f)).href);
const P = await lib('pairing.js');
const PC = await lib('crypto.js');
const PW = await lib('wire.js');
const PSG = await lib('sign.js');
const { createGatewayClient } = await lib('gateway.js');
const { createGateway } = await import(pathToFileURL(GW).href);

const serve = (dir, port) => {
  const root = resolve(dir);
  const server = http.createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://local').pathname);
    let file = normalize(join(root, path));
    if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
    try { if (statSync(file).isDirectory()) file = join(file, 'index.html'); statSync(file); } catch (_) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    createReadStream(file).pipe(res);
  });
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok(server)));
};
const until = async (fn, ms, what) => { const end = Date.now() + ms; for (;;) { try { if (await fn()) return; } catch (_) {} if (Date.now() > end) throw new Error('timed out: ' + what); await new Promise((r) => setTimeout(r, 150)); } };
const visible = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); return !!el && !!el.getClientRects().length && !el.closest('[hidden]'); }, sel);
const text = (page, sel) => page.$eval(sel, (el) => el.textContent.trim());
const step = (page) => page.evaluate(() => { const el = document.querySelector('.m-ulayer [data-step]'); return el ? el.dataset.step : null; });
const press = async (page, sel, ms = 20000) => { await until(() => visible(page, sel), ms, sel); await page.click(sel); };
const onboard = async (page, name) => {
  await press(page, '#comms-onboard-start');
  await until(() => visible(page, '#comms-onboard-name'), 20000, 'name');
  await page.type('#comms-onboard-name', name);
  await page.click('#comms-onboard-create');
  await until(async () => (await step(page)) === 'intro', 20000, 'intro');
  await press(page, '.m-ulayer [data-act="next"]');
  await until(async () => (await step(page)) === 'code', 20000, 'code');
  const code = await page.$eval('.m-ulayer .m-ucode', (el) => el.textContent.replace(/\s+/g, ''));
  await page.type('.m-ulayer input[name="code-check"]', code.replace(/[^A-Z2-7]/g, '').slice(-4).toLowerCase());
  await until(() => page.$eval('.m-ulayer [data-act="next"]', (b) => !b.disabled), 5000, 'next');
  await page.click('.m-ulayer [data-act="next"]');
  await until(async () => ['passkey', 'no-prf'].includes(await step(page)), 30000, 'method');
  await page.click('.m-ulayer [data-act="skip-passkey"]');
  await until(() => page.evaluate(() => !document.querySelector('.m-ulayer')), 60000, 'sheet closed');
  await until(() => page.evaluate(() => !document.getElementById('comms-app').hidden && !document.getElementById('comms-id-on').hidden), 30000, 'identity on');
  return code;
};
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

const results = [];
const check = async (name, fn) => { try { await fn(); results.push([name, true]); console.log('PASS ' + name); } catch (e) { results.push([name, false]); console.log('FAIL ' + name + ': ' + (e && e.message)); } };

const server = await serve(BUILD, PORT);
const gw = createGateway({ relay: 'wss://relay.mentria.ai', port: GW_PORT, host: '127.0.0.1' });
await gw.listening;
const client = createGatewayClient({ base: 'http://127.0.0.1:' + GW_PORT + '/gw', fetch: async (url, init) => { const r = await fetch(url, init); return { status: r.status, ok: r.ok, text: await r.text() }; } });
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, userDataDir: PROFILE, args: ['--no-first-run', '--no-default-browser-check'] });
const comp = (() => { const s = PC.p256Keygen(); const d = PC.p256Keygen(); return { name: 'Mac', sign: { priv: s.priv, spub: s.pub }, dh: { priv: d.priv, pub: d.pub } }; })();
const shared = {};
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 393, height: 852, deviceScaleFactor: 2 });
  page.on('dialog', async (d) => { shared.nativeDialog = true; await d.dismiss(); });
  await page.goto(ORIGIN + '/comms/', { waitUntil: 'load' });
  shared.code = await onboard(page, 'Tester');

  await check('chat box: a multi-line box that grows with long text, Enter sends and Shift+Enter breaks the line', async () => {
    const base = await page.evaluate(() => {
      const m = document.getElementById('comms-msg');
      window.__shown = [];
      for (let el = m; el && el !== document.body; el = el.parentElement) {
        if (el.hidden) { el.hidden = false; window.__shown.push(['hidden', el]); }
        if (getComputedStyle(el).display === 'none') { window.__shown.push(['display', el, el.style.display]); el.style.display = 'block'; }
      }
      m.disabled = false;
      m.value = '';
      m.dispatchEvent(new Event('input'));
      return { tag: m.tagName, ac: m.getAttribute('autocomplete'), h: m.getBoundingClientRect().height };
    });
    if (base.tag !== 'TEXTAREA') throw new Error('tag ' + base.tag);
    if (base.ac !== 'off') throw new Error('autocomplete ' + base.ac);
    await page.focus('#comms-msg');
    await page.keyboard.type('word '.repeat(60));
    const grown = await page.evaluate(() => document.getElementById('comms-msg').getBoundingClientRect().height);
    if (!(grown > base.h * 2)) throw new Error('did not grow: ' + base.h + ' -> ' + grown);
    await page.keyboard.type('word '.repeat(400));
    const capped = await page.evaluate(() => { const m = document.getElementById('comms-msg'); return { h: m.getBoundingClientRect().height, scroll: m.scrollHeight > m.clientHeight }; });
    if (!(capped.h < 220) || !capped.scroll) throw new Error('not capped: ' + JSON.stringify(capped));
    await page.evaluate(() => { const m = document.getElementById('comms-msg'); m.value = 'one'; m.dispatchEvent(new Event('input')); });
    await page.keyboard.down('Shift');
    await page.keyboard.press('Enter');
    await page.keyboard.up('Shift');
    await page.keyboard.type('two');
    const v1 = await page.$eval('#comms-msg', (m) => m.value);
    if (v1 !== 'one\ntwo') throw new Error('shift-enter: ' + JSON.stringify(v1));
    await page.keyboard.press('Enter');
    const v2 = await page.$eval('#comms-msg', (m) => m.value);
    if (v2.includes('two\n')) throw new Error('enter added a line: ' + JSON.stringify(v2));
    await page.evaluate(() => { const m = document.getElementById('comms-msg'); m.value = ''; m.dispatchEvent(new Event('input')); m.disabled = true; for (const [k, el, v] of (window.__shown || []).reverse()) { if (k === 'hidden') el.hidden = true; else el.style.display = v; } });
  });

  await check('cc: #cc1 link is stripped from the address bar immediately', async () => {
    const ac = new AbortController();
    shared.ac = ac;
    shared.pairing = P.startPairing({ computer: comp, publish: client.publish, stream: (t, fn, o) => client.stream(t, fn, Object.assign({ wait: 5 }, o)), site: ORIGIN, offerEveryMs: 1500 });
    shared.pairing.onAccept((a) => { shared.accepted = a; });
    const link = shared.pairing.link;
    const nav = page.waitForNavigation({ waitUntil: 'load', timeout: 30000 });
    await page.click('#comms-id-lock');
    await nav;
    await until(() => visible(page, '#comms-id-card-slot .m-unlock'), 20000, 'locked card');
    await page.goto(link.replace('/comms/#', '/comms/?t=' + Date.now() + '#'), { waitUntil: 'domcontentloaded' });
    const where = await page.evaluate(() => ({ hash: location.hash, href: location.href, stored: JSON.stringify(Object.assign({}, localStorage)) + JSON.stringify(Object.assign({}, sessionStorage)) }));
    if (where.hash !== '' || where.href.includes('cc1')) throw new Error('hash kept: ' + where.href);
    const secret = link.split('#cc1.')[1];
    if (where.stored.includes(secret)) throw new Error('secret stored');
  });

  await check('cc: locked identity shows unlock first, then the same connect card', async () => {
    await until(() => visible(page, '#comms-lock-cc'), 15000, 'unlock note');
    const toggle = '#comms-id-card-slot [data-act="show-code"]';
    if (await visible(page, toggle)) await page.click(toggle);
    await until(() => visible(page, '#comms-id-card-slot input[name="recovery-code"]'), 15000, 'code input');
    await page.type('#comms-id-card-slot input[name="recovery-code"]', shared.code);
    await page.keyboard.press('Enter');
    await until(() => visible(page, '#comms-cc-approve'), 40000, 'connect card');
    const title = await page.evaluate(() => document.getElementById('comms-cc-text').textContent);
    if (!title.includes('Mac')) throw new Error('card text: ' + title);
    if (await visible(page, '#comms-cc-code')) throw new Error('code shown before Approve');
    if (!(await noOverflow(page))) throw new Error('connect card overflows at 393 px');
    await page.click('#comms-cc-approve');
    await until(() => visible(page, '#comms-cc-code'), 30000, 'code after the reveal');
    const card = { code: await page.$eval('#comms-cc-code', (el) => el.textContent) };
    await page.screenshot({ path: join(tmpdir(), 'cc-connect-card.png') });
    await until(() => !!shared.accepted, 30000, 'computer saw the accept');
    if (shared.accepted.code !== card.code) throw new Error('codes differ: ' + shared.accepted.code + ' vs ' + card.code);
    shared.res = await shared.pairing.allow();
    await until(async () => (await text(page, '#comms-cc-text')).includes('connected'), 30000, 'connected');
  });

  await check('cc: Agents list appears with a computer record and without ?agents=1', async () => {
    const keys = PW.keysFromChannelKey(shared.res.K);
    shared.keys = keys;
    const here = () => { const cmid = 'h:' + Date.now(); return PSG.signBody(comp.sign.priv, comp.sign.spub, 'cc:' + shared.res.cid, cmid, { t: 'here', cmid, sessions: [{ sid: 'sess-1', name: 'demo-session', busy: false, lastTs: Date.now() }], host: 'Mac' }); };
    shared.heard = [];
    client.stream(keys.topic, (c) => { const f = PW.open(keys.aesKey, c); if (f) shared.heard.push(f); }, { signal: shared.ac.signal, wait: 5 }).catch(() => {});
    await page.click('#comms-cc-later');
    for (let i = 0; i < 8 && !(await page.evaluate(() => !!document.querySelector('.comms__agentrow'))); i++) {
      for (const f of PW.splitFrames(here())) await client.publish(keys.topic, PW.seal(keys.aesKey, f));
      await new Promise((r) => setTimeout(r, 1500));
    }
    await until(() => page.evaluate(() => [...document.querySelectorAll('.comms__agentrow')].some((r) => r.textContent.includes('demo-session'))), 15000, 'agent row');
    if ((await page.evaluate(() => location.search)).includes('agents')) throw new Error('agents flag in URL');
    const stored = await page.evaluate(() => localStorage.getItem('mentria.comms.agents_on'));
    if (stored) throw new Error('old agents flag set');
  });

  await check('cc: Disconnect sends a signed revoke and hides the computer', async () => {
    await page.click('#comms-adv-toggle');
    await until(() => visible(page, '#comms-computers'), 10000, 'computers section');
    const row = await text(page, '#comms-computers-list');
    if (!row.includes('Mac') || !row.includes('online')) throw new Error('row: ' + row);
    if (!(await noOverflow(page))) throw new Error('computers list overflows at 393 px');
    await page.screenshot({ path: join(tmpdir(), 'cc-computers.png') });
    await page.click('#comms-computers-list button');
    await until(() => visible(page, '#m-dialog-ok'), 5000, 'confirm');
    await page.click('#m-dialog-ok');
    await until(() => page.evaluate(() => document.getElementById('comms-computers').hidden), 10000, 'computers hidden');
    const r = new PW.Reassembler();
    await until(() => shared.heard.some((f) => { const m = r.push(f); if (m && m.t === 'cc-revoke') shared.revoke = m; return !!shared.revoke; }), 20000, 'revoke on the channel');
    const v = PSG.verifyBody(shared.revoke, 'cc:' + shared.res.cid, shared.revoke.cmid);
    if (!v.ok || v.sigFp !== shared.res.device.sigFp) throw new Error('revoke not signed by the approving device');
    if (await page.evaluate(() => !!document.querySelector('.comms__agentrow'))) throw new Error('agent row still shown');
  });
  if (shared.nativeDialog) { results.push(['no native dialogs', false]); console.log('FAIL no native dialogs'); }
} finally {
  if (shared.ac) shared.ac.abort();
  if (shared.pairing) shared.pairing.cancel();
  await browser.close();
  await gw.close();
  server.close();
  rmSync(PROFILE, { recursive: true, force: true });
}
const failed = results.filter((r) => !r[1]).length;
console.log('comms cc page: ' + (results.length - failed) + '/' + results.length + ' passed');
process.exit(failed ? 1 : 0);
