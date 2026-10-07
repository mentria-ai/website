import * as U from '../ui.js';
import { barChart, donut, lineChart, legend } from '../charts.js';
import { monthKey, addMonthKey, monthRange, monthEnd, formatDate } from '../dates.js';

const { h, t, icon } = U;

function range(L, vs) {
  const cur = monthKey(L.today());
  if (vs.range === 'year') return [cur.slice(0, 4) + '-01', cur];
  if (vs.range === 'lastyear') { const y = parseInt(cur.slice(0, 4), 10) - 1; return [y + '-01', y + '-12']; }
  if (vs.range === 'custom' && vs.from && vs.to && vs.from <= vs.to) return [vs.from, vs.to];
  return [addMonthKey(cur, -11), cur];
}

function csvButton(name, rows) {
  return h('button', { type: 'button', class: 'fb fb--sm fb--ghost', onclick: () => U.downloadBlob(name, new Blob([U.csv(rows)], { type: 'text/csv;charset=utf-8' })) }, icon('download'), t('ledger.csv'));
}

function cardHead(title, ...right) {
  return h('div', { class: 'fcard__head' }, h('h2', { class: 'fcard__title' }, title), h('div', { class: 'fb-row' }, ...right));
}

function num(minor, ccy) { const d = U.decimalsOf(ccy); return (minor / 10 ** d).toFixed(d); }

