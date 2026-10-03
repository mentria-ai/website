import * as U from '../ui.js';
import { ACCOUNT_TYPES, INVEST_TYPES, accountGroup } from '../ledger.js';
import { COMMON_CCY } from '../defaults.js';
import { isCurrency, rateE6From, minorToDecimal, normalizeNumber, trimDecimal, decimalToInput, formatDecimal } from '../money.js';
import { isISODate } from '../dates.js';

const { h, t, icon } = U;
const GROUP_ORDER = ['cash', 'credit', 'invest', 'deposit', 'asset', 'liability'];

function ccyOptions(L, selected) {
  const set = new Set([L.base()].concat(COMMON_CCY));
  for (const a of L.accounts(true)) if (a.currency) set.add(a.currency);
  if (selected) set.add(selected);
  let names = null;
  try { names = new Intl.DisplayNames([U.uiLang()], { type: 'currency' }); } catch (_) {}
  return Array.from(set).map((c) => ({ value: c, label: c + (names ? ' · ' + names.of(c) : '') }));
}

export function signedAmount(text, ccy, owed) {
  const v = U.parseAmount(text, ccy);
  if (v == null) return null;
  return v < 0 || owed ? -Math.abs(v) : Math.abs(v);
}

function syncOwed(input, box, ccy) {
  input.addEventListener('change', () => {
    const c = ccy();
    const v = U.parseAmount(input.value, c);
    if (v == null || v >= 0) return;
    box.checked = true;
    input.value = U.amountToInput(v, c);
  });
}

export function accountBills(L, id) {
  return L.schedules(true).filter((s) => s.account === id);
}

export function deleteAccountOps(ctx, id) {
  const ops = ctx.remove('account', id);
  for (const s of accountBills(ctx.ledger, id)) ops.push(...ctx.remove('schedule', s.id));
  return ops;
}

function rateText(r6) { return formatDecimal(trimDecimal(minorToDecimal(r6, 6)), U.locale()); }

