import http from 'node:http';
import { createReadStream, statSync, rmSync } from 'node:fs';
import { join, extname, normalize, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import puppeteer from 'puppeteer-core';

const BUILD = process.argv[2];
if (!BUILD) { console.log('usage: node scripts/wake-check.mjs <build dir>'); process.exit(2); }
const PORT = Number(process.env.WAKE_PORT) || 8097;
const ORIGIN = 'http://localhost:' + PORT;
const PROFILE = join(tmpdir(), 'wake-check-profile-' + PORT);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain' };

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

const STUB = () => {
  window.__wl = { requests: 0, releases: 0, live: 0, denied: 0 };
  let hidden = false;
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
  const sentinels = new Set();
  const make = () => {
    const t = new EventTarget();
    t.released = false;
    t.type = 'screen';
    t.release = async () => {
      if (t.released) return;
      t.released = true;
      sentinels.delete(t);
      window.__wl.releases += 1;
      window.__wl.live = sentinels.size;
      t.dispatchEvent(new Event('release'));
    };
    return t;
  };
  Object.defineProperty(navigator, 'wakeLock', {
    configurable: true,
    value: {
      request: async (type) => {
        if (type !== 'screen' || hidden) throw new DOMException('not visible', 'NotAllowedError');
        if (window.__needTap && !navigator.userActivation.hasBeenActive) {
          window.__wl.denied += 1;
          throw new DOMException('Permission was denied', 'NotAllowedError');
        }
        const t = make();
        sentinels.add(t);
        window.__wl.requests += 1;
        window.__wl.live = sentinels.size;
        return t;
      }
    }
  });
  window.__hide = (on) => {
    hidden = on;
    if (on) for (const t of [...sentinels]) t.release();
    document.dispatchEvent(new Event('visibilitychange'));
  };
};

rmSync(PROFILE, { recursive: true, force: true });
const server = await serve(BUILD, PORT);
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, userDataDir: PROFILE, args: ['--no-first-run', '--no-default-browser-check'] });
const checks = [];
const check = (name, fn) => checks.push([name, fn]);
const assert = (cond, msg, extra) => { if (!cond) throw new Error(msg + (extra === undefined ? '' : ' ' + JSON.stringify(extra))); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(path, init) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e && e.message || e)));
  await page.evaluateOnNewDocument(STUB);
  if (init) await page.evaluateOnNewDocument(init);
  await page.goto(ORIGIN + path, { waitUntil: 'load' });
  page.__errors = errors;
  return page;
}

const wl = (page) => page.evaluate(() => Object.assign({}, window.__wl));

check('holds are counted and the lock goes with the last one', async () => {
  const page = await open('/tools/');
  const r = await page.evaluate(async () => {
    const m = await import('/assets/js/mentria-wake.js');
    const tick = () => new Promise((res) => setTimeout(res, 50));
    const out = {};
    const a = m.holdAwake();
    const b = m.holdAwake();
    await tick();
    out.two = Object.assign({ holds: m.awakeHolds() }, window.__wl);
    a();
    a();
    await tick();
    out.one = Object.assign({ holds: m.awakeHolds() }, window.__wl);
    b();
    await tick();
    out.none = Object.assign({ holds: m.awakeHolds() }, window.__wl);
    return out;
  });
  assert(r.two.holds === 2 && r.two.requests === 1 && r.two.live === 1, 'two holds share one lock', r.two);
  assert(r.one.holds === 1 && r.one.releases === 0 && r.one.live === 1, 'releasing one hold twice keeps the lock for the other', r.one);
  assert(r.none.holds === 0 && r.none.releases === 1 && r.none.live === 0, 'the last release lets the screen sleep', r.none);
  await page.close();
});

check('a held lock comes back when the page is shown again', async () => {
  const page = await open('/tools/');
  const r = await page.evaluate(async () => {
    const m = await import('/assets/js/mentria-wake.js');
    const tick = () => new Promise((res) => setTimeout(res, 50));
    const release = m.holdAwake();
    await tick();
    window.__hide(true);
    await tick();
    const hidden = Object.assign({}, window.__wl);
    window.__hide(false);
    await tick();
    const shown = Object.assign({}, window.__wl);
    release();
    await tick();
    window.__hide(true);
    window.__hide(false);
    await tick();
    const after = Object.assign({}, window.__wl);
    return { hidden, shown, after };
  });
  assert(r.hidden.live === 0 && r.hidden.requests === 1, 'hiding the page drops the lock', r.hidden);
  assert(r.shown.live === 1 && r.shown.requests === 2, 'showing it again takes the lock back', r.shown);
  assert(r.after.live === 0 && r.after.requests === 2, 'once released, showing the page asks for nothing', r.after);
  await page.close();
});

