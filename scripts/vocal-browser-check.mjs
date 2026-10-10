import { rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';
import { serve } from './scanner-serve.mjs';
import { makeSignal, steps, hz } from './vocal-signals.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const WAV = await import(pathToFileURL(resolve(here, '../src/assets/vocal-tuner/wav.js')).href);
const BUILD = process.argv[2];
if (!BUILD) { console.log('usage: node scripts/vocal-browser-check.mjs <build dir>'); process.exit(2); }
const ORIGIN = 'http://localhost:8099';
const PROFILE = '/Volumes/Mac ext storage/games-tmp/orch/vocal-check-profile';
const TESTDIR = BUILD + '/__vt-test';
rmSync(PROFILE, { recursive: true, force: true });
mkdirSync(TESTDIR, { recursive: true });

async function writeVoice(name, notes, cents, seconds) {
  const each = seconds / notes.length;
  const x = makeSignal({ pitch: steps(notes.map((m) => hz(m + cents / 100)), each), kind: 'vocal', seconds, amp: 0.5 });
  const i16 = new Int16Array(x.length);
  WAV.floatToInt16(x, i16);
  writeFileSync(TESTDIR + '/' + name, Buffer.from(await WAV.encodeWav([i16], 48000).arrayBuffer()));
}
await writeVoice('voice.wav', [57, 59, 60, 62, 64, 65, 67, 69], -30, 8);

const server = await serve(BUILD, 8099);
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  userDataDir: PROFILE,
  protocolTimeout: 600000,
  args: ['--autoplay-policy=no-user-gesture-required', '--enable-gpu', '--ignore-gpu-blocklist']
});

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

async function stubMic(page, file = 'voice.wav') {
  await page.evaluateOnNewDocument((url) => {
    window.__vtMic = { calls: 0, url };
    navigator.mediaDevices.getUserMedia = async () => {
      window.__vtMic.calls++;
      if (window.__vtMic.fail) throw new DOMException('denied', window.__vtMic.fail);
      const ctx = new AudioContext();
      const res = await fetch(window.__vtMic.url);
      const buf = await ctx.decodeAudioData(await res.arrayBuffer());
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const dst = ctx.createMediaStreamDestination();
      src.connect(dst);
      src.start();
      window.__vtStream = dst.stream;
      return dst.stream;
    };
  }, '/__vt-test/' + file);
}

async function clearData(page) {
  await page.evaluate(async () => {
    const db = await import('/assets/vocal-tuner/db.js');
    for (const tk of await db.listTakes()) await db.deleteTake(tk.id);
    localStorage.removeItem('mentria.vocaltuner.listen');
    localStorage.removeItem('mentria.vocaltuner.settings');
  });
}

check('app: the takes screen renders in every locale without errors', async (page) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  for (const prefix of ['', '/es', '/pt-br', '/fr', '/ja']) {
    await page.goto(ORIGIN + prefix + '/extensions/vocal-tuner/app/', { waitUntil: 'load' });
    await page.waitForSelector('.vt-takes .vt-empty:not([hidden])', { timeout: 15000 });
    const title = await page.$eval('.vt-top__title', (e) => e.textContent);
    if (!title || title.includes('takes.')) throw new Error(prefix + ' title ' + title);
  }
  if (errors.length) throw new Error(errors.join(' | '));
});

check('db: renaming a take keeps its audio readable and delete removes everything', async (page) => {
  await page.goto(ORIGIN + '/extensions/vocal-tuner/app/', { waitUntil: 'load' });
  await page.waitForSelector('.vt-takes');
  await clearData(page);
  const r = await page.evaluate(async () => {
    const db = await import('/assets/vocal-tuner/db.js');
    const wav = await import('/assets/vocal-tuner/wav.js');
    const pcm = new Int16Array(48000).map((_, i) => Math.round(8000 * Math.sin(i / 20)));
    const take = { id: db.newId(), name: 'Test take', createdAt: Date.now(), updatedAt: Date.now(), duration: 1, sampleRate: 48000, settings: { correction: 0.35, key: null }, renderedWith: { correction: 0.35, key: null } };
    await db.saveTake(take, { dry: wav.encodeWav([pcm], 48000), tuned: wav.encodeWav([pcm], 48000) });
    const got = await db.getTake(take.id);
    got.name = 'Renamed';
    await db.updateTake(got);
    const dry = wav.decodeWav(await (await db.getAudio(take.id, 'dry')).arrayBuffer());
    const tuned = wav.decodeWav(await (await db.getAudio(take.id, 'tuned')).arrayBuffer());
    const listed = (await db.listTakes()).map((x) => x.name);
    await db.deleteTake(take.id);
    return { dry: dry.samples.length, tuned: tuned.samples.length, listed, gone: !(await db.getTake(take.id)) && !(await db.getAudio(take.id, 'dry')) && !(await db.getAudio(take.id, 'tuned')) };
  });
  if (r.dry !== 48000 || r.tuned !== 48000 || r.listed[0] !== 'Renamed' || !r.gone) throw new Error(JSON.stringify(r));
});

check('takes: a saved take is listed with its duration and style', async (page) => {
  await page.goto(ORIGIN + '/extensions/vocal-tuner/app/', { waitUntil: 'load' });
  await page.waitForSelector('.vt-takes');
  await clearData(page);
  await page.evaluate(async () => {
    const db = await import('/assets/vocal-tuner/db.js');
    const wav = await import('/assets/vocal-tuner/wav.js');
    const pcm = new Int16Array(96000);
    await db.saveTake({ id: db.newId(), name: 'Morning take', createdAt: Date.now(), updatedAt: Date.now(), duration: 2, sampleRate: 48000, settings: { correction: 1, key: { root: 9, mode: 'minor' } }, renderedWith: { correction: 1, key: { root: 9, mode: 'minor' } } }, { dry: wav.encodeWav([pcm], 48000), tuned: wav.encodeWav([pcm], 48000) });
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.vt-item');
  const r = await page.$eval('.vt-item', (el) => el.textContent);
  if (!r.includes('Morning take') || !r.includes('0:02') || !r.includes('Hard') || !r.includes('A minor')) throw new Error(r);
  await clearData(page);
});

let failed = 0;
for (const [name, fn] of checks) {
  const page = await browser.newPage();
  try {
    await fn(page);
    console.log('ok   ' + name);
  } catch (e) {
    failed++;
    console.log('FAIL ' + name + '\n     ' + ((e && e.message) || e));
  }
  await page.close();
}
await browser.close();
server.close();
rmSync(PROFILE, { recursive: true, force: true });
rmSync(TESTDIR, { recursive: true, force: true });
console.log(checks.length - failed + '/' + checks.length + ' passed');
if (failed) process.exit(1);
