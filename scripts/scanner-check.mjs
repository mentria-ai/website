import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const mod = (name) => import(pathToFileURL(resolve(here, '../src/assets/scanner/' + name)).href);
const local = (name) => import(pathToFileURL(resolve(here, name)).href);

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, (msg ? msg + ': ' : '') + 'expected ' + b + ' got ' + a);

const G = await mod('geometry.js');

test('geometry: orderQuad returns top-left, top-right, bottom-right, bottom-left', () => {
  assert.deepEqual(G.orderQuad([[90, 80], [10, 10], [10, 80], [90, 10]]), [[10, 10], [90, 10], [90, 80], [10, 80]]);
  const c = 50;
  const rot = (p, a) => [c + (p[0] - c) * Math.cos(a) - (p[1] - c) * Math.sin(a), c + (p[0] - c) * Math.sin(a) + (p[1] - c) * Math.cos(a)];
  const r = [[20, 30], [80, 30], [80, 70], [20, 70]].map((p) => rot(p, Math.PI / 6));
  assert.deepEqual(G.orderQuad([r[2], r[0], r[3], r[1]]), r);
});

test('geometry: area and convexity', () => {
  assert.equal(G.quadArea([[0, 0], [4, 0], [4, 3], [0, 3]]), 12);
  assert.equal(G.isConvex([[0, 0], [4, 0], [4, 3], [0, 3]]), true);
  assert.equal(G.isConvex([[0, 0], [4, 3], [4, 0], [0, 3]]), false);
  assert.equal(G.isConvex([[0, 0], [4, 0], [1, 1], [0, 4]]), false);
});

test('geometry: homography maps corners and inverts', () => {
  const src = [[0, 0], [300, 0], [300, 200], [0, 200]];
  const dst = [[12, 30], [280, 8], [310, 220], [5, 190]];
  const H = G.homography(src, dst);
  src.forEach((p, i) => { const q = G.applyH(H, p[0], p[1]); near(q[0], dst[i][0], 1e-6); near(q[1], dst[i][1], 1e-6); });
  const Hi = G.invert3(H);
  const q = G.applyH(H, 123, 45);
  const back = G.applyH(Hi, q[0], q[1]);
  near(back[0], 123, 1e-6);
  near(back[1], 45, 1e-6);
  const R = G.quadToRect(dst, 300, 200);
  const corner = G.applyH(R, 300, 200);
  near(corner[0], 310, 1e-6);
  near(corner[1], 220, 1e-6);
});

test('geometry: output size follows the longest sides and the cap', () => {
  assert.deepEqual(G.outputSize([[0, 0], [400, 0], [400, 300], [0, 300]], 200), { width: 200, height: 150 });
  assert.deepEqual(G.outputSize([[0, 0], [400, 0], [350, 300], [50, 300]], 0), { width: 400, height: 304 });
});

test('geometry: validQuad accepts pages and rejects specks, the frame border and slivers', () => {
  const w = 384, h = 288;
  assert.equal(G.validQuad([[80, 50], [300, 60], [290, 240], [90, 230]], w, h), true);
  assert.equal(G.validQuad([[180, 130], [210, 130], [210, 160], [180, 160]], w, h), false);
  assert.equal(G.validQuad([[0, 0], [384, 0], [384, 288], [0, 288]], w, h), false);
  assert.equal(G.validQuad([[20, 20], [360, 30], [370, 60], [30, 50]], w, h), false);
});

test('geometry: a 16:9 preview outline lands in the central band of a 4:3 photo', () => {
  const m = G.mapVideoQuadToPhoto([[0, 0], [1, 0], [1, 1], [0, 1]], 1920, 1080, 4000, 3000);
  near(m[0][0], 0, 1e-9);
  near(m[0][1], 375, 1e-9);
  near(m[2][0], 4000, 1e-9);
  near(m[2][1], 2625, 1e-9);
  const same = G.mapVideoQuadToPhoto([[0.5, 0.5], [1, 0], [1, 1], [0, 1]], 1920, 1080, 3840, 2160);
  near(same[0][0], 1920, 1e-9);
  near(same[0][1], 1080, 1e-9);
});

test('geometry: a refined outline is used only when every corner agrees with the live one', () => {
  const live = [[400, 300], [1600, 320], [1580, 1400], [420, 1380]];
  const near = live.map(([x, y]) => [x + 30, y - 25]);
  const board = [[250, 120], [1760, 140], [1740, 1600], [260, 1580]];
  assert.equal(G.agrees(live, near, 2000, 1500), true);
  assert.equal(G.agrees(live, [near[2], near[3], near[0], near[1]], 2000, 1500), true);
  assert.equal(G.agrees(live, board, 2000, 1500), false);
  assert.equal(G.agrees(live, [live[0], live[1], live[2], [700, 1380]], 2000, 1500), false);
});

