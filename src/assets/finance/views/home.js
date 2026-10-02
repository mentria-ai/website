import * as U from '../ui.js';
import { s } from '../ui.js';
import { sparkline } from '../charts.js';
import { monthKey, daysInMonth, parts, iso, addDays, diffDays, monthEnd, addMonthKey } from '../dates.js';
import { accountGroup } from '../ledger.js';
import { rowNode } from './ledger.js';
import { uncategorizedCount, openCategorize } from '../categorize.js';

const { h, t, icon } = U;

function ribbon(L, key, budget) {
  const p = parts(key + '-01');
  const n = daysInMonth(p.y, p.m);
  const today = L.today();
  const ms = L.monthSummary(key);
  const W = 640;
  const H = 96;
  const top = 6;
  const barArea = 56;
  const bw = W / n;
  let maxDay = 0;
  for (const v of ms.byDay.values()) if (v > maxDay) maxDay = v;
  const total = ms.expense;
  const scaleTop = Math.max(total, budget || 0, 1);
  const svg = s('svg', { class: 'fribbon', viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': t('home.ribbon_label') });
  let cum = 0;
  let path = '';
  let over = false;
  for (let d = 1; d <= n; d++) {
    const date = iso(p.y, p.m, d);
    const v = ms.byDay.get(date) || 0;
    const future = date > today;
    const bh = future ? 2 : Math.max(2, maxDay ? (v / maxDay) * (barArea - 6) : 2);
    const x = (d - 1) * bw;
    svg.append(s('rect', { class: 'day' + (date === today ? ' is-today' : future ? ' is-future' : ''), x: (x + bw * 0.18).toFixed(1), y: (top + barArea - bh).toFixed(1), width: (bw * 0.64).toFixed(1), height: bh.toFixed(1), rx: 1.5 }));
    if (!future) {
      cum += v;
      const y = top + barArea + 30 - (cum / scaleTop) * (barArea + 24);
      path += (path ? 'L' : 'M') + (x + bw / 2).toFixed(1) + ' ' + Math.max(2, y).toFixed(1);
      if (budget && cum > budget * (d / n) * 1.0001) over = true;
    }
  }
  if (budget) {
    const y0 = top + barArea + 30;
    const y1 = top + barArea + 30 - (budget / scaleTop) * (barArea + 24);
    svg.append(s('path', { class: 'pace', d: 'M' + (bw / 2).toFixed(1) + ' ' + y0 + 'L' + (W - bw / 2).toFixed(1) + ' ' + y1.toFixed(1) }));
  }
  if (path && budget) svg.append(s('path', { class: 'cum' + (cum > budget || over ? ' is-over' : ''), d: path }));
  for (const d of [1, Math.ceil(n / 2), n]) svg.append(s('text', { x: ((d - 0.5) * bw).toFixed(1), y: H - 1, 'text-anchor': d === 1 ? 'start' : d === n ? 'end' : 'middle' }, String(d)));
  return svg;
}

function heroCard(ctx) {
  const L = ctx.ledger;
  const base = L.base();
  const key = monthKey(L.today());
  const bs = L.budgetSummary(key);
  const ms = L.monthSummary(key);
  const today = L.today();
  const p = parts(today);
  const n = daysInMonth(p.y, p.m);
  const left = n - p.d;
  const budget = bs.total > 0 ? bs.total : null;
  const spent = ms.expense;
  const card = h('section', { class: 'fcard span-2', 'aria-labelledby': 'fin-hero-h' });
  card.append(h('div', { class: 'fcard__head' },
    h('h2', { class: 'fcard__title', id: 'fin-hero-h' }, t('home.spent_in', { month: U.month(key) })),
    h('button', { type: 'button', class: 'fcard__link', onclick: () => ctx.go('budgets') }, budget ? t('home.budgets') : t('home.set_budgets'))));
  card.append(h('div', { class: 'fbig' }, U.money(spent, base)));
  const sub = h('p', { class: 'fmuted fsmall', style: { marginTop: '6px' } });
  if (budget) {
    const ratio = spent / budget;
    sub.append(t('home.of_budget', { budget: U.money(budget, base), pct: U.pct(ratio, 0) }));
    card.append(sub, h('div', { style: { marginTop: '10px' } }, U.bar(spent, budget, { marker: p.d / n })));
  } else {
    sub.append(t('home.no_budget'));
    card.append(sub);
  }
  card.append(ribbon(L, key, budget));
  const perDay = p.d ? Math.round(spent / p.d) : 0;
  const stats = h('div', { class: 'fstats fstats--4', style: { marginTop: '12px' } },
    stat(t('home.income'), U.money(ms.income, base), 'amt--in'),
    stat(t('home.net'), U.signedMoney(ms.income - spent, base), ms.income - spent >= 0 ? 'amt--in' : 'amt--over'),
    stat(t('home.per_day'), U.money(perDay, base)),
    budget ? stat(t('home.left_per_day', { n: left }), left > 0 ? U.money(Math.max(0, Math.round((budget - spent) / left)), base) : '—', budget - spent < 0 ? 'amt--over' : '') : stat(t('home.days_left'), String(left))
  );
  card.append(stats);
  if (ms.unconverted) card.append(h('p', { class: 'ff__hint', style: { marginTop: '8px' } }, U.tp('home.unconverted', ms.unconverted)));
  return card;
}

function stat(label, value, cls) {
  return h('div', { class: 'fstat' }, h('span', { class: 'fstat__label' }, label), h('span', { class: 'fmid ' + (cls || '') }, value));
}

function upcomingCard(ctx) {
  const L = ctx.ledger;
  const list = L.upcoming(14).slice(0, 6);
  const card = h('section', { class: 'fcard' }, h('div', { class: 'fcard__head' }, h('h2', { class: 'fcard__title' }, t('home.upcoming')), h('button', { type: 'button', class: 'fcard__link', onclick: () => ctx.go('subs') }, t('home.all'))));
  if (!list.length) {
    card.append(h('p', { class: 'fmuted fsmall' }, L.schedules().length ? t('home.nothing_due') : t('home.no_schedules')));
    if (!L.schedules().length) card.append(h('button', { type: 'button', class: 'fb fb--sm', style: { marginTop: '10px' }, onclick: () => ctx.go('subs', { add: '1' }) }, icon('plus'), t('subs.add')));
    return card;
  }
  for (const u of list) {
    const when = u.days === 0 ? t('home.today') : u.days === 1 ? t('home.tomorrow') : U.date(u.date, 'dayMonth');
    card.append(U.leader(h('span', null, u.schedule.name || u.schedule.payee || '—', ' ', h('span', { class: 'fmuted fsmall' }, when)), U.money(Math.abs(u.amount), u.currency), u.amount > 0 ? 'amt--in' : ''));
  }
  const total = list.filter((u) => u.amount < 0).reduce((n, u) => n + (L.toBase(Math.abs(u.amount), u.currency) || 0), 0);
  card.append(h('p', { class: 'fmuted fsmall', style: { marginTop: '8px' } }, t('home.due_total', { amount: U.money(total, L.base()) })));
  return card;
}

function worthCard(ctx) {
  const L = ctx.ledger;
  const base = L.base();
  const today = L.today();
  const nw = L.netWorth(today);
  const ago = L.netWorth(addDays(today, -30));
  const delta = nw.total - ago.total;
  const series = [];
  const cur = monthKey(today);
  for (let i = 5; i >= 1; i--) series.push(L.netWorth(monthEnd(addMonthKey(cur, -i) + '-01')).total);
  series.push(nw.total);
  const card = h('section', { class: 'fcard' }, h('div', { class: 'fcard__head' }, h('h2', { class: 'fcard__title' }, t('home.net_worth')), h('button', { type: 'button', class: 'fcard__link', onclick: () => ctx.go('accounts') }, t('home.accounts'))));
  card.append(h('div', { style: { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '12px' } },
    h('div', { style: { minWidth: 0 } }, h('div', { class: 'fbig fnowrap', style: { fontSize: 'clamp(1.5rem, 5vw, 2rem)' } }, U.money(nw.total, base, { compact: true })),
      h('p', { class: 'fsmall ' + (delta >= 0 ? 'amt--in' : 'amt--over'), style: { marginTop: '4px' } }, t('home.delta_30', { amount: U.signedMoney(delta, base, { compact: true }) }))),
    sparkline(series, delta >= 0 ? '#6ef3c5' : '#f472b6', 120, 40)));
  if (nw.missing) card.append(h('p', { class: 'ff__hint', style: { marginTop: '8px' } }, t('home.missing_fx')));
  const groups = Object.entries(nw.byGroup).filter(([, v]) => v !== 0).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  if (groups.length > 1) {
    const box = h('div', { style: { marginTop: '10px' } });
    for (const [g, v] of groups.slice(0, 5)) box.append(U.leader(t('accounts.group.' + g), U.money(v, base, { compact: true }), v < 0 ? 'amt--over' : ''));
    card.append(box);
  }
  return card;
}

function accountsCard(ctx) {
  const L = ctx.ledger;
  const accts = L.accounts().filter((a) => ['cash', 'credit'].includes(accountGroup(a.type)));
  const card = h('section', { class: 'fcard' }, h('div', { class: 'fcard__head' }, h('h2', { class: 'fcard__title' }, t('home.cash_cards')), h('button', { type: 'button', class: 'fcard__link', onclick: () => ctx.go('accounts') }, t('home.manage'))));
  if (!accts.length) { card.append(h('p', { class: 'fmuted fsmall' }, t('home.no_accounts'))); return card; }
  for (const a of accts.slice(0, 7)) {
    const bal = L.balance(a.id);
    card.append(h('button', { type: 'button', class: 'frow', onclick: () => ctx.go('ledger', { account: a.id }) },
      U.mono(a.name, a.color, true, a.type === 'credit_card' ? 'card' : a.type === 'cash' ? 'coins' : 'bank'),
      h('span', { class: 'frow__main' }, h('span', { class: 'frow__title' }, a.name), h('span', { class: 'frow__meta' }, t('accounts.type.' + a.type) + (a.currency !== L.base() ? ' · ' + a.currency : ''))),
      h('span', { class: 'frow__amt ' + (bal < 0 ? 'amt--over' : '') }, U.money(bal, a.currency))));
  }
  return card;
}

function budgetCard(ctx) {
  const L = ctx.ledger;
  const base = L.base();
  const key = monthKey(L.today());
  const bs = L.budgetSummary(key);
  const items = bs.items.filter((it) => it.spent > 0 || it.budget).sort((a, b) => {
    const ra = a.budget ? a.spent / a.budget : 0;
    const rb = b.budget ? b.spent / b.budget : 0;
    return rb - ra || b.spent - a.spent;
  }).slice(0, 5);
  const card = h('section', { class: 'fcard' }, h('div', { class: 'fcard__head' }, h('h2', { class: 'fcard__title' }, t('home.categories')), h('button', { type: 'button', class: 'fcard__link', onclick: () => ctx.go('budgets') }, t('home.all'))));
  if (!items.length && !bs.uncategorized) { card.append(h('p', { class: 'fmuted fsmall' }, t('home.no_spend'))); return card; }
  const p = parts(L.today());
  const marker = p.d / daysInMonth(p.y, p.m);
  const maxSpent = Math.max(1, bs.uncategorized, ...items.map((i) => i.spent));
  for (const it of items) {
    card.append(h('div', { style: { padding: '7px 0' } },
      h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '8px', fontSize: '0.88rem', marginBottom: '6px' } },
        h('span', { style: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 } }, h('i', { style: { width: '8px', height: '8px', borderRadius: '3px', background: it.group.color || 'var(--f-in)', flex: '0 0 auto' } }), h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, it.group.name)),
        h('span', { class: 'fnum ' + (it.budget && it.spent > it.budget ? 'amt--over' : '') }, U.money(it.spent, base, { compact: true }), it.budget ? h('span', { class: 'fmuted' }, ' / ' + U.money(it.budget, base, { compact: true })) : null)),
      it.budget ? U.bar(it.spent, it.budget, { marker, color: it.group.color }) : U.bar(it.spent, maxSpent, { color: 'rgba(255,255,255,0.22)' })));
  }
  if (bs.uncategorized) {
    card.append(h('button', { type: 'button', class: 'frow', style: { gridTemplateColumns: 'minmax(0,1fr) auto', borderBottom: 0 }, onclick: () => openCategorize(ctx) },
      h('span', { class: 'frow__main' }, h('span', { class: 'frow__title' }, t('ledger.uncategorized')), h('span', { class: 'frow__meta' }, t('categorize.sort'))),
      h('span', { class: 'frow__amt' }, U.money(bs.uncategorized, base, { compact: true }))));
  }
  return card;
}

