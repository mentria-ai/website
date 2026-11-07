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
  if (opts.from === 'person') holdImages(root, opts.T);
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
  svg.setAttribute('class', 'comms__ring');
  svg.setAttribute('viewBox', '0 0 36 36');
  svg.setAttribute('aria-hidden', 'true');
  const back = doc.createElementNS(SVG_NS, 'circle');
  back.setAttribute('class', 'comms__ring-back');
  const front = doc.createElementNS(SVG_NS, 'circle');
  front.setAttribute('class', 'comms__ring-fill');
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
  const fillEl = svg.querySelector('.comms__ring-fill');
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
  const total = m && m.total ? m.total : 1;
  const have = m && m.have ? m.have : 0;
  for (const tile of root.querySelectorAll('.comms__tile[data-ref="' + ref + '"]')) {
    setRing(tile.querySelector('.comms__ring'), have, total, done || (m && m.state === 'offered'));
    const img = tile.querySelector('img');
    if (done && img && tile.dataset.kind === 'image') {
      img.src = mediaUrl(ref);
      img.classList.remove('is-blurred');
    } else if (done && img) {
      img.classList.remove('is-blurred');
    }
    tile.classList.toggle('is-done', done);
  }
  for (const card of root.querySelectorAll('.comms__filecard[data-ref="' + ref + '"]')) {
    setRing(card.querySelector('.comms__ring'), have, total, done || (m && m.state === 'offered'));
    const saved = card.querySelector('.comms__fsaved');
    if (saved) saved.hidden = !done;
    const acts = card.querySelector('.comms__facts');
    if (acts) acts.hidden = !done;
    card.classList.toggle('is-done', done);
  }
  const failed = root.querySelector('.comms__parts-retry');
  if (failed) failed.hidden = !st.items.some((it) => (st.media.get(it.ref) || {}).state === 'failed');
  statusLine(root);
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
  root.append(status, paused, retry);
  const captions = known.filter((p) => p.type === 'text').map((p) => p.text).join('\n').trim();
  if (captions) {
    const cap = node(doc, 'div', 'comms__caption');
    renderBody(cap, captions, { from: opts.me ? 'self' : 'person', T: opts.T });
    root.append(cap);
  }
  root.__parts = { items, media: new Map(), me: !!opts.me, T: opts.T };
  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act], .comms__tile, .comms__parts-retry');
    if (!t || !root.contains(t)) return;
    if (t.classList.contains('comms__parts-retry')) {
      for (const it of items) if ((root.__parts.media.get(it.ref) || {}).state === 'failed' && opts.onRetry) opts.onRetry(it.ref);
      return;
    }
    if (t.classList.contains('comms__tile')) {
      if (opts.onOpen) opts.onOpen(t.dataset.ref, items.filter((x) => x.type !== 'file'));
      return;
    }
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

export const addToAlbum = (el, album) => {
  const root = el.querySelector('.comms__parts') || el;
  const st = root.__parts;
  const grid = root.querySelector('.comms__album');
  if (!st || !grid || !album || !Array.isArray(album.items)) return false;
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
