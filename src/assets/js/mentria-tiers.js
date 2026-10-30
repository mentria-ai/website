const MENTRIA_DIST = '/assets/mentria/dist/mentria.mjs';
const LS_PREF = 'mentria-tier';
const LS_CAP = 'mentria-tier-cap';
const LS_VALID = 'mentria-tier-validated';
const LS_FAMILY = 'mentria-model-family';
const GiB = 1073741824;
const DEFAULT_FAMILY = 'b2';

export const FAMILY = (() => {
  try { return localStorage.getItem(LS_FAMILY) === 'q4' ? 'q4' : DEFAULT_FAMILY; } catch (_) { return DEFAULT_FAMILY; }
})();

const CHAINS = {
  b2: ['27b', 'b2-9b', 'b2-4b', 'b2-2b'],
  q4: ['27b', '4b', '2b', '0.8b']
};
const LEGACY_FAMILY = FAMILY === 'b2' ? 'q4' : 'b2';

export const TIER_CHAIN = CHAINS[FAMILY];
export const LEGACY_CHAIN = CHAINS[LEGACY_FAMILY].filter((id) => id !== '27b');
export const SMALL_TIER = TIER_CHAIN[TIER_CHAIN.length - 1];

export const TIERS = {
  '0.8b': {
    id: '0.8b',
    family: 'q4',
    name: '0.8B',
    sizeLabel: '490 MB',
    base: 'https://huggingface.co/mentriaai/Qwen3.5-0.8B-mentria/resolve/main/',
    shards: ['qwen3.5-0.8b-q4-tied.safetensors'],
    visionShards: ['qwen3.5-0.8b-vl-q4.safetensors'],
    configExport: 'QWEN35_08B_CONFIG',
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
    family: 'q4',
    name: '2B',
    sizeLabel: '1.4 GB',
    base: 'https://huggingface.co/mentriaai/Qwen3.5-2B-mentria/resolve/main/',
    shards: ['qwen3.5-2b-q4-tied.safetensors'],
    visionShards: ['qwen3.5-2b-vl-q4.safetensors'],
    configExport: 'QWEN35_2B_CONFIG',
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
    family: 'q4',
    name: '4B',
    sizeLabel: '2.8 GB',
    base: 'https://huggingface.co/mentriaai/Qwen3.5-4B-mentria/resolve/main/',
    shards: [
      'qwen3.5-4b-q4-tied-00001-of-00002.safetensors',
      'qwen3.5-4b-q4-tied-00002-of-00002.safetensors'
    ],
    visionShards: ['qwen3.5-4b-vl-q4.safetensors'],
    configExport: 'QWEN35_4B_CONFIG',
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
  'b2-2b': {
    id: 'b2-2b',
    family: 'b2',
    name: '2B',
    sizeLabel: '520 MB',
    base: 'https://huggingface.co/mentriaai/Ternary-Bonsai-2-2B-mentria/resolve/main/',
    shards: ['bonsai2-2b-q2g128.safetensors'],
    visionShards: ['qwen3.5-2b-vl-q4.safetensors'],
    configExport: 'QWEN35_2B_CONFIG',
    visionConfigExport: 'QWEN35_VL_2B_VISION_CONFIG',
    streamingLoad: true
  },
  'b2-4b': {
    id: 'b2-4b',
    family: 'b2',
    name: '4B',
    sizeLabel: '1.1 GB',
    base: 'https://huggingface.co/mentriaai/Ternary-Bonsai-2-4B-mentria/resolve/main/',
    shards: ['bonsai2-4b-q2g128.safetensors'],
    visionShards: ['qwen3.5-4b-vl-q4.safetensors'],
    configExport: 'QWEN35_4B_CONFIG',
    visionConfigExport: 'QWEN35_VL_4B_VISION_CONFIG',
    streamingLoad: true,
    desktopMaxSeq: 4096
  },
  'b2-9b': {
    id: 'b2-9b',
    family: 'b2',
    name: '9B',
    sizeLabel: '2.4 GB',
    base: 'https://huggingface.co/mentriaai/Ternary-Bonsai-2-9B-mentria/resolve/main/',
    shards: [
      'bonsai2-9b-q2g128-00001-of-00002.safetensors',
      'bonsai2-9b-q2g128-00002-of-00002.safetensors'
    ],
    visionShards: ['qwen3.5-9b-vl-q4.safetensors'],
    configExport: 'QWEN35_9B_BONSAI2_CONFIG',
    visionConfigExport: 'QWEN35_VL_9B_VISION_CONFIG',
    streamingLoad: true,
    desktopMaxSeq: 4096
  },
  '27b': {
    id: '27b',
    family: 'bonsai',
    name: '27B',
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
    appleMaxSeq: 16384,
    nvidiaMaxSeq: 3072,
    discreteMaxSeq: 1024
  }
};

for (const id of Object.keys(TIERS)) {
  const i = TIER_CHAIN.indexOf(id);
  TIERS[id].order = i >= 0 ? TIER_CHAIN.length - 1 - i : -1;
  TIERS[id].legacy = i < 0;
}

export function isLegacyTier(id) { return !!(TIERS[id] && TIERS[id].legacy); }

const SLOT_MAP = { '0.8b': 'b2-2b', '2b': 'b2-4b', '4b': 'b2-9b' };

(function migrateStoredTiers() {
  try {
    const map = FAMILY === 'b2' ? SLOT_MAP : Object.fromEntries(Object.entries(SLOT_MAP).map(([a, b]) => [b, a]));
    const pref = localStorage.getItem(LS_PREF);
    if (map[pref]) localStorage.setItem(LS_PREF, map[pref]);
    const cap = (localStorage.getItem(LS_CAP) || '').split('|')[0];
    if (cap && TIERS[cap] && TIERS[cap].legacy) localStorage.removeItem(LS_CAP);
  } catch (_) {}
})();

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
    if (!id || !TIERS[id] || TIERS[id].legacy) return;
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
    if (!TIERS[id].legacy) purgeLegacyModels();
    const cur = getValidatedTier();
    if (cur && TIERS[cur].order >= TIERS[id].order) return;
    localStorage.setItem(LS_VALID, id);
  } catch (_) {}
}

