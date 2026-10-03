import * as U from '../ui.js';
import { cycleMonths, isISODate, addDays, diffDays } from '../dates.js';
import { detectStreams, cycleLabelKey, nextDue } from '../recurring.js';
import { payeeKey } from '../ledger.js';

const { h, t, icon } = U;

const FREQS = [
  ['week', { freq: 'week', interval: 1 }], ['biweek', { freq: 'week', interval: 2 }], ['month', { freq: 'month', interval: 1 }],
  ['bimonth', { freq: 'month', interval: 2 }], ['quarter', { freq: 'month', interval: 3 }], ['half', { freq: 'month', interval: 6 }],
  ['year', { freq: 'year', interval: 1 }], ['custom', null]
];

function freqId(rule) {
  const hit = FREQS.find(([, r]) => r && r.freq === (rule || {}).freq && r.interval === ((rule || {}).interval || 1));
  return hit ? hit[0] : 'custom';
}

export function cycleText(rule) {
  const k = cycleLabelKey(rule);
  return t('subs.cycle.' + k, { n: (rule && rule.interval) || 1 });
}

function monthly(s) {
  return Math.abs(s.amount_minor || 0) / Math.max(0.01, cycleMonths(s.rule || { freq: 'month' }));
}

export function scheduleSheet(ctx, sch, preset) {
  const L = ctx.ledger;
  const base = L.base();
  const s = sch || Object.assign({ name: '', kind: 'subscription', amount_minor: 0, account: L.lastAccount(), category: null, payee: '', rule: { freq: 'month', interval: 1 }, anchor: L.today(), end: { mode: 'never' }, auto_post: true, notify_days: -1, active: true, weekend_shift: 'none' }, preset || {});
  const acctCcy = (id) => ((L.get('account', id) || {}).currency) || base;
  const orphan = !!sch && L.scheduleOrphaned(sch);
  const name = U.input({ value: s.name || '', maxlength: '60', placeholder: t('subs.name_ph') });
  const kind = U.select(['subscription', 'bill', 'income'].map((k) => ({ value: k, label: t('subs.kind.' + k) })), s.kind || 'subscription');
  const amount = U.moneyField({ value: s.amount_minor ? U.amountToInput(s.amount_minor, acctCcy(s.account)) : '', placeholder: '0' });
  const acct = U.select(L.accounts().map((a) => ({ value: a.id, label: a.name + (a.currency !== base ? ' · ' + a.currency : '') })), orphan ? L.lastAccount() : s.account || L.lastAccount());
  const catSel = U.select([], '');
  const fillCats = () => {
    const kindCat = kind.value === 'income' ? 'income' : 'expense';
    const cur = catSel.value || s.category || '';
    catSel.replaceChildren(h('option', { value: '' }, t('entry.no_category')), ...L.leafCategories(kindCat).map((c) => h('option', { value: c.id, selected: c.id === cur }, c.name)));
    catSel.value = L.leafCategories(kindCat).some((c) => c.id === cur) ? cur : '';
  };
  fillCats();
  kind.addEventListener('change', fillCats);
  const freq = U.select(FREQS.map(([k]) => ({ value: k, label: t('subs.freq.' + k) })), freqId(s.rule));
  const every = h('input', { class: 'fi', type: 'number', min: '1', max: '99', value: String((s.rule && s.rule.interval) || 1) });
  const unit = U.select(['day', 'week', 'month', 'year'].map((u) => ({ value: u, label: t('subs.unit.' + u) })), (s.rule && s.rule.freq) || 'month');
  const customRow = h('div', { class: 'ff-grid' }, U.field(t('subs.every'), every), U.field(t('subs.unit_label'), unit));
  const syncFreq = () => { customRow.hidden = freq.value !== 'custom'; };
  freq.addEventListener('change', syncFreq);
  syncFreq();
  const nextDue = sch ? L.scheduleNext(sch, addDays(L.today(), -1)) || sch.anchor : s.anchor;
  const anchor = h('input', { class: 'fi', type: 'date', value: nextDue || L.today() });
  const endMode = U.select(['never', 'count', 'date'].map((m) => ({ value: m, label: t('subs.end.' + m) })), (s.end && s.end.mode) || 'never');
  const endN = h('input', { class: 'fi', type: 'number', min: '1', max: '999', value: String((s.end && s.end.n) || 12) });
  const endDate = h('input', { class: 'fi', type: 'date', value: (s.end && s.end.date) || '' });
  const endNF = U.field(t('subs.end_n'), endN);
  const endDF = U.field(t('subs.end_date'), endDate);
  const syncEnd = () => { endNF.hidden = endMode.value !== 'count'; endDF.hidden = endMode.value !== 'date'; };
  endMode.addEventListener('change', syncEnd);
  syncEnd();
  const auto = U.checkbox(t('subs.auto_post'), s.auto_post !== false, () => {});
  const shift = U.select(['none', 'before', 'after'].map((m) => ({ value: m, label: t('subs.shift.' + m) })), (s.rule && s.rule.weekend_shift) || 'none');
  const remind = h('input', { class: 'fi', type: 'number', min: '-1', max: '30', value: String(s.notify_days == null ? -1 : s.notify_days) });
  const trial = h('input', { class: 'fi', type: 'date', value: s.trial_end || '' });
  const cancelUrl = U.input({ value: s.cancel_url || '', type: 'url', placeholder: 'https://', maxlength: '300' });
  const notes = h('textarea', { class: 'fta', maxlength: '500' }, s.cancel_notes || '');
  const active = U.checkbox(t('subs.active'), s.active !== false, () => {});
  const err = h('p', { class: 'ff__err', role: 'alert' });
  const hist = (s.price_history || []).slice(-6).reverse();
  const save = h('button', { type: 'button', class: 'fb fb--primary' }, t('common.save'));
  const del = sch ? h('button', { type: 'button', class: 'fb fb--danger fb--icon', 'aria-label': t('common.delete'), onclick: async () => {
    const ok = await U.confirmDialog({ title: t('subs.delete_title'), body: t('subs.delete_body', { name: sch.name }), ok: t('common.delete'), danger: true });
    if (!ok) return;
    sh.close();
    ctx.commit(ctx.remove('schedule', sch.id), t('subs.deleted'));
  } }, icon('trash')) : null;
  const sh = U.sheet({
    title: sch ? t('subs.edit') : t('subs.add'), wide: true,
    body: h('div', { class: 'fstack' },
      h('div', { class: 'ff-grid' }, U.field(t('subs.name'), name), U.field(t('subs.kind_label'), kind)),
      h('div', { class: 'ff-grid' }, U.field(t('entry.amount'), amount, t('subs.amount_hint')), U.field(t('entry.account'), acct, orphan ? t('subs.account_gone') : null)),
      h('div', { class: 'ff-grid' }, U.field(t('subs.freq_label'), freq), U.field(sch ? t('subs.next_date') : t('subs.first_date'), anchor)),
      customRow,
      h('div', { class: 'ff-grid' }, U.field(t('entry.category'), catSel), U.field(t('subs.end_label'), endMode)),
      h('div', { class: 'ff-grid' }, endNF, endDF),
      auto, h('p', { class: 'ff__hint' }, t('subs.auto_hint')),
      h('details', null, h('summary', { style: { cursor: 'pointer', color: 'var(--f-muted)', fontSize: '0.88rem' } }, t('subs.more')),
        h('div', { class: 'fstack', style: { marginTop: '10px' } },
          h('div', { class: 'ff-grid' }, U.field(t('subs.remind'), remind, t('subs.remind_hint')), U.field(t('subs.shift_label'), shift)),
          h('div', { class: 'ff-grid' }, U.field(t('subs.trial'), trial), U.field(t('subs.cancel_url'), cancelUrl)),
          U.field(t('subs.notes'), notes),
          sch ? active : null,
          hist.length ? h('div', null, h('span', { class: 'ff__label' }, t('subs.price_history')), ...hist.map((p) => U.leader(U.date(p.date), U.money(Math.abs(p.old_minor), acctCcy(s.account)) + ' → ' + U.money(Math.abs(p.new_minor), acctCcy(s.account))))) : null)),
      err),
    foot: [del, h('button', { type: 'button', class: 'fb', onclick: () => sh.close() }, t('common.cancel')), save].filter(Boolean),
    focus: sch ? null : name
  });
  save.addEventListener('click', () => {
    const nm = name.value.trim();
    if (!nm) { err.textContent = t('subs.err_name'); return; }
    const ccy = acctCcy(acct.value);
    const v = U.parseAmount(amount.value, ccy);
    if (!v) { err.textContent = t('entry.err_amount'); return; }
    if (!isISODate(anchor.value)) { err.textContent = t('entry.err_date'); return; }
    let rule;
    if (freq.value === 'custom') rule = { freq: unit.value, interval: Math.max(1, Math.min(99, parseInt(every.value, 10) || 1)) };
    else rule = Object.assign({}, FREQS.find(([k]) => k === freq.value)[1]);
    rule.weekend_shift = shift.value;
    const signed = kind.value === 'income' ? Math.abs(v) : -Math.abs(v);
    const end = endMode.value === 'count' ? { mode: 'count', n: Math.max(1, parseInt(endN.value, 10) || 1) } : endMode.value === 'date' && isISODate(endDate.value) ? { mode: 'date', date: endDate.value } : { mode: 'never' };
    const fields = {
      name: nm.slice(0, 60), kind: kind.value, amount_minor: signed, currency: ccy, account: acct.value, category: catSel.value || null,
      payee: s.payee || nm.slice(0, 60), rule, end, auto_post: auto.querySelector('input').checked,
      notify_days: Math.max(-1, Math.min(30, parseInt(remind.value, 10))), trial_end: isISODate(trial.value) ? trial.value : null,
      cancel_url: /^https?:\/\//.test(cancelUrl.value.trim()) ? cancelUrl.value.trim().slice(0, 300) : null, cancel_notes: notes.value.trim().slice(0, 500) || null,
      active: sch ? active.querySelector('input').checked : true
    };
    if (sch) {
      const curNext = L.scheduleNext(sch, addDays(L.today(), -1));
      if (anchor.value !== curNext || JSON.stringify(rule) !== JSON.stringify(sch.rule)) fields.anchor = anchor.value;
      if (sch.amount_minor !== signed) fields.price_history = (sch.price_history || []).concat([{ date: L.today(), old_minor: sch.amount_minor, new_minor: signed }]).slice(-24);
    } else {
      fields.anchor = anchor.value;
      fields.created = new Date().toISOString();
      if (preset && preset.stream_id) fields.stream_id = preset.stream_id;
    }
    sh.close();
    ctx.commit(ctx.save('schedule', sch ? sch.id : ctx.newId(), fields), sch ? t('subs.saved') : t('subs.added'));
  });
}

