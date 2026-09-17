import { serveEngine } from '/assets/js/mentria-engine-proxy.js';

const CFG = window.MENTRIA_SHELL || {};
const TOOLS = CFG.tools || [];
const ENGINE_TOOLS = new Set(CFG.engineTools || []);
const COPY = CFG.copy || {};
const PREFIX = CFG.prefix || '';
const DIST = '/assets/mentria/dist/';
const MAX_CARDS = 8;
const LOW_MEMORY_GB = 4;
const IDLE_UNLOAD_MS = 20 * 60 * 1000;

const byId = (id) => document.getElementById(id);
const feed = byId('shell-feed');
const dockItems = byId('shell-dock-items');
const dockStrip = byId('shell-dock');
const railDock = byId('shell-rail-dock');
const railNext = byId('shell-rail-next');
const posRail = byId('shell-pos');
const toolBySlug = new Map(TOOLS.map((t) => [t.slug, t]));
const cards = new Map();
let engineRes = null;
let engineLoading = null;
let broker = null;
let fullCard = null;
let idleTimer = 0;

function tr(key, vars) {
  let s = COPY[key] || key;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m)) : s;
}
function toolUrl(slug) { const t = toolBySlug.get(slug); return t && t.url ? t.url : PREFIX + '/tools/' + slug + '/'; }
function isEngineTool(slug) { return ENGINE_TOOLS.has(slug); }
function localUsage() {
  try { return JSON.parse(localStorage.getItem('mentria_tool_usage')) || {}; } catch (_) { return {}; }
}
function pinned() {
  try { const v = window.MentriaStore && window.MentriaStore.get('ui', 'pinned_tools'); return Array.isArray(v) ? v : []; } catch (_) { return []; }
}
function hasMotion() { return 'DeviceMotionEvent' in window && matchMedia('(pointer: coarse)').matches; }
function eligible(slug) {
  const t = toolBySlug.get(slug);
  if (!t) return false;
  if (t.requires === 'motion' && !hasMotion()) return false;
  return true;
}

function ranked() {
  const usage = localUsage();
  const recents = Object.keys(usage).sort((a, b) => (usage[b].last || 0) - (usage[a].last || 0));
  const order = [];
  const push = (s) => { if (s && !order.includes(s) && eligible(s) && s !== 'ai-chat') order.push(s); };
  order.push('ai-chat');
  pinned().forEach(push);
  recents.slice(0, 4).forEach(push);
  (CFG.defaults || []).forEach(push);
  return order;
}

function frameHtml(t) {
  return `<div class="terminal-frame shell-frame" style="--cat:${t.cat || 'var(--syn-cyan)'}">
  <div class="terminal-frame__titlebar">
    <div class="terminal-frame__dots">
      <button type="button" class="terminal-frame__dot terminal-frame__dot--red shell-dotbtn" data-act="close" aria-label="${tr('close')}" title="${tr('close')}"></button>
      <button type="button" class="terminal-frame__dot terminal-frame__dot--yellow shell-dotbtn" data-act="dock" aria-label="${tr('minimize')}" title="${tr('minimize')}"></button>
      <button type="button" class="terminal-frame__dot terminal-frame__dot--green shell-dotbtn" data-act="full" aria-label="${tr('fullscreen')}" title="${tr('fullscreen')}"></button>
    </div>
    <span class="shell-frame__status" data-status hidden><span class="shell-frame__dot"></span><span data-status-text></span></span>
    <span class="terminal-frame__filename">${t.slug}.js</span>
    <a class="terminal-frame__help shell-frame__about" href="${toolUrl(t.slug)}" data-act="page" aria-label="${tr('about_tool')}" title="${tr('about_tool')}">?</a>
    <button type="button" class="terminal-frame__expand" data-act="full" aria-label="${tr('fullscreen')}" title="${tr('fullscreen')}">⤢</button>
  </div>
  <div class="terminal-frame__body shell-frame__body"></div>
</div>`;
}