let purging = null;
export function purgeLegacyModels() {
  if (FAMILY !== 'b2' || typeof caches === 'undefined') return Promise.resolve(0);
  if (purging) return purging;
  const repos = LEGACY_CHAIN.map((id) => repoOf(TIERS[id])).filter(Boolean);
  purging = (async () => {
    let n = 0;
    try {
      const c = await caches.open('mentria-models');
      for (const req of await c.keys()) {
        const path = new URL(req.url).pathname;
        if (repos.some((r) => path.indexOf('/' + r + '/') >= 0) && await c.delete(req)) n++;
      }
      if (n) console.info('[mentria-tiers] removed ' + n + ' cached files of retired models');
    } catch (_) {}
    return n;
  })();
  return purging;
}

export function stripThink(text) {
  const s = String(text || '');
  const i = s.lastIndexOf('</think>');
  if (i < 0) return s;
  const after = s.slice(i + 8).replace(/^\s+/, '');
  return after || s.slice(0, i).replace(/<think>/g, '').trim();
}

export function clearValidatedTier() {
  try { localStorage.removeItem(LS_VALID); } catch (_) {}
}

export async function effectiveTier(opts) {
  const cachedOnly = !!(opts && opts.cachedOnly);
  if (typeof navigator === 'undefined' || !navigator.gpu) return null;
  if (IS_IOS) {
    if (!cachedOnly) return SMALL_TIER;
    for (const id of [SMALL_TIER].concat(LEGACY_CHAIN.slice(-1))) if (await isTierCached(id)) return id;
    return null;
  }
  const caps = await detectCaps();
  if (!caps) return null;
  if (cachedOnly) {
    for (const id of TIER_CHAIN.concat(LEGACY_CHAIN)) {
      if (capAllows(id) && await isTierCached(id)) return id;
    }
    return null;
  }
  const d = await decideTier();
  const eligible = new Set([d.tier].concat(d.eligible || []));
  const cap = getTierCap();
  const allowed = (id) => !cap || TIERS[id].order <= TIERS[cap].order;
  const pref = getUserTier();
  if (pref && eligible.has(pref) && allowed(pref)) return pref;
  for (const id of TIER_CHAIN) {
    if (!allowed(id)) continue;
    if (!(await isTierCached(id))) continue;
    if (eligible.has(id)) return id;
  }
  return SMALL_TIER;
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
    reasons.push('ios hard rule: ' + SMALL_TIER + ' only');
    const d = { tier: SMALL_TIER, eligible: [], reasons, signals: { ios: true } };
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
  const arch = String((caps.vendor && caps.vendor.architecture) || '');
  const androidFlagship = FAMILY === 'q4' && IS_ANDROID && /^adreno-8/.test(arch) && caps.limits.maxBufferSize >= 2 * GiB && caps.limits.maxStorageBufferBindingSize >= GiB;
  if (androidFlagship) reasons.push('android flagship gpu ' + arch + ': 4b allowed');
  const hard4 = (IS_DESKTOP && big.capable === true) || androidFlagship;
  const hard27 = IS_DESKTOP && hard4 && !igpu;
  const dmOk2 = dm !== undefined ? dm >= 8 : IS_DESKTOP;
  const hard2 = caps.limits.maxBufferSize >= GiB && dmOk2;

  const [mid, top] = [TIER_CHAIN[2], TIER_CHAIN[1]];
  const [cached2, cached4, cached27] = await Promise.all([isTierCached(mid), isTierCached(top), isTierCached('27b')]);
  const offer4 = hard4 && (quotaFree > 6e9 || cached4) && !saveData;
  const offer2 = hard2 && (quotaFree > 3e9 || cached2);
  const offer27 = hard27 && (quotaFree > 9e9 || cached27) && !saveData;

  const eligible = [];
  if (offer2) eligible.push(mid);
  if (offer4) eligible.push(top);
  if (offer27) eligible.push('27b');

  let tier = SMALL_TIER;
  let why = 'default ' + SMALL_TIER;
  const pref = getUserTier();
  if (pref && TIERS[pref].legacy) {
    reasons.push('user-pref ' + pref + ' is a retired tier');
  } else if (pref) {
    const prefHard = pref === SMALL_TIER || (pref === mid && hard2) || (pref === top && hard4) || (pref === '27b' && hard27);
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
    ' family=' + FAMILY +
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
  if (t.desktopMaxSeq && IS_DESKTOP && t.desktopMaxSeq !== config.attention.maxSeq) {
    config = { ...config, attention: { ...config.attention, maxSeq: t.desktopMaxSeq } };
  }
  const shardBase = await resolveBase(t);
  const opts = {
    modelUrl: shardBase,
    shards: t.shards.slice(),
    config,
    allowTiedEmbed: true,
    tokenizerUrl: shardBase,
    weightUpload: 'writeBuffer'
  };
  if (vendor === 'nvidia' && t.nvidiaMaxSeq) { opts.residualFusion = true; opts.q1Decode = 'lut'; opts.q1Concat = 'all'; opts.bindGroupCache = true; opts.q1LutSkew = true; opts.prefillTile = 'arow'; opts.specSlots = 1; opts.residentTrim = 'all'; }
  if (vendor === 'apple' && t.appleMaxSeq) { opts.kvF16 = true; opts.flashDecode = true; opts.prefillTile = 'wmap+bn128'; opts.specSlots = 1; opts.residentTrim = 'all'; opts.loraFuse = 'epilogue'; }
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

function repoOf(t) {
  const m = ((t && t.base) || '').match(/huggingface\.co\/mentriaai\/([^/]+)\//);
  return m ? m[1] : null;
}

function cdnBaseFor(t) {
  const r = repoOf(t);
  return r ? CDN_MODELS + r + '/' : null;
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
  if (hit && hit.base && Date.now() - hit.t < 3600000) return hit.base;
  const ctls = [new AbortController(), new AbortController()];
  const timer = setTimeout(() => ctls.forEach((c) => c.abort()), PROBE_MS);
  let pick = t.base;
  try {
    pick = await Promise.any([probeBase(cdn, t.shards[0], ctls[0].signal), probeBase(t.base, t.shards[0], ctls[1].signal)]);
  } catch (_) {}
  clearTimeout(timer);
  ctls.forEach((c) => c.abort());
  basePicks[cdn] = { base: pick, t: Date.now() };
  try { sessionStorage.setItem('mentria-model-base', JSON.stringify(basePicks)); } catch (_) {}
  return pick;
}

const PROBE_BYTES = 1048576;
const PROBE_MS = 3000;

async function probeBase(base, file, signal) {
  const res = await fetch(base + file, { headers: { Range: 'bytes=0-' + (PROBE_BYTES - 1) }, cache: 'no-store', signal });
  if (!res.ok || !res.body) throw new Error('probe ' + res.status);
  const reader = res.body.getReader();
  let got = 0;
  while (got < PROBE_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    got += value.byteLength;
  }
  reader.cancel().catch(() => {});
  if (got < Math.min(PROBE_BYTES, 65536)) throw new Error('probe short');
  return base;
}

export async function loadWithFallback(createEngine, startTier, { vision = true, onFallback = null, validate = null, aborted = null, onlyCached = false } = {}) {
  const order = onlyCached ? TIER_CHAIN.concat(LEGACY_CHAIN) : TIER_CHAIN;
  let chain = order.slice(Math.max(0, order.indexOf(startTier)));
  if (onlyCached) {
    const kept = [];
    for (const id of chain) {
      if (!kept.length || await isTierCached(id)) kept.push(id);
    }
    chain = kept;
  }
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
      const proven = getValidatedTier();
      if (!TIERS[id].legacy && proven && !TIERS[proven].legacy) purgeLegacyModels();
      return { engine, tier: id, maxSeq: (opts.config.attention && opts.config.attention.maxSeq) || 2048, decodeRoute: (loadRes && loadRes.decodeRoute) || null };
    } catch (err) {
      lastErr = err;
      try { engine.terminate(); } catch (_) {}
      if (aborted && aborted()) throw err;
      const next = chain[i + 1];
      const lower = TIERS[id].legacy ? null : TIER_CHAIN[TIER_CHAIN.indexOf(id) + 1];
      console.warn('[mentria-tiers] load failed for ' + id +
        (next ? ' — falling back to ' + next : ' — no tier left'), err);
      if (lower) setTierCap(lower);
      if (next && onFallback) { try { onFallback(id, next, err); } catch (_) {} }
    }
  }
  throw lastErr;
}
