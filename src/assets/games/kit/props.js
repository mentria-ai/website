import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mulberry32, clamp, lerp, smoothstep } from './math.js';
import * as kwMaterials from './materials.js';

const { loadTexture, gameMaterial, facadeMaterial, loadGameImage } = kwMaterials;

const PROPS_QUALITY_DEFAULTS = {
  low: { name: 'low', shadows: false, drawDistance: 700, vegetation: 0.4, near: 60, impostor: 256 },
  medium: { name: 'medium', shadows: true, drawDistance: 1100, vegetation: 0.7, near: 110, impostor: 512 },
  high: { name: 'high', shadows: true, drawDistance: 1800, vegetation: 1, near: 170, impostor: 512 },
};

function propsQuality(q) {
  if (typeof q === 'string') return PROPS_QUALITY_DEFAULTS[q] || PROPS_QUALITY_DEFAULTS.high;
  if (q && typeof q === 'object') {
    const base = PROPS_QUALITY_DEFAULTS[q.name] || PROPS_QUALITY_DEFAULTS.medium;
    return {
      ...base,
      shadows: q.shadows ?? base.shadows,
      drawDistance: q.drawDistance ?? base.drawDistance,
      vegetation: clamp(q.vegetation ?? base.vegetation, 0, 2),
    };
  }
  return PROPS_QUALITY_DEFAULTS.high;
}

const propsTime = { value: 0 };
let propsRendererRef = null;

export function setPropsRenderer(renderer) {
  propsRendererRef = renderer || null;
}

function tickPropsTime(t) {
  propsTime.value = typeof t === 'number' && t > 1000 ? t : performance.now() / 1000;
}

function propsArgs(a, b) {
  if (a && a.isCamera) return { camera: a, dt: typeof b === 'number' ? b : 0 };
  if (b && b.isCamera) return { camera: b, dt: typeof a === 'number' ? a : 0 };
  return { camera: null, dt: typeof a === 'number' ? a : 0 };
}

function hex(c) {
  return new THREE.Color(c);
}

const tmpColor = new THREE.Color();
const tmpColor2 = new THREE.Color();

function mixHex(a, b, t, out = tmpColor) {
  return out.copy(a).lerp(b, clamp(t, 0, 1));
}

function propsMatrix(x, y, z, yaw = 0, sx = 1, sy = 1, sz = 1, pitch = 0, roll = 0) {
  const m = new THREE.Matrix4();
  const qn = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ'));
  m.compose(new THREE.Vector3(x, y, z), qn, new THREE.Vector3(sx, sy, sz));
  return m;
}

function createGeoBuilder() {
  const pos = [];
  const nor = [];
  const uvs = [];
  const col = [];
  const idx = [];
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const nm = new THREE.Matrix3();
  const one = { r: 1, g: 1, b: 1 };
  function add(geo, matrix, color, uvFn) {
    const p = geo.attributes.position;
    const nn = geo.attributes.normal;
    const t = geo.attributes.uv;
    const c = geo.attributes.color;
    const base = pos.length / 3;
    if (matrix) nm.getNormalMatrix(matrix);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      if (matrix) v.applyMatrix4(matrix);
      pos.push(v.x, v.y, v.z);
      if (nn) {
        n.fromBufferAttribute(nn, i);
        if (matrix) n.applyMatrix3(nm).normalize();
      } else n.set(0, 1, 0);
      nor.push(n.x, n.y, n.z);
      if (uvFn) {
        const r = uvFn(v, n, t ? t.getX(i) : 0, t ? t.getY(i) : 0);
        uvs.push(r[0], r[1]);
      } else if (t) uvs.push(t.getX(i), t.getY(i));
      else uvs.push(0, 0);
      let cc = one;
      if (typeof color === 'function') cc = color(v, n, i);
      else if (color) cc = color;
      else if (c) { col.push(c.getX(i), c.getY(i), c.getZ(i)); continue; }
      col.push(cc.r, cc.g, cc.b);
    }
    if (geo.index) {
      for (let i = 0; i < geo.index.count; i++) idx.push(base + geo.index.getX(i));
    } else {
      for (let i = 0; i < p.count; i++) idx.push(base + i);
    }
  }
  function quad(a, b, c, d, normal, uvA, uvB, uvC, uvD, color) {
    const base = pos.length / 3;
    const cc = color || one;
    const pts = [a, b, c, d];
    const us = [uvA, uvB, uvC, uvD];
    for (let i = 0; i < 4; i++) {
      pos.push(pts[i].x, pts[i].y, pts[i].z);
      nor.push(normal.x, normal.y, normal.z);
      uvs.push(us[i][0], us[i][1]);
      col.push(cc.r, cc.g, cc.b);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  function build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const count = pos.length / 3;
    g.setIndex(count > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
  return { add, quad, build, get vertexCount() { return pos.length / 3; }, get empty() { return pos.length === 0; } };
}

function propsHash3(ix, iy, iz, seed) {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(iz, 2147483647) + Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function propsNoise3(x, y, z, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);
  const a = lerp(propsHash3(ix, iy, iz, seed), propsHash3(ix + 1, iy, iz, seed), ux);
  const b = lerp(propsHash3(ix, iy + 1, iz, seed), propsHash3(ix + 1, iy + 1, iz, seed), ux);
  const c = lerp(propsHash3(ix, iy, iz + 1, seed), propsHash3(ix + 1, iy, iz + 1, seed), ux);
  const d = lerp(propsHash3(ix, iy + 1, iz + 1, seed), propsHash3(ix + 1, iy + 1, iz + 1, seed), ux);
  return lerp(lerp(a, b, uy), lerp(c, d, uy), uz);
}

function propsFbm3(x, y, z, seed, octaves = 3) {
  let s = 0;
  let a = 1;
  let norm = 0;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    s += a * propsNoise3(x * f, y * f, z * f, seed + i * 17);
    norm += a;
    a *= 0.5;
    f *= 2.03;
  }
  return s / norm;
}

function displaceBlob(geo, center, radius, amount, seed, freq = 0.9) {
  const p = geo.attributes.position;
  const v = new THREE.Vector3();
  const dir = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    dir.copy(v).sub(center).normalize();
    const nval = propsFbm3(v.x * freq + 11.3, v.y * freq + 3.1, v.z * freq - 7.7, seed, 3) - 0.5;
    v.addScaledVector(dir, nval * amount * radius * 2);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

function sphericalNormals(geo, center, blend) {
  const p = geo.attributes.position;
  const nn = geo.attributes.normal;
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const s = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    n.fromBufferAttribute(nn, i);
    s.copy(v).sub(center).normalize();
    n.lerp(s, blend).normalize();
    nn.setXYZ(i, n.x, n.y, n.z);
  }
  return geo;
}

function stripUv(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  return g;
}

const PALETTES = {
  temperate: {
    pineDeep: hex('#1c3424'), pineMid: hex('#2b4f31'), pineTip: hex('#5a8048'),
    oakDeep: hex('#28441a'), oakMid: hex('#4a6e26'), oakTip: hex('#93b04a'),
    bushDeep: hex('#2a4a1c'), bushMid: hex('#4b6e2c'), bushTip: hex('#86a448'),
    bark: hex('#4a3626'), barkDark: hex('#241912'),
    rockA: hex('#7d776f'), rockB: hex('#57524c'), rockC: hex('#9a948a'), moss: hex('#4c5e2a'),
  },
  arid: {
    pineDeep: hex('#1b2a18'), pineMid: hex('#2c4226'), pineTip: hex('#56693a'),
    oakDeep: hex('#3a3f22'), oakMid: hex('#5d6534'), oakTip: hex('#8a8f55'),
    bushDeep: hex('#45472c'), bushMid: hex('#6c6f45'), bushTip: hex('#9a9a66'),
    bark: hex('#5a4532'), barkDark: hex('#2e2318'),
    rockA: hex('#a8775a'), rockB: hex('#7a5440'), rockC: hex('#c49572'), moss: hex('#8a6a4e'),
  },
};

function buildPineGeometry(seed, pal) {
  const rng = mulberry32(seed);
  const b = createGeoBuilder();
  const trunk = new THREE.CylinderGeometry(0.12, 0.3, 5.2, 7, 3, true);
  b.add(stripUv(trunk), propsMatrix(0, 2.6, 0), (v) => mixHex(pal.barkDark, pal.bark, v.y / 4));
  const tiers = 6;
  let y = 1.9;
  let top = 0;
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const r = lerp(3.1, 0.8, Math.pow(t, 0.9)) * (0.92 + rng() * 0.16);
    const h = lerp(4.0, 2.5, t);
    const cone = new THREE.ConeGeometry(r, h, 10, 3, true);
    const pa = cone.attributes.position;
    for (let k = 0; k < pa.count; k++) {
      let x = pa.getX(k);
      let yy = pa.getY(k);
      let z = pa.getZ(k);
      const rr = Math.hypot(x, z);
      if (rr > 0.01) {
        const ang = Math.atan2(z, x);
        const lobe = 0.78 + 0.3 * Math.abs(Math.sin(ang * 2.5 + i * 1.3)) + rng() * 0.14;
        const edge = yy < -h / 2 + 0.01;
        const j = edge ? lobe : 0.94 + rng() * 0.1;
        x *= j;
        z *= j;
        if (edge) yy -= 0.25 + rng() * 0.55;
      }
      pa.setXYZ(k, x, yy, z);
    }
    cone.computeVertexNormals();
    const cy = y + h / 2;
    const rot = rng() * Math.PI * 2;
    const tierShade = lerp(0.62, 1.0, t);
    const g = stripUv(cone);
    sphericalNormals(g, new THREE.Vector3(0, cy - h * 0.9, 0), 0.45);
    b.add(g, propsMatrix(0, cy, 0, rot), (v) => {
      const local = clamp((v.y - (cy - h / 2)) / h, 0, 1);
      const radial = clamp(Math.hypot(v.x, v.z) / r, 0, 1);
      mixHex(pal.pineDeep, pal.pineMid, radial * 0.9 + (1 - local) * 0.1, tmpColor2);
      if (radial > 0.7) tmpColor2.lerp(pal.pineTip, (radial - 0.7) * 1.4);
      return tmpColor2.multiplyScalar(tierShade);
    });
    top = Math.max(top, y + h);
    y += h * 0.52;
  }
  const geo = b.build();
  return { geometry: geo, height: top, width: 6.6, trunkRadius: 0.3, canopyRadius: 3.0, canopyY: top * 0.45, topY: top * 0.55, sway: 0.18, doubleSided: false };
}

function buildOakGeometry(seed, pal) {
  const rng = mulberry32(seed);
  const b = createGeoBuilder();
  const trunk = new THREE.CylinderGeometry(0.26, 0.48, 4.6, 8, 4, true);
  const tp = trunk.attributes.position;
  for (let k = 0; k < tp.count; k++) {
    const yy = tp.getY(k);
    const bend = Math.sin((yy + 2.3) * 0.7) * 0.18;
    tp.setX(k, tp.getX(k) + bend);
  }
  trunk.computeVertexNormals();
  b.add(stripUv(trunk), propsMatrix(0, 2.3, 0), (v) => mixHex(pal.barkDark, pal.bark, v.y / 5));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + rng() * 0.8;
    const len = 2.6 + rng() * 1.0;
    const br = new THREE.CylinderGeometry(0.07, 0.16, len, 5, 1, true);
    br.translate(0, len / 2, 0);
    const m = new THREE.Matrix4().makeRotationY(a).multiply(new THREE.Matrix4().makeRotationZ(0.75 + rng() * 0.35));
    m.setPosition(0.1, 3.6 + rng() * 0.6, 0);
    b.add(stripUv(br), m, (v) => mixHex(pal.barkDark, pal.bark, 0.6));
  }
  const center = new THREE.Vector3(0, 6.8, 0);
  const blobs = [
    [0, 8.1, 0, 2.7], [2.2, 6.7, 0.5, 2.3], [-2.0, 6.9, 1.2, 2.2], [0.5, 6.4, -2.3, 2.3],
    [-1.2, 5.8, -1.4, 2.0], [1.4, 5.6, 2.0, 1.9], [-0.3, 9.4, 0.5, 1.8], [2.6, 7.9, -1.4, 1.7], [-2.6, 7.8, -0.8, 1.7],
  ];
  for (let i = 0; i < blobs.length; i++) {
    const [bx, by, bz, br] = blobs[i];
    const r = br * (0.88 + rng() * 0.24);
    const geo = new THREE.IcosahedronGeometry(r, 1);
    geo.translate(bx + (rng() - 0.5) * 0.5, by + (rng() - 0.5) * 0.4, bz + (rng() - 0.5) * 0.5);
    displaceBlob(geo, new THREE.Vector3(bx, by, bz), r, 0.32, seed + i * 7, 1.1);
    sphericalNormals(geo, center, 0.62);
    b.add(geo, null, (v, n) => {
      const outward = clamp(v.clone().sub(center).length() / 4.2, 0, 1);
      const up = clamp((v.y - 4.5) / 5.5, 0, 1);
      mixHex(pal.oakDeep, pal.oakMid, outward * 0.75 + up * 0.35, tmpColor2);
      if (n.y > 0.35) tmpColor2.lerp(pal.oakTip, (n.y - 0.35) * 0.7 * outward);
      return tmpColor2;
    });
  }
  const geo = b.build();
  return { geometry: geo, height: 11.2, width: 10, trunkRadius: 0.45, canopyRadius: 4.2, canopyY: 6.8, topY: 7.4, sway: 0.16, doubleSided: false };
}

