import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { rmSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { serve } from './scanner-serve.mjs';

const BUILD = process.argv[2];
const SHOTS = process.argv[3] || '';
if (!BUILD) { console.log('usage: node scripts/extensions-browser-check.mjs <build dir> [<screenshot dir>]'); process.exit(2); }
const PORT = 8097;
const ORIGIN = 'http://localhost:' + PORT;
const PROFILE = join(tmpdir(), 'mentria-ext-check-' + process.pid);
const CATALOG = 'dice-roller';
const PASTED = 'paste-check';
const PASTED_HTML = '<!doctype html><script type="application/json" id="mentria-ext">' +
  JSON.stringify({ id: PASTED, name: 'Paste Check', version: '1.0.0', icon: '🧪', permissions: ['storage'], mounts: { tool: {} } }) +
  '</' + 'script><p style="font-family:monospace;color:#ccc;padding:1rem">pasted extension</p>';
const ACCESS_NOTE = 'It runs with full access to everything Mentria keeps on this device, including locked things while they are open.';
const DESKTOP = { width: 1280, height: 860 };
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

rmSync(PROFILE, { recursive: true, force: true });
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const server = await serve(BUILD, PORT);
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  userDataDir: PROFILE,
  protocolTimeout: 120000
});

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

function olderCatalogFile(id) {
  const file = 'src/assets/extensions/' + id + '.html';
  const now = readFileSync(file);
  const version = (html) => JSON.parse(/<script type="application[/]json" id="mentria-ext">([\s\S]*?)<[/]script>/.exec(html)[1]).version;
  const newer = (a, b) => { const x = a.split('.').map(Number); const y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };
  const current = version(now.toString('utf8'));
  const commits = execFileSync('git', ['log', '--format=%H', '--', file], { encoding: 'utf8' }).split('\n').filter(Boolean);
  for (const c of commits) {
    let bytes;
    try { bytes = execFileSync('git', ['show', c + ':' + file], { maxBuffer: 64 * 1024 * 1024 }); } catch (_) { continue; }
    const html = bytes.toString('utf8');
    if (!newer(current, version(html))) continue;
    return { html, sha256: createHash('sha256').update(bytes).digest('hex'), manifest: JSON.parse(/<script type="application[/]json" id="mentria-ext">([\s\S]*?)<[/]script>/.exec(html)[1]) };
  }
  throw new Error('no earlier version of ' + file + ' with a lower version number in this checkout');
}

async function watchAccessBadges(page) {
  await page.evaluateOnNewDocument(() => {
    window.__accessSeen = [];
    new MutationObserver((list) => {
      for (const m of list) for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        const hit = n.matches('.launch-tile__access, .xt__access') ? n : n.querySelector('.launch-tile__access, .xt__access');
        if (hit) window.__accessSeen.push(hit.closest('.launch-tile, .xt__row').textContent.trim());
      }
    }).observe(document, { childList: true, subtree: true });
  });
}

async function seedInstall(page, older, withHash) {
  await open(page, '/tools/');
  await page.evaluate((o, h) => {
    const S = window.MentriaStore;
    S.set('ext', 'src.' + o.manifest.id, o.html);
    const row = { manifest: o.manifest, enabled: true, installedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), size: o.html.length };
    if (h) row.sha256 = o.sha256;
    S.set('ext', 'registry', [row]);
  }, older, withHash);
}

async function open(page, path, viewport) {
  await page.setViewport(viewport || DESKTOP);
  await page.goto(ORIGIN + path, { waitUntil: 'load' });
}

