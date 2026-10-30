import http from 'node:http';
import { createReadStream, statSync, rmSync } from 'node:fs';
import { join, extname, normalize, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import puppeteer from 'puppeteer-core';

const BUILD = process.argv[2];
if (!BUILD) { console.log('usage: node scripts/pdf-check.mjs <build dir>'); process.exit(2); }
const PORT = Number(process.env.PDF_PORT) || 8096;
const ORIGIN = 'http://localhost:' + PORT;
const PROFILE = join(tmpdir(), 'pdf-check-profile-' + PORT);
const SHOTS = process.env.PDF_SHOTS || '';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.bcmap': 'application/octet-stream', '.png': 'image/png', '.webp': 'image/webp' };

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

const PDFLIB = resolve(BUILD, 'assets/vendor/pdf-lib-1.17.1/pdf-lib.esm.min.js');
async function makeFiles(specs) {
  const { PDFDocument, StandardFonts } = await import(PDFLIB);
  const out = [];
  for (const spec of specs) {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (let i = 1; i <= spec.pages; i++) {
      const page = doc.addPage([595, 842]);
      page.drawText(spec.label + ' page ' + i, { x: 72, y: 760, size: 28, font });
      page.drawText('The quick brown fox jumps over the lazy dog.', { x: 72, y: 700, size: 14, font });
    }
    out.push({ name: spec.name, b64: Buffer.from(await doc.save()).toString('base64') });
  }
  return out;
}

rmSync(PROFILE, { recursive: true, force: true });
const server = await serve(BUILD, PORT);
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, userDataDir: PROFILE, args: ['--no-first-run', '--no-default-browser-check'] });
const checks = [];
const check = (name, fn) => checks.push([name, fn]);
const assert = (cond, msg, extra) => { if (!cond) throw new Error(msg + (extra === undefined ? '' : ' ' + JSON.stringify(extra))); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if (await fn()) return true; } catch (_) {}
    await sleep(120);
  }
  return !!(await fn());
}

async function openTool(viewport) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e && e.message || e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.setViewport(viewport || { width: 1280, height: 900 });
  await page.goto(ORIGIN + '/tools/pdf/', { waitUntil: 'load' });
  await page.evaluate(() => {
    window.__downloads = [];
    const wait = () => {
      if (!window.MentriaUI) return setTimeout(wait, 50);
      window.MentriaUI.downloadFile = (name, blob) => { window.__downloads.push({ name, size: blob.size, blob }); };
    };
    wait();
  });
  page.__errors = errors;
  return page;
}

async function feed(page, inputId, specs) {
  const made = await makeFiles(specs);
  await page.evaluate(async (id, list) => {
    const dt = new DataTransfer();
    for (const f of list) dt.items.add(new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name, { type: 'application/pdf' }));
    const input = document.getElementById(id);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, inputId, made);
}

async function opened(page, pages) {
  return until(() => page.evaluate((n) => {
    const S = window.__mentriaPdf && window.__mentriaPdf.st;
    return !!(S && S.doc && S.doc.numPages === n && document.querySelectorAll('#pdf-viewer .page canvas').length > 0 && !document.getElementById('pdf-app').hidden);
  }, pages), 20000);
}

