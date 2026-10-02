import { format, decimalsFor, currencySymbol, normalizeNumber, toMinor, minorToDecimal, localeSeparators } from './money.js';
import { formatDate, formatMonthKey } from './dates.js';

const SVGNS = 'http://www.w3.org/2000/svg';

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const k of Object.keys(props)) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'style' && typeof v === 'object') { for (const sk of Object.keys(v)) { if (v[sk] == null) continue; if (sk.startsWith('--')) el.style.setProperty(sk, v[sk]); else el.style[sk] = v[sk]; } }
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value' || k === 'checked' || k === 'selected' || k === 'disabled' || k === 'hidden') el[k] = v;
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

export function s(tag, attrs, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  if (attrs) for (const k of Object.keys(attrs)) if (attrs[k] != null && attrs[k] !== false) el.setAttribute(k, String(attrs[k]));
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

const ICONS = {
  home: 'M3.5 10.5 12 4l8.5 6.5V20a1 1 0 0 1-1 1H15v-6H9v6H4.5a1 1 0 0 1-1-1z',
  ledger: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  plus: 'M12 5v14M5 12h14',
  invest: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  plan: 'M3 3v18h18M7 15l3.5-4 3 2.5L20 7',
  budget: 'M12 3v9h9A9 9 0 1 1 12 3zM15 3.6A9 9 0 0 1 20.4 9H15z',
  subs: 'M4 6h16v14H4zM8 3v4M16 3v4M4 10h16M9 14l2 2 4-4',
  accounts: 'M3 7.5A2.5 2.5 0 0 1 5.5 5H18v4M3 7.5V18a2 2 0 0 0 2 2h15V9H5.5A2.5 2.5 0 0 1 3 7.5zM16.5 14.5h.01',
  tax: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3',
  reports: 'M4 20V11M10 20V4M16 20v-8M21 20H3',
  import: 'M12 3v11M7.5 9.5 12 14l4.5-4.5M4 16v4h16v-4',
  devices: 'M3 5h12v9H3zM6 18h6M18 8h3v12h-3z',
  settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 4.5v5M9 14.5v5',
  lock: 'M6 11h12v10H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  close: 'M6 6l12 12M18 6 6 18',
  back: 'M15 6l-6 6 6 6',
  next: 'M9 6l6 6-6 6',
  down: 'M6 9l6 6 6-6',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  trash: 'M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5M14 11v5',
  transfer: 'M4 8h15l-4-4M20 16H5l4 4',
  sync: 'M19.5 8A8 8 0 0 0 5.2 6.5L4 8M4 4v4h4M4.5 16a8 8 0 0 0 14.3 1.5L20 16M20 20v-4h-4',
  key: 'M14.5 9.5a4 4 0 1 0-1.4 3l7.4 7.5M17.5 17l2-2M15.5 15l1.5-1.5',
  passkey: 'M12 11v3.5M8.2 9.5a4 4 0 0 1 7.6 0c.4 1.3.2 3.8-.6 6M6 14c0-1.9.2-3.2.9-4.5M18 12.5c0 2.5-.6 4.4-1.4 6M10 18c.8-1.2 1.3-2.4 1.5-3.6M12 3.5a8 8 0 0 1 7.5 5.4M4.5 8.9A8 8 0 0 1 9 4.1',
  sparkle: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 16l.7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z',
  alert: 'M12 4l9 16H3zM12 10v4M12 17h.01',
  check: 'M5 12.5l4.5 4.5L19 7',
  download: 'M12 4v11M7.5 10.5 12 15l4.5-4.5M5 20h14',
  share: 'M12 15V4M8 8l4-4 4 4M5 13v7h14v-7',
  calendar: 'M4 6h16v14H4zM8 3v4M16 3v4M4 10h16',
  tag: 'M3 12V4h8l9 9-8 8zM7.5 8h.01',
  goal: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM12 12h.01',
  coins: 'M5 6.5C5 5.1 8.1 4 12 4s7 1.1 7 2.5S15.9 9 12 9 5 7.9 5 6.5zM5 6.5v5c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-5M5 11.5v5c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-5',
  repeat: 'M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4',
  backspace: 'M9 5h11v14H9l-6-7zM12.5 9.5l5 5M17.5 9.5l-5 5',
  filter: 'M4 5h16l-6.5 8v6l-3-2v-4z',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01',
  bank: 'M3 10h18M5 10v8M10 10v8M14 10v8M19 10v8M3 20h18M12 3l9 5H3z',
  card: 'M3 6h18v12H3zM3 10h18M7 15h3',
  chart: 'M4 19h16M6 15l4-5 3.5 3L18 7',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2M14 18h2v2M18 18h2v2',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-2'
};

export function icon(name, cls) {
  const svg = s('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': name === 'more' ? 3 : 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: cls || null });
  svg.append(s('path', { d: ICONS[name] || ICONS.info }));
  return svg;
}

