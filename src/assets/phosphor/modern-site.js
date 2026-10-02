import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function rand(seed){
  let a = seed >>> 0;
  return function(){
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function ribTexture(){
  const c = document.createElement('canvas');
  c.width = 64; c.height = 8;
  const g = c.getContext('2d');
  for (let x = 0; x < 64; x++){
    const v = 150 + Math.round(60 * Math.sin((x / 64) * Math.PI * 8));
    g.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')';
    g.fillRect(x, 0, 1, 8);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function lampPanelTexture(){
  const c = document.createElement('canvas');
  c.width = 96; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#15181c';
  g.fillRect(0, 0, 96, 64);
  for (let i = 0; i < 3; i++){
    for (let j = 0; j < 2; j++){
      const grd = g.createRadialGradient(16 + i * 32, 16 + j * 32, 2, 16 + i * 32, 16 + j * 32, 14);
      grd.addColorStop(0, '#ffffff');
      grd.addColorStop(0.6, '#fff1d6');
      grd.addColorStop(1, '#3a3426');
      g.fillStyle = grd;
      g.fillRect(3 + i * 32, 3 + j * 32, 26, 26);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let shared = null;
function materials(){
  if (shared) return shared;
  const rib = ribTexture();
  shared = {
    cladding: [0x5b6560, 0x6b6f72, 0x53584f, 0x74716a].map((col) => new THREE.MeshStandardMaterial({ color: col, map: rib, roughness: 0.62, metalness: 0.45 })),
    door: new THREE.MeshStandardMaterial({ color: 0x2c3034, map: rib, roughness: 0.7, metalness: 0.35 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x23272b, roughness: 0.55, metalness: 0.6 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x7c848c, roughness: 0.48, metalness: 0.8 }),
    tank: new THREE.MeshStandardMaterial({ color: 0xa9aaa2, roughness: 0.55, metalness: 0.5 }),
    panel: new THREE.MeshBasicMaterial({ map: lampPanelTexture(), color: new THREE.Color(2.2, 2.1, 1.9), toneMapped: false }),
    red: new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.15, 0.1), toneMapped: false }),
    amber: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.2, 0.15), toneMapped: false }),
    lens: new THREE.MeshStandardMaterial({ color: 0x3a2a12, roughness: 0.3, metalness: 0.2 })
  };
  return shared;
}

function hangar(M, w, d, h, rng, matIdx){
  const g = new THREE.Group();
  const wallH = h * 0.42;
  const walls = new THREE.Mesh(new THREE.BoxGeometry(w, wallH, d), M.cladding[matIdx]);
  walls.position.y = wallH / 2;
  g.add(walls);
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w / 2, d, 24, 1, true, 0, Math.PI), M.cladding[matIdx]);
  roof.rotation.z = Math.PI / 2;
  roof.rotation.y = Math.PI / 2;
  roof.scale.set((h - wallH) / (w / 2), 1, 1);
  roof.position.y = wallH;
  g.add(roof);
  const capShape = new THREE.Shape();
  capShape.absarc(0, 0, w / 2, 0, Math.PI, false);
  capShape.lineTo(-w / 2, 0);
  const capGeo = new THREE.ShapeGeometry(capShape, 16);
  for (const side of [-1, 1]){
    const cap = new THREE.Mesh(capGeo, M.cladding[matIdx]);
    cap.scale.set(1, (h - wallH) / (w / 2), 1);
    cap.position.set(0, wallH, side * d / 2);
    if (side < 0) cap.rotation.y = Math.PI;
    g.add(cap);
  }
  const doorW = w * (0.55 + rng() * 0.2);
  const door = new THREE.Mesh(new THREE.BoxGeometry(doorW, wallH * 0.92 + (h - wallH) * 0.35, 0.3), M.door);
  door.position.set(0, (wallH * 0.92 + (h - wallH) * 0.35) / 2, d / 2 + 0.1);
  g.add(door);
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(doorW + 1.2, 0.5, 0.6), M.trim);
  lintel.position.set(0, door.position.y * 2 + 0.25, d / 2 + 0.2);
  g.add(lintel);
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.25, 0.4), M.panel);
  lamp.position.set(0, lintel.position.y + 0.5, d / 2 + 0.35);
  g.add(lamp);
  return g;
}

function mast(M, height, beacons){
  const g = new THREE.Group();
  const leg = new THREE.BoxGeometry(0.16, height, 0.16);
  const s = 0.55;
  for (const [x, z] of [[-s, -s], [s, -s], [s, s], [-s, s]]){
    const m = new THREE.Mesh(leg, M.steel);
    m.position.set(x, height / 2, z);
    g.add(m);
  }
  const braceGeo = new THREE.BoxGeometry(0.07, 1.6, 0.07);
  for (let y = 1.2; y < height - 1; y += 2.4){
    for (const rot of [0, Math.PI / 2]){
      const b = new THREE.Mesh(braceGeo, M.steel);
      b.position.set(Math.cos(rot) * s, y, Math.sin(rot) * s);
      b.rotation.set(0, rot, 0.7);
      g.add(b);
      const c = b.clone();
      c.position.set(-Math.cos(rot) * s, y, -Math.sin(rot) * s);
      g.add(c);
    }
  }
  const tips = [];
  for (const k of beacons){
    const t = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), M.red);
    t.position.set(0, height * k + 0.3, 0);
    g.add(t);
    tips.push(t);
  }
  return { group: g, tips };
}

