async function k(d, S, l, h = {}) {
  let i;
  if (h.stream) i = h.stream.getReader();
  else {
    const e = await fetch(d);
    if (!e.ok) throw new Error(`streamSafetensors: ${e.status} for ${d}`);
    i = e.body.getReader();
  }
  let s = new Uint8Array(0), r = 0;
  async function m() {
    const e = await i.read();
    return e.done ? !1 : (s = e.value, r = 0, !0);
  }
  async function u(e, t, n) {
    let o = n;
    for (; o > 0; ) {
      if (r >= s.length) {
        if (!await m()) return !1;
        continue;
      }
      const a = Math.min(o, s.length - r);
      e.set(s.subarray(r, r + a), t), r += a, t += a, o -= a;
    }
    return !0;
  }
  async function b(e) {
    let t = e;
    for (; t > 0; ) {
      if (r >= s.length) {
        if (!await m()) return !1;
        continue;
      }
      const n = Math.min(t, s.length - r);
      r += n, t -= n;
    }
    return !0;
  }
  const g = new Uint8Array(8);
  if (!await u(g, 0, 8)) throw new Error("streamSafetensors: EOF in length");
  const w = Number(new DataView(g.buffer).getBigUint64(0, !0));
  if (w > 100 * 1024 * 1024) throw new Error("streamSafetensors: implausible header");
  const p = new Uint8Array(w);
  if (!await u(p, 0, w)) throw new Error("streamSafetensors: EOF in header");
  const y = JSON.parse(new TextDecoder().decode(p)), O = y.__metadata__ || {}, U = /* @__PURE__ */ new Map(), f = [];
  for (const [e, t] of Object.entries(y))
    e !== "__metadata__" && (U.set(e, t), f.push({
      name: e,
      start: t.data_offsets[0],
      end: t.data_offsets[1]
    }));
  f.sort((e, t) => e.start - t.start);
  const _ = /* @__PURE__ */ new Map(), A = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
  let c = 0, E = 0;
  for (const e of f) {
    if (e.start > c) {
      if (!await b(e.start - c)) throw new Error(`streamSafetensors: EOF before ${e.name}`);
      c = e.start;
    }
    const t = e.end - e.start, n = Math.ceil(t / 4) * 4, o = new Uint8Array(n);
    if (!await u(o, 0, t)) throw new Error(`streamSafetensors: EOF in ${e.name}`);
    c = e.end;
    const a = S.createBuffer({
      size: n,
      usage: A,
      mappedAtCreation: !0,
      label: e.name
    });
    new Uint8Array(a.getMappedRange()).set(o), a.unmap(), _.set(e.name, a), E++, l && l(E, f.length, e.name);
  }
  try {
    i.cancel();
  } catch {
  }
  return {
    infos: U,
    buffers: _,
    metadata: O
  };
}
export {
  k as streamSafetensorsToGPU
};

//# sourceMappingURL=streaming_safetensors-C-D5TDAO.mjs.map