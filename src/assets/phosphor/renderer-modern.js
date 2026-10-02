import * as THREE from 'three';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import * as KitEnv from '../games/kit/env.js';
import * as KitFx from '../games/kit/fx.js';
import * as KitQuality from '../games/kit/quality.js';
import { normalizePrim, buildStatic, buildStrips, buildLamps, buildYard, bounds } from './modern-world.js';
import { createActors } from './modern-actors.js';
import { createGun } from './modern-gun.js';
import { buildDressing, addFloorJoints, addFormwork } from './modern-dress.js';
import { buildFacility } from './modern-site.js';
import { createMotion, GFX_ENHANCED } from './fx.js';

const LOOK_BASE = {
  golden: { exposure: 0.9, fog: 1 / 340 },
  day: { exposure: 0.72, fog: 1 / 420 },
  sunset: { exposure: 0.98, fog: 1 / 280 },
  night: { exposure: 0.95, fog: 1 / 260 }
};
const BACKDROPS = ['mountains', 'desert-mesas', 'forest-hills', 'coast-cliffs', 'city-night'];

function lookFor(def){
  const mood = def && def.mood && typeof def.mood === 'object' ? def.mood : null;
  const sd = def && def.sun && def.sun.dir && def.sun.dir.length >= 3 ? def.sun.dir : [-0.3, -0.3, -0.9];
  const sc = def && def.sun && def.sun.color && def.sun.color.length >= 3 ? def.sun.color : [1, 0.8, 0.6];
  let presetName = mood && LOOK_BASE[mood.preset] ? mood.preset : null;
  if (!presetName){
    const elev = Math.asin(Math.max(-1, Math.min(1, -sd[1]))) * 180 / Math.PI;
    const warmth = sc[0] - sc[2];
    presetName = warmth < 0.2 ? 'day' : warmth > 0.6 || elev < 10 ? 'sunset' : 'golden';
  }
  const backdrop = mood && typeof mood.backdrop === 'string' ? mood.backdrop : BACKDROPS[Math.abs(Math.round(sd[0] * 97 + sd[2] * 31)) % BACKDROPS.length];
  return Object.assign({ preset: presetName, backdrop, wet: mood && typeof mood.wet === 'number' ? mood.wet : 0 }, LOOK_BASE[presetName], mood && typeof mood.exposure === 'number' ? { exposure: mood.exposure } : null);
}

function reducedMotion(){
  try { return typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; }
}