function record(ctx, u) {
  const sc = u.schedule;
  const account = ctx.ledger.scheduleOrphaned(sc) ? null : sc.account;
  ctx.openEntry({ fixedId: 'sch:' + sc.id + ':' + u.date, scheduleId: sc.id, amountMinor: sc.amount_minor, payee: sc.payee || sc.name, category: sc.category, account, date: u.date });
}

function summary(ctx) {
  const L = ctx.ledger;
  const base = L.base();
  let out = 0;
  let inc = 0;
  let n = 0;
  for (const s of L.schedules()) {
    if (L.scheduleEnded(s)) continue;
    const m = L.toBase(Math.round(monthly(s)), s.currency || base);
    if (m == null) continue;
    if ((s.amount_minor || 0) < 0) { out += m; n++; } else inc += m;
  }
  return h('div', { class: 'fcard', style: { marginBottom: '14px' } },
    h('div', { class: 'fstats fstats--4' },
      h('div', { class: 'fstat' }, h('span', { class: 'fstat__label' }, t('subs.per_month')), h('span', { class: 'fmid' }, U.money(out, base))),
      h('div', { class: 'fstat' }, h('span', { class: 'fstat__label' }, t('subs.per_year')), h('span', { class: 'fmid' }, U.money(out * 12, base))),
      h('div', { class: 'fstat' }, h('span', { class: 'fstat__label' }, t('subs.count')), h('span', { class: 'fmid' }, U.fmtInt(n))),
      h('div', { class: 'fstat' }, h('span', { class: 'fstat__label' }, t('subs.income_month')), h('span', { class: 'fmid amt--in' }, U.money(inc, base)))));
}

