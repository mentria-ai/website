const STYLE_ID = 'sk-osd-style';

const STYLE = [
  '.sk-osd{position:absolute;inset:0;z-index:11;pointer-events:none;container-type:size;overflow:hidden;',
  'font-family:var(--font-mono,ui-monospace,Menlo,Consolas,monospace);color:#6ef3c5;text-transform:uppercase;letter-spacing:.06em;',
  '-webkit-user-select:none;user-select:none;transition:opacity .2s ease;',
  '--sk-mint:#6ef3c5;--sk-amber:#ffb547;--sk-red:#ff5d6c;--sk-shadow:0 1px 2px rgba(0,0,0,.85),0 0 10px rgba(0,0,0,.35);',
  '--sk-st:env(safe-area-inset-top,0px);--sk-sr:env(safe-area-inset-right,0px);--sk-sb:env(safe-area-inset-bottom,0px);--sk-sl:env(safe-area-inset-left,0px)}',
  '.sk-osd[hidden]{display:none}',
  '[data-gk-menu="full"]>.sk-osd{opacity:0}',
  '.sk-osd *{box-sizing:border-box}',
  '.sk-osd__t{text-shadow:var(--sk-shadow);font-variant-numeric:tabular-nums;white-space:nowrap}',
  '.sk-osd__k{display:block;font-size:clamp(8px,2.1cqh,11px);letter-spacing:.2em;color:rgba(234,250,244,.72);text-shadow:var(--sk-shadow)}',
  '.sk-osd__tl{position:absolute;top:calc(var(--sk-st) + 12px);left:calc(var(--sk-sl) + 14px);display:flex;flex-direction:column;gap:4px}',
  '.sk-osd__time{font-size:clamp(20px,6.6cqh,38px);font-weight:700;line-height:1;letter-spacing:.01em}',
  '.sk-osd__row{display:flex;gap:12px;align-items:baseline;font-size:clamp(11px,3.1cqh,16px);font-weight:600}',
  '.sk-osd__pen{color:var(--sk-amber)}',
  '.sk-osd__pen[hidden]{display:none}',
  '.sk-osd__tc{position:absolute;top:calc(var(--sk-st) + 12px);left:50%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:2px;opacity:0;transition:opacity .25s ease}',
  '.sk-osd__tc.is-on{opacity:1}',
  '.sk-osd__split{font-size:clamp(16px,5.2cqh,30px);font-weight:700}',
  '.sk-osd__split.is-good{color:var(--sk-mint)}',
  '.sk-osd__split.is-bad{color:var(--sk-amber)}',
  '.sk-osd__tr{position:absolute;top:calc(var(--sk-st) + 14px);right:calc(var(--sk-sr) + 14px + var(--gk-chrome-w,0px));display:flex;flex-direction:column;align-items:flex-end;gap:4px;font-size:clamp(10px,2.8cqh,14px);font-weight:600}',
  '.sk-osd__mode{padding:2px 7px;border:1px solid rgba(110,243,197,.55);border-radius:4px;background:rgba(3,12,9,.35);box-shadow:0 0 12px rgba(110,243,197,.12)}',
  '.sk-osd__volt{color:rgba(234,250,244,.86)}',
  '.sk-osd__bl{position:absolute;bottom:calc(var(--sk-sb) + 14px);left:calc(var(--sk-sl) + 14px);display:flex;gap:18px;align-items:flex-end}',
  '.sk-osd__big{font-size:clamp(20px,6.4cqh,36px);font-weight:700;line-height:1}',
  '.sk-osd__unit{font-size:clamp(9px,2.3cqh,12px);margin-left:4px;color:rgba(234,250,244,.75)}',
  '.sk-osd__bc{position:absolute;bottom:calc(var(--sk-sb) + 16px);left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:8px;font-size:clamp(9px,2.4cqh,12px);font-weight:600}',
  '.sk-osd__bar{position:relative;width:clamp(90px,22cqw,190px);height:7px;border:1px solid rgba(110,243,197,.6);border-radius:2px;background:rgba(3,12,9,.35);box-shadow:var(--sk-shadow)}',
  '.sk-osd__bar i{position:absolute;left:0;top:0;bottom:0;width:0;background:var(--sk-mint);box-shadow:0 0 10px rgba(110,243,197,.6)}',
  '.sk-osd__bar b{position:absolute;top:-3px;bottom:-3px;width:1px;background:rgba(234,250,244,.6);left:50%}',
  '.sk-osd__cross{position:absolute;left:50%;top:50%;width:46px;height:14px;margin:-7px 0 0 -23px;opacity:.85}',
  '.sk-osd__cross::before,.sk-osd__cross::after{content:"";position:absolute;top:6px;width:16px;height:2px;background:var(--sk-mint);box-shadow:var(--sk-shadow)}',
  '.sk-osd__cross::before{left:0}.sk-osd__cross::after{right:0}',
  '.sk-osd__cross i{position:absolute;left:50%;top:50%;width:4px;height:4px;margin:-2px 0 0 -2px;border-radius:50%;background:var(--sk-mint);box-shadow:var(--sk-shadow)}',
  '.sk-osd__horizon{position:absolute;left:0;top:0;width:42cqw;height:2px;margin-left:-21cqw;margin-top:-1px;will-change:transform;opacity:.9}',
  '.sk-osd__horizon::before,.sk-osd__horizon::after{content:"";position:absolute;top:0;height:2px;width:38%;background:rgba(234,250,244,.92);box-shadow:var(--sk-shadow)}',
  '.sk-osd__horizon::before{left:0}.sk-osd__horizon::after{right:0}',
  '.sk-osd__horizon i{position:absolute;top:0;width:2px;height:8px;background:rgba(234,250,244,.92)}',
  '.sk-osd__horizon i:first-child{left:0}.sk-osd__horizon i:last-child{right:0}',
  '.sk-osd__fpm{position:absolute;left:0;top:0;width:26px;height:14px;margin:-7px 0 0 -13px;will-change:transform}',
  '.sk-osd__fpm::before{content:"";position:absolute;left:8px;top:2px;width:10px;height:10px;border:2px solid var(--sk-mint);border-radius:50%;box-shadow:var(--sk-shadow)}',
  '.sk-osd__fpm::after{content:"";position:absolute;left:0;right:0;top:6px;height:2px;background:linear-gradient(90deg,var(--sk-mint) 0 7px,transparent 7px 19px,var(--sk-mint) 19px)}',
  '.sk-osd__mark{position:absolute;left:0;top:0;width:44px;height:44px;margin:-22px 0 0 -22px;will-change:transform}',
  '.sk-osd__mark i{position:absolute;width:12px;height:12px;border-color:var(--sk-mint);border-style:solid;filter:drop-shadow(0 0 4px rgba(110,243,197,.7))}',
  '.sk-osd__mark i:nth-child(1){left:0;top:0;border-width:2px 0 0 2px}',
  '.sk-osd__mark i:nth-child(2){right:0;top:0;border-width:2px 2px 0 0}',
  '.sk-osd__mark i:nth-child(3){left:0;bottom:0;border-width:0 0 2px 2px}',
  '.sk-osd__mark i:nth-child(4){right:0;bottom:0;border-width:0 2px 2px 0}',
  '.sk-osd__mark span{position:absolute;left:50%;top:100%;transform:translateX(-50%);margin-top:4px;font-size:clamp(9px,2.4cqh,12px);font-weight:700}',
  '.sk-osd__arrow{position:absolute;left:0;top:0;width:34px;height:34px;margin:-17px 0 0 -17px;will-change:transform}',
  '.sk-osd__arrow svg{width:100%;height:100%;overflow:visible;filter:drop-shadow(0 0 5px rgba(110,243,197,.65)) drop-shadow(0 1px 2px rgba(0,0,0,.8))}',
  '.sk-osd__arrow span{position:absolute;left:50%;top:100%;transform:translateX(-50%);font-size:clamp(9px,2.3cqh,11px);font-weight:700;white-space:nowrap}',
  '.sk-osd__crash{position:absolute;left:50%;top:38%;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:6px;opacity:0;transition:opacity .15s ease}',
  '.sk-osd__crash.is-on{opacity:1}',
  '.sk-osd__crash b{font-size:clamp(22px,8cqh,48px);color:var(--sk-red);letter-spacing:.18em;font-weight:800}',
  '.sk-osd__crash em{font-style:normal;font-size:clamp(12px,3.6cqh,18px);color:var(--sk-amber);font-weight:700}',
  '.sk-osd__crash .sk-osd__bar{width:clamp(80px,18cqw,150px);height:4px;border-color:rgba(255,93,108,.6)}',
  '.sk-osd__crash .sk-osd__bar i{background:var(--sk-red);box-shadow:none}',
  '.sk-osd__flash{position:absolute;left:50%;top:24%;transform:translate(-50%,-50%) scale(.96);font-size:clamp(16px,5cqh,30px);font-weight:800;letter-spacing:.16em;opacity:0;transition:opacity .2s ease,transform .3s ease}',
  '.sk-osd__flash.is-on{opacity:1;transform:translate(-50%,-50%) scale(1)}',
  '.sk-osd__coach{position:absolute;left:50%;bottom:calc(var(--sk-sb) + 48px);transform:translateX(-50%);max-width:min(560px,70cqw);display:flex;align-items:center;gap:10px;',
  'padding:9px 14px;border:1px solid rgba(110,243,197,.55);border-radius:10px;background:rgba(3,10,8,.72);box-shadow:0 8px 26px rgba(0,0,0,.4),0 0 18px rgba(110,243,197,.12);',
  'text-transform:none;letter-spacing:.01em;color:#eafaf4;font-size:clamp(12px,3.3cqh,16px);font-weight:600;line-height:1.3;opacity:0;transition:opacity .25s ease}',
  '.sk-osd__coach.is-on{opacity:1}',
  '.sk-osd__coach b{flex:none;display:inline-flex;align-items:center;justify-content:center;min-width:2.4em;height:1.7em;border-radius:6px;background:var(--sk-mint);color:#03130d;font-size:.8em;letter-spacing:.06em}',
  '.sk-osd__coach b[hidden]{display:none}',
  '[data-gk-touch] .sk-osd__bl{bottom:auto;top:calc(var(--sk-st) + 12px);left:auto;right:calc(var(--sk-sr) + 168px + var(--gk-chrome-w,0px));gap:14px}',
  '[data-gk-touch] .sk-osd__big{font-size:clamp(16px,5cqh,26px)}',
  '[data-gk-touch] .sk-osd__bc{display:none}',
  '[data-gk-touch] .sk-osd__tr{top:auto;right:auto;left:50%;transform:translateX(-50%);bottom:calc(var(--sk-sb) + 10px);flex-direction:row;gap:10px}',
  '[data-gk-touch] .sk-osd__coach{bottom:auto;top:calc(var(--sk-st) + 60px)}',
  '@container (orientation: portrait){.sk-osd__time{font-size:clamp(20px,8.6cqw,34px)}',
  '.sk-osd__tc{top:calc(var(--sk-st) + 128px)}',
  '[data-gk-touch] .sk-osd__bl{top:calc(var(--sk-st) + 84px);left:calc(var(--sk-sl) + 14px);right:auto}',
  '[data-gk-touch] .sk-osd__big{font-size:clamp(16px,6.2cqw,24px)}',
  '[data-gk-touch] .sk-osd__coach{top:calc(var(--sk-st) + 170px);max-width:88cqw}}',
  '.sk-osd[data-kind="freestyle"] .sk-osd__race{display:none}',
  '.sk-osd[data-kind="race"] .sk-osd__free{display:none}',
  '.sk-osd[data-view="chase"] .sk-osd__cross,.sk-osd[data-view="chase"] .sk-osd__fpm{display:none}',
  '.sk-osd__static{position:absolute;inset:0;opacity:0;background-size:160px 160px;mix-blend-mode:screen}',
  '.sk-osd__static.is-on{animation:sk-static .55s steps(7) both}',
  '@keyframes sk-static{0%{opacity:.85;background-position:0 0;filter:contrast(1.4)}25%{opacity:.7;background-position:-37px 61px}50%{opacity:.5;background-position:53px -29px}75%{opacity:.25;background-position:-71px -43px}100%{opacity:0;background-position:19px 83px}}',
  '@container (max-height: 300px){.sk-osd__coach{bottom:calc(var(--sk-sb) + 36px)}}',
  '@media (prefers-reduced-motion: reduce){.sk-osd__flash,.sk-osd__tc,.sk-osd__coach{transition:none}.sk-osd__static.is-on{animation:none;opacity:0}}'
].join('');

