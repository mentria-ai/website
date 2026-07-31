import * as rendererMod from './renderer.js';
import * as simMod from './sim.js';
import * as audioMod from './audio.js';
import * as inputMod from './input.js';
import * as coursesMod from './courses.js';
import * as ghostMod from './ghost.js';

const FIXED = 1 / 120;
const MAX_FRAME = 0.25;
const MAX_TICKS = 40;

const BOB_PER_METER = 2.1;
const SWAY_TAU = 0.09;
const SWAY_LOOK_GAIN = 0.55;
const SWAY_LOOK_CLAMP = 0.35;
const SWAY_IDLE_RATE = 1.7;
const SWAY_IDLE_AMP = 0.024;
const SPRINT_TAU = 0.12;
const ADS_TAU = 0.18;
const RECOIL_KICK = 0.42;
const RECOIL_TAU = 0.09;
const MUZZLE_TAU = 0.07;
const TRACER_LIFE = 0.09;
const TRACER_RANGE = 80;
const TRACER_MAX = 48;
const SPARK_LIFE = 0.4;
const SPARK_MAX = 96;
const MUZZLE_FWD = 0.55;
const MUZZLE_LAT = 0.15;
const MUZZLE_DOWN = 0.1;
const HIT_FLASH_MS = 110;
const KILL_FLASH_MS = 420;
const FOV_ADS_DEG = 70;
const FOV_MIN_RAD = 0.7;
const FOV_MAX_RAD = 2.09;
const CROSS_BASE_PX = 4;
const CROSS_ADS_SHRINK = 0.45;

const AQ_LOW_FPS = 45;
const AQ_HIGH_FPS = 55;
const AQ_LOW_MS = 3000;
const AQ_HIGH_MS = 30000;
const AQ_STEP = 0.1;
const AQ_FLOOR = 0.5;

const COURSE_KEY = 'phosphor_course';
const FALLBACK_COURSE_IDS = ['c01', 'c02', 'c03', 'c04', 'c05'];
const MEDALS = ['bronze', 'silver', 'gold', 'signal'];
const MENU_DEAD = 0.55;
const GHOST_MSG_MS = 4000;

const FALLBACK_CONSTANTS = {
  walk: 4.5, sprint: 6.7, slideBurst: 9.0, slideDecay: 0.9, jumpVel: 4.6,
  gravity: 20, accelGround: 45, accelAir: 12, friction: 8, capsuleR: 0.35,
  height: 1.8, crouchH: 1.2, eye: 1.62, crouchEye: 1.0, stepUp: 0.4,
  mantleMax: 1.1, rpm: 700, spreadHip: 0.022, spreadAds: 0.004, spreadMove: 0.02,
  recoilV: 0.011, recoilH: 0.004, magSize: 30, reloadTime: 1.8, staminaMax: 6
};

const COPY = (typeof window !== 'undefined' && window.PHOSPHOR_COPY) || {};
const COURSE_NAMES = (COPY && COPY.courseNames) || {};

const scene = {
  camera: { pos: [0, 1.62, 4], yaw: 0, pitch: 0, fovY: 1.2 },
  viewmodel: { adsBlend: 0, recoil: 0, reloadPhase: null, bobPhase: 0, sway: [0, 0], sprintBlend: 0 },
  muzzle: 0,
  tracers: [],
  sparks: [],
  targetsDown: {},
  glitch: 0,
  quality: { scale: 1 },
  ghost: { active: false, pos: [0, 0, 0], yaw: 0, flags: 0 }
};
const vm = scene.viewmodel;

const settings = { fov: 100, quality: 1, glitchTest: 0 };
const sens = { mnk: 1, pad: 1, touch: 1, gyro: 1, adsMul: 0.75 };
const levels = { master: 0.8, sfx: 0.9, ambient: 0.5 };

const localIntents = {
  forward: 0, strafe: 0, jumpPressed: false, crouchHeld: false, sprintHeld: false,
  fireHeld: false, adsHeld: false, reloadPressed: false, restartPressed: false,
  pausePressed: false, lookDx: 0, lookDy: 0
};

const completeEv = { t: 'run_complete', medal: null };

const tracerPool = [];
const sparkPool = [];
for (let i = 0; i < TRACER_MAX; i++) tracerPool.push({ from: [0, 0, 0], to: [0, 0, 0], age01: 0, live: false });
for (let i = 0; i < SPARK_MAX; i++) sparkPool.push({ pos: [0, 0, 0], age01: 0, live: false });
let tracerCursor = 0;
let sparkCursor = 0;

const fwd = [0, 0, -1];
const rgt = [1, 0, 0];
const upv = [0, 1, 0];
const mFrom = [0, 0, 0];
const mTo = [0, 0, 0];

const dom = {};
const hudCache = { time: '', ammo: '', speed: '', targets: '', fps: '', method: '', gap: -1, hit: false, kill: false, crossOp: -1 };

const bests = {};
const rowEls = {};

let constants = FALLBACK_CONSTANTS;
let renderer = null;
let sim = null;
let audio = null;
let input = null;
let devPanel = null;
let devStatus = null;
let devCourseSel = null;
let devAutoEl = null;
let padDebugEl = null;
let padDebugLast = '';

let state = 'boot';
let acc = 0;
let lastNow = 0;
let rafId = 0;
let aspect = 16 / 9;
let viewH = 720;
let runMs = 0;
let runActive = false;
let runDone = false;
let downCount = 0;
let hitFlashUntil = 0;
let killFlashUntil = 0;
let fpsFrames = 0;
let fpsWindowStart = 0;
let fpsValue = 0;
let devOpen = false;
let touchDevice = false;
let touchUiOn = false;
let contextLost = false;
let autoQuality = true;
let qualityCap = 1;
let qualityLowSince = 0;
let qualityHighSince = 0;

let courseIds = FALLBACK_COURSE_IDS;
let course = null;
let courseId = '';
let world = null;
let targetTotal = 0;
let worldReady = false;
let loading = false;
let loadSeq = 0;
let pendingId = '';
let selIndex = 0;
let menuAxis = 0;

let recorder = null;
let ghostPlayer = null;
let ghostData = null;
let ghostBytes = null;
let ghostCutMs = 0;
let raceGhost = true;
let ghostMsgUntil = 0;

function $(id) {
  return document.getElementById(id);
}

function grabDom() {
  dom.stage = $('ph-stage');
  dom.canvas = $('ph-canvas');
  dom.hud = $('ph-hud');
  dom.time = $('ph-time');
  dom.ammo = $('ph-ammo');
  dom.speed = $('ph-speed');
  dom.targets = $('ph-targets');
  dom.par = $('ph-hud-par');
  dom.fps = $('ph-fps');
  dom.method = $('ph-method');
  dom.cross = $('ph-cross');
  dom.crossT = $('ph-cross-t');
  dom.crossR = $('ph-cross-r');
  dom.crossB = $('ph-cross-b');
  dom.crossL = $('ph-cross-l');
  dom.hit = $('ph-hit');
  dom.kill = $('ph-kill');
  dom.boot = $('ph-boot');
  dom.ready = $('ph-ready');
  dom.readyClick = $('ph-ready-click');
  dom.readyStart = $('ph-ready-start');
  dom.sel = $('ph-sel');
  dom.courseHint = $('ph-course-hint');
  dom.courseErr = $('ph-course-err');
  dom.pause = $('ph-pause');
  dom.pauseNote = $('ph-pause-note');
  dom.resume = $('ph-resume');
  dom.pauseRestart = $('ph-pause-restart');
  dom.pauseCourses = $('ph-pause-courses');
  dom.complete = $('ph-complete');
  dom.completeCourse = $('ph-complete-course');
  dom.completeTime = $('ph-complete-time');
  dom.completeMedal = $('ph-complete-medal');
  dom.completeBest = $('ph-complete-best');
  dom.completeNew = $('ph-complete-new');
  dom.parTable = $('ph-par-table');
  dom.ghostLine = $('ph-ghost-line');
  dom.ghostMsg = $('ph-ghost-msg');
  dom.completeRestart = $('ph-complete-restart');
  dom.completeNext = $('ph-complete-next');
  dom.completeCourses = $('ph-complete-courses');
  dom.raceBtn = $('ph-race');
  dom.shareBtn = $('ph-share');
  dom.importBtn = $('ph-import');
  dom.ghostFile = $('ph-ghost-file');
  dom.unsup = $('ph-unsup');
  dom.unsupDetail = $('ph-unsup-detail');
  dom.gyro = $('ph-gyro');
  dom.fs = $('ph-fs');
  dom.pauseBtn = $('ph-pausebtn');
  dom.pauseNoteDefault = dom.pauseNote ? dom.pauseNote.textContent : '';
  dom.gyroLabel = dom.gyro ? dom.gyro.textContent : '';
}

function fail(detail) {
  state = 'failed';
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
  try {
    console.error('[phosphor] ' + String(detail));
  } catch (_) {}
  if (dom.boot) dom.boot.hidden = true;
  if (dom.ready) dom.ready.hidden = true;
  if (dom.pause) dom.pause.hidden = true;
  if (dom.complete) dom.complete.hidden = true;
  if (dom.hud) dom.hud.hidden = true;
  if (dom.gyro) dom.gyro.hidden = true;
  if (dom.canvas) dom.canvas.style.visibility = 'hidden';
  if (dom.unsupDetail) dom.unsupDetail.textContent = String(detail);
  if (dom.unsup) dom.unsup.hidden = false;
}

