const GHOST_MAGIC0 = 75;
const GHOST_MAGIC1 = 71;
const GHOST_MAGIC2 = 72;
const GHOST_VERSION = 1;
const GHOST_HEADER = 15;
const GHOST_POS_Q = 100;
const GHOST_QUAT_Q = 4096;
const GHOST_EXTRA_Q = 100;
const GHOST_MAX_EXTRA = 4;
const GHOST_MAX_HZ = 240;
const GHOST_MAX_FRAMES = 240 * 3600;
const GHOST_INT_LIMIT = 2147483647;
const GHOST_B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const GHOST_B64_LOOKUP = (function () {
  const t = new Int16Array(128).fill(-1);
  for (let i = 0; i < GHOST_B64.length; i++) t[GHOST_B64.charCodeAt(i)] = i;
  t[43] = 62;
  t[47] = 63;
  return t;
})();

function ghostNum(v) {
  return typeof v === 'number' && v === v && v !== Infinity && v !== -Infinity;
}

function ghostQuant(v, scale) {
  let n = Math.round(v * scale);
  if (!(n === n)) n = 0;
  if (n > GHOST_INT_LIMIT) n = GHOST_INT_LIMIT;
  else if (n < -GHOST_INT_LIMIT) n = -GHOST_INT_LIMIT;
  return n;
}

function ghostRate(hz) {
  const n = Math.round(ghostNum(hz) ? hz : 20);
  if (n < 1) return 1;
  if (n > GHOST_MAX_HZ) return GHOST_MAX_HZ;
  return n;
}

function ghostB64Encode(bytes, len) {
  let out = '';
  let i = 0;
  for (; i + 2 < len; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += GHOST_B64[(n >>> 18) & 63] + GHOST_B64[(n >>> 12) & 63] + GHOST_B64[(n >>> 6) & 63] + GHOST_B64[n & 63];
  }
  const rest = len - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += GHOST_B64[(n >>> 18) & 63] + GHOST_B64[(n >>> 12) & 63];
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += GHOST_B64[(n >>> 18) & 63] + GHOST_B64[(n >>> 12) & 63] + GHOST_B64[(n >>> 6) & 63];
  }
  return out;
}

function ghostCleanLength(str) {
  let n = str.length;
  while (n > 0 && str.charCodeAt(n - 1) === 61) n--;
  return n;
}

function ghostB64Decode(str) {
  const n = ghostCleanLength(str);
  if (n % 4 === 1) return null;
  const outLen = Math.floor((n * 3) / 4);
  const out = new Uint8Array(outLen);
  let o = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < n; i++) {
    const c = str.charCodeAt(i);
    const v = c < 128 ? GHOST_B64_LOOKUP[c] : -1;
    if (v < 0) return null;
    acc = ((acc << 6) | v) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      if (o < outLen) out[o++] = (acc >>> bits) & 255;
    }
  }
  return o === outLen ? out : null;
}

function ghostUtf8Encode(str) {
  const out = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      const d = str.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      }
    }
    let seq;
    if (c < 0x80) seq = [c];
    else if (c < 0x800) seq = [0xc0 | (c >> 6), 0x80 | (c & 63)];
    else if (c < 0x10000) seq = [0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)];
    else seq = [0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)];
    if (out.length + seq.length > 255) break;
    for (let k = 0; k < seq.length; k++) out.push(seq[k]);
  }
  return out;
}

function ghostUtf8Decode(bytes, start, len) {
  let s = '';
  let i = start;
  const end = start + len;
  while (i < end) {
    const b = bytes[i];
    let c = 0xfffd;
    let need = 0;
    if (b < 0x80) { c = b; need = 0; }
    else if (b >= 0xc0 && b < 0xe0) { c = b & 31; need = 1; }
    else if (b >= 0xe0 && b < 0xf0) { c = b & 15; need = 2; }
    else if (b >= 0xf0 && b < 0xf8) { c = b & 7; need = 3; }
    else { i++; s += '�'; continue; }
    if (need && i + need >= end) {
      s += '�';
      break;
    }
    let ok = true;
    for (let k = 1; k <= need; k++) {
      const nb = bytes[i + k];
      if ((nb & 0xc0) !== 0x80) { ok = false; break; }
      c = (c << 6) | (nb & 63);
    }
    if (!ok) { s += '�'; i++; continue; }
    i += need + 1;
    if (c >= 0x10000) {
      const v = c - 0x10000;
      s += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 1023));
    } else {
      s += String.fromCharCode(c);
    }
  }
  return s;
}

