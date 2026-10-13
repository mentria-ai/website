import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const base = process.argv[2] || process.env.EXT_BASE || 'origin/main';
const MANIFEST = /<script type="application[/]json" id="mentria-ext">([\s\S]*?)<[/]script>/;
const SEMVER = /^[0-9]+[.][0-9]+[.][0-9]+$/;

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
}

function manifestOf(html) {
  const m = MANIFEST.exec(html);
  if (!m) return { error: 'no manifest block' };
  try { return { manifest: JSON.parse(m[1]) }; } catch (e) { return { error: 'manifest is not valid JSON' }; }
}

function newer(a, b) {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

let haveBase = true;
try { git(['rev-parse', '--verify', '--quiet', base + '^{commit}']); } catch (_) { haveBase = false; }
if (!haveBase && process.env.CI) {
  console.error('FAIL: base ref ' + base + ' is missing; fetch it before running this check');
  process.exit(1);
}

const files = git(['ls-files', ':(glob)src/assets/extensions/*.html']).split('\n').filter(Boolean);
const problems = [];
let bumped = 0;
for (const file of files) {
  const id = path.basename(file, '.html');
  const html = fs.readFileSync(file, 'utf8');
  const { manifest, error } = manifestOf(html);
  if (error) { problems.push(file + ': ' + error); continue; }
  if (manifest.id !== id) problems.push(file + ': manifest id "' + manifest.id + '" must equal the file name "' + id + '"');
  if (!SEMVER.test(String(manifest.version || ''))) { problems.push(file + ': version "' + manifest.version + '" must be x.y.z'); continue; }
  if (!haveBase) continue;
  let before = null;
  try { before = git(['show', base + ':' + file]); } catch (_) { continue; }
  if (before === html) continue;
  const prev = manifestOf(before).manifest;
  const prevVersion = prev && SEMVER.test(String(prev.version || '')) ? prev.version : null;
  if (prevVersion && !newer(manifest.version, prevVersion)) problems.push(file + ': changed since ' + base + ' but its version is still ' + manifest.version + ' (was ' + prevVersion + ')');
  else bumped++;
}

if (!haveBase) console.log('note: ' + base + ' not found, so the version-bump check was skipped');
if (problems.length) {
  console.error(problems.join('\n'));
  console.error(problems.length + ' problem(s) in ' + files.length + ' extension files');
  process.exit(1);
}
console.log(files.length + ' extension files ok' + (haveBase ? ', ' + bumped + ' changed with a version bump since ' + base : ''));
