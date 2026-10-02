import { roundDiv, qtyTimesPrice, decimalsFor } from './money.js';
import { diffDays, addMonths, occurrences, toUTC } from './dates.js';

const DAY = 86400000;
const ADDS = new Set(['buy', 'transfer_in', 'bonus', 'dividend_reinvest']);
const REMOVES = new Set(['sell', 'transfer_out']);

function byDate(a, b) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const ka = a.type === 'split' ? 1 : ADDS.has(a.type) ? 0 : 2;
  const kb = b.type === 'split' ? 1 : ADDS.has(b.type) ? 0 : 2;
  if (ka !== kb) return ka - kb;
  return String(a.created || a.id).localeCompare(String(b.created || b.id));
}

export function runLots(activities, method, opts) {
  const o = opts || {};
  const lots = [];
  const realized = [];
  let income = 0;
  let fees = 0;
  let withheld = 0;
  const errors = [];
  const list = activities.slice().sort(byDate);
  for (const a of list) {
    const qty = Math.abs(a.qty || 0);
    const fee = Math.abs(a.fee_minor || 0);
    withheld += Math.abs(a.tax_withheld_minor || 0);
    if (a.type === 'split') {
      const num = (a.split && a.split.num) || 1;
      const den = (a.split && a.split.den) || 1;
      for (const l of lots) l.qty = roundDiv(l.qty * num, den);
      continue;
    }
    if (ADDS.has(a.type)) {
      const cost = a.type === 'bonus' ? 0 : Math.abs(a.amount_minor || 0) + fee;
      if (method === 'average' && lots.length) {
        lots[0].qty += qty;
        lots[0].cost += cost;
      } else if (qty > 0) {
        lots.push({ id: a.id, date: a.date, qty, cost });
      }
      if (a.type === 'dividend_reinvest') income += Math.abs(a.amount_minor || 0);
      fees += fee;
      continue;
    }
    if (REMOVES.has(a.type)) {
      let left = qty;
      const proceeds = a.type === 'sell' ? Math.abs(a.amount_minor || 0) - fee : 0;
      fees += fee;
      let costOut = 0;
      const parts = [];
      const take = (lot, q) => {
        const c = q === lot.qty ? lot.cost : roundDiv(lot.cost * q, lot.qty);
        lot.qty -= q;
        lot.cost -= c;
        costOut += c;
        parts.push({ lot: lot.id, date: lot.date, qty: q, cost: c });
        left -= q;
      };
      if (method === 'specific' && Array.isArray(a.lot_ref) && a.lot_ref.length) {
        for (const ref of a.lot_ref) {
          const lot = lots.find((l) => l.id === ref.lot);
          if (lot && left > 0) take(lot, Math.min(lot.qty, Math.abs(ref.qty || 0), left));
        }
      }
      for (const lot of lots) {
        if (left <= 0) break;
        if (lot.qty > 0) take(lot, Math.min(lot.qty, left));
      }
      for (let i = lots.length - 1; i >= 0; i--) if (lots[i].qty <= 0 && method !== 'average') lots.splice(i, 1);
      if (left > 0) errors.push({ id: a.id, short: left });
      if (a.type === 'sell') {
        if (method === 'average') {
          realized.push({ id: a.id, date: a.date, qty: qty - left, proceeds, cost: costOut, gain: proceeds - costOut, acquired: null, days: null });
        } else {
          let share = 0;
          parts.forEach((p, i) => {
            const pr = i === parts.length - 1 ? proceeds - share : roundDiv(proceeds * p.qty, qty - left || 1);
            share += pr;
            realized.push({ id: a.id, date: a.date, qty: p.qty, proceeds: pr, cost: p.cost, gain: pr - p.cost, acquired: p.date, days: diffDays(p.date, a.date) });
          });
        }
      }
      continue;
    }
    if (a.type === 'dividend' || a.type === 'interest') { income += Math.abs(a.amount_minor || 0); fees += fee; continue; }
    if (a.type === 'fee') { fees += Math.abs(a.amount_minor || 0) + fee; continue; }
  }
  const openLots = lots.filter((l) => l.qty > 0);
  const qty = openLots.reduce((n, l) => n + l.qty, 0);
  const cost = openLots.reduce((n, l) => n + l.cost, 0);
  return { lots: openLots, qty, cost, realized, income, fees, withheld, errors, asOf: o.asOf || null };
}

