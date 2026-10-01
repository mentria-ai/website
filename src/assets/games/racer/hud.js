const HUD_STYLE_ID = 'nrh-style';
const NITRO_SEGMENTS = 24;
const RPM_SEGMENTS = 18;
const MAX_DOTS = 12;
const KMH = 3.6;
const MPH = 2.2369363;

const HUD_CSS = [
  '.nrh{position:absolute;inset:0;z-index:12;pointer-events:none;container-type:size;color:#eaf3f0;',
  'font-family:var(--font-mono,ui-monospace,monospace);-webkit-user-select:none;user-select:none;',
  '--nrh-mint:#6ef3c5;--nrh-mint-rgb:110,243,197;--nrh-amber:#ffb547;--nrh-red:#ff4d5e;--nrh-gold:#f2c94c;',
  '--nrh-safe-t:env(safe-area-inset-top,0px);--nrh-safe-r:env(safe-area-inset-right,0px);',
  '--nrh-safe-b:env(safe-area-inset-bottom,0px);--nrh-safe-l:env(safe-area-inset-left,0px);',
  '--nrh-u:clamp(.62px,calc(100cqh/560),1.25px);transition:opacity .25s ease}',
  '.nrh[hidden],.nrh [hidden]{display:none!important}',
  '.nrh.is-dim{opacity:0}',
  '.nrh *{box-sizing:border-box}',
  '.nrh-panel{background:linear-gradient(180deg,rgba(6,12,14,.62),rgba(4,8,10,.48));border:1px solid rgba(var(--nrh-mint-rgb),.16);',
  'border-radius:12px;box-shadow:0 6px 22px rgba(0,0,0,.32),inset 0 1px 0 rgba(255,255,255,.05)}',
  '.nrh-k{display:block;font-size:calc(10*var(--nrh-u));letter-spacing:.2em;text-transform:uppercase;color:rgba(234,243,240,.62);line-height:1}',
  '.nrh-tl{position:absolute;top:calc(var(--nrh-safe-t) + 12px);left:calc(var(--nrh-safe-l) + 14px);display:flex;flex-direction:column;gap:10px;align-items:flex-start}',
  '.nrh-standing{display:flex;align-items:stretch;gap:0;padding:0;overflow:hidden}',
  '.nrh-pos{display:flex;flex-direction:column;justify-content:center;padding:calc(8*var(--nrh-u)) calc(14*var(--nrh-u)) calc(9*var(--nrh-u))}',
  '.nrh-pos__v{display:flex;align-items:baseline;gap:2px;margin-top:4px;line-height:.86}',
  '.nrh-pos__n{font:italic 900 calc(46*var(--nrh-u))/.86 var(--font-body,system-ui,sans-serif);letter-spacing:-.03em;color:#fff;',
  'text-shadow:0 0 18px rgba(var(--nrh-mint-rgb),.35),0 2px 8px rgba(0,0,0,.6);display:inline-block;transform-origin:50% 70%}',
  '.nrh-pos__n.is-pop{animation:nrh-pop .42s cubic-bezier(.2,1.6,.4,1)}',
  '.nrh-pos__n.is-first{color:var(--nrh-gold);text-shadow:0 0 18px rgba(242,201,76,.45),0 2px 8px rgba(0,0,0,.6)}',
  '.nrh-pos__of{font:700 calc(15*var(--nrh-u))/1 var(--font-mono,monospace);color:rgba(234,243,240,.7)}',
  '.nrh-lap{display:flex;flex-direction:column;justify-content:center;gap:5px;padding:0 calc(14*var(--nrh-u));border-left:1px solid rgba(var(--nrh-mint-rgb),.14)}',
  '.nrh-lap__v{font:800 calc(22*var(--nrh-u))/1 var(--font-mono,monospace);font-variant-numeric:tabular-nums;color:#f2fbf8}',
  '.nrh-lap__v small{font-size:.6em;color:rgba(234,243,240,.6);font-weight:700}',
  '.nrh-map{display:block;width:calc(150*var(--nrh-u));height:calc(150*var(--nrh-u));padding:6px}',
  '.nrh-map canvas{display:block;width:100%;height:100%}',
  '.nrh-tr{position:absolute;top:calc(var(--nrh-safe-t) + 12px);right:calc(var(--nrh-safe-r) + 14px + var(--gk-chrome-w,0px));',
  'display:flex;flex-direction:column;align-items:flex-end;gap:6px}',
  '.nrh-times{display:grid;grid-template-columns:auto auto;column-gap:12px;row-gap:6px;align-items:baseline;padding:calc(9*var(--nrh-u)) calc(13*var(--nrh-u))}',
  '.nrh-times .nrh-k{text-align:right}',
  '.nrh-t{font:700 calc(15*var(--nrh-u))/1 var(--font-mono,monospace);font-variant-numeric:tabular-nums;color:rgba(242,251,248,.86);text-align:right;min-width:7.4ch}',
  '.nrh-t--main{font-size:calc(21*var(--nrh-u));color:#fff}',
  '.nrh-t--best{color:var(--nrh-mint)}',
  '.nrh-delta{font:800 calc(15*var(--nrh-u))/1 var(--font-mono,monospace);font-variant-numeric:tabular-nums;padding:6px 10px;border-radius:999px;',
  'background:rgba(4,8,10,.6);border:1px solid rgba(255,255,255,.12)}',
  '.nrh-delta[hidden]{display:none}',
  '.nrh-delta.is-good{color:var(--nrh-mint);border-color:rgba(var(--nrh-mint-rgb),.45)}',
  '.nrh-delta.is-bad{color:var(--nrh-red);border-color:rgba(255,77,94,.45)}',
  '.nrh-speedo{position:absolute;left:50%;bottom:calc(var(--nrh-safe-b) + 10px);transform:translateX(-50%);',
  'display:flex;flex-direction:column;align-items:center;gap:calc(5*var(--nrh-u));padding:calc(8*var(--nrh-u)) calc(18*var(--nrh-u)) calc(10*var(--nrh-u));min-width:calc(250*var(--nrh-u))}',
  '.nrh-rpm{display:flex;gap:2px;width:100%;height:calc(5*var(--nrh-u))}',
  '.nrh-rpm i{flex:1;border-radius:1px;background:rgba(255,255,255,.09);transition:background-color .06s linear}',
  '.nrh-rpm i.is-on{background:var(--nrh-mint);box-shadow:0 0 6px rgba(var(--nrh-mint-rgb),.6)}',
  '.nrh-rpm i.is-hot.is-on{background:var(--nrh-amber);box-shadow:0 0 6px rgba(255,181,71,.6)}',
  '.nrh-rpm i.is-red.is-on{background:var(--nrh-red);box-shadow:0 0 7px rgba(255,77,94,.7)}',
  '.nrh-speedrow{display:flex;align-items:flex-end;gap:calc(10*var(--nrh-u))}',
  '.nrh-gear{display:flex;flex-direction:column;align-items:center;gap:3px;padding:calc(5*var(--nrh-u)) calc(7*var(--nrh-u));border-radius:8px;',
  'border:1px solid rgba(var(--nrh-mint-rgb),.32);margin-bottom:calc(6*var(--nrh-u))}',
  '.nrh-gear__v{font:800 calc(20*var(--nrh-u))/1 var(--font-mono,monospace);color:var(--nrh-mint);min-width:1.1ch;text-align:center}',
  '.nrh-speed{font:italic 900 calc(64*var(--nrh-u))/.84 var(--font-body,system-ui,sans-serif);font-variant-numeric:tabular-nums;',
  'letter-spacing:-.035em;color:#fff;min-width:3.05ch;text-align:right;text-shadow:0 0 22px rgba(var(--nrh-mint-rgb),.28),0 3px 10px rgba(0,0,0,.6)}',
  '.nrh-speedo.is-boost .nrh-speed{color:#dffcff;text-shadow:0 0 22px rgba(80,200,255,.75),0 0 44px rgba(80,200,255,.35),0 3px 10px rgba(0,0,0,.6)}',
  '.nrh-unit{display:flex;flex-direction:column;align-items:flex-start;gap:4px;margin-bottom:calc(7*var(--nrh-u))}',
  '.nrh-unit__v{font:800 calc(13*var(--nrh-u))/1 var(--font-mono,monospace);letter-spacing:.1em;color:rgba(234,243,240,.82);text-transform:uppercase}',
  '.nrh-nitro{display:flex;align-items:center;gap:8px;width:100%}',
  '.nrh-nitro__icon{flex:none;width:calc(16*var(--nrh-u));height:calc(16*var(--nrh-u));color:#58c8ff}',
  '.nrh-nitro__bars{flex:1;display:flex;gap:4px}',
  '.nrh-nitro__bar{flex:1;height:calc(10*var(--nrh-u));border-radius:3px;background:rgba(88,200,255,.12);position:relative;overflow:hidden;',
  '-webkit-mask:repeating-linear-gradient(90deg,#000 0 calc(12.5% - 2px),transparent calc(12.5% - 2px) 12.5%);',
  'mask:repeating-linear-gradient(90deg,#000 0 calc(12.5% - 2px),transparent calc(12.5% - 2px) 12.5%)}',
  '.nrh-nitro__fill{position:absolute;left:0;top:0;bottom:0;width:0;background:linear-gradient(90deg,#2f8bff,#58c8ff 60%,#b6f0ff);transition:width .08s linear}',
  '.nrh-nitro.is-full .nrh-nitro__fill{animation:nrh-glow 1s ease-in-out infinite}',
  '.nrh-speedo.is-boost .nrh-nitro__fill{background:linear-gradient(90deg,#ff7a1a,#ffd36b 60%,#fff6d0)}',
  '.nrh-speedo.is-boost{border-color:rgba(88,200,255,.55);box-shadow:0 0 26px rgba(88,200,255,.28),0 6px 22px rgba(0,0,0,.32)}',
  '.nrh-banner{position:absolute;left:50%;top:calc(var(--nrh-safe-t) + 16%);transform:translate(-50%,-14px) scale(.9);opacity:0;',
  'display:flex;align-items:center;gap:12px;padding:10px 20px;border-radius:999px;background:rgba(4,8,10,.74);border:1px solid rgba(255,255,255,.22);',
  'font:italic 900 calc(26*var(--nrh-u))/1 var(--font-body,system-ui,sans-serif);letter-spacing:.06em;text-transform:uppercase;color:#fff;',
  'transition:opacity .28s ease,transform .38s cubic-bezier(.2,1.4,.4,1);white-space:nowrap}',
  '.nrh-banner.is-on{opacity:1;transform:translate(-50%,0) scale(1)}',
  '.nrh-banner svg{width:calc(30*var(--nrh-u));height:calc(30*var(--nrh-u));flex:none}',
  '.nrh-wrong{position:absolute;left:50%;top:38%;transform:translate(-50%,-50%);display:flex;align-items:center;gap:12px;padding:12px 22px;border-radius:14px;',
  'background:rgba(60,4,10,.78);border:2px solid var(--nrh-red);color:#fff;font:italic 900 calc(30*var(--nrh-u))/1 var(--font-body,system-ui,sans-serif);',
  'letter-spacing:.05em;text-transform:uppercase;box-shadow:0 0 34px rgba(255,77,94,.45);opacity:0;transition:opacity .2s ease;white-space:nowrap}',
  '.nrh-wrong.is-on{opacity:1;animation:nrh-blink .9s steps(2,jump-none) infinite}',
  '.nrh-wrong svg{width:calc(34*var(--nrh-u));height:calc(34*var(--nrh-u));flex:none;color:var(--nrh-red)}',
  '.nrh-toasts{position:absolute;left:50%;top:27%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:8px;width:min(90%,520px)}',
  '.nrh-toast{display:flex;flex-direction:column;align-items:center;gap:3px;opacity:0;transform:translateY(10px) scale(.8);',
  'transition:opacity .22s ease,transform .32s cubic-bezier(.2,1.5,.4,1)}',
  '.nrh-toast.is-on{opacity:1;transform:translateY(0) scale(1)}',
  '.nrh-toast.is-off{opacity:0;transform:translateY(-12px) scale(.96);transition:opacity .35s ease,transform .35s ease}',
  '.nrh-toast__label{font:italic 900 calc(30*var(--nrh-u))/1 var(--font-body,system-ui,sans-serif);letter-spacing:.03em;text-transform:uppercase;',
  'color:#fff;text-shadow:0 0 18px var(--nrh-tc,rgba(var(--nrh-mint-rgb),.6)),0 2px 8px rgba(0,0,0,.7);white-space:nowrap}',
  '.nrh-toast__gain{display:flex;align-items:center;gap:5px;font:800 calc(13*var(--nrh-u))/1 var(--font-mono,monospace);letter-spacing:.12em;',
  'color:#9fe3ff;text-shadow:0 1px 4px rgba(0,0,0,.8)}',
  '.nrh-toast__gain[hidden]{display:none}',
  '.nrh-toast__gain svg{width:12px;height:12px}',
  '.nrh-toast--drift{--nrh-tc:rgba(110,243,197,.75)}',
  '.nrh-toast--near{--nrh-tc:rgba(88,200,255,.8)}',
  '.nrh-toast--takedown{--nrh-tc:rgba(255,120,60,.85)}',
  '.nrh-toast--takedown .nrh-toast__label{color:#ffd9c2}',
  '.nrh-toast--air{--nrh-tc:rgba(160,140,255,.8)}',
  '.nrh-toast--start{--nrh-tc:rgba(242,201,76,.85)}',
  '.nrh-toast--start .nrh-toast__label{color:#ffeab0}',
  '.nrh-toast--lap .nrh-toast__label{font-size:calc(22*var(--nrh-u));font-variant-numeric:tabular-nums}',
  '.nrh-toast--best .nrh-toast__label{color:#c9ffe9}',
  '.nrh-toast--bad{--nrh-tc:rgba(255,77,94,.7)}',
  '.nrh-toast--bad .nrh-toast__label{color:#ffc4ca}',
  '.nrh-toast--info .nrh-toast__label{font-size:calc(19*var(--nrh-u));letter-spacing:.08em}',
  '@keyframes nrh-pop{0%{transform:scale(1.45)}100%{transform:scale(1)}}',
  '@keyframes nrh-glow{50%{filter:brightness(1.55) saturate(1.2)}}',
  '@keyframes nrh-blink{0%{opacity:1}50%{opacity:.35}}',
  '@container (max-height: 430px){.nrh-map{width:calc(118*var(--nrh-u));height:calc(118*var(--nrh-u))}',
  '.nrh-toasts{top:22%}.nrh-banner{top:calc(var(--nrh-safe-t) + 11%)}}',
  '.nrh.is-touch .nrh-speedo{bottom:calc(var(--nrh-safe-b) + 6px)}',
  '@media (prefers-reduced-motion: reduce){.nrh-pos__n.is-pop,.nrh-nitro.is-full .nrh-nitro__fill,.nrh-wrong.is-on{animation:none}',
  '.nrh-toast,.nrh-banner{transition:opacity .2s linear}}'
].join('');