function isFn(v) {
  return typeof v === 'function';
}

const errSeen = {};

function logOnce(name, err) {
  if (errSeen[name]) return;
  errSeen[name] = true;
  try {
    console.error('[phosphor] ' + name + ' failed', err);
  } catch (_) {}
}

function call(obj, name, a, b, c) {
  if (!obj || !isFn(obj[name])) return undefined;
  try {
    return obj[name](a, b, c);
  } catch (err) {
    logOnce(name, err);
    return undefined;
  }
}

function promiseCall(obj, name, a, b) {
  if (!obj || !isFn(obj[name])) return null;
  let r = null;
  try {
    r = obj[name](a, b);
  } catch (err) {
    logOnce(name, err);
    return null;
  }
  if (r && isFn(r.then)) return r;
  return Promise.resolve(r);
}

function basis(yaw, pitch) {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  fwd[0] = -sy * cp;
  fwd[1] = sp;
  fwd[2] = -cy * cp;
  rgt[0] = cy;
  rgt[1] = 0;
  rgt[2] = -sy;
  upv[0] = rgt[1] * fwd[2] - rgt[2] * fwd[1];
  upv[1] = rgt[2] * fwd[0] - rgt[0] * fwd[2];
  upv[2] = rgt[0] * fwd[1] - rgt[1] * fwd[0];
}

