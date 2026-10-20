import crypto from 'node:crypto';

const base = (process.argv[2] || 'https://mentria.ai').replace(/\/$/, '');
const commit = process.argv[3] || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const digest = (buf) => crypto.createHash('sha256').update(buf).digest('base64url');
const fresh = (url) => url + (url.includes('?') ? '&' : '?') + 'live-check=' + Date.now().toString(36);

async function get(url) {
  const r = await fetch(fresh(url), { redirect: 'manual', headers: { 'user-agent': 'mentria-live-check' } });
  return { status: r.status, buf: Buffer.from(await r.arrayBuffer()) };
}

function pick(source, re) {
  const m = re.exec(source);
  return m ? JSON.parse(m[1]) : null;
}

let sw = '';
for (let i = 0; ; i++) {
  sw = (await get(base + '/sw.js')).buf.toString('utf8');
  const live = (/const CACHE_NAME = 'mentria-cache-([0-9a-f]+)'/.exec(sw) || [])[1];
  if (!commit || (live && commit.startsWith(live))) break;
  if (i >= 20) {
    console.error('The live site still serves an older service worker (' + live + ').');
    process.exit(1);
  }
  await sleep(30000);
}

const core = pick(sw, /const INTEGRITY = (\{.*?\});\n/s);
const deckRef = pick(sw, /const DECK_INTEGRITY = (\{.*?\});\n/);
if (!core || !deckRef) {
  console.error('The live service worker carries no fingerprints.');
  process.exit(1);
}
const deckFile = await get(base + deckRef.url);
if (deckFile.status !== 200 || digest(deckFile.buf) !== deckRef.sha) {
  console.error('The live deck fingerprint file does not match the service worker.');
  process.exit(1);
}

const want = Object.assign({}, core, JSON.parse(deckFile.buf.toString('utf8')));
const keys = Object.keys(want);
const changed = [];
const blocked = [];
let next = 0;

async function lane() {
  while (next < keys.length) {
    const key = keys[next++];
    let note = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await get(base + encodeURI(key));
        if (r.status === 200 && digest(r.buf) === want[key]) { note = ''; break; }
        note = r.status === 200 ? 'changed' : String(r.status);
      } catch (e) {
        note = e.message;
      }
      if (attempt < 2) await sleep(4000 * (attempt + 1));
    }
    if (!note) continue;
    if (/^(403|429|5\d\d)$/.test(note) || !/^(changed|\d+)$/.test(note)) blocked.push(key + ' (' + note + ')');
    else changed.push(key + ' (' + note + ')');
  }
}

await Promise.all(Array.from({ length: 8 }, lane));
console.log((keys.length - changed.length - blocked.length) + ' of ' + keys.length + ' live files match the build.');
if (blocked.length) console.log('Not checked (the server refused or failed): ' + blocked.length + '\n' + blocked.slice(0, 20).join('\n'));
if (changed.length) {
  console.error('Live files that differ from the build, which the service worker will not keep offline:\n' + changed.slice(0, 50).join('\n'));
  process.exit(1);
}
