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
