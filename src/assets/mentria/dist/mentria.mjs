import { C as E, S as c, _ as D, d as I, f as R, g as k, o as W, p as O, s as U, t as C, u as G, w as M } from "./capabilities-DejctUH4.mjs";
var m = 1, T = class N {
  #r = null;
  #e = /* @__PURE__ */ new Map();
  #a = null;
  #l = null;
  #u = null;
  #o = !1;
  #h = "direct";
  #n;
  #i = null;
  constructor(e) {
    let r, t;
    if (typeof e == "string" || e instanceof URL)
      r = e, t = "direct";
    else if (e && typeof e == "object")
      r = e.workerUrl, t = e.spawnMode ?? "blob";
    else throw new TypeError("MentriaEngine: constructor requires a worker URL or an options object with { workerUrl }");
    if (!r) throw new TypeError("MentriaEngine: workerUrl is required");
    if (t !== "direct" && t !== "blob") throw new TypeError(`MentriaEngine: spawnMode must be 'direct' or 'blob' (got ${t})`);
    this.#h = t, t === "direct" ? (this.#r = new Worker(r, { type: "module" }), this.#c(), this.#n = Promise.resolve()) : this.#n = fetch(r).then((o) => {
      if (!o.ok) throw new E(c.NO_WEBGPU, `MentriaEngine: failed to fetch worker from ${r} (HTTP ${o.status}).`);
      return o.text();
    }).then((o) => {
      const s = new Blob([o], { type: "application/javascript" });
      this.#i = URL.createObjectURL(s), this.#r = new Worker(this.#i, { type: "module" }), this.#c();
    });
  }
  #c() {
    this.#r.onmessage = (e) => this.#p(e.data), this.#r.onerror = (e) => {
      for (const [r, t] of this.#e)
        t.cleanup?.(), t.reject(/* @__PURE__ */ new Error(`Worker error: ${e.message}`));
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
      const t = this.#e.get(e.id);
      if (!t) return;
      t.onToken?.(e.data), e.data.finished && (this.#e.delete(e.id), t.cleanup?.(), t.resolve(e.data));
      return;
    }
    if (e.type === "layerNorms") {
      const t = this.#e.get(e.id);
      if (!t) return;
      t.onLayerNorms?.(e.data);
      return;
    }
    if (e.type === "l23Residuals") {
      const t = this.#e.get(e.id);
      if (!t) return;
      t.onL23Residuals?.(e.data);
      return;
    }
    if (e.type === "l23Mlp") {
      const t = this.#e.get(e.id);
      if (!t) return;
      t.onL23Mlp?.(e.data);
      return;
    }
    if (e.type === "l23Attention") {
      const t = this.#e.get(e.id);
      if (!t) return;
      t.onL23Attention?.(e.data);
      return;
    }
    if (e.type === "deltaState") {
      const t = this.#e.get(e.id);
      if (!t) return;
      t.onDeltaState?.(e.data);
      return;
    }
    if (e.type === "profile") {
      const t = this.#e.get(e.id);
      if (!t) return;
      t.onProfile?.(e.data);
      return;
    }
    if (e.type === "logitsTop5") {
      const t = this.#e.get(e.id);
      if (!t) return;
      t.onDebugLine?.(e.data?.line ?? "");
      return;
    }
    if (e.type === "sessionChunk") {
      const t = this.#e.get(e.id);
      if (!t) return;
      t.onSessionChunk?.(e.data);
      return;
    }
    if (e.type === "progress") {
      this.#a?.(e.data);
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
      const t = new E(c.NO_DEVICE, e.error || "WebGPU device lost.");
      for (const [o, s] of this.#e)
        s.cleanup?.(), s.reject(t);
      this.#e.clear(), this.#l?.({
        code: c.NO_DEVICE,
        reason: e.reason || "unknown",
        message: e.error || "WebGPU device lost."
      });
      return;
    }
    if (e.type !== "result" && e.type !== "error") return;
    const r = this.#e.get(e.id);
    r && (this.#e.delete(e.id), r.cleanup?.(), e.type === "result" ? r.resolve(e.data) : r.reject(this.#f(e)));
  }
  #f(e) {
    const r = e.code;
    return r === c.NO_WEBGPU || r === c.NO_ADAPTER || r === c.NO_DEVICE ? new E(r, e.error || "WebGPU unavailable") : r === k.VISION_NOT_LOADED ? new D(r, e.error || "Vision tower not loaded") : new Error(e.error);
  }
  #t(e, r, { onToken: t = null, onLayerNorms: o = null, onL23Residuals: s = null, onL23Mlp: d = null, onL23Attention: i = null, onDeltaState: p = null, onSessionChunk: P = null, onProfile: g = null, onDebugLine: _ = null, transfer: f = null, signal: a = null, timeoutMs: h = 0 } = {}) {
    const n = crypto.randomUUID();
    return new Promise((b, L) => {
      if (this.#o) {
        L(new E(c.NO_DEVICE, "WebGPU device was lost; construct a new MentriaEngine to recover."));
        return;
      }
      if (a?.aborted) {
        L(this.#s(a));
        return;
      }
      let v = null, y = null;
      const w = () => {
        v !== null && (clearTimeout(v), v = null), y && (a?.removeEventListener("abort", y), y = null);
      };
      this.#e.set(n, {
        resolve: b,
        reject: L,
        onToken: t,
        onLayerNorms: o,
        onL23Residuals: s,
        onL23Mlp: d,
        onL23Attention: i,
        onDeltaState: p,
        onSessionChunk: P,
        onProfile: g,
        onDebugLine: _,
        cleanup: w
      }), a && (y = () => {
        const l = this.#e.get(n);
        if (l) {
          this.#e.delete(n), l.cleanup();
          try {
            this.#r.postMessage({
              type: "interrupt",
              id: ""
            });
          } catch {
          }
          l.reject(this.#s(a));
        }
      }, a.addEventListener("abort", y, { once: !0 })), h > 0 && (v = setTimeout(() => {
        const l = this.#e.get(n);
        if (l) {
          this.#e.delete(n), l.cleanup();
          try {
            this.#r.postMessage({
              type: "interrupt",
              id: ""
            });
          } catch {
          }
          l.reject(M("TimeoutError", `Generation timed out after ${h}ms`));
        }
      }, h)), this.#n.then(() => {
        if (this.#e.has(n))
          try {
            f && f.length ? this.#r.postMessage({
              type: e,
              id: n,
              data: r
            }, f) : this.#r.postMessage({
              type: e,
              id: n,
              data: r
            });
          } catch (l) {
            this.#e.has(n) && (this.#e.delete(n), w()), L(l);
          }
      }, (l) => {
        this.#e.has(n) && (this.#e.delete(n), w()), L(l);
      });
    });
  }
  #s(e) {
    return e?.reason !== void 0 ? e.reason instanceof Error ? e.reason : M("AbortError", String(e.reason)) : M("AbortError", "Generation aborted");
  }
  static isWebGPUAvailable() {
    return typeof navigator < "u" && !!navigator.gpu;
  }
  static async probeWebGPU() {
    if (!N.isWebGPUAvailable()) return {
      available: !1,
      code: c.NO_WEBGPU
    };
    try {
      const e = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
      return e ? {
        available: !0,
        code: null,
        device: e.info?.device
      } : {
        available: !1,
        code: c.NO_ADAPTER
      };
    } catch {
      return {
        available: !1,
        code: c.NO_ADAPTER
      };
    }
  }
  set onProgress(e) {
    this.#a = e;
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
    if (!N.isWebGPUAvailable()) throw new E(c.NO_WEBGPU, "WebGPU is not available. Use Chrome 113+, Edge 113+, or Safari 18.2+.");
    const r = await this.#t("init", e);
    if (r && r.protocolVersion !== void 0 && r.protocolVersion !== 1) throw new Error(`MentriaEngine: protocol version mismatch (main=1, worker=${r.protocolVersion}). The main-thread bundle and worker bundle are from incompatible releases — force-reload the page (Ctrl+Shift+R) to clear cached chunks, or pin matching versions.`);
    return r;
  }
  async loadModel(e) {
    return this.#t("load", e);
  }
  async generate(e, r) {
    const { signal: t, timeoutMs: o, onLayerNorms: s, onL23Residuals: d, onL23Mlp: i, onL23Attention: p, onDeltaState: P, onProfile: g, onDebugLine: _, ...f } = e || {};
    return this.#t("generate", f, {
      onToken: r || null,
      onLayerNorms: s || null,
      onL23Residuals: d || null,
      onL23Mlp: i || null,
      onL23Attention: p || null,
      onDeltaState: P || null,
      onProfile: g || null,
      onDebugLine: _ || null,
      signal: t || null,
      timeoutMs: o || 0
    });
  }
  stream(e) {
    const { signal: r, timeoutMs: t, onProfile: o, onDebugLine: s, onLayerNorms: d, onL23Residuals: i, onL23Mlp: p, onL23Attention: P, onDeltaState: g, ..._ } = e || {};
    if (this.#o) return this.#d(new E(c.NO_DEVICE, "WebGPU device was lost; construct a new MentriaEngine to recover."));
    if (r?.aborted) return this.#d(this.#s(r));
    const f = [], a = [];
    let h = !1, n = null, b = !1;
    const L = (u) => {
      b || (a.length ? a.shift().resolve({
        value: u,
        done: !1
      }) : f.push(u));
    }, v = () => {
      if (!(h || n))
        for (h = !0; a.length; ) a.shift().resolve({
          value: void 0,
          done: !0
        });
    }, y = (u) => {
      if (!(h || n))
        for (n = u; a.length; ) a.shift().reject(u);
    }, w = this.#t("generate", _, {
      onToken: L,
      onProfile: o || null,
      onDebugLine: s || null,
      onLayerNorms: d || null,
      onL23Residuals: i || null,
      onL23Mlp: p || null,
      onL23Attention: P || null,
      onDeltaState: g || null,
      signal: r || null,
      timeoutMs: t || 0
    });
    w.then(v, y);
    const l = this;
    return {
      [Symbol.asyncIterator]() {
        return this;
      },
      next() {
        return f.length ? Promise.resolve({
          value: f.shift(),
          done: !1
        }) : n ? Promise.reject(n) : h ? Promise.resolve({
          value: void 0,
          done: !0
        }) : new Promise((u, A) => a.push({
          resolve: u,
          reject: A
        }));
      },
      return(u) {
        if (!h && !n && !b) {
          b = !0;
          try {
            l.#r?.postMessage({
              type: "interrupt",
              id: ""
            });
          } catch {
          }
        }
        return v(), w.catch(() => {
        }), Promise.resolve({
          value: u,
          done: !0
        });
      },
      throw(u) {
        if (!h && !n && !b) {
          b = !0;
          try {
            l.#r?.postMessage({
              type: "interrupt",
              id: ""
            });
          } catch {
          }
        }
        return y(u), w.catch(() => {
        }), Promise.reject(u);
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
      throw(r) {
        return Promise.reject(r);
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
  async snapshotSession(e = {}) {
    const { tokens: r = null, onChunk: t = null, checksum: o = !0 } = e, s = [], d = await this.#t("snapshotSession", {
      tokens: r || void 0,
      checksum: o
    }, { onSessionChunk: (i) => {
      t ? t(i) : s[i.index] = i.bytes;
    } });
    return {
      manifest: d.manifest,
      buffers: t ? null : s,
      bytes: d.bytes,
      ms: d.ms
    };
  }
  async restoreSession(e, r, t = {}) {
    const { verify: o = !0, transfer: s = !0 } = t;
    if (!e || !Array.isArray(e.entries)) throw new Error("restoreSession: manifest with an entries array is required");
    const d = typeof r == "function" ? r : (i) => Array.isArray(r) ? r[i] : void 0;
    await this.#t("restoreSession", {
      phase: "begin",
      manifest: e
    });
    for (let i = 0; i < e.entries.length; i++) {
      const p = await d(i, e.entries[i]);
      if (!p) throw new Error(`restoreSession: no bytes for entry ${i} ('${e.entries[i].key}')`);
      await this.#t("restoreSession", {
        phase: "chunk",
        index: i,
        bytes: p,
        verify: o
      }, s ? { transfer: [p] } : void 0);
    }
    return this.#t("restoreSession", { phase: "commit" });
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
  async setAblation(e) {
    return this.#t("setAblation", { ablation: e });
  }
  async clearAblation() {
    return this.#t("clearAblation", {});
  }
  async enableDecayClamp(e) {
    return this.#t("enableDecayClamp", { gCeiling: e });
  }
  async disableDecayClamp() {
    return this.#t("disableDecayClamp", {});
  }
  async enableL23InputLnOverride(e, r = 23) {
    return this.#t("enableL23InputLnOverride", {
      perturbedGamma: e,
      layerIdx: r
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
    for (const [e, r] of this.#e)
      r.cleanup?.(), r.reject(/* @__PURE__ */ new Error("Worker terminated"));
    this.#e.clear();
  }
};
export {
  k as MULTIMODAL_ERROR_CODES,
  T as MentriaEngine,
  D as MultimodalUnavailableError,
  m as PROTOCOL_VERSION,
  G as QWEN35_08B_CONFIG,
  I as QWEN35_27B_BONSAI_CONFIG,
  R as QWEN35_2B_CONFIG,
  O as QWEN35_4B_CONFIG,
  W as QWEN35_VL_08B_VISION_CONFIG,
  U as QWEN35_VL_27B_VISION_CONFIG,
  c as WEBGPU_ERROR_CODES,
  E as WebGPUUnsupportedError,
  C as canRunLargeModel
};

//# sourceMappingURL=mentria.mjs.map