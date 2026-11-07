import { openMedia } from '/assets/js/comms/media.js';
import { Transfers, FilesRooms } from '/assets/js/comms/files.js';

const LOCK = 'mentria-comms-files';
const CHANNEL = 'mentria-comms-files';
const KNOCKS = 'mentria.comms.knocks';
const KNOCK_EVERY_MS = 3600000;
const KNOCK_AFTER_MS = 30000;
const TICK_MS = 15000;
const OUTBOX_DAYS = 30;
const PENDING_IN = ['queued', 'moving', 'paused'];

const newId = () => {
  const b = crypto.getRandomValues(new Uint8Array(16));
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const readKnocks = () => { try { return JSON.parse(localStorage.getItem(KNOCKS) || '{}') || {}; } catch (_) { return {}; } };
const writeKnocks = (v) => { try { localStorage.setItem(KNOCKS, JSON.stringify(v)); } catch (_) {} };

export const createAttach = ({ joinFilesRoom, threadInfo, knock, onChange, device, canServe, askRelay, pinned, onRoom, onHello } = {}) => {
  let store = null;
  let media = null;
  let transfers = null;
  let rooms = null;
  let holder = false;
  let release = null;
  let tick = 0;
  let stopped = true;
  const chan = typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL) : null;
  const changed = (id, extra) => { try { onChange && onChange(id, extra || null); } catch (_) {} };

  const pendingThreads = async () => {
    if (!store) return [];
    let recs = [];
    try { recs = await store.listMedia(); } catch (_) { return []; }
    const since = Date.now() - OUTBOX_DAYS * 86400000;
    const ids = new Map();
    for (const r of recs) {
      const pending = r.role === 'in' ? (!r.complete && PENDING_IN.includes(r.state)) : (r.complete && !r.delivered && (r.updatedAt || 0) > since);
      if (pending) ids.set(r.threadId, Math.max(ids.get(r.threadId) || 0, r.updatedAt || 0));
    }
    return Array.from(ids.entries()).map(([id, at]) => ({ id, at }));
  };

  let openThread = null;
  const refresh = async () => {
    if (!holder || !rooms || stopped) return;
    const list = await pendingThreads();
    if (openThread && !list.some((t) => t.id === openThread)) list.push({ id: openThread, at: Date.now() + 1 });
    for (const id of pinned || []) if (!list.some((t) => t.id === id)) list.push({ id, at: 0 });
    const out = [];
    for (const t of list) {
      let info = null;
      try { info = await threadInfo(t.id); } catch (_) { info = null; }
      if (!info || !info.roomName || !info.b64Key) continue;
      out.push(Object.assign({ id: t.id, priority: t.at, pinned: !!info.pinned }, info));
    }
    await rooms.sync(out);
  };

  const knockTick = async () => {
    if (!holder || !rooms || stopped || !knock) return;
    const now = Date.now();
    const knocks = readKnocks();
    for (const id of rooms.joined()) {
      if (now - rooms.joinedAt(id) < KNOCK_AFTER_MS) continue;
      if (transfers.peersOf(id).length) continue;
      if (now - (knocks[id] || 0) < KNOCK_EVERY_MS) continue;
      const pending = (await pendingThreads()).some((t) => t.id === id);
      if (!pending) continue;
      knocks[id] = now;
      writeKnocks(knocks);
      try { await knock(id); } catch (_) {}
    }
  };

  const adoptOffers = async (threadId, offers) => {
    const MF = globalThis.MentriaMediaFormat;
    let added = 0;
    for (const o of offers) {
      if (await store.getMedia(o.id).catch(() => null)) continue;
      const rec = {
        id: o.id, threadId, role: 'in', state: 'queued', complete: false, updatedAt: Date.now(),
        name: o.name, mime: o.mime, size: o.size, pieceSize: MF.PIECE, hashes: '', mh: o.mh,
        have: MF.bfB64(MF.bfNew(MF.pieceCount(o.size))), kind: o.kind, where: media.sync ? 'opfs' : 'idb'
      };
      try { await store.putMedia(rec); } catch (_) { continue; }
      await transfers.add(rec);
      added += 1;
    }
    if (added) refresh();
  };

  const onTransferChange = async (id, extra) => {
    if (extra && extra.hello && onHello) { try { onHello(extra.threadId, extra.peerId); } catch (_) {} }
    if (extra && extra.hello && extra.threadId && store && extra.offers && extra.offers.length && (pinned || []).includes(extra.threadId)) {
      await adoptOffers(extra.threadId, extra.offers);
    }
    if (extra && extra.hello && extra.threadId && store) {
      const peer = transfers.peersOf(extra.threadId).find((p) => p.peerId === extra.peerId);
      if (peer) {
        for (const rid of peer.have) {
          const rec = transfers.get(rid);
          if (!rec) continue;
          let dirty = false;
          if (rec.role === 'out' && !rec.delivered) { rec.delivered = true; dirty = true; }
          const dev = peer.device && peer.device.id;
          if (dev && !(rec.onDevices || []).includes(dev)) { rec.onDevices = (rec.onDevices || []).concat([dev]).slice(-20); dirty = true; }
          if (dirty) {
            await transfers.patch(rid, { delivered: !!rec.delivered, onDevices: rec.onDevices });
            changed(rid, { delivered: !!rec.delivered });
            if (chan) chan.postMessage({ op: 'change', id: rid });
          }
        }
      }
      changed(null, extra);
      return;
    }
    if (extra && extra.left) { changed(null, extra); return; }
    if (!id) return;
    const stats = transfers.stats(id);
    changed(id, { stats });
    if (chan) chan.postMessage({ op: 'change', id, stats });
    const rec = transfers.get(id);
    if (rec && rec.complete) refresh();
  };

  const becomeHolder = async () => {
    holder = true;
    const kindOf = (r) => (r.kind === 'image' || r.kind === 'video' || r.kind === 'file' ? r.kind : /^image\//i.test(r.mime || '') ? 'image' : /^video\//i.test(r.mime || '') ? 'video' : 'file');
    const offersFor = (tid) => ((pinned || []).includes(tid) && transfers ? transfers.completeIn(tid, 50).map((r) => ({ id: r.id, mh: r.mh, size: r.size, mime: r.mime, name: r.name, kind: kindOf(r) })) : null);
    transfers = new Transfers({ store, media, onChange: onTransferChange, canServe, device, askRelay, offersFor, onRoom, pinned });
    try { media.sweep({ known: new Set(await store.mediaIds()), graceMs: 600000 }); } catch (_) {}
    rooms = new FilesRooms({ transfers, join: (roomId, password, t) => joinFilesRoom(roomId, password, t) });
    clearInterval(tick);
    tick = setInterval(() => { refresh(); knockTick(); }, TICK_MS);
    await refresh();
  };

  const requestLock = () => {
    if (!(navigator.locks && navigator.locks.request)) { becomeHolder(); return; }
    navigator.locks.request(LOCK, () => new Promise((resolve) => {
      release = resolve;
      if (stopped) { resolve(); return; }
      becomeHolder();
    })).catch(() => {});
  };

  const forward = (op, id) => {
    if (holder && transfers) return true;
    if (chan) chan.postMessage({ op, id });
    return false;
  };

  if (chan) {
    chan.onmessage = async (e) => {
      const d = e.data || {};
      if (d.op === 'change') { changed(d.id, { stats: d.stats || null, remote: true }); return; }
      if (!holder || !transfers || !store) return;
      if (d.op === 'add' && d.id) {
        const rec = await store.getMedia(d.id).catch(() => null);
        if (rec) await transfers.add(rec);
        refresh();
      } else if (d.op === 'accept' && d.id) {
        const rec = await store.getMedia(d.id).catch(() => null);
        if (!rec) return;
        await transfers.add(rec);
        await transfers.accept(d.id);
        refresh();
      } else if (d.op === 'retry' && d.id) {
        const rec = await store.getMedia(d.id).catch(() => null);
        if (rec) await transfers.add(rec);
        await transfers.retry(d.id);
        refresh();
      } else if (d.op === 'relay' && d.id) {
        const rec = await store.getMedia(d.id).catch(() => null);
        if (rec) await transfers.add(rec);
        await transfers.allowRelay(d.id);
      } else if (d.op === 'pause' && d.id) {
        await transfers.pause(d.id);
      } else if (d.op === 'forget' && d.id) {
        transfers.forgetItems([d.id]);
        refresh();
      } else if (d.op === 'refresh') {
        refresh();
      }
    };
  }

  const api = {
    async start(s) {
      store = s;
      stopped = false;
      if (!media) media = await openMedia(store);
      else await media.unlock(store);
      if (holder && transfers) {
        transfers.unlock({ store, media });
        await rooms.resumeAll();
        await refresh();
      } else {
        requestLock();
      }
      return media;
    },
    halt() {
      stopped = true;
      clearInterval(tick);
      if (rooms) rooms.pauseAll();
      if (transfers) { transfers.flush(); transfers.stop(); }
      transfers = null;
      rooms = null;
      holder = false;
      if (release) { release(); release = null; }
      if (media) media.forget();
    },
    get media() { return media; },
    get holder() { return holder; },
    rec(id) { return transfers ? transfers.get(id) : null; },
    stats(id) { return transfers ? transfers.stats(id) : null; },
    peersOf(threadId) { return transfers ? transfers.peersOf(threadId) : []; },
    roomOf(threadId) { return rooms ? rooms.roomOf(threadId) : null; },
    setOpenThread(id) {
      openThread = id || null;
      if (holder) refresh();
      else if (chan) chan.postMessage({ op: 'refresh' });
    },
    async sendFile(threadId, file, { ranges, record, onProgress } = {}) {
      const id = newId();
      const r = await media.importFile(file, { threadId, id, ranges, onProgress, record });
      const rec = await store.getMedia(id);
      if (forward('add', id)) { await transfers.add(rec); refresh(); }
      return { id, mh: r.mh, size: r.size, rec };
    },
    async receive(threadId, items, { from, state } = {}) {
      const added = [];
      for (const it of items) {
        if (!it || !it.ref || !it.mh) continue;
        const known = await store.getMedia(it.ref).catch(() => null);
        if (known) continue;
        const MF = globalThis.MentriaMediaFormat;
        const rec = {
          id: it.ref, threadId, role: 'in', state: (typeof state === 'function' ? state(it) : state) || 'queued', complete: false, updatedAt: Date.now(),
          name: it.name || '', mime: it.mime || 'application/octet-stream', size: it.size, pieceSize: MF.PIECE,
          hashes: '', mh: it.mh, have: MF.bfB64(MF.bfNew(MF.pieceCount(it.size))), from: from || '',
          kind: it.type, w: it.w, h: it.h, duration: it.duration, hd: !!it.hd, thumb: it.thumb || it.poster || undefined, where: media.sync ? 'opfs' : 'idb'
        };
        try { await store.putMedia(rec); } catch (_) { continue; }
        added.push(rec);
        if (forward('add', rec.id)) await transfers.add(rec);
      }
      if (added.length) { if (holder) refresh(); }
      return added;
    },
    async accept(id) {
      const rec = store ? await store.getMedia(id).catch(() => null) : null;
      if (!rec) return;
      if (forward('accept', id)) { await transfers.add(rec); await transfers.accept(id); refresh(); }
    },
    async retry(id) { if (forward('retry', id)) { const rec = await store.getMedia(id).catch(() => null); if (rec) await transfers.add(rec); await transfers.retry(id); refresh(); } },
    async pause(id) { if (forward('pause', id)) await transfers.pause(id); },
    async allowRelay(id) { if (forward('relay', id)) { const rec = await store.getMedia(id).catch(() => null); if (rec) await transfers.add(rec); await transfers.allowRelay(id); } },
    relayed(threadId, peerId) { return transfers ? transfers.relayed(threadId, peerId) : null; },
    async removeMedia(ids) {
      const list = Array.from(ids || []);
      if (!list.length) return;
      if (transfers) transfers.forgetItems(list);
      else if (chan) list.forEach((id) => chan.postMessage({ op: 'forget', id }));
      if (media) await media.removeFiles(list);
      if (holder) refresh();
    },
    async wipeAll() {
      if (transfers) transfers.forgetItems(Array.from((await store.listMedia().catch(() => [])).map((r) => r.id)));
      if (media) await media.removeAll();
      if (holder) refresh();
    },
    refresh
  };
  return api;
};
