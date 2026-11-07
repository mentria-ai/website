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

const fakeEngine = (tokens) => {
  const e = { calls: [], aborted: false, encodes: 0 };
  e.encodeChat = async (msgs) => { e.encodes++; const n = msgs.reduce((a, m) => a + String(m.content).length, 0); return { ids: new Array(Math.ceil(n / 4)) }; };
  e.generate = async (params, cb) => {
    e.calls.push(params);
    for (const t of tokens) {
      if (params.signal && params.signal.aborted) { e.aborted = true; const err = new Error('aborted'); err.name = 'AbortError'; throw err; }
      cb({ token: t, tokenId: 1 });
      await null;
    }
    if (params.signal && params.signal.aborted) e.aborted = true;
    cb({ finished: true, committedTokens: 0 });
  };
  return e;
};
const turnsOf = (n, len) => Array.from({ length: n }, (_, i) => ({ role: (n - 1 - i) % 2 === 0 ? 'user' : 'assistant', content: String.fromCharCode(97 + (i % 26)).repeat(len) }));
const sentChars = (msgs) => msgs.reduce((a, m) => a + String(m.content).length, 0);

check('answer: keeps only the newest turns that fit the token budget', async () => {
  const A = await import('/assets/js/ai-answer.js');
  const T = await import('/assets/js/ai-turn.js');
  const e = fakeEngine(['ok']);
  const turns = turnsOf(30, 400);
  await A.answerTurns({ engine: e, tier: 'b2-2b', contextTokens: 2048, messages: turns, pageLang: 'en' }, () => {});
  const sent = e.calls[0].messages;
  assert.equal(sent[0].role, 'system');
  assert.ok(Math.ceil(sentChars(sent) / 4) <= T.historyBudget(2048, false).tokens);
  assert.equal(T.historyBudget(2048, false).tokens, 1376);
  assert.deepEqual(sent[sent.length - 1], turns[turns.length - 1]);
  assert.ok(sent.length > 2 && sent.length < turns.length + 1);
  assert.deepEqual(sent.slice(1), turns.slice(turns.length - (sent.length - 1)));
});

check('answer: always keeps the last user turn even when it alone is over budget', async () => {
  const A = await import('/assets/js/ai-answer.js');
  const e = fakeEngine(['ok']);
  const turns = [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }, { role: 'user', content: 'x'.repeat(20000) }];
  await A.answerTurns({ engine: e, tier: 'b2-2b', contextTokens: 2048, messages: turns, pageLang: 'en' }, () => {});
  const sent = e.calls[0].messages;
  assert.equal(sent.length, 2);
  assert.equal(sent[1].content.length, 20000);
});

check("answer: system prompt follows AI Chat's rule for the tier", async () => {
  const A = await import('/assets/js/ai-answer.js');
  const T = await import('/assets/js/ai-turn.js');
  const turns = [{ role: 'user', content: 'who are you?' }, { role: 'assistant', content: 'A helper.' }, { role: 'user', content: 'cuéntame algo, ¿qué modelo eres?' }];
  const asks = ['who are you?', 'cuéntame algo, ¿qué modelo eres?'];
  for (const tier of ['b2-2b', 'b2-4b', 'b2-9b']) {
    const e = fakeEngine(['ok']);
    await A.answerTurns({ engine: e, tier, contextTokens: 4096, messages: turns, pageLang: 'fr' }, () => {});
    assert.equal(e.calls[0].messages[0].content, T.systemPromptFor(tier, { image: false, lang: T.replyLanguage(asks, 'fr'), site: T.isB2Tier(tier) && T.asksAboutSite(asks) }));
  }
  const e27 = fakeEngine(['ok']);
  await A.answerTurns({ engine: e27, tier: '27b', contextTokens: 16384, messages: turns, pageLang: 'en' }, () => {});
  assert.equal(e27.calls[0].messages[0].content, T.systemPromptFor('27b'));
});

