import * as U from './ui.js';
import * as db from './db.js';
import * as V from './vault.js';
import { Engine } from './engine.js';
import { Ledger, accountGroup } from './ledger.js';
import { monthKey, isISODate } from './dates.js';
import { randomId } from './crypto.js';
import { showLock } from './lock.js';
import { openEntry } from './entry.js';
import { syncController } from './sync.js';

const { h, t, icon } = U;

const ROUTES = {
  home: () => import('./views/home.js'),
  ledger: () => import('./views/ledger.js'),
  invest: () => import('./views/invest.js'),
  plan: () => import('./views/plan.js'),
  budgets: () => import('./views/budgets.js'),
  subs: () => import('./views/subs.js'),
  accounts: () => import('./views/accounts.js'),
  taxes: () => import('./views/taxes.js'),
  reports: () => import('./views/reports.js'),
  import: () => import('./views/importer.js'),
  devices: () => import('./views/devices.js'),
  settings: () => import('./views/settings.js'),
  more: () => import('./views/more.js')
};

const NAV = [
  { id: 'home', icon: 'home' },
  { id: 'ledger', icon: 'ledger' },
  { id: 'add', icon: 'plus' },
  { id: 'invest', icon: 'invest' },
  { id: 'more', icon: 'more' }
];

const RAIL_EXTRA = [
  { id: 'plan', icon: 'plan' },
  { id: 'budgets', icon: 'budget' },
  { id: 'subs', icon: 'subs' },
  { id: 'accounts', icon: 'accounts' },
  { id: 'taxes', icon: 'tax' },
  { id: 'reports', icon: 'reports' },
  { id: 'sep' },
  { id: 'import', icon: 'import' },
  { id: 'devices', icon: 'devices' },
  { id: 'settings', icon: 'settings' }
];

const host = (() => {
  try { return window.parent && window.parent !== window ? window.parent.__mentriaExtHost || null : null; } catch (_) { return null; }
})();

const app = {
  root: null,
  engine: null,
  ledger: null,
  route: 'home',
  params: {},
  lastActive: Date.now(),
  hiddenAt: 0,
  local: {},
  renderSeq: 0,
  sync: null,
  writer: true,
  viewState: {}
};

let queuedCmd = null;
const COMMANDS = ['fin-add', 'fin-budget', 'fin-subs', 'fin-tax'];

function readArgs() {
  if (queuedCmd) { const q = queuedCmd; queuedCmd = null; return q; }
  const a = host && host.args;
  if (a && a.cmd) return a;
  const hp = new URLSearchParams((location.hash.split('?')[1] || ''));
  return hp.get('cmd') ? { cmd: hp.get('cmd'), args: hp.get('args') || '' } : null;
}

async function loadLocal() {
  const local = (await db.getMeta('local')) || {};
  app.local = Object.assign({ auto_lock_min: 5, agents: false, widget_amounts: false }, local);
  return app.local;
}

export async function saveLocal(patch) {
  app.local = Object.assign({}, app.local, patch);
  await db.setMeta({ local: app.local });
}

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, q] = raw.split('?');
  const route = ROUTES[path] ? path : 'home';
  const params = {};
  new URLSearchParams(q || '').forEach((v, k) => { params[k] = v; });
  return { route, params };
}

export function go(route, params) {
  const q = params ? new URLSearchParams(params).toString() : '';
  const next = '#/' + route + (q ? '?' + q : '');
  if (location.hash === next) render();
  else location.hash = next;
}

function ctx() {
  return {
    app,
    engine: app.engine,
    ledger: app.ledger,
    local: app.local,
    route: app.route,
    params: app.params,
    writer: !app.engine.readOnly,
    viewState: (app.viewState[app.route] = app.viewState[app.route] || {}),
    go,
    rerender: () => render(),
    save,
    remove,
    commit,
    newId: randomId,
    openEntry: (opts) => openEntry(ctx(), opts),
    saveLocal,
    lock,
    publishWrap,
    getCtx: ctx,
    sync: app.sync,
    host
  };
}

async function commit(ops, msg, undoOps) {
  if (!ops || !ops.length) return true;
  try {
    await app.engine.commit(ops);
    if (msg) U.toast(msg, undoOps ? { undo: () => commit(undoOps(), t('common.undone')) } : null);
    return true;
  } catch (e) {
    handleWriteError(e);
    return false;
  }
}

