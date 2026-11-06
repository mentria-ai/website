const TITLE_MAX = 60;
const META_KEYS = ['model', 'repeatCut', 'img'];

export const newThreadId = (prefix) => `${prefix}-${crypto.randomUUID()}`;

export const titleFrom = (text, fallback) => {
  const line = String(text == null ? '' : text).trim().split('\n')[0].trim();
  if (!line) return fallback;
  return line.length > TITLE_MAX ? line.slice(0, TITLE_MAX - 1).trimEnd() + '…' : line;
};

export const turnToMessage = (turn, threadId, index, ts) => {
  const text = String(turn.text == null ? '' : turn.text);
  const parts = [{ type: 'text', text }];
  if (turn.thumb) parts.push({ type: 'image', thumb: turn.thumb });
  const meta = {};
  for (const k of META_KEYS) if (turn[k] !== undefined) meta[k] = turn[k];
  return { id: `${threadId}:${index}`, threadId, from: turn.role === 'user' ? 'self' : 'model', ts, t: text, parts, meta, v: 2 };
};

export const messagesToTurns = (msgs) => msgs.map((m) => {
  const turn = { role: m.from === 'self' ? 'user' : 'assistant', text: String(m.t == null ? '' : m.t) };
  const meta = m.meta || {};
  const image = (m.parts || []).find((p) => p && p.type === 'image' && p.thumb);
  if (meta.img !== undefined) turn.img = meta.img;
  if (image) turn.thumb = image.thumb;
  if (meta.model !== undefined) turn.model = meta.model;
  if (meta.repeatCut !== undefined) turn.repeatCut = meta.repeatCut;
  return turn;
});

export const legacyThreadId = async (json) => {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(json))));
  return 'ai-legacy-' + Array.from(digest.slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
};
