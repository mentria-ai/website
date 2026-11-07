import { forPeople } from '/assets/js/comms/location.js';

const LIMIT = 2147483648;
const STD_SIDE = 1600;
const STD_BYTES_PER_PIXEL = 0.2;

const fill = (tpl, vars) => String(tpl == null ? '' : tpl).replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m));

export const fmtSize = (n) => {
  const v = Math.max(0, Number(n) || 0);
  const one = (x) => x.toFixed(1).replace(/\.0$/, '');
  if (v >= 1e9) return one(v / 1e9) + ' GB';
  if (v >= 1e6) return (v >= 1e8 ? Math.round(v / 1e6) : one(v / 1e6)) + ' MB';
  if (v >= 1e3) return Math.round(v / 1e3) + ' KB';
  return v + ' B';
};

export const estimate = (items, T) => {
  const S = (T && T.sheet) || {};
  const list = (items || []).filter(Boolean);
  const total = list.reduce((a, it) => a + (it.kind === 'photo' && it.variant === 'standard' && it.std ? Math.min(it.std, it.size) : it.size), 0);
  const photos = list.filter((it) => it.kind === 'photo');
  if (!photos.some((it) => it.variant === 'standard')) return fill(S.est_orig, { size: fmtSize(total) });
  if (photos.length === list.length) return fill(S.est_down, { n: photos.length, size: fmtSize(total) });
  return fill(S.est_mixed, { n: list.length, size: fmtSize(total) });
};

const kindOf = (f) => (/^video\//i.test(f.type || '') ? 'video' : /^image\//i.test(f.type || '') ? 'photo' : 'file');

const node = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
};

const stdGuess = (size, w, h) => {
  if (!w || !h) return size;
  const long = Math.max(w, h);
  const short = Math.min(w, h);
  const px = STD_SIDE * Math.round(STD_SIDE * short / long);
  return Math.min(size, Math.round(px * STD_BYTES_PER_PIXEL));
};

