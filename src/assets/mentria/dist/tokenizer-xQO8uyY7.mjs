function S() {
  const r = [];
  for (let o = 33; o <= 126; o++) r.push(o);
  for (let o = 161; o <= 172; o++) r.push(o);
  for (let o = 174; o <= 255; o++) r.push(o);
  const e = r.slice();
  let n = 0;
  for (let o = 0; o < 256; o++) r.includes(o) || (r.push(o), e.push(256 + n), n += 1);
  const t = new Array(256), i = /* @__PURE__ */ new Map();
  for (let o = 0; o < r.length; o++) {
    const s = String.fromCodePoint(e[o]);
    t[r[o]] = s, i.set(s, r[o]);
  }
  return {
    byteToUnicode: t,
    unicodeToByte: i
  };
}
var { unicodeToByte: M } = S();
function z(r) {
  if (typeof r != "string" || r.length === 0) return new Uint8Array(0);
  const e = new Uint8Array(r.length);
  let n = 0;
  for (const t of r) {
    const i = M.get(t);
    if (i === void 0) return null;
    e[n++] = i;
  }
  return n === e.length ? e : e.subarray(0, n);
}
var A = class {
  constructor({ idToToken: r, addedTokenLiterals: e, skipTokenIds: n = null }) {
    if (typeof r != "function") throw new TypeError("StreamingTokenDecoder: idToToken must be a function");
    if (!(e instanceof Map)) throw new TypeError("StreamingTokenDecoder: addedTokenLiterals must be a Map");
    this._idToToken = r, this._addedLiterals = e, this._skipIds = n, this._dec = new TextDecoder("utf-8", {
      fatal: !1,
      ignoreBOM: !0
    });
  }
  decodeStep(r) {
    if (this._addedLiterals.has(r)) {
      const t = this._dec.decode();
      return this._skipIds && this._skipIds.has(r) ? t : t + this._addedLiterals.get(r);
    }
    const e = this._idToToken(r);
    if (typeof e != "string" || e.length === 0) return "";
    const n = z(e);
    return n === null ? this._dec.decode() + e : this._dec.decode(n, { stream: !0 });
  }
  flush() {
    return this._dec.decode();
  }
  reset() {
    this._dec = new TextDecoder("utf-8", {
      fatal: !1,
      ignoreBOM: !0
    });
  }
};
function N(r) {
  const e = /* @__PURE__ */ new Map(), n = r && Array.isArray(r.added_tokens) ? r.added_tokens : [];
  for (const t of n) typeof t.id == "number" && typeof t.content == "string" && e.set(t.id, t.content);
  return e;
}
function x(r) {
  const e = /* @__PURE__ */ new Set(), n = r && Array.isArray(r.added_tokens) ? r.added_tokens : [];
  for (const t of n) t.special && typeof t.id == "number" && e.add(t.id);
  return e;
}
var v, I;
try {
  ({ Tokenizer: v } = await import("./tokenizers-ZNu5lHNV.mjs")), { Template: I } = await import("./dist-DF90UAkb.mjs");
} catch {
  ({ Tokenizer: v } = await import("./tokenizers-ZNu5lHNV.mjs")), { Template: I } = await import("./dist-DF90UAkb.mjs");
}
var b = {
  ENDOFTEXT: 151643,
  IM_START: 151644,
  IM_END: 151645,
  THINK_START: 151667,
  THINK_END: 151668
}, $ = class C {
  constructor(e, n, t) {
    this.tokenizer = e, this.chatTemplate = n, this.config = t, this.eosTokenIds = /* @__PURE__ */ new Set();
    const i = t.eos_token;
    if (i) {
      const s = e.token_to_id(i);
      s !== void 0 && this.eosTokenIds.add(s);
    }
    const o = e.token_to_id("<|endoftext|>");
    o !== void 0 && this.eosTokenIds.add(o), this.specialTokens = {};
    for (const [s, d] of Object.entries(b)) this.specialTokens[s] = d;
  }
  static fromJSON(e, n) {
    const t = new v(e, n);
    let i = null;
    const o = n.chat_template;
    if (o) {
      const s = Array.isArray(o) ? o[0].template : o;
      i = new I(s);
    }
    return new C(t, i, n);
  }
  static async fromUrls(e, n, { cache: t = null } = {}) {
    const i = n.replace(/[^/]*$/, "chat_template.jinja"), o = !!(t && typeof t.loadShard == "function" && t.isInitialized !== !1), s = async (f, l, w) => {
      if (o) try {
        return new TextDecoder().decode(await t.loadShard(f, null, w));
      } catch (m) {
        throw new Error(`Failed to load ${l} (${f}): ${m?.message || m}`, { cause: m });
      }
      const k = await fetch(f);
      if (!k.ok) throw new Error(`Failed to fetch ${l}: ${k.status}`);
      return k.text();
    }, [d, h, p] = await Promise.all([
      s(e, "tokenizer.json"),
      s(n, "tokenizer_config.json"),
      s(i, "chat_template.jinja", { maxRetries: 0 }).catch(() => null)
    ]), u = JSON.parse(d), T = JSON.parse(h);
    return p && p.trim() && (T.chat_template = p), C.fromJSON(u, T);
  }
  encode(e, { addSpecialTokens: n = !1 } = {}) {
    return this.tokenizer.encode(e, { add_special_tokens: n }).ids;
  }
  decode(e, { skipSpecialTokens: n = !1 } = {}) {
    return e.length === 0 ? "" : this.tokenizer.decode(e, { skip_special_tokens: n });
  }
  idToToken(e) {
    return this.tokenizer.id_to_token(e);
  }
  createStreamDecoder({ skipSpecialTokens: e = !1 } = {}) {
    return new A({
      idToToken: (n) => this.tokenizer.id_to_token(n),
      addedTokenLiterals: N(this.tokenizer),
      skipTokenIds: e ? x(this.tokenizer) : null
    });
  }
  tokenToId(e) {
    return this.tokenizer.token_to_id(e);
  }
  formatChat(e, { addGenerationPrompt: n = !0, enableThinking: t = !0, assistantPrefix: i = "" } = {}) {
    if (!this.chatTemplate) throw new Error("No chat template available in tokenizer config");
    if (i !== "" && i != null) {
      if (typeof i != "string") throw new Error(`assistantPrefix must be a string, got ${typeof i}`);
      if (!n) throw new Error("assistantPrefix requires addGenerationPrompt: there is no assistant turn to continue");
    }
    let o = e;
    t === !1 && (o = e.map((d) => d && d.role === "assistant" && typeof d.content == "string" && !d.content.startsWith("<think>") ? {
      ...d,
      content: `<think>

</think>

` + d.content
    } : d));
    const s = this.chatTemplate.render({
      messages: o,
      add_generation_prompt: n,
      enable_thinking: t,
      preserve_thinking: !0,
      bos_token: this.config.bos_token || null,
      eos_token: this.config.eos_token || "<|im_end|>"
    });
    return i ? s + i : s;
  }
  encodeChat(e, n = {}) {
    const t = this.formatChat(e, n);
    return this.encode(t);
  }
  encodeChatMultimodal(e, n = {}) {
    const { imageTokenCounts: t = null, videoTokenCounts: i = null, addGenerationPrompt: o = !0, enableThinking: s = !0 } = n, d = this.tokenizer.token_to_id("<|image_pad|>"), h = this.tokenizer.token_to_id("<|video_pad|>");
    if (d === void 0) throw new Error("encodeChatMultimodal: tokenizer vocab lacks <|image_pad|> — the Qwen3.5-VL tokenizer is required (expected id 248056).");
    const p = this.formatChat(e, {
      addGenerationPrompt: o,
      enableThinking: s
    }), u = this.encode(p);
    if (!t && !i) return {
      tokenIds: u,
      imageTokenRanges: [],
      videoTokenRanges: []
    };
    const T = u.reduce((a, c) => a + (c === d ? 1 : 0), 0), f = h !== void 0 ? u.reduce((a, c) => a + (c === h ? 1 : 0), 0) : 0;
    if (t) {
      if (!Array.isArray(t)) throw new Error("encodeChatMultimodal: imageTokenCounts must be an array.");
      if (t.length !== T) throw new Error(`encodeChatMultimodal: imageTokenCounts length (${t.length}) does not match <|image_pad|> placeholders in chat template (${T}). Each image item in message content arrays emits exactly one placeholder.`);
      for (let a = 0; a < t.length; a++) {
        const c = t[a];
        if (!Number.isInteger(c) || c < 1) throw new Error(`encodeChatMultimodal: imageTokenCounts[${a}]=${c} must be a positive integer.`);
      }
    }
    if (i) {
      if (!Array.isArray(i)) throw new Error("encodeChatMultimodal: videoTokenCounts must be an array.");
      if (h === void 0) throw new Error("encodeChatMultimodal: tokenizer vocab lacks <|video_pad|>; videoTokenCounts cannot be applied.");
      if (i.length !== f) throw new Error(`encodeChatMultimodal: videoTokenCounts length (${i.length}) does not match <|video_pad|> placeholders (${f}).`);
      for (let a = 0; a < i.length; a++) {
        const c = i[a];
        if (!Number.isInteger(c) || c < 1) throw new Error(`encodeChatMultimodal: videoTokenCounts[${a}]=${c} must be a positive integer.`);
      }
    }
    const l = [], w = [], k = [];
    let m = 0, E = 0;
    for (let a = 0; a < u.length; a++) {
      const c = u[a];
      if (t && c === d) {
        const g = t[m++], y = l.length;
        for (let _ = 0; _ < g; _++) l.push(d);
        w.push({
          start: y,
          count: g
        });
      } else if (i && h !== void 0 && c === h) {
        const g = i[E++], y = l.length;
        for (let _ = 0; _ < g; _++) l.push(h);
        k.push({
          start: y,
          count: g
        });
      } else l.push(c);
    }
    return {
      tokenIds: l,
      imageTokenRanges: w,
      videoTokenRanges: k
    };
  }
  isEos(e) {
    return this.eosTokenIds.has(e);
  }
  isThinkStart(e) {
    return e === b.THINK_START;
  }
  isThinkEnd(e) {
    return e === b.THINK_END;
  }
  getEosTokenIds() {
    return new Set(this.eosTokenIds);
  }
  getSpecialTokens() {
    return { ...this.specialTokens };
  }
};
export {
  $ as MentriaTokenizer
};

//# sourceMappingURL=tokenizer-xQO8uyY7.mjs.map