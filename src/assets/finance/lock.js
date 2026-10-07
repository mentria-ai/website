import * as U from './ui.js';
import * as V from './vault.js';
import * as C from './crypto.js';
import * as db from './db.js';
import { guessCurrency, COMMON_CCY } from './defaults.js';
import { todayISO } from './dates.js';
import { decimalToInput } from './money.js';
import { readFileJson, decryptExport, wrapRecords, foreignSafe } from './backup.js';
import { pairJoin } from './sync.js';

const { h, t, icon } = U;

function isIOS() { return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
function standalone() {
  try { if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) return true; } catch (_) {}
  try { return !!(window.parent && (window.parent.navigator.standalone || window.parent.matchMedia('(display-mode: standalone)').matches)); } catch (_) { return false; }
}

function frame(root, ...kids) {
  const inner = h('div', { class: 'flock__inner' }, ...kids);
  root.replaceChildren(h('main', { class: 'flock' }, inner));
  return inner;
}

function mark(sub) {
  return h('div', { class: 'flock__mark' }, icon('coins'), h('div', null, h('h1', null, t('app.name')), sub ? h('p', { class: 'fmuted fsmall' }, sub) : null));
}

function steps(n, of) {
  const el = h('div', { class: 'flock__steps', 'aria-label': t('setup.step', { n, of }) });
  for (let i = 1; i <= of; i++) el.append(h('i', { class: i <= n ? 'is-on' : '' }));
  return el;
}

function errLine() { return h('p', { class: 'ff__err', role: 'alert', 'aria-live': 'assertive' }); }

function passInput(props) {
  const inp = U.input(Object.assign({ type: 'password', autocomplete: 'new-password', spellcheck: 'false' }, props || {}));
  return inp;
}

function busy(btn, on, label) {
  if (on) { btn.dataset.label = btn.textContent; btn.textContent = label || t('common.working'); btn.disabled = true; }
  else { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; }
}

export function showLock(root, opts) {
  const st = opts.status;
  if (!st.setup) welcome(root, opts);
  else unlockScreen(root, opts);
}

function iosNote() {
  if (!isIOS() || standalone()) return null;
  return h('div', { class: 'fbanner' }, icon('info'), h('span', null, t('setup.ios_home')));
}

function welcome(root, opts) {
  frame(root,
    mark(),
    h('p', { class: 'flock__lede' }, t('setup.lede')),
    h('ul', { class: 'fstack fsmall fmuted', style: { paddingLeft: '18px', margin: 0, gap: '6px' } },
      h('li', null, t('setup.point_local')), h('li', null, t('setup.point_sync')), h('li', null, t('setup.point_ai'))),
    iosNote(),
    h('button', { type: 'button', class: 'fb fb--primary fb--block', onclick: () => passStep(root, opts, {}) }, t('setup.start')),
    h('button', { type: 'button', class: 'fb fb--block', onclick: () => pairStep(root, opts) }, icon('devices'), t('setup.pair')),
    h('div', { class: 'flock__alt' }, h('button', { type: 'button', onclick: () => restoreStep(root, opts) }, t('setup.restore')))
  );
}

