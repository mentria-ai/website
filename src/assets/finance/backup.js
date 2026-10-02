import * as L from './oplog.js';
import * as C from './crypto.js';
import * as db from './db.js';

export const FORMAT = 'mentria-finance';
const LOCAL_ONLY = new Set(['vaultwrap', 'device']);

function backupLib() {
  if (window.MentriaBackup) return window.MentriaBackup;
  try { if (window.parent && window.parent.MentriaBackup) return window.parent.MentriaBackup; } catch (_) {}
  throw new Error('backup library unavailable');
}

export function exportPayload(engine, includeKeys) {
  const snap = L.snapshot(engine.state);
  snap.conflicts = [];
  return {
    format: FORMAT,
    v: 1,
    exported_at: new Date().toISOString(),
    device: engine.deviceId,
    root: includeKeys ? C.b64(engine.root) : null,
    snapshot: snap
  };
}

export function encryptExport(payload, passphrase) {
  return backupLib().encryptBackup(payload, passphrase);
}

export async function readFileJson(file) {
  try { return JSON.parse(await file.text()); } catch (_) { throw new Error('not-json'); }
}

export async function decryptExport(env, passphrase) {
  const payload = await backupLib().decryptBackup(env, passphrase);
  if (!payload || payload.format !== FORMAT || !payload.snapshot || !Array.isArray(payload.snapshot.recs)) throw new Error('not-finance');
  return payload;
}

export function plainExport(engine) {
  const out = {};
  for (const [e, m] of engine.state.ents) {
    if (LOCAL_ONLY.has(e)) continue;
    out[e] = [];
    for (const r of m.values()) if (!r.del) out[e].push(L.view(r));
  }
  return { format: FORMAT + '-plain', v: 1, exported_at: new Date().toISOString(), data: out };
}

export function foreignSafe(snapshot) {
  return Object.assign({}, snapshot, { recs: snapshot.recs.filter((r) => !LOCAL_ONLY.has(r[0])), conflicts: [] });
}

export function sameRoot(engine, payload) {
  return !!(payload.root && engine.root && C.b64(engine.root) === payload.root);
}

export async function mergeInto(engine, payload) {
  const snap = sameRoot(engine, payload) ? payload.snapshot : foreignSafe(payload.snapshot);
  const ops = L.snapshotOps(snap).filter(L.validOp);
  await engine.commit(ops);
  return ops.length;
}

export function wrapRecords(snapshot) {
  const out = {};
  for (const [e, id, f, , del] of snapshot.recs || []) {
    if (e === 'vaultwrap' && !del && (id === 'pass' || id === 'recovery') && f && f.ct) out[id] = f;
  }
  return out;
}

export async function storageSummary() {
  const est = await db.estimate();
  const heads = await db.pageHeads();
  const bytes = heads.reduce((n, p) => n + (p.bytes || 0), 0);
  return { usage: est.usage, quota: est.quota, persisted: est.persisted, pages: heads.length, plainBytes: bytes };
}
