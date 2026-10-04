import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';

const root = resolve(process.argv[2] || 'build');
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const pages = [];
const files = [];
const walk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else { files.push(p); if (n.endsWith('.html')) pages.push(p); } } };
walk(root);
const rel = (p) => p.slice(root.length);

let scriptErrors = 0;
let linkErrors = 0;
let dataErrors = 0;
let precacheErrors = 0;
let jsonBlocks = 0;
let packCount = 0;
const tmp = mkdtempSync(join(tmpdir(), 'mentria-check-'));
const firstLines = (s) => String(s).split('\n').slice(0, 5).join('\n');
let tmpFiles = 0;
const moduleCheck = (src) => {
  const f = join(tmp, `${tmpFiles++}.mjs`);
  writeFileSync(f, src);
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); return null; }
  catch (e) { return firstLines(e.stderr); }
};
const classicCheck = (src, name) => {
  try { new Script(src, { filename: name }); return null; }
  catch (e) { return firstLines(e.stack); }
};
const scriptCheck = (src, name) => {
  const asClassic = classicCheck(src, name);
  if (!asClassic) return null;
  const asModule = moduleCheck(src);
  return asModule && `${asClassic}\n${asModule}`;
};

const seenLinks = new Set();
const checkPath = (path, from) => {
  if (seenLinks.has(path)) return;
  seenLinks.add(path);
  if (path.startsWith('/.11ty/') || path.startsWith('/webtorrent/') || path.startsWith('/assets/mentria/dist/') || path === '/sw.js' || path.startsWith('/search-index')) return;
  const target = path.endsWith('/') ? join(root, path, 'index.html') : join(root, path);
  if (!existsSync(target) && !existsSync(join(root, path, 'index.html'))) { linkErrors++; console.error(`LINK ${path} (from ${from})`); }
};
const CSS_URL = /url\(\s*['"]?(\/[^/'"\s)?#][^'"\s)?#]*)/g;
const CDN_IMG = /https:\/\/cdn\.mentria\.ai\/[A-Za-z0-9_\-./%~]+\.(?:webp|png|jpe?g)/g;
const JSON_TYPE = /^(?:application\/(?:ld\+)?json|importmap|speculationrules)$/;

const knownCdn = new Set();
const dataWalk = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) dataWalk(p); else if (n.endsWith('.json')) for (const m of readFileSync(p, 'utf8').matchAll(CDN_IMG)) knownCdn.add(m[0]); } };
dataWalk(join(repo, 'src', '_data'));
const seenCdn = new Set();
const checkCdn = (text, from) => {
  for (const m of text.matchAll(CDN_IMG)) {
    if (seenCdn.has(m[0])) continue;
    seenCdn.add(m[0]);
    if (!knownCdn.has(m[0])) { linkErrors++; console.error(`IMAGE ${m[0]} (from ${from}) is not a deck image listed in src/_data; check it exists on the CDN`); }
  }
};

