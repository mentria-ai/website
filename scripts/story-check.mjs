import assert from 'node:assert/strict';
import http from 'node:http';
import * as S from './story/lib.mjs';

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const fence = '`'.repeat(3);
const issue = (data, extra = '') => 'Story text\n\n' + fence + 'json\n' + JSON.stringify(data) + '\n' + fence + '\n' + extra;
const base = { format: S.FORMAT, title: 'The Lighthouse', subtitle: 'A keeper and a storm', slides: [{ caption: 'One' }, { caption: 'Two', long_press: 'More text' }] };
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);

test('parses the json block of a submission', () => {
  assert.equal(S.parseSubmission(issue(base)).title, 'The Lighthouse');
});

test('rejects a body without a json block, bad json and a wrong format', () => {
  assert.throws(() => S.parseSubmission('no data here'), S.SubmissionError);
  assert.throws(() => S.parseSubmission('x\n' + fence + 'json\n{nope\n' + fence + '\n'), S.SubmissionError);
  assert.throws(() => S.parseSubmission(issue({ ...base, format: 'other' })), S.SubmissionError);
});

test('rejects HTML and HTML entities in every text field', () => {
  const bad = ['<img src=x onerror=alert(1)>', '</script x', 'a &lt;b', 'a &#60;b', 'a &#x3c;b', 'x > y'];
  for (const text of bad) {
    assert.throws(() => S.readStory({ ...base, subtitle: text }), S.SubmissionError, 'subtitle ' + text);
    assert.throws(() => S.readStory({ ...base, slides: [{ caption: text }] }), S.SubmissionError, 'caption ' + text);
    assert.throws(() => S.readStory({ ...base, slides: [{ caption: 'ok', long_press: text }] }), S.SubmissionError, 'long_press ' + text);
    assert.throws(() => S.readStory({ ...base, slides: [{ caption: { en: 'ok', ja: text } }] }), S.SubmissionError, 'localized ' + text);
  }
});

test('keeps plain text, a bare ampersand and localized maps', () => {
  const s = S.readStory({ ...base, subtitle: { en: 'Tom & Jerry', fr: 'Tom et Jerry' }, credit: 'Ann' });
  assert.deepEqual(s.subtitle, { en: 'Tom & Jerry', fr: 'Tom et Jerry' });
  assert.equal(s.credit, 'Ann');
  assert.equal(s.slides[1].long_press, 'More text');
});

test('strips control characters and caps lengths', () => {
  const s = S.readStory({ ...base, subtitle: 'a' + String.fromCharCode(7) + 'b', slides: [{ caption: 'x'.repeat(500) }] });
  assert.equal(s.subtitle, 'ab');
  assert.equal(s.slides[0].caption.length, 200);
});

test('titles stay plain: no brackets, angle brackets or backticks, newlines become spaces', () => {
  for (const t of ['[link](https://x.example)', 'a `code` b', 'a <b> c']) assert.throws(() => S.cleanTitle(t), S.SubmissionError, t);
  assert.equal(S.cleanTitle('Line one\nline two'), 'Line one line two');
  assert.equal(S.cleanTitle('The Lighthouse (Part 1)'), 'The Lighthouse (Part 1)');
  assert.throws(() => S.cleanTitle('   '), S.SubmissionError);
});

test('needs one to twelve slides, each with a caption', () => {
  assert.throws(() => S.readStory({ ...base, slides: [] }), S.SubmissionError);
  assert.throws(() => S.readStory({ ...base, slides: Array.from({ length: 13 }, () => ({ caption: 'c' })) }), S.SubmissionError);
  assert.throws(() => S.readStory({ ...base, slides: [{ caption: '' }] }), S.SubmissionError);
  assert.equal(S.readStory({ ...base, cover: 9 }).cover, 1);
});

test('takes only GitHub attachment URLs, in order and once each', () => {
  const a = 'https://github.com/user-attachments/assets/0f2c3b2a-1111-4222-8333-444455556666';
  const b = 'https://private-user-images.githubusercontent.com/1/2-abc.png?jwt=x';
  const body = issue(base, `![1](${a}) ![x](https://cdn.mentria.ai/stories/x/01.webp) ![2](${b}) <img src="https://evil.example/p.png"> ${a}`);
  assert.deepEqual(S.attachmentUrls(body), [a, b]);
});

test('download hosts are GitHub only', () => {
  for (const u of ['https://github.com/user-attachments/assets/x', 'https://private-user-images.githubusercontent.com/1/a.png', 'https://objects.githubusercontent.com/x']) assert.equal(S.isGithubHost(u), true, u);
  for (const u of ['https://evil.example/a.png', 'https://github.com.evil.example/a', 'https://githubusercontent.com.evil.example/a', 'http://github.com/x']) assert.equal(S.isGithubHost(u), false, u);
  assert.equal(S.isGithubHost('https://github-production-user-asset-6210df.s3.amazonaws.com/1/a.png'), false);
});

