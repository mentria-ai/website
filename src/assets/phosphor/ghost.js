const MAGIC0 = 80;
const MAGIC1 = 71;
const MAGIC2 = 72;
const MAGIC3 = 49;
const VERSION = 1;
const FRAME_BYTES = 10;
const DEFAULT_RATE = 30;
const MAX_MS = 1800000;
const MAX_FRAMES_PARSE = 60000;
const MAX_FRAMES_REC = 54000;
const POS_LIMIT = 32000;
const TAU = Math.PI * 2;
const U2R = TAU / 65536;
const R2U = 65536 / TAU;

function isNum(v) {
  return typeof v === 'number' && v === v && v !== Infinity && v !== -Infinity;
}

function numOr(v, d) {
  return isNum(v) ? v : d;
}

function quantPos(m) {
  if (!isNum(m)) return 0;
  let c = Math.round(m * 100);
  if (c > POS_LIMIT) c = POS_LIMIT;
  else if (c < -POS_LIMIT) c = -POS_LIMIT;
  return c;
}

function quantYaw(r) {
  if (!isNum(r)) return 0;
  let y = r % TAU;
  if (y < 0) y += TAU;
  let u = Math.round(y * R2U);
  if (u >= 65536) u -= 65536;
  if (u < 0) u = 0;
  return u;
}

function flagsFrom(state) {
  let f = 0;
  const mv = state && state.move;
  if (mv === 'crouch') f |= 1;
  else if (mv === 'slide') f |= 2;
  if (state && state.grounded === false) f |= 4;
  return f;
}

function asBytes(src) {
  if (!src) return null;
  if (src instanceof Uint8Array) return src;
  if (typeof ArrayBuffer !== 'undefined' && src instanceof ArrayBuffer) return new Uint8Array(src);
  if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView && ArrayBuffer.isView(src)) {
    return new Uint8Array(src.buffer, src.byteOffset, src.byteLength);
  }
  if (Array.isArray(src)) {
    const out = new Uint8Array(src.length);
    for (let i = 0; i < src.length; i++) out[i] = src[i] & 255;
    return out;
  }
  return null;
}

function idBytes(id) {
  let s = typeof id === 'string' ? id : id === null || id === undefined ? '' : String(id);
  if (s.length > 255) s = s.slice(0, 255);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 255;
  return out;
}

function framesFrom(data) {
  const src = data && data.frames;
  if (!src) return null;
  if (!Array.isArray(src)) return asBytes(src);
  if (!src.length) return null;
  if (typeof src[0] === 'number') return asBytes(src);
  const arr = src;
  const out = new Uint8Array(arr.length * FRAME_BYTES);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < arr.length; i++) {
    const fr = arr[i] || {};
    const off = i * FRAME_BYTES;
    let x = Math.round(numOr(fr.x, 0));
    let y = Math.round(numOr(fr.y, 0));
    let z = Math.round(numOr(fr.z, 0));
    if (x > POS_LIMIT) x = POS_LIMIT; else if (x < -POS_LIMIT) x = -POS_LIMIT;
    if (y > POS_LIMIT) y = POS_LIMIT; else if (y < -POS_LIMIT) y = -POS_LIMIT;
    if (z > POS_LIMIT) z = POS_LIMIT; else if (z < -POS_LIMIT) z = -POS_LIMIT;
    dv.setInt16(off, x, true);
    dv.setInt16(off + 2, y, true);
    dv.setInt16(off + 4, z, true);
    dv.setUint16(off + 6, Math.round(numOr(fr.yaw, 0)) & 65535, true);
    dv.setUint8(off + 8, Math.round(numOr(fr.flags, 0)) & 255);
    dv.setUint8(off + 9, 0);
  }
  return out;
}