check('opens a PDF, renders it and shows its text', async () => {
  const page = await openTool();
  assert(await page.evaluate(() => !document.getElementById('pdf-start').hidden && document.getElementById('pdf-app').hidden), 'start screen first');
  const libsBefore = await page.evaluate(() => performance.getEntriesByType('resource').filter((r) => /pdfjs-|pdf-lib-/.test(r.name)).length);
  assert(libsBefore === 0, 'no PDF code loads before a PDF is opened', libsBefore);
  await feed(page, 'pdf-file', [{ name: 'alpha.pdf', label: 'Alpha', pages: 3 }]);
  assert(await opened(page, 3), 'the PDF opens with 3 pages');
  const ok = await until(() => page.evaluate(() => /Alpha page 1/.test((document.querySelector('#pdf-viewer .page .textLayer') || {}).textContent || '')), 15000);
  assert(ok, 'the text layer of page 1 has the PDF text');
  const meta = await page.evaluate(() => ({ name: document.getElementById('pdf-name').textContent, meta: document.getElementById('pdf-meta').textContent, page: document.getElementById('pdf-page').textContent, zoom: document.getElementById('pdf-zoom').textContent }));
  assert(meta.name === 'alpha.pdf' && /3 pages/.test(meta.meta) && meta.page === '1 / 3' && /%$/.test(meta.zoom), 'name, page count, page and zoom shown', meta);
  const libLoad = await page.evaluate(() => performance.getEntriesByType('resource').filter((r) => /pdfjs-|pdf-lib-/.test(r.name)).map((r) => r.name.split('/').pop()));
  assert(!libLoad.some((n) => /pdf-lib/.test(n)), 'page tools library not loaded just for reading', libLoad);
  assert(!page.__errors.length, 'no page errors', page.__errors);
  await page.close();
});

check('read mode: next page, zoom, fit, dark reading, thumbnails and search', async () => {
  const page = await openTool();
  await feed(page, 'pdf-file', [{ name: 'alpha.pdf', label: 'Alpha', pages: 3 }]);
  assert(await opened(page, 3), 'opened');
  await page.click('#pdf-next');
  assert(await until(() => page.evaluate(() => document.getElementById('pdf-page').textContent === '2 / 3'), 5000), 'next page moves to 2 / 3');
  const z0 = await page.evaluate(() => parseInt(document.getElementById('pdf-zoom').textContent, 10));
  await page.click('#pdf-zoom-in');
  assert(await until(() => page.evaluate((z) => parseInt(document.getElementById('pdf-zoom').textContent, 10) > z, z0), 5000), 'zoom in grows the scale');
  await page.click('#pdf-fit');
  assert(await until(() => page.evaluate(() => window.__mentriaPdf.st.viewer.currentScaleValue === 'page-width'), 5000), 'fit to width sets the width scale');
  await page.click('#pdf-dark');
  assert(await page.evaluate(() => document.getElementById('pdf-stage').classList.contains('is-dark')), 'dark reading toggles');
  await page.click('#pdf-dark');
  const thumbs = await until(() => page.evaluate(() => document.querySelectorAll('#pdf-thumbs canvas.is-drawn').length >= 2), 10000);
  assert(thumbs, 'thumbnails are drawn in the rail');
  await page.click('#pdf-thumbs [data-page="3"]');
  assert(await until(() => page.evaluate(() => document.getElementById('pdf-page').textContent === '3 / 3'), 5000), 'a thumbnail jumps to its page');
  await page.click('#pdf-search');
  await page.type('#pdf-find', 'page');
  assert(await until(() => page.evaluate(() => /of 3$/.test(document.getElementById('pdf-find-count').textContent)), 10000), 'search finds a match on every page', await page.evaluate(() => document.getElementById('pdf-find-count').textContent));
  await page.click('#pdf-find-next');
  assert(await until(() => page.evaluate(() => document.querySelectorAll('#pdf-viewer .highlight').length > 0), 5000), 'matches are highlighted');
  await page.evaluate(() => { document.getElementById('pdf-find').value = 'zebra'; document.getElementById('pdf-find').dispatchEvent(new Event('input')); });
  assert(await until(() => page.evaluate(() => document.getElementById('pdf-find-count').textContent === 'No matches'), 5000), 'no matches says so');
  assert(!page.__errors.length, 'no page errors', page.__errors);
  await page.close();
});