export const openSheet = ({ files, self = false, T, onSend, onCancel } = {}) => {
  const S = (T && T.sheet) || {};
  let dlg = document.getElementById('comms-sheet');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'comms-sheet';
    dlg.className = 'comms__sheet';
    document.body.append(dlg);
  }
  dlg.replaceChildren();
  const items = [];
  const urls = [];
  let variant = 'standard';
  let pending = 0;
  let closed = false;
  let queue = Promise.resolve();

  const title = node('h2', 'comms__sheet-title', S.title || '');
  const strip = node('ul', 'comms__sheet-strip');
  const addLabel = node('label', 'm-btn m-btn--ghost comms__sheet-add');
  const addInput = document.createElement('input');
  addInput.type = 'file';
  addInput.multiple = true;
  addInput.hidden = true;
  addLabel.append(addInput, document.createTextNode(S.add || '+'));
  const caption = document.createElement('textarea');
  caption.className = 'm-input comms__sheet-caption';
  caption.rows = 2;
  caption.maxLength = 2000;
  caption.placeholder = S.caption || '';
  const seg = node('div', 'm-seg comms__sheet-seg');
  seg.setAttribute('role', 'group');
  const segBtn = (value, label) => {
    const b = node('button', '', label);
    b.type = 'button';
    b.dataset.value = value;
    b.addEventListener('click', () => { variant = value; refresh(); });
    return b;
  };
  seg.append(segBtn('standard', S.standard || 'Standard'), segBtn('hd', S.hd || 'HD'));
  const est = node('p', 'comms__sheet-est');
  const warn = node('p', 'comms__sheet-warn', S.keeps_location || '');
  warn.hidden = true;
  const big = node('p', 'comms__sheet-big', S.too_big || '');
  big.hidden = true;
  const actions = node('div', 'comms__sheet-actions');
  const cancel = node('button', 'm-btn m-btn--ghost', S.cancel || '');
  cancel.type = 'button';
  cancel.dataset.act = 'cancel';
  const send = node('button', 'm-btn m-btn--primary', S.send || '');
  send.type = 'button';
  send.dataset.act = 'send';
  actions.append(cancel, send);
  dlg.append(title, strip, addLabel, caption, seg, est, warn, big, actions);

  const refresh = () => {
    const live = items.filter((it) => !it.removed);
    const ok = live.filter((it) => !it.tooBig);
    const anyPhoto = ok.some((it) => it.kind === 'photo');
    seg.hidden = !!self || !anyPhoto;
    for (const b of seg.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.value === variant));
    est.textContent = ok.length ? estimate(ok.map((it) => ({ kind: it.kind, size: it.size, std: it.std, variant: it.kind === 'photo' && !self ? variant : 'original' })), T) + (pending ? ' …' : '') : '';
    warn.hidden = !ok.some((it) => it.kept);
    big.hidden = !live.some((it) => it.tooBig);
    send.disabled = !ok.length || pending > 0;
  };

  const prepare = async (it) => {
    try {
      if (it.kind === 'photo' && globalThis.MentriaImage) {
        const r = await globalThis.MentriaImage.preview(it.file).catch(() => null);
        if (closed || it.removed) return;
        if (r) {
          const url = URL.createObjectURL(r.blob);
          urls.push(url);
          it.img.src = url;
          it.std = stdGuess(it.size, r.w, r.h);
        } else {
          it.kind = 'file';
          it.li.dataset.kind = 'file';
        }
      }
      if (!self) {
        const loc = await forPeople(it.file).catch(() => ({ kept: true }));
        if (closed || it.removed) return;
        if (loc.file) it.send = loc.file;
        if (loc.ranges) it.ranges = loc.ranges;
        if (loc.kept) it.kept = true;
      }
    } finally {
      pending -= 1;
      if (!closed) refresh();
    }
  };

  const add = (list) => {
    for (const file of Array.from(list || [])) {
      const it = { file, kind: kindOf(file), size: file.size, tooBig: file.size > LIMIT, removed: false };
      const li = node('li', 'comms__sheet-item');
      li.dataset.kind = it.kind;
      const img = node('img', 'comms__sheet-thumb');
      img.alt = '';
      const label = node('span', 'comms__sheet-name', file.name || '');
      const rm = node('button', 'comms__sheet-rm', '×');
      rm.type = 'button';
      rm.setAttribute('aria-label', S.remove || 'Remove');
      rm.addEventListener('click', () => { it.removed = true; li.remove(); refresh(); });
      li.append(img, label, rm);
      if (it.tooBig) li.classList.add('is-too-big');
      strip.append(li);
      it.li = li;
      it.img = img;
      items.push(it);
      if (!it.tooBig) {
        pending += 1;
        queue = queue.then(() => (closed || it.removed ? (pending -= 1, null) : prepare(it)));
      }
    }
    refresh();
    return queue;
  };

  const close = () => {
    if (closed) return;
    closed = true;
    urls.forEach((u) => URL.revokeObjectURL(u));
    try { if (dlg.open) dlg.close(); } catch (_) {}
    dlg.replaceChildren();
  };

  addInput.addEventListener('change', () => { add(addInput.files); addInput.value = ''; });
  cancel.addEventListener('click', () => { close(); if (onCancel) onCancel(); });
  dlg.addEventListener('cancel', () => { close(); if (onCancel) onCancel(); }, { once: true });
  send.addEventListener('click', () => {
    if (send.disabled) return;
    const out = items.filter((it) => !it.removed && !it.tooBig).map((it) => ({ file: it.send || it.file, variant: it.kind === 'photo' ? (self ? 'original' : variant) : 'original', ranges: it.ranges }));
    const text = caption.value.trim();
    close();
    if (onSend) onSend({ items: out, caption: text });
  });

  try { if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', ''); } catch (_) { dlg.setAttribute('open', ''); }
  const ready = add(files);
  return { ready, close, el: dlg, add };
};