function buildPalmGeometry(seed, pal) {
  const rng = mulberry32(seed);
  const b = createGeoBuilder();
  const H = 9.5;
  const bend = 1.6 + rng() * 0.8;
  const pts = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    pts.push(new THREE.Vector3(bend * t * t, H * t, 0));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const segs = 18;
  const radial = 7;
  const tube = new THREE.TubeGeometry(curve, segs, 0.2, radial, false);
  const tpos = tube.attributes.position;
  const cpt = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    curve.getPointAt(i / segs, cpt);
    const scale = lerp(1.45, 0.85, i / segs);
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      const x = tpos.getX(k);
      const y = tpos.getY(k);
      const z = tpos.getZ(k);
      tpos.setXYZ(k, cpt.x + (x - cpt.x) * scale, cpt.y + (y - cpt.y) * scale, cpt.z + (z - cpt.z) * scale);
    }
  }
  tube.computeVertexNormals();
  const barkA = hex('#9a8a70');
  const barkB = hex('#62533f');
  b.add(stripUv(tube), null, (v) => {
    const ring = (v.y * 2.4) % 1;
    return mixHex(barkB, barkA, ring < 0.35 ? 0.15 : 0.85);
  });
  const topP = curve.getPointAt(1);
  const frondCount = 11;
  const leafA = hex('#2d4a17');
  const leafB = hex('#5b7a26');
  const leafC = hex('#8a9a3e');
  const geoFronds = new THREE.BufferGeometry();
  const P = [];
  const C = [];
  const pushTri = (a, bb, c, ca, cb, cc) => {
    P.push(a.x, a.y, a.z, bb.x, bb.y, bb.z, c.x, c.y, c.z);
    C.push(ca.r, ca.g, ca.b, cb.r, cb.g, cb.b, cc.r, cc.g, cc.b);
  };
  for (let f = 0; f < frondCount; f++) {
    const az = (f / frondCount) * Math.PI * 2 + rng() * 0.4;
    const len = 3.6 + rng() * 1.2;
    const lift = 0.9 + rng() * 0.8;
    const droop = 2.6 + rng() * 1.2;
    const dir = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const steps = 12;
    let prevSpine = null;
    let prevL = null;
    let prevR = null;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const spine = topP.clone().addScaledVector(dir, len * t);
      spine.y += lift * t - droop * t * t;
      const w = 0.85 * Math.sin(Math.PI * Math.min(1, t * 1.15)) * (s % 2 === 0 ? 1 : 0.62);
      const sag = 0.35 * w;
      const L = spine.clone().addScaledVector(side, w);
      L.y -= sag;
      const R = spine.clone().addScaledVector(side, -w);
      R.y -= sag;
      if (prevSpine) {
        const cS = mixHex(leafA, leafB, t * 0.5, new THREE.Color());
        const cE = mixHex(leafB, leafC, t, new THREE.Color());
        pushTri(prevSpine, prevL, spine, cS, cE, cS);
        pushTri(prevL, L, spine, cE, cE, cS);
        pushTri(prevSpine, spine, prevR, cS, cS, cE);
        pushTri(prevR, spine, R, cE, cS, cE);
      }
      prevSpine = spine;
      prevL = L;
      prevR = R;
    }
  }
  geoFronds.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geoFronds.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  geoFronds.computeVertexNormals();
  const fn = geoFronds.attributes.normal;
  for (let i = 0; i < fn.count; i++) {
    let nx = fn.getX(i);
    let ny = fn.getY(i);
    let nz = fn.getZ(i);
    if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const l = Math.hypot(nx, ny + 0.8, nz);
    fn.setXYZ(i, nx / l, (ny + 0.8) / l, nz / l);
  }
  b.add(geoFronds, null, null);
  for (let i = 0; i < 4; i++) {
    const nut = new THREE.IcosahedronGeometry(0.17, 0);
    const a = rng() * Math.PI * 2;
    nut.translate(topP.x + Math.cos(a) * 0.28, topP.y - 0.35, topP.z + Math.sin(a) * 0.28);
    b.add(nut, null, hex('#3a2d18'));
  }
  const geo = b.build();
  return { geometry: geo, height: H + 1.2, width: 9.5, trunkRadius: 0.3, canopyRadius: 4, canopyY: H, topY: H - 0.2, sway: 0.28, doubleSided: true, foliageDetail: false };
}

function ribbedColumn(radius, height, ribs, radialSegs, heightSegs) {
  const geo = new THREE.CylinderGeometry(radius, radius * 1.08, height, radialSegs, heightSegs, true);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    const a = Math.atan2(z, x);
    const k = 1 + 0.09 * Math.cos(a * ribs);
    p.setX(i, x * k);
    p.setZ(i, z * k);
  }
  geo.computeVertexNormals();
  return geo;
}

function ribbedCap(radius, ribs, segs) {
  const geo = new THREE.SphereGeometry(radius, segs, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    const a = Math.atan2(z, x);
    const k = 1 + 0.09 * Math.cos(a * ribs);
    p.setX(i, x * k);
    p.setZ(i, z * k);
  }
  geo.computeVertexNormals();
  return geo;
}

function buildCactusGeometry(seed) {
  const rng = mulberry32(seed);
  const b = createGeoBuilder();
  const base = hex('#3f6a34');
  const crest = hex('#6d9a55');
  const groove = hex('#24401f');
  const foot = hex('#5f5a3a');
  const colorFn = (v, n) => {
    const a = Math.atan2(n.z, n.x);
    const rib = Math.cos(a * 12);
    mixHex(groove, base, rib * 0.5 + 0.5, tmpColor2);
    if (rib > 0.6) tmpColor2.lerp(crest, (rib - 0.6) * 1.6);
    if (v.y < 0.6) tmpColor2.lerp(foot, (0.6 - v.y) * 0.9);
    return tmpColor2;
  };
  const H = 5.6 + rng() * 1.2;
  const col = ribbedColumn(0.42, H, 12, 24, 6);
  col.translate(0, H / 2, 0);
  b.add(stripUv(col), null, colorFn);
  const cap = ribbedCap(0.42, 12, 24);
  cap.translate(0, H, 0);
  b.add(stripUv(cap), null, colorFn);
  const arms = 1 + Math.floor(rng() * 2.6);
  for (let i = 0; i < arms; i++) {
    const a = i * Math.PI + rng() * 0.6;
    const y0 = H * (0.35 + rng() * 0.2);
    const out = 0.9 + rng() * 0.4;
    const up = 1.4 + rng() * 1.3;
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, y0, 0),
      new THREE.Vector3(dir.x * out * 0.7, y0 + 0.1, dir.z * out * 0.7),
      new THREE.Vector3(dir.x * out, y0 + 0.6, dir.z * out),
      new THREE.Vector3(dir.x * out, y0 + up, dir.z * out),
    ]);
    const arm = new THREE.TubeGeometry(curve, 10, 0.27, 16, false);
    const ap = arm.attributes.position;
    const cp = new THREE.Vector3();
    for (let s = 0; s <= 10; s++) {
      curve.getPointAt(s / 10, cp);
      for (let j = 0; j <= 16; j++) {
        const k = s * 17 + j;
        const dx = ap.getX(k) - cp.x;
        const dy = ap.getY(k) - cp.y;
        const dz = ap.getZ(k) - cp.z;
        const ang = j / 16 * Math.PI * 2;
        const kk = 1 + 0.08 * Math.cos(ang * 10);
        ap.setXYZ(k, cp.x + dx * kk, cp.y + dy * kk, cp.z + dz * kk);
      }
    }
    arm.computeVertexNormals();
    b.add(stripUv(arm), null, colorFn);
    const acap = ribbedCap(0.27, 10, 16);
    acap.translate(dir.x * out, y0 + up, dir.z * out);
    b.add(stripUv(acap), null, colorFn);
  }
  const geo = b.build();
  return { geometry: geo, height: H + 0.45, width: 3.2, trunkRadius: 0.45, canopyRadius: 1.2, canopyY: H * 0.6, topY: H * 0.7, sway: 0, doubleSided: false, foliageDetail: false };
}

function buildBushGeometry(seed, pal) {
  const rng = mulberry32(seed);
  const b = createGeoBuilder();
  const center = new THREE.Vector3(0, 0.55, 0);
  const n = 5;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng();
    const d = i === 0 ? 0 : 0.55 + rng() * 0.3;
    const r = (i === 0 ? 0.85 : 0.6 + rng() * 0.25);
    const geo = new THREE.IcosahedronGeometry(r, 1);
    const cx = Math.cos(a) * d;
    const cz = Math.sin(a) * d;
    const cy = r * 0.72 + (i === 0 ? 0.15 : 0);
    geo.translate(cx, cy, cz);
    displaceBlob(geo, new THREE.Vector3(cx, cy, cz), r, 0.3, seed + i * 13, 2.2);
    const p = geo.attributes.position;
    for (let k = 0; k < p.count; k++) if (p.getY(k) < 0.02) p.setY(k, 0.02);
    sphericalNormals(geo, center, 0.6);
    b.add(geo, null, (v, nn) => {
      const up = clamp(v.y / 1.5, 0, 1);
      mixHex(pal.bushDeep, pal.bushMid, up, tmpColor2);
      if (nn.y > 0.4) tmpColor2.lerp(pal.bushTip, (nn.y - 0.4) * 0.6);
      return tmpColor2;
    });
  }
  const geo = b.build();
  return { geometry: geo, height: 1.7, width: 2.8, trunkRadius: 0.5, canopyRadius: 1.2, canopyY: 0.8, topY: 1.0, sway: 0.05, doubleSided: false };
}

function buildRockGeometry(seed, pal, detail) {
  const geo = new THREE.IcosahedronGeometry(1, detail);
  const p = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = propsFbm3(v.x * 1.3 + 5, v.y * 1.3, v.z * 1.3 - 3, seed, 3);
    const k = 0.72 + n * 0.62;
    v.multiplyScalar(k);
    v.y *= 0.62;
    if (v.y < -0.18) v.y = -0.18 - (v.y + 0.18) * 0.15;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  const b = createGeoBuilder();
  b.add(geo, null, (vv, nn) => {
    const nval = propsFbm3(vv.x * 3.1, vv.y * 3.1, vv.z * 3.1, seed + 99, 2);
    mixHex(pal.rockB, pal.rockA, nval * 1.4 - 0.2, tmpColor2);
    if (nn.y < -0.2) tmpColor2.lerp(pal.rockB, 0.5);
    if (nval > 0.62) tmpColor2.lerp(pal.rockC, (nval - 0.62) * 2);
    if (nn.y > 0.55) tmpColor2.lerp(pal.moss, (nn.y - 0.55) * 1.2 * smoothstep(0.35, 0.65, propsNoise3(vv.x * 2, vv.y * 2, vv.z * 2, seed + 5)));
    return tmpColor2;
  });
  const out = b.build();
  return { geometry: out, height: 1.0, width: 2, trunkRadius: 0.85, canopyRadius: 1, canopyY: 0.3, topY: 0.6, sway: 0, doubleSided: false, foliageDetail: false };
}

const VEG_BUILDERS = {
  pine: buildPineGeometry,
  oak: buildOakGeometry,
  palm: buildPalmGeometry,
  cactus: buildCactusGeometry,
  bush: buildBushGeometry,
};

const VEG_SIZES = {
  pine: { scale: [0.75, 1.35], density: 1 },
  oak: { scale: [0.75, 1.25], density: 1 },
  palm: { scale: [0.8, 1.2], density: 1 },
  cactus: { scale: [0.7, 1.25], density: 1 },
  bush: { scale: [0.6, 1.4], density: 1 },
  rock: { scale: [0.5, 2.6], density: 1 },
};

const vegetationCache = new Map();

function vegetationModel(kind, biome) {
  const key = kind + '|' + biome;
  if (vegetationCache.has(key)) return vegetationCache.get(key);
  const pal = PALETTES[biome] || PALETTES.temperate;
  let model;
  if (kind === 'rock') {
    model = buildRockGeometry(41, pal, 2);
    model.farGeometry = buildRockGeometry(41, pal, 1).geometry;
  } else {
    model = (VEG_BUILDERS[kind] || buildPineGeometry)(kind === 'pine' ? 3 : kind === 'oak' ? 5 : 7, pal);
  }
  vegetationCache.set(key, model);
  return model;
}

const DITHER_GLSL = `
float kwPropsDither(vec2 fc) {
  return fract(52.9829189 * fract(dot(fc, vec2(0.06711056, 0.00583715))));
}
`;

const FOLIAGE_GLSL = `
float kwVegHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float kwVegNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(kwVegHash(i), kwVegHash(i + vec3(1.0, 0.0, 0.0)), f.x),
                 mix(kwVegHash(i + vec3(0.0, 1.0, 0.0)), kwVegHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(kwVegHash(i + vec3(0.0, 0.0, 1.0)), kwVegHash(i + vec3(1.0, 0.0, 1.0)), f.x),
                 mix(kwVegHash(i + vec3(0.0, 1.0, 1.0)), kwVegHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
vec3 kwVegPerturb(vec3 surfPos, vec3 surfNorm, vec2 dHdxy) {
  vec3 sigX = dFdx(surfPos);
  vec3 sigY = dFdy(surfPos);
  vec3 r1 = cross(sigY, surfNorm);
  vec3 r2 = cross(surfNorm, sigX);
  float det = dot(sigX, r1);
  vec3 grad = sign(det) * (dHdxy.x * r1 + dHdxy.y * r2);
  return normalize(abs(det) * surfNorm - grad);
}
`;

function nearVegetationMaterial(model, fadeStart, fadeEnd, castShadow) {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.88,
    metalness: 0,
    side: model.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    flatShading: model.flat === true,
  });
  const fade = { value: new THREE.Vector2(fadeStart, fadeEnd) };
  const sway = { value: new THREE.Vector2(model.sway || 0, Math.max(model.height, 1)) };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.kwPropsTime = propsTime;
    shader.uniforms.kwFade = fade;
    shader.uniforms.kwSway = sway;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float kwPropsTime;\nuniform vec2 kwFade;\nuniform vec2 kwSway;\nvarying float kwFadeAlpha;\nvarying vec3 kwLocalPos;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
  kwLocalPos = position;
#ifdef USE_INSTANCING
  vec3 kwOrigin = instanceMatrix[3].xyz;
#else
  vec3 kwOrigin = vec3(0.0);
