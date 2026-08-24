import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const body = process.env.ISSUE_BODY || '';
const issueNumber = Number(process.env.ISSUE_NUMBER) || 0;
const token = process.env.GITHUB_TOKEN || '';
const CDN = 'https://cdn.mentria.ai/stories';
const LOCALES = ['en', 'es', 'fr', 'ja', 'pt-BR'];
const W = 832, H = 1472;

function fail(msg) { console.error('FAIL:', msg); process.exit(1); }

const m = /```json\s*\n([\s\S]*?)\n```/.exec(body);
if (!m) fail('no json block in the issue body');
let sub;
try { sub = JSON.parse(m[1]); } catch (e) { fail('story data is not valid JSON: ' + e.message); }
if (sub.format !== 'mentria-story-submission-2') fail('unknown story data format');

function text(v, max) {
  if (v == null) return '';
  if (typeof v === 'string') return v.trim().slice(0, max);
  if (typeof v === 'object') {
    const out = {};
    for (const k of LOCALES) { const s = typeof v[k] === 'string' ? v[k].trim().slice(0, max) : ''; if (s) out[k] = s; }
    if (!out.en) return '';
    return Object.keys(out).length === 1 ? out.en : out;
  }
  return '';
}
const en = (v) => (typeof v === 'string' ? v : (v && v.en) || '');

const title = String(sub.title || '').trim().slice(0, 60);
if (!title) fail('missing title');
const subtitle = text(sub.subtitle, 140) || title;
const credit = String(sub.credit || '').trim().slice(0, 60);
const slides = Array.isArray(sub.slides) ? sub.slides : [];
if (!slides.length || slides.length > 12) fail('need 1–12 slides');
const parsed = slides.map((s, i) => {
  const caption = text(s.caption, 200);
  if (!caption) fail('slide ' + (i + 1) + ' has no caption');
  const long_press = text(s.long_press, 600);
  return { caption, long_press };
});
const coverIdx = Math.min(Math.max(1, Number(sub.cover) || 1), slides.length) - 1;

const urlRe = /https:\/\/(?:github\.com\/user-attachments\/assets\/[0-9a-f-]{36}|user-images\.githubusercontent\.com\/[^\s)">]+|[^\s)">]+\.(?:png|jpe?g|webp)(?:\?[^\s)">]*)?)/gi;
const seen = new Set();
const urls = [];
for (const match of body.matchAll(urlRe)) { if (!seen.has(match[0])) { seen.add(match[0]); urls.push(match[0]); } }
if (urls.length !== slides.length) fail(`found ${urls.length} image attachment(s) but the story has ${slides.length} slide(s) — drop exactly one image per slide, in order`);

async function download(u) {
  let r = await fetch(u, { redirect: 'manual', headers: token ? { Authorization: 'Bearer ' + token, 'User-Agent': 'mentria-story-publish' } : { 'User-Agent': 'mentria-story-publish' } });
  if (r.status >= 300 && r.status < 400 && r.headers.get('location')) r = await fetch(r.headers.get('location'), { headers: { 'User-Agent': 'mentria-story-publish' } });
  if (!r.ok) throw new Error('download ' + r.status + ' ' + u);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > 25 * 1024 * 1024) throw new Error('image too large ' + u);
  return buf;
}

const stories = JSON.parse(fs.readFileSync('src/_data/stories.json', 'utf8'));
const feed = JSON.parse(fs.readFileSync('src/_data/feed.json', 'utf8'));
const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'story';
let sid = 'story-' + slug;
for (let n = 2; stories.some((d) => d.id === sid); n++) sid = 'story-' + slug + '-' + n;
const outDir = path.join('out', sid);
fs.mkdirSync(outDir, { recursive: true });

for (let i = 0; i < urls.length; i++) {
  const raw = await download(urls[i]);
  const webp = await sharp(raw, { limitInputPixels: 40_000_000 }).rotate().resize(W, H, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
  fs.writeFileSync(path.join(outDir, String(i + 1).padStart(2, '0') + '.webp'), webp);
  if (i === coverIdx) fs.writeFileSync(path.join(outDir, '00_cover.webp'), webp);
  console.log('encoded slide', i + 1, webp.length, 'bytes');
}

const base = CDN + '/' + sid;
const order = Math.max(0, ...stories.map((d) => d.order || 0)) + 1;
const story = {
  id: sid,
  type: 'story',
  order,
  title,
  subtitle,
  cover_image: base + '/00_cover.webp',
  status: 'published',
  slides: parsed.map((s, i) => ({
    id: sid + '-s' + String(i + 1).padStart(2, '0'),
    story_type: 'story',
    caption: s.caption,
    ...(s.long_press ? { long_press: s.long_press } : {}),
    image: base + '/' + String(i + 1).padStart(2, '0') + '.webp',
    image_status: 'rendered',
    actions: []
  }))
};
if (credit) story.credit = credit;
if (issueNumber) story.submission = issueNumber;
stories.push(story);
const feedCaption = typeof subtitle === 'string'
  ? subtitle + ' ' + slides.length + ' cards.'
  : Object.fromEntries(Object.entries(subtitle).map(([k, v]) => [k, v + ' ' + slides.length + ' cards.']));
feed.push({
  type: 'chapter',
  id: sid,
  src: base + '/00_cover.webp',
  color: 'linear-gradient(160deg, #0e1a15 0%, #14352a 50%, #0a0f0d 100%)',
  title,
  caption: feedCaption,
  badge: 'STORY',
  tags: ['story', 'community'],
  date: new Date().toISOString().slice(0, 10),
  link: '/feed/story/' + sid + '/'
});
fs.writeFileSync('src/_data/stories.json', JSON.stringify(stories, null, 2) + '\n');
fs.writeFileSync('src/_data/feed.json', JSON.stringify(feed, null, 2) + '\n');
fs.appendFileSync(process.env.GITHUB_OUTPUT || '/dev/null', `story_id=${sid}\ntitle=${title.replace(/[\r\n"]/g, ' ')}\n`);
console.log('prepared', sid, '|', slides.length, 'slides |', en(subtitle));
