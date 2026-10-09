import { h, t, tp, icon, setFull, toast, confirmSheet, objectUrl } from '../ui.js';
import * as camera from '../camera.js';
import { detect, detectIn } from '../detector.js';
import { createTracker } from '../tracker.js';
import { mapVideoQuadToPhoto } from '../geometry.js';
import { addPage, fitBitmap, newDoc } from '../pages.js';
import { importFiles } from '../importer.js';
import * as db from '../db.js';

const AUTO_KEY = 'mentria.scanner.auto';

function readAuto() {
  try { return localStorage.getItem(AUTO_KEY) !== 'off'; } catch (_) { return true; }
}

function writeAuto(on) {
  try { localStorage.setItem(AUTO_KEY, on ? 'on' : 'off'); } catch (_) {}
}

export function mount(root, ctx, params) {
  setFull(true);
  const existing = params.docId || null;
  const replace = params.replace || null;
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#6ef3c5';
  const tracker = createTracker();
  const added = [];
  let doc = null;
  let auto = readAuto();
  let alive = true;
  let busy = false;
  let raf = 0;
  let last = null;
  let noneSince = 0;
  let shooting = false;
  let pending = 0;
  let torch = false;
  let queue = Promise.resolve();

  const video = h('video', { class: 'sc-cam__video', muted: true, playsInline: true, autoplay: true, 'aria-hidden': 'true' });
  const overlayCanvas = h('canvas', { class: 'sc-cam__overlay', 'aria-hidden': 'true' });
  const flashFx = h('div', { class: 'sc-cam__flash', 'aria-hidden': 'true' });
  const status = h('p', { class: 'sc-cam__status', role: 'status' }, t('capture.starting'));
  const note = h('div', { class: 'sc-cam__note', hidden: true });
  const live = h('p', { class: 'sc-live', 'aria-live': 'polite' });
  const ring = h('span', { class: 'sc-cam__ring', 'aria-hidden': 'true' });
  const shutter = h('button', { class: 'sc-cam__shutter', type: 'button', 'aria-label': t('capture.shutter'), disabled: true, onclick: () => shoot() }, ring);
  const flashBtn = h('button', { class: 'sc-icon-btn', type: 'button', 'aria-label': t('capture.flash'), 'aria-pressed': 'false', hidden: true, onclick: toggleTorch }, icon('flash'));
  const autoBtn = h('button', { class: 'sc-chip', type: 'button', 'aria-pressed': String(auto), onclick: toggleAuto }, auto ? t('capture.auto') : t('capture.manual'));
  const fileInput = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: onFiles });
  const importBtn = h('button', { class: 'sc-icon-btn', type: 'button', 'aria-label': t('capture.import'), hidden: !!replace, onclick: () => fileInput.click() }, icon('image'));
  const closeBtn = h('button', { class: 'sc-icon-btn', type: 'button', 'aria-label': t('app.close'), onclick: () => close() }, icon('close'));
  const stackImg = h('img', { alt: '' });
  const count = h('span', { class: 'sc-cam__count', 'aria-hidden': 'true' });
  const stack = h('button', { class: 'sc-cam__stack', type: 'button', hidden: true, onclick: () => done() }, stackImg, count);
  const doneBtn = h('button', { class: 'sc-btn sc-btn--primary', type: 'button', hidden: true, onclick: () => done() }, t('capture.done'));

  root.append(h('section', { class: 'sc-cam' },
    video, overlayCanvas, flashFx,
    h('div', { class: 'sc-cam__top' }, closeBtn, autoBtn, flashBtn),
    h('div', { class: 'sc-cam__mid' }, status, note),
    h('div', { class: 'sc-cam__bottom' }, importBtn, shutter, h('div', { class: 'sc-cam__right' }, stack, doneBtn)),
    fileInput, live));

  async function getDoc() {
    if (doc) return doc;
    doc = existing ? await db.getDoc(existing) : null;
    if (!doc) doc = newDoc();
    return doc;
  }

  async function start() {
    try {
      const info = await camera.open(video);
      if (!alive || !info) return;
      flashBtn.hidden = !info.torch;
      shutter.disabled = false;
      status.hidden = false;
      status.textContent = t('capture.looking');
      noneSince = performance.now();
      cancelAnimationFrame(raf);
      loop();
    } catch (e) {
      if (alive) showError(e);
    }
  }

  function showError(e) {
    const n = e && e.name;
    const key = n === 'NotAllowedError' || n === 'SecurityError' ? 'camera.denied'
      : n === 'NotFoundError' || n === 'OverconstrainedError' ? 'camera.no_camera'
        : n === 'InsecureError' ? 'camera.insecure' : 'camera.error';
    note.textContent = '';
    note.append(h('p', {}, t(key)), h('button', { class: 'sc-btn sc-btn--primary', type: 'button', onclick: () => fileInput.click() }, icon('image'), t('capture.import')));
    note.hidden = false;
    status.hidden = true;
    shutter.disabled = true;
  }

  function draw(s) {
    const rect = overlayCanvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = Math.max(1, Math.round(rect.width * dpr)), ch = Math.max(1, Math.round(rect.height * dpr));
    if (overlayCanvas.width !== cw || overlayCanvas.height !== ch) { overlayCanvas.width = cw; overlayCanvas.height = ch; }
    const x = overlayCanvas.getContext('2d');
    x.clearRect(0, 0, cw, ch);
    if (!s || !s.quad || !video.videoWidth) return;
    const vw = video.videoWidth, vh = video.videoHeight;
    const sc = Math.max(cw / vw, ch / vh), dw = vw * sc, dh = vh * sc, ox = (cw - dw) / 2, oy = (ch - dh) / 2;
    x.beginPath();
    s.quad.forEach((p, i) => {
      const px = ox + p[0] * dw, py = oy + p[1] * dh;
      if (i) x.lineTo(px, py);
      else x.moveTo(px, py);
    });
    x.closePath();
    x.fillStyle = s.state === 'found' ? 'rgba(110, 243, 197, 0.10)' : 'rgba(110, 243, 197, 0.22)';
    x.fill();
    x.lineWidth = 3 * dpr;
    x.lineJoin = 'round';
    x.strokeStyle = accent;
    x.stroke();
  }

  function statusText(s, now) {
    if (s.state === 'none') {
      if (!noneSince) noneSince = now;
      return now - noneSince > 4000 ? t('capture.tip_contrast') : t('capture.looking');
    }
    noneSince = 0;
    return s.captured ? t('capture.captured') : t('capture.hold');
  }

  function loop() {
    if (!alive) return;
    raf = requestAnimationFrame(loop);
    if (busy || !video.videoWidth || document.hidden) return;
    busy = true;
    let img = null;
    try { img = camera.frame(384); } catch (_) { busy = false; return; }
    detect(img).then((r) => {
      busy = false;
      if (!alive) return;
      const now = performance.now();
      last = tracker.push(r, now);
      draw(last);
      status.textContent = statusText(last, now);
      ring.style.setProperty('--p', auto ? String(last.progress || 0) : '0');
      if (auto && last.state === 'fire') shoot();
    }, () => { busy = false; });
  }

  function showStack(page, d) {
    if (page && page.thumb) objectUrl(page.thumb, stackImg);
    const n = replace ? 1 : added.length;
    count.textContent = String(n);
    stack.setAttribute('aria-label', t('capture.done') + ', ' + tp('capture.count', n));
    stack.hidden = false;
    doneBtn.hidden = false;
    live.textContent = t('a11y.captured', { n: d.pageIds.length });
  }

  function fail(e) {
    toast(e && e.name === 'QuotaExceededError' ? t('errors.storage_full') : t('errors.render'));
  }

  async function process(shot, vq, vw, vh) {
    const bmp = await fitBitmap(shot);
    try {
      let quad = vq ? mapVideoQuadToPhoto(vq, vw, vh, bmp.width, bmp.height) : null;
      try {
        const found = await detectIn(bmp, 640);
        if (found.quad) quad = found.quad;
      } catch (_) {}
      const d = await getDoc();
      const old = replace ? await db.getPage(replace) : null;
      const page = await addPage(d, bmp, quad, { replace, filter: old ? old.filter : undefined });
      added.push(page.id);
      showStack(page, d);
    } finally {
      bmp.close();
    }
  }

  async function shoot() {
    if (shooting || pending >= 2 || !alive || shutter.disabled) return;
    shooting = true;
    pending++;
    tracker.markCaptured(performance.now());
    const vq = last && last.quad ? last.quad.map((p) => [p[0], p[1]]) : null;
    const vw = video.videoWidth, vh = video.videoHeight;
    flashFx.classList.remove('is-on');
    void flashFx.offsetWidth;
    flashFx.classList.add('is-on');
    status.textContent = t('capture.captured');
    try { if (navigator.vibrate) navigator.vibrate(12); } catch (_) {}
    let shot = null;
    try { shot = await camera.still(); } catch (_) { shot = null; }
    shooting = false;
    if (!shot || !alive) {
      pending--;
      if (shot) shot.close();
      return;
    }
    const job = queue.then(() => process(shot, vq, vw, vh)).catch(fail).finally(() => { pending--; });
    queue = job;
    if (replace) {
      await job;
      if (alive) done();
    }
  }

  async function onFiles() {
    const files = [...fileInput.files];
    fileInput.value = '';
    if (!files.length) return;
    const job = queue.then(async () => {
      const d = await getDoc();
      const before = d.pageIds.length;
      const r = await importFiles(files, d, (n, total) => { status.hidden = false; status.textContent = t('import.working', { n, total }); });
      r.failed.forEach((name) => toast(t('import.failed', { name })));
      const fresh = d.pageIds.slice(before);
      added.push(...fresh);
      if (fresh.length) showStack(await db.getPage(fresh[fresh.length - 1]), d);
    }).catch(fail);
    queue = job;
    await job;
    if (alive && !note.hidden && doc && doc.pageIds.length) done();
  }

  function toggleAuto() {
    auto = !auto;
    writeAuto(auto);
    autoBtn.setAttribute('aria-pressed', String(auto));
    autoBtn.textContent = auto ? t('capture.auto') : t('capture.manual');
    ring.style.setProperty('--p', '0');
  }

  async function toggleTorch() {
    torch = !torch;
    if (!(await camera.setTorch(torch))) torch = false;
    flashBtn.setAttribute('aria-pressed', String(torch));
  }

  function leave() {
    if (existing) ctx.go('review', { docId: existing, page: params.page || 0 });
    else ctx.go('library');
  }

  async function done() {
    await queue.catch(() => {});
    if (!alive) return;
    if (!doc || !doc.pageIds.length) { leave(); return; }
    const at = replace ? doc.pageIds.indexOf(added[0]) : doc.pageIds.length - 1;
    ctx.go('review', { docId: doc.id, page: Math.max(0, at) });
  }

  async function close() {
    if (added.length && !replace) {
      if (!(await confirmSheet(t('capture.discard_confirm'), t('capture.discard')))) return;
      await queue.catch(() => {});
      if (doc && !existing) {
        await db.deleteDoc(doc.id);
      } else if (doc) {
        doc.pageIds = doc.pageIds.filter((id) => !added.includes(id));
        await db.saveDoc(doc, added);
      }
    }
    leave();
  }

  function onKey(e) {
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'BUTTON') return;
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); shoot(); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  }

  function onVis() {
    if (document.hidden) {
      cancelAnimationFrame(raf);
      camera.close();
      shutter.disabled = true;
    } else if (alive && note.hidden) {
      start();
    }
  }

  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('keydown', onKey);
  start();

  return () => {
    alive = false;
    cancelAnimationFrame(raf);
    camera.close();
    document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('keydown', onKey);
    setFull(false);
  };
}
