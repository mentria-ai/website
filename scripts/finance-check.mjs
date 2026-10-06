import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const mod = (name) => import(pathToFileURL(resolve(here, '../src/assets/finance/' + name)).href);

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const M = await mod('money.js');
const D = await mod('dates.js');
const L = await mod('oplog.js');
const C = await mod('crypto.js');
const E = await mod('engine.js');
const I = await mod('importers.js');
const V = await mod('invest.js');
const N = await mod('nl.js');
const RC = await mod('recurring.js');
const F = await mod('forecast.js');
const T = await mod('tax.js');
const LG = await mod('ledger.js');

test('money: decimals per currency', () => {
  assert.equal(M.decimalsFor('USD'), 2);
  assert.equal(M.decimalsFor('JPY'), 0);
  assert.equal(M.decimalsFor('KWD'), 3);
});

test('money: toMinor rounds half to even', () => {
  assert.equal(M.toMinor('1.005', 2), 100);
  assert.equal(M.toMinor('1.015', 2), 102);
  assert.equal(M.toMinor('-2.5', 0), -2);
  assert.equal(M.toMinor('3.5', 0), 4);
  assert.equal(M.toMinor('12', 'JPY'), 12);
  assert.equal(M.toMinor('1.2345', 'KWD'), 1234);
  assert.equal(M.toMinor('abc', 2), null);
});

test('money: minorToDecimal round trips', () => {
  const r = rng(7);
  for (let i = 0; i < 500; i++) {
    const d = [0, 2, 3][i % 3];
    const v = Math.floor((r() - 0.5) * 1e12);
    assert.equal(M.toMinor(M.minorToDecimal(v, d), d), v);
  }
});

test('money: guard rejects huge values', () => {
  assert.throws(() => M.guard(2 ** 52));
  assert.throws(() => M.guard(0.5));
});

test('money: normalizeNumber handles locale styles', () => {
  assert.equal(M.normalizeNumber('1,234.56', 'en-US'), '1234.56');
  assert.equal(M.normalizeNumber('1.234,56', 'de-DE'), '1234.56');
  assert.equal(M.normalizeNumber('1 234,56', 'fr-FR'), '1234.56');
  assert.equal(M.normalizeNumber("1'234.56", 'de-CH'), '1234.56');
  assert.equal(M.normalizeNumber('€1.234,56', 'en-US'), '1234.56');
  assert.equal(M.normalizeNumber('1,234', 'en-US'), '1234');
  assert.equal(M.normalizeNumber('1,234', 'de-DE'), '1.234');
  assert.equal(M.normalizeNumber('12.50', 'de-DE'), '12.50');
  assert.equal(M.normalizeNumber('12k', 'en-US'), '12000');
  assert.equal(M.normalizeNumber('1.2M', 'en-US'), '1200000');
  assert.equal(M.normalizeNumber('-45.10', 'en-US'), '-45.10');
  assert.equal(M.normalizeNumber('(45.10)', 'en-US'), '-45.10');
  assert.equal(M.normalizeNumber('1,00,000.50', 'en-IN'), '100000.50');
});

test('money: qty x price with BigInt half-even', () => {
  assert.equal(M.qtyTimesPrice(15000, 4, 1234567, 2), 18519);
  assert.equal(M.qtyTimesPrice(100000000, 8, 650000000, 2), 6500000);
  assert.equal(M.qtyTimesPrice(10000, 4, 5000, 0), 0);
  assert.equal(M.qtyTimesPrice(30000, 4, 5000, 0), 2);
});

test('money: convert and allocate', () => {
  assert.equal(M.convertMinor(100000, 'USD', 'JPY', M.rateE6From('149.5')), 149500);
  assert.equal(M.convertMinor(149500, 'JPY', 'USD', M.rateE6From('0.006689')), 100001);
  const parts = M.allocate(1000, [1, 1, 1]);
  assert.equal(parts.reduce((a, b) => a + b, 0), 1000);
  assert.deepEqual(M.allocate(-1000, [1, 1, 1]).reduce((a, b) => a + b, 0), -1000);
});

const UI = await mod('ui.js');
const EN = await mod('entry.js');
const VI = await mod('views/invest.js');
const VA = await mod('views/accounts.js');
const VS = await mod('views/settings.js');
const NUM_LOCALES = ['en-US', 'es-ES', 'fr-FR', 'pt-BR', 'ja-JP'];
const commaLocale = (loc) => M.localeSeparators(loc).decimal === ',';
const withLocale = (loc, fn) => { UI.setNumberLocale(loc); try { fn(); } finally { UI.setNumberLocale(null); } };

test('numbers: entry amounts keep three decimals through prefill and save', () => {
  for (const loc of NUM_LOCALES) withLocale(loc, () => {
    for (const [minor, ccy] of [[12345, 'KWD'], [12345000, 'KWD'], [5, 'KWD'], [46249, 'EUR'], [123456, 'EUR'], [1500, 'JPY']]) {
      const typed = M.minorToDecimal(minor, ccy);
      assert.equal(EN.minorFromTyped(typed, ccy), minor, loc + ' unchanged ' + typed);
      const shown = M.decimalToInput(typed, loc);
      assert.equal(EN.minorFromTyped(M.normalizeNumber(shown, loc), ccy), minor, loc + ' retyped ' + shown);
    }
  });
  withLocale('es-ES', () => assert.equal(EN.minorFromTyped('12.345', 'KWD'), 12345));
});

test('numbers: prefilled text reads back unchanged in every number format', () => {
  const formats = ['en-US', 'en-GB', 'en-IN', 'en-CA', 'en-AU', 'es-ES', 'es-MX', 'fr-FR', 'fr-CA', 'de-DE', 'de-CH', 'it-IT', 'pt-BR', 'pt-PT', 'ja-JP', 'nl-NL', 'sv-SE', 'pl-PL', 'tr-TR', 'hi-IN', 'zh-CN', 'ko-KR'];
  for (const loc of formats) {
    for (const d of ['12.345', '0.925', '1234.5678', '1.5', '100', '12345678.12345678']) assert.equal(M.normalizeNumber(M.decimalToInput(d, loc), loc), d, loc + ' ' + d);
  }
});

test('numbers: typed amounts follow the locale, grouping included', () => {
  const cases = {
    'en-US': [['12.345', 'KWD', 12345], ['1,234.56', 'EUR', 123456], ['1,234.567', 'KWD', 1234567], ['0,925', 6, 925000]],
    'ja-JP': [['12.345', 'KWD', 12345], ['1,234.56', 'USD', 123456], ['1,234', 'JPY', 1234]],
    'es-ES': [['12,345', 'KWD', 12345], ['1.234,56', 'EUR', 123456], ['1.234,567', 'KWD', 1234567], ['0,925', 6, 925000], ['0.925', 6, 925000]],
    'pt-BR': [['12,345', 'KWD', 12345], ['1.234,56', 'BRL', 123456], ['10,125', 4, 101250]],
    'fr-FR': [['12,345', 'KWD', 12345], ['1 234,56', 'EUR', 123456], ['1\u202f234,56', 'EUR', 123456], ['1\u00a0234,56', 'EUR', 123456]]
  };
  for (const [loc, list] of Object.entries(cases)) withLocale(loc, () => {
    for (const [text, ccy, minor] of list) assert.equal(EN.minorFromTyped(M.normalizeNumber(text, loc), ccy), minor, loc + ' ' + text);
  });
  assert.equal(M.normalizeNumber('1.234', 'es-ES'), '1234');
  assert.equal(M.normalizeNumber('1,234', 'en-US'), '1234');
});

test('numbers: exchange rates prefill in the locale and survive an edit', () => {
  for (const loc of NUM_LOCALES) withLocale(loc, () => {
    const pre = M.trimDecimal(M.minorToDecimal(925000, 6));
    assert.equal(pre, '0.925');
    assert.equal(EN.minorFromTyped(pre, 6), 925000);
    const shown = M.decimalToInput(pre, loc);
    assert.equal(shown, commaLocale(loc) ? '0,925' : '0.925');
    const edited = shown.slice(0, -1) + '6';
    const rate = EN.minorFromTyped(M.normalizeNumber(edited, loc), 6);
    assert.equal(rate, 926000, loc);
    assert.equal(M.convertMinor(1000, 'USD', 'EUR', rate), 926);
  });
  assert.equal(M.trimDecimal('100.0000'), '100');
  assert.equal(M.trimDecimal('1.000000'), '1');
  assert.equal(M.trimDecimal('120'), '120');
});

test('numbers: rates and quantities display in the locale', () => {
  const want = { 'en-US': ['0.925', '1,234,567.5'], 'ja-JP': ['0.925', '1,234,567.5'], 'es-ES': ['0,925', '1.234.567,5'], 'pt-BR': ['0,925', '1.234.567,5'], 'fr-FR': ['0,925', '1\u202f234\u202f567,5'] };
  for (const [loc, [small, big]] of Object.entries(want)) {
    assert.equal(M.formatDecimal('0.925', loc), small, loc);
    assert.equal(M.formatDecimal('1234567.5', loc), big, loc);
  }
});

