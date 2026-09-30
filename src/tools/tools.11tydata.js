const held = new Set(require('../_data/toolCatalog.json').filter((tool) => tool.held).map((tool) => tool.slug));

module.exports = {
  eleventyComputed: {
    eleventyExcludeFromSitemap: (data) => held.has(data.page.fileSlug) || data.eleventyExcludeFromSitemap,
    robots: (data) => (held.has(data.page.fileSlug) ? 'noindex, nofollow' : data.robots)
  }
};
