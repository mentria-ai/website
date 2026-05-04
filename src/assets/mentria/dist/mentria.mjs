import { c as l, l as b, n as P, r as M, u as E } from "./errors-Crl2OmqI.mjs";
var m = 1, D = class L {
  #r = null;
  #e = /* @__PURE__ */ new Map();
  #s = null;
  #l = null;
  #u = null;
  #o = !1;
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
    this.#h = r, r === "direct" ? (this.#r = new Worker(t, { type: "module" }), this.#c(), this.#n = Promise.resolve()) : this.#n = fetch(t).then((a) => {
      if (!a.ok) throw new b(l.NO_WEBGPU, `MentriaEngine: failed to fetch worker from ${t} (HTTP ${a.status}).`);
      return a.text();
    }).then((a) => {
      const s = new Blob([a], { type: "application/javascript" });
      this.#i = URL.createObjectURL(s), this.#r = new Worker(this.#i, { type: "module" }), this.#c();
    });
  }
  #c() {
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
      this.#o = !0;
      const r = new b(l.NO_DEVICE, e.error || "WebGPU device lost.");
      for (const [a, s] of this.#e)
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
    return t === l.NO_WEBGPU || t === l.NO_ADAPTER || t === l.NO_DEVICE ? new b(t, e.error || "WebGPU unavailable") : t === P.VISION_NOT_LOADED ? new M(t, e.error || "Vision tower not loaded") : new Error(e.error);
  }
  #t(e, t, { onToken: r = null, onLayerNorms: a = null, onL23Residuals: s = null, onL23Mlp: u = null, onL23Attention: h = null, onDeltaState: c = null, signal: i = null, timeoutMs: f = 0 } = {}) {
    const o = crypto.randomUUID();
    return new Promise((w, p) => {
      if (this.#o) {
        p(new b(l.NO_DEVICE, "WebGPU device was lost; construct a new MentriaEngine to recover."));
        return;
      }
      if (i?.aborted) {
        p(this.#a(i));
        return;
      }
      let y = null, n = null;
      const v = () => {
        y !== null && (clearTimeout(y), y = null), n && (i?.removeEventListener("abort", n), n = null);
      };
      this.#e.set(o, {
        resolve: w,
        reject: p,
        onToken: r,
        onLayerNorms: a,
        onL23Residuals: s,
        onL23Mlp: u,
        onL23Attention: h,
        onDeltaState: c,
        cleanup: v
      }), i && (n = () => {
        const d = this.#e.get(o);
        if (d) {
          this.#e.delete(o), d.cleanup();
          try {
            this.#r.postMessage({
              type: "interrupt",
              id: ""
            });
          } catch {
          }
          d.reject(this.#a(i));
        }
      }, i.addEventListener("abort", n, { once: !0 })), f > 0 && (y = setTimeout(() => {
        const d = this.#e.get(o);
        if (d) {
          this.#e.delete(o), d.cleanup();
          try {
            this.#r.postMessage({
              type: "interrupt",
              id: ""
            });
          } catch {
          }
          d.reject(E("TimeoutError", `Generation timed out after ${f}ms`));
        }
      }, f)), this.#n.then(() => {
        if (this.#e.has(o))
          try {
            this.#r.postMessage({
              type: e,
              id: o,
              data: t
            });
          } catch (d) {
            this.#e.has(o) && (this.#e.delete(o), v()), p(d);
          }
      }, (d) => {
        this.#e.has(o) && (this.#e.delete(o), v()), p(d);
      });
    });
  }
  #a(e) {
    return e?.reason !== void 0 ? e.reason instanceof Error ? e.reason : E("AbortError", String(e.reason)) : E("AbortError", "Generation aborted");
  }
  static isWebGPUAvailable() {
    return typeof navigator < "u" && !!navigator.gpu;
  }
  static async probeWebGPU() {
    if (!L.isWebGPUAvailable()) return {
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
    return this.#o;
  }
  set onFallback(e) {
    this.#u = e;
  }
  async init(e) {
    if (!L.isWebGPUAvailable()) throw new b(l.NO_WEBGPU, "WebGPU is not available. Use Chrome 113+, Edge 113+, or Safari 18.2+.");
    const t = await this.#t("init", e);
    if (t && t.protocolVersion !== void 0 && t.protocolVersion !== 1) throw new Error(`MentriaEngine: protocol version mismatch (main=1, worker=${t.protocolVersion}). The main-thread bundle and worker bundle are from incompatible releases — force-reload the page (Ctrl+Shift+R) to clear cached chunks, or pin matching versions.`);
    return t;
  }
  async loadModel(e) {
    return this.#t("load", e);
  }
  async generate(e, t) {
    const { signal: r, timeoutMs: a, onLayerNorms: s, onL23Residuals: u, onL23Mlp: h, onL23Attention: c, onDeltaState: i, ...f } = e || {};
    return this.#t("generate", f, {
      onToken: t || null,
      onLayerNorms: s || null,
      onL23Residuals: u || null,
      onL23Mlp: h || null,
      onL23Attention: c || null,
      onDeltaState: i || null,
      signal: r || null,
      timeoutMs: a || 0
    });
  }
  stream(e) {
    const { signal: t, timeoutMs: r, ...a } = e || {};
    if (this.#o) return this.#d(new b(l.NO_DEVICE, "WebGPU device was lost; construct a new MentriaEngine to recover."));
    if (t?.aborted) return this.#d(this.#a(t));
    const s = [], u = [];
    let h = !1, c = null, i = !1;
    const f = (n) => {
      i || (u.length ? u.shift().resolve({
        value: n,
        done: !1
      }) : s.push(n));
    }, o = () => {
      if (!(h || c))
        for (h = !0; u.length; ) u.shift().resolve({
          value: void 0,
          done: !0
        });
    }, w = (n) => {
      if (!(h || c))
        for (c = n; u.length; ) u.shift().reject(n);
    }, p = this.#t("generate", a, {
      onToken: f,
      signal: t || null,
      timeoutMs: r || 0
    });
    p.then(o, w);
    const y = this;
    return {
      [Symbol.asyncIterator]() {
        return this;
      },
      next() {
        return s.length ? Promise.resolve({
          value: s.shift(),
          done: !1
        }) : c ? Promise.reject(c) : h ? Promise.resolve({
          value: void 0,
          done: !0
        }) : new Promise((n, v) => u.push({
          resolve: n,
          reject: v
        }));
      },
      return(n) {
        if (!h && !c && !i) {
          i = !0;
          try {
            y.#r?.postMessage({
              type: "interrupt",
              id: ""
            });
          } catch {
          }
        }
        return o(), p.catch(() => {
        }), Promise.resolve({
          value: n,
          done: !0
        });
      },
      throw(n) {
        if (!h && !c && !i) {
          i = !0;
          try {
            y.#r?.postMessage({
              type: "interrupt",
              id: ""
            });
          } catch {
          }
        }
        return w(n), p.catch(() => {
        }), Promise.reject(n);
      }
    };
  }
  #d(e) {
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
  P as MULTIMODAL_ERROR_CODES,
  D as MentriaEngine,
  M as MultimodalUnavailableError,
  m as PROTOCOL_VERSION,
  l as WEBGPU_ERROR_CODES,
  b as WebGPUUnsupportedError
};

//# sourceMappingURL=mentria.mjs.map