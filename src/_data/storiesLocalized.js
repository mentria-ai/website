const locales = require("./locales.js");
const stories = require("./stories.json");

module.exports = locales.flatMap(locale =>
  stories.map(deck => ({ locale, deck }))
);
