export const OPS = ['contains', 'is', 'starts', 'matches', 'oneOf', 'gt', 'lt', 'between', 'approx'];
export const FIELDS = ['payee', 'note', 'amount', 'account'];
export const ACTIONS = ['category', 'payee', 'tag', 'note'];

function textOf(txn, field) {
  if (field === 'payee') return String(txn.payee || '');
  if (field === 'note') return String(txn.note || '');
  if (field === 'account') return String(txn.account || '');
  return '';
}

function safeRegex(src) {
  if (typeof src !== 'string' || src.length > 120) return null;
  if (/(\([^)]*[+*][^)]*\))[+*{]/.test(src)) return null;
  try { return new RegExp(src, 'i'); } catch (_) { return null; }
}

export function test(cond, txn) {
  if (!cond || !cond.field) return false;
  if (cond.field === 'amount') {
    const a = Math.abs(txn.amount_minor || 0);
    const v = Math.abs(Number(cond.value) || 0);
    if (cond.op === 'gt') return a > v;
    if (cond.op === 'lt') return a < v;
    if (cond.op === 'is') return a === v;
    if (cond.op === 'between') return a >= Math.abs(Number(cond.value) || 0) && a <= Math.abs(Number(cond.value2) || 0);
    if (cond.op === 'approx') return v > 0 && Math.abs(a - v) <= v * 0.075;
    return false;
  }
  const hay = textOf(txn, cond.field).toLowerCase();
  const val = String(cond.value || '').toLowerCase();
  if (cond.op === 'is') return hay === val;
  if (cond.op === 'contains') return !!val && hay.includes(val);
  if (cond.op === 'starts') return !!val && hay.startsWith(val);
  if (cond.op === 'oneOf') return val.split('|').map((x) => x.trim()).filter(Boolean).includes(hay);
  if (cond.op === 'matches') { const re = safeRegex(cond.value); return !!(re && re.test(textOf(txn, cond.field))); }
  return false;
}

export function matches(rule, txn) {
  if (!rule || rule.enabled === false) return false;
  const conds = Array.isArray(rule.conditions) ? rule.conditions : [];
  if (!conds.length) return false;
  return rule.conditions_op === 'any' ? conds.some((c) => test(c, txn)) : conds.every((c) => test(c, txn));
}

export function apply(rules, txn, opts) {
  const o = opts || {};
  const out = Object.assign({}, txn);
  const applied = [];
  const list = (rules || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  for (const r of list) {
    if (!matches(r, out)) continue;
    for (const act of r.actions || []) {
      if (act.type === 'category' && act.value && (!out.category || o.override)) out.category = act.value;
      else if (act.type === 'payee' && act.value) out.payee = act.value;
      else if (act.type === 'tag' && act.value) out.tags = Array.from(new Set((out.tags || []).concat([String(act.value)])));
      else if (act.type === 'note' && act.value && !out.note) out.note = act.value;
    }
    applied.push(r.id);
    if (r.stop) break;
  }
  return { txn: out, applied };
}
