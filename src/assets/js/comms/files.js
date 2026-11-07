import { b64urlDecode } from '/assets/js/comms/wire.js';

const MFg = () => {
  const mf = globalThis.MentriaMediaFormat;
  if (!mf) throw new Error('media format not loaded');
  return mf;
};

export const bfNew = (n) => MFg().bfNew(n);
export const bfSet = (b, i) => MFg().bfSet(b, i);
export const bfHas = (b, i) => MFg().bfHas(b, i);
export const bfCount = (b) => MFg().bfCount(b);
export const bfB64 = (b) => MFg().bfB64(b);
export const bfFrom = (s, n) => MFg().bfFrom(s, n);

export const nextPieces = (bf, n, inflight, want = 8) => {
  const out = [];
  const skip = inflight || new Set();
  for (let i = 0; i < n && out.length < want; i += 1) {
    if (!MFg().bfHas(bf, i) && !skip.has(i)) out.push(i);
  }
  return out;
};

const ID_RE = /^[A-Za-z0-9_-]{22}$/;
const B64_RE = /^[A-Za-z0-9+/]*={0,2}$/;
const KINDS = ['mac', 'iphone', 'ipad', 'android', 'windows', 'linux', 'device'];
const isId = (v) => typeof v === 'string' && ID_RE.test(v);
const idList = (v) => (Array.isArray(v) ? v.filter(isId).slice(0, 500) : []);

export const cleanFilesMsg = (action, d) => {
  if (!d || typeof d !== 'object') return null;
  if (action === 'fhi') {
    const files = d.caps && Number.isInteger(d.caps.files) ? d.caps.files : 0;
    const out = { caps: { files }, have: idList(d.have), want: idList(d.want) };
    const dev = d.device;
    if (dev && typeof dev === 'object' && typeof dev.id === 'string' && dev.id && dev.id.length <= 64) {
      out.device = { id: dev.id, name: String(dev.name || '').slice(0, 40), kind: KINDS.includes(dev.kind) ? dev.kind : 'device' };
    }
    return out;
  }
  if (!isId(d.id)) return null;
  if (action === 'fmq') return { id: d.id };
  if (action === 'fma') {
    if (!Number.isInteger(d.size) || d.size < 0 || d.size > 2147483648) return null;
    if (!Number.isInteger(d.pieceSize) || d.pieceSize < 1 || d.pieceSize > 16777216) return null;
    if (typeof d.hashes !== 'string' || d.hashes.length > 400000 || !B64_RE.test(d.hashes)) return null;
    return { id: d.id, size: d.size, pieceSize: d.pieceSize, hashes: d.hashes };
  }
  if (action === 'fwq') {
    if (!Array.isArray(d.i) || !d.i.length || d.i.length > 64) return null;
    if (!d.i.every((x) => Number.isInteger(x) && x >= 0 && x < 1000000)) return null;
    return { id: d.id, i: d.i.slice() };
  }
  if (action === 'fno') return ['missing', 'busy', 'locked'].includes(d.why) ? { id: d.id, why: d.why } : null;
  return null;
};

export const checkManifest = async ({ size, pieceSize, hashes }, mh) => {
  const MF = MFg();
  if (pieceSize !== MF.PIECE || !Array.isArray(hashes) || hashes.length !== MF.pieceCount(size)) return false;
  if (!hashes.every((h) => h instanceof Uint8Array && h.length === 32)) return false;
  return (await MF.manifestHash(hashes)) === mh;
};

const AUTO_BYTES = 25e6;
const RELAY_ASK_BYTES = 100e6;

export const acceptFor = ({ self, contact, kind, size } = {}) => {
  if (self) return 'auto';
  if (contact && (kind === 'photo' || kind === 'image' || kind === 'video') && Number(size) < AUTO_BYTES) return 'auto';
  return 'ask';
};

