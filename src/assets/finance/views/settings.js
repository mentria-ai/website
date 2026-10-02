import * as U from '../ui.js';
import * as V from '../vault.js';
import * as db from '../db.js';
import { convertMinor, isCurrency } from '../money.js';
import { COMMON_CCY } from '../defaults.js';
import { exportPayload, encryptExport, readFileJson, decryptExport, mergeInto, plainExport, storageSummary } from '../backup.js';
import { localTimeZone } from '../dates.js';
import { remindersSupported, remindersAllowed, enableReminders, armReminders } from '../reminders.js';

const { h, t, icon } = U;
const LOCALES = ['en-US', 'en-GB', 'en-IN', 'en-CA', 'en-AU', 'es-ES', 'es-MX', 'fr-FR', 'fr-CA', 'de-DE', 'it-IT', 'pt-BR', 'pt-PT', 'ja-JP', 'nl-NL', 'sv-SE', 'pl-PL', 'tr-TR', 'hi-IN', 'zh-CN', 'ko-KR'];

function section(title, ...kids) {
  return h('section', { class: 'fcard', style: { marginBottom: '14px' } }, h('h2', { class: 'fcard__title', style: { marginBottom: '12px' } }, title), h('div', { class: 'fstack' }, ...kids));
}

async function changeBase(ctx, next) {
  const L = ctx.ledger;
  if (next === L.base() || !isCurrency(next)) return;
  const ok = await U.confirmDialog({ title: t('settings.base_title', { ccy: next }), body: t('settings.base_body', { ccy: next }), ok: t('settings.base_ok') });
  if (!ok) { ctx.rerender(); return; }
  const ops = ctx.save('settings', 'main', { base_currency: next });
  let missing = 0;
  for (const tx of L.list('transaction')) {
    const ccy = tx.currency || L.base();
    let b = null;
    let rate = null;
    if (ccy === next) b = tx.amount_minor || 0;
    else {
      rate = L.rateE6(ccy, next, tx.date);
      if (rate) b = convertMinor(tx.amount_minor || 0, ccy, next, rate);
      else missing++;
    }
    ops.push(...ctx.engine.updateOps('transaction', tx.id, { base_minor: b, fx_rate_e6: ccy === next ? null : rate }));
  }
  await ctx.commit(ops, missing ? U.tp('settings.base_missing', missing) : t('settings.base_done', { ccy: next }));
}

function exportSheet(ctx) {
  const p1 = U.input({ type: 'password', autocomplete: 'new-password', placeholder: t('settings.export_pass_ph') });
  const p2 = U.input({ type: 'password', autocomplete: 'new-password', placeholder: t('setup.pass_again') });
  let keys = true;
  const keyBox = U.checkbox(t('settings.include_keys'), true, (v) => { keys = v; });
  const err = h('p', { class: 'ff__err', role: 'alert' });
  const go = h('button', { type: 'button', class: 'fb fb--primary' }, t('settings.export_go'));
  const sh = U.sheet({ title: t('settings.export_title'), body: h('div', { class: 'fstack' }, h('p', { class: 'fmuted fsmall' }, t('settings.export_body')), U.field(t('settings.export_pass'), p1), U.field(t('setup.pass_again'), p2), keyBox, h('p', { class: 'ff__hint' }, t('settings.include_keys_hint')), err), foot: [h('button', { type: 'button', class: 'fb', onclick: () => sh.close() }, t('common.cancel')), go], focus: p1 });
  go.addEventListener('click', async () => {
    if (p1.value.length < 12) { err.textContent = t('setup.pass_rule'); return; }
    if (p1.value !== p2.value) { err.textContent = t('setup.pass_mismatch'); return; }
    go.disabled = true;
    go.textContent = t('common.working');
    try {
      const env = await encryptExport(exportPayload(ctx.engine, keys), p1.value);
      const name = 'mentria-finance-' + ctx.ledger.today().replace(/-/g, '') + '.json';
      const how = await U.shareOrDownload(name, new Blob([JSON.stringify(env)], { type: 'application/json' }), t('app.name'));
      if (how !== 'cancelled') {
        await ctx.saveLocal({ last_export_at: new Date().toISOString() });
        sh.close();
        U.toast(t('settings.exported'));
        ctx.rerender();
      } else { go.disabled = false; go.textContent = t('settings.export_go'); }
    } catch (e) {
      go.disabled = false;
      go.textContent = t('settings.export_go');
      err.textContent = t('errors.write') + ' ' + String((e && e.message) || e);
    }
  });
}

