const SEGS = 24;
const DONE_LINGER = 2600;
const RATE_WINDOW = 4;

const DEFAULT_COPY = {
  downloading: 'downloading',
  uploading: 'uploading to gpu',
  loading: 'loading',
  warming: 'warming up',
  testing: 'testing',
  reading: 'reading prompt',
  answering: 'answering',
  done: 'done',
  error: 'error',
  shardOf: 'shard {n} of {m}',
  mbOf: '{done} / {total} MB',
  mbps: '{rate} MB/s',
  tensorsOf: '{done} / {total} tensors',
  gbpsToGpu: '{rate} GB/s to gpu',
  keptOnDevice: 'downloaded once, kept on this device',
  fromDevice: 'loading from device',
  firstRun: 'first run on this gpu',
  testingModel: 'testing the {name} model',
  tokensOf: '{done} / {total} tokens',
  tokPerSec: '{rate} tok/s',
  chunkOf: 'chunk {n} of {m}',
  tokens: '{n} tokens',
  msPerWord: '{ms} ms/word',
  gbps: '{rate} GB/s',
  ctx: 'ctx {used} / {window}',
  left: '{t} left',
  doneLine: '{n} tokens · {rate} tok/s · {s} s',
  retry: 'retry',
  thisDevice: 'this device',
  thisAnswer: 'this answer',
  gpu: 'gpu',
  architecture: 'architecture',
  cpuCores: 'cpu cores',
  deviceMemory: 'device memory',
  modelTier: 'model tier',
  limits: 'webgpu limits',
  phaseLog: 'phase log',
  total: 'total',
  collapse: 'Collapse panel',
  nothingLeaves: 'nothing leaves your device'
};

function tr(key, vars) {
  let s = DEFAULT_COPY[key];
  try {
    if (window.MentriaI18n && window.MentriaI18n.t) {
      const v = window.MentriaI18n.t('tools.activity.' + key);
      if (v != null) s = v;
    }
  } catch (_) {}
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m)) : s;
}