#endif
  float kwH = clamp(position.y / kwSway.y, 0.0, 1.0);
  float kwPhase = dot(kwOrigin.xz, vec2(0.13, 0.17));
  float kwW = kwSway.x * kwH * kwH;
  transformed.x += sin(kwPropsTime * 1.3 + kwPhase) * kwW + sin(kwPropsTime * 3.1 + kwPhase * 2.3 + position.y) * kwW * 0.25;
  transformed.z += cos(kwPropsTime * 1.1 + kwPhase * 1.7) * kwW * 0.7;
  float kwDist = distance(cameraPosition.xz, kwOrigin.xz);
  kwFadeAlpha = 1.0 - smoothstep(kwFade.x, kwFade.y, kwDist);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float kwFadeAlpha;\nvarying vec3 kwLocalPos;\nfloat kwBumpH = 0.0;\nfloat kwLeaf = 0.0;\nfloat kwClump = 1.0;\n' + DITHER_GLSL + FOLIAGE_GLSL)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n  if (kwFadeAlpha < 0.999 && kwFadeAlpha <= kwPropsDither(gl_FragCoord.xy)) discard;')
      .replace('#include <color_fragment>', `#include <color_fragment>
  kwLeaf = clamp((diffuseColor.g - diffuseColor.r) * 10.0, 0.0, 1.0) * kwFoliage;
  if (kwLeaf > 0.0) {
    float kwN1 = kwVegNoise(kwLocalPos * 2.4);
    float kwN2 = kwVegNoise(kwLocalPos * 6.8 + 3.1);
    kwClump = kwN1 * 0.6 + kwN2 * 0.4;
    diffuseColor.rgb *= mix(1.0, mix(0.42, 1.22, kwClump), kwLeaf);
    kwBumpH = kwClump * kwLeaf * 0.9;
  }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  if (kwLeaf > 0.0) {
    normal = kwVegPerturb(-vViewPosition, normal, vec2(dFdx(kwBumpH), dFdy(kwBumpH)));
    float kwGraze = 1.0 - abs(dot(normal, normalize(vViewPosition)));
    if (kwLeaf > 0.5 && kwClump < kwGraze * 1.05 - 0.32) discard;
  }`);
    shader.uniforms.kwFoliage = { value: model.foliageDetail === false ? 0 : 1 };
    shader.fragmentShader = shader.fragmentShader.replace('varying vec3 kwLocalPos;', 'varying vec3 kwLocalPos;\nuniform float kwFoliage;');
  };
  mat.customProgramCacheKey = () => 'kwNearVeg' + (model.doubleSided ? 'D' : 'S') + (model.foliageDetail === false ? 'n' : 'f');
  mat.userData.kwFade = fade;
  return mat;
}

