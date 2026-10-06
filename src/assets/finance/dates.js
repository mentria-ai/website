const DAY = 86400000;
const fmtCache = new Map();

export function pad2(n) { return String(n).padStart(2, '0'); }

export function iso(y, m, d) { return y + '-' + pad2(m) + '-' + pad2(d); }

export function parts(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return { y: +m[1], m: +m[2], d: +m[3] };
}

export function isISODate(s) {
  const p = parts(s);
  if (!p || p.m < 1 || p.m > 12 || p.d < 1) return false;
  return p.d <= daysInMonth(p.y, p.m) && String(s).length === 10;
}

export function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

export function toUTC(s) { const p = parts(s); return Date.UTC(p.y, p.m - 1, p.d); }

export function fromUTC(t) { const d = new Date(t); return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); }

export function dateInZone(when, tz) {
  const d = when instanceof Date ? when : new Date(when);
  if (isNaN(d.getTime())) return null;
  try {
    const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz || undefined, year: 'numeric', month: '2-digit', day: '2-digit' });
    const p = f.formatToParts(d);
    const g = (t) => (p.find((x) => x.type === t) || {}).value;
    return g('year') + '-' + g('month') + '-' + g('day');
  } catch (_) {
    return iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }
}

export function todayISO(tz) {
  return dateInZone(new Date(), tz);
}

export function localDateOf(stamp, tz) {
  const s = String(stamp || '');
  if (isISODate(s)) return s;
  if (!/^\d{4}-\d{2}-\d{2}T/.test(s)) return null;
  return dateInZone(s, tz);
}

export function localTimeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (_) { return 'UTC'; }
}

export function addDays(s, n) { return fromUTC(toUTC(s) + n * DAY); }

export function diffDays(a, b) { return Math.round((toUTC(b) - toUTC(a)) / DAY); }

export function weekday(s) { return new Date(toUTC(s)).getUTCDay(); }

export function monthKey(s) { return String(s).slice(0, 7); }

export function monthStart(s) { return String(s).slice(0, 7) + '-01'; }

export function monthEnd(s) { const p = parts(s); return iso(p.y, p.m, daysInMonth(p.y, p.m)); }

export function addMonths(s, n, day) {
  const p = parts(s);
  const total = p.y * 12 + (p.m - 1) + n;
  const y = Math.floor(total / 12);
  const m = total - y * 12 + 1;
  const want = day == null ? p.d : day;
  const dim = daysInMonth(y, m);
  const d = want === -1 || want > dim ? dim : want;
  return iso(y, m, d);
}

export function addMonthKey(key, n) { return addMonths(key + '-01', n).slice(0, 7); }

export function monthsBetween(aKey, bKey) {
  const [ay, am] = aKey.split('-').map(Number);
  const [by, bm] = bKey.split('-').map(Number);
  return (by - ay) * 12 + (bm - am);
}

export function monthRange(fromKey, toKey) {
  const out = [];
  const n = monthsBetween(fromKey, toKey);
  for (let i = 0; i <= n; i++) out.push(addMonthKey(fromKey, i));
  return out;
}

export function startOfWeek(s, weekStart) {
  const wd = weekday(s);
  const back = (wd - (weekStart || 0) + 7) % 7;
  return addDays(s, -back);
}

export function yearStartFor(s, mmdd) {
  const md = mmdd || '01-01';
  const p = parts(s);
  const candidate = p.y + '-' + md;
  return s >= candidate ? candidate : (p.y - 1) + '-' + md;
}

function dateFmt(locale, opts) {
  const key = (locale || '') + JSON.stringify(opts);
  let f = fmtCache.get(key);
  if (!f) {
    try { f = new Intl.DateTimeFormat(locale || undefined, Object.assign({ timeZone: 'UTC' }, opts)); }
    catch (_) { f = new Intl.DateTimeFormat('en', Object.assign({ timeZone: 'UTC' }, opts)); }
    fmtCache.set(key, f);
  }
  return f;
}

export function formatDate(s, locale, style) {
  if (!isISODate(s)) return String(s || '');
  const opts = style === 'long' ? { year: 'numeric', month: 'long', day: 'numeric' }
    : style === 'month' ? { year: 'numeric', month: 'long' }
    : style === 'monthShort' ? { month: 'short' }
    : style === 'monthYearShort' ? { month: 'short', year: 'numeric' }
    : style === 'weekday' ? { weekday: 'long', day: 'numeric', month: 'short' }
    : style === 'dayMonth' ? { day: 'numeric', month: 'short' }
    : style === 'year' ? { year: 'numeric' }
    : { year: 'numeric', month: 'short', day: 'numeric' };
  return dateFmt(locale, opts).format(new Date(toUTC(s)));
}

export function formatMonthKey(key, locale, short) {
  return formatDate(key + '-01', locale, short ? 'monthYearShort' : 'month');
}

export function monthNames(locale) {
  const out = [];
  for (let m = 1; m <= 12; m++) out.push(formatDate(iso(2024, m, 1), locale, 'monthShort').toLowerCase().replace('.', ''));
  return out;
}

