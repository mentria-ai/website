import {
  ready, state, onChange, prfSupport, create, link, lock, hasRootBytes,
  unlockWithCode, unlockWithPassphrase, unlockWithPasskey, confirmWithCode, confirmWithPasskey,
  addPasskey, setPassphrase, setRemember, confirmCode, others, foldIn
} from './mentria-unlock.js';
import { newRecoveryCode, normalizeCode, formatCode } from './mentria-unlock-core.js';

const SAVE_NAME = 'mentria-recovery-code.txt';
const PRF_ERRORS = new Set(['no-prf', 'bad-prf', 'unknown-passkey', 'no-credential', 'webauthn-timeout', 'no-passkey']);
const WEBAUTHN_PRF = new Set(['SecurityError', 'NotSupportedError']);
const CANCEL_ERRORS = new Set(['NotAllowedError', 'AbortError']);
const SKIPPED_ERRORS = new Set(['webauthn-timeout', 'no-credential']);
const STORAGE_ERRORS = new Set(['storage', 'idb', 'QuotaExceededError', 'UnknownError', 'AbortError', 'SecurityError', 'InvalidStateError', 'DataError', 'VersionError']);
const FOCUSABLE = 'button, a[href], input, select, textarea, [tabindex]';
const SVG_NS = 'http://www.w3.org/2000/svg';
const LOCK_ICON = '<rect x="5" y="10.5" width="14" height="9.5" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8.2 10.5V7.8a3.8 3.8 0 0 1 7.6 0v2.7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="12" cy="15.2" r="1.3" fill="currentColor"/>';

const copies = new Map();
const regions = new WeakMap();
const live = new Set();
const layers = [];
let localeOverride = null;
let seq = 0;
let pageState = null;
let launchP = null;
let setupP = null;
let pendingCode = null;
let noteEl = null;
let noteTimer = null;

function siteCode() {
  const raw = String(localeOverride || document.documentElement.dataset.siteCode || 'en').toLowerCase();
  return /^[a-z]{2}(-[a-z]{2})?$/.test(raw) ? raw : 'en';
}

function load(code) {
  if (!copies.has(code)) {
    const p = import('/assets/js/unlock-copy.' + code + '.js').then((m) => m.default);
    p.catch(() => { if (copies.get(code) === p) copies.delete(code); });
    copies.set(code, p);
  }
  return copies.get(code);
}

async function copy() {
  const code = siteCode();
  try {
    return await load(code);
  } catch (e) {
    if (code === 'en') throw e;
    return load('en');
  }
}

document.addEventListener('mentria:localechange', (e) => {
  const c = e && e.detail && e.detail.code;
  if (typeof c !== 'string' || !c) return;
  localeOverride = c.toLowerCase();
  copy().then((T) => { for (const v of [...live]) v.repaint(T); }, () => {});
});

function domReady() {
  if (document.body && document.readyState !== 'loading') return Promise.resolve();
  return new Promise((resolve) => document.addEventListener('DOMContentLoaded', () => resolve(), { once: true }));
}

function uid(p) {
  seq += 1;
  return 'mu-' + p + '-' + seq;
}

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const k of Object.keys(attrs || {})) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'uk') el.dataset.uk = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
}

function icon() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.innerHTML = LOCK_ICON;
  return h('span', { class: 'm-unlock__icon' }, svg);
}

function paint(root, T) {
  const all = [...root.querySelectorAll('[data-uk]')];
  if (root.dataset && root.dataset.uk) all.unshift(root);
  for (const el of all) {
    const v = T[el.dataset.uk];
    el.textContent = typeof v === 'string' ? v : '';
  }
}

function nextFrame(fn) {
  if (typeof requestAnimationFrame === 'function' && document.visibilityState === 'visible') requestAnimationFrame(() => fn());
  else setTimeout(fn, 50);
}

function region(cls, id) {
  const el = h('p', { class: cls, id, 'aria-live': 'polite' });
  const r = { ready: false, token: 0 };
  regions.set(el, r);
  nextFrame(() => { r.ready = el.isConnected; });
  return el;
}

function say(el, T, key, tone) {
  let r = regions.get(el);
  if (!r) {
    r = { ready: true, token: 0 };
    regions.set(el, r);
  }
  r.token += 1;
  const token = r.token;
  el.classList.toggle('is-error', tone === 'error');
  el.classList.toggle('is-warn', tone === 'warn');
  if (!key) {
    delete el.dataset.uk;
    el.textContent = '';
    return;
  }
  el.dataset.uk = key;
  const fill = () => {
    if (r.token === token) el.textContent = typeof T[key] === 'string' ? T[key] : '';
  };
  if (r.ready && el.isConnected) {
    fill();
    return;
  }
  el.textContent = '';
  nextFrame(() => {
    r.ready = true;
    fill();
  });
}

function errName(e) {
  if (!e) return '';
  const name = String(e.name || '');
  if (name && name !== 'Error' && /^[A-Z][A-Za-z]*Error$/.test(name) && !/^(Type|Range|Reference|Syntax|Eval|URI)Error$/.test(name)) return name;
  return String(e.message || name);
}

function errKey(e, webauthn) {
  const n = errName(e);
  if (n === 'bad-code') return 'err_code';
  if (n === 'bad-pass' || n === 'no-pass') return 'err_pass';
  if (n === 'weak-pass') return 'passphrase_rule';
  if (PRF_ERRORS.has(n)) return 'err_prf';
  if (webauthn && CANCEL_ERRORS.has(n)) return 'err_cancelled';
  if (webauthn && WEBAUTHN_PRF.has(n)) return 'err_prf';
  if (webauthn && n === 'InvalidStateError') return 'err_other';
  if (STORAGE_ERRORS.has(n)) return 'err_storage';
  return 'err_other';
}

function uiWindows() {
  const out = [window];
  try {
    if (window.parent && window.parent !== window && window.parent.document) out.push(window.parent);
  } catch (_) {}
  return out;
}

function siteUI(fn) {
  for (const w of uiWindows()) {
    try {
      if (w.MentriaUI && typeof w.MentriaUI[fn] === 'function') return w.MentriaUI;
    } catch (_) {}
  }
  return null;
}

