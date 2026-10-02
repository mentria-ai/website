import { s, h } from './ui.js';

function niceStep(range, count) {
  const raw = range / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const n = raw / mag;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * mag;
}

export function niceScale(min, max, count) {
  if (min === max) { const pad = Math.abs(min) * 0.1 || 1; min -= pad; max += pad; }
  const step = niceStep(max - min, count || 4);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.abs(v) < step / 1e6 ? 0 : v);
  return { lo, hi, ticks };
}

function autoWidth(w) {
  if (w) return w;
  const main = document.getElementById('fin-main');
  const cw = main ? main.clientWidth : 640;
  return cw < 600 ? Math.max(300, cw - 48) : 640;
}

let tip = null;
function showTip(x, y, text) {
  if (!tip) { tip = h('div', { class: 'ftip', role: 'presentation' }); }
  const root = document.querySelector('dialog[open]') || document.getElementById('fin') || document.body;
  if (tip.parentNode !== root) root.append(tip);
  tip.textContent = text;
  const w = tip.offsetWidth || 120;
  tip.style.left = Math.max(6, Math.min(window.innerWidth - w - 6, x - w / 2)) + 'px';
  tip.style.top = Math.max(6, y - 40) + 'px';
  tip.hidden = false;
}
function hideTip() { if (tip) tip.hidden = true; }

