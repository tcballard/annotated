import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('API and worker hot paths do not materialize the compatibility journal', async () => {
  const api = await readFile(new URL('../server/index.js', import.meta.url), 'utf8');
  const worker = await readFile(new URL('../server/media-worker.js', import.meta.url), 'utf8');
  assert.doesNotMatch(api, /\breadStore\s*\(/);
  assert.doesNotMatch(api, /\bupdateStore\s*\(/);
  assert.doesNotMatch(worker, /\breadStore\s*\(/);
  assert.doesNotMatch(worker, /\bupdateStore\s*\(/);
  assert.match(api, /listFeed\(/);
  assert.match(worker, /claimMediaRecord/);
});