export const relayAsk = ({ self, viaRelay: relayed, size } = {}) => !self && !!relayed && Number(size) > RELAY_ASK_BYTES;

export const viaRelay = async (pc) => {
  if (!pc || typeof pc.getStats !== 'function') return null;
  let report;
  try { report = await pc.getStats(); } catch (_) { return null; }
  const all = new Map();
  report.forEach((v, k) => all.set((v && v.id) || k, v));
  let pair = null;
  for (const v of all.values()) if (v && v.type === 'transport' && v.selectedCandidatePairId) pair = all.get(v.selectedCandidatePairId) || pair;
  if (!pair) for (const v of all.values()) if (v && v.type === 'candidate-pair' && (v.selected || (v.nominated && v.state === 'succeeded'))) { pair = v; break; }
  if (!pair) return null;
  const l = all.get(pair.localCandidateId);
  const r = all.get(pair.remoteCandidateId);
  return !!((l && l.candidateType === 'relay') || (r && r.candidateType === 'relay'));
};

const sameBytes = (a, b) => {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
};

const ACTIONS = ['fhi', 'fmq', 'fma', 'fwq', 'fpc', 'fno'];
const MAX_ACTIVE = 3;
const IN_FLIGHT = 8;
const TIMEOUT_MS = 15000;
const SAVE_MS = 1000;
const STRIKES = 3;
const TICK_MS = 4000;
const ASK_AGAIN_MS = 10000;
const RATE_MS = 3000;
const PULLING = ['queued', 'moving'];

export class Transfers {
  constructor({ store, media, onChange, canServe, device, askRelay } = {}) {
    this._store = store;
    this._media = media;
    this._onChange = onChange || (() => {});
    this._canServe = canServe || (() => true);
    this._askRelay = askRelay || (() => false);
    this._device = device || null;
    this._threads = new Map();
    this._items = new Map();
    this._via = new Map();
    this._locked = false;
    this._timer = setInterval(() => this._tick(), TICK_MS);
  }

  _itemOf(rec) {
    const MF = MFg();
    const n = MF.pieceCount(rec.size);
    return {
      rec,
      n,
      bf: MF.bfFrom(rec.have || '', n),
      hashes: rec.hashes ? MF.splitHashes(MF.fromB64(rec.hashes)) : null,
      inflight: new Map(),
      strikes: new Map(),
      got: [],
      saveTimer: 0,
      askedAt: 0,
      finishing: false
    };
  }

  _track(rec) {
    const old = this._items.get(rec.id);
    if (old) {
      old.rec = Object.assign({}, old.rec, rec, { have: old.rec.have });
      return old;
    }
    const item = this._itemOf(rec);
    this._items.set(rec.id, item);
    return item;
  }

  async _load(threadId) {
    let recs = [];
    try { recs = await this._store.listMedia({ threadId }); } catch (_) { recs = []; }
    for (const rec of recs) if (!this._items.has(rec.id)) this._track(rec);
  }

  async attach(threadId, room, { peerFp } = {}) {
    if (this._threads.has(threadId)) this.detach(threadId);
    const act = {};
    for (const name of ACTIONS) act[name] = room.makeAction(name);
    const ctx = { room, act, peerFp: peerFp || (() => null), peers: new Map() };
    this._threads.set(threadId, ctx);
    const peer = (peerId) => {
      let p = ctx.peers.get(peerId);
      if (!p) { p = { have: new Set(), want: new Set(), caps: { files: 0 }, device: null }; ctx.peers.set(peerId, p); }
      return p;
    };
    act.fhi.onMessage = (d, m) => this._onHello(threadId, m.peerId, d, peer);
    act.fmq.onMessage = (d, m) => this._onManifestAsk(threadId, m.peerId, d);
    act.fma.onMessage = (d, m) => this._onManifest(threadId, m.peerId, d);
    act.fwq.onMessage = (d, m) => this._onWant(threadId, m.peerId, d);
    act.fpc.onMessage = (d, m) => this._onPiece(threadId, m.peerId, d, m.metadata);
    act.fno.onMessage = (d, m) => this._onNo(threadId, m.peerId, d);
    room.onPeerJoin = (peerId) => { peer(peerId); this._hello(threadId, peerId); };
    room.onPeerLeave = (peerId) => {
      ctx.peers.delete(peerId);
      for (const item of this._items.values()) {
        for (const [i, f] of item.inflight) if (f.threadId === threadId && f.peerId === peerId) item.inflight.delete(i);
      }
      this._onChange(null, { threadId, peerId, left: true });
      this._pump();
    };
    await this._load(threadId);
    if (this._threads.get(threadId) !== ctx) return;
    let known = [];
    try { known = Object.keys((room.getPeers && room.getPeers()) || {}); } catch (_) { known = []; }
    for (const peerId of known) { peer(peerId); this._hello(threadId, peerId); }
    this._pump();
  }

