const { execSync } = require("child_process");

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

