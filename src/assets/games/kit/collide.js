const COLLIDE_EPS = 1e-12;
const COLLIDE_KEY_OFF = 32768;
const COLLIDE_KEY_MUL = 65536;
const COLLIDE_CELL_LIMIT = 32767;
const COLLIDE_BIG_CELLS = 65536;
const COLLIDE_FD = 0.5;
const COLLIDE_MAX_RAY = 100000;

function collideNum(v, d) {
  return typeof v === 'number' && v === v && v !== Infinity && v !== -Infinity ? v : d;
}

function collideFinite(v) {
  return typeof v === 'number' && v === v && v !== Infinity && v !== -Infinity;
}

function collideCompX(a) {
  if (Array.isArray(a)) return a[0];
  return a ? a.x : NaN;
}

function collideCompY(a) {
  if (Array.isArray(a)) return a[1];
  return a ? a.y : NaN;
}

function collideCompZ(a) {
  if (Array.isArray(a)) return a[2];
  return a ? a.z : NaN;
}

function collideMakeContact() {
  return { hit: false, normal: { x: 0, y: 1, z: 0 }, depth: 0, kind: '', id: null };
}

function collidePrepOut(out) {
  if (!out || typeof out !== 'object') return collideMakeContact();
  if (!out.normal || typeof out.normal !== 'object') out.normal = { x: 0, y: 1, z: 0 };
  return out;
}

function collideFill(out, nx, ny, nz, depth, kind, id) {
  out.hit = true;
  out.normal.x = nx;
  out.normal.y = ny;
  out.normal.z = nz;
  out.depth = depth;
  out.kind = kind;
  out.id = id;
  return out;
}

function collideCopy(dst, src) {
  dst.hit = src.hit;
  dst.normal.x = src.normal.x;
  dst.normal.y = src.normal.y;
  dst.normal.z = src.normal.z;
  dst.depth = src.depth;
  dst.kind = src.kind;
  dst.id = src.id;
  return dst;
}

function collideBoxFrom(spec, id) {
  if (!spec || typeof spec !== 'object') return null;
  const c = spec.center;
  const h = spec.half;
  const cx = collideCompX(c), cy = collideCompY(c), cz = collideCompZ(c);
  const hx = Math.abs(collideCompX(h)), hy = Math.abs(collideCompY(h)), hz = Math.abs(collideCompZ(h));
  if (!collideFinite(cx) || !collideFinite(cy) || !collideFinite(cz)) return null;
  if (!collideFinite(hx) || !collideFinite(hy) || !collideFinite(hz)) return null;
  const yaw = collideNum(spec.yaw, 0);
  const cs = Math.cos(yaw);
  const sn = Math.sin(yaw);
  const ex = Math.abs(cs) * hx + Math.abs(sn) * hz;
  const ez = Math.abs(sn) * hx + Math.abs(cs) * hz;
  return {
    id, kind: 'box', cx, cy, cz, hx, hy, hz, yaw, cs, sn,
    minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez,
    keys: null, big: false, stamp: 0
  };
}

function collideCylFrom(spec, id) {
  if (!spec || typeof spec !== 'object') return null;
  const x = spec.x, z = spec.z;
  const rad = Math.abs(spec.radius);
  let y0 = spec.y0, y1 = spec.y1;
  if (!collideFinite(x) || !collideFinite(z) || !collideFinite(rad)) return null;
  if (!collideFinite(y0) || !collideFinite(y1)) return null;
  if (y0 > y1) {
    const t = y0; y0 = y1; y1 = t;
  }
  return {
    id, kind: 'cyl', x, z, rad, y0, y1,
    minX: x - rad, maxX: x + rad, minZ: z - rad, maxZ: z + rad,
    keys: null, big: false, stamp: 0
  };
}