  detach(threadId) {
    const ctx = this._threads.get(threadId);
    if (!ctx) return;
    this._threads.delete(threadId);
    for (const item of this._items.values()) {
      for (const [i, f] of item.inflight) if (f.threadId === threadId) item.inflight.delete(i);
    }
  }

  peersOf(threadId) {
    const ctx = this._threads.get(threadId);
    return ctx ? Array.from(ctx.peers.entries()).map(([peerId, p]) => ({ peerId, have: Array.from(p.have), want: Array.from(p.want), caps: p.caps, device: p.device })) : [];
  }

  _lists(threadId) {
    const have = [];
    const want = [];
    for (const item of this._items.values()) {
      if (item.rec.threadId !== threadId) continue;
      if (item.rec.complete) have.push(item.rec.id);
      else if (PULLING.includes(item.rec.state)) want.push(item.rec.id);
    }
    return { have: have.slice(0, 500), want: want.slice(0, 500) };
  }

  _hello(threadId, peerId) {
    const ctx = this._threads.get(threadId);
    if (!ctx) return;
    const msg = Object.assign({ caps: { files: 2 } }, this._lists(threadId));
    if (this._device) msg.device = this._device;
    ctx.act.fhi.send(msg, peerId ? { target: peerId } : {}).catch(() => {});
  }

  announce(threadId) {
    if (this._threads.has(threadId)) this._hello(threadId);
  }

  async add(rec) {
    if (!rec || !rec.id) return null;
    const item = this._track(rec);
    this.announce(rec.threadId);
    this._pump();
    return item.rec;
  }

  forgetItems(ids) {
    for (const id of ids || []) {
      const item = this._items.get(id);
      if (!item) continue;
      clearTimeout(item.saveTimer);
      this._items.delete(id);
      this.announce(item.rec.threadId);
    }
  }

  get(id) {
    const item = this._items.get(id);
    return item ? Object.assign({}, item.rec) : null;
  }

  _onHello(threadId, peerId, raw, peer) {
    const d = cleanFilesMsg('fhi', raw);
    if (!d || !this._threads.has(threadId)) return;
    const p = peer(peerId);
    p.have = new Set(d.have);
    p.want = new Set(d.want);
    p.caps = d.caps;
    p.device = d.device || null;
    this._onChange(null, { threadId, peerId, hello: true, device: p.device, caps: p.caps });
    this._pump();
  }

  _holders(item) {
    const out = [];
    for (const [threadId, ctx] of this._threads) {
      if (threadId !== item.rec.threadId) continue;
      for (const [peerId, p] of ctx.peers) {
        if (!p.have.has(item.rec.id)) continue;
        if ((item.strikes.get(threadId + ':' + peerId) || 0) >= STRIKES) continue;
        out.push({ threadId, peerId, ctx });
      }
    }
    return out;
  }

