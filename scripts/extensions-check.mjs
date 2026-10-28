import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const base = process.argv[2] || process.env.EXT_BASE || 'origin/main';
const MANIFEST = /<script type="application[/]json" id="mentria-ext">([\s\S]*?)<[/]script>/;
const SEMVER = /^[0-9]+[.][0-9]+[.][0-9]+$/;
const HEX = /^[0-9a-f]{64}$/;
const HISTORY_FILE = 'src/_data/extensionHashHistory.json';

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
}

function gitBytes(args) {
  return execFileSync('git', args, { maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function readHistory() {
  if (!fs.existsSync(HISTORY_FILE)) return { history: {}, error: HISTORY_FILE + ': is missing' };
  try { return { history: JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')) }; } catch (_) { return { history: {}, error: HISTORY_FILE + ': is not valid JSON' }; }
}

function historyShapeProblems(history, ids) {
  if (!history || typeof history !== 'object' || Array.isArray(history)) return [HISTORY_FILE + ': must be an object that maps an extension id to a list of hashes'];
  const out = [];
  for (const [id, list] of Object.entries(history)) {
    if (!ids.has(id)) out.push(HISTORY_FILE + ': "' + id + '" is not a single-file extension in src/_data/extensionCatalog.json; if it was removed, mark it retired in src/_data/extensionCatalog.json instead of deleting it, so copies people already installed stay verified');
    if (!Array.isArray(list) || !list.length || list.some((h) => typeof h !== 'string' || !HEX.test(h))) out.push(HISTORY_FILE + ': "' + id + '" must be a non-empty list of 64-character lowercase hex hashes');
    else if (new Set(list).size !== list.length) out.push(HISTORY_FILE + ': "' + id + '" lists the same hash twice');
  }
  return out;
}

function historyProblem(file, id, before, now, history, ref) {
  if (!before || (now && before.equals(now))) return null;
  const was = sha256(before);
  const list = Object.prototype.hasOwnProperty.call(history, id) && Array.isArray(history[id]) ? history[id] : null;
  if (list && list.includes(was)) return null;
  const why = file + ': ' + (now ? 'changed' : 'removed') + ' since ' + ref + ', so copies installed from the ' + ref + ' file need its hash in ' + HISTORY_FILE + ' to stay verified; ';
  if (list && list.length) return why + 'add this line right under "' + id + '": [\n    "' + was + '",';
  if (list) return why + 'replace "' + id + '": [] with this line:\n  "' + id + '": ["' + was + '"],';
  return why + 'add this line right under the opening {:\n  "' + id + '": ["' + was + '"],';
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
const singleFileIds = new Set(JSON.parse(fs.readFileSync('src/_data/extensionCatalog.json', 'utf8')).filter((e) => typeof e.app !== 'string').map((e) => e.id));
const { history, error: historyError } = readHistory();
if (historyError) problems.push(historyError);
else problems.push(...historyShapeProblems(history, singleFileIds));
const baseBytes = (file) => {
  if (!haveBase) return null;
  try { return gitBytes(['show', base + ':' + file]); } catch (_) { return null; }
};
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
  const beforeBytes = baseBytes(file);
  if (!beforeBytes) continue;
  if (singleFileIds.has(id)) {
    const missing = historyProblem(file, id, beforeBytes, bytes, history, base);
    if (missing) problems.push(missing);
  }
  const before = beforeBytes.toString('utf8');
  if (before === html) continue;
  const prev = manifestOf(before).manifest;
  const prevVersion = prev && SEMVER.test(String(prev.version || '')) ? prev.version : null;
  if (prevVersion && !newer(manifest.version, prevVersion)) problems.push(file + ': changed since ' + base + ' but its version is still ' + manifest.version + ' (was ' + prevVersion + ')');
  else bumped++;
}

for (const id of singleFileIds) {
  const file = 'src/assets/extensions/' + id + '.html';
  if (files.includes(file)) continue;
  const missing = historyProblem(file, id, baseBytes(file), null, history, base);
  if (missing) problems.push(missing);
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
const olderFile = () => {
  const html = catalogFile().html + '<!-- an earlier published version -->';
  return { html, sha256: sha256(Buffer.from(html, 'utf8')) };
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
rule('older catalog install is verified', async () => {
  const { manifest, sha256: current } = catalogFile();
  const older = olderFile();
  X.install(older.html, manifest, { sha256: older.sha256 });
  const known = [current, older.sha256];
  if (!X.isVerified(registryRow(sample), known)) throw new Error('an install of an earlier published file is not verified');
  if (!X.isVerified(await X.checkSource(sample, known), known)) throw new Error('an earlier published file lost its verification after a check');
  if (X.isVerified(registryRow(sample), current)) throw new Error('an earlier hash counted as verified without its history');
});
rule('older catalog install saved before hashes were recorded is verified after a check', async () => {
  const { manifest, sha256: current } = catalogFile();
  const older = olderFile();
  X.install(older.html, manifest);
  const known = [current, older.sha256];
  await X.checkSource(sample, known);
  if (!X.isVerified(registryRow(sample), known)) throw new Error('the check did not record the earlier published hash');
});
rule('retired catalog id is verified by its history alone', async () => {
  const html = '<script type="application/json" id="mentria-ext">{"id":"retired-one","name":"Retired","version":"1.0.0","mounts":{"tool":true}}</' + 'script><p>old</p>';
  X.install(html, manifestOf(html).manifest);
  const known = [sha256(Buffer.from(html, 'utf8'))];
  await X.checkSource('retired-one', known);
  if (!X.isVerified(registryRow('retired-one'), known)) throw new Error('a retired id matching its history is not verified');
  if (X.isVerified(registryRow('retired-one'), [])) throw new Error('a retired id with no known hashes counted as verified');
});
rule('changed file passes when its main hash is listed', () => {
  const before = Buffer.from('<p>v1</p>');
  if (historyProblem('a.html', 'a', before, Buffer.from('<p>v2</p>'), { a: [sha256(before)] }, 'main') !== null) throw new Error('a listed hash was reported missing');
});
rule('changed file fails and names the line to add', () => {
  const before = Buffer.from('<p>v1</p>');
  const now = Buffer.from('<p>v2</p>');
  const listed = historyProblem('a.html', 'a', before, now, { a: ['f'.repeat(64)] }, 'main');
  if (!listed || !listed.includes('right under "a": [') || !listed.includes('\n    "' + sha256(before) + '",')) throw new Error('message for a listed id: ' + listed);
  const absent = historyProblem('b.html', 'b', before, now, {}, 'main');
  if (!absent || !absent.includes('\n  "b": ["' + sha256(before) + '"],')) throw new Error('message for a new id: ' + absent);
  const removed = historyProblem('c.html', 'c', before, null, {}, 'main');
  if (!removed || !removed.includes('removed since main')) throw new Error('message for a removed file: ' + removed);
});
rule('unchanged or new file needs no history entry', () => {
  const same = Buffer.from('<p>v1</p>');
  if (historyProblem('a.html', 'a', same, Buffer.from('<p>v1</p>'), {}, 'main') !== null) throw new Error('an unchanged file was reported');
  if (historyProblem('a.html', 'a', null, same, {}, 'main') !== null) throw new Error('a file added since main was reported');
});
rule('history file shape is checked', () => {
  const ids = new Set(['a']);
  if (historyShapeProblems({ a: ['f'.repeat(64)] }, ids).length) throw new Error('a valid history was rejected');
  if (historyShapeProblems({ a: ['F'.repeat(64)] }, ids).length !== 1) throw new Error('an uppercase hash was accepted');
  if (historyShapeProblems({ a: ['f'.repeat(64), 'f'.repeat(64)] }, ids).length !== 1) throw new Error('a repeated hash was accepted');
  const unknown = historyShapeProblems({ z: ['f'.repeat(64)] }, ids);
  if (unknown.length !== 1) throw new Error('an unknown id was accepted');
  if (!unknown[0].includes('mark it retired in src/_data/extensionCatalog.json instead of deleting it')) throw new Error('message for a removed id: ' + unknown[0]);
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
