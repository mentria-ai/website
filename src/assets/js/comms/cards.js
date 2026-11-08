const TRAIL = '.,;:!?\'"';
const CLOSERS = { ')': '(', ']': '[', '}': '{' };
const LINK_RE = /(^|[^\w@./-])((?:https?:\/\/|www\.)[^\s<>"`]+)/gi;
const CONTROL = /[\u0000-\u0020\u007f-\u009f\u00a0\u1680\u2000-\u200f\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]+/g;
const NO_LINKS = new Set(['A', 'CODE', 'PRE']);

const count = (s, ch) => {
  let n = 0;
  for (const c of s) if (c === ch) n++;
  return n;
};

export const allowedHref = (href) => /^(https?:|mailto:)/.test(String(href == null ? '' : href).replace(CONTROL, '').toLowerCase());

export const findLinks = (text) => {
  const s = String(text == null ? '' : text);
  const out = [];
  LINK_RE.lastIndex = 0;
  let m;
  while ((m = LINK_RE.exec(s))) {
    const begin = m.index + m[1].length;
    let url = m[2];
    for (;;) {
      const last = url[url.length - 1];
      if (TRAIL.includes(last)) { url = url.slice(0, -1); continue; }
      const open = CLOSERS[last];
      if (open && count(url, last) > count(url, open)) { url = url.slice(0, -1); continue; }
      break;
    }
    const bare = /^www\./i.test(url);
    const rest = url.replace(/^(?:https?:\/\/|www\.)/i, '');
    if (!rest || (bare && !rest.includes('.'))) continue;
    out.push({ start: begin, end: begin + url.length, href: bare ? 'https://' + url : url });
  }
  return out;
};

export const isOutsideImage = (src, origin) => {
  try {
    const u = new URL(String(src), origin);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.origin !== new URL(origin).origin;
  } catch (_) {
    return false;
  }
};

const linkText = (root) => {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      for (let p = n.parentNode; p && p !== root; p = p.parentNode) if (NO_LINKS.has(p.nodeName)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  const nodes = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
  for (const n of nodes) {
    const links = findLinks(n.data);
    if (!links.length) continue;
    const frag = doc.createDocumentFragment();
    let at = 0;
    for (const l of links) {
      if (l.start > at) frag.append(n.data.slice(at, l.start));
      const a = doc.createElement('a');
      a.setAttribute('href', l.href);
      a.textContent = n.data.slice(l.start, l.end);
      frag.append(a);
      at = l.end;
    }
    if (at < n.data.length) frag.append(n.data.slice(at));
    n.replaceWith(frag);
  }
};

const fixLinks = (root) => {
  for (const a of Array.from(root.querySelectorAll('a'))) {
    const href = a.getAttribute('href');
    if (!href || !allowedHref(href)) {
      a.replaceWith(...Array.from(a.childNodes));
      continue;
    }
    const text = a.textContent.trim();
    if (/^http:\/\/www\./i.test(href) && href.slice(7) === text) a.setAttribute('href', 'https://' + text);
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
  }
};

const holdImages = (root, T) => {
  const doc = root.ownerDocument;
  const origin = location.origin;
  for (const img of Array.from(root.querySelectorAll('img'))) {
    const src = img.getAttribute('src') || '';
    if (!isOutsideImage(src, origin)) continue;
    let host = '';
    try { host = new URL(src, origin).host; } catch (_) {}
    const alt = img.getAttribute('alt');
    const title = img.getAttribute('title');
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = 'm-btn m-btn--ghost comms__imgload';
    b.textContent = String((T && T.load_image) || '{host}').replace('{host}', host);
    b.addEventListener('click', () => {
      const shown = b.ownerDocument.createElement('img');
      if (alt != null) shown.setAttribute('alt', alt);
      if (title != null) shown.setAttribute('title', title);
      shown.setAttribute('src', src);
      b.replaceWith(shown);
    });
    img.replaceWith(b);
  }
};

export const renderBody = (el, text, opts = {}) => {
  const src = String(text == null ? '' : text);
  const tpl = document.createElement('template');
  const render = typeof window !== 'undefined' ? window.renderMarkdown : null;
  if (typeof render === 'function') tpl.innerHTML = render(src) || '';
  else tpl.content.append(document.createTextNode(src));
  const root = tpl.content;
  linkText(root);
  fixLinks(root);
  if (opts.from === 'person' || opts.hold) holdImages(root, opts.T);
  el.replaceChildren(root);
};

const RING_R = 15;
const RING_C = 2 * Math.PI * RING_R;
const SVG_NS = 'http://www.w3.org/2000/svg';

export const albumLayout = (n) => (n <= 1 ? 'one' : n === 2 ? 'two' : n === 3 ? 'three' : 'grid');

export const fmtBytes = (n) => {
  const v = Math.max(0, Number(n) || 0);
  if (v >= 1e9) return (v / 1e9).toFixed(v >= 1e10 ? 0 : 1) + ' GB';
  if (v >= 1e6) return (v / 1e6).toFixed(v >= 1e7 ? 0 : 1) + ' MB';
  if (v >= 1e3) return Math.round(v / 1e3) + ' KB';
  return v + ' B';
};

const fmtDur = (s) => {
  const t = Math.max(0, Math.round(Number(s) || 0));
  const m = Math.floor(t / 60);
  const h = Math.floor(m / 60);
  const ss = String(t % 60).padStart(2, '0');
  return h ? h + ':' + String(m % 60).padStart(2, '0') + ':' + ss : m + ':' + ss;
};

const fill = (tpl, vars) => String(tpl == null ? '' : tpl).replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m));

const node = (doc, tag, cls, text) => {
  const el = doc.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
};

const ring = (doc) => {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'comms__pring');
  svg.setAttribute('viewBox', '0 0 36 36');
  svg.setAttribute('aria-hidden', 'true');
  const back = doc.createElementNS(SVG_NS, 'circle');
  back.setAttribute('class', 'comms__pring-back');
  const front = doc.createElementNS(SVG_NS, 'circle');
  front.setAttribute('class', 'comms__pring-fill');
  for (const c of [back, front]) { c.setAttribute('cx', '18'); c.setAttribute('cy', '18'); c.setAttribute('r', String(RING_R)); }
  front.setAttribute('stroke-dasharray', '0 ' + RING_C.toFixed(2));
  svg.append(back, front);
  return svg;
};

