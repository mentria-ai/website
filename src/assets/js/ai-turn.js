import * as Tiers from '/assets/js/mentria-tiers.js';

export const MAX_TOKENS = 512;

export function modelFamilyFor(tier) {
  if (tier === '27b') return 'Bonsai 27B';
  return Tiers && Tiers.TIERS[tier] && Tiers.TIERS[tier].family === 'b2' ? 'Bonsai 2' : 'Qwen3.5';
}

export function isSmallTier(tier) {
  return tier === '0.8b' || (!!Tiers && tier === Tiers.SMALL_TIER);
}

export function isB2Tier(tier) {
  return !!Tiers && !!Tiers.TIERS[tier] && Tiers.TIERS[tier].family === 'b2';
}

export function labelPrefix(tier) {
  if (tier === '27b') return 'bonsai-';
  return Tiers && Tiers.TIERS[tier] && Tiers.TIERS[tier].family === 'b2' ? 'bonsai2-' : 'qwen-';
}

const SITE_ASK = /mentria|this (site|website|app|page)\b|who are you\b|what are you\b|which model|what model|your name|qui[eé]n eres|qu[eé] modelo|qui es-tu|quel mod[eè]le|quem [eé] voc[eê]|qual modelo|あなたは誰|誰ですか|どのモデル|何のモデル/i;

export function asksAboutSite(texts) {
  return texts.some((t) => SITE_ASK.test(String(t || '')));
}

function b2SystemPrompt(tier, turn) {
  const small = isSmallTier(tier);
  const site = "When the user asks who you are or what model you run: identify as the Mentria AI assistant, running Bonsai 2 in their browser. When asked about Mentria itself: it is a small privacy-first studio at mentria.ai, building tools, games, and AI experiences that run in the browser, with no account needed. Notable parts of the site: an AI chat, a QR scanner, a document scanner, quick notes, Tetris, Breakout, Minesweeper, an infinite AI-generated radio, private peer-to-peer chat and calls at /comms/, and card decks for learning about AI.";
  const base = "You are the Mentria AI assistant. You run Bonsai 2 locally in the user's browser via WebGPU." + (small ? " Your weights were prepared for the browser and shipped by mentria.ai.\n\n" + site : '') + "\n\n" +
    "Be helpful, accurate, and brief. Don't over-apologize." +
    (small ? '' : " You cannot browse the web, run code, call APIs, or remember between sessions; if something is outside your training, say so plainly.") + "\n\n" +
    "Formatting: use markdown sparingly. For tables, output strict GitHub-flavored markdown: one header row, one divider row made only of pipes and dashes, then data rows. Never put prose, notes, parentheticals, or extra characters between the divider and the data rows. Each cell is one short phrase, never a sentence. Any explanation goes outside the table.";
  if (!turn) return base;
  const tail = [];
  if (turn.site && !small) tail.push(site + ' Your weights were prepared for the browser and shipped by mentria.ai.');
  if (turn.image) tail.push('When the user shares an image, describe what you see directly.');
  if (turn.lang === 'English') tail.push('Reply in English.');
  else if (turn.lang) tail.push('Reply in ' + turn.lang + '. Write every word in ' + turn.lang + '; do not mix in English words except proper nouns and code.');
  else tail.push("Reply in the language of the user's message.");
  return base + '\n\n' + tail.join('\n\n');
}

export function systemPromptFor(tier, turn) {
  if (isB2Tier(tier)) return b2SystemPrompt(tier, turn);
  const family = modelFamilyFor(tier);
  const small = isSmallTier(tier);
  const prompt = "You are the Mentria AI assistant. You run " + family + " locally in the user's browser via WebGPU. Your weights were prepared for the browser and shipped by mentria.ai.\n\n" +
    "When the user asks who you are or what model you run: identify as the Mentria AI assistant, running " + family + " in their browser. When asked about Mentria itself: it is a small privacy-first studio at mentria.ai, building tools, games, and AI experiences that run in the browser, with no account needed. Notable parts of the site: an AI chat, a QR scanner, a document scanner, quick notes, Tetris, Breakout, Minesweeper, an infinite AI-generated radio, private peer-to-peer chat and calls at /comms/, and card decks for learning about AI.\n\n" +
    "Be helpful, accurate, and brief. Don't over-apologize." +
    (!small || (turn && turn.image) ? " When the user shares an image, describe what you see directly." : '') +
    (small ? '' : " You cannot browse the web, run code, call APIs, or remember between sessions; if something is outside your training, say so plainly.") + "\n\n" +
    "Formatting: use markdown sparingly. For tables, output strict GitHub-flavored markdown: one header row, one divider row made only of pipes and dashes, then data rows. Never put prose, notes, parentheticals, or extra characters between the divider and the data rows. Each cell is one short phrase, never a sentence. Any explanation goes outside the table.";
  if (!small || !turn) return prompt;
  if (turn.lang === 'English') return prompt + '\n\nReply in English.';
  if (turn.lang) return 'Write your reply in ' + turn.lang + '.\n\n' + prompt;
  return prompt + "\n\nReply in the same language as the user's message.";
}