const ICON_FLAG = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M7 4v25" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>' +
  '<path d="M8 5h19v13H8z" fill="#fff"/><path d="M8 5h4.75v4.33H8zM17.5 5h4.75v4.33H17.5zM12.75 9.33h4.75v4.33h-4.75zM22.25 9.33H27v4.33h-4.75zM8 13.67h4.75V18H8zM17.5 13.67h4.75V18H17.5z" fill="#0b0f12"/></svg>';
const ICON_TURN = '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M10 27V13a6 6 0 0 1 12 0v6"/><path d="M16.5 15l5.5 5.5 5.5-5.5"/></svg>';
const ICON_BOLT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.4 2.8L5.6 13.6h5.6l-1 7.6 7.8-10.8h-5.6z" fill="currentColor"/></svg>';

function ensureHudStyle() {
  if (typeof document === 'undefined' || document.getElementById(HUD_STYLE_ID)) return;
  const st = document.createElement('style');
  st.id = HUD_STYLE_ID;
  st.textContent = HUD_CSS;
  document.head.appendChild(st);
}

function hudPad2(n) {
  return n < 10 ? '0' + n : String(n);
}

function hudTime(t) {
  if (typeof t !== 'number' || !(t >= 0) || t === Infinity) return '-:--.---';
  const ms = Math.floor(t * 1000 + 1e-6);
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms - m * 60000) / 1000);
  const f = ms % 1000;
  return m + ':' + hudPad2(s) + '.' + (f < 10 ? '00' : f < 100 ? '0' : '') + f;
}

