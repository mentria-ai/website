import * as U from '../ui.js';
import * as I from '../importers.js';
import * as R from '../rules.js';
import { toMinor, decimalsFor, convertMinor } from '../money.js';
import { dayFirstFor, diffDays } from '../dates.js';
import { sha256Hex } from '../crypto.js';
import { accountSheet } from './accounts.js';
import { openCategorize } from '../categorize.js';

const { h, t, icon } = U;
const MAX_BYTES = 12 * 1024 * 1024;

function resetFile(vs) {
  for (const k of ['file', 'name', 'text', 'format', 'csv', 'header', 'headerIdx', 'roles', 'mode', 'dayFirst', 'numberStyle', 'invert', 'parsed', 'preview', 'excluded', 'sha', 'bytes']) delete vs[k];
}

async function readFile(ctx, vs, file) {
  const L = ctx.ledger;
  if (file.size > MAX_BYTES) { U.toast(t('import.too_big')); return; }
  const buf = new Uint8Array(await file.arrayBuffer());
  let text = new TextDecoder('utf-8').decode(buf);
  if (/�/.test(text.slice(0, 4000))) { try { text = new TextDecoder('windows-1252').decode(buf); } catch (_) {} }
  resetFile(vs);
  vs.name = file.name;
  vs.bytes = file.size;
  vs.sha = await sha256Hex(buf);
  vs.text = text;
  vs.format = I.detectFormat(text, file.name);
  vs.excluded = new Set();
  if (vs.format === 'csv') {
    vs.csv = I.parseCsv(text);
    const idx = I.guessHeader(vs.csv.rows);
    vs.headerIdx = idx;
    vs.header = idx >= 0 ? vs.csv.rows[idx] : null;
    const preset = vs.header ? L.get('import_preset', await sha256Hex(I.headerSignature(vs.header))) : null;
    if (preset) {
      vs.roles = Object.assign({}, preset.roles);
      vs.mode = preset.mode;
      vs.dayFirst = preset.dayFirst;
      vs.numberStyle = preset.numberStyle || null;
      vs.invert = !!preset.invert;
      vs.presetUsed = true;
    } else {
      vs.roles = vs.header ? I.guessRoles(vs.header) : I.guessRolesFromData(vs.csv.rows);
      vs.mode = vs.roles.debit != null && vs.roles.credit != null ? 'debitcredit' : vs.roles.drcr != null && vs.roles.amount != null ? 'drcr' : 'amount';
      const body = vs.csv.rows.slice(idx + 1, idx + 201);
      const amtCols = [vs.roles.amount, vs.roles.debit, vs.roles.credit].filter((x) => x != null);
      const vals = [];
      for (const r of body) for (const c of amtCols) if (r[c]) vals.push(r[c]);
      vs.numberStyle = I.detectNumberStyle(vals);
      if (vs.mode === 'amount' && vals.some((v) => /\b(cr|dr)\b/i.test(v))) vs.mode = 'suffix';
      vs.dayFirst = I.detectDateStyle(body.map((r) => (vs.roles.date != null ? r[vs.roles.date] : '')), dayFirstFor(U.locale()));
      vs.invert = false;
      vs.presetUsed = false;
    }
  }
  vs.step = 'map';
  await buildPreview(ctx, vs);
  ctx.rerender();
}

function parseItems(vs) {
  if (vs.format === 'ofx') return I.parseOfx(vs.text);
  if (vs.format === 'qif') return I.parseQif(vs.text, dayFirstFor(U.locale()));
  if (vs.format === 'camt') return I.parseCamt(vs.text);
  return I.csvToRows(vs.csv.rows, { headerIdx: vs.headerIdx, roles: vs.roles, mode: vs.mode, dayFirst: vs.dayFirst, numberStyle: vs.numberStyle, invert: vs.invert, locale: U.locale() });
}