test('redirects may also land in GitHub\'s user-asset bucket, and nowhere else', () => {
  for (const u of ['https://github-production-user-asset-6210df.s3.amazonaws.com/34599950/a.png?X-Amz-Expires=300', 'https://private-user-images.githubusercontent.com/1/a.png']) assert.equal(S.isAssetHost(u), true, u);
  for (const u of ['https://evil.s3.amazonaws.com/a.png', 'https://github-production-user-asset-6210df.s3.amazonaws.com.evil.example/a', 'https://github-production-user-asset-zz.s3.amazonaws.com/a', 'http://github-production-user-asset-6210df.s3.amazonaws.com/a']) assert.equal(S.isAssetHost(u), false, u);
});

test('recognises PNG, JPEG and WebP by their bytes', () => {
  assert.equal(S.imageKind(png), 'png');
  assert.equal(S.imageKind(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), 'jpeg');
  assert.equal(S.imageKind(webp), 'webp');
  assert.equal(S.imageKind(Buffer.from('<svg onload=alert(1)>')), null);
});

test('reads a download up to the cap and stops beyond it', async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/small') { res.end(Buffer.alloc(1000)); return; }
    if (req.url === '/declared') { res.writeHead(200, { 'Content-Length': 5000 }); res.end(Buffer.alloc(5000)); return; }
    res.writeHead(200);
    let sent = 0;
    const tick = () => { if (sent >= 6000) { res.end(); return; } sent += 500; res.write(Buffer.alloc(500), tick); };
    tick();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + server.address().port;
  try {
    assert.equal((await S.readCapped(await fetch(url + '/small'), 4096)).length, 1000);
    await assert.rejects(S.readCapped(await fetch(url + '/declared'), 4096), S.SubmissionError);
    await assert.rejects(S.readCapped(await fetch(url + '/stream'), 4096), S.SubmissionError);
  } finally {
    server.close();
  }
});

test('builds the story entry with CDN paths and file hashes', () => {
  const story = S.readStory(base);
  const files = { '01.webp': 'a'.repeat(64), '02.webp': 'b'.repeat(64), '00_cover.webp': 'a'.repeat(64) };
  const entry = S.storyEntry({ id: 'story-x', story, files, issueNumber: 7 });
  assert.equal(entry.cover_image, S.CDN + '/story-x/00_cover.webp');
  assert.equal(entry.slides[1].image, S.CDN + '/story-x/02.webp');
  assert.equal(entry.slides[0].long_press, undefined);
  assert.deepEqual(entry.cdn_files, files);
  assert.equal(entry.submission, 7);
  assert.equal(S.feedEntry(entry, '2026-10-13').caption, 'A keeper and a storm 2 cards.');
});

test('applies the story after the existing ones and refuses a duplicate id', () => {
  const entry = S.storyEntry({ id: 'story-x', story: S.readStory(base), files: {}, issueNumber: 0 });
  const next = S.applyStory([{ id: 'story-a', order: 4 }], [], entry, S.feedEntry(entry, '2026-10-13'));
  assert.equal(next.stories[1].order, 5);
  assert.deepEqual(Object.keys(next.stories[1]).slice(0, 4), ['id', 'type', 'order', 'title']);
  assert.equal(next.feed.length, 1);
  assert.throws(() => S.applyStory(next.stories, next.feed, entry, {}), S.SubmissionError);
});

test('accepts uploaded files only when every hash and name matches the merged story', () => {
  const cover = webp;
  const other = Buffer.concat([webp, Buffer.from('x')]);
  const entry = { cdn_files: { '00_cover.webp': S.sha256(cover), '01.webp': S.sha256(other) } };
  assert.deepEqual(S.checkFiles(entry, { '00_cover.webp': cover, '01.webp': other }), []);
  assert.equal(S.checkFiles(entry, { '00_cover.webp': cover, '01.webp': cover }).length, 1);
  assert.equal(S.checkFiles(entry, { '00_cover.webp': cover }).length, 1);
  assert.equal(S.checkFiles(entry, { '00_cover.webp': cover, '01.webp': other, 'evil.html': cover }).length, 1);
  assert.equal(S.checkFiles({ cdn_files: { '01.webp': S.sha256(png) } }, { '01.webp': png }).length, 1);
  assert.equal(S.checkFiles({ cdn_files: { 'a.html': S.sha256(webp) } }, { 'a.html': webp }).length, 1);
  assert.equal(S.checkFiles({}, {}).length, 1);
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log('ok   ' + name);
  } catch (e) {
    failed++;
    console.log('FAIL ' + name);
    console.log('     ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n     ') : e));
  }
}
console.log(tests.length - failed + '/' + tests.length + ' passed');
if (failed) process.exit(1);