export const PALETTE = ['#6ef3c5', '#22d3ee', '#a78bfa', '#f472b6', '#fbbf24', '#ff9500', '#4ade80', '#67e8f9', '#c4b5fd', '#fda4af', '#fcd34d', '#93c5fd'];

export function colorFor(key) {
  const str = String(key || '');
  let n = 0;
  for (let i = 0; i < str.length; i++) n = (n * 31 + str.charCodeAt(i)) >>> 0;
  return PALETTE[n % PALETTE.length];
}

export function monogram(text) {
  const t = String(text || '').trim();
  if (!t) return '·';
  const first = Array.from(t)[0];
  if (/\p{Extended_Pictographic}/u.test(first)) return first;
  const words = t.split(/\s+/).filter(Boolean);
  const a = Array.from(words[0])[0] || '';
  const b = words[1] ? Array.from(words[1])[0] : '';
  return (a + (b && /[\p{L}\p{N}]/u.test(b) ? b : '')).toUpperCase();
}

export function mono(label, color, small, iconName) {
  const el = h('span', { class: 'fmono' + (small ? ' fmono--sm' : ''), style: { '--c': color || colorFor(label) }, 'aria-hidden': 'true' });
  if (iconName) el.append(icon(iconName));
  else el.textContent = monogram(label);
  return el;
}

let copy = {};
export function setCopy(c) { copy = c || {}; }

export function t(path, vars) {
  let v = String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), copy);
  if (v == null || typeof v === 'object') v = path;
  if (vars) for (const k of Object.keys(vars)) v = v.split('{' + k + '}').join(String(vars[k]));
  return v;
}

export function has(path) {
  const v = String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), copy);
  return typeof v === 'string';
}

let pluralRules = null;
export function tp(path, n, vars) {
  if (!pluralRules) { try { pluralRules = new Intl.PluralRules(uiLang()); } catch (_) { pluralRules = { select: (x) => (x === 1 ? 'one' : 'other') }; } }
  const cat = pluralRules.select(n);
  const key = has(path + '.' + cat) ? path + '.' + cat : path + '.other';
  return t(key, Object.assign({ n: fmtInt(n) }, vars || {}));
}

export function uiLang() { return document.documentElement.lang || 'en'; }

let numberLocale = null;
export function setNumberLocale(loc) { numberLocale = loc || null; }
export function locale() {
  if (numberLocale) return numberLocale;
  const ui = uiLang();
  const nav = (navigator.languages && navigator.languages[0]) || navigator.language || ui;
  return nav.toLowerCase().startsWith(ui.slice(0, 2).toLowerCase()) ? nav : ui;
}

export function fmtInt(n) { try { return new Intl.NumberFormat(locale()).format(n); } catch (_) { return String(n); } }

export function decimalsOf(ccy) { return decimalsFor(ccy); }

export function money(minor, ccy, opts) { return format(minor || 0, ccy, locale(), opts); }

export function signedMoney(minor, ccy, opts) {
  const o = Object.assign({ signDisplay: 'exceptZero' }, opts || {});
  return format(minor || 0, ccy, locale(), o);
}

export function amountClass(minor) { return minor > 0 ? 'amt--in' : minor < 0 ? 'amt--out' : 'fmuted'; }

export function pct(x, digits) {
  if (x == null || !isFinite(x)) return '—';
  try { return new Intl.NumberFormat(locale(), { style: 'percent', maximumFractionDigits: digits == null ? 1 : digits, minimumFractionDigits: 0 }).format(x); } catch (_) { return (x * 100).toFixed(1) + '%'; }
}

export function date(iso, style) { return formatDate(iso, locale(), style); }
export function month(key, short) { return formatMonthKey(key, locale(), short); }
export function symbol(ccy) { return currencySymbol(ccy, locale()); }

export function parseAmount(text, ccy) {
  const dec = normalizeNumber(text, locale());
  if (dec == null) return null;
  try { return toMinor(dec, ccy); } catch (_) { return null; }
}

export function amountToInput(minor, ccy) {
  if (minor == null) return '';
  const d = minorToDecimal(Math.abs(minor), decimalsFor(ccy));
  const sep = localeSeparators(locale()).decimal;
  return sep === '.' ? d : d.replace('.', sep);
}