function hudDelta(d) {
  if (typeof d !== 'number' || d !== d || !isFinite(d)) return '';
  const a = Math.abs(d);
  const sign = d < 0 ? '−' : '+';
  return sign + a.toFixed(2);
}

function makeEl(tag, cls, html) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html != null) el.innerHTML = html;
  return el;
}

export function formatRacerTime(t) {
  return hudTime(t);
}

export function createRacerHud(stage, opts = {}) {
  if (!stage) throw new Error('createRacerHud: stage required');
  ensureHudStyle();
  const tr = typeof opts.t === 'function' ? opts.t : function (k) { return k; };
  let units = opts.units === 'mph' ? 'mph' : 'kmh';

  const root = makeEl('div', 'nrh');
  root.hidden = true;
  root.setAttribute('aria-hidden', 'true');
  if (opts.touch) root.classList.add('is-touch');

  const tl = makeEl('div', 'nrh-tl');
  const standing = makeEl('div', 'nrh-panel nrh-standing');
  const posBox = makeEl('div', 'nrh-pos');
  const posK = makeEl('span', 'nrh-k');
  const posV = makeEl('span', 'nrh-pos__v');
  const posN = makeEl('span', 'nrh-pos__n', '1');
  const posOf = makeEl('span', 'nrh-pos__of', '/6');
  posV.appendChild(posN);
  posV.appendChild(posOf);
  posBox.appendChild(posK);
  posBox.appendChild(posV);
  const lapBox = makeEl('div', 'nrh-lap');
  const lapK = makeEl('span', 'nrh-k');
  const lapV = makeEl('span', 'nrh-lap__v', '1<small>/3</small>');
  lapBox.appendChild(lapK);
  lapBox.appendChild(lapV);
  standing.appendChild(posBox);
  standing.appendChild(lapBox);
  const mapBox = makeEl('div', 'nrh-panel nrh-map');
  const mapCanvas = document.createElement('canvas');
  mapBox.appendChild(mapCanvas);
  tl.appendChild(standing);
  tl.appendChild(mapBox);

  const trBox = makeEl('div', 'nrh-tr');
  const times = makeEl('div', 'nrh-panel nrh-times');
  const timeK = makeEl('span', 'nrh-k');
  const timeV = makeEl('span', 'nrh-t nrh-t--main', '0:00.000');
  const lapTK = makeEl('span', 'nrh-k');
  const lapTV = makeEl('span', 'nrh-t', '0:00.000');
  const bestK = makeEl('span', 'nrh-k');
  const bestV = makeEl('span', 'nrh-t nrh-t--best', '-:--.---');
  times.appendChild(timeK); times.appendChild(timeV);
  times.appendChild(lapTK); times.appendChild(lapTV);
  times.appendChild(bestK); times.appendChild(bestV);
  const deltaEl = makeEl('span', 'nrh-delta');
  deltaEl.hidden = true;
  trBox.appendChild(times);
  trBox.appendChild(deltaEl);

  const speedo = makeEl('div', 'nrh-panel nrh-speedo');
  const rpm = makeEl('div', 'nrh-rpm');
  const rpmSegs = [];
  for (let i = 0; i < RPM_SEGMENTS; i++) {
    const seg = document.createElement('i');
    if (i >= RPM_SEGMENTS - 3) seg.className = 'is-red';
    else if (i >= RPM_SEGMENTS - 7) seg.className = 'is-hot';
    rpm.appendChild(seg);
    rpmSegs.push(seg);
  }
  const speedRow = makeEl('div', 'nrh-speedrow');
  const gearBox = makeEl('div', 'nrh-gear');
  const gearK = makeEl('span', 'nrh-k');
  const gearV = makeEl('span', 'nrh-gear__v', '1');
  gearBox.appendChild(gearK);
  gearBox.appendChild(gearV);
  const speedV = makeEl('span', 'nrh-speed', '0');
  const unitBox = makeEl('div', 'nrh-unit');
  const unitV = makeEl('span', 'nrh-unit__v');
  unitBox.appendChild(unitV);
  speedRow.appendChild(gearBox);
  speedRow.appendChild(speedV);
  speedRow.appendChild(unitBox);
  const nitroRow = makeEl('div', 'nrh-nitro');
  const nitroIcon = makeEl('span', 'nrh-nitro__icon', ICON_BOLT);
  const nitroBars = makeEl('div', 'nrh-nitro__bars');
  const nitroFills = [];
  for (let i = 0; i < 3; i++) {
    const bar = makeEl('div', 'nrh-nitro__bar');
    const fill = makeEl('span', 'nrh-nitro__fill');
    bar.appendChild(fill);
    nitroBars.appendChild(bar);
    nitroFills.push(fill);
  }
  nitroRow.appendChild(nitroIcon);
  nitroRow.appendChild(nitroBars);
  speedo.appendChild(rpm);
  speedo.appendChild(speedRow);
  speedo.appendChild(nitroRow);

  const banner = makeEl('div', 'nrh-banner');
  const bannerIcon = makeEl('span', '', ICON_FLAG);
  const bannerText = makeEl('span', '');
  banner.appendChild(bannerIcon);
  banner.appendChild(bannerText);

  const wrong = makeEl('div', 'nrh-wrong');
  const wrongIcon = makeEl('span', '', ICON_TURN);
  const wrongText = makeEl('span', '');
  wrong.appendChild(wrongIcon);
  wrong.appendChild(wrongText);

  const toasts = makeEl('div', 'nrh-toasts');

  root.appendChild(tl);
  root.appendChild(trBox);
  root.appendChild(speedo);
  root.appendChild(banner);
  root.appendChild(wrong);
  root.appendChild(toasts);
  stage.appendChild(root);

  const last = {
    speed: -1, gear: '', rpmOn: -1, nitro: -1, boost: null, full: null,
    pos: -1, total: -1, lap: -1, laps: -1, time: '', lapTime: '', best: '', delta: '', deltaGood: null
  };
  const map = {
    points: null,
    minX: 0, minZ: 0, span: 1, offX: 0, offZ: 0,
    count: 0,
    xs: new Float32Array(MAX_DOTS),
    zs: new Float32Array(MAX_DOTS),
    colors: new Array(MAX_DOTS).fill('#cfd6e0'),
    kinds: new Uint8Array(MAX_DOTS),
    on: new Uint8Array(MAX_DOTS),
    player: 0,
    cssSize: 0,
    dpr: 1,
    base: null,
    dirty: true
  };
  let bannerTimer = 0;
  let wrongOn = false;
  let disposed = false;
  const liveToasts = [];

  function applyCopy() {
    posK.textContent = tr('hud_pos');
    lapK.textContent = tr('hud_lap');
    timeK.textContent = tr('hud_time');
    lapTK.textContent = tr('hud_lap_time');
    bestK.textContent = tr('hud_best');
    gearK.textContent = tr('hud_gear');
    unitV.textContent = tr(units === 'mph' ? 'units_mph' : 'units_kmh');
    wrongText.textContent = tr('wrong_way');
    nitroIcon.setAttribute('title', tr('hud_nitro'));
    if (banner.classList.contains('is-on')) bannerText.textContent = tr('final_lap');
  }

  function show(on) {
    root.hidden = !on;
    if (on) map.dirty = true;
  }

  function setDim(on) {
    root.classList.toggle('is-dim', !!on);
  }

  function setUnits(u) {
    units = u === 'mph' ? 'mph' : 'kmh';
    last.speed = -1;
    applyCopy();
  }

  function setTouch(on) {
    root.classList.toggle('is-touch', !!on);
  }

  function setPosition(pos, total) {
    if (pos !== last.pos) {
      const grew = last.pos > 0 && pos < last.pos;
      last.pos = pos;
      posN.textContent = String(pos);
      posN.classList.toggle('is-first', pos === 1);
      if (grew) {
        posN.classList.remove('is-pop');
        void posN.offsetWidth;
        posN.classList.add('is-pop');
      }
    }
    if (total !== last.total) {
      last.total = total;
      posOf.textContent = '/' + total;
    }
  }

  function setStandingVisible(on) {
    posBox.hidden = !on;
    lapBox.style.borderLeft = on ? '' : '0';
  }

  function setLap(lap, laps) {
    if (lap === last.lap && laps === last.laps) return;
    last.lap = lap;
    last.laps = laps;
    lapV.innerHTML = Math.max(1, Math.min(lap, laps)) + '<small>/' + laps + '</small>';
  }

  function update(f) {
    if (disposed || !f) return;
    const sp = Math.max(0, f.speed || 0) * (units === 'mph' ? MPH : KMH);
    const spi = Math.round(sp);
    if (spi !== last.speed) {
      last.speed = spi;
      speedV.textContent = String(spi);
    }
    const g = f.reverse ? 'R' : String(f.gear || 1);
    if (g !== last.gear) {
      last.gear = g;
      gearV.textContent = g;
    }
    const on = Math.max(0, Math.min(RPM_SEGMENTS, Math.round((f.rpm || 0) * RPM_SEGMENTS)));
    if (on !== last.rpmOn) {
      for (let i = 0; i < RPM_SEGMENTS; i++) {
        const want = i < on;
        if ((last.rpmOn < 0) || (i < on) !== (i < last.rpmOn)) rpmSegs[i].classList.toggle('is-on', want);
      }
      last.rpmOn = on;
    }
    const n = Math.max(0, Math.min(1, f.nitro || 0));
    const nq = Math.round(n * 240) / 240;
    if (nq !== last.nitro) {
      last.nitro = nq;
      for (let i = 0; i < 3; i++) {
        const part = Math.max(0, Math.min(1, nq * 3 - i));
        nitroFills[i].style.width = (part * 100).toFixed(1) + '%';
      }
    }
    const full = n >= 0.995;
    if (full !== last.full) {
      last.full = full;
      nitroRow.classList.toggle('is-full', full);
    }
    const boost = !!f.boosting;
    if (boost !== last.boost) {
      last.boost = boost;
      speedo.classList.toggle('is-boost', boost);
    }
    if (f.position != null) setPosition(f.position, f.total || 6);
    if (f.lap != null) setLap(f.lap, f.laps || 1);
    const ts = hudTime(f.time);
    if (ts !== last.time) { last.time = ts; timeV.textContent = ts; }
    const ls = hudTime(f.lapTime);
    if (ls !== last.lapTime) { last.lapTime = ls; lapTV.textContent = ls; }
    const bs = hudTime(f.bestLap);
    if (bs !== last.best) { last.best = bs; bestV.textContent = bs; }
    if (f.delta != null && isFinite(f.delta)) {
      const dv = Math.abs(f.delta) < 0.005 ? 0 : f.delta;
      const ds = hudDelta(dv);
      if (ds !== last.delta) {
        last.delta = ds;
        deltaEl.textContent = tr('ghost_label') + ' ' + ds;
      }
      const good = dv <= 0;
      if (good !== last.deltaGood) {
        last.deltaGood = good;
        deltaEl.classList.toggle('is-good', good);
        deltaEl.classList.toggle('is-bad', !good);
      }
      deltaEl.hidden = false;
    } else if (!deltaEl.hidden) {
      deltaEl.hidden = true;
      last.delta = '';
    }
  }

  function setTrackMap(points, bounds) {
    map.points = Array.isArray(points) ? points : null;
    if (bounds) {
      const w = bounds.maxX - bounds.minX;
      const d = bounds.maxZ - bounds.minZ;
      const span = Math.max(w, d) || 1;
      map.minX = bounds.minX;
      map.minZ = bounds.minZ;
      map.span = span;
      map.offX = (span - w) / 2;
      map.offZ = (span - d) / 2;
    }
    map.base = null;
    map.dirty = true;
  }

  function setDots(list) {
    const n = Math.min(MAX_DOTS, list ? list.length : 0);
    map.count = n;
    for (let i = 0; i < n; i++) {
      const d = list[i] || {};
      map.colors[i] = d.color || '#cfd6e0';
      map.kinds[i] = d.kind === 'player' ? 1 : d.kind === 'ghost' ? 2 : 0;
      map.on[i] = 1;
    }
  }

  function setDot(i, x, z, visible) {
    if (i < 0 || i >= map.count) return;
    map.xs[i] = x;
    map.zs[i] = z;
    map.on[i] = visible === false ? 0 : 1;
  }

  function sizeMap() {
    const r = mapCanvas.getBoundingClientRect();
    const css = Math.max(40, Math.round(Math.min(r.width, r.height) || 120));
    const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    if (css !== map.cssSize || dpr !== map.dpr) {
      map.cssSize = css;
      map.dpr = dpr;
      mapCanvas.width = Math.round(css * dpr);
      mapCanvas.height = Math.round(css * dpr);
      map.base = null;
    }
  }

  function mapX(x) {
    const pad = 0.07;
    return (pad + (1 - 2 * pad) * ((x - map.minX + map.offX) / map.span)) * mapCanvas.width;
  }

  function mapZ(z) {
    const pad = 0.07;
    return (pad + (1 - 2 * pad) * ((z - map.minZ + map.offZ) / map.span)) * mapCanvas.height;
  }

  function drawBase() {
    const c = document.createElement('canvas');
    c.width = mapCanvas.width;
    c.height = mapCanvas.height;
    const g = c.getContext('2d');
    const pts = map.points;
    if (pts && pts.length > 2) {
      const pad = 0.07;
      const W = c.width;
      const H = c.height;
      const sx = function (p) { return (pad + (1 - 2 * pad) * p[0]) * W; };
      const sz = function (p) { return (pad + (1 - 2 * pad) * p[1]) * H; };
      g.lineJoin = 'round';
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(sx(pts[0]), sz(pts[0]));
      for (let i = 1; i < pts.length; i++) g.lineTo(sx(pts[i]), sz(pts[i]));
      g.closePath();
      g.strokeStyle = 'rgba(0,0,0,0.55)';
      g.lineWidth = Math.max(4, W * 0.07);
      g.stroke();
      g.strokeStyle = 'rgba(234,243,240,0.78)';
      g.lineWidth = Math.max(2, W * 0.032);
      g.stroke();
      const a = pts[0];
      const b = pts[Math.min(2, pts.length - 1)];
      const ang = Math.atan2(sz(b) - sz(a), sx(b) - sx(a));
      g.save();
      g.translate(sx(a), sz(a));
      g.rotate(ang + Math.PI / 2);
      g.fillStyle = '#6ef3c5';
      g.fillRect(-W * 0.05, -W * 0.012, W * 0.1, W * 0.024);
      g.restore();
    }
    map.base = c;
  }

  function drawMap() {
    if (disposed || root.hidden) return;
    sizeMap();
    if (!map.base) drawBase();
    const g = mapCanvas.getContext('2d');
    if (!g) return;
    const W = mapCanvas.width;
    g.clearRect(0, 0, W, mapCanvas.height);
    if (map.base) g.drawImage(map.base, 0, 0);
    const r = Math.max(2.5, W * 0.034);
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < map.count; i++) {
        if (!map.on[i]) continue;
        const kind = map.kinds[i];
        if ((pass === 0) === (kind === 1)) continue;
        const x = mapX(map.xs[i]);
        const z = mapZ(map.zs[i]);
        g.beginPath();
        if (kind === 2) {
          g.arc(x, z, r * 1.05, 0, Math.PI * 2);
          g.strokeStyle = 'rgba(190,230,255,0.9)';
          g.lineWidth = Math.max(1.5, r * 0.45);
          g.stroke();
          continue;
        }
        g.arc(x, z, kind === 1 ? r * 1.45 : r, 0, Math.PI * 2);
        g.fillStyle = kind === 1 ? '#6ef3c5' : map.colors[i];
        g.fill();
        g.lineWidth = Math.max(1, r * (kind === 1 ? 0.5 : 0.35));
        g.strokeStyle = kind === 1 ? '#ffffff' : 'rgba(0,0,0,0.75)';
        g.stroke();
      }
    }
  }

  function toast(kind, label, gain) {
    if (disposed) return;
    const el = makeEl('div', 'nrh-toast nrh-toast--' + (kind || 'info'));
    const lab = makeEl('span', 'nrh-toast__label');
    lab.textContent = label;
    el.appendChild(lab);
    const gl = makeEl('span', 'nrh-toast__gain');
    if (typeof gain === 'number' && gain > 0.004) {
      gl.innerHTML = ICON_BOLT;
      const txt = document.createElement('span');
      txt.textContent = '+' + Math.max(1, Math.round(gain * 100)) + '% ' + tr('hud_nitro');
      gl.appendChild(txt);
    } else if (typeof gain === 'string' && gain) {
      gl.textContent = gain;
    } else {
      gl.hidden = true;
    }
    el.appendChild(gl);
    toasts.insertBefore(el, toasts.firstChild);
    liveToasts.push(el);
    while (liveToasts.length > 3) {
      const old = liveToasts.shift();
      if (old.parentNode) old.parentNode.removeChild(old);
    }
    requestAnimationFrame(function () { el.classList.add('is-on'); });
    setTimeout(function () {
      el.classList.add('is-off');
      setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
        const i = liveToasts.indexOf(el);
        if (i >= 0) liveToasts.splice(i, 1);
      }, 380);
    }, kind === 'lap' || kind === 'best' ? 2000 : 1500);
  }

  function clearToasts() {
    for (let i = 0; i < liveToasts.length; i++) {
      const el = liveToasts[i];
      if (el.parentNode) el.parentNode.removeChild(el);
    }
    liveToasts.length = 0;
  }

  function finalLap() {
    bannerText.textContent = tr('final_lap');
    banner.classList.add('is-on');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(function () { banner.classList.remove('is-on'); }, 2600);
  }

  function setWrongWay(on) {
    const v = !!on;
    if (v === wrongOn) return;
    wrongOn = v;
    wrong.classList.toggle('is-on', v);
  }

  function reset() {
    clearToasts();
    clearTimeout(bannerTimer);
    banner.classList.remove('is-on');
    setWrongWay(false);
    last.speed = -1; last.gear = ''; last.rpmOn = -1; last.nitro = -1; last.boost = null; last.full = null;
    last.pos = -1; last.total = -1; last.lap = -1; last.laps = -1; last.time = ''; last.lapTime = ''; last.best = '';
    last.delta = ''; last.deltaGood = null;
    deltaEl.hidden = true;
    map.dirty = true;
  }

  function dispose() {
    disposed = true;
    clearTimeout(bannerTimer);
    clearToasts();
    if (root.parentNode) root.parentNode.removeChild(root);
  }

  applyCopy();

  return {
    root,
    show,
    setDim,
    setUnits,
    setTouch,
    setStandingVisible,
    applyCopy,
    update,
    setTrackMap,
    setDots,
    setDot,
    drawMap,
    toast,
    clearToasts,
    finalLap,
    setWrongWay,
    reset,
    dispose,
    get units() { return units; }
  };
}