function upcomingTab(ctx) {
  const L = ctx.ledger;
  const list = L.upcoming(60, addDays(L.today(), -7));
  const node = h('div');
  if (!list.length) { node.append(U.empty(t('subs.none_upcoming'), h('button', { type: 'button', class: 'fb fb--sm', onclick: () => scheduleSheet(ctx, null) }, icon('plus'), t('subs.add')))); return node; }
  let day = null;
  for (const u of list) {
    if (u.date !== day) {
      day = u.date;
      const rel = u.days < 0 ? t('subs.overdue') : u.days === 0 ? t('home.today') : u.days === 1 ? t('home.tomorrow') : t('subs.in_days', { n: u.days });
      node.append(h('div', { class: 'fday' }, h('b', null, U.date(u.date, 'weekday')), h('span', null, rel)));
    }
    const sc = u.schedule;
    const c = sc.category ? L.categoryMap().get(sc.category) : null;
    const trialSoon = sc.trial_end && diffDays(L.today(), sc.trial_end) >= 0 && diffDays(L.today(), sc.trial_end) <= 7;
    const orphan = L.scheduleOrphaned(sc);
    const auto = sc.auto_post && !orphan;
    node.append(h('div', { class: 'frow frow--static' },
      c ? U.mono(c.icon || sc.name, c.color) : U.mono(sc.name, U.colorFor(sc.id)),
      h('span', { class: 'frow__main' }, h('span', { class: 'frow__title' }, sc.name), h('span', { class: 'frow__meta' }, cycleText(sc.rule) + (auto && u.days >= 0 ? ' · ' + t('subs.auto') : '') + (orphan ? ' · ' + t('subs.no_account_meta') : '') + (trialSoon ? ' · ' + t('subs.trial_ends', { date: U.date(sc.trial_end, 'dayMonth') }) : ''))),
      h('span', { class: 'fb-row', style: { flexWrap: 'nowrap' } },
        h('span', { class: 'frow__amt ' + (u.amount > 0 ? 'amt--in' : '') }, U.money(Math.abs(u.amount), u.currency)),
        !auto || u.days < 0 ? h('button', { type: 'button', class: 'fb fb--sm', onclick: () => record(ctx, u) }, t('subs.record')) : null)));
  }
  return node;
}

