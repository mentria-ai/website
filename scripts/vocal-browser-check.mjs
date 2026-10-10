import { rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';
import { serve } from './scanner-serve.mjs';
import { makeSignal, steps, hz, analyzePitch, midi } from './vocal-signals.mjs';

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

async function addB64(page) {
  await page.evaluateOnNewDocument(() => {
    window.__vtB64 = async (blob) => {
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (let i = 0; i < buf.length; i += 32768) s += String.fromCharCode.apply(null, buf.subarray(i, i + 32768));
      return btoa(s);
    };
  });
}

function notesOfWav(b64) {
  const bytes = Buffer.from(b64, 'base64');
  const { sampleRate, samples } = WAV.decodeWav(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
  return analyzePitch(samples, sampleRate).filter((q) => q.f > 0 && q.clarity > 0.9).map((q) => midi(q.f));
}

const A_MINOR = [9, 11, 0, 2, 4, 5, 7];
const E_MAJOR = [4, 6, 8, 9, 11, 1, 3];
function onScale(notes, scale, cents) {
  return notes.filter((m) => {
    const n = Math.round(m);
    return scale.includes(((n % 12) + 12) % 12) && Math.abs(m - n) * 100 <= cents;
  }).length;
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

check('runtime: the tuned recording of a flat A-minor melody lands on A-minor notes', async (page) => {
  await stubMic(page);
  await addB64(page);
  await page.goto(ORIGIN + '/extensions/vocal-tuner/app/', { waitUntil: 'load' });
  await page.waitForSelector('.vt-takes');
  await page.evaluate(async () => {
    const { createAudio } = await import('/assets/vocal-tuner/audio.js');
    const { createRecorder } = await import('/assets/vocal-tuner/recorder.js');
    window.__tele = [];
    window.__done = null;
    let rec = null;
    const audio = createAudio({
      telemetry: (m) => window.__tele.push(m),
      chunk: (m) => {
        rec.add(m.dry, m.tuned);
        audio.returnChunk(m);
        if (m.last) window.__done = rec.finish();
      }
    });
    window.__audio = audio;
    audio.setSettings({ correction: 1, key: { root: 9, mode: 'minor' } });
    window.__started = await audio.start();
    rec = createRecorder(audio.sampleRate, 300);
    audio.setMonitor('wired', -6);
    audio.record(true);
    await new Promise((r) => setTimeout(r, 4000));
    audio.record(false);
  });
  await page.waitForFunction(() => window.__done, { timeout: 15000 });
  const info = await page.evaluate(() => ({ started: window.__started, voiced: window.__tele.filter((m) => m.voiced).length, tele: window.__tele.length, rate: window.__audio.sampleRate, frames: window.__done.frames }));
  if (info.tele < 40 || info.voiced < 20) throw new Error('telemetry ' + JSON.stringify(info));
  if (typeof info.started.latencyMs !== 'number' || info.started.echoOn) throw new Error('start ' + JSON.stringify(info.started));
  if (info.frames < info.rate * 3) throw new Error('recorded ' + info.frames);
  const tuned = notesOfWav(await page.evaluate(() => window.__vtB64(window.__done.tuned)));
  const dry = notesOfWav(await page.evaluate(() => window.__vtB64(window.__done.dry)));
  if (tuned.length < 100) throw new Error('too few clear frames ' + tuned.length);
  if (onScale(tuned, A_MINOR, 10) < tuned.length * 0.9) throw new Error('tuned on scale ' + onScale(tuned, A_MINOR, 10) + '/' + tuned.length);
  if (onScale(dry, A_MINOR, 10) > dry.length * 0.2) throw new Error('the dry take should stay 30 cents flat');
  await page.evaluate(() => window.__audio.stop());
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
