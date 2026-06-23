import * as Tiers from '/assets/js/mentria-tiers.js';

const PROBE_TIMEOUT = 15000;
const READY_LINGER = 600;

const DEFAULT_COPY = {
  checking: 'Checking your device…',
  testing: 'Testing the {name} model…',
  ready: '✓ {name} ready',
  degrade: '{from} isn’t supported on this device — using {to}',
  failed: 'Couldn’t run an on-device model on this device.'
};

function t(key, vars) {
  let s = DEFAULT_COPY[key];
  try {
    if (window.MentriaI18n && window.MentriaI18n.t) {
      const v = window.MentriaI18n.t('tool.model.' + key);
      if (v != null) s = v;
    }
  } catch (_) {}
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m)) : s;
}

export class NoWebGpuError extends Error {
  constructor() { super('no-webgpu'); this.name = 'NoWebGpuError'; }
}

function tierName(id) { return (Tiers.TIERS[id] && Tiers.TIERS[id].name) || id; }

function ensureOverlayStyle() {
  if (document.getElementById('mm-gate-style')) return;
  const st = document.createElement('style');
  st.id = 'mm-gate-style';
  st.textContent = '.mm-gate{position:fixed;inset:0;z-index:70;display:flex;align-items:center;justify-content:center;padding:1rem;background:rgba(0,0,0,.55);backdrop-filter:blur(4px);font-family:var(--font-mono,monospace)}.mm-gate[hidden]{display:none}.mm-gate__card{background:#0d1014;border:1px solid #2a3138;border-radius:10px;padding:1.2rem 1.4rem;width:100%;max-width:22rem;display:flex;flex-direction:column;gap:.7rem}.mm-gate__title{font-size:.9rem;color:var(--accent,#6ef3c5)}.mm-gate__bar{height:4px;background:rgba(255,255,255,.08);border-radius:2px;overflow:hidden}.mm-gate__fill{height:100%;width:0;background:var(--accent,#6ef3c5);transition:width .3s}.mm-gate__detail{font-size:.75rem;color:var(--muted,#9ba6b1);min-height:1em}';
  document.head.appendChild(st);
}

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
  card.setAttribute('aria-label', 'device check');
  const title = document.createElement('div');
  title.className = 'mm-gate__title';
  const bar = document.createElement('div');
  bar.className = 'mm-gate__bar';
  const fill = document.createElement('div');
  fill.className = 'mm-gate__fill';
  bar.appendChild(fill);
  const detail = document.createElement('div');
  detail.className = 'mm-gate__detail';
  card.append(title, bar, detail);
  el.appendChild(card);
  document.body.appendChild(el);
  return el;
}

function show(title, detail) {
  const el = overlay();
  el.querySelector('.mm-gate__title').textContent = title;
  el.querySelector('.mm-gate__detail').textContent = detail || '';
  el.hidden = false;
  return el;
}

function setProgress(p) {
  const el = document.getElementById('mm-gate');
  if (!el || el.hidden) return;
  let ratio = null;
  if (p && typeof p.progress === 'number') ratio = p.progress;
  else if (p && p.total) ratio = p.loaded / p.total;
  if (ratio == null) return;
  const fill = el.querySelector('.mm-gate__fill');
  if (fill) fill.style.width = Math.round(Math.max(0, Math.min(1, ratio)) * 100) + '%';
}

function hide() {
  const el = document.getElementById('mm-gate');
  if (el) el.hidden = true;
}

async function validateRun(engine) {
  let timer;
  const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('validation timeout')), PROBE_TIMEOUT); });
  const run = engine.generate({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 2, temperature: 0, enableThinking: false }, () => {});
  try { await Promise.race([run, timeout]); } finally { clearTimeout(timer); }
}

export async function ensureModel(engineFactory, opts) {
  opts = opts || {};
  const vision = !!opts.vision;
  const onProgress = opts.onProgress || null;
  const onDeviceLost = opts.onDeviceLost || null;

  if (typeof navigator === 'undefined' || !navigator.gpu) throw new NoWebGpuError();
  const candidate = await Tiers.effectiveTier();
  if (!candidate) throw new NoWebGpuError();

  const makeEngine = () => {
    const e = engineFactory();
    e.onProgress = (p) => { setProgress(p); if (onProgress) onProgress(p); };
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
    return engine;
  };

  const validated = Tiers.getValidatedTier();
  const proven = validated && Tiers.TIERS[candidate].order <= Tiers.TIERS[validated].order;
  const cached = await Tiers.isTierCached(candidate);

  if (proven && cached) {
    const res = await Tiers.loadWithFallback(makeEngine, candidate, { vision });
    return { engine: attachDeviceLost(res.engine, res.tier), tier: res.tier };
  }

  show(t('checking'), t('testing', { name: tierName(candidate) }));
  if (!cached && typeof window.mentriaConfirmHeavyDownload === 'function') {
    const ok = await window.mentriaConfirmHeavyDownload();
    if (!ok) { hide(); throw new Error('download-postponed'); }
  }
  try {
    const res = await Tiers.loadWithFallback(makeEngine, candidate, {
      vision,
      validate: validateRun,
      onFallback: (from, to) => { show(t('checking'), t('degrade', { from: tierName(from), to: tierName(to) })); }
    });
    Tiers.setValidatedTier(res.tier);
    show(t('checking'), t('ready', { name: tierName(res.tier) }));
    await new Promise((r) => setTimeout(r, READY_LINGER));
    hide();
    return { engine: attachDeviceLost(res.engine, res.tier), tier: res.tier };
  } catch (e) {
    hide();
    throw e;
  }
}
