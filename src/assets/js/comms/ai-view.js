import { trimForRequest } from '/assets/js/comms/ai-link.js';
import { turnToMessage, messagesToTurns, messageIndex } from '/assets/js/comms/ai-thread.js';
import { tierLabel } from '/assets/js/ai-turn.js';
import { TIERS } from '/assets/js/mentria-tiers.js';

const fill = (tpl, vars) => String(tpl == null ? '' : tpl).replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m));

export const tierName = (tier) => (TIERS[tier] && TIERS[tier].name) || String(tier || '');

export const aiRoute = (thread, { myDeviceId } = {}) => {
  const meta = thread && thread.meta;
  const route = meta && meta.route;
  if (!route || !route.device || route.device === myDeviceId) return 'page';
  if (meta.tool === 'annotate-image') return 'page';
  return 'inline';
};

export const modelSections = ({ local = [], hosts = [], known = {}, myDeviceId, T } = {}) => {
  const A = (T && T.ai) || {};
  const D = (T && T.devices) || {};
  const out = [{
    title: A.this_device || '',
    device: null,
    online: true,
    items: local.map((m) => ({ tier: m.tier, label: tierName(m.tier), state: m.cached ? 'cached' : 'download', size: String(m.sizeLabel || '') }))
  }];
  const online = new Map();
  for (const h of hosts || []) if (h && h.device && h.device.id && h.device.id !== myDeviceId) online.set(h.device.id, h);
  const ids = new Set(Array.from(online.keys()).concat(Object.keys(known || {})));
  ids.delete(myDeviceId);
  const rows = [];
  for (const id of ids) {
    const h = online.get(id);
    const k = (known || {})[id];
    const dev = (h && h.device) || (k && k.device);
    if (!dev) continue;
    const models = (h ? h.models : k && k.models) || [];
    rows.push({
      title: D['kind_' + dev.kind] || dev.name || dev.kind || '',
      device: dev,
      online: !!h,
      seen: Number(h ? h.at : k && k.at) || 0,
      items: models.map((m) => ({ tier: m.tier, label: tierName(m.tier), state: h ? (m.state === 'loaded' ? 'loaded' : 'cached') : 'asleep', size: '' }))
    });
  }
  rows.sort((a, b) => (Number(b.online) - Number(a.online)) || (b.seen - a.seen));
  return out.concat(rows.map((r) => ({ title: r.title, device: r.device, online: r.online, items: r.items })));
};

export const openModelMenu = ({ sections, current, onPick, T } = {}) => {
  const A = (T && T.ai) || {};
  let dlg = document.getElementById('comms-ai-menu');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'comms-ai-menu';
    dlg.className = 'comms__sheet comms__aimenu';
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    document.body.append(dlg);
  }
  dlg.replaceChildren();
  const title = document.createElement('h2');
  title.className = 'comms__sheet-title';
  title.textContent = A.menu_title || '';
  dlg.append(title);
  for (const sec of sections || []) {
    if (!sec.items.length) continue;
    const head = document.createElement('h3');
    head.className = 'comms__aimenu-head';
    head.textContent = sec.title;
    const list = document.createElement('div');
    list.className = 'comms__aimenu-list';
    for (const it of sec.items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'comms__aimenu-item';
      b.dataset.tier = it.tier;
      b.dataset.device = sec.device ? sec.device.id : '';
      b.dataset.state = it.state;
      const here = current && current.tier === it.tier && (current.device || '') === (sec.device ? sec.device.id : '');
      if (here) b.setAttribute('aria-current', 'true');
      const name = document.createElement('span');
      name.className = 'comms__aimenu-name';
      name.textContent = it.label;
      const note = document.createElement('span');
      note.className = 'comms__aimenu-note';
      note.textContent = it.state === 'loaded' ? (A.loaded || '') : it.state === 'asleep' ? (A.asleep || '') : it.state === 'download' ? fill(A.download, { size: it.size }) : '';
      b.append(name, note);
      if (it.state === 'asleep') b.disabled = true;
      b.addEventListener('click', () => {
        try { dlg.close(); } catch (_) {}
        if (onPick) onPick({ tier: it.tier, device: sec.device, state: it.state });
      });
      list.append(b);
    }
    dlg.append(head, list);
  }
  try { if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', ''); } catch (_) { dlg.setAttribute('open', ''); }
  return dlg;
};

const HISTORY_LIMIT = 200;