check('edit mode: text, drawing, image and a signature are saved into the PDF', async () => {
  const page = await openTool();
  await feed(page, 'pdf-file', [{ name: 'alpha.pdf', label: 'Alpha', pages: 2 }]);
  assert(await opened(page, 2), 'opened');
  await page.click('#pdf-modes [data-mode="edit"]');
  assert(await page.evaluate(() => !document.getElementById('pdf-editbar').hidden && document.getElementById('pdf-readbar').hidden), 'edit bar replaces the read bar');
  await page.click('[data-tool="text"]');
  await sleep(300);
  const box = await page.evaluate(() => { const r = document.querySelector('#pdf-viewer .page').getBoundingClientRect(); return { x: r.left + r.width * 0.3, y: r.top + r.height * 0.3 }; });
  await page.mouse.click(box.x, box.y);
  await sleep(400);
  await page.keyboard.type('Hello note');
  await page.click('[data-tool="draw"]');
  await sleep(400);
  await page.mouse.move(box.x, box.y + 120);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(box.x + i * 15, box.y + 120 + Math.sin(i) * 20);
  await page.mouse.up();
  await sleep(300);
  await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 120; c.height = 60;
    const x = c.getContext('2d');
    x.fillStyle = '#1d4ed8'; x.fillRect(0, 0, 120, 60);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'stamp.png', { type: 'image/png' }));
    const input = document.getElementById('pdf-image');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  assert(await until(() => page.evaluate(() => document.querySelectorAll('#pdf-viewer .stampEditor').length >= 1), 10000), 'the image is placed as a stamp');
  await page.click('[data-tool="sign"]');
  assert(await until(() => page.evaluate(() => !document.getElementById('pdf-sig').hidden), 3000), 'the signature sheet opens');
  const pad = await page.evaluate(() => { const r = document.getElementById('pdf-sig-pad').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  await page.mouse.move(pad.x + 20, pad.y + pad.h / 2);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) await page.mouse.move(pad.x + 20 + i * (pad.w - 40) / 20, pad.y + pad.h / 2 + Math.sin(i / 2) * 25);
  await page.mouse.up();
  await page.click('#pdf-sig-keep');
  await page.click('#pdf-sig-use');
  assert(await until(() => page.evaluate(() => document.querySelectorAll('#pdf-viewer .stampEditor').length >= 2 && document.getElementById('pdf-sig').hidden), 10000), 'the signature is placed and the sheet closes');
  assert(await page.evaluate(() => !!window.MentriaStore.get('tools', 'pdf_signature')), 'remember keeps the signature on this device');
  await page.click('[data-tool="sign"]');
  await sleep(300);
  await page.click('#pdf-sig-cancel');
  assert(await page.evaluate(() => document.getElementById('pdf-name').classList.contains('is-dirty') && /Edited/.test(document.getElementById('pdf-meta').textContent)), 'the file shows unsaved edits');
  await page.click('#pdf-save');
  assert(await until(() => page.evaluate(() => window.__downloads.length === 1), 15000), 'Save downloads a file');
  const res = await page.evaluate(async () => {
    const d = window.__downloads[0];
    const bytes = new Uint8Array(await d.blob.arrayBuffer());
    const core = globalThis.pdfjsLib;
    const doc = await core.getDocument({ data: bytes }).promise;
    const p = await doc.getPage(1);
    const anns = await p.getAnnotations();
    return { name: d.name, types: anns.map((a) => a.subtype).sort(), text: anns.filter((a) => a.subtype === 'FreeText').map((a) => (a.contentsObj && a.contentsObj.str) || a.contents || '') };
  });
  assert(res.name === 'alpha-edited.pdf', 'the saved copy gets a new name', res.name);
  assert(res.types.includes('FreeText') && res.types.includes('Ink') && res.types.filter((t) => t === 'Stamp').length >= 2, 'text, drawing, image and signature are in the saved PDF', res);
  assert(res.text.some((t) => /Hello note/.test(t)), 'the typed text is kept', res.text);
  await page.click('#pdf-undo').catch(() => {});
  assert(!page.__errors.length, 'no page errors', page.__errors);
  await page.close();
});

