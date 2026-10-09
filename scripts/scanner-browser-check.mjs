import { rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { readdirSync, readFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { serve } from './scanner-serve.mjs';
import { writeY4m } from './scanner-y4m.mjs';

const BUILD = process.argv[2];
if (!BUILD) { console.log('usage: node scripts/scanner-browser-check.mjs <build dir>'); process.exit(2); }
const ORIGIN = 'http://localhost:8098';
const PROFILE = '/Volumes/Mac ext storage/games-tmp/orch/scanner-check-profile';
rmSync(PROFILE, { recursive: true, force: true });
const VIDEO = '/Volumes/Mac ext storage/games-tmp/orch/scanner-page.y4m';
writeY4m(VIDEO);
const server = await serve(BUILD, 8098);
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  userDataDir: PROFILE,
  protocolTimeout: 600000,
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-video-capture=' + VIDEO]
});

const checks = [];
const check = (name, fn) => checks.push([name, fn]);
const FIXTURES = '/Volumes/Mac ext storage/games-tmp/orch/scanner-fixtures';

async function makeFixtures(page, count) {
  const files = await page.evaluate(async (count) => {
    const out = [];
    for (let k = 0; k < count; k++) {
      const c = new OffscreenCanvas(1600, 1200);
      const x = c.getContext('2d');
      x.fillStyle = k % 2 ? '#3a2a1c' : '#1d2630';
      x.fillRect(0, 0, 1600, 1200);
      const q = [[300 + k * 20, 180], [1290, 220 - k * 10], [1250, 1050], [340, 1010]];
      x.fillStyle = '#f4f3ee';
      x.beginPath();
      q.forEach((p, i) => (i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1])));
      x.closePath();
      x.fill();
      x.fillStyle = '#2b2b2b';
      for (let i = 0; i < 18; i++) x.fillRect(430, 300 + i * 38, 700 - (i % 3) * 90, 12);
      const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (let i = 0; i < buf.length; i += 32768) s += String.fromCharCode.apply(null, buf.subarray(i, i + 32768));
      out.push(btoa(s));
    }
    return out;
  }, count);
  mkdirSync(FIXTURES, { recursive: true });
  return files.map((b64, i) => {
    const p = FIXTURES + '/page-' + (i + 1) + '.jpg';
    writeFileSync(p, Buffer.from(b64, 'base64'));
    return p;
  });
}