export function render(ctx) {
  const L = ctx.ledger;
  const vs = ctx.viewState;
  const base = L.base();
  if (!vs.range) vs.range = '12m';
  const [from, to] = range(L, vs);
  const months = monthRange(from, to);
  const data = months.map((k) => L.monthSummary(k));
  const node = h('div');
  const fromIn = h('input', { class: 'fi', type: 'month', value: vs.from || from, onchange: (e) => { vs.from = e.target.value; ctx.rerender(); } });
  const toIn = h('input', { class: 'fi', type: 'month', value: vs.to || to, onchange: (e) => { vs.to = e.target.value; ctx.rerender(); } });
  node.append(h('div', { class: 'ftool' }, U.seg([{ value: '12m', label: t('reports.last12') }, { value: 'year', label: t('reports.this_year') }, { value: 'lastyear', label: t('reports.last_year') }, { value: 'custom', label: t('reports.custom') }], vs.range, (v) => { vs.range = v; ctx.rerender(); }), vs.range === 'custom' ? h('div', { class: 'fb-row' }, fromIn, toIn) : null));
  const totalIn = data.reduce((s, d) => s + d.income, 0);
  const totalOut = data.reduce((s, d) => s + d.expense, 0);
  node.append(h('div', { class: 'fstats fstats--4', style: { margin: '0 0 14px' } },
    h('div', { class: 'fstat' }, h('span', { class: 'fstat__label' }, t('home.income')), h('span', { class: 'fmid amt--in' }, U.money(totalIn, base, { compact: true }))),
    h('div', { class: 'fstat' }, h('span', { class: 'fstat__label' }, t('home.spent')), h('span', { class: 'fmid' }, U.money(totalOut, base, { compact: true }))),
    h('div', { class: 'fstat' }, h('span', { class: 'fstat__label' }, t('reports.saved')), h('span', { class: 'fmid ' + (totalIn - totalOut >= 0 ? 'amt--in' : 'amt--over') }, U.signedMoney(totalIn - totalOut, base, { compact: true }))),
    h('div', { class: 'fstat' }, h('span', { class: 'fstat__label' }, t('ledger.savings_rate')), h('span', { class: 'fmid' }, totalIn > 0 ? U.pct((totalIn - totalOut) / totalIn, 0) : '—'))));
  const grid = h('div', { class: 'fgrid' });
  const label = (k) => formatDate(k + '-01', U.locale(), months.length > 12 ? 'monthYearShort' : 'monthShort');
  const flow = h('div', { class: 'fcard span-2' }, cardHead(t('reports.flow'), csvButton('mentria-finance-cashflow.csv', [[t('ledger.month'), t('home.income'), t('home.spent'), t('home.net')]].concat(months.map((k, i) => [k, num(data[i].income, base), num(data[i].expense, base), num(data[i].net, base)])))));
  flow.append(barChart({ groups: months.map((k, i) => ({ label: label(k), values: [data[i].income, data[i].expense] })), colors: ['#6ef3c5', '#a78bfa'], names: [t('home.income'), t('home.spent')], height: 230, fmtY: (v) => U.money(v, base, { compact: true }), fmtTip: (v) => U.money(v, base), label: t('reports.flow') }));
  flow.append(legend([{ color: '#6ef3c5', label: t('home.income') }, { color: '#a78bfa', label: t('home.spent') }]));
  grid.append(flow);
  const cats = L.categoryMap();
  const byGroup = new Map();
  for (const d of data) {
    for (const [k, v] of d.byCat) {
      const c = cats.get(k);
      const isIncome = c ? c.kind === 'income' : k === '_income';
      if (isIncome) continue;
      const g = c ? (c.group ? cats.get(c.group) || c : c) : null;
      const key = g ? g.id : '_none';
      const e = byGroup.get(key) || { name: g ? g.name : t('ledger.uncategorized'), color: g ? g.color || U.colorFor(g.id) : '#8896a8', total: 0, series: new Array(months.length).fill(0) };
      e.total += v;
      byGroup.set(key, e);
    }
  }
  months.forEach((k, i) => {
    for (const [ck, v] of data[i].byCat) {
      const c = cats.get(ck);
      if (c ? c.kind === 'income' : ck === '_income') continue;
      const g = c ? (c.group ? cats.get(c.group) || c : c) : null;
      const e = byGroup.get(g ? g.id : '_none');
      if (e) e.series[i] += v;
    }
  });
  const groups = Array.from(byGroup.values()).filter((g) => g.total > 0).sort((a, b) => b.total - a.total);
  const mix = h('div', { class: 'fcard' }, cardHead(t('reports.mix'), csvButton('mentria-finance-categories.csv', [[t('csv.category'), t('csv.amount'), t('reports.share'), t('reports.per_month')]].concat(groups.map((g) => [g.name, num(g.total, base), (g.total / (totalOut || 1) * 100).toFixed(1) + '%', num(Math.round(g.total / months.length), base)])))));
  if (groups.length) {
    mix.append(h('div', { style: { display: 'grid', placeItems: 'center', marginBottom: '8px' } }, donut({ items: groups.map((g) => ({ label: g.name, value: g.total, color: g.color })), size: 190, center: U.money(totalOut, base, { compact: true }), sub: t('home.spent'), fmt: (v) => U.money(v, base), label: t('reports.mix') })));
    for (const g of groups.slice(0, 8)) mix.append(U.leader(h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '8px' } }, h('i', { style: { width: '8px', height: '8px', borderRadius: '3px', background: g.color } }), g.name), U.money(g.total, base, { compact: true }) + ' · ' + U.pct(g.total / (totalOut || 1), 0)));
  } else mix.append(h('p', { class: 'fmuted fsmall' }, t('reports.no_data')));
  grid.append(mix);
  const top = groups.slice(0, 6);
  const trend = h('div', { class: 'fcard' }, cardHead(t('reports.trend')));
  if (top.length) {
    trend.append(barChart({ groups: months.map((k, i) => ({ label: label(k), values: top.map((g) => g.series[i]) })), stacked: true, colors: top.map((g) => g.color), names: top.map((g) => g.name), height: 220, fmtY: (v) => U.money(v, base, { compact: true }), fmtTip: (v) => U.money(v, base), label: t('reports.trend') }));
    trend.append(legend(top.map((g) => ({ color: g.color, label: g.name }))));
  } else trend.append(h('p', { class: 'fmuted fsmall' }, t('reports.no_data')));
  grid.append(trend);
  const worth = months.map((k) => L.netWorth(k === monthKey(L.today()) ? L.today() : monthEnd(k + '-01')).total);
  const nwCard = h('div', { class: 'fcard span-2' }, cardHead(t('reports.worth'), csvButton('mentria-finance-net-worth.csv', [[t('ledger.month'), t('home.net_worth')]].concat(months.map((k, i) => [k, num(worth[i], base)])))));
  nwCard.append(lineChart({ labels: months.map(label), series: [{ values: worth, color: '#22d3ee', fill: true, label: t('home.net_worth') }], height: 210, zero: false, fmtY: (v) => U.money(Math.round(v), base, { compact: true }), label: t('reports.worth') }));
  grid.append(nwCard);
  const payees = new Map();
  for (const k of months) for (const r of L.rowsByMonth().get(k) || []) {
    if (r.kind !== 'txn' || r.amount >= 0 || !r.payee || r.base == null) continue;
    const e = payees.get(r.payee) || { name: r.payee, n: 0, total: 0 };
    e.n++;
    e.total += -r.base;
    payees.set(r.payee, e);
  }
  const topPayees = Array.from(payees.values()).sort((a, b) => b.total - a.total).slice(0, 12);
  const pc = h('div', { class: 'fcard' }, cardHead(t('reports.payees'), csvButton('mentria-finance-payees.csv', [[t('csv.payee'), t('reports.count'), t('csv.amount')]].concat(topPayees.map((p) => [p.name, p.n, num(p.total, base)])))));
  if (!topPayees.length) pc.append(h('p', { class: 'fmuted fsmall' }, t('reports.no_data')));
  for (const p of topPayees) pc.append(U.leader(h('span', null, p.name, h('span', { class: 'fmuted fsmall' }, ' × ' + p.n)), U.money(p.total, base, { compact: true })));
  grid.append(pc);
  const payers = new Map();
  const add = (name, v) => { const e = payers.get(name) || { name, total: 0 }; e.total += v; payers.set(name, e); };
  for (const a of L.list('activity')) {
    if (!['dividend', 'interest', 'dividend_reinvest'].includes(a.type) || monthKey(a.date) < from || monthKey(a.date) > to) continue;
    const inst = L.get('instrument', a.instrument);
    const v = L.toBase(Math.abs(a.amount_minor || 0), (inst && inst.currency) || base, a.date);
    if (v != null) add(inst ? inst.name : '—', v);
  }
  for (const k of months) for (const r of L.rowsByMonth().get(k) || []) {
    if (r.kind !== 'txn' || r.amount <= 0 || r.base == null) continue;
    const c = r.category ? cats.get(r.category) : null;
    if (c && (c.income_source === 'interest' || c.income_source === 'dividend')) add(r.payee || c.name, r.base);
  }
  const payerList = Array.from(payers.values()).sort((a, b) => b.total - a.total);
  const ic = h('div', { class: 'fcard' }, cardHead(t('reports.interest')));
  if (!payerList.length) ic.append(h('p', { class: 'fmuted fsmall' }, t('reports.no_interest')));
  for (const p of payerList.slice(0, 10)) ic.append(U.leader(p.name, U.money(p.total, base, { compact: true }), 'amt--in'));
  grid.append(ic);
  node.append(grid);
  return { title: t('nav.reports'), node };
}
