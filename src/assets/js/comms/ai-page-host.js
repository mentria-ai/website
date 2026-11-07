import { selfRoomFor, deviceInfo } from '/assets/js/comms/self.js';
import { filesRoomFor } from '/assets/js/comms/files.js';
import { AiHost } from '/assets/js/comms/ai-link.js';
import { answerTurns } from '/assets/js/ai-answer.js';
import { showHostBar } from '/assets/js/comms/ai-hostbar.js';
import { getIce, RELAY } from '/assets/js/comms/ice.js';
import { secretCopy } from '/assets/js/comms/identity.js';
import { TIERS } from '/assets/js/mentria-tiers.js';

const LOCK = 'mentria-ai-host';
const fill = (tpl, vars) => String(tpl == null ? '' : tpl).replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m));

export const startPageHost = ({ getEngine, isBusy, onAnswered, strings = {} } = {}) => {
  const device = deviceInfo(null);
  if (device.kind === 'iphone' || device.kind === 'ipad') return { refresh() {}, stop() {}, idle: () => Promise.resolve() };
  let room = null;
  let host = null;
  let joining = null;
  let bar = null;
  let running = false;
  let waiters = [];
  let release = null;

  const settle = () => {
    const w = waiters;
    waiters = [];
    for (const r of w) r();
  };

  const onActivity = ({ active, device: from, tier, stage }) => {
    if (!active) {
      running = false;
      if (bar) { bar.hide(); bar = null; }
      settle();
      if (onAnswered) { try { onAnswered(); } catch (_) {} }
      return;
    }
    running = true;
    const who = (from && from.name) || '';
    const model = (TIERS[tier] && TIERS[tier].name) || String(tier || '');
    const text = stage === 'loading' ? fill(strings.loading, { model, device: who }) : fill(strings.answering, { device: who });
    if (bar) bar.update(text);
    else bar = showHostBar({ text, stopLabel: strings.stop, onStop: () => { if (host) host.stop(); } });
  };

  const ready = () => !!(window.MentriaIdentity && window.MentriaIdentity.isUnlocked && window.MentriaIdentity.isUnlocked() && getEngine());

  const takeLock = () => {
    if (!host) return;
    if (!navigator.locks) { host.setEnabled(true); return; }
    if (release) return;
    const held = new Promise((r) => { release = r; });
    navigator.locks.request(LOCK, { steal: true }, () => { if (host) host.setEnabled(true); return held; })
      .catch(() => {})
      .finally(() => { release = null; if (host) host.setEnabled(false); });
  };

  const join = async () => {
    if (room) return;
    if (joining) return joining;
    joining = (async () => {
      const sec = secretCopy();
      let self;
      try { self = await selfRoomFor(sec); } finally { sec.fill(0); }
      const { roomId, password } = await filesRoomFor(self.roomName, self.b64Key);
      const [T, iceServers] = await Promise.all([import('/assets/vendor/trystero-nostr.js'), getIce()]);
      if (room || !ready()) return;
      room = T.joinRoom({ appId: 'mentria', relayConfig: { urls: [RELAY] }, rtcConfig: { iceServers }, password }, roomId);
      host = new AiHost({
        device,
        page: 'ai-chat',
        listModels: async () => { const e = getEngine(); return e ? [{ tier: e.tier, state: 'loaded' }] : []; },
        load: async (tier) => { const e = getEngine(); if (e && e.tier === tier) return e; throw new Error('model-not-cached'); },
        answer: (ctx, ask, onText, signal) => answerTurns({ engine: ctx.engine, tier: ctx.tier, contextTokens: ctx.contextTokens, messages: ask.messages, pageLang: ask.params.pageLang, signal }, onText),
        isBusy: () => !!(isBusy && isBusy()),
        onActivity
      });
      host.setEnabled(false);
      host.bind(room, { ownsPeers: true });
    })();
    try { await joining; } finally { joining = null; }
  };

  const leave = () => {
    if (release) { const r = release; release = null; r(); }
    if (host) { host.close(); host = null; }
    if (room) { try { room.leave(); } catch (_) {} room = null; }
    if (bar) { bar.hide(); bar = null; }
    running = false;
    settle();
  };

  const refresh = async () => {
    if (!ready()) { leave(); return; }
    try { await join(); } catch (_) { return; }
    if (!host) return;
    takeLock();
    host.advertise();
  };

  window.addEventListener('pagehide', leave);
  window.addEventListener('pageshow', (e) => { if (e.persisted) refresh(); });

  return {
    refresh,
    stop: leave,
    idle: () => (running ? new Promise((r) => { waiters.push(r); }) : Promise.resolve())
  };
};