function handleWriteError(e) {
  const m = String((e && e.message) || e);
  if (e && e.name === 'ClockDriftError') U.toast(t('errors.clock'), { ms: 8000 });
  else if (m === 'read-only') U.toast(t('errors.readonly'), { ms: 6000 });
  else if (/quota|QuotaExceeded/i.test(m) || (e && e.name === 'QuotaExceededError')) U.toast(t('errors.quota'), { ms: 9000 });
  else U.toast(t('errors.write') + ' ' + m.slice(0, 80), { ms: 7000 });
}

function save(entity, id, fields) {
  const exists = app.ledger.exists(entity, id);
  return exists ? app.engine.updateOps(entity, id, fields) : app.engine.createOps(entity, id, fields);
}

function remove(entity, id) {
  return app.engine.removeOps(entity, id);
}

function shell() {
  const root = app.root;
  root.replaceChildren();
  const title = h('h1', { class: 'fin-top__title', id: 'fin-title' });
  const syncBtn = h('button', { type: 'button', class: 'fsync', id: 'fin-sync', onclick: () => go('devices') }, h('i'), h('span', { id: 'fin-sync-text' }, t('sync.local')));
  const searchBtn = h('button', { type: 'button', class: 'fb fb--ghost fb--icon', 'aria-label': t('nav.search'), onclick: () => go('ledger', { q: '1' }) }, icon('search'));
  const lockBtn = h('button', { type: 'button', class: 'fb fb--ghost fb--icon', 'aria-label': t('lock.lock_now'), onclick: () => lock() }, icon('lock'));
  const top = h('header', { class: 'fin-top' }, title, h('span', { id: 'fin-top-extra' }), syncBtn, searchBtn, lockBtn);
  const nav = h('nav', { class: 'fin-nav', 'aria-label': t('nav.label') });
  nav.append(h('div', { class: 'fin-nav__brand' }, icon('coins'), h('span', null, t('app.name'))));
  for (const n of NAV) {
    if (n.id === 'add') {
      nav.append(h('button', { type: 'button', class: 'fin-nav__add', 'data-label': t('nav.add'), 'aria-label': t('nav.add'), onclick: () => openEntry(ctx(), {}) }, icon('plus')));
      continue;
    }
    nav.append(h('button', { type: 'button', class: 'fin-nav__btn' + (n.id === 'more' ? ' fin-nav__more-btn' : ''), 'data-route': n.id, onclick: () => go(n.id) }, icon(n.icon), h('span', null, t('nav.' + n.id))));
  }
  for (const n of RAIL_EXTRA) {
    if (n.id === 'sep') { nav.append(h('div', { class: 'fin-nav__sep fin-nav__rail-only' })); continue; }
    nav.append(h('button', { type: 'button', class: 'fin-nav__btn fin-nav__rail-only', 'data-route': n.id, onclick: () => go(n.id) }, icon(n.icon), h('span', null, t('nav.' + n.id))));
  }
  const main = h('main', { class: 'fin-main', id: 'fin-main', tabindex: '-1' });
  const ro = h('div', { id: 'fin-ro' });
  root.append(top, main, nav);
  main.append(ro);
}

let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; render(true); });
}