export function createRecorder(courseId) {
  const id = typeof courseId === 'string' ? courseId : courseId === null || courseId === undefined ? '' : String(courseId);
  let buf = new Uint8Array(4096);
  let view = new DataView(buf.buffer);
  let count = 0;
  let done = false;
  let t0 = 0;
  let started = false;
  let lastT = 0;
  let lastRel = 0;
  let lx = 0;
  let ly = 0;
  let lz = 0;
  let lyaw = 0;
  let lflags = 0;

  function grow(need) {
    if (need <= buf.byteLength) return true;
    let cap = buf.byteLength;
    while (cap < need) cap *= 2;
    try {
      const nb = new Uint8Array(cap);
      nb.set(buf);
      buf = nb;
      view = new DataView(buf.buffer);
      return true;
    } catch (e) {
      return false;
    }
  }

  function put(i, x, y, z, yaw, flags) {
    const off = i * FRAME_BYTES;
    view.setInt16(off, x, true);
    view.setInt16(off + 2, y, true);
    view.setInt16(off + 4, z, true);
    view.setUint16(off + 6, yaw, true);
    view.setUint8(off + 8, flags);
    view.setUint8(off + 9, 0);
  }

  function sample(simState, tMs) {
    if (done || !simState || typeof simState !== 'object') return;
    if (!isNum(tMs)) return;
    if (!started) {
      t0 = tMs;
      lastT = tMs;
      started = true;
    }
    if (tMs < lastT) return;
    lastT = tMs;
    const rel = tMs - t0;
    if (rel < 0) return;
    lastRel = rel;
    const idx = Math.floor((rel * DEFAULT_RATE) / 1000);
    if (idx < count) return;
    if (idx >= MAX_FRAMES_REC) {
      done = true;
      return;
    }
    const p = simState.pos;
    let x = lx;
    let y = ly;
    let z = lz;
    if (p && typeof p === 'object' && p.length >= 3) {
      x = quantPos(p[0]);
      y = quantPos(p[1]);
      z = quantPos(p[2]);
    }
    const yaw = quantYaw(simState.yaw);
    const flags = flagsFrom(simState);
    if (!grow((idx + 1) * FRAME_BYTES)) {
      done = true;
      return;
    }
    while (count < idx) {
      put(count, lx, ly, lz, lyaw, lflags);
      count++;
    }
    put(idx, x, y, z, yaw, flags);
    count = idx + 1;
    lx = x;
    ly = y;
    lz = z;
    lyaw = yaw;
    lflags = flags;
  }

  function finish(totalMs) {
    done = true;
    let ms = isNum(totalMs) && totalMs > 0 ? Math.round(totalMs) : Math.round(lastRel);
    const span = count > 0 ? Math.ceil(((count - 1) * 1000) / DEFAULT_RATE) : 0;
    if (span > ms) ms = span;
    if (ms < 0) ms = 0;
    if (ms > MAX_MS) ms = MAX_MS;
    return {
      courseId: id,
      durationMs: ms,
      frameRate: DEFAULT_RATE,
      frameCount: count,
      frames: buf.slice(0, count * FRAME_BYTES)
    };
  }

  return { sample: sample, finish: finish };
}

export function serialize(ghostData) {
  const empty = new Uint8Array(0);
  if (!ghostData || typeof ghostData !== 'object') return empty;
  if (ghostData instanceof Uint8Array || (typeof ArrayBuffer !== 'undefined' && (ghostData instanceof ArrayBuffer || (ArrayBuffer.isView && ArrayBuffer.isView(ghostData))))) {
    const re = parse(ghostData);
    return re ? serialize(re) : empty;
  }
  const frames = framesFrom(ghostData);
  if (!frames) return empty;
  let count = isNum(ghostData.frameCount) ? Math.floor(ghostData.frameCount) : Math.floor(frames.byteLength / FRAME_BYTES);
  const avail = Math.floor(frames.byteLength / FRAME_BYTES);
  if (!(count > 0)) return empty;
  if (count > avail) count = avail;
  if (count > MAX_FRAMES_PARSE) count = MAX_FRAMES_PARSE;
  if (count < 1) return empty;

  const idb = idBytes(ghostData.courseId);
  let rate = isNum(ghostData.frameRate) ? Math.round(ghostData.frameRate) : DEFAULT_RATE;
  if (rate < 0 || rate > 65535) rate = DEFAULT_RATE;
  const tickRate = rate >= 1 && rate <= 1000 ? rate : DEFAULT_RATE;
  let ms = isNum(ghostData.durationMs) ? Math.round(ghostData.durationMs) : 0;
  if (ms < 1) ms = Math.ceil(((count - 1) * 1000) / tickRate) || 1;
  if (ms > MAX_MS) ms = MAX_MS;

  const head = 16 + idb.length;
  let out;
  try {
    out = new Uint8Array(head + count * FRAME_BYTES);
  } catch (e) {
    return empty;
  }
  const dv = new DataView(out.buffer);
  out[0] = MAGIC0;
  out[1] = MAGIC1;
  out[2] = MAGIC2;
  out[3] = MAGIC3;
  out[4] = VERSION;
  out[5] = idb.length;
  out.set(idb, 6);
  let off = 6 + idb.length;
  dv.setUint32(off, ms >>> 0, true);
  dv.setUint16(off + 4, rate, true);
  dv.setUint32(off + 6, count >>> 0, true);
  out.set(frames.subarray(0, count * FRAME_BYTES), head);
  return out;
}

