import crypto from 'node:crypto';

export const LOCALES = ['en', 'es', 'fr', 'ja', 'pt-BR'];
export const CDN = 'https://cdn.mentria.ai/stories';
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
export const MAX_SLIDES = 12;
export const FORMAT = 'mentria-story-submission-2';

const ATTACHMENT = /https:[/][/](?:github[.]com[/]user-attachments[/]assets[/][0-9a-f-]{36}|(?:private-)?user-images[.]githubusercontent[.]com[/][^\s)"'<>]+)/gi;
const DOWNLOAD_HOST = /^https:[/][/](?:github[.]com|(?:[a-z0-9-]+[.])?githubusercontent[.]com)[/]/i;
const ASSET_BUCKET = /^https:[/][/]github-production-user-asset-[0-9a-f]+[.]s3[.]amazonaws[.]com[/]/i;
const MARKUP = /[<>]|&(?:#[0-9]+|#x[0-9a-f]+|[a-z][a-z0-9]*);/i;
const TITLE_CHARS = /[<>[\]`]/;
const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;
const CDN_FILE = /^(?:00_cover|[0-9]{2})[.]webp$/;

export class SubmissionError extends Error {}

export function parseSubmission(body) {
  const m = /```json\s*\n([\s\S]*?)\n```/.exec(String(body || ''));
  if (!m) throw new SubmissionError('no json block in the issue body');
  let sub;
  try { sub = JSON.parse(m[1]); } catch (e) { throw new SubmissionError('story data is not valid JSON: ' + e.message); }
  if (!sub || sub.format !== FORMAT) throw new SubmissionError('unknown story data format');
  return sub;
}

function plain(value, max, field) {
  const s = String(value).replace(CONTROL, '').trim().slice(0, max);
  if (MARKUP.test(s)) throw new SubmissionError(field + ' contains HTML or an HTML entity; use plain text');
  return s;
}

export function cleanText(value, max, field) {
  if (value == null) return '';
  if (typeof value === 'string') return plain(value, max, field);
  if (typeof value === 'object') {
    const out = {};
    for (const k of LOCALES) {
      if (typeof value[k] !== 'string') continue;
      const s = plain(value[k], max, field + ' (' + k + ')');
      if (s) out[k] = s;
    }
    if (!out.en) return '';
    return Object.keys(out).length === 1 ? out.en : out;
  }
  return '';
}

export function cleanTitle(value) {
  const title = plain(String(value || '').replace(/[\r\n]+/g, ' '), 60, 'title');
  if (!title) throw new SubmissionError('missing title');
  if (TITLE_CHARS.test(title)) throw new SubmissionError('title may not contain < > [ ] or backticks');
  return title;
}

export function readStory(sub) {
  const title = cleanTitle(sub.title);
  const subtitle = cleanText(sub.subtitle, 140, 'subtitle') || title;
  const credit = cleanText(typeof sub.credit === 'string' ? sub.credit : '', 60, 'credit');
  const slides = Array.isArray(sub.slides) ? sub.slides : [];
  if (!slides.length || slides.length > MAX_SLIDES) throw new SubmissionError('need 1–' + MAX_SLIDES + ' slides');
  const parsed = slides.map((s, i) => {
    const caption = cleanText(s && s.caption, 200, 'slide ' + (i + 1) + ' caption');
    if (!caption) throw new SubmissionError('slide ' + (i + 1) + ' has no caption');
    const longPress = cleanText(s && s.long_press, 600, 'slide ' + (i + 1) + ' text');
    return { caption, long_press: longPress };
  });
  const cover = Math.min(Math.max(1, Number(sub.cover) || 1), slides.length) - 1;
  return { title, subtitle, credit, slides: parsed, cover };
}

export function attachmentUrls(body) {
  const seen = new Set();
  const urls = [];
  for (const m of String(body || '').matchAll(ATTACHMENT)) {
    if (!seen.has(m[0])) { seen.add(m[0]); urls.push(m[0]); }
  }
  return urls;
}

export function isGithubHost(url) {
  return DOWNLOAD_HOST.test(String(url));
}

export function isAssetHost(url) {
  return isGithubHost(url) || ASSET_BUCKET.test(String(url));
}

export async function readCapped(response, max) {
  const declared = Number(response.headers.get('content-length'));
  if (declared > max) throw new SubmissionError('image is larger than ' + Math.round(max / 1048576) + ' MB');
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > max) throw new SubmissionError('image is larger than ' + Math.round(max / 1048576) + ' MB');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}

export function imageKind(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

export function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function slugFor(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'story';
}

export function slideFile(i) {
  return String(i + 1).padStart(2, '0') + '.webp';
}

export function storyEntry({ id, story, files, issueNumber }) {
  const base = CDN + '/' + id;
  const entry = {
    id,
    type: 'story',
    title: story.title,
    subtitle: story.subtitle,
    cover_image: base + '/00_cover.webp',
    status: 'published',
    slides: story.slides.map((s, i) => ({
      id: id + '-s' + String(i + 1).padStart(2, '0'),
      story_type: 'story',
      caption: s.caption,
      ...(s.long_press ? { long_press: s.long_press } : {}),
      image: base + '/' + slideFile(i),
      image_status: 'rendered',
      actions: []
    })),
    cdn_files: files
  };
  if (story.credit) entry.credit = story.credit;
  if (issueNumber) entry.submission = issueNumber;
  return entry;
}

export function feedEntry(entry, date) {
  const count = entry.slides.length;
  const caption = typeof entry.subtitle === 'string'
    ? entry.subtitle + ' ' + count + ' cards.'
    : Object.fromEntries(Object.entries(entry.subtitle).map(([k, v]) => [k, v + ' ' + count + ' cards.']));
  return {
    type: 'chapter',
    id: entry.id,
    src: entry.cover_image,
    color: 'linear-gradient(160deg, #0e1a15 0%, #14352a 50%, #0a0f0d 100%)',
    title: entry.title,
    caption,
    badge: 'STORY',
    tags: ['story', 'community'],
    date,
    link: '/feed/story/' + entry.id + '/'
  };
}

export function applyStory(stories, feed, entry, feedItem) {
  if (stories.some((d) => d.id === entry.id)) throw new SubmissionError('a story with id ' + entry.id + ' already exists');
  const order = Math.max(0, ...stories.map((d) => d.order || 0)) + 1;
  const withOrder = { id: entry.id, type: entry.type, order, ...entry };
  return { stories: [...stories, withOrder], feed: [...feed, feedItem] };
}

export function checkFiles(entry, files) {
  const expected = entry && entry.cdn_files;
  if (!expected || typeof expected !== 'object') return ['the merged story has no cdn_files hashes'];
  const problems = [];
  for (const name of Object.keys(expected)) {
    if (!CDN_FILE.test(name)) problems.push(name + ': unexpected file name');
    const buf = files[name];
    if (!buf) { problems.push(name + ': missing'); continue; }
    if (buf.length > MAX_IMAGE_BYTES) problems.push(name + ': too large');
    if (imageKind(buf) !== 'webp') problems.push(name + ': not a WebP image');
    if (sha256(buf) !== expected[name]) problems.push(name + ': hash does not match the merged story');
  }
  for (const name of Object.keys(files)) if (!(name in expected)) problems.push(name + ': not listed in the merged story');
  return problems;
}
