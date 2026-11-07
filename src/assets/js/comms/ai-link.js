import { b64urlEncode } from '/assets/js/comms/wire.js';

export const ACTIONS = { advert: 'fav', ask: 'faq', stream: 'fas', cancel: 'fax' };
export const STALL_MS = 20000;
export const BEAT_MS = 5000;
export const FLUSH_MS = 150;
export const ADVERT_MS = 30000;
export const HOST_TTL_MS = 75000;
export const QUEUE_MAX = 3;
export const TURNS_MAX = 40;
export const CHARS_MAX = 14000;
export const TEXT_MAX = 40000;

const HOSTS_KEY = 'mentria.comms.aihosts';
const KNOWN_MAX = 8;
const KINDS = ['mac', 'iphone', 'ipad', 'android', 'windows', 'linux', 'device'];
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const TIER_RE = /^[a-z0-9.-]{1,20}$/;

const realClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id)
};

const cleanDevice = (d) => {
  if (!d || typeof d.id !== 'string' || !d.id || d.id.length > 64) return null;
  return { id: d.id, name: String(d.name || '').slice(0, 40), kind: KINDS.includes(d.kind) ? d.kind : 'device' };
};

const cleanModels = (list) => (Array.isArray(list) ? list : [])
  .filter((m) => m && typeof m.tier === 'string' && TIER_RE.test(m.tier))
  .slice(0, 12)
  .map((m) => ({ tier: m.tier, state: m.state === 'loaded' ? 'loaded' : 'cached' }));

const newId = () => b64urlEncode(crypto.getRandomValues(new Uint8Array(12)));

export const trimForRequest = (turns) => {
  const list = (turns || []).filter((t) => t && (t.role === 'user' || t.role === 'assistant'));
  let end = list.length;
  while (end > 0 && list[end - 1].role !== 'user') end -= 1;
  const out = [];
  let total = 0;
  for (let i = end - 1; i >= 0 && out.length < TURNS_MAX; i -= 1) {
    const content = String(list[i].text == null ? '' : list[i].text).slice(0, TEXT_MAX);
    if (out.length && total + content.length > CHARS_MAX) break;
    out.unshift({ role: list[i].role, content });
    total += content.length;
  }
  return out;
};

export const cleanAsk = (d) => {
  if (!d || d.op !== 'ai' || typeof d.id !== 'string' || !ID_RE.test(d.id)) return null;
  if (typeof d.threadId !== 'string' || !d.threadId || d.threadId.length > 200) return null;
  if (typeof d.tier !== 'string' || !TIER_RE.test(d.tier)) return null;
  if (d.images !== undefined && !(Array.isArray(d.images) && d.images.length === 0)) return null;
  if (!Array.isArray(d.messages) || !d.messages.length || d.messages.length > TURNS_MAX) return null;
  let total = 0;
  const messages = [];
  for (const m of d.messages) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') return null;
    total += m.content.length;
    messages.push({ role: m.role, content: m.content });
  }
  if (total > CHARS_MAX + TEXT_MAX || messages[messages.length - 1].role !== 'user') return null;
  const params = d.params && typeof d.params === 'object' ? d.params : {};
  return {
    id: d.id,
    threadId: d.threadId,
    tier: d.tier,
    messages,
    params: { pageLang: typeof params.pageLang === 'string' ? params.pageLang.slice(0, 16) : '' },
    from: { device: cleanDevice(d.from && d.from.device) }
  };
};

export const knownHosts = (storage = globalThis.localStorage) => {
  try {
    const raw = JSON.parse(storage.getItem(HOSTS_KEY) || '{}');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out = {};
    for (const [id, x] of Object.entries(raw)) {
      const device = cleanDevice(x && x.device);
      if (device && device.id === id) out[id] = { device, models: cleanModels(x.models), at: Number(x.at) || 0 };
    }
    return out;
  } catch (_) {
    return {};
  }
};