async function render(keepScroll) {
  if (!app.engine || app.engine.closed) return;
  const seq = ++app.renderSeq;
  const { route, params } = parseHash();
  const routeChanged = route !== app.route;
  app.route = route;
  app.params = params;
  const main = document.getElementById('fin-main');
  if (!main) return;
  let mod;
  try { mod = await ROUTES[route](); } catch (e) { main.replaceChildren(h('div', { class: 'fin-page' }, U.empty(t('errors.load') + ' ' + String(e && e.message || e)))); return; }
  if (seq !== app.renderSeq) return;
  const scroll = main.scrollTop;
  let out;
  try { out = mod.render(ctx()); } catch (e) {
    console.error(e);
    out = { title: t('nav.' + route), node: U.empty(t('errors.load') + ' ' + String(e && e.message || e)) };
  }
  const page = h('div', { class: 'fin-page' });
  if (app.engine.readOnly) page.append(h('div', { class: 'fbanner' }, icon('info'), h('span', null, t('errors.readonly_banner'))));
  page.append(out.node);
  main.replaceChildren(page);
  const titleEl = document.getElementById('fin-title');
  if (titleEl) titleEl.textContent = out.title || t('nav.' + route);
  const extra = document.getElementById('fin-top-extra');
  if (extra) extra.replaceChildren(...(out.top ? [out.top] : []));
  for (const b of document.querySelectorAll('.fin-nav [data-route]')) {
    const on = b.dataset.route === route || (route !== 'home' && route !== 'ledger' && route !== 'invest' && b.dataset.route === 'more' && !U.isWide());
    b.classList.toggle('is-on', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  if (keepScroll && !routeChanged) main.scrollTop = scroll;
  else main.scrollTop = 0;
  if (out.after) { try { out.after(); } catch (e) { console.error(e); } }
  updateSyncBadge();
}

function updateSyncBadge() {
  const el = document.getElementById('fin-sync');
  const txt = document.getElementById('fin-sync-text');
  if (!el || !txt) return;
  const st = app.sync ? app.sync.status() : { state: 'local' };
  el.classList.toggle('is-live', st.state === 'live');
  el.classList.toggle('is-wait', st.state === 'waiting');
  txt.textContent = st.state === 'live' ? t('sync.live') : st.state === 'waiting' ? t('sync.waiting') : t('sync.local');
}

function updateWidget() {
  const S = window.MentriaStore;
  if (!S) return;
  const open = !!(app.engine && !app.engine.closed && app.ledger);
  let snap = { text: t('app.name'), detail: t('widget.locked') };
  if (open && app.local.widget_amounts) {
    try {
      const L = app.ledger;
      const key = monthKey(L.today());
      const b = L.budgetSummary(key);
      const month = U.month(key, true);
      const cash = (v) => U.money(v, L.base(), { compact: true });
      const up = L.upcoming(14)[0];
      snap = {
        text: b.total > 0 ? t('widget.spent_of', { spent: cash(b.spent), budget: cash(b.total), month }) : t('widget.spent', { amount: cash(b.expense), month }),
        detail: up ? t('widget.next', { name: up.schedule.name || '', amount: U.money(Math.abs(up.amount), up.currency), date: U.date(up.date, 'dayMonth') }) : t('widget.no_upcoming')
      };
      if (b.total > 0) snap.progress = Math.max(0, Math.min(1, b.spent / b.total));
    } catch (_) {}
  } else if (open) {
    snap = { text: t('app.name'), detail: t('widget.open') };
  }
  try { S.set('extdata.finance', 'widget', snap); } catch (_) {}
}

async function autoPost() {
  if (!app.engine || app.engine.readOnly) return 0;
  const L = app.ledger;
  const today = L.today();
  const ops = [];
  for (const s of L.schedules()) {
    const dates = L.autoPostDates(s, today);
    if (!dates.length) continue;
    const acct = L.get('account', s.account);
    for (const d of dates) {
      const id = 'sch:' + s.id + ':' + d;
      ops.push(...app.engine.createOps('transaction', id, {
        date: d, amount_minor: s.amount_minor || 0, currency: (acct && acct.currency) || s.currency || L.base(), account: s.account,
        category: s.category || null, payee: s.payee || s.name || '', note: '', tags: [], kind: (s.amount_minor || 0) > 0 ? 'income' : 'expense',
        schedule_id: s.id, cleared: false, created: new Date().toISOString(), provenance: 'schedule'
      }));
    }
  }
  if (ops.length) await app.engine.commit(ops);
  return ops.length;
}

async function touchDevice() {
  if (!app.engine || app.engine.readOnly) return;
  const id = app.engine.deviceId;
  const cur = app.ledger.get('device', id);
  const today = new Date().toISOString().slice(0, 10);
  const name = (await db.getMeta('device_name')) || V.defaultDeviceName();
  if (cur && cur.last_seen && cur.last_seen.slice(0, 10) === today && cur.name === name) return;
  const fields = { name, platform: navigator.platform || '', last_seen: new Date().toISOString() };
  if (!cur) fields.created = new Date().toISOString();
  await app.engine.commit(cur ? app.engine.updateOps('device', id, fields) : app.engine.createOps('device', id, fields));
}

async function syncWraps() {
  if (!app.engine || app.engine.readOnly) return;
  const ops = [];
  for (const kind of ['pass', 'recovery']) {
    const rec = app.ledger.get('vaultwrap', kind);
    const local = await V.localWrap(kind);
    if (!local) continue;
    const fields = (w) => ({ salt: w.salt, iter: w.iter || null, iv: w.iv, ct: w.ct, changed: w.changed });
    if (!rec || !rec.ct) {
      const changed = local.changed || new Date().toISOString();
      if (!local.changed) await V.adoptWrap(kind, Object.assign({}, local, { changed }));
      ops.push(...app.engine.createOps('vaultwrap', kind, fields(Object.assign({}, local, { changed }))));
    } else if (rec.ct !== local.ct) {
      if (!local.changed || (rec.changed && rec.changed > local.changed)) await V.adoptWrap(kind, fields(rec));
      else ops.push(...app.engine.updateOps('vaultwrap', kind, fields(local)));
    }
  }
  if (ops.length) await app.engine.commit(ops);
}

export async function publishWrap(kind) {
  const local = await V.localWrap(kind);
  if (!local || !app.engine) return;
  const fields = { salt: local.salt, iter: local.iter || null, iv: local.iv, ct: local.ct, changed: local.changed || new Date().toISOString() };
  await commit(app.ledger.exists('vaultwrap', kind) ? app.engine.updateOps('vaultwrap', kind, fields) : app.engine.createOps('vaultwrap', kind, fields));
}

export async function openSession(session) {
  const deviceId = await db.getMeta('device_id');
  const deviceName = await db.getMeta('device_name');
  const engine = new Engine({ root: session.root, keys: session.keys, deviceId, deviceName });
  engine.attachTabs();
  const isWriter = await engine.acquireWriter();
  await engine.load();
  if (!isWriter) engine.waitForWriter();
  app.engine = engine;
  app.ledger = new Ledger(engine);
  U.setNumberLocale(app.ledger.settings().locale || null);
  engine.addEventListener('change', () => { scheduleRender(); updateWidgetSoon(); });
  engine.addEventListener('writer', () => { scheduleRender(); afterWriter().then(() => updateWidget()); });
  shell();
  app.sync = syncController(ctx);
  app.sync.onStatus = () => updateSyncBadge();
  if (isWriter) await afterWriter(session);
  await render();
  routeCommand();
  armTimers();
  updateWidget();
  askPersist();
}

let persistAsked = false;
function askPersist() {
  if (persistAsked) return;
  persistAsked = true;
  db.requestPersist().catch(() => {});
}

async function afterWriter(session) {
  try {
    if (session && session.firstRun) await session.firstRun(app.engine, app.ledger);
    const merged = await app.engine.mergeInbox((v) => inboxOps(v));
    if (merged) U.toast(U.tp('lock.inbox_merged', merged), { ms: 5000 });
    await autoPost();
    await touchDevice();
    await syncWraps();
    armRemindersSoon(0);
  } catch (e) { console.error(e); }
  if (app.sync) app.sync.start();
  if (app.local.agents && app.engine && !app.engine.readOnly) {
    try { const A = await import('./agents.js'); await A.enableAgents(ctx); } catch (e) { console.error(e); }
  }
}

function inboxOps(v) {
  const L = app.ledger;
  const acct = L.get('account', v.account) || L.get('account', L.lastAccount());
  if (!acct) return [];
  const ccy = acct.currency || L.base();
  const minor = U.parseAmount(String(v.amount || ''), ccy);
  if (minor == null || minor === 0) return [];
  const signed = v.income ? Math.abs(minor) : -Math.abs(minor);
  const d = isISODate(v.date) ? v.date : L.today();
  return app.engine.createOps('transaction', randomId(), {
    date: d, amount_minor: signed, currency: ccy, account: acct.id, category: null, payee: '', note: String(v.note || '').slice(0, 300),
    tags: [], kind: signed > 0 ? 'income' : 'expense', cleared: false, created: v.created || new Date().toISOString(), provenance: 'inbox'
  });
}

let widgetTimer = null;
function updateWidgetSoon() { clearTimeout(widgetTimer); widgetTimer = setTimeout(updateWidget, 800); armRemindersSoon(5000); }

let reminderTimer = null;
function armRemindersSoon(ms) {
  clearTimeout(reminderTimer);
  reminderTimer = setTimeout(() => {
    if (!app.engine || app.engine.closed || app.engine.readOnly) return;
    import('./reminders.js').then((R) => R.armReminders(ctx())).catch(() => {});
  }, ms);
}

function routeCommand() {
  const a = readArgs();
  if (a) runCommand(a);
}

window.addEventListener('mentria:command', (e) => {
  const d = e.detail || {};
  if (COMMANDS.indexOf(String(d.cmd || '')) === -1) return;
  e.preventDefault();
  if (app.engine) runCommand(d);
  else queuedCmd = { cmd: String(d.cmd), args: d.args || '' };
});

function runCommand(a) {
  const cmd = String(a.cmd || '');
  if (cmd === 'fin-add') openEntry(ctx(), { text: a.args || '' });
  else if (cmd === 'fin-budget') go('budgets');
  else if (cmd === 'fin-subs') go('subs');
  else if (cmd === 'fin-tax') go('taxes');
}

let lockTimer = null;
function armTimers() {
  const bump = () => { app.lastActive = Date.now(); };
  for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) window.addEventListener(ev, bump, { passive: true });
  clearInterval(lockTimer);
  lockTimer = setInterval(() => {
    const mins = app.local.auto_lock_min;
    if (!mins || !app.engine) return;
    const idle = Date.now() - app.lastActive;
    if (document.hidden && app.hiddenAt && Date.now() - app.hiddenAt > mins * 60000) lock();
    else if (!document.hidden && idle > mins * 60000 * 3) lock();
  }, 15000);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) app.hiddenAt = Date.now();
  else {
    const mins = app.local.auto_lock_min;
    if (app.engine && mins && app.hiddenAt && Date.now() - app.hiddenAt > mins * 60000) lock();
    app.hiddenAt = 0;
    if (app.sync && app.engine) app.sync.poke();
  }
});