const ARROW_SVG = '<svg viewBox="-17 -17 34 34" aria-hidden="true"><path d="M13 0 L-9 -11 L-4 0 L-9 11 Z" fill="rgba(110,243,197,.92)" stroke="rgba(3,19,13,.8)" stroke-width="1.4" stroke-linejoin="round"/></svg>';

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = STYLE;
  (document.head || document.documentElement).appendChild(s);
}

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

function pad3(n) {
  return n < 10 ? '00' + n : n < 100 ? '0' + n : String(n);
}

export function formatTime(t) {
  if (!(t >= 0) || !isFinite(t)) return '0:00.000';
  const ms = Math.floor(t * 1000 + 1e-6);
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return m + ':' + pad2(s) + '.' + pad3(ms % 1000);
}

export function formatDelta(d) {
  if (!isFinite(d)) return '';
  const sign = d < 0 ? '−' : '+';
  const a = Math.abs(d);
  return sign + a.toFixed(3);
}

export function projectPoint(camera, x, y, z, out) {
  const v = camera.matrixWorldInverse.elements;
  const cx = v[0] * x + v[4] * y + v[8] * z + v[12];
  const cy = v[1] * x + v[5] * y + v[9] * z + v[13];
  const cz = v[2] * x + v[6] * y + v[10] * z + v[14];
  const p = camera.projectionMatrix.elements;
  const px = p[0] * cx + p[4] * cy + p[8] * cz + p[12];
  const py = p[1] * cx + p[5] * cy + p[9] * cz + p[13];
  const pw = p[3] * cx + p[7] * cy + p[11] * cz + p[15];
  const iw = Math.abs(pw) > 1e-9 ? 1 / pw : 0;
  out.behind = cz > -0.05;
  out.cx = cx;
  out.cy = cy;
  out.nx = px * iw;
  out.ny = py * iw;
  return out;
}