  _checkVia(h) {
    const key = h.threadId + ':' + h.peerId;
    const now = Date.now();
    const at = this._via.get(key + '@') || 0;
    if (now - at < 10000) return;
    this._via.set(key + '@', now);
    let pc = null;
    try { pc = (h.ctx.room.getPeers && h.ctx.room.getPeers()[h.peerId]) || null; } catch (_) { pc = null; }
    viaRelay(pc).then((v) => {
      if (v === null) return;
      const before = this._via.get(key);
      this._via.set(key, v);
      if (before !== v) this._pump();
    }, () => {});
  }

  relayed(threadId, peerId) {
    return this._via.get(threadId + ':' + peerId);
  }

  async allowRelay(id) {
    const item = this._items.get(id);
    if (!item) return;
    item.rec.relayOk = true;
    delete item.rec.note;
    await this._save(item, true);
    this._onChange(id);
    this._pump();
  }

  _strike(item, threadId, peerId) {
    const k = threadId + ':' + peerId;
    item.strikes.set(k, (item.strikes.get(k) || 0) + 1);
  }

  _pump() {
    if (this._locked) return;
    const pulling = Array.from(this._items.values())
      .filter((it) => it.rec.role === 'in' && !it.rec.complete && PULLING.includes(it.rec.state) && !it.finishing)
      .sort((a, b) => (a.rec.state === 'moving' ? 0 : 1) - (b.rec.state === 'moving' ? 0 : 1) || (a.rec.updatedAt || 0) - (b.rec.updatedAt || 0));
    let active = 0;
    for (const item of pulling) {
      if (active >= MAX_ACTIVE) break;
      const holders = this._holders(item);
      if (!holders.length) continue;
      for (const h of holders) this._checkVia(h);
      const relayedOnly = holders.every((h) => this._via.get(h.threadId + ':' + h.peerId) === true);
      if (relayedOnly && !item.rec.relayOk && this._askRelay(item.rec)) {
        if (item.rec.note !== 'relay') {
          item.rec.note = 'relay';
          this._save(item, true);
          this._onChange(item.rec.id);
        }
        continue;
      }
      if (item.rec.note === 'relay') {
        delete item.rec.note;
        this._save(item, true);
      }
      item.via = relayedOnly ? 'relay' : 'direct';
      active += 1;
      if (item.rec.state !== 'moving') {
        item.rec.state = 'moving';
        this._save(item, true);
        this._onChange(item.rec.id);
      }
      if (!item.hashes) {
        if (Date.now() - item.askedAt > ASK_AGAIN_MS) {
          item.askedAt = Date.now();
          const h = holders[Math.floor(Math.random() * holders.length)];
          h.ctx.act.fmq.send({ id: item.rec.id }, { target: h.peerId }).catch(() => {});
        }
        continue;
      }
      const free = IN_FLIGHT - item.inflight.size;
      if (free <= 0) continue;
      const list = nextPieces(item.bf, item.n, new Set(item.inflight.keys()), free);
      if (!list.length) continue;
      const per = new Map();
      list.forEach((i, k) => {
        const h = holders[k % holders.length];
        const key = h.threadId + ':' + h.peerId;
        if (!per.has(key)) per.set(key, { h, idx: [] });
        per.get(key).idx.push(i);
        item.inflight.set(i, { threadId: h.threadId, peerId: h.peerId, at: Date.now() });
      });
      for (const { h, idx } of per.values()) h.ctx.act.fwq.send({ id: item.rec.id, i: idx }, { target: h.peerId }).catch(() => {});
    }
  }

  _onManifestAsk(threadId, peerId, raw) {
    const d = cleanFilesMsg('fmq', raw);
    const ctx = this._threads.get(threadId);
    if (!d || !ctx) return;
    const item = this._items.get(d.id);
    const no = () => ctx.act.fno.send({ id: d.id, why: this._locked ? 'locked' : 'missing' }, { target: peerId }).catch(() => {});
    if (!item || !item.hashes || item.rec.threadId !== threadId || this._locked || !this._canServe(item.rec, ctx.peerFp(peerId))) { no(); return; }
    const MF = MFg();
    ctx.act.fma.send({ id: d.id, size: item.rec.size, pieceSize: MF.PIECE, hashes: MF.b64(MF.joinHashes(item.hashes)) }, { target: peerId }).catch(() => {});
  }