async function buildPreview(ctx, vs) {
  const L = ctx.ledger;
  const acct = L.get('account', vs.account);
  if (!acct) { vs.preview = null; return; }
  const parsed = parseItems(vs);
  vs.parsed = parsed;
  const seen = new Set();
  const rules = L.list('rule');
  const existing = (L.rowsByAccount().get(acct.id) || []).filter((r) => r.kind === 'txn' && !String(r.id).startsWith('imp:'));
  const d = decimalsFor(acct.currency);
  const out = [];
  for (const it of parsed.items) {
    const id = await I.itemId(acct.id, it, seen);
    let minor = null;
    try { minor = toMinor(it.amount, d); } catch (_) { minor = null; }
    if (minor == null || minor === 0) continue;
    const status = L.known('transaction', id) ? 'dup' : existing.some((r) => r.amount === minor && Math.abs(diffDays(r.date, it.date)) <= 1) ? 'maybe' : 'new';
    const ruled = R.apply(rules, { payee: it.payee, note: it.memo, amount_minor: minor, account: acct.id, category: null }).txn;
    const category = ruled.category || L.suggestCategory(ruled.payee || it.payee) || null;
    out.push({ id, item: it, minor, status, category, payee: ruled.payee || it.payee, tags: ruled.tags || [] });
  }
  vs.preview = out;
  if (!vs.excluded) vs.excluded = new Set();
  for (const p of out) if (p.status === 'maybe') vs.excluded.add(p.id);
}

function colSelect(vs, role, label, header) {
  const cols = header || (vs.csv.rows[Math.max(0, vs.headerIdx + 1)] || []).map((_, i) => t('import.column', { n: i + 1 }));
  const opts = [{ value: '', label: t('import.none') }].concat(cols.map((c, i) => ({ value: String(i), label: header ? c : t('import.column', { n: i + 1 }) })));
  return U.field(label, U.select(opts, vs.roles[role] != null ? String(vs.roles[role]) : '', { onchange: (e) => { vs.roles[role] = e.target.value === '' ? null : Number(e.target.value); vs.dirty = true; } }));
}

function mappingPanel(ctx, vs) {
  const header = vs.header;
  const box = h('div', { class: 'fcard', style: { marginBottom: '14px' } });
  box.append(h('div', { class: 'fcard__head' }, h('h2', { class: 'fcard__title' }, t('import.mapping')), vs.presetUsed ? h('span', { class: 'fpill fpill--mint' }, t('import.preset_used')) : null));
  const mode = U.select(['amount', 'debitcredit', 'drcr', 'suffix'].map((m) => ({ value: m, label: t('import.mode.' + m) })), vs.mode, { onchange: (e) => { vs.mode = e.target.value; vs.dirty = true; ctx.rerender(); } });
  const grid = h('div', { class: 'ff-grid' }, colSelect(vs, 'date', t('import.role.date'), header), colSelect(vs, 'payee', t('import.role.payee'), header), U.field(t('import.amount_mode'), mode));
  if (vs.mode === 'debitcredit') grid.append(colSelect(vs, 'debit', t('import.role.debit'), header), colSelect(vs, 'credit', t('import.role.credit'), header));
  else grid.append(colSelect(vs, 'amount', t('import.role.amount'), header));
  if (vs.mode === 'drcr') grid.append(colSelect(vs, 'drcr', t('import.role.drcr'), header));
  grid.append(colSelect(vs, 'ref', t('import.role.ref'), header), colSelect(vs, 'balance', t('import.role.balance'), header));
  const dateSel = U.select([{ value: 'd', label: t('import.date_dmy') }, { value: 'm', label: t('import.date_mdy') }], vs.dayFirst ? 'd' : 'm', { onchange: (e) => { vs.dayFirst = e.target.value === 'd'; vs.dirty = true; } });
  const styleKey = vs.numberStyle ? (vs.numberStyle.decimal === ',' ? (vs.numberStyle.group === '.' ? 'comma' : 'spacecomma') : 'dot') : 'auto';
  const numSel = U.select([{ value: 'auto', label: t('import.num_auto') }, { value: 'dot', label: '1,234.56' }, { value: 'comma', label: '1.234,56' }, { value: 'spacecomma', label: '1 234,56' }], styleKey, { onchange: (e) => {
    const v = e.target.value;
    vs.numberStyle = v === 'dot' ? { group: ',', decimal: '.' } : v === 'comma' ? { group: '.', decimal: ',' } : v === 'spacecomma' ? { group: ' ', decimal: ',' } : null;
    vs.dirty = true;
  } });
  grid.append(U.field(t('import.date_order'), dateSel), U.field(t('import.number_style'), numSel));
  box.append(grid, U.checkbox(t('import.invert'), !!vs.invert, (v) => { vs.invert = v; vs.dirty = true; }));
  const hdrSel = U.select(vs.csv.rows.slice(0, 40).map((r, i) => ({ value: String(i), label: t('import.row', { n: i + 1 }) + ': ' + r.join(' | ').slice(0, 60) })).concat([{ value: '-1', label: t('import.no_header') }]), String(vs.headerIdx), { onchange: (e) => {
    vs.headerIdx = Number(e.target.value);
    vs.header = vs.headerIdx >= 0 ? vs.csv.rows[vs.headerIdx] : null;
    vs.roles = vs.header ? I.guessRoles(vs.header) : I.guessRolesFromData(vs.csv.rows);
    vs.dirty = true;
    ctx.rerender();
  } });
  box.append(h('details', { style: { marginTop: '8px' } }, h('summary', { style: { cursor: 'pointer', color: 'var(--f-muted)', fontSize: '0.86rem' } }, t('import.header_row')), h('div', { style: { marginTop: '8px' } }, hdrSel)));
  box.append(h('div', { class: 'fb-row', style: { marginTop: '12px' } }, h('button', { type: 'button', class: 'fb fb--sm', onclick: async () => { await buildPreview(ctx, vs); vs.dirty = false; ctx.rerender(); } }, icon('sync'), t('import.refresh'))));
  return box;
}

