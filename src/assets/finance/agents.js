import { monthKey, isISODate, addDays } from './dates.js';
import { minorToNumber, toMinor, decimalsFor, convertMinor } from './money.js';
import { randomId } from './crypto.js';
import { estimate } from './tax.js';
import { cashflow } from './views/plan.js';
import { t, money } from './ui.js';

const BUS = '/assets/js/mentria-bus.js';
let provided = [];

function n(minor, ccy) { return Math.round(minorToNumber(minor, ccy) * 100) / 100; }

function locked(getCtx) {
  const c = getCtx();
  return !c || !c.engine || c.engine.closed || c.engine.readOnly;
}

function addEntry(getCtx, sign) {
  return async (args) => {
    if (locked(getCtx)) return { error: 'locked' };
    const c = getCtx();
    const L = c.ledger;
    const a = args || {};
    const amount = Number(a.amount);
    if (!isFinite(amount) || amount <= 0 || amount > 1e12) return { error: 'amount must be a positive number' };
    const date = a.date == null ? L.today() : String(a.date);
    if (!isISODate(date) || date > addDays(L.today(), 366)) return { error: 'date must be YYYY-MM-DD' };
    const acct = (a.account && L.accounts().find((x) => x.name.toLowerCase() === String(a.account).toLowerCase())) || L.get('account', L.lastAccount());
    if (!acct) return { error: 'no account' };
    const ccy = acct.currency || L.base();
    if (a.currency && String(a.currency).toUpperCase() !== ccy) return { error: 'amount must be in ' + ccy + ' for account ' + acct.name };
    const minor = toMinor(String(amount), decimalsFor(ccy));
    const cat = a.category ? L.leafCategories(sign > 0 ? 'income' : 'expense').find((x) => x.name.toLowerCase() === String(a.category).toLowerCase()) : null;
    const id = randomId();
    const fields = {
      date, amount_minor: sign * minor, currency: ccy, account: acct.id, category: cat ? cat.id : L.suggestCategory(String(a.payee || '')) || null,
      payee: String(a.payee || '').slice(0, 120), note: String(a.note || '').slice(0, 300), tags: [], kind: sign > 0 ? 'income' : 'expense',
      cleared: false, created: new Date().toISOString(), provenance: 'agent'
    };
    if (ccy === L.base()) fields.base_minor = sign * minor;
    else { const r = L.rateE6(ccy, L.base(), date); if (r) { fields.base_minor = convertMinor(sign * minor, ccy, L.base(), r); fields.fx_rate_e6 = r; } }
    const limit = L.settings().confirm_above_minor || 0;
    if (limit && minor > limit) {
      let ok = false;
      try { ok = await window.parent.mentriaConfirm(t('agents.confirm', { amount: money(sign * minor, ccy), payee: fields.payee || '—' })); } catch (_) { ok = false; }
      if (!ok) return { error: 'declined by the user' };
    }
    await c.commit(c.engine.createOps('transaction', id, fields), null, null);
    return { ok: true, id, parsed: { amount, currency: ccy, date, account: acct.name, category: cat ? cat.name : null } };
  };
}

