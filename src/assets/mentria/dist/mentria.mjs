import { D as c, O as v, S as M, _ as D, c as R, g as W, h as G, k as O, l as U, m, o as T, p as B, s as V, t as F, u as j, x as A, y as k } from "./capabilities-BhXJGoqk.mjs";
var x = 1, Q = class I {
  #r = null;
  #e = /* @__PURE__ */ new Map();
  #a = null;
  #l = null;
  #u = null;
  #o = !1;
  #d = "direct";
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
    this.#d = r, this.prefixCache = null, r === "direct" ? (this.#r = new Worker(t, { type: "module" }), this.#c(), this.#n = Promise.resolve()) : this.#n = fetch(t).then((o) => {
      if (!o.ok) throw new v(c.NO_WEBGPU, `MentriaEngine: failed to fetch worker from ${t} (HTTP ${o.status}).`);
      return o.text();
    }).then((o) => {
      const s = new Blob([o], { type: "application/javascript" });
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
    if (e.type === "profile") {
      const r = this.#e.get(e.id);
      if (!r) return;
      r.onProfile?.(e.data);
      return;
    }
    if (e.type === "logitsTop5") {
      const r = this.#e.get(e.id);
      if (!r) return;
      r.onDebugLine?.(e.data?.line ?? "");
      return;
    }
    if (e.type === "sessionChunk") {
      const r = this.#e.get(e.id);
      if (!r) return;
      r.onSessionChunk?.(e.data);
      return;
    }
    if (e.type === "progress") {
      try {
        this.#a?.(e.data);
      } catch {
      }
      const r = this.#e.get(e.id);
      if (r?.onProgress) try {
        r.onProgress(e.data);
      } catch {
      }
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
      const r = new v(c.NO_DEVICE, e.error || "WebGPU device lost.");
      for (const [o, s] of this.#e)
        s.cleanup?.(), s.reject(r);
      this.#e.clear(), this.#l?.({
        code: c.NO_DEVICE,
        reason: e.reason || "unknown",
        message: e.error || "WebGPU device lost."
      });
      return;
    }
    if (e.type !== "result" && e.type !== "error") return;
    const t = this.#e.get(e.id);
    t && (this.#e.delete(e.id), t.cleanup?.(), e.type === "result" ? t.resolve(e.data) : t.reject(this.#f(e)));
  }
  #f(e) {
    const t = e.code;
    if (t === c.NO_WEBGPU || t === c.NO_ADAPTER || t === c.NO_DEVICE) return new v(t, e.error || "WebGPU unavailable");
    if (t === A.VISION_NOT_LOADED) return new M(t, e.error || "Vision tower not loaded");
    if (typeof t == "string" && Object.values(k).includes(t)) {
      const r = new Error(e.error);
      return r.code = t, r;
    }
    return new Error(e.error);
  }
  #t(e, t, { onToken: r = null, onLayerNorms: o = null, onL23Residuals: s = null, onL23Mlp: h = null, onL23Attention: i = null, onDeltaState: p = null, onSessionChunk: _ = null, onProfile: P = null, onDebugLine: g = null, onProgress: N = null, transfer: f = null, signal: a = null, timeoutMs: d = 0 } = {}) {
    const n = crypto.randomUUID();
    return new Promise((b, L) => {
      if (this.#o) {
        L(new v(c.NO_DEVICE, "WebGPU device was lost; construct a new MentriaEngine to recover."));
        return;
      }
      if (a?.aborted) {
        L(this.#s(a));
        return;
      }
      let E = null, y = null;
      const w = () => {
        E !== null && (clearTimeout(E), E = null), y && (a?.removeEventListener("abort", y), y = null);
      };
      this.#e.set(n, {
        resolve: b,
        reject: L,
        onToken: r,
        onLayerNorms: o,
        onL23Residuals: s,
        onL23Mlp: h,
        onL23Attention: i,
        onDeltaState: p,
        onSessionChunk: _,
        onProfile: P,
        onDebugLine: g,
        onProgress: N,
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
      }, a.addEventListener("abort", y, { once: !0 })), d > 0 && (E = setTimeout(() => {
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
          l.reject(O("TimeoutError", `Generation timed out after ${d}ms`));
        }
      }, d)), this.#n.then(() => {
        if (this.#e.has(n))
          try {
            f && f.length ? this.#r.postMessage({
              type: e,
              id: n,
              data: t
            }, f) : this.#r.postMessage({
              type: e,
              id: n,
              data: t
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
    return e?.reason !== void 0 ? e.reason instanceof Error ? e.reason : O("AbortError", String(e.reason)) : O("AbortError", "Generation aborted");
  }
  static isWebGPUAvailable() {
    return typeof navigator < "u" && !!navigator.gpu;
  }
  static async probeWebGPU() {
    if (!I.isWebGPUAvailable()) return {
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
    if (!I.isWebGPUAvailable()) throw new v(c.NO_WEBGPU, "WebGPU is not available. Use Chrome 113+, Edge 113+, or Safari 18.2+.");
    const t = await this.#t("init", e);
    if (t && t.protocolVersion !== void 0 && t.protocolVersion !== 1) throw new Error(`MentriaEngine: protocol version mismatch (main=1, worker=${t.protocolVersion}). The main-thread bundle and worker bundle are from incompatible releases — force-reload the page (Ctrl+Shift+R) to clear cached chunks, or pin matching versions.`);
    return t;
  }
  async loadModel(e) {
    return this.#t("load", e);
  }
  async generate(e, t) {
    const { signal: r, timeoutMs: o, onLayerNorms: s, onL23Residuals: h, onL23Mlp: i, onL23Attention: p, onDeltaState: _, onProfile: P, onDebugLine: g, onProgress: N, ...f } = e || {};
    return this.#t("generate", f, {
      onProgress: N || null,
      onToken: t || null,
      onLayerNorms: s || null,
      onL23Residuals: h || null,
      onL23Mlp: i || null,
      onL23Attention: p || null,
      onDeltaState: _ || null,
      onProfile: P || null,
      onDebugLine: g || null,
      signal: r || null,
      timeoutMs: o || 0
    });
  }
  stream(e) {
    const { signal: t, timeoutMs: r, onProfile: o, onDebugLine: s, onProgress: h, onLayerNorms: i, onL23Residuals: p, onL23Mlp: _, onL23Attention: P, onDeltaState: g, ...N } = e || {};
    if (this.#o) return this.#h(new v(c.NO_DEVICE, "WebGPU device was lost; construct a new MentriaEngine to recover."));
    if (t?.aborted) return this.#h(this.#s(t));
    const f = [], a = [];
    let d = !1, n = null, b = !1;
    const L = (u) => {
      b || (a.length ? a.shift().resolve({
        value: u,
        done: !1
      }) : f.push(u));
    }, E = () => {
      if (!(d || n))
        for (d = !0; a.length; ) a.shift().resolve({
          value: void 0,
          done: !0
        });
    }, y = (u) => {
      if (!(d || n))
        for (n = u; a.length; ) a.shift().reject(u);
    }, w = this.#t("generate", N, {
      onToken: L,
      onProgress: h || null,
      onProfile: o || null,
      onDebugLine: s || null,
      onLayerNorms: i || null,
      onL23Residuals: p || null,
      onL23Mlp: _ || null,
      onL23Attention: P || null,
      onDeltaState: g || null,
      signal: t || null,
      timeoutMs: r || 0
    });
    w.then(E, y);
    const l = this;
    return {
      [Symbol.asyncIterator]() {
        return this;
      },
      next() {
        return f.length ? Promise.resolve({
          value: f.shift(),
          done: !1
        }) : n ? Promise.reject(n) : d ? Promise.resolve({
          value: void 0,
          done: !0
        }) : new Promise((u, S) => a.push({
          resolve: u,
          reject: S
        }));
      },
      return(u) {
        if (!d && !n && !b) {
          b = !0;
          try {
            l.#r?.postMessage({
              type: "interrupt",
              id: ""
            });
          } catch {
          }
        }
        return E(), w.catch(() => {
        }), Promise.resolve({
          value: u,
          done: !0
        });
      },
      throw(u) {
        if (!d && !n && !b) {
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
  #h(e) {
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
  async encodeChat(e, t = {}) {
    return this.#t("encodeChat", {
      messages: e,
      assistantPrefix: t.assistantPrefix,
      continueLast: t.continueLast === !0,
      enableThinking: t.enableThinking !== !1
    });
  }
  async encode(e, t = {}) {
    return this.#t("encode", {
      text: e,
      addSpecial: t.addSpecial === !0
    });
  }
  async decode(e, t = {}) {
    return this.#t("decode", {
      ids: e,
      skipSpecial: t.skipSpecial === !0
    });
  }
  async prefillOnly(e = {}) {
    const { onProgress: t, signal: r, timeoutMs: o, ...s } = e || {};
    return this.#t("prefillOnly", s, {
      onProgress: t || null,
      signal: r || null,
      timeoutMs: o || 0
    });
  }
  async snapshotSession(e = {}) {
    const { tokens: t = null, onChunk: r = null, checksum: o = !0 } = e, s = [], h = await this.#t("snapshotSession", {
      tokens: t || void 0,
      checksum: o
    }, { onSessionChunk: (i) => {
      r ? r(i) : s[i.index] = i.bytes;
    } });
    return {
      manifest: h.manifest,
      buffers: r ? null : s,
      bytes: h.bytes,
      ms: h.ms
    };
  }
  async restoreSession(e, t, r = {}) {
    const { verify: o = !0, transfer: s = !0 } = r;
    if (!e || !Array.isArray(e.entries)) throw new Error("restoreSession: manifest with an entries array is required");
    const h = typeof t == "function" ? t : (i) => Array.isArray(t) ? t[i] : void 0;
    await this.#t("restoreSession", {
      phase: "begin",
      manifest: e
    });
    for (let i = 0; i < e.entries.length; i++) {
      const p = await h(i, e.entries[i]);
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
  async createPrefixCache(e = {}) {
    const t = await (await import("./prefix_registry_browser-BWn93Dmy.mjs")).createPrefixCache(this, e);
    return t && (this.prefixCache = t), t;
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
  A as MULTIMODAL_ERROR_CODES,
  Q as MentriaEngine,
  M as MultimodalUnavailableError,
  x as PROTOCOL_VERSION,
  B as QWEN35_08B_CONFIG,
  m as QWEN35_27B_BONSAI_CONFIG,
  G as QWEN35_2B_CONFIG,
  W as QWEN35_4B_CONFIG,
  D as QWEN35_9B_BONSAI2_CONFIG,
  T as QWEN35_VL_08B_VISION_CONFIG,
  V as QWEN35_VL_27B_VISION_CONFIG,
  R as QWEN35_VL_2B_VISION_CONFIG,
  U as QWEN35_VL_4B_VISION_CONFIG,
  j as QWEN35_VL_9B_VISION_CONFIG,
  c as WEBGPU_ERROR_CODES,
  v as WebGPUUnsupportedError,
  F as canRunLargeModel
};

//# sourceMappingURL=mentria.mjs.map