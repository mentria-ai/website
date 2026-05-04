var q = class {
  constructor(e) {
    this.trie = this._build_trie(e);
  }
  _build_trie(e) {
    const t = /* @__PURE__ */ Object.create(null);
    for (const s of e) {
      let r = t;
      for (let n = 0; n < s.length; ++n) {
        const i = s[n];
        r = r[i] ??= /* @__PURE__ */ Object.create(null);
      }
      r.end = s;
    }
    return t;
  }
  split(e) {
    const t = [], s = e.length;
    let r = 0, n = 0;
    for (; n < s; ) {
      let i = this.trie, a = null, o = n;
      for (; o < s && (i = i[e[o]]); )
        i.end && (a = i.end), ++o;
      a ? (n > r && t.push(e.slice(r, n)), t.push(a), n += a.length, r = n) : ++n;
    }
    return r < s && t.push(e.slice(r)), t;
  }
}, x = q, U = class {
  constructor(e) {
    this.content = e.content, this.id = e.id, this.single_word = e.single_word ?? !1, this.lstrip = e.lstrip ?? !1, this.rstrip = e.rstrip ?? !1, this.special = e.special ?? !1, this.normalized = e.normalized ?? !this.special;
  }
}, W = U, E = (() => {
  const e = [
    ...Array.from({ length: 94 }, (n, i) => i + 33),
    ...Array.from({ length: 12 }, (n, i) => i + 161),
    ...Array.from({ length: 82 }, (n, i) => i + 174)
  ], t = e.slice();
  let s = 0;
  for (let n = 0; n < 256; ++n) e.includes(n) || (e.push(n), t.push(256 + s), s += 1);
  const r = t.map((n) => String.fromCharCode(n));
  return Object.fromEntries(e.map((n, i) => [n, r[i]]));
})(), j = (e) => Object.fromEntries(Object.entries(e).map(([t, s]) => [s, t])), K = j(E), P = ".,!?…。，、।۔،", I = /* @__PURE__ */ new Map([
  ["(?i:'s|'t|'re|'ve|'m|'ll|'d)", "(?:'([sS]|[tT]|[rR][eE]|[vV][eE]|[mM]|[lL][lL]|[dD]))"],
  ["(?i:[sdmt]|ll|ve|re)", "(?:[sS]|[dD]|[mM]|[tT]|[lL][lL]|[vV][eE]|[rR][eE])"],
  ["[^\\r\\n\\p{L}\\p{N}]?+", "[^\\r\\n\\p{L}\\p{N}]?"],
  ["[^\\s\\p{L}\\p{N}]++", "[^\\s\\p{L}\\p{N}]+"],
  ["(?>\\p{Nd}{510})", "(?:\\p{Nd}{510})"],
  ["\\p{Nd}{3}+", "(?:\\p{Nd}{3})+"],
  ["\\G", ""],
  [` ?[^(\\s|[${P}])]+`, ` ?[^\\s${P}]+`]
]), k = "\\p{P}\\u0021-\\u002F\\u003A-\\u0040\\u005B-\\u0060\\u007B-\\u007E", z = (e) => e.replace(/ \./g, ".").replace(/ \?/g, "?").replace(/ \!/g, "!").replace(/ ,/g, ",").replace(/ \' /g, "'").replace(/ n't/g, "n't").replace(/ 'm/g, "'m").replace(/ 's/g, "'s").replace(/ 've/g, "'ve").replace(/ 're/g, "'re"), v = (e, t = !0) => {
  if (e.Regex !== void 0) {
    let s = e.Regex.replace(/\\([#&~])/g, "$1");
    s = s.replace(/\\A/g, "^").replace(/\\z/g, "$").replace(/\\Z/g, "(?=\\r?\\n?$)");
    for (const [r, n] of I) s = s.replaceAll(r, n);
    try {
      return new RegExp(s, "gu");
    } catch (r) {
      if (!(r instanceof SyntaxError) || !r.message.toLowerCase().includes("invalid property name")) throw r;
      let n = !1;
      const i = s.replace(/(\\[pP])\{([^}=]+)\}/g, (a, o, c) => {
        try {
          return new RegExp(`\\p{${c}}`, "u"), `${o}{${c}}`;
        } catch {
          return n = !0, `${o}{Script=${c}}`;
        }
      });
      if (!n) throw r;
      try {
        return new RegExp(i, "gu");
      } catch {
        throw r;
      }
    }
  } else if (e.String !== void 0) {
    const s = G(e.String);
    return new RegExp(t ? s : `(${s})`, "gu");
  } else
    return console.warn("Unknown pattern type:", e), null;
}, G = (e) => e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), J = (e, t, s) => {
  const r = [];
  let n = 0;
  for (; n < e.length; ) {
    if (r.push(e[n]), (t.get(e[n]) ?? s) !== s) {
      ++n;
      continue;
    }
    for (; ++n < e.length && (t.get(e[n]) ?? s) === s; ) t.get(r.at(-1)) !== s && (r[r.length - 1] += e[n]);
  }
  return r;
}, Q = (e) => e >= 19968 && e <= 40959 || e >= 13312 && e <= 19903 || e >= 131072 && e <= 173791 || e >= 173824 && e <= 177983 || e >= 177984 && e <= 178207 || e >= 178208 && e <= 183983 || e >= 63744 && e <= 64255 || e >= 194560 && e <= 195103, V = (e) => Number.isInteger(e) || typeof e == "bigint", X = (e) => {
  let t = 0;
  for (const s of e) ++t;
  return t;
}, Y = (e) => F(e.toLowerCase()), h = (...e) => Array.prototype.concat.apply([], e), b = (e) => new Map(Object.entries(e)), H = (e, t) => {
  const s = [];
  let r = 0;
  for (const n of e.matchAll(t)) {
    const i = n[0];
    r < n.index && s.push(e.slice(r, n.index)), i.length > 0 && s.push(i), r = n.index + i.length;
  }
  return r < e.length && s.push(e.slice(r)), s;
}, F = (e) => e.replace(/\p{M}/gu, ""), A = (e, t, s = []) => {
  if (!e || Array.isArray(e) || typeof e != "object") return `${t} must be a valid object`;
  for (const r of s) if (!(r in e)) return `${t} must contain a "${r}" property`;
  return null;
}, Z = (e) => e.match(/\S+/g) || [], ee = class {
  constructor() {
    const e = function(...t) {
      return e._call(...t);
    };
    return Object.setPrototypeOf(e, new.target.prototype);
  }
}, p = ee, te = class extends p {
  constructor(e) {
    super(), this.config = e;
  }
  _call(e) {
    return this.normalize(e);
  }
}, d = te, se = class extends d {
  tokenize_chinese_chars(e) {
    const t = [];
    for (let s = 0; s < e.length; ++s) {
      const r = e[s];
      Q(r.charCodeAt(0)) ? (t.push(" "), t.push(r), t.push(" ")) : t.push(r);
    }
    return t.join("");
  }
  strip_accents(e) {
    return e.normalize("NFD").replace(/\p{Mn}/gu, "");
  }
  is_control(e) {
    switch (e) {
      case "	":
      case `
`:
      case "\r":
        return !1;
      default:
        return /^\p{Cc}|\p{Cf}|\p{Co}|\p{Cs}$/u.test(e);
    }
  }
  clean_text(e) {
    const t = [];
    for (const s of e) {
      const r = s.charCodeAt(0);
      r === 0 || r === 65533 || this.is_control(s) || (/^\s$/.test(s) ? t.push(" ") : t.push(s));
    }
    return t.join("");
  }
  normalize(e) {
    return this.config.clean_text && (e = this.clean_text(e)), this.config.handle_chinese_chars && (e = this.tokenize_chinese_chars(e)), this.config.lowercase ? (e = e.toLowerCase(), this.config.strip_accents !== !1 && (e = this.strip_accents(e))) : this.config.strip_accents && (e = this.strip_accents(e)), e;
  }
}, re = se, ne = class extends d {
  constructor(e) {
    super(e), this.charsmap = e.precompiled_charsmap ?? null;
  }
  normalize(e) {
    return e = e.replace(/[\u0001-\u0008\u000B\u000E-\u001F\u007F\u008F\u009F]/gm, ""), e = e.replace(/[\u0009\u000A\u000C\u000D\u00A0\u1680\u2000-\u200F\u2028\u2029\u202F\u205F\u2581\u3000\uFEFF\uFFFD]/gm, " "), e.includes("～") ? e = e.split("～").map((t) => t.normalize("NFKC")).join("～") : e = e.normalize("NFKC"), e;
  }
}, ie = ne, oe = class extends d {
  constructor(e) {
    super(e), this.normalizers = (e.normalizers ?? []).map((t) => L(t));
  }
  normalize(e) {
    return this.normalizers.reduce((t, s) => s ? s.normalize(t) : t, e);
  }
}, ae = oe, ce = class extends d {
  normalize(e) {
    const t = v(this.config.pattern ?? {});
    return t === null ? e : e.replaceAll(t, this.config.content ?? "");
  }
}, le = ce, he = class extends d {
  constructor() {
    super(...arguments), this.form = "NFC";
  }
  normalize(e) {
    return e = e.normalize(this.form), e;
  }
}, m = he, ue = class extends m {
  constructor() {
    super(...arguments), this.form = "NFC";
  }
}, _e = ue, de = class extends m {
  constructor() {
    super(...arguments), this.form = "NFD";
  }
}, pe = de, fe = class extends m {
  constructor() {
    super(...arguments), this.form = "NFKC";
  }
}, ke = fe, ve = class extends m {
  constructor() {
    super(...arguments), this.form = "NFKD";
  }
}, me = ve, we = class extends d {
  normalize(e) {
    return this.config.strip_left && this.config.strip_right ? e = e.trim() : (this.config.strip_left && (e = e.trimStart()), this.config.strip_right && (e = e.trimEnd())), e;
  }
}, ge = we, ze = class extends d {
  normalize(e) {
    return F(e);
  }
}, be = ze, ye = class extends d {
  normalize(e) {
    return e.toLowerCase();
  }
}, xe = ye, Pe = class extends d {
  normalize(e) {
    return e = this.config.prepend + e, e;
  }
}, Ae = Pe;
function Ne(e) {
  if (e === null) return null;
  switch (e.type) {
    case "BertNormalizer":
      return new re(e);
    case "Precompiled":
      return new ie(e);
    case "Sequence":
      return new ae(e);
    case "Replace":
      return new le(e);
    case "NFC":
      return new _e(e);
    case "NFD":
      return new pe(e);
    case "NFKC":
      return new ke(e);
    case "NFKD":
      return new me(e);
    case "Strip":
      return new ge(e);
    case "StripAccents":
      return new be(e);
    case "Lowercase":
      return new xe(e);
    case "Prepend":
      return new Ae(e);
    default:
      throw new Error(`Unknown Normalizer type: ${e.type}`);
  }
}
var L = Ne, Se = class extends p {
  pre_tokenize(e, t) {
    return (Array.isArray(e) ? e.map((s) => this.pre_tokenize_text(s, t)) : this.pre_tokenize_text(e, t)).flat();
  }
  _call(e, t) {
    return this.pre_tokenize(e, t);
  }
}, u = Se, Te = class extends u {
  constructor(e) {
    super(), this.config = e, this.add_prefix_space = this.config.add_prefix_space ?? !1, this.trim_offsets = this.config.trim_offsets ?? !1, this.use_regex = this.config.use_regex ?? !0, this.pattern = /'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu, this.byte_encoder = E, this.text_encoder = new TextEncoder();
  }
  pre_tokenize_text(e, t) {
    return this.add_prefix_space && !e.startsWith(" ") && (e = " " + e), (this.use_regex ? e.match(this.pattern) || [] : [e]).map((s) => Array.from(this.text_encoder.encode(s), (r) => this.byte_encoder[r]).join(""));
  }
}, Ce = Te, Ee = class extends u {
  pre_tokenize_text(e, t) {
    return e.match(/\w+|[^\w\s]+/g) || [];
  }
}, Fe = Ee, Le = class extends u {
  constructor(e) {
    super(), this.replacement = e.replacement ?? "▁", this.str_rep = e.str_rep || this.replacement, this.prepend_scheme = e.prepend_scheme ?? "always";
  }
  pre_tokenize_text(e, t) {
    const { section_index: s = void 0 } = t ?? {};
    let r = e.replaceAll(" ", this.str_rep);
    return !r.startsWith(this.replacement) && (this.prepend_scheme === "always" || this.prepend_scheme === "first" && s === 0) && (r = this.str_rep + r), [r];
  }
}, Be = Le, De = class extends u {
  constructor(e) {
    super(), this.config = e, this.pattern = v(this.config.pattern ?? {}, this.config.invert ?? !0);
  }
  pre_tokenize_text(e) {
    return this.pattern === null ? [] : this.config.invert ? e.match(this.pattern) || [] : this.config.behavior?.toLowerCase() === "removed" ? e.split(this.pattern).filter((t) => t) : H(e, this.pattern);
  }
}, Me = De, Re = class extends u {
  constructor(e) {
    super(), this.config = e, this.pattern = new RegExp(`[^${k}]+|[${k}]+`, "gu");
  }
  pre_tokenize_text(e) {
    return e.match(this.pattern) || [];
  }
}, $e = Re, Oe = class extends u {
  constructor(e) {
    super(), this.config = e;
    const t = `[^\\d]+|\\d${this.config.individual_digits ? "" : "+"}`;
    this.pattern = new RegExp(t, "gu");
  }
  pre_tokenize_text(e) {
    return e.match(this.pattern) || [];
  }
}, qe = Oe, Ue = class extends u {
  constructor() {
    super(), this.pattern = new RegExp(`[^\\s${k}]+|[${k}]`, "gu");
  }
  pre_tokenize_text(e, t) {
    return e.trim().match(this.pattern) || [];
  }
}, We = Ue, je = class extends u {
  constructor(e) {
    super(), this.config = e, this.pattern = v(this.config.pattern ?? {}), this.content = this.config.content ?? "";
  }
  pre_tokenize_text(e) {
    return this.pattern === null ? [e] : [e.replaceAll(this.pattern, this.config.content ?? "")];
  }
}, Ke = je, Ie = class extends u {
  constructor(e) {
    super(), this.tokenizers = (e.pretokenizers ?? []).map((t) => B(t));
  }
  pre_tokenize_text(e, t) {
    return this.tokenizers.reduce((s, r) => r ? r.pre_tokenize(s, t) : s, [e]);
  }
}, Ge = Ie, Je = class extends u {
  pre_tokenize_text(e) {
    return Z(e);
  }
}, Qe = Je, Ve = class extends u {
  constructor(e) {
    super(), this.config = e, this._length = e.length;
  }
  pre_tokenize_text(e) {
    const t = [];
    for (let s = 0; s < e.length; s += this._length) t.push(e.slice(s, s + this._length));
    return t;
  }
}, Xe = Ve;
function Ye(e) {
  if (e === null) return null;
  switch (e.type) {
    case "BertPreTokenizer":
      return new We();
    case "Sequence":
      return new Ge(e);
    case "Whitespace":
      return new Fe();
    case "WhitespaceSplit":
      return new Qe();
    case "Metaspace":
      return new Be(e);
    case "ByteLevel":
      return new Ce(e);
    case "Split":
      return new Me(e);
    case "Punctuation":
      return new $e(e);
    case "Digits":
      return new qe(e);
    case "Replace":
      return new Ke(e);
    case "FixedLength":
      return new Xe(e);
    default:
      throw new Error(`Unknown PreTokenizer type: ${e.type}`);
  }
}
var B = Ye, He = class extends p {
  constructor(e) {
    super(), this.config = e, this.vocab = [], this.tokens_to_ids = /* @__PURE__ */ new Map(), this.unk_token_id = void 0, this.unk_token = void 0, this.end_of_word_suffix = void 0, this.fuse_unk = this.config.fuse_unk ?? !1;
  }
  _call(e) {
    let t = this.encode(e);
    return this.fuse_unk && (t = J(t, this.tokens_to_ids, this.unk_token_id)), t;
  }
}, w = He, Ze = class extends w {
  constructor(e) {
    super(e), this.max_input_chars_per_word = 100, this.tokens_to_ids = b(e.vocab), this.unk_token_id = this.tokens_to_ids.get(e.unk_token), this.unk_token = e.unk_token, this.max_input_chars_per_word = e.max_input_chars_per_word ?? 100, this.vocab = new Array(this.tokens_to_ids.size);
    for (const [t, s] of this.tokens_to_ids) this.vocab[s] = t;
  }
  encode(e) {
    const t = [];
    for (const s of e) {
      const r = [...s];
      if (r.length > this.max_input_chars_per_word) {
        t.push(this.unk_token);
        continue;
      }
      let n = !1, i = 0;
      const a = [];
      for (; i < r.length; ) {
        let o = r.length, c = null;
        for (; i < o; ) {
          let l = r.slice(i, o).join("");
          if (i > 0 && (l = this.config.continuing_subword_prefix + l), this.tokens_to_ids.has(l)) {
            c = l;
            break;
          }
          --o;
        }
        if (c === null) {
          n = !0;
          break;
        }
        a.push(c), i = o;
      }
      n ? t.push(this.unk_token) : t.push(...a);
    }
    return t;
  }
}, N = Ze, S = class D {
  constructor(t, s) {
    this.is_leaf = t, this.children = s;
  }
  static default() {
    return new D(!1, /* @__PURE__ */ new Map());
  }
}, et = class {
  constructor() {
    this.root = S.default();
  }
  extend(e) {
    for (const t of e) this.push(t);
  }
  push(e) {
    let t = this.root;
    for (const s of e) {
      let r = t.children.get(s);
      r === void 0 && (r = S.default(), t.children.set(s, r)), t = r;
    }
    t.is_leaf = !0;
  }
  *common_prefix_search(e) {
    let t = this.root;
    if (t === void 0) return;
    let s = "";
    for (const r of e) {
      if (s += r, t = t.children.get(r), t === void 0) return;
      t.is_leaf && (yield s);
    }
  }
}, tt = et, g = class M {
  constructor(t, s, r, n, i) {
    this.token_id = t, this.node_id = s, this.pos = r, this.length = n, this.score = i, this.prev = null, this.backtrace_score = 0;
  }
  clone() {
    const t = new M(this.token_id, this.node_id, this.pos, this.length, this.score);
    return t.prev = this.prev, t.backtrace_score = this.backtrace_score, t;
  }
}, st = class {
  constructor(e, t, s) {
    this.chars = Array.from(e), this.len = this.chars.length, this.bos_token_id = t, this.eos_token_id = s, this.nodes = [], this.begin_nodes = Array.from({ length: this.len + 1 }, () => []), this.end_nodes = Array.from({ length: this.len + 1 }, () => []);
    const r = new g(this.bos_token_id ?? 0, 0, 0, 0, 0), n = new g(this.eos_token_id ?? 0, 1, this.len, 0, 0);
    this.nodes.push(r.clone()), this.nodes.push(n.clone()), this.begin_nodes[this.len].push(n), this.end_nodes[0].push(r);
  }
  insert(e, t, s, r) {
    const n = this.nodes.length, i = new g(r, n, e, t, s);
    this.begin_nodes[e].push(i), this.end_nodes[e + t].push(i), this.nodes.push(i);
  }
  viterbi() {
    const e = this.len;
    let t = 0;
    for (; t <= e; ) {
      if (this.begin_nodes[t].length == 0) return [];
      for (let i of this.begin_nodes[t]) {
        i.prev = null;
        let a = 0, o = null;
        for (let c of this.end_nodes[t]) {
          const l = c.backtrace_score + i.score;
          (o === null || l > a) && (o = c.clone(), a = l);
        }
        if (o !== null)
          i.prev = o, i.backtrace_score = a;
        else return [];
      }
      ++t;
    }
    const s = [], r = this.begin_nodes[e][0].prev;
    if (r === null) return [];
    let n = r.clone();
    for (; n.prev !== null; )
      s.push(n.clone()), n = n.clone().prev.clone();
    return s.reverse(), s;
  }
  piece(e) {
    return this.chars.slice(e.pos, e.pos + e.length).join("");
  }
  tokens() {
    return this.viterbi().map((e) => this.piece(e));
  }
  token_ids() {
    return this.viterbi().map((e) => e.token_id);
  }
}, rt = st;
function nt(e) {
  if (e.length === 0) throw new Error("Array must not be empty");
  let t = e[0], s = 0;
  for (let r = 1; r < e.length; ++r) e[r] < t && (t = e[r], s = r);
  return [t, s];
}
var it = class extends w {
  constructor(e, t) {
    super(e);
    const s = e.vocab.length;
    this.vocab = new Array(s), this.scores = new Array(s);
    for (let r = 0; r < s; ++r) [this.vocab[r], this.scores[r]] = e.vocab[r];
    this.unk_token_id = e.unk_id, this.unk_token = this.vocab[e.unk_id], this.tokens_to_ids = new Map(this.vocab.map((r, n) => [r, n])), this.bos_token = " ", this.bos_token_id = this.tokens_to_ids.get(this.bos_token), this.eos_token = t, this.eos_token_id = this.tokens_to_ids.get(this.eos_token), this.unk_token = this.vocab[this.unk_token_id], this.min_score = nt(this.scores)[0], this.unk_score = this.min_score - 10, this.scores[this.unk_token_id] = this.unk_score, this.trie = new tt(), this.trie.extend(this.vocab), this.fuse_unk = !0;
  }
  populate_nodes(e) {
    const t = e.chars, s = 1;
    let r = 0;
    for (; r < t.length; ) {
      let n = !1;
      const i = [], a = t.slice(r).join(""), o = this.trie.common_prefix_search(a);
      for (const c of o) {
        i.push(c);
        const l = this.tokens_to_ids.get(c), O = this.scores[l], y = X(c);
        e.insert(r, y, O, l), !n && y === s && (n = !0);
      }
      n || e.insert(r, s, this.unk_score, this.unk_token_id), r += s;
    }
  }
  tokenize(e) {
    const t = new rt(e, this.bos_token_id, this.eos_token_id);
    return this.populate_nodes(t), t.tokens();
  }
  encode(e) {
    const t = [];
    for (const s of e) {
      const r = this.tokenize(s);
      t.push(...r);
    }
    return t;
  }
}, T = it, ot = class {
  constructor(e = (s, r) => s > r, t = 1 / 0) {
    this._heap = [], this._comparator = e, this._max_size = t;
  }
  get size() {
    return this._heap.length;
  }
  is_empty() {
    return this.size === 0;
  }
  peek() {
    return this._heap[0];
  }
  push(...e) {
    return this.extend(e);
  }
  extend(e) {
    for (const t of e) if (this.size < this._max_size)
      this._heap.push(t), this._sift_up();
    else {
      const s = this._smallest();
      this._comparator(t, this._heap[s]) && (this._heap[s] = t, this._sift_up_from(s));
    }
    return this.size;
  }
  pop() {
    const e = this.peek(), t = this.size - 1;
    return t > 0 && this._swap(0, t), this._heap.pop(), this._sift_down(), e;
  }
  replace(e) {
    const t = this.peek();
    return this._heap[0] = e, this._sift_down(), t;
  }
  _parent(e) {
    return (e + 1 >>> 1) - 1;
  }
  _left(e) {
    return (e << 1) + 1;
  }
  _right(e) {
    return e + 1 << 1;
  }
  _greater(e, t) {
    return this._comparator(this._heap[e], this._heap[t]);
  }
  _swap(e, t) {
    const s = this._heap[e];
    this._heap[e] = this._heap[t], this._heap[t] = s;
  }
  _sift_up() {
    this._sift_up_from(this.size - 1);
  }
  _sift_up_from(e) {
    for (; e > 0 && this._greater(e, this._parent(e)); )
      this._swap(e, this._parent(e)), e = this._parent(e);
  }
  _sift_down() {
    let e = 0;
    for (; this._left(e) < this.size && this._greater(this._left(e), e) || this._right(e) < this.size && this._greater(this._right(e), e); ) {
      const t = this._right(e) < this.size && this._greater(this._right(e), this._left(e)) ? this._right(e) : this._left(e);
      this._swap(e, t), e = t;
    }
  }
  _smallest() {
    return 2 ** Math.floor(Math.log2(this.size)) - 1;
  }
}, at = ot, ct = class {
  constructor(e) {
    this.capacity = e, this.cache = /* @__PURE__ */ new Map();
  }
  get(e) {
    if (!this.cache.has(e)) return;
    const t = this.cache.get(e);
    return this.cache.delete(e), this.cache.set(e, t), t;
  }
  put(e, t) {
    this.cache.has(e) && this.cache.delete(e), this.cache.set(e, t), this.cache.size > this.capacity && this.cache.delete(this.cache.keys().next().value);
  }
  clear() {
    this.cache.clear();
  }
}, lt = ct, ht = class extends w {
  constructor(e) {
    super(e), this.tokens_to_ids = b(e.vocab), this.unk_token_id = this.tokens_to_ids.get(e.unk_token), this.unk_token = e.unk_token, this.vocab = new Array(this.tokens_to_ids.size);
    for (const [s, r] of this.tokens_to_ids) this.vocab[r] = s;
    const t = Array.isArray(e.merges[0]);
    this.merges = t ? e.merges : e.merges.map((s) => s.split(" ", 2)), this.bpe_ranks = new Map(this.merges.map((s, r) => [JSON.stringify(s), r])), this.end_of_word_suffix = e.end_of_word_suffix, this.continuing_subword_suffix = e.continuing_subword_suffix ?? null, this.byte_fallback = this.config.byte_fallback ?? !1, this.byte_fallback && (this.text_encoder = new TextEncoder()), this.ignore_merges = this.config.ignore_merges ?? !1, this.max_length_to_cache = 256, this.cache_capacity = 1e4, this.cache = new lt(this.cache_capacity);
  }
  clear_cache() {
    this.cache.clear();
  }
  bpe(e) {
    if (e.length === 0) return [];
    const t = this.cache.get(e);
    if (t !== void 0) return t;
    const s = Array.from(e);
    this.end_of_word_suffix && (s[s.length - 1] += this.end_of_word_suffix);
    let r = [];
    if (s.length > 1) {
      const n = new at((o, c) => o.score < c.score);
      let i = {
        token: s[0],
        bias: 0,
        prev: null,
        next: null
      }, a = i;
      for (let o = 1; o < s.length; ++o) {
        const c = {
          bias: o / s.length,
          token: s[o],
          prev: a,
          next: null
        };
        a.next = c, this.add_node(n, a), a = c;
      }
      for (; !n.is_empty(); ) {
        const o = n.pop();
        if (o.deleted || !o.next || o.next.deleted) continue;
        if (o.deleted = !0, o.next.deleted = !0, o.prev) {
          const l = { ...o.prev };
          o.prev.deleted = !0, o.prev = l, l.prev ? l.prev.next = l : i = l;
        }
        const c = {
          token: o.token + o.next.token,
          bias: o.bias,
          prev: o.prev,
          next: o.next.next
        };
        c.prev ? (c.prev.next = c, this.add_node(n, c.prev)) : i = c, c.next && (c.next.prev = c, this.add_node(n, c));
      }
      for (let o = i; o !== null; o = o.next) r.push(o.token);
    } else r = s;
    if (this.continuing_subword_suffix) for (let n = 0; n < r.length - 1; ++n) r[n] += this.continuing_subword_suffix;
    return e.length < this.max_length_to_cache && this.cache.put(e, r), r;
  }
  add_node(e, t) {
    const s = this.bpe_ranks.get(JSON.stringify([t.token, t.next.token]));
    s !== void 0 && (t.score = s + t.bias, e.push(t));
  }
  encode(e) {
    const t = [];
    for (const s of e) {
      if (this.ignore_merges && this.tokens_to_ids.has(s)) {
        t.push(s);
        continue;
      }
      const r = this.bpe(s);
      for (const n of r) if (this.tokens_to_ids.has(n)) t.push(n);
      else if (this.byte_fallback) {
        const i = Array.from(this.text_encoder.encode(n)).map((a) => `<0x${a.toString(16).toUpperCase().padStart(2, "0")}>`);
        i.every((a) => this.tokens_to_ids.has(a)) ? t.push(...i) : this.unk_token != null && t.push(this.unk_token);
      } else this.unk_token != null && t.push(this.unk_token);
    }
    return t;
  }
}, C = ht, ut = class extends w {
  constructor(e, t) {
    super(e);
    const s = e.vocab;
    this.tokens_to_ids = b(t.target_lang ? s[t.target_lang] : s), this.bos_token = t.bos_token, this.bos_token_id = this.tokens_to_ids.get(this.bos_token), this.eos_token = t.eos_token, this.eos_token_id = this.tokens_to_ids.get(this.eos_token), this.pad_token = t.pad_token, this.pad_token_id = this.tokens_to_ids.get(this.pad_token), this.unk_token = t.unk_token, this.unk_token_id = this.tokens_to_ids.get(this.unk_token), this.vocab = new Array(this.tokens_to_ids.size);
    for (const [r, n] of this.tokens_to_ids) this.vocab[n] = r;
  }
  encode(e) {
    return e;
  }
}, _t = ut;
function dt(e, t) {
  switch (e.type) {
    case "WordPiece":
      return new N(e);
    case "Unigram":
      return new T(e, t.eos_token);
    case "BPE":
      return new C(e);
    default:
      if (e.vocab) return Array.isArray(e.vocab) ? new T(e, t.eos_token) : Object.hasOwn(e, "continuing_subword_prefix") && Object.hasOwn(e, "unk_token") ? Object.hasOwn(e, "merges") ? new C(e) : new N(e) : new _t(e, {
        target_lang: t.target_lang,
        bos_token: t.bos_token,
        eos_token: t.eos_token,
        pad_token: t.pad_token,
        unk_token: t.unk_token
      });
      throw new Error(`Unknown TokenizerModel type: ${e?.type}`);
  }
}
var pt = dt, ft = class extends p {
  constructor(e) {
    super(), this.config = e;
  }
  _call(e, ...t) {
    return this.post_process(e, ...t);
  }
}, f = ft, kt = class extends f {
  post_process(e, t = null, s = !0) {
    const r = t === null ? this.config.single : this.config.pair;
    let n = [], i = [];
    for (const a of r) "SpecialToken" in a ? s && (n.push(a.SpecialToken.id), i.push(a.SpecialToken.type_id)) : "Sequence" in a && (a.Sequence.id === "A" ? (n = h(n, e), i = h(i, new Array(e.length).fill(a.Sequence.type_id))) : a.Sequence.id === "B" && (n = h(n, t), i = h(i, new Array(t.length).fill(a.Sequence.type_id))));
    return {
      tokens: n,
      token_type_ids: i
    };
  }
}, vt = kt, mt = class extends f {
  post_process(e, t = null) {
    return {
      tokens: e,
      tokens_pair: t
    };
  }
}, wt = mt, gt = class extends f {
  constructor(e) {
    super(e), this.sep = e.sep, this.cls = e.cls;
  }
  post_process(e, t = null, s = !0) {
    s && (e = h([this.cls[0]], e, [this.sep[0]]));
    let r = new Array(e.length).fill(0);
    if (t) {
      const n = [], i = s ? [this.sep[0]] : [];
      e = h(e, n, t, i), r = h(r, new Array(t.length + n.length + i.length).fill(1));
    }
    return {
      tokens: e,
      token_type_ids: r
    };
  }
}, zt = gt, bt = class extends f {
  constructor(e) {
    super(e), this.sep = e.sep, this.cls = e.cls;
  }
  post_process(e, t, s = !0) {
    s && (e = h([this.cls[0]], e, [this.sep[0]]));
    let r = new Array(e.length).fill(0);
    if (t) {
      const n = s ? [this.sep[0]] : [], i = s ? [this.sep[0]] : [];
      e = h(e, n, t, i), r = h(r, new Array(t.length + n.length + i.length).fill(1));
    }
    return {
      tokens: e,
      token_type_ids: r
    };
  }
}, yt = bt, xt = class extends f {
  constructor(e) {
    super(e), this.processors = (e.processors ?? []).map((t) => R(t));
  }
  post_process(e, t = null, s = !0) {
    let r = {
      tokens: e,
      tokens_pair: t
    };
    for (const n of this.processors) r = n.post_process(r.tokens, r.tokens_pair, s);
    return r;
  }
}, Pt = xt;
function At(e) {
  if (e === null) return null;
  switch (e.type) {
    case "TemplateProcessing":
      return new vt(e);
    case "ByteLevel":
      return new wt(e);
    case "BertProcessing":
      return new zt(e);
    case "RobertaProcessing":
      return new yt(e);
    case "Sequence":
      return new Pt(e);
    default:
      throw new Error(`Unknown PostProcessor type: ${e.type}`);
  }
}
var R = At, Nt = class extends p {
  constructor(e) {
    super(), this.config = e, this.added_tokens = [], this.end_of_word_suffix = null, this.trim_offsets = "trim_offsets" in e ? e.trim_offsets : !1;
  }
  _call(e) {
    return this.decode(e);
  }
  decode(e) {
    return this.decode_chain(e).join("");
  }
}, _ = Nt, St = class extends _ {
  constructor(e) {
    super(e), this.byte_decoder = K, this.text_decoder = new TextDecoder("utf-8", {
      fatal: !1,
      ignoreBOM: !0
    }), this.end_of_word_suffix = null;
  }
  convert_tokens_to_string(e) {
    const t = e.join(""), s = new Uint8Array([...t].map((r) => this.byte_decoder[r]));
    return this.text_decoder.decode(s);
  }
  decode_chain(e) {
    const t = [];
    let s = [];
    for (const r of e) this.added_tokens.find((n) => n.content === r) !== void 0 ? (s.length > 0 && (t.push(this.convert_tokens_to_string(s)), s = []), t.push(r)) : s.push(r);
    return s.length > 0 && t.push(this.convert_tokens_to_string(s)), t;
  }
}, Tt = St, Ct = class extends _ {
  constructor(e) {
    super(e), this.cleanup = e.cleanup;
  }
  decode_chain(e) {
    return e.map((t, s) => {
      if (s !== 0) {
        const r = this.config.prefix;
        r && t.startsWith(r) ? t = t.replace(r, "") : t = " " + t;
      }
      return this.cleanup && (t = z(t)), t;
    });
  }
}, Et = Ct, Ft = class extends _ {
  constructor(e) {
    super(e), this.replacement = e.replacement ?? "▁";
  }
  decode_chain(e) {
    const t = [];
    for (let s = 0; s < e.length; ++s) {
      let r = e[s].replaceAll(this.replacement, " ");
      s == 0 && r.startsWith(" ") && (r = r.substring(1)), t.push(r);
    }
    return t;
  }
}, Lt = Ft, Bt = class extends _ {
  constructor(e) {
    super(e), this.suffix = e.suffix ?? "";
  }
  decode_chain(e) {
    return e.map((t, s) => t.replaceAll(this.suffix, s === e.length - 1 ? "" : " "));
  }
}, Dt = Bt, Mt = class extends _ {
  constructor(e) {
    super(e), this.pad_token = e.pad_token ?? "", this.word_delimiter_token = e.word_delimiter_token ?? "", this.cleanup = e.cleanup;
  }
  convert_tokens_to_string(e) {
    if (e.length === 0) return "";
    const t = [e[0]];
    for (let r = 1; r < e.length; ++r) e[r] !== t.at(-1) && t.push(e[r]);
    let s = t.filter((r) => r !== this.pad_token).join("");
    return this.cleanup && (s = z(s).replaceAll(this.word_delimiter_token, " ").trim()), s;
  }
  decode_chain(e) {
    return [this.convert_tokens_to_string(e)];
  }
}, Rt = Mt, $t = class extends _ {
  constructor(e) {
    super(e), this.decoders = (e.decoders ?? []).map((t) => $(t));
  }
  decode_chain(e) {
    return this.decoders.reduce((t, s) => s.decode_chain(t), e);
  }
}, Ot = $t, qt = class extends _ {
  decode_chain(e) {
    const t = v(this.config.pattern), s = this.config.content ?? "";
    return t === null ? e : e.map((r) => r.replaceAll(t, s));
  }
}, Ut = qt, Wt = class extends _ {
  decode_chain(e) {
    return [e.join("")];
  }
}, jt = Wt, Kt = class extends _ {
  constructor(e) {
    super(e), this.content = e.content ?? "", this.start = e.start ?? 0, this.stop = e.stop ?? 0;
  }
  decode_chain(e) {
    return e.map((t) => {
      let s = 0;
      for (let n = 0; n < this.start && t[n] === this.content; ++n) {
        s = n + 1;
        continue;
      }
      let r = t.length;
      for (let n = 0; n < this.stop; ++n) {
        const i = t.length - n - 1;
        if (t[i] === this.content) {
          r = i;
          continue;
        } else break;
      }
      return t.slice(s, r);
    });
  }
}, It = Kt, Gt = class extends _ {
  constructor(e) {
    super(e), this.text_decoder = new TextDecoder();
  }
  decode_chain(e) {
    const t = [];
    let s = [];
    for (const r of e) {
      let n = null;
      if (r.length === 6 && r.startsWith("<0x") && r.endsWith(">")) {
        const i = parseInt(r.slice(3, 5), 16);
        isNaN(i) || (n = i);
      }
      if (n !== null) s.push(n);
      else {
        if (s.length > 0) {
          const i = this.text_decoder.decode(Uint8Array.from(s));
          t.push(i), s = [];
        }
        t.push(r);
      }
    }
    if (s.length > 0) {
      const r = this.text_decoder.decode(Uint8Array.from(s));
      t.push(r), s = [];
    }
    return t;
  }
}, Jt = Gt;
function Qt(e) {
  if (e === null) return null;
  switch (e.type) {
    case "ByteLevel":
      return new Tt(e);
    case "WordPiece":
      return new Et(e);
    case "Metaspace":
      return new Lt(e);
    case "BPEDecoder":
      return new Dt(e);
    case "CTC":
      return new Rt(e);
    case "Sequence":
      return new Ot(e);
    case "Replace":
      return new Ut(e);
    case "Fuse":
      return new jt(e);
    case "Strip":
      return new It(e);
    case "ByteFallback":
      return new Jt(e);
    default:
      throw new Error(`Unknown Decoder type: ${e.type}`);
  }
}
var $ = Qt, Vt = class {
  constructor(e, t) {
    const s = A(e, "Tokenizer", [
      "model",
      "decoder",
      "post_processor",
      "pre_tokenizer",
      "normalizer"
    ]);
    if (s) throw new Error(s);
    const r = A(t, "Config");
    if (r) throw new Error(r);
    this.tokenizer = e, this.config = t, this.normalizer = L(this.tokenizer.normalizer), this.pre_tokenizer = B(this.tokenizer.pre_tokenizer), this.model = pt(this.tokenizer.model, this.config), this.post_processor = R(this.tokenizer.post_processor), this.decoder = $(this.tokenizer.decoder), this.special_tokens = [], this.all_special_ids = [], this.added_tokens = [];
    const n = [], i = [];
    this.added_tokens_map = /* @__PURE__ */ new Map();
    for (const a of this.tokenizer.added_tokens) {
      const o = new W(a);
      if (this.added_tokens.push(o), this.model.tokens_to_ids.set(o.content, o.id), this.model.vocab[o.id] = o.content, o.special && (this.special_tokens.push(o.content), this.all_special_ids.push(o.id)), this.added_tokens_map.set(o.content, o), o.normalized && this.normalizer !== null) {
        const c = this.normalizer(o.content);
        i.push(c), this.added_tokens_map.set(c, o);
      } else n.push(o.content);
    }
    (this.config.additional_special_tokens ?? []).forEach((a) => {
      this.special_tokens.includes(a) || this.special_tokens.push(a);
    }), this.decoder && (this.decoder.added_tokens = this.added_tokens, this.decoder.end_of_word_suffix = this.model.end_of_word_suffix), this.splitter_unnormalized = new x(n), this.splitter_normalized = new x(i), this.remove_space = this.config.remove_space, this.clean_up_tokenization_spaces = this.config.clean_up_tokenization_spaces ?? !0, this.do_lowercase_and_remove_accent = this.config.do_lowercase_and_remove_accent ?? !1;
  }
  encode(e, { text_pair: t = null, add_special_tokens: s = !0, return_token_type_ids: r = null } = {}) {
    const { tokens: n, token_type_ids: i } = this.tokenize_helper(e, {
      text_pair: t,
      add_special_tokens: s
    }), a = n.map((c) => this.added_tokens_map.get(c)?.id ?? this.model.tokens_to_ids.get(c) ?? this.model.unk_token_id), o = {
      ids: a,
      tokens: n,
      attention_mask: new Array(a.length).fill(1)
    };
    return r && i && (o.token_type_ids = i), o;
  }
  decode(e, t = {}) {
    if (!Array.isArray(e) || e.length === 0 || !V(e[0])) throw Error("token_ids must be a non-empty array of integers.");
    let s = e.map((n) => this.model.vocab[Number(n)] ?? this.model.unk_token);
    t.skip_special_tokens && (s = s.filter((n) => !this.special_tokens.includes(n)));
    let r = this.decoder ? this.decoder(s) : s.join(" ");
    return this.decoder && this.decoder.end_of_word_suffix && (r = r.replaceAll(this.decoder.end_of_word_suffix, " "), t.skip_special_tokens && (r = r.trim())), (t.clean_up_tokenization_spaces ?? this.clean_up_tokenization_spaces) && (r = z(r)), r;
  }
  tokenize(e, { text_pair: t = null, add_special_tokens: s = !1 } = {}) {
    return this.tokenize_helper(e, {
      text_pair: t,
      add_special_tokens: s
    }).tokens;
  }
  encode_text(e) {
    if (e === null) return null;
    const t = this.splitter_unnormalized.split(e);
    return t.forEach((s, r) => {
      const n = this.added_tokens_map.get(s);
      n && (n.lstrip && r > 0 && (t[r - 1] = t[r - 1].trimEnd()), n.rstrip && r < t.length - 1 && (t[r + 1] = t[r + 1].trimStart()));
    }), t.flatMap((s, r) => {
      if (s.length === 0) return [];
      if (this.added_tokens_map.has(s)) return [s];
      if (this.remove_space === !0 && (s = s.trim().split(/\s+/).join(" ")), this.do_lowercase_and_remove_accent && (s = Y(s)), this.normalizer !== null && (s = this.normalizer(s)), s.length === 0) return [];
      const n = this.splitter_normalized.split(s);
      return n.forEach((i, a) => {
        const o = this.added_tokens_map.get(i);
        o && (o.lstrip && a > 0 && (n[a - 1] = n[a - 1].trimEnd()), o.rstrip && a < n.length - 1 && (n[a + 1] = n[a + 1].trimStart()));
      }), n.flatMap((i) => {
        if (i.length === 0) return [];
        if (this.added_tokens_map.has(i)) return [i];
        const a = this.pre_tokenizer !== null ? this.pre_tokenizer(i, { section_index: r }) : [i];
        return this.model(a);
      });
    });
  }
  tokenize_helper(e, { text_pair: t = null, add_special_tokens: s = !0 }) {
    const r = this.encode_text(e), n = this.encode_text(t || null);
    return this.post_processor ? this.post_processor(r, n, s) : { tokens: h(r ?? [], n ?? []) };
  }
  token_to_id(e) {
    return this.model.tokens_to_ids.get(e);
  }
  id_to_token(e) {
    return this.model.vocab[e];
  }
  get_added_tokens_decoder() {
    const e = /* @__PURE__ */ new Map();
    for (const t of this.added_tokens) e.set(t.id, t);
    return e;
  }
  get_vocab(e = !0) {
    const t = /* @__PURE__ */ new Map();
    for (let s = 0; s < this.model.vocab.length; ++s) {
      const r = this.model.vocab[s];
      (e || !this.added_tokens_map.has(r)) && t.set(r, s);
    }
    return t;
  }
}, Xt = Vt;
export {
  W as AddedToken,
  C as BPE,
  Dt as BPEDecoder,
  re as BertNormalizer,
  We as BertPreTokenizer,
  zt as BertProcessingPostProcessor,
  Jt as ByteFallbackDecoder,
  Tt as ByteLevelDecoder,
  wt as ByteLevelPostProcessor,
  Ce as ByteLevelPreTokenizer,
  Rt as CTCDecoder,
  _ as Decoder,
  qe as DigitsPreTokenizer,
  Xe as FixedLengthPreTokenizer,
  jt as FuseDecoder,
  xe as LowercaseNormalizer,
  Lt as MetaspaceDecoder,
  Be as MetaspacePreTokenizer,
  w as Model,
  _e as NFCNormalizer,
  pe as NFDNormalizer,
  ke as NFKCNormalizer,
  me as NFKDNormalizer,
  d as Normalizer,
  f as PostProcessor,
  u as PreTokenizer,
  ie as PrecompiledNormalizer,
  Ae as PrependNormalizer,
  $e as PunctuationPreTokenizer,
  Ut as ReplaceDecoder,
  le as ReplaceNormalizer,
  Ke as ReplacePreTokenizer,
  yt as RobertaProcessingPostProcessor,
  Ot as SequenceDecoder,
  ae as SequenceNormalizer,
  Pt as SequencePostProcessor,
  Ge as SequencePreTokenizer,
  Me as SplitPreTokenizer,
  be as StripAccentsNormalizer,
  It as StripDecoder,
  ge as StripNormalizer,
  vt as TemplateProcessingPostProcessor,
  Xt as Tokenizer,
  T as Unigram,
  Fe as WhitespacePreTokenizer,
  Qe as WhitespaceSplitPreTokenizer,
  N as WordPiece,
  Et as WordPieceDecoder
};

//# sourceMappingURL=tokenizers-DZpe9nlx.mjs.map