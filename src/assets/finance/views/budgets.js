import * as U from '../ui.js';
import { monthKey, addMonthKey, parts, daysInMonth } from '../dates.js';
import { INCOME_SOURCES } from '../ledger.js';
import * as R from '../rules.js';

const { h, t, icon } = U;

function budgetSheet(ctx, cat, key) {
  const L = ctx.ledger;
  const base = L.base();
  const monthRec = L.get('budget', cat.id + ':' + key);
  const cur = L.budgetFor(cat.id, key);
  const amount = U.moneyField({ value: cur != null ? U.amountToInput(cur, base) : '', placeholder: '0' });
  let scope = monthRec ? 'month' : 'default';
  const scopeSeg = U.seg([{ value: 'default', label: t('budgets.every_month') }, { value: 'month', label: t('budgets.only_month', { month: U.month(key) }) }], scope, (v) => { scope = v; }, true);
  const roll = U.checkbox(t('budgets.rollover'), !!cat.rollover, () => {});
  const spent = L.monthSummary(key).byCat.get(cat.id) || 0;
  const avg = L.categorySeries([cat.id], 6, addMonthKey(key, -1)).filter((v) => v > 0);
  const avgVal = avg.length ? Math.round(avg.reduce((a, b) => a + b, 0) / avg.length) : 0;
  const err = h('p', { class: 'ff__err', role: 'alert' });
  const save = h('button', { type: 'button', class: 'fb fb--primary' }, t('common.save'));
  const clear = h('button', { type: 'button', class: 'fb', onclick: () => {
    const ops = [];
    if (monthRec) ops.push(...ctx.remove('budget', monthRec.id));
    if (cat.budget_default_minor != null) ops.push(...ctx.engine.updateOps('category', cat.id, { budget_default_minor: null }));
    sh.close();
    ctx.commit(ops, t('budgets.cleared'));
  } }, t('budgets.clear'));
  const sh = U.sheet({
    title: t('budgets.edit', { name: cat.name }),
    body: h('div', { class: 'fstack' },
      h('p', { class: 'fmuted fsmall' }, t('budgets.spent_so_far', { amount: U.money(spent, base) }) + (avgVal ? ' · ' + t('budgets.avg', { amount: U.money(avgVal, base) }) : '')),
      U.field(t('budgets.amount'), amount),
      avgVal ? h('div', { class: 'fchips' }, h('button', { type: 'button', class: 'fchip', onclick: () => { amount.value = U.amountToInput(avgVal, base); } }, t('budgets.use_avg', { amount: U.money(avgVal, base, { compact: true }) }))) : null,
      scopeSeg, roll, h('p', { class: 'ff__hint' }, t('budgets.rollover_hint')), err),
    foot: [clear, save], focus: amount
  });
  save.addEventListener('click', () => {
    const v = amount.value.trim() ? U.parseAmount(amount.value, base) : null;
    if (amount.value.trim() && v == null) { err.textContent = t('entry.err_amount'); return; }
    const ops = [];
    const val = v == null ? null : Math.abs(v);
    if (scope === 'month') ops.push(...ctx.save('budget', cat.id + ':' + key, { category: cat.id, month: key, amount_minor: val }));
    else {
      ops.push(...ctx.engine.updateOps('category', cat.id, { budget_default_minor: val }));
      if (monthRec) ops.push(...ctx.remove('budget', monthRec.id));
    }
    ops.push(...ctx.engine.updateOps('category', cat.id, { rollover: roll.querySelector('input').checked }));
    sh.close();
    ctx.commit(ops, t('budgets.saved'));
  });
}

