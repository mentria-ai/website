import assert from 'node:assert/strict';
import { register } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const tmp = mkdtempSync(join(tmpdir(), 'ai-turn-check-'));
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));
const hooksPath = join(tmp, 'hooks.mjs');
writeFileSync(hooksPath, [
  "let root = '';",
  'export async function initialize(data) { root = data.root; }',
  'export async function resolve(specifier, context, next) {',
  "  if (specifier.startsWith('/assets/')) return { url: root + specifier, format: 'module', shortCircuit: true };",
  '  return next(specifier, context);',
  '}'
].join('\n'));
register(pathToFileURL(hooksPath).href, import.meta.url, { data: { root: pathToFileURL(join(repo, 'src')).href } });
class MemoryStorage { constructor() { this.map = new Map(); } getItem(k) { return this.map.has(k) ? this.map.get(k) : null; } setItem(k, v) { this.map.set(k, String(v)); } removeItem(k) { this.map.delete(k); } }
Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true, writable: true });

const Tiers = await import('/assets/js/mentria-tiers.js');

const makeOracle = (Tiers, page, contextTokens) => {
  const document = { documentElement: { lang: page } };
  const MAX_TOKENS = 512;
  function modelFamilyFor(tier) {
    if (tier === '27b') return 'Bonsai 27B';
    return Tiers && Tiers.TIERS[tier] && Tiers.TIERS[tier].family === 'b2' ? 'Bonsai 2' : 'Qwen3.5';
  }

  function isSmallTier(tier) {
    return tier === '0.8b' || (!!Tiers && tier === Tiers.SMALL_TIER);
  }

  function isB2Tier(tier) {
    return !!Tiers && !!Tiers.TIERS[tier] && Tiers.TIERS[tier].family === 'b2';
  }

  function labelPrefix(tier) {
    if (tier === '27b') return 'bonsai-';
    return Tiers && Tiers.TIERS[tier] && Tiers.TIERS[tier].family === 'b2' ? 'bonsai2-' : 'qwen-';
  }

  const SITE_ASK = /mentria|this (site|website|app|page)\b|who are you\b|what are you\b|which model|what model|your name|qui[eé]n eres|qu[eé] modelo|qui es-tu|quel mod[eè]le|quem [eé] voc[eê]|qual modelo|あなたは誰|誰ですか|どのモデル|何のモデル/i;

  function asksAboutSite(texts) {
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

  function systemPromptFor(tier, turn) {
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

  function replyLanguage(texts) {
    const page = String(document.documentElement.lang || 'en').toLowerCase();
    for (let i = texts.length - 1; i >= 0; i--) {
      const lang = detectLanguage(texts[i], page);
      if (lang) return lang;
    }
    return PAGE_REPLY_LANG[page] || null;
  }

  function detectLanguage(text, page) {
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

  function historyBudget(deepThink) {
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

  function trimRepeatTail(text) {
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
  return { modelFamilyFor, isSmallTier, isB2Tier, labelPrefix, asksAboutSite, systemPromptFor, detectLanguage, replyLanguage, historyBudget, trimRepeatTail };
};

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

check('turn: system prompts match AI Chat for every tier', async () => {
  const T = await import('/assets/js/ai-turn.js');
  const O = makeOracle(Tiers, 'en', 2048);
  const turns = [undefined, {}, { image: true }, { lang: 'English' }, { lang: 'Japanese' }, { lang: null }, { site: true }, { site: true, image: true, lang: 'French' }];
  for (const id of Object.keys(Tiers.TIERS).concat([null])) {
    for (const turn of turns) assert.equal(T.systemPromptFor(id, turn), O.systemPromptFor(id, turn), id + ' ' + JSON.stringify(turn));
    assert.equal(T.modelFamilyFor(id), O.modelFamilyFor(id));
    assert.equal(T.isSmallTier(id), O.isSmallTier(id));
    assert.equal(T.isB2Tier(id), O.isB2Tier(id));
    assert.equal(T.labelPrefix(id), O.labelPrefix(id));
  }
  for (const texts of [['who are you?'], ['what is 2+2'], ['¿qué modelo eres?']]) assert.equal(T.asksAboutSite(texts), O.asksAboutSite(texts));
});

check('turn: reply language matches AI Chat', async () => {
  const T = await import('/assets/js/ai-turn.js');
  const texts = [['hola, ¿cómo estás?'], ['bonjour merci'], ['こんにちは'], ['ok'], ['the cat and the dog'], []];
  for (const page of ['en', 'ja', 'fr', 'pt-br']) {
    const O = makeOracle(Tiers, page, 2048);
    for (const t of texts) {
      assert.equal(T.replyLanguage(t, page), O.replyLanguage(t), page + ' ' + JSON.stringify(t));
      if (t.length) assert.equal(T.detectLanguage(t[0], page), O.detectLanguage(t[0], page));
    }
  }
});

check('turn: history budget matches AI Chat', async () => {
  const T = await import('/assets/js/ai-turn.js');
  for (const ctx of [1024, 2048, 4096, 8192, 16384]) {
    const O = makeOracle(Tiers, 'en', ctx);
    for (const deep of [false, true]) assert.deepEqual(T.historyBudget(ctx, deep), O.historyBudget(deep), ctx + ' ' + deep);
  }
  assert.equal(T.MAX_TOKENS, 512);
});

check('turn: repeat cut matches AI Chat', async () => {
  const T = await import('/assets/js/ai-turn.js');
  const O = makeOracle(Tiers, 'en', 2048);
  let plain = '';
  for (let i = 0; plain.length < 3000; i++) plain += 'Sentence number ' + i + ' tells a different part of the story. ';
  assert.equal(T.trimRepeatTail(plain), null);
  assert.equal(O.trimRepeatTail(plain), null);
  const loop = 'The keeper climbed the stairs again. '.repeat(60);
  assert.equal(T.trimRepeatTail(loop), O.trimRepeatTail(loop));
  assert.ok(T.trimRepeatTail(loop) !== null);
  const abc = 'abc. '.repeat(400);
  assert.equal(T.trimRepeatTail(abc), O.trimRepeatTail(abc));
  const ja = '灯台守は毎晩階段を上り、海を見つめて静かに祈った。'.repeat(40);
  assert.equal(T.trimRepeatTail(ja), O.trimRepeatTail(ja));
});

check('turn: tierLabel', async () => {
  const T = await import('/assets/js/ai-turn.js');
  assert.equal(T.tierLabel('27b'), 'bonsai-27B');
  assert.equal(T.tierLabel('b2-4b'), 'bonsai2-4B');
  assert.equal(T.tierLabel('nope'), 'nope');
});

let failed = 0;
for (const [name, fn] of checks) {
  try { await fn(); console.log('PASS ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + String(e && e.stack || e).split('\n').slice(0, 3).join('\n     ')); }
}
console.log('ai-turn: ' + (checks.length - failed) + '/' + checks.length + ' passed');
process.exit(failed ? 1 : 0);