export function accountSheet(ctx, id) {
  const L = ctx.ledger;
  const a = id ? L.get('account', id) : null;
  const st = Object.assign({ name: '', type: 'bank', currency: L.base(), opening_minor: 0, opening_date: L.today(), institution: '', number_hint: '', color: null, include_in_net_worth: true, lot_method: 'fifo', closed: false, credit_limit_minor: null }, a || {});
  const name = U.input({ value: st.name, maxlength: '60', placeholder: t('accounts.name_ph') });
  const type = U.select(ACCOUNT_TYPES.map((x) => ({ value: x, label: t('accounts.type.' + x) })), st.type);
  const ccy = U.select(ccyOptions(L, st.currency), st.currency);
  const opening = U.moneyField({ value: st.opening_minor ? U.amountToInput(st.opening_minor, st.currency) : '', placeholder: '0' });
  const openNeg = U.checkbox(t('accounts.opening_owed'), (st.opening_minor || 0) < 0, () => {});
  const openBox = openNeg.querySelector('input');
  syncOwed(opening, openBox, () => ccy.value);
  const openDate = h('input', { class: 'fi', type: 'date', value: st.opening_date || L.today() });
  const inst = U.input({ value: st.institution || '', maxlength: '60' });
  const last4 = U.input({ value: st.number_hint || '', maxlength: '4', inputmode: 'numeric', placeholder: '1234' });
  const lot = U.select(['fifo', 'average', 'specific'].map((x) => ({ value: x, label: t('accounts.lot.' + x) })), st.lot_method || 'fifo');
  const nw = U.checkbox(t('accounts.in_net_worth'), st.include_in_net_worth !== false, () => {});
  const closed = U.checkbox(t('accounts.closed'), !!st.closed, () => {});
  const err = h('p', { class: 'ff__err', role: 'alert' });
  const lotField = U.field(t('accounts.lot_method'), lot, t('accounts.lot_hint'));
  const syncLot = () => { lotField.hidden = !INVEST_TYPES.includes(type.value); };
  type.addEventListener('change', syncLot);
  syncLot();
  const body = h('div', { class: 'fstack' },
    U.field(t('accounts.name'), name),
    h('div', { class: 'ff-grid' }, U.field(t('accounts.type_label'), type), U.field(t('accounts.currency'), ccy)),
    h('div', { class: 'ff-grid' }, U.field(t('accounts.opening'), opening, t('accounts.opening_hint')), U.field(t('accounts.opening_date'), openDate)),
    openNeg,
    h('div', { class: 'ff-grid' }, U.field(t('accounts.institution'), inst), U.field(t('accounts.last4'), last4, t('accounts.last4_hint'))),
    lotField, nw, a ? closed : null, err);
  const save = h('button', { type: 'button', class: 'fb fb--primary' }, t('common.save'));
  const del = a ? h('button', { type: 'button', class: 'fb fb--danger fb--icon', 'aria-label': t('common.delete'), onclick: async () => {
    const used = (L.rowsByAccount().get(a.id) || []).length;
    if (used) { err.textContent = U.tp('accounts.in_use', used); return; }
    const bills = accountBills(L, a.id);
    const names = bills.slice(0, 3).map((s) => s.name || '—').join(', ') + (bills.length > 3 ? ', …' : '');
    const head = t('accounts.delete_body', { name: a.name });
    const body = bills.length ? head + (head.endsWith('。') ? '' : ' ') + U.tp('accounts.delete_bills', bills.length, { names }) : head;
    const ok = await U.confirmDialog({ title: t('accounts.delete_title'), body, ok: t('common.delete'), danger: true });
    if (!ok) return;
    sh.close();
    ctx.commit(deleteAccountOps(ctx, a.id), bills.length ? U.tp('accounts.deleted_bills', bills.length) : t('accounts.deleted'));
  } }, icon('trash')) : null;
  const sh = U.sheet({ title: a ? t('accounts.edit') : t('accounts.add'), body, foot: [del, h('button', { type: 'button', class: 'fb', onclick: () => sh.close() }, t('common.cancel')), save].filter(Boolean), focus: a ? null : name });
  save.addEventListener('click', () => {
    const nm = name.value.trim();
    if (!nm) { err.textContent = t('accounts.err_name'); name.focus(); return; }
    if (!isCurrency(ccy.value)) { err.textContent = t('accounts.err_ccy'); return; }
    if (!isISODate(openDate.value)) { err.textContent = t('entry.err_date'); return; }
    const ob = opening.value.trim() ? signedAmount(opening.value, ccy.value, openBox.checked) : 0;
    if (ob == null) { err.textContent = t('entry.err_amount'); return; }
    const fields = {
      name: nm.slice(0, 60), type: type.value, currency: ccy.value, opening_minor: ob, opening_date: openDate.value,
      institution: inst.value.trim().slice(0, 60), number_hint: last4.value.replace(/\D/g, '').slice(-4), lot_method: lot.value,
      include_in_net_worth: nw.querySelector('input').checked, closed: a ? closed.querySelector('input').checked : false
    };
    if (!a) { fields.order = L.accounts(true).length + 1; fields.created = new Date().toISOString(); fields.color = U.PALETTE[L.accounts(true).length % U.PALETTE.length]; }
    sh.close();
    ctx.commit(ctx.save('account', a ? a.id : ctx.newId(), fields), a ? t('accounts.saved') : t('accounts.added'));
  });
  return sh;
}