check('renderer: GPU and CPU agree, rotation keeps orientation, filters and detection work', async (page) => {
  await page.goto(ORIGIN + '/about/', { waitUntil: 'load' });
  const r = await page.evaluate(async () => {
    const W = await import('/assets/scanner/warp.js');
    const D = await import('/assets/scanner/detector.js');
    const c = new OffscreenCanvas(800, 600);
    const x = c.getContext('2d');
    x.fillStyle = '#202830';
    x.fillRect(0, 0, 800, 600);
    const quad = [[150, 100], [650, 120], [620, 520], [180, 500]];
    x.fillStyle = '#f2f2ee';
    x.beginPath();
    quad.forEach((p, i) => (i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1])));
    x.closePath();
    x.fill();
    x.fillStyle = '#d02020';
    x.fillRect(210, 150, 60, 60);
    x.fillStyle = '#333333';
    for (let i = 0; i < 12; i++) x.fillRect(260, 260 + i * 18, 280, 6);
    const bmp = await createImageBitmap(c);
    const pixels = async (blob) => {
      const b = await createImageBitmap(blob);
      const cc = new OffscreenCanvas(b.width, b.height);
      const xx = cc.getContext('2d');
      xx.drawImage(b, 0, 0);
      return { d: xx.getImageData(0, 0, b.width, b.height).data, w: b.width, h: b.height };
    };
    const redAt = (img) => {
      let sx = 0, sy = 0, n = 0;
      for (let y = 0; y < img.h; y++) {
        for (let xx = 0; xx < img.w; xx++) {
          const i = (y * img.w + xx) * 4;
          if (img.d[i] > 150 && img.d[i + 1] < 90) { sx += xx; sy += y; n++; }
        }
      }
      return n ? [sx / n / img.w, sy / n / img.h] : null;
    };
    const g = await W.render(bmp, quad, { maxSide: 600, mime: 'image/png' });
    const k = await W.render(bmp, quad, { maxSide: 600, mime: 'image/png', cpu: true });
    const a = await pixels(g.blob), b = await pixels(k.blob);
    let diff = 0;
    for (let i = 0; i < a.d.length; i += 4) diff += Math.abs(a.d[i] - b.d[i]) + Math.abs(a.d[i + 1] - b.d[i + 1]) + Math.abs(a.d[i + 2] - b.d[i + 2]);
    diff /= (a.d.length / 4) * 3;
    const rot = await pixels((await W.render(bmp, quad, { maxSide: 600, mime: 'image/png', rotation: 90 })).blob);
    const modes = {};
    for (const f of ['auto', 'gray', 'bw', 'whiteboard']) {
      const o = await pixels((await W.render(bmp, quad, { maxSide: 400, mime: 'image/png', filter: f })).blob);
      let ext = 0;
      for (let i = 0; i < o.d.length; i += 4) if (o.d[i] < 40 || o.d[i] > 215) ext++;
      modes[f] = ext / (o.d.length / 4);
    }
    const det = await D.detectIn(bmp, 640);
    const cornerErr = det.quad ? Math.max(...det.quad.map((p) => Math.min(...quad.map((q) => Math.hypot(p[0] - q[0], p[1] - q[1]))))) : 999;
    return { gpu: W.gpuAvailable(), w: g.width, h: g.height, cw: k.width, ch: k.height, rw: rot.w, rh: rot.h, diff, r0: redAt(a), r90: redAt(rot), modes, cornerErr };
  });
  if (!r.gpu) throw new Error('WebGL2 is unavailable in this browser');
  if (r.w !== r.cw || r.h !== r.ch) throw new Error('GPU ' + r.w + 'x' + r.h + ' vs CPU ' + r.cw + 'x' + r.ch);
  if (r.rw !== r.h || r.rh !== r.w) throw new Error('rotation did not swap sides');
  if (r.diff > 4) throw new Error('GPU and CPU differ by ' + r.diff.toFixed(2));
  if (!r.r0 || r.r0[0] > 0.5 || r.r0[1] > 0.5) throw new Error('marker not top-left: ' + JSON.stringify(r.r0));
  if (!r.r90 || r.r90[0] < 0.5 || r.r90[1] > 0.5) throw new Error('marker not top-right after 90: ' + JSON.stringify(r.r90));
  if (r.modes.bw < 0.8) throw new Error('black & white share ' + r.modes.bw);
  if (r.cornerErr > 24) throw new Error('detection corner error ' + r.cornerErr);
});

check('app: the empty library renders in every locale without errors', async (page) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  for (const prefix of ['', '/es', '/pt-br', '/fr', '/ja']) {
    await page.goto(ORIGIN + prefix + '/extensions/scanner/app/', { waitUntil: 'load' });
    await page.waitForSelector('.sc-lib .sc-empty:not([hidden])', { timeout: 15000 });
    const title = await page.$eval('.sc-top__title', (e) => e.textContent);
    if (!title || title.includes('library.')) throw new Error(prefix + ' title ' + title);
  }
  const ink = await page.$eval('.sc-lib__actions .sc-btn--primary', (b) => getComputedStyle(b).color);
  if (ink !== 'rgb(4, 19, 13)') throw new Error('primary button text is ' + ink);
  if (errors.length) throw new Error(errors.join(' | '));
});