export function field(label, control, hint, extraClass) {
  const id = control.id || ('f' + Math.random().toString(36).slice(2, 9));
  if (!control.id && /^(INPUT|SELECT|TEXTAREA)$/.test(control.tagName)) control.id = id;
  const lab = /^(INPUT|SELECT|TEXTAREA)$/.test(control.tagName) ? h('label', { class: 'ff__label', for: id }, label) : h('span', { class: 'ff__label' }, label);
  return h('div', { class: 'ff' + (extraClass ? ' ' + extraClass : '') }, lab, control, hint ? h('span', { class: 'ff__hint' }, hint) : null);
}

export function input(props) {
  return h('input', Object.assign({ class: 'fi', type: 'text', autocomplete: 'off' }, props || {}));
}

export function moneyField(props) {
  return h('input', Object.assign({ class: 'fi fi--num', type: 'text', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false' }, props || {}));
}

export function select(options, value, props) {
  const el = h('select', Object.assign({ class: 'fsel' }, props || {}));
  for (const o of options) {
    if (o.group) {
      const g = h('optgroup', { label: o.group });
      for (const x of o.options) g.append(h('option', { value: x.value, selected: String(x.value) === String(value) }, x.label));
      el.append(g);
    } else {
      el.append(h('option', { value: o.value, selected: String(o.value) === String(value), disabled: o.disabled }, o.label));
    }
  }
  if (value != null) el.value = String(value);
  return el;
}

export function seg(options, value, onChange, block) {
  const wrap = h('div', { class: 'fseg' + (block ? ' fseg--block' : ''), role: 'tablist' });
  for (const o of options) {
    const b = h('button', { type: 'button', role: 'tab', class: o.value === value ? 'is-on' : '', 'aria-selected': o.value === value ? 'true' : 'false', onclick: () => {
      for (const x of wrap.children) { x.classList.remove('is-on'); x.setAttribute('aria-selected', 'false'); }
      b.classList.add('is-on');
      b.setAttribute('aria-selected', 'true');
      onChange(o.value);
    } }, o.label);
    wrap.append(b);
  }
  return wrap;
}

export function checkbox(label, checked, onChange) {
  const box = h('input', { type: 'checkbox', checked: !!checked, onchange: (e) => onChange && onChange(e.target.checked) });
  return h('label', { class: 'fcheck' }, box, h('span', null, label));
}

export function bar(value, total, opts) {
  const o = opts || {};
  const ratio = total > 0 ? value / total : 0;
  const el = h('div', { class: 'fbar' + (ratio > 1 ? ' is-over' : ratio > (o.warnAt || 0.9) ? ' is-warn' : ''), role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(Math.min(ratio, 9.99) * 100)) });
  el.append(h('i', { style: { width: Math.max(0, Math.min(1, ratio)) * 100 + '%', background: o.color || null } }));
  if (o.marker != null && o.marker >= 0 && o.marker <= 1) el.append(h('b', { style: { left: o.marker * 100 + '%' } }));
  return el;
}

export function empty(text, action) {
  return h('div', { class: 'fempty' }, h('p', null, text), action || null);
}

export function leader(label, value, cls) {
  return h('div', { class: 'fleader' }, h('span', { class: 'fleader__label' }, label), h('span', { class: 'fleader__dots', 'aria-hidden': 'true' }), h('span', { class: 'fleader__val ' + (cls || '') }, value));
}

let sheetStack = [];

export function sheet(opts) {
  const o = opts || {};
  const dlg = h('dialog', { class: 'fsheet' + (o.wide ? ' fsheet--wide' : ''), 'aria-label': o.title || '' });
  const closeBtn = h('button', { type: 'button', class: 'fb fb--ghost fb--icon', 'aria-label': t('common.close'), onclick: () => close() }, icon('close'));
  const head = h('div', { class: 'fsheet__head' }, h('h2', { class: 'fsheet__title' }, o.title || ''), o.headExtra || null, closeBtn);
  const body = h('div', { class: 'fsheet__body' });
  const foot = h('div', { class: 'fsheet__foot' });
  const panel = h('div', { class: 'fsheet__panel', tabindex: '-1' }, head, body, foot);
  dlg.append(panel);
  let closed = false;
  function close(result) {
    if (closed) return;
    closed = true;
    sheetStack = sheetStack.filter((x) => x !== api);
    try { dlg.close(); } catch (_) {}
    dlg.remove();
    if (isTouch() && document.activeElement && document.activeElement.blur) document.activeElement.blur();
    if (o.onClose) o.onClose(result);
  }
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); if (!o.sticky) close(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg && !o.sticky) close(); });
  const api = {
    el: dlg, body, foot, head, close,
    setBody(...kids) { body.replaceChildren(); append(body, kids); },
    setFoot(...kids) { foot.replaceChildren(); append(foot, kids); foot.hidden = !foot.children.length; },
    setTitle(text) { head.querySelector('.fsheet__title').textContent = text; }
  };
  if (o.body) api.setBody(o.body);
  api.setFoot(o.foot || []);
  (o.root || document.getElementById('fin') || document.body).append(dlg);
  dlg.showModal();
  sheetStack.push(api);
  if (o.focus) setTimeout(() => { try { o.focus.focus({ preventScroll: true }); } catch (_) {} }, 60);
  else { try { panel.focus({ preventScroll: true }); } catch (_) {} }
  return api;
}

