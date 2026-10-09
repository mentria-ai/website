import fs from 'node:fs';

const [prevPath, nextPath, outPath] = process.argv.slice(2);

function entries(xml) {
  const map = new Map();
  for (const m of xml.matchAll(/<url><loc>([^<]+)<\/loc>(?:<lastmod>([^<]+)<\/lastmod>)?/g)) map.set(m[1], m[2] || '');
  return map;
}

const prev = prevPath && fs.existsSync(prevPath) ? entries(fs.readFileSync(prevPath, 'utf8')) : new Map();
const next = entries(fs.readFileSync(nextPath, 'utf8'));
const urls = [];
if (prev.size) {
  for (const [loc, lastmod] of next) {
    if (!prev.has(loc) || (lastmod && prev.get(loc) !== lastmod)) urls.push(loc);
  }
}
fs.writeFileSync(outPath, urls.slice(0, 10000).map((u) => u + '\n').join(''));
console.log(prev.size ? urls.length + ' new or changed page(s) of ' + next.size : 'No previous sitemap; nothing to send.');