function floodTower(M, height){
  const { group } = mast(M, height, []);
  const head = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(4.2, 2.7, 0.4), M.trim);
  head.add(frame);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(3.9, 2.4), M.panel);
  face.position.z = 0.21;
  head.add(face);
  head.position.y = height + 1.2;
  head.rotation.x = 0.32;
  group.add(head);
  return { group, head };
}

function waterTower(M){
  const g = new THREE.Group();
  const legH = 13;
  for (const [x, z] of [[-3, -3], [3, -3], [3, 3], [-3, 3]]){
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, legH, 8), M.steel);
    l.position.set(x * 0.85, legH / 2, z * 0.85);
    l.rotation.set(-z * 0.012, 0, x * 0.012);
    g.add(l);
  }
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4.6, 6, 28), M.tank);
  tank.position.y = legH + 3;
  g.add(tank);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(4.9, 2.2, 28), M.tank);
  cone.position.y = legH + 7.1;
  g.add(cone);
  return g;
}

function beacon(M){
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.18, 12), M.trim);
  g.add(base);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.lens);
  dome.position.y = 0.09;
  g.add(dome);
  const flare = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.18), M.amber);
  flare.position.y = 0.17;
  g.add(flare);
  return { group: g, flare };
}

export function buildFacility(b, opts){
  const o = opts || {};
  const M = materials();
  const group = new THREE.Group();
  group.name = 'ph-facility';
  const rng = rand(Math.round((b.max[0] - b.min[0]) * 131 + (b.max[2] - b.min[2]) * 17));
  const ground = b.min[1] - 0.02;
  const ex = [b.max[0] - b.min[0], b.max[2] - b.min[2]];
  const longZ = ex[1] >= ex[0];
  const cx = (b.min[0] + b.max[0]) / 2;
  const cz = (b.min[2] + b.max[2]) / 2;
  const halfAcross = (longZ ? ex[0] : ex[1]) / 2;
  const halfAlong = (longZ ? ex[1] : ex[0]) / 2;
  const parts = new THREE.Group();
  const place = (along, across, obj, face) => {
    if (longZ) obj.position.set(cx + across, ground, cz + along);
    else obj.position.set(cx + along, ground, cz + across);
    if (face){
      const tx = longZ ? cx : obj.position.x;
      const tz = longZ ? obj.position.z : cz;
      obj.rotation.y = Math.atan2(tx - obj.position.x, tz - obj.position.z);
    }
    parts.add(obj);
  };
  for (const side of [-1, 1]){
    let t = -halfAlong - 30 + rng() * 20;
    let k = 0;
    while (t < halfAlong + 40){
      const w = 26 + rng() * 16;
      const d = 30 + rng() * 22;
      const h = 11 + rng() * 6;
      const dist = halfAcross + 34 + rng() * 40 + w / 2;
      const hg = hangar(M, w, d, h, rng, (k + (side > 0 ? 1 : 0)) % M.cladding.length);
      place(t + d / 2, side * dist, hg, true);
      t += d + 14 + rng() * 26;
      k++;
    }
  }
  for (const sa of [-1, 1]){
    for (const sc of [-1, 1]){
      const ft = floodTower(M, 19 + rng() * 4);
      place(sa * (halfAlong + 6), sc * (halfAcross + 7), ft.group, false);
      ft.group.rotation.y = Math.atan2(cx - ft.group.position.x, cz - ft.group.position.z);
    }
  }
  const comm = mast(M, 46, [0.33, 0.66, 1]);
  place(halfAlong + 70, -(halfAcross + 60), comm.group, false);
  const tank = waterTower(M);
  place(-halfAlong - 55, halfAcross + 48, tank, false);
  parts.updateMatrixWorld(true);
  const byMat = new Map();
  parts.traverse((n) => {
    if (!n.isMesh) return;
    const g = n.geometry.clone();
    g.applyMatrix4(n.matrixWorld);
    for (const key of Object.keys(g.attributes)) if (key !== 'position' && key !== 'normal' && key !== 'uv') g.deleteAttribute(key);
    if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
    if (!byMat.has(n.material)) byMat.set(n.material, []);
    byMat.get(n.material).push(g);
  });
  for (const [mat, list] of byMat){
    const merged = mergeGeometries(list, false);
    for (const g of list) g.dispose();
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.userData.noAO = true;
    group.add(mesh);
  }
  parts.traverse((n) => { if (n.isMesh) n.geometry.dispose(); });
  const beacons = [];
  for (const top of o.beaconSpots || []){
    const bc = beacon(M);
    bc.group.position.set(top[0], top[1], top[2]);
    group.add(bc.group);
    beacons.push(bc);
  }
  function update(time){
    const blink = Math.sin(time * 2.2) > 0.55 ? 1 : 0.08;
    M.red.color.setRGB(3 * blink, 0.15 * blink, 0.1 * blink);
    for (let i = 0; i < beacons.length; i++){
      const f = beacons[i].flare;
      f.rotation.y = time * 4.2 + i * 1.3;
    }
  }
  return { group, update };
}
