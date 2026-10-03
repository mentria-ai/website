import * as U from '../ui.js';
import { donut, legend } from '../charts.js';
import { toMinor, minorToDecimal, decimalsFor, qtyTimesPrice, normalizeNumber, isCurrency, convertMinor, trimDecimal, decimalToInput, formatDecimal } from '../money.js';
import { isISODate, addMonths, diffDays } from '../dates.js';
import { ASSET_CLASSES, accountGroup, INVEST_TYPES } from '../ledger.js';
import { xirr, depositValue, maturityValue, amortize, loanOutstanding, emi, runLots } from '../invest.js';
import { accountSheet } from './accounts.js';

const { h, t, icon } = U;
const TYPES = ['buy', 'sell', 'dividend', 'dividend_reinvest', 'interest', 'fee', 'tax_withheld', 'transfer_in', 'transfer_out', 'bonus', 'split'];
const INST_TYPES = ['stock', 'etf', 'fund', 'bond', 'crypto', 'metal', 'other'];
const CLASS_COLORS = { equity: '#6ef3c5', bond: '#22d3ee', cash: '#8896a8', metal: '#fbbf24', crypto: '#a78bfa', real_estate: '#ff9500', other: '#f472b6', debt: '#f472b6' };

function qtyText(q, scale) { return formatDecimal(trimDecimal(minorToDecimal(q, scale)), U.locale()); }
function priceText(p) { return formatDecimal(trimDecimal(minorToDecimal(p, 4)), U.locale()); }
function pctInput(bp) { return decimalToInput(String((bp || 0) / 100), U.locale()); }

export function numberInput(minor, scale) {
  return minor ? decimalToInput(trimDecimal(minorToDecimal(minor, scale)), U.locale()) : '';
}

export function numberFromInput(text, scale) {
  const d = normalizeNumber(text, U.locale());
  if (d == null) return null;
  try { return toMinor(d, scale); } catch (_) { return null; }
}

function instrumentSheet(ctx, inst, onSaved) {
  const L = ctx.ledger;
  const i = inst || { name: '', identifier: '', type: 'fund', asset_class: 'equity', currency: L.base(), qty_scale: 4 };
  const name = U.input({ value: i.name, maxlength: '80', placeholder: t('invest.inst_name_ph') });
  const ident = U.input({ value: i.identifier || '', maxlength: '40', placeholder: t('invest.ident_ph') });
  const type = U.select(INST_TYPES.map((x) => ({ value: x, label: t('invest.type.' + x) })), i.type || 'fund');
  const cls = U.select(ASSET_CLASSES.map((x) => ({ value: x, label: t('invest.class.' + x) })), i.asset_class || 'equity');
  const ccy = U.input({ value: i.currency || L.base(), maxlength: '3', style: { textTransform: 'uppercase' } });
  const err = h('p', { class: 'ff__err', role: 'alert' });
  type.addEventListener('change', () => { if (type.value === 'crypto') cls.value = 'crypto'; else if (type.value === 'metal') cls.value = 'metal'; else if (type.value === 'bond') cls.value = 'bond'; });
  const save = h('button', { type: 'button', class: 'fb fb--primary' }, t('common.save'));
  const sh = U.sheet({ title: inst ? t('invest.edit_inst') : t('invest.add_inst'), body: h('div', { class: 'fstack' }, U.field(t('invest.inst_name'), name), h('div', { class: 'ff-grid' }, U.field(t('invest.ident'), ident, t('invest.ident_hint')), U.field(t('accounts.currency'), ccy), U.field(t('invest.inst_type'), type), U.field(t('invest.asset_class'), cls)), err), foot: [h('button', { type: 'button', class: 'fb', onclick: () => sh.close() }, t('common.cancel')), save], focus: inst ? null : name });
  save.addEventListener('click', async () => {
    if (!name.value.trim()) { err.textContent = t('invest.err_name'); return; }
    const c = ccy.value.trim().toUpperCase();
    if (!isCurrency(c)) { err.textContent = t('accounts.err_ccy'); return; }
    const id = inst ? inst.id : ctx.newId();
    const fields = { name: name.value.trim().slice(0, 80), identifier: ident.value.trim().slice(0, 40), id_kind: 'manual', type: type.value, asset_class: cls.value, currency: c, qty_scale: inst ? inst.qty_scale || 4 : type.value === 'crypto' ? 8 : 4 };
    sh.close();
    const ok = await ctx.commit(ctx.save('instrument', id, fields), inst ? t('invest.inst_saved') : t('invest.inst_added'));
    if (ok && onSaved) onSaved(id);
  });
}

