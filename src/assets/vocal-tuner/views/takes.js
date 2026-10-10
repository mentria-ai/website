import { h, t, icon, confirmSheet, promptSheet, fmtDate, fmtDuration, fmtBytes, takeLabel, host } from '../ui.js';
import * as db from '../db.js';

export function mount(root, ctx) {
  let alive = true;
  let menuEl = null;
  const list = h('ul', { class: 'vt-list', 'aria-label': t('takes.title') });
  const storage = h('p', { class: 'vt-takes__storage', hidden: true });
  const empty = h('div', { class: 'vt-empty', hidden: true }, icon('mic'),
    h('h2', { class: 'vt-empty__title' }, t('takes.empty_title')),
    h('p', { class: 'vt-empty__body' }, t('takes.empty_body')));
  const closeBtn = h('button', { class: 'vt-icon-btn', type: 'button', 'aria-label': t('app.close'), onclick: () => { if (host) host.close(); else history.back(); } }, icon('close'));
  const singBtn = h('button', { class: 'vt-btn vt-btn--primary vt-btn--lg', type: 'button', onclick: () => ctx.go('live') }, icon('mic'), t('takes.sing'));
  root.append(h('section', { class: 'vt-takes' },
    h('header', { class: 'vt-top' }, closeBtn, h('h1', { class: 'vt-top__title' }, t('takes.title'))),
    h('div', { class: 'vt-takes__body' }, h('div', { class: 'vt-takes__actions' }, singBtn), empty, list, storage)));

  function outside(e) {
    if (menuEl && !menuEl.contains(e.target)) closeMenu();
  }

  function closeMenu() {
    if (menuEl) { menuEl.remove(); menuEl = null; }
    document.removeEventListener('pointerdown', outside, true);
  }

  function openMenu(anchor, take) {
    closeMenu();
    const item = (label, fn) => h('button', { class: 'vt-menu__item', type: 'button', role: 'menuitem', onclick: () => { closeMenu(); fn(); } }, label);
    menuEl = h('div', { class: 'vt-menu', role: 'menu', onkeydown: (e) => { if (e.key === 'Escape') { closeMenu(); anchor.focus(); } } },
      item(t('takes.rename'), () => rename(take)),
      item(t('takes.export'), () => ctx.go('take', { takeId: take.id, exportNow: true })),
      item(t('takes.delete'), () => remove(take)));
    anchor.parentElement.append(menuEl);
    menuEl.querySelector('button').focus();
    document.addEventListener('pointerdown', outside, true);
  }

  async function rename(take) {
    const name = await promptSheet(t('takes.rename_label'), take.name, t('takes.save'));
    if (!name || !alive) return;
    take.name = name;
    take.updatedAt = Date.now();
    await db.updateTake(take);
    render();
  }

  async function remove(take) {
    if (!(await confirmSheet(t('takes.delete_confirm', { name: take.name }), t('takes.delete')))) return;
    await db.deleteTake(take.id);
    if (alive) render();
  }

  function row(take) {
    const more = h('button', { class: 'vt-icon-btn vt-item__more', type: 'button', 'aria-haspopup': 'menu', 'aria-label': t('takes.more', { name: take.name }) }, icon('more'));
    more.addEventListener('click', (e) => { e.stopPropagation(); openMenu(more, take); });
    return h('li', { class: 'vt-item' },
      h('button', { class: 'vt-item__open', type: 'button', onclick: () => ctx.go('take', { takeId: take.id }) },
        h('span', { class: 'vt-item__name' }, take.name),
        h('span', { class: 'vt-item__meta' }, fmtDuration(take.duration) + ' · ' + fmtDate(take.createdAt)),
        h('span', { class: 'vt-item__label' }, takeLabel(take.renderedWith || take.settings))),
      more);
  }

  async function render() {
    const takes = await db.listTakes();
    if (!alive) return;
    closeMenu();
    list.textContent = '';
    list.append(...takes.map(row));
    empty.hidden = takes.length > 0;
  }

  async function showStorage() {
    try {
      const est = await navigator.storage.estimate();
      if (alive && est.quota && est.usage / est.quota > 0.8) {
        storage.textContent = t('takes.storage', { used: fmtBytes(est.usage), quota: fmtBytes(est.quota) });
        storage.hidden = false;
      }
    } catch (_) {}
  }

  render();
  showStorage();
  return () => { alive = false; closeMenu(); };
}
