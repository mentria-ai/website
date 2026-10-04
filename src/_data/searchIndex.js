const fs = require("node:fs");
const path = require("node:path");

const locales = require("./locales.js");
const tools = require("./tools.js");
const extensions = require("./extensions.js");
const chapters = require("./chapter_list.json");

const I18N_DIR = path.join(__dirname, "i18n");
const dicts = {};
for (const loc of locales) {
  const file = path.join(I18N_DIR, `${loc.code}.json`);
  try { dicts[loc.code] = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (_) { dicts[loc.code] = {}; }
}

function lookup(dict, key) {
  return key.split(".").reduce((o, k) => (o == null ? undefined : o[k]), dict);
}

function readPosts() {
  const FEED_DIR = path.join(__dirname, "..", "feed");
  const out = [];
  if (!fs.existsSync(FEED_DIR)) return out;
  for (const file of fs.readdirSync(FEED_DIR)) {
    if (!file.endsWith(".md")) continue;
    const content = fs.readFileSync(path.join(FEED_DIR, file), "utf8");
    const m = content.match(/^---\n([\s\S]*?)\n---/);
    if (!m) continue;
    const front = m[1];
    if (!/tags:[\s\S]*?post/m.test(front)) continue;
    const get = k => {
      const r = front.match(new RegExp(`^${k}:\\s*(.+)$`, "m"));
      return r ? r[1].trim().replace(/^["']|["']$/g, "") : "";
    };
    const slug = file.replace(/\.md$/, "");
    out.push({
      title: get("title"),
      description: get("description"),
      url: get("permalink") || `/feed/${slug}/`,
      slug
    });
  }
  return out;
}

module.exports = function () {
  const byLang = {};
  const posts = readPosts();
  for (const loc of locales) {
    const items = [];
    const t = key => lookup(dicts[loc.code], key) ?? lookup(dicts.en, key) ?? null;
    const tags = keys => Array.from(new Set(keys.map(t).filter(v => typeof v === "string" && v))).join(" ");
    for (const tool of tools) {
      items.push({
        type: "tool",
        lang: loc.code,
        slug: tool.slug,
        url: tool.url || `${loc.pathPrefix}/tools/${tool.slug}/`,
        title: t(`tools.${tool.slug}.title`) || tool.title,
        description: t(`tools.${tool.slug}.lede`) || tool.summary,
        tldr: t(`tools.${tool.slug}.tldr`) || "",
        category: tool.category,
        tags: tags([`category.${tool.category}`, `home.launcher.${String(tool.group || "").toLowerCase()}`]),
        requires: tool.requires
      });
    }
    for (const ext of extensions) {
      const game = ext.schemaCategory === "GameApplication";
      items.push({
        type: "extension",
        lang: loc.code,
        slug: ext.id,
        url: `${loc.pathPrefix}/extensions/${ext.id}/`,
        title: ext.name,
        description: t(`tool.ext_gallery.desc.${ext.id}`) || ext.manifest.description || "",
        tldr: "",
        category: game ? "Game" : "Extension",
        tags: tags(["store.kind", "home.launcher.extensions"].concat(game ? ["category.Game", "home.launcher.games"] : []))
      });
    }
    for (const ch of chapters) {
      items.push({
        type: "chapter",
        lang: loc.code,
        slug: ch.id,
        url: `${loc.pathPrefix}/feed/chapter/${ch.id}/`,
        title: ch.title,
        description: ch.subtitle || "",
        tldr: (ch.concept_tags || []).join(" "),
        category: "chapter"
      });
    }
    for (const post of posts) {
      items.push({
        type: "post",
        lang: loc.code,
        slug: post.slug,
        url: post.url,
        title: post.title,
        description: post.description,
        tldr: "",
        category: "post"
      });
    }
    byLang[loc.code] = items;
  }
  return byLang;
};
