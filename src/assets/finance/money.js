const decimalsCache = new Map();
const fmtCache = new Map();
const LIMIT = 2 ** 51;

export function decimalsFor(currency) {
  const code = String(currency || 'USD').toUpperCase();
  if (decimalsCache.has(code)) return decimalsCache.get(code);
  let d = 2;
  try { d = new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits; } catch (_) {}
  decimalsCache.set(code, d);
  return d;
}

export function isCurrency(code) {
  if (!/^[A-Za-z]{3}$/.test(String(code || ''))) return false;
  try { new Intl.NumberFormat('en', { style: 'currency', currency: code }); return true; } catch (_) { return false; }
}

export function guard(n) {
  if (!Number.isSafeInteger(n) || Math.abs(n) >= LIMIT) throw new RangeError('amount out of range');
  return n;
}

function roundHalfEvenBig(num, den) {
  if (den < 0n) { num = -num; den = -den; }
  const neg = num < 0n;
  const a = neg ? -num : num;
  let q = a / den;
  const r = a - q * den;
  const twice = r * 2n;
  if (twice > den || (twice === den && (q & 1n) === 1n)) q += 1n;
  return neg ? -q : q;
}

export function roundDiv(num, den) {
  return Number(roundHalfEvenBig(BigInt(num), BigInt(den)));
}

export function toMinor(decimal, currencyOrDecimals) {
  const decimals = typeof currencyOrDecimals === 'number' ? currencyOrDecimals : decimalsFor(currencyOrDecimals);
  const s = String(decimal).trim();
  const m = s.match(/^([+-])?(\d*)(?:\.(\d*))?$/);
  if (!m || (!m[2] && !m[3])) return null;
  const frac = m[3] || '';
  const digits = BigInt((m[2] || '0') + frac || '0');
  const scale = 10n ** BigInt(frac.length);
  const target = 10n ** BigInt(decimals);
  let v = roundHalfEvenBig(digits * target, scale);
  if (m[1] === '-') v = -v;
  return guard(Number(v));
}

export function minorToDecimal(minor, currencyOrDecimals) {
  const decimals = typeof currencyOrDecimals === 'number' ? currencyOrDecimals : decimalsFor(currencyOrDecimals);
  const neg = minor < 0;
  const s = String(Math.abs(minor)).padStart(decimals + 1, '0');
  const out = decimals ? s.slice(0, s.length - decimals) + '.' + s.slice(s.length - decimals) : s;
  return (neg ? '-' : '') + out;
}

export function trimDecimal(dec) {
  const s = String(dec == null ? '' : dec);
  if (s.indexOf('.') < 0) return s;
  let end = s.length;
  while (end > 0 && s[end - 1] === '0') end--;
  if (s[end - 1] === '.') end--;
  return s.slice(0, end);
}

export function minorToNumber(minor, currency) {
  return minor / 10 ** decimalsFor(currency);
}

export function numberToMinor(value, currency) {
  if (!Number.isFinite(value)) return 0;
  return guard(Math.round(value * 10 ** decimalsFor(currency)));
}

function formatter(locale, currency, opts) {
  const key = locale + '|' + currency + '|' + JSON.stringify(opts || {});
  let f = fmtCache.get(key);
  if (!f) {
    try { f = new Intl.NumberFormat(locale || undefined, Object.assign({ style: 'currency', currency }, opts)); }
    catch (_) { f = new Intl.NumberFormat('en', Object.assign({ style: 'currency', currency: 'USD' }, opts)); }
    fmtCache.set(key, f);
  }
  return f;
}

export function format(minor, currency, locale, opts) {
  const o = Object.assign({}, opts || {});
  const compact = o.compact;
  delete o.compact;
  if (compact && Math.abs(minorToNumber(minor || 0, currency)) >= 10000) {
    o.notation = 'compact';
    o.maximumFractionDigits = 1;
    o.minimumFractionDigits = 0;
  }
  return formatter(locale, currency, o).format(minorToNumber(minor || 0, currency));
}

export function formatPlain(minor, currency, locale) {
  const d = decimalsFor(currency);
  return new Intl.NumberFormat(locale || undefined, { minimumFractionDigits: d, maximumFractionDigits: d }).format(minorToNumber(minor || 0, currency));
}

export function currencySymbol(currency, locale) {
  try {
    const part = new Intl.NumberFormat(locale || undefined, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).formatToParts(0).find((p) => p.type === 'currency');
    return part ? part.value : currency;
  } catch (_) { return currency; }
}

export function localeSeparators(locale) {
  try {
    const parts = new Intl.NumberFormat(locale || undefined).formatToParts(12345.6);
    return {
      group: (parts.find((p) => p.type === 'group') || { value: ',' }).value,
      decimal: (parts.find((p) => p.type === 'decimal') || { value: '.' }).value
    };
  } catch (_) { return { group: ',', decimal: '.' }; }
}

export function decimalToInput(dec, locale) {
  const s = String(dec == null ? '' : dec);
  const d = localeSeparators(locale).decimal;
  return d === '.' ? s : s.replace('.', d);
}

