import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { gameStore } from '../kit/store.js';
import { clamp, lerp, damp, wrapAngle } from '../kit/math.js';
import { createCar } from './carmesh.js';

const GARAGE_STYLE_ID = 'nrg-style';
const STAT_KEYS = ['accel', 'top', 'handling', 'nitro'];

const ENGINE_BY_KIND = {
  wedge: { cylinders: 10, idleRpm: 1000, redlineRpm: 8700, turbo: false, tone: 0.72 },
  gt: { cylinders: 8, idleRpm: 850, redlineRpm: 7800, turbo: true, tone: 0.58 },
  hyper: { cylinders: 12, idleRpm: 1000, redlineRpm: 9200, turbo: false, tone: 0.82 },
  muscle: { cylinders: 8, idleRpm: 750, redlineRpm: 6600, turbo: false, tone: 0.36 },
  rally: { cylinders: 4, idleRpm: 950, redlineRpm: 7600, turbo: true, tone: 0.62 },
  sedan: { cylinders: 6, idleRpm: 800, redlineRpm: 7200, turbo: true, tone: 0.5 }
};

export function engineSpecFor(car, extra) {
  const base = (car && car.engine) || ENGINE_BY_KIND[car && car.kind] || ENGINE_BY_KIND.gt;
  return Object.assign({}, base, extra || null);
}

function readMentria(key) {
  try {
    const S = window.MentriaStore;
    if (S && typeof S.get === 'function') return S.get('games', key);
  } catch (_) {}
  return null;
}

function writeMentria(key, value) {
  try {
    const S = window.MentriaStore;
    if (S && typeof S.set === 'function') { S.set('games', key, value); return true; }
  } catch (_) {}
  return false;
}

function plainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

export function createSettingsStore(slug, defaults) {
  if (typeof gameStore === 'function') {
    try {
      const s = gameStore(slug, { defaults });
      if (s && typeof s.settings === 'function') return s;
    } catch (_) {}
  }
  const memory = new Map();
  const read = function (k) { const v = readMentria(slug + '.' + k); return v == null ? (memory.has(k) ? memory.get(k) : null) : v; };
  const write = function (k, v) { memory.set(k, v); writeMentria(slug + '.' + k, v); };
  return {
    slug,
    settings() { const st = read('settings'); return Object.assign({}, defaults, plainObject(st) ? st : null); },
    saveSettings(patch) {
      const st = read('settings');
      const next = Object.assign({}, plainObject(st) ? st : null, plainObject(patch) ? patch : null);
      write('settings', next);
      return Object.assign({}, defaults, next);
    },
    records() { const r = read('records'); return plainObject(r) ? r : {}; },
    record(id) { const r = this.records()[id]; return plainObject(r) ? r : null; },
    saveRecord(id, rec) {
      const all = this.records();
      const prev = plainObject(all[id]) ? all[id] : null;
      const rank = { gold: 3, silver: 2, bronze: 1 };
      const isBest = !prev || !(typeof prev.time === 'number') || rec.time < prev.time;
      const medal = (rank[rec.medal] || 0) >= (rank[prev && prev.medal] || 0) ? rec.medal || null : prev.medal;
      const next = isBest ? Object.assign({}, rec, { medal, date: Date.now(), runs: ((prev && prev.runs) || 0) + 1 })
        : Object.assign({}, prev, { medal, runs: ((prev && prev.runs) || 0) + 1 });
      all[id] = next;
      write('records', all);
      return { isBest, previous: prev, record: next };
    },
    ghost(id) { const g = read('ghost.' + id); return typeof g === 'string' && g ? g : null; },
    saveGhost(id, str) {
      if (typeof str !== 'string' || !str || str.length > 60000) return false;
      write('ghost.' + id, str);
      return true;
    },
    persistent: !!(typeof window !== 'undefined' && window.MentriaStore),
    dispose() {}
  };
}

