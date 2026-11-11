import { renderAgentParts, renderToolGroup, TOOLISH, resultsOf, renderBody } from '/assets/js/comms/cards.js';

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
const SIGNED_KEY = 'mentria.comms.agent_signed_seen';
const signedSeen = () => { try { return localStorage.getItem(SIGNED_KEY) === '1'; } catch (_) { return false; } };
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
  let earlierBtn = null;
  let asks = [];
  let earliestN = 0;
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
    els.status.textContent = s && s.online ? (s.host && A.running_on ? A.running_on.replace('{name}', s.host) : (A.running || '')) : (A.offline || '');
  };
  const paintComposer = () => {
    if (!sid) return;
    const live = !sub && !!(client.channel && client.channel(sid));
    els.msg.disabled = !live;
    els.go.disabled = !live;
    els.msg.placeholder = sub ? placeholder : live ? fillIn(A.message, { name: els.chatTitle.textContent }) : (A.mirror_only || placeholder);
    if (byId('comms-agent-signed')) byId('comms-agent-signed').hidden = !live || signedSeen();
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
    const callIds = new Set(all.filter((p) => p.type === 'tool_call').map((p) => p.id));
    let run = [];
    let group = [];
    const flushRun = () => {
      if (!run.length) return;
      const msg = el('div', 'comms__agentmsg');
      renderAgentParts(msg, run, Object.assign({ TB: T.chat, results, calls: callIds, openSub: sub ? null : (id, title) => { if (onOpen) onOpen(sid, id, title); } }, common));
      box.append(msg);
      run = [];
    };
    const flushGroup = () => {
      if (!group.length) return;
      if (group.some((p) => p.type === 'tool_call' || p.type === 'thought')) {
        const msg = el('div', 'comms__agentmsg');
        msg.append(renderToolGroup(group, Object.assign({ results }, common)));
        box.append(msg);
      }
      group = [];
    };
    const flush = () => { flushRun(); flushGroup(); };
    for (const m of t.msgs) {
      if (m.role === 'user') {
        flush();
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
        for (const p of m.parts || []) {
          if (p && TOOLISH.has(p.type)) { flushRun(); group.push(p); }
          else { flushGroup(); run.push(p); }
        }
        continue;
      }
    }
    flush();
    return box;
  };

  const paint = () => {
    paintTimer = 0;
    if (!sid) return;
    const stick = atBottom();
    const top = els.log.scrollTop;
    const w = agentWindow(turnsNow(), { expanded });
    const out = [];
    if (w.earlierTurns && w.shown.length < MAX_TURNS && w.shown.length) {
      earliestN = w.shown[0].n;
      if (!earlierBtn) {
        earlierBtn = el('button', 'comms__btn comms__btn--ghost comms__agent-earlier', A.earlier || 'Show earlier');
        earlierBtn.type = 'button';
        earlierBtn.addEventListener('click', () => { if (sid) client.list(sid, earliestN, sub || undefined); });
      }
      out.push(earlierBtn);
    }
    const keep = new Map();
    for (const t of w.shown) {
      const shape = (t.earlierCards ? 1 : 0) + ':' + t.msgs.length + ':' + (expanded.has(t.n) ? 1 : 0);
      const old = nodes.get(t.n);
      const node = old && old.shape === shape && !dirty.has(t.n) ? old.node : renderTurn(t, t.earlierCards);
      if (old && old.node !== node && old.node.parentNode === els.log) {
        const h = Math.round(old.node.getBoundingClientRect().height);
        if (h > 0) node.style.containIntrinsicSize = 'auto ' + h + 'px';
        old.node.replaceWith(node);
      }
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
    if (!sub) for (const a of asks) if (a.sid === sid) out.push(askCard(a));
    const wanted = new Set(out);
    let cur = els.log.firstChild;
    for (const node of out) {
      while (cur && !wanted.has(cur)) { const next = cur.nextSibling; cur.remove(); cur = next; }
      if (cur === node) { cur = cur.nextSibling; continue; }
      els.log.insertBefore(node, cur);
    }
    while (cur) { const next = cur.nextSibling; cur.remove(); cur = next; }
    paintPerm();
    paintComposer();
    if (stick) els.log.scrollTop = els.log.scrollHeight;
    else if (els.log.scrollTop !== top) els.log.scrollTop = top;
  };
  const schedule = () => { if (!paintTimer) paintTimer = setTimeout(paint, 60); };

  const askReady = (a) => a.questions.every((q, i) => a.sel[i].size > 0 || a.text[i].trim());
  const askCard = (a) => {
    if (a.node) return a.node;
    const card = el('div', 'comms__agent-ask');
    const send = el('button', 'comms__btn comms__ask-send', A.ask_send || 'Send');
    send.type = 'button';
    const state = el('span', 'comms__agent-state');
    const sync = () => { send.disabled = a.sent || !askReady(a); state.textContent = a.failed ? (A.unpaired || '') : a.sent ? (A.ask_sent || '') : ''; state.classList.toggle('comms__agent-state--failed', !!a.failed); };
    a.questions.forEach((q, i) => {
      const box = el('div', 'comms__ask-q');
      if (q.header) box.append(el('span', 'comms__ask-head', q.header));
      box.append(el('p', 'comms__ask-text', q.question));
      const opts = el('div', 'comms__ask-opts');
      const buttons = [];
      for (const o of q.options || []) {
        const b = el('button', 'comms__ask-opt');
        b.type = 'button';
        b.setAttribute('aria-pressed', 'false');
        b.append(el('span', 'comms__ask-label', o.label));
        if (o.description) b.append(el('span', 'comms__ask-desc', o.description));
        b.addEventListener('click', () => {
          if (a.sent) return;
          if (q.multiSelect) { if (a.sel[i].has(o.label)) a.sel[i].delete(o.label); else a.sel[i].add(o.label); }
          else { const had = a.sel[i].has(o.label); a.sel[i].clear(); if (!had) a.sel[i].add(o.label); }
          for (const [bb, label] of buttons) bb.setAttribute('aria-pressed', String(a.sel[i].has(label)));
          sync();
        });
        buttons.push([b, o.label]);
        opts.append(b);
      }
      box.append(opts);
      const other = el('input', 'comms__ask-other');
      other.type = 'text';
      other.maxLength = 2000;
      other.placeholder = A.ask_other || '';
      other.setAttribute('aria-label', A.ask_other || q.question);
      other.addEventListener('input', () => { a.text[i] = other.value; sync(); });
      box.append(other);
      card.append(box);
    });
    send.addEventListener('click', async () => {
      if (a.sent || !askReady(a)) return;
      a.sent = true;
      a.failed = null;
      sync();
      try {
        a.cmid = await client.answer(a.sid, a.id, a.questions.map((q, i) => (a.text[i].trim() ? { labels: Array.from(a.sel[i]), text: a.text[i].trim() } : { labels: Array.from(a.sel[i]) })));
      } catch (_) { a.sent = false; sync(); }
    });
    const foot = el('div', 'comms__ask-foot');
    foot.append(send, state);
    card.append(foot);
    a.sync = sync;
    sync();
    a.node = card;
    return card;
  };
  const stopTimers = () => { timers.forEach((t) => clearInterval(t)); timers = []; };
  const fresh = () => { cache = new Map(); opened = new Set(); nodes = new Map(); dirty.clear(); expanded = new Set(); };

  const resume = () => {
    if (!sid) return;
    client.reset(sid, sub || undefined);
    fresh();
    perms = [];
    asks = [];
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
  offs.push(client.on('ask', (m) => {
    if (!m || typeof m.sid !== 'string' || typeof m.id !== 'string' || !Array.isArray(m.questions) || !m.questions.length) return;
    if (asks.some((x) => x.sid === m.sid && x.id === m.id)) return;
    const questions = m.questions.slice(0, 4).map((q) => ({ question: String((q && q.question) || ''), header: String((q && q.header) || '').slice(0, 40), multiSelect: !!(q && q.multiSelect), options: (Array.isArray(q && q.options) ? q.options : []).slice(0, 6).map((o) => ({ label: String((o && o.label) || ''), description: o && o.description ? String(o.description) : '' })) }));
    asks.push({ sid: m.sid, id: m.id, questions, sel: questions.map(() => new Set()), text: questions.map(() => ''), sent: false });
    if (m.sid === sid) schedule();
  }));
  offs.push(client.on('asked', (m) => { const before = asks.length; asks = asks.filter((x) => !(m && x.sid === m.sid && x.id === m.id)); if (asks.length !== before && m.sid === sid) schedule(); }));
  offs.push(client.on('ack', (m) => { const p = pending.find((x) => x.cmid === m.cmid); if (p && !p.acked) { p.acked = true; try { localStorage.setItem(SIGNED_KEY, '1'); } catch (_) {} schedule(); } }));
  offs.push(client.on('perm', (m) => { if (!m || typeof m.request_id !== 'string' || typeof m.sid !== 'string') return; if (!perms.some((x) => x.sid === m.sid && x.request_id === m.request_id)) perms.push(Object.assign({}, m)); if (m.sid === sid) paintPerm(); }));
  offs.push(client.on('part', (m) => { const key = m.sid + '|' + (m.sub || '') + '|' + m.ref; const fn = waiters.get(key); if (fn) { waiters.delete(key); fn(m); } }));
  offs.push(client.on('err', (m) => { if (m && m.cmid) { const q = asks.find((x) => x.cmid === m.cmid); if (q) { q.failed = String(m.code || 'error'); q.sent = false; if (q.sync) q.sync(); } } if (m && m.cmid && m.sid === sid) { const p = pending.find((x) => x.cmid === m.cmid); if (p && !p.failed) { p.failed = String(m.code || 'error'); schedule(); } } if (m.ref) { const key = m.sid + '|' + (m.sub || '') + '|' + m.ref; const fn = waiters.get(key); if (fn) { waiters.delete(key); fn(null); } } }));

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