export function formatDecimal(dec, locale) {
  const s = String(dec == null ? '' : dec);
  const m = s.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!m) return s;
  let head = m[2];
  try { head = new Intl.NumberFormat(locale || undefined).format(BigInt(m[2])); } catch (_) {}
  return (m[1] ? '-' : '') + head + (m[3] ? localeSeparators(locale).decimal + m[3] : '');
}

const SYMBOLS = { '$': 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY', '₹': 'INR', '₩': 'KRW', '₽': 'RUB', '₺': 'TRY', '₫': 'VND', '₦': 'NGN', '₱': 'PHP', '฿': 'THB', '₪': 'ILS', '₴': 'UAH', 'R$': 'BRL', 'A$': 'AUD', 'C$': 'CAD', 'HK$': 'HKD', 'S$': 'SGD', 'NZ$': 'NZD', 'zł': 'PLN', 'kr': null, 'Fr': 'CHF', 'Rs': 'INR' };

export function detectCurrency(text) {
  const s = String(text || '');
  const code = s.match(/\b([A-Z]{3})\b/);
  if (code && isCurrency(code[1])) return code[1];
  const keys = Object.keys(SYMBOLS).sort((a, b) => b.length - a.length);
  for (const k of keys) if (SYMBOLS[k] && s.includes(k)) return SYMBOLS[k];
  return null;
}

export function normalizeNumber(raw, locale, style) {
  let s = String(raw || '').replace(/[   ]/g, ' ').trim();
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/[-−–]/.test(s.replace(/\d[-−–]\d/g, ''))) neg = true;
  let mult = 1;
  const suffix = s.match(/(\d)\s*(k|K|m|M|mn|bn)\b/);
  if (suffix) mult = /^k$/i.test(suffix[2]) ? 1e3 : /^bn$/i.test(suffix[2]) ? 1e9 : 1e6;
  s = s.replace(/[^\d.,' ]/g, '').trim();
  if (!/\d/.test(s)) return null;
  s = s.replace(/'/g, '');
  const sep = style || localeSeparators(locale);
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let decimalChar = null;
  if (lastDot >= 0 && lastComma >= 0) decimalChar = lastDot > lastComma ? '.' : ',';
  else if (lastDot >= 0 || lastComma >= 0) {
    const ch = lastDot >= 0 ? '.' : ',';
    const count = s.split(ch).length - 1;
    const tail = s.slice(s.lastIndexOf(ch) + 1).replace(/\s/g, '');
    const head = s.slice(0, s.indexOf(ch)).replace(/\s/g, '');
    if (count > 1) decimalChar = null;
    else if (!head || head[0] === '0') decimalChar = ch;
    else if (tail.length === 3 && sep.group === ch && sep.decimal !== ch) decimalChar = null;
    else if (tail.length === 3 && /^\d{1,3}$/.test(head) && sep.decimal !== ch) decimalChar = null;
    else decimalChar = ch;
  }
  let intPart = s;
  let fracPart = '';
  if (decimalChar) {
    const i = s.lastIndexOf(decimalChar);
    intPart = s.slice(0, i);
    fracPart = s.slice(i + 1);
  }
  intPart = intPart.replace(/[.,\s]/g, '');
  fracPart = fracPart.replace(/[.,\s]/g, '');
  if (!intPart && !fracPart) return null;
  let out = (intPart || '0') + (fracPart ? '.' + fracPart : '');
  if (mult !== 1) {
    const n = Number(out) * mult;
    out = String(Math.round(n * 1e6) / 1e6);
  }
  return (neg ? '-' : '') + out;
}

export function parseMoney(text, currency, locale) {
  const dec = normalizeNumber(text, locale);
  if (dec == null) return null;
  return toMinor(dec, currency);
}

export function qtyTimesPrice(qty, qtyScale, priceE4, decimals) {
  const num = BigInt(qty) * BigInt(priceE4);
  const exp = qtyScale + 4 - decimals;
  if (exp >= 0) return guard(Number(roundHalfEvenBig(num, 10n ** BigInt(exp))));
  return guard(Number(num * 10n ** BigInt(-exp)));
}

export function toQty(decimal, qtyScale) {
  return toMinor(decimal, qtyScale);
}

export function toPriceE4(decimal) {
  return toMinor(decimal, 4);
}

export function convertMinor(minor, fromCcy, toCcy, rateE6) {
  if (fromCcy === toCcy) return minor;
  const fd = decimalsFor(fromCcy);
  const td = decimalsFor(toCcy);
  const num = BigInt(minor) * BigInt(rateE6) * 10n ** BigInt(td);
  const den = 1000000n * 10n ** BigInt(fd);
  return guard(Number(roundHalfEvenBig(num, den)));
}

export function rateE6From(decimal) {
  return toMinor(decimal, 6);
}

export function sumMinor(list) {
  let s = 0;
  for (const v of list) s += v || 0;
  return guard(s);
}

export function allocate(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!sum) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map((v) => Math.trunc(v));
  let rest = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => [Math.abs(v - Math.trunc(v)), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; rest !== 0 && k < order.length; k++) {
    const i = order[k][1];
    out[i] += Math.sign(rest);
    rest -= Math.sign(rest);
  }
  return out;
}
