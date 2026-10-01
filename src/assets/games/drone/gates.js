import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const MINT = new THREE.Color('#6ef3c5');
const UPCOMING = new THREE.Color(0.5, 0.68, 1.0);
const PASSED = new THREE.Color(0.04, 0.045, 0.052);
const UPCOMING_GAIN = 0.8;
const PASSED_GAIN = 1;
const PLATE_CELLS = 8;
const LOGO_URL = '/assets/games/sprites/logo-skyrush.webp';

const STYLE = {
  square: { pad: 0.32, depth: 0.38, bevel: 0.1, r: 0.18, seg: 4 },
  arch: { pad: 0.38, depth: 0.44, bevel: 0.14, r: 0.2, seg: 5 },
  finish: { pad: 0.58, depth: 0.62, bevel: 0.17, r: 0.6, seg: 4 }
};

function V(x, y) {
  return new THREE.Vector2(x, y);
}

function topProfile(kind, hw, top, r, seg) {
  const pts = [];
  if (kind === 'arch') {
    const n = seg * 3;
    for (let i = 0; i <= n; i++) {
      const a = (Math.PI * i) / n;
      pts.push(V(hw * Math.cos(a), top - r + r * Math.sin(a)));
    }
  } else {
    for (let i = 0; i <= seg; i++) {
      const a = (Math.PI / 2) * (i / seg);
      pts.push(V(hw - r + r * Math.cos(a), top - r + r * Math.sin(a)));
    }
    for (let i = 0; i <= seg; i++) {
      const a = Math.PI / 2 + (Math.PI / 2) * (i / seg);
      pts.push(V(-hw + r + r * Math.cos(a), top - r + r * Math.sin(a)));
    }
  }
  return pts;
}

function closedOutline(kind, hw, bottom, top, r, rb, seg) {
  const pts = topProfile(kind, hw, top, r, seg);
  for (let i = 0; i <= seg; i++) {
    const a = Math.PI + (Math.PI / 2) * (i / seg);
    pts.push(V(-hw + rb + rb * Math.cos(a), bottom + rb + rb * Math.sin(a)));
  }
  for (let i = 0; i <= seg; i++) {
    const a = Math.PI * 1.5 + (Math.PI / 2) * (i / seg);
    pts.push(V(hw - rb + rb * Math.cos(a), bottom + rb + rb * Math.sin(a)));
  }
  return pts;
}

function openOutline(kind, hw, top, r, seg, bottomR, bottomL) {
  return [V(hw, bottomR), ...topProfile(kind, hw, top, r, seg), V(-hw, bottomL)];
}

function addUv(g) {
  if (!g.attributes.uv) {
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  }
  return g;
}

function plain(geo) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  addUv(g);
  g.clearGroups();
  return g;
}

function paddedExtrude(shape, depth, bevel) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(depth - bevel * 2, 0.001),
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: -bevel,
    bevelSegments: 3,
    curveSegments: 4
  });
  g.translate(0, 0, -(depth / 2 - bevel));
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  const merged = mergeVertices(g, 1e-5);
  g.dispose();
  merged.computeVertexNormals();
  const out = merged.toNonIndexed();
  merged.dispose();
  return addUv(out);
}

function bandPositions(points, closed, z0, z1) {
  const out = [];
  const n = points.length;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    out.push(a.x, a.y, z0, b.x, b.y, z0, b.x, b.y, z1);
    out.push(a.x, a.y, z0, b.x, b.y, z1, a.x, a.y, z1);
  }
  return out;
}

function ribbonPositions(inner, outer, closed, z) {
  const out = [];
  const n = inner.length;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const j = (i + 1) % n;
    const a = inner[i], b = inner[j], c = outer[j], d = outer[i];
    out.push(a.x, a.y, z, b.x, b.y, z, c.x, c.y, z);
    out.push(a.x, a.y, z, c.x, c.y, z, d.x, d.y, z);
  }
  return out;
}

