import { normalizeNumber, detectCurrency, isCurrency } from './money.js';
import { addDays, weekday, parseDateLoose, weekdayNames, monthFromText, iso, parts, dayFirstFor, isISODate } from './dates.js';

const NUM = "(?:\\d{1,3}(?:[\\u00a0\\u202f ]\\d{3})+(?:[.,]\\d+)?|\\d[\\d.,']*\\d|\\d)(?:\\s?(?:k|K|m|M)\\b)?";
const AMOUNT_RE = new RegExp("(?:([A-Z]{3})\\s?|([$€£¥₹₩₽₺₫₦₱฿₪₴]|R\\$|A\\$|C\\$|HK\\$|S\\$|NZ\\$|Rs\\.?)\\s?)?(\\(?-?" + NUM + "\\)?)(?:\\s?([A-Z]{3})\\b|\\s?(€|zł|kr|Kč|₹|円|元))?", 'g');

function wordsOf(list) {
  return String(list || '').toLowerCase().split('|').map((w) => w.trim()).filter(Boolean);
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

const CJK = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;
const KANA_WORD = /^[\u3041-\u309f]+$/;
const KANA_CHAR = /[\u3041-\u309f]/;

function minLen(name) { return CJK.test(name) ? 2 : 3; }

function hasWord(text, word) {
  if (!word) return false;
  if (CJK.test(word)) return text.toLowerCase().includes(word.toLowerCase());
  try { return new RegExp('(^|[^\\p{L}\\p{N}])' + escapeRe(word) + '($|[^\\p{L}\\p{N}])', 'iu').test(text); }
  catch (_) { return text.toLowerCase().includes(word.toLowerCase()); }
}

function stripWord(text, word) {
  if (CJK.test(word)) {
    const i = text.toLowerCase().indexOf(word.toLowerCase());
    return i < 0 ? text : text.slice(0, i) + ' ' + text.slice(i + word.length);
  }
  try { return text.replace(new RegExp('(^|[^\\p{L}\\p{N}])' + escapeRe(word) + '(?=$|[^\\p{L}\\p{N}])', 'iu'), '$1 '); }
  catch (_) { return text; }
}

function stripFiller(text, word) {
  if (!KANA_WORD.test(word)) return stripWord(text, word);
  for (let i = text.indexOf(word); i >= 0; i = text.indexOf(word, i + 1)) {
    if (!KANA_CHAR.test(text.charAt(i - 1)) && !KANA_CHAR.test(text.charAt(i + word.length))) return text.slice(0, i) + ' ' + text.slice(i + word.length);
  }
  return text;
}

export function findAmounts(text, locale) {
  const out = [];
  let m;
  AMOUNT_RE.lastIndex = 0;
  while ((m = AMOUNT_RE.exec(text))) {
    const raw = m[3];
    if (!raw) continue;
    const before = text.slice(Math.max(0, m.index - 1), m.index);
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 1);
    if (/[/:]/.test(before) || /[/:]/.test(after)) continue;
    const dec = normalizeNumber(raw, locale);
    if (dec == null || Number(dec) === 0) continue;
    const ccy = (m[1] && isCurrency(m[1]) ? m[1] : null) || (m[4] && isCurrency(m[4]) ? m[4] : null) || detectCurrency(m[2] || m[5] || '');
    out.push({ index: m.index, text: m[0], decimal: dec.replace(/^-/, ''), currency: ccy, explicit: !!(m[1] || m[2] || m[4] || m[5]) });
  }
  return out;
}

export function findDate(text, ctx) {
  const lower = text.toLowerCase();
  const today = ctx.today;
  const W = ctx.words || {};
  for (const w of wordsOf(W.daybefore)) if (hasWord(lower, w)) return { date: addDays(today, -2), word: w };
  for (const w of wordsOf(W.today)) if (hasWord(lower, w)) return { date: today, word: w };
  for (const w of wordsOf(W.yesterday)) if (hasWord(lower, w)) return { date: addDays(today, -1), word: w };
  for (const w of wordsOf(W.tomorrow)) if (hasWord(lower, w)) return { date: addDays(today, 1), word: w };
  const iso1 = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso1 && isISODate(iso1[1])) return { date: iso1[1], word: iso1[1] };
  const dm = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/) || text.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{2,4})\b/);
  if (dm) {
    const dayFirst = dayFirstFor(ctx.locale);
    const y = dm[3] ? (dm[3].length === 2 ? 2000 + +dm[3] : +dm[3]) : parts(today).y;
    const d = dayFirst ? +dm[1] : +dm[2];
    const mo = dayFirst ? +dm[2] : +dm[1];
    const v = iso(y, mo, d);
    if (isISODate(v)) return { date: v > today && !dm[3] ? iso(y - 1, mo, d) : v, word: dm[0] };
  }
  const named = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-zÀ-ÿ]{3,})\.?(?:\s+(\d{4}))?\b/) || text.match(/\b([A-Za-zÀ-ÿ]{3,})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/);
  if (named) {
    const a = named[1], b = named[2];
    const mo = monthFromText(/^\d/.test(a) ? b : a, ctx.locale);
    const d = +(/^\d/.test(a) ? a : b);
    if (mo && d >= 1 && d <= 31) {
      let y = named[3] ? +named[3] : parts(today).y;
      let v = iso(y, mo, d);
      if (!named[3] && v > today) v = iso(y - 1, mo, d);
      if (isISODate(v)) return { date: v, word: named[0] };
    }
  }
  const names = weekdayNames(ctx.locale).concat(weekdayNames('en'));
  const lastWords = wordsOf(W.last);
  for (let i = 0; i < names.length; i++) {
    const [long, short] = names[i];
    const wd = i % 7;
    for (const nm of [long, short]) {
      if (!nm || nm.length < 3 || !hasWord(lower, nm)) continue;
      const cur = weekday(today);
      let back = (cur - wd + 7) % 7;
      const isLast = lastWords.some((lw) => lower.includes(lw + ' ' + nm));
      if (back === 0) back = isLast ? 7 : 0;
      return { date: addDays(today, -back), word: (isLast ? lastWords.find((lw) => lower.includes(lw + ' ' + nm)) + ' ' : '') + nm };
    }
  }
  const loose = parseDateLoose(text, { locale: ctx.locale, dayFirst: dayFirstFor(ctx.locale) });
  if (loose) return { date: loose, word: '' };
  return null;
}