function previewPanel(ctx, vs) {
  const L = ctx.ledger;
  const acct = L.get('account', vs.account);
  const node = h('div');
  const pv = vs.preview || [];
  const counts = { new: 0, dup: 0, maybe: 0 };
  for (const p of pv) counts[p.status]++;
  const take = pv.filter((p) => p.status !== 'dup' && !vs.excluded.has(p.id));
  const errs = (vs.parsed && vs.parsed.errors) || [];
  node.append(h('div', { class: 'fstats fstats--4', style: { margin: '4px 0 12px' } },
    h('div', { class: 'fstat' }, h('span', { class: 'fstat__label' }, t('import.found')), h('span', { class: 'fmid' }, U.fmtInt(pv.length))),
    h('div', { class: 'fstat' }, h('span', { class: 'fstat__label' }, t('import.new')), h('span', { class: 'fmid amt--in' }, U.fmtInt(counts.new))),
    h('div', { class: 'fstat' }, h('span', { class: 'fstat__label' }, t('import.dups')), h('span', { class: 'fmid' }, U.fmtInt(counts.dup))),
    h('div', { class: 'fstat' }, h('span', { class: 'fstat__label' }, t('import.maybe')), h('span', { class: 'fmid amt--warn' }, U.fmtInt(counts.maybe)))));
  if (vs.dirty) node.append(h('div', { class: 'fbanner' }, icon('info'), h('span', null, t('import.dirty'))));
  if (!pv.length) node.append(U.empty(t('import.nothing')));
  else {
    const catOpts = [{ value: '', label: t('ledger.uncategorized') }].concat(L.leafCategories().map((c) => ({ value: c.id, label: c.name })));
    const tbl = h('table', { class: 'ftable' }, h('thead', null, h('tr', null, h('th', null, ''), h('th', null, t('csv.date')), h('th', null, t('csv.payee')), h('th', null, t('csv.category')), h('th', { class: 'n' }, t('csv.amount')))));
    const tb = h('tbody');
    for (const p of pv.slice(0, vs.showAll ? pv.length : 60)) {
      const dup = p.status === 'dup';
      const box = h('input', { type: 'checkbox', checked: !dup && !vs.excluded.has(p.id), disabled: dup, 'aria-label': t('import.include'), onchange: (e) => { if (e.target.checked) vs.excluded.delete(p.id); else vs.excluded.add(p.id); } });
      tb.append(h('tr', { style: { opacity: dup ? 0.45 : 1 } },
        h('td', null, box),
        h('td', { style: { whiteSpace: 'nowrap' } }, U.date(p.item.date, 'dayMonth')),
        h('td', null, h('span', { class: 'fwrap' }, p.payee || p.item.memo || '—'), dup ? h('span', { class: 'fpill', style: { marginLeft: '6px' } }, t('import.already')) : p.status === 'maybe' ? h('span', { class: 'fpill fpill--amber', style: { marginLeft: '6px' } }, t('import.maybe_short')) : null),
        h('td', null, dup ? '' : U.select(catOpts, p.category || '', { style: { minHeight: '34px', padding: '4px 30px 4px 8px', fontSize: '13px' }, onchange: (e) => { p.category = e.target.value || null; } })),
        h('td', { class: 'n ' + (p.minor > 0 ? 'amt--in' : '') }, U.signedMoney(p.minor, acct.currency))));
    }
    tbl.append(tb);
    node.append(h('div', { class: 'ftable-wrap' }, tbl));
    if (pv.length > 60 && !vs.showAll) node.append(h('button', { type: 'button', class: 'fb fb--sm', style: { marginTop: '10px' }, onclick: () => { vs.showAll = true; ctx.rerender(); } }, t('import.show_all', { n: U.fmtInt(pv.length) })));
  }
  if (errs.length) node.append(h('details', { style: { marginTop: '12px' } }, h('summary', { style: { cursor: 'pointer', color: 'var(--f-warn)', fontSize: '0.86rem' } }, U.tp('import.skipped_rows', errs.length)), h('ul', { class: 'fsmall fmuted' }, errs.slice(0, 30).map((e) => h('li', null, t('import.err_' + (e.reason === 'date' ? 'date' : e.reason === 'xml' ? 'xml' : 'amount'), { line: e.line, raw: e.raw || '' }))))));
  const go = h('button', { type: 'button', class: 'fb fb--primary', disabled: !take.length || !ctx.writer }, U.tp('import.go', take.length));
  go.addEventListener('click', () => doImport(ctx, vs, take));
  node.append(h('div', { class: 'fb-row fb-row--end', style: { marginTop: '16px' } }, h('button', { type: 'button', class: 'fb', onclick: () => { resetFile(vs); vs.step = 'pick'; ctx.rerender(); } }, t('common.cancel')), go));
  return node;
}

