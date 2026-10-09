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