function collideSphereFrom(spec, id) {
  if (!spec || typeof spec !== 'object') return null;
  const c = spec.center;
  const cx = collideCompX(c), cy = collideCompY(c), cz = collideCompZ(c);
  const rad = Math.abs(spec.radius);
  if (!collideFinite(cx) || !collideFinite(cy) || !collideFinite(cz) || !collideFinite(rad)) return null;
  return {
    id, kind: 'sphere', cx, cy, cz, rad,
    minX: cx - rad, maxX: cx + rad, minZ: cz - rad, maxZ: cz + rad,
    keys: null, big: false, stamp: 0
  };
}

function collideBoxCore(b, px, py, pz, r, out) {
  const dx = px - b.cx, dy = py - b.cy, dz = pz - b.cz;
  const lx = dx * b.cs - dz * b.sn;
  const lz = dx * b.sn + dz * b.cs;
  const ly = dy;
  const qx = lx < -b.hx ? -b.hx : lx > b.hx ? b.hx : lx;
  const qy = ly < -b.hy ? -b.hy : ly > b.hy ? b.hy : ly;
  const qz = lz < -b.hz ? -b.hz : lz > b.hz ? b.hz : lz;
  const ex = lx - qx, ey = ly - qy, ez = lz - qz;
  const d2 = ex * ex + ey * ey + ez * ez;
  let lnx = 0, lny = 0, lnz = 0, depth;
  if (d2 > 1e-18) {
    if (d2 >= r * r) return false;
    const d = Math.sqrt(d2);
    lnx = ex / d; lny = ey / d; lnz = ez / d;
    depth = r - d;
  } else {
    const pxp = b.hx - Math.abs(lx);
    const pyp = b.hy - Math.abs(ly);
    const pzp = b.hz - Math.abs(lz);
    if (pxp <= pyp && pxp <= pzp) {
      lnx = lx < 0 ? -1 : 1;
      depth = pxp + r;
    } else if (pyp <= pzp) {
      lny = ly < 0 ? -1 : 1;
      depth = pyp + r;
    } else {
      lnz = lz < 0 ? -1 : 1;
      depth = pzp + r;
    }
  }
  const nx = lnx * b.cs + lnz * b.sn;
  const nz = -lnx * b.sn + lnz * b.cs;
  collideFill(out, nx, lny, nz, depth, 'box', b.id);
  return true;
}

function collideCylCore(c, px, py, pz, r, out) {
  const dx = px - c.x, dz = pz - c.z;
  const d2 = dx * dx + dz * dz;
  const d = Math.sqrt(d2);
  const inY = py >= c.y0 && py <= c.y1;
  if (d <= c.rad && inY) {
    const side = c.rad - d;
    const top = c.y1 - py;
    const bottom = py - c.y0;
    if (side <= top && side <= bottom) {
      let nx = 1, nz = 0;
      if (d > 1e-9) { nx = dx / d; nz = dz / d; }
      collideFill(out, nx, 0, nz, side + r, 'cyl', c.id);
    } else if (top <= bottom) {
      collideFill(out, 0, 1, 0, top + r, 'cyl', c.id);
    } else {
      collideFill(out, 0, -1, 0, bottom + r, 'cyl', c.id);
    }
    return true;
  }
  let qx = px, qz = pz;
  if (d > c.rad) {
    const k = c.rad / d;
    qx = c.x + dx * k;
    qz = c.z + dz * k;
  }
  const qy = py < c.y0 ? c.y0 : py > c.y1 ? c.y1 : py;
  const ex = px - qx, ey = py - qy, ez = pz - qz;
  const e2 = ex * ex + ey * ey + ez * ez;
  if (e2 >= r * r) return false;
  if (e2 < 1e-18) {
    if (py > c.y1) collideFill(out, 0, 1, 0, r, 'cyl', c.id);
    else if (py < c.y0) collideFill(out, 0, -1, 0, r, 'cyl', c.id);
    else if (d > 1e-9) collideFill(out, dx / d, 0, dz / d, r, 'cyl', c.id);
    else collideFill(out, 1, 0, 0, r, 'cyl', c.id);
    return true;
  }
  const e = Math.sqrt(e2);
  collideFill(out, ex / e, ey / e, ez / e, r - e, 'cyl', c.id);
  return true;
}

