import * as U from './ui.js';
import { decimalsFor, convertMinor, localeSeparators, minorToDecimal, toMinor, trimDecimal, decimalToInput, formatDecimal } from './money.js';
import { isISODate, weekday, weekdayNames } from './dates.js';
import { parseEntry, aiPrompt, parseAiJson } from './nl.js';
import { payeeKey } from './ledger.js';
import * as R from './rules.js';
import { offerSimilar } from './categorize.js';

const { h, t, icon } = U;
const LOCAL_ASK = '/assets/js/mentria-local-ask.js';

function nlWords() {
  return {
    today: t('nl.today'), yesterday: t('nl.yesterday'), daybefore: t('nl.daybefore'), tomorrow: t('nl.tomorrow'),
    last: t('nl.last'), income: t('nl.income'), transfer: t('nl.transfer'), filler: t('nl.filler')
  };
}

export function nlContext(L) {
  return {
    today: L.today(), locale: U.locale(), words: nlWords(),
    accounts: L.accounts(), categories: L.leafCategories(), payees: L.payees().slice(0, 300).map((p) => p.name),
    suggest: (p) => L.suggestCategory(p)
  };
}

function decimalChar() { return localeSeparators(U.locale()).decimal; }
function fieldText(dec) { return decimalToInput(dec, U.locale()); }
function fromField(text, decimals) { return U.readNumber(text, decimals) || ''; }

export function minorFromTyped(str, ccy) {
  if (!str) return null;
  try {
    const m = toMinor(str, ccy);
    return m == null ? null : Math.abs(m);
  } catch (_) { return null; }
}

