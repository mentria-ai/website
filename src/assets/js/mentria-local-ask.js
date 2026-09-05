const DIST = '/assets/mentria/dist/';
const CHANNEL_NAME = 'mentria-local-ask';
const TAB = Math.random().toString(36).slice(2);
const IMAGE_MAX_SIDE = 448;
let enginePromise = null;
let engineVision = false;
let queue = Promise.resolve();
let hostGen = null;
let hostBusy = () => false;
let hostTier = '';
let hostVision = false;
const pending = new Map();
const channels = [];
let currentReq = null;

function tr(key, fallback) {
  try {
    const I = window.MentriaI18n;
    if (I && I.t) { const v = I.t(key); if (v != null && v !== key) return v; }
  } catch (_) {}
  return fallback;
}

function progress(p) {
  if (!p) return;
  const pct = p.loaded != null && p.total > 0 ? Math.round(Math.min(1, p.loaded / p.total) * 100) : null;
  const message = (p.message || '') + (pct != null ? ' ' + pct + '%' : '');
  const req = currentReq || {};
  emit('progress', { source: req.source || '', prompt: req.prompt || '', message: message, pct: pct });
  if (req.onProgress) { try { req.onProgress(message, pct); } catch (_) {} }
}

async function chooseTier(Tiers, offer) {
  const current = (await Tiers.effectiveTier()) || '0.8b';
  if (current === '27b') return current;
  const decision = await Tiers.decideTier();
  const eligible = new Set([decision.tier].concat(decision.eligible || []));
  const cap = Tiers.getTierCap ? Tiers.getTierCap() : null;
  const capped = cap && Tiers.TIERS[cap] && Tiers.TIERS[cap].order < Tiers.TIERS['27b'].order;
  if (!eligible.has('27b') || capped) return current;
  if (await Tiers.isTierCached('27b')) { try { Tiers.setUserTier('27b'); } catch (_) {} return '27b'; }
  if (!offer || typeof window.mentriaConfirm !== 'function') return current;
  const ok = await window.mentriaConfirm(tr('webmcp.offer_27b', "This site's AI runs best on the 27B on-device model: about 3.8 GB, downloaded once and kept on this device (tested on Apple Silicon with 16 GB+ memory and NVIDIA GPUs with 6 GB+). Download it now? Otherwise a smaller model is used."));
  if (!ok) return current;
  Tiers.setUserTier('27b');
  return (await Tiers.effectiveTier()) === '27b' ? '27b' : current;
}

export function localAskSupported() {
  return !!navigator.gpu;
}

async function tiers() {
  return import('/assets/js/mentria-tiers.js');
}

export async function modelInfo() {
  const Tiers = await tiers();
  const id = (await Tiers.isTierCached('27b')) ? '27b' : ((await Tiers.effectiveTier()) || '0.8b');
  const t = Tiers.TIERS[id];
  return { tier: id, sizeLabel: t ? t.sizeLabel : '', cached: await Tiers.isTierCached(id) };
}

export async function isModelCached() {
  return (await modelInfo()).cached;
}

export function debugState() {
  return { tab: TAB, hosting: !!hostGen, hostVision: hostVision, loaded: !!enginePromise, vision: engineVision, pending: pending.size, channels: channels.length };
}

function emit(phase, detail) {
  try {
    window.dispatchEvent(new CustomEvent('mentria:localask', { detail: Object.assign({ phase: phase }, detail) }));
  } catch (_) {}
}

function post(m) {
  for (const ch of channels) {
    try { ch.postMessage(m); } catch (_) {}
  }
}

export function addChannel(ch) {
  if (!ch || typeof ch.postMessage !== 'function' || typeof ch.addEventListener !== 'function') return () => {};
  channels.push(ch);
  ch.addEventListener('message', onMessage);
  if (hostGen) { try { ch.postMessage({ t: 'host', tab: TAB, tier: hostTier, vision: hostVision }); } catch (_) {} }
  return () => {
    const i = channels.indexOf(ch);
    if (i !== -1) channels.splice(i, 1);
    try { ch.removeEventListener('message', onMessage); } catch (_) {}
  };
}

