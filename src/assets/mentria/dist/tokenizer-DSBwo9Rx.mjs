function M() {
  const r = [];
  for (let n = 33; n <= 126; n++) r.push(n);
  for (let n = 161; n <= 172; n++) r.push(n);
  for (let n = 174; n <= 255; n++) r.push(n);
  const e = r.slice();
  let o = 0;
  for (let n = 0; n < 256; n++) r.includes(n) || (r.push(n), e.push(256 + o), o += 1);
  const t = new Array(256), i = /* @__PURE__ */ new Map();
  for (let n = 0; n < r.length; n++) {
    const a = String.fromCodePoint(e[n]);
    t[r[n]] = a, i.set(a, r[n]);
  }
  return {
    byteToUnicode: t,
    unicodeToByte: i
  };
}
var { unicodeToByte: S } = M();
function A(r) {
  if (typeof r != "string" || r.length === 0) return new Uint8Array(0);
  const e = new Uint8Array(r.length);
  let o = 0;
  for (const t of r) {
    const i = S.get(t);
    if (i === void 0) return null;
    e[o++] = i;
  }
  return o === e.length ? e : e.subarray(0, o);
}
var z = class {
  constructor({ idToToken: r, addedTokenLiterals: e, skipTokenIds: o = null }) {
    if (typeof r != "function") throw new TypeError("StreamingTokenDecoder: idToToken must be a function");
    if (!(e instanceof Map)) throw new TypeError("StreamingTokenDecoder: addedTokenLiterals must be a Map");
    this._idToToken = r, this._addedLiterals = e, this._skipIds = o, this._dec = new TextDecoder("utf-8", {
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
    const o = A(e);
    return o === null ? this._dec.decode() + e : this._dec.decode(o, { stream: !0 });
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
  const e = /* @__PURE__ */ new Map(), o = r && Array.isArray(r.added_tokens) ? r.added_tokens : [];
  for (const t of o) typeof t.id == "number" && typeof t.content == "string" && e.set(t.id, t.content);
  return e;
}
function $(r) {
  const e = /* @__PURE__ */ new Set(), o = r && Array.isArray(r.added_tokens) ? r.added_tokens : [];
  for (const t of o) t.special && typeof t.id == "number" && e.add(t.id);
  return e;
}
var m, _;
try {
  ({ Tokenizer: m } = await import("./tokenizers-CBIkuKbH.mjs")), { Template: _ } = await import("./dist-BqwB66Bc.mjs");
} catch {
  ({ Tokenizer: m } = await import("./tokenizers-CBIkuKbH.mjs")), { Template: _ } = await import("./dist-BqwB66Bc.mjs");
}
var T = {
  ENDOFTEXT: 151643,
  IM_START: 151644,
  IM_END: 151645,
  THINK_START: 151667,
  THINK_END: 151668
}, D = class g {
  constructor(e, o, t) {
    this.tokenizer = e, this.chatTemplate = o, this.config = t, this.eosTokenIds = /* @__PURE__ */ new Set();
    const i = t.eos_token;
    if (i) {
      const a = e.token_to_id(i);
      a !== void 0 && this.eosTokenIds.add(a);
    }
    const n = e.token_to_id("<|endoftext|>");
    n !== void 0 && this.eosTokenIds.add(n), this.specialTokens = {};
    for (const [a, s] of Object.entries(T)) this.specialTokens[a] = s;
  }
  static fromJSON(e, o) {
    const t = new m(e, o);
    let i = null;
    const n = o.chat_template;
    if (n) {
      const a = Array.isArray(n) ? n[0].template : n;
      i = new _(a);
    }
    return new g(t, i, o);
  }
  static async fromUrls(e, o) {
    const t = o.replace(/[^/]*$/, "chat_template.jinja"), [i, n, a] = await Promise.all([
      fetch(e).then((s) => {
        if (!s.ok) throw new Error(`Failed to fetch tokenizer.json: ${s.status}`);
        return s.json();
      }),
      fetch(o).then((s) => {
        if (!s.ok) throw new Error(`Failed to fetch tokenizer_config.json: ${s.status}`);
        return s.json();
      }),
      fetch(t).then((s) => s.ok ? s.text() : null, () => null)
    ]);
    return a && a.trim() && (n.chat_template = a), g.fromJSON(i, n);
  }
  encode(e, { addSpecialTokens: o = !1 } = {}) {
    return this.tokenizer.encode(e, { add_special_tokens: o }).ids;
  }
  decode(e, { skipSpecialTokens: o = !1 } = {}) {
    return e.length === 0 ? "" : this.tokenizer.decode(e, { skip_special_tokens: o });
  }
  idToToken(e) {
    return this.tokenizer.id_to_token(e);
  }
  createStreamDecoder({ skipSpecialTokens: e = !1 } = {}) {
    return new z({
      idToToken: (o) => this.tokenizer.id_to_token(o),
      addedTokenLiterals: N(this.tokenizer),
      skipTokenIds: e ? $(this.tokenizer) : null
    });
  }
  tokenToId(e) {
    return this.tokenizer.token_to_id(e);
  }
  formatChat(e, { addGenerationPrompt: o = !0, enableThinking: t = !0, assistantPrefix: i = "" } = {}) {
    if (!this.chatTemplate) throw new Error("No chat template available in tokenizer config");
    if (i !== "" && i != null) {
      if (typeof i != "string") throw new Error(`assistantPrefix must be a string, got ${typeof i}`);
      if (!o) throw new Error("assistantPrefix requires addGenerationPrompt: there is no assistant turn to continue");
    }
    let n = e;
    t === !1 && (n = e.map((s) => s && s.role === "assistant" && typeof s.content == "string" && !s.content.startsWith("<think>") ? {
      ...s,
      content: `<think>

</think>

` + s.content
    } : s));
    const a = this.chatTemplate.render({
      messages: n,
      add_generation_prompt: o,
      enable_thinking: t,
      preserve_thinking: !0,
      bos_token: this.config.bos_token || null,
      eos_token: this.config.eos_token || "<|im_end|>"
    });
    return i ? a + i : a;
  }
  encodeChat(e, o = {}) {
    const t = this.formatChat(e, o);
    return this.encode(t);
  }
  encodeChatMultimodal(e, o = {}) {
    const { imageTokenCounts: t = null, videoTokenCounts: i = null, addGenerationPrompt: n = !0, enableThinking: a = !0 } = o, s = this.tokenizer.token_to_id("<|image_pad|>"), l = this.tokenizer.token_to_id("<|video_pad|>");
    if (s === void 0) throw new Error("encodeChatMultimodal: tokenizer vocab lacks <|image_pad|> — the Qwen3.5-VL tokenizer is required (expected id 248056).");
    const E = this.formatChat(e, {
      addGenerationPrompt: n,
      enableThinking: a
    }), u = this.encode(E);
    if (!t && !i) return {
      tokenIds: u,
      imageTokenRanges: [],
      videoTokenRanges: []
    };
    const w = u.reduce((d, c) => d + (c === s ? 1 : 0), 0), y = l !== void 0 ? u.reduce((d, c) => d + (c === l ? 1 : 0), 0) : 0;
    if (t) {
      if (!Array.isArray(t)) throw new Error("encodeChatMultimodal: imageTokenCounts must be an array.");
      if (t.length !== w) throw new Error(`encodeChatMultimodal: imageTokenCounts length (${t.length}) does not match <|image_pad|> placeholders in chat template (${w}). Each image item in message content arrays emits exactly one placeholder.`);
      for (let d = 0; d < t.length; d++) {
        const c = t[d];
        if (!Number.isInteger(c) || c < 1) throw new Error(`encodeChatMultimodal: imageTokenCounts[${d}]=${c} must be a positive integer.`);
      }
    }
    if (i) {
      if (!Array.isArray(i)) throw new Error("encodeChatMultimodal: videoTokenCounts must be an array.");
      if (l === void 0) throw new Error("encodeChatMultimodal: tokenizer vocab lacks <|video_pad|>; videoTokenCounts cannot be applied.");
      if (i.length !== y) throw new Error(`encodeChatMultimodal: videoTokenCounts length (${i.length}) does not match <|video_pad|> placeholders (${y}).`);
      for (let d = 0; d < i.length; d++) {
        const c = i[d];
        if (!Number.isInteger(c) || c < 1) throw new Error(`encodeChatMultimodal: videoTokenCounts[${d}]=${c} must be a positive integer.`);
      }
    }
    const h = [], b = [], v = [];
    let I = 0, C = 0;
    for (let d = 0; d < u.length; d++) {
      const c = u[d];
      if (t && c === s) {
        const f = t[I++], p = h.length;
        for (let k = 0; k < f; k++) h.push(s);
        b.push({
          start: p,
          count: f
        });
      } else if (i && l !== void 0 && c === l) {
        const f = i[C++], p = h.length;
        for (let k = 0; k < f; k++) h.push(l);
        v.push({
          start: p,
          count: f
        });
      } else h.push(c);
    }
    return {
      tokenIds: h,
      imageTokenRanges: b,
      videoTokenRanges: v
    };
  }
  isEos(e) {
    return this.eosTokenIds.has(e);
  }
  isThinkStart(e) {
    return e === T.THINK_START;
  }
  isThinkEnd(e) {
    return e === T.THINK_END;
  }
  getEosTokenIds() {
    return new Set(this.eosTokenIds);
  }
  getSpecialTokens() {
    return { ...this.specialTokens };
  }
};
export {
  D as MentriaTokenizer
};

//# sourceMappingURL=tokenizer-DSBwo9Rx.mjs.map