const CSS = `
.es{--es-c:var(--syn-cyan);display:flex;flex-direction:column;gap:6px;padding:.5rem 0 .55rem;border-bottom:1px solid var(--term-divider,var(--term-border));font-family:var(--font-mono);font-variant-numeric:tabular-nums;cursor:default}
.es[hidden]{display:none}
.es--mint{--es-c:var(--accent)}
.es--amber{--es-c:var(--syn-amber)}
.es--pink{--es-c:var(--syn-pink)}
.es--tap{cursor:pointer}
.es__row{display:grid;gap:2px var(--space-3,.75rem);align-items:baseline;grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"label right" "nums nums"}
.es__label{grid-area:label;font-size:var(--text-2xs,.68rem);letter-spacing:.14em;text-transform:uppercase;color:var(--es-c)}
.es__nums{grid-area:nums;display:flex;align-items:baseline;gap:var(--space-2,.5rem);flex-wrap:nowrap;overflow:hidden;min-width:0}
.es__right{grid-area:right;display:flex;align-items:baseline;gap:var(--space-2,.5rem);white-space:nowrap}
.es__bit--more,.es__note{display:none}
.es__prime{font-size:var(--text-sm,.85rem);font-weight:500;color:var(--term-fg-strong);letter-spacing:-.01em;white-space:nowrap}
.es--pink .es__prime{color:var(--syn-pink)}
.es__bit,.es__note{font-size:var(--text-2xs,.68rem);color:var(--term-muted);white-space:nowrap}
.es__note{color:var(--term-subtle,var(--term-muted))}
.es__time{flex:0 0 auto;font-size:var(--text-2xs,.68rem);color:var(--term-subtle,var(--term-muted))}
.es__retry{font:inherit;font-size:var(--text-2xs,.68rem);padding:.15rem .6rem;border:1px solid var(--syn-pink);border-radius:999px;background:none;color:var(--syn-pink);cursor:pointer}
.es__seg{display:flex;gap:2px;height:4px}
.es__seg i{flex:1;border-radius:1px;background:var(--term-surface-3,rgba(255,255,255,.08));transition:background var(--dur-3,.3s) var(--ease-out,ease-out),box-shadow var(--dur-3,.3s) var(--ease-out,ease-out)}
.es__seg i.is-on{background:var(--es-c)}
.es--mint .es__seg i.is-on{box-shadow:0 0 6px rgba(110,243,197,.35)}
.es--sweep .es__seg i{animation:es-sweep 1.9s var(--ease-out,ease-out) infinite;animation-delay:calc(var(--i)*60ms);background:var(--es-c);opacity:.16}
@keyframes es-sweep{0%,72%{opacity:.16}18%{opacity:1}}
@media (prefers-reduced-motion:reduce){.es--sweep .es__seg i{animation:none;opacity:.5}}
.es-host{container-type:inline-size}
@container (min-width:640px){
  .es__row{grid-template-columns:auto minmax(0,1fr) auto;grid-template-areas:"label nums right"}
  .es__bit--more,.es__note{display:inline}
  .es{padding:.55rem 0 .6rem}
}
.es-panel{display:flex;flex-direction:column;gap:var(--space-3,.75rem);margin-top:var(--space-3,.75rem);padding:var(--space-3,.75rem);border:1px solid var(--term-border);border-radius:var(--radius-md,8px);background:rgba(0,0,0,.28);font-family:var(--font-mono);font-variant-numeric:tabular-nums}
.es-panel[hidden]{display:none}
.es-panel__hd{display:flex;align-items:center}
.es-panel__lb,.es-dev__lb{font-size:var(--text-2xs,.68rem);letter-spacing:.14em;text-transform:uppercase;color:var(--term-subtle,var(--term-muted))}
.es-panel__x{margin-left:auto;width:20px;height:20px;display:grid;place-items:center;border:0;background:none;color:var(--term-muted);cursor:pointer;font:inherit}
.es-panel__grid{display:grid;gap:var(--space-4,1rem)}
@container (min-width:640px){.es-panel__grid{grid-template-columns:minmax(0,3fr) minmax(0,2fr)}}
.es-dev,.es-plog{display:flex;flex-direction:column;gap:5px;min-width:0}
.es-dev__kv{display:flex;align-items:baseline;gap:var(--space-3,.75rem);font-size:var(--text-2xs,.68rem);color:var(--term-muted)}
.es-dev__kv b{margin-left:auto;font-weight:500;color:var(--term-fg-strong);text-align:right;overflow-wrap:anywhere}
.es-dev__kv--lim b{color:var(--syn-cyan-soft,var(--syn-cyan))}
.es-dev__lb{margin-top:var(--space-2,.5rem)}
.es-plog__row{display:flex;align-items:center;gap:var(--space-2,.5rem);padding:3px 0;font-size:var(--text-2xs,.68rem);color:var(--term-muted);border-bottom:1px solid var(--term-divider,var(--term-border))}
.es-plog__dot{width:6px;height:6px;flex:0 0 6px;border-radius:50%;background:var(--accent)}
.es-plog__row.is-now{color:var(--term-fg-strong)}
.es-plog__row.is-now .es-plog__dot{background:var(--syn-cyan);box-shadow:var(--glow-cyan,0 0 6px var(--syn-cyan))}
.es-plog__t{margin-left:auto}
.es-plog__row--total{border-bottom:0;color:var(--term-fg-strong)}
.es-plog__row--total .es-plog__n{letter-spacing:.14em;text-transform:uppercase;font-size:var(--text-2xs,.68rem);color:var(--term-subtle,var(--term-muted))}
.es-panel__phase{display:flex;flex-wrap:wrap;gap:var(--space-2,.5rem);font-size:var(--text-2xs,.68rem);color:var(--term-muted)}
.es-panel__note{margin:0;font-size:var(--text-2xs,.68rem);color:var(--term-subtle,var(--term-muted))}
`;

