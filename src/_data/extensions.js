const fs = require('fs');
const path = require('path');
const catalog = require('./extensionCatalog.json');

const DIR = path.join(__dirname, '..', 'assets', 'extensions');

function read(id) {
  const html = fs.readFileSync(path.join(DIR, id + '.html'), 'utf8');
  const m = html.match(/<script type="application\/json" id="mentria-ext">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('extension ' + id + ' has no manifest block');
  return { manifest: JSON.parse(m[1]), bytes: Buffer.byteLength(html, 'utf8') };
}

module.exports = catalog.filter((entry) => !entry.held && !entry.retired).map((entry) => {
  const { manifest, bytes } = read(entry.id);
  if (manifest.id !== entry.id) throw new Error('extension ' + entry.id + ' declares id ' + manifest.id);
  return {
    id: entry.id,
    name: manifest.name,
    icon: manifest.icon || '🧩',
    author: manifest.author || 'Mentria',
    version: manifest.version,
    permissions: manifest.permissions || [],
    kb: Math.max(1, Math.round(bytes / 1024)),
    schemaCategory: entry.schemaCategory || 'UtilitiesApplication'
  };
});
