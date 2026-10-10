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
  args: ['--autoplay-policy=no-user-gesture-required', '--enable-gpu', '--ignore-gpu-blocklist', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
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

async function captureNode(page) {
  await page.evaluateOnNewDocument(() => {
    const Native = window.AudioWorkletNode;
    window.__vtPosted = [];
    window.AudioWorkletNode = class extends Native {
      constructor(...args) {
        super(...args);
        window.__vtNode = this;
        const post = this.port.postMessage.bind(this.port);
        this.port.postMessage = (msg, transfer) => {
          window.__vtPosted.push(msg && msg.type);
          return post(msg, transfer);
        };
      }
    };
  });
}

async function openLive(page, mode = 0) {
  await page.waitForSelector('.vt-takes__actions .vt-btn--primary');
  await page.click('.vt-takes__actions .vt-btn--primary');
  await page.waitForSelector('.vt-sheet .vt-option');
  await page.click('.vt-sheet .vt-option:nth-of-type(' + (mode + 1) + ')');
  await page.waitForFunction(() => document.body.dataset.vtState === 'live', { timeout: 20000 });
}

async function freshApp(page) {
  await page.goto(ORIGIN + '/extensions/vocal-tuner/app/', { waitUntil: 'load' });
  await page.waitForSelector('.vt-takes');
  await clearData(page);
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.vt-takes');
}

async function takeCount(page, n, timeout = 15000) {
  await page.waitForFunction(async (n) => {
    const db = await import('/assets/vocal-tuner/db.js');
    return (await db.listTakes()).length === n;
  }, { timeout, polling: 300 }, n);
}

const DOWNLOADS = '/Volumes/Mac ext storage/games-tmp/orch/vocal-downloads';

async function nextDownload(suffix, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const f = readdirSync(DOWNLOADS).find((n) => n.endsWith(suffix));
    if (f) return DOWNLOADS + '/' + f;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('no download ending in ' + suffix);
}

async function seedTake(page, settings) {
  return page.evaluate(async (settings) => {
    const db = await import('/assets/vocal-tuner/db.js');
    const bytes = await (await fetch('/__vt-test/voice.wav')).arrayBuffer();
    const now = Date.now();
    const take = { id: db.newId(), name: 'Seeded take', createdAt: now, updatedAt: now, duration: 8, sampleRate: 48000, settings, renderedWith: settings };
    await db.saveTake(take, { dry: new Blob([bytes], { type: 'audio/wav' }), tuned: new Blob([bytes], { type: 'audio/wav' }) });
    return take.id;
  }, settings);
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

check('live: sing in A minor with the hard style, record, and the take is kept', async (page) => {
  await stubMic(page);
  await freshApp(page);
  await openLive(page, 0);
  await page.waitForFunction(() => { const n = document.querySelector('.vt-note__name'); return n && n.textContent !== '–'; }, { timeout: 10000 });
  await page.click('.vt-keychip');
  await page.waitForSelector('.vt-sheet .vt-keys button');
  await page.click('.vt-sheet .vt-keys button:nth-child(10)');
  await page.click('.vt-sheet .vt-seg button:nth-child(2)');
  await page.click('.vt-sheet .vt-sheet__actions .vt-btn--primary');
  await page.waitForFunction(() => !document.querySelector('.vt-sheet'));
  await page.click('.vt-live .vt-seg button:nth-child(3)');
  const hint = await page.$eval('.vt-hint', (e) => e.hidden);
  if (!hint) throw new Error('the hard-style hint shows although a key is set');
  await page.click('.vt-rec');
  await new Promise((r) => setTimeout(r, 5000));
  await page.click('.vt-rec');
  await takeCount(page, 1);
  const take = await page.evaluate(async () => {
    const db = await import('/assets/vocal-tuner/db.js');
    const [tk] = await db.listTakes();
    return { duration: tk.duration, settings: tk.settings, tuned: !!(await db.getAudio(tk.id, 'tuned')), dry: !!(await db.getAudio(tk.id, 'dry')) };
  });
  if (take.duration < 4.5 || take.duration > 6 || take.settings.correction !== 1 || !take.settings.key || take.settings.key.root !== 9 || take.settings.key.mode !== 'minor' || !take.tuned || !take.dry) throw new Error(JSON.stringify(take));
  await page.click('.vt-live .vt-top .vt-icon-btn');
  await page.waitForSelector('.vt-item');
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.vt-item');
  const row = await page.$eval('.vt-item', (e) => e.textContent);
  if (!row.includes('Hard') || !row.includes('A minor') || !row.includes('0:05')) throw new Error(row);
  await clearData(page);
});

check('live: find my key hears an A minor melody', async (page) => {
  await stubMic(page);
  await freshApp(page);
  await openLive(page, 0);
  await page.click('.vt-keychip');
  await page.waitForSelector('.vt-sheet .vt-find-btn');
  await page.click('.vt-sheet .vt-find-btn');
  await page.waitForSelector('.vt-sheet .vt-find__result', { timeout: 30000 });
  const text = await page.$eval('.vt-sheet .vt-find__result', (e) => e.textContent);
  if (!/A minor|C major/.test(text)) throw new Error('result ' + text);
  await page.click('.vt-sheet .vt-find-use');
  await page.waitForFunction(() => !document.querySelector('.vt-sheet'));
  const chip = await page.$eval('.vt-keychip', (e) => e.textContent);
  if (!/A minor|C major/.test(chip)) throw new Error('chip ' + chip);
});

check('live: a denied microphone shows the allow screen with try again', async (page) => {
  await stubMic(page);
  await page.evaluateOnNewDocument(() => { window.__vtMic.fail = 'NotAllowedError'; });
  await page.goto(ORIGIN + '/extensions/vocal-tuner/app/', { waitUntil: 'load' });
  await page.waitForSelector('.vt-takes');
  await page.evaluate(() => localStorage.setItem('mentria.vocaltuner.listen', JSON.stringify({ mode: 'wired', db: { wired: -6, speaker: -18 } })));
  await page.click('.vt-takes__actions .vt-btn--primary');
  await page.waitForFunction(() => document.body.dataset.vtState === 'error', { timeout: 10000 });
  const msg = await page.$eval('.vt-error__msg', (e) => e.textContent);
  if (!msg.toLowerCase().includes('microphone')) throw new Error(msg);
  if (!(await page.$('.vt-error .vt-btn--primary'))) throw new Error('no try again');
});

async function errorScreen(page, setup) {
  await stubMic(page);
  await page.evaluateOnNewDocument(setup);
  await page.goto(ORIGIN + '/extensions/vocal-tuner/app/', { waitUntil: 'load' });
  await page.waitForSelector('.vt-takes');
  await page.evaluate(() => localStorage.setItem('mentria.vocaltuner.listen', JSON.stringify({ mode: 'wired', db: { wired: -6, speaker: -18 } })));
  await page.click('.vt-takes__actions .vt-btn--primary');
  await page.waitForFunction(() => document.body.dataset.vtState === 'error', { timeout: 10000 });
  return page.evaluate(() => ({ msg: document.querySelector('.vt-error__msg').textContent, retry: !!document.querySelector('.vt-error .vt-btn--primary') }));
}

check('live: no microphone gets its own screen with try again', async (page) => {
  const r = await errorScreen(page, () => { window.__vtMic.fail = 'NotFoundError'; });
  if (r.msg !== 'No microphone found.' || !r.retry) throw new Error(JSON.stringify(r));
});

check('live: a browser without AudioWorklet gets the unsupported screen and no retry', async (page) => {
  const r = await errorScreen(page, () => { delete window.AudioWorkletNode; });
  if (!r.msg.includes('live audio processing') || r.retry) throw new Error(JSON.stringify(r));
});

check('live: an audio context that cannot start asks for a tap, and the tap starts it', async (page) => {
  await stubMic(page);
  await page.evaluateOnNewDocument(() => {
    const Native = window.AudioContext;
    window.__vtBlockStart = true;
    window.AudioContext = class extends Native {
      constructor(...args) {
        super(...args);
        if (window.__vtBlockStart) {
          this.suspend();
          this.resume = () => new Promise(() => {});
        }
      }
    };
  });
  await page.goto(ORIGIN + '/extensions/vocal-tuner/app/', { waitUntil: 'load' });
  await page.waitForSelector('.vt-takes');
  await page.evaluate(() => localStorage.setItem('mentria.vocaltuner.listen', JSON.stringify({ mode: 'wired', db: { wired: -6, speaker: -18 } })));
  await page.click('.vt-takes__actions .vt-btn--primary');
  await page.waitForFunction(() => document.body.dataset.vtState === 'resume', { timeout: 15000 });
  await page.evaluate(() => { window.__vtBlockStart = false; });
  await page.click('.vt-resume-btn');
  await page.waitForFunction(() => document.body.dataset.vtState === 'live', { timeout: 15000 });
});

check('live: recording stops by itself at the 5-minute cap and saves exactly 5:00', async (page) => {
  await stubMic(page);
  await captureNode(page);
  await freshApp(page);
  await openLive(page, 0);
  await page.click('.vt-rec');
  await page.evaluate(() => {
    const port = window.__vtNode.port;
    for (let i = 0; i < 2400 && document.querySelector('.vt-rec').getAttribute('aria-pressed') === 'true'; i++) {
      port.onmessage({ data: { type: 'chunk', dry: new Int16Array(8192), tuned: new Int16Array(8192), last: false } });
    }
  });
  const stopped = await page.$eval('.vt-rec', (e) => e.getAttribute('aria-pressed'));
  if (stopped !== 'false') throw new Error('recording did not stop at the cap');
  await takeCount(page, 1, 60000);
  const r = await page.evaluate(async () => {
    const db = await import('/assets/vocal-tuner/db.js');
    const [tk] = await db.listTakes();
    return { duration: tk.duration, rate: tk.sampleRate, dry: (await db.getAudio(tk.id, 'dry')).size, tuned: (await db.getAudio(tk.id, 'tuned')).size };
  });
  if (r.duration !== 300 || r.dry !== 44 + 300 * r.rate * 2 || r.tuned !== r.dry) throw new Error(JSON.stringify(r));
  await clearData(page);
});

check('live: speaker mode starts quiet and capped, and feedback mutes it until the chip is used', async (page) => {
  await stubMic(page);
  await captureNode(page);
  await freshApp(page);
  await openLive(page, 1);
  const slider = await page.$eval('.vt-monitor', (e) => ({ value: e.value, max: e.max }));
  if (slider.value !== '-18' || slider.max !== '-6') throw new Error(JSON.stringify(slider));
  await page.evaluate(() => window.__vtNode.port.onmessage({ data: { type: 'howl' } }));
  const msg = await page.$eval('.vt-msg', (e) => e.textContent);
  if (!msg.includes('Feedback')) throw new Error('message ' + msg);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('mentria.vocaltuner.listen')).db.speaker);
  if (stored !== -24) throw new Error('speaker volume ' + stored);
  await page.click('.vt-listen');
  await page.waitForSelector('.vt-sheet .vt-option');
  await page.click('.vt-sheet .vt-option:nth-of-type(2)');
  await page.waitForFunction(() => !document.querySelector('.vt-sheet'));
  const after = await page.evaluate(() => ({ msg: document.querySelector('.vt-msg').textContent, reset: window.__vtPosted.includes('howl-reset') }));
  if (after.msg.includes('Feedback') || !after.reset) throw new Error(JSON.stringify(after));
});