function toast(message) {
  if (!message) return;
  const ui = siteUI('toast');
  if (ui) {
    try {
      ui.toast(message, { duration: 6000 });
      return;
    } catch (_) {}
  }
  if (!noteEl || !noteEl.isConnected) {
    noteEl = h('div', { class: 'm-unote', role: 'status', 'aria-live': 'polite' });
    document.body.append(noteEl);
  }
  const el = noteEl;
  el.textContent = '';
  setTimeout(() => { el.textContent = message; }, 50);
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => {
    el.remove();
    if (noteEl === el) noteEl = null;
  }, 6000);
}

function saveCode(code, T) {
  const text = ['Mentria', (T.code_label || '') + ': ' + code, '', T.code_body || '', '', location.host + ' ' + new Date().toISOString().slice(0, 10), ''].join('\n');
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const ui = siteUI('downloadFile');
  if (ui) {
    try {
      ui.downloadFile(SAVE_NAME, blob);
      return;
    } catch (_) {}
  }
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: SAVE_NAME, hidden: true });
  document.body.append(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 100);
}

function selectText(el) {
  try {
    const r = document.createRange();
    r.selectNodeContents(el);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  } catch (_) {}
}

async function copyCode(code, box, msg, T) {
  let ok = false;
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(code);
      ok = true;
    }
  } catch (_) {}
  if (ok) say(msg, T, 'code_copied');
  else selectText(box);
}

function codeBox(code) {
  const groups = code.split('-');
  const rows = Math.ceil(groups.length / Math.max(1, Math.floor(20 / (groups[0].length + 1))));
  const per = Math.ceil(groups.length / rows);
  const box = h('div', { class: 'm-ucode', translate: 'no' });
  for (let r = 0; r < rows; r++) {
    if (r) box.append(h('span', { class: 'm-ucode__sep m-ucode__sep--wrap', 'aria-hidden': 'true' }, '-'));
    const row = h('span', { class: 'm-ucode__row' });
    groups.slice(r * per, (r + 1) * per).forEach((g, i) => {
      if (i) row.append(h('span', { class: 'm-ucode__sep', 'aria-hidden': 'true' }, '-'));
      row.append(h('span', { class: 'm-ucode__group' }, g));
    });
    box.append(row);
  }
  return box;
}

function lastFour(code) {
  return code.replace(/[^A-Za-z0-9]/g, '').slice(-4).toUpperCase();
}

function tabbables(panel) {
  return [...panel.querySelectorAll(FOCUSABLE)].filter((n) => {
    if (n.disabled || n.tabIndex < 0 || n.getClientRects().length === 0) return false;
    if (n.type === 'radio' && !n.checked && n.name && panel.querySelector('input[type="radio"][name="' + n.name + '"]:checked')) return false;
    return true;
  });
}

function touch() {
  try { return window.matchMedia('(pointer: coarse)').matches; } catch (_) { return false; }
}

function focusEl(el) {
  if (!el || typeof el.focus !== 'function') return;
  try { el.focus({ preventScroll: false }); } catch (_) {}
}

function setPage(on) {
  const html = document.documentElement;
  if (on && !pageState) {
    const inerted = [];
    for (const el of [...document.body.children]) {
      if (el.classList.contains('m-ulayer') || el.hasAttribute('popover') || el.hasAttribute('inert')) continue;
      if (/^(SCRIPT|STYLE|TEMPLATE|LINK|META|NOSCRIPT)$/.test(el.tagName)) continue;
      el.setAttribute('inert', '');
      inerted.push(el);
    }
    html.classList.add('m-unlock-open');
    pageState = { inerted };
    overlayEvent(true);
  } else if (!on && pageState) {
    for (const el of pageState.inerted) el.removeAttribute('inert');
    html.classList.remove('m-unlock-open');
    pageState = null;
    overlayEvent(false);
  }
}

function overlayEvent(on) {
  try {
    if (window.MentriaUI && typeof window.MentriaUI.overlay === 'function') window.MentriaUI.overlay(on, 'unlock');
  } catch (_) {}
}

function onKey(e) {
  const L = layers[layers.length - 1];
  if (!L) return;
  if (e.isComposing || (e.target && e.target.closest && e.target.closest('[popover]'))) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    dismiss(L);
    return;
  }
  if (e.key !== 'Tab') return;
  const f = tabbables(L.panel);
  if (!f.length) {
    e.preventDefault();
    focusEl(L.panel);
    return;
  }
  const first = f[0];
  const last = f[f.length - 1];
  const a = document.activeElement;
  if (!L.panel.contains(a)) {
    e.preventDefault();
    focusEl(e.shiftKey ? last : first);
  } else if (e.shiftKey && (a === first || !f.includes(a))) {
    e.preventDefault();
    focusEl(last);
  } else if (!e.shiftKey && a === last) {
    e.preventDefault();
    focusEl(first);
  }
}

function openLayer({ labelledby, describedby, onDismiss }) {
  const panel = h('div', { class: 'm-usheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': labelledby, 'aria-describedby': describedby, tabindex: '-1' });
  const root = h('div', { class: 'm-ulayer' }, panel);
  const prev = layers[layers.length - 1];
  if (prev) prev.root.hidden = true;
  const L = { root, panel, onDismiss, closed: false, back: null, opener: document.activeElement };
  L.close = () => closeLayer(L);
  layers.push(L);
  document.body.append(root);
  setPage(true);
  if (layers.length === 1) document.addEventListener('keydown', onKey, true);
  arm(L);
  return L;
}

function arm(L) {
  const ui = window.MentriaUI;
  if (L.closed || L.back || !ui || typeof ui.backDismiss !== 'function') return;
  try {
    L.back = ui.backDismiss(() => {
      L.back = null;
      if (!dismiss(L) && !L.closed) arm(L);
    });
  } catch (_) {
    L.back = null;
  }
}

function dismiss(L) {
  if (L.closed) return true;
  if (typeof L.onDismiss === 'function') return L.onDismiss() !== false;
  closeLayer(L);
  return true;
}

