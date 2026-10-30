import http from 'node:http';
import { createReadStream, statSync, rmSync } from 'node:fs';
import { join, extname, normalize, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import puppeteer from 'puppeteer-core';

const BUILD = process.argv[2];
if (!BUILD) { console.log('usage: node scripts/model-cache-check.mjs <build dir>'); process.exit(2); }
const PORT = Number(process.env.CACHE_PORT) || 8095;
const ORIGIN = 'http://localhost:' + PORT;
const PROFILE = join(tmpdir(), 'model-cache-check-profile-' + PORT);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.txt': 'text/plain' };
const MIB = 1024 * 1024;

function serve(dir, port) {
  const root = resolve(dir);
  const server = http.createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://local').pathname);
    let file = normalize(join(root, path));
    if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
    try {
      if (statSync(file).isDirectory()) file = join(file, 'index.html');
      statSync(file);
    } catch (_) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    createReadStream(file).pipe(res);
  });
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok(server)));
}

const HELPERS = () => {
  const OLD = 256 * 1024 * 1024;
  const key = (url, k) => url + '?mentria_seg=' + k;
  const bytes = (seed, start, len) => {
    const out = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      const x = start + i;
      out[i] = (Math.imul(x ^ seed, 2654435761) >>> 13) & 255;
    }
    return out;
  };
  const hex = async (buf) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buf))).map((b) => b.toString(16).padStart(2, '0')).join('');
  const realPut = Cache.prototype.put;
  const realDelete = Cache.prototype.delete;
  window.__cc = {
    url: (name) => location.origin + '/models/' + name + '.safetensors',
    async setup(name, total, seed) {
      const c = await caches.open('mentria-models');
      const url = this.url(name);
      for (const r of await c.keys()) if (r.url.startsWith(url)) await c.delete(r);
      const segs = Math.ceil(total / OLD);
      for (let k = 0; k < segs; k++) {
        const len = Math.min(OLD, total - k * OLD);
        await c.put(key(url, k), new Response(bytes(seed, k * OLD, len)));
      }
      await c.put(key(url, 'meta'), new Response(JSON.stringify({ v: 1, segments: segs, totalBytes: total })));
      return url;
    },
    async verify(name, total, seed, piece) {
      const c = await caches.open('mentria-models');
      const url = this.url(name);
      const meta = await (await c.match(key(url, 'meta'))).json();
      const out = { segments: meta.segments, want: Math.ceil(total / piece), total: meta.totalBytes, bad: [], mig: !!(await c.match(key(url, 'mig'))), extra: !!(await c.match(key(url, meta.segments))) };
      let at = 0;
      for (let k = 0; k < meta.segments; k++) {
        const r = await c.match(key(url, k));
        if (!r) { out.bad.push('missing ' + k); break; }
        const got = new Uint8Array(await r.arrayBuffer());
        if (await hex(got) !== await hex(bytes(seed, at, got.byteLength))) out.bad.push(k);
        at += got.byteLength;
      }
      out.read = at;
      return out;
    },
    failAfter(n) {
      let ops = 0;
      const gate = (fn) => function (...a) {
        ops += 1;
        if (ops >= n) return Promise.reject(new Error('killed'));
        return fn.apply(this, a);
      };
      Cache.prototype.put = gate(realPut);
      Cache.prototype.delete = gate(realDelete);
    },
    heal() { Cache.prototype.put = realPut; Cache.prototype.delete = realDelete; },
    async keys(name) {
      const c = await caches.open('mentria-models');
      const url = this.url(name);
      return (await c.keys()).filter((r) => r.url.startsWith(url)).length;
    }
  };
};

function assert(cond, msg, detail) {
  if (!cond) throw new Error(msg + (detail !== undefined ? ' ' + JSON.stringify(detail) : ''));
}

const server = await serve(BUILD, PORT);
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, userDataDir: PROFILE, args: ['--no-first-run', '--no-default-browser-check'] });
const page = await browser.newPage();
await page.goto(ORIGIN + '/manifest.json');
await page.evaluate(HELPERS);
await page.evaluate(async () => { window.__mc = await import('/assets/js/mentria-model-cache.js'); });
const PIECE = await page.evaluate(() => window.__mc.PIECE);

