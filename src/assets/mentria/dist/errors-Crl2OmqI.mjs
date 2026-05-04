var t = class extends Error {
  constructor(e, r) {
    super(r), this.name = "WebGPUUnsupportedError", this.code = e;
  }
}, s = Object.freeze({
  NO_WEBGPU: "no-webgpu",
  NO_ADAPTER: "no-adapter",
  NO_DEVICE: "no-device"
}), a = class extends Error {
  constructor(e, r) {
    super(r), this.name = "MultimodalUnavailableError", this.code = e;
  }
}, n = Object.freeze({ VISION_NOT_LOADED: "vision-not-loaded" }), i = class extends Error {
  constructor(e, r, o = {}) {
    super(r), this.name = "UnsupportedPlanVariantError", this.code = e, this.detail = o;
  }
}, E = Object.freeze({
  Q3_MLP_NOT_PROVISIONED: "q3-mlp-not-provisioned",
  Q3_ALL_NOT_ALLOWED: "q3-all-not-allowed"
}), l = class extends Error {
  constructor(e, r = {}) {
    const o = Array.isArray(r.rungsTried) ? r.rungsTried : [];
    super(`Allocation failed: ${e} (tried ${o.length} fallback plan${o.length === 1 ? "" : "s"})`), this.name = "AllocationFailureError", this.code = e, this.detail = {
      rungsTried: o,
      lastFailurePhase: r.lastFailurePhase || null,
      requestedMiB: typeof r.requestedMiB == "number" ? r.requestedMiB : null,
      deviceMaxBufferMiB: typeof r.deviceMaxBufferMiB == "number" ? r.deviceMaxBufferMiB : null,
      suggestion: typeof r.suggestion == "string" ? r.suggestion : null
    };
  }
}, u = Object.freeze({
  OUT_OF_MEMORY: "out-of-memory",
  EXCEEDS_LIMIT: "exceeds-limit",
  DEVICE_LOST_ESCALATION: "device-lost-escalation",
  LORA_OOM: "lora-oom",
  STRICT_DEGRADE: "strict-degrade"
}), d = class extends Error {
  constructor(e, r, o = {}) {
    super(r), this.name = "ShardedBufferUnsupportedError", this.code = e, this.detail = o;
  }
}, O = Object.freeze({
  SHARDED_LOAD_NOT_YET_WIRED: "sharded-load-not-yet-wired",
  LM_HEAD_TOO_FRAGMENTED: "lm-head-too-fragmented"
});
function c(e, r) {
  if (typeof DOMException < "u") return new DOMException(r, e);
  const o = new Error(r);
  return o.name = e, o;
}
export {
  d as a,
  s as c,
  O as i,
  t as l,
  n,
  E as o,
  a as r,
  i as s,
  l as t,
  c as u
};

//# sourceMappingURL=errors-Crl2OmqI.mjs.map