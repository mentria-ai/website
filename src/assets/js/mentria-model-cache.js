const CACHE = 'mentria-models';
const OLD = 256 * 1024 * 1024;
export const PIECE = 16 * 1024 * 1024;
const PER = OLD / PIECE;

function key(url, k) {
  return url + (url.includes('?') ? '&' : '?') + 'mentria_seg=' + k;
}

async function readJson(c, k) {
  const r = await c.match(k);
  if (!r) return null;
  try { return await r.json(); } catch (_) { return null; }
}

function put(c, url, k, body, type) {
  return c.put(key(url, k), new Response(body, { headers: { 'content-type': type || 'application/octet-stream' } }));
}

async function writePieces(c, url, k, blob) {
  const n = Math.ceil(blob.size / PIECE);
  for (let i = n - 1; i >= 0; i--) {
    await put(c, url, k * PER + i, blob.slice(i * PIECE, Math.min((i + 1) * PIECE, blob.size)));
  }
}

async function dropShard(c, url, count) {
  for (let k = 0; k < count; k++) await c.delete(key(url, k)).catch(() => {});
  await c.delete(key(url, 'meta')).catch(() => {});
  await c.delete(key(url, 'mig')).catch(() => {});
}

export async function compactShard(url) {
  const c = await caches.open(CACHE);
  const meta = await readJson(c, key(url, 'meta'));
  let mig = await readJson(c, key(url, 'mig'));
  if (!meta && !mig) return false;
  const total = (meta || mig).totalBytes;
  const from = meta ? meta.segments : mig.from;
  if (!Number.isInteger(total) || !Number.isInteger(from) || total <= 0) return false;
  const pieces = Math.ceil(total / PIECE);
  if (!mig) {
    if (meta.v !== 1 || from >= pieces || from !== Math.ceil(total / OLD) || from > PER) return false;
    for (let k = from - 1; k >= 1; k--) {
      const r = await c.match(key(url, k));
      if (!r) return false;
      const blob = await r.blob();
      if (blob.size !== Math.min(OLD, total - k * OLD)) return false;
      await writePieces(c, url, k, blob);
    }
    mig = { v: 1, from, totalBytes: total };
    await put(c, url, 'mig', JSON.stringify(mig), 'application/json');
  }
  await c.delete(key(url, 'meta'));
  const r0 = await c.match(key(url, 0));
  const b0 = r0 ? await r0.blob() : null;
  if (b0 && b0.size === Math.min(OLD, total)) await writePieces(c, url, 0, b0);
  else if (!b0 || b0.size !== Math.min(PIECE, total)) {
    await dropShard(c, url, Math.max(pieces, from));
    return false;
  }
  await put(c, url, 'meta', JSON.stringify({ v: 1, segments: pieces, totalBytes: total }), 'application/json');
  await c.delete(key(url, 'mig'));
  return true;
}

export async function compactShards(urls) {
  let changed = 0;
  for (const u of urls) {
    try { if (await compactShard(u)) changed++; } catch (err) { console.warn('[mentria-model-cache] compact failed for ' + u, err); }
  }
  return changed;
}