check('pages: merge, rotate, reorder, delete with undo, extract, split, images, then read the result', async () => {
  const page = await openTool();
  await feed(page, 'pdf-file', [{ name: 'alpha.pdf', label: 'Alpha', pages: 3 }]);
  assert(await opened(page, 3), 'opened');
  await page.click('#pdf-modes [data-mode="pages"]');
  assert(await until(() => page.evaluate(() => document.querySelectorAll('#pdf-grid .pdf__card').length === 3), 8000), 'three cards');
  await page.evaluate(() => { document.getElementById('pdf-files').dataset.purpose = 'add'; });
  await feed(page, 'pdf-files', [{ name: 'beta.pdf', label: 'Beta', pages: 2 }]);
  assert(await until(() => page.evaluate(() => document.querySelectorAll('#pdf-grid .pdf__card').length === 5), 10000), 'adding a PDF appends its pages');
  const labels = await page.evaluate(() => Array.from(document.querySelectorAll('#pdf-grid .num')).map((n) => n.textContent));
  assert(JSON.stringify(labels) === JSON.stringify(['1', '2', '3', 'B · 4', 'B · 5']), 'added pages are marked B', labels);
  assert(await until(() => page.evaluate(() => document.querySelectorAll('#pdf-grid canvas.is-drawn').length === 5), 10000), 'every card has a thumbnail');
  const cards = await page.$$('#pdf-grid .pdf__card');
  await cards[0].click();
  assert(await page.evaluate(() => document.querySelectorAll('#pdf-grid .pdf__card.is-sel').length === 1 && /1 selected/.test(document.getElementById('pdf-meta').textContent)), 'click selects a page');
  await page.click('[data-act="rotate"]');
  const from = await page.evaluate(() => { const r = document.querySelectorAll('#pdf-grid .pdf__card')[0].getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 3 }; });
  const to = await page.evaluate(() => { const r = document.querySelectorAll('#pdf-grid .pdf__card')[2].getBoundingClientRect(); return { x: r.right - 6, y: r.top + r.height / 3 }; });
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(from.x + (to.x - from.x) * i / 10, from.y + (to.y - from.y) * i / 10);
  await page.mouse.up();
  await sleep(300);
  const order = await page.evaluate(() => window.__mentriaPdf.st.pages.map((p) => p.s + ':' + p.i + ':' + p.rot));
  assert(JSON.stringify(order) === JSON.stringify(['0:1:0', '0:2:0', '0:0:90', '1:0:0', '1:1:0']), 'dragging page 1 after page 3 reorders it, rotated', order);
  await page.evaluate(() => window.__mentriaPdf.st.sel.clear());
  await page.evaluate(() => { const c = document.querySelectorAll('#pdf-grid .pdf__card'); c[0].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' })); c[0].dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' })); });
  await page.click('[data-act="delete"]');
  assert(await until(() => page.evaluate(() => document.querySelectorAll('#pdf-grid .pdf__card').length === 4), 3000), 'delete removes the selected page');
  const undo = await page.$('.m-toast--undo button');
  assert(undo, 'an undo toast appears');
  await undo.click();
  assert(await until(() => page.evaluate(() => document.querySelectorAll('#pdf-grid .pdf__card').length === 5), 3000), 'undo brings the page back');
  await page.evaluate(() => { const S = window.__mentriaPdf.st; S.sel.clear(); S.sel.add(S.pages[0].id); });
  await page.click('[data-act="delete"]');
  assert(await until(() => page.evaluate(() => window.__mentriaPdf.st.pages.length === 4), 3000), 'delete again');
  await page.evaluate(() => { const S = window.__mentriaPdf.st; S.sel.clear(); S.sel.add(S.pages[2].id); S.sel.add(S.pages[3].id); });
  await page.click('[data-act="extract"]');
  assert(await until(() => page.evaluate(() => window.__downloads.length === 1), 10000), 'extract saves a file');
  await page.evaluate(() => { const S = window.__mentriaPdf.st; S.sel.clear(); S.sel.add(S.pages[2].id); });
  await page.click('[data-act="split"]');
  assert(await until(() => page.evaluate(() => window.__downloads.length === 3), 10000), 'split saves two files');
  await page.evaluate(() => { const S = window.__mentriaPdf.st; S.sel.clear(); S.sel.add(S.pages[0].id); });
  await page.click('[data-act="images"]');
  assert(await until(() => page.evaluate(() => window.__downloads.length === 4), 15000), 'images saves the selected page as a PNG');
  const files = await page.evaluate(async () => {
    const core = globalThis.pdfjsLib;
    const out = [];
    for (const d of window.__downloads) {
      if (!/\.pdf$/.test(d.name)) { out.push({ name: d.name, size: d.size }); continue; }
      const doc = await core.getDocument({ data: new Uint8Array(await d.blob.arrayBuffer()) }).promise;
      const texts = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const p = await doc.getPage(i);
        const tc = await p.getTextContent();
        texts.push(tc.items.map((x) => x.str).join(' ').match(/(Alpha|Beta) page \d/)[0] + (p.rotate ? '@' + p.rotate : ''));
      }
      out.push({ name: d.name, pages: texts });
    }
    return out;
  });
  assert(files[0].name === 'alpha-pages.pdf' && JSON.stringify(files[0].pages) === JSON.stringify(['Beta page 1', 'Beta page 2']), 'extract has the two selected pages', files[0]);
  assert(files[1].name === 'alpha-part-1.pdf' && JSON.stringify(files[1].pages) === JSON.stringify(['Alpha page 3', 'Alpha page 1@90']), 'split part 1', files[1]);
  assert(files[2].name === 'alpha-part-2.pdf' && JSON.stringify(files[2].pages) === JSON.stringify(['Beta page 1', 'Beta page 2']), 'split part 2', files[2]);
  assert(/\.png$/.test(files[3].name) && files[3].size > 5000, 'the page image is a real PNG', files[3]);
  await page.click('#pdf-modes [data-mode="read"]');
  assert(await opened(page, 4), 'back in Read the composed PDF has 4 pages');
  const readBack = await page.evaluate(async () => {
    const doc = window.__mentriaPdf.st.doc;
    const out = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const p = await doc.getPage(i);
      const tc = await p.getTextContent();
      out.push(tc.items.map((x) => x.str).join(' ').match(/(Alpha|Beta) page \d/)[0] + (p.rotate ? '@' + p.rotate : ''));
    }
    return out;
  });
  assert(JSON.stringify(readBack) === JSON.stringify(['Alpha page 3', 'Alpha page 1@90', 'Beta page 1', 'Beta page 2']), 'the reader shows the new order, rotation and deletions', readBack);
  assert(!page.__errors.length, 'no page errors', page.__errors);
  await page.close();
});

