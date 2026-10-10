import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { serve } from './scanner-serve.mjs';

const BUILD = process.argv[2];
if (!BUILD) {
  console.error('usage: node scripts/webkit-blob-check.mjs <build dir>');
  process.exit(2);
}
const PAGE = '__webkit-blob-check.html';
const sim = (...args) => execFileSync('xcrun', ['simctl', ...args], { encoding: 'utf8' });

const html = `<!doctype html><meta charset="utf-8"><title>webkit blob check</title>
<script type="module">
import * as db from '/assets/scanner/db.js';
import { addPage, newDoc, updatePage } from '/assets/scanner/pages.js';
import { dbApiFor } from '/assets/js/mentria-extensions.js';
import * as vdb from '/assets/vocal-tuner/db.js';
import { encodeWav } from '/assets/vocal-tuner/wav.js';
import { renderTake } from '/assets/vocal-tuner/render.js';
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
  const ext = dbApiFor('webkit-check');
  await ext.clear();
  for (let k = 0; k < 8; k++) {
    const bmp = await photo(200 + k);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    c.getContext('2d').drawImage(bmp, 0, 0);
    bmp.close();
    await ext.set('item' + k, { name: 'item ' + k, photo: await c.convertToBlob({ type: 'image/jpeg', quality: 0.92 }) });
  }
  const held = await ext.get('item0');
  held.name = 'renamed';
  await ext.set('item0', held);
  ok = (await decodes('extension db: photo after a rename, held copy', held.photo)) && ok;
  ok = (await decodes('extension db: photo read again', (await ext.get('item0')).photo)) && ok;
  await ext.set('meta', { list: [1, 2, 3], tags: new Set(['a']), file: new File(['hello'], 'note.txt', { type: 'text/plain' }) });
  const meta = await ext.get('meta');
  const kept = meta && meta.list.length === 3 && meta.tags.has('a') && meta.file.name === 'note.txt' && (await meta.file.text()) === 'hello';
  lines.push((kept ? 'ok   ' : 'FAIL ') + 'extension db: plain data, sets and file names survive');
  ok = kept && ok;
  await ext.clear();
  const tone = (seconds, f) => {
    const n = seconds * 48000, pcm = new Int16Array(n);
    for (let i = 0; i < n; i++) pcm[i] = Math.round(9000 * Math.sin(2 * Math.PI * f * i / 48000));
    return pcm;
  };
  const audioDecodes = async (label, blob) => {
    try {
      const C = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      const buf = await new C(1, 1, 48000).decodeAudioData(await blob.arrayBuffer());
      if (!buf.length) throw new Error('empty');
      lines.push('ok   ' + label);
      return true;
    } catch (e) {
      lines.push('FAIL ' + label + ': ' + e.message);
      return false;
    }
  };
  const vtakes = [];
  for (let k = 0; k < 8; k++) {
    const now = Date.now();
    const settings = { correction: 1, key: null };
    const take = { id: vdb.newId(), name: 'take ' + k, createdAt: now, updatedAt: now, duration: 20, sampleRate: 48000, settings, renderedWith: settings };
    const pcm = tone(20, 200 + k * 9);
    await vdb.saveTake(take, { dry: encodeWav([pcm], 48000), tuned: encodeWav([pcm], 48000) });
    vtakes.push(take);
  }
  const vt0 = await vdb.getTake(vtakes[0].id);
  const heldDry = await vdb.getAudio(vt0.id, 'dry');
  vt0.name = 'renamed';
  vt0.updatedAt = Date.now();
  await vdb.updateTake(vt0);
  for (const key of [{ root: 9, mode: 'minor' }, { root: 0, mode: 'major' }]) {
    const settings = { correction: 1, key };
    const tuned = await renderTake(await vdb.getAudio(vt0.id, 'dry'), settings).promise;
    await vdb.saveRender(Object.assign({}, vt0, { settings, renderedWith: settings, updatedAt: Date.now() }), tuned);
  }
  ok = (await audioDecodes('vocal: dry held across a rename and two re-renders', heldDry)) && ok;
  ok = (await audioDecodes('vocal: dry read again', await vdb.getAudio(vt0.id, 'dry'))) && ok;
  ok = (await audioDecodes('vocal: tuned read again after two re-renders', await vdb.getAudio(vt0.id, 'tuned'))) && ok;
  ok = (await audioDecodes('vocal: another take read again', await vdb.getAudio(vtakes[1].id, 'tuned'))) && ok;
  const vfinal = await vdb.getTake(vt0.id);
  const vkept = vfinal.name === 'renamed' && !!vfinal.renderedWith.key && vfinal.renderedWith.key.root === 0;
  lines.push((vkept ? 'ok   ' : 'FAIL ') + 'vocal: the rename and the last render are both kept');
  ok = vkept && ok;
  for (const tk of vtakes) await vdb.deleteTake(tk.id);
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