function closeLayer(L) {
  if (L.closed) return;
  L.closed = true;
  if (L.back) {
    const b = L.back;
    L.back = null;
    try { b.release(); } catch (_) {}
  }
  const i = layers.indexOf(L);
  if (i >= 0) layers.splice(i, 1);
  L.root.remove();
  const top = layers[layers.length - 1];
  if (top) {
    top.root.hidden = false;
  } else {
    document.removeEventListener('keydown', onKey, true);
    setPage(false);
  }
  const o = L.opener;
  if (o && o !== document.body && document.contains(o)) focusEl(o);
  else if (top) focusEl(tabbables(top.panel)[0] || top.panel);
}

function buildCard(T0, { mode, onDone, titleId }) {
  let T = T0;
  const confirmMode = mode === 'confirm';
  const ids = { title: titleId || uid('title'), lede: uid('lede'), gloss: uid('gloss'), msg: uid('msg'), code: uid('code'), codeForm: uid('codef'), pass: uid('pass'), passForm: uid('passf') };
  let busy = false;
  let done = false;
  let primary = null;

  const msg = region('m-unlock__msg', ids.msg);
  const passkeyBtn = h('button', { type: 'button', class: 'm-unlock__btn m-unlock__btn--primary', 'data-act': 'passkey', 'aria-describedby': ids.gloss }, h('span', { uk: 'passkey_button' }));
  const passkeyBox = h('div', { class: 'm-unlock__passkey' }, passkeyBtn, h('p', { class: 'm-unlock__gloss', id: ids.gloss, uk: 'passkey_gloss' }));

  const codeInput = h('input', {
    id: ids.code, name: 'recovery-code', type: 'text', class: 'm-unlock__input m-unlock__input--code',
    autocomplete: 'one-time-code', autocapitalize: 'characters', autocorrect: 'off', spellcheck: 'false',
    enterkeyhint: 'go', 'aria-describedby': ids.msg
  });
  const codeForm = h('form', { class: 'm-unlock__form', id: ids.codeForm, 'data-form': 'code', novalidate: true },
    h('label', { class: 'm-unlock__label', for: ids.code, uk: 'code_label' }),
    h('div', { class: 'm-unlock__row' }, codeInput, h('button', { type: 'submit', class: 'm-unlock__btn m-unlock__btn--submit' }, h('span', { uk: 'code_submit' }))));
  const codeToggle = h('button', { type: 'button', class: 'm-unlock__toggle', 'data-act': 'show-code', 'aria-expanded': 'false', 'aria-controls': ids.codeForm }, h('span', { uk: 'code_link' }));

  const passInput = h('input', {
    id: ids.pass, name: 'passphrase', type: 'password', class: 'm-unlock__input',
    autocomplete: 'current-password', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'go', 'aria-describedby': ids.msg
  });
  const passForm = h('form', { class: 'm-unlock__form', id: ids.passForm, 'data-form': 'pass', novalidate: true },
    h('label', { class: 'm-unlock__label', for: ids.pass, uk: 'passphrase_label' }),
    h('div', { class: 'm-unlock__row' }, passInput, h('button', { type: 'submit', class: 'm-unlock__btn m-unlock__btn--submit' }, h('span', { uk: 'code_submit' }))));
  const passToggle = h('button', { type: 'button', class: 'm-unlock__toggle', 'data-act': 'show-pass', 'aria-expanded': 'false', 'aria-controls': ids.passForm }, h('span', { uk: 'passphrase_link' }));
  const passWrap = h('div', { class: 'm-unlock__method' }, passToggle, passForm);
  const codeWrap = h('div', { class: 'm-unlock__method' }, codeToggle, codeForm);
  const alt = h('div', { class: 'm-unlock__alt' }, passWrap, codeWrap);

  const root = h('section', { class: 'm-unlock', 'aria-labelledby': ids.title },
    icon(),
    h('h2', { class: 'm-unlock__title', id: ids.title, tabindex: '-1', uk: confirmMode ? 'confirm_title' : 'card_title' }),
    h('p', { class: 'm-unlock__lede', id: ids.lede, uk: confirmMode ? 'confirm_body' : 'card_lede' }),
    passkeyBox, alt, msg);

  function setOpen(toggle, form, open) {
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    form.hidden = !open;
  }

  function arrange(s) {
    const hasKey = s.passkeys > 0;
    const hasPass = !confirmMode && s.hasPass;
    const next = hasKey ? 'passkey' : hasPass ? 'pass' : 'code';
    passkeyBox.hidden = !hasKey;
    passWrap.hidden = !hasPass;
    if (next !== primary) {
      if (next === 'code') setOpen(codeToggle, codeForm, true);
      if (next === 'pass') setOpen(passToggle, passForm, true);
      if (primary === null) {
        if (next !== 'code') setOpen(codeToggle, codeForm, false);
        if (next !== 'pass') setOpen(passToggle, passForm, false);
      }
      primary = next;
    }
    codeToggle.hidden = primary === 'code';
    passToggle.hidden = primary === 'pass';
    alt.classList.toggle('m-unlock__alt--split', hasKey);
  }

  function finish(s) {
    if (done) return;
    done = true;
    off();
    onDone(confirmMode ? true : (s || state()));
  }

  function invalid(input) {
    input.setAttribute('aria-invalid', 'true');
    focusEl(input);
    try { input.select(); } catch (_) {}
  }

  async function act(kind, fn) {
    if (busy || done) return;
    busy = true;
    root.setAttribute('aria-busy', 'true');
    codeInput.removeAttribute('aria-invalid');
    passInput.removeAttribute('aria-invalid');
    let err = null;
    const p = (async () => fn())();
    codeInput.readOnly = true;
    passInput.readOnly = true;
    say(msg, T, 'working');
    try { await p; } catch (e) { err = e || new Error('err'); }
    busy = false;
    codeInput.readOnly = false;
    passInput.readOnly = false;
    root.removeAttribute('aria-busy');
    if (done) return;
    if (!err) {
      say(msg, T, null);
      finish();
      return;
    }
    const key = errKey(err, kind === 'passkey');
    say(msg, T, key, 'error');
    if (key === 'err_prf') {
      setOpen(codeToggle, codeForm, true);
      focusEl(codeInput);
    } else if (kind === 'code' && key === 'err_code') {
      invalid(codeInput);
    } else if (kind === 'pass' && (key === 'err_pass' || key === 'passphrase_rule')) {
      invalid(passInput);
    }
  }

  passkeyBtn.addEventListener('click', () => act('passkey', () => (confirmMode ? confirmWithPasskey() : unlockWithPasskey())));
  codeForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = codeInput.value.trim();
    if (!v) { focusEl(codeInput); return; }
    act('code', () => (confirmMode ? confirmWithCode(v) : unlockWithCode(v)));
  });
  passForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = passInput.value;
    if (!v) { focusEl(passInput); return; }
    act('pass', () => unlockWithPassphrase(v));
  });
  codeToggle.addEventListener('click', () => {
    const open = codeToggle.getAttribute('aria-expanded') !== 'true';
    setOpen(codeToggle, codeForm, open);
    if (open) focusEl(codeInput);
  });
  passToggle.addEventListener('click', () => {
    const open = passToggle.getAttribute('aria-expanded') !== 'true';
    setOpen(passToggle, passForm, open);
    if (open) focusEl(passInput);
  });

  const off = onChange((s) => {
    if (done) return;
    if (!confirmMode && s.unlocked) {
      finish(s);
      return;
    }
    arrange(s);
  });

  const inst = {
    root,
    ledeId: ids.lede,
    repaint(T2) {
      T = T2;
      paint(root, T);
    },
    focus() {
      if (primary === 'passkey') focusEl(passkeyBtn);
      else if (touch()) focusEl(root.querySelector('.m-unlock__title'));
      else focusEl(primary === 'pass' ? passInput : codeInput);
    },
    check() {
      const s = state();
      if (!confirmMode && s.unlocked) finish(s);
    },
    destroy() {
      done = true;
      off();
      live.delete(inst);
      root.remove();
    }
  };
  arrange(state());
  paint(root, T);
  live.add(inst);
  return inst;
}

