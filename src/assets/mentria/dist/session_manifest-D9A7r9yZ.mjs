var y = "mentria-session";
var c = 2166136261, h = 16777619;
function w(e) {
  let r = e instanceof ArrayBuffer ? new Uint8Array(e) : new Uint8Array(e.buffer, e.byteOffset, e.byteLength);
  (r.byteOffset & 3) !== 0 && (r = new Uint8Array(r));
  const t = r.byteLength;
  let n = c | 0;
  const s = t >>> 2, i = new Uint32Array(r.buffer, r.byteOffset, s);
  for (let o = 0; o < s; o++) n = Math.imul(n ^ i[o], h);
  for (let o = s << 2; o < t; o++) n = Math.imul(n ^ r[o], h);
  return n >>> 0;
}
function d(e, r, t, n) {
  if (!Number.isInteger(e) || e < 0) throw new Error(`makeRegion: bad off ${e}`);
  if (!Number.isInteger(r) || r < 0) throw new Error(`makeRegion: bad rowBytes ${r}`);
  if (!Number.isInteger(t) || t < 0) throw new Error(`makeRegion: bad rowStride ${t}`);
  if (!Number.isInteger(n) || n < 0) throw new Error(`makeRegion: bad rows ${n}`);
  if (r > t && n > 1) throw new Error(`makeRegion: rowBytes ${r} exceeds rowStride ${t}`);
  if (e & 3 || r & 3 || t & 3) throw new Error(`makeRegion: off/rowBytes/rowStride must be 4-byte multiples (got ${e}/${r}/${t})`);
  return n === 0 || r === 0 ? {
    off: e,
    rowBytes: 0,
    rowStride: t,
    rows: 0
  } : r === t && n > 1 ? {
    off: e,
    rowBytes: r * n,
    rowStride: r * n,
    rows: 1
  } : {
    off: e,
    rowBytes: r,
    rowStride: t,
    rows: n
  };
}
function b(e) {
  return e.rows * e.rowBytes;
}
function k(e, r, t = "region") {
  if (e.rows === 0) return;
  const n = e.off + (e.rows - 1) * e.rowStride + e.rowBytes;
  if (n > r) throw new Error(`${t}: region overruns buffer — needs ${n} bytes, buffer is ${r}`);
}
function L(e, r) {
  if (!Number.isInteger(r) || r < 4) throw new Error(`regionSlices: maxBytes must be >= 4 (got ${r})`);
  const t = r - (r & 3), n = [];
  for (let s = 0; s < e.rows; s++) {
    const i = e.off + s * e.rowStride, o = s * e.rowBytes;
    for (let a = 0; a < e.rowBytes; a += t) n.push({
      bufOffset: i + a,
      packedOffset: o + a,
      byteLength: Math.min(t, e.rowBytes - a)
    });
  }
  return n;
}
function m(e) {
  const r = e.entries || [];
  let t = 0;
  for (const n of r) t += n.byteLength;
  return {
    format: y,
    version: 1,
    createdAt: e.createdAt ?? Date.now(),
    fingerprint: e.fingerprint,
    seqLen: e.seqLen,
    tokens: e.tokens || [],
    layers: e.layers || [],
    entries: r,
    totalBytes: t
  };
}
function l(e, r) {
  if (e === r) return !0;
  if (Array.isArray(e) || Array.isArray(r)) {
    if (!Array.isArray(e) || !Array.isArray(r) || e.length !== r.length) return !1;
    for (let t = 0; t < e.length; t++) if (!l(e[t], r[t])) return !1;
    return !0;
  }
  if (e && r && typeof e == "object" && typeof r == "object") {
    const t = Object.keys(e).sort(), n = Object.keys(r).sort();
    if (t.length !== n.length) return !1;
    for (let s = 0; s < t.length; s++)
      if (t[s] !== n[s] || !l(e[t[s]], r[n[s]])) return !1;
    return !0;
  }
  return !1;
}
function g(e) {
  return Array.isArray(e) ? e.length > 8 ? `[${e.slice(0, 8).join(",")},…${e.length}]` : `[${e.join(",")}]` : e && typeof e == "object" ? JSON.stringify(e) : String(e);
}
function $(e, r) {
  const t = /* @__PURE__ */ new Set([...Object.keys(e || {}), ...Object.keys(r || {})]), n = [];
  for (const s of [...t].sort()) l(e?.[s], r?.[s]) || n.push({
    key: s,
    snapshot: e?.[s],
    live: r?.[s]
  });
  return n;
}
function A(e, r) {
  const t = [];
  if (!e || typeof e != "object") return {
    ok: !1,
    errors: ["manifest is not an object"]
  };
  if (e.format !== "mentria-session" && t.push(`format mismatch — expected '${y}', got '${e.format}'`), e.version !== 1 && t.push(`version mismatch — engine reads v1, snapshot is v${e.version}`), (!Number.isInteger(e.seqLen) || e.seqLen < 0) && t.push(`seqLen must be a non-negative integer (got ${e.seqLen})`), Array.isArray(e.tokens) ? Number.isInteger(e.seqLen) && e.tokens.length !== e.seqLen && t.push(`ledger/seqLen disagree — ${e.tokens.length} tokens vs seqLen ${e.seqLen}`) : t.push("tokens must be an array"), !Array.isArray(e.entries)) t.push("entries must be an array");
  else {
    let n = 0;
    for (const s of e.entries) {
      const i = b(s.region);
      i !== s.byteLength && t.push(`${s.key}: byteLength ${s.byteLength} != region live bytes ${i}`);
      try {
        k(s.region, s.bufferBytes, s.key);
      } catch (o) {
        t.push(o.message);
      }
      n += s.byteLength;
    }
    e.totalBytes !== n && t.push(`totalBytes ${e.totalBytes} != sum of entries ${n}`);
  }
  if (r) for (const n of $(e.fingerprint, r)) t.push(`fingerprint.${n.key}: snapshot=${g(n.snapshot)} live=${g(n.live)}`);
  return {
    ok: t.length === 0,
    errors: t
  };
}
function p(e, r) {
  const { ok: t, errors: n } = A(e, r);
  if (!t) throw new Error(`restoreSession refused — snapshot is not compatible with the loaded engine:
  ` + n.join(`
  `));
}
function O(e, r, t, n = {}) {
  const s = Array.isArray(e) ? e.length : 0, i = Array.isArray(r) ? r.length : 0, o = (f, u = -1) => ({
    reusable: !1,
    reason: f,
    residentLen: s,
    deltaStart: 0,
    deltaLen: i,
    firstDivergence: u
  });
  if (n.optOut === !0) return o("opt-out");
  if (n.hasImages === !0) return o("multimodal");
  if (!Array.isArray(e) || s === 0) return o("no-resident-session");
  if (t !== s) return o("seqlen-ledger-mismatch");
  if (i <= s) {
    let f = 0;
    const u = Math.min(s, i);
    for (; f < u && e[f] === r[f]; ) f++;
    return o(i === s && f === u ? "no-new-tokens" : "prompt-shorter", f);
  }
  let a = 0;
  for (; a < s && e[a] === r[a]; ) a++;
  return a !== s ? o("prefix-diverged", a) : {
    reusable: !0,
    reason: "ok",
    residentLen: s,
    deltaStart: s,
    deltaLen: i - s,
    firstDivergence: -1
  };
}
export {
  d as a,
  L as c,
  w as i,
  k as n,
  O as o,
  m as r,
  b as s,
  p as t
};

//# sourceMappingURL=session_manifest-D9A7r9yZ.mjs.map