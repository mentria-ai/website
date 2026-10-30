function S() {
  const r = [];
  for (let o = 33; o <= 126; o++) r.push(o);
  for (let o = 161; o <= 172; o++) r.push(o);
  for (let o = 174; o <= 255; o++) r.push(o);
  const e = r.slice();
  let t = 0;
  for (let o = 0; o < 256; o++) r.includes(o) || (r.push(o), e.push(256 + t), t += 1);
  const n = new Array(256), i = /* @__PURE__ */ new Map();
  for (let o = 0; o < r.length; o++) {
    const s = String.fromCodePoint(e[o]);
    n[r[o]] = s, i.set(s, r[o]);
  }
  return {
    byteToUnicode: n,
    unicodeToByte: i
  };
}
var { unicodeToByte: M } = S();
function A(r) {
  if (typeof r != "string" || r.length === 0) return new Uint8Array(0);
  const e = new Uint8Array(r.length);
  let t = 0;
  for (const n of r) {
    const i = M.get(n);
    if (i === void 0) return null;
    e[t++] = i;
  }
  return t === e.length ? e : e.subarray(0, t);
}
var x = class {
  constructor({ idToToken: r, addedTokenLiterals: e, skipTokenIds: t = null }) {
    if (typeof r != "function") throw new TypeError("StreamingTokenDecoder: idToToken must be a function");
    if (!(e instanceof Map)) throw new TypeError("StreamingTokenDecoder: addedTokenLiterals must be a Map");
    this._idToToken = r, this._addedLiterals = e, this._skipIds = t, this._dec = new TextDecoder("utf-8", {
      fatal: !1,
      ignoreBOM: !0
    });
  }
  decodeStep(r) {
    if (this._addedLiterals.has(r)) {
      const n = this._dec.decode();
      return this._skipIds && this._skipIds.has(r) ? n : n + this._addedLiterals.get(r);
    }
    const e = this._idToToken(r);
    if (typeof e != "string" || e.length === 0) return "";
    const t = A(e);
    return t === null ? this._dec.decode() + e : this._dec.decode(t, { stream: !0 });
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
function z(r) {
  const e = /* @__PURE__ */ new Map(), t = r && Array.isArray(r.added_tokens) ? r.added_tokens : [];
  for (const n of t) typeof n.id == "number" && typeof n.content == "string" && e.set(n.id, n.content);
  return e;
}
function N(r) {
  const e = /* @__PURE__ */ new Set(), t = r && Array.isArray(r.added_tokens) ? r.added_tokens : [];
  for (const n of t) n.special && typeof n.id == "number" && e.add(n.id);
  return e;
}
var v, C;
try {
  ({ Tokenizer: v } = await import("./tokenizers-ZNu5lHNV.mjs")), { Template: C } = await import("./dist-DF90UAkb.mjs");
} catch {
  ({ Tokenizer: v } = await import("./tokenizers-ZNu5lHNV.mjs")), { Template: C } = await import("./dist-DF90UAkb.mjs");
}
var $ = `<think>

</think>

`;
function D(r) {
  if (typeof r == "string") return r;
  if (Array.isArray(r)) {
    let e = "";
    for (const t of r)
      !t || typeof t != "object" || ("image" in t || "image_url" in t || t.type === "image" ? e += "<|vision_start|><|image_pad|><|vision_end|>" : "video" in t || t.type === "video" ? e += "<|vision_start|><|video_pad|><|vision_end|>" : "text" in t && (e += String(t.text)));
    return e;
  }
  return "";
}
function O(r) {
  for (let e = r.length - 1; e >= 0; e--) {
    const t = r[e];
    if (!t || t.role !== "user") continue;
    const n = D(t.content).trim();
    if (!(n.startsWith("<tool_response>") && n.endsWith("</tool_response>"))) return e;
  }
  return -1;
}
function B(r) {
  const e = O(r);
  return e < 0 ? r : r.map((t, n) => n < e && t && t.role === "assistant" && typeof t.content == "string" && typeof t.reasoning_content != "string" && t.content.includes("</think>") ? {
    ...t,
    reasoning_content: ""
  } : t);
}
var b = {
  ENDOFTEXT: 151643,
  IM_START: 151644,
  IM_END: 151645,
  THINK_START: 151667,
  THINK_END: 151668
}, R = class I {
  constructor(e, t, n) {
    this.tokenizer = e, this.chatTemplate = t, this.config = n, this.eosTokenIds = /* @__PURE__ */ new Set();
    const i = n.eos_token;
    if (i) {
      const s = e.token_to_id(i);
      s !== void 0 && this.eosTokenIds.add(s);
    }
    const o = e.token_to_id("<|endoftext|>");
    o !== void 0 && this.eosTokenIds.add(o), this.specialTokens = {};
    for (const [s, d] of Object.entries(b)) this.specialTokens[s] = d;
  }
  static fromJSON(e, t) {
    const n = new v(e, t);
    let i = null;
    const o = t.chat_template;
    if (o) {
      const s = Array.isArray(o) ? o[0].template : o;
      i = new C(s);
    }
    return new I(n, i, t);
  }
  static async fromUrls(e, t, { cache: n = null } = {}) {
    const i = t.replace(/[^/]*$/, "chat_template.jinja"), o = !!(n && typeof n.loadShard == "function" && n.isInitialized !== !1), s = async (f, l, y) => {
      if (o) try {
        return new TextDecoder().decode(await n.loadShard(f, null, y));
      } catch (T) {
        throw new Error(`Failed to load ${l} (${f}): ${T?.message || T}`, { cause: T });
      }
      const p = await fetch(f);
      if (!p.ok) throw new Error(`Failed to fetch ${l}: ${p.status}`);
      return p.text();
    }, [d, h, k] = await Promise.all([
      s(e, "tokenizer.json"),
      s(t, "tokenizer_config.json"),
      s(i, "chat_template.jinja", { maxRetries: 0 }).catch(() => null)
    ]), u = JSON.parse(d), _ = JSON.parse(h);
    return k && k.trim() && (_.chat_template = k), I.fromJSON(u, _);
  }
  encode(e, { addSpecialTokens: t = !1 } = {}) {
    return this.tokenizer.encode(e, { add_special_tokens: t }).ids;
  }
  decode(e, { skipSpecialTokens: t = !1 } = {}) {
    return e.length === 0 ? "" : this.tokenizer.decode(e, { skip_special_tokens: t });
  }
  idToToken(e) {
    return this.tokenizer.id_to_token(e);
  }
  createStreamDecoder({ skipSpecialTokens: e = !1 } = {}) {
    return new x({
      idToToken: (t) => this.tokenizer.id_to_token(t),
      addedTokenLiterals: z(this.tokenizer),
      skipTokenIds: e ? N(this.tokenizer) : null
    });
  }
  tokenToId(e) {
    return this.tokenizer.token_to_id(e);
  }
  formatChat(e, { addGenerationPrompt: t = !0, enableThinking: n = !0, assistantPrefix: i = "" } = {}) {
    if (!this.chatTemplate) throw new Error("No chat template available in tokenizer config");
    if (i !== "" && i != null) {
      if (typeof i != "string") throw new Error(`assistantPrefix must be a string, got ${typeof i}`);
      if (!t) throw new Error("assistantPrefix requires addGenerationPrompt: there is no assistant turn to continue");
    }
    let o = e;
    n === !1 && (o = e.map((d) => d && d.role === "assistant" && typeof d.content == "string" && !d.content.startsWith("<think>") ? {
      ...d,
      content: `<think>

</think>

` + d.content
    } : d), this._historyThinkMode() === "reasoning-content" && (o = B(o)));
    const s = this.chatTemplate.render({
      messages: o,
      add_generation_prompt: t,
      enable_thinking: n,
      preserve_thinking: !0,
      bos_token: this.config.bos_token || null,
      eos_token: this.config.eos_token || "<|im_end|>"
    });
    return i ? s + i : s;
  }
  _historyThinkMode() {
    if (this._historyThinkModeCached) return this._historyThinkModeCached;
    let e = "none";
    try {
      const t = $ + "mentria-probe-reply", n = (o) => this.chatTemplate.render({
        messages: [
          {
            role: "user",
            content: "mentria-probe-query-1"
          },
          o,
          {
            role: "user",
            content: "mentria-probe-query-2"
          }
        ],
        add_generation_prompt: !1,
        enable_thinking: !1,
        preserve_thinking: !0,
        bos_token: this.config.bos_token || null,
        eos_token: this.config.eos_token || "<|im_end|>"
      }), i = (o, s) => o.split(s).length - 1;
      if (n({
        role: "assistant",
        content: t
      }).includes(t)) e = "native";
      else {
        const o = n({
          role: "assistant",
          content: t,
          reasoning_content: ""
        });
        i(o, t) === 1 && i(o, "<think>") === 1 && (e = "reasoning-content");
      }
    } catch {
      e = "none";
    }
    return this._historyThinkModeCached = e, e;
  }
  encodeChat(e, t = {}) {
    const n = this.formatChat(e, t);
    return this.encode(n);
  }
  encodeChatMultimodal(e, t = {}) {
    const { imageTokenCounts: n = null, videoTokenCounts: i = null, addGenerationPrompt: o = !0, enableThinking: s = !0 } = t, d = this.tokenizer.token_to_id("<|image_pad|>"), h = this.tokenizer.token_to_id("<|video_pad|>");
    if (d === void 0) throw new Error("encodeChatMultimodal: tokenizer vocab lacks <|image_pad|> — the Qwen3.5-VL tokenizer is required (expected id 248056).");
    const k = this.formatChat(e, {
      addGenerationPrompt: o,
      enableThinking: s
    }), u = this.encode(k);
    if (!n && !i) return {
      tokenIds: u,
      imageTokenRanges: [],
      videoTokenRanges: []
    };
    const _ = u.reduce((a, c) => a + (c === d ? 1 : 0), 0), f = h !== void 0 ? u.reduce((a, c) => a + (c === h ? 1 : 0), 0) : 0;
    if (n) {
      if (!Array.isArray(n)) throw new Error("encodeChatMultimodal: imageTokenCounts must be an array.");
      if (n.length !== _) throw new Error(`encodeChatMultimodal: imageTokenCounts length (${n.length}) does not match <|image_pad|> placeholders in chat template (${_}). Each image item in message content arrays emits exactly one placeholder.`);
      for (let a = 0; a < n.length; a++) {
        const c = n[a];
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
    const l = [], y = [], p = [];
    let T = 0, E = 0;
    for (let a = 0; a < u.length; a++) {
      const c = u[a];
      if (n && c === d) {
        const g = n[T++], w = l.length;
        for (let m = 0; m < g; m++) l.push(d);
        y.push({
          start: w,
          count: g
        });
      } else if (i && h !== void 0 && c === h) {
        const g = i[E++], w = l.length;
        for (let m = 0; m < g; m++) l.push(h);
        p.push({
          start: w,
          count: g
        });
      } else l.push(c);
    }
    return {
      tokenIds: l,
      imageTokenRanges: y,
      videoTokenRanges: p
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
  R as MentriaTokenizer
};

//# sourceMappingURL=tokenizer-DeQ1TtYw.mjs.map