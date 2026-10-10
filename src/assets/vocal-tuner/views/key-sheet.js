import { h, t, overlay, keyName } from '../ui.js';
import { NOTE_NAMES } from '../dsp/settings.js';

const NEED = 15;
const LIMIT = 60000;

export function openKeySheet({ key, audio, subscribe }) {
  return new Promise((resolve) => {
    let o = null;
    let root = key ? key.root : null;
    let mode = key ? key.mode : 'major';
    let unsub = null, found = null;
    const done = (v) => {
      if (unsub) unsub();
      if (audio) audio.keyFind(false);
      o.close();
      resolve(v);
    };
    const keys = h('div', { class: 'vt-keys', role: 'group', 'aria-label': t('key.title') });
    const seg = h('div', { class: 'vt-seg', role: 'group' });
    const anyBtn = h('button', { class: 'vt-chip', type: 'button', 'aria-pressed': String(root == null), onclick: () => { root = null; paint(); } }, t('key.any'));
    const ring = h('div', { class: 'vt-find__ring', hidden: true });
    const findBody = h('p', { class: 'vt-find__sub', hidden: true }, t('key.find_body'));
    const findOut = h('div', { class: 'vt-find' }, ring, findBody);
    const findBtn = audio ? h('button', { class: 'vt-btn vt-find-btn', type: 'button', disabled: audio.state !== 'running', onclick: startFind }, t('key.find')) : null;
    const ok = h('button', { class: 'vt-btn vt-btn--primary', type: 'button', onclick: () => done(root == null ? null : { root, mode }) }, t('take.apply'));
    const cancel = h('button', { class: 'vt-btn', type: 'button', onclick: () => done(undefined) }, t('takes.cancel'));
    NOTE_NAMES.forEach((name, i) => keys.append(h('button', { type: 'button', 'aria-pressed': 'false', onclick: () => { root = i; paint(); } }, name)));
    for (const m of ['major', 'minor']) seg.append(h('button', { type: 'button', 'aria-pressed': 'false', onclick: () => { mode = m; paint(); } }, t('key.' + m)));

    function paint() {
      [...keys.children].forEach((b, i) => b.setAttribute('aria-pressed', String(i === root)));
      [...seg.children].forEach((b, i) => b.setAttribute('aria-pressed', String(root != null && (i === 0 ? 'major' : 'minor') === mode)));
      anyBtn.setAttribute('aria-pressed', String(root == null));
    }

    function startFind() {
      if (!audio || audio.state !== 'running') return;
      found = null;
      findOut.textContent = '';
      findOut.append(ring, findBody);
      ring.hidden = false;
      findBody.hidden = false;
      ring.style.setProperty('--p', '0');
      findBtn.disabled = true;
      audio.keyFind(true);
      const started = Date.now();
      let asked = false;
      if (unsub) unsub();
      unsub = subscribe((m) => {
        if (m.type === 'key') { show(m.result); return; }
        if (m.type !== 'telemetry' || asked) return;
        ring.style.setProperty('--p', String(Math.min(1, m.keySeconds / NEED)));
        if (m.keySeconds >= NEED || Date.now() - started > LIMIT) {
          asked = true;
          audio.keyResult();
        }
      });
    }

    function show(result) {
      if (unsub) { unsub(); unsub = null; }
      audio.keyFind(false);
      findBtn.disabled = false;
      findOut.textContent = '';
      if (!result || result.confidence === 'none') {
        findOut.append(h('p', { class: 'vt-find__sub' }, t('key.none')),
          h('button', { class: 'vt-btn', type: 'button', onclick: startFind }, t('key.retry')));
        return;
      }
      found = result;
      findOut.append(
        h('p', { class: 'vt-find__result' }, t('key.best', { key: keyName(result.key) })),
        h('p', { class: 'vt-find__sub' }, t('key.or', { key: keyName(result.relative) }) + ' · ' + t('key.' + result.confidence)),
        h('div', { class: 'vt-sheet__actions' },
          h('button', { class: 'vt-btn', type: 'button', onclick: startFind }, t('key.retry')),
          h('button', { class: 'vt-btn vt-btn--primary vt-find-use', type: 'button', onclick: () => done(found.key) }, t('key.use'))));
    }

    paint();
    o = overlay([
      h('h2', { class: 'vt-sheet__title' }, t('key.title')),
      keys,
      h('div', { class: 'vt-row' }, seg, anyBtn),
      findBtn,
      findBtn ? findOut : null,
      h('div', { class: 'vt-sheet__actions' }, cancel, ok)
    ], () => done(undefined));
    o.panel.setAttribute('aria-label', t('key.title'));
  });
}
