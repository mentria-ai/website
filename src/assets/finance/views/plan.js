import * as U from '../ui.js';
import * as F from '../forecast.js';
import { lineChart, legend } from '../charts.js';
import { monthKey, addMonthKey, parts, daysInMonth, occurrences, monthEnd, isISODate, monthsBetween } from '../dates.js';
import { accountGroup, NON_SPEND, payeeKey } from '../ledger.js';
import { sipFutureValue, requiredSip, emi, growth } from '../invest.js';

const { h, t, icon } = U;
const H = 12;

function history(L) {
  return L.cached('plan:history', () => {
    const cur = monthKey(L.today());
    const months = [];
    for (let i = 36; i >= 1; i--) months.push(addMonthKey(cur, -i));
    const cats = L.categoryMap();
    const spend = new Map();
    const income = new Map();
    const idx = new Map(months.map((k, i) => [k, i]));
    const tracked = new Set();
    for (const s of L.schedules()) { const k = payeeKey(s.payee || s.name); if (k) tracked.add(k + ((s.amount_minor || 0) < 0 ? '|out' : '|in')); }
    for (const r of L.rows()) {
      if (r.kind !== 'txn') continue;
      const mi = idx.get(monthKey(r.date));
      if (mi == null) continue;
      if (r.ref && r.ref.schedule_id) continue;
      if (tracked.size && tracked.has(payeeKey(r.payee || r.note) + (r.amount < 0 ? '|out' : '|in'))) continue;
      if (NON_SPEND.has(r.tkind)) continue;
      for (const part of L.rowCategories(r)) {
        if (part.base == null) continue;
        const c = part.category ? cats.get(part.category) : null;
        const isIncome = c ? c.kind === 'income' : part.base > 0;
        const g = c ? (c.group || c.id) : isIncome ? '_income' : '_expense';
        const map = isIncome ? income : spend;
        if (!map.has(g)) map.set(g, new Array(months.length).fill(0));
        map.get(g)[mi] += isIncome ? part.base : -part.base;
      }
    }
    let firstActive = months.length;
    for (const arr of [...spend.values(), ...income.values()]) { const f = arr.findIndex((v) => v !== 0); if (f >= 0 && f < firstActive) firstActive = f; }
    return { months, spend, income, firstActive };
  });
}

function categoryForecasts(L) {
  return L.cached('plan:catf', () => {
    const hist = history(L);
    const out = { spend: new Map(), income: new Map() };
    for (const kind of ['spend', 'income']) {
      for (const [g, arr] of hist[kind]) {
        const y = arr.slice(hist.firstActive);
        const f = F.forecastSeries(y, H + 1);
        const sorted = f.resid.slice().sort((a, b) => a - b);
        out[kind].set(g, { f, lo: F.quantile(sorted, 0.1), hi: F.quantile(sorted, 0.9), y, avg6: y.slice(-6).reduce((s, v) => s + v, 0) / Math.max(1, Math.min(6, y.length)) });
      }
    }
    return out;
  });
}

function liquidAccounts(L) {
  return L.accounts().filter((a) => ['cash', 'credit'].includes(accountGroup(a.type)) && a.include_in_net_worth !== false);
}

function plannedDelta(L, key, catGroupId) {
  let pct = 0;
  let abs = 0;
  for (const p of L.list('planned_change')) {
    if (p.active === false || !isISODate(p.from)) continue;
    const from = monthKey(p.from);
    const until = p.until ? monthKey(p.until) : null;
    if (key < from || (until && key > until)) continue;
    if (p.target_kind === 'category' && p.target_id === catGroupId) {
      if (p.change_kind === 'percent') pct += (p.value || 0) / 10000;
      else abs += p.value || 0;
    }
  }
  return { pct, abs };
}

function oneOffs(L, key) {
  let v = 0;
  for (const p of L.list('planned_change')) {
    if (p.active === false || p.target_kind !== 'oneoff' || !isISODate(p.from)) continue;
    if (monthKey(p.from) === key) v += p.value || 0;
  }
  return v;
}

