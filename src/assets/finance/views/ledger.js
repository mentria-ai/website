import * as U from '../ui.js';
import { barChart, donut } from '../charts.js';
import { monthKey, addMonthKey, formatDate } from '../dates.js';
import { openCategorize } from '../categorize.js';

const { h, t, icon } = U;
const PAGE = 200;

export function rowTitle(L, r) {
  const cats = L.categoryMap();
  if (r.kind === 'xfer') {
    const other = L.get('account', r.other);
    return r.leg === 'out' ? t('ledger.transfer_to', { name: other ? other.name : '—' }) : t('ledger.transfer_from', { name: other ? other.name : '—' });
  }
  if (r.payee) return r.payee;
  if (r.lines) return t('ledger.split');
  const c = r.category ? cats.get(r.category) : null;
  if (c) return c.name;
  return r.note || t('ledger.untitled');
}

export function rowNode(ctx, r, opts) {
  const o = opts || {};
  const L = ctx.ledger;
  const cats = L.categoryMap();
  const acct = L.get('account', r.account);
  const c = r.category ? cats.get(r.category) : null;
  const metaParts = [];
  if (o.showDate) metaParts.push(U.date(r.date, 'dayMonth'));
  if (r.kind === 'txn') {
    if (r.lines) metaParts.push(U.tp('ledger.split_n', r.lines.length));
    else if (c && r.payee) metaParts.push(c.name);
    else if (!c) metaParts.push(t('ledger.uncategorized'));
  }
  if (acct && !o.hideAccount && L.accounts().length > 1) metaParts.push(acct.name);
  if (r.note && (r.payee || c)) metaParts.push(r.note);
  const iconEl = r.kind === 'xfer' ? U.mono('', '#a78bfa', false, 'transfer') : r.lines ? U.mono('', '#22d3ee', false, 'filter') : c ? U.mono(c.icon || c.name, c.color) : U.mono('?', '#8896a8');
  const amt = h('span', { class: 'frow__amt ' + (r.amount > 0 ? 'amt--in' : 'amt--out') }, U.signedMoney(r.amount, r.currency));
  if (r.currency !== L.base() && r.base != null) amt.append(h('small', null, '≈ ' + U.money(Math.abs(r.base), L.base())));
  if (o.running != null) amt.append(h('small', null, U.money(o.running, r.currency)));
  return h('button', { type: 'button', class: 'frow', onclick: () => ctx.openEntry(r.kind === 'xfer' ? { transferId: r.id } : { id: r.id }) },
    iconEl,
    h('span', { class: 'frow__main' }, h('span', { class: 'frow__title' }, rowTitle(L, r)), h('span', { class: 'frow__meta' }, metaParts.join(' · '))),
    amt);
}

