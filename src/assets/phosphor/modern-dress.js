import * as THREE from 'three';

const MINT = new THREE.Color(0.43, 0.95, 0.77);

function stripeTexture(){
  const c = document.createElement('canvas');
  c.width = 128; c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = '#16181b';
  g.fillRect(0, 0, 128, 32);
  g.fillStyle = '#e0a526';
  for (let x = -32; x < 160; x += 32){
    g.beginPath();
    g.moveTo(x, 32);
    g.lineTo(x + 16, 32);
    g.lineTo(x + 32, 0);
    g.lineTo(x + 16, 0);
    g.closePath();
    g.fill();
  }
  const img = g.getImageData(0, 0, 128, 32);
  for (let i = 0; i < img.data.length; i += 4){
    const n = (Math.random() - 0.5) * 26;
    img.data[i] = Math.max(0, Math.min(255, img.data[i] + n));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + n));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + n));
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function stencilTexture(text){
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 512, 256);
  g.fillStyle = 'rgba(232,236,232,0.92)';
  g.font = '900 170px "JetBrains Mono", "Courier New", monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, 132);
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 900; i++){
    const x = Math.random() * 512, y = Math.random() * 256, r = Math.random() * 3.2;
    g.globalAlpha = 0.35 + Math.random() * 0.5;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  g.fillRect(0, 118, 512, 6);
  for (let x = 0; x < 512; x += 120) g.fillRect(x + 92, 0, 6, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function isWall(p){
  const h = p.max[1] - p.min[1];
  const dx = p.max[0] - p.min[0];
  const dz = p.max[2] - p.min[2];
  return p.type !== 'ramp' && h >= 2.2 && Math.min(dx, dz) <= 1.4 && Math.max(dx, dz) >= 3.5;
}

function isObstacle(p){
  const h = p.max[1] - p.min[1];
  return p.type !== 'ramp' && h >= 0.25 && h < 2.2 && (p.max[0] - p.min[0]) < 12 && (p.max[2] - p.min[2]) < 12;
}

function aoTexture(){
  const c = document.createElement('canvas');
  c.width = 4; c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 64);
  grd.addColorStop(0, 'rgba(0,0,0,0.62)');
  grd.addColorStop(0.35, 'rgba(0,0,0,0.26)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 4, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function topAt(prims, x, z, below){
  let best = -Infinity;
  for (const p of prims){
    if (p.type === 'ramp') continue;
    if (x < p.min[0] - 0.01 || x > p.max[0] + 0.01 || z < p.min[2] - 0.01 || z > p.max[2] + 0.01) continue;
    if (p.max[1] <= below + 0.02 && p.max[1] > best) best = p.max[1];
  }
  return best;
}

export function buildDressing(prims, bounds, lamps){
  const group = new THREE.Group();
  group.name = 'ph-dressing';
  const capMat = new THREE.MeshStandardMaterial({ color: 0x2b3138, roughness: 0.42, metalness: 0.85 });
  const bandMat = new THREE.MeshStandardMaterial({ color: 0x1d2126, roughness: 0.55, metalness: 0.6 });
  const ribMat = new THREE.MeshStandardMaterial({ color: 0x8d8a85, roughness: 0.9, metalness: 0.05 });
  const lineMat = new THREE.MeshBasicMaterial({ color: MINT.clone().multiplyScalar(1.25), toneMapped: false });
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const caps = [], bands = [], ribs = [], lines = [];
  const put = (list, cx, cy, cz, sx, sy, sz) => { list.push(new THREE.Matrix4().compose(new THREE.Vector3(cx, cy, cz), new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz))); };
  const wallFaces = [];
  for (const p of prims){
    if (!isWall(p)) continue;
    const [x0, y0, z0] = p.min;
    const [x1, y1, z1] = p.max;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const dx = x1 - x0, dz = z1 - z0, h = y1 - y0;
    put(caps, cx, y1 + 0.05, cz, dx + 0.08, 0.1, dz + 0.08);
    put(bands, cx, y0 + 0.16, cz, dx + 0.04, 0.32, dz + 0.04);
    const alongX = dx >= dz;
    const len = alongX ? dx : dz;
    const n = Math.floor(len / 6);
    for (let i = 1; i <= n; i++){
      const t = (i / (n + 1)) * len;
      if (alongX) put(ribs, x0 + t, y0 + (h - 0.1) / 2, cz, 0.22, h - 0.1, dz + 0.12);
      else put(ribs, cx, y0 + (h - 0.1) / 2, z0 + t, dx + 0.12, h - 0.1, 0.22);
    }
    if (h >= 3.2) put(lines, cx, y1 - 0.34, cz, alongX ? dx + 0.002 : dx + 0.13, 0.035, alongX ? dz + 0.13 : dz + 0.002);
    wallFaces.push({ p, alongX, len });
  }
  const inst = (list, mat, cast) => {
    if (!list.length) return null;
    const mesh = new THREE.InstancedMesh(boxGeo, mat, list.length);
    list.forEach((mm, i) => mesh.setMatrixAt(i, mm));
    mesh.castShadow = !!cast;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  inst(caps, capMat, true);
  inst(bands, bandMat, false);
  inst(ribs, ribMat, true);
  inst(lines, lineMat, false);

  const stripes = stripeTexture();
  const stripeMat = new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.8, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const stripeGeos = [];
  for (const p of prims){
    if (!isObstacle(p)) continue;
    const [x0, , z0] = p.min;
    const [x1, y1, z1] = p.max;
    const hgt = 0.09;
    const yc = y1 - hgt / 2 - 0.005;
    const sides = [
      [[(x0 + x1) / 2, yc, z1 + 0.004], x1 - x0, 0],
      [[(x0 + x1) / 2, yc, z0 - 0.004], x1 - x0, Math.PI],
      [[x1 + 0.004, yc, (z0 + z1) / 2], z1 - z0, Math.PI / 2],
      [[x0 - 0.004, yc, (z0 + z1) / 2], z1 - z0, -Math.PI / 2]
    ];
    for (const [c, w, ry] of sides){
      const g = new THREE.PlaneGeometry(w, hgt);
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * w / 0.36);
      g.rotateY(ry);
      g.translate(c[0], c[1], c[2]);
      stripeGeos.push(g);
    }
  }
  if (stripeGeos.length){
    const merged = mergeGeometries(stripeGeos);
    const mesh = new THREE.Mesh(merged, stripeMat);
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  const aoMat = new THREE.MeshBasicMaterial({ map: aoTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const aoGeos = [];
  for (const p of prims){
    if (p.type === 'ramp') continue;
    const h = p.max[1] - p.min[1];
    if (h < 0.25) continue;
    const reach = Math.min(0.9, 0.25 + h * 0.18);
    const [x0, y0, z0] = p.min;
    const [x1, , z1] = p.max;
    const edges = [
      [x0, z1, x1, z1, 0, 1],
      [x1, z0, x0, z0, 0, -1],
      [x1, z1, x1, z0, 1, 0],
      [x0, z0, x0, z1, -1, 0]
    ];
    for (const [ax, az, bx, bz, nx, nz] of edges){
      const mx = (ax + bx) / 2 + nx * 0.05, mz = (az + bz) / 2 + nz * 0.05;
      const floor = topAt(prims, mx, mz, y0 + 0.01);
      if (!isFinite(floor) || Math.abs(floor - y0) > 0.03) continue;
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.05) continue;
      const g = new THREE.PlaneGeometry(len, reach);
      g.rotateX(-Math.PI / 2);
      g.translate(0, 0, reach / 2);
      const ang = Math.atan2(nx, nz);
      g.rotateY(ang);
      g.translate((ax + bx) / 2, y0 + 0.006, (az + bz) / 2);
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
      aoGeos.push(g);
    }
  }
  if (aoGeos.length){
    const ao = new THREE.Mesh(mergeGeometries(aoGeos), aoMat);
    ao.renderOrder = 1;
    group.add(ao);
  }

  const labels = ['A-01', 'A-02', 'B-03', 'B-04', 'C-05', 'C-06', 'D-07', 'D-08', 'E-09', 'E-10', 'F-11', 'F-12'];
  let li = 0;
  for (const wf of wallFaces){
    if (wf.len < 14 || li >= labels.length) continue;
    const p = wf.p;
    const h = p.max[1] - p.min[1];
    if (h < 3) continue;
    const count = Math.min(2, Math.floor(wf.len / 30) + 1);
    for (let k = 0; k < count && li < labels.length; k++){
      const tex = stencilTexture(labels[li++]);
      const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.9, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
      const plane = new THREE.PlaneGeometry(2.4, 1.2);
      const t = (k + 0.5) / count;
      for (const side of [-1, 1]){
        const m = new THREE.Mesh(plane, mat);
        if (wf.alongX){
          m.position.set(p.min[0] + t * (p.max[0] - p.min[0]), p.min[1] + 1.7, side > 0 ? p.max[2] + 0.005 : p.min[2] - 0.005);
          m.rotation.y = side > 0 ? 0 : Math.PI;
        } else {
          m.position.set(side > 0 ? p.max[0] + 0.005 : p.min[0] - 0.005, p.min[1] + 1.7, p.min[2] + t * (p.max[2] - p.min[2]));
          m.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
        }
        m.receiveShadow = true;
        group.add(m);
      }
    }
  }

  let top = 0;
  for (const p of prims) if (p.max[1] > top) top = p.max[1];
  const H = top + 4.2;
  const ext = [bounds.max[0] - bounds.min[0], bounds.max[2] - bounds.min[2]];
  const longZ = ext[1] >= ext[0];
  const trussMat = new THREE.MeshStandardMaterial({ color: 0x353b42, roughness: 0.5, metalness: 0.85 });
  const trussList = [];
  const placed = [];
  const along = (v) => (longZ ? v.z : v.x);
  for (const l of lamps || []){
    const a = along(l.pos);
    if (placed.some((q) => Math.abs(q - a) < 4)) continue;
    placed.push(a);
  }
  const c0 = longZ ? bounds.min[0] - 1.2 : bounds.min[2] - 1.2;
  const c1 = longZ ? bounds.max[0] + 1.2 : bounds.max[2] + 1.2;
  const span = c1 - c0;
  for (const a of placed){
    for (const dy of [0, 0.62]){
      if (longZ) put(trussList, (c0 + c1) / 2, H + dy, a, span, 0.09, 0.09);
      else put(trussList, a, H + dy, (c0 + c1) / 2, 0.09, 0.09, span);
    }
    const n = Math.max(2, Math.round(span / 0.9));
    for (let i = 0; i < n; i++){
      const u = c0 + (i + 0.5) * (span / n);
      const q = new THREE.Quaternion().setFromAxisAngle(longZ ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0), (i % 2 ? 1 : -1) * 0.95);
      const mm = new THREE.Matrix4().compose(longZ ? new THREE.Vector3(u, H + 0.31, a) : new THREE.Vector3(a, H + 0.31, u), q, new THREE.Vector3(0.05, 0.78, 0.05));
      trussList.push(mm);
    }
    for (const end of [c0, c1]){
      const ground = bounds.min[1] - 0.02;
      const colH = H + 0.7 - ground;
      if (longZ) put(trussList, end, ground + colH / 2, a, 0.32, colH, 0.32);
      else put(trussList, a, ground + colH / 2, end, 0.32, colH, 0.32);
    }
  }
  const truss = inst(trussList, trussMat, true);
  if (truss) truss.name = 'ph-gantries';
  return { group, gantryHeight: H };
}

function mergeGeometries(list){
  let total = 0;
  for (const g of list) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3);
  const nrm = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  const idx = [];
  let off = 0;
  for (const g of list){
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, off * 3);
    nrm.set(g.attributes.normal.array, off * 3);
    uv.set(g.attributes.uv.array, off * 2);
    const gi = g.index ? g.index.array : null;
    if (gi) for (let i = 0; i < gi.length; i++) idx.push(gi[i] + off);
    off += n;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(idx);
  return out;
}

export function addFloorJoints(material, spacing){
  const S = spacing || 4;
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey ? material.customProgramCacheKey.bind(material) : null;
  material.customProgramCacheKey = () => (prevKey ? prevKey() : '') + '|joints' + S;
  material.onBeforeCompile = (shader, renderer) => {
    if (typeof prev === 'function') prev(shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vJointPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvJointPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vJointPos;')
      .replace('#include <map_fragment>', `#include <map_fragment>
{
  vec2 jp = vJointPos.xz / ${S.toFixed(1)};
  vec2 jd = abs(fract(jp) - 0.5);
  vec2 fw = fwidth(jp) * 1.2 + 0.0015;
  float lx = smoothstep(0.5 - 0.005 - fw.x, 0.5 - 0.005, jd.x);
  float lz = smoothstep(0.5 - 0.005 - fw.y, 0.5 - 0.005, jd.y);
  float line = max(lx, lz);
  diffuseColor.rgb *= mix(1.0, 0.55, line);
}`);
  };
  material.needsUpdate = true;
}
