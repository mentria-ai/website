import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const ARM_REACH = 0.1125;
const MOTOR_OFFSET = ARM_REACH / Math.SQRT2;
const ARM_T = 0.0055;
const PROP_R = 0.0635;
const PROP_LIFT = 0.0235;
const COM_Y = 0.025;
const SPIN_MAX = 180 * Math.PI * 2;
const SPIN_STEP_CAP = 0.75;
const TOP_PLATE_Y = 0.031;
const CAMERA_POS = [0, 0.017, -0.04];

const MOTORS = [
  { x: MOTOR_OFFSET, z: -MOTOR_OFFSET, spin: 1, front: true, angle: Math.PI / 4 },
  { x: -MOTOR_OFFSET, z: -MOTOR_OFFSET, spin: -1, front: true, angle: Math.PI * 3 / 4 },
  { x: -MOTOR_OFFSET, z: MOTOR_OFFSET, spin: 1, front: false, angle: Math.PI * 5 / 4 },
  { x: MOTOR_OFFSET, z: MOTOR_OFFSET, spin: -1, front: false, angle: Math.PI * 7 / 4 }
];

function smoothRange(a, b, v) {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function plain(geo, keepColor) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv' && !(keepColor && name === 'color')) g.deleteAttribute(name);
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  g.clearGroups();
  return g;
}

function tint(geo, color) {
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = color.r;
    arr[i * 3 + 1] = color.g;
    arr[i * 3 + 2] = color.b;
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(arr, 3));
  return geo;
}

function splitLidsAndSides(geo) {
  const parts = [];
  for (const grp of geo.groups) {
    const g = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'uv']) {
      const a = geo.attributes[name];
      g.setAttribute(name, new THREE.Float32BufferAttribute(a.array.slice(grp.start * a.itemSize, (grp.start + grp.count) * a.itemSize), a.itemSize));
    }
    parts[grp.materialIndex] = g;
  }
  geo.dispose();
  return parts;
}

function extrudeFlat(shape, thickness, bevel, curveSegments = 6) {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(thickness - bevel * 2, 1e-5),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: -bevel,
    bevelSegments: 1,
    curveSegments
  });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, bevel, 0);
  return geo;
}

function roundedRectPoints(cx, cy, hw, hh, r, seg) {
  const pts = [];
  const corners = [
    [hw - r, hh - r, 0],
    [-hw + r, hh - r, Math.PI / 2],
    [-hw + r, -hh + r, Math.PI],
    [hw - r, -hh + r, Math.PI * 1.5]
  ];
  for (const [x, y, a0] of corners) {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (Math.PI / 2) * (i / seg);
      pts.push(new THREE.Vector2(cx + x + r * Math.cos(a), cy + y + r * Math.sin(a)));
    }
  }
  return pts;
}

function stadiumPoints(map, u0, u1, hw, seg) {
  const pts = [];
  for (let i = 0; i <= seg; i++) {
    const a = -Math.PI / 2 + Math.PI * (i / seg);
    pts.push(map(u1 + hw * Math.cos(a), hw * Math.sin(a)));
  }
  for (let i = 0; i <= seg; i++) {
    const a = Math.PI / 2 + Math.PI * (i / seg);
    pts.push(map(u0 + hw * Math.cos(a), hw * Math.sin(a)));
  }
  return pts;
}

function armShape(angle, detailed) {
  const u0 = 0.011;
  const rp = 0.0158;
  const wr = 0.026;
  const wt = 0.0165;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const map = (u, v) => new THREE.Vector2(u * c - v * s, u * s + v * c);
  const a1 = -Math.PI + Math.asin(wt / 2 / rp);
  const a2 = Math.PI - Math.asin(wt / 2 / rp);
  const pts = [map(u0, -wr / 2)];
  const steps = detailed ? 14 : 6;
  for (let i = 0; i <= steps; i++) {
    const a = a1 + (a2 - a1) * (i / steps);
    pts.push(map(ARM_REACH + rp * Math.cos(a), rp * Math.sin(a)));
  }
  pts.push(map(u0, wr / 2));
  const shape = new THREE.Shape(pts);
  if (detailed) {
    shape.holes.push(new THREE.Path(stadiumPoints(map, 0.036, 0.072, 0.0034, 4)));
  }
  return shape;
}

function carbonWeaveTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cell = 8;
  for (let j = 0; j < size / cell; j++) {
    for (let i = 0; i < size / cell; i++) {
      const over = ((i - j) % 4 + 4) % 4 < 2;
      const x = i * cell;
      const y = j * cell;
      const g = over ? ctx.createLinearGradient(x, y, x, y + cell) : ctx.createLinearGradient(x, y, x + cell, y);
      g.addColorStop(0, over ? '#060607' : '#08090a');
      g.addColorStop(0.5, over ? '#1e1f23' : '#17181b');
      g.addColorStop(1, over ? '#060607' : '#08090a');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, cell, cell);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(62, 62);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function discTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const c = size / 2;
  const g = ctx.createRadialGradient(c, c, 0, c, c, c);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.12, 'rgba(255,255,255,0.05)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.32)');
  g.addColorStop(0.62, 'rgba(255,255,255,0.22)');
  g.addColorStop(0.88, 'rgba(255,255,255,0.3)');
  g.addColorStop(0.95, 'rgba(255,255,255,0.75)');
  g.addColorStop(0.985, 'rgba(255,255,255,0.4)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  for (let r = 14; r < c - 4; r += 7) {
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function batteryTexture(accent) {
  const w = 256;
  const h = 128;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1b1d21';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#26292e';
  for (let x = -h; x < w; x += 22) {
    ctx.beginPath();
    ctx.moveTo(x, h);
    ctx.lineTo(x + 8, h);
    ctx.lineTo(x + 8 + h, 0);
    ctx.lineTo(x + h, 0);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = '#' + accent.getHexString();
  ctx.fillRect(0, h * 0.38, w, h * 0.24);
  ctx.fillStyle = '#0d0e10';
  ctx.fillRect(0, h * 0.44, w, h * 0.12);
  ctx.strokeStyle = '#e8ecef';
  ctx.lineWidth = 4;
  ctx.strokeRect(w * 0.72, h * 0.12, w * 0.16, h * 0.18);
  ctx.fillStyle = '#e8ecef';
  ctx.fillRect(w * 0.88, h * 0.17, w * 0.02, h * 0.08);
  ctx.fillRect(w * 0.74, h * 0.15, w * 0.09, h * 0.12);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function bladeGeometry(mirror, stations, chordPts) {
  const r0 = 0.0058;
  const positions = [];
  const index = [];
  const cols = chordPts + 1;
  const rows = stations + 1;
  for (let side = 0; side < 2; side++) {
    for (let i = 0; i <= stations; i++) {
      const t = i / stations;
      const r = r0 + (PROP_R - r0) * t;
      const chord = (0.0086 + 0.0074 * Math.sin(Math.PI * Math.pow(t, 0.75))) * Math.sqrt(Math.max(0, 1 - Math.pow(t, 8)));
      const beta = Math.min(Math.atan(0.109 / (2 * Math.PI * r)), 0.78);
      const sweep = 0.0065 * t * t;
      const tmax = 0.0019 - 0.0013 * t;
      const cb = Math.cos(beta);
      const sb = Math.sin(beta);
      for (let j = 0; j <= chordPts; j++) {
        const s = j / chordPts;
        const xc = (s - 0.5) * chord;
        const th = tmax * 2.6 * Math.sqrt(s) * (1 - s);
        const camber = tmax * 2 * s * (1 - s);
        const off = side === 0 ? camber + th / 2 : camber - th / 2;
        const x = r;
        const y = -sb * xc + cb * off;
        const z = sweep + cb * xc + sb * off;
        positions.push(x, y, mirror ? -z : z);
      }
    }
  }
  const at = (side, i, j) => side * rows * cols + i * cols + j;
  for (let i = 0; i < stations; i++) {
    for (let j = 0; j < chordPts; j++) {
      const ta = at(0, i, j), tb = at(0, i + 1, j), tc = at(0, i + 1, j + 1), td = at(0, i, j + 1);
      const ba = at(1, i, j), bb = at(1, i + 1, j), bc = at(1, i + 1, j + 1), bd = at(1, i, j + 1);
      const tris = [[ta, tc, tb], [ta, td, tc], [ba, bb, bc], [ba, bc, bd]];
      for (const tri of tris) {
        if (mirror) index.push(tri[0], tri[2], tri[1]);
        else index.push(tri[0], tri[1], tri[2]);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

function propGeometry(mirror, lod) {
  const parts = [];
  if (lod === 'low') {
    for (let k = 0; k < 3; k++) {
      const g = new THREE.PlaneGeometry(PROP_R - 0.006, 0.011);
      g.rotateX(-Math.PI / 2 + (mirror ? -0.35 : 0.35));
      g.translate(0.006 + (PROP_R - 0.006) / 2, 0, 0);
      g.rotateY((Math.PI * 2 * k) / 3);
      parts.push(plain(g));
    }
    const hub = new THREE.CylinderGeometry(0.0066, 0.0066, 0.006, 8, 1, false);
    parts.push(plain(hub));
  } else {
    const blade = bladeGeometry(mirror, 6, 3);
    for (let k = 0; k < 3; k++) {
      const g = blade.clone();
      g.rotateY((Math.PI * 2 * k) / 3);
      parts.push(plain(g));
    }
    blade.dispose();
    const hub = new THREE.CylinderGeometry(0.0068, 0.0068, 0.0065, 12, 1, false);
    parts.push(plain(hub));
  }
  const merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return merged;
}

function bellGeometry(accent, nutColor, lod) {
  const parts = [];
  if (lod === 'low') {
    const side = new THREE.CylinderGeometry(0.0142, 0.0142, 0.015, 8, 1, false);
    side.translate(0, 0.0115, 0);
    parts.push(tint(plain(side), accent));
  } else {
    const side = new THREE.CylinderGeometry(0.0142, 0.0142, 0.015, 18, 1, true);
    side.translate(0, 0.0115, 0);
    parts.push(tint(plain(side), accent));
    const capPts = [];
    const outer = 0.0142;
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      capPts.push(new THREE.Vector2(Math.cos(a) * outer, Math.sin(a) * outer));
    }
    const cap = new THREE.Shape(capPts);
    for (let k = 0; k < 5; k++) {
      const mid = (k / 5) * Math.PI * 2 + Math.PI / 5;
      const half = 0.4;
      const hole = [];
      for (let i = 0; i <= 3; i++) {
        const a = mid - half + (2 * half * i) / 3;
        hole.push(new THREE.Vector2(Math.cos(a) * 0.0112, Math.sin(a) * 0.0112));
      }
      for (let i = 2; i >= 0; i--) {
        const a = mid - half * 0.7 + (2 * half * 0.7 * i) / 2;
        hole.push(new THREE.Vector2(Math.cos(a) * 0.0055, Math.sin(a) * 0.0055));
      }
      cap.holes.push(new THREE.Path(hole));
    }
    const capGeo = new THREE.ShapeGeometry(cap, 1);
    capGeo.rotateX(-Math.PI / 2);
    capGeo.translate(0, 0.019, 0);
    parts.push(tint(plain(capGeo), accent));
  }
  const nut = new THREE.CylinderGeometry(0.0042, 0.0042, 0.0055, 6, 1, false);
  nut.translate(0, 0.02975, 0);
  parts.push(tint(plain(nut), nutColor));
  const merged = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return merged;
}

function tube(points, radius, tubular, radial) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
  return new THREE.TubeGeometry(curve, tubular, radius, radial, false);
}

function box(w, h, d, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

function cylinderAlongZ(r, len, seg, x, y, z, open) {
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1, !!open);
  g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return g;
}

function ghostMaterial(color, opacity) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: color.clone() },
      uOpacity: { value: opacity }
    },
    vertexShader: [
      '#include <common>',
      'varying vec3 vN;',
      'varying vec3 vV;',
      'void main() {',
      '#include <beginnormal_vertex>',
      '#include <defaultnormal_vertex>',
      '#include <begin_vertex>',
      '#include <project_vertex>',
      'vN = normalize(transformedNormal);',
      'vV = -mvPosition.xyz;',
      '}'
    ].join('\n'),
    fragmentShader: [
      'uniform vec3 uColor;',
      'uniform float uOpacity;',
      'varying vec3 vN;',
      'varying vec3 vV;',
      'void main() {',
      'float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));',
      'float rim = f * f * f;',
      'gl_FragColor = vec4(uColor * (0.1 + 1.6 * rim) * uOpacity, 1.0);',
      '#include <tonemapping_fragment>',
      '#include <colorspace_fragment>',
      '}'
    ].join('\n'),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide
  });
}

