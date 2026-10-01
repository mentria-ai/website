import * as THREE from 'three';
import { clamp, lerp, damp, wrapAngle, mulberry32, hashString } from '../kit/math.js';
import { createEngine } from '../kit/engine.js';
import { detectQuality, qualityPreset, isTouchDevice } from '../kit/quality.js';
import { createInput, inputLayoutRacer } from '../kit/input.js';
import { createAudio } from '../kit/audio.js';
import { createRaceClock, medalFor } from '../kit/race.js';
import { createRecorder, decodeGhost } from '../kit/ghost.js';
import { createUI, kitCopy } from '../kit/ui.js';
import { createParticles, createCameraShake, createPostFx } from '../kit/fx.js';
import { createTrack } from '../kit/track.js';
import { createVehicle, vehicleParamsFromStats, stepVehicles } from './vehicle.js';
import { createAIDriver } from './ai.js';
import { TRACKS, trackById } from './tracks.js';
import { createCar, createCarLOD } from './carmesh.js';
import { CARS, CAR_PAINTS, carById, paintById } from './cars.js';
import { createRacerHud, formatRacerTime } from './hud.js';
import { buildRacerWorld } from './world.js';
import { createGarage, createSettingsStore, engineSpecFor } from './modes.js';

const SLUG = 'nitro-racer';
const NS = 'tool.nitro-racer.';
const GHOST_HZ = 15;
const REAR_Z = 1.32;
const HALF_TRACK = 0.82;
const KMH = 3.6;

const EN = {
  boot_loading: "Starting the engine", loading_track: "Building the track", fail_body: "This browser couldn't start 3D graphics. Try a recent browser with hardware acceleration turned on.", fail_module: "The game files didn't load. Check your connection and reload the page.",
  context_lost: "The graphics restarted. Resume to keep racing.", tagline: "Street racing with nitro", menu_race: "Race", menu_tt: "Time Trial",
  menu_garage: "Garage", menu_settings: "Settings", menu_help: "Help", select_title: "Pick a track",
  select_race: "Race", select_tt: "Time Trial", track_laps: "{n} laps", track_km: "{n} km",
  track_ghost: "Ghost ready", garage_kicker: "Garage", garage_paint: "Paint", garage_drive: "Drive this car",
  garage_prev: "Previous car", garage_next: "Next car", garage_keys: "Left and right change the car, up and down change the paint", settings_title: "Settings",
  set_header_controls: "Controls", set_header_race: "Race", set_header_display: "Display and sound", set_steer: "Touch steering",
  steer_zones: "Touch sides", steer_tilt: "Tilt", steer_wheel: "Wheel", set_autogas: "Auto accelerate",
  set_tilt_center: "Tilt center", set_tilt_center_action: "Center now", set_difficulty: "Rival skill", set_camera: "Camera",
  cam_chase: "Chase", cam_hood: "Bumper", set_quality: "Graphics", q_auto: "Auto",
  q_low: "Low", q_medium: "Medium", q_high: "High", set_volume: "Volume",
  set_units: "Speed units", units_kmh: "km/h", units_mph: "mph", set_ghost: "Ghost car",
  hud_pos: "Pos", hud_lap: "Lap", hud_time: "Time", hud_lap_time: "Lap",
  hud_best: "Best", hud_gear: "Gear", hud_nitro: "Nitro", final_lap: "Final lap",
  wrong_way: "Wrong way", ghost_label: "Ghost", toast_drift: "Drift", toast_near_miss: "Near miss",
  toast_takedown: "Takedown", toast_airtime: "Airtime", toast_overtake: "Overtake", toast_perfect_start: "Perfect start",
  toast_nitro_ready: "Nitro ready", toast_best_lap: "Best lap", toast_wrecked: "Wrecked", toast_lap: "Lap {n}",
  start_hint_keys: "Hit the gas right on GO for a perfect start", start_hint_touch: "Tap nitro right on GO for a perfect start", res_race: "Race over", res_tt: "Time Trial",
  res_best_lap: "Best lap", res_top_speed: "Top speed", res_takedowns: "Takedowns", res_drifts: "Drifts",
  res_you: "You", res_ghost_saved: "Ghost saved", res_retry: "Race again", res_next: "Next track",
  res_garage: "Garage", res_menu: "Menu", pause_title: "Paused", pause_resume: "Resume",
  pause_restart: "Restart", pause_settings: "Settings", pause_quit: "Quit to menu"
};

const KIT_EN = {
  input_gas: 'GAS', input_brake: 'BRAKE', input_drift: 'DRIFT', input_nitro: 'NITRO', input_camera: 'CAM', input_look_back: 'BACK',
  input_steer_left: 'Steer left', input_steer_right: 'Steer right', input_wheel: 'Steering wheel', input_steer: 'STEER',
  ui_back: 'Back', ui_select: 'Select', ui_move: 'Move', ui_confirm: 'OK', ui_cancel: 'Cancel', ui_go: 'GO', ui_loading: 'Loading',
  ui_best: 'Best', ui_locked: 'Locked', ui_new_best: 'New record', ui_on: 'On', ui_off: 'Off', ui_pause: 'Pause',
  ui_fullscreen: 'Fullscreen', ui_exit_fullscreen: 'Exit fullscreen', ui_position: 'Position', ui_time: 'Time',
  ui_rotate: 'Turn your phone sideways to play', ui_rotate_dismiss: 'Tap to dismiss',
  medal_gold: 'Gold', medal_silver: 'Silver', medal_bronze: 'Bronze', medal_none: 'Finished',
  tilt_enable: 'Turn on tilt steering', tilt_unavailable: "Tilt steering isn't available on this device", tilt_centered: 'Tilt centered'
};

const COPY = window.NITRO_COPY || {};
const params = new URLSearchParams(location.search);
const TEST = params.get('test') === '1';
const $ = (id) => document.getElementById(id);
const stage = $('nr-stage');
const canvas = $('nr-canvas');
const bootEl = $('nr-boot');
const bootFill = $('nr-boot-fill');
const bootText = $('nr-boot-text');
const helpEl = $('nr-help');

function raw(key) {
  const v = COPY[key];
  return typeof v === 'string' && v && v !== key ? v : null;
}

function t(k) {
  const v = raw(NS + k);
  if (v != null) return v;
  return EN[k] != null ? EN[k] : k;
}

function kt(k) {
  const v = raw('games.kit.' + k);
  if (v != null) return v;
  return KIT_EN[k] != null ? KIT_EN[k] : k;
}

function fill(str, n) {
  return String(str).split('{n}').join(String(n));
}

function trackName(def) {
  return raw(def.nameKey || (NS + 'tracks.' + def.id)) || def.name || def.id;
}

function carName(spec) {
  return raw(spec.nameKey || (NS + 'cars.' + spec.id + '.name')) || spec.name || spec.id;
}

function carKind(spec) {
  return raw(spec.kindKey || (NS + 'cars.kind.' + spec.kind)) || spec.kind || '';
}

const STAT_EN = { accel: 'Acceleration', top: 'Top speed', handling: 'Handling', nitro: 'Nitro' };
const DIFF_EN = { easy: 'Easy', normal: 'Normal', hard: 'Hard', pro: 'Pro' };

function statLabel(k) {
  return raw(NS + 'cars.stat.' + k) || STAT_EN[k] || k;
}

function diffLabel(k) {
  return raw(NS + 'difficulty.' + k) || DIFF_EN[k] || k;
}

function paintName(id) {
  return raw(NS + 'paint.' + id) || id;
}

function numberText(v, digits) {
  try { return new Intl.NumberFormat(COPY.lang || undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v); } catch (_) { return v.toFixed(digits); }
}

function kitTexts() {
  try { return kitCopy(raw); } catch (_) { return { input: {}, ui: {}, tilt: {} }; }
}

function kitUiCopy() {
  return Object.assign({ noTime: '--:--.---' }, kitTexts().ui);
}

function kitInputCopy() {
  return kitTexts().input;
}

function showFail(detail) {
  const panel = $('nr-fail');
  const d = $('nr-fail-detail');
  if (d) d.textContent = detail || '';
  if (bootEl) bootEl.hidden = true;
  if (panel) panel.hidden = false;
}

function bootProgress(p, text) {
  if (bootFill) bootFill.style.width = Math.round(clamp(p, 0, 1) * 100) + '%';
  if (text && bootText) bootText.textContent = text;
}

const touchDevice = (function () { try { return isTouchDevice(); } catch (_) { return false; } })();
const SETTINGS_DEFAULTS = {
  steer: 'zones', autoGas: null, difficulty: 'normal', camera: 'chase', quality: 'auto', volume: 0.8,
  units: 'kmh', ghost: true, car: CARS[0].id, paint: null, track: TRACKS[0].id
};
const store = createSettingsStore(SLUG, SETTINGS_DEFAULTS);
let settings = store.settings();
if (!carById(settings.car) || carById(settings.car).id !== settings.car) settings.car = CARS[0].id;
if (!settings.paint) settings.paint = (carById(settings.car).paints || [CAR_PAINTS[0].id])[0];
if (!trackById(settings.track) || trackById(settings.track).id !== settings.track) settings.track = TRACKS[0].id;

