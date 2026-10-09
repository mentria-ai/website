let copy = {};
let plural = null;

export function setCopy(c) {
  copy = c || {};
}

function lookup(path) {
  return String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), copy);
}

export function lang() {
  return document.documentElement.lang || 'en';
}

export function t(path, vars) {
  let v = lookup(path);
  if (typeof v !== 'string') v = path;
  if (vars) for (const k of Object.keys(vars)) v = v.split('{' + k + '}').join(String(vars[k]));
  return v;
}

export function tp(path, n, vars) {
  if (!plural) {
    try { plural = new Intl.PluralRules(lang()); } catch (_) { plural = { select: (x) => (x === 1 ? 'one' : 'other') }; }
  }
  const cat = plural.select(n);
  const key = typeof lookup(path + '.' + cat) === 'string' ? path + '.' + cat : path + '.other';
  let num = String(n);
  try { num = new Intl.NumberFormat(lang()).format(n); } catch (_) {}
  return t(key, Object.assign({ n: num }, vars || {}));
}

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const k of Object.keys(props)) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (['value', 'checked', 'disabled', 'hidden', 'multiple', 'muted', 'playsInline', 'autoplay'].includes(k)) el[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, kids);
  return el;
}

function append(el, kids) {
  for (const c of kids) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : String(c));
  }
}

const ICONS = {
  close: 'M6 6l12 12M18 6L6 18',
  back: 'M15 18l-6-6 6-6',
  next: 'M9 6l6 6-6 6',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 10a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7',
  image: 'M4 5h16v14H4zM8.5 8.5h.01M20 15l-5-5-9 9',
  flash: 'M13 2L4 14h7l-1 8 9-12h-7z',
  rotate: 'M20 12a8 8 0 1 1-2.34-5.66M20 4v4h-4',
  crop: 'M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14',
  filter: 'M3 6h18M7 12h10M10 18h4',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  plus: 'M12 5v14M5 12h14',
  retake: 'M4 4v6h6M20 20v-6h-6M20 9a8 8 0 0 0-14-3M4 15a8 8 0 0 0 14 3',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  share: 'M12 3v12M8 7l4-4 4 4M5 13v6h14v-6',
  download: 'M12 3v12M8 11l4 4 4-4M5 19h14',
  doc: 'M7 3h7l5 5v13H7zM14 3v5h5'
};

export function icon(name) {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', name === 'more' ? '3' : '2');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', ICONS[name] || '');
  s.append(p);
  return s;
}

function parentWin() {
  try { return window.parent && window.parent !== window ? window.parent : null; } catch (_) { return null; }
}

export const host = (() => {
  const p = parentWin();
  try { return p ? p.__mentriaExtHost || null : null; } catch (_) { return null; }
})();

export function setFull(on) {
  try { if (host && typeof host.fullscreen === 'function') host.fullscreen(!!on); } catch (_) {}
}

let toastEl = null;
let toastTimer = 0;
export function toast(msg) {
  try {
    if (host && typeof host.notify === 'function') { host.notify(msg); return; }
  } catch (_) {}
  if (!toastEl) {
    toastEl = h('div', { class: 'sc-toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('is-on'), 2600);
}

export function overlay(children, onDismiss) {
  const prev = document.activeElement;
  const panel = h('div', { class: 'sc-sheet__panel', role: 'dialog', 'aria-modal': 'true' }, children);
  const el = h('div', { class: 'sc-sheet' }, panel);
  el.addEventListener('click', (e) => { if (e.target === el) onDismiss(); });
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    onDismiss();
  });
  document.body.append(el);
  return {
    el,
    panel,
    close: () => {
      el.remove();
      try { if (prev && prev.focus) prev.focus(); } catch (_) {}
    }
  };
}

export function confirmSheet(message, okLabel) {
  const p = parentWin();
  try {
    if (p && typeof p.mentriaConfirm === 'function') return Promise.resolve(p.mentriaConfirm(message, { ok: okLabel, danger: true })).then((v) => !!v);
  } catch (_) {}
  return new Promise((resolve) => {
    let o = null;
    const done = (v) => { o.close(); resolve(v); };
    const cancel = h('button', { class: 'sc-btn', type: 'button', onclick: () => done(false) }, t('library.cancel'));
    const ok = h('button', { class: 'sc-btn sc-btn--danger', type: 'button', onclick: () => done(true) }, okLabel);
    o = overlay([h('p', { class: 'sc-sheet__msg' }, message), h('div', { class: 'sc-sheet__actions' }, cancel, ok)], () => done(false));
    cancel.focus();
  });
}

export function promptSheet(label, value, okLabel) {
  return new Promise((resolve) => {
    let o = null;
    const input = h('input', { class: 'sc-input', type: 'text', value: value || '', maxlength: '120', autocomplete: 'off', 'aria-label': label });
    const done = (v) => { o.close(); resolve(v); };
    const form = h('form', { class: 'sc-sheet__form', onsubmit: (e) => { e.preventDefault(); done(input.value.trim() || null); } },
      h('span', { class: 'sc-label' }, label),
      input,
      h('div', { class: 'sc-sheet__actions' },
        h('button', { class: 'sc-btn', type: 'button', onclick: () => done(null) }, t('library.cancel')),
        h('button', { class: 'sc-btn sc-btn--primary', type: 'submit' }, okLabel)));
    o = overlay([form], () => done(null));
    input.focus();
    input.select();
  });
}

export function downloadBlob(name, blob) {
  try {
    const p = parentWin();
    if (p && p.MentriaUI && typeof p.MentriaUI.downloadFile === 'function') { p.MentriaUI.downloadFile(name, blob); return; }
  } catch (_) {}
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name, style: { display: 'none' } });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);
}

export function canShareFiles(files) {
  try { return !!(navigator.share && navigator.canShare && navigator.canShare({ files })); } catch (_) { return false; }
}

export async function shareFiles(files, title) {
  try {
    await navigator.share({ files, title });
    return 'shared';
  } catch (e) {
    return e && e.name === 'AbortError' ? 'cancelled' : 'failed';
  }
}

export function fmtDate(ms) {
  try { return new Intl.DateTimeFormat(lang(), { dateStyle: 'medium' }).format(new Date(ms)); } catch (_) { return new Date(ms).toDateString(); }
}

export function fmtBytes(n) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  let s;
  try { s = new Intl.NumberFormat(lang(), { maximumFractionDigits: i ? 1 : 0 }).format(n); } catch (_) { s = n.toFixed(i ? 1 : 0); }
  return s + ' ' + units[i];
}

export function objectUrl(blob, img) {
  const u = URL.createObjectURL(blob);
  const drop = () => URL.revokeObjectURL(u);
  img.addEventListener('load', drop, { once: true });
  img.addEventListener('error', drop, { once: true });
  img.src = u;
  return img;
}
