import { renderAgentParts, resultsOf, renderBody } from '/assets/js/comms/cards.js';

export const MAX_TURNS = 40;
export const MAX_CARDS = 60;

export const agentWindow = (turns, { maxTurns = MAX_TURNS, maxCards = MAX_CARDS, expanded = new Set() } = {}) => {
  const sorted = (turns || []).filter(Boolean).slice().sort((a, b) => a.n - b.n);
  const kept = sorted.slice(-maxTurns);
  const shown = kept.map((t) => {
    const msgs = t.msgs || [];
    if (expanded.has(t.n)) return { n: t.n, msgs, earlierCards: !!t.earlier };
    let count = 0;
    let start = msgs.length;
    while (start > 0) {
      const k = (msgs[start - 1].parts || []).length;
      if (count && count + k > maxCards) break;
      count += k;
      start--;
      if (count >= maxCards) break;
    }
    return { n: t.n, msgs: msgs.slice(start), earlierCards: start > 0 || !!t.earlier };
  });
  return { shown, earlierTurns: sorted.length > maxTurns || (sorted.length > 0 && sorted[0].n > 0) };
};

export const PENDING_MS = 2 * 60 * 1000;
const promptText = (m) => (m.parts || []).filter((x) => x.type === 'text').map((x) => x.text).join('\n').trim();

export const matchPending = (pending, msgs) => {
  const used = new Set();
  const left = [];
  for (const p of pending || []) {
    const i = (msgs || []).findIndex((m, k) => !used.has(k) && m.role === 'user' && m.via === 'phone' && Math.abs((m.ts || 0) - p.at) <= PENDING_MS && promptText(m) === String(p.text).trim());
    if (i >= 0) used.add(i); else left.push(p);
  }
  return left;
};

export const permResolved = (perm, msgs) => !perm || (msgs || []).some((m) => (m.ts || 0) > perm.ts && (m.role === 'user' || (m.parts || []).some((x) => x.type === 'tool_result')));

export const visiblePerm = (perms, sid, msgs) => {
  const kept = (perms || []).filter((p) => !p.answered && (p.sid !== sid || !permResolved(p, msgs)));
  const mine = kept.filter((p) => p.sid === sid);
  return { perm: mine.length ? mine[mine.length - 1] : null, kept };
};

export const RESUME_MS = 75000;
const CACHE_MAX = 40;

const fillIn = (s, v) => String(s == null ? '' : s).replace(/\{(\w+)\}/g, (_, k) => (v[k] != null ? String(v[k]) : ''));

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