check('render: the worker re-tunes a flat take onto E major and can be cancelled', async (page) => {
  await addB64(page);
  await page.goto(ORIGIN + '/extensions/vocal-tuner/app/', { waitUntil: 'load' });
  await page.waitForSelector('.vt-takes');
  const b64 = await page.evaluate(async () => {
    const { renderTake } = await import('/assets/vocal-tuner/render.js');
    const dry = await (await fetch('/__vt-test/voice.wav')).blob();
    const out = await renderTake(dry, { correction: 1, key: { root: 4, mode: 'major' } }).promise;
    return window.__vtB64(out);
  });
  const notes = notesOfWav(b64);
  if (notes.length < 300) throw new Error('too few clear frames ' + notes.length);
  if (onScale(notes, E_MAJOR, 10) < notes.length * 0.9) throw new Error('on E major ' + onScale(notes, E_MAJOR, 10) + '/' + notes.length);
  const cancelled = await page.evaluate(async () => {
    const { renderTake } = await import('/assets/vocal-tuner/render.js');
    const wav = await import('/assets/vocal-tuner/wav.js');
    const job = renderTake(wav.encodeWav([new Int16Array(48000 * 120)], 48000), { correction: 1, key: null });
    setTimeout(() => job.cancel(), 50);
    try {
      await job.promise;
      return 'finished';
    } catch (e) {
      return e.name;
    }
  });
  if (cancelled !== 'AbortError') throw new Error('cancel gave ' + cancelled);
});

