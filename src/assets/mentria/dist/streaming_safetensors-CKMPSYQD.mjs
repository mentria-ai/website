function z(c, f, l, i = 0) {
  const u = new Uint8Array(l.buffer, l.byteOffset, l.byteLength), h = 64 * 1024 * 1024;
  if (u.byteLength <= h) {
    c.queue.writeBuffer(f, i, u);
    return;
  }
  for (let r = 0; r < u.byteLength; r += h) {
    const a = Math.min(h, u.byteLength - r);
    c.queue.writeBuffer(f, i + r, u, r, a);
  }
}
function N(c) {
  const f = String(c || "");
  return /AppleWebKit\//.test(f) && !/(?:Chrome|Chromium|Edg|HeadlessChrome)\//.test(f);
}
async function H(c, f, l, i = {}) {
  let u;
  if (i.stream) u = i.stream.getReader();
  else {
    const e = await fetch(c);
    if (!e.ok) throw new Error(`streamSafetensors: ${e.status} for ${c}`);
    u = e.body.getReader();
  }
  const h = new Uint8Array(0);
  let r = h, a = 0;
  const M = i.releaseChunks ?? N(typeof navigator < "u" ? navigator.userAgent : ""), O = (e) => {
    if (e.byteLength > 0 && e.byteOffset === 0 && e.buffer && e.byteLength === e.buffer.byteLength && typeof e.buffer.transfer == "function" && !(typeof SharedArrayBuffer < "u" && e.buffer instanceof SharedArrayBuffer)) try {
      e.buffer.transfer(0);
    } catch {
    }
  };
  async function S() {
    M && O(r), r = h, a = 0;
    const e = await u.read();
    return e.done ? !1 : (r = e.value, a = 0, !0);
  }
  async function g(e, t, o) {
    let n = o;
    for (; n > 0; ) {
      if (a >= r.length) {
        if (!await S()) return !1;
        continue;
      }
      const s = Math.min(n, r.length - a);
      e.set(r.subarray(a, a + s), t), a += s, t += s, n -= s;
    }
    return !0;
  }
  async function R(e) {
    let t = e;
    for (; t > 0; ) {
      if (a >= r.length) {
        if (!await S()) return !1;
        continue;
      }
      const o = Math.min(t, r.length - a);
      a += o, t -= o;
    }
    return !0;
  }
  const m = new Uint8Array(4), L = i.fenceBytes ?? 32 * 1024 * 1024;
  let B = 0;
  const W = async (e) => {
    B += e, L > 0 && B >= L && typeof f.queue.onSubmittedWorkDone == "function" && (B = 0, await f.queue.onSubmittedWorkDone());
  };
  async function Y(e, t) {
    let o = t, n = 0, s = 0;
    for (; o > 0; ) {
      if (a >= r.length) {
        if (!await S()) return !1;
        continue;
      }
      const E = Math.min(o, r.length - a), d = r.subarray(a, a + E);
      a += E, o -= E;
      let w = 0;
      if (s > 0) {
        const C = Math.min(4 - s, d.length);
        m.set(d.subarray(0, C), s), s += C, w = C, s === 4 && (f.queue.writeBuffer(e, n, m, 0, 4), n += 4, s = 0);
      }
      const A = d.length - w, y = A - A % 4;
      y > 0 && (z(f, e, d.subarray(w, w + y), n), n += y);
      const k = A - y;
      k > 0 && (m.set(d.subarray(w + y, w + y + k), 0), s = k), await W(E);
    }
    return s > 0 && (m.fill(0, s), f.queue.writeBuffer(e, n, m, 0, 4)), !0;
  }
  const F = new Uint8Array(8);
  if (!await g(F, 0, 8)) throw new Error("streamSafetensors: EOF in length");
  const U = Number(new DataView(F.buffer).getBigUint64(0, !0));
  if (U > 100 * 1024 * 1024) throw new Error("streamSafetensors: implausible header");
  const P = new Uint8Array(U);
  if (!await g(P, 0, U)) throw new Error("streamSafetensors: EOF in header");
  const q = JSON.parse(new TextDecoder().decode(P)), x = q.__metadata__ || {}, _ = /* @__PURE__ */ new Map(), b = [];
  for (const [e, t] of Object.entries(q))
    e !== "__metadata__" && (_.set(e, t), b.push({
      name: e,
      start: t.data_offsets[0],
      end: t.data_offsets[1]
    }));
  b.sort((e, t) => e.start - t.start);
  const T = /* @__PURE__ */ new Map(), $ = /* @__PURE__ */ new Map(), D = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
  let p = 0, G = 0;
  for (const e of b) {
    if (e.start > p) {
      if (!await R(e.start - p)) throw new Error(`streamSafetensors: EOF before ${e.name}`);
      p = e.start;
    }
    const t = e.end - e.start, o = Math.ceil(t / 4) * 4;
    if ((i.route ? i.route(e.name, _.get(e.name)) : "gpu") === "cpu") {
      const n = new Uint8Array(t);
      if (!await g(n, 0, t)) throw new Error(`streamSafetensors: EOF in ${e.name}`);
      $.set(e.name, n);
    } else {
      let n;
      if (i.weightUpload === "writeBuffer") {
        if (n = f.createBuffer({
          size: o,
          usage: D,
          label: e.name
        }), !await Y(n, t)) throw new Error(`streamSafetensors: EOF in ${e.name}`);
      } else {
        if (n = f.createBuffer({
          size: o,
          usage: D,
          mappedAtCreation: !0,
          label: e.name
        }), !await g(new Uint8Array(n.getMappedRange()), 0, t))
          throw n.unmap(), n.destroy(), new Error(`streamSafetensors: EOF in ${e.name}`);
        n.unmap();
      }
      T.set(e.name, n);
    }
    p = e.end, G++, l && l(G, b.length, e.name);
  }
  M && O(r), r = h;
  try {
    u.cancel();
  } catch {
  }
  return {
    infos: _,
    buffers: T,
    cpu: $,
    metadata: x
  };
}
export {
  H as n,
  z as r,
  N as t
};

//# sourceMappingURL=streaming_safetensors-CKMPSYQD.mjs.map