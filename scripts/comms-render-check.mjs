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
  const deepEq = (a, b) => eq(JSON.stringify(a), JSON.stringify(b));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
  test('my own album is sharp at once, with no ring', () => { C.renderParts(el, [album(2)], { ...opts(), me: true, media: () => ({ state: 'queued', local: true, have: 1, total: 1 }) }); eq(el.querySelectorAll('img.is-blurred').length, 0); eq(el.querySelectorAll('img[src^="/comms-media/"]').length, 2); ok([...el.querySelectorAll('svg')].every((r) => r.hidden)); });
  test('the progress ring keeps its own look inside the Comms page styles', async () => { const html = await (await fetch('/comms/')).text(); const css = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n'); const st = document.createElement('style'); st.textContent = css; document.head.append(st); try { const wrap = document.createElement('div'); wrap.className = 'comms__app comms__app--people'; el.append(wrap); C.renderParts(wrap, [album(2)], opts({ state: 'moving' })); C.updateParts(wrap, R(10), { state: 'moving', have: 1, total: 4 }); const ring = wrap.querySelector('.comms__tile svg'); const cs = getComputedStyle(ring); eq(cs.display === 'none', false); eq(cs.borderTopWidth, '0px'); eq(Math.round(ring.getBoundingClientRect().width), 36); } finally { st.remove(); } });
  test('fix I8: a space pause offers Retry', () => { C.renderParts(el, [pdf()], { ...opts(), media: () => ({ state: 'paused', note: 'space', have: 1, total: 4 }) }); ok(!el.querySelector('.comms__parts-retry').hidden); });
  test('fix M2: my own freed file offers Download again', () => { C.renderParts(el, [pdf()], { ...opts(), me: true, media: () => ({ state: 'removed' }) }); ok(!el.querySelector('.comms__acceptbar').hidden); });
  test('fix M12: an album only grows from the same sender', () => { C.renderParts(el, [album(2)], { ...opts(), sender: 'fpA' }); const more = { type: 'album', aid: 'a1', n: 4, items: [3, 4].map((i) => ({ type: 'image', ref: R(30 + i), mh: MH, size: 10, mime: 'image/jpeg', thumb: 'QUJD' })) }; eq(C.addToAlbum(el, more, 'fpB'), false); eq(el.querySelectorAll('.comms__tile').length, 2); eq(C.addToAlbum(el, more, 'fpA'), true); eq(el.querySelectorAll('.comms__tile').length, 4); });
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
  const V = await import('/assets/js/comms/viewer.js').catch((e) => ({ openViewer: () => { throw e; }, renderMediaGrid: () => { throw e; } }));
  const TV = { viewer: { save: 'Save', share: 'Share', share_now: 'Share now', close: 'Close', prev: 'Previous', next: 'Next' }, files: { on_device: '{size} on this device', free_up: 'Free up space', removed: 'Removed from this device' } };
  const vitems = (n) => Array.from({ length: n }, (_, i) => ({ ref: R(60 + i), kind: 'image', name: 'p' + i + '.jpg', mime: 'image/jpeg', w: 320, h: 240 }));
  const key = (k) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  const current = () => Number((document.querySelector('#comms-viewer') || {}).dataset ? document.querySelector('#comms-viewer').dataset.index : -1);
  const recs = (n) => Array.from({ length: n }, (_, i) => ({ id: R(80 + i), threadId: 'dm-1', role: 'in', state: 'done', complete: true, size: 4e8, mime: 'image/jpeg', name: 'r' + i + '.jpg', kind: 'image', updatedAt: i }));
  test('viewer: arrows move and Esc closes', async () => { V.openViewer({ items: vitems(3), start: 0, T: TV }); key('ArrowRight'); eq(current(), 1); key('Escape'); ok(!document.querySelector('#comms-viewer[open]')); });
  test('viewer: save links to the download route', () => { const h = V.openViewer({ items: vitems(1), start: 0, T: TV }); ok(document.querySelector('#comms-viewer a[download][href$="?dl=1"]')); h.close(); });
  test('fix I10: reopening the viewer shares the photo now on screen', async () => { const calls = []; const share = (it) => { calls.push(it.ref); return null; }; let h = V.openViewer({ items: vitems(2), start: 1, T: TV, onShare: share }); h.close(); const second = [{ ref: R(90), kind: 'image', name: 'n.jpg', mime: 'image/jpeg' }]; h = V.openViewer({ items: second, start: 0, T: TV, onShare: share }); document.querySelector('#comms-viewer [data-act="share"]').click(); await sleep(50); h.close(); deepEq(calls, [R(90)]); });
  test('fix I12: the viewer strip and the grid use small previews', () => { const items = vitems(3).map((x) => ({ ...x, thumb: 'QUJD' })); const h = V.openViewer({ items, start: 0, T: TV }); ok([...document.querySelectorAll('#comms-viewer .comms__viewer-thumb img')].every((i) => i.getAttribute('src').startsWith('data:image/jpeg;base64,'))); h.close(); V.renderMediaGrid(el, { media: recs(2).map((r) => ({ ...r, thumb: 'QUJD' })), usage: 1, T: TV }); ok([...el.querySelectorAll('.comms__media-cell img')].every((i) => i.getAttribute('src').startsWith('data:image/jpeg;base64,'))); });
  test('fix C2a: an undecodable HEIC still has its location found', async () => { const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]; const be16 = (n) => [(n >> 8) & 255, n & 255]; const tag = (t) => Array.from(t, (c) => c.charCodeAt(0)); const box = (t, ...p) => { const body = [].concat(...p); return be32(body.length + 8).concat(tag(t), body); }; const full = (t, v, ...p) => box(t, [v, 0, 0, 0], ...p); const ex = tag('Exif\0\0GPS-SECRET'); const infe = full('infe', 2, be16(1), be16(0), tag('Exif'), [0]); const iinf = full('iinf', 0, be16(1), infe); const ftyp = box('ftyp', tag('heic'), [0, 0, 0, 0], tag('heic')); const body = (off) => box('hdlr', new Array(24).fill(0)).concat(iinf, full('iloc', 0, [0x44, 0x40], be16(1), be16(1), be16(0), be32(0), be16(1), be32(off), be32(ex.length))); const metaLen = 12 + body(0).length; const off = ftyp.length + metaLen + 8; const bytes = new Uint8Array(ftyp.concat(full('meta', 0, body(off)), box('mdat', ex))); let sent = null; const h = SH.openSheet({ files: [new File([bytes], 'p.heic', { type: 'image/heic' })], self: false, T: TS, onSend: (r) => { sent = r; } }); await h.ready; document.querySelector('#comms-sheet [data-act="send"]').click(); ok(sent && sent.items[0].ranges && sent.items[0].ranges.length === 1, JSON.stringify(sent && sent.items[0])); });
  test('grid: usage line and free up space', () => { V.renderMediaGrid(el, { media: recs(4), usage: 1.6e9, T: TV, onOpen() {}, onFree() {} }); eq(el.querySelector('.comms__media-usage').textContent, '1.6 GB on this device'); ok(el.querySelector('[data-act="free"]')); });
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
