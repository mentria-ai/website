import * as db from './db.js';
import * as C from './crypto.js';

const RETIRED = ['pass', 'recovery', 'prf', 'device'];

export function statusOf(meta, keyringLinked) {
  const m = meta || {};
  const w = m.wraps || null;
  const linked = m.linked === true;
  return {
    setup: !!(((w && w.pass) || linked || keyringLinked) && m.kcv && m.device_id),
    linked,
    keyringLinked: !!keyringLinked,
    hasPass: !!(w && w.pass),
    hasDevice: !!(w && w.device),
    prf: w && Array.isArray(w.prf) ? w.prf.map((p) => ({ id: p.id, label: p.label, created: p.created })) : [],
    deviceId: m.device_id || null,
    deviceName: m.device_name || ''
  };
}

export async function status(opts) {
  const m = await db.getMetaMany(['wraps', 'device_id', 'device_name', 'kcv', 'linked']);
  return statusOf(m, !!(opts && opts.keyringLinked));
}

export function pairPlan(wraps, keyringOpen) {
  if (wraps && wraps.pass) return 'legacy';
  return keyringOpen ? 'linked' : 'no-wraps';
}

export function urlSafeId(id) {
  return String(id || '').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function hasLegacyWraps(wraps) {
  const w = wraps || {};
  return RETIRED.some((k) => w[k] != null && !(Array.isArray(w[k]) && !w[k].length));
}

export function retiredWraps(wraps) {
  const next = Object.assign({}, wraps || {});
  const ids = Array.isArray(next.prf) ? next.prf.filter((p) => p && typeof p.id === 'string' && p.id).map((p) => urlSafeId(p.id)) : [];
  for (const k of RETIRED) delete next[k];
  return { wraps: next, ids };
}

export async function retireLegacy() {
  const r = retiredWraps(await db.getMeta('wraps'));
  await db.setMeta({ wraps: r.wraps });
  return r.ids;
}

export async function markLinked() {
  await db.setMeta({ linked: true });
}

export async function matchLinked(list, kcv) {
  const items = Array.isArray(list) ? list : [];
  for (let i = 0; i < items.length; i++) {
    const root = new Uint8Array(items[i].bytes);
    const keys = await C.deriveKeys(root);
    if (!kcv || keys.kcv === kcv) return { root, keys, linked: true, index: i, id: items[i].id || null };
    root.fill(0);
  }
  return null;
}

export async function openLinked(list) {
  const hit = await matchLinked(list, await db.getMeta('kcv'));
  if (!hit) throw new Error('wrong-key');
  return hit;
}

export function newDeviceId() {
  return C.hex(C.randomBytes(8));
}

export function defaultDeviceName() {
  const ua = navigator.userAgent || '';
  const platform = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  return browser ? platform + ' · ' + browser : platform;
}

const AUTO_NAME = /^(iPhone|iPad|Android|Mac|Windows|Linux|Device)( · (Edge|Firefox|Chrome|Safari))?$/;

export async function refreshDeviceName() {
  const cur = await db.getMeta('device_name');
  const next = defaultDeviceName();
  if (typeof cur === 'string' && cur !== next && AUTO_NAME.test(cur)) await db.setMeta({ device_name: next });
}

export async function buildVault(passphrase, opts) {
  const o = opts || {};
  const linked = o.linked === true;
  const root = o.root ? new Uint8Array(o.root) : C.randomBytes(32);
  const keys = await C.deriveKeys(root);
  const recoveryCode = linked || o.recoveryWrap ? null : o.recoveryCode || C.newRecoveryCode();
  let wraps = { prf: [] };
  if (!linked) {
    const [pass, recovery] = await Promise.all([
      o.passWrap ? Object.assign({ kind: 'pass' }, o.passWrap) : C.makePassWrap(root, passphrase),
      o.recoveryWrap ? Object.assign({ kind: 'recovery' }, o.recoveryWrap) : C.makeRecoveryWrap(root, recoveryCode)
    ]);
    wraps = { pass, recovery, prf: [] };
  }
  const inbox = await C.newInboxKeys(keys.inboxWrap);
  const deviceId = newDeviceId();
  const meta = {
    schema: 1,
    device_id: deviceId,
    device_name: o.deviceName || defaultDeviceName(),
    kcv: keys.kcv,
    wraps,
    linked: linked ? true : undefined,
    inbox_pub: inbox.pub,
    inbox_priv: inbox.sealed,
    seq: 0,
    created_at: new Date().toISOString(),
    pending_setup: o.pending || undefined
  };
  return { meta, root, keys, recoveryCode, deviceId };
}

export async function saveVault(vault) {
  await db.setMeta(vault.meta);
  return { root: vault.root, keys: vault.keys, recoveryCode: vault.recoveryCode, deviceId: vault.deviceId };
}

export async function create(passphrase, opts) {
  return saveVault(await buildVault(passphrase, opts));
}

async function verify(root) {
  const keys = await C.deriveKeys(root);
  const kcv = await db.getMeta('kcv');
  if (kcv && kcv !== keys.kcv) throw new Error('wrong-key');
  return keys;
}

export async function unlockPass(passphrase) {
  const wraps = await db.getMeta('wraps');
  if (!wraps || !wraps.pass) throw new Error('not-setup');
  let root;
  try { root = await C.openPassWrap(wraps.pass, passphrase); } catch (_) { throw new Error('bad-pass'); }
  return { root, keys: await verify(root) };
}

export async function unlockRecovery(code) {
  const wraps = await db.getMeta('wraps');
  if (!wraps || !wraps.recovery) throw new Error('not-setup');
  let root;
  try { root = await C.openRecoveryWrap(wraps.recovery, code); } catch (_) { throw new Error('bad-code'); }
  return { root, keys: await verify(root) };
}

export async function unlockDevice() {
  const wraps = await db.getMeta('wraps');
  if (!wraps || !wraps.device) throw new Error('no-device');
  const root = await C.openDeviceWrap(wraps.device);
  return { root, keys: await verify(root) };
}

export const prfSupported = !!(typeof window !== 'undefined' && window.PublicKeyCredential && window.isSecureContext && navigator.credentials);

export async function enrollPrf(root, label) {
  const salt = C.randomBytes(32);
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: C.randomBytes(32),
      rp: { name: 'Mentria Finance' },
      user: { id: C.randomBytes(16), name: 'mentria-finance', displayName: 'Mentria Finance' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
      timeout: 120000,
      extensions: { prf: { eval: { first: salt } } }
    }
  });
  if (!cred) throw new Error('cancelled');
  const ext = cred.getClientExtensionResults().prf;
  if (!ext || ext.enabled === false) throw new Error('prf-unsupported');
  const credId = new Uint8Array(cred.rawId);
  let out = ext.results && ext.results.first ? new Uint8Array(ext.results.first) : null;
  if (!out) out = (await prfEval(credId, salt)).out;
  const key = await C.prfWrapKey(out);
  const wrap = await C.wrapRoot(root, key, 'prf');
  const wraps = (await db.getMeta('wraps')) || {};
  wraps.prf = (wraps.prf || []).concat([{ id: C.b64(credId), salt: C.b64(salt), label: label || '', created: new Date().toISOString(), iv: wrap.iv, ct: wrap.ct }]);
  await db.setMeta({ wraps });
}