export async function mountCard(container, { onUnlocked } = {}) {
  const T = await copy();
  ready().catch(() => {});
  let called = false;
  const card = buildCard(T, {
    mode: 'unlock',
    onDone: (s) => {
      if (called) return;
      called = true;
      if (typeof onUnlocked === 'function') {
        try { onUnlocked(s); } catch (_) {}
      }
    }
  });
  container.append(card.root);
  queueMicrotask(() => card.check());
  return { destroy: () => card.destroy() };
}

async function launch() {
  const T = await copy();
  await domReady();
  const s = state();
  if (!s.enabled || !s.setUp || s.unlocked) return;
  await new Promise((resolve) => {
    const titleId = uid('title');
    const noteId = uid('note');
    let L = null;
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      card.destroy();
      if (L) L.close();
      resolve();
    };
    const card = buildCard(T, { mode: 'unlock', titleId, onDone: () => close() });
    const notNow = h('button', { type: 'button', class: 'm-unlock__btn m-unlock__btn--ghost', 'data-act': 'not-now', 'aria-describedby': noteId }, h('span', { uk: 'not_now' }));
    const later = h('div', { class: 'm-unlock__later' }, notNow, h('p', { class: 'm-unlock__note', id: noteId, uk: 'not_now_note' }));
    paint(later, T);
    card.root.append(later);
    notNow.addEventListener('click', () => close());
    L = openLayer({ labelledby: titleId, describedby: card.ledeId, onDismiss: () => close() });
    L.panel.append(card.root);
    card.focus();
  });
}

export function showLaunch() {
  if (!launchP) launchP = launch().catch(() => {}).finally(() => { launchP = null; });
  return launchP;
}

export async function showConfirm() {
  if (hasRootBytes()) return true;
  const s = state();
  if (!s.enabled || !s.setUp) return false;
  const T = await copy();
  await domReady();
  return new Promise((resolve) => {
    const titleId = uid('title');
    let L = null;
    let closed = false;
    const done = (v) => {
      if (closed) return;
      closed = true;
      card.destroy();
      if (L) L.close();
      resolve(v);
    };
    const card = buildCard(T, { mode: 'confirm', titleId, onDone: () => done(true) });
    const notNow = h('button', { type: 'button', class: 'm-unlock__btn m-unlock__btn--ghost', 'data-act': 'not-now' }, h('span', { uk: 'not_now' }));
    const later = h('div', { class: 'm-unlock__later' }, notNow);
    paint(later, T);
    card.root.append(later);
    notNow.addEventListener('click', () => done(false));
    L = openLayer({ labelledby: titleId, describedby: card.ledeId, onDismiss: () => done(false) });
    L.panel.append(card.root);
    card.focus();
  });
}

async function withConfirm(fn) {
  try {
    return await fn();
  } catch (e) {
    if (errName(e) !== 'confirm-needed') throw e;
    if (!(await showConfirm())) throw e;
    return fn();
  }
}

function sheetForm(ids, name, dots) {
  const msg = region('m-usheet__msg', ids.msg);
  const form = h('form', { class: 'm-usheet__step', 'data-step': name, novalidate: true });
  const head = [];
  if (dots) {
    const row = h('div', { class: 'm-usheet__dots', 'aria-hidden': 'true' });
    for (let i = 0; i < dots[1]; i++) row.append(h('span', { class: 'm-usheet__dot' + (i < dots[0] ? ' is-on' : '') }));
    head.push(row);
  }
  head.push(icon());
  const title = h('h2', { class: 'm-usheet__title', id: ids.title, tabindex: '-1' });
  const lede = h('p', { class: 'm-usheet__lede', id: ids.lede });
  return { msg, form, head, title, lede };
}

function assemble(parts, titleKey, ledeKey, body, actions) {
  parts.title.dataset.uk = titleKey;
  parts.lede.dataset.uk = ledeKey;
  parts.form.append(...parts.head, parts.title, parts.lede, ...body.filter(Boolean), parts.msg, h('div', { class: 'm-usheet__actions' }, actions.filter(Boolean)));
  return parts.form;
}

function button(act, key, primary, type) {
  return h('button', { type: type || 'button', class: 'm-unlock__btn ' + (primary ? 'm-unlock__btn--primary' : 'm-unlock__btn--ghost'), 'data-act': act }, h('span', { uk: key }));
}

