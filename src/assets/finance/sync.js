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

async function join(appId, roomId) {
  const T = await import(TRYSTERO);
  const ice = await getIce();
  return T.joinRoom({ appId, relayConfig: { urls: [RELAY] }, rtcConfig: { iceServers: ice } }, roomId);
}

export function syncController(getCtx) {
  let room = null;
  let joining = false;
  let gen = 0;
  let actHello = null;
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

  async function hello(c) {
    return C.encryptJson(c.engine.keys.sync, { device: c.engine.deviceId, name: c.engine.deviceName || '', summary: c.engine.summary(), t: Date.now() }, 'mentria-finance|hello');
  }

  async function sendPages(pid, pages) {
    for (let i = 0; i < pages.length; i += BATCH) {
      const batch = pages.slice(i, i + BATCH).map(pageToWire);
      try { await actPages.send({ pages: batch }, { target: pid }); } catch (_) { return; }
    }
  }

  const onLocalPage = (e) => {
    const page = e.detail;
    for (const [pid, p] of peers) if (p.verified) actPages.send({ pages: [pageToWire(page)] }, { target: pid }).catch(() => {});
  };

  async function start() {
    const c = getCtx();
    if (!c.engine || c.engine.closed || room || joining) return;
    if (!others(c).length) { emit(); return; }
    const my = gen;
    joining = true;
    try {
      week = Math.floor(Date.now() / WEEK);
      const roomId = await C.weeklyRoom(c.engine.keys.roomSeed);
      if (my !== gen) return;
      const joined = await join('mentria-finance', roomId);
      if (my !== gen) { try { joined.leave(); } catch (_) {} return; }
      room = joined;
      actHello = room.makeAction('hello');
      actPages = room.makeAction('pages');
      actHello.onMessage = async (data, ctx) => {
        const cc = getCtx();
        if (!cc.engine || cc.engine.closed) return;
        let m;
        try { m = await C.decryptJson(cc.engine.keys.sync, data, 'mentria-finance|hello'); } catch (_) { return; }
        if (!m || typeof m.device !== 'string' || m.device === cc.engine.deviceId) return;
        const known = peers.get(ctx.peerId);
        peers.set(ctx.peerId, { device: m.device, name: String(m.name || '').slice(0, 60), verified: true });
        if (!known) { try { actHello.send(await hello(cc), { target: ctx.peerId }); } catch (_) {} }
        emit();
        const pages = await cc.engine.pagesFor(m.summary || {});
        if (pages.length) await sendPages(ctx.peerId, pages);
      };
      actPages.onMessage = async (data, ctx) => {
        const cc = getCtx();
        const p = peers.get(ctx.peerId);
        if (!p || !p.verified || !cc.engine || cc.engine.closed) return;
        const list = Array.isArray(data && data.pages) ? data.pages.map(pageFromWire).filter(Boolean) : [];
        if (!list.length) return;
        await cc.engine.receive(list);
        lastSync = new Date().toISOString();
        db.setMeta({ last_sync_at: lastSync }).catch(() => {});
        emit();
      };
      room.onPeerJoin = async (pid) => {
        const cc = getCtx();
        if (!cc.engine || cc.engine.closed) return;
        try { actHello.send(await hello(cc), { target: pid }); } catch (_) {}
      };
      room.onPeerLeave = (pid) => { peers.delete(pid); emit(); };
      engineRef = c.engine;
      engineRef.addEventListener('page', onLocalPage);
      clearInterval(weekTimer);
      weekTimer = setInterval(() => {
        if (Math.floor(Date.now() / WEEK) !== week) { stop(); start(); }
      }, 10 * 60 * 1000);
    } catch (e) {
      if (my === gen) room = null;
    } finally {
      if (my === gen) joining = false;
      emit();
    }
  }

  function stop() {
    gen++;
    joining = false;
    clearInterval(weekTimer);
    if (engineRef) { engineRef.removeEventListener('page', onLocalPage); engineRef = null; }
    if (room) { try { room.leave(); } catch (_) {} }
    room = null;
    peers.clear();
    emit();
  }

  api.start = start;
  api.stop = stop;
  api.poke = () => { if (!room) start(); };
  api.restart = () => { stop(); start(); };
  api.peers = () => Array.from(peers.values());
  api.status = () => {
    const live = Array.from(peers.values()).some((p) => p.verified);
    return { state: live ? 'live' : room ? 'waiting' : 'local', peers: api.peers(), lastSync };
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
      try { r.leave(); } catch (_) {}
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
        stop();
        start();
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
    setTimeout(() => { try { r.leave(); } catch (_) {} }, 1500);
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