export const createAiView = ({ els, T, getStore, client, device, renderLine, sys, renderBody, onChange, onBusy, prefix = '' } = {}) => {
  const A = (T && T.ai) || {};
  const D = (T && T.devices) || {};
  let thread = null;
  let live = null;
  let paint = 0;

  const route = () => (thread && thread.meta && thread.meta.route) || null;
  const deviceName = (r) => (r && (D['kind_' + r.kind] || r.kind)) || '';
  const chip = () => document.getElementById('comms-ai-model');
  const attachCtl = () => document.querySelector('#comms-send .comms__attach');
  const homeStatus = () => {
    const r = route();
    if (r) els.status.textContent = fill(A.from_device, { model: tierName(r.tier), device: deviceName(r) });
  };
  const replyLabel = (tier) => tierLabel(tier) + ' · ' + deviceName(route());

  const setControls = (open) => {
    const c = chip();
    const att = attachCtl();
    if (open) {
      const r = route();
      els.callStart.hidden = true;
      els.share.hidden = true;
      const mb = document.getElementById('comms-media-btn');
      if (mb) mb.hidden = true;
      if (att) att.hidden = true;
      if (c) { c.textContent = tierName(r.tier) + ' · ' + deviceName(r); c.hidden = false; }
    } else {
      if (att) att.hidden = false;
      if (c) { c.hidden = true; c.textContent = ''; }
    }
  };

  const modelLine = (text, label, ts, index) => {
    const r = renderLine(label, '', { ts });
    r.line.classList.add('comms__line--ai');
    if (index != null) r.line.dataset.index = String(index);
    const who = r.line.querySelector('.comms__who');
    if (who) who.classList.add('comms__ai-label');
    renderBody(r.what, text, { from: 'model' });
    const actions = document.createElement('div');
    actions.className = 'comms__ai-actions';
    const btn = (act, label) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'comms__btn comms__btn--ghost comms__ai-act';
      b.dataset.act = act;
      b.textContent = label;
      return b;
    };
    const copy = btn('copy', A.copy || 'Copy');
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(r.line.dataset.text || ''); copy.textContent = A.copied || 'Copied'; setTimeout(() => { copy.textContent = A.copy || 'Copy'; }, 1200); } catch (_) {}
    });
    const retry = btn('retry', A.retry || 'Retry');
    retry.addEventListener('click', () => { retryAt(Number(r.line.dataset.index)); });
    actions.append(copy, retry);
    r.line.append(actions);
    r.line.dataset.text = text;
    return { line: r.line, what: r.what, actions };
  };

  const saveThread = async (preview, ts) => {
    const store = getStore();
    if (!store || !thread) return;
    thread = Object.assign({}, thread, { preview: String(preview || '').slice(0, 200), updatedAt: ts || Date.now() });
    try { await store.putThread(thread); } catch (_) {}
    if (onChange) onChange(thread);
  };

  const history = async () => {
    const store = getStore();
    if (!store || !thread) return [];
    return store.listMessages(thread.id, { limit: HISTORY_LIMIT });
  };

  const nextIndex = (msgs) => msgs.reduce((n, m) => { const i = messageIndex(m); return i != null && i >= n ? i + 1 : n; }, 0);

  const saveReply = async (index, text, tier, extra) => {
    const store = getStore();
    if (!store || !thread) return;
    const msg = turnToMessage(Object.assign({ role: 'assistant', text, model: replyLabel(tier) }, extra || {}), thread.id, index, Date.now());
    try { await store.putMessage(msg, { replace: true }); } catch (_) {}
    await saveThread(text, msg.ts);
  };

  const finishHere = async () => {
    if (!thread) return;
    const store = getStore();
    const next = Object.assign({}, thread, { meta: Object.assign({}, thread.meta, { route: null }) });
    if (store) { try { await store.putThread(next); } catch (_) {} }
    window.location.href = prefix + '/tools/ai-chat/?thread=' + encodeURIComponent(next.id) + '&regen=1';
  };

  const stoppedNotice = (text) => {
    const n = sys(text);
    if (!n || !n.line) return;
    n.line.classList.add('comms__ai-stopped');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'comms__btn comms__btn--ghost comms__ai-act';
    b.dataset.act = 'finish';
    b.textContent = A.finish || '';
    b.addEventListener('click', () => { finishHere(); });
    n.line.append(b);
  };

  const syncRetry = () => {
    const lines = Array.from(els.log.querySelectorAll('.comms__line--ai'));
    lines.forEach((line, i) => {
      const b = line.querySelector('[data-act="retry"]');
      if (b) b.hidden = i !== lines.length - 1 || !!live;
    });
  };

  const busyNow = (on) => { if (onBusy) { try { onBusy(on); } catch (_) {} } };
  const finishLive = () => {
    cancelAnimationFrame(paint);
    paint = 0;
    live = null;
    busyNow(false);
    homeStatus();
    syncRetry();
  };

  const run = async (msgs, index, lineAt) => {
    const r = route();
    const host = client.hostFor(r.device);
    if (!host) { stoppedNotice(fill(A.offline, { device: deviceName(r) })); return; }
    const turns = messagesToTurns(msgs);
    const messages = trimForRequest(turns);
    if (!messages.length) return;
    const ml = lineAt || modelLine('', replyLabel(r.tier), Date.now(), index);
    const handle = client.ask(host.peerId, { threadId: thread.id, tier: r.tier, messages, pageLang: document.documentElement.lang || 'en', from: { device } });
    const me = { handle, ml, text: '', index, tier: r.tier, threadId: thread.id };
    live = me;
    busyNow(true);
    syncRetry();
    const draw = () => {
      paint = 0;
      renderBody(ml.what, me.text, { from: 'model' });
      ml.line.dataset.text = me.text;
      if (els.log) els.log.scrollTop = els.log.scrollHeight;
    };
    handle.on('wait', (w) => {
      if (live !== me) return;
      els.status.textContent = w.reason === 'loading' ? fill(A.loading, { model: tierName(r.tier), device: deviceName(r) }) : fill(A.busy, { device: deviceName(r) });
    });
    handle.on('tok', (t) => {
      if (live !== me) return;
      me.text = t.full;
      homeStatus();
      if (!paint) paint = requestAnimationFrame(draw);
    });
    handle.on('done', async ({ stats }) => {
      if (live !== me) return;
      draw();
      const tier = (stats && stats.tier) || r.tier;
      const label = ml.line.querySelector('.comms__ai-label');
      if (label && label.firstChild) label.firstChild.textContent = replyLabel(tier);
      finishLive();
      await saveReply(index, me.text, tier);
    });
    handle.on('err', async ({ reason }) => {
      if (live !== me) return;
      draw();
      finishLive();
      if (reason === 'cancelled') { if (me.text) await saveReply(index, me.text, r.tier, { stopped: true }); return; }
      if (!me.text) ml.line.remove();
      else await saveReply(index, me.text, r.tier, { stopped: true });
      const name = deviceName(r);
      if (reason === 'not-hosting') { stoppedNotice(fill(A.offline, { device: name })); return; }
      if (reason === 'failed') { stoppedNotice(fill(A.failed, { device: name })); return; }
      const text = reason === 'tier-unavailable' ? fill(A.gone_tier, { model: tierName(r.tier), device: name })
        : fill(A.busy, { device: name });
      sys(text);
    });
    handle.on('gone', async () => {
      if (live !== me) return;
      draw();
      finishLive();
      if (me.text) await saveReply(index, me.text, r.tier, { stopped: true });
      else ml.line.remove();
      stoppedNotice(fill(A.stopped, { device: deviceName(r) }));
    });
  };

  const retryAt = async (index) => {
    if (live || !thread || !Number.isInteger(index)) return;
    const msgs = (await history()).filter((m) => { const i = messageIndex(m); return i != null && i < index; });
    if (!msgs.length) return;
    const line = els.log.querySelector('.comms__line--ai[data-index="' + index + '"]');
    let ml = null;
    if (line) {
      const r = route();
      line.remove();
      ml = modelLine('', replyLabel(r.tier), Date.now(), index);
    }
    run(msgs, index, ml);
  };

  return {
    isOpen: () => !!thread,
    current: () => thread,
    busy: () => !!live,
    async open(t) {
      if (live) {
        const me = live;
        try { me.handle.cancel(); } catch (_) {}
        finishLive();
        if (me.text) await saveReply(me.index, me.text, me.tier, { stopped: true });
      }
      thread = t;
      live = null;
      els.log.innerHTML = '';
      els.chatTitle.textContent = t.title || A.untitled || '';
      if (els.chatAvatar) els.chatAvatar.textContent = '';
      els.leave.hidden = false;
      els.peers.hidden = true;
      els.enc.hidden = true;
      els.msg.disabled = false;
      els.go.disabled = false;
      setControls(true);
      homeStatus();
      const msgs = await history();
      if (thread !== t) return;
      for (const m of msgs) {
        if (m.from === 'self') renderLine('you', m.t, { me: true, quiet: true, ts: m.ts });
        else modelLine(m.t, (m.meta && m.meta.model) || replyLabel(route().tier), m.ts, messageIndex(m));
      }
      syncRetry();
      if (els.log) els.log.scrollTop = els.log.scrollHeight;
    },
    close() {
      if (live) {
        const me = live;
        try { me.handle.cancel(); } catch (_) {}
        if (me.text) saveReply(me.index, me.text, me.tier, { stopped: true });
        finishLive();
      }
      setControls(false);
      thread = null;
    },
    stop() {
      if (!live) return;
      const me = live;
      try { me.handle.cancel(); } catch (_) {}
      finishLive();
      if (me.text) saveReply(me.index, me.text, me.tier, { stopped: true });
    },
    async send(text) {
      const body = String(text || '').trim();
      if (!body || !thread || live) return;
      const store = getStore();
      if (!store) return;
      const msgs = await history();
      const index = nextIndex(msgs);
      const ts = Date.now();
      const userMsg = turnToMessage({ role: 'user', text: body }, thread.id, index, ts);
      try { await store.putMessage(userMsg); } catch (_) {}
      renderLine('you', body, { me: true, ts });
      await saveThread(body, ts);
      await run(msgs.concat([userMsg]), index + 1);
    }
  };
};