export function priceOn(instrument, prices, activities, date) {
  let best = null;
  for (const p of prices) {
    if (p.instrument !== instrument.id || p.date > date) continue;
    if (!best || p.date > best.date) best = { date: p.date, price_e4: p.price_e4, source: p.source || 'manual' };
  }
  if (instrument.manual_price_e4 && (!best || (instrument.manual_price_date || '') > best.date) && (instrument.manual_price_date || '') <= date) {
    best = { date: instrument.manual_price_date || date, price_e4: instrument.manual_price_e4, source: 'manual' };
  }
  if (!best) {
    for (const a of activities) {
      if (a.instrument !== instrument.id || !a.price_e4 || a.date > date) continue;
      if (!best || a.date > best.date) best = { date: a.date, price_e4: a.price_e4, source: 'trade' };
    }
  }
  if (best) best.carried = diffDays(best.date, date) > 4;
  return best;
}

export function holdingsFor(data, date) {
  const insts = new Map(data.instruments.map((i) => [i.id, i]));
  const groups = new Map();
  for (const a of data.activities) {
    if (!a.instrument || !insts.has(a.instrument)) continue;
    if (date && a.date > date) continue;
    const key = a.account + '|' + a.instrument;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(a);
  }
  const accounts = new Map(data.accounts.map((a) => [a.id, a]));
  const out = [];
  for (const [key, acts] of groups) {
    const [accountId, instId] = key.split('|');
    const inst = insts.get(instId);
    const acct = accounts.get(accountId);
    const method = (acct && acct.lot_method) || 'fifo';
    const run = runLots(acts, method, { asOf: date });
    const price = priceOn(inst, data.prices, data.activities, date);
    const ccy = inst.currency || (acct && acct.currency) || 'USD';
    const value = price ? qtyTimesPrice(run.qty, inst.qty_scale || 4, price.price_e4, decimalsFor(ccy)) : run.cost;
    const flows = [];
    for (const a of acts) {
      const amt = Math.abs(a.amount_minor || 0);
      const fee = Math.abs(a.fee_minor || 0);
      if (a.type === 'buy') flows.push({ amount: -(amt + fee), date: a.date });
      else if (a.type === 'sell') flows.push({ amount: amt - fee, date: a.date });
      else if (a.type === 'dividend' || a.type === 'interest') flows.push({ amount: amt - fee, date: a.date });
      else if (a.type === 'fee') flows.push({ amount: -(amt + fee), date: a.date });
      else if (a.type === 'transfer_in') flows.push({ amount: -(amt || 0), date: a.date });
      else if (a.type === 'transfer_out') flows.push({ amount: amt || 0, date: a.date });
    }
    if (run.qty > 0) flows.push({ amount: value, date });
    let irr = null;
    try { if (flows.length >= 2 && flows.some((f) => f.amount !== 0)) irr = xirr(flows.filter((f) => f.amount !== 0)); } catch (_) { irr = null; }
    out.push({
      key, account: accountId, instrument: instId, name: inst.name, asset_class: inst.asset_class || 'other', currency: ccy,
      qty: run.qty, qty_scale: inst.qty_scale || 4, cost: run.cost, value, price, gain: value - run.cost,
      realized: run.realized, income: run.income, fees: run.fees, withheld: run.withheld, lots: run.lots, errors: run.errors, xirr: irr
    });
  }
  return out;
}

export function xirr(flows, guess) {
  const list = flows.map((f) => ({ amount: f.amount, t: typeof f.date === 'string' ? toUTC(f.date) : f.date.getTime() })).sort((a, b) => a.t - b.t);
  if (!list.some((f) => f.amount > 0) || !list.some((f) => f.amount < 0)) throw new RangeError('#NUM!');
  const d0 = Math.floor(list[0].t / DAY);
  const cf = list.map((f) => ({ a: f.amount, t: (Math.floor(f.t / DAY) - d0) / 365 }));
  const npv = (r) => cf.reduce((s, c) => s + c.a / Math.pow(1 + r, c.t), 0);
  const dnpv = (r) => cf.reduce((s, c) => s - (c.t * c.a) / Math.pow(1 + r, c.t + 1), 0);
  let r = guess == null ? 0.1 : guess;
  for (let i = 0; i < 100; i++) {
    const f = npv(r);
    const d = dnpv(r);
    if (!isFinite(f) || !isFinite(d) || d === 0) break;
    const nx = r - f / d;
    if (nx <= -1 || !isFinite(nx)) break;
    if (Math.abs(nx - r) < 1e-10) return nx;
    r = nx;
  }
  let lo = -0.9999;
  let hi = 1;
  let flo = npv(lo);
  let fhi = npv(hi);
  while (flo * fhi > 0 && hi < 1e6) { hi *= 2; fhi = npv(hi); }
  if (flo * fhi > 0) throw new RangeError('#NUM!');
  for (let i = 0; i < 300 && hi - lo > 1e-12; i++) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid);
    if (flo * fm <= 0) hi = mid;
    else { lo = mid; flo = fm; }
  }
  return (lo + hi) / 2;
}

