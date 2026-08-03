import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const mainSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

test('every feed annotation exposes a claim action tied to its persisted slug', () => {
  assert.match(mainSource, /class="feed-claim-link"/);
  assert.match(mainSource, /data-claim-slug="\$\{escapeHTML\(item\.slug \|\| ''\)\}"/);
  assert.match(mainSource, /const claimSlug = state\.claimSlug \|\| state\.publishedSlug/);
  assert.match(mainSource, /api\.fileClaim\(claimSlug, reason\)/);
});