check('library: importing two photos creates a document with rendered pages', async (page) => {
  await page.goto(ORIGIN + '/extensions/scanner/app/', { waitUntil: 'load' });
  await page.waitForSelector('.sc-lib');
  const files = await makeFixtures(page, 2);
  const input = await page.$('.sc-lib input[type=file]');
  await input.uploadFile(...files);
  await page.waitForFunction(async () => {
    const db = await import('/assets/scanner/db.js');
    const docs = await db.listDocs();
    return docs.length === 1 && docs[0].pageIds.length === 2;
  }, { timeout: 60000, polling: 500 });
  const r = await page.evaluate(async () => {
    const db = await import('/assets/scanner/db.js');
    const [doc] = await db.listDocs();
    const p = await db.getPage(doc.pageIds[0]);
    return { thumb: p.thumb && p.thumb.size, render: p.render && p.render.size, quad: !!p.quad };
  });
  if (!r.thumb || !r.render) throw new Error('missing renders ' + JSON.stringify(r));
  if (!r.quad) throw new Error('no page outline detected on import');
});

check('capture: the camera page is outlined and captured automatically', async (page) => {
  await page.goto(ORIGIN + '/extensions/scanner/app/', { waitUntil: 'load' });
  await page.waitForSelector('.sc-lib');
  await page.evaluate(async () => {
    const db = await import('/assets/scanner/db.js');
    for (const d of await db.listDocs()) await db.deleteDoc(d.id);
    localStorage.removeItem('mentria.scanner.auto');
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.sc-lib__actions .sc-btn--primary');
  await page.click('.sc-lib__actions .sc-btn--primary');
  await page.waitForSelector('.sc-cam');
  await page.evaluate(() => {
    window.__statusWrites = 0;
    new MutationObserver((list) => { window.__statusWrites += list.length; }).observe(document.querySelector('.sc-cam__status'), { childList: true, characterData: true, subtree: true });
  });
  await page.waitForFunction(() => {
    const c = document.querySelector('.sc-cam__count');
    return c && c.textContent === '1';
  }, { timeout: 30000, polling: 250 });
  const r = await page.evaluate(async () => {
    const db = await import('/assets/scanner/db.js');
    const [doc] = await db.listDocs();
    const p = doc ? await db.getPage(doc.pageIds[0]) : null;
    return p ? { quad: p.quad, w: p.width, h: p.height } : null;
  });
  if (!r || !r.quad) throw new Error('no captured page with an outline: ' + JSON.stringify(r));
  await new Promise((res) => setTimeout(res, 800));
  const said = await page.$eval('.sc-cam__status', (el) => [el.textContent, window.SCAN_COPY.capture.captured]);
  if (said[0] !== said[1]) throw new Error('status after the capture: ' + said[0]);
  const writes = await page.evaluate(() => window.__statusWrites);
  if (writes > 12) throw new Error('status line rewritten ' + writes + ' times');
});

check('db: pages dropped with a document save disappear in the same step', async (page) => {
  await page.goto(ORIGIN + '/extensions/scanner/app/', { waitUntil: 'load' });
  await page.waitForSelector('.sc-lib');
  const r = await page.evaluate(async () => {
    const db = await import('/assets/scanner/db.js');
    const doc = { id: db.newId(), name: 'T', pageIds: [], createdAt: Date.now(), updatedAt: Date.now() };
    const a = { id: db.newId(), docId: doc.id }, b = { id: db.newId(), docId: doc.id };
    await db.savePage(a);
    await db.savePage(b);
    doc.pageIds = [a.id, b.id];
    await db.saveDoc(doc);
    doc.pageIds = [b.id];
    await db.saveDoc(doc, [a.id]);
    const out = { ids: (await db.getDoc(doc.id)).pageIds, a: await db.getPage(a.id), b: !!(await db.getPage(b.id)) };
    await db.deleteDoc(doc.id);
    return out;
  });
  if (r.a !== null || !r.b || r.ids.length !== 1) throw new Error('dropped page still stored: ' + JSON.stringify(r));
});

async function docState(page) {
  return page.evaluate(async () => {
    const db = await import('/assets/scanner/db.js');
    const [d] = await db.listDocs();
    if (!d) return null;
    const ps = await Promise.all(d.pageIds.map((id) => db.getPage(id)));
    return { ids: d.pageIds, rot: ps.map((p) => p.rotation), filters: ps.map((p) => p.filter), quads: ps.map((p) => p.quad) };
  });
}

async function waitFor(page, test, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const s = await docState(page);
    if (s && test(s)) return s;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('timed out; last state ' + JSON.stringify(await docState(page)));
}

check('review: rotate, filter, reorder and delete update the saved document', async (page) => {
  await page.goto(ORIGIN + '/extensions/scanner/app/', { waitUntil: 'load' });
  await page.waitForSelector('.sc-lib');
  await page.evaluate(async () => {
    const db = await import('/assets/scanner/db.js');
    for (const d of await db.listDocs()) await db.deleteDoc(d.id);
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.sc-lib input[type=file]');
  const files = await makeFixtures(page, 2);
  await (await page.$('.sc-lib input[type=file]')).uploadFile(...files);
  await page.waitForSelector('.sc-rev .sc-thumb:nth-of-type(2)', { timeout: 60000 });
  await page.waitForFunction(() => { const im = document.querySelector('.sc-rev__img'); return im && im.complete && im.naturalWidth > 0; });
  const layout = await page.evaluate(() => {
    const st = document.querySelector('.sc-rev__stage').getBoundingClientRect();
    const im = document.querySelector('.sc-rev__img').getBoundingClientRect();
    const b = document.querySelector('.sc-rev__tools .sc-tool:nth-child(2)');
    const r = b.getBoundingClientRect();
    return { inside: im.top >= st.top - 1 && im.bottom <= st.bottom + 1 && im.left >= st.left - 1 && im.right <= st.right + 1, reachable: b.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)), img: [im.top, im.bottom].map(Math.round), stage: [st.top, st.bottom].map(Math.round) };
  });
  if (!layout.inside || !layout.reachable) throw new Error('page image spills out of its stage: ' + JSON.stringify(layout));
  const first = await docState(page);
  await page.click('.sc-rev__tools .sc-tool:nth-child(2)');
  await waitFor(page, (s) => s.rot[s.ids.indexOf(first.ids[1])] === 90 || s.rot[s.ids.indexOf(first.ids[0])] === 90);
  await page.click('.sc-rev__tools .sc-tool:nth-child(3)');
  await page.waitForSelector('.sc-rev__filters .sc-filter:nth-child(4)');
  await page.click('.sc-rev__filters .sc-filter:nth-child(4)');
  await waitFor(page, (s) => s.filters.includes('bw'));
  await page.focus('.sc-rev__strip .sc-thumb:nth-of-type(1)');
  await page.keyboard.down('Alt');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.up('Alt');
  await waitFor(page, (s) => s.ids[0] === first.ids[1] && s.ids[1] === first.ids[0]);
  await page.click('.sc-rev__tools .sc-tool:nth-child(5)');
  await page.waitForSelector('.sc-sheet .sc-btn--danger');
  const danger = await page.$eval('.sc-sheet .sc-btn--danger', (b) => getComputedStyle(b).color);
  if (danger !== 'rgb(26, 6, 6)') throw new Error('danger button text is ' + danger);
  await page.click('.sc-sheet .sc-btn--danger');
  await waitFor(page, (s) => s.ids.length === 1);
});

check('adjust: whole photo and detect again change the saved outline', async (page) => {
  await page.goto(ORIGIN + '/extensions/scanner/app/', { waitUntil: 'load' });
  await page.waitForSelector('.sc-card__open');
  await page.click('.sc-card__open');
  await page.waitForSelector('.sc-rev__tools');
  await page.click('.sc-rev__tools .sc-tool:nth-child(1)');
  await page.waitForSelector('.sc-adj__poly[points]');
  await page.click('.sc-adj__tools .sc-btn:nth-child(2)');
  await page.click('.sc-adj__bar > .sc-btn--primary');
  await waitFor(page, (s) => s.quads[0] === null);
  await page.waitForSelector('.sc-rev__tools');
  await page.click('.sc-rev__tools .sc-tool:nth-child(1)');
  await page.waitForSelector('.sc-adj__poly[points]');
  await page.click('.sc-adj__tools .sc-btn:nth-child(1)');
  await page.waitForFunction(() => !document.querySelector('.sc-adj__tools .sc-btn:nth-child(1)').disabled);
  await page.click('.sc-adj__bar > .sc-btn--primary');
  await waitFor(page, (s) => Array.isArray(s.quads[0]));
});

const DOWNLOADS = '/Volumes/Mac ext storage/games-tmp/orch/scanner-downloads';

async function nextDownload(ext, ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const f = readdirSync(DOWNLOADS).find((n) => n.endsWith(ext));
    if (f) return DOWNLOADS + '/' + f;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('no ' + ext + ' download');
}

check('export: a PDF has one page per scan and JPGs download as a ZIP', async (page) => {
  rmSync(DOWNLOADS, { recursive: true, force: true });
  mkdirSync(DOWNLOADS, { recursive: true });
  const session = await browser.target().createCDPSession();
  await session.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOADS });
  await page.goto(ORIGIN + '/extensions/scanner/app/', { waitUntil: 'load' });
  await page.waitForSelector('.sc-lib input[type=file]');
  await page.evaluate(() => localStorage.removeItem('mentria.scanner.export'));
  const files = await makeFixtures(page, 2);
  await (await page.$('.sc-lib input[type=file]')).uploadFile(...files);
  await page.waitForSelector('.sc-rev .sc-thumb:nth-of-type(2)', { timeout: 60000 });
  await page.click('.sc-rev .sc-top .sc-btn--primary');
  await page.waitForSelector('.sc-sheet .sc-seg');
  await page.click('.sc-sheet .sc-field:nth-of-type(2) .sc-seg button:nth-child(2)');
  await page.click('.sc-sheet .sc-sheet__actions .sc-btn--primary');
  const pdf = readFileSync(await nextDownload('.pdf')).toString('latin1');
  if (!pdf.startsWith('%PDF-1.4')) throw new Error('not a PDF');
  if ((pdf.match(/\/Type \/Page /g) || []).length !== 2) throw new Error('PDF page count');
  if (!/\/MediaBox \[0 0 (595\.28 841\.89|841\.89 595\.28)\]/.test(pdf)) throw new Error('PDF is not A4');
  await page.click('.sc-rev .sc-top .sc-btn--primary');
  await page.waitForSelector('.sc-sheet .sc-seg');
  await page.click('.sc-sheet .sc-field:nth-of-type(1) .sc-seg button:nth-child(2)');
  await page.click('.sc-sheet .sc-sheet__actions .sc-btn--primary');
  const zip = readFileSync(await nextDownload('.zip'));
  const end = zip.length - 22;
  if (zip.readUInt32LE(end) !== 0x06054b50 || zip.readUInt16LE(end + 10) !== 2) throw new Error('ZIP entries');
});

