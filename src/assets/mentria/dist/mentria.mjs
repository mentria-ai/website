import { a as m, d as l, f as b, o as P, p as L, t as D } from "./capabilities-DjEhHCqr.mjs";
var g = {
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
}, U = 1, S = class w {
  #r = null;
  #e = /* @__PURE__ */ new Map();
  #s = null;
  #l = null;
  #u = null;
  #a = !1;
  #h = "direct";
  #n;
  #i = null;
  constructor(e) {
    let t, r;
    if (typeof e == "string" || e instanceof URL)
      t = e, r = "direct";
    else if (e && typeof e == "object")
      t = e.workerUrl, r = e.spawnMode ?? "blob";
    else throw new TypeError("MentriaEngine: constructor requires a worker URL or an options object with { workerUrl }");
    if (!t) throw new TypeError("MentriaEngine: workerUrl is required");
    if (r !== "direct" && r !== "blob") throw new TypeError(`MentriaEngine: spawnMode must be 'direct' or 'blob' (got ${r})`);
    this.#h = r, r === "direct" ? (this.#r = new Worker(t, { type: "module" }), this.#d(), this.#n = Promise.resolve()) : this.#n = fetch(t).then((o) => {
      if (!o.ok) throw new b(l.NO_WEBGPU, `MentriaEngine: failed to fetch worker from ${t} (HTTP ${o.status}).`);
      return o.text();
    }).then((o) => {
      const s = new Blob([o], { type: "application/javascript" });
      this.#i = URL.createObjectURL(s), this.#r = new Worker(this.#i, { type: "module" }), this.#d();
    });
  }
  #d() {
    this.#r.onmessage = (e) => this.#p(e.data), this.#r.onerror = (e) => {
      for (const [t, r] of this.#e)
        r.cleanup?.(), r.reject(/* @__PURE__ */ new Error(`Worker error: ${e.message}`));
      this.#e.clear();
    }, this.#r.onmessageerror = (e) => {
      try {
        console.warn("[MentriaEngine] onmessageerror — worker reply failed deserialization (dropped):", e?.data ?? "(no data)");
      } catch {
      }
    };
  }
  #p(e) {
    if (e.type === "token") {
      const r = this.#e.get(e.id);
      if (!r) return;
      r.onToken?.(e.data), e.data.finished && (this.#e.delete(e.id), r.cleanup?.(), r.resolve(e.data));
      return;
    }
    if (e.type === "layerNorms") {
      const r = this.#e.get(e.id);
      if (!r) return;
      r.onLayerNorms?.(e.data);
      return;
    }
    if (e.type === "l23Residuals") {
      const r = this.#e.get(e.id);
      if (!r) return;
      r.onL23Residuals?.(e.data);
      return;
    }
    if (e.type === "l23Mlp") {
      const r = this.#e.get(e.id);
      if (!r) return;
      r.onL23Mlp?.(e.data);
      return;
    }
    if (e.type === "l23Attention") {
      const r = this.#e.get(e.id);
      if (!r) return;
      r.onL23Attention?.(e.data);
      return;
    }
    if (e.type === "deltaState") {
      const r = this.#e.get(e.id);
      if (!r) return;
      r.onDeltaState?.(e.data);
      return;
    }
    if (e.type === "progress") {
      this.#s?.(e.data);
      return;
    }
    if (e.type === "fallback") {
      try {
        this.#u?.({
          fromRung: e.fromRung,
          toRung: e.toRung,
          reason: e.reason,
          fromLabel: e.fromLabel,
          toLabel: e.toLabel,
          summary: e.summary,
          lastFailurePhase: e.lastFailurePhase
        });
      } catch {
      }
      return;
    }
    if (e.type === "device-lost") {
      this.#a = !0;
      const r = new b(l.NO_DEVICE, e.error || "WebGPU device lost.");
      for (const [o, s] of this.#e)
        s.cleanup?.(), s.reject(r);
      this.#e.clear(), this.#l?.({
        code: l.NO_DEVICE,
        reason: e.reason || "unknown",
        message: e.error || "WebGPU device lost."
      });
      return;
    }
    const t = this.#e.get(e.id);
    t && (this.#e.delete(e.id), t.cleanup?.(), e.type === "result" ? t.resolve(e.data) : e.type === "error" && t.reject(this.#f(e)));
  }
  #f(e) {
    const t = e.code;
    return t === l.NO_WEBGPU || t === l.NO_ADAPTER || t === l.NO_DEVICE ? new b(t, e.error || "WebGPU unavailable") : t === m.VISION_NOT_LOADED ? new P(t, e.error || "Vision tower not loaded") : new Error(e.error);
  }
  #t(e, t, { onToken: r = null, onLayerNorms: o = null, onL23Residuals: s = null, onL23Mlp: u = null, onL23Attention: h = null, onDeltaState: d = null, signal: i = null, timeoutMs: f = 0 } = {}) {
    const a = crypto.randomUUID();
    return new Promise((E, p) => {
      if (this.#a) {
        p(new b(l.NO_DEVICE, "WebGPU device was lost; construct a new MentriaEngine to recover."));
        return;
      }
      if (i?.aborted) {
        p(this.#o(i));
        return;
      }
      let y = null, n = null;
      const v = () => {
        y !== null && (clearTimeout(y), y = null), n && (i?.removeEventListener("abort", n), n = null);
      };
      this.#e.set(a, {
        resolve: E,
        reject: p,
        onToken: r,
        onLayerNorms: o,
        onL23Residuals: s,
        onL23Mlp: u,
        onL23Attention: h,
        onDeltaState: d,
        cleanup: v
      }), i && (n = () => {
        const c = this.#e.get(a);
        if (c) {
          this.#e.delete(a), c.cleanup();
          try {
            this.#r.postMessage({
              type: "interrupt",
              id: ""
            });
          } catch {
          }
          c.reject(this.#o(i));
        }
      }, i.addEventListener("abort", n, { once: !0 })), f > 0 && (y = setTimeout(() => {
        const c = this.#e.get(a);
        if (c) {
          this.#e.delete(a), c.cleanup();
          try {
            this.#r.postMessage({
              type: "interrupt",
              id: ""
            });
          } catch {
          }
          c.reject(L("TimeoutError", `Generation timed out after ${f}ms`));
        }
      }, f)), this.#n.then(() => {
        if (this.#e.has(a))
          try {
            this.#r.postMessage({
              type: e,
              id: a,
              data: t
            });
          } catch (c) {
            this.#e.has(a) && (this.#e.delete(a), v()), p(c);
          }
      }, (c) => {
        this.#e.has(a) && (this.#e.delete(a), v()), p(c);
      });
    });
  }
  #o(e) {
    return e?.reason !== void 0 ? e.reason instanceof Error ? e.reason : L("AbortError", String(e.reason)) : L("AbortError", "Generation aborted");
  }
  static isWebGPUAvailable() {
    return typeof navigator < "u" && !!navigator.gpu;
  }
  static async probeWebGPU() {
    if (!w.isWebGPUAvailable()) return {
      available: !1,
      code: l.NO_WEBGPU
    };
    try {
      const e = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
      return e ? {
        available: !0,
        code: null,
        device: e.info?.device
      } : {
        available: !1,
        code: l.NO_ADAPTER
      };
    } catch {
      return {
        available: !1,
        code: l.NO_ADAPTER
      };
    }
  }
  set onProgress(e) {
    this.#s = e;
  }
  set onDeviceLost(e) {
    this.#l = e;
  }
  get isDeviceLost() {
    return this.#a;
  }
  set onFallback(e) {
    this.#u = e;
  }
  async init(e) {
    if (!w.isWebGPUAvailable()) throw new b(l.NO_WEBGPU, "WebGPU is not available. Use Chrome 113+, Edge 113+, or Safari 18.2+.");
    const t = await this.#t("init", e);
    if (t && t.protocolVersion !== void 0 && t.protocolVersion !== 1) throw new Error(`MentriaEngine: protocol version mismatch (main=1, worker=${t.protocolVersion}). The main-thread bundle and worker bundle are from incompatible releases — force-reload the page (Ctrl+Shift+R) to clear cached chunks, or pin matching versions.`);
    return t;
  }
  async loadModel(e) {
    return this.#t("load", e);
  }
  async generate(e, t) {
    const { signal: r, timeoutMs: o, onLayerNorms: s, onL23Residuals: u, onL23Mlp: h, onL23Attention: d, onDeltaState: i, ...f } = e || {};
    return this.#t("generate", f, {
      onToken: t || null,
      onLayerNorms: s || null,
      onL23Residuals: u || null,
      onL23Mlp: h || null,
      onL23Attention: d || null,
      onDeltaState: i || null,
      signal: r || null,
      timeoutMs: o || 0
    });
  }
  stream(e) {
    const { signal: t, timeoutMs: r, ...o } = e || {};
    if (this.#a) return this.#c(new b(l.NO_DEVICE, "WebGPU device was lost; construct a new MentriaEngine to recover."));
    if (t?.aborted) return this.#c(this.#o(t));
    const s = [], u = [];
    let h = !1, d = null, i = !1;
    const f = (n) => {
      i || (u.length ? u.shift().resolve({
        value: n,
        done: !1
      }) : s.push(n));
    }, a = () => {
      if (!(h || d))
        for (h = !0; u.length; ) u.shift().resolve({
          value: void 0,
          done: !0
        });
    }, E = (n) => {
      if (!(h || d))
        for (d = n; u.length; ) u.shift().reject(n);
    }, p = this.#t("generate", o, {
      onToken: f,
      signal: t || null,
      timeoutMs: r || 0
    });
    p.then(a, E);
    const y = this;
    return {
      [Symbol.asyncIterator]() {
        return this;
      },
      next() {
        return s.length ? Promise.resolve({
          value: s.shift(),
          done: !1
        }) : d ? Promise.reject(d) : h ? Promise.resolve({
          value: void 0,
          done: !0
        }) : new Promise((n, v) => u.push({
          resolve: n,
          reject: v
        }));
      },
      return(n) {
        if (!h && !d && !i) {
          i = !0;
          try {
            y.#r?.postMessage({
              type: "interrupt",
              id: ""
            });
          } catch {
          }
        }
        return a(), p.catch(() => {
        }), Promise.resolve({
          value: n,
          done: !0
        });
      },
      throw(n) {
        if (!h && !d && !i) {
          i = !0;
          try {
            y.#r?.postMessage({
              type: "interrupt",
              id: ""
            });
          } catch {
          }
        }
        return E(n), p.catch(() => {
        }), Promise.reject(n);
      }
    };
  }
  #c(e) {
    return {
      [Symbol.asyncIterator]() {
        return this;
      },
      next() {
        return Promise.reject(e);
      },
      return() {
        return Promise.resolve({
          value: void 0,
          done: !0
        });
      },
      throw(t) {
        return Promise.reject(t);
      }
    };
  }
  interrupt() {
    this.#n.then(() => {
      try {
        this.#r?.postMessage({
          type: "interrupt",
          id: ""
        });
      } catch {
      }
    }, () => {
    });
  }
  async swapAdapter(e) {
    return this.#t("swapAdapter", e);
  }
  async unloadAdapter(e) {
    return this.#t("unloadAdapter", { name: e });
  }
  async reset() {
    return this.#t("reset");
  }
  async getStats() {
    return this.#t("getStats");
  }
  async unload() {
    return this.#t("unload");
  }
  async loadBf16LmHead(e) {
    return this.#t("loadBf16LmHead", { url: e });
  }
  async unloadBf16LmHead() {
    return this.#t("unloadBf16LmHead", {});
  }
  async enableDecayClamp(e) {
    return this.#t("enableDecayClamp", { gCeiling: e });
  }
  async disableDecayClamp() {
    return this.#t("disableDecayClamp", {});
  }
  async enableL23InputLnOverride(e, t = 23) {
    return this.#t("enableL23InputLnOverride", {
      perturbedGamma: e,
      layerIdx: t
    });
  }
  async disableL23InputLnOverride() {
    return this.#t("disableL23InputLnOverride", {});
  }
  async readInputLnWeight(e = 23) {
    return this.#t("readInputLnWeight", { layerIdx: e });
  }
  _triggerDeviceLostForTest(e = {}) {
    this.#n.then(() => {
      try {
        this.#r?.postMessage({
          type: "__triggerDeviceLost",
          id: "",
          data: e
        });
      } catch {
      }
    }, () => {
    });
  }
  terminate() {
    this.#n.then(() => {
      try {
        this.#r?.terminate();
      } catch {
      }
      if (this.#i) {
        try {
          URL.revokeObjectURL(this.#i);
        } catch {
        }
        this.#i = null;
      }
    }, () => {
    });
    for (const [e, t] of this.#e)
      t.cleanup?.(), t.reject(/* @__PURE__ */ new Error("Worker terminated"));
    this.#e.clear();
  }
};
export {
  m as MULTIMODAL_ERROR_CODES,
  S as MentriaEngine,
  P as MultimodalUnavailableError,
  U as PROTOCOL_VERSION,
  g as QWEN35_08B_CONFIG,
  R as QWEN35_4B_CONFIG,
  l as WEBGPU_ERROR_CODES,
  b as WebGPUUnsupportedError,
  D as canRunLargeModel
};

//# sourceMappingURL=mentria.mjs.map