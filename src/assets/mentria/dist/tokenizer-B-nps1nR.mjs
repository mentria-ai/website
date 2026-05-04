function S() {
  const r = [];
  for (let t = 33; t <= 126; t++) r.push(t);
  for (let t = 161; t <= 172; t++) r.push(t);
  for (let t = 174; t <= 255; t++) r.push(t);
  const e = r.slice();
  let n = 0;
  for (let t = 0; t < 256; t++) r.includes(t) || (r.push(t), e.push(256 + n), n += 1);
  const o = new Array(256), i = /* @__PURE__ */ new Map();
  for (let t = 0; t < r.length; t++) {
    const d = String.fromCodePoint(e[t]);
    o[r[t]] = d, i.set(d, r[t]);
  }
  return {
    byteToUnicode: o,
    unicodeToByte: i
  };
}
var { unicodeToByte: M } = S();
function A(r) {
  if (typeof r != "string" || r.length === 0) return new Uint8Array(0);
  const e = new Uint8Array(r.length);
  let n = 0;
  for (const o of r) {
    const i = M.get(o);
    if (i === void 0) return null;
    e[n++] = i;
  }
  return n === e.length ? e : e.subarray(0, n);
}
var z = class {
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
      const o = this._dec.decode();
      return this._skipIds && this._skipIds.has(r) ? o : o + this._addedLiterals.get(r);
    }
    const e = this._idToToken(r);
    if (typeof e != "string" || e.length === 0) return "";
    const n = A(e);
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
  for (const o of n) typeof o.id == "number" && typeof o.content == "string" && e.set(o.id, o.content);
  return e;
}
function x(r) {
  const e = /* @__PURE__ */ new Set(), n = r && Array.isArray(r.added_tokens) ? r.added_tokens : [];
  for (const o of n) o.special && typeof o.id == "number" && e.add(o.id);
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
  constructor(e, n, o) {
    this.tokenizer = e, this.chatTemplate = n, this.config = o, this.eosTokenIds = /* @__PURE__ */ new Set();
    const i = o.eos_token;
    if (i) {
      const d = e.token_to_id(i);
      d !== void 0 && this.eosTokenIds.add(d);
    }
    const t = e.token_to_id("<|endoftext|>");
    t !== void 0 && this.eosTokenIds.add(t), this.specialTokens = {};
    for (const [d, c] of Object.entries(T)) this.specialTokens[d] = c;
  }
  static fromJSON(e, n) {
    const o = new m(e, n);
    let i = null;
    const t = n.chat_template;
    if (t) {
      const d = Array.isArray(t) ? t[0].template : t;
      i = new _(d);
    }
    return new g(o, i, n);
  }
  static async fromUrls(e, n) {
    const [o, i] = await Promise.all([fetch(e).then((t) => {
      if (!t.ok) throw new Error(`Failed to fetch tokenizer.json: ${t.status}`);
      return t.json();
    }), fetch(n).then((t) => {
      if (!t.ok) throw new Error(`Failed to fetch tokenizer_config.json: ${t.status}`);
      return t.json();
    })]);
    return g.fromJSON(o, i);
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
    return new z({
      idToToken: (n) => this.tokenizer.id_to_token(n),
      addedTokenLiterals: N(this.tokenizer),
      skipTokenIds: e ? x(this.tokenizer) : null
    });
  }
  tokenToId(e) {
    return this.tokenizer.token_to_id(e);
  }
  formatChat(e, { addGenerationPrompt: n = !0, enableThinking: o = !0 } = {}) {
    if (!this.chatTemplate) throw new Error("No chat template available in tokenizer config");
    return this.chatTemplate.render({
      messages: e,
      add_generation_prompt: n,
      enable_thinking: o,
      bos_token: this.config.bos_token || null,
      eos_token: this.config.eos_token || "<|im_end|>"
    });
  }
  encodeChat(e, n = {}) {
    const o = this.formatChat(e, n);
    return this.encode(o);
  }
  encodeChatMultimodal(e, n = {}) {
    const { imageTokenCounts: o = null, videoTokenCounts: i = null, addGenerationPrompt: t = !0, enableThinking: d = !0 } = n, c = this.tokenizer.token_to_id("<|image_pad|>"), l = this.tokenizer.token_to_id("<|video_pad|>");
    if (c === void 0) throw new Error("encodeChatMultimodal: tokenizer vocab lacks <|image_pad|> — the Qwen3.5-VL tokenizer is required (expected id 248056).");
    const I = this.formatChat(e, {
      addGenerationPrompt: t,
      enableThinking: d
    }), u = this.encode(I);
    if (!o && !i) return {
      tokenIds: u,
      imageTokenRanges: [],
      videoTokenRanges: []
    };
    const w = u.reduce((s, a) => s + (a === c ? 1 : 0), 0), b = l !== void 0 ? u.reduce((s, a) => s + (a === l ? 1 : 0), 0) : 0;
    if (o) {
      if (!Array.isArray(o)) throw new Error("encodeChatMultimodal: imageTokenCounts must be an array.");
      if (o.length !== w) throw new Error(`encodeChatMultimodal: imageTokenCounts length (${o.length}) does not match <|image_pad|> placeholders in chat template (${w}). Each image item in message content arrays emits exactly one placeholder.`);
      for (let s = 0; s < o.length; s++) {
        const a = o[s];
        if (!Number.isInteger(a) || a < 1) throw new Error(`encodeChatMultimodal: imageTokenCounts[${s}]=${a} must be a positive integer.`);
      }
    }
    if (i) {
      if (!Array.isArray(i)) throw new Error("encodeChatMultimodal: videoTokenCounts must be an array.");
      if (l === void 0) throw new Error("encodeChatMultimodal: tokenizer vocab lacks <|video_pad|>; videoTokenCounts cannot be applied.");
      if (i.length !== b) throw new Error(`encodeChatMultimodal: videoTokenCounts length (${i.length}) does not match <|video_pad|> placeholders (${b}).`);
      for (let s = 0; s < i.length; s++) {
        const a = i[s];
        if (!Number.isInteger(a) || a < 1) throw new Error(`encodeChatMultimodal: videoTokenCounts[${s}]=${a} must be a positive integer.`);
      }
    }
    const h = [], y = [], v = [];
    let C = 0, E = 0;
    for (let s = 0; s < u.length; s++) {
      const a = u[s];
      if (o && a === c) {
        const f = o[C++], p = h.length;
        for (let k = 0; k < f; k++) h.push(c);
        y.push({
          start: p,
          count: f
        });
      } else if (i && l !== void 0 && a === l) {
        const f = i[E++], p = h.length;
        for (let k = 0; k < f; k++) h.push(l);
        v.push({
          start: p,
          count: f
        });
      } else h.push(a);
    }
    return {
      tokenIds: h,
      imageTokenRanges: y,
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

//# sourceMappingURL=tokenizer-B-nps1nR.mjs.map