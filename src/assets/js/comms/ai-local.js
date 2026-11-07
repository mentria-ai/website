const DIST = '/assets/mentria/dist/';
const MODELS_TTL_MS = 300000;

const realModules = async () => {
  const [M, D] = await Promise.all([import('/assets/js/mentria-model.js'), import(DIST + 'mentria.mjs')]);
  return { M, D };
};

export const createLocalEngine = ({ idleMs = 600000, modules = realModules } = {}) => {
  let ticket = 0;
  let engine = null;
  let tier = null;
  let contextTokens = 2048;
  let idleTimer = 0;
  let loading = null;
  let listed = null;
  let listedAt = 0;

  const unload = async () => {
    ticket += 1;
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
      const { M } = await modules();
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
    const mine = ++ticket;
    if (onStage) onStage('loading');
    loading = (async () => {
      const { M, D } = await modules();
      let fresh = null;
      const res = await M.ensureModel(() => new D.MentriaEngine(DIST + 'worker.mjs'), {
        cachedOnly: true,
        tier: want,
        onDeviceLost: () => { if (fresh && engine === fresh) { engine = null; tier = null; clearTimeout(idleTimer); idleTimer = 0; } try { fresh && fresh.terminate(); } catch (_) {} }
      });
      fresh = res.engine;
      if (mine !== ticket) {
        try { res.engine.terminate(); } catch (_) {}
        throw new Error('unloaded');
      }
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