function passStep(root, opts, draft) {
  const p1 = passInput({ placeholder: t('setup.pass_ph') });
  const p2 = passInput({ placeholder: t('setup.pass_again') });
  const meter = h('div', { class: 'flock__meter', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i'));
  const meterLabel = h('span', { class: 'ff__hint' }, t('setup.pass_rule'));
  const err = errLine();
  const next = h('button', { type: 'button', class: 'fb fb--primary fb--block', disabled: true }, t('common.next'));
  const show = U.checkbox(t('setup.show_pass'), false, (on) => { p1.type = on ? 'text' : 'password'; p2.type = on ? 'text' : 'password'; });
  const update = () => {
    const sc = V.scorePassphrase(p1.value);
    meter.className = 'flock__meter s' + Math.min(4, Math.max(0, Math.ceil(sc.score * 4 / 6)));
    meterLabel.textContent = p1.value ? t('setup.strength_' + sc.label) + (sc.ok ? '' : ' · ' + t('setup.pass_rule')) : t('setup.pass_rule');
    next.disabled = !(sc.ok && p1.value === p2.value);
    err.textContent = p2.value && p1.value !== p2.value ? t('setup.pass_mismatch') : '';
  };
  p1.addEventListener('input', update);
  p2.addEventListener('input', update);
  p2.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !next.disabled) next.click(); });
  next.addEventListener('click', () => {
    draft.passphrase = p1.value;
    draft.recoveryCode = draft.recoveryCode || C.newRecoveryCode();
    recoveryStep(root, opts, draft);
  });
  frame(root,
    steps(1, 3),
    h('h2', null, t('setup.pass_title')),
    h('p', { class: 'flock__lede' }, t('setup.pass_body')),
    U.field(t('setup.pass_label'), p1),
    meter, meterLabel,
    U.field(t('setup.pass_again'), p2),
    show, err, next,
    h('div', { class: 'flock__alt' }, h('button', { type: 'button', onclick: () => welcome(root, opts) }, t('common.back')))
  );
  setTimeout(() => p1.focus(), 50);
}

function recoveryStep(root, opts, draft) {
  const code = draft.recoveryCode;
  const groups = code.split('-');
  const box = h('div', { class: 'flock__code', 'aria-label': t('setup.code_label') }, groups.map((g) => h('span', null, g)));
  const check = U.input({ placeholder: t('setup.code_check_ph'), maxlength: '9', autocapitalize: 'characters' });
  const err = errLine();
  const next = h('button', { type: 'button', class: 'fb fb--primary fb--block', disabled: true }, t('common.next'));
  check.addEventListener('input', () => {
    const want = groups[groups.length - 1];
    const got = check.value.toUpperCase().replace(/[^A-Z2-7]/g, '');
    next.disabled = got !== want;
    err.textContent = got.length >= 4 && got !== want ? t('setup.code_check_bad') : '';
  });
  check.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !next.disabled) next.click(); });
  const copyBtn = h('button', { type: 'button', class: 'fb fb--sm', onclick: async () => {
    try { await navigator.clipboard.writeText(code); U.toast(t('setup.code_copied')); } catch (_) { U.toast(t('errors.clipboard')); }
  } }, t('common.copy'));
  const saveBtn = h('button', { type: 'button', class: 'fb fb--sm', onclick: () => {
    const text = t('setup.kit_text', { code, date: todayISO() });
    U.downloadBlob('mentria-finance-recovery-code.txt', new Blob([text], { type: 'text/plain' }));
  } }, icon('download'), t('setup.code_save'));
  next.addEventListener('click', () => basicsStep(root, opts, draft));
  frame(root,
    steps(2, 3),
    h('h2', null, t('setup.code_title')),
    h('p', { class: 'flock__lede' }, t('setup.code_body')),
    box,
    h('div', { class: 'fb-row' }, copyBtn, saveBtn),
    U.field(t('setup.code_check'), check, t('setup.code_check_hint')),
    err, next,
    h('div', { class: 'flock__alt' }, h('button', { type: 'button', onclick: () => passStep(root, opts, draft) }, t('common.back')))
  );
}

function currencyOptions(selected) {
  const list = COMMON_CCY.slice();
  if (selected && !list.includes(selected)) list.unshift(selected);
  let names = null;
  try { names = new Intl.DisplayNames([U.uiLang()], { type: 'currency' }); } catch (_) {}
  return list.map((c) => ({ value: c, label: c + (names ? ' · ' + names.of(c) : '') }));
}