export function activitySheet(ctx, act, preset) {
  const L = ctx.ledger;
  const p = Object.assign({}, preset || {});
  const a = act || { type: p.type || 'buy', date: L.today(), account: p.account || null, instrument: p.instrument || null };
  const investAccts = L.accounts().filter((x) => INVEST_TYPES.includes(x.type));
  if (!investAccts.length) {
    U.confirmDialog({ title: t('invest.need_account_title'), body: t('invest.need_account_body'), ok: t('accounts.add') }).then((ok) => { if (ok) accountSheet(ctx, null); });
    return;
  }
  const insts = L.list('instrument').sort((x, y) => String(x.name).localeCompare(String(y.name)));
  const st = { type: a.type, account: a.account || investAccts[0].id, instrument: a.instrument || (insts[0] || {}).id || '' };
  const type = U.select(TYPES.map((x) => ({ value: x, label: t('invest.act.' + x) })), st.type);
  const acct = U.select(investAccts.map((x) => ({ value: x.id, label: x.name })), st.account);
  const instSel = U.select([{ value: '', label: t('invest.pick_inst'), disabled: true }].concat(insts.map((x) => ({ value: x.id, label: x.name + (x.identifier ? ' · ' + x.identifier : '') }))), st.instrument);
  const newInst = h('button', { type: 'button', class: 'fb fb--sm', onclick: () => { sh.close(); instrumentSheet(ctx, null, (id) => activitySheet(ctx, null, Object.assign({}, p, { instrument: id, type: type.value, account: acct.value }))); } }, icon('plus'), t('invest.new_inst'));
  const date = h('input', { class: 'fi', type: 'date', value: a.date || L.today() });
  const inst0 = () => L.get('instrument', instSel.value) || { qty_scale: 4, currency: L.base() };
  const qty = U.moneyField({ value: numberInput(a.qty, inst0().qty_scale || 4), placeholder: '0' });
  const price = U.moneyField({ value: numberInput(a.price_e4, 4), placeholder: decimalToInput('0.00', U.locale()) });
  const amount = U.moneyField({ value: a.amount_minor ? U.amountToInput(a.amount_minor, inst0().currency) : '', placeholder: decimalToInput('0.00', U.locale()) });
  const fee = U.moneyField({ value: a.fee_minor ? U.amountToInput(a.fee_minor, inst0().currency) : '', placeholder: '0' });
  const tax = U.moneyField({ value: a.tax_withheld_minor ? U.amountToInput(a.tax_withheld_minor, inst0().currency) : '', placeholder: '0' });
  const num = h('input', { class: 'fi', type: 'number', min: '1', value: String((a.split && a.split.num) || 2) });
  const den = h('input', { class: 'fi', type: 'number', min: '1', value: String((a.split && a.split.den) || 1) });
  const cashOpts = [{ value: '_same', label: t('invest.cash_same') }, { value: '_none', label: t('invest.cash_none') }].concat(L.accounts().filter((x) => accountGroup(x.type) === 'cash' || x.type === 'credit_card').map((x) => ({ value: x.id, label: x.name })));
  const linked = act ? L.get('transaction', 'act:' + act.id) : null;
  const cash = U.select(cashOpts, linked ? (linked.account === a.account ? '_same' : linked.account) : act ? '_none' : '_same');
  const note = U.input({ value: a.note || '', maxlength: '200' });
  const lotsBox = h('div', { class: 'fstack' });
  const lotPicks = new Map();
  const err = h('p', { class: 'ff__err', role: 'alert' });
  const autoAmount = () => {
    const i = inst0();
    const q = numberFromInput(qty.value, i.qty_scale || 4);
    const pr = numberFromInput(price.value, 4);
    if (q > 0 && pr > 0 && !amount.dataset.touched) {
      try { amount.value = U.amountToInput(qtyTimesPrice(q, i.qty_scale || 4, pr, decimalsFor(i.currency)), i.currency); } catch (_) {}
    }
  };
  qty.addEventListener('input', autoAmount);
  price.addEventListener('input', autoAmount);
  amount.addEventListener('input', () => { amount.dataset.touched = '1'; });
  const fields = {
    qty: U.field(t('invest.qty'), qty), price: U.field(t('invest.price'), price), amount: U.field(t('invest.amount'), amount, t('invest.amount_hint')),
    fee: U.field(t('invest.fee'), fee), tax: U.field(t('invest.tax'), tax), num: U.field(t('invest.split_new'), num), den: U.field(t('invest.split_old'), den), cash: U.field(t('invest.cash'), cash, t('invest.cash_hint'))
  };
  const drawLots = () => {
    lotsBox.replaceChildren();
    const account = L.get('account', acct.value);
    if (type.value !== 'sell' || !account || account.lot_method !== 'specific' || !instSel.value) return;
    const acts = L.list('activity').filter((x) => x.account === acct.value && x.instrument === instSel.value && (!act || x.id !== act.id));
    const run = runLots(acts, 'fifo');
    const i = inst0();
    lotsBox.append(h('span', { class: 'ff__label' }, t('invest.pick_lots')));
    for (const lot of run.lots) {
      const inp = U.moneyField({ placeholder: '0', oninput: (e) => { lotPicks.set(lot.id, numberFromInput(e.target.value, i.qty_scale || 4) || 0); } });
      lotsBox.append(h('div', { class: 'fsplit' }, h('span', { class: 'fsmall' }, U.date(lot.date) + ' · ' + qtyText(lot.qty, i.qty_scale || 4)), inp, h('span')));
    }
  };
  const sync = () => {
    const tp = type.value;
    const trade = ['buy', 'sell', 'dividend_reinvest', 'transfer_in', 'transfer_out', 'bonus'].includes(tp);
    fields.qty.hidden = !trade;
    fields.price.hidden = !['buy', 'sell', 'dividend_reinvest'].includes(tp);
    fields.amount.hidden = tp === 'split' || tp === 'bonus';
    fields.fee.hidden = !['buy', 'sell', 'dividend', 'interest'].includes(tp);
    fields.tax.hidden = !['dividend', 'interest', 'sell'].includes(tp);
    fields.num.hidden = tp !== 'split';
    fields.den.hidden = tp !== 'split';
    fields.cash.hidden = ['split', 'bonus', 'transfer_in', 'transfer_out', 'dividend_reinvest', 'tax_withheld'].includes(tp);
    drawLots();
  };
  type.addEventListener('change', sync);
  acct.addEventListener('change', drawLots);
  instSel.addEventListener('change', drawLots);
  const save = h('button', { type: 'button', class: 'fb fb--primary' }, t('common.save'));
  const del = act ? h('button', { type: 'button', class: 'fb fb--danger fb--icon', 'aria-label': t('common.delete'), onclick: () => {
    const ops = ctx.remove('activity', act.id);
    if (linked) ops.push(...ctx.remove('transaction', linked.id));
    sh.close();
    ctx.commit(ops, t('invest.act_deleted'));
  } }, icon('trash')) : null;
  const sh = U.sheet({
    title: act ? t('invest.edit_act') : t('invest.add_act'), wide: true,
    body: h('div', { class: 'fstack' },
      h('div', { class: 'ff-grid' }, U.field(t('invest.act_type'), type), U.field(t('entry.date'), date), U.field(t('entry.account'), acct), h('div', { class: 'ff' }, h('label', { class: 'ff__label', for: 'fin-inst' }, t('invest.instrument')), Object.assign(instSel, { id: 'fin-inst' }), newInst)),
      h('div', { class: 'ff-grid' }, fields.qty, fields.price, fields.amount, fields.fee, fields.tax, fields.num, fields.den, fields.cash),
      lotsBox, U.field(t('entry.note'), note), err),
    foot: [del, h('button', { type: 'button', class: 'fb', onclick: () => sh.close() }, t('common.cancel')), save].filter(Boolean)
  });
  sync();
  save.addEventListener('click', () => {
    const inst = L.get('instrument', instSel.value);
    if (!inst) { err.textContent = t('invest.err_inst'); return; }
    if (!isISODate(date.value)) { err.textContent = t('entry.err_date'); return; }
    const tp = type.value;
    const scale = inst.qty_scale || 4;
    const ccy = inst.currency || L.base();
    const out = { date: date.value, instrument: inst.id, account: acct.value, type: tp, note: note.value.trim().slice(0, 200) };
    try {
      if (!fields.qty.hidden) { const q = numberFromInput(qty.value, scale); if (!q || q <= 0) { err.textContent = t('invest.err_qty'); return; } out.qty = q; }
      if (!fields.price.hidden) { const pr = numberFromInput(price.value, 4); if (pr > 0) out.price_e4 = pr; }
      if (!fields.amount.hidden) {
        const m = U.parseAmount(amount.value, ccy);
        if ((m == null || m === 0) && tp !== 'transfer_in' && tp !== 'transfer_out') { err.textContent = t('entry.err_amount'); return; }
        out.amount_minor = Math.abs(m || 0);
      }
      out.fee_minor = fields.fee.hidden ? 0 : Math.abs(U.parseAmount(fee.value, ccy) || 0);
      out.tax_withheld_minor = fields.tax.hidden ? 0 : Math.abs(U.parseAmount(tax.value, ccy) || 0);
      if (tp === 'split') out.split = { num: Math.max(1, parseInt(num.value, 10) || 1), den: Math.max(1, parseInt(den.value, 10) || 1) };
      if (tp === 'sell' && lotPicks.size) out.lot_ref = Array.from(lotPicks, ([lot, q]) => ({ lot, qty: q })).filter((x) => x.qty > 0);
      if (!out.price_e4 && out.qty && out.amount_minor) out.price_e4 = Math.round((out.amount_minor * 10 ** (scale + 4 - decimalsFor(ccy))) / out.qty);
    } catch (e) { err.textContent = t('entry.err_amount'); return; }
    const id = act ? act.id : ctx.newId();
    const ops = ctx.save('activity', id, out);
    const cashTarget = fields.cash.hidden ? '_none' : cash.value === '_same' ? acct.value : cash.value;
    const cashAcct = cashTarget === '_none' ? null : L.get('account', cashTarget);
    const sign = ['buy', 'fee'].includes(tp) ? -1 : 1;
    const gross = tp === 'buy' ? (out.amount_minor || 0) + out.fee_minor : tp === 'fee' ? (out.amount_minor || 0) : (out.amount_minor || 0) - out.fee_minor - out.tax_withheld_minor;
    if (cashAcct && gross) {
      let amt = sign * Math.abs(gross);
      if (cashAcct.currency !== ccy) {
        const r = L.rateE6(ccy, cashAcct.currency, out.date);
        if (r == null) { err.textContent = t('entry.err_fx', { from: ccy, to: cashAcct.currency }); return; }
        amt = convertMinor(amt, ccy, cashAcct.currency, r);
      }
      const txn = { date: out.date, amount_minor: amt, currency: cashAcct.currency, account: cashAcct.id, category: null, payee: inst.name, note: t('invest.act.' + tp), tags: [], kind: 'invest', cleared: true, provenance: 'activity' };
      if (cashAcct.currency === L.base()) txn.base_minor = amt;
      if (!linked) txn.created = new Date().toISOString();
      ops.push(...ctx.save('transaction', 'act:' + id, txn));
    } else if (linked) ops.push(...ctx.remove('transaction', linked.id));
    sh.close();
    ctx.commit(ops, act ? t('invest.act_saved') : t('invest.act_added'));
  });
}

