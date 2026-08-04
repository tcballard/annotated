import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('staging media smoke is guarded, uses production boundaries, and cleans its fixture', async () => {
  const script = await readFile(new URL('../scripts/accept-staging-media.mjs', import.meta.url), 'utf8');
  assert.match(script, /ACCEPTANCE_MEDIA_SMOKE !== '1'/);
  assert.match(script, /ANNOTATED_STORAGE, 'postgres'/);
  assert.match(script, /ANNOTATED_ASSET_STORAGE, 's3'/);
  assert.match(script, /annotated-staging\.up\.railway\.app/);
  assert.match(script, /samplelib\.com\/lib\/preview\/mp3/);
  assert.match(script, /redirect: 'manual'/);
  assert.match(script, /removeStoredMedia\(media\)/);
  assert.match(script, /mediaJobs: \(store\.mediaJobs \|\| \[\]\)\.filter/);
  assert.match(script, /closeStore\(\)/);
});