function num(v, fallback) {
  return typeof v === 'number' && v === v && v !== Infinity && v !== -Infinity ? v : fallback;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function ease(current, target, tau, dt) {
  if (tau <= 0) return target;
  const k = 1 - Math.exp(-dt / tau);
  return current + (target - current) * k;
}

function fmtTime(ms) {
  let total = Math.floor(num(ms, 0));
  if (total < 0) total = 0;
  const m = Math.floor(total / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const frac = total % 1000;
  const sPad = s < 10 ? '0' + s : '' + s;
  const fPad = frac < 10 ? '00' + frac : frac < 100 ? '0' + frac : '' + frac;
  return m + ':' + sPad + '.' + fPad;
}

function fmtGap(ms) {
  return (Math.abs(num(ms, 0)) / 1000).toFixed(3);
}

function fmtDelta(ms) {
  const v = num(ms, 0);
  return (v < 0 ? '-' : '+') + fmtGap(v);
}

function copyIntents(src) {
  const d = localIntents;
  if (!src) {
    d.forward = 0;
    d.strafe = 0;
    d.jumpPressed = false;
    d.crouchHeld = false;
    d.sprintHeld = false;
    d.fireHeld = false;
    d.adsHeld = false;
    d.reloadPressed = false;
    d.restartPressed = false;
    d.pausePressed = false;
    d.lookDx = 0;
    d.lookDy = 0;
    return d;
  }
  d.forward = clamp(num(src.forward, 0), -1, 1);
  d.strafe = clamp(num(src.strafe, 0), -1, 1);
  d.jumpPressed = !!src.jumpPressed;
  d.crouchHeld = !!src.crouchHeld;
  d.sprintHeld = !!src.sprintHeld;
  d.fireHeld = !!src.fireHeld;
  d.adsHeld = !!src.adsHeld;
  d.reloadPressed = !!src.reloadPressed;
  d.restartPressed = !!src.restartPressed;
  d.pausePressed = !!src.pausePressed;
  d.lookDx = num(src.lookDx, 0);
  d.lookDy = num(src.lookDy, 0);
  return d;
}

function spawnTracer(from, to) {
  for (let i = 0; i < TRACER_MAX; i++) {
    const idx = (tracerCursor + i) % TRACER_MAX;
    const t = tracerPool[idx];
    if (t.live) continue;
    t.from[0] = from[0];
    t.from[1] = from[1];
    t.from[2] = from[2];
    t.to[0] = to[0];
    t.to[1] = to[1];
    t.to[2] = to[2];
    t.age01 = 0;
    t.live = true;
    tracerCursor = (idx + 1) % TRACER_MAX;
    return;
  }
  const t = tracerPool[tracerCursor];
  t.from[0] = from[0];
  t.from[1] = from[1];
  t.from[2] = from[2];
  t.to[0] = to[0];
  t.to[1] = to[1];
  t.to[2] = to[2];
  t.age01 = 0;
  t.live = true;
  tracerCursor = (tracerCursor + 1) % TRACER_MAX;
}

function spawnSpark(pos) {
  for (let i = 0; i < SPARK_MAX; i++) {
    const idx = (sparkCursor + i) % SPARK_MAX;
    const s = sparkPool[idx];
    if (s.live) continue;
    s.pos[0] = pos[0];
    s.pos[1] = pos[1];
    s.pos[2] = pos[2];
    s.age01 = 0;
    s.live = true;
    sparkCursor = (idx + 1) % SPARK_MAX;
    return;
  }
  const s = sparkPool[sparkCursor];
  s.pos[0] = pos[0];
  s.pos[1] = pos[1];
  s.pos[2] = pos[2];
  s.age01 = 0;
  s.live = true;
  sparkCursor = (sparkCursor + 1) % SPARK_MAX;
}

function clearFx() {
  for (let i = 0; i < TRACER_MAX; i++) tracerPool[i].live = false;
  for (let i = 0; i < SPARK_MAX; i++) sparkPool[i].live = false;
  scene.tracers.length = 0;
  scene.sparks.length = 0;
  scene.muzzle = 0;
  vm.recoil = 0;
  vm.bobPhase = 0;
  vm.sway[0] = 0;
  vm.sway[1] = 0;
  vm.sprintBlend = 0;
  hitFlashUntil = 0;
  killFlashUntil = 0;
}

function ageFx(dt) {
  for (let i = 0; i < TRACER_MAX; i++) {
    const t = tracerPool[i];
    if (!t.live) continue;
    t.age01 += dt / TRACER_LIFE;
    if (t.age01 >= 1) t.live = false;
  }
  for (let i = 0; i < SPARK_MAX; i++) {
    const s = sparkPool[i];
    if (!s.live) continue;
    s.age01 += dt / SPARK_LIFE;
    if (s.age01 >= 1) s.live = false;
  }
  scene.muzzle = scene.muzzle > 0.002 ? scene.muzzle * Math.exp(-dt / MUZZLE_TAU) : 0;
  vm.recoil = vm.recoil > 0.002 ? vm.recoil * Math.exp(-dt / RECOIL_TAU) : 0;
}

function collectFx() {
  scene.tracers.length = 0;
  let n = 0;
  for (let i = 0; i < TRACER_MAX; i++) {
    const t = tracerPool[i];
    if (t.live) scene.tracers[n++] = t;
  }
  scene.sparks.length = 0;
  n = 0;
  for (let i = 0; i < SPARK_MAX; i++) {
    const s = sparkPool[i];
    if (s.live) scene.sparks[n++] = s;
  }
}

function onFire(e) {
  vm.recoil = Math.min(1, vm.recoil + RECOIL_KICK);
  scene.muzzle = 1;
  const cam = scene.camera;
  basis(cam.yaw, cam.pitch);
  const lat = MUZZLE_LAT * (1 - vm.adsBlend);
  mFrom[0] = cam.pos[0] + fwd[0] * MUZZLE_FWD + rgt[0] * lat - upv[0] * MUZZLE_DOWN;
  mFrom[1] = cam.pos[1] + fwd[1] * MUZZLE_FWD + rgt[1] * lat - upv[1] * MUZZLE_DOWN;
  mFrom[2] = cam.pos[2] + fwd[2] * MUZZLE_FWD + rgt[2] * lat - upv[2] * MUZZLE_DOWN;
  const hit = e.hit;
  if (hit && hit.point && hit.point.length > 2) {
    mTo[0] = num(hit.point[0], mFrom[0]);
    mTo[1] = num(hit.point[1], mFrom[1]);
    mTo[2] = num(hit.point[2], mFrom[2]);
    spawnSpark(mTo);
  } else {
    const o = e.origin && e.origin.length > 2 ? e.origin : cam.pos;
    const d = e.dir && e.dir.length > 2 ? e.dir : fwd;
    mTo[0] = num(o[0], 0) + num(d[0], 0) * TRACER_RANGE;
    mTo[1] = num(o[1], 0) + num(d[1], 0) * TRACER_RANGE;
    mTo[2] = num(o[2], 0) + num(d[2], 0) * TRACER_RANGE;
  }
  spawnTracer(mFrom, mTo);
}

function routeEvents(evs) {
  if (!evs || !evs.length) return;
  for (let i = 0; i < evs.length; i++) {
    const e = evs[i];
    if (!e || !e.t) continue;
    if (audio) call(audio, 'event', e);
    const t = e.t;
    if (t === 'fire') onFire(e);
    else if (t === 'hit_target') hitFlashUntil = performance.now() + HIT_FLASH_MS;
    else if (t === 'target_down') {
      if (e.id && !scene.targetsDown[e.id]) {
        scene.targetsDown[e.id] = true;
        downCount++;
      }
      killFlashUntil = performance.now() + KILL_FLASH_MS;
    }
  }
}

function assembleScene(st, dt) {
  const cam = scene.camera;
  const pos = st && st.pos && st.pos.length > 2 ? st.pos : cam.pos;
  const eyeH = num(st && st.eye, num(constants.eye, 1.62));
  cam.pos[0] = num(pos[0], 0);
  cam.pos[1] = num(pos[1], 0) + eyeH;
  cam.pos[2] = num(pos[2], 0);
  cam.yaw = num(st && st.yaw, cam.yaw);
  cam.pitch = clamp(num(st && st.pitch, cam.pitch), -1.55, 1.55);

  const adsTarget = localIntents.adsHeld ? 1 : 0;
  const simAds = st && typeof st.adsBlend01 === 'number' ? clamp(st.adsBlend01, 0, 1) : null;
  vm.adsBlend = simAds === null ? ease(vm.adsBlend, adsTarget, ADS_TAU, dt) : simAds;

  const hipDeg = clamp(settings.fov, 60, 130);
  const deg = hipDeg + (FOV_ADS_DEG - hipDeg) * vm.adsBlend;
  const hRad = (deg * Math.PI) / 180;
  cam.fovY = clamp(2 * Math.atan(Math.tan(hRad / 2) / aspect), FOV_MIN_RAD, FOV_MAX_RAD);

  const speed = Math.max(0, num(st && st.speed, 0));
  const grounded = !st || st.grounded !== false;
  if (grounded && speed > 0.05) {
    vm.bobPhase += speed * dt * BOB_PER_METER;
    if (vm.bobPhase > Math.PI * 2) vm.bobPhase -= Math.PI * 2 * Math.floor(vm.bobPhase / (Math.PI * 2));
  }

  const tired = 1 - clamp(num(st && st.stamina01, 1), 0, 1);
  const lookRateX = dt > 0 ? localIntents.lookDx / dt : 0;
  const lookRateY = dt > 0 ? localIntents.lookDy / dt : 0;
  const breathe = Math.sin(vm.bobPhase * 0.35 + runMs * 0.001 * SWAY_IDLE_RATE) * SWAY_IDLE_AMP * (0.25 + tired);
  const swayScale = (1 - 0.6 * vm.adsBlend) * (1 + 0.8 * tired);
  const targetX = clamp(-lookRateX * SWAY_LOOK_GAIN * swayScale, -SWAY_LOOK_CLAMP, SWAY_LOOK_CLAMP);
  const targetY = clamp((-lookRateY * SWAY_LOOK_GAIN * swayScale) + breathe, -SWAY_LOOK_CLAMP, SWAY_LOOK_CLAMP);
  vm.sway[0] = ease(vm.sway[0], targetX, SWAY_TAU, dt);
  vm.sway[1] = ease(vm.sway[1], targetY, SWAY_TAU, dt);

  const sprinting = st && (st.move === 'sprint' || st.move === 'slide');
  vm.sprintBlend = ease(vm.sprintBlend, sprinting ? 1 : 0, SPRINT_TAU, dt);

  const rel = st && typeof st.reloading01 === 'number' ? clamp(st.reloading01, 0, 1) : null;
  vm.reloadPhase = rel;

  scene.glitch = clamp(settings.glitchTest, 0, 1);
  scene.quality.scale = clamp(settings.quality, 0.5, 1);
}

function updateGhost() {
  const g = scene.ghost;
  if (state !== 'playing' || !raceGhost || !ghostPlayer) {
    g.active = false;
    return;
  }
  if (ghostCutMs > 0 && runMs > ghostCutMs) {
    g.active = false;
    return;
  }
  const f = call(ghostPlayer, 'at', runMs);
  if (!f || !f.pos || f.pos.length < 3) {
    g.active = false;
    return;
  }
  g.pos[0] = num(f.pos[0], 0);
  g.pos[1] = num(f.pos[1], 0);
  g.pos[2] = num(f.pos[2], 0);
  g.yaw = num(f.yaw, 0);
  g.flags = num(f.flags, 0) | 0;
  g.active = true;
}

function updateHud(st, now) {
  if (dom.time) {
    const s = fmtTime(runMs);
    if (s !== hudCache.time) {
      hudCache.time = s;
      dom.time.textContent = s;
    }
  }
  if (dom.ammo) {
    const mag = Math.round(num(constants.magSize, 30));
    const s = Math.max(0, Math.round(num(st && st.ammo, 0))) + '/' + mag;
    if (s !== hudCache.ammo) {
      hudCache.ammo = s;
      dom.ammo.textContent = s;
    }
  }
  if (dom.speed) {
    const s = Math.max(0, num(st && st.speed, 0)).toFixed(1);
    if (s !== hudCache.speed) {
      hudCache.speed = s;
      dom.speed.textContent = s;
    }
  }
  if (dom.targets) {
    const s = Math.max(0, targetTotal - downCount) + '/' + targetTotal;
    if (s !== hudCache.targets) {
      hudCache.targets = s;
      dom.targets.textContent = s;
    }
  }
  if (dom.fps) {
    const s = fpsValue > 0 ? '' + fpsValue : '--';
    if (s !== hudCache.fps) {
      hudCache.fps = s;
      dom.fps.textContent = s;
    }
  }
  if (dom.method) {
    const m = input ? call(input, 'method') : 'mnk';
    const s = m === 'pad' ? COPY.methodPad : m === 'touch' ? COPY.methodTouch : COPY.methodMnk;
    const label = s || String(m || 'mnk');
    if (label !== hudCache.method) {
      hudCache.method = label;
      dom.method.textContent = label;
    }
  }
  if (dom.crossT) {
    const spread = Math.max(0, num(st && st.spread, 0));
    const px = (Math.tan(spread) / Math.tan(scene.camera.fovY / 2)) * (viewH / 2);
    const gap = (CROSS_BASE_PX + px) * (1 - CROSS_ADS_SHRINK * vm.adsBlend);
    if (Math.abs(gap - hudCache.gap) > 0.25) {
      hudCache.gap = gap;
      const g = gap.toFixed(1);
      dom.crossT.style.transform = 'translate(-50%,-50%) translateY(-' + g + 'px)';
      dom.crossB.style.transform = 'translate(-50%,-50%) translateY(' + g + 'px)';
      dom.crossL.style.transform = 'translate(-50%,-50%) translateX(-' + g + 'px)';
      dom.crossR.style.transform = 'translate(-50%,-50%) translateX(' + g + 'px)';
    }
  }
  if (dom.cross) {
    const op = Math.round(Math.max(0, 1 - vm.adsBlend * 2.2) * 100) / 100;
    if (op !== hudCache.crossOp) {
      hudCache.crossOp = op;
      dom.cross.style.opacity = String(op);
    }
  }
  if (dom.hit) {
    const on = now < hitFlashUntil;
    if (on !== hudCache.hit) {
      hudCache.hit = on;
      dom.hit.classList.toggle('is-on', on);
    }
  }
  if (dom.kill) {
    const on = now < killFlashUntil;
    if (on !== hudCache.kill) {
      hudCache.kill = on;
      dom.kill.classList.toggle('is-on', on);
    }
  }
  if (dom.ghostMsg && ghostMsgUntil > 0 && now > ghostMsgUntil) {
    ghostMsgUntil = 0;
    dom.ghostMsg.hidden = true;
    dom.ghostMsg.textContent = '';
  }
}

function showOverlays() {
  if (dom.boot) dom.boot.hidden = state !== 'boot';
  if (dom.ready) dom.ready.hidden = state !== 'ready';
  if (dom.pause) dom.pause.hidden = state !== 'paused';
  if (dom.complete) dom.complete.hidden = state !== 'complete';
  if (dom.hud) dom.hud.hidden = state === 'boot' || state === 'failed';
  if (dom.cross) dom.cross.hidden = state !== 'playing';
  if (dom.gyro) dom.gyro.hidden = !touchDevice || (state !== 'ready' && state !== 'paused');
  if (dom.stage) dom.stage.classList.toggle('is-playing', state === 'playing');
}

function setState(next) {
  if (state === next) return;
  state = next;
  showOverlays();
}

function courseName(def, id) {
  const key = def && typeof def.nameKey === 'string' && def.nameKey ? def.nameKey : 'tool.phosphor.' + id + '_name';
  const byKey = COURSE_NAMES[key];
  if (typeof byKey === 'string' && byKey) return byKey;
  const fallback = COURSE_NAMES['tool.phosphor.' + id + '_name'];
  return typeof fallback === 'string' && fallback ? fallback : id;
}

function medalName(m) {
  if (m === 'signal') return COPY.medalSignal || 'signal';
  if (m === 'gold') return COPY.medalGold || 'gold';
  if (m === 'silver') return COPY.medalSilver || 'silver';
  if (m === 'bronze') return COPY.medalBronze || 'bronze';
  return COPY.medalNone || '';
}

function localMedal(ms) {
  const par = course && course.par;
  if (!par) return null;
  const s = num(ms, 0) / 1000;
  for (let i = MEDALS.length - 1; i >= 0; i--) {
    const key = MEDALS[i];
    const p = num(par[key], 0);
    if (p > 0 && s <= p) return key;
  }
  return null;
}

function medalForTime(ms) {
  const m = call(coursesMod, 'medalFor', course, ms);
  if (typeof m === 'string' && MEDALS.indexOf(m) >= 0) return m;
  return localMedal(ms);
}

function resolveCourseIds() {
  const ids = coursesMod.COURSE_IDS;
  if (Array.isArray(ids) && ids.length) {
    const out = [];
    for (let i = 0; i < ids.length; i++) {
      if (typeof ids[i] === 'string' && ids[i]) out.push(ids[i]);
    }
    if (out.length) return out;
  }
  return FALLBACK_COURSE_IDS;
}

function loadCoursePref() {
  try {
    const v = localStorage.getItem(COURSE_KEY);
    if (typeof v === 'string' && courseIds.indexOf(v) >= 0) return v;
  } catch (_) {}
  return courseIds[0];
}

function saveCoursePref(id) {
  try {
    localStorage.setItem(COURSE_KEY, id);
  } catch (_) {}
}

function markSel() {
  for (let i = 0; i < courseIds.length; i++) {
    const r = rowEls[courseIds[i]];
    if (!r) continue;
    const on = i === selIndex;
    r.row.classList.toggle('is-sel', on);
    if (on) r.row.setAttribute('aria-current', 'true');
    else r.row.removeAttribute('aria-current');
  }
}

function updateRow(id) {
  const r = rowEls[id];
  if (!r) return;
  const b = bests[id];
  const t = b ? num(b.timeMs, 0) : 0;
  r.best.textContent = t > 0 ? fmtTime(t) : COPY.selectNone || '';
  let m = b && typeof b.medal === 'string' ? b.medal : '';
  if (!m && t > 0 && id === courseId) m = localMedal(t) || '';
  if (m && MEDALS.indexOf(m) >= 0) {
    r.medal.hidden = false;
    r.medal.className = 'ph-medal ph-medal--' + m;
    r.medal.textContent = medalName(m);
  } else {
    r.medal.hidden = true;
    r.medal.className = 'ph-medal';
    r.medal.textContent = '';
  }
}

function onRowPick(id) {
  const i = courseIds.indexOf(id);
  if (i >= 0) {
    selIndex = i;
    markSel();
  }
  if (id === courseId && worldReady) {
    firstGesture();
    return;
  }
  pickCourse(id);
}

function buildSelect() {
  if (!dom.sel) return;
  dom.sel.textContent = '';
  for (let i = 0; i < courseIds.length; i++) {
    const id = courseIds[i];
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'ph-sel__row';
    const idx = document.createElement('span');
    idx.className = 'ph-sel__n';
    idx.textContent = i < 9 ? '0' + (i + 1) : '' + (i + 1);
    const name = document.createElement('span');
    name.className = 'ph-sel__name';
    name.textContent = courseName(null, id);
    const bestWrap = document.createElement('span');
    bestWrap.className = 'ph-sel__best';
    const bestK = document.createElement('span');
    bestK.className = 'ph-sel__k';
    bestK.textContent = COPY.selectBest || '';
    const bestV = document.createElement('span');
    bestV.className = 'ph-sel__bv';
    bestV.textContent = COPY.selectNone || '';
    bestWrap.appendChild(bestK);
    bestWrap.appendChild(bestV);
    const medal = document.createElement('span');
    medal.className = 'ph-medal';
    medal.hidden = true;
    row.appendChild(idx);
    row.appendChild(name);
    row.appendChild(bestWrap);
    row.appendChild(medal);
    row.addEventListener('click', (e) => {
      e.stopPropagation();
      onRowPick(id);
    });
    dom.sel.appendChild(row);
    rowEls[id] = { row: row, name: name, best: bestV, medal: medal };
  }
  markSel();
}

function moveSel(delta) {
  if (!courseIds.length) return;
  let i = selIndex + delta;
  while (i < 0) i += courseIds.length;
  while (i >= courseIds.length) i -= courseIds.length;
  if (i === selIndex) return;
  selIndex = i;
  markSel();
  pickCourse(courseIds[i]);
}

function menuNav(it) {
  const ax = it.forward > MENU_DEAD ? 1 : it.forward < -MENU_DEAD ? -1 : 0;
  if (ax === menuAxis) return;
  menuAxis = ax;
  if (ax === 1) moveSel(-1);
  else if (ax === -1) moveSel(1);
}

function setCourseError(on) {
  if (dom.courseErr) dom.courseErr.hidden = !on;
}

function setHint(text) {
  if (dom.courseHint) dom.courseHint.textContent = text;
}

function applyCourseUi() {
  const name = courseName(course, courseId);
  const goldMs = course && course.par ? num(course.par.gold, 0) * 1000 : 0;
  setHint(goldMs > 0 ? name + ' · ' + medalName('gold') + ' ' + fmtTime(goldMs) : name);
  if (dom.par) dom.par.textContent = goldMs > 0 ? fmtTime(goldMs) : COPY.selectNone || '';
  if (dom.completeCourse) dom.completeCourse.textContent = name;
  if (dom.completeNext) dom.completeNext.hidden = courseIds.indexOf(courseId) >= courseIds.length - 1;
}

function updateRaceBtn() {
  if (dom.raceBtn) {
    dom.raceBtn.textContent = raceGhost ? COPY.ghostRaceOn || '' : COPY.ghostRaceOff || '';
    dom.raceBtn.setAttribute('aria-pressed', raceGhost ? 'true' : 'false');
  }
  if (dom.shareBtn) dom.shareBtn.disabled = !ghostData;
}

function setGhostMsg(text) {
  if (!dom.ghostMsg) return;
  const s = text || '';
  dom.ghostMsg.textContent = s;
  dom.ghostMsg.hidden = !s;
  ghostMsgUntil = s ? performance.now() + GHOST_MSG_MS : 0;
}

function newRun() {
  recorder = null;
  ghostPlayer = null;
  ghostCutMs = 0;
  scene.ghost.active = false;
  if (!courseId) return;
  if (isFn(ghostMod.createRecorder)) {
    try {
      recorder = ghostMod.createRecorder(courseId);
    } catch (err) {
      recorder = null;
      logOnce('createRecorder', err);
    }
    if (recorder && !isFn(recorder.sample)) recorder = null;
  }
  if (raceGhost && ghostData && isFn(ghostMod.createPlayer)) {
    try {
      ghostPlayer = ghostMod.createPlayer(ghostData);
    } catch (err) {
      ghostPlayer = null;
      logOnce('createPlayer', err);
    }
    if (ghostPlayer && !isFn(ghostPlayer.at)) ghostPlayer = null;
    if (ghostPlayer) {
      const d = num(ghostPlayer.duration, 0);
      ghostCutMs = d > 1000 ? d : 0;
    }
  }
}

function startRunTimerIfMoving() {
  if (runActive || runDone) return;
  const it = localIntents;
  if (it.forward !== 0 || it.strafe !== 0 || it.jumpPressed || it.fireHeld || it.crouchHeld) runActive = true;
}

function resetRunCore() {
  call(sim, 'reset');
  acc = 0;
  runMs = 0;
  runActive = false;
  runDone = false;
  downCount = 0;
  for (const k in scene.targetsDown) delete scene.targetsDown[k];
  clearFx();
  hudCache.time = '';
  hudCache.targets = '';
  hudCache.ammo = '';
  newRun();
}

function resetRun() {
  if (!worldReady) return;
  resetRunCore();
  if (state !== 'playing') {
    setState('playing');
    if (!touchDevice) call(input, 'requestPointerLock');
    call(audio, 'startAmbient');
  }
}

function backToSelect() {
  if (state !== 'paused' && state !== 'complete') return;
  call(audio, 'stopAmbient');
  if (touchUiOn) {
    call(input, 'enableTouchUI', false);
    touchUiOn = false;
  }
  resetRunCore();
  setState('ready');
}

function pauseGame(note) {
  if (state !== 'playing') return;
  if (dom.pauseNote) dom.pauseNote.textContent = note || dom.pauseNoteDefault || '';
  setState('paused');
  call(input, 'exitPointerLock');
  call(audio, 'stopAmbient');
}

function resumeGame() {
  if (state !== 'paused') return;
  if (contextLost) return;
  setState('playing');
  if (touchDevice) {
    if (!touchUiOn) {
      call(input, 'enableTouchUI', true);
      touchUiOn = true;
    }
  } else {
    call(input, 'requestPointerLock');
  }
  call(audio, 'unlock');
  call(audio, 'startAmbient');
}

function firstGesture() {
  if (state !== 'ready') return;
  if (!worldReady || loading) return;
  call(audio, 'unlock');
  call(audio, 'setLevels', levels);
  call(audio, 'startAmbient');
  if (touchDevice) {
    call(input, 'enableTouchUI', true);
    touchUiOn = true;
  } else {
    call(input, 'requestPointerLock');
  }
  resetRunCore();
  setState('playing');
}

function buildParTable(finalMs) {
  if (!dom.parTable) return;
  dom.parTable.textContent = '';
  const par = course && course.par;
  if (!par) return;
  for (let i = MEDALS.length - 1; i >= 0; i--) {
    const key = MEDALS[i];
    const secs = num(par[key], 0);
    if (!(secs > 0)) continue;
    const row = document.createElement('div');
    row.className = 'ph-par__row';
    const chip = document.createElement('span');
    chip.className = 'ph-medal ph-medal--' + key;
    chip.textContent = medalName(key);
    const t = document.createElement('span');
    t.className = 'ph-par__t';
    t.textContent = fmtTime(secs * 1000);
    const d = document.createElement('span');
    const delta = finalMs - secs * 1000;
    d.className = delta <= 0 ? 'ph-par__d is-good' : 'ph-par__d';
    d.textContent = fmtDelta(delta);
    row.appendChild(chip);
    row.appendChild(t);
    row.appendChild(d);
    dom.parTable.appendChild(row);
  }
}

function showGhostCompare(finalMs) {
  if (!dom.ghostLine) return;
  const gd = ghostData ? num(ghostData.durationMs, ghostCutMs) : 0;
  if (!raceGhost || !ghostPlayer || !(gd > 0)) {
    dom.ghostLine.hidden = true;
    dom.ghostLine.textContent = '';
    return;
  }
  const diff = finalMs - gd;
  const word = diff <= 0 ? COPY.ghostAhead || '' : COPY.ghostBehind || '';
  dom.ghostLine.textContent = (COPY.ghostTime || '') + ' ' + fmtTime(gd) + ' · ' + word + ' ' + fmtGap(diff);
  dom.ghostLine.hidden = false;
}

function persistRun(finalMs, medal) {
  const prev = bests[courseId];
  const prevMs = prev ? num(prev.timeMs, 0) : 0;
  const improved = !(prevMs > 0) || finalMs < prevMs;
  if (improved) {
    bests[courseId] = { timeMs: finalMs, medal: medal };
    updateRow(courseId);
  }
  if (dom.completeNew) dom.completeNew.hidden = !improved;
  if (dom.completeBest) {
    const shown = improved ? finalMs : prevMs;
    dom.completeBest.textContent = shown > 0 ? (COPY.completeBest || '') + ' ' + fmtTime(shown) : '';
  }
  const id = courseId;
  const p = promiseCall(coursesMod, 'saveBest', id, finalMs);
  if (p) {
    p.then((res) => {
      if (!res || typeof res !== 'object') return;
      const b = bests[id];
      if (b && typeof res.medal === 'string' && MEDALS.indexOf(res.medal) >= 0) {
        b.medal = res.medal;
        updateRow(id);
      }
    }).catch(() => {});
  }
  return improved;
}

function storeGhost(data, improved) {
  if (!data || !improved || !isFn(ghostMod.serialize)) return;
  let bytes = null;
  try {
    bytes = ghostMod.serialize(data);
  } catch (err) {
    bytes = null;
    logOnce('serialize', err);
  }
  if (!bytes) return;
  ghostData = data;
  ghostBytes = bytes;
  updateRaceBtn();
  promiseCall(coursesMod, 'saveGhostBytes', courseId, bytes);
}

function completeRun() {
  runDone = true;
  runActive = false;
  const finalMs = runMs;
  scene.ghost.active = false;
  const medal = medalForTime(finalMs);

  completeEv.medal = medal;
  if (audio) call(audio, 'event', completeEv);

  if (dom.completeTime) dom.completeTime.textContent = fmtTime(finalMs);
  if (dom.completeMedal) {
    if (medal) {
      dom.completeMedal.className = 'ph-medal ph-medal--lg ph-medal--' + medal;
      dom.completeMedal.textContent = medalName(medal);
    } else {
      dom.completeMedal.className = 'ph-medal ph-medal--lg ph-medal--none';
      dom.completeMedal.textContent = COPY.medalNone || '';
    }
  }
  buildParTable(finalMs);
  showGhostCompare(finalMs);
  setGhostMsg('');

  let data = null;
  if (recorder) data = call(recorder, 'finish', finalMs);
  const improved = persistRun(finalMs, medal);
  storeGhost(data, improved);
  updateRaceBtn();

  setState('complete');
  call(input, 'exitPointerLock');
}

function failCourse() {
  worldReady = false;
  loading = false;
  setCourseError(true);
  setHint('');
  if (dom.boot) dom.boot.hidden = true;
  if (state !== 'failed') setState('ready');
  showOverlays();
  drainPending();
}

function drainPending() {
  if (!pendingId) return;
  const next = pendingId;
  pendingId = '';
  if (next !== courseId) loadCourseById(next, true);
}

function loadGhostFor(id) {
  const p = promiseCall(coursesMod, 'getGhostBytes', id);
  if (!p) return;
  p.then((bytes) => {
    if (id !== courseId || !bytes || !isFn(ghostMod.parse)) return;
    if (ghostData) return;
    let d = null;
    try {
      d = ghostMod.parse(bytes);
    } catch (err) {
      d = null;
      logOnce('parse', err);
    }
    if (!d) return;
    ghostData = d;
    ghostBytes = bytes;
    updateRaceBtn();
  }).catch(() => {});
}

function loadBestFor(id) {
  const p = promiseCall(coursesMod, 'getBest', id);
  if (!p) return;
  p.then((b) => {
    bests[id] = b && typeof b === 'object' ? b : null;
    updateRow(id);
  }).catch(() => {});
}

function applyCourse(id, def) {
  loading = false;
  const wd = def && def.worldDef;
  if (!wd || !wd.prims || !wd.targets || !wd.spawn) {
    logOnce('course:' + id, 'worldDef missing');
    failCourse();
    return;
  }
  const issues = call(coursesMod, 'validateCourse', def);
  if (issues && issues.length) logOnce('validate:' + id, issues.join(' | '));

  call(renderer, 'compileWorld', wd);

  let nextSim = null;
  try {
    nextSim = simMod.createSim(wd, constants);
  } catch (err) {
    nextSim = null;
    logOnce('createSim', err);
  }
  if (!nextSim || !isFn(nextSim.tick) || !isFn(nextSim.getState)) {
    failCourse();
    return;
  }

  sim = nextSim;
  course = def;
  courseId = id;
  world = wd;
  targetTotal = wd.targets.length;
  worldReady = true;
  ghostData = null;
  ghostBytes = null;
  setCourseError(false);
  saveCoursePref(id);

  const i = courseIds.indexOf(id);
  if (i >= 0 && !pendingId) {
    selIndex = i;
    markSel();
  }
  applyCourseUi();
  updateRow(id);
  updateRaceBtn();
  loadBestFor(id);
  loadGhostFor(id);
  resetRunCore();
  if (dom.boot) dom.boot.hidden = true;
  if (state !== 'failed') setState('ready');
  showOverlays();
  onResize();
  drainPending();
}

function loadCourseById(id, remember) {
  if (!id) return;
  loading = true;
  setCourseError(false);
  setHint(COPY.selectLoading || '');
  const seq = ++loadSeq;
  const p = promiseCall(coursesMod, 'loadCourse', id);
  if (!p) {
    failCourse();
    return;
  }
  if (remember) saveCoursePref(id);
  p.then((def) => {
    if (seq !== loadSeq) return;
    applyCourse(id, def);
  }).catch((err) => {
    if (seq !== loadSeq) return;
    logOnce('loadCourse', err);
    failCourse();
  });
}

function pickCourse(id) {
  if (!id) return;
  if (loading) {
    pendingId = id;
    return;
  }
  if (id === courseId && worldReady) {
    applyCourseUi();
    return;
  }
  loadCourseById(id, true);
}

function nextCourse() {
  const i = courseIds.indexOf(courseId);
  if (i < 0 || i + 1 >= courseIds.length) return;
  const id = courseIds[i + 1];
  selIndex = i + 1;
  markSel();
  pickCourse(id);
}

function toggleRace() {
  raceGhost = !raceGhost;
  updateRaceBtn();
  if (!raceGhost) scene.ghost.active = false;
  if (raceGhost && !ghostData) setGhostMsg(COPY.ghostNone || '');
}

function downloadBlob(name, blob) {
  let url = '';
  try {
    url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      if (a.parentNode) a.parentNode.removeChild(a);
      URL.revokeObjectURL(url);
    }, 120);
  } catch (err) {
    logOnce('download', err);
  }
}

