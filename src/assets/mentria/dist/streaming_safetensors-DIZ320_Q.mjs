function A(w, u, c) {
  const s = new Uint8Array(c.buffer, c.byteOffset, c.byteLength), f = 64 * 1024 * 1024;
  if (s.byteLength <= f) {
    w.queue.writeBuffer(u, 0, s);
    return;
  }
  for (let r = 0; r < s.byteLength; r += f) {
    const n = Math.min(f, s.byteLength - r);
    w.queue.writeBuffer(u, r, s, r, n);
  }
}
async function M(w, u, c, s = {}) {
  let f;
  if (s.stream) f = s.stream.getReader();
  else {
    const e = await fetch(w);
    if (!e.ok) throw new Error(`streamSafetensors: ${e.status} for ${w}`);
    f = e.body.getReader();
  }
  let r = new Uint8Array(0), n = 0;
  async function g() {
    const e = await f.read();
    return e.done ? !1 : (r = e.value, n = 0, !0);
  }
  async function d(e, t, o) {
    let i = o;
    for (; i > 0; ) {
      if (n >= r.length) {
        if (!await g()) return !1;
        continue;
      }
      const a = Math.min(i, r.length - n);
      e.set(r.subarray(n, n + a), t), n += a, t += a, i -= a;
    }
    return !0;
  }
  async function S(e) {
    let t = e;
    for (; t > 0; ) {
      if (n >= r.length) {
        if (!await g()) return !1;
        continue;
      }
      const o = Math.min(t, r.length - n);
      n += o, t -= o;
    }
    return !0;
  }
  const y = new Uint8Array(8);
  if (!await d(y, 0, 8)) throw new Error("streamSafetensors: EOF in length");
  const m = Number(new DataView(y.buffer).getBigUint64(0, !0));
  if (m > 100 * 1024 * 1024) throw new Error("streamSafetensors: implausible header");
  const b = new Uint8Array(m);
  if (!await d(b, 0, m)) throw new Error("streamSafetensors: EOF in header");
  const U = JSON.parse(new TextDecoder().decode(b)), O = U.__metadata__ || {}, p = /* @__PURE__ */ new Map(), h = [];
  for (const [e, t] of Object.entries(U))
    e !== "__metadata__" && (p.set(e, t), h.push({
      name: e,
      start: t.data_offsets[0],
      end: t.data_offsets[1]
    }));
  h.sort((e, t) => e.start - t.start);
  const _ = /* @__PURE__ */ new Map(), B = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
  let l = 0, E = 0;
  for (const e of h) {
    if (e.start > l) {
      if (!await S(e.start - l)) throw new Error(`streamSafetensors: EOF before ${e.name}`);
      l = e.start;
    }
    const t = e.end - e.start, o = Math.ceil(t / 4) * 4, i = new Uint8Array(o);
    if (!await d(i, 0, t)) throw new Error(`streamSafetensors: EOF in ${e.name}`);
    l = e.end;
    let a;
    s.weightUpload === "writeBuffer" ? (a = u.createBuffer({
      size: o,
      usage: B,
      label: e.name
    }), A(u, a, i)) : (a = u.createBuffer({
      size: o,
      usage: B,
      mappedAtCreation: !0,
      label: e.name
    }), new Uint8Array(a.getMappedRange()).set(i), a.unmap()), _.set(e.name, a), E++, c && c(E, h.length, e.name);
  }
  try {
    f.cancel();
  } catch {
  }
  return {
    infos: p,
    buffers: _,
    metadata: O
  };
}
export {
  A as n,
  M as t
};

//# sourceMappingURL=streaming_safetensors-DIZ320_Q.mjs.map