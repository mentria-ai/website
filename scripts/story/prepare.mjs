import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { parseSubmission, readStory, attachmentUrls, isGithubHost, isAssetHost, readCapped, imageKind, sha256, slugFor, slideFile, storyEntry, feedEntry, SubmissionError, CDN, MAX_IMAGE_BYTES } from './lib.mjs';

const W = 832, H = 1472;
const body = process.env.ISSUE_BODY || '';
const issueNumber = Number(process.env.ISSUE_NUMBER) || 0;
const token = process.env.GITHUB_TOKEN || '';
const out = path.resolve(process.argv[2] || 'out/story');
const agent = { 'User-Agent': 'mentria-story-publish' };

async function download(url) {
  if (!isGithubHost(url)) throw new SubmissionError('images must be uploaded to the issue itself: ' + url);
  let target = url;
  for (let hop = 0; hop < 4; hop++) {
    const headers = hop === 0 && token ? { ...agent, Authorization: 'Bearer ' + token } : agent;
    const r = await fetch(target, { redirect: 'manual', headers });
    if (r.status >= 300 && r.status < 400) {
      const next = new URL(r.headers.get('location') || '', target).href;
      if (!isAssetHost(next)) throw new SubmissionError('image redirected outside GitHub: ' + url);
      target = next;
      continue;
    }
    if (!r.ok) throw new SubmissionError('download ' + r.status + ' ' + url);
    return readCapped(r, MAX_IMAGE_BYTES);
  }
  throw new SubmissionError('too many redirects for ' + url);
}

async function cdnHas(id) {
  try {
    const r = await fetch(CDN + '/' + id + '/00_cover.webp', { method: 'HEAD', headers: agent });
    return r.status !== 404;
  } catch (_) {
    return true;
  }
}

try {
  const sub = parseSubmission(body);
  const story = readStory(sub);
  const urls = attachmentUrls(body);
  if (urls.length !== story.slides.length) {
    throw new SubmissionError(`found ${urls.length} image attachment(s) but the story has ${story.slides.length} slide(s). Drag exactly one image per slide into the issue, in order`);
  }

  const stories = JSON.parse(fs.readFileSync('src/_data/stories.json', 'utf8'));
  const pending = new Set(String(process.env.PENDING_IDS || '').split('\n').map((s) => s.trim()).filter(Boolean));
  const slug = slugFor(story.title);
  let id = 'story-' + slug;
  for (let n = 2; stories.some((d) => d.id === id) || pending.has(id) || await cdnHas(id); n++) {
    if (n > 50) throw new SubmissionError('could not find a free story id for ' + slug);
    id = 'story-' + slug + '-' + n;
  }

  const imageDir = path.join(out, 'images');
  fs.mkdirSync(imageDir, { recursive: true });
  const files = {};
  for (let i = 0; i < urls.length; i++) {
    const raw = await download(urls[i]);
    if (!imageKind(raw)) throw new SubmissionError('slide ' + (i + 1) + ' is not a PNG, JPEG or WebP image');
    const webp = await sharp(raw, { limitInputPixels: 40_000_000 }).rotate().resize(W, H, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
    fs.writeFileSync(path.join(imageDir, slideFile(i)), webp);
    files[slideFile(i)] = sha256(webp);
    if (i === story.cover) {
      fs.writeFileSync(path.join(imageDir, '00_cover.webp'), webp);
      files['00_cover.webp'] = sha256(webp);
    }
    console.log('encoded slide', i + 1, webp.length, 'bytes');
  }

  const entry = storyEntry({ id, story, files, issueNumber });
  const feedItem = feedEntry(entry, new Date().toISOString().slice(0, 10));
  fs.writeFileSync(path.join(out, 'story.json'), JSON.stringify({ entry, feed: feedItem, sources: urls, issue: issueNumber }, null, 2) + '\n');
  const safeTitle = story.title.replace(/[\r\n"]/g, ' ');
  fs.appendFileSync(process.env.GITHUB_OUTPUT || '/dev/null', `story_id=${id}\ntitle=${safeTitle}\n`);
  console.log('prepared', id, '|', story.slides.length, 'slides');
} catch (e) {
  console.error('FAIL:', e instanceof SubmissionError ? e.message : (e && e.stack) || e);
  process.exit(1);
}
