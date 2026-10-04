import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const P = require(resolve(here, '../src/assets/js/mentria-packs.js'));

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const RealDate = Date;
let clock = new RealDate(2026, 9, 12, 21, 0, 0).getTime();
function FakeDate(...a) {
  if (!new.target) return new RealDate(clock).toString();
  return a.length ? new RealDate(...a) : new RealDate(clock);
}
FakeDate.prototype = RealDate.prototype;
FakeDate.now = () => clock;
FakeDate.UTC = RealDate.UTC;
FakeDate.parse = RealDate.parse;
globalThis.Date = FakeDate;

const mem = {};
globalThis.MentriaStore = {
  get: (kind, key) => (mem[kind + '/' + key] === undefined ? null : JSON.parse(mem[kind + '/' + key])),
  set: (kind, key, v) => { mem[kind + '/' + key] = JSON.stringify(v); return true; },
  remove: (kind, key) => { delete mem[kind + '/' + key]; },
  list: (kind) => Object.keys(mem).filter((k) => k.startsWith(kind + '/')).map((k) => k.slice(kind.length + 1))
};

const at = (day, h = 9, m = 0) => { clock = new RealDate(2026, 9, 12 + day, h, m, 0).getTime(); };
const midnight = (day) => new RealDate(2026, 9, 12 + day).getTime();
const card = (id, c) => P.getProgress(id).cards[c];

test('srs: first right answer is due three days later at local midnight', () => {
  at(0, 21);
  P.recordAnswer('srs', 'a', true);
  assert.equal(card('srs', 'a').s, 1);
  assert.equal(card('srs', 'a').d, midnight(3));
});

test('srs: right again before it is due keeps the interval', () => {
  at(0, 21, 5);
  for (let i = 0; i < 4; i++) P.recordAnswer('srs', 'a', true);
  const c = card('srs', 'a');
  assert.equal(c.s, 1);
  assert.equal(c.d, midnight(3));
  assert.equal(c.r, 'right');
  assert.equal(c.n, 5);
});

test('srs: right once due moves up the ladder', () => {
  at(3, 7);
  P.recordAnswer('srs', 'a', true);
  assert.equal(card('srs', 'a').s, 2);
  assert.equal(card('srs', 'a').d, midnight(10));
  at(10, 0, 1);
  P.recordAnswer('srs', 'a', true);
  assert.equal(card('srs', 'a').s, 3);
  assert.equal(card('srs', 'a').d, midnight(26));
});

test('srs: a miss resets to tomorrow even before it is due', () => {
  at(11, 12);
  P.recordAnswer('srs', 'a', false);
  const c = card('srs', 'a');
  assert.equal(c.s, 0);
  assert.equal(c.r, 'wrong');
  assert.equal(c.d, midnight(12));
});

test('srs: right straight after a miss stays due tomorrow', () => {
  at(11, 12, 2);
  P.recordAnswer('srs', 'a', true);
  const c = card('srs', 'a');
  assert.equal(c.r, 'right');
  assert.equal(c.s, 0);
  assert.equal(c.d, midnight(12));
  assert.equal(P.isDue(c, midnight(12)), true);
  at(12, 8);
  P.recordAnswer('srs', 'a', true);
  assert.equal(card('srs', 'a').s, 1);
  assert.equal(card('srs', 'a').d, midnight(15));
});

test('srs: the top interval caps at 35 days', () => {
  at(0, 9);
  P.recordAnswer('cap', 'x', true);
  for (const step of [7, 16, 35, 35]) {
    clock = card('cap', 'x').d + 3600e3;
    P.recordAnswer('cap', 'x', true);
    const now = new RealDate(clock);
    assert.equal(card('cap', 'x').d, new RealDate(now.getFullYear(), now.getMonth(), now.getDate() + step).getTime());
  }
  assert.equal(card('cap', 'x').s, 4);
});

test('srs: a guess distance is kept on early answers', () => {
  at(0, 10);
  P.recordAnswer('g', 'q', true, { distance: 2 });
  P.recordAnswer('g', 'q', true, { distance: 0 });
  assert.equal(card('g', 'q').g, 0);
  assert.equal(card('g', 'q').s, 1);
});

test('srs: the day mark counts each card once a day', () => {
  at(20, 9);
  const before = P.getDays()[P.dayKey()] || 0;
  P.recordAnswer('days', 'a', true);
  P.recordAnswer('days', 'a', true);
  P.recordAnswer('days', 'b', false);
  assert.equal(P.getDays()[P.dayKey()] - before, 2);
});

test('text: exact, base and case-insensitive language keys', () => {
  assert.equal(P.text({ 'pt-br': 'Olá', en: 'Hello' }, 'pt-BR'), 'Olá');
  assert.equal(P.text({ 'pt-BR': 'Olá', en: 'Hello' }, 'pt-BR'), 'Olá');
  assert.equal(P.text({ pt: 'Oi', en: 'Hello' }, 'pt-BR'), 'Oi');
  assert.equal(P.text({ PT: 'Oi', en: 'Hello' }, 'pt-BR'), 'Oi');
  assert.equal(P.text({ 'pt-BR': 'Olá', pt: 'Oi' }, 'pt-BR'), 'Olá');
  assert.equal(P.text({ en: 'Hello', fr: 'Bonjour' }, 'ja'), 'Hello');
  assert.equal(P.text({ fr: 'Bonjour' }, 'ja'), 'Bonjour');
  assert.equal(P.text({ ES: 'Hola', en: 'Hello' }, 'es'), 'Hola');
  assert.equal(P.text('plain', 'fr'), 'plain');
});

const cloze = (text, answers) => ({ id: 'p', title: 'T', cards: [{ id: 'c', type: 'cloze', text, answers }] });

test('validate: cloze translations with a different blank count warn', () => {
  const v = P.validate(cloze({ en: 'A {{a}} and {{b}}.', es: 'Un {{a}}.', fr: 'Un {{a}} et {{b}}.' }, ['x', 'y']));
  assert.equal(v.ok, true);
  assert.deepEqual(v.warnings, ['cards[0].text.es: one blank per answer (2), found 1']);
});

test('validate: matching cloze translations stay quiet', () => {
  assert.deepEqual(P.validate(cloze({ en: 'A {{a}}.', ja: '{{a}} です。' }, ['x'])).warnings, []);
  assert.deepEqual(P.validate(cloze('A {{a}}.', ['x'])).warnings, []);
  assert.equal(P.validate(cloze('A {{a}}.', ['x', 'y'])).ok, false);
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
