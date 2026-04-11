const CATALOG_URL =
  "https://mentria-ai.github.io/radio-catalog/catalog.json";

let cache = null;

export async function loadCatalog() {
  if (cache) return cache;
  const res = await fetch(CATALOG_URL);
  if (!res.ok) throw new Error(`Catalog fetch failed: ${res.status}`);
  cache = await res.json();
  return cache;
}

export function getCatalog() {
  return cache;
}

export function invalidateCache() {
  cache = null;
}