function option(type, name, value, key, checked, noteKey) {
  const id = uid(name);
  const noteId = noteKey ? uid(name + '-note') : null;
  const input = h('input', { type, id, name, value, checked: !!checked, 'aria-describedby': noteId });
  const label = h('label', { class: 'm-uopt', for: id }, input, h('span', { class: 'm-uopt__text', uk: key }));
  const wrap = h('div', { class: 'm-uopt__wrap' }, label, noteKey ? h('p', { class: 'm-uopt__note', id: noteId, uk: noteKey }) : null);
  return { input, wrap };
}

function field(name, labelKey, attrs, hintKey) {
  const id = uid(name);
  const hintId = hintKey ? uid(name + '-hint') : null;
  const input = h('input', Object.assign({ id, name, class: 'm-unlock__input', 'aria-describedby': hintId }, attrs));
  const wrap = h('div', { class: 'm-usheet__field' },
    h('label', { class: 'm-unlock__label', for: id, uk: labelKey }),
    input,
    hintKey ? h('p', { class: 'm-usheet__hint', id: hintId, uk: hintKey }) : null);
  return { input, wrap };
}

const CODE_ATTRS = { type: 'text', autocapitalize: 'characters', autocorrect: 'off', spellcheck: 'false' };

function codeShown(code, getMsg, getT) {
  const box = codeBox(code);
  const copyBtn = button('copy', 'code_copy', false);
  const saveBtn = button('save', 'code_save', false);
  copyBtn.addEventListener('click', () => copyCode(code, box, getMsg(), getT()));
  saveBtn.addEventListener('click', () => saveCode(code, getT()));
  const check = field('code-check', 'code_check', Object.assign({ autocomplete: 'off', maxlength: '8', class: 'm-unlock__input m-unlock__input--code m-unlock__input--short' }, CODE_ATTRS));
  const want = lastFour(code);
  const watch = (onMatch) => {
    check.input.addEventListener('input', () => {
      const msg = getMsg();
      const got = check.input.value.toUpperCase().replace(/[^A-Z2-7]/g, '');
      const ok = got === want;
      const bad = got.length >= 4 && !ok;
      if (bad) say(msg, getT(), 'code_check_err', 'error');
      else if (msg.dataset.uk === 'code_check_err' || msg.dataset.uk === 'code_copied') say(msg, getT(), null);
      if (bad) check.input.setAttribute('aria-invalid', 'true');
      else check.input.removeAttribute('aria-invalid');
      onMatch(ok, got);
    });
  };
  return { box, tools: h('div', { class: 'm-usheet__tools' }, copyBtn, saveBtn), check, watch };
}

function seal(el) {
  if (!el) return;
  el.disabled = true;
  el.setAttribute('data-sealed', '');
}

function checkable(el) {
  return el.type === 'checkbox' || el.type === 'radio';
}

function busyHolder(getLayer, getMsg, getT) {
  let held = null;
  return function busyOn(on, key) {
    const L = getLayer();
    if (!L) return;
    const msg = getMsg();
    if (on) {
      if (held) return;
      const active = document.activeElement;
      const inputs = [...L.panel.querySelectorAll('input')];
      held = {
        key: key || 'saving',
        focus: L.panel.contains(active) ? active : null,
        buttons: [...L.panel.querySelectorAll('button')].filter((b) => !b.disabled),
        checks: inputs.filter((i) => checkable(i) && !i.disabled),
        fields: inputs.filter((i) => !checkable(i) && !i.disabled && !i.readOnly)
      };
      for (const b of held.buttons) b.disabled = true;
      for (const i of held.checks) i.disabled = true;
      for (const i of held.fields) i.readOnly = true;
      L.panel.setAttribute('aria-busy', 'true');
      if (held.focus && held.focus.disabled) focusEl(L.panel);
      if (msg) say(msg, getT(), held.key);
      return;
    }
    L.panel.removeAttribute('aria-busy');
    if (!held) return;
    const was = held;
    held = null;
    const free = (el) => el.isConnected && !el.hasAttribute('data-sealed');
    for (const b of was.buttons) if (free(b)) b.disabled = false;
    for (const i of was.checks) if (free(i)) i.disabled = false;
    for (const i of was.fields) if (free(i)) i.readOnly = false;
    if (msg && msg.dataset.uk === was.key) say(msg, getT(), null);
    const a = document.activeElement;
    const lost = !a || a === document.body || a === L.panel || (L.panel.contains(a) && a.disabled);
    if (!lost) return;
    if (was.focus && was.focus.isConnected && !was.focus.disabled) focusEl(was.focus);
    else focusEl(tabbables(L.panel)[0] || L.panel);
  };
}

export function showSetup(opts) {
  if (!setupP) setupP = setup(opts || {}).catch(() => false).finally(() => { setupP = null; });
  return setupP;
}

