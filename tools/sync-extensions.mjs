import fs from 'node:fs';
import path from 'node:path';
const src = process.argv[2] || path.join(process.env.HOME, 'Documents/mentria-extensions/extensions');
const dst = path.resolve('src/assets/extensions');
let n = 0;
for (const f of fs.readdirSync(src).filter((x) => x.endsWith('.html'))) {
  const a = fs.readFileSync(path.join(src, f));
  const b = fs.existsSync(path.join(dst, f)) ? fs.readFileSync(path.join(dst, f)) : null;
  if (!b || !a.equals(b)) { fs.writeFileSync(path.join(dst, f), a); n++; console.log('mirrored ' + f); }
}
console.log(n ? n + ' file(s) updated' : 'mirror already current');