const GARAGE_CSS = [
  '.nrg{position:absolute;inset:0;z-index:32;pointer-events:none;container-type:size;color:#eaf3f0;font-family:var(--font-mono,ui-monospace,monospace);',
  '--nrg-mint:#6ef3c5;--nrg-mint-rgb:110,243,197;--nrg-u:clamp(.66px,calc(100cqh/560),1.2px);opacity:0;transition:opacity .25s ease}',
  '.nrg.is-on{opacity:1}',
  '.nrg[hidden]{display:none}',
  '.nrg *{box-sizing:border-box}',
  '.nrg-shade{position:absolute;inset:0;background:linear-gradient(90deg,rgba(3,6,8,.9) 0%,rgba(3,6,8,.66) 34%,rgba(3,6,8,0) 58%)}',
  '.nrg-panel{position:absolute;left:calc(env(safe-area-inset-left,0px) + 22px);top:50%;transform:translateY(-50%);width:min(42%,400px);',
  'display:flex;flex-direction:column;gap:calc(10*var(--nrg-u));pointer-events:auto}',
  '.nrg-back{position:absolute;left:calc(env(safe-area-inset-left,0px) + 14px);top:calc(env(safe-area-inset-top,0px) + 12px);pointer-events:auto;',
  'display:inline-flex;align-items:center;gap:6px;min-height:40px;padding:0 14px;border-radius:999px;cursor:pointer;',
  'font:600 11px/1 var(--font-mono,monospace);letter-spacing:.14em;text-transform:uppercase;color:#eaf3f0;',
  'background:rgba(4,8,10,.55);border:1px solid rgba(255,255,255,.18)}',
  '.nrg-back:hover,.nrg-back:focus-visible{border-color:var(--nrg-mint);color:var(--nrg-mint);outline:none}',
  '.nrg-kicker{margin:0;font-size:calc(11*var(--nrg-u));letter-spacing:.28em;text-transform:uppercase;color:var(--nrg-mint)}',
  '.nrg-name{margin:0;font:italic 900 calc(44*var(--nrg-u))/.95 var(--font-body,system-ui,sans-serif);letter-spacing:-.01em;color:#fff;',
  'text-shadow:0 0 22px rgba(var(--nrg-mint-rgb),.25),0 3px 12px rgba(0,0,0,.6)}',
  '.nrg-kind{margin:0;font-size:calc(12*var(--nrg-u));letter-spacing:.16em;text-transform:uppercase;color:rgba(234,243,240,.66)}',
  '.nrg-stats{display:flex;flex-direction:column;gap:calc(7*var(--nrg-u));margin-top:calc(4*var(--nrg-u))}',
  '.nrg-stat{display:grid;grid-template-columns:minmax(0,10rem) 1fr 1.6rem;align-items:center;gap:10px}',
  '.nrg-stat__k{font-size:calc(10.5*var(--nrg-u));letter-spacing:.14em;text-transform:uppercase;color:rgba(234,243,240,.72);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
  '.nrg-stat__bar{display:flex;gap:3px;height:calc(9*var(--nrg-u))}',
  '.nrg-stat__bar i{flex:1;border-radius:2px;background:rgba(255,255,255,.1);transition:background-color .2s ease,box-shadow .2s ease}',
  '.nrg-stat__bar i.is-on{background:var(--nrg-mint);box-shadow:0 0 6px rgba(var(--nrg-mint-rgb),.5)}',
  '.nrg-stat__v{font:800 calc(13*var(--nrg-u))/1 var(--font-mono,monospace);color:#fff;text-align:right}',
  '.nrg-paint{display:flex;flex-direction:column;gap:7px;margin-top:calc(6*var(--nrg-u))}',
  '.nrg-paint__v{color:#fff;font-weight:700;letter-spacing:.08em}',
  '.nrg-swatches{display:flex;flex-wrap:wrap;gap:7px}',
  '.nrg-sw{width:calc(28*var(--nrg-u));height:calc(28*var(--nrg-u));min-width:28px;min-height:28px;border-radius:50%;cursor:pointer;padding:0;',
  'border:2px solid rgba(255,255,255,.22);box-shadow:inset 0 -6px 10px rgba(0,0,0,.35),inset 0 4px 8px rgba(255,255,255,.25);transition:transform .12s ease,border-color .12s ease}',
  '.nrg-sw:hover{transform:scale(1.08)}',
  '.nrg-sw.is-sel{border-color:#fff;box-shadow:0 0 0 2px var(--nrg-mint),0 0 14px rgba(var(--nrg-mint-rgb),.55),inset 0 -6px 10px rgba(0,0,0,.35)}',
  '.nrg-sw:focus-visible{outline:2px solid var(--nrg-mint);outline-offset:2px}',
  '.nrg-drive{margin-top:calc(10*var(--nrg-u));align-self:flex-start;min-height:48px;padding:0 26px;border-radius:999px;cursor:pointer;',
  'font:800 calc(13*var(--nrg-u))/1 var(--font-mono,monospace);letter-spacing:.16em;text-transform:uppercase;',
  'color:#03130d;background:var(--nrg-mint);border:0;box-shadow:0 0 24px rgba(var(--nrg-mint-rgb),.35)}',
  '.nrg-drive:hover,.nrg-drive:focus-visible{background:#a4fadd;outline:none}',
  '.nrg-keys{margin:0;font-size:10px;letter-spacing:.1em;color:rgba(234,243,240,.5)}',
  '.nrg-arrow{position:absolute;top:50%;transform:translateY(-50%);pointer-events:auto;cursor:pointer;width:52px;height:52px;border-radius:50%;',
  'display:flex;align-items:center;justify-content:center;background:rgba(4,8,10,.5);border:1px solid rgba(255,255,255,.2);color:#fff}',
  '.nrg-arrow:hover,.nrg-arrow:focus-visible{border-color:var(--nrg-mint);color:var(--nrg-mint);outline:none}',
  '.nrg-arrow svg{width:22px;height:22px}',
  '.nrg-arrow--prev{left:calc(46% + 10px)}',
  '.nrg-arrow--next{right:calc(env(safe-area-inset-right,0px) + 18px)}',
  '.nrg-dots{position:absolute;left:calc(46% + 50%*.54 - 60px);bottom:calc(env(safe-area-inset-bottom,0px) + 18px);display:flex;gap:6px;width:120px;justify-content:center}',
  '.nrg-dots i{width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,.22)}',
  '.nrg-dots i.is-on{background:var(--nrg-mint);box-shadow:0 0 8px rgba(var(--nrg-mint-rgb),.7)}',
  '@container (max-height: 420px){.nrg-name{font-size:calc(34*var(--nrg-u))}.nrg-keys{display:none}.nrg-panel{gap:6px}}',
  '@container (max-width: 640px){.nrg-panel{width:52%}.nrg-arrow--prev{left:calc(54% + 4px)}}'
].join('');