const seenScripts = new Set();
try {
  for (const page of pages) {
    const html = readFileSync(page, 'utf8');
    if (!page.includes('/feed/')) {
      const scripts = [...html.matchAll(/<script(\s+type="module")?\s*>([\s\S]*?)<\/script>/g)].filter((m) => m[2].trim());
      scripts.forEach(([, module, src], i) => {
        const key = (module ? 'module:' : 'classic:') + src;
        if (seenScripts.has(key)) return;
        seenScripts.add(key);
        const err = module ? moduleCheck(src) : classicCheck(src, `${rel(page)} #${i}`);
        if (err) { scriptErrors++; console.error(`SCRIPT ${rel(page)} #${i}\n${err}`); }
      });
    }
    for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
      const type = /(?:^|\s)type=["']?([^"'\s>]+)/.exec(m[1]);
      if (!type || !JSON_TYPE.test(type[1])) continue;
      jsonBlocks++;
      try { JSON.parse(m[2]); } catch (e) { dataErrors++; console.error(`JSON ${rel(page)} <script ${m[1].trim()}> ${e.message}`); }
    }
    for (const m of html.matchAll(/(?:href|src)="(\/[^"#?]*)/g)) checkPath(m[1], rel(page));
    for (const m of html.matchAll(CSS_URL)) checkPath(m[1], rel(page));
    checkCdn(html, rel(page));
  }

  for (const f of files) {
    const r = rel(f);
    if (r.endsWith('.css') && !r.startsWith('/assets/vendor/')) {
      for (const m of readFileSync(f, 'utf8').matchAll(CSS_URL)) checkPath(m[1], r);
    } else if (r.endsWith('.json')) {
      checkCdn(readFileSync(f, 'utf8'), r);
    } else if (/\.m?js$/.test(r) && r !== '/sw.js' && !r.startsWith('/assets/vendor/') && !r.startsWith('/assets/mentria/dist/')) {
      const src = readFileSync(f, 'utf8');
      const err = r.endsWith('.mjs') ? moduleCheck(src) : scriptCheck(src, r);
      if (err) { scriptErrors++; console.error(`SCRIPT ${r}\n${err}`); }
    }
  }

  const Packs = require(join(repo, 'src', 'assets', 'js', 'mentria-packs.js'));
  const packImages = (node, from) => {
    if (Array.isArray(node)) { node.forEach((v) => packImages(v, from)); return; }
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      if ((k === 'cover' || k === 'image') && typeof v === 'string' && /^\/[^/]/.test(v)) checkPath(v.split(/[?#]/)[0], from);
      else packImages(v, from);
    }
  };
  const packFiles = [];
  const learnDir = join(root, 'learn');
  for (const d of existsSync(learnDir) ? readdirSync(learnDir) : []) {
    const p = join(learnDir, d, 'pack.json');
    if (existsSync(p)) packFiles.push(p);
  }
  const bundled = join(root, 'assets', 'packs');
  for (const n of existsSync(bundled) ? readdirSync(bundled) : []) if (n.endsWith('.mentria.json')) packFiles.push(join(bundled, n));
  for (const p of packFiles) {
    packCount++;
    let pack;
    try { pack = JSON.parse(readFileSync(p, 'utf8')); } catch (e) { dataErrors++; console.error(`PACK ${rel(p)} ${e.message}`); continue; }
    const result = Packs.isCourse(pack) ? Packs.validateCourse(pack) : Packs.validate(pack);
    if (!result.ok) { dataErrors++; console.error(`PACK ${rel(p)} ${result.errors.slice(0, 3).join('; ')}`); }
    packImages(pack, rel(p));
  }

  const swFile = join(root, 'sw.js');
  if (existsSync(swFile)) {
    const sw = readFileSync(swFile, 'utf8');
    const swErr = scriptCheck(sw, '/sw.js');
    if (swErr) { scriptErrors++; console.error(`SCRIPT /sw.js\n${swErr}`); }
    const list = sw.match(/const ASSETS = \[([\s\S]*?)\];/);
    const assets = new Set();
    for (const m of list ? list[1].matchAll(/'([^']+)'/g) : []) {
      const path = decodeURIComponent(m[1].split('?')[0]);
      assets.add(path);
      const target = path.endsWith('/') ? join(root, path, 'index.html') : join(root, path);
      if (!existsSync(target)) { precacheErrors++; console.error(`PRECACHE ${m[1]} (the service worker can't install)`); }
    }
    const catalog = JSON.parse(readFileSync(join(repo, 'src', '_data', 'toolCatalog.json'), 'utf8'));
    for (const t of catalog) {
      if (t.held) continue;
      const url = t.url || '/tools/' + t.slug + '/';
      if (!assets.has(url)) { precacheErrors++; console.error(`PRECACHE ${url} is in toolCatalog.json but not in the service worker's precache list, so it won't work offline`); }
    }
    const revBlock = sw.match(/const REVISIONS = (\{.*\});/);
    let revisions = null;
    try { revisions = revBlock && JSON.parse(revBlock[1]); } catch (_) {}
    if (!revisions) { precacheErrors++; console.error('PRECACHE the REVISIONS map in sw.js is missing or unreadable'); }
    else {
      const seenRefs = new Set();
      const versionRe = /(\/[A-Za-z0-9_\-./%~]+)\?v=([0-9a-f]{6,})(?![0-9A-Za-z])/g;
      for (const f of files) {
        if (!/\.(?:html|m?js|css)$/.test(f) || f.startsWith(join(root, 'assets', 'vendor'))) continue;
        for (const m of readFileSync(f, 'utf8').matchAll(versionRe)) {
          const want = revisions[m[1]];
          if (!want || want === m[2] || seenRefs.has(m[0])) continue;
          seenRefs.add(m[0]);
          precacheErrors++;
          console.error(`PRECACHE ${m[0]} (from ${rel(f)}) doesn't match the precached version ${want}, so it bypasses the offline copy`);
        }
      }
    }
  }

  const flat = (o, p = '', out = new Set()) => {
    for (const [k, v] of Object.entries(o)) {
      const key = p ? p + '.' + k : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) flat(v, key, out);
      else out.add(key);
    }
    return out;
  };
  const dictDir = join(repo, 'src', '_data', 'i18n');
  const en = flat(JSON.parse(readFileSync(join(dictDir, 'en.json'), 'utf8')));
  for (const n of readdirSync(dictDir)) {
    if (!n.endsWith('.json') || n === 'en.json') continue;
    const keys = flat(JSON.parse(readFileSync(join(dictDir, n), 'utf8')));
    const missing = [...en].filter((k) => !keys.has(k));
    const extra = [...keys].filter((k) => !en.has(k));
    if (missing.length || extra.length) { dataErrors++; console.error(`I18N ${n}: ${missing.length} keys missing, ${extra.length} not in en.json (${[...missing, ...extra].slice(0, 5).join(', ')})`); }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`${pages.length} pages, ${seenLinks.size} internal paths, ${seenCdn.size} CDN images, ${jsonBlocks} JSON blocks, ${packCount} packs, ${scriptErrors} script errors, ${linkErrors} broken links, ${dataErrors} data errors, ${precacheErrors} precache errors`);
process.exit(scriptErrors || linkErrors || dataErrors || precacheErrors ? 1 : 0);