function saveSettings(patch) {
  Object.assign(settings, patch);
  try { settings = Object.assign({}, settings, store.saveSettings(patch)); } catch (_) {}
}

function autoGasOn() {
  return settings.autoGas == null ? touchDevice : !!settings.autoGas;
}

function qualityName() {
  if (settings.quality === 'low' || settings.quality === 'medium' || settings.quality === 'high') return settings.quality;
  try { return detectQuality(); } catch (_) { return touchDevice ? 'medium' : 'high'; }
}

bootProgress(0.2, t('boot_loading'));

let engine;
try {
  engine = createEngine({
    canvas,
    quality: qualityName(),
    autoRender: false,
    onStep,
    onRender,
    onContextLost: function () { if (ui) ui.toast(t('context_lost'), { tone: 'warn' }); },
    onContextRestored: function () { if (race && state === 'race') requestPause(); }
  });
} catch (err) {
  showFail(String((err && (err.code || err.message)) || err));
  throw err;
}

const renderer = engine.renderer;
const scene = engine.scene;
const camera = new THREE.PerspectiveCamera(66, 16 / 9, 0.3, 2400);
engine.setCamera(camera);

const audio = createAudio({ master: settings.volume });
function unlockAudio() { try { audio.unlock(); } catch (_) {} }
stage.addEventListener('pointerdown', unlockAudio, true);
window.addEventListener('keydown', unlockAudio, true);

function uiSound(kind, index) {
  const k = kind === 'select' || kind === 'confirm' ? 'select' : kind === 'back' ? 'back' : kind === 'toggle' ? 'toggle' : kind === 'error' ? 'error' : 'move';
  try { audio.play('ui', { kind: k, index: index || 0, volume: 0.8 }); } catch (_) {}
}

const ui = createUI(stage, kitUiCopy(), { sound: uiSound, onPause: requestPause, title: 'NITRO RACER' });
const input = createInput({
  element: stage,
  layout: inputLayoutRacer,
  copy: kitInputCopy(),
  settings: { steer: settings.steer, autoGas: autoGasOn(), touch: 'auto' }
});
input.showTouch(false);
const hud = createRacerHud(stage, { t, units: settings.units, touch: touchDevice });
const garage = createGarage({
  stage, renderer, cars: CARS, paints: CAR_PAINTS,
  t: function (k) { return k === 'ui_back_short' ? kt('ui_back') : t(k); },
  nameOf: carName, kindOf: carKind, statLabel, paintName, sound: uiSound
});

let state = 'boot';
let mode = 'race';
let world = null;
let worldKey = '';
let worldPromise = null;
let buildToken = 0;
let postFx = null;
let particles = null;
let shake = null;
let race = null;
let attemptSeed = 1;
let screenBeforeSettings = 'main';
let frameId = 0;
let stepFrame = -1;
let lastFrameDt = 1 / 60;
let mapTick = 0;
let headlight = null;
let lastResults = null;
let testAutopilot = false;

const pIn = { throttle: 0, brake: 0, steer: 0, nitro: false, drift: false, brakeDrift: true };
const camState = { yaw: 0, y: 0, boost: 0, fov: 66, init: false, mode: settings.camera === 'hood' ? 'hood' : 'chase', flyS: 0 };
const v3a = new THREE.Vector3();
const v3b = new THREE.Vector3();
const qa = new THREE.Quaternion();
const qb = new THREE.Quaternion();
const qLean = new THREE.Quaternion();
const eul = new THREE.Euler(0, 0, 0, 'YXZ');
const ghostOut = { pos: { x: 0, y: 0, z: 0 }, quat: { x: 0, y: 0, z: 0, w: 1 }, extra: [0] };
const ghostExtra = [0];
const smokeTrail = { kind: 'smoke', rate: 30 };
const flameTrail = { kind: 'flame', rate: 24, size: [0.1, 0.18], life: [0.1, 0.2], speed: 1.4 };
const burstOpts = { velocity: { x: 0, y: 0, z: 0 } };
const frameStats = { calls: 0, triangles: 0 };
const hudFrame = { speed: 0, gear: 1, reverse: false, rpm: 0, nitro: 0, boosting: false, position: 1, total: 6, lap: 1, laps: 3, time: 0, lapTime: 0, bestLap: Infinity, delta: null };
const autoCtx = { cars: null, playerIndex: -1, time: 0 };
const projOut = { s: 0, lateral: 0, height: 0 };
const nearPair = [-1, -1];
const voicePatch = { rpm: 0, throttle: 0, nitro: 0, skid: 0 };
const windPatch = { speed: 0 };
const aiPatch = { rpm: 0, throttle: 0, nitro: 0, skid: 0, volume: 0, pan: 0 };
const mutePatch = { volume: 0 };
const nearDist = [Infinity, Infinity];
const smokeIds = [];
for (let i = 0; i < 12; i++) smokeIds.push(['sm' + i + 'l', 'sm' + i + 'r', 'sk' + i + 'l', 'sk' + i + 'r', 'fl' + i]);

function presetFor(q) {
  try { return qualityPreset(q); } catch (_) { return { name: q, shadows: q !== 'low', vegetation: 1, particles: 1, drawDistance: 1400 }; }
}

function mainSpec() {
  return {
    type: 'menu',
    art: '/assets/games/art/racer-key.webp',
    logo: '/assets/games/sprites/logo-nitro.webp',
    kicker: t('tagline'),
    items: [
      { id: 'race', label: t('menu_race'), primary: true },
      { id: 'tt', label: t('menu_tt') },
      { id: 'garage', label: t('menu_garage'), hint: carName(carById(settings.car)) },
      { id: 'settings', label: t('menu_settings') },
      { id: 'help', label: t('menu_help') }
    ],
    onSelect: onMainSelect
  };
}

function recordKey(m, id) {
  return (m === 'tt' ? 'tt-' : 'race-') + id;
}

function tracksSpec() {
  const cards = TRACKS.map(function (def) {
    const rec = safeRecord(recordKey(mode, def.id));
    let km = def.lengthKm;
    if (!km) {
      try { km = createTrackCached(def).length / 1000; } catch (_) { km = 0; }
    }
    const meta = fill(t('track_km'), numberText(km, 1)) + ' · ' + fill(t('track_laps'), def.laps || 3);
    return {
      id: def.id,
      name: trackName(def),
      meta,
      best: rec && typeof rec.time === 'number' ? rec.time : null,
      medal: rec ? rec.medal : null,
      image: def.env && def.env.backdrop ? '/assets/games/backdrops/' + def.env.backdrop + '.webp' : null,
      tag: mode === 'tt' && safeGhost(def.id) ? t('track_ghost') : null
    };
  });
  return {
    type: 'cards',
    kicker: mode === 'tt' ? t('select_tt') : t('select_race'),
    title: t('select_title'),
    cards,
    focus: settings.track,
    onSelect: function (id) { tiltTap(); startRace(mode, id); },
    onBack: showMain
  };
}

function settingsRows() {
  const rows = [
    { kind: 'header', label: t('set_header_controls') },
    { id: 'steer', kind: 'choice', label: t('set_steer'), value: settings.steer, options: [
      { value: 'zones', label: t('steer_zones') }, { value: 'tilt', label: t('steer_tilt') }, { value: 'wheel', label: t('steer_wheel') }] },
    { id: 'autoGas', kind: 'toggle', label: t('set_autogas'), value: autoGasOn() }
  ];
  if (settings.steer === 'tilt') rows.push({ id: 'tiltCenter', kind: 'button', label: t('set_tilt_center'), action: t('set_tilt_center_action') });
  rows.push(
    { kind: 'header', label: t('set_header_race') },
    { id: 'difficulty', kind: 'choice', label: t('set_difficulty'), value: settings.difficulty, options: [
      { value: 'easy', label: diffLabel('easy') }, { value: 'normal', label: diffLabel('normal') }, { value: 'hard', label: diffLabel('hard') }] },
    { id: 'camera', kind: 'choice', label: t('set_camera'), value: camState.mode, options: [
      { value: 'chase', label: t('cam_chase') }, { value: 'hood', label: t('cam_hood') }] },
    { id: 'ghost', kind: 'toggle', label: t('set_ghost'), value: settings.ghost !== false },
    { kind: 'header', label: t('set_header_display') },
    { id: 'quality', kind: 'choice', label: t('set_quality'), value: settings.quality, options: [
      { value: 'auto', label: t('q_auto') }, { value: 'low', label: t('q_low') }, { value: 'medium', label: t('q_medium') }, { value: 'high', label: t('q_high') }] },
    { id: 'units', kind: 'choice', label: t('set_units'), value: settings.units, options: [
      { value: 'kmh', label: t('units_kmh') }, { value: 'mph', label: t('units_mph') }] },
    { id: 'volume', kind: 'slider', label: t('set_volume'), value: clamp(Number(settings.volume) || 0, 0, 1), min: 0, max: 1, step: 0.05 }
  );
  return rows;
}