test('geometry: big photos are scaled under the pixel cap and keep their shape', () => {
  const f = G.fitPixels(8000, 6000, 16e6);
  assert.ok(f.width * f.height <= 16e6);
  near(f.width / f.height, 8000 / 6000, 0.005);
  assert.deepEqual(G.fitPixels(1200, 900, 16e6), { width: 1200, height: 900 });
});

const S = await local('scanner-scenes.mjs');
const D = await mod('detect.js');

function cornerError(quadNorm, truth, w, h) {
  let best = Infinity;
  for (let k = 0; k < 4; k++) {
    let worst = 0;
    for (let i = 0; i < 4; i++) {
      const p = quadNorm[(i + k) % 4];
      worst = Math.max(worst, Math.hypot(p[0] * w - truth[i][0], p[1] * h - truth[i][1]));
    }
    best = Math.min(best, worst);
  }
  return best;
}

test('detect: finds the page in at least 90% of 200 synthetic scenes', () => {
  let ok = 0;
  const misses = [];
  for (let seed = 1; seed <= 200; seed++) {
    const s = S.makeScene(seed);
    const r = D.detectQuad(s.rgba, s.w, s.h);
    if (r.quad && cornerError(r.quad, s.truth, s.w, s.h) <= 0.025 * Math.max(s.w, s.h)) ok++;
    else misses.push(seed + ':' + s.kind);
  }
  assert.ok(ok >= 180, ok + '/200 found; misses ' + misses.slice(0, 25).join(' '));
});

test('detect: reports no page on 30 empty scenes', () => {
  for (let seed = 1001; seed <= 1030; seed++) {
    const s = S.makeScene(seed, { empty: true });
    assert.equal(D.detectQuad(s.rgba, s.w, s.h).quad, null, 'seed ' + seed + ' ' + s.kind);
  }
});

test('detect: a sharp scene scores higher sharpness than a blurred copy', () => {
  const sharp = S.makeScene(7, { blur: 0 }), soft = S.makeScene(7, { blur: 3 });
  assert.ok(D.detectQuad(sharp.rgba, sharp.w, sharp.h).sharpness > D.detectQuad(soft.rgba, soft.w, soft.h).sharpness);
});

const T = await mod('tracker.js');
const basePage = [[0.2, 0.2], [0.8, 0.22], [0.78, 0.8], [0.22, 0.78]];
const sample = (q, conf = 0.9, sharp = 100) => ({ quad: q, confidence: conf, sharpness: sharp, w: 384, h: 288 });

test('tracker: a steady page fires once the window and fill time pass', () => {
  const tr = T.createTracker();
  let fired = -1;
  for (let t = 0; t <= 3000; t += 66) {
    const s = tr.push(sample(basePage), t);
    if (s.state === 'fire' && fired < 0) fired = t;
  }
  const due = T.STEADY_WINDOW_MS + T.FIRE_AFTER_MS;
  assert.ok(fired >= due - 66 && fired <= due + 200, 'fired at ' + fired);
});

test('tracker: a shaking page never fires', () => {
  const tr = T.createTracker();
  const r = S.rng(5);
  for (let t = 0; t <= 4000; t += 66) {
    const q = basePage.map(([x, y]) => [x + (r() - 0.5) * 0.08, y + (r() - 0.5) * 0.08]);
    assert.notEqual(tr.push(sample(q), t).state, 'fire');
  }
});

test('tracker: no second capture until the page changes', () => {
  const tr = T.createTracker();
  let t = 0;
  for (; t <= 1500; t += 66) tr.push(sample(basePage), t);
  tr.markCaptured(t);
  for (let k = 0; k < 60; k++, t += 66) assert.notEqual(tr.push(k % 10 === 5 ? null : sample(basePage), t).state, 'fire');
  const moved = basePage.map(([x, y]) => [x + 0.2, y]);
  let fired = false;
  for (let k = 0; k < 60; k++, t += 66) if (tr.push(sample(moved), t).state === 'fire') fired = true;
  assert.ok(fired);
});