const BIG = 300 * MIB + 5;
const SMALL = 40 * MIB + 3;
const checks = [];
const check = (name, fn) => checks.push([name, fn]);

async function compact(name) {
  return page.evaluate((u) => window.__mc.compactShard(u), await page.evaluate((n) => window.__cc.url(n), name));
}
async function verify(name, total, seed) {
  return page.evaluate((n, t, s, p) => window.__cc.verify(n, t, s, p), name, total, seed, PIECE);
}
function good(v, total) {
  return v.segments === v.want && v.total === total && v.read === total && !v.bad.length && !v.mig && !v.extra;
}

check('a 300 MB file in 256 MB pieces is re-split into 16 MB pieces with identical bytes', async () => {
  await page.evaluate((t) => window.__cc.setup('big', t, 7), BIG);
  assert(await compact('big') === true, 're-split reports a change');
  const v = await verify('big', BIG, 7);
  assert(good(v, BIG), 'layout and bytes', v);
  assert(await compact('big') === false, 'a second run leaves it alone');
  assert(good(await verify('big', BIG, 7), BIG), 'still intact after the second run');
});

check('a file smaller than one old piece (the vision tower case) is re-split too', async () => {
  await page.evaluate((t) => window.__cc.setup('small', t, 11), SMALL);
  assert(await compact('small') === true, 're-split reports a change');
  const v = await verify('small', SMALL, 11);
  assert(good(v, SMALL), 'layout and bytes', v);
});

check('a crash at any step of a 300 MB re-split resumes to an intact file', async () => {
  const points = [1, 2, 3, 4, 5, 6, 9, 14, 19, 20, 21, 22, 23];
  for (const n of points) {
    await page.evaluate((t) => window.__cc.setup('crash', t, 23), BIG);
    await page.evaluate((k) => window.__cc.failAfter(k), n);
    let died = false;
    try { await compact('crash'); } catch (_) { died = true; }
    await page.evaluate(() => window.__cc.heal());
    assert(died, 'the simulated crash happened at op ' + n);
    await compact('crash');
    const v = await verify('crash', BIG, 23);
    assert(good(v, BIG), 'intact after a crash at op ' + n, v);
  }
});

check('a crash while re-splitting a single-piece file resumes to an intact file', async () => {
  for (const n of [1, 2, 3, 4, 5]) {
    await page.evaluate((t) => window.__cc.setup('crash1', t, 29), SMALL);
    await page.evaluate((k) => window.__cc.failAfter(k), n);
    try { await compact('crash1'); } catch (_) {}
    await page.evaluate(() => window.__cc.heal());
    await compact('crash1');
    const v = await verify('crash1', SMALL, 29);
    assert(good(v, SMALL), 'intact after a crash at op ' + n, v);
  }
});

check('a damaged cache is left for the engine to replace, never half-rewritten', async () => {
  await page.evaluate((t) => window.__cc.setup('broken', t, 31), BIG);
  await page.evaluate(async () => { const c = await caches.open('mentria-models'); await c.delete(window.__cc.url('broken') + '?mentria_seg=1'); });
  assert(await compact('broken') === false, 'nothing re-split when a piece is missing');
  const before = await page.evaluate(() => window.__cc.keys('broken'));
  assert(before === 2, 'the remaining old piece and its index are untouched', before);
});

check('an unknown layout is skipped', async () => {
  const r = await page.evaluate(async () => {
    const c = await caches.open('mentria-models');
    const url = window.__cc.url('odd');
    await c.put(url + '?mentria_seg=0', new Response(new Uint8Array(1024)));
    await c.put(url + '?mentria_seg=meta', new Response(JSON.stringify({ v: 1, segments: 3, totalBytes: 1024 })));
    return window.__mc.compactShard(url);
  });
  assert(r === false, 'skipped');
  assert(await compact('nothing-here') === false, 'a file that was never cached is skipped');
});

let failed = 0;
for (const [name, fn] of checks) {
  try {
    await fn();
    console.log('PASS ' + name);
  } catch (e) {
    failed += 1;
    console.log('FAIL ' + name + ': ' + (e && e.message || e));
  }
}
await browser.close();
server.close();
rmSync(PROFILE, { recursive: true, force: true });
console.log((checks.length - failed) + '/' + checks.length + ' passed');
process.exit(failed ? 1 : 0);