export function cashflow(L, opts) {
  const o = opts || {};
  return L.cached('plan:cash:' + (o.buffer || 0), () => {
    const today = L.today();
    const cur = monthKey(today);
    const p = parts(today);
    const remaining = (daysInMonth(p.y, p.m) - p.d) / daysInMonth(p.y, p.m);
    const liquid = liquidAccounts(L);
    const liquidIds = new Set(liquid.map((a) => a.id));
    let start = 0;
    for (const a of liquid) start += L.toBase(L.balance(a.id), a.currency) || 0;
    const keys = [];
    for (let i = 0; i < H; i++) keys.push(addMonthKey(cur, i));
    const sched = new Array(H).fill(0);
    for (const s of L.schedules()) {
      if (!liquidIds.has(s.account)) continue;
      for (let i = 0; i < H; i++) {
        const from = i === 0 ? today : keys[i] + '-01';
        const to = monthEnd(keys[i] + '-01');
        for (const d of occurrences(s.rule || { freq: 'month' }, s.anchor, from, to, s.end && s.end.mode !== 'never' ? s.end : null)) {
          if (L.known('transaction', 'sch:' + s.id + ':' + d)) continue;
          sched[i] += L.toBase(s.amount_minor || 0, s.currency || L.base(), d) || 0;
        }
      }
    }
    const cf = categoryForecasts(L);
    const net = [];
    const disc = [];
    const inc = [];
    for (let i = 0; i < H; i++) {
      const frac = i === 0 ? remaining : 1;
      let spend = 0;
      for (const [g, c] of cf.spend) {
        const d = plannedDelta(L, keys[i], g);
        spend += Math.max(0, c.f.point[i] * (1 + d.pct) + d.abs) * frac;
      }
      let income = 0;
      for (const [, c] of cf.income) income += Math.max(0, c.f.point[i]) * frac;
      disc.push(spend);
      inc.push(income);
      net.push(income - spend + sched[i] + oneOffs(L, keys[i]));
    }
    const hist = history(L);
    const K = Math.min(24, hist.months.length - hist.firstActive);
    const resid = new Array(Math.max(0, K)).fill(0);
    for (const [kind, sign] of [['spend', -1], ['income', 1]]) {
      for (const [, arr] of hist[kind]) {
        const y = arr.slice(arr.length - K);
        const med = F.median(y);
        y.forEach((v, k) => { resid[k] += sign * (v - med); });
      }
    }
    const sim = F.bootstrapCash({ start, months: H, net, residuals: [resid], residualMonths: K, paths: 1000, seed: 11, buffer: o.buffer || 0, partial: remaining });
    let runwayP50 = null;
    let runwayP10 = null;
    sim.fan.forEach((f, i) => { if (runwayP50 == null && f.p50 < (o.buffer || 0)) runwayP50 = i; if (runwayP10 == null && f.p10 < (o.buffer || 0)) runwayP10 = i; });
    return { keys, start, sched, disc, inc, net, fan: sim.fan, below: sim.below, runwayP50, runwayP10, months: K };
  });
}

function changeSheet(ctx, ch) {
  const L = ctx.ledger;
  const base = L.base();
  const c = ch || { target_kind: 'category', change_kind: 'percent', value: 1000, from: addMonthKey(monthKey(L.today()), 1) + '-01', active: true };
  const kind = U.select([{ value: 'category', label: t('plan.change_category') }, { value: 'oneoff', label: t('plan.change_oneoff') }], c.target_kind);
  const cat = U.select(L.categoryTree('expense').map(({ group }) => ({ value: group.id, label: group.name })), c.target_id || '');
  const mode = U.select([{ value: 'percent', label: t('plan.by_percent') }, { value: 'absolute', label: t('plan.by_amount') }], c.change_kind || 'percent');
  const val = U.input({ inputmode: 'decimal', value: c.target_kind === 'oneoff' || c.change_kind === 'absolute' ? U.amountToInput(Math.abs(c.value || 0), base) : String((c.value || 0) / 100) });
  const sign = U.select([{ value: '-1', label: t('plan.outgoing') }, { value: '1', label: t('plan.incoming') }], (c.value || 0) > 0 && c.target_kind === 'oneoff' ? '1' : '-1');
  const from = h('input', { class: 'fi', type: 'date', value: c.from || L.today() });
  const until = h('input', { class: 'fi', type: 'date', value: c.until || '' });
  const note = U.input({ value: c.note || '', maxlength: '120', placeholder: t('plan.note_ph') });
  const catF = U.field(t('entry.category'), cat);
  const modeF = U.field(t('plan.change_how'), mode);
  const signF = U.field(t('plan.direction'), sign);
  const untilF = U.field(t('plan.until'), until, t('plan.until_hint'));
  const sync = () => { const one = kind.value === 'oneoff'; catF.hidden = one; modeF.hidden = one; untilF.hidden = one; signF.hidden = !one; };
  kind.addEventListener('change', sync);
  sync();
  const err = h('p', { class: 'ff__err', role: 'alert' });
  const save = h('button', { type: 'button', class: 'fb fb--primary' }, t('common.save'));
  const del = ch ? h('button', { type: 'button', class: 'fb fb--danger fb--icon', 'aria-label': t('common.delete'), onclick: () => { sh.close(); ctx.commit(ctx.remove('planned_change', ch.id), t('plan.change_deleted')); } }, icon('trash')) : null;
  const sh = U.sheet({ title: ch ? t('plan.edit_change') : t('plan.add_change'), body: h('div', { class: 'fstack' }, h('p', { class: 'fmuted fsmall' }, t('plan.change_body')), h('div', { class: 'ff-grid' }, U.field(t('plan.change_kind'), kind), catF, modeF, signF, U.field(t('plan.value'), val), U.field(t('plan.from'), from), untilF), U.field(t('entry.note'), note), err), foot: [del, h('button', { type: 'button', class: 'fb', onclick: () => sh.close() }, t('common.cancel')), save].filter(Boolean) });
  save.addEventListener('click', () => {
    if (!isISODate(from.value)) { err.textContent = t('entry.err_date'); return; }
    let value;
    if (kind.value === 'oneoff' || mode.value === 'absolute') {
      const m = U.parseAmount(val.value, base);
      if (m == null) { err.textContent = t('entry.err_amount'); return; }
      value = kind.value === 'oneoff' ? Math.abs(m) * Number(sign.value) : m;
    } else {
      const p = parseFloat(String(val.value).replace(',', '.'));
      if (!isFinite(p)) { err.textContent = t('entry.err_amount'); return; }
      value = Math.round(p * 100);
    }
    const fields = { target_kind: kind.value, target_id: kind.value === 'category' ? cat.value : null, change_kind: kind.value === 'oneoff' ? 'absolute' : mode.value, value, from: from.value, until: kind.value === 'category' && isISODate(until.value) ? until.value : null, note: note.value.trim(), active: true };
    sh.close();
    ctx.commit(ctx.save('planned_change', ch ? ch.id : ctx.newId(), fields), t('plan.change_saved'));
  });
}