const FILE_KINDS = [
  ['pdf', (m, n) => /pdf$/i.test(m) || /\.pdf$/i.test(n)],
  ['archive', (m, n) => /zip|rar|7z|tar|gzip|x-bzip/i.test(m) || /\.(zip|rar|7z|tar|gz|tgz|bz2)$/i.test(n)],
  ['audio', (m) => /^audio\//i.test(m)],
  ['text', (m, n) => /^text\//i.test(m) || /json|xml|csv/i.test(m) || /\.(txt|md|csv|json)$/i.test(n)]
];
const fileKind = (mime, name) => {
  for (const [k, test] of FILE_KINDS) if (test(String(mime || ''), String(name || ''))) return k;
  return 'other';
};

const mediaUrl = (ref) => '/comms-media/' + encodeURIComponent(ref);

const tileOf = (doc, item, more) => {
  const b = node(doc, 'button', 'comms__tile');
  b.type = 'button';
  b.dataset.ref = item.ref;
  b.dataset.kind = item.type;
  const img = node(doc, 'img', 'comms__tile-img is-blurred');
  img.alt = '';
  img.decoding = 'async';
  const thumb = item.type === 'video' ? item.poster : item.thumb;
  if (thumb) img.src = 'data:image/jpeg;base64,' + thumb;
  b.append(img, ring(doc));
  if (item.type === 'video') {
    b.append(node(doc, 'span', 'comms__tile-play'));
    if (item.duration != null) b.append(node(doc, 'span', 'comms__tile-dur', fmtDur(item.duration)));
  }
  if (more > 0) b.append(node(doc, 'span', 'comms__album-more', '+' + more));
  return b;
};

const fileCardOf = (doc, item, T) => {
  const F = (T && T.files) || {};
  const card = node(doc, 'div', 'comms__filecard');
  card.dataset.ref = item.ref;
  const kind = fileKind(item.mime, item.name);
  card.dataset.kind = kind;
  card.append(node(doc, 'span', 'comms__ficon comms__ficon--' + kind));
  const meta = node(doc, 'div', 'comms__fmeta');
  meta.append(node(doc, 'span', 'comms__fname', item.name || ''), node(doc, 'span', 'comms__fsize', fmtBytes(item.size)));
  const saved = node(doc, 'span', 'comms__fsaved', F.saved_here || '');
  saved.hidden = true;
  meta.append(saved);
  card.append(meta, ring(doc));
  const acts = node(doc, 'div', 'comms__facts');
  acts.hidden = true;
  if (kind === 'pdf') {
    const open = node(doc, 'button', 'm-btn m-btn--ghost comms__fact', F.open_pdf || '');
    open.type = 'button';
    open.dataset.act = 'open-pdf';
    acts.append(open);
  }
  if (/\.mentria\.json$/i.test(item.name || '')) {
    const imp = node(doc, 'button', 'm-btn m-btn--ghost comms__fact', F.import || '');
    imp.type = 'button';
    imp.dataset.act = 'import-pack';
    acts.append(imp);
  }
  const save = node(doc, 'a', 'm-btn m-btn--ghost comms__fact', F.save || '');
  save.href = mediaUrl(item.ref) + '?dl=1';
  save.setAttribute('download', item.name || '');
  acts.append(save);
  card.append(acts);
  return card;
};

const setRing = (svg, have, total, done) => {
  if (!svg) return;
  const fillEl = svg.querySelector('.comms__pring-fill');
  const pct = total > 0 ? Math.max(0, Math.min(1, have / total)) : 0;
  if (fillEl) fillEl.setAttribute('stroke-dasharray', (pct * RING_C).toFixed(2) + ' ' + RING_C.toFixed(2));
  svg.hidden = !!done;
};

const statusLine = (root) => {
  const st = root.__parts;
  if (!st) return;
  const T = st.T || {};
  const F = T.files || {};
  const items = st.items;
  const states = items.map((it) => st.media.get(it.ref) || {});
  const done = states.filter((m) => m.state === 'done').length;
  const moving = states.filter((m) => m.state === 'moving' || m.state === 'queued');
  const paused = states.find((m) => m.state === 'paused');
  const status = root.querySelector('.comms__parts-status');
  const bar = root.querySelector('.comms__parts-paused');
  if (bar) {
    bar.hidden = !paused;
    if (paused) {
      const bytes = states.reduce((a, m) => a + (Number(m.bytes) || 0), 0);
      bar.textContent = paused.note === 'space' ? (F.no_space || '') : fill(F.paused, { size: fmtBytes(bytes) });
    }
  }
  if (!status) return;
  if (done === items.length || (!moving.length && !paused)) { status.hidden = true; return; }
  const rate = states.reduce((a, m) => a + (Number(m.rate) || 0), 0);
  const via = states.some((m) => m.via === 'relay') ? F.via_relay : F.direct;
  const tpl = st.me ? F.status_send : F.status_recv;
  let text = fill(tpl, { i: Math.min(items.length, done + 1), n: items.length, rate: rate > 0 ? fmtBytes(rate) + '/s' : '…', path: via || '' });
  if (!(rate > 0)) text = text.replace(/\s·\s…\s·\s.*$/, '').replace(/\s·\s…$/, '');
  status.textContent = text;
  status.hidden = false;
};

const applyItem = (root, ref, m) => {
  const st = root.__parts;
  if (!st) return;
  st.media.set(ref, m || {});
  const done = !!m && m.state === 'done';
  const here = done || !!(m && m.local);
  const quiet = here || !m || m.state === 'offered' || m.state === 'unknown' || m.state === 'removed';
  const total = m && m.total ? m.total : 1;
  const have = m && m.have ? m.have : 0;
  for (const tile of root.querySelectorAll('.comms__tile[data-ref="' + ref + '"]')) {
    setRing(tile.querySelector('.comms__pring'), have, total, quiet);
    const img = tile.querySelector('img');
    if (here && img && tile.dataset.kind === 'image') {
      img.src = mediaUrl(ref);
      img.classList.remove('is-blurred');
    } else if (here && img) {
      img.classList.remove('is-blurred');
    }
    tile.classList.toggle('is-done', here);
  }
  for (const card of root.querySelectorAll('.comms__filecard[data-ref="' + ref + '"]')) {
    setRing(card.querySelector('.comms__pring'), have, total, quiet);
    const saved = card.querySelector('.comms__fsaved');
    if (saved) saved.hidden = !here;
    const acts = card.querySelector('.comms__facts');
    if (acts) acts.hidden = !here;
    card.classList.toggle('is-done', here);
  }
  const failed = root.querySelector('.comms__parts-retry');
  if (failed) failed.hidden = !st.items.some((it) => retryable(st.media.get(it.ref)));
  bars(root);
  statusLine(root);
};

const retryable = (m) => !!m && (m.state === 'failed' || (m.state === 'paused' && m.note === 'space'));

const offeredOf = (st) => st.items.filter((it) => { const m = st.media.get(it.ref) || {}; return m.state === 'offered' || m.state === 'removed'; });
const relayOf = (st) => st.items.filter((it) => (st.media.get(it.ref) || {}).note === 'relay');

const bars = (root) => {
  const st = root.__parts;
  const F = (st.T && st.T.files) || {};
  const accept = root.querySelector('.comms__acceptbar:not(.comms__relaybar)');
  if (accept) {
    const offered = offeredOf(st);
    accept.hidden = !offered.length || !!st.dismissed;
    if (offered.length) {
      const again = offered.every((it) => (st.media.get(it.ref) || {}).state === 'removed');
      accept.querySelector('.comms__acceptbar-text').textContent = again ? (F.removed || '') : fill(F.accept_q, { size: fmtBytes(offered.reduce((a, it) => a + (Number(it.size) || 0), 0)) });
      accept.querySelector('[data-act="accept"]').textContent = again ? (F.download_again || F.accept || '') : (F.accept || '');
    }
  }
  const relay = root.querySelector('.comms__relaybar');
  if (relay) relay.hidden = !relayOf(st).length || !!st.relayDismissed;
};

const barOf = (doc, cls, text, go, goAct, noAct, noText) => {
  const bar = node(doc, 'div', cls);
  bar.hidden = true;
  const t = node(doc, 'span', 'comms__acceptbar-text', text);
  const a = node(doc, 'button', 'm-btn m-btn--primary', go);
  a.type = 'button';
  a.dataset.act = goAct;
  const b = node(doc, 'button', 'm-btn m-btn--ghost', noText);
  b.type = 'button';
  b.dataset.act = noAct;
  bar.append(t, a, b);
  return bar;
};

export const renderParts = (el, parts, opts = {}) => {
  const doc = el.ownerDocument;
  const list = Array.isArray(parts) ? parts : [];
  const known = list.filter((p) => p && p.type !== 'unknown');
  if (!known.length || list.some((p) => p && p.type === 'unknown')) {
    const body = node(doc, 'div', 'comms__parts-text');
    renderBody(body, opts.t || '', { from: opts.me ? 'self' : 'person', T: opts.T });
    el.replaceChildren(body);
    return el;
  }
  const root = node(doc, 'div', 'comms__parts');
  const items = [];
  const albums = known.filter((p) => p.type === 'album');
  const singles = known.filter((p) => p.type === 'image' || p.type === 'video');
  const media = albums.flatMap((a) => a.items).concat(singles);
  if (media.length) {
    const total = Math.max(media.length, albums[0] ? albums[0].n : 0);
    const grid = node(doc, 'div', 'comms__album comms__album--' + albumLayout(total));
    if (albums[0]) grid.dataset.aid = albums[0].aid;
    media.forEach((it, i) => {
      items.push(it);
      if (i < 4) grid.append(tileOf(doc, it, i === 3 && total > 4 ? total - 4 : 0));
    });
    root.append(grid);
  }
  for (const f of known.filter((p) => p.type === 'file')) {
    items.push(f);
    root.append(fileCardOf(doc, f, opts.T));
  }
  const status = node(doc, 'p', 'comms__parts-status');
  status.hidden = true;
  const paused = node(doc, 'p', 'comms__parts-paused');
  paused.hidden = true;
  const retry = node(doc, 'button', 'm-btn m-btn--ghost comms__parts-retry', ((opts.T || {}).files || {}).retry || '');
  retry.type = 'button';
  retry.hidden = true;
  const F0 = (opts.T && opts.T.files) || {};
  root.append(status, paused, retry, barOf(doc, 'comms__acceptbar', '', F0.accept || '', 'accept', 'not-now', F0.not_now || ''), barOf(doc, 'comms__acceptbar comms__relaybar', F0.relay_ask || '', F0.relay_go || '', 'relay-go', 'relay-not', F0.not_now || ''));
  const captions = known.filter((p) => p.type === 'text').map((p) => p.text).join('\n').trim();
  if (captions) {
    const cap = node(doc, 'div', 'comms__caption');
    renderBody(cap, captions, { from: opts.me ? 'self' : 'person', T: opts.T });
    root.append(cap);
  }
  root.__parts = { items, media: new Map(), me: !!opts.me, T: opts.T, sender: opts.sender };
  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act], .comms__tile, .comms__parts-retry');
    if (!t || !root.contains(t)) return;
    if (t.classList.contains('comms__parts-retry')) {
      for (const it of items) if (retryable(root.__parts.media.get(it.ref)) && opts.onRetry) opts.onRetry(it.ref);
      return;
    }
    if (t.classList.contains('comms__tile')) {
      if (opts.onOpen) opts.onOpen(t.dataset.ref, items.filter((x) => x.type !== 'file'));
      return;
    }
    const st = root.__parts;
    if (t.dataset.act === 'accept') { if (opts.onAccept) opts.onAccept(offeredOf(st).map((x) => x.ref)); st.dismissed = true; bars(root); return; }
    if (t.dataset.act === 'not-now') { st.dismissed = true; bars(root); return; }
    if (t.dataset.act === 'relay-go') { if (opts.onRelayOk) opts.onRelayOk(relayOf(st).map((x) => x.ref)); st.relayDismissed = true; bars(root); return; }
    if (t.dataset.act === 'relay-not') { st.relayDismissed = true; bars(root); return; }
    const card = t.closest('.comms__filecard');
    if (!card) return;
    const it = items.find((x) => x.ref === card.dataset.ref);
    if (t.dataset.act === 'open-pdf' && opts.onOpenPdf) { e.preventDefault(); opts.onOpenPdf(card.dataset.ref, it); }
    if (t.dataset.act === 'import-pack' && opts.onImportPack) { e.preventDefault(); opts.onImportPack(card.dataset.ref, it); }
  });
  el.replaceChildren(root);
  for (const it of items) applyItem(root, it.ref, opts.media ? opts.media(it.ref) : null);
  return el;
};

