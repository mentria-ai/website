import { h, t, icon, toast, confirmSheet, promptSheet, objectUrl } from '../ui.js';
import * as db from '../db.js';
import { updatePage, loadBitmap, FILTERS } from '../pages.js';
import { render } from '../warp.js';

export function mount(root, ctx, params) {
  let alive = true;
  let doc = null;
  let pages = [];
  let index = Math.max(0, params.page || 0);
  let showFilters = false;
  let working = false;
  let dragging = false;
  let dragged = false;
  let swipe = null;
  const previews = new Map();

  const back = h('button', { class: 'sc-icon-btn', type: 'button', 'aria-label': t('review.back'), onclick: () => ctx.go('library') }, icon('back'));
  const nameBtn = h('button', { class: 'sc-rev__name', type: 'button', title: t('review.rename'), onclick: rename });
  const img = h('img', { class: 'sc-rev__img', alt: '' });
  const counter = h('p', { class: 'sc-rev__count', 'aria-live': 'polite' });
  const prev = h('button', { class: 'sc-icon-btn sc-rev__nav sc-rev__nav--prev', type: 'button', 'aria-label': t('review.prev'), onclick: () => show(index - 1) }, icon('back'));
  const next = h('button', { class: 'sc-icon-btn sc-rev__nav sc-rev__nav--next', type: 'button', 'aria-label': t('review.next'), onclick: () => show(index + 1) }, icon('next'));
  const stage = h('div', { class: 'sc-rev__stage' }, img, prev, next, counter);
  const filters = h('div', { class: 'sc-rev__filters', role: 'group', 'aria-label': t('review.filter'), hidden: true });
  const tool = (name, label, fn) => h('button', { class: 'sc-tool', type: 'button', onclick: fn }, icon(name), label);
  const cropBtn = tool('crop', t('review.crop'), () => ctx.go('adjust', { docId: doc.id, pageId: pages[index].id, page: index }));
  const rotateBtn = tool('rotate', t('review.rotate'), rotate);
  const filterBtn = tool('filter', t('review.filter'), toggleFilters);
  const retakeBtn = tool('retake', t('review.retake'), () => ctx.go('capture', { docId: doc.id, replace: pages[index].id, page: index }));
  const deleteBtn = tool('trash', t('review.delete_page'), removePage);
  filterBtn.setAttribute('aria-pressed', 'false');
  const strip = h('div', { class: 'sc-rev__strip', 'aria-label': t('review.reorder_hint') });
  const live = h('p', { class: 'sc-live', 'aria-live': 'polite' });
  root.append(h('section', { class: 'sc-rev' },
    h('header', { class: 'sc-top' }, back, nameBtn),
    stage, filters,
    h('div', { class: 'sc-rev__tools' }, cropBtn, rotateBtn, filterBtn, retakeBtn, deleteBtn),
    strip, live));

  strip.addEventListener('touchmove', (e) => { if (dragging) e.preventDefault(); }, { passive: false });
  stage.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') swipe = [e.clientX, e.clientY]; });
  stage.addEventListener('pointerup', (e) => {
    if (!swipe) return;
    const dx = e.clientX - swipe[0], dy = e.clientY - swipe[1];
    swipe = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) show(index + (dx < 0 ? 1 : -1));
  });

  function setTools(off) {
    [cropBtn, rotateBtn, filterBtn, retakeBtn, deleteBtn].forEach((b) => { b.disabled = off; });
  }

  function show(i) {
    if (!pages.length) return;
    index = Math.max(0, Math.min(pages.length - 1, i));
    const p = pages[index];
    objectUrl(p.render || p.thumb, img);
    img.alt = t('a11y.page', { n: index + 1 });
    counter.textContent = t('review.page_of', { n: index + 1, total: pages.length });
    prev.hidden = index === 0;
    next.hidden = index === pages.length - 1;
    strip.querySelectorAll('.sc-thumb').forEach((el, k) => el.setAttribute('aria-current', String(k === index)));
    const cur = strip.querySelectorAll('.sc-thumb')[index];
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (showFilters) buildFilters();
  }

  function buildStrip() {
    strip.textContent = '';
    pages.forEach((p, k) => {
      const im = h('img', { alt: '' });
      if (p.thumb) objectUrl(p.thumb, im);
      const b = h('button', { class: 'sc-thumb', type: 'button', 'aria-label': t('a11y.page', { n: k + 1 }), 'aria-current': String(k === index), onclick: () => { if (!dragged) show(k); } },
        im, h('span', { class: 'sc-thumb__n', 'aria-hidden': 'true' }, String(k + 1)));
      b.addEventListener('pointerdown', (e) => startHold(e, k, b));
      b.addEventListener('keydown', (e) => {
        if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
        e.preventDefault();
        move(k, k + (e.key === 'ArrowLeft' ? -1 : 1));
      });
      strip.append(b);
    });
    strip.append(h('button', { class: 'sc-add', type: 'button', 'aria-label': t('review.add'), onclick: () => ctx.go('capture', { docId: doc.id, page: index }) }, icon('plus')));
  }

  function startHold(e, k, el) {
    if (e.button) return;
    dragged = false;
    const x0 = e.clientX, y0 = e.clientY;
    const stop = () => {
      clearTimeout(timer);
      el.removeEventListener('pointermove', moved);
      el.removeEventListener('pointerup', stop);
      el.removeEventListener('pointercancel', stop);
    };
    const moved = (ev) => { if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 10) stop(); };
    const timer = setTimeout(() => { stop(); beginDrag(e.pointerId, k, el, x0, y0); }, 300);
    el.addEventListener('pointermove', moved);
    el.addEventListener('pointerup', stop);
    el.addEventListener('pointercancel', stop);
  }

  function beginDrag(pointerId, from, el, x, y) {
    dragging = true;
    dragged = true;
    try { el.setPointerCapture(pointerId); } catch (_) {}
    el.classList.add('is-drag');
    const pic = h('canvas', { width: '54', height: '70' });
    try { pic.getContext('2d').drawImage(el.querySelector('img'), 0, 0, 54, 70); } catch (_) {}
    const ghost = h('div', { class: 'sc-ghost' }, pic);
    document.body.append(ghost);
    const place = (cx, cy) => { ghost.style.left = cx - 27 + 'px'; ghost.style.top = cy - 35 + 'px'; };
    place(x, y);
    try { if (navigator.vibrate) navigator.vibrate(10); } catch (_) {}
    let pos = from;
    const onMove = (ev) => {
      place(ev.clientX, ev.clientY);
      const thumbs = [...strip.querySelectorAll('.sc-thumb')];
      pos = thumbs.length;
      for (let k = 0; k < thumbs.length; k++) {
        const r = thumbs[k].getBoundingClientRect();
        if (ev.clientX < r.left + r.width / 2) { pos = k; break; }
      }
      const sr = strip.getBoundingClientRect();
      if (ev.clientX < sr.left + 30) strip.scrollLeft -= 12;
      else if (ev.clientX > sr.right - 30) strip.scrollLeft += 12;
    };
    const onUp = () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      ghost.remove();
      el.classList.remove('is-drag');
      dragging = false;
      const to = pos > from ? pos - 1 : pos;
      if (to !== from) move(from, to);
      setTimeout(() => { dragged = false; }, 0);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  }

  async function move(from, to) {
    to = Math.max(0, Math.min(pages.length - 1, to));
    if (from === to || working) return;
    const [p] = pages.splice(from, 1);
    pages.splice(to, 0, p);
    doc.pageIds = pages.map((x) => x.id);
    doc.updatedAt = Date.now();
    await db.saveDoc(doc);
    index = to;
    buildStrip();
    show(index);
    const focus = strip.querySelectorAll('.sc-thumb')[index];
    if (focus) focus.focus();
    live.textContent = t('review.page_of', { n: index + 1, total: pages.length });
  }

  async function edit(patch) {
    if (working) return;
    working = true;
    img.classList.add('is-busy');
    setTools(true);
    try {
      await updatePage(pages[index], patch);
      doc.updatedAt = Date.now();
      await db.saveDoc(doc);
      buildStrip();
      show(index);
    } catch (e) {
      toast(e && e.name === 'QuotaExceededError' ? t('errors.storage_full') : t('errors.render'));
    } finally {
      working = false;
      img.classList.remove('is-busy');
      setTools(false);
    }
  }

  function rotate() {
    edit({ rotation: ((pages[index].rotation || 0) + 90) % 360 });
  }

  function toggleFilters() {
    showFilters = !showFilters;
    filterBtn.setAttribute('aria-pressed', String(showFilters));
    filters.hidden = !showFilters;
    if (showFilters) buildFilters();
  }

  async function buildFilters() {
    const p = pages[index];
    const key = p.id + ':' + p.rotation + ':' + JSON.stringify(p.quad);
    filters.textContent = '';
    const items = FILTERS.map((f) => {
      const im = h('img', { alt: '' });
      filters.append(h('button', { class: 'sc-filter', type: 'button', 'aria-pressed': String(p.filter === f), onclick: () => { if (p.filter !== f) edit({ filter: f }); } }, im, t('filter.' + f)));
      return { f, im };
    });
    let set = previews.get(key);
    if (!set) {
      set = {};
      const bmp = await loadBitmap(p);
      try {
        for (const { f } of items) set[f] = (await render(bmp, p.quad, { rotation: p.rotation, filter: f, maxSide: 160, quality: 0.75 })).blob;
      } finally {
        bmp.close();
      }
      previews.set(key, set);
    }
    if (!alive || pages[index] !== p) return;
    for (const { f, im } of items) objectUrl(set[f], im);
  }

  async function removePage() {
    if (working) return;
    if (!(await confirmSheet(t('review.delete_page_confirm'), t('review.delete_page')))) return;
    const p = pages[index];
    pages.splice(index, 1);
    doc.pageIds = pages.map((x) => x.id);
    doc.updatedAt = Date.now();
    if (!pages.length) {
      await db.deleteDoc(doc.id);
      ctx.go('library');
      return;
    }
    await db.saveDoc(doc, [p.id]);
    buildStrip();
    show(Math.min(index, pages.length - 1));
  }

  async function rename() {
    const name = await promptSheet(t('library.rename_label'), doc.name, t('library.save'));
    if (!name || !alive) return;
    doc.name = name;
    doc.updatedAt = Date.now();
    await db.saveDoc(doc);
    nameBtn.textContent = name;
  }

  function onKey(e) {
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || e.altKey || document.querySelector('.sc-sheet')) return;
    if (e.key === 'ArrowLeft') show(index - 1);
    else if (e.key === 'ArrowRight') show(index + 1);
  }

  async function load() {
    doc = await db.getDoc(params.docId);
    if (!alive) return;
    if (!doc) { ctx.go('library'); return; }
    pages = (await Promise.all(doc.pageIds.map((id) => db.getPage(id)))).filter(Boolean);
    if (!alive) return;
    if (!pages.length) {
      await db.deleteDoc(doc.id);
      ctx.go('library');
      return;
    }
    if (pages.length !== doc.pageIds.length) {
      doc.pageIds = pages.map((p) => p.id);
      await db.saveDoc(doc);
    }
    nameBtn.textContent = doc.name;
    index = Math.min(index, pages.length - 1);
    buildStrip();
    show(index);
  }

  window.addEventListener('keydown', onKey);
  load();
  return () => {
    alive = false;
    window.removeEventListener('keydown', onKey);
  };
}
