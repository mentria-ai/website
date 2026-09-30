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

module.exports = locales.flatMap((locale) => packs.map((pack) => ({ locale, pack, next: nextOf[pack.id] || null })));