test('tracker: after a capture it reports the page as captured until a new page appears', () => {
  const tr = T.createTracker();
  let t = 0;
  for (; t <= 1500; t += 66) assert.equal(tr.push(sample(basePage), t).captured, false);
  tr.markCaptured(t);
  for (let k = 0; k < 20; k++, t += 66) assert.equal(tr.push(k % 10 === 5 ? null : sample(basePage), t).captured, true);
  const moved = basePage.map(([x, y]) => [x + 0.2, y]);
  let s = null;
  for (let k = 0; k < 5; k++, t += 66) s = tr.push(sample(moved), t);
  assert.equal(s.captured, false);
});

test('tracker: a shot taken with no outline leaves auto-capture armed', () => {
  const tr = T.createTracker();
  let t = 0;
  for (; t <= 600; t += 66) tr.push(null, t);
  tr.markCaptured(t);
  let fired = false;
  for (let k = 0; k < 60; k++, t += 66) if (tr.push(sample(basePage), t).state === 'fire') fired = true;
  assert.ok(fired);
});

test('tracker: single dropped frames neither restart nor empty the ring', () => {
  const tr = T.createTracker();
  let fired = -1, prev = 0, emptied = 0;
  for (let t = 0, k = 0; t <= 3000; t += 66, k++) {
    const s = tr.push(k % 5 === 4 ? null : sample(basePage), t);
    if (fired < 0 && prev > 0 && s.progress === 0) emptied++;
    prev = s.progress;
    if (s.state === 'fire' && fired < 0) fired = t;
  }
  const due = T.STEADY_WINDOW_MS + T.FIRE_AFTER_MS;
  assert.ok(fired >= 0 && fired <= due + 300, 'fired at ' + fired);
  assert.equal(emptied, 0);
});

test('tracker: noisy sharpness only delays the shot, it does not restart the ring', () => {
  const tr = T.createTracker();
  const r = S.rng(11);
  let fired = -1;
  for (let t = 0, k = 0; t <= 3000; t += 66, k++) {
    const sharp = k % 9 === 4 ? 55 : 72 + r() * 28;
    const s = tr.push(sample(basePage, 0.9, sharp), t);
    if (s.state === 'fire' && fired < 0) fired = t;
  }
  const due = T.STEADY_WINDOW_MS + T.FIRE_AFTER_MS;
  assert.ok(fired >= 0 && fired <= due + 300, 'fired at ' + fired);
});

test('tracker: a hand-held page with tremor, jitter and confidence dips fires promptly', () => {
  const tr = T.createTracker();
  const r = S.rng(23);
  let fired = -1;
  for (let t = 0, k = 0; t <= 3000; t += 66, k++) {
    const ox = 0.006 * Math.sin(k * 2.6) + 0.004 * (r() - 0.5) + 0.000003 * t;
    const oy = 0.006 * Math.cos(k * 2.1) + 0.004 * (r() - 0.5);
    const q = basePage.map(([x, y]) => [x + ox + 0.002 * (r() - 0.5), y + oy + 0.002 * (r() - 0.5)]);
    const conf = k % 7 === 3 ? 0.5 : 0.65 + r() * 0.3;
    const s = tr.push(sample(q, conf, 80 + r() * 20), t);
    if (s.state === 'fire' && fired < 0) fired = t;
  }
  const due = T.STEADY_WINDOW_MS + T.FIRE_AFTER_MS;
  assert.ok(fired >= 0 && fired <= due + 400, 'fired at ' + fired);
});

test('tracker: a page panning across the view never fires', () => {
  const tr = T.createTracker();
  for (let t = 0, k = 0; t <= 4000; t += 66, k++) {
    const q = basePage.map(([x, y]) => [x - 0.15 + 0.004 * k, y]);
    assert.notEqual(tr.push(sample(q), t).state, 'fire', 'fired while panning at ' + t);
  }
});

test('tracker: losing the page clears the outline after 300 ms', () => {
  const tr = T.createTracker();
  tr.push(sample(basePage), 0);
  assert.equal(tr.push(null, 200).state, 'found');
  assert.equal(tr.push(null, 400).state, 'none');
});

test('tracker: a blurry frame holds back the capture', () => {
  const tr = T.createTracker();
  let t = 0;
  for (; t <= 900; t += 66) tr.push(sample(basePage, 0.9, 100), t);
  for (let k = 0; k < 20; k++, t += 66) assert.notEqual(tr.push(sample(basePage, 0.9, 40), t).state, 'fire');
});

const P = await mod('pdf.js');
const fakeJpeg = (n) => Uint8Array.from({ length: n }, (_, i) => (i === 0 ? 0xff : i === 1 ? 0xd8 : i % 251));