test('numbers: investment quantity and price survive editing in every locale', () => {
  for (const loc of NUM_LOCALES) withLocale(loc, () => {
    for (const [q, scale] of [[101250, 4], [12345678, 4], [12345678, 8], [10000, 4], [1, 8]]) {
      const shown = VI.numberInput(q, scale);
      assert.equal(VI.numberFromInput(shown, scale), q, loc + ' qty ' + shown);
    }
    const qty = VI.numberInput(101250, 4);
    const price = VI.numberInput(456780, 4);
    assert.equal(qty, commaLocale(loc) ? '10,125' : '10.125');
    assert.equal(price, commaLocale(loc) ? '45,678' : '45.678');
    assert.equal(M.qtyTimesPrice(VI.numberFromInput(qty, 4), 4, VI.numberFromInput(price, 4), 2), 46249);
  });
  withLocale('es-ES', () => assert.equal(VI.numberFromInput('1.234,5', 4), 12345000));
  withLocale('pt-BR', () => assert.equal(VI.numberFromInput('1.234,5', 4), 12345000));
  withLocale('fr-FR', () => assert.equal(VI.numberFromInput('1 234,5', 4), 12345000));
  withLocale('en-US', () => assert.equal(VI.numberFromInput('1,234.5', 4), 12345000));
  withLocale('ja-JP', () => assert.equal(VI.numberFromInput('1,234.5', 4), 12345000));
});

test('numbers: a typed minus sign makes a balance negative', () => {
  withLocale('en-US', () => {
    assert.equal(VA.signedAmount('-500', 'USD', false), -50000);
    assert.equal(VA.signedAmount('500', 'USD', true), -50000);
    assert.equal(VA.signedAmount('-500', 'USD', true), -50000);
    assert.equal(VA.signedAmount('500', 'USD', false), 50000);
    assert.equal(VA.signedAmount('abc', 'USD', false), null);
  });
  withLocale('es-ES', () => assert.equal(VA.signedAmount('-1.234,56', 'EUR', false), -123456));
  withLocale('fr-FR', () => assert.equal(VA.signedAmount('-1 234,56', 'EUR', false), -123456));
});

test('numbers: deleting an account also removes its bills', () => {
  const L0 = { schedules: () => [{ id: 's1', account: 'card' }, { id: 's2', account: 'cash' }, { id: 's3', account: 'card', active: false }] };
  const ctx = { ledger: L0, remove: (e, id) => [{ e, id, f: '~' }] };
  assert.deepEqual(VA.accountBills(L0, 'card').map((s) => s.id), ['s1', 's3']);
  assert.deepEqual(VA.deleteAccountOps(ctx, 'card').map((o) => o.e + ':' + o.id), ['account:card', 'schedule:s1', 'schedule:s3']);
  assert.deepEqual(VA.deleteAccountOps(ctx, 'other').map((o) => o.e + ':' + o.id), ['account:other']);
});

test('numbers: switching the main currency converts budgets and limits', () => {
  const usdInr = Math.round(1e12 / 12000);
  const L0 = {
    today: () => '2026-10-03',
    settings: () => ({ buffer_minor: 100000, confirm_above_minor: 5000 }),
    rateE6: (from, to) => (from === 'USD' && to === 'INR' ? usdInr : null),
    list: (e) => ({
      category: [{ id: 'groc', budget_default_minor: 50000 }, { id: 'none', budget_default_minor: null }],
      budget: [{ id: 'groc:2026-09', month: '2026-09', amount_minor: 40000 }],
      goal: [{ id: 'g', target_minor: 1000000, saved_minor: 0 }],
      planned_change: [{ id: 'p', change_kind: 'absolute', value: -20000 }, { id: 'q', change_kind: 'percent', value: 1000 }]
    }[e] || [])
  };
  const out = VS.rebaseLimits(L0, 'USD', 'INR');
  assert.equal(out.missing, 0);
  assert.deepEqual(out.settings, { buffer_minor: 8333333, confirm_above_minor: 416667 });
  const rec = Object.fromEntries(out.records.map(([e, id, f]) => [e + ':' + id, f]));
  assert.deepEqual(rec['category:groc'], { budget_default_minor: 4166667 });
  assert.deepEqual(rec['budget:groc:2026-09'], { amount_minor: 3333333 });
  assert.deepEqual(rec['goal:g'], { target_minor: 83333333, saved_minor: 0 });
  assert.deepEqual(rec['planned_change:p'], { value: -1666667 });
  assert.equal(rec['planned_change:q'], undefined);
  assert.equal(rec['category:none'], undefined);
  const spent = -M.convertMinor(-10000, 'USD', 'INR', usdInr);
  assert.equal(Math.round((spent / rec['category:groc'].budget_default_minor) * 100), 20);
  const none = VS.rebaseLimits(Object.assign({}, L0, { rateE6: () => null }), 'USD', 'INR');
  assert.ok(none.missing > 0);
  assert.equal(none.settings.buffer_minor, 100000);
});

test('numbers: XIRR gives no yearly figure for same-day flows', () => {
  assert.throws(() => V.xirr([{ date: '2026-10-03', amount: -46249 }, { date: '2026-10-03', amount: 46249 }]));
  const hs = V.holdingsFor({ instruments: [{ id: 'i', name: 'Fondo', currency: 'EUR', qty_scale: 4 }], accounts: [{ id: 'b', currency: 'EUR' }], prices: [], activities: [{ id: 'a', date: '2026-10-03', type: 'buy', account: 'b', instrument: 'i', qty: 101250, price_e4: 456780, amount_minor: 46249 }] }, '2026-10-03');
  assert.equal(hs[0].value, 46249);
  assert.equal(hs[0].xirr, null);
  assert.ok(Math.abs(V.xirr([{ date: '2026-10-02', amount: -1000 }, { date: '2026-10-03', amount: 1000 }])) < 1e-9);
});

test('dates: month math clamps and never drifts', () => {
  assert.equal(D.addMonths('2024-01-31', 1), '2024-02-29');
  assert.equal(D.addMonths('2023-01-31', 1), '2023-02-28');
  assert.equal(D.addMonths('2024-01-31', 2), '2024-03-31');
  assert.equal(D.addMonths('2024-03-15', -3), '2023-12-15');
  assert.equal(D.addMonthKey('2024-12', 1), '2025-01');
  assert.equal(D.diffDays('2024-02-28', '2024-03-01'), 2);
});

test('dates: monthly recurrence anchored on the 31st', () => {
  const rule = { freq: 'month', interval: 1, by_month_day: 31 };
  const occ = D.occurrences(rule, '2024-01-31', '2024-01-01', '2024-06-30');
  assert.deepEqual(occ, ['2024-01-31', '2024-02-29', '2024-03-31', '2024-04-30', '2024-05-31', '2024-06-30']);
  const last = D.occurrences({ freq: 'month', interval: 1, by_month_day: -1 }, '2023-02-28', '2023-02-01', '2023-05-31');
  assert.deepEqual(last, ['2023-02-28', '2023-03-31', '2023-04-30', '2023-05-31']);
});

test('dates: weekend shift, weekly and yearly rules', () => {
  assert.equal(D.shiftWeekend('2024-06-01', 'before'), '2024-05-31');
  assert.equal(D.shiftWeekend('2024-06-02', 'after'), '2024-06-03');
  assert.deepEqual(D.occurrences({ freq: 'week', interval: 2 }, '2024-01-01', '2024-01-01', '2024-02-01'), ['2024-01-01', '2024-01-15', '2024-01-29']);
  assert.deepEqual(D.occurrences({ freq: 'year', interval: 1 }, '2020-02-29', '2020-01-01', '2024-12-31'), ['2020-02-29', '2021-02-28', '2022-02-28', '2023-02-28', '2024-02-29']);
  assert.equal(D.nextOccurrence({ freq: 'month', interval: 1 }, '2024-01-15', '2024-03-15'), '2024-04-15');
  assert.deepEqual(D.occurrences({ freq: 'month' }, '2024-01-10', '2024-01-01', '2024-12-31', { mode: 'count', n: 3 }), ['2024-01-10', '2024-02-10', '2024-03-10']);
});

test('dates: loose parsing', () => {
  assert.equal(D.parseDateLoose('2024-03-05'), '2024-03-05');
  assert.equal(D.parseDateLoose('05/03/2024', { dayFirst: true }), '2024-03-05');
  assert.equal(D.parseDateLoose('05/03/2024', { dayFirst: false }), '2024-05-03');
  assert.equal(D.parseDateLoose('20240305'), '2024-03-05');
  assert.equal(D.parseDateLoose('5 Mar 2024'), '2024-03-05');
  assert.equal(D.parseDateLoose('Mar 5, 2024'), '2024-03-05');
  assert.equal(D.parseDateLoose('45356'), '2024-03-05');
  assert.equal(D.parseDateLoose('31/02/2024', { dayFirst: true }), null);
});

test('hlc: monotonic and drift guard', () => {
  let now = 1_700_000_000_000;
  const c = L.createClock('0123456789abcdef', () => now);
  const a = c.send();
  const b = c.send();
  assert.ok(b > a);
  assert.equal(a.length, 46);
  c.observe(L.hlcString(now + 1000, 3, 'fedcba9876543210'));
  const d = c.send();
  assert.ok(d > L.hlcString(now + 1000, 3, 'fedcba9876543210'));
  c.observe(L.hlcString(now + 10 * 60 * 1000, 0, 'fedcba9876543210'));
  assert.throws(() => c.send(), L.ClockDriftError);
  now += 10 * 60 * 1000;
  assert.ok(c.send());
});

function genOps(r, node, n, ids, start) {
  let now = start;
  const clock = L.createClock(node, () => now);
  const out = [];
  const fields = ['name', 'amount_minor', 'note', 'tags', 'category'];
  for (let i = 0; i < n; i++) {
    now += Math.floor(r() * 3000);
    const id = ids[Math.floor(r() * ids.length)];
    const k = r();
    if (k < 0.15) out.push({ t: clock.send(), e: 'transaction', id, f: '*', v: { name: 'n' + i, amount_minor: Math.floor(r() * 1e5) } });
    else if (k < 0.2) out.push({ t: clock.send(), e: 'transaction', id, f: '~', v: null });
    else {
      const f = fields[Math.floor(r() * fields.length)];
      const v = f === 'tags' ? ['a' + Math.floor(r() * 3)] : f === 'amount_minor' ? Math.floor(r() * 1e5) : node.slice(0, 3) + i;
      out.push({ t: clock.send(), e: 'transaction', id, f, v });
    }
  }
  return out;
}