export const rememberHosts = (hosts, storage = globalThis.localStorage) => {
  const map = knownHosts(storage);
  for (const h of hosts || []) {
    const device = cleanDevice(h && h.device);
    if (device) map[device.id] = { device, models: cleanModels(h.models), at: Number(h.at) || Date.now() };
  }
  const out = {};
  for (const x of Object.values(map).sort((a, b) => b.at - a.at).slice(0, KNOWN_MAX)) out[x.device.id] = x;
  try { storage.setItem(HOSTS_KEY, JSON.stringify(out)); } catch (_) {}
  return out;
};

const bindActions = (room) => {
  const act = {};
  for (const [k, name] of Object.entries(ACTIONS)) act[k] = room.makeAction(name);
  return act;
};

const abortedError = (e) => !!e && e.name === 'AbortError';

export class AiHost {
  constructor({ device, page, listModels, load, answer, isBusy, onActivity, onFailure, clock } = {}) {
    this._onFailure = onFailure || (() => {});
    this._device = cleanDevice(device);
    this._page = page === 'ai-chat' ? 'ai-chat' : 'comms';
    this._listModels = listModels || (async () => []);
    this._load = load;
    this._answer = answer;
    this._isBusy = isBusy || (() => false);
    this._onActivity = onActivity || (() => {});
    this._c = clock || realClock;
    this._enabled = true;
    this._closed = false;
    this._queue = [];
    this._run = null;
    this._act = null;
    this._advTimer = 0;
    this._pumpTimer = 0;
  }

  bind(room, { ownsPeers = false } = {}) {
    if (this._room && this._room !== room) {
      for (const job of this._queue) this._drop(job);
      this._queue = [];
      if (this._run) { this._run.gone = true; this._run.ctl.abort(); }
    }
    this._room = room;
    const act = bindActions(room);
    this._act = act;
    act.ask.onMessage = (d, meta) => { this._onAsk(d, meta && meta.peerId); };
    act.cancel.onMessage = (d, meta) => { this._onCancel(d, meta && meta.peerId); };
    if (ownsPeers) {
      room.onPeerJoin = (peerId) => this.peerJoined(peerId);
      room.onPeerLeave = (peerId) => this.peerLeft(peerId);
    }
    this._scheduleAdvert(0);
  }

  _send(key, data, peerId) {
    if (!this._act) return;
    try {
      const r = this._act[key].send(data, peerId ? { target: peerId } : undefined);
      if (r && typeof r.catch === 'function') r.catch(() => {});
    } catch (_) {}
  }

  _sendTo(job, data) {
    if (job.gone) return;
    job.lastSent = this._c.now();
    this._send('stream', data, job.peerId);
  }

  _scheduleAdvert(ms) {
    if (this._closed) return;
    this._c.clearTimeout(this._advTimer);
    this._advTimer = this._c.setTimeout(() => {
      this.advertise();
      this._scheduleAdvert(ADVERT_MS);
    }, ms);
  }

  busy() {
    return !!this._run || this._queue.length > 0;
  }

  async advertise(peerId) {
    if (!this._act || this._closed) return;
    let models = [];
    if (this._enabled) {
      try { models = cleanModels(await this._listModels()); } catch (_) { models = []; }
    }
    if (this._closed) return;
    this._send('advert', { v: 1, device: this._device, page: this._page, models, busy: this.busy() }, peerId);
  }

  peerJoined(peerId) {
    if (peerId) this.advertise(peerId);
  }

  peerLeft(peerId) {
    for (const job of this._queue.filter((j) => j.peerId === peerId)) this._drop(job);
    this._queue = this._queue.filter((j) => j.peerId !== peerId);
    if (this._run && this._run.peerId === peerId) {
      this._run.gone = true;
      this._run.ctl.abort();
    }
  }

  setEnabled(on) {
    const next = !!on;
    if (next === this._enabled) return;
    this._enabled = next;
    if (!next) {
      for (const job of this._queue) { this._sendTo(job, { op: 'err', id: job.ask.id, reason: 'not-hosting' }); this._drop(job); }
      this._queue = [];
      if (this._run) { this._run.reason = 'not-hosting'; this._run.ctl.abort(); }
    }
    this.advertise();
  }

  stop() {
    if (!this._run) return;
    this._run.reason = 'cancelled';
    this._run.ctl.abort();
  }

