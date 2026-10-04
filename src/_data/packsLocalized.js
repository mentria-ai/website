const locales = require("./locales.js");
const packs = require("./packs.js");

const nextOf = {};
const byCollection = {};
packs.forEach((p) => { (byCollection[p.collection] = byCollection[p.collection] || []).push(p); });
Object.values(byCollection).forEach((list) => {
  list.sort((a, b) => a.order - b.order);
  list.forEach((p, i) => {
    const n = list[i + 1];
    if (n) nextOf[p.id] = { id: n.id, title: n.title, cover: n.cover, cards: n.cards.length, minutes: n.minutes };
  });
});

function pick(v, code) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return v;
  const out = {};
  if (v[code] != null) out[code] = v[code];
  if (v.en != null) out.en = v.en;
  return Object.keys(out).length ? out : v;
}

function forLocale(pack, code) {
  return {
    ...pack,
    title: pick(pack.title, code),
    subtitle: pick(pack.subtitle, code),
    cards: pack.cards.map((c) => {
      const card = { ...c };
      if (c.caption != null) card.caption = pick(c.caption, code);
      if (c.body != null) card.body = pick(c.body, code);
      return card;
    })
  };
}

module.exports = locales.flatMap((locale) => packs.map((pack) => ({ locale, pack: forLocale(pack, locale.code), next: nextOf[pack.id] || null })));