function cashTab(ctx) {
  const L = ctx.ledger;
  const base = L.base();
  const buffer = L.settings().buffer_minor || 0;
  const cf = cashflow(L, { buffer });
  const node = h('div');
  if (!liquidAccounts(L).length) { node.append(U.empty(t('plan.no_liquid'))); return node; }
  const labels = cf.keys.map((k) => U.month(k, true));
  const card = h('div', { class: 'fcard' });
  const end = cf.fan[H - 1];
  card.append(h('div', { class: 'fstats fstats--4', style: { marginBottom: '12px' } },
    h('div', { class: 'fstat' }, h('span', { class: 'fstat__label' }, t('plan.now')), h('span', { class: 'fmid' }, U.money(cf.start, base, { compact: true }))),
    h('div', { class: 'fstat' }, h('span', { class: 'fstat__label' }, t('plan.in_12')), h('span', { class: 'fmid ' + (end.p50 < buffer ? 'amt--over' : '') }, U.money(Math.round(end.p50), base, { compact: true })), h('span', { class: 'fsmall fmuted' }, t('plan.range', { lo: U.money(Math.round(end.p10), base, { compact: true }), hi: U.money(Math.round(end.p90), base, { compact: true }) }))),
    h('div', { class: 'fstat' }, h('span', { class: 'fstat__label' }, t('plan.runway')), h('span', { class: 'fmid' }, cf.runwayP50 == null ? t('plan.runway_ok') : U.tp('plan.months', cf.runwayP50 + 1))),
    h('div', { class: 'fstat' }, h('span', { class: 'fstat__label' }, t('plan.risk', { buffer: U.money(buffer, base, { compact: true }) })), h('span', { class: 'fmid ' + (Math.max(...cf.below) > 0.2 ? 'amt--warn' : '') }, U.pct(Math.max(...cf.below), 0)))));
  card.append(lineChart({
    labels, height: 230, label: t('plan.cash_chart'),
    series: [{ values: cf.fan.map((f) => f.p50), color: '#6ef3c5', label: t('plan.median') }],
    bands: [{ lo: cf.fan.map((f) => f.p10), hi: cf.fan.map((f) => f.p90), color: '#6ef3c5', opacity: 0.14, label: t('plan.band') }],
    refLine: buffer || null, fmtY: (v) => U.money(Math.round(v), base, { compact: true }), fmtTip: (v) => U.money(Math.round(v), base, { compact: true })
  }));
  card.append(legend([{ color: '#6ef3c5', label: t('plan.median') }, { color: 'rgba(110,243,197,0.3)', label: t('plan.band') }].concat(buffer ? [{ color: '#f472b6', label: t('plan.buffer') }] : [])));
  card.append(h('p', { class: 'ff__hint', style: { marginTop: '8px' } }, cf.months >= 3 ? t('plan.cash_note', { n: cf.months }) : t('plan.cash_thin')));
  node.append(card);
  const tbl = h('table', { class: 'ftable' }, h('thead', null, h('tr', null, h('th', null, t('ledger.month')), h('th', { class: 'n' }, t('plan.scheduled')), h('th', { class: 'n' }, t('plan.spending')), h('th', { class: 'n' }, t('plan.income')), h('th', { class: 'n' }, t('plan.end_balance')))));
  const tb = h('tbody');
  cf.keys.forEach((k, i) => tb.append(h('tr', null, h('td', null, U.month(k, true)), h('td', { class: 'n' }, U.signedMoney(Math.round(cf.sched[i]), base, { compact: true })), h('td', { class: 'n' }, U.money(Math.round(cf.disc[i]), base, { compact: true })), h('td', { class: 'n amt--in' }, U.money(Math.round(cf.inc[i]), base, { compact: true })), h('td', { class: 'n ' + (cf.fan[i].p50 < buffer ? 'amt--over' : '') }, U.money(Math.round(cf.fan[i].p50), base, { compact: true })))));
  tbl.append(tb);
  node.append(h('div', { class: 'ftable-wrap', tabindex: '0', role: 'region', 'aria-label': t('plan.cash_chart'), style: { marginTop: '14px' } }, tbl));
  node.append(h('div', { class: 'fsection' }, h('h2', null, t('plan.changes')), h('button', { type: 'button', class: 'fb fb--sm', onclick: () => changeSheet(ctx, null) }, icon('plus'), t('plan.add_change'))));
  const changes = L.list('planned_change');
  if (!changes.length) node.append(h('p', { class: 'fmuted fsmall' }, t('plan.changes_empty')));
  for (const c of changes) {
    const cat = c.target_id ? L.categoryMap().get(c.target_id) : null;
    const what = c.target_kind === 'oneoff' ? t('plan.oneoff_line', { amount: U.signedMoney(c.value, base), date: U.date(c.from) }) : t('plan.cat_line', { name: cat ? cat.name : '—', change: c.change_kind === 'percent' ? (c.value > 0 ? '+' : '') + U.pct(c.value / 10000, 0) : U.signedMoney(c.value, base), date: U.date(c.from) });
    node.append(h('button', { type: 'button', class: 'frow', onclick: () => changeSheet(ctx, c) }, U.mono('', '#a78bfa', true, 'calendar'), h('span', { class: 'frow__main' }, h('span', { class: 'frow__title' }, what), c.note ? h('span', { class: 'frow__meta' }, c.note) : null), h('span', { class: 'frow__amt' }, icon('next'))));
  }
  return node;
}

