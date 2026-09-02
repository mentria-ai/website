import { MentriaBus } from '/assets/js/mentria-bus.js';

const mc = document.modelContext;
const registered = new Set();
const PAGE_LANG = document.documentElement.lang || 'en';

async function register(t) {
  if (registered.has(t.name)) return;
  registered.add(t.name);
  try {
    await mc.registerTool({
      name: t.name,
      description: t.description || t.name,
      inputSchema: t.parameters || { type: 'object', properties: {} },
      annotations: { readOnlyHint: t.readonly === true },
      execute: (args) => MentriaBus.invoke(t.name, args || {})
    });
  } catch (e) {
    registered.delete(t.name);
  }
}

function sync() { for (const t of MentriaBus.listTools({ ai: true })) register(t); registerSummarize(); }

async function searchSite(query) {
  const res = await fetch('/search-index.json');
  const idx = await res.json();
  const terms = String(query).toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const scored = [];
  for (const e of idx) {
    if (e.lang !== PAGE_LANG) continue;
    const title = (e.title || '').toLowerCase();
    const hay = title + ' ' + ((e.description || '') + ' ' + (e.tldr || '')).toLowerCase();
    let score = 0;
    for (const t of terms) if (hay.includes(t)) score += title.includes(t) ? 3 : 1;
    if (score) scored.push({ score, item: { type: e.type, title: e.title, url: e.url, description: e.description } });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 8).map((s) => s.item);
}

async function start() {
  await mc.registerTool({
    name: 'site__search',
    title: 'Search mentria.ai',
    description: 'Search this site for tools, games and feed posts by keyword. Returns titles, URLs and descriptions.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    annotations: { readOnlyHint: true },
    execute: (args) => searchSite((args || {}).query)
  });
  await mc.registerTool({
    name: 'site__open',
    title: 'Open a mentria.ai page',
    description: 'Navigate this tab to a site page by path, e.g. /tools/countdown-timer/ or /feed/. New tools become available after the page loads.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    execute: (args) => {
      const p = String((args || {}).path || '');
      if (!/^\/[a-zA-Z0-9/_.-]*$/.test(p)) throw new Error('path must be site-relative, like /tools/qr-scanner/');
      setTimeout(() => { location.href = p; }, 50);
      return { ok: true, navigating: p };
    }
  });
  await registerLocalAi();
  sync();
}

const DIST = '/assets/mentria/dist/';
let enginePromise = null;
let queue = Promise.resolve();

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

function askLocal(system, user, maxTokens) {
  const run = queue.then(async () => {
    const { engine } = await loadLocalModel();
    let out = '';
    await engine.generate({
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      maxTokens: maxTokens || 220,
      temperature: 0, topK: 1, topP: 1, repetitionPenalty: 1.0, enableThinking: false
    }, (ev) => { if (typeof ev.token === 'string') out += ev.token; });
    return out.replace(/<\|[a-z_]+\|>/gi, '').trim();
  });
  queue = run.catch(() => {});
  return run;
}

async function registerLocalAi() {
  if (!navigator.gpu) return;
  await mc.registerTool({
    name: 'local_ai__status',
    title: 'On-device AI status',
    description: 'Report whether this device can run the local model and whether it is already downloaded.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    execute: async () => {
      const Tiers = await import('/assets/js/mentria-tiers.js');
      const cached = await Tiers.isTierCached('0.8b');
      return { webgpu: true, tier: '0.8b', sizeMB: 490, downloaded: cached, note: cached ? 'ready to run locally' : 'first call downloads the model to this device' };
    }
  });
  await mc.registerTool({
    name: 'local_ai__ask',
    title: 'Ask the on-device model',
    description: 'Run a prompt on the language model that executes on this device\u2019s GPU. Nothing is sent to any server. First use may download the model (490 MB).',
    inputSchema: { type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'] },
    execute: async (args) => {
      const prompt = String((args || {}).prompt || '').slice(0, 4000);
      if (!prompt.trim()) throw new Error('prompt is required');
      const answer = await askLocal('You are Mentria, a small language model running locally in the browser. Answer briefly and plainly.', prompt, 220);
      return { answer, ranOn: 'this device' };
    }
  });
}

function registerSummarize() {
  if (registered.has('notes__summarize_private') || !navigator.gpu) return;
  if (!MentriaBus.describe('notes.readAll')) return;
  registered.add('notes__summarize_private');
  mc.registerTool({
    name: 'notes__summarize_private',
    title: 'Summarize private notes on-device',
    description: 'Summarize the person\u2019s saved notes without exposing them: the note contents are read and summarized by a model running on this device, and only the summary is returned.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    execute: async () => {
      const notes = await MentriaBus.invoke('notes.readAll', {});
      if (!notes.length) return { summary: 'There are no saved notes.', notesSeen: 0 };
      let text = '';
      for (const n of notes) {
        const chunk = (n.title ? n.title + ': ' : '') + (n.body || '');
        if (text.length + chunk.length > 6000) break;
        text += chunk + '\n';
      }
      const summary = await askLocal(
        'You summarize private notes. Reply with a summary of three sentences at most. Mention only what is in the notes.',
        'NOTES:\n' + text + '\nSummarize these notes.', 160);
      return { summary, notesSeen: notes.length, privacy: 'note contents never left this device' };
    }
  }).catch(() => { registered.delete('notes__summarize_private'); });
}

window.addEventListener('mentria:bus:provide', sync);
document.addEventListener('DOMContentLoaded', sync);
start();