function settingsSpec() {
  return {
    type: 'settings',
    title: t('settings_title'),
    rows: settingsRows(),
    overlay: state === 'paused',
    solid: state !== 'paused' && !world,
    onChange: onSettingChange,
    onAction: function (id) {
      if (id === 'tiltCenter') {
        try { input.calibrateTilt(); ui.toast(kt('tilt_centered')); } catch (_) {}
      }
    },
    onBack: function () {
      if (screenBeforeSettings === 'pause') showPause();
      else showMain();
    }
  };
}

function onSettingChange(id, value) {
  if (id === 'steer') {
    saveSettings({ steer: value });
    input.setSettings({ steer: value });
    if (value === 'tilt') {
      try {
        const r = input.requestTilt();
        if (r && typeof r.then === 'function') r.then(function (ok) { if (ok === false) ui.toast(kt('tilt_unavailable'), { tone: 'warn' }); }).catch(function () {});
      } catch (_) {}
    }
    ui.update('settings', { rows: settingsRows() });
  } else if (id === 'autoGas') {
    saveSettings({ autoGas: !!value });
    input.setSettings({ autoGas: !!value });
  } else if (id === 'difficulty') {
    saveSettings({ difficulty: value });
  } else if (id === 'camera') {
    camState.mode = value === 'hood' ? 'hood' : 'chase';
    saveSettings({ camera: camState.mode });
  } else if (id === 'ghost') {
    saveSettings({ ghost: !!value });
    if (race && race.ghostView) race.ghostView.group.visible = !!value;
  } else if (id === 'quality') {
    saveSettings({ quality: value });
    try { engine.setQuality(qualityName()); } catch (_) {}
  } else if (id === 'units') {
    saveSettings({ units: value });
    hud.setUnits(value);
  } else if (id === 'volume') {
    saveSettings({ volume: value });
    try { audio.setMaster(value); } catch (_) {}
  }
}

function pauseSpec() {
  return {
    type: 'menu',
    variant: 'pause',
    title: t('pause_title'),
    items: [
      { id: 'resume', label: t('pause_resume'), primary: true },
      { id: 'restart', label: t('pause_restart') },
      { id: 'settings', label: t('pause_settings') },
      { id: 'quit', label: t('pause_quit') }
    ],
    onSelect: function (id) {
      if (id === 'resume') resume();
      else if (id === 'restart') { resume(); restartRace(); }
      else if (id === 'settings') { screenBeforeSettings = 'pause'; ui.screen('settings', settingsSpec()); ui.show('settings'); }
      else if (id === 'quit') quitToMenu();
    },
    onBack: resume
  };
}

function safeRecord(key) {
  try { return typeof store.record === 'function' ? store.record(key) : (store.records()[key] || null); } catch (_) { return null; }
}

function safeGhost(id) {
  try { return store.ghost(id); } catch (_) { return null; }
}

const trackCache = new Map();
function createTrackCached(def) {
  let tr = trackCache.get(def.id);
  if (!tr) {
    tr = createTrack(def);
    trackCache.set(def.id, tr);
  }
  return tr;
}

function setRaceChrome(on) {
  try { ui.setChrome({ pause: on, fullscreen: true }); } catch (_) {}
  try { input.showTouch(on ? 'auto' : false); } catch (_) {}
}

function showMain() {
  state = 'menu';
  setRaceChrome(false);
  hud.show(false);
  garage.close();
  ui.screen('main', mainSpec());
  ui.show('main');
}

function showTracks() {
  state = 'menu';
  garage.close();
  ui.screen('tracks', tracksSpec());
  ui.show('tracks');
}

function showSettings() {
  screenBeforeSettings = 'main';
  garage.close();
  ui.screen('settings', settingsSpec());
  ui.show('settings');
}

function openHelp() {
  if (!helpEl || typeof helpEl.showPopover !== 'function') return;
  try { helpEl.showPopover(); } catch (_) {}
}

function tiltTap() {
  if (settings.steer !== 'tilt') return;
  try {
    const r = input.requestTilt();
    if (r && typeof r.then === 'function') r.catch(function () {});
  } catch (_) {}
}

function onMainSelect(id) {
  if (id === 'race' || id === 'tt') {
    mode = id;
    tiltTap();
    showTracks();
  } else if (id === 'garage') {
    ui.hide();
    state = 'garage';
    garage.show(settings.car, settings.paint, {
      onDone: function (carId, paint) {
        saveSettings({ car: carId, paint });
        showMain();
      },
      onBack: showMain
    });
  } else if (id === 'settings') {
    showSettings();
  } else if (id === 'help') {
    openHelp();
  }
}

async function ensureWorld(trackId) {
  const q = qualityName();
  const key = trackId + '|' + q;
  if (world && worldKey === key) return world;
  if (worldPromise && worldPromise.key === key) return worldPromise.promise;
  const def = trackById(trackId);
  const track = createTrackCached(def);
  disposeRace();
  disposeWorld();
  const preset = presetFor(q);
  const info = { kicker: trackName(def), title: '', tip: touchDevice ? t('start_hint_touch') : t('start_hint_keys'), image: def.env && def.env.backdrop ? '/assets/games/backdrops/' + def.env.backdrop + '.webp' : '' };
  const token = ++buildToken;
  const promise = (async function () {
    const built = await buildRacerWorld({
      scene, renderer, def, track, quality: preset, qualityName: q,
      onProgress: function (p) { if (state === 'loading' && token === buildToken) ui.loading(Math.min(0.99, p), t('loading_track'), info); }
    });
    if (token !== buildToken) {
      try { built.dispose(); } catch (_) {}
      throw new Error('stale-world');
    }
    camera.far = Math.max(900, (preset.drawDistance || 1400) * 1.5);
    camera.updateProjectionMatrix();
    try {
      postFx = createPostFx(renderer, scene, camera, { quality: preset, preset: (def.env && def.env.preset) || 'day' });
      if (def.env && def.env.preset === 'night' && postFx.setBloom) postFx.setBloom({ strength: 0.5, threshold: 0.85 });
      engine.setComposer(postFx);
    } catch (err) {
      postFx = null;
      try { console.warn('[nitro-racer] post fx off: ' + (err && err.message)); } catch (_) {}
    }
    try { particles = createParticles(scene, { quality: preset, heightAt: built.terrain.heightAt }); } catch (_) { particles = null; }
    try { shake = createCameraShake({ maxOffset: 0.22, maxAngle: 0.035, decay: 1.8 }); } catch (_) { shake = null; }
    world = built;
    worldKey = key;
    camState.flyS = 0;
    return built;
  })();
  worldPromise = { key, promise };
  try {
    return await promise;
  } finally {
    if (worldPromise && worldPromise.promise === promise) worldPromise = null;
  }
}

function disposeWorld() {
  if (particles) { try { particles.dispose(); } catch (_) {} particles = null; }
  if (postFx) {
    try { engine.setComposer(null); } catch (_) {}
    try { postFx.dispose(); } catch (_) {}
    postFx = null;
  }
  if (world) { try { world.dispose(); } catch (_) {} }
  world = null;
  worldKey = '';
}

function makeGhostLook(view) {
  view.group.traverse(function (o) {
    if (!o.isMesh || !o.material) return;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    const next = list.map(function (m) {
      const c = m.clone();
      c.transparent = true;
      c.opacity = 0.32;
      c.depthWrite = false;
      if (c.emissive) c.emissive.setHex(0x1a6f5a);
      return c;
    });
    o.material = Array.isArray(o.material) ? next : next[0];
    o.castShadow = false;
    o.renderOrder = 3;
  });
}

function disposeRace() {
  if (!race) return;
  for (let i = 0; i < race.views.length; i++) {
    try { race.views[i].dispose(); } catch (_) {}
  }
  if (race.ghostView) { try { race.ghostView.dispose(); } catch (_) {} }
  stopVoices();
  if (headlight) { headlight.removeFromParent(); headlight.target.removeFromParent(); headlight = null; }
  if (particles) { try { particles.clear(); } catch (_) {} }
  if (world && world.skids) world.skids.clear();
  race = null;
}

function stopVoices() {
  if (!race) return;
  const list = [race.voice, race.wind].concat(race.aiVoices || []);
  for (let i = 0; i < list.length; i++) {
    if (list[i]) { try { list[i].stop(); } catch (_) {} }
  }
  race.voice = null;
  race.wind = null;
  race.aiVoices = [];
}

function pickRivals(rng, playerCarId) {
  const pool = CARS.filter(function (c) { return c.id !== playerCarId; });
  const out = [];
  while (out.length < 5) out.push(pool[out.length % pool.length]);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i]; out[i] = out[j]; out[j] = tmp;
  }
  return out;
}

function focusStage() {
  if (!touchDevice) return;
  try {
    const r = stage.getBoundingClientRect();
    if (Math.abs(r.top) > 4) stage.scrollIntoView({ block: 'start', behavior: 'smooth' });
  } catch (_) {}
}