function gateHtml(t) {
  const tier = CFG.tier || {};
  return `<div class="shell-gate">
  <p class="shell-gate__q">${tr('gate_q', { name: tier.name || '' })}</p>
  <p class="shell-gate__sub">${tr('gate_sub', { size: tier.sizeLabel || '' })}</p>
  <div class="shell-gate__row"><button type="button" class="m-btn m-btn--primary" data-act="load">${tr('gate_btn', { name: tier.name || '' })}</button></div>
  <p class="shell-gate__note">${tr('gate_note')}</p>
</div>`;
}

function makeCard(slug, opts = {}) {
  if (cards.has(slug)) return cards.get(slug);
  const t = toolBySlug.get(slug);
  if (!t) return null;
  const el = document.createElement('article');
  el.className = 'shell-card';
  el.dataset.slug = slug;
  el.innerHTML = frameHtml(t) + `<a class="shell-card__seo" href="${toolUrl(slug)}">${t.title}</a>`;
  const body = el.querySelector('.shell-frame__body');
  const card = { slug, el, body, iframe: null, status: null, docked: false, tool: t };
  cards.set(slug, card);
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'page') return;
    e.preventDefault();
    if (act === 'close') removeCard(card);
    else if (act === 'dock') dockCard(card);
    else if (act === 'full') toggleFull(card);
    else if (act === 'load') loadEngine();
  });
  if (opts.before) feed.insertBefore(el, opts.before); else feed.appendChild(el);
  observer.observe(el);
  return card;
}

function mount(card) {
  if (card.iframe) return;
  if (isEngineTool(card.slug) && !engineRes) {
    if (!card.body.querySelector('.shell-gate')) card.body.innerHTML = gateHtml(card.tool);
    return;
  }
  card.body.innerHTML = '';
  const f = document.createElement('iframe');
  f.className = 'shell-card__frame';
  f.title = card.tool.title;
  f.loading = 'lazy';
  f.src = toolUrl(card.slug) + '?embed=1';
  card.iframe = f;
  card.body.appendChild(f);
}

function unmount(card) {
  if (!card.iframe) return;
  card.iframe.remove();
  card.iframe = null;
  card.body.innerHTML = '';
  setStatus(card, null);
}

const observer = new IntersectionObserver((entries) => {
  entries.forEach((en) => {
    const card = cards.get(en.target.dataset.slug);
    if (!card || card.docked) return;
    if (en.isIntersecting) mount(card);
  });
}, { root: feed, rootMargin: '40% 0px' });

function setStatus(card, text, state) {
  const wrap = card.el.querySelector('[data-status]');
  const txt = card.el.querySelector('[data-status-text]');
  card.status = text ? { text, state } : null;
  wrap.hidden = !text;
  if (text) { txt.textContent = text; wrap.dataset.state = state || ''; }
  refreshDock();
}

function removeCard(card) {
  if (fullCard === card) exitFull();
  unmount(card);
  observer.unobserve(card.el);
  card.el.remove();
  cards.delete(card.slug);
  refreshDock();
  refreshRail();
  refreshPos();
}

function dockCard(card) {
  if (fullCard === card) exitFull();
  card.docked = true;
  card.el.classList.add('is-docked');
  refreshDock();
  refreshPos();
}

