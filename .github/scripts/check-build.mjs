import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const root = resolve(process.argv[2] || 'build');
const pages = [];
const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (n.endsWith('.html')) pages.push(p); } };
walk(root);

let scriptErrors = 0;
let linkErrors = 0;
const tmp = mkdtempSync(join(tmpdir(), 'mentria-check-'));
const seenLinks = new Set();
const seenScripts = new Set();
for (const page of pages) {
  const html = readFileSync(page, 'utf8');
  if (!page.includes('/feed/')) {
    const scripts = [...html.matchAll(/<script(?:\s+type="module")?\s*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).filter((s) => s.trim().length > 400);
    scripts.forEach((src, i) => {
      if (seenScripts.has(src)) return;
      seenScripts.add(src);
      const f = join(tmp, `${pages.indexOf(page)}-${i}.mjs`);
      writeFileSync(f, src);
      try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
      catch (e) { scriptErrors++; console.error(`SCRIPT ${page.slice(root.length)} #${i}\n${String(e.stderr).split('\n').slice(0, 4).join('\n')}`); }
    });
  }
  for (const m of html.matchAll(/(?:href|src)="(\/[^"#?]*)/g)) {
    const path = m[1];
    if (seenLinks.has(path)) continue;
    seenLinks.add(path);
    if (path.startsWith('/.11ty/') || path.startsWith('/webtorrent/') || path.startsWith('/assets/mentria/dist/') || path === '/sw.js' || path.startsWith('/search-index')) continue;
    const target = path.endsWith('/') ? join(root, path, 'index.html') : join(root, path);
    if (!existsSync(target) && !existsSync(join(root, path, 'index.html'))) { linkErrors++; console.error(`LINK ${path} (from ${page.slice(root.length)})`); }
  }
}
console.log(`${pages.length} pages, ${seenLinks.size} internal paths, ${scriptErrors} script errors, ${linkErrors} broken links`);
process.exit(scriptErrors || linkErrors ? 1 : 0);