function ensureStyle() {
  if (document.getElementById('mentria-activity-style')) return;
  const st = document.createElement('style');
  st.id = 'mentria-activity-style';
  st.textContent = CSS;
  document.head.appendChild(st);
}

const PHASES = {
  downloading: { tone: 'cyan' },
  uploading: { tone: 'cyan' },
  loading: { tone: 'amber', sweep: true },
  warming: { tone: 'amber', sweep: true },
  testing: { tone: 'amber', sweep: true },
  reading: { tone: 'cyan' },
  answering: { tone: 'cyan' },
  done: { tone: 'mint' },
  error: { tone: 'pink' }
};

const lang = () => (document.documentElement.lang || undefined);
const fmtInt = (v) => Number(v).toLocaleString(lang());
const fmt1 = (v) => Number(v).toLocaleString(lang(), { maximumFractionDigits: 1 });
function fmtSecs(ms) {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return s + ' s';
  const m = Math.floor(s / 60), r = s % 60;
  return m < 60 ? m + ' m ' + (r ? r + ' s' : '') : Math.floor(m / 60) + ' h ' + (m % 60) + ' m';
}
const fmtElapsed = (ms) => (ms < 60000 ? fmt1(ms / 1000) + ' s' : fmtSecs(ms));

let adapterInfoPromise = null;
function adapterInfo() {
  if (adapterInfoPromise) return adapterInfoPromise;
  adapterInfoPromise = (async () => {
    try {
      if (!navigator.gpu) return null;
      const a = await navigator.gpu.requestAdapter();
      if (!a) return null;
      const info = a.info || (a.requestAdapterInfo ? await a.requestAdapterInfo() : {}) || {};
      const lim = a.limits || {};
      return {
        vendor: info.vendor || '', architecture: info.architecture || '', device: info.device || '', description: info.description || '',
        limits: { maxBufferSize: lim.maxBufferSize, maxStorageBufferBindingSize: lim.maxStorageBufferBindingSize, maxComputeWorkgroupStorageSize: lim.maxComputeWorkgroupStorageSize }
      };
    } catch (_) { return null; }
  })();
  return adapterInfoPromise;
}
export function gpuLabel(info) {
  if (!info) return '';
  if (info.description) return info.description;
  if (info.device) return info.device;
  return [info.vendor, info.architecture].filter(Boolean).join(' · ');
}

