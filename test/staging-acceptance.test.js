import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('staging acceptance command verifies only public, non-mutating boundaries', async () => {
  const script = await readFile(new URL('../scripts/accept-staging.mjs', import.meta.url), 'utf8');
  assert.match(script, /STAGING_ORIGIN/);
  assert.match(script, /\/api\/health/);
  assert.match(script, /\/api\/ready/);
  assert.match(script, /\/api\/auth\/providers/);
  assert.match(script, /\/api\/auth\/\$\{provider\}\/start/);
  assert.match(script, /getSetCookie/);
  assert.match(script, /\/privacy\.html/);
  assert.match(script, /\/api\/me/);
  assert.match(script, /\/api\/claims/);
  assert.doesNotMatch(script, /POST|PUT|PATCH|DELETE/);
});

test('staging rate-limit smoke is guarded, shared, and cleans its bucket', async () => {
  const script = await readFile(new URL('../scripts/accept-staging-rate-limit.mjs', import.meta.url), 'utf8');
  assert.match(script, /ACCEPTANCE_RATE_LIMIT_SMOKE/);
  assert.match(script, /ANNOTATED_STORAGE !== 'postgres'/);
  assert.match(script, /annotated-staging\.up\.railway\.app/);
  assert.match(script, /result\.shared/);
  assert.match(script, /DELETE FROM annotated_rate_limit_buckets/);
  assert.match(script, /closeRateLimitStore/);
});

test('staging media smoke covers audio and video delivery with cleanup', async () => {
  const script = await readFile(new URL('../scripts/accept-staging-media.mjs', import.meta.url), 'utf8');
  assert.match(script, /ACCEPTANCE_MEDIA_SMOKE/);
  assert.match(script, /sample-3s\.mp3/);
  assert.match(script, /sample-5s\.mp4/);
  assert.match(script, /audio\\\/webm/);
  assert.match(script, /video\\\/mp4/);
  assert.match(script, /removeStoredMedia/);
  assert.match(script, /media worker did not reach ready/);
});
