import * as db from './db.js';
import * as C from './crypto.js';
import * as L from './oplog.js';

const OPS_PER_PAGE = 2000;
const COMPACT_PAGES = 200;
const COMPACT_OPS = 5000;
const KEEP_CKPTS = 2;

function aadFor(p) {
  return 'mentria-finance|v1|' + p.id + '|' + p.kind + '|' + p.device + '|' + (p.kind === 'ops' ? p.seq : L.canonical(p.covers || {}));
}

export async function sealPage(dek, head, body) {
  const box = await C.sealPayload(dek, body, aadFor(head));
  return Object.assign({}, head, { z: box.z, iv: box.iv, ct: box.ct, bytes: box.bytes });
}

export async function openPage(dek, page) {
  return C.openPayload(dek, page, aadFor(page));
}

export function validPage(p) {
  if (!p || typeof p !== 'object') return false;
  if (typeof p.id !== 'string' || p.id.length > 64) return false;
  if (p.kind !== 'ops' && p.kind !== 'ckpt') return false;
  if (typeof p.device !== 'string' || !/^[0-9a-f]{16}$/.test(p.device)) return false;
  if (p.kind === 'ops' && !(Number.isSafeInteger(p.seq) && p.seq > 0)) return false;
  if (p.kind === 'ckpt' && (!p.covers || typeof p.covers !== 'object')) return false;
  if (!(p.iv instanceof Uint8Array) || !(p.ct instanceof Uint8Array)) return false;
  return true;
}

export function pageToWire(p) {
  const out = Object.assign({}, p, { iv: C.b64(p.iv), ct: C.b64(p.ct) });
  return out;
}

export function pageFromWire(w) {
  if (!w || typeof w.iv !== 'string' || typeof w.ct !== 'string') return null;
  try {
    return { id: String(w.id), kind: w.kind, device: w.device, seq: w.seq, covers: w.covers, created: String(w.created || ''), n: w.n | 0, hlc: w.hlc, z: w.z ? 1 : 0, bytes: w.bytes | 0, iv: C.unb64(w.iv), ct: C.unb64(w.ct) };
  } catch (_) { return null; }
}

function seqRanges(set, above) {
  const list = Array.from(set).filter((s) => s > above).sort((a, b) => a - b);
  const out = [];
  for (const s of list) {
    const last = out[out.length - 1];
    if (last && last[1] === s - 1) last[1] = s;
    else out.push([s, s]);
  }
  return out;
}

export class Engine extends EventTarget {
  constructor(opts) {
    super();
    this.root = opts.root;
    this.keys = opts.keys;
    this.deviceId = opts.deviceId;
    this.deviceName = opts.deviceName || '';
    this.state = L.createState();
    this.clock = L.createClock(this.deviceId);
    this.have = new Map();
    this.covers = {};
    this.seq = 0;
    this.readOnly = false;
    this.opsSinceCkpt = 0;
    this.opsPages = 0;
    this.badPages = [];
    this.foreignBase = false;
    this.closed = false;
    this.chain = Promise.resolve();
    this.channel = null;
    this.releaseLock = null;
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  markHave(device, seq) {
    let s = this.have.get(device);
    if (!s) { s = new Set(); this.have.set(device, s); }
    s.add(seq);
  }

  hasPage(device, seq) {
    if (seq <= (this.covers[device] || 0)) return true;
    const s = this.have.get(device);
    return !!(s && s.has(seq));
  }

  observeState() {
    for (const m of this.state.ents.values()) {
      for (const r of m.values()) {
        for (const k in r.c) this.clock.observe(r.c[k]);
        if (r.del) this.clock.observe(r.del);
      }
    }
  }

  async load() {
    const pages = await db.allPages();
    const meta = await db.getMetaMany(['seq', 'conflicts']);
    this.state = L.createState();
    this.have = new Map();
    this.covers = {};
    this.badPages = [];
    this.foreignBase = false;
    const ownFirst = (p) => (p.device === this.deviceId ? 1 : 0);
    const ckpts = pages.filter((p) => p.kind === 'ckpt').sort((a, b) => ownFirst(b) - ownFirst(a) || String(b.created).localeCompare(String(a.created)));
    for (const c of ckpts) {
      try {
        const snap = await openPage(this.keys.dek, c);
        L.mergeSnapshot(this.state, snap);
        this.covers = Object.assign({}, c.covers);
        this.foreignBase = c.device !== this.deviceId;
        break;
      } catch (_) { this.badPages.push(c.id); }
    }
    let opsCount = 0;
    let opsPages = 0;
    const list = pages.filter((p) => p.kind === 'ops').sort((a, b) => (a.device === b.device ? a.seq - b.seq : a.device < b.device ? -1 : 1));
    for (const p of list) {
      this.markHave(p.device, p.seq);
      if (p.seq <= (this.covers[p.device] || 0)) continue;
      try {
        const ops = await openPage(this.keys.dek, p);
        L.applyOps(this.state, ops, true);
        opsCount += ops.length;
        opsPages++;
      } catch (_) { this.badPages.push(p.id); }
    }
    this.state.conflicts = L.userConflicts(meta.conflicts);
    if (Array.isArray(meta.conflicts) && meta.conflicts.length !== this.state.conflicts.length) await db.setMeta({ conflicts: this.state.conflicts });
    this.observeState();
    let maxOwn = meta.seq || 0;
    const mine = this.have.get(this.deviceId);
    if (mine) for (const s of mine) if (s > maxOwn) maxOwn = s;
    if ((this.covers[this.deviceId] || 0) > maxOwn) maxOwn = this.covers[this.deviceId];
    this.seq = maxOwn;
    this.opsSinceCkpt = opsCount;
    this.opsPages = opsPages;
    this.state.version++;
    this.emit('change', { reason: 'load' });
  }

  serial(fn) {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => {});
    return run;
  }

