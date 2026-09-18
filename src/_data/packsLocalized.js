const locales = require("./locales.js");
const packs = require("./packs.js");

module.exports = locales.flatMap((locale) => packs.map((pack) => ({ locale, pack })));