check('take: A/B keeps the position, and a new key re-renders and replaces the tuned audio', async (page) => {
  await addB64(page);
  await freshApp(page);
  const id = await seedTake(page, { correction: 1, key: { root: 9, mode: 'minor' } });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.vt-item__open');
  await page.click('.vt-item__open');
  await page.waitForSelector('.vt-take .vt-player__play:not([disabled])', { timeout: 15000 });
  await page.click('.vt-player__play');
  await new Promise((r) => setTimeout(r, 1500));
  await page.click('.vt-ab button:nth-child(2)');
  await new Promise((r) => setTimeout(r, 300));
  const ab = await page.evaluate(() => ({ cur: document.querySelector('.vt-player__cur').textContent, label: document.querySelector('.vt-player__play').getAttribute('aria-label'), pressed: document.querySelector('.vt-ab button:nth-child(2)').getAttribute('aria-pressed') }));
  if (ab.cur === '0:00' || ab.label !== 'Pause' || ab.pressed !== 'true') throw new Error('A/B ' + JSON.stringify(ab));
  await page.click('.vt-player__play');
  await page.click('.vt-take .vt-keychip');
  await page.waitForSelector('.vt-sheet .vt-keys button');
  if (await page.$('.vt-sheet .vt-find-btn')) throw new Error('find my key shows on the take screen');
  await page.click('.vt-sheet .vt-keys button:nth-child(5)');
  await page.click('.vt-sheet .vt-seg button:nth-child(1)');
  await page.click('.vt-sheet .vt-sheet__actions .vt-btn--primary');
  await page.waitForSelector('.vt-take .vt-apply');
  await page.click('.vt-take .vt-apply');
  await page.waitForFunction(async (id) => {
    const db = await import('/assets/vocal-tuner/db.js');
    const tk = await db.getTake(id);
    return !!(tk && tk.renderedWith.key && tk.renderedWith.key.root === 4);
  }, { timeout: 30000, polling: 300 }, id);
  await page.waitForFunction(() => document.querySelector('.vt-take__apply').hidden, { timeout: 10000 });
  const notes = notesOfWav(await page.evaluate(async (id) => {
    const db = await import('/assets/vocal-tuner/db.js');
    return window.__vtB64(await db.getAudio(id, 'tuned'));
  }, id));
  if (onScale(notes, E_MAJOR, 10) < notes.length * 0.9) throw new Error('the re-rendered take is not on E major');
  await page.click('.vt-take .vt-top .vt-icon-btn');
  await page.waitForSelector('.vt-item');
  const row = await page.$eval('.vt-item', (e) => e.textContent);
  if (!row.includes('E major')) throw new Error(row);
  await clearData(page);
});