async function prfEval(credId, salt, allow) {
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: C.randomBytes(32),
      allowCredentials: (allow || [credId]).map((id) => ({ type: 'public-key', id })),
      userVerification: 'required',
      timeout: 120000,
      extensions: { prf: { eval: { first: salt } } }
    }
  });
  const ext = assertion && assertion.getClientExtensionResults().prf;
  if (!ext || !ext.results || !ext.results.first) throw new Error('prf-no-result');
  return { out: new Uint8Array(ext.results.first), rawId: new Uint8Array(assertion.rawId) };
}

export async function unlockPrf() {
  const wraps = await db.getMeta('wraps');
  const list = (wraps && wraps.prf) || [];
  if (!list.length) throw new Error('no-prf');
  let lastErr = null;
  for (const p of list) {
    try {
      const r = await prfEval(C.unb64(p.id), C.unb64(p.salt));
      const key = await C.prfWrapKey(r.out);
      const root = await C.unwrapRoot(p, key, 'prf');
      return { root, keys: await verify(root) };
    } catch (e) {
      lastErr = e;
      if (e && (e.name === 'NotAllowedError' || e.name === 'AbortError')) throw e;
    }
  }
  throw lastErr || new Error('prf-failed');
}

export async function removePrf(id) {
  const wraps = (await db.getMeta('wraps')) || {};
  wraps.prf = (wraps.prf || []).filter((p) => p.id !== id);
  await db.setMeta({ wraps });
}

export async function setDeviceUnlock(root, on) {
  const wraps = (await db.getMeta('wraps')) || {};
  if (on) wraps.device = await C.makeDeviceWrap(root);
  else delete wraps.device;
  await db.setMeta({ wraps });
}

export async function changePassphrase(root, passphrase) {
  const wraps = (await db.getMeta('wraps')) || {};
  wraps.pass = Object.assign(await C.makePassWrap(root, passphrase), { changed: new Date().toISOString() });
  await db.setMeta({ wraps });
  return wraps.pass;
}

export async function newRecovery(root) {
  const code = C.newRecoveryCode();
  const wraps = (await db.getMeta('wraps')) || {};
  wraps.recovery = Object.assign(await C.makeRecoveryWrap(root, code), { changed: new Date().toISOString() });
  await db.setMeta({ wraps });
  return code;
}

export async function adoptWrap(kind, wrap) {
  const wraps = (await db.getMeta('wraps')) || {};
  wraps[kind] = Object.assign({ kind }, wrap);
  await db.setMeta({ wraps });
}

export async function localWrap(kind) {
  const wraps = await db.getMeta('wraps');
  return wraps && wraps[kind] ? Object.assign({}, wraps[kind]) : null;
}

export function scorePassphrase(p) {
  const s = String(p || '');
  let r = null;
  try {
    const B = window.parent && window.parent.MentriaBackup;
    if (B && typeof B.scorePassphrase === 'function') r = B.scorePassphrase(s);
  } catch (_) {}
  if (!r) {
    let score = 0;
    if (s.length >= 8) score++;
    if (s.length >= 12) score++;
    if (s.length >= 16) score++;
    if (/[a-z]/.test(s) && /[A-Z]/.test(s)) score++;
    if (/\d/.test(s)) score++;
    if (/[^A-Za-z0-9]/.test(s)) score++;
    if (/(.)\1{2,}/.test(s)) score = Math.max(0, score - 1);
    r = { score, label: score <= 2 ? 'weak' : score <= 4 ? 'medium' : 'strong' };
  }
  return { score: r.score, label: r.label, ok: s.length >= 12 && r.label !== 'weak' };
}
