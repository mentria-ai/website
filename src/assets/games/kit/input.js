import { clamp, deadzone as applyDeadzone, expo as applyExpo, approach } from './math.js';

const STYLE_ID = 'gk-input-style';
const DEG = Math.PI / 180;

const COPY_DEFAULTS = {
  gas: 'GAS',
  brake: 'BRAKE',
  drift: 'DRIFT',
  nitro: 'NITRO',
  camera: 'CAM',
  mode: 'MODE',
  reset: 'RESET',
  lookBack: 'BACK',
  steerLeft: 'Steer left',
  steerRight: 'Steer right',
  wheel: 'Steering wheel',
  throttleYaw: 'THROTTLE · YAW',
  pitchRoll: 'PITCH · ROLL',
  steer: 'STEER'
};

const SETTINGS_DEFAULTS = {
  touch: 'auto',
  steer: 'zones',
  autoGas: true,
  stickSize: 1,
  touchOpacity: 1,
  tiltRange: 24,
  tiltInvert: false,
  tiltCenter: 0,
  invertPitch: false,
  padDeadzone: 0.1,
  haptics: true
};

const ICONS = {
  gas: '<path d="M6.5 13.5L12 8l5.5 5.5"/><path d="M6.5 18.5L12 13l5.5 5.5"/>',
  brake: '<circle cx="12" cy="12" r="5.5"/><path d="M5 6.8a8.6 8.6 0 0 0 0 10.4"/><path d="M19 6.8a8.6 8.6 0 0 1 0 10.4"/><path d="M12 9.5v3"/><path d="M12 14.6v.1"/>',
  drift: '<path d="M5 19.5c.6-6.2 4.4-10.4 12.6-12.4"/><path d="M9.6 20.2c.5-4.6 3.3-7.7 9.4-9.1"/><path d="M14.4 4.6l3.4 2.4-2.5 3.3"/>',
  nitro: '<path d="M13.4 2.8L5.6 13.6h5.6l-1 7.6 7.8-10.8h-5.6z"/>',
  camera: '<path d="M4 8.2h3.2l1.8-2.4h6l1.8 2.4H20v10H4z"/><circle cx="12" cy="13.1" r="3.1"/>',
  mode: '<circle cx="12" cy="12" r="7.2"/><path d="M12 4.8v3.4M12 15.8v3.4M4.8 12h3.4M15.8 12h3.4"/><circle cx="12" cy="12" r="1.4"/>',
  reset: '<path d="M5.2 12.4a6.9 6.9 0 1 0 2-5.1"/><path d="M5.6 3.8v4h4"/>',
  lookBack: '<path d="M9 7.5L4.5 12 9 16.5"/><path d="M5 12h9.5a5 5 0 0 1 0 10"/>',
  left: '<path d="M14.8 5.2L8 12l6.8 6.8"/>',
  right: '<path d="M9.2 5.2L16 12l-6.8 6.8"/>'
};

const STYLE_TEXT = [
  '.gk-touch{position:absolute;inset:0;z-index:20;pointer-events:none;touch-action:none;-webkit-user-select:none;user-select:none;',
  '-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;font-family:var(--font-mono,ui-monospace,monospace);',
  '--gk-s:1;--gk-o:1;--gk-mint:110,243,197;opacity:var(--gk-o);transition:opacity .2s ease,visibility .2s}',
  '.gk-touch[hidden]{display:none}',
  '[data-gk-menu]>.gk-touch{opacity:0;visibility:hidden}',
  '.gk-touch *{box-sizing:border-box}',
  '.gk-zone{position:absolute;pointer-events:auto;touch-action:none}',
  '.gk-stick{position:absolute;left:0;top:0;pointer-events:none;opacity:.62;transition:opacity .16s ease;will-change:transform}',
  '.gk-stick.is-active{opacity:1}',
  '.gk-stick__ring{position:absolute;inset:0;border-radius:50%;',
  'border:1.5px solid rgba(var(--gk-mint),.55);',
  'background:radial-gradient(circle at 50% 50%,rgba(4,10,12,.16) 0%,rgba(4,10,12,.34) 62%,rgba(var(--gk-mint),.08) 100%);',
  'box-shadow:0 0 0 1px rgba(0,0,0,.28),inset 0 0 22px rgba(var(--gk-mint),.07)}',
  '.gk-stick--square .gk-stick__ring{border-radius:30%}',
  '.gk-stick.is-active .gk-stick__ring{border-color:rgba(var(--gk-mint),.8);box-shadow:0 0 0 1px rgba(0,0,0,.3),0 0 18px rgba(var(--gk-mint),.18),inset 0 0 26px rgba(var(--gk-mint),.1)}',
  '.gk-stick__tick{position:absolute;background:rgba(var(--gk-mint),.5);border-radius:1px}',
  '.gk-stick__tick--n,.gk-stick__tick--s{left:50%;width:2px;height:7px;margin-left:-1px}',
  '.gk-stick__tick--n{top:5px}.gk-stick__tick--s{bottom:5px}',
  '.gk-stick__tick--w,.gk-stick__tick--e{top:50%;height:2px;width:7px;margin-top:-1px}',
  '.gk-stick__tick--w{left:5px}.gk-stick__tick--e{right:5px}',
  '.gk-stick__level{position:absolute;left:-12px;top:14%;bottom:14%;width:4px;border-radius:3px;background:rgba(var(--gk-mint),.14);overflow:hidden}',
  '.gk-stick__level i{position:absolute;left:0;right:0;bottom:0;height:0;background:rgba(var(--gk-mint),.85);border-radius:3px;box-shadow:0 0 8px rgba(var(--gk-mint),.6)}',
  '.gk-stick__knob{position:absolute;left:50%;top:50%;border-radius:50%;will-change:transform;',
  'background:radial-gradient(circle at 50% 38%,rgba(var(--gk-mint),.42),rgba(var(--gk-mint),.2) 70%);',
  'border:2px solid rgba(var(--gk-mint),.92);box-shadow:0 2px 10px rgba(0,0,0,.45),0 0 14px rgba(var(--gk-mint),.28)}',
  '.gk-stick__knob::after{content:"";position:absolute;left:50%;top:50%;width:8px;height:8px;margin:-4px 0 0 -4px;border-radius:50%;background:rgb(var(--gk-mint));box-shadow:0 0 6px rgba(var(--gk-mint),.9)}',
  '.gk-stick__knob.is-return{transition:transform .1s cubic-bezier(.2,.8,.3,1)}',
  '.gk-stick__cap{position:absolute;left:50%;bottom:-19px;transform:translateX(-50%);white-space:nowrap;font-size:9px;letter-spacing:.16em;',
  'color:rgba(var(--gk-mint),.62);text-shadow:0 1px 3px rgba(0,0,0,.8);transition:opacity .2s ease}',
  '.gk-stick.is-active .gk-stick__cap{opacity:0}',
  '.gk-tbtn{position:absolute;pointer-events:auto;touch-action:none;-webkit-appearance:none;appearance:none;margin:0;padding:0;',
  'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;border-radius:50%;cursor:pointer;',
  'font:600 9.5px/1 var(--font-mono,ui-monospace,monospace);letter-spacing:.14em;text-transform:uppercase;',
  'color:rgba(226,244,238,.94);background:radial-gradient(circle at 50% 30%,rgba(18,30,30,.62),rgba(4,8,10,.5) 72%);',
  'border:1.5px solid rgba(var(--gk-mint),.5);box-shadow:0 4px 16px rgba(0,0,0,.38),inset 0 1px 0 rgba(255,255,255,.06);',
  'transition:transform .08s ease,background-color .08s ease,box-shadow .12s ease,color .08s ease;will-change:transform}',
  '.gk-tbtn svg{width:42%;height:42%;fill:none;stroke:rgb(var(--gk-mint));stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round;overflow:visible}',
  '.gk-tbtn--nitro svg{fill:rgba(var(--gk-mint),.22)}',
  '.gk-tbtn__label{display:block;margin-top:1px}',
  '.gk-tbtn--sm .gk-tbtn__label{display:none}',
  '.gk-tbtn--sm svg{width:50%;height:50%}',
  '.gk-tbtn.is-down{transform:scale(.93);background:rgba(var(--gk-mint),.9);color:#03130d;box-shadow:0 0 22px rgba(var(--gk-mint),.5),0 2px 8px rgba(0,0,0,.4)}',
  '.gk-tbtn.is-down svg{stroke:#03130d}',
  '.gk-tbtn.is-down.gk-tbtn--nitro svg{fill:rgba(3,19,13,.25)}',
  '.gk-tbtn__meter{position:absolute;inset:-6px;border-radius:50%;pointer-events:none;opacity:0;transition:opacity .2s ease;',
  '-webkit-mask:radial-gradient(circle,transparent calc(70.71% - 4px),#000 calc(70.71% - 3.5px));mask:radial-gradient(circle,transparent calc(70.71% - 4px),#000 calc(70.71% - 3.5px));',
  'background:conic-gradient(rgb(var(--gk-mint)) calc(var(--gk-m,0)*1turn),rgba(var(--gk-mint),.14) 0)}',
  '.gk-tbtn.has-meter .gk-tbtn__meter{opacity:1}',
  '.gk-tbtn.is-ready{box-shadow:0 0 0 1px rgba(var(--gk-mint),.4),0 0 26px rgba(var(--gk-mint),.4),0 4px 16px rgba(0,0,0,.38)}',
  '.gk-tbtn.is-ready svg{animation:gk-pulse 1.1s ease-in-out infinite}',
  '@keyframes gk-pulse{50%{transform:scale(1.12)}}',
  '.gk-steer{position:absolute;pointer-events:auto;touch-action:none;display:flex;align-items:center;justify-content:center;',
  'border-radius:22px;border:1.5px solid rgba(var(--gk-mint),.45);',
  'background:linear-gradient(180deg,rgba(18,30,30,.5),rgba(4,8,10,.46));box-shadow:0 4px 16px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.05);',
  'transition:transform .08s ease,background .08s ease,box-shadow .12s ease}',
  '.gk-steer svg{width:46%;height:46%;fill:none;stroke:rgb(var(--gk-mint));stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}',
  '.gk-steer.is-down{transform:scale(.95);background:rgba(var(--gk-mint),.88);box-shadow:0 0 22px rgba(var(--gk-mint),.45)}',
  '.gk-steer.is-down svg{stroke:#03130d}',
  '.gk-wheel{position:absolute;left:0;top:0;pointer-events:none;opacity:.7;transition:opacity .16s ease;will-change:transform}',
  '.gk-wheel.is-active{opacity:1}',
  '.gk-wheel svg{width:100%;height:100%;display:block;overflow:visible;will-change:transform}',
  '.gk-wheel__rim{fill:none;stroke:rgba(var(--gk-mint),.85);stroke-width:7}',
  '.gk-wheel__rim2{fill:none;stroke:rgba(4,10,12,.55);stroke-width:13}',
  '.gk-wheel__spoke{fill:none;stroke:rgba(var(--gk-mint),.6);stroke-width:5;stroke-linecap:round}',
  '.gk-wheel__hub{fill:rgba(4,10,12,.6);stroke:rgba(var(--gk-mint),.85);stroke-width:2.5}',
  '.gk-wheel__mark{fill:rgb(var(--gk-mint))}',
  '.gk-wheel__cap{position:absolute;left:50%;bottom:-18px;transform:translateX(-50%);font-size:9px;letter-spacing:.16em;color:rgba(var(--gk-mint),.62);white-space:nowrap}',
  '.gk-touch__probe{position:absolute;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;',
  'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)}',
  '@media (prefers-reduced-motion: reduce){.gk-tbtn.is-ready svg{animation:none}.gk-stick__knob.is-return{transition:none}}'
].join('');