function budgetsTab(ctx, vs) {
  const L = ctx.ledger;
  const base = L.base();
  const key = vs.month;
  const bs = L.budgetSummary(key);
  const node = h('div');
  const isCurrent = key === monthKey(L.today());
  const p = parts(L.today());
  const marker = isCurrent ? p.d / daysInMonth(p.y, p.m) : key < monthKey(L.today()) ? 1 : 0;
  const left = bs.total - bs.spent;
  node.append(h('div', { class: 'fcard', style: { marginBottom: '14px' } },
    h('div', { class: 'fstats fstats--4' },
      h('div', { class: 'fstat' }, h('span', { class: 'fstat__label' }, t('budgets.budgeted')), h('span', { class: 'fmid' }, U.money(bs.total, base))),
      h('div', { class: 'fstat' }, h('span', { class: 'fstat__label' }, t('budgets.spent')), h('span', { class: 'fmid' }, U.money(bs.spent, base))),
      h('div', { class: 'fstat' }, h('span', { class: 'fstat__label' }, left >= 0 ? t('budgets.left_label') : t('budgets.over_label')), h('span', { class: 'fmid ' + (left >= 0 ? 'amt--in' : 'amt--over') }, U.money(Math.abs(left), base))),
      h('div', { class: 'fstat' }, h('span', { class: 'fstat__label' }, t('budgets.unbudgeted')), h('span', { class: 'fmid' }, U.money(Math.max(0, bs.expense - bs.spent), base)))),
    bs.total ? h('div', { style: { marginTop: '12px' } }, U.bar(bs.spent, bs.total, { marker })) : null));
  const prevKey = addMonthKey(key, -1);
  const hasPrev = L.categories().some((c) => L.get('budget', c.id + ':' + prevKey));
  node.append(h('div', { class: 'ftool' },
    h('p', { class: 'fmuted fsmall', style: { flex: '1 1 260px' } }, t('budgets.hint')),
    hasPrev ? h('button', { type: 'button', class: 'fb fb--sm', onclick: () => {
      const ops = [];
      for (const c of L.categories()) {
        const prev = L.get('budget', c.id + ':' + prevKey);
        if (prev && prev.amount_minor != null && !L.get('budget', c.id + ':' + key)) ops.push(...ctx.save('budget', c.id + ':' + key, { category: c.id, month: key, amount_minor: prev.amount_minor }));
      }
      ctx.commit(ops, U.tp('budgets.copied', ops.length));
    } }, t('budgets.copy_prev')) : null));
  for (const it of bs.items) {
    const g = it.group;
    if (g.hidden) continue;
    const box = h('div', { class: 'fcard', style: { marginBottom: '10px', padding: '12px 14px' } });
    const head = h('button', { type: 'button', class: 'frow', style: { borderBottom: it.kids.length ? '1px solid var(--f-line)' : '0' }, onclick: () => budgetSheet(ctx, g, key) },
      U.mono(g.icon || g.name, g.color),
      h('span', { class: 'frow__main' }, h('span', { class: 'frow__title', style: { fontWeight: 600 } }, g.name), h('span', { class: 'frow__meta' }, it.budget != null ? t('budgets.of', { spent: U.money(it.spent, base), budget: U.money(it.budget, base) }) : t('budgets.no_limit_spent', { spent: U.money(it.spent, base) }))),
      h('span', { class: 'frow__amt ' + (it.budget != null && it.spent > it.budget ? 'amt--over' : '') }, it.budget != null ? U.money(it.budget - it.spent, base, { compact: true }) : '', it.budget != null ? h('small', null, it.budget - it.spent >= 0 ? t('budgets.left') : t('budgets.over')) : null));
    box.append(head);
    if (it.budget != null) box.append(h('div', { style: { padding: '4px 4px 8px' } }, U.bar(it.spent, it.budget, { marker, color: g.color })));
    for (const k of it.kids) {
      if (k.cat.hidden) continue;
      box.append(h('button', { type: 'button', class: 'frow', style: { gridTemplateColumns: '30px minmax(0,1fr) auto', paddingLeft: '18px' }, onclick: () => budgetSheet(ctx, k.cat, key) },
        U.mono(k.cat.icon || k.cat.name, k.cat.color || g.color, true),
        h('span', { class: 'frow__main' }, h('span', { class: 'frow__title' }, k.cat.name), k.budget != null ? h('span', { style: { display: 'block', marginTop: '6px' } }, U.bar(k.spent, k.budget, { marker, color: k.cat.color || g.color })) : null),
        h('span', { class: 'frow__amt' }, U.money(k.spent, base), k.budget != null ? h('small', null, t('budgets.of_short', { budget: U.money(k.budget, base, { compact: true }) })) : null)));
    }
    node.append(box);
  }
  if (bs.uncategorized) node.append(h('p', { class: 'fmuted fsmall' }, t('budgets.uncategorized', { amount: U.money(bs.uncategorized, base) })));
  return node;
}

