const DIST = '/assets/mentria/dist/';
const MODELS_TTL_MS = 300000;

export const createLocalEngine = ({ idleMs = 600000 } = {}) => {
  let engine = null;
  let tier = null;
  let contextTokens = 2048;
  let idleTimer = 0;
  let loading = null;
  let listed = null;
  let listedAt = 0;

  const unload = async () => {
    clearTimeout(idleTimer);
    idleTimer = 0;
    const e = engine;
    engine = null;
    tier = null;
    if (!e) return;
    try { await e.unload(); } catch (_) {}
    try { e.terminate(); } catch (_) {}
  };

  const models = async () => {
    if (!listed || Date.now() - listedAt > MODELS_TTL_MS) {
      const M = await import('/assets/js/mentria-model.js');
      listed = await M.hostModels();
      listedAt = Date.now();
    }
    return listed.map((m) => ({ tier: m.tier, state: m.tier === tier ? 'loaded' : 'cached' }));
  };

  const load = async (want, onStage) => {
    clearTimeout(idleTimer);
    idleTimer = 0;
    if (loading) { try { await loading; } catch (_) {} }
    if (engine && tier === want) return { engine, tier, contextTokens };
    await unload();
    if (onStage) onStage('loading');
    loading = (async () => {
      const [M, D] = await Promise.all([import('/assets/js/mentria-model.js'), import(DIST + 'mentria.mjs')]);
      const res = await M.ensureModel(() => new D.MentriaEngine(DIST + 'worker.mjs'), { cachedOnly: true, tier: want });
      engine = res.engine;
      tier = res.tier;
      contextTokens = res.maxSeq || 2048;
    })();
    try { await loading; } finally { loading = null; }
    return { engine, tier, contextTokens };
  };

  const idle = () => {
    clearTimeout(idleTimer);
    idleTimer = engine ? setTimeout(() => { unload(); }, idleMs) : 0;
  };

  return { models, load, idle, unload, current: () => tier };
};