const ICON_LEFT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.8 5.2L8 12l6.8 6.8"/></svg>';
const ICON_RIGHT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.2 5.2L16 12l-6.8 6.8"/></svg>';

function ensureGarageStyle() {
  if (document.getElementById(GARAGE_STYLE_ID)) return;
  const st = document.createElement('style');
  st.id = GARAGE_STYLE_ID;
  st.textContent = GARAGE_CSS;
  document.head.appendChild(st);
}

function floorTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(256, 256, 10, 256, 256, 256);
  grad.addColorStop(0, '#2a3236');
  grad.addColorStop(0.45, '#151b1e');
  grad.addColorStop(1, '#06090b');
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 512);
  g.strokeStyle = 'rgba(110,243,197,0.07)';
  g.lineWidth = 1;
  for (let i = 0; i <= 512; i += 32) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 512); g.stroke();
    g.beginPath(); g.moveTo(0, i); g.lineTo(512, i); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function createStudio(renderer) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05080a);
  scene.fog = new THREE.Fog(0x05080a, 14, 34);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const envRT = pmrem.fromScene(room, 0.04);
  room.dispose && room.dispose();
  pmrem.dispose();
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.7;

  const floorTex = floorTexture();
  const floorGeo = new THREE.CircleGeometry(18, 64);
  floorGeo.rotateX(-Math.PI / 2);
  const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, color: 0x3a4044, roughness: 0.88, metalness: 0, envMapIntensity: 0.08 });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.receiveShadow = true;
  scene.add(floor);

  const discGeo = new THREE.CylinderGeometry(3.3, 3.4, 0.08, 64);
  const discMat = new THREE.MeshStandardMaterial({ color: 0x14191c, roughness: 0.45, metalness: 0.5, envMapIntensity: 0.25 });
  const disc = new THREE.Mesh(discGeo, discMat);
  disc.position.y = 0.04;
  disc.receiveShadow = true;
  scene.add(disc);
  const ringGeo = new THREE.TorusGeometry(3.36, 0.025, 8, 96);
  ringGeo.rotateX(Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x6ef3c5, toneMapped: false });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.position.y = 0.075;
  scene.add(ring);

  const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x1a1410, 0.5);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xfff4e6, 2.2);
  key.position.set(4, 7, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -5; key.shadow.camera.right = 5; key.shadow.camera.top = 5; key.shadow.camera.bottom = -5;
  key.shadow.camera.near = 1; key.shadow.camera.far = 20;
  key.shadow.bias = -0.0004;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x8ff7d6, 0.45);
  rim.position.set(-5, 3, -6);
  scene.add(rim);
  const fill = new THREE.DirectionalLight(0x9fc4ff, 0.7);
  fill.position.set(-6, 2, 5);
  scene.add(fill);

  const turntable = new THREE.Group();
  turntable.position.y = 0.08;
  turntable.rotation.y = Math.PI * 0.82;
  scene.add(turntable);

  const camera = new THREE.PerspectiveCamera(32, 16 / 9, 0.1, 80);

  return {
    scene,
    camera,
    turntable,
    envMap: envRT.texture,
    dispose() {
      envRT.dispose();
      floorTex.dispose();
      floorGeo.dispose();
      floorMat.dispose();
      discGeo.dispose();
      discMat.dispose();
      ringGeo.dispose();
      ringMat.dispose();
    }
  };
}

