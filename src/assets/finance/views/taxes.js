import * as U from '../ui.js';
import * as T from '../tax.js';
import { isISODate } from '../dates.js';

const { h, t, icon } = U;

function pctIn(bp) { return bp == null ? '' : String(bp / 100); }
function bpFrom(v) { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? Math.round(n * 100) : null; }

function bracketEditor(rows, ccy, onChange) {
  const box = h('div', { class: 'fstack' });
  const draw = () => {
    box.replaceChildren();
    const tbl = h('table', { class: 'ftable' }, h('thead', null, h('tr', null, h('th', null, t('taxes.from')), h('th', null, t('taxes.to')), h('th', null, t('taxes.rate')), h('th', null, ''))));
    const tb = h('tbody');
    rows.forEach((r, i) => {
      tb.append(h('tr', null,
        h('td', null, U.moneyField({ value: U.amountToInput(r[0], ccy), oninput: (e) => { r[0] = Math.abs(U.parseAmount(e.target.value, ccy) || 0); onChange(); } })),
        h('td', null, U.moneyField({ value: r[1] == null ? '' : U.amountToInput(r[1], ccy), placeholder: t('taxes.no_limit'), oninput: (e) => { r[1] = e.target.value.trim() ? Math.abs(U.parseAmount(e.target.value, ccy) || 0) : null; onChange(); } })),
        h('td', null, U.input({ value: pctIn(r[2]), inputmode: 'decimal', style: { maxWidth: '90px' }, oninput: (e) => { r[2] = bpFrom(e.target.value) || 0; onChange(); } })),
        h('td', null, h('button', { type: 'button', class: 'fb fb--ghost fb--icon', 'aria-label': t('common.remove'), onclick: () => { rows.splice(i, 1); draw(); onChange(); } }, icon('close')))));
    });
    tbl.append(tb);
    box.append(h('div', { class: 'ftable-wrap' }, tbl), h('button', { type: 'button', class: 'fb fb--sm', style: { alignSelf: 'flex-start' }, onclick: () => { const last = rows[rows.length - 1]; rows.push([last ? last[1] || last[0] : 0, null, last ? last[2] : 0]); if (last && last[1] == null) last[1] = last[0]; draw(); onChange(); } }, icon('plus'), t('taxes.add_band')));
  };
  draw();
  return box;
}

function listEditor(items, ccy, labelKey, onChange) {
  const box = h('div', { class: 'fstack' });
  const draw = () => {
    box.replaceChildren();
    items.forEach((a, i) => box.append(h('div', { class: 'fsplit' },
      U.input({ value: a.name || '', placeholder: t(labelKey), oninput: (e) => { a.name = e.target.value; onChange(); } }),
      U.moneyField({ value: U.amountToInput(a.amount_minor || 0, ccy), oninput: (e) => { a.amount_minor = Math.abs(U.parseAmount(e.target.value, ccy) || 0); onChange(); } }),
      h('button', { type: 'button', class: 'fb fb--ghost fb--icon', 'aria-label': t('common.remove'), onclick: () => { items.splice(i, 1); draw(); onChange(); } }, icon('close')))));
    box.append(h('button', { type: 'button', class: 'fb fb--sm', style: { alignSelf: 'flex-start' }, onclick: () => { items.push({ name: '', amount_minor: 0 }); draw(); onChange(); } }, icon('plus'), t('taxes.add_item')));
  };
  draw();
  return box;
}