async function doImport(ctx, vs, take) {
  const L = ctx.ledger;
  const acct = L.get('account', vs.account);
  const base = L.base();
  const batch = ctx.newId();
  const now = new Date().toISOString();
  const ops = [];
  let rate = null;
  if (acct.currency !== base) rate = L.rateE6(acct.currency, base);
  for (const p of take) {
    const fields = {
      date: p.item.date, amount_minor: p.minor, currency: acct.currency, account: acct.id, category: p.category || null,
      payee: (p.payee || '').slice(0, 120), note: p.item.memo && p.item.memo !== p.payee ? String(p.item.memo).slice(0, 300) : '', tags: p.tags || [],
      kind: p.minor > 0 ? 'income' : 'expense', cleared: true, created: now, provenance: 'import', import_batch: batch, import_ref: p.item.ref || null
    };
    if (acct.currency === base) fields.base_minor = p.minor;
    else if (rate) { fields.base_minor = convertMinor(p.minor, acct.currency, base, rate); fields.fx_rate_e6 = rate; }
    ops.push(...ctx.engine.createOps('transaction', p.id, fields));
  }
  ops.push(...ctx.engine.createOps('import_batch', batch, { source: vs.name, format: vs.format, sha256: vs.sha, bytes: vs.bytes, account: acct.id, row_count: (vs.preview || []).length, imported_count: take.length, skipped_count: (vs.preview || []).length - take.length, created: now }));
  if (vs.format === 'csv' && vs.header) {
    ops.push(...ctx.save('import_preset', await sha256Hex(I.headerSignature(vs.header)), { roles: vs.roles, mode: vs.mode, dayFirst: vs.dayFirst, numberStyle: vs.numberStyle, invert: !!vs.invert, header: vs.header.slice(0, 30).map((x) => String(x).slice(0, 40)) }));
  }
  const ok = await ctx.commit(ops);
  if (ok) {
    resetFile(vs);
    vs.step = 'pick';
    ctx.rerender();
    const unc = take.filter((p) => !p.category).length;
    U.toast(U.tp('import.done', take.length), unc ? { ms: 10000, action: { label: t('categorize.sort'), run: () => openCategorize(ctx) } } : null);
  }
}