function collideSphereCore(s, px, py, pz, r, out) {
  const dx = px - s.cx, dy = py - s.cy, dz = pz - s.cz;
  const d2 = dx * dx + dy * dy + dz * dz;
  const rr = r + s.rad;
  if (d2 >= rr * rr) return false;
  const d = Math.sqrt(d2);
  if (d < 1e-9) {
    collideFill(out, 0, 1, 0, rr, 'sphere', s.id);
    return true;
  }
  collideFill(out, dx / d, dy / d, dz / d, rr - d, 'sphere', s.id);
  return true;
}

function collideTerrainNormal(heightAt, normalAt, x, z, out) {
  if (normalAt) {
    const res = normalAt(x, z, out);
    const n = res && typeof res === 'object' ? res : out;
    const l = Math.sqrt(n.x * n.x + n.y * n.y + n.z * n.z);
    if (l > 1e-9 && collideFinite(l)) {
      out.x = n.x / l; out.y = n.y / l; out.z = n.z / l;
      return out;
    }
  }
  const e = COLLIDE_FD;
  const hx = heightAt(x + e, z) - heightAt(x - e, z);
  const hz = heightAt(x, z + e) - heightAt(x, z - e);
  const nx = -hx, ny = 2 * e, nz = -hz;
  const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (!(l > 1e-12) || !collideFinite(l)) {
    out.x = 0; out.y = 1; out.z = 0;
    return out;
  }
  out.x = nx / l; out.y = ny / l; out.z = nz / l;
  return out;
}

function collideTerrainCore(heightAt, normalAt, px, py, pz, r, out, nTmp) {
  const h = heightAt(px, pz);
  if (!collideFinite(h)) return false;
  const n = collideTerrainNormal(heightAt, normalAt, px, pz, nTmp);
  const s = (py - h) * n.y;
  const depth = r - s;
  if (!(depth > 0)) return false;
  collideFill(out, n.x, n.y, n.z, depth, 'terrain', -1);
  return true;
}

function collideTest(col, px, py, pz, r, out) {
  if (col.kind === 'box') return collideBoxCore(col, px, py, pz, r, out);
  if (col.kind === 'cyl') return collideCylCore(col, px, py, pz, r, out);
  return collideSphereCore(col, px, py, pz, r, out);
}

function collideRayBox(b, ox, oy, oz, dx, dy, dz, nOut) {
  const rx = ox - b.cx, rz = oz - b.cz;
  const lox = rx * b.cs - rz * b.sn;
  const loz = rx * b.sn + rz * b.cs;
  const loy = oy - b.cy;
  const ldx = dx * b.cs - dz * b.sn;
  const ldz = dx * b.sn + dz * b.cs;
  const ldy = dy;
  let tmin = -Infinity, tmax = Infinity, axis = -1, sgn = 0;
  if (Math.abs(ldx) < COLLIDE_EPS) {
    if (lox < -b.hx || lox > b.hx) return -1;
  } else {
    let t1 = (-b.hx - lox) / ldx, t2 = (b.hx - lox) / ldx;
    if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
    if (t1 > tmin) { tmin = t1; axis = 0; sgn = ldx > 0 ? -1 : 1; }
    if (t2 < tmax) tmax = t2;
  }
  if (Math.abs(ldy) < COLLIDE_EPS) {
    if (loy < -b.hy || loy > b.hy) return -1;
  } else {
    let t1 = (-b.hy - loy) / ldy, t2 = (b.hy - loy) / ldy;
    if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
    if (t1 > tmin) { tmin = t1; axis = 1; sgn = ldy > 0 ? -1 : 1; }
    if (t2 < tmax) tmax = t2;
  }
  if (Math.abs(ldz) < COLLIDE_EPS) {
    if (loz < -b.hz || loz > b.hz) return -1;
  } else {
    let t1 = (-b.hz - loz) / ldz, t2 = (b.hz - loz) / ldz;
    if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
    if (t1 > tmin) { tmin = t1; axis = 2; sgn = ldz > 0 ? -1 : 1; }
    if (t2 < tmax) tmax = t2;
  }
  if (tmin > tmax || tmax < 0) return -1;
  if (tmin < 0) {
    nOut.x = -dx; nOut.y = -dy; nOut.z = -dz;
    return 0;
  }
  const lnx = axis === 0 ? sgn : 0;
  const lny = axis === 1 ? sgn : 0;
  const lnz = axis === 2 ? sgn : 0;
  nOut.x = lnx * b.cs + lnz * b.sn;
  nOut.y = lny;
  nOut.z = -lnx * b.sn + lnz * b.cs;
  return tmin;
}