const DRONE_AXES = {
  throttle: {
    range: 'unsigned',
    keys: { neg: ['KeyS'], pos: ['KeyW'] },
    keyMode: 'integrate',
    keyRate: 0.75,
    pad: { axis: 1, invert: true, center: 0.35, deadzone: 0.05 }
  },
  yaw: {
    keys: { neg: ['KeyA'], pos: ['KeyD'] },
    keyRate: 6,
    keyReturn: 10,
    pad: { axis: 0, deadzone: 0.06 }
  },
  pitch: {
    keys: { neg: ['ArrowDown', 'KeyK'], pos: ['ArrowUp', 'KeyI'] },
    keyRate: 7,
    keyReturn: 12,
    pad: { axis: 3, invert: true, deadzone: 0.05 },
    invertSetting: 'invertPitch'
  },
  roll: {
    keys: { neg: ['ArrowLeft', 'KeyJ'], pos: ['ArrowRight', 'KeyL'] },
    keyRate: 7,
    keyReturn: 12,
    pad: { axis: 2, deadzone: 0.05 }
  }
};

export const inputLayoutDrone = {
  id: 'drone',
  axes: DRONE_AXES,
  buttons: {
    camera: { keys: ['KeyC'], pad: [3] },
    mode: { keys: ['KeyM'], pad: [2] },
    restart: { keys: ['KeyR'], pad: [8] },
    flip: { keys: ['Space'], pad: [0] }
  },
  touch: [
    { type: 'stick', id: 'left', side: 'left', axes: ['yaw', 'throttle'], spring: { x: true, y: false }, gate: 'square', caption: 'throttleYaw', deadzone: 0.04 },
    { type: 'stick', id: 'right', side: 'right', axes: ['roll', 'pitch'], spring: { x: true, y: true }, caption: 'pitchRoll', deadzone: 0.04 },
    { type: 'button', id: 'restart', anchor: 'tr', x: 0, y: 54, size: 'sm', icon: 'reset', label: 'reset' },
    { type: 'button', id: 'camera', anchor: 'tr', x: 52, y: 54, size: 'sm', icon: 'camera', label: 'camera' },
    { type: 'button', id: 'mode', anchor: 'tr', x: 104, y: 54, size: 'sm', icon: 'mode', label: 'mode' }
  ]
};

const RACER_AXES = {
  steer: {
    keys: { neg: ['KeyA', 'ArrowLeft'], pos: ['KeyD', 'ArrowRight'] },
    keyRate: 4.2,
    keyReturn: 7,
    pad: [{ axis: 0, deadzone: 0.12, expo: 0.3 }, { buttons: [14, 15] }]
  },
  gas: {
    range: 'unsigned',
    keys: { pos: ['KeyW', 'ArrowUp'] },
    keyRate: 8,
    keyReturn: 10,
    pad: [{ button: 7 }]
  },
  brake: {
    range: 'unsigned',
    keys: { pos: ['KeyS', 'ArrowDown'] },
    keyRate: 9,
    keyReturn: 12,
    pad: [{ button: 6 }]
  }
};

const RACER_RIGHT_CLUSTER = [
  { type: 'button', id: 'nitro', anchor: 'br', x: 0, y: 0, size: 'lg', icon: 'nitro', label: 'nitro' },
  { type: 'button', id: 'drift', anchor: 'br', x: 98, y: 4, size: 'md', icon: 'drift', label: 'drift' },
  { type: 'button', id: 'brake', anchor: 'br', x: 6, y: 96, size: 'md', icon: 'brake', label: 'brake', axis: 'brake' },
  { type: 'button', id: 'gas', anchor: 'br', x: 92, y: 88, size: 'md', icon: 'gas', label: 'gas', axis: 'gas', manualGasOnly: true }
];

export const inputLayoutRacer = {
  id: 'racer',
  autoGas: { axis: 'gas', brake: 'brake' },
  axes: RACER_AXES,
  buttons: {
    nitro: { keys: ['ShiftLeft', 'ShiftRight', 'KeyN'], pad: [0, 5] },
    drift: { keys: ['Space'], pad: [2, 1] },
    camera: { keys: ['KeyC'], pad: [3] },
    lookBack: { keys: ['KeyB'], pad: [4] },
    restart: { keys: ['KeyR'], pad: [8] }
  },
  touchBySteer: {
    tilt: [
      { type: 'tilt', axis: 'steer' },
      { type: 'button', id: 'brake', anchor: 'bl', x: 0, y: 0, size: 'lg', icon: 'brake', label: 'brake', axis: 'brake' },
      { type: 'button', id: 'drift', anchor: 'bl', x: 100, y: 4, size: 'md', icon: 'drift', label: 'drift' },
      { type: 'button', id: 'nitro', anchor: 'br', x: 0, y: 0, size: 'lg', icon: 'nitro', label: 'nitro' },
      { type: 'button', id: 'gas', anchor: 'br', x: 100, y: 4, size: 'md', icon: 'gas', label: 'gas', axis: 'gas', manualGasOnly: true },
      { type: 'button', id: 'camera', anchor: 'tr', x: 0, y: 54, size: 'sm', icon: 'camera', label: 'camera' }
    ],
    zones: [
      { type: 'zones', axis: 'steer' },
      { type: 'button', id: 'camera', anchor: 'tr', x: 0, y: 54, size: 'sm', icon: 'camera', label: 'camera' }
    ].concat(RACER_RIGHT_CLUSTER),
    wheel: [
      { type: 'wheel', axis: 'steer' },
      { type: 'button', id: 'camera', anchor: 'tr', x: 0, y: 54, size: 'sm', icon: 'camera', label: 'camera' }
    ].concat(RACER_RIGHT_CLUSTER)
  }
};

