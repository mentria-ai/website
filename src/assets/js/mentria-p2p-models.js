const TORRENTS = {
  'qwen3.5-0.8b-q4-tied.safetensors': {
    torrent: '/assets/torrents/qwen3.5-0.8b.torrent',
    sha256: '71b434498b4e5ce7a61d6bcbc79751013ae9750e7e0463fa98236154895cc162'
  }
};

export async function sha256Hex(buf) {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
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
  return TORRENTS[name] ? TORRENTS[name].torrent : null;
}

function entryFor(shardUrl) {
  return TORRENTS[shardUrl.split('/').pop().split('?')[0]] || null;
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
    const entry = entryFor(shardUrl);
    const digest = await sha256Hex(await blob.arrayBuffer());
    if (entry.sha256 && digest !== entry.sha256) {
      try { torrent.destroy(); } catch (_) {}
      throw new Error('p2p integrity check failed: sha256 mismatch');
    }
    const c = await caches.open(CACHE);
    await c.put(new Request(shardUrl), new Response(blob, { headers: { 'content-type': 'application/octet-stream', 'content-length': String(blob.size), 'x-mentria-sha256': digest } }));
    if (onStatus) onStatus({ progress: 1, peers: torrent.numPeers, upBytes: torrent.uploaded, done: true });
    return { p2p: true, bytes: blob.size, seeding: true, torrent };
  })();
  active.set(shardUrl, run);
  run.catch(() => active.delete(shardUrl));
  return run;
}

export async function seedShard(name, onStatus) {
  const path = TORRENTS[name] && TORRENTS[name].torrent;
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