check('take: export downloads valid tuned and original WAV files', async (page) => {
  rmSync(DOWNLOADS, { recursive: true, force: true });
  mkdirSync(DOWNLOADS, { recursive: true });
  const session = await browser.target().createCDPSession();
  await session.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOADS });
  await freshApp(page);
  await seedTake(page, { correction: 0.35, key: null });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.vt-item__more');
  await page.click('.vt-item__more');
  await page.click('.vt-menu__item:nth-child(2)');
  await page.waitForSelector('.vt-sheet .vt-export-tuned', { timeout: 15000 });
  await page.click('.vt-sheet .vt-export-tuned');
  const tuned = readFileSync(await nextDownload('Seeded take.wav'));
  await page.waitForSelector('.vt-take-export:not([disabled])');
  await page.click('.vt-take-export');
  await page.waitForSelector('.vt-sheet .vt-export-dry');
  await page.click('.vt-sheet .vt-export-dry');
  const dry = readFileSync(await nextDownload('(original).wav'));
  for (const [name, buf] of [['tuned', tuned], ['original', dry]]) {
    if (buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WAVE') throw new Error(name + ' is not a WAV');
    if (buf.length !== 44 + 8 * 48000 * 2) throw new Error(name + ' size ' + buf.length);
  }
  await clearData(page);
});