export function profileSheet(ctx, prof) {
  const L = ctx.ledger;
  const p = JSON.parse(JSON.stringify(prof));
  const ccy = p.currency || L.base();
  const changed = () => {};
  const label = U.input({ value: p.label || '', maxlength: '60' });
  const start = U.input({ value: p.year_start || '01-01', maxlength: '5', placeholder: 'MM-DD' });
  const cgMethod = U.select(['ordinary', 'flat', 'brackets'].map((m) => ({ value: m, label: t('taxes.cg_method.' + m) })), (p.cg && p.cg.method) || 'ordinary');
  p.cg = Object.assign({ long_term_months: 12, lt_brackets: [[0, null, 0]], exemption_minor: 0, loss_offset_cap_minor: null, wash_sale_days: 0 }, p.cg || {});
  const ltMonths = h('input', { class: 'fi', type: 'number', min: '0', max: '120', value: String(p.cg.long_term_months || 12) });
  const ltRate = U.input({ value: pctIn(p.cg.lt_rate_bp), inputmode: 'decimal', placeholder: '%' });
  const stRate = U.input({ value: pctIn(p.cg.st_rate_bp), inputmode: 'decimal', placeholder: t('taxes.as_income') });
  const exempt = U.moneyField({ value: U.amountToInput(p.cg.exemption_minor || 0, ccy) });
  const lossCap = U.moneyField({ value: p.cg.loss_offset_cap_minor == null ? '' : U.amountToInput(p.cg.loss_offset_cap_minor, ccy), placeholder: t('taxes.no_limit') });
  const wash = h('input', { class: 'fi', type: 'number', min: '0', max: '90', value: String(p.cg.wash_sale_days || 0) });
  const ltBox = h('div', null, bracketEditor(p.cg.lt_brackets || (p.cg.lt_brackets = [[0, null, 0]]), ccy, changed));
  const flatBox = h('div', { class: 'ff-grid' }, U.field(t('taxes.lt_rate'), ltRate));
  const syncCg = () => { ltBox.hidden = cgMethod.value !== 'brackets'; flatBox.hidden = cgMethod.value !== 'flat'; };
  cgMethod.addEventListener('change', syncCg);
  syncCg();
  const divT = U.select([{ value: 'ordinary', label: t('taxes.treat_ordinary') }, { value: 'flat', label: t('taxes.treat_flat') }], (p.dividends && p.dividends.treatment) || 'ordinary');
  const divR = U.input({ value: pctIn(p.dividends && p.dividends.rate_bp), inputmode: 'decimal', placeholder: '%' });
  const intT = U.select([{ value: 'ordinary', label: t('taxes.treat_ordinary') }, { value: 'flat', label: t('taxes.treat_flat') }], (p.interest && p.interest.treatment) || 'ordinary');
  const intR = U.input({ value: pctIn(p.interest && p.interest.rate_bp), inputmode: 'decimal', placeholder: '%' });
  const social = U.input({ value: pctIn(p.social_bp || 0), inputmode: 'decimal' });
  const payBox = h('div', { class: 'fstack' });
  p.payments = p.payments || [];
  const drawPay = () => {
    payBox.replaceChildren();
    p.payments.forEach((row, i) => payBox.append(h('div', { class: 'fsplit' },
      U.input({ value: row[0], placeholder: 'MM-DD', maxlength: '5', oninput: (e) => { row[0] = e.target.value.trim(); } }),
      U.input({ value: pctIn(row[1]), inputmode: 'decimal', placeholder: t('taxes.cumulative_pct'), oninput: (e) => { row[1] = bpFrom(e.target.value) || 0; } }),
      h('button', { type: 'button', class: 'fb fb--ghost fb--icon', 'aria-label': t('common.remove'), onclick: () => { p.payments.splice(i, 1); drawPay(); } }, icon('close')))));
    payBox.append(h('button', { type: 'button', class: 'fb fb--sm', style: { alignSelf: 'flex-start' }, onclick: () => { p.payments.push(['12-31', 10000]); drawPay(); } }, icon('plus'), t('taxes.add_payment')));
  };
  drawPay();
  const payCats = h('div', { class: 'fchips' });
  const sel = new Set(p.payment_categories || []);
  for (const c of L.leafCategories('expense')) {
    const b = h('button', { type: 'button', class: 'fchip' + (sel.has(c.id) ? ' is-on' : ''), onclick: () => { if (sel.has(c.id)) sel.delete(c.id); else sel.add(c.id); b.classList.toggle('is-on'); } }, c.name);
    payCats.append(b);
  }
  const verified = h('input', { class: 'fi', type: 'date', value: p.verified_on || '' });
  const source = U.input({ value: p.source_url || '', type: 'url', placeholder: 'https://' });
  const notes = h('textarea', { class: 'fta', maxlength: '1000' }, p.notes || '');
  const err = h('p', { class: 'ff__err', role: 'alert' });
  const sec = (title, ...kids) => h('section', { class: 'fstack', style: { padding: '12px 0', borderTop: '1px solid var(--f-line)' } }, h('h3', { style: { fontSize: '0.95rem' } }, title), ...kids);
  const save = h('button', { type: 'button', class: 'fb fb--primary' }, t('common.save'));
  const sh = U.sheet({
    title: t('taxes.edit_profile', { year: p.tax_year }), wide: true,
    body: h('div', { class: 'fstack' },
      p.example ? h('div', { class: 'fbanner fbanner--pink' }, icon('alert'), h('span', null, t('taxes.example_banner'))) : null,
      h('div', { class: 'ff-grid' }, U.field(t('taxes.label'), label), U.field(t('taxes.year_start'), start, t('taxes.year_start_hint'))),
      sec(t('taxes.income_bands'), h('p', { class: 'ff__hint' }, t('taxes.bands_hint', { ccy })), bracketEditor(p.brackets = p.brackets || [], ccy, changed)),
      sec(t('taxes.allowances'), h('p', { class: 'ff__hint' }, t('taxes.allowances_hint')), listEditor(p.allowances = p.allowances || [], ccy, 'taxes.allowance_name', changed)),
      sec(t('taxes.gains'), h('div', { class: 'ff-grid' }, U.field(t('taxes.cg_method_label'), cgMethod), U.field(t('taxes.long_term'), ltMonths, t('taxes.long_term_hint'))), flatBox, ltBox,
        h('div', { class: 'ff-grid' }, U.field(t('taxes.st_rate'), stRate, t('taxes.st_rate_hint')), U.field(t('taxes.exemption'), exempt), U.field(t('taxes.loss_cap'), lossCap, t('taxes.loss_cap_hint')), U.field(t('taxes.wash'), wash, t('taxes.wash_hint')))),
      sec(t('taxes.div_int'), h('div', { class: 'ff-grid' }, U.field(t('taxes.dividends'), divT), U.field(t('taxes.div_rate'), divR), U.field(t('taxes.interest'), intT), U.field(t('taxes.int_rate'), intR)), U.field(t('taxes.social'), social, t('taxes.social_hint'))),
      sec(t('taxes.credits'), listEditor(p.credits = p.credits || [], ccy, 'taxes.credit_name', changed)),
      sec(t('taxes.carry'), h('p', { class: 'ff__hint' }, t('taxes.carry_hint')), listEditor(p.carry_forward = (p.carry_forward || []).map((c) => ({ name: c.name || String(c.year || ''), amount_minor: c.amount_minor })), ccy, 'taxes.carry_name', changed)),
      sec(t('taxes.payments'), h('p', { class: 'ff__hint' }, t('taxes.payments_hint')), payBox, h('span', { class: 'ff__label' }, t('taxes.pay_cats')), payCats),
      sec(t('taxes.source_title'), h('div', { class: 'ff-grid' }, U.field(t('taxes.verified_on'), verified), U.field(t('taxes.source_url'), source)), h('p', { class: 'ff__hint' }, t('taxes.source_hint')), U.field(t('taxes.notes'), notes)),
      err),
    foot: [h('button', { type: 'button', class: 'fb', onclick: () => sh.close() }, t('common.cancel')), save]
  });
  save.addEventListener('click', () => {
    if (!/^\d{2}-\d{2}$/.test(start.value.trim())) { err.textContent = t('taxes.err_start'); return; }
    p.label = label.value.trim().slice(0, 60);
    p.year_start = start.value.trim();
    p.cg.method = cgMethod.value;
    p.cg.long_term_months = Math.max(0, parseInt(ltMonths.value, 10) || 0);
    p.cg.lt_rate_bp = bpFrom(ltRate.value);
    p.cg.st_rate_bp = stRate.value.trim() ? bpFrom(stRate.value) : null;
    p.cg.exemption_minor = Math.abs(U.parseAmount(exempt.value, ccy) || 0);
    p.cg.loss_offset_cap_minor = lossCap.value.trim() ? Math.abs(U.parseAmount(lossCap.value, ccy) || 0) : null;
    p.cg.wash_sale_days = Math.max(0, parseInt(wash.value, 10) || 0);
    p.dividends = { treatment: divT.value, rate_bp: bpFrom(divR.value) };
    p.interest = { treatment: intT.value, rate_bp: bpFrom(intR.value) };
    p.social_bp = bpFrom(social.value) || 0;
    p.payment_categories = Array.from(sel);
    p.verified_on = isISODate(verified.value) ? verified.value : null;
    p.source_url = /^https?:\/\//.test(source.value.trim()) ? source.value.trim().slice(0, 300) : null;
    p.notes = notes.value.trim().slice(0, 1000);
    p.example = !(p.verified_on && p.source_url) && !!p.example;
    p.brackets = p.brackets.filter((b) => b && b[2] != null).sort((a, b) => a[0] - b[0]);
    p.carry_forward = (p.carry_forward || []).filter((c) => c.amount_minor).map((c) => ({ type: 'loss', year: c.name, amount_minor: c.amount_minor }));
    const id = 'taxp:' + p.tax_year;
    const fields = Object.assign({}, p);
    delete fields.id;
    sh.close();
    ctx.commit(ctx.save('tax_profile', id, fields), t('taxes.saved'));
  });
}

