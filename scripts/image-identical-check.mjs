import http from 'node:http';
import { createReadStream, statSync, rmSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, extname, normalize, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import puppeteer from 'puppeteer-core';

const [BASE, NEXT] = process.argv.slice(2);
if (!BASE || !NEXT) { console.log('usage: node scripts/image-identical-check.mjs <baseBuild> <newBuild>'); process.exit(2); }
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const WORK = mkdtempSync(join(tmpdir(), 'image-identical-'));

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

const SETTINGS = [
  { name: 'defaults', s: null },
  { name: 'webp q60', s: { format: 'webp', quality: 60, resize: 'none' } },
  { name: 'max width 800', s: { format: 'jpeg', quality: 80, resize: 'fit', maxWidth: 800, maxHeight: null } }
];

const MAKE_FIXTURES = `(async () => {
  const blobOf = (w, h, mime, q, paint) => new Promise((res) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); paint(g, w, h); c.toBlob((b) => res(b), mime, q); });
  const grad = (g, w, h) => { const l = g.createLinearGradient(0, 0, w, h); l.addColorStop(0, '#0a3d62'); l.addColorStop(0.5, '#e58e26'); l.addColorStop(1, '#78e08f'); g.fillStyle = l; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.font = '120px sans-serif'; g.fillText('fixture', w / 5, h / 2); };
  const b64 = async (b) => { const u = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 1) s += String.fromCharCode(u[i]); return btoa(s); };
  const png = await blobOf(2400, 1600, 'image/png', 1, grad);
  const jpg = new Uint8Array(await (await blobOf(3000, 2000, 'image/jpeg', 0.9, grad)).arrayBuffer());
  const tiff = [0x4D, 0x4D, 0x00, 0x2A, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0, 0, 0];
  const exif = [0x45, 0x78, 0x69, 0x66, 0, 0].concat(tiff);
  const app1 = [0xFF, 0xE1, (exif.length + 2) >> 8, (exif.length + 2) & 255].concat(exif);
  const oriented = new Uint8Array(jpg.length + app1.length);
  oriented.set(jpg.subarray(0, 2), 0);
  oriented.set(app1, 2);
  oriented.set(jpg.subarray(2), 2 + app1.length);
  const webp = await blobOf(1200, 800, 'image/webp', 0.9, grad);
  const tiny = await blobOf(1, 1, 'image/png', 1, (g) => { g.fillStyle = '#c33'; g.fillRect(0, 0, 1, 1); });
  return { 'gradient.png': await b64(png), 'oriented.jpg': await b64(new Blob([oriented])), 'photo.webp': await b64(webp), 'tiny.png': await b64(tiny) };
})()`;

const CAPTURE = `(() => {
  window.__outs = [];
  const real = HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob = function (cb, mime, q) {
    const canvas = this;
    return real.call(this, async (blob) => {
      if (window.__capture && blob) {
        const d = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
        window.__outs.push(blob.type + ' ' + canvas.width + 'x' + canvas.height + ' ' + Array.from(d, (x) => x.toString(16).padStart(2, '0')).join(''));
      }
      cb(blob);
    }, mime, q);
  };
})();`;

const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, userDataDir: join(WORK, 'profile'), args: ['--no-first-run', '--no-default-browser-check'] });
const servers = [];
let failed = 0;
let total = 0;
try {
  servers.push(await serve(BASE, 8093), await serve(NEXT, 8094));
  const maker = await browser.newPage();
  await maker.goto('http://127.0.0.1:8093/about/');
  const fixtures = await maker.evaluate(MAKE_FIXTURES);
  await maker.close();
  const paths = {};
  for (const [name, data] of Object.entries(fixtures)) {
    paths[name] = join(WORK, name);
    writeFileSync(paths[name], Buffer.from(data, 'base64'));
  }
  const runOn = async (port) => {
    const out = {};
    for (const set of SETTINGS) {
      const page = await browser.newPage();
      await page.evaluateOnNewDocument(CAPTURE);
      const origin = 'http://127.0.0.1:' + port;
      await page.goto(origin + '/about/');
      await page.waitForFunction(() => !!window.MentriaStore, { timeout: 10000 });
      await page.evaluate((s) => { if (s) MentriaStore.set('tools', 'image_compressor_settings', s); else MentriaStore.remove('tools', 'image_compressor_settings'); }, set.s);
      await page.goto(origin + '/tools/image-compressor/');
      await page.waitForFunction(() => !!window.MentriaImage, { timeout: 10000 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 1800));
      for (const name of Object.keys(paths)) {
        await page.evaluate(() => { window.__outs = []; window.__capture = true; });
        const input = await page.$('#imc-file');
        await input.uploadFile(paths[name]);
        await page.waitForFunction(() => window.__outs.length >= 1, { timeout: 30000 }).catch(() => {});
        await new Promise((r) => setTimeout(r, 400));
        out[set.name + ' · ' + name] = await page.evaluate(() => { window.__capture = false; return window.__outs.join(' | '); });
        await page.evaluate(() => { const c = document.getElementById('imc-clear'); if (c && !c.hidden && c.getClientRects().length) c.click(); });
        await new Promise((r) => setTimeout(r, 300));
      }
      await page.close();
    }
    return out;
  };
  const before = await runOn(8093);
  const after = await runOn(8094);
  for (const key of Object.keys(before)) {
    total += 1;
    const same = !!before[key] && before[key] === after[key];
    if (!same) failed += 1;
    console.log((same ? 'PASS  ' : 'FAIL  ') + key + (same ? '' : '  [before ' + (before[key] || 'nothing') + ' | after ' + (after[key] || 'nothing') + ']'));
  }
} finally {
  await browser.close();
  servers.forEach((s) => s.close());
  rmSync(WORK, { recursive: true, force: true });
}
console.log(failed ? `\nimage identical: ${failed} FAILED of ${total}` : `\nimage identical: ${total}/${total}`);
process.exit(failed ? 1 : 0);