function farVegetationMaterial(texture, texSize, fadeStart, fadeEnd, brightness) {
  const mat = new THREE.MeshStandardMaterial({
    map: texture,
    alphaTest: 0.42,
    roughness: 0.95,
    metalness: 0,
    color: new THREE.Color(brightness, brightness, brightness),
  });
  const fade = { value: new THREE.Vector2(fadeStart, fadeEnd) };
  const texDim = { value: new THREE.Vector2(texSize * 2, texSize) };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.kwFade = fade;
    shader.uniforms.kwTexDim = texDim;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float kwCard;\nuniform vec2 kwFade;\nvarying float kwFadeAlpha;')
      .replace('#include <beginnormal_vertex>', `
#ifdef USE_INSTANCING
  vec3 kwOrigin = instanceMatrix[3].xyz;
#else
  vec3 kwOrigin = vec3(0.0);
#endif
  vec3 kwToCam = cameraPosition - kwOrigin;
  vec2 kwF = normalize(kwToCam.xz + vec2(0.0001, 0.0));
  vec3 kwRight = vec3(kwF.y, 0.0, -kwF.x);
  vec3 kwFwd = vec3(kwF.x, 0.0, kwF.y);
  float kwElev = clamp(kwToCam.y / max(length(kwToCam), 0.001), 0.0, 1.0);
  float kwTilt = asin(kwElev) * 0.62;
  vec3 kwUp = vec3(0.0, cos(kwTilt), 0.0) - kwFwd * sin(kwTilt);
  vec3 kwCardN = kwFwd * cos(kwTilt) + vec3(0.0, sin(kwTilt), 0.0);
  float kwDist = length(kwToCam.xz);
  float kwDistFade = smoothstep(kwFade.x, kwFade.y, kwDist);
  vec3 objectNormal = kwCard < 0.5 ? normalize(kwCardN * 0.55 + vec3(0.0, 0.83, 0.0)) : vec3(0.0, 1.0, 0.0);
  kwFadeAlpha = kwDistFade * (kwCard < 0.5 ? 1.0 - smoothstep(0.88, 0.95, kwElev) : smoothstep(0.86, 0.93, kwElev));
#ifdef USE_TANGENT
  vec3 objectTangent = vec3( tangent.xyz );
#endif`)
      .replace('#include <begin_vertex>', `vec3 transformed = kwCard < 0.5 ? kwRight * position.x + kwUp * position.y + kwFwd * position.z : position;
#ifdef USE_ALPHAHASH
  vPosition = vec3( position );
#endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float kwFadeAlpha;\nuniform vec2 kwTexDim;\n' + DITHER_GLSL)
      .replace('#include <alphatest_fragment>', `
#ifdef USE_MAP
  vec2 kwTx = vMapUv * kwTexDim;
  float kwLod = max(0.0, 0.5 * log2(max(dot(dFdx(kwTx), dFdx(kwTx)), dot(dFdy(kwTx), dFdy(kwTx)))));
  diffuseColor.a *= 1.0 + kwLod * 0.22;
#endif
  if (diffuseColor.a < alphaTest) discard;
  if (kwFadeAlpha < 0.999 && kwFadeAlpha <= kwPropsDither(gl_FragCoord.xy)) discard;`);
  };
  mat.customProgramCacheKey = () => 'kwFarVeg';
  mat.userData.kwFade = fade;
  return mat;
}

function cardGeometry(model) {
  const S = Math.max(model.width, model.height) * 1.04;
  const W = model.width * 1.04;
  const topY = model.topY;
  const pos = [
    -S / 2, 0, 0, S / 2, 0, 0, S / 2, S, 0, -S / 2, S, 0,
    -W / 2, topY, W / 2, W / 2, topY, W / 2, W / 2, topY, -W / 2, -W / 2, topY, -W / 2,
  ];
  const uv = [
    0, 0, 0.5, 0, 0.5, 1, 0, 1,
    0.5, 0, 1, 0, 1, 1, 0.5, 1,
  ];
  const nrm = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
  const card = [0, 0, 0, 0, 1, 1, 1, 1];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('kwCard', new THREE.Float32BufferAttribute(card, 1));
  geo.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, S / 2, 0), S);
  return { geometry: geo, S, W, topY };
}

function averageVertexColor(geo) {
  const c = geo.attributes.color;
  let r = 0;
  let g = 0;
  let b = 0;
  const n = Math.max(1, c.count);
  for (let i = 0; i < c.count; i++) {
    r += c.getX(i);
    g += c.getY(i);
    b += c.getZ(i);
  }
  return new THREE.Color(r / n, g / n, b / n);
}

function renderVegetationImpostor(renderer, model, card, size) {
  const rt = new THREE.WebGLRenderTarget(size * 2, size, {
    colorSpace: THREE.SRGBColorSpace,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true,
  });
  rt.texture.anisotropy = 4;
  const scene = new THREE.Scene();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: model.doubleSided ? THREE.DoubleSide : THREE.FrontSide });
  const mesh = new THREE.Mesh(model.geometry, mat);
  scene.add(mesh);
  scene.add(new THREE.AmbientLight(0xffffff, 1.05));
  const key = new THREE.DirectionalLight(0xffffff, 0.75);
  key.position.set(0.3, 1, 0.6);
  scene.add(key);
  const side = new THREE.OrthographicCamera(-card.S / 2, card.S / 2, card.S, 0, 0.1, 200);
  side.position.set(0, 0, 60);
  side.lookAt(0, 0, 0);
  const top = new THREE.OrthographicCamera(-card.W / 2, card.W / 2, card.W / 2, -card.W / 2, 0.1, 400);
  top.up.set(0, 0, -1);
  top.position.set(0, 120, 0);
  top.lookAt(0, 0, 0);
  const prevTarget = renderer.getRenderTarget();
  const prevClear = new THREE.Color();
  renderer.getClearColor(prevClear);
  const prevAlpha = renderer.getClearAlpha();
  const prevAutoClear = renderer.autoClear;
  const prevShadowAuto = renderer.shadowMap.autoUpdate;
  renderer.shadowMap.autoUpdate = false;
  const avg = averageVertexColor(model.geometry);
  renderer.setClearColor(avg, 0);
  renderer.autoClear = false;
  rt.scissorTest = true;
  rt.viewport.set(0, 0, size * 2, size);
  rt.scissor.set(0, 0, size * 2, size);
  renderer.setRenderTarget(rt);
  renderer.clear(true, true, true);
  rt.viewport.set(0, 0, size, size);
  rt.scissor.set(0, 0, size, size);
  renderer.setRenderTarget(rt);
  renderer.render(scene, side);
  rt.viewport.set(size, 0, size, size);
  rt.scissor.set(size, 0, size, size);
  renderer.setRenderTarget(rt);
  renderer.clearDepth();
  renderer.render(scene, top);
  rt.viewport.set(0, 0, size * 2, size);
  rt.scissor.set(0, 0, size * 2, size);
  rt.scissorTest = false;
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevClear, prevAlpha);
  renderer.autoClear = prevAutoClear;
  renderer.shadowMap.autoUpdate = prevShadowAuto;
  mat.dispose();
  return rt;
}

function readImpostorCanvas(renderer, rt, size) {
  const w = size * 2;
  const h = size;
  const buf = new Uint8Array(w * h * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const src = (h - 1 - y) * w * 4;
    img.data.set(buf.subarray(src, src + w * 4), y * w * 4);
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function paintVegetationFallback(kind, model, size) {
  const canvas = document.createElement('canvas');
  canvas.width = size * 2;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const avg = averageVertexColor(model.geometry).convertLinearToSRGB();
  const col = (k) => {
    const c = avg.clone().multiplyScalar(k);
    return 'rgb(' + Math.round(clamp(c.r, 0, 1) * 255) + ',' + Math.round(clamp(c.g, 0, 1) * 255) + ',' + Math.round(clamp(c.b, 0, 1) * 255) + ')';
  };
  const S = Math.max(model.width, model.height) * 1.04;
  const px = size / S;
  const cx = size / 2;
  const ground = size;
  const rng = mulberry32(5);
  ctx.fillStyle = '#3a2a1c';
  ctx.fillRect(cx - model.trunkRadius * px, ground - model.height * 0.45 * px, model.trunkRadius * 2 * px, model.height * 0.45 * px);
  for (let i = 0; i < 140; i++) {
    const t = rng();
    const y = model.height * (kind === 'pine' ? 0.15 + t * 0.85 : 0.35 + t * 0.6);
    const halfW = kind === 'pine' ? model.canopyRadius * (1 - t) : model.canopyRadius * Math.sin(Math.PI * clamp(t * 1.1, 0, 1));
    const x = (rng() * 2 - 1) * halfW;
    const r = (0.5 + rng() * 0.8) * px * (kind === 'bush' ? 0.3 : 0.9);
    ctx.fillStyle = col(0.75 + rng() * 0.6);
    ctx.beginPath();
    ctx.arc(cx + x * px, ground - y * px, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tx = size + size / 2;
  for (let i = 0; i < 90; i++) {
    const a = rng() * Math.PI * 2;
    const d = Math.sqrt(rng()) * size * 0.42;
    ctx.fillStyle = col(0.7 + rng() * 0.7);
    ctx.beginPath();
    ctx.arc(tx + Math.cos(a) * d, size / 2 + Math.sin(a) * d, size * (0.04 + rng() * 0.05), 0, Math.PI * 2);
    ctx.fill();
  }
  return canvas;
}

function vegetationTexture(kind, model, card, renderer, size, onUpdate, spriteMode) {
  let texture;
  let rt = null;
  if (renderer) {
    rt = renderVegetationImpostor(renderer, model, card, size);
    texture = rt.texture;
  } else {
    texture = new THREE.CanvasTexture(paintVegetationFallback(kind, model, size));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
  }
  const useFile = spriteMode === 'file' || (spriteMode !== 'impostor' && !renderer);
  if (!useFile) return { texture, rt };
  loadGameImage('sprites', kind).then((img) => {
    if (!img) return;
    let base;
    if (rt && renderer) base = readImpostorCanvas(renderer, rt, size);
    else base = paintVegetationFallback(kind, model, size);
    const ctx = base.getContext('2d');
    ctx.clearRect(0, 0, size, size);
    const aspect = img.width / Math.max(1, img.height);
    const fitH = Math.min(size, (size * model.height / card.S) * 1.02);
    const fitW = Math.min(size, fitH * aspect);
    ctx.drawImage(img, (size - fitW) / 2, size - fitH, fitW, fitH);
    const tex = new THREE.CanvasTexture(base);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    onUpdate(tex);
  });
  return { texture, rt };
}

function inAvoid(avoid, x, z) {
  if (!avoid) return false;
  if (typeof avoid === 'function') return !!avoid(x, z);
  if (!Array.isArray(avoid)) avoid = [avoid];
  for (let i = 0; i < avoid.length; i++) {
    const a = avoid[i];
    if (typeof a === 'function') {
      if (a(x, z)) return true;
      continue;
    }
    if (a.points) {
      const half = (a.width || 10) / 2;
      const pts = a.points;
      for (let k = 0; k + 1 < pts.length; k++) {
        const ax = pts[k][0];
        const az = pts[k][1];
        const bx = pts[k + 1][0];
        const bz = pts[k + 1][1];
        const dx = bx - ax;
        const dz = bz - az;
        const l2 = dx * dx + dz * dz || 1;
        const t = clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1);
        const px = ax + dx * t - x;
        const pz = az + dz * t - z;
        if (px * px + pz * pz < half * half) return true;
      }
      if (a.closed && pts.length > 2) {
        const ax = pts[pts.length - 1][0];
        const az = pts[pts.length - 1][1];
        const bx = pts[0][0];
        const bz = pts[0][1];
        const dx = bx - ax;
        const dz = bz - az;
        const l2 = dx * dx + dz * dz || 1;
        const t = clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1);
        const px = ax + dx * t - x;
        const pz = az + dz * t - z;
        if (px * px + pz * pz < half * half) return true;
      }
      continue;
    }
    const r = a.radius || 0;
    const dx = x - a.x;
    const dz = z - a.z;
    if (dx * dx + dz * dz < r * r) return true;
  }
  return false;
}

function areaSampler(area, terrain, rng) {
  const size = terrain && terrain.size ? terrain.size : 1200;
  const a = area || { x: 0, z: 0, w: size * 0.76, d: size * 0.76 };
  if (a.radius != null) {
    return () => {
      const ang = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * a.radius;
      return [a.x + Math.cos(ang) * r, a.z + Math.sin(ang) * r];
    };
  }
  const w = a.w ?? a.width ?? size * 0.76;
  const d = a.d ?? a.depth ?? w;
  return () => [(a.x || 0) + (rng() - 0.5) * w, (a.z || 0) + (rng() - 0.5) * d];
}

function groundHeight(terrain, x, z) {
  return terrain && terrain.heightAt ? terrain.heightAt(x, z) : 0;
}

function groundMin(terrain, x, z, hw, hd, yaw) {
  let m = groundHeight(terrain, x, z);
  const c = Math.cos(yaw || 0);
  const s = Math.sin(yaw || 0);
  for (let i = 0; i < 4; i++) {
    const lx = (i & 1 ? 1 : -1) * hw;
    const lz = (i & 2 ? 1 : -1) * hd;
    const wx = x + lx * c + lz * s;
    const wz = z - lx * s + lz * c;
    m = Math.min(m, groundHeight(terrain, wx, wz));
  }
  return m;
}

function terrainNormalY(terrain, x, z) {
  if (terrain && terrain.normalAt) {
    const n = terrain.normalAt(x, z, { x: 0, y: 1, z: 0 });
    return n.y;
  }
  return 1;
}

function writeMatrix(arr, offset, m) {
  const e = m.elements;
  for (let k = 0; k < 16; k++) arr[offset + k] = e[k];
}

export function scatter(scene, terrain, opts = {}) {
  const kind = opts.kind || 'pine';
  const q = propsQuality(opts.quality);
  const biome = opts.biome || (kind === 'cactus' || kind === 'palm' ? 'arid' : 'temperate');
  const seed = opts.seed ?? 1;
  const rng = mulberry32(seed * 7919 + kind.length * 31);
  const baseCount = opts.count ?? 400;
  const target = Math.max(0, Math.round(baseCount * (opts.exactCount ? 1 : q.vegetation)));
  const sample = areaSampler(opts.area, terrain, rng);
  const maxSlope = opts.maxSlope ?? (kind === 'rock' ? 0.9 : 0.62);
  const minNy = Math.cos(maxSlope);
  const sizeRange = opts.scale || VEG_SIZES[kind]?.scale || [0.8, 1.3];
  const minH = opts.minHeight ?? -Infinity;
  const maxH = opts.maxHeight ?? Infinity;
  const model = vegetationModel(kind, biome);
  const renderer = opts.renderer || propsRendererRef;
  const nearDist = opts.nearDistance ?? q.near;
  const band = opts.fadeBand ?? Math.max(4, nearDist * 0.05);
  const drawMax = Math.min(q.drawDistance, opts.drawDistance ?? Infinity);
  const tint = opts.tint ? new THREE.Color(opts.tint) : null;
  const xs = [];
  const zs = [];
  const ys = [];
  const ss = [];
  const yaws = [];
  const colorsArr = [];
  const colliders = [];
  const colliderMode = opts.colliders ?? (kind === 'bush' ? false : kind === 'rock' ? 'sphere' : 'trunk');
  let tries = 0;
  const maxTries = target * 12 + 50;
  while (xs.length < target && tries < maxTries) {
    tries++;
    const [x, z] = sample();
    if (inAvoid(opts.avoid, x, z)) continue;
    const h = groundHeight(terrain, x, z);
    if (h < minH || h > maxH) continue;
    if (terrainNormalY(terrain, x, z) < minNy) continue;
    if (opts.cluster) {
      const cl = propsNoise3(x * 0.012, 0.5, z * 0.012, seed);
      if (cl < opts.cluster * rng()) continue;
    }
    const s = lerp(sizeRange[0], sizeRange[1], Math.pow(rng(), 1.3));
    const r = model.trunkRadius * s;
    const sink = kind === 'rock' ? 0.28 * s : 0.15 + r;
    const y = groundMin(terrain, x, z, r, r, 0) - sink;
    xs.push(x);
    zs.push(z);
    ys.push(y);
    ss.push(s);
    yaws.push(rng() * Math.PI * 2);
    const v = 0.82 + rng() * 0.3;
    const hue = (rng() - 0.5) * 0.12;
    const c = new THREE.Color(v * (1 + hue), v, v * (1 - hue * 0.6));
    if (tint) c.multiply(tint);
    colorsArr.push(c.r, c.g, c.b);
    if (colliderMode === 'trunk') {
      colliders.push({ type: 'cyl', x, z, radius: Math.max(0.2, model.trunkRadius * s), y0: y, y1: y + model.height * s });
    } else if (colliderMode === 'canopy') {
      colliders.push({ type: 'cyl', x, z, radius: Math.max(0.3, model.canopyRadius * s * 0.7), y0: y, y1: y + model.height * s });
    } else if (colliderMode === 'sphere') {
      colliders.push({ type: 'sphere', center: { x, y: y + 0.35 * s, z }, radius: 0.85 * s });
    }
  }
  const n = xs.length;
  const group = new THREE.Group();
  group.name = 'kw-scatter-' + kind;
  const nearMatrices = new Float32Array(n * 16);
  const farMatrices = new Float32Array(n * 16);
  const m = new THREE.Matrix4();
  for (let i = 0; i < n; i++) {
    const s = ss[i];
    const tiltX = kind === 'rock' ? (rng() - 0.5) * 0.6 : (rng() - 0.5) * 0.06;
    const tiltZ = kind === 'rock' ? (rng() - 0.5) * 0.6 : (rng() - 0.5) * 0.06;
    const widthVar = kind === 'rock' ? 1 : 0.8 + rng() * 0.38;
    const sy = kind === 'rock' ? s * (0.7 + rng() * 0.5) : s * (0.9 + rng() * 0.3);
    const sx = kind === 'rock' ? s * (0.8 + rng() * 0.5) : s * widthVar;
    const sz = kind === 'rock' ? s : s * widthVar;
    m.compose(
      new THREE.Vector3(xs[i], ys[i], zs[i]),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(tiltX, yaws[i], tiltZ, 'YXZ')),
      new THREE.Vector3(sx, sy, sz),
    );
    writeMatrix(nearMatrices, i * 16, m);
    m.compose(new THREE.Vector3(xs[i], ys[i], zs[i]), new THREE.Quaternion(), new THREE.Vector3(sx, sy, sx));
    writeMatrix(farMatrices, i * 16, m);
  }
  const instColors = new Float32Array(colorsArr);
  const castShadow = q.shadows && opts.castShadow !== false;
  const nearMat = nearVegetationMaterial(model, nearDist - band, nearDist, castShadow);
  const nearMesh = new THREE.InstancedMesh(model.geometry, nearMat, Math.max(1, n));
  nearMesh.count = 0;
  nearMesh.frustumCulled = false;
  nearMesh.castShadow = castShadow;
  nearMesh.receiveShadow = q.shadows;
  nearMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  nearMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, n) * 3), 3);
  nearMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  group.add(nearMesh);
  let farMesh = null;
  let impostor = null;
  let farMat = null;
  if (kind === 'rock') {
    farMat = nearVegetationMaterial({ ...model, sway: 0 }, 1e9, 1e9 + 1, false);
    farMesh = new THREE.InstancedMesh(model.farGeometry, farMat, Math.max(1, n));
    farMesh.receiveShadow = q.shadows;
  } else {
    const card = cardGeometry(model);
    const size = q.impostor;
    const brightness = kind === 'palm' ? 0.95 : 0.92;
    impostor = vegetationTexture(kind, model, card, renderer, size, (tex) => {
      if (farMat) {
        const old = farMat.map;
        farMat.map = tex;
        farMat.needsUpdate = true;
        if (old && !old.isRenderTargetTexture) old.dispose();
      }
    }, opts.sprites);
    farMat = farVegetationMaterial(impostor.texture, size, nearDist - band, nearDist, brightness);
    farMesh = new THREE.InstancedMesh(card.geometry, farMat, Math.max(1, n));
    farMesh.receiveShadow = q.shadows;
  }
  farMesh.count = 0;
  farMesh.frustumCulled = false;
  farMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  farMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, n) * 3), 3);
  farMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  group.add(farMesh);
  scene.add(group);
  let lastX = Infinity;
  let lastZ = Infinity;
  const nearMax2 = (nearDist + 8) * (nearDist + 8);
  const farMin = kind === 'rock' ? nearDist : nearDist - band - 8;
  const farMin2 = Math.max(0, farMin) * Math.max(0, farMin);
  const drawMax2 = drawMax * drawMax;
  function bucket(cx, cz) {
    const na = nearMesh.instanceMatrix.array;
    const nc = nearMesh.instanceColor.array;
    const fa = farMesh.instanceMatrix.array;
    const fc = farMesh.instanceColor.array;
    const farSrc = kind === 'rock' ? nearMatrices : farMatrices;
    let ni = 0;
    let fi = 0;
    for (let i = 0; i < n; i++) {
      const dx = xs[i] - cx;
      const dz = zs[i] - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < nearMax2) {
        const o = i * 16;
        const t = ni * 16;
        for (let k = 0; k < 16; k++) na[t + k] = nearMatrices[o + k];
        nc[ni * 3] = instColors[i * 3];
        nc[ni * 3 + 1] = instColors[i * 3 + 1];
        nc[ni * 3 + 2] = instColors[i * 3 + 2];
        ni++;
      }
      if (d2 > farMin2 && d2 < drawMax2) {
        const o = i * 16;
        const t = fi * 16;
        for (let k = 0; k < 16; k++) fa[t + k] = farSrc[o + k];
        fc[fi * 3] = instColors[i * 3];
        fc[fi * 3 + 1] = instColors[i * 3 + 1];
        fc[fi * 3 + 2] = instColors[i * 3 + 2];
        fi++;
      }
    }
    nearMesh.count = ni;
    farMesh.count = fi;
    nearMesh.instanceMatrix.clearUpdateRanges();
    nearMesh.instanceMatrix.addUpdateRange(0, Math.max(16, ni * 16));
    nearMesh.instanceMatrix.needsUpdate = true;
    nearMesh.instanceColor.clearUpdateRanges();
    nearMesh.instanceColor.addUpdateRange(0, Math.max(3, ni * 3));
    nearMesh.instanceColor.needsUpdate = true;
    farMesh.instanceMatrix.clearUpdateRanges();
    farMesh.instanceMatrix.addUpdateRange(0, Math.max(16, fi * 16));
    farMesh.instanceMatrix.needsUpdate = true;
    farMesh.instanceColor.clearUpdateRanges();
    farMesh.instanceColor.addUpdateRange(0, Math.max(3, fi * 3));
    farMesh.instanceColor.needsUpdate = true;
  }
  bucket(0, 0);
  lastX = 0;
  lastZ = 0;
  function update(a, b) {
    const { camera } = propsArgs(a, b);
    tickPropsTime();
    if (!camera) return;
    const cx = camera.position.x;
    const cz = camera.position.z;
    const dx = cx - lastX;
    const dz = cz - lastZ;
    if (dx * dx + dz * dz < 16) return;
    lastX = cx;
    lastZ = cz;
    bucket(cx, cz);
  }
  function dispose() {
    scene.remove(group);
    nearMesh.dispose();
    farMesh.dispose();
    nearMat.dispose();
    if (farMat) {
      if (farMat.map && !farMat.map.isRenderTargetTexture) farMat.map.dispose();
      farMat.dispose();
    }
    if (impostor && impostor.rt) impostor.rt.dispose();
    if (kind !== 'rock') farMesh.geometry.dispose();
  }
  return {
    group,
    colliders,
    count: n,
    kind,
    update,
    dispose,
    get nearCount() { return nearMesh.count; },
    get farCount() { return farMesh.count; },
  };
}

function polylineSamples(points, spacing, closed) {
  const out = [];
  if (!points || points.length < 2) return out;
  const pts = closed ? points.concat([points[0]]) : points;
  let carry = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const ax = pts[i][0];
    const az = pts[i][1];
    const bx = pts[i + 1][0];
    const bz = pts[i + 1][1];
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    const ux = dx / len;
    const uz = dz / len;
    let s = carry;
    while (s < len) {
      out.push({ x: ax + ux * s, z: az + uz * s, ux, uz });
      s += spacing;
    }
    carry = s - len;
  }
  return out;
}

function propsStandard(params) {
  return new THREE.MeshStandardMaterial(params);
}

function facadeWithVertexColors(style, opts) {
  const mat = facadeMaterial(style, opts);
  mat.vertexColors = true;
  mat.needsUpdate = true;
  return mat;
}

export function buildings(scene, opts = {}) {
  const q = propsQuality(opts.quality);
  const terrain = opts.terrain || null;
  const seed = opts.seed ?? 7;
  const rng = mulberry32(seed * 131 + 7);
  const styles = opts.styles || ['office', 'apartment'];
  const heights = opts.heights || [12, 60];
  const night = !!opts.night;
  const lots = [];
  if (Array.isArray(opts.lots)) {
    for (const l of opts.lots) lots.push({ ...l });
  } else {
    const count = opts.count ?? 24;
    const sample = areaSampler(opts.area, terrain, rng);
    let tries = 0;
    while (lots.length < count && tries < count * 40) {
      tries++;
      const [x, z] = sample();
      const w = 14 + rng() * 22;
      const d = 14 + rng() * 22;
      const r = Math.hypot(w, d) / 2;
      if (inAvoid(opts.avoid, x, z)) continue;
      let ok = true;
      for (const o of lots) {
        if (Math.hypot(o.x - x, o.z - z) < r + Math.hypot(o.w, o.d) / 2 + 4) { ok = false; break; }
      }
      if (!ok) continue;
      lots.push({ x, z, w, d, h: lerp(heights[0], heights[1], Math.pow(rng(), 1.6)), yaw: opts.yaw ?? 0, style: styles[Math.floor(rng() * styles.length)] });
    }
  }
  const group = new THREE.Group();
  group.name = 'kw-buildings';
  const colliders = [];
  const facadeBuilders = {};
  const facadeMats = {};
  const roof = createGeoBuilder();
  const detail = createGeoBuilder();
  const beacons = createGeoBuilder();
  const roofGravel = hex('#5d5a55');
  const coping = hex('#9a958c');
  const acColor = hex('#b9bcbf');
  const tankColor = hex('#7b6f63');
  const darkMetal = hex('#3b3e42');
  const box = new THREE.BoxGeometry(1, 1, 1);
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 12);
  const thin = new THREE.CylinderGeometry(1, 1, 1, 6);
  const beaconGeo = new THREE.IcosahedronGeometry(1, 1);
  const pA = new THREE.Vector3();
  const pB = new THREE.Vector3();
  const pC = new THREE.Vector3();
  const pD = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  for (let li = 0; li < lots.length; li++) {
    const L = lots[li];
    const style = L.style || styles[li % styles.length];
    if (!facadeBuilders[style]) {
      facadeBuilders[style] = createGeoBuilder();
      if (style === 'warehouse') {
        const wm = gameMaterial('metal-panel', { unique: true, roughness: 0.5, metalness: 0.55 });
        wm.vertexColors = true;
        wm.userData.tileMeters = { x: 4, y: 4 };
        facadeMats[style] = wm;
      } else {
        facadeMats[style] = facadeWithVertexColors(style, { night, litFraction: opts.litFraction, seed: seed + style.length });
      }
    }
    const fb = facadeBuilders[style];
    const tile = (facadeMats[style].userData && facadeMats[style].userData.tileMeters) || { x: 12, y: 12.8 };
    const yaw = L.yaw || 0;
    const w = L.w;
    const d = L.d;
    const h = L.h;
    const ground = L.y ?? groundMin(terrain, L.x, L.z, w / 2, d / 2, yaw);
    const base = ground - 3;
    const top = ground + h;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const corner = (lx, lz, out) => out.set(L.x + lx * c + lz * s, 0, L.z - lx * s + lz * c);
    const corners = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
    const tintV = 0.86 + rng() * 0.22;
    const tint = new THREE.Color(tintV * (0.97 + rng() * 0.06), tintV, tintV * (0.95 + rng() * 0.08));
    const band = tint.clone().multiplyScalar(0.62);
    const uOff = Math.floor(rng() * 4) * 0.25;
    const vOff = 0;
    let along = 0;
    for (let k = 0; k < 4; k++) {
      const ci = corners[k];
      const cj = corners[(k + 1) % 4];
      const len = Math.hypot(cj[0] - ci[0], cj[1] - ci[1]);
      corner(cj[0], cj[1], pA);
      corner(ci[0], ci[1], pB);
      const ex = pB.x - pA.x;
      const ez = pB.z - pA.z;
      nrm.set(ez, 0, -ex).normalize();
      const mid = new THREE.Vector3((pA.x + pB.x) / 2, 0, (pA.z + pB.z) / 2);
      const outward = new THREE.Vector3(mid.x - L.x, 0, mid.z - L.z);
      if (outward.dot(nrm) < 0) nrm.negate();
      const u0 = along / tile.x + uOff;
      const u1 = (along + len) / tile.x + uOff;
      const bandTop = ground + 4.2;
      const vb = (base - ground) / tile.y + vOff;
      const vbt = (bandTop - ground) / tile.y + vOff;
      const vt = (top - ground) / tile.y + vOff;
      fb.quad(
        new THREE.Vector3(pA.x, base, pA.z), new THREE.Vector3(pB.x, base, pB.z), new THREE.Vector3(pB.x, bandTop, pB.z), new THREE.Vector3(pA.x, bandTop, pA.z),
        nrm, [u0, vb], [u1, vb], [u1, vbt], [u0, vbt], band,
      );
      fb.quad(
        new THREE.Vector3(pA.x, bandTop, pA.z), new THREE.Vector3(pB.x, bandTop, pB.z), new THREE.Vector3(pB.x, top, pB.z), new THREE.Vector3(pA.x, top, pA.z),
        nrm, [u0, vbt], [u1, vbt], [u1, vt], [u0, vt], tint,
      );
      along += len;
    }
    roof.add(box, propsMatrix(L.x, top - 0.75, L.z, yaw, w - 0.1, 0.3, d - 0.1), roofGravel);
    const pt = 0.32;
    const ph = 1.15;
    const ins = 0.02;
    roof.add(box, propsMatrix(L.x + (-(w / 2) + pt / 2 + ins) * c, top - 0.6 + ph / 2, L.z - (-(w / 2) + pt / 2 + ins) * s, yaw, pt, ph, d - 2 * ins), coping);
    roof.add(box, propsMatrix(L.x + ((w / 2) - pt / 2 - ins) * c, top - 0.6 + ph / 2, L.z - ((w / 2) - pt / 2 - ins) * s, yaw, pt, ph, d - 2 * ins), coping);
    roof.add(box, propsMatrix(L.x + (-(d / 2) + pt / 2 + ins) * s, top - 0.6 + ph / 2, L.z + (-(d / 2) + pt / 2 + ins) * c, yaw, w - 2 * ins, ph, pt), coping);
    roof.add(box, propsMatrix(L.x + ((d / 2) - pt / 2 - ins) * s, top - 0.6 + ph / 2, L.z + ((d / 2) - pt / 2 - ins) * c, yaw, w - 2 * ins, ph, pt), coping);
    const roofY = top - 0.6;
    const local = (lx, lz) => [L.x + lx * c + lz * s, L.z - lx * s + lz * c];
    const acs = 1 + Math.floor(rng() * 4);
    for (let i = 0; i < acs; i++) {
      const lx = (rng() - 0.5) * (w - 6);
      const lz = (rng() - 0.5) * (d - 6);
      const [wx, wz] = local(lx, lz);
      detail.add(box, propsMatrix(wx, roofY + 0.65, wz, yaw, 2.2, 1.3, 1.6), acColor);
      detail.add(cyl, propsMatrix(wx, roofY + 1.32, wz, yaw, 0.55, 0.06, 0.55), darkMetal);
    }
    if (rng() < 0.7) {
      const [wx, wz] = local((rng() - 0.5) * (w - 8), (rng() - 0.5) * (d - 8));
      detail.add(box, propsMatrix(wx, roofY + 1.4, wz, yaw, 3.2, 2.8, 3.4), coping);
    }
    if (style === 'apartment' || rng() < 0.35) {
      const [wx, wz] = local((rng() - 0.5) * (w - 7), (rng() - 0.5) * (d - 7));
      detail.add(cyl, propsMatrix(wx, roofY + 2.9, wz, 0, 1.5, 2.6, 1.5), tankColor);
      detail.add(cyl, propsMatrix(wx, roofY + 4.25, wz, 0, 1.55, 0.12, 1.55), darkMetal);
      for (let k = 0; k < 4; k++) {
        const a = k * Math.PI / 2 + Math.PI / 4;
        detail.add(box, propsMatrix(wx + Math.cos(a) * 1.1, roofY + 0.8, wz + Math.sin(a) * 1.1, 0, 0.14, 1.6, 0.14), darkMetal);
      }
    }
    let antennaTop = 0;
    if (h > 34 || rng() < 0.25) {
      const ah = 4 + rng() * (h > 40 ? 10 : 4);
      const [wx, wz] = local((rng() - 0.5) * (w - 5), (rng() - 0.5) * (d - 5));
      detail.add(thin, propsMatrix(wx, roofY + ah / 2, wz, 0, 0.09, ah, 0.09), darkMetal);
      detail.add(thin, propsMatrix(wx, roofY + ah * 0.7, wz, 0, 0.6, 0.05, 0.6), darkMetal);
      antennaTop = ah;
      if (h > 30) beacons.add(beaconGeo, propsMatrix(wx, roofY + ah + 0.15, wz, 0, 0.22, 0.22, 0.22), hex('#ffffff'));
    }
    if (h > 30) {
      for (const [cx, cz] of [[-1, -1], [1, 1]]) {
        const [wx, wz] = local(cx * (w / 2 - 0.4), cz * (d / 2 - 0.4));
        beacons.add(beaconGeo, propsMatrix(wx, top + 0.7, wz, 0, 0.18, 0.18, 0.18), hex('#ffffff'));
      }
    }
    colliders.push({ type: 'box', center: { x: L.x, y: (base + top + 0.6) / 2, z: L.z }, half: { x: w / 2, y: (top + 0.6 - base) / 2, z: d / 2 }, yaw });
  }
  const meshes = [];
  for (const style of Object.keys(facadeBuilders)) {
    const geo = facadeBuilders[style].build();
    const mesh = new THREE.Mesh(geo, facadeMats[style]);
    mesh.castShadow = q.shadows;
    mesh.receiveShadow = q.shadows;
    mesh.name = 'kw-facade-' + style;
    group.add(mesh);
    meshes.push(mesh);
  }
  const roofMat = gameMaterial('concrete', { unique: true, color: 0xffffff });
  roofMat.vertexColors = true;
  const roofMesh = new THREE.Mesh(roof.build(), roofMat);
  roofMesh.castShadow = q.shadows;
  roofMesh.receiveShadow = q.shadows;
  group.add(roofMesh);
  meshes.push(roofMesh);
  let detailMesh = null;
  if (!detail.empty) {
    const detailMat = propsStandard({ vertexColors: true, roughness: 0.62, metalness: 0.35 });
    detailMesh = new THREE.Mesh(detail.build(), detailMat);
    detailMesh.castShadow = q.shadows;
    detailMesh.receiveShadow = q.shadows;
    group.add(detailMesh);
    meshes.push(detailMesh);
  }
  let beaconMesh = null;
  if (!beacons.empty && night) {
    const beaconMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 0.35, 0.2), toneMapped: true });
    beaconMesh = new THREE.Mesh(beacons.build(), beaconMat);
    group.add(beaconMesh);
    meshes.push(beaconMesh);
  }
  scene.add(group);
  box.dispose();
  cyl.dispose();
  thin.dispose();
  beaconGeo.dispose();
  let blink = 0;
  function update(a, b) {
    const { dt } = propsArgs(a, b);
    if (!beaconMesh) return;
    blink += dt || 0.016;
    beaconMesh.visible = (blink % 1.6) < 1.0;
  }
  function dispose() {
    scene.remove(group);
    for (const m of meshes) {
      m.geometry.dispose();
      if (m.material && m.material !== roofMat && !Object.values(facadeMats).includes(m.material)) m.material.dispose();
    }
    roofMat.dispose();
    for (const k of Object.keys(facadeMats)) facadeMats[k].dispose();
  }
  return { group, colliders, lots, update, dispose };
}

const CONTAINER_PALETTE = ['#8e2f22', '#1f4f86', '#2f6a3a', '#c9631e', '#d9d6cc', '#7d8186', '#1f7473', '#5a1f24', '#c9a33a', '#a83a24', '#2c3d5c', '#3d5a40'];

function containerGeometry(length) {
  const H = 2.59;
  const W = 2.44;
  const geo = new THREE.BoxGeometry(length, H, W);
  const uv = geo.attributes.uv;
  const idx = geo.index.array;
  const faceOf = (vi) => Math.floor(vi / 4);
  const ribTile = 2.44;
  for (let i = 0; i < uv.count; i++) {
    const f = faceOf(i);
    const u = uv.getX(i);
    const v = uv.getY(i);
    if (f === 4 || f === 5) uv.setXY(i, u * length / ribTile, v);
    else if (f === 2 || f === 3) uv.setXY(i, u * length / ribTile, v * 0.94);
  }
  const doorIdx = [];
  const bodyIdx = [];
  for (let t = 0; t < idx.length; t += 3) {
    const f = faceOf(idx[t]);
    const target = f === 0 || f === 1 ? doorIdx : bodyIdx;
    target.push(idx[t], idx[t + 1], idx[t + 2]);
  }
  geo.setIndex(bodyIdx.concat(doorIdx));
  geo.clearGroups();
  geo.addGroup(0, bodyIdx.length, 0);
  geo.addGroup(bodyIdx.length, doorIdx.length, 1);
  geo.translate(0, H / 2, 0);
  return geo;
}

export function containers(scene, opts = {}) {
  const q = propsQuality(opts.quality);
  const terrain = opts.terrain || null;
  const seed = opts.seed ?? 3;
  const rng = mulberry32(seed * 977 + 13);
  const stacks = [];
  if (Array.isArray(opts.stacks)) {
    for (const s of opts.stacks) stacks.push({ ...s });
  } else {
    const count = opts.count ?? 12;
    const sample = areaSampler(opts.area, terrain, rng);
    let tries = 0;
    while (stacks.length < count && tries < count * 40) {
      tries++;
      const [x, z] = sample();
      if (inAvoid(opts.avoid, x, z)) continue;
      const st = { x, z, yaw: opts.yaw ?? (Math.floor(rng() * 2) * Math.PI / 2 + (rng() - 0.5) * 0.04), rows: 1 + Math.floor(rng() * 4), cols: 1 + Math.floor(rng() * 2), tiers: 1 + Math.floor(rng() * 4), ragged: true };
      const r = Math.hypot(st.cols * 12.6, st.rows * 2.8) / 2;
      let ok = true;
      for (const o of stacks) {
        if (Math.hypot(o.x - x, o.z - z) < r + Math.hypot(o.cols * 12.6, o.rows * 2.8) / 2 + 3) { ok = false; break; }
      }
      if (ok) stacks.push(st);
    }
  }
  const H = 2.59;
  const W = 2.44;
  const items40 = [];
  const items20 = [];
  const colliders = [];
  for (const st of stacks) {
    const rows = st.rows ?? 1;
    const cols = st.cols ?? 1;
    const tiers = st.tiers ?? 1;
    const len = st.length ?? 12.19;
    const gap = st.gap ?? 0.3;
    const yaw = st.yaw ?? 0;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const totalL = cols * len + (cols - 1) * gap;
    const totalW = rows * W + (rows - 1) * gap;
    const ground = st.y ?? groundMin(terrain, st.x, st.z, totalL / 2, totalW / 2, yaw);
    let maxT = 0;
    for (let r = 0; r < rows; r++) {
      for (let cI = 0; cI < cols; cI++) {
        let height = tiers;
        if (st.ragged !== false && tiers > 1 && rng() < 0.4) height = Math.max(1, tiers - 1 - Math.floor(rng() * 2));
        maxT = Math.max(maxT, height);
        const lx = -totalL / 2 + len / 2 + cI * (len + gap);
        const lz = -totalW / 2 + W / 2 + r * (W + gap);
        for (let t = 0; t < height; t++) {
          const short = st.mix20 !== false && rng() < (st.mix20 ?? 0.18);
          const jx = (rng() - 0.5) * 0.12;
          const jz = (rng() - 0.5) * 0.1;
          const jyaw = (rng() - 0.5) * 0.025;
          const wx = st.x + (lx + jx) * c + (lz + jz) * s;
          const wz = st.z - (lx + jx) * s + (lz + jz) * c;
          const color = new THREE.Color(CONTAINER_PALETTE[Math.floor(rng() * CONTAINER_PALETTE.length)]);
          const fadeV = 0.78 + rng() * 0.3;
          color.multiplyScalar(fadeV);
          if (short) {
            const off = (len - 6.06) / 2 * (rng() < 0.5 ? -1 : 1);
            items20.push({ x: wx + off * c, y: ground + t * H, z: wz - off * s, yaw: yaw + jyaw, color });
          } else {
            items40.push({ x: wx, y: ground + t * H, z: wz, yaw: yaw + jyaw, color });
          }
        }
      }
    }
    colliders.push({ type: 'box', center: { x: st.x, y: ground + (maxT * H) / 2, z: st.z }, half: { x: totalL / 2, y: (maxT * H) / 2, z: totalW / 2 }, yaw });
  }
  const group = new THREE.Group();
  group.name = 'kw-containers';
  const bodyMat = gameMaterial('container', { unique: true });
  const hasDoors = typeof kwMaterials.gameMaterialNames === 'function' && kwMaterials.gameMaterialNames().includes('container-doors');
  const doorMat = hasDoors ? gameMaterial('container-doors', { unique: true }) : new THREE.MeshStandardMaterial({ map: loadTexture('container-doors', { procedural: 'container' }), roughness: 0.6, metalness: 0.3 });
  const meshes = [];
  const build = (items, length) => {
    if (!items.length) return;
    const geo = containerGeometry(length);
    const mesh = new THREE.InstancedMesh(geo, [bodyMat, doorMat], items.length);
    const m = new THREE.Matrix4();
    const qq = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    items.forEach((it, i) => {
      qq.setFromAxisAngle(up, it.yaw);
      p.set(it.x, it.y, it.z);
      m.compose(p, qq, one);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, it.color);
    });
    mesh.castShadow = q.shadows;
    mesh.receiveShadow = q.shadows;
    mesh.computeBoundingSphere();
    group.add(mesh);
    meshes.push(mesh);
  };
  build(items40, 12.19);
  build(items20, 6.06);
  scene.add(group);
  function dispose() {
    scene.remove(group);
    for (const m of meshes) {
      m.geometry.dispose();
      m.dispose();
    }
    bodyMat.dispose();
    doorMat.dispose();
  }
  return { group, colliders, count: items40.length + items20.length, dispose };
}

function crateTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const rng = mulberry32(77);
  ctx.fillStyle = '#9a7448';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 6; i++) {
    const y = i * (size / 6);
    const g = ctx.createLinearGradient(0, y, 0, y + size / 6);
    const base = 130 + rng() * 40;
    g.addColorStop(0, 'rgb(' + (base + 20) + ',' + (base - 10) + ',' + (base - 60) + ')');
    g.addColorStop(1, 'rgb(' + (base - 10) + ',' + (base - 35) + ',' + (base - 80) + ')');
    ctx.fillStyle = g;
    ctx.fillRect(0, y + 1, size, size / 6 - 2);
    ctx.strokeStyle = 'rgba(60,40,20,0.25)';
    for (let k = 0; k < 14; k++) {
      ctx.beginPath();
      const yy = y + rng() * (size / 6);
      ctx.moveTo(0, yy);
      ctx.bezierCurveTo(size * 0.3, yy + (rng() - 0.5) * 6, size * 0.7, yy + (rng() - 0.5) * 6, size, yy);
      ctx.stroke();
    }
  }
  ctx.fillStyle = '#6e4f2c';
  ctx.fillRect(0, 0, size, 22);
  ctx.fillRect(0, size - 22, size, 22);
  ctx.fillRect(0, 0, 22, size);
  ctx.fillRect(size - 22, 0, 22, size);
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.rotate(Math.PI / 4);
  ctx.fillRect(-size * 0.68, -11, size * 1.36, 22);
  ctx.restore();
  ctx.strokeStyle = 'rgba(30,20,10,0.55)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, size - 2, size - 2);
  ctx.fillStyle = 'rgba(25,25,25,0.55)';
  ctx.font = 'bold 26px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('FRAGILE', size / 2, size * 0.36);
  ctx.fillText('KW-' + Math.floor(100 + rng() * 899), size / 2, size * 0.74);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function itemsFromOpts(opts, terrain, rng, defaults) {
  const out = [];
  if (Array.isArray(opts.items)) {
    for (const it of opts.items) out.push({ ...defaults, ...it });
  } else if (opts.line && opts.line.points) {
    const samples = polylineSamples(opts.line.points, opts.line.spacing ?? defaults.spacing ?? 3, opts.line.closed);
    for (const smp of samples) out.push({ ...defaults, x: smp.x, z: smp.z, yaw: Math.atan2(smp.ux, smp.uz) });
  } else if (opts.area || opts.count) {
    const sample = areaSampler(opts.area, terrain, rng);
    const count = opts.count ?? 20;
    for (let i = 0; i < count; i++) {
      const [x, z] = sample();
      if (inAvoid(opts.avoid, x, z)) continue;
      out.push({ ...defaults, x, z, yaw: rng() * Math.PI * 2 });
    }
  }
  return out;
}

let crateTextureCache = null;

export function crates(scene, opts = {}) {
  const q = propsQuality(opts.quality);
  const terrain = opts.terrain || null;
  const rng = mulberry32((opts.seed ?? 5) * 31 + 1);
  const items = itemsFromOpts(opts, terrain, rng, { size: 1.2, stack: 1 });
  const list = [];
  for (const it of items) {
    const size = it.size ?? 1.2;
    const g = it.y ?? groundMin(terrain, it.x, it.z, size / 2, size / 2, it.yaw || 0);
    const stack = Math.max(1, it.stack ?? 1);
    for (let k = 0; k < stack; k++) {
      list.push({ x: it.x + (rng() - 0.5) * 0.08 * k, y: g + size * k, z: it.z + (rng() - 0.5) * 0.08 * k, yaw: (it.yaw || 0) + (rng() - 0.5) * 0.15 * k, size, tone: 0.8 + rng() * 0.35 });
    }
  }
  if (!crateTextureCache) crateTextureCache = crateTexture();
  const mat = new THREE.MeshStandardMaterial({ map: crateTextureCache, roughness: 0.85, metalness: 0 });
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
  mesh.count = list.length;
  const m = new THREE.Matrix4();
  const colliders = [];
  list.forEach((c, i) => {
    m.compose(new THREE.Vector3(c.x, c.y, c.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), c.yaw), new THREE.Vector3(c.size, c.size, c.size));
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, new THREE.Color(c.tone, c.tone, c.tone));
    if (opts.colliders !== false) colliders.push({ type: 'box', center: { x: c.x, y: c.y + c.size / 2, z: c.z }, half: { x: c.size / 2, y: c.size / 2, z: c.size / 2 }, yaw: c.yaw });
  });
  mesh.castShadow = q.shadows;
  mesh.receiveShadow = q.shadows;
  mesh.computeBoundingSphere();
  const group = new THREE.Group();
  group.name = 'kw-crates';
  group.add(mesh);
  scene.add(group);
  return {
    group, colliders, count: list.length,
    dispose() { scene.remove(group); geo.dispose(); mat.dispose(); mesh.dispose(); },
  };
}

function coneGeometry() {
  const b = createGeoBuilder();
  const orange = hex('#ff4f12');
  const white = hex('#f4f4f0');
  const baseCol = hex('#1f1f1f');
  const pts = [];
  pts.push(new THREE.Vector2(0.16, 0.03));
  pts.push(new THREE.Vector2(0.155, 0.04));
  pts.push(new THREE.Vector2(0.035, 0.72));
  pts.push(new THREE.Vector2(0.0, 0.725));
  const lathe = new THREE.LatheGeometry(pts, 14);
  lathe.computeVertexNormals();
  b.add(lathe, null, (v) => {
    const y = v.y;
    if ((y > 0.42 && y < 0.52) || (y > 0.24 && y < 0.31)) return white;
    return orange;
  });
  const plate = new THREE.BoxGeometry(0.38, 0.03, 0.38);
  plate.translate(0, 0.015, 0);
  b.add(plate, null, baseCol);
  return b.build();
}

export function cones(scene, opts = {}) {
  const q = propsQuality(opts.quality);
  const terrain = opts.terrain || null;
  const rng = mulberry32((opts.seed ?? 9) * 17 + 3);
  const items = itemsFromOpts(opts, terrain, rng, { spacing: 4, size: 1 });
  const geo = coneGeometry();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0 });
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length));
  mesh.count = items.length;
  const m = new THREE.Matrix4();
  const colliders = [];
  items.forEach((it, i) => {
    const y = it.y ?? groundHeight(terrain, it.x, it.z);
    const s = it.size ?? 1;
    m.compose(new THREE.Vector3(it.x, y, it.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * 6.28), new THREE.Vector3(s, s, s));
    mesh.setMatrixAt(i, m);
    if (opts.colliders) colliders.push({ type: 'cyl', x: it.x, z: it.z, radius: 0.18 * s, y0: y, y1: y + 0.72 * s });
  });
  mesh.castShadow = q.shadows;
  mesh.receiveShadow = q.shadows;
  mesh.computeBoundingSphere();
  const group = new THREE.Group();
  group.name = 'kw-cones';
  group.add(mesh);
  scene.add(group);
  return { group, colliders, count: items.length, dispose() { scene.remove(group); geo.dispose(); mat.dispose(); mesh.dispose(); } };
}

function jerseyGeometry(length) {
  const shape = new THREE.Shape();
  shape.moveTo(-0.305, 0);
  shape.lineTo(0.305, 0);
  shape.lineTo(0.305, 0.075);
  shape.lineTo(0.25, 0.33);
  shape.lineTo(0.09, 0.81);
  shape.lineTo(-0.09, 0.81);
  shape.lineTo(-0.25, 0.33);
  shape.lineTo(-0.305, 0.075);
  shape.lineTo(-0.305, 0);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: length, bevelEnabled: false, steps: 1 });
  geo.translate(0, 0, -length / 2);
  geo.computeVertexNormals();
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.5, uv.getY(i) * 0.5);
  return geo;
}

function guardrailBeamGeometry(length) {
  const shape = new THREE.Shape();
  const pts = [[0, -0.16], [0.05, -0.12], [0.05, -0.05], [0.0, -0.02], [0.0, 0.02], [0.05, 0.05], [0.05, 0.12], [0, 0.16], [-0.01, 0.16], [0.035, 0.12], [0.035, 0.05], [-0.01, 0.02], [-0.01, -0.02], [0.035, -0.05], [0.035, -0.12], [-0.01, -0.16]];
  shape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: length, bevelEnabled: false });
  geo.translate(0, 0, -length / 2);
  geo.computeVertexNormals();
  return geo;
}

export function barriers(scene, opts = {}) {
  const q = propsQuality(opts.quality);
  const terrain = opts.terrain || null;
  const kind = opts.kind || 'jersey';
  const rng = mulberry32((opts.seed ?? 11) * 13 + 5);
  const spacing = (opts.line && opts.line.spacing) || (kind === 'jersey' ? 2.2 : 4);
  const group = new THREE.Group();
  group.name = 'kw-barriers-' + kind;
  const colliders = [];
  const segs = [];
  if (opts.line && opts.line.points) {
    const samples = polylineSamples(opts.line.points, spacing, opts.line.closed);
    for (const smp of samples) segs.push({ x: smp.x + smp.ux * spacing / 2, z: smp.z + smp.uz * spacing / 2, ux: smp.ux, uz: smp.uz });
  } else if (Array.isArray(opts.items)) {
    for (const it of opts.items) segs.push({ x: it.x, z: it.z, ux: Math.sin(it.yaw || 0), uz: Math.cos(it.yaw || 0) });
  }
  const m = new THREE.Matrix4();
  const qq = new THREE.Quaternion();
  const eul = new THREE.Euler();
  const meshes = [];
  const materials = [];
  const geometries = [];
  if (kind === 'guardrail') {
    const beamGeo = guardrailBeamGeometry(spacing + 0.04);
    const postGeo = new THREE.BoxGeometry(0.1, 1.0, 0.15);
    postGeo.translate(0, 0.5, 0);
    const metal = new THREE.MeshStandardMaterial({ color: 0xb4b8bc, roughness: 0.42, metalness: 0.85 });
    const beams = new THREE.InstancedMesh(beamGeo, metal, Math.max(1, segs.length));
    const posts = new THREE.InstancedMesh(postGeo, metal, Math.max(1, segs.length));
    beams.count = segs.length;
    posts.count = segs.length;
    segs.forEach((sg, i) => {
      const h0 = groundHeight(terrain, sg.x - sg.ux * spacing / 2, sg.z - sg.uz * spacing / 2);
      const h1 = groundHeight(terrain, sg.x + sg.ux * spacing / 2, sg.z + sg.uz * spacing / 2);
      const yaw = Math.atan2(sg.ux, sg.uz);
      const pitch = -Math.atan2(h1 - h0, spacing);
      eul.set(pitch, yaw, 0, 'YXZ');
      qq.setFromEuler(eul);
      m.compose(new THREE.Vector3(sg.x, (h0 + h1) / 2 + 0.62, sg.z), qq, new THREE.Vector3(1, 1, 1));
      beams.setMatrixAt(i, m);
      const px = sg.x - sg.ux * spacing / 2;
      const pz = sg.z - sg.uz * spacing / 2;
      m.compose(new THREE.Vector3(px - sg.uz * 0.08, h0 - 0.1, pz + sg.ux * 0.08), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 0.86, 1));
      posts.setMatrixAt(i, m);
      colliders.push({ type: 'box', center: { x: sg.x, y: (h0 + h1) / 2 + 0.45, z: sg.z }, half: { x: 0.12, y: 0.45, z: spacing / 2 }, yaw });
    });
    for (const mesh of [beams, posts]) {
      mesh.castShadow = q.shadows;
      mesh.receiveShadow = q.shadows;
      mesh.computeBoundingSphere();
      group.add(mesh);
      meshes.push(mesh);
    }
    materials.push(metal);
    geometries.push(beamGeo, postGeo);
  } else {
    const geo = jerseyGeometry(spacing - 0.06);
    const mat = gameMaterial('concrete', { unique: true });
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, segs.length));
    mesh.count = segs.length;
    const stripes = opts.paint === 'stripes';
    segs.forEach((sg, i) => {
      const h0 = groundHeight(terrain, sg.x - sg.ux * spacing / 2, sg.z - sg.uz * spacing / 2);
      const h1 = groundHeight(terrain, sg.x + sg.ux * spacing / 2, sg.z + sg.uz * spacing / 2);
      const yaw = Math.atan2(sg.ux, sg.uz);
      const pitch = -Math.atan2(h1 - h0, spacing);
      eul.set(pitch, yaw, 0, 'YXZ');
      qq.setFromEuler(eul);
      m.compose(new THREE.Vector3(sg.x, (h0 + h1) / 2 - 0.02, sg.z), qq, new THREE.Vector3(1, 1, 1));
      mesh.setMatrixAt(i, m);
      let col;
      if (stripes) col = i % 2 === 0 ? new THREE.Color(1.6, 0.25, 0.2) : new THREE.Color(1.5, 1.5, 1.5);
      else {
        const v = 0.85 + rng() * 0.25;
        col = new THREE.Color(v, v * 0.99, v * 0.96);
      }
      mesh.setColorAt(i, col);
      colliders.push({ type: 'box', center: { x: sg.x, y: (h0 + h1) / 2 + 0.4, z: sg.z }, half: { x: 0.3, y: 0.42, z: spacing / 2 }, yaw });
    });
    mesh.castShadow = q.shadows;
    mesh.receiveShadow = q.shadows;
    mesh.computeBoundingSphere();
    group.add(mesh);
    meshes.push(mesh);
    materials.push(mat);
    geometries.push(geo);
  }
  scene.add(group);
  return {
    group, colliders, count: segs.length,
    dispose() {
      scene.remove(group);
      for (const g of geometries) g.dispose();
      for (const mt of materials) mt.dispose();
      for (const mesh of meshes) mesh.dispose();
    },
  };
}

let chainlinkCache = null;

function chainlinkTexture() {
  if (chainlinkCache) return chainlinkCache;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(205,210,214,1)';
  ctx.lineWidth = 5;
  const step = size / 4;
  for (let i = -4; i <= 8; i++) {
    ctx.beginPath();
    ctx.moveTo(i * step, 0);
    ctx.lineTo(i * step + size, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(i * step + size, 0);
    ctx.lineTo(i * step, size);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  chainlinkCache = tex;
  return tex;
}

export function fences(scene, opts = {}) {
  const q = propsQuality(opts.quality);
  const terrain = opts.terrain || null;
  const kind = opts.kind || 'chainlink';
  const height = opts.height ?? (kind === 'wood' ? 1.3 : 2.2);
  const spacing = (opts.line && opts.line.spacing) || (kind === 'wood' ? 2.4 : 3);
  const pts = opts.line && opts.line.points ? opts.line.points : [];
  const samples = polylineSamples(pts, spacing, opts.line && opts.line.closed);
  const last = pts.length ? (opts.line.closed ? pts[0] : pts[pts.length - 1]) : null;
  const posts = samples.map((s) => ({ x: s.x, z: s.z }));
  if (last) posts.push({ x: last[0], z: last[1] });
  const frame = createGeoBuilder();
  const panels = createGeoBuilder();
  const postCol = kind === 'wood' ? hex('#6a4d33') : hex('#9fa5aa');
  const railCol = kind === 'wood' ? hex('#7b5b3c') : hex('#a9afb4');
  const postGeo = kind === 'wood' ? new THREE.BoxGeometry(0.14, 1, 0.14) : new THREE.CylinderGeometry(0.035, 0.035, 1, 6);
  postGeo.translate(0, 0.5, 0);
  const railGeo = kind === 'wood' ? new THREE.BoxGeometry(0.06, 0.12, 1) : new THREE.CylinderGeometry(0.022, 0.022, 1, 5).rotateX(Math.PI / 2);
  const colliders = [];
  const heights = posts.map((p) => groundHeight(terrain, p.x, p.z));
  for (let i = 0; i < posts.length; i++) {
    frame.add(postGeo, propsMatrix(posts[i].x, heights[i] - 0.3, posts[i].z, 0, 1, height + 0.35, 1), postCol);
  }
  for (let i = 0; i + 1 < posts.length; i++) {
    const a = posts[i];
    const b = posts[i + 1];
    const ha = heights[i];
    const hb = heights[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) continue;
    const yaw = Math.atan2(dx, dz);
    const pitch = -Math.atan2(hb - ha, len);
    const mx = (a.x + b.x) / 2;
    const mz = (a.z + b.z) / 2;
    const rails = kind === 'wood' ? [0.35, 0.75, 1.15] : [height - 0.03];
    for (const ry of rails) frame.add(railGeo, propsMatrix(mx, (ha + hb) / 2 + Math.min(ry, height), mz, yaw, 1, 1, len, pitch), railCol);
    if (kind !== 'wood') {
      const nx = dz / len;
      const nz = -dx / len;
      panels.quad(
        new THREE.Vector3(a.x, ha + 0.04, a.z), new THREE.Vector3(b.x, hb + 0.04, b.z), new THREE.Vector3(b.x, hb + height, b.z), new THREE.Vector3(a.x, ha + height, a.z),
        new THREE.Vector3(nx, 0, nz), [0, 0], [len / 0.9, 0], [len / 0.9, height / 0.9], [0, height / 0.9], null,
      );
    }
    colliders.push({ type: 'box', center: { x: mx, y: (ha + hb) / 2 + height / 2, z: mz }, half: { x: 0.06, y: height / 2, z: len / 2 }, yaw });
  }
  const group = new THREE.Group();
  group.name = 'kw-fences-' + kind;
  const meshes = [];
  const frameMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: kind === 'wood' ? 0.9 : 0.45, metalness: kind === 'wood' ? 0 : 0.7 });
  if (!frame.empty) {
    const fm = new THREE.Mesh(frame.build(), frameMat);
    fm.castShadow = q.shadows;
    fm.receiveShadow = q.shadows;
    group.add(fm);
    meshes.push(fm);
  }
  let panelMat = null;
  if (!panels.empty) {
    panelMat = new THREE.MeshStandardMaterial({ map: chainlinkTexture(), alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.6, color: 0xb8bec4 });
    const pm = new THREE.Mesh(panels.build(), panelMat);
    pm.castShadow = q.shadows;
    pm.receiveShadow = false;
    group.add(pm);
    meshes.push(pm);
  }
  scene.add(group);
  postGeo.dispose();
  railGeo.dispose();
  return {
    group, colliders: opts.colliders === false ? [] : colliders, count: posts.length,
    dispose() {
      scene.remove(group);
      for (const mm of meshes) mm.geometry.dispose();
      frameMat.dispose();
      if (panelMat) panelMat.dispose();
    },
  };
}

let poolTextureCache = null;

function lightPoolTexture() {
  if (poolTextureCache) return poolTextureCache;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.14)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  poolTextureCache = tex;
  return tex;
}

function lampGeometry(height) {
  const b = createGeoBuilder();
  const steel = hex('#4a4f55');
  const dark = hex('#2b2e32');
  const pole = new THREE.CylinderGeometry(0.07, 0.13, height, 8, 1, false);
  pole.translate(0, height / 2, 0);
  b.add(pole, null, steel);
  const base = new THREE.CylinderGeometry(0.2, 0.24, 0.5, 8);
  base.translate(0, 0.25, 0);
  b.add(base, null, dark);
  const arm = new THREE.CylinderGeometry(0.045, 0.06, 2.2, 6);
  arm.rotateX(Math.PI / 2 - 0.12);
  arm.translate(0, height + 0.06, 1.0);
  b.add(arm, null, steel);
  const head = new THREE.BoxGeometry(0.42, 0.14, 0.9);
  head.translate(0, height + 0.16, 2.05);
  b.add(head, null, dark);
  return b.build();
}

export function lampPosts(scene, opts = {}) {
  const q = propsQuality(opts.quality);
  const terrain = opts.terrain || null;
  const night = !!opts.night;
  const height = opts.height ?? 8;
  const items = [];
  if (Array.isArray(opts.items)) {
    for (const it of opts.items) items.push({ ...it });
  } else if (opts.line && opts.line.points) {
    const spacing = opts.line.spacing ?? 30;
    const offset = opts.line.offset ?? 6;
    const side = opts.line.side || 'both';
    const samples = polylineSamples(opts.line.points, spacing, opts.line.closed);
    samples.forEach((smp, i) => {
      const nx = smp.uz;
      const nz = -smp.ux;
      const sides = side === 'both' ? [i % 2 === 0 ? 1 : -1] : side === 'left' ? [-1] : [1];
      for (const sd of sides) {
        const x = smp.x + nx * offset * sd;
        const z = smp.z + nz * offset * sd;
        const yaw = Math.atan2(-nx * sd, -nz * sd);
        items.push({ x, z, yaw });
      }
    });
  }
  const geo = lampGeometry(height);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.6 });
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length));
  mesh.count = items.length;
  const lensGeo = new THREE.BoxGeometry(0.34, 0.03, 0.78);
  lensGeo.translate(0, height + 0.08, 2.05);
  const lensMat = new THREE.MeshBasicMaterial({ color: night ? new THREE.Color(7.5, 5.6, 3.4) : new THREE.Color(0.75, 0.74, 0.7) });
  const lens = new THREE.InstancedMesh(lensGeo, lensMat, Math.max(1, items.length));
  lens.count = items.length;
  const m = new THREE.Matrix4();
  const up = new THREE.Vector3(0, 1, 0);
  const qq = new THREE.Quaternion();
  const colliders = [];
  const poolData = [];
  items.forEach((it, i) => {
    const y = it.y ?? groundHeight(terrain, it.x, it.z) - 0.05;
    qq.setFromAxisAngle(up, it.yaw || 0);
    m.compose(new THREE.Vector3(it.x, y, it.z), qq, new THREE.Vector3(1, 1, 1));
    mesh.setMatrixAt(i, m);
    lens.setMatrixAt(i, m);
    colliders.push({ type: 'cyl', x: it.x, z: it.z, radius: 0.16, y0: y, y1: y + height });
    const hx = it.x + Math.sin(it.yaw || 0) * 2.05;
    const hz = it.z + Math.cos(it.yaw || 0) * 2.05;
    poolData.push({ x: hx, z: hz, y: groundHeight(terrain, hx, hz), top: y + height });
  });
  mesh.castShadow = q.shadows;
  mesh.receiveShadow = q.shadows;
  mesh.computeBoundingSphere();
  lens.computeBoundingSphere();
  const group = new THREE.Group();
  group.name = 'kw-lamps';
  group.add(mesh);
  group.add(lens);
  const extras = [];
  if (night && items.length) {
    const poolGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const poolMat = new THREE.MeshBasicMaterial({
      map: lightPoolTexture(), color: new THREE.Color(1.0, 0.72, 0.42).multiplyScalar(opts.poolIntensity ?? 0.42), transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, fog: true,
    });
    const pools = new THREE.InstancedMesh(poolGeo, poolMat, items.length);
    const coneGeo = new THREE.ConeGeometry(1, 1, 18, 1, true);
    coneGeo.translate(0, -0.5, 0);
    const coneMat = new THREE.ShaderMaterial({
      uniforms: { kwColor: { value: new THREE.Color(1.0, 0.72, 0.42).multiplyScalar(opts.coneIntensity ?? 0.07) } },
      vertexShader: `
varying vec2 kwUv;
varying vec3 kwN;
varying vec3 kwV;
void main() {
  kwUv = uv;
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  kwN = normalize(normalMatrix * mat3(instanceMatrix) * normal);
  kwV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`,
      fragmentShader: `
uniform vec3 kwColor;
varying vec2 kwUv;
varying vec3 kwN;
varying vec3 kwV;
void main() {
  float dist = length(kwV);
  float edge = pow(abs(dot(normalize(kwN), kwV / max(dist, 0.001))), 1.6);
  float vert = pow(clamp(kwUv.y, 0.0, 1.0), 1.8);
  float far = 1.0 - smoothstep(120.0, 420.0, dist);
  gl_FragColor = vec4(kwColor * edge * vert * far, 1.0);
}`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const conesMesh = new THREE.InstancedMesh(coneGeo, coneMat, items.length);
    poolData.forEach((p, i) => {
      const r = height * 1.25;
      m.compose(new THREE.Vector3(p.x, p.y + 0.06, p.z), new THREE.Quaternion(), new THREE.Vector3(r * 2, 1, r * 2));
      pools.setMatrixAt(i, m);
      const ch = p.top - p.y;
      m.compose(new THREE.Vector3(p.x, p.top, p.z), new THREE.Quaternion(), new THREE.Vector3(height * 0.55, ch, height * 0.55));
      conesMesh.setMatrixAt(i, m);
    });
    pools.renderOrder = 2;
    conesMesh.renderOrder = 3;
    pools.computeBoundingSphere();
    conesMesh.computeBoundingSphere();
    group.add(pools);
    group.add(conesMesh);
    extras.push(pools, conesMesh);
  }
  scene.add(group);
  let realLights = [];
  if (night && opts.realLights > 0) {
    for (let i = 0; i < Math.min(opts.realLights, poolData.length); i++) {
      const l = new THREE.PointLight(0xffc98a, 12, height * 3, 2);
      group.add(l);
      realLights.push(l);
    }
  }
  function update(a, b) {
    const { camera } = propsArgs(a, b);
    if (!realLights.length || !camera) return;
    const sorted = poolData.map((p, i) => [i, (p.x - camera.position.x) ** 2 + (p.z - camera.position.z) ** 2]).sort((x, y) => x[1] - y[1]);
    realLights.forEach((l, k) => {
      const p = poolData[sorted[k][0]];
      l.position.set(p.x, p.top - 0.2, p.z);
    });
  }
  return {
    group, colliders, count: items.length, update,
    dispose() {
      scene.remove(group);
      geo.dispose();
      mat.dispose();
      lensGeo.dispose();
      lensMat.dispose();
      mesh.dispose();
      lens.dispose();
      for (const e of extras) { e.geometry.dispose(); e.material.dispose(); e.dispose(); }
      for (const l of realLights) l.dispose();
      realLights = [];
    },
  };
}

const POSTER_DESIGNS = [
  { bg: ['#ff3b30', '#ff9500'], title: 'FIZZRO', sub: 'ICE COLD CITRUS SODA', accent: '#fff4d6', shape: 'can' },
  { bg: ['#0b1a3a', '#2a64f6'], title: 'ORBIQ 7', sub: 'THE PHONE THAT SEES IN THE DARK', accent: '#9fe3ff', shape: 'phone' },
  { bg: ['#00a3a3', '#ffd36b'], title: 'SUNDRIFT ISLES', sub: 'FLY AWAY THIS SUMMER', accent: '#ffffff', shape: 'sun' },
  { bg: ['#101010', '#3dff8a'], title: 'VOLTRUSH', sub: 'ENERGY FOR THE LAST LAP', accent: '#d9ffe8', shape: 'bolt' },
];

function posterCanvas(index) {
  const d = POSTER_DESIGNS[index % POSTER_DESIGNS.length];
  const w = 1024;
  const h = 428;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, d.bg[0]);
  g.addColorStop(1, d.bg[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    ctx.arc(w * (0.15 + i * 0.17), h * (0.2 + (i % 2) * 0.6), 60 + i * 14, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  const sx = w * 0.78;
  const sy = h * 0.52;
  ctx.save();
  ctx.translate(sx, sy);
  if (d.shape === 'can') {
    ctx.fillStyle = '#fafafa';
    ctx.fillRect(-60, -150, 120, 300);
    ctx.fillStyle = d.bg[0];
    ctx.fillRect(-60, -70, 120, 120);
    ctx.fillStyle = '#c8c8c8';
    ctx.fillRect(-60, -150, 120, 14);
    ctx.fillRect(-60, 136, 120, 14);
  } else if (d.shape === 'phone') {
    ctx.fillStyle = '#0a0a0a';
    ctx.beginPath();
    ctx.roundRect(-80, -170, 160, 340, 26);
    ctx.fill();
    const sg = ctx.createLinearGradient(-70, -150, 70, 150);
    sg.addColorStop(0, '#6a3df6');
    sg.addColorStop(1, '#19c7ff');
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.roundRect(-70, -158, 140, 316, 18);
    ctx.fill();
  } else if (d.shape === 'sun') {
    ctx.fillStyle = '#fff1a8';
    ctx.beginPath();
    ctx.arc(0, -40, 95, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0f6c6c';
    ctx.beginPath();
    ctx.moveTo(-200, 160);
    ctx.quadraticCurveTo(0, 40, 200, 160);
    ctx.fill();
  } else {
    ctx.fillStyle = '#3dff8a';
    ctx.beginPath();
    ctx.moveTo(30, -170);
    ctx.lineTo(-70, 20);
    ctx.lineTo(0, 20);
    ctx.lineTo(-30, 170);
    ctx.lineTo(80, -30);
    ctx.lineTo(10, -30);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  ctx.fillStyle = d.accent;
  ctx.font = '900 118px system-ui, sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(d.title, 48, h * 0.48, w * 0.62);
  ctx.font = '700 38px system-ui, sans-serif';
  ctx.fillText(d.sub, 52, h * 0.66, w * 0.6);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(0, h - 26, w, 26);
  return canvas;
}

function imageOrCanvasTexture(folder, name, fallback, onReady) {
  const tex = new THREE.CanvasTexture(fallback());
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  loadGameImage(folder, name).then((img) => {
    if (!img) return;
    tex.image = img;
    tex.needsUpdate = true;
    if (onReady) onReady(tex);
  });
  return tex;
}

export function billboards(scene, opts = {}) {
  const q = propsQuality(opts.quality);
  const terrain = opts.terrain || null;
  const images = opts.images || ['billboard-1', 'billboard-2', 'billboard-3', 'billboard-4'];
  const night = !!opts.night;
  const items = Array.isArray(opts.items) ? opts.items : [];
  const frame = createGeoBuilder();
  const lampsB = createGeoBuilder();
  const posterBuilders = images.map(() => createGeoBuilder());
  const steel = hex('#5b6066');
  const dark = hex('#2a2d31');
  const box = new THREE.BoxGeometry(1, 1, 1);
  const colliders = [];
  items.forEach((it, i) => {
    const w = it.width ?? 12;
    const h = it.height ?? 5;
    const elev = it.elevation ?? 6;
    const yaw = it.yaw || 0;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const g = it.y ?? groundHeight(terrain, it.x, it.z);
    const at = (lx, ly, lz) => [it.x + lx * c + lz * s, g + ly, it.z - lx * s + lz * c];
    for (const lx of [-w * 0.3, w * 0.3]) {
      const [x, y, z] = at(lx, (elev + h * 0.5) / 2 - 0.5, 0.35);
      frame.add(box, propsMatrix(x, y, z, yaw, 0.45, elev + h * 0.5 + 1, 0.45), steel);
    }
    {
      const [x, y, z] = at(0, elev + h / 2, 0.12);
      frame.add(box, propsMatrix(x, y, z, yaw, w + 0.4, h + 0.4, 0.22), dark);
    }
    {
      const [x, y, z] = at(0, elev - 0.15, -0.65);
      frame.add(box, propsMatrix(x, y, z, yaw, w, 0.08, 1.1), steel);
      const [rx, ry, rz] = at(0, elev + 0.45, -1.18);
      frame.add(box, propsMatrix(rx, ry, rz, yaw, w, 0.05, 0.05), steel);
    }
    for (let k = 0; k < 4; k++) {
      const lx = -w / 2 + w * (k + 0.5) / 4;
      const [x, y, z] = at(lx, elev + h + 0.55, -0.6);
      frame.add(box, propsMatrix(x, y, z, yaw, 0.06, 0.06, 1.2), steel);
      const [hx, hy, hz] = at(lx, elev + h + 0.5, -1.15);
      lampsB.add(box, propsMatrix(hx, hy, hz, yaw, 0.5, 0.16, 0.24), hex('#ffffff'));
    }
    const pb = posterBuilders[i % images.length];
    const [ax, , az] = at(-w / 2, 0, -0.005);
    const [bx, , bz] = at(w / 2, 0, -0.005);
    const nrm = new THREE.Vector3(-s, 0, -c);
    const y0 = g + elev;
    const y1 = g + elev + h;
    pb.quad(
      new THREE.Vector3(bx, y0, bz), new THREE.Vector3(ax, y0, az), new THREE.Vector3(ax, y1, az), new THREE.Vector3(bx, y1, bz),
      nrm, [0, 0], [1, 0], [1, 1], [0, 1], null,
    );
    colliders.push({ type: 'box', center: { x: it.x, y: g + elev + h / 2, z: it.z }, half: { x: w / 2, y: h / 2, z: 0.4 }, yaw });
    for (const lx of [-w * 0.3, w * 0.3]) {
      const [x, , z] = at(lx, 0, 0.35);
      colliders.push({ type: 'cyl', x, z, radius: 0.3, y0: g, y1: g + elev });
    }
  });
  const group = new THREE.Group();
  group.name = 'kw-billboards';
  const meshes = [];
  const mats = [];
  if (!frame.empty) {
    const fm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.65 });
    const mesh = new THREE.Mesh(frame.build(), fm);
    mesh.castShadow = q.shadows;
    mesh.receiveShadow = q.shadows;
    group.add(mesh);
    meshes.push(mesh);
    mats.push(fm);
  }
  posterBuilders.forEach((pb, i) => {
    if (pb.empty) return;
    const tex = imageOrCanvasTexture('art', images[i], () => posterCanvas(i));
    const pm = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0, emissive: night ? new THREE.Color(0.55, 0.55, 0.55) : new THREE.Color(0, 0, 0), emissiveMap: night ? tex : null });
    const mesh = new THREE.Mesh(pb.build(), pm);
    mesh.receiveShadow = q.shadows;
    group.add(mesh);
    meshes.push(mesh);
    mats.push(pm);
  });
  if (!lampsB.empty) {
    const lm = new THREE.MeshBasicMaterial({ vertexColors: true, color: night ? new THREE.Color(6, 5.4, 4.2) : new THREE.Color(0.5, 0.5, 0.5) });
    const mesh = new THREE.Mesh(lampsB.build(), lm);
    group.add(mesh);
    meshes.push(mesh);
    mats.push(lm);
  }
  scene.add(group);
  box.dispose();
  return {
    group, colliders, count: items.length,
    dispose() {
      scene.remove(group);
      for (const mm of meshes) mm.geometry.dispose();
      for (const mt of mats) { if (mt.map) mt.map.dispose(); mt.dispose(); }
    },
  };
}

const NEON_DESIGNS = [
  { text: 'OPEN', color: '#ff2f6d', glow: '#ff6f9a', shape: 'frame' },
  { text: 'NOODLES', color: '#22e3ff', glow: '#8ff4ff', shape: 'bowl' },
  { text: 'HOTEL', color: '#ffb02e', glow: '#ffd78a', shape: 'arrow' },
  { text: 'BAR', color: '#b46bff', glow: '#d9b6ff', shape: 'glass' },
];

function neonCell(ctx, d, x0, y0, size) {
  ctx.save();
  ctx.translate(x0, y0);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const passes = [[34, 16, 0.55], [18, 10, 0.85], [8, 6, 1], [3, 2.6, 1]];
  for (const [blur, width, alpha] of passes) {
    ctx.shadowColor = d.color;
    ctx.shadowBlur = blur;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = blur < 4 ? d.glow : d.color;
    ctx.lineWidth = width;
    ctx.font = '700 ' + Math.round(size * (d.text.length > 5 ? 0.17 : 0.24)) + 'px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeText(d.text, size / 2, size * 0.36);
    ctx.beginPath();
    if (d.shape === 'frame') {
      ctx.roundRect(size * 0.1, size * 0.14, size * 0.8, size * 0.46, 30);
    } else if (d.shape === 'bowl') {
      ctx.arc(size / 2, size * 0.66, size * 0.2, 0, Math.PI);
      ctx.moveTo(size * 0.3, size * 0.66);
      ctx.lineTo(size * 0.7, size * 0.66);
      ctx.moveTo(size * 0.56, size * 0.52);
      ctx.lineTo(size * 0.7, size * 0.6);
      ctx.moveTo(size * 0.6, size * 0.5);
      ctx.lineTo(size * 0.74, size * 0.58);
    } else if (d.shape === 'arrow') {
      ctx.moveTo(size * 0.18, size * 0.68);
      ctx.lineTo(size * 0.76, size * 0.68);
      ctx.moveTo(size * 0.64, size * 0.58);
      ctx.lineTo(size * 0.78, size * 0.68);
      ctx.lineTo(size * 0.64, size * 0.78);
    } else {
      ctx.moveTo(size * 0.38, size * 0.56);
      ctx.lineTo(size * 0.62, size * 0.56);
      ctx.lineTo(size * 0.5, size * 0.7);
      ctx.closePath();
      ctx.moveTo(size * 0.5, size * 0.7);
      ctx.lineTo(size * 0.5, size * 0.84);
      ctx.moveTo(size * 0.42, size * 0.84);
      ctx.lineTo(size * 0.58, size * 0.84);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function neonAtlasCanvas(images) {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size * 2;
  canvas.height = size * 2;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size * 2, size * 2);
  for (let i = 0; i < 4; i++) {
    const x0 = (i % 2) * size;
    const y0 = Math.floor(i / 2) * size;
    if (images[i]) {
      const img = images[i];
      const a = img.width / Math.max(1, img.height);
      const fw = a >= 1 ? size : size * a;
      const fh = a >= 1 ? size / a : size;
      ctx.drawImage(img, x0 + (size - fw) / 2, y0 + (size - fh) / 2, fw, fh);
    } else {
      neonCell(ctx, NEON_DESIGNS[i], x0, y0, size);
    }
  }
  return canvas;
}

export function neonSigns(scene, opts = {}) {
  const names = opts.images || ['neon-1', 'neon-2', 'neon-3', 'neon-4'];
  const night = opts.night !== false;
  const items = Array.isArray(opts.items) ? opts.items : [];
  const tex = new THREE.CanvasTexture(neonAtlasCanvas([]));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  Promise.all(names.slice(0, 4).map((n) => loadGameImage('sprites', n))).then((imgs) => {
    if (!imgs.some(Boolean)) return;
    tex.image = neonAtlasCanvas(imgs);
    tex.needsUpdate = true;
  });
  const pos = [];
  const uv = [];
  const sign = [];
  const idx = [];
  const nrm = [];
  items.forEach((it, i) => {
    const cell = (it.image ?? i) % 4;
    const w = it.width ?? 4;
    const h = it.height ?? 4;
    const yaw = it.yaw || 0;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const cx = it.x;
    const cy = it.y ?? 6;
    const cz = it.z;
    const corners = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
    const u0 = (cell % 2) * 0.5;
    const v0 = 0.5 - Math.floor(cell / 2) * 0.5;
    const uvs = [[u0, v0], [u0 + 0.5, v0], [u0 + 0.5, v0 + 0.5], [u0, v0 + 0.5]];
    const base = pos.length / 3;
    for (let k = 0; k < 4; k++) {
      const [lx, ly] = corners[k];
      pos.push(cx + lx * c, cy + ly, cz - lx * s);
      uv.push(uvs[k][0], uvs[k][1]);
      sign.push(i + 0.37 * cell);
      nrm.push(s, 0, c);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('kwSign', new THREE.Float32BufferAttribute(sign, 1));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  const intensity = { value: night ? 3.2 : 0.7 };
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.kwPropsTime = propsTime;
    shader.uniforms.kwNeonIntensity = intensity;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float kwSign;\nuniform float kwPropsTime;\nuniform float kwNeonIntensity;\nvarying float kwFlicker;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
  float kwT = kwPropsTime * (1.0 + fract(kwSign * 0.618) * 0.6) + kwSign * 7.31;
  float kwBuzz = step(0.965, fract(sin(floor(kwT * 9.0) * 12.9898 + kwSign) * 43758.5453));
  kwFlicker = kwNeonIntensity * (0.93 + 0.07 * sin(kwT * 41.0)) * (1.0 - 0.75 * kwBuzz);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float kwFlicker;')
      .replace('#include <map_fragment>', '#include <map_fragment>\n  diffuseColor.rgb *= kwFlicker;');
  };
  mat.customProgramCacheKey = () => 'kwNeon';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 4;
  mesh.name = 'kw-neon';
  const group = new THREE.Group();
  group.name = 'kw-neon-signs';
  group.add(mesh);
  scene.add(group);
  return {
    group, colliders: [], count: items.length,
    update(t) { tickPropsTime(typeof t === 'number' && t > 1000 ? t : undefined); },
    setIntensity(v) { intensity.value = v; },
    dispose() { scene.remove(group); geo.dispose(); mat.dispose(); tex.dispose(); },
  };
}

const glbCache = new Map();
let glbLoader = null;

export function loadGLB(url) {
  if (!glbCache.has(url)) {
    if (!glbLoader) glbLoader = new GLTFLoader();
    glbCache.set(url, new Promise((resolve) => {
      glbLoader.load(url, (gltf) => resolve(gltf.scene || null), undefined, () => resolve(null));
    }));
  }
  return glbCache.get(url).then((root) => (root ? root.clone(true) : null));
}

export function updateProps(list, a, b) {
  for (const p of list) if (p && typeof p.update === 'function') p.update(a, b);
}

export function disposeProps(list) {
  for (const p of list) if (p && typeof p.dispose === 'function') p.dispose();
}