function mergeSheet(ctx) {
  const file = h('input', { type: 'file', accept: '.json,application/json', class: 'fi' });
  const pass = U.input({ type: 'password', autocomplete: 'off', placeholder: t('restore.pass_ph') });
  const err = h('p', { class: 'ff__err', role: 'alert' });
  const go = h('button', { type: 'button', class: 'fb fb--primary' }, t('settings.merge_go'));
  const sh = U.sheet({ title: t('settings.merge_title'), body: h('div', { class: 'fstack' }, h('p', { class: 'fmuted fsmall' }, t('settings.merge_body')), U.field(t('restore.file'), file), U.field(t('restore.pass'), pass), err), foot: [h('button', { type: 'button', class: 'fb', onclick: () => sh.close() }, t('common.cancel')), go] });
  go.addEventListener('click', async () => {
    const f = file.files && file.files[0];
    if (!f) { err.textContent = t('restore.pick'); return; }
    go.disabled = true;
    try {
      const payload = await decryptExport(await readFileJson(f), pass.value);
      const n = await mergeInto(ctx.engine, payload);
      sh.close();
      U.toast(U.tp('settings.merged', n));
    } catch (e) {
      go.disabled = false;
      const m = String((e && e.message) || e);
      err.textContent = m === 'not-json' || m === 'not-finance' ? t('restore.bad_file') : /passphrase|corrupt/i.test(m) ? t('restore.bad_pass') : t('restore.failed') + ' ' + m;
    }
  });
}

function passSheet(ctx) {
  const p1 = U.input({ type: 'password', autocomplete: 'new-password' });
  const p2 = U.input({ type: 'password', autocomplete: 'new-password' });
  const err = h('p', { class: 'ff__err', role: 'alert' });
  const save = h('button', { type: 'button', class: 'fb fb--primary' }, t('common.save'));
  const sh = U.sheet({ title: t('settings.change_pass'), body: h('div', { class: 'fstack' }, h('p', { class: 'fmuted fsmall' }, t('settings.change_pass_body')), U.field(t('setup.pass_label'), p1), U.field(t('setup.pass_again'), p2), err), foot: [h('button', { type: 'button', class: 'fb', onclick: () => sh.close() }, t('common.cancel')), save], focus: p1 });
  save.addEventListener('click', async () => {
    const sc = V.scorePassphrase(p1.value);
    if (!sc.ok) { err.textContent = t('setup.pass_rule'); return; }
    if (p1.value !== p2.value) { err.textContent = t('setup.pass_mismatch'); return; }
    save.disabled = true;
    await V.changePassphrase(ctx.engine.root, p1.value);
    await ctx.publishWrap('pass');
    sh.close();
    U.toast(t('settings.pass_changed'));
  });
}

async function newCode(ctx) {
  const ok = await U.confirmDialog({ title: t('settings.new_code_title'), body: t('settings.new_code_body'), ok: t('settings.new_code_ok') });
  if (!ok) return;
  const code = await V.newRecovery(ctx.engine.root);
  await ctx.publishWrap('recovery');
  const sh = U.sheet({ title: t('setup.code_title'), sticky: true, body: h('div', { class: 'fstack' }, h('p', { class: 'fmuted fsmall' }, t('settings.new_code_shown')), h('div', { class: 'flock__code' }, code.split('-').map((g) => h('span', null, g))), h('div', { class: 'fb-row' }, h('button', { type: 'button', class: 'fb fb--sm', onclick: async () => { try { await navigator.clipboard.writeText(code); U.toast(t('setup.code_copied')); } catch (_) {} } }, t('common.copy')), h('button', { type: 'button', class: 'fb fb--sm', onclick: () => U.downloadBlob('mentria-finance-recovery-code.txt', new Blob([t('setup.kit_text', { code, date: ctx.ledger.today() })], { type: 'text/plain' })) }, icon('download'), t('setup.code_save')))), foot: [h('button', { type: 'button', class: 'fb fb--primary', onclick: () => sh.close() }, t('settings.saved_it'))] });
}