function spendTab(ctx) {
  const L = ctx.ledger;
  const base = L.base();
  const cf = categoryForecasts(L);
  const cats = L.categoryMap();
  const node = h('div');
  const list = Array.from(cf.spend.entries()).filter(([, c]) => c.avg6 > 0 || c.f.point[1] > 0).sort((a, b) => b[1].f.point[1] - a[1].f.point[1]);
  if (!list.length) { node.append(U.empty(t('plan.spend_empty'))); return node; }
  const totalHist = [];
  const len = Math.max(...list.map(([, c]) => c.y.length));
  for (let i = 0; i < len; i++) totalHist.push(list.reduce((s, [, c]) => s + (c.y[c.y.length - len + i] || 0), 0));
  const bt = F.backtest(totalHist, 6, 1);
  const next = addMonthKey(monthKey(L.today()), 1);
  node.append(h('p', { class: 'fmuted fsmall', style: { marginBottom: '10px', maxWidth: '64ch' } }, t('plan.spend_body', { month: U.month(next) })));
  if (bt) node.append(h('div', { class: 'fchips', style: { marginBottom: '10px' } }, h('span', { class: 'fpill ' + (bt.mase <= 1 ? 'fpill--mint' : 'fpill--amber') }, t('plan.quality', { mase: bt.mase.toFixed(2), cov: U.pct(bt.coverage, 0) }))));
  const tbl = h('table', { class: 'ftable' }, h('thead', null, h('tr', null, h('th', null, t('entry.category')), h('th', { class: 'n' }, t('plan.avg6')), h('th', { class: 'n' }, t('plan.forecast')), h('th', { class: 'n' }, t('plan.likely_range')), h('th', null, t('plan.method')))));
  const tb = h('tbody');
  let tot = 0;
  for (const [g, c] of list) {
    const cat = cats.get(g);
    const pt = Math.max(0, c.f.point[1]);
    tot += pt;
    tb.append(h('tr', null, h('td', null, cat ? cat.name : t('ledger.uncategorized')), h('td', { class: 'n' }, U.money(Math.round(c.avg6), base, { compact: true })), h('td', { class: 'n' }, U.money(Math.round(pt), base, { compact: true })), h('td', { class: 'n fmuted' }, U.money(Math.round(Math.max(0, pt + c.lo)), base, { compact: true }) + ' – ' + U.money(Math.round(pt + c.hi), base, { compact: true })), h('td', { class: 'fsmall fmuted' }, t('plan.m.' + c.f.method.replace(/\+/g, '_')))));
  }
  tb.append(h('tr', { class: 'is-total' }, h('td', null, t('plan.total')), h('td', null, ''), h('td', { class: 'n' }, U.money(Math.round(tot), base)), h('td', null, ''), h('td', null, '')));
  tbl.append(tb);
  node.append(h('div', { class: 'ftable-wrap', tabindex: '0', role: 'region', 'aria-label': t('plan.tab_spend') }, tbl));
  return node;
}

