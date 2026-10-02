import { normalizeNumber, isCurrency } from './money.js';
import { parseDateLoose, isISODate, iso } from './dates.js';

export function detectFormat(text, name) {
  const head = String(text || '').slice(0, 2000).replace(/^﻿/, '');
  if (/^\s*OFXHEADER:/i.test(head) || /<OFX>/i.test(head)) return 'ofx';
  if (/^\s*!(Type|Account|Option)/im.test(head)) return 'qif';
  if (/urn:iso:std:iso:20022:tech:xsd:camt\.05[234]/i.test(head) || /<BkToCstmrStmt>/i.test(head)) return 'camt';
  if (/\.(ofx|qfx)$/i.test(name || '')) return 'ofx';
  if (/\.qif$/i.test(name || '')) return 'qif';
  return 'csv';
}

function splitLine(line, d) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"' && cur.trim() === '') { q = true; cur = ''; }
    else if (c === d) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

function logicalLines(text) {
  const lines = [];
  let cur = '';
  let quotes = 0;
  for (const raw of text.split(/\r\n|\n|\r/)) {
    cur = cur ? cur + '\n' + raw : raw;
    quotes += (raw.match(/"/g) || []).length;
    if (quotes % 2 === 0) { lines.push(cur); cur = ''; quotes = 0; }
  }
  if (cur) lines.push(cur);
  return lines;
}

export function parseCsv(text) {
  const clean = String(text || '').replace(/^﻿/, '');
  const lines = logicalLines(clean).filter((l) => l.trim() !== '');
  const sample = lines.slice(0, 40);
  let best = { d: ',', score: -1 };
  for (const d of [',', ';', '\t', '|']) {
    const counts = sample.map((l) => splitLine(l, d).length);
    const freq = new Map();
    for (const c of counts) freq.set(c, (freq.get(c) || 0) + 1);
    let mode = 1, modeN = 0;
    for (const [c, n] of freq) if (c > 1 && n > modeN) { mode = c; modeN = n; }
    const score = mode > 1 ? modeN * 10 + mode : 0;
    if (score > best.score) best = { d, score };
  }
  return { delimiter: best.d, rows: lines.map((l) => splitLine(l, best.d)) };
}

const ROLE_RE = {
  date: /^(txn|tran|transaction|posting|booking|value|trade|settlement|operation)?(date|dt|datum|fecha|data)$|^(buchungstag|buchungsdatum|valuta|valutadatum|wertstellung|datevaleur|dateoperation|datedoperation|fechaoperacion|fechavalor|datamovimento|datalancamento|torihikibi|riyoubi)$/,
  payee: /(narration|particular|description|memo|remark|detail|payee|name|merchant|beneficiary|counterparty|libelle|concepto|descricao|verwendungszweck|reference|ref)/,
  debit: /^(withdrawal|debit|dr|out|paidout|moneyout|withdrawalamt|debitamount|spent|charge)/,
  credit: /^(deposit|credit|cr|in|paidin|moneyin|depositamt|creditamount|received)/,
  amount: /^(amount|amt|value|betrag|montant|importe|valor|sum|total|transactionamount)/,
  drcr: /^(drcr|crdr|type|debitcredit|dc|sign|indicator)$/,
  balance: /(balance|closing|saldo|solde|runningbal)/,
  ref: /(chq|cheque|check|refno|utr|rrn|transactionid|fitid|^id$|^ref$|referenceno)/,
  currency: /^(currency|ccy|curr|devise|moneda|moeda|wahrung)$/
};

function norm(h) { return String(h || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, ''); }

export function guessHeader(rows) {
  let best = { idx: 0, score: -1 };
  for (let i = 0; i < Math.min(40, rows.length); i++) {
    const r = rows[i];
    let score = 0;
    const seen = new Set();
    for (const cell of r) {
      const n = norm(cell);
      if (!n || /^\d/.test(n)) continue;
      for (const [role, re] of Object.entries(ROLE_RE)) if (re.test(n) && !seen.has(role)) { score += role === 'date' || role === 'amount' || role === 'debit' ? 3 : 1; seen.add(role); }
    }
    if (r.length < 2) score = -1;
    if (score > best.score) best = { idx: i, score };
  }
  return best.score >= 3 ? best.idx : -1;
}

export function guessRoles(header) {
  const roles = {};
  header.forEach((cell, i) => {
    const n = norm(cell);
    for (const role of ['date', 'debit', 'credit', 'drcr', 'balance', 'currency', 'ref', 'amount', 'payee']) {
      if (roles[role] != null) continue;
      if (ROLE_RE[role].test(n)) {
        if (role === 'payee' && (ROLE_RE.balance.test(n) || ROLE_RE.ref.test(n) && !/(desc|narr|memo|partic)/.test(n))) continue;
        if (role === 'amount' && (roles.debit === i || roles.credit === i || ROLE_RE.balance.test(n))) continue;
        roles[role] = i;
        break;
      }
    }
  });
  return roles;
}

export function guessRolesFromData(rows) {
  const roles = {};
  const cols = Math.max(...rows.slice(0, 20).map((r) => r.length));
  for (let c = 0; c < cols; c++) {
    const vals = rows.slice(0, 20).map((r) => r[c] || '').filter(Boolean);
    if (!vals.length) continue;
    if (roles.date == null && vals.every((v) => parseDateLoose(v))) { roles.date = c; continue; }
    if (roles.amount == null && vals.every((v) => /^[-+(]?[\d\s.,'$€£₹¥]+\)?$/.test(v))) { roles.amount = c; continue; }
    if (roles.payee == null && vals.some((v) => /[A-Za-z]{3}/.test(v))) roles.payee = c;
  }
  return roles;
}

export function detectNumberStyle(values, locale) {
  let comma = 0, dot = 0;
  for (const v of values) {
    const s = String(v || '').replace(/[^\d.,]/g, '');
    if (/\d\.\d{3},\d{1,2}$/.test(s) || /^\d+,\d{1,2}$/.test(s)) comma++;
    else if (/\d,\d{3}\.\d{1,2}$/.test(s) || /^\d+\.\d{1,2}$/.test(s)) dot++;
  }
  if (comma > dot) return { group: '.', decimal: ',' };
  if (dot > comma) return { group: ',', decimal: '.' };
  return null;
}

export function detectDateStyle(values, dayFirstDefault) {
  const vals = values.filter(Boolean).slice(0, 200);
  const ok = (dayFirst) => vals.filter((v) => parseDateLoose(v, { dayFirst })).length;
  const a = ok(true);
  const b = ok(false);
  if (a === b) return dayFirstDefault;
  return a > b;
}

export function numberWith(raw, style) {
  return normalizeNumber(raw, null, style || undefined);
}

function titleCase(word) {
  if (word.length <= 2 || word.includes('.') || /[a-z]/.test(word) || !/[A-Z]/.test(word)) return word;
  return word.charAt(0) + word.slice(1).toLowerCase();
}

const CHANNEL = /^(upi|neft|imps|rtgs|pos|ach|ecom|vps|nach|mmt|tfr|trf|ib|mb|dc|cc|bil|onl|purchase|payment|pmt|debit|credit|card|txn|ref|utr|rrn)$/i;

export function cleanPayee(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  const raw = s.split(/[\s/|*]+/).flatMap((tok) => (/\d{5,}/.test(tok) && tok.includes('-') ? tok.split('-') : [tok]));
  const parts = [];
  for (let tok of raw) {
    if (!tok) continue;
    tok = tok.replace(/\.(com|net|org|in|co|io)(\.[a-z]{2})?$/i, '');
    if (!tok || tok.includes('.') && !/^[A-Za-z]\.[A-Za-z]\.?$/.test(tok)) continue;
    if (/^[\dX*#]{5,}$/i.test(tok) || /[A-Za-z]+\d{5,}/.test(tok)) continue;
    if (/^#?\d[\d-]*$/.test(tok) && tok.replace(/\D/g, '').length >= 2) continue;
    if (/^#\w+$/.test(tok)) continue;
    if (CHANNEL.test(tok)) continue;
    parts.push(tok);
  }
  const words = parts.length ? parts : s.split(' ').slice(0, 4);
  return words.map(titleCase).join(' ').replace(/^[,;:\-\s]+|[,;:\-\s]+$/g, '').slice(0, 80);
}

export function csvToRows(rows, opts) {
  const o = opts || {};
  const r = o.roles || {};
  const out = [];
  const errors = [];
  const data = rows.slice((o.headerIdx == null ? -1 : o.headerIdx) + 1);
  const style = o.numberStyle || null;
  data.forEach((row, i) => {
    if (!row.some((c) => String(c || '').trim())) return;
    const dateRaw = r.date != null ? row[r.date] : '';
    const date = parseDateLoose(dateRaw, { dayFirst: o.dayFirst, locale: o.locale });
    let amount = null;
    const num = (idx) => (idx == null || !String(row[idx] || '').trim() ? null : numberWith(row[idx], style));
    if (o.mode === 'debitcredit') {
      const d = num(r.debit);
      const c = num(r.credit);
      if (d && Number(d) !== 0) amount = '-' + d.replace(/^-/, '');
      else if (c && Number(c) !== 0) amount = c.replace(/^-/, '');
    } else if (o.mode === 'drcr') {
      const a = num(r.amount);
      const flag = String(row[r.drcr] || '').trim().toLowerCase();
      if (a) amount = /^(d|dr|debit|deb|withdrawal|s|out|-)/.test(flag) ? '-' + a.replace(/^-/, '') : a.replace(/^-/, '');
    } else if (o.mode === 'suffix') {
      const raw = String(row[r.amount] || '');
      const a = num(r.amount);
      if (a) amount = /\bcr\b/i.test(raw) ? a.replace(/^-/, '') : /\bdr\b/i.test(raw) ? '-' + a.replace(/^-/, '') : a;
    } else {
      amount = num(r.amount);
    }
    if (amount && o.invert) amount = amount.startsWith('-') ? amount.slice(1) : '-' + amount;
    const payeeRaw = r.payee != null ? row[r.payee] || '' : '';
    const item = {
      line: i + 1 + (o.headerIdx == null ? 0 : o.headerIdx + 1),
      date, amount, payee: cleanPayee(payeeRaw), memo: String(payeeRaw || '').slice(0, 300),
      ref: r.ref != null ? String(row[r.ref] || '').trim() : '', balance: num(r.balance),
      currency: r.currency != null && isCurrency(String(row[r.currency] || '').trim().toUpperCase()) ? String(row[r.currency]).trim().toUpperCase() : null
    };
    if (!date) errors.push({ line: item.line, reason: 'date', raw: dateRaw });
    else if (!amount || Number(amount) === 0) errors.push({ line: item.line, reason: 'amount', raw: row.join(' | ').slice(0, 80) });
    else out.push(item);
  });
  return { items: out, errors };
}

function ofxDate(v) {
  const m = String(v || '').match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) return null;
  const d = iso(+m[1], +m[2], +m[3]);
  return isISODate(d) ? d : null;
}

function tagVal(block, tag) {
  const m = block.match(new RegExp('<' + tag + '>([^<\\r\\n]*)', 'i'));
  return m ? m[1].trim() : '';
}

function decodeEntities(s) {
  return String(s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
}

export function parseOfx(text) {
  const src = String(text || '');
  const items = [];
  const re = /<STMTTRN>([\s\S]*?)(?:<\/STMTTRN>|(?=<STMTTRN>)|(?=<\/BANKTRANLIST>))/gi;
  let m;
  while ((m = re.exec(src))) {
    const b = m[1];
    const amount = normalizeNumber(tagVal(b, 'TRNAMT'), null, { group: ',', decimal: '.' });
    const date = ofxDate(tagVal(b, 'DTPOSTED')) || ofxDate(tagVal(b, 'DTUSER'));
    const name = decodeEntities(tagVal(b, 'NAME') || tagVal(b, 'PAYEE'));
    const memo = decodeEntities(tagVal(b, 'MEMO'));
    if (!date || !amount || Number(amount) === 0) continue;
    items.push({ date, amount, payee: cleanPayee(name || memo), memo: memo || name, ref: tagVal(b, 'FITID'), type: tagVal(b, 'TRNTYPE'), balance: null, currency: null });
  }
  const currency = tagVal(src, 'CURDEF') || null;
  const acctId = tagVal(src, 'ACCTID');
  const bal = tagVal(src.slice(src.search(/<LEDGERBAL>/i) >= 0 ? src.search(/<LEDGERBAL>/i) : src.length), 'BALAMT');
  const card = /<CCSTMTRS>/i.test(src);
  return { items, errors: [], currency: isCurrency(currency) ? currency : null, accountHint: acctId ? acctId.slice(-4) : '', closing: bal ? normalizeNumber(bal, null, { group: ',', decimal: '.' }) : null, card };
}

export function parseQif(text, dayFirst) {
  const items = [];
  let cur = {};
  let type = '';
  const flush = () => {
    if (cur.D && cur.T) {
      const date = parseDateLoose(cur.D.replace(/'/g, '/').replace(/\s/g, ''), { dayFirst });
      const amount = normalizeNumber(cur.T, null, /,\d{2}$/.test(cur.T) && !/\.\d{2}$/.test(cur.T) ? { group: '.', decimal: ',' } : { group: ',', decimal: '.' });
      if (date && amount && Number(amount) !== 0) items.push({ date, amount, payee: cleanPayee(cur.P || cur.M || ''), memo: cur.M || cur.P || '', ref: cur.N || '', category: cur.L || '', balance: null, currency: null });
    }
    cur = {};
  };
  for (const raw of String(text || '').split(/\r\n|\n|\r/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('!')) { flush(); if (/^!Type:/i.test(line)) type = line.slice(6).trim(); continue; }
    if (line === '^') { flush(); continue; }
    const k = line[0];
    const v = line.slice(1).trim();
    if (k === 'U' && !cur.T) cur.T = v;
    else if (k === 'T') cur.T = v;
    else if ('DPMNL'.includes(k)) cur[k] = v;
  }
  flush();
  return { items, errors: [], type };
}

export function parseCamt(text) {
  const doc = new DOMParser().parseFromString(String(text || ''), 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) return { items: [], errors: [{ line: 0, reason: 'xml' }] };
  const all = (el, tag) => Array.from(el.getElementsByTagNameNS('*', tag));
  const one = (el, tag) => all(el, tag)[0] || null;
  const txt = (el) => (el ? el.textContent.trim() : '');
  const items = [];
  let currency = null;
  for (const e of all(doc, 'Ntry')) {
    const amtEl = one(e, 'Amt');
    const amount = normalizeNumber(txt(amtEl), null, { group: ',', decimal: '.' });
    const ccy = amtEl ? amtEl.getAttribute('Ccy') : null;
    if (ccy && !currency) currency = ccy;
    const sign = txt(one(e, 'CdtDbtInd')) === 'DBIT' ? '-' : '';
    const bk = one(e, 'BookgDt') || one(e, 'ValDt');
    const date = bk ? (txt(one(bk, 'Dt')) || txt(one(bk, 'DtTm'))).slice(0, 10) : '';
    const dbit = sign === '-';
    const party = one(e, dbit ? 'Cdtr' : 'Dbtr') || one(e, 'Cdtr') || one(e, 'Dbtr');
    const name = party ? txt(one(party, 'Nm')) : '';
    const memo = all(e, 'Ustrd').map(txt).join(' ').trim() || txt(one(e, 'AddtlNtryInf'));
    const ref = txt(one(e, 'EndToEndId')) || txt(one(e, 'AcctSvcrRef')) || txt(one(e, 'NtryRef'));
    if (!isISODate(date) || !amount || Number(amount) === 0) continue;
    items.push({ date, amount: sign + amount.replace(/^-/, ''), payee: cleanPayee(name || memo), memo: memo || name, ref: ref === 'NOTPROVIDED' ? '' : ref, balance: null, currency: ccy && isCurrency(ccy) ? ccy : null });
  }
  return { items, errors: [], currency };
}

export async function itemId(accountId, item, seen) {
  const ref = String(item.ref || '').trim();
  const basis = ref && !seen.has('r:' + ref) ? 'r:' + ref : 'h:' + item.date + '|' + item.amount + '|' + String(item.memo || item.payee || '').toLowerCase().replace(/\s+/g, ' ').slice(0, 80) + '|' + (item.balance || '');
  let key = basis;
  let n = 1;
  while (seen.has(key)) { n++; key = basis + '#' + n; }
  seen.add(key);
  const bytes = new TextEncoder().encode(accountId + '|' + key);
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return 'imp:' + Array.from(d.slice(0, 12), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function headerSignature(header) {
  return header.map(norm).join('|').slice(0, 300);
}
