var O = class extends Error {
  constructor(e, r) {
    super(r), this.name = "WebGPUUnsupportedError", this.code = e;
  }
}, M = Object.freeze({
  NO_WEBGPU: "no-webgpu",
  NO_ADAPTER: "no-adapter",
  NO_DEVICE: "no-device"
}), A = class extends Error {
  constructor(e, r) {
    super(r), this.name = "MultimodalUnavailableError", this.code = e;
  }
}, w = Object.freeze({ VISION_NOT_LOADED: "vision-not-loaded" }), y = class extends Error {
  constructor(e, r, t = {}) {
    super(r), this.name = "UnsupportedPlanVariantError", this.code = e, this.detail = t;
  }
}, z = Object.freeze({
  Q3_MLP_NOT_PROVISIONED: "q3-mlp-not-provisioned",
  Q3_ALL_NOT_ALLOWED: "q3-all-not-allowed"
}), D = class extends Error {
  constructor(e, r = {}) {
    const t = Array.isArray(r.rungsTried) ? r.rungsTried : [];
    super(`Allocation failed: ${e} (tried ${t.length} fallback plan${t.length === 1 ? "" : "s"})`), this.name = "AllocationFailureError", this.code = e, this.detail = {
      rungsTried: t,
      lastFailurePhase: r.lastFailurePhase || null,
      requestedMiB: typeof r.requestedMiB == "number" ? r.requestedMiB : null,
      deviceMaxBufferMiB: typeof r.deviceMaxBufferMiB == "number" ? r.deviceMaxBufferMiB : null,
      suggestion: typeof r.suggestion == "string" ? r.suggestion : null
    };
  }
}, N = Object.freeze({
  OUT_OF_MEMORY: "out-of-memory",
  EXCEEDS_LIMIT: "exceeds-limit",
  DEVICE_LOST_ESCALATION: "device-lost-escalation",
  LORA_OOM: "lora-oom",
  STRICT_DEGRADE: "strict-degrade"
}), R = class extends Error {
  constructor(e, r, t = {}) {
    super(r), this.name = "ShardedBufferUnsupportedError", this.code = e, this.detail = t;
  }
}, C = Object.freeze({
  SHARDED_LOAD_NOT_YET_WIRED: "sharded-load-not-yet-wired",
  LM_HEAD_TOO_FRAGMENTED: "lm-head-too-fragmented"
});
function L(e, r) {
  if (typeof DOMException < "u") return new DOMException(r, e);
  const t = new Error(r);
  return t.name = e, t;
}
var x = Object.freeze([
  "shader-f16",
  "subgroups",
  "timestamp-query",
  "chromium-experimental-subgroup-matrix",
  "chromium-experimental-texel-buffer",
  "chromium-experimental-uma-mapping"
]), b = Object.freeze([
  "packed_4x8_integer_dot_product",
  "readonly_and_readwrite_storage_textures",
  "pointer_composite_access",
  "unrestricted_pointer_parameters"
]), T = Object.freeze(["subgroups-f16"]);
function P(e, r = {}) {
  if (!e) throw new Error("detectCapabilities: adapter is required (call requestAdapter first)");
  const t = r.navigator ?? (typeof navigator < "u" ? navigator : void 0), i = /* @__PURE__ */ new Set();
  for (const l of x) try {
    e.features && e.features.has && e.features.has(l) && i.add(l);
  } catch {
  }
  const o = /* @__PURE__ */ new Set(), s = t?.gpu?.wgslLanguageFeatures;
  if (s && typeof s.has == "function") for (const l of b) try {
    s.has(l) && o.add(l);
  } catch {
  }
  const a = v(e), f = g(e.subgroupMinSize, a?.subgroupMinSize, 32), n = g(e.subgroupMaxSize, a?.subgroupMaxSize, Math.max(f, 128)), u = Math.max(4, Number(f) | 0), m = Math.max(u, Number(n) | 0), c = e.limits ?? {}, h = {
    maxBufferSize: d(c.maxBufferSize, 1 << 28),
    maxStorageBufferBindingSize: d(c.maxStorageBufferBindingSize, 1 << 27),
    maxComputeWorkgroupStorageSize: d(c.maxComputeWorkgroupStorageSize, 16384),
    maxComputeWorkgroupSizeX: d(c.maxComputeWorkgroupSizeX, 256),
    maxComputeWorkgroupSizeY: d(c.maxComputeWorkgroupSizeY, 256),
    maxComputeWorkgroupSizeZ: d(c.maxComputeWorkgroupSizeZ, 64),
    maxComputeInvocationsPerWorkgroup: d(c.maxComputeInvocationsPerWorkgroup, 256),
    maxComputeWorkgroupsPerDimension: d(c.maxComputeWorkgroupsPerDimension, 65535)
  }, S = {
    architecture: p(a?.architecture),
    vendor: p(a?.vendor),
    device: p(a?.device),
    description: p(a?.description)
  }, E = {
    deviceFeatures: new Set(i),
    wgslFeatures: new Set(o),
    hasF16: i.has("shader-f16"),
    hasSubgroups: i.has("subgroups") && u === 32 && m === 32,
    hasTimestampQuery: i.has("timestamp-query"),
    hasSubgroupMatrix: i.has("chromium-experimental-subgroup-matrix"),
    hasTexelBuffer: i.has("chromium-experimental-texel-buffer"),
    hasUMAMapping: i.has("chromium-experimental-uma-mapping"),
    hasDP4A: o.has("packed_4x8_integer_dot_product"),
    subgroupMinSize: u,
    subgroupMaxSize: m,
    limits: h,
    vendor: S
  };
  return Object.freeze(E);
}
function _(e) {
  const r = e.vendor ?? {}, t = (r.architecture ?? "").toLowerCase(), i = (r.vendor ?? "").toLowerCase(), o = (r.description ?? "").toLowerCase();
  return !!(t.startsWith("apple") || i === "apple" || o.includes("apple") && (o.includes("m1") || o.includes("m2") || o.includes("m3") || o.includes("m4")));
}
function B(e) {
  if (!e || !e.limits) throw new Error("perBufferShardCeiling: caps with .limits is required");
  const r = Number(e.limits.maxBufferSize) || 0;
  return _(e) ? Math.min(r, 128 * 1024 * 1024) : Math.max(0, r - 4 * 1024 * 1024);
}
function F(e, r = 26e8, t = void 0) {
  if (!e || !e.limits) throw new Error("canRunLargeModel: caps with .limits is required");
  const i = 1024 * 1024 * 1024, o = Number(e.limits.maxBufferSize) || 0, s = Number(e.limits.maxStorageBufferBindingSize) || 0, a = 2 * i, f = 1 * i, n = t !== void 0 ? t : typeof navigator < "u" ? navigator.deviceMemory : void 0, u = n == null ? !0 : n >= 8;
  return o < a ? {
    capable: !1,
    reason: `maxBufferSize ${(o / i).toFixed(2)} GiB < 2 GiB (device-class proxy)`,
    maxBufferSize: o
  } : s < f ? {
    capable: !1,
    reason: `maxStorageBufferBindingSize ${(s / i).toFixed(2)} GiB < 1 GiB`,
    maxBufferSize: o
  } : u ? {
    capable: !0,
    reason: `maxBufferSize ${(o / i).toFixed(2)} GiB ≥ 2 GiB` + (n ? `, deviceMemory ${n} GB` : "") + ` ⇒ can host ${(r / i).toFixed(1)} GB`,
    maxBufferSize: o
  } : {
    capable: !1,
    reason: `navigator.deviceMemory ${n} GB < 8 GB`,
    maxBufferSize: o
  };
}
function W(e, r, t = {}) {
  if (!e || !e.limits) throw new Error("decideShardingPolicy: caps with .limits is required");
  if (!r || typeof r != "object") throw new Error("decideShardingPolicy: sizes object is required");
  const i = Number(r.embedBytes), o = Number(r.lmHeadBytes);
  if (!Number.isFinite(i) || i < 0) throw new Error(`decideShardingPolicy: embedBytes must be a non-negative finite number (got ${r.embedBytes})`);
  if (!Number.isFinite(o) || o < 0) throw new Error(`decideShardingPolicy: lmHeadBytes must be a non-negative finite number (got ${r.lmHeadBytes})`);
  const s = B(e), a = i > s, f = o > s, n = a || f;
  let u = n, m = !1;
  if (t.forceSharding === !0)
    u = !0, m = !n;
  else if (t.forceSharding === !1)
    u = !1, m = n;
  else if (t.forceSharding !== void 0) throw new Error(`decideShardingPolicy: opts.forceSharding must be true, false, or undefined (got ${t.forceSharding})`);
  return Object.freeze({
    ceiling: s,
    needsEmbeddingShard: a,
    needsLMHeadShard: f,
    useShardedWeights: u,
    forced: m
  });
}
var U = Object.freeze({
  SCALAR: "scalar",
  DP4A: "dp4a",
  WMMA: "subgroup-matrix"
});
function g(...e) {
  for (const r of e) if (r != null) return r;
}
function d(e, r) {
  const t = Number(e);
  return Number.isFinite(t) && t > 0 ? t : r;
}
function p(e) {
  if (typeof e != "string") return null;
  const r = e.trim();
  return r.length > 0 ? r : null;
}
function v(e) {
  try {
    return e.info ?? null;
  } catch {
    return null;
  }
}
export {
  w as a,
  R as c,
  M as d,
  O as f,
  D as i,
  z as l,
  W as n,
  A as o,
  L as p,
  P as r,
  C as s,
  F as t,
  y as u
};

//# sourceMappingURL=capabilities-DjEhHCqr.mjs.map