var y = class extends Error {
  constructor(e, r) {
    super(r), this.name = "WebGPUUnsupportedError", this.code = e;
  }
}, N = Object.freeze({
  NO_WEBGPU: "no-webgpu",
  NO_ADAPTER: "no-adapter",
  NO_DEVICE: "no-device"
}), w = class extends Error {
  constructor(e, r) {
    super(r), this.name = "MultimodalUnavailableError", this.code = e;
  }
}, D = Object.freeze({ VISION_NOT_LOADED: "vision-not-loaded" }), I = class extends Error {
  constructor(e, r, i = {}) {
    super(r), this.name = "UnsupportedPlanVariantError", this.code = e, this.detail = i;
  }
}, A = Object.freeze({
  Q3_MLP_NOT_PROVISIONED: "q3-mlp-not-provisioned",
  Q3_ALL_NOT_ALLOWED: "q3-all-not-allowed"
}), C = class extends Error {
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
}, M = Object.freeze({
  OUT_OF_MEMORY: "out-of-memory",
  EXCEEDS_LIMIT: "exceeds-limit",
  DEVICE_LOST_ESCALATION: "device-lost-escalation",
  LORA_OOM: "lora-oom",
  STRICT_DEGRADE: "strict-degrade"
}), L = class extends Error {
  constructor(e, r, i = {}) {
    super(r), this.name = "ShardedBufferUnsupportedError", this.code = e, this.detail = i;
  }
}, H = Object.freeze({
  SHARDED_LOAD_NOT_YET_WIRED: "sharded-load-not-yet-wired",
  LM_HEAD_TOO_FRAGMENTED: "lm-head-too-fragmented"
});
function F(e, r) {
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
}, T = {
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
}, R = {
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
function h(e) {
  Object.freeze(e);
  for (const r of Object.keys(e)) {
    const i = e[r];
    i !== null && typeof i == "object" && !Object.isFrozen(i) && h(i);
  }
  return e;
}
var k = h({
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
}), $ = h({
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
function j(e) {
  if (!e || typeof e != "object") throw new Error("validateVisionConfig: config must be an object");
  for (const o of [
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
    const u = e[o];
    if (!Number.isInteger(u) || u <= 0) throw new Error(`validateVisionConfig: "${o}" must be a positive integer, got ${u}`);
  }
  if (typeof e.eps != "number" || e.eps <= 0) throw new Error(`validateVisionConfig: "eps" must be a positive number, got ${e.eps}`);
  if (e.prefix !== void 0 && typeof e.prefix != "string") throw new Error('validateVisionConfig: "prefix" must be a string when present');
  const r = e.hidden_size, i = e.num_heads, t = e.head_dim, a = e.num_position_embeddings, n = e.num_grid_per_side, d = e.patch_size, s = e.spatial_merge_size;
  if (i * t !== r) throw new Error(`validateVisionConfig: num_heads(${i}) * head_dim(${t}) != hidden_size(${r})`);
  if (n * n !== a) throw new Error(`validateVisionConfig: num_grid_per_side²(${n * n}) != num_position_embeddings(${a})`);
  if (d % s !== 0) throw new Error(`validateVisionConfig: patch_size(${d}) must be divisible by spatial_merge_size(${s})`);
  if (r % (s * s) !== 0) throw new Error(`validateVisionConfig: hidden_size(${r}) must be divisible by spatial_merge_size²(${s * s})`);
  return e;
}
function v(e) {
  return 3 * e.temporal_patch_size * e.patch_size * e.patch_size;
}
var q = 1 << 20, Q = Object.freeze({
  matmul: "f32",
  patchEmbed: "f32",
  posEmbed: "f32",
  enabled: !1
});
function K(e, r = !1) {
  if (!e || typeof e != "object") throw new Error("visionWeightPlan: config must be an object");
  const i = e.hidden_size, t = e.intermediate_size, a = e.out_hidden_size, n = e.spatial_merge_size, d = e.num_position_embeddings, s = i * n * n, o = v(e), u = [
    i * i,
    i * t,
    s * s,
    s * a
  ].map((_) => _ * 4), c = (_) => r && _ >= 1048576 ? "f16" : "f32", m = {
    matmul: c(Math.min(...u)),
    patchEmbed: c(o * i * 4),
    posEmbed: c(d * i * 4)
  };
  return m.enabled = m.matmul === "f16" || m.patchEmbed === "f16" || m.posEmbed === "f16", m;
}
var z = Object.freeze([
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
  const i = r.navigator ?? (typeof navigator < "u" ? navigator : void 0), t = /* @__PURE__ */ new Set();
  for (const p of z) try {
    e.features && e.features.has && e.features.has(p) && t.add(p);
  } catch {
  }
  const a = /* @__PURE__ */ new Set(), n = i?.gpu?.wgslLanguageFeatures;
  if (n && typeof n.has == "function") for (const p of E) try {
    n.has(p) && a.add(p);
  } catch {
  }
  const d = B(e), s = g(e.subgroupMinSize, d?.subgroupMinSize, 32), o = g(e.subgroupMaxSize, d?.subgroupMaxSize, Math.max(s, 128)), u = Math.max(4, Number(s) | 0), c = Math.max(u, Number(o) | 0), m = e.limits ?? {}, _ = {
    maxBufferSize: l(m.maxBufferSize, 1 << 28),
    maxStorageBufferBindingSize: l(m.maxStorageBufferBindingSize, 1 << 27),
    maxComputeWorkgroupStorageSize: l(m.maxComputeWorkgroupStorageSize, 16384),
    maxComputeWorkgroupSizeX: l(m.maxComputeWorkgroupSizeX, 256),
    maxComputeWorkgroupSizeY: l(m.maxComputeWorkgroupSizeY, 256),
    maxComputeWorkgroupSizeZ: l(m.maxComputeWorkgroupSizeZ, 64),
    maxComputeInvocationsPerWorkgroup: l(m.maxComputeInvocationsPerWorkgroup, 256),
    maxComputeWorkgroupsPerDimension: l(m.maxComputeWorkgroupsPerDimension, 65535)
  }, S = {
    architecture: f(d?.architecture),
    vendor: f(d?.vendor),
    device: f(d?.device),
    description: f(d?.description)
  }, b = {
    deviceFeatures: new Set(t),
    wgslFeatures: new Set(a),
    hasF16: t.has("shader-f16"),
    hasSubgroups: t.has("subgroups") && u === 32 && c === 32,
    hasTimestampQuery: t.has("timestamp-query"),
    hasSubgroupMatrix: t.has("chromium-experimental-subgroup-matrix"),
    hasTexelBuffer: t.has("chromium-experimental-texel-buffer"),
    hasUMAMapping: t.has("chromium-experimental-uma-mapping"),
    hasDP4A: a.has("packed_4x8_integer_dot_product"),
    subgroupMinSize: u,
    subgroupMaxSize: c,
    limits: _,
    vendor: S
  };
  return Object.freeze(b);
}
function x(e) {
  const r = e.vendor ?? {}, i = (r.architecture ?? "").toLowerCase(), t = (r.vendor ?? "").toLowerCase(), a = (r.description ?? "").toLowerCase();
  return !!(i.startsWith("apple") || t === "apple" || a.includes("apple") && (a.includes("m1") || a.includes("m2") || a.includes("m3") || a.includes("m4")));
}
function O(e) {
  if (!e || !e.limits) throw new Error("perBufferShardCeiling: caps with .limits is required");
  const r = Number(e.limits.maxBufferSize) || 0;
  return x(e) ? Math.min(r, 128 * 1024 * 1024) : Math.max(0, r - 4 * 1024 * 1024);
}
function Z(e, r = 26e8, i = void 0) {
  if (!e || !e.limits) throw new Error("canRunLargeModel: caps with .limits is required");
  const t = 1024 * 1024 * 1024, a = Number(e.limits.maxBufferSize) || 0, n = Number(e.limits.maxStorageBufferBindingSize) || 0, d = 2 * t, s = 1 * t, o = i !== void 0 ? i : typeof navigator < "u" ? navigator.deviceMemory : void 0, u = o == null ? !0 : o >= 8;
  return a < d ? {
    capable: !1,
    reason: `maxBufferSize ${(a / t).toFixed(2)} GiB < 2 GiB (device-class proxy)`,
    maxBufferSize: a
  } : n < s ? {
    capable: !1,
    reason: `maxStorageBufferBindingSize ${(n / t).toFixed(2)} GiB < 1 GiB`,
    maxBufferSize: a
  } : u ? {
    capable: !0,
    reason: `maxBufferSize ${(a / t).toFixed(2)} GiB ≥ 2 GiB` + (o ? `, deviceMemory ${o} GB` : "") + ` ⇒ can host ${(r / t).toFixed(1)} GB`,
    maxBufferSize: a
  } : {
    capable: !1,
    reason: `navigator.deviceMemory ${o} GB < 8 GB`,
    maxBufferSize: a
  };
}
function J(e, r, i = {}) {
  if (!e || !e.limits) throw new Error("decideShardingPolicy: caps with .limits is required");
  if (!r || typeof r != "object") throw new Error("decideShardingPolicy: sizes object is required");
  const t = Number(r.embedBytes), a = Number(r.lmHeadBytes);
  if (!Number.isFinite(t) || t < 0) throw new Error(`decideShardingPolicy: embedBytes must be a non-negative finite number (got ${r.embedBytes})`);
  if (!Number.isFinite(a) || a < 0) throw new Error(`decideShardingPolicy: lmHeadBytes must be a non-negative finite number (got ${r.lmHeadBytes})`);
  const n = O(e), d = t > n, s = a > n, o = d || s;
  let u = o, c = !1;
  if (i.forceSharding === !0)
    u = !0, c = !o;
  else if (i.forceSharding === !1)
    u = !1, c = o;
  else if (i.forceSharding !== void 0) throw new Error(`decideShardingPolicy: opts.forceSharding must be true, false, or undefined (got ${i.forceSharding})`);
  return Object.freeze({
    ceiling: n,
    needsEmbeddingShard: d,
    needsLMHeadShard: s,
    useShardedWeights: u,
    forced: c
  });
}
var ee = Object.freeze({
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
  F as C,
  y as S,
  H as _,
  k as a,
  I as b,
  K as c,
  T as d,
  G as f,
  w as g,
  D as h,
  Q as i,
  W as l,
  C as m,
  J as n,
  U as o,
  R as p,
  X as r,
  j as s,
  Z as t,
  V as u,
  L as v,
  N as x,
  A as y
};

//# sourceMappingURL=capabilities-C3V5F_03.mjs.map