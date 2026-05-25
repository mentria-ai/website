const { execSync } = require("child_process");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

module.exports = function(eleventyConfig) {
  // Inject short git commit hash as a global data value for cache busting
  const buildHash = (() => {
    try {
      return execSync("git rev-parse --short HEAD").toString().trim();
    } catch {
      return Date.now().toString(36);
    }
  })();
  eleventyConfig.addGlobalData("buildHash", buildHash);

  const modelsVersion = (() => {
    try {
      const parts = [];
      const walk = (dir) => {
        if (!fs.existsSync(dir)) return;
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, ent.name);
          if (ent.isDirectory()) walk(p);
          else parts.push(path.relative(__dirname, p) + ":" + fs.statSync(p).size);
        }
      };
      walk(path.join(__dirname, "src", "assets", "mentria", "models"));
      walk(path.join(__dirname, "src", "assets", "mentria", "loras"));
      parts.sort();
      return crypto.createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 12);
    } catch {
      return "0";
    }
  })();
  eleventyConfig.addGlobalData("modelsVersion", modelsVersion);

  // ── i18n: load locales + dictionaries once at startup ──────────
  // Layout: src/_data/i18n/<code>.json. Same key tree across all files;
  // missing keys fall back to English.
  const I18N_DIR = path.join(__dirname, "src", "_data", "i18n");
  const DEFAULT_LANG = "en";
  const localesData = require("./src/_data/locales.js");
  const dictionaries = {};
  for (const file of fs.readdirSync(I18N_DIR)) {
    if (!file.endsWith(".json")) continue;
    const code = file.replace(/\.json$/, "");
    dictionaries[code] = JSON.parse(fs.readFileSync(path.join(I18N_DIR, file), "utf8"));
  }
  if (!dictionaries[DEFAULT_LANG]) {
    throw new Error(`Missing default i18n dictionary: src/_data/i18n/${DEFAULT_LANG}.json`);
  }

  function lookupKey(dict, key) {
    return key.split(".").reduce((o, k) => (o == null ? undefined : o[k]), dict);
  }
  function findLocale(code) {
    return localesData.find(l => l.code === code);
  }
  function stripLocalePrefix(url) {
    for (const loc of localesData) {
      if (!loc.pathPrefix) continue;
      if (url === loc.pathPrefix || url === loc.pathPrefix + "/") return "/";
      if (url.startsWith(loc.pathPrefix + "/")) return url.slice(loc.pathPrefix.length);
    }
    return url;
  }

  const I18N_S0 = "\uE000", I18N_S1 = "\uE001", I18N_S2 = "\uE002";

  function tResolve(lang, key) {
    let str = lookupKey(dictionaries[lang] || {}, key);
    if (str == null) str = lookupKey(dictionaries[DEFAULT_LANG], key);
    return str;
  }
  function escAttr(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // {{ "nav.tools" | t }} — uses the page's `lang`, fallback to English.
  // The output is wrapped in invisible sentinels so the build transform can
  // turn every translation into a client-switchable marker.
  eleventyConfig.addFilter("t", function (key) {
    const lang = (this.ctx && this.ctx.lang) || DEFAULT_LANG;
    const str = tResolve(lang, key);
    if (str == null) {
      console.warn(`[i18n] Missing key: ${key} (lang=${lang})`);
      return key;
    }
    return I18N_S0 + key + I18N_S1 + str + I18N_S2;
  });

  eleventyConfig.addFilter("traw", function (key) {
    const lang = (this.ctx && this.ctx.lang) || DEFAULT_LANG;
    const str = tResolve(lang, key);
    return str == null ? key : str;
  });

  eleventyConfig.addFilter("hasKey", function (key) {
    const lang = (this.ctx && this.ctx.lang) || DEFAULT_LANG;
    return tResolve(lang, key) != null;
  });

  eleventyConfig.addShortcode("tvar", function (key, varName, varKey) {
    const lang = (this.ctx && this.ctx.lang) || DEFAULT_LANG;
    const base = tResolve(lang, key);
    const inject = tResolve(lang, varKey);
    const text = String(base == null ? key : base).split("{" + varName + "}").join(inject == null ? varKey : inject);
    return `<i18n-t data-k="${escAttr(key)}" data-vars="${escAttr(varName + "=" + varKey)}">${escAttr(text)}</i18n-t>`;
  });

  eleventyConfig.addShortcode("tbrand", function (key, word, href) {
    const lang = (this.ctx && this.ctx.lang) || DEFAULT_LANG;
    const base = tResolve(lang, key);
    const linked = escAttr(base == null ? key : base).split(word).join(`<a href="${escAttr(href)}">${escAttr(word)}</a>`);
    return `<i18n-t data-k="${escAttr(key)}" data-html data-brand="${escAttr(word)}">${linked}</i18n-t>`;
  });

  // {{ "/tools/" | localeUrl(lang) }} — prefixes path with the locale's
  // pathPrefix, returns it unchanged for the default locale.
  eleventyConfig.addFilter("localeUrl", function (urlPath, lang) {
    const useLang = lang || (this.ctx && this.ctx.lang) || DEFAULT_LANG;
    const loc = findLocale(useLang);
    if (!loc || loc.isDefault) return urlPath;
    if (!urlPath.startsWith("/")) urlPath = "/" + urlPath;
    return loc.pathPrefix + urlPath;
  });

  // {{ page.url | switchLocale("es") }} — returns the equivalent URL in
  // the target locale (used by the language switcher and hreflang tags).
  eleventyConfig.addFilter("switchLocale", function (currentUrl, targetLang) {
    const target = findLocale(targetLang);
    if (!target) return currentUrl;
    const basePath = stripLocalePrefix(currentUrl);
    if (target.isDefault) return basePath;
    return target.pathPrefix + (basePath === "/" ? "/" : basePath);
  });

  // {{ "es" | findLocale }} — returns the locale object for a given code.
  eleventyConfig.addFilter("findLocale", function (code) {
    return findLocale(code);
  });

  eleventyConfig.addNunjucksFilter("startsWith", function(str = "", prefix = "") {
    if (typeof str !== "string") return false;
    return str.startsWith(prefix);
  });

  eleventyConfig.addFilter("head", function(array, n) {
    if (!Array.isArray(array)) return [];
    if (n < 0) {
      return array.slice(n);
    }
    return array.slice(0, n);
  });

  eleventyConfig.addFilter("date", function(dateObj) {
    if (!dateObj) return "";
    try {
      return new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "2-digit",
        year: "numeric"
      }).format(new Date(dateObj));
    } catch (err) {
      return "";
    }
  });

  eleventyConfig.addFilter("year", function() {
    return new Date().getFullYear();
  });

  // Passthrough copy for assets
  eleventyConfig.addPassthroughCopy("src/assets");
  // Passthrough copy for PWA files (sw.js is now a Nunjucks template)
  eleventyConfig.addPassthroughCopy({ "src/manifest.json": "manifest.json" });
  eleventyConfig.addPassthroughCopy({ "src/_data/i18n": "assets/i18n" });

  const PH0 = "\uF000", PH1 = "\uF001";
  const SENT_RE = new RegExp(I18N_S0 + "([^" + I18N_S1 + "]*)" + I18N_S1 + "([\\s\\S]*?)" + I18N_S2, "g");
  const PH_RE = new RegExp(PH0 + "(\\d+)" + PH1, "g");

  function phStrip(s, tokens) {
    return s.replace(PH_RE, (m, i) => tokens[+i].val);
  }
  function phTag(tag, tokens) {
    if (tag.indexOf(PH0) === -1) return tag;
    const ann = [];
    const newTag = tag.replace(/([a-zA-Z_:][\w:.-]*)\s*=\s*"([^"]*)"/g, (m, name, val) => {
      if (val.indexOf(PH0) === -1) return m;
      let firstKey = null;
      const plain = val.replace(PH_RE, (mm, i) => {
        if (firstKey === null) firstKey = tokens[+i].key;
        return tokens[+i].val;
      });
      if (firstKey !== null) ann.push(name.toLowerCase() + "=" + firstKey);
      return name + '="' + plain + '"';
    });
    if (!ann.length) return newTag;
    const attr = ' data-i18na="' + ann.join(";") + '"';
    return /\/>$/.test(newTag) ? newTag.replace(/\/>$/, attr + " />") : newTag.replace(/>$/, attr + ">");
  }
  function phText(html, tokens) {
    return html.replace(PH_RE, (m, i) => {
      const tok = tokens[+i];
      const isHtml = /<[a-z!\/]/i.test(tok.val);
      return '<i18n-t data-k="' + tok.key + '"' + (isHtml ? " data-html" : "") + ">" + tok.val + "</i18n-t>";
    });
  }
  function instrumentBody(body, tokens) {
    body = body.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, (b) => phStrip(b, tokens));
    body = body.replace(/<[a-zA-Z][^>]*>/g, (t) => phTag(t, tokens));
    return phText(body, tokens);
  }
  function instrumentHead(head, tokens) {
    const spec = {};
    head = head.replace(/<title>([\s\S]*?)<\/title>/i, (m, inner) => {
      const mm = inner.match(new RegExp("^([\\s\\S]*?)" + PH0 + "(\\d+)" + PH1 + "([\\s\\S]*)$"));
      if (mm) spec.title = { prefix: phStrip(mm[1], tokens), key: tokens[+mm[2]].key, suffix: phStrip(mm[3], tokens) };
      return "<title>" + phStrip(inner, tokens) + "</title>";
    });
    const dm = head.match(/<meta[^>]+name="description"[^>]*>/i);
    if (dm) {
      const pm = dm[0].match(new RegExp(PH0 + "(\\d+)" + PH1));
      if (pm) spec.desc = { key: tokens[+pm[1]].key };
    }
    head = phStrip(head, tokens);
    return head + '<script type="application/json" id="m-i18n-head">' + JSON.stringify(spec) + "</script>";
  }
  eleventyConfig.addTransform("i18nInstrument", function (content) {
    const op = (this.page && this.page.outputPath) || arguments[1];
    if (!op || typeof op !== "string" || !op.endsWith(".html")) return content;
    if (content.indexOf(I18N_S0) === -1) return content;
    const tokens = [];
    const tokenized = content.replace(SENT_RE, (m, key, val) => {
      const i = tokens.length;
      tokens.push({ key, val });
      return PH0 + i + PH1;
    });
    const headEnd = tokenized.indexOf("</head>");
    if (headEnd === -1) return instrumentBody(tokenized, tokens);
    return instrumentHead(tokenized.slice(0, headEnd), tokens) + instrumentBody(tokenized.slice(headEnd), tokens);
  });

  return {
    dir: {
      input: "src",
      output: "build",  // Output to 'build' to match existing workflow
      includes: "_includes",
      data: "_data"
    }
  };
};