function worthTab(ctx) {
  const L = ctx.ledger;
  const vs = ctx.viewState;
  const base = L.base();
  const s = L.settings();
  const nw = L.netWorth();
  const hist = L.monthlySeries(6, addMonthKey(monthKey(L.today()), -1));
  const avgSave = Math.max(0, Math.round(hist.reduce((n, m) => n + m.net, 0) / Math.max(1, hist.length)));
  if (vs.years == null) vs.years = 10;
  if (vs.contrib == null) vs.contrib = avgSave;
  if (vs.real == null) vs.real = true;
  const node = h('div');
  const years = h('input', { class: 'fi', type: 'number', min: '1', max: '50', value: String(vs.years) });
  const contrib = U.moneyField({ value: U.amountToInput(vs.contrib, base) });
  const realBox = U.checkbox(t('plan.real'), vs.real, (v) => { vs.real = v; ctx.rerender(); });
  const apply = h('button', { type: 'button', class: 'fb fb--sm', onclick: () => { vs.years = Math.max(1, Math.min(50, parseInt(years.value, 10) || 10)); vs.contrib = Math.abs(U.parseAmount(contrib.value, base) || 0); ctx.rerender(); } }, icon('sync'), t('plan.update'));
  node.append(h('div', { class: 'fcard', style: { marginBottom: '14px' } }, h('div', { class: 'ff-grid' }, U.field(t('plan.years'), years), U.field(t('plan.monthly_add'), contrib, t('plan.monthly_add_hint', { amount: U.money(avgSave, base) }))), h('div', { class: 'fb-row', style: { justifyContent: 'space-between', marginTop: '8px' } }, realBox, apply)));
  const classes = [];
  const A = s.mc.assumptions;
  let investTotal = 0;
  for (const k of ['equity', 'bond', 'metal', 'crypto', 'real_estate', 'other']) investTotal += Math.max(0, nw.byClass[k] || 0);
  for (const k of ['equity', 'bond', 'metal', 'crypto', 'real_estate', 'other', 'cash']) {
    const v = Math.max(0, nw.byClass[k] || 0);
    const a = A[k] || A.other;
    const share = investTotal > 0 ? (k === 'cash' ? 0 : v / investTotal) : (k === 'cash' ? 1 : 0);
    if (!v && !share) continue;
    classes.push({ start: v, contrib: vs.contrib * share, ret: (a.mu_bp || 0) / 10000, sigma: (a.sigma_bp || 0) / 10000, key: k });
  }
  const debt = Math.min(0, nw.byClass.debt || 0);
  const months = vs.years * 12;
  const fixed = new Array(months + 1).fill(debt);
  const sim = F.simulateGbm({ months, paths: s.mc.paths || 1000, seed: 21, classes: classes.length ? classes : [{ start: 0, contrib: vs.contrib, ret: 0, sigma: 0 }], inflation: vs.real ? (s.mc.inflation_bp || 0) / 10000 : 0, fixed });
  const labels = [];
  const lo = [], mid = [], hi = [];
  for (let y = 0; y <= vs.years; y++) { labels.push(String(parseInt(L.today().slice(0, 4), 10) + y)); const f = sim.fan[y * 12]; lo.push(f.p10); mid.push(f.p50); hi.push(f.p90); }
  const end = sim.fan[months];
  node.append(h('div', { class: 'fcard' },
    h('div', { class: 'fstats', style: { marginBottom: '12px' } },
      h('div', { class: 'fstat' }, h('span', { class: 'fstat__label' }, t('plan.median_outcome')), h('span', { class: 'fmid' }, U.money(Math.round(end.p50), base, { compact: true }))),
      h('div', { class: 'fstat' }, h('span', { class: 'fstat__label' }, t('plan.p10')), h('span', { class: 'fmid' }, U.money(Math.round(end.p10), base, { compact: true }))),
      h('div', { class: 'fstat' }, h('span', { class: 'fstat__label' }, t('plan.p90')), h('span', { class: 'fmid' }, U.money(Math.round(end.p90), base, { compact: true })))),
    lineChart({ labels, height: 230, label: t('plan.worth_chart'), series: [{ values: mid, color: '#a78bfa', label: t('plan.median_outcome') }], bands: [{ lo, hi, color: '#a78bfa', opacity: 0.16, label: t('plan.band') }], fmtY: (v) => U.money(Math.round(v), base, { compact: true }) }),
    h('p', { class: 'ff__hint', style: { marginTop: '8px' } }, vs.real ? t('plan.worth_real', { pct: U.pct((s.mc.inflation_bp || 0) / 10000, 1) }) : t('plan.worth_nominal'))));
  const asm = h('details', { style: { marginTop: '14px' } }, h('summary', { style: { cursor: 'pointer', color: 'var(--f-muted)', fontSize: '0.88rem' } }, t('plan.assumptions')));
  const tbl = h('table', { class: 'ftable' }, h('thead', null, h('tr', null, h('th', null, t('plan.asset_class')), h('th', { class: 'n' }, t('plan.return')), h('th', { class: 'n' }, t('plan.volatility')))));
  const tb = h('tbody');
  const inputs = {};
  for (const k of ['equity', 'bond', 'metal', 'crypto', 'real_estate', 'cash', 'other']) {
    const a = A[k] || { mu_bp: 0, sigma_bp: 0 };
    inputs[k] = [U.input({ value: String(a.mu_bp / 100), inputmode: 'decimal', style: { maxWidth: '80px' } }), U.input({ value: String(a.sigma_bp / 100), inputmode: 'decimal', style: { maxWidth: '80px' } })];
    tb.append(h('tr', null, h('td', null, t('invest.class.' + k)), h('td', { class: 'n' }, inputs[k][0]), h('td', { class: 'n' }, inputs[k][1])));
  }
  tbl.append(tb);
  const infl = U.input({ value: String((s.mc.inflation_bp || 0) / 100), inputmode: 'decimal' });
  asm.append(h('div', { class: 'fstack', style: { marginTop: '10px' } }, h('p', { class: 'ff__hint' }, t('plan.assumptions_hint')), h('div', { class: 'ftable-wrap' }, tbl), U.field(t('plan.inflation'), infl), h('button', { type: 'button', class: 'fb fb--sm', style: { alignSelf: 'flex-start' }, onclick: () => {
    const next = {};
    for (const k of Object.keys(inputs)) next[k] = { mu_bp: Math.round(parseFloat(inputs[k][0].value.replace(',', '.')) * 100) || 0, sigma_bp: Math.round(parseFloat(inputs[k][1].value.replace(',', '.')) * 100) || 0 };
    ctx.commit(ctx.save('settings', 'main', { mc: Object.assign({}, s.mc, { assumptions: next, inflation_bp: Math.round(parseFloat(infl.value.replace(',', '.')) * 100) || 0 }) }), t('plan.assumptions_saved'));
  } }, t('common.save'))));
  node.append(asm);
  return node;
}

