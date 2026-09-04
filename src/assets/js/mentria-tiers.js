const MENTRIA_DIST = '/assets/mentria/dist/mentria.mjs';
const LS_PREF = 'mentria-tier';
const LS_CAP = 'mentria-tier-cap';
const LS_VALID = 'mentria-tier-validated';
const GiB = 1073741824;

export const TIER_CHAIN = ['27b', '4b', '2b', '0.8b'];

export const TIERS = {
  '0.8b': {
    id: '0.8b',
    name: '0.8B',
    order: 0,
    sizeLabel: '490 MB',
    base: 'https://huggingface.co/mentriaai/Qwen3.5-0.8B-mentria/resolve/main/',
    shards: ['qwen3.5-0.8b-q4-tied.safetensors'],
    visionShards: ['qwen3.5-0.8b-vl-q4.safetensors'],
    configExport: 'QWEN35_08B_CONFIG',
    loraQuotes: 'loras/quotes/adapter_model.safetensors',
    visionConfig: {
      hidden_size: 768,
      intermediate_size: 3072,
      num_heads: 12,
      head_dim: 64,
      out_hidden_size: 1024,
      depth: 12,
      patch_size: 16,
      temporal_patch_size: 2,
      spatial_merge_size: 2,
      num_position_embeddings: 2304,
      num_grid_per_side: 48,
      eps: 1e-6,
      prefix: 'visual'
    }
  },
  '2b': {
    id: '2b',
    name: '2B',
    order: 1,
    sizeLabel: '1.4 GB',
    base: 'https://huggingface.co/mentriaai/Qwen3.5-2B-mentria/resolve/main/',
    shards: ['qwen3.5-2b-q4-tied.safetensors'],
    visionShards: ['qwen3.5-2b-vl-q4.safetensors'],
    configExport: 'QWEN35_2B_CONFIG',
    loraQuotes: 'loras/quotes/adapter_model.safetensors',
    visionConfig: {
      hidden_size: 1024,
      intermediate_size: 4096,
      num_heads: 16,
      head_dim: 64,
      out_hidden_size: 2048,
      depth: 24,
      patch_size: 16,
      temporal_patch_size: 2,
      spatial_merge_size: 2,
      num_position_embeddings: 2304,
      num_grid_per_side: 48,
      eps: 1e-6,
      prefix: 'visual'
    }
  },
  '4b': {
    id: '4b',
    name: '4B',
    order: 2,
    sizeLabel: '2.8 GB',
    base: 'https://huggingface.co/mentriaai/Qwen3.5-4B-mentria/resolve/main/',
    shards: [
      'qwen3.5-4b-q4-tied-00001-of-00002.safetensors',
      'qwen3.5-4b-q4-tied-00002-of-00002.safetensors'
    ],
    visionShards: ['qwen3.5-4b-vl-q4.safetensors'],
    configExport: 'QWEN35_4B_CONFIG',
    loraQuotes: 'loras/quotes/adapter_model.safetensors',
    visionConfig: {
      hidden_size: 1024,
      intermediate_size: 4096,
      num_heads: 16,
      head_dim: 64,
      out_hidden_size: 2560,
      depth: 24,
      patch_size: 16,
      temporal_patch_size: 2,
      spatial_merge_size: 2,
      num_position_embeddings: 2304,
      num_grid_per_side: 48,
      eps: 1e-6,
      prefix: 'visual'
    }
  },
  '27b': {
    id: '27b',
    name: '27B',
    order: 3,
    sizeLabel: '3.8 GB',
    base: 'https://huggingface.co/mentriaai/Bonsai-27B-mentria/resolve/main/',
    shards: [
      'bonsai-27b-q1g128-00001-of-00002.safetensors',
      'bonsai-27b-q1g128-00002-of-00002.safetensors'
    ],
    visionShards: ['bonsai-27b-vl-q4.safetensors'],
    configExport: 'QWEN35_27B_BONSAI_CONFIG',
    visionConfigExport: 'QWEN35_VL_27B_VISION_CONFIG',
    streamingLoad: true,
    appleMaxSeq: 8192,
    nvidiaMaxSeq: 2048,
    discreteMaxSeq: 1024
  }
};

