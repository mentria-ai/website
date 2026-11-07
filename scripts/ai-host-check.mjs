import http from 'node:http';
import { createReadStream, statSync, rmSync, mkdtempSync } from 'node:fs';
import { join, extname, normalize, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import puppeteer from 'puppeteer-core';

const BUILD = process.argv[2];
if (!BUILD) { console.log('usage: node scripts/ai-host-check.mjs <build dir>'); process.exit(2); }
const PORT = Number(process.env.AI_HOST_PORT) || 8096;
const ORIGIN = 'http://localhost:' + PORT;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.txt': 'text/plain', '.css': 'text/css' };
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';

const FAKE_GPU = `(() => {
  const GiB = 1073741824;
  const adapter = { limits: { maxBufferSize: 4 * GiB, maxStorageBufferBindingSize: 2 * GiB, maxComputeWorkgroupStorageSize: 32768, maxComputeInvocationsPerWorkgroup: 1024, maxStorageBuffersPerShaderStage: 10 }, info: { vendor: 'apple', architecture: 'metal-3', description: 'test' }, features: new Set(['shader-f16', 'subgroups']), requestDevice: async () => { throw new Error('fake gpu'); }, requestAdapterInfo: async () => ({ vendor: 'apple', architecture: 'metal-3' }) };
  const gpu = { requestAdapter: async () => adapter, getPreferredCanvasFormat: () => 'bgra8unorm', wgslLanguageFeatures: new Set() };
  Object.defineProperty(Navigator.prototype, 'gpu', { configurable: true, get: () => gpu });
})();`;

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

const SEED = async (tiers) => {
  const Tiers = await import('/assets/js/mentria-tiers.js');
  const c = await caches.open('mentria-models');
  for (const id of tiers) {
    const t = Tiers.TIERS[id];
    for (const shard of t.shards) await c.put(t.base + shard + '?mentria_seg=meta', new Response('{}'));
  }
  return true;
};

const server = await serve(BUILD, PORT);
const profile = mkdtempSync(join(tmpdir(), 'ai-host-check-'));
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, userDataDir: profile, args: ['--no-first-run', '--no-default-browser-check'] });
const checks = [];
const check = (name, fn) => checks.push([name, fn]);
let failed = 0;

const openPage = async ({ iphone } = {}) => {
  const page = await browser.newPage();
  const cdp = await page.createCDPSession();
  if (iphone) {
    await cdp.send('Emulation.setUserAgentOverride', { userAgent: IPHONE_UA, platform: 'iPhone' });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  }
  await page.evaluateOnNewDocument(FAKE_GPU);
  await page.goto(ORIGIN + '/about/', { waitUntil: 'load' });
  await page.evaluate(SEED, ['27b', 'b2-2b']);
  return page;
};

const loadTier = (tier) => (async (tier) => {
  const { ensureModel } = await import('/assets/js/mentria-model.js');
  const factory = () => ({ init: async () => {}, loadModel: async () => ({}), terminate() {}, async unload() {} });
  try {
    const res = await ensureModel(factory, { cachedOnly: true, tier });
    return { tier: res.tier };
  } catch (e) {
    return { error: String(e && e.message) };
  }
})(tier);

try {
  const page = await openPage();

  check('host: ensureModel loads exactly the cached tier asked for', async () => {
    const r = await page.evaluate(loadTier, 'b2-2b');
    if (r.tier !== 'b2-2b') throw new Error(JSON.stringify(r));
  });

  check('host: ensureModel refuses an uncached tier', async () => {
    const r = await page.evaluate(loadTier, 'b2-9b');
    if (r.error !== 'model-not-cached') throw new Error(JSON.stringify(r));
  });

  check('host: hostModels lists only cached tiers', async () => {
    const r = await page.evaluate(async () => {
      const M = await import('/assets/js/mentria-model.js');
      if (typeof M.hostModels !== 'function') return { error: 'no hostModels' };
      return { list: await M.hostModels() };
    });
    if (r.error) throw new Error(r.error);
    const tiers = r.list.map((m) => m.tier);
    if (!tiers.includes('b2-2b') || tiers.some((t) => !['27b', 'b2-2b'].includes(t)) || r.list.some((m) => m.state !== 'cached')) throw new Error(JSON.stringify(r.list));
  });

  check('host: hostModels is empty on an iPhone', async () => {
    const phone = await openPage({ iphone: true });
    const r = await phone.evaluate(async () => {
      const M = await import('/assets/js/mentria-model.js');
      if (typeof M.hostModels !== 'function') return { error: 'no hostModels' };
      return { list: await M.hostModels() };
    });
    await phone.close();
    if (r.error) throw new Error(r.error);
    if (r.list.length !== 0) throw new Error(JSON.stringify(r.list));
  });

  for (const [name, fn] of checks) {
    try { await fn(); console.log('PASS ' + name); }
    catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + String(e && e.message || e).slice(0, 300)); }
  }
} finally {
  await browser.close();
  server.close();
  rmSync(profile, { recursive: true, force: true });
}
console.log('ai-host: ' + (checks.length - failed) + '/' + checks.length + ' passed');
process.exit(failed ? 1 : 0);
