import fs from 'node:fs';
import path from 'node:path';
import { attachmentUrls } from './lib.mjs';

const dir = path.resolve(process.argv[2] || 'out/story');
const { entry, sources, issue } = JSON.parse(fs.readFileSync(path.join(dir, 'story.json'), 'utf8'));
const urls = attachmentUrls((sources || []).join('\n'));
const runUrl = String(process.env.RUN_URL || '');
const lines = [
  'Community story from #' + Number(issue) + ', approved with the `story-approved` label. Review the text in the diff and the images below, then merge to publish it.',
  '',
  '**Source images**, as they were in the issue when it was approved:',
  ''
];
urls.forEach((u, i) => lines.push('![Slide ' + (i + 1) + '](' + u + ')', ''));
lines.push('**On merge**, the "Upload merged story images" workflow fetches the converted WebP files from ' + (runUrl.startsWith('https://github.com/') ? runUrl : 'the approval run') + ', checks each one against the SHA-256 in `stories.json`, and uploads them to `cdn.mentria.ai/stories/' + entry.id + '/`. The story goes live with the next release.');
lines.push('', 'CI runs on this branch automatically.');
process.stdout.write(lines.join('\n') + '\n');