export function categorySheet(ctx, cat, opts) {
  const o = opts || {};
  const L = ctx.ledger;
  const kind0 = cat ? cat.kind : o.kind || 'expense';
  const name = U.input({ value: cat ? cat.name : '', maxlength: '40' });
  const kind = U.select([{ value: 'expense', label: t('budgets.kind_expense') }, { value: 'income', label: t('budgets.kind_income') }], kind0);
  const groups = L.categories().filter((c) => !c.group && (!cat || c.id !== cat.id));
  const hasKids = cat ? L.categories().some((c) => c.group === cat.id) : false;
  const groupSel = U.select([{ value: '', label: t('budgets.top_level') }].concat(groups.filter((g) => g.kind === kind0).map((g) => ({ value: g.id, label: g.name }))), cat ? cat.group || '' : o.group || '', { disabled: hasKids });
  const iconIn = U.input({ value: cat && cat.icon ? cat.icon : '', maxlength: '4', placeholder: U.monogram(cat ? cat.name : 'Ab') });
  let color = cat && cat.color ? cat.color : U.PALETTE[(L.categories().length) % U.PALETTE.length];
  const sw = h('div', { class: 'fchips' });
  const drawSw = () => {
    sw.replaceChildren(...U.PALETTE.map((c) => h('button', { type: 'button', class: 'fchip' + (c === color ? ' is-on' : ''), 'aria-label': c, style: { width: '34px', padding: 0, justifyContent: 'center' }, onclick: () => { color = c; drawSw(); } }, h('i', { style: { width: '14px', height: '14px', borderRadius: '4px', background: c } }))));
  };
  drawSw();
  const src = U.select([{ value: '', label: t('budgets.no_source') }].concat(INCOME_SOURCES.map((x) => ({ value: x, label: t('taxes.source.' + x) }))), cat && cat.income_source ? cat.income_source : '');
  const srcField = U.field(t('budgets.income_source'), src, t('budgets.income_source_hint'));
  const syncKind = () => { srcField.hidden = kind.value !== 'income'; };
  kind.addEventListener('change', syncKind);
  syncKind();
  const hidden = U.checkbox(t('budgets.hide'), !!(cat && cat.hidden), () => {});
  const err = h('p', { class: 'ff__err', role: 'alert' });
  const save = h('button', { type: 'button', class: 'fb fb--primary' }, t('common.save'));
  const del = cat ? h('button', { type: 'button', class: 'fb fb--danger fb--icon', 'aria-label': t('common.delete'), onclick: async () => {
    const used = L.rows().some((r) => r.category === cat.id || (r.lines && r.lines.some((x) => x.category === cat.id)));
    if (used || hasKids) { err.textContent = hasKids ? t('budgets.err_has_kids') : t('budgets.err_used'); return; }
    sh.close();
    ctx.commit(ctx.remove('category', cat.id), t('budgets.cat_deleted'));
  } }, icon('trash')) : null;
  const sh = U.sheet({
    title: cat ? t('budgets.edit_cat') : t('budgets.add_cat'),
    body: h('div', { class: 'fstack' }, U.field(t('budgets.cat_name'), name), h('div', { class: 'ff-grid' }, U.field(t('budgets.kind'), kind), U.field(t('budgets.group'), groupSel)), h('div', { class: 'ff-grid' }, U.field(t('budgets.icon'), iconIn, t('budgets.icon_hint')), h('div', { class: 'ff' }, h('span', { class: 'ff__label' }, t('budgets.color')), sw)), srcField, cat ? hidden : null, err),
    foot: [del, h('button', { type: 'button', class: 'fb', onclick: () => sh.close() }, t('common.cancel')), save].filter(Boolean), focus: cat ? null : name
  });
  save.addEventListener('click', () => {
    const nm = name.value.trim();
    if (!nm) { err.textContent = t('budgets.err_name'); return; }
    const fields = { name: nm.slice(0, 40), kind: kind.value, group: groupSel.value || null, icon: iconIn.value.trim().slice(0, 4) || null, color, income_source: kind.value === 'income' ? src.value || null : null, hidden: cat ? hidden.querySelector('input').checked : false };
    if (!cat) { fields.order = L.categories().length + 1; fields.rollover = false; }
    sh.close();
    ctx.commit(ctx.save('category', cat ? cat.id : ctx.newId(), fields), cat ? t('budgets.cat_saved') : t('budgets.cat_added'));
  });
}

