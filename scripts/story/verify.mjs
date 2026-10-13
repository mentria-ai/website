import fs from 'node:fs';
import path from 'node:path';
import { checkFiles } from './lib.mjs';

const [id, dir] = process.argv.slice(2);
const stories = JSON.parse(fs.readFileSync('src/_data/stories.json', 'utf8'));
const entry = stories.find((d) => d.id === id);
if (!entry) { console.error('FAIL: no story ' + id + ' in src/_data/stories.json'); process.exit(1); }
const files = {};
for (const name of fs.readdirSync(dir)) files[name] = fs.readFileSync(path.join(dir, name));
const problems = checkFiles(entry, files);
if (problems.length) { console.error('FAIL: ' + id + '\n' + problems.join('\n')); process.exit(1); }
console.log('verified', id, Object.keys(files).length, 'files');