export function openEntry(ctx, opts) {
  const o = opts || {};
  const L = ctx.ledger;
  const base = L.base();
  const existing = o.id ? L.get('transaction', o.id) : null;
  const existingXfer = o.transferId ? L.get('transfer', o.transferId) : null;
  const isEdit = !!(existing || existingXfer);
  const st = {
    mode: existingXfer ? 'xfer' : existing ? ((existing.amount_minor || 0) > 0 ? 'in' : 'out') : (o.kind || 'out'),
    typed: '',
    account: o.account || L.lastAccount(),
    toAccount: null,
    toTyped: '',
    category: o.category || null,
    payee: '',
    note: '',
    date: o.date || L.today(),
    tags: [],
    lines: null,
    cleared: false,
    fxTyped: '',
    amountFromText: false,
    touched: new Set()
  };
  if (existing) {
    st.account = existing.account;
    st.typed = minorToDecimal(Math.abs(existing.amount_minor || 0), decimalsFor(existing.currency || base));
    st.category = existing.category || null;
    st.payee = existing.payee || '';
    st.note = existing.note || '';
    st.date = existing.date;
    st.tags = existing.tags || [];
    st.cleared = !!existing.cleared;
    if (Array.isArray(existing.lines) && existing.lines.length) st.lines = existing.lines.map((ln) => ({ category: ln.category, typed: minorToDecimal(Math.abs(ln.amount_minor || 0), decimalsFor(existing.currency || base)), note: ln.note || '' }));
    if (existing.fx_rate_e6) st.fxTyped = trimDecimal(minorToDecimal(existing.fx_rate_e6, 6));
  }
  if (existingXfer) {
    st.account = existingXfer.from_account;
    st.toAccount = existingXfer.to_account;
    const fa = L.get('account', existingXfer.from_account);
    const ta = L.get('account', existingXfer.to_account);
    st.typed = minorToDecimal(Math.abs(existingXfer.from_minor || 0), decimalsFor((fa && fa.currency) || base));
    st.toTyped = minorToDecimal(Math.abs(existingXfer.to_minor || 0), decimalsFor((ta && ta.currency) || base));
    st.note = existingXfer.note || '';
    st.date = existingXfer.date;
  }
  if (!isEdit) {
    if (o.amountMinor) st.typed = minorToDecimal(Math.abs(o.amountMinor), decimalsFor(((L.get('account', st.account) || {}).currency) || base));
    if (o.payee) st.payee = o.payee;
    if (o.note) st.note = o.note;
    if (o.amountMinor > 0) st.mode = 'in';
    if (o.payee || o.amountMinor) for (const k of ['amount', 'payee', 'category', 'account', 'date']) st.touched.add(k);
  }
  if (!st.toAccount) {
    const other = L.accounts().find((a) => a.id !== st.account);
    st.toAccount = other ? other.id : null;
  }
  const touch = U.isTouch();
  const acctCcy = (id) => { const a = L.get('account', id); return (a && a.currency) || base; };

  const nl = U.input({ placeholder: t('entry.nl_ph'), enterkeyhint: 'done', 'aria-label': t('entry.nl_label') });
  const nlHint = h('p', { class: 'fqa__nlhint', 'aria-live': 'polite' });
  const aiBtn = h('button', { type: 'button', class: 'fb fb--icon', title: t('entry.ai'), 'aria-label': t('entry.ai'), hidden: true }, icon('sparkle'));
  const amountEl = h('div', { class: 'fqa__value', 'aria-live': 'polite' });
  const amountInput = U.moneyField({ class: 'fi fi--num', style: { fontSize: '1.6rem', textAlign: 'center', fontWeight: '600' }, 'aria-label': t('entry.amount') });
  const ccyChip = h('span', { class: 'fqa__ccy' });
  const typeSeg = h('div');
  const catsWrap = h('div');
  const xferWrap = h('div');
  const detailWrap = h('div', { class: 'ff-grid', style: { marginTop: '6px' } });
  const moreWrap = h('details', { style: { marginTop: '12px' } });
  const keypad = touch ? h('div', { class: 'fkp' }) : null;
  const err = h('p', { class: 'ff__err', role: 'alert' });
  const noAccount = h('div', { class: 'fbanner', hidden: true }, icon('info'), h('span', null, t('entry.no_accounts')),
    h('button', { type: 'button', class: 'fb fb--sm', onclick: () => import('./views/accounts.js').then((A) => A.accountSheet(ctx, null)) }, t('accounts.add')));
  let showAllCats = false;
  let fxPreview = null;

  function renderType() {
    typeSeg.replaceChildren(U.seg([
      { value: 'out', label: t('entry.expense') },
      { value: 'in', label: t('entry.income') },
      { value: 'xfer', label: t('entry.transfer') }
    ], st.mode, (v) => { st.mode = v; st.category = null; refreshAll(); }, true));
  }

  function amountMinor() { return minorFromTyped(st.typed, acctCcy(st.account)); }

  function renderAmount() {
    const ccy = acctCcy(st.account);
    const m = amountMinor();
    amountEl.textContent = m == null ? U.money(0, ccy) : U.money(m, ccy);
    amountEl.classList.toggle('is-in', st.mode === 'in');
    ccyChip.textContent = ccy;
    if (document.activeElement !== amountInput) amountInput.value = fieldText(st.typed);
    updateFx();
  }

  function updateFx() {
    if (!fxPreview) return;
    const ccy = acctCcy(st.account);
    const m = amountMinor();
    const rate = st.fxTyped ? minorFromTyped(st.fxTyped, 6) : L.rateE6(ccy, base, st.date);
    let text = '';
    if (m && rate) { try { text = U.money(m, ccy) + ' ≈ ' + U.money(convertMinor(m, ccy, base, rate), base); } catch (_) {} }
    fxPreview.textContent = text;
    fxPreview.hidden = !text;
  }

  function catList() {
    const kind = st.mode === 'in' ? 'income' : 'expense';
    const leaves = L.leafCategories(kind);
    const counts = new Map();
    for (const r of L.rows().slice(0, 600)) if (r.category) counts.set(r.category, (counts.get(r.category) || 0) + 1);
    return leaves.slice().sort((a, b) => (counts.get(b.id) || 0) - (counts.get(a.id) || 0) || (a.order || 0) - (b.order || 0));
  }

  function renderCats() {
    if (st.mode === 'xfer') { catsWrap.replaceChildren(); return; }
    const list = catList();
    const limit = showAllCats ? list.length : Math.min(list.length, touch ? 7 : 11);
    const grid = h('div', { class: 'fcats', role: 'radiogroup', 'aria-label': t('entry.category') });
    for (const c of list.slice(0, limit)) {
      const on = st.category === c.id;
      grid.append(h('button', { type: 'button', class: 'fcat' + (on ? ' is-on' : ''), role: 'radio', 'aria-checked': on ? 'true' : 'false', onclick: () => {
        st.category = on ? null : c.id;
        st.touched.add('category');
        if (st.lines) st.lines = null;
        renderCats();
      } }, U.mono(c.icon || c.name, c.color), h('span', null, c.name)));
    }
    if (list.length > limit || showAllCats) {
      grid.append(h('button', { type: 'button', class: 'fcat', onclick: () => { showAllCats = !showAllCats; renderCats(); } }, U.mono('', 'var(--f-muted)', false, showAllCats ? 'back' : 'more'), h('span', null, showAllCats ? t('entry.fewer') : t('entry.all_cats'))));
    }
    catsWrap.replaceChildren(grid);
  }

  function acctOptions(exclude) {
    const groups = new Map();
    for (const a of L.accounts()) {
      if (a.id === exclude) continue;
      const g = t('accounts.group.' + accountGroupOf(a));
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push({ value: a.id, label: a.name + (a.currency !== base ? ' · ' + a.currency : '') });
    }
    return Array.from(groups, ([group, options]) => ({ group, options }));
  }

  function renderXfer() {
    if (st.mode !== 'xfer') { xferWrap.replaceChildren(); return; }
    const from = U.select(acctOptions(null), st.account, { onchange: (e) => { st.account = e.target.value; if (st.toAccount === st.account) st.toAccount = null; refreshAll(); } });
    const to = U.select([{ value: '', label: t('entry.pick_account'), disabled: true }].concat(acctOptions(st.account)), st.toAccount || '', { onchange: (e) => { st.toAccount = e.target.value; refreshAll(); } });
    const kids = [U.field(t('entry.from'), from), U.field(t('entry.to'), to)];
    if (st.toAccount && acctCcy(st.toAccount) !== acctCcy(st.account)) {
      const rec = U.moneyField({ value: fieldText(st.toTyped), placeholder: '0', oninput: (e) => { st.toTyped = fromField(e.target.value, decimalsFor(acctCcy(st.toAccount))); } });
      kids.push(U.field(t('entry.received', { ccy: acctCcy(st.toAccount) }), rec, t('entry.received_hint'), 'ff--wide'));
    }
    xferWrap.replaceChildren(h('div', { class: 'ff-grid', style: { margin: '8px 0 4px' } }, ...kids));
  }

  function renderDetails() {
    const kids = [];
    if (st.mode !== 'xfer') {
      kids.push(U.field(t('entry.account'), U.select(acctOptions(null), st.account, { onchange: (e) => { st.account = e.target.value; st.touched.add('account'); renderAmount(); renderMore(); renderKeypad(); } })));
    }
    const dateIn = h('input', { class: 'fi', type: 'date', value: st.date, required: true, onchange: (e) => { if (isISODate(e.target.value)) { st.date = e.target.value; st.touched.add('date'); } } });
    kids.push(U.field(t('entry.date'), dateIn));
    if (st.mode !== 'xfer') {
      const listId = 'fin-payees';
      const payee = U.input({ value: st.payee, list: listId, placeholder: t('entry.payee_ph'), maxlength: '120', oninput: (e) => {
        st.payee = e.target.value;
        st.touched.add('payee');
        if (!st.touched.has('category') && !st.category) {
          const s = L.suggestCategory(st.payee);
          if (s) { st.category = s; renderCats(); }
        }
      } });
      const dl = h('datalist', { id: listId }, L.payees().slice(0, 80).map((p) => h('option', { value: p.name })));
      kids.push(h('div', { class: 'ff' }, h('label', { class: 'ff__label', for: 'fin-payee' }, t('entry.payee')), Object.assign(payee, { id: 'fin-payee' }), dl));
    }
    kids.push(U.field(t('entry.note'), U.input({ value: st.note, maxlength: '300', placeholder: t('entry.note_ph'), oninput: (e) => { st.note = e.target.value; } })));
    detailWrap.replaceChildren(...kids);
  }

  function renderMore() {
    if (st.mode === 'xfer') { moreWrap.replaceChildren(); moreWrap.hidden = true; return; }
    moreWrap.hidden = false;
    fxPreview = null;
    const ccy = acctCcy(st.account);
    const tags = U.input({ value: (st.tags || []).join(', '), placeholder: t('entry.tags_ph'), oninput: (e) => { st.tags = e.target.value.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 12); } });
    const cleared = U.checkbox(t('entry.cleared'), st.cleared, (v) => { st.cleared = v; });
    const kids = [h('summary', { style: { cursor: 'pointer', color: 'var(--f-muted)', fontSize: '0.88rem' } }, t('entry.more'))];
    const grid = h('div', { class: 'ff-grid', style: { marginTop: '10px' } }, U.field(t('entry.tags'), tags), h('div', { class: 'ff', style: { justifyContent: 'flex-end' } }, cleared));
    kids.push(grid);
    if (ccy !== base) {
      const known = L.rateE6(ccy, base, st.date);
      const fx = U.moneyField({ value: fieldText(st.fxTyped || (known ? trimDecimal(minorToDecimal(known, 6)) : '')), placeholder: fieldText('0.00'), oninput: (e) => { st.fxTyped = fromField(e.target.value, 6); updateFx(); } });
      U.readBack(fx, 6, (dec) => formatDecimal(trimDecimal(dec), U.locale()));
      fxPreview = h('span', { class: 'ff__hint fnum', 'aria-live': 'polite' });
      grid.append(U.field(t('entry.fx', { from: ccy, to: base }), fx, known ? t('entry.fx_known') : t('entry.fx_needed'), 'ff--wide'));
      fx.after(fxPreview);
      if (!known) moreWrap.open = true;
    }
    const splitBox = h('div', { class: 'ff ff--wide', style: { gridColumn: '1 / -1' } });
    const renderSplit = () => {
      splitBox.replaceChildren(h('span', { class: 'ff__label' }, t('entry.split')));
      if (!st.lines) {
        splitBox.append(h('button', { type: 'button', class: 'fb fb--sm', onclick: () => {
          const total = amountMinor() || 0;
          st.lines = [{ category: st.category, typed: total ? minorToDecimal(total, decimalsFor(ccy)) : '', note: '' }, { category: null, typed: '', note: '' }];
          renderSplit();
        } }, t('entry.split_add')));
        return;
      }
      const kind = st.mode === 'in' ? 'income' : 'expense';
      const opts = [{ value: '', label: t('entry.no_category') }].concat(L.leafCategories(kind).map((c) => ({ value: c.id, label: c.name })));
      st.lines.forEach((ln, i) => {
        splitBox.append(h('div', { class: 'fsplit' },
          U.select(opts, ln.category || '', { onchange: (e) => { ln.category = e.target.value || null; } }),
          U.moneyField({ value: fieldText(ln.typed), placeholder: '0', oninput: (e) => { ln.typed = fromField(e.target.value, decimalsFor(ccy)); updateSplitSum(); } }),
          h('button', { type: 'button', class: 'fb fb--ghost fb--icon', 'aria-label': t('common.remove'), onclick: () => { st.lines.splice(i, 1); if (st.lines.length < 2) st.lines = null; renderSplit(); } }, icon('close'))
        ));
      });
      const sum = h('p', { class: 'ff__hint', id: 'fin-split-sum' });
      splitBox.append(h('div', { class: 'fb-row' }, h('button', { type: 'button', class: 'fb fb--sm', onclick: () => { st.lines.push({ category: null, typed: '', note: '' }); renderSplit(); } }, t('entry.split_line')), sum));
      updateSplitSum();
    };
    const updateSplitSum = () => {
      const el = splitBox.querySelector('#fin-split-sum');
      if (!el || !st.lines) return;
      const total = amountMinor() || 0;
      const sum = st.lines.reduce((n, ln) => n + (minorFromTyped(ln.typed, ccy) || 0), 0);
      el.textContent = t('entry.split_sum', { sum: U.money(sum, ccy), total: U.money(total, ccy) });
      el.style.color = sum === total ? 'var(--f-in)' : 'var(--f-warn)';
    };
    renderSplit();
    grid.append(splitBox);
    moreWrap.replaceChildren(...kids);
    if (st.lines || (st.tags && st.tags.length)) moreWrap.open = true;
    updateFx();
  }

  function renderKeypad() {
    if (!keypad) return;
    const dc = decimalsFor(acctCcy(st.account)) > 0 ? decimalChar() : null;
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', dc, '0', 'back'];
    keypad.replaceChildren(...keys.map((k) => k == null
      ? h('span', { class: 'fkp__gap', 'aria-hidden': 'true' })
      : h('button', { type: 'button', 'aria-label': k === 'back' ? t('entry.backspace') : k, onclick: () => press(k) }, k === 'back' ? icon('backspace') : k)));
  }

  function press(k) {
    const d = decimalsFor(acctCcy(st.account));
    let s = st.typed || '';
    if (k === 'back') s = s.slice(0, -1);
    else if (k === decimalChar() || k === '.' || k === ',') { if (d > 0 && !s.includes('.')) s = (s || '0') + '.'; }
    else if (/^\d$/.test(k)) {
      const [i, f] = s.split('.');
      if (f != null && f.length >= d) return;
      if (f == null && (i || '').length >= 12) return;
      s = s === '0' ? k : s + k;
    }
    st.typed = s;
    st.touched.add('amount');
    renderAmount();
    if (st.lines) renderMore();
  }

  function applyParse(p, fromAi) {
    if (p.amount && (!st.touched.has('amount') || fromAi)) { st.typed = p.amount; st.amountFromText = true; }
    else if (!fromAi && !p.amount && st.amountFromText && !st.touched.has('amount')) { st.typed = ''; st.amountFromText = false; }
    if (p.transfer && L.accounts().length > 1) {
      st.mode = 'xfer';
      if (p.account) st.account = p.account;
      if (p.toAccount) st.toAccount = p.toAccount;
    } else {
      if (st.mode === 'xfer') st.mode = 'out';
      if (p.income) st.mode = 'in';
      else if (st.mode === 'in' && !p.income && !fromAi) st.mode = 'out';
      if (p.account && !st.touched.has('account')) st.account = p.account;
      if (p.category && !st.touched.has('category')) st.category = p.category;
      if (p.payee && !st.touched.has('payee')) st.payee = p.payee;
    }
    if (p.date && !st.touched.has('date')) st.date = p.date;
    if (p.note) st.note = p.note;
    const parts = [];
    if (p.amount) parts.push(U.money(minorFromTyped(p.amount, acctCcy(st.account)) || 0, acctCcy(st.account)));
    if (p.payee) parts.push(p.payee);
    if (st.category) { const c = L.categoryMap().get(st.category); if (c) parts.push(c.name); }
    if (p.date) parts.push(U.date(p.date, 'dayMonth'));
    nlHint.textContent = parts.length ? t('entry.nl_read', { what: parts.join(' · ') }) : '';
    if (p.currency && p.currency !== acctCcy(st.account)) {
      const match = L.accounts().find((a) => a.currency === p.currency);
      if (match && !st.touched.has('account')) st.account = match.id;
      else nlHint.textContent += ' ' + t('entry.nl_ccy', { ccy: p.currency });
    }
    refreshAll();
  }

  const parseNow = () => {
    const text = nl.value.trim();
    if (!text) {
      nlHint.textContent = '';
      if (st.amountFromText && !st.touched.has('amount')) { st.typed = ''; st.amountFromText = false; renderAmount(); }
      return;
    }
    applyParse(parseEntry(text, nlContext(L)), false);
    aiBtn.hidden = !aiAvailable();
  };
  nl.addEventListener('input', U.debounce(parseNow, 220));
  nl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); parseNow(); if (amountMinor()) save(false); } });

  function aiAvailable() { return L.settings().ai_entry !== false && !!nl.value.trim(); }
  aiBtn.addEventListener('click', async () => {
    aiBtn.disabled = true;
    nlHint.textContent = t('entry.ai_thinking');
    try {
      const res = await aiParse(L, nl.value.trim());
      if (res) applyParse(res, true);
      else nlHint.textContent = t('entry.ai_failed');
    } catch (e) {
      nlHint.textContent = String(e && e.message) === 'no-model' ? t('entry.ai_no_model') : t('entry.ai_failed');
    }
    aiBtn.disabled = false;
  });

  amountInput.addEventListener('input', () => { st.typed = fromField(amountInput.value, decimalsFor(acctCcy(st.account))); st.touched.add('amount'); amountEl.textContent = ''; updateFx(); });
  amountInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(false); } });

  function refreshAll() {
    noAccount.hidden = L.accounts().length > 0;
    renderType();
    renderAmount();
    renderCats();
    renderXfer();
    renderDetails();
    renderMore();
    renderKeypad();
  }

  const body = h('div', null,
    noAccount,
    typeSeg,
    h('div', { style: { height: '10px' } }),
    h('div', { class: 'fqa__nl' }, nl, aiBtn),
    nlHint,
    touch ? h('div', { class: 'fqa__amount' }, amountEl, ccyChip) : h('div', { class: 'fqa__amount', style: { alignItems: 'center' } }, amountInput, ccyChip),
    keypad,
    catsWrap,
    xferWrap,
    detailWrap,
    moreWrap,
    err
  );

  const saveBtn = h('button', { type: 'button', class: 'fb fb--primary', onclick: () => save(false) }, isEdit ? t('common.save') : t('entry.save'));
  const againBtn = !isEdit && !touch ? h('button', { type: 'button', class: 'fb', onclick: () => save(true) }, t('entry.save_another')) : null;
  const delBtn = isEdit ? h('button', { type: 'button', class: 'fb fb--danger fb--icon', 'aria-label': t('common.delete'), title: t('common.delete'), onclick: () => del() }, icon('trash')) : null;

  const onLedger = () => {
    if (!L.accounts().length || (st.account && L.exists('account', st.account))) return;
    st.account = L.lastAccount();
    if (!st.toAccount || st.toAccount === st.account) {
      const other = L.accounts().find((a) => a.id !== st.account);
      st.toAccount = other ? other.id : null;
    }
    refreshAll();
  };
  const engine = ctx.engine;
  engine.addEventListener('change', onLedger);
  const sheet = U.sheet({
    title: existingXfer ? t('entry.edit_transfer') : existing ? t('entry.edit') : t('entry.add'),
    body,
    foot: [delBtn, againBtn, saveBtn].filter(Boolean),
    focus: touch ? null : (o.text ? nl : amountInput),
    onClose: () => engine.removeEventListener('change', onLedger)
  });

  if (!ctx.writer) { saveBtn.disabled = true; if (againBtn) againBtn.disabled = true; if (delBtn) delBtn.disabled = true; err.textContent = t('errors.readonly'); }

  refreshAll();
  if (o.text) { nl.value = o.text; parseNow(); }
  aiBtn.hidden = !aiAvailable();

  async function save(again) {
    err.textContent = '';
    const ccy = acctCcy(st.account);
    const m = amountMinor();
    if (!m) { err.textContent = t('entry.err_amount'); return; }
    if (!st.account || !L.exists('account', st.account)) { err.textContent = t('entry.err_account'); return; }
    if (!isISODate(st.date)) { err.textContent = t('entry.err_date'); return; }
    const now = new Date().toISOString();
    const ops = [];
    let undo = null;
    if (st.mode === 'xfer') {
      if (!st.toAccount || st.toAccount === st.account || !L.exists('account', st.toAccount)) { err.textContent = t('entry.err_to'); return; }
      const toCcy = acctCcy(st.toAccount);
      let toMinorV = m;
      if (toCcy !== ccy) {
        toMinorV = minorFromTyped(st.toTyped, toCcy);
        if (!toMinorV) {
          const r = L.rateE6(ccy, toCcy, st.date);
          if (r == null) { err.textContent = t('entry.err_received'); return; }
          toMinorV = Math.abs(convertMinor(m, ccy, toCcy, r));
        }
      }
      const fields = { date: st.date, from_account: st.account, to_account: st.toAccount, from_minor: m, to_minor: toMinorV, note: st.note.trim().slice(0, 300) };
      if (existingXfer) {
        const prev = Object.assign({}, existingXfer);
        ops.push(...ctx.engine.updateOps('transfer', existingXfer.id, fields));
        undo = () => ctx.engine.updateOps('transfer', prev.id, pick(prev, Object.keys(fields)));
      } else if (existing) {
        const id = ctx.newId();
        ops.push(...ctx.engine.removeOps('transaction', existing.id));
        ops.push(...ctx.engine.createOps('transfer', id, Object.assign({ created: now }, fields)));
      } else {
        const id = ctx.newId();
        ops.push(...ctx.engine.createOps('transfer', id, Object.assign({ created: now }, fields)));
        undo = () => ctx.engine.removeOps('transfer', id);
      }
    } else {
      const sign = st.mode === 'in' ? 1 : -1;
      let lines = null;
      if (st.lines) {
        const parsed = st.lines.map((ln) => ({ category: ln.category || null, amount_minor: sign * (minorFromTyped(ln.typed, ccy) || 0), note: ln.note || '' })).filter((ln) => ln.amount_minor !== 0);
        const sum = parsed.reduce((n, ln) => n + Math.abs(ln.amount_minor), 0);
        if (parsed.length >= 2) {
          if (sum !== m) { err.textContent = t('entry.err_split', { sum: U.money(sum, ccy), total: U.money(m, ccy) }); moreWrap.open = true; return; }
          lines = parsed;
        }
      }
      let fields = {
        date: st.date, amount_minor: sign * m, currency: ccy, account: st.account,
        category: lines ? null : st.category || null, payee: st.payee.trim().slice(0, 120), note: st.note.trim().slice(0, 300),
        tags: st.tags || [], lines, cleared: !!st.cleared, kind: sign > 0 ? 'income' : 'expense'
      };
      if (ccy !== base) {
        const rate = st.fxTyped ? minorFromTyped(st.fxTyped, 6) : L.rateE6(ccy, base, st.date);
        if (!rate) { err.textContent = t('entry.err_fx', { from: ccy, to: base }); moreWrap.open = true; renderMore(); return; }
        fields.fx_rate_e6 = rate;
        fields.base_minor = convertMinor(sign * m, ccy, base, rate);
        if (st.fxTyped) {
          const fid = 'fx:' + ccy + base + ':' + st.date;
          ops.push(...ctx.save('fx_rate', fid, { base: ccy, quote: base, date: st.date, rate_e6: rate, source: 'manual' }));
        }
      } else {
        fields.base_minor = sign * m;
        fields.fx_rate_e6 = null;
      }
      if (!existing) {
        const ruled = R.apply(L.list('rule'), fields);
        fields = ruled.txn;
      }
      if (existingXfer) {
        ops.push(...ctx.engine.removeOps('transfer', existingXfer.id));
        ops.push(...ctx.engine.createOps('transaction', ctx.newId(), Object.assign({ created: now, provenance: 'manual' }, fields)));
      } else if (existing) {
        const prev = Object.assign({}, existing);
        ops.push(...ctx.engine.updateOps('transaction', existing.id, fields));
        undo = () => ctx.engine.updateOps('transaction', prev.id, pick(prev, Object.keys(fields)));
      } else {
        const id = o.fixedId || ctx.newId();
        if (o.scheduleId) fields.schedule_id = o.scheduleId;
        ops.push(...ctx.engine.createOps('transaction', id, Object.assign({ created: now, provenance: o.scheduleId ? 'schedule' : nl.value.trim() ? 'text' : 'manual' }, fields)));
        undo = () => ctx.engine.removeOps('transaction', id);
      }
      if (fields.payee && fields.category) {
        const key = payeeKey(fields.payee);
        if (key) {
          const cur = L.get('payee', key);
          if (!cur || cur.default_category !== fields.category) ops.push(...ctx.save('payee', key, { name: fields.payee, default_category: fields.category }));
        }
      }
    }
    const ok = await ctx.commit(ops, isEdit ? t('entry.updated') : t('entry.saved'), undo);
    if (!ok) return;
    if (st.mode !== 'xfer' && st.category && !st.lines && (!existing || existing.category !== st.category)) {
      const savedId = existing ? existing.id : (ops.find((x) => x.e === 'transaction' && x.f === '*') || {}).id;
      if (savedId) offerSimilar(ctx, savedId, st.category);
    }
    if (again) {
      st.typed = '';
      st.payee = '';
      st.note = '';
      st.category = null;
      st.lines = null;
      st.tags = [];
      st.touched = new Set(['account', 'date']);
      nl.value = '';
      nlHint.textContent = '';
      refreshAll();
      (touch ? nl : amountInput).focus();
    } else {
      sheet.close();
      if (o.onSaved) o.onSaved();
    }
  }

  async function del() {
    const ops = existingXfer ? ctx.engine.removeOps('transfer', existingXfer.id) : ctx.engine.removeOps('transaction', existing.id);
    const prev = Object.assign({}, existingXfer || existing);
    const entity = existingXfer ? 'transfer' : 'transaction';
    sheet.close();
    await ctx.commit(ops, t('entry.deleted'), () => {
      const copy = Object.assign({}, prev);
      delete copy.id;
      return ctx.engine.createOps(entity, ctx.newId(), copy);
    });
  }

  return sheet;
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) out[k] = obj[k] === undefined ? null : obj[k];
  return out;
}

