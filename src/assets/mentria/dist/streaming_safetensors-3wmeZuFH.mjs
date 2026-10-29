function q(m, f, w, u = 0) {
  const o = new Uint8Array(w.buffer, w.byteOffset, w.byteLength), c = 64 * 1024 * 1024;
  if (o.byteLength <= c) {
    m.queue.writeBuffer(f, u, o);
    return;
  }
  for (let n = 0; n < o.byteLength; n += c) {
    const a = Math.min(c, o.byteLength - n);
    m.queue.writeBuffer(f, u + n, o, n, a);
  }
}
async function x(m, f, w, u = {}) {
  let o;
  if (u.stream) o = u.stream.getReader();
  else {
    const e = await fetch(m);
    if (!e.ok) throw new Error(`streamSafetensors: ${e.status} for ${m}`);
    o = e.body.getReader();
  }
  const c = new Uint8Array(0);
  let n = c, a = 0;
  async function E() {
    n = c, a = 0;
    const e = await o.read();
    return e.done ? !1 : (n = e.value, a = 0, !0);
  }
  async function g(e, r, i) {
    let t = i;
    for (; t > 0; ) {
      if (a >= n.length) {
        if (!await E()) return !1;
        continue;
      }
      const s = Math.min(t, n.length - a);
      e.set(n.subarray(a, a + s), r), a += s, r += s, t -= s;
    }
    return !0;
  }
  async function G(e) {
    let r = e;
    for (; r > 0; ) {
      if (a >= n.length) {
        if (!await E()) return !1;
        continue;
      }
      const i = Math.min(r, n.length - a);
      a += i, r -= i;
    }
    return !0;
  }
  const y = new Uint8Array(4);
  async function R(e, r) {
    let i = r, t = 0, s = 0;
    for (; i > 0; ) {
      if (a >= n.length) {
        if (!await E()) return !1;
        continue;
      }
      const S = Math.min(i, n.length - a), d = n.subarray(a, a + S);
      a += S, i -= S;
      let l = 0;
      if (s > 0) {
        const O = Math.min(4 - s, d.length);
        y.set(d.subarray(0, O), s), s += O, l = O, s === 4 && (f.queue.writeBuffer(e, t, y, 0, 4), t += 4, s = 0);
      }
      const _ = d.length - l, h = _ - _ % 4;
      h > 0 && (q(f, e, d.subarray(l, l + h), t), t += h);
      const M = _ - h;
      M > 0 && (y.set(d.subarray(l + h, l + h + M), 0), s = M);
    }
    return s > 0 && (y.fill(0, s), f.queue.writeBuffer(e, t, y, 0, 4)), !0;
  }
  const A = new Uint8Array(8);
  if (!await g(A, 0, 8)) throw new Error("streamSafetensors: EOF in length");
  const U = Number(new DataView(A.buffer).getBigUint64(0, !0));
  if (U > 100 * 1024 * 1024) throw new Error("streamSafetensors: implausible header");
  const k = new Uint8Array(U);
  if (!await g(k, 0, U)) throw new Error("streamSafetensors: EOF in header");
  const P = JSON.parse(new TextDecoder().decode(k)), T = P.__metadata__ || {}, B = /* @__PURE__ */ new Map(), b = [];
  for (const [e, r] of Object.entries(P))
    e !== "__metadata__" && (B.set(e, r), b.push({
      name: e,
      start: r.data_offsets[0],
      end: r.data_offsets[1]
    }));
  b.sort((e, r) => e.start - r.start);
  const F = /* @__PURE__ */ new Map(), L = /* @__PURE__ */ new Map(), $ = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
  let p = 0, C = 0;
  for (const e of b) {
    if (e.start > p) {
      if (!await G(e.start - p)) throw new Error(`streamSafetensors: EOF before ${e.name}`);
      p = e.start;
    }
    const r = e.end - e.start, i = Math.ceil(r / 4) * 4;
    if ((u.route ? u.route(e.name, B.get(e.name)) : "gpu") === "cpu") {
      const t = new Uint8Array(r);
      if (!await g(t, 0, r)) throw new Error(`streamSafetensors: EOF in ${e.name}`);
      L.set(e.name, t);
    } else {
      let t;
      if (u.weightUpload === "writeBuffer") {
        if (t = f.createBuffer({
          size: i,
          usage: $,
          label: e.name
        }), !await R(t, r)) throw new Error(`streamSafetensors: EOF in ${e.name}`);
      } else {
        if (t = f.createBuffer({
          size: i,
          usage: $,
          mappedAtCreation: !0,
          label: e.name
        }), !await g(new Uint8Array(t.getMappedRange()), 0, r))
          throw t.unmap(), t.destroy(), new Error(`streamSafetensors: EOF in ${e.name}`);
        t.unmap();
      }
      F.set(e.name, t);
    }
    p = e.end, C++, w && w(C, b.length, e.name);
  }
  n = c;
  try {
    o.cancel();
  } catch {
  }
  return {
    infos: B,
    buffers: F,
    cpu: L,
    metadata: T
  };
}
export {
  q as n,
  x as t
};

//# sourceMappingURL=streaming_safetensors-3wmeZuFH.mjs.map