function reconcileSheet(ctx, a) {
  const L = ctx.ledger;
  const cur = L.balance(a.id);
  const inp = U.moneyField({ placeholder: U.amountToInput(cur, a.currency) });
  const neg = U.checkbox(t('accounts.balance_negative'), cur < 0, () => {});
  const negBox = neg.querySelector('input');
  syncOwed(inp, negBox, () => a.currency);
  const err = h('p', { class: 'ff__err', role: 'alert' });
  const save = h('button', { type: 'button', class: 'fb fb--primary' }, t('accounts.reconcile_go'));
  const sh = U.sheet({
    title: t('accounts.reconcile', { name: a.name }),
    body: h('div', { class: 'fstack' }, h('p', { class: 'fmuted fsmall' }, t('accounts.reconcile_body', { amount: U.money(cur, a.currency) })), U.field(t('accounts.statement_balance'), inp), neg, err),
    foot: [h('button', { type: 'button', class: 'fb', onclick: () => sh.close() }, t('common.cancel')), save], focus: inp
  });
  save.addEventListener('click', () => {
    const v = signedAmount(inp.value, a.currency, negBox.checked);
    if (v == null) { err.textContent = t('entry.err_amount'); return; }
    const diff = v - cur;
    sh.close();
    if (!diff) { U.toast(t('accounts.reconciled_same')); return; }
    const base = L.base();
    const fields = { date: L.today(), amount_minor: diff, currency: a.currency, account: a.id, category: null, payee: t('accounts.adjustment'), note: '', tags: [], kind: 'adjustment', cleared: true, created: new Date().toISOString(), provenance: 'reconcile' };
    if (a.currency === base) fields.base_minor = diff;
    const id = ctx.newId();
    ctx.commit(ctx.engine.createOps('transaction', id, fields), t('accounts.reconciled', { amount: U.signedMoney(diff, a.currency) }), () => ctx.engine.removeOps('transaction', id));
  });
}

function valuationSheet(ctx, a) {
  const L = ctx.ledger;
  const inp = U.moneyField({ placeholder: '0' });
  const date = h('input', { class: 'fi', type: 'date', value: L.today() });
  const err = h('p', { class: 'ff__err', role: 'alert' });
  const save = h('button', { type: 'button', class: 'fb fb--primary' }, t('common.save'));
  const sh = U.sheet({ title: t('accounts.value_title', { name: a.name }), body: h('div', { class: 'fstack' }, h('p', { class: 'fmuted fsmall' }, t('accounts.value_body')), h('div', { class: 'ff-grid' }, U.field(t('accounts.value'), inp), U.field(t('entry.date'), date)), err), foot: [h('button', { type: 'button', class: 'fb', onclick: () => sh.close() }, t('common.cancel')), save], focus: inp });
  save.addEventListener('click', () => {
    const v = U.parseAmount(inp.value, a.currency);
    if (v == null) { err.textContent = t('entry.err_amount'); return; }
    if (!isISODate(date.value)) { err.textContent = t('entry.err_date'); return; }
    sh.close();
    const signed = ['loan', 'other_liability', 'credit_card'].includes(a.type) ? -Math.abs(v) : v;
    ctx.commit(ctx.engine.createOps('valuation', ctx.newId(), { account: a.id, date: date.value, value_minor: signed, kind: 'anchor', note: '' }), t('accounts.value_saved'));
  });
}

function detailSheet(ctx, a) {
  const L = ctx.ledger;
  const bal = L.balance(a.id);
  const val = L.accountValue(a);
  const rows = (L.rowsByAccount().get(a.id) || []).length;
  const body = h('div', { class: 'fstack' },
    h('div', null, h('div', { class: 'fsmall fmuted' }, t('accounts.type.' + a.type) + (a.institution ? ' · ' + a.institution : '') + (a.number_hint ? ' · •••• ' + a.number_hint : '')), h('div', { class: 'fbig', style: { marginTop: '4px' } }, U.money(val, a.currency)), a.currency !== L.base() ? h('div', { class: 'fsmall fmuted' }, '≈ ' + (L.toBase(val, a.currency) == null ? t('accounts.no_rate') : U.money(L.toBase(val, a.currency), L.base()))) : null),
    val !== bal ? U.leader(t('accounts.cash_part'), U.money(bal, a.currency)) : null,
    U.leader(t('accounts.transactions'), U.fmtInt(rows)),
    U.leader(t('accounts.opened'), a.opening_date ? U.date(a.opening_date) : '—'),
    h('div', { class: 'fb-row' },
      h('button', { type: 'button', class: 'fb fb--sm', onclick: () => { sh.close(); ctx.go('ledger', { account: a.id }); } }, icon('ledger'), t('accounts.view_rows')),
      h('button', { type: 'button', class: 'fb fb--sm', onclick: () => { sh.close(); reconcileSheet(ctx, a); } }, icon('check'), t('accounts.reconcile_short')),
      ['other_asset', 'loan', 'other_liability'].includes(a.type) ? h('button', { type: 'button', class: 'fb fb--sm', onclick: () => { sh.close(); valuationSheet(ctx, a); } }, icon('edit'), t('accounts.set_value')) : null,
      h('button', { type: 'button', class: 'fb fb--sm', onclick: () => { sh.close(); accountSheet(ctx, a.id); } }, icon('settings'), t('common.edit'))));
  const sh = U.sheet({ title: a.name, body, foot: [] });
}

