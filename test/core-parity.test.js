import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { CORE_MODULES, MOBILE_CORE_DIR, mobileCopy, repoRoot, transpileCoreModule } from '../scripts/build-core.mjs';
import path from 'node:path';

// packages/core is the source of truth; every consumer carries a committed,
// generated copy. This suite recompiles the TypeScript and byte-compares
// each copy, so no surface can drift — the modern form of the old
// topics.js three-way parity rule, generalized.

for (const [name, destinations] of Object.entries(CORE_MODULES)) {
  test(`core module ${name} is current in every consumer`, async () => {
    const source = await readFile(path.join(repoRoot, `packages/core/src/${name}.ts`), 'utf8');
    const expected = transpileCoreModule(name, source);
    for (const destination of destinations) {
      const actual = await readFile(path.join(repoRoot, destination), 'utf8');
      assert.equal(actual, expected, `${destination} is stale — run node scripts/build-core.mjs`);
    }
    const mobile = await readFile(path.join(repoRoot, MOBILE_CORE_DIR, `${name}.ts`), 'utf8');
    assert.equal(mobile, mobileCopy(name, source), `${MOBILE_CORE_DIR}/${name}.ts is stale — run node scripts/build-core.mjs`);
  });
}

test('the consumers import the shared modules, not private copies', async () => {
  const main = await readFile(path.join(repoRoot, 'src/main.js'), 'utf8');
  assert.match(main, /from '\.\/feed-item\.js'/, 'the web app renders through the shared domain model');
  assert.doesNotMatch(main, /const annotationToFeedItem/, 'the mapping must not be redefined locally');
  const api = await readFile(path.join(repoRoot, 'src/api.js'), 'utf8');
  assert.match(api, /createApiClient\(\)/, 'the web api surface is the shared client');
  const panel = await readFile(path.join(repoRoot, 'extension/sidepanel.js'), 'utf8');
  assert.match(panel, /from '\.\/topics\.js'/);
  assert.match(panel, /from '\.\/clip-range\.js'/);
  assert.match(panel, /from '\.\/deep-link\.js'/);
});