async function startRace(m, trackId) {
  mode = m === 'tt' ? 'tt' : 'race';
  garage.close();
  focusStage();
  saveSettings({ track: trackId });
  state = 'loading';
  ui.hide();
  hud.show(false);
  setRaceChrome(false);
  const def = trackById(trackId);
  const ready = world && worldKey === trackId + '|' + qualityName();
  if (!ready) ui.loading(0.02, t('loading_track'), { kicker: trackName(def), tip: touchDevice ? t('start_hint_touch') : t('start_hint_keys'), image: def.env && def.env.backdrop ? '/assets/games/backdrops/' + def.env.backdrop + '.webp' : '' });
  try {
    await ensureWorld(trackId);
  } catch (err) {
    ui.loading(null);
    try { console.error('[nitro-racer] world build failed', err); } catch (_) {}
    ui.toast(t('fail_body'), { tone: 'warn', ms: 4000 });
    showMain();
    return;
  }
  if (!ready) ui.loading(1);
  setupRace(false);
}

function setupRace(quick) {
  disposeRace();
  const def = world.def;
  const track = world.track;
  const q = qualityName();
  const n = mode === 'tt' ? 1 : 1 + Math.min(5, def.rivals == null ? 5 : def.rivals);
  const rng = mulberry32((hashString(def.id) ^ (attemptSeed * 2654435761)) >>> 0);
  const grid = track.startGrid(Math.max(6, n));
  const playerSlot = mode === 'tt' ? 0 : Math.min(n - 1, 4);
  const playerSpec = carById(settings.car);
  const specs = [];
  const paints = [];
  const rivals = mode === 'tt' ? [] : pickRivals(rng, playerSpec.id);
  let r = 0;
  for (let i = 0; i < n; i++) {
    if (i === playerSlot) { specs.push(playerSpec); paints.push(settings.paint || playerSpec.paints[0]); continue; }
    const spec = rivals[r++];
    specs.push(spec);
    const pl = spec.paints && spec.paints.length ? spec.paints : [CAR_PAINTS[(i * 3) % CAR_PAINTS.length].id];
    paints.push(pl[Math.floor(rng() * pl.length)]);
  }
  const night = !!world.night;
  const cars = [];
  const views = [];
  const drivers = [];
  for (let i = 0; i < n; i++) {
    const g = grid[i];
    const lat = mode === 'tt' ? 0 : g.lateral;
    const car = createVehicle(vehicleParamsFromStats(specs[i].stats), { track, s: g.s, lateral: lat, index: i, lap: -1 });
    cars.push(car);
    let view;
    const opts = { lod: i === playerSlot || q === 'high' ? 'high' : 'low', envMap: world.env.envMap, color: paints[i] };
    try {
      view = (i !== playerSlot && q === 'high' && typeof createCarLOD === 'function') ? createCarLOD(specs[i], opts) : createCar(specs[i], opts);
    } catch (err) {
      view = createCar(specs[i], Object.assign({}, opts, { lod: 'low' }));
    }
    view.group.traverse(function (o) { if (o.isMesh) { o.castShadow = i === playerSlot || q === 'high'; } });
    if (view.setHeadlights) view.setHeadlights(night);
    scene.add(view.group);
    views.push(view);
    drivers.push(i === playerSlot ? null : createAIDriver(track, car, { difficulty: settings.difficulty, seed: attemptSeed * 7 + i }));
  }
  const player = cars[playerSlot];
  const inputs = new Array(n).fill(null);
  race = {
    mode, def, track, n, cars, views, drivers, specs, paints, inputs,
    pi: playerSlot,
    laps: def.laps || 3,
    passing: null,
    ctx: { cars, playerIndex: playerSlot, time: 0 },
    clock: createRaceClock({ countdown: 3 }),
    phase: 'grid',
    introT: 0,
    introLen: quick ? 0.5 : 2.4,
    time: 0,
    order: new Int8Array(n),
    place: new Int8Array(n),
    finish: new Float64Array(n).fill(Infinity),
    prev: new Float64Array(n * 7),
    lapStamp: 0,
    lapTimes: [],
    bestLap: Infinity,
    stats: { top: 0, takedowns: 0, drifts: 0 },
    perfect: { edge: null, was: false, done: false, lateUntil: 0 },
    launchT: 0,
    driftGain: 0,
    airGain: 0,
    lastGear: 1,
    finishedAt: 0,
    resultsShown: false,
    autopilot: null,
    ghostRec: null,
    ghost: null,
    ghostView: null,
    ghostS: 0,
    ghostProg: 0,
    delta: null,
    voice: null,
    wind: null,
    aiVoices: [],
    wrong: false,
    finalShown: false,
    nitroReadyShown: false,
    scrapeCool: 0
  };
  for (let i = 0; i < n; i++) { race.order[i] = i; race.place[i] = i + 1; }
  snapshotPrev();
  rankCars();
  if (mode === 'tt') setupGhost();
  setupAudio();
  if (night && qualityName() !== 'low') {
    headlight = new THREE.SpotLight(0xfff1dc, 1400, 90, 0.42, 0.6, 1.5);
    headlight.castShadow = false;
    scene.add(headlight);
    scene.add(headlight.target);
  }
  if (world.trackMeshes && world.trackMeshes.setStartLights) world.trackMeshes.setStartLights('off');
  if (world.skids) world.skids.clear();
  if (particles) particles.clear();
  hud.reset();
  hud.setUnits(settings.units);
  hud.setTouch(input.method && input.method() === 'touch');
  hud.setStandingVisible(mode !== 'tt');
  const mm = track.minimap(220);
  hud.setTrackMap(mm.points, mm.bounds || track.bounds);
  const dots = [];
  for (let i = 0; i < n; i++) dots.push({ color: '#' + ('000000' + paintHex(paints[i]).toString(16)).slice(-6), kind: i === playerSlot ? 'player' : 'rival' });
  if (race.ghostView) dots.push({ kind: 'ghost' });
  hud.setDots(dots);
  hud.show(true);
  hud.setDim(false);
  camState.init = false;
  camState.yaw = player.yaw;
  input.setSettings({ steer: settings.steer, autoGas: autoGasOn() });
  setRaceChrome(true);
  state = 'race';
  ui.hide();
  engine.pause(false);
  if (testAutopilot) enableAutopilot(true);
}

function paintHex(id) {
  try { return paintById(id).hex; } catch (_) { return 0xcccccc; }
}

function setupGhost() {
  race.ghostRec = createRecorder(GHOST_HZ, { maxSeconds: 900 });
  const str = safeGhost(race.def.id);
  if (!str) return;
  const g = decodeGhost(str);
  if (!g) return;
  race.ghost = g;
  let meta = null;
  try { meta = g.metaData || (typeof g.meta === 'string' && g.meta ? JSON.parse(g.meta) : g.meta) || null; } catch (_) { meta = null; }
  const spec = carById((meta && meta.car) || settings.car);
  try {
    const view = createCar(spec, { lod: 'low', envMap: world.env.envMap, color: (meta && meta.paint) || 'mint' });
    makeGhostLook(view);
    view.group.visible = settings.ghost !== false;
    scene.add(view.group);
    race.ghostView = view;
  } catch (_) {
    race.ghostView = null;
  }
  race.ghostS = race.cars[race.pi].s;
  race.ghostProg = race.cars[race.pi].progress;
}

function setupAudio() {
  try {
    race.voice = audio.carEngine(engineSpecFor(race.specs[race.pi]));
    race.wind = audio.wind();
    if (race.n > 1) {
      for (let k = 0; k < 2; k++) {
        const v = audio.carEngine(engineSpecFor(race.specs[(race.pi + k + 1) % race.n], { lite: true, volume: 0.5 }));
        v.set({ volume: 0 });
        race.aiVoices.push(v);
      }
    }
  } catch (_) {}
}

function restartRace() {
  if (!world || !race) return;
  attemptSeed += 1;
  const keepMode = race.mode;
  mode = keepMode;
  setupRace(true);
}

function quitToMenu() {
  disposeRace();
  engine.pause(false);
  hud.show(false);
  showMain();
}

function requestPause() {
  if (state !== 'race' || !race) return;
  state = 'paused';
  engine.pause(true, 'menu');
  hud.setDim(true);
  setRaceChrome(false);
  muteVoices(true);
  showPause();
}

function showPause() {
  ui.screen('pause', pauseSpec());
  ui.show('pause');
}

function resume() {
  if (state !== 'paused') return;
  ui.hide();
  state = 'race';
  hud.setDim(false);
  setRaceChrome(true);
  muteVoices(false);
  engine.pause(false);
}

function muteVoices(on) {
  if (!race) return;
  const list = [race.voice, race.wind].concat(race.aiVoices || []);
  for (let i = 0; i < list.length; i++) {
    if (list[i]) { try { list[i].set({ volume: on ? 0 : 1 }); } catch (_) {} }
  }
}

function enableAutopilot(on) {
  testAutopilot = !!on;
  if (!race) return;
  if (on && !race.autopilot) race.autopilot = createAIDriver(race.track, race.cars[race.pi], { difficulty: 'hard', seed: 99 });
  if (!on && race.phase !== 'finished') race.autopilot = null;
}

