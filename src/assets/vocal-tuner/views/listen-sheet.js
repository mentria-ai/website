import { h, t, icon, overlay } from '../ui.js';

const KEY = 'mentria.vocaltuner.listen';
const MODES = ['wired', 'speaker', 'bluetooth'];

export function readListen() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!v || !MODES.includes(v.mode)) return null;
    const db = v.db || {};
    return { mode: v.mode, db: { wired: Number.isFinite(db.wired) ? db.wired : -6, speaker: Number.isFinite(db.speaker) ? db.speaker : -18 } };
  } catch (_) {
    return null;
  }
}

export function saveListen(listen) {
  try { localStorage.setItem(KEY, JSON.stringify(listen)); } catch (_) {}
}

export function openListenSheet(current) {
  return new Promise((resolve) => {
    let o = null;
    const done = (v) => { o.close(); resolve(v); };
    const option = (mode, ic) => h('button', { class: 'vt-option', type: 'button', 'aria-pressed': String(current === mode), onclick: () => done(mode) },
      icon(ic),
      h('span', { class: 'vt-option__title' }, t('listen.' + mode)),
      h('span', { class: 'vt-option__desc' }, t('listen.' + mode + '_desc')));
    o = overlay([
      h('h2', { class: 'vt-sheet__title' }, t('listen.title')),
      option('wired', 'headphones'),
      option('speaker', 'speaker'),
      option('bluetooth', 'bluetooth')
    ], () => done(null));
    o.panel.setAttribute('aria-label', t('listen.title'));
  });
}