function allTab(ctx) {
  const L = ctx.ledger;
  const vs = ctx.viewState;
  const node = h('div');
  const all = L.schedules(true);
  const list = all.filter((s) => vs.showInactive || s.active !== false).map((s) => ({ s, next: L.scheduleNext(s) })).sort((a, b) => (a.next || '9') < (b.next || '9') ? -1 : 1);
  node.append(h('div', { class: 'ftool', style: { justifyContent: 'space-between' } },
    h('button', { type: 'button', class: 'fb fb--primary', onclick: () => scheduleSheet(ctx, null) }, icon('plus'), t('subs.add')),
    all.some((s) => s.active === false) ? U.checkbox(t('subs.show_stopped'), !!vs.showInactive, (v) => { vs.showInactive = v; ctx.rerender(); }) : null));
  if (!list.length) { node.append(U.empty(t('subs.empty'))); return node; }
  const grid = h('div', { class: 'fgrid fgrid--3' });
  for (const { s, next } of list) {
    const c = s.category ? L.categoryMap().get(s.category) : null;
    const ccy = s.currency || L.base();
    const pm = Math.round(monthly(s));
    const trial = s.trial_end && s.trial_end >= L.today();
    const last = (s.price_history || []).slice(-1)[0];
    const cost = !next ? '' : (s.rule && s.rule.freq === 'month' && (s.rule.interval || 1) === 1) ? t('subs.per_year_short', { amount: U.money(Math.abs(s.amount_minor || 0) * 12, ccy) }) : t('subs.per_month_short', { amount: U.money(pm, ccy) });
    const changed = last ? t('subs.changed', { from: U.money(Math.abs(last.old_minor), ccy), date: U.date(last.date, 'dayMonth') }) : '';
    const foot = [cost, changed].filter(Boolean).join(' · ');
    grid.append(h('button', { type: 'button', class: 'fcard', style: { textAlign: 'left', cursor: 'pointer', color: 'inherit', display: 'flex', flexDirection: 'column', gap: '10px' }, onclick: () => scheduleSheet(ctx, s) },
      h('div', { style: { display: 'flex', gap: '12px', alignItems: 'center' } }, c ? U.mono(c.icon || s.name, c.color) : U.mono(s.name, U.colorFor(s.id)),
        h('div', { style: { minWidth: 0, flex: 1 } }, h('div', { class: 'frow__title', style: { fontWeight: 600 } }, s.name), h('div', { class: 'frow__meta' }, t('subs.kind.' + (s.kind || 'subscription')) + ' · ' + cycleText(s.rule))),
        s.active === false ? h('span', { class: 'fpill' }, t('subs.stopped')) : L.scheduleOrphaned(s) ? h('span', { class: 'fpill fpill--amber' }, t('subs.no_account')) : trial ? h('span', { class: 'fpill fpill--amber' }, t('subs.trial_short')) : null),
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px' } },
        h('span', { class: 'fmid ' + (s.amount_minor > 0 ? 'amt--in' : '') }, U.money(Math.abs(s.amount_minor || 0), ccy)),
        h('span', { class: 'fsmall fmuted' }, next ? t('subs.next_on', { date: U.date(next, 'dayMonth') }) : t('subs.ended'))),
      foot ? h('div', { class: 'fsmall fmuted' }, foot) : null));
  }
  node.append(grid);
  return node;
}