function snapshotPrev() {
  const cars = race.cars;
  const p = race.prev;
  for (let i = 0; i < cars.length; i++) {
    const c = cars[i];
    const o = i * 7;
    p[o] = c.x; p[o + 1] = c.y; p[o + 2] = c.z;
    p[o + 3] = c.quat.x; p[o + 4] = c.quat.y; p[o + 5] = c.quat.z; p[o + 6] = c.quat.w;
  }
}

function rankCars() {
  const order = race.order;
  const cars = race.cars;
  const fin = race.finish;
  for (let i = 1; i < order.length; i++) {
    const a = order[i];
    let j = i - 1;
    while (j >= 0 && ahead(a, order[j], cars, fin)) {
      order[j + 1] = order[j];
      j--;
    }
    order[j + 1] = a;
  }
  for (let k = 0; k < order.length; k++) race.place[order[k]] = k + 1;
}

function ahead(a, b, cars, fin) {
  const fa = fin[a] < Infinity;
  const fb = fin[b] < Infinity;
  if (fa !== fb) return fa;
  if (fa) return fin[a] < fin[b];
  return cars[a].progress > cars[b].progress;
}

function readPlayerInput() {
  const steer = input.axis('steer') || 0;
  const gas = input.axis('gas') || 0;
  const brake = input.axis('brake') || 0;
  const nitroBtn = input.button('nitro');
  const driftBtn = input.button('drift');
  pIn.steer = clamp(steer, -1, 1);
  pIn.throttle = clamp(gas, 0, 1);
  pIn.brake = clamp(brake, 0, 1);
  pIn.nitro = !!(nitroBtn && nitroBtn.down) || race.launchT > 0;
  pIn.drift = !!(driftBtn && driftBtn.down);
  return pIn;
}

function onStep(dt) {
  if (stepFrame !== frameId) {
    stepFrame = frameId;
    input.update(lastFrameDt);
  }
  if (!race || state !== 'race') return;
  const R = race;
  if (R.phase === 'grid') {
    R.introT += dt;
    if (R.introT >= R.introLen) {
      R.phase = 'countdown';
      R.clock.start();
    }
    trackPerfectStart(false);
    return;
  }
  if (R.phase === 'countdown') {
    const ev = R.clock.step(dt);
    if (ev.tick != null && ev.tick > 0) {
      ui.countdown(ev.tick);
      try { audio.play('countdown'); } catch (_) {}
      if (world.trackMeshes.setStartLights) world.trackMeshes.setStartLights(ev.tick >= 3 ? 2 : ev.tick === 2 ? 4 : 5);
    }
    trackPerfectStart(false);
    if (ev.go) {
      R.phase = 'racing';
      R.time = 0;
      ui.countdown(0);
      try { audio.play('go'); } catch (_) {}
      if (world.trackMeshes.setStartLights) world.trackMeshes.setStartLights('go');
      trackPerfectStart(true);
    }
    return;
  }
  simulate(dt);
}

function trackPerfectStart(atGo) {
  const R = race;
  if (R.perfect.done) return;
  const auto = autoGasOn() && input.method && input.method() === 'touch';
  const press = auto ? !!(input.button('nitro') && input.button('nitro').down) : (input.axis('gas') || 0) > 0.5;
  if (press && !R.perfect.was) R.perfect.edge = R.phase === 'countdown' ? R.clock.remaining : (R.phase === 'racing' ? -R.time : 9);
  if (!press) R.perfect.edge = null;
  R.perfect.was = press;
  if (atGo) {
    if (press && R.perfect.edge != null && R.perfect.edge <= 0.4) grantPerfectStart();
    else R.perfect.lateUntil = 0.2;
  }
}

function grantPerfectStart() {
  const R = race;
  if (R.perfect.done) return;
  R.perfect.done = true;
  const car = R.cars[R.pi];
  car.nitro = Math.min(1, car.nitro + 0.2);
  R.launchT = 1.15;
  hud.toast('start', t('toast_perfect_start'), 0.2);
  try { audio.play('boost', { intensity: 0.8 }); } catch (_) {}
  try { input.feedback('boost'); } catch (_) {}
  if (shake) shake.add(0.25);
}

function simulate(dt) {
  const R = race;
  const cars = R.cars;
  const pi = R.pi;
  snapshotPrev();
  R.time += dt;
  R.ctx.time = R.time;
  if (R.perfect.lateUntil > 0 && !R.perfect.done) {
    R.perfect.lateUntil -= dt;
    const auto = autoGasOn() && input.method && input.method() === 'touch';
    const press = auto ? !!(input.button('nitro') && input.button('nitro').down) : (input.axis('gas') || 0) > 0.5;
    if (press && !R.perfect.was) grantPerfectStart();
    R.perfect.was = press;
  }
  if (R.launchT > 0) R.launchT = Math.max(0, R.launchT - dt);
  for (let i = 0; i < R.n; i++) {
    if (i === pi) {
      if (R.autopilot) {
        autoCtx.cars = cars;
        autoCtx.time = R.time;
        R.inputs[i] = R.autopilot.update(dt, autoCtx);
      } else {
        R.inputs[i] = readPlayerInput();
      }
    } else {
      R.inputs[i] = R.drivers[i].update(dt, R.ctx);
    }
  }
  R.passing = stepVehicles(cars, R.inputs, dt, R.track, R.passing);
  for (let i = 0; i < R.n; i++) handleCarEvents(i, dt);
  rankCars();
  if (R.ghostRec && R.phase === 'racing') {
    const p = cars[pi];
    ghostExtra[0] = p.boosting ? 1 : 0;
    R.ghostRec.push(R.time, p, p.quat, ghostExtra);
  }
  if (R.phase === 'finished' && !R.resultsShown) {
    R.finishedAt += dt;
    if (R.finishedAt > 1.6) showResults();
  }
}

function burstAt(kind, car, lx, ly, lz, count, up) {
  if (!particles) return;
  const s = Math.sin(car.yaw);
  const c = Math.cos(car.yaw);
  v3a.set(car.x + c * lx + s * lz, car.y + ly, car.z - s * lx + c * lz);
  v3b.set(0, up == null ? 1 : up, 0);
  burstOpts.velocity.x = car.vx * 0.5;
  burstOpts.velocity.z = car.vz * 0.5;
  try { particles.burst(kind, v3a, v3b, count, burstOpts); } catch (_) {}
}

function handleCarEvents(i, dt) {
  const R = race;
  const car = R.cars[i];
  const ev = car.ev;
  const isP = i === R.pi;
  const near = isP || camDistance(car) < 90;
  if (ev.scrape > 0.15 && near) {
    if (Math.random() < 0.35) {
      const side = car.lateral > 0 ? 1 : -1;
      burstAt('spark', car, side * 1.0, 0.35, -0.6, 3 + Math.round(ev.scrape * 5), 0.6);
    }
    if (isP && !R.scrapeCool) {
      R.scrapeCool = 0.14;
      try { audio.play('scrape', { intensity: ev.scrape, volume: 0.9 }); } catch (_) {}
      if (shake) shake.add(0.05 * ev.scrape);
    }
  }
  if (isP && R.scrapeCool) R.scrapeCool = Math.max(0, R.scrapeCool - dt);
  if (ev.bump > 0.12 && near) {
    if (isP || ev.bumpWith === R.pi) {
      try { audio.play('crash', { intensity: clamp(ev.bump * 0.7, 0.15, 0.8), volume: 0.8 }); } catch (_) {}
      if (shake) shake.add(0.18 * ev.bump);
      try { input.feedback('bump'); } catch (_) {}
    }
    burstAt('spark', car, 0, 0.5, -1.6, 6, 0.8);
  }
  if (ev.crash > 0 && near) {
    burstAt('debris', car, 0, 0.6, 0, 10, 1);
    burstAt('smoke', car, 0, 0.4, 0, 6, 0.5);
    if (isP) {
      try { audio.play('crash', { intensity: ev.crash }); } catch (_) {}
      if (shake) shake.add(0.5 * ev.crash);
      try { input.feedback('crash'); } catch (_) {}
    }
  }
  if (ev.land > 0 && near) {
    burstAt('dust', car, 0, 0.1, 0.8, 8 + Math.round(ev.land * 10), 0.6);
    if (isP) {
      if (shake) shake.add(0.35 * ev.land);
      try { input.feedback('land'); } catch (_) {}
    }
  }
  if (!isP) {
    if (ev.lap) aiLap(i);
    return;
  }
  const p = car;
  if (ev.nitroGained > 0) {
    if (p.drift) R.driftGain += ev.nitroGained;
    else if (!p.grounded) R.airGain += ev.nitroGained;
  }
  if (ev.driftStart) R.driftGain = 0;
  if (ev.driftEnd) {
    if (ev.driftTime > 0.75 && R.phase === 'racing') {
      R.stats.drifts += 1;
      hud.toast('drift', t('toast_drift'), R.driftGain);
    }
    R.driftGain = 0;
  }
  if (ev.takeoff) R.airGain = 0;
  if (ev.land > 0) {
    if (p.airTime === 0 && R.airGain > 0.01) hud.toast('air', t('toast_airtime'), R.airGain);
    R.airGain = 0;
  }
  if (ev.nearMiss) hud.toast('near', t('toast_near_miss'), 0.05 * p.params.nitroGain);
  else if (ev.overtake && R.phase === 'racing') hud.toast('info', t('toast_overtake'), 0.06 * p.params.nitroGain);
  if (ev.takedown) {
    R.stats.takedowns += 1;
    hud.toast('takedown', t('toast_takedown'), 0.3 * p.params.nitroGain);
    if (shake) shake.add(0.3);
  }
  if (ev.wrecked) {
    hud.toast('bad', t('toast_wrecked'), 0);
  }
  if (ev.nitroStart) {
    try { audio.play('boost', { intensity: 0.7 }); } catch (_) {}
    try { input.feedback('boost'); } catch (_) {}
  }
  if (ev.nitroFull && R.phase === 'racing') hud.toast('info', t('toast_nitro_ready'), 0);
  if (p.speed > R.stats.top) R.stats.top = p.speed;
  if (ev.lap) playerLap();
  const wrongNow = p.wrongT > 1.5 && R.phase === 'racing';
  if (wrongNow !== R.wrong) {
    R.wrong = wrongNow;
    hud.setWrongWay(wrongNow);
  }
}