  close() {
    this._closed = true;
    this._c.clearTimeout(this._advTimer);
    this._c.clearTimeout(this._pumpTimer);
    for (const job of this._queue) this._drop(job);
    this._queue = [];
    if (this._run) { this._run.gone = true; this._run.ctl.abort(); }
  }

  _drop(job) {
    job.gone = true;
    this._c.clearTimeout(job.beat);
    this._c.clearTimeout(job.flushTimer);
  }

  _onAsk(d, peerId) {
    if (!peerId) return;
    const ask = cleanAsk(d);
    if (!ask) {
      if (d && typeof d.id === 'string' && ID_RE.test(d.id)) this._send('stream', { op: 'err', id: d.id, reason: 'bad-request' }, peerId);
      return;
    }
    if (!this._enabled || this._closed) { this._send('stream', { op: 'err', id: ask.id, reason: 'not-hosting' }, peerId); return; }
    if (this._queue.length >= QUEUE_MAX) { this._send('stream', { op: 'err', id: ask.id, reason: 'busy' }, peerId); return; }
    const job = { ask, peerId, ctl: new AbortController(), stage: 'queued', seq: 0, pending: '', reset: false, flushTimer: 0, beat: 0, lastSent: this._c.now(), gone: false, reason: null };
    this._queue.push(job);
    if (this._run || this._isBusy()) {
      this._sendWait(job);
      this._startBeat(job);
    }
    this.advertise();
    this._pump();
  }

  _onCancel(d, peerId) {
    if (!d || typeof d.id !== 'string') return;
    const queued = this._queue.find((j) => j.ask.id === d.id && j.peerId === peerId);
    if (queued) {
      this._sendTo(queued, { op: 'err', id: d.id, reason: 'cancelled' });
      this._drop(queued);
      this._queue = this._queue.filter((j) => j !== queued);
      this.advertise();
      return;
    }
    if (this._run && this._run.ask.id === d.id && this._run.peerId === peerId) {
      this._run.reason = 'cancelled';
      this._run.ctl.abort();
    }
  }

  _sendWait(job) {
    const ahead = this._queue.indexOf(job) + (this._run ? 1 : 0);
    this._sendTo(job, { op: 'wait', id: job.ask.id, reason: 'busy', ahead: Math.max(1, ahead) });
  }

  _startBeat(job) {
    if (job.beat || job.gone) return;
    const tick = () => {
      job.beat = 0;
      if (job.gone || job.done) return;
      if (job.stage === 'queued') this._sendWait(job);
      else if (job.stage === 'loading') this._sendTo(job, { op: 'wait', id: job.ask.id, reason: 'loading', ahead: 0 });
      else if (job.stage === 'answering' && this._c.now() - job.lastSent >= BEAT_MS) this._sendTo(job, { op: 'tok', id: job.ask.id, seq: job.seq++, text: '' });
      job.beat = this._c.setTimeout(tick, BEAT_MS);
    };
    job.beat = this._c.setTimeout(tick, BEAT_MS);
  }

  _pump() {
    if (this._run || this._closed || !this._queue.length) return;
    if (this._isBusy()) {
      this._c.clearTimeout(this._pumpTimer);
      this._pumpTimer = this._c.setTimeout(() => this._pump(), 500);
      return;
    }
    const job = this._queue.shift();
    this._run = job;
    this._work(job).catch(() => {}).then(() => {
      job.done = true;
      this._c.clearTimeout(job.beat);
      this._c.clearTimeout(job.flushTimer);
      if (this._run === job) this._run = null;
      this._onActivity({ active: false });
      this.advertise();
      for (const q of this._queue) this._sendWait(q);
      this._pump();
    });
  }

  _onText(job, delta, o) {
    if (job.gone) return;
    if (o && o.reset) { job.pending = String(delta || ''); job.reset = true; }
    else job.pending += String(delta || '');
    if (!job.flushTimer) job.flushTimer = this._c.setTimeout(() => { job.flushTimer = 0; this._flush(job); }, FLUSH_MS);
  }

