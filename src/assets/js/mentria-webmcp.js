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

function sync() { for (const t of MentriaBus.listTools({ ai: true })) register(t); }

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
  sync();
}

window.addEventListener('mentria:bus:provide', sync);
document.addEventListener('DOMContentLoaded', sync);
start();