  async _onManifest(threadId, peerId, raw) {
    const d = cleanFilesMsg('fma', raw);
    if (!d) return;
    const item = this._items.get(d.id);
    if (!item || item.hashes || item.rec.threadId !== threadId) return;
    const MF = MFg();
    let hashes = null;
    try { hashes = MF.splitHashes(MF.fromB64(d.hashes)); } catch (_) { hashes = null; }
    const ok = !!hashes && d.size === item.rec.size && await checkManifest({ size: item.rec.size, pieceSize: d.pieceSize, hashes }, item.rec.mh);
    if (!ok) {
      this._strike(item, threadId, peerId);
      item.askedAt = 0;
      this._pump();
      return;
    }
    if (item.hashes) return;
    item.hashes = hashes;
    item.rec.hashes = d.hashes;
    item.rec.pieceSize = MF.PIECE;
    await this._save(item, true);
    this._pump();
  }

  async _onWant(threadId, peerId, raw) {
    const d = cleanFilesMsg('fwq', raw);
    const ctx = this._threads.get(threadId);
    if (!d || !ctx) return;
    const item = this._items.get(d.id);
    const no = (why) => ctx.act.fno.send({ id: d.id, why }, { target: peerId }).catch(() => {});
    if (this._locked) { no('locked'); return; }
    if (!item || item.rec.threadId !== threadId || !this._canServe(item.rec, ctx.peerFp(peerId))) { no('missing'); return; }
    const MF = MFg();
    for (const i of d.i) {
      if (i >= item.n || !MF.bfHas(item.bf, i)) continue;
      let plain;
      try { plain = await this._media.readPiece(d.id, i); } catch (e) { no(e && e.code === 'locked' ? 'locked' : 'missing'); return; }
      if (!this._threads.has(threadId)) return;
      try { await ctx.act.fpc.send(plain, { target: peerId, metadata: { id: d.id, i } }); } catch (_) { return; }
      const now = Date.now();
      item.got.push([now, plain.length]);
      while (item.got.length && now - item.got[0][0] > RATE_MS) item.got.shift();
      this._onChange(d.id);
    }
  }

  async _onPiece(threadId, peerId, data, meta) {
    if (!meta || !isId(meta.id) || !Number.isInteger(meta.i) || meta.i < 0) return;
    const item = this._items.get(meta.id);
    if (!item || !item.hashes || item.rec.complete || item.rec.threadId !== threadId) return;
    const MF = MFg();
    const i = meta.i;
    if (i >= item.n || MF.bfHas(item.bf, i)) return;
    const plain = data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null;
    const bad = () => {
      this._strike(item, threadId, peerId);
      item.inflight.delete(i);
      this._pump();
    };
    if (!plain || plain.length !== MF.pieceLength(item.rec.size, i)) { bad(); return; }
    if (!sameBytes(await MF.sha256(plain), item.hashes[i])) { bad(); return; }
    if (MF.bfHas(item.bf, i) || !this._items.has(meta.id)) return;
    try {
      await this._media.writePiece(meta.id, i, plain);
    } catch (e) {
      item.inflight.delete(i);
      if (e && e.code === 'quota') {
        item.inflight.clear();
        item.rec.state = 'paused';
        item.rec.note = 'space';
        await this._save(item, true);
        this._onChange(item.rec.id);
      } else if (e && e.code === 'locked') {
        this.lock();
      }
      return;
    }
    if (!this._items.has(meta.id)) return;
    MF.bfSet(item.bf, i);
    item.inflight.delete(i);
    const now = Date.now();
    item.got.push([now, plain.length]);
    while (item.got.length && now - item.got[0][0] > RATE_MS) item.got.shift();
    if (MF.bfFull(item.bf, item.n)) { await this._finish(item); return; }
    this._save(item, false);
    this._onChange(item.rec.id);
    this._pump();
  }