function accountsTab(ctx) {
  const L = ctx.ledger;
  const base = L.base();
  const vs = ctx.viewState;
  const node = h('div');
  const all = L.accounts(true);
  const shown = all.filter((a) => vs.showClosed || !a.closed);
  const groups = new Map();
  for (const a of shown) {
    const g = accountGroup(a.type);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(a);
  }
  const nw = L.netWorth();
  node.append(h('div', { class: 'fcard', style: { marginBottom: '14px' } },
    h('div', { class: 'fstats' },
      h('div', { class: 'fstat' }, h('span', { class: 'fstat__label' }, t('home.net_worth')), h('span', { class: 'fmid' }, U.money(nw.total, base))),
      h('div', { class: 'fstat' }, h('span', { class: 'fstat__label' }, t('accounts.assets')), h('span', { class: 'fmid amt--in' }, U.money(nw.assets, base))),
      h('div', { class: 'fstat' }, h('span', { class: 'fstat__label' }, t('accounts.liabilities')), h('span', { class: 'fmid amt--over' }, U.money(nw.liabilities, base))))));
  node.append(h('div', { class: 'ftool', style: { justifyContent: 'space-between' } },
    h('button', { type: 'button', class: 'fb fb--primary', onclick: () => accountSheet(ctx, null) }, icon('plus'), t('accounts.add')),
    all.some((a) => a.closed) ? U.checkbox(t('accounts.show_closed'), !!vs.showClosed, (v) => { vs.showClosed = v; ctx.rerender(); }) : null));
  for (const g of GROUP_ORDER) {
    const list = groups.get(g);
    if (!list) continue;
    const total = list.reduce((n, a) => n + (L.toBase(L.accountValue(a), a.currency) || 0), 0);
    node.append(h('div', { class: 'fsection' }, h('h2', null, t('accounts.group.' + g)), h('span', { class: 'fnum fmuted' }, U.money(total, base))));
    const box = h('div');
    for (const a of list) {
      const v = L.accountValue(a);
      const amt = h('span', { class: 'frow__amt ' + (v < 0 ? 'amt--over' : '') }, U.money(v, a.currency));
      if (a.currency !== base) { const b = L.toBase(v, a.currency); amt.append(h('small', null, b == null ? t('accounts.no_rate') : '≈ ' + U.money(b, base))); }
      box.append(h('button', { type: 'button', class: 'frow', onclick: () => detailSheet(ctx, a) },
        U.mono(a.name, a.color),
        h('span', { class: 'frow__main' }, h('span', { class: 'frow__title' }, a.name + (a.closed ? ' · ' + t('accounts.closed_tag') : '')), h('span', { class: 'frow__meta' }, t('accounts.type.' + a.type) + (a.institution ? ' · ' + a.institution : '') + (a.number_hint ? ' · •••• ' + a.number_hint : ''))),
        amt));
    }
    node.append(box);
  }
  if (!shown.length) node.append(U.empty(t('accounts.empty')));
  return node;
}