async function setup({ service, secret, knownCode, verifyCode, knownPassphrase, remember, onRemember }) {
  const supportP = prfSupport().catch(() => 'unknown');
  const T0 = await copy();
  await domReady();
  const st = state();
  if (!st.enabled || st.setUp) return false;
  let T = T0;
  const getT = () => T;
  const getMsg = () => msg;
  const wantsLink = !!(service && secret);
  const passLong = typeof knownPassphrase === 'string' && Array.from(knownPassphrase.normalize('NFC')).length >= 12;
  const keepPass = passLong ? knownPassphrase : null;
  const shortPass = typeof knownPassphrase === 'string' && knownPassphrase !== '' && !passLong;
  const saved = knownCode != null && normalizeCode(String(knownCode)) ? formatCode(String(knownCode)) : null;
  const verify = !saved && typeof verifyCode === 'function' ? verifyCode : null;
  if (!pendingCode) pendingCode = newRecoveryCode();
  const fresh = pendingCode;
  const ids = { title: uid('title'), lede: uid('lede'), msg: uid('msg') };
  const draft = { choice: saved || verify ? 'keep' : 'new', checked: false, typed: null, keepPass: !!keepPass, setPass: false, pass: '', remember: remember === true };
  const prog = { created: false, linked: false, passkey: false, pass: false, remember: false };
  let noPrf = false;
  let busy = false;
  let closed = false;
  let closeTried = false;
  let stepName = null;
  let L = null;
  let msg = null;
  let resolveSetup = null;
  const result = new Promise((r) => { resolveSetup = r; });
  const view = { repaint(T2) { T = T2; if (L) paint(L.panel, T); } };
  const hold = busyHolder(() => L, getMsg, getT);
  const busyOn = (on, key) => {
    busy = on;
    hold(on, key);
  };
  const complete = () => prog.created && (!wantsLink || prog.linked);

  const finish = (v) => {
    if (closed) return;
    closed = true;
    live.delete(view);
    if (L) L.close();
    resolveSetup(v);
  };

  function show(form) {
    stepName = form.dataset.step;
    L.panel.replaceChildren(form);
    paint(form, T);
    focusEl(form.querySelector('.m-usheet__title'));
  }

  function later() {
    if (prog.created) return null;
    const b = button('not-now', 'not_now', false);
    b.addEventListener('click', () => { if (!busy) finish(false); });
    return b;
  }

  function shortNote() {
    return shortPass ? h('p', { class: 'm-usheet__text', uk: 'passphrase_too_short_keep' }) : null;
  }

  function fail(err, webauthn) {
    if (closed) return;
    say(msg, T, errKey(err, webauthn), 'error');
  }

  function intro() {
    const parts = sheetForm(ids, 'intro', [1, 3]);
    msg = parts.msg;
    const form = assemble(parts, 'setup_title', 'setup_lede', [], [button('next', 'next', true, 'submit'), later()]);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!busy) codeStep();
    });
    show(form);
  }

  function codeStep() {
    const parts = sheetForm(ids, 'code', [2, 3]);
    msg = parts.msg;
    const next = button('next', 'next', true, 'submit');
    const shown = codeShown(fresh, getMsg, getT);
    const newPart = h('div', { class: 'm-usheet__part' }, shown.box, shown.tools, shown.check.wrap);
    const body = [];
    let savedField = null;
    const sync = () => {
      if (prog.created) next.disabled = false;
      else if (draft.choice === 'keep') next.disabled = !!verify && !savedField.input.value.trim();
      else next.disabled = !draft.checked;
    };
    shown.watch((ok) => {
      draft.checked = ok;
      sync();
    });
    let ledeKey = 'code_body';
    if (saved || verify) {
      ledeKey = 'keep_code_note';
      const keep = option('radio', 'code-choice', 'keep', 'keep_code', draft.choice === 'keep');
      const other = option('radio', 'code-choice', 'new', 'regenerate_code', draft.choice === 'new');
      const keepPart = h('div', { class: 'm-usheet__part' });
      if (verify) {
        savedField = field('saved-code', 'code_label', Object.assign({ autocomplete: 'one-time-code', class: 'm-unlock__input m-unlock__input--code' }, CODE_ATTRS));
        if (draft.typed) savedField.input.value = draft.typed;
        savedField.input.addEventListener('input', () => {
          savedField.input.removeAttribute('aria-invalid');
          if (msg.dataset.uk === 'err_code') say(msg, T, null);
          sync();
        });
        keepPart.append(savedField.wrap);
      }
      newPart.prepend(h('p', { class: 'm-usheet__text', uk: 'code_body' }));
      const choose = () => {
        draft.choice = keep.input.checked ? 'keep' : 'new';
        keepPart.hidden = draft.choice !== 'keep';
        newPart.hidden = draft.choice !== 'new';
        say(msg, T, null);
        sync();
      };
      keep.input.addEventListener('change', choose);
      other.input.addEventListener('change', choose);
      keepPart.hidden = draft.choice !== 'keep';
      newPart.hidden = draft.choice !== 'new';
      body.push(h('div', { class: 'm-usheet__choices', role: 'radiogroup', 'aria-labelledby': ids.title }, keep.wrap, other.wrap), keepPart);
    }
    body.push(newPart);
    const form = assemble(parts, 'code_title', ledeKey, body, [next, later()]);
    sync();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (busy || next.disabled || closed) return;
      if (!prog.created) {
        let code = fresh;
        if (draft.choice === 'keep' && verify) {
          const n = normalizeCode(savedField.input.value.trim());
          const typed = n ? formatCode(n) : null;
          let ok = false;
          if (typed) {
            busyOn(true, 'working');
            try { ok = (await verify(typed)) === true; } catch (_) { ok = false; }
            busyOn(false);
            if (closed) return;
          }
          if (!ok) {
            say(msg, T, 'err_code', 'error');
            savedField.input.setAttribute('aria-invalid', 'true');
            focusEl(savedField.input);
            try { savedField.input.select(); } catch (_) {}
            return;
          }
          draft.typed = typed;
          code = typed;
        } else if (draft.choice === 'keep') {
          code = saved;
        }
        busyOn(true);
        try {
          await create({ code, confirmed: true });
        } catch (err) {
          busyOn(false);
          const n = errName(err);
          if (n === 'exists' || n === 'disabled') finish(false);
          else fail(err);
          return;
        }
        prog.created = true;
        pendingCode = null;
        for (const b of form.querySelectorAll('[data-act="not-now"]')) b.remove();
        for (const i of form.querySelectorAll('input')) seal(i);
      } else {
        busyOn(true);
      }
      if (wantsLink && !prog.linked) {
        try {
          await link(service, secret);
          prog.linked = true;
        } catch (err) {
          busyOn(false);
          fail(err);
          return;
        }
      }
      const support = await supportP;
      busyOn(false);
      if (closed) return;
      if (support === 'no') noPrf = true;
      if (noPrf) noPrfStep();
      else passkeyStep();
    });
    show(form);
  }

  function keepPassOption(onFlip) {
    if (!keepPass || prog.pass) return null;
    const o = option('checkbox', 'keep-pass', '1', 'keep_passphrase', draft.keepPass);
    o.input.addEventListener('change', () => {
      draft.keepPass = o.input.checked;
      if (onFlip) onFlip();
    });
    return o;
  }

  async function wrapUp(alreadyBusy, closing) {
    if (!alreadyBusy) busyOn(true);
    try {
      if (!prog.pass) {
        const pass = keepPass && draft.keepPass ? keepPass : (!closing && noPrf && draft.setPass ? draft.pass : null);
        if (pass) {
          await withConfirm(() => setPassphrase(pass));
          prog.pass = true;
        }
      }
      if (!closing && noPrf && draft.remember && !prog.remember) {
        await withConfirm(() => setRemember(true));
        prog.remember = true;
      }
    } catch (err) {
      busyOn(false);
      fail(err);
      return;
    }
    busyOn(false);
    if (closed) return;
    finish(complete());
    if (prog.passkey) toast(T.passkey_added);
  }

  function relabel(btn, key) {
    const span = btn.querySelector('[data-uk]');
    if (!span) return;
    span.dataset.uk = key;
    paint(btn, T);
  }

  function addKey(add, skip) {
    const p = (async () => addPasskey(''))();
    const reached = !!(window.PublicKeyCredential && navigator.credentials);
    busyOn(true);
    p.then(() => {
      prog.passkey = true;
      seal(add);
      relabel(skip, 'done');
      return wrapUp(true);
    }, async (err) => {
      busyOn(false);
      if (closed) return;
      const n = errName(err);
      if (n === 'no-prf') {
        noPrf = true;
        noPrfStep();
        say(msg, T, reached ? 'passkey_unusable' : 'passkey_skipped', 'warn');
        return;
      }
      if (n === 'confirm-needed') {
        const ok = await showConfirm();
        if (!closed && !ok) fail(err);
        return;
      }
      const key = errKey(err, true);
      if (key === 'err_cancelled' || SKIPPED_ERRORS.has(n)) say(msg, T, 'passkey_skipped', 'warn');
      else say(msg, T, key, 'error');
    });
  }

  function passkeyStep() {
    const parts = sheetForm(ids, 'passkey', [3, 3]);
    msg = parts.msg;
    const add = button('add-passkey', 'add_passkey', true, 'submit');
    if (prog.passkey) seal(add);
    const skip = button('skip-passkey', prog.passkey ? 'done' : 'skip_for_now', false);
    skip.addEventListener('click', () => { if (!busy && !closed) wrapUp(false); });
    const keep = keepPassOption();
    const form = assemble(parts, 'passkey_step_title', 'passkey_gloss', [keep ? keep.wrap : null, shortNote()], [add, skip]);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!busy && !closed && !prog.passkey) addKey(add, skip);
    });
    show(form);
  }

  function noPrfStep() {
    const parts = sheetForm(ids, 'no-prf', [3, 3]);
    msg = parts.msg;
    const body = [];
    let passField = null;
    let setPass = null;
    const passPart = h('div', { class: 'm-usheet__part m-usheet__part--nested' });
    const syncPass = () => {
      if (!setPass) return;
      setPass.wrap.hidden = !!(keepPass && draft.keepPass);
      passPart.hidden = setPass.wrap.hidden || !draft.setPass;
    };
    const keep = keepPassOption(syncPass);
    if (keep) body.push(keep.wrap);
    body.push(shortNote());
    if (!prog.pass) {
      setPass = option('checkbox', 'set-pass', '1', 'set_passphrase', draft.setPass);
      passField = field('new-pass', 'passphrase_label', { type: 'password', autocomplete: 'new-password', autocapitalize: 'off', spellcheck: 'false' }, 'passphrase_rule');
      passField.input.value = draft.pass;
      passField.input.addEventListener('input', () => {
        draft.pass = passField.input.value;
        passField.input.removeAttribute('aria-invalid');
        if (msg.dataset.uk === 'passphrase_rule') say(msg, T, null);
      });
      setPass.input.addEventListener('change', () => {
        draft.setPass = setPass.input.checked;
        syncPass();
        if (draft.setPass) focusEl(passField.input);
      });
      passPart.append(passField.wrap);
      body.push(setPass.wrap, passPart);
    }
    if (!prog.remember) {
      const rem = option('checkbox', 'remember', '1', 'remember_label', draft.remember, 'remember_note');
      rem.input.addEventListener('change', () => {
        draft.remember = rem.input.checked;
        if (typeof onRemember === 'function') {
          try { onRemember(draft.remember); } catch (_) {}
        }
      });
      body.push(rem.wrap);
    }
    const form = assemble(parts, 'no_prf_title', 'no_prf_body', body, [button('done', 'done', true, 'submit')]);
    syncPass();
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (busy || closed) return;
      if (passField && !passPart.hidden && Array.from(draft.pass.normalize('NFC')).length < 12) {
        say(msg, T, 'passphrase_rule', 'error');
        passField.input.setAttribute('aria-invalid', 'true');
        focusEl(passField.input);
        return;
      }
      wrapUp(false);
    });
    show(form);
  }

  L = openLayer({
    labelledby: ids.title,
    describedby: ids.lede,
    onDismiss: () => {
      if (busy) return false;
      const lastStep = stepName === 'passkey' || stepName === 'no-prf';
      const keeping = lastStep && keepPass && draft.keepPass && !prog.pass;
      if (keeping && !closeTried) {
        closeTried = true;
        wrapUp(false, true);
        return false;
      }
      finish(complete());
      if (keeping) toast(T.not_saved);
      return true;
    }
  });
  live.add(view);
  intro();
  return result;
}