export function createActivityStrip(host, opts = {}) {
  ensureStyle();
  host.classList.add('es-host');
  const el = document.createElement('div');
  el.className = 'es';
  el.hidden = true;
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.innerHTML = '<div class="es__row"><span class="es__label"></span><span class="es__nums"></span><span class="es__right"><button type="button" class="es__retry" hidden></button><span class="es__time"></span></span></div><div class="es__seg" aria-hidden="true">' + Array.from({ length: SEGS }, (_, i) => '<i style="--i:' + i + '"></i>').join('') + '</div>';
  host.appendChild(el);
  const labelEl = el.querySelector('.es__label');
  const numsEl = el.querySelector('.es__nums');
  const timeEl = el.querySelector('.es__time');
  const retryBtn = el.querySelector('.es__retry');
  const segs = Array.from(el.querySelectorAll('.es__seg i'));

  let panelEl = null;
  const panelEnabled = opts.panel !== false;
  const state = { phase: null, since: 0, tier: opts.tier || null, gpu: '', log: [], nowLog: null, onRetry: null, lastFrac: 0, samples: [], lastBytes: null, tokens: 0, tokStart: 0, hideTimer: 0, expanded: false };

  function setTone(tone, sweep) {
    el.classList.remove('es--mint', 'es--amber', 'es--pink', 'es--sweep');
    if (tone && tone !== 'cyan') el.classList.add('es--' + tone);
    if (sweep) el.classList.add('es--sweep');
  }
  function setFill(frac) {
    const n = frac == null ? 0 : Math.round(Math.max(0, Math.min(1, frac)) * SEGS);
    segs.forEach((s, i) => s.classList.toggle('is-on', i < n));
  }
  function render(label, prime, bits, more, note, time) {
    labelEl.textContent = label;
    let html = '<b class="es__prime"></b>';
    numsEl.innerHTML = html;
    numsEl.firstChild.textContent = prime || '';
    (bits || []).forEach((b) => { const s = document.createElement('span'); s.className = 'es__bit'; s.textContent = b; numsEl.appendChild(s); });
    (more || []).forEach((b) => { const s = document.createElement('span'); s.className = 'es__bit es__bit--more'; s.textContent = b; numsEl.appendChild(s); });
    if (note) { const s = document.createElement('span'); s.className = 'es__note'; s.textContent = note; numsEl.appendChild(s); }
    timeEl.textContent = time || '';
  }

  function beginPhase(name) {
    if (state.phase === name) return;
    const now = performance.now();
    if (state.nowLog) { state.nowLog.ms = now - state.nowLog.start; state.nowLog = null; }
    state.phase = name;
    state.since = now;
    state.samples = [];
    state.lastBytes = null;
    state.lastFrac = 0;
    state.maxFrac = 0;
    if (name === 'answering') { state.tokens = 0; state.tokStart = 0; }
    if (name && name !== 'done' && name !== 'error') {
      state.nowLog = { name, start: now, ms: 0 };
      state.log.push(state.nowLog);
      if (state.log.length > 12) state.log.shift();
    }
    const ph = PHASES[name] || PHASES.loading;
    setTone(ph.tone, !!ph.sweep);
    if (ph.sweep) setFill(0);
    clearTimeout(state.hideTimer);
    el.hidden = false;
    retryBtn.hidden = true;
    renderPanel();
  }

  function etaFromFrac(frac) {
    const now = performance.now();
    state.samples.push({ t: now, f: frac });
    if (state.samples.length > RATE_WINDOW) state.samples.shift();
    const a = state.samples[0], b = state.samples[state.samples.length - 1];
    if (state.samples.length < 2 || b.f <= a.f || b.t - a.t < 400) return null;
    const rate = (b.f - a.f) / (b.t - a.t);
    return (1 - frac) / rate;
  }
  function bytesRate(bytes) {
    const now = performance.now();
    if (!state.lastBytes) { state.lastBytes = { t: now, b: bytes, rate: null }; return null; }
    const dt = now - state.lastBytes.t;
    if (dt < 500) return state.lastBytes.rate;
    const r = (bytes - state.lastBytes.b) / dt * 1000;
    const rate = r > 0 ? (state.lastBytes.rate ? state.lastBytes.rate * 0.6 + r * 0.4 : r) : state.lastBytes.rate;
    state.lastBytes = { t: now, b: bytes, rate };
    return rate;
  }

  function onDownload(p) {
    beginPhase('downloading');
    const total = p.total > 0 ? p.total : 1;
    let frac = typeof p.progress === 'number' ? p.progress : (p.loaded != null ? p.loaded / total : 0);
    frac = Math.max(0, Math.min(1, frac), state.maxFrac || 0);
    state.maxFrac = frac;
    const shards = p.total > 1 ? p.total : null;
    const shard = shards ? Math.min(shards, Math.floor(frac * shards) + 1) : null;
    const m = typeof p.message === 'string' ? p.message.match(/(\d+)\/(\d+)\s*MB/) : null;
    let prime, bits = [], time = '';
    const tierBytes = state.tier && state.tier.bytes;
    const fromCache = !!(state.tier && state.tier.cached);
    if (tierBytes) {
      prime = tr('mbOf', { done: fmtInt(Math.round(tierBytes * frac / 1e6)), total: fmtInt(Math.round(tierBytes / 1e6)) });
    } else if (m) {
      prime = tr('mbOf', { done: fmtInt(m[1]), total: fmtInt(m[2]) });
    } else {
      prime = Math.round(frac * 100) + '%';
    }
    let rate = typeof p.downSpeed === 'number' ? p.downSpeed : (tierBytes ? bytesRate(tierBytes * frac) : null);
    if (rate && rate > 0) bits.push(tr('mbps', { rate: fmt1(rate / 1e6) }));
    if (shards) bits.push(tr('shardOf', { n: shard, m: shards }));
    const eta = etaFromFrac(frac);
    if (eta != null && eta > 1000 && frac < 1) time = tr('left', { t: fmtSecs(eta) });
    setFill(frac);
    render(fromCache ? tr('fromDevice') : tr('downloading'), prime, bits, [], fromCache ? '' : tr('keptOnDevice'), time);
  }

  function onUpload(p) {
    beginPhase('uploading');
    const total = p.total > 0 ? p.total : 1;
    const frac = Math.max(0, Math.min(1, (p.loaded || 0) / total));
    const tensors = p.total > 1;
    const prime = tensors ? tr('tensorsOf', { done: fmtInt(Math.floor(p.loaded)), total: fmtInt(p.total) }) : Math.round(frac * 100) + '%';
    const bits = [];
    const tierBytes = state.tier && state.tier.bytes;
    if (tierBytes && tensors) {
      const r = bytesRate(tierBytes * frac);
      if (r && r > 0) bits.push(tr('gbpsToGpu', { rate: fmt1(r / 1e9) }));
    }
    const eta = etaFromFrac(frac);
    const time = (eta != null && eta > 1000 && frac < 1) ? tr('left', { t: fmtSecs(eta) }) : '';
    setFill(frac);
    render(tr('uploading'), prime, bits, [], state.gpu || '', time);
  }

  function onInit(p) {
    if (p.loaded >= 3) return;
    if (p.loaded >= 1) { beginPhase('warming'); render(tr('warming'), tr('firstRun'), [], [], state.gpu || '', fmtElapsed(performance.now() - state.since)); }
    else { beginPhase('loading'); render(tr('loading'), p.message || '', [], [], '', ''); }
  }

  function onPrefill(p) {
    if (!(p.total > 0)) return;
    beginPhase('reading');
    const frac = Math.max(0, Math.min(1, p.loaded / p.total));
    const bits = [];
    if (p.tokPerSec) bits.push(tr('tokPerSec', { rate: fmtInt(Math.round(p.tokPerSec)) }));
    const more = [];
    if (p.chunks > 1) more.push(tr('chunkOf', { n: Math.min(p.chunks, (p.chunk || 0) + 1), m: p.chunks }));
    const time = (p.etaMs != null && p.etaMs > 1000 && p.loaded < p.total) ? tr('left', { t: fmtSecs(p.etaMs) }) : '';
    setFill(frac);
    render(tr('reading'), tr('tokensOf', { done: fmtInt(p.loaded), total: fmtInt(p.total) }), bits, more, '', time);
  }

  const api = {
    el,
    onProgress(p) {
      if (!p) return;
      const st = p.stage;
      if (st === 'download' || (typeof p.progress === 'number' && !st)) onDownload(p);
      else if (st === 'upload') onUpload(p);
      else if (st === 'init') onInit(p);
      else if (st === 'prefill') onPrefill(p);
    },
    setTier(tier) { state.tier = tier || null; renderPanel(); },
    setDevice(name) { state.gpu = name || ''; renderPanel(); },
    phase(name, data) {
      beginPhase(name);
      const d = data || {};
      if (name === 'testing') render(tr('testing'), d.name ? tr('testingModel', { name: d.name }) : tr('firstRun'), [], [], state.gpu || '', '');
      else if (name === 'warming') render(tr('warming'), tr('firstRun'), [], [], state.gpu || '', '');
      else if (name === 'reading') { setFill(0); render(tr('reading'), d.prime || '', [], [], '', ''); }
      else if (name === 'answering') { state.tokens = 0; state.tokStart = 0; setFill(0); render(tr('answering'), '…', [], [], '', ''); }
      else render(tr(name) || name, d.prime || '', d.bits || [], d.more || [], d.note || '', d.time || '');
    },
    token(count, extra) {
      const e = extra || {};
      if (state.phase !== 'answering') beginPhase('answering');
      const now = performance.now();
      if (!state.tokStart) state.tokStart = now;
      state.tokens = count;
      const secs = (now - state.tokStart) / 1000;
      const tps = count > 1 && secs > 0.05 ? (count - 1) / secs : null;
      const bits = [tr('tokens', { n: fmtInt(count) })];
      const more = [];
      if (tps) {
        more.push(tr('msPerWord', { ms: fmtInt(Math.round(1000 / tps)) }));
        if (state.tier && state.tier.bytes) more.push(tr('gbps', { rate: fmtInt(Math.round(state.tier.bytes * tps / 1e9)) }));
      }
      let frac = null;
      if (e.ctxUsed != null && e.ctxWindow) { more.push(tr('ctx', { used: fmtInt(e.ctxUsed), window: fmtInt(e.ctxWindow) })); frac = e.ctxUsed / e.ctxWindow; }
      setFill(frac);
      render(tr('answering'), tps ? tr('tokPerSec', { rate: fmt1(tps) }) : '…', bits, more, '', fmtElapsed(now - state.since));
    },
    done(summary) {
      const s = summary || {};
      const now = performance.now();
      const secs = state.phase === 'answering' ? (now - (state.tokStart || state.since)) / 1000 : (s.secs || 0);
      const n = s.tokens != null ? s.tokens : state.tokens;
      const tps = s.tokPerSec != null ? s.tokPerSec : (n > 1 && secs > 0.05 ? (n - 1) / secs : 0);
      beginPhase('done');
      setFill(1);
      render(tr('done'), n ? tr('doneLine', { n: fmtInt(n), rate: fmt1(tps), s: fmt1(secs) }) : (s.prime || ''), [], [], '', '');
      clearTimeout(state.hideTimer);
      state.hideTimer = setTimeout(() => { if (state.phase === 'done') api.hide(); }, s.linger != null ? s.linger : DONE_LINGER);
    },
    error(message, o) {
      const d = o || {};
      const label = d.phase ? tr(d.phase) : tr('error');
      beginPhase('error');
      setFill(state.lastFrac || 0);
      render(label, d.prime || message || tr('error'), d.prime && message ? [message] : [], [], '', '');
      state.onRetry = d.onRetry || null;
      retryBtn.textContent = tr('retry');
      retryBtn.hidden = !state.onRetry;
    },
    hide() {
      clearTimeout(state.hideTimer);
      if (state.nowLog) { state.nowLog.ms = performance.now() - state.nowLog.start; state.nowLog = null; }
      state.phase = null;
      el.hidden = true;
      if (panelEl) { panelEl.hidden = true; state.expanded = false; }
    },
    get phaseName() { return state.phase; },
    get log() { return state.log.slice(); }
  };

  retryBtn.addEventListener('click', (e) => { e.stopPropagation(); if (state.onRetry) state.onRetry(); });

  function renderPanel() {
    if (!panelEl || panelEl.hidden) return;
    const dev = panelEl.querySelector('.es-dev');
    const plog = panelEl.querySelector('.es-plog');
    const kv = (k, v, cls) => { const r = document.createElement('div'); r.className = 'es-dev__kv' + (cls ? ' ' + cls : ''); const a = document.createElement('span'); a.textContent = k; const b = document.createElement('b'); b.textContent = v; r.append(a, b); return r; };
    dev.innerHTML = '';
    const info = state.adapter || null;
    dev.appendChild(kv(tr('gpu'), state.gpu || gpuLabel(info) || '—'));
    if (info && info.architecture) dev.appendChild(kv(tr('architecture'), info.architecture));
    if (navigator.hardwareConcurrency) dev.appendChild(kv(tr('cpuCores'), fmtInt(navigator.hardwareConcurrency)));
    if (navigator.deviceMemory) dev.appendChild(kv(tr('deviceMemory'), navigator.deviceMemory + ' GB'));
    if (state.tier) dev.appendChild(kv(tr('modelTier'), [state.tier.name, state.tier.sizeLabel].filter(Boolean).join(' · ')));
    if (info && info.limits) {
      const lb = document.createElement('span'); lb.className = 'es-dev__lb'; lb.textContent = tr('limits'); dev.appendChild(lb);
      Object.keys(info.limits).forEach((k) => { if (info.limits[k] != null) dev.appendChild(kv(k, fmtInt(info.limits[k]), 'es-dev__kv--lim')); });
    }
    plog.innerHTML = '';
    const lb = document.createElement('span'); lb.className = 'es-dev__lb'; lb.textContent = tr('phaseLog'); plog.appendChild(lb);
    const now = performance.now();
    let total = 0;
    state.log.forEach((row) => {
      const ms = row === state.nowLog ? now - row.start : row.ms;
      total += ms;
      const r = document.createElement('div'); r.className = 'es-plog__row' + (row === state.nowLog ? ' is-now' : '');
      r.innerHTML = '<span class="es-plog__dot"></span><span class="es-plog__n"></span><span class="es-plog__t"></span>';
      r.querySelector('.es-plog__n').textContent = tr(row.name);
      r.querySelector('.es-plog__t').textContent = fmtElapsed(ms);
      plog.appendChild(r);
    });
    const tot = document.createElement('div'); tot.className = 'es-plog__row es-plog__row--total';
    tot.innerHTML = '<span class="es-plog__n"></span><span class="es-plog__t"></span>';
    tot.querySelector('.es-plog__n').textContent = tr('total');
    tot.querySelector('.es-plog__t').textContent = fmtElapsed(total);
    plog.appendChild(tot);
  }

  if (panelEnabled) {
    el.classList.add('es--tap');
    el.setAttribute('tabindex', '0');
    const toggle = async () => {
      if (!panelEl) {
        panelEl = document.createElement('div');
        panelEl.className = 'es-panel';
        panelEl.innerHTML = '<div class="es-panel__hd"><span class="es-panel__lb"></span><button type="button" class="es-panel__x">×</button></div><div class="es-panel__grid"><div class="es-dev"></div><div class="es-plog"></div></div><p class="es-panel__note"></p>';
        panelEl.querySelector('.es-panel__lb').textContent = tr('thisDevice');
        panelEl.querySelector('.es-panel__x').setAttribute('aria-label', tr('collapse'));
        panelEl.querySelector('.es-panel__note').textContent = tr('nothingLeaves');
        panelEl.querySelector('.es-panel__x').addEventListener('click', () => { panelEl.hidden = true; state.expanded = false; });
        el.insertAdjacentElement('afterend', panelEl);
        state.adapter = await adapterInfo();
        if (!state.gpu) state.gpu = gpuLabel(state.adapter);
      }
      state.expanded = !state.expanded;
      panelEl.hidden = !state.expanded;
      renderPanel();
    };
    el.addEventListener('click', toggle);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    setInterval(() => { if (state.expanded && state.nowLog) renderPanel(); }, 1000);
  }

  return api;
}

export function tierInfo(t, id) {
  if (!t) return { name: id || '', sizeLabel: '', bytes: null };
  const m = /([\d.]+)\s*(GB|MB)/i.exec(t.sizeLabel || '');
  const bytes = m ? Math.round(parseFloat(m[1]) * (m[2].toUpperCase() === 'GB' ? 1e9 : 1e6)) : null;
  return { name: t.name || id || '', sizeLabel: t.sizeLabel || '', bytes };
}