function geometryPositions(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const arr = Array.from(g.attributes.position.array);
  if (g !== geo) g.dispose();
  geo.dispose();
  return arr;
}

function plateAtlas() {
  const cell = 64;
  const size = cell * PLATE_CELLS;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#101317';
  ctx.fillRect(0, 0, size, size);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let n = 1; n <= PLATE_CELLS * PLATE_CELLS; n++) {
    const col = (n - 1) % PLATE_CELLS;
    const row = Math.floor((n - 1) / PLATE_CELLS);
    const x = col * cell;
    const y = row * cell;
    ctx.fillStyle = '#6ef3c5';
    ctx.fillRect(x + 3, y + 3, cell - 6, cell - 6);
    ctx.fillStyle = '#0f1216';
    ctx.fillRect(x + 7, y + 7, cell - 14, cell - 14);
    ctx.fillStyle = '#f4f7f8';
    ctx.font = '700 ' + (n > 9 ? 30 : 38) + 'px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillText(String(n), x + cell / 2, y + cell / 2 + 2);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function plateQuads(n, half, z) {
  const k = Math.max(1, Math.min(PLATE_CELLS * PLATE_CELLS, n)) - 1;
  const col = k % PLATE_CELLS;
  const row = Math.floor(k / PLATE_CELLS);
  const u0 = col / PLATE_CELLS;
  const u1 = (col + 1) / PLATE_CELLS;
  const v1 = 1 - row / PLATE_CELLS;
  const v0 = 1 - (row + 1) / PLATE_CELLS;
  const s = half;
  const pos = [
    -s, -s, z, s, -s, z, s, s, z, -s, -s, z, s, s, z, -s, s, z,
    s, -s, -z, -s, -s, -z, -s, s, -z, s, -s, -z, -s, s, -z, s, s, -z
  ];
  const nor = [];
  for (let i = 0; i < 6; i++) nor.push(0, 0, 1);
  for (let i = 0; i < 6; i++) nor.push(0, 0, -1);
  const uv = [
    u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1,
    u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

function stripeTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ebe7df';
  ctx.fillRect(0, 0, 16, 128);
  ctx.fillStyle = '#c4232d';
  ctx.fillRect(0, 0, 16, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function fabricTexture() {
  const w = 128;
  const h = 512;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#20252e');
  g.addColorStop(1, '#14171c');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#6ef3c5';
  for (let y = 40; y < h - 30; y += 70) {
    ctx.beginPath();
    ctx.moveTo(w * 0.78, y);
    ctx.lineTo(w * 0.42, y + 22);
    ctx.lineTo(w * 0.78, y + 44);
    ctx.lineTo(w * 0.78, y + 32);
    ctx.lineTo(w * 0.58, y + 22);
    ctx.lineTo(w * 0.78, y + 12);
    ctx.closePath();
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function bannerTexture() {
  const w = 1024;
  const h = 160;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0e1013';
  ctx.fillRect(0, 0, w, h);
  const sq = 20;
  for (const y0 of [0, h - sq * 2]) {
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < w / sq; col++) {
        ctx.fillStyle = (row + col) % 2 ? '#f2f4f5' : '#0e1013';
        ctx.fillRect(col * sq, y0 + row * sq, sq, sq);
      }
    }
  }
  ctx.fillStyle = '#6ef3c5';
  ctx.fillRect(0, sq * 2, w, 3);
  ctx.fillRect(0, h - sq * 2 - 3, w, 3);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const cx = w / 2 + side * (w * 0.3 + i * 34);
      ctx.beginPath();
      ctx.moveTo(cx - side * 12, h / 2 - 18);
      ctx.lineTo(cx + side * 10, h / 2);
      ctx.lineTo(cx - side * 12, h / 2 + 18);
      ctx.lineTo(cx - side * 4, h / 2);
      ctx.closePath();
      ctx.fill();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  if (typeof Image !== 'undefined') {
    const img = new Image();
    img.onload = () => {
      const maxH = h - sq * 4 - 16;
      const maxW = w * 0.5;
      const scale = Math.min(maxW / img.width, maxH / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
      tex.needsUpdate = true;
    };
    img.onerror = () => {};
    img.src = LOGO_URL;
  }
  return tex;
}

function fillMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: MINT.clone() },
      uSize: { value: new THREE.Vector2(3, 3) },
      uArch: { value: 0 }
    },
    vertexShader: [
      'varying vec2 vUv;',
      'void main() {',
      'vUv = uv;',
      'gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
      '}'
    ].join('\n'),
    fragmentShader: [
      'uniform float uTime;',
      'uniform vec3 uColor;',
      'uniform vec2 uSize;',
      'uniform float uArch;',
      'varying vec2 vUv;',
      'void main() {',
      'vec2 p = (vUv - 0.5) * uSize;',
      'vec2 h = uSize * 0.5;',
      'float edge = min(h.x - abs(p.x), h.y - abs(p.y));',
      'if (uArch > 0.5) {',
      'float cy = h.y - h.x;',
      'if (p.y > cy) edge = min(edge, h.x - length(vec2(p.x, p.y - cy)));',
      '}',
      'if (edge < 0.0) discard;',
      'float d = clamp(1.0 - edge / min(h.x, h.y), 0.0, 1.0);',
      'float glow = smoothstep(0.55, 0.0, edge) * 0.55;',
      'float rings = smoothstep(0.82, 1.0, fract(d * 2.5 + uTime * 0.9));',
      'float a = 0.035 + glow + rings * 0.16 * d;',
      'gl_FragColor = vec4(uColor, a);',
      '#include <tonemapping_fragment>',
      '#include <colorspace_fragment>',
      '}'
    ].join('\n'),
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending
  });
}

