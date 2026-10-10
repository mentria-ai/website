import { h, t, icon, toast, overlay, setFull, fmtDuration, fmtDateTime, keyName, safeName, deliverFile } from '../ui.js';
import { normalize, PRESETS, presetOf, NOTE_NAMES, scaleMask } from '../dsp/settings.js';
import { createAudio } from '../audio.js';
import { createRecorder } from '../recorder.js';
import * as db from '../db.js';
import { readListen, saveListen, openListenSheet } from './listen-sheet.js';
import { openKeySheet } from './key-sheet.js';

const SETTINGS_KEY = 'mentria.vocaltuner.settings';
const MAX_SECONDS = 300;
const TRAIL_SECONDS = 6;
const RING = 1024;
const SPEAKER_CAP = -6;
const SPEAKER_TRUST_MS = 20000;

export function readSettings() {
  try { return normalize(JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null') || { correction: 0.35, key: null }); } catch (_) { return normalize({ correction: 0.35, key: null }); }
}

export function writeSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (_) {}
}

function phoneSized() {
  try { return matchMedia('(pointer: coarse)').matches || innerWidth < 760; } catch (_) { return false; }
}

export function mount(root, ctx) {
  let alive = true;
  let settings = readSettings();
  const listen = readListen() || { mode: 'wired', db: { wired: -6, speaker: -18 } };
  let audio = null, rec = null, recording = false, raf = 0, lastTele = null;
  let saving = Promise.resolve(), pendingSave = null, finishTimer = 0, ignoreLast = false;
  let clipUntil = 0, warn = '', howled = false, speakerSince = 0, teleTick = 0;
  const listeners = new Set();
  const trail = new Float32Array(RING * 3);
  let trailHead = 0, trailCount = 0;
  const mask = scaleMask(settings.key);

  const noteName = h('span', { class: 'vt-note__name' }, '–');
  const noteOct = h('span', { class: 'vt-note__oct' }, '');
  const needle = h('canvas', { class: 'vt-needle', role: 'img', 'aria-label': t('a11y.needle') });
  const trailCanvas = h('canvas', { class: 'vt-trail', role: 'img', 'aria-label': t('a11y.trail') });
  const msg = h('p', { class: 'vt-msg', role: 'status' }, t('live.starting'));
  const live = h('p', { class: 'vt-live-region', 'aria-live': 'polite' });
  const badge = h('button', { class: 'vt-badge', type: 'button', hidden: true, onclick: () => openLatency() });
  const listenChip = h('button', { class: 'vt-chip vt-listen', type: 'button', onclick: () => chooseListen() });
  const seg = h('div', { class: 'vt-seg', role: 'group', 'aria-label': t('live.style') });
  for (const p of ['natural', 'tight', 'hard']) seg.append(h('button', { type: 'button', 'aria-pressed': 'false', onclick: () => setCorrection(PRESETS[p]) }, t('live.presets.' + p)));
  const hint = h('p', { class: 'vt-hint', hidden: true }, t('live.hard_hint'));
  const slider = h('input', { type: 'range', min: '0', max: '100', step: '1', value: String(Math.round(settings.correction * 100)), 'aria-label': t('live.correction'), oninput: () => setCorrection(slider.value / 100) });
  const keyChip = h('button', { class: 'vt-chip vt-keychip', type: 'button', onclick: () => chooseKey() });
  const bypass = h('button', { class: 'vt-btn vt-hold', type: 'button', 'aria-pressed': 'false' }, t('live.bypass'));
  const meterBar = h('span', { class: 'vt-meter__bar' });
  const meter = h('div', { class: 'vt-meter', role: 'meter', 'aria-label': t('a11y.meter'), 'aria-valuemin': '-60', 'aria-valuemax': '0', 'aria-valuenow': '-60' }, meterBar);
  const monitor = h('input', { class: 'vt-monitor', type: 'range', min: '-30', max: '0', step: '1', 'aria-label': t('live.monitor'), oninput: () => setMonitorDb(Number(monitor.value)) });
  const recBtn = h('button', { class: 'vt-rec', type: 'button', 'aria-pressed': 'false', 'aria-label': t('live.record'), disabled: true, onclick: () => (recording ? stopRecording() : startRecording()) });
  const recTime = h('span', { class: 'vt-rec__time' }, '0:00');
  const recLeft = h('span', { class: 'vt-rec__left', hidden: true });
  const closeBtn = h('button', { class: 'vt-icon-btn', type: 'button', 'aria-label': t('app.close'), onclick: () => leave() }, icon('close'));
  const resetBtn = h('button', { class: 'vt-icon-btn vt-reset', type: 'button', 'aria-label': t('live.reset_audio'), title: t('live.reset_audio'), onclick: () => resetAudio() }, icon('reset'));
  const stage = h('div', { class: 'vt-live__stage' }, h('div', { class: 'vt-note', 'aria-hidden': 'true' }, noteName, noteOct), needle, trailCanvas, msg);
  const controls = h('div', { class: 'vt-controls' },
    h('div', { class: 'vt-row' }, seg),
    hint,
    h('label', { class: 'vt-slider' }, h('span', {}, t('live.correction')), slider, h('span', {}, '')),
    h('div', { class: 'vt-row' }, keyChip, bypass, meter),
    h('label', { class: 'vt-slider' }, h('span', {}, t('live.monitor')), monitor, h('span', {}, '')));
  const recbar = h('div', { class: 'vt-recbar' }, recBtn, recTime, recLeft);
  const errorPanel = h('div', { class: 'vt-error', hidden: true });
  const section = h('section', { class: 'vt-live' },
    h('header', { class: 'vt-top' }, closeBtn, h('h1', { class: 'vt-top__title' }, t('app.name')), listenChip, badge, resetBtn),
    stage, controls, recbar, errorPanel, live);
  root.append(section);
  if (phoneSized()) setFull(true);
  document.body.dataset.vtState = 'starting';

  const handlers = {
    telemetry: (m) => { onTelemetry(m); listeners.forEach((fn) => fn(m)); },
    key: (m) => listeners.forEach((fn) => fn(m)),
    chunk: (m) => onChunk(m),
    howl: () => onHowl(),
    state: (s) => onState(s),
    devicechange: () => onDevice()
  };

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function speakerCap() {
    return !howled && speakerSince && performance.now() - speakerSince >= SPEAKER_TRUST_MS ? 0 : SPEAKER_CAP;
  }

  function monitorDb() {
    if (listen.mode === 'bluetooth') return -30;
    const v = listen.db[listen.mode];
    return listen.mode === 'speaker' ? Math.min(v, speakerCap()) : v;
  }

  function paintStyle() {
    const p = presetOf(settings.correction);
    [...seg.children].forEach((b, i) => b.setAttribute('aria-pressed', String(['natural', 'tight', 'hard'][i] === p)));
    slider.value = String(Math.round(settings.correction * 100));
    keyChip.textContent = '';
    keyChip.append(icon('key'), keyName(settings.key));
    scaleMask(settings.key, mask);
    hint.hidden = !(settings.correction >= 1 && !settings.key);
  }

  function paintListen() {
    const ic = listen.mode === 'wired' ? 'headphones' : listen.mode;
    listenChip.textContent = '';
    listenChip.append(icon(ic), t('listen.short.' + listen.mode));
    listenChip.setAttribute('aria-label', t('live.listening', { mode: t('listen.' + listen.mode) }));
    monitor.max = listen.mode === 'speaker' ? String(speakerCap()) : '0';
    monitor.value = String(monitorDb());
    monitor.disabled = listen.mode === 'bluetooth';
  }

  function setCorrection(c) {
    settings = normalize({ correction: c, key: settings.key });
    writeSettings(settings);
    if (audio) audio.setSettings(settings);
    paintStyle();
  }

  function setMonitorDb(v) {
    if (listen.mode === 'bluetooth') return;
    listen.db[listen.mode] = v;
    saveListen(listen);
    if (audio && !howled) audio.setMonitor(listen.mode, monitorDb());
  }

  function showMessage() {
    let text = '', cls = 'vt-msg';
    if (warn) { text = warn; cls += ' vt-msg--warn'; }
    else if (performance.now() < clipUntil) { text = t('live.too_loud'); cls += ' vt-msg--warn'; }
    if (msg.textContent !== text) msg.textContent = text;
    if (msg.className !== cls) msg.className = cls;
  }

  function showBadge(ms) {
    if (!ms) { badge.hidden = true; return; }
    const level = ms < 30 ? 'good' : ms < 60 ? 'ok' : 'high';
    badge.hidden = false;
    badge.dataset.level = level;
    badge.dataset.ms = String(ms);
    badge.textContent = ms + ' ms';
    badge.setAttribute('aria-label', t('live.latency.' + level, { ms }));
  }

  function openLatency() {
    const ms = Number(badge.dataset.ms) || 0;
    const level = badge.dataset.level || 'good';
    let o = null;
    o = overlay([
      h('p', { class: 'vt-sheet__msg' }, t('live.latency.' + level, { ms })),
      level === 'high' ? h('p', { class: 'vt-sheet__msg' }, t('live.latency.high_tip')) : null,
      h('div', { class: 'vt-sheet__actions' }, h('button', { class: 'vt-btn', type: 'button', onclick: () => o.close() }, t('app.close')))
    ], () => o.close());
  }

  function onTelemetry(m) {
    lastTele = m;
    if (m.voiced && m.note >= 0) {
      const name = NOTE_NAMES[((m.note % 12) + 12) % 12];
      if (noteName.textContent !== name) {
        noteName.textContent = name;
        live.textContent = t('a11y.note', { note: name });
      }
      noteOct.textContent = String(Math.floor(m.note / 12) - 1);
    } else if (noteName.textContent !== '–') {
      noteName.textContent = '–';
      noteOct.textContent = '';
    }
    if (m.clip) clipUntil = performance.now() + 500;
    const level = Math.max(-60, Math.min(0, m.level));
    meterBar.style.width = ((level + 60) / 60) * 100 + '%';
    meter.classList.toggle('is-clip', performance.now() < clipUntil);
    meter.setAttribute('aria-valuenow', String(Math.round(level)));
    const now = performance.now() / 1000;
    const n = m.trail ? m.trail.length >> 1 : 0;
    for (let i = 0; i < n; i++) {
      trail[trailHead * 3] = now - (n - 1 - i) * 0.0107;
      trail[trailHead * 3 + 1] = m.trail[2 * i];
      trail[trailHead * 3 + 2] = m.trail[2 * i + 1];
      trailHead = (trailHead + 1) % RING;
      trailCount = Math.min(RING, trailCount + 1);
    }
    if (recording && rec) {
      const s = rec.seconds();
      recTime.textContent = fmtDuration(s);
      recLeft.hidden = s < MAX_SECONDS - 30;
      if (!recLeft.hidden) recLeft.textContent = t('live.remaining', { time: fmtDuration(MAX_SECONDS - s) });
    }
    if (++teleTick % 20 === 0) {
      if (audio) showBadge(audio.latencyMs());
      if (listen.mode === 'speaker' && monitor.max !== String(speakerCap())) monitor.max = String(speakerCap());
    }
    showMessage();
  }

  function sizeCanvas(c) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(c.clientWidth * dpr)), hgt = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== w || c.height !== hgt) { c.width = w; c.height = hgt; }
    return dpr;
  }

  function colors() {
    const css = getComputedStyle(root);
    return {
      accent: css.getPropertyValue('--accent').trim() || '#6ef3c5',
      muted: css.getPropertyValue('--term-muted').trim() || '#94a3b8',
      mono: css.getPropertyValue('--font-mono').trim() || 'monospace'
    };
  }

  function drawNeedle(col) {
    const dpr = sizeCanvas(needle);
    const x = needle.getContext('2d');
    const w = needle.width, hh = needle.height;
    x.clearRect(0, 0, w, hh);
    const mid = w / 2, y = hh * 0.6, span = w * 0.42;
    x.strokeStyle = col.muted;
    x.lineWidth = dpr;
    x.beginPath();
    x.moveTo(mid - span, y);
    x.lineTo(mid + span, y);
    for (let c = -50; c <= 50; c += 25) { const px = mid + (c / 50) * span; x.moveTo(px, y - 6 * dpr); x.lineTo(px, y + 6 * dpr); }
    x.stroke();
    const m = lastTele;
    if (!m || !m.voiced) return;
    const dev = Math.max(-50, Math.min(50, -m.errorCents));
    const fixed = Math.max(-50, Math.min(50, dev + m.correctionCents));
    x.fillStyle = col.accent;
    x.globalAlpha = 0.35;
    const a = mid + (Math.min(dev, fixed) / 50) * span, b = mid + (Math.max(dev, fixed) / 50) * span;
    x.fillRect(a, y - 5 * dpr, Math.max(2 * dpr, b - a), 10 * dpr);
    x.globalAlpha = 1;
    x.strokeStyle = col.accent;
    x.lineWidth = 3 * dpr;
    x.beginPath();
    const px = mid + (dev / 50) * span;
    x.moveTo(px, y - 18 * dpr);
    x.lineTo(px, y + 18 * dpr);
    x.stroke();
  }

  function drawTrail(col) {
    const dpr = sizeCanvas(trailCanvas);
    const x = trailCanvas.getContext('2d');
    const w = trailCanvas.width, hh = trailCanvas.height;
    x.clearRect(0, 0, w, hh);
    const now = performance.now() / 1000;
    let centre = 0, cn = 0;
    for (let k = 0; k < trailCount; k++) {
      const i = (trailHead - 1 - k + RING) % RING;
      if (now - trail[i * 3] > TRAIL_SECONDS) break;
      if (trail[i * 3 + 1] > 0) { centre += trail[i * 3 + 1]; cn++; }
    }
    centre = cn ? Math.round(centre / cn) : 60;
    const lo = centre - 7, hi = centre + 7;
    const yOf = (mv) => hh - ((mv - lo) / (hi - lo)) * hh;
    x.font = 11 * dpr + 'px ' + col.mono;
    for (let n = Math.ceil(lo); n <= hi; n++) {
      const pc = ((n % 12) + 12) % 12;
      if (!mask[pc]) continue;
      const y = yOf(n);
      x.strokeStyle = col.muted;
      x.globalAlpha = settings.key && pc === settings.key.root ? 0.6 : 0.2;
      x.lineWidth = dpr;
      x.beginPath();
      x.moveTo(0, y);
      x.lineTo(w, y);
      x.stroke();
      x.globalAlpha = 0.8;
      x.fillStyle = col.muted;
      x.fillText(NOTE_NAMES[pc], 6 * dpr, y - 3 * dpr);
    }
    x.globalAlpha = 1;
    for (const [field, width] of [[2, 3], [1, 1]]) {
      x.strokeStyle = field === 2 ? col.accent : col.muted;
      x.lineWidth = width * dpr;
      x.beginPath();
      let pen = false;
      for (let k = trailCount - 1; k >= 0; k--) {
        const i = (trailHead - 1 - k + RING) % RING;
        const age = now - trail[i * 3];
        if (age > TRAIL_SECONDS) continue;
        const v = trail[i * 3 + field];
        if (!v) { pen = false; continue; }
        const px = w - (age / TRAIL_SECONDS) * w, py = yOf(v);
        if (pen) x.lineTo(px, py); else x.moveTo(px, py);
        pen = true;
      }
      x.stroke();
    }
  }

  function frame() {
    if (!alive) return;
    raf = requestAnimationFrame(frame);
    if (document.hidden || stage.hidden) return;
    const col = colors();
    drawNeedle(col);
    drawTrail(col);
  }

  async function start() {
    document.body.dataset.vtState = 'starting';
    errorPanel.hidden = true;
    stage.hidden = controls.hidden = recbar.hidden = false;
    warn = '';
    msg.textContent = t('live.starting');
    ignoreLast = false;
    if (!audio) audio = createAudio(handlers);
    const mine = audio;
    mine.setSettings(settings);
    try {
      const r = await mine.start();
      if (!alive || audio !== mine) { mine.stop(); return; }
      speakerSince = performance.now();
      paintListen();
      audio.setMonitor(listen.mode, monitorDb());
      recBtn.disabled = false;
      showBadge(r.latencyMs);
      if (r.echoOn) toast(t('listen.echo_on'));
      document.body.dataset.vtState = 'live';
      showMessage();
      onStarted();
    } catch (e) {
      if (!alive || audio !== mine) return;
      if (e && e.code === 'suspended') showResume();
      else showError((e && e.code) || 'failed');
    }
  }

  function showResume() {
    document.body.dataset.vtState = 'resume';
    recBtn.disabled = true;
    stage.hidden = controls.hidden = recbar.hidden = true;
    errorPanel.hidden = false;
    errorPanel.textContent = '';
    errorPanel.append(h('button', { class: 'vt-btn vt-btn--primary vt-btn--lg vt-resume-btn', type: 'button', onclick: () => start() }, t('live.resume')));
  }

  function showError(code) {
    document.body.dataset.vtState = 'error';
    recBtn.disabled = true;
    stage.hidden = controls.hidden = recbar.hidden = true;
    errorPanel.hidden = false;
    errorPanel.textContent = '';
    const known = ['denied', 'no-mic', 'insecure', 'unsupported'].includes(code) ? code.replace('-', '_') : 'failed';
    errorPanel.append(h('p', { class: 'vt-error__msg' }, t('errors.' + known)));
    if (known === 'denied' && /iPhone|iPad/.test(navigator.userAgent)) errorPanel.append(h('p', { class: 'vt-error__hint' }, t('errors.denied_ios')));
    errorPanel.append(h('div', { class: 'vt-sheet__actions' },
      h('button', { class: 'vt-btn', type: 'button', onclick: () => leave() }, t('take.back')),
      known === 'insecure' || known === 'unsupported' ? null : h('button', { class: 'vt-btn vt-btn--primary', type: 'button', onclick: () => start() }, t('errors.retry'))));
  }

  async function chooseListen() {
    const mode = await openListenSheet(listen.mode);
    if (!mode || !alive) return;
    listen.mode = mode;
    saveListen(listen);
    howled = false;
    speakerSince = performance.now();
    warn = '';
    paintListen();
    if (audio) {
      audio.howlReset();
      audio.setMonitor(mode, monitorDb());
    }
    showMessage();
  }

  function onHowl() {
    if (!audio) return;
    audio.muteMonitor();
    howled = true;
    listen.db.speaker = Math.max(-30, listen.db.speaker - 6);
    saveListen(listen);
    paintListen();
    warn = t('live.feedback');
    toast(warn);
    showMessage();
  }

  async function chooseKey() {
    const key = await openKeySheet({ key: settings.key, audio, subscribe });
    if (key === undefined || !alive) return;
    settings = normalize({ correction: settings.correction, key });
    writeSettings(settings);
    if (audio) audio.setSettings(settings);
    paintStyle();
  }

  function holdOn(e) {
    if (e) e.preventDefault();
    bypass.setAttribute('aria-pressed', 'true');
    if (audio) audio.setBypass(true);
  }

  function holdOff() {
    if (bypass.getAttribute('aria-pressed') !== 'true') return;
    bypass.setAttribute('aria-pressed', 'false');
    if (audio) audio.setBypass(false);
  }

  bypass.addEventListener('pointerdown', holdOn);
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) bypass.addEventListener(ev, holdOff);
  bypass.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) holdOn(e); });
  bypass.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') holdOff(); });

  function startRecording() {
    if (!audio || audio.state !== 'running' || recording || pendingSave) return;
    rec = createRecorder(audio.sampleRate, MAX_SECONDS);
    recording = true;
    recBtn.setAttribute('aria-pressed', 'true');
    recBtn.setAttribute('aria-label', t('live.stop'));
    recTime.textContent = '0:00';
    audio.record(true);
  }

  function stopRecording(immediate) {
    if (!recording) return saving;
    recording = false;
    recBtn.setAttribute('aria-pressed', 'false');
    recBtn.setAttribute('aria-label', t('live.record'));
    recBtn.disabled = true;
    recLeft.hidden = true;
    saving = new Promise((resolve) => { pendingSave = resolve; });
    const running = audio && audio.state === 'running';
    if (audio) audio.record(false);
    if (running && !immediate) {
      finishTimer = setTimeout(() => { ignoreLast = true; finishTake(); }, 1500);
    } else {
      ignoreLast = !!running;
      finishTake();
    }
    return saving;
  }

  function onChunk(m) {
    if (m.last && ignoreLast) {
      ignoreLast = false;
      return;
    }
    const r = rec;
    const full = r ? r.add(m.dry, m.tuned) : false;
    if (audio) audio.returnChunk(m);
    if (!r) return;
    if (m.last) finishTake();
    else if (full && recording) stopRecording();
  }

  async function finishTake() {
    clearTimeout(finishTimer);
    const r = rec;
    rec = null;
    const done = pendingSave;
    if (r) {
      const out = r.finish();
      if (out.duration >= 1) {
        const now = Date.now();
        const take = { id: db.newId(), name: t('takes.default_name', { date: fmtDateTime(now) }), createdAt: now, updatedAt: now, duration: out.duration, sampleRate: r.sampleRate, settings: { correction: settings.correction, key: settings.key }, renderedWith: { correction: settings.correction, key: settings.key } };
        await saveTakeSafely(take, out);
      }
    }
    pendingSave = null;
    if (alive && audio && audio.state === 'running') recBtn.disabled = false;
    if (done) done();
  }

  async function saveTakeSafely(take, out) {
    try {
      await db.saveTake(take, { dry: out.dry, tuned: out.tuned });
      toast(t('live.saved'));
    } catch (e) {
      if (alive) holdUnsaved(take, out, saveError(e));
    }
  }

  function saveError(e) {
    return e && e.name === 'QuotaExceededError' ? t('errors.storage_full') : t('errors.save_failed');
  }

  function holdUnsaved(take, out, message) {
    let o = null, exported = false;
    const note = h('p', { class: 'vt-sheet__msg', role: 'alert' }, message);
    const closeBtn = h('button', { class: 'vt-btn', type: 'button', hidden: true, onclick: () => o.close() }, t('app.close'));
    const exportAs = (kind) => {
      const name = safeName(take.name) + (kind === 'dry' ? ' (original)' : '') + '.wav';
      deliverFile(name, out[kind], take.name).then((r) => {
        if (r === 'cancelled') return;
        exported = true;
        closeBtn.hidden = false;
      });
    };
    const retry = async () => {
      try {
        await db.saveTake(take, { dry: out.dry, tuned: out.tuned });
        o.close();
        toast(t('live.saved'));
      } catch (e) {
        note.textContent = saveError(e);
      }
    };
    const option = (kind, label) => h('button', { class: 'vt-option vt-export-' + kind, type: 'button', onclick: () => exportAs(kind) },
      icon('download'),
      h('span', { class: 'vt-option__title' }, label),
      h('span', { class: 'vt-option__desc' }, fmtDuration(take.duration) + ' · WAV'));
    o = overlay([
      note,
      option('tuned', t('take.export_tuned')),
      option('dry', t('take.export_original')),
      h('div', { class: 'vt-sheet__actions' }, closeBtn, h('button', { class: 'vt-btn vt-btn--primary vt-retry', type: 'button', onclick: retry }, t('errors.retry')))
    ], () => { if (exported) o.close(); });
  }

  function resetAudio() {
    stopRecording(true);
    if (audio) audio.stop();
    audio = null;
    start();
  }

  let deviceSig = '', deviceTimer = 0, lastTeleAt = 0, teleCount = 0, windowStart = 0, slowWindows = 0, lite = false, deadSince = 0;
  const watchTimer = setInterval(watchdog, 1000);

  subscribe((m) => {
    if (m.type !== 'telemetry') return;
    lastTeleAt = performance.now();
    teleCount++;
    const monitoring = listen.mode !== 'bluetooth' && bypass.getAttribute('aria-pressed') !== 'true';
    if (monitoring && m.level > -60 && m.outLevel < -90) {
      if (!deadSince) deadSince = lastTeleAt;
    } else deadSince = 0;
  });

  async function deviceSignature() {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      return list.filter((d) => d.kind === 'audioinput' || d.kind === 'audiooutput').map((d) => d.kind + ':' + d.deviceId + ':' + d.label).sort().join('|');
    } catch (_) {
      return '';
    }
  }

  function onStarted() {
    lastTeleAt = performance.now();
    deadSince = 0;
    windowStart = 0;
    slowWindows = 0;
    lite = false;
    deviceSignature().then((sig) => { deviceSig = sig; });
  }

  function watchdog() {
    if (!alive) { clearInterval(watchTimer); return; }
    if (!audio || audio.state !== 'running' || document.body.dataset.vtState !== 'live') { windowStart = 0; return; }
    const now = performance.now();
    const hintText = t('live.dead_hint');
    const dead = now - lastTeleAt > 2000 || (deadSince && now - deadSince > 2000);
    if (dead && !warn) { warn = hintText; showMessage(); }
    else if (!dead && warn === hintText) { warn = ''; showMessage(); }
    if (!windowStart) { windowStart = now; teleCount = 0; return; }
    if (now - windowStart < 2000) return;
    slowWindows = teleCount < 30 ? slowWindows + 1 : 0;
    windowStart = now;
    teleCount = 0;
    if (slowWindows >= 2 && !lite) {
      lite = true;
      audio.setLite(true);
    }
  }

  async function pauseForResume() {
    if (document.body.dataset.vtState === 'resume') return;
    document.body.dataset.vtState = 'resume';
    await stopRecording(true);
    if (audio) audio.stop();
    audio = null;
    if (alive) showResume();
  }

  function onState(s) {
    if (s === 'interrupted' && alive) pauseForResume();
  }

  function onDevice() {
    clearTimeout(deviceTimer);
    deviceTimer = setTimeout(async () => {
      if (!alive || !audio) return;
      const sig = await deviceSignature();
      if (!alive || !audio || sig === deviceSig) return;
      deviceSig = sig;
      audio.muteMonitor();
      await stopRecording(true);
      if (audio) audio.stop();
      audio = null;
      const mode = await openListenSheet(listen.mode);
      if (!alive) return;
      if (mode) {
        listen.mode = mode;
        saveListen(listen);
        howled = false;
        paintListen();
      }
      start();
    }, 1000);
  }

  function onVisibility() {
    if (document.visibilityState === 'hidden' && (audio || recording)) pauseForResume();
  }

  async function leave() {
    await stopRecording();
    if (audio) audio.stop();
    audio = null;
    ctx.go('takes');
  }

  document.addEventListener('visibilitychange', onVisibility);
  paintStyle();
  paintListen();
  raf = requestAnimationFrame(frame);
  if (readListen()) start();
  else openListenSheet(null).then((mode) => {
    if (!alive) return;
    if (!mode) { ctx.go('takes'); return; }
    listen.mode = mode;
    saveListen(listen);
    paintListen();
    start();
  });

  return () => {
    alive = false;
    cancelAnimationFrame(raf);
    document.removeEventListener('visibilitychange', onVisibility);
    listeners.clear();
    if (recording) stopRecording(true);
    if (audio) audio.stop();
    audio = null;
    delete document.body.dataset.vtState;
  };
}
