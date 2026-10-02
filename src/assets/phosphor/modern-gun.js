import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const MINT = new THREE.Color(0.43, 0.95, 0.77);

function rbox(w, h, d, r, mat){
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4)), mat);
  return m;
}

function box(w, h, d, mat){
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
}

function cyl(r0, r1, len, mat, seg){
  const g = new THREE.CylinderGeometry(r0, r1, len, seg || 18);
  g.rotateX(Math.PI / 2);
  return new THREE.Mesh(g, mat);
}

function reticleTexture(){
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(120,255,200,1)';
  g.lineWidth = 3;
  g.beginPath();
  g.arc(64, 64, 26, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = 'rgba(160,255,215,1)';
  g.beginPath();
  g.arc(64, 64, 3.2, 0, Math.PI * 2);
  g.fill();
  for (const [x, y, w, h] of [[62, 22, 4, 14], [62, 92, 4, 14], [22, 62, 14, 4], [92, 62, 14, 4]]) g.fillRect(x, y, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function flashTexture(){
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.translate(64, 64);
  const grd = g.createRadialGradient(0, 0, 0, 0, 0, 62);
  grd.addColorStop(0, 'rgba(255,255,240,1)');
  grd.addColorStop(0.25, 'rgba(255,220,150,0.85)');
  grd.addColorStop(0.6, 'rgba(255,150,60,0.25)');
  grd.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = grd;
  for (let i = 0; i < 6; i++){
    g.rotate(Math.PI / 3);
    g.beginPath();
    g.moveTo(0, -6);
    g.lineTo(60, 0);
    g.lineTo(0, 6);
    g.closePath();
    g.fill();
  }
  g.beginPath();
  g.arc(0, 0, 22, 0, Math.PI * 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createGun(){
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(56, 16 / 9, 0.01, 10);
  scene.add(camera);

  const gunmetal = new THREE.MeshStandardMaterial({ color: 0x3b434c, roughness: 0.34, metalness: 0.88 });
  const polymer = new THREE.MeshStandardMaterial({ color: 0x1a1f25, roughness: 0.62, metalness: 0.12 });
  const silver = new THREE.MeshStandardMaterial({ color: 0xaeb8c4, roughness: 0.24, metalness: 0.95 });
  const glow = new THREE.MeshBasicMaterial({ color: MINT.clone().multiplyScalar(1.7), toneMapped: false });
  const glowSoft = new THREE.MeshBasicMaterial({ color: MINT.clone().multiplyScalar(0.85), toneMapped: false });

  const gun = new THREE.Group();
  const body = new THREE.Group();
  gun.add(body);

  const receiver = rbox(0.06, 0.082, 0.34, 0.012, gunmetal);
  body.add(receiver);
  const upper = rbox(0.054, 0.03, 0.3, 0.008, polymer);
  upper.position.set(0, 0.052, -0.02);
  body.add(upper);
  const railBase = box(0.03, 0.006, 0.3, gunmetal);
  railBase.position.set(0, 0.07, -0.02);
  body.add(railBase);
  for (let i = 0; i < 15; i++){
    const n = box(0.034, 0.004, 0.008, polymer);
    n.position.set(0, 0.075, -0.16 + i * 0.019);
    body.add(n);
  }
  const port = box(0.002, 0.026, 0.07, silver);
  port.position.set(0.031, 0.008, -0.01);
  body.add(port);
  const guard = rbox(0.058, 0.07, 0.3, 0.018, polymer);
  guard.position.set(0, 0.002, -0.33);
  body.add(guard);
  for (const sx of [-1, 1]){
    for (let i = 0; i < 4; i++){
      const v = box(0.003, 0.009, 0.034, gunmetal);
      v.position.set(sx * 0.0295, 0.006, -0.25 - i * 0.05);
      body.add(v);
    }
    const led = box(0.003, 0.006, 0.018, glow);
    led.position.set(sx * 0.0305, 0.026, -0.42);
    body.add(led);
  }
  const strip = box(0.004, 0.004, 0.16, glowSoft);
  strip.position.set(0, 0.038, -0.36);
  body.add(strip);
  const barrel = cyl(0.0105, 0.0105, 0.2, gunmetal);
  barrel.position.set(0, 0.012, -0.57);
  body.add(barrel);
  const brake = cyl(0.017, 0.016, 0.065, silver);
  brake.position.set(0, 0.012, -0.695);
  body.add(brake);
  for (let i = 0; i < 3; i++){
    const slot = box(0.036, 0.004, 0.007, polymer);
    slot.position.set(0, 0.029, -0.675 - i * 0.015);
    body.add(slot);
  }
  const mag = new THREE.Group();
  const magBody = rbox(0.036, 0.16, 0.07, 0.009, polymer);
  magBody.position.set(0, -0.08, 0);
  const magWin = box(0.003, 0.08, 0.008, glow);
  magWin.position.set(0.0185, -0.07, 0.016);
  const magWin2 = magWin.clone();
  magWin2.position.x = -0.0185;
  mag.add(magBody, magWin, magWin2);
  mag.position.set(0, -0.034, -0.045);
  mag.rotation.x = -0.24;
  body.add(mag);
  const grip = rbox(0.036, 0.12, 0.05, 0.012, polymer);
  grip.position.set(0, -0.092, 0.11);
  grip.rotation.x = 0.36;
  body.add(grip);
  const tg = box(0.007, 0.007, 0.066, gunmetal);
  tg.position.set(0, -0.064, 0.052);
  body.add(tg);
  const trig = box(0.005, 0.022, 0.007, silver);
  trig.position.set(0, -0.052, 0.042);
  trig.rotation.x = 0.3;
  body.add(trig);
  const stock = rbox(0.046, 0.075, 0.2, 0.016, polymer);
  stock.position.set(0, -0.006, 0.27);
  body.add(stock);
  const OY = 0.136;
  const mount = box(0.03, 0.014, 0.05, gunmetal);
  mount.position.set(0, 0.08, 0.045);
  body.add(mount);
  const riser = rbox(0.024, 0.042, 0.042, 0.004, gunmetal);
  riser.position.set(0, 0.104, 0.045);
  body.add(riser);
  const knob = cyl(0.0065, 0.0065, 0.012, silver, 14);
  knob.rotation.z = Math.PI / 2;
  knob.position.set(0.017, 0.104, 0.045);
  body.add(knob);
  const hood = new THREE.Mesh(new THREE.TorusGeometry(0.0165, 0.0026, 8, 32), gunmetal);
  hood.position.set(0, OY, 0.032);
  body.add(hood);
  const hoodTube = new THREE.Mesh(new THREE.CylinderGeometry(0.0172, 0.0172, 0.034, 32, 1, true), gunmetal);
  hoodTube.rotation.x = Math.PI / 2;
  hoodTube.position.set(0, OY, 0.049);
  body.add(hoodTube);
  const hoodBack = new THREE.Mesh(new THREE.TorusGeometry(0.0165, 0.0022, 8, 32), polymer);
  hoodBack.position.set(0, OY, 0.066);
  body.add(hoodBack);
  const glass = new THREE.Mesh(new THREE.CircleGeometry(0.0155, 28), new THREE.MeshBasicMaterial({ map: reticleTexture(), transparent: true, opacity: 0, depthWrite: false, toneMapped: false, color: new THREE.Color(1.6, 2.4, 2) }));
  glass.position.set(0, OY, 0.056);
  body.add(glass);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.016, 28), new THREE.MeshPhysicalMaterial({ color: 0x0c1a1c, roughness: 0.04, metalness: 0.2, transparent: true, opacity: 0.3, depthWrite: false }));
  lens.position.set(0, OY, 0.034);
  body.add(lens);

  const flashGroup = new THREE.Group();
  const ft = flashTexture();
  const fm = new THREE.MeshBasicMaterial({ map: ft, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, color: new THREE.Color(3, 2.6, 2), side: THREE.DoubleSide });
  const f1 = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), fm);
  const f2 = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.26), fm);
  f2.rotation.y = Math.PI / 2;
  f2.position.z = -0.08;
  const f3 = f2.clone();
  f3.rotation.set(0, Math.PI / 2, Math.PI / 2);
  flashGroup.add(f1, f2, f3);
  flashGroup.position.set(0, 0.012, -0.75);
  body.add(flashGroup);

  body.traverse((n) => { if (n.isMesh){ n.castShadow = false; n.receiveShadow = false; n.frustumCulled = false; } });
  gun.scale.setScalar(0.78);
  camera.add(gun);

  const hemi = new THREE.HemisphereLight(0xbfd4ea, 0x1a1712, 0.55);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  scene.add(key);
  scene.add(key.target);
  const rimLight = new THREE.DirectionalLight(0x6ef3c5, 1.1);
  rimLight.position.set(-1, 0.6, 0.9);
  const fill = new THREE.DirectionalLight(0xffe7cc, 0.9);
  fill.position.set(1.2, 1.4, 1.2);
  scene.add(fill);
  scene.add(rimLight);
  const muzzleLight = new THREE.PointLight(0xffc27a, 0, 1.4, 2);
  muzzleLight.position.set(0, 0.03, -0.75);
  body.add(muzzleLight);

  const HIP = new THREE.Vector3(0.118, -0.128, -0.33);
  const ADS = new THREE.Vector3(0, -OY * 0.78, -0.21);
  const pos = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();
  const sunCam = new THREE.Vector3();
  let flashSpin = 0;
  let lastMuzzle = 0;
  let reloadTilt = 0;

  function update(vm, muzzle, sunDirWorld, sunColor, worldCam, dt){
    const ads = vm ? Math.max(0, Math.min(1, vm.adsBlend || 0)) : 0;
    const sprint = vm ? Math.max(0, Math.min(1, vm.sprintBlend || 0)) * (1 - ads) : 0;
    const recoil = vm ? Math.max(0, Math.min(1, vm.recoil || 0)) : 0;
    const phase = vm ? vm.bobPhase || 0 : 0;
    const sway = vm && vm.sway ? vm.sway : [0, 0];
    const rl = vm && typeof vm.reloadPhase === 'number' ? Math.max(0, Math.min(1, vm.reloadPhase)) : null;
    pos.copy(HIP).lerp(ADS, ads);
    const amp = 1 - ads * 0.85;
    pos.x += Math.sin(phase) * 0.006 * amp + (sway[0] || 0) * 0.55;
    pos.y += -Math.abs(Math.cos(phase)) * 0.008 * amp + (sway[1] || 0) * 0.55;
    pos.x += sprint * 0.03;
    pos.y -= sprint * 0.035;
    pos.z += sprint * 0.03 + recoil * 0.045 * (1 - ads * 0.4);
    const target = rl === null ? 0 : Math.sin(Math.min(1, rl) * Math.PI);
    reloadTilt += (target - reloadTilt) * Math.min(1, dt * 14);
    pos.y -= reloadTilt * 0.05;
    gun.position.copy(pos);
    gun.rotation.set(
      recoil * 0.075 - sprint * 0.36 - reloadTilt * 0.22 + (sway[1] || 0) * 1.4,
      sprint * 0.55 - (sway[0] || 0) * 1.2 + (1 - ads) * 0.025,
      sprint * 0.22 + reloadTilt * 0.55,
      'YXZ'
    );
    if (rl !== null){
      const out = Math.max(0, Math.min(1, (rl - 0.12) / 0.22));
      const back = Math.max(0, Math.min(1, (rl - 0.55) / 0.25));
      const drop = out * (1 - back);
      mag.position.set(0, -0.034 - drop * 0.28, -0.045 + drop * 0.04);
      mag.rotation.x = -0.24 - drop * 0.6;
    } else {
      mag.position.set(0, -0.034, -0.045);
      mag.rotation.x = -0.24;
    }
    glass.material.opacity = Math.max(0, (ads - 0.55) / 0.45);
    const m = Math.max(0, Math.min(1, muzzle || 0));
    if (m > lastMuzzle + 0.05) flashSpin = Math.random() * Math.PI;
    lastMuzzle = m;
    const fk = m * m;
    fm.opacity = fk;
    flashGroup.rotation.z = flashSpin;
    flashGroup.scale.setScalar(0.65 + 0.6 * fk);
    flashGroup.visible = fk > 0.01;
    muzzleLight.intensity = fk * 2.5;
    if (worldCam && sunDirWorld){
      tmpQ.copy(worldCam.quaternion).invert();
      sunCam.copy(sunDirWorld).applyQuaternion(tmpQ);
      key.position.copy(sunCam).multiplyScalar(4);
      key.target.position.set(0, 0, 0);
      if (sunColor) key.color.copy(sunColor);
    }
  }

  function setAspect(a){
    camera.aspect = a;
    camera.updateProjectionMatrix();
  }

  function setEnvironment(envMap, hemiSky, hemiGround){
    scene.environment = envMap || null;
    scene.environmentIntensity = 0.55;
    if (hemiSky) hemi.color.copy(hemiSky);
    if (hemiGround) hemi.groundColor.copy(hemiGround);
  }

  return { scene, camera, update, setAspect, setEnvironment, muzzleWorld: flashGroup };
}