export const addToAlbum = (el, album, sender) => {
  const root = el.querySelector('.comms__parts') || el;
  const st = root.__parts;
  const grid = root.querySelector('.comms__album');
  if (!st || !grid || !album || !Array.isArray(album.items)) return false;
  if ((st.sender || null) !== (sender || null)) return false;
  const doc = el.ownerDocument;
  for (const it of album.items) {
    if (st.items.some((x) => x.ref === it.ref)) continue;
    st.items.push(it);
    if (grid.querySelectorAll('.comms__tile').length < 4) grid.append(tileOf(doc, it, 0));
  }
  const shown = grid.querySelectorAll('.comms__tile');
  const total = Math.max(st.items.filter((x) => x.type !== 'file').length, album.n || 0);
  grid.className = 'comms__album comms__album--' + albumLayout(total);
  const more = grid.querySelector('.comms__album-more');
  if (more) more.remove();
  if (shown[3] && total > 4) shown[3].append(node(doc, 'span', 'comms__album-more', '+' + (total - 4)));
  return true;
};

export const updateParts = (el, ref, m) => {
  const root = el.querySelector('.comms__parts') || (el.classList && el.classList.contains('comms__parts') ? el : null);
  if (!root) return;
  applyItem(root, ref, m);
};

const mk = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const fillIn = (s, v) => String(s == null ? '' : s).replace(/\{(\w+)\}/g, (_, k) => (v[k] != null ? String(v[k]) : ''));