  async _finish(item) {
    if (item.finishing) return;
    item.finishing = true;
    const MF = MFg();
    const ok = await checkManifest({ size: item.rec.size, pieceSize: MF.PIECE, hashes: item.hashes }, item.rec.mh);
    if (ok) {
      item.rec.complete = true;
      item.rec.state = 'done';
      delete item.rec.note;
    } else {
      item.rec.state = 'failed';
    }
    try { await this._media.closeFile(item.rec.id); } catch (_) {}
    await this._save(item, true);
    item.finishing = false;
    this._onChange(item.rec.id);
    this.announce(item.rec.threadId);
    this._pump();
  }

  _save(item, now) {
    const MF = MFg();
    const run = async () => {
      item.saveTimer = 0;
      if (!this._items.has(item.rec.id)) return;
      item.rec.have = MF.bfB64(item.bf);
      item.rec.updatedAt = Date.now();
      try { await this._store.putMedia(Object.assign({}, item.rec)); } catch (_) {}
    };
    if (now) {
      clearTimeout(item.saveTimer);
      return run();
    }
    if (!item.saveTimer) item.saveTimer = setTimeout(run, SAVE_MS);
    return Promise.resolve();
  }

  async flush() {
    await Promise.all(Array.from(this._items.values()).filter((it) => it.saveTimer).map((it) => this._save(it, true)));
  }

  _onNo(threadId, peerId, raw) {
    const d = cleanFilesMsg('fno', raw);
    const ctx = this._threads.get(threadId);
    if (!d || !ctx) return;
    const p = ctx.peers.get(peerId);
    if (p) p.have.delete(d.id);
    const item = this._items.get(d.id);
    if (item) for (const [i, f] of item.inflight) if (f.peerId === peerId && f.threadId === threadId) item.inflight.delete(i);
    this._pump();
  }

  _tick() {
    const now = Date.now();
    for (const item of this._items.values()) {
      for (const [i, f] of item.inflight) if (now - f.at > TIMEOUT_MS) item.inflight.delete(i);
    }
    this._pump();
  }

  async accept(id) {
    const item = this._items.get(id);
    if (!item || item.rec.complete) return;
    item.rec.state = 'queued';
    delete item.rec.note;
    await this._save(item, true);
    this.announce(item.rec.threadId);
    this._onChange(id);
    this._pump();
  }

  async pause(id) {
    const item = this._items.get(id);
    if (!item || item.rec.complete) return;
    item.inflight.clear();
    item.rec.state = 'paused';
    await this._save(item, true);
    this.announce(item.rec.threadId);
    this._onChange(id);
  }

  async retry(id) {
    const item = this._items.get(id);
    if (!item || item.rec.complete || !['paused', 'failed', 'offered'].includes(item.rec.state)) return;
    item.rec.state = 'queued';
    delete item.rec.note;
    item.strikes.clear();
    await this._save(item, true);
    this.announce(item.rec.threadId);
    this._onChange(id);
    this._pump();
  }

  stats(id) {
    const item = this._items.get(id);
    if (!item) return null;
    const MF = MFg();
    const now = Date.now();
    const bytes = item.got.filter(([t]) => now - t <= RATE_MS).reduce((a, [, b]) => a + b, 0);
    const have = MF.bfCount(item.bf);
    return { have, total: item.n, bytes: item.rec.complete ? item.rec.size : Math.min(item.rec.size, have * MF.PIECE), rate: bytes / (RATE_MS / 1000), via: item.via || null };
  }