function ghostReadVec(a, out) {
  if (Array.isArray(a)) {
    out.x = a[0]; out.y = a[1]; out.z = a[2];
  } else if (a && typeof a === 'object') {
    out.x = a.x; out.y = a.y; out.z = a.z;
  } else {
    return false;
  }
  return ghostNum(out.x) && ghostNum(out.y) && ghostNum(out.z);
}

function ghostReadQuat(a, out) {
  if (a === undefined || a === null) {
    out.x = 0; out.y = 0; out.z = 0; out.w = 1;
    return true;
  }
  if (Array.isArray(a)) {
    out.x = a[0]; out.y = a[1]; out.z = a[2]; out.w = a[3];
  } else if (typeof a === 'object') {
    out.x = a.x; out.y = a.y; out.z = a.z; out.w = a.w;
  } else {
    return false;
  }
  if (!ghostNum(out.x) || !ghostNum(out.y) || !ghostNum(out.z) || !ghostNum(out.w)) return false;
  const l = Math.sqrt(out.x * out.x + out.y * out.y + out.z * out.z + out.w * out.w);
  if (l < 1e-9) return false;
  out.x /= l; out.y /= l; out.z /= l; out.w /= l;
  return true;
}

export function createRecorder(hz = 20, opts = {}) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const rate = ghostRate(hz);
  const maxSeconds = ghostNum(o.maxSeconds) && o.maxSeconds > 0 ? o.maxSeconds : 600;
  const maxFrames = Math.max(1, Math.min(GHOST_MAX_FRAMES, Math.floor(maxSeconds * rate) + 1));

  let extraCount = 0;
  let stride = 7;
  let data = null;
  let count = 0;
  let started = false;
  let full = false;
  let t0 = 0;
  let pt = 0;

  const prevPos = { x: 0, y: 0, z: 0 };
  const prevQuat = { x: 0, y: 0, z: 0, w: 1 };
  const prevExtra = [0, 0, 0, 0];
  const curPos = { x: 0, y: 0, z: 0 };
  const curQuat = { x: 0, y: 0, z: 0, w: 1 };
  const curExtra = [0, 0, 0, 0];
  const lastQuat = { x: 0, y: 0, z: 0, w: 1 };
  const mixExtra = [0, 0, 0, 0];

  function ensure(frames) {
    const need = frames * stride;
    if (data && data.length >= need) return;
    let cap = data ? data.length : stride * 256;
    while (cap < need) cap *= 2;
    const next = new Int32Array(cap);
    if (data) next.set(data.subarray(0, count * stride));
    data = next;
  }

  function emit(x, y, z, qx, qy, qz, qw, ex) {
    ensure(count + 1);
    if (count > 0 && qx * lastQuat.x + qy * lastQuat.y + qz * lastQuat.z + qw * lastQuat.w < 0) {
      qx = -qx; qy = -qy; qz = -qz; qw = -qw;
    }
    lastQuat.x = qx; lastQuat.y = qy; lastQuat.z = qz; lastQuat.w = qw;
    const off = count * stride;
    data[off] = ghostQuant(x, GHOST_POS_Q);
    data[off + 1] = ghostQuant(y, GHOST_POS_Q);
    data[off + 2] = ghostQuant(z, GHOST_POS_Q);
    data[off + 3] = ghostQuant(qx, GHOST_QUAT_Q);
    data[off + 4] = ghostQuant(qy, GHOST_QUAT_Q);
    data[off + 5] = ghostQuant(qz, GHOST_QUAT_Q);
    data[off + 6] = ghostQuant(qw, GHOST_QUAT_Q);
    for (let k = 0; k < extraCount; k++) data[off + 7 + k] = ghostQuant(ex[k], GHOST_EXTRA_Q);
    count++;
    if (count >= maxFrames) full = true;
  }

  function readExtra(extra, out) {
    for (let k = 0; k < extraCount; k++) {
      const v = Array.isArray(extra) ? extra[k] : 0;
      out[k] = ghostNum(v) ? v : 0;
    }
  }

  function keepPrev(t) {
    prevPos.x = curPos.x; prevPos.y = curPos.y; prevPos.z = curPos.z;
    prevQuat.x = curQuat.x; prevQuat.y = curQuat.y; prevQuat.z = curQuat.z; prevQuat.w = curQuat.w;
    for (let k = 0; k < extraCount; k++) prevExtra[k] = curExtra[k];
    pt = t;
  }

  function push(t, pos, quat, extra) {
    if (full || !ghostNum(t)) return;
    if (!ghostReadVec(pos, curPos)) return;
    if (!ghostReadQuat(quat, curQuat)) return;
    if (!started) {
      extraCount = Array.isArray(extra) ? Math.min(GHOST_MAX_EXTRA, extra.length) : 0;
      stride = 7 + extraCount;
      readExtra(extra, curExtra);
      started = true;
      t0 = t;
      emit(curPos.x, curPos.y, curPos.z, curQuat.x, curQuat.y, curQuat.z, curQuat.w, curExtra);
      keepPrev(t);
      return;
    }
    readExtra(extra, curExtra);
    if (t < pt) return;
    if (t === pt) {
      keepPrev(t);
      return;
    }
    const span = t - pt;
    let sx = curQuat.x, sy = curQuat.y, sz = curQuat.z, sw = curQuat.w;
    if (prevQuat.x * sx + prevQuat.y * sy + prevQuat.z * sz + prevQuat.w * sw < 0) {
      sx = -sx; sy = -sy; sz = -sz; sw = -sw;
    }
    while (!full) {
      const tk = t0 + count / rate;
      if (tk > t + 1e-9) break;
      let a = (tk - pt) / span;
      if (a < 0) a = 0;
      else if (a > 1) a = 1;
      const x = prevPos.x + (curPos.x - prevPos.x) * a;
      const y = prevPos.y + (curPos.y - prevPos.y) * a;
      const z = prevPos.z + (curPos.z - prevPos.z) * a;
      let qx = prevQuat.x + (sx - prevQuat.x) * a;
      let qy = prevQuat.y + (sy - prevQuat.y) * a;
      let qz = prevQuat.z + (sz - prevQuat.z) * a;
      let qw = prevQuat.w + (sw - prevQuat.w) * a;
      const ql = Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw) || 1;
      qx /= ql; qy /= ql; qz /= ql; qw /= ql;
      for (let k = 0; k < extraCount; k++) mixExtra[k] = prevExtra[k] + (curExtra[k] - prevExtra[k]) * a;
      emit(x, y, z, qx, qy, qz, qw, mixExtra);
    }
    keepPrev(t);
  }

  function encode(meta) {
    if (!count || !data) return '';
    let metaStr = '';
    if (typeof meta === 'string') metaStr = meta;
    else if (meta !== undefined && meta !== null) {
      try { metaStr = JSON.stringify(meta) || ''; } catch (_) { metaStr = ''; }
    }
    const metaBytes = ghostUtf8Encode(metaStr);
    const cap = GHOST_HEADER + metaBytes.length + count * stride * 6 + 8;
    const buf = new Uint8Array(cap);
    const view = new DataView(buf.buffer);
    buf[0] = GHOST_MAGIC0;
    buf[1] = GHOST_MAGIC1;
    buf[2] = GHOST_MAGIC2;
    buf[3] = GHOST_VERSION;
    buf[4] = rate;
    buf[5] = extraCount;
    view.setUint32(6, count >>> 0, true);
    view.setFloat32(10, t0, true);
    buf[14] = metaBytes.length;
    let off = GHOST_HEADER;
    for (let i = 0; i < metaBytes.length; i++) buf[off++] = metaBytes[i];
    for (let i = 0; i < count; i++) {
      const base = i * stride;
      for (let c = 0; c < stride; c++) {
        const v = data[base + c];
        let pred = 0;
        if (i === 1) pred = data[base - stride + c];
        else if (i > 1) pred = 2 * data[base - stride + c] - data[base - 2 * stride + c];
        const r = v - pred;
        let zz = r >= 0 ? r * 2 : -r * 2 - 1;
        while (zz >= 128) {
          buf[off++] = (zz % 128) | 128;
          zz = Math.floor(zz / 128);
        }
        buf[off++] = zz;
      }
    }
    return ghostB64Encode(buf, off);
  }

  function reset() {
    extraCount = 0;
    stride = 7;
    data = null;
    count = 0;
    started = false;
    full = false;
    t0 = 0;
    pt = 0;
    lastQuat.x = 0; lastQuat.y = 0; lastQuat.z = 0; lastQuat.w = 1;
  }

  return {
    hz: rate,
    push,
    encode,
    reset,
    dispose: reset,
    get frames() { return count; },
    get duration() { return count > 0 ? (count - 1) / rate : 0; },
    get full() { return full; },
    get t0() { return t0; }
  };
}

