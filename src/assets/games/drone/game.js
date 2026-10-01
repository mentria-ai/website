import * as THREE from 'three';
import * as KitEngine from '../kit/engine.js';
import * as KitQuality from '../kit/quality.js';
import * as KitInput from '../kit/input.js';
import * as KitAudio from '../kit/audio.js';
import * as KitRace from '../kit/race.js';
import * as KitStore from '../kit/store.js';
import * as KitUi from '../kit/ui.js';
import * as KitFx from '../kit/fx.js';
import { DEG, clamp } from '../kit/math.js';
import { createDrone, step as stepDrone, resetDrone, configureDrone, interpolateDrone, courseCheckpoints, createFlightBot, headingOf, gateFrame } from './flight.js';
import { courseById } from './courses.js';
import { createDroneMesh } from './mesh.js';
import { buildWorld, startYawToGate, gateFacing } from './world.js';
import { createHud, formatTime } from './hud.js';
import { createRings, ringStep, createGhostView, simulatePaceGhost, decodeGhostString, createGhostRecorder, createHeightAssist, buildDroneLayout, midStickThrottle, deadband } from './modes.js';

const SLUG = 'fpv-drone';
const NS = 'tool.fpv-drone.';
const KIT_NS = 'games.kit.';
const RACE_IDS = ['meadow', 'yard', 'canyon'];
const COUNTDOWN = 3;
const CRASH_HOLD = 1.2;
const RESPAWN_GRACE = 0.45;
const PENALTY = 2;
const STUCK_TIME = 2;
const FINISH_HOLD = 1.25;
const ART = '/assets/games/art/drone-key.webp';
const LOGO = '/assets/games/sprites/logo-skyrush.webp';
const DRONE_COLOR = 0x6ef3c5;
const GHOST_COLOR = 0xc79bff;
const CARD_HUES = { meadow: 78, yard: 205, canyon: 18 };
const TIPS = ['tip.angle', 'tip.acro', 'tip.chase', 'tip.ghost', 'tip.uptilt'];

const DEFAULTS = {
  mode: 'angle',
  assist: 'auto',
  rates: 'auto',
  tiltAcro: 38,
  tiltAngle: 28,
  fov: 78,
  view: 'fpv',
  invertPitch: false,
  stickMode: 2,
  stickSize: 1,
  quality: 'auto',
  volume: 0.8,
  ghost: true,
  coached: false
};

const RATE_SETS = {
  pro: {
    roll: { rc: 1.0, superRate: 0.7, expo: 0.2 },
    pitch: { rc: 1.0, superRate: 0.7, expo: 0.2 },
    yaw: { rc: 1.0, superRate: 0.7, expo: 0.2 }
  },
  beginner: {
    roll: { rc: 0.8, superRate: 0.55, expo: 0.35 },
    pitch: { rc: 0.8, superRate: 0.55, expo: 0.35 },
    yaw: { rc: 0.75, superRate: 0.45, expo: 0.3 }
  }
};

const IDLE_INPUT = { throttle: 0, roll: 0, pitch: 0, yaw: 0, mode: 'angle' };

const stage = document.getElementById('sk-stage');
const canvas = document.getElementById('sk-canvas');
const bootEl = document.getElementById('sk-boot');
const failEl = document.getElementById('sk-fail');
const failDetail = document.getElementById('sk-fail-detail');
const helpEl = document.getElementById('sk-help');
const params = new URLSearchParams(location.search);
const TEST = params.get('test') === '1';
const COPY = window.SKYRUSH_COPY || {};

function t(key) {
  const v = COPY[NS + key];
  return typeof v === 'string' ? v : key;
}

function kitText(key) {
  const v = COPY[KIT_NS + key];
  return typeof v === 'string' && v !== KIT_NS + key ? v : undefined;
}