export const createAgentView = ({ els, T, client, nameOf, onImage, onOpen, keepAliveMs = 60000, statusMs = 15000, resumeMs = RESUME_MS } = {}) => {
  const A = (T && T.agent) || {};
  let sid = null;
  let sub = null;
  let expanded = new Set();
  let paintTimer = 0;
  let pending = [];
  let perms = [];
  let placeholder = null;
  let cache = new Map();
  let opened = new Set();
  let nodes = new Map();
  const dirty = new Set();
  let timers = [];
  let hiddenAt = 0;
  const waiters = new Map();
  const offs = [];
  const byId = (id) => document.getElementById(id);
  const turnsNow = () => client.turns(sid, sub).map((n) => client.turn(sid, n, sub)).filter(Boolean);
  const allMsgs = () => turnsNow().flatMap((t) => t.msgs || []);
  const paintPerm = () => {
    const card = byId('comms-agent-perm');
    if (!card) return;
    if (!sid || sub) { card.hidden = true; return; }
    const r = visiblePerm(perms, sid, allMsgs());
    perms = r.kept;
    const p = r.perm;
    card.hidden = !p;
    if (!p) return;
    byId('comms-agent-perm-title').textContent = fillIn(A.wants, { tool: p.tool_name || '' });
    byId('comms-agent-perm-desc').textContent = p.description || '';
    byId('comms-agent-perm-preview').textContent = p.input_preview || '';
    card.dataset.id = p.request_id;
    card.dataset.sid = p.sid;
  };
  const answer = (behavior) => {
    const card = byId('comms-agent-perm');
    const id = card && card.dataset.id;
    const p = perms.find((x) => x.request_id === id && x.sid === sid);
    if (!p || !sid) return;
    p.answered = true;
    client.verdict(sid, id, behavior).catch(() => {});
    paintPerm();
  };
  if (byId('comms-agent-allow')) byId('comms-agent-allow').addEventListener('click', () => answer('allow'));
  if (byId('comms-agent-deny')) byId('comms-agent-deny').addEventListener('click', () => answer('deny'));

  const atBottom = () => !els.log || els.log.scrollHeight - els.log.scrollTop - els.log.clientHeight < 80;
  const remember = (ref, part) => {
    cache.set(ref, part);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  };
  const get = (ref) => {
    if (cache.has(ref)) return Promise.resolve(cache.get(ref));
    const at = sid;
    const atSub = sub;
    return new Promise((resolve) => {
      const key = at + '|' + (atSub || '') + '|' + ref;
      const t = setTimeout(() => { waiters.delete(key); resolve(null); }, 15000);
      waiters.set(key, (part) => { clearTimeout(t); if (part && at === sid && atSub === sub) remember(ref, part); resolve(part); });
      client.get(at, ref, atSub || undefined);
    });
  };
  const status = () => {
    if (!sid) return;
    const s = client.sessions().find((x) => x.sid === sid);
    els.status.textContent = s && s.online ? (A.running || '') : (A.offline || '');
  };
  const paintComposer = () => {
    if (!sid) return;
    const live = !sub && !!(client.channel && client.channel(sid));
    els.msg.disabled = !live;
    els.go.disabled = !live;
    els.msg.placeholder = sub ? placeholder : live ? fillIn(A.message, { name: els.chatTitle.textContent }) : (A.mirror_only || placeholder);
    if (byId('comms-agent-signed')) byId('comms-agent-signed').hidden = !live;
  };

  const renderTurn = (t, earlierCards) => {
    const box = el('div', 'comms__turn');
    box.dataset.n = String(t.n);
    if (earlierCards) {
      const more = el('button', 'comms__btn comms__btn--ghost comms__turn-more', A.earlier_turn || 'Show earlier in this turn');
      more.type = 'button';
      more.addEventListener('click', () => {
        expanded.add(t.n);
        dirty.add(t.n);
        const full = client.turn(sid, t.n, sub);
        if (full && full.first > 0) client.open(sid, t.n, full.first, sub || undefined);
        paint();
      });
      box.append(more);
    }
    const all = (client.turn(sid, t.n, sub) || { msgs: [] }).msgs.flatMap((m) => m.parts || []);
    const results = resultsOf(all);
    const common = { T: A, get, onImage, cache, opened };
    for (const m of t.msgs) {
      if (m.role === 'user') {
        const line = el('div', 'comms__line comms__line--me comms__agent-prompt');
        const what = el('span', 'comms__what');
        renderBody(what, (m.parts || []).filter((p) => p.type === 'text').map((p) => p.text).join('\n'), { from: 'self', T: T.chat, hold: true });
        line.append(what);
        const extra = (m.parts || []).filter((p) => p.type === 'image' || (p.type === 'text' && p.ref));
        if (extra.length) {
          const box2 = el('div', 'comms__agentmsg');
          renderAgentParts(box2, extra.map((p) => (p.type === 'text' ? Object.assign({}, p, { text: '' }) : p)), Object.assign({ TB: T.chat }, common));
          line.append(box2);
        }
        if (m.via === 'phone') line.append(el('span', 'comms__agent-via', A.from_phone || ''));
        box.append(line);
      } else {
        const msg = el('div', 'comms__agentmsg');
        renderAgentParts(msg, m.parts || [], Object.assign({ TB: T.chat, results, calls: new Set(all.filter((p) => p.type === 'tool_call').map((p) => p.id)), openSub: sub ? null : (id, title) => { if (onOpen) onOpen(sid, id, title); } }, common));
        box.append(msg);
      }
    }
    return box;
  };

  const paint = () => {
    paintTimer = 0;
    if (!sid) return;
    const stick = atBottom();
    const w = agentWindow(turnsNow(), { expanded });
    const out = [];
    if (w.earlierTurns && w.shown.length < MAX_TURNS && w.shown.length) {
      const b = el('button', 'comms__btn comms__btn--ghost comms__agent-earlier', A.earlier || 'Show earlier');
      b.type = 'button';
      b.addEventListener('click', () => client.list(sid, w.shown[0].n, sub || undefined));
      out.push(b);
    }
    const keep = new Map();
    for (const t of w.shown) {
      const shape = (t.earlierCards ? 1 : 0) + ':' + t.msgs.length + ':' + (expanded.has(t.n) ? 1 : 0);
      const old = nodes.get(t.n);
      const node = old && old.shape === shape && !dirty.has(t.n) ? old.node : renderTurn(t, t.earlierCards);
      keep.set(t.n, { node, shape });
      out.push(node);
    }
    nodes = keep;
    dirty.clear();
    pending = matchPending(pending, allMsgs());
    if (pending.length && !sub) {
      const box = el('div', 'comms__agent-pending');
      for (const p of pending) {
        const line = el('div', 'comms__line comms__line--me');
        const what = el('span', 'comms__what');
        renderBody(what, p.text, { from: 'self', T: T.chat });
        line.append(what, el('span', 'comms__agent-state' + (p.failed ? ' comms__agent-state--failed' : ''), p.failed ? (A.unpaired || '') : p.acked ? (A.delivered || '') : (A.sent || '')));
        box.append(line);
      }
      out.push(box);
    }
    els.log.replaceChildren(...out);
    paintPerm();
    paintComposer();
    if (stick) els.log.scrollTop = els.log.scrollHeight;
  };
  const schedule = () => { if (!paintTimer) paintTimer = setTimeout(paint, 60); };
  const stopTimers = () => { timers.forEach((t) => clearInterval(t)); timers = []; };
  const fresh = () => { cache = new Map(); opened = new Set(); nodes = new Map(); dirty.clear(); expanded = new Set(); };

  const resume = () => {
    if (!sid) return;
    client.reset(sid, sub || undefined);
    fresh();
    perms = [];
    if (sub) client.open(sid, 0, undefined, sub);
    else client.hello(sid);
    paint();
  };
  const onVisible = () => {
    if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
    if (!sid) return;
    if (hiddenAt && Date.now() - hiddenAt > resumeMs) resume();
    else { client.watch(sid); status(); paintComposer(); }
    hiddenAt = 0;
  };
  document.addEventListener('visibilitychange', onVisible);

  offs.push(client.on('turn', (m) => { if (m.sid === sid && (m.sub || null) === sub) { dirty.add(m.n); schedule(); } }));
  offs.push(client.on('turns', (m) => { if (m.sid === sid && (m.sub || null) === sub) for (const x of m.list || []) client.open(sid, x.n, undefined, sub || undefined); }));
  offs.push(client.on('here', () => { if (sid) status(); }));
  offs.push(client.on('chan', (m) => { if (m && m.sid === sid) paintComposer(); }));
  offs.push(client.on('ack', (m) => { const p = pending.find((x) => x.cmid === m.cmid); if (p && !p.acked) { p.acked = true; schedule(); } }));
  offs.push(client.on('perm', (m) => { if (!m || typeof m.request_id !== 'string' || typeof m.sid !== 'string') return; if (!perms.some((x) => x.sid === m.sid && x.request_id === m.request_id)) perms.push(Object.assign({}, m)); if (m.sid === sid) paintPerm(); }));
  offs.push(client.on('part', (m) => { const key = m.sid + '|' + (m.sub || '') + '|' + m.ref; const fn = waiters.get(key); if (fn) { waiters.delete(key); fn(m); } }));
  offs.push(client.on('err', (m) => { if (m && m.cmid && m.sid === sid) { const p = pending.find((x) => x.cmid === m.cmid); if (p && !p.failed) { p.failed = String(m.code || 'error'); schedule(); } } if (m.ref) { const key = m.sid + '|' + (m.sub || '') + '|' + m.ref; const fn = waiters.get(key); if (fn) { waiters.delete(key); fn(null); } } }));

  return {
    isOpen: () => !!sid,
    current: () => (sid ? { sid, sub } : null),
    open(nextSid, nextSub = null, title = '') {
      if (nextSid !== sid || nextSub !== sub) fresh();
      sid = nextSid;
      sub = nextSub;
      els.log.textContent = '';
      els.chatTitle.textContent = title || (nameOf ? nameOf(nextSid) : '') || nextSid.slice(0, 8);
      if (els.chatAvatar) els.chatAvatar.textContent = '>_';
      els.leave.hidden = false;
      els.peers.hidden = true;
      els.enc.hidden = true;
      els.callStart.hidden = true;
      els.share.hidden = true;
      status();
      if (placeholder == null) placeholder = els.msg.placeholder;
      if (sub) client.open(sid, 0, undefined, sub);
      else client.hello(sid);
      stopTimers();
      timers.push(setInterval(() => { if (sid) client.watch(sid); }, keepAliveMs));
      timers.push(setInterval(() => { status(); paintComposer(); }, statusMs));
      paint();
    },
    async say(text) {
      if (!sid || sub || !String(text).trim()) return null;
      const entry = { cmid: null, text: String(text), at: Date.now(), acked: false };
      pending.push(entry);
      paint();
      try { entry.cmid = await client.say(sid, entry.text); } catch (_) { pending = pending.filter((x) => x !== entry); paint(); return null; }
      return entry.cmid;
    },
    paint,
    resume,
    close() {
      sid = null;
      sub = null;
      pending = [];
      stopTimers();
      fresh();
      if (paintTimer) { clearTimeout(paintTimer); paintTimer = 0; }
      if (placeholder != null) els.msg.placeholder = placeholder;
      els.msg.disabled = false;
      els.go.disabled = false;
      if (byId('comms-agent-signed')) byId('comms-agent-signed').hidden = true;
      if (byId('comms-agent-perm')) byId('comms-agent-perm').hidden = true;
    },
    destroy() { stopTimers(); offs.forEach((f) => f()); document.removeEventListener('visibilitychange', onVisible); }
  };
};
