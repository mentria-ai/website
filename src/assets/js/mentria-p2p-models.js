const CACHE = 'mentria-models';
const TRACKER = 'wss://relay.mentria.ai/tracker';
const PEERS_KEY = 'mentria-p2p-peers';

export function peersEnabled() {
  try { return localStorage.getItem(PEERS_KEY) === 'on'; } catch (_) { return false; }
}
export function setPeersEnabled(on) {
  try { localStorage.setItem(PEERS_KEY, on ? 'on' : 'off'); } catch (_) {}
}
const SEGMENT_BYTES = 256 * 1024 * 1024;
const STALL_MS = 45000;

let client = null;
let manifestPromise = null;
const active = new Map();

function loadManifest() {
  if (!manifestPromise) {
    manifestPromise = fetch('/assets/models-manifest.json')
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}));
  }
  return manifestPromise;
}

async function getClient() {
  if (!client) {
    const mod = await import('/assets/js/webtorrent.min.js');
    const WT = mod.default || window.WebTorrent;
    client = new WT();
  }
  return client;
}

function baseName(url) {
  try { return decodeURIComponent(new URL(url, location.href).pathname.split('/').pop()); }
  catch (_) { return String(url).split('/').pop(); }
}

export async function entryFor(url) {
  const man = await loadManifest();
  return man[baseName(url)] || null;
}

export function canTorrent(bytes) {
  if (typeof RTCPeerConnection === 'undefined') return false;
  if (navigator.connection && navigator.connection.saveData) return false;
  const memGB = navigator.deviceMemory || 4;
  if (bytes > Math.min(2 * 1024 * 1024 * 1024, memGB * 0.30 * 1e9)) return false;
  return true;
}

export async function shardCached(url) {
  try {
    const c = await caches.open(CACHE);
    const sep = url.includes('?') ? '&' : '?';
    if (await c.match(url + sep + 'mentria_seg=meta')) return true;
    if (await c.match(url)) return true;
  } catch (_) {}
  return false;
}

export async function sha256Hex(buf) {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function writeSegmented(url, blob) {
  const c = await caches.open(CACHE);
  const sep = url.includes('?') ? '&' : '?';
  const segments = Math.ceil(blob.size / SEGMENT_BYTES) || 1;
  for (let k = 0; k < segments; k++) {
    const part = blob.slice(k * SEGMENT_BYTES, Math.min((k + 1) * SEGMENT_BYTES, blob.size));
    await c.put(url + sep + 'mentria_seg=' + k, new Response(part, { headers: { 'content-type': 'application/octet-stream' } }));
  }
  await c.delete(url).catch(() => {});
  await c.put(url + sep + 'mentria_seg=meta', new Response(JSON.stringify({ v: 1, segments, totalBytes: blob.size }), { headers: { 'content-type': 'application/json' } }));
}

async function addTorrent(torrentPath, withPeers) {
  const cl = await getClient();
  const existing = cl.torrents.find((t) => t.mentriaPath === torrentPath);
  if (existing) return existing;
  const tbuf = new Uint8Array(await (await fetch(torrentPath)).arrayBuffer());
  const opts = withPeers ? { announce: [TRACKER] } : {};
  const torrent = await new Promise((resolve, reject) => {
    const t = cl.add(tbuf, opts);
    t.on('ready', () => resolve(t));
    t.on('error', reject);
  });
  torrent.mentriaPath = torrentPath;
  return torrent;
}

export function ensureShardViaP2P(url, onStatus) {
  if (active.has(url)) return active.get(url);
  const run = (async () => {
    const entry = await entryFor(url);
    if (!entry) return { skipped: 'no-torrent' };
    if (!peersEnabled()) return { skipped: 'private-mode' };
    if (!canTorrent(entry.bytes)) return { skipped: 'gated' };
    if (await shardCached(url)) return { skipped: 'cached' };
    const torrent = await addTorrent(entry.torrent, peersEnabled());
    let lastBytes = 0;
    let lastMove = Date.now();
    const finished = new Promise((resolve, reject) => {
      if (torrent.done) resolve();
      torrent.on('done', resolve);
      torrent.on('error', reject);
      const iv = setInterval(() => {
        if (torrent.downloaded > lastBytes) { lastBytes = torrent.downloaded; lastMove = Date.now(); }
        else if (Date.now() - lastMove > STALL_MS) { clearInterval(iv); reject(new Error('stalled')); return; }
        if (onStatus) onStatus({ progress: torrent.progress, peers: torrent.numPeers, downSpeed: torrent.downloadSpeed, upBytes: torrent.uploaded, done: torrent.done });
        if (torrent.done) clearInterval(iv);
      }, 1000);
    });
    try { await finished; }
    catch (err) {
      try { torrent.destroy(); } catch (_) {}
      return { skipped: 'stalled' };
    }
    const blob = await torrent.files[0].blob();
    const digest = await sha256Hex(await blob.arrayBuffer());
    if (entry.sha256 && digest !== entry.sha256) {
      try { torrent.destroy(); } catch (_) {}
      throw new Error('p2p integrity check failed: sha256 mismatch');
    }
    await writeSegmented(url, blob);
    if (onStatus) onStatus({ progress: 1, peers: torrent.numPeers, upBytes: torrent.uploaded, done: true });
    return { p2p: true, bytes: blob.size, seeding: true };
  })();
  active.set(url, run);
  run.catch(() => {}).finally(() => { if (active.get(url) === run) active.delete(url); });
  return run;
}

export async function prefetchTier(Tiers, tierId, opts) {
  const o = typeof opts === 'function' ? { onStatus: opts } : (opts || {});
  const t = Tiers.TIERS[tierId];
  if (!t) return { skipped: 'unknown-tier' };
  if (!peersEnabled()) return { skipped: 'private-mode' };
  const base = await Tiers.resolveBase(t);
  const files = t.shards.slice();
  if (o.vision && t.visionShards) files.push(...t.visionShards);
  const out = [];
  for (const shard of files) {
    out.push(await ensureShardViaP2P(base + shard, o.onStatus));
  }
  return { base, results: out };
}

export async function seedShard(name, onStatus) {
  const man = await loadManifest();
  const entry = man[name];
  if (!entry) throw new Error('unknown shard: ' + name);
  const torrent = await addTorrent(entry.torrent, true);
  const iv = setInterval(() => {
    if (onStatus) onStatus({ progress: torrent.progress, peers: torrent.numPeers, downSpeed: torrent.downloadSpeed, upSpeed: torrent.uploadSpeed, upBytes: torrent.uploaded, done: torrent.done });
  }, 1000);
  return { torrent, stop: () => { clearInterval(iv); try { torrent.destroy(); } catch (_) {} } };
}

if (typeof window !== 'undefined') window.MentriaP2PModels = { ensureShardViaP2P, prefetchTier, seedShard, shardCached, entryFor, canTorrent, peersEnabled, setPeersEnabled };