export function render(ctx) {
  const L = ctx.ledger;
  const s = L.settings();
  const node = h('div');
  let names = null;
  try { names = new Intl.DisplayNames([U.uiLang()], { type: 'currency' }); } catch (_) {}
  const ccys = Array.from(new Set([L.base()].concat(COMMON_CCY)));
  const base = U.select(ccys.map((c) => ({ value: c, label: c + (names ? ' · ' + names.of(c) : '') })), L.base(), { onchange: (e) => changeBase(ctx, e.target.value) });
  const loc = U.select([{ value: '', label: t('settings.auto', { value: U.locale() }) }].concat(LOCALES.map((l) => ({ value: l, label: l }))), s.locale || '', { onchange: (e) => { U.setNumberLocale(e.target.value || null); ctx.commit(ctx.save('settings', 'main', { locale: e.target.value || null })); } });
  let zones = [];
  try { zones = Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : []; } catch (_) {}
  const tz = U.select([{ value: '', label: t('settings.auto', { value: localTimeZone() }) }].concat(zones.map((z) => ({ value: z, label: z }))), s.time_zone || '', { onchange: (e) => ctx.commit(ctx.save('settings', 'main', { time_zone: e.target.value || null })) });
  const week = U.select([{ value: '1', label: t('settings.monday') }, { value: '0', label: t('settings.sunday') }, { value: '6', label: t('settings.saturday') }], String(s.week_start == null ? 1 : s.week_start), { onchange: (e) => ctx.commit(ctx.save('settings', 'main', { week_start: Number(e.target.value) })) });
  const buffer = U.moneyField({ value: s.buffer_minor ? U.amountToInput(s.buffer_minor, L.base()) : '', placeholder: '0' });
  buffer.addEventListener('change', () => ctx.commit(ctx.save('settings', 'main', { buffer_minor: Math.abs(U.parseAmount(buffer.value, L.base()) || 0) }), t('settings.saved')));
  node.append(section(t('settings.general'),
    h('div', { class: 'ff-grid' }, U.field(t('setup.base'), base, t('settings.base_hint')), U.field(t('settings.number_format'), loc, t('settings.number_hint', { sample: U.money(123456789, L.base()) })), U.field(t('settings.time_zone'), tz), U.field(t('settings.week_start'), week), U.field(t('settings.buffer'), buffer, t('settings.buffer_hint')))));
  const lockSel = U.select([1, 5, 15, 30, 0].map((m) => ({ value: String(m), label: m ? U.tp('settings.minutes', m) : t('settings.never') })), String(ctx.local.auto_lock_min == null ? 5 : ctx.local.auto_lock_min), { onchange: (e) => ctx.saveLocal({ auto_lock_min: Number(e.target.value) }).then(() => U.toast(t('settings.saved'))) });
  const sec = section(t('settings.security'), U.field(t('settings.auto_lock'), lockSel, t('settings.auto_lock_hint')));
  const pkBox = h('div', { class: 'fstack' });
  sec.querySelector('.fstack').append(pkBox);
  V.status().then((st) => {
    pkBox.append(h('span', { class: 'ff__label' }, t('settings.passkeys')));
    if (!st.prf.length) pkBox.append(h('p', { class: 'fsmall fmuted' }, V.prfSupported ? t('settings.no_passkeys') : t('settings.passkey_unsupported')));
    for (const p of st.prf) pkBox.append(h('div', { class: 'frow frow--static' }, U.mono('', '#6ef3c5', true, 'passkey'), h('span', { class: 'frow__main' }, h('span', { class: 'frow__title' }, p.label || t('settings.passkey')), h('span', { class: 'frow__meta' }, U.date(String(p.created || '').slice(0, 10)))), h('button', { type: 'button', class: 'fb fb--sm fb--ghost', onclick: async () => { await V.removePrf(p.id); U.toast(t('settings.passkey_removed')); ctx.rerender(); } }, t('common.remove'))));
    if (V.prfSupported) pkBox.append(h('button', { type: 'button', class: 'fb fb--sm', style: { alignSelf: 'flex-start' }, onclick: async () => {
      try { await V.enrollPrf(ctx.engine.root, V.defaultDeviceName()); U.toast(t('settings.passkey_added')); ctx.rerender(); }
      catch (e) { U.toast(String(e && e.message) === 'prf-unsupported' ? t('settings.passkey_unsupported') : t('setup.passkey_failed'), { ms: 5000 }); }
    } }, icon('passkey'), t('settings.add_passkey')));
    pkBox.append(U.checkbox(t('setup.device_unlock'), st.hasDevice, async (v) => { await V.setDeviceUnlock(ctx.engine.root, v); U.toast(v ? t('settings.device_on') : t('settings.device_off')); }), h('p', { class: 'ff__hint' }, t('setup.device_hint')));
  });
  sec.querySelector('.fstack').append(h('div', { class: 'fb-row' }, h('button', { type: 'button', class: 'fb fb--sm', onclick: () => passSheet(ctx) }, icon('key'), t('settings.change_pass')), h('button', { type: 'button', class: 'fb fb--sm', onclick: () => newCode(ctx) }, t('settings.new_code')), h('button', { type: 'button', class: 'fb fb--sm', onclick: () => ctx.lock() }, icon('lock'), t('lock.lock_now'))));
  node.append(sec);
  const storage = h('p', { class: 'fsmall fmuted' }, '…');
  storageSummary().then((sum) => {
    storage.textContent = t('settings.storage', { used: (sum.usage / 1048576).toFixed(1), quota: sum.quota ? (sum.quota / 1073741824).toFixed(1) : '?', pages: sum.pages }) + ' · ' + (sum.persisted ? t('settings.persisted') : t('settings.not_persisted'));
  });
  const last = ctx.local.last_export_at;
  node.append(section(t('settings.backup'),
    h('p', { class: 'fsmall fmuted' }, last ? t('settings.last_export', { date: U.date(last.slice(0, 10)) }) : t('settings.never_exported')),
    h('div', { class: 'fb-row' },
      h('button', { type: 'button', class: 'fb fb--primary fb--sm', onclick: () => exportSheet(ctx) }, icon('download'), t('settings.export')),
      h('button', { type: 'button', class: 'fb fb--sm', disabled: !ctx.writer, onclick: () => mergeSheet(ctx) }, icon('import'), t('settings.merge')),
      h('button', { type: 'button', class: 'fb fb--sm', onclick: async () => {
        const ok = await U.confirmDialog({ title: t('settings.plain_title'), body: t('settings.plain_body'), ok: t('settings.plain_ok'), danger: true });
        if (ok) U.downloadBlob('mentria-finance-plain-' + L.today() + '.json', new Blob([JSON.stringify(plainExport(ctx.engine), null, 1)], { type: 'application/json' }));
      } }, t('settings.plain'))),
    h('p', { class: 'ff__hint' }, t('settings.backup_hint')),
    storage));
  const remBox = U.checkbox(t('settings.reminders'), !!ctx.local.reminders && remindersAllowed(), async (v) => {
    if (v) {
      const ok = await enableReminders();
      if (!ok) { U.toast(remindersAllowed() ? t('settings.reminders_failed') : t('settings.reminders_denied'), { ms: 6000 }); ctx.rerender(); return; }
    }
    await ctx.saveLocal({ reminders: v });
    const n = await armReminders(ctx.getCtx());
    U.toast(v ? U.tp('settings.reminders_on', n) : t('settings.reminders_off'));
  });
  const remDays = U.select([0, 1, 2, 3, 7].map((d) => ({ value: String(d), label: d === 0 ? t('settings.on_the_day') : U.tp('settings.days_before', d) })), String(s.default_notify_days == null ? 1 : s.default_notify_days), { onchange: (e) => ctx.commit(ctx.save('settings', 'main', { default_notify_days: Number(e.target.value) }), t('settings.saved')) });
  const remNames = U.checkbox(t('settings.reminder_names'), !!ctx.local.reminder_names, (v) => ctx.saveLocal({ reminder_names: v }).then(() => armReminders(ctx.getCtx())));
  const remAmounts = U.checkbox(t('settings.reminder_amounts'), !!ctx.local.reminder_amounts, (v) => ctx.saveLocal({ reminder_amounts: v }).then(() => armReminders(ctx.getCtx())));
  node.append(section(t('settings.reminders_title'),
    remindersSupported() ? remBox : h('p', { class: 'fsmall fmuted' }, t('settings.reminders_unsupported')),
    remindersSupported() ? h('p', { class: 'ff__hint' }, t('settings.reminders_hint')) : null,
    U.field(t('settings.remind_when'), remDays), remNames, remAmounts));
  const aiBox = U.checkbox(t('settings.ai_entry'), s.ai_entry !== false, (v) => ctx.commit(ctx.save('settings', 'main', { ai_entry: v })));
  const agentBox = U.checkbox(t('settings.agents'), !!ctx.local.agents, async (v) => {
    await ctx.saveLocal({ agents: v });
    const A = await import('../agents.js');
    if (v && ctx.writer) await A.enableAgents(ctx.getCtx); else await A.disableAgents();
    U.toast(v ? t('settings.agents_on') : t('settings.agents_off'));
  });
  const namesBox = U.checkbox(t('settings.share_names'), !!s.share_subscription_names, (v) => ctx.commit(ctx.save('settings', 'main', { share_subscription_names: v })));
  const widgetBox = U.checkbox(t('settings.widget_amounts'), !!ctx.local.widget_amounts, (v) => ctx.saveLocal({ widget_amounts: v }).then(() => { ctx.rerender(); U.toast(t('settings.saved')); }));
  const confirmIn = U.moneyField({ value: s.confirm_above_minor ? U.amountToInput(s.confirm_above_minor, L.base()) : '', placeholder: t('settings.no_limit') });
  confirmIn.addEventListener('change', () => ctx.commit(ctx.save('settings', 'main', { confirm_above_minor: Math.abs(U.parseAmount(confirmIn.value, L.base()) || 0) }), t('settings.saved')));
  node.append(section(t('settings.ai'), aiBox, h('p', { class: 'ff__hint' }, t('settings.ai_hint')), agentBox, h('p', { class: 'ff__hint' }, t('settings.agents_hint')), namesBox, U.field(t('settings.confirm_above'), confirmIn, t('settings.confirm_above_hint')), widgetBox, h('p', { class: 'ff__hint' }, t('settings.widget_hint'))));
  node.append(section(t('settings.about'),
    h('p', { class: 'fsmall fmuted' }, t('settings.about_body')),
    h('p', { class: 'fsmall fmuted' }, t('settings.version', { v: (ctx.host && ctx.host.manifest && ctx.host.manifest.version) || '1.0.0' })),
    h('button', { type: 'button', class: 'fb fb--danger fb--sm', style: { alignSelf: 'flex-start' }, onclick: async () => {
      const ok = await U.confirmDialog({ title: t('lock.erase_title'), body: t('lock.erase_body'), ok: t('lock.erase_ok'), danger: true });
      if (!ok) return;
      ctx.lock();
      await db.wipe();
      try { if (window.MentriaStore) window.MentriaStore.remove('extdata.finance', 'widget'); } catch (_) {}
      location.reload();
    } }, icon('trash'), t('lock.erase'))));
  return { title: t('nav.settings'), node };
}
