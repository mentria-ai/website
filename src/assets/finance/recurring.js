import { diffDays, addDays, addMonths } from './dates.js';
import { payeeKey } from './ledger.js';

const CADENCES = [
  { id: 'week', days: 7, tol: 2, rule: { freq: 'week', interval: 1 } },
  { id: 'biweek', days: 14, tol: 3, rule: { freq: 'week', interval: 2 } },
  { id: 'month', days: 30.4, tol: 4.5, rule: { freq: 'month', interval: 1 } },
  { id: 'quarter', days: 91.3, tol: 8, rule: { freq: 'month', interval: 3 } },
  { id: 'half', days: 182.6, tol: 12, rule: { freq: 'month', interval: 6 } },
  { id: 'year', days: 365.25, tol: 15, rule: { freq: 'year', interval: 1 } }
];

function median(list) {
  const a = list.slice().sort((x, y) => x - y);
  if (!a.length) return 0;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

export function detectStreams(rows, opts) {
  const o = opts || {};
  const today = o.today;
  const groups = new Map();
  for (const r of rows) {
    if (r.kind !== 'txn' || !r.amount) continue;
    const key = payeeKey(r.payee || r.note || '');
    if (!key) continue;
    const dir = r.amount < 0 ? 'out' : 'in';
    const gk = key + '|' + dir;
    if (!groups.has(gk)) groups.set(gk, { key, dir, rows: [] });
    groups.get(gk).rows.push(r);
  }
  const out = [];
  for (const g of groups.values()) {
    const byDate = new Map();
    for (const r of g.rows) if (!byDate.has(r.date)) byDate.set(r.date, r);
    const list = Array.from(byDate.values()).sort((a, b) => (a.date < b.date ? -1 : 1));
    if (list.length < 3) continue;
    const gaps = [];
    for (let i = 1; i < list.length; i++) gaps.push(diffDays(list[i - 1].date, list[i].date));
    const med = median(gaps);
    const cad = CADENCES.find((c) => Math.abs(med - c.days) <= c.tol);
    if (!cad) continue;
    const okGaps = gaps.filter((d) => Math.abs(d - cad.days) <= Math.max(cad.tol * 1.6, cad.days * 0.22)).length;
    if (okGaps / gaps.length < 0.7) continue;
    const amounts = list.map((r) => Math.abs(r.amount));
    const amtMed = median(amounts);
    const mad = median(amounts.map((a) => Math.abs(a - amtMed)));
    const last = list[list.length - 1];
    const next = cad.rule.freq === 'week' ? addDays(last.date, 7 * cad.rule.interval) : addMonths(last.date, cad.rule.freq === 'year' ? 12 : cad.rule.interval);
    const sinceLast = today ? diffDays(last.date, today) : 0;
    const state = sinceLast <= cad.days * 1.6 + 3 ? 'active' : 'stale';
    const id = g.key + ':' + cad.id + ':' + g.dir;
    if (o.known && o.known.has(g.key)) continue;
    if (o.dismissed && o.dismissed.has(id)) continue;
    out.push({
      id, key: g.key, dir: g.dir, cadence: cad.id, rule: cad.rule, count: list.length, amount: Math.round(amtMed),
      variable: amtMed > 0 && mad / amtMed > 0.12, last: last.date, next, state,
      payee: last.payee || last.note || g.key, account: last.account, category: last.category, currency: last.currency, rows: list.map((r) => r.id)
    });
  }
  out.sort((a, b) => (a.state === b.state ? b.amount - a.amount : a.state === 'active' ? -1 : 1));
  return out;
}

export function cycleLabelKey(rule) {
  const r = rule || {};
  const i = r.interval || 1;
  if (r.freq === 'week') return i === 1 ? 'week' : i === 2 ? 'biweek' : 'nweeks';
  if (r.freq === 'day') return 'ndays';
  if (r.freq === 'year') return i === 1 ? 'year' : 'nyears';
  if (i === 1) return 'month';
  if (i === 3) return 'quarter';
  if (i === 6) return 'half';
  return 'nmonths';
}