function basicsStep(root, opts, draft) {
  const guess = draft.base || guessCurrency();
  const ccy = U.select(currencyOptions(guess), guess);
  let wantPasskey = V.prfSupported && !draft.noPasskey;
  let wantDevice = false;
  const pk = V.prfSupported ? U.checkbox(t('setup.passkey'), wantPasskey, (v) => { wantPasskey = v; }) : null;
  const dev = U.checkbox(t('setup.device_unlock'), false, (v) => { wantDevice = v; });
  const err = errLine();
  const done = h('button', { type: 'button', class: 'fb fb--primary fb--block' }, t('setup.finish'));
  done.addEventListener('click', async () => {
    busy(done, true, t('setup.creating'));
    err.textContent = '';
    try {
      const created = await V.create(draft.passphrase, { recoveryCode: draft.recoveryCode, pending: { base: ccy.value } });
      if (wantDevice) await V.setDeviceUnlock(created.root, true);
      if (wantPasskey) {
        try { await V.enrollPrf(created.root, V.defaultDeviceName()); }
        catch (e) { U.toast(t('setup.passkey_failed'), { ms: 5000 }); }
      }
      draft.passphrase = null;
      opts.onOpen({ root: created.root, keys: created.keys });
    } catch (e) {
      busy(done, false);
      err.textContent = t('errors.setup') + ' ' + String((e && e.message) || e);
    }
  });
  frame(root,
    steps(3, 3),
    h('h2', null, t('setup.basics_title')),
    U.field(t('setup.base'), ccy, t('setup.base_hint')),
    h('div', { class: 'fstack' }, pk, pk ? h('p', { class: 'ff__hint' }, t('setup.passkey_hint')) : null, dev, h('p', { class: 'ff__hint' }, t('setup.device_hint'))),
    err, done,
    h('div', { class: 'flock__alt' }, h('button', { type: 'button', onclick: () => recoveryStep(root, opts, draft) }, t('common.back')))
  );
}

function unlockScreen(root, opts) {
  const st = opts.status;
  const pass = U.input({ type: 'password', autocomplete: 'current-password', placeholder: t('lock.pass_ph'), spellcheck: 'false' });
  const err = errLine();
  const go = h('button', { type: 'button', class: 'fb fb--primary fb--block' }, t('lock.unlock'));
  let mode = 'pass';
  const label = h('label', { class: 'ff__label', for: 'fin-pass' }, t('lock.pass_label'));
  pass.id = 'fin-pass';
  const toggle = h('button', { type: 'button' }, t('lock.use_recovery'));
  toggle.addEventListener('click', () => {
    mode = mode === 'pass' ? 'recovery' : 'pass';
    pass.value = '';
    pass.type = mode === 'pass' ? 'password' : 'text';
    pass.placeholder = mode === 'pass' ? t('lock.pass_ph') : 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX';
    pass.autocomplete = mode === 'pass' ? 'current-password' : 'off';
    label.textContent = mode === 'pass' ? t('lock.pass_label') : t('lock.recovery_label');
    toggle.textContent = mode === 'pass' ? t('lock.use_recovery') : t('lock.use_pass');
    err.textContent = '';
    pass.focus();
  });
  const attempt = async () => {
    if (!pass.value) return;
    busy(go, true, t('lock.unlocking'));
    err.textContent = '';
    let s;
    try {
      s = mode === 'pass' ? await V.unlockPass(pass.value) : await V.unlockRecovery(pass.value);
    } catch (e) {
      busy(go, false);
      const m = String((e && e.message) || e);
      err.textContent = m === 'bad-pass' ? t('lock.bad_pass') : m === 'bad-code' ? t('lock.bad_code') : m === 'wrong-key' ? t('lock.wrong_key') : t('lock.failed') + ' ' + m;
      pass.select();
      return;
    }
    pass.value = '';
    if (mode === 'recovery') s.afterRecovery = true;
    try { await opened(s); } catch (e) { openFailed(go, e); }
  };
  const opened = async (s) => {
    await opts.onOpen(s);
    if (s.afterRecovery) setTimeout(() => askNewPass(s, opts), 400);
  };
  const openFailed = (btn, e) => {
    busy(btn, false);
    err.textContent = t('lock.failed') + ' ' + String((e && e.message) || e);
  };
  go.addEventListener('click', attempt);
  pass.addEventListener('keydown', (e) => { if (e.key === 'Enter') attempt(); });
  const pkBtn = st.prf.length ? h('button', { type: 'button', class: 'fb fb--block', onclick: async () => {
    busy(pkBtn, true, t('lock.unlocking'));
    let s;
    try { s = await V.unlockPrf(); }
    catch (e) { busy(pkBtn, false); err.textContent = e && e.name === 'NotAllowedError' ? t('lock.passkey_cancelled') : t('lock.passkey_failed'); return; }
    try { await opened(s); } catch (e) { openFailed(pkBtn, e); }
  } }, icon('passkey'), t('lock.passkey')) : null;
  const inboxCount = h('span', { class: 'fmuted fsmall' });
  db.allInbox().then((list) => { if (list.length) inboxCount.textContent = U.tp('lock.inbox_waiting', list.length); }).catch(() => {});
  frame(root,
    mark(st.deviceName || t('lock.locked')),
    iosNote(),
    pkBtn,
    h('div', { class: 'ff' }, label, pass),
    err, go,
    h('div', { class: 'flock__alt' }, toggle),
    quickAddLocked(opts, inboxCount),
    h('div', { class: 'flock__alt', style: { marginTop: '18px' } }, h('button', { type: 'button', style: { color: 'var(--f-muted)' }, onclick: () => eraseDevice(root, opts) }, t('lock.erase')))
  );
  if (st.hasDevice) {
    V.unlockDevice().then((s) => opened(s)).catch(() => { setTimeout(() => pass.focus(), 50); });
  } else if (!st.prf.length) setTimeout(() => pass.focus(), 50);
}