function isNum(v) {
  return typeof v === 'number' && isFinite(v);
}

function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function asArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function isEditable(el) {
  if (!el || el.nodeType !== 1) return false;
  const tag = el.tagName;
  if (tag === 'INPUT') {
    const t = (el.getAttribute('type') || 'text').toLowerCase();
    return t !== 'range' && t !== 'checkbox' && t !== 'radio' && t !== 'button';
  }
  return tag === 'TEXTAREA' || tag === 'SELECT' || !!el.isContentEditable;
}

function screenAngle() {
  try {
    if (screen && screen.orientation && isNum(screen.orientation.angle)) return screen.orientation.angle;
    if (isNum(window.orientation)) return window.orientation;
  } catch (_) {}
  return 0;
}

export function tiltSteerDegrees(beta, gamma, angle) {
  const b = beta * DEG;
  const g = gamma * DEG;
  const th = (angle || 0) * DEG;
  const gx = Math.cos(b) * Math.sin(g);
  const gy = -Math.sin(b);
  const gsx = gx * Math.cos(th) - gy * Math.sin(th);
  return Math.asin(clamp(gsx, -1, 1)) / DEG;
}

function coarsePointer() {
  try { return window.matchMedia('(pointer: coarse)').matches; } catch (_) { return false; }
}

function hasTouch() {
  try { return navigator.maxTouchPoints > 0 || 'ontouchstart' in window; } catch (_) { return false; }
}

