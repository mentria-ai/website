import * as U from './ui.js';
import { payeeKey } from './ledger.js';
import * as R from './rules.js';

const { h, t } = U;

export function uncategorizedGroups(L) {
  const groups = new Map();
  for (const r of L.rows()) {
    if (r.kind !== 'txn' || r.category || r.lines || r.tkind === 'invest' || r.tkind === 'adjustment') continue;
    const key = payeeKey(r.payee || r.note) || '_';
    const g = groups.get(key) || { key, name: r.payee || r.note || t('ledger.untitled'), ids: [], total: 0, sign: 0 };
    g.ids.push(r.id);
    g.total += r.base == null ? 0 : r.base;
    g.sign += Math.sign(r.amount);
    groups.set(key, g);
  }
  return Array.from(groups.values()).sort((a, b) => b.ids.length - a.ids.length || Math.abs(b.total) - Math.abs(a.total));
}

export function uncategorizedCount(L) {
  let n = 0;
  for (const r of L.rows()) if (r.kind === 'txn' && !r.category && !r.lines && r.tkind !== 'invest' && r.tkind !== 'adjustment') n++;
  return n;
}

export function openCategorize(ctx) {
  const L = ctx.ledger;
  const groups = uncategorizedGroups(L).slice(0, 60);
  const picks = new Map();
  const list = h('div');
  for (const g of groups) {
    const kind = g.sign >= 0 && g.total >= 0 ? 'income' : 'expense';
    const suggested = L.suggestCategory(g.name) || R.apply(L.list('rule'), { payee: g.name, note: '', amount_minor: g.total, category: null }).txn.category;
    const sel = U.select([{ value: '', label: t('categorize.skip') }].concat(L.leafCategories(kind).map((c) => ({ value: c.id, label: c.name }))), suggested || '', { 'aria-label': t('entry.category'), style: { minHeight: '38px' }, onchange: (e) => { if (e.target.value) picks.set(g.key, e.target.value); else picks.delete(g.key); } });
    if (suggested) picks.set(g.key, suggested);
    list.append(h('div', { class: 'frow frow--static', style: { gridTemplateColumns: 'minmax(0,1fr) minmax(130px, 200px)' } },
      h('span', { class: 'frow__main' }, h('span', { class: 'frow__title' }, g.name), h('span', { class: 'frow__meta' }, U.tp('categorize.count', g.ids.length) + ' · ' + U.money(Math.abs(g.total), L.base()))),
      sel));
  }
  const remember = U.checkbox(t('categorize.remember'), true, () => {});
  const apply = h('button', { type: 'button', class: 'fb fb--primary' }, t('categorize.apply'));
  const sh = U.sheet({
    title: t('categorize.title'), wide: true,
    body: groups.length ? h('div', { class: 'fstack' }, h('p', { class: 'fmuted fsmall' }, t('categorize.body')), list, remember) : U.empty(t('categorize.done_all')),
    foot: [h('button', { type: 'button', class: 'fb', onclick: () => sh.close() }, t('common.close')), groups.length ? apply : null].filter(Boolean)
  });
  apply.addEventListener('click', () => {
    const ops = [];
    let n = 0;
    const learn = remember.querySelector('input').checked;
    for (const g of groups) {
      const cat = picks.get(g.key);
      if (!cat) continue;
      for (const id of g.ids) { ops.push(...ctx.engine.updateOps('transaction', id, { category: cat })); n++; }
      if (learn && g.key !== '_') ops.push(...ctx.save('payee', g.key, { name: g.name, default_category: cat }));
    }
    sh.close();
    if (ops.length) ctx.commit(ops, U.tp('categorize.applied', n));
  });
}

export function offerSimilar(ctx, txnId, category) {
  const L = ctx.ledger;
  const tx = L.get('transaction', txnId);
  if (!tx || !category) return;
  const key = payeeKey(tx.payee || tx.note);
  if (!key) return;
  const ids = [];
  for (const r of L.rows()) {
    if (r.kind !== 'txn' || r.id === txnId || r.category || r.lines || r.tkind === 'invest' || r.tkind === 'adjustment') continue;
    if (payeeKey(r.payee || r.note) === key) ids.push(r.id);
  }
  if (!ids.length) return;
  U.toast(U.tp('categorize.similar', ids.length), { ms: 9000, action: { label: t('categorize.apply_all'), run: () => {
    const ops = [];
    for (const id of ids) ops.push(...ctx.engine.updateOps('transaction', id, { category }));
    ctx.commit(ops, U.tp('categorize.applied', ids.length));
  } } });
}
