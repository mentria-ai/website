import * as L from './oplog.js';
import { convertMinor, decimalsFor, allocate } from './money.js';
import { todayISO, localDateOf, monthKey, addDays, isISODate, occurrences, nextOccurrence, diffDays, addMonthKey } from './dates.js';
import { holdingsFor, depositValue, loanOutstanding } from './invest.js';

export const CASH_TYPES = ['cash', 'bank', 'savings', 'ewallet'];
export const INVEST_TYPES = ['brokerage', 'fund', 'crypto_wallet'];
export const DEPOSIT_TYPES = ['term_deposit', 'recurring_deposit', 'contribution'];
export const ASSET_TYPES = ['other_asset'];
export const LIABILITY_TYPES = ['credit_card', 'loan', 'other_liability'];
export const ACCOUNT_TYPES = CASH_TYPES.concat(['credit_card'], INVEST_TYPES, DEPOSIT_TYPES, ASSET_TYPES, ['loan', 'other_liability']);
export const ASSET_CLASSES = ['equity', 'bond', 'cash', 'metal', 'crypto', 'real_estate', 'other'];
export const INCOME_SOURCES = ['employment', 'self_employment', 'interest', 'dividend', 'rental', 'other'];
export const NON_SPEND = new Set(['invest', 'adjustment']);

export function accountGroup(type) {
  if (CASH_TYPES.includes(type)) return 'cash';
  if (type === 'credit_card') return 'credit';
  if (INVEST_TYPES.includes(type)) return 'invest';
  if (DEPOSIT_TYPES.includes(type)) return 'deposit';
  if (ASSET_TYPES.includes(type)) return 'asset';
  return 'liability';
}

