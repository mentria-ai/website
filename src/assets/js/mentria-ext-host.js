import { dataApiFor, dbApiFor } from '/assets/js/mentria-extensions.js';

const LOCALE_PREFIX = { en: '', es: '/es', fr: '/fr', ja: '/ja', 'pt-br': '/pt-br' };

export function localePrefix(code) {
  const key = String(code || 'en').toLowerCase();
  return Object.prototype.hasOwnProperty.call(LOCALE_PREFIX, key) ? LOCALE_PREFIX[key] : '';
}

const BOOTSTRAP = '<scr' + 'ipt>' +
  'window.mentria = window.parent.__mentriaExtHost;' +
  'window.addEventListener("error", (e) => { window.parent.__mentriaExtReportError(e.message || "runtime error"); });' +
  'window.addEventListener("unhandledrejection", (e) => { window.parent.__mentriaExtReportError(String(e.reason || "unhandled rejection")); });' +
  'document.addEventListener("securitypolicyviolation", (e) => { if (/^(https?|wss?):/.test(e.blockedURI || "")) window.parent.__mentriaExtReportBlocked(e.blockedURI); });' +
  '</scr' + 'ipt>';

let fontFaces = '';

function siteFontFaces() {
  if (fontFaces) return fontFaces;
  let css = '';
  for (const sheet of Array.from(document.styleSheets)) {
    let rules;
    try { rules = sheet.cssRules; } catch (_) { continue; }
    for (const rule of Array.from(rules)) if (rule instanceof CSSFontFaceRule) css += rule.cssText;
  }
  fontFaces = css;
  return css;
}

function toast(msg) {
  const text = String(msg).slice(0, 120);
  if (window.MentriaUI && typeof window.MentriaUI.toast === 'function') { window.MentriaUI.toast(text); return; }
  const t = document.createElement('div');
  t.textContent = text;
  t.setAttribute('role', 'status');
  t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--accent,#6ef3c5);color:#0b0e11;font-family:var(--font-mono);font-size:0.78rem;font-weight:700;padding:8px 16px;border-radius:16px;z-index:10000;';
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

let localeSubs = [];
const wired = new WeakMap();

function eventLocale(e) {
  return (e && e.detail && e.detail.code) || document.documentElement.lang || 'en';
}

document.addEventListener('mentria:localechange', (e) => {
  const code = eventLocale(e);
  for (const fn of localeSubs.slice()) { try { fn(code); } catch (_) {} }
});

function wireFrame(frame) {
  let state = wired.get(frame);
  if (state) return state;
  state = { app: null, focus: true };
  wired.set(frame, state);
  frame.addEventListener('load', () => {
    if (!state.focus) return;
    try { frame.focus({ preventScroll: true }); } catch (_) {}
  });
  document.addEventListener('mentria:localechange', (e) => {
    if (!state.app) return;
    const next = localePrefix(eventLocale(e)) + state.app;
    if (frame.getAttribute('src') !== next) frame.src = next;
  });
  return state;
}

export function mountExtension(frame, opts) {
  const m = opts.manifest;
  const id = m.id;
  const cs = getComputedStyle(document.documentElement);
  const theme = Object.freeze({
    accent: cs.getPropertyValue('--accent').trim() || '#6ef3c5',
    bg: cs.getPropertyValue('--term-bg').trim() || '#0b0e11',
    fg: cs.getPropertyValue('--term-fg').trim() || '#e6edf3',
    muted: cs.getPropertyValue('--term-muted').trim(),
    fontMono: cs.getPropertyValue('--font-mono').trim()
  });
  const subs = [];
  localeSubs = subs;
  const setFull = (on) => {
    frame.classList.toggle('xr__frame--full', !!on);
    document.documentElement.classList.toggle('ext-full', !!on);
  };
  setFull(false);
  window.__mentriaExtHost = Object.freeze({
    manifest: Object.freeze(JSON.parse(JSON.stringify(m))),
    storage: dataApiFor(id),
    db: dbApiFor(id),
    get locale() { return document.documentElement.lang || 'en'; },
    onLocaleChange: (fn) => {
      if (typeof fn === 'function') subs.push(fn);
    },
    theme,
    args: opts.args || null,
    notify: toast,
    fullscreen: setFull,
    close: () => { if (typeof opts.onClose === 'function') opts.onClose(); else location.href = (opts.prefix || '') + '/'; }
  });
  window.__mentriaExtReportError = (msg) => { if (typeof opts.onError === 'function') opts.onError(m.name + ': ' + msg); };
  const blockedHosts = new Set();
  window.__mentriaExtReportBlocked = (uri) => {
    let host = String(uri || '');
    try { host = new URL(host).host || host; } catch (_) {}
    if (!host || blockedHosts.has(host)) return;
    blockedHosts.add(host);
    const tpl = opts.blockedTemplate || '{name}: {host}';
    if (typeof opts.onError === 'function') opts.onError(Array.from(blockedHosts).map((h) => tpl.replace('{name}', m.name).replace('{host}', h)).join(' '));
  };
  const state = wireFrame(frame);
  state.focus = opts.focus !== false;
  state.app = m.app || null;
  if (m.app) {
    frame.src = (opts.prefix || '') + m.app;
  } else {
    frame.srcdoc = BOOTSTRAP + '<style>' + siteFontFaces() + '</style>' + opts.source;
  }
}