export function parse(bytes) {
  try {
    const b = asBytes(bytes);
    if (!b || b.byteLength < 16) return null;
    if (b[0] !== MAGIC0 || b[1] !== MAGIC1 || b[2] !== MAGIC2 || b[3] !== MAGIC3) return null;
    if (b[4] !== VERSION) return null;
    const idLen = b[5];
    const head = 16 + idLen;
    if (b.byteLength < head) return null;
    let id = '';
    for (let i = 0; i < idLen; i++) id += String.fromCharCode(b[6 + i]);
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let off = 6 + idLen;
    const ms = dv.getUint32(off, true);
    const rate = dv.getUint16(off + 4, true);
    const count = dv.getUint32(off + 6, true);
    if (ms < 1 || ms > MAX_MS) return null;
    if (count < 1 || count > MAX_FRAMES_PARSE) return null;
    if (b.byteLength - head !== count * FRAME_BYTES) return null;
    return {
      courseId: id,
      durationMs: ms,
      frameRate: rate,
      frameCount: count,
      frames: b.slice(head, head + count * FRAME_BYTES)
    };
  } catch (e) {
    return null;
  }
}

export function createPlayer(ghostData) {
  const out = { pos: [0, 0, 0], yaw: 0, flags: 0 };
  let data = ghostData;
  if (data && (data instanceof Uint8Array || (typeof ArrayBuffer !== 'undefined' && (data instanceof ArrayBuffer || (ArrayBuffer.isView && ArrayBuffer.isView(data)))))) {
    data = parse(data);
  }
  let frames = null;
  try {
    frames = data && typeof data === 'object' ? framesFrom(data) : null;
  } catch (e) {
    frames = null;
  }
  let count = frames ? Math.floor(frames.byteLength / FRAME_BYTES) : 0;
  if (data && typeof data === 'object' && isNum(data.frameCount)) {
    const want = Math.floor(data.frameCount);
    if (want > 0 && want < count) count = want;
  }
  let rate = data && typeof data === 'object' && isNum(data.frameRate) ? Math.round(data.frameRate) : DEFAULT_RATE;
  if (rate < 1 || rate > 1000) rate = DEFAULT_RATE;
  let duration = data && typeof data === 'object' && isNum(data.durationMs) ? Math.round(data.durationMs) : 0;
  if (duration < 0) duration = 0;
  if (!count) duration = 0;
  const fv = frames && count ? new DataView(frames.buffer, frames.byteOffset, frames.byteLength) : null;
  const last = count - 1;

  function at(tMs) {
    if (!fv) {
      out.pos[0] = 0;
      out.pos[1] = 0;
      out.pos[2] = 0;
      out.yaw = 0;
      out.flags = 0;
      return out;
    }
    let t = isNum(tMs) ? tMs : 0;
    if (t < 0) t = 0;
    else if (t > duration) t = duration;
    let f = (t * rate) / 1000;
    if (!isNum(f) || f < 0) f = 0;
    let i0 = Math.floor(f);
    let frac = f - i0;
    let i1;
    if (i0 >= last) {
      i0 = last;
      i1 = last;
      frac = 0;
    } else {
      i1 = i0 + 1;
      if (frac < 0) frac = 0;
      else if (frac > 1) frac = 1;
    }
    const o0 = i0 * FRAME_BYTES;
    const o1 = i1 * FRAME_BYTES;
    const x0 = fv.getInt16(o0, true);
    const y0 = fv.getInt16(o0 + 2, true);
    const z0 = fv.getInt16(o0 + 4, true);
    const x1 = fv.getInt16(o1, true);
    const y1 = fv.getInt16(o1 + 2, true);
    const z1 = fv.getInt16(o1 + 4, true);
    out.pos[0] = (x0 + (x1 - x0) * frac) * 0.01;
    out.pos[1] = (y0 + (y1 - y0) * frac) * 0.01;
    out.pos[2] = (z0 + (z1 - z0) * frac) * 0.01;
    const a0 = fv.getUint16(o0 + 6, true) * U2R;
    const a1 = fv.getUint16(o1 + 6, true) * U2R;
    let d = a1 - a0;
    if (d > Math.PI) d -= TAU;
    else if (d < -Math.PI) d += TAU;
    let y = a0 + d * frac;
    if (y < 0 || y >= TAU) y = y % TAU;
    if (y < 0) y += TAU;
    if (y >= TAU) y = 0;
    out.yaw = y;
    out.flags = frac < 0.5 ? fv.getUint8(o0 + 8) : fv.getUint8(o1 + 8);
    return out;
  }

  return { duration: duration, at: at };
}