function move(ctx, list, idx, dir) {
  const j = idx + dir;
  if (j < 0 || j >= list.length) return;
  const a = list[idx];
  const b = list[j];
  const ops = [].concat(ctx.engine.updateOps('category', a.id, { order: b.order || j }), ctx.engine.updateOps('category', b.id, { order: a.order || idx }));
  if ((a.order || 0) === (b.order || 0)) ops.push(...ctx.engine.updateOps('category', a.id, { order: (b.order || 0) + dir }));
  ctx.commit(ops);
}

function categoriesTab(ctx) {
  const L = ctx.ledger;
  const node = h('div');
  for (const kind of ['expense', 'income']) {
    node.append(h('div', { class: 'fsection' }, h('h2', null, t('budgets.kind_' + kind + '_plural')), h('button', { type: 'button', class: 'fb fb--sm', onclick: () => categorySheet(ctx, null, { kind }) }, icon('plus'), t('budgets.add_cat'))));
    const tree = L.categoryTree(kind);
    const box = h('div', { class: 'fcard', style: { padding: '6px 14px' } });
    tree.forEach(({ group, children }, gi) => {
      box.append(catRow(ctx, group, false, () => move(ctx, tree.map((x) => x.group), gi, -1), () => move(ctx, tree.map((x) => x.group), gi, 1)));
      children.forEach((c, ci) => box.append(catRow(ctx, c, true, () => move(ctx, children, ci, -1), () => move(ctx, children, ci, 1))));
    });
    node.append(box);
  }
  return node;
}

function catRow(ctx, c, child, up, down) {
  return h('div', { class: 'frow frow--static', style: { gridTemplateColumns: (child ? '30px' : '38px') + ' minmax(0,1fr) auto', paddingLeft: child ? '22px' : '4px' } },
    U.mono(c.icon || c.name, c.color, child),
    h('span', { class: 'frow__main' }, h('span', { class: 'frow__title', style: { opacity: c.hidden ? 0.5 : 1 } }, c.name), c.hidden ? h('span', { class: 'frow__meta' }, t('budgets.hidden')) : c.income_source ? h('span', { class: 'frow__meta' }, t('taxes.source.' + c.income_source)) : null),
    h('span', { class: 'fb-row', style: { flexWrap: 'nowrap', gap: '2px' } },
      h('button', { type: 'button', class: 'fb fb--ghost fb--icon fb--sm', 'aria-label': t('budgets.move_up'), onclick: up }, h('span', { style: { transform: 'rotate(90deg)', display: 'inline-flex' } }, icon('back'))),
      h('button', { type: 'button', class: 'fb fb--ghost fb--icon fb--sm', 'aria-label': t('budgets.move_down'), onclick: down }, h('span', { style: { transform: 'rotate(90deg)', display: 'inline-flex' } }, icon('next'))),
      h('button', { type: 'button', class: 'fb fb--ghost fb--icon fb--sm', 'aria-label': t('common.edit'), onclick: () => categorySheet(ctx, c) }, icon('edit'))));
}

