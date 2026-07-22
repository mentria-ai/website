function M() {
  const r = [];
  for (let t = 33; t <= 126; t++) r.push(t);
  for (let t = 161; t <= 172; t++) r.push(t);
  for (let t = 174; t <= 255; t++) r.push(t);
  const e = r.slice();
  let o = 0;
  for (let t = 0; t < 256; t++) r.includes(t) || (r.push(t), e.push(256 + o), o += 1);
  const n = new Array(256), i = /* @__PURE__ */ new Map();
  for (let t = 0; t < r.length; t++) {
    const d = String.fromCodePoint(e[t]);
    n[r[t]] = d, i.set(d, r[t]);
  }
  return {
    byteToUnicode: n,
    unicodeToByte: i
  };
}
var { unicodeToByte: S } = M();
function A(r) {
  if (typeof r != "string" || r.length === 0) return new Uint8Array(0);
  const e = new Uint8Array(r.length);
  let o = 0;
  for (const n of r) {
    const i = S.get(n);
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
      const n = this._dec.decode();
      return this._skipIds && this._skipIds.has(r) ? n : n + this._addedLiterals.get(r);
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
  for (const n of o) typeof n.id == "number" && typeof n.content == "string" && e.set(n.id, n.content);
  return e;
}
function x(r) {
  const e = /* @__PURE__ */ new Set(), o = r && Array.isArray(r.added_tokens) ? r.added_tokens : [];
  for (const n of o) n.special && typeof n.id == "number" && e.add(n.id);
  return e;
}
var m, _;
try {
  ({ Tokenizer: m } = await import("./tokenizers-DZpe9nlx.mjs")), { Template: _ } = await import("./dist-Dbf1uG80.mjs");
} catch {
  ({ Tokenizer: m } = await import("./tokenizers-DZpe9nlx.mjs")), { Template: _ } = await import("./dist-Dbf1uG80.mjs");
}
var T = {
  ENDOFTEXT: 151643,
  IM_START: 151644,
  IM_END: 151645,
  THINK_START: 151667,
  THINK_END: 151668
}, D = class g {
  constructor(e, o, n) {
    this.tokenizer = e, this.chatTemplate = o, this.config = n, this.eosTokenIds = /* @__PURE__ */ new Set();
    const i = n.eos_token;
    if (i) {
      const d = e.token_to_id(i);
      d !== void 0 && this.eosTokenIds.add(d);
    }
    const t = e.token_to_id("<|endoftext|>");
    t !== void 0 && this.eosTokenIds.add(t), this.specialTokens = {};
    for (const [d, s] of Object.entries(T)) this.specialTokens[d] = s;
  }
  static fromJSON(e, o) {
    const n = new m(e, o);
    let i = null;
    const t = o.chat_template;
    if (t) {
      const d = Array.isArray(t) ? t[0].template : t;
      i = new _(d);
    }
    return new g(n, i, o);
  }
  static async fromUrls(e, o) {
    const n = o.replace(/[^/]*$/, "chat_template.jinja"), [i, t, d] = await Promise.all([
      fetch(e).then((s) => {
        if (!s.ok) throw new Error(`Failed to fetch tokenizer.json: ${s.status}`);
        return s.json();
      }),
      fetch(o).then((s) => {
        if (!s.ok) throw new Error(`Failed to fetch tokenizer_config.json: ${s.status}`);
        return s.json();
      }),
      fetch(n).then((s) => s.ok ? s.text() : null, () => null)
    ]);
    return d && d.trim() && (t.chat_template = d), g.fromJSON(i, t);
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
      skipTokenIds: e ? x(this.tokenizer) : null
    });
  }
  tokenToId(e) {
    return this.tokenizer.token_to_id(e);
  }
  formatChat(e, { addGenerationPrompt: o = !0, enableThinking: n = !0 } = {}) {
    if (!this.chatTemplate) throw new Error("No chat template available in tokenizer config");
    let i = e;
    return n === !1 && (i = e.map((t) => t && t.role === "assistant" && typeof t.content == "string" && !t.content.startsWith("<think>") ? {
      ...t,
      content: `<think>

</think>

` + t.content
    } : t)), this.chatTemplate.render({
      messages: i,
      add_generation_prompt: o,
      enable_thinking: n,
      preserve_thinking: !0,
      bos_token: this.config.bos_token || null,
      eos_token: this.config.eos_token || "<|im_end|>"
    });
  }
  encodeChat(e, o = {}) {
    const n = this.formatChat(e, o);
    return this.encode(n);
  }
  encodeChatMultimodal(e, o = {}) {
    const { imageTokenCounts: n = null, videoTokenCounts: i = null, addGenerationPrompt: t = !0, enableThinking: d = !0 } = o, s = this.tokenizer.token_to_id("<|image_pad|>"), l = this.tokenizer.token_to_id("<|video_pad|>");
    if (s === void 0) throw new Error("encodeChatMultimodal: tokenizer vocab lacks <|image_pad|> — the Qwen3.5-VL tokenizer is required (expected id 248056).");
    const I = this.formatChat(e, {
      addGenerationPrompt: t,
      enableThinking: d
    }), u = this.encode(I);
    if (!n && !i) return {
      tokenIds: u,
      imageTokenRanges: [],
      videoTokenRanges: []
    };
    const w = u.reduce((a, c) => a + (c === s ? 1 : 0), 0), y = l !== void 0 ? u.reduce((a, c) => a + (c === l ? 1 : 0), 0) : 0;
    if (n) {
      if (!Array.isArray(n)) throw new Error("encodeChatMultimodal: imageTokenCounts must be an array.");
      if (n.length !== w) throw new Error(`encodeChatMultimodal: imageTokenCounts length (${n.length}) does not match <|image_pad|> placeholders in chat template (${w}). Each image item in message content arrays emits exactly one placeholder.`);
      for (let a = 0; a < n.length; a++) {
        const c = n[a];
        if (!Number.isInteger(c) || c < 1) throw new Error(`encodeChatMultimodal: imageTokenCounts[${a}]=${c} must be a positive integer.`);
      }
    }
    if (i) {
      if (!Array.isArray(i)) throw new Error("encodeChatMultimodal: videoTokenCounts must be an array.");
      if (l === void 0) throw new Error("encodeChatMultimodal: tokenizer vocab lacks <|video_pad|>; videoTokenCounts cannot be applied.");
      if (i.length !== y) throw new Error(`encodeChatMultimodal: videoTokenCounts length (${i.length}) does not match <|video_pad|> placeholders (${y}).`);
      for (let a = 0; a < i.length; a++) {
        const c = i[a];
        if (!Number.isInteger(c) || c < 1) throw new Error(`encodeChatMultimodal: videoTokenCounts[${a}]=${c} must be a positive integer.`);
      }
    }
    const h = [], b = [], v = [];
    let C = 0, E = 0;
    for (let a = 0; a < u.length; a++) {
      const c = u[a];
      if (n && c === s) {
        const f = n[C++], p = h.length;
        for (let k = 0; k < f; k++) h.push(s);
        b.push({
          start: p,
          count: f
        });
      } else if (i && l !== void 0 && c === l) {
        const f = i[E++], p = h.length;
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

//# sourceMappingURL=tokenizer-DTHHk5Y3.mjs.map