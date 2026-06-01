const locales = require("./locales.js");
const chapters = require("./chapter_list.json");

module.exports = locales.flatMap(locale =>
  chapters.map(chapter => ({ locale, chapter }))
);