  _flush(job) {
    this._c.clearTimeout(job.flushTimer);
    job.flushTimer = 0;
    if (job.gone || (!job.pending && !job.reset)) return;
    const msg = { op: 'tok', id: job.ask.id, seq: job.seq++, text: job.pending };
    if (job.reset) msg.reset = true;
    job.pending = '';
    job.reset = false;
    this._sendTo(job, msg);
  }

  async _work(job) {
    const { ask } = job;
    const device = ask.from.device;
    this._onActivity({ active: true, device, tier: ask.tier, stage: 'loading' });
    this._startBeat(job);
    job.stage = 'starting';
    let listed = [];
    try { listed = cleanModels(this._enabled ? await this._listModels() : []); } catch (_) { listed = []; }
    if (job.ctl.signal.aborted) { this._sendTo(job, { op: 'err', id: ask.id, reason: job.reason || 'cancelled' }); return; }
    if (!listed.length) { this._sendTo(job, { op: 'err', id: ask.id, reason: 'not-hosting' }); return; }
    if (!listed.some((m) => m.tier === ask.tier)) { this._sendTo(job, { op: 'err', id: ask.id, reason: 'tier-unavailable' }); return; }
    let ctx;
    try {
      ctx = await this._load(ask.tier, (stage) => {
        if (stage !== 'loading' || job.gone) return;
        job.stage = 'loading';
        this._sendTo(job, { op: 'wait', id: ask.id, reason: 'loading', ahead: 0 });
      });
    } catch (e) {
      if (job.ctl.signal.aborted) this._sendTo(job, { op: 'err', id: ask.id, reason: job.reason || 'cancelled' });
      else this._sendTo(job, { op: 'err', id: ask.id, reason: e && e.message === 'model-not-cached' ? 'tier-unavailable' : 'failed' });
      return;
    }
    if (job.ctl.signal.aborted) { this._sendTo(job, { op: 'err', id: ask.id, reason: job.reason || 'cancelled' }); return; }
    job.stage = 'answering';
    this._onActivity({ active: true, device, tier: ctx.tier, stage: 'answering' });
    try {
      const res = await this._answer(ctx, ask, (delta, o) => this._onText(job, delta, o), job.ctl.signal);
      this._flush(job);
      this._sendTo(job, { op: 'done', id: ask.id, seq: job.seq, stats: { tier: ctx.tier, tokens: Number(res && res.tokens) || 0, ms: Number(res && res.ms) || 0 } });
    } catch (e) {
      this._flush(job);
      const aborted = abortedError(e) || job.ctl.signal.aborted;
      if (!aborted) { try { this._onFailure(ctx, e); } catch (_) {} }
      this._sendTo(job, { op: 'err', id: ask.id, reason: aborted ? (job.reason || 'cancelled') : 'failed' });
    }
  }
}

export class AiClient {
  constructor({ onHosts, clock } = {}) {
    this._onHosts = onHosts || (() => {});
    this._c = clock || realClock;
    this._hosts = new Map();
    this._asks = new Map();
    this._act = null;
    this._pruneTimer = 0;
  }

  bind(room) {
    if (this._room && this._room !== room) {
      for (const a of Array.from(this._asks.values())) this._finish(a, 'gone', {});
      const had = this._hosts.size;
      this._hosts.clear();
      if (had) this._onHosts(this.hosts());
    }
    this._room = room;
    const act = bindActions(room);
    this._act = act;
    act.advert.onMessage = (d, meta) => { this._onAdvert(d, meta && meta.peerId); };
    act.stream.onMessage = (d, meta) => { this._onStream(d, meta && meta.peerId); };
    this._schedulePrune();
  }

  _schedulePrune() {
    this._c.clearTimeout(this._pruneTimer);
    this._pruneTimer = this._c.setTimeout(() => {
      const before = this._hosts.size;
      this.hosts();
      if (this._hosts.size !== before) this._onHosts(this.hosts());
      this._schedulePrune();
    }, ADVERT_MS);
  }