async function shot(page, name, selector) {
  if (!SHOTS) return;
  const file = join(SHOTS, name + '.png');
  if (selector) await page.$eval(selector, (el) => el.scrollIntoView({ block: 'center', behavior: 'instant' })).catch(() => {});
  await new Promise((r) => setTimeout(r, 400));
  const box = selector ? await page.$eval(selector, (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.max(0, r.left) + scrollX, y: Math.max(0, r.top) + scrollY, width: Math.min(r.width, innerWidth), height: Math.min(r.height, innerHeight) };
  }).catch(() => null) : null;
  if (box && box.width > 0 && box.height > 0) await page.screenshot({ path: file, clip: box, captureBeyondViewport: false });
  else await page.screenshot({ path: file });
}

async function mounted(page) {
  await page.waitForFunction(() => {
    const f = document.getElementById('xr-frame');
    return !!f && (f.hasAttribute('srcdoc') || f.hasAttribute('src'));
  }, { timeout: 20000 });
}

function titleBadge(page) {
  return page.evaluate(() => {
    const el = document.querySelector('.terminal-frame__access');
    const name = document.querySelector('.terminal-frame__filename');
    const shown = !!el && !el.hidden && el.getClientRects().length > 0;
    return {
      shown,
      text: shown ? el.textContent.trim() : '',
      nextToName: shown && !!name && el.previousElementSibling === name,
      inBar: shown && !!el.closest('.terminal-frame__titlebar'),
      name: name ? name.textContent.trim() : '',
      overflow: document.documentElement.scrollWidth > innerWidth
    };
  });
}

async function launcherTile(page, id, viewport) {
  await open(page, '/about/#tools', viewport);
  const sel = '.launcher__cat--extensions .launch-tile[data-slug="' + id + '"]';
  await page.waitForSelector(sel, { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 400));
  return page.$eval(sel, (a) => {
    const b = a.querySelector('.launch-tile__access');
    return { badge: b ? b.textContent.trim() : '', label: a.querySelector('.launch-tile__label').textContent.trim() };
  });
}

async function managerRow(page, name, viewport) {
  await open(page, '/tools/extensions/', viewport);
  await page.waitForFunction((n) => Array.from(document.querySelectorAll('.xt__row .xt__name')).some((el) => el.firstChild && el.firstChild.textContent === n), { timeout: 20000 }, name);
  await new Promise((r) => setTimeout(r, 300));
  return page.evaluate((n) => {
    const row = Array.from(document.querySelectorAll('.xt__row')).find((r) => r.querySelector('.xt__name').firstChild.textContent === n);
    const b = row && row.querySelector('.xt__access');
    return { badge: b ? b.textContent.trim() : '' };
  }, name);
}

async function storeInstall(page, id) {
  await open(page, '/extensions/' + id + '/');
  await mounted(page);
  await page.waitForFunction(() => !document.getElementById('xs-install').hidden, { timeout: 20000 });
  await page.click('#xs-install');
  await page.waitForFunction(() => !document.getElementById('xs-state').hidden || !document.getElementById('xs-state-plain').hidden, { timeout: 30000 });
  return page.evaluate((x) => {
    const reg = window.MentriaStore.get('ext', 'registry') || [];
    const row = reg.find((e) => e.manifest.id === x);
    return { sha256: row && row.sha256, published: JSON.parse(document.getElementById('xs-data').textContent).sha256 };
  }, id);
}

function registrySha(page, id) {
  return page.evaluate((x) => {
    const row = (window.MentriaStore.get('ext', 'registry') || []).find((e) => e.manifest.id === x);
    return row ? row.sha256 || null : undefined;
  }, id);
}