function parsePdf(bytes) {
  const s = Buffer.from(bytes).toString('latin1');
  assert.ok(s.startsWith('%PDF-1.4\n'));
  const at = s.lastIndexOf('startxref\n');
  const xref = parseInt(s.slice(at + 10), 10);
  assert.ok(s.slice(xref).startsWith('xref\n0 '));
  const count = parseInt(s.slice(xref + 7), 10);
  const rows = s.slice(xref).split('\n').slice(2, 2 + count);
  rows.forEach((row, k) => {
    assert.equal(row.length, 19, 'xref row ' + k);
    if (k) assert.ok(s.slice(parseInt(row.slice(0, 10), 10)).startsWith(k + ' 0 obj'), 'object ' + k);
  });
  assert.ok(s.trimEnd().endsWith('%%EOF'));
  return s;
}

test('pdf: two A4 pages with a valid cross-reference table', () => {
  const s = parsePdf(P.buildPdfBytes([
    { jpeg: fakeJpeg(500), width: 1000, height: 1414 },
    { jpeg: fakeJpeg(300), width: 1414, height: 1000 }
  ], { pageSize: 'a4', title: 'Scan', date: new Date(2026, 9, 9, 14, 32, 5) }));
  assert.match(s, /\/Type \/Pages \/Kids \[4 0 R 7 0 R\] \/Count 2/);
  assert.match(s, /\/MediaBox \[0 0 595.28 841.89\]/);
  assert.match(s, /\/MediaBox \[0 0 841.89 595.28\]/);
  assert.match(s, /\/CreationDate \(D:20261009143205\)/);
  assert.equal((s.match(/\/Subtype \/Image/g) || []).length, 2);
});

test('pdf: fit pages take the image shape', () => {
  const s = parsePdf(P.buildPdfBytes([{ jpeg: fakeJpeg(100), width: 800, height: 1600 }], { pageSize: 'fit' }));
  assert.match(s, /\/MediaBox \[0 0 595.28 1190.56\]/);
  assert.match(s, /q 595.28 0 0 1190.56 0 0 cm \/Im0 Do Q/);
});

test('pdf: images are centered on Letter pages', () => {
  const b = P.pageBox(1000, 1000, 'letter');
  assert.equal(b.pw, 612);
  assert.equal(b.ph, 792);
  near(b.dw, 612, 1e-9);
  near(b.y, 90, 1e-9);
});

test('pdf: titles are escaped, and non-Latin titles are stored as UTF-16', () => {
  assert.equal(P.pdfString('Scan (1)'), '(Scan \\(1\\))');
  assert.equal(P.pdfString('請求書'), '<FEFF8ACB6C4266F8>');
  const s = parsePdf(P.buildPdfBytes([{ jpeg: fakeJpeg(50), width: 100, height: 100 }], { title: '請求書' }));
  assert.match(s, /\/Title <FEFF8ACB6C4266F8>/);
});

const Z = await mod('zip.js');

test('zip: entries, CRCs and the central directory', () => {
  const a = new TextEncoder().encode('hello'), b = new Uint8Array([1, 2, 3, 4]);
  const z = Z.zipStoreBytes([{ name: 'Scan - 01.jpg', data: a }, { name: 'スキャン - 02.jpg', data: b }]);
  const v = new DataView(z.buffer, z.byteOffset, z.byteLength);
  assert.equal(Z.crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  assert.equal(v.getUint32(0, true), 0x04034b50);
  assert.equal(v.getUint32(14, true), Z.crc32(a));
  const e = z.length - 22;
  assert.equal(v.getUint32(e, true), 0x06054b50);
  assert.equal(v.getUint16(e + 10, true), 2);
  let cd = v.getUint32(e + 16, true);
  const names = [];
  for (let k = 0; k < 2; k++) {
    assert.equal(v.getUint32(cd, true), 0x02014b50);
    const len = v.getUint16(cd + 28, true);
    names.push(new TextDecoder().decode(z.slice(cd + 46, cd + 46 + len)));
    cd += 46 + len;
  }
  assert.deepEqual(names, ['Scan - 01.jpg', 'スキャン - 02.jpg']);
});

test('pdf: building from page blobs gives the same file as from byte arrays', async () => {
  const pages = [{ jpeg: fakeJpeg(300), width: 1200, height: 1700 }, { jpeg: fakeJpeg(180), width: 1700, height: 1200 }];
  const date = new Date(2026, 9, 9, 12, 0, 0);
  const want = P.buildPdfBytes(pages, { pageSize: 'a4', title: 'Scan', date });
  const blob = P.buildPdf(pages.map((p) => ({ jpeg: new Blob([p.jpeg]), width: p.width, height: p.height })), { pageSize: 'a4', title: 'Scan', date });
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), want);
});

