const TRAIL = '.,;:!?\'"';
const CLOSERS = { ')': '(', ']': '[', '}': '{' };
const LINK_RE = /(?<![\w@./-])(?:https?:\/\/|www\.)[^\s<>"`]+/gi;
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
    let url = m[0];
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
    out.push({ start: m.index, end: m.index + url.length, href: bare ? 'https://' + url : url });
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