function goalSheet(ctx, goal) {
  const L = ctx.ledger;
  const base = L.base();
  const g = goal || { name: '', target_minor: 0, target_date: addMonthKey(monthKey(L.today()), 24) + '-01', accounts: [], saved_minor: 0, return_bp: 600 };
  const name = U.input({ value: g.name, maxlength: '60', placeholder: t('plan.goal_ph') });
  const target = U.moneyField({ value: g.target_minor ? U.amountToInput(g.target_minor, base) : '' });
  const date = h('input', { class: 'fi', type: 'date', value: g.target_date });
  const saved = U.moneyField({ value: g.saved_minor ? U.amountToInput(g.saved_minor, base) : '' });
  const ret = U.input({ value: String((g.return_bp || 0) / 100), inputmode: 'decimal' });
  const sel = new Set(g.accounts || []);
  const chips = h('div', { class: 'fchips' });
  for (const a of L.accounts()) {
    const b = h('button', { type: 'button', class: 'fchip' + (sel.has(a.id) ? ' is-on' : ''), onclick: () => { if (sel.has(a.id)) sel.delete(a.id); else sel.add(a.id); b.classList.toggle('is-on'); } }, a.name);
    chips.append(b);
  }
  const err = h('p', { class: 'ff__err', role: 'alert' });
  const save = h('button', { type: 'button', class: 'fb fb--primary' }, t('common.save'));
  const del = goal ? h('button', { type: 'button', class: 'fb fb--danger fb--icon', 'aria-label': t('common.delete'), onclick: () => { sh.close(); ctx.commit(ctx.remove('goal', goal.id), t('plan.goal_deleted')); } }, icon('trash')) : null;
  const sh = U.sheet({ title: goal ? t('plan.edit_goal') : t('plan.add_goal'), body: h('div', { class: 'fstack' }, U.field(t('plan.goal_name'), name), h('div', { class: 'ff-grid' }, U.field(t('plan.goal_target'), target), U.field(t('plan.goal_date'), date), U.field(t('plan.goal_saved'), saved, t('plan.goal_saved_hint')), U.field(t('plan.goal_return'), ret, t('plan.goal_return_hint'))), h('span', { class: 'ff__label' }, t('plan.goal_accounts')), chips, err), foot: [del, h('button', { type: 'button', class: 'fb', onclick: () => sh.close() }, t('common.cancel')), save].filter(Boolean), focus: goal ? null : name });
  save.addEventListener('click', () => {
    const tg = U.parseAmount(target.value, base);
    if (!name.value.trim()) { err.textContent = t('plan.goal_err_name'); return; }
    if (!tg) { err.textContent = t('entry.err_amount'); return; }
    if (!isISODate(date.value)) { err.textContent = t('entry.err_date'); return; }
    const fields = { name: name.value.trim().slice(0, 60), target_minor: Math.abs(tg), target_date: date.value, saved_minor: Math.abs(U.parseAmount(saved.value, base) || 0), return_bp: Math.round(parseFloat(String(ret.value).replace(',', '.')) * 100) || 0, accounts: Array.from(sel) };
    sh.close();
    ctx.commit(ctx.save('goal', goal ? goal.id : ctx.newId(), fields), t('plan.goal_saved_toast'));
  });
}