function collideRayCyl(c, ox, oy, oz, dx, dy, dz, nOut) {
  const rx = ox - c.x, rz = oz - c.z;
  const cc = rx * rx + rz * rz - c.rad * c.rad;
  if (cc <= 0 && oy >= c.y0 && oy <= c.y1) {
    nOut.x = -dx; nOut.y = -dy; nOut.z = -dz;
    return 0;
  }
  let best = Infinity;
  const a = dx * dx + dz * dz;
  if (a > COLLIDE_EPS) {
    const b = rx * dx + rz * dz;
    const disc = b * b - a * cc;
    if (disc >= 0) {
      const t = (-b - Math.sqrt(disc)) / a;
      if (t >= 0) {
        const y = oy + dy * t;
        if (y >= c.y0 && y <= c.y1) {
          best = t;
          const inv = 1 / (c.rad || 1);
          nOut.x = (rx + dx * t) * inv;
          nOut.y = 0;
          nOut.z = (rz + dz * t) * inv;
        }
      }
    }
  }
  if (Math.abs(dy) > COLLIDE_EPS) {
    const r2 = c.rad * c.rad;
    if (dy < 0) {
      const t = (c.y1 - oy) / dy;
      if (t >= 0 && t < best) {
        const px = rx + dx * t, pz = rz + dz * t;
        if (px * px + pz * pz <= r2) {
          best = t;
          nOut.x = 0; nOut.y = 1; nOut.z = 0;
        }
      }
    } else {
      const t = (c.y0 - oy) / dy;
      if (t >= 0 && t < best) {
        const px = rx + dx * t, pz = rz + dz * t;
        if (px * px + pz * pz <= r2) {
          best = t;
          nOut.x = 0; nOut.y = -1; nOut.z = 0;
        }
      }
    }
  }
  return best === Infinity ? -1 : best;
}

function collideRaySphere(s, ox, oy, oz, dx, dy, dz, nOut) {
  const rx = ox - s.cx, ry = oy - s.cy, rz = oz - s.cz;
  const cc = rx * rx + ry * ry + rz * rz - s.rad * s.rad;
  if (cc <= 0) {
    nOut.x = -dx; nOut.y = -dy; nOut.z = -dz;
    return 0;
  }
  const b = rx * dx + ry * dy + rz * dz;
  if (b > 0) return -1;
  const disc = b * b - cc;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  if (t < 0) return -1;
  const inv = 1 / (s.rad || 1);
  nOut.x = (rx + dx * t) * inv;
  nOut.y = (ry + dy * t) * inv;
  nOut.z = (rz + dz * t) * inv;
  return t;
}

function collideRay(col, ox, oy, oz, dx, dy, dz, nOut) {
  if (col.kind === 'box') return collideRayBox(col, ox, oy, oz, dx, dy, dz, nOut);
  if (col.kind === 'cyl') return collideRayCyl(col, ox, oy, oz, dx, dy, dz, nOut);
  return collideRaySphere(col, ox, oy, oz, dx, dy, dz, nOut);
}

