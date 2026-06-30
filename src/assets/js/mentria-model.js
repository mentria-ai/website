import * as Tiers from '/assets/js/mentria-tiers.js';

const PROBE_TIMEOUT = 15000;
const READY_LINGER = 600;

const DEFAULT_COPY = {
  checking: 'Checking your device…',
  testing: 'Testing the {name} model…',
  ready: '✓ {name} ready',
  degrade: '{from} isn’t supported on this device — using {to}',
  failed: 'Couldn’t run an on-device model on this device.',
  chooseTitle: 'Choose your AI model',
  chooseHint: 'Your device can run up to {name}. Bigger models are smarter but download more.'
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
function tierSize(id) { return (Tiers.TIERS[id] && Tiers.TIERS[id].sizeLabel) || ''; }

function ensureOverlayStyle() {
  if (document.getElementById('mm-gate-style')) return;
  const st = document.createElement('style');
  st.id = 'mm-gate-style';
  st.textContent = '.mm-gate{position:fixed;inset:0;z-index:10001;display:flex;align-items:center;justify-content:center;padding:1rem;background:rgba(0,0,0,.55);backdrop-filter:blur(4px);font-family:var(--font-mono,monospace)}.mm-gate[hidden]{display:none}.mm-gate__card{background:#0d1014;border:1px solid #2a3138;border-radius:10px;padding:1.2rem 1.4rem;width:100%;max-width:22rem;display:flex;flex-direction:column;gap:.7rem}.mm-gate__title{font-size:.9rem;color:var(--accent,#6ef3c5)}.mm-gate__bar{height:4px;background:rgba(255,255,255,.08);border-radius:2px;overflow:hidden}.mm-gate__fill{height:100%;width:0;background:var(--accent,#6ef3c5);transition:width .3s}.mm-gate__detail{font-size:.75rem;color:var(--muted,#9ba6b1);min-height:1em}.mm-gate__actions{display:flex;flex-direction:column;gap:.5rem;margin-top:.2rem}.mm-gate__actions[hidden]{display:none}.mm-gate__btn{font:inherit;text-align:left;background:#0a0d10;border:1px solid #2a3138;color:#e6edf3;padding:.6rem .8rem;border-radius:8px;cursor:pointer;display:flex;justify-content:space-between;gap:1rem}.mm-gate__btn:hover{border-color:var(--accent,#6ef3c5);color:var(--accent,#6ef3c5)}.mm-gate__btn-size{color:var(--muted,#9ba6b1);font-size:.78rem}';
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
  const actions = document.createElement('div');
  actions.className = 'mm-gate__actions';
  actions.hidden = true;
  card.append(title, bar, detail, actions);
  el.appendChild(card);
  document.body.appendChild(el);
  return el;
}

function show(title, detail) {
  const el = overlay();
  el.querySelector('.mm-gate__title').textContent = title;
  el.querySelector('.mm-gate__detail').textContent = detail || '';
  el.querySelector('.mm-gate__bar').style.display = '';
  const actions = el.querySelector('.mm-gate__actions');
  actions.innerHTML = '';
  actions.hidden = true;
  el.hidden = false;
  return el;
}

function offerChoice(choices) {
  const el = overlay();
  el.querySelector('.mm-gate__title').textContent = t('chooseTitle');
  el.querySelector('.mm-gate__detail').textContent = t('chooseHint', { name: tierName(choices[0]) });
  el.querySelector('.mm-gate__bar').style.display = 'none';
  const actions = el.querySelector('.mm-gate__actions');
  actions.innerHTML = '';
  actions.hidden = false;
  el.hidden = false;
  return new Promise((resolve) => {
    let done = false;
    const finish = (id) => {
      if (done) return;
      done = true;
      actions.hidden = true;
      document.removeEventListener('keydown', onKey);
      el.removeEventListener('click', onBackdrop);
      resolve(id);
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); finish(null); } };
    const onBackdrop = (e) => { if (e.target === el) finish(null); };
    document.addEventListener('keydown', onKey);
    el.addEventListener('click', onBackdrop);
    choices.forEach((id) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mm-gate__btn';
      const nm = document.createElement('span');
      nm.textContent = tierName(id);
      const sz = document.createElement('span');
      sz.className = 'mm-gate__btn-size';
      sz.textContent = tierSize(id);
      b.append(nm, sz);
      b.addEventListener('click', () => finish(id));
      actions.appendChild(b);
    });
  });
}

async function tierChoices() {
  const d = await Tiers.decideTier();
  const set = new Set([d.tier].concat(d.eligible || []));
  set.add('0.8b');
  return Tiers.TIER_CHAIN.filter((id) => set.has(id));
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
  const offerUpgrade = !!opts.offerUpgrade;
  const cachedOnly = !!opts.cachedOnly;

  if (typeof navigator === 'undefined' || !navigator.gpu) throw new NoWebGpuError();

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

  if (cachedOnly) {
    const c = await Tiers.effectiveTier({ cachedOnly: true });
    if (!c) throw new Error('model-not-cached');
    const res = await Tiers.loadWithFallback(makeEngine, c, { vision });
    return { engine: attachDeviceLost(res.engine, res.tier), tier: res.tier };
  }

  if (offerUpgrade && !Tiers.getUserTier()) {
    const choices = await tierChoices();
    if (choices.length > 1) {
      const pick = await offerChoice(choices);
      if (pick) Tiers.setUserTier(pick);
    }
  }

  const candidate = await Tiers.effectiveTier();
  if (!candidate) throw new NoWebGpuError();

  const validated = Tiers.getValidatedTier();
  const proven = validated && Tiers.TIERS[candidate].order <= Tiers.TIERS[validated].order;
  const cached = await Tiers.isTierCached(candidate);

  if (proven && cached) {
    hide();
    const res = await Tiers.loadWithFallback(makeEngine, candidate, { vision });
    if (res.tier !== candidate) Tiers.clearValidatedTier();
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
