var l = Object.freeze({
  Text: "Text",
  NumericLiteral: "NumericLiteral",
  StringLiteral: "StringLiteral",
  Identifier: "Identifier",
  Equals: "Equals",
  OpenParen: "OpenParen",
  CloseParen: "CloseParen",
  OpenStatement: "OpenStatement",
  CloseStatement: "CloseStatement",
  OpenExpression: "OpenExpression",
  CloseExpression: "CloseExpression",
  OpenSquareBracket: "OpenSquareBracket",
  CloseSquareBracket: "CloseSquareBracket",
  OpenCurlyBracket: "OpenCurlyBracket",
  CloseCurlyBracket: "CloseCurlyBracket",
  Comma: "Comma",
  Dot: "Dot",
  Colon: "Colon",
  Pipe: "Pipe",
  CallOperator: "CallOperator",
  AdditiveBinaryOperator: "AdditiveBinaryOperator",
  MultiplicativeBinaryOperator: "MultiplicativeBinaryOperator",
  ComparisonBinaryOperator: "ComparisonBinaryOperator",
  UnaryOperator: "UnaryOperator",
  Comment: "Comment"
}), M = class {
  constructor(e, n) {
    this.value = e, this.type = n;
  }
};
function le(e) {
  return /\w/.test(e);
}
function D(e) {
  return /[0-9]/.test(e);
}
function oe(e) {
  return /\s/.test(e);
}
var Ce = [
  ["{%", l.OpenStatement],
  ["%}", l.CloseStatement],
  ["{{", l.OpenExpression],
  ["}}", l.CloseExpression],
  ["(", l.OpenParen],
  [")", l.CloseParen],
  ["{", l.OpenCurlyBracket],
  ["}", l.CloseCurlyBracket],
  ["[", l.OpenSquareBracket],
  ["]", l.CloseSquareBracket],
  [",", l.Comma],
  [".", l.Dot],
  [":", l.Colon],
  ["|", l.Pipe],
  ["<=", l.ComparisonBinaryOperator],
  [">=", l.ComparisonBinaryOperator],
  ["==", l.ComparisonBinaryOperator],
  ["!=", l.ComparisonBinaryOperator],
  ["<", l.ComparisonBinaryOperator],
  [">", l.ComparisonBinaryOperator],
  ["+", l.AdditiveBinaryOperator],
  ["-", l.AdditiveBinaryOperator],
  ["~", l.AdditiveBinaryOperator],
  ["*", l.MultiplicativeBinaryOperator],
  ["/", l.MultiplicativeBinaryOperator],
  ["%", l.MultiplicativeBinaryOperator],
  ["=", l.Equals]
], ke = /* @__PURE__ */ new Map([
  ["n", `
`],
  ["t", "	"],
  ["r", "\r"],
  ["b", "\b"],
  ["f", "\f"],
  ["v", "\v"],
  ["'", "'"],
  ['"', '"'],
  ["\\", "\\"]
]);
function $e(e, n = {}) {
  return e.endsWith(`
`) && (e = e.slice(0, -1)), n.lstrip_blocks && (e = e.replace(/^[ \t]*({[#%-])/gm, "$1")), n.trim_blocks && (e = e.replace(/([#%-]})\n/g, "$1")), e.replace(/{%\s*(end)?generation\s*%}/gs, "");
}
function Oe(e, n = {}) {
  const t = [], r = $e(e, n);
  let a = 0, s = 0;
  const i = (c) => {
    let v = "";
    for (; c(r[a]); ) {
      if (r[a] === "\\") {
        if (++a, a >= r.length) throw new SyntaxError("Unexpected end of input");
        const w = r[a++], m = ke.get(w);
        if (m === void 0) throw new SyntaxError(`Unexpected escaped character: ${w}`);
        v += m;
        continue;
      }
      if (v += r[a++], a >= r.length) throw new SyntaxError("Unexpected end of input");
    }
    return v;
  }, f = () => {
    const c = t.at(-1);
    c && c.type === l.Text && (c.value = c.value.trimEnd(), c.value === "" && t.pop());
  }, h = () => {
    for (; a < r.length && oe(r[a]); ) ++a;
  };
  e: for (; a < r.length; ) {
    const c = t.at(-1)?.type;
    if (c === void 0 || c === l.CloseStatement || c === l.CloseExpression || c === l.Comment) {
      let w = "";
      for (; a < r.length && !(r[a] === "{" && (r[a + 1] === "%" || r[a + 1] === "{" || r[a + 1] === "#")); ) w += r[a++];
      if (w.length > 0) {
        t.push(new M(w, l.Text));
        continue;
      }
    }
    if (r[a] === "{" && r[a + 1] === "#") {
      a += 2;
      const w = r[a] === "-";
      w && ++a;
      let m = "";
      for (; r[a] !== "#" || r[a + 1] !== "}"; ) {
        if (a + 2 >= r.length) throw new SyntaxError("Missing end of comment tag");
        m += r[a++];
      }
      const d = m.endsWith("-");
      d && (m = m.slice(0, -1)), w && f(), t.push(new M(m, l.Comment)), a += 2, d && h();
      continue;
    }
    if (r.slice(a, a + 3) === "{%-") {
      f(), t.push(new M("{%", l.OpenStatement)), a += 3;
      continue;
    }
    if (r.slice(a, a + 3) === "{{-") {
      f(), t.push(new M("{{", l.OpenExpression)), s = 0, a += 3;
      continue;
    }
    if (i(oe), r.slice(a, a + 3) === "-%}") {
      t.push(new M("%}", l.CloseStatement)), a += 3, h();
      continue;
    }
    if (r.slice(a, a + 3) === "-}}") {
      t.push(new M("}}", l.CloseExpression)), a += 3, h();
      continue;
    }
    const v = r[a];
    if (v === "-" || v === "+") {
      const w = t.at(-1)?.type;
      if (w === l.Text || w === void 0) throw new SyntaxError(`Unexpected character: ${v}`);
      switch (w) {
        case l.Identifier:
        case l.NumericLiteral:
        case l.StringLiteral:
        case l.CloseParen:
        case l.CloseSquareBracket:
          break;
        default: {
          ++a;
          const m = i(D);
          t.push(new M(`${v}${m}`, m.length > 0 ? l.NumericLiteral : l.UnaryOperator));
          continue;
        }
      }
    }
    for (const [w, m] of Ce)
      if (!(w === "}}" && s > 0) && r.slice(a, a + w.length) === w) {
        t.push(new M(w, m)), m === l.OpenExpression ? s = 0 : m === l.OpenCurlyBracket ? ++s : m === l.CloseCurlyBracket && --s, a += w.length;
        continue e;
      }
    if (v === "'" || v === '"') {
      ++a;
      const w = i((m) => m !== v);
      t.push(new M(w, l.StringLiteral)), ++a;
      continue;
    }
    if (D(v)) {
      let w = i(D);
      if (r[a] === "." && D(r[a + 1])) {
        ++a;
        const m = i(D);
        w = `${w}.${m}`;
      }
      t.push(new M(w, l.NumericLiteral));
      continue;
    }
    if (le(v)) {
      const w = i(le);
      t.push(new M(w, l.Identifier));
      continue;
    }
    throw new SyntaxError(`Unexpected character: ${v}`);
  }
  return t;
}
var j = class {
  type = "Statement";
}, Ae = class extends j {
  constructor(e) {
    super(), this.body = e;
  }
  type = "Program";
}, Ve = class extends j {
  constructor(e, n, t) {
    super(), this.test = e, this.body = n, this.alternate = t;
  }
  type = "If";
}, Be = class extends j {
  constructor(e, n, t, r) {
    super(), this.loopvar = e, this.iterable = n, this.body = t, this.defaultBlock = r;
  }
  type = "For";
}, Ie = class extends j {
  type = "Break";
}, _e = class extends j {
  type = "Continue";
}, Le = class extends j {
  constructor(e, n, t) {
    super(), this.assignee = e, this.value = n, this.body = t;
  }
  type = "Set";
}, Me = class extends j {
  constructor(e, n, t) {
    super(), this.name = e, this.args = n, this.body = t;
  }
  type = "Macro";
}, Te = class extends j {
  constructor(e) {
    super(), this.value = e;
  }
  type = "Comment";
}, _ = class extends j {
  type = "Expression";
}, je = class extends _ {
  constructor(e, n, t) {
    super(), this.object = e, this.property = n, this.computed = t;
  }
  type = "MemberExpression";
}, ue = class extends _ {
  constructor(e, n) {
    super(), this.callee = e, this.args = n;
  }
  type = "CallExpression";
}, R = class extends _ {
  constructor(e) {
    super(), this.value = e;
  }
  type = "Identifier";
}, W = class extends _ {
  constructor(e) {
    super(), this.value = e;
  }
  type = "Literal";
}, Fe = class extends W {
  type = "IntegerLiteral";
}, Ue = class extends W {
  type = "FloatLiteral";
}, ce = class extends W {
  type = "StringLiteral";
}, Ne = class extends W {
  type = "ArrayLiteral";
}, fe = class extends W {
  type = "TupleLiteral";
}, Pe = class extends W {
  type = "ObjectLiteral";
}, J = class extends _ {
  constructor(e, n, t) {
    super(), this.operator = e, this.left = n, this.right = t;
  }
  type = "BinaryExpression";
}, qe = class extends _ {
  constructor(e, n) {
    super(), this.operand = e, this.filter = n;
  }
  type = "FilterExpression";
}, Ke = class extends j {
  constructor(e, n) {
    super(), this.filter = e, this.body = n;
  }
  type = "FilterStatement";
}, Re = class extends _ {
  constructor(e, n) {
    super(), this.lhs = e, this.test = n;
  }
  type = "SelectExpression";
}, We = class extends _ {
  constructor(e, n, t) {
    super(), this.operand = e, this.negate = n, this.test = t;
  }
  type = "TestExpression";
}, ze = class extends _ {
  constructor(e, n) {
    super(), this.operator = e, this.argument = n;
  }
  type = "UnaryExpression";
}, De = class extends _ {
  constructor(e = void 0, n = void 0, t = void 0) {
    super(), this.start = e, this.stop = n, this.step = t;
  }
  type = "SliceExpression";
}, Je = class extends _ {
  constructor(e, n) {
    super(), this.key = e, this.value = n;
  }
  type = "KeywordArgumentExpression";
}, He = class extends _ {
  constructor(e) {
    super(), this.argument = e;
  }
  type = "SpreadExpression";
}, Ye = class extends j {
  constructor(e, n, t) {
    super(), this.call = e, this.callerArgs = n, this.body = t;
  }
  type = "CallStatement";
}, Ge = class extends _ {
  constructor(e, n, t) {
    super(), this.condition = e, this.trueExpr = n, this.falseExpr = t;
  }
  type = "Ternary";
};
function Qe(e) {
  const n = new Ae([]);
  let t = 0;
  function r(o, u) {
    const g = e[t++];
    if (!g || g.type !== o) throw new Error(`Parser Error: ${u}. ${g.type} !== ${o}.`);
    return g;
  }
  function a(o) {
    if (!h(o)) throw new SyntaxError(`Expected ${o}`);
    ++t;
  }
  function s() {
    switch (e[t].type) {
      case l.Comment:
        return new Te(e[t++].value);
      case l.Text:
        return c();
      case l.OpenStatement:
        return v();
      case l.OpenExpression:
        return w();
      default:
        throw new SyntaxError(`Unexpected token type: ${e[t].type}`);
    }
  }
  function i(...o) {
    return t + o.length <= e.length && o.every((u, g) => u === e[t + g].type);
  }
  function f(...o) {
    return e[t]?.type === l.OpenStatement && e[t + 1]?.type === l.Identifier && o.includes(e[t + 1]?.value);
  }
  function h(...o) {
    return t + o.length <= e.length && o.every((u, g) => e[t + g].type === "Identifier" && u === e[t + g].value);
  }
  function c() {
    return new ce(r(l.Text, "Expected text token").value);
  }
  function v() {
    if (r(l.OpenStatement, "Expected opening statement token"), e[t].type !== l.Identifier) throw new SyntaxError(`Unknown statement, got ${e[t].type}`);
    const o = e[t].value;
    let u;
    switch (o) {
      case "set":
        ++t, u = m();
        break;
      case "if":
        ++t, u = d(), r(l.OpenStatement, "Expected {% token"), a("endif"), r(l.CloseStatement, "Expected %} token");
        break;
      case "macro":
        ++t, u = F(), r(l.OpenStatement, "Expected {% token"), a("endmacro"), r(l.CloseStatement, "Expected %} token");
        break;
      case "for":
        ++t, u = L(), r(l.OpenStatement, "Expected {% token"), a("endfor"), r(l.CloseStatement, "Expected %} token");
        break;
      case "call": {
        ++t;
        let g = null;
        i(l.OpenParen) && (g = G());
        const A = P();
        if (A.type !== "Identifier") throw new SyntaxError("Expected identifier following call statement");
        const Se = G();
        r(l.CloseStatement, "Expected closing statement token");
        const ie = [];
        for (; !f("endcall"); ) ie.push(s());
        r(l.OpenStatement, "Expected '{%'"), a("endcall"), r(l.CloseStatement, "Expected closing statement token"), u = new Ye(new ue(A, Se), g, ie);
        break;
      }
      case "break":
        ++t, r(l.CloseStatement, "Expected closing statement token"), u = new Ie();
        break;
      case "continue":
        ++t, r(l.CloseStatement, "Expected closing statement token"), u = new _e();
        break;
      case "filter": {
        ++t;
        let g = P();
        g instanceof R && i(l.OpenParen) && (g = Y(g)), r(l.CloseStatement, "Expected closing statement token");
        const A = [];
        for (; !f("endfilter"); ) A.push(s());
        r(l.OpenStatement, "Expected '{%'"), a("endfilter"), r(l.CloseStatement, "Expected '%}'"), u = new Ke(g, A);
        break;
      }
      default:
        throw new SyntaxError(`Unknown statement type: ${o}`);
    }
    return u;
  }
  function w() {
    r(l.OpenExpression, "Expected opening expression token");
    const o = I();
    return r(l.CloseExpression, "Expected closing expression token"), o;
  }
  function m() {
    const o = U();
    let u = null;
    const g = [];
    if (i(l.Equals))
      ++t, u = U();
    else {
      for (r(l.CloseStatement, "Expected %} token"); !f("endset"); ) g.push(s());
      r(l.OpenStatement, "Expected {% token"), a("endset");
    }
    return r(l.CloseStatement, "Expected closing statement token"), new Le(o, u, g);
  }
  function d() {
    const o = I();
    r(l.CloseStatement, "Expected closing statement token");
    const u = [], g = [];
    for (; !f("elif", "else", "endif"); ) u.push(s());
    if (f("elif")) {
      ++t, ++t;
      const A = d();
      g.push(A);
    } else if (f("else"))
      for (++t, ++t, r(l.CloseStatement, "Expected closing statement token"); !f("endif"); ) g.push(s());
    return new Ve(o, u, g);
  }
  function F() {
    const o = P();
    if (o.type !== "Identifier") throw new SyntaxError("Expected identifier following macro statement");
    const u = G();
    r(l.CloseStatement, "Expected closing statement token");
    const g = [];
    for (; !f("endmacro"); ) g.push(s());
    return new Me(o, u, g);
  }
  function U(o = !1) {
    const u = o ? P : I, g = [u()], A = i(l.Comma);
    for (; A && (++t, g.push(u()), !!i(l.Comma)); )
      ;
    return A ? new fe(g) : g[0];
  }
  function L() {
    const o = U(!0);
    if (!(o instanceof R || o instanceof fe)) throw new SyntaxError(`Expected identifier/tuple for the loop variable, got ${o.type} instead`);
    if (!h("in")) throw new SyntaxError("Expected `in` keyword following loop variable");
    ++t;
    const u = I();
    r(l.CloseStatement, "Expected closing statement token");
    const g = [];
    for (; !f("endfor", "else"); ) g.push(s());
    const A = [];
    if (f("else"))
      for (++t, ++t, r(l.CloseStatement, "Expected closing statement token"); !f("endfor"); ) A.push(s());
    return new Be(o, u, g, A);
  }
  function I() {
    return z();
  }
  function z() {
    const o = ee();
    if (h("if")) {
      ++t;
      const u = ee();
      return h("else") ? (++t, new Ge(u, o, z())) : new Re(o, u);
    }
    return o;
  }
  function ee() {
    let o = te();
    for (; h("or"); ) {
      const u = e[t];
      ++t;
      const g = te();
      o = new J(u, o, g);
    }
    return o;
  }
  function te() {
    let o = X();
    for (; h("and"); ) {
      const u = e[t];
      ++t;
      const g = X();
      o = new J(u, o, g);
    }
    return o;
  }
  function X() {
    let o;
    for (; h("not"); ) {
      const u = e[t];
      ++t, o = new ze(u, X());
    }
    return o ?? me();
  }
  function me() {
    let o = re();
    for (; ; ) {
      let u;
      if (h("not", "in"))
        u = new M("not in", l.Identifier), t += 2;
      else if (h("in")) u = e[t++];
      else if (i(l.ComparisonBinaryOperator)) u = e[t++];
      else break;
      const g = re();
      o = new J(u, o, g);
    }
    return o;
  }
  function re() {
    let o = ae();
    for (; i(l.AdditiveBinaryOperator); ) {
      const u = e[t];
      ++t;
      const g = ae();
      o = new J(u, o, g);
    }
    return o;
  }
  function Ee() {
    const o = ne(P());
    return i(l.OpenParen) ? Y(o) : o;
  }
  function Y(o) {
    let u = new ue(o, G());
    return u = ne(u), i(l.OpenParen) && (u = Y(u)), u;
  }
  function G() {
    r(l.OpenParen, "Expected opening parenthesis for arguments list");
    const o = xe();
    return r(l.CloseParen, "Expected closing parenthesis for arguments list"), o;
  }
  function xe() {
    const o = [];
    for (; !i(l.CloseParen); ) {
      let u;
      if (e[t].type === l.MultiplicativeBinaryOperator && e[t].value === "*")
        ++t, u = new He(I());
      else if (u = I(), i(l.Equals)) {
        if (++t, !(u instanceof R)) throw new SyntaxError("Expected identifier for keyword argument");
        const g = I();
        u = new Je(u, g);
      }
      o.push(u), i(l.Comma) && ++t;
    }
    return o;
  }
  function be() {
    const o = [];
    let u = !1;
    for (; !i(l.CloseSquareBracket); ) i(l.Colon) ? (o.push(void 0), ++t, u = !0) : (o.push(I()), i(l.Colon) && (++t, u = !0));
    if (o.length === 0) throw new SyntaxError("Expected at least one argument for member/slice expression");
    if (u) {
      if (o.length > 3) throw new SyntaxError("Expected 0-3 arguments for slice expression");
      return new De(...o);
    }
    return o[0];
  }
  function ne(o) {
    for (; i(l.Dot) || i(l.OpenSquareBracket); ) {
      const u = e[t];
      ++t;
      let g;
      const A = u.type === l.OpenSquareBracket;
      if (A)
        g = be(), r(l.CloseSquareBracket, "Expected closing square bracket");
      else if (g = P(), g.type !== "Identifier") throw new SyntaxError("Expected identifier following dot operator");
      o = new je(o, g, A);
    }
    return o;
  }
  function ae() {
    let o = se();
    for (; i(l.MultiplicativeBinaryOperator); ) {
      const u = e[t++], g = se();
      o = new J(u, o, g);
    }
    return o;
  }
  function se() {
    let o = de();
    for (; h("is"); ) {
      ++t;
      const u = h("not");
      u && ++t;
      const g = P();
      if (!(g instanceof R)) throw new SyntaxError("Expected identifier for the test");
      o = new We(o, u, g);
    }
    return o;
  }
  function de() {
    let o = Ee();
    for (; i(l.Pipe); ) {
      ++t;
      let u = P();
      if (!(u instanceof R)) throw new SyntaxError("Expected identifier for the filter");
      i(l.OpenParen) && (u = Y(u)), o = new qe(o, u);
    }
    return o;
  }
  function P() {
    const o = e[t++];
    switch (o.type) {
      case l.NumericLiteral: {
        const u = o.value;
        return u.includes(".") ? new Ue(Number(u)) : new Fe(Number(u));
      }
      case l.StringLiteral: {
        let u = o.value;
        for (; i(l.StringLiteral); ) u += e[t++].value;
        return new ce(u);
      }
      case l.Identifier:
        return new R(o.value);
      case l.OpenParen: {
        const u = U();
        return r(l.CloseParen, "Expected closing parenthesis, got ${tokens[current].type} instead."), u;
      }
      case l.OpenSquareBracket: {
        const u = [];
        for (; !i(l.CloseSquareBracket); )
          u.push(I()), i(l.Comma) && ++t;
        return ++t, new Ne(u);
      }
      case l.OpenCurlyBracket: {
        const u = /* @__PURE__ */ new Map();
        for (; !i(l.CloseCurlyBracket); ) {
          const g = I();
          r(l.Colon, "Expected colon between key and value in object literal");
          const A = I();
          u.set(g, A), i(l.Comma) && ++t;
        }
        return ++t, new Pe(u);
      }
      default:
        throw new SyntaxError(`Unexpected token: ${o.type}`);
    }
  }
  for (; t < e.length; ) n.body.push(s());
  return n;
}
function Xe(e, n, t = 1) {
  if (n === void 0 && (n = e, e = 0), t === 0) throw new Error("range() step must not be zero");
  const r = [];
  if (t > 0) for (let a = e; a < n; a += t) r.push(a);
  else for (let a = e; a > n; a += t) r.push(a);
  return r;
}
function pe(e, n, t, r = 1) {
  const a = Math.sign(r);
  a >= 0 ? (n = (n ??= 0) < 0 ? Math.max(e.length + n, 0) : Math.min(n, e.length), t = (t ??= e.length) < 0 ? Math.max(e.length + t, 0) : Math.min(t, e.length)) : (n = (n ??= e.length - 1) < 0 ? Math.max(e.length + n, -1) : Math.min(n, e.length - 1), t = (t ??= -1) < -1 ? Math.max(e.length + t, -1) : Math.min(t, e.length - 1));
  const s = [];
  for (let i = n; a * i < a * t; i += r) s.push(e[i]);
  return s;
}
function Ze(e) {
  return e.replace(/\b\w/g, (n) => n.toUpperCase());
}
function et(e) {
  return tt(/* @__PURE__ */ new Date(), e);
}
function tt(e, n) {
  const t = new Intl.DateTimeFormat(void 0, { month: "long" }), r = new Intl.DateTimeFormat(void 0, { month: "short" }), a = (s) => s < 10 ? "0" + s : s.toString();
  return n.replace(/%[YmdbBHM%]/g, (s) => {
    switch (s) {
      case "%Y":
        return e.getFullYear().toString();
      case "%m":
        return a(e.getMonth() + 1);
      case "%d":
        return a(e.getDate());
      case "%b":
        return r.format(e);
      case "%B":
        return t.format(e);
      case "%H":
        return a(e.getHours());
      case "%M":
        return a(e.getMinutes());
      case "%%":
        return "%";
      default:
        return s;
    }
  });
}
function rt(e) {
  return e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function nt(e, n, t, r) {
  if (r === 0) return e;
  let a = r == null || r < 0 ? 1 / 0 : r;
  const s = n.length === 0 ? /* @__PURE__ */ new RegExp("(?=)", "gu") : new RegExp(rt(n), "gu");
  return e.replaceAll(s, (i) => a > 0 ? (--a, t) : i);
}
var we = class extends Error {
}, he = class extends Error {
}, N = class {
  type = "RuntimeValue";
  value;
  builtins = /* @__PURE__ */ new Map();
  constructor(e = void 0) {
    this.value = e;
  }
  __bool__() {
    return new y(!!this.value);
  }
  toString() {
    return String(this.value);
  }
}, E = class extends N {
  type = "IntegerValue";
}, $ = class extends N {
  type = "FloatValue";
  toString() {
    return this.value % 1 === 0 ? this.value.toFixed(1) : this.value.toString();
  }
}, p = class extends N {
  type = "StringValue";
  builtins = /* @__PURE__ */ new Map([
    ["upper", new C(() => new p(this.value.toUpperCase()))],
    ["lower", new C(() => new p(this.value.toLowerCase()))],
    ["strip", new C(() => new p(this.value.trim()))],
    ["title", new C(() => new p(Ze(this.value)))],
    ["capitalize", new C(() => new p(this.value.charAt(0).toUpperCase() + this.value.slice(1)))],
    ["length", new E(this.value.length)],
    ["rstrip", new C(() => new p(this.value.trimEnd()))],
    ["lstrip", new C(() => new p(this.value.trimStart()))],
    ["startswith", new C((e) => {
      if (e.length === 0) throw new Error("startswith() requires at least one argument");
      const n = e[0];
      if (n instanceof p) return new y(this.value.startsWith(n.value));
      if (n instanceof x) {
        for (const t of n.value) {
          if (!(t instanceof p)) throw new Error("startswith() tuple elements must be strings");
          if (this.value.startsWith(t.value)) return new y(!0);
        }
        return new y(!1);
      }
      throw new Error("startswith() argument must be a string or tuple of strings");
    })],
    ["endswith", new C((e) => {
      if (e.length === 0) throw new Error("endswith() requires at least one argument");
      const n = e[0];
      if (n instanceof p) return new y(this.value.endsWith(n.value));
      if (n instanceof x) {
        for (const t of n.value) {
          if (!(t instanceof p)) throw new Error("endswith() tuple elements must be strings");
          if (this.value.endsWith(t.value)) return new y(!0);
        }
        return new y(!1);
      }
      throw new Error("endswith() argument must be a string or tuple of strings");
    })],
    ["split", new C((e) => {
      const n = e[0] ?? new k();
      if (!(n instanceof p || n instanceof k)) throw new Error("sep argument must be a string or null");
      const t = e[1] ?? new E(-1);
      if (!(t instanceof E)) throw new Error("maxsplit argument must be a number");
      let r = [];
      if (n instanceof k) {
        const a = this.value.trimStart();
        for (const { 0: s, index: i } of a.matchAll(/\S+/g)) {
          if (t.value !== -1 && r.length >= t.value && i !== void 0) {
            r.push(s + a.slice(i + s.length));
            break;
          }
          r.push(s);
        }
      } else {
        if (n.value === "") throw new Error("empty separator");
        r = this.value.split(n.value), t.value !== -1 && r.length > t.value && r.push(r.splice(t.value).join(n.value));
      }
      return new x(r.map((a) => new p(a)));
    })],
    ["replace", new C((e) => {
      if (e.length < 2) throw new Error("replace() requires at least two arguments");
      const n = e[0], t = e[1];
      if (!(n instanceof p && t instanceof p)) throw new Error("replace() arguments must be strings");
      let r;
      if (e.length > 2 ? e[2].type === "KeywordArgumentsValue" ? r = e[2].value.get("count") ?? new k() : r = e[2] : r = new k(), !(r instanceof E || r instanceof k)) throw new Error("replace() count argument must be a number or null");
      return new p(nt(this.value, n.value, t.value, r.value));
    })]
  ]);
}, y = class extends N {
  type = "BooleanValue";
}, at = /[\x7f-\uffff]/g;
function ve(e) {
  return e.replace(at, (n) => "\\u" + n.charCodeAt(0).toString(16).padStart(4, "0"));
}
function K(e, n = {}, t = 0, r = !0) {
  const { indent: a = null, ensureAscii: s = !1, separators: i = null, sortKeys: f = !1 } = n;
  let h, c;
  switch (i ? [h, c] = i : a ? (h = ",", c = ": ") : (h = ", ", c = ": "), e.type) {
    case "NullValue":
      return "null";
    case "UndefinedValue":
      return r ? "null" : "undefined";
    case "IntegerValue":
    case "FloatValue":
    case "BooleanValue":
      return JSON.stringify(e.value);
    case "StringValue": {
      let v = JSON.stringify(e.value);
      return s && (v = ve(v)), v;
    }
    case "ArrayValue":
    case "ObjectValue": {
      const v = a ? " ".repeat(a) : "", w = `
` + v.repeat(t), m = w + v;
      if (e.type === "ArrayValue") {
        const d = e.value.map((F) => K(F, n, t + 1, r));
        return a ? `[${m}${d.join(`${h}${m}`)}${w}]` : `[${d.join(h)}]`;
      } else {
        let d = Array.from(e.value.entries());
        f && (d = d.sort(([U], [L]) => U.localeCompare(L)));
        const F = d.map(([U, L]) => {
          let I = JSON.stringify(U);
          s && (I = ve(I));
          const z = `${I}${c}${K(L, n, t + 1, r)}`;
          return a ? `${m}${z}` : z;
        });
        return a ? `{${F.join(h)}${w}}` : `{${F.join(h)}}`;
      }
    }
    default:
      throw new Error(`Cannot convert to JSON: ${e.type}`);
  }
}
var V = class extends N {
  type = "ObjectValue";
  __bool__() {
    return new y(this.value.size > 0);
  }
  builtins = /* @__PURE__ */ new Map([
    ["get", new C(([e, n]) => {
      if (!(e instanceof p)) throw new Error(`Object key must be a string: got ${e.type}`);
      return this.value.get(e.value) ?? n ?? new k();
    })],
    ["items", new C(() => this.items())],
    ["keys", new C(() => this.keys())],
    ["values", new C(() => this.values())],
    ["dictsort", new C((e) => {
      let n = /* @__PURE__ */ new Map();
      const t = e.filter((i) => i instanceof H ? (n = i.value, !1) : !0), r = t.at(0) ?? n.get("case_sensitive") ?? new y(!1);
      if (!(r instanceof y)) throw new Error("case_sensitive must be a boolean");
      const a = t.at(1) ?? n.get("by") ?? new p("key");
      if (!(a instanceof p)) throw new Error("by must be a string");
      if (!["key", "value"].includes(a.value)) throw new Error("by must be either 'key' or 'value'");
      const s = t.at(2) ?? n.get("reverse") ?? new y(!1);
      if (!(s instanceof y)) throw new Error("reverse must be a boolean");
      return new x(Array.from(this.value.entries()).map(([i, f]) => new x([new p(i), f])).sort((i, f) => {
        const h = a.value === "key" ? 0 : 1, c = i.value[h], v = f.value[h], w = Z(c, v, r.value);
        return s.value ? -w : w;
      }));
    })]
  ]);
  items() {
    return new x(Array.from(this.value.entries()).map(([e, n]) => new x([new p(e), n])));
  }
  keys() {
    return new x(Array.from(this.value.keys()).map((e) => new p(e)));
  }
  values() {
    return new x(Array.from(this.value.values()));
  }
  toString() {
    return K(this, {}, 0, !1);
  }
}, H = class extends V {
  type = "KeywordArgumentsValue";
}, x = class extends N {
  type = "ArrayValue";
  builtins = /* @__PURE__ */ new Map([["length", new E(this.value.length)]]);
  __bool__() {
    return new y(this.value.length > 0);
  }
  toString() {
    return K(this, {}, 0, !1);
  }
}, ge = class extends x {
  type = "TupleValue";
}, C = class extends N {
  type = "FunctionValue";
}, k = class extends N {
  type = "NullValue";
}, S = class extends N {
  type = "UndefinedValue";
}, q = class {
  constructor(e) {
    this.parent = e;
  }
  variables = /* @__PURE__ */ new Map([["namespace", new C((e) => {
    if (e.length === 0) return new V(/* @__PURE__ */ new Map());
    if (e.length !== 1 || !(e[0] instanceof V)) throw new Error("`namespace` expects either zero arguments or a single object argument");
    return e[0];
  })]]);
  tests = /* @__PURE__ */ new Map([
    ["boolean", (e) => e.type === "BooleanValue"],
    ["callable", (e) => e instanceof C],
    ["odd", (e) => {
      if (!(e instanceof E)) throw new Error(`cannot odd on ${e.type}`);
      return e.value % 2 !== 0;
    }],
    ["even", (e) => {
      if (!(e instanceof E)) throw new Error(`cannot even on ${e.type}`);
      return e.value % 2 === 0;
    }],
    ["false", (e) => e.type === "BooleanValue" && !e.value],
    ["true", (e) => e.type === "BooleanValue" && e.value],
    ["none", (e) => e.type === "NullValue"],
    ["string", (e) => e.type === "StringValue"],
    ["number", (e) => e instanceof E || e instanceof $],
    ["integer", (e) => e instanceof E],
    ["iterable", (e) => e.type === "ArrayValue" || e.type === "StringValue"],
    ["mapping", (e) => e instanceof V],
    ["sequence", (e) => e instanceof x || e instanceof V || e instanceof p],
    ["lower", (e) => {
      const n = e.value;
      return e.type === "StringValue" && n === n.toLowerCase();
    }],
    ["upper", (e) => {
      const n = e.value;
      return e.type === "StringValue" && n === n.toUpperCase();
    }],
    ["none", (e) => e.type === "NullValue"],
    ["defined", (e) => e.type !== "UndefinedValue"],
    ["undefined", (e) => e.type === "UndefinedValue"],
    ["equalto", (e, n) => e.value === n.value],
    ["eq", (e, n) => e.value === n.value]
  ]);
  set(e, n) {
    return this.declareVariable(e, Q(n));
  }
  declareVariable(e, n) {
    if (this.variables.has(e)) throw new SyntaxError(`Variable already declared: ${e}`);
    return this.variables.set(e, n), n;
  }
  setVariable(e, n) {
    return this.variables.set(e, n), n;
  }
  resolve(e) {
    if (this.variables.has(e)) return this;
    if (this.parent) return this.parent.resolve(e);
    throw new Error(`Unknown variable: ${e}`);
  }
  lookupVariable(e) {
    try {
      return this.resolve(e).variables.get(e) ?? new S();
    } catch {
      return new S();
    }
  }
};
function st(e) {
  e.set("false", !1), e.set("true", !0), e.set("none", null), e.set("raise_exception", (n) => {
    throw new Error(n);
  }), e.set("range", Xe), e.set("strftime_now", et), e.set("True", !0), e.set("False", !1), e.set("None", null);
}
function ye(e, n) {
  const t = n.split(".");
  let r = e;
  for (const a of t) if (r instanceof V) r = r.value.get(a) ?? new S();
  else if (r instanceof x) {
    const s = parseInt(a, 10);
    if (!isNaN(s) && s >= 0 && s < r.value.length) r = r.value[s];
    else return new S();
  } else return new S();
  return r;
}
function Z(e, n, t = !1) {
  if (e instanceof k && n instanceof k) return 0;
  if (e instanceof k || n instanceof k) throw new Error(`Cannot compare ${e.type} with ${n.type}`);
  if (e instanceof S && n instanceof S) return 0;
  if (e instanceof S || n instanceof S) throw new Error(`Cannot compare ${e.type} with ${n.type}`);
  const r = (s) => s instanceof E || s instanceof $ || s instanceof y, a = (s) => s instanceof y ? s.value ? 1 : 0 : s.value;
  if (r(e) && r(n)) {
    const s = a(e), i = a(n);
    return s < i ? -1 : s > i ? 1 : 0;
  }
  if (e.type !== n.type) throw new Error(`Cannot compare different types: ${e.type} and ${n.type}`);
  if (e.type === "StringValue") {
    let s = e.value, i = n.value;
    return t || (s = s.toLowerCase(), i = i.toLowerCase()), s < i ? -1 : s > i ? 1 : 0;
  } else
    throw new Error(`Cannot compare type: ${e.type}`);
}
var it = class {
  global;
  constructor(e) {
    this.global = e ?? new q();
  }
  run(e) {
    return this.evaluate(e, this.global);
  }
  evaluateBinaryExpression(e, n) {
    const t = this.evaluate(e.left, n);
    switch (e.operator.value) {
      case "and":
        return t.__bool__().value ? this.evaluate(e.right, n) : t;
      case "or":
        return t.__bool__().value ? t : this.evaluate(e.right, n);
    }
    const r = this.evaluate(e.right, n);
    switch (e.operator.value) {
      case "==":
        return new y(t.value == r.value);
      case "!=":
        return new y(t.value != r.value);
    }
    if (t instanceof S || r instanceof S) {
      if (r instanceof S && ["in", "not in"].includes(e.operator.value)) return new y(e.operator.value === "not in");
      throw new Error(`Cannot perform operation ${e.operator.value} on undefined values`);
    } else {
      if (t instanceof k || r instanceof k) throw new Error("Cannot perform operation on null values");
      if (e.operator.value === "~") return new p(t.value.toString() + r.value.toString());
      if ((t instanceof E || t instanceof $) && (r instanceof E || r instanceof $)) {
        const a = t.value, s = r.value;
        switch (e.operator.value) {
          case "+":
          case "-":
          case "*": {
            const i = e.operator.value === "+" ? a + s : e.operator.value === "-" ? a - s : a * s;
            return t instanceof $ || r instanceof $ ? new $(i) : new E(i);
          }
          case "/":
            return new $(a / s);
          case "%": {
            const i = a % s;
            return t instanceof $ || r instanceof $ ? new $(i) : new E(i);
          }
          case "<":
            return new y(a < s);
          case ">":
            return new y(a > s);
          case ">=":
            return new y(a >= s);
          case "<=":
            return new y(a <= s);
        }
      } else if (t instanceof x && r instanceof x) {
        if (e.operator.value === "+")
          return new x(t.value.concat(r.value));
      } else if (r instanceof x) {
        const a = r.value.find((s) => s.value === t.value) !== void 0;
        switch (e.operator.value) {
          case "in":
            return new y(a);
          case "not in":
            return new y(!a);
        }
      }
    }
    if ((t instanceof p || r instanceof p) && e.operator.value === "+") return new p(t.value.toString() + r.value.toString());
    if (t instanceof p && r instanceof p) switch (e.operator.value) {
      case "in":
        return new y(r.value.includes(t.value));
      case "not in":
        return new y(!r.value.includes(t.value));
    }
    if (t instanceof p && r instanceof V) switch (e.operator.value) {
      case "in":
        return new y(r.value.has(t.value));
      case "not in":
        return new y(!r.value.has(t.value));
    }
    throw new SyntaxError(`Unknown operator "${e.operator.value}" between ${t.type} and ${r.type}`);
  }
  evaluateArguments(e, n) {
    const t = [], r = /* @__PURE__ */ new Map();
    for (const a of e) if (a.type === "SpreadExpression") {
      const s = a, i = this.evaluate(s.argument, n);
      if (!(i instanceof x)) throw new Error(`Cannot unpack non-iterable type: ${i.type}`);
      for (const f of i.value) t.push(f);
    } else if (a.type === "KeywordArgumentExpression") {
      const s = a;
      r.set(s.key.value, this.evaluate(s.value, n));
    } else {
      if (r.size > 0) throw new Error("Positional arguments must come before keyword arguments");
      t.push(this.evaluate(a, n));
    }
    return [t, r];
  }
  applyFilter(e, n, t) {
    if (n.type === "Identifier") {
      const r = n;
      if (r.value === "safe") return e;
      if (r.value === "tojson") return new p(K(e, {}));
      if (e instanceof x) switch (r.value) {
        case "list":
          return e;
        case "first":
          return e.value[0];
        case "last":
          return e.value[e.value.length - 1];
        case "length":
          return new E(e.value.length);
        case "reverse":
          return new x(e.value.slice().reverse());
        case "sort":
          return new x(e.value.slice().sort((a, s) => Z(a, s, !1)));
        case "join":
          return new p(e.value.map((a) => a.value).join(""));
        case "string":
          return new p(K(e, {}, 0, !1));
        case "unique": {
          const a = /* @__PURE__ */ new Set(), s = [];
          for (const i of e.value) a.has(i.value) || (a.add(i.value), s.push(i));
          return new x(s);
        }
        default:
          throw new Error(`Unknown ArrayValue filter: ${r.value}`);
      }
      else if (e instanceof p) switch (r.value) {
        case "length":
        case "upper":
        case "lower":
        case "title":
        case "capitalize": {
          const a = e.builtins.get(r.value);
          if (a instanceof C) return a.value([], t);
          if (a instanceof E) return a;
          throw new Error(`Unknown StringValue filter: ${r.value}`);
        }
        case "trim":
          return new p(e.value.trim());
        case "indent":
          return new p(e.value.split(`
`).map((a, s) => s === 0 || a.length === 0 ? a : "    " + a).join(`
`));
        case "join":
        case "string":
          return e;
        case "int": {
          const a = parseInt(e.value, 10);
          return new E(isNaN(a) ? 0 : a);
        }
        case "float": {
          const a = parseFloat(e.value);
          return new $(isNaN(a) ? 0 : a);
        }
        default:
          throw new Error(`Unknown StringValue filter: ${r.value}`);
      }
      else if (e instanceof E || e instanceof $) switch (r.value) {
        case "abs":
          return e instanceof E ? new E(Math.abs(e.value)) : new $(Math.abs(e.value));
        case "int":
          return new E(Math.floor(e.value));
        case "float":
          return new $(e.value);
        case "string":
          return new p(e.toString());
        default:
          throw new Error(`Unknown NumericValue filter: ${r.value}`);
      }
      else if (e instanceof V) switch (r.value) {
        case "items":
          return new x(Array.from(e.value.entries()).map(([a, s]) => new x([new p(a), s])));
        case "length":
          return new E(e.value.size);
        default: {
          const a = e.builtins.get(r.value);
          if (a)
            return a instanceof C ? a.value([], t) : a;
          throw new Error(`Unknown ObjectValue filter: ${r.value}`);
        }
      }
      else if (e instanceof y) switch (r.value) {
        case "bool":
          return new y(e.value);
        case "int":
          return new E(e.value ? 1 : 0);
        case "float":
          return new $(e.value ? 1 : 0);
        case "string":
          return new p(e.value ? "true" : "false");
        default:
          throw new Error(`Unknown BooleanValue filter: ${r.value}`);
      }
      throw new Error(`Cannot apply filter "${r.value}" to type: ${e.type}`);
    } else if (n.type === "CallExpression") {
      const r = n;
      if (r.callee.type !== "Identifier") throw new Error(`Unknown filter: ${r.callee.type}`);
      const a = r.callee.value;
      if (a === "tojson") {
        const [, s] = this.evaluateArguments(r.args, t), i = s.get("indent") ?? new k();
        if (!(i instanceof E || i instanceof k)) throw new Error("If set, indent must be a number");
        const f = s.get("ensure_ascii") ?? new y(!1);
        if (!(f instanceof y)) throw new Error("If set, ensure_ascii must be a boolean");
        const h = s.get("sort_keys") ?? new y(!1);
        if (!(h instanceof y)) throw new Error("If set, sort_keys must be a boolean");
        const c = s.get("separators") ?? new k();
        let v = null;
        if (c instanceof x || c instanceof ge) {
          if (c.value.length !== 2) throw new Error("separators must be a tuple of two strings");
          const [w, m] = c.value;
          if (!(w instanceof p) || !(m instanceof p)) throw new Error("separators must be a tuple of two strings");
          v = [w.value, m.value];
        } else if (!(c instanceof k)) throw new Error("If set, separators must be a tuple of two strings");
        return new p(K(e, {
          indent: i.value,
          ensureAscii: f.value,
          sortKeys: h.value,
          separators: v
        }));
      } else if (a === "join") {
        let s;
        if (e instanceof p) s = Array.from(e.value);
        else if (e instanceof x) s = e.value.map((c) => c.value);
        else throw new Error(`Cannot apply filter "${a}" to type: ${e.type}`);
        const [i, f] = this.evaluateArguments(r.args, t), h = i.at(0) ?? f.get("separator") ?? new p("");
        if (!(h instanceof p)) throw new Error("separator must be a string");
        return new p(s.join(h.value));
      } else if (a === "int" || a === "float") {
        const [s, i] = this.evaluateArguments(r.args, t), f = s.at(0) ?? i.get("default") ?? (a === "int" ? new E(0) : new $(0));
        if (e instanceof p) {
          const h = a === "int" ? parseInt(e.value, 10) : parseFloat(e.value);
          return isNaN(h) ? f : a === "int" ? new E(h) : new $(h);
        } else {
          if (e instanceof E || e instanceof $) return e;
          if (e instanceof y) return a === "int" ? new E(e.value ? 1 : 0) : new $(e.value ? 1 : 0);
          throw new Error(`Cannot apply filter "${a}" to type: ${e.type}`);
        }
      } else if (a === "default") {
        const [s, i] = this.evaluateArguments(r.args, t), f = s[0] ?? new p(""), h = s[1] ?? i.get("boolean") ?? new y(!1);
        if (!(h instanceof y)) throw new Error("`default` filter flag must be a boolean");
        return e instanceof S || h.value && !e.__bool__().value ? f : e;
      }
      if (e instanceof x) {
        switch (a) {
          case "sort": {
            const [s, i] = this.evaluateArguments(r.args, t), f = s.at(0) ?? i.get("reverse") ?? new y(!1);
            if (!(f instanceof y)) throw new Error("reverse must be a boolean");
            const h = s.at(1) ?? i.get("case_sensitive") ?? new y(!1);
            if (!(h instanceof y)) throw new Error("case_sensitive must be a boolean");
            const c = s.at(2) ?? i.get("attribute") ?? new k();
            if (!(c instanceof p || c instanceof E || c instanceof k)) throw new Error("attribute must be a string, integer, or null");
            const v = (w) => c instanceof k ? w : ye(w, c instanceof E ? String(c.value) : c.value);
            return new x(e.value.slice().sort((w, m) => {
              const d = Z(v(w), v(m), h.value);
              return f.value ? -d : d;
            }));
          }
          case "selectattr":
          case "rejectattr": {
            const s = a === "selectattr";
            if (e.value.some((v) => !(v instanceof V))) throw new Error(`\`${a}\` can only be applied to array of objects`);
            if (r.args.some((v) => v.type !== "StringLiteral")) throw new Error(`arguments of \`${a}\` must be strings`);
            const [i, f, h] = r.args.map((v) => this.evaluate(v, t));
            let c;
            if (f) {
              const v = t.tests.get(f.value);
              if (!v) throw new Error(`Unknown test: ${f.value}`);
              c = v;
            } else c = (...v) => v[0].__bool__().value;
            return new x(e.value.filter((v) => {
              const w = v.value.get(i.value), m = w ? c(w, h) : !1;
              return s ? m : !m;
            }));
          }
          case "map": {
            const [, s] = this.evaluateArguments(r.args, t);
            if (s.has("attribute")) {
              const i = s.get("attribute");
              if (!(i instanceof p)) throw new Error("attribute must be a string");
              const f = s.get("default");
              return new x(e.value.map((h) => {
                if (!(h instanceof V)) throw new Error("items in map must be an object");
                const c = ye(h, i.value);
                return c instanceof S ? f ?? new S() : c;
              }));
            } else throw new Error("`map` expressions without `attribute` set are not currently supported.");
          }
        }
        throw new Error(`Unknown ArrayValue filter: ${a}`);
      } else if (e instanceof p) {
        switch (a) {
          case "indent": {
            const [s, i] = this.evaluateArguments(r.args, t), f = s.at(0) ?? i.get("width") ?? new E(4);
            if (!(f instanceof E)) throw new Error("width must be a number");
            const h = s.at(1) ?? i.get("first") ?? new y(!1), c = s.at(2) ?? i.get("blank") ?? new y(!1), v = e.value.split(`
`), w = " ".repeat(f.value);
            return new p(v.map((m, d) => !h.value && d === 0 || !c.value && m.length === 0 ? m : w + m).join(`
`));
          }
          case "replace": {
            const s = e.builtins.get("replace");
            if (!(s instanceof C)) throw new Error("replace filter not available");
            const [i, f] = this.evaluateArguments(r.args, t);
            return s.value([...i, new H(f)], t);
          }
        }
        throw new Error(`Unknown StringValue filter: ${a}`);
      } else if (e instanceof V) {
        const s = e.builtins.get(a);
        if (s && s instanceof C) {
          const [i, f] = this.evaluateArguments(r.args, t);
          return f.size > 0 && i.push(new H(f)), s.value(i, t);
        }
        throw new Error(`Unknown ObjectValue filter: ${a}`);
      } else throw new Error(`Cannot apply filter "${a}" to type: ${e.type}`);
    }
    throw new Error(`Unknown filter: ${n.type}`);
  }
  evaluateFilterExpression(e, n) {
    const t = this.evaluate(e.operand, n);
    return this.applyFilter(t, e.filter, n);
  }
  evaluateTestExpression(e, n) {
    const t = this.evaluate(e.operand, n), r = n.tests.get(e.test.value);
    if (!r) throw new Error(`Unknown test: ${e.test.value}`);
    const a = r(t);
    return new y(e.negate ? !a : a);
  }
  evaluateSelectExpression(e, n) {
    return this.evaluate(e.test, n).__bool__().value ? this.evaluate(e.lhs, n) : new S();
  }
  evaluateUnaryExpression(e, n) {
    const t = this.evaluate(e.argument, n);
    if (e.operator.value === "not")
      return new y(!t.value);
    throw new SyntaxError(`Unknown operator: ${e.operator.value}`);
  }
  evaluateTernaryExpression(e, n) {
    return this.evaluate(e.condition, n).__bool__().value ? this.evaluate(e.trueExpr, n) : this.evaluate(e.falseExpr, n);
  }
  evalProgram(e, n) {
    return this.evaluateBlock(e.body, n);
  }
  evaluateBlock(e, n) {
    let t = "";
    for (const r of e) {
      const a = this.evaluate(r, n);
      a.type !== "NullValue" && a.type !== "UndefinedValue" && (t += a.toString());
    }
    return new p(t);
  }
  evaluateIdentifier(e, n) {
    return n.lookupVariable(e.value);
  }
  evaluateCallExpression(e, n) {
    const [t, r] = this.evaluateArguments(e.args, n);
    r.size > 0 && t.push(new H(r));
    const a = this.evaluate(e.callee, n);
    if (a.type !== "FunctionValue") throw new Error(`Cannot call something that is not a function: got ${a.type}`);
    return a.value(t, n);
  }
  evaluateSliceExpression(e, n, t) {
    if (!(e instanceof x || e instanceof p)) throw new Error("Slice object must be an array or string");
    const r = this.evaluate(n.start, t), a = this.evaluate(n.stop, t), s = this.evaluate(n.step, t);
    if (!(r instanceof E || r instanceof S)) throw new Error("Slice start must be numeric or undefined");
    if (!(a instanceof E || a instanceof S)) throw new Error("Slice stop must be numeric or undefined");
    if (!(s instanceof E || s instanceof S)) throw new Error("Slice step must be numeric or undefined");
    return e instanceof x ? new x(pe(e.value, r.value, a.value, s.value)) : new p(pe(Array.from(e.value), r.value, a.value, s.value).join(""));
  }
  evaluateMemberExpression(e, n) {
    const t = this.evaluate(e.object, n);
    let r;
    if (e.computed) {
      if (e.property.type === "SliceExpression") return this.evaluateSliceExpression(t, e.property, n);
      r = this.evaluate(e.property, n);
    } else r = new p(e.property.value);
    let a;
    if (t instanceof V) {
      if (!(r instanceof p)) throw new Error(`Cannot access property with non-string: got ${r.type}`);
      a = t.value.get(r.value) ?? t.builtins.get(r.value);
    } else if (t instanceof x || t instanceof p) if (r instanceof E)
      a = t.value.at(r.value), t instanceof p && (a = new p(t.value.at(r.value)));
    else if (r instanceof p) a = t.builtins.get(r.value);
    else throw new Error(`Cannot access property with non-string/non-number: got ${r.type}`);
    else {
      if (!(r instanceof p)) throw new Error(`Cannot access property with non-string: got ${r.type}`);
      a = t.builtins.get(r.value);
    }
    return a instanceof N ? a : new S();
  }
  evaluateSet(e, n) {
    const t = e.value ? this.evaluate(e.value, n) : this.evaluateBlock(e.body, n);
    if (e.assignee.type === "Identifier") {
      const r = e.assignee.value;
      n.setVariable(r, t);
    } else if (e.assignee.type === "TupleLiteral") {
      const r = e.assignee;
      if (!(t instanceof x)) throw new Error(`Cannot unpack non-iterable type in set: ${t.type}`);
      const a = t.value;
      if (a.length !== r.value.length) throw new Error(`Too ${r.value.length > a.length ? "few" : "many"} items to unpack in set`);
      for (let s = 0; s < r.value.length; ++s) {
        const i = r.value[s];
        if (i.type !== "Identifier") throw new Error(`Cannot unpack to non-identifier in set: ${i.type}`);
        n.setVariable(i.value, a[s]);
      }
    } else if (e.assignee.type === "MemberExpression") {
      const r = e.assignee, a = this.evaluate(r.object, n);
      if (!(a instanceof V)) throw new Error("Cannot assign to member of non-object");
      if (r.property.type !== "Identifier") throw new Error("Cannot assign to member with non-identifier property");
      a.value.set(r.property.value, t);
    } else throw new Error(`Invalid LHS inside assignment expression: ${JSON.stringify(e.assignee)}`);
    return new k();
  }
  evaluateIf(e, n) {
    const t = this.evaluate(e.test, n);
    return this.evaluateBlock(t.__bool__().value ? e.body : e.alternate, n);
  }
  evaluateFor(e, n) {
    const t = new q(n);
    let r, a;
    if (e.iterable.type === "SelectExpression") {
      const c = e.iterable;
      a = this.evaluate(c.lhs, t), r = c.test;
    } else a = this.evaluate(e.iterable, t);
    if (!(a instanceof x || a instanceof V)) throw new Error(`Expected iterable or object type in for loop: got ${a.type}`);
    a instanceof V && (a = a.keys());
    const s = [], i = [];
    for (let c = 0; c < a.value.length; ++c) {
      const v = new q(t), w = a.value[c];
      let m;
      if (e.loopvar.type === "Identifier") m = (d) => d.setVariable(e.loopvar.value, w);
      else if (e.loopvar.type === "TupleLiteral") {
        const d = e.loopvar;
        if (w.type !== "ArrayValue") throw new Error(`Cannot unpack non-iterable type: ${w.type}`);
        const F = w;
        if (d.value.length !== F.value.length) throw new Error(`Too ${d.value.length > F.value.length ? "few" : "many"} items to unpack`);
        m = (U) => {
          for (let L = 0; L < d.value.length; ++L) {
            if (d.value[L].type !== "Identifier") throw new Error(`Cannot unpack non-identifier type: ${d.value[L].type}`);
            U.setVariable(d.value[L].value, F.value[L]);
          }
        };
      } else throw new Error(`Invalid loop variable(s): ${e.loopvar.type}`);
      r && (m(v), !this.evaluate(r, v).__bool__().value) || (s.push(w), i.push(m));
    }
    let f = "", h = !0;
    for (let c = 0; c < s.length; ++c) {
      const v = /* @__PURE__ */ new Map([
        ["index", new E(c + 1)],
        ["index0", new E(c)],
        ["revindex", new E(s.length - c)],
        ["revindex0", new E(s.length - c - 1)],
        ["first", new y(c === 0)],
        ["last", new y(c === s.length - 1)],
        ["length", new E(s.length)],
        ["previtem", c > 0 ? s[c - 1] : new S()],
        ["nextitem", c < s.length - 1 ? s[c + 1] : new S()]
      ]);
      t.setVariable("loop", new V(v)), i[c](t);
      try {
        const w = this.evaluateBlock(e.body, t);
        f += w.value;
      } catch (w) {
        if (w instanceof he) continue;
        if (w instanceof we) break;
        throw w;
      }
      h = !1;
    }
    if (h) {
      const c = this.evaluateBlock(e.defaultBlock, t);
      f += c.value;
    }
    return new p(f);
  }
  evaluateMacro(e, n) {
    return n.setVariable(e.name.value, new C((t, r) => {
      const a = new q(r);
      t = t.slice();
      let s;
      t.at(-1)?.type === "KeywordArgumentsValue" && (s = t.pop());
      for (let i = 0; i < e.args.length; ++i) {
        const f = e.args[i], h = t[i];
        if (f.type === "Identifier") {
          const c = f;
          if (!h) throw new Error(`Missing positional argument: ${c.value}`);
          a.setVariable(c.value, h);
        } else if (f.type === "KeywordArgumentExpression") {
          const c = f, v = h ?? s?.value.get(c.key.value) ?? this.evaluate(c.value, a);
          a.setVariable(c.key.value, v);
        } else throw new Error(`Unknown argument type: ${f.type}`);
      }
      return this.evaluateBlock(e.body, a);
    })), new k();
  }
  evaluateCallStatement(e, n) {
    const t = new C((f, h) => {
      const c = new q(h);
      if (e.callerArgs) for (let v = 0; v < e.callerArgs.length; ++v) {
        const w = e.callerArgs[v];
        if (w.type !== "Identifier") throw new Error(`Caller parameter must be an identifier, got ${w.type}`);
        c.setVariable(w.value, f[v] ?? new S());
      }
      return this.evaluateBlock(e.body, c);
    }), [r, a] = this.evaluateArguments(e.call.args, n);
    r.push(new H(a));
    const s = this.evaluate(e.call.callee, n);
    if (s.type !== "FunctionValue") throw new Error(`Cannot call something that is not a function: got ${s.type}`);
    const i = new q(n);
    return i.setVariable("caller", t), s.value(r, i);
  }
  evaluateFilterStatement(e, n) {
    const t = this.evaluateBlock(e.body, n);
    return this.applyFilter(t, e.filter, n);
  }
  evaluate(e, n) {
    if (!e) return new S();
    switch (e.type) {
      case "Program":
        return this.evalProgram(e, n);
      case "Set":
        return this.evaluateSet(e, n);
      case "If":
        return this.evaluateIf(e, n);
      case "For":
        return this.evaluateFor(e, n);
      case "Macro":
        return this.evaluateMacro(e, n);
      case "CallStatement":
        return this.evaluateCallStatement(e, n);
      case "Break":
        throw new we();
      case "Continue":
        throw new he();
      case "IntegerLiteral":
        return new E(e.value);
      case "FloatLiteral":
        return new $(e.value);
      case "StringLiteral":
        return new p(e.value);
      case "ArrayLiteral":
        return new x(e.value.map((t) => this.evaluate(t, n)));
      case "TupleLiteral":
        return new ge(e.value.map((t) => this.evaluate(t, n)));
      case "ObjectLiteral": {
        const t = /* @__PURE__ */ new Map();
        for (const [r, a] of e.value) {
          const s = this.evaluate(r, n);
          if (!(s instanceof p)) throw new Error(`Object keys must be strings: got ${s.type}`);
          t.set(s.value, this.evaluate(a, n));
        }
        return new V(t);
      }
      case "Identifier":
        return this.evaluateIdentifier(e, n);
      case "CallExpression":
        return this.evaluateCallExpression(e, n);
      case "MemberExpression":
        return this.evaluateMemberExpression(e, n);
      case "UnaryExpression":
        return this.evaluateUnaryExpression(e, n);
      case "BinaryExpression":
        return this.evaluateBinaryExpression(e, n);
      case "FilterExpression":
        return this.evaluateFilterExpression(e, n);
      case "FilterStatement":
        return this.evaluateFilterStatement(e, n);
      case "TestExpression":
        return this.evaluateTestExpression(e, n);
      case "SelectExpression":
        return this.evaluateSelectExpression(e, n);
      case "Ternary":
        return this.evaluateTernaryExpression(e, n);
      case "Comment":
        return new k();
      default:
        throw new SyntaxError(`Unknown node type: ${e.type}`);
    }
  }
};
function Q(e) {
  switch (typeof e) {
    case "number":
      return Number.isInteger(e) ? new E(e) : new $(e);
    case "string":
      return new p(e);
    case "boolean":
      return new y(e);
    case "undefined":
      return new S();
    case "object":
      return e === null ? new k() : Array.isArray(e) ? new x(e.map(Q)) : new V(new Map(Object.entries(e).map(([n, t]) => [n, Q(t)])));
    case "function":
      return new C((n, t) => Q(e(...n.map((r) => r.value)) ?? null));
    default:
      throw new Error(`Cannot convert to runtime value: ${e}`);
  }
}
var O = `
`, lt = "{%- ", ot = " -%}";
function ut(e) {
  switch (e.operator.type) {
    case "MultiplicativeBinaryOperator":
      return 4;
    case "AdditiveBinaryOperator":
      return 3;
    case "ComparisonBinaryOperator":
      return 2;
    case "Identifier":
      return e.operator.value === "and" ? 1 : e.operator.value === "in" || e.operator.value === "not in" ? 2 : 0;
  }
  return 0;
}
function ct(e, n = "	") {
  const t = typeof n == "number" ? " ".repeat(n) : n;
  return T(e.body, 0, t).replace(/\n$/, "");
}
function B(...e) {
  return lt + e.join(" ") + ot;
}
function T(e, n, t) {
  return e.map((r) => ft(r, n, t)).join(O);
}
function ft(e, n, t) {
  const r = t.repeat(n);
  switch (e.type) {
    case "Program":
      return T(e.body, n, t);
    case "If":
      return pt(e, n, t);
    case "For":
      return wt(e, n, t);
    case "Set":
      return ht(e, n, t);
    case "Macro":
      return vt(e, n, t);
    case "Break":
      return r + B("break");
    case "Continue":
      return r + B("continue");
    case "CallStatement":
      return gt(e, n, t);
    case "FilterStatement":
      return yt(e, n, t);
    case "Comment":
      return r + "{# " + e.value + " #}";
    default:
      return r + "{{- " + b(e) + " -}}";
  }
}
function pt(e, n, t) {
  const r = t.repeat(n), a = [];
  let s = e;
  for (; s && (a.push({
    test: s.test,
    body: s.body
  }), s.alternate.length === 1 && s.alternate[0].type === "If"); )
    s = s.alternate[0];
  let i = r + B("if", b(a[0].test)) + O + T(a[0].body, n + 1, t);
  for (let f = 1; f < a.length; ++f) i += O + r + B("elif", b(a[f].test)) + O + T(a[f].body, n + 1, t);
  return s && s.alternate.length > 0 && (i += O + r + B("else") + O + T(s.alternate, n + 1, t)), i += O + r + B("endif"), i;
}
function wt(e, n, t) {
  const r = t.repeat(n);
  let a = "";
  if (e.iterable.type === "SelectExpression") {
    const i = e.iterable;
    a = `${b(i.lhs)} if ${b(i.test)}`;
  } else a = b(e.iterable);
  let s = r + B("for", b(e.loopvar), "in", a) + O + T(e.body, n + 1, t);
  return e.defaultBlock.length > 0 && (s += O + r + B("else") + O + T(e.defaultBlock, n + 1, t)), s += O + r + B("endfor"), s;
}
function ht(e, n, t) {
  const r = t.repeat(n), a = b(e.assignee), s = e.value ? b(e.value) : "", i = r + B("set", `${a}${e.value ? " = " + s : ""}`);
  return e.body.length === 0 ? i : i + O + T(e.body, n + 1, t) + O + r + B("endset");
}
function vt(e, n, t) {
  const r = t.repeat(n), a = e.args.map(b).join(", ");
  return r + B("macro", `${e.name.value}(${a})`) + O + T(e.body, n + 1, t) + O + r + B("endmacro");
}
function gt(e, n, t) {
  const r = t.repeat(n), a = e.callerArgs && e.callerArgs.length > 0 ? `(${e.callerArgs.map(b).join(", ")})` : "", s = b(e.call);
  let i = r + B(`call${a}`, s) + O;
  return i += T(e.body, n + 1, t) + O, i += r + B("endcall"), i;
}
function yt(e, n, t) {
  const r = t.repeat(n);
  let a = r + B("filter", e.filter.type === "Identifier" ? e.filter.value : b(e.filter)) + O;
  return a += T(e.body, n + 1, t) + O, a += r + B("endfilter"), a;
}
function b(e, n = -1) {
  switch (e.type) {
    case "SpreadExpression":
      return `*${b(e.argument)}`;
    case "Identifier":
      return e.value;
    case "IntegerLiteral":
      return `${e.value}`;
    case "FloatLiteral":
      return `${e.value}`;
    case "StringLiteral":
      return JSON.stringify(e.value);
    case "BinaryExpression": {
      const t = e, r = ut(t), a = b(t.left, r), s = b(t.right, r + 1), i = `${a} ${t.operator.value} ${s}`;
      return r < n ? `(${i})` : i;
    }
    case "UnaryExpression": {
      const t = e;
      return t.operator.value + (t.operator.value === "not" ? " " : "") + b(t.argument, 1 / 0);
    }
    case "CallExpression": {
      const t = e, r = t.args.map(b).join(", ");
      return `${b(t.callee)}(${r})`;
    }
    case "MemberExpression": {
      const t = e;
      let r = b(t.object);
      [
        "Identifier",
        "MemberExpression",
        "CallExpression",
        "StringLiteral",
        "IntegerLiteral",
        "FloatLiteral",
        "ArrayLiteral",
        "TupleLiteral",
        "ObjectLiteral"
      ].includes(t.object.type) || (r = `(${r})`);
      let a = b(t.property);
      return !t.computed && t.property.type !== "Identifier" && (a = `(${a})`), t.computed ? `${r}[${a}]` : `${r}.${a}`;
    }
    case "FilterExpression": {
      const t = e, r = b(t.operand, 1 / 0);
      return t.filter.type === "CallExpression" ? `${r} | ${b(t.filter)}` : `${r} | ${t.filter.value}`;
    }
    case "SelectExpression": {
      const t = e;
      return `${b(t.lhs)} if ${b(t.test)}`;
    }
    case "TestExpression": {
      const t = e;
      return `${b(t.operand)} is${t.negate ? " not" : ""} ${t.test.value}`;
    }
    case "ArrayLiteral":
    case "TupleLiteral": {
      const t = e.value.map(b), r = e.type === "ArrayLiteral" ? "[]" : "()";
      return `${r[0]}${t.join(", ")}${r[1]}`;
    }
    case "ObjectLiteral":
      return `{${Array.from(e.value.entries()).map(([t, r]) => `${b(t)}: ${b(r)}`).join(", ")}}`;
    case "SliceExpression": {
      const t = e;
      return `${t.start ? b(t.start) : ""}:${t.stop ? b(t.stop) : ""}${t.step ? `:${b(t.step)}` : ""}`;
    }
    case "KeywordArgumentExpression": {
      const t = e;
      return `${t.key.value}=${b(t.value)}`;
    }
    case "Ternary": {
      const t = e, r = `${b(t.trueExpr)} if ${b(t.condition, 0)} else ${b(t.falseExpr)}`;
      return n > -1 ? `(${r})` : r;
    }
    default:
      throw new Error(`Unknown expression type: ${e.type}`);
  }
}
var mt = class {
  parsed;
  constructor(e) {
    const n = Oe(e, {
      lstrip_blocks: !0,
      trim_blocks: !0
    });
    this.parsed = Qe(n);
  }
  render(e) {
    const n = new q();
    if (st(n), e) for (const [t, r] of Object.entries(e)) n.set(t, r);
    return new it(n).run(this.parsed).value;
  }
  format(e) {
    return ct(this.parsed, e?.indent || "	");
  }
};
export {
  q as Environment,
  it as Interpreter,
  mt as Template,
  Qe as parse,
  Oe as tokenize
};

//# sourceMappingURL=dist-Dbf1uG80.mjs.map