export function createGarage(opts) {
  ensureGarageStyle();
  const stage = opts.stage;
  const renderer = opts.renderer;
  const t = opts.t;
  const nameOf = opts.nameOf;
  const kindOf = opts.kindOf;
  const statLabel = typeof opts.statLabel === 'function' ? opts.statLabel : function (k) { return k; };
  const paintName = typeof opts.paintName === 'function' ? opts.paintName : function (id) { return id; };
  const cars = opts.cars;
  const paints = opts.paints;
  const sound = typeof opts.sound === 'function' ? opts.sound : function () {};
  let studio = null;
  let carView = null;
  let carIndex = 0;
  let paintId = null;
  let open = false;
  let spin = 0.6;
  let dragX = null;
  let onDone = null;
  let onBack = null;

  const root = document.createElement('div');
  root.className = 'nrg';
  root.hidden = true;
  root.innerHTML =
    '<div class="nrg-shade"></div>' +
    '<button type="button" class="nrg-back" data-act="back">' + ICON_LEFT.replace('<svg ', '<svg width="14" height="14" ') + '<span class="nrg-back__t"></span></button>' +
    '<div class="nrg-panel">' +
    '<p class="nrg-kicker"></p><p class="nrg-name"></p><p class="nrg-kind"></p>' +
    '<div class="nrg-stats"></div>' +
    '<div class="nrg-paint"><span class="nrg-stat__k"><span class="nrg-paint__k"></span> <b class="nrg-paint__v"></b></span><div class="nrg-swatches"></div></div>' +
    '<button type="button" class="nrg-drive" data-act="drive"></button>' +
    '<p class="nrg-keys"></p>' +
    '</div>' +
    '<button type="button" class="nrg-arrow nrg-arrow--prev" data-act="prev">' + ICON_LEFT + '</button>' +
    '<button type="button" class="nrg-arrow nrg-arrow--next" data-act="next">' + ICON_RIGHT + '</button>' +
    '<div class="nrg-dots"></div>';
  stage.appendChild(root);
  const el = {
    backT: root.querySelector('.nrg-back__t'),
    kicker: root.querySelector('.nrg-kicker'),
    name: root.querySelector('.nrg-name'),
    kind: root.querySelector('.nrg-kind'),
    stats: root.querySelector('.nrg-stats'),
    paintK: root.querySelector('.nrg-paint__k'),
    paintV: root.querySelector('.nrg-paint__v'),
    swatches: root.querySelector('.nrg-swatches'),
    drive: root.querySelector('.nrg-drive'),
    keys: root.querySelector('.nrg-keys'),
    prev: root.querySelector('.nrg-arrow--prev'),
    next: root.querySelector('.nrg-arrow--next'),
    dots: root.querySelector('.nrg-dots')
  };
  const statRows = {};
  for (let i = 0; i < STAT_KEYS.length; i++) {
    const k = STAT_KEYS[i];
    const row = document.createElement('div');
    row.className = 'nrg-stat';
    let bars = '';
    for (let s = 0; s < 10; s++) bars += '<i></i>';
    row.innerHTML = '<span class="nrg-stat__k"></span><span class="nrg-stat__bar">' + bars + '</span><span class="nrg-stat__v"></span>';
    el.stats.appendChild(row);
    statRows[k] = { k: row.querySelector('.nrg-stat__k'), bars: row.querySelectorAll('i'), v: row.querySelector('.nrg-stat__v') };
  }
  for (let i = 0; i < cars.length; i++) el.dots.appendChild(document.createElement('i'));
  for (let i = 0; i < paints.length; i++) {
    const p = paints[i];
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'nrg-sw';
    b.setAttribute('data-paint', p.id);
    b.style.background = '#' + ('000000' + p.hex.toString(16)).slice(-6);
    b.setAttribute('aria-label', paintName(p.id));
    b.title = paintName(p.id);
    el.swatches.appendChild(b);
  }

  function applyCopy() {
    el.backT.textContent = t('ui_back_short');
    el.kicker.textContent = t('garage_kicker');
    el.paintK.textContent = t('garage_paint');
    el.drive.textContent = t('garage_drive');
    el.keys.textContent = t('garage_keys');
    el.prev.setAttribute('aria-label', t('garage_prev'));
    el.next.setAttribute('aria-label', t('garage_next'));
    for (let i = 0; i < STAT_KEYS.length; i++) statRows[STAT_KEYS[i]].k.textContent = statLabel(STAT_KEYS[i]);
    const sws = el.swatches.children;
    for (let i = 0; i < sws.length; i++) {
      const id = sws[i].getAttribute('data-paint');
      sws[i].setAttribute('aria-label', paintName(id));
      sws[i].title = paintName(id);
    }
    renderInfo();
  }

  function renderInfo() {
    const car = cars[carIndex];
    if (!car) return;
    el.name.textContent = nameOf(car);
    el.kind.textContent = kindOf(car);
    for (let i = 0; i < STAT_KEYS.length; i++) {
      const k = STAT_KEYS[i];
      const v = Math.max(0, Math.min(10, Math.round((car.stats && car.stats[k]) || 0)));
      const row = statRows[k];
      for (let s = 0; s < row.bars.length; s++) row.bars[s].classList.toggle('is-on', s < v);
      row.v.textContent = String(v);
    }
    const dots = el.dots.children;
    for (let i = 0; i < dots.length; i++) dots[i].classList.toggle('is-on', i === carIndex);
    const sws = el.swatches.children;
    for (let i = 0; i < sws.length; i++) sws[i].classList.toggle('is-sel', sws[i].getAttribute('data-paint') === paintId);
    el.paintV.textContent = paintId ? paintName(paintId) : '';
  }

  function buildCar() {
    if (!studio) return;
    if (carView) {
      try { carView.dispose(); } catch (_) {}
      carView = null;
    }
    const car = cars[carIndex];
    try {
      carView = createCar(car, { lod: 'high', envMap: studio.envMap, color: paintId });
      carView.group.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
      if (carView.setHeadlights) carView.setHeadlights(false);
      if (carView.setEnvMap) carView.setEnvMap(studio.envMap, 1.1);
      studio.turntable.add(carView.group);
    } catch (err) {
      try { console.warn('[nitro-racer] car build failed: ' + (err && err.message)); } catch (_) {}
      carView = null;
    }
  }

  function setCar(i) {
    const n = cars.length;
    carIndex = ((i % n) + n) % n;
    const car = cars[carIndex];
    const list = car.paints && car.paints.length ? car.paints : [paints[0].id];
    if (!paintId || list.indexOf(paintId) < 0) paintId = list[0];
    buildCar();
    renderInfo();
  }

  function setPaint(id) {
    paintId = id;
    if (carView && carView.setColor) carView.setColor(id);
    renderInfo();
  }

  function cyclePaint(dir) {
    let i = 0;
    for (let k = 0; k < paints.length; k++) if (paints[k].id === paintId) i = k;
    i = (i + dir + paints.length) % paints.length;
    setPaint(paints[i].id);
    sound('ui');
  }

  function step(dir) {
    setCar(carIndex + dir);
    spin = 0.6;
    sound('ui');
  }

  function finish() {
    const car = cars[carIndex];
    const cb = onDone;
    close();
    sound('confirm');
    if (cb) cb(car.id, paintId);
  }

  function cancel() {
    const cb = onBack;
    close();
    sound('back');
    if (cb) cb();
  }

  root.addEventListener('click', function (e) {
    const sw = e.target.closest ? e.target.closest('.nrg-sw') : null;
    if (sw) { setPaint(sw.getAttribute('data-paint')); sound('ui'); return; }
    const b = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!b) return;
    const act = b.getAttribute('data-act');
    if (act === 'prev') step(-1);
    else if (act === 'next') step(1);
    else if (act === 'drive') finish();
    else if (act === 'back') cancel();
  });

  function onKey(e) {
    if (!open) return;
    const k = e.key;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') { step(-1); e.preventDefault(); }
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') { step(1); e.preventDefault(); }
    else if (k === 'ArrowUp' || k === 'w' || k === 'W') { cyclePaint(-1); e.preventDefault(); }
    else if (k === 'ArrowDown' || k === 's' || k === 'S') { cyclePaint(1); e.preventDefault(); }
    else if (k === 'Enter') {
      const a = document.activeElement;
      if (a && root.contains(a) && a.classList.contains('nrg-sw')) return;
      if (a && root.contains(a) && a.getAttribute('data-act') && a.getAttribute('data-act') !== 'drive') return;
      finish();
      e.preventDefault();
    } else if (k === 'Escape' || k === 'Backspace') { cancel(); e.preventDefault(); e.stopPropagation(); }
  }

  function onPadDir(e) {
    if (!open || !e.detail) return;
    const d = e.detail.direction;
    if (d === 'left') step(-1);
    else if (d === 'right') step(1);
    else if (d === 'up') cyclePaint(-1);
    else if (d === 'down') cyclePaint(1);
  }

  function onPadButton(e) {
    if (!open || !e.detail || !e.detail.pressed) return;
    const n = e.detail.name;
    if (n === 'a' || n === 'start') finish();
    else if (n === 'b' || n === 'back') cancel();
    else if (n === 'lb') step(-1);
    else if (n === 'rb') step(1);
  }

  function onPointerDown(e) {
    if (!open) return;
    if (e.target.closest && e.target.closest('button')) return;
    dragX = e.clientX;
  }

  function onPointerMove(e) {
    if (dragX == null || !open) return;
    const dx = e.clientX - dragX;
    dragX = e.clientX;
    if (studio) studio.turntable.rotation.y += dx * 0.012;
    spin = 0;
  }

  function onPointerUp() {
    dragX = null;
  }

  window.addEventListener('keydown', onKey, true);
  window.addEventListener('mentria:gamepad:direction', onPadDir);
  window.addEventListener('mentria:gamepad:button', onPadButton);
  stage.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);

  function show(carId, paint, handlers) {
    onDone = handlers && handlers.onDone;
    onBack = handlers && handlers.onBack;
    if (!studio) studio = createStudio(renderer);
    let idx = 0;
    for (let i = 0; i < cars.length; i++) if (cars[i].id === carId) idx = i;
    paintId = paint || null;
    open = true;
    root.hidden = false;
    setCar(idx);
    if (paint) setPaint(paint);
    applyCopy();
    requestAnimationFrame(function () { root.classList.add('is-on'); });
    setTimeout(function () { try { el.drive.focus({ preventScroll: true }); } catch (_) {} }, 60);
  }

  function close() {
    open = false;
    root.classList.remove('is-on');
    root.hidden = true;
    dragX = null;
    if (carView) {
      try { carView.dispose(); } catch (_) {}
      carView = null;
    }
  }

  function render(dt, width, height) {
    if (!open || !studio) return false;
    if (spin > 0) studio.turntable.rotation.y += dt * spin;
    else spin = Math.min(0.6, spin + dt * 0.05);
    const cam = studio.camera;
    const aspect = Math.max(0.5, width / Math.max(1, height));
    if (Math.abs(cam.aspect - aspect) > 1e-3) {
      cam.aspect = aspect;
      cam.updateProjectionMatrix();
    }
    const narrow = aspect < 1.4;
    const dist = narrow ? 12.5 : 10.2;
    cam.position.set(Math.sin(0.62) * dist, 2.3, Math.cos(0.62) * dist);
    cam.lookAt(0, 0.62, 0);
    const shift = narrow ? 0.12 : 0.17;
    cam.setViewOffset(width, height, -width * shift, height * 0.02, width, height);
    if (carView && carView.setSpin) carView.setSpin(0);
    renderer.render(studio.scene, cam);
    return true;
  }

  function dispose() {
    close();
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('mentria:gamepad:direction', onPadDir);
    window.removeEventListener('mentria:gamepad:button', onPadButton);
    stage.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    if (studio) studio.dispose();
    studio = null;
    if (root.parentNode) root.parentNode.removeChild(root);
  }

  return {
    show,
    close,
    render,
    applyCopy,
    dispose,
    get isOpen() { return open; }
  };
}