function pricesSheet(ctx) {
  const L = ctx.ledger;
  const held = L.holdings().filter((x) => x.qty > 0);
  const ids = Array.from(new Set(held.map((x) => x.instrument)));
  const date = h('input', { class: 'fi', type: 'date', value: L.today() });
  const inputs = new Map();
  const tbl = h('table', { class: 'ftable' }, h('thead', null, h('tr', null, h('th', null, t('invest.instrument')), h('th', { class: 'n' }, t('invest.last_price')), h('th', null, t('invest.new_price')))));
  const tb = h('tbody');
  for (const id of ids) {
    const inst = L.get('instrument', id);
    const hd = held.find((x) => x.instrument === id);
    const inp = U.moneyField({ placeholder: hd.price ? numberInput(hd.price.price_e4, 4) : '0', style: { maxWidth: '140px' } });
    inputs.set(id, inp);
    tb.append(h('tr', null, h('td', null, inst.name), h('td', { class: 'n' }, hd.price ? priceText(hd.price.price_e4) + ' ' + (inst.currency || '') + ' · ' + U.date(hd.price.date, 'dayMonth') : '—'), h('td', null, inp)));
  }
  tbl.append(tb);
  const save = h('button', { type: 'button', class: 'fb fb--primary' }, t('common.save'));
  const sh = U.sheet({ title: t('invest.update_prices'), wide: true, body: h('div', { class: 'fstack' }, h('p', { class: 'fmuted fsmall' }, t('invest.prices_body')), U.field(t('entry.date'), date), ids.length ? h('div', { class: 'ftable-wrap' }, tbl) : U.empty(t('invest.no_holdings'))), foot: [h('button', { type: 'button', class: 'fb', onclick: () => sh.close() }, t('common.cancel')), save] });
  save.addEventListener('click', () => {
    if (!isISODate(date.value)) return;
    const ops = [];
    for (const [id, inp] of inputs) {
      const p = numberFromInput(inp.value, 4);
      if (!p || p <= 0) continue;
      ops.push(...ctx.save('price', id + ':' + date.value, { instrument: id, date: date.value, price_e4: p, source: 'manual' }));
    }
    sh.close();
    ctx.commit(ops, U.tp('invest.prices_saved', ops.length));
  });
}