export function createInput(opts = {}) {
  const element = opts.element || null;
  let layout = opts.layout || inputLayoutDrone;
  let copy = Object.assign({}, COPY_DEFAULTS, opts.copy || null);
  const settings = Object.assign({}, SETTINGS_DEFAULTS, opts.settings || null);
  const onMethodChange = typeof opts.onMethodChange === 'function' ? opts.onMethodChange : null;

  let method = coarsePointer() ? 'touch' : 'keyboard';
  let disposed = false;
  let engaged = false;
  let lastUpdate = -1;

  const keys = Object.create(null);
  const keyEdges = Object.create(null);

  let axisSpecs = {};
  let buttonSpecs = {};
  const axisOut = Object.create(null);
  const keyAxis = Object.create(null);
  const touchAxis = Object.create(null);
  const buttonsOut = Object.create(null);
  const touchBtnDown = Object.create(null);
  const touchBtnEdge = Object.create(null);

  const pad = {
    index: -1,
    connected: false,
    mapping: '',
    id: '',
    axes: [],
    rest: [],
    restSampled: false,
    buttons: [],
    seen: {},
    ref: null
  };

  const tilt = {
    state: 'off',
    listening: false,
    raw: 0,
    has: false,
    value: 0,
    smooth: 0,
    pending: null
  };

  let root = null;
  let probe = null;
  let built = [];
  let touchVisible = false;
  const pointerMap = new Map();
  let stageRO = null;
  const geo = { w: 0, h: 0, safeL: 0, safeR: 0, safeB: 0, safeT: 0, scale: 1 };

  const prevPadCapture = typeof window !== 'undefined' ? window.mentriaPadCapture : undefined;
  try { window.mentriaPadCapture = true; } catch (_) {}

  function setMethod(m) {
    if (m === method) return;
    const prev = method;
    method = m;
    syncHeldAxes(prev, m);
    if (root) root.setAttribute('data-method', m);
    if (onMethodChange) {
      try { onMethodChange(m, prev); } catch (_) {}
    }
  }

  function syncHeldAxes(prev, next) {
    for (const name in axisSpecs) {
      const spec = axisSpecs[name];
      if (spec.range !== 'unsigned') continue;
      const cur = isNum(axisOut[name]) ? axisOut[name] : 0;
      if (next === 'keyboard' && spec.keyMode === 'integrate') keyAxis[name] = cur;
      if (next === 'touch') {
        for (let i = 0; i < built.length; i++) {
          const c = built[i];
          if (c.type !== 'stick') continue;
          if (c.axes[1] === name && !c.springY && c.pointer === -1) {
            c.vy = cur * 2 - 1;
            renderStick(c);
          }
          if (c.axes[0] === name && !c.springX && c.pointer === -1) {
            c.vx = cur * 2 - 1;
            renderStick(c);
          }
        }
      }
    }
  }

  function compileLayout(l) {
    axisSpecs = {};
    buttonSpecs = {};
    const axes = (l && l.axes) || {};
    const buttons = (l && l.buttons) || {};
    for (const name in axes) {
      const a = axes[name] || {};
      axisSpecs[name] = {
        range: a.range === 'unsigned' ? 'unsigned' : 'signed',
        neg: asArray(a.keys && a.keys.neg),
        pos: asArray(a.keys && a.keys.pos),
        keyMode: a.keyMode === 'integrate' ? 'integrate' : 'spring',
        keyRate: isNum(a.keyRate) ? a.keyRate : (a.range === 'unsigned' ? 8 : 5),
        keyReturn: isNum(a.keyReturn) ? a.keyReturn : (a.range === 'unsigned' ? 10 : 8),
        pad: asArray(a.pad),
        invertSetting: a.invertSetting || ''
      };
      if (!isNum(axisOut[name])) axisOut[name] = 0;
      if (!isNum(keyAxis[name])) keyAxis[name] = 0;
      if (!isNum(touchAxis[name])) touchAxis[name] = 0;
    }
    for (const name in buttons) {
      const b = buttons[name] || {};
      buttonSpecs[name] = { keys: asArray(b.keys), pad: asArray(b.pad) };
      if (!buttonsOut[name]) buttonsOut[name] = { down: false, pressed: false, released: false, value: 0 };
    }
    const touchList = touchListFor(l);
    for (let i = 0; i < touchList.length; i++) {
      const c = touchList[i];
      if (c.type === 'button' && !buttonsOut[c.id]) buttonsOut[c.id] = { down: false, pressed: false, released: false, value: 0 };
    }
  }

  function touchListFor(l) {
    if (!l) return [];
    if (l.touchBySteer) {
      let mode = settings.steer;
      if (mode === 'tilt' && tilt.state !== 'on') mode = l.touchBySteer.zones ? 'zones' : mode;
      return l.touchBySteer[mode] || l.touchBySteer.zones || [];
    }
    return Array.isArray(l.touch) ? l.touch : [];
  }

  function onKeyDown(e) {
    if (disposed || !e || !e.code) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (isEditable(e.target)) return;
    const bound = isBoundKey(e.code);
    if (!bound) return;
    if (engagedNow()) {
      try { e.preventDefault(); } catch (_) {}
    }
    setMethod('keyboard');
    if (e.repeat) return;
    keys[e.code] = true;
    keyEdges[e.code] = (keyEdges[e.code] || 0) | 1;
  }

  function onKeyUp(e) {
    if (!e || !e.code) return;
    if (keys[e.code]) {
      keys[e.code] = false;
      keyEdges[e.code] = (keyEdges[e.code] || 0) | 2;
    }
  }

  function isBoundKey(code) {
    for (const n in axisSpecs) {
      const s = axisSpecs[n];
      if (s.neg.indexOf(code) >= 0 || s.pos.indexOf(code) >= 0) return true;
    }
    for (const n in buttonSpecs) {
      if (buttonSpecs[n].keys.indexOf(code) >= 0) return true;
    }
    return false;
  }

  function engagedNow() {
    if (!element) return true;
    try {
      if (document.fullscreenElement && document.fullscreenElement.contains(element)) return true;
      if (document.webkitFullscreenElement && document.webkitFullscreenElement.contains(element)) return true;
      const a = document.activeElement;
      if (a && a !== document.body && element.contains(a)) return true;
    } catch (_) {}
    return engaged;
  }

  function onDocPointerDown(e) {
    if (!element || !e) return;
    try { engaged = element.contains(e.target); } catch (_) {}
  }

  function clearHeld() {
    for (const k in keys) keys[k] = false;
    for (const k in touchBtnDown) touchBtnDown[k] = 0;
    pointerMap.clear();
    for (let i = 0; i < built.length; i++) releaseControl(built[i]);
  }

  function onBlur() { clearHeld(); }
  function onVisibility() {
    try { if (document.visibilityState === 'hidden') clearHeld(); } catch (_) {}
  }

  function pickPad() {
    let list = null;
    try { list = navigator.getGamepads ? navigator.getGamepads() : null; } catch (_) {}
    if (!list) return null;
    const t = nowMs();
    let best = null;
    let bestActive = -1;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (!p || p.connected === false) continue;
      const key = isNum(p.index) ? p.index : i;
      let s = pad.seen[key];
      if (!s) {
        s = { stamp: -1, active: 0 };
        pad.seen[key] = s;
      }
      const ts = isNum(p.timestamp) ? p.timestamp : 0;
      if (s.stamp !== -1 && ts !== s.stamp) s.active = t;
      s.stamp = ts;
      if (!best || s.active > bestActive || (s.active === bestActive && best.mapping !== 'standard' && p.mapping === 'standard')) {
        best = p;
        bestActive = s.active;
      }
    }
    return best;
  }

  function readPad() {
    const p = pickPad();
    pad.ref = p || null;
    if (!p || !p.axes || !p.buttons) {
      if (pad.connected) {
        pad.connected = false;
        pad.index = -1;
        pad.axes.length = 0;
        pad.buttons.length = 0;
      }
      return;
    }
    if (p.index !== pad.index) {
      pad.index = p.index;
      pad.restSampled = false;
      pad.rest.length = 0;
    }
    pad.connected = true;
    pad.mapping = p.mapping || '';
    pad.id = String(p.id || '').slice(0, 60);
    const ax = p.axes;
    if (!pad.restSampled) {
      for (let i = 0; i < ax.length; i++) pad.rest[i] = isNum(ax[i]) ? ax[i] : 0;
      pad.restSampled = true;
    }
    let active = false;
    for (let i = 0; i < ax.length; i++) {
      const v = isNum(ax[i]) ? ax[i] : 0;
      const r = pad.rest[i] || 0;
      pad.axes[i] = v;
      const rel = Math.abs(r) > 0.6 ? v - r : v;
      if (Math.abs(rel) > 0.35) active = true;
    }
    pad.axes.length = ax.length;
    const b = p.buttons;
    for (let i = 0; i < b.length; i++) {
      const x = b[i];
      let v = 0;
      if (x && typeof x === 'object') v = isNum(x.value) ? x.value : (x.pressed ? 1 : 0);
      else v = x ? 1 : 0;
      if (v === 0 && x && x.pressed) v = 1;
      pad.buttons[i] = v;
      if (v > 0.3) active = true;
    }
    pad.buttons.length = b.length;
    if (active) setMethod('gamepad');
  }

  function padButtonValue(i) {
    if (!pad.connected) return 0;
    if (i < pad.buttons.length && pad.mapping === 'standard') return pad.buttons[i] || 0;
    if (i < pad.buttons.length && (i !== 6 && i !== 7)) return pad.buttons[i] || 0;
    if (i === 6 || i === 7) {
      const bv = i < pad.buttons.length ? pad.buttons[i] || 0 : 0;
      if (bv > 0) return bv;
      const ai = i === 7 ? 5 : 4;
      const r = pad.rest[ai] || 0;
      if (ai < pad.axes.length && Math.abs(r) > 0.6) return clamp(((pad.axes[ai] || 0) - r) / (-2 * Math.sign(r)), 0, 1);
    }
    return 0;
  }

  function padAxisRaw(i) {
    if (!pad.connected || i >= pad.axes.length) return 0;
    const r = pad.rest[i] || 0;
    if (Math.abs(r) > 0.6) return 0;
    return clamp(pad.axes[i] || 0, -1, 1);
  }

  function padValueFor(spec) {
    if (!pad.connected) return null;
    let out = null;
    for (let i = 0; i < spec.pad.length; i++) {
      const b = spec.pad[i];
      if (!b) continue;
      let v = 0;
      if (isNum(b.axis)) {
        v = padAxisRaw(b.axis);
        if (b.invert) v = -v;
        const dz = isNum(b.deadzone) ? b.deadzone : settings.padDeadzone;
        v = applyDeadzone(v, dz);
        if (isNum(b.expo) && b.expo > 0) v = applyExpo(v, b.expo);
        if (isNum(b.scale)) v *= b.scale;
        if (spec.range === 'unsigned') {
          const c = isNum(b.center) ? b.center : 0.5;
          v = v >= 0 ? c + v * (1 - c) : c + v * c;
        }
      } else if (isNum(b.button)) {
        v = padButtonValue(b.button);
        if (v < 0.04) v = 0;
      } else if (Array.isArray(b.buttons)) {
        v = padButtonValue(b.buttons[1]) - padButtonValue(b.buttons[0]);
      } else {
        continue;
      }
      if (out === null) out = v;
      else if (spec.range === 'unsigned') out = Math.max(out, v);
      else out = Math.abs(v) > Math.abs(out) ? v : out;
    }
    return out;
  }

  function keyValueFor(name, spec, dt) {
    let target = 0;
    for (let i = 0; i < spec.pos.length; i++) if (keys[spec.pos[i]]) { target += 1; break; }
    for (let i = 0; i < spec.neg.length; i++) if (keys[spec.neg[i]]) { target -= 1; break; }
    let v = keyAxis[name] || 0;
    if (spec.keyMode === 'integrate') {
      v += target * spec.keyRate * dt;
      v = spec.range === 'unsigned' ? clamp(v, 0, 1) : clamp(v, -1, 1);
    } else {
      const lo = spec.range === 'unsigned' ? 0 : -1;
      const tgt = clamp(target, lo, 1);
      const rate = tgt === 0 || (v !== 0 && Math.sign(tgt) !== Math.sign(v)) ? spec.keyReturn : spec.keyRate;
      v = approach(v, tgt, rate * dt);
    }
    keyAxis[name] = v;
    return v;
  }

  function anyKey(list) {
    for (let i = 0; i < list.length; i++) if (keys[list[i]]) return true;
    return false;
  }

  function keyEdgeFor(list, bit) {
    for (let i = 0; i < list.length; i++) if ((keyEdges[list[i]] || 0) & bit) return true;
    return false;
  }

  function update(dtIn) {
    if (disposed) return api;
    const t = nowMs();
    let dt = isNum(dtIn) ? dtIn : (lastUpdate < 0 ? 1 / 60 : (t - lastUpdate) / 1000);
    lastUpdate = t;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.1) dt = 0.1;
    readPad();
    updateTouchAxes(dt);
    updateTilt(dt);

    for (const name in axisSpecs) {
      const spec = axisSpecs[name];
      const kv = keyValueFor(name, spec, dt);
      const pv = padValueFor(spec);
      const tv = touchAxis[name] || 0;
      let v;
      if (spec.range === 'unsigned') {
        if (method === 'gamepad' && pv !== null) v = pv;
        else if (method === 'touch' && touchProvides(name)) v = tv;
        else if (method === 'keyboard') v = kv;
        else v = Math.max(kv, pv || 0, tv);
      } else {
        v = kv + (pv || 0) + tv;
      }
      if (spec.invertSetting && settings[spec.invertSetting]) v = -v;
      axisOut[name] = spec.range === 'unsigned' ? clamp(v, 0, 1) : clamp(v, -1, 1);
    }

    if (layout && layout.autoGas && settings.autoGas && method === 'touch') {
      const ga = layout.autoGas.axis;
      const ba = layout.autoGas.brake;
      const braking = (axisOut[ba] || 0) > 0.05;
      axisOut[ga] = braking ? 0 : 1;
    }

    for (const name in buttonsOut) {
      const spec = buttonSpecs[name] || { keys: [], pad: [] };
      const o = buttonsOut[name];
      let value = 0;
      if (anyKey(spec.keys)) value = 1;
      for (let i = 0; i < spec.pad.length; i++) value = Math.max(value, padButtonValue(spec.pad[i]));
      if (touchBtnDown[name] > 0) value = 1;
      const down = value > 0.45;
      const edgeDown = keyEdgeFor(spec.keys, 1) || !!(touchBtnEdge[name] & 1);
      const edgeUp = keyEdgeFor(spec.keys, 2) || !!(touchBtnEdge[name] & 2);
      o.pressed = (down && !o.down) || (edgeDown && !o.down);
      o.released = (!down && o.down) || (edgeUp && !down && !o.pressed);
      if (edgeDown && edgeUp && !down) {
        o.pressed = true;
        o.released = true;
      }
      o.down = down;
      o.value = value;
      touchBtnEdge[name] = 0;
    }
    for (const k in keyEdges) keyEdges[k] = 0;
    return api;
  }

  function touchProvides(name) {
    for (let i = 0; i < built.length; i++) {
      const c = built[i];
      if (c.type === 'stick' && (c.axes[0] === name || c.axes[1] === name)) return true;
      if ((c.type === 'zones' || c.type === 'wheel' || c.type === 'tilt') && c.axis === name) return true;
      if (c.type === 'button' && c.axis === name) return true;
    }
    return false;
  }

  function axis(name) {
    const v = axisOut[name];
    return isNum(v) ? v : 0;
  }

  const EMPTY_BUTTON = Object.freeze({ down: false, pressed: false, released: false, value: 0 });

  function button(name) {
    return buttonsOut[name] || EMPTY_BUTTON;
  }

  function onOrient(e) {
    if (!e || !isNum(e.beta) || !isNum(e.gamma)) return;
    tilt.raw = tiltSteerDegrees(e.beta, e.gamma, screenAngle());
    if (!tilt.has) {
      tilt.has = true;
      tilt.smooth = tilt.raw;
      if (tilt.state !== 'on') {
        tilt.state = 'on';
        if (layout && layout.touchBySteer && settings.steer === 'tilt') rebuildTouch();
      }
    }
  }

  function startTiltListening() {
    if (tilt.listening) return;
    try {
      window.addEventListener('deviceorientation', onOrient);
      tilt.listening = true;
    } catch (_) {}
  }

  function stopTiltListening() {
    if (!tilt.listening) return;
    try { window.removeEventListener('deviceorientation', onOrient); } catch (_) {}
    tilt.listening = false;
    tilt.has = false;
    if (tilt.state === 'on') tilt.state = 'off';
  }

  function requestTilt() {
    if (tilt.state === 'on') return Promise.resolve(true);
    if (tilt.pending) return tilt.pending;
    let DO = null;
    try { DO = typeof DeviceOrientationEvent !== 'undefined' ? DeviceOrientationEvent : null; } catch (_) {}
    if (!DO) {
      tilt.state = 'unsupported';
      return Promise.resolve(false);
    }
    try {
      if (window.isSecureContext === false) {
        tilt.state = 'unsupported';
        return Promise.resolve(false);
      }
    } catch (_) {}
    const waitForData = function () {
      startTiltListening();
      return new Promise(function (resolve) {
        const t0 = nowMs();
        const tick = function () {
          if (tilt.has) { resolve(true); return; }
          if (nowMs() - t0 > 1200) {
            if (!tilt.has) tilt.state = 'unsupported';
            resolve(tilt.has);
            return;
          }
          setTimeout(tick, 60);
        };
        tick();
      });
    };
    if (typeof DO.requestPermission === 'function') {
      tilt.state = 'pending';
      let req = null;
      try { req = DO.requestPermission(); } catch (_) {
        tilt.state = 'denied';
        return Promise.resolve(false);
      }
      tilt.pending = Promise.resolve(req).then(function (res) {
        tilt.pending = null;
        if (res !== 'granted') {
          tilt.state = 'denied';
          return false;
        }
        return waitForData();
      }).catch(function () {
        tilt.pending = null;
        tilt.state = 'denied';
        return false;
      });
      return tilt.pending;
    }
    tilt.state = 'pending';
    tilt.pending = waitForData().then(function (ok) {
      tilt.pending = null;
      return ok;
    });
    return tilt.pending;
  }

  function calibrateTilt() {
    if (!tilt.has) return false;
    settings.tiltCenter = clamp(tilt.raw, -45, 45);
    return true;
  }

  function updateTilt(dt) {
    let ctrl = null;
    for (let i = 0; i < built.length; i++) if (built[i].type === 'tilt') ctrl = built[i];
    if (!ctrl) return;
    if (!tilt.has) {
      touchAxis[ctrl.axis] = 0;
      return;
    }
    const k = 1 - Math.exp(-dt / 0.045);
    tilt.smooth += (tilt.raw - tilt.smooth) * k;
    let deg = tilt.smooth - (settings.tiltCenter || 0);
    if (settings.tiltInvert) deg = -deg;
    const dz = 1.4;
    const range = Math.max(8, settings.tiltRange || 24);
    let v = Math.abs(deg) <= dz ? 0 : Math.sign(deg) * (Math.abs(deg) - dz) / (range - dz);
    v = applyExpo(clamp(v, -1, 1), 0.18);
    tilt.value = v;
    touchAxis[ctrl.axis] = v;
    if (Math.abs(v) > 0.2 && touchVisible) setMethod('touch');
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

  function svgIcon(name) {
    const body = ICONS[name] || '';
    return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + body + '</svg>';
  }

  function label(key) {
    return copy[key] != null ? String(copy[key]) : String(key || '');
  }

  function measureGeo() {
    if (!root) return;
    const r = root.getBoundingClientRect();
    geo.w = r.width;
    geo.h = r.height;
    let sl = 0, sr = 0, sb = 0, st = 0;
    try {
      const cs = getComputedStyle(probe);
      st = parseFloat(cs.paddingTop) || 0;
      sr = parseFloat(cs.paddingRight) || 0;
      sb = parseFloat(cs.paddingBottom) || 0;
      sl = parseFloat(cs.paddingLeft) || 0;
    } catch (_) {}
    let vw = 0, vh = 0;
    try {
      vw = window.innerWidth;
      vh = window.innerHeight;
    } catch (_) {}
    geo.safeL = r.left < sl ? sl - Math.max(0, r.left) : 0;
    geo.safeR = vw - r.right < sr ? sr - Math.max(0, vw - r.right) : 0;
    geo.safeB = vh - r.bottom < sb ? sb - Math.max(0, vh - r.bottom) : 0;
    geo.safeT = r.top < st ? st - Math.max(0, r.top) : 0;
    const base = clamp(Math.min(geo.h / 400, geo.w / 760), 0.78, 1.18);
    geo.scale = base * clamp(settings.stickSize || 1, 0.7, 1.4);
    root.style.setProperty('--gk-s', geo.scale.toFixed(3));
    root.style.setProperty('--gk-o', String(clamp(settings.touchOpacity || 1, 0.3, 1)));
  }

  function edgePad() {
    return 14 * geo.scale;
  }

  function topBand() {
    return Math.max(geo.h * 0.16, geo.safeT + 56 * geo.scale);
  }

  function anchorPos(c, size) {
    const s = geo.scale;
    const e = edgePad();
    const x = (c.x || 0) * s;
    const y = (c.y || 0) * s;
    const a = c.anchor || 'br';
    let left, top;
    if (a === 'bl' || a === 'tl' || a === 'ml') left = geo.safeL + e + x;
    else left = geo.w - geo.safeR - e - x - size;
    if (a === 'tl' || a === 'tr') top = geo.safeT + e + y;
    else if (a === 'ml' || a === 'mr') top = geo.h * 0.5 - size / 2 - y;
    else top = geo.h - geo.safeB - e - y - size;
    return { left, top };
  }

  function buttonSize(c) {
    const s = geo.scale;
    if (c.size === 'lg') return Math.max(64, 84 * s);
    if (c.size === 'sm') return Math.max(44, 46 * s);
    return Math.max(52, 66 * s);
  }

  function buildButton(c) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'gk-tbtn gk-tbtn--' + (c.size || 'md') + ' gk-tbtn--' + c.id;
    b.setAttribute('data-gk', 'btn:' + c.id);
    b.setAttribute('tabindex', '-1');
    b.setAttribute('aria-label', label(c.label || c.id));
    b.innerHTML = '<span class="gk-tbtn__meter"></span>' + svgIcon(c.icon || c.id) + '<span class="gk-tbtn__label"></span>';
    b.querySelector('.gk-tbtn__label').textContent = label(c.label || c.id);
    root.appendChild(b);
    return { type: 'button', id: c.id, axis: c.axis || '', def: c, el: b, pointers: 0, manualGasOnly: !!c.manualGasOnly };
  }

  function buildStick(c) {
    const zone = document.createElement('div');
    zone.className = 'gk-zone gk-zone--' + (c.side || 'left');
    zone.setAttribute('data-gk', 'stick:' + c.id);
    const st = document.createElement('div');
    st.className = 'gk-stick gk-stick--' + (c.side || 'left') + (c.gate === 'square' ? ' gk-stick--square' : '');
    st.innerHTML = '<div class="gk-stick__ring"><i class="gk-stick__tick gk-stick__tick--n"></i><i class="gk-stick__tick gk-stick__tick--s"></i><i class="gk-stick__tick gk-stick__tick--w"></i><i class="gk-stick__tick gk-stick__tick--e"></i></div>' +
      (c.spring && c.spring.y === false ? '<div class="gk-stick__level"><i></i></div>' : '') +
      '<div class="gk-stick__knob"></div><span class="gk-stick__cap"></span>';
    st.querySelector('.gk-stick__cap').textContent = c.caption ? label(c.caption) : '';
    root.appendChild(zone);
    root.appendChild(st);
    const springX = !(c.spring && c.spring.x === false);
    const springY = !(c.spring && c.spring.y === false);
    const ctrl = {
      type: 'stick',
      id: c.id,
      side: c.side === 'right' ? 'right' : 'left',
      axes: Array.isArray(c.axes) ? c.axes : ['', ''],
      springX,
      springY,
      square: c.gate === 'square',
      deadzone: isNum(c.deadzone) ? c.deadzone : 0.04,
      zone,
      el: st,
      knob: st.querySelector('.gk-stick__knob'),
      level: st.querySelector('.gk-stick__level i'),
      pointer: -1,
      bx: 0,
      by: 0,
      ox: 0,
      oy: 0,
      vx: 0,
      vy: 0,
      homeX: 0,
      homeY: 0,
      R: 50,
      ringR: 70
    };
    const yName = ctrl.axes[1];
    const ySpec = axisSpecs[yName];
    if (!springY && ySpec && ySpec.range === 'unsigned') ctrl.vy = clamp((axisOut[yName] || 0) * 2 - 1, -1, 1);
    return ctrl;
  }

  function buildZones(c) {
    const l = document.createElement('div');
    l.className = 'gk-steer gk-steer--left';
    l.setAttribute('data-gk', 'steer:-1');
    l.setAttribute('aria-label', label('steerLeft'));
    l.innerHTML = svgIcon('left');
    const r = document.createElement('div');
    r.className = 'gk-steer gk-steer--right';
    r.setAttribute('data-gk', 'steer:1');
    r.setAttribute('aria-label', label('steerRight'));
    r.innerHTML = svgIcon('right');
    root.appendChild(l);
    root.appendChild(r);
    return { type: 'zones', axis: c.axis || 'steer', left: l, right: r, pointers: new Map(), value: 0 };
  }

  function buildWheel(c) {
    const zone = document.createElement('div');
    zone.className = 'gk-zone gk-zone--wheel';
    zone.setAttribute('data-gk', 'wheel');
    zone.setAttribute('aria-label', label('wheel'));
    const w = document.createElement('div');
    w.className = 'gk-wheel';
    w.innerHTML = '<svg viewBox="-60 -60 120 120" aria-hidden="true">' +
      '<circle class="gk-wheel__rim2" r="46"/><circle class="gk-wheel__rim" r="46"/>' +
      '<path class="gk-wheel__spoke" d="M-44 4 L-12 8 M44 4 L12 8 M0 14 L0 44"/>' +
      '<circle class="gk-wheel__hub" r="13"/><rect class="gk-wheel__mark" x="-3.5" y="-53" width="7" height="12" rx="2"/></svg>' +
      '<span class="gk-wheel__cap"></span>';
    w.querySelector('.gk-wheel__cap').textContent = label('steer');
    root.appendChild(zone);
    root.appendChild(w);
    return { type: 'wheel', axis: c.axis || 'steer', zone, el: w, svg: w.querySelector('svg'), pointer: -1, x0: 0, v: 0, target: 0, held: false };
  }

  function buildTouch() {
    if (!element || typeof document === 'undefined') return;
    ensureStyle();
    root = document.createElement('div');
    root.className = 'gk-touch';
    root.setAttribute('data-layout', (layout && layout.id) || 'custom');
    root.setAttribute('data-method', method);
    probe = document.createElement('div');
    probe.className = 'gk-touch__probe';
    root.appendChild(probe);
    root.addEventListener('pointerdown', onPointerDown, { passive: false });
    root.addEventListener('pointermove', onPointerMove, { passive: false });
    root.addEventListener('pointerup', onPointerUp);
    root.addEventListener('pointercancel', onPointerUp);
    root.addEventListener('lostpointercapture', onPointerUp);
    root.addEventListener('contextmenu', preventDefault);
    root.addEventListener('gesturestart', preventDefault);
    element.appendChild(root);
    populateTouch();
    try {
      stageRO = new ResizeObserver(function () { layoutTouch(); });
      stageRO.observe(element);
    } catch (_) {}
    touchVisible = true;
    try { element.setAttribute('data-gk-touch', ''); } catch (_) {}
  }

  function populateTouch() {
    built = [];
    const list = touchListFor(layout);
    root.setAttribute('data-steer', layout && layout.touchBySteer ? (settings.steer === 'tilt' && tilt.state !== 'on' ? 'zones' : settings.steer) : 'none');
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!c) continue;
      if (c.type === 'stick') built.push(buildStick(c));
      else if (c.type === 'button') {
        if (c.manualGasOnly && settings.autoGas) continue;
        built.push(buildButton(c));
      } else if (c.type === 'zones') built.push(buildZones(c));
      else if (c.type === 'wheel') built.push(buildWheel(c));
      else if (c.type === 'tilt') {
        built.push({ type: 'tilt', axis: c.axis || 'steer' });
        if (tilt.state === 'off') {
          let needsGesture = false;
          try { needsGesture = typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function'; } catch (_) {}
          if (!needsGesture) requestTilt();
        }
      }
    }
    layoutTouch();
  }

  function clearTouchChildren() {
    if (!root) return;
    const kids = Array.prototype.slice.call(root.children);
    for (let i = 0; i < kids.length; i++) if (kids[i] !== probe) root.removeChild(kids[i]);
    built = [];
    pointerMap.clear();
    for (const k in touchBtnDown) touchBtnDown[k] = 0;
  }

  function rebuildTouch() {
    if (!root) return;
    const held = {};
    for (let i = 0; i < built.length; i++) {
      const c = built[i];
      if (c.type === 'stick') held[c.id] = { vx: c.vx, vy: c.vy };
    }
    clearTouchChildren();
    populateTouch();
    for (let i = 0; i < built.length; i++) {
      const c = built[i];
      if (c.type === 'stick' && held[c.id]) {
        if (!c.springX) c.vx = held[c.id].vx;
        if (!c.springY) c.vy = held[c.id].vy;
        renderStick(c);
      }
    }
  }

  function layoutTouch() {
    if (!root) return;
    measureGeo();
    const s = geo.scale;
    const e = edgePad();
    const band = topBand();
    for (let i = 0; i < built.length; i++) {
      const c = built[i];
      if (c.type === 'stick') {
        c.R = 50 * s;
        c.ringR = c.R + 20 * s;
        const knobD = 46 * s;
        const d = c.ringR * 2;
        c.el.style.width = d.toFixed(1) + 'px';
        c.el.style.height = d.toFixed(1) + 'px';
        c.el.style.marginLeft = (-c.ringR).toFixed(1) + 'px';
        c.el.style.marginTop = (-c.ringR).toFixed(1) + 'px';
        c.knob.style.width = knobD.toFixed(1) + 'px';
        c.knob.style.height = knobD.toFixed(1) + 'px';
        c.knob.style.margin = (-knobD / 2).toFixed(1) + 'px 0 0 ' + (-knobD / 2).toFixed(1) + 'px';
        const zoneW = geo.w * 0.42;
        c.zone.style.top = band.toFixed(1) + 'px';
        c.zone.style.bottom = '0px';
        c.zone.style.width = zoneW.toFixed(1) + 'px';
        if (c.side === 'left') {
          c.zone.style.left = '0px';
          c.homeX = geo.safeL + e + c.ringR + 10 * s;
        } else {
          c.zone.style.right = '0px';
          c.homeX = geo.w - geo.safeR - e - c.ringR - 10 * s;
        }
        c.homeY = geo.h - geo.safeB - e - c.ringR - 14 * s;
        if (c.pointer === -1) {
          c.bx = c.homeX;
          c.by = c.homeY;
        }
        renderStick(c);
      } else if (c.type === 'button') {
        const size = buttonSize(c.def);
        const p = anchorPos(c.def, size);
        c.el.style.width = size.toFixed(1) + 'px';
        c.el.style.height = size.toFixed(1) + 'px';
        c.el.style.left = p.left.toFixed(1) + 'px';
        c.el.style.top = p.top.toFixed(1) + 'px';
        c.el.style.fontSize = (c.def.size === 'lg' ? 10.5 : 9.5) * Math.min(1.1, s) + 'px';
      } else if (c.type === 'zones') {
        const w = 92 * s;
        const h = 96 * s;
        const gap = 12 * s;
        const top = geo.h - geo.safeB - e - h;
        const left0 = geo.safeL + e;
        place(c.left, left0, top, w, h);
        place(c.right, left0 + w + gap, top, w, h);
        c.rects = null;
      } else if (c.type === 'wheel') {
        const d = 150 * s;
        const cx = geo.safeL + e + d / 2 + 4 * s;
        const cy = geo.h - geo.safeB - e - d / 2 - 8 * s;
        c.el.style.width = d.toFixed(1) + 'px';
        c.el.style.height = d.toFixed(1) + 'px';
        c.el.style.transform = 'translate3d(' + (cx - d / 2).toFixed(1) + 'px,' + (cy - d / 2).toFixed(1) + 'px,0)';
        c.zone.style.left = '0px';
        c.zone.style.top = band.toFixed(1) + 'px';
        c.zone.style.bottom = '0px';
        c.zone.style.width = (geo.w * 0.44).toFixed(1) + 'px';
        c.R = 64 * s;
      }
    }
  }

  function place(el, left, top, w, h) {
    el.style.left = left.toFixed(1) + 'px';
    el.style.top = top.toFixed(1) + 'px';
    el.style.width = w.toFixed(1) + 'px';
    el.style.height = h.toFixed(1) + 'px';
  }

  function renderStick(c) {
    if (!c.el) return;
    c.el.style.transform = 'translate3d(' + c.bx.toFixed(1) + 'px,' + c.by.toFixed(1) + 'px,0)';
    const kx = c.vx * c.R;
    const ky = -c.vy * c.R;
    c.knob.style.transform = 'translate3d(' + kx.toFixed(1) + 'px,' + ky.toFixed(1) + 'px,0)';
    if (c.level) c.level.style.height = (((c.vy + 1) / 2) * 100).toFixed(1) + '%';
  }

  function stickBounds(c) {
    const zoneW = geo.w * 0.42;
    const band = topBand();
    const pad = 4;
    let x0, x1;
    if (c.side === 'left') {
      x0 = geo.safeL + c.ringR + pad;
      x1 = zoneW - c.ringR;
    } else {
      x0 = geo.w - zoneW + c.ringR;
      x1 = geo.w - geo.safeR - c.ringR - pad;
    }
    const y0 = band + c.ringR * 0.6;
    const y1 = geo.h - geo.safeB - c.ringR - pad;
    return { x0, x1: Math.max(x0, x1), y0, y1: Math.max(y0, y1) };
  }

  function stickDown(c, e, px, py) {
    c.pointer = e.pointerId;
    if (c.springX) c.vx = 0;
    if (c.springY) c.vy = 0;
    let bx = px - c.vx * c.R;
    let by = py + c.vy * c.R;
    const b = stickBounds(c);
    bx = clamp(bx, b.x0, b.x1);
    by = clamp(by, b.y0, b.y1);
    c.bx = bx;
    c.by = by;
    c.ox = c.vx - (px - bx) / c.R;
    c.oy = c.vy + (py - by) / c.R;
    c.knob.classList.remove('is-return');
    c.el.classList.add('is-active');
    renderStick(c);
    applyStickAxes(c);
  }

  function stickMove(c, px, py) {
    let rx = (px - c.bx) / c.R + c.ox;
    let ry = -(py - c.by) / c.R + c.oy;
    if (c.square) {
      if (rx > 1) { c.ox -= rx - 1; rx = 1; }
      if (rx < -1) { c.ox -= rx + 1; rx = -1; }
      if (ry > 1) { c.oy -= ry - 1; ry = 1; }
      if (ry < -1) { c.oy -= ry + 1; ry = -1; }
    } else {
      const m = Math.hypot(rx, ry);
      if (m > 1) {
        const nx = rx / m;
        const ny = ry / m;
        c.ox -= rx - nx;
        c.oy -= ry - ny;
        rx = nx;
        ry = ny;
      }
      if (!c.springY) {
        if (ry > 1) { c.oy -= ry - 1; ry = 1; }
        if (ry < -1) { c.oy -= ry + 1; ry = -1; }
      }
    }
    c.vx = rx;
    c.vy = ry;
    renderStick(c);
    applyStickAxes(c);
  }

  function stickUp(c) {
    c.pointer = -1;
    if (c.springX) c.vx = 0;
    if (c.springY) c.vy = 0;
    c.knob.classList.add('is-return');
    c.el.classList.remove('is-active');
    renderStick(c);
    applyStickAxes(c);
  }

  function applyStickAxes(c) {
    const xn = c.axes[0];
    const yn = c.axes[1];
    const dz = c.deadzone;
    if (xn) {
      const spec = axisSpecs[xn];
      let v = applyDeadzone(c.vx, dz);
      touchAxis[xn] = spec && spec.range === 'unsigned' ? clamp((c.vx + 1) / 2, 0, 1) : v;
    }
    if (yn) {
      const spec = axisSpecs[yn];
      if (spec && spec.range === 'unsigned') touchAxis[yn] = clamp((c.vy + 1) / 2, 0, 1);
      else touchAxis[yn] = applyDeadzone(c.vy, dz);
    }
  }

  function updateTouchAxes(dt) {
    for (let i = 0; i < built.length; i++) {
      const c = built[i];
      if (c.type === 'zones') {
        let dir = 0;
        c.pointers.forEach(function (d) { dir += d; });
        dir = clamp(dir, -1, 1);
        const rate = dir === 0 || (c.value !== 0 && Math.sign(dir) !== Math.sign(c.value)) ? 9 : 5.5;
        c.value = approach(c.value, dir, rate * dt);
        touchAxis[c.axis] = c.value;
        c.left.classList.toggle('is-down', dir < 0);
        c.right.classList.toggle('is-down', dir > 0);
      } else if (c.type === 'wheel') {
        if (!c.held) c.v = approach(c.v, 0, 7 * dt);
        touchAxis[c.axis] = c.v;
        c.svg.style.transform = 'rotate(' + (c.v * 110).toFixed(1) + 'deg)';
      } else if (c.type === 'button' && c.axis) {
        touchAxis[c.axis] = c.pointers > 0 ? 1 : 0;
      }
    }
  }

  function findControl(kind, id) {
    for (let i = 0; i < built.length; i++) {
      const c = built[i];
      if (c.type === kind && (id == null || c.id === id)) return c;
    }
    return null;
  }

  function localPoint(e) {
    const r = root.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function preventDefault(e) {
    try { e.preventDefault(); } catch (_) {}
  }

  function haptic(ms) {
    if (!settings.haptics) return;
    try {
      const ua = navigator.userActivation;
      if (ua && !ua.hasBeenActive) return;
      if (navigator.vibrate) navigator.vibrate(ms || 8);
    } catch (_) {}
  }

  function rumble(strong, weak, ms) {
    if (!settings.haptics) return false;
    const p = pad.ref;
    const act = p && p.vibrationActuator;
    if (!act || typeof act.playEffect !== 'function') return false;
    try {
      const r = act.playEffect('dual-rumble', {
        startDelay: 0,
        duration: Math.max(10, Math.min(2000, isNum(ms) ? ms : 120)),
        strongMagnitude: clamp(isNum(strong) ? strong : 0.5, 0, 1),
        weakMagnitude: clamp(isNum(weak) ? weak : 0.5, 0, 1)
      });
      if (r && typeof r.catch === 'function') r.catch(function () {});
      return true;
    } catch (_) {
      return false;
    }
  }

  const FEEDBACK = {
    tap: [6, 0, 0.25, 40],
    bump: [14, 0.35, 0.5, 90],
    boost: [18, 0.2, 0.7, 260],
    crash: [40, 1, 0.8, 320],
    land: [12, 0.5, 0.3, 110]
  };

  function feedback(kind) {
    const f = FEEDBACK[kind] || FEEDBACK.tap;
    if (method === 'gamepad') return rumble(f[1], f[2], f[3]);
    if (method === 'touch') {
      haptic(f[0]);
      return true;
    }
    return false;
  }

  function onPointerDown(e) {
    if (!e || !e.target || typeof e.target.closest !== 'function') return;
    const el = e.target.closest('[data-gk]');
    if (!el) return;
    const tag = el.getAttribute('data-gk') || '';
    const p = localPoint(e);
    preventDefault(e);
    try { el.setPointerCapture(e.pointerId); } catch (_) {}
    if (e.pointerType === 'touch' || e.pointerType === 'pen') setMethod('touch');
    else setMethod('touch');
    engaged = true;
    if (tag.indexOf('stick:') === 0) {
      const c = findControl('stick', tag.slice(6));
      if (!c || c.pointer !== -1) return;
      pointerMap.set(e.pointerId, { kind: 'stick', ctrl: c });
      stickDown(c, e, p.x, p.y);
    } else if (tag.indexOf('btn:') === 0) {
      const c = findControl('button', tag.slice(4));
      if (!c) return;
      pointerMap.set(e.pointerId, { kind: 'button', ctrl: c });
      c.pointers++;
      touchBtnDown[c.id] = (touchBtnDown[c.id] || 0) + 1;
      touchBtnEdge[c.id] = (touchBtnEdge[c.id] || 0) | 1;
      c.el.classList.add('is-down');
      haptic(c.def.size === 'lg' ? 12 : 8);
    } else if (tag.indexOf('steer:') === 0) {
      const c = findControl('zones');
      if (!c) return;
      const dir = tag === 'steer:-1' ? -1 : 1;
      c.rects = { l: c.left.getBoundingClientRect(), r: c.right.getBoundingClientRect() };
      c.pointers.set(e.pointerId, dir);
      pointerMap.set(e.pointerId, { kind: 'zones', ctrl: c });
      haptic(6);
    } else if (tag === 'wheel') {
      const c = findControl('wheel');
      if (!c || c.pointer !== -1) return;
      c.pointer = e.pointerId;
      c.held = true;
      c.x0 = p.x - c.v * c.R;
      c.el.classList.add('is-active');
      pointerMap.set(e.pointerId, { kind: 'wheel', ctrl: c });
    }
  }

  function onPointerMove(e) {
    const m = pointerMap.get(e.pointerId);
    if (!m) return;
    preventDefault(e);
    const p = localPoint(e);
    if (m.kind === 'stick') {
      stickMove(m.ctrl, p.x, p.y);
    } else if (m.kind === 'zones') {
      const c = m.ctrl;
      if (!c.rects) return;
      const inL = e.clientX >= c.rects.l.left - 20 && e.clientX <= c.rects.l.right + 6 && e.clientY >= c.rects.l.top - 40 && e.clientY <= c.rects.l.bottom + 30;
      const inR = e.clientX >= c.rects.r.left - 6 && e.clientX <= c.rects.r.right + 20 && e.clientY >= c.rects.r.top - 40 && e.clientY <= c.rects.r.bottom + 30;
      const cur = c.pointers.get(e.pointerId);
      if (inL && cur !== -1 && e.clientX < c.rects.r.left) c.pointers.set(e.pointerId, -1);
      else if (inR && cur !== 1 && e.clientX > c.rects.l.right) c.pointers.set(e.pointerId, 1);
    } else if (m.kind === 'wheel') {
      const c = m.ctrl;
      let v = (p.x - c.x0) / c.R;
      if (v > 1) { c.x0 += (v - 1) * c.R; v = 1; }
      if (v < -1) { c.x0 += (v + 1) * c.R; v = -1; }
      c.v = v;
    }
  }

  function onPointerUp(e) {
    const m = pointerMap.get(e.pointerId);
    if (!m) return;
    pointerMap.delete(e.pointerId);
    if (m.kind === 'stick') {
      if (m.ctrl.pointer === e.pointerId) stickUp(m.ctrl);
    } else if (m.kind === 'button') {
      const c = m.ctrl;
      c.pointers = Math.max(0, c.pointers - 1);
      touchBtnDown[c.id] = Math.max(0, (touchBtnDown[c.id] || 0) - 1);
      if (!touchBtnDown[c.id]) {
        touchBtnEdge[c.id] = (touchBtnEdge[c.id] || 0) | 2;
        c.el.classList.remove('is-down');
      }
    } else if (m.kind === 'zones') {
      m.ctrl.pointers.delete(e.pointerId);
    } else if (m.kind === 'wheel') {
      const c = m.ctrl;
      if (c.pointer === e.pointerId) {
        c.pointer = -1;
        c.held = false;
        c.el.classList.remove('is-active');
      }
    }
  }

  function releaseControl(c) {
    if (!c) return;
    if (c.type === 'stick') {
      if (c.pointer !== -1) stickUp(c);
    } else if (c.type === 'button') {
      c.pointers = 0;
      touchBtnDown[c.id] = 0;
      if (c.el) c.el.classList.remove('is-down');
    } else if (c.type === 'zones') {
      c.pointers.clear();
    } else if (c.type === 'wheel') {
      c.pointer = -1;
      c.held = false;
      if (c.el) c.el.classList.remove('is-active');
    }
  }

  function destroyTouch() {
    if (!root) return;
    try { if (stageRO) stageRO.disconnect(); } catch (_) {}
    stageRO = null;
    for (let i = 0; i < built.length; i++) releaseControl(built[i]);
    root.removeEventListener('pointerdown', onPointerDown);
    root.removeEventListener('pointermove', onPointerMove);
    root.removeEventListener('pointerup', onPointerUp);
    root.removeEventListener('pointercancel', onPointerUp);
    root.removeEventListener('lostpointercapture', onPointerUp);
    root.removeEventListener('contextmenu', preventDefault);
    root.removeEventListener('gesturestart', preventDefault);
    try { if (root.parentNode) root.parentNode.removeChild(root); } catch (_) {}
    root = null;
    probe = null;
    built = [];
    touchVisible = false;
    for (const k in touchAxis) touchAxis[k] = 0;
    try { element.removeAttribute('data-gk-touch'); } catch (_) {}
  }

  function wantTouch() {
    if (settings.touch === 'on') return true;
    if (settings.touch === 'off') return false;
    return hasTouch() || coarsePointer();
  }

  function syncTouch() {
    const want = wantTouch() && !!element;
    if (want && !root) buildTouch();
    else if (!want && root) destroyTouch();
  }

  function setLayout(l) {
    layout = l || layout;
    compileLayout(layout);
    if (root) {
      root.setAttribute('data-layout', (layout && layout.id) || 'custom');
      rebuildTouch();
    }
    return api;
  }

  function setSettings(patch) {
    if (!patch || typeof patch !== 'object') return settings;
    const prevSteer = settings.steer;
    const prevGas = settings.autoGas;
    const prevTouch = settings.touch;
    Object.assign(settings, patch);
    if (settings.touch !== prevTouch) syncTouch();
    if (root && (settings.steer !== prevSteer || settings.autoGas !== prevGas)) rebuildTouch();
    else if (root) layoutTouch();
    return settings;
  }

  function setCopy(next) {
    copy = Object.assign({}, COPY_DEFAULTS, next || null);
    if (root) rebuildTouch();
  }

  function setMeter(id, value, ready) {
    const c = findControl('button', id);
    if (!c || !c.el) return;
    if (value == null || value < 0) {
      c.el.classList.remove('has-meter');
      c.el.classList.remove('is-ready');
      return;
    }
    c.el.classList.add('has-meter');
    c.el.style.setProperty('--gk-m', clamp(value, 0, 1).toFixed(3));
    c.el.classList.toggle('is-ready', !!ready);
  }

  function showTouch(on) {
    if (on === 'auto') settings.touch = 'auto';
    else settings.touch = on ? 'on' : 'off';
    syncTouch();
    return touchVisible;
  }

  function snapshot() {
    const axes = {};
    for (const k in axisOut) axes[k] = Math.round(axisOut[k] * 1000) / 1000;
    const buttons = {};
    for (const k in buttonsOut) if (buttonsOut[k].down) buttons[k] = true;
    return { method, axes, buttons, pad: pad.connected ? pad.id : '', tilt: tilt.state, tiltDeg: Math.round(tilt.raw * 10) / 10 };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    destroyTouch();
    stopTiltListening();
    try {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('pointerdown', onDocPointerDown, true);
    } catch (_) {}
    try { window.mentriaPadCapture = prevPadCapture; } catch (_) {}
  }

  const api = {
    update,
    axis,
    button,
    setLayout,
    get layout() { return layout; },
    setSettings,
    settings,
    setCopy,
    requestTilt,
    calibrateTilt,
    get tiltState() { return tilt.state; },
    get tiltDegrees() { return tilt.raw; },
    method: function () { return method; },
    showTouch,
    get touchVisible() { return touchVisible; },
    get padConnected() { return pad.connected; },
    padInfo: function () { return pad.connected ? { id: pad.id, mapping: pad.mapping, axes: pad.axes.slice(), buttons: pad.buttons.slice() } : null; },
    setMeter,
    haptic,
    rumble,
    feedback,
    snapshot,
    dispose
  };

  compileLayout(layout);
  try {
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('pointerdown', onDocPointerDown, true);
  } catch (_) {}
  syncTouch();
  return api;
}
