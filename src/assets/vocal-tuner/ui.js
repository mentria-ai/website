import { presetOf, NOTE_NAMES } from './dsp/settings.js';

let copy = {};

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
      else if (['value', 'checked', 'disabled', 'hidden'].includes(k)) el[k] = v;
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
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3M8 21h8',
  play: 'M7 4l13 8-13 8z',
  pause: 'M7 4h4v16H7zM13 4h4v16h-4z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  share: 'M12 3v12M8 7l4-4 4 4M5 13v6h14v-6',
  download: 'M12 3v12M8 11l4 4 4-4M5 19h14',
  headphones: 'M4 15v-3a8 8 0 0 1 16 0v3M4 15h3v5H4zM17 15h3v5h-3z',
  speaker: 'M4 9h4l5-4v14l-5-4H4zM16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12',
  bluetooth: 'M7 7l10 10-5 4V3l5 4L7 17',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  key: 'M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  reset: 'M4 12a8 8 0 1 0 2.3-5.7M4 4v5h5'
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
    toastEl = h('div', { class: 'vt-toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('is-on'), 2800);
}

let sheets = 0;

export function overlay(children, onDismiss) {
  const prev = document.activeElement;
  const root = document.getElementById('vt');
  const panel = h('div', { class: 'vt-sheet__panel', role: 'dialog', 'aria-modal': 'true' }, children);
  const el = h('div', { class: 'vt-sheet' }, panel);
  const focusables = () => [...panel.querySelectorAll('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])')].filter((n) => !n.disabled && n.getClientRects().length);
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onDismiss();
    } else if (e.key === 'Tab') {
      const f = focusables();
      if (!f.length) return;
      const inside = panel.contains(document.activeElement);
      if (e.shiftKey && (!inside || document.activeElement === f[0])) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && (!inside || document.activeElement === f[f.length - 1])) { e.preventDefault(); f[0].focus(); }
    }
  };
  el.addEventListener('click', (e) => { if (e.target === el) onDismiss(); });
  document.addEventListener('keydown', onKey);
  document.body.append(el);
  sheets++;
  if (root) root.inert = true;
  queueMicrotask(() => {
    if (panel.contains(document.activeElement)) return;
    const f = focusables();
    if (f[0]) f[0].focus();
  });
  return {
    el,
    panel,
    close: () => {
      document.removeEventListener('keydown', onKey);
      el.remove();
      sheets = Math.max(0, sheets - 1);
      if (root && !sheets) root.inert = false;
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
    const cancel = h('button', { class: 'vt-btn', type: 'button', onclick: () => done(false) }, t('takes.cancel'));
    const ok = h('button', { class: 'vt-btn vt-btn--danger', type: 'button', onclick: () => done(true) }, okLabel);
    o = overlay([h('p', { class: 'vt-sheet__msg' }, message), h('div', { class: 'vt-sheet__actions' }, cancel, ok)], () => done(false));
    cancel.focus();
  });
}

export function promptSheet(label, value, okLabel) {
  return new Promise((resolve) => {
    let o = null;
    const input = h('input', { class: 'vt-input', type: 'text', value: value || '', maxlength: '120', autocomplete: 'off', 'aria-label': label });
    const done = (v) => { o.close(); resolve(v); };
    const form = h('form', { class: 'vt-sheet__form', onsubmit: (e) => { e.preventDefault(); done(input.value.trim() || null); } },
      h('span', { class: 'vt-label' }, label),
      input,
      h('div', { class: 'vt-sheet__actions' },
        h('button', { class: 'vt-btn', type: 'button', onclick: () => done(null) }, t('takes.cancel')),
        h('button', { class: 'vt-btn vt-btn--primary', type: 'submit' }, okLabel)));
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

export function installedApp() {
  try { return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch (_) { return false; }
}

export function fmtDate(ms) {
  try { return new Intl.DateTimeFormat(lang(), { dateStyle: 'medium' }).format(new Date(ms)); } catch (_) { return new Date(ms).toDateString(); }
}

export function fmtDateTime(ms) {
  try { return new Intl.DateTimeFormat(lang(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms)); } catch (_) { return new Date(ms).toLocaleString(); }
}

export function fmtDuration(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

export function fmtBytes(n) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  let s;
  try { s = new Intl.NumberFormat(lang(), { maximumFractionDigits: i ? 1 : 0 }).format(n); } catch (_) { s = n.toFixed(i ? 1 : 0); }
  return s + ' ' + units[i];
}

export function safeName(name, fallback = 'Take') {
  const s = String(name || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 80)
    .trim();
  return s || fallback;
}

export function styleName(correction) {
  const p = presetOf(correction);
  return p ? t('live.presets.' + p) : t('live.correction') + ' ' + Math.round(correction * 100);
}

export function keyName(key) {
  if (!key) return t('live.any_key');
  return t(key.mode === 'minor' ? 'key.minor_name' : 'key.major_name', { note: NOTE_NAMES[key.root] });
}

export function takeLabel(settings) {
  return styleName(settings.correction) + ' · ' + keyName(settings.key);
}

export function prefersShare() {
  try { return installedApp() || matchMedia('(pointer: coarse)').matches; } catch (_) { return false; }
}

export async function deliverFile(name, blob, title) {
  const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
  if (prefersShare() && canShareFiles([file])) {
    const r = await shareFiles([file], title || name);
    if (r !== 'failed') return r;
  }
  downloadBlob(name, blob);
  return 'downloaded';
}
