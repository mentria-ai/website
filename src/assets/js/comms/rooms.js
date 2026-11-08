import { parseHash, isDmRoom } from '/assets/js/comms/wire.js';

const EPH_KEY = 'mentria.comms.ephkeys';
const EPH_MAX = 20;

const kvOf = (v) => (v === 2 ? 2 : 1);

export const resolveHash = (hash, saved, eph) => {
  if (!hash || hash === '#') return null;
  let parsed;
  try { parsed = parseHash(hash); } catch (_) { return null; }
  const room = parsed && parsed.room;
  if (!room || isDmRoom(room)) return null;
  const list = Array.isArray(saved) ? saved : [];
  const entry = list.find((r) => r && r.room === room) || null;
  if (parsed.b64Key) {
    const kv = entry && entry.key === parsed.b64Key ? kvOf(entry.kv) : 1;
    return { room, key: parsed.b64Key, kv, imported: true };
  }
  if (entry && entry.key) return { room, key: entry.key, kv: kvOf(entry.kv), imported: false };
  const mem = eph && eph.get(room);
  if (mem && mem.key) return { room, key: mem.key, kv: kvOf(mem.kv), imported: false };
  return { room, key: null, kv: 1, imported: false };
};

export const ephKeys = (storage) => {
  const read = () => {
    if (!storage) return [];
    try {
      const v = JSON.parse(storage.getItem(EPH_KEY) || '[]');
      return Array.isArray(v) ? v.filter((x) => x && typeof x.room === 'string' && typeof x.key === 'string') : [];
    } catch (_) { return []; }
  };
  const write = (list) => {
    if (!storage) return;
    try { storage.setItem(EPH_KEY, JSON.stringify(list.slice(0, EPH_MAX))); } catch (_) {}
  };
  return {
    get: (room) => {
      const hit = read().find((x) => x.room === room);
      return hit ? { key: hit.key, kv: kvOf(hit.kv) } : null;
    },
    set: (room, key, kv) => {
      if (!room || !key) return;
      write([{ room, key, kv: kvOf(kv) }].concat(read().filter((x) => x.room !== room)));
    }
  };
};