function goalsTab(ctx) {
  const L = ctx.ledger;
  const base = L.base();
  const node = h('div');
  node.append(h('div', { class: 'ftool', style: { justifyContent: 'space-between' } }, h('p', { class: 'fmuted fsmall', style: { maxWidth: '60ch' } }, t('plan.goals_body')), h('button', { type: 'button', class: 'fb fb--primary', onclick: () => goalSheet(ctx, null) }, icon('plus'), t('plan.add_goal'))));
  const goals = L.list('goal');
  if (!goals.length) { node.append(U.empty(t('plan.goals_empty'))); return node; }
  const grid = h('div', { class: 'fgrid fgrid--3' });
  for (const g of goals) {
    let have = g.saved_minor || 0;
    for (const id of g.accounts || []) { const a = L.get('account', id); if (a) have += L.toBase(L.accountValue(a), a.currency) || 0; }
    const months = Math.max(0, monthsBetween(monthKey(L.today()), monthKey(g.target_date)));
    const r = (g.return_bp || 0) / 10000;
    const need = months > 0 ? requiredSip(g.target_minor, r, months, have) : Math.max(0, g.target_minor - have);
    const sim = F.simulateGbm({ months: Math.max(1, months), paths: 600, seed: 5, classes: [{ start: have, contrib: need, ret: r, sigma: r > 0.04 ? 0.12 : 0.02 }], target: g.target_minor });
    grid.append(h('button', { type: 'button', class: 'fcard', style: { textAlign: 'left', color: 'inherit', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '10px' }, onclick: () => goalSheet(ctx, g) },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } }, U.mono('', '#fbbf24', false, 'goal'), h('div', { style: { minWidth: 0 } }, h('div', { class: 'frow__title', style: { fontWeight: 600 } }, g.name), h('div', { class: 'frow__meta' }, t('plan.by_date', { date: U.date(g.target_date, 'month') })))),
      h('div', { class: 'fmid' }, U.money(have, base, { compact: true }), h('span', { class: 'fmuted fsmall' }, ' / ' + U.money(g.target_minor, base, { compact: true }))),
      U.bar(have, g.target_minor, { color: '#fbbf24' }),
      h('p', { class: 'fsmall fmuted' }, have >= g.target_minor ? t('plan.goal_done') : months > 0 ? t('plan.goal_need', { amount: U.money(Math.round(need), base), pct: U.pct(sim.probability, 0) }) : t('plan.goal_past'))));
  }
  node.append(grid);
  return node;
}