function recentCard(ctx) {
  const L = ctx.ledger;
  const rows = L.rows().slice(0, 6);
  const card = h('section', { class: 'fcard' }, h('div', { class: 'fcard__head' }, h('h2', { class: 'fcard__title' }, t('home.recent')), h('button', { type: 'button', class: 'fcard__link', onclick: () => ctx.go('ledger') }, t('home.all'))));
  if (!rows.length) { card.append(h('p', { class: 'fmuted fsmall' }, t('home.no_rows'))); return card; }
  for (const r of rows) card.append(rowNode(ctx, r, { showDate: true }));
  return card;
}

function taxCard(ctx) {
  const L = ctx.ledger;
  const y = L.today().slice(0, 4);
  const prof = L.get('tax_profile', 'taxp:' + y);
  if (!prof) return null;
  const card = h('section', { class: 'fcard' }, h('div', { class: 'fcard__head' }, h('h2', { class: 'fcard__title' }, t('home.tax')), h('button', { type: 'button', class: 'fcard__link', onclick: () => ctx.go('taxes') }, t('home.open'))));
  card.append(h('p', { class: 'fmuted fsmall' }, t('home.tax_hint')));
  return card;
}

function banners(ctx) {
  const L = ctx.ledger;
  const out = [];
  const conflicts = L.conflicts().length;
  if (conflicts) out.push(h('div', { class: 'fbanner fbanner--pink' }, icon('alert'), h('span', null, U.tp('home.conflicts', conflicts)), h('button', { type: 'button', class: 'fb fb--sm', onclick: () => ctx.go('devices', { tab: 'conflicts' }) }, t('home.review'))));
  const unc = uncategorizedCount(L);
  if (unc >= 5) out.push(h('div', { class: 'fbanner fbanner--mint' }, icon('filter'), h('span', null, U.tp('categorize.banner', unc)), h('button', { type: 'button', class: 'fb fb--sm', onclick: () => openCategorize(ctx) }, t('categorize.sort'))));
  const missing = L.missingRates();
  if (missing.length) out.push(h('div', { class: 'fbanner' }, icon('info'), h('span', null, t('home.fx_banner', { list: missing.join(', '), base: L.base() })), h('button', { type: 'button', class: 'fb fb--sm', onclick: () => ctx.go('accounts', { tab: 'fx' }) }, t('home.add_rates'))));
  const recs = L.rows().length;
  const lastExport = ctx.local.last_export_at;
  const days = L.settings().export_reminder_days || 30;
  const created = (L.get('settings', 'main') || {}).created;
  const age = lastExport ? diffDays(lastExport.slice(0, 10), L.today()) : created ? diffDays(created.slice(0, 10), L.today()) : 0;
  const pairedOthers = L.devices().filter((d) => d.id !== ctx.engine.deviceId).length;
  if (recs >= 50 && age >= (lastExport ? days : 7) && !ctx.viewState.hideExport) {
    out.push(h('div', { class: 'fbanner fbanner--mint' }, icon('download'), h('span', null, pairedOthers ? t('home.export_paired') : t('home.export_nudge')),
      h('button', { type: 'button', class: 'fb fb--sm', onclick: () => ctx.go('settings', { tab: 'backup' }) }, t('home.export')),
      h('button', { type: 'button', class: 'fb fb--ghost fb--sm', 'aria-label': t('common.dismiss'), onclick: () => { ctx.viewState.hideExport = true; ctx.rerender(); } }, icon('close'))));
  }
  return out;
}