function shareGhost() {
  if (!ghostData) {
    setGhostMsg(COPY.ghostNone || '');
    return;
  }
  let bytes = ghostBytes;
  if (!bytes && isFn(ghostMod.serialize)) {
    try {
      bytes = ghostMod.serialize(ghostData);
    } catch (err) {
      bytes = null;
      logOnce('serialize', err);
    }
  }
  if (!bytes) {
    setGhostMsg(COPY.ghostBadFile || '');
    return;
  }
  ghostBytes = bytes;
  let blob = null;
  try {
    blob = new Blob([bytes], { type: 'application/octet-stream' });
  } catch (err) {
    blob = null;
    logOnce('blob', err);
  }
  if (!blob) return;
  const ms = Math.round(num(ghostData.durationMs, runMs));
  const name = 'phosphor-' + (courseId || 'course') + '-' + ms + 'ms.pghost';
  const ui = window.MentriaUI;
  if (ui && isFn(ui.shareFile)) {
    let p = null;
    try {
      p = ui.shareFile(name, blob);
    } catch (err) {
      p = null;
      logOnce('shareFile', err);
    }
    if (p && isFn(p.catch)) {
      p.catch(() => downloadBlob(name, blob));
      return;
    }
    if (p) return;
  }
  downloadBlob(name, blob);
}