export const resultsOf = (parts) => {
  const map = new Map();
  for (const p of parts || []) if (p && p.type === 'tool_result' && typeof p.callId === 'string') map.set(p.callId, p);
  return map;
};

export const toolSummary = (call, res, A) => {
  if (!res) return call && call.status === 'running' ? (A.status_running || '') : '';
  if (call.kind === 'search' && Number.isInteger(res.matches)) return fillIn(A.matches, { n: res.matches });
  if (call.kind === 'read' && Array.isArray(res.lines)) return fillIn(A.lines, { a: res.lines[0], b: res.lines[1] });
  if (call.kind === 'run' && Number.isInteger(res.exit)) return fillIn(A.exit, { n: res.exit });
  return res.error ? (A.status_error || '') : '';
};

const fetchInto = (btn, target, ref, opts, show) => {
  btn.addEventListener('click', async () => {
    if (!opts.get) return;
    btn.disabled = true;
    try {
      const part = await opts.get(ref);
      if (part) { show(part); btn.remove(); } else btn.disabled = false;
    } catch (_) { btn.disabled = false; }
  });
  target.append(btn);
};

const cached = (opts, ref) => (ref && opts.cache && opts.cache.has(ref) ? opts.cache.get(ref) : null);

const resultBox = (res, opts, cls) => {
  const A = opts.T || {};
  const box = mk('div', cls);
  const have = cached(opts, res.ref);
  const pre = mk('pre', 'comms__tool-out', have ? (have.text || '') : (res.text || ''));
  box.append(pre);
  if (res.ref && !have) fetchInto(mk('button', 'comms__btn comms__btn--ghost comms__tool-more', A.show_all || 'Show all'), box, res.ref, opts, (p) => { pre.textContent = p.text || ''; });
  return box;
};