  op(e, id, f, v) { return { t: this.clock.send(), e, id, f, v: v === undefined ? null : v }; }

  createOps(e, id, fields) {
    const clean = {};
    for (const k of Object.keys(fields)) if (fields[k] !== undefined && k !== 'id') clean[k] = fields[k];
    return [this.op(e, id, '*', clean)];
  }

  updateOps(e, id, fields) {
    const cur = L.get(this.state, e, id);
    const ops = [];
    for (const k of Object.keys(fields)) {
      if (k === 'id' || fields[k] === undefined) continue;
      if (cur && L.canonical(cur[k] === undefined ? null : cur[k]) === L.canonical(fields[k])) continue;
      ops.push(this.op(e, id, k, fields[k]));
    }
    return ops;
  }

  removeOps(e, id) { return [this.op(e, id, '~', null)]; }

  commit(ops) {
    return this.serial(async () => {
      if (this.closed) throw new Error('locked');
      if (this.readOnly) throw new Error('read-only');
      if (!ops || !ops.length) return 0;
      for (let i = 0; i < ops.length; i += OPS_PER_PAGE) {
        const chunk = ops.slice(i, i + OPS_PER_PAGE);
        const seq = this.seq + 1;
        const head = { id: C.randomId(), kind: 'ops', device: this.deviceId, seq, created: new Date().toISOString(), n: chunk.length, hlc: chunk[chunk.length - 1].t };
        const page = await sealPage(this.keys.dek, head, chunk);
        await db.writePage(page, { seq });
        this.seq = seq;
        this.markHave(this.deviceId, seq);
        L.applyOps(this.state, chunk, true);
        this.opsSinceCkpt += chunk.length;
        this.opsPages++;
        this.post({ t: 'page', id: page.id });
        this.emit('page', page);
      }
      this.emit('change', { reason: 'commit' });
      if (this.opsPages > COMPACT_PAGES || this.opsSinceCkpt > COMPACT_OPS) this.checkpoint().catch(() => {});
      return ops.length;
    });
  }

  summary() {
    const extra = {};
    for (const [d, s] of this.have) {
      const r = seqRanges(s, this.covers[d] || 0);
      if (r.length) extra[d] = r;
    }
    return { covers: Object.assign({}, this.covers), extra };
  }

  static peerHas(summary, device, seq) {
    if (!summary) return false;
    if (seq <= ((summary.covers || {})[device] || 0)) return true;
    const r = (summary.extra || {})[device];
    if (!r) return false;
    for (const [a, b] of r) if (seq >= a && seq <= b) return true;
    return false;
  }

