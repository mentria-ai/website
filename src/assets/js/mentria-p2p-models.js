const TORRENTS = {
  'qwen3.5-0.8b-q4-tied.safetensors': '/assets/torrents/qwen3.5-0.8b.torrent'
};
const CACHE = 'mentria-models';

let client = null;
const active = new Map();

async function getClient() {
  if (!client) {
    const mod = await import('/assets/js/webtorrent.min.js');
    const WT = mod.default || window.WebTorrent;
    client = new WT();
  }
  return client;
}

export function torrentFor(shardUrl) {
  const name = shardUrl.split('/').pop().split('?')[0];
  return TORRENTS[name] || null;
}

export async function shardCached(shardUrl) {
  try {
    const c = await caches.open(CACHE);
    if (await c.match(shardUrl)) return true;
    const sep = shardUrl.includes('?') ? '&' : '?';
    if (await c.match(shardUrl + sep + 'mentria_seg=meta')) return true;
  } catch (_) {}
  return false;
}

export function ensureShardViaP2P(shardUrl, onStatus) {
  const torrentPath = torrentFor(shardUrl);
  if (!torrentPath) return Promise.resolve({ skipped: 'no-torrent' });
  if (active.has(shardUrl)) return active.get(shardUrl);
  const run = (async () => {
    if (await shardCached(shardUrl)) return { skipped: 'cached', seeding: false };
    const cl = await getClient();
    const tbuf = new Uint8Array(await (await fetch(torrentPath)).arrayBuffer());
    const torrent = await new Promise((resolve, reject) => {
      const t = cl.add(tbuf, { announce: ['wss://relay.mentria.ai/tracker'] });
      t.on('ready', () => resolve(t));
      t.on('error', reject);
    });
    const finished = new Promise((resolve, reject) => {
      if (torrent.done) resolve();
      torrent.on('done', resolve);
      torrent.on('error', reject);
    });
    const iv = setInterval(() => {
      if (onStatus) onStatus({ progress: torrent.progress, peers: torrent.numPeers, downSpeed: torrent.downloadSpeed, upBytes: torrent.uploaded, done: torrent.done });
    }, 1000);
    try { await finished; } finally { clearInterval(iv); }
    const blob = await torrent.files[0].blob();
    const c = await caches.open(CACHE);
    await c.put(new Request(shardUrl), new Response(blob, { headers: { 'content-type': 'application/octet-stream', 'content-length': String(blob.size) } }));
    if (onStatus) onStatus({ progress: 1, peers: torrent.numPeers, upBytes: torrent.uploaded, done: true });
    return { p2p: true, bytes: blob.size, seeding: true, torrent };
  })();
  active.set(shardUrl, run);
  run.catch(() => active.delete(shardUrl));
  return run;
}

export async function seedShard(name, onStatus) {
  const path = TORRENTS[name];
  if (!path) throw new Error('unknown shard: ' + name);
  const cl = await getClient();
  const tbuf = new Uint8Array(await (await fetch(path)).arrayBuffer());
  const torrent = await new Promise((resolve, reject) => {
    const t = cl.add(tbuf, { announce: ['wss://relay.mentria.ai/tracker'] });
    t.on('ready', () => resolve(t));
    t.on('error', reject);
  });
  const iv = setInterval(() => {
    if (onStatus) onStatus({ progress: torrent.progress, peers: torrent.numPeers, downSpeed: torrent.downloadSpeed, upSpeed: torrent.uploadSpeed, upBytes: torrent.uploaded, done: torrent.done });
  }, 1000);
  return { torrent, stop: () => { clearInterval(iv); try { torrent.destroy(); } catch (_) {} } };
}

if (typeof window !== 'undefined') window.MentriaP2PModels = { ensureShardViaP2P, seedShard, shardCached, torrentFor };
