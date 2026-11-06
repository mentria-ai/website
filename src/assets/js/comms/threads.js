const lower = (s) => String(s == null ? '' : s).toLowerCase();

const plain = (text) => String(text == null ? '' : text)
  .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/^[ \t]{0,3}(?:#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+|\d+[.)][ \t]+)/gm, '')
  .replace(/(\*\*|__)(.+?)\1/g, '$2')
  .replace(/(^|[^\w*])\*(?=\S)([^*]+?)\*(?=[^\w*]|$)/g, '$1$2')
  .replace(/(^|[^\w])_(?=\S)([^_]+?)_(?=[^\w]|$)/g, '$1$2')
  .replace(/~~(.+?)~~/g, '$1')
  .replace(/`+([^`]*)`+/g, '$1')
  .replace(/\s+/g, ' ')
  .trim();

export const homeRows = (src, view = {}) => {
  const filter = view.filter || 'all';
  const query = lower(view.query).trim();
  const threads = src.threads || [];
  const unread = src.unread || {};
  const count = (k) => (unread[k] && unread[k].n) || 0;
  const byId = new Map();
  const dmByFp = new Map();
  for (const t of threads) {
    byId.set(t.id, t);
    const fp = t.kind === 'dm' && t.meta && t.meta.fp;
    if (fp && (!dmByFp.has(fp) || (t.updatedAt || 0) > (dmByFp.get(fp).updatedAt || 0))) dmByFp.set(fp, t);
  }
  const requests = (src.requests || []).map((r) => ({ kind: 'request', key: 'req:' + r.fp, title: r.name || '', preview: '', ts: 0, unread: 0, ref: r }));
  const rest = [];
  for (const c of src.contacts || []) {
    const t = dmByFp.get(c.fp);
    rest.push({ kind: 'contact', key: c.fp, title: c.name || '', preview: t ? plain(t.preview) : '', ts: t ? t.updatedAt || 0 : 0, unread: count(c.fp), ref: c });
  }
  for (const r of src.rooms || []) {
    const t = byId.get(r.room);
    rest.push({ kind: 'room', key: 'room:' + r.room, title: r.label || r.room, preview: t ? plain(t.preview) : '', ts: t ? t.updatedAt || 0 : 0, unread: count('room:' + r.room), ref: r });
  }
  for (const t of threads) {
    if (t.kind === 'model') rest.push({ kind: 'ai', key: t.id, title: t.title || '', preview: plain(t.preview), ts: t.updatedAt || 0, unread: 0, ref: t });
  }
  rest.sort((a, b) => b.ts - a.ts);
  const shown = (r) => (filter === 'people' ? r.kind !== 'ai' : filter === 'ai' ? r.kind === 'ai' : true);
  const matches = (r) => !query || lower(r.title).includes(query) || lower(r.preview).includes(query);
  return requests.concat(rest).filter((r) => shown(r) && matches(r));
};

export const aiHref = (thread, prefix = '') => {
  const tool = thread && thread.meta && thread.meta.tool === 'annotate-image' ? 'annotate-image' : 'ai-chat';
  return `${prefix}/tools/${tool}/?thread=${encodeURIComponent((thread && thread.id) || '')}`;
};
