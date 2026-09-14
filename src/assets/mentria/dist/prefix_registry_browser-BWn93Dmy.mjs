import { o as P } from "./session_manifest-D9A7r9yZ.mjs";
var F = "mentria-checkpoint", L = 174e6, U = 20480;
function N(t) {
  return L + U * Math.max(0, t);
}
var q = 156893184, H = 65536;
function R(t) {
  return q + H * Math.max(0, t);
}
function x(t) {
  return t === null || typeof t != "object" ? JSON.stringify(t) ?? "null" : Array.isArray(t) ? `[${t.map(x).join(",")}]` : `{${Object.keys(t).sort().map((e) => `${JSON.stringify(e)}:${x(t[e])}`).join(",")}}`;
}
function I(t, e) {
  const s = e.length, r = new TextEncoder().encode(String(t)), o = new Uint8Array(r.length + 1 + s * 4);
  o.set(r, 0), o[r.length] = 0;
  const n = new Uint32Array(s);
  for (let a = 0; a < s; a++) n[a] = e[a] >>> 0;
  return o.set(new Uint8Array(n.buffer, n.byteOffset, n.byteLength), r.length + 1), o;
}
function j(t) {
  const e = new Uint32Array(t.length);
  for (let s = 0; s < t.length; s++) e[s] = t[s] >>> 0;
  return new Uint8Array(e.buffer, e.byteOffset, e.byteLength);
}
function G(t) {
  const e = t instanceof Uint8Array ? t : new Uint8Array(t), s = e.buffer.slice(e.byteOffset, e.byteOffset + e.byteLength);
  return Array.from(new Uint32Array(s));
}
function J(t, e) {
  const s = String(e).replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80);
  return `${String(t).padStart(3, "0")}-${s}.bin`;
}
function K(t, e = 512) {
  const s = Math.max(1, e | 0), r = Math.max(0, Math.floor(t) || 0);
  return r - r % s;
}
var p = () => typeof performance < "u" && performance.now ? performance.now() : Date.now(), W = class {
  constructor({ store: t, guard: e, guardDigest: s = null, maxBytes: r = 20 * 1024 * 1024 * 1024, maxEntries: o = 16, minStepTokens: n = 8192, chunkTokens: a = 512, maxPerRequest: i = 4, minFreeBytes: h = 8 * 1024 * 1024 * 1024, verifyRestore: l = !0, estimateBytes: d = N, now: c = () => Date.now() }) {
    if (!t) throw new Error("PrefixRegistryCore: store is required");
    if (this.store = t, this.guard = e, this.guardDigest = s, this.maxBytes = Math.max(0, r), this.maxEntries = Math.max(0, o | 0), this.minStepTokens = Math.max(1, n | 0), this.chunkTokens = Math.max(1, a | 0), this.maxPerRequest = Math.max(0, i | 0), this.minFreeBytes = Math.max(0, h), this.verifyRestore = l !== !1, this.estimateBytes = d, this.now = c, this.guardDigest === null && e !== void 0) {
      const g = t.digest(x(e));
      typeof g == "string" ? this.guardDigest = g : this._guardPending = Promise.resolve(g).then((y) => (this.guardDigest = y, y));
    }
    this.entries = [], this.bytes = 0, this.damaged = [], this.opened = !1, this.fingerprintDigest = null, this.stats_ = {
      hits: 0,
      misses: 0,
      emitted: 0,
      deduped: 0,
      evicted: 0,
      refused: 0,
      restoreFailures: 0,
      tokensSaved: 0
    };
  }
  get size() {
    return this.entries.length;
  }
  async _digest(t) {
    return this.store.digest(t);
  }
  async open() {
    this._guardPending && (await this._guardPending, this._guardPending = null), await this.store.open(), this.entries = [], this.bytes = 0, this.damaged = [];
    let t;
    try {
      t = await this.store.listKeys();
    } catch {
      t = [];
    }
    for (const e of [...t].sort()) {
      const s = this.damaged.length, r = await this._loadEntry(e);
      if (r) {
        this.entries.push(r), this.bytes += r.bytes;
        continue;
      }
      this.store.publishMode === "meta-last" && this.damaged.length > s && /^meta\.json unreadable/.test(this.damaged[this.damaged.length - 1].reason) && (this.damaged.pop(), await this.store.remove(e).catch(() => {
      }));
    }
    return this.entries.sort((e, s) => s.lastUsedAt - e.lastUsedAt), await this.evictToFit(), this.opened = !0, this;
  }
  async _loadEntry(t) {
    const e = (i) => (this.damaged.push({
      name: t,
      reason: i
    }), null);
    let s;
    try {
      s = await this.store.readJson(t, "meta.json");
    } catch (i) {
      return i && i.notADirectory ? null : e(`meta.json unreadable (${i.code || i.message})`);
    }
    if (s.format !== "mentria-checkpoint") return e(`format '${s.format}'`);
    if (s.version !== 1) return e(`version ${s.version}`);
    if (s.key !== t) return e(`meta key ${s.key} != directory ${t}`);
    const r = Array.isArray(s.files) ? s.files : null;
    if (!r || !r.length) return e("no entry files declared");
    let o;
    try {
      const i = await this.store.readBytes(t, "ledger.bin");
      if (i.byteLength !== s.tokens * 4) return e(`ledger.bin is ${i.byteLength} bytes, meta says ${s.tokens} tokens`);
      o = G(i);
    } catch (i) {
      return e(`ledger.bin unreadable (${i.code || i.message})`);
    }
    if (!o.length) return e("empty ledger");
    let n = 0;
    for (const i of r) {
      let h;
      try {
        h = await this.store.sizeOf(t, i.file);
      } catch {
        return e(`missing entry file ${i.file}`);
      }
      if (h !== i.bytes) return e(`${i.file} is ${h} bytes, meta says ${i.bytes} — truncated`);
      n += i.bytes;
    }
    if (s.manifestEntries !== r.length) return e(`manifest declares ${s.manifestEntries} entries, ${r.length} on disk`);
    let a = {
      lastUsedAt: s.createdAt || this.now(),
      hits: 0
    };
    try {
      a = {
        ...a,
        ...await this.store.readJson(t, "use.json")
      };
    } catch {
    }
    return {
      key: t,
      short: t.slice(0, 12),
      dir: this.store.label(t),
      tokens: o,
      guardDigest: s.guardDigest,
      fingerprintDigest: s.fingerprintDigest ?? null,
      bytes: n,
      entries: r.length,
      createdAt: s.createdAt || this.now(),
      lastUsedAt: Number(a.lastUsedAt) || this.now(),
      hits: Number(a.hits) || 0,
      kind: s.kind || "prefill"
    };
  }
  bindFingerprint(t) {
    if (t == null) return null;
    const e = this.store.digest(x(t));
    return typeof e == "string" ? (this.fingerprintDigest = e, e) : Promise.resolve(e).then((s) => (this.fingerprintDigest = s, s));
  }
  select(t, e = {}) {
    const s = Math.max(0, e.minTokens | 0), r = {
      entry: null,
      reuse: 0,
      reason: "",
      bestCommon: 0,
      candidates: 0
    };
    if (!Array.isArray(t) || t.length === 0)
      return r.reason = "empty-prompt", r;
    if (!this.entries.length)
      return r.reason = "no-entries", this.stats_.misses++, r;
    let o = 0, n = 0, a = 0, i = null;
    for (const h of this.entries) {
      if (h.guardDigest !== this.guardDigest) {
        o++;
        continue;
      }
      if (this.fingerprintDigest && h.fingerprintDigest && h.fingerprintDigest !== this.fingerprintDigest) {
        n++;
        continue;
      }
      r.candidates++;
      const l = P(h.tokens, t, h.tokens.length);
      if (!l.reusable) {
        const d = l.firstDivergence >= 0 ? l.firstDivergence : Math.min(h.tokens.length, t.length);
        d > r.bestCommon && (r.bestCommon = d);
        continue;
      }
      if (h.tokens.length < s) {
        a++;
        continue;
      }
      (!i || h.tokens.length > i.tokens.length || h.tokens.length === i.tokens.length && h.lastUsedAt > i.lastUsedAt || h.tokens.length === i.tokens.length && h.lastUsedAt === i.lastUsedAt && h.key < i.key) && (i = h);
    }
    return i ? (r.entry = i, r.reuse = i.tokens.length, r.reason = "ok", r) : (this.stats_.misses++, r.candidates === 0 ? r.reason = o ? "guard-mismatch" : n ? "fingerprint-mismatch" : "no-entries" : a ? r.reason = "below-min-tokens" : r.reason = r.bestCommon > 0 ? "prefix-diverged" : "no-common-prefix", r);
  }
  deepestPrefixLen(t) {
    let e = 0;
    for (const s of this.entries)
      s.guardDigest === this.guardDigest && (s.tokens.length <= e || P(s.tokens, t, s.tokens.length).reusable && (e = s.tokens.length));
    return e;
  }
  assertLedgerPrefix(t, e) {
    const s = P(t.tokens, e, t.tokens.length);
    if (!s.reusable)
      throw this.stats_.refused++, new Error(`checkpoint ${t.short} refused — its ${t.tokens.length}-token ledger is not a strict prefix of this ${e.length}-token prompt (${s.reason}, first divergence at ${s.firstDivergence}). Restoring it would produce fluent, confidently wrong output with no error.`);
    return s;
  }
  assertLedgerExact(t, e) {
    const s = t.tokens;
    if (!(Array.isArray(e) && s.length === e.length && s.every((r, o) => r === e[o])))
      throw this.stats_.refused++, new Error(`checkpoint ${t.short} refused — its ${s.length}-token ledger is not the ${Array.isArray(e) ? e.length : 0}-token session it is being restored over. Restoring it would produce fluent, confidently wrong output with no error.`);
    return {
      reusable: !0,
      reason: "exact",
      residentLen: s.length
    };
  }
  async restore(t, e, s, r = {}) {
    r.exact === !0 ? this.assertLedgerExact(e, s) : this.assertLedgerPrefix(e, s);
    const o = p();
    let n;
    try {
      n = await this.store.readJson(e.key, "meta.json");
    } catch (u) {
      this._quarantine(e, `meta.json vanished (${u.code || u.message})`);
      const m = /* @__PURE__ */ new Error(`checkpoint ${e.short} is gone from the store`);
      throw m.missing = !0, m;
    }
    const a = n.manifest, i = n.files || [];
    if (!a || !Array.isArray(a.entries))
      throw this._quarantine(e, "meta.json holds no engine manifest"), new Error(`checkpoint ${e.short} refused — no engine manifest in the store`);
    if (a.entries.length !== i.length)
      throw this._quarantine(e, "manifest/entry-file count disagree"), new Error(`checkpoint ${e.short} refused — manifest declares ${a.entries.length} entries, ${i.length} files stored`);
    const h = Array.isArray(a.tokens) ? a.tokens : [];
    if (h.length !== e.tokens.length)
      throw this._quarantine(e, "manifest ledger length != indexed ledger length"), new Error(`checkpoint ${e.short} refused — manifest ledger is ${h.length} tokens, the index says ${e.tokens.length}`);
    for (let u = 0; u < h.length; u++) if (h[u] !== e.tokens[u])
      throw this._quarantine(e, `manifest ledger diverges from indexed ledger at ${u}`), new Error(`checkpoint ${e.short} refused — manifest ledger diverges from the indexed ledger at token ${u}`);
    const l = this.store, d = e.key, c = this.verifyRestore;
    async function* g() {
      for (const u of i) {
        const m = await l.readBytes(d, u.file);
        if (m.byteLength !== u.bytes) throw new Error(`checkpoint entry ${u.file} is ${m.byteLength} bytes, meta says ${u.bytes} — the stored checkpoint is damaged`);
        yield {
          index: u.index,
          bytes: m.buffer.byteLength === m.byteLength && m.byteOffset === 0 ? m.buffer : m.buffer.slice(m.byteOffset, m.byteOffset + m.byteLength)
        };
      }
    }
    let y;
    try {
      y = await t.restore({
        manifest: a,
        entries: g(),
        verify: c
      });
    } catch (u) {
      throw this.stats_.restoreFailures++, u.engineTouched = !0, u;
    }
    const w = Math.round(p() - o);
    return this.touch(e), this.stats_.hits++, this.stats_.tokensSaved += e.tokens.length, {
      ok: !0,
      ms: w,
      tokens: e.tokens.length,
      bytes: e.bytes,
      seqLen: y && typeof y.seqLen == "number" ? y.seqLen : e.tokens.length
    };
  }
  async emit(t, { ledger: e, kind: s = "prefill", log: r = null }) {
    const o = p(), n = (f) => ({
      entry: null,
      reason: f,
      ms: Math.round(p() - o),
      bytes: 0
    });
    if (!Array.isArray(e) || e.length === 0) return n("empty-ledger");
    if (this.maxEntries === 0) return n("registry-disabled");
    const a = await this._digest(I(this.guardDigest, e)), i = this.entries.find((f) => f.key === a);
    if (i)
      return this.touch(i), this.stats_.deduped++, {
        entry: i,
        reason: "already-stored",
        ms: 0,
        bytes: i.bytes
      };
    const h = this.estimateBytes(e.length);
    if (this.maxBytes > 0 && h > this.maxBytes)
      return r && r.warn("checkpoint refused — larger than the whole registry budget", {
        tokens: e.length,
        predicted_mib: Math.round(h / 1048576),
        budget_mib: Math.round(this.maxBytes / 1048576)
      }), this.stats_.refused++, n("larger-than-budget");
    const l = await this.store.freeBytes();
    if (l !== null && l - h < this.minFreeBytes)
      return r && r.warn("checkpoint refused — not enough free space", {
        tokens: e.length,
        predicted_mib: Math.round(h / 1048576),
        free_gib: +(l / 1073741824).toFixed(2),
        floor_gib: +(this.minFreeBytes / 1073741824).toFixed(2)
      }), this.stats_.refused++, n("insufficient-free-space");
    const d = await this.store.createWriter(a);
    let c = 0;
    const g = [];
    let y = Promise.resolve(), w;
    try {
      w = await t.snapshot({
        tokens: e,
        onChunk: (f, _, S) => {
          const D = J(f, _), $ = S instanceof Uint8Array ? S : new Uint8Array(S);
          c += $.byteLength, g.push({
            index: f,
            key: _,
            file: D,
            bytes: $.byteLength
          }), y = y.then(() => d.write(D, $));
        }
      }), await y;
    } catch (f) {
      return await y.catch(() => {
      }), await d.abort().catch(() => {
      }), r && r.warn("checkpoint snapshot failed", {
        err: f.message,
        tokens: e.length
      }), n(`snapshot-failed: ${f.message}`);
    }
    const u = w?.manifest, m = u?.entries?.length ?? g.length, T = async (f) => (await d.abort().catch(() => {
    }), r && r.warn("checkpoint refused", {
      reason: f,
      tokens: e.length
    }), this.stats_.refused++, n(f));
    if (g.length !== m) return T(`streamed ${g.length} entries, manifest declares ${m}`);
    const E = Array.isArray(u?.tokens) ? u.tokens : [];
    if (E.length !== e.length) return T(`engine returned a ${E.length}-token ledger for a ${e.length}-token checkpoint`);
    for (let f = 0; f < e.length; f++) if (E[f] !== e[f]) return T(`engine ledger diverges from ours at token ${f}`);
    const v = u?.fingerprint !== void 0 ? await this._digest(x(u.fingerprint)) : null;
    v && !this.fingerprintDigest && (this.fingerprintDigest = v);
    const b = this.now();
    g.sort((f, _) => f.index - _.index);
    try {
      await d.write("ledger.bin", j(e)), await d.write("use.json", new TextEncoder().encode(JSON.stringify({
        lastUsedAt: b,
        hits: 0
      }))), await d.write("meta.json", new TextEncoder().encode(JSON.stringify({
        format: F,
        version: 1,
        key: a,
        kind: s,
        createdAt: b,
        savedAt: new Date(b).toISOString(),
        tokens: e.length,
        bytes: c,
        guard: this.guard,
        guardDigest: this.guardDigest,
        fingerprintDigest: v,
        manifestEntries: u.entries.length,
        files: g,
        manifest: u
      }, null, 2))), await d.commit();
    } catch (f) {
      return await d.abort().catch(() => {
      }), r && r.warn("checkpoint write failed", {
        err: f.message,
        tokens: e.length
      }), this.stats_.refused++, n(`write-failed: ${f.message}`);
    }
    const A = {
      key: a,
      short: a.slice(0, 12),
      dir: this.store.label(a),
      tokens: e.slice(),
      guardDigest: this.guardDigest,
      fingerprintDigest: v,
      bytes: c,
      entries: g.length,
      createdAt: b,
      lastUsedAt: b,
      hits: 0,
      kind: s
    };
    this.entries.unshift(A), this.bytes += c, this.stats_.emitted++, await this.evictToFit(A);
    const C = Math.round(p() - o);
    return r && r.info("checkpoint.emitted", {
      key: A.short,
      kind: s,
      tokens: e.length,
      bytes: c,
      mib: +(c / 1048576).toFixed(1),
      ms: C,
      registry_gib: +(this.bytes / 1073741824).toFixed(2),
      registry_entries: this.entries.length
    }), {
      entry: A,
      reason: "ok",
      ms: C,
      bytes: c
    };
  }
  touch(t) {
    const e = this.entries.indexOf(t);
    return e > 0 && (this.entries.splice(e, 1), this.entries.unshift(t)), t.lastUsedAt = this.now(), t.hits++, this.store.writeSmall(t.key, "use.json", JSON.stringify({
      lastUsedAt: t.lastUsedAt,
      hits: t.hits
    })), t;
  }
  async evictToFit(t = null) {
    let e = 0;
    const s = () => this.entries.reduce((r, o) => r === null || o.tokens.length < r.tokens.length ? o : r, null);
    for (; ; ) {
      const r = this.entries.length > this.maxEntries, o = this.bytes > this.maxBytes && this.entries.length > 1;
      if (!r && !o) break;
      const n = s();
      let a = -1;
      for (let h = this.entries.length - 1; h >= 0; h--) {
        const l = this.entries[h];
        if (l !== t && !(l === n && this.entries.length > 1)) {
          a = h;
          break;
        }
      }
      if (a === -1) {
        for (let h = this.entries.length - 1; h >= 0; h--) if (this.entries[h] !== t) {
          a = h;
          break;
        }
      }
      if (a === -1) break;
      const [i] = this.entries.splice(a, 1);
      this.bytes -= i.bytes, this.stats_.evicted++, e++, await this.store.remove(i.key).catch(() => {
      });
    }
    return e;
  }
  _quarantine(t, e) {
    const s = this.entries.indexOf(t);
    s !== -1 && (this.entries.splice(s, 1), this.bytes -= t.bytes), this.damaged.push({
      name: t.key,
      reason: e
    }), this.stats_.refused++;
  }
  async remove(t) {
    const e = this.entries.findIndex((r) => r.key === t || r.short === t);
    if (e === -1) return !1;
    const [s] = this.entries.splice(e, 1);
    return this.bytes -= s.bytes, await this.store.remove(s.key).catch(() => {
    }), !0;
  }
  async clear() {
    const t = this.entries.map((e) => e.key);
    this.entries = [], this.bytes = 0;
    for (const e of t) await this.store.remove(e).catch(() => {
    });
  }
  list() {
    return this.entries.map((t) => ({
      key: t.short,
      kind: t.kind,
      tokens: t.tokens.length,
      bytes: t.bytes,
      mib: +(t.bytes / 1048576).toFixed(1),
      entries: t.entries,
      hits: t.hits,
      age_s: Math.round((this.now() - t.createdAt) / 1e3),
      idle_s: Math.round((this.now() - t.lastUsedAt) / 1e3)
    }));
  }
  stats() {
    return {
      checkpoints: this.entries.length,
      max_checkpoints: this.maxEntries,
      bytes: this.bytes,
      gib: +(this.bytes / 1073741824).toFixed(2),
      max_gib: +(this.maxBytes / 1073741824).toFixed(2),
      min_step_tokens: this.minStepTokens,
      max_per_request: this.maxPerRequest,
      damaged: this.damaged.length,
      ...this.stats_
    };
  }
}, z = 8 * 1024 * 1024 * 1024, re = 2 * 1024 * 1024 * 1024, ne = 4 * 1024 * 1024 * 1024, M = new TextEncoder(), Y = new TextDecoder();
async function Q(t) {
  const e = typeof t == "string" ? M.encode(t) : t instanceof Uint8Array ? t : new Uint8Array(t), s = e.byteOffset === 0 && e.byteLength === e.buffer.byteLength ? e.buffer : e.buffer.slice(e.byteOffset, e.byteOffset + e.byteLength), r = await crypto.subtle.digest("SHA-256", s), o = new Uint8Array(r);
  let n = "";
  for (let a = 0; a < o.length; a++) n += o[a].toString(16).padStart(2, "0");
  return n;
}
function X(t) {
  const e = /* @__PURE__ */ new Error(`no such checkpoint ${t}`);
  return e.notADirectory = !0, e.code = "ENOENT", e;
}
var O = class B {
  constructor({ dirName: e = "mentria-prefix", root: s = null, preferSync: r = !1, writableCap: o = z } = {}) {
    this.dirName = e, this.rootHandle = s, this.preferSync = r === !0 && typeof FileSystemFileHandle < "u" && typeof FileSystemFileHandle.prototype.createSyncAccessHandle == "function", this.writableCap = o, this.publishMode = "meta-last";
  }
  digest(e) {
    return Q(e);
  }
  label(e) {
    return `opfs:/${this.dirName}/${e}`;
  }
  static available() {
    return typeof navigator < "u" && !!navigator.storage && typeof navigator.storage.getDirectory == "function";
  }
  async open() {
    if (!this.rootHandle) {
      if (!B.available()) throw new Error("OPFS is not available in this context — no navigator.storage.getDirectory");
      const e = await navigator.storage.getDirectory();
      this.rootHandle = await e.getDirectoryHandle(this.dirName, { create: !0 });
    }
  }
  async _dir(e, s = !1) {
    if (!this.rootHandle) throw new Error("OpfsCheckpointStore: open() first");
    try {
      return await this.rootHandle.getDirectoryHandle(e, { create: s });
    } catch (r) {
      throw s ? r : X(e);
    }
  }
  async listKeys() {
    if (!this.rootHandle) return [];
    const e = [];
    for await (const [s, r] of this.rootHandle.entries())
      s.startsWith(".") || r.kind === "directory" && e.push(s);
    return e;
  }
  async _file(e, s) {
    const r = await this._dir(e);
    let o;
    try {
      o = await r.getFileHandle(s);
    } catch {
      const a = /* @__PURE__ */ new Error(`no such file ${s} in ${e}`);
      throw a.code = "ENOENT", a;
    }
    return o.getFile();
  }
  async readJson(e, s) {
    const r = await this._file(e, s);
    return JSON.parse(Y.decode(await r.arrayBuffer()));
  }
  async readBytes(e, s) {
    const r = await this._file(e, s);
    return new Uint8Array(await r.arrayBuffer());
  }
  async sizeOf(e, s) {
    return (await this._file(e, s)).size;
  }
  writeSmall(e, s, r) {
    (async () => {
      const o = await (await (await this._dir(e)).getFileHandle(s, { create: !0 })).createWritable();
      await o.write(M.encode(r)), await o.close();
    })().catch(() => {
    });
  }
  async createWriter(e) {
    const s = await this._dir(e, !0), r = this.preferSync, o = this;
    let n = !1;
    return {
      async write(a, i) {
        const h = i instanceof Uint8Array ? i : new Uint8Array(i), l = await s.getFileHandle(a, { create: !0 });
        if (r) {
          const c = await l.createSyncAccessHandle();
          try {
            c.truncate(0), c.write(h, { at: 0 }), c.flush();
          } finally {
            c.close();
          }
          return;
        }
        const d = await l.createWritable();
        try {
          await d.write(h), await d.close();
        } catch (c) {
          throw await d.abort().catch(() => {
          }), c;
        }
      },
      async commit() {
        n = !0;
      },
      async abort() {
        n || await o.remove(e).catch(() => {
        });
      }
    };
  }
  async remove(e) {
    if (this.rootHandle)
      try {
        await this.rootHandle.removeEntry(e, { recursive: !0 });
      } catch {
      }
  }
  async freeBytes() {
    try {
      if (typeof navigator > "u" || !navigator.storage?.estimate) return null;
      const e = await navigator.storage.estimate();
      return Number.isFinite(e.quota) ? Math.max(0, Math.min(this.writableCap, e.quota - (e.usage || 0))) : null;
    } catch {
      return null;
    }
  }
};
async function Z() {
  const t = {
    ok: !1,
    reason: "",
    quota: null,
    usage: null,
    persisted: null
  };
  if (!O.available())
    return t.reason = "no-opfs", t;
  try {
    t.persisted = await navigator.storage.persisted();
  } catch {
    t.persisted = null;
  }
  try {
    const e = await navigator.storage.estimate();
    t.quota = Number.isFinite(e.quota) ? e.quota : null, t.usage = Number.isFinite(e.usage) ? e.usage : null;
  } catch {
  }
  return t.quota !== null && t.quota < 4294967296 ? (t.reason = "quota-too-small", t) : (t.ok = !0, t.reason = "ok", t);
}
var k = () => typeof performance < "u" && performance.now ? performance.now() : Date.now();
function V({ modelId: t, maxSeq: e, kvMode: s, engineCommit: r = null, vendor: o = null, extra: n = null } = {}) {
  if (!t) throw new Error("browserGuard: modelId is required — an unsalted key would let a checkpoint from another model be considered for restore");
  return {
    format: "mentria-checkpoint",
    version: 1,
    host: "browser",
    modelId: String(t),
    maxSeq: Number(e) || null,
    kvMode: String(s || "unknown"),
    engineCommit: r ? String(r) : null,
    vendor: o ? String(o) : null,
    extra: n ?? null
  };
}
var ee = class {
  constructor(t, { onProgress: e = null } = {}) {
    if (!t || typeof t.prefillOnly != "function") throw new Error("BrowserEngineHost: needs an engine with prefillOnly() — that verb landed in s1922; an older dist will not do");
    this.engine = t, this.kind = "browser", this.onProgress = e;
  }
  async prefill(t, e = {}) {
    const s = await this.engine.prefillOnly({
      tokenIds: Array.isArray(t) ? t : Array.from(t),
      sessionReuse: e.sessionReuse !== !1,
      onProgress: e.onProgress || this.onProgress || void 0
    });
    return {
      seqLen: s.seqLen,
      prefilled: s.prefilledTokens ?? s.prefilled ?? 0,
      reused: s.reused ?? 0,
      ms: s.ms ?? 0,
      ledger: s.ledger || null
    };
  }
  async snapshot({ tokens: t = null, onChunk: e = null, checksum: s = !0 } = {}) {
    const r = await this.engine.snapshotSession({
      tokens: t || null,
      checksum: s,
      onChunk: e ? (o) => e(o.index, o.key, o.bytes) : null
    });
    return {
      manifest: r.manifest,
      buffers: r.buffers,
      bytes: r.bytes,
      ms: r.ms
    };
  }
  async restore({ manifest: t, entries: e, verify: s = !0 }) {
    if (Array.isArray(e)) {
      const a = e.length === 0 || !(e[0] && e[0].bytes !== void 0 && typeof e[0].index == "number") ? e : (() => {
        const i = [];
        for (const h of e) i[h.index] = h.bytes;
        return i;
      })();
      return this.engine.restoreSession(t, a, { verify: s });
    }
    const r = e[Symbol.asyncIterator] ? e[Symbol.asyncIterator]() : e[Symbol.iterator](), o = /* @__PURE__ */ new Map(), n = async (a) => {
      if (o.has(a)) {
        const i = o.get(a);
        return o.delete(a), i;
      }
      for (; ; ) {
        const { value: i, done: h } = await r.next();
        if (h) throw new Error(`restore: the store ran out of entries at index ${a}`);
        if (i.index === a) return i.bytes;
        o.set(i.index, i.bytes);
      }
    };
    return this.engine.restoreSession(t, n, { verify: s });
  }
  async reset() {
    return this.engine.reset();
  }
}, te = class {
  constructor({ engine: t, host: e, registry: s, policy: r = {} }) {
    this.engine = t, this.host = e, this.registry = s, this.chunkTokens = r.chunkTokens || 512, this.minCheckpointTokens = r.minCheckpointTokens ?? 2048, this.minStepTokens = s.minStepTokens, this.autoCheckpoint = r.autoCheckpoint !== !1, this.onProgress = r.onProgress || null, this.resident = null, this.lastError = null;
  }
  get bytes() {
    return this.registry.bytes;
  }
  get maxBytes() {
    return this.registry.maxBytes;
  }
  get guardDigest() {
    return this.registry.guardDigest;
  }
  list() {
    return this.registry.list().map((t) => ({
      ...t,
      chunkAligned: t.tokens % this.chunkTokens === 0
    }));
  }
  stats() {
    return {
      ...this.registry.stats(),
      resident_tokens: this.resident ? this.resident.length : 0,
      min_checkpoint_tokens: this.minCheckpointTokens
    };
  }
  evict(t) {
    return this.registry.remove(t);
  }
  clear() {
    return this.registry.clear();
  }
  noteLedger(t) {
    return this.resident = Array.isArray(t) && t.length ? t.slice() : null, this.resident;
  }
  invalidate() {
    this.resident = null;
  }
  _residentPrefixLen(t) {
    const e = this.resident;
    if (!e || !e.length || e.length > t.length) return 0;
    for (let s = 0; s < e.length; s++) if (e[s] !== t[s]) return 0;
    return e.length;
  }
  async _ids(t) {
    if (Array.isArray(t)) return t;
    if (t && Array.isArray(t.tokenIds)) return t.tokenIds;
    if (t && Array.isArray(t.messages)) return (await this.engine.encodeChat(t.messages, {
      enableThinking: t.enableThinking !== !1,
      assistantPrefix: t.assistantPrefix
    })).ids;
    if (t && typeof t.prompt == "string") return (await this.engine.encode(t.prompt)).ids;
    throw new Error("ensurePrefix: pass token ids, {messages}, {prompt} or {tokenIds}");
  }
  async ensurePrefix(t, e = {}) {
    const s = k(), r = await this._ids(t), o = this.chunkTokens, n = {
      key: null,
      tokens: 0,
      source: "none",
      ms: 0,
      restoredTokens: 0,
      prefilledTokens: 0,
      residentTokens: 0,
      chunkAligned: !0,
      reason: "",
      ids: r
    }, a = K(Math.max(0, r.length - 1), o);
    if (a <= 0)
      return n.reason = "prompt-shorter-than-one-chunk", n.ms = Math.round(k() - s), n;
    let i = this._residentPrefixLen(r);
    if (n.residentTokens = i, i >= a)
      return n.source = "resident", n.tokens = i, n.reason = "resident", n.ms = Math.round(k() - s), n;
    const h = this.registry.select(r, { minTokens: i + 1 });
    if (n.reason = h.reason, n.candidates = h.candidates, h.reason === "prefix-diverged" && (n.divergedAt = h.bestCommon), h.entry) try {
      const l = await this.registry.restore(this.host, h.entry, r);
      this.resident = h.entry.tokens.slice(), i = l.tokens, n.restoredTokens = l.tokens, n.key = h.entry.key, n.source = "restored", n.restoreMs = l.ms, l.tokens % o !== 0 && (n.chunkAligned = !1);
    } catch (l) {
      this.lastError = l, n.restoreError = l.message, l.engineTouched && (this.resident = null, i = 0), n.reason = l.missing ? "checkpoint-evicted" : "restore-refused";
    }
    if (i < a) try {
      const l = await this.host.prefill(r.slice(0, a), {
        sessionReuse: !0,
        onProgress: e.onProgress || this.onProgress || void 0
      });
      this.resident = r.slice(0, a), i = a, n.prefilledTokens = l.prefilled, n.prefillMs = l.ms, n.source !== "restored" && (n.source = "prefilled"), l.ledger && l.ledger.chunkAligned === !1 && (n.chunkAligned = !1);
    } catch (l) {
      throw this.resident = null, this.lastError = l, l;
    }
    if (n.tokens = i, n.reason || (n.reason = n.source), e.checkpoint !== !1 && this.autoCheckpoint) {
      const l = await this.checkpoint("prefill");
      n.checkpoint = l.reason, l.key && (n.key = l.key);
    }
    return n.ms = Math.round(k() - s), n;
  }
  async checkpoint(t = "turn", e = {}) {
    const s = this.resident, r = (n) => ({
      ok: !1,
      key: null,
      reason: n,
      tokens: s ? s.length : 0,
      bytes: 0,
      ms: 0,
      chunkAligned: !1
    });
    if (!Array.isArray(s) || !s.length) return r("no-resident-session");
    if (!e.force) {
      if (s.length < this.minCheckpointTokens) return r("below-min-tokens");
      if (s.length - this.registry.deepestPrefixLen(s) < this.minStepTokens) return r("below-min-step");
    }
    const o = await this.registry.emit(this.host, {
      ledger: s,
      kind: t
    });
    return {
      ok: !!o.entry,
      key: o.entry ? o.entry.key : null,
      reason: o.reason,
      tokens: s.length,
      bytes: o.bytes,
      ms: o.ms,
      chunkAligned: s.length % this.chunkTokens === 0
    };
  }
  async withCheckpoint(t, e = {}) {
    const s = e.persist !== !1, r = e.label || "guard", o = Array.isArray(this.resident) && this.resident.length ? this.resident.slice() : null;
    if (this.lastGuard = {
      saveMs: 0,
      restoreMs: 0,
      bytes: 0,
      mode: "none",
      reason: ""
    }, !o) {
      this.lastGuard.reason = "no-resident-session";
      const c = await t();
      return this.resident = null, c;
    }
    const n = k();
    let a = null, i = null;
    if (s) {
      const c = await this.registry.emit(this.host, {
        ledger: o,
        kind: r
      });
      c.entry ? (a = c.entry, this.lastGuard.mode = "store", this.lastGuard.bytes = c.bytes) : this.lastGuard.reason = `store-refused:${c.reason}`;
    }
    if (!a) {
      const c = [], g = await this.host.snapshot({
        tokens: o,
        checksum: e.verify !== !1,
        onChunk: (y, w, u) => {
          c[y] = u;
        }
      });
      i = {
        manifest: g.manifest,
        entries: c.map((y, w) => ({
          index: w,
          bytes: y
        }))
      }, this.lastGuard.mode = "memory", this.lastGuard.bytes = g.bytes;
    }
    this.lastGuard.saveMs = Math.round(k() - n);
    let h, l = null;
    try {
      h = await t();
    } catch (c) {
      l = c;
    }
    this.resident = null;
    const d = k();
    try {
      a ? await this.registry.restore(this.host, a, o, { exact: !0 }) : await this.host.restore({
        manifest: i.manifest,
        entries: i.entries,
        verify: e.verify !== !1
      }), this.resident = o;
    } catch (c) {
      this.lastGuard.reason = `restore-failed:${c.message}`, this.lastError = c;
    }
    if (this.lastGuard.restoreMs = Math.round(k() - d), l) throw l;
    return h;
  }
};
async function ie(t, e = {}) {
  const s = e.store || new O({
    dirName: e.dirName || "mentria-prefix",
    preferSync: e.preferSync === !0
  });
  if (!e.store && !(await Z()).ok)
    return null;
  const r = new W({
    store: s,
    guard: e.guard || V({
      modelId: e.modelId,
      maxSeq: e.maxSeq,
      kvMode: e.kvMode,
      engineCommit: e.engineCommit,
      vendor: e.vendor,
      extra: e.extra
    }),
    maxBytes: e.maxBytes ?? 2147483648,
    maxEntries: e.maxEntries ?? 3,
    minStepTokens: e.minStepTokens ?? 2048,
    chunkTokens: e.chunkTokens ?? 512,
    maxPerRequest: e.maxPerRequest ?? 2,
    minFreeBytes: e.minFreeBytes ?? 0,
    verifyRestore: e.verifyRestore !== !1,
    estimateBytes: e.estimateBytes || R
  });
  return await r.open(), new te({
    engine: t,
    host: e.host || new ee(t, { onProgress: e.onProgress || null }),
    registry: r,
    policy: {
      chunkTokens: e.chunkTokens ?? 512,
      minCheckpointTokens: e.minCheckpointTokens ?? 2048,
      autoCheckpoint: e.autoCheckpoint !== !1,
      onProgress: e.onProgress || null
    }
  });
}
export {
  ie as createPrefixCache
};

//# sourceMappingURL=prefix_registry_browser-BWn93Dmy.mjs.map