function foundTab(ctx) {
  const L = ctx.ledger;
  const known = new Set(L.schedules(true).map((s) => payeeKey(s.payee || s.name)));
  const dismissed = new Set(L.list('stream').filter((x) => x.state === 'dismissed').map((x) => x.id));
  const streams = detectStreams(L.rows().slice(0, 20000), { today: L.today(), known, dismissed });
  const node = h('div');
  node.append(h('p', { class: 'fmuted fsmall', style: { marginBottom: '12px', maxWidth: '62ch' } }, t('subs.found_body')));
  if (!streams.length) { node.append(U.empty(t('subs.found_none'))); return node; }
  for (const st of streams) {
    const ccy = st.currency || L.base();
    node.append(h('div', { class: 'frow frow--static' },
      U.mono(st.payee, U.colorFor(st.key)),
      h('span', { class: 'frow__main' }, h('span', { class: 'frow__title' }, st.payee),
        h('span', { class: 'frow__meta' }, t('subs.found_meta', { cycle: t('subs.cycle.' + (st.cadence === 'half' ? 'half' : st.cadence)), n: st.count, date: U.date(st.last, 'dayMonth') }) + (st.variable ? ' · ' + t('subs.varies') : '') + (st.state === 'stale' ? ' · ' + t('subs.maybe_ended') : ''))),
      h('span', { class: 'fb-row', style: { flexWrap: 'nowrap' } },
        h('span', { class: 'frow__amt ' + (st.dir === 'in' ? 'amt--in' : '') }, (st.variable ? '≈ ' : '') + U.money(st.amount, ccy)),
        h('button', { type: 'button', class: 'fb fb--sm fb--primary', onclick: () => scheduleSheet(ctx, null, {
          name: st.payee, payee: st.payee, kind: st.dir === 'in' ? 'income' : 'subscription', amount_minor: st.dir === 'in' ? st.amount : -st.amount,
          account: st.account, category: st.category, rule: Object.assign({}, st.rule), anchor: nextDue(st, L.today()), auto_post: !st.variable, stream_id: st.id
        }) }, t('subs.track')),
        h('button', { type: 'button', class: 'fb fb--sm fb--ghost', 'aria-label': t('common.dismiss'), onclick: () => ctx.commit(ctx.save('stream', st.id, { state: 'dismissed', payee_key: st.key }), t('subs.dismissed')) }, icon('close')))));
  }
  return node;
}

export function render(ctx) {
  const vs = ctx.viewState;
  if (!vs.tab) vs.tab = 'upcoming';
  const node = h('div');
  node.append(summary(ctx));
  const tabs = h('div', { class: 'ftabs', role: 'tablist' });
  for (const [k, label] of [['upcoming', t('subs.tab_upcoming')], ['all', t('subs.tab_all')], ['found', t('subs.tab_found')]]) {
    tabs.append(h('button', { type: 'button', role: 'tab', class: vs.tab === k ? 'is-on' : '', 'aria-selected': vs.tab === k ? 'true' : 'false', onclick: () => { vs.tab = k; ctx.rerender(); } }, label));
  }
  node.append(tabs, vs.tab === 'all' ? allTab(ctx) : vs.tab === 'found' ? foundTab(ctx) : upcomingTab(ctx));
  return {
    title: t('nav.subs'),
    node,
    after: () => { if (ctx.params.add === '1' && !vs.addOpened) { vs.addOpened = true; scheduleSheet(ctx, null); } }
  };
}