function ghostReadVarint(bytes, state) {
  let result = 0;
  let mul = 1;
  for (let k = 0; k < 8; k++) {
    if (state.off >= bytes.length) return -1;
    const b = bytes[state.off++];
    result += (b & 127) * mul;
    if (b < 128) return result;
    mul *= 128;
  }
  return -1;
}

export function decodeGhost(str) {
  try {
    if (typeof str !== 'string' || str.length < 20) return null;
    const bytes = ghostB64Decode(str);
    if (!bytes || bytes.length < GHOST_HEADER) return null;
    if (bytes[0] !== GHOST_MAGIC0 || bytes[1] !== GHOST_MAGIC1 || bytes[2] !== GHOST_MAGIC2) return null;
    if (bytes[3] !== GHOST_VERSION) return null;
    const hz = bytes[4];
    if (hz < 1 || hz > GHOST_MAX_HZ) return null;
    const extraCount = bytes[5];
    if (extraCount > GHOST_MAX_EXTRA) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const n = view.getUint32(6, true);
    if (n < 1 || n > GHOST_MAX_FRAMES) return null;
    const t0 = view.getFloat32(10, true);
    if (!ghostNum(t0)) return null;
    const metaLen = bytes[14];
    if (GHOST_HEADER + metaLen > bytes.length) return null;
    const meta = ghostUtf8Decode(bytes, GHOST_HEADER, metaLen);
    const stride = 7 + extraCount;
    if (bytes.length - GHOST_HEADER - metaLen < n * stride) return null;
    const vals = new Float64Array(n * stride);
    const state = { off: GHOST_HEADER + metaLen };
    for (let i = 0; i < n; i++) {
      const base = i * stride;
      for (let c = 0; c < stride; c++) {
        const zz = ghostReadVarint(bytes, state);
        if (zz < 0) return null;
        const r = zz % 2 === 0 ? zz / 2 : -(zz + 1) / 2;
        let pred = 0;
        if (i === 1) pred = vals[base - stride + c];
        else if (i > 1) pred = 2 * vals[base - stride + c] - vals[base - 2 * stride + c];
        vals[base + c] = pred + r;
      }
    }
    if (state.off !== bytes.length) return null;
    const pos = new Float64Array(n * 3);
    const rot = new Float64Array(n * 4);
    const ext = new Float64Array(n * Math.max(1, extraCount));
    for (let i = 0; i < n; i++) {
      const base = i * stride;
      pos[i * 3] = vals[base] / GHOST_POS_Q;
      pos[i * 3 + 1] = vals[base + 1] / GHOST_POS_Q;
      pos[i * 3 + 2] = vals[base + 2] / GHOST_POS_Q;
      let qx = vals[base + 3] / GHOST_QUAT_Q;
      let qy = vals[base + 4] / GHOST_QUAT_Q;
      let qz = vals[base + 5] / GHOST_QUAT_Q;
      let qw = vals[base + 6] / GHOST_QUAT_Q;
      const l = Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw);
      if (!(l > 1e-6) || !ghostNum(l)) {
        qx = 0; qy = 0; qz = 0; qw = 1;
      } else {
        qx /= l; qy /= l; qz /= l; qw /= l;
      }
      rot[i * 4] = qx;
      rot[i * 4 + 1] = qy;
      rot[i * 4 + 2] = qz;
      rot[i * 4 + 3] = qw;
      for (let k = 0; k < extraCount; k++) ext[i * extraCount + k] = vals[base + 7 + k] / GHOST_EXTRA_Q;
    }
    let metaData = null;
    if (meta) {
      try { metaData = JSON.parse(meta); } catch (_) { metaData = null; }
    }
    return ghostPlayer(hz, t0, n, extraCount, pos, rot, ext, meta, metaData);
  } catch (_) {
    return null;
  }
}