function askNewPass(session, opts) {
  const p1 = passInput({ placeholder: t('setup.pass_ph') });
  const p2 = passInput({ placeholder: t('setup.pass_again') });
  const err = errLine();
  const save = h('button', { type: 'button', class: 'fb fb--primary' }, t('common.save'));
  const sh = U.sheet({ title: t('lock.new_pass_title'), body: h('div', { class: 'fstack' }, h('p', { class: 'fmuted fsmall' }, t('lock.new_pass_body')), U.field(t('setup.pass_label'), p1), U.field(t('setup.pass_again'), p2), err), foot: [h('button', { type: 'button', class: 'fb', onclick: () => sh.close() }, t('common.later')), save], focus: p1 });
  save.addEventListener('click', async () => {
    const sc = V.scorePassphrase(p1.value);
    if (!sc.ok) { err.textContent = t('setup.pass_rule'); return; }
    if (p1.value !== p2.value) { err.textContent = t('setup.pass_mismatch'); return; }
    try {
      await V.changePassphrase(session.root, p1.value);
      if (opts.publishWrap) await opts.publishWrap('pass');
    } catch (e) {
      err.textContent = t('errors.write') + ' ' + String((e && e.message) || e);
      return;
    }
    sh.close();
    U.toast(t('settings.pass_changed'));
  });
}

function quickAddLocked(opts, countEl) {
  const amount = U.moneyField({ placeholder: decimalToInput('0.00', U.locale()), 'aria-label': t('entry.amount') });
  const note = U.input({ placeholder: t('lock.qa_note'), maxlength: '200' });
  let income = false;
  const kind = U.seg([{ value: 'out', label: t('entry.expense') }, { value: 'in', label: t('entry.income') }], 'out', (v) => { income = v === 'in'; });
  const save = h('button', { type: 'button', class: 'fb fb--sm' }, t('lock.qa_save'));
  const wrap = h('details', { class: 'flock__qa' },
    h('summary', { style: { cursor: 'pointer', fontWeight: 600, fontSize: '0.92rem' } }, t('lock.qa_title'), ' ', countEl),
    h('div', { class: 'fstack', style: { marginTop: '12px' } }, h('p', { class: 'ff__hint' }, t('lock.qa_body')), kind, h('div', { class: 'ff-grid' }, U.field(t('entry.amount'), amount), U.field(t('entry.note'), note)), h('div', { class: 'fb-row fb-row--end' }, save)));
  save.addEventListener('click', async () => {
    const val = U.parseAmount(amount.value, 'USD');
    if (val == null || val === 0) { amount.focus(); return; }
    try {
      const pub = await db.getMeta('inbox_pub');
      const box = await C.sealToInbox(pub, { amount: amount.value, note: note.value, income, date: todayISO(), created: new Date().toISOString() });
      await db.addInbox({ id: C.randomId(), box, created: new Date().toISOString() });
      amount.value = '';
      note.value = '';
      const list = await db.allInbox();
      countEl.textContent = U.tp('lock.inbox_waiting', list.length);
      U.toast(t('lock.qa_saved'));
    } catch (e) { U.toast(t('errors.write') + ' ' + String(e && e.message || e)); }
  });
  return wrap;
}