export function createGates(scene, gates, { heightAt } = {}) {
  const list = Array.isArray(gates) ? gates : [];
  const groundAt = typeof heightAt === 'function' ? heightAt : () => 0;
  const group = new THREE.Group();
  group.name = 'gates';
  const buckets = { padding: [], metal: [], fabric: [], pylon: [], plate: [], banner: [] };
  const ledPositions = [];
  const ranges = [];
  const fillSpecs = [];
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const one = new THREE.Vector3(1, 1, 1);
  const tmp = new THREE.Vector3();

  const putGeo = (key, geo, m) => {
    const g = plain(geo);
    if (m) g.applyMatrix4(m);
    buckets[key].push(g);
  };
  const putLed = (arr, m) => {
    for (let i = 0; i < arr.length; i += 3) {
      tmp.set(arr[i], arr[i + 1], arr[i + 2]);
      if (m) tmp.applyMatrix4(m);
      ledPositions.push(tmp.x, tmp.y, tmp.z);
    }
  };
  const localGround = (m, lx, lz, posY) => {
    tmp.set(lx, 0, lz).applyMatrix4(m);
    return groundAt(tmp.x, tmp.z) - posY;
  };

  list.forEach((gate, index) => {
    const pos = Array.isArray(gate.pos) ? gate.pos : [gate.pos.x, gate.pos.y, gate.pos.z];
    const w = gate.w || 3;
    const h = gate.h || 3;
    const yaw = gate.yaw || 0;
    const pitch = gate.pitch || 0;
    const type = gate.finish ? 'finish' : (gate.type || 'square');
    euler.set(pitch, yaw, 0, 'YXZ');
    quat.setFromEuler(euler);
    matrix.compose(new THREE.Vector3(pos[0], pos[1], pos[2]), quat, one);
    const m = matrix.clone();
    const level = Math.abs(pitch) < 0.02;
    const hw = w / 2;
    const hh = h / 2;
    const ledStart = ledPositions.length / 3;
    const number = index + 1;
    let plateY = hh + 0.6;
    let plateXs = [0];

    if (type === 'square' || type === 'arch' || type === 'finish') {
      const st = STYLE[type];
      const kind = type === 'arch' ? 'arch' : 'flat';
      const r = type === 'arch' ? Math.min(hw, h * 0.75) : st.r;
      const rb = 0.12;
      const groundL = level ? localGround(m, -hw - st.pad / 2, 0, pos[1]) : -hh - 1;
      const groundR = level ? localGround(m, hw + st.pad / 2, 0, pos[1]) : -hh - 1;
      const openBottom = type !== 'square' && level && Math.max(groundL, groundR) > -hh - 0.6;
      const inset = 0.008;
      if (openBottom) {
        const bl = groundL - 0.3;
        const br = groundR - 0.3;
        const outer = openOutline(kind, hw + st.pad, hh + st.pad, r + st.pad, st.seg, br, bl);
        const inner = openOutline(kind, hw, hh, r, st.seg, br, bl);
        const shape = new THREE.Shape(outer.concat(inner.slice().reverse()));
        putGeo('padding', paddedExtrude(shape, st.depth, st.bevel), m);
        const lift = 0.35;
        const ledInner = openOutline(kind, hw - inset, hh - inset, r - inset, st.seg, groundR + lift, groundL + lift);
        putLed(bandPositions(ledInner, false, -st.depth * 0.22, st.depth * 0.22), m);
        const d0 = st.bevel + 0.025;
        const d1 = d0 + 0.045;
        const ribIn = openOutline(kind, hw + d0, hh + d0, r + d0, st.seg, groundR + lift, groundL + lift);
        const ribOut = openOutline(kind, hw + d1, hh + d1, r + d1, st.seg, groundR + lift, groundL + lift);
        for (const z of [st.depth / 2 + 0.006, -st.depth / 2 - 0.006]) putLed(ribbonPositions(ribIn, ribOut, false, z), m);
      } else {
        const outer = closedOutline(kind, hw + st.pad, -hh - st.pad, hh + st.pad, r + st.pad, rb + st.pad, st.seg);
        const inner = closedOutline(kind, hw, -hh, hh, r, rb, st.seg);
        const shape = new THREE.Shape(outer);
        shape.holes.push(new THREE.Path(inner));
        putGeo('padding', paddedExtrude(shape, st.depth, st.bevel), m);
        const ledInner = closedOutline(kind, hw - inset, -hh + inset, hh - inset, r - inset, rb - inset, st.seg);
        putLed(bandPositions(ledInner, true, -st.depth * 0.22, st.depth * 0.22), m);
        const d0 = st.bevel + 0.025;
        const d1 = d0 + 0.045;
        const ribIn = closedOutline(kind, hw + d0, -hh - d0, hh + d0, r + d0, rb + d0, st.seg);
        const ribOut = closedOutline(kind, hw + d1, -hh - d1, hh + d1, r + d1, rb + d1, st.seg);
        for (const z of [st.depth / 2 + 0.006, -st.depth / 2 - 0.006]) putLed(ribbonPositions(ribIn, ribOut, true, z), m);
        const frameBottom = -hh - st.pad + st.bevel;
        if (level) {
          for (const sx of [-1, 1]) {
            const lx = sx * (hw + st.pad / 2);
            const g = localGround(m, lx, 0, pos[1]);
            const len = frameBottom - g;
            if (len > 0.05) {
              const col = new THREE.BoxGeometry(st.pad * 0.62, len + 0.45, st.depth * 0.62);
              col.translate(lx, g + (len + 0.45) / 2 - 0.3, 0);
              putGeo('padding', col, m);
              const foot = new THREE.BoxGeometry(0.55, 0.12, 1.1);
              foot.translate(lx, g + 0.03, 0);
              putGeo('metal', foot, m);
              if (len > 1.2) {
                const ring = new THREE.CylinderGeometry(st.pad * 0.48, st.pad * 0.48, 0.06, 12, 1, true);
                const ringY = g + Math.min(len - 0.3, 1.1);
                ring.translate(lx, ringY, 0);
                putLed(geometryPositions(ring), m);
              }
            }
          }
        } else {
          tmp.set(0, -hh - st.pad, 0).applyMatrix4(m);
          const g = groundAt(tmp.x, tmp.z);
          const len = tmp.y - g;
          if (len > 0.05) {
            const pole = new THREE.CylinderGeometry(0.07, 0.09, len + 0.5, 10, 1, false);
            pole.translate(tmp.x, g + (len + 0.5) / 2 - 0.3, tmp.z);
            putGeo('metal', pole, null);
          }
        }
      }
      plateY = hh + st.pad + 0.38;
      if (type === 'finish') {
        const bw = w + st.pad * 2 - 0.1;
        const bh = Math.max(1.1, Math.min(1.8, w * 0.17));
        const banner = new THREE.BoxGeometry(bw, bh, st.depth * 0.5);
        banner.translate(0, hh + st.pad + bh / 2 - 0.12, 0);
        putGeo('banner', banner, m);
        const strip = [];
        const sy = hh + st.pad - 0.12 + bh - 0.16;
        for (const z of [st.depth * 0.25 + 0.01, -st.depth * 0.25 - 0.01]) {
          strip.push(-bw / 2, sy, z, bw / 2, sy, z, bw / 2, sy + 0.06, z);
          strip.push(-bw / 2, sy, z, bw / 2, sy + 0.06, z, -bw / 2, sy + 0.06, z);
        }
        putLed(strip, m);
      }
    } else if (type === 'flag') {
      plateXs = [];
      for (const sx of [-1, 1]) {
        const lx = sx * hw;
        const g = localGround(m, lx, 0, pos[1]);
        const top = hh + 0.9;
        const poleLen = top - g + 0.3;
        const pole = new THREE.CylinderGeometry(0.035, 0.045, poleLen, 8, 1, false);
        pole.translate(lx, g - 0.3 + poleLen / 2, 0);
        putLed(geometryPositions(pole), m);
        const base = new THREE.CylinderGeometry(0.32, 0.38, 0.12, 12, 1, false);
        base.translate(lx, g + 0.03, 0);
        putGeo('metal', base, m);
        const fabricBottom = Math.max(g + 0.7, top - 6.5);
        const fh = top - 0.05 - fabricBottom;
        const fw = Math.min(1.0, Math.max(0.6, fh * 0.2));
        const cols = 4;
        const rows = 12;
        const fpos = [];
        const fuv = [];
        const idx = [];
        for (let j = 0; j <= rows; j++) {
          const v = j / rows;
          let width;
          if (v < 0.8) width = 0.28 + 0.72 * Math.sin((Math.PI / 2) * (v / 0.8));
          else width = Math.sqrt(Math.max(0, 1 - ((v - 0.8) / 0.2) ** 2));
          for (let i = 0; i <= cols; i++) {
            const u = i / cols;
            const x = lx + sx * (0.04 + u * width * fw);
            const y = fabricBottom + v * fh;
            const z = 0.06 * Math.sin(Math.PI * u) * (0.6 + 0.4 * Math.sin(v * 5.0 + sx));
            fpos.push(x, y, z);
            fuv.push(u * width, v);
          }
        }
        for (let j = 0; j < rows; j++) {
          for (let i = 0; i < cols; i++) {
            const a = j * (cols + 1) + i;
            const b = a + 1;
            const c = a + cols + 2;
            const d = a + cols + 1;
            idx.push(a, b, c, a, c, d);
          }
        }
        const fg = new THREE.BufferGeometry();
        fg.setAttribute('position', new THREE.Float32BufferAttribute(fpos, 3));
        fg.setAttribute('uv', new THREE.Float32BufferAttribute(fuv, 2));
        fg.setIndex(idx);
        fg.computeVertexNormals();
        putGeo('fabric', fg, m);
        plateXs.push(lx);
      }
      plateY = hh + 1.3;
    } else if (type === 'pylon') {
      const side = gate.side === 'left' ? -1 : 1;
      const lx = side * hw;
      const g = localGround(m, lx, 0, pos[1]);
      const top = hh + 1.4;
      const height = top - g + 0.3;
      const rBottom = 0.46;
      const rTop = 0.3;
      const tower = new THREE.CylinderGeometry(rTop, rBottom, height, 18, 1, false);
      const uv = tower.attributes.uv;
      const bands = Math.max(2, Math.round(height / 1.6));
      for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * bands);
      tower.translate(lx, g - 0.3 + height / 2, 0);
      putGeo('pylon', tower, m);
      const cap = new THREE.SphereGeometry(rTop, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2);
      cap.translate(lx, g - 0.3 + height, 0);
      putGeo('pylon', cap, m);
      const ringCount = Math.max(2, Math.floor((top - g) / 2.2));
      for (let k = 1; k <= ringCount; k++) {
        const y = g + ((top - g) * k) / (ringCount + 0.5);
        const t = (y - (g - 0.3)) / height;
        const radius = rBottom + (rTop - rBottom) * t + 0.02;
        const ring = new THREE.TorusGeometry(radius, 0.04, 6, 28);
        ring.rotateX(Math.PI / 2);
        ring.translate(lx, y, 0);
        putLed(geometryPositions(ring), m);
      }
      plateXs = [lx];
      plateY = top + 0.74;
    }

    if (type !== 'finish') {
      for (const px of plateXs) {
        const back = new THREE.BoxGeometry(0.82, 0.82, 0.07);
        back.translate(px, plateY, 0);
        putGeo('padding', back, m);
        const quads = plateQuads(number, 0.37, 0.037);
        quads.translate(px, plateY, 0);
        putGeo('plate', quads, m);
      }
    }

    const ledCount = ledPositions.length / 3 - ledStart;
    ranges.push({ start: ledStart, count: ledCount });
    fillSpecs.push({
      position: new THREE.Vector3(pos[0], pos[1], pos[2]),
      quaternion: quat.clone(),
      w,
      h,
      arch: type === 'arch'
    });
  });

  const textures = [];
  const materials = [];
  const meshes = [];
  const geometries = [];

  const stripes = stripeTexture();
  const fabric = fabricTexture();
  const atlas = plateAtlas();
  const banner = bannerTexture();
  textures.push(stripes, fabric, atlas, banner);
  const mats = {
    padding: new THREE.MeshStandardMaterial({ color: 0x1a1d23, roughness: 0.86, metalness: 0.0 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x3a3e45, roughness: 0.45, metalness: 0.75 }),
    fabric: new THREE.MeshStandardMaterial({ map: fabric, roughness: 0.82, side: THREE.DoubleSide }),
    pylon: new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.55 }),
    plate: new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.6, emissive: 0xffffff, emissiveMap: atlas, emissiveIntensity: 0.45 }),
    banner: new THREE.MeshStandardMaterial({ map: banner, roughness: 0.7, emissive: 0xffffff, emissiveMap: banner, emissiveIntensity: 0.3 })
  };
  for (const key of Object.keys(buckets)) {
    const parts = buckets[key];
    if (!parts.length) {
      mats[key].dispose();
      continue;
    }
    const geo = mergeGeometries(parts, false);
    parts.forEach((p) => p.dispose());
    const mesh = new THREE.Mesh(geo, mats[key]);
    mesh.name = 'gates-' + key;
    mesh.castShadow = key !== 'plate';
    mesh.receiveShadow = key === 'padding' || key === 'banner';
    group.add(mesh);
    meshes.push(mesh);
    geometries.push(geo);
    materials.push(mats[key]);
  }

  const ledGeo = new THREE.BufferGeometry();
  const ledArray = new Float32Array(ledPositions);
  ledGeo.setAttribute('position', new THREE.BufferAttribute(ledArray, 3));
  const colorArray = new Float32Array(ledArray.length);
  const colorAttr = new THREE.BufferAttribute(colorArray, 3);
  colorAttr.setUsage(THREE.DynamicDrawUsage);
  ledGeo.setAttribute('color', colorAttr);
  const ledMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, toneMapped: true });
  const ledMesh = new THREE.Mesh(ledGeo, ledMaterial);
  ledMesh.name = 'gates-led';
  group.add(ledMesh);
  meshes.push(ledMesh);
  geometries.push(ledGeo);
  materials.push(ledMaterial);

  const fillGeo = new THREE.PlaneGeometry(1, 1);
  const fillMat = fillMaterial();
  const fill = new THREE.Mesh(fillGeo, fillMat);
  fill.name = 'gates-fill';
  fill.visible = false;
  fill.renderOrder = 5;
  group.add(fill);
  meshes.push(fill);
  geometries.push(fillGeo);
  materials.push(fillMat);

  const states = list.map(() => 'upcoming');
  let current = -1;
  let pulse = 1;

  function paint(i, color, gain) {
    const r = ranges[i];
    if (!r || r.count === 0) return;
    const cr = color.r * gain;
    const cg = color.g * gain;
    const cb = color.b * gain;
    for (let v = r.start; v < r.start + r.count; v++) {
      colorArray[v * 3] = cr;
      colorArray[v * 3 + 1] = cg;
      colorArray[v * 3 + 2] = cb;
    }
    colorAttr.addUpdateRange(r.start * 3, r.count * 3);
    colorAttr.needsUpdate = true;
  }

  function paintState(i) {
    const s = states[i];
    if (s === 'next') paint(i, MINT, 1.5 + 1.3 * pulse);
    else if (s === 'passed') paint(i, PASSED, PASSED_GAIN);
    else paint(i, UPCOMING, UPCOMING_GAIN);
  }

  function placeFill(i) {
    if (i < 0 || i >= fillSpecs.length) {
      fill.visible = false;
      return;
    }
    const f = fillSpecs[i];
    fill.position.copy(f.position);
    fill.quaternion.copy(f.quaternion);
    fill.scale.set(f.w, f.h, 1);
    fillMat.uniforms.uSize.value.set(f.w, f.h);
    fillMat.uniforms.uArch.value = f.arch ? 1 : 0;
    fill.visible = true;
  }

  function highlight(i) {
    if (current >= 0 && current < states.length && states[current] === 'next') {
      states[current] = 'upcoming';
      paintState(current);
    }
    current = Number.isInteger(i) && i >= 0 && i < states.length ? i : -1;
    if (current >= 0) {
      states[current] = 'next';
      paintState(current);
    }
    placeFill(current);
  }

  function passed(i) {
    if (!Number.isInteger(i) || i < 0 || i >= states.length) return;
    states[i] = 'passed';
    paintState(i);
    if (i === current) {
      current = -1;
      placeFill(-1);
    }
  }

  function reset() {
    current = -1;
    for (let i = 0; i < states.length; i++) {
      states[i] = 'upcoming';
      paintState(i);
    }
    placeFill(-1);
  }

  function update(t) {
    const time = Number(t) || 0;
    pulse = 0.5 + 0.5 * Math.sin(time * 6.5);
    fillMat.uniforms.uTime.value = time;
    if (current >= 0) paintState(current);
  }

  function setVisible(on) {
    group.visible = !!on;
  }

  reset();
  if (scene) scene.add(group);

  function dispose() {
    if (group.parent) group.parent.remove(group);
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
    for (const t of textures) t.dispose();
  }

  return { meshes, group, highlight, passed, reset, update, setVisible, dispose };
}