check('a lock denied before the first tap is taken on the next tap', async () => {
  const page = await open('/tools/', () => {
    window.__needTap = true;
    document.addEventListener('DOMContentLoaded', () => {
      const pad = document.createElement('div');
      pad.id = 't-pad';
      pad.style.cssText = 'position:fixed;top:0;left:0;width:60px;height:60px;z-index:2147483647';
      document.body.append(pad);
      window.__tappedAtHold = navigator.userActivation.hasBeenActive;
      import('/assets/js/mentria-wake.js').then((m) => { window.__rel = m.holdAwake(); });
    });
  });
  await sleep(300);
  const before = await page.evaluate(() => Object.assign({ tapped: window.__tappedAtHold }, window.__wl));
  await page.click('#t-pad');
  await sleep(150);
  const after = await wl(page);
  await page.evaluate(() => window.__rel());
  await sleep(100);
  const done = await wl(page);
  assert(before.tapped === false && before.denied === 1 && before.live === 0 && before.requests === 0, 'denied before any tap, like Safari on iPhone', before);
  assert(after.live === 1 && after.requests === 1, 'the next tap takes the lock', after);
  assert(done.live === 0 && done.releases === 1, 'and it goes when the work ends', done);
  await page.close();
});

check('AI replies keep the screen on until they finish', async () => {
  const page = await open('/tools/');
  await page.evaluate(() => {
    window.__engine = window.mentriaWrapEngine({ generate: () => new Promise((res) => setTimeout(res, 600)) });
    window.__failing = window.mentriaWrapEngine({ generate: () => new Promise((_, rej) => setTimeout(() => rej(new Error('stopped')), 400)) });
  });
  const during = await page.evaluate(async () => {
    window.__done = window.__engine.generate({}, () => {});
    await new Promise((res) => setTimeout(res, 250));
    return Object.assign({}, window.__wl);
  });
  await page.evaluate(() => window.__done);
  await sleep(100);
  const after = await wl(page);
  assert(during.live === 1, 'a reply holds the lock while it streams', during);
  assert(after.live === 0 && after.releases === 1, 'the lock goes when the reply ends', after);
  await page.evaluate(() => window.__failing.generate({}, () => {}).catch(() => {}));
  await sleep(150);
  const stopped = await wl(page);
  assert(stopped.live === 0 && stopped.requests === 2 && stopped.releases === 2, 'a stopped or failed reply lets go too', stopped);
  await page.close();
});

check('model downloads and loads keep the screen on', async () => {
  const page = await open('/tools/');
  const r = await page.evaluate(async () => {
    const Tiers = await import('/assets/js/mentria-tiers.js');
    const P2P = await import('/assets/js/mentria-p2p-models.js');
    const seen = [];
    const fake = () => ({
      init: async () => {},
      loadModel: async () => { seen.push(Object.assign({}, window.__wl)); await new Promise((res) => setTimeout(res, 300)); return {}; },
      terminate: () => {}
    });
    const res = await Tiers.loadWithFallback(fake, Tiers.SMALL_TIER, { vision: false });
    await new Promise((r2) => setTimeout(r2, 50));
    const afterLoad = Object.assign({}, window.__wl);
    const failing = () => ({ init: async () => { throw new Error('no gpu'); }, terminate: () => {} });
    let threw = false;
    try { await Tiers.loadWithFallback(failing, Tiers.SMALL_TIER, { vision: false }); } catch (_) { threw = true; }
    await new Promise((r2) => setTimeout(r2, 50));
    const afterFail = Object.assign({}, window.__wl);
    await P2P.prefetchTier(Tiers, Tiers.SMALL_TIER);
    await new Promise((r2) => setTimeout(r2, 50));
    const afterPrefetch = Object.assign({}, window.__wl);
    return { tier: res.tier, during: seen[0], afterLoad, threw, afterFail, afterPrefetch };
  });
  assert(r.during && r.during.live === 1, 'the lock is held while the model loads', r);
  assert(r.afterLoad.live === 0, 'the lock goes once the model is loaded', r.afterLoad);
  assert(r.threw && r.afterFail.live === 0, 'a failed load lets go too', r.afterFail);
  assert(r.afterPrefetch.requests === r.afterFail.requests + 1 && r.afterPrefetch.releases === r.afterFail.releases + 1 && r.afterPrefetch.live === 0, 'the peer download takes the lock once and lets it go', { before: r.afterFail, after: r.afterPrefetch });
  await page.close();
});

check('Comms loads with the wake lock wired in', async () => {
  const page = await open('/comms/');
  await sleep(1500);
  const errs = page.__errors.filter((e) => /wake|holdAwake|callWake|recvWake/i.test(e));
  assert(!errs.length, 'no wake lock errors on Comms', errs);
  const r = await wl(page);
  assert(r.live === 0 && r.requests === 0, 'Comms holds nothing while idle', r);
  await page.close();
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