export function lock() {
  U.closeAllSheets();
  import('./agents.js').then((A) => A.disableAgents()).catch(() => {});
  if (app.sync) { app.sync.stop(); app.sync = null; }
  if (app.engine) { app.engine.close(); app.engine = null; }
  app.ledger = null;
  clearTimeout(widgetTimer);
  updateWidget();
  start();
}

window.addEventListener('hashchange', () => { if (app.engine) render(); });

window.addEventListener('keydown', (e) => {
  if (!app.engine || U.sheetOpen()) return;
  const tag = (e.target && e.target.tagName) || '';
  if (/INPUT|TEXTAREA|SELECT/.test(tag) || e.metaKey || e.ctrlKey || e.altKey) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      try { if (window.parent && window.parent.MentriaPalette) { e.preventDefault(); window.parent.MentriaPalette.open(); } } catch (_) {}
    }
    return;
  }
  if (e.key === 'n') { e.preventDefault(); openEntry(ctx(), {}); }
  else if (e.key === '/') { e.preventDefault(); go('ledger', { q: '1' }); }
  else if (e.key === 'g') { app.gPending = Date.now(); }
  else if (app.gPending && Date.now() - app.gPending < 1200) {
    const map = { h: 'home', l: 'ledger', i: 'invest', p: 'plan', r: 'reports', b: 'budgets', s: 'subs', a: 'accounts', t: 'taxes', d: 'devices' };
    if (map[e.key]) { e.preventDefault(); go(map[e.key]); }
    app.gPending = 0;
  }
});

async function start() {
  const root = app.root;
  await loadLocal();
  const st = await V.status();
  showLock(root, {
    status: st,
    local: app.local,
    onOpen: (session) => openSession(session),
    saveLocal
  });
}

export async function boot() {
  U.setCopy(window.FIN_COPY || {});
  app.root = document.getElementById('fin');
  if (!app.root) return;
  try {
    await db.open();
  } catch (e) {
    app.root.replaceChildren(h('div', { class: 'flock' }, h('div', { class: 'flock__inner' }, h('h1', null, t('app.name')), h('p', { class: 'flock__lede' }, t('errors.no_storage') + ' ' + String(e && e.message || e)))));
    return;
  }
  await start();
}

boot();
