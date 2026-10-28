const JS = '/assets/js/';
const RUNTIME = JS + 'mentria-unlock.js';
const CARD = JS + 'mentria-unlock-ui.js';
const LATER = 'mentria.finance.linkLater';
const STORAGE_ERRORS = new Set(['storage', 'idb', 'QuotaExceededError', 'UnknownError', 'AbortError', 'SecurityError', 'InvalidStateError', 'DataError', 'VersionError']);
let runtimeP = null;
let uiP = null;
let failed = false;
const copies = new Map();

export function runtime() {
  if (!runtimeP) {
    runtimeP = import(RUNTIME).then((m) => { failed = false; return m; }, () => { runtimeP = null; failed = true; return null; });
  }
  return runtimeP;
}

export async function active() {
  const K = await runtime();
  if (!K) return null;
  try { if (!K.enabled()) return null; } catch (_) { return null; }
  try { await K.ready(); } catch (_) {}
  return K;
}

export async function load() {
  const K = await active();
  if (K) return { K, why: null };
  return { K: null, why: failed ? 'failed' : 'off' };
}

export function ui() {
  if (!uiP) {
    uiP = import(CARD);
    uiP.catch(() => { uiP = null; });
  }
  return uiP;
}

function siteCode() {
  const raw = String(document.documentElement.dataset.siteCode || 'en').toLowerCase();
  return /^[a-z]{2}(-[a-z]{2})?$/.test(raw) ? raw : 'en';
}

function loadCopy(code) {
  if (!copies.has(code)) {
    const p = import('/assets/js/unlock-copy.' + code + '.js').then((m) => m.default || {});
    p.catch(() => { if (copies.get(code) === p) copies.delete(code); });
    copies.set(code, p);
  }
  return copies.get(code);
}

export async function copy() {
  const code = siteCode();
  try { return await loadCopy(code); } catch (_) {}
  try { return await loadCopy('en'); } catch (_) { return {}; }
}

export function errCode(e) {
  if (!e) return '';
  const name = String(e.name || '');
  return name && name !== 'Error' && /Error$/.test(name) ? name : String(e.message || name);
}

export function failText(e, T) {
  const copy = T || {};
  const key = STORAGE_ERRORS.has(errCode(e)) ? 'err_storage' : 'err_other';
  return typeof copy[key] === 'string' ? copy[key] : '';
}

export function saidLater() {
  try { return sessionStorage.getItem(LATER) === '1'; } catch (_) { return false; }
}

export function sayLater() {
  try { sessionStorage.setItem(LATER, '1'); } catch (_) {}
}

export async function withConfirm(fn) {
  try {
    return await fn();
  } catch (e) {
    if (errCode(e) !== 'confirm-needed') throw e;
    const U = await ui();
    if (!(await U.showConfirm())) throw e;
    return fn();
  }
}

export function sameBytes(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

export async function forgetPasskeys(ids) {
  const P = typeof window !== 'undefined' ? window.PublicKeyCredential : null;
  if (!P || typeof P.signalUnknownCredential !== 'function') return 0;
  let n = 0;
  for (const credentialId of ids) {
    try {
      await P.signalUnknownCredential({ rpId: location.hostname, credentialId });
      n++;
    } catch (_) {}
  }
  return n;
}