function pick(map) {
  const out = {};
  for (const k in map) {
    const v = kitText(map[k]);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function kitCopies() {
  if (typeof KitUi.kitCopy === 'function') {
    try { return KitUi.kitCopy((k) => COPY[k]); } catch (_) {}
  }
  return null;
}

function uiCopy() {
  const kc = kitCopies();
  if (kc && kc.ui) return kc.ui;
  return pick({
    back: 'ui_back', select: 'ui_select', move: 'ui_move', confirm: 'ui_confirm', cancel: 'ui_cancel', go: 'ui_go',
    loading: 'ui_loading', best: 'ui_best', locked: 'ui_locked', newBest: 'ui_new_best', medalGold: 'medal_gold',
    medalSilver: 'medal_silver', medalBronze: 'medal_bronze', medalNone: 'medal_none', on: 'ui_on', off: 'ui_off',
    pause: 'ui_pause', fullscreen: 'ui_fullscreen', exitFullscreen: 'ui_exit_fullscreen', position: 'ui_position',
    time: 'ui_time', rotate: 'ui_rotate', rotateDismiss: 'ui_rotate_dismiss'
  });
}

function inputCopy() {
  const kc = kitCopies();
  if (kc && kc.input) return kc.input;
  return pick({ camera: 'input_camera', mode: 'input_mode', reset: 'input_reset', throttleYaw: 'input_throttle_yaw', pitchRoll: 'input_pitch_roll' });
}

function hudCopy() {
  return {
    time: t('hud.time'), gate: t('hud.gate'), rings: t('hud.rings'), speed: t('hud.speed'), alt: t('hud.alt'),
    kmh: t('hud.kmh'), meters: t('hud.meters'), throttle: t('hud.throttle'), secondsShort: t('hud.seconds')
  };
}

function medalLabel(m) {
  const k = m === 'gold' ? 'medal_gold' : m === 'silver' ? 'medal_silver' : m === 'bronze' ? 'medal_bronze' : 'medal_none';
  return kitText(k) || '';
}

function courseName(c) {
  return t('course.' + c.id);
}

function makeStore() {
  if (typeof KitStore.gameStore === 'function') {
    try { return KitStore.gameStore(SLUG, { defaults: DEFAULTS }); } catch (_) {}
  }
  const S = window.MentriaStore;
  const mem = new Map();
  const get = (k) => {
    try { if (S && S.get) return S.get('games', k); } catch (_) {}
    return mem.has(k) ? mem.get(k) : null;
  };
  const set = (k, v) => {
    try { if (S && S.set) return S.set('games', k, v); } catch (_) {}
    mem.set(k, v);
    return true;
  };
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  return {
    settings(extra) { return Object.assign({}, DEFAULTS, obj(extra), obj(get(SLUG + '.settings'))); },
    saveSettings(patch) {
      const next = Object.assign({}, obj(get(SLUG + '.settings')), obj(patch));
      set(SLUG + '.settings', next);
      return Object.assign({}, DEFAULTS, next);
    },
    records() { return obj(get(SLUG + '.records')); },
    record(id) { const r = obj(get(SLUG + '.records'))[id]; return r && typeof r === 'object' ? r : null; },
    saveRecord(id, rec) {
      const all = obj(get(SLUG + '.records'));
      const prev = all[id] && typeof all[id] === 'object' ? all[id] : null;
      const isBest = !prev || !(prev.time <= rec.time);
      const rank = { gold: 3, silver: 2, bronze: 1 };
      const medal = (rank[rec.medal] || 0) >= (rank[prev && prev.medal] || 0) ? rec.medal : prev.medal;
      all[id] = isBest ? Object.assign({}, rec, { medal, date: Date.now(), runs: ((prev && prev.runs) || 0) + 1 }) : Object.assign({}, prev, { medal, runs: ((prev && prev.runs) || 0) + 1 });
      set(SLUG + '.records', all);
      return { isBest, previous: prev, record: all[id] };
    },
    ghost(id) { const g = get(SLUG + '.ghost.' + id); return typeof g === 'string' && g ? g : null; },
    saveGhost(id, str) { return typeof str === 'string' && str.length < 60000 ? set(SLUG + '.ghost.' + id, str) : false; }
  };
}

const store = makeStore();
let settings = Object.assign({}, DEFAULTS, store.settings());

function saveSettings(patch) {
  Object.assign(settings, patch);
  try { store.saveSettings(patch); } catch (_) {}
}

function resolveQuality(pref) {
  if (pref === 'low' || pref === 'medium' || pref === 'high') return pref;
  try { if (typeof KitQuality.detectQuality === 'function') return KitQuality.detectQuality(); } catch (_) {}
  return 'medium';
}

function qualityPreset(q) {
  try {
    if (typeof KitQuality.qualityPreset === 'function') return KitQuality.qualityPreset(q);
    if (KitQuality.presets && KitQuality.presets[q]) return KitQuality.presets[q];
  } catch (_) {}
  return { drawDistance: q === 'low' ? 650 : q === 'high' ? 1800 : 1100 };
}

let engine = null;
let renderer = null;
let scene = null;
let camera = null;
let postFx = null;
let shake = null;
let ui = null;
let input = null;
let audio = null;
let hud = null;
let droneMesh = null;
let ghostView = null;
let world = null;
let worldCourseId = '';
let worldQuality = '';
let quality = 'medium';
let frameDt = 1 / 60;
let motorsVoice = null;
let windVoice = null;
let settingsFrom = 'main';
let loadToken = 0;
let lastMethod = 'keyboard';
const paceCache = new Map();

const drone = createDrone({ pos: [0, 0, 0] });
const heightAssist = createHeightAssist();
const physWorld = { heightAt: null, sphereVsWorld: null };
const flightInput = { throttle: 0, roll: 0, pitch: 0, yaw: 0, mode: 'angle' };

const run = {
  phase: 'boot',
  kind: 'race',
  course: null,
  cp: null,
  clock: null,
  penalty: 0,
  crashes: 0,
  splits: [],
  best: null,
  lastGate: -1,
  crashT: 0,
  crashReason: '',
  graceT: 0,
  stuckT: 0,
  finishT: 0,
  finalTime: 0,
  medal: null,
  saved: null,
  recorder: null,
  ghost: null,
  ghostPace: false,
  rings: null,
  safe: [],
  safeT: 0,
  kbThr: 0,
  coachStep: -1,
  coachT: 0,
  bot: null,
  autopilot: false,
  attract: null,
  time: 0,
  lightsT: -1
};

const rPos = { x: 0, y: 0, z: 0 };
const rQuat = { x: 0, y: 0, z: 0, w: 1 };
const tq = new THREE.Quaternion();
const tq2 = new THREE.Quaternion();
const tv = new THREE.Vector3();
const tv2 = new THREE.Vector3();
const tv3 = new THREE.Vector3();
const camPos = new THREE.Vector3();
const chaseDir = new THREE.Vector3(0, 0, -1);
const chaseGoal = new THREE.Vector3();
const X_AXIS = new THREE.Vector3(1, 0, 0);
const rayOrigin = { x: 0, y: 0, z: 0 };
const rayDir = { x: 0, y: 0, z: 0 };
let chaseSnap = true;

function methodNow() {
  try { return input ? input.method() : lastMethod; } catch (_) { return lastMethod; }
}

function assistOn() {
  if (settings.assist === 'on') return true;
  if (settings.assist === 'off') return false;
  return methodNow() !== 'gamepad';
}

function ratesName() {
  if (settings.rates === 'pro' || settings.rates === 'beginner') return settings.rates;
  return methodNow() === 'gamepad' ? 'pro' : 'beginner';
}

function flightMode() {
  return assistOn() ? 'angle' : (settings.mode === 'acro' ? 'acro' : 'angle');
}

function cameraTiltDeg() {
  if (run.autopilot) return settings.tiltAcro;
  return flightMode() === 'acro' ? settings.tiltAcro : settings.tiltAngle;
}

function modeLabel() {
  const m = flightMode();
  const base = t('mode.' + m);
  return assistOn() ? base + ' · ' + t('hud.assist') : base;
}

function applyDroneParams(forBot) {
  configureDrone(drone, { rates: RATE_SETS[forBot ? 'pro' : ratesName()] });
  if (droneMesh) droneMesh.setCameraTilt(cameraTiltDeg() * DEG);
}

function buildLayout() {
  return buildDroneLayout(KitInput.inputLayoutDrone, settings.stickMode);
}

function refreshInputLayout() {
  if (!input) return;
  try { input.setLayout(buildLayout()); } catch (err) { console.error('[skyrush] layout', err); }
}

function assistThrottle(dt) {
  const m = methodNow();
  const climb = m === 'keyboard' ? input.axis('climb') || 0 : deadband(((input.axis('throttle') || 0) - 0.5) * 2, m === 'touch' ? 0.18 : 0.1);
  return heightAssist.throttle(drone, climb, dt);
}

function manualThrottleStick(dt) {
  if (methodNow() !== 'keyboard') return input.axis('throttle') || 0;
  run.kbThr = clamp(run.kbThr + (input.axis('climb') || 0) * 0.75 * dt, 0, 1);
  return run.kbThr;
}

function readFlightInput(dt) {
  if (run.autopilot && run.bot) {
    const b = run.bot.control(drone, dt);
    flightInput.throttle = b.throttle;
    flightInput.roll = b.roll;
    flightInput.pitch = b.pitch;
    flightInput.yaw = b.yaw;
    flightInput.mode = 'acro';
    return flightInput;
  }
  const assist = assistOn();
  flightInput.mode = flightMode();
  flightInput.roll = input.axis('roll') || 0;
  flightInput.pitch = input.axis('pitch') || 0;
  flightInput.yaw = input.axis('yaw') || 0;
  flightInput.throttle = assist ? assistThrottle(dt) : midStickThrottle(manualThrottleStick(dt));
  return flightInput;
}

function inRun() {
  const p = run.phase;
  return p === 'countdown' || p === 'flying' || p === 'crashed' || p === 'finished';
}

function stateName() {
  if (engine && engine.paused && inRun()) return 'paused';
  const p = run.phase;
  if (p === 'flying') return run.kind === 'race' ? 'racing' : 'freestyle';
  if (p === 'crashed') return 'crashed';
  return p;
}

function setPhase(p) {
  run.phase = p;
  if (stage) stage.setAttribute('data-sk-phase', p);
}

function showBoot(on) {
  if (bootEl) bootEl.hidden = !on;
}

function fail(detail) {
  showBoot(false);
  if (failDetail) failDetail.textContent = String(detail || '');
  if (failEl) failEl.hidden = false;
}

function focusStage() {
  try { stage.focus({ preventScroll: true }); } catch (_) {}
}

function placeDroneOnStart() {
  const c = run.course;
  resetDrone(drone, { pos: c.start.pos, yaw: startYawToGate(c) });
  heightAssist.reset();
  run.kbThr = 0;
  chaseSnap = true;
}

function seedManualThrottle() {
  run.kbThr = drone.grounded ? 0 : 0.5;
  heightAssist.reset();
}

function unlockAudio() {
  if (!audio) return;
  try { audio.unlock(); } catch (_) {}
  if (!motorsVoice) {
    try { motorsVoice = audio.droneMotors ? audio.droneMotors({ volume: 0 }) : null; } catch (_) { motorsVoice = null; }
  }
  if (!windVoice) {
    try { windVoice = audio.wind ? audio.wind() : null; } catch (_) { windVoice = null; }
  }
}

function sfx(name, opts) {
  if (!audio) return;
  try { audio.play(name, opts); } catch (_) {}
}

function voicesVolume(v) {
  try { if (motorsVoice) motorsVoice.set({ volume: v }); } catch (_) {}
  try { if (windVoice) windVoice.set({ volume: v * 0.8 }); } catch (_) {}
}

function burst(kind, pos, dir, count, opts) {
  const p = world && world.particles;
  if (!p) return;
  try { p.burst(kind, pos, dir, count, opts); } catch (_) {}
}

async function ensureWorld(course) {
  const q = quality;
  if (world && worldCourseId === course.id && worldQuality === q) return world;
  const token = ++loadToken;
  if (world) {
    world.dispose();
    world = null;
    worldCourseId = '';
  }
  const tip = t(TIPS[Math.floor(Math.random() * TIPS.length)]);
  const info = { kicker: t('load.kicker'), title: courseName(course), tip, image: ART };
  ui.loading(0.01, t('load.building'), info);
  const w = await buildWorld(course, {
    scene,
    renderer,
    camera,
    quality: q,
    beforeCompile() {
      droneMesh.group.visible = true;
      ghostView.prime();
    },
    onProgress: (p, label) => {
      if (token !== loadToken) return;
      ui.loading(Math.min(0.99, p), label === 'shaders' || label === 'ready' ? t('load.shaders') : t('load.building'));
    }
  });
  ghostView.hide();
  droneMesh.group.visible = false;
  if (token !== loadToken) {
    w.dispose();
    return null;
  }
  world = w;
  worldCourseId = course.id;
  worldQuality = q;
  physWorld.heightAt = w.heightAt;
  physWorld.sphereVsWorld = w.sphereVsWorld;
  if (postFx && typeof postFx.setPreset === 'function') {
    try { postFx.setPreset(course.env.preset); } catch (_) {}
  }
  ui.loading(1);
  return w;
}

function bestRecord(id) {
  try { return store.record(id); } catch (_) { return null; }
}

function paceGhost(course) {
  if (!paceCache.has(course.id)) paceCache.set(course.id, simulatePaceGhost(course, physWorld, startYawToGate(course)));
  return paceCache.get(course.id);
}

function setupGhost() {
  run.ghost = null;
  run.ghostPace = false;
  if (run.kind !== 'race' || !settings.ghost) return;
  let str = null;
  try { str = store.ghost(run.course.id); } catch (_) {}
  run.ghost = decodeGhostString(str);
  if (!run.ghost && settings.coached) {
    run.ghost = paceGhost(run.course);
    run.ghostPace = !!run.ghost;
  }
}

function setupRun() {
  const c = run.course;
  run.penalty = 0;
  run.crashes = 0;
  run.splits = [];
  run.lastGate = -1;
  run.crashT = 0;
  run.graceT = 0;
  run.stuckT = 0;
  run.finishT = 0;
  run.finalTime = 0;
  run.medal = null;
  run.saved = null;
  run.time = 0;
  run.safe = [];
  run.safeT = 0;
  run.lightsT = -1;
  run.attract = null;
  run.bot = run.autopilot ? createFlightBot(c) : null;
  run.best = run.kind === 'race' ? bestRecord(c.id) : null;
  applyDroneParams(run.autopilot);
  placeDroneOnStart();
  world.gates.reset();
  hud.reset();
  hud.setKind(run.kind);
  hud.setView(settings.view);
  hud.setModeLabel(modeLabel());
  hud.show(true);
  if (run.kind === 'race') {
    run.cp = KitRace.createCheckpoints(courseCheckpoints(c));
    run.clock = KitRace.createRaceClock({ countdown: COUNTDOWN });
    run.clock.start();
    run.rings = null;
    world.gates.highlight(0);
    run.recorder = createGhostRecorder();
    setupGhost();
    if (world.startLights) world.startLights.set('off', 0);
    run.coachStep = settings.coached ? -1 : 0;
    setPhase('countdown');
  } else {
    run.cp = null;
    run.clock = null;
    run.recorder = null;
    run.ghost = null;
    run.rings = createRings(c);
    world.gates.highlight(-1);
    run.coachStep = -1;
    setPhase('flying');
  }
  run.coachT = 0;
  hud.coach(null);
  droneMesh.group.visible = settings.view === 'chase';
  ui.hide();
  focusStage();
  unlockAudio();
  voicesVolume(1);
  if (engine.paused) engine.pause(false);
}

async function startRun(courseId, kind) {
  const course = courseById(courseId);
  if (!course) return false;
  unlockAudio();
  setPhase('loading');
  run.kind = kind || (course.kind === 'freestyle' ? 'freestyle' : 'race');
  run.course = course;
  hud.show(false);
  let w = null;
  try {
    w = await ensureWorld(course);
  } catch (err) {
    console.error('[skyrush] world', err);
    ui.loading(1);
    ui.toast(t('load.error'), { tone: 'warn', ms: 4000 });
    goMenu();
    return false;
  }
  if (!w || run.course !== course) return false;
  setupRun();
  return true;
}

function restartRun() {
  if (!run.course || !world) return;
  if (run.kind === 'freestyle') {
    placeDroneOnStart();
    run.rings = createRings(run.course);
    run.safe = [];
    run.safeT = 0;
    run.stuckT = 0;
    run.graceT = 0;
    world.gates.reset();
    hud.reset();
    hud.setModeLabel(modeLabel());
    setPhase('flying');
    return;
  }
  setupRun();
}

function goMenu() {
  setPhase('menu');
  hud.show(false);
  hud.reset();
  voicesVolume(0);
  if (engine && engine.paused) engine.pause(false);
  startAttract();
  ui.show('main');
}

function goSelect() {
  setPhase('select');
  ui.show('courses', { cards: courseCards() });
}

function startAttract() {
  if (!world || !run.course) {
    run.attract = null;
    return;
  }
  run.autopilot = false;
  run.attract = createFlightBot(run.course);
  applyDroneParams(true);
  placeDroneOnStart();
  droneMesh.group.visible = true;
  ghostView.hide();
  world.gates.reset();
  world.gates.highlight(-1);
}

function stepAttract(dt) {
  if (!run.attract || !world) return;
  const b = run.attract.control(drone, dt);
  stepDrone(drone, b, dt, physWorld);
  const done = run.attract.index >= run.attract.line.count - 3;
  if (drone.crashed || done) {
    run.attract = createFlightBot(run.course);
    placeDroneOnStart();
  }
}

function stepCountdown(dt) {
  const evt = run.clock.step(dt);
  stepDrone(drone, IDLE_INPUT, dt, physWorld);
  if (evt.tick != null && evt.tick > 0) {
    ui.countdown(evt.tick);
    sfx('countdown');
    if (world.startLights) world.startLights.set('count', COUNTDOWN - evt.tick + 1);
  }
  if (evt.go) {
    ui.countdown(0);
    sfx('go');
    if (world.startLights) world.startLights.set('go', 3);
    run.lightsT = 2.2;
    run.time = 0;
    if (run.bot) run.bot.reset();
    if (run.recorder) run.recorder.push(0, drone.pos, drone.quat, [drone.rpm]);
    if (run.coachStep === 0) showCoach();
    setPhase('flying');
  }
}

function respawnPoint() {
  const c = run.course;
  if (run.kind === 'race') {
    const i = run.lastGate;
    if (i < 0) return { pos: [c.start.pos[0], c.start.pos[1], c.start.pos[2]], yaw: startYawToGate(c), grounded: true };
    const f = gateFrame(c.gates[i]);
    const x = f.pos.x + f.normal.x * 2.4;
    const z = f.pos.z + f.normal.z * 2.4;
    const ground = world.heightAt(x, z);
    const y = Math.max(f.pos.y + f.normal.y * 2.4, ground + 1.6);
    return { pos: [x, y, z], yaw: gateFacing(c, i), grounded: false };
  }
  const now = run.time;
  for (let k = run.safe.length - 1; k >= 0; k--) {
    const s = run.safe[k];
    if (now - s.t >= 1.2) return { pos: [s.x, s.y, s.z], yaw: s.yaw, grounded: false };
  }
  return { pos: [c.start.pos[0], c.start.pos[1], c.start.pos[2]], yaw: startYawToGate(c), grounded: true };
}

function respawn() {
  const p = respawnPoint();
  resetDrone(drone, { pos: p.pos, yaw: p.yaw, grounded: p.grounded, battery: false });
  if (!p.grounded) {
    const prm = drone.params;
    drone.motor = prm.idle + (1 - prm.idle) * prm.hoverThrottle;
    for (let i = 0; i < 4; i++) drone.motors[i] = drone.motor;
    run.graceT = RESPAWN_GRACE;
  }
  seedManualThrottle();
  run.stuckT = 0;
  chaseSnap = true;
  hud.clearCrash();
  setPhase('flying');
}

function onCrash(reason) {
  run.crashReason = reason || 'impact';
  run.crashes++;
  run.crashT = 0;
  if (run.kind === 'race') run.penalty += PENALTY;
  const pos = drone.pos;
  const n = drone.impactNormal || { x: 0, y: 1, z: 0 };
  const intensity = clamp((drone.crashSpeed || 6) / 14, 0.3, 1);
  burst('spark', pos, n, 26);
  burst('debris', pos, n, 10);
  burst('smoke', pos, n, 6);
  if (shake) shake.add(0.35 + 0.45 * intensity);
  if (settings.view === 'fpv') hud.videoStatic();
  sfx('crash', { intensity });
  const title = t(run.crashReason === 'flipped' ? 'crash.flipped' : 'crash.impact');
  hud.crash(title, run.kind === 'race' ? t('hud.penaltyNote').replace('{n}', String(PENALTY)) : '');
  setPhase('crashed');
}

function onGate(i) {
  const c = run.course;
  const total = run.clock.time + run.penalty;
  run.splits[i] = +total.toFixed(3);
  run.lastGate = i;
  world.gates.passed(i);
  const f = c.gates[i];
  const gp = { x: f.pos[0], y: f.pos[1], z: f.pos[2] };
  if (run.cp.finished) {
    onFinish(total, gp);
    return;
  }
  world.gates.highlight(run.cp.next);
  sfx('gate');
  burst('spark', gp, { x: 0, y: 1, z: 0 }, 10, { color: 0x6ef3c5 });
  const best = run.best && Array.isArray(run.best.splits) ? run.best.splits[i] : null;
  if (typeof best === 'number' && isFinite(best)) hud.split(total - best, t('hud.gate') + ' ' + (i + 1));
  if (run.coachStep >= 0 && run.coachStep < 3) {
    run.coachStep = 2;
    advanceCoach();
  }
}

function onFinish(total, gp) {
  run.finalTime = +total.toFixed(3);
  run.clock.finish();
  run.finishT = 0;
  sfx('finish');
  burst('confetti', gp, { x: 0, y: 1, z: 0 }, 140);
  if (shake) shake.add(0.12);
  hud.flash(t('hud.finish'), 1400);
  hud.coach(null);
  const medal = typeof KitRace.medalFor === 'function' ? KitRace.medalFor(run.finalTime, run.course.medals) : null;
  run.medal = medal;
  const prev = run.best;
  let saved = null;
  try { saved = store.saveRecord(run.course.id, { time: run.finalTime, medal, splits: run.splits.slice(), crashes: run.crashes }); } catch (_) { saved = null; }
  run.saved = { isBest: !!(saved && saved.isBest), prevTime: prev && typeof prev.time === 'number' ? prev.time : null };
  if (saved && saved.isBest && run.recorder) {
    try {
      run.recorder.push(run.time, drone.pos, drone.quat, [drone.rpm]);
      const enc = run.recorder.encode({ c: run.course.id, t: run.finalTime });
      if (enc && enc.length < 60000) store.saveGhost(run.course.id, enc);
    } catch (err) {
      console.error('[skyrush] ghost', err);
    }
  }
  if (!settings.coached && !run.autopilot) saveSettings({ coached: true });
  setPhase('finished');
}

function showResults() {
  setPhase('results');
  hud.show(false);
  voicesVolume(0);
  const c = run.course;
  const rows = [];
  const prevTime = run.saved && run.saved.prevTime != null ? run.saved.prevTime : null;
  const bestNow = prevTime == null ? run.finalTime : Math.min(prevTime, run.finalTime);
  rows.push({ label: kitText('ui_best') || '', value: formatTime(bestNow), good: run.saved && run.saved.isBest ? true : undefined });
  rows.push({ label: t('results.penalty'), value: '+' + run.penalty.toFixed(1) + ' ' + t('hud.seconds'), good: run.penalty === 0 ? true : undefined });
  rows.push({ label: t('results.crashes'), value: String(run.crashes) });
  if (c.medals) {
    const target = run.medal === 'gold' ? null : run.medal === 'silver' ? 'gold' : run.medal === 'bronze' ? 'silver' : 'bronze';
    if (target) rows.push({ label: medalLabel(target), value: formatTime(c.medals[target]) });
  }
  ui.show('results', {
    kicker: courseName(c),
    title: t('results.title'),
    time: run.finalTime,
    best: run.saved && run.saved.prevTime != null ? run.saved.prevTime : undefined,
    delta: undefined,
    isNewBest: !!(run.saved && run.saved.isBest),
    medal: run.medal || null,
    rows,
    focus: 'retry'
  });
}

function stepFlying(dt) {
  const c = run.course;
  if (run.clock) run.clock.step(dt);
  if (run.lightsT > 0) {
    run.lightsT -= dt;
    if (run.lightsT <= 0 && world.startLights) world.startLights.set('off', 0);
  }
  if (run.graceT > 0) {
    run.graceT -= dt;
    run.time += dt;
    readFlightInput(dt);
    drone.prevPos.x = drone.pos.x;
    drone.prevPos.y = drone.pos.y;
    drone.prevPos.z = drone.pos.z;
    drone.prevQuat.x = drone.quat.x;
    drone.prevQuat.y = drone.quat.y;
    drone.prevQuat.z = drone.quat.z;
    drone.prevQuat.w = drone.quat.w;
    return;
  }
  const inp = readFlightInput(dt);
  stepDrone(drone, inp, dt, physWorld);
  run.time += dt;
  if (run.kind === 'race') {
    const i = run.cp.test(drone.prevPos, drone.pos);
    if (i >= 0) onGate(i);
    if (run.phase !== 'flying') return;
    if (run.recorder) run.recorder.push(run.time, drone.pos, drone.quat, [drone.rpm]);
  } else if (run.rings) {
    const hit = ringStep(run.rings, drone.prevPos, drone.pos);
    if (hit >= 0) {
      world.gates.passed(hit);
      sfx(run.rings.done ? 'lap' : 'gate');
      const g = c.gates[hit];
      burst('spark', { x: g.pos[0], y: g.pos[1], z: g.pos[2] }, { x: 0, y: 1, z: 0 }, 10, { color: 0x6ef3c5 });
      if (run.rings.done) {
        hud.flash(t('hud.allRings'), 1800);
        burst('confetti', { x: g.pos[0], y: g.pos[1], z: g.pos[2] }, { x: 0, y: 1, z: 0 }, 120);
        run.rings = createRings(c);
        world.gates.reset();
      }
    }
    trackSafe(dt);
  }
  if (drone.crashed) {
    onCrash(drone.crashReason);
    return;
  }
  if (!drone.grounded && drone.contact && drone.speed < 0.7 && drone.tilt > 60 && drone.tilt < 115) run.stuckT += dt;
  else run.stuckT = 0;
  if (run.stuckT > STUCK_TIME) {
    onCrash('flipped');
    return;
  }
  const half = world.size / 2 - 12;
  if (Math.abs(drone.pos.x) > half || Math.abs(drone.pos.z) > half || drone.pos.y > 420 || drone.pos.y < -60) {
    onCrash('impact');
    return;
  }
  if (run.coachStep >= 0) stepCoach(dt);
}

function trackSafe(dt) {
  run.safeT -= dt;
  if (run.safeT > 0) return;
  run.safeT = 0.4;
  if (drone.altitude < 2.5 || drone.contact || drone.speed > 45) return;
  run.safe.push({ x: drone.pos.x, y: drone.pos.y, z: drone.pos.z, yaw: headingOf(drone.quat), t: run.time });
  if (run.safe.length > 12) run.safe.shift();
}

function stepCrashed(dt) {
  if (run.clock) run.clock.step(dt);
  stepDrone(drone, IDLE_INPUT, dt, physWorld);
  run.time += dt;
  run.crashT += dt;
  hud.crashProgress(run.crashT / CRASH_HOLD);
  if (run.crashT >= CRASH_HOLD) respawn();
}

function stepFinished(dt) {
  const inp = readFlightInput(dt);
  stepDrone(drone, drone.crashed ? IDLE_INPUT : inp, dt, physWorld);
  run.time += dt;
  run.finishT += dt;
  if (run.finishT >= FINISH_HOLD) showResults();
}

function coachText(stepIndex) {
  const keys = methodNow() === 'keyboard';
  if (stepIndex === 0) return t(keys ? 'coach.throttleKeys' : 'coach.throttleStick');
  if (stepIndex === 1) return t(keys ? 'coach.steerKeys' : 'coach.steerStick');
  if (stepIndex === 2) return t('coach.gate');
  return t('coach.done');
}

function showCoach() {
  if (run.coachStep < 0) return;
  if (run.coachStep >= 3) hud.coach(coachText(3), '');
  else hud.coach(coachText(run.coachStep), (run.coachStep + 1) + '/3');
}

function advanceCoach() {
  run.coachStep++;
  run.coachT = 0;
  showCoach();
}

function stepCoach(dt) {
  run.coachT += dt;
  const s = run.coachStep;
  if (s === 0 && !drone.grounded && drone.altitude > 1.4 && run.coachT > 0.8) advanceCoach();
  else if (s === 1 && Math.hypot(drone.vel.x, drone.vel.z) > 4.5 && run.coachT > 0.8) advanceCoach();
  else if (s === 3 && run.coachT > 3.2) {
    run.coachStep = -1;
    hud.coach(null);
  }
}

function handleButtons() {
  if (!input) return;
  if (run.phase === 'results') {
    if (input.button('restart').pressed && run.course) startRun(run.course.id, 'race');
    return;
  }
  if (!inRun()) return;
  if (input.button('camera').pressed) toggleView();
  if (input.button('mode').pressed) cycleFlightMode();
  if (input.button('restart').pressed) restartRun();
}

function toggleView() {
  const v = settings.view === 'chase' ? 'fpv' : 'chase';
  saveSettings({ view: v });
  applyView();
  hud.flash(t('view.' + v), 900);
}

function applyView() {
  hud.setView(settings.view);
  if (droneMesh) droneMesh.group.visible = !!world && (settings.view === 'chase' || run.phase === 'menu' || run.phase === 'select');
  chaseSnap = true;
}

function cycleFlightMode() {
  const assist = assistOn();
  const mode = flightMode();
  if (assist) saveSettings({ assist: 'off', mode: 'angle' });
  else if (mode === 'angle') saveSettings({ assist: 'off', mode: 'acro' });
  else saveSettings({ assist: 'on', mode: 'angle' });
  seedManualThrottle();
  applyDroneParams(run.autopilot);
  refreshInputLayout();
  hud.setModeLabel(modeLabel());
  hud.flash(modeLabel(), 1100);
}

function onStep(dt) {
  if (input) {
    try { input.update(dt); } catch (_) {}
  }
  handleButtons();
  const p = run.phase;
  if (p === 'countdown') stepCountdown(dt);
  else if (p === 'flying') stepFlying(dt);
  else if (p === 'crashed') stepCrashed(dt);
  else if (p === 'finished') stepFinished(dt);
  else if (p === 'menu' || p === 'select') stepAttract(dt);
}

function updateFpvCamera() {
  tq.set(rQuat.x, rQuat.y, rQuat.z, rQuat.w);
  const off = drone.params.cameraOffset;
  tv.set(off.x, off.y, off.z).applyQuaternion(tq);
  camera.position.set(rPos.x + tv.x, rPos.y + tv.y, rPos.z + tv.z);
  tq2.setFromAxisAngle(X_AXIS, cameraTiltDeg() * DEG);
  camera.quaternion.copy(tq).multiply(tq2);
}

function updateChaseCamera(dt) {
  const v = drone.vel;
  const hs = Math.sqrt(v.x * v.x + v.z * v.z);
  if (hs > 3) tv.set(v.x / hs, 0, v.z / hs);
  else {
    const h = headingOf(drone.quat);
    tv.set(-Math.sin(h), 0, -Math.cos(h));
  }
  const k = chaseSnap ? 1 : 1 - Math.exp(-3.2 * dt);
  chaseDir.lerp(tv, k);
  if (chaseDir.lengthSq() < 1e-6) chaseDir.set(0, 0, -1);
  chaseDir.normalize();
  const back = 1.75 + Math.min(1.1, drone.speed * 0.03);
  const rise = 0.5 + Math.min(0.3, drone.speed * 0.008);
  chaseGoal.set(rPos.x - chaseDir.x * back, rPos.y + rise, rPos.z - chaseDir.z * back);
  if (world) {
    const gy = world.heightAt(chaseGoal.x, chaseGoal.z) + 0.4;
    if (chaseGoal.y < gy) chaseGoal.y = gy;
  }
  if (chaseSnap) {
    camPos.copy(chaseGoal);
    chaseSnap = false;
  } else {
    camPos.set(chaseGoal.x, camPos.y + (chaseGoal.y - camPos.y) * (1 - Math.exp(-14 * dt)), chaseGoal.z);
  }
  if (world && world.raycast) {
    rayOrigin.x = rPos.x; rayOrigin.y = rPos.y + 0.1; rayOrigin.z = rPos.z;
    tv2.set(camPos.x - rayOrigin.x, camPos.y - rayOrigin.y, camPos.z - rayOrigin.z);
    const len = tv2.length();
    if (len > 0.05) {
      rayDir.x = tv2.x / len; rayDir.y = tv2.y / len; rayDir.z = tv2.z / len;
      let hit = null;
      try { hit = world.raycast(rayOrigin, rayDir, len); } catch (_) { hit = null; }
      if (hit && hit.dist < len) {
        const d = Math.max(0.3, hit.dist - 0.2);
        camera.position.set(rayOrigin.x + rayDir.x * d, rayOrigin.y + rayDir.y * d, rayOrigin.z + rayDir.z * d);
      } else camera.position.copy(camPos);
    } else camera.position.copy(camPos);
  } else camera.position.copy(camPos);
  tv3.set(rPos.x + chaseDir.x * 1.4, rPos.y + 0.12, rPos.z + chaseDir.z * 1.4);
  camera.up.set(0, 1, 0);
  camera.lookAt(tv3);
}

function nextTargetIndex() {
  if (run.kind === 'race') return run.cp ? run.cp.next : -1;
  return run.rings ? run.rings.nearest : -1;
}

let pointerDist = -1;
let pointerLabel = '';

function updatePointer() {
  const i = nextTargetIndex();
  const c = run.course;
  if (i < 0 || !c || !c.gates[i]) {
    hud.pointer('off');
    return;
  }
  const g = c.gates[i].pos;
  const p = camera.position;
  const dx = g[0] - p.x;
  const dy = g[1] - p.y;
  const dz = g[2] - p.z;
  const dist = Math.round(Math.sqrt(dx * dx + dy * dy + dz * dz));
  if (dist !== pointerDist) {
    pointerDist = dist;
    pointerLabel = dist + ' ' + t('hud.meters');
  }
  hud.trackTarget(camera, g[0], g[1], g[2], pointerLabel);
}

const hudData = { time: 0, gate: 0, gates: 0, penalty: 0, speedKmh: 0, alt: 0, throttle: 0, volts: 0, rings: 0, ringsTotal: 0 };

function updateHud(dt) {
  const c = run.course;
  if (!c) return;
  if (run.kind === 'race') {
    let time = 0;
    if (run.phase === 'finished' || run.phase === 'results') time = run.finalTime;
    else if (run.clock && run.clock.phase !== 'countdown' && run.clock.phase !== 'idle') time = run.clock.time + run.penalty;
    hudData.time = time;
    hudData.gate = run.cp ? (run.cp.finished ? c.gates.length : run.cp.next + 1) : 0;
    hudData.gates = c.gates.length;
    hudData.penalty = run.penalty;
  } else {
    hudData.rings = run.rings ? run.rings.count : 0;
    hudData.ringsTotal = c.gates.length;
  }
  hudData.speedKmh = drone.speedKmh;
  hudData.alt = Math.max(0, drone.altitude);
  hudData.throttle = drone.throttle;
  hudData.volts = drone.voltage;
  hud.frame(hudData, dt);
  updatePointer();
  const fpv = settings.view === 'fpv';
  hud.trackHorizon(camera, fpv && flightMode() === 'angle');
  hud.trackVelocity(camera, drone.vel.x, drone.vel.y, drone.vel.z, drone.speed, fpv);
}

const DUST_COLORS = { meadow: 0xb8a57c, yard: 0x8f8f8c, canyon: 0xd49a68, freestyle: 0xa9a37f };
const washPos = { x: 0, y: 0, z: 0 };
const washOpts = { kind: 'dust', rate: 0, dir: { x: 0, y: 1, z: 0 }, speed: 2.6, spread: 1.3, color: 0xb8a57c, inherit: 0 };

function updateWash() {
  const p = world && world.particles;
  if (!p || !inRun() || engine.paused || drone.crashed) return;
  const alt = drone.altitude;
  if (alt > 2.4 || drone.thrustFrac < 0.18) return;
  washPos.x = drone.pos.x;
  washPos.z = drone.pos.z;
  washPos.y = world.heightAt(washPos.x, washPos.z) + 0.06;
  washOpts.rate = 46 * (1 - alt / 2.4) * Math.min(1, drone.thrustFrac * 1.6);
  washOpts.color = DUST_COLORS[run.course ? run.course.id : 'meadow'] || 0xb8a57c;
  try { p.trail('wash', washPos, washOpts); } catch (_) {}
}

const motorState = { rpm: [0, 0, 0, 0], load: 0, speed: 0 };
const windState = { speed: 0 };

function updateAudio() {
  if (!motorsVoice && !windVoice) return;
  const live = inRun() && !(engine && engine.paused);
  for (let i = 0; i < 4; i++) motorState.rpm[i] = live ? drone.motors[i] : 0;
  motorState.load = live ? drone.load : 0;
  motorState.speed = live ? drone.speed : 0;
  windState.speed = motorState.speed;
  try {
    if (motorsVoice) motorsVoice.set(motorState);
    if (windVoice) windVoice.set(windState);
  } catch (_) {}
}

function updateGhost(dt) {
  const p = run.phase;
  const show = !!run.ghost && run.kind === 'race' && (p === 'countdown' || p === 'flying' || p === 'crashed' || p === 'finished');
  ghostView.update(run.ghost, p === 'countdown' ? 0 : run.time, show, dt);
}

const hitch = { max: 0, over33: 0, frames: 0 };

function onRender(alpha, dt) {
  frameDt = dt > 0 ? Math.min(dt, 0.1) : 1 / 60;
  if (TEST && dt > 0) {
    hitch.frames++;
    if (dt > hitch.max) hitch.max = dt;
    if (dt > 0.034) hitch.over33++;
  }
  const time = performance.now() / 1000;
  const live = run.phase !== 'boot' && run.phase !== 'loading';
  if (!live || !world) return;
  const paused = engine.paused;
  interpolateDrone(drone, paused ? 1 : alpha, rPos, rQuat);
  droneMesh.group.position.set(rPos.x, rPos.y, rPos.z);
  droneMesh.group.quaternion.set(rQuat.x, rQuat.y, rQuat.z, rQuat.w);
  droneMesh.setProps(paused ? 0 : drone.rpm, frameDt);
  updateGhost(frameDt);
  const attractView = run.phase === 'menu' || run.phase === 'select';
  if (settings.view === 'chase' || attractView) updateChaseCamera(frameDt);
  else updateFpvCamera();
  if (shake) {
    shake.update(paused ? 0 : frameDt);
    shake.apply(camera);
  }
  camera.updateMatrixWorld();
  updateWash();
  world.update(camera, paused ? 0 : frameDt, time);
  if (inRun()) updateHud(frameDt);
  updateAudio();
  if (postFx && typeof postFx.setSpeedFx === 'function') {
    const sp = inRun() && !paused ? clamp((drone.speed - 10) / 22, 0, 1) * 0.9 : 0;
    postFx.setSpeedFx(sp);
  }
}

function openPause() {
  if (!inRun() || !engine) return;
  if (ui.current && ui.current() === 'pause') return;
  engine.pause(true, 'user');
  voicesVolume(0);
  ui.show('pause');
}

function resume() {
  ui.hide();
  focusStage();
  voicesVolume(1);
  if (engine.paused) engine.pause(false);
}

function onEnginePause(paused, reason) {
  if (paused && reason === 'hidden') {
    voicesVolume(0);
    if (inRun() && !(ui.current && ui.current())) ui.show('pause');
  }
}

function courseCards() {
  return RACE_IDS.map((id) => {
    const c = courseById(id);
    const rec = bestRecord(id);
    return {
      id,
      name: courseName(c),
      meta: t('courseInfo.' + id),
      best: rec && typeof rec.time === 'number' ? rec.time : null,
      medal: rec ? rec.medal || null : null,
      hue: CARD_HUES[id]
    };
  });
}

function qualityOptions() {
  return [
    { value: 'auto', label: t('settings.auto') },
    { value: 'low', label: t('settings.low') },
    { value: 'medium', label: t('settings.medium') },
    { value: 'high', label: t('settings.high') }
  ];
}

function settingsRows() {
  const autoOnOff = [
    { value: 'auto', label: t('settings.auto') },
    { value: 'on', label: kitText('ui_on') || '' },
    { value: 'off', label: kitText('ui_off') || '' }
  ];
  const deg = (v) => Math.round(v) + '°';
  return [
    { kind: 'header', label: t('settings.flight') },
    { id: 'assist', kind: 'choice', label: t('settings.assist'), note: t('settings.assistNote'), value: settings.assist, options: autoOnOff },
    { id: 'mode', kind: 'choice', label: t('settings.mode'), note: t(settings.mode === 'acro' ? 'modeInfo.acro' : 'modeInfo.angle'), value: settings.mode, options: [{ value: 'angle', label: t('mode.angle') }, { value: 'acro', label: t('mode.acro') }] },
    { id: 'rates', kind: 'choice', label: t('settings.rates'), value: settings.rates, options: [{ value: 'auto', label: t('settings.auto') }, { value: 'beginner', label: t('settings.ratesBeginner') }, { value: 'pro', label: t('settings.ratesPro') }] },
    { kind: 'header', label: t('settings.camera') },
    { id: 'view', kind: 'choice', label: t('settings.view'), value: settings.view, options: [{ value: 'fpv', label: t('view.fpv') }, { value: 'chase', label: t('view.chase') }] },
    { id: 'tiltAcro', kind: 'slider', label: t('cameraTilt') + ' · ' + t('mode.acro'), value: settings.tiltAcro, min: 0, max: 50, step: 1, format: deg },
    { id: 'tiltAngle', kind: 'slider', label: t('cameraTilt') + ' · ' + t('mode.angle'), value: settings.tiltAngle, min: 0, max: 50, step: 1, format: deg },
    { id: 'fov', kind: 'slider', label: t('settings.fov'), value: settings.fov, min: 60, max: 100, step: 1, format: deg },
    { kind: 'header', label: t('settings.controls') },
    { id: 'stickMode', kind: 'choice', label: t('settings.stickMode'), note: t('settings.stickModeNote'), value: Number(settings.stickMode) === 1 ? 1 : 2, options: [{ value: 2, label: t('settings.mode2') }, { value: 1, label: t('settings.mode1') }] },
    { id: 'invertPitch', kind: 'toggle', label: t('settings.invertPitch'), value: !!settings.invertPitch },
    { id: 'stickSize', kind: 'slider', label: t('settings.stickSize'), value: settings.stickSize, min: 0.8, max: 1.3, step: 0.05, format: (v) => Math.round(v * 100) + '%' },
    { kind: 'header', label: t('settings.graphics') },
    { id: 'quality', kind: 'choice', label: t('settings.quality'), value: settings.quality, options: qualityOptions() },
    { kind: 'header', label: t('settings.sound') },
    { id: 'volume', kind: 'slider', label: t('settings.volume'), value: settings.volume, min: 0, max: 1, step: 0.05 },
    { id: 'ghost', kind: 'toggle', label: t('settings.ghost'), note: t('settings.ghostNote'), value: !!settings.ghost }
  ];
}

function applySetting(id, value) {
  const patch = {};
  patch[id] = value;
  saveSettings(patch);
  if (id === 'assist' || id === 'mode' || id === 'rates') {
    if (id === 'assist') seedManualThrottle();
    applyDroneParams(run.autopilot || !!run.attract);
    refreshInputLayout();
    hud.setModeLabel(modeLabel());
    if (id === 'mode' && ui.current && ui.current() === 'settings') ui.update('settings', { rows: settingsRows() });
  } else if (id === 'tiltAcro' || id === 'tiltAngle') {
    applyDroneParams(run.autopilot || !!run.attract);
  } else if (id === 'fov') {
    camera.fov = value;
    camera.updateProjectionMatrix();
  } else if (id === 'view') {
    applyView();
  } else if (id === 'stickMode') {
    saveSettings({ stickMode: Number(value) === 1 ? 1 : 2 });
    refreshInputLayout();
  } else if (id === 'invertPitch' || id === 'stickSize') {
    try { input.setSettings({ invertPitch: !!settings.invertPitch, stickSize: settings.stickSize }); } catch (_) {}
  } else if (id === 'quality') {
    quality = resolveQuality(value);
    try { engine.setQuality(quality); } catch (_) {}
    try { if (postFx && postFx.setQuality) postFx.setQuality(quality); } catch (_) {}
    camera.far = (qualityPreset(quality).drawDistance || 1100) * 1.4;
    camera.updateProjectionMatrix();
  } else if (id === 'volume') {
    try { audio.setMaster(value); } catch (_) {}
  } else if (id === 'ghost') {
    if (run.kind === 'race' && inRun()) setupGhost();
  }
}

function openHelp() {
  if (!helpEl) return;
  try { helpEl.showPopover(); } catch (_) {}
}

function defineScreens() {
  ui.screen('main', {
    type: 'menu',
    art: ART,
    logo: LOGO,
    kicker: t('menu.kicker'),
    subtitle: t('menu.tagline'),
    items: [
      { id: 'race', label: t('menu.race'), hint: t('menu.raceHint'), primary: true },
      { id: 'freestyle', label: t('menu.freestyle') },
      { id: 'settings', label: t('menu.settings') },
      { id: 'help', label: t('menu.help') }
    ],
    onSelect(id) {
      unlockAudio();
      if (id === 'race') goSelect();
      else if (id === 'freestyle') startRun('freestyle', 'freestyle');
      else if (id === 'settings') {
        settingsFrom = 'main';
        ui.show('settings', { rows: settingsRows(), overlay: false });
      } else if (id === 'help') openHelp();
    }
  });
  ui.screen('courses', {
    type: 'cards',
    kicker: t('select.kicker'),
    title: t('select.title'),
    cards: courseCards(),
    onSelect(id) {
      unlockAudio();
      startRun(id, 'race');
    },
    onBack() { goMenu(); }
  });
  ui.screen('settings', {
    type: 'settings',
    kicker: t('settings.kicker'),
    title: t('settings.title'),
    rows: settingsRows(),
    onChange(id, value) { applySetting(id, value); },
    onBack() {
      if (settingsFrom === 'pause') ui.show('pause');
      else ui.show('main', { focus: 'settings' });
    }
  });
  ui.screen('pause', {
    type: 'menu',
    variant: 'pause',
    title: t('pause.title'),
    items: [
      { id: 'resume', label: t('pause.resume'), primary: true },
      { id: 'restart', label: t('pause.restart') },
      { id: 'settings', label: t('pause.settings') },
      { id: 'help', label: t('pause.help') },
      { id: 'quit', label: t('pause.quit') }
    ],
    onSelect(id) {
      if (id === 'resume') resume();
      else if (id === 'restart') {
        ui.hide();
        restartRun();
        if (engine.paused) engine.pause(false);
        voicesVolume(1);
        focusStage();
      } else if (id === 'settings') {
        settingsFrom = 'pause';
        ui.show('settings', { rows: settingsRows(), overlay: true });
      } else if (id === 'help') openHelp();
      else if (id === 'quit') goMenu();
    },
    onBack() { resume(); }
  });
  ui.screen('results', {
    type: 'results',
    items: [
      { id: 'retry', label: t('results.retry'), primary: true },
      { id: 'next', label: t('results.next') },
      { id: 'courses', label: t('results.courses') }
    ],
    onReveal(medal) {
      if (medal) sfx('medal', { medal });
    },
    onSelect(id) {
      if (id === 'retry') startRun(run.course.id, 'race');
      else if (id === 'next') {
        const i = RACE_IDS.indexOf(run.course.id);
        startRun(RACE_IDS[(i + 1) % RACE_IDS.length], 'race');
      } else goSelect();
    },
    onBack() { goSelect(); }
  });
}

function refreshCopy() {
  const I = window.MentriaI18n;
  if (I && typeof I.t === 'function') {
    for (const key of Object.keys(COPY)) {
      const v = I.t(key);
      if (typeof v === 'string' && v !== key) COPY[key] = v;
    }
  }
  if (ui) {
    try { ui.setCopy(uiCopy()); } catch (_) {}
    defineScreens();
    const cur = ui.current ? ui.current() : null;
    if (cur === 'settings') ui.show('settings', { rows: settingsRows() });
    else if (cur === 'courses') ui.show('courses', { cards: courseCards() });
    else if (cur === 'results' && run.phase === 'results') showResults();
  }
  if (input && input.setCopy) {
    try { input.setCopy(inputCopy()); } catch (_) {}
  }
  if (hud) {
    hud.setCopy(hudCopy());
    hud.setModeLabel(modeLabel());
    if (run.coachStep >= 0) showCoach();
  }
}

function onMethodChange(m) {
  lastMethod = m;
  if (settings.assist === 'auto' || settings.rates === 'auto') {
    applyDroneParams(run.autopilot || !!run.attract);
    refreshInputLayout();
    if (hud) hud.setModeLabel(modeLabel());
  }
  if (run.coachStep >= 0 && run.coachStep < 3 && hud) showCoach();
}

function exposeTestHook() {
  window.__skyrushTest = {
    start(id, kind) { return startRun(id, kind); },
    autopilot(on) {
      run.autopilot = !!on;
      if (run.course) run.bot = on ? createFlightBot(run.course) : null;
      applyDroneParams(!!on);
      return run.autopilot;
    },
    skipCountdown() {
      if (run.phase !== 'countdown') return false;
      let n = 0;
      while (run.phase === 'countdown' && n < 2000) {
        stepCountdown(1 / 120);
        n++;
      }
      return true;
    },
    crash() {
      if (run.phase !== 'flying') return false;
      drone.crashed = true;
      drone.crashReason = 'impact';
      drone.crashSpeed = 10;
      return true;
    },
    setView(v) {
      saveSettings({ view: v === 'chase' ? 'chase' : 'fpv' });
      applyView();
      return settings.view;
    },
    setSetting(id, value) {
      applySetting(id, value);
      return Object.assign({}, settings);
    },
    timeScale(s) {
      if (engine.setTimeScale) engine.setTimeScale(s);
      return s;
    },
    hitches() {
      const out = { maxMs: Math.round(hitch.max * 1000), over33: hitch.over33, frames: hitch.frames };
      hitch.max = 0;
      hitch.over33 = 0;
      hitch.frames = 0;
      return out;
    },
    input() {
      try { return Object.assign({ climb: input.axis('climb'), throttle: input.axis('throttle') }, input.snapshot ? input.snapshot() : {}); } catch (err) { return { error: String(err) }; }
    },
    menu() { goMenu(); },
    select() { goSelect(); },
    pause() { openPause(); },
    resume() { resume(); },
    settings() {
      settingsFrom = 'main';
      ui.show('settings', { rows: settingsRows(), overlay: false });
    },
    state() {
      const c = run.course;
      return {
        state: stateName(),
        phase: run.phase,
        kind: run.kind,
        course: c ? c.id : null,
        next: run.cp ? run.cp.next : (run.rings ? run.rings.nearest : -1),
        passed: run.cp ? run.cp.passed : (run.rings ? run.rings.count : 0),
        gates: c ? c.gates.length : 0,
        time: run.clock ? run.clock.time + run.penalty : run.time,
        finalTime: run.finalTime,
        medal: run.medal,
        penalty: run.penalty,
        crashes: run.crashes,
        speedKmh: drone.speedKmh,
        alt: drone.altitude,
        pos: { x: drone.pos.x, y: drone.pos.y, z: drone.pos.z },
        crashed: drone.crashed,
        grounded: drone.grounded,
        view: settings.view,
        mode: flightMode(),
        assist: assistOn(),
        method: methodNow(),
        quality,
        fps: engine.stats.fps,
        frameMs: engine.stats.frameMs,
        cpuMs: engine.stats.cpuMs,
        gpuGeometries: engine.stats.geometries,
        gpuTextures: engine.stats.textures,
        programs: engine.stats.programs,
        sceneChildren: scene.children.length,
        stepMs: engine.stats.stepMs,
        renderMs: engine.stats.renderMs,
        dpr: engine.stats.dpr,
        drawCalls: engine.stats.drawCalls,
        triangles: engine.stats.triangles,
        buildMs: world ? world.buildMs : 0,
        ghost: !!run.ghost,
        ghostPace: run.ghostPace,
        ui: ui.current ? ui.current() : null,
        coachStep: run.coachStep,
        paused: !!engine.paused,
        audio: audio ? !!audio.unlocked : null,
        voices: !!motorsVoice && !!windVoice
      };
    }
  };
}

function boot() {
  quality = resolveQuality(settings.quality);
  const preset = qualityPreset(quality);
  try {
    engine = KitEngine.createEngine({
      canvas,
      quality,
      fov: settings.fov,
      near: 0.04,
      far: (preset.drawDistance || 1100) * 1.4,
      onStep,
      onRender,
      onPause: onEnginePause,
      onContextLost() { if (ui) ui.toast(t('contextLost'), { tone: 'warn', ms: 3000 }); }
    });
  } catch (err) {
    fail(err && err.code ? err.code : String(err && err.message ? err.message : err));
    return;
  }
  renderer = engine.renderer;
  scene = engine.scene;
  camera = engine.camera;
  camera.fov = settings.fov;
  camera.near = 0.04;
  camera.updateProjectionMatrix();

  if (typeof KitFx.createPostFx === 'function') {
    try {
      postFx = KitFx.createPostFx(renderer, scene, camera, { quality, preset: 'day' });
      engine.setComposer({
        render() { postFx.render(frameDt); },
        setSize(w, h) { if (postFx.setSize) postFx.setSize(w, h); },
        setPixelRatio(p) { if (postFx.setPixelRatio) postFx.setPixelRatio(p); }
      });
    } catch (err) {
      console.error('[skyrush] postfx', err);
      postFx = null;
    }
  }
  if (typeof KitFx.createCameraShake === 'function') {
    try { shake = KitFx.createCameraShake({ maxOffset: 0.06, maxAngle: 0.05, decay: 1.6 }); } catch (_) { shake = null; }
  }

  try { audio = KitAudio.createAudio({ master: settings.volume }); } catch (_) { audio = null; }

  ui = KitUi.createUI(stage, uiCopy(), {
    title: 'SKYRUSH FPV',
    sound(kind, index) { sfx('ui', { kind, index }); },
    onPause() { openPause(); }
  });
  ui.setChrome({ pause: true, fullscreen: true });

  input = KitInput.createInput({
    element: stage,
    layout: buildLayout(),
    copy: inputCopy(),
    settings: { invertPitch: !!settings.invertPitch, stickSize: settings.stickSize },
    onMethodChange
  });
  lastMethod = methodNow();

  hud = createHud(stage, hudCopy());

  droneMesh = createDroneMesh({ color: DRONE_COLOR, cameraTilt: cameraTiltDeg() * DEG, lod: quality === 'low' ? 'low' : 'high' });
  droneMesh.group.visible = false;
  scene.add(droneMesh.group);
  ghostView = createGhostView(scene, GHOST_COLOR);
  applyDroneParams(false);

  defineScreens();

  if (helpEl) {
    helpEl.addEventListener('toggle', (e) => {
      if (e.newState === 'open') openPause();
    });
  }
  stage.addEventListener('pointerdown', unlockAudio, { passive: true });
  stage.addEventListener('keydown', (e) => {
    if ((e.code === 'Space' || e.code === 'PageDown' || e.code === 'PageUp') && inRun() && !(ui.current && ui.current())) e.preventDefault();
  });
  window.addEventListener('keydown', unlockAudio, { once: true });
  window.addEventListener('keydown', (e) => {
    if (run.phase !== 'results' || e.code !== 'KeyR' || e.repeat || e.metaKey || e.ctrlKey || e.altKey || !run.course) return;
    const a = document.activeElement;
    if (a && a !== document.body && !stage.contains(a)) return;
    e.preventDefault();
    startRun(run.course.id, 'race');
  });
  document.addEventListener('mentria:localechange', refreshCopy);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !engine) return;
    if (engine.paused && engine.pauseReason === 'hidden' && !inRun()) engine.pause(false);
  });

  if (TEST) exposeTestHook();
  setPhase('menu');
  showBoot(false);
  ui.show('main');
  engine.start();
}

try {
  boot();
} catch (err) {
  console.error('[skyrush] boot', err);
  fail(String(err && err.message ? err.message : err));
}