function accountGroupOf(a) {
  const tmap = { cash: 'cash', bank: 'cash', savings: 'cash', ewallet: 'cash', credit_card: 'credit', brokerage: 'invest', fund: 'invest', crypto_wallet: 'invest', term_deposit: 'deposit', recurring_deposit: 'deposit', contribution: 'deposit', other_asset: 'asset', loan: 'liability', other_liability: 'liability' };
  return tmap[a.type] || 'cash';
}

export async function aiParse(L, text) {
  let mod;
  try { mod = await import(LOCAL_ASK); } catch (_) { throw new Error('no-model'); }
  bridgeParentGlobals();
  if (!mod.localAskSupported || !mod.localAskSupported()) throw new Error('no-model');
  if (mod.isModelCached && !(await mod.isModelCached())) throw new Error('no-model');
  const today = L.today();
  const wn = weekdayNames('en')[weekday(today)][0];
  const ctx = { today, weekdayName: wn, categories: L.leafCategories(), accounts: L.accounts() };
  const answer = await mod.askLocal(aiPrompt(ctx), text, { maxTokens: 160, sampling: { temperature: 0, prefix: '{"' }, source: 'finance' });
  const v = parseAiJson(typeof answer === 'string' ? answer : (answer && answer.text) || '');
  if (!v) return null;
  const out = { amount: null, currency: null, income: false, transfer: false, date: null, category: null, account: null, toAccount: null, payee: '', note: '' };
  const amt = Number(v.amount);
  if (isFinite(amt) && amt > 0) {
    const pre = parseEntry(text, nlContext(L)).amounts.map((a) => Number(a.decimal));
    if (pre.length && !pre.some((x) => Math.abs(x - amt) < 1e-9)) return null;
    out.amount = String(amt);
  }
  if (typeof v.currency === 'string' && /^[A-Z]{3}$/.test(v.currency)) out.currency = v.currency;
  out.income = v.type === 'income';
  out.transfer = v.type === 'transfer';
  if (isISODate(v.date)) out.date = v.date;
  const cat = L.leafCategories().find((c) => c.name.toLowerCase() === String(v.category || '').toLowerCase());
  if (cat) out.category = cat.id;
  const acct = L.accounts().find((a) => a.name.toLowerCase() === String(v.account || '').toLowerCase());
  if (acct) out.account = acct.id;
  if (typeof v.payee === 'string') out.payee = v.payee.slice(0, 80);
  if (typeof v.note === 'string') out.note = v.note.slice(0, 200);
  return out;
}

function bridgeParentGlobals() {
  try {
    const P = window.parent;
    if (!P || P === window) return;
    for (const k of ['mentriaConfirm', 'MentriaUI', 'mentriaWrapEngine', 'mentriaConfirmHeavyDownload', 'MentriaI18n']) {
      if (window[k] === undefined && P[k] !== undefined) window[k] = P[k];
    }
  } catch (_) {}
}
