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

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

export const createAgentView = ({ els, T, client, nameOf, onImage, onOpen } = {}) => {
  const A = (T && T.agent) || {};
  let sid = null;
  let sub = null;
  let expanded = new Set();
  let paintTimer = 0;
  const waiters = new Map();
  const offs = [];

  const atBottom = () => !els.log || els.log.scrollHeight - els.log.scrollTop - els.log.clientHeight < 80;
  const get = (ref) => new Promise((resolve) => {
    const key = sid + '|' + (sub || '') + '|' + ref;
    const t = setTimeout(() => { waiters.delete(key); resolve(null); }, 15000);
    waiters.set(key, (part) => { clearTimeout(t); resolve(part); });
    client.get(sid, ref, sub || undefined);
  });
  const status = () => {
    const s = client.sessions().find((x) => x.sid === sid);
    els.status.textContent = s && s.online ? (A.running || '') : (A.offline || '');
  };

  const turnsNow = () => client.turns(sid, sub).map((n) => client.turn(sid, n, sub)).filter(Boolean);

  const renderTurn = (t, earlierCards) => {
    const box = el('div', 'comms__turn');
    box.dataset.n = String(t.n);
    if (earlierCards) {
      const more = el('button', 'comms__btn comms__btn--ghost comms__turn-more', A.earlier_turn || 'Show earlier in this turn');
      more.type = 'button';
      more.addEventListener('click', () => {
        expanded.add(t.n);
        const full = client.turn(sid, t.n, sub);
        if (full && full.first > 0) client.open(sid, t.n, full.first, sub || undefined);
        paint();
      });
      box.append(more);
    }
    const all = (client.turn(sid, t.n, sub) || { msgs: [] }).msgs.flatMap((m) => m.parts || []);
    const results = resultsOf(all);
    for (const m of t.msgs) {
      if (m.role === 'user') {
        const line = el('div', 'comms__line comms__line--me comms__agent-prompt');
        const what = el('span', 'comms__what');
        renderBody(what, (m.parts || []).filter((p) => p.type === 'text').map((p) => p.text).join('\n'), { from: 'self', T: T.chat });
        line.append(what);
        const imgs = (m.parts || []).filter((p) => p.type === 'image');
        if (imgs.length) { const box2 = el('div', 'comms__agentmsg'); renderAgentParts(box2, imgs, { T: A, get, onImage }); line.append(box2); }
        if (m.via === 'phone') line.append(el('span', 'comms__agent-via', A.from_phone || ''));
        box.append(line);
      } else {
        const msg = el('div', 'comms__agentmsg');
        renderAgentParts(msg, m.parts || [], { T: A, TB: T.chat, results, calls: new Set(all.filter((p) => p.type === 'tool_call').map((p) => p.id)), get, onImage, openSub: sub ? null : (id) => { if (onOpen) onOpen(sid, id); } });
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
    els.log.textContent = '';
    if (w.earlierTurns && w.shown.length < MAX_TURNS && w.shown.length) {
      const b = el('button', 'comms__btn comms__btn--ghost comms__agent-earlier', A.earlier || 'Show earlier');
      b.type = 'button';
      b.addEventListener('click', () => client.list(sid, w.shown[0].n, sub || undefined));
      els.log.append(b);
    }
    for (const t of w.shown) els.log.append(renderTurn(t, t.earlierCards));
    if (stick) els.log.scrollTop = els.log.scrollHeight;
  };
  const schedule = () => { if (!paintTimer) paintTimer = setTimeout(paint, 60); };

  offs.push(client.on('turn', (m) => { if (m.sid === sid && (m.sub || null) === sub) schedule(); }));
  offs.push(client.on('turns', (m) => { if (m.sid === sid && (m.sub || null) === sub) for (const x of m.list || []) client.open(sid, x.n, undefined, sub || undefined); }));
  offs.push(client.on('here', () => { if (sid) status(); }));
  offs.push(client.on('part', (m) => { const key = m.sid + '|' + (m.sub || '') + '|' + m.ref; const fn = waiters.get(key); if (fn) { waiters.delete(key); fn(m); } }));
  offs.push(client.on('err', (m) => { if (m.ref) { const key = m.sid + '|' + (m.sub || '') + '|' + m.ref; const fn = waiters.get(key); if (fn) { waiters.delete(key); fn(null); } } }));

  return {
    isOpen: () => !!sid,
    current: () => (sid ? { sid, sub } : null),
    open(nextSid, nextSub = null, title = '') {
      sid = nextSid;
      sub = nextSub;
      expanded = new Set();
      els.log.textContent = '';
      els.chatTitle.textContent = title || (nameOf ? nameOf(nextSid) : '') || nextSid.slice(0, 8);
      if (els.chatAvatar) els.chatAvatar.textContent = '>_';
      els.leave.hidden = false;
      els.peers.hidden = true;
      els.enc.hidden = true;
      els.callStart.hidden = true;
      els.share.hidden = true;
      status();
      if (sub) client.open(sid, 0, undefined, sub);
      else client.hello(sid);
      paint();
    },
    paint,
    close() { sid = null; sub = null; if (paintTimer) { clearTimeout(paintTimer); paintTimer = 0; } },
    destroy() { offs.forEach((f) => f()); }
  };
};
