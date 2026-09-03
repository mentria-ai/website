const DIST = '/assets/mentria/dist/';
const CHANNEL_NAME = 'mentria-local-ask';
const TAB = Math.random().toString(36).slice(2);
let enginePromise = null;
let queue = Promise.resolve();
let hostGen = null;
let hostBusy = () => false;
const pending = new Map();
let channel = null;
try { channel = new BroadcastChannel(CHANNEL_NAME); } catch (_) {}
let currentReq = null;

function tr(key, fallback) {
  try {
    const I = window.MentriaI18n;
    if (I && I.hasKey && I.hasKey(key)) return I.t(key);
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

async function chooseTier(Tiers) {
  const current = (await Tiers.effectiveTier()) || '0.8b';
  if (current === '27b' || typeof window.mentriaConfirm !== 'function') return current;
  const decision = await Tiers.decideTier();
  const eligible = new Set([decision.tier].concat(decision.eligible || []));
  if (!eligible.has('27b')) return current;
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
  const id = (await Tiers.effectiveTier()) || '0.8b';
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

export function hostWith(generate, isBusy) {
  hostGen = generate;
  hostBusy = typeof isBusy === 'function' ? isBusy : () => false;
  post({ t: 'host', tab: TAB });
}

function findHost(timeoutMs) {
  if (!channel) return Promise.resolve(null);
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      channel.removeEventListener('message', onMsg);
      resolve(v);
    };
    const onMsg = (ev) => {
      const m = ev.data || {};
      if (m.t === 'host' && m.tab !== TAB && (!m.to || m.to === TAB)) finish(m.tab);
    };
    channel.addEventListener('message', onMsg);
    post({ t: 'who', tab: TAB });
    setTimeout(() => finish(null), timeoutMs);
  });
}

function askRemote(host, system, user, maxTokens, onToken) {
  return new Promise((resolve, reject) => {
    const reqId = TAB + '-' + Math.random().toString(36).slice(2);
    let timer = 0;
    const fail = (msg) => { clearTimeout(timer); pending.delete(reqId); reject(new Error(msg)); };
    const arm = (ms, msg) => { clearTimeout(timer); timer = setTimeout(() => fail(msg), ms); };
    pending.set(reqId, {
      ack: () => arm(600000, 'host-gone'),
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
      if (hostGen && m.tab !== TAB) post({ t: 'host', tab: TAB, to: m.tab });
      return;
    }
    if (m.t === 'ask') {
      if (m.to !== TAB) return;
      if (!hostGen) { post({ t: 'error', reqId: m.reqId, message: 'no-host' }); return; }
      if (hostBusy()) { post({ t: 'busy', reqId: m.reqId }); return; }
      post({ t: 'ack', reqId: m.reqId });
      try {
        const answer = await hostGen(m.system, m.user, m.maxTokens, (token, full) => post({ t: 'token', reqId: m.reqId, token: token, full: full }));
        post({ t: 'done', reqId: m.reqId, answer: answer });
      } catch (e) {
        post({ t: 'error', reqId: m.reqId, message: (e && e.message) || String(e) });
      }
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
      const tier = await chooseTier(Tiers);
      if (window.MentriaUI && window.MentriaUI.toast) window.MentriaUI.toast('Loading the on-device model for a private AI task…');
      const make = () => {
        const e = new MentriaEngine(DIST + 'worker.mjs');
        if (window.mentriaWrapEngine) window.mentriaWrapEngine(e);
        e.onProgress = progress;
        return e;
      };
      const cached = await Tiers.isTierCached(tier);
      if (!cached && typeof window.mentriaConfirmHeavyDownload === 'function') {
        const okDl = await window.mentriaConfirmHeavyDownload();
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
      hostWith(localGenerate, () => false);
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
      if (e.message !== 'host-busy') return null;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  return null;
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
      if (!hostGen && !enginePromise) answer = await viaHost(system, user, maxTokens, o.onToken);
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
