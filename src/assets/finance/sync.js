import * as C from './crypto.js';
import * as db from './db.js';
import * as L from './oplog.js';
import { pageToWire, pageFromWire } from './engine.js';

const TRYSTERO = '/assets/vendor/trystero-nostr.js';
const RELAY = 'wss://relay.mentria.ai';
const TURN_CRED_URL = 'https://relay.mentria.ai/turn-cred';
const FALLBACK_ICE = [{ urls: 'stun:turn.mentria.ai:3478' }];
const WEEK = 7 * 86400000;
const BATCH = 40;
const PAIR_TTL = 10 * 60 * 1000;

let iceCache = null;
let iceUntil = 0;
async function getIce() {
  if (iceCache && Date.now() < iceUntil) return iceCache;
  try {
    const r = await fetch(TURN_CRED_URL, { cache: 'no-store' });
    if (!r.ok) throw new Error(String(r.status));
    const d = await r.json();
    iceCache = d.iceServers || FALLBACK_ICE;
    iceUntil = Date.now() + Math.max(300, (d.ttl || 3600) - 120) * 1000;
  } catch (_) {
    iceCache = FALLBACK_ICE;
    iceUntil = Date.now() + 60000;
  }
  return iceCache;
}

const leaving = new Set();

function nextTask() {
  return new Promise((done) => setTimeout(done, 0));
}

function leaveRoom(r) {
  if (!r) return Promise.resolve();
  const p = Promise.resolve().then(() => r.leave()).catch(() => {}).then(nextTask);
  leaving.add(p);
  p.then(() => leaving.delete(p));
  return p;
}

async function join(appId, roomId, live) {
  const T = await import(TRYSTERO);
  const ice = await getIce();
  while (leaving.size) await Promise.all(Array.from(leaving));
  if (live && !live()) return null;
  return T.joinRoom({ appId, relayConfig: { urls: [RELAY] }, rtcConfig: { iceServers: ice } }, roomId);
}

