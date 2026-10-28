var y = class extends Error {
  constructor(e, i) {
    super(i), this.name = "WebGPUUnsupportedError", this.code = e;
  }
}, w = Object.freeze({
  NO_WEBGPU: "no-webgpu",
  NO_ADAPTER: "no-adapter",
  NO_DEVICE: "no-device"
}), I = class extends Error {
  constructor(e, i) {
    super(i), this.name = "MultimodalUnavailableError", this.code = e;
  }
}, D = Object.freeze({ VISION_NOT_LOADED: "vision-not-loaded" }), C = class extends Error {
  constructor(e, i, r = {}) {
    super(i), this.name = "UnsupportedPlanVariantError", this.code = e, this.detail = r;
  }
}, A = Object.freeze({
  Q3_MLP_NOT_PROVISIONED: "q3-mlp-not-provisioned",
  Q3_ALL_NOT_ALLOWED: "q3-all-not-allowed"
}), L = class extends Error {
  constructor(e, i = {}) {
    const r = Array.isArray(i.rungsTried) ? i.rungsTried : [], a = `Allocation failed: ${e} (tried ${r.length} fallback plan${r.length === 1 ? "" : "s"})`;
    super(e === "compressed-kv-refused" && typeof i.suggestion == "string" ? `${a}. ${i.suggestion}` : a), this.name = "AllocationFailureError", this.code = e, this.detail = {
      rungsTried: r,
      lastFailurePhase: i.lastFailurePhase || null,
      requestedMiB: typeof i.requestedMiB == "number" ? i.requestedMiB : null,
      deviceMaxBufferMiB: typeof i.deviceMaxBufferMiB == "number" ? i.deviceMaxBufferMiB : null,
      suggestion: typeof i.suggestion == "string" ? i.suggestion : null
    };
  }
}, M = Object.freeze({
  OUT_OF_MEMORY: "out-of-memory",
  EXCEEDS_LIMIT: "exceeds-limit",
  DEVICE_LOST_ESCALATION: "device-lost-escalation",
  LORA_OOM: "lora-oom",
  STRICT_DEGRADE: "strict-degrade",
  COMPRESSED_KV_REFUSED: "compressed-kv-refused"
}), F = class extends Error {
  constructor(e, i, r = {}) {
    super(i), this.name = "ShardedBufferUnsupportedError", this.code = e, this.detail = r;
  }
}, H = Object.freeze({
  SHARDED_LOAD_NOT_YET_WIRED: "sharded-load-not-yet-wired",
  LM_HEAD_TOO_FRAGMENTED: "lm-head-too-fragmented"
});
function V(e, i) {
  if (typeof DOMException < "u") return new DOMException(i, e);
  const r = new Error(i);
  return r.name = e, r;
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
}, G = {
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
  attnLayerIndices: Array.from({ length: 36 }, (e, i) => i)
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
  attnLayerIndices: Array.from({ length: 36 }, (e, i) => i)
}, P = {
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
  attnLayerIndices: Array.from({ length: 16 }, (e, i) => i * 4 + 3)
}, k = {
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
}, $ = {
  numLayers: 32,
  hiddenSize: 4096,
  intermediateSize: 12288,
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
function l(e) {
  Object.freeze(e);
  for (const i of Object.keys(e)) {
    const r = e[i];
    r !== null && typeof r == "object" && !Object.isFrozen(r) && l(r);
  }
  return e;
}
var U = l({
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
}), Q = l({
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
}), q = l({
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
}), j = l({
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
}), K = l({
  hidden_size: 1024,
  intermediate_size: 4096,
  num_heads: 16,
  head_dim: 64,
  out_hidden_size: 2560,
  depth: 24,
  patch_size: 16,
  temporal_patch_size: 2,
  spatial_merge_size: 2,
  num_position_embeddings: 2304,
  num_grid_per_side: 48,
  eps: 1e-6,
  prefix: "visual"
}), Y = l({
  hidden_size: 1152,
  intermediate_size: 4304,
  num_heads: 16,
  head_dim: 72,
  out_hidden_size: 4096,
  depth: 27,
  patch_size: 16,
  temporal_patch_size: 2,
  spatial_merge_size: 2,
  num_position_embeddings: 2304,
  num_grid_per_side: 48,
  eps: 1e-6,
  prefix: "visual"
});
function X(e) {
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
  const i = e.hidden_size, r = e.num_heads, a = e.head_dim, t = e.num_position_embeddings, n = e.num_grid_per_side, d = e.patch_size, s = e.spatial_merge_size;
  if (r * a !== i) throw new Error(`validateVisionConfig: num_heads(${r}) * head_dim(${a}) != hidden_size(${i})`);
  if (n * n !== t) throw new Error(`validateVisionConfig: num_grid_per_side²(${n * n}) != num_position_embeddings(${t})`);
  if (d % s !== 0) throw new Error(`validateVisionConfig: patch_size(${d}) must be divisible by spatial_merge_size(${s})`);
  if (i % (s * s) !== 0) throw new Error(`validateVisionConfig: hidden_size(${i}) must be divisible by spatial_merge_size²(${s * s})`);
  return e;
}
function v(e) {
  return 3 * e.temporal_patch_size * e.patch_size * e.patch_size;
}
var Z = 1 << 20, J = Object.freeze({
  matmul: "f32",
  patchEmbed: "f32",
  posEmbed: "f32",
  enabled: !1
});
function ee(e, i = !1) {
  if (!e || typeof e != "object") throw new Error("visionWeightPlan: config must be an object");
  const r = e.hidden_size, a = e.intermediate_size, t = e.out_hidden_size, n = e.spatial_merge_size, d = e.num_position_embeddings, s = r * n * n, o = v(e), u = [
    r * r,
    r * a,
    s * s,
    s * t
  ].map((m) => m * 4), _ = (m) => i && m >= 1048576 ? "f16" : "f32", p = {
    matmul: _(Math.min(...u)),
    patchEmbed: _(o * r * 4),
    posEmbed: _(d * r * 4)
  };
  return p.enabled = p.matmul === "f16" || p.patchEmbed === "f16" || p.posEmbed === "f16", p;
}
var E = Object.freeze([
  "shader-f16",
  "subgroups",
  "timestamp-query",
  "chromium-experimental-subgroup-matrix",
  "chromium-experimental-texel-buffer",
  "chromium-experimental-uma-mapping"
]), x = Object.freeze([
  "packed_4x8_integer_dot_product",
  "readonly_and_readwrite_storage_textures",
  "pointer_composite_access",
  "unrestricted_pointer_parameters"
]), ie = Object.freeze(["subgroups-f16"]);
function re(e, i = {}) {
  if (!e) throw new Error("detectCapabilities: adapter is required (call requestAdapter first)");
  const r = i.navigator ?? (typeof navigator < "u" ? navigator : void 0), a = new Set(i.dropDeviceFeatures || []), t = /* @__PURE__ */ new Set();
  for (const f of E)
    if (!a.has(f))
      try {
        e.features && e.features.has && e.features.has(f) && t.add(f);
      } catch {
      }
  const n = /* @__PURE__ */ new Set(), d = r?.gpu?.wgslLanguageFeatures;
  if (d && typeof d.has == "function") for (const f of x) try {
    d.has(f) && n.add(f);
  } catch {
  }
  const s = B(e), o = g(e.subgroupMinSize, s?.subgroupMinSize, 32), u = g(e.subgroupMaxSize, s?.subgroupMaxSize, Math.max(o, 128)), _ = Math.max(4, Number(o) | 0), p = Math.max(_, Number(u) | 0), m = e.limits ?? {}, S = {
    maxBufferSize: c(m.maxBufferSize, 1 << 28),
    maxStorageBufferBindingSize: c(m.maxStorageBufferBindingSize, 1 << 27),
    maxComputeWorkgroupStorageSize: c(m.maxComputeWorkgroupStorageSize, 16384),
    maxComputeWorkgroupSizeX: c(m.maxComputeWorkgroupSizeX, 256),
    maxComputeWorkgroupSizeY: c(m.maxComputeWorkgroupSizeY, 256),
    maxComputeWorkgroupSizeZ: c(m.maxComputeWorkgroupSizeZ, 64),
    maxComputeInvocationsPerWorkgroup: c(m.maxComputeInvocationsPerWorkgroup, 256),
    maxComputeWorkgroupsPerDimension: c(m.maxComputeWorkgroupsPerDimension, 65535)
  }, b = {
    architecture: h(s?.architecture),
    vendor: h(s?.vendor),
    device: h(s?.device),
    description: h(s?.description)
  }, z = {
    deviceFeatures: new Set(t),
    wgslFeatures: new Set(n),
    hasF16: t.has("shader-f16"),
    hasSubgroups: t.has("subgroups") && _ === 32 && p === 32,
    hasTimestampQuery: t.has("timestamp-query"),
    hasSubgroupMatrix: t.has("chromium-experimental-subgroup-matrix"),
    hasTexelBuffer: t.has("chromium-experimental-texel-buffer"),
    hasUMAMapping: t.has("chromium-experimental-uma-mapping"),
    hasDP4A: n.has("packed_4x8_integer_dot_product"),
    subgroupMinSize: _,
    subgroupMaxSize: p,
    limits: S,
    vendor: b
  };
  return Object.freeze(z);
}
function te(e) {
  if (!e) throw new Error("narrowSubgroupCapability: caps is required");
  const i = Number(e.subgroupMinSize), r = Number(e.subgroupMaxSize), a = e.deviceFeatures?.has?.("subgroups") === !0, t = (n, d) => ({
    eligible: n,
    width: n ? i : 0,
    narrow: n && i !== 32,
    reason: d
  });
  return a ? !Number.isFinite(i) || !Number.isFinite(r) ? t(!1, "subgroup size not reported") : i !== r ? t(!1, `subgroup size is a RANGE (${i}-${r}); the width-parametric kernels need a point width so \${SUBGROUP_SIZE} matches @builtin(subgroup_size)`) : (i & i - 1) !== 0 ? t(!1, `subgroup size ${i} is not a power of two`) : i < 16 ? t(!1, `subgroup size ${i} < 16; the NUM_SG <= sg_size reduction invariant fails below 16`) : t(!0, `stable ${i}-wide subgroup`) : t(!1, "adapter does not list the subgroups feature");
}
function O(e) {
  const i = e.vendor ?? {}, r = (i.architecture ?? "").toLowerCase(), a = (i.vendor ?? "").toLowerCase(), t = (i.description ?? "").toLowerCase();
  return !!(r.startsWith("apple") || a === "apple" || t.includes("apple") && (t.includes("m1") || t.includes("m2") || t.includes("m3") || t.includes("m4")));
}
function N(e) {
  if (!e || !e.limits) throw new Error("perBufferShardCeiling: caps with .limits is required");
  const i = Number(e.limits.maxBufferSize) || 0, r = Number(e.limits.maxStorageBufferBindingSize) || 0, a = (t) => r > 0 ? Math.min(t, r) : t;
  return O(e) ? a(Math.min(i, 128 * 1024 * 1024)) : a(Math.max(0, i - 4 * 1024 * 1024));
}
function ae(e, i = 26e8, r = void 0) {
  if (!e || !e.limits) throw new Error("canRunLargeModel: caps with .limits is required");
  const a = 1024 * 1024 * 1024, t = Number(e.limits.maxBufferSize) || 0, n = Number(e.limits.maxStorageBufferBindingSize) || 0, d = 2 * a, s = 1 * a, o = r !== void 0 ? r : typeof navigator < "u" ? navigator.deviceMemory : void 0, u = o == null ? !0 : o >= 8;
  return t < d ? {
    capable: !1,
    reason: `maxBufferSize ${(t / a).toFixed(2)} GiB < 2 GiB (device-class proxy)`,
    maxBufferSize: t
  } : n < s ? {
    capable: !1,
    reason: `maxStorageBufferBindingSize ${(n / a).toFixed(2)} GiB < 1 GiB`,
    maxBufferSize: t
  } : u ? {
    capable: !0,
    reason: `maxBufferSize ${(t / a).toFixed(2)} GiB ≥ 2 GiB` + (o ? `, deviceMemory ${o} GB` : "") + ` ⇒ can host ${(i / a).toFixed(1)} GB`,
    maxBufferSize: t
  } : {
    capable: !1,
    reason: `navigator.deviceMemory ${o} GB < 8 GB`,
    maxBufferSize: t
  };
}
function ne(e, i, r = {}) {
  if (!e || !e.limits) throw new Error("decideShardingPolicy: caps with .limits is required");
  if (!i || typeof i != "object") throw new Error("decideShardingPolicy: sizes object is required");
  const a = Number(i.embedBytes), t = Number(i.lmHeadBytes);
  if (!Number.isFinite(a) || a < 0) throw new Error(`decideShardingPolicy: embedBytes must be a non-negative finite number (got ${i.embedBytes})`);
  if (!Number.isFinite(t) || t < 0) throw new Error(`decideShardingPolicy: lmHeadBytes must be a non-negative finite number (got ${i.lmHeadBytes})`);
  const n = N(e), d = a > n, s = t > n, o = d || s;
  let u = o, _ = !1;
  if (r.forceSharding === !0)
    u = !0, _ = !o;
  else if (r.forceSharding === !1)
    u = !1, _ = o;
  else if (r.forceSharding !== void 0) throw new Error(`decideShardingPolicy: opts.forceSharding must be true, false, or undefined (got ${r.forceSharding})`);
  return Object.freeze({
    ceiling: n,
    needsEmbeddingShard: d,
    needsLMHeadShard: s,
    useShardedWeights: u,
    forced: _
  });
}
var se = Object.freeze({
  SCALAR: "scalar",
  DP4A: "dp4a",
  WMMA: "subgroup-matrix"
});
function g(...e) {
  for (const i of e) if (i != null) return i;
}
function c(e, i) {
  const r = Number(e);
  return Number.isFinite(r) && r > 0 ? r : i;
}
function h(e) {
  if (typeof e != "string") return null;
  const i = e.trim();
  return i.length > 0 ? i : null;
}
function B(e) {
  try {
    return e.info ?? null;
  } catch {
    return null;
  }
}
export {
  H as C,
  w as D,
  C as E,
  y as O,
  I as S,
  A as T,
  $ as _,
  J as a,
  L as b,
  j as c,
  X as d,
  ee as f,
  k as g,
  R as h,
  te as i,
  V as k,
  K as l,
  P as m,
  ne as n,
  U as o,
  W as p,
  re as r,
  q as s,
  ae as t,
  Y as u,
  G as v,
  F as w,
  D as x,
  M as y
};

//# sourceMappingURL=capabilities-BhXJGoqk.mjs.map