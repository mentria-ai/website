import fs from 'node:fs';
import path from 'node:path';
import { applyStory, SubmissionError } from './lib.mjs';

const dir = path.resolve(process.argv[2] || 'out/story');

try {
  const { entry, feed: feedItem } = JSON.parse(fs.readFileSync(path.join(dir, 'story.json'), 'utf8'));
  const stories = JSON.parse(fs.readFileSync('src/_data/stories.json', 'utf8'));
  const feed = JSON.parse(fs.readFileSync('src/_data/feed.json', 'utf8'));
  const next = applyStory(stories, feed, entry, feedItem);
  fs.writeFileSync('src/_data/stories.json', JSON.stringify(next.stories, null, 2) + '\n');
  fs.writeFileSync('src/_data/feed.json', JSON.stringify(next.feed, null, 2) + '\n');
  console.log('applied', entry.id);
} catch (e) {
  console.error('FAIL:', e instanceof SubmissionError ? e.message : (e && e.stack) || e);
  process.exit(1);
}