export function closeAllSheets() { for (const s of sheetStack.slice()) s.close(); }
export function sheetOpen() { return sheetStack.length > 0; }

export function confirmDialog(opts) {
  const o = opts || {};
  return new Promise((resolve) => {
    let answer = false;
    const ok = h('button', { type: 'button', class: 'fb ' + (o.danger ? 'fb--danger' : 'fb--primary'), onclick: () => { answer = true; api.close(); } }, o.ok || t('common.ok'));
    const cancel = h('button', { type: 'button', class: 'fb', onclick: () => api.close() }, o.cancel || t('common.cancel'));
    const api = sheet({ title: o.title || '', body: h('p', { class: 'fwrap', style: { color: 'var(--f-muted)', lineHeight: '1.55' } }, o.body || ''), foot: [cancel, ok], onClose: () => resolve(answer), focus: o.danger ? cancel : ok });
  });
}

export function promptDialog(opts) {
  const o = opts || {};
  return new Promise((resolve) => {
    let answer = null;
    const inp = input({ value: o.value || '', placeholder: o.placeholder || '', type: o.type || 'text' });
    const ok = h('button', { type: 'button', class: 'fb fb--primary', onclick: () => { answer = inp.value; api.close(); } }, o.ok || t('common.save'));
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ok.click(); } });
    const api = sheet({ title: o.title || '', body: h('div', { class: 'fstack' }, o.body ? h('p', { class: 'fmuted fsmall' }, o.body) : null, field(o.label || '', inp)), foot: [h('button', { type: 'button', class: 'fb', onclick: () => api.close() }, t('common.cancel')), ok], onClose: () => resolve(answer), focus: inp });
  });
}

let toastEl = null;
let toastTimer = null;
export function toast(msg, opts) {
  const o = opts || {};
  if (toastEl) toastEl.remove();
  clearTimeout(toastTimer);
  const root = document.getElementById('fin') || document.body;
  toastEl = h('div', { class: 'ftoast', role: 'status', 'aria-live': 'polite' }, h('span', null, msg));
  if (o.undo) toastEl.append(h('button', { type: 'button', onclick: () => { const u = o.undo; dismiss(); u(); } }, t('common.undo')));
  if (o.action) toastEl.append(h('button', { type: 'button', onclick: () => { const a = o.action.run; dismiss(); a(); } }, o.action.label));
  root.append(toastEl);
  const top = document.querySelector('dialog[open]');
  if (top) top.append(toastEl);
  toastTimer = setTimeout(dismiss, o.ms || (o.undo ? 6000 : 2800));
  function dismiss() { clearTimeout(toastTimer); if (toastEl) { toastEl.remove(); toastEl = null; } }
}

export function downloadBlob(name, blob) {
  try {
    const P = window.parent && window.parent !== window ? window.parent.MentriaUI : null;
    if (P && typeof P.downloadFile === 'function') { P.downloadFile(name, blob); return; }
  } catch (_) {}
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name, style: { display: 'none' } });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
}

export async function shareOrDownload(name, blob, title) {
  try {
    const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
    if (navigator.canShare && navigator.canShare({ files: [file] }) && /iPhone|iPad|Android/.test(navigator.userAgent)) {
      await navigator.share({ files: [file], title: title || name });
      return 'shared';
    }
  } catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; }
  downloadBlob(name, blob);
  return 'downloaded';
}

export function csv(rows) {
  const esc = (v) => {
    const str = v == null ? '' : String(v);
    return /[",\n\r;]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
  };
  return '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
}

export function debounce(fn, ms) {
  let id = null;
  return (...args) => { clearTimeout(id); id = setTimeout(() => fn(...args), ms); };
}

export function isWide() { return window.matchMedia('(min-width: 900px)').matches; }
export function isTouch() { return window.matchMedia('(pointer: coarse)').matches; }
