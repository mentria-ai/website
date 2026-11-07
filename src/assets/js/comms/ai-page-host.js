import { selfRoomFor, deviceInfo } from '/assets/js/comms/self.js';
import { filesRoomFor } from '/assets/js/comms/files.js';
import { AiHost } from '/assets/js/comms/ai-link.js';
import { answerTurns } from '/assets/js/ai-answer.js';
import { showHostBar } from '/assets/js/comms/ai-hostbar.js';
import { getIce, RELAY } from '/assets/js/comms/ice.js';
import { secretCopy } from '/assets/js/comms/identity.js';
import { TIERS } from '/assets/js/mentria-tiers.js';

const LOCK = 'mentria-ai-host';
const WEEK_CHECK_MS = 600000;
const ICE_MAX_MS = 3300000;
const fill = (tpl, vars) => String(tpl == null ? '' : tpl).replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m));

const realDeps = () => ({
  device: deviceInfo(null),
  isUnlocked: () => !!(window.MentriaIdentity && window.MentriaIdentity.isUnlocked && window.MentriaIdentity.isUnlocked()),
  locks: typeof navigator !== 'undefined' ? navigator.locks : null,
  getIce,
  derive: async () => {
    const sec = secretCopy();
    let self;
    try { self = await selfRoomFor(sec); } finally { sec.fill(0); }
    return filesRoomFor(self.roomName, self.b64Key);
  },
  joinRoom: async (cfg, id) => (await import('/assets/vendor/trystero-nostr.js')).joinRoom(cfg, id),
  setInterval: (fn, ms) => setInterval(fn, ms)
});

export const startPageHost = ({ getEngine, isBusy, onAnswered, strings = {}, deps } = {}) => {
  const d = deps || realDeps();
  const device = d.device;
  if (!device || device.kind === 'iphone' || device.kind === 'ipad') return { loading() {}, refresh: async () => {}, checkWeek: async () => {}, stop() {}, idle: () => Promise.resolve() };
  let room = null;
  let roomId = null;
  let joinedAt = 0;
  let host = null;
  let joining = null;
  let bar = null;
  let running = false;
  let waiters = [];
  let release = null;
  let loadingNow = false;

  const settle = () => {
    const w = waiters;
    waiters = [];
    for (const r of w) r();
  };

  const hidden = () => device.kind === 'android' && typeof document !== 'undefined' && document.visibilityState === 'hidden';

  const onActivity = ({ active, device: from, tier, stage }) => {
    if (!active) {
      running = false;
      if (bar) { bar.hide(); bar = null; }
      settle();
      if (onAnswered) { try { onAnswered(); } catch (_) {} }
      return;
    }
    running = true;
    if (typeof document === 'undefined') return;
    const who = (from && from.name) || '';
    const model = (TIERS[tier] && TIERS[tier].name) || String(tier || '');
    const text = stage === 'loading' ? fill(strings.loading, { model, device: who }) : fill(strings.answering, { device: who });
    if (bar) bar.update(text);
    else bar = showHostBar({ text, stopLabel: strings.stop, onStop: () => { if (host) host.stop(); } });
  };

  const takeLock = () => {
    if (release) return;
    if (!d.locks) { if (host) host.setEnabled(true); release = () => {}; return; }
    const held = new Promise((r) => { release = r; });
    d.locks.request(LOCK, { steal: true }, () => { if (host) host.setEnabled(true); return held; })
      .catch(() => {})
      .finally(() => { release = null; if (host) host.setEnabled(false); });
  };

  const dropLock = () => {
    if (!release) return;
    const r = release;
    release = null;
    r();
  };

  const leaveRoom = () => {
    if (host) { host.close(); host = null; }
    if (room) { try { room.leave(); } catch (_) {} room = null; }
    roomId = null;
    if (bar) { bar.hide(); bar = null; }
    running = false;
    settle();
  };

  const join = async (target) => {
    if (joining) return joining;
    joining = (async () => {
      const t = target || await d.derive();
      const iceServers = await d.getIce();
      if (!d.isUnlocked() || !getEngine()) return;
      const r = await d.joinRoom({ appId: 'mentria', relayConfig: { urls: [RELAY] }, rtcConfig: { iceServers }, password: t.password }, t.roomId);
      room = r;
      roomId = t.roomId;
      joinedAt = Date.now();
      host = new AiHost({
        device,
        page: 'ai-chat',
        listModels: async () => { const e = getEngine(); return e && !hidden() ? [{ tier: e.tier, state: 'loaded' }] : []; },
        load: async (tier) => { const e = getEngine(); if (e && e.tier === tier) return e; throw new Error('model-not-cached'); },
        answer: (ctx, ask, onText, signal) => answerTurns({ engine: ctx.engine, tier: ctx.tier, contextTokens: ctx.contextTokens, messages: ask.messages, pageLang: ask.params.pageLang, signal }, onText),
        isBusy: () => !!(isBusy && isBusy()),
        onActivity
      });
      host.setEnabled(!!release);
      host.bind(room, { ownsPeers: true });
    })();
    try { await joining; } finally { joining = null; }
  };

  const refresh = async () => {
    const engine = getEngine();
    if (!engine && !loadingNow) { leaveRoom(); dropLock(); return; }
    if (engine) loadingNow = false;
    takeLock();
    if (!engine || !d.isUnlocked()) { leaveRoom(); return; }
    if (!room) { try { await join(); } catch (_) { return; } }
    if (host) { host.setEnabled(!!release); host.advertise(); }
  };

  const checkWeek = async () => {
    if (!room || joining) return;
    let next;
    try { next = await d.derive(); } catch (_) { return; }
    if (next.roomId === roomId && Date.now() - joinedAt < ICE_MAX_MS) return;
    leaveRoom();
    try { await join(next); } catch (_) { return; }
    if (host) { host.setEnabled(!!release); host.advertise(); }
  };

  d.setInterval(() => { checkWeek(); }, WEEK_CHECK_MS);
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('pagehide', () => { leaveRoom(); dropLock(); });
    window.addEventListener('pageshow', (e) => { if (e.persisted) refresh(); });
  }
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('visibilitychange', () => { if (host && device.kind === 'android') host.advertise(); });

  return {
    loading() { loadingNow = true; takeLock(); },
    refresh,
    checkWeek,
    stop() { loadingNow = false; leaveRoom(); dropLock(); },
    idle: () => (running ? new Promise((r) => { waiters.push(r); }) : Promise.resolve())
  };
};