check('take: delete asks first, then removes the take and its audio', async (page) => {
  await freshApp(page);
  const id = await seedTake(page, { correction: 0.35, key: null });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.vt-item__open');
  await page.click('.vt-item__open');
  await page.waitForSelector('.vt-take-delete');
  await page.click('.vt-take-delete');
  await page.waitForSelector('.vt-sheet .vt-btn--danger');
  await page.click('.vt-sheet .vt-btn--danger');
  await page.waitForSelector('.vt-takes .vt-empty:not([hidden])');
  const gone = await page.evaluate(async (id) => {
    const db = await import('/assets/vocal-tuner/db.js');
    return !(await db.getTake(id)) && !(await db.getAudio(id, 'dry')) && !(await db.getAudio(id, 'tuned'));
  }, id);
  if (!gone) throw new Error('the take or its audio was left behind');
});

check('lifecycle: hiding the app while recording saves the take and asks to resume', async (page) => {
  await stubMic(page);
  await freshApp(page);
  await openLive(page, 0);
  await page.click('.vt-rec');
  await new Promise((r) => setTimeout(r, 2500));
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await takeCount(page, 1);
  const d = await page.evaluate(async () => {
    const db = await import('/assets/vocal-tuner/db.js');
    return (await db.listTakes())[0].duration;
  });
  if (d < 1.5) throw new Error('partial take ' + d);
  await page.waitForFunction(() => document.body.dataset.vtState === 'resume', { timeout: 5000 });
  await page.evaluate(() => {
    delete document.visibilityState;
    delete document.hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.click('.vt-resume-btn');
  await page.waitForFunction(() => document.body.dataset.vtState === 'live', { timeout: 15000 });
  const calls = await page.evaluate(() => window.__vtMic.calls);
  if (calls !== 2) throw new Error('microphone requests ' + calls);
  await clearData(page);
});

check('lifecycle: a muted microphone track asks to resume', async (page) => {
  await stubMic(page);
  await freshApp(page);
  await openLive(page, 0);
  await page.evaluate(() => window.__vtStream.getAudioTracks()[0].dispatchEvent(new Event('mute')));
  await page.waitForFunction(() => document.body.dataset.vtState === 'resume', { timeout: 5000 });
  await page.click('.vt-resume-btn');
  await page.waitForFunction(() => document.body.dataset.vtState === 'live', { timeout: 15000 });
});

check('lifecycle: a new audio device rebuilds the audio and asks how you are listening', async (page) => {
  await stubMic(page);
  await page.evaluateOnNewDocument(() => {
    window.__vtDevices = [{ kind: 'audioinput', deviceId: 'mic', label: 'Mic' }, { kind: 'audiooutput', deviceId: 'spk', label: 'Speaker' }];
    navigator.mediaDevices.enumerateDevices = async () => window.__vtDevices;
  });
  await freshApp(page);
  await openLive(page, 0);
  await new Promise((r) => setTimeout(r, 500));
  await page.evaluate(() => navigator.mediaDevices.dispatchEvent(new Event('devicechange')));
  await new Promise((r) => setTimeout(r, 1800));
  if (await page.$('.vt-sheet .vt-option')) throw new Error('an unchanged device list reopened the listening sheet');
  await page.evaluate(() => {
    window.__vtDevices = window.__vtDevices.concat([{ kind: 'audiooutput', deviceId: 'bt', label: 'Headphones' }]);
    navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
  });
  await page.waitForSelector('.vt-sheet .vt-option', { timeout: 5000 });
  await page.click('.vt-sheet .vt-option:nth-of-type(3)');
  await page.waitForFunction(() => document.body.dataset.vtState === 'live', { timeout: 15000 });
  const r = await page.evaluate(() => ({ calls: window.__vtMic.calls, mode: JSON.parse(localStorage.getItem('mentria.vocaltuner.listen')).mode }));
  if (r.calls !== 2 || r.mode !== 'bluetooth') throw new Error(JSON.stringify(r));
});

check('storage: a full disk keeps the take with retry and export until it is saved', async (page) => {
  await stubMic(page);
  await freshApp(page);
  await openLive(page, 0);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    window.__vtRestorePut = () => { IDBObjectStore.prototype.put = put; };
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'audio') throw new DOMException('full', 'QuotaExceededError');
      return put.apply(this, args);
    };
  });
  await page.click('.vt-rec');
  await new Promise((r) => setTimeout(r, 2000));
  await page.click('.vt-rec');
  await page.waitForSelector('.vt-sheet .vt-retry', { timeout: 10000 });
  const text = await page.$eval('.vt-sheet', (e) => e.textContent);
  if (!text.includes('Storage is full') || !(await page.$('.vt-sheet .vt-export-tuned')) || !(await page.$('.vt-sheet .vt-export-dry'))) throw new Error(text);
  const before = await page.evaluate(async () => (await (await import('/assets/vocal-tuner/db.js')).listTakes()).length);
  if (before !== 0) throw new Error('a take was saved without its audio');
  await page.keyboard.press('Escape');
  if (!(await page.$('.vt-sheet .vt-retry'))) throw new Error('the unsaved take was dismissed before it was saved or exported');
  await page.evaluate(() => window.__vtRestorePut());
  await page.click('.vt-sheet .vt-retry');
  await page.waitForFunction(() => !document.querySelector('.vt-sheet'), { timeout: 10000 });
  await takeCount(page, 1);
  await clearData(page);
});