function undockCard(card) {
  card.docked = false;
  card.el.classList.remove('is-docked');
  refreshDock();
  refreshPos();
  card.el.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function dockChip(card) {
  const st = card.status;
  const chip = document.createElement('div');
  chip.className = 'shell-dock__item';
  chip.style.setProperty('--cat', card.tool.cat || 'var(--syn-cyan)');
  chip.innerHTML = `<span class="shell-dock__dot" data-state="${st ? st.state || '' : ''}"></span><span class="shell-dock__file">${card.slug}.js</span><span class="shell-dock__label">${st ? st.text : card.tool.title}</span><button type="button" class="shell-dock__btn" data-undock aria-label="${tr('undock')}" title="${tr('undock')}">⤢</button>`;
  chip.querySelector('[data-undock]').addEventListener('click', () => undockCard(card));
  return chip;
}

function refreshDock() {
  const docked = [...cards.values()].filter((c) => c.docked);
  [dockItems, railDock].forEach((host) => { if (!host) return; host.innerHTML = ''; docked.forEach((c) => host.appendChild(dockChip(c))); });
  if (dockStrip) dockStrip.hidden = docked.length === 0;
  if (railDock) railDock.parentElement.hidden = docked.length === 0;
}

function refreshRail() {
  if (!railNext) return;
  const shown = new Set(cards.keys());
  const next = ranked().filter((s) => !shown.has(s)).concat(TOOLS.map((t) => t.slug).filter((s) => !shown.has(s) && eligible(s))).filter((s, i, a) => a.indexOf(s) === i).slice(0, 4);
  railNext.innerHTML = '';
  next.forEach((slug) => {
    const t = toolBySlug.get(slug);
    const a = document.createElement('a');
    a.className = 'shell-rail__row';
    a.href = toolUrl(slug);
    a.dataset.open = slug;
    a.innerHTML = `<span class="shell-rail__row-n">${t.title}</span><span class="shell-rail__row-c">${t.group || t.category || ''}</span>`;
    railNext.appendChild(a);
  });
}

function refreshPos() {
  if (!posRail) return;
  const list = [...cards.values()].filter((c) => !c.docked);
  posRail.innerHTML = '';
  list.forEach((c, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'shell-pos__item';
    b.dataset.slug = c.slug;
    b.innerHTML = `<span class="shell-pos__dot"></span><span class="shell-pos__n">${String(i + 1).padStart(2, '0')}</span><span class="shell-pos__l">${c.tool.title}<em>${c.slug}.js</em></span>`;
    b.addEventListener('click', () => c.el.scrollIntoView({ block: 'start', behavior: 'smooth' }));
    posRail.appendChild(b);
  });
  markActive();
}

function activeCard() {
  const list = [...cards.values()].filter((c) => !c.docked);
  const top = feed.scrollTop + feed.clientHeight / 2;
  return list.find((c) => c.el.offsetTop <= top && c.el.offsetTop + c.el.offsetHeight > top) || list[0] || null;
}

function markActive() {
  const a = activeCard();
  if (posRail) posRail.querySelectorAll('.shell-pos__item').forEach((b) => b.classList.toggle('is-active', !!a && b.dataset.slug === a.slug));
}

function toggleFull(card) { if (fullCard === card) exitFull(); else enterFull(card); }

function enterFull(card, opts = {}) {
  if (card.docked) undockCard(card);
  if (fullCard && fullCard !== card) exitFull(true);
  fullCard = card;
  mount(card);
  card.el.classList.add('is-full');
  document.body.classList.add('is-shell-full');
  card.el.querySelectorAll('[data-act="full"]').forEach((b) => { b.setAttribute('aria-pressed', 'true'); b.title = tr('windowed'); b.setAttribute('aria-label', tr('windowed')); });
  if (!opts.silent) history.pushState({ shell: card.slug }, '', toolUrl(card.slug));
  scheduleIdle(card);
}

function exitFull(silent) {
  const card = fullCard;
  if (!card) return;
  fullCard = null;
  card.el.classList.remove('is-full');
  document.body.classList.remove('is-shell-full');
  card.el.querySelectorAll('[data-act="full"]').forEach((b) => { b.setAttribute('aria-pressed', 'false'); b.title = tr('fullscreen'); b.setAttribute('aria-label', tr('fullscreen')); });
  if (!silent && history.state && history.state.shell) history.back();
  card.el.scrollIntoView({ block: 'start' });
}

window.addEventListener('popstate', () => {
  if (fullCard && !(history.state && history.state.shell)) { fullCard.el.classList.remove('is-full'); document.body.classList.remove('is-shell-full'); fullCard = null; }
  else if (history.state && history.state.shell) { const c = cards.get(history.state.shell) || openTool(history.state.shell, { silent: true }); if (c && fullCard !== c) enterFull(c, { silent: true }); }
});

function openTool(slug, opts = {}) {
  if (!toolBySlug.get(slug)) { location.href = toolUrl(slug); return null; }
  const active = activeCard();
  const card = cards.get(slug) || makeCard(slug, { before: active && active.el.nextSibling ? active.el.nextSibling : null });
  if (!card) return null;
  if (card.docked) undockCard(card);
  refreshRail(); refreshPos();
  if (!opts.silent) enterFull(card); else enterFull(card, { silent: true });
  return card;
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target === '_blank') return;
  if (a.closest('.shell-card') && !a.dataset.open) return;
  const m = a.getAttribute('href').replace(/^https?:\/\/[^/]+/, '').match(/^(?:\/(?:es|fr|ja|pt-br))?\/tools\/([^/?#]+)\/?(?:[?#].*)?$/);
  if (!m) return;
  const slug = m[1];
  if (!toolBySlug.get(slug) || !eligible(slug)) return;
  e.preventDefault();
  openTool(slug);
});

window.addEventListener('message', (e) => {
  if (e.origin !== location.origin || !e.data) return;
  const src = e.source;
  const card = [...cards.values()].find((c) => c.iframe && c.iframe.contentWindow === src);
  if (!card) return;
  if (e.data.type === 'mentria-status') setStatus(card, e.data.text, e.data.state);
  else if (e.data.type === 'mentria-open' && e.data.slug) openTool(e.data.slug);
  else if (e.data.type === 'mentria-full') toggleFull(card);
  else if (e.data.type === 'mentria-dock') dockCard(card);
});

async function loadEngine() {
  if (engineRes || engineLoading) return engineLoading;
  const bar = byId('shell-engine');
  engineLoading = (async () => {
    try {
      cards.forEach((c) => { if (isEngineTool(c.slug)) { const b = c.body.querySelector('[data-act="load"]'); if (b) { b.disabled = true; b.textContent = tr('gate_loading'); } } });
      const [{ MentriaEngine }, { ensureModel }] = await Promise.all([import(DIST + 'mentria.mjs'), import('/assets/js/mentria-model.js')]);
      const createEngine = () => { const en = new MentriaEngine(DIST + 'worker.mjs'); window.mentriaWrapEngine && window.mentriaWrapEngine(en); return en; };
      const res = await ensureModel(createEngine, {
        vision: true,
        offerUpgrade: true,
        onProgress: (p) => { if (broker) broker.progress(p); if (bar && p && p.message) bar.textContent = p.message; },
        onDeviceLost: () => { engineRes = null; if (bar) bar.textContent = tr('engine_lost'); cards.forEach((c) => { if (isEngineTool(c.slug)) { unmount(c); mount(c); } }); }
      });
      engineRes = res;
      window.__mentriaEngine = res.engine;
      broker.setReady(res);
      if (bar) bar.textContent = tr('engine_ready', { name: (res.tier || '').toUpperCase(), seq: (res.maxSeq || 0).toLocaleString() });
      cards.forEach((c) => { if (isEngineTool(c.slug) && !c.docked) { c.body.innerHTML = ''; mount(c); } });
    } catch (err) {
      if (bar) bar.textContent = err && err.message === 'download-postponed' ? tr('engine_idle') : (tr('engine_error') + ' ' + (err && err.message || err));
      cards.forEach((c) => { if (isEngineTool(c.slug)) { c.body.innerHTML = gateHtml(c.tool); } });
    } finally { engineLoading = null; }
  })();
  return engineLoading;
}

function lowMemory() { return typeof navigator.deviceMemory === 'number' && navigator.deviceMemory <= LOW_MEMORY_GB; }
function scheduleIdle(card) {
  clearTimeout(idleTimer);
  if (!engineRes) return;
  if (lowMemory() && !isEngineTool(card.slug)) idleTimer = setTimeout(unloadEngine, 20000);
}
async function unloadEngine() {
  if (!engineRes) return;
  const eng = engineRes.engine;
  engineRes = null;
  try { eng.terminate ? eng.terminate() : await eng.unload(); } catch (_) {}
  cards.forEach((c) => { if (isEngineTool(c.slug)) { unmount(c); if (!c.docked) mount(c); } });
  const bar = byId('shell-engine');
  if (bar) bar.textContent = tr('engine_idle');
}
let lastActivity = Date.now();
['pointerdown', 'keydown', 'scroll'].forEach((ev) => document.addEventListener(ev, () => { lastActivity = Date.now(); }, { passive: true, capture: true }));
setInterval(() => { if (engineRes && Date.now() - lastActivity > IDLE_UNLOAD_MS && !fullCard) unloadEngine(); }, 60000);

feed.addEventListener('scroll', () => { markActive(); lastActivity = Date.now(); }, { passive: true });

document.addEventListener('keydown', (e) => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) return;
  if (document.querySelector('.m-modal:not([hidden]), .m-palette:not([hidden])')) return;
  const list = [...cards.values()].filter((c) => !c.docked);
  const a = activeCard();
  const i = a ? list.indexOf(a) : -1;
  if ((e.key === 'j' || e.key === 'ArrowDown') && !fullCard) { const n = list[Math.min(list.length - 1, i + 1)]; if (n) { e.preventDefault(); n.el.scrollIntoView({ block: 'start', behavior: 'smooth' }); } }
  else if ((e.key === 'k' || e.key === 'ArrowUp') && !fullCard) { const n = list[Math.max(0, i - 1)]; if (n) { e.preventDefault(); n.el.scrollIntoView({ block: 'start', behavior: 'smooth' }); } }
  else if (e.key === 'Enter' && a && !fullCard) { e.preventDefault(); enterFull(a); }
  else if (e.key === 'Escape' && fullCard) { e.preventDefault(); exitFull(); }
});

