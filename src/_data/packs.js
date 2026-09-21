const source = require("./source.json");
const deepcuts = require("./deepcuts.json");
const katex = require("katex");

function eq(tex) {
  if (!tex) return null;
  try {
    const out = katex.renderToString(String(tex), { displayMode: true, throwOnError: false, output: "mathml" });
    const m = out.match(/<math[\s\S]*<\/math>/);
    return m ? m[0] : out;
  } catch (e) {
    return null;
  }
}

function fromSource(deck) {
  const cards = deck.slides.map((s) => {
    const card = { id: s.id, type: "slide", caption: s.caption };
    if (s.body) card.body = s.body;
    if (s.image && s.image_status !== "pending") card.image = s.image;
    const html = eq(s.equation);
    if (html) card.equation_html = html;
    return card;
  });
  return {
    id: "source-" + deck.id,
    version: 1,
    collection: "source",
    order: deck.order,
    title: deck.subtitle,
    subtitle: { en: "Source, deck " + deck.order },
    cover: deck.cover_image || null,
    author: { name: "mentria" },
    language: "en",
    tags: ["ai", "source"],
    minutes: Math.max(2, Math.round(cards.length * 0.7)),
    sections: [{ id: "main", title: "SRC·" + String(deck.order).padStart(2, "0"), cards: cards.map((c) => c.id) }],
    cards
  };
}

function fromDeepCuts(deck) {
  const cards = deck.slides.map((s) => {
    const card = { id: s.id, type: "slide", caption: s.caption };
    if (s.long_press) card.body = s.long_press;
    if (s.image && s.image_status !== "pending") card.image = s.image;
    return card;
  });
  return {
    id: "deepcuts-" + deck.id,
    version: 1,
    collection: "deepcuts",
    order: deck.order,
    title: deck.subtitle,
    subtitle: { en: "Deep Cuts, deck " + deck.order },
    cover: deck.cover_image || null,
    author: { name: "mentria" },
    language: "en",
    tags: ["facts", "deep-cuts"],
    minutes: deck.estimated_minutes || Math.max(2, Math.round(cards.length * 0.5)),
    sections: [{ id: "main", title: "DC·" + String(deck.order).padStart(2, "0"), cards: cards.map((c) => c.id) }],
    cards
  };
}

module.exports = []
  .concat(source.filter((d) => d.status === "published").map(fromSource))
  .concat(deepcuts.map(fromDeepCuts));