const imageSlot = (p, opts) => {
  const A = opts.T || {};
  const box = mk('div', 'comms__agent-imgbox');
  const kb = p.bytes ? ' · ' + Math.max(1, Math.round(p.bytes / 1024)) + ' KB' : '';
  const show = (part) => {
    if (!part.b64 || !/^image\/(png|jpeg|gif|webp)$/.test(String(part.mime || ''))) { box.append(mk('span', 'comms__agent-note', part.text || '')); return; }
    const img = mk('img', 'comms__agent-img');
    img.alt = '';
    img.src = 'data:' + part.mime + ';base64,' + part.b64;
    if (opts.onImage) img.addEventListener('click', () => opts.onImage(img.src));
    box.append(img);
  };
  const have = cached(opts, p.ref);
  if (have) show(have);
  else fetchInto(mk('button', 'comms__btn comms__btn--ghost', (A.show_image || 'Show image') + kb), box, p.ref, opts, show);
  return box;
};

const KIND_GLYPH = { run: '$', read: '▤', search: '⌕', edit: '✎', web: '↗', subagent: '◇', ask: '?', other: '•' };
export const TOOLISH = new Set(['tool_call', 'tool_result', 'diff']);

const toolCard = (c, res, diff, opts) => {
  const A = opts.T || {};
  const kind = String(c.kind || 'other').replace(/[^a-z]/g, '') || 'other';
  const card = mk('div', 'comms__tool comms__tool--' + kind);
  const head = mk('button', 'comms__tool-head');
  head.type = 'button';
  head.append(mk('span', 'comms__toolgroup-g', KIND_GLYPH[kind] || KIND_GLYPH.other), mk('span', 'comms__tool-title', String(c.title || A['kind_' + kind] || A.kind_other || '')));
  const sum = toolSummary(c, res, A);
  if (sum) head.append(mk('span', 'comms__tool-sum' + (c.status === 'error' ? ' comms__tool-sum--error' : ''), sum));
  if (diff) head.append(mk('span', 'comms__diff-add', '+' + (Number(diff.added) || 0)), mk('span', 'comms__diff-del', '−' + (Number(diff.removed) || 0)));
  card.append(head);
  const key = 'c:' + c.id;
  const body = () => {
    const b = mk('div', 'comms__tool-body');
    if (c.private) { b.append(mk('p', 'comms__agent-note', A.private_file || '')); return b; }
    const inBox = mk('code', 'comms__tool-in', '');
    const outBox = mk('pre', 'comms__tool-out', '');
    b.append(inBox);
    if (res && !res.private) b.append(outBox);
    else if (res && res.private) b.append(mk('p', 'comms__agent-note', A.private_file || ''));
    const fill = (box, ref) => {
      if (!ref) return;
      const have = cached(opts, ref);
      if (have) { box.textContent = have.text || ''; return; }
      if (opts.get) opts.get(ref).then((part) => { if (part) box.textContent = part.text || ''; }, () => {});
    };
    fill(inBox, c.ref);
    if (res && !res.private) fill(outBox, res.ref);
    return b;
  };
  if (opts.opened && opts.opened.has(key)) card.append(body());
  head.setAttribute('aria-expanded', String(!!(opts.opened && opts.opened.has(key))));
  head.addEventListener('click', () => {
    const open = card.querySelector('.comms__tool-body');
    if (open) { open.remove(); if (opts.opened) opts.opened.delete(key); head.setAttribute('aria-expanded', 'false'); return; }
    card.append(body());
    if (opts.opened) opts.opened.add(key);
    head.setAttribute('aria-expanded', 'true');
  });
  return card;
};

