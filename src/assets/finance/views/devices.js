import * as U from '../ui.js';
import * as db from '../db.js';
import { canonical } from '../oplog.js';

const { h, t, icon } = U;

async function startPairing(ctx) {
  if (!ctx.app.sync) return;
  const status = h('p', { class: 'fsmall fmuted', role: 'status', 'aria-live': 'polite' }, t('devices.waiting'));
  const codeEl = h('div', { class: 'flock__code' });
  const approve = h('button', { type: 'button', class: 'fb fb--primary', hidden: true }, t('devices.approve'));
  const retry = h('button', { type: 'button', class: 'fb fb--primary', hidden: true, onclick: () => { sh.close(); startPairing(ctx); } }, t('common.retry'));
  const lede = h('p', { class: 'fmuted fsmall' }, t('devices.add_body'));
  const failed = (text) => { lede.hidden = true; codeEl.hidden = true; status.textContent = text; approve.hidden = true; retry.hidden = false; };
  let session = null;
  let closed = false;
  const sh = U.sheet({
    title: t('devices.add'),
    body: h('div', { class: 'fstack' }, lede, codeEl, status, h('p', { class: 'ff__hint' }, t('devices.add_hint'))),
    foot: [h('button', { type: 'button', class: 'fb', onclick: () => sh.close() }, t('common.cancel')), retry, approve],
    onClose: () => { closed = true; if (session) session.cancel(); },
    sticky: true
  });
  try {
    session = await ctx.app.sync.pairHost({
      onPeer: (peer, confirm) => {
        status.replaceChildren(t('devices.peer_found', { name: peer.name || t('devices.unnamed') }), ' ', h('b', { class: 'fnum', style: { fontSize: '1.25rem', color: 'var(--f-strong)' } }, confirm.slice(0, 3) + ' ' + confirm.slice(3)));
        approve.hidden = false;
      },
      onEnd: (reason) => {
        if (reason === 'done') { sh.close(); U.toast(t('devices.paired')); ctx.rerender(); }
        else if (reason === 'expired') { status.textContent = t('pair.expired'); approve.hidden = true; }
        else if (reason === 'unreachable') failed(t('pair.unreachable'));
      }
    });
    if (closed) { session.cancel(); return; }
    codeEl.replaceChildren(...session.code.split('-').map((g) => h('span', null, g)));
  } catch (e) {
    failed(t('devices.pair_failed') + ' ' + String((e && e.message) || e));
  }
  approve.addEventListener('click', async () => {
    if (!session) return;
    approve.disabled = true;
    status.textContent = t('devices.sending');
    const ok = await session.approve();
    if (!ok) { approve.disabled = false; status.textContent = t('devices.no_peer'); }
  });
}

async function rename(ctx) {
  const cur = (await db.getMeta('device_name')) || '';
  const name = await U.promptDialog({ title: t('devices.rename'), label: t('devices.name'), value: cur });
  if (name == null || !name.trim()) return;
  await db.setMeta({ device_name: name.trim().slice(0, 60) });
  ctx.engine.deviceName = name.trim().slice(0, 60);
  ctx.commit(ctx.save('device', ctx.engine.deviceId, { name: name.trim().slice(0, 60) }), t('devices.renamed'));
}

function conflictsPanel(ctx) {
  const L = ctx.ledger;
  const list = L.conflicts();
  const node = h('div');
  node.append(h('p', { class: 'fmuted fsmall', style: { marginBottom: '10px', maxWidth: '64ch' } }, t('devices.conflicts_body')));
  if (!list.length) { node.append(U.empty(t('devices.no_conflicts'))); return node; }
  list.slice().reverse().forEach((c) => {
    const rec = L.get(c.e, c.id);
    const title = rec ? (rec.payee || rec.name || rec.note || c.id) : t('devices.deleted_record');
    const show = (v) => { const s = typeof v === 'string' ? v : canonical(v); return s.length > 60 ? s.slice(0, 57) + '…' : s; };
    const drop = () => {
      for (const b of actions.querySelectorAll('button')) b.disabled = true;
      const all = ctx.ledger.state.conflicts;
      const i = all.indexOf(c);
      if (i >= 0) all.splice(i, 1);
      return ctx.engine.saveConflicts();
    };
    const actions = h('div', { class: 'fb-row fb-row--end', style: { marginTop: '8px' } },
      h('button', { type: 'button', class: 'fb fb--sm', onclick: async () => { try { await drop(); } finally { ctx.rerender(); } } }, t('devices.keep')),
      rec ? h('button', { type: 'button', class: 'fb fb--sm fb--primary', onclick: async () => {
        const ops = ctx.engine.updateOps(c.e, c.id, { [c.f]: c.lose.v });
        await drop();
        ctx.commit(ops, t('devices.switched'));
      } }, t('devices.use_other')) : null);
    node.append(h('div', { class: 'fcard fconf', style: { marginBottom: '10px' } },
      h('div', { class: 'fcard__head' }, h('h3', { class: 'fcard__title' }, t('devices.entity.' + c.e) + ' · ' + title), h('span', { class: 'fsmall fmuted' }, c.f)),
      U.leader(t('devices.kept'), show(c.win.v)),
      U.leader(t('devices.other'), show(c.lose.v)),
      actions));
  });
  return node;
}