function shuffle(r, list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

test('oplog: three devices converge in any order', async () => {
  for (let round = 0; round < 25; round++) {
    const r = rng(1000 + round);
    const ids = Array.from({ length: 12 }, (_, i) => 'id' + i);
    const base = 1_700_000_000_000;
    const all = [].concat(genOps(r, 'aaaaaaaaaaaaaaaa', 350, ids, base), genOps(r, 'bbbbbbbbbbbbbbbb', 350, ids, base + 500), genOps(r, 'cccccccccccccccc', 300, ids, base + 900));
    const hashes = new Set();
    for (let k = 0; k < 3; k++) {
      const s = L.createState();
      L.applyOps(s, shuffle(r, all));
      L.applyOps(s, shuffle(r, all).slice(0, 200));
      hashes.add(await L.stateHash(s));
    }
    assert.equal(hashes.size, 1, 'round ' + round);
  }
});

test('oplog: snapshot merge then late op still wins its field', async () => {
  const r = rng(42);
  const ids = ['x', 'y', 'z'];
  const base = 1_700_000_000_000;
  const a = genOps(r, 'aaaaaaaaaaaaaaaa', 200, ids, base);
  const b = genOps(r, 'bbbbbbbbbbbbbbbb', 200, ids, base + 100);
  const late = { t: L.hlcString(base + 10_000_000, 0, 'cccccccccccccccc'), e: 'transaction', id: 'x', f: 'note', v: 'late' };
  const full = L.createState();
  L.applyOps(full, a.concat(b, [late]));
  const s1 = L.createState();
  L.applyOps(s1, a);
  const snap = JSON.parse(JSON.stringify(L.snapshot(s1)));
  const s2 = L.createState();
  L.applyOps(s2, b);
  L.mergeSnapshot(s2, snap);
  L.applyOp(s2, late);
  assert.equal(await L.stateHash(s2), await L.stateHash(full));
  const x = L.get(full, 'transaction', 'x');
  if (x) assert.equal(x.note, 'late');
});

test('oplog: rejects hostile ops and logs concurrent losers', () => {
  const s = L.createState();
  const t0 = L.hlcString(1_699_999_999_000, 0, 'aaaaaaaaaaaaaaaa');
  const t1 = L.hlcString(1_700_000_000_000, 0, 'aaaaaaaaaaaaaaaa');
  const t2 = L.hlcString(1_700_000_001_000, 0, 'bbbbbbbbbbbbbbbb');
  assert.equal(L.applyOp(s, { t: t1, e: 'account', id: '__proto__', f: 'name', v: 'x' }), false);
  assert.equal(L.applyOp(s, { t: t1, e: 'account', id: 'a', f: '*', v: JSON.parse('{"__proto__":1,"name":"x"}') }), false);
  assert.equal(L.applyOp(s, { t: 'bad', e: 'account', id: 'a', f: 'name', v: 'x' }), false);
  assert.equal(L.applyOp(s, { t: t0, e: 'account', id: 'a', f: '*', v: { name: 'x' } }), true);
  L.applyOp(s, { t: t2, e: 'account', id: 'a', f: 'name', v: 'B' });
  assert.equal(s.conflicts.length, 0);
  L.applyOp(s, { t: t1, e: 'account', id: 'a', f: 'name', v: 'A' });
  assert.equal(L.get(s, 'account', 'a').name, 'B');
  assert.equal(s.conflicts.length, 1);
  assert.equal(s.conflicts[0].lose.v, 'A');
});

test('oplog: device records from pairing merge without conflicts', () => {
  const s = L.createState();
  const phone = 'bbbbbbbbbbbbbbbb';
  const hostT = L.hlcString(1_700_000_000_000, 0, 'aaaaaaaaaaaaaaaa');
  const phoneT = L.hlcString(1_700_000_000_020, 0, phone);
  L.applyOp(s, { t: phoneT, e: 'device', id: phone, f: '*', v: { name: 'Android · Chrome', platform: 'Linux armv8l', created: 'b', last_seen: 'b' } });
  L.applyOp(s, { t: hostT, e: 'device', id: phone, f: '*', v: { name: 'Android · Chrome', created: 'a', last_seen: 'a', platform: '' } });
  assert.equal(s.conflicts.length, 0);
  assert.equal(L.get(s, 'device', phone).platform, 'Linux armv8l');
  L.applyOp(s, { t: phoneT, e: 'account', id: 'a', f: '*', v: { name: 'B' } });
  L.applyOp(s, { t: hostT, e: 'account', id: 'a', f: '*', v: { name: 'A' } });
  assert.equal(s.conflicts.length, 1);
  const stored = [{ e: 'device', id: phone, f: 'platform', win: { v: 'x', t: phoneT }, lose: { v: '', t: hostT } }, s.conflicts[0]];
  assert.deepEqual(L.userConflicts(stored).map((c) => c.e), ['account']);
  const merged = L.createState();
  L.mergeSnapshot(merged, { v: 1, recs: [], conflicts: stored });
  assert.deepEqual(merged.conflicts.map((c) => c.e), ['account']);
});

test('crypto: page seal/open with AAD binding', async () => {
  const root = C.randomBytes(32);
  const keys = await C.deriveKeys(root);
  const ops = [{ t: L.hlcString(1_700_000_000_000, 0, 'aaaaaaaaaaaaaaaa'), e: 'account', id: 'a', f: 'name', v: 'Cash' }];
  const head = { id: 'p1', kind: 'ops', device: 'aaaaaaaaaaaaaaaa', seq: 1, created: 'x', n: 1 };
  const page = await E.sealPage(keys.dek, head, ops);
  assert.deepEqual(await E.openPage(keys.dek, page), ops);
  await assert.rejects(E.openPage(keys.dek, Object.assign({}, page, { seq: 2 })));
  const other = await C.deriveKeys(C.randomBytes(32));
  await assert.rejects(E.openPage(other.dek, page));
  const wire = E.pageFromWire(JSON.parse(JSON.stringify(E.pageToWire(page))));
  assert.deepEqual(await E.openPage(keys.dek, wire), ops);
  assert.equal(keys.kcv, (await C.deriveKeys(root)).kcv);
});

test('crypto: wraps unwrap the root', async () => {
  const root = C.randomBytes(32);
  const pass = await C.makePassWrap(root, 'correct horse battery', 2000);
  assert.deepEqual(await C.openPassWrap(pass, 'correct horse battery'), root);
  await assert.rejects(C.openPassWrap(pass, 'wrong horse battery'));
  const code = C.newRecoveryCode();
  assert.match(code, /^[A-Z2-7]{4}(-[A-Z2-7]{4}){7}$/);
  const rec = await C.makeRecoveryWrap(root, code);
  assert.deepEqual(await C.openRecoveryWrap(rec, code.toLowerCase().replace(/-/g, ' ')), root);
  const dev = await C.makeDeviceWrap(root);
  assert.deepEqual(await C.openDeviceWrap(dev), root);
  const keys = await C.deriveKeys(root);
  const inbox = await C.newInboxKeys(keys.inboxWrap);
  const sealed = await C.sealToInbox(inbox.pub, { amount: '4.50', note: 'coffee' });
  const opened = await C.openInbox(keys.inboxWrap, inbox.sealed, [{ id: 'i1', box: sealed }]);
  assert.deepEqual(opened[0].value, { amount: '4.50', note: 'coffee' });
  const p1 = await C.pairDerive('ABCD-EFGH-IJKL-MNOP');
  const p2 = await C.pairDerive('abcdefghijklmnop');
  assert.equal(p1.roomId, p2.roomId);
  assert.equal(p1.confirm, p2.confirm);
});

test('engine: peer summary bookkeeping', () => {
  const summary = { covers: { aaaaaaaaaaaaaaaa: 5 }, extra: { aaaaaaaaaaaaaaaa: [[7, 9]], bbbbbbbbbbbbbbbb: [[1, 2]] } };
  assert.equal(E.Engine.peerHas(summary, 'aaaaaaaaaaaaaaaa', 4), true);
  assert.equal(E.Engine.peerHas(summary, 'aaaaaaaaaaaaaaaa', 6), false);
  assert.equal(E.Engine.peerHas(summary, 'aaaaaaaaaaaaaaaa', 8), true);
  assert.equal(E.Engine.peerContig(summary, 'aaaaaaaaaaaaaaaa'), 5);
  assert.equal(E.Engine.peerContig(summary, 'bbbbbbbbbbbbbbbb'), 2);
});

test('import: CSV in four number and date styles', () => {
  const us = I.parseCsv('Date,Description,Amount,Balance\n03/05/2024,"STARBUCKS #123, SEATTLE",-4.50,"1,234.56"\n03/06/2024,PAYROLL ACME,"2,500.00","3,734.56"\n');
  assert.equal(us.delimiter, ',');
  const hi = I.guessHeader(us.rows);
  assert.equal(hi, 0);
  const roles = I.guessRoles(us.rows[0]);
  assert.equal(roles.date, 0); assert.equal(roles.payee, 1); assert.equal(roles.amount, 2); assert.equal(roles.balance, 3);
  const r1 = I.csvToRows(us.rows, { headerIdx: 0, roles, mode: 'amount', dayFirst: false, numberStyle: I.detectNumberStyle(['-4.50', '2,500.00']) });
  assert.deepEqual(r1.items.map((x) => [x.date, x.amount]), [['2024-03-05', '-4.50'], ['2024-03-06', '2500.00']]);
  const de = I.parseCsv('Buchungstag;Verwendungszweck;Betrag\n05.03.2024;REWE Markt;-1.234,56\n06.03.2024;Gehalt;2.500,00\n');
  assert.equal(de.delimiter, ';');
  const rde = I.guessRoles(de.rows[0]);
  const st = I.detectNumberStyle(['-1.234,56', '2.500,00']);
  assert.deepEqual(st, { group: '.', decimal: ',' });
  const r2 = I.csvToRows(de.rows, { headerIdx: 0, roles: rde, mode: 'amount', dayFirst: true, numberStyle: st });
  assert.deepEqual(r2.items.map((x) => [x.date, x.amount]), [['2024-03-05', '-1234.56'], ['2024-03-06', '2500.00']]);
  const inr = I.parseCsv('Txn Date\tNarration\tWithdrawal Amt\tDeposit Amt\n05/03/24\tUPI-SWIGGY-1234567890\t450.00\t\n06/03/24\tNEFT SALARY\t\t"1,00,000.00"\n');
  assert.equal(inr.delimiter, '\t');
  const rin = I.guessRoles(inr.rows[0]);
  assert.equal(rin.debit, 2); assert.equal(rin.credit, 3);
  const r3 = I.csvToRows(inr.rows, { headerIdx: 0, roles: rin, mode: 'debitcredit', dayFirst: true, numberStyle: null });
  assert.deepEqual(r3.items.map((x) => [x.date, x.amount]), [['2024-03-05', '-450.00'], ['2024-03-06', '100000.00']]);
  const fr = I.parseCsv('Date;Libellé;Montant;Sens\n2024-03-05;CARTE MONOPRIX;1 234,56;D\n2024-03-06;VIR SALAIRE;2 500,00;C\n');
  const rfr = I.guessRoles(fr.rows[0]);
  rfr.drcr = 3;
  const r4 = I.csvToRows(fr.rows, { headerIdx: 0, roles: rfr, mode: 'drcr', dayFirst: true, numberStyle: { group: ' ', decimal: ',' } });
  assert.deepEqual(r4.items.map((x) => [x.date, x.amount]), [['2024-03-05', '-1234.56'], ['2024-03-06', '2500.00']]);
});

test('import: OFX SGML and QIF', () => {
  const ofx = 'OFXHEADER:100\nDATA:OFXSGML\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>EUR<BANKTRANLIST>\n<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20240305120000[0:GMT]<TRNAMT>-12.50<FITID>A1<NAME>CAFE &amp; CO\n</STMTTRN><STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20240306<TRNAMT>100.00<FITID>A2<NAME>REFUND\n</STMTTRN></BANKTRANLIST><LEDGERBAL><BALAMT>87.50</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>';
  assert.equal(I.detectFormat(ofx, 'x.ofx'), 'ofx');
  const o = I.parseOfx(ofx);
  assert.equal(o.currency, 'EUR');
  assert.deepEqual(o.items.map((x) => [x.date, x.amount, x.ref, x.payee]), [['2024-03-05', '-12.50', 'A1', 'Cafe & CO'], ['2024-03-06', '100.00', 'A2', 'Refund']]);
  const qif = '!Type:Bank\nD03/05/2024\nT-4.50\nPCoffee shop\n^\nD03/06/2024\nT1,000.00\nPSalary\nLIncome\n^\n';
  assert.equal(I.detectFormat(qif, 'x.qif'), 'qif');
  const q = I.parseQif(qif, false);
  assert.deepEqual(q.items.map((x) => [x.date, x.amount, x.payee]), [['2024-03-05', '-4.50', 'Coffee shop'], ['2024-03-06', '1000.00', 'Salary']]);
});

test('import: payee names are cleaned', () => {
  assert.equal(I.cleanPayee('NETFLIX.COM 866-579-7172'), 'Netflix');
  assert.equal(I.cleanPayee('POS 4111XXXXXXXX1111 STARBUCKS 03/05'), 'Starbucks');
  assert.equal(I.cleanPayee('NEFT/HDFC0001234/ACME LTD'), 'Acme Ltd');
  assert.equal(I.cleanPayee('UPI-SWIGGY-1234567890'), 'Swiggy');
  assert.equal(I.cleanPayee('Café de Flore'), 'Café de Flore');
  assert.equal(I.cleanPayee('ACME CORP DES:PAYROLL ID:XXXXX12345 INDN:SMITH,JANE CO ID:XXXXX67890 PPD'), 'Acme Corp');
  assert.equal(I.cleanPayee('ACME CORP PAYROLL      PPD ID: 9876543210'), 'Acme Corp Payroll');
  assert.equal(I.cleanPayee('PURCHASE AUTHORIZED ON 09/29 STARBUCKS STORE 12345 SAN FRANCISCO CA S386272823158932 CARD 9081'), 'Starbucks Store San Francisco CA');
  assert.equal(I.cleanPayee('ZELLE PAYMENT TO JOHN SMITH JPM99A1B2C3D'), 'Zelle TO John Smith');
  assert.equal(I.cleanPayee('AMAZON MKTPL*TQ4RA1B22'), 'Amazon Mktpl');
  assert.equal(I.cleanPayee('Zelle payment to LANDLORD LLC Conf# k8fj2m3n4'), 'Zelle to Landlord Llc');
  assert.equal(I.cleanPayee('Online Transfer to SAV ...4321 transaction#: 12345678901'), 'Online Transfer to Sav');
  assert.equal(I.cleanPayee('UPI/628112345679/Payment from Ph/swiggy.stores@ic/ICICI Bank'), 'Swiggy Stores');
  assert.equal(I.cleanPayee('UPI/628012345678/RENT AUGUST/ramesh.k@okicici/ICICI Bank'), 'Ramesh K');
  assert.equal(I.cleanPayee('NEFT-ACMEIN0001-ACME SOFTWARE PVT LTD'), 'Acme Software Pvt Ltd');
  assert.equal(I.cleanPayee('UPI/P2M/624812345678/SWIGGY/Payment'), 'Swiggy');
  assert.equal(I.cleanPayee('Coca-Cola 1234'), 'Coca-Cola');
});

const FIXTURES = resolve(here, 'fixtures/finance-import');

function statementText(name) {
  const buf = readFileSync(resolve(FIXTURES, name));
  const text = new TextDecoder('utf-8').decode(buf);
  return text.slice(0, 4000).includes(String.fromCharCode(0xfffd)) ? new TextDecoder('windows-1252').decode(buf) : text;
}

function importStatement(name, locale) {
  const text = statementText(name);
  const format = I.detectFormat(text, name);
  const dayFirst = D.dayFirstFor(locale);
  if (format === 'ofx') return { res: I.parseOfx(text), rows: (text.match(/<STMTTRN>/gi) || []).length };
  if (format === 'qif') return { res: I.parseQif(text, I.qifDayFirst(text, dayFirst)), rows: text.split(/\r?\n/).filter((l) => /^D/.test(l.trim())).length };
  if (format === 'camt') return typeof DOMParser === 'undefined' ? null : { res: I.parseCamt(text), rows: (text.match(/<Ntry>/g) || []).length };
  const csv = I.parseCsv(text);
  const g = I.guessCsvSetup(csv.rows, dayFirst);
  const res = I.csvToRows(csv.rows, { headerIdx: g.headerIdx, roles: g.roles, mode: g.mode, dayFirst: g.dayFirst, numberStyle: g.numberStyle, locale });
  return { res, rows: csv.rows.slice(g.headerIdx + 1).filter((r) => r.some((c) => String(c || '').trim())).length };
}

test('import: real-world statements import exactly in en-US and en-IN', () => {
  const expected = JSON.parse(readFileSync(resolve(FIXTURES, 'expected.json'), 'utf8'));
  let checked = 0;
  for (const locale of ['en-US', 'en-IN']) {
    for (const [name, want] of Object.entries(expected)) {
      const r = importStatement(name, locale);
      if (!r) continue;
      const got = r.res.items.map((x) => x.date + ' ' + M.toMinor(x.amount, 2)).sort();
      assert.deepEqual(got, want.map(([date, minor]) => date + ' ' + minor).sort(), locale + ' ' + name);
      assert.equal(r.res.items.length + r.res.errors.length, r.rows, locale + ' ' + name + ': every row is imported or listed as skipped');
      checked++;
    }
  }
  assert.ok(checked >= 32, 'checked ' + checked);
});

test('import: Type and Dr/Cr columns, payee and date columns are guessed from the data', () => {
  const chase = I.parseCsv('Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #\nDEBIT,09/30/2026,"ZELLE PAYMENT TO JOHN SMITH",-45.00,QUICKPAY_DEBIT,3105.82,,\nCREDIT,09/30/2026,ACME PAYROLL,2850.00,ACH_CREDIT,3150.82,,\n');
  const g = I.guessCsvSetup(chase.rows, true);
  assert.deepEqual([g.mode, g.roles.payee, g.roles.drcr, g.dayFirst], ['amount', 2, undefined, false]);
  const typed = I.csvToRows(chase.rows, { headerIdx: 0, roles: Object.assign({}, g.roles, { drcr: 4 }), mode: 'drcr', dayFirst: false });
  assert.deepEqual(typed.items.map((x) => x.amount), ['-45.00', '2850.00']);
  assert.deepEqual(['Dr.', 'CR', 'Soll', 'H', 'Sale', 'DEBIT_CARD', ''].map(I.flagSign), [-1, 1, -1, 1, 0, 0, 0]);
  const kotak = I.parseCsv('Sl. No.,Date,Description,Chq / Ref number,Amount,Dr / Cr,Balance,Dr / Cr\n1,01-09-2026,SALARY,UTR1,"1,20,000.00",CR,"2,00,000.00",CR\n2,25-09-2026,RENT,UTR2,"32,000.00",DR,"1,68,000.00",CR\n');
  const k = I.guessCsvSetup(kotak.rows, false);
  assert.deepEqual([k.mode, k.roles.amount, k.roles.drcr, k.roles.debit, k.dayFirst], ['drcr', 4, 5, undefined, true]);
  assert.deepEqual(I.csvToRows(kotak.rows, { headerIdx: 0, roles: k.roles, mode: k.mode, dayFirst: k.dayFirst, numberStyle: k.numberStyle }).items.map((x) => x.amount), ['120000.00', '-32000.00']);
  const drcr = I.parseCsv('Date,Narration,Amount,Dr/Cr,Balance\n01/09/2026,SALARY,"1,20,000.00",Cr,"2,00,000.00"\n03/09/2026,RENT,"32,000.00",Dr,"1,68,000.00"\n');
  const dc = I.guessCsvSetup(drcr.rows, true);
  assert.deepEqual([dc.mode, dc.roles.drcr, dc.roles.debit], ['drcr', 3, undefined]);
  const revolut = I.parseCsv('Type,Product,Started Date,Completed Date,Description,Amount\nCARD_PAYMENT,Current,2026-09-01 08:12:44,2026-09-02 10:01:12,Lidl,-23.45\n');
  const rv = I.guessCsvSetup(revolut.rows, true);
  assert.deepEqual([rv.mode, rv.roles.date, rv.roles.payee, rv.roles.drcr], ['amount', 3, 4, undefined]);
  assert.equal(I.guessCsvSetup(I.parseCsv('Started Date,Description,Amount\n2026-09-01 08:12:44,Lidl,-23.45\n').rows, true).roles.date, 0);
  const wells = I.parseCsv('"09/30/2026","-4.75","*","","PURCHASE AUTHORIZED ON 09/29 STARBUCKS"\n"09/02/2026","-4.75","*","","SAFEWAY"\n');
  const w = I.guessCsvSetup(wells.rows, true);
  assert.deepEqual([w.headerIdx, w.roles.date, w.roles.amount, w.roles.payee, w.dayFirst], [-1, 0, 1, 4, false]);
  const legend = I.csvToRows(I.parseCsv('No,Date,Description,Amount\n1,01/09/2026,X,-1.00\nLegends Used in Account Statement\n').rows, { headerIdx: 0, roles: { date: 1, payee: 2, amount: 3 }, mode: 'amount', dayFirst: true });
  assert.deepEqual(legend.errors, [{ line: 3, reason: 'date', raw: 'Legends Used in Account Statement' }]);
  const hdfc = I.guessRoles(['Date', 'Narration', 'Chq./Ref.No.', 'Value Dt', 'Withdrawal Amt.', 'Deposit Amt.', 'Closing Balance']);
  assert.equal(hdfc.amount, undefined);
});

test('import: QIF reads the date order from the file and lists rows it cannot read', () => {
  const us = '!Type:Bank\nD09/02/2026\nT-23.40\nPCORNER BAKERY\n^\nD09/21/2026\nT-60.00\nPWATER\n^\n';
  assert.equal(I.qifDayFirst(us, true), false);
  assert.deepEqual(I.parseQif(us, I.qifDayFirst(us, true)).items.map((x) => x.date), ['2026-09-02', '2026-09-21']);
  assert.equal(I.qifDayFirst('!Type:Bank\nD21/09/2026\nT-60.00\n^\n', false), true);
  assert.equal(I.qifDayFirst('!Type:Bank\nD09/02/2026\nT-60.00\n^\n', true), true);
  const q = I.parseQif('!Account\nNChecking\nTBank\nDMain account\n^\n!Type:Bank\nD13/45/2026\nT-1.00\nPX\n^\nD09/02/2026\nPNO AMOUNT\n^\nD09/03/2026\nT-2.00\nPSHOP\n^\n', false);
  assert.deepEqual(q.items.map((x) => [x.date, x.amount, x.payee]), [['2026-09-03', '-2.00', 'Shop']]);
  assert.deepEqual(q.errors.map((e) => [e.line, e.reason, e.raw]), [[7, 'date', '13/45/2026'], [11, 'amount', '']]);
});

test('import: OFX rows without a date or an amount are listed as skipped', () => {
  const o = I.parseOfx('<OFX><BANKTRANLIST>\n<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20240305<TRNAMT>-1.00<FITID>A1<NAME>X\n</STMTTRN>\n<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>2024<TRNAMT>-2.00<FITID>A2<NAME>Y\n</STMTTRN>\n<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20240306<TRNAMT>0.00<FITID>A3<NAME>Z\n</STMTTRN></BANKTRANLIST></OFX>');
  assert.deepEqual(o.items.map((x) => [x.line, x.ref]), [[2, 'A1']]);
  assert.deepEqual(o.errors.map((e) => [e.line, e.reason, e.raw]), [[4, 'date', '2024'], [6, 'amount', '0.00']]);
});

test('import: rows of an undone import can be imported again, other deleted rows stay imported', async () => {
  const st = L.createState();
  const led = new LG.Ledger({ state: st });
  let ms = Date.UTC(2026, 9, 1);
  const op = (id, f, v) => ({ t: L.hlcString(ms++, 0, 'a1b2c3d4e5f60718'), e: 'transaction', id, f, v });
  const items = [{ date: '2026-09-02', amount: '-23.40', memo: 'CORNER BAKERY', ref: '' }, { date: '2026-09-03', amount: '-9.99', memo: 'ICLOUD', ref: 'R9' }];
  const undone = () => {
    const live = new Set(led.list('transaction').map((x) => x.import_batch).filter(Boolean));
    return (id) => { const gone = led.removed('transaction', id); return !!(gone && gone.import_batch && !live.has(gone.import_batch)); };
  };
  const ids = async () => { const seen = new Set(); const pred = undone(); const out = []; for (const it of items) out.push(await I.importId('acct', it, seen, pred)); return out; };
  const first = await ids();
  assert.deepEqual(first, [await I.itemId('acct', items[0], new Set()), await I.itemId('acct', items[1], new Set())]);
  L.applyOps(st, first.map((id) => op(id, '*', { amount_minor: -1, import_batch: 'b1' })));
  assert.deepEqual(await ids(), first);
  L.applyOps(st, [op(first[1], '~', null)]);
  assert.deepEqual(await ids(), first);
  assert.equal(led.removed('transaction', first[1]).import_batch, 'b1');
  assert.equal(led.removed('transaction', first[0]), null);
  L.applyOps(st, [op(first[0], '~', null)]);
  const second = await ids();
  assert.ok(second.every((id, i) => /^imp:[0-9a-f]{24}$/.test(id) && id !== first[i] && !led.known('transaction', id)));
  assert.deepEqual(await ids(), second);
  L.applyOps(st, second.map((id) => op(id, '*', { amount_minor: -1, import_batch: 'b2' })));
  assert.deepEqual(await ids(), second);
  L.applyOps(st, second.map((id) => op(id, '~', null)));
  const third = await ids();
  assert.ok(third.every((id, i) => id !== first[i] && id !== second[i] && !led.known('transaction', id)));
});

test('import: ids are stable and dedupe identical rows', async () => {
  const items = [{ date: '2024-03-05', amount: '-4.50', memo: 'COFFEE', ref: '' }, { date: '2024-03-05', amount: '-4.50', memo: 'COFFEE', ref: '' }, { date: '2024-03-06', amount: '-9', memo: 'X', ref: 'R1' }];
  const a = [];
  const s1 = new Set();
  for (const it of items) a.push(await I.itemId('acct', it, s1));
  const b = [];
  const s2 = new Set();
  for (const it of items) b.push(await I.itemId('acct', it, s2));
  assert.deepEqual(a, b);
  assert.equal(new Set(a).size, 3);
});

test('invest: XIRR matches the Excel example and survives deep losses', () => {
  const flows = [['2008-01-01', -10000], ['2008-03-01', 2750], ['2008-10-30', 4250], ['2009-02-15', 3250], ['2009-04-01', 2750]].map(([date, amount]) => ({ date, amount }));
  assert.ok(Math.abs(V.xirr(flows) - 0.373362535) < 1e-6);
  const deep = V.xirr([{ date: '2020-01-01', amount: -1000 }, { date: '2025-01-01', amount: 50 }]);
  assert.ok(deep < -0.44 && deep > -0.46);
  assert.throws(() => V.xirr([{ date: '2020-01-01', amount: 100 }]));
});

test('invest: SIP closed form and EMI', () => {
  assert.ok(Math.abs(V.sipFutureValue(1000, 0.12, 12) - 12766.5) < 0.6);
  const e = V.emi(1000000, 900, 240);
  assert.equal(e, 8997);
  const am = V.amortize({ principal_minor: 1000000, rate_bp: 900, tenure_months: 240, start: '2024-01-05' });
  assert.equal(am.rows.length, 240);
  assert.equal(am.rows[239].balance, 0);
  const req = V.requiredSip(V.sipFutureValue(1000, 0.1, 60), 0.1, 60);
  assert.ok(Math.abs(req - 1000) < 1e-6);
});

test('invest: FIFO and average lots with realized gains', () => {
  const acts = [
    { id: 'b1', date: '2023-01-10', type: 'buy', qty: 100000, amount_minor: 100000, fee_minor: 0 },
    { id: 'b2', date: '2023-06-10', type: 'buy', qty: 100000, amount_minor: 200000, fee_minor: 0 },
    { id: 's1', date: '2024-02-01', type: 'sell', qty: 150000, amount_minor: 450000, fee_minor: 0 }
  ];
  const f = V.runLots(acts, 'fifo');
  assert.equal(f.qty, 50000);
  assert.equal(f.cost, 100000);
  assert.equal(f.realized.reduce((n, r) => n + r.gain, 0), 450000 - 200000);
  assert.equal(f.realized[0].days, 387);
  const a = V.runLots(acts, 'average');
  assert.equal(a.qty, 50000);
  assert.equal(a.cost, 75000);
  assert.equal(a.realized[0].gain, 450000 - 225000);
  const split = V.runLots([{ id: 'b', date: '2023-01-01', type: 'buy', qty: 10000, amount_minor: 5000 }, { id: 'sp', date: '2023-05-01', type: 'split', split: { num: 2, den: 1 } }], 'fifo');
  assert.equal(split.qty, 20000);
  assert.equal(split.cost, 5000);
});

test('invest: deposits compound and pay out', () => {
  const fd = V.depositValue({ principal_minor: 10000000, rate_bp: 700, start: '2024-01-01', maturity: '2025-01-01', compounding: 'quarterly', payout: 'cumulative' }, '2025-01-01');
  assert.ok(Math.abs(fd.value - Math.round(10000000 * Math.pow(1 + 0.07 / 4, 4 * 366 / 365))) <= 1);
  const rd = V.depositValue({ kind: 'recurring', instalment_minor: 100000, rate_bp: 600, start: '2024-01-01', maturity: '2025-01-01', compounding: 'quarterly' }, '2024-12-31');
  assert.equal(rd.contributed, 1200000);
  assert.ok(rd.interest > 30000 && rd.interest < 45000);
});

test('nl: parses amounts, dates and payees', () => {
  const ctx = { today: '2026-10-02', locale: 'en-US', words: { today: 'today', yesterday: 'yesterday', daybefore: 'day before yesterday', tomorrow: 'tomorrow', last: 'last', income: 'salary|got paid', transfer: 'transfer', filler: 'for|at|on|from|to' }, accounts: [{ id: 'a1', name: 'Cash' }], categories: [], payees: [] };
  const a = N.parseEntry('coffee 4.50 yesterday', ctx);
  assert.equal(a.amount, '4.50'); assert.equal(a.date, '2026-10-01'); assert.equal(a.payee, 'Coffee');
  const b = N.parseEntry('Uber $12.40 on 28 Sep from Cash', ctx);
  assert.equal(b.amount, '12.40'); assert.equal(b.currency, 'USD'); assert.equal(b.date, '2026-09-28'); assert.equal(b.account, 'a1');
  const db = N.parseEntry('rent 800 day before yesterday', ctx);
  assert.equal(db.date, '2026-09-30'); assert.equal(db.payee, 'Rent');
  const c = N.parseEntry('got paid 52,000', ctx);
  assert.equal(c.income, true); assert.equal(c.amount, '52000');
  const ja = { today: '2026-10-02', locale: 'ja-JP', words: { today: '今日|きょう', yesterday: '昨日|きのう', daybefore: '一昨日|おととい', tomorrow: '明日', last: '先週', income: '給料|入金', transfer: '振替', filler: 'で|に|を' }, accounts: [{ id: 'a1', name: '現金' }], categories: [{ id: 'c1', name: '食費', kind: 'expense' }], payees: [] };
  const j1 = N.parseEntry('昨日コンビニで食費850円', ja);
  assert.equal(j1.date, '2026-10-01'); assert.equal(j1.amount, '850'); assert.equal(j1.category, 'c1');
  const j2 = N.parseEntry('一昨日現金で給料', ja);
  assert.equal(j2.date, '2026-09-30'); assert.equal(j2.account, 'a1'); assert.equal(j2.income, true);
  assert.deepEqual(N.parseAiJson('payee":"Cafe","amount":4.5}'), { payee: 'Cafe', amount: 4.5 });
  assert.deepEqual(N.parseAiJson('Sure! {"payee":"X","amount":2,}'), { payee: 'X', amount: 2 });
});

const UIFIX = {
  fs: await import('node:fs'),
  ui: await mod('ui.js'),
  ledgerView: await mod('views/ledger.js'),
  copy: (loc) => JSON.parse(UIFIX.fs.readFileSync(resolve(here, '../src/_data/i18n/' + loc + '.json'), 'utf8')).tool.finance
};

test('ui fixes: Japanese quick add keeps kana inside payee names', () => {
  const ctx = { today: '2026-10-03', locale: 'ja-JP', words: UIFIX.copy('ja').nl, accounts: [{ id: 'a1', name: '現金' }], categories: [{ id: 'c1', name: '食費', kind: 'expense' }], payees: [] };
  const want = [['とんかつ 900', 'とんかつ', '900', null], ['おにぎり 150', 'おにぎり', '150', null], ['のり弁 500 昨日', 'のり弁', '500', '2026-10-02'], ['はなまるうどん 600', 'はなまるうどん', '600', null], ['ほっともっと 480', 'ほっともっと', '480', null], ['からあげ 300', 'からあげ', '300', null], ['昨日のランチ 800', 'ランチ', '800', '2026-10-02'], ['スーパーで支払った 1200', 'スーパー', '1200', null], ['コンビニで850円', 'コンビニ', '850', null]];
  for (const [text, payee, amount, date] of want) {
    const r = N.parseEntry(text, ctx);
    assert.deepEqual([r.payee, r.amount, r.date], [payee, amount, date], text);
  }
  const j = N.parseEntry('一昨日現金で食費1,200円', ctx);
  assert.deepEqual([j.date, j.account, j.category, j.amount], ['2026-10-01', 'a1', 'c1', '1200']);
});

test('ui fixes: quick add reads amounts and dates in every locale', () => {
  const cases = [
    ['en', 'en-US', 'coffee 4.50 yesterday', ['Coffee', '4.50', null, '2026-10-02']],
    ['en', 'en-US', 'Uber $12.40 on 28 Sep', ['Uber', '12.40', 'USD', '2026-09-28']],
    ['es', 'es-ES', 'Mercadona 45,30 € anteayer', ['Mercadona', '45.30', 'EUR', '2026-10-01']],
    ['es', 'es-ES', 'gasté 20 en el super', ['Super', '20', null, null]],
    ['fr', 'fr-FR', 'boulangerie 12,40 € hier', ['Boulangerie', '12.40', 'EUR', '2026-10-02']],
    ['pt-BR', 'pt-BR', 'padaria R$ 15,90 ontem', ['Padaria', '15.90', 'BRL', '2026-10-02']],
    ['ja', 'ja-JP', 'はま寿司 1500 一昨日', ['はま寿司', '1500', null, '2026-10-01']]
  ];
  for (const [loc, locale, text, want] of cases) {
    const r = N.parseEntry(text, { today: '2026-10-03', locale, words: UIFIX.copy(loc).nl, accounts: [], categories: [], payees: [] });
    assert.deepEqual([r.payee, r.amount, r.currency, r.date], want, loc + ' ' + text);
  }
});

test('ui fixes: CSV cells that start a formula are exported as text', () => {
  const out = UIFIX.ui.csv([['=1+2', '@SUM(1,1)', '+44 20 7946 0000', '-x', '\tcmd', '-12.50', -3, '12.5%', 'plain', '=HYPERLINK("http://x.example","click")']]);
  assert.equal(out, '﻿' + "'=1+2,\"'@SUM(1,1)\",'+44 20 7946 0000,'-x,\"'\tcmd\",-12.50,-3,12.5%,plain,\"'=HYPERLINK(\"\"http://x.example\"\",\"\"click\"\")\"");
});

test('ui fixes: a Finance CSV export imports back with notes, payees and transfers', () => {
  const accounts = { cash: { id: 'cash', name: 'Cash', currency: 'USD' }, bank: { id: 'bank', name: 'Bank account', currency: 'USD' } };
  const cats = new Map([['gifts', { id: 'gifts', name: 'Gifts', kind: 'expense' }], ['salary', { id: 'salary', name: 'Salary', kind: 'income' }]]);
  const L = { base: () => 'USD', categoryMap: () => cats, get: (e, id) => (e === 'account' ? accounts[id] || null : null) };
  const row = (o) => Object.assign({ kind: 'txn', currency: 'USD', category: null, payee: '', note: '', tags: [], lines: null }, o, { base: o.amount });
  const rows = [
    row({ id: 't1', date: '2026-10-01', account: 'cash', amount: -1234, category: 'gifts', payee: 'Corner Shop', note: 'birthday, "big" one', tags: ['family', 'gift ideas'] }),
    row({ id: 't2', date: '2026-10-01', account: 'bank', amount: 250000, category: 'salary', payee: 'ACME Corp' }),
    row({ id: 't3', date: '2026-10-02', account: 'cash', amount: -99, payee: '=HYPERLINK("http://x.example","click")', note: '@SUM(1,1)' }),
    row({ kind: 'xfer', leg: 'out', id: 'x1', date: '2026-10-02', account: 'cash', other: 'bank', amount: -5000 }),
    row({ kind: 'xfer', leg: 'in', id: 'x1', date: '2026-10-02', account: 'bank', other: 'cash', amount: 5000 })
  ];
  for (const loc of ['en', 'ja']) {
    UIFIX.ui.setCopy(UIFIX.copy(loc));
    const text = UIFIX.ui.csv(UIFIX.ledgerView.exportRows(L, rows));
    assert.ok(text.includes(',-12.34,USD,') && text.includes('"\'=HYPERLINK('), loc);
    const parsed = I.parseCsv(text);
    const fin = I.financeExport(parsed.rows, UIFIX.ledgerView.csvHeader());
    assert.ok(fin && fin.shaped && fin.roles.note === 4 && fin.roles.type === 10, loc);
    const res = I.csvToRows(parsed.rows, { headerIdx: fin.headerIdx, roles: fin.roles, mode: 'amount', numberStyle: { group: ',', decimal: '.' }, finance: true, transferLabel: UIFIX.ui.t('csv.type_transfer') });
    assert.equal(res.errors.length, 0, loc);
    const got = res.items.map((x) => [x.date, x.payee, x.note, x.category, x.amount, x.transfer]);
    assert.deepEqual(got.slice(0, 3), [
      ['2026-10-01', 'Corner Shop', 'birthday, "big" one', cats.get('gifts').name, '-12.34', false],
      ['2026-10-01', 'ACME Corp', '', cats.get('salary').name, '2500.00', false],
      ['2026-10-02', '=HYPERLINK("http://x.example","click")', '@SUM(1,1)', '', '-0.99', false]
    ], loc);
    assert.deepEqual(got.slice(3).map((x) => [x[4], x[5]]), [['-50.00', true], ['50.00', true]], loc);
    assert.deepEqual(res.items[0].tags, ['family', 'gift ideas'], loc);
  }
  UIFIX.ui.setCopy(UIFIX.copy('es'));
  const es = I.parseCsv(UIFIX.ui.csv(UIFIX.ledgerView.exportRows(L, rows)));
  UIFIX.ui.setCopy(UIFIX.copy('en'));
  assert.ok(I.financeExport(es.rows, UIFIX.ledgerView.csvHeader()), 'an export from another language is still recognised');
  UIFIX.ui.setCopy({});
  const bank = I.parseCsv('Date,Description,Amount,Notes,Balance,Currency,A,B,C,D\n2024-03-05,STARBUCKS #123,-4.50,team coffee,10.00,USD,,,,\n');
  assert.equal(I.financeExport(bank.rows, []), null);
  const roles = I.guessRoles(bank.rows[0]);
  assert.equal(roles.payee, 1);
  assert.equal(roles.note, 3);
  const plain = I.csvToRows(bank.rows, { headerIdx: 0, roles, mode: 'amount', dayFirst: false });
  assert.deepEqual([plain.items[0].payee, plain.items[0].note], ['Starbucks', 'team coffee']);
  assert.equal(I.unescapeCell("'=1+2"), '=1+2');
  assert.equal(I.unescapeCell("'quoted"), "'quoted");
});

test('recurring: finds a monthly stream and ignores noise', () => {
  const rows = [];
  for (let m = 1; m <= 6; m++) rows.push({ kind: 'txn', id: 'n' + m, date: '2026-0' + m + '-0' + (m % 2 ? 5 : 6), amount: -1099, payee: 'NETFLIX.COM 8829', account: 'a', currency: 'USD' });
  rows.push({ kind: 'txn', id: 'x1', date: '2026-02-11', amount: -2000, payee: 'Random shop', account: 'a' });
  rows.push({ kind: 'txn', id: 'x2', date: '2026-05-19', amount: -3500, payee: 'Random shop', account: 'a' });
  rows.push({ kind: 'txn', id: 'x3', date: '2026-05-21', amount: -1500, payee: 'Random shop', account: 'a' });
  const s = RC.detectStreams(rows, { today: '2026-06-20' });
  assert.equal(s.length, 1);
  assert.equal(s[0].cadence, 'month');
  assert.equal(s[0].amount, 1099);
  assert.equal(s[0].state, 'active');
});

{
  const LG = await mod('ledger.js');
  const sched = (name, fn) => test('schedules and budgets: ' + name, fn);
  const ledgerOf = (recs, today) => {
    const st = L.createState();
    let now = 1_790_000_000_000;
    const clock = L.createClock('fefefefefefefefe', () => now++);
    L.applyOps(st, recs.map(([e, id, v]) => ({ t: clock.send(), e, id, f: '*', v })));
    const led = new LG.Ledger({ state: st });
    if (today) led.today = () => today;
    return led;
  };
  const bank = ['account', 'a1', { name: 'Bank', type: 'bank', currency: 'USD' }];
  const bill = (id, v) => ['schedule', id, Object.assign({ name: id, amount_minor: -1000, currency: 'USD', account: 'a1', rule: { freq: 'month', interval: 1 }, end: { mode: 'never' }, auto_post: true, active: true, created: '2026-09-01T12:00:00.000Z' }, v)];

  sched('creation stamps become local dates', () => {
    assert.equal(D.localDateOf('2026-10-04T03:30:00.000Z', 'America/Los_Angeles'), '2026-10-03');
    assert.equal(D.localDateOf('2026-11-15T03:15:00.000Z', 'America/Los_Angeles'), '2026-11-14');
    assert.equal(D.localDateOf('2026-10-02T20:30:00.000Z', 'Asia/Kolkata'), '2026-10-03');
    assert.equal(D.localDateOf('2026-10-03', 'Asia/Kolkata'), '2026-10-03');
    assert.equal(D.localDateOf('later', 'UTC'), null);
  });

  sched('a bill added in the evening west of UTC posts its first date', () => {
    const make = (tz, created, anchor, today) => {
      const led = ledgerOf([['settings', 'main', { base_currency: 'USD', time_zone: tz }], bank, bill('gym', { created, anchor })], today);
      return led.autoPostDates(led.get('schedule', 'gym'));
    };
    assert.deepEqual(make('America/Los_Angeles', '2026-10-04T03:30:00.000Z', '2026-10-03', '2026-10-04'), ['2026-10-03']);
    assert.deepEqual(make('America/Los_Angeles', '2026-11-15T03:15:00.000Z', '2026-11-14', '2026-11-16'), ['2026-11-14']);
    assert.deepEqual(make('America/Los_Angeles', '2026-10-03T17:00:00.000Z', '2026-10-03', '2026-10-04'), ['2026-10-03']);
    const early = make('Asia/Kolkata', '2026-10-02T20:30:00.000Z', '2026-10-02', '2026-10-03');
    const late = make('Asia/Kolkata', '2026-10-03T04:30:00.000Z', '2026-10-02', '2026-10-03');
    assert.deepEqual(early, []);
    assert.deepEqual(late, []);
    assert.deepEqual(make('Asia/Kolkata', '2026-10-02T20:30:00.000Z', '2026-10-03', '2026-10-03'), ['2026-10-03']);
  });

  sched('bills whose account was deleted are skipped and listed', () => {
    const led = ledgerOf([bank, bill('gym', { account: 'gone', anchor: '2026-10-05' }), bill('rent', { anchor: '2026-10-05' })], '2026-10-06');
    assert.deepEqual(led.autoPostDates(led.get('schedule', 'gym')), []);
    assert.deepEqual(led.autoPostDates(led.get('schedule', 'rent')), ['2026-10-05']);
    assert.deepEqual(led.orphanSchedules().map((s) => s.id), ['gym']);
  });

  sched('upcoming counts days from today and keeps overdue bills', () => {
    const led = ledgerOf([bank, bill('today', { anchor: '2026-10-03', auto_post: false }), bill('tomorrow', { anchor: '2026-10-04', auto_post: false }), bill('late', { anchor: '2026-09-30', auto_post: false })], '2026-10-03');
    const list = led.upcoming(60, D.addDays('2026-10-03', -7));
    const days = (id) => list.filter((u) => u.schedule.id === id).map((u) => u.days);
    assert.deepEqual(days('late'), [-3, 27, 58]);
    assert.deepEqual(days('today'), [0, 31]);
    assert.deepEqual(days('tomorrow'), [1, 32]);
    assert.deepEqual(led.upcoming(14).map((u) => [u.schedule.id, u.days]), [['today', 0], ['tomorrow', 1]]);
  });

  sched('ended bills are recognised', () => {
    const led = ledgerOf([bank, bill('course', { anchor: '2026-10-05', end: { mode: 'count', n: 2 } }), bill('phone', { anchor: '2026-10-10' }), bill('lease', { anchor: '2026-01-10', end: { mode: 'date', date: '2026-12-01' } })], '2026-12-20');
    assert.equal(led.scheduleEnded(led.get('schedule', 'course')), true);
    assert.equal(led.scheduleEnded(led.get('schedule', 'phone')), false);
    assert.equal(led.scheduleEnded(led.get('schedule', 'lease')), true);
  });

  sched('tracking a found subscription keeps its billing day', () => {
    const rows = [];
    for (let m = 2; m <= 9; m++) rows.push({ kind: 'txn', id: 'n' + m, date: '2026-0' + m + '-15', amount: -1549, payee: 'NETFLIX.COM 866-579-7172', account: 'a1', currency: 'USD' });
    const st = RC.detectStreams(rows, { today: '2026-10-18' })[0];
    assert.equal(st.next, '2026-10-15');
    assert.equal(RC.nextDue(st, '2026-10-18'), '2026-11-15');
    assert.equal(RC.nextDue(st, '2026-10-15'), '2026-10-15');
    assert.equal(RC.nextDue(st, '2026-10-01'), '2026-10-15');
    assert.equal(RC.nextDue({ next: '2026-09-07', rule: { freq: 'week', interval: 2 } }, '2026-10-03'), '2026-10-05');
  });

  sched('rollover only carries months the ledger and the budget existed', () => {
    const groceries = (extra) => ['category', 'g', Object.assign({ name: 'Groceries', kind: 'expense', group: null, rollover: true, budget_default_minor: 50000 }, extra)];
    const spend = (id, date, minor) => ['transaction', id, { date, amount_minor: -minor, base_minor: -minor, currency: 'USD', account: 'a1', category: 'g' }];
    const october = [bank, groceries({ budget_since: '2026-10' }), spend('t1', '2026-10-02', 10000)];
    assert.equal(ledgerOf(october, '2026-10-03').budgetSummary('2026-10').total, 50000);
    assert.equal(ledgerOf([bank, groceries({}), spend('t1', '2026-10-02', 10000)], '2026-10-03').budgetSummary('2026-10').total, 50000);
    assert.equal(ledgerOf(october, '2026-11-03').budgetSummary('2026-11').total, 90000);
    const history = october.concat([spend('t0', '2026-07-10', 5000)]);
    assert.equal(ledgerOf(history, '2026-10-03').budgetSummary('2026-10').total, 50000);
    const oneOff = history.concat([['budget', 'g:2026-09', { category: 'g', month: '2026-09', amount_minor: 20000 }]]);
    assert.equal(ledgerOf(oneOff, '2026-10-03').budgetSummary('2026-10').total, 70000);
    assert.equal(ledgerOf([bank, groceries({ budget_since: '2026-10' })], '2026-10-03').budgetSummary('2026-10').total, 50000);
  });

  sched('budget totals compare budgeted spending only', () => {
    const led = ledgerOf([
      bank,
      ['category', 'g', { name: 'Groceries', kind: 'expense', group: null, budget_default_minor: 50000 }],
      ['category', 'r', { name: 'Rent', kind: 'expense', group: null }],
      ['transaction', 't1', { date: '2026-10-02', amount_minor: -10000, base_minor: -10000, currency: 'USD', account: 'a1', category: 'g' }],
      ['transaction', 't2', { date: '2026-10-01', amount_minor: -150000, base_minor: -150000, currency: 'USD', account: 'a1', category: 'r' }]
    ], '2026-10-03');
    const bs = led.budgetSummary('2026-10');
    assert.deepEqual([bs.total, bs.spent, bs.expense, bs.outside], [50000, 10000, 160000, 150000]);
    assert.deepEqual(Array.from(bs.byDay.entries()), [['2026-10-02', 10000]]);
  });

  sched('a split in another currency keeps every cent', () => {
    const led = ledgerOf([
      ['account', 'eu', { name: 'Euro card', type: 'bank', currency: 'EUR' }],
      ['category', 'a', { name: 'Groceries', kind: 'expense', group: null }],
      ['category', 'b', { name: 'Household', kind: 'expense', group: null }],
      ['category', 'c', { name: 'Clothing', kind: 'expense', group: null }],
      ['transaction', 't', { date: '2026-10-02', amount_minor: -10000, base_minor: -10853, fx_rate_e6: 1085300, currency: 'EUR', account: 'eu', lines: [{ category: 'a', amount_minor: -3333 }, { category: 'b', amount_minor: -3333 }, { category: 'c', amount_minor: -3334 }] }]
    ], '2026-10-03');
    const parts = led.rowCategories(led.rows()[0]);
    assert.equal(parts.reduce((n, p) => n + p.base, 0), -10853);
    assert.equal(led.monthSummary('2026-10').expense, 10853);
    const same = ledgerOf([bank, ['transaction', 't', { date: '2026-10-02', amount_minor: -1000, base_minor: -1000, currency: 'USD', account: 'a1', lines: [{ category: 'x', amount_minor: -333 }, { category: 'y', amount_minor: -667 }] }]], '2026-10-03');
    assert.deepEqual(same.rowCategories(same.rows()[0]).map((p) => p.base), [-333, -667]);
  });
}

test('forecast: zero-volatility Monte Carlo equals the SIP closed form', () => {
  const r = F.simulateGbm({ months: 12, paths: 5, seed: 1, classes: [{ start: 0, contrib: 1000, ret: 0.12, sigma: 0 }] });
  assert.ok(Math.abs(r.fan[12].p50 - V.sipFutureValue(1000, 0.12, 12)) < 1e-6);
});

test('forecast: seeded reference run reproduces the spec numbers', () => {
  const r = F.simulateGbm({ months: 120, paths: 5000, seed: 1, classes: [{ start: 100000, contrib: 10000, ret: 0.12, sigma: 0.18 }] });
  const end = r.fan[120];
  assert.ok(Math.abs(end.p10 / 1.43e6 - 1) < 0.03, 'p10 ' + end.p10);
  assert.ok(Math.abs(end.p50 / 2.32e6 - 1) < 0.03, 'p50 ' + end.p50);
  assert.ok(Math.abs(end.p90 / 3.93e6 - 1) < 0.03, 'p90 ' + end.p90);
  const again = F.simulateGbm({ months: 120, paths: 5000, seed: 1, classes: [{ start: 100000, contrib: 10000, ret: 0.12, sigma: 0.18 }] });
  assert.equal(again.fan[120].p50, end.p50);
});

test('forecast: methods by history length behave', () => {
  assert.equal(F.forecastSeries([0, 0, 0], 3).method, 'none');
  const flat = F.forecastSeries([100, 100, 100, 100], 2);
  assert.equal(flat.method, 'median');
  assert.equal(flat.point[0], 100);
  const r = F.mulberry32(3);
  const seasonal = [];
  for (let t = 0; t < 36; t++) seasonal.push(1000 + 300 * Math.sin((2 * Math.PI * t) / 12) + 10 * t + (r() - 0.5) * 60);
  const f = F.forecastSeries(seasonal, 12);
  assert.equal(f.method, 'ses+snaive+hw');
  const truth = [];
  for (let t = 36; t < 48; t++) truth.push(1000 + 300 * Math.sin((2 * Math.PI * t) / 12) + 10 * t);
  const mae = f.point.reduce((s, v, i) => s + Math.abs(v - truth[i]), 0) / 12;
  assert.ok(mae < 160, 'mae ' + mae);
  const bt = F.backtest(seasonal, 8, 1);
  assert.ok(bt && bt.mase < 1.2, 'mase ' + (bt && bt.mase));
  const sparse = F.forecastSeries([0, 500, 0, 0, 480, 0, 0, 510, 0, 0, 0, 495], 1);
  assert.equal(sparse.method, 'intermittent');
});

test('forecast: cash bootstrap is reproducible and centred', () => {
  const opts = { start: 1000, months: 6, net: [100, 100, 100, 100, 100, 100], residuals: [[-50, 50, -20, 20]], residualMonths: 4, paths: 500, seed: 9, buffer: 0 };
  const a = F.bootstrapCash(opts);
  const b = F.bootstrapCash(opts);
  assert.deepEqual(a.fan, b.fan);
  assert.ok(Math.abs(a.fan[5].p50 - 1600) < 60);
  assert.equal(a.below[5], 0);
});

function mockLedger(o) {
  const cats = new Map([['sal', { id: 'sal', kind: 'income', income_source: 'employment' }], ['free', { id: 'free', kind: 'income', income_source: 'self_employment' }], ['taxpay', { id: 'taxpay', kind: 'expense' }]]);
  return {
    today: () => o.today, base: () => 'USD', rateE6: () => 1000000, categoryMap: () => cats,
    rows: () => o.rows || [], rowCategories: (r) => [{ category: r.category, amount: r.amount, base: r.amount }],
    investData: () => ({ instruments: o.instruments || [], activities: o.activities || [], accounts: o.accounts || [], prices: [] }),
    list: (e) => (e === 'activity' ? o.activities || [] : []), holdings: () => []
  };
}
const salaryRows = [{ kind: 'txn', date: '2025-03-01', amount: 6000000, currency: 'USD', category: 'sal', ref: {} }];
const trades = {
  instruments: [{ id: 'i1', name: 'Fund', currency: 'USD', qty_scale: 4 }],
  accounts: [{ id: 'b', currency: 'USD', lot_method: 'fifo' }],
  activities: [
    { id: 'buy', date: '2023-01-10', type: 'buy', account: 'b', instrument: 'i1', qty: 100000, amount_minor: 1000000 },
    { id: 'sell', date: '2025-06-10', type: 'sell', account: 'b', instrument: 'i1', qty: 100000, amount_minor: 2000000 }
  ]
};

test('tax: progressive brackets with allowances and a payment schedule', () => {
  const prof = T.exampleProfile(2025, 'USD');
  const est = T.estimate(mockLedger({ today: '2026-02-01', rows: salaryRows }), prof);
  assert.equal(est.income.employment, 6000000);
  assert.equal(est.taxable, 4600000);
  assert.equal(est.ordinaryTax, 100000 + 600000 + 180000);
  assert.equal(est.liability, 880000);
  assert.deepEqual(est.due.map((d) => [d.date, d.cumulative]), [['2025-04-15', 220000], ['2025-06-15', 440000], ['2025-09-15', 660000], ['2026-01-15', 880000]]);
});

test('tax: flat capital gains rate and a no-capital-gains-tax profile', () => {
  const flat = Object.assign(T.exampleProfile(2025, 'USD'), { cg: { method: 'flat', long_term_months: 12, lt_rate_bp: 2500, st_rate_bp: 2500, exemption_minor: 0, loss_offset_cap_minor: 0 } });
  const est = T.estimate(mockLedger(Object.assign({ today: '2026-02-01', rows: salaryRows }, trades)), flat);
  assert.equal(est.realized.length, 1);
  assert.equal(est.realized[0].term, 'long');
  assert.equal(est.cgTax, 250000);
  assert.equal(est.liability, 880000 + 250000);
  const none = Object.assign(T.exampleProfile(2025, 'USD'), { cg: { method: 'flat', long_term_months: 12, lt_rate_bp: 0, st_rate_bp: 0, exemption_minor: 0 } });
  assert.equal(T.estimate(mockLedger(Object.assign({ today: '2026-02-01', rows: salaryRows }, trades)), none).cgTax, 0);
});

test('tax: losses offset ordinary income up to the cap and carry forward', () => {
  const lossTrades = JSON.parse(JSON.stringify(trades));
  lossTrades.activities[1].amount_minor = 200000;
  const prof = T.exampleProfile(2025, 'USD');
  const est = T.estimate(mockLedger(Object.assign({ today: '2026-02-01', rows: salaryRows }, lossTrades)), prof);
  assert.equal(est.lossOffset, 300000);
  assert.equal(est.carryOut, 800000 - 300000);
  assert.equal(est.taxable, 4600000 - 300000);
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
