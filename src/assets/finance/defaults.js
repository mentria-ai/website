import { t, PALETTE } from './ui.js';
import { randomId } from './crypto.js';
import { todayISO } from './dates.js';

const REGION_CCY = {
  US: 'USD', IN: 'INR', GB: 'GBP', JP: 'JPY', BR: 'BRL', CA: 'CAD', AU: 'AUD', NZ: 'NZD', MX: 'MXN', CH: 'CHF', CN: 'CNY', HK: 'HKD',
  SG: 'SGD', KR: 'KRW', ZA: 'ZAR', NG: 'NGN', KE: 'KES', AE: 'AED', SA: 'SAR', TR: 'TRY', RU: 'RUB', PL: 'PLN', SE: 'SEK', NO: 'NOK',
  DK: 'DKK', CZ: 'CZK', HU: 'HUF', IL: 'ILS', ID: 'IDR', MY: 'MYR', TH: 'THB', PH: 'PHP', VN: 'VND', PK: 'PKR', BD: 'BDT', LK: 'LKR',
  NP: 'NPR', EG: 'EGP', AR: 'ARS', CL: 'CLP', CO: 'COP', PE: 'PEN', TW: 'TWD', UA: 'UAH', RO: 'RON', BG: 'BGN', IS: 'ISK'
};
const EURO = ['AT', 'BE', 'CY', 'DE', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PT', 'SI', 'SK'];

export const COMMON_CCY = ['USD', 'EUR', 'GBP', 'INR', 'JPY', 'BRL', 'CAD', 'AUD', 'CHF', 'CNY', 'SGD', 'AED', 'MXN', 'KRW', 'HKD', 'SEK', 'NOK', 'DKK', 'PLN', 'ZAR', 'NZD', 'TRY', 'IDR', 'THB', 'PHP', 'MYR', 'VND', 'NGN', 'KES', 'EGP', 'SAR', 'ILS', 'CZK', 'HUF', 'ARS', 'CLP', 'COP', 'PEN', 'PKR', 'BDT', 'LKR', 'NPR', 'TWD', 'UAH', 'RON'];

export function guessCurrency() {
  const langs = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'en-US']);
  for (const l of langs) {
    const m = String(l).match(/[-_]([A-Za-z]{2})\b/);
    if (!m) continue;
    const r = m[1].toUpperCase();
    if (EURO.includes(r)) return 'EUR';
    if (REGION_CCY[r]) return REGION_CCY[r];
  }
  const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (_) { return ''; } })();
  if (/Kolkata|Calcutta/.test(tz)) return 'INR';
  if (/Tokyo/.test(tz)) return 'JPY';
  if (/Sao_Paulo/.test(tz)) return 'BRL';
  if (/London/.test(tz)) return 'GBP';
  if (/^Europe\//.test(tz)) return 'EUR';
  return 'USD';
}

const EXPENSE = [
  ['home', ['rent', 'utilities', 'internet']],
  ['food', ['groceries', 'eating_out']],
  ['transport', ['fuel', 'public_transport', 'taxi']],
  ['shopping', ['clothing', 'electronics', 'household']],
  ['health', ['medical', 'fitness']],
  ['leisure', ['entertainment', 'subscriptions', 'travel']],
  ['family', ['education', 'gifts']],
  ['finance', ['fees', 'insurance', 'taxes']],
  ['other', []]
];
const INCOME = [
  ['salary', 'employment'], ['business', 'self_employment'], ['interest', 'interest'],
  ['dividends', 'dividend'], ['rental', 'rental'], ['other_income', 'other']
];

export function defaultOps(engine, base) {
  const ops = [];
  const now = new Date().toISOString();
  ops.push(...engine.createOps('settings', 'main', { base_currency: base, created: now }));
  ops.push(...engine.createOps('account', randomId(), { name: t('defaults.cash'), type: 'cash', currency: base, opening_minor: 0, opening_date: todayISO(), include_in_net_worth: true, order: 1, lot_method: 'fifo', created: now }));
  ops.push(...engine.createOps('account', randomId(), { name: t('defaults.bank'), type: 'bank', currency: base, opening_minor: 0, opening_date: todayISO(), include_in_net_worth: true, order: 2, lot_method: 'fifo', created: now }));
  let order = 0;
  EXPENSE.forEach(([g, kids], gi) => {
    const gid = randomId();
    const color = PALETTE[gi % PALETTE.length];
    ops.push(...engine.createOps('category', gid, { name: t('defaults.cat.' + g), group: null, kind: 'expense', color, order: ++order, hidden: false, rollover: false }));
    for (const k of kids) ops.push(...engine.createOps('category', randomId(), { name: t('defaults.cat.' + k), group: gid, kind: 'expense', color, order: ++order, hidden: false, rollover: false }));
  });
  const incomeColor = '#6ef3c5';
  INCOME.forEach(([k, src]) => {
    ops.push(...engine.createOps('category', randomId(), { name: t('defaults.cat.' + k), group: null, kind: 'income', color: incomeColor, order: ++order, hidden: false, income_source: src }));
  });
  return ops;
}
