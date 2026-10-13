const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const catalog = require('./extensionCatalog.json');

const DIR = path.join(__dirname, '..', 'assets', 'extensions');
const MANIFEST = /<script type="application[/]json" id="mentria-ext">([\s\S]*?)<[/]script>/;

const hashes = {};
for (const entry of catalog) {
  if (entry.retired || typeof entry.app === 'string') continue;
  const file = path.join(DIR, entry.id + '.html');
  if (!fs.existsSync(file)) continue;
  const buf = fs.readFileSync(file);
  const m = MANIFEST.exec(buf.toString('utf8'));
  if (!m) throw new Error('extension ' + entry.id + ' has no manifest block');
  hashes[entry.id] = { version: JSON.parse(m[1]).version, sha256: crypto.createHash('sha256').update(buf).digest('hex') };
}

module.exports = hashes;