export async function showCode(code) {
  const text = formatCode(String(code == null ? '' : code));
  if (!text) return false;
  const T0 = await copy();
  await domReady();
  let T = T0;
  const ids = { title: uid('title'), lede: uid('lede'), msg: uid('msg') };
  return new Promise((resolve) => {
    let closed = false;
    let free = false;
    let L = null;
    const view = { repaint(T2) { T = T2; if (L) paint(L.panel, T); } };
    const finish = (v) => {
      if (closed) return;
      closed = true;
      live.delete(view);
      if (L) L.close();
      resolve(v);
    };
    const parts = sheetForm(ids, 'code', null);
    L = openLayer({
      labelledby: ids.title,
      describedby: ids.lede,
      onDismiss: () => {
        if (free) {
          finish(false);
          return true;
        }
        say(parts.msg, T, 'code_save_first', 'warn');
        return false;
      }
    });
    live.add(view);
    const shown = codeShown(text, () => parts.msg, () => T);
    const doneBtn = button('done', 'done', true, 'submit');
    doneBtn.disabled = true;
    let typed = '';
    shown.watch((ok, got) => {
      doneBtn.disabled = !ok;
      typed = got;
    });
    const form = assemble(parts, 'code_title', 'code_body', [h('p', { class: 'm-usheet__text', uk: 'regenerate_note' }), shown.box, shown.tools, shown.check.wrap], [doneBtn]);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (doneBtn.disabled) return;
      if (confirmCode(typed)) {
        finish(true);
        return;
      }
      free = true;
      say(parts.msg, T, 'err_other', 'error');
    });
    L.panel.append(form);
    paint(form, T);
    focusEl(parts.title);
  });
}