check("answer: params are AI Chat's plain-chat defaults", async () => {
  const A = await import('/assets/js/ai-answer.js');
  for (const [ctx, max] of [[16384, 768], [4096, 768], [2048, 512], [1024, 320]]) {
    const e = fakeEngine(['ok']);
    const caller = new AbortController();
    await A.answerTurns({ engine: e, tier: 'b2-4b', contextTokens: ctx, messages: [{ role: 'user', content: 'hi' }], pageLang: 'en', signal: caller.signal }, () => {});
    const p = e.calls[0];
    assert.equal(p.maxTokens, max, String(ctx));
    assert.equal(p.temperature, 0); assert.equal(p.topK, 1); assert.equal(p.topP, 1); assert.equal(p.repetitionPenalty, 1.0); assert.equal(p.enableThinking, false);
    assert.ok(p.signal && typeof p.signal.aborted === 'boolean');
    caller.abort();
    assert.equal(p.signal.aborted, false);
  }
  const e = fakeEngine(['a', 'b', 'c', 'd']);
  const caller = new AbortController();
  const run = A.answerTurns({ engine: e, tier: 'b2-4b', contextTokens: 2048, messages: [{ role: 'user', content: 'hi' }], pageLang: 'en', signal: caller.signal }, () => { caller.abort(); });
  await assert.rejects(run, (err) => err.name === 'AbortError');
  assert.equal(e.calls[0].signal.aborted, true);
});

check('answer: special tokens never reach the text', async () => {
  const A = await import('/assets/js/ai-answer.js');
  const e = fakeEngine(['Hi', '<|im_end|>', ' there', '<|endoftext|>']);
  let streamed = '';
  const r = await A.answerTurns({ engine: e, tier: 'b2-2b', contextTokens: 2048, messages: [{ role: 'user', content: 'hi' }], pageLang: 'en' }, (d, o) => { streamed = o && o.reset ? d : streamed + d; });
  assert.equal(r.text, 'Hi there');
  assert.equal(streamed, 'Hi there');
  assert.equal(r.tokens, 2);
  assert.equal(r.cut, false);
});

check('answer: a looping reply is cut and the engine is stopped', async () => {
  const A = await import('/assets/js/ai-answer.js');
  const T = await import('/assets/js/ai-turn.js');
  const unit = ['The', ' keeper', ' climbed', ' the', ' stairs', ' again.', ' '];
  const tokens = [];
  for (let i = 0; i < 60; i++) tokens.push(...unit);
  let expected = null;
  let acc = '';
  for (const t of tokens) { acc += t; const c = T.trimRepeatTail(acc); if (c !== null) { expected = c; break; } }
  assert.ok(expected);
  const e = fakeEngine(tokens);
  let streamed = '';
  const r = await A.answerTurns({ engine: e, tier: 'b2-2b', contextTokens: 2048, messages: [{ role: 'user', content: 'story' }], pageLang: 'en' }, (d, o) => { streamed = o && o.reset ? d : streamed + d; });
  assert.equal(r.cut, true);
  assert.equal(e.aborted, true);
  assert.equal(r.text, expected);
  assert.equal(streamed, expected);
});

check('answer: text after the last </think> is kept', async () => {
  const A = await import('/assets/js/ai-answer.js');
  const e = fakeEngine(['a', '</think>', 'b']);
  let streamed = '';
  let resets = 0;
  const r = await A.answerTurns({ engine: e, tier: 'b2-2b', contextTokens: 2048, messages: [{ role: 'user', content: 'hi' }], pageLang: 'en' }, (d, o) => { if (o && o.reset) { resets++; streamed = d; } else streamed += d; });
  assert.equal(r.text, 'b');
  assert.equal(streamed, 'b');
  assert.equal(resets, 1);
});

check('answer: an aborted signal rejects with AbortError and no text', async () => {
  const A = await import('/assets/js/ai-answer.js');
  const e = fakeEngine(['a']);
  const caller = new AbortController();
  caller.abort();
  let calls = 0;
  await assert.rejects(A.answerTurns({ engine: e, tier: 'b2-2b', contextTokens: 2048, messages: [{ role: 'user', content: 'hi' }], pageLang: 'en', signal: caller.signal }, () => { calls++; }), (err) => err.name === 'AbortError');
  assert.equal(calls, 0);
  assert.equal(e.calls.length, 0);
});

let failed = 0;
for (const [name, fn] of checks) {
  try { await fn(); console.log('PASS ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + String(e && e.stack || e).split('\n').slice(0, 3).join('\n     ')); }
}
console.log('ai-turn: ' + (checks.length - failed) + '/' + checks.length + ' passed');
process.exit(failed ? 1 : 0);