function caps(getCtx) {
  return [
    ['finance.budget', async (a) => {
      if (locked(getCtx)) return { error: 'locked' };
      const L = getCtx().ledger;
      const key = a && /^\d{4}-\d{2}$/.test(a.month || '') ? a.month : monthKey(L.today());
      const b = L.budgetSummary(key);
      const base = L.base();
      return { month: key, currency: base, spent: n(b.expense, base), budget: n(b.total, base), by_category: b.items.filter((x) => x.spent || x.budget).map((x) => ({ name: x.group.name, spent: n(x.spent, base), budget: x.budget == null ? null : n(x.budget, base) })) };
    }, { description: 'Monthly spending and budget totals by category from the private Finance ledger (aggregates only).', parameters: { type: 'object', properties: { month: { type: 'string', description: 'YYYY-MM, default this month' } } }, ai: true, readonly: true }],
    ['finance.subscriptions', async (a) => {
      if (locked(getCtx)) return { error: 'locked' };
      const L = getCtx().ledger;
      const days = Math.max(1, Math.min(120, Number((a && a.days) || 30)));
      const list = L.upcoming(days).filter((u) => u.amount < 0);
      const base = L.base();
      const total = list.reduce((s, u) => s + (L.toBase(-u.amount, u.currency) || 0), 0);
      if (!L.settings().share_subscription_names) return { days, count: list.length, total: n(total, base), currency: base };
      return { days, total: n(total, base), currency: base, items: list.slice(0, 50).map((u) => ({ name: u.schedule.name, amount: n(-u.amount, u.currency), currency: u.currency, next_charge: u.date })) };
    }, { description: 'Bills and subscriptions due in the next N days (totals; names only if the user allows it).', parameters: { type: 'object', properties: { days: { type: 'number' } } }, ai: true, readonly: true }],
    ['finance.worth', async () => {
      if (locked(getCtx)) return { error: 'locked' };
      const L = getCtx().ledger;
      const base = L.base();
      const now = L.netWorth();
      const ago = L.netWorth(addDays(L.today(), -30));
      const by = {};
      for (const k of Object.keys(now.byClass)) by[k] = n(now.byClass[k], base);
      return { total: n(now.total, base), currency: base, by_class: by, change_30d: n(now.total - ago.total, base) };
    }, { description: 'Current net worth and its split by asset class from the private Finance ledger.', parameters: { type: 'object', properties: {} }, ai: true, readonly: true }],
    ['finance.forecast', async (a) => {
      if (locked(getCtx)) return { error: 'locked' };
      const L = getCtx().ledger;
      const base = L.base();
      const months = Math.max(1, Math.min(12, Number((a && a.months) || 6)));
      const cf = cashflow(L, { buffer: L.settings().buffer_minor || 0 });
      return { currency: base, months: cf.keys.slice(0, months).map((k, i) => ({ month: k, p10: n(Math.round(cf.fan[i].p10), base), p50: n(Math.round(cf.fan[i].p50), base), p90: n(Math.round(cf.fan[i].p90), base) })) };
    }, { description: 'Projected month-end cash balance (10th, 50th, 90th percentile) for the next months.', parameters: { type: 'object', properties: { months: { type: 'number' } } }, ai: true, readonly: true, timeoutMs: 30000 }],
    ['finance.tax', async (a) => {
      if (locked(getCtx)) return { error: 'locked' };
      const L = getCtx().ledger;
      const year = (a && a.tax_year) || L.today().slice(0, 4);
      const prof = L.get('tax_profile', 'taxp:' + year);
      if (!prof) return { error: 'no tax profile for ' + year };
      const e = estimate(L, prof);
      return { tax_year: year, currency: e.currency, liability: n(e.liability, e.currency), paid: n(e.paid, e.currency), projected: n(e.projected, e.currency), next_payment: e.next ? n(e.next.amount, e.currency) : null, next_date: e.next ? e.next.date : null, example_values: !!prof.example };
    }, { description: 'Tax estimate for a tax year from the user\'s own tax profile (planning estimate, not filing advice).', parameters: { type: 'object', properties: { tax_year: { type: 'string' } } }, ai: true, readonly: true }],
    ['finance.expense', addEntry(getCtx, -1), { description: 'Add an expense to the private Finance ledger.', parameters: { type: 'object', properties: { amount: { type: 'number' }, currency: { type: 'string' }, category: { type: 'string' }, payee: { type: 'string' }, date: { type: 'string' }, account: { type: 'string' }, note: { type: 'string' } }, required: ['amount'] }, ai: true, readonly: false }],
    ['finance.income', addEntry(getCtx, 1), { description: 'Add income to the private Finance ledger.', parameters: { type: 'object', properties: { amount: { type: 'number' }, currency: { type: 'string' }, category: { type: 'string' }, payee: { type: 'string' }, date: { type: 'string' }, account: { type: 'string' }, note: { type: 'string' } }, required: ['amount'] }, ai: true, readonly: false }]
  ];
}

export async function enableAgents(getCtx) {
  if (provided.length) return;
  const mod = await import(BUS);
  const bus = mod.MentriaBus || mod.default;
  for (const [name, fn, desc] of caps(getCtx)) {
    bus.provide(name, (payload) => fn(payload || {}), desc);
    provided.push(name);
  }
}

export async function disableAgents() {
  if (!provided.length) return;
  try {
    const mod = await import(BUS);
    const bus = mod.MentriaBus || mod.default;
    for (const name of provided) bus.unprovide(name);
  } catch (_) {}
  provided = [];
}

export function agentsOn() { return provided.length > 0; }
