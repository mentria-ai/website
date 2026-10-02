import { addDays, diffDays, iso, parts, isISODate } from './dates.js';
import { runLots, depositValue } from './invest.js';
import { convertMinor } from './money.js';

export const SOURCES = ['employment', 'self_employment', 'interest', 'dividend', 'rental', 'other'];

export function exampleProfile(year, currency) {
  return {
    tax_year: String(year), label: 'Example profile (edit me)', year_start: '01-01', currency,
    verified_on: null, source_url: null, notes: '',
    brackets: [[0, 1000000, 1000], [1000000, 4000000, 2000], [4000000, null, 3000]],
    allowances: [{ name: 'Standard allowance', amount_minor: 1400000 }],
    social_bp: 0,
    cg: { method: 'brackets', long_term_months: 12, lt_brackets: [[0, 4000000, 0], [4000000, null, 1500]], lt_rate_bp: null, st_rate_bp: null, exemption_minor: 0, loss_offset_cap_minor: 300000, loss_carry_years: null, wash_sale_days: 30 },
    dividends: { treatment: 'ordinary', rate_bp: null },
    interest: { treatment: 'ordinary', rate_bp: null },
    payments: [['04-15', 2500], ['06-15', 5000], ['09-15', 7500], ['01-15', 10000]],
    credits: [], carry_forward: [], payment_categories: [], example: true
  };
}

export function yearRange(profile) {
  const y = parseInt(profile.tax_year, 10);
  const md = /^\d{2}-\d{2}$/.test(profile.year_start || '') ? profile.year_start : '01-01';
  const start = y + '-' + md;
  const nextStart = (y + 1) + '-' + md;
  return { start, end: addDays(nextStart, -1) };
}

export function progressive(amount, brackets) {
  let tax = 0;
  const lines = [];
  if (amount <= 0) return { tax: 0, lines, marginal: brackets && brackets[0] ? brackets[0][2] : 0 };
  let marginal = 0;
  for (const [from, to, bp] of brackets || []) {
    const top = to == null ? Infinity : to;
    if (amount <= from) break;
    const portion = Math.min(amount, top) - from;
    if (portion <= 0) continue;
    const part = Math.round((portion * bp) / 10000);
    tax += part;
    marginal = bp;
    lines.push({ from, to, bp, portion, tax: part });
  }
  return { tax, lines, marginal };
}

function inRange(d, r) { return d >= r.start && d <= r.end; }

