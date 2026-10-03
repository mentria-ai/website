import assert from 'node:assert/strict';
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
