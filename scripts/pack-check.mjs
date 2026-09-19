import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const Packs = require(resolve(here, '../src/assets/js/mentria-packs.js'));

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/pack-check.mjs <pack.json>');
  process.exit(2);
}

let pack;
try {
  pack = JSON.parse(readFileSync(file, 'utf8'));
} catch (e) {
  console.error(`could not read ${file}: ${e.message}`);
  process.exit(2);
}

const result = Packs.validate(pack);
if (!result.ok) {
  console.error(`INVALID ${file}`);
  result.errors.forEach((e) => console.error('  error: ' + e));
  result.warnings.forEach((w) => console.error('  warning: ' + w));
  process.exit(1);
}

const normalized = Packs.normalize(pack);
const outline = Packs.outline(normalized);
console.log(`OK ${Packs.text(pack.title, 'en')} (${pack.id})`);
console.log(`  ${outline.cards} cards, ${outline.interactive} interactive, about ${outline.minutes} min, ${(result.bytes / 1024).toFixed(1)} KB`);
console.log('  types: ' + Object.entries(outline.types).map(([k, v]) => `${k} ${v}`).join(', '));
outline.sections.forEach((s, i) => console.log(`  ${i + 1}. ${s.title} (${s.cards} cards)`));
result.warnings.forEach((w) => console.log('  warning: ' + w));
