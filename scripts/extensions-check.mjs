import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
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
  const bytes = fs.readFileSync(file);
  const html = bytes.toString('utf8');
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) problems.push(file + ': starts with a byte-order mark, so a saved copy would not match its published hash');
  else if (!Buffer.from(html, 'utf8').equals(bytes)) problems.push(file + ': is not valid UTF-8, so a saved copy would not match its published hash');
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

const memory = new Map();
globalThis.window = {
  MentriaStore: {
    get: (ns, key) => (memory.has(ns + '.' + key) ? JSON.parse(memory.get(ns + '.' + key)) : null),
    set: (ns, key, value) => { memory.set(ns + '.' + key, JSON.stringify(value)); return true; },
    remove: (ns, key) => memory.delete(ns + '.' + key),
    status: () => 'ok'
  }
};
globalThis.isSecureContext = true;
const X = await import(pathToFileURL(path.resolve('src/assets/js/mentria-extensions.js')).href);
const hashes = createRequire(import.meta.url)(path.resolve('src/_data/extensionHashes.js'))();
const sample = Object.keys(hashes)[0];
const rules = [];
const rule = (name, fn) => rules.push([name, fn]);
const reset = () => memory.clear();
const catalogFile = () => {
  const html = fs.readFileSync('src/assets/extensions/' + sample + '.html', 'utf8');
  return { html, manifest: manifestOf(html).manifest, sha256: hashes[sample].sha256 };
};
const registryRow = (id) => X.getRegistry().find((e) => e.manifest.id === id);
const editRow = (id, fn) => {
  const registry = X.getRegistry();
  fn(registry.find((e) => e.manifest.id === id));
  window.MentriaStore.set('ext', 'registry', registry);
};

rule('pasted extension is not verified', async () => {
  const html = '<script type="application/json" id="mentria-ext">{"id":"pasted-one","name":"Pasted","version":"1.0.0","mounts":{"tool":true}}</' + 'script><p>hi</p>';
  const entry = X.install(html, manifestOf(html).manifest);
  if (X.isVerified(entry, undefined)) throw new Error('a pasted file counted as verified');
  if (X.isVerified(await X.checkSource('pasted-one', undefined), undefined)) throw new Error('a pasted file counted as verified after a check');
});
rule('catalog install is verified', async () => {
  const { html, manifest, sha256 } = catalogFile();
  X.install(html, manifest, { sha256 });
  if (!X.isVerified(registryRow(sample), sha256)) throw new Error(sample + ' installed with its published hash is not verified');
  if (!X.isVerified(await X.checkSource(sample, sha256), sha256)) throw new Error(sample + ' lost its verification after a check');
});
rule('catalog install saved before hashes were recorded is verified after a check', async () => {
  const { html, manifest, sha256 } = catalogFile();
  X.install(html, manifest);
  if (X.isVerified(registryRow(sample), sha256)) throw new Error('an install without a hash counted as verified before the check');
  await X.checkSource(sample, sha256);
  if (!X.isVerified(registryRow(sample), sha256)) throw new Error('the check did not record the matching hash');
});
rule('catalog install with a changed file is not verified', async () => {
  const { html, manifest, sha256 } = catalogFile();
  X.install(html, manifest, { sha256 });
  window.MentriaStore.set('ext', 'src.' + sample, html + '<!-- changed -->');
  await X.checkSource(sample, sha256);
  if (X.isVerified(registryRow(sample), sha256)) throw new Error('a changed file kept its verified state');
});
rule('catalog entry with a changed hash is not verified', async () => {
  const { html, manifest, sha256 } = catalogFile();
  X.install(html, manifest, { sha256 });
  editRow(sample, (row) => { row.sha256 = '0'.repeat(64); });
  if (X.isVerified(registryRow(sample), sha256)) throw new Error('a changed hash counted as verified');
});
rule('app extension is verified', async () => {
  const entry = X.installApp({ id: 'app-one', name: 'App', version: '1.0.0', app: '/extensions/app-one/app/' });
  if (!X.isVerified(entry, undefined)) throw new Error('an app extension counted as unverified');
});

let ruleFails = 0;
for (const [name, fn] of rules) {
  reset();
  try {
    await fn();
    console.log('ok   ' + name);
  } catch (e) {
    ruleFails++;
    problems.push('rule "' + name + '": ' + ((e && e.message) || e));
  }
}
console.log(rules.length - ruleFails + '/' + rules.length + ' verification rules passed');

if (!haveBase) console.log('note: ' + base + ' not found, so the version-bump check was skipped');
if (problems.length) {
  console.error(problems.join('\n'));
  console.error(problems.length + ' problem(s) in ' + files.length + ' extension files');
  process.exit(1);
}
console.log(files.length + ' extension files ok' + (haveBase ? ', ' + bumped + ' changed with a version bump since ' + base : ''));