check('pasted extension shows full access badge', async (page) => {
  await open(page, '/tools/extensions/');
  await page.waitForSelector('#exg-grid .exg__actions button', { timeout: 20000 });
  await page.$eval('.xt__paste', (el) => { el.open = true; });
  await page.$eval('#xt-paste', (el, v) => { el.value = v; }, PASTED_HTML);
  await page.$eval('#xt-paste-install', (b) => b.click());
  await page.waitForFunction(() => /Paste Check/.test(document.getElementById('m-dialog-msg').textContent), { timeout: 10000 });
  const prompt = await page.$eval('#m-dialog-msg', (el) => el.textContent);
  if (!prompt.includes('full access to everything Mentria keeps on this device, including locked things while they are open')) throw new Error('install prompt does not explain full access: ' + prompt);
  await shot(page, 'install-prompt-1280', '#m-dialog');
  await page.click('#m-dialog-ok');
  const row = await managerRow(page, 'Paste Check');
  if (row.badge !== 'full access') throw new Error('manager row badge is "' + row.badge + '"');
  await shot(page, 'manager-row-1280', '.xt__list');
  const phoneRow = await managerRow(page, 'Paste Check', PHONE);
  if (phoneRow.badge !== 'full access') throw new Error('manager row badge at 390 is "' + phoneRow.badge + '"');
  await shot(page, 'manager-row-390', '.xt__list');
  for (const [label, viewport] of [['1280', DESKTOP], ['390', PHONE]]) {
    await open(page, '/tools/extensions/run/?id=' + PASTED, viewport);
    await mounted(page);
    const b = await titleBadge(page);
    if (!b.shown || b.text !== 'full access' || !b.nextToName || !b.inBar || b.overflow) throw new Error('run page badge at ' + label + ': ' + JSON.stringify(b));
    await shot(page, 'run-pasted-' + label, '.terminal-frame__titlebar');
    await shot(page, 'run-pasted-page-' + label);
    const tile = await launcherTile(page, PASTED, viewport);
    if (tile.badge !== 'full access') throw new Error('launcher tile badge at ' + label + ' is "' + tile.badge + '"');
    await shot(page, 'launcher-pasted-' + label, '.launcher__cat--extensions');
  }
  const sha = await registrySha(page, PASTED);
  if (sha) throw new Error('pasted extension gained a recorded hash: ' + sha);
});

check('catalog install shows no badge', async (page) => {
  const got = await storeInstall(page, CATALOG);
  if (!got.sha256 || got.sha256 !== got.published) throw new Error('store install recorded ' + got.sha256 + ', published ' + got.published);
  await open(page, '/extensions/' + CATALOG + '/');
  await mounted(page);
  let b = await titleBadge(page);
  if (b.shown) throw new Error('store page shows a badge for a catalog install');
  await open(page, '/tools/extensions/run/?id=' + CATALOG);
  await mounted(page);
  b = await titleBadge(page);
  if (b.shown) throw new Error('run page shows a badge for a catalog install');
  await shot(page, 'run-catalog-1280', '.terminal-frame__titlebar');
  const tile = await launcherTile(page, CATALOG);
  if (tile.badge) throw new Error('launcher tile shows "' + tile.badge + '" for a catalog install');
  const row = await managerRow(page, 'Dice Roller');
  if (row.badge) throw new Error('manager row shows "' + row.badge + '" for a catalog install');
});

check('tampered catalog entry shows the badge', async (page) => {
  await storeInstall(page, CATALOG);
  await page.evaluate((x) => {
    const S = window.MentriaStore;
    S.set('ext', 'src.' + x, S.get('ext', 'src.' + x) + '<p>changed</p>');
  }, CATALOG);
  await open(page, '/tools/extensions/run/?id=' + CATALOG);
  await mounted(page);
  let b = await titleBadge(page);
  if (!b.shown || b.text !== 'full access' || !b.nextToName) throw new Error('run page badge: ' + JSON.stringify(b));
  if (await registrySha(page, CATALOG)) throw new Error('changed file kept its recorded hash');
  const tile = await launcherTile(page, CATALOG);
  if (tile.badge !== 'full access') throw new Error('launcher tile badge is "' + tile.badge + '"');
  for (const [label, viewport] of [['1280', DESKTOP], ['390', PHONE]]) {
    await open(page, '/extensions/' + CATALOG + '/', viewport);
    await mounted(page);
    b = await titleBadge(page);
    if (!b.shown || b.text !== 'full access' || !b.nextToName || b.overflow) throw new Error('store page badge at ' + label + ': ' + JSON.stringify(b));
    await shot(page, 'store-tampered-' + label, '.terminal-frame__titlebar');
  }
  await open(page, '/fr/extensions/' + CATALOG + '/', PHONE);
  await mounted(page);
  b = await titleBadge(page);
  if (b.text !== 'accès complet' || b.overflow) throw new Error('French store page badge: ' + JSON.stringify(b));
  await shot(page, 'store-tampered-fr-390', '.terminal-frame__titlebar');
  await shot(page, 'store-tampered-fr-390-page');
  await open(page, '/ja/tools/extensions/run/?id=' + CATALOG, PHONE);
  await mounted(page);
  b = await titleBadge(page);
  if (b.text !== '完全アクセス') throw new Error('Japanese run page badge is "' + b.text + '"');
  await shot(page, 'run-tampered-ja-390', '.terminal-frame__titlebar');
});