async function boot() {
  broker = serveEngine();
  try {
    const Tiers = await import('/assets/js/mentria-tiers.js');
    const id = await Tiers.effectiveTier();
    const t = id && Tiers.TIERS[id];
    if (t) CFG.tier = { id, name: t.name || id, sizeLabel: t.sizeLabel || '' };
  } catch (_) {}
  window.__shellBroker = broker;
  const existing = [...feed.querySelectorAll('.shell-card')];
  existing.forEach((el) => {
    const slug = el.dataset.slug;
    const t = toolBySlug.get(slug);
    if (!t || !eligible(slug)) { el.remove(); return; }
    const body = el.querySelector('.shell-frame__body');
    const card = { slug, el, body, iframe: null, status: null, docked: false, tool: t };
    cards.set(slug, card);
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'page') return;
      e.preventDefault();
      if (act === 'close') removeCard(card);
      else if (act === 'dock') dockCard(card);
      else if (act === 'full') toggleFull(card);
      else if (act === 'load') loadEngine();
    });
    observer.observe(el);
  });
  const order = ranked();
  order.forEach((slug, i) => { if (i < MAX_CARDS) { const c = cards.get(slug) || makeCard(slug); if (c) feed.appendChild(c.el); } });
  [...cards.values()].forEach((c) => { if (!order.slice(0, MAX_CARDS).includes(c.slug)) removeCard(c); });
  refreshRail(); refreshPos(); refreshDock();
  const first = cards.get('ai-chat');
  if (first) mount(first);
  const h = location.hash.match(/^#(?:open|dock)=([a-z0-9-]+)/);
  if (h) { const c = openTool(h[1]); if (c && location.hash.startsWith('#dock')) { exitFull(true); dockCard(c); } history.replaceState(null, '', location.pathname); }
}

if (feed) boot();
