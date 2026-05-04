var c = class {
  header;
  dataOffset;
  buffer;
  constructor(e) {
    if (this.buffer = e, e.byteLength < 8) throw new Error("Safetensors file too small (< 8 bytes)");
    const r = new DataView(e, 0, 8), t = Number(r.getBigUint64(0, !0));
    if (t > e.byteLength - 8) throw new Error(`Header size ${t} exceeds file size ${e.byteLength}`);
    if (t > 1e8) throw new Error(`Header size ${t} unreasonably large (> 100MB)`);
    const o = new Uint8Array(e, 8, t), n = new TextDecoder().decode(o);
    this.header = JSON.parse(n), this.dataOffset = 8 + t;
  }
  tensorNames() {
    return Object.keys(this.header).filter((e) => e !== "__metadata__");
  }
  tensorInfo(e) {
    const r = this.header[e];
    if (!r) throw new Error(`Tensor "${e}" not found in safetensors file`);
    return r;
  }
  hasTensor(e) {
    return e in this.header && e !== "__metadata__";
  }
  tensorBytes(e) {
    const [r, t] = this.tensorInfo(e).data_offsets;
    return new Uint8Array(this.buffer, this.dataOffset + r, t - r);
  }
  getTensor(e) {
    const r = this.tensorInfo(e), [t, o] = r.data_offsets, n = o - t, s = this.dataOffset + t;
    switch (r.dtype) {
      case "F32": {
        if (s % 4 === 0) return new Float32Array(this.buffer, s, n / 4);
        const i = new Uint8Array(this.buffer, s, n), a = new Float32Array(n / 4);
        return new Uint8Array(a.buffer).set(i), a;
      }
      case "F16": {
        if (s % 2 === 0) return h(new Uint16Array(this.buffer, s, n / 2));
        const i = new Uint8Array(this.buffer, s, n), a = new Uint16Array(n / 2);
        return new Uint8Array(a.buffer).set(i), h(a);
      }
      case "BF16": {
        if (s % 2 === 0) return f(new Uint16Array(this.buffer, s, n / 2));
        const i = new Uint8Array(this.buffer, s, n), a = new Uint16Array(n / 2);
        return new Uint8Array(a.buffer).set(i), f(a);
      }
      case "Q4_0":
      case "Q4_KAXIS_DP4A": {
        if (s % 4 === 0) return new Uint32Array(this.buffer, s, n / 4);
        const i = new Uint8Array(this.buffer, s, n), a = new Uint32Array(n / 4);
        return new Uint8Array(a.buffer).set(i), a;
      }
      default:
        throw new Error(`Unsupported dtype "${r.dtype}" for tensor "${e}"`);
    }
  }
  get metadata() {
    return this.header.__metadata__ || null;
  }
  get numTensors() {
    return this.tensorNames().length;
  }
  summary() {
    const e = this.tensorNames(), r = [`SafetensorsFile: ${e.length} tensors, ${(this.buffer.byteLength / 1024 / 1024).toFixed(1)} MB`];
    for (const t of e) {
      const o = this.tensorInfo(t), n = o.shape.reduce((s, i) => s * i, 1);
      r.push(`  ${t}: ${o.dtype} ${JSON.stringify(o.shape)} (${n} elements)`);
    }
    return r.join(`
`);
  }
};
function f(e) {
  const r = new Float32Array(e.length), t = new Uint32Array(r.buffer);
  for (let o = 0; o < e.length; o++) t[o] = e[o] << 16;
  return r;
}
function h(e) {
  const r = new Float32Array(e.length);
  for (let t = 0; t < e.length; t++) {
    const o = e[t], n = o >>> 15 & 1, s = o >>> 10 & 31, i = o & 1023;
    let a;
    s === 0 ? a = i === 0 ? 0 : Math.pow(2, -14) * (i / 1024) : s === 31 ? a = i === 0 ? 1 / 0 : NaN : a = Math.pow(2, s - 15) * (1 + i / 1024), r[t] = n ? -a : a;
  }
  return r;
}
export {
  f as n,
  c as t
};

//# sourceMappingURL=safetensors-D5rcjRcU.mjs.map