function readGhostFile(file) {
  if (!file || !isFn(ghostMod.parse)) {
    setGhostMsg(COPY.ghostBadFile || '');
    return;
  }
  let reader = null;
  try {
    reader = new FileReader();
  } catch (_) {
    reader = null;
  }
  if (!reader) {
    setGhostMsg(COPY.ghostBadFile || '');
    return;
  }
  reader.onload = () => {
    let bytes = null;
    let d = null;
    try {
      bytes = new Uint8Array(reader.result);
      d = ghostMod.parse(bytes);
    } catch (err) {
      d = null;
      logOnce('parse', err);
    }
    if (!d) {
      setGhostMsg(COPY.ghostBadFile || '');
      return;
    }
    if (typeof d.courseId === 'string' && d.courseId && d.courseId !== courseId) {
      setGhostMsg(COPY.ghostWrongCourse || '');
      return;
    }
    ghostData = d;
    ghostBytes = bytes;
    raceGhost = true;
    updateRaceBtn();
    setGhostMsg(COPY.ghostImported || '');
  };
  reader.onerror = () => setGhostMsg(COPY.ghostBadFile || '');
  try {
    reader.readAsArrayBuffer(file);
  } catch (err) {
    logOnce('readGhost', err);
    setGhostMsg(COPY.ghostBadFile || '');
  }
}