function calcTab(ctx) {
  const L = ctx.ledger;
  const base = L.base();
  const vs = ctx.viewState;
  const node = h('div', { class: 'fgrid fgrid--3' });
  const card = (title, fields, compute) => {
    const out = h('div', { class: 'fmid', style: { marginTop: '10px' } });
    const sub = h('p', { class: 'fsmall fmuted' });
    const run = () => { try { const r = compute(); out.textContent = r.main; sub.textContent = r.sub || ''; } catch (_) { out.textContent = '—'; sub.textContent = ''; } };
    for (const f of fields) f.input.addEventListener('input', run);
    const c = h('div', { class: 'fcard' }, h('h3', { class: 'fcard__title', style: { marginBottom: '10px' } }, title), h('div', { class: 'fstack' }, ...fields.map((f) => U.field(f.label, f.input))), out, sub);
    run();
    return c;
  };
  const num = (v) => parseFloat(String(v).replace(',', '.'));
  const sipP = U.moneyField({ value: vs.sipP || U.amountToInput(500000, base) });
  const sipR = U.input({ value: '12', inputmode: 'decimal' });
  const sipY = U.input({ value: '10', inputmode: 'decimal' });
  node.append(card(t('plan.calc_sip'), [{ label: t('plan.calc_monthly'), input: sipP }, { label: t('plan.calc_rate'), input: sipR }, { label: t('plan.calc_years'), input: sipY }], () => {
    const p = Math.abs(U.parseAmount(sipP.value, base) || 0);
    const n = Math.round(num(sipY.value) * 12);
    const fv = sipFutureValue(p, num(sipR.value) / 100, n);
    return { main: U.money(Math.round(fv), base), sub: t('plan.calc_sip_sub', { paid: U.money(p * n, base), gain: U.money(Math.round(fv - p * n), base) }) };
  }));
  const gT = U.moneyField({ value: U.amountToInput(100000000, base) });
  const gR = U.input({ value: '10', inputmode: 'decimal' });
  const gY = U.input({ value: '15', inputmode: 'decimal' });
  node.append(card(t('plan.calc_goal'), [{ label: t('plan.goal_target'), input: gT }, { label: t('plan.calc_rate'), input: gR }, { label: t('plan.calc_years'), input: gY }], () => {
    const need = requiredSip(Math.abs(U.parseAmount(gT.value, base) || 0), num(gR.value) / 100, Math.round(num(gY.value) * 12), 0);
    return { main: U.money(Math.round(need), base), sub: t('plan.calc_goal_sub') };
  }));
  const lP = U.moneyField({ value: U.amountToInput(500000000, base) });
  const lR = U.input({ value: '9', inputmode: 'decimal' });
  const lY = U.input({ value: '20', inputmode: 'decimal' });
  node.append(card(t('plan.calc_emi'), [{ label: t('plan.calc_principal'), input: lP }, { label: t('plan.calc_rate'), input: lR }, { label: t('plan.calc_years'), input: lY }], () => {
    const p = Math.abs(U.parseAmount(lP.value, base) || 0);
    const n = Math.round(num(lY.value) * 12);
    const e = emi(p, Math.round(num(lR.value) * 100), n);
    return { main: U.money(e, base), sub: t('plan.calc_emi_sub', { total: U.money(e * n, base), interest: U.money(e * n - p, base) }) };
  }));
  const dP = U.moneyField({ value: U.amountToInput(10000000, base) });
  const dR = U.input({ value: '7', inputmode: 'decimal' });
  const dY = U.input({ value: '3', inputmode: 'decimal' });
  node.append(card(t('plan.calc_fd'), [{ label: t('plan.calc_principal'), input: dP }, { label: t('plan.calc_rate'), input: dR }, { label: t('plan.calc_years'), input: dY }], () => {
    const p = Math.abs(U.parseAmount(dP.value, base) || 0);
    const v = growth(p, Math.round(num(dR.value) * 100), num(dY.value), 'quarterly');
    return { main: U.money(Math.round(v), base), sub: t('plan.calc_fd_sub') };
  }));
  return node;
}

export function render(ctx) {
  const vs = ctx.viewState;
  if (!vs.tab) vs.tab = 'cash';
  const node = h('div');
  const tabs = h('div', { class: 'ftabs', role: 'tablist' });
  for (const [k, label] of [['cash', t('plan.tab_cash')], ['spend', t('plan.tab_spend')], ['worth', t('plan.tab_worth')], ['goals', t('plan.tab_goals')], ['calc', t('plan.tab_calc')]]) {
    tabs.append(h('button', { type: 'button', role: 'tab', class: vs.tab === k ? 'is-on' : '', 'aria-selected': vs.tab === k ? 'true' : 'false', onclick: () => { vs.tab = k; ctx.rerender(); } }, label));
  }
  node.append(tabs);
  node.append(vs.tab === 'spend' ? spendTab(ctx) : vs.tab === 'worth' ? worthTab(ctx) : vs.tab === 'goals' ? goalsTab(ctx) : vs.tab === 'calc' ? calcTab(ctx) : cashTab(ctx));
  return { title: t('nav.plan'), node };
}
