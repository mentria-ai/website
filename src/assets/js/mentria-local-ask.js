const DIST = '/assets/mentria/dist/';
const CHANNEL_NAME = 'mentria-local-ask';
const TAB = Math.random().toString(36).slice(2);
let enginePromise = null;
let queue = Promise.resolve();
let hostGen = null;
let hostBusy = () => false;
let hostTier = '';
const pending = new Map();
let channel = null;
try { channel = new BroadcastChannel(CHANNEL_NAME); } catch (_) {}
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
  return { tab: TAB, hosting: !!hostGen, loaded: !!enginePromise, pending: pending.size };
}

function emit(phase, detail) {
  try {
    window.dispatchEvent(new CustomEvent('mentria:localask', { detail: Object.assign({ phase: phase }, detail) }));
  } catch (_) {}
}

function post(m) {
  if (!channel) return;
  try { channel.postMessage(m); } catch (_) {}
}

export function hostWith(generate, isBusy, tier) {
  hostGen = generate;
  hostBusy = typeof isBusy === 'function' ? isBusy : () => false;
  hostTier = tier || hostTier || '';
  post({ t: 'host', tab: TAB, tier: hostTier });
}

const TIER_RANK = { '0.8b': 0, '2b': 1, '4b': 2, '27b': 3 };

function findHost(timeoutMs) {
  if (!channel) return Promise.resolve(null);
  return new Promise((resolve) => {
    const hosts = [];
    const onMsg = (ev) => {
      const m = ev.data || {};
      if (m.t === 'host' && m.tab !== TAB && (!m.to || m.to === TAB)) hosts.push({ tab: m.tab, rank: TIER_RANK[m.tier] || 0 });
    };
    channel.addEventListener('message', onMsg);
    post({ t: 'who', tab: TAB });
    setTimeout(() => {
      channel.removeEventListener('message', onMsg);
      hosts.sort((a, b) => b.rank - a.rank);
      resolve(hosts.length ? hosts[0].tab : null);
    }, timeoutMs);
  });
}

function askRemote(host, system, user, maxTokens, onToken) {
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
      done: (m) => { clearTimeout(timer); pending.delete(reqId); resolve(m.answer); },
      error: (m) => fail(m.message || 'remote-error'),
      busy: () => fail('host-busy')
    });
    arm(4000, 'host-gone');
    post({ t: 'ask', to: host, from: TAB, reqId: reqId, system: system, user: user, maxTokens: maxTokens });
  });
}

if (channel) {
  channel.addEventListener('message', async (ev) => {
    const m = ev.data || {};
    if (m.t === 'who') {
      if (hostGen && m.tab !== TAB) post({ t: 'host', tab: TAB, to: m.tab, tier: hostTier });
      return;
    }
    if (m.t === 'gone') {
      for (const [id, p] of pending) if (p.host === m.tab) p.error({ message: 'host-gone' });
      return;
    }
    if (m.t === 'ask') {
      if (m.to !== TAB) return;
      if (!hostGen) { post({ t: 'error', reqId: m.reqId, message: 'no-host' }); return; }
      if (hostBusy()) { post({ t: 'busy', reqId: m.reqId }); return; }
      post({ t: 'ack', reqId: m.reqId });
      const run = queue.then(async () => {
        try {
          const answer = await hostGen(m.system, m.user, m.maxTokens, (token, full) => post({ t: 'token', reqId: m.reqId, token: token, full: full }));
          post({ t: 'done', reqId: m.reqId, answer: answer });
        } catch (e) {
          post({ t: 'error', reqId: m.reqId, message: (e && e.message) || String(e) });
        }
      });
      queue = run.catch(() => {});
      return;
    }
    const p = pending.get(m.reqId);
    if (p && typeof p[m.t] === 'function') p[m.t](m);
  });
  window.addEventListener('pagehide', () => {
    if (hostGen) post({ t: 'gone', tab: TAB });
  });
}

function loadLocalModel() {
  if (!enginePromise) {
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
      const res = await Tiers.loadWithFallback(make, tier, { vision: false });
      hostWith(localGenerate, () => false, res.tier || tier);
      return { engine: res.engine, maxSeq: res.maxSeq || 2048, tier: res.tier || tier };
    })();
    enginePromise.catch(() => { enginePromise = null; });
  }
  return enginePromise;
}

async function localGenerate(system, user, maxTokens, onToken) {
  const { engine } = await loadLocalModel();
  let out = '';
  await engine.generate({
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    maxTokens: maxTokens || 220,
    temperature: 0, topK: 1, topP: 1, repetitionPenalty: 1.0, enableThinking: false
  }, (ev) => {
    if (typeof ev.token === 'string') {
      out += ev.token;
      if (onToken) { try { onToken(ev.token, out); } catch (_) {} }
    }
  });
  return out.replace(/<\|[a-z_]+\|>/gi, '').trim();
}

async function viaHost(system, user, maxTokens, onToken) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const host = await findHost(350);
    if (!host) return null;
    try {
      return await askRemote(host, system, user, maxTokens, onToken);
    } catch (e) {
      if (e.message === 'host-gone') return null;
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
      let answer = null;
      if (hostGen && !enginePromise) {
        await waitHostIdle();
        answer = await hostGen(system, user, maxTokens, o.onToken);
      } else if (!enginePromise) {
        answer = await viaHost(system, user, maxTokens, o.onToken);
      }
      if (answer == null) answer = await localGenerate(system, user, maxTokens, o.onToken);
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