function askUnlock(T) {
  return new Promise((resolve) => {
    const titleId = uid('title');
    let L = null;
    let closed = false;
    const done = (v) => {
      if (closed) return;
      closed = true;
      card.destroy();
      if (L) L.close();
      resolve(v);
    };
    const card = buildCard(T, { mode: 'unlock', titleId, onDone: () => done(true) });
    const notNow = h('button', { type: 'button', class: 'm-unlock__btn m-unlock__btn--ghost', 'data-act': 'not-now' }, h('span', { uk: 'not_now' }));
    const later = h('div', { class: 'm-unlock__later' }, notNow);
    paint(later, T);
    card.root.append(later);
    notNow.addEventListener('click', () => done(false));
    L = openLayer({ labelledby: titleId, describedby: card.ledeId, onDismiss: () => done(false) });
    L.panel.append(card.root);
    card.focus();
    queueMicrotask(() => card.check());
  });
}

function pickOther(kcv) {
  const list = others();
  return kcv ? list.find((o) => o.kcv === kcv) || null : list[0] || null;
}

let foldP = null;

export function showFoldIn(opts) {
  const kcv = opts && typeof opts.kcv === 'string' ? opts.kcv : null;
  const s = state();
  if (!s.enabled || !s.setUp || !s.unlocked || !pickOther(kcv)) return Promise.resolve(false);
  if (!foldP) foldP = foldSheet(kcv).catch(() => false).finally(() => { foldP = null; });
  return foldP;
}

async function foldSheet(kcv) {
  const T0 = await copy();
  await domReady();
  const target = pickOther(kcv);
  if (!target || !state().unlocked) return false;
  let T = T0;
  const ids = { title: uid('title'), lede: uid('lede'), msg: uid('msg') };
  return new Promise((resolve) => {
    let L = null;
    let closed = false;
    let busy = false;
    const view = { repaint(T2) { T = T2; if (L) paint(L.panel, T); } };
    const finish = (v) => {
      if (closed) return;
      closed = true;
      live.delete(view);
      if (L) L.close();
      resolve(v);
    };
    const parts = sheetForm(ids, 'fold-in', null);
    const msg = parts.msg;
    const hold = busyHolder(() => L, () => msg, () => T);
    const busyOn = (on, key) => {
      busy = on;
      hold(on, key);
    };
    const code = field('fold-code', 'code_label', Object.assign({ autocomplete: 'off', enterkeyhint: 'go', class: 'm-unlock__input m-unlock__input--code' }, CODE_ATTRS));
    code.input.addEventListener('input', () => {
      code.input.removeAttribute('aria-invalid');
      if (msg.dataset.uk === 'err_code') say(msg, T, null);
    });
    let passBox = null;
    if (target.passkeys > 0) {
      const glossId = uid('gloss');
      const pass = h('button', { type: 'button', class: 'm-unlock__btn m-unlock__btn--primary', 'data-act': 'fold-passkey', 'aria-describedby': glossId }, h('span', { uk: 'foldin_passkey' }));
      passBox = h('div', { class: 'm-unlock__passkey' }, pass, h('p', { class: 'm-unlock__gloss', id: glossId, uk: 'passkey_gloss' }));
      pass.addEventListener('click', () => run('passkey', () => foldIn(target.kcv, { passkey: true })));
    }
    const submit = button('fold-in', 'foldin_submit', !passBox, 'submit');
    const later = button('not-now', 'not_now', false);
    later.addEventListener('click', () => { if (!busy) finish(false); });
    const form = assemble(parts, 'foldin_title', 'foldin_lede', [passBox, code.wrap], [submit, later]);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (busy || closed) return;
      const v = code.input.value.trim();
      if (!v) { focusEl(code.input); return; }
      run('code', () => foldIn(target.kcv, { code: v }));
    });

    async function run(kind, fn) {
      if (busy || closed) return;
      code.input.removeAttribute('aria-invalid');
      const p = (async () => fn())();
      busyOn(true, 'working');
      let err = null;
      try { await p; } catch (e) { err = e || new Error('err'); }
      busyOn(false);
      if (closed) return;
      if (!err) {
        finish(true);
        toast(T.foldin_done);
        return;
      }
      const n = errName(err);
      if (n === 'no-keyring') {
        finish(!pickOther(target.kcv));
        return;
      }
      if (n === 'locked') {
        say(msg, T, null);
        if (!(await askUnlock(T)) && !closed) say(msg, T, 'err_other', 'error');
        return;
      }
      const key = errKey(err, kind === 'passkey');
      say(msg, T, key, 'error');
      if (kind === 'code' && key === 'err_code') {
        code.input.setAttribute('aria-invalid', 'true');
        focusEl(code.input);
        try { code.input.select(); } catch (_) {}
      } else if (key === 'err_prf') {
        focusEl(code.input);
      }
    }

    L = openLayer({
      labelledby: ids.title,
      describedby: ids.lede,
      onDismiss: () => {
        if (busy) return false;
        finish(false);
        return true;
      }
    });
    live.add(view);
    L.panel.append(form);
    paint(form, T);
    focusEl(parts.title);
  });
}

export async function lockNow() {
  await lock();
  let T = null;
  try { T = await copy(); } catch (_) {}
  if (T && T.locked_toast) toast(T.locked_toast);
}