function holdingSheet(ctx, hd) {
  const L = ctx.ledger;
  const inst = L.get('instrument', hd.instrument);
  const ccy = hd.currency;
  const acts = L.list('activity').filter((x) => x.instrument === hd.instrument && x.account === hd.account).sort((a, b) => (a.date < b.date ? 1 : -1));
  const body = h('div', { class: 'fstack' },
    h('div', { class: 'fstats' },
      h('div', { class: 'fstat' }, h('span', { class: 'fstat__label' }, t('invest.value')), h('span', { class: 'fmid' }, U.money(hd.value, ccy))),
      h('div', { class: 'fstat' }, h('span', { class: 'fstat__label' }, t('invest.gain')), h('span', { class: 'fmid ' + (hd.gain >= 0 ? 'amt--in' : 'amt--over') }, U.signedMoney(hd.gain, ccy))),
      h('div', { class: 'fstat' }, h('span', { class: 'fstat__label' }, t('invest.xirr')), h('span', { class: 'fmid' }, hd.xirr == null ? '—' : U.pct(hd.xirr, 1)))),
    U.leader(t('invest.qty'), qtyText(hd.qty, hd.qty_scale)),
    U.leader(t('invest.cost'), U.money(hd.cost, ccy)),
    hd.price ? U.leader(t('invest.price'), priceText(hd.price.price_e4) + ' ' + ccy + ' · ' + U.date(hd.price.date) + (hd.price.carried ? ' · ' + t('invest.stale') : '')) : null,
    hd.income ? U.leader(t('invest.income'), U.money(hd.income, ccy)) : null,
    hd.errors.length ? h('div', { class: 'fbanner fbanner--pink' }, icon('alert'), h('span', null, t('invest.short_sell'))) : null,
    hd.lots.length ? h('div', null, h('span', { class: 'ff__label' }, t('invest.lots')), ...hd.lots.map((l) => U.leader(U.date(l.date) + ' · ' + qtyText(l.qty, hd.qty_scale), U.money(l.cost, ccy)))) : null,
    h('div', null, h('span', { class: 'ff__label' }, t('invest.activity')), ...acts.slice(0, 30).map((x) => h('button', { type: 'button', class: 'frow', onclick: () => { sh.close(); activitySheet(ctx, x); } },
      U.mono('', x.type === 'sell' ? '#f472b6' : x.type === 'buy' ? '#6ef3c5' : '#22d3ee', true, x.type === 'split' ? 'filter' : 'invest'),
      h('span', { class: 'frow__main' }, h('span', { class: 'frow__title' }, t('invest.act.' + x.type)), h('span', { class: 'frow__meta' }, U.date(x.date) + (x.qty ? ' · ' + qtyText(x.qty, hd.qty_scale) : ''))),
      h('span', { class: 'frow__amt' }, x.amount_minor ? U.money(x.amount_minor, ccy) : '')))));
  const sh = U.sheet({ title: inst ? inst.name : hd.name, wide: true, body, foot: [
    h('button', { type: 'button', class: 'fb', onclick: () => { sh.close(); instrumentSheet(ctx, inst); } }, icon('edit'), t('invest.edit_inst')),
    h('button', { type: 'button', class: 'fb fb--primary', onclick: () => { sh.close(); activitySheet(ctx, null, { instrument: hd.instrument, account: hd.account, type: 'buy' }); } }, icon('plus'), t('invest.add_act'))] });
}

