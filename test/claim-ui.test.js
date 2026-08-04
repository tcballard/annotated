import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const mainSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

test('public annotation rights action is tied to its persisted slug', () => {
  assert.match(mainSource, /const permalinkView = \(\) =>/);
  assert.match(mainSource, /data-claim-slug="\$\{escapeHTML\(annotation\.slug \|\| ''\)\}"/);
  assert.match(mainSource, /const claimSlug = state\.claimSlug \|\| state\.publishedSlug/);
  assert.match(mainSource, /api\.fileClaim\(claimSlug, reason\)/);
});
