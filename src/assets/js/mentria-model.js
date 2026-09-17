import * as Tiers from '/assets/js/mentria-tiers.js';
import { createActivityStrip, tierInfo } from '/assets/js/mentria-activity.js';

const IS_MOBILE = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const PROBE_TIMEOUT = IS_MOBILE ? 120000 : 60000;
const PROBE_STILL_MS = 20000;
const READY_LINGER = 900;

const DEFAULT_COPY = {
  checking: 'Checking your device…',
  testing: 'Testing the {name} model…',
  still: 'Still working — the first run compiles shaders and can take a minute or two on phones.',
  ready: '✓ {name} ready',
  degrade: '{from} isn’t supported on this device — using {to}',
  failed: 'Couldn’t run an on-device model on this device.',
  chooseTitle: 'Choose your AI model',
  chooseHint: 'Your device can run up to {name}. Bigger models are smarter but download more.',
  choosePitch: 'Runs fully on your device — private, free, and works offline after the one-time download.',
  chooseSample: 'Ask things like “explain quantum computing simply” and the answer is generated on your own hardware.',
  chooseNotNow: 'Not now',
  continueBg: 'Continue in background',
  stop: 'Stop',
  stoppedTitle: 'Stopped',
  stoppedHint: 'Try a smaller model, or come back later.',
  tryTier: 'Try {name}',
  failedTitle: '{name} didn’t run on this device',
  failedHint: 'You can try a smaller model or skip for now.'
};

function t(key, vars) {
  let s = DEFAULT_COPY[key];
  try {
    if (window.MentriaI18n && window.MentriaI18n.t) {
      const v = window.MentriaI18n.t('tools.model.' + key);
      if (v != null) s = v;
    }
  } catch (_) {}
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m)) : s;
}

export class NoWebGpuError extends Error {
  constructor() { super('no-webgpu'); this.name = 'NoWebGpuError'; }
}

function tierName(id) { return (Tiers.TIERS[id] && Tiers.TIERS[id].name) || id; }
function tierSize(id) { return (Tiers.TIERS[id] && Tiers.TIERS[id].sizeLabel) || ''; }

function ensureOverlayStyle() {
  if (document.getElementById('mm-gate-style')) return;
  const st = document.createElement('style');
  st.id = 'mm-gate-style';
  st.textContent = '.mm-gate{position:fixed;inset:0;z-index:10001;display:flex;align-items:center;justify-content:center;padding:1rem;background:rgba(0,0,0,.55);backdrop-filter:blur(4px);font-family:var(--font-mono,monospace)}.mm-gate[hidden]{display:none}.mm-gate__card{position:relative;background:var(--term-bg-raised,#0d1014);border:1px solid var(--term-border-strong,#2a3138);border-radius:var(--radius-md,10px);padding:1.1rem 1.25rem 1.15rem;width:100%;max-width:24rem;display:flex;flex-direction:column;gap:.7rem}.mm-gate__title{font-size:.9rem;color:var(--accent,#6ef3c5)}.mm-gate__strip{display:flex;flex-direction:column}.mm-gate__strip:empty{display:none}.mm-gate__strip .es{border-bottom:0;padding:.2rem 0 .3rem}.mm-gate__detail{font-size:.75rem;color:var(--term-muted,#9ba6b1);display:flex;flex-direction:column;gap:.45rem}.mm-gate__detail:empty{display:none}.mm-gate__hint-line{font-size:.72rem;color:var(--term-subtle,var(--term-muted,#9ba6b1));line-height:1.5}.mm-gate__hint-line[hidden]{display:none}.mm-gate__actions{display:flex;flex-direction:column;gap:.5rem;margin-top:.2rem}.mm-gate__actions[hidden]{display:none}.mm-gate__actions--row{flex-direction:row;align-items:stretch}.mm-gate__actions--row .mm-gate__btn{flex:1 1 auto;align-items:center;justify-content:center;text-align:center;line-height:1.35;padding:.55rem .7rem}.mm-gate__actions--row .mm-gate__btn--stop{flex:0 0 auto;min-width:5.5rem}.mm-gate__btn{font:inherit;font-size:.8rem;text-align:left;background:var(--term-bg,#0a0d10);border:1px solid var(--term-border-strong,#2a3138);color:var(--term-fg-strong,#e6edf3);padding:.6rem .8rem;border-radius:var(--radius-sm,8px);cursor:pointer;display:flex;justify-content:space-between;gap:1rem}.mm-gate__btn:hover{border-color:var(--accent,#6ef3c5);color:var(--accent,#6ef3c5)}.mm-gate__btn-size{color:var(--term-muted,#9ba6b1);font-size:.78rem}.mm-gate__btn--stop{color:var(--syn-pink,#f472b6);border-color:rgba(244,114,182,.5)}.mm-gate__btn--stop:hover{border-color:var(--syn-pink,#f472b6);color:var(--syn-pink,#f472b6)}.mm-gate__pitch{color:var(--term-fg-strong,#e6edf3)}.mm-gate__sample{color:var(--term-muted,#9ba6b1);font-style:italic}.mm-gate__hint{color:var(--term-muted,#9ba6b1)}.mm-gate__btn--ghost{justify-content:center;color:var(--term-muted,#9ba6b1);border-style:dashed}';
  document.head.appendChild(st);
}