export function lineChart(opts) {
  const o = Object.assign({ height: 220, padL: 54, padR: 12, padT: 12, padB: 26 }, opts);
  const W = autoWidth(o.width);
  const H = o.height;
  const n = o.labels.length;
  if (W < 600 && !opts.maxLabels) o.maxLabels = 4;
  let min = Infinity;
  let max = -Infinity;
  const consider = (v) => { if (v != null && isFinite(v)) { if (v < min) min = v; if (v > max) max = v; } };
  for (const ser of o.series) ser.values.forEach(consider);
  for (const b of o.bands || []) { b.lo.forEach(consider); b.hi.forEach(consider); }
  if (o.zero !== false) { consider(0); }
  if (o.refLine != null) consider(o.refLine);
  if (!isFinite(min)) { min = 0; max = 1; }
  const sc = niceScale(min, max, o.ticks || 4);
  const x = (i) => o.padL + (n <= 1 ? (W - o.padL - o.padR) / 2 : (i * (W - o.padL - o.padR)) / (n - 1));
  const y = (v) => o.padT + (1 - (v - sc.lo) / (sc.hi - sc.lo || 1)) * (H - o.padT - o.padB);
  const svg = s('svg', { class: 'fchart', viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': o.label || '' });
  for (const tv of sc.ticks) {
    svg.append(s('line', { class: 'grid', x1: o.padL, x2: W - o.padR, y1: y(tv), y2: y(tv) }));
    svg.append(s('text', { x: o.padL - 6, y: y(tv) + 3, 'text-anchor': 'end' }, o.fmtY ? o.fmtY(tv) : String(tv)));
  }
  const every = Math.max(1, Math.ceil(n / (o.maxLabels || 7)));
  const shown = new Set();
  for (let i = 0; i < n; i += every) shown.add(i);
  if (n > 1) {
    for (const k of Array.from(shown)) if (k !== n - 1 && n - 1 - k < every * 0.75) shown.delete(k);
    shown.add(n - 1);
  }
  o.labels.forEach((lab, i) => {
    if (!shown.has(i)) return;
    svg.append(s('text', { x: x(i), y: H - 8, 'text-anchor': i === 0 && n > 1 ? 'start' : i === n - 1 && n > 1 ? 'end' : 'middle' }, lab));
  });
  for (const b of o.bands || []) {
    let d = '';
    b.hi.forEach((v, i) => { d += (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1); });
    for (let i = b.lo.length - 1; i >= 0; i--) d += 'L' + x(i).toFixed(1) + ' ' + y(b.lo[i]).toFixed(1);
    svg.append(s('path', { d: d + 'Z', fill: b.color || '#6ef3c5', 'fill-opacity': b.opacity || 0.14, stroke: 'none' }));
  }
  if (o.refLine != null) svg.append(s('line', { x1: o.padL, x2: W - o.padR, y1: y(o.refLine), y2: y(o.refLine), stroke: o.refColor || '#f472b6', 'stroke-dasharray': '4 4', 'stroke-width': 1.2 }));
  if (sc.lo < 0 && sc.hi > 0) svg.append(s('line', { class: 'axis', x1: o.padL, x2: W - o.padR, y1: y(0), y2: y(0) }));
  for (const ser of o.series) {
    let d = '';
    let started = false;
    ser.values.forEach((v, i) => {
      if (v == null || !isFinite(v)) { started = false; return; }
      d += (started ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1);
      started = true;
    });
    if (ser.fill) {
      const first = ser.values.findIndex((v) => v != null);
      const area = d + 'L' + x(n - 1).toFixed(1) + ' ' + y(Math.max(sc.lo, 0)).toFixed(1) + 'L' + x(Math.max(0, first)).toFixed(1) + ' ' + y(Math.max(sc.lo, 0)).toFixed(1) + 'Z';
      svg.append(s('path', { d: area, fill: ser.color, 'fill-opacity': 0.1, stroke: 'none' }));
    }
    svg.append(s('path', { d, fill: 'none', stroke: ser.color, 'stroke-width': ser.width || 2, 'stroke-dasharray': ser.dash || null, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    if (ser.dot !== false) {
      const li = ser.values.length - 1 - ser.values.slice().reverse().findIndex((v) => v != null && isFinite(v));
      if (li >= 0 && li < ser.values.length) svg.append(s('circle', { cx: x(li), cy: y(ser.values[li]), r: 3.2, fill: ser.color }));
    }
  }
  const cursor = s('line', { x1: 0, x2: 0, y1: o.padT, y2: H - o.padB, stroke: 'rgba(255,255,255,0.25)', 'stroke-width': 1, visibility: 'hidden' });
  svg.append(cursor);
  const hit = s('rect', { x: o.padL, y: 0, width: W - o.padL - o.padR, height: H, fill: 'transparent' });
  svg.append(hit);
  const onMove = (e) => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(n - 1, Math.round(((px - o.padL) / (W - o.padL - o.padR)) * (n - 1))));
    cursor.setAttribute('x1', x(i));
    cursor.setAttribute('x2', x(i));
    cursor.setAttribute('visibility', 'visible');
    const parts = [o.labels[i]];
    for (const ser of o.series) if (ser.values[i] != null) parts.push((ser.label ? ser.label + ' ' : '') + (o.fmtTip || o.fmtY || String)(ser.values[i]));
    for (const b of o.bands || []) if (b.label) parts.push(b.label + ' ' + (o.fmtTip || o.fmtY || String)(b.lo[i]) + ' – ' + (o.fmtTip || o.fmtY || String)(b.hi[i]));
    showTip(e.clientX, r.top + (y(o.series[0] ? o.series[0].values[i] || 0 : 0) / H) * r.height, parts.join('  ·  '));
  };
  hit.addEventListener('pointermove', onMove);
  hit.addEventListener('pointerdown', onMove);
  hit.addEventListener('pointerleave', () => { cursor.setAttribute('visibility', 'hidden'); hideTip(); });
  return svg;
}

export function barChart(opts) {
  const o = Object.assign({ height: 220, padL: 54, padR: 8, padT: 12, padB: 26 }, opts);
  const W = autoWidth(o.width);
  if (W < 600 && !opts.maxLabels) o.maxLabels = 6;
  const H = o.height;
  const groups = o.groups;
  const k = groups.length ? groups[0].values.length : 0;
  let min = 0;
  let max = 0;
  for (const g of groups) {
    if (o.stacked) {
      let pos = 0, neg = 0;
      for (const v of g.values) { if (v > 0) pos += v; else neg += v; }
      max = Math.max(max, pos);
      min = Math.min(min, neg);
    } else for (const v of g.values) { max = Math.max(max, v); min = Math.min(min, v); }
  }
  if (o.refLine != null) max = Math.max(max, o.refLine);
  const sc = niceScale(min, max, o.ticks || 4);
  const y = (v) => o.padT + (1 - (v - sc.lo) / (sc.hi - sc.lo || 1)) * (H - o.padT - o.padB);
  const slot = (W - o.padL - o.padR) / Math.max(1, groups.length);
  const svg = s('svg', { class: 'fchart', viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': o.label || '' });
  for (const tv of sc.ticks) {
    svg.append(s('line', { class: 'grid', x1: o.padL, x2: W - o.padR, y1: y(tv), y2: y(tv) }));
    svg.append(s('text', { x: o.padL - 6, y: y(tv) + 3, 'text-anchor': 'end' }, o.fmtY ? o.fmtY(tv) : String(tv)));
  }
  const every = Math.max(1, Math.ceil(groups.length / (o.maxLabels || 12)));
  groups.forEach((g, gi) => {
    const x0 = o.padL + gi * slot;
    const inner = slot * 0.72;
    const bw = o.stacked ? inner : inner / Math.max(1, k);
    let pos = 0;
    let neg = 0;
    g.values.forEach((v, vi) => {
      if (!v) return;
      let y1, y2, bx;
      if (o.stacked) {
        if (v > 0) { y1 = y(pos + v); y2 = y(pos); pos += v; } else { y1 = y(neg); y2 = y(neg + v); neg += v; }
        bx = x0 + (slot - inner) / 2;
      } else {
        y1 = v > 0 ? y(v) : y(0);
        y2 = v > 0 ? y(0) : y(v);
        bx = x0 + (slot - inner) / 2 + vi * bw;
      }
      const rect = s('rect', { x: bx.toFixed(1), y: y1.toFixed(1), width: Math.max(1, bw - (o.stacked ? 0 : 2)).toFixed(1), height: Math.max(1, y2 - y1).toFixed(1), rx: 2, fill: (o.colors && o.colors[vi]) || '#6ef3c5', 'fill-opacity': g.dim ? 0.35 : 0.9 });
      const tipText = g.label + '  ·  ' + (o.names ? o.names[vi] + ' ' : '') + (o.fmtTip || o.fmtY || String)(v);
      rect.addEventListener('pointermove', (e) => showTip(e.clientX, e.clientY, tipText));
      rect.addEventListener('pointerdown', (e) => showTip(e.clientX, e.clientY, tipText));
      rect.addEventListener('pointerleave', hideTip);
      svg.append(rect);
    });
    if (gi % every === 0) svg.append(s('text', { x: (x0 + slot / 2).toFixed(1), y: H - 8, 'text-anchor': 'middle' }, g.label));
  });
  if (o.refLine != null) svg.append(s('line', { x1: o.padL, x2: W - o.padR, y1: y(o.refLine), y2: y(o.refLine), stroke: '#f472b6', 'stroke-dasharray': '4 4', 'stroke-width': 1.2 }));
  if (sc.lo < 0) svg.append(s('line', { class: 'axis', x1: o.padL, x2: W - o.padR, y1: y(0), y2: y(0) }));
  return svg;
}

export function donut(opts) {
  const o = Object.assign({ size: 180, thick: 22 }, opts);
  const total = o.items.reduce((a, b) => a + Math.max(0, b.value), 0);
  const R = o.size / 2;
  const r = R - o.thick / 2 - 2;
  const svg = s('svg', { class: 'fchart', viewBox: '0 0 ' + o.size + ' ' + o.size, role: 'img', 'aria-label': o.label || '', style: 'max-width:' + o.size + 'px' });
  svg.append(s('circle', { cx: R, cy: R, r, fill: 'none', stroke: 'rgba(255,255,255,0.06)', 'stroke-width': o.thick }));
  if (total > 0) {
    let a0 = -Math.PI / 2;
    for (const it of o.items) {
      if (it.value <= 0) continue;
      const frac = it.value / total;
      const a1 = a0 + frac * Math.PI * 2;
      const gap = o.items.length > 1 ? 0.012 : 0;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const p0 = [R + r * Math.cos(a0 + gap), R + r * Math.sin(a0 + gap)];
      const p1 = [R + r * Math.cos(a1 - gap), R + r * Math.sin(a1 - gap)];
      const d = 'M' + p0[0].toFixed(2) + ' ' + p0[1].toFixed(2) + 'A' + r + ' ' + r + ' 0 ' + large + ' 1 ' + p1[0].toFixed(2) + ' ' + p1[1].toFixed(2);
      const path = frac >= 0.9999 ? s('circle', { cx: R, cy: R, r, fill: 'none', stroke: it.color, 'stroke-width': o.thick }) : s('path', { d, fill: 'none', stroke: it.color, 'stroke-width': o.thick, 'stroke-linecap': 'butt' });
      const tipText = it.label + '  ·  ' + (o.fmt ? o.fmt(it.value) : it.value) + '  ·  ' + Math.round(frac * 100) + '%';
      path.addEventListener('pointermove', (e) => showTip(e.clientX, e.clientY, tipText));
      path.addEventListener('pointerdown', (e) => showTip(e.clientX, e.clientY, tipText));
      path.addEventListener('pointerleave', hideTip);
      svg.append(path);
      a0 = a1;
    }
  }
  if (o.center) svg.append(s('text', { x: R, y: R + 2, 'text-anchor': 'middle', style: 'font-size:15px;font-weight:600;fill:#f8fafc' }, o.center));
  if (o.sub) svg.append(s('text', { x: R, y: R + 18, 'text-anchor': 'middle', style: 'font-size:10px' }, o.sub));
  return svg;
}

export function sparkline(values, color, width, height) {
  const W = width || 120;
  const H = height || 34;
  const vals = values.filter((v) => v != null && isFinite(v));
  const svg = s('svg', { class: 'fchart', viewBox: '0 0 ' + W + ' ' + H, 'aria-hidden': 'true', style: 'width:' + W + 'px;max-width:100%' });
  if (vals.length < 2) return svg;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const x = (i) => 2 + (i * (W - 4)) / (values.length - 1);
  const y = (v) => 3 + (1 - (v - min) / (max - min || 1)) * (H - 6);
  let d = '';
  values.forEach((v, i) => { if (v != null) d += (d ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1); });
  svg.append(s('path', { d: d + 'L' + x(values.length - 1) + ' ' + H + 'L' + x(0) + ' ' + H + 'Z', fill: color, 'fill-opacity': 0.1 }));
  svg.append(s('path', { d, fill: 'none', stroke: color, 'stroke-width': 1.6, 'stroke-linejoin': 'round' }));
  return svg;
}

export function legend(items) {
  return h('div', { class: 'flegend' }, items.map((it) => h('span', null, h('i', { style: { '--c': it.color } }), it.label)));
}