export function estimate(L, profile, opts) {
  const o = opts || {};
  const r = yearRange(profile);
  const today = o.today || L.today();
  const ccy = profile.currency || L.base();
  const toProfile = (minor, from, date) => {
    if (from === ccy) return minor;
    const rate = L.rateE6(from, ccy, date);
    return rate == null ? 0 : convertMinor(minor, from, ccy, rate);
  };
  const cats = L.categoryMap();
  const income = Object.fromEntries(SOURCES.map((s) => [s, 0]));
  const payCats = new Set(profile.payment_categories || []);
  let paid = 0;
  for (const row of L.rows()) {
    if (row.kind !== 'txn') continue;
    const inYear = inRange(row.date, r);
    if (payCats.size) {
      const ids = row.lines ? row.lines.map((x) => x.category) : [row.category];
      if (ids.some((id) => payCats.has(id)) && row.date >= r.start && row.date <= addDays(r.end, 120) && row.amount < 0) paid += toProfile(-row.amount, row.currency, row.date);
    }
    if (!inYear) continue;
    for (const part of L.rowCategories(row)) {
      if (part.amount <= 0) continue;
      const c = part.category ? cats.get(part.category) : null;
      if (c && c.kind !== 'income') continue;
      if (!c) continue;
      const src = (row.ref && row.ref.income_source) || c.income_source || 'other';
      income[SOURCES.includes(src) ? src : 'other'] += toProfile(part.amount, row.currency, row.date);
    }
  }
  const data = L.investData(r.end);
  const accts = new Map(data.accounts.map((a) => [a.id, a]));
  const insts = new Map(data.instruments.map((i) => [i.id, i]));
  let withheld = 0;
  const groups = new Map();
  for (const a of data.activities) {
    if (inRange(a.date, r)) {
      const inst = insts.get(a.instrument);
      const icc = (inst && inst.currency) || ((accts.get(a.account) || {}).currency) || ccy;
      if (a.type === 'dividend' || a.type === 'dividend_reinvest') income.dividend += toProfile(Math.abs(a.amount_minor || 0), icc, a.date);
      if (a.type === 'interest') income.interest += toProfile(Math.abs(a.amount_minor || 0), icc, a.date);
      if (a.tax_withheld_minor) withheld += toProfile(Math.abs(a.tax_withheld_minor), icc, a.date);
      if (a.type === 'tax_withheld') withheld += toProfile(Math.abs(a.amount_minor || 0), icc, a.date);
    }
    const key = a.account + '|' + a.instrument;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(a);
  }
  for (const d of L.list('deposit')) {
    const a = accts.get(d.account);
    const dccy = (a && a.currency) || ccy;
    const startV = depositValue(d, addDays(r.start, -1));
    const endV = depositValue(d, r.end < today ? r.end : today);
    const accrued = Math.max(0, (endV.interest || 0) - (startV.interest || 0));
    if (accrued) income.interest += toProfile(accrued, dccy, r.end);
    if (d.withholding_bp && accrued) withheld += Math.round(toProfile(accrued, dccy, r.end) * d.withholding_bp / 10000);
  }
  const cg = profile.cg || {};
  const ltDays = Math.round((cg.long_term_months || 12) * 30.4375);
  const realized = [];
  for (const [key, acts] of groups) {
    const [accountId, instId] = key.split('|');
    const inst = insts.get(instId);
    const acct = accts.get(accountId);
    const run = runLots(acts.filter((x) => x.date <= r.end), (acct && acct.lot_method) || 'fifo');
    const icc = (inst && inst.currency) || (acct && acct.currency) || ccy;
    for (const g of run.realized) {
      if (!inRange(g.date, r)) continue;
      const long = g.days == null ? false : g.days >= ltDays;
      realized.push({ date: g.date, instrument: inst ? inst.name : instId, account: acct ? acct.name : '', qty: g.qty, qty_scale: (inst && inst.qty_scale) || 4, proceeds: toProfile(g.proceeds, icc, g.date), cost: toProfile(g.cost, icc, g.date), gain: toProfile(g.gain, icc, g.date), term: g.days == null ? 'pooled' : long ? 'long' : 'short', days: g.days });
    }
  }
  realized.sort((a, b) => (a.date < b.date ? -1 : 1));
  let st = realized.filter((g) => g.term === 'short').reduce((n, g) => n + g.gain, 0);
  let lt = realized.filter((g) => g.term !== 'short').reduce((n, g) => n + g.gain, 0);
  const carryIn = (profile.carry_forward || []).reduce((n, c) => n + Math.abs(c.amount_minor || 0), 0);
  lt -= carryIn;
  if (st < 0 && lt > 0) { const use = Math.min(-st, lt); lt -= use; st += use; }
  if (lt < 0 && st > 0) { const use = Math.min(-lt, st); st -= use; lt += use; }
  let lossOffset = 0;
  let carryOut = 0;
  const netLoss = Math.min(0, st) + Math.min(0, lt);
  if (netLoss < 0) {
    const cap = cg.loss_offset_cap_minor == null ? Infinity : cg.loss_offset_cap_minor;
    lossOffset = Math.min(-netLoss, cap);
    carryOut = -netLoss - lossOffset;
    st = Math.max(0, st);
    lt = Math.max(0, lt);
  }
  lt = Math.max(0, lt - (cg.exemption_minor || 0));
  const allowances = (profile.allowances || []).reduce((n, a) => n + Math.abs(a.amount_minor || 0), 0);
  let ordinaryIncome = income.employment + income.self_employment + income.rental + income.other;
  const flatTaxes = [];
  for (const [kind, key] of [['dividends', 'dividend'], ['interest', 'interest']]) {
    const tr = profile[kind] || { treatment: 'ordinary' };
    if (tr.treatment === 'flat' && tr.rate_bp != null) flatTaxes.push({ kind, base: income[key], tax: Math.round(income[key] * tr.rate_bp / 10000) });
    else ordinaryIncome += income[key];
  }
  let cgTax = 0;
  if (cg.method === 'ordinary') ordinaryIncome += st + lt;
  else {
    if (cg.st_rate_bp == null) ordinaryIncome += st;
    else cgTax += Math.round(st * cg.st_rate_bp / 10000);
    if (cg.method === 'flat') cgTax += Math.round(lt * (cg.lt_rate_bp || 0) / 10000);
    else cgTax += progressive(lt, cg.lt_brackets || []).tax;
  }
  const taxable = Math.max(0, ordinaryIncome - allowances - lossOffset);
  const ord = progressive(taxable, profile.brackets || []);
  const social = Math.round(income.self_employment * (profile.social_bp || 0) / 10000);
  const flat = flatTaxes.reduce((n, x) => n + x.tax, 0);
  const credits = (profile.credits || []).reduce((n, c) => n + Math.abs(c.amount_minor || 0), 0);
  const gross = ord.tax + cgTax + flat + social;
  const liability = Math.max(0, gross - credits - withheld);
  const due = [];
  const yStart = parts(r.start);
  let year = yStart.y;
  let prev = null;
  for (const [md, cum] of profile.payments || []) {
    if (!/^\d{2}-\d{2}$/.test(md)) continue;
    const [mm, dd] = md.split('-').map(Number);
    let date = iso(year, mm, dd);
    if ((!prev && date < r.start) || (prev && date <= prev)) { year++; date = iso(year, mm, dd); }
    if (!isISODate(date)) continue;
    prev = date;
    due.push({ date, cumulative: Math.round(liability * cum / 10000), bp: cum });
  }
  const next = due.find((d) => d.date >= today && d.cumulative > paid) || null;
  const elapsed = Math.max(1, Math.min(diffDays(r.start, today) + 1, diffDays(r.start, r.end) + 1));
  const span = diffDays(r.start, r.end) + 1;
  let projected = liability;
  if (today < r.end && today >= r.start) {
    const factor = span / elapsed;
    const pOrd = Math.max(0, (ordinaryIncome - st - lt) * factor + (cg.method === 'ordinary' ? st + lt : cg.st_rate_bp == null ? st : 0) - allowances - lossOffset);
    const pTax = progressive(pOrd, profile.brackets || []).tax + cgTax + Math.round(flat * factor) + Math.round(social * factor);
    projected = Math.max(0, pTax - credits - Math.round(withheld * factor));
  }
  return {
    range: r, currency: ccy, income, realized, st, lt, lossOffset, carryOut, allowances, ordinaryIncome, taxable,
    brackets: ord.lines, marginal: ord.marginal, ordinaryTax: ord.tax, cgTax, flatTaxes, social, credits, withheld,
    gross, liability, paid, due, next: next ? { date: next.date, amount: Math.max(0, next.cumulative - paid) } : null,
    projected, partial: today < r.end
  };
}

export function harvestCandidates(L, profile, date) {
  const hs = L.holdings(date || L.today());
  const out = [];
  for (const h of hs) {
    if (h.qty <= 0 || h.value >= h.cost) continue;
    const recentBuy = L.list('activity').some((a) => a.instrument === h.instrument && a.type === 'buy' && diffDays(a.date, date || L.today()) <= ((profile.cg && profile.cg.wash_sale_days) || 0));
    out.push({ name: h.name, account: h.account, loss: h.cost - h.value, currency: h.currency, washRisk: recentBuy });
  }
  return out.sort((a, b) => b.loss - a.loss);
}