function rigAngleLerp(a, b, k) {
  return a + wrapAngle(b - a) * k;
}

function rigDampAngle(a, b, lambda, dt) {
  return a + wrapAngle(b - a) * (1 - Math.exp(-lambda * dt));
}

export function createCameraRig(camera) {
  const st = { yaw: 0, y: 0, boost: 0, fov: 66, init: false, flyS: 0 };
  const va = new THREE.Vector3();
  const vb = new THREE.Vector3();
  const pa = { x: 0, y: 0, z: 0 };
  const pb = { x: 0, y: 0, z: 0 };

  function applyFov(target, dt) {
    st.fov = dt > 0 ? damp(st.fov, target, 6, dt) : st.fov;
    if (Math.abs(camera.fov - st.fov) > 0.01) {
      camera.fov = st.fov;
      camera.updateProjectionMatrix();
    }
  }

  function reset(yaw) {
    st.init = false;
    st.yaw = yaw || 0;
  }

  function follow(o, dt) {
    const c = o.car;
    const px = o.px;
    const py = o.py;
    const pz = o.pz;
    const sf = clamp(c.speed / c.params.topSpeed, 0, 1.25);
    st.boost = damp(st.boost, c.boosting ? 1 : 0, 3.5, dt);
    const baseYaw = c.reverse ? c.yaw : rigAngleLerp(c.vHeading, c.yaw, 0.45);
    if (!st.init) {
      st.yaw = baseYaw;
      st.y = py;
      st.fov = 64;
      st.init = true;
    }
    st.yaw = rigDampAngle(st.yaw, baseYaw, 4.5 + 3.5 * Math.min(sf, 1), dt);
    st.y = damp(st.y, py, c.grounded ? 10 : 3.2, dt);
    let fov;
    if (o.intro != null) {
      const k = clamp(o.intro, 0, 1);
      const e = k * k * (3 - 2 * k);
      const yaw = c.yaw + Math.PI * (1 - e) * 0.85;
      const dist = lerp(14, 6.6, e);
      const h = lerp(5.2, 2.15, e);
      camera.position.set(px + Math.sin(yaw) * dist, py + h, pz + Math.cos(yaw) * dist);
      va.set(px - Math.sin(c.yaw) * 3 * e, py + 1.0, pz - Math.cos(c.yaw) * 3 * e);
      camera.lookAt(va);
      fov = lerp(52, 64, e);
      st.yaw = c.yaw;
    } else if (o.lookBack) {
      const yaw = c.yaw;
      camera.position.set(px - Math.sin(yaw) * 4.2, py + 1.75, pz - Math.cos(yaw) * 4.2);
      va.set(px + Math.sin(yaw) * 12, py + 1.1, pz + Math.cos(yaw) * 12);
      camera.lookAt(va);
      fov = 66;
    } else if (o.bumper && o.view) {
      const v = o.view;
      const front = v.dims && typeof v.dims.front === 'number' ? Math.min(-1.6, v.dims.front) : -2.3;
      va.set(0, 0.74, front - 0.32).applyQuaternion(v.group.quaternion).add(v.group.position);
      camera.position.copy(va);
      vb.set(0, 0.62, front - 14).applyQuaternion(v.group.quaternion).add(v.group.position);
      camera.lookAt(vb);
      fov = 74 + 10 * Math.min(sf, 1) + 7 * st.boost;
    } else {
      const yaw = st.yaw;
      const dist = 5.3 + 1.5 * Math.min(sf, 1.1) + 1.0 * st.boost;
      const h = 1.8 + 0.3 * Math.min(sf, 1);
      const cx = px + Math.sin(yaw) * dist;
      const cz = pz + Math.cos(yaw) * dist;
      let cy = st.y + h;
      if (o.heightAt) {
        const ground = o.heightAt(cx, cz) + 0.8;
        if (cy < ground) cy = ground;
      }
      camera.position.set(cx, cy, cz);
      va.set(px - Math.sin(yaw) * 5.5, st.y + 0.95, pz - Math.cos(yaw) * 5.5);
      camera.lookAt(va);
      fov = 62 + 12 * Math.min(sf, 1.1) + 9 * st.boost;
    }
    applyFov(fov, dt);
  }

  function attract(track, dt) {
    st.flyS = track.wrapS(st.flyS + dt * 24);
    track.pointAt(st.flyS, 0, 9, pa);
    track.pointAt(st.flyS + 40, 0, 2, pb);
    camera.position.set(pa.x, pa.y, pa.z);
    camera.lookAt(pb.x, pb.y, pb.z);
    if (Math.abs(camera.fov - 60) > 0.01) {
      camera.fov = 60;
      st.fov = 60;
      camera.updateProjectionMatrix();
    }
  }

  return {
    state: st,
    reset,
    follow,
    attract,
    resetFly() { st.flyS = 0; }
  };
}