export function weekdayNames(locale) {
  const out = [];
  const f = dateFmt(locale, { weekday: 'long' });
  const s = dateFmt(locale, { weekday: 'short' });
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.UTC(2024, 0, 7 + i));
    out.push([f.format(d).toLowerCase(), s.format(d).toLowerCase().replace('.', '')]);
  }
  return out;
}

export function dayFirstFor(locale) {
  try {
    const p = new Intl.DateTimeFormat(locale || undefined).formatToParts(new Date(Date.UTC(2024, 10, 25)));
    const di = p.findIndex((x) => x.type === 'day');
    const mi = p.findIndex((x) => x.type === 'month');
    return di < mi;
  } catch (_) { return true; }
}

export function parseDateLoose(text, opts) {
  const o = opts || {};
  const s = String(text || '').trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return isISODate(s.slice(0, 10)) ? s.slice(0, 10) : null;
  if (/^\d{8}$/.test(s)) { const v = s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8); return isISODate(v) ? v : null; }
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const serial = Math.floor(Number(s));
    if (serial > 20000 && serial < 80000) return fromUTC(Date.UTC(1899, 11, 30) + serial * DAY);
  }
  const m = s.match(/^(\d{1,4})[./\-\s](\d{1,2}|[A-Za-zÀ-ÿ]{3,})[./\-\s,]+(\d{2,4})/);
  if (m) {
    let a = m[1], b = m[2], c = m[3];
    let y, mo, d;
    if (a.length === 4) { y = +a; mo = monthFromText(b, o.locale) || +b; d = +c; }
    else {
      const bm = monthFromText(b, o.locale);
      y = +c;
      if (y < 100) y += y < 70 ? 2000 : 1900;
      if (bm) { mo = bm; d = +a; }
      else if (o.dayFirst === false) { mo = +a; d = +b; }
      else { d = +a; mo = +b; }
    }
    const v = iso(y, mo, d);
    return isISODate(v) ? v : null;
  }
  const t = s.match(/^([A-Za-zÀ-ÿ]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (t) {
    const mo = monthFromText(t[1], o.locale);
    if (mo) { const v = iso(+t[3], mo, +t[2]); return isISODate(v) ? v : null; }
  }
  return null;
}

const EN_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

export function monthFromText(word, locale) {
  const w = String(word || '').toLowerCase().replace('.', '');
  if (w.length < 3 || /\d/.test(w)) return null;
  const i = EN_MONTHS.indexOf(w.slice(0, 3));
  if (i >= 0) return i + 1;
  if (locale) {
    const names = monthNames(locale);
    const j = names.findIndex((n) => n && (n.startsWith(w) || w.startsWith(n)));
    if (j >= 0) return j + 1;
  }
  return null;
}

const UNIT_DAYS = { day: 1, week: 7 };

export function nthOccurrence(rule, anchor, n) {
  const interval = Math.max(1, rule.interval || 1);
  const freq = rule.freq || 'month';
  let d;
  if (freq === 'day' || freq === 'week') d = addDays(anchor, n * interval * UNIT_DAYS[freq]);
  else if (freq === 'year') d = addMonths(anchor, n * interval * 12, rule.by_month_day != null ? rule.by_month_day : parts(anchor).d);
  else d = addMonths(anchor, n * interval, rule.by_month_day != null ? rule.by_month_day : parts(anchor).d);
  return shiftWeekend(d, rule.weekend_shift);
}

export function shiftWeekend(d, mode) {
  if (!mode || mode === 'none') return d;
  const wd = weekday(d);
  if (wd !== 0 && wd !== 6) return d;
  if (mode === 'before') return addDays(d, wd === 6 ? -1 : -2);
  return addDays(d, wd === 6 ? 2 : 1);
}

function approxIndex(rule, anchor, date) {
  const interval = Math.max(1, rule.interval || 1);
  const freq = rule.freq || 'month';
  if (freq === 'day' || freq === 'week') return Math.floor(diffDays(anchor, date) / (interval * UNIT_DAYS[freq]));
  const months = monthsBetween(monthKey(anchor), monthKey(date));
  return Math.floor(months / (interval * (freq === 'year' ? 12 : 1)));
}

export function occurrences(rule, anchor, from, to, end) {
  const out = [];
  if (!isISODate(anchor) || !isISODate(from) || !isISODate(to)) return out;
  let n = Math.max(0, approxIndex(rule, anchor, from) - 2);
  const maxN = end && end.mode === 'count' ? (end.n || 0) : Infinity;
  const until = end && end.mode === 'date' ? end.date : null;
  for (let guardN = 0; guardN < 5000 && n < maxN; guardN++, n++) {
    const d = nthOccurrence(rule, anchor, n);
    if (until && d > until) break;
    if (d > to) break;
    if (d >= from) out.push(d);
  }
  return out;
}

export function nextOccurrence(rule, anchor, after, end) {
  const horizon = addDays(after, 3700);
  const list = occurrences(rule, anchor, addDays(after, 1), horizon, end);
  return list.length ? list[0] : null;
}

export function cycleMonths(rule) {
  const interval = Math.max(1, rule.interval || 1);
  const freq = rule.freq || 'month';
  if (freq === 'day') return (interval * 12) / 365.25;
  if (freq === 'week') return (interval * 7 * 12) / 365.25;
  if (freq === 'year') return interval * 12;
  return interval;
}
