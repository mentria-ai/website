const unlisted = new Set(require('../_data/toolCatalog.json').filter((tool) => tool.held).map((tool) => tool.slug).concat(['extensions-run']));

module.exports = {
  eleventyComputed: {
    eleventyExcludeFromSitemap: (data) => unlisted.has(data.page.fileSlug) || data.eleventyExcludeFromSitemap,
    robots: (data) => (unlisted.has(data.page.fileSlug) ? 'noindex, nofollow' : data.robots)
  }
};