export function render(ctx) {
  const L = ctx.ledger;
  const vs = ctx.viewState;
  if (ctx.params.tab && vs.paramTab !== ctx.params.tab) { vs.tab = ctx.params.tab; vs.paramTab = ctx.params.tab; }
  if (!vs.tab) vs.tab = 'devices';
  const node = h('div');
  const tabs = h('div', { class: 'ftabs', role: 'tablist' });
  const nConf = L.conflicts().length;
  for (const [k, label] of [['devices', t('devices.tab_devices')], ['conflicts', t('devices.tab_conflicts') + (nConf ? ' (' + nConf + ')' : '')]]) {
    tabs.append(h('button', { type: 'button', role: 'tab', class: vs.tab === k ? 'is-on' : '', 'aria-selected': vs.tab === k ? 'true' : 'false', onclick: () => { vs.tab = k; ctx.rerender(); } }, label));
  }
  node.append(tabs);
  if (vs.tab === 'conflicts') { node.append(conflictsPanel(ctx)); return { title: t('nav.devices'), node }; }
  const st = ctx.app.sync ? ctx.app.sync.status() : { state: 'local', peers: [] };
  const me = L.get('device', ctx.engine.deviceId) || {};
  const others = L.devices().filter((d) => d.id !== ctx.engine.deviceId);
  node.append(h('div', { class: 'fcard', style: { marginBottom: '14px' } },
    h('div', { class: 'fcard__head' }, h('h2', { class: 'fcard__title' }, t('devices.this')), h('button', { type: 'button', class: 'fcard__link', onclick: () => rename(ctx) }, t('devices.rename'))),
    h('div', { class: 'fmid' }, me.name || ctx.engine.deviceName || '—'),
    h('p', { class: 'fsmall fmuted', style: { marginTop: '4px' } }, t('devices.id', { id: ctx.engine.deviceId.slice(0, 8) })),
    h('div', { class: 'fb-row', style: { marginTop: '12px' } },
      h('span', { class: 'fsync' + (st.state === 'live' ? ' is-live' : st.state === 'waiting' ? ' is-wait' : '') }, h('i'), st.state === 'live' ? U.tp('devices.live_n', st.peers.length) : st.state === 'waiting' ? t('sync.waiting') : others.length ? t('devices.offline') : t('devices.alone')),
      st.lastSync ? h('span', { class: 'fsmall fmuted' }, t('devices.last_sync', { when: new Date(st.lastSync).toLocaleString(U.locale()) })) : null,
      others.length ? h('button', { type: 'button', class: 'fb fb--sm', onclick: () => { if (ctx.app.sync) ctx.app.sync.restart(); setTimeout(() => ctx.rerender(), 1500); } }, icon('sync'), t('devices.reconnect')) : null)));
  node.append(h('div', { class: 'fsection' }, h('h2', null, t('devices.mine')), h('button', { type: 'button', class: 'fb fb--primary fb--sm', disabled: !ctx.writer, onclick: () => startPairing(ctx) }, icon('plus'), t('devices.add'))));
  if (!others.length) node.append(U.empty(t('devices.none')));
  for (const d of others) {
    const live = st.peers.some((p) => p.device === d.id);
    node.append(h('div', { class: 'frow frow--static' },
      U.mono('', live ? '#6ef3c5' : '#8896a8', false, 'devices'),
      h('span', { class: 'frow__main' }, h('span', { class: 'frow__title' }, d.name || t('devices.unnamed')), h('span', { class: 'frow__meta' }, live ? t('devices.connected') : d.last_seen ? t('devices.seen', { when: U.date(String(d.last_seen).slice(0, 10)) }) : '')),
      h('button', { type: 'button', class: 'fb fb--sm fb--ghost', onclick: async () => {
        const ok = await U.confirmDialog({ title: t('devices.remove_title'), body: t('devices.remove_body', { name: d.name || '' }), ok: t('common.remove'), danger: true });
        if (ok) ctx.commit(ctx.remove('device', d.id), t('devices.removed'));
      } }, t('common.remove'))));
  }
  node.append(h('div', { class: 'fbanner fbanner--mint', style: { marginTop: '18px' } }, icon('info'), h('span', null, t('devices.how'))));
  return { title: t('nav.devices'), node };
}