function welcomeCard(ctx) {
  return h('section', { class: 'fcard span-2' },
    h('h2', { style: { fontSize: '1.15rem', marginBottom: '8px' } }, t('home.welcome_title')),
    h('p', { class: 'fmuted', style: { maxWidth: '60ch', lineHeight: '1.55' } }, t('home.welcome_body')),
    h('div', { class: 'fb-row', style: { marginTop: '14px' } },
      h('button', { type: 'button', class: 'fb fb--primary', onclick: () => ctx.openEntry({}) }, icon('plus'), t('home.first_entry')),
      h('button', { type: 'button', class: 'fb', onclick: () => ctx.go('import') }, icon('import'), t('home.import')),
      h('button', { type: 'button', class: 'fb', onclick: () => ctx.go('accounts', { add: '1' }) }, icon('accounts'), t('home.add_account')),
      h('button', { type: 'button', class: 'fb', onclick: () => ctx.go('devices') }, icon('devices'), t('home.pair'))));
}

export function render(ctx) {
  const L = ctx.ledger;
  const node = h('div');
  for (const b of banners(ctx)) node.append(b);
  const grid = h('div', { class: 'fgrid fgrid--3' });
  if (!L.rows().length) grid.append(welcomeCard(ctx));
  grid.append(heroCard(ctx), upcomingCard(ctx), budgetCard(ctx), worthCard(ctx), accountsCard(ctx), recentCard(ctx));
  const tax = taxCard(ctx);
  if (tax) grid.append(tax);
  node.append(grid);
  return { title: t('nav.home'), node };
}