function batchesPanel(ctx) {
  const L = ctx.ledger;
  const batches = L.list('import_batch').sort((a, b) => String(b.created).localeCompare(String(a.created)));
  if (!batches.length) return null;
  const node = h('div');
  node.append(h('div', { class: 'fsection' }, h('h2', null, t('import.history'))));
  for (const b of batches.slice(0, 20)) {
    const acct = L.get('account', b.account);
    const live = L.list('transaction').filter((x) => x.import_batch === b.id);
    node.append(h('div', { class: 'frow frow--static' },
      U.mono('', '#22d3ee', true, 'import'),
      h('span', { class: 'frow__main' }, h('span', { class: 'frow__title' }, b.source || '—'), h('span', { class: 'frow__meta' }, U.date(String(b.created).slice(0, 10)) + ' · ' + (acct ? acct.name : '—') + ' · ' + U.tp('import.batch_rows', live.length))),
      live.length ? h('button', { type: 'button', class: 'fb fb--sm', onclick: async () => {
        const ok = await U.confirmDialog({ title: t('import.undo_title'), body: U.tp('import.undo_body', live.length), ok: t('import.undo_ok'), danger: true });
        if (!ok) return;
        const ops = [];
        for (const x of live) ops.push(...ctx.engine.removeOps('transaction', x.id));
        ctx.commit(ops, U.tp('import.undone', live.length));
      } }, t('import.undo')) : h('span', { class: 'fpill' }, t('import.reverted'))));
  }
  return node;
}

export function render(ctx) {
  const L = ctx.ledger;
  const vs = ctx.viewState;
  if (!vs.step) vs.step = 'pick';
  if (!vs.account || !L.exists('account', vs.account)) vs.account = L.lastAccount();
  const node = h('div');
  const acctSel = U.select(L.accounts().map((a) => ({ value: a.id, label: a.name + ' · ' + a.currency })), vs.account || '', { onchange: async (e) => { vs.account = e.target.value; if (vs.text) { await buildPreview(ctx, vs); } ctx.rerender(); } });
  node.append(h('div', { class: 'ftool' }, h('div', { style: { flex: '1 1 260px' } }, U.field(t('import.into'), acctSel)), h('button', { type: 'button', class: 'fb fb--sm', style: { alignSelf: 'flex-end' }, onclick: () => accountSheet(ctx, null) }, icon('plus'), t('accounts.add'))));
  if (vs.step === 'pick' || !vs.text) {
    const input = h('input', { type: 'file', accept: '.csv,.tsv,.txt,.ofx,.qfx,.qif,.xml,text/csv,application/xml', hidden: true, onchange: (e) => { const f = e.target.files && e.target.files[0]; if (f) readFile(ctx, vs, f); } });
    const drop = h('div', { class: 'fdrop', role: 'button', tabindex: '0', onclick: () => input.click(), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } } },
      icon('import'), h('strong', { style: { color: 'var(--f-fg)' } }, t('import.drop')), h('span', { class: 'fsmall' }, t('import.formats')), input);
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('is-over'); const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) readFile(ctx, vs, f); });
    node.append(drop, h('p', { class: 'ff__hint', style: { marginTop: '10px', maxWidth: '64ch' } }, t('import.privacy')));
  } else {
    node.append(h('div', { class: 'fb-row', style: { marginBottom: '12px' } }, h('span', { class: 'fpill fpill--mint' }, vs.format.toUpperCase()), h('span', { class: 'fsmall fmuted fwrap' }, vs.name)));
    if (vs.format === 'csv') node.append(mappingPanel(ctx, vs));
    node.append(previewPanel(ctx, vs));
  }
  const b = batchesPanel(ctx);
  if (b) node.append(b);
  return { title: t('nav.import'), node };
}
