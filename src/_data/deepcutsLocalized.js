const locales = require("./locales.js");
const deepcuts = require("./deepcuts.json");

module.exports = locales.flatMap(locale =>
  deepcuts.map(edition => ({ locale, edition }))
);
