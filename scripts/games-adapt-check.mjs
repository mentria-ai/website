import assert from 'node:assert/strict';
import { judgeWindow, nextScale, ADAPT_MIN_SCALE, parseStored, formatStored } from '../src/assets/games/kit/adapt.js';

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('a steady 60 fps second is neither slow nor a stall', () => {
  const w = judgeWindow({ frames: 60, spanMs: 1000, maxMs: 17 });
  assert.equal(Math.round(w.fps), 60);
  assert.equal(w.stall, false);
  assert.equal(w.slow, false);
});

test('one loading stall in an otherwise smooth second is ignored', () => {
  const w = judgeWindow({ frames: 49, spanMs: 1000, maxMs: 200 });
  assert.equal(w.stall, true);
  assert.equal(w.slow, false);
});

test('a phone that is slow all the time is slow, not a stall', () => {
  const w = judgeWindow({ frames: 6, spanMs: 1020, maxMs: 250 });
  assert.equal(w.stall, false);
  assert.equal(w.slow, true);
  const v = judgeWindow({ frames: 40, spanMs: 1000, maxMs: 33 });
  assert.equal(v.slow, true);
});

test('stepping down is bounded and remembered values are sanitised', () => {
  assert.equal(nextScale(1, 'down'), 0.85);
  assert.equal(nextScale(0.55, 'down'), ADAPT_MIN_SCALE);
  assert.equal(nextScale(0.9, 'up'), 1);
  assert.equal(nextScale(Number.NaN, 'keep'), 1);
  assert.equal(nextScale(0.2, 'keep'), ADAPT_MIN_SCALE);
  assert.equal(nextScale(3, 'keep'), 1);
});

test('a remembered scale keeps whether smaller sizes were already found not to help', () => {
  assert.deepEqual(parseStored(formatStored(0.85, false)), { scale: 0.85, locked: false });
  assert.deepEqual(parseStored(formatStored(0.85, true)), { scale: 0.85, locked: true });
  assert.deepEqual(parseStored(null), { scale: 1, locked: false });
  assert.deepEqual(parseStored('nonsense'), { scale: 1, locked: false });
  assert.deepEqual(parseStored('0.1|lock'), { scale: ADAPT_MIN_SCALE, locked: true });
  assert.equal(formatStored(1, false), null);
});

let failed = 0;
for (const [name, fn] of tests) {
  try { await fn(); console.log('ok   ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name); console.log('     ' + (e && e.message ? e.message.split('\n')[0] : e)); }
}
console.log(tests.length - failed + '/' + tests.length + ' passed');
if (failed) process.exit(1);