function onResize() {
  if (!dom.canvas) return;
  const w = dom.canvas.clientWidth || dom.stage.clientWidth || 1280;
  const h = dom.canvas.clientHeight || dom.stage.clientHeight || 720;
  if (w > 0 && h > 0) {
    aspect = w / h;
    viewH = h;
  }
  hudCache.gap = -1;
  call(renderer, 'resize');
}

function fullscreenSupported() {
  const el = dom.stage;
  if (!el) return false;
  return isFn(el.requestFullscreen) || isFn(el.webkitRequestFullscreen);
}

function setAutoNote(text) {
  if (devAutoEl) devAutoEl.textContent = text || '';
}

function applyQuality(v) {
  const q = clamp(Math.round(v * 100) / 100, AQ_FLOOR, 1);
  if (q === settings.quality) return false;
  settings.quality = q;
  scene.quality.scale = q;
  onResize();
  setAutoNote('auto quality ' + q.toFixed(1));
  return true;
}

function adaptQuality(now) {
  if (!autoQuality || state !== 'playing' || !(fpsValue > 0)) {
    qualityLowSince = 0;
    qualityHighSince = 0;
    return;
  }
  if (fpsValue < AQ_LOW_FPS) {
    qualityHighSince = 0;
    if (!qualityLowSince) qualityLowSince = now;
    else if (now - qualityLowSince >= AQ_LOW_MS) {
      qualityLowSince = now;
      if (settings.quality > AQ_FLOOR) applyQuality(settings.quality - AQ_STEP);
    }
    return;
  }
  if (fpsValue >= AQ_HIGH_FPS) {
    qualityLowSince = 0;
    if (!qualityHighSince) qualityHighSince = now;
    else if (now - qualityHighSince >= AQ_HIGH_MS) {
      qualityHighSince = now;
      if (settings.quality < qualityCap) applyQuality(Math.min(qualityCap, settings.quality + AQ_STEP));
    }
    return;
  }
  qualityLowSince = 0;
  qualityHighSince = 0;
}

function toggleFullscreen() {
  const el = dom.stage;
  if (!el || !fullscreenSupported()) return;
  const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
  if (fsEl) {
    if (isFn(document.exitFullscreen)) document.exitFullscreen().catch(() => {});
    else if (isFn(document.webkitExitFullscreen)) document.webkitExitFullscreen();
    return;
  }
  if (isFn(el.requestFullscreen)) {
    const p = el.requestFullscreen({ navigationUI: 'hide' });
    if (p && isFn(p.catch)) p.catch(() => {});
  } else if (isFn(el.webkitRequestFullscreen)) {
    el.webkitRequestFullscreen();
  }
}

function askGyro() {
  if (!input || !isFn(input.enableGyro)) return;
  if (call(input, 'gyroEnabled')) {
    call(input, 'disableGyro');
    if (dom.gyro) {
      dom.gyro.textContent = dom.gyroLabel || '';
      dom.gyro.disabled = false;
    }
    return;
  }
  let p = null;
  try {
    p = input.enableGyro();
  } catch (_) {
    p = null;
  }
  if (!p || !isFn(p.then)) return;
  p.then((ok) => {
    if (!dom.gyro) return;
    dom.gyro.textContent = ok ? COPY.gyroOn || dom.gyroLabel : COPY.gyroDenied || dom.gyroLabel;
  }).catch(() => {
    if (dom.gyro) dom.gyro.textContent = COPY.gyroDenied || dom.gyroLabel;
  });
}

function devRange(key, value) {
  const v = Math.abs(num(value, 1));
  if (v <= 0.05) return { min: 0, max: 0.2, step: 0.0005 };
  if (v <= 1) return { min: 0, max: Math.max(2, v * 3), step: 0.01 };
  if (v <= 10) return { min: 0, max: v * 3, step: 0.05 };
  if (v <= 100) return { min: 0, max: v * 3, step: 0.5 };
  return { min: 0, max: v * 3, step: 5 };
}

function devRow(parent, label, min, max, step, get, set) {
  const row = document.createElement('label');
  row.className = 'ph-dev__row';
  const name = document.createElement('span');
  name.className = 'ph-dev__k';
  name.textContent = label;
  const range = document.createElement('input');
  range.type = 'range';
  range.className = 'ph-dev__range';
  range.min = String(min);
  range.max = String(max);
  range.step = String(step);
  range.value = String(get());
  const numIn = document.createElement('input');
  numIn.type = 'number';
  numIn.className = 'ph-dev__num';
  numIn.step = String(step);
  numIn.value = String(get());
  range.addEventListener('input', () => {
    const v = parseFloat(range.value);
    if (v === v) {
      set(v);
      numIn.value = range.value;
    }
  });
  numIn.addEventListener('input', () => {
    const v = parseFloat(numIn.value);
    if (v === v) {
      set(v);
      range.value = numIn.value;
    }
  });
  row.appendChild(name);
  row.appendChild(range);
  row.appendChild(numIn);
  parent.appendChild(row);
}

function devSection(parent, title) {
  const h = document.createElement('p');
  h.className = 'ph-dev__sec';
  h.textContent = title;
  parent.appendChild(h);
}

function copyConstants() {
  let text = '';
  try {
    const out = {};
    const keys = Object.keys(constants).sort();
    for (let i = 0; i < keys.length; i++) out[keys[i]] = constants[keys[i]];
    out.fov = settings.fov;
    out.quality = settings.quality;
    out.course = courseId;
    out.sensitivity = { mnk: sens.mnk, pad: sens.pad, touch: sens.touch, gyro: sens.gyro, adsMul: sens.adsMul };
    out.audio = { master: levels.master, sfx: levels.sfx, ambient: levels.ambient };
    text = JSON.stringify(out, null, 2);
  } catch (_) {
    text = '{}';
  }
  const done = (ok) => {
    if (devStatus) devStatus.textContent = ok ? 'copied' : 'copy blocked';
  };
  try {
    if (navigator.clipboard && isFn(navigator.clipboard.writeText)) {
      navigator.clipboard.writeText(text).then(() => done(true)).catch(() => done(legacyCopy(text)));
      return;
    }
  } catch (_) {}
  done(legacyCopy(text));
}

function legacyCopy(text) {
  let ok = false;
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', 'readonly');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    ok = document.execCommand('copy');
    document.body.removeChild(ta);
  } catch (_) {
    ok = false;
  }
  return ok;
}

const PADMAP_KEY = 'phosphor_padmap_v1';
const padMap = { fireB: -1, fireA: -1, adsB: -1, adsA: -1, pauseB: -1, sprintB: -1, ryAxis: -1 };
const GYRO_SMOOTH_MAX = 0.95;
const TOUCH_SMOOTH_MAX = 0.5;
const look = { gyroSmooth: 0.5, touchSmooth: 0.35, gyroPolarity: 1 };

function loadPadMap() {
  try {
    const raw = localStorage.getItem(PADMAP_KEY);
    if (!raw) return;
    const o = JSON.parse(raw);
    for (const k in padMap) {
      if (typeof o[k] === 'number' && isFinite(o[k])) padMap[k] = Math.round(o[k]);
    }
    const lk = o.look;
    if (lk && typeof lk === 'object') {
      if (typeof lk.gyroSmooth === 'number' && isFinite(lk.gyroSmooth)) look.gyroSmooth = clamp(lk.gyroSmooth, 0, GYRO_SMOOTH_MAX);
      if (typeof lk.touchSmooth === 'number' && isFinite(lk.touchSmooth)) look.touchSmooth = clamp(lk.touchSmooth, 0, TOUCH_SMOOTH_MAX);
      if (typeof lk.gyroPolarity === 'number' && isFinite(lk.gyroPolarity)) look.gyroPolarity = lk.gyroPolarity < 0 ? -1 : 1;
    }
    call(input, 'setPadOverrides', padMap);
    pushSens();
  } catch (_) {}
}

function savePadMap() {
  call(input, 'setPadOverrides', padMap);
  try {
    const out = Object.assign({}, padMap);
    out.look = { gyroSmooth: look.gyroSmooth, touchSmooth: look.touchSmooth, gyroPolarity: look.gyroPolarity };
    localStorage.setItem(PADMAP_KEY, JSON.stringify(out));
  } catch (_) {}
}

function bindPadControl(which, done) {
  call(input, 'capturePadButton', (hit) => {
    if (!hit) return;
    if (which === 'fire') {
      padMap.fireB = hit.kind === 'button' ? hit.index : -1;
      padMap.fireA = hit.kind === 'axis' ? hit.index : -1;
    } else if (which === 'ads') {
      padMap.adsB = hit.kind === 'button' ? hit.index : -1;
      padMap.adsA = hit.kind === 'axis' ? hit.index : -1;
    } else if (which === 'pause' && hit.kind === 'button') {
      padMap.pauseB = hit.index;
    } else if (which === 'sprint' && hit.kind === 'button') {
      padMap.sprintB = hit.index;
    }
    savePadMap();
    if (isFn(done)) done(hit);
  });
}