function fxTab(ctx) {
  const L = ctx.ledger;
  const base = L.base();
  const node = h('div');
  node.append(h('p', { class: 'fmuted fsmall', style: { marginBottom: '12px', maxWidth: '62ch' } }, t('accounts.fx_body', { base })));
  const used = new Set();
  for (const a of L.accounts(true)) if (a.currency !== base) used.add(a.currency);
  for (const r of L.list('fx_rate')) { if (r.quote === base) used.add(r.base); }
  const from = U.select(ccyOptions(L, Array.from(used)[0] || 'USD').filter((o) => o.value !== base), Array.from(used)[0] || (base === 'USD' ? 'EUR' : 'USD'));
  const rate = U.moneyField({ placeholder: decimalToInput('0.00', U.locale()) });
  const date = h('input', { class: 'fi', type: 'date', value: L.today() });
  const err = h('p', { class: 'ff__err', role: 'alert' });
  const add = h('button', { type: 'button', class: 'fb fb--primary' }, t('accounts.fx_add'));
  add.addEventListener('click', () => {
    const dec = normalizeNumber(rate.value, U.locale());
    let r6 = null;
    try { r6 = dec ? rateE6From(dec) : null; } catch (_) {}
    if (!r6 || r6 <= 0) { err.textContent = t('entry.err_amount'); return; }
    if (!isISODate(date.value)) { err.textContent = t('entry.err_date'); return; }
    ctx.commit(ctx.save('fx_rate', 'fx:' + from.value + base + ':' + date.value, { base: from.value, quote: base, date: date.value, rate_e6: r6, source: 'manual' }), t('accounts.fx_saved'));
  });
  node.append(h('div', { class: 'fcard', style: { marginBottom: '16px' } },
    h('div', { class: 'ff-grid' }, U.field(t('accounts.fx_from'), from), U.field(t('accounts.fx_rate', { base }), rate, t('accounts.fx_rate_hint', { base })), U.field(t('entry.date'), date), h('div', { class: 'ff', style: { justifyContent: 'flex-end' } }, add)), err));
  if (!used.size) { node.append(U.empty(t('accounts.fx_none'))); return node; }
  for (const c of used) {
    const hist = L.list('fx_rate').filter((r) => (r.base === c && r.quote === base) || (r.base === base && r.quote === c)).sort((a, b) => (a.date < b.date ? 1 : -1));
    const cur = L.rateE6(c, base);
    node.append(h('div', { class: 'fsection' }, h('h2', null, c + ' → ' + base), h('span', { class: 'fnum ' + (cur ? '' : 'amt--warn') }, cur ? '1 ' + c + ' = ' + rateText(cur) + ' ' + base : t('accounts.no_rate'))));
    for (const r of hist.slice(0, 6)) {
      const disp = r.base === c ? r.rate_e6 : Math.round(1e12 / r.rate_e6);
      node.append(h('div', { class: 'frow frow--static' }, U.mono(c, U.colorFor(c), true), h('span', { class: 'frow__main' }, h('span', { class: 'frow__title' }, U.date(r.date)), h('span', { class: 'frow__meta' }, t('accounts.fx_source.' + (r.source || 'manual')))),
        h('span', { class: 'fb-row' }, h('span', { class: 'fnum' }, rateText(disp)), h('button', { type: 'button', class: 'fb fb--ghost fb--icon', 'aria-label': t('common.delete'), onclick: () => ctx.commit(ctx.remove('fx_rate', r.id), t('accounts.fx_deleted')) }, icon('trash')))));
    }
  }
  return node;
}

export function render(ctx) {
  const vs = ctx.viewState;
  if (ctx.params.tab && vs.paramTab !== ctx.params.tab) { vs.tab = ctx.params.tab; vs.paramTab = ctx.params.tab; }
  if (!vs.tab) vs.tab = 'accounts';
  const node = h('div');
  const tabs = h('div', { class: 'ftabs', role: 'tablist' });
  for (const [k, label] of [['accounts', t('accounts.tab_accounts')], ['fx', t('accounts.tab_fx')]]) {
    tabs.append(h('button', { type: 'button', role: 'tab', class: vs.tab === k ? 'is-on' : '', 'aria-selected': vs.tab === k ? 'true' : 'false', onclick: () => { vs.tab = k; ctx.rerender(); } }, label));
  }
  node.append(tabs, vs.tab === 'fx' ? fxTab(ctx) : accountsTab(ctx));
  return {
    title: t('nav.accounts'),
    node,
    after: () => {
      if (ctx.params.add === '1' && !vs.addOpened) { vs.addOpened = true; accountSheet(ctx, null); }
      if (ctx.params.id && vs.idOpened !== ctx.params.id) { vs.idOpened = ctx.params.id; const a = ctx.ledger.get('account', ctx.params.id); if (a) detailSheet(ctx, a); }
    }
  };
}