check('watchdog: when the audio stops reporting it hints at Reset audio and lightens detection', async (page) => {
  await stubMic(page);
  await captureNode(page);
  await freshApp(page);
  await openLive(page, 0);
  await new Promise((r) => setTimeout(r, 1500));
  await page.evaluate(() => { window.__vtNode.port.onmessage = null; });
  await page.waitForFunction(() => document.querySelector('.vt-msg').textContent.includes('Reset audio'), { timeout: 8000 });
  await page.waitForFunction(() => window.__vtPosted.includes('lite'), { timeout: 8000 });
  await page.click('.vt-reset');
  await page.waitForFunction(() => document.body.dataset.vtState === 'live' && !document.querySelector('.vt-msg').textContent.includes('Reset audio'), { timeout: 15000 });
  const calls = await page.evaluate(() => window.__vtMic.calls);
  if (calls !== 2) throw new Error('microphone requests ' + calls);
});

check('host: the store page runs the tuner full screen on a phone and every control is reachable', async (page) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(ORIGIN + '/extensions/vocal-tuner/', { waitUntil: 'load' });
  await page.waitForSelector('#xr-frame');
  await page.evaluate(() => {
    document.documentElement.classList.add('is-standalone');
    const u = document.getElementById('m-update');
    if (u) u.hidden = false;
  });
  const frame = await (await page.$('#xr-frame')).contentFrame();
  const reachable = async (sel) => {
    const pts = await frame.$eval(sel, (el) => { const b = el.getBoundingClientRect(); return [0.25, 0.5, 0.75].map((k) => [b.left + b.width / 2, b.top + b.height * k]); });
    return page.evaluate((pts) => {
      const f = document.getElementById('xr-frame');
      const r = f.getBoundingClientRect(), cs = getComputedStyle(f);
      return pts.every(([x, y]) => document.elementFromPoint(r.left + f.clientLeft + parseFloat(cs.paddingLeft) + x, r.top + f.clientTop + parseFloat(cs.paddingTop) + y) === f);
    }, pts);
  };
  await frame.waitForSelector('.vt-takes__actions .vt-btn--primary', { timeout: 20000 });
  await frame.evaluate(() => localStorage.setItem('mentria.vocaltuner.listen', JSON.stringify({ mode: 'wired', db: { wired: -6, speaker: -18 } })));
  await frame.click('.vt-takes__actions .vt-btn--primary');
  await page.waitForFunction(() => document.getElementById('xr-frame').classList.contains('xr__frame--full'), { timeout: 10000 });
  await frame.waitForFunction(() => document.body.dataset.vtState === 'live', { timeout: 20000 });
  for (const sel of ['.vt-rec', '.vt-live .vt-top .vt-icon-btn', '.vt-reset', '.vt-keychip', '.vt-monitor', '.vt-live .vt-seg button:nth-child(3)']) {
    if (!(await reachable(sel))) throw new Error(sel + ' is covered by the page around the frame');
  }
  await frame.click('.vt-live .vt-top .vt-icon-btn');
  await frame.waitForSelector('.vt-takes');
  const full = await page.evaluate(() => document.getElementById('xr-frame').classList.contains('xr__frame--full') || document.documentElement.classList.contains('ext-full'));
  if (full) throw new Error('the frame stayed full screen after leaving the live screen');
  if (errors.length) throw new Error(errors.join(' | '));
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
rmSync(DOWNLOADS, { recursive: true, force: true });
console.log(checks.length - failed + '/' + checks.length + ' passed');
if (failed) process.exit(1);
