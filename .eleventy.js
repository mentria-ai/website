const { execSync } = require("child_process");
const fs = require("node:fs");
const path = require("node:path");

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

  // {{ "nav.tools" | t }} — uses the page's `lang`, fallback to English.
  eleventyConfig.addFilter("t", function (key) {
    const lang = (this.ctx && this.ctx.lang) || DEFAULT_LANG;
    let str = lookupKey(dictionaries[lang] || {}, key);
    if (str == null) str = lookupKey(dictionaries[DEFAULT_LANG], key);
    if (str == null) {
      console.warn(`[i18n] Missing key: ${key} (lang=${lang})`);
      return key;
    }
    return str;
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

  return {
    dir: {
      input: "src",
      output: "build",  // Output to 'build' to match existing workflow
      includes: "_includes",
      data: "_data"
    }
  };
};