function ghostPlayer(hz, t0, n, extraCount, pos, rot, ext, meta, metaData) {
  const last = n - 1;

  function sample(t, out) {
    let o = out;
    if (!o || typeof o !== 'object') o = { pos: { x: 0, y: 0, z: 0 }, quat: { x: 0, y: 0, z: 0, w: 1 }, extra: new Array(extraCount).fill(0) };
    if (!o.pos) o.pos = { x: 0, y: 0, z: 0 };
    if (!o.quat) o.quat = { x: 0, y: 0, z: 0, w: 1 };
    if (!Array.isArray(o.extra)) o.extra = new Array(extraCount).fill(0);
    let f = (ghostNum(t) ? t - t0 : 0) * hz;
    if (!(f > 0)) f = 0;
    if (f > last) f = last;
    let i = Math.floor(f);
    let a = f - i;
    if (i >= last) {
      i = last;
      a = 0;
    }
    const i2 = i < last ? i + 1 : last;
    const p1 = i * 3;
    const p2 = i2 * 3;
    const hasPrev = i > 0;
    const hasNext = i + 2 <= last;
    const p0 = (i - 1) * 3;
    const p3 = (i + 2) * 3;
    const a2 = a * a;
    const a3 = a2 * a;
    for (let c = 0; c < 3; c++) {
      const v1 = pos[p1 + c];
      const v2 = pos[p2 + c];
      const v0 = hasPrev ? pos[p0 + c] : 2 * v1 - v2;
      const v3 = hasNext ? pos[p3 + c] : 2 * v2 - v1;
      const v = 0.5 * (2 * v1 + (v2 - v0) * a + (2 * v0 - 5 * v1 + 4 * v2 - v3) * a2 + (3 * v1 - v0 - 3 * v2 + v3) * a3);
      if (c === 0) o.pos.x = v;
      else if (c === 1) o.pos.y = v;
      else o.pos.z = v;
    }
    const r1 = i * 4;
    const r2 = i2 * 4;
    let bx = rot[r2], by = rot[r2 + 1], bz = rot[r2 + 2], bw = rot[r2 + 3];
    const ax = rot[r1], ay = rot[r1 + 1], az = rot[r1 + 2], aw = rot[r1 + 3];
    if (ax * bx + ay * by + az * bz + aw * bw < 0) {
      bx = -bx; by = -by; bz = -bz; bw = -bw;
    }
    let qx = ax + (bx - ax) * a;
    let qy = ay + (by - ay) * a;
    let qz = az + (bz - az) * a;
    let qw = aw + (bw - aw) * a;
    const ql = Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw) || 1;
    o.quat.x = qx / ql;
    o.quat.y = qy / ql;
    o.quat.z = qz / ql;
    o.quat.w = qw / ql;
    for (let k = 0; k < extraCount; k++) {
      const e1 = ext[i * extraCount + k];
      const e2 = ext[i2 * extraCount + k];
      o.extra[k] = e1 + (e2 - e1) * a;
    }
    if (o.extra.length > extraCount) o.extra.length = extraCount;
    return o;
  }

  return {
    hz,
    t0,
    frames: n,
    extraCount,
    duration: last / hz,
    meta,
    metaData,
    sample,
    dispose: function () {}
  };
}

export function ghostByteSize(str) {
  if (typeof str !== 'string') return 0;
  const n = ghostCleanLength(str);
  if (n % 4 === 1) return 0;
  return Math.floor((n * 3) / 4);
}
