import * as THREE from 'three';
import { qualityPreset, normalizeQuality } from './quality.js';
import { judgeWindow, nextScale, parseStored, formatStored } from './adapt.js';

export const SIM_STEP = 1 / 120;
export const SIM_MAX_ACCUMULATOR = 0.25;

const MAX_STEPS = Math.ceil(SIM_MAX_ACCUMULATOR / SIM_STEP);

function finiteOr(v, d) {
  return typeof v === 'number' && isFinite(v) ? v : d;
}

function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function createEngine(opts = {}) {
  const canvas = opts.canvas;
  let offscreen = false;
  if (!canvas) throw new Error('createEngine: canvas required');
  let quality = normalizeQuality(opts.quality);
  let preset = qualityPreset(quality);
  const onStep = typeof opts.onStep === 'function' ? opts.onStep : null;
  const onRender = typeof opts.onRender === 'function' ? opts.onRender : null;
  const onPause = typeof opts.onPause === 'function' ? opts.onPause : null;
  const onContextLost = typeof opts.onContextLost === 'function' ? opts.onContextLost : null;
  const onContextRestored = typeof opts.onContextRestored === 'function' ? opts.onContextRestored : null;
  const autoRender = opts.autoRender !== false;
  const autoResume = opts.autoResume === true;
  const adaptive = opts.adaptive !== false;
  const adaptKey = typeof opts.adaptKey === 'string' ? opts.adaptKey : '';
  const maxDpr = finiteOr(opts.maxPixelRatio, Infinity);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: opts.antialias == null ? preset.msaa : !!opts.antialias,
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
      depth: true,
      preserveDrawingBuffer: !!opts.preserveDrawingBuffer
    });
  } catch (err) {
    const e = new Error('webgl2-unavailable');
    e.cause = err;
    e.code = 'webgl2-unavailable';
    throw e;
  }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = finiteOr(opts.exposure, 1);
  renderer.shadowMap.enabled = !!preset.shadows;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setClearColor(opts.clearColor == null ? 0x05080c : opts.clearColor, 1);
  renderer.info.autoReset = false;

  const scene = opts.scene || new THREE.Scene();
  let camera = opts.camera || new THREE.PerspectiveCamera(finiteOr(opts.fov, 70), 16 / 9, finiteOr(opts.near, 0.1), finiteOr(opts.far, preset.drawDistance));
  let composer = null;

  const stats = {
    fps: 0,
    frameMs: 0,
    cpuMs: 0,
    stepMs: 0,
    renderMs: 0,
    drawCalls: 0,
    triangles: 0,
    textures: 0,
    geometries: 0,
    programs: 0,
    steps: 0,
    dpr: 1,
    width: 0,
    height: 0,
    simTime: 0,
    frames: 0,
    contextLost: false
  };

  const resizeListeners = [];
  let raf = 0;
  let running = false;
  let paused = false;
  let pauseReason = '';
  let hiddenStopped = false;
  let lastT = -1;
  let acc = 0;
  let alpha = 1;
  let timeScale = 1;
  let lost = false;
  let disposed = false;
  let fpsFrames = 0;
  let fpsT0 = nowMs();
  let cssW = 0;
  let cssH = 0;
  let dprCap = Math.min(maxDpr, preset.pixelRatio);
  let dprNow = 1;

  const adapt = {
    windowT0: nowMs(),
    windowFrames: 0,
    slowWindows: 0,
    fastWindows: 0,
    pendingCheck: false,
    fpsBefore: 0,
    locked: false,
    windowMax: 0,
    scaleBefore: 1,
    hold: false,
    scale: 1
  };
  const PERF_N = 600;
  const perfBuf = new Float32Array(PERF_N);
  const perf = { n: 0, i: 0, long: 0, programs0: 0 };
  let perfEl = null;
  let perfTimer = 0;

  function deviceDpr() {
    try { return window.devicePixelRatio || 1; } catch (_) { return 1; }
  }

  function targetDpr() {
    const cap = Math.min(dprCap, deviceDpr());
    const minR = Math.min(cap, preset.minPixelRatio || 0.75);
    return Math.max(minR, cap * adapt.scale);
  }

  function measure() {
    const r = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width || canvas.clientWidth || 1));
    const h = Math.max(1, Math.round(r.height || canvas.clientHeight || 1));
    return { w, h };
  }

  function applySize(force) {
    if (disposed) return;
    const m = measure();
    const d = targetDpr();
    if (!force && m.w === cssW && m.h === cssH && Math.abs(d - dprNow) < 1e-3) return;
    cssW = m.w;
    cssH = m.h;
    dprNow = d;
    renderer.setPixelRatio(d);
    renderer.setSize(cssW, cssH, false);
    if (camera && camera.isPerspectiveCamera) {
      camera.aspect = cssW / cssH;
      camera.updateProjectionMatrix();
    } else if (camera && camera.isOrthographicCamera && camera.userData && camera.userData.autoAspect) {
      const halfH = (camera.top - camera.bottom) / 2;
      camera.left = -halfH * cssW / cssH;
      camera.right = halfH * cssW / cssH;
      camera.updateProjectionMatrix();
    }
    if (composer) {
      try {
        if (typeof composer.setPixelRatio === 'function') composer.setPixelRatio(d);
        if (typeof composer.setSize === 'function') composer.setSize(cssW, cssH);
      } catch (_) {}
    }
    const buf = new THREE.Vector2();
    renderer.getDrawingBufferSize(buf);
    if (buf.x !== stats.width || buf.y !== stats.height) stats.resizes = (stats.resizes || 0) + 1;
    stats.dpr = Math.round(d * 100) / 100;
    stats.width = buf.x;
    stats.height = buf.y;
    for (let i = 0; i < resizeListeners.length; i++) {
      try { resizeListeners[i](cssW, cssH, d); } catch (_) {}
    }
  }

  let ro = null;
  try {
    ro = new ResizeObserver(function () { applySize(false); });
    ro.observe(canvas);
  } catch (_) {
    ro = null;
  }
  function onWindowResize() { applySize(false); }
  try { window.addEventListener('resize', onWindowResize); } catch (_) {}

  function setPaused(on, reason) {
    const next = !!on;
    if (next === paused) return;
    paused = next;
    pauseReason = next ? (reason || 'user') : '';
    if (!next) {
      lastT = -1;
      acc = 0;
    }
    if (onPause) {
      try { onPause(paused, pauseReason); } catch (_) {}
    }
  }

  function adaptStep(t) {
    if (!adaptive || adapt.locked) return;
    if (adapt.hold) { adapt.windowT0 = t; adapt.windowFrames = 0; adapt.windowMax = 0; return; }
    adapt.windowFrames++;
    const span = t - adapt.windowT0;
    if (span < 1000) return;
    const w = judgeWindow({ frames: adapt.windowFrames, spanMs: span, maxMs: adapt.windowMax });
    const fps = w.fps;
    adapt.windowFrames = 0;
    adapt.windowMax = 0;
    adapt.windowT0 = t;
    if (paused || hiddenStopped || w.stall) return;
    if (adapt.pendingCheck) {
      adapt.pendingCheck = false;
      if (fps < adapt.fpsBefore * 1.08) {
        adapt.scale = adapt.scaleBefore;
        adapt.locked = true;
        applySize(true);
        saveScale();
        return;
      }
      saveScale();
    }
    if (w.slow) {
      adapt.slowWindows++;
      adapt.fastWindows = 0;
      if (adapt.slowWindows >= 3 && targetDpr() > Math.min(dprCap, deviceDpr(), preset.minPixelRatio || 0.75) + 0.01) {
        adapt.slowWindows = 0;
        adapt.fpsBefore = fps;
        adapt.pendingCheck = true;
        adapt.scaleBefore = adapt.scale;
        adapt.scale = nextScale(adapt.scale, 'down');
        applySize(true);
      }
    } else if (w.fast) {
      adapt.fastWindows++;
      adapt.slowWindows = 0;
    } else {
      adapt.slowWindows = 0;
      adapt.fastWindows = 0;
    }
  }

  function renderNow() {
    if (lost || disposed) return;
    renderer.info.reset();
    if (composer && typeof composer.render === 'function') composer.render();
    else renderer.render(scene, camera);
    const info = renderer.info;
    stats.drawCalls = info.render.calls;
    stats.triangles = info.render.triangles;
    stats.textures = info.memory.textures;
    stats.geometries = info.memory.geometries;
    stats.programs = info.programs ? info.programs.length : 0;
  }

  function frame(t) {
    raf = 0;
    if (!running || disposed) return;
    raf = requestAnimationFrame(frame);
    if (lost) return;
    const c0 = nowMs();
    let dt = lastT < 0 ? 0 : (t - lastT) / 1000;
    lastT = t;
    if (!(dt >= 0)) dt = 0;
    if (dt > SIM_MAX_ACCUMULATOR) dt = SIM_MAX_ACCUMULATOR;
    let steps = 0;
    if (!paused && onStep) {
      acc = Math.min(SIM_MAX_ACCUMULATOR, acc + dt * timeScale);
      while (acc >= SIM_STEP && steps < MAX_STEPS) {
        onStep(SIM_STEP);
        acc -= SIM_STEP;
        steps++;
        stats.simTime += SIM_STEP;
      }
      if (steps >= MAX_STEPS) acc = 0;
      alpha = acc / SIM_STEP;
    } else {
      alpha = 1;
    }
    const c1 = nowMs();
    if (onRender) onRender(alpha, dt, api);
    if (autoRender) renderNow();
    const c2 = nowMs();
    stats.steps = steps;
    stats.frames++;
    const k = 0.1;
    stats.stepMs += ((c1 - c0) - stats.stepMs) * k;
    stats.renderMs += ((c2 - c1) - stats.renderMs) * k;
    stats.cpuMs += ((c2 - c0) - stats.cpuMs) * k;
    if (dt > 0) {
      const ms = dt * 1000;
      stats.frameMs += (ms - stats.frameMs) * k;
      perfBuf[perf.i] = ms;
      perf.i = (perf.i + 1) % PERF_N;
      if (perf.n < PERF_N) perf.n++;
      if (ms > 25) perf.long++;
      if (ms > adapt.windowMax) adapt.windowMax = ms;
    }
    fpsFrames++;
    const span = t - fpsT0;
    if (span >= 500) {
      stats.fps = Math.round(fpsFrames * 10000 / span) / 10;
      fpsFrames = 0;
      fpsT0 = t;
    }
    adaptStep(t);
  }

  function scaleKey() {
    return adaptKey ? 'mentria.games.adapt.' + adaptKey + '.' + quality : '';
  }

  function loadScale() {
    const k = scaleKey();
    let r = { scale: 1, locked: false };
    if (k) { try { r = parseStored(localStorage.getItem(k)); } catch (_) {} }
    adapt.locked = r.locked;
    return r.scale;
  }

  function saveScale() {
    const k = scaleKey();
    if (!k) return;
    try {
      const v = formatStored(adapt.scale, adapt.locked);
      if (v == null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch (_) {}
  }

  function holdAdapt(on) {
    adapt.hold = !!on;
    resetAdaptWindow();
  }

  function resetAdaptWindow() {
    adapt.windowT0 = nowMs();
    adapt.windowFrames = 0;
    adapt.windowMax = 0;
    adapt.slowWindows = 0;
    adapt.fastWindows = 0;
    adapt.pendingCheck = false;
  }

  function start() {
    if (disposed || running) return;
    running = true;
    hiddenStopped = false;
    lastT = -1;
    fpsT0 = nowMs();
    fpsFrames = 0;
    resetAdaptWindow();
    if (paused && pauseReason === 'hidden') {
      paused = false;
      pauseReason = '';
      acc = 0;
    }
    applySize(true);
    if (offscreen) { hiddenStopped = true; return; }
    if (!raf) raf = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function onVisibility() {
    let hidden = offscreen;
    try { hidden = hidden || document.visibilityState === 'hidden'; } catch (_) {}
    if (hidden) {
      if (!running) return;
      hiddenStopped = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (!paused) setPaused(true, 'hidden');
    } else {
      lastT = -1;
      acc = 0;
      resetAdaptWindow();
      fpsT0 = nowMs();
      fpsFrames = 0;
      if (hiddenStopped && running && !raf) raf = requestAnimationFrame(frame);
      hiddenStopped = false;
      if (autoResume && paused && pauseReason === 'hidden') setPaused(false);
    }
  }
  try { document.addEventListener('visibilitychange', onVisibility); } catch (_) {}
  let io = null;
  try {
    if (window.parent !== window && typeof IntersectionObserver === 'function') {
      io = new IntersectionObserver((entries) => {
        const next = !entries[entries.length - 1].isIntersecting;
        if (next === offscreen) return;
        offscreen = next;
        onVisibility();
      });
      io.observe(canvas);
    }
  } catch (_) {}

  function onLost(e) {
    try { e.preventDefault(); } catch (_) {}
    lost = true;
    stats.contextLost = true;
    if (onContextLost) {
      try { onContextLost(); } catch (_) {}
    }
  }

  function onRestored() {
    lost = false;
    stats.contextLost = false;
    lastT = -1;
    acc = 0;
    try {
      scene.traverse(function (o) {
        const m = o.material;
        if (!m) return;
        if (Array.isArray(m)) for (let i = 0; i < m.length; i++) m[i].needsUpdate = true;
        else m.needsUpdate = true;
      });
    } catch (_) {}
    applySize(true);
    if (onContextRestored) {
      try { onContextRestored(); } catch (_) {}
    }
  }
  canvas.addEventListener('webglcontextlost', onLost, false);
  canvas.addEventListener('webglcontextrestored', onRestored, false);

  function setQuality(q) {
    const nq = normalizeQuality(q);
    const prevShadows = preset.shadows;
    quality = nq;
    preset = qualityPreset(nq);
    dprCap = Math.min(maxDpr, preset.pixelRatio);
    adapt.locked = false;
    adapt.scale = loadScale();
    adapt.pendingCheck = false;
    renderer.shadowMap.enabled = !!preset.shadows;
    if (prevShadows !== preset.shadows) {
      scene.traverse(function (o) {
        const m = o.material;
        if (!m) return;
        if (Array.isArray(m)) for (let i = 0; i < m.length; i++) m[i].needsUpdate = true;
        else m.needsUpdate = true;
      });
    }
    applySize(true);
    return preset;
  }

  function setCamera(cam) {
    if (!cam) return;
    camera = cam;
    applySize(true);
  }

  function setComposer(c) {
    composer = c || null;
    applySize(true);
  }

  function onResize(cb) {
    if (typeof cb !== 'function') return function () {};
    resizeListeners.push(cb);
    if (cssW > 0) {
      try { cb(cssW, cssH, dprNow); } catch (_) {}
    }
    return function () {
      const i = resizeListeners.indexOf(cb);
      if (i >= 0) resizeListeners.splice(i, 1);
    };
  }

  function setTimeScale(s) {
    timeScale = Math.max(0, Math.min(4, finiteOr(s, 1)));
  }

  function dispose() {
    if (disposed) return;
    stop();
    disposed = true;
    try { if (ro) ro.disconnect(); } catch (_) {}
    try { window.removeEventListener('resize', onWindowResize); } catch (_) {}
    try { document.removeEventListener('visibilitychange', onVisibility); } catch (_) {}
    try { if (io) io.disconnect(); } catch (_) {}
    if (perfTimer) clearInterval(perfTimer);
    try { if (perfEl && perfEl.parentNode) perfEl.parentNode.removeChild(perfEl); } catch (_) {}
    canvas.removeEventListener('webglcontextlost', onLost, false);
    canvas.removeEventListener('webglcontextrestored', onRestored, false);
    try { if (composer && typeof composer.dispose === 'function') composer.dispose(); } catch (_) {}
    try { renderer.dispose(); } catch (_) {}
    resizeListeners.length = 0;
  }

  function textureReady(v) {
    if (!v || !v.isTexture || v.isRenderTargetTexture || v.isVideoTexture || !(v.version > 0)) return false;
    const img = v.image;
    if (!img) return false;
    if (img.complete === false) return false;
    return !!(img.width || img.data || (Array.isArray(img) && img.length));
  }

  function uploadTextures() {
    const seen = new Set();
    const up = function (v) {
      if (!v || seen.has(v)) return;
      seen.add(v);
      if (textureReady(v)) { try { renderer.initTexture(v); } catch (_) {} }
    };
    scene.traverse(function (o) {
      const ms = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
      for (let i = 0; i < ms.length; i++) {
        const m = ms[i];
        for (const key in m) {
          const v = m[key];
          if (v && v.isTexture) up(v);
        }
        if (m.uniforms) {
          for (const key in m.uniforms) {
            const u = m.uniforms[key];
            const v = u && u.value;
            if (v && v.isTexture) up(v);
            else if (Array.isArray(v)) for (let j = 0; j < v.length; j++) if (v[j] && v[j].isTexture) up(v[j]);
          }
        }
      }
    });
    if (scene.background && scene.background.isTexture) up(scene.background);
    if (scene.environment && scene.environment.isTexture) up(scene.environment);
  }

  function prewarm() {
    if (lost || disposed || !camera) return false;
    const changed = [];
    scene.traverse(function (o) {
      if (o.visible === false) { changed.push(o, 'visible', false); o.visible = true; }
      if (o.frustumCulled === true) { changed.push(o, 'frustumCulled', true); o.frustumCulled = false; }
    });
    let ok = true;
    try {
      uploadTextures();
      renderNow();
      renderNow();
    } catch (_) {
      ok = false;
    } finally {
      for (let i = 0; i < changed.length; i += 3) changed[i][changed[i + 1]] = changed[i + 2];
    }
    if (adaptive && !adapt.locked && adapt.fastWindows >= 5 && adapt.scale < 1) {
      adapt.scale = nextScale(adapt.scale, 'up');
      applySize(true);
      saveScale();
    }
    adapt.hold = false;
    resetAdaptWindow();
    perfReset();
    return ok;
  }

  function perfReset() {
    perf.n = 0;
    perf.i = 0;
    perf.long = 0;
    perf.programs0 = stats.programs || 0;
    stats.resizes = 0;
  }

  function perfRead() {
    const n = perf.n;
    const a = Array.prototype.slice.call(perfBuf, 0, n).sort(function (x, y) { return x - y; });
    const q = function (f) { return n ? Math.round(a[Math.min(n - 1, Math.floor(f * n))] * 10) / 10 : 0; };
    return {
      p50: q(0.5), p95: q(0.95), p99: q(0.99), frames: n, long: perf.long,
      programs: stats.programs || 0, newPrograms: Math.max(0, (stats.programs || 0) - perf.programs0),
      textures: stats.textures || 0, geometries: stats.geometries || 0,
      calls: stats.drawCalls || 0, triangles: stats.triangles || 0,
      dpr: stats.dpr || 0, scale: Math.round(adapt.scale * 100) / 100, locked: adapt.locked, resizes: stats.resizes || 0,
      width: stats.width || 0, height: stats.height || 0
    };
  }

  function perfOverlay() {
    let on = false;
    try { on = /(?:^|[?&])perf=1(?:&|$)/.test(location.search); } catch (_) {}
    if (!on || perfEl || !canvas.parentElement) return;
    perfEl = document.createElement('div');
    perfEl.setAttribute('aria-hidden', 'true');
    perfEl.style.cssText = 'position:absolute;left:max(8px,env(safe-area-inset-left,0px));bottom:max(8px,env(safe-area-inset-bottom,0px));z-index:60;pointer-events:none;' +
      'font:11px/1.35 ui-monospace,Menlo,monospace;color:#6ef3c5;background:rgba(4,7,10,.72);padding:6px 8px;border-radius:6px;white-space:pre;';
    canvas.parentElement.appendChild(perfEl);
    perfTimer = setInterval(function () {
      const r = perfRead();
      perfEl.textContent = 'frame p50 ' + r.p50 + '  p95 ' + r.p95 + '  p99 ' + r.p99 + ' ms\n' +
        'long>25ms ' + r.long + ' of ' + r.frames + '   shaders ' + r.programs + ' (+' + r.newPrograms + ')\n' +
        'calls ' + r.calls + '  tris ' + Math.round(r.triangles / 1000) + 'k  tex ' + r.textures + '  geo ' + r.geometries + '\n' +
        r.width + 'x' + r.height + '  dpr ' + r.dpr + ' x' + r.scale + (r.locked ? ' locked' : '') + '  rebuilds ' + r.resizes;
    }, 500);
  }

  const api = {
    renderer,
    scene,
    get camera() { return camera; },
    setCamera,
    get composer() { return composer; },
    setComposer,
    start,
    stop,
    pause: setPaused,
    get paused() { return paused; },
    get pauseReason() { return pauseReason; },
    get running() { return running; },
    get alpha() { return alpha; },
    get quality() { return quality; },
    get preset() { return preset; },
    get size() { return { width: cssW, height: cssH, dpr: dprNow }; },
    resize: function () { applySize(true); },
    setQuality,
    setTimeScale,
    get timeScale() { return timeScale; },
    onResize,
    renderOnce: renderNow,
    prewarm,
    holdAdapt,
    perf: perfRead,
    perfReset,
    stats,
    step: SIM_STEP,
    dispose
  };

  if (adaptive) adapt.scale = loadScale();
  applySize(true);
  perfOverlay();
  return api;
}
