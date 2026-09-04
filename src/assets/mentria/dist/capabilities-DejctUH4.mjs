var w = class extends Error {
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
}, D = Object.freeze({ VISION_NOT_LOADED: "vision-not-loaded" }), I = class extends Error {
  constructor(e, r, i = {}) {
    super(r), this.name = "UnsupportedPlanVariantError", this.code = e, this.detail = i;
  }
}, C = Object.freeze({
  Q3_MLP_NOT_PROVISIONED: "q3-mlp-not-provisioned",
  Q3_ALL_NOT_ALLOWED: "q3-all-not-allowed"
}), M = class extends Error {
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
}, A = Object.freeze({
  OUT_OF_MEMORY: "out-of-memory",
  EXCEEDS_LIMIT: "exceeds-limit",
  DEVICE_LOST_ESCALATION: "device-lost-escalation",
  LORA_OOM: "lora-oom",
  STRICT_DEGRADE: "strict-degrade"
}), L = class extends Error {
  constructor(e, r, i = {}) {
    super(r), this.name = "ShardedBufferUnsupportedError", this.code = e, this.detail = i;
  }
}, F = Object.freeze({
  SHARDED_LOAD_NOT_YET_WIRED: "sharded-load-not-yet-wired",
  LM_HEAD_TOO_FRAGMENTED: "lm-head-too-fragmented"
});
function H(e, r) {
  if (typeof DOMException < "u") return new DOMException(r, e);
  const i = new Error(r);
  return i.name = e, i;
}
var W = {
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
}, T = {
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
}, P = {
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
}, G = {
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
}, V = {
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
function h(e) {
  Object.freeze(e);
  for (const r of Object.keys(e)) {
    const i = e[r];
    i !== null && typeof i == "object" && !Object.isFrozen(i) && h(i);
  }
  return e;
}
var $ = h({
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
}), k = h({
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
}), U = h({
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
function q(e) {
  if (!e || typeof e != "object") throw new Error("validateVisionConfig: config must be an object");
  for (const u of [
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
    const d = e[u];
    if (!Number.isInteger(d) || d <= 0) throw new Error(`validateVisionConfig: "${u}" must be a positive integer, got ${d}`);
  }
  if (typeof e.eps != "number" || e.eps <= 0) throw new Error(`validateVisionConfig: "eps" must be a positive number, got ${e.eps}`);
  if (e.prefix !== void 0 && typeof e.prefix != "string") throw new Error('validateVisionConfig: "prefix" must be a string when present');
  const r = e.hidden_size, i = e.num_heads, a = e.head_dim, t = e.num_position_embeddings, n = e.num_grid_per_side, s = e.patch_size, o = e.spatial_merge_size;
  if (i * a !== r) throw new Error(`validateVisionConfig: num_heads(${i}) * head_dim(${a}) != hidden_size(${r})`);
  if (n * n !== t) throw new Error(`validateVisionConfig: num_grid_per_side²(${n * n}) != num_position_embeddings(${t})`);
  if (s % o !== 0) throw new Error(`validateVisionConfig: patch_size(${s}) must be divisible by spatial_merge_size(${o})`);
  if (r % (o * o) !== 0) throw new Error(`validateVisionConfig: hidden_size(${r}) must be divisible by spatial_merge_size²(${o * o})`);
  return e;
}
function z(e) {
  return 3 * e.temporal_patch_size * e.patch_size * e.patch_size;
}
var j = 1 << 20, Q = Object.freeze({
  matmul: "f32",
  patchEmbed: "f32",
  posEmbed: "f32",
  enabled: !1
});
function K(e, r = !1) {
  if (!e || typeof e != "object") throw new Error("visionWeightPlan: config must be an object");
  const i = e.hidden_size, a = e.intermediate_size, t = e.out_hidden_size, n = e.spatial_merge_size, s = e.num_position_embeddings, o = i * n * n, u = z(e), d = [
    i * i,
    i * a,
    o * o,
    o * t
  ].map((p) => p * 4), c = (p) => r && p >= 1048576 ? "f16" : "f32", m = {
    matmul: c(Math.min(...d)),
    patchEmbed: c(u * i * 4),
    posEmbed: c(s * i * 4)
  };
  return m.enabled = m.matmul === "f16" || m.patchEmbed === "f16" || m.posEmbed === "f16", m;
}
var v = Object.freeze([
  "shader-f16",
  "subgroups",
  "timestamp-query",
  "chromium-experimental-subgroup-matrix",
  "chromium-experimental-texel-buffer",
  "chromium-experimental-uma-mapping"
]), E = Object.freeze([
  "packed_4x8_integer_dot_product",
  "readonly_and_readwrite_storage_textures",
  "pointer_composite_access",
  "unrestricted_pointer_parameters"
]), Y = Object.freeze(["subgroups-f16"]);
function X(e, r = {}) {
  if (!e) throw new Error("detectCapabilities: adapter is required (call requestAdapter first)");
  const i = r.navigator ?? (typeof navigator < "u" ? navigator : void 0), a = /* @__PURE__ */ new Set();
  for (const _ of v) try {
    e.features && e.features.has && e.features.has(_) && a.add(_);
  } catch {
  }
  const t = /* @__PURE__ */ new Set(), n = i?.gpu?.wgslLanguageFeatures;
  if (n && typeof n.has == "function") for (const _ of E) try {
    n.has(_) && t.add(_);
  } catch {
  }
  const s = B(e), o = g(e.subgroupMinSize, s?.subgroupMinSize, 32), u = g(e.subgroupMaxSize, s?.subgroupMaxSize, Math.max(o, 128)), d = Math.max(4, Number(o) | 0), c = Math.max(d, Number(u) | 0), m = e.limits ?? {}, p = {
    maxBufferSize: l(m.maxBufferSize, 1 << 28),
    maxStorageBufferBindingSize: l(m.maxStorageBufferBindingSize, 1 << 27),
    maxComputeWorkgroupStorageSize: l(m.maxComputeWorkgroupStorageSize, 16384),
    maxComputeWorkgroupSizeX: l(m.maxComputeWorkgroupSizeX, 256),
    maxComputeWorkgroupSizeY: l(m.maxComputeWorkgroupSizeY, 256),
    maxComputeWorkgroupSizeZ: l(m.maxComputeWorkgroupSizeZ, 64),
    maxComputeInvocationsPerWorkgroup: l(m.maxComputeInvocationsPerWorkgroup, 256),
    maxComputeWorkgroupsPerDimension: l(m.maxComputeWorkgroupsPerDimension, 65535)
  }, b = {
    architecture: f(s?.architecture),
    vendor: f(s?.vendor),
    device: f(s?.device),
    description: f(s?.description)
  }, S = {
    deviceFeatures: new Set(a),
    wgslFeatures: new Set(t),
    hasF16: a.has("shader-f16"),
    hasSubgroups: a.has("subgroups") && d === 32 && c === 32,
    hasTimestampQuery: a.has("timestamp-query"),
    hasSubgroupMatrix: a.has("chromium-experimental-subgroup-matrix"),
    hasTexelBuffer: a.has("chromium-experimental-texel-buffer"),
    hasUMAMapping: a.has("chromium-experimental-uma-mapping"),
    hasDP4A: t.has("packed_4x8_integer_dot_product"),
    subgroupMinSize: d,
    subgroupMaxSize: c,
    limits: p,
    vendor: b
  };
  return Object.freeze(S);
}
function Z(e) {
  if (!e) throw new Error("narrowSubgroupCapability: caps is required");
  const r = Number(e.subgroupMinSize), i = Number(e.subgroupMaxSize), a = e.deviceFeatures?.has?.("subgroups") === !0, t = (n, s) => ({
    eligible: n,
    width: n ? r : 0,
    narrow: n && r !== 32,
    reason: s
  });
  return a ? !Number.isFinite(r) || !Number.isFinite(i) ? t(!1, "subgroup size not reported") : r !== i ? t(!1, `subgroup size is a RANGE (${r}-${i}); the width-parametric kernels need a point width so \${SUBGROUP_SIZE} matches @builtin(subgroup_size)`) : (r & r - 1) !== 0 ? t(!1, `subgroup size ${r} is not a power of two`) : r < 16 ? t(!1, `subgroup size ${r} < 16; the NUM_SG <= sg_size reduction invariant fails below 16`) : t(!0, `stable ${r}-wide subgroup`) : t(!1, "adapter does not list the subgroups feature");
}
function x(e) {
  const r = e.vendor ?? {}, i = (r.architecture ?? "").toLowerCase(), a = (r.vendor ?? "").toLowerCase(), t = (r.description ?? "").toLowerCase();
  return !!(i.startsWith("apple") || a === "apple" || t.includes("apple") && (t.includes("m1") || t.includes("m2") || t.includes("m3") || t.includes("m4")));
}
function O(e) {
  if (!e || !e.limits) throw new Error("perBufferShardCeiling: caps with .limits is required");
  const r = Number(e.limits.maxBufferSize) || 0, i = Number(e.limits.maxStorageBufferBindingSize) || 0, a = (t) => i > 0 ? Math.min(t, i) : t;
  return x(e) ? a(Math.min(r, 128 * 1024 * 1024)) : a(Math.max(0, r - 4 * 1024 * 1024));
}
function J(e, r = 26e8, i = void 0) {
  if (!e || !e.limits) throw new Error("canRunLargeModel: caps with .limits is required");
  const a = 1024 * 1024 * 1024, t = Number(e.limits.maxBufferSize) || 0, n = Number(e.limits.maxStorageBufferBindingSize) || 0, s = 2 * a, o = 1 * a, u = i !== void 0 ? i : typeof navigator < "u" ? navigator.deviceMemory : void 0, d = u == null ? !0 : u >= 8;
  return t < s ? {
    capable: !1,
    reason: `maxBufferSize ${(t / a).toFixed(2)} GiB < 2 GiB (device-class proxy)`,
    maxBufferSize: t
  } : n < o ? {
    capable: !1,
    reason: `maxStorageBufferBindingSize ${(n / a).toFixed(2)} GiB < 1 GiB`,
    maxBufferSize: t
  } : d ? {
    capable: !0,
    reason: `maxBufferSize ${(t / a).toFixed(2)} GiB ≥ 2 GiB` + (u ? `, deviceMemory ${u} GB` : "") + ` ⇒ can host ${(r / a).toFixed(1)} GB`,
    maxBufferSize: t
  } : {
    capable: !1,
    reason: `navigator.deviceMemory ${u} GB < 8 GB`,
    maxBufferSize: t
  };
}
function ee(e, r, i = {}) {
  if (!e || !e.limits) throw new Error("decideShardingPolicy: caps with .limits is required");
  if (!r || typeof r != "object") throw new Error("decideShardingPolicy: sizes object is required");
  const a = Number(r.embedBytes), t = Number(r.lmHeadBytes);
  if (!Number.isFinite(a) || a < 0) throw new Error(`decideShardingPolicy: embedBytes must be a non-negative finite number (got ${r.embedBytes})`);
  if (!Number.isFinite(t) || t < 0) throw new Error(`decideShardingPolicy: lmHeadBytes must be a non-negative finite number (got ${r.lmHeadBytes})`);
  const n = O(e), s = a > n, o = t > n, u = s || o;
  let d = u, c = !1;
  if (i.forceSharding === !0)
    d = !0, c = !u;
  else if (i.forceSharding === !1)
    d = !1, c = u;
  else if (i.forceSharding !== void 0) throw new Error(`decideShardingPolicy: opts.forceSharding must be true, false, or undefined (got ${i.forceSharding})`);
  return Object.freeze({
    ceiling: n,
    needsEmbeddingShard: s,
    needsLMHeadShard: o,
    useShardedWeights: d,
    forced: c
  });
}
var re = Object.freeze({
  SCALAR: "scalar",
  DP4A: "dp4a",
  WMMA: "subgroup-matrix"
});
function g(...e) {
  for (const r of e) if (r != null) return r;
}
function l(e, r) {
  const i = Number(e);
  return Number.isFinite(i) && i > 0 ? i : r;
}
function f(e) {
  if (typeof e != "string") return null;
  const r = e.trim();
  return r.length > 0 ? r : null;
}
function B(e) {
  try {
    return e.info ?? null;
  } catch {
    return null;
  }
}
export {
  w as C,
  y as S,
  N as _,
  Q as a,
  C as b,
  q as c,
  G as d,
  R as f,
  D as g,
  M as h,
  Z as i,
  K as l,
  T as m,
  ee as n,
  $ as o,
  V as p,
  X as r,
  U as s,
  J as t,
  W as u,
  F as v,
  H as w,
  I as x,
  L as y
};

//# sourceMappingURL=capabilities-DejctUH4.mjs.map