export function collideSphereBox(center, r, box, out) {
  const b = collideBoxFrom(box, box && box.id !== undefined ? box.id : null);
  if (!b) return null;
  const o = collidePrepOut(out);
  if (collideBoxCore(b, collideCompX(center), collideCompY(center), collideCompZ(center), collideNum(r, 0), o)) return o;
  o.hit = false;
  return null;
}

export function collideSphereCylinder(center, r, cyl, out) {
  const c = collideCylFrom(cyl, cyl && cyl.id !== undefined ? cyl.id : null);
  if (!c) return null;
  const o = collidePrepOut(out);
  if (collideCylCore(c, collideCompX(center), collideCompY(center), collideCompZ(center), collideNum(r, 0), o)) return o;
  o.hit = false;
  return null;
}

export function collideSphereSphere(center, r, sphere, out) {
  const s = collideSphereFrom(sphere, sphere && sphere.id !== undefined ? sphere.id : null);
  if (!s) return null;
  const o = collidePrepOut(out);
  if (collideSphereCore(s, collideCompX(center), collideCompY(center), collideCompZ(center), collideNum(r, 0), o)) return o;
  o.hit = false;
  return null;
}

export function collideSphereTerrain(center, r, heightAt, normalAt, out) {
  if (typeof heightAt !== 'function') return null;
  const o = collidePrepOut(out);
  const n = { x: 0, y: 1, z: 0 };
  const nf = typeof normalAt === 'function' ? normalAt : null;
  if (collideTerrainCore(heightAt, nf, collideCompX(center), collideCompY(center), collideCompZ(center), collideNum(r, 0), o, n)) return o;
  o.hit = false;
  return null;
}