function filters(ctx, vs) {
  const L = ctx.ledger;
  const search = U.input({ type: 'search', placeholder: t('ledger.search_ph'), value: vs.q || '', 'aria-label': t('nav.search') });
  search.addEventListener('input', U.debounce(() => { vs.q = search.value; vs.limit = PAGE; ctx.rerender(); setTimeout(() => { const el = document.querySelector('.fin-page input[type=search]'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 0); }, 250));
  const acct = U.select([{ value: '', label: t('ledger.all_accounts') }].concat(L.accounts(true).map((a) => ({ value: a.id, label: a.name }))), vs.account || '', { 'aria-label': t('ledger.account_filter'), onchange: (e) => { vs.account = e.target.value; vs.limit = PAGE; ctx.rerender(); } });
  const catOpts = [{ value: '', label: t('ledger.all_categories') }, { value: '_none', label: t('ledger.uncategorized') }];
  for (const { group, children } of L.categoryTree()) {
    catOpts.push({ value: group.id, label: group.name });
    for (const ch of children) catOpts.push({ value: ch.id, label: ' ' + ch.name });
  }
  const cat = U.select(catOpts, vs.category || '', { 'aria-label': t('ledger.category_filter'), onchange: (e) => { vs.category = e.target.value; vs.limit = PAGE; ctx.rerender(); } });
  return h('div', { class: 'ftool' }, search, acct, cat);
}

function monthStepper(ctx, vs, unit) {
  const label = unit === 'year' ? vs.month.slice(0, 4) : U.month(vs.month);
  const step = (d) => { vs.month = addMonthKey(vs.month, unit === 'year' ? d * 12 : d); ctx.rerender(); };
  return h('div', { class: 'fmonth' },
    h('button', { type: 'button', class: 'fb fb--ghost fb--icon', 'aria-label': t('common.previous'), onclick: () => step(-1) }, icon('back')),
    h('span', { class: 'fmonth__label' }, label),
    h('button', { type: 'button', class: 'fb fb--ghost fb--icon', 'aria-label': t('common.next'), onclick: () => step(1) }, icon('next')));
}

function matchRow(L, r, vs) {
  if (vs.account && r.account !== vs.account) return false;
  if (vs.category) {
    if (vs.category === '_none') { if (r.kind !== 'txn' || r.category || r.lines) return false; }
    else {
      const ids = r.lines ? r.lines.map((x) => x.category) : [r.category];
      const ok = ids.some((id) => id === vs.category || (L.categoryMap().get(id) || {}).group === vs.category);
      if (!ok) return false;
    }
  }
  return true;
}

function dayView(ctx, vs) {
  const L = ctx.ledger;
  const node = h('div');
  const rows = (vs.q ? L.search(vs.q, 5000) : vs.scope === 'month' ? (L.rowsByMonth().get(vs.month) || []) : L.rows()).filter((r) => matchRow(L, r, vs));
  if (!rows.length) {
    node.append(U.empty(vs.q || vs.account || vs.category ? t('ledger.no_match') : t('ledger.empty'), h('button', { type: 'button', class: 'fb fb--sm', onclick: () => ctx.openEntry({}) }, icon('plus'), t('nav.add'))));
    return node;
  }
  const running = vs.account ? L.runningBalances(vs.account) : null;
  const shown = rows.slice(0, vs.limit || PAGE);
  let day = null;
  let dayRows = [];
  const flush = () => {
    if (!day) return;
    const total = dayRows.reduce((n, r) => n + (r.kind === 'txn' && r.base != null ? r.base : 0), 0);
    node.append(h('div', { class: 'fday' }, h('b', null, U.date(day, 'weekday')), h('span', { class: 'fnum' }, total ? U.signedMoney(total, L.base()) : '')));
    for (const r of dayRows) node.append(rowNode(ctx, r, { hideAccount: !!vs.account, running: running ? running.get(r.kind + r.id + (r.leg || '')) : null }));
  };
  for (const r of shown) {
    if (r.date !== day) { flush(); day = r.date; dayRows = []; }
    dayRows.push(r);
  }
  flush();
  if (rows.length > shown.length) {
    node.append(h('div', { style: { display: 'flex', justifyContent: 'center', padding: '16px' } },
      h('button', { type: 'button', class: 'fb', onclick: () => { vs.limit = (vs.limit || PAGE) + PAGE * 2; ctx.rerender(); } }, t('ledger.more', { n: U.fmtInt(rows.length - shown.length) }))));
  }
  return node;
}

function monthView(ctx, vs) {
  const L = ctx.ledger;
  const base = L.base();
  const ms = L.monthSummary(vs.month);
  const node = h('div');
  const cats = L.categoryMap();
  const groups = new Map();
  for (const [k, v] of ms.byCat) {
    const c = cats.get(k);
    const isIncome = c ? c.kind === 'income' : k === '_income';
    if (isIncome) continue;
    const g = c ? (c.group ? cats.get(c.group) || c : c) : null;
    const gid = g ? g.id : '_none';
    const e = groups.get(gid) || { group: g, total: 0, kids: new Map() };
    e.total += v;
    if (c && c.group) e.kids.set(c.id, (e.kids.get(c.id) || 0) + v);
    groups.set(gid, e);
  }
  const list = Array.from(groups.values()).filter((g) => g.total !== 0).sort((a, b) => b.total - a.total);
  node.append(h('div', { class: 'fstats', style: { margin: '6px 0 16px' } },
    h('div', { class: 'fstat' }, h('span', { class: 'fstat__label' }, t('home.spent')), h('span', { class: 'fmid' }, U.money(ms.expense, base))),
    h('div', { class: 'fstat' }, h('span', { class: 'fstat__label' }, t('home.income')), h('span', { class: 'fmid amt--in' }, U.money(ms.income, base))),
    h('div', { class: 'fstat' }, h('span', { class: 'fstat__label' }, t('home.net')), h('span', { class: 'fmid ' + (ms.net >= 0 ? 'amt--in' : 'amt--over') }, U.signedMoney(ms.net, base)))));
  if (!list.length) { node.append(U.empty(t('ledger.month_empty'))); return node; }
  const wrap = h('div', { class: 'fgrid' });
  const chart = h('div', { class: 'fcard', style: { display: 'grid', placeItems: 'center' } }, donut({ items: list.map((g) => ({ label: g.group ? g.group.name : t('ledger.uncategorized'), value: g.total, color: g.group ? g.group.color || U.colorFor(g.group.id) : '#8896a8' })), size: 200, center: U.money(ms.expense, base, { compact: true }), sub: U.month(vs.month, true), fmt: (v) => U.money(v, base), label: t('ledger.by_category') }));
  const table = h('div', { class: 'fcard' });
  for (const g of list) {
    const gid = g.group ? g.group.id : '_none';
    const b = g.group ? L.budgetFor(g.group.id, vs.month) : null;
    table.append(h('button', { type: 'button', class: 'frow', onclick: () => { vs.view = 'day'; vs.scope = 'month'; vs.category = gid; ctx.rerender(); } },
      g.group ? U.mono(g.group.icon || g.group.name, g.group.color, true) : U.mono('?', '#8896a8', true),
      h('span', { class: 'frow__main' }, h('span', { class: 'frow__title' }, g.group ? g.group.name : t('ledger.uncategorized')), h('span', { class: 'frow__meta' }, U.pct(g.total / (ms.expense || 1), 0) + (b ? ' · ' + t('ledger.of_budget', { amount: U.money(b, base, { compact: true }) }) : ''))),
      h('span', { class: 'frow__amt ' + (b && g.total > b ? 'amt--over' : '') }, U.money(g.total, base))));
  }
  wrap.append(chart, table);
  node.append(wrap);
  return node;
}

function yearView(ctx, vs) {
  const L = ctx.ledger;
  const base = L.base();
  const year = vs.month.slice(0, 4);
  const months = [];
  for (let m = 1; m <= 12; m++) months.push(year + '-' + String(m).padStart(2, '0'));
  const data = months.map((k) => L.monthSummary(k));
  const node = h('div');
  const totalIn = data.reduce((n, d) => n + d.income, 0);
  const totalOut = data.reduce((n, d) => n + d.expense, 0);
  node.append(h('div', { class: 'fstats', style: { margin: '6px 0 16px' } },
    h('div', { class: 'fstat' }, h('span', { class: 'fstat__label' }, t('ledger.year_spent')), h('span', { class: 'fmid' }, U.money(totalOut, base))),
    h('div', { class: 'fstat' }, h('span', { class: 'fstat__label' }, t('ledger.year_income')), h('span', { class: 'fmid amt--in' }, U.money(totalIn, base))),
    h('div', { class: 'fstat' }, h('span', { class: 'fstat__label' }, t('ledger.savings_rate')), h('span', { class: 'fmid' }, totalIn > 0 ? U.pct((totalIn - totalOut) / totalIn, 0) : '—'))));
  const card = h('div', { class: 'fcard' });
  card.append(barChart({
    groups: months.map((k, i) => ({ label: formatDate(k + '-01', U.locale(), 'monthShort'), values: [data[i].income, data[i].expense], dim: k > monthKey(L.today()) })),
    colors: ['#6ef3c5', '#a78bfa'], names: [t('home.income'), t('home.spent')], height: 220,
    fmtY: (v) => U.money(v, base, { compact: true }), fmtTip: (v) => U.money(v, base), label: t('ledger.year_chart')
  }));
  card.append(h('div', { class: 'flegend' }, h('span', null, h('i', { style: { '--c': '#6ef3c5' } }), t('home.income')), h('span', null, h('i', { style: { '--c': '#a78bfa' } }), t('home.spent'))));
  node.append(card);
  const tbl = h('table', { class: 'ftable' }, h('thead', null, h('tr', null, h('th', null, t('ledger.month')), h('th', { class: 'n' }, t('home.income')), h('th', { class: 'n' }, t('home.spent')), h('th', { class: 'n' }, t('home.net')))));
  const tb = h('tbody');
  months.forEach((k, i) => {
    if (!data[i].income && !data[i].expense) return;
    tb.append(h('tr', { style: { cursor: 'pointer' }, onclick: () => { vs.month = k; vs.view = 'month'; ctx.rerender(); } }, h('td', null, U.month(k)), h('td', { class: 'n amt--in' }, U.money(data[i].income, base)), h('td', { class: 'n' }, U.money(data[i].expense, base)), h('td', { class: 'n ' + (data[i].net >= 0 ? 'amt--in' : 'amt--over') }, U.signedMoney(data[i].net, base))));
  });
  tbl.append(tb);
  node.append(h('div', { class: 'ftable-wrap', style: { marginTop: '14px' } }, tbl));
  return node;
}

function exportCsv(ctx, vs) {
  const L = ctx.ledger;
  const rows = (vs.q ? L.search(vs.q, 100000) : L.rows()).filter((r) => matchRow(L, r, vs));
  const cats = L.categoryMap();
  const out = [[t('csv.date'), t('csv.account'), t('csv.payee'), t('csv.category'), t('csv.note'), t('csv.amount'), t('csv.currency'), t('csv.base_amount'), t('csv.base_currency'), t('csv.tags')]];
  for (const r of rows) {
    const acct = L.get('account', r.account);
    const c = r.category ? cats.get(r.category) : null;
    out.push([r.date, acct ? acct.name : '', r.kind === 'xfer' ? rowTitle(L, r) : r.payee, c ? c.name : r.lines ? t('ledger.split') : '', r.note, (r.amount / 10 ** U.decimalsOf(r.currency)).toFixed(U.decimalsOf(r.currency)), r.currency, r.base == null ? '' : (r.base / 10 ** U.decimalsOf(L.base())).toFixed(U.decimalsOf(L.base())), L.base(), (r.tags || []).join(' ')]);
  }
  U.downloadBlob('mentria-finance-transactions-' + L.today() + '.csv', new Blob([U.csv(out)], { type: 'text/csv;charset=utf-8' }));
}

export function render(ctx) {
  const L = ctx.ledger;
  const vs = ctx.viewState;
  if (!vs.month) vs.month = monthKey(L.today());
  if (!vs.view) vs.view = 'day';
  if (ctx.params.account && vs.paramAccount !== ctx.params.account) { vs.account = ctx.params.account; vs.paramAccount = ctx.params.account; vs.view = 'day'; vs.scope = null; }
  if (!vs.limit) vs.limit = PAGE;
  const node = h('div');
  const tabs = h('div', { class: 'ftool', style: { justifyContent: 'space-between' } },
    U.seg([{ value: 'day', label: t('ledger.view_list') }, { value: 'month', label: t('ledger.view_month') }, { value: 'year', label: t('ledger.view_year') }], vs.view, (v) => { vs.view = v; if (v === 'day') vs.scope = null; ctx.rerender(); }),
    h('div', { class: 'fb-row' },
      vs.view !== 'day' || vs.scope === 'month' ? monthStepper(ctx, vs, vs.view === 'year' ? 'year' : 'month') : null,
      h('button', { type: 'button', class: 'fb fb--sm', onclick: () => exportCsv(ctx, vs) }, icon('download'), t('ledger.csv'))));
  node.append(tabs);
  if (vs.view === 'day') {
    node.append(filters(ctx, vs));
    if (vs.category === '_none') node.append(h('div', { class: 'fb-row', style: { marginBottom: '8px' } }, h('button', { type: 'button', class: 'fb fb--sm', onclick: () => openCategorize(ctx) }, icon('filter'), t('categorize.sort'))));
    if (vs.scope === 'month') node.append(h('div', { class: 'fchips', style: { marginBottom: '8px' } }, h('button', { type: 'button', class: 'fchip is-on', onclick: () => { vs.scope = null; vs.category = ''; ctx.rerender(); } }, U.month(vs.month), ' ', icon('close'))));
    if (vs.account) {
      const a = L.get('account', vs.account);
      if (a) node.append(h('div', { class: 'fcard', style: { marginBottom: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' } },
        h('div', null, h('div', { class: 'fsmall fmuted' }, a.name), h('div', { class: 'fmid' }, U.money(L.balance(a.id), a.currency))),
        h('button', { type: 'button', class: 'fb fb--sm', onclick: () => ctx.go('accounts', { id: a.id }) }, t('ledger.account_details'))));
    }
    node.append(dayView(ctx, vs));
  } else if (vs.view === 'month') node.append(monthView(ctx, vs));
  else node.append(yearView(ctx, vs));
  return {
    title: t('nav.ledger'),
    node,
    after: () => {
      if (ctx.params.q && !vs.focused) {
        vs.focused = true;
        const el = document.querySelector('.fin-page input[type=search]');
        if (el) el.focus();
      }
    }
  };
}