async function eraseDevice(root, opts) {
  const ok = await U.confirmDialog({ title: t('lock.erase_title'), body: t('lock.erase_body'), ok: t('lock.erase_ok'), danger: true });
  if (!ok) return;
  try { await db.wipe(); } catch (e) { U.toast(t('errors.write') + ' ' + String((e && e.message) || e), { ms: 7000 }); return; }
  try { if (window.MentriaStore) window.MentriaStore.remove('extdata.finance', 'widget'); } catch (_) {}
  showLock(root, Object.assign({}, opts, { status: await V.status() }));
}

function pairStep(root, opts) {
  const code = U.input({ placeholder: 'XXXX-XXXX-XXXX-XXXX', autocapitalize: 'characters', autocomplete: 'off', spellcheck: 'false', class: 'fi fi--num' });
  const status = h('p', { class: 'fmuted fsmall', role: 'status', 'aria-live': 'polite' });
  const err = errLine();
  const go = h('button', { type: 'button', class: 'fb fb--primary fb--block' }, t('pair.connect'));
  let session = null;
  go.addEventListener('click', async () => {
    const raw = code.value.toUpperCase().replace(/[^A-Z2-7]/g, '');
    if (raw.length !== 16) { err.textContent = t('pair.code_short'); return; }
    busy(go, true, t('pair.connecting'));
    err.textContent = '';
    status.textContent = t('pair.looking');
    try {
      session = await pairJoin(raw, {
        name: V.defaultDeviceName(),
        onPeer: (confirm) => { status.replaceChildren(t('pair.confirm_on_other'), ' ', h('b', { class: 'fnum', style: { fontSize: '1.2rem', color: 'var(--f-strong)' } }, confirm.slice(0, 3) + ' ' + confirm.slice(3))); },
        onPayload: async (payload) => {
          status.textContent = t('pair.receiving');
          try {
            const rootKey = C.unb64(payload.root);
            const wraps = wrapRecords(payload.snapshot);
            if (!wraps.pass) throw new Error(t('pair.no_wraps'));
            const created = await V.create(null, { root: rootKey, passWrap: wraps.pass, recoveryWrap: wraps.recovery || null });
            await session.sendDone(created.deviceId, V.defaultDeviceName());
            opts.onOpen({ root: created.root, keys: created.keys, firstRun: async (engine) => { await engine.importSnapshot(payload.snapshot, payload.summary); } });
          } catch (e) {
            busy(go, false);
            err.textContent = t('pair.failed') + ' ' + String((e && e.message) || e);
          }
        },
        onEnd: (reason) => {
          if (reason === 'expired') { busy(go, false); err.textContent = t('pair.expired'); }
          else if (reason === 'unreachable') { busy(go, false); status.textContent = ''; err.textContent = t('pair.unreachable'); }
        }
      });
    } catch (e) {
      busy(go, false);
      err.textContent = t('pair.failed') + ' ' + String((e && e.message) || e);
    }
  });
  code.addEventListener('keydown', (e) => { if (e.key === 'Enter') go.click(); });
  frame(root,
    mark(),
    h('h2', null, t('pair.title')),
    h('p', { class: 'flock__lede' }, t('pair.body')),
    U.field(t('pair.code'), code),
    status, err, go,
    h('div', { class: 'flock__alt' }, h('button', { type: 'button', onclick: () => { if (session) session.cancel(); welcome(root, opts); } }, t('common.back')))
  );
  setTimeout(() => code.focus(), 50);
}

