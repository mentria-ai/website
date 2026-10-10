import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { serve } from './scanner-serve.mjs';

const BUILD = process.argv[2];
if (!BUILD) {
  console.error('usage: node scripts/scanner-webkit-check.mjs <build dir>');
  process.exit(2);
}
const PAGE = '__scanner-webkit-check.html';
const sim = (...args) => execFileSync('xcrun', ['simctl', ...args], { encoding: 'utf8' });

const html = `<!doctype html><meta charset="utf-8"><title>scanner webkit check</title>
<script type="module">
import * as db from '/assets/scanner/db.js';
import { addPage, newDoc, updatePage } from '/assets/scanner/pages.js';
const lines = [];
const report = (ok) => fetch('/__report', { method: 'POST', body: JSON.stringify({ ok, ua: navigator.userAgent, lines }) });
const decodes = async (label, blob) => {
  try { (await createImageBitmap(blob)).close(); lines.push('ok   ' + label); return true; }
  catch (e) { lines.push('FAIL ' + label + ': ' + e.message); return false; }
};
async function photo(seed) {
  const w = 3000, h = 2000, c = new OffscreenCanvas(w, h), x = c.getContext('2d');
  const img = x.createImageData(w, h);
  let s = seed;
  for (let i = 0; i < img.data.length; i += 4) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const v = 40 + (s >> 16) % 50;
    img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  x.fillStyle = '#f2f1ec';
  x.fillRect(700, 200, 1600, 1600);
  return createImageBitmap(c);
}
try {
  const quad = [[700, 200], [2300, 200], [2300, 1800], [700, 1800]];
  const docs = [];
  for (let k = 0; k < 8; k++) {
    const doc = newDoc();
    const bmp = await photo(100 + k);
    await addPage(doc, bmp, quad);
    bmp.close();
    docs.push(doc);
  }
  const pages = await Promise.all(docs.slice(0, 2).map((d) => db.getPage(d.pageIds[0])));
  let ok = true;
  for (const p of pages) await updatePage(p, { filter: 'bw' });
  for (const [i, p] of pages.entries()) {
    ok = (await decodes('page ' + (i + 1) + ' after its edit', p.original)) && ok;
    ok = (await decodes('page ' + (i + 1) + ' read again from storage', (await db.getPage(p.id)).original)) && ok;
  }
  try { await updatePage(pages[0], { filter: 'gray' }); lines.push('ok   second edit of page 1'); }
  catch (e) { ok = false; lines.push('FAIL second edit of page 1: ' + e.message); }
  await report(ok);
} catch (e) {
  lines.push('ERROR ' + e.message);
  await report(false);
}
</script>`;

function pickDevice() {
  const all = JSON.parse(sim('list', 'devices', 'available', '-j')).devices;
  const phones = Object.entries(all).filter(([rt]) => rt.includes('iOS')).flatMap(([, list]) => list).filter((d) => d.name.startsWith('iPhone'));
  return phones.find((d) => d.state === 'Booted') || phones[0];
}

const device = pickDevice();
if (!device) {
  console.error('no iPhone simulator available');
  process.exit(2);
}
writeFileSync(join(BUILD, PAGE), html);
let done;
const result = new Promise((ok) => { done = ok; });
const port = 20000 + Math.floor(Math.random() * 20000);
const server = await serve(BUILD, port, (path, body) => { if (path === '/__report') done(JSON.parse(body)); });
const booted = device.state !== 'Booted';
if (booted) {
  sim('boot', device.udid);
  sim('bootstatus', device.udid, '-b');
}
sim('openurl', device.udid, 'http://localhost:' + port + '/' + PAGE);
const timeout = new Promise((ok) => setTimeout(() => ok({ ok: false, lines: ['no report within 180 s'] }), 180000));
const r = await Promise.race([result, timeout]);
console.log(device.name + ' (' + device.udid + ')' + (r.ua ? '\n' + r.ua : ''));
for (const line of r.lines) console.log(line);
console.log(r.ok ? 'webkit: pass' : 'webkit: FAIL');
server.close();
rmSync(join(BUILD, PAGE), { force: true });
if (booted) sim('shutdown', device.udid);
process.exit(r.ok ? 0 : 1);