function noiseUrl() {
  try {
    const size = 160;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    let s = 1234567;
    for (let i = 0; i < size * size; i++) {
      s = (s * 1103515245 + 12345) >>> 0;
      const row = Math.floor(i / size);
      const band = row % 3 === 0 ? 0.55 : 1;
      const v = Math.round(((s >>> 16) & 255) * band);
      img.data[i * 4] = v;
      img.data[i * 4 + 1] = v;
      img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c.toDataURL('image/png');
  } catch (_) {
    return '';
  }
}

function el(tag, cls, parent, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
}

function setText(node, cache, key, text) {
  if (cache[key] === text) return;
  cache[key] = text;
  node.textContent = text;
}

export function createHud(stage, copyIn) {
  ensureStyle();
  let copy = Object.assign({}, copyIn || null);
  const root = el('div', 'sk-osd', null);
  root.hidden = true;
  root.setAttribute('aria-hidden', 'true');
  root.setAttribute('data-kind', 'race');
  root.setAttribute('data-view', 'fpv');

  const tl = el('div', 'sk-osd__tl', root);
  const timeWrap = el('div', 'sk-osd__race', tl);
  const timeK = el('span', 'sk-osd__k', timeWrap);
  const timeV = el('div', 'sk-osd__t sk-osd__time', timeWrap);
  const row = el('div', 'sk-osd__row sk-osd__t', tl);
  const gateWrap = el('span', 'sk-osd__race', row);
  const gateK = el('span', '', gateWrap);
  const gateV = el('span', '', gateWrap);
  gateK.style.marginRight = '6px';
  const penV = el('span', 'sk-osd__pen sk-osd__race', row);
  penV.hidden = true;
  const ringWrap = el('span', 'sk-osd__free', row);
  const ringK = el('span', '', ringWrap);
  const ringV = el('span', '', ringWrap);
  ringK.style.marginRight = '6px';

  const tc = el('div', 'sk-osd__tc', root);
  const splitK = el('span', 'sk-osd__k', tc);
  const splitV = el('div', 'sk-osd__t sk-osd__split', tc);

  const tr = el('div', 'sk-osd__tr', root);
  const modeV = el('span', 'sk-osd__t sk-osd__mode', tr);
  const voltV = el('span', 'sk-osd__t sk-osd__volt', tr);

  const bl = el('div', 'sk-osd__bl', root);
  const spdWrap = el('div', '', bl);
  const spdK = el('span', 'sk-osd__k', spdWrap);
  const spdLine = el('div', 'sk-osd__t', spdWrap);
  const spdV = el('span', 'sk-osd__big', spdLine);
  const spdU = el('span', 'sk-osd__unit', spdLine);
  const altWrap = el('div', '', bl);
  const altK = el('span', 'sk-osd__k', altWrap);
  const altLine = el('div', 'sk-osd__t', altWrap);
  const altV = el('span', 'sk-osd__big', altLine);
  const altU = el('span', 'sk-osd__unit', altLine);

  const bc = el('div', 'sk-osd__bc', root);
  const thrK = el('span', 'sk-osd__t', bc);
  const bar = el('div', 'sk-osd__bar', bc);
  const barFill = el('i', '', bar);
  el('b', '', bar);
  const thrV = el('span', 'sk-osd__t', bc);

  const cross = el('div', 'sk-osd__cross', root, '<i></i>');
  const horizon = el('div', 'sk-osd__horizon', root, '<i></i><i></i>');
  horizon.style.display = 'none';
  const fpm = el('div', 'sk-osd__fpm', root);
  fpm.style.display = 'none';
  const mark = el('div', 'sk-osd__mark', root, '<i></i><i></i><i></i><i></i><span></span>');
  const markText = mark.querySelector('span');
  mark.style.display = 'none';
  const arrow = el('div', 'sk-osd__arrow', root, ARROW_SVG + '<span></span>');
  const arrowText = arrow.querySelector('span');
  arrow.style.display = 'none';

  const staticEl = el('div', 'sk-osd__static', root);
  let staticReady = false;
  const crash = el('div', 'sk-osd__crash', root);
  const crashTitle = el('b', 'sk-osd__t', crash);
  const crashSub = el('em', 'sk-osd__t', crash);
  const crashBar = el('div', 'sk-osd__bar', crash);
  const crashFill = el('i', '', crashBar);

  const flash = el('div', 'sk-osd__flash sk-osd__t', root);
  const coach = el('div', 'sk-osd__coach', root);
  const coachStep = el('b', '', coach);
  const coachText = el('span', '', coach);

  stage.appendChild(root);

  const cache = Object.create(null);
  const size = { w: 1, h: 1 };
  let ro = null;
  function measure() {
    const r = stage.getBoundingClientRect();
    size.w = Math.max(1, r.width);
    size.h = Math.max(1, r.height);
  }
  measure();
  try {
    ro = new ResizeObserver(measure);
    ro.observe(stage);
  } catch (_) {}

  let splitTimer = 0;
  let flashTimer = 0;
  let readoutClock = 0;
  let markState = '';
  let horizonOn = false;
  let fpmOn = false;

  function applyCopy() {
    setText(timeK, cache, 'timeK', copy.time || '');
    setText(gateK, cache, 'gateK', copy.gate || '');
    setText(ringK, cache, 'ringK', copy.rings || '');
    setText(spdK, cache, 'spdK', copy.speed || '');
    setText(spdU, cache, 'spdU', copy.kmh || '');
    setText(altK, cache, 'altK', copy.alt || '');
    setText(altU, cache, 'altU', copy.meters || '');
    setText(thrK, cache, 'thrK', copy.throttle || '');
  }
  applyCopy();

  function show(on) {
    root.hidden = !on;
  }

  function setKind(kind) {
    root.setAttribute('data-kind', kind === 'freestyle' ? 'freestyle' : 'race');
  }

  function setView(view) {
    root.setAttribute('data-view', view === 'chase' ? 'chase' : 'fpv');
  }

  function setCopy(next) {
    copy = Object.assign({}, copy, next || null);
    for (const k in cache) delete cache[k];
    applyCopy();
  }

  function setModeLabel(text) {
    setText(modeV, cache, 'mode', text || '');
  }

  function frame(d, dt) {
    readoutClock -= dt || 0;
    const slow = readoutClock <= 0;
    if (slow) readoutClock = 1 / 15;
    setText(timeV, cache, 'time', formatTime(d.time || 0));
    if (slow) {
      setText(gateV, cache, 'gate', (d.gate || 0) + '/' + (d.gates || 0));
      setText(ringV, cache, 'ring', (d.rings || 0) + '/' + (d.ringsTotal || 0));
      setText(spdV, cache, 'spd', String(Math.round(d.speedKmh || 0)));
      const alt = d.alt || 0;
      setText(altV, cache, 'alt', alt < 10 ? alt.toFixed(1) : String(Math.round(alt)));
      setText(voltV, cache, 'volt', (d.volts || 0).toFixed(1) + 'V');
      const pen = d.penalty || 0;
      if (pen > 0) {
        penV.hidden = false;
        setText(penV, cache, 'pen', '+' + pen.toFixed(1) + (copy.secondsShort ? ' ' + copy.secondsShort : ''));
      } else penV.hidden = true;
    }
    const thr = Math.max(0, Math.min(1, d.throttle || 0));
    const pct = Math.round(thr * 100);
    if (cache.thr !== pct) {
      cache.thr = pct;
      barFill.style.width = pct + '%';
      thrV.textContent = pct + '%';
    }
  }

  function pointer(state, x, y, angle, text) {
    if (state !== markState) {
      markState = state;
      mark.style.display = state === 'on' ? '' : 'none';
      arrow.style.display = state === 'edge' ? '' : 'none';
    }
    if (state === 'on') {
      mark.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0)';
      setText(markText, cache, 'markT', text || '');
    } else if (state === 'edge') {
      arrow.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0) rotate(' + angle.toFixed(3) + 'rad)';
      const t = text || '';
      if (cache.arrowT !== t) {
        cache.arrowT = t;
        arrowText.textContent = t;
      }
      arrowText.style.transform = 'translateX(-50%) rotate(' + (-angle).toFixed(3) + 'rad)';
    }
  }

  function horizonLine(on, x, y, angle) {
    if (on !== horizonOn) {
      horizonOn = on;
      horizon.style.display = on ? '' : 'none';
    }
    if (on) horizon.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0) rotate(' + angle.toFixed(4) + 'rad)';
  }

  function flightPath(on, x, y) {
    if (on !== fpmOn) {
      fpmOn = on;
      fpm.style.display = on ? '' : 'none';
    }
    if (on) fpm.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0)';
  }

  function split(delta, label) {
    clearTimeout(splitTimer);
    splitK.textContent = label || '';
    splitV.textContent = formatDelta(delta);
    splitV.classList.toggle('is-good', delta <= 0);
    splitV.classList.toggle('is-bad', delta > 0);
    tc.classList.add('is-on');
    splitTimer = setTimeout(() => tc.classList.remove('is-on'), 2400);
  }

  function clearSplit() {
    clearTimeout(splitTimer);
    tc.classList.remove('is-on');
  }

  function crashShow(title, sub) {
    crashTitle.textContent = title || '';
    crashSub.textContent = sub || '';
    crashSub.hidden = !sub;
    crashFill.style.width = '0%';
    crash.classList.add('is-on');
  }

  function crashProgress(p) {
    crashFill.style.width = (Math.max(0, Math.min(1, p)) * 100).toFixed(1) + '%';
  }

  function crashHide() {
    crash.classList.remove('is-on');
  }

  function videoStatic() {
    if (!staticReady) {
      staticReady = true;
      const url = noiseUrl();
      if (url) staticEl.style.backgroundImage = 'url(' + url + ')';
    }
    staticEl.classList.remove('is-on');
    void staticEl.offsetWidth;
    staticEl.classList.add('is-on');
  }

  function flashText(text, ms) {
    clearTimeout(flashTimer);
    flash.textContent = text || '';
    flash.classList.add('is-on');
    flashTimer = setTimeout(() => flash.classList.remove('is-on'), ms || 1600);
  }

  function coachSet(text, stepText) {
    if (!text) {
      coach.classList.remove('is-on');
      return;
    }
    coachStep.textContent = stepText || '';
    coachStep.hidden = !stepText;
    coachText.textContent = text;
    coach.classList.add('is-on');
  }

  const pa = { behind: false, cx: 0, cy: 0, nx: 0, ny: 0 };
  const pb = { behind: false, cx: 0, cy: 0, nx: 0, ny: 0 };

  function trackTarget(camera, x, y, z, label) {
    const w = size.w;
    const h = size.h;
    projectPoint(camera, x, y, z, pa);
    if (!pa.behind && Math.abs(pa.nx) < 0.9 && Math.abs(pa.ny) < 0.86) {
      pointer('on', (pa.nx * 0.5 + 0.5) * w, (0.5 - pa.ny * 0.5) * h, 0, label);
      return;
    }
    const ax = pa.cx;
    let ay = -pa.cy;
    if (pa.behind && Math.abs(ax) < 1e-3 && Math.abs(ay) < 1e-3) ay = 1;
    const ang = Math.atan2(ay, ax);
    const mx = w / 2 - 44;
    const my = h / 2 - 44;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const s = Math.min(mx / Math.max(1e-4, Math.abs(ca)), my / Math.max(1e-4, Math.abs(sa)));
    pointer('edge', w / 2 + ca * s, h / 2 + sa * s, ang, label);
  }

  function trackHorizon(camera, on) {
    if (!on) {
      horizonLine(false);
      return;
    }
    const m = camera.matrixWorld.elements;
    const fx0 = -m[8];
    const fz0 = -m[10];
    const fl = Math.sqrt(fx0 * fx0 + fz0 * fz0);
    if (fl < 0.2) {
      horizonLine(false);
      return;
    }
    const fx = fx0 / fl;
    const fz = fz0 / fl;
    const px = m[12];
    const py = m[13];
    const pz = m[14];
    const R = 2000;
    const ca = Math.cos(0.35);
    const sa = Math.sin(0.35);
    projectPoint(camera, px + fx * R, py, pz + fz * R, pa);
    projectPoint(camera, px + (fx * ca - fz * sa) * R, py, pz + (fz * ca + fx * sa) * R, pb);
    if (pa.behind || pb.behind || Math.abs(pa.ny) > 0.95) {
      horizonLine(false);
      return;
    }
    const x1 = (pa.nx * 0.5 + 0.5) * size.w;
    const y1 = (0.5 - pa.ny * 0.5) * size.h;
    const x2 = (pb.nx * 0.5 + 0.5) * size.w;
    const y2 = (0.5 - pb.ny * 0.5) * size.h;
    horizonLine(true, x1, y1, Math.atan2(y2 - y1, x2 - x1));
  }

  function trackVelocity(camera, vx, vy, vz, speed, on) {
    if (!on || speed < 3) {
      flightPath(false);
      return;
    }
    const m = camera.matrixWorld.elements;
    const s = 60 / Math.max(speed, 1e-3);
    projectPoint(camera, m[12] + vx * s, m[13] + vy * s, m[14] + vz * s, pa);
    if (pa.behind || Math.abs(pa.nx) > 0.95 || Math.abs(pa.ny) > 0.92) {
      flightPath(false);
      return;
    }
    flightPath(true, (pa.nx * 0.5 + 0.5) * size.w, (0.5 - pa.ny * 0.5) * size.h);
  }

  function reset() {
    clearSplit();
    crashHide();
    clearTimeout(flashTimer);
    flash.classList.remove('is-on');
    coach.classList.remove('is-on');
    pointer('off');
    horizonLine(false);
    flightPath(false);
  }

  function dispose() {
    clearTimeout(splitTimer);
    clearTimeout(flashTimer);
    try { if (ro) ro.disconnect(); } catch (_) {}
    if (root.parentNode) root.parentNode.removeChild(root);
  }

  return {
    el: root,
    size,
    show,
    setKind,
    setView,
    setCopy,
    setModeLabel,
    frame,
    pointer,
    horizon: horizonLine,
    flightPath,
    trackTarget,
    trackHorizon,
    trackVelocity,
    split,
    clearSplit,
    crash: crashShow,
    crashProgress,
    clearCrash: crashHide,
    flash: flashText,
    videoStatic,
    coach: coachSet,
    reset,
    dispose
  };
}