function pushSens() {
  if (!input) return;
  const base = input.defaults && typeof input.defaults.mnk === 'number'
    ? input.defaults
    : { mnk: 0.0022, pad: 2.6, touch: 0.004, gyro: 0.7 };
  call(input, 'setSensitivity', {
    mnk: base.mnk * sens.mnk,
    pad: base.pad * sens.pad,
    touch: base.touch * sens.touch,
    gyro: base.gyro * sens.gyro,
    adsMul: sens.adsMul,
    touchSmooth: look.touchSmooth,
    gyroSmooth: look.gyroSmooth,
    gyroPolarity: look.gyroPolarity
  });
}

function pushLevels() {
  call(audio, 'setLevels', levels);
}

function buildDevPanel() {
  if (!dom.stage) return;
  const panel = document.createElement('div');
  panel.className = 'ph-dev';
  panel.hidden = true;

  const head = document.createElement('div');
  head.className = 'ph-dev__head';
  const title = document.createElement('span');
  title.textContent = 'tuning';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'ph-dev__x';
  close.textContent = 'x';
  close.addEventListener('click', () => toggleDev(false));
  head.appendChild(title);
  head.appendChild(close);
  panel.appendChild(head);

  const body = document.createElement('div');
  body.className = 'ph-dev__body';
  panel.appendChild(body);

  devSection(body, 'course');
  const courseRow = document.createElement('label');
  courseRow.className = 'ph-dev__row ph-dev__row--wide';
  const courseK = document.createElement('span');
  courseK.className = 'ph-dev__k';
  courseK.textContent = 'load';
  devCourseSel = document.createElement('select');
  devCourseSel.className = 'ph-dev__num ph-dev__sel';
  for (let i = 0; i < courseIds.length; i++) {
    const opt = document.createElement('option');
    opt.value = courseIds[i];
    opt.textContent = courseIds[i] + ' · ' + courseName(null, courseIds[i]);
    devCourseSel.appendChild(opt);
  }
  devCourseSel.addEventListener('change', () => {
    const id = devCourseSel.value;
    const i = courseIds.indexOf(id);
    if (i >= 0) {
      selIndex = i;
      markSel();
    }
    pickCourse(id);
    if (devStatus) devStatus.textContent = 'loading ' + id;
  });
  courseRow.appendChild(courseK);
  courseRow.appendChild(devCourseSel);
  body.appendChild(courseRow);

  devSection(body, 'sim constants');
  const keys = Object.keys(constants).sort();
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (typeof constants[key] !== 'number') continue;
    const r = devRange(key, constants[key]);
    devRow(body, key, r.min, r.max, r.step, () => constants[key], (v) => {
      constants[key] = v;
    });
  }

  devSection(body, 'camera');
  devRow(body, 'fov (hip, deg)', 90, 110, 1, () => settings.fov, (v) => {
    settings.fov = v;
  });

  devSection(body, 'sensitivity');
  devRow(body, 'mnk', 0.05, 4, 0.01, () => sens.mnk, (v) => {
    sens.mnk = v;
    pushSens();
  });
  devRow(body, 'pad', 0.05, 4, 0.01, () => sens.pad, (v) => {
    sens.pad = v;
    pushSens();
  });
  devRow(body, 'touch', 0.05, 4, 0.01, () => sens.touch, (v) => {
    sens.touch = v;
    pushSens();
  });
  devRow(body, 'gyro', 0.05, 4, 0.01, () => sens.gyro, (v) => {
    sens.gyro = v;
    pushSens();
  });
  devRow(body, 'ads mul', 0.2, 1.2, 0.01, () => sens.adsMul, (v) => {
    sens.adsMul = v;
    pushSens();
  });
  devRow(body, 'gyro smooth', 0, GYRO_SMOOTH_MAX, 0.01, () => look.gyroSmooth, (v) => {
    look.gyroSmooth = clamp(v, 0, GYRO_SMOOTH_MAX);
    pushSens();
  });
  devRow(body, 'touch smooth', 0, TOUCH_SMOOTH_MAX, 0.01, () => look.touchSmooth, (v) => {
    look.touchSmooth = clamp(v, 0, TOUCH_SMOOTH_MAX);
    pushSens();
  });

  const polRow = document.createElement('div');
  polRow.className = 'ph-dev__foot';
  const polBtn = document.createElement('button');
  polBtn.type = 'button';
  const polLabel = () => 'gyro polarity: ' + (look.gyroPolarity < 0 ? 'inverted' : 'normal');
  polBtn.textContent = polLabel();
  polBtn.addEventListener('click', () => {
    look.gyroPolarity = look.gyroPolarity < 0 ? 1 : -1;
    pushSens();
    savePadMap();
    polBtn.textContent = polLabel();
    if (devStatus) devStatus.textContent = polLabel();
  });
  polRow.appendChild(polBtn);
  body.appendChild(polRow);

  devSection(body, 'gamepad');
  padDebugEl = document.createElement('div');
  padDebugEl.className = 'ph-dev__pad';
  body.appendChild(padDebugEl);
  const bindRow = document.createElement('div');
  bindRow.className = 'ph-dev__foot';
  const mkBind = (label, which) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = 'bind ' + label;
    b.addEventListener('click', () => {
      if (devStatus) devStatus.textContent = 'press the pad control for ' + label + '…';
      bindPadControl(which, (hit) => {
        if (devStatus) devStatus.textContent = label + ' = ' + (hit.kind === 'axis' ? 'axis ' : 'b') + hit.index;
      });
    });
    bindRow.appendChild(b);
  };
  mkBind('fire', 'fire');
  mkBind('ads', 'ads');
  mkBind('pause', 'pause');
  mkBind('sprint', 'sprint');
  const ryBtn = document.createElement('button');
  ryBtn.type = 'button';
  const ryLabel = () => 'ry: ' + (padMap.ryAxis < 0 ? 'auto' : 'a' + padMap.ryAxis);
  ryBtn.textContent = ryLabel();
  ryBtn.addEventListener('click', () => {
    padMap.ryAxis = padMap.ryAxis >= 5 ? -1 : padMap.ryAxis < 3 ? 3 : padMap.ryAxis + 1;
    savePadMap();
    ryBtn.textContent = ryLabel();
  });
  bindRow.appendChild(ryBtn);
  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.textContent = 'clear binds';
  clearBtn.addEventListener('click', () => {
    for (const k in padMap) padMap[k] = -1;
    savePadMap();
    ryBtn.textContent = ryLabel();
    if (devStatus) devStatus.textContent = 'pad binds cleared';
  });
  bindRow.appendChild(clearBtn);
  body.appendChild(bindRow);

  devSection(body, 'render');
  devRow(body, 'quality scale', 0.5, 1, 0.05, () => settings.quality, (v) => {
    settings.quality = clamp(v, AQ_FLOOR, 1);
    scene.quality.scale = settings.quality;
    qualityCap = settings.quality;
    autoQuality = false;
    qualityLowSince = 0;
    qualityHighSince = 0;
    setAutoNote('auto quality off · manual ' + settings.quality.toFixed(2));
    onResize();
  });
  devAutoEl = document.createElement('div');
  devAutoEl.className = 'ph-dev__k';
  body.appendChild(devAutoEl);
  devRow(body, 'glitch test', 0, 1, 0.01, () => settings.glitchTest, (v) => {
    settings.glitchTest = clamp(v, 0, 1);
  });

  devSection(body, 'audio');
  devRow(body, 'master', 0, 1, 0.01, () => levels.master, (v) => {
    levels.master = clamp(v, 0, 1);
    pushLevels();
  });
  devRow(body, 'sfx', 0, 1, 0.01, () => levels.sfx, (v) => {
    levels.sfx = clamp(v, 0, 1);
    pushLevels();
  });
  devRow(body, 'ambient', 0, 1, 0.01, () => levels.ambient, (v) => {
    levels.ambient = clamp(v, 0, 1);
    pushLevels();
  });

  const foot = document.createElement('div');
  foot.className = 'ph-dev__foot';
  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'ph-dev__btn';
  copyBtn.textContent = 'copy JSON';
  copyBtn.addEventListener('click', copyConstants);
  const restartBtn = document.createElement('button');
  restartBtn.type = 'button';
  restartBtn.className = 'ph-dev__btn';
  restartBtn.textContent = 'restart run';
  restartBtn.addEventListener('click', resetRun);
  devStatus = document.createElement('span');
  devStatus.className = 'ph-dev__status';
  foot.appendChild(copyBtn);
  foot.appendChild(restartBtn);
  foot.appendChild(devStatus);
  panel.appendChild(foot);

  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'ph-devchip';
  chip.textContent = 'dev';
  chip.addEventListener('click', () => toggleDev(!devOpen));

  dom.stage.appendChild(panel);
  dom.stage.appendChild(chip);
  devPanel = panel;
}

function toggleDev(open) {
  devOpen = !!open;
  if (devPanel) devPanel.hidden = !devOpen;
  if (devOpen) {
    if (devStatus) devStatus.textContent = '';
    if (devCourseSel && courseId) devCourseSel.value = courseId;
    if (state === 'playing') pauseGame(null);
  }
}

function inDevPanel(node) {
  if (!devPanel || !node || !isFn(node.closest)) return false;
  return devPanel.contains(node);
}

function onKeyDown(e) {
  if (state === 'failed') return;
  if (inDevPanel(e.target)) {
    if (e.code === 'Backquote') {
      e.preventDefault();
      toggleDev(false);
    }
    return;
  }
  const tag = e.target && e.target.tagName ? e.target.tagName : '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.code === 'Backquote') {
    e.preventDefault();
    toggleDev(!devOpen);
    return;
  }
  if (e.code === 'KeyF') {
    e.preventDefault();
    toggleFullscreen();
    return;
  }
  if (state === 'ready' && (e.code === 'ArrowUp' || e.code === 'ArrowDown')) {
    e.preventDefault();
    return;
  }
  if (e.code === 'Enter' || e.code === 'Space') {
    if (state === 'ready') {
      e.preventDefault();
      firstGesture();
    } else if (state === 'complete') {
      e.preventDefault();
      resetRun();
    }
  }
}

