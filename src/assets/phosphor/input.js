const SENS_DEFAULTS = { mnk: 0.0022, pad: 2.6, touch: 0.004, gyro: 0.7, adsMul: 0.55 };

const LABEL_DEFAULTS = { fire: 'FIRE', ads: 'ADS', jump: 'JUMP', reload: 'RELOAD', move: 'Move', look: 'Look' };

const GAME_KEYS = {
  KeyW: 1, KeyA: 1, KeyS: 1, KeyD: 1,
  ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1,
  Space: 1, ShiftLeft: 1, ShiftRight: 1,
  KeyC: 1, ControlLeft: 1, ControlRight: 1,
  KeyR: 1, KeyT: 1, Backspace: 1, Escape: 1, Tab: 1
};

const PAD_DEAD = 0.18;
const PAD_TRIG_ON = 0.35;
const PAD_LOOK_POW = 1.6;
const PAD_ACT = 0.2;
const PAD_SPRINT = 0.88;

const STICK_R = 60;
const FLICK_PX = 40;
const FLICK_MS = 150;
const FLICK_HOLD_MS = 220;
const TOUCH_SPRINT = 0.8;

const GYRO_MAX_STEP = 20;
const DEG2RAD = Math.PI / 180;

const GYRO_SMOOTH_MAX = 0.95;
const TOUCH_SMOOTH_MAX = 0.6;
const LOOK_DEFAULTS = { touchSmooth: 0.35, gyroSmooth: 0.5, gyroPolarity: 1 };

const STYLE_ID = 'ph-touch-style';
const STYLE_TEXT = [
  '.ph-touch{position:absolute;inset:0;z-index:6;pointer-events:none;touch-action:none;',
  '-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent;',
  "font-family:var(--font-mono,ui-monospace,'Courier New',monospace)}",
  '.ph-touch__zone{position:absolute;top:0;bottom:0;width:50%;pointer-events:auto;touch-action:none}',
  '.ph-touch__zone--left{left:0}',
  '.ph-touch__zone--right{right:0}',
  '.ph-touch__stick{position:absolute;left:0;top:0;width:120px;height:120px;margin:-60px 0 0 -60px;',
  'border-radius:50%;border:1px solid rgba(110,243,197,.30);',
  'background:radial-gradient(circle,rgba(110,243,197,.10) 0%,rgba(10,10,10,.24) 70%);',
  'opacity:0;transition:opacity .12s linear;pointer-events:none;will-change:transform,opacity}',
  '.ph-touch__stick.is-on{opacity:1}',
  '.ph-touch__knob{position:absolute;left:50%;top:50%;width:46px;height:46px;margin:-23px 0 0 -23px;',
  'border-radius:50%;background:rgba(110,243,197,.42);border:1px solid rgba(110,243,197,.65);',
  'box-shadow:0 0 14px rgba(110,243,197,.35);will-change:transform}',
  '.ph-touch__btns{position:absolute;display:grid;grid-template-columns:auto auto;',
  "grid-template-areas:'reload ads' 'jump fire';gap:12px;align-items:end;justify-items:center;",
  'right:calc(16px + env(safe-area-inset-right,0px));bottom:calc(16px + env(safe-area-inset-bottom,0px));',
  'pointer-events:none}',
  '.ph-touch__btn{pointer-events:auto;touch-action:none;-webkit-appearance:none;appearance:none;',
  'min-width:60px;min-height:60px;width:60px;height:60px;border-radius:50%;',
  'display:flex;align-items:center;justify-content:center;padding:0;',
  'font:inherit;font-size:10px;letter-spacing:.06em;font-weight:600;',
  'color:rgba(226,232,240,.86);background:rgba(10,10,10,.38);',
  'border:1px solid rgba(255,255,255,.16);backdrop-filter:none;cursor:pointer}',
  '.ph-touch__btn--fire{grid-area:fire;width:76px;height:76px;min-width:76px;min-height:76px;font-size:11px;',
  'color:#0a0a0a;background:rgba(110,243,197,.62);border-color:rgba(110,243,197,.85)}',
  '.ph-touch__btn--ads{grid-area:ads}',
  '.ph-touch__btn--jump{grid-area:jump}',
  '.ph-touch__btn--reload{grid-area:reload}',
  '.ph-touch__btn.is-down{background:rgba(110,243,197,.34);border-color:rgba(110,243,197,.75);color:#e2e8f0}',
  '.ph-touch__btn--fire.is-down{background:rgba(110,243,197,.92);color:#0a0a0a}',
  '.ph-touch__btn.is-on{background:rgba(110,243,197,.20);border-color:rgba(110,243,197,.70);color:#6ef3c5}'
].join('');

function isNum(v) {
  return typeof v === 'number' && isFinite(v);
}

function clamp1(v) {
  if (v < -1) return -1;
  if (v > 1) return 1;
  return v;
}