const IS_IOS = typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
   (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
const IS_ANDROID = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
const IS_DESKTOP = !IS_IOS && !IS_ANDROID;

let capsPromise = null;
async function detectCaps() {
  if (!navigator.gpu) return null;
  if (!capsPromise) {
    capsPromise = (async () => {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return null;
      let info = {};
      try {
        info = adapter.info || (adapter.requestAdapterInfo ? await adapter.requestAdapterInfo() : {});
      } catch (_) {}
      return {
        limits: {
          maxBufferSize: Number(adapter.limits.maxBufferSize) || 0,
          maxStorageBufferBindingSize: Number(adapter.limits.maxStorageBufferBindingSize) || 0
        },
        vendor: {
          vendor: info.vendor || '',
          architecture: info.architecture || '',
          description: info.description || ''
        }
      };
    })();
  }
  return capsPromise;
}

function likelyIntegratedGpu(caps) {
  const v = ((caps.vendor && caps.vendor.vendor) || '').toLowerCase();
  const a = ((caps.vendor && caps.vendor.architecture) || '').toLowerCase();
  return (v === 'intel' && !/arc|xe-hpg|battlemage|alchemist/.test(a)) ||
    (v === 'amd' && /^gcn-/.test(a));
}

export function getUserTier() {
  try {
    const v = localStorage.getItem(LS_PREF);
    return v && TIERS[v] ? v : null;
  } catch (_) { return null; }
}

export function setUserTier(id) {
  try {
    if (!id || !TIERS[id]) { localStorage.removeItem(LS_PREF); return; }
    localStorage.setItem(LS_PREF, id);
    const cap = getTierCap();
    if (cap && TIERS[cap] && TIERS[id].order > TIERS[cap].order) localStorage.removeItem(LS_CAP);
  } catch (_) {}
}

const CAP_TTL_MS = 24 * 3600 * 1000;

export function getTierCap() {
  try {
    const raw = localStorage.getItem(LS_CAP);
    if (!raw) return null;
    const [id, ts] = raw.split('|');
    const age = Date.now() - Number(ts || 0);
    if (!TIERS[id] || !ts || !(age < CAP_TTL_MS)) { localStorage.removeItem(LS_CAP); return null; }
    return id;
  } catch (_) { return null; }
}

function capAllows(id) {
  const cap = getTierCap();
  return !cap || TIERS[id].order <= TIERS[cap].order;
}

export function setTierCap(id) {
  try {
    if (!id || !TIERS[id]) return;
    localStorage.setItem(LS_CAP, id + '|' + Date.now());
  } catch (_) {}
}

export function getValidatedTier() {
  try {
    const v = localStorage.getItem(LS_VALID);
    return v && TIERS[v] ? v : null;
  } catch (_) { return null; }
}

export function setValidatedTier(id) {
  try {
    if (!id || !TIERS[id]) return;
    const cap = getTierCap();
    if (cap && TIERS[id].order > TIERS[cap].order) return;
    const cur = getValidatedTier();
    if (cur && TIERS[cur].order >= TIERS[id].order) return;
    localStorage.setItem(LS_VALID, id);
  } catch (_) {}
}

export function clearValidatedTier() {
  try { localStorage.removeItem(LS_VALID); } catch (_) {}
}

export async function effectiveTier(opts) {
  const cachedOnly = !!(opts && opts.cachedOnly);
  if (typeof navigator === 'undefined' || !navigator.gpu) return null;
  if (IS_IOS) return cachedOnly ? ((await isTierCached('0.8b')) ? '0.8b' : null) : '0.8b';
  const caps = await detectCaps();
  if (!caps) return null;
  const d = await decideTier();
  const eligible = new Set([d.tier].concat(d.eligible || []));
  const cap = getTierCap();
  const allowed = (id) => !cap || TIERS[id].order <= TIERS[cap].order;
  const pref = getUserTier();
  if (!cachedOnly && pref && eligible.has(pref) && allowed(pref)) return pref;
  for (const id of TIER_CHAIN) {
    if (!allowed(id)) continue;
    if (!(await isTierCached(id))) continue;
    if (cachedOnly || eligible.has(id)) return id;
  }
  return cachedOnly ? null : '0.8b';
}

export async function isTierCached(id) {
  try {
    const t = TIERS[id];
    const bases = [t.base];
    const cdn = cdnBaseFor(t);
    if (cdn) bases.push(cdn);
    for (const b of bases) {
      let all = true;
      for (const shard of t.shards) {
        const u = b + shard;
        const meta = u + (u.includes('?') ? '&' : '?') + 'mentria_seg=meta';
        if (!((await caches.match(meta)) || (await caches.match(u)))) { all = false; break; }
      }
      if (all) return true;
    }
    return false;
  } catch (_) { return false; }
}

export async function decideTier() {
  const reasons = [];
  if (typeof navigator === 'undefined' || !navigator.gpu) {
    return { tier: null, eligible: [], reasons: ['no-webgpu'], signals: {} };
  }
  if (IS_IOS) {
    reasons.push('ios hard rule: 0.8b only');
    const d = { tier: '0.8b', eligible: [], reasons, signals: { ios: true } };
    logDecision(d);
    return d;
  }

  const caps = await detectCaps();
  if (!caps) {
    return { tier: null, eligible: [], reasons: ['no-adapter'], signals: {} };
  }

  const conn = navigator.connection || {};
  const saveData = conn.saveData === true;
  const dm = navigator.deviceMemory;
  let quotaFree = 0;
  try {
    const est = await navigator.storage?.estimate?.();
    if (est) quotaFree = (est.quota || 0) - (est.usage || 0);
  } catch (_) {}

  const { canRunLargeModel } = await import(MENTRIA_DIST);

  const big = canRunLargeModel(caps);
  const igpu = likelyIntegratedGpu(caps);
  const hard4 = IS_DESKTOP && big.capable === true;
  const hard27 = hard4 && !igpu;
  const dmOk2 = dm !== undefined ? dm >= 8 : IS_DESKTOP;
  const hard2 = caps.limits.maxBufferSize >= GiB && dmOk2;

  const [cached2, cached4, cached27] = await Promise.all([isTierCached('2b'), isTierCached('4b'), isTierCached('27b')]);
  const offer4 = hard4 && (quotaFree > 6e9 || cached4) && !saveData;
  const offer2 = hard2 && (quotaFree > 3e9 || cached2);
  const offer27 = hard27 && (quotaFree > 9e9 || cached27) && !saveData;

  const eligible = [];
  if (offer2) eligible.push('2b');
  if (offer4) eligible.push('4b');
  if (offer27) eligible.push('27b');

  let tier = '0.8b';
  let why = 'default 0.8b';
  const pref = getUserTier();
  if (pref) {
    const prefHard = pref === '0.8b' || (pref === '2b' && hard2) || (pref === '4b' && hard4) || (pref === '27b' && hard27);
    if (prefHard && capAllows(pref)) {
      tier = pref;
      why = 'user-pref ' + pref;
    } else {
      reasons.push('user-pref ' + pref + ' blocked: ' + (prefHard ? 'tier-cap ' + getTierCap() : 'fails hard gate'));
    }
  }
  reasons.push(why);
  const capNow = getTierCap();
  if (capNow) reasons.push('tier-cap ' + capNow + ' (auto-selection only, expires in 24h)');
  reasons.push(
    'maxBuf=' + (caps.limits.maxBufferSize / GiB).toFixed(1) + 'GiB' +
    ' maxBind=' + (caps.limits.maxStorageBufferBindingSize / GiB).toFixed(1) + 'GiB' +
    ' deviceMemory=' + (dm === undefined ? 'n/a' : dm + 'GB') +
    ' platform=' + (IS_DESKTOP ? 'desktop' : IS_ANDROID ? 'android' : 'other') +
    ' quotaFree=' + Math.round(quotaFree / 1e9) + 'GB' +
    ' saveData=' + saveData +
    ' igpu=' + igpu +
    (getTierCap() ? ' tier-cap=' + getTierCap() : '')
  );

  const d = { tier, eligible, reasons, signals: { caps, dm, quotaFree, saveData } };
  logDecision(d);
  return d;
}

function logDecision(d) {
  try {
    console.info('[mentria-tiers] tier=' + d.tier +
      ' eligible=[' + d.eligible.join(',') + '] ' + d.reasons.join('; '));
  } catch (_) {}
}

export async function loadOptionsFor(id, { vision = true } = {}) {
  const t = TIERS[id];
  if (!t) throw new Error('unknown tier: ' + id);
  const mod = await import(MENTRIA_DIST);
  let config = mod[t.configExport];
  let vendor = '';
  if (t.appleMaxSeq || t.nvidiaMaxSeq || t.discreteMaxSeq) {
    const caps = await detectCaps();
    vendor = ((caps && caps.vendor.vendor) || '').toLowerCase();
    const seq = vendor === 'apple' ? t.appleMaxSeq
      : vendor === 'nvidia' ? (t.nvidiaMaxSeq || t.discreteMaxSeq)
      : t.discreteMaxSeq;
    if (seq && seq !== config.attention.maxSeq) {
      config = { ...config, attention: { ...config.attention, maxSeq: seq } };
    }
  }
  const shardBase = await resolveBase(t);
  const opts = {
    modelUrl: shardBase,
    shards: t.shards.slice(),
    config,
    allowTiedEmbed: true,
    tokenizerUrl: shardBase
  };
  if (vendor === 'nvidia' && t.nvidiaMaxSeq) opts.residualFusion = true;
  if (vendor === 'apple' && t.appleMaxSeq) opts.kvF16 = true;
  if (t.streamingLoad) opts.streamingLoad = true;
  if (vision) {
    opts.visionModelUrl = shardBase;
    opts.visionShards = t.visionShards.slice();
    opts.visionConfig = t.visionConfigExport ? mod[t.visionConfigExport] : t.visionConfig;
  }
  return opts;
}

const CDN_MODELS = 'https://cdn.mentria.ai/models/';
let basePicks = null;

function cdnBaseFor(t) {
  const m = (t.base || '').match(/huggingface\.co\/mentriaai\/([^/]+)\//);
  return m ? CDN_MODELS + m[1] + '/' : null;
}

async function cachedBaseFor(t, cdn) {
  try {
    const c = await caches.open('mentria-models');
    for (const b of [cdn, t.base]) {
      if (!b) continue;
      const u = b + t.shards[0];
      const sep = u.includes('?') ? '&' : '?';
      if (await c.match(u + sep + 'mentria_seg=meta') || await c.match(u)) return b;
    }
  } catch (_) {}
  return null;
}

export async function resolveBase(t) {
  const cdn = cdnBaseFor(t);
  if (!cdn) return t.base;
  const cached = await cachedBaseFor(t, cdn);
  if (cached) return cached;
  if (basePicks === null) {
    try { basePicks = JSON.parse(sessionStorage.getItem('mentria-model-base') || '{}'); } catch (_) { basePicks = {}; }
  }
  const hit = basePicks[cdn];
  if (hit && Date.now() - hit.t < 3600000) return hit.ok ? cdn : t.base;
  let ok = false;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 2500);
    const res = await fetch(cdn + t.shards[0], { method: 'HEAD', signal: ctl.signal });
    clearTimeout(timer);
    ok = res.ok;
  } catch (_) {}
  basePicks[cdn] = { ok, t: Date.now() };
  try { sessionStorage.setItem('mentria-model-base', JSON.stringify(basePicks)); } catch (_) {}
  return ok ? cdn : t.base;
}