export function cagr(start, end, years) {
  if (start <= 0 || end <= 0 || years <= 0) return null;
  return Math.pow(end / start, 1 / years) - 1;
}

const PERIODS = { daily: 365, monthly: 12, quarterly: 4, annual: 1 };

export function growth(principal, rateBp, years, compounding) {
  const r = rateBp / 10000;
  if (years <= 0) return principal;
  if (compounding === 'simple') return principal * (1 + r * years);
  const n = PERIODS[compounding] || 4;
  return principal * Math.pow(1 + r / n, n * years);
}

export function depositValue(dep, date) {
  const start = dep.start;
  if (!start || date < start) return { value: 0, interest: 0, contributed: 0, matured: false };
  const end = dep.maturity && date > dep.maturity ? dep.maturity : date;
  const matured = !!(dep.maturity && date >= dep.maturity);
  if (dep.kind === 'recurring') {
    const inst = dep.instalment_minor || 0;
    const dates = occurrences({ freq: 'month', interval: 1 }, start, start, end, dep.maturity ? { mode: 'date', date: dep.maturity } : null);
    let value = 0;
    for (const d of dates) value += growth(inst, dep.rate_bp || 0, diffDays(d, end) / 365, dep.compounding || 'quarterly');
    const contributed = inst * dates.length;
    return { value: Math.round(value), interest: Math.round(value) - contributed, contributed, matured };
  }
  const p = dep.principal_minor || 0;
  const years = diffDays(start, end) / 365;
  if (dep.payout && dep.payout !== 'cumulative') {
    const per = PERIODS[dep.payout] || 12;
    const paid = Math.floor(years * per);
    const perPayout = Math.round((p * (dep.rate_bp || 0)) / 10000 / per);
    return { value: p, interest: paid * perPayout, contributed: p, matured, payout: perPayout };
  }
  const v = Math.round(growth(p, dep.rate_bp || 0, years, dep.compounding || 'quarterly'));
  return { value: v, interest: v - p, contributed: p, matured };
}

export function maturityValue(dep) {
  if (!dep.maturity) return null;
  return depositValue(dep, dep.maturity);
}

export function emi(principal, rateBp, months) {
  const r = rateBp / 10000 / 12;
  if (!months) return principal;
  if (r === 0) return Math.round(principal / months);
  const f = Math.pow(1 + r, months);
  return Math.round((principal * r * f) / (f - 1));
}

export function amortize(loan) {
  const months = loan.tenure_months || 0;
  const r = (loan.rate_bp || 0) / 10000 / 12;
  const pay = loan.emi_minor || emi(loan.principal_minor || 0, loan.rate_bp || 0, months);
  const rows = [];
  let bal = loan.principal_minor || 0;
  const firstDue = addMonths(loan.start, 1, loan.emi_day || null);
  for (let k = 0; k < months && bal > 0; k++) {
    const interest = Math.round(bal * r);
    let principal = Math.min(bal, pay - interest);
    if (k === months - 1) principal = bal;
    bal -= principal;
    rows.push({ n: k + 1, date: addMonths(firstDue, k, loan.emi_day || null), interest, principal, payment: principal + interest, balance: bal });
  }
  return { emi: pay, rows, totalInterest: rows.reduce((s, x) => s + x.interest, 0) };
}

export function loanOutstanding(loan, date) {
  const a = amortize(loan);
  let bal = loan.principal_minor || 0;
  let paid = 0;
  for (const row of a.rows) { if (row.date <= date) { bal = row.balance; paid++; } else break; }
  return { balance: bal, paid, remaining: a.rows.length - paid, emi: a.emi, next: a.rows[paid] || null };
}

export function monthlyRate(annual) { return Math.pow(1 + annual, 1 / 12) - 1; }

export function sipFutureValue(perMonth, annual, months) {
  const i = monthlyRate(annual);
  if (i === 0) return perMonth * months;
  return perMonth * ((Math.pow(1 + i, months) - 1) / i) * (1 + i);
}

export function requiredSip(goal, annual, months, start) {
  const i = monthlyRate(annual);
  const grown = (start || 0) * Math.pow(1 + i, months);
  const need = Math.max(0, goal - grown);
  if (months <= 0) return need;
  if (i === 0) return need / months;
  return (need * i) / ((Math.pow(1 + i, months) - 1) * (1 + i));
}
