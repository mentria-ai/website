const DIST = '/assets/mentria/dist/';
let enginePromise = null;
let queue = Promise.resolve();

export function localAskSupported() {
  return !!navigator.gpu;
}

export async function isModelCached() {
  const Tiers = await import('/assets/js/mentria-tiers.js');
  return Tiers.isTierCached('0.8b');
}

function emit(phase, detail) {
  try {
    window.dispatchEvent(new CustomEvent('mentria:localask', { detail: Object.assign({ phase: phase }, detail) }));
  } catch (_) {}
}

function loadLocalModel() {
  if (!enginePromise) {
    enginePromise = (async () => {
      const [{ MentriaEngine }, Tiers] = await Promise.all([
        import(DIST + 'mentria.mjs'),
        import('/assets/js/mentria-tiers.js')
      ]);
      if (window.MentriaUI && window.MentriaUI.toast) window.MentriaUI.toast('Loading the on-device model for a private AI task…');
      const make = () => {
        const e = new MentriaEngine(DIST + 'worker.mjs');
        if (window.mentriaWrapEngine) window.mentriaWrapEngine(e);
        return e;
      };
      const cached = await Tiers.isTierCached('0.8b');
      if (!cached && typeof window.mentriaConfirmHeavyDownload === 'function') {
        const okDl = await window.mentriaConfirmHeavyDownload();
        if (!okDl) throw new Error('download-postponed');
      }
      try {
        const P2P = await import('/assets/js/mentria-p2p-models.js');
        await Promise.race([
          P2P.prefetchTier(Tiers, '0.8b'),
          new Promise((r) => setTimeout(r, 480000))
        ]);
      } catch (_) {}
      const res = await Tiers.loadWithFallback(make, '0.8b', { vision: false });
      return { engine: res.engine, maxSeq: res.maxSeq || 2048 };
    })();
    enginePromise.catch(() => { enginePromise = null; });
  }
  return enginePromise;
}

export function askLocal(system, user, opts) {
  const o = opts || {};
  const shown = o.display || user;
  const run = queue.then(async () => {
    emit('start', { source: o.source || '', prompt: shown });
    try {
      const { engine } = await loadLocalModel();
      let out = '';
      await engine.generate({
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        maxTokens: o.maxTokens || 220,
        temperature: 0, topK: 1, topP: 1, repetitionPenalty: 1.0, enableThinking: false
      }, (ev) => {
        if (typeof ev.token === 'string') {
          out += ev.token;
          if (o.onToken) { try { o.onToken(ev.token, out); } catch (_) {} }
        }
      });
      const answer = out.replace(/<\|[a-z_]+\|>/gi, '').trim();
      emit('answer', { source: o.source || '', prompt: shown, answer: answer });
      return answer;
    } catch (e) {
      emit('error', { source: o.source || '', prompt: shown, message: (e && e.message) || String(e) });
      throw e;
    }
  });
  queue = run.catch(() => {});
  return run;
}