check('catalog install without a recorded hash shows no badge', async (page) => {
  await storeInstall(page, CATALOG);
  const published = await page.$eval('#xs-data', (el) => JSON.parse(el.textContent).sha256);
  await page.evaluate((x) => {
    const reg = window.MentriaStore.get('ext', 'registry');
    delete reg.find((e) => e.manifest.id === x).sha256;
    window.MentriaStore.set('ext', 'registry', reg);
  }, CATALOG);
  const tile = await launcherTile(page, CATALOG);
  if (tile.badge) throw new Error('launcher tile shows "' + tile.badge + '" after its check');
  if (await registrySha(page, CATALOG) !== published) throw new Error('launcher check did not record the hash');
  await page.evaluate((x) => {
    const reg = window.MentriaStore.get('ext', 'registry');
    delete reg.find((e) => e.manifest.id === x).sha256;
    window.MentriaStore.set('ext', 'registry', reg);
  }, CATALOG);
  await open(page, '/tools/extensions/run/?id=' + CATALOG);
  await mounted(page);
  const b = await titleBadge(page);
  if (b.shown) throw new Error('run page shows a badge for a catalog file without a recorded hash');
  if (await registrySha(page, CATALOG) !== published) throw new Error('run page did not record the hash');
});

check('older catalog version shows no badge', async (page) => {
  const older = olderCatalogFile(CATALOG);
  await watchAccessBadges(page);
  await seedInstall(page, older, true);
  await open(page, '/tools/extensions/run/?id=' + CATALOG);
  await mounted(page);
  let b = await titleBadge(page);
  if (b.shown) throw new Error('run page shows a badge for v' + older.manifest.version + ' installed from the catalog');
  let tile = await launcherTile(page, CATALOG);
  if (tile.badge) throw new Error('launcher tile shows "' + tile.badge + '" for an earlier catalog version');
  await seedInstall(page, older, false);
  tile = await launcherTile(page, CATALOG);
  if (tile.badge) throw new Error('launcher tile shows "' + tile.badge + '" for an earlier catalog version with no recorded hash');
  if (await registrySha(page, CATALOG) !== older.sha256) throw new Error('launcher did not record the earlier published hash');
  let seen = await page.evaluate(() => window.__accessSeen);
  if (seen.length) throw new Error('launcher showed the badge before its check: ' + JSON.stringify(seen));
  await seedInstall(page, older, false);
  const row = await managerRow(page, older.manifest.name);
  if (row.badge) throw new Error('manager row shows "' + row.badge + '" for an earlier catalog version');
  seen = await page.evaluate(() => window.__accessSeen);
  if (seen.length) throw new Error('manager showed the badge before its check: ' + JSON.stringify(seen));
  await page.waitForFunction((id) => !!document.querySelector('#exg-grid .exg__card[data-id="' + id + '"] .exg__actions button.m-btn--primary'), { timeout: 20000 }, CATALOG);
  await page.$eval('#exg-grid .exg__card[data-id="' + CATALOG + '"] .exg__actions button.m-btn--primary', (btn) => btn.click());
  await page.waitForFunction(() => /Dice Roller/.test(document.getElementById('m-dialog-msg').textContent), { timeout: 10000 });
  const prompt = await page.$eval('#m-dialog-msg', (el) => el.textContent);
  if (prompt.includes('full access')) throw new Error('update to the verified catalog file says full access: ' + prompt);
  await page.click('#m-dialog-ok');
  await page.waitForFunction((id, v) => { const r = (window.MentriaStore.get('ext', 'registry') || []).find((e) => e.manifest.id === id); return r && r.manifest.version !== v && !!r.sha256; }, { timeout: 20000 }, CATALOG, older.manifest.version);
  await open(page, '/extensions/' + CATALOG + '/');
  await mounted(page);
  b = await titleBadge(page);
  if (b.shown) throw new Error('store page shows a badge after the catalog update');
});

