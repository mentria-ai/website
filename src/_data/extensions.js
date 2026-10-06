const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const catalog = require('./extensionCatalog.json');

const SRC = path.join(__dirname, '..');
const DIR = path.join(SRC, 'assets', 'extensions');
const THREE = '/assets/vendor/three-0.186.0/';
const IMPORT_MAP = {
  three: THREE + 'build/three.module.min.js',
  'three/addons/': THREE + 'examples/jsm/'
};
const REMAP = {};
REMAP[THREE + 'build/three.core.js'] = THREE + 'build/three.core.min.js';

function diskPath(url) {
  return path.join(SRC, url.replace(/^\//, ''));
}

function fileInfo(url) {
  const buf = fs.readFileSync(diskPath(url));
  return { u: url, b: buf.length, h: crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12) };
}

function readManifestFromHtml(id) {
  const html = fs.readFileSync(path.join(DIR, id + '.html'), 'utf8');
  const m = html.match(/<script type="application\/json" id="mentria-ext">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('extension ' + id + ' has no manifest block');
  return JSON.parse(m[1]);
}

function resolveSpecifier(spec, fromUrl) {
  let url = null;
  if (IMPORT_MAP[spec]) url = IMPORT_MAP[spec];
  else if (spec.startsWith('three/addons/')) url = IMPORT_MAP['three/addons/'] + spec.slice('three/addons/'.length);
  else if (spec.startsWith('/')) url = spec;
  else if (spec.startsWith('./') || spec.startsWith('../')) url = path.posix.normalize(path.posix.join(path.posix.dirname(fromUrl), spec));
  if (!url) return null;
  url = url.split('?')[0];
  return REMAP[url] || url;
}

function moduleGraph(entries) {
  const seen = new Set();
  const queue = entries.slice();
  const specRe = [/\bfrom\s*["']([^"']+)["']/g, /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g, /\bimport\s*["']([^"']+)["']/g];
  while (queue.length) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    if (!fs.existsSync(diskPath(url))) throw new Error('extension module missing: ' + url);
    seen.add(url);
    if (!/\.m?js$/.test(url)) continue;
    const code = fs.readFileSync(diskPath(url), 'utf8');
    for (const re of specRe) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(code))) {
        const next = resolveSpecifier(m[1], url);
        if (next && !seen.has(next)) queue.push(next);
      }
    }
  }
  return Array.from(seen);
}

function walkDir(url) {
  const out = [];
  const base = diskPath(url);
  if (!fs.existsSync(base)) return out;
  for (const name of fs.readdirSync(base).sort()) {
    if (name.startsWith('.')) continue;
    const child = url.replace(/\/?$/, '/') + name;
    if (fs.statSync(diskPath(child)).isDirectory()) out.push(...walkDir(child));
    else out.push(child);
  }
  return out;
}

function sizeLabel(bytes) {
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return Math.max(1, Math.round(bytes / 1024)) + ' KB';
}

function buildEntry(entry) {
  const isApp = typeof entry.app === 'string';
  const manifest = isApp
    ? JSON.parse(fs.readFileSync(path.join(DIR, entry.id + '.json'), 'utf8'))
    : readManifestFromHtml(entry.id);
  if (manifest.id !== entry.id) throw new Error('extension ' + entry.id + ' declares id ' + manifest.id);
  let urls;
  if (isApp) {
    if (manifest.app !== entry.app) throw new Error('extension ' + entry.id + ' app path does not match the catalog');
    urls = moduleGraph(manifest.entry || []);
    for (const dir of manifest.assets || []) urls.push(...walkDir(dir));
  } else {
    urls = ['/assets/extensions/' + entry.id + '.html'].concat(walkDir('/assets/extensions/' + entry.id + '/'));
  }
  const files = Array.from(new Set(urls)).map(fileInfo);
  const bytes = files.reduce((n, f) => n + f.b, 0);
  return {
    id: entry.id,
    kind: isApp ? 'app' : 'single',
    app: isApp ? manifest.app : null,
    name: manifest.name,
    icon: manifest.icon || '🧩',
    iconIsImage: /^data:image\//.test(manifest.icon || ''),
    author: manifest.author || 'Mentria',
    version: manifest.version,
    permissions: manifest.permissions || [],
    manifest,
    files,
    kb: Math.max(1, Math.round(bytes / 1024)),
    bytes,
    size: sizeLabel(bytes),
    schemaCategory: entry.schemaCategory || 'UtilitiesApplication'
  };
}

module.exports = catalog.filter((entry) => !entry.held && !entry.retired).map(buildEntry);