export function hostWith(generate, isBusy, tier, vision) {
  hostGen = generate;
  hostBusy = typeof isBusy === 'function' ? isBusy : () => false;
  hostTier = tier || hostTier || '';
  hostVision = !!vision;
  post({ t: 'host', tab: TAB, tier: hostTier, vision: hostVision });
}

const TIER_RANK = { '0.8b': 0, '2b': 1, '4b': 2, '27b': 3 };

function findHost(timeoutMs, needVision) {
  if (!channels.length) return Promise.resolve(null);
  return new Promise((resolve) => {
    const hosts = [];
    const onMsg = (ev) => {
      const m = ev.data || {};
      if (m.t === 'host' && m.tab !== TAB && (!m.to || m.to === TAB) && (!needVision || m.vision)) hosts.push({ tab: m.tab, rank: TIER_RANK[m.tier] || 0 });
    };
    for (const ch of channels) ch.addEventListener('message', onMsg);
    post({ t: 'who', tab: TAB });
    setTimeout(() => {
      for (const ch of channels) { try { ch.removeEventListener('message', onMsg); } catch (_) {} }
      hosts.sort((a, b) => b.rank - a.rank);
      resolve(hosts.length ? hosts[0].tab : null);
    }, timeoutMs);
  });
}

function askRemote(host, system, user, maxTokens, onToken, image, adapter) {
  return new Promise((resolve, reject) => {
    const reqId = TAB + '-' + Math.random().toString(36).slice(2);
    let timer = 0;
    const fail = (msg) => { clearTimeout(timer); pending.delete(reqId); reject(new Error(msg)); };
    const arm = (ms, msg) => { clearTimeout(timer); timer = setTimeout(() => fail(msg), ms); };
    pending.set(reqId, {
      host: host,
      ack: () => arm(180000, 'host-gone'),
      token: (m) => {
        arm(120000, 'host-gone');
        if (onToken) { try { onToken(m.token, m.full); } catch (_) {} }
      },
      done: (m) => { clearTimeout(timer); pending.delete(reqId); remoteAdapter = m.adapter == null ? null : String(m.adapter); resolve(m.answer); },
      error: (m) => fail(m.message || 'remote-error'),
      busy: () => fail('host-busy')
    });
    arm(4000, 'host-gone');
    post({ t: 'ask', to: host, from: TAB, reqId: reqId, system: system, user: user, maxTokens: maxTokens, image: image || null, adapter: adapter === undefined ? undefined : adapter });
  });
}

async function onMessage(ev) {
  const m = ev.data || {};
  if (m.t === 'who') {
    if (hostGen && m.tab !== TAB) post({ t: 'host', tab: TAB, to: m.tab, tier: hostTier, vision: hostVision });
    return;
  }
  if (m.t === 'gone') {
    for (const [id, p] of pending) if (p.host === m.tab) p.error({ message: 'host-gone' });
    return;
  }
  if (m.t === 'ask') {
    if (m.to !== TAB) return;
    if (!hostGen) { post({ t: 'error', reqId: m.reqId, message: 'no-host' }); return; }
    if (m.image && !hostVision) { post({ t: 'error', reqId: m.reqId, message: 'no-vision' }); return; }
    if (hostBusy()) { post({ t: 'busy', reqId: m.reqId }); return; }
    post({ t: 'ack', reqId: m.reqId });
    const run = queue.then(async () => {
      try {
        const answer = await hostGen(m.system, m.user, m.maxTokens, (token, full) => post({ t: 'token', reqId: m.reqId, token: token, full: full }), m.image || null, m.adapter);
        post({ t: 'done', reqId: m.reqId, answer: answer, adapter: activeAdapter });
      } catch (e) {
        post({ t: 'error', reqId: m.reqId, message: (e && e.message) || String(e) });
      }
    });
    queue = run.catch(() => {});
    return;
  }
  const p = pending.get(m.reqId);
  if (p && typeof p[m.t] === 'function') p[m.t](m);
}

