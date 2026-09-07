import { C as E, S as c, _ as S, d as I, f as R, g as A, o as W, p as C, s as O, t as U, u as G, w as M } from "./capabilities-DcpKTBdq.mjs";
var m = 1, T = class N {
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
    this.#h = r, r === "direct" ? (this.#r = new Worker(t, { type: "module" }), this.#c(), this.#n = Promise.resolve()) : this.#n = fetch(t).then((o) => {
      if (!o.ok) throw new E(c.NO_WEBGPU, `MentriaEngine: failed to fetch worker from ${t} (HTTP ${o.status}).`);
      return o.text();
    }).then((o) => {
      const a = new Blob([o], { type: "application/javascript" });
      this.#i = URL.createObjectURL(a), this.#r = new Worker(this.#i, { type: "module" }), this.#c();
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
      const r = new E(c.NO_DEVICE, e.error || "WebGPU device lost.");
      for (const [o, a] of this.#e)
        a.cleanup?.(), a.reject(r);
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
    return t === c.NO_WEBGPU || t === c.NO_ADAPTER || t === c.NO_DEVICE ? new E(t, e.error || "WebGPU unavailable") : t === A.VISION_NOT_LOADED ? new S(t, e.error || "Vision tower not loaded") : new Error(e.error);
  }
  #t(e, t, { onToken: r = null, onLayerNorms: o = null, onL23Residuals: a = null, onL23Mlp: d = null, onL23Attention: i = null, onDeltaState: p = null, onSessionChunk: P = null, onProfile: g = null, onDebugLine: _ = null, transfer: f = null, signal: s = null, timeoutMs: h = 0 } = {}) {
    const n = crypto.randomUUID();
    return new Promise((b, L) => {
      if (this.#o) {
        L(new E(c.NO_DEVICE, "WebGPU device was lost; construct a new MentriaEngine to recover."));
        return;
      }
      if (s?.aborted) {
        L(this.#a(s));
        return;
      }
      let v = null, y = null;
      const w = () => {
        v !== null && (clearTimeout(v), v = null), y && (s?.removeEventListener("abort", y), y = null);
      };
      this.#e.set(n, {
        resolve: b,
        reject: L,
        onToken: r,
        onLayerNorms: o,
        onL23Residuals: a,
        onL23Mlp: d,
        onL23Attention: i,
        onDeltaState: p,
        onSessionChunk: P,
        onProfile: g,
        onDebugLine: _,
        cleanup: w
      }), s && (y = () => {
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
          l.reject(this.#a(s));
        }
      }, s.addEventListener("abort", y, { once: !0 })), h > 0 && (v = setTimeout(() => {
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
  #a(e) {
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
    if (!N.isWebGPUAvailable()) throw new E(c.NO_WEBGPU, "WebGPU is not available. Use Chrome 113+, Edge 113+, or Safari 18.2+.");
    const t = await this.#t("init", e);
    if (t && t.protocolVersion !== void 0 && t.protocolVersion !== 1) throw new Error(`MentriaEngine: protocol version mismatch (main=1, worker=${t.protocolVersion}). The main-thread bundle and worker bundle are from incompatible releases — force-reload the page (Ctrl+Shift+R) to clear cached chunks, or pin matching versions.`);
    return t;
  }
  async loadModel(e) {
    return this.#t("load", e);
  }
  async generate(e, t) {
    const { signal: r, timeoutMs: o, onLayerNorms: a, onL23Residuals: d, onL23Mlp: i, onL23Attention: p, onDeltaState: P, onProfile: g, onDebugLine: _, ...f } = e || {};
    return this.#t("generate", f, {
      onToken: t || null,
      onLayerNorms: a || null,
      onL23Residuals: d || null,
      onL23Mlp: i || null,
      onL23Attention: p || null,
      onDeltaState: P || null,
      onProfile: g || null,
      onDebugLine: _ || null,
      signal: r || null,
      timeoutMs: o || 0
    });
  }
  stream(e) {
    const { signal: t, timeoutMs: r, onProfile: o, onDebugLine: a, onLayerNorms: d, onL23Residuals: i, onL23Mlp: p, onL23Attention: P, onDeltaState: g, ..._ } = e || {};
    if (this.#o) return this.#d(new E(c.NO_DEVICE, "WebGPU device was lost; construct a new MentriaEngine to recover."));
    if (t?.aborted) return this.#d(this.#a(t));
    const f = [], s = [];
    let h = !1, n = null, b = !1;
    const L = (u) => {
      b || (s.length ? s.shift().resolve({
        value: u,
        done: !1
      }) : f.push(u));
    }, v = () => {
      if (!(h || n))
        for (h = !0; s.length; ) s.shift().resolve({
          value: void 0,
          done: !0
        });
    }, y = (u) => {
      if (!(h || n))
        for (n = u; s.length; ) s.shift().reject(u);
    }, w = this.#t("generate", _, {
      onToken: L,
      onProfile: o || null,
      onDebugLine: a || null,
      onLayerNorms: d || null,
      onL23Residuals: i || null,
      onL23Mlp: p || null,
      onL23Attention: P || null,
      onDeltaState: g || null,
      signal: t || null,
      timeoutMs: r || 0
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
        }) : new Promise((u, k) => s.push({
          resolve: u,
          reject: k
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
  async snapshotSession(e = {}) {
    const { tokens: t = null, onChunk: r = null, checksum: o = !0 } = e, a = [], d = await this.#t("snapshotSession", {
      tokens: t || void 0,
      checksum: o
    }, { onSessionChunk: (i) => {
      r ? r(i) : a[i.index] = i.bytes;
    } });
    return {
      manifest: d.manifest,
      buffers: r ? null : a,
      bytes: d.bytes,
      ms: d.ms
    };
  }
  async restoreSession(e, t, r = {}) {
    const { verify: o = !0, transfer: a = !0 } = r;
    if (!e || !Array.isArray(e.entries)) throw new Error("restoreSession: manifest with an entries array is required");
    const d = typeof t == "function" ? t : (i) => Array.isArray(t) ? t[i] : void 0;
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
      }, a ? { transfer: [p] } : void 0);
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
  T as MentriaEngine,
  S as MultimodalUnavailableError,
  m as PROTOCOL_VERSION,
  G as QWEN35_08B_CONFIG,
  I as QWEN35_27B_BONSAI_CONFIG,
  R as QWEN35_2B_CONFIG,
  C as QWEN35_4B_CONFIG,
  W as QWEN35_VL_08B_VISION_CONFIG,
  O as QWEN35_VL_27B_VISION_CONFIG,
  c as WEBGPU_ERROR_CODES,
  E as WebGPUUnsupportedError,
  U as canRunLargeModel
};

//# sourceMappingURL=mentria.mjs.map