export const renderToolGroup = (parts, opts = {}) => {
  const A = opts.T || {};
  const calls = (parts || []).filter((p) => p && p.type === 'tool_call');
  const results = opts.results || resultsOf(parts);
  const diffs = new Map();
  for (const p of parts || []) if (p && p.type === 'diff' && p.ref) diffs.set(p.ref, p);
  const box = mk('div', 'comms__toolgroup');
  const sum = mk('button', 'comms__toolgroup-sum');
  sum.type = 'button';
  const counts = new Map();
  for (const c of calls) { const k = KIND_GLYPH[c.kind] ? c.kind : 'other'; counts.set(k, (counts.get(k) || 0) + 1); }
  const label = [];
  for (const [kind, n] of counts) {
    const k = mk('span', 'comms__toolgroup-k');
    k.dataset.kind = kind;
    k.append(mk('span', 'comms__toolgroup-g', KIND_GLYPH[kind]), mk('span', 'comms__toolgroup-n', String(n)));
    sum.append(k);
    label.push((A['kind_' + kind] || A.kind_other || kind) + ' ' + n);
  }
  let added = 0;
  let removed = 0;
  for (const d of diffs.values()) { added += Number(d.added) || 0; removed += Number(d.removed) || 0; }
  if (diffs.size) sum.append(mk('span', 'comms__diff-add', '+' + added), mk('span', 'comms__diff-del', '−' + removed));
  if (calls.some((c) => c.status === 'running')) { sum.classList.add('comms__toolgroup-sum--running'); sum.append(mk('span', 'comms__toolgroup-run', A.status_running || '')); }
  if (calls.some((c) => c.status === 'error')) sum.append(mk('span', 'comms__tool-sum comms__tool-sum--error', A.status_error || '!'));
  sum.setAttribute('aria-label', label.join(', '));
  box.append(sum);
  const key = 'g:' + (calls[0] ? calls[0].id : '');
  const list = () => {
    const l = mk('div', 'comms__toolgroup-list');
    for (const c of calls) l.append(toolCard(c, results.get(c.id), c.ref ? diffs.get(c.ref) : null, opts));
    return l;
  };
  const isOpen = () => !!(opts.opened && opts.opened.has(key));
  if (isOpen()) box.append(list());
  sum.setAttribute('aria-expanded', String(isOpen()));
  sum.addEventListener('click', () => {
    const l = box.querySelector('.comms__toolgroup-list');
    if (l) { l.remove(); if (opts.opened) opts.opened.delete(key); sum.setAttribute('aria-expanded', 'false'); return; }
    box.append(list());
    if (opts.opened) opts.opened.add(key);
    sum.setAttribute('aria-expanded', 'true');
  });
  return box;
};