export function payeeKey(text) {
  const s = String(text || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const tokens = s.split(/[\s/\-*_|#:;,.()[\]{}]+/).filter(Boolean);
  const keep = tokens.filter((t) => {
    if (/^[\dx*]{4,}$/.test(t)) return false;
    if (/\d/.test(t) && t.length > 5) return false;
    if (/^\d+$/.test(t)) return false;
    if (/^(upi|neft|imps|rtgs|pos|ach|sepa|dd|so|tfr|trf|ref|txn|inr|usd|eur|gbp|vps|card|debit|credit|purchase|payment|pmt|www|com|in|ltd|inc|llc|gmbh|pvt|co)$/.test(t)) return false;
    return /[a-z\u00c0-\uffff]/.test(t) && t.length > 1;
  });
  return keep.slice(0, 3).join(' ').slice(0, 48);
}

export class Ledger {
  constructor(engine) {
    this.engine = engine;
    this.memo = new Map();
    this.memoVersion = -1;
  }

  get state() { return this.engine.state; }

  cached(key, fn) {
    if (this.memoVersion !== this.state.version) { this.memo.clear(); this.memoVersion = this.state.version; }
    if (!this.memo.has(key)) this.memo.set(key, fn());
    return this.memo.get(key);
  }

  list(e) { return this.cached('list:' + e, () => L.list(this.state, e)); }
  get(e, id) { return L.get(this.state, e, id); }
  exists(e, id) { return L.exists(this.state, e, id); }
  known(e, id) { return L.known(this.state, e, id); }

  settings() {
    return this.cached('settings', () => {
      const s = L.get(this.state, 'settings', 'main') || {};
      return Object.assign({
        base_currency: 'USD', time_zone: null, week_start: 1, tax_year_start: '01-01', default_notify_days: 1, buffer_minor: 0,
        confirm_above_minor: 0, share_subscription_names: false, export_reminder_days: 30, ai_entry: true,
        mc: { paths: 1000, inflation_bp: 300, assumptions: { equity: { mu_bp: 700, sigma_bp: 1600 }, bond: { mu_bp: 300, sigma_bp: 500 }, metal: { mu_bp: 400, sigma_bp: 1500 }, crypto: { mu_bp: 0, sigma_bp: 7000 }, real_estate: { mu_bp: 400, sigma_bp: 1000 }, cash: { mu_bp: 200, sigma_bp: 50 }, other: { mu_bp: 300, sigma_bp: 800 } } }
      }, s);
    });
  }

  base() { return this.settings().base_currency || 'USD'; }
  today() { return todayISO(this.settings().time_zone || undefined); }
  localDate(stamp) { return localDateOf(stamp, this.settings().time_zone || undefined); }

  accounts(includeClosed) {
    const all = this.cached('accounts', () => this.list('account').sort((a, b) => (a.order || 0) - (b.order || 0) || String(a.name).localeCompare(String(b.name))));
    return includeClosed ? all : all.filter((a) => !a.closed);
  }

  categories() {
    return this.cached('categories', () => this.list('category').sort((a, b) => (a.order || 0) - (b.order || 0) || String(a.name).localeCompare(String(b.name))));
  }

  categoryMap() { return this.cached('catmap', () => new Map(this.categories().map((c) => [c.id, c]))); }

  categoryTree(kind) {
    return this.cached('tree:' + (kind || ''), () => {
      const cats = this.categories().filter((c) => !kind || c.kind === kind);
      const groups = cats.filter((c) => !c.group);
      return groups.map((g) => ({ group: g, children: cats.filter((c) => c.group === g.id) }));
    });
  }

  leafCategories(kind) {
    return this.cached('leaves:' + (kind || ''), () => {
      const cats = this.categories().filter((c) => !c.hidden && (!kind || c.kind === kind));
      const parents = new Set(cats.map((c) => c.group).filter(Boolean));
      return cats.filter((c) => !parents.has(c.id));
    });
  }

  groupOf(catId) {
    const c = this.categoryMap().get(catId);
    if (!c) return null;
    return c.group ? this.categoryMap().get(c.group) || c : c;
  }

  fxRates() {
    return this.cached('fx', () => {
      const m = new Map();
      for (const r of this.list('fx_rate')) {
        const k = r.base + r.quote;
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(r);
      }
      for (const arr of m.values()) arr.sort((a, b) => (a.date < b.date ? -1 : 1));
      return m;
    });
  }

  rateE6(from, to, date) {
    if (from === to) return 1000000;
    const d = date || this.today();
    const pick = (arr) => { let best = null; for (const r of arr || []) { if (r.date <= d) best = r; else break; } return best || (arr && arr[0]) || null; };
    const direct = pick(this.fxRates().get(from + to));
    if (direct) return direct.rate_e6;
    const inv = pick(this.fxRates().get(to + from));
    if (inv && inv.rate_e6) return Math.round(1e12 / inv.rate_e6);
    return null;
  }

  toBase(minor, ccy, date) {
    const base = this.base();
    if (!ccy || ccy === base) return minor;
    const r = this.rateE6(ccy, base, date);
    return r == null ? null : convertMinor(minor, ccy, base, r);
  }

  missingRates() {
    return this.cached('missingfx', () => {
      const base = this.base();
      const out = new Set();
      for (const a of this.accounts(true)) if (a.currency && a.currency !== base && this.rateE6(a.currency, base) == null) out.add(a.currency);
      return Array.from(out);
    });
  }

  rows() {
    return this.cached('rows', () => {
      const out = [];
      const accts = new Map(this.accounts(true).map((a) => [a.id, a]));
      for (const t of this.list('transaction')) {
        if (!isISODate(t.date)) continue;
        const a = accts.get(t.account);
        const ccy = t.currency || (a && a.currency) || this.base();
        const base = t.base_minor != null ? t.base_minor : this.toBase(t.amount_minor || 0, ccy, t.date);
        out.push({ kind: 'txn', id: t.id, ref: t, date: t.date, account: t.account, amount: t.amount_minor || 0, currency: ccy, base, category: t.category || null, payee: t.payee || '', note: t.note || '', tags: t.tags || [], lines: Array.isArray(t.lines) && t.lines.length ? t.lines : null, cleared: !!t.cleared, created: t.created || '', tkind: t.kind || null });
      }
      for (const x of this.list('transfer')) {
        if (!isISODate(x.date)) continue;
        const fa = accts.get(x.from_account);
        const ta = accts.get(x.to_account);
        const fc = (fa && fa.currency) || this.base();
        const tc = (ta && ta.currency) || this.base();
        const fromMinor = Math.abs(x.from_minor || 0);
        const toMinor = Math.abs(x.to_minor != null ? x.to_minor : x.from_minor || 0);
        out.push({ kind: 'xfer', leg: 'out', id: x.id, ref: x, date: x.date, account: x.from_account, other: x.to_account, amount: -fromMinor, currency: fc, base: this.toBase(-fromMinor, fc, x.date), category: null, payee: '', note: x.note || '', tags: [], lines: null, cleared: true, created: x.created || '' });
        out.push({ kind: 'xfer', leg: 'in', id: x.id, ref: x, date: x.date, account: x.to_account, other: x.from_account, amount: toMinor, currency: tc, base: this.toBase(toMinor, tc, x.date), category: null, payee: '', note: x.note || '', tags: [], lines: null, cleared: true, created: x.created || '' });
      }
      out.sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : String(b.created).localeCompare(String(a.created))));
      return out;
    });
  }

  rowsByAccount() {
    return this.cached('byacct', () => {
      const m = new Map();
      for (const r of this.rows()) {
        if (!m.has(r.account)) m.set(r.account, []);
        m.get(r.account).push(r);
      }
      return m;
    });
  }

  rowsByMonth() {
    return this.cached('bymonth', () => {
      const m = new Map();
      for (const r of this.rows()) {
        const k = monthKey(r.date);
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(r);
      }
      return m;
    });
  }

  months() {
    return this.cached('months', () => Array.from(this.rowsByMonth().keys()).sort());
  }

  valuations(accountId) {
    return this.list('valuation').filter((v) => v.account === accountId).sort((a, b) => (a.date < b.date ? -1 : 1));
  }

  balance(accountId, date) {
    const a = this.get('account', accountId);
    if (!a) return 0;
    const d = date || this.today();
    const vals = this.valuations(accountId).filter((v) => v.date <= d);
    const anchor = vals.length ? vals[vals.length - 1] : null;
    let bal = anchor ? anchor.value_minor : (a.opening_date && a.opening_date > d ? 0 : a.opening_minor || 0);
    const from = anchor ? anchor.date : null;
    for (const r of this.rowsByAccount().get(accountId) || []) {
      if (r.date > d) continue;
      if (from && r.date <= from) continue;
      bal += r.amount;
    }
    return bal;
  }

  runningBalances(accountId) {
    return this.cached('run:' + accountId, () => {
      const rows = (this.rowsByAccount().get(accountId) || []).slice().reverse();
      const a = this.get('account', accountId);
      let bal = (a && a.opening_minor) || 0;
      const out = new Map();
      for (const r of rows) { bal += r.amount; out.set(r.kind + r.id + (r.leg || ''), bal); }
      return out;
    });
  }

  investData(date) {
    return {
      instruments: this.list('instrument'),
      activities: this.list('activity'),
      prices: this.list('price'),
      accounts: this.accounts(true),
      date: date || this.today()
    };
  }

  holdings(date) {
    const d = date || this.today();
    return this.cached('holdings:' + d, () => holdingsFor(this.investData(d), d));
  }

  accountValue(account, date) {
    const d = date || this.today();
    const g = accountGroup(account.type);
    const cash = this.balance(account.id, d);
    if (g === 'invest') {
      const hs = this.holdings(d).filter((h) => h.account === account.id);
      let v = cash;
      for (const h of hs) {
        if (h.currency === account.currency) v += h.value;
        else {
          const r = this.rateE6(h.currency, account.currency, d);
          v += r == null ? 0 : convertMinor(h.value, h.currency, account.currency, r);
        }
      }
      return v;
    }
    if (g === 'deposit') {
      const deps = this.list('deposit').filter((x) => x.account === account.id);
      if (!deps.length) return cash;
      return cash + deps.reduce((s, dp) => s + depositValue(dp, d).value, 0);
    }
    if (account.type === 'loan') {
      const loan = this.list('loan').find((x) => x.account === account.id);
      if (loan) return -loanOutstanding(loan, d).balance + (cash - (account.opening_minor || 0));
    }
    return cash;
  }

  netWorth(date) {
    const d = date || this.today();
    return this.cached('nw:' + d, () => {
      const byGroup = {};
      const byClass = {};
      let assets = 0;
      let liabilities = 0;
      let missing = 0;
      for (const a of this.accounts(true)) {
        if (a.include_in_net_worth === false) continue;
        const v = this.accountValue(a, d);
        const b = this.toBase(v, a.currency || this.base(), d);
        if (b == null) { missing++; continue; }
        const g = accountGroup(a.type);
        byGroup[g] = (byGroup[g] || 0) + b;
        if (b >= 0) assets += b; else liabilities += b;
        if (g === 'invest') {
          const hs = this.holdings(d).filter((h) => h.account === a.id);
          let inHold = 0;
          for (const h of hs) {
            const hb = this.toBase(h.value, h.currency, d);
            if (hb == null) continue;
            byClass[h.asset_class] = (byClass[h.asset_class] || 0) + hb;
            inHold += hb;
          }
          byClass.cash = (byClass.cash || 0) + (b - inHold);
        } else if (g === 'deposit' || g === 'cash') {
          byClass.cash = (byClass.cash || 0) + b;
        } else if (g === 'asset') {
          byClass.real_estate = (byClass.real_estate || 0) + b;
        } else {
          byClass.debt = (byClass.debt || 0) + b;
        }
      }
      return { total: assets + liabilities, assets, liabilities, byGroup, byClass, missing };
    });
  }

  rowCategories(r) {
    if (r.kind !== 'txn') return [];
    if (r.lines) {
      const amounts = r.lines.map((ln) => ln.amount_minor || 0);
      const bases = r.base == null ? null : r.base === r.amount ? amounts : allocate(r.base, amounts);
      return r.lines.map((ln, i) => ({ category: ln.category || null, amount: amounts[i], base: bases ? bases[i] : null }));
    }
    return [{ category: r.category, amount: r.amount, base: r.base }];
  }

  monthSummary(key) {
    return this.cached('ms:' + key, () => {
      const cats = this.categoryMap();
      const byCat = new Map();
      let income = 0;
      let expense = 0;
      let unconverted = 0;
      const byDay = new Map();
      for (const r of this.rowsByMonth().get(key) || []) {
        if (r.kind !== 'txn' || NON_SPEND.has(r.tkind)) continue;
        for (const part of this.rowCategories(r)) {
          if (part.base == null) { unconverted++; continue; }
          const c = part.category ? cats.get(part.category) : null;
          const isIncome = c ? c.kind === 'income' : part.base > 0;
          if (isIncome) income += part.base;
          else {
            expense += -part.base;
            byDay.set(r.date, (byDay.get(r.date) || 0) - part.base);
          }
          const k = part.category || (isIncome ? '_income' : '_expense');
          byCat.set(k, (byCat.get(k) || 0) + (isIncome ? part.base : -part.base));
        }
      }
      return { key, income, expense, net: income - expense, byCat, byDay, unconverted };
    });
  }

  budgetFor(catId, key) {
    const b = this.get('budget', catId + ':' + key);
    if (b && b.amount_minor != null) return b.amount_minor;
    const c = this.categoryMap().get(catId);
    return c && c.budget_default_minor != null ? c.budget_default_minor : null;
  }

  budgetSince(catId) {
    const c = this.categoryMap().get(catId);
    const k = c && c.budget_since;
    return typeof k === 'string' && /^\d{4}-\d{2}$/.test(k) ? k : null;
  }

  spendByDay(key, catIds) {
    const out = new Map();
    for (const r of this.rowsByMonth().get(key) || []) {
      if (r.kind !== 'txn' || NON_SPEND.has(r.tkind)) continue;
      for (const part of this.rowCategories(r)) {
        if (part.base == null || !part.category || !catIds.has(part.category)) continue;
        out.set(r.date, (out.get(r.date) || 0) - part.base);
      }
    }
    return out;
  }

  budgetSummary(key) {
    return this.cached('budget:' + key, () => {
      const ms = this.monthSummary(key);
      const tree = this.categoryTree('expense');
      const items = [];
      const counted = new Set();
      let total = 0;
      let spent = 0;
      for (const { group, children } of tree) {
        const members = children.length ? children : [group];
        let kidBudget = 0;
        let kidSpent = 0;
        let allSpent = 0;
        const budgeted = [];
        const kids = [];
        for (const c of members) {
          const b = this.budgetFor(c.id, key);
          const s = ms.byCat.get(c.id) || 0;
          const roll = c.rollover ? this.rolloverFor(c.id, key) : 0;
          if (b != null) { kidBudget += b + roll; kidSpent += s; budgeted.push(c.id); }
          allSpent += s;
          kids.push({ cat: c, budget: b == null ? null : b + roll, spent: s, roll });
        }
        allSpent += children.length ? ms.byCat.get(group.id) || 0 : 0;
        const gb = children.length ? this.budgetFor(group.id, key) : null;
        const whole = gb != null;
        const gBudget = whole ? gb : budgeted.length ? kidBudget : null;
        const gSpent = whole || !budgeted.length ? allSpent : kidSpent;
        items.push({ group, kids: children.length ? kids : [], budget: gBudget, spent: gSpent });
        if (gBudget != null) {
          total += gBudget;
          spent += gSpent;
          if (whole) { counted.add(group.id); for (const c of members) counted.add(c.id); }
          else for (const id of budgeted) counted.add(id);
        }
      }
      const uncategorized = ms.byCat.get('_expense') || 0;
      return { items, total, spent, uncategorized, expense: ms.expense, outside: Math.max(0, ms.expense - spent), byDay: this.spendByDay(key, counted) };
    });
  }

  rolloverFor(catId, key) {
    const first = this.months()[0];
    if (!first) return 0;
    const since = this.budgetSince(catId);
    let carry = 0;
    for (let i = 6; i >= 1; i--) {
      const k = addMonthKey(key, -i);
      if (k < first) continue;
      const rec = this.get('budget', catId + ':' + k);
      const b = rec && rec.amount_minor != null ? rec.amount_minor : since && k < since ? null : this.budgetFor(catId, k);
      if (b == null) { carry = 0; continue; }
      const s = this.monthSummary(k).byCat.get(catId) || 0;
      carry = Math.max(0, carry + b - s);
    }
    return carry;
  }

  schedules(includeInactive) {
    const all = this.cached('schedules', () => this.list('schedule'));
    return includeInactive ? all : all.filter((s) => s.active !== false);
  }

  scheduleNext(s, after) {
    if (!s || !isISODate(s.anchor)) return null;
    const a = after || addDays(this.today(), -1);
    return nextOccurrence(s.rule || { freq: 'month' }, s.anchor, a, s.end && s.end.mode !== 'never' ? s.end : null);
  }

  scheduleEnded(s) {
    return !this.scheduleNext(s);
  }

  scheduleOrphaned(s) {
    return !!(s && s.account && !this.exists('account', s.account));
  }

  orphanSchedules() {
    return this.schedules().filter((s) => s.auto_post && this.scheduleOrphaned(s) && !this.scheduleEnded(s));
  }

  autoPostDates(s, today) {
    if (!s || !s.auto_post || !isISODate(s.anchor) || !s.account || this.scheduleOrphaned(s)) return [];
    const now = today || this.today();
    const created = (s.created && this.localDate(s.created)) || s.anchor;
    const from = created > s.anchor ? created : s.anchor;
    const floor = addDays(now, -400);
    const dates = occurrences(s.rule || { freq: 'month' }, s.anchor, from < floor ? floor : from, now, s.end && s.end.mode !== 'never' ? s.end : null);
    return dates.filter((d) => !this.known('transaction', 'sch:' + s.id + ':' + d));
  }

  scheduledTxn(s, d) {
    const acct = this.get('account', s.account);
    return {
      id: 'sch:' + s.id + ':' + d,
      fields: {
        date: d, amount_minor: s.amount_minor || 0, currency: (acct && acct.currency) || s.currency || this.base(), account: s.account,
        category: s.category || null, payee: s.payee || s.name || '', note: '', tags: [], kind: (s.amount_minor || 0) > 0 ? 'income' : 'expense',
        schedule_id: s.id, cleared: false, created: d + 'T00:00:00.000Z', provenance: 'schedule'
      }
    };
  }

  upcoming(days, from) {
    const today = this.today();
    const start = from || today;
    const end = addDays(today, days);
    const out = [];
    for (const s of this.schedules()) {
      const dates = occurrences(s.rule || { freq: 'month' }, s.anchor, start, end, s.end && s.end.mode !== 'never' ? s.end : null);
      for (const d of dates) {
        if (this.known('transaction', 'sch:' + s.id + ':' + d)) continue;
        out.push({ schedule: s, date: d, amount: s.amount_minor || 0, currency: s.currency || this.base(), days: diffDays(today, d) });
      }
    }
    out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return out;
  }

  payees() {
    return this.cached('payees', () => {
      const counts = new Map();
      for (const r of this.rows()) {
        if (!r.payee) continue;
        const k = r.payee;
        const e = counts.get(k) || { name: k, n: 0, last: '', cats: new Map() };
        e.n++;
        if (r.date > e.last) e.last = r.date;
        if (r.category) e.cats.set(r.category, (e.cats.get(r.category) || 0) + 1);
        counts.set(k, e);
      }
      return Array.from(counts.values()).sort((a, b) => b.n - a.n);
    });
  }

  suggestCategory(payee) {
    if (!payee) return null;
    const rec = this.get('payee', payeeKey(payee));
    if (rec && rec.default_category && this.categoryMap().has(rec.default_category)) return rec.default_category;
    const p = this.payees().find((x) => x.name.toLowerCase() === String(payee).toLowerCase());
    if (p && p.cats.size) return Array.from(p.cats.entries()).sort((a, b) => b[1] - a[1])[0][0];
    return null;
  }

  frequentCategory(kind, hour) {
    const counts = new Map();
    const rows = this.rows().slice(0, 400);
    for (const r of rows) {
      if (r.kind !== 'txn' || !r.category) continue;
      const c = this.categoryMap().get(r.category);
      if (!c || c.kind !== kind) continue;
      const h = r.created ? new Date(r.created).getHours() : null;
      const w = h != null && hour != null && Math.abs(h - hour) <= 2 ? 3 : 1;
      counts.set(r.category, (counts.get(r.category) || 0) + w);
    }
    let best = null;
    for (const [k, v] of counts) if (!best || v > best[1]) best = [k, v];
    return best ? best[0] : null;
  }

  lastAccount() {
    const r = this.rows().find((x) => x.kind === 'txn');
    if (r && this.exists('account', r.account)) return r.account;
    const a = this.accounts().find((x) => accountGroup(x.type) === 'cash' || x.type === 'credit_card');
    return a ? a.id : (this.accounts()[0] || {}).id || null;
  }

  search(q, limit) {
    const s = String(q || '').trim().toLowerCase();
    if (!s) return this.rows().slice(0, limit || 200);
    const cats = this.categoryMap();
    const accts = new Map(this.accounts(true).map((a) => [a.id, a]));
    const out = [];
    for (const r of this.rows()) {
      const c = r.category ? cats.get(r.category) : null;
      const a = accts.get(r.account);
      const hay = (r.payee + ' ' + r.note + ' ' + (r.tags || []).join(' ') + ' ' + (c ? c.name : '') + ' ' + (a ? a.name : '')).toLowerCase();
      if (hay.includes(s)) out.push(r);
      if (out.length >= (limit || 500)) break;
    }
    return out;
  }

  conflicts() { return this.state.conflicts || []; }

  devices() { return this.list('device').sort((a, b) => String(b.last_seen || '').localeCompare(String(a.last_seen || ''))); }

  monthlySeries(months, end) {
    const last = end || monthKey(this.today());
    const keys = [];
    for (let i = months - 1; i >= 0; i--) keys.push(addMonthKey(last, -i));
    return keys.map((k) => { const s = this.monthSummary(k); return { key: k, income: s.income, expense: s.expense, net: s.net, byCat: s.byCat }; });
  }

  categorySeries(catIds, months, end) {
    const series = this.monthlySeries(months, end);
    const want = new Set(catIds);
    return series.map((m) => {
      let v = 0;
      for (const [k, amt] of m.byCat) if (want.has(k) || want.has((this.categoryMap().get(k) || {}).group)) v += amt;
      return v;
    });
  }

  decimals() { return decimalsFor(this.base()); }
}