export function createCollisionWorld(opts = {}) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const heightAt = typeof o.heightAt === 'function' ? o.heightAt : null;
  const normalAt = typeof o.normalAt === 'function' ? o.normalAt : null;
  const cs = collideNum(o.cellSize, 16);
  const cell = cs > 0 ? cs : 16;
  const inv = 1 / cell;
  const grid = new Map();
  const byId = new Map();
  const big = [];
  let autoId = 1;
  let stamp = 0;
  let gMinX = COLLIDE_CELL_LIMIT, gMaxX = -COLLIDE_CELL_LIMIT;
  let gMinZ = COLLIDE_CELL_LIMIT, gMaxZ = -COLLIDE_CELL_LIMIT;
  const scratch = collideMakeContact();
  const best = collideMakeContact();
  const nTmp = { x: 0, y: 1, z: 0 };
  const rayN = { x: 0, y: 1, z: 0 };

  function cellIndex(v) {
    const i = Math.floor(v * inv);
    if (!(i === i)) return 0;
    return i < -COLLIDE_CELL_LIMIT ? -COLLIDE_CELL_LIMIT : i > COLLIDE_CELL_LIMIT ? COLLIDE_CELL_LIMIT : i;
  }

  function cellKey(ix, iz) {
    return (ix + COLLIDE_KEY_OFF) * COLLIDE_KEY_MUL + (iz + COLLIDE_KEY_OFF);
  }

  function takeId(given) {
    if (given !== undefined && given !== null) {
      if (byId.has(given)) remove(given);
      return given;
    }
    while (byId.has(autoId)) autoId++;
    return autoId++;
  }

  function insert(col) {
    const ix0 = cellIndex(col.minX), ix1 = cellIndex(col.maxX);
    const iz0 = cellIndex(col.minZ), iz1 = cellIndex(col.maxZ);
    byId.set(col.id, col);
    if ((ix1 - ix0 + 1) * (iz1 - iz0 + 1) > COLLIDE_BIG_CELLS) {
      col.big = true;
      col.keys = [];
      big.push(col);
      return col.id;
    }
    col.keys = [];
    for (let ix = ix0; ix <= ix1; ix++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const key = cellKey(ix, iz);
        let arr = grid.get(key);
        if (!arr) {
          arr = [];
          grid.set(key, arr);
        }
        arr.push(col);
        col.keys.push(key);
      }
    }
    if (ix0 < gMinX) gMinX = ix0;
    if (ix1 > gMaxX) gMaxX = ix1;
    if (iz0 < gMinZ) gMinZ = iz0;
    if (iz1 > gMaxZ) gMaxZ = iz1;
    return col.id;
  }

  function addBox(spec) {
    const probe = collideBoxFrom(spec, null);
    if (!probe) return null;
    probe.id = takeId(spec.id);
    return insert(probe);
  }

  function addCylinder(spec) {
    const probe = collideCylFrom(spec, null);
    if (!probe) return null;
    probe.id = takeId(spec.id);
    return insert(probe);
  }

  function addSphere(spec) {
    const probe = collideSphereFrom(spec, null);
    if (!probe) return null;
    probe.id = takeId(spec.id);
    return insert(probe);
  }

  function addColliders(list) {
    const ids = [];
    if (!Array.isArray(list)) return ids;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const t = c && c.type;
      if (t === 'box') ids.push(addBox(c));
      else if (t === 'cyl' || t === 'cylinder') ids.push(addCylinder(c));
      else if (t === 'sphere') ids.push(addSphere(c));
      else ids.push(null);
    }
    return ids;
  }

  function remove(id) {
    const col = byId.get(id);
    if (!col) return false;
    byId.delete(id);
    if (col.big) {
      const k = big.indexOf(col);
      if (k >= 0) big.splice(k, 1);
      return true;
    }
    const keys = col.keys || [];
    for (let i = 0; i < keys.length; i++) {
      const arr = grid.get(keys[i]);
      if (!arr) continue;
      const k = arr.indexOf(col);
      if (k >= 0) arr.splice(k, 1);
      if (!arr.length) grid.delete(keys[i]);
    }
    return true;
  }

  function clear() {
    grid.clear();
    byId.clear();
    big.length = 0;
    autoId = 1;
    gMinX = COLLIDE_CELL_LIMIT; gMaxX = -COLLIDE_CELL_LIMIT;
    gMinZ = COLLIDE_CELL_LIMIT; gMaxZ = -COLLIDE_CELL_LIMIT;
  }

  function sphereVsWorld(pos, radius, out) {
    const px = collideCompX(pos), py = collideCompY(pos), pz = collideCompZ(pos);
    const r = Math.max(0, collideNum(radius, 0));
    if (out && typeof out === 'object') out.hit = false;
    if (!collideFinite(px) || !collideFinite(py) || !collideFinite(pz)) return null;
    let found = false;
    if (heightAt && collideTerrainCore(heightAt, normalAt, px, py, pz, r, scratch, nTmp)) {
      collideCopy(best, scratch);
      found = true;
    }
    stamp++;
    for (let i = 0; i < big.length; i++) {
      const col = big[i];
      col.stamp = stamp;
      if (collideTest(col, px, py, pz, r, scratch) && (!found || scratch.depth > best.depth)) {
        collideCopy(best, scratch);
        found = true;
      }
    }
    if (grid.size) {
      let ix0 = cellIndex(px - r), ix1 = cellIndex(px + r);
      let iz0 = cellIndex(pz - r), iz1 = cellIndex(pz + r);
      if (ix0 < gMinX) ix0 = gMinX;
      if (ix1 > gMaxX) ix1 = gMaxX;
      if (iz0 < gMinZ) iz0 = gMinZ;
      if (iz1 > gMaxZ) iz1 = gMaxZ;
      for (let ix = ix0; ix <= ix1; ix++) {
        for (let iz = iz0; iz <= iz1; iz++) {
          const arr = grid.get(cellKey(ix, iz));
          if (!arr) continue;
          for (let k = 0; k < arr.length; k++) {
            const col = arr[k];
            if (col.stamp === stamp) continue;
            col.stamp = stamp;
            if (collideTest(col, px, py, pz, r, scratch) && (!found || scratch.depth > best.depth)) {
              collideCopy(best, scratch);
              found = true;
            }
          }
        }
      }
    }
    if (!found) return null;
    const target = collidePrepOut(out);
    return collideCopy(target, best);
  }

  function sphereContacts(pos, radius, max = 8) {
    const list = [];
    const px = collideCompX(pos), py = collideCompY(pos), pz = collideCompZ(pos);
    const r = Math.max(0, collideNum(radius, 0));
    const limit = Math.max(0, Math.floor(collideNum(max, 8)));
    if (!collideFinite(px) || !collideFinite(py) || !collideFinite(pz) || !limit) return list;
    if (heightAt && collideTerrainCore(heightAt, normalAt, px, py, pz, r, scratch, nTmp)) {
      list.push(collideCopy(collideMakeContact(), scratch));
    }
    stamp++;
    for (let i = 0; i < big.length; i++) {
      const col = big[i];
      col.stamp = stamp;
      if (collideTest(col, px, py, pz, r, scratch)) list.push(collideCopy(collideMakeContact(), scratch));
    }
    if (grid.size) {
      let ix0 = cellIndex(px - r), ix1 = cellIndex(px + r);
      let iz0 = cellIndex(pz - r), iz1 = cellIndex(pz + r);
      if (ix0 < gMinX) ix0 = gMinX;
      if (ix1 > gMaxX) ix1 = gMaxX;
      if (iz0 < gMinZ) iz0 = gMinZ;
      if (iz1 > gMaxZ) iz1 = gMaxZ;
      for (let ix = ix0; ix <= ix1; ix++) {
        for (let iz = iz0; iz <= iz1; iz++) {
          const arr = grid.get(cellKey(ix, iz));
          if (!arr) continue;
          for (let k = 0; k < arr.length; k++) {
            const col = arr[k];
            if (col.stamp === stamp) continue;
            col.stamp = stamp;
            if (collideTest(col, px, py, pz, r, scratch)) list.push(collideCopy(collideMakeContact(), scratch));
          }
        }
      }
    }
    list.sort(function (a, b) { return b.depth - a.depth; });
    if (list.length > limit) list.length = limit;
    return list;
  }

  function raycast(origin, dir, maxDist) {
    const ox = collideCompX(origin), oy = collideCompY(origin), oz = collideCompZ(origin);
    let dx = collideCompX(dir), dy = collideCompY(dir), dz = collideCompZ(dir);
    if (!collideFinite(ox) || !collideFinite(oy) || !collideFinite(oz)) return null;
    if (!collideFinite(dx) || !collideFinite(dy) || !collideFinite(dz)) return null;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!(len > COLLIDE_EPS)) return null;
    dx /= len; dy /= len; dz /= len;
    let maxT = maxDist === undefined || maxDist === null ? 1000 : Number(maxDist);
    if (!(maxT >= 0)) return null;
    if (maxT > COLLIDE_MAX_RAY) maxT = COLLIDE_MAX_RAY;
    let found = false;
    let bestT = maxT;
    let bestKind = '';
    let bestId = null;
    let bnx = 0, bny = 1, bnz = 0;
    stamp++;

    function consider(col) {
      col.stamp = stamp;
      const t = collideRay(col, ox, oy, oz, dx, dy, dz, rayN);
      if (t < 0 || t > maxT) return;
      if (found && t >= bestT) return;
      found = true;
      bestT = t;
      bestKind = col.kind;
      bestId = col.id;
      bnx = rayN.x; bny = rayN.y; bnz = rayN.z;
    }

    for (let i = 0; i < big.length; i++) consider(big[i]);

    if (grid.size) {
      let ix = cellIndex(ox), iz = cellIndex(oz);
      const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
      const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
      let tMaxX = stepX !== 0 ? ((ix + (stepX > 0 ? 1 : 0)) * cell - ox) / dx : Infinity;
      let tMaxZ = stepZ !== 0 ? ((iz + (stepZ > 0 ? 1 : 0)) * cell - oz) / dz : Infinity;
      const tDX = stepX !== 0 ? cell / Math.abs(dx) : Infinity;
      const tDZ = stepZ !== 0 ? cell / Math.abs(dz) : Infinity;
      for (let guard = 0; guard < 2000000; guard++) {
        if (ix >= gMinX && ix <= gMaxX && iz >= gMinZ && iz <= gMaxZ) {
          const arr = grid.get(cellKey(ix, iz));
          if (arr) {
            for (let k = 0; k < arr.length; k++) {
              const col = arr[k];
              if (col.stamp === stamp) continue;
              consider(col);
            }
          }
        }
        const tNext = tMaxX < tMaxZ ? tMaxX : tMaxZ;
        if (!(tNext <= maxT)) break;
        if (found && tNext > bestT) break;
        if (tMaxX < tMaxZ) {
          ix += stepX;
          tMaxX += tDX;
        } else {
          iz += stepZ;
          tMaxZ += tDZ;
        }
        if ((stepX > 0 && ix > gMaxX) || (stepX < 0 && ix < gMinX) || (stepX === 0 && (ix < gMinX || ix > gMaxX))) break;
        if ((stepZ > 0 && iz > gMaxZ) || (stepZ < 0 && iz < gMinZ) || (stepZ === 0 && (iz < gMinZ || iz > gMaxZ))) break;
      }
    }

    if (heightAt) {
      const limit = found ? bestT : maxT;
      const h0 = heightAt(ox, oz);
      let f0 = oy - h0;
      if (collideFinite(f0)) {
        if (f0 <= 0) {
          if (!found || 0 < bestT) {
            const n = collideTerrainNormal(heightAt, normalAt, ox, oz, nTmp);
            found = true;
            bestT = 0;
            bestKind = 'terrain';
            bestId = -1;
            bnx = n.x; bny = n.y; bnz = n.z;
          }
        } else {
          let t = 0;
          for (let guard = 0; guard < 400000 && t < limit; guard++) {
            const stepLen = Math.min(1, Math.max(0.05, f0 * 0.5));
            let t1 = t + stepLen;
            if (t1 > limit) t1 = limit;
            const f1 = oy + dy * t1 - heightAt(ox + dx * t1, oz + dz * t1);
            if (!collideFinite(f1)) break;
            if (f1 <= 0) {
              let lo = t, hi = t1;
              for (let it = 0; it < 32; it++) {
                const mid = (lo + hi) * 0.5;
                const fm = oy + dy * mid - heightAt(ox + dx * mid, oz + dz * mid);
                if (fm > 0) lo = mid;
                else hi = mid;
              }
              const tHit = hi;
              if (!found || tHit < bestT) {
                const n = collideTerrainNormal(heightAt, normalAt, ox + dx * tHit, oz + dz * tHit, nTmp);
                found = true;
                bestT = tHit;
                bestKind = 'terrain';
                bestId = -1;
                bnx = n.x; bny = n.y; bnz = n.z;
              }
              break;
            }
            t = t1;
            f0 = f1;
          }
        }
      }
    }

    if (!found) return null;
    return {
      hit: true,
      dist: bestT,
      point: { x: ox + dx * bestT, y: oy + dy * bestT, z: oz + dz * bestT },
      normal: { x: bnx, y: bny, z: bnz },
      kind: bestKind,
      id: bestId
    };
  }

  return {
    cellSize: cell,
    heightAt,
    normalAt,
    addBox,
    addCylinder,
    addSphere,
    addColliders,
    remove,
    clear,
    get count() { return byId.size; },
    sphereVsWorld,
    sphereContacts,
    raycast
  };
}
