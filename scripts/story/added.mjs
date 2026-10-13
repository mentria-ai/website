import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const before = process.argv[2] || '';
let old = [];
if (before && !/^0+$/.test(before)) {
  try { old = JSON.parse(execFileSync('git', ['show', before + ':src/_data/stories.json'], { encoding: 'utf8' })); } catch (_) { old = []; }
}
const seen = new Set(old.map((d) => d.id));
const now = JSON.parse(fs.readFileSync('src/_data/stories.json', 'utf8'));
for (const d of now) if (!seen.has(d.id) && d.cdn_files) console.log(d.id);