check('run page clears command hash after mount', async (page) => {
  const manifest = JSON.parse(/id="mentria-ext">([^<]*)</.exec(PASTED_HTML)[1]);
  await seedInstall(page, { manifest, html: PASTED_HTML }, false);
  await open(page, '/tools/extensions/run/?id=' + PASTED + '#cmd=starter&args=hello');
  await mounted(page);
  const got = await page.evaluate(() => ({ hash: location.hash, args: window.__mentriaExtHost && window.__mentriaExtHost.args }));
  if (got.hash !== '') throw new Error('command hash is still in the address: ' + got.hash);
  if (!got.args || got.args.cmd !== 'starter' || got.args.args !== 'hello') throw new Error('extension did not get the command: ' + JSON.stringify(got.args));
});

check('unverified update prompt explains full access', async (page) => {
  await open(page, '/tools/extensions/');
  await page.waitForSelector('#exg-grid .exg__actions button', { timeout: 20000 });
  const paste = async (html, expect, name) => {
    await page.$eval('.xt__paste', (el) => { el.open = true; });
    await page.$eval('#xt-paste', (el, v) => { el.value = v; }, html);
    await page.$eval('#xt-paste-install', (btn) => btn.click());
    await page.waitForFunction((x) => document.getElementById('m-dialog-msg').textContent.includes(x), { timeout: 10000 }, expect);
    const text = await page.$eval('#m-dialog-msg', (el) => el.textContent);
    if (name) await shot(page, name, '#m-dialog');
    await page.click('#m-dialog-ok');
    await page.waitForFunction(() => !document.getElementById('m-dialog-msg').offsetParent, { timeout: 10000 });
    return text;
  };
  await paste(PASTED_HTML, 'Install Paste Check');
  const update = await paste(PASTED_HTML.replace('"version":"1.0.0"', '"version":"1.1.0"'), 'Update Paste Check', 'update-prompt-1280');
  if (!update.includes(ACCESS_NOTE)) throw new Error('update prompt: ' + update);
  const replace = await paste(PASTED_HTML.replace('"version":"1.0.0"', '"version":"1.2.0"').replace('"name":"Paste Check"', '"name":"Paste Renamed"'), 'Replace Paste Check', 'replace-prompt-1280');
  if (!replace.includes(ACCESS_NOTE) || replace.includes('to your data on this device') || replace.includes('to this site')) throw new Error('replace prompt: ' + replace);
});

let failed = 0;
for (const [name, fn] of checks) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.setBypassServiceWorker(true);
    await fn(page);
    if (errors.length) throw new Error('page errors: ' + errors.join(' | '));
    console.log('ok   ' + name);
  } catch (e) {
    failed++;
    console.log('FAIL ' + name + '\n     ' + ((e && e.message) || e));
  }
  await ctx.close();
}
await browser.close();
server.close();
rmSync(PROFILE, { recursive: true, force: true });
console.log(checks.length - failed + '/' + checks.length + ' passed');
if (failed) process.exit(1);