function nowMs() {
  if (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') return performance.now();
  return Date.now();
}

function screenAngle() {
  try {
    if (typeof screen !== 'undefined' && screen && screen.orientation && isNum(screen.orientation.angle)) return screen.orientation.angle;
    if (typeof window !== 'undefined' && isNum(window.orientation)) return window.orientation;
  } catch (_) {}
  return 0;
}

function wrapDeg(v) {
  let x = (v + 180) % 360;
  if (x < 0) x += 360;
  return x - 180;
}

function coarsePointer() {
  try {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      return window.matchMedia('(pointer: coarse)').matches === true;
    }
  } catch (_) {}
  return false;
}

export function createInput(stageEl, canvas, opts) {
  const options = opts && typeof opts === 'object' ? opts : {};
  const labels = Object.assign({}, LABEL_DEFAULTS, options.labels && typeof options.labels === 'object' ? options.labels : null);
  const stage = stageEl || null;
  const lockTarget = canvas || stageEl || null;

  const sensitivity = Object.assign({}, SENS_DEFAULTS);
  const lookTune = Object.assign({}, LOOK_DEFAULTS);

  const intents = {
    forward: 0,
    strafe: 0,
    jumpPressed: false,
    crouchHeld: false,
    sprintHeld: false,
    fireHeld: false,
    adsHeld: false,
    reloadPressed: false,
    restartPressed: false,
    pausePressed: false,
    lookDx: 0,
    lookDy: 0
  };

  const keys = Object.create(null);

  let lastMethod = coarsePointer() ? 'touch' : 'mnk';
  let lockLostCb = null;
  let wasLocked = false;
  let expectedExit = false;

  let pendingJump = false;
  let pendingReload = false;
  let pendingRestart = false;
  let pendingPause = false;

  let mouseDx = 0;
  let mouseDy = 0;
  let mouseFire = false;
  let mouseAds = false;

  const padL = { x: 0, y: 0, m: 0 };
  const padR = { x: 0, y: 0, m: 0 };
  const padAxisRest = [];
  let padRestSampled = false;
  const padOverride = { fireB: -1, fireA: -1, adsB: -1, adsA: -1, pauseB: -1, sprintB: -1, ryAxis: -1 };
  let padCaptureCb = null;
  const padSeen = {};
  let padAutoFireA = -1;
  let padAutoAdsA = -1;
  const padPrev = new Uint8Array(24);
  const padTrigArmed = { lt: false, rt: false };
  let padIndex = -1;
  let padCrouch = false;
  let padSprint = false;
  let padFire = false;
  let padAds = false;
  let padLookX = 0;
  let padLookY = 0;

  let touchUI = false;
  let touchRoot = null;
  let touchStickEl = null;
  let touchKnobEl = null;
  let touchAdsBtn = null;
  const ptrKind = new Map();
  const stick = { id: -1, ox: 0, oy: 0, x: 0, y: 0, m: 0, downT: 0, flicked: false };
  const look = { id: -1, lx: 0, ly: 0 };
  let touchDx = 0;
  let touchDy = 0;
  let touchPrevX = 0;
  let touchPrevY = 0;
  let touchFire = false;
  let touchAdsOn = false;
  let crouchUntil = 0;

  let gyroOn = false;
  let gyroPending = null;
  const gyro = { has: false, yaw: 0, pitch: 0 };
  let gyroDx = 0;
  let gyroDy = 0;
  let gyroLpX = 0;
  let gyroLpY = 0;

  function setMethod(m) {
    lastMethod = m;
  }

  function lockedElement() {
    try {
      const el = document.pointerLockElement || document.webkitPointerLockElement;
      return el || null;
    } catch (_) {}
    return null;
  }

  function isLocked() {
    const el = lockedElement();
    return !!el && (!lockTarget || el === lockTarget);
  }

  function mergeSens(src) {
    if (!src || typeof src !== 'object') return;
    const k = ['mnk', 'pad', 'touch', 'gyro', 'adsMul'];
    for (let i = 0; i < k.length; i++) {
      const v = src[k[i]];
      if (isNum(v) && v >= 0) sensitivity[k[i]] = v;
    }
  }

  function mergeLook(src) {
    if (!src || typeof src !== 'object') return;
    if (isNum(src.touchSmooth)) {
      const v = Math.max(0, Math.min(TOUCH_SMOOTH_MAX, src.touchSmooth));
      if (v !== lookTune.touchSmooth) {
        lookTune.touchSmooth = v;
        touchPrevX = 0;
        touchPrevY = 0;
      }
    }
    if (isNum(src.gyroSmooth)) {
      const v = Math.max(0, Math.min(GYRO_SMOOTH_MAX, src.gyroSmooth));
      if (v !== lookTune.gyroSmooth) {
        lookTune.gyroSmooth = v;
        gyroLpX = 0;
        gyroLpY = 0;
      }
    }
    if (isNum(src.gyroPolarity)) {
      lookTune.gyroPolarity = src.gyroPolarity < 0 ? -1 : 1;
    }
  }

  function clearHeld() {
    for (const k in keys) keys[k] = false;
    mouseDx = 0;
    mouseDy = 0;
    mouseFire = false;
    mouseAds = false;
    gyro.has = false;
    gyroDx = 0;
    gyroDy = 0;
    gyroLpX = 0;
    gyroLpY = 0;
    resetTouchState();
  }

  function onKeyDown(e) {
    if (!e) return;
    const code = e.code;
    if (!code || !GAME_KEYS[code]) return;
    if (e.metaKey || e.altKey) return;
    const guarded = isLocked() || touchUI;
    if (guarded && code !== 'Escape') {
      try { e.preventDefault(); } catch (_) {}
    }
    setMethod('mnk');
    if (e.repeat) return;
    keys[code] = true;
    if (code === 'Space') pendingJump = true;
    else if (code === 'KeyR') pendingReload = true;
    else if (code === 'KeyT' || code === 'Backspace') pendingRestart = true;
    else if (code === 'Escape') pendingPause = true;
  }

  function onKeyUp(e) {
    if (!e) return;
    const code = e.code;
    if (!code || !GAME_KEYS[code]) return;
    keys[code] = false;
  }

  function updateMouseButtons(mask) {
    mouseFire = (mask & 1) === 1;
    mouseAds = (mask & 2) === 2;
  }

  function onPointerMove(e) {
    if (!e) return;
    if (e.pointerType === 'touch') return;
    if (!isLocked()) return;
    if (isNum(e.buttons)) updateMouseButtons(e.buttons);
    const dx = isNum(e.movementX) ? e.movementX : 0;
    const dy = isNum(e.movementY) ? e.movementY : 0;
    if (dx === 0 && dy === 0) return;
    mouseDx += dx;
    mouseDy += dy;
    setMethod('mnk');
  }

  function onPointerDown(e) {
    if (!e || e.pointerType === 'touch') return;
    if (!isLocked()) return;
    updateMouseButtons(isNum(e.buttons) ? e.buttons : 0);
    setMethod('mnk');
  }

  function onPointerUp(e) {
    if (!e || e.pointerType === 'touch') return;
    updateMouseButtons(isLocked() && isNum(e.buttons) ? e.buttons : 0);
  }

  function onContextMenu(e) {
    if (!e) return;
    if (!isLocked() && !touchUI) return;
    try { e.preventDefault(); } catch (_) {}
  }

  function onLockChange() {
    const locked = isLocked();
    if (locked === wasLocked) return;
    wasLocked = locked;
    const expected = expectedExit;
    expectedExit = false;
    if (locked) return;
    mouseFire = false;
    mouseAds = false;
    mouseDx = 0;
    mouseDy = 0;
    if (expected) return;
    pendingPause = true;
    if (lockLostCb) {
      try { lockLostCb(); } catch (_) {}
    }
  }

  function onBlur() {
    clearHeld();
  }

  function onVisibility() {
    try {
      if (document.hidden) clearHeld();
    } catch (_) {}
  }

  function padButton(pad, i) {
    const b = pad.buttons;
    if (!b || i >= b.length) return false;
    const x = b[i];
    if (x && typeof x === 'object') return x.pressed === true || (isNum(x.value) && x.value > 0.5);
    return !!x;
  }

  function padTrigger(pad, bi, ai, side) {
    const b = pad.buttons;
    if (b && b.length > bi) {
      const x = b[bi];
      if (x && typeof x === 'object') return isNum(x.value) ? x.value : (x.pressed ? 1 : 0);
      return x ? 1 : 0;
    }
    const ax = pad.axes;
    if (ax && ax.length > ai && isNum(ax[ai])) {
      const v = (ax[ai] + 1) / 2;
      if (v < 0.15) padTrigArmed[side] = true;
      return padTrigArmed[side] ? v : 0;
    }
    return 0;
  }

  function radial(x, y, out) {
    const ax = isNum(x) ? x : 0;
    const ay = isNum(y) ? y : 0;
    const m = Math.sqrt(ax * ax + ay * ay);
    if (m <= PAD_DEAD) {
      out.x = 0;
      out.y = 0;
      out.m = 0;
      return;
    }
    const n = Math.min(1, (m - PAD_DEAD) / (1 - PAD_DEAD));
    const s = n / m;
    out.x = ax * s;
    out.y = ay * s;
    out.m = n;
  }

  function pickPad() {
    let list = null;
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function') list = navigator.getGamepads();
    } catch (_) {}
    if (!list) return null;
    const now = nowMs();
    let best = null;
    let bestActive = -1;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (!p || p.connected === false) continue;
      const key = isNum(p.index) ? p.index : i;
      let s = padSeen[key];
      if (!s) {
        s = { stamp: -1, active: 0 };
        padSeen[key] = s;
      }
      const ts = isNum(p.timestamp) ? p.timestamp : 0;
      if (s.stamp !== -1 && ts !== s.stamp) s.active = now;
      s.stamp = ts;
      if (!best || s.active > bestActive) {
        best = p;
        bestActive = s.active;
      } else if (s.active === bestActive && best.mapping !== 'standard' && p.mapping === 'standard') {
        best = p;
      }
    }
    return best;
  }

  function readPad() {
    padCrouch = false;
    padSprint = false;
    padFire = false;
    padAds = false;
    padLookX = 0;
    padLookY = 0;
    padL.x = 0;
    padL.y = 0;
    padL.m = 0;

    const pad = pickPad();
    if (!pad || !pad.buttons || !pad.axes) {
      if (padIndex !== -1) {
        padIndex = -1;
        padPrev.fill(0);
        padTrigArmed.lt = false;
        padTrigArmed.rt = false;
      }
      return;
    }
    if (pad.index !== padIndex) {
      padIndex = isNum(pad.index) ? pad.index : 0;
      padPrev.fill(0);
      padTrigArmed.lt = false;
      padTrigArmed.rt = false;
      padRestSampled = false;
      padAxisRest.length = 0;
    }

    const ax = pad.axes;
    if (!padRestSampled) {
      for (let i = 0; i < ax.length; i++) padAxisRest[i] = isNum(ax[i]) ? ax[i] : 0;
      padRestSampled = true;
      padAutoFireA = -1;
      padAutoAdsA = -1;
      if (pad.mapping !== 'standard') {
        const trigAxes = [];
        for (let i = 2; i < ax.length; i++) {
          if (axisTriggerLike(i)) trigAxes.push(i);
        }
        if (trigAxes.length >= 2) {
          padAutoAdsA = trigAxes[0];
          padAutoFireA = trigAxes[1];
        } else if (trigAxes.length === 1) {
          padAutoFireA = trigAxes[0];
        }
      }
    }
    const ryi = pickRyAxis(ax);
    radial(axRel(ax, 0), axRel(ax, 1), padL);
    radial(axRel(ax, 2), axRel(ax, ryi), padR);
    if (padR.m > 0) {
      const k = Math.pow(padR.m, PAD_LOOK_POW) / padR.m;
      padLookX = padR.x * k;
      padLookY = padR.y * k;
    }

    if (padCaptureCb) captureFromPad(pad, ax);

    const fireA = padOverride.fireA >= 0 ? padOverride.fireA : padAutoFireA;
    const adsA = padOverride.adsA >= 0 ? padOverride.adsA : padAutoAdsA;
    const rt = overrideValue(pad, ax, padOverride.fireB, fireA, 'rt');
    const lt = overrideValue(pad, ax, padOverride.adsB, adsA, 'lt');
    padFire = rt > PAD_TRIG_ON;
    padAds = lt > PAD_TRIG_ON;
    padCrouch = padButton(pad, 1);
    padSprint = padL.m >= PAD_SPRINT || padButton(pad, 10) ||
      (padOverride.sprintB >= 0 && padButton(pad, padOverride.sprintB));

    const pauseIdx = padOverride.pauseB >= 0 ? padOverride.pauseB : 9;
    let act = padL.m > 0 || padR.m > 0 || rt > PAD_ACT || lt > PAD_ACT;
    const bl = Math.min(pad.buttons.length, padPrev.length);
    for (let i = 0; i < bl; i++) {
      const down = padButton(pad, i);
      const was = padPrev[i] === 1;
      padPrev[i] = down ? 1 : 0;
      if (down) act = true;
      if (down && !was) {
        if (i === padOverride.fireB || i === padOverride.adsB || i === padOverride.sprintB) continue;
        if (i === pauseIdx) pendingPause = true;
        else if (i === 0) pendingJump = true;
        else if (i === 2) pendingReload = true;
        else if (i === 3) pendingRestart = true;
      }
    }
    if (act) setMethod('pad');
  }

  function axRel(ax, i) {
    const v = isNum(ax[i]) ? ax[i] : 0;
    const r = isNum(padAxisRest[i]) ? padAxisRest[i] : 0;
    return Math.abs(r) > 0.25 ? v - r : v;
  }

  function axisTriggerLike(i) {
    return Math.abs(isNum(padAxisRest[i]) ? padAxisRest[i] : 0) > 0.8;
  }

  function pickRyAxis(ax) {
    if (padOverride.ryAxis >= 0) return padOverride.ryAxis;
    if (ax.length > 3 && !axisTriggerLike(3)) return 3;
    if (ax.length > 5 && !axisTriggerLike(5)) return 5;
    if (ax.length > 4 && !axisTriggerLike(4)) return 4;
    return 3;
  }

  function axis01(ax, i) {
    if (!isNum(ax[i])) return 0;
    const rest = isNum(padAxisRest[i]) ? padAxisRest[i] : 0;
    const span = 1 - rest;
    if (!(span > 0.05)) return 0;
    const v = (ax[i] - rest) / span;
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }

  function overrideValue(pad, ax, bi, ai, side) {
    if (ai >= 0) return axis01(ax, ai);
    if (bi >= 0) {
      const b = pad.buttons;
      if (b && b.length > bi) {
        const x = b[bi];
        if (x && typeof x === 'object') return isNum(x.value) ? x.value : (x.pressed ? 1 : 0);
        return x ? 1 : 0;
      }
      return 0;
    }
    return padTrigger(pad, side === 'rt' ? 7 : 6, side === 'rt' ? 5 : 4, side);
  }

  function captureFromPad(pad, ax) {
    const b = pad.buttons;
    const bl = Math.min(b ? b.length : 0, padPrev.length);
    for (let i = 0; i < bl; i++) {
      if (padButton(pad, i) && padPrev[i] !== 1) {
        const cb = padCaptureCb;
        padCaptureCb = null;
        padPrev[i] = 1;
        try { cb({ kind: 'button', index: i }); } catch (_) {}
        return;
      }
    }
    for (let i = 2; i < ax.length; i++) {
      if (i === 2) continue;
      if (axisTriggerLike(i) && axis01(ax, i) > 0.55) {
        const cb = padCaptureCb;
        padCaptureCb = null;
        try { cb({ kind: 'axis', index: i }); } catch (_) {}
        return;
      }
    }
  }

  function ensureStyle() {
    try {
      if (document.getElementById(STYLE_ID)) return;
      const s = document.createElement('style');
      s.id = STYLE_ID;
      s.textContent = STYLE_TEXT;
      (document.head || document.documentElement).appendChild(s);
    } catch (_) {}
  }

  function pressVis(el, on) {
    if (!el || !el.classList) return;
    el.classList.toggle('is-down', !!on);
  }

  function resetTouchState() {
    stick.id = -1;
    stick.x = 0;
    stick.y = 0;
    stick.m = 0;
    stick.flicked = false;
    look.id = -1;
    touchDx = 0;
    touchDy = 0;
    touchPrevX = 0;
    touchPrevY = 0;
    touchFire = false;
    crouchUntil = 0;
    ptrKind.clear();
    if (touchStickEl && touchStickEl.classList) touchStickEl.classList.remove('is-on');
    if (touchRoot) {
      const list = touchRoot.querySelectorAll('.ph-touch__btn');
      for (let i = 0; i < list.length; i++) list[i].classList.remove('is-down');
    }
  }

  function rootRect() {
    if (!touchRoot) return null;
    try { return touchRoot.getBoundingClientRect(); } catch (_) {}
    return null;
  }

  function placeStick(cx, cy) {
    if (!touchStickEl) return;
    const r = rootRect();
    const x = r ? cx - r.left : cx;
    const y = r ? cy - r.top : cy;
    touchStickEl.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
    touchStickEl.classList.add('is-on');
    moveKnob(0, 0);
  }

  function moveKnob(nx, ny) {
    if (!touchKnobEl) return;
    touchKnobEl.style.transform = 'translate(' + (nx * STICK_R).toFixed(1) + 'px,' + (ny * STICK_R).toFixed(1) + 'px)';
  }

  function onTouchDown(e) {
    if (!e || !e.target || typeof e.target.closest !== 'function') return;
    const el = e.target.closest('[data-ph]');
    if (!el) return;
    const kind = el.getAttribute('data-ph');
    if (!kind) return;
    setMethod('touch');
    try { el.setPointerCapture(e.pointerId); } catch (_) {}
    try { e.preventDefault(); } catch (_) {}
    ptrKind.set(e.pointerId, kind);
    if (kind === 'move') {
      if (stick.id !== -1) return;
      stick.id = e.pointerId;
      stick.ox = e.clientX;
      stick.oy = e.clientY;
      stick.x = 0;
      stick.y = 0;
      stick.m = 0;
      stick.downT = nowMs();
      stick.flicked = false;
      placeStick(e.clientX, e.clientY);
    } else if (kind === 'look') {
      if (look.id !== -1) return;
      look.id = e.pointerId;
      look.lx = e.clientX;
      look.ly = e.clientY;
    } else if (kind === 'fire') {
      touchFire = true;
      pressVis(el, true);
    } else if (kind === 'ads') {
      touchAdsOn = !touchAdsOn;
      if (el.classList) el.classList.toggle('is-on', touchAdsOn);
    } else if (kind === 'jump') {
      pendingJump = true;
      pressVis(el, true);
    } else if (kind === 'reload') {
      pendingReload = true;
      pressVis(el, true);
    }
  }

  function onTouchMove(e) {
    if (!e) return;
    const kind = ptrKind.get(e.pointerId);
    if (!kind) return;
    try { e.preventDefault(); } catch (_) {}
    if (kind === 'move' && e.pointerId === stick.id) {
      const dx = e.clientX - stick.ox;
      const dy = e.clientY - stick.oy;
      let nx = dx / STICK_R;
      let ny = dy / STICK_R;
      const m = Math.sqrt(nx * nx + ny * ny);
      if (m > 1) {
        nx /= m;
        ny /= m;
      }
      stick.x = nx;
      stick.y = ny;
      stick.m = Math.min(1, m);
      if (!stick.flicked && dy >= FLICK_PX && nowMs() - stick.downT < FLICK_MS) {
        stick.flicked = true;
        crouchUntil = nowMs() + FLICK_HOLD_MS;
      }
      moveKnob(nx, ny);
      setMethod('touch');
    } else if (kind === 'look' && e.pointerId === look.id) {
      touchDx += e.clientX - look.lx;
      touchDy += e.clientY - look.ly;
      look.lx = e.clientX;
      look.ly = e.clientY;
      setMethod('touch');
    }
  }

  function onTouchEnd(e) {
    if (!e) return;
    const kind = ptrKind.get(e.pointerId);
    if (!kind) return;
    ptrKind.delete(e.pointerId);
    try { e.preventDefault(); } catch (_) {}
    if (kind === 'move' && e.pointerId === stick.id) {
      stick.id = -1;
      stick.x = 0;
      stick.y = 0;
      stick.m = 0;
      stick.flicked = false;
      if (touchStickEl && touchStickEl.classList) touchStickEl.classList.remove('is-on');
      moveKnob(0, 0);
    } else if (kind === 'look' && e.pointerId === look.id) {
      look.id = -1;
    } else if (kind === 'fire') {
      touchFire = false;
    }
    if (e.target && typeof e.target.closest === 'function') {
      const el = e.target.closest('.ph-touch__btn');
      if (el) pressVis(el, false);
    }
  }

  function mkBtn(kind, text, extra) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ph-touch__btn' + (extra ? ' ' + extra : '');
    b.setAttribute('data-ph', kind);
    b.setAttribute('tabindex', '-1');
    b.setAttribute('aria-label', text);
    b.textContent = text;
    return b;
  }

  function buildTouch() {
    if (touchUI || !stage || typeof document === 'undefined') return;
    ensureStyle();
    const root = document.createElement('div');
    root.className = 'ph-touch';

    const zl = document.createElement('div');
    zl.className = 'ph-touch__zone ph-touch__zone--left';
    zl.setAttribute('data-ph', 'move');
    zl.setAttribute('aria-label', labels.move);

    const zr = document.createElement('div');
    zr.className = 'ph-touch__zone ph-touch__zone--right';
    zr.setAttribute('data-ph', 'look');
    zr.setAttribute('aria-label', labels.look);

    const st = document.createElement('div');
    st.className = 'ph-touch__stick';
    const kn = document.createElement('div');
    kn.className = 'ph-touch__knob';
    st.appendChild(kn);

    const btns = document.createElement('div');
    btns.className = 'ph-touch__btns';
    const bFire = mkBtn('fire', labels.fire, 'ph-touch__btn--fire');
    const bAds = mkBtn('ads', labels.ads, 'ph-touch__btn--ads');
    const bJump = mkBtn('jump', labels.jump, 'ph-touch__btn--jump');
    const bReload = mkBtn('reload', labels.reload, 'ph-touch__btn--reload');
    btns.appendChild(bFire);
    btns.appendChild(bAds);
    btns.appendChild(bJump);
    btns.appendChild(bReload);

    root.appendChild(zl);
    root.appendChild(zr);
    root.appendChild(st);
    root.appendChild(btns);

    root.addEventListener('pointerdown', onTouchDown);
    root.addEventListener('pointermove', onTouchMove);
    root.addEventListener('pointerup', onTouchEnd);
    root.addEventListener('pointercancel', onTouchEnd);
    root.addEventListener('lostpointercapture', onTouchEnd);
    root.addEventListener('contextmenu', onContextMenu);

    try { stage.appendChild(root); } catch (_) { return; }

    touchRoot = root;
    touchStickEl = st;
    touchKnobEl = kn;
    touchAdsBtn = bAds;
    touchUI = true;
    setMethod('touch');
  }

  function destroyTouch() {
    if (!touchUI) return;
    resetTouchState();
    touchAdsOn = false;
    const root = touchRoot;
    touchRoot = null;
    touchStickEl = null;
    touchKnobEl = null;
    touchAdsBtn = null;
    touchUI = false;
    if (!root) return;
    root.removeEventListener('pointerdown', onTouchDown);
    root.removeEventListener('pointermove', onTouchMove);
    root.removeEventListener('pointerup', onTouchEnd);
    root.removeEventListener('pointercancel', onTouchEnd);
    root.removeEventListener('lostpointercapture', onTouchEnd);
    root.removeEventListener('contextmenu', onContextMenu);
    try {
      if (root.parentNode) root.parentNode.removeChild(root);
    } catch (_) {}
  }

  function onOrient(e) {
    if (!e) return;
    const b = e.beta;
    const g = e.gamma;
    if (!isNum(b) || !isNum(g)) return;
    const th = screenAngle() * DEG2RAD;
    const cs = Math.cos(th);
    const sn = Math.sin(th);
    const yaw = g * cs - b * sn;
    const pit = g * sn + b * cs;
    if (!gyro.has) {
      gyro.has = true;
      gyro.yaw = yaw;
      gyro.pitch = pit;
      return;
    }
    const dyaw = wrapDeg(yaw - gyro.yaw);
    const dpit = wrapDeg(pit - gyro.pitch);
    gyro.yaw = yaw;
    gyro.pitch = pit;
    if (Math.abs(dyaw) > GYRO_MAX_STEP || Math.abs(dpit) > GYRO_MAX_STEP) return;
    const a = lookTune.gyroSmooth;
    gyroLpX = gyroLpX * a + dyaw * (1 - a);
    gyroLpY = gyroLpY * a + dpit * (1 - a);
    gyroDx += gyroLpX * DEG2RAD;
    gyroDy += gyroLpY * DEG2RAD;
  }

  function startGyro() {
    if (gyroOn) return true;
    try {
      window.addEventListener('deviceorientation', onOrient);
    } catch (_) {
      return false;
    }
    gyroOn = true;
    gyro.has = false;
    gyroDx = 0;
    gyroDy = 0;
    gyroLpX = 0;
    gyroLpY = 0;
    return true;
  }

  function disableGyro() {
    if (!gyroOn) return;
    try {
      window.removeEventListener('deviceorientation', onOrient);
    } catch (_) {}
    gyroOn = false;
    gyro.has = false;
    gyroDx = 0;
    gyroDy = 0;
    gyroLpX = 0;
    gyroLpY = 0;
  }

  function gyroEnabled() {
    return gyroOn;
  }

  function enableGyro() {
    if (gyroOn) return Promise.resolve(true);
    if (gyroPending) return gyroPending;
    let DO = null;
    try {
      DO = typeof DeviceOrientationEvent !== 'undefined' ? DeviceOrientationEvent : null;
    } catch (_) {}
    if (!DO) return Promise.resolve(false);
    let secure = true;
    try {
      secure = typeof window === 'undefined' || window.isSecureContext !== false;
    } catch (_) {}
    if (!secure) return Promise.resolve(false);
    if (typeof DO.requestPermission !== 'function') return Promise.resolve(startGyro());
    let req = null;
    try {
      req = DO.requestPermission();
    } catch (_) {
      return Promise.resolve(false);
    }
    if (!req || typeof req.then !== 'function') return Promise.resolve(false);
    gyroPending = req.then(function (res) {
      gyroPending = null;
      if (res !== 'granted') return false;
      return startGyro();
    }).catch(function () {
      gyroPending = null;
      return false;
    });
    return gyroPending;
  }

  function pointerLockSupported() {
    const el = lockTarget;
    if (!el) return false;
    return typeof el.requestPointerLock === 'function' || typeof el.webkitRequestPointerLock === 'function';
  }

  function requestPointerLock() {
    const el = lockTarget;
    if (!el) return false;
    const std = typeof el.requestPointerLock === 'function';
    if (!std && typeof el.webkitRequestPointerLock !== 'function') return false;
    const plainLock = function () {
      try {
        const q = std ? el.requestPointerLock() : el.webkitRequestPointerLock();
        if (q && typeof q.catch === 'function') q.catch(function () {});
        return true;
      } catch (_) {}
      return false;
    };
    if (!std) return plainLock();
    try {
      const p = el.requestPointerLock({ unadjustedMovement: true });
      if (p && typeof p.catch === 'function') {
        p.catch(function () { plainLock(); });
      }
      return true;
    } catch (_) {}
    return plainLock();
  }

  function exitPointerLock() {
    try {
      if (!lockedElement()) return false;
      if (typeof document.exitPointerLock === 'function') {
        expectedExit = true;
        document.exitPointerLock();
        return true;
      }
      if (typeof document.webkitExitPointerLock === 'function') {
        expectedExit = true;
        document.webkitExitPointerLock();
        return true;
      }
    } catch (_) {}
    return false;
  }

  function poll(dt) {
    const d = isNum(dt) && dt > 0 ? Math.min(dt, 0.25) : 0;
    readPad();

    let fwd = 0;
    let str = 0;
    if (keys.KeyW || keys.ArrowUp) fwd += 1;
    if (keys.KeyS || keys.ArrowDown) fwd -= 1;
    if (keys.KeyD || keys.ArrowRight) str += 1;
    if (keys.KeyA || keys.ArrowLeft) str -= 1;
    if (padL.m > 0) {
      fwd -= padL.y;
      str += padL.x;
    }
    let touchSprint = false;
    if (touchUI && stick.id !== -1) {
      fwd -= stick.y;
      str += stick.x;
      touchSprint = stick.m >= TOUCH_SPRINT;
    }

    const crouch = !!keys.KeyC || !!keys.ControlLeft || !!keys.ControlRight || padCrouch || (touchUI && nowMs() < crouchUntil);
    const sprint = !!keys.ShiftLeft || !!keys.ShiftRight || padSprint || touchSprint;
    const fire = mouseFire || padFire || touchFire;
    const ads = mouseAds || padAds || (touchUI && touchAdsOn);

    const adsF = ads ? sensitivity.adsMul : 1;
    let lookDx = 0;
    let lookDy = 0;

    if (mouseDx !== 0 || mouseDy !== 0) {
      const s = sensitivity.mnk * adsF;
      lookDx += mouseDx * s;
      lookDy -= mouseDy * s;
      mouseDx = 0;
      mouseDy = 0;
    }
    if (padLookX !== 0 || padLookY !== 0) {
      const s = sensitivity.pad * adsF * d;
      lookDx += padLookX * s;
      lookDy -= padLookY * s;
    }
    if (touchDx !== 0 || touchDy !== 0 || touchPrevX !== 0 || touchPrevY !== 0) {
      const k = lookTune.touchSmooth;
      const outX = touchDx * (1 - k) + touchPrevX * k;
      const outY = touchDy * (1 - k) + touchPrevY * k;
      touchPrevX = touchDx;
      touchPrevY = touchDy;
      touchDx = 0;
      touchDy = 0;
      if (outX !== 0 || outY !== 0) {
        const s = sensitivity.touch * adsF;
        lookDx += outX * s;
        lookDy -= outY * s;
      }
    }
    if (gyroDx !== 0 || gyroDy !== 0) {
      const s = sensitivity.gyro * lookTune.gyroPolarity;
      lookDx += gyroDx * s;
      lookDy += gyroDy * s;
      gyroDx = 0;
      gyroDy = 0;
    }

    intents.forward = clamp1(fwd);
    intents.strafe = clamp1(str);
    intents.crouchHeld = crouch;
    intents.sprintHeld = sprint;
    intents.fireHeld = fire;
    intents.adsHeld = ads;
    intents.jumpPressed = pendingJump;
    intents.reloadPressed = pendingReload;
    intents.restartPressed = pendingRestart;
    intents.pausePressed = pendingPause;
    intents.lookDx = lookDx;
    intents.lookDy = lookDy;

    pendingJump = false;
    pendingReload = false;
    pendingRestart = false;
    pendingPause = false;

    return intents;
  }

  function enableTouchUI(on) {
    if (on) buildTouch();
    else destroyTouch();
    return touchUI;
  }

  function setSensitivity(next) {
    mergeSens(next);
    mergeLook(next);
    return sensitivity;
  }

  function lookTuning() {
    return Object.assign({}, lookTune);
  }

  function onPointerLockLost(cb) {
    lockLostCb = typeof cb === 'function' ? cb : null;
  }

  function setPadOverrides(o) {
    if (!o || typeof o !== 'object') return;
    const keys = ['fireB', 'fireA', 'adsB', 'adsA', 'pauseB', 'sprintB', 'ryAxis'];
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (isNum(o[k])) padOverride[k] = Math.round(o[k]);
    }
  }

  function capturePadButton(cb) {
    padCaptureCb = typeof cb === 'function' ? cb : null;
  }

  function padInfo() {
    const pad = pickPad();
    if (!pad) return null;
    const axes = [];
    const ax = pad.axes || [];
    for (let i = 0; i < ax.length; i++) axes.push(isNum(ax[i]) ? Math.round(ax[i] * 100) / 100 : 0);
    const pressed = [];
    const b = pad.buttons || [];
    for (let i = 0; i < b.length; i++) {
      if (padButton(pad, i)) pressed.push(i);
    }
    return {
      id: String(pad.id || '').slice(0, 40),
      mapping: pad.mapping || '',
      axes: axes,
      pressed: pressed,
      ry: pickRyAxis(ax),
      overrides: Object.assign({}, padOverride)
    };
  }

  function method() {
    return lastMethod;
  }

  function destroy() {
    destroyTouch();
    try {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('keyup', onKeyUp, true);
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('contextmenu', onContextMenu);
      document.removeEventListener('pointerlockchange', onLockChange);
      document.removeEventListener('mozpointerlockchange', onLockChange);
      document.removeEventListener('webkitpointerlockchange', onLockChange);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('deviceorientation', onOrient);
    } catch (_) {}
    gyroOn = false;
    lockLostCb = null;
  }

  try {
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keyup', onKeyUp, true);
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('pointerlockchange', onLockChange);
    document.addEventListener('mozpointerlockchange', onLockChange);
    document.addEventListener('webkitpointerlockchange', onLockChange);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
  } catch (_) {}

  mergeSens(options.sensitivity);
  mergeLook(options.sensitivity);
  wasLocked = isLocked();

  return {
    poll: poll,
    method: method,
    requestPointerLock: requestPointerLock,
    exitPointerLock: exitPointerLock,
    isLocked: isLocked,
    pointerLockSupported: pointerLockSupported,
    enableTouchUI: enableTouchUI,
    enableGyro: enableGyro,
    disableGyro: disableGyro,
    gyroEnabled: gyroEnabled,
    setSensitivity: setSensitivity,
    lookTuning: lookTuning,
    onPointerLockLost: onPointerLockLost,
    setPadOverrides: setPadOverrides,
    capturePadButton: capturePadButton,
    padInfo: padInfo,
    destroy: destroy,
    sensitivity: sensitivity,
    defaults: Object.assign({}, SENS_DEFAULTS),
    lookDefaults: Object.assign({}, LOOK_DEFAULTS),
    labels: labels
  };
}
