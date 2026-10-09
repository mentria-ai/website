import { h, t, tp, icon, toast, confirmSheet, promptSheet, fmtDate, fmtBytes, objectUrl, host } from '../ui.js';
import * as db from '../db.js';
import { newDoc } from '../pages.js';
import { importFiles } from '../importer.js';

export function mount(root, ctx) {
  let alive = true;
  let menuEl = null;
  const fileInput = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: onFiles });
  const status = h('p', { class: 'sc-lib__status', role: 'status', hidden: true });
  const storage = h('p', { class: 'sc-lib__storage', hidden: true });
  const grid = h('ul', { class: 'sc-lib__grid', 'aria-label': t('library.title') });
  const empty = h('div', { class: 'sc-empty', hidden: true }, icon('doc'),
    h('h2', { class: 'sc-empty__title' }, t('library.empty_title')),
    h('p', { class: 'sc-empty__body' }, t('library.empty_body')));
  const closeBtn = h('button', { class: 'sc-icon-btn', type: 'button', 'aria-label': t('app.close'), onclick: () => { if (host) host.close(); else history.back(); } }, icon('close'));
  const scanBtn = h('button', { class: 'sc-btn sc-btn--primary sc-btn--lg', type: 'button', onclick: () => ctx.go('capture') }, icon('camera'), t('library.scan'));
  const importBtn = h('button', { class: 'sc-btn sc-btn--lg', type: 'button', onclick: () => fileInput.click() }, icon('image'), t('library.import'));
  root.append(h('section', { class: 'sc-lib' },
    h('header', { class: 'sc-top' }, closeBtn, h('h1', { class: 'sc-top__title' }, t('library.title'))),
    h('div', { class: 'sc-lib__body' }, h('div', { class: 'sc-lib__actions' }, scanBtn, importBtn, fileInput), status, empty, grid, storage)));

  function outside(e) {
    if (menuEl && !menuEl.contains(e.target)) closeMenu();
  }

  function closeMenu() {
    if (menuEl) { menuEl.remove(); menuEl = null; }
    document.removeEventListener('pointerdown', outside, true);
  }

  function openMenu(anchor, doc) {
    closeMenu();
    const item = (label, fn) => h('button', { class: 'sc-menu__item', type: 'button', role: 'menuitem', onclick: () => { closeMenu(); fn(); } }, label);
    menuEl = h('div', { class: 'sc-menu', role: 'menu', onkeydown: (e) => { if (e.key === 'Escape') { closeMenu(); anchor.focus(); } } },
      item(t('library.rename'), () => rename(doc)),
      item(t('library.export'), () => ctx.go('review', { docId: doc.id, exportNow: true })),
      item(t('library.delete'), () => remove(doc)));
    anchor.parentElement.append(menuEl);
    menuEl.querySelector('button').focus();
    document.addEventListener('pointerdown', outside, true);
  }

  async function rename(doc) {
    const name = await promptSheet(t('library.rename_label'), doc.name, t('library.save'));
    if (!name || !alive) return;
    doc.name = name;
    doc.updatedAt = Date.now();
    await db.saveDoc(doc);
    render();
  }

  async function remove(doc) {
    if (!(await confirmSheet(t('library.delete_confirm', { name: doc.name }), t('library.delete')))) return;
    await db.deleteDoc(doc.id);
    if (alive) render();
  }

  async function card(doc) {
    const cover = doc.pageIds.length ? await db.getPage(doc.pageIds[0]) : null;
    const img = h('img', { class: 'sc-card__img', alt: '' });
    if (cover && cover.thumb) objectUrl(cover.thumb, img);
    const more = h('button', { class: 'sc-icon-btn sc-card__more', type: 'button', 'aria-haspopup': 'menu', 'aria-label': t('library.more', { name: doc.name }) }, icon('more'));
    more.addEventListener('click', (e) => { e.stopPropagation(); openMenu(more, doc); });
    return h('li', { class: 'sc-card' },
      h('button', { class: 'sc-card__open', type: 'button', onclick: () => ctx.go('review', { docId: doc.id }) },
        h('span', { class: 'sc-card__thumb' }, img),
        h('span', { class: 'sc-card__name' }, doc.name),
        h('span', { class: 'sc-card__meta' }, tp('library.pages', doc.pageIds.length)),
        h('span', { class: 'sc-card__meta' }, fmtDate(doc.updatedAt))),
      more);
  }

  async function render() {
    const docs = await db.listDocs();
    if (!alive) return;
    const cards = [];
    for (const doc of docs) cards.push(await card(doc));
    if (!alive) return;
    closeMenu();
    grid.textContent = '';
    grid.append(...cards);
    empty.hidden = docs.length > 0;
  }

  async function onFiles() {
    const files = [...fileInput.files];
    fileInput.value = '';
    if (!files.length) return;
    const doc = newDoc();
    status.hidden = false;
    scanBtn.disabled = importBtn.disabled = true;
    try {
      const r = await importFiles(files, doc, (n, total) => { status.textContent = t('import.working', { n, total }); });
      r.failed.forEach((name) => toast(t('import.failed', { name })));
    } catch (e) {
      toast(e && e.name === 'QuotaExceededError' ? t('errors.storage_full') : t('errors.render'));
    }
    if (!alive) return;
    status.hidden = true;
    scanBtn.disabled = importBtn.disabled = false;
    if (!doc.pageIds.length || !(await ctx.go('review', { docId: doc.id }))) render();
  }

  async function showStorage() {
    try {
      const est = await navigator.storage.estimate();
      if (alive && est.quota && est.usage / est.quota > 0.8) {
        storage.textContent = t('library.storage', { used: fmtBytes(est.usage), quota: fmtBytes(est.quota) });
        storage.hidden = false;
      }
    } catch (_) {}
  }

  render();
  showStorage();
  return () => { alive = false; closeMenu(); };
}
