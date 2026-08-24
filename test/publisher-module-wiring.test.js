import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/lib/publishers.js', import.meta.url), 'utf8');

test('live publisher routes use hardened Instagram, Pinterest and TikTok modules', () => {
  assert.match(source, /import \{ publishInstagramImage \} from '\.\/instagram-direct\.js';/);
  assert.match(source, /return publishInstagramImage\(/);

  assert.match(source, /import \{ publishPinterestPin \} from '\.\/pinterest-direct\.js';/);
  assert.match(source, /return publishPinterestPin\(/);

  assert.match(source, /import \{ tiktokDirectPhoto, tiktokDirectVideo \} from '\.\/tiktok-direct\.js';/);
  assert.match(source, /return tiktokDirectPhoto\(/);
  assert.match(source, /return tiktokDirectVideo\(/);
});