export function createRenderer(canvas){
  const quality = KitQuality.detectQuality ? KitQuality.detectQuality() : 'medium';
  const preset = KitQuality.qualityPreset ? KitQuality.qualityPreset(quality) : { shadows: true, shadowMapSize: 2048 };
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false, stencil: false, depth: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = preset.shadows !== false;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.045, 900);
  camera.rotation.order = 'YXZ';
  scene.add(camera);

  let particles = null;
  try { particles = KitFx.createParticles(scene, { quality, max: 2200 }); } catch (_) { particles = null; }
  const flashLight = new THREE.PointLight(0x9fffe0, 0, 9, 2);
  scene.add(flashLight);
  const muzzleLight = quality === 'low' ? null : new THREE.PointLight(0xffb46a, 0, 10, 2);
  if (muzzleLight) scene.add(muzzleLight);
  const muzzleLocal = new THREE.Vector3(0.18, -0.12, -0.75);
  const actors = createActors(scene, { particles, flashLight });
  const gun = createGun();

  const fill = new THREE.DirectionalLight(0xffffff, 0);
  fill.castShadow = false;
  scene.add(fill);
  scene.add(fill.target);
  let post = null;
  let gunPass = null;
  let aoPass = null;
  function createAO(){
    try {
      const pass = new GTAOPass(scene, camera, 640, 360);
      pass.updateGtaoMaterial({ radius: 1.1, distanceExponent: 1.4, thickness: 1.6, scale: 1.5, samples: 12, distanceFallOff: 1, screenSpaceRadius: false });
      pass.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, radiusExponent: 1, rings: 2, samples: 12 });
      pass.blendIntensity = 1;
      const baseHide = pass._overrideVisibility.bind(pass);
      pass._overrideVisibility = function(){
        baseHide();
        const cache = this._visibilityCache;
        this.scene.traverse((o) => {
          if (!o.visible || !o.isMesh) return;
          const m = o.material;
          const soft = !Array.isArray(m) && m && (m.transparent || m.depthWrite === false);
          if (soft || o.userData.noAO){ o.visible = false; cache.push(o); }
        });
      };
      const baseSize = pass.setSize.bind(pass);
      pass.setSize = (w, h) => baseSize(Math.max(2, Math.round(w * 0.5)), Math.max(2, Math.round(h * 0.5)));
      return pass;
    } catch (_) { return null; }
  }
  try {
    post = KitFx.createPostFx(renderer, scene, camera, { quality, preset: 'day' });
    if (post && post.composer){
      gunPass = new RenderPass(gun.scene, gun.camera);
      gunPass.clear = false;
      gunPass.clearDepth = true;
      post.composer.insertPass(gunPass, 1);
      if (quality === 'high') aoPass = createAO();
      if (aoPass) post.composer.insertPass(aoPass, 1);
    }
  } catch (err) {
    try { console.warn('[phosphor] post fx unavailable', err); } catch (_) {}
    post = null;
  }

  const motion = createMotion();
  const lampLights = [];
  const LIGHT_SLOTS = quality === 'low' ? 2 : quality === 'medium' ? 4 : 6;
  for (let i = 0; i < LIGHT_SLOTS; i++){
    const l = new THREE.PointLight(0xffffff, 0, 12, 2);
    l.visible = false;
    scene.add(l);
    lampLights.push(l);
  }

  let env = null;
  let world = null;
  let worldGroup = null;
  let strips = null;
  let site = null;
  let lamps = [];
  let time = 0;
  let qScale = 1;
  let lastW = 0;
  let lastH = 0;
  let sizeDirty = true;
  const lostCbs = [];
  const restoredCbs = [];
  let contextLost = false;

  canvas.addEventListener('webglcontextlost', () => { contextLost = true; });
  canvas.addEventListener('webglcontextrestored', () => { contextLost = false; sizeDirty = true; studioEnv = null; });
  let studioEnv = null;
  function studio(){
    if (studioEnv) return studioEnv;
    try {
      const pm = new THREE.PMREMGenerator(renderer);
      const room = new RoomEnvironment();
      studioEnv = pm.fromScene(room, 0.04).texture;
      if (room.dispose) room.dispose();
      pm.dispose();
    } catch (_) { studioEnv = null; }
    return studioEnv;
  }

  function disposeWorld(){
    if (worldGroup){
      scene.remove(worldGroup);
      worldGroup.traverse((n) => {
        if (n.geometry) n.geometry.dispose();
      });
      worldGroup = null;
    }
    if (env){ try { env.dispose(); } catch (_) {} env = null; }
    strips = null;
    site = null;
    lamps = [];
    if (particles && particles.clear) particles.clear();
  }

  function compileWorld(def){
    disposeWorld();
    world = null;
    if (!def) return;
    const prims = [];
    for (const raw of Array.isArray(def.prims) ? def.prims : []){
      const p = normalizePrim(raw);
      if (p) prims.push(p);
    }
    const look = Object.assign({}, lookFor(def));
    worldGroup = new THREE.Group();
    worldGroup.name = 'ph-world-root';
    scene.add(worldGroup);
    const sd = def.sun && def.sun.dir && def.sun.dir.length >= 3 ? def.sun.dir : [-0.3, -0.3, -0.9];
    const raw = new THREE.Vector3(-sd[0], -sd[1], -sd[2]).normalize();
    const capDeg = look.preset === 'sunset' ? 8 : look.preset === 'golden' ? 15 : 32;
    const elev = Math.min(Math.asin(Math.max(-1, Math.min(1, raw.y))), capDeg * Math.PI / 180);
    const az = Math.atan2(raw.x, raw.z);
    const sunDirection = new THREE.Vector3(Math.sin(az) * Math.cos(elev), Math.sin(elev), Math.cos(az) * Math.cos(elev));
    try {
      env = KitEnv.createEnvironment(scene, renderer, { preset: look.preset, quality, sunDirection, backdrop: look.backdrop, exposure: look.exposure, farFade: false, seed: 7 });
      if (env && env.group) env.group.traverse((o) => { o.userData.noAO = true; });
      if (env && env.setFogDensity) env.setFogDensity(look.fog);
    } catch (err) {
      try { console.warn('[phosphor] environment unavailable', err); } catch (_) {}
      env = null;
      scene.background = new THREE.Color(0x8fa6c4);
      scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x30281e, 1.4));
      const sun = new THREE.DirectionalLight(0xffe2c0, 2.6);
      sun.position.copy(sunDirection).multiplyScalar(60);
      scene.add(sun);
      renderer.toneMappingExposure = look.exposure;
    }
    const b = bounds(prims);
    const stat = buildStatic(prims, look);
    if (Array.isArray(stat.material)){ addFloorJoints(stat.material[0], 4, look.wet); addFormwork(stat.material[1]); }
    worldGroup.add(stat);
    worldGroup.add(buildYard(b, look));
    strips = buildStrips(def.strips);
    if (strips) worldGroup.add(strips);
    const lampProps = (Array.isArray(def.props) ? def.props : []).filter((pr) => pr && pr.type === 'lamp' && pr.pos).map((pr) => ({ pos: new THREE.Vector3(pr.pos[0], pr.pos[1], pr.pos[2]) }));
    const dress = buildDressing(prims, b, lampProps);
    worldGroup.add(dress.group);
    site = buildFacility(b, { beaconSpots: dress.beaconSpots });
    worldGroup.add(site.group);
    const lampSet = buildLamps(def.props, prims, dress.gantryHeight);
    worldGroup.add(lampSet.group);
    lamps = [];
    for (const l of Array.isArray(def.lights) ? def.lights : []){
      if (!l || !l.pos || l.pos.length < 3) continue;
      const c = l.color && l.color.length >= 3 ? l.color : [1, 0.92, 0.78];
      lamps.push({ pos: new THREE.Vector3(l.pos[0], l.pos[1], l.pos[2]), color: new THREE.Color(c[0], c[1], c[2]), intensity: typeof l.intensity === 'number' ? l.intensity : 6, radius: typeof l.radius === 'number' ? l.radius : 10 });
    }
    actors.setTargets(def.targets);
    actors.setPrims(prims);
    if (env){
      if (env.hemi) env.hemi.intensity *= 1.6;
      fill.color.copy(env.hemi ? env.hemi.color : new THREE.Color(0xbfd0e6)).lerp(new THREE.Color(0xffffff), 0.45);
      fill.position.set(-sunDirection.x, 0.9, -sunDirection.z).normalize().multiplyScalar(50);
      fill.intensity = look.preset === 'day' ? 0.35 : 0.55;
      gun.setEnvironment(studio() || env.envMap, env.hemi ? env.hemi.color : null, env.hemi ? env.hemi.groundColor : null);
      if (post && post.setPreset) post.setPreset(look.preset === 'sunset' ? 'sunset' : look.preset === 'golden' ? 'golden' : 'day');
    }
    world = { prims, look, sunDirection };
    sizeDirty = true;
  }

  function resize(){
    const dpr = Math.max(1, Math.min(typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1, quality === 'high' ? 2 : 1.5));
    const w = Math.max(2, canvas.clientWidth || canvas.width || 2);
    const h = Math.max(2, canvas.clientHeight || canvas.height || 2);
    lastW = canvas.clientWidth;
    lastH = canvas.clientHeight;
    const pr = dpr * qScale;
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    if (post){
      if (post.setPixelRatio) post.setPixelRatio(pr);
      if (post.setSize) post.setSize(w, h);
    }
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    gun.setAspect(w / h);
    sizeDirty = false;
  }

  function placeLights(){
    if (!lamps.length){ for (const l of lampLights) l.visible = false; return; }
    const cp = camera.position;
    const ranked = lamps.slice().sort((a, b) => a.pos.distanceToSquared(cp) - b.pos.distanceToSquared(cp));
    for (let i = 0; i < lampLights.length; i++){
      const slot = lampLights[i];
      const l = ranked[i];
      if (!l){ slot.visible = false; continue; }
      slot.visible = true;
      slot.position.copy(l.pos);
      slot.color.copy(l.color);
      slot.intensity = (l.intensity || 6) * 2.2;
      slot.distance = (l.radius || 10) * 1.25;
    }
  }

  function render(sc, dt){
    if (contextLost || !sc) return;
    const step = typeof dt === 'number' && isFinite(dt) && dt > 0 && dt < 0.5 ? dt : 1 / 60;
    time += step;
    const qs = sc.quality && typeof sc.quality.scale === 'number' && isFinite(sc.quality.scale) ? Math.max(0.5, Math.min(1, sc.quality.scale)) : 1;
    if (aoPass) aoPass.enabled = qs >= 0.85;
    if (Math.abs(qs - qScale) > 0.01){ qScale = qs; sizeDirty = true; }
    if (canvas.clientWidth !== lastW || canvas.clientHeight !== lastH) sizeDirty = true;
    if (sizeDirty) resize();
    const cam = sc.camera || {};
    const p = cam.pos && cam.pos.length >= 3 ? cam.pos : [0, 1.62, 0];
    const yaw = typeof cam.yaw === 'number' ? cam.yaw : 0;
    const pitch = Math.max(-1.55, Math.min(1.55, typeof cam.pitch === 'number' ? cam.pitch : 0));
    const fovY = Math.max(0.35, Math.min(2.6, typeof cam.fovY === 'number' ? cam.fovY : 1.2));
    let py = p[1];
    let roll = 0;
    if (!reducedMotion()){
      const rx = Math.cos(yaw), rz = -Math.sin(yaw);
      motion.update(p[0], p[1], p[2], rx, rz, step, time);
      py -= motion.state.dip || 0;
      roll = motion.state.roll || 0;
    }
    camera.position.set(p[0], py, p[2]);
    camera.rotation.set(pitch, yaw, roll, 'YXZ');
    const fovDeg = fovY * 180 / Math.PI;
    if (Math.abs(camera.fov - fovDeg) > 0.01){ camera.fov = fovDeg; camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld();
    if (!world){
      renderer.setClearColor(0x000000, 1);
      renderer.clear();
      return;
    }
    if (env && env.update) env.update(camera, step);
    if (strips) strips.material.uniforms.uTime.value = time;
    if (site) site.update(time);
    placeLights();
    actors.update(sc, camera, time, step);
    if (particles && particles.update) particles.update(step, camera);
    const sunDir = env ? env.sunDirection : world.sunDirection;
    gun.update(sc.viewmodel, sc.muzzle, sunDir, env ? env.sunColor : null, camera, step);
    if (muzzleLight){
      const mz = Math.max(0, Math.min(1, sc.muzzle || 0));
      muzzleLight.intensity = mz * mz * 22;
      muzzleLight.position.copy(muzzleLocal);
      camera.localToWorld(muzzleLight.position);
    }
    if (post){
      post.render(step);
      if (!gunPass || !post.composer){
        renderer.autoClear = false;
        renderer.clearDepth();
        renderer.render(gun.scene, gun.camera);
        renderer.autoClear = true;
      }
    } else {
      renderer.autoClear = true;
      renderer.render(scene, camera);
      renderer.autoClear = false;
      renderer.clearDepth();
      renderer.render(gun.scene, gun.camera);
      renderer.autoClear = true;
    }
  }

  function onContextLost(cb){ if (typeof cb === 'function') lostCbs.push(cb); }
  function onContextRestored(cb){ if (typeof cb === 'function') restoredCbs.push(cb); }

  return {
    compileWorld,
    render,
    resize,
    resetState(){ try { renderer.resetState(); } catch (_) {} },
    onContextLost,
    onContextRestored,
    setGraphics(){ return GFX_ENHANCED; },
    getGraphics(){ return GFX_ENHANCED; },
    defaultGraphics(){ return GFX_ENHANCED; },
    info(){ return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, quality, programs: renderer.info.programs ? renderer.info.programs.length : 0 }; }
  };
}