function restoreStep(root, opts) {
  const file = h('input', { type: 'file', accept: '.json,application/json', class: 'fi' });
  const pass = U.input({ type: 'password', autocomplete: 'off', placeholder: t('restore.pass_ph') });
  const err = errLine();
  const go = h('button', { type: 'button', class: 'fb fb--primary fb--block' }, t('restore.go'));
  go.addEventListener('click', async () => {
    const f = file.files && file.files[0];
    if (!f) { err.textContent = t('restore.pick'); return; }
    if (!pass.value) { pass.focus(); return; }
    busy(go, true, t('restore.working'));
    err.textContent = '';
    try {
      const env = await readFileJson(f);
      const payload = await decryptExport(env, pass.value);
      if (payload.root) {
        const rootKey = C.unb64(payload.root);
        const wraps = wrapRecords(payload.snapshot);
        const created = wraps.pass
          ? await V.create(null, { root: rootKey, passWrap: wraps.pass, recoveryWrap: wraps.recovery || null })
          : await V.create(pass.value, { root: rootKey });
        pass.value = '';
        const firstRun = async (engine) => { await engine.importSnapshot(payload.snapshot); };
        if (created.recoveryCode) {
          recoveryReveal(root, created.recoveryCode, () => opts.onOpen({ root: created.root, keys: created.keys, firstRun }));
        } else {
          opts.onOpen({ root: created.root, keys: created.keys, firstRun });
          setTimeout(() => U.toast(t('restore.same_pass'), { ms: 7000 }), 600);
        }
      } else {
        const created = await V.create(pass.value, {});
        pass.value = '';
        const snap = foreignSafe(payload.snapshot);
        recoveryReveal(root, created.recoveryCode, () => opts.onOpen({ root: created.root, keys: created.keys, firstRun: async (engine) => { await engine.importSnapshot(snap); } }));
      }
    } catch (e) {
      busy(go, false);
      const m = String((e && e.message) || e);
      err.textContent = m === 'not-json' || m === 'not-finance' ? t('restore.bad_file') : /passphrase|corrupt/i.test(m) ? t('restore.bad_pass') : t('restore.failed') + ' ' + m;
    }
  });
  frame(root,
    mark(),
    h('h2', null, t('restore.title')),
    h('p', { class: 'flock__lede' }, t('restore.body')),
    U.field(t('restore.file'), file),
    U.field(t('restore.pass'), pass),
    err, go,
    h('div', { class: 'flock__alt' }, h('button', { type: 'button', onclick: () => welcome(root, opts) }, t('common.back')))
  );
}

function recoveryReveal(root, code, onDone) {
  const groups = code.split('-');
  frame(root,
    mark(),
    h('h2', null, t('setup.code_title')),
    h('p', { class: 'flock__lede' }, t('restore.new_code')),
    h('div', { class: 'flock__code' }, groups.map((g) => h('span', null, g))),
    h('div', { class: 'fb-row' },
      h('button', { type: 'button', class: 'fb fb--sm', onclick: async () => { try { await navigator.clipboard.writeText(code); U.toast(t('setup.code_copied')); } catch (_) {} } }, t('common.copy')),
      h('button', { type: 'button', class: 'fb fb--sm', onclick: () => U.downloadBlob('mentria-finance-recovery-code.txt', new Blob([t('setup.kit_text', { code, date: todayISO() })], { type: 'text/plain' })) }, icon('download'), t('setup.code_save'))),
    h('button', { type: 'button', class: 'fb fb--primary fb--block', onclick: onDone }, t('common.continue'))
  );
}
