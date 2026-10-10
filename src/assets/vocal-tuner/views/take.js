import { h, t, icon, toast, overlay, confirmSheet, promptSheet, deliverFile, fmtDateTime, fmtDuration, safeName, keyName } from '../ui.js';
import { normalize, PRESETS, presetOf } from '../dsp/settings.js';
import * as db from '../db.js';
import { renderTake } from '../render.js';
import { openKeySheet } from './key-sheet.js';

function sameSettings(a, b) {
  if (!a || !b) return false;
  const ka = a.key, kb = b.key;
  const keys = ka ? !!kb && ka.root === kb.root && ka.mode === kb.mode : !kb;
  return Math.abs(a.correction - b.correction) < 1e-6 && keys;
}

export function mount(root, ctx, params) {
  let alive = true;
  let take = null, pending = null, job = null, failed = '';
  let blobs = { dry: null, tuned: null };
  let buffers = { dry: null, tuned: null };
  let ac = null, gains = null, sources = [], which = 'tuned', playing = false, offset = 0, startedAt = 0, raf = 0;

  const back = h('button', { class: 'vt-icon-btn', type: 'button', 'aria-label': t('take.back'), onclick: () => ctx.go('takes') }, icon('back'));
  const nameBtn = h('button', { class: 'vt-take__name', type: 'button', onclick: () => rename() });
  const exportBtn = h('button', { class: 'vt-icon-btn vt-take-export', type: 'button', 'aria-label': t('takes.export'), disabled: true, onclick: () => openExport() }, icon('share'));
  const deleteBtn = h('button', { class: 'vt-icon-btn vt-take-delete', type: 'button', 'aria-label': t('takes.delete'), onclick: () => remove() }, icon('trash'));
  const meta = h('p', { class: 'vt-take__meta' });
  const playBtn = h('button', { class: 'vt-icon-btn vt-player__play', type: 'button', 'aria-label': t('take.play'), disabled: true, onclick: () => (playing ? pause() : play()) }, icon('play'));
  const scrub = h('input', { type: 'range', min: '0', max: '1', step: '0.01', value: '0', 'aria-label': t('take.position'), disabled: true, oninput: () => seek(Number(scrub.value)) });
  const cur = h('span', { class: 'vt-player__cur' }, '0:00');
  const total = h('span', {}, '0:00');
  const ab = h('div', { class: 'vt-seg vt-ab', role: 'group' });
  for (const k of ['tuned', 'dry']) ab.append(h('button', { type: 'button', 'aria-pressed': String(k === which), onclick: () => choose(k) }, t(k === 'tuned' ? 'take.tuned' : 'take.original')));
  const seg = h('div', { class: 'vt-seg', role: 'group', 'aria-label': t('live.style') });
  for (const p of ['natural', 'tight', 'hard']) seg.append(h('button', { type: 'button', 'aria-pressed': 'false', onclick: () => edit(PRESETS[p], undefined) }, t('live.presets.' + p)));
  const slider = h('input', { type: 'range', min: '0', max: '100', step: '1', 'aria-label': t('live.correction'), oninput: () => edit(slider.value / 100, undefined) });
  const keyChip = h('button', { class: 'vt-chip vt-keychip', type: 'button', onclick: () => chooseKey() });
  const progressEl = h('p', { class: 'vt-progress', role: 'status' });
  const cancelBtn = h('button', { class: 'vt-btn', type: 'button', onclick: () => { if (job) job.cancel(); } }, t('takes.cancel'));
  const applyRow = h('div', { class: 'vt-take__apply', hidden: true });

  root.append(h('section', { class: 'vt-take' },
    h('header', { class: 'vt-top' }, back, nameBtn, exportBtn, deleteBtn),
    h('div', { class: 'vt-take__body' },
      meta,
      h('div', { class: 'vt-player' }, playBtn, h('div', { class: 'vt-player__scrub' }, scrub, h('div', { class: 'vt-player__times' }, cur, total))),
      h('div', { class: 'vt-row' }, ab),
      h('div', { class: 'vt-row' }, seg),
      h('label', { class: 'vt-slider' }, h('span', {}, t('live.correction')), slider, h('span', {}, '')),
      h('div', { class: 'vt-row' }, keyChip),
      applyRow)));

  function paintHeader() {
    nameBtn.textContent = take.name;
    nameBtn.setAttribute('aria-label', t('takes.rename') + ': ' + take.name);
    meta.textContent = fmtDuration(take.duration) + ' · ' + fmtDateTime(take.createdAt);
  }

  function paintSettings() {
    const p = presetOf(pending.correction);
    [...seg.children].forEach((b, i) => b.setAttribute('aria-pressed', String(['natural', 'tight', 'hard'][i] === p)));
    slider.value = String(Math.round(pending.correction * 100));
    keyChip.textContent = '';
    keyChip.append(icon('key'), keyName(pending.key));
    paintApply();
  }

  function paintApply() {
    applyRow.textContent = '';
    if (job) {
      applyRow.append(progressEl, cancelBtn);
    } else if (failed) {
      applyRow.append(h('p', { class: 'vt-msg vt-msg--warn', role: 'alert' }, failed),
        h('button', { class: 'vt-btn', type: 'button', onclick: () => revert() }, t('take.revert')),
        h('button', { class: 'vt-btn vt-btn--primary', type: 'button', onclick: () => apply() }, t('take.retry')));
    } else if (!sameSettings(pending, take.renderedWith)) {
      applyRow.append(h('button', { class: 'vt-btn', type: 'button', onclick: () => revert() }, t('take.revert')),
        h('button', { class: 'vt-btn vt-btn--primary vt-apply', type: 'button', onclick: () => apply() }, t('take.apply')));
    }
    applyRow.hidden = !applyRow.childNodes.length;
  }

  function edit(correction, key) {
    if (!take || job) return;
    pending = normalize({ correction: correction == null ? pending.correction : correction, key: key === undefined ? pending.key : key });
    failed = '';
    paintSettings();
  }

  async function chooseKey() {
    if (!take || job) return;
    const key = await openKeySheet({ key: pending.key, audio: null, subscribe: null });
    if (key === undefined || !alive) return;
    edit(null, key);
  }

  function revert() {
    pending = normalize(take.renderedWith);
    failed = '';
    paintSettings();
  }

  async function decode(blob) {
    const C = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    return new C(1, 1, take.sampleRate || 48000).decodeAudioData(await blob.arrayBuffer());
  }

  async function apply() {
    if (!take || job || !blobs.dry) return;
    const settings = pending;
    failed = '';
    progressEl.textContent = t('take.rendering', { pct: 0 });
    job = renderTake(blobs.dry, settings, (p) => { progressEl.textContent = t('take.rendering', { pct: Math.round(p * 100) }); });
    paintApply();
    try {
      const tuned = await job.promise;
      job = null;
      if (!alive) return;
      const next = Object.assign({}, take, { settings, renderedWith: settings, updatedAt: Date.now() });
      await db.saveRender(next, tuned);
      take = next;
      blobs.tuned = tuned;
      const buf = await decode(tuned);
      if (!alive) return;
      buffers.tuned = buf;
      if (playing) startSources(position());
    } catch (e) {
      job = null;
      if (!alive) return;
      if (!(e && e.name === 'AbortError')) failed = e && e.name === 'QuotaExceededError' ? t('errors.storage_full') : t('take.render_failed');
    }
    paintApply();
  }

  function duration() {
    return buffers.tuned ? buffers.tuned.duration : take ? take.duration : 0;
  }

  function position() {
    if (!playing || !ac) return offset;
    return Math.min(duration(), offset + ac.currentTime - startedAt);
  }

  function stopSources() {
    for (const s of sources) {
      s.onended = null;
      try { s.stop(); } catch (_) {}
      try { s.disconnect(); } catch (_) {}
    }
    sources = [];
  }

  function startSources(at) {
    stopSources();
    for (const k of ['tuned', 'dry']) {
      const s = ac.createBufferSource();
      s.buffer = buffers[k];
      s.connect(gains[k]);
      s.start(0, Math.min(at, buffers[k].duration));
      sources.push(s);
    }
    sources[0].onended = () => {
      playing = false;
      offset = 0;
      stopSources();
      paintPlay();
      paintTime();
    };
    offset = at;
    startedAt = ac.currentTime;
  }

  function play() {
    if (!buffers.tuned || !buffers.dry) return;
    if (!ac) {
      const C = window.AudioContext || window.webkitAudioContext;
      ac = new C();
      gains = { tuned: ac.createGain(), dry: ac.createGain() };
      gains.tuned.connect(ac.destination);
      gains.dry.connect(ac.destination);
      gains.tuned.gain.value = which === 'tuned' ? 1 : 0;
      gains.dry.gain.value = which === 'dry' ? 1 : 0;
    }
    ac.resume();
    if (offset >= duration() - 0.05) offset = 0;
    startSources(offset);
    playing = true;
    paintPlay();
    tick();
  }

  function pause() {
    offset = position();
    playing = false;
    stopSources();
    paintPlay();
    paintTime();
  }

  function seek(v) {
    if (playing) startSources(v);
    else offset = v;
    paintTime();
  }

  function choose(k) {
    which = k;
    [...ab.children].forEach((b, i) => b.setAttribute('aria-pressed', String((i === 0 ? 'tuned' : 'dry') === k)));
    if (!ac) return;
    const now = ac.currentTime;
    for (const name of ['tuned', 'dry']) {
      const g = gains[name].gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(name === k ? 1 : 0, now + 0.01);
    }
  }

  function paintPlay() {
    playBtn.textContent = '';
    playBtn.append(icon(playing ? 'pause' : 'play'));
    playBtn.setAttribute('aria-label', t(playing ? 'take.pause' : 'take.play'));
  }

  function paintTime() {
    const p = position();
    if (document.activeElement !== scrub) scrub.value = String(p);
    cur.textContent = fmtDuration(Math.floor(p));
    total.textContent = fmtDuration(duration());
  }

  function tick() {
    cancelAnimationFrame(raf);
    if (!alive || !playing) return;
    paintTime();
    raf = requestAnimationFrame(tick);
  }

  async function rename() {
    if (!take) return;
    const name = await promptSheet(t('takes.rename_label'), take.name, t('takes.save'));
    if (!name || !alive) return;
    take = Object.assign({}, take, { name, updatedAt: Date.now() });
    await db.updateTake(take);
    paintHeader();
  }

  async function remove() {
    if (!take) return;
    if (!(await confirmSheet(t('takes.delete_confirm', { name: take.name }), t('takes.delete')))) return;
    if (job) job.cancel();
    if (playing) pause();
    await db.deleteTake(take.id);
    ctx.go('takes');
  }

  function openExport() {
    if (!take || !blobs.dry || !blobs.tuned) return;
    let o = null;
    const pick = (kind) => {
      o.close();
      const name = safeName(take.name) + (kind === 'dry' ? ' (original)' : '') + '.wav';
      deliverFile(name, blobs[kind], take.name).then((r) => {
        if (r === 'shared') toast(t('take.shared'));
        else if (r === 'downloaded') toast(t('take.downloaded', { name }));
      });
    };
    const option = (kind, label) => h('button', { class: 'vt-option vt-export-' + kind, type: 'button', onclick: () => pick(kind) },
      icon('download'),
      h('span', { class: 'vt-option__title' }, label),
      h('span', { class: 'vt-option__desc' }, fmtDuration(take.duration) + ' · WAV'));
    o = overlay([
      h('h2', { class: 'vt-sheet__title' }, t('take.export_title')),
      option('tuned', t('take.export_tuned')),
      option('dry', t('take.export_original')),
      h('div', { class: 'vt-sheet__actions' }, h('button', { class: 'vt-btn', type: 'button', onclick: () => o.close() }, t('takes.cancel')))
    ], () => o.close());
    o.panel.setAttribute('aria-label', t('take.export_title'));
  }

  async function load() {
    take = await db.getTake(params.takeId);
    if (!alive) return;
    if (!take) { ctx.go('takes'); return; }
    pending = normalize(take.renderedWith || take.settings);
    paintHeader();
    paintSettings();
    paintTime();
    const [dry, tuned] = await Promise.all([db.getAudio(take.id, 'dry'), db.getAudio(take.id, 'tuned')]);
    if (!alive) return;
    blobs = { dry, tuned };
    exportBtn.disabled = !(dry && tuned);
    if (params.exportNow && dry && tuned) openExport();
    if (!dry || !tuned) return;
    try {
      const [bd, bt] = await Promise.all([decode(dry), decode(tuned)]);
      if (!alive) return;
      buffers = { dry: bd, tuned: bt };
      playBtn.disabled = scrub.disabled = false;
      scrub.max = String(duration());
      paintTime();
    } catch (_) {
      failed = t('take.render_failed');
      paintApply();
    }
  }

  load();
  return () => {
    alive = false;
    cancelAnimationFrame(raf);
    if (job) job.cancel();
    stopSources();
    if (ac) { try { ac.close(); } catch (_) {} }
  };
}