  lock() {
    this._locked = true;
    for (const item of this._items.values()) item.inflight.clear();
  }

  unlock({ store, media } = {}) {
    if (store) this._store = store;
    if (media) this._media = media;
    this._locked = false;
    for (const threadId of this._threads.keys()) this.announce(threadId);
    this._pump();
  }

  stop() {
    clearInterval(this._timer);
    for (const item of this._items.values()) clearTimeout(item.saveTimer);
    this._threads.clear();
  }
}

const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
const base32 = (bytes) => {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
};

const keyBytes = (b64Key) => {
  const s = String(b64Key || '').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return b64urlDecode(s);
};

export const filesRoomFor = async (roomName, b64Key) => {
  const te = new TextEncoder();
  const base = await crypto.subtle.importKey('raw', keyBytes(b64Key), 'HKDF', false, ['deriveBits']);
  const idBits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: te.encode('mentria-files-room-v1'), info: te.encode(String(roomName)) }, base, 80));
  const pwBits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: te.encode('mentria-files-key-v1'), info: te.encode(String(roomName)) }, base, 256));
  let pw = '';
  for (const b of pwBits) pw += String.fromCharCode(b);
  return { roomId: 'mf-' + base32(idBits).slice(0, 16), password: btoa(pw) };
};

export class FilesRooms {
  constructor({ transfers, join, max = 6 } = {}) {
    this._t = transfers;
    this._join = join;
    this._max = max;
    this._rooms = new Map();
    this._paused = false;
    this._last = [];
    this._queue = Promise.resolve();
    this._leaving = new Map();
  }

  sync(threads) {
    this._last = Array.from(threads || []);
    const run = this._queue.then(() => this._sync(this._last));
    this._queue = run.catch(() => {});
    return run;
  }

  async _sync(threads) {
    if (this._paused) return;
    const pinned = threads.filter((t) => t.pinned);
    const rest = threads.filter((t) => !t.pinned).sort((a, b) => (b.priority || 0) - (a.priority || 0)).slice(0, this._max);
    const want = new Map(pinned.concat(rest).map((t) => [t.id, t]));
    for (const id of Array.from(this._rooms.keys())) if (!want.has(id)) this._leave(id);
    for (const t of want.values()) {
      if (this._paused) return;
      if (this._rooms.has(t.id)) continue;
      let ids;
      try { ids = await filesRoomFor(t.roomName, t.b64Key); } catch (_) { continue; }
      const leaving = this._leaving.get(ids.roomId);
      if (leaving) await leaving;
      if (this._paused || this._rooms.has(t.id)) continue;
      let room = null;
      try { room = await this._join(ids.roomId, ids.password, t); } catch (e) { console.warn('files room join failed:', e); room = null; }
      if (!room) continue;
      this._rooms.set(t.id, { room, roomId: ids.roomId, at: Date.now() });
      try { await this._t.attach(t.id, room, { peerFp: t.peerFp }); } catch (e) { console.warn('files room attach failed:', e); }
    }
  }

  _leave(id) {
    const r = this._rooms.get(id);
    if (!r) return;
    this._rooms.delete(id);
    try { this._t.detach(id); } catch (_) {}
    const p = Promise.resolve().then(() => r.room.leave()).catch(() => {});
    this._leaving.set(r.roomId, p);
    p.then(() => { if (this._leaving.get(r.roomId) === p) this._leaving.delete(r.roomId); });
  }

  joined() {
    return Array.from(this._rooms.keys());
  }

  joinedAt(id) {
    const r = this._rooms.get(id);
    return r ? r.at : 0;
  }

  roomOf(id) {
    const r = this._rooms.get(id);
    return r ? r.room : null;
  }

  pauseAll() {
    this._paused = true;
    for (const id of Array.from(this._rooms.keys())) this._leave(id);
  }

  resumeAll() {
    this._paused = false;
    return this.sync(this._last);
  }
}
