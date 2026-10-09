import { h, t, setFull, toast } from '../ui.js';
import * as db from '../db.js';
import { updatePage, loadBitmap } from '../pages.js';
import { detectIn } from '../detector.js';
import { fullQuad, isConvex } from '../geometry.js';

const NS = 'http://www.w3.org/2000/svg';

function svg(tag, attrs) {
  const el = document.createElementNS(NS, tag);
  for (const k of Object.keys(attrs)) el.setAttribute(k, attrs[k]);
  return el;
}

export function mount(root, ctx, params) {
  setFull(true);
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#6ef3c5';
  let alive = true;
  let page = null;
  let bmp = null;
  let quad = null;
  let view = { s: 1, ox: 0, oy: 0, w: 1, h: 1 };
  let drag = null;

  const canvas = h('canvas', { class: 'sc-adj__img', 'aria-hidden': 'true' });
  const loupe = h('canvas', { class: 'sc-adj__loupe', width: '240', height: '240', hidden: true, 'aria-hidden': 'true' });
  const svgEl = svg('svg', { class: 'sc-adj__svg' });
  const poly = svg('polygon', { class: 'sc-adj__poly' });
  svgEl.append(poly);
  const stage = h('div', { class: 'sc-adj__stage' }, canvas, svgEl, loupe);
  const hint = h('p', { class: 'sc-adj__hint', role: 'status', hidden: true }, t('adjust.not_found'));
  const cancel = h('button', { class: 'sc-btn', type: 'button', onclick: () => leave() }, t('adjust.cancel'));
  const detectBtn = h('button', { class: 'sc-btn', type: 'button', onclick: () => redetect() }, t('adjust.detect'));
  const wholeBtn = h('button', { class: 'sc-btn', type: 'button', onclick: () => whole() }, t('adjust.whole'));
  const apply = h('button', { class: 'sc-btn sc-btn--primary', type: 'button', onclick: () => save() }, t('adjust.apply'));
  root.append(h('section', { class: 'sc-adj', 'aria-label': t('adjust.title') },
    stage, hint,
    h('div', { class: 'sc-adj__bar' }, cancel, h('div', { class: 'sc-adj__tools' }, detectBtn, wholeBtn), apply)));

  const toScreen = (p) => [view.ox + p[0] * view.s, view.oy + p[1] * view.s];
  const clampPt = (p) => [Math.max(0, Math.min(bmp.width, p[0])), Math.max(0, Math.min(bmp.height, p[1]))];
  const toImage = (x, y) => clampPt([(x - view.ox) / view.s, (y - view.oy) / view.s]);
  const midpoint = (i) => [(quad[i][0] + quad[(i + 1) % 4][0]) / 2, (quad[i][1] + quad[(i + 1) % 4][1]) / 2];

  function handle(kind, i) {
    const g = svg('g', { class: 'sc-adj__handle', tabindex: '0', role: 'button', 'aria-label': t(kind === 'corner' ? 'adjust.corner' : 'adjust.edge', { n: i + 1 }) });
    const hit = svg('circle', { class: 'sc-adj__hit', r: '26' });
    const mark = kind === 'corner' ? svg('circle', { class: 'sc-adj__dot', r: '11' }) : svg('rect', { class: 'sc-adj__edge', x: '-12', y: '-4', width: '24', height: '8', rx: '4' });
    g.append(hit, mark);
    g.addEventListener('pointerdown', (e) => startDrag(e, kind, i, g));
    g.addEventListener('keydown', (e) => nudge(e, kind, i));
    svgEl.append(g);
    return g;
  }

  const edges = [0, 1, 2, 3].map((i) => handle('edge', i));
  const corners = [0, 1, 2, 3].map((i) => handle('corner', i));

  function paint() {
    const pts = quad.map(toScreen);
    poly.setAttribute('points', pts.map((p) => p[0] + ',' + p[1]).join(' '));
    corners.forEach((g, i) => g.setAttribute('transform', 'translate(' + pts[i][0] + ',' + pts[i][1] + ')'));
    edges.forEach((g, i) => {
      const a = pts[i], b = pts[(i + 1) % 4];
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
      g.setAttribute('transform', 'translate(' + (a[0] + b[0]) / 2 + ',' + (a[1] + b[1]) / 2 + ') rotate(' + ang + ')');
    });
  }

  function layout() {
    const r = stage.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    const pad = 28;
    const s = Math.min((r.width - 2 * pad) / bmp.width, (r.height - 2 * pad) / bmp.height);
    view = { s, ox: (r.width - bmp.width * s) / 2, oy: (r.height - bmp.height * s) / 2, w: r.width, h: r.height };
    const x = canvas.getContext('2d');
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.clearRect(0, 0, r.width, r.height);
    x.imageSmoothingQuality = 'high';
    x.drawImage(bmp, view.ox, view.oy, bmp.width * s, bmp.height * s);
    svgEl.setAttribute('viewBox', '0 0 ' + r.width + ' ' + r.height);
    paint();
  }

  function showLoupe(pt, px) {
    loupe.hidden = false;
    loupe.style.left = px < view.w / 2 ? '' : '12px';
    loupe.style.right = px < view.w / 2 ? '12px' : '';
    const x = loupe.getContext('2d');
    const src = 120 / (view.s * 2.5);
    x.fillStyle = '#000';
    x.fillRect(0, 0, 240, 240);
    x.drawImage(bmp, pt[0] - src / 2, pt[1] - src / 2, src, src, 0, 0, 240, 240);
    x.strokeStyle = accent;
    x.lineWidth = 2;
    x.beginPath();
    x.moveTo(120, 100); x.lineTo(120, 140);
    x.moveTo(100, 120); x.lineTo(140, 120);
    x.stroke();
  }

  function startDrag(e, kind, i, g) {
    e.preventDefault();
    try { g.setPointerCapture(e.pointerId); } catch (_) {}
    g.classList.add('is-active');
    const r = stage.getBoundingClientRect();
    drag = { kind, i, g, id: e.pointerId, start: toImage(e.clientX - r.left, e.clientY - r.top), base: quad.map((p) => [p[0], p[1]]) };
    g.addEventListener('pointermove', onMove);
    g.addEventListener('pointerup', endDrag);
    g.addEventListener('pointercancel', endDrag);
    showLoupe(kind === 'corner' ? quad[i] : midpoint(i), e.clientX - r.left);
  }

  function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const r = stage.getBoundingClientRect();
    const p = toImage(e.clientX - r.left, e.clientY - r.top);
    const next = drag.base.map((q) => [q[0], q[1]]);
    if (drag.kind === 'corner') {
      next[drag.i] = p;
    } else {
      const dx = p[0] - drag.start[0], dy = p[1] - drag.start[1];
      for (const k of [drag.i, (drag.i + 1) % 4]) next[k] = clampPt([drag.base[k][0] + dx, drag.base[k][1] + dy]);
    }
    if (!isConvex(next)) return;
    quad = next;
    hint.hidden = true;
    paint();
    showLoupe(drag.kind === 'corner' ? quad[drag.i] : midpoint(drag.i), e.clientX - r.left);
  }

  function endDrag() {
    if (!drag) return;
    const g = drag.g;
    g.classList.remove('is-active');
    g.removeEventListener('pointermove', onMove);
    g.removeEventListener('pointerup', endDrag);
    g.removeEventListener('pointercancel', endDrag);
    drag = null;
    loupe.hidden = true;
  }

  function nudge(e, kind, i) {
    const step = (e.shiftKey ? 10 : 1) / view.s;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d) return;
    e.preventDefault();
    const next = quad.map((p) => [p[0], p[1]]);
    for (const k of kind === 'corner' ? [i] : [i, (i + 1) % 4]) next[k] = clampPt([next[k][0] + d[0], next[k][1] + d[1]]);
    if (!isConvex(next)) return;
    quad = next;
    paint();
  }

  async function redetect() {
    detectBtn.disabled = true;
    try {
      const r = await detectIn(bmp, 640);
      if (!alive) return;
      if (r.quad) {
        quad = r.quad;
        hint.hidden = true;
        paint();
      } else {
        hint.hidden = false;
      }
    } finally {
      detectBtn.disabled = false;
    }
  }

  function whole() {
    quad = fullQuad(bmp.width, bmp.height);
    hint.hidden = true;
    paint();
  }

  function leave() {
    ctx.go('review', { docId: params.docId, page: params.page || 0 });
  }

  async function save() {
    apply.disabled = true;
    const full = fullQuad(bmp.width, bmp.height);
    const isWhole = quad.every((p, i) => Math.abs(p[0] - full[i][0]) < 0.5 && Math.abs(p[1] - full[i][1]) < 0.5);
    try {
      await updatePage(page, { quad: isWhole ? null : quad.map((p) => [p[0], p[1]]) });
      leave();
    } catch (e) {
      apply.disabled = false;
      toast(e && e.name === 'QuotaExceededError' ? t('errors.storage_full') : t('errors.render'));
    }
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); leave(); }
    else if (e.key === 'Enter' && !(e.target && e.target.tagName === 'BUTTON')) { e.preventDefault(); save(); }
  }

  const ro = new ResizeObserver(() => { if (bmp) layout(); });

  async function load() {
    page = await db.getPage(params.pageId);
    if (!alive) return;
    if (!page) { leave(); return; }
    const b = await loadBitmap(page);
    if (!alive) { b.close(); return; }
    bmp = b;
    quad = page.quad ? page.quad.map((p) => [p[0], p[1]]) : fullQuad(bmp.width, bmp.height);
    layout();
    ro.observe(stage);
    corners[0].focus();
  }

  window.addEventListener('keydown', onKey);
  load();
  return () => {
    alive = false;
    ro.disconnect();
    window.removeEventListener('keydown', onKey);
    if (bmp) bmp.close();
    setFull(false);
  };
}