function createProfile(ctx, year) {
  const L = ctx.ledger;
  const prev = L.get('tax_profile', 'taxp:' + (year - 1));
  const node = h('div', { class: 'fempty' },
    h('p', null, t('taxes.none', { year })),
    h('p', { class: 'fsmall' }, t('taxes.none_body')),
    h('div', { class: 'fb-row' },
      prev ? h('button', { type: 'button', class: 'fb fb--primary', onclick: () => { const p = Object.assign({}, prev, { tax_year: String(year), label: prev.label }); delete p.id; profileSheet(ctx, p); } }, t('taxes.copy_prev', { year: year - 1 })) : null,
      h('button', { type: 'button', class: prev ? 'fb' : 'fb fb--primary', onclick: () => profileSheet(ctx, Object.assign(T.exampleProfile(year, L.base()), { label: t('taxes.example_label') })) }, t('taxes.start_example'))));
  return node;
}

function exportCsv(ctx, est) {
  const ccy = est.currency;
  const d = U.decimalsOf(ccy);
  const num = (m) => (m / 10 ** d).toFixed(d);
  const rows = [[t('taxes.csv_item'), t('csv.amount'), t('csv.currency')]];
  for (const s of T.SOURCES) rows.push([t('taxes.source.' + s), num(est.income[s]), ccy]);
  rows.push([t('taxes.allowances'), num(-est.allowances), ccy], [t('taxes.taxable'), num(est.taxable), ccy], [t('taxes.ordinary_tax'), num(est.ordinaryTax), ccy], [t('taxes.cg_tax'), num(est.cgTax), ccy], [t('taxes.social'), num(est.social), ccy], [t('taxes.credits'), num(-est.credits), ccy], [t('taxes.withheld'), num(-est.withheld), ccy], [t('taxes.liability'), num(est.liability), ccy], [t('taxes.paid'), num(est.paid), ccy]);
  rows.push([], [t('csv.date'), t('taxes.instrument'), t('taxes.proceeds'), t('taxes.cost'), t('taxes.gain'), t('taxes.term')]);
  for (const g of est.realized) rows.push([g.date, g.instrument, num(g.proceeds), num(g.cost), num(g.gain), t('taxes.term_' + g.term)]);
  U.downloadBlob('mentria-finance-tax-' + est.range.start.slice(0, 4) + '.csv', new Blob([U.csv(rows)], { type: 'text/csv;charset=utf-8' }));
}

