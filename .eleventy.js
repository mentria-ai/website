module.exports = function(eleventyConfig) {
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

  // Passthrough copy for assets
  eleventyConfig.addPassthroughCopy("src/assets");
  // Passthrough copy for PWA files
  eleventyConfig.addPassthroughCopy({ "src/sw.js": "sw.js" });
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

