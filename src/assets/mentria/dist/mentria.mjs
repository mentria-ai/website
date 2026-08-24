import { C as g, S as v, a as A, d as k, f as I, g as _, h as M, l as S, o as W, t as m, u as R, x as c } from "./capabilities-C3V5F_03.mjs";
var D = 1, O = class P {
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
    this.#d = r, r === "direct" ? (this.#r = new Worker(t, { type: "module" }), this.#c(), this.#n = Promise.resolve()) : this.#n = fetch(t).then((a) => {
      if (!a.ok) throw new v(c.NO_WEBGPU, `MentriaEngine: failed to fetch worker from ${t} (HTTP ${a.status}).`);
      return a.text();
    }).then((a) => {
      const o = new Blob([a], { type: "application/javascript" });
      this.#i = URL.createObjectURL(o), this.#r = new Worker(this.#i, { type: "module" }), this.#c();
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
    if (e.type === "sessionChunk") {
      const r = this.#e.get(e.id);
      if (!r) return;
      r.onSessionChunk?.(e.data);
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
      const r = new v(c.NO_DEVICE, e.error || "WebGPU device lost.");
      for (const [a, o] of this.#e)
        o.cleanup?.(), o.reject(r);
      this.#e.clear(), this.#l?.({
        code: c.NO_DEVICE,
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
    return t === c.NO_WEBGPU || t === c.NO_ADAPTER || t === c.NO_DEVICE ? new v(t, e.error || "WebGPU unavailable") : t === M.VISION_NOT_LOADED ? new _(t, e.error || "Vision tower not loaded") : new Error(e.error);
  }
  #t(e, t, { onToken: r = null, onLayerNorms: a = null, onL23Residuals: o = null, onL23Mlp: s = null, onL23Attention: n = null, onDeltaState: u = null, onSessionChunk: d = null, transfer: f = null, signal: p = null, timeoutMs: y = 0 } = {}) {
    const l = crypto.randomUUID();
    return new Promise((E, i) => {
      if (this.#o) {
        i(new v(c.NO_DEVICE, "WebGPU device was lost; construct a new MentriaEngine to recover."));
        return;
      }
      if (p?.aborted) {
        i(this.#s(p));
        return;
      }
      let b = null, w = null;
      const L = () => {
        b !== null && (clearTimeout(b), b = null), w && (p?.removeEventListener("abort", w), w = null);
      };
      this.#e.set(l, {
        resolve: E,
        reject: i,
        onToken: r,
        onLayerNorms: a,
        onL23Residuals: o,
        onL23Mlp: s,
        onL23Attention: n,
        onDeltaState: u,
        onSessionChunk: d,
        cleanup: L
      }), p && (w = () => {
        const h = this.#e.get(l);
        if (h) {
          this.#e.delete(l), h.cleanup();
          try {
            this.#r.postMessage({
              type: "interrupt",
              id: ""
            });
          } catch {
          }
          h.reject(this.#s(p));
        }
      }, p.addEventListener("abort", w, { once: !0 })), y > 0 && (b = setTimeout(() => {
        const h = this.#e.get(l);
        if (h) {
          this.#e.delete(l), h.cleanup();
          try {
            this.#r.postMessage({
              type: "interrupt",
              id: ""
            });
          } catch {
          }
          h.reject(g("TimeoutError", `Generation timed out after ${y}ms`));
        }
      }, y)), this.#n.then(() => {
        if (this.#e.has(l))
          try {
            f && f.length ? this.#r.postMessage({
              type: e,
              id: l,
              data: t
            }, f) : this.#r.postMessage({
              type: e,
              id: l,
              data: t
            });
          } catch (h) {
            this.#e.has(l) && (this.#e.delete(l), L()), i(h);
          }
      }, (h) => {
        this.#e.has(l) && (this.#e.delete(l), L()), i(h);
      });
    });
  }
  #s(e) {
    return e?.reason !== void 0 ? e.reason instanceof Error ? e.reason : g("AbortError", String(e.reason)) : g("AbortError", "Generation aborted");
  }
  static isWebGPUAvailable() {
    return typeof navigator < "u" && !!navigator.gpu;
  }
  static async probeWebGPU() {
    if (!P.isWebGPUAvailable()) return {
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
    if (!P.isWebGPUAvailable()) throw new v(c.NO_WEBGPU, "WebGPU is not available. Use Chrome 113+, Edge 113+, or Safari 18.2+.");
    const t = await this.#t("init", e);
    if (t && t.protocolVersion !== void 0 && t.protocolVersion !== 1) throw new Error(`MentriaEngine: protocol version mismatch (main=1, worker=${t.protocolVersion}). The main-thread bundle and worker bundle are from incompatible releases — force-reload the page (Ctrl+Shift+R) to clear cached chunks, or pin matching versions.`);
    return t;
  }
  async loadModel(e) {
    return this.#t("load", e);
  }
  async generate(e, t) {
    const { signal: r, timeoutMs: a, onLayerNorms: o, onL23Residuals: s, onL23Mlp: n, onL23Attention: u, onDeltaState: d, ...f } = e || {};
    return this.#t("generate", f, {
      onToken: t || null,
      onLayerNorms: o || null,
      onL23Residuals: s || null,
      onL23Mlp: n || null,
      onL23Attention: u || null,
      onDeltaState: d || null,
      signal: r || null,
      timeoutMs: a || 0
    });
  }
  stream(e) {
    const { signal: t, timeoutMs: r, ...a } = e || {};
    if (this.#o) return this.#h(new v(c.NO_DEVICE, "WebGPU device was lost; construct a new MentriaEngine to recover."));
    if (t?.aborted) return this.#h(this.#s(t));
    const o = [], s = [];
    let n = !1, u = null, d = !1;
    const f = (i) => {
      d || (s.length ? s.shift().resolve({
        value: i,
        done: !1
      }) : o.push(i));
    }, p = () => {
      if (!(n || u))
        for (n = !0; s.length; ) s.shift().resolve({
          value: void 0,
          done: !0
        });
    }, y = (i) => {
      if (!(n || u))
        for (u = i; s.length; ) s.shift().reject(i);
    }, l = this.#t("generate", a, {
      onToken: f,
      signal: t || null,
      timeoutMs: r || 0
    });
    l.then(p, y);
    const E = this;
    return {
      [Symbol.asyncIterator]() {
        return this;
      },
      next() {
        return o.length ? Promise.resolve({
          value: o.shift(),
          done: !1
        }) : u ? Promise.reject(u) : n ? Promise.resolve({
          value: void 0,
          done: !0
        }) : new Promise((i, b) => s.push({
          resolve: i,
          reject: b
        }));
      },
      return(i) {
        if (!n && !u && !d) {
          d = !0;
          try {
            E.#r?.postMessage({
              type: "interrupt",
              id: ""
            });
          } catch {
          }
        }
        return p(), l.catch(() => {
        }), Promise.resolve({
          value: i,
          done: !0
        });
      },
      throw(i) {
        if (!n && !u && !d) {
          d = !0;
          try {
            E.#r?.postMessage({
              type: "interrupt",
              id: ""
            });
          } catch {
          }
        }
        return y(i), l.catch(() => {
        }), Promise.reject(i);
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
  async snapshotSession(e = {}) {
    const { tokens: t = null, onChunk: r = null, checksum: a = !0 } = e, o = [], s = await this.#t("snapshotSession", {
      tokens: t || void 0,
      checksum: a
    }, { onSessionChunk: (n) => {
      r ? r(n) : o[n.index] = n.bytes;
    } });
    return {
      manifest: s.manifest,
      buffers: r ? null : o,
      bytes: s.bytes,
      ms: s.ms
    };
  }
  async restoreSession(e, t, r = {}) {
    const { verify: a = !0, transfer: o = !0 } = r;
    if (!e || !Array.isArray(e.entries)) throw new Error("restoreSession: manifest with an entries array is required");
    const s = typeof t == "function" ? t : (n) => Array.isArray(t) ? t[n] : void 0;
    await this.#t("restoreSession", {
      phase: "begin",
      manifest: e
    });
    for (let n = 0; n < e.entries.length; n++) {
      const u = await s(n, e.entries[n]);
      if (!u) throw new Error(`restoreSession: no bytes for entry ${n} ('${e.entries[n].key}')`);
      await this.#t("restoreSession", {
        phase: "chunk",
        index: n,
        bytes: u,
        verify: a
      }, o ? { transfer: [u] } : void 0);
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
  M as MULTIMODAL_ERROR_CODES,
  O as MentriaEngine,
  _ as MultimodalUnavailableError,
  D as PROTOCOL_VERSION,
  S as QWEN35_08B_CONFIG,
  R as QWEN35_27B_BONSAI_CONFIG,
  k as QWEN35_2B_CONFIG,
  I as QWEN35_4B_CONFIG,
  A as QWEN35_VL_08B_VISION_CONFIG,
  W as QWEN35_VL_27B_VISION_CONFIG,
  c as WEBGPU_ERROR_CODES,
  v as WebGPUUnsupportedError,
  m as canRunLargeModel
};

//# sourceMappingURL=mentria.mjs.map