function holdingsTab(ctx) {
  const L = ctx.ledger;
  const base = L.base();
  const node = h('div');
  const hs = L.holdings();
  const nw = L.netWorth();
  let value = 0, cost = 0;
  const flows = [];
  for (const hd of hs) {
    const v = L.toBase(hd.value, hd.currency) || 0;
    value += v;
    cost += L.toBase(hd.cost, hd.currency) || 0;
  }
  for (const a of L.list('activity')) {
    const inst = L.get('instrument', a.instrument);
    const ccy = (inst && inst.currency) || base;
    const amt = L.toBase(Math.abs(a.amount_minor || 0) + (a.type === 'buy' ? Math.abs(a.fee_minor || 0) : -Math.abs(a.fee_minor || 0)), ccy, a.date) || 0;
    if (a.type === 'buy') flows.push({ date: a.date, amount: -amt });
    else if (['sell', 'dividend', 'interest'].includes(a.type)) flows.push({ date: a.date, amount: amt });
  }
  if (value > 0) flows.push({ date: L.today(), amount: value });
  let total = null;
  try { if (flows.length > 1) total = xirr(flows.filter((f) => f.amount)); } catch (_) { total = null; }
  node.append(h('div', { class: 'ftool', style: { justifyContent: 'space-between' } },
    h('div', { class: 'fb-row' }, h('button', { type: 'button', class: 'fb fb--primary', onclick: () => activitySheet(ctx, null) }, icon('plus'), t('invest.add_act')), h('button', { type: 'button', class: 'fb', onclick: () => pricesSheet(ctx) }, icon('edit'), t('invest.update_prices')))));
  if (!hs.length) { node.append(U.empty(t('invest.empty'))); return node; }
  const classes = Object.entries(nw.byClass).filter(([k, v]) => v > 0 && k !== 'debt').sort((a, b) => b[1] - a[1]);
  const top = h('div', { class: 'fgrid', style: { marginBottom: '14px' } },
    h('div', { class: 'fcard' }, h('div', { class: 'fstats' },
      h('div', { class: 'fstat' }, h('span', { class: 'fstat__label' }, t('invest.value')), h('span', { class: 'fmid' }, U.money(value, base))),
      h('div', { class: 'fstat' }, h('span', { class: 'fstat__label' }, t('invest.cost')), h('span', { class: 'fmid' }, U.money(cost, base))),
      h('div', { class: 'fstat' }, h('span', { class: 'fstat__label' }, t('invest.gain')), h('span', { class: 'fmid ' + (value - cost >= 0 ? 'amt--in' : 'amt--over') }, U.signedMoney(value - cost, base))),
      h('div', { class: 'fstat' }, h('span', { class: 'fstat__label' }, t('invest.xirr_all')), h('span', { class: 'fmid' }, total == null ? '—' : U.pct(total, 1)))),
      h('p', { class: 'ff__hint', style: { marginTop: '10px' } }, t('invest.xirr_hint'))),
    h('div', { class: 'fcard', style: { display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' } },
      donut({ items: classes.map(([k, v]) => ({ label: t('invest.class.' + k), value: v, color: CLASS_COLORS[k] || '#8896a8' })), size: 150, thick: 18, fmt: (v) => U.money(v, base), label: t('invest.allocation') }),
      legend(classes.map(([k, v]) => ({ color: CLASS_COLORS[k] || '#8896a8', label: t('invest.class.' + k) + ' ' + U.pct(v / (classes.reduce((s, x) => s + x[1], 0) || 1), 0) })))));
  node.append(top);
  const byAcct = new Map();
  for (const hd of hs) { if (!byAcct.has(hd.account)) byAcct.set(hd.account, []); byAcct.get(hd.account).push(hd); }
  for (const [aid, list] of byAcct) {
    const acct = L.get('account', aid);
    node.append(h('div', { class: 'fsection' }, h('h2', null, acct ? acct.name : '—'), h('span', { class: 'fsmall fmuted' }, acct ? t('accounts.lot.' + (acct.lot_method || 'fifo')) : '')));
    for (const hd of list.sort((a, b) => b.value - a.value)) {
      if (hd.qty <= 0 && !hd.realized.length) continue;
      const pct = hd.cost ? hd.gain / hd.cost : 0;
      node.append(h('button', { type: 'button', class: 'frow', onclick: () => holdingSheet(ctx, hd) },
        U.mono(hd.name, CLASS_COLORS[hd.asset_class] || U.colorFor(hd.instrument)),
        h('span', { class: 'frow__main' }, h('span', { class: 'frow__title' }, hd.name), h('span', { class: 'frow__meta' }, hd.qty > 0 ? qtyText(hd.qty, hd.qty_scale) + ' · ' + (hd.price ? U.date(hd.price.date, 'dayMonth') + (hd.price.carried ? ' · ' + t('invest.stale') : '') : t('invest.no_price')) : t('invest.closed'))),
        h('span', { class: 'frow__amt' }, U.money(hd.value, hd.currency), h('small', { class: pct >= 0 ? 'amt--in' : 'amt--over' }, (pct >= 0 ? '+' : '') + U.pct(pct, 1) + (hd.xirr != null ? ' · ' + t('invest.xirr_short', { pct: U.pct(hd.xirr, 1) }) : '')))));
    }
  }
  return node;
}

function depositSheet(ctx, dep) {
  const L = ctx.ledger;
  const accts = L.accounts().filter((x) => accountGroup(x.type) === 'deposit');
  if (!accts.length && !dep) {
    U.confirmDialog({ title: t('invest.need_deposit_title'), body: t('invest.need_deposit_body'), ok: t('accounts.add') }).then((ok) => { if (ok) accountSheet(ctx, null); });
    return;
  }
  const d = dep || { kind: 'term', account: accts[0].id, principal_minor: 0, rate_bp: 700, start: L.today(), maturity: addMonths(L.today(), 12), compounding: 'quarterly', payout: 'cumulative', withholding_bp: 0, instalment_minor: 0 };
  const ccyOf = (id) => ((L.get('account', id) || {}).currency) || L.base();
  const kind = U.select(['term', 'recurring', 'contribution'].map((k) => ({ value: k, label: t('invest.dep.' + k) })), d.kind);
  const acct = U.select(accts.map((x) => ({ value: x.id, label: x.name })), d.account);
  const principal = U.moneyField({ value: d.principal_minor ? U.amountToInput(d.principal_minor, ccyOf(d.account)) : '' });
  const inst = U.moneyField({ value: d.instalment_minor ? U.amountToInput(d.instalment_minor, ccyOf(d.account)) : '' });
  const rate = U.input({ value: pctInput(d.rate_bp), inputmode: 'decimal' });
  const start = h('input', { class: 'fi', type: 'date', value: d.start });
  const mat = h('input', { class: 'fi', type: 'date', value: d.maturity || '' });
  const comp = U.select(['quarterly', 'monthly', 'annual', 'daily', 'simple'].map((k) => ({ value: k, label: t('invest.comp.' + k) })), d.compounding);
  const payout = U.select(['cumulative', 'monthly', 'quarterly', 'annual'].map((k) => ({ value: k, label: t('invest.payout.' + k) })), d.payout || 'cumulative');
  const wh = U.input({ value: pctInput(d.withholding_bp), inputmode: 'decimal' });
  const pF = U.field(t('invest.principal'), principal);
  const iF = U.field(t('invest.instalment'), inst);
  const syncK = () => { pF.hidden = kind.value === 'recurring'; iF.hidden = kind.value !== 'recurring'; };
  kind.addEventListener('change', syncK);
  syncK();
  const err = h('p', { class: 'ff__err', role: 'alert' });
  const save = h('button', { type: 'button', class: 'fb fb--primary' }, t('common.save'));
  const del = dep ? h('button', { type: 'button', class: 'fb fb--danger fb--icon', 'aria-label': t('common.delete'), onclick: () => { sh.close(); ctx.commit(ctx.remove('deposit', dep.id), t('invest.dep_deleted')); } }, icon('trash')) : null;
  const sh = U.sheet({ title: dep ? t('invest.edit_dep') : t('invest.add_dep'), body: h('div', { class: 'ff-grid' }, U.field(t('invest.dep_kind'), kind), U.field(t('entry.account'), acct), pF, iF, U.field(t('invest.rate'), rate), U.field(t('invest.start'), start), U.field(t('invest.maturity'), mat), U.field(t('invest.compounding'), comp), U.field(t('invest.payout_label'), payout), U.field(t('invest.withholding'), wh), err), foot: [del, h('button', { type: 'button', class: 'fb', onclick: () => sh.close() }, t('common.cancel')), save].filter(Boolean) });
  save.addEventListener('click', () => {
    const ccy = ccyOf(acct.value);
    if (!isISODate(start.value)) { err.textContent = t('entry.err_date'); return; }
    const fields = { kind: kind.value, account: acct.value, principal_minor: Math.abs(U.parseAmount(principal.value, ccy) || 0), instalment_minor: Math.abs(U.parseAmount(inst.value, ccy) || 0), rate_bp: Math.round(parseFloat(String(rate.value).replace(',', '.')) * 100) || 0, start: start.value, maturity: isISODate(mat.value) ? mat.value : null, compounding: comp.value, payout: payout.value, withholding_bp: Math.round(parseFloat(String(wh.value).replace(',', '.')) * 100) || 0 };
    if (kind.value === 'recurring' ? !fields.instalment_minor : !fields.principal_minor) { err.textContent = t('entry.err_amount'); return; }
    sh.close();
    ctx.commit(ctx.save('deposit', dep ? dep.id : ctx.newId(), fields), dep ? t('invest.dep_saved') : t('invest.dep_added'));
  });
}

function depositsTab(ctx) {
  const L = ctx.ledger;
  const node = h('div');
  node.append(h('div', { class: 'ftool' }, h('button', { type: 'button', class: 'fb fb--primary', onclick: () => depositSheet(ctx, null) }, icon('plus'), t('invest.add_dep'))));
  const deps = L.list('deposit').sort((a, b) => String(a.maturity || '9999').localeCompare(String(b.maturity || '9999')));
  if (!deps.length) { node.append(U.empty(t('invest.dep_empty'))); return node; }
  for (const d of deps) {
    const acct = L.get('account', d.account);
    const ccy = (acct && acct.currency) || L.base();
    const now = depositValue(d, L.today());
    const mv = maturityValue(d);
    const days = d.maturity ? diffDays(L.today(), d.maturity) : null;
    node.append(h('button', { type: 'button', class: 'frow', onclick: () => depositSheet(ctx, d) },
      U.mono('', days != null && days <= 30 && days >= 0 ? '#fbbf24' : '#22d3ee', false, 'bank'),
      h('span', { class: 'frow__main' }, h('span', { class: 'frow__title' }, (acct ? acct.name : '—') + ' · ' + t('invest.dep.' + d.kind)), h('span', { class: 'frow__meta' }, U.pct((d.rate_bp || 0) / 10000, 2) + ' · ' + (d.maturity ? (days >= 0 ? t('invest.matures', { date: U.date(d.maturity) }) : t('invest.matured', { date: U.date(d.maturity) })) : t('invest.open_ended')))),
      h('span', { class: 'frow__amt' }, U.money(now.value, ccy), mv ? h('small', null, t('invest.at_maturity', { amount: U.money(mv.value, ccy, { compact: true }) })) : null)));
  }
  return node;
}

function loanSheet(ctx, loan) {
  const L = ctx.ledger;
  const accts = L.accounts().filter((x) => x.type === 'loan');
  if (!accts.length && !loan) {
    U.confirmDialog({ title: t('invest.need_loan_title'), body: t('invest.need_loan_body'), ok: t('accounts.add') }).then((ok) => { if (ok) accountSheet(ctx, null); });
    return;
  }
  const l = loan || { account: accts[0].id, principal_minor: 0, rate_bp: 900, start: L.today(), tenure_months: 240, emi_day: null, rate_type: 'fixed' };
  const ccyOf = (id) => ((L.get('account', id) || {}).currency) || L.base();
  const acct = U.select(accts.map((x) => ({ value: x.id, label: x.name })), l.account);
  const principal = U.moneyField({ value: l.principal_minor ? U.amountToInput(l.principal_minor, ccyOf(l.account)) : '' });
  const rate = U.input({ value: pctInput(l.rate_bp), inputmode: 'decimal' });
  const start = h('input', { class: 'fi', type: 'date', value: l.start });
  const tenure = h('input', { class: 'fi', type: 'number', min: '1', max: '600', value: String(l.tenure_months || 240) });
  const emiIn = U.moneyField({ value: l.emi_minor ? U.amountToInput(l.emi_minor, ccyOf(l.account)) : '', placeholder: t('invest.emi_auto') });
  const preview = h('p', { class: 'fsmall fmuted' });
  const upd = () => {
    const ccy = ccyOf(acct.value);
    const p = Math.abs(U.parseAmount(principal.value, ccy) || 0);
    const r = Math.round(parseFloat(String(rate.value).replace(',', '.')) * 100) || 0;
    const n = parseInt(tenure.value, 10) || 0;
    if (p && n) preview.textContent = t('invest.emi_preview', { amount: U.money(emi(p, r, n), ccy) });
  };
  for (const el of [principal, rate, tenure]) el.addEventListener('input', upd);
  upd();
  const err = h('p', { class: 'ff__err', role: 'alert' });
  const save = h('button', { type: 'button', class: 'fb fb--primary' }, t('common.save'));
  const del = loan ? h('button', { type: 'button', class: 'fb fb--danger fb--icon', 'aria-label': t('common.delete'), onclick: () => { sh.close(); ctx.commit(ctx.remove('loan', loan.id), t('invest.loan_deleted')); } }, icon('trash')) : null;
  const sh = U.sheet({ title: loan ? t('invest.edit_loan') : t('invest.add_loan'), body: h('div', { class: 'fstack' }, h('div', { class: 'ff-grid' }, U.field(t('entry.account'), acct), U.field(t('invest.principal'), principal), U.field(t('invest.rate'), rate), U.field(t('invest.start'), start), U.field(t('invest.tenure'), tenure), U.field(t('invest.emi'), emiIn)), preview, err), foot: [del, h('button', { type: 'button', class: 'fb', onclick: () => sh.close() }, t('common.cancel')), save].filter(Boolean) });
  save.addEventListener('click', () => {
    const ccy = ccyOf(acct.value);
    const p = Math.abs(U.parseAmount(principal.value, ccy) || 0);
    if (!p) { err.textContent = t('entry.err_amount'); return; }
    if (!isISODate(start.value)) { err.textContent = t('entry.err_date'); return; }
    const fields = { account: acct.value, principal_minor: p, rate_bp: Math.round(parseFloat(String(rate.value).replace(',', '.')) * 100) || 0, start: start.value, tenure_months: Math.max(1, parseInt(tenure.value, 10) || 1), emi_minor: emiIn.value.trim() ? Math.abs(U.parseAmount(emiIn.value, ccy) || 0) : null, rate_type: 'fixed' };
    sh.close();
    ctx.commit(ctx.save('loan', loan ? loan.id : ctx.newId(), fields), loan ? t('invest.loan_saved') : t('invest.loan_added'));
  });
}

function loansTab(ctx) {
  const L = ctx.ledger;
  const node = h('div');
  node.append(h('div', { class: 'ftool' }, h('button', { type: 'button', class: 'fb fb--primary', onclick: () => loanSheet(ctx, null) }, icon('plus'), t('invest.add_loan'))));
  const loans = L.list('loan');
  if (!loans.length) { node.append(U.empty(t('invest.loan_empty'))); return node; }
  for (const l of loans) {
    const acct = L.get('account', l.account);
    const ccy = (acct && acct.currency) || L.base();
    const o = loanOutstanding(l, L.today());
    const am = amortize(l);
    const card = h('div', { class: 'fcard', style: { marginBottom: '12px' } },
      h('div', { class: 'fcard__head' }, h('h3', { class: 'fcard__title' }, acct ? acct.name : '—'), h('button', { type: 'button', class: 'fcard__link', onclick: () => loanSheet(ctx, l) }, t('common.edit'))),
      h('div', { class: 'fstats fstats--4' },
        h('div', { class: 'fstat' }, h('span', { class: 'fstat__label' }, t('invest.outstanding')), h('span', { class: 'fmid amt--over' }, U.money(o.balance, ccy, { compact: true }))),
        h('div', { class: 'fstat' }, h('span', { class: 'fstat__label' }, t('invest.emi')), h('span', { class: 'fmid' }, U.money(o.emi, ccy))),
        h('div', { class: 'fstat' }, h('span', { class: 'fstat__label' }, t('invest.remaining')), h('span', { class: 'fmid' }, U.tp('plan.months', o.remaining))),
        h('div', { class: 'fstat' }, h('span', { class: 'fstat__label' }, t('invest.total_interest')), h('span', { class: 'fmid' }, U.money(am.totalInterest, ccy, { compact: true })))),
      U.bar(l.principal_minor - o.balance, l.principal_minor, { color: '#6ef3c5' }),
      o.next ? h('p', { class: 'fsmall fmuted', style: { marginTop: '8px' } }, t('invest.next_emi', { date: U.date(o.next.date), principal: U.money(o.next.principal, ccy), interest: U.money(o.next.interest, ccy) })) : null);
    node.append(card);
  }
  return node;
}

export function render(ctx) {
  const vs = ctx.viewState;
  if (!vs.tab) vs.tab = 'holdings';
  const node = h('div');
  const tabs = h('div', { class: 'ftabs', role: 'tablist' });
  for (const [k, label] of [['holdings', t('invest.tab_holdings')], ['deposits', t('invest.tab_deposits')], ['loans', t('invest.tab_loans')]]) {
    tabs.append(h('button', { type: 'button', role: 'tab', class: vs.tab === k ? 'is-on' : '', 'aria-selected': vs.tab === k ? 'true' : 'false', onclick: () => { vs.tab = k; ctx.rerender(); } }, label));
  }
  node.append(tabs, vs.tab === 'deposits' ? depositsTab(ctx) : vs.tab === 'loans' ? loansTab(ctx) : holdingsTab(ctx));
  return { title: t('nav.invest'), node };
}