  static peerContig(summary, device) {
    let n = ((summary && summary.covers) || {})[device] || 0;
    const r = ((summary && summary.extra) || {})[device] || [];
    for (const [a, b] of r) { if (a <= n + 1 && b > n) n = b; }
    return n;
  }

  async pagesFor(peerSummary) {
    const pages = await db.allPages();
    const out = [];
    let needCkpt = false;
    for (const d of Object.keys(this.covers)) {
      if (Engine.peerContig(peerSummary, d) < this.covers[d]) { needCkpt = true; break; }
    }
    if (needCkpt) {
      const own = pages.filter((p) => p.kind === 'ckpt' && p.device === this.deviceId).sort((a, b) => String(b.created).localeCompare(String(a.created)));
      if (own[0]) out.push(own[0]);
    }
    for (const p of pages) {
      if (p.kind !== 'ops') continue;
      if (Engine.peerHas(peerSummary, p.device, p.seq)) continue;
      out.push(p);
    }
    return out;
  }

  receive(pages) {
    return this.serial(async () => {
      if (this.closed) return { applied: 0 };
      let applied = 0;
      let merged = false;
      const fresh = [];
      const sorted = pages.slice().sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'ckpt' ? -1 : 1));
      for (const p of sorted) {
        if (!validPage(p)) continue;
        if (p.kind === 'ckpt') {
          try {
            const snap = await openPage(this.keys.dek, p);
            L.mergeSnapshot(this.state, snap);
            merged = true;
            for (const d of Object.keys(p.covers)) {
              const v = p.covers[d] | 0;
              if (/^[0-9a-f]{16}$/.test(d) && v > 0) {
                for (let s = (this.covers[d] || 0) + 1; s <= v; s++) this.markHave(d, s);
              }
            }
          } catch (_) {}
          continue;
        }
        if (this.hasPage(p.device, p.seq)) continue;
        let ops;
        try { ops = await openPage(this.keys.dek, p); } catch (_) { continue; }
        if (!Array.isArray(ops)) continue;
        const good = ops.filter(L.validOp);
        for (const op of good) this.clock.observe(op.t);
        L.applyOps(this.state, good, false);
        applied += good.length;
        fresh.push(p);
        this.markHave(p.device, p.seq);
      }
      if (fresh.length) await db.putPages(fresh);
      this.opsSinceCkpt += applied;
      this.opsPages += fresh.length;
      this.observeState();
      await db.setMeta({ conflicts: this.state.conflicts });
      if (merged && !this.readOnly) await this.checkpointNow();
      if (applied || merged) {
        this.post({ t: 'reload' });
        this.emit('change', { reason: 'sync' });
      }
      return { applied, merged };
    });
  }

  checkpoint() { return this.serial(() => this.checkpointNow()); }

  async checkpointNow() {
    if (this.readOnly || this.closed) return null;
    const covers = {};
    const devices = new Set(Object.keys(this.covers).concat(Array.from(this.have.keys())));
    for (const d of devices) {
      let n = this.covers[d] || 0;
      const s = this.have.get(d);
      while (s && s.has(n + 1)) n++;
      if (n > 0) covers[d] = n;
    }
    const snap = L.snapshot(this.state);
    snap.conflicts = [];
    const head = { id: C.randomId(), kind: 'ckpt', device: this.deviceId, covers, created: new Date().toISOString(), n: snap.recs.length };
    const page = await sealPage(this.keys.dek, head, snap);
    await db.writePage(page, { last_ckpt: page.id });
    const pages = await db.pageHeads();
    const drop = [];
    for (const p of pages) {
      if (p.kind === 'ops' && p.seq <= (covers[p.device] || 0)) drop.push(p.id);
    }
    const own = pages.filter((p) => p.kind === 'ckpt' && p.device === this.deviceId && p.id !== page.id).sort((a, b) => String(b.created).localeCompare(String(a.created)));
    for (const p of own.slice(KEEP_CKPTS - 1)) drop.push(p.id);
    for (const p of pages) if (p.kind === 'ckpt' && p.device !== this.deviceId) drop.push(p.id);
    await db.deletePages(drop);
    this.covers = covers;
    this.foreignBase = false;
    for (const [d, s] of this.have) for (const seq of Array.from(s)) if (seq <= (covers[d] || 0)) s.delete(seq);
    this.opsSinceCkpt = 0;
    this.opsPages = pages.filter((p) => p.kind === 'ops').length - drop.filter((id) => pages.some((p) => p.id === id && p.kind === 'ops')).length;
    this.post({ t: 'reload' });
    return page;
  }

  importSnapshot(snap, summary) {
    return this.serial(async () => {
      L.mergeSnapshot(this.state, snap);
      if (summary && typeof summary === 'object') {
        for (const d of Object.keys(summary.covers || {})) {
          if (!/^[0-9a-f]{16}$/.test(d)) continue;
          const n = summary.covers[d] | 0;
          for (let s = 1; s <= n && s <= 1000000; s++) this.markHave(d, s);
        }
        for (const d of Object.keys(summary.extra || {})) {
          if (!/^[0-9a-f]{16}$/.test(d) || !Array.isArray(summary.extra[d])) continue;
          for (const [a, b] of summary.extra[d]) for (let s = a | 0; s <= (b | 0) && s - a < 100000; s++) this.markHave(d, s);
        }
      }
      this.observeState();
      await this.checkpointNow();
      this.emit('change', { reason: 'restore' });
    });
  }

  async reloadFromDisk() {
    return this.serial(() => this.load());
  }

  async applyPageId(id) {
    return this.serial(async () => {
      const p = await db.getPage(id);
      if (!p || p.kind !== 'ops' || this.hasPage(p.device, p.seq)) return;
      try {
        const ops = await openPage(this.keys.dek, p);
        for (const op of ops) this.clock.observe(op.t);
        L.applyOps(this.state, ops, true);
        this.markHave(p.device, p.seq);
        if (p.device === this.deviceId && p.seq > this.seq) this.seq = p.seq;
        this.emit('change', { reason: 'tab' });
      } catch (_) {}
    });
  }

  attachTabs() {
    if (typeof BroadcastChannel !== 'function') return;
    this.channel = new BroadcastChannel('mentria-finance');
    this.channel.onmessage = (ev) => {
      const m = ev.data || {};
      if (m.t === 'page' && m.id) this.applyPageId(m.id);
      else if (m.t === 'reload') this.reloadFromDisk();
    };
  }

  post(msg) {
    if (this.channel) { try { this.channel.postMessage(msg); } catch (_) {} }
  }

  acquireWriter() {
    if (!navigator.locks || !navigator.locks.request) return Promise.resolve(true);
    return new Promise((resolve) => {
      navigator.locks.request('mentria-finance-writer', { ifAvailable: true }, (lock) => {
        if (!lock) { this.readOnly = true; resolve(false); return null; }
        this.readOnly = false;
        resolve(true);
        return new Promise((release) => { this.releaseLock = release; });
      }).catch(() => resolve(true));
    });
  }

  waitForWriter() {
    if (!navigator.locks || !navigator.locks.request) return;
    navigator.locks.request('mentria-finance-writer', (lock) => {
      if (this.closed) return null;
      this.readOnly = false;
      this.emit('writer', { writer: true });
      return new Promise((release) => { this.releaseLock = release; });
    }).catch(() => {});
  }

  async mergeInbox(build) {
    if (this.readOnly) return 0;
    const entries = await db.allInbox();
    if (!entries.length) return 0;
    const priv = await db.getMeta('inbox_priv');
    if (!priv) return 0;
    const opened = await C.openInbox(this.keys.inboxWrap, priv, entries);
    const ops = [];
    const ids = [];
    for (const o of opened) {
      ids.push(o.id);
      if (o.value) ops.push(...build(o.value));
    }
    if (ops.length) await this.commit(ops);
    await db.clearInbox(ids);
    return opened.filter((o) => o.value).length;
  }

  async saveConflicts() { await db.setMeta({ conflicts: this.state.conflicts }); }

  close() {
    this.closed = true;
    if (this.channel) { try { this.channel.close(); } catch (_) {} this.channel = null; }
    if (this.releaseLock) { try { this.releaseLock(); } catch (_) {} this.releaseLock = null; }
    if (this.root) this.root.fill(0);
    this.root = null;
    this.keys = null;
    this.state = L.createState();
  }
}