export function syncController(getCtx) {
  let room = null;
  let joining = false;
  let gen = 0;
  let actPages = null;
  let week = null;
  let weekTimer = null;
  const peers = new Map();
  let lastSync = null;
  let engineRef = null;
  const api = { onStatus: null };

  function emit() { if (api.onStatus) { try { api.onStatus(); } catch (_) {} } }

  function others(c) {
    return c.ledger.devices().filter((d) => d.id !== c.engine.deviceId);
  }

  async function hello(c, ask) {
    return C.encryptJson(c.engine.keys.sync, { device: c.engine.deviceId, name: c.engine.deviceName || '', summary: c.engine.summary(), t: Date.now(), ask: !!ask }, 'mentria-finance|hello');
  }

  async function sendPages(act, pid, pages, live) {
    for (let i = 0; i < pages.length; i += BATCH) {
      if (!live()) return;
      const batch = pages.slice(i, i + BATCH).map(pageToWire);
      try { await act.send({ pages: batch }, { target: pid }); } catch (_) { return; }
    }
  }

  const onLocalPage = (e) => {
    const page = e.detail;
    if (!actPages) return;
    for (const [pid, p] of peers) if (p.verified) actPages.send({ pages: [pageToWire(page)] }, { target: pid }).catch(() => {});
  };

  async function start() {
    const c = getCtx();
    if (!c.engine || c.engine.closed || c.sync !== api || room || joining) return;
    if (!others(c).length) { emit(); return; }
    const my = gen;
    const live = () => my === gen;
    joining = true;
    emit();
    try {
      week = Math.floor(Date.now() / WEEK);
      const roomId = await C.weeklyRoom(c.engine.keys.roomSeed);
      if (!live()) return;
      const joined = await join('mentria-finance', roomId, live);
      if (!joined) return;
      if (!live()) { leaveRoom(joined); return; }
      room = joined;
      const actHello = room.makeAction('hello');
      const actRoomPages = room.makeAction('pages');
      actPages = actRoomPages;
      actHello.onMessage = async (data, ctx) => {
        const cc = getCtx();
        if (!live() || !cc.engine || cc.engine.closed) return;
        let m;
        try { m = await C.decryptJson(cc.engine.keys.sync, data, 'mentria-finance|hello'); } catch (_) { return; }
        if (!live() || !m || typeof m.device !== 'string' || m.device === cc.engine.deviceId) return;
        const known = peers.get(ctx.peerId);
        peers.set(ctx.peerId, { device: m.device, name: String(m.name || '').slice(0, 60), verified: true });
        if (!known || m.ask) { try { actHello.send(await hello(cc), { target: ctx.peerId }); } catch (_) {} }
        emit();
        const pages = await cc.engine.pagesFor(m.summary || {});
        if (pages.length) await sendPages(actRoomPages, ctx.peerId, pages, live);
      };
      actRoomPages.onMessage = async (data, ctx) => {
        const cc = getCtx();
        const p = peers.get(ctx.peerId);
        if (!live() || !p || !p.verified || !cc.engine || cc.engine.closed) return;
        const list = Array.isArray(data && data.pages) ? data.pages.map(pageFromWire).filter(Boolean) : [];
        if (!list.length) return;
        await cc.engine.receive(list);
        lastSync = new Date().toISOString();
        db.setMeta({ last_sync_at: lastSync }).catch(() => {});
        emit();
      };
      room.onPeerJoin = async (pid) => {
        const cc = getCtx();
        if (!live() || !cc.engine || cc.engine.closed) return;
        try { actHello.send(await hello(cc, true), { target: pid }); } catch (_) {}
      };
      room.onPeerLeave = (pid) => { if (!live()) return; peers.delete(pid); emit(); };
      engineRef = c.engine;
      engineRef.addEventListener('page', onLocalPage);
      clearInterval(weekTimer);
      weekTimer = setInterval(() => {
        if (Math.floor(Date.now() / WEEK) !== week) restart();
      }, 10 * 60 * 1000);
    } catch (e) {
      if (live() && room) { const r = room; room = null; actPages = null; leaveRoom(r); }
    } finally {
      if (live()) joining = false;
      emit();
    }
  }

  function stop() {
    gen++;
    joining = false;
    clearInterval(weekTimer);
    if (engineRef) { engineRef.removeEventListener('page', onLocalPage); engineRef = null; }
    const r = room;
    room = null;
    actPages = null;
    peers.clear();
    emit();
    return leaveRoom(r);
  }

  async function restart() {
    const left = stop();
    const my = gen;
    await left;
    if (my === gen) await start();
  }

  api.start = start;
  api.stop = stop;
  api.poke = () => { if (!room && !joining) start(); };
  api.restart = restart;
  api.peers = () => Array.from(peers.values());
  api.status = () => {
    const live = Array.from(peers.values()).some((p) => p.verified);
    return { state: live ? 'live' : room || joining ? 'waiting' : 'local', peers: api.peers(), lastSync };
  };
  db.getMeta('last_sync_at').then((v) => { if (v && !lastSync) lastSync = v; }).catch(() => {});

  api.pairHost = async (opts) => {
    const c = getCtx();
    const code = C.newPairCode();
    const d = await C.pairDerive(code);
    const r = await join('mentria-finance-pair', d.roomId);
    const hi = r.makeAction('hi');
    const give = r.makeAction('give');
    const done = r.makeAction('done');
    let peer = null;
    let finished = false;
    const timer = setTimeout(() => finish('expired'), PAIR_TTL);
    function finish(reason) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      leaveRoom(r);
      if (opts.onEnd) opts.onEnd(reason);
    }
    r.onPeerJoin = async (pid) => {
      try { hi.send(await C.encryptJson(d.key, { name: c.engine.deviceName || '' }, 'mentria-finance|pair-hi'), { target: pid }); } catch (_) {}
    };
    hi.onMessage = async (data, ctx) => {
      let m;
      try { m = await C.decryptJson(d.key, data, 'mentria-finance|pair-hi'); } catch (_) { return; }
      peer = { id: ctx.peerId, name: String((m && m.name) || '').slice(0, 60) };
      if (opts.onPeer) opts.onPeer(peer, d.confirm);
    };
    done.onMessage = async (data) => {
      let m;
      try { m = await C.decryptJson(d.key, data, 'mentria-finance|pair-done'); } catch (_) { return; }
      if (m && /^[0-9a-f]{16}$/.test(m.device || '')) {
        const cc = getCtx();
        const now = new Date().toISOString();
        await cc.commit(cc.engine.createOps('device', m.device, { name: String(m.name || '').slice(0, 60), created: now, last_seen: now }));
        finish('done');
        api.poke();
      }
    };
    return {
      code,
      approve: async () => {
        if (!peer) return false;
        const cc = getCtx();
        const snap = L.snapshot(cc.engine.state);
        snap.conflicts = [];
        const payload = { root: C.b64(cc.engine.root), snapshot: snap, summary: cc.engine.summary(), name: cc.engine.deviceName || '', device: cc.engine.deviceId };
        await give.send(await C.encryptJson(d.key, payload, 'mentria-finance|pair-give'), { target: peer.id });
        return true;
      },
      cancel: () => finish('cancelled')
    };
  };

  return api;
}

export async function pairJoin(code, opts) {
  const d = await C.pairDerive(code);
  const r = await join('mentria-finance-pair', d.roomId);
  const hi = r.makeAction('hi');
  const give = r.makeAction('give');
  const done = r.makeAction('done');
  let hostId = null;
  let finished = false;
  const timer = setTimeout(() => end('expired'), PAIR_TTL);
  function end(reason) {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    setTimeout(() => leaveRoom(r), 1500);
    if (opts.onEnd) opts.onEnd(reason);
  }
  r.onPeerJoin = async (pid) => {
    try { hi.send(await C.encryptJson(d.key, { name: opts.name || '' }, 'mentria-finance|pair-hi'), { target: pid }); } catch (_) {}
  };
  hi.onMessage = async (data, ctx) => {
    try { await C.decryptJson(d.key, data, 'mentria-finance|pair-hi'); } catch (_) { return; }
    hostId = ctx.peerId;
    if (opts.onPeer) opts.onPeer(d.confirm);
  };
  give.onMessage = async (data, ctx) => {
    let payload;
    try { payload = await C.decryptJson(d.key, data, 'mentria-finance|pair-give'); } catch (_) { return; }
    hostId = ctx.peerId;
    if (opts.onPayload) await opts.onPayload(payload);
  };
  return {
    confirm: d.confirm,
    sendDone: async (device, name) => {
      if (!hostId) return;
      try { await done.send(await C.encryptJson(d.key, { device, name }, 'mentria-finance|pair-done'), { target: hostId }); } catch (_) {}
      end('done');
    },
    cancel: () => end('cancelled')
  };
}