test('zip: zipping blobs gives the same archive as zipping byte arrays', async () => {
  const a = fakeJpeg(1000), b = fakeJpeg(2048);
  const date = new Date(2026, 9, 9, 12, 0, 0);
  const want = Z.zipStoreBytes([{ name: 'Scan - 01.jpg', data: a }, { name: 'Scan - 02.jpg', data: b }], date);
  const blob = await Z.zipStore([{ name: 'Scan - 01.jpg', data: new Blob([a]) }, { name: 'Scan - 02.jpg', data: new Blob([b]) }], date);
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), want);
});

test('zip: names are safe for file systems', () => {
  assert.equal(Z.safeName('Tax: 2026/Q3 <draft>?'), 'Tax- 2026-Q3 -draft-');
  assert.equal(Z.safeName('   '), 'Scan');
  assert.equal(Z.safeName('..hidden'), 'hidden');
  assert.equal(Z.safeName('請求書 2026'), '請求書 2026');
  assert.equal(Z.safeName('x'.repeat(200)).length, 80);
});

const CPU = await mod('cpu.js');

function warpedPage(seed) {
  const s = S.makeScene(seed);
  const size = G.outputSize(s.truth, 0);
  const data = CPU.warpCPU(s.rgba, s.w, s.h, G.quadToRect(s.truth, size.width, size.height), size.width, size.height);
  return { data, w: size.width, h: size.height };
}

test('cpu: identity warp returns the source', () => {
  const w = 8, h = 6, src = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) {
    src[p * 4] = p * 5; src[p * 4 + 1] = 255 - p * 5; src[p * 4 + 2] = (p * 37) % 256; src[p * 4 + 3] = 255;
  }
  const out = CPU.warpCPU(src, w, h, G.quadToRect(G.fullQuad(w, h), w, h), w, h);
  for (let i = 0; i < src.length; i++) near(out[i], src[i], 1, 'byte ' + i);
});

test('cpu: warping a scene page yields mostly paper', () => {
  const p = warpedPage(11);
  let sum = 0;
  for (let i = 0; i < p.w * p.h; i++) sum += p.data[i * 4];
  assert.ok(sum / (p.w * p.h) > 170, 'mean ' + sum / (p.w * p.h));
});

test('cpu: quarter turns swap the sides without mirroring', () => {
  const w = 3, h = 2, src = new Uint8ClampedArray(w * h * 4);
  ['A', 'B', 'C', 'D', 'E', 'F'].forEach((ch, p) => { src[p * 4] = ch.charCodeAt(0); src[p * 4 + 3] = 255; });
  const read = (r) => Array.from({ length: r.w * r.h }, (_, p) => String.fromCharCode(r.data[p * 4])).join('');
  const r1 = CPU.rotateCPU(src, w, h, 1), r2 = CPU.rotateCPU(src, w, h, 2), r3 = CPU.rotateCPU(src, w, h, 3);
  assert.deepEqual([r1.w, r1.h], [2, 3]);
  assert.equal(read(r1), 'DAEBFC');
  assert.equal(read(r2), 'FEDCBA');
  assert.equal(read(r3), 'CFBEAD');
});

test('cpu: black & white turns a page into ink and paper', () => {
  const p = warpedPage(11);
  const bw = CPU.filterCPU(p.data, p.w, p.h, 'bw', null);
  let extreme = 0;
  for (let i = 0; i < p.w * p.h; i++) if (bw[i * 4] < 40 || bw[i * 4] > 215) extreme++;
  assert.ok(extreme / (p.w * p.h) > 0.8, 'share ' + extreme / (p.w * p.h));
});

test('cpu: auto color stretches paper towards white', () => {
  const p = warpedPage(11);
  const st = CPU.stats(p.data, p.w, p.h);
  const after = CPU.stats(CPU.filterCPU(p.data, p.w, p.h, 'auto', st), p.w, p.h);
  assert.ok(after.yhi >= 245, 'yhi ' + after.yhi);
  assert.ok(after.yhi >= st.yhi);
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log('ok   ' + name);
  } catch (e) {
    failed++;
    console.log('FAIL ' + name);
    console.log('     ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n     ') : e));
  }
}
console.log(tests.length - failed + '/' + tests.length + ' passed');
if (failed) process.exit(1);
