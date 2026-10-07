import * as THREE from 'three';
import { loadTexture, loadNormalMap, loadRoughnessMap, stochasticTiling } from '../games/kit/materials.js';

const MATS = ['concrete', 'metal', 'paint', 'emissive'];

export function normalizePrim(p){
  const mn = p && p.min, mx = p && p.max;
  if (!mn || !mx || mn.length < 3 || mx.length < 3) return null;
  const o = {
    type: p.type === 'ramp' ? 'ramp' : 'box',
    min: [Math.min(mn[0], mx[0]), Math.min(mn[1], mx[1]), Math.min(mn[2], mx[2])],
    max: [Math.max(mn[0], mx[0]), Math.max(mn[1], mx[1]), Math.max(mn[2], mx[2])],
    mat: typeof p.mat === 'string' && MATS.indexOf(p.mat) >= 0 ? p.mat : 'concrete',
    axis: 0,
    sign: 1,
    emissive: p.emissive && p.emissive.length >= 3 ? p.emissive : null,
    tint: p.tint && p.tint.length >= 3 ? p.tint : null
  };
  const d = typeof p.dir === 'string' ? p.dir : '+x';
  o.axis = d.indexOf('z') >= 0 ? 2 : 0;
  o.sign = d.indexOf('-') >= 0 ? -1 : 1;
  for (let i = 0; i < 3; i++) if (o.max[i] - o.min[i] < 1e-4) o.max[i] = o.min[i] + 1e-4;
  return o;
}

function builder(){
  return { pos: [], nrm: [], uv: [], col: [], idx: [], groups: new Map() };
}

function pushQuad(b, slot, a, c, d, e, n, uvs, color){
  const base = b.pos.length / 3;
  const pts = [a, c, d, e];
  for (let i = 0; i < 4; i++){
    b.pos.push(pts[i][0], pts[i][1], pts[i][2]);
    b.nrm.push(n[0], n[1], n[2]);
    b.uv.push(uvs[i][0], uvs[i][1]);
    b.col.push(color[0], color[1], color[2]);
  }
  let list = b.groups.get(slot);
  if (!list){ list = []; b.groups.set(slot, list); }
  list.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function pushTri(b, slot, a, c, d, n, uvs, color){
  const base = b.pos.length / 3;
  const pts = [a, c, d];
  for (let i = 0; i < 3; i++){
    b.pos.push(pts[i][0], pts[i][1], pts[i][2]);
    b.nrm.push(n[0], n[1], n[2]);
    b.uv.push(uvs[i][0], uvs[i][1]);
    b.col.push(color[0], color[1], color[2]);
  }
  let list = b.groups.get(slot);
  if (!list){ list = []; b.groups.set(slot, list); }
  list.push(base, base + 1, base + 2);
}

function slotFor(mat, top){
  if (mat === 'metal' || mat === 'paint') return top ? 'metalTop' : 'metalSide';
  if (mat === 'emissive') return 'emissive';
  return top ? 'concreteTop' : 'concreteSide';
}

function shade(p, faceY){
  const t = p.tint || [1, 1, 1];
  const ao = faceY < 0 ? 0.55 : 1;
  return [t[0] * ao, t[1] * ao, t[2] * ao];
}

function addBox(b, p, S){
  const [x0, y0, z0] = p.min;
  const [x1, y1, z1] = p.max;
  const sc = S;
  const topSlot = slotFor(p.mat, true);
  const sideSlot = slotFor(p.mat, false);
  const col = shade(p, 1);
  pushQuad(b, topSlot, [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0],
    [[x0 * sc, -z1 * sc], [x1 * sc, -z1 * sc], [x1 * sc, -z0 * sc], [x0 * sc, -z0 * sc]], col);
  pushQuad(b, sideSlot, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0],
    [[x0 * sc, z0 * sc], [x1 * sc, z0 * sc], [x1 * sc, z1 * sc], [x0 * sc, z1 * sc]], shade(p, -1));
  pushQuad(b, sideSlot, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1],
    [[x0 * sc, y0 * sc], [x1 * sc, y0 * sc], [x1 * sc, y1 * sc], [x0 * sc, y1 * sc]], col);
  pushQuad(b, sideSlot, [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1],
    [[-x1 * sc, y0 * sc], [-x0 * sc, y0 * sc], [-x0 * sc, y1 * sc], [-x1 * sc, y1 * sc]], col);
  pushQuad(b, sideSlot, [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0],
    [[-z1 * sc, y0 * sc], [-z0 * sc, y0 * sc], [-z0 * sc, y1 * sc], [-z1 * sc, y1 * sc]], col);
  pushQuad(b, sideSlot, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0],
    [[z0 * sc, y0 * sc], [z1 * sc, y0 * sc], [z1 * sc, y1 * sc], [z0 * sc, y1 * sc]], col);
}

