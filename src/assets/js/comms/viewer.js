import { fmtBytes } from '/assets/js/comms/cards.js';

const SWIPE_PX = 40;
const fill = (tpl, vars) => String(tpl == null ? '' : tpl).replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m));
const mediaUrl = (ref) => '/comms-media/' + encodeURIComponent(ref);

const node = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
};

const button = (cls, label, act) => {
  const b = node('button', cls, label);
  b.type = 'button';
  if (act) b.dataset.act = act;
  return b;
};

export const openViewer = ({ items, start = 0, T, onShare } = {}) => {
  const V = (T && T.viewer) || {};
  const list = Array.from(items || []).filter((it) => it && it.ref);
  let dlg = document.getElementById('comms-viewer');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'comms-viewer';
    dlg.className = 'comms__viewer';
    document.body.append(dlg);
  }
  dlg.replaceChildren();
  let index = Math.max(0, Math.min(list.length - 1, Number(start) || 0));
  let closed = false;

  const top = node('div', 'comms__viewer-top');
  const counter = node('span', 'comms__viewer-count');
  const name = node('span', 'comms__viewer-name');
  const save = node('a', 'm-btn m-btn--ghost comms__viewer-save', V.save || '');
  const share = button('m-btn m-btn--ghost comms__viewer-share', V.share || '', 'share');
  share.hidden = !(onShare && navigator.share);
  const closeBtn = button('m-btn m-btn--ghost comms__viewer-close', V.close || '×', 'close');
  top.append(counter, name, save, share, closeBtn);
  const stage = node('div', 'comms__viewer-stage');
  const prev = button('comms__viewer-nav comms__viewer-nav--prev', '‹', 'prev');
  prev.setAttribute('aria-label', V.prev || '');
  const next = button('comms__viewer-nav comms__viewer-nav--next', '›', 'next');
  next.setAttribute('aria-label', V.next || '');
  const strip = node('div', 'comms__viewer-strip');
  list.forEach((it, i) => {
    const b = button('comms__viewer-thumb', null, 'go');
    b.dataset.index = String(i);
    if (it.kind === 'image') {
      const img = node('img');
      img.alt = '';
      img.loading = 'lazy';
      img.src = mediaUrl(it.ref);
      b.append(img);
    } else {
      b.append(node('span', 'comms__viewer-thumb-label', it.kind === 'video' ? '▶' : ''));
    }
    strip.append(b);
  });
  strip.hidden = list.length < 2;
  dlg.append(top, stage, prev, next, strip);

  let shareFile = null;
  const show = () => {
    const it = list[index];
    if (!it) return;
    dlg.dataset.index = String(index);
    counter.textContent = list.length > 1 ? (index + 1) + ' / ' + list.length : '';
    name.textContent = it.name || '';
    save.href = mediaUrl(it.ref) + '?dl=1';
    save.setAttribute('download', it.name || '');
    share.textContent = V.share || '';
    shareFile = null;
    const old = stage.querySelector('video');
    if (old) { try { old.pause(); } catch (_) {} }
    let el;
    if (it.kind === 'video') {
      el = node('video', 'comms__viewer-media');
      el.controls = true;
      el.playsInline = true;
      el.preload = 'metadata';
      el.src = mediaUrl(it.ref);
    } else {
      el = node('img', 'comms__viewer-media');
      el.alt = it.name || '';
      el.src = mediaUrl(it.ref);
    }
    stage.replaceChildren(el);
    prev.hidden = index <= 0;
    next.hidden = index >= list.length - 1;
    for (const t of strip.children) t.classList.toggle('is-current', Number(t.dataset.index) === index);
  };
  const go = (i) => {
    if (i < 0 || i >= list.length || i === index) return;
    index = i;
    show();
  };

  const onKey = (e) => {
    if (closed) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); go(index + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(index - 1); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  };
  let downX = null;
  stage.addEventListener('pointerdown', (e) => { downX = e.clientX; });
  stage.addEventListener('pointerup', (e) => {
    if (downX == null) return;
    const dx = e.clientX - downX;
    downX = null;
    if (dx > SWIPE_PX) go(index - 1);
    else if (dx < -SWIPE_PX) go(index + 1);
  });
  dlg.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-act]');
    if (!t || !dlg.contains(t)) return;
    const act = t.dataset.act;
    if (act === 'close') close();
    else if (act === 'prev') go(index - 1);
    else if (act === 'next') go(index + 1);
    else if (act === 'go') go(Number(t.dataset.index));
    else if (act === 'share' && onShare) {
      const it = list[index];
      if (shareFile) {
        const f = shareFile;
        shareFile = null;
        share.textContent = V.share || '';
        try { await navigator.share({ files: [f] }); } catch (_) {}
        return;
      }
      share.disabled = true;
      try {
        const res = await onShare(it, { now: true });
        if (res && res.later) {
          shareFile = res.file;
          share.textContent = V.share_now || V.share || '';
        }
      } finally {
        share.disabled = false;
      }
    }
  });
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  document.addEventListener('keydown', onKey);

  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    const v = stage.querySelector('video');
    if (v) { try { v.pause(); v.removeAttribute('src'); v.load(); } catch (_) {} }
    try { if (dlg.open) dlg.close(); } catch (_) {}
    dlg.removeAttribute('open');
    dlg.replaceChildren();
  };

  try { if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', ''); } catch (_) { dlg.setAttribute('open', ''); }
  show();
  return { close, go, el: dlg };
};

export const renderMediaGrid = (el, { media, usage, T, onOpen, onFree } = {}) => {
  const F = (T && T.files) || {};
  const root = node('div', 'comms__media-grid');
  const head = node('div', 'comms__media-head');
  head.append(node('p', 'comms__media-usage', fill(F.on_device, { size: fmtBytes(usage) })));
  const free = button('m-btn m-btn--ghost comms__media-free', F.free_up || '', 'free');
  free.disabled = !(usage > 0);
  head.append(free);
  const grid = node('div', 'comms__media-cells');
  for (const rec of Array.from(media || [])) {
    const cell = button('comms__media-cell', null, 'open');
    cell.dataset.ref = rec.id;
    const isImage = /^image\//i.test(rec.mime || '') || rec.kind === 'image';
    const isVideo = /^video\//i.test(rec.mime || '') || rec.kind === 'video';
    if (rec.state === 'removed') {
      cell.classList.add('is-removed');
      cell.append(node('span', 'comms__media-label', F.removed || ''));
    } else if (rec.complete && isImage) {
      const img = node('img');
      img.alt = rec.name || '';
      img.loading = 'lazy';
      img.src = mediaUrl(rec.id);
      cell.append(img);
    } else {
      cell.append(node('span', 'comms__media-label', (isVideo ? '▶ ' : '') + (rec.name || '')));
    }
    grid.append(cell);
  }
  root.append(head, grid);
  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act]');
    if (!t || !root.contains(t)) return;
    if (t.dataset.act === 'free' && onFree) onFree();
    else if (t.dataset.act === 'open' && onOpen) onOpen(t.dataset.ref);
  });
  el.replaceChildren(root);
  return root;
};
