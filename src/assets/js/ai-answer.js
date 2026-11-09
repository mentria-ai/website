import { MAX_TOKENS, isSmallTier, isB2Tier, systemPromptFor, replyLanguage, asksAboutSite, historyBudget, trimRepeatTail } from '/assets/js/ai-turn.js';
import { stripThink } from '/assets/js/mentria-tiers.js';

const SPECIAL = /^<\|[^|]*\|>$/;

const abortError = () => {
  const err = new Error('aborted');
  err.name = 'AbortError';
  return err;
};

export const systemFor = (tier, turns, pageLang) => {
  const asks = turns.filter((m) => m.role === 'user').map((m) => m.content);
  if (isSmallTier(tier) || isB2Tier(tier)) {
    return systemPromptFor(tier, { image: false, lang: replyLanguage(asks, pageLang), site: isB2Tier(tier) && asksAboutSite(asks) });
  }
  return systemPromptFor(tier);
};

export const maxTokensFor = (contextTokens) => (contextTokens >= 4096 ? 768 : contextTokens >= 2048 ? MAX_TOKENS : 320);

const windowFor = async (engine, system, turns, budget) => {
  const count = async (list) => (await engine.encodeChat([system].concat(list), { enableThinking: false })).ids.length;
  if ((await count(turns)) <= budget) return turns;
  let kept = turns.slice(-1);
  for (let i = turns.length - 2; i >= 0; i--) {
    const candidate = turns.slice(i);
    if ((await count(candidate)) > budget) break;
    kept = candidate;
  }
  return kept;
};

export async function answerTurns({ engine, tier, contextTokens, messages, pageLang, signal }, onText) {
  if (signal && signal.aborted) throw abortError();
  const turns = (messages || []).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content == null ? '' : m.content) }));
  const ctx = Number(contextTokens) || 2048;
  const system = { role: 'system', content: systemFor(tier, turns, pageLang) };
  const kept = await windowFor(engine, system, turns, historyBudget(ctx, false).tokens);
  if (signal && signal.aborted) throw abortError();
  const ctl = new AbortController();
  const relay = () => ctl.abort();
  if (signal) signal.addEventListener('abort', relay, { once: true });
  let full = '';
  let shown = '';
  let cut = false;
  let tokens = 0;
  const started = Date.now();
  const emit = () => {
    const visible = stripThink(full);
    if (visible === shown) return;
    const grows = visible.startsWith(shown);
    const delta = grows ? visible.slice(shown.length) : visible;
    shown = visible;
    if (onText) onText(delta, { reset: !grows });
  };
  try {
    await engine.generate({
      messages: [system].concat(kept),
      maxTokens: maxTokensFor(ctx),
      temperature: 0,
      topK: 1,
      topP: 1,
      repetitionPenalty: 1.0,
      enableThinking: false,
      signal: ctl.signal
    }, (event) => {
      if (cut || !event || typeof event.token !== 'string' || !event.token || SPECIAL.test(event.token)) return;
      tokens += 1;
      full += event.token;
      const trimmed = trimRepeatTail(full);
      if (trimmed !== null) {
        full = trimmed;
        cut = true;
        ctl.abort();
      }
      emit();
    });
  } catch (err) {
    if (!(cut && err && err.name === 'AbortError')) throw (signal && signal.aborted) ? abortError() : err;
  } finally {
    if (signal) signal.removeEventListener('abort', relay);
  }
  if (!cut && signal && signal.aborted) throw abortError();
  return { text: stripThink(full), cut, tokens, ms: Date.now() - started };
}