let gateStrip = null;

function overlay() {
  let el = document.getElementById('mm-gate');
  if (el) return el;
  ensureOverlayStyle();
  el = document.createElement('div');
  el.id = 'mm-gate';
  el.className = 'mm-gate';
  el.hidden = true;
  const card = document.createElement('div');
  card.className = 'mm-gate__card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-labelledby', 'mm-gate-title');
  const title = document.createElement('div');
  title.className = 'mm-gate__title';
  title.id = 'mm-gate-title';
  title.setAttribute('role', 'heading');
  title.setAttribute('aria-level', '2');
  const strip = document.createElement('div');
  strip.className = 'mm-gate__strip';
  const detail = document.createElement('div');
  detail.className = 'mm-gate__detail';
  detail.setAttribute('role', 'status');
  detail.setAttribute('aria-live', 'polite');
  const hint = document.createElement('div');
  hint.className = 'mm-gate__hint-line';
  hint.hidden = true;
  const actions = document.createElement('div');
  actions.className = 'mm-gate__actions';
  actions.hidden = true;
  card.append(title, strip, detail, hint, actions);
  el.appendChild(card);
  document.body.appendChild(el);
  gateStrip = createActivityStrip(strip, { panel: false });
  return el;
}

function setTitle(el, title) { el.querySelector('.mm-gate__title').textContent = title; }
function setDetail(el, text) {
  const d = el.querySelector('.mm-gate__detail');
  d.textContent = text || '';
}
function setHint(el, text) {
  const h = el.querySelector('.mm-gate__hint-line');
  h.textContent = text || '';
  h.hidden = !text;
}
function clearActions(el) {
  const a = el.querySelector('.mm-gate__actions');
  a.innerHTML = '';
  a.hidden = true;
  a.classList.remove('mm-gate__actions--row');
  return a;
}
function button(label, cls, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'mm-gate__btn' + (cls ? ' ' + cls : '');
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function trapFocus(el, actions, onDismiss) {
  const prevFocus = document.activeElement;
  const inerted = Array.prototype.slice.call(document.body.children).filter((c) => c !== el && !c.hasAttribute('inert'));
  inerted.forEach((c) => c.setAttribute('inert', ''));
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); onDismiss(); return; }
    if (e.key === 'Tab') {
      const btns = Array.prototype.slice.call(actions.querySelectorAll('button'));
      if (!btns.length) return;
      const first = btns[0], last = btns[btns.length - 1];
      if (!actions.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  const onBackdrop = (e) => { if (e.target === el) onDismiss(); };
  document.addEventListener('keydown', onKey);
  el.addEventListener('click', onBackdrop);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    document.removeEventListener('keydown', onKey);
    el.removeEventListener('click', onBackdrop);
    inerted.forEach((c) => c.removeAttribute('inert'));
    if (prevFocus && prevFocus.focus) { try { prevFocus.focus(); } catch (_) {} }
  };
}