check('combine PDFs from the start screen opens Pages with every file', async () => {
  const page = await openTool();
  await page.evaluate(() => { document.getElementById('pdf-files').dataset.purpose = 'combine'; });
  await feed(page, 'pdf-files', [{ name: 'one.pdf', label: 'One', pages: 1 }, { name: 'two.pdf', label: 'Two', pages: 2 }]);
  assert(await until(() => page.evaluate(() => !document.getElementById('pdf-pages').hidden && document.querySelectorAll('#pdf-grid .pdf__card').length === 3), 15000), 'Pages shows all pages of both files');
  await page.click('#pdf-save');
  assert(await until(() => page.evaluate(() => window.__downloads.length === 1), 10000), 'save writes the merged PDF');
  const n = await page.evaluate(async () => (await globalThis.pdfjsLib.getDocument({ data: new Uint8Array(await window.__downloads[0].blob.arrayBuffer()) }).promise).numPages);
  assert(n === 3, 'the merged file has 3 pages', n);
  assert(!page.__errors.length, 'no page errors', page.__errors);
  await page.close();
});

check('a damaged file and a non-PDF are refused politely', async () => {
  const page = await openTool();
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52, 10, 1, 2, 3])], 'broken.pdf', { type: 'application/pdf' }));
    const input = document.getElementById('pdf-file');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  assert(await until(() => page.evaluate(() => /couldn't be opened/.test(document.getElementById('pdf-status').textContent)), 15000), 'a damaged PDF says it could not be opened', await page.evaluate(() => document.getElementById('pdf-status').textContent));
  assert(await page.evaluate(() => !document.getElementById('pdf-start').hidden), 'the start screen stays');
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['hello'], 'notes.txt', { type: 'text/plain' }));
    const input = document.getElementById('pdf-file');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  assert(await until(() => page.evaluate(() => /isn't a PDF/.test((document.querySelector('.m-toast') || {}).textContent || '')), 5000), 'a non-PDF gets a toast');
  await page.close();
});

check('works offline after one visit', async () => {
  const page = await openTool();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload({ waitUntil: 'load' });
  assert(await until(() => page.evaluate(() => !!navigator.serviceWorker.controller), 10000), 'the service worker controls the page');
  await page.evaluate(() => { window.__downloads = []; });
  await feed(page, 'pdf-file', [{ name: 'alpha.pdf', label: 'Alpha', pages: 2 }]);
  assert(await opened(page, 2), 'opened online');
  await page.evaluate(() => { const S = window.__mentriaPdf; return S.setMode('pages'); });
  await page.evaluate(() => window.__mentriaPdf.compose(window.__mentriaPdf.st.pages));
  await sleep(1500);
  const cached = await page.evaluate(async () => { const c = await caches.open('mentria-pdf-6.4.299'); return (await c.keys()).map((r) => new URL(r.url).pathname.split('/').pop()); });
  assert(['pdf.min.mjs', 'pdf.worker.min.mjs', 'pdf_viewer.mjs', 'pdf_viewer.css', 'pdf-lib.esm.min.js'].every((f) => cached.includes(f)), 'the PDF code is kept for offline use after first use', cached);
  await page.setOfflineMode(true);
  await page.reload({ waitUntil: 'load' });
  await feed(page, 'pdf-file', [{ name: 'alpha.pdf', label: 'Alpha', pages: 2 }]).catch(() => {});
  assert(await opened(page, 2), 'offline, the tool still opens a PDF');
  await page.setOfflineMode(false);
  await page.close();
});

check('phone layout fits without sideways scroll in every mode', async () => {
  const page = await openTool({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const start = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
  assert(start, 'start screen fits');
  if (SHOTS) await page.screenshot({ path: SHOTS + '/phone-start.png' });
  await feed(page, 'pdf-file', [{ name: 'alpha.pdf', label: 'Alpha', pages: 3 }]);
  assert(await opened(page, 3), 'opened');
  for (const mode of ['read', 'edit', 'pages']) {
    await page.evaluate((m) => window.__mentriaPdf.setMode(m), mode);
    await sleep(900);
    const r = await page.evaluate(() => ({ fits: document.documentElement.scrollWidth <= innerWidth + 1, sw: document.documentElement.scrollWidth, iw: innerWidth }));
    assert(r.fits, mode + ' fits the phone width', r);
    if (mode === 'edit') {
      const tools = await page.evaluate(() => Array.from(document.querySelectorAll('.pdf__tools .pdf__chip')).map((b) => { const q = b.getBoundingClientRect(); return [Math.round(q.left), Math.round(q.right), Math.round(q.height)]; }));
      assert(tools.length === 5 && tools.every(([l, rr, h]) => l >= 0 && rr <= 390 && h >= 44), 'all five edit tools are on screen with tall tap targets', tools);
    }
    if (SHOTS) await page.screenshot({ path: SHOTS + '/phone-' + mode + '.png' });
  }
  assert(!page.__errors.length, 'no page errors', page.__errors);
  await page.close();
});

check('every language has the tool', async () => {
  const page = await browser.newPage();
  for (const pre of ['/es', '/fr', '/ja', '/pt-br']) {
    const r = await page.goto(ORIGIN + pre + '/tools/pdf/', { waitUntil: 'domcontentloaded' });
    const t = await page.evaluate(() => ({ h1: document.querySelector('h1').textContent, open: document.getElementById('pdf-open').textContent, keys: /tool\.pdf\./.test(document.body.innerText) }));
    assert(r.status() === 200 && t.h1 && t.open && !t.keys, pre + ' renders translated text', t);
  }
  await page.close();
});

let failed = 0;
for (const [name, fn] of checks) {
  try {
    await fn();
    console.log('PASS ' + name);
  } catch (e) {
    failed += 1;
    console.log('FAIL ' + name + ': ' + (e && e.message || e));
  }
}
await browser.close();
server.close();
rmSync(PROFILE, { recursive: true, force: true });
console.log((checks.length - failed) + '/' + checks.length + ' passed');
process.exit(failed ? 1 : 0);