export const renderAgentParts = (el, parts, opts = {}) => {
  const A = opts.T || {};
  const results = opts.results || new Map();
  const calls = new Set((parts || []).filter((p) => p && p.type === 'tool_call').map((p) => p.id));
  el.textContent = '';
  for (const p of parts || []) {
    if (!p || typeof p !== 'object') continue;
    if (p.type === 'text') {
      const d = mk('div', 'comms__agent-text');
      renderBody(d, String(p.text || ''), { from: 'model', T: opts.TB || {}, hold: true });
      el.append(d);
      if (p.ref) {
        const full = cached(opts, p.ref);
        if (full) { d.textContent = ''; renderBody(d, String(full.text || ''), { from: 'model', T: opts.TB || {}, hold: true }); }
        else fetchInto(mk('button', 'comms__btn comms__btn--ghost comms__tool-more', A.show_all || 'Show all'), el, p.ref, opts, (part) => { d.textContent = ''; renderBody(d, String(part.text || ''), { from: 'model', T: opts.TB || {}, hold: true }); });
      }
    } else if (p.type === 'thought') {
      const wrap = mk('div', 'comms__agent-thoughtbox');
      const b = mk('button', 'comms__thought', A.thought || 'Thought');
      b.type = 'button';
      b.addEventListener('click', async () => {
        if (wrap.querySelector('.comms__thought-text')) { wrap.querySelector('.comms__thought-text').remove(); if (opts.opened) opts.opened.delete(p.ref); return; }
        if (!opts.get) return;
        const part = await opts.get(p.ref).catch(() => null);
        if (part && part.text != null && !wrap.querySelector('.comms__thought-text')) { wrap.append(mk('pre', 'comms__thought-text', part.text)); if (opts.opened) opts.opened.add(p.ref); }
      });
      wrap.append(b);
      const open = opts.opened && opts.opened.has(p.ref) ? cached(opts, p.ref) : null;
      if (open && open.text != null) wrap.append(mk('pre', 'comms__thought-text', open.text));
      el.append(wrap);
    } else if (p.type === 'tool_call') {
      const card = mk('div', 'comms__tool comms__tool--' + String(p.kind || 'other').replace(/[^a-z]/g, ''));
      const head = mk('div', 'comms__tool-head');
      head.append(mk('span', 'comms__tool-kind', A['kind_' + p.kind] || A.kind_other || 'Tool'), mk('span', 'comms__tool-title', String(p.title || '')));
      const res = results.get(p.id);
      const sum = toolSummary(p, res, A);
      if (sum) head.append(mk('span', 'comms__tool-sum' + (p.status === 'error' ? ' comms__tool-sum--error' : ''), sum));
      card.append(head);
      if (p.input && p.input !== p.title) card.append(mk('code', 'comms__tool-in', String(p.input)));
      if (res && res.text) card.append(resultBox(res, opts, 'comms__tool-result'));
      el.append(card);
    } else if (p.type === 'tool_result') {
      if (calls.has(p.callId) || (opts.calls && opts.calls.has(p.callId))) continue;
      el.append(resultBox(p, opts, 'comms__tool-result comms__tool-result--alone'));
    } else if (p.type === 'diff') {
      const d = mk('div', 'comms__agent-diff');
      d.append(mk('span', 'comms__diff-add', '+' + (Number(p.added) || 0)), mk('span', 'comms__diff-del', '−' + (Number(p.removed) || 0)), mk('span', 'comms__diff-path', String(p.path || '')));
      const have = cached(opts, p.ref);
      if (have) d.append(mk('pre', 'comms__tool-out', have.text || ''));
      else if (p.ref) fetchInto(mk('button', 'comms__btn comms__btn--ghost', A.show_changes || 'Show changes'), d, p.ref, opts, (part) => { d.append(mk('pre', 'comms__tool-out', part.text || '')); });
      el.append(d);
    } else if (p.type === 'subagent') {
      const s = mk('div', 'comms__tool comms__tool--subagent');
      const head = mk('div', 'comms__tool-head');
      head.append(mk('span', 'comms__tool-kind', A.kind_subagent || 'Subagent'), mk('span', 'comms__tool-title', String(p.title || '')));
      s.append(head);
      if (opts.openSub && /^[a-z0-9]{6,40}$/.test(String(p.agentId || ''))) {
        const b = mk('button', 'comms__btn comms__btn--ghost', A.open_sub || 'Open');
        b.type = 'button';
        b.addEventListener('click', () => opts.openSub(p.agentId, p.title));
        s.append(b);
      }
      el.append(s);
    } else if (p.type === 'status' && p.kind === 'pr') {
      const label = 'PR #' + (Number(p.n) || 0);
      if (allowedHref(p.url)) {
        const a = mk('a', 'comms__agent-chip', label);
        a.href = p.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        el.append(a);
      } else el.append(mk('span', 'comms__agent-chip', label));
    } else if (p.type === 'notice') {
      el.append(mk('p', 'comms__agent-note', A['notice_' + p.code] || A.notice_unknown || ''));
    } else if (p.type === 'image') {
      el.append(imageSlot(p, opts));
    } else {
      el.append(mk('p', 'comms__agent-note', A.notice_unknown || ''));
    }
  }
};