export function parseEntry(text, ctx) {
  const src = String(text || '').normalize('NFKC').trim();
  const out = { amount: null, currency: null, amounts: [], income: false, transfer: false, date: null, category: null, account: null, toAccount: null, payee: '', note: '', confidence: 0 };
  if (!src) return out;
  let rest = ' ' + src + ' ';
  const dateHit = findDate(src, ctx);
  if (dateHit) { out.date = dateHit.date; if (dateHit.word) rest = stripWord(rest, dateHit.word); }
  const amounts = findAmounts(rest, ctx.locale);
  out.amounts = amounts;
  if (amounts.length) {
    const pick = amounts.find((a) => a.explicit) || amounts.slice().sort((a, b) => Number(b.decimal) - Number(a.decimal))[0];
    out.amount = pick.decimal;
    out.currency = pick.currency;
    rest = rest.replace(pick.text, ' ');
  }
  const lower = rest.toLowerCase();
  const W = ctx.words || {};
  for (const w of wordsOf(W.income)) if (hasWord(lower, w)) { out.income = true; break; }
  for (const w of wordsOf(W.transfer)) if (hasWord(lower, w)) { out.transfer = true; rest = stripWord(rest, w); break; }
  const accounts = (ctx.accounts || []).slice().sort((a, b) => b.name.length - a.name.length);
  for (const a of accounts) {
    if (a.name && a.name.length >= minLen(a.name) && hasWord(rest, a.name)) {
      if (!out.account) out.account = a.id;
      else if (!out.toAccount && a.id !== out.account) out.toAccount = a.id;
      rest = stripWord(rest, a.name);
    }
  }
  const cats = (ctx.categories || []).slice().sort((a, b) => b.name.length - a.name.length);
  for (const c of cats) {
    if (c.name && c.name.length >= minLen(c.name) && hasWord(rest, c.name)) { out.category = c.id; if (c.kind === 'income') out.income = true; rest = stripWord(rest, c.name); break; }
  }
  for (const w of wordsOf(W.income).concat(wordsOf(W.filler)).sort((a, b) => b.length - a.length)) rest = stripFiller(rest, w);
  for (const a of amounts) rest = rest.replace(a.text, ' ');
  const payees = (ctx.payees || []).slice().sort((a, b) => b.length - a.length);
  let payee = payees.find((p) => p.length >= minLen(p) && hasWord(rest, p));
  if (payee) rest = stripWord(rest, payee);
  const words = rest.replace(/[^\p{L}\p{N}&'\- ]/gu, ' ').split(/\s+/).filter((w) => w && !/^\d+$/.test(w));
  if (!payee && words.length) {
    payee = words.slice(0, 4).join(' ');
    payee = payee.charAt(0).toUpperCase() + payee.slice(1);
  }
  out.payee = payee || '';
  if (!out.category && out.payee && ctx.suggest) out.category = ctx.suggest(out.payee);
  out.confidence = (out.amount ? 0.5 : 0) + (out.payee ? 0.2 : 0) + (out.category ? 0.2 : 0) + (out.date ? 0.1 : 0);
  return out;
}

export function aiPrompt(ctx) {
  const cats = (ctx.categories || []).map((c) => c.name).join(' | ');
  const accts = (ctx.accounts || []).map((a) => a.name).join(' | ');
  return [
    'You turn one sentence about money into JSON. Today is ' + ctx.today + ' (' + ctx.weekdayName + ').',
    'Fields: {"payee": string, "amount": number, "currency": string|null, "type": "expense"|"income"|"transfer", "date": "YYYY-MM-DD", "category": one of [' + cats + '] or null, "account": one of [' + accts + '] or null, "note": string}.',
    'Use the amount exactly as written. Dates are relative to today. Reply with JSON only.',
    'Example: "coffee 4.50 yesterday" -> {"payee":"Coffee","amount":4.5,"currency":null,"type":"expense","date":"' + addDays(ctx.today, -1) + '","category":null,"account":null,"note":""}',
    'Example: "got salary 52000" -> {"payee":"Salary","amount":52000,"currency":null,"type":"income","date":"' + ctx.today + '","category":null,"account":null,"note":""}'
  ].join('\n');
}

export function parseAiJson(answer) {
  const tryParse = (s) => { try { return JSON.parse(s); } catch (_) { return null; } };
  let v = tryParse('{"' + answer);
  if (!v) {
    const m = String(answer || '').match(/\{[\s\S]*\}/);
    if (m) v = tryParse(m[0]) || tryParse(m[0].replace(/,\s*([}\]])/g, '$1').replace(/'/g, '"'));
  }
  if (!v || typeof v !== 'object') return null;
  return v;
}