const REPLY_LANGS = [
  { name: 'English', marks: null, words: ['the', 'and', 'is', 'are', 'you', 'your', 'what', 'how', 'who', 'why', 'can', 'does', 'of', 'to', 'in', 'it', 'this', 'that', 'with', 'for', 'my', 'i', 'please', 'tell', 'give', 'write', 'explain', 'make', 'about', 'hi', 'hello', 'thanks'] },
  { name: 'Spanish', marks: /[ñ¿¡]/, words: ['el', 'los', 'las', 'del', 'qué', 'cómo', 'cuál', 'cuáles', 'cuánto', 'cuántos', 'cuántas', 'quién', 'dónde', 'eres', 'estás', 'hola', 'gracias', 'puedes', 'dame', 'dime', 'hago', 'una', 'muy', 'también'] },
  { name: 'French', marks: /[œèëîïûù]/, words: ['le', 'les', 'des', 'du', 'au', 'aux', 'et', 'est', 'qui', 'quel', 'quelle', 'faire', 'pourquoi', 'je', 'vous', 'une', 'avec', 'dans', 'bonjour', 'merci', 'peux', 'sais', 'fais', 'moi', 'cette', "c'est", "qu'est"] },
  { name: 'Brazilian Portuguese', marks: /[ãõ]/, words: ['você', 'não', 'olá', 'obrigado', 'obrigada', 'quem', 'qual', 'quanto', 'quantos', 'faço', 'é', 'um', 'uma', 'da', 'das', 'na', 'em', 'isso', 'muito', 'também'] }
];
const PAGE_REPLY_LANG = { es: 'Spanish', fr: 'French', ja: 'Japanese', 'pt-br': 'Brazilian Portuguese' };

export function replyLanguage(texts, pageLang) {
  const page = String(pageLang || 'en').toLowerCase();
  for (let i = texts.length - 1; i >= 0; i--) {
    const lang = detectLanguage(texts[i], page);
    if (lang) return lang;
  }
  return PAGE_REPLY_LANG[page] || null;
}

export function detectLanguage(text, page) {
  if (/[\u3040-\u30ff]/.test(text) || (page === 'ja' && /[\u4e00-\u9fff]/.test(text))) return 'Japanese';
  const words = text.toLowerCase().replace(/\u2019/g, "'").split(/[^\p{L}']+/u);
  let best = null;
  let top = 0;
  let tie = false;
  REPLY_LANGS.forEach((lang) => {
    const n = (lang.marks && lang.marks.test(text) ? 2 : 0) + words.filter((w) => lang.words.indexOf(w) >= 0).length;
    if (n > top) { best = lang.name; top = n; tie = false; }
    else if (n > 0 && n === top) tie = true;
  });
  return best && !tie ? best : null;
}

export function historyBudget(contextTokens, deepThink) {
  const big = contextTokens >= 4096;
  const huge = contextTokens >= 8192;
  const chars = deepThink
    ? (huge ? 7000 : big ? 5000 : 800)
    : (huge ? 14000 : big ? 9500 : contextTokens >= 2048 ? 3400 : 1200);
  const replyReserve = deepThink
    ? (huge ? 6000 : big ? 3400 : 512)
    : (big ? 768 : contextTokens >= 2048 ? MAX_TOKENS : 320);
  return { chars, tokens: Math.max(256, contextTokens - replyReserve - 160) };
}

export function trimRepeatTail(text) {
  const n = text.length;
  const maxLen = Math.min(1200, Math.floor(n / 4));
  for (let len = 16; len <= maxLen; len++) {
    let periodic = true;
    for (let j = 1; j <= 3 * len && periodic; j++) periodic = text.charCodeAt(n - j) === text.charCodeAt(n - j - len);
    if (!periodic) continue;
    const unit = text.slice(n - len);
    if (new Set(unit.replace(/\s+/g, '')).size < 5) continue;
    let p = n - len;
    while (p > 0 && text.charCodeAt(p - 1) === text.charCodeAt(p - 1 + len)) p--;
    const stop = Math.min(n, p + 2 * len);
    const lineEnd = unit.indexOf('\n') >= 0;
    let end = p + len;
    for (let e = p + len; e <= stop; e++) {
      const c = text[e - 1];
      if (lineEnd ? c === '\n' : (/[.!?]/.test(c) && (e === n || /\s/.test(text[e])))) { end = e; break; }
    }
    return text.slice(0, end);
  }
  return null;
}

export function tierLabel(tier) {
  const t = Tiers.TIERS[tier];
  return t ? labelPrefix(tier) + t.name : String(tier);
}
