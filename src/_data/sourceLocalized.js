const locales = require("./locales.js");
const source = require("./source.json");

module.exports = locales.flatMap(locale =>
  source.map(deck => ({ locale, deck }))
);
