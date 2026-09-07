var y = class extends Error {
  constructor(e, r) {
    super(r), this.name = "WebGPUUnsupportedError", this.code = e;
  }
}, N = Object.freeze({
  NO_WEBGPU: "no-webgpu",
  NO_ADAPTER: "no-adapter",
  NO_DEVICE: "no-device"
}), D = class extends Error {
  constructor(e, r) {
    super(r), this.name = "MultimodalUnavailableError", this.code = e;
  }
}, I = Object.freeze({ VISION_NOT_LOADED: "vision-not-loaded" }), C = class extends Error {
  constructor(e, r, i = {}) {
    super(r), this.name = "UnsupportedPlanVariantError", this.code = e, this.detail = i;
  }
}, M = Object.freeze({
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
}, L = Object.freeze({
  OUT_OF_MEMORY: "out-of-memory",
  EXCEEDS_LIMIT: "exceeds-limit",
  DEVICE_LOST_ESCALATION: "device-lost-escalation",
  LORA_OOM: "lora-oom",
  STRICT_DEGRADE: "strict-degrade"
}), F = class extends Error {
  constructor(e, r, i = {}) {
    super(r), this.name = "ShardedBufferUnsupportedError", this.code = e, this.detail = i;
  }
}, H = Object.freeze({
  SHARDED_LOAD_NOT_YET_WIRED: "sharded-load-not-yet-wired",
  LM_HEAD_TOO_FRAGMENTED: "lm-head-too-fragmented"
});
function W(e, r) {
  if (typeof DOMException < "u") return new DOMException(r, e);
  const i = new Error(r);
  return i.name = e, i;
}
var R = {
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
}, P = {
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
}, G = {
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
}, $ = {
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
}), U = h({
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
}), q = h({
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
    const d = e[o];
    if (!Number.isInteger(d) || d <= 0) throw new Error(`validateVisionConfig: "${o}" must be a positive integer, got ${d}`);
  }
  if (typeof e.eps != "number" || e.eps <= 0) throw new Error(`validateVisionConfig: "eps" must be a positive number, got ${e.eps}`);
  if (e.prefix !== void 0 && typeof e.prefix != "string") throw new Error('validateVisionConfig: "prefix" must be a string when present');
  const r = e.hidden_size, i = e.num_heads, n = e.head_dim, t = e.num_position_embeddings, a = e.num_grid_per_side, u = e.patch_size, s = e.spatial_merge_size;
  if (i * n !== r) throw new Error(`validateVisionConfig: num_heads(${i}) * head_dim(${n}) != hidden_size(${r})`);
  if (a * a !== t) throw new Error(`validateVisionConfig: num_grid_per_side²(${a * a}) != num_position_embeddings(${t})`);
  if (u % s !== 0) throw new Error(`validateVisionConfig: patch_size(${u}) must be divisible by spatial_merge_size(${s})`);
  if (r % (s * s) !== 0) throw new Error(`validateVisionConfig: hidden_size(${r}) must be divisible by spatial_merge_size²(${s * s})`);
  return e;
}
function v(e) {
  return 3 * e.temporal_patch_size * e.patch_size * e.patch_size;
}
var Q = 1 << 20, K = Object.freeze({
  matmul: "f32",
  patchEmbed: "f32",
  posEmbed: "f32",
  enabled: !1
});
function Y(e, r = !1) {
  if (!e || typeof e != "object") throw new Error("visionWeightPlan: config must be an object");
  const i = e.hidden_size, n = e.intermediate_size, t = e.out_hidden_size, a = e.spatial_merge_size, u = e.num_position_embeddings, s = i * a * a, o = v(e), d = [
    i * i,
    i * n,
    s * s,
    s * t
  ].map((m) => m * 4), c = (m) => r && m >= 1048576 ? "f16" : "f32", l = {
    matmul: c(Math.min(...d)),
    patchEmbed: c(o * i * 4),
    posEmbed: c(u * i * 4)
  };
  return l.enabled = l.matmul === "f16" || l.patchEmbed === "f16" || l.posEmbed === "f16", l;
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
]), X = Object.freeze(["subgroups-f16"]);
function Z(e, r = {}) {
  if (!e) throw new Error("detectCapabilities: adapter is required (call requestAdapter first)");
  const i = r.navigator ?? (typeof navigator < "u" ? navigator : void 0), n = new Set(r.dropDeviceFeatures || []), t = /* @__PURE__ */ new Set();
  for (const _ of E)
    if (!n.has(_))
      try {
        e.features && e.features.has && e.features.has(_) && t.add(_);
      } catch {
      }
  const a = /* @__PURE__ */ new Set(), u = i?.gpu?.wgslLanguageFeatures;
  if (u && typeof u.has == "function") for (const _ of x) try {
    u.has(_) && a.add(_);
  } catch {
  }
  const s = w(e), o = g(e.subgroupMinSize, s?.subgroupMinSize, 32), d = g(e.subgroupMaxSize, s?.subgroupMaxSize, Math.max(o, 128)), c = Math.max(4, Number(o) | 0), l = Math.max(c, Number(d) | 0), m = e.limits ?? {}, b = {
    maxBufferSize: p(m.maxBufferSize, 1 << 28),
    maxStorageBufferBindingSize: p(m.maxStorageBufferBindingSize, 1 << 27),
    maxComputeWorkgroupStorageSize: p(m.maxComputeWorkgroupStorageSize, 16384),
    maxComputeWorkgroupSizeX: p(m.maxComputeWorkgroupSizeX, 256),
    maxComputeWorkgroupSizeY: p(m.maxComputeWorkgroupSizeY, 256),
    maxComputeWorkgroupSizeZ: p(m.maxComputeWorkgroupSizeZ, 64),
    maxComputeInvocationsPerWorkgroup: p(m.maxComputeInvocationsPerWorkgroup, 256),
    maxComputeWorkgroupsPerDimension: p(m.maxComputeWorkgroupsPerDimension, 65535)
  }, S = {
    architecture: f(s?.architecture),
    vendor: f(s?.vendor),
    device: f(s?.device),
    description: f(s?.description)
  }, z = {
    deviceFeatures: new Set(t),
    wgslFeatures: new Set(a),
    hasF16: t.has("shader-f16"),
    hasSubgroups: t.has("subgroups") && c === 32 && l === 32,
    hasTimestampQuery: t.has("timestamp-query"),
    hasSubgroupMatrix: t.has("chromium-experimental-subgroup-matrix"),
    hasTexelBuffer: t.has("chromium-experimental-texel-buffer"),
    hasUMAMapping: t.has("chromium-experimental-uma-mapping"),
    hasDP4A: a.has("packed_4x8_integer_dot_product"),
    subgroupMinSize: c,
    subgroupMaxSize: l,
    limits: b,
    vendor: S
  };
  return Object.freeze(z);
}
function J(e) {
  if (!e) throw new Error("narrowSubgroupCapability: caps is required");
  const r = Number(e.subgroupMinSize), i = Number(e.subgroupMaxSize), n = e.deviceFeatures?.has?.("subgroups") === !0, t = (a, u) => ({
    eligible: a,
    width: a ? r : 0,
    narrow: a && r !== 32,
    reason: u
  });
  return n ? !Number.isFinite(r) || !Number.isFinite(i) ? t(!1, "subgroup size not reported") : r !== i ? t(!1, `subgroup size is a RANGE (${r}-${i}); the width-parametric kernels need a point width so \${SUBGROUP_SIZE} matches @builtin(subgroup_size)`) : (r & r - 1) !== 0 ? t(!1, `subgroup size ${r} is not a power of two`) : r < 16 ? t(!1, `subgroup size ${r} < 16; the NUM_SG <= sg_size reduction invariant fails below 16`) : t(!0, `stable ${r}-wide subgroup`) : t(!1, "adapter does not list the subgroups feature");
}
function O(e) {
  const r = e.vendor ?? {}, i = (r.architecture ?? "").toLowerCase(), n = (r.vendor ?? "").toLowerCase(), t = (r.description ?? "").toLowerCase();
  return !!(i.startsWith("apple") || n === "apple" || t.includes("apple") && (t.includes("m1") || t.includes("m2") || t.includes("m3") || t.includes("m4")));
}
function B(e) {
  if (!e || !e.limits) throw new Error("perBufferShardCeiling: caps with .limits is required");
  const r = Number(e.limits.maxBufferSize) || 0, i = Number(e.limits.maxStorageBufferBindingSize) || 0, n = (t) => i > 0 ? Math.min(t, i) : t;
  return O(e) ? n(Math.min(r, 128 * 1024 * 1024)) : n(Math.max(0, r - 4 * 1024 * 1024));
}
function ee(e, r = 26e8, i = void 0) {
  if (!e || !e.limits) throw new Error("canRunLargeModel: caps with .limits is required");
  const n = 1024 * 1024 * 1024, t = Number(e.limits.maxBufferSize) || 0, a = Number(e.limits.maxStorageBufferBindingSize) || 0, u = 2 * n, s = 1 * n, o = i !== void 0 ? i : typeof navigator < "u" ? navigator.deviceMemory : void 0, d = o == null ? !0 : o >= 8;
  return t < u ? {
    capable: !1,
    reason: `maxBufferSize ${(t / n).toFixed(2)} GiB < 2 GiB (device-class proxy)`,
    maxBufferSize: t
  } : a < s ? {
    capable: !1,
    reason: `maxStorageBufferBindingSize ${(a / n).toFixed(2)} GiB < 1 GiB`,
    maxBufferSize: t
  } : d ? {
    capable: !0,
    reason: `maxBufferSize ${(t / n).toFixed(2)} GiB ≥ 2 GiB` + (o ? `, deviceMemory ${o} GB` : "") + ` ⇒ can host ${(r / n).toFixed(1)} GB`,
    maxBufferSize: t
  } : {
    capable: !1,
    reason: `navigator.deviceMemory ${o} GB < 8 GB`,
    maxBufferSize: t
  };
}
function re(e, r, i = {}) {
  if (!e || !e.limits) throw new Error("decideShardingPolicy: caps with .limits is required");
  if (!r || typeof r != "object") throw new Error("decideShardingPolicy: sizes object is required");
  const n = Number(r.embedBytes), t = Number(r.lmHeadBytes);
  if (!Number.isFinite(n) || n < 0) throw new Error(`decideShardingPolicy: embedBytes must be a non-negative finite number (got ${r.embedBytes})`);
  if (!Number.isFinite(t) || t < 0) throw new Error(`decideShardingPolicy: lmHeadBytes must be a non-negative finite number (got ${r.lmHeadBytes})`);
  const a = B(e), u = n > a, s = t > a, o = u || s;
  let d = o, c = !1;
  if (i.forceSharding === !0)
    d = !0, c = !o;
  else if (i.forceSharding === !1)
    d = !1, c = o;
  else if (i.forceSharding !== void 0) throw new Error(`decideShardingPolicy: opts.forceSharding must be true, false, or undefined (got ${i.forceSharding})`);
  return Object.freeze({
    ceiling: a,
    needsEmbeddingShard: u,
    needsLMHeadShard: s,
    useShardedWeights: d,
    forced: c
  });
}
var ie = Object.freeze({
  SCALAR: "scalar",
  DP4A: "dp4a",
  WMMA: "subgroup-matrix"
});
function g(...e) {
  for (const r of e) if (r != null) return r;
}
function p(e, r) {
  const i = Number(e);
  return Number.isFinite(i) && i > 0 ? i : r;
}
function f(e) {
  if (typeof e != "string") return null;
  const r = e.trim();
  return r.length > 0 ? r : null;
}
function w(e) {
  try {
    return e.info ?? null;
  } catch {
    return null;
  }
}
export {
  y as C,
  N as S,
  D as _,
  K as a,
  M as b,
  j as c,
  V as d,
  T as f,
  I as g,
  A as h,
  J as i,
  Y as l,
  P as m,
  re as n,
  k as o,
  $ as p,
  Z as r,
  q as s,
  ee as t,
  R as u,
  H as v,
  W as w,
  C as x,
  F as y
};

//# sourceMappingURL=capabilities-DcpKTBdq.mjs.map