function aiLap(i) {
  const R = race;
  const car = R.cars[i];
  if (car.lap >= R.laps && R.finish[i] === Infinity) R.finish[i] = R.time;
}

function playerLap() {
  const R = race;
  const p = R.cars[R.pi];
  if (R.phase !== 'racing') return;
  if (p.lap >= 1 && p.lap > R.lapTimes.length) {
    const lapTime = R.time - R.lapStamp;
    R.lapStamp = R.time;
    R.lapTimes.push(lapTime);
    const isBest = lapTime < R.bestLap;
    if (isBest) R.bestLap = lapTime;
    if (p.lap < R.laps) {
      hud.toast(isBest && R.lapTimes.length > 1 ? 'best' : 'lap', fill(t('toast_lap'), p.lap) + '  ' + formatRacerTime(lapTime), isBest && R.lapTimes.length > 1 ? t('toast_best_lap') : '');
      try { audio.play('lap'); } catch (_) {}
    }
  }
  if (p.lap === R.laps - 1 && R.laps > 1 && !R.finalShown) {
    R.finalShown = true;
    hud.finalLap();
  }
  if (p.lap >= R.laps && R.finish[R.pi] === Infinity) finishPlayer();
}

function finishPlayer() {
  const R = race;
  R.finish[R.pi] = R.time;
  R.phase = 'finished';
  R.finishedAt = 0;
  R.autopilot = createAIDriver(R.track, R.cars[R.pi], { difficulty: 'normal', seed: 5 });
  hud.setWrongWay(false);
  try { audio.play('finish'); } catch (_) {}
  rankCars();
  const place = R.place[R.pi];
  if (particles && (R.mode === 'tt' || place <= 3)) {
    const p = R.cars[R.pi];
    v3a.set(p.x, p.y + 4, p.z);
    v3b.set(0, 1, 0);
    try { particles.burst('confetti', v3a, v3b, 90); } catch (_) {}
  }
  setRaceChrome(false);
}

function estimateFinish(i) {
  const R = race;
  if (R.finish[i] < Infinity) return R.finish[i];
  const car = R.cars[i];
  const total = R.laps * R.track.length;
  const avg = Math.max(18, Math.max(1, car.progress) / Math.max(1, R.time));
  return R.time + Math.max(0, total - car.progress) / avg;
}

function showResults() {
  const R = race;
  R.resultsShown = true;
  const pi = R.pi;
  const time = R.finish[pi];
  const def = R.def;
  const rows = [];
  let medal = null;
  let place = 1;
  const roomy = (engine.size && engine.size.height) >= 520;
  if (R.mode === 'race') {
    const order = [];
    for (let i = 0; i < R.n; i++) order.push({ i, time: estimateFinish(i) });
    order.sort(function (a, b) { return a.time - b.time; });
    for (let k = 0; k < order.length; k++) if (order[k].i === pi) place = k + 1;
    medal = place === 1 ? 'gold' : place === 2 ? 'silver' : place === 3 ? 'bronze' : null;
    const shown = roomy ? 3 : 1;
    for (let k = 0; k < order.length; k++) {
      const o = order[k];
      if (k >= shown && o.i !== pi) continue;
      if (!roomy && o.i !== pi) continue;
      const name = o.i === pi ? t('res_you') : carName(R.specs[o.i]);
      const value = k === 0 ? formatRacerTime(o.time) : '+' + numberText(o.time - order[0].time, 2);
      rows.push({ label: (k + 1) + '  ' + name, value, good: o.i === pi ? true : undefined });
    }
  } else {
    medal = medalFor(time, def.medals);
  }
  rows.push({ label: t('res_best_lap'), value: formatRacerTime(R.bestLap) });
  rows.push({ label: t('res_top_speed'), value: Math.round(R.stats.top * (settings.units === 'mph' ? 2.2369363 : KMH)) + ' ' + t(settings.units === 'mph' ? 'units_mph' : 'units_kmh') });
  if (roomy) {
    if (R.mode === 'race') rows.push({ label: t('res_takedowns'), value: String(R.stats.takedowns) });
    else rows.push({ label: t('res_drifts'), value: String(R.stats.drifts) });
  }
  const key = recordKey(R.mode, def.id);
  const prev = safeRecord(key);
  let saved = { isBest: false };
  try { saved = store.saveRecord(key, { time, medal, place: R.mode === 'race' ? place : undefined, car: settings.car, bestLap: R.bestLap }); } catch (_) {}
  let ghostSaved = false;
  if (R.mode === 'tt' && R.ghostRec && saved && saved.isBest) {
    try {
      const str = R.ghostRec.encode({ v: 1, car: settings.car, paint: settings.paint, time: Math.round(time * 1000) / 1000, track: def.id });
      ghostSaved = !!store.saveGhost(def.id, str);
    } catch (_) { ghostSaved = false; }
    if (ghostSaved) rows.push({ label: t('ghost_label'), value: t('res_ghost_saved'), good: true });
  }
  const idx = TRACKS.findIndex(function (d) { return d.id === def.id; });
  const nextDef = TRACKS[(idx + 1) % TRACKS.length];
  lastResults = { mode: R.mode, track: def.id, time, place, medal, bestLap: R.bestLap, isBest: !!(saved && saved.isBest), ghostSaved, rows };
  const spec = {
    type: 'results',
    kicker: trackName(def),
    title: R.mode === 'tt' ? t('res_tt') : t('res_race'),
    subtitle: carName(R.specs[pi]),
    time,
    medal,
    position: R.mode === 'race' ? { place, of: R.n } : null,
    best: prev && typeof prev.time === 'number' ? prev.time : undefined,
    isNewBest: !!(saved && saved.isBest && prev),
    rows,
    items: [
      { id: 'retry', label: t('res_retry'), primary: true },
      { id: 'next', label: t('res_next'), hint: trackName(nextDef) },
      { id: 'garage', label: t('res_garage') },
      { id: 'menu', label: t('res_menu') }
    ],
    onReveal: function (m) { try { audio.play('medal', { medal: m || 'none' }); } catch (_) {} },
    onSelect: function (id) {
      if (id === 'retry') { ui.hide(); restartRace(); }
      else if (id === 'next') startRace(R.mode, nextDef.id);
      else if (id === 'garage') { quitToMenu(); onMainSelect('garage'); }
      else if (id === 'menu') quitToMenu();
    },
    onBack: quitToMenu
  };
  ui.screen('results', spec);
  ui.show('results');
  hud.setDim(true);
}

function camDistance(car) {
  const dx = car.x - camera.position.x;
  const dz = car.z - camera.position.z;
  return Math.sqrt(dx * dx + dz * dz);
}

function angleLerp(a, b, k) {
  return a + wrapAngle(b - a) * k;
}

function dampAngle(a, b, lambda, dt) {
  return a + wrapAngle(b - a) * (1 - Math.exp(-lambda * dt));
}

function syncCarView(i, alpha) {
  const R = race;
  const c = R.cars[i];
  const v = R.views[i];
  const o = i * 7;
  const p = R.prev;
  const x = lerp(p[o], c.x, alpha);
  const y = lerp(p[o + 1], c.y, alpha);
  const z = lerp(p[o + 2], c.z, alpha);
  v.group.position.set(x, y, z);
  qa.set(p[o + 3], p[o + 4], p[o + 5], p[o + 6]);
  qb.set(c.quat.x, c.quat.y, c.quat.z, c.quat.w);
  qa.slerp(qb, alpha);
  eul.set(c.lean.pitch, 0, c.lean.roll, 'YXZ');
  qLean.setFromEuler(eul);
  v.group.quaternion.copy(qa).multiply(qLean);
  if (v.setSteer) v.setSteer(c.steerAngle);
  if (v.setSpin) v.setSpin(c.wheelSpin);
  if (v.setBrake) v.setBrake(c.brake > 0.1 || (c.reverse && c.speed > 0.5) ? 1 : 0);
  if (v.setNitro) v.setNitro(c.boosting);
}

