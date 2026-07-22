var B = class extends Error {
  constructor(e, r) {
    super(r), this.name = "WebGPUUnsupportedError", this.code = e;
  }
}, y = Object.freeze({
  NO_WEBGPU: "no-webgpu",
  NO_ADAPTER: "no-adapter",
  NO_DEVICE: "no-device"
}), N = class extends Error {
  constructor(e, r) {
    super(r), this.name = "MultimodalUnavailableError", this.code = e;
  }
}, w = Object.freeze({ VISION_NOT_LOADED: "vision-not-loaded" }), D = class extends Error {
  constructor(e, r, i = {}) {
    super(r), this.name = "UnsupportedPlanVariantError", this.code = e, this.detail = i;
  }
}, C = Object.freeze({
  Q3_MLP_NOT_PROVISIONED: "q3-mlp-not-provisioned",
  Q3_ALL_NOT_ALLOWED: "q3-all-not-allowed"
}), A = class extends Error {
  constructor(e, r = {}) {
    const i = Array.isArray(r.rungsTried) ? r.rungsTried : [];
    super(`Allocation failed: ${e} (tried ${i.length} fallback plan${i.length === 1 ? "" : "s"})`), this.name = "AllocationFailureError", this.code = e, this.detail = {
      rungsTried: i,
      lastFailurePhase: r.lastFailurePhase || null,
      requestedMiB: typeof r.requestedMiB == "number" ? r.requestedMiB : null,
      deviceMaxBufferMiB: typeof r.deviceMaxBufferMiB == "number" ? r.deviceMaxBufferMiB : null,
      suggestion: typeof r.suggestion == "string" ? r.suggestion : null
    };
  }
}, I = Object.freeze({
  OUT_OF_MEMORY: "out-of-memory",
  EXCEEDS_LIMIT: "exceeds-limit",
  DEVICE_LOST_ESCALATION: "device-lost-escalation",
  LORA_OOM: "lora-oom",
  STRICT_DEGRADE: "strict-degrade"
}), M = class extends Error {
  constructor(e, r, i = {}) {
    super(r), this.name = "ShardedBufferUnsupportedError", this.code = e, this.detail = i;
  }
}, L = Object.freeze({
  SHARDED_LOAD_NOT_YET_WIRED: "sharded-load-not-yet-wired",
  LM_HEAD_TOO_FRAGMENTED: "lm-head-too-fragmented"
});
function F(e, r) {
  if (typeof DOMException < "u") return new DOMException(r, e);
  const i = new Error(r);
  return i.name = e, i;
}
var H = {
  numLayers: 24,
  hiddenSize: 1024,
  intermediateSize: 3584,
  vocabSize: 248320,
  eps: 1e-6,
  deltanet: {
    numHeads: 16,
    keyHeadDim: 128,
    valueHeadDim: 128,
    convKernelSize: 4
  },
  attention: {
    numQHeads: 8,
    numKVHeads: 2,
    headDim: 256,
    maxSeq: 2048
  },
  attnLayerIndices: [
    3,
    7,
    11,
    15,
    19,
    23
  ]
}, R = {
  numLayers: 24,
  hiddenSize: 2048,
  intermediateSize: 6144,
  vocabSize: 248320,
  eps: 1e-6,
  deltanet: {
    numHeads: 16,
    keyHeadDim: 128,
    valueHeadDim: 128,
    convKernelSize: 4
  },
  attention: {
    numQHeads: 8,
    numKVHeads: 2,
    headDim: 256,
    maxSeq: 2048
  },
  attnLayerIndices: [
    3,
    7,
    11,
    15,
    19,
    23
  ]
}, W = {
  numLayers: 36,
  hiddenSize: 4096,
  intermediateSize: 12288,
  vocabSize: 151669,
  eps: 1e-6,
  attention: {
    numQHeads: 32,
    numKVHeads: 8,
    headDim: 128,
    maxSeq: 2048,
    ungated: !0,
    ropeDim: 128,
    ropeTheta: 1e6
  },
  attnLayerIndices: Array.from({ length: 36 }, (e, r) => r)
}, T = {
  numLayers: 36,
  hiddenSize: 2560,
  intermediateSize: 9728,
  vocabSize: 151669,
  eps: 1e-6,
  attention: {
    numQHeads: 32,
    numKVHeads: 8,
    headDim: 128,
    maxSeq: 2048,
    ungated: !0,
    ropeDim: 128,
    ropeTheta: 5e6
  },
  attnLayerIndices: Array.from({ length: 36 }, (e, r) => r)
}, V = {
  numLayers: 64,
  hiddenSize: 5120,
  intermediateSize: 17408,
  vocabSize: 248320,
  eps: 1e-6,
  deltanet: {
    numKeyHeads: 16,
    numValueHeads: 48,
    keyHeadDim: 128,
    valueHeadDim: 128,
    convKernelSize: 4
  },
  attention: {
    numQHeads: 24,
    numKVHeads: 4,
    headDim: 256,
    maxSeq: 2048
  },
  fullAttentionInterval: 4,
  attnLayerIndices: Array.from({ length: 16 }, (e, r) => r * 4 + 3)
}, G = {
  numLayers: 32,
  hiddenSize: 2560,
  intermediateSize: 9216,
  vocabSize: 248320,
  eps: 1e-6,
  deltanet: {
    numKeyHeads: 16,
    numValueHeads: 32,
    keyHeadDim: 128,
    valueHeadDim: 128,
    convKernelSize: 4
  },
  attention: {
    numQHeads: 16,
    numKVHeads: 4,
    headDim: 256,
    maxSeq: 2048
  },
  fullAttentionInterval: 4,
  attnLayerIndices: [
    3,
    7,
    11,
    15,
    19,
    23,
    27,
    31
  ]
};
function f(e) {
  Object.freeze(e);
  for (const r of Object.keys(e)) {
    const i = e[r];
    i !== null && typeof i == "object" && !Object.isFrozen(i) && f(i);
  }
  return e;
}
var P = f({
  hidden_size: 768,
  intermediate_size: 3072,
  num_heads: 12,
  head_dim: 64,
  out_hidden_size: 1024,
  depth: 12,
  patch_size: 16,
  temporal_patch_size: 2,
  spatial_merge_size: 2,
  num_position_embeddings: 2304,
  num_grid_per_side: 48,
  eps: 1e-6,
  prefix: "visual"
}), k = f({
  hidden_size: 1024,
  intermediate_size: 4096,
  num_heads: 16,
  head_dim: 64,
  out_hidden_size: 2048,
  depth: 24,
  patch_size: 16,
  temporal_patch_size: 2,
  spatial_merge_size: 2,
  num_position_embeddings: 2304,
  num_grid_per_side: 48,
  eps: 1e-6,
  prefix: "visual"
}), $ = f({
  hidden_size: 1152,
  intermediate_size: 4304,
  num_heads: 16,
  head_dim: 72,
  out_hidden_size: 5120,
  depth: 27,
  patch_size: 16,
  temporal_patch_size: 2,
  spatial_merge_size: 2,
  num_position_embeddings: 2304,
  num_grid_per_side: 48,
  eps: 1e-6,
  prefix: "visual"
});
function U(e) {
  if (!e || typeof e != "object") throw new Error("validateVisionConfig: config must be an object");
  for (const s of [
    "hidden_size",
    "intermediate_size",
    "num_heads",
    "head_dim",
    "out_hidden_size",
    "depth",
    "patch_size",
    "temporal_patch_size",
    "spatial_merge_size",
    "num_position_embeddings",
    "num_grid_per_side"
  ]) {
    const u = e[s];
    if (!Number.isInteger(u) || u <= 0) throw new Error(`validateVisionConfig: "${s}" must be a positive integer, got ${u}`);
  }
  if (typeof e.eps != "number" || e.eps <= 0) throw new Error(`validateVisionConfig: "eps" must be a positive number, got ${e.eps}`);
  if (e.prefix !== void 0 && typeof e.prefix != "string") throw new Error('validateVisionConfig: "prefix" must be a string when present');
  const r = e.hidden_size, i = e.num_heads, t = e.head_dim, a = e.num_position_embeddings, n = e.num_grid_per_side, o = e.patch_size, d = e.spatial_merge_size;
  if (i * t !== r) throw new Error(`validateVisionConfig: num_heads(${i}) * head_dim(${t}) != hidden_size(${r})`);
  if (n * n !== a) throw new Error(`validateVisionConfig: num_grid_per_side²(${n * n}) != num_position_embeddings(${a})`);
  if (o % d !== 0) throw new Error(`validateVisionConfig: patch_size(${o}) must be divisible by spatial_merge_size(${d})`);
  if (r % (d * d) !== 0) throw new Error(`validateVisionConfig: hidden_size(${r}) must be divisible by spatial_merge_size²(${d * d})`);
  return e;
}
var b = Object.freeze([
  "shader-f16",
  "subgroups",
  "timestamp-query",
  "chromium-experimental-subgroup-matrix",
  "chromium-experimental-texel-buffer",
  "chromium-experimental-uma-mapping"
]), z = Object.freeze([
  "packed_4x8_integer_dot_product",
  "readonly_and_readwrite_storage_textures",
  "pointer_composite_access",
  "unrestricted_pointer_parameters"
]), q = Object.freeze(["subgroups-f16"]);
function Q(e, r = {}) {
  if (!e) throw new Error("detectCapabilities: adapter is required (call requestAdapter first)");
  const i = r.navigator ?? (typeof navigator < "u" ? navigator : void 0), t = /* @__PURE__ */ new Set();
  for (const _ of b) try {
    e.features && e.features.has && e.features.has(_) && t.add(_);
  } catch {
  }
  const a = /* @__PURE__ */ new Set(), n = i?.gpu?.wgslLanguageFeatures;
  if (n && typeof n.has == "function") for (const _ of z) try {
    n.has(_) && a.add(_);
  } catch {
  }
  const o = O(e), d = h(e.subgroupMinSize, o?.subgroupMinSize, 32), s = h(e.subgroupMaxSize, o?.subgroupMaxSize, Math.max(d, 128)), u = Math.max(4, Number(d) | 0), l = Math.max(u, Number(s) | 0), m = e.limits ?? {}, g = {
    maxBufferSize: c(m.maxBufferSize, 1 << 28),
    maxStorageBufferBindingSize: c(m.maxStorageBufferBindingSize, 1 << 27),
    maxComputeWorkgroupStorageSize: c(m.maxComputeWorkgroupStorageSize, 16384),
    maxComputeWorkgroupSizeX: c(m.maxComputeWorkgroupSizeX, 256),
    maxComputeWorkgroupSizeY: c(m.maxComputeWorkgroupSizeY, 256),
    maxComputeWorkgroupSizeZ: c(m.maxComputeWorkgroupSizeZ, 64),
    maxComputeInvocationsPerWorkgroup: c(m.maxComputeInvocationsPerWorkgroup, 256),
    maxComputeWorkgroupsPerDimension: c(m.maxComputeWorkgroupsPerDimension, 65535)
  }, S = {
    architecture: p(o?.architecture),
    vendor: p(o?.vendor),
    device: p(o?.device),
    description: p(o?.description)
  }, v = {
    deviceFeatures: new Set(t),
    wgslFeatures: new Set(a),
    hasF16: t.has("shader-f16"),
    hasSubgroups: t.has("subgroups") && u === 32 && l === 32,
    hasTimestampQuery: t.has("timestamp-query"),
    hasSubgroupMatrix: t.has("chromium-experimental-subgroup-matrix"),
    hasTexelBuffer: t.has("chromium-experimental-texel-buffer"),
    hasUMAMapping: t.has("chromium-experimental-uma-mapping"),
    hasDP4A: a.has("packed_4x8_integer_dot_product"),
    subgroupMinSize: u,
    subgroupMaxSize: l,
    limits: g,
    vendor: S
  };
  return Object.freeze(v);
}
function E(e) {
  const r = e.vendor ?? {}, i = (r.architecture ?? "").toLowerCase(), t = (r.vendor ?? "").toLowerCase(), a = (r.description ?? "").toLowerCase();
  return !!(i.startsWith("apple") || t === "apple" || a.includes("apple") && (a.includes("m1") || a.includes("m2") || a.includes("m3") || a.includes("m4")));
}
function x(e) {
  if (!e || !e.limits) throw new Error("perBufferShardCeiling: caps with .limits is required");
  const r = Number(e.limits.maxBufferSize) || 0;
  return E(e) ? Math.min(r, 128 * 1024 * 1024) : Math.max(0, r - 4 * 1024 * 1024);
}
function j(e, r = 26e8, i = void 0) {
  if (!e || !e.limits) throw new Error("canRunLargeModel: caps with .limits is required");
  const t = 1024 * 1024 * 1024, a = Number(e.limits.maxBufferSize) || 0, n = Number(e.limits.maxStorageBufferBindingSize) || 0, o = 2 * t, d = 1 * t, s = i !== void 0 ? i : typeof navigator < "u" ? navigator.deviceMemory : void 0, u = s == null ? !0 : s >= 8;
  return a < o ? {
    capable: !1,
    reason: `maxBufferSize ${(a / t).toFixed(2)} GiB < 2 GiB (device-class proxy)`,
    maxBufferSize: a
  } : n < d ? {
    capable: !1,
    reason: `maxStorageBufferBindingSize ${(n / t).toFixed(2)} GiB < 1 GiB`,
    maxBufferSize: a
  } : u ? {
    capable: !0,
    reason: `maxBufferSize ${(a / t).toFixed(2)} GiB ≥ 2 GiB` + (s ? `, deviceMemory ${s} GB` : "") + ` ⇒ can host ${(r / t).toFixed(1)} GB`,
    maxBufferSize: a
  } : {
    capable: !1,
    reason: `navigator.deviceMemory ${s} GB < 8 GB`,
    maxBufferSize: a
  };
}
function K(e, r, i = {}) {
  if (!e || !e.limits) throw new Error("decideShardingPolicy: caps with .limits is required");
  if (!r || typeof r != "object") throw new Error("decideShardingPolicy: sizes object is required");
  const t = Number(r.embedBytes), a = Number(r.lmHeadBytes);
  if (!Number.isFinite(t) || t < 0) throw new Error(`decideShardingPolicy: embedBytes must be a non-negative finite number (got ${r.embedBytes})`);
  if (!Number.isFinite(a) || a < 0) throw new Error(`decideShardingPolicy: lmHeadBytes must be a non-negative finite number (got ${r.lmHeadBytes})`);
  const n = x(e), o = t > n, d = a > n, s = o || d;
  let u = s, l = !1;
  if (i.forceSharding === !0)
    u = !0, l = !s;
  else if (i.forceSharding === !1)
    u = !1, l = s;
  else if (i.forceSharding !== void 0) throw new Error(`decideShardingPolicy: opts.forceSharding must be true, false, or undefined (got ${i.forceSharding})`);
  return Object.freeze({
    ceiling: n,
    needsEmbeddingShard: o,
    needsLMHeadShard: d,
    useShardedWeights: u,
    forced: l
  });
}
var Y = Object.freeze({
  SCALAR: "scalar",
  DP4A: "dp4a",
  WMMA: "subgroup-matrix"
});
function h(...e) {
  for (const r of e) if (r != null) return r;
}
function c(e, r) {
  const i = Number(e);
  return Number.isFinite(i) && i > 0 ? i : r;
}
function p(e) {
  if (typeof e != "string") return null;
  const r = e.trim();
  return r.length > 0 ? r : null;
}
function O(e) {
  try {
    return e.info ?? null;
  } catch {
    return null;
  }
}
export {
  C as _,
  $ as a,
  B as b,
  V as c,
  W as d,
  A as f,
  M as g,
  L as h,
  P as i,
  R as l,
  N as m,
  K as n,
  U as o,
  w as p,
  Q as r,
  H as s,
  j as t,
  G as u,
  D as v,
  F as x,
  y
};

//# sourceMappingURL=capabilities-CyA_QRlM.mjs.map