  hosts() {
    const now = this._c.now();
    for (const [peerId, h] of this._hosts) if (now - h.at > HOST_TTL_MS) this._hosts.delete(peerId);
    const best = new Map();
    const rank = (h) => (h.models.length ? 1 : 0);
    for (const h of this._hosts.values()) {
      const cur = best.get(h.device.id);
      if (!cur || rank(h) > rank(cur) || (rank(h) === rank(cur) && h.at > cur.at)) best.set(h.device.id, h);
    }
    return Array.from(best.values()).map((h) => Object.assign({}, h, { models: h.models.slice() }));
  }

  hostFor(deviceId) {
    return this.hosts().find((h) => h.device.id === deviceId) || null;
  }

  _onAdvert(d, peerId) {
    if (!peerId || !d || d.v !== 1) return;
    const device = cleanDevice(d.device);
    if (!device) return;
    this._hosts.set(peerId, { peerId, device, page: d.page === 'ai-chat' ? 'ai-chat' : 'comms', models: cleanModels(d.models), busy: !!d.busy, at: this._c.now() });
    this._onHosts(this.hosts());
  }

  peerLeft(peerId) {
    const changed = this._hosts.delete(peerId);
    for (const a of Array.from(this._asks.values())) if (a.peerId === peerId) this._finish(a, 'gone', {});
    if (changed) this._onHosts(this.hosts());
  }

  ask(peerId, { threadId, tier, messages, pageLang, from } = {}) {
    const id = newId();
    const listeners = { wait: [], tok: [], done: [], err: [], gone: [] };
    const a = { id, peerId, listeners, next: 0, held: new Map(), full: '', doneSeq: null, doneStats: null, stall: 0, over: false };
    this._asks.set(id, a);
    const handle = {
      id,
      on: (type, fn) => { if (listeners[type]) listeners[type].push(fn); return handle; },
      cancel: () => {
        if (a.over) return;
        this._send('cancel', { op: 'cancel', id }, peerId);
        this._finish(a, null);
      }
    };
    this._arm(a);
    this._send('ask', { op: 'ai', id, threadId, tier, messages, images: [], params: { pageLang: pageLang || '' }, from: from || {} }, peerId);
    return handle;
  }

  _send(key, data, peerId) {
    if (!this._act) return;
    try {
      const r = this._act[key].send(data, peerId ? { target: peerId } : undefined);
      if (r && typeof r.catch === 'function') r.catch(() => {});
    } catch (_) {}
  }

  _arm(a) {
    this._c.clearTimeout(a.stall);
    a.stall = this._c.setTimeout(() => this._finish(a, 'gone', {}), STALL_MS);
  }

  _emit(a, type, data) {
    for (const fn of a.listeners[type] || []) {
      try { fn(data); } catch (_) {}
    }
  }

  _finish(a, type, data) {
    if (a.over) return;
    a.over = true;
    this._c.clearTimeout(a.stall);
    this._asks.delete(a.id);
    if (type) this._emit(a, type, data);
  }

  _onStream(d, peerId) {
    if (!d || typeof d.id !== 'string') return;
    const a = this._asks.get(d.id);
    if (!a || a.over || a.peerId !== peerId) return;
    this._arm(a);
    if (d.op === 'wait') this._emit(a, 'wait', { reason: d.reason === 'loading' ? 'loading' : 'busy', ahead: Number(d.ahead) || 0 });
    else if (d.op === 'tok' && Number.isInteger(d.seq) && d.seq >= a.next) { a.held.set(d.seq, d); this._drain(a); }
    else if (d.op === 'done' && Number.isInteger(d.seq)) { a.doneSeq = d.seq; a.doneStats = d.stats || {}; this._drain(a); }
    else if (d.op === 'err') this._finish(a, 'err', { reason: String(d.reason || 'failed') });
  }

  _drain(a) {
    while (a.held.has(a.next)) {
      const m = a.held.get(a.next);
      a.held.delete(a.next);
      a.next += 1;
      const text = String(m.text == null ? '' : m.text);
      if (m.reset) a.full = text;
      else if (text) a.full += text;
      else continue;
      this._emit(a, 'tok', { text, reset: !!m.reset, full: a.full });
    }
    if (a.doneSeq !== null && a.next >= a.doneSeq) this._finish(a, 'done', { stats: a.doneStats, full: a.full });
  }
}