function carFx(i, frameDt) {
  const R = race;
  const c = R.cars[i];
  const ids = smokeIds[i];
  const dist = camDistance(c);
  if (dist > 140) {
    if (world.skids) { world.skids.lift(ids[2]); world.skids.lift(ids[3]); }
    return;
  }
  const s = Math.sin(c.yaw);
  const co = Math.cos(c.yaw);
  const rx = co;
  const rz = -s;
  const fx = -s;
  const fz = -co;
  const skidding = c.grounded && c.skid > 0.3 && c.speed > 4;
  for (let side = -1; side <= 1; side += 2) {
    const wx = c.x + rx * HALF_TRACK * side - fx * REAR_Z;
    const wz = c.z + rz * HALF_TRACK * side - fz * REAR_Z;
    const id = side < 0 ? ids[2] : ids[3];
    if (skidding && world.skids) world.skids.add(id, wx, c.y + 0.035, wz, rx, rz, 0.27, clamp(0.25 + c.skid * 0.45, 0, 0.75));
    else if (world.skids) world.skids.lift(id);
    if (particles && skidding && c.drift && dist < 90) {
      v3a.set(wx, c.y + 0.25, wz);
      smokeTrail.rate = 22 + 26 * c.skid;
      try { particles.trail(side < 0 ? ids[0] : ids[1], v3a, smokeTrail); } catch (_) {}
    }
  }
  if (particles && c.boosting && dist < 60) {
    v3a.set(c.x - fx * 2.5, c.y + 0.42, c.z - fz * 2.5);
    try { particles.trail(ids[4], v3a, flameTrail); } catch (_) {}
  }
}

function updateCamera(alpha, dt) {
  const R = race;
  const c = R.cars[R.pi];
  const o = R.pi * 7;
  const px = lerp(R.prev[o], c.x, alpha);
  const py = lerp(R.prev[o + 1], c.y, alpha);
  const pz = lerp(R.prev[o + 2], c.z, alpha);
  const top = c.params.topSpeed;
  const sf = clamp(c.speed / top, 0, 1.25);
  camState.boost = damp(camState.boost, c.boosting ? 1 : 0, 3.5, dt);
  const lookBack = !!(input.button('lookBack') && input.button('lookBack').down) && R.phase !== 'grid';
  const baseYaw = c.reverse ? c.yaw : angleLerp(c.vHeading, c.yaw, 0.45);
  if (!camState.init) {
    camState.yaw = baseYaw;
    camState.y = py;
    camState.fov = 64;
    camState.init = true;
  }
  camState.yaw = dampAngle(camState.yaw, baseYaw, 4.5 + 3.5 * Math.min(sf, 1), dt);
  camState.y = damp(camState.y, py, c.grounded ? 10 : 3.2, dt);
  let fov;
  if (R.phase === 'grid') {
    const k = clamp(R.introT / Math.max(0.01, R.introLen), 0, 1);
    const e = k * k * (3 - 2 * k);
    const yaw = c.yaw + Math.PI * (1 - e) * 0.85;
    const dist = lerp(14, 6.6, e);
    const h = lerp(5.2, 2.15, e);
    camera.position.set(px + Math.sin(yaw) * dist, py + h, pz + Math.cos(yaw) * dist);
    v3a.set(px - Math.sin(c.yaw) * 3 * e, py + 1.0, pz - Math.cos(c.yaw) * 3 * e);
    camera.lookAt(v3a);
    fov = lerp(52, 64, e);
    camState.yaw = c.yaw;
  } else if (lookBack) {
    const yaw = c.yaw;
    camera.position.set(px - Math.sin(yaw) * 4.2, py + 1.75, pz - Math.cos(yaw) * 4.2);
    v3a.set(px + Math.sin(yaw) * 12, py + 1.1, pz + Math.cos(yaw) * 12);
    camera.lookAt(v3a);
    fov = 66;
  } else if (camState.mode === 'hood' && R.phase !== 'finished') {
    const v = R.views[R.pi];
    const front = v.dims && typeof v.dims.front === 'number' ? Math.min(-1.6, v.dims.front) : -2.3;
    v3a.set(0, 0.74, front - 0.32).applyQuaternion(v.group.quaternion).add(v.group.position);
    camera.position.copy(v3a);
    v3b.set(0, 0.62, front - 14).applyQuaternion(v.group.quaternion).add(v.group.position);
    camera.lookAt(v3b);
    fov = 74 + 10 * Math.min(sf, 1) + 7 * camState.boost;
  } else {
    const yaw = camState.yaw;
    const dist = 5.3 + 1.5 * Math.min(sf, 1.1) + 1.0 * camState.boost;
    const h = 1.8 + 0.3 * Math.min(sf, 1);
    let cx = px + Math.sin(yaw) * dist;
    let cz = pz + Math.cos(yaw) * dist;
    let cy = camState.y + h;
    const ground = world.terrain.heightAt(cx, cz) + 0.8;
    if (cy < ground) cy = ground;
    camera.position.set(cx, cy, cz);
    v3a.set(px - Math.sin(yaw) * 5.5, camState.y + 0.95, pz - Math.cos(yaw) * 5.5);
    camera.lookAt(v3a);
    fov = 62 + 12 * Math.min(sf, 1.1) + 9 * camState.boost;
  }
  camState.fov = damp(camState.fov, fov, 6, dt);
  if (Math.abs(camera.fov - camState.fov) > 0.01) {
    camera.fov = camState.fov;
    camera.updateProjectionMatrix();
  }
  if (shake) {
    if (c.boosting && c.grounded) shake.add(0.012);
    shake.update(dt);
    shake.apply(camera);
  }
}

function updateAttractCamera(dt) {
  const tr = world.track;
  camState.flyS = tr.wrapS(camState.flyS + dt * 24);
  const s = camState.flyS;
  const a = tr.pointAt(s, 0, 9);
  const b = tr.pointAt(s + 40, 0, 2);
  camera.position.set(a.x, a.y, a.z);
  camera.lookAt(b.x, b.y, b.z);
  if (Math.abs(camera.fov - 60) > 0.01) {
    camera.fov = 60;
    camera.updateProjectionMatrix();
  }
}

function updateAudio(dt) {
  const R = race;
  const c = R.cars[R.pi];
  if (R.voice) {
    const revving = R.phase === 'countdown' || R.phase === 'grid';
    const gas = revving ? (input.axis('gas') || 0) : c.throttle;
    const rpm = revving ? 0.18 + 0.6 * gas : c.rpm;
    voicePatch.rpm = clamp(rpm, 0, 1);
    voicePatch.throttle = gas;
    voicePatch.nitro = c.boosting ? 1 : 0;
    voicePatch.skid = c.grounded ? c.skid : 0;
    R.voice.set(voicePatch);
    if (c.gear !== R.lastGear && R.voice.shift) {
      R.voice.shift(c.gear > R.lastGear);
      R.lastGear = c.gear;
    }
  }
  if (R.wind) {
    windPatch.speed = clamp(c.speed / 70, 0, 1.2);
    R.wind.set(windPatch);
  }
  if (R.aiVoices.length) {
    let a = -1;
    let b = -1;
    let da = Infinity;
    let db = Infinity;
    for (let i = 0; i < R.n; i++) {
      if (i === R.pi) continue;
      const d = camDistance(R.cars[i]);
      if (d < da) { db = da; b = a; da = d; a = i; }
      else if (d < db) { db = d; b = i; }
    }
    nearPair[0] = a; nearPair[1] = b;
    nearDist[0] = da; nearDist[1] = db;
    const pair = nearPair;
    const dist = nearDist;
    camera.getWorldDirection(v3b);
    for (let k = 0; k < R.aiVoices.length; k++) {
      const i = pair[k];
      const v = R.aiVoices[k];
      if (i < 0) { v.set(mutePatch); continue; }
      const car = R.cars[i];
      const vol = clamp(1 - dist[k] / 70, 0, 1) * 0.55;
      const dx = car.x - camera.position.x;
      const dz = car.z - camera.position.z;
      const pan = clamp((dx * -v3b.z + dz * v3b.x) / Math.max(dist[k], 1), -1, 1);
      aiPatch.rpm = car.rpm;
      aiPatch.throttle = car.throttle;
      aiPatch.nitro = car.boosting ? 1 : 0;
      aiPatch.skid = car.skid * 0.6;
      aiPatch.volume = vol;
      aiPatch.pan = pan;
      v.set(aiPatch);
    }
  }
}

