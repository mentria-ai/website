// Mentria supported locales.
//
// `code` is the canonical IETF language tag — used for routing,
// hreflang, dictionary filenames, and the `<html lang>` attribute.
// `nativeName` is the language's name in itself (for the switcher).
// `pathPrefix` is empty for the default locale (English at site root)
// and `/<code>` for everything else. Templates compose URLs as
// `{{ locale.pathPrefix }}/some/path/`.

const SUPPORTED = [
  { code: "en",    nativeName: "English",        isDefault: true  },
  { code: "es",    nativeName: "Español",        isDefault: false },
  { code: "pt-BR", nativeName: "Português (BR)", isDefault: false },
  { code: "fr",    nativeName: "Français",       isDefault: false },
  { code: "ja",    nativeName: "日本語",          isDefault: false }
];

module.exports = SUPPORTED.map(l => ({
  ...l,
  // URL paths are conventionally lowercase even when the language tag
  // includes a region (pt-BR → /pt-br/). The `code` stays canonically
  // cased for hreflang and `<html lang>` since those ARE case-sensitive.
  pathPrefix: l.isDefault ? "" : `/${l.code.toLowerCase()}`
}));
