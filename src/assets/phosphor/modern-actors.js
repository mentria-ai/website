import * as THREE from 'three';
import { surfaceAt } from './fx.js';

const MINT = new THREE.Color(0.43, 0.95, 0.77);
const AMBER = new THREE.Color(0.98, 0.72, 0.24);

function radialTexture(stops, size){
  const c = document.createElement('canvas');
  c.width = c.height = size || 128;
  const g = c.getContext('2d');
  const r = c.width / 2;
  const grd = g.createRadialGradient(r, r, 0, r, r, r);
  for (const [o, col] of stops) grd.addColorStop(o, col);
  g.fillStyle = grd;
  g.fillRect(0, 0, c.width, c.height);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function scorchTexture(){
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 2, 64, 64, 62);
  grd.addColorStop(0, 'rgba(8,8,8,0.95)');
  grd.addColorStop(0.35, 'rgba(14,13,12,0.7)');
  grd.addColorStop(0.7, 'rgba(20,18,16,0.22)');
  grd.addColorStop(1, 'rgba(20,18,16,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(10,10,10,0.55)';
  g.lineWidth = 1.4;
  for (let i = 0; i < 9; i++){
    const a = (i / 9) * Math.PI * 2 + Math.sin(i * 7.3) * 0.4;
    const len = 22 + 18 * Math.abs(Math.sin(i * 3.1));
    g.beginPath();
    g.moveTo(64 + Math.cos(a) * 8, 64 + Math.sin(a) * 8);
    g.lineTo(64 + Math.cos(a) * len, 64 + Math.sin(a) * len);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function additive(color, map, opacity){
  return new THREE.MeshBasicMaterial({ color, map: map || null, transparent: true, opacity: opacity == null ? 1 : opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
}

const GHOST_VERT = `
varying vec3 vN;
varying vec3 vV;
varying float vY;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  vY = position.y;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const GHOST_FRAG = `
uniform vec3 uColor;
uniform float uTime;
uniform float uFade;
varying vec3 vN;
varying vec3 vV;
varying float vY;
void main(){
  float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
  float scan = 0.65 + 0.35 * sin(vY * 70.0 - uTime * 9.0);
  float a = (0.08 + f * 0.85) * scan * uFade;
  gl_FragColor = vec4(uColor * (1.6 + f * 2.4), a);
}`;

function ghostGeometry(){
  const parts = [];
  const cap = (x, y0, y1, r) => {
    const g = new THREE.CapsuleGeometry(r, Math.max(0.001, y1 - y0), 6, 12);
    g.translate(x, (y0 + y1) / 2, 0);
    parts.push(g);
  };
  cap(-0.095, 0.2, 0.62, 0.098);
  cap(0.095, 0.2, 0.62, 0.098);
  cap(-0.1, 0.0, 0.2, 0.085);
  cap(0.1, 0.0, 0.2, 0.085);
  cap(0, 0.95, 1.36, 0.195);
  cap(0, 0.66, 0.96, 0.16);
  cap(-0.245, 1.03, 1.3, 0.058);
  cap(0.245, 1.03, 1.3, 0.058);
  const head = new THREE.SphereGeometry(0.118, 14, 10);
  head.translate(0, 1.66, 0);
  parts.push(head);
  return parts;
}

export function createActors(scene, opts){
  const o = opts || {};
  const particles = o.particles || null;
  const group = new THREE.Group();
  group.name = 'ph-actors';
  scene.add(group);

  const haloTex = radialTexture([[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.45)'], [0.6, 'rgba(255,255,255,0.08)'], [1, 'rgba(255,255,255,0)']], 128);
  const flashTex = radialTexture([[0, 'rgba(255,255,255,1)'], [0.2, 'rgba(255,240,200,0.8)'], [0.5, 'rgba(255,180,90,0.18)'], [1, 'rgba(255,160,60,0)']], 128);
  const scorchTex = scorchTexture();

  const plateMat = new THREE.MeshStandardMaterial({ color: 0x10151a, roughness: 0.32, metalness: 0.85 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x2a323b, roughness: 0.3, metalness: 0.9 });
  const ringGeo = new THREE.RingGeometry(0.78, 0.96, 48);
  const innerGeo = new THREE.RingGeometry(0.4, 0.52, 40);
  const eyeGeo = new THREE.CircleGeometry(0.15, 28);
  const plateGeo = new THREE.CylinderGeometry(1.02, 1.08, 0.08, 40);
  plateGeo.rotateX(Math.PI / 2);
  const arcGeo = new THREE.RingGeometry(1.12, 1.2, 40, 1, 0, Math.PI * 0.55);
  const haloGeo = new THREE.PlaneGeometry(1, 1);
  const waveGeo = new THREE.RingGeometry(0.9, 1, 48);

  let targets = [];
  const waves = [];
  for (let i = 0; i < 6; i++){
    const m = new THREE.Mesh(waveGeo, additive(MINT.clone().multiplyScalar(3), null, 0));
    m.visible = false;
    group.add(m);
    waves.push({ mesh: m, age: 9, dur: 0.42, r: 0.5 });
  }

  function clearTargets(){
    for (const t of targets) group.remove(t.root);
    targets = [];
  }

  function setTargets(list){
    clearTargets();
    for (const def of list || []){
      if (!def || !def.pos) continue;
      const r = typeof def.radius === 'number' ? def.radius : 0.45;
      const root = new THREE.Group();
      const face = new THREE.Group();
      const plate = new THREE.Mesh(plateGeo, plateMat);
      plate.castShadow = true;
      const rim = new THREE.Mesh(new THREE.TorusGeometry(1.04, 0.05, 8, 48), rimMat);
      const ring = new THREE.Mesh(ringGeo, additive(MINT.clone().multiplyScalar(3.2)));
      ring.position.z = 0.045;
      const inner = new THREE.Mesh(innerGeo, additive(AMBER.clone().multiplyScalar(3.4)));
      inner.position.z = 0.046;
      const eye = new THREE.Mesh(eyeGeo, additive(new THREE.Color(4, 3.6, 2.6)));
      eye.position.z = 0.047;
      const arc = new THREE.Mesh(arcGeo, additive(MINT.clone().multiplyScalar(2.2), null, 0.85));
      arc.position.z = 0.03;
      const arc2 = new THREE.Mesh(arcGeo, additive(MINT.clone().multiplyScalar(2.2), null, 0.85));
      arc2.rotation.z = Math.PI;
      arc2.position.z = 0.03;
      const halo = new THREE.Mesh(haloGeo, additive(MINT.clone().multiplyScalar(0.9), haloTex, 0.55));
      halo.scale.setScalar(4.2);
      halo.position.z = -0.06;
      face.add(plate, rim, ring, inner, eye, arc, arc2, halo);
      face.scale.setScalar(r);
      root.add(face);
      root.position.set(def.pos[0], def.pos[1], def.pos[2]);
      group.add(root);
      const seed = (def.id || '').split('').reduce((a, ch) => a + ch.charCodeAt(0), 0);
      targets.push({ id: def.id, root, face, arc, arc2, halo, ring, inner, eye, radius: r, base: new THREE.Vector3(def.pos[0], def.pos[1], def.pos[2]), phase: (seed % 17) * 0.37, rate: 1.4 + (seed % 5) * 0.12, down: false, downAt: -1, upAt: -9 });
    }
  }

  function wave(pos, r){
    let w = waves.find((x) => x.age >= x.dur);
    if (!w) w = waves[0];
    w.age = 0;
    w.r = r;
    w.mesh.position.copy(pos);
    w.mesh.visible = true;
  }

  const lightPool = o.flashLight || null;
  let flash = 0;
  const flashPos = new THREE.Vector3();

  function updateTargets(down, camera, time, dt){
    for (const t of targets){
      const isDown = !!(down && down[t.id]);
      if (isDown && !t.down){
        t.down = true;
        t.downAt = time;
        const p = t.root.position;
        const toCam = new THREE.Vector3().subVectors(camera.position, p).normalize();
        if (particles){
          particles.burst('spark', p, toCam, 34, { color: [0.6, 1.4, 1.1], speed: 9, radius: t.radius * 0.6 });
          particles.burst('spark', p, toCam, 14, { color: [1.6, 1.1, 0.4], speed: 7, radius: t.radius * 0.4 });
          particles.burst('debris', p, toCam, 8, { size: 0.5, speed: 5, radius: t.radius * 0.5 });
          particles.burst('smoke', p, toCam, 3, { size: 0.45, life: 0.6 });
        }
        wave(p, t.radius);
        flash = 1;
        flashPos.copy(p);
      } else if (!isDown && t.down){
        t.down = false;
        t.upAt = time;
      }
      if (t.down){
        const age = time - t.downAt;
        const k = Math.max(0, 1 - age / 0.16);
        t.root.visible = k > 0.001;
        t.face.scale.setScalar(t.radius * (1 + (1 - k) * 0.35) * Math.max(0.001, k));
        continue;
      }
      t.root.visible = true;
      const pop = Math.min(1, (time - t.upAt) / 0.38);
      const ease = pop >= 1 ? 1 : 1 + 2.4 * Math.pow(pop - 1, 3) + 1.4 * Math.pow(pop - 1, 2);
      t.face.scale.setScalar(t.radius * Math.max(0.001, ease));
      t.root.position.set(t.base.x, t.base.y + Math.sin(time * t.rate + t.phase) * 0.055, t.base.z);
      t.root.lookAt(camera.position.x, t.root.position.y + (camera.position.y - t.root.position.y) * 0.35, camera.position.z);
      t.arc.rotation.z = time * 1.4 + t.phase;
      t.arc2.rotation.z = Math.PI + time * 1.4 + t.phase;
      const pulse = 0.5 + 0.5 * Math.sin(time * 3.2 + t.phase);
      t.halo.material.opacity = 0.38 + 0.22 * pulse;
    }
    for (const w of waves){
      if (w.age >= w.dur){ w.mesh.visible = false; continue; }
      w.age += dt;
      const k = Math.min(1, w.age / w.dur);
      w.mesh.scale.setScalar(w.r * (1 + k * 5));
      w.mesh.material.opacity = (1 - k) * 0.9;
      w.mesh.lookAt(camera.position);
    }
    if (lightPool){
      flash = Math.max(0, flash - dt * 7);
      lightPool.position.copy(flashPos);
      lightPool.intensity = flash * 18;
      lightPool.visible = flash > 0.01;
    }
  }

  const TRACERS = 16;
  const tracerGeo = new THREE.PlaneGeometry(1, 1);
  tracerGeo.translate(0, 0.5, 0);
  const tracerTex = (() => {
    const c = document.createElement('canvas');
    c.width = 16; c.height = 128;
    const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 0, 128);
    grd.addColorStop(0, 'rgba(255,255,255,0)');
    grd.addColorStop(0.75, 'rgba(255,240,200,0.65)');
    grd.addColorStop(1, 'rgba(255,255,255,1)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 16, 128);
    const h = g.createLinearGradient(0, 0, 16, 0);
    h.addColorStop(0, 'rgba(0,0,0,1)');
    h.addColorStop(0.5, 'rgba(0,0,0,0)');
    h.addColorStop(1, 'rgba(0,0,0,1)');
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = h;
    g.fillRect(0, 0, 16, 128);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const tracers = [];
  for (let i = 0; i < TRACERS; i++){
    const m = new THREE.Mesh(tracerGeo, additive(new THREE.Color(2.6, 2.2, 1.4), tracerTex, 0));
    m.visible = false;
    m.frustumCulled = false;
    group.add(m);
    tracers.push(m);
  }
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();
  const tmpDir = new THREE.Vector3();
  const tmpSide = new THREE.Vector3();
  const tmpUp = new THREE.Vector3();
  const tmpCam = new THREE.Vector3();
  const basisM = new THREE.Matrix4();

  function updateTracers(list, camera){
    for (let i = 0; i < TRACERS; i++){
      const m = tracers[i];
      const t = list && list[i];
      if (!t || !t.from || !t.to){ m.visible = false; continue; }
      const age = typeof t.age01 === 'number' ? t.age01 : 0;
      tmpA.set(t.from[0], t.from[1], t.from[2]);
      tmpB.set(t.to[0], t.to[1], t.to[2]);
      tmpDir.subVectors(tmpB, tmpA);
      const len = tmpDir.length();
      if (len < 0.05){ m.visible = false; continue; }
      tmpDir.divideScalar(len);
      const head = Math.min(1, age * 1.6);
      const seg = Math.min(len, 6 + len * 0.15);
      const start = tmpA.clone().addScaledVector(tmpDir, Math.max(0, (len - seg) * head));
      tmpCam.subVectors(camera.position, start);
      tmpSide.crossVectors(tmpDir, tmpCam).normalize();
      tmpUp.copy(tmpDir);
      const n = new THREE.Vector3().crossVectors(tmpSide, tmpUp).normalize();
      basisM.makeBasis(tmpSide, tmpUp, n);
      m.quaternion.setFromRotationMatrix(basisM);
      m.position.copy(start);
      m.scale.set(0.035, seg, 1);
      m.material.opacity = Math.max(0, 1 - age) * 0.9;
      m.visible = m.material.opacity > 0.02;
    }
  }

  const DECALS = 64;
  const decalGeo = new THREE.PlaneGeometry(1, 1);
  const decalMat = new THREE.MeshBasicMaterial({ map: scorchTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const emberMat = additive(new THREE.Color(2.4, 1.0, 0.3), haloTex, 0);
  const decals = [];
  for (let i = 0; i < DECALS; i++){
    const m = new THREE.Mesh(decalGeo, decalMat);
    const e = new THREE.Mesh(decalGeo, emberMat.clone());
    m.visible = false;
    e.visible = false;
    m.renderOrder = 3;
    e.renderOrder = 4;
    group.add(m, e);
    decals.push({ mesh: m, ember: e, born: -9 });
  }
  let decalCursor = 0;
  const seen = new WeakMap();
  let prims = [];

  function setPrims(p){ prims = p || []; for (const d of decals){ d.mesh.visible = false; d.ember.visible = false; } }

  function updateSparks(list, camera, time){
    if (list) for (const s of list){
      if (!s || !s.pos) continue;
      const age = typeof s.age01 === 'number' ? s.age01 : 0;
      const last = seen.get(s);
      if (last === undefined || age < last - 1e-6){
        const p = new THREE.Vector3(s.pos[0], s.pos[1], s.pos[2]);
        const surf = surfaceAt(prims, s.pos[0], s.pos[1], s.pos[2]);
        const nrm = surf ? new THREE.Vector3(surf.n[0], surf.n[1], surf.n[2]) : tmpCam.subVectors(camera.position, p).normalize().clone();
        if (particles){
          const metal = surf && surf.mat === 'metal';
          particles.burst('spark', p, nrm, metal ? 16 : 9, { color: metal ? [1.8, 1.3, 0.7] : [1.4, 1.1, 0.8], speed: metal ? 10 : 7 });
          particles.burst(metal ? 'smoke' : 'dust', p, nrm, metal ? 1 : 2, { size: 0.25, life: 0.5 });
        }
        if (surf){
          const d = decals[decalCursor];
          decalCursor = (decalCursor + 1) % DECALS;
          const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), nrm);
          d.mesh.quaternion.copy(q);
          d.mesh.rotateZ(Math.random() * Math.PI * 2);
          d.mesh.position.copy(p).addScaledVector(nrm, 0.004);
          const sz = 0.11 + Math.random() * 0.06;
          d.mesh.scale.set(sz, sz, 1);
          d.mesh.visible = true;
          d.ember.quaternion.copy(q);
          d.ember.position.copy(p).addScaledVector(nrm, 0.006);
          d.ember.scale.set(sz * 0.9, sz * 0.9, 1);
          d.ember.visible = true;
          d.born = time;
        }
      }
      seen.set(s, age);
    }
    for (const d of decals){
      if (!d.ember.visible) continue;
      const k = Math.max(0, 1 - (time - d.born) / 1.1);
      d.ember.material.opacity = k * k * 0.95;
      if (k <= 0) d.ember.visible = false;
    }
  }

  const ghostMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: MINT.clone() }, uTime: { value: 0 }, uFade: { value: 1 } },
    vertexShader: GHOST_VERT,
    fragmentShader: GHOST_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false
  });
  const ghost = new THREE.Group();
  for (const g of ghostGeometry()) ghost.add(new THREE.Mesh(g, ghostMat));
  ghost.visible = false;
  group.add(ghost);
  const ghostRing = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.34, 32), additive(MINT.clone().multiplyScalar(1.6), null, 0.6));
  ghostRing.rotation.x = -Math.PI / 2;
  ghostRing.position.y = 0.02;
  ghost.add(ghostRing);

  function updateGhost(g, camera, time){
    if (!g || !g.active){ ghost.visible = false; return; }
    ghost.visible = true;
    ghost.position.set(g.pos[0], g.pos[1], g.pos[2]);
    ghost.rotation.y = g.yaw || 0;
    ghostMat.uniforms.uTime.value = time;
    const d = camera.position.distanceTo(ghost.position);
    ghostMat.uniforms.uFade.value = Math.min(1, Math.max(0.15, (d - 0.8) / 2.5));
  }

  return {
    group,
    setTargets,
    setPrims,
    update(sceneIn, camera, time, dt){
      updateTargets(sceneIn.targetsDown, camera, time, dt);
      updateTracers(sceneIn.tracers, camera);
      updateSparks(sceneIn.sparks, camera, time);
      updateGhost(sceneIn.ghost, camera, time);
    },
    flashTexture: flashTex,
    haloTexture: haloTex,
    dispose(){
      scene.remove(group);
      group.traverse((n) => { if (n.geometry) n.geometry.dispose(); if (n.material && n.material.dispose) n.material.dispose(); });
    }
  };
}
