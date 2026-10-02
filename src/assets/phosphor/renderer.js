import * as Classic from './renderer-classic.js';
import { GFX_CLASSIC, GFX_ENHANCED, defaultGraphics as pickDefault } from './fx.js';

const MODERN_URL = './renderer-modern.js';
const LOAD_TIMEOUT_MS = 12000;

export function createRenderer(canvas){
  let mode = GFX_CLASSIC;
  let classic = null;
  let modern = null;
  let modernState = 'idle';
  let loadStartedAt = 0;
  let world = null;
  let lastWasModern = false;
  const lostCbs = [];
  const restoredCbs = [];

  canvas.addEventListener('webglcontextlost', function(){
    for (let i = 0; i < lostCbs.length; i++){ try { lostCbs[i](); } catch (_) {} }
  });
  canvas.addEventListener('webglcontextrestored', function(){
    setTimeout(function(){
      for (let i = 0; i < restoredCbs.length; i++){ try { restoredCbs[i](); } catch (_) {} }
    }, 0);
  });

  function getClassic(){
    if (!classic){
      classic = Classic.createRenderer(canvas);
      if (classic && typeof classic.setGraphics === 'function') classic.setGraphics(GFX_CLASSIC);
      if (classic && world) classic.compileWorld(world);
    }
    return classic;
  }

  function loadModern(){
    if (modernState !== 'idle') return;
    modernState = 'loading';
    loadStartedAt = now();
    import(MODERN_URL).then(function(mod){
      if (!mod || typeof mod.createRenderer !== 'function') throw new Error('modern renderer missing');
      modern = mod.createRenderer(canvas);
      if (world) modern.compileWorld(world);
      modernState = 'ready';
    }).catch(function(err){
      try { console.warn('[phosphor] enhanced renderer unavailable, using classic', err); } catch (_) {}
      modern = null;
      modernState = 'failed';
    });
  }

  function now(){
    return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  }

  function compileWorld(def){
    world = def || null;
    if (classic) classic.compileWorld(world);
    if (modern) modern.compileWorld(world);
  }

  function render(scene, dt){
    if (mode === GFX_ENHANCED && modernState !== 'failed'){
      if (modernState === 'ready' && modern){
        if (!lastWasModern && typeof modern.resetState === 'function') modern.resetState();
        lastWasModern = true;
        modern.render(scene, dt);
        return;
      }
      if (modernState === 'loading' && now() - loadStartedAt > LOAD_TIMEOUT_MS) modernState = 'failed';
      if (!classic) return;
    }
    const c = getClassic();
    if (!c) return;
    lastWasModern = false;
    c.render(scene, dt);
  }

  function resize(){
    if (classic) classic.resize();
    if (modern) modern.resize();
  }

  function setGraphics(next){
    if (next === GFX_ENHANCED && modernState !== 'failed'){
      mode = GFX_ENHANCED;
      loadModern();
      if (modernState === 'failed'){ mode = GFX_CLASSIC; getClassic(); }
    } else {
      mode = GFX_CLASSIC;
      getClassic();
    }
    return mode;
  }

  function getGraphics(){ return mode; }

  function defaultGraphics(){
    let probe = null;
    try {
      const c = document.createElement('canvas');
      probe = c.getContext('webgl2');
      const pick = pickDefault(probe);
      const lose = probe && probe.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
      return pick;
    } catch (_) {
      return probe ? GFX_ENHANCED : GFX_CLASSIC;
    }
  }

  function onContextLost(cb){ if (typeof cb === 'function') lostCbs.push(cb); }
  function onContextRestored(cb){ if (typeof cb === 'function') restoredCbs.push(cb); }

  return {
    compileWorld: compileWorld,
    render: render,
    resize: resize,
    onContextLost: onContextLost,
    onContextRestored: onContextRestored,
    setGraphics: setGraphics,
    getGraphics: getGraphics,
    defaultGraphics: defaultGraphics
  };
}
