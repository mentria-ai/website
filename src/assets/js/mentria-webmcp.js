import { MentriaBus } from '/assets/js/mentria-bus.js';
import { askLocal } from '/assets/js/mentria-local-ask.js';

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

const PANEL_ID = 'mentria-localask-panel';
let panelTimer = 0;

function tr(key, fallback) {
  try {
    const I = window.MentriaI18n;
    if (I && I.hasKey && I.hasKey(key)) return I.t(key);
  } catch (_) {}
  return fallback;
}

function ensurePanelStyles() {
  if (document.getElementById(PANEL_ID + '-css')) return;
  const st = document.createElement('style');
  st.id = PANEL_ID + '-css';
  st.textContent = '#' + PANEL_ID + '{position:fixed;right:16px;bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:1200;width:min(340px,calc(100vw - 32px));background:var(--term-bg-raised,#10151b);border:1px solid var(--term-border,#26303a);border-left:3px solid var(--accent,#6ef3c5);border-radius:var(--radius-lg,12px);padding:12px 14px;color:var(--term-fg,#dbe5ee);font-family:var(--font-mono,monospace);box-shadow:0 12px 32px rgba(0,0,0,.45)}' +
    '#' + PANEL_ID + ' .lap-head{display:flex;align-items:center;gap:8px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--accent,#6ef3c5)}' +
    '#' + PANEL_ID + ' .lap-dot{width:7px;height:7px;border-radius:50%;background:var(--accent,#6ef3c5);animation:lap-pulse 1.2s ease-in-out infinite}' +
    '#' + PANEL_ID + ' .lap-dot.is-done{animation:none}' +
    '@keyframes lap-pulse{50%{opacity:.2}}' +
    '@media (prefers-reduced-motion: reduce){#' + PANEL_ID + ' .lap-dot{animation:none}}' +
    '#' + PANEL_ID + ' .lap-close{margin-left:auto;background:none;border:0;color:var(--term-muted,#77828d);cursor:pointer;font:inherit;font-size:14px;line-height:1;padding:2px 4px}' +
    '#' + PANEL_ID + ' .lap-q{margin:8px 0 6px;font-size:12px;color:var(--term-muted,#77828d);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}' +
    '#' + PANEL_ID + ' .lap-a{font-size:13px;line-height:1.55;white-space:pre-wrap;overflow-wrap:anywhere;max-height:180px;overflow:auto}' +
    '#' + PANEL_ID + ' .lap-priv{margin-top:8px;font-size:10.5px;color:var(--term-muted,#77828d)}';
  document.head.appendChild(st);
}

function showPanel(prompt) {
  ensurePanelStyles();
  const old = document.getElementById(PANEL_ID);
  if (old) old.remove();
  clearTimeout(panelTimer);
  const el = document.createElement('aside');
  el.id = PANEL_ID;
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  const head = document.createElement('div');
  head.className = 'lap-head';
  const dot = document.createElement('span');
  dot.className = 'lap-dot';
  const title = document.createElement('span');
  title.textContent = tr('webmcp.panel_title', 'On-device AI');
  const close = document.createElement('button');
  close.className = 'lap-close';
  close.type = 'button';
  close.textContent = '×';
  close.setAttribute('aria-label', tr('webmcp.panel_close', 'Dismiss'));
  close.addEventListener('click', () => { clearTimeout(panelTimer); el.remove(); });
  head.appendChild(dot); head.appendChild(title); head.appendChild(close);
  const q = document.createElement('p');
  q.className = 'lap-q';
  q.textContent = prompt;
  const a = document.createElement('div');
  a.className = 'lap-a';
  a.textContent = '…';
  const priv = document.createElement('p');
  priv.className = 'lap-priv';
  priv.textContent = tr('webmcp.panel_privacy', 'Answered by the model on this device — nothing was sent anywhere.');
  el.appendChild(head); el.appendChild(q); el.appendChild(a); el.appendChild(priv);
  document.body.appendChild(el);
  return el;
}

function panelStream(_t, full) {
  const el = document.getElementById(PANEL_ID);
  if (!el) return;
  const a = el.querySelector('.lap-a');
  if (a) { a.textContent = full; a.scrollTop = a.scrollHeight; }
}

window.addEventListener('mentria:localask', (ev) => {
  const d = ev.detail || {};
  if (d.source !== 'agent') return;
  if (d.phase === 'start') { showPanel(d.prompt); return; }
  const el = document.getElementById(PANEL_ID);
  if (!el) return;
  const dot = el.querySelector('.lap-dot');
  if (dot) dot.classList.add('is-done');
  const a = el.querySelector('.lap-a');
  if (d.phase === 'answer' && a) a.textContent = d.answer;
  if (d.phase === 'error' && a) a.textContent = tr('webmcp.panel_error', 'The local model could not answer: ') + (d.message || '');
  clearTimeout(panelTimer);
  panelTimer = setTimeout(() => {
    const p = document.getElementById(PANEL_ID);
    if (p) p.remove();
  }, d.phase === 'answer' ? 14000 : 9000);
});

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
      const answer = await askLocal('You are the on-device assistant of mentria.ai, a privacy-first site where everything runs locally in the browser: 30+ tools (quick notes, timers, QR codes, unit converter, color picker, base64, rulers and levels), games (chess, sudoku, ludo, breakout, flappy, a retro FPS), P2P comms chat, Story Studio decks, and an AI-learning feed. You are a small language model running on this device via WebGPU. When asked what is available or possible here, list items from that inventory. Answer briefly and plainly.', prompt, { maxTokens: 220, source: 'agent', onToken: panelStream });
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
        'You turn personal notes into a short plain summary.',
        'NOTES:\n' + text + '\nWrite a two or three sentence summary of these notes:',
        { maxTokens: 160, source: 'agent', display: tr('webmcp.panel_summarize', 'Summarizing your saved notes privately'), onToken: panelStream });
      return { summary, notesSeen: notes.length, privacy: 'note contents never left this device' };
    }
  }).catch(() => { registered.delete('notes__summarize_private'); });
}

window.addEventListener('mentria:bus:provide', sync);
document.addEventListener('DOMContentLoaded', sync);
start();