check('retake: one shot replaces the page and presses during processing are ignored', async (page) => {
  await page.goto(ORIGIN + '/extensions/scanner/app/', { waitUntil: 'load' });
  await page.waitForSelector('.sc-lib');
  await page.evaluate(async () => {
    const db = await import('/assets/scanner/db.js');
    for (const d of await db.listDocs()) await db.deleteDoc(d.id);
    localStorage.removeItem('mentria.scanner.auto');
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.sc-lib input[type=file]');
  const files = await makeFixtures(page, 2);
  await (await page.$('.sc-lib input[type=file]')).uploadFile(...files);
  await page.waitForSelector('.sc-rev .sc-thumb:nth-of-type(2)', { timeout: 60000 });
  const before = await docState(page);
  await page.click('.sc-rev__tools .sc-tool:nth-child(4)');
  await page.waitForSelector('.sc-cam');
  await page.evaluate(() => new Promise((resolve) => {
    window.__hold = true;
    const req = indexedDB.open('mentria-ext-scanner');
    req.onsuccess = () => {
      const st = req.result.transaction(['docs', 'pages'], 'readwrite').objectStore('pages');
      const spin = () => { if (window.__hold) st.get('none').onsuccess = spin; };
      spin();
      resolve();
    };
  }));
  await page.waitForFunction(() => {
    const s = document.querySelector('.sc-cam__status');
    return s && s.textContent === window.SCAN_COPY.capture.captured;
  }, { timeout: 30000, polling: 50 });
  await page.evaluate(async () => {
    for (let i = 0; i < 12; i++) {
      const b = document.querySelector('.sc-cam__shutter');
      if (b) b.click();
      await new Promise((res) => setTimeout(res, 100));
    }
    window.__hold = false;
  });
  await page.waitForSelector('.sc-rev', { timeout: 30000 });
  await new Promise((res) => setTimeout(res, 1500));
  const after = await docState(page);
  if (after.ids.length !== before.ids.length) throw new Error('retake changed the page count: ' + before.ids.length + ' -> ' + after.ids.length);
  if (after.ids[0] === before.ids[0] || after.ids[1] !== before.ids[1]) throw new Error('retake did not replace only the first page');
});

check('host: the store page runs the scanner, goes full screen for the camera and back', async (page) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(ORIGIN + '/extensions/scanner/', { waitUntil: 'load' });
  await page.waitForSelector('#xr-frame');
  await page.evaluate(() => {
    document.documentElement.classList.add('is-standalone');
    const u = document.getElementById('m-update');
    if (u) u.hidden = false;
  });
  const frameHandle = await page.$('#xr-frame');
  const frame = await frameHandle.contentFrame();
  const reachable = async (sel) => {
    const pts = await frame.$eval(sel, (el) => { const b = el.getBoundingClientRect(); return [0.25, 0.5, 0.75].map((k) => [b.left + b.width / 2, b.top + b.height * k]); });
    return page.evaluate((pts) => {
      const f = document.getElementById('xr-frame');
      const r = f.getBoundingClientRect(), cs = getComputedStyle(f);
      return pts.every(([x, y]) => document.elementFromPoint(r.left + f.clientLeft + parseFloat(cs.paddingLeft) + x, r.top + f.clientTop + parseFloat(cs.paddingTop) + y) === f);
    }, pts);
  };
  await frame.waitForSelector('.sc-lib__actions .sc-btn--primary', { timeout: 20000 });
  await frame.click('.sc-lib__actions .sc-btn--primary');
  await page.waitForFunction(() => document.getElementById('xr-frame').classList.contains('xr__frame--full'), { timeout: 10000 });
  await frame.waitForFunction(() => {
    const c = document.querySelector('.sc-cam__count');
    return c && c.textContent === '1';
  }, { timeout: 30000, polling: 250 });
  for (const sel of ['.sc-cam__shutter', '.sc-cam__bottom .sc-icon-btn', '.sc-cam__right .sc-btn--primary']) {
    if (!(await reachable(sel))) throw new Error(sel + ' is covered by the page around the frame');
  }
  await frame.click('.sc-cam__right .sc-btn--primary');
  await frame.waitForSelector('.sc-rev');
  await frame.click('.sc-rev__tools .sc-tool:nth-child(1)');
  await frame.waitForSelector('.sc-adj__poly[points]');
  if (!(await reachable('.sc-adj__bar > .sc-btn--primary'))) throw new Error('Apply is covered by the page around the frame');
  await frame.click('.sc-adj__bar > .sc-btn:not(.sc-btn--primary)');
  await frame.waitForSelector('.sc-rev');
  const full = await page.evaluate(() => document.getElementById('xr-frame').classList.contains('xr__frame--full') || document.documentElement.classList.contains('ext-full'));
  if (full) throw new Error('frame stayed full screen after leaving the camera');
  if (errors.length) throw new Error(errors.join(' | '));
});

let failed = 0;
for (const [name, fn] of checks) {
  const page = await browser.newPage();
  try {
    await fn(page);
    console.log('ok   ' + name);
  } catch (e) {
    failed++;
    console.log('FAIL ' + name + '\n     ' + ((e && e.message) || e));
  }
  await page.close();
}
await browser.close();
server.close();
rmSync(PROFILE, { recursive: true, force: true });
rmSync(FIXTURES, { recursive: true, force: true });
rmSync(VIDEO, { force: true });
rmSync(DOWNLOADS, { recursive: true, force: true });
console.log(checks.length - failed + '/' + checks.length + ' passed');
if (failed) process.exit(1);