export function createDroneMesh({ color = 0x6ef3c5, ghost = false, cameraTilt = 25 * Math.PI / 180, lod = 'high' } = {}) {
  const high = lod !== 'low';
  const accent = new THREE.Color(color);
  const hsl = accent.getHSL({ h: 0, s: 0, l: 0 });
  const accentDeep = accent.clone().multiplyScalar(0.55);
  const anodized = new THREE.Color().setHSL(hsl.h, Math.min(1, hsl.s * 1.05), hsl.l * 0.72);
  const propColor = new THREE.Color().setHSL(hsl.h, Math.min(1, hsl.s * 1.2), hsl.l * 0.36);
  const black = new THREE.Color(0x0b0b0c);
  const charcoal = new THREE.Color(0x1d1f23);
  const silver = new THREE.Color(0xc9ccd2);
  const darkMetal = new THREE.Color(0x24262b);
  const copper = new THREE.Color(0xb8692f);
  const red = new THREE.Color(0xa3121c);
  const yellow = new THREE.Color(0xe8a713);
  const pcb = new THREE.Color(0x0f3a26);
  const capBlue = new THREE.Color(0x14213f);
  const strapRed = new THREE.Color(0x7c0d16);

  const group = new THREE.Group();
  group.name = 'drone';
  const body = new THREE.Group();
  body.position.y = -COM_Y;
  group.add(body);

  const geometries = [];
  const materials = [];
  const textures = [];
  const buckets = new Map();
  const add = (key, geo, col) => {
    const g = plain(geo);
    if (col) tint(g, col);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(g);
  };
  const addSplit = (geo, lidKey, sideKey) => {
    const [lids, sides] = splitLidsAndSides(geo);
    add(lidKey, lids);
    add(sideKey, sides);
  };

  for (const m of MOTORS) {
    const shape = armShape(m.angle, high);
    const g = extrudeFlat(shape, ARM_T, high ? 0.0007 : 0, high ? 6 : 2);
    if (high) addSplit(g, 'carbon', 'carbonEdge');
    else add('carbon', g);
  }

  const plate = (cz, hw, hh, r, y, t, holes) => {
    const shape = new THREE.Shape(roundedRectPoints(0, -cz, hw, hh, r, high ? 3 : 1));
    if (holes) for (const h of holes) shape.holes.push(new THREE.Path(h));
    const g = extrudeFlat(shape, t, high ? 0.0004 : 0, 3);
    g.translate(0, y, 0);
    if (high) addSplit(g, 'carbon', 'carbonEdge');
    else add('carbon', g);
  };
  plate(0, 0.0205, 0.046, 0.006, -0.002, 0.002);
  if (high) plate(-0.004, 0.019, 0.046, 0.005, ARM_T, 0.0015);
  const slots = high ? [-1, 1].map((sx) => stadiumPoints((u, v) => new THREE.Vector2(sx * 0.0095 + v, u), -0.034, 0.02, 0.0024, 3)) : null;
  plate(0.007, 0.0195, 0.041, 0.005, TOP_PLATE_Y, 0.002, slots);

  if (high) {
    for (const sx of [-1, 1]) {
      const pts = roundedRectPoints(0.041, 0.0192, 0.013, 0.0112, 0.004, 3);
      const shape = new THREE.Shape(pts);
      shape.holes.push(new THREE.Path(roundedRectPoints(0.034, 0.0192, 0.0035, 0.0045, 0.002, 2)));
      const g = new THREE.ExtrudeGeometry(shape, { depth: 0.0012, bevelEnabled: true, bevelThickness: 0.0004, bevelSize: 0.0004, bevelOffset: -0.0004, bevelSegments: 1, curveSegments: 3 });
      g.rotateY(Math.PI / 2);
      g.translate(sx * 0.0115 - 0.001, 0, 0);
      addSplit(g, 'carbon', 'carbonEdge');
    }
  }

  const standoffH = TOP_PLATE_Y - (ARM_T + 0.0015);
  for (const sx of [-1, 1]) {
    for (const z of [-0.027, 0.041]) {
      const g = new THREE.CylinderGeometry(0.0026, 0.0026, standoffH, high ? 8 : 5, 1, true);
      g.translate(sx * 0.0165, ARM_T + 0.0015 + standoffH / 2, z);
      add('metal', g, accentDeep);
    }
  }

  for (const m of MOTORS) {
    const base = new THREE.CylinderGeometry(0.0135, 0.0139, 0.004, high ? 16 : 8, 1, false);
    base.translate(m.x, ARM_T + 0.002, m.z);
    add('metal', base, darkMetal);
    if (high) {
      const wind = new THREE.CylinderGeometry(0.0118, 0.0118, 0.0142, 12, 1, false);
      wind.translate(m.x, ARM_T + 0.004 + 0.0071, m.z);
      add('metal', wind, copper);
      const dir = new THREE.Vector2(-m.x, -m.z).normalize();
      const p0 = [m.x + dir.x * 0.014, ARM_T + 0.0016, m.z + dir.y * 0.014];
      const p1 = [m.x + dir.x * 0.04, ARM_T + 0.0019, m.z + dir.y * 0.04];
      const p2 = [m.x + dir.x * 0.066, ARM_T + 0.0024, m.z + dir.y * 0.066];
      add('plastic', tube([p0, p1, p2], 0.0017, 4, 5), black);
      const led = box(0.007, 0.0015, 0.011, 0, 0, 0);
      led.rotateY(m.angle - Math.PI / 2);
      led.translate(Math.cos(m.angle) * 0.085, -0.00075, -Math.sin(m.angle) * 0.085);
      add('led', led, m.front ? new THREE.Color(2.2, 2.2, 2.4) : new THREE.Color(3.0, 0.12, 0.08));
    }
  }

  if (high) {
    const esc = box(0.026, 0.0016, 0.026, 0, 0.011, 0.006);
    add('plastic', esc, pcb);
    const fc = box(0.026, 0.0016, 0.026, 0, 0.018, 0.006);
    add('plastic', fc, pcb);
    add('plastic', box(0.008, 0.0012, 0.008, 0.004, 0.0194, 0.004), black);
    add('plastic', box(0.012, 0.0015, 0.006, -0.005, 0.0124, 0.012), black);
    add('plastic', box(0.02, 0.0016, 0.022, 0, 0.0245, 0.01), pcb);
    add('metal', box(0.018, 0.003, 0.018, 0, 0.0275, 0.01), silver);
    add('plastic', cylinderAlongZ(0.0048, 0.022, 10, -0.0105, 0.0098, 0.044), capBlue);
    add('plastic', box(0.03, 0.0015, 0.06, 0, TOP_PLATE_Y + 0.002 + 0.00075, 0.007), black);
  }

  const batY = TOP_PLATE_Y + 0.002 + 0.0015 + 0.0175;
  const battery = high ? new RoundedBoxGeometry(0.035, 0.035, 0.076, 2, 0.0035) : new THREE.BoxGeometry(0.035, 0.035, 0.076);
  battery.translate(0, batY, 0.007);
  add('battery', battery);

  if (high) {
    const outer = roundedRectPoints(0, 0.05, 0.0211, 0.0209, 0.003, 2);
    const inner = roundedRectPoints(0, 0.0500, 0.0199, 0.0197, 0.002, 2);
    const strapShape = new THREE.Shape(outer);
    strapShape.holes.push(new THREE.Path(inner));
    const strap = new THREE.ExtrudeGeometry(strapShape, { depth: 0.015, bevelEnabled: false, curveSegments: 2 });
    strap.translate(0, 0, 0.007 - 0.0075);
    add('plastic', strap, strapRed);
    add('metal', box(0.012, 0.002, 0.017, 0, 0.0712, 0.007), silver);

    for (const [sx, col] of [[-0.0028, black], [0.0028, red]]) {
      add('plastic', tube([[sx, 0.046, 0.0445], [sx, 0.05, 0.054], [sx, 0.045, 0.062], [sx, 0.04, 0.0645]], 0.0017, 6, 5), col);
      add('plastic', tube([[sx, 0.012, 0.03], [sx, 0.015, 0.05], [sx, 0.024, 0.062], [sx, 0.029, 0.0645]], 0.0017, 6, 5), col);
    }
    add('plastic', box(0.0155, 0.011, 0.0085, 0, 0.0345, 0.0645), yellow);

    add('plastic', tube([[0, 0.022, 0.046], [0, 0.034, 0.058], [0, 0.047, 0.07], [0, 0.058, 0.082]], 0.0021, 5, 6), black);
    const lolly = new THREE.SphereGeometry(0.0085, 10, 6);
    lolly.scale(1, 0.55, 1);
    lolly.rotateX(Math.PI / 4);
    lolly.translate(0, 0.0625, 0.0865);
    add('plastic', lolly, red);
    for (const sx of [-1, 1]) {
      add('plastic', tube([[sx * 0.008, 0.012, 0.044], [sx * 0.022, 0.006, 0.062], [sx * 0.036, 0.003, 0.074]], 0.0011, 4, 4), black);
    }

    for (let i = 0; i < 5; i++) {
      add('led', box(0.0042, 0.003, 0.002, -0.012 + i * 0.006, TOP_PLATE_Y - 0.0025, 0.0482), accent.clone().multiplyScalar(3));
    }
  } else {
    add('plastic', cylinderAlongZ(0.002, 0.05, 4, 0, 0.042, 0.064), black);
  }

  const camPivot = new THREE.Group();
  camPivot.position.set(CAMERA_POS[0], CAMERA_POS[1], CAMERA_POS[2]);
  camPivot.rotation.x = cameraTilt;
  body.add(camPivot);
  const camParts = [];
  const camBody = high ? new RoundedBoxGeometry(0.019, 0.019, 0.017, 2, 0.002) : new THREE.BoxGeometry(0.019, 0.019, 0.017);
  camParts.push(tint(plain(camBody), charcoal));
  camParts.push(tint(plain(cylinderAlongZ(0.0069, 0.009, high ? 16 : 8, 0, 0, -0.0125, false)), black));
  if (high) {
    const ring = new THREE.RingGeometry(0.0054, 0.0069, 16, 1);
    ring.rotateY(Math.PI);
    ring.translate(0, 0, -0.01705);
    camParts.push(tint(plain(ring), accent));
  }
  const camGeo = mergeGeometries(camParts, false);
  camParts.forEach((p) => p.dispose());
  const glass = new THREE.CircleGeometry(0.0055, high ? 16 : 8);
  glass.rotateY(Math.PI);
  glass.translate(0, 0, -0.0171);
  const glassGeo = plain(glass);

  const discParts = [];
  for (const m of MOTORS) {
    const ring = new THREE.RingGeometry(0.0069, PROP_R + 0.0004, high ? 32 : 16, 1);
    ring.rotateX(-Math.PI / 2);
    ring.translate(m.x, ARM_T + PROP_LIFT, m.z);
    discParts.push(plain(ring));
  }
  const discGeo = mergeGeometries(discParts, false);
  discParts.forEach((p) => p.dispose());

  const bellGeo = bellGeometry(anodized, silver, lod);
  const propGeoCCW = propGeometry(false, lod);
  const propGeoCW = propGeometry(true, lod);
  propGeoCCW.translate(0, PROP_LIFT, 0);
  propGeoCW.translate(0, PROP_LIFT, 0);

  const meshes = [];
  const shadowKeys = new Set(['carbon', 'carbonEdge', 'metal', 'plastic', 'battery']);
  let ledMaterial = null;
  let propMaterial;
  let discMaterial;
  let bellMaterial;
  let camMaterial;
  let glassMaterial;

  if (ghost) {
    const all = [];
    for (const [key, list] of buckets) {
      for (const g of list) {
        if (g.attributes.color) g.deleteAttribute('color');
        all.push(g);
      }
      buckets.set(key, []);
    }
    const ghostGeo = mergeGeometries(all, false);
    all.forEach((g) => g.dispose());
    const shell = ghostMaterial(accent, 0.5);
    materials.push(shell);
    const mesh = new THREE.Mesh(ghostGeo, shell);
    mesh.renderOrder = 2;
    body.add(mesh);
    meshes.push(mesh);
    geometries.push(ghostGeo);
    camGeo.deleteAttribute('color');
    camMaterial = shell;
    glassMaterial = shell;
    bellGeo.deleteAttribute('color');
    bellMaterial = shell;
    propMaterial = ghostMaterial(accent, 0.6);
    materials.push(propMaterial);
    const discTex = discTexture();
    textures.push(discTex);
    discMaterial = new THREE.MeshBasicMaterial({ color: accent, map: discTex, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    materials.push(discMaterial);
  } else {
    const weave = carbonWeaveTexture();
    textures.push(weave);
    const batTex = batteryTexture(accent);
    textures.push(batTex);
    const discTex = discTexture();
    textures.push(discTex);
    const mats = {
      carbon: high
        ? new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: weave, roughness: 0.5, metalness: 0.05, clearcoat: 0.7, clearcoatRoughness: 0.2 })
        : new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.5, metalness: 0.1 }),
      carbonEdge: new THREE.MeshStandardMaterial({ color: 0x35373b, roughness: 0.75, metalness: 0.05 }),
      metal: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.3, metalness: 0.85 }),
      plastic: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.58, metalness: 0.0 }),
      battery: new THREE.MeshStandardMaterial({ map: batTex, roughness: 0.48, metalness: 0.0 }),
      led: new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true })
    };
    for (const [key, list] of buckets) {
      if (!list.length) continue;
      const geo = mergeGeometries(list, false);
      list.forEach((g) => g.dispose());
      const mesh = new THREE.Mesh(geo, mats[key]);
      mesh.name = 'drone-' + key;
      if (shadowKeys.has(key)) mesh.castShadow = true;
      body.add(mesh);
      meshes.push(mesh);
      geometries.push(geo);
    }
    for (const key of Object.keys(mats)) materials.push(mats[key]);
    ledMaterial = mats.led;
    camMaterial = mats.plastic;
    glassMaterial = new THREE.MeshPhysicalMaterial({ color: 0x05070d, roughness: 0.04, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.02, iridescence: 0.75, iridescenceIOR: 1.7 });
    materials.push(glassMaterial);
    bellMaterial = mats.metal;
    propMaterial = new THREE.MeshStandardMaterial({ color: propColor, roughness: 0.42, metalness: 0.0, transparent: true, side: THREE.DoubleSide });
    materials.push(propMaterial);
    discMaterial = new THREE.MeshBasicMaterial({ color: propColor.clone().lerp(accent, 0.5), map: discTex, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    materials.push(discMaterial);
  }

  const camMesh = new THREE.Mesh(camGeo, camMaterial);
  camMesh.castShadow = !ghost;
  camPivot.add(camMesh);
  meshes.push(camMesh);
  geometries.push(camGeo);
  const glassMesh = new THREE.Mesh(glassGeo, glassMaterial);
  camPivot.add(glassMesh);
  meshes.push(glassMesh);
  geometries.push(glassGeo);

  const disc = new THREE.Mesh(discGeo, discMaterial);
  disc.visible = false;
  disc.renderOrder = 3;
  body.add(disc);
  meshes.push(disc);
  geometries.push(discGeo);

  const bells = new THREE.InstancedMesh(bellGeo, bellMaterial, 4);
  bells.castShadow = !ghost;
  const propsCCW = new THREE.InstancedMesh(propGeoCCW, propMaterial, 2);
  const propsCW = new THREE.InstancedMesh(propGeoCW, propMaterial, 2);
  propsCCW.castShadow = !ghost;
  propsCW.castShadow = !ghost;
  for (const im of [bells, propsCCW, propsCW]) {
    im.frustumCulled = false;
    body.add(im);
    meshes.push(im);
  }
  geometries.push(bellGeo, propGeoCCW, propGeoCW);

  const tmpMatrix = new THREE.Matrix4();
  const tmpQuat = new THREE.Quaternion();
  const tmpPos = new THREE.Vector3();
  const unitScale = new THREE.Vector3(1, 1, 1);
  const yAxis = new THREE.Vector3(0, 1, 0);
  let spinAngle = 0;

  function writeRotors() {
    let ccw = 0;
    let cw = 0;
    for (let k = 0; k < 4; k++) {
      const m = MOTORS[k];
      tmpQuat.setFromAxisAngle(yAxis, spinAngle * m.spin + k * 0.7);
      tmpPos.set(m.x, ARM_T, m.z);
      tmpMatrix.compose(tmpPos, tmpQuat, unitScale);
      bells.setMatrixAt(k, tmpMatrix);
      if (m.spin > 0) propsCCW.setMatrixAt(ccw++, tmpMatrix);
      else propsCW.setMatrixAt(cw++, tmpMatrix);
    }
    bells.instanceMatrix.needsUpdate = true;
    propsCCW.instanceMatrix.needsUpdate = true;
    propsCW.instanceMatrix.needsUpdate = true;
  }

  function setProps(rpm, dt = 1 / 60) {
    const r = Math.min(1, Math.max(0, Number(rpm) || 0));
    const step = Math.min(r * SPIN_MAX * Math.max(0, dt), SPIN_STEP_CAP);
    spinAngle = (spinAngle + step) % (Math.PI * 2);
    const bladeAlpha = 1 - smoothRange(0.12, 0.32, r);
    const discAlpha = smoothRange(0.08, 0.34, r);
    if (ghost) propMaterial.uniforms.uOpacity.value = 0.6 * bladeAlpha;
    else propMaterial.opacity = 0.9 * bladeAlpha;
    propsCCW.visible = bladeAlpha > 0.01;
    propsCW.visible = bladeAlpha > 0.01;
    discMaterial.opacity = discAlpha * (ghost ? 0.5 : 0.62);
    disc.visible = discAlpha > 0.01;
    writeRotors();
  }

  function setLights(on) {
    if (ledMaterial) ledMaterial.color.setScalar(on ? 1 : 0.04);
  }

  function setCameraTilt(rad) {
    camPivot.rotation.x = rad;
  }

  setProps(0, 0);

  let triangles = 0;
  group.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    const count = g.index ? g.index.count : g.attributes.position.count;
    triangles += (count / 3) * (o.isInstancedMesh ? o.count : 1);
  });

  function dispose() {
    if (group.parent) group.parent.remove(group);
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
    for (const t of textures) t.dispose();
    for (const im of [bells, propsCCW, propsCW]) im.dispose();
  }

  return {
    group,
    cameraMount: camPivot,
    meshes,
    triangles: Math.round(triangles),
    setProps,
    setLights,
    setCameraTilt,
    dispose
  };
}