try {
  addChannel(new BroadcastChannel(CHANNEL_NAME));
} catch (_) {}
window.addEventListener('pagehide', () => {
  if (hostGen) post({ t: 'gone', tab: TAB });
});

export async function imageToRgb(source, maxSide) {
  if (source && source.rgbHwc && source.w && source.h) return { rgbHwc: source.rgbHwc, h: source.h, w: source.w };
  const limit = maxSide || IMAGE_MAX_SIDE;
  let bitmap = source;
  if (typeof Blob !== 'undefined' && source instanceof Blob) bitmap = await createImageBitmap(source);
  const sw = bitmap.videoWidth || bitmap.naturalWidth || bitmap.width;
  const sh = bitmap.videoHeight || bitmap.naturalHeight || bitmap.height;
  if (!sw || !sh) throw new Error('image-empty');
  const scale = Math.min(1, limit / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const rgbHwc = new Uint8Array(w * h * 3);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) { rgbHwc[j] = data[i]; rgbHwc[j + 1] = data[i + 1]; rgbHwc[j + 2] = data[i + 2]; }
  return { rgbHwc: rgbHwc, h: h, w: w };
}

function loadLocalModel(needVision) {
  if (enginePromise && needVision && !engineVision) {
    const old = enginePromise;
    enginePromise = null;
    old.then((r) => { try { r.engine.terminate(); } catch (_) {} }).catch(() => {});
  }
  if (!enginePromise) {
    engineVision = !!needVision;
    enginePromise = (async () => {
      const [{ MentriaEngine }, Tiers] = await Promise.all([
        import(DIST + 'mentria.mjs'),
        tiers()
      ]);
      const tier = await chooseTier(Tiers, !(currentReq && currentReq.source === 'agent'));
      if (window.MentriaUI && window.MentriaUI.toast) window.MentriaUI.toast(tr('webmcp.loading_model', 'Loading the on-device model for a private AI task…'));
      const make = () => {
        const e = new MentriaEngine(DIST + 'worker.mjs');
        if (window.mentriaWrapEngine) window.mentriaWrapEngine(e);
        e.onProgress = progress;
        return e;
      };
      const cached = await Tiers.isTierCached(tier);
      if (!cached && typeof window.mentriaConfirmHeavyDownload === 'function') {
        const okDl = await Promise.race([window.mentriaConfirmHeavyDownload(), new Promise((r) => setTimeout(() => r(false), 90000))]);
        if (!okDl) throw new Error('download-postponed');
      }
      try {
        const P2P = await import('/assets/js/mentria-p2p-models.js');
        await Promise.race([
          P2P.prefetchTier(Tiers, tier),
          new Promise((r) => setTimeout(r, 480000))
        ]);
      } catch (_) {}
      const res = await Tiers.loadWithFallback(make, tier, { vision: !!needVision });
      try { if (Tiers.setValidatedTier) Tiers.setValidatedTier(res.tier || tier); } catch (_) {}
      hostWith(localGenerate, () => false, res.tier || tier, !!needVision);
      return { engine: res.engine, maxSeq: res.maxSeq || 2048, tier: res.tier || tier, vision: !!needVision };
    })();
    enginePromise.catch(() => { enginePromise = null; });
  }
  return enginePromise;
}