function updateGhostView() {
  const R = race;
  if (!R.ghost || !R.ghostView) return;
  const tm = R.phase === 'racing' || R.phase === 'finished' ? R.time : 0;
  R.ghost.sample(tm, ghostOut);
  const g = R.ghostView.group;
  g.position.set(ghostOut.pos.x, ghostOut.pos.y, ghostOut.pos.z);
  g.quaternion.set(ghostOut.quat.x, ghostOut.quat.y, ghostOut.quat.z, ghostOut.quat.w);
  if (R.ghostView.setNitro) R.ghostView.setNitro(ghostOut.extra && ghostOut.extra[0] > 0.5);
  if (R.phase !== 'racing') { R.delta = null; return; }
  const proj = R.track.project(ghostOut.pos, R.ghostS, projOut);
  const ds = R.track.deltaS(R.ghostS, proj.s);
  R.ghostS = proj.s;
  R.ghostProg += ds;
  const p = R.cars[R.pi];
  const gap = R.ghostProg - p.progress;
  R.delta = clamp(gap / Math.max(p.speed, 12), -99, 99);
}

function onRender(alpha, dt) {
  lastFrameDt = dt > 0 ? Math.min(dt, 0.1) : lastFrameDt;
  if (stepFrame !== frameId) input.update(lastFrameDt);
  frameId++;
  const size = engine.size;
  if (garage.isOpen) {
    renderer.toneMappingExposure = 1;
    garage.render(dt, size.width, size.height);
    return;
  }
  if (!world) {
    renderer.setClearColor(0x04060a, 1);
    renderer.clear();
    return;
  }
  if (race && (state === 'race' || state === 'paused')) {
    if (state === 'race') {
      const cam = input.button('camera');
      if (cam && cam.pressed) {
        camState.mode = camState.mode === 'hood' ? 'chase' : 'hood';
        saveSettings({ camera: camState.mode });
      }
      const rs = input.button('restart');
      if (rs && rs.pressed) restartRace();
    }
    const R = race;
    if (!R) return;
    const a = state === 'paused' ? 1 : alpha;
    for (let i = 0; i < R.n; i++) syncCarView(i, a);
    updateCamera(a, state === 'paused' ? 0 : dt);
    if (state === 'race') {
      for (let i = 0; i < R.n; i++) carFx(i, dt);
      if (world.skids) world.skids.flush();
      updateAudio(dt);
    }
    updateGhostView();
    if (headlight) {
      const v = R.views[R.pi];
      v3a.set(0, 0.75, -1.9).applyQuaternion(v.group.quaternion).add(v.group.position);
      headlight.position.copy(v3a);
      v3b.set(0, -0.6, -22).applyQuaternion(v.group.quaternion).add(v.group.position);
      headlight.target.position.copy(v3b);
    }
    const p = R.cars[R.pi];
    const hf = hudFrame;
    hf.speed = p.speed;
    hf.gear = p.gear;
    hf.reverse = p.reverse;
    hf.rpm = p.rpm;
    hf.nitro = p.nitro;
    hf.boosting = p.boosting;
    hf.position = R.place[R.pi];
    hf.total = R.n;
    hf.lap = clamp(p.lap + 1, 1, R.laps);
    hf.laps = R.laps;
    hf.time = R.phase === 'racing' || R.phase === 'finished' ? (R.finish[R.pi] < Infinity ? R.finish[R.pi] : R.time) : 0;
    hf.lapTime = R.phase === 'racing' ? R.time - R.lapStamp : 0;
    hf.bestLap = R.bestLap;
    hf.delta = R.mode === 'tt' ? R.delta : null;
    hud.update(hf);
    try { input.setMeter('nitro', p.nitro, p.nitro > 0.12); } catch (_) {}
    mapTick++;
    if (mapTick % 3 === 0) {
      for (let i = 0; i < R.n; i++) hud.setDot(i, R.cars[i].x, R.cars[i].z, true);
      if (R.ghostView) hud.setDot(R.n, R.ghostView.group.position.x, R.ghostView.group.position.z, R.ghostView.group.visible && R.phase === 'racing');
      hud.drawMap();
    }
    if (postFx) {
      const kmh = p.speed * KMH;
      postFx.setSpeedFx(clamp((kmh - 170) / 150, 0, 1) * 0.55 + (p.boosting ? 0.3 : 0));
    }
  } else {
    updateAttractCamera(dt);
    if (postFx) postFx.setSpeedFx(0);
  }
  if (world.env && typeof world.env.exposure === 'number') renderer.toneMappingExposure = world.env.exposure;
  world.update(camera, dt);
  if (particles) {
    try { particles.update(dt, camera); } catch (_) {}
  }
  renderer.info.reset();
  if (postFx) postFx.render(dt);
  else renderer.render(scene, camera);
  frameStats.calls = renderer.info.render.calls;
  frameStats.triangles = renderer.info.render.triangles;
}

document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'hidden' && state === 'race') requestPause();
});

if (helpEl) {
  helpEl.addEventListener('toggle', function (e) {
    if (e && e.newState === 'open' && state === 'race') requestPause();
  });
}

document.addEventListener('mentria:localechange', function () {
  const I = window.MentriaI18n;
  if (I && typeof I.t === 'function') {
    Object.keys(COPY).forEach(function (k) {
      if (k === 'lang') return;
      const v = I.t(k);
      if (typeof v === 'string' && v && v !== k) COPY[k] = v;
    });
    try { if (typeof I.locale === 'function') COPY.lang = I.locale(); } catch (_) {}
  }
  try { ui.setCopy(kitUiCopy()); } catch (_) {}
  try { input.setCopy(kitInputCopy()); } catch (_) {}
  hud.applyCopy();
  garage.applyCopy();
  const cur = ui.current && ui.current();
  if (cur === 'main') ui.update('main', mainSpec());
  else if (cur === 'tracks') ui.update('tracks', tracksSpec());
  else if (cur === 'settings') ui.update('settings', settingsSpec());
  else if (cur === 'pause') ui.update('pause', pauseSpec());
});

function finishBoot() {
  bootProgress(1);
  if (bootEl) {
    bootEl.classList.add('is-done');
    setTimeout(function () { bootEl.hidden = true; }, 400);
  }
}

function prebuildWorld() {
  const id = settings.track;
  setTimeout(function () {
    if (world || worldPromise || state === 'loading') return;
    ensureWorld(id).catch(function (err) {
      try { console.warn('[nitro-racer] background world build failed: ' + (err && err.message)); } catch (_) {}
    });
  }, 450);
}

function testState() {
  const R = race;
  const p = R ? R.cars[R.pi] : null;
  return {
    state,
    mode,
    track: R ? R.def.id : null,
    phase: R ? R.phase : null,
    time: R ? R.time : 0,
    lap: p ? p.lap : null,
    laps: R ? R.laps : null,
    place: R ? R.place[R.pi] : null,
    speedKmh: p ? p.speed * KMH : 0,
    nitro: p ? p.nitro : 0,
    progress: p ? p.progress : 0,
    lateral: p ? p.lateral : 0,
    finished: R ? R.finish[R.pi] < Infinity : false,
    finishTime: R && R.finish[R.pi] < Infinity ? R.finish[R.pi] : null,
    lapTimes: R ? R.lapTimes.slice() : [],
    fps: engine.stats.fps,
    frameMs: engine.stats.frameMs,
    cpuMs: Math.round(engine.stats.cpuMs * 100) / 100,
    quality: qualityName(),
    worldMs: world ? world.buildMs : null,
    worldTimings: world ? world.timings : null,
    results: lastResults,
    camera: camState.mode,
    draw: { calls: frameStats.calls, triangles: frameStats.triangles }
  };
}

if (TEST) {
  window.__nitroTest = {
    start: function (trackId, m, o) {
      if (o && o.autopilot) testAutopilot = true;
      return startRace(m || 'race', trackId || settings.track).then(function () { return testState(); });
    },
    autopilot: function (on) { enableAutopilot(on !== false); return !!(race && race.autopilot); },
    skipIntro: function () {
      if (race && race.phase === 'grid') race.introT = race.introLen;
      return testState();
    },
    fastForward: function (seconds, maxSteps) {
      const steps = Math.min(maxSteps || 1e6, Math.round((seconds || 0) * 120));
      for (let k = 0; k < steps; k++) {
        onStep(1 / 120);
        if (!race || race.resultsShown) break;
      }
      return testState();
    },
    timeScale: function (s) { try { engine.setTimeScale(s); } catch (_) {} return s; },
    state: testState,
    menu: function () { quitToMenu(); return state; },
    garage: function () { quitToMenu(); onMainSelect('garage'); return state; },
    tracks: function (m) { mode = m === 'tt' ? 'tt' : 'race'; showTracks(); return state; },
    settings: function () { showSettings(); return state; },
    pause: function () { requestPause(); return state; },
    resume: function () { resume(); return state; },
    setCamera: function (m) { camState.mode = m === 'hood' ? 'hood' : 'chase'; return camState.mode; },
    setQuality: function (q) { saveSettings({ quality: q }); try { engine.setQuality(qualityName()); } catch (_) {} return qualityName(); },
    inject: function (patch) { if (race) Object.assign(race.cars[race.pi], patch || {}); return testState(); },
    toast: function (kind, label, gain) { hud.toast(kind, label, gain); },
    get race() { return race; },
    get world() { return world; },
    get engine() { return engine; },
    get hud() { return hud; },
    get ui() { return ui; }
  };
}

bootProgress(0.7, t('boot_loading'));
engine.start();
showMain();
finishBoot();
prebuildWorld();
