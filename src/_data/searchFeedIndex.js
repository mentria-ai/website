const locales = require("./locales.js");
const deepcuts = require("./deepcuts.json");
const source = require("./source.json");
const stories = require("./stories.json");

function locText(value, code) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  return value[code] || value.en || "";
}

function strongTerms(deck, code) {
  const seen = new Set();
  const re = /<strong>([^<]*)<\/strong>/g;
  for (const slide of deck.slides || []) {
    const body = locText(slide.body, code);
    let m;
    while ((m = re.exec(body)) !== null) {
      const term = m[1].trim();
      if (term) seen.add(term);
    }
  }
  return Array.from(seen).join(" ").slice(0, 280);
}

function deckItem(deck, kind, loc) {
  const captions = (deck.slides || [])
    .map(slide => locText(slide.caption, loc.code))
    .filter(Boolean)
    .join(" ")
    .slice(0, 320);
  return {
    type: "post",
    lang: loc.code,
    slug: deck.id,
    url: `${loc.pathPrefix}/feed/${kind}/${deck.id}/`,
    title: locText(deck.subtitle, loc.code) || deck.title,
    description: captions,
    tldr: strongTerms(deck, loc.code),
    category: kind
  };
}

module.exports = function () {
  const items = [];
  for (const loc of locales) {
    for (const deck of deepcuts) items.push(deckItem(deck, "deepcuts", loc));
    for (const deck of source) items.push(deckItem(deck, "source", loc));
    for (const deck of stories) items.push(deckItem(deck, "story", loc));
  }
  return items;
};
