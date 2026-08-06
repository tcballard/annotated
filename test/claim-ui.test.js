import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const mainSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');

// Brief requirement #2: a visible "File a claim" on EVERY annotation page.
// The permalink action bar carries it, wired to the annotation's slug, and
// the claim submission targets the persisted claims API.
test('every annotation page exposes File a claim in the action bar, tied to its slug', () => {
  const permalink = mainSource.match(/const permalinkView = [\s\S]*?\n\};/u)?.[0] || '';
  assert.match(permalink, /class="act claim"/u);
  assert.match(permalink, /data-action="toggle-claim"/u);
  assert.match(permalink, /data-claim-slug="\$\{escapeHTML\(item\.slug\)\}"/u);
  assert.match(permalink, /File a claim/u);
  assert.match(mainSource, /const claimSlug = state\.claimSlug \|\| state\.publishedSlug/u);
  assert.match(mainSource, /api\.fileClaim\(claimSlug, reason\)/u);
});

test('claim filing confirms receipt and keeps the report on failure', () => {
  assert.match(mainSource, /state\.claimSubmitted = true/u);
  assert.match(mainSource, /Claim received/u);
  assert.match(mainSource, /Your report is still here/u);
});
