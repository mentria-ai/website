export const HANDOFF_KEY = 'mentria.handoff.ai';

const space = (ch) => ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';

export const mentionQuery = (text, caret) => {
  const s = String(text == null ? '' : text);
  const end = Math.max(0, Math.min(caret == null ? s.length : caret, s.length));
  for (let i = end - 1; i >= 0; i--) {
    if (s[i] === '@') return i === 0 || space(s[i - 1]) ? s.slice(i + 1, end) : null;
    if (space(s[i])) return null;
  }
  return null;
};

export const matchTargets = (query, targets, limit = 8) => {
  const q = String(query == null ? '' : query).toLowerCase();
  const first = [];
  const later = [];
  for (const t of targets || []) {
    const label = String(t.label || '').toLowerCase();
    if (!q || label.startsWith(q)) first.push(t);
    else if (label.includes(q)) later.push(t);
  }
  return first.concat(later).slice(0, limit);
};

export const splitTarget = (text, chosen) => {
  const s = String(text == null ? '' : text);
  if (!chosen) return { target: null, body: s.trim() };
  const token = '@' + chosen.label;
  const at = s.toLowerCase().indexOf(token.toLowerCase());
  const after = at < 0 ? '' : s.slice(at + token.length);
  if (at < 0 || (at > 0 && !space(s[at - 1])) || (after && !space(after[0]))) return { target: null, body: s.trim() };
  return { target: chosen, body: (s.slice(0, at) + after.slice(1)).trim() };
};

export const insertTag = (text, caret, handle) => {
  const s = String(text == null ? '' : text);
  const end = Math.max(0, Math.min(caret == null ? s.length : caret, s.length));
  const q = mentionQuery(s, end);
  if (q == null) return { text: s, caret: end };
  const at = end - q.length - 1;
  const head = s.slice(0, at) + '@' + handle + ' ';
  return { text: head + s.slice(end).replace(/^ /, ''), caret: head.length };
};