function showCheck(candidate, ctl, cached) {
  const el = overlay();
  setTitle(el, t('checking'));
  setDetail(el, t('testing', { name: tierName(candidate) }));
  setHint(el, '');
  gateStrip.setTier(Object.assign(tierInfo(Tiers.TIERS[candidate], candidate), { cached: !!cached }));
  gateStrip.phase('testing', { name: tierName(candidate) });
  const actions = clearActions(el);
  actions.classList.add('mm-gate__actions--row');
  actions.hidden = false;
  const dismiss = () => { ctl.background(); };
  actions.appendChild(button(t('continueBg'), 'mm-gate__btn--ghost', dismiss));
  actions.appendChild(button(t('stop'), 'mm-gate__btn--stop', () => ctl.stop()));
  el.hidden = false;
  return trapFocus(el, actions, dismiss);
}

function offerChoice(choices, titleText, detailNodes, labelFor) {
  const el = overlay();
  setTitle(el, titleText);
  setHint(el, '');
  gateStrip.hide();
  const detail = el.querySelector('.mm-gate__detail');
  detail.textContent = '';
  detailNodes.forEach((n) => detail.appendChild(n));
  const actions = clearActions(el);
  actions.hidden = false;
  el.hidden = false;
  return new Promise((resolve) => {
    let done = false;
    let release = null;
    const finish = (id) => {
      if (done) return;
      done = true;
      actions.hidden = true;
      if (release) release();
      resolve(id);
    };
    release = trapFocus(el, actions, () => finish('postpone'));
    choices.forEach((id) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mm-gate__btn';
      const nm = document.createElement('span');
      nm.textContent = labelFor ? labelFor(id) : tierName(id);
      const sz = document.createElement('span');
      sz.className = 'mm-gate__btn-size';
      sz.textContent = tierSize(id);
      b.append(nm, sz);
      b.addEventListener('click', () => finish(id));
      actions.appendChild(b);
    });
    actions.appendChild(button(t('chooseNotNow'), 'mm-gate__btn--ghost', () => finish('postpone')));
    const firstBtn = actions.querySelector('button');
    if (firstBtn) firstBtn.focus();
  });
}

function span(cls, text) { const s = document.createElement('span'); s.className = cls; s.textContent = text; return s; }

function offerTiers(choices) {
  return offerChoice(choices, t('chooseTitle'), [
    span('mm-gate__pitch', t('choosePitch')),
    span('mm-gate__sample', t('chooseSample')),
    span('mm-gate__hint', t('chooseHint', { name: tierName(choices[0]) }))
  ]);
}

async function tierChoices() {
  const d = await Tiers.decideTier();
  const set = new Set([d.tier].concat(d.eligible || []));
  set.add('0.8b');
  return Tiers.TIER_CHAIN.filter((id) => set.has(id));
}

async function smallerChoices(candidate) {
  const all = await tierChoices();
  const idx = Tiers.TIER_CHAIN.indexOf(candidate);
  return all.filter((id) => Tiers.TIER_CHAIN.indexOf(id) > idx);
}

function hide() {
  const el = document.getElementById('mm-gate');
  if (el) el.hidden = true;
  if (gateStrip) gateStrip.hide();
}

async function probeOnce(engine, candidate) {
  let timer;
  let stillTimer;
  let firstToken;
  const alive = new Promise((res) => { firstToken = res; });
  if (gateStrip) gateStrip.phase('testing', { name: tierName(candidate) });
  const run = engine.generate({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 2, temperature: 0, enableThinking: false }, () => { firstToken(); });
  const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('validation timeout')), PROBE_TIMEOUT); });
  stillTimer = setTimeout(() => {
    const el = document.getElementById('mm-gate');
    if (el && !el.hidden) setHint(el, t('still'));
  }, PROBE_STILL_MS);
  try { await Promise.race([run, alive, timeout]); } finally { clearTimeout(timer); clearTimeout(stillTimer); }
}

