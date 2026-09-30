const locales = require('./locales.js');
const extensions = require('./extensions.js');

module.exports = locales.flatMap((locale) => extensions.map((ext) => ({ locale, ext })));