export async function loadWithFallback(createEngine, startTier, { vision = true, onFallback = null, validate = null } = {}) {
  const chain = TIER_CHAIN.slice(TIER_CHAIN.indexOf(startTier));
  let lastErr = null;
  for (let i = 0; i < chain.length; i++) {
    const id = chain[i];
    const engine = createEngine();
    try {
      await engine.init();
      const opts = await loadOptionsFor(id, { vision });
      const loadRes = await engine.loadModel(opts);
      try {
        if (loadRes && loadRes.decodeRoute) console.info('[mentria-tiers] ' + id + ' loaded', 'decodeRoute', loadRes.decodeRoute, 'adapter', loadRes.adapter);
      } catch (_) {}
      if (validate) await validate(engine, id);
      return { engine, tier: id, maxSeq: (opts.config.attention && opts.config.attention.maxSeq) || 2048 };
    } catch (err) {
      lastErr = err;
      try { engine.terminate(); } catch (_) {}
      const next = chain[i + 1];
      console.warn('[mentria-tiers] load failed for ' + id +
        (next ? ' — falling back to ' + next : ' — no tier left'), err);
      if (next) {
        setTierCap(next);
        if (onFallback) { try { onFallback(id, next, err); } catch (_) {} }
      }
    }
  }
  throw lastErr;
}