async function validateRun(engine, candidate) {
  try {
    await probeOnce(engine, candidate);
  } catch (e) {
    if (!e || e.message !== 'validation timeout') throw e;
    await probeOnce(engine, candidate);
  }
}

function requestPersistentStorage() {
  try {
    if (window.MentriaStore && window.MentriaStore.requestPersist) { window.MentriaStore.requestPersist(); return; }
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  } catch (_) {}
}

export async function ensureModel(engineFactory, opts) {
  opts = opts || {};
  const vision = !!opts.vision;
  const onProgress = opts.onProgress || null;
  const onDeviceLost = opts.onDeviceLost || null;
  const onTier = typeof opts.onTier === 'function' ? opts.onTier : null;
  const tellTier = (id, cached) => { if (onTier) { try { onTier(Object.assign(tierInfo(Tiers.TIERS[id], id), { cached: !!cached }), id); } catch (_) {} } };
  const offerUpgrade = !!opts.offerUpgrade;
  const cachedOnly = !!opts.cachedOnly;

  if (typeof navigator === 'undefined' || !navigator.gpu) throw new NoWebGpuError();

  if (window.parent !== window && /[?&]embed=1/.test(location.search)) {
    try {
      const Proxy = await import('/assets/js/mentria-engine-proxy.js');
      const remote = await Proxy.connectRemoteEngine({ timeoutMs: 120000, onProgress });
      if (remote) {
        remote.onProgress = onProgress;
        remote.onDeviceLost = onDeviceLost;
        window.__mentriaEngine = remote;
        if (onTier) { try { onTier(Object.assign(tierInfo(Tiers.TIERS[remote.tier], remote.tier), { cached: true }), remote.tier); } catch (_) {} }
        return { engine: remote, tier: remote.tier, maxSeq: remote.maxSeq, remote: true };
      }
    } catch (_) {}
  }

  let stopped = false;
  let lastEngine = null;
  const makeEngine = () => {
    if (stopped) throw new Error('stopped');
    const e = engineFactory();
    lastEngine = e;
    e.onProgress = (p) => { if (gateStrip) gateStrip.onProgress(p); if (onProgress) onProgress(p); };
    return e;
  };

  const attachDeviceLost = (engine, tier) => {
    engine.onDeviceLost = (info) => {
      try {
        const idx = Tiers.TIER_CHAIN.indexOf(tier);
        const lower = Tiers.TIER_CHAIN[idx + 1];
        if (lower) Tiers.setTierCap(lower);
        Tiers.clearValidatedTier();
      } catch (_) {}
      if (onDeviceLost) onDeviceLost(info);
    };
    window.__mentriaEngine = engine;
    return engine;
  };

  if (cachedOnly) {
    const c = await Tiers.effectiveTier({ cachedOnly: true });
    if (!c) throw new Error('model-not-cached');
    tellTier(c, true);
    const res = await Tiers.loadWithFallback(makeEngine, c, { vision, onFallback: (from, to) => tellTier(to, true) });
    return { engine: attachDeviceLost(res.engine, res.tier), tier: res.tier, maxSeq: res.maxSeq };
  }

  if (offerUpgrade && !Tiers.getUserTier()) {
    const choices = await tierChoices();
    if (choices.length > 1) {
      const pick = await offerTiers(choices);
      if (pick === 'postpone') { hide(); throw new Error('download-postponed'); }
      if (pick) Tiers.setUserTier(pick);
    }
  }

  const candidate = await Tiers.effectiveTier();
  if (!candidate) throw new NoWebGpuError();

  const validated = Tiers.getValidatedTier();
  const proven = validated && Tiers.TIERS[candidate].order <= Tiers.TIERS[validated].order;
  const cached = await Tiers.isTierCached(candidate);
  tellTier(candidate, cached);

  if (proven && cached) {
    hide();
    requestPersistentStorage();
    const res = await Tiers.loadWithFallback(makeEngine, candidate, { vision, onFallback: (from, to) => { Tiers.isTierCached(to).then((c) => tellTier(to, c), () => tellTier(to, false)); } });
    if (res.tier !== candidate) Tiers.clearValidatedTier();
    return { engine: attachDeviceLost(res.engine, res.tier), tier: res.tier, maxSeq: res.maxSeq };
  }

  let stopReject = null;
  const stopSignal = new Promise((_, rej) => { stopReject = rej; });
  stopSignal.catch(() => {});
  let release = () => {};
  const ctl = {
    background: () => { const el = document.getElementById('mm-gate'); if (el) el.hidden = true; release(); },
    stop: () => {
      stopped = true;
      try { lastEngine && lastEngine.terminate && lastEngine.terminate(); } catch (_) {}
      stopReject(new Error('stopped'));
    }
  };
  release = showCheck(candidate, ctl, cached);
  if (!cached && typeof window.mentriaConfirmHeavyDownload === 'function') {
    const ok = await window.mentriaConfirmHeavyDownload();
    if (!ok) { release(); hide(); throw new Error('download-postponed'); }
  }
  requestPersistentStorage();
  try {
    const P2P = await import('/assets/js/mentria-p2p-models.js');
    await Promise.race([
      P2P.prefetchTier(Tiers, candidate, { vision, onStatus: (st) => { if (gateStrip) gateStrip.onProgress({ stage: 'download', progress: st.progress || 0, downSpeed: st.downSpeed }); } }),
      new Promise((r) => setTimeout(r, 480000)),
      stopSignal
    ]);
  } catch (_) {}
  try {
    if (stopped) throw new Error('stopped');
    const res = await Promise.race([
      Tiers.loadWithFallback(makeEngine, candidate, {
        vision,
        validate: (engine) => validateRun(engine, candidate),
        onFallback: (from, to) => {
          const el = document.getElementById('mm-gate');
          if (el) { setDetail(el, t('degrade', { from: tierName(from), to: tierName(to) })); setHint(el, ''); }
          Tiers.isTierCached(to).then((c) => tellTier(to, c), () => tellTier(to, false));
          if (gateStrip) { Tiers.isTierCached(to).then((c) => gateStrip.setTier(Object.assign(tierInfo(Tiers.TIERS[to], to), { cached: !!c })), () => {}); gateStrip.phase('testing', { name: tierName(to) }); }
        }
      }),
      stopSignal
    ]);
    Tiers.setValidatedTier(res.tier);
    release();
    const el = document.getElementById('mm-gate');
    if (el && !el.hidden) {
      clearActions(el);
      setDetail(el, t('ready', { name: tierName(res.tier) }));
      setHint(el, '');
      gateStrip.done({ prime: t('ready', { name: tierName(res.tier) }), linger: READY_LINGER });
      await new Promise((r) => setTimeout(r, READY_LINGER));
    } else if (gateStrip) gateStrip.hide();
    hide();
    return { engine: attachDeviceLost(res.engine, res.tier), tier: res.tier, maxSeq: res.maxSeq };
  } catch (e) {
    release();
    try { lastEngine && lastEngine.terminate && lastEngine.terminate(); } catch (_) {}
    const el = document.getElementById('mm-gate');
    if (el) el.hidden = false;
    const smaller = await smallerChoices(candidate);
    const wasStopped = stopped || (e && e.message === 'stopped');
    const nodes = wasStopped
      ? [span('mm-gate__hint', t('stoppedHint'))]
      : [span('mm-gate__pitch', String(e && e.message || t('failed'))), span('mm-gate__hint', t('failedHint'))];
    const pick = await offerChoice(smaller, wasStopped ? t('stoppedTitle') : t('failedTitle', { name: tierName(candidate) }), nodes, (id) => t('tryTier', { name: tierName(id) }));
    if (pick && pick !== 'postpone') {
      Tiers.setUserTier(pick);
      hide();
      return ensureModel(engineFactory, opts);
    }
    hide();
    throw wasStopped ? new Error('download-postponed') : e;
  }
}