function addRamp(b, p, S){
  const [x0, y0, z0] = p.min;
  const [x1, y1, z1] = p.max;
  const sc = S;
  const topSlot = slotFor(p.mat, true);
  const sideSlot = slotFor(p.mat, false);
  const col = shade(p, 1);
  const H = (u) => y0 + (y1 - y0) * u;
  const corners = [];
  for (const [x, z] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]){
    const v = p.axis === 0 ? x : z;
    let t = (v - p.min[p.axis]) / (p.max[p.axis] - p.min[p.axis]);
    if (p.sign < 0) t = 1 - t;
    corners.push([x, H(t), z]);
  }
  const span = p.max[p.axis] - p.min[p.axis];
  const h = y1 - y0;
  const l = Math.sqrt(span * span + h * h);
  const g = -h / l * p.sign;
  const n = [p.axis === 0 ? g : 0, span / l, p.axis === 2 ? g : 0];
  const slopeU = (pt) => (p.axis === 0 ? pt[2] : pt[0]) * sc;
  const slopeV = (pt) => {
    const along = p.axis === 0 ? pt[0] : pt[2];
    const t = (along - p.min[p.axis]) / span;
    return (p.sign > 0 ? t : 1 - t) * l * sc;
  };
  const tq = [corners[3], corners[2], corners[1], corners[0]];
  pushQuad(b, topSlot, tq[0], tq[1], tq[2], tq[3], n, tq.map((pt) => [slopeU(pt), slopeV(pt)]), col);
  pushQuad(b, sideSlot, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0],
    [[x0 * sc, z0 * sc], [x1 * sc, z0 * sc], [x1 * sc, z1 * sc], [x0 * sc, z1 * sc]], shade(p, -1));
  if (p.axis === 0){
    const hiX = p.sign > 0 ? x1 : x0;
    const nx = p.sign > 0 ? 1 : -1;
    if (nx > 0) pushQuad(b, sideSlot, [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], [[-z1 * sc, y0 * sc], [-z0 * sc, y0 * sc], [-z0 * sc, y1 * sc], [-z1 * sc, y1 * sc]], col);
    else pushQuad(b, sideSlot, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], [[z0 * sc, y0 * sc], [z1 * sc, y0 * sc], [z1 * sc, y1 * sc], [z0 * sc, y1 * sc]], col);
    const loX = p.sign > 0 ? x0 : x1;
    pushTri(b, sideSlot, [loX, y0, z1], [hiX, y0, z1], [hiX, y1, z1], [0, 0, 1], [[loX * sc, y0 * sc], [hiX * sc, y0 * sc], [hiX * sc, y1 * sc]], col);
    pushTri(b, sideSlot, [hiX, y0, z0], [loX, y0, z0], [hiX, y1, z0], [0, 0, -1], [[-hiX * sc, y0 * sc], [-loX * sc, y0 * sc], [-hiX * sc, y1 * sc]], col);
  } else {
    const hiZ = p.sign > 0 ? z1 : z0;
    const nz = p.sign > 0 ? 1 : -1;
    if (nz > 0) pushQuad(b, sideSlot, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], [[x0 * sc, y0 * sc], [x1 * sc, y0 * sc], [x1 * sc, y1 * sc], [x0 * sc, y1 * sc]], col);
    else pushQuad(b, sideSlot, [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], [[-x1 * sc, y0 * sc], [-x0 * sc, y0 * sc], [-x0 * sc, y1 * sc], [-x1 * sc, y1 * sc]], col);
    const loZ = p.sign > 0 ? z0 : z1;
    pushTri(b, sideSlot, [x1, y0, loZ], [x1, y0, hiZ], [x1, y1, hiZ], [1, 0, 0], [[-loZ * sc, y0 * sc], [-hiZ * sc, y0 * sc], [-hiZ * sc, y1 * sc]], col);
    pushTri(b, sideSlot, [x0, y0, hiZ], [x0, y0, loZ], [x0, y1, hiZ], [-1, 0, 0], [[hiZ * sc, y0 * sc], [loZ * sc, y0 * sc], [hiZ * sc, y1 * sc]], col);
  }
}