let activeAdapter = null;
let remoteAdapter = null;
export function activeAdapterName() { return activeAdapter != null ? activeAdapter : remoteAdapter; }
async function ensureAdapter(engine, tier, adapter) {
  if (adapter === undefined) return activeAdapter;
  if (adapter === null) {
    if (activeAdapter) { try { await engine.unloadAdapter(activeAdapter); } catch (_) {} activeAdapter = null; }
    return null;
  }
  const name = String(adapter.name || 'adapter');
  if (activeAdapter === name) return activeAdapter;
  const Tiers = await tiers();
  const base = adapter.base || (Tiers.TIERS[tier] && Tiers.TIERS[tier].base) || '';
  const path = adapter.path ? String(adapter.path).replace(/\/?$/, '/') : '';
  const spec = { name: name, configUrl: adapter.configUrl || (base + path + 'adapter_config.json'), weightsUrl: adapter.weightsUrl || (base + path + 'adapter_model.safetensors') };
  await engine.swapAdapter(spec);
  activeAdapter = name;
  return activeAdapter;
}

export function warmLocalModel(opts) {
  const o = opts || {};
  return loadLocalModel(!!o.vision).then(async (r) => {
    let adapter = activeAdapter;
    if (o.adapter !== undefined) { try { adapter = await ensureAdapter(r.engine, r.tier, o.adapter); } catch (e) { adapter = activeAdapter; } }
    return { tier: r.tier, vision: r.vision, maxSeq: r.maxSeq, adapter: adapter };
  });
}

async function localGenerate(system, user, maxTokens, onToken, image, adapter) {
  const { engine, tier } = await loadLocalModel(!!image);
  await ensureAdapter(engine, tier, adapter);
  let out = '';
  const params = {
    messages: image
      ? [{ role: 'system', content: system }, { role: 'user', content: [{ type: 'image' }, { type: 'text', text: user }] }]
      : [{ role: 'system', content: system }, { role: 'user', content: user }],
    maxTokens: maxTokens || 220,
    temperature: 0, topK: 1, topP: 1, repetitionPenalty: image ? 1.15 : 1.0, enableThinking: false
  };
  if (image) params.images = [image];
  await engine.generate(params, (ev) => {
    if (typeof ev.token === 'string') {
      if (/^<\|[^|]*\|>$/.test(ev.token)) return;
      out += ev.token;
      if (onToken) { try { onToken(ev.token, out); } catch (_) {} }
    }
  });
  return out.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<\|[a-z_]+\|>/gi, '').trim();
}

async function viaHost(system, user, maxTokens, onToken, image, adapter) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const host = await findHost(350, !!image);
    if (!host) return null;
    try {
      return await askRemote(host, system, user, maxTokens, onToken, image, adapter);
    } catch (e) {
      if (e.message === 'host-gone' || e.message === 'no-vision' || e.message === 'no-host') return null;
      if (e.message !== 'host-busy') throw e;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw new Error('host-busy');
}

async function waitHostIdle() {
  for (let i = 0; i < 480 && hostBusy(); i++) await new Promise((r) => setTimeout(r, 250));
  if (hostBusy()) throw new Error('host-busy');
}

export function askLocal(system, user, opts) {
  const o = opts || {};
  const shown = o.display || user;
  const maxTokens = o.maxTokens || 220;
  const run = queue.then(async () => {
    emit('start', { source: o.source || '', prompt: shown });
    currentReq = { source: o.source || '', prompt: shown, onProgress: o.onProgress || null };
    try {
      const image = o.image ? await imageToRgb(o.image, o.imageMaxSide) : null;
      let answer = null;
      if (hostGen && !enginePromise && (!image || hostVision)) {
        await waitHostIdle();
        answer = await hostGen(system, user, maxTokens, o.onToken, image, o.adapter);
      } else if (!enginePromise || (image && !engineVision)) {
        answer = await viaHost(system, user, maxTokens, o.onToken, image, o.adapter);
      }
      if (answer == null) answer = await localGenerate(system, user, maxTokens, o.onToken, image, o.adapter);
      emit('answer', { source: o.source || '', prompt: shown, answer: answer });
      return answer;
    } catch (e) {
      emit('error', { source: o.source || '', prompt: shown, message: (e && e.message) || String(e) });
      throw e;
    } finally {
      currentReq = null;
    }
  });
  queue = run.catch(() => {});
  return run;
}
