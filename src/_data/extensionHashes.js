const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = path.join(__dirname, '..', 'assets', 'extensions');
const CATALOG = path.join(__dirname, 'extensionCatalog.json');
const MANIFEST = /<script type="application[/]json" id="mentria-ext">([\s\S]*?)<[/]script>/;

module.exports = () => {
  const hashes = {};
  for (const entry of JSON.parse(fs.readFileSync(CATALOG, 'utf8'))) {
    if (entry.retired || typeof entry.app === 'string') continue;
    const file = path.join(DIR, entry.id + '.html');
    if (!fs.existsSync(file)) continue;
    const buf = fs.readFileSync(file);
    const m = MANIFEST.exec(buf.toString('utf8'));
    if (!m) throw new Error('extension ' + entry.id + ' has no manifest block');
    hashes[entry.id] = { version: JSON.parse(m[1]).version, sha256: crypto.createHash('sha256').update(buf).digest('hex') };
  }
  return hashes;
};