function fixWinding(b){
  const P = b.pos;
  const N = b.nrm;
  for (const list of b.groups.values()){
    for (let i = 0; i < list.length; i += 3){
      const a = list[i], c = list[i + 1], d = list[i + 2];
      const ux = P[c * 3] - P[a * 3], uy = P[c * 3 + 1] - P[a * 3 + 1], uz = P[c * 3 + 2] - P[a * 3 + 2];
      const vx = P[d * 3] - P[a * 3], vy = P[d * 3 + 1] - P[a * 3 + 1], vz = P[d * 3 + 2] - P[a * 3 + 2];
      const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      if (cx * N[a * 3] + cy * N[a * 3 + 1] + cz * N[a * 3 + 2] < 0){ list[i + 1] = d; list[i + 2] = c; }
    }
  }
}

function toGeometry(b, order){
  fixWinding(b);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
  const idx = [];
  order.forEach((slot, mi) => {
    const list = b.groups.get(slot);
    if (!list || !list.length) return;
    g.addGroup(idx.length, list.length, mi);
    for (const v of list) idx.push(v);
  });
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

const SLOTS = ['concreteTop', 'concreteSide', 'metalTop', 'metalSide', 'emissive'];

function texSet(name, repeat, size){
  return {
    map: loadTexture(name, { repeat, size }),
    normalMap: loadNormalMap(name, { repeat, strength: 1.4, size }),
    roughnessMap: loadRoughnessMap(name, { repeat, size })
  };
}

function worldMaterials(look){
  const L = look || {};
  const conc = texSet('concrete', 1, 1024);
  const concTop = new THREE.MeshStandardMaterial({ map: conc.map, normalMap: conc.normalMap, roughnessMap: conc.roughnessMap, color: new THREE.Color(L.floorTint || 0x8d8983), roughness: 0.94, metalness: 0, vertexColors: true, envMapIntensity: 0.45 });
  const concSide = new THREE.MeshStandardMaterial({ map: conc.map, normalMap: conc.normalMap, roughnessMap: conc.roughnessMap, color: new THREE.Color(L.wallTint || 0xa9a7a3), roughness: 0.93, metalness: 0, vertexColors: true, envMapIntensity: 0.35 });
  stochasticTiling(concTop);
  const plate = texSet('ph-floor', 3, 512);
  const metalTop = new THREE.MeshStandardMaterial({ map: plate.map, normalMap: plate.normalMap, roughnessMap: plate.roughnessMap, color: new THREE.Color(L.plateTint || 0xf2e2cc), roughness: 0.5, metalness: 0.5, vertexColors: true, envMapIntensity: 0.7 });
  if (L.wet > 0){
    metalTop.roughness = 0.5 * (1 - 0.55 * L.wet);
    metalTop.envMapIntensity = 0.7 + 0.5 * L.wet;
    metalTop.color.multiplyScalar(1 - 0.18 * L.wet);
  }
  const panel = texSet('ph-panel', 1, 512);
  const metalSide = new THREE.MeshStandardMaterial({ map: panel.map, normalMap: panel.normalMap, roughnessMap: panel.roughnessMap, color: new THREE.Color(L.panelTint || 0xf4f0ea), roughness: 0.5, metalness: 0.55, vertexColors: true, envMapIntensity: 0.9 });
  const emissive = new THREE.MeshStandardMaterial({ color: 0x0b0f12, emissive: new THREE.Color(0x6ef3c5), emissiveIntensity: 2.4, roughness: 0.4, metalness: 0.1 });
  for (const m of [concTop, concSide, metalTop, metalSide, emissive]) m.name = 'ph-' + m.uuid.slice(0, 6);
  return [concTop, concSide, metalTop, metalSide, emissive];
}

export function buildStatic(prims, look){
  const b = builder();
  const SC = 0.25;
  for (const p of prims){
    if (p.type === 'ramp') addRamp(b, p, SC);
    else addBox(b, p, SC);
  }
  const geo = toGeometry(b, SLOTS);
  const mats = worldMaterials(look);
  const mesh = new THREE.Mesh(geo, mats);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'ph-world';
  return mesh;
}

export function bounds(prims){
  const mn = [Infinity, Infinity, Infinity];
  const mx = [-Infinity, -Infinity, -Infinity];
  for (const p of prims){
    for (let i = 0; i < 3; i++){
      if (p.min[i] < mn[i]) mn[i] = p.min[i];
      if (p.max[i] > mx[i]) mx[i] = p.max[i];
    }
  }
  if (!isFinite(mn[0])) return { min: [-20, 0, -20], max: [20, 5, 20] };
  return { min: mn, max: mx };
}

const STRIP_VERT = `
attribute vec3 aColor;
varying vec2 vUv;
varying vec3 vColor;
void main(){
  vUv = uv;
  vColor = aColor;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const STRIP_FRAG = `
uniform float uTime;
varying vec2 vUv;
varying vec3 vColor;
void main(){
  float across = abs(vUv.y - 0.5) * 2.0;
  float core = smoothstep(1.0, 0.15, across);
  float pulse = 0.55 + 0.45 * pow(0.5 + 0.5 * sin(vUv.x * 0.9 - uTime * 6.0), 6.0);
  float dash = 0.82 + 0.18 * step(0.5, fract(vUv.x * 1.6 - uTime * 0.8));
  gl_FragColor = vec4(vColor * core * pulse * dash * 1.45, 1.0);
}`;

export function buildStrips(strips){
  if (!strips || !strips.length) return null;
  const pos = [], uv = [], col = [], idx = [];
  let along = 0;
  for (const s of strips){
    if (!s || !s.from || !s.to) continue;
    const a = s.from, b = s.to;
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (L < 1e-3) continue;
    const w = (s.width || 0.08) * 0.5;
    let sx = -dz, sz = dx;
    const sl = Math.sqrt(sx * sx + sz * sz) || 1;
    sx = sx / sl * w; sz = sz / sl * w;
    const c = s.color && s.color.length >= 3 ? s.color : [0.43, 0.95, 0.77];
    const base = pos.length / 3;
    const lift = 0.012;
    const P = [[a[0] - sx, a[1] + lift, a[2] - sz], [a[0] + sx, a[1] + lift, a[2] + sz], [b[0] + sx, b[1] + lift, b[2] + sz], [b[0] - sx, b[1] + lift, b[2] - sz]];
    const U = [[along, 0], [along, 1], [along + L, 1], [along + L, 0]];
    for (let i = 0; i < 4; i++){ pos.push(P[i][0], P[i][1], P[i][2]); uv.push(U[i][0], U[i][1]); col.push(c[0], c[1], c[2]); }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    along += L;
  }
  if (!idx.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: STRIP_VERT,
    fragmentShader: STRIP_FRAG,
    side: THREE.DoubleSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    toneMapped: false
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'ph-strips';
  mesh.renderOrder = 2;
  return mesh;
}

export function buildLamps(props, prims, ceiling){
  const group = new THREE.Group();
  group.name = 'ph-lamps';
  const lamps = [];
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x20262d, roughness: 0.5, metalness: 0.85 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0x15191e, roughness: 0.4, metalness: 0.9 });
  const pole = new THREE.CylinderGeometry(0.045, 0.06, 1, 10);
  const head = new THREE.CylinderGeometry(0.2, 0.26, 0.16, 18);
  const lens = new THREE.CircleGeometry(0.19, 20);
  for (const pr of props || []){
    if (!pr || pr.type !== 'lamp' || !pr.pos) continue;
    const [x, y, z] = pr.pos;
    const c = pr.color && pr.color.length >= 3 ? pr.color : [0.43, 0.95, 0.77];
    const color = new THREE.Color(c[0], c[1], c[2]);
    const g = new THREE.Group();
    const cableLen = Math.max(0.4, (ceiling || y + 26) - (y + 0.14));
    const pm = new THREE.Mesh(pole, poleMat);
    pm.scale.set(0.22, cableLen, 0.22);
    pm.position.set(x, y + 0.14 + cableLen / 2, z);
    const hm = new THREE.Mesh(head, headMat);
    hm.position.set(x, y + 0.06, z);
    hm.castShadow = true;
    const lm = new THREE.Mesh(lens, new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(4.5), toneMapped: false }));
    lm.rotation.x = Math.PI / 2;
    lm.position.set(x, y - 0.025, z);
    g.add(pm, hm, lm);
    group.add(g);
    lamps.push({ pos: new THREE.Vector3(x, y - 0.1, z), color });
  }
  return { group, lamps };
}

export function buildYard(b, look){
  const L = look || {};
  const size = Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]) + 900;
  const cx = (b.min[0] + b.max[0]) / 2;
  const cz = (b.min[2] + b.max[2]) / 2;
  const tex = texSet('asphalt', size / 9, 1024);
  const mat = new THREE.MeshStandardMaterial({ map: tex.map, normalMap: tex.normalMap, roughnessMap: tex.roughnessMap, color: new THREE.Color(L.yardTint || 0x6d7177), roughness: 0.97, metalness: 0 });
  stochasticTiling(mat);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(cx, b.min[1] - 0.02, cz);
  mesh.receiveShadow = true;
  mesh.name = 'ph-yard';
  return mesh;
}