function frame(now) {
  rafId = requestAnimationFrame(frame);
  let dt = (now - lastNow) / 1000;
  lastNow = now;
  if (!(dt > 0)) dt = 0;
  if (dt > MAX_FRAME) dt = MAX_FRAME;

  fpsFrames++;
  if (now - fpsWindowStart >= 1000) {
    fpsValue = Math.round((fpsFrames * 1000) / (now - fpsWindowStart));
    fpsFrames = 0;
    fpsWindowStart = now;
  }
  adaptQuality(now);

  const polled = input ? call(input, 'poll', dt) : null;
  const it = copyIntents(polled);

  let startedNow = false;
  if (state === 'ready' && (it.fireHeld || it.jumpPressed || it.pausePressed)) {
    firstGesture();
    startedNow = state === 'playing';
  }
  if (state === 'ready' && !startedNow) menuNav(it);
  else if (state !== 'ready') menuAxis = 0;

  if (it.restartPressed && (state === 'playing' || state === 'paused' || state === 'complete')) resetRun();
  if (it.pausePressed && !startedNow) {
    if (state === 'playing') pauseGame(null);
    else if (state === 'paused' && !devOpen) resumeGame();
  }

  if (state === 'playing') {
    ageFx(dt);
    startRunTimerIfMoving();
    acc += dt;
    let ticks = 0;
    let first = true;
    while (acc >= FIXED && ticks < MAX_TICKS) {
      routeEvents(call(sim, 'tick', it, FIXED));
      acc -= FIXED;
      ticks++;
      if (first) {
        it.jumpPressed = false;
        it.reloadPressed = false;
        it.restartPressed = false;
        it.pausePressed = false;
        first = false;
      }
    }
    if (acc > FIXED * MAX_TICKS) acc = 0;
    if (runActive) runMs += dt * 1000;
    call(sim, 'applyLook', it.lookDx, it.lookDy);
  }

  const st = sim ? call(sim, 'getState') : null;
  if (st && st.pos && num(st.pos[1], 0) < -8 && state === 'playing') resetRun();
  if (recorder && st && state === 'playing' && runActive && !runDone) call(recorder, 'sample', st, runMs);
  assembleScene(st, dt);
  updateGhost();
  collectFx();
  updateHud(st, now);
  if (devOpen && padDebugEl) {
    const pi = call(input, 'padInfo');
    const line = pi
      ? pi.id + ' [' + (pi.mapping || 'nonstd') + '] ry:a' + pi.ry + ' axes ' + pi.axes.join(' ') + (pi.pressed.length ? ' pressed b' + pi.pressed.join(' b') : '')
      : 'no gamepad detected';
    if (line !== padDebugLast) {
      padDebugLast = line;
      padDebugEl.textContent = line;
    }
  }

  if (audio) {
    const sp = clamp(Math.max(0, num(st && st.speed, 0)) / Math.max(0.1, num(constants.sprint, 6.7)), 0, 1);
    call(audio, 'setListener', scene.camera.pos, scene.camera.yaw, sp);
  }

  if (worldReady) call(renderer, 'render', scene, dt);

  if (state === 'playing' && !runDone && targetTotal > 0 && downCount >= targetTotal) completeRun();
}

function wireUi() {
  if (dom.ready) {
    dom.ready.addEventListener('pointerdown', (e) => {
      const t = e.target;
      if (t && t === dom.gyro) return;
      if (dom.sel && t && dom.sel.contains(t)) return;
      firstGesture();
    });
  }
  if (dom.readyStart) {
    dom.readyStart.addEventListener('click', (e) => {
      e.stopPropagation();
      firstGesture();
    });
  }
  if (dom.canvas) {
    dom.canvas.addEventListener('pointerdown', () => {
      if (state === 'ready') firstGesture();
      else if (state === 'playing' && !touchDevice && input && !call(input, 'isLocked')) call(input, 'requestPointerLock');
    });
  }
  if (dom.resume) dom.resume.addEventListener('click', resumeGame);
  if (dom.pauseRestart) dom.pauseRestart.addEventListener('click', resetRun);
  if (dom.completeRestart) dom.completeRestart.addEventListener('click', resetRun);
  if (dom.completeNext) dom.completeNext.addEventListener('click', nextCourse);
  if (dom.pauseCourses) dom.pauseCourses.addEventListener('click', backToSelect);
  if (dom.completeCourses) dom.completeCourses.addEventListener('click', backToSelect);
  if (dom.raceBtn) dom.raceBtn.addEventListener('click', toggleRace);
  if (dom.shareBtn) dom.shareBtn.addEventListener('click', shareGhost);
  if (dom.importBtn && dom.ghostFile) {
    dom.importBtn.addEventListener('click', () => {
      try { dom.ghostFile.click(); } catch (_) {}
    });
    dom.ghostFile.addEventListener('change', () => {
      const files = dom.ghostFile.files;
      const f = files && files.length ? files[0] : null;
      readGhostFile(f);
      try { dom.ghostFile.value = ''; } catch (_) {}
    });
  }
  if (dom.pauseBtn) {
    dom.pauseBtn.addEventListener('click', () => {
      if (state === 'playing') pauseGame(null);
      else if (state === 'paused') resumeGame();
    });
  }
  if (dom.fs) {
    if (fullscreenSupported()) {
      dom.fs.hidden = false;
      dom.fs.addEventListener('click', toggleFullscreen);
    } else {
      dom.fs.hidden = true;
    }
  }
  if (dom.gyro) {
    dom.gyro.addEventListener('click', (e) => {
      e.stopPropagation();
      askGyro();
    });
  }
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  document.addEventListener('fullscreenchange', onResize);
  document.addEventListener('webkitfullscreenchange', onResize);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (state === 'playing') pauseGame(null);
      return;
    }
    if (state === 'playing' || state === 'paused') call(audio, 'unlock');
  });
}

function boot() {
  grabDom();
  if (!dom.stage || !dom.canvas) {
    fail('stage or canvas element missing');
    return;
  }
  touchDevice = false;
  try {
    touchDevice = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  } catch (_) {
    touchDevice = 'ontouchstart' in window;
  }
  settings.quality = touchDevice ? 0.8 : 1;
  scene.quality.scale = settings.quality;
  qualityCap = settings.quality;
  if (dom.readyClick) dom.readyClick.hidden = touchDevice;
  if (dom.readyStart) dom.readyStart.hidden = !touchDevice;

  if (!isFn(rendererMod.createRenderer)) {
    fail('renderer.js: createRenderer export missing');
    return;
  }
  if (!isFn(simMod.createSim)) {
    fail('sim.js: createSim export missing');
    return;
  }

  try {
    renderer = rendererMod.createRenderer(dom.canvas);
  } catch (err) {
    fail(err && err.message ? err.message : String(err));
    return;
  }
  if (!renderer) {
    fail('renderer.js: createRenderer returned nothing');
    return;
  }

  constants = simMod.CONSTANTS && typeof simMod.CONSTANTS === 'object' ? simMod.CONSTANTS : FALLBACK_CONSTANTS;

  if (isFn(audioMod.createAudio)) {
    try {
      audio = audioMod.createAudio();
    } catch (err) {
      audio = null;
      logOnce('createAudio', err);
    }
  } else {
    logOnce('audio.createAudio', 'export missing');
  }

  if (isFn(inputMod.createInput)) {
    try {
      input = inputMod.createInput(dom.stage, dom.canvas);
    } catch (err) {
      input = null;
      logOnce('createInput', err);
    }
  }
  if (!input || !isFn(input.poll)) {
    fail('input.js: createInput did not return poll()');
    return;
  }

  if (!isFn(coursesMod.loadCourse)) logOnce('courses.loadCourse', 'export missing');
  if (!isFn(ghostMod.createRecorder)) logOnce('ghost.createRecorder', 'export missing');

  pushSens();
  loadPadMap();
  try { window.mentriaPadCapture = true; } catch (_) {}
  if (audio) call(audio, 'setLevels', levels);

  if (isFn(renderer.onContextLost)) {
    call(renderer, 'onContextLost', () => {
      contextLost = true;
      if (state === 'playing') pauseGame(COPY.contextLost || null);
      else if (dom.pauseNote) dom.pauseNote.textContent = COPY.contextLost || '';
    });
  }
  if (isFn(renderer.onContextRestored)) {
    call(renderer, 'onContextRestored', () => {
      contextLost = false;
      hudCache.gap = -1;
      onResize();
      if (world) call(renderer, 'compileWorld', world);
    });
  }

  courseIds = resolveCourseIds();
  const startId = loadCoursePref();
  selIndex = Math.max(0, courseIds.indexOf(startId));

  buildSelect();
  for (let i = 0; i < courseIds.length; i++) loadBestFor(courseIds[i]);
  buildDevPanel();
  if (devCourseSel) devCourseSel.value = startId;
  wireUi();
  updateRaceBtn();
  onResize();
  showOverlays();

  loadCourseById(startId, false);

  lastNow = performance.now();
  fpsWindowStart = lastNow;
  rafId = requestAnimationFrame(frame);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
