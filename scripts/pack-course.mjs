import { readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const Packs = require(resolve(here, '../src/assets/js/mentria-packs.js'));

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--'));
const opt = (name) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : undefined; };
if (!dir || !opt('id') || !opt('title')) {
  console.error('usage: node scripts/pack-course.mjs <folder> --id <course-id> --title "<title>" [--subtitle "<text>"] [--cover <url>] [--out <file>]');
  process.exit(2);
}

const folder = resolve(dir);
if (!statSync(folder).isDirectory()) { console.error(`${folder} is not a folder`); process.exit(2); }
const files = readdirSync(folder).filter((f) => /\.json$/i.test(f) && !/mentria-course\.json$/i.test(f)).sort();
if (!files.length) { console.error(`no .json pack files in ${folder}`); process.exit(2); }

const packs = [];
let bad = 0;
for (const f of files) {
  let pack;
  try { pack = JSON.parse(readFileSync(join(folder, f), 'utf8')); }
  catch (e) { console.error(`  ${f}: not JSON (${e.message})`); bad++; continue; }
  if (Packs.isCourse(pack)) { console.error(`  ${f}: is itself a course, skipped`); continue; }
  const v = Packs.validate(pack);
  if (!v.ok) { console.error(`  ${f}: INVALID`); v.errors.forEach((e) => console.error('    error: ' + e)); bad++; continue; }
  v.warnings.forEach((w) => console.error(`  ${f}: warning: ${w}`));
  packs.push({ file: f, pack });
}
if (bad) { console.error(`${bad} file(s) failed validation; nothing written`); process.exit(1); }

packs.sort((a, b) => {
  const ao = typeof a.pack.order === 'number' ? a.pack.order : null;
  const bo = typeof b.pack.order === 'number' ? b.pack.order : null;
  if (ao != null && bo != null && ao !== bo) return ao - bo;
  return a.file.localeCompare(b.file, 'en', { numeric: true });
});

const course = {
  kind: 'course',
  id: opt('id'),
  version: 1,
  title: opt('title'),
  ...(opt('subtitle') ? { subtitle: opt('subtitle') } : {}),
  ...(opt('cover') ? { cover: opt('cover') } : {}),
  packs: packs.map((p, i) => ({ ...p.pack, course: { id: opt('id'), order: i } }))
};
const cv = Packs.validateCourse(course);
if (!cv.ok) { console.error('course invalid:'); cv.errors.forEach((e) => console.error('  ' + e)); process.exit(1); }

const out = resolve(opt('out') || join(folder, `${course.id}.mentria-course.json`));
writeFileSync(out, JSON.stringify(course));
const cards = packs.reduce((n, p) => n + p.pack.cards.length, 0);
console.log(`wrote ${out}`);
console.log(`  ${packs.length} packs, ${cards} cards, ${(statSync(out).size / 1024).toFixed(1)} KB`);
packs.forEach((p, i) => {
  const o = Packs.outline(Packs.normalize(p.pack));
  console.log(`  ${i + 1}. ${Packs.text(p.pack.title, 'en')} (${p.pack.id}) — ${o.cards} cards, ${o.interactive} interactive, ~${o.minutes} min`);
});