export function ruleSheet(ctx, rule, preset) {
  const L = ctx.ledger;
  const r = rule || Object.assign({ conditions: [{ field: 'payee', op: 'contains', value: '' }], conditions_op: 'all', actions: [{ type: 'category', value: '' }], enabled: true, stop: false }, preset || {});
  const st = { conditions: JSON.parse(JSON.stringify(r.conditions || [])), actions: JSON.parse(JSON.stringify(r.actions || [])), op: r.conditions_op || 'all' };
  const condBox = h('div', { class: 'fstack' });
  const actBox = h('div', { class: 'fstack' });
  const catOpts = [{ value: '', label: t('entry.no_category') }].concat(L.leafCategories().map((c) => ({ value: c.id, label: c.name })));
  const drawConds = () => {
    condBox.replaceChildren();
    st.conditions.forEach((c, i) => {
      const field = U.select(R.FIELDS.filter((f) => f !== 'account').map((f) => ({ value: f, label: t('rules.field.' + f) })), c.field, { onchange: (e) => { c.field = e.target.value; c.op = c.field === 'amount' ? 'gt' : 'contains'; drawConds(); } });
      const ops = c.field === 'amount' ? ['gt', 'lt', 'is', 'approx'] : ['contains', 'is', 'starts', 'oneOf', 'matches'];
      const op = U.select(ops.map((x) => ({ value: x, label: t('rules.op.' + x) })), c.op, { onchange: (e) => { c.op = e.target.value; } });
      const val = c.field === 'amount'
        ? U.moneyField({ value: c.value ? U.amountToInput(c.value, L.base()) : '', oninput: (e) => { const m = U.parseAmount(e.target.value, L.base()); c.value = m == null ? 0 : Math.abs(m); } })
        : U.input({ value: c.value || '', oninput: (e) => { c.value = e.target.value; } });
      condBox.append(h('div', { class: 'fsplit', style: { gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr) minmax(0,1.4fr) 36px' } }, field, op, val,
        h('button', { type: 'button', class: 'fb fb--ghost fb--icon', 'aria-label': t('common.remove'), onclick: () => { st.conditions.splice(i, 1); if (!st.conditions.length) st.conditions.push({ field: 'payee', op: 'contains', value: '' }); drawConds(); } }, icon('close'))));
    });
  };
  const drawActs = () => {
    actBox.replaceChildren();
    st.actions.forEach((a, i) => {
      const type = U.select(R.ACTIONS.map((x) => ({ value: x, label: t('rules.action.' + x) })), a.type, { onchange: (e) => { a.type = e.target.value; a.value = ''; drawActs(); } });
      const val = a.type === 'category' ? U.select(catOpts, a.value || '', { onchange: (e) => { a.value = e.target.value; } }) : U.input({ value: a.value || '', oninput: (e) => { a.value = e.target.value; } });
      actBox.append(h('div', { class: 'fsplit' }, type, val, h('button', { type: 'button', class: 'fb fb--ghost fb--icon', 'aria-label': t('common.remove'), onclick: () => { st.actions.splice(i, 1); if (!st.actions.length) st.actions.push({ type: 'category', value: '' }); drawActs(); } }, icon('close'))));
    });
  };
  drawConds();
  drawActs();
  const anyAll = U.seg([{ value: 'all', label: t('rules.all') }, { value: 'any', label: t('rules.any') }], st.op, (v) => { st.op = v; });
  const stop = U.checkbox(t('rules.stop'), !!r.stop, () => {});
  const enabled = U.checkbox(t('rules.enabled'), r.enabled !== false, () => {});
  const err = h('p', { class: 'ff__err', role: 'alert' });
  const save = h('button', { type: 'button', class: 'fb fb--primary' }, t('common.save'));
  const del = rule ? h('button', { type: 'button', class: 'fb fb--danger fb--icon', 'aria-label': t('common.delete'), onclick: () => { sh.close(); ctx.commit(ctx.remove('rule', rule.id), t('rules.deleted')); } }, icon('trash')) : null;
  const sh = U.sheet({
    title: rule ? t('rules.edit') : t('rules.add'), wide: true,
    body: h('div', { class: 'fstack' },
      h('div', { class: 'fb-row', style: { justifyContent: 'space-between' } }, h('span', { class: 'ff__label' }, t('rules.when')), anyAll), condBox,
      h('button', { type: 'button', class: 'fb fb--sm', style: { alignSelf: 'flex-start' }, onclick: () => { st.conditions.push({ field: 'payee', op: 'contains', value: '' }); drawConds(); } }, icon('plus'), t('rules.add_cond')),
      h('span', { class: 'ff__label' }, t('rules.then')), actBox,
      h('button', { type: 'button', class: 'fb fb--sm', style: { alignSelf: 'flex-start' }, onclick: () => { st.actions.push({ type: 'tag', value: '' }); drawActs(); } }, icon('plus'), t('rules.add_action')),
      enabled, stop, err),
    foot: [del, h('button', { type: 'button', class: 'fb', onclick: () => sh.close() }, t('common.cancel')), save].filter(Boolean)
  });
  save.addEventListener('click', () => {
    const conditions = st.conditions.filter((c) => c.field === 'amount' ? c.value > 0 : String(c.value || '').trim());
    const actions = st.actions.filter((a) => String(a.value || '').trim());
    if (!conditions.length || !actions.length) { err.textContent = t('rules.err_empty'); return; }
    const fields = { conditions, actions, conditions_op: st.op, stop: stop.querySelector('input').checked, enabled: enabled.querySelector('input').checked, stage: 'default' };
    if (!rule) fields.order = L.list('rule').length + 1;
    sh.close();
    ctx.commit(ctx.save('rule', rule ? rule.id : ctx.newId(), fields), t('rules.saved'));
  });
}

function rulesTab(ctx) {
  const L = ctx.ledger;
  const node = h('div');
  node.append(h('div', { class: 'ftool', style: { justifyContent: 'space-between' } }, h('p', { class: 'fmuted fsmall', style: { maxWidth: '60ch' } }, t('rules.body')), h('button', { type: 'button', class: 'fb fb--sm', onclick: () => ruleSheet(ctx, null) }, icon('plus'), t('rules.add'))));
  const rules = L.list('rule').sort((a, b) => (a.order || 0) - (b.order || 0));
  if (!rules.length) { node.append(U.empty(t('rules.empty'))); return node; }
  const cats = L.categoryMap();
  for (const r of rules) {
    const cond = (r.conditions || []).map((c) => t('rules.field.' + c.field) + ' ' + t('rules.op.' + c.op) + ' ' + (c.field === 'amount' ? U.money(c.value, L.base()) : '“' + c.value + '”')).join(r.conditions_op === 'any' ? ' ' + t('rules.or') + ' ' : ' ' + t('rules.and') + ' ');
    const act = (r.actions || []).map((a) => t('rules.action.' + a.type) + ': ' + (a.type === 'category' ? (cats.get(a.value) || {}).name || '—' : a.value)).join(', ');
    node.append(h('button', { type: 'button', class: 'frow', onclick: () => ruleSheet(ctx, r) },
      U.mono('', r.enabled === false ? '#66738a' : '#22d3ee', false, 'filter'),
      h('span', { class: 'frow__main' }, h('span', { class: 'frow__title' }, cond), h('span', { class: 'frow__meta' }, act + (r.enabled === false ? ' · ' + t('rules.off') : ''))),
      h('span', { class: 'frow__amt' }, icon('next'))));
  }
  return node;
}

export function render(ctx) {
  const L = ctx.ledger;
  const vs = ctx.viewState;
  if (!vs.month) vs.month = monthKey(L.today());
  if (!vs.tab) vs.tab = 'budgets';
  const node = h('div');
  const tabs = h('div', { class: 'ftabs', role: 'tablist' });
  for (const [k, label] of [['budgets', t('budgets.tab_budgets')], ['categories', t('budgets.tab_categories')], ['rules', t('budgets.tab_rules')]]) {
    tabs.append(h('button', { type: 'button', role: 'tab', class: vs.tab === k ? 'is-on' : '', 'aria-selected': vs.tab === k ? 'true' : 'false', onclick: () => { vs.tab = k; ctx.rerender(); } }, label));
  }
  node.append(tabs);
  const stepper = vs.tab === 'budgets' ? h('div', { class: 'fmonth' },
    h('button', { type: 'button', class: 'fb fb--ghost fb--icon', 'aria-label': t('common.previous'), onclick: () => { vs.month = addMonthKey(vs.month, -1); ctx.rerender(); } }, icon('back')),
    h('span', { class: 'fmonth__label fsmall' }, U.month(vs.month, true)),
    h('button', { type: 'button', class: 'fb fb--ghost fb--icon', 'aria-label': t('common.next'), onclick: () => { vs.month = addMonthKey(vs.month, 1); ctx.rerender(); } }, icon('next'))) : null;
  node.append(vs.tab === 'categories' ? categoriesTab(ctx) : vs.tab === 'rules' ? rulesTab(ctx) : budgetsTab(ctx, vs));
  return { title: t('nav.budgets'), node, top: stepper };
}
