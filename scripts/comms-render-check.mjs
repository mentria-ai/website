import http from 'node:http';
import { createReadStream, statSync, rmSync, mkdtempSync } from 'node:fs';
import { join, extname, normalize, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import puppeteer from 'puppeteer-core';

const BUILD = process.argv[2];
if (!BUILD) { console.log('usage: node scripts/comms-render-check.mjs <build dir>'); process.exit(2); }
const PORT = Number(process.env.RENDER_PORT) || 8092;
const ORIGIN = 'http://127.0.0.1:' + PORT;
const PROFILE = mkdtempSync(join(tmpdir(), 'comms-render-check-'));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.txt': 'text/plain' };
const PAGE = '<!doctype html><html><head><meta charset="utf-8"><title>render check</title><script src="/assets/js/markdown.js"></script></head><body></body></html>';

function serve(dir, port) {
  const root = resolve(dir);
  const server = http.createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://local').pathname);
    if (path === '/__render-check.html') {
      res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-cache' });
      res.end(PAGE);
      return;
    }
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

const PAGE_TESTS = async () => {
  const tests = [];
  const test = (name, fn) => tests.push([name, fn]);
  const fail = (msg) => { throw new Error(msg); };
  const ok = (v, m) => { if (!v) fail(m || 'expected a true value'); };
  const eq = (a, b) => { if (a !== b) fail('expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a)); };
  await window.renderMarkdownReady;
  const C = await import('/assets/js/comms/cards.js');
  const T = { load_image: 'Load image from {host}' };
  let el = null;

  test('a bare link opens in a new tab', () => { C.renderBody(el, 'https://example.com', { from: 'person', T }); const a = el.querySelector('a'); eq(a.href, 'https://example.com/'); eq(a.target, '_blank'); ok(a.rel.includes('noopener') && a.rel.includes('noreferrer')); });
  test('script links lose their link', () => { C.renderBody(el, '[x](javascript:alert(1))', { from: 'person', T }); eq(el.querySelector('a'), null); ok(el.textContent.includes('x')); });
  test('outside images from people wait for a tap', () => { C.renderBody(el, '![p](https://t.example/p.gif)', { from: 'person', T }); eq(el.querySelector('img'), null); const b = el.querySelector('button.comms__imgload'); ok(b.textContent.includes('t.example')); b.click(); eq(el.querySelector('img').getAttribute('src'), 'https://t.example/p.gif'); });
  test('images from AI render', () => { C.renderBody(el, '![p](https://t.example/p.gif)', { from: 'model', T }); ok(el.querySelector('img')); });
  test('html never runs', () => { C.renderBody(el, '<img src=x onerror=alert(1)><script>window.__x=1</script>', { from: 'person', T }); eq(el.querySelector('[onerror]'), null); eq(el.querySelector('script'), null); eq(window.__x, undefined); });
  test('code is not linked', () => { C.renderBody(el, '`https://x.y`', { from: 'person', T }); eq(el.querySelector('code a'), null); });
  test('www links open over https', () => { C.renderBody(el, 'see www.example.com today', { from: 'person', T }); eq(el.querySelector('a').getAttribute('href'), 'https://www.example.com'); });

  const R = (i) => btoa(String.fromCharCode(...new Uint8Array(16).fill(i))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const MH = btoa(String.fromCharCode(...new Uint8Array(32).fill(2))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const REF0 = R(10);
  const album = (n) => ({ type: 'album', aid: 'a1', n, items: Array.from({ length: n }, (_, i) => ({ type: 'image', ref: R(10 + i), mh: MH, size: 1000, mime: 'image/jpeg', w: 320, h: 240, thumb: 'QUJD' })) });
  const pdf = () => ({ type: 'file', ref: R(50), mh: MH, size: 120000, mime: 'application/pdf', name: 'doc.pdf' });
  const TT = { load_image: T.load_image, files: { status_send: 'sending {i} of {n} · {rate} · {path}', status_recv: 'receiving {i} of {n} · {rate} · {path}', direct: 'direct', via_relay: 'via relay', saved_here: 'saved on this device', open_pdf: 'Open in PDF tool', save: 'Save', retry: 'Retry', paused: 'Paused at {size}. It carries on by itself when Comms is open on both.', no_space: 'Not enough space on this device', import: 'import' } };
  const opts = (over = {}) => ({ t: over.t || '', me: false, T: TT, media: () => ({ state: over.state || 'offered', have: 0, total: 1 }), onAccept() {}, onRetry() {}, onOpen() {}, onOpenPdf() {} });
  test('album: layouts', () => { eq([1, 2, 3, 4, 7].map((n) => C.albumLayout(n)).join(), 'one,two,three,grid,grid'); });
  test('album: +N on the fourth tile', () => { C.renderParts(el, [album(7)], opts()); eq(el.querySelectorAll('.comms__album img').length, 4); eq(el.querySelector('.comms__album-more').textContent, '+3'); });
  test('album: blurred until done', () => { C.renderParts(el, [album(2)], opts({ state: 'moving' })); eq(el.querySelectorAll('img.is-blurred').length, 2); C.updateParts(el, REF0, { state: 'done', have: 1, total: 1 }); ok(el.querySelector('img[src="/comms-media/' + REF0 + '"]')); });
  test('no accept bar before the file is known here', () => { C.renderParts(el, [pdf()], { ...opts(), media: () => ({ state: 'unknown' }) }); ok(el.querySelector('.comms__acceptbar').hidden); });
  test('file card: pdf gets open and save', () => { C.renderParts(el, [pdf()], opts({ state: 'done' })); ok(el.querySelector('a[download][href$="?dl=1"]')); ok(el.querySelector('[data-act="open-pdf"]')); });
  test('unknown part falls back to t', () => { C.renderParts(el, [{ type: 'unknown' }], opts({ t: 'Sent a hologram' })); eq(el.textContent.trim(), 'Sent a hologram'); });
  const loadScript = (src) => new Promise((res, rej) => { if (document.querySelector('script[src="' + src + '"]')) { res(); return; } const el2 = document.createElement('script'); el2.src = src; el2.onload = res; el2.onerror = () => rej(new Error('load ' + src)); document.head.append(el2); });
  await loadScript('/assets/js/mentria-meta-strip.js');
  await loadScript('/assets/js/mentria-image.js');
  const SH = await import('/assets/js/comms/sheet.js').catch((e) => ({ openSheet: () => { throw e; } }));
  const TS = { sheet: { title: 'Send', add: 'Add', caption: 'Add a caption', standard: 'Standard', hd: 'HD', send: 'Send', cancel: 'Cancel', est_down: '{n} photos · {size}, downscaled', est_orig: '{size}, originals', est_mixed: '{n} items · {size}, photos downscaled', keeps_location: 'This file keeps its location data', too_big: 'Too big to send: 2 GB at most', remove: 'Remove' } };
  const photos = async (n, w = 1200, h = 900) => { const out = []; const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); for (let k = 0; k < n; k++) { g.fillStyle = 'hsl(' + (k * 37 % 360) + ',60%,50%)'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.fillRect(k * 10 % w, 10, 50, 50); const b = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9)); out.push(new File([b], 'p' + k + '.jpg', { type: 'image/jpeg' })); } return out; };
  const spyBitmaps = () => { const real = window.createImageBitmap; const log = []; log.maxConcurrent = 0; let live = 0; window.createImageBitmap = async (src, opts) => { live += 1; log.maxConcurrent = Math.max(log.maxConcurrent, live); log.push({ resized: !!(opts && (opts.resizeWidth || opts.resizeHeight)) }); try { return await real(src, opts); } finally { live -= 1; } }; log.restore = () => { window.createImageBitmap = real; }; return log; };
  const openWith = async (files, o = {}) => { const h = SH.openSheet({ files, self: !!o.self, T: TS, onSend() {} }); await h.ready; return h; };
  const bigFake = (size) => ({ name: 'huge.bin', size, type: 'application/octet-stream', lastModified: 0, slice: () => new Blob([]) });
  test('sheet: album of 30 decodes small, one at a time', async () => { const files = await photos(30, 4032, 3024); const log = spyBitmaps(); let h = null; try { h = await openWith(files); } finally { log.restore(); } ok(log.length >= 30, 'decoded ' + log.length); ok(log.every((c) => c.resized), 'a full-size decode happened'); eq(log.maxConcurrent, 1); h.close(); });
  test('sheet: no HD switch for my devices', async () => { const h = await openWith(await photos(2), { self: true }); ok(document.querySelector('#comms-sheet .m-seg').hidden); h.close(); });
  test('sheet: over 2 GB is left out', async () => { const h = await openWith([bigFake(2147483649)]); ok(document.querySelector('#comms-sheet [data-act="send"]').disabled); h.close(); });
  test('a caption is plain text, never HTML', () => { C.renderParts(el, [{ type: 'text', text: '<img src=x onerror=alert(1)>' }, album(1)], opts()); eq(el.querySelectorAll('img[onerror]').length, 0); });

  const out = [];
  for (const [name, fn] of tests) {
    el = document.createElement('div');
    document.body.append(el);
    try { await fn(); out.push({ name, ok: true }); } catch (e) { out.push({ name, ok: false, err: String(e && e.message || e) }); }
    el.remove();
  }
  return out;
};

const server = await serve(BUILD, PORT);
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, userDataDir: PROFILE, args: ['--no-first-run', '--no-default-browser-check'] });
let results = [];
try {
  const page = await browser.newPage();
  await page.goto(ORIGIN + '/__render-check.html');
  results = await page.evaluate(PAGE_TESTS).catch((e) => [{ name: 'load the renderer', ok: false, err: String(e && e.message || e).split('\n')[0] }]);
} finally {
  await browser.close();
  server.close();
  rmSync(PROFILE, { recursive: true, force: true });
}
let failed = 0;
for (const r of results) {
  if (r.ok) console.log('PASS ' + r.name);
  else { failed++; console.log('FAIL ' + r.name + ': ' + r.err); }
}
console.log('comms render: ' + (results.length - failed) + '/' + results.length + ' passed');
process.exit(failed || !results.length ? 1 : 0);