export function render(ctx) {
  const L = ctx.ledger;
  const vs = ctx.viewState;
  if (!vs.year) vs.year = parseInt(L.today().slice(0, 4), 10);
  const node = h('div');
  node.append(h('div', { class: 'fbanner' }, icon('info'), h('span', null, t('taxes.disclaimer'))));
  const top = h('div', { class: 'fmonth' },
    h('button', { type: 'button', class: 'fb fb--ghost fb--icon', 'aria-label': t('common.previous'), onclick: () => { vs.year--; ctx.rerender(); } }, icon('back')),
    h('span', { class: 'fmonth__label fsmall', style: { minWidth: '64px' } }, t('taxes.year_label', { year: vs.year })),
    h('button', { type: 'button', class: 'fb fb--ghost fb--icon', 'aria-label': t('common.next'), onclick: () => { vs.year++; ctx.rerender(); } }, icon('next')));
  const prof = L.get('tax_profile', 'taxp:' + vs.year);
  if (!prof) { node.append(createProfile(ctx, vs.year)); return { title: t('nav.taxes'), node, top }; }
  if (prof.example && !(prof.verified_on && prof.source_url)) node.append(h('div', { class: 'fbanner fbanner--pink' }, icon('alert'), h('span', null, t('taxes.example_banner')), h('button', { type: 'button', class: 'fb fb--sm', onclick: () => profileSheet(ctx, prof) }, t('taxes.edit'))));
  const est = T.estimate(L, prof);
  const ccy = est.currency;
  const m = (v) => U.money(v, ccy);
  node.append(h('div', { class: 'fcard', style: { marginBottom: '14px' } },
    h('div', { class: 'fcard__head' }, h('h2', { class: 'fcard__title' }, prof.label || t('taxes.year_label', { year: vs.year })), h('div', { class: 'fb-row' }, h('button', { type: 'button', class: 'fb fb--sm', onclick: () => exportCsv(ctx, est) }, icon('download'), t('ledger.csv')), h('button', { type: 'button', class: 'fb fb--sm', onclick: () => profileSheet(ctx, prof) }, icon('edit'), t('taxes.edit')))),
    h('p', { class: 'fsmall fmuted' }, U.date(est.range.start) + ' – ' + U.date(est.range.end)),
    h('div', { class: 'fstats fstats--4', style: { marginTop: '12px' } },
      h('div', { class: 'fstat' }, h('span', { class: 'fstat__label' }, est.partial ? t('taxes.so_far') : t('taxes.liability')), h('span', { class: 'fmid' }, m(est.liability))),
      h('div', { class: 'fstat' }, h('span', { class: 'fstat__label' }, t('taxes.paid')), h('span', { class: 'fmid amt--in' }, m(est.paid))),
      h('div', { class: 'fstat' }, h('span', { class: 'fstat__label' }, t('taxes.next_payment')), h('span', { class: 'fmid' }, est.next ? m(est.next.amount) : '—'), est.next ? h('span', { class: 'fsmall fmuted' }, U.date(est.next.date)) : null),
      h('div', { class: 'fstat' }, h('span', { class: 'fstat__label' }, t('taxes.projected')), h('span', { class: 'fmid' }, m(est.projected)), h('span', { class: 'fsmall fmuted' }, t('taxes.marginal', { pct: U.pct(est.marginal / 10000, 1) }))))));
  const grid = h('div', { class: 'fgrid' });
  const stmt = h('div', { class: 'fcard' }, h('h3', { class: 'fcard__title', style: { marginBottom: '8px' } }, t('taxes.statement')));
  for (const s of T.SOURCES) if (est.income[s]) stmt.append(U.leader(t('taxes.source.' + s), m(est.income[s])));
  if (est.st || est.lt) stmt.append(U.leader(t('taxes.st_gains'), m(est.st)), U.leader(t('taxes.lt_gains'), m(est.lt)));
  if (est.allowances) stmt.append(U.leader(t('taxes.allowances'), '−' + m(est.allowances)));
  if (est.lossOffset) stmt.append(U.leader(t('taxes.loss_offset'), '−' + m(est.lossOffset)));
  stmt.append(U.leader(h('b', null, t('taxes.taxable')), h('b', null, m(est.taxable))));
  for (const b of est.brackets) stmt.append(U.leader(h('span', { class: 'fmuted fsmall' }, t('taxes.band_line', { pct: U.pct(b.bp / 10000, 2), amount: m(b.portion) })), m(b.tax)));
  stmt.append(U.leader(t('taxes.ordinary_tax'), m(est.ordinaryTax)));
  if (est.cgTax) stmt.append(U.leader(t('taxes.cg_tax'), m(est.cgTax)));
  for (const f of est.flatTaxes) if (f.tax) stmt.append(U.leader(t('taxes.flat_' + f.kind), m(f.tax)));
  if (est.social) stmt.append(U.leader(t('taxes.social'), m(est.social)));
  if (est.credits) stmt.append(U.leader(t('taxes.credits'), '−' + m(est.credits)));
  if (est.withheld) stmt.append(U.leader(t('taxes.withheld'), '−' + m(est.withheld)));
  stmt.append(U.leader(h('b', null, t('taxes.liability')), h('b', null, m(est.liability))));
  if (est.carryOut) stmt.append(h('p', { class: 'ff__hint', style: { marginTop: '8px' } }, t('taxes.carry_out', { amount: m(est.carryOut) })));
  const cal = h('div', { class: 'fcard' }, h('h3', { class: 'fcard__title', style: { marginBottom: '8px' } }, t('taxes.calendar')));
  if (!est.due.length) cal.append(h('p', { class: 'fmuted fsmall' }, t('taxes.no_schedule')));
  for (const d of est.due) {
    const covered = est.paid >= d.cumulative;
    cal.append(h('div', { class: 'frow frow--static' }, U.mono('', covered ? '#6ef3c5' : d.date < L.today() ? '#f472b6' : '#fbbf24', true, covered ? 'check' : 'calendar'),
      h('span', { class: 'frow__main' }, h('span', { class: 'frow__title' }, U.date(d.date)), h('span', { class: 'frow__meta' }, t('taxes.due_by', { pct: U.pct(d.bp / 10000, 0) }))),
      h('span', { class: 'frow__amt' }, m(d.cumulative))));
  }
  if (!(prof.payment_categories || []).length) cal.append(h('p', { class: 'ff__hint', style: { marginTop: '8px' } }, t('taxes.pick_pay_cats')));
  grid.append(stmt, cal);
  node.append(grid);
  if (est.realized.length) {
    node.append(h('div', { class: 'fsection' }, h('h2', null, t('taxes.realized'))));
    const tbl = h('table', { class: 'ftable' }, h('thead', null, h('tr', null, h('th', null, t('csv.date')), h('th', null, t('taxes.instrument')), h('th', { class: 'n' }, t('taxes.proceeds')), h('th', { class: 'n' }, t('taxes.cost')), h('th', { class: 'n' }, t('taxes.gain')), h('th', null, t('taxes.term')))));
    const tb = h('tbody');
    for (const g of est.realized) tb.append(h('tr', null, h('td', null, U.date(g.date, 'dayMonth')), h('td', null, g.instrument), h('td', { class: 'n' }, m(g.proceeds)), h('td', { class: 'n' }, m(g.cost)), h('td', { class: 'n ' + (g.gain >= 0 ? 'amt--in' : 'amt--over') }, U.signedMoney(g.gain, ccy)), h('td', null, t('taxes.term_' + g.term))));
    tbl.append(tb);
    node.append(h('div', { class: 'ftable-wrap', tabindex: '0', role: 'region', 'aria-label': t('taxes.realized') }, tbl));
  }
  const harvest = T.harvestCandidates(L, prof);
  if (harvest.length) {
    node.append(h('div', { class: 'fsection' }, h('h2', null, t('taxes.harvest'))), h('p', { class: 'fmuted fsmall', style: { marginBottom: '8px' } }, t('taxes.harvest_body')));
    for (const c of harvest.slice(0, 8)) node.append(U.leader(h('span', null, c.name, c.washRisk ? h('span', { class: 'fpill fpill--amber', style: { marginLeft: '8px' } }, t('taxes.wash_risk')) : null), U.money(c.loss, c.currency), 'amt--over'));
  }
  return { title: t('nav.taxes'), node, top };
}
