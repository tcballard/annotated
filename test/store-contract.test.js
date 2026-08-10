import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  REQUIRED_STORE_EXTERNAL_GATE_IDS,
  STORE_RECEIPT_MAX_AGE_MS,
  assertExactStoreExternalGateIds,
  assertFreshStoreReceipt,
  inspectStoreReceiptFreshness,
  inspectStoreExternalGateIds,
} from '../server/store-contract.js';

const root = path.resolve(import.meta.dirname, '..');
const read = (relativePath) => readFile(path.join(root, relativePath), 'utf8');

test('Store external-gate contract is immutable and rejects missing, unexpected, or duplicate IDs', () => {
  assert.equal(Object.isFrozen(REQUIRED_STORE_EXTERNAL_GATE_IDS), true);
  assert.equal(inspectStoreExternalGateIds([...REQUIRED_STORE_EXTERNAL_GATE_IDS]).valid, true);
  assert.throws(() => REQUIRED_STORE_EXTERNAL_GATE_IDS.push('unexpected'));
  assert.throws(
    () => assertExactStoreExternalGateIds([...REQUIRED_STORE_EXTERNAL_GATE_IDS, 'oauth-round-trip']),
    /duplicates: oauth-round-trip/,
  );
  assert.throws(
    () => assertExactStoreExternalGateIds([...REQUIRED_STORE_EXTERNAL_GATE_IDS.slice(1), 'unexpected']),
    /missing: developer-account; unexpected: unexpected/,
  );
});

test('Store publication receipts expire and reject future or overlong claims', () => {
  const now = Date.parse('2026-08-10T12:00:00.000Z');
  const valid = {
    checkedAt: '2026-08-10T11:00:00.000Z',
    expiresAt: '2026-08-11T11:00:00.000Z',
  };
  assert.equal(STORE_RECEIPT_MAX_AGE_MS, 86_400_000);
  assert.equal(inspectStoreReceiptFreshness(valid, { now }).valid, true);
  assert.throws(() => assertFreshStoreReceipt({ ...valid, expiresAt: '2026-08-10T12:00:00.000Z' }, { now }), /expired/u);
  assert.throws(() => assertFreshStoreReceipt({ ...valid, checkedAt: '2026-08-10T12:00:01.000Z', expiresAt: '2026-08-11T12:00:01.000Z' }, { now }), /future/u);
  assert.throws(() => assertFreshStoreReceipt({ ...valid, expiresAt: '2026-08-11T11:00:00.001Z' }, { now }), /lifetime/u);
  assert.throws(() => assertFreshStoreReceipt({ checkedAt: valid.checkedAt }, { now }), /expiresAt/u);
});

test('committed Store manifest contains exactly the shared required external-gate inventory', async () => {
  const listing = JSON.parse(await read('store-assets/store-listing.json'));
  const ids = listing.externalGates.map((gate) => gate.id);
  assert.equal(inspectStoreExternalGateIds(ids).valid, true);
  assert.equal(ids.length, REQUIRED_STORE_EXTERNAL_GATE_IDS.length);
});

test('Store checker, artifact build, release truth, and runtime share the exact gate contract', async () => {
  const [checker, builder, truth, runtime] = await Promise.all([
    read('scripts/check-store-readiness.mjs'),
    read('scripts/build-release-artifact.mjs'),
    read('scripts/check-release-truth.mjs'),
    read('server/capabilities.js'),
  ]);
  assert.match(checker, /inspectStoreExternalGateIds/);
  for (const source of [builder, truth, runtime]) assert.match(source, /assertExactStoreExternalGateIds/);
  for (const source of [builder, truth, runtime]) assert.match(source, /assertFreshStoreReceipt/);
});

test('authoritative workflow exposes only the staging protected environment', async () => {
  const workflow = await read('.github/workflows/release-evidence.yml');
  const environmentInput = workflow.match(/release_environment:[\s\S]*?release_origin:/)?.[0] || '';
  assert.match(environmentInput, /default: staging/);
  assert.match(environmentInput, /options:\s*\n\s*- staging/);
  assert.doesNotMatch(environmentInput, /\n\s*- production\s*(?:\n|$)/);
  assert.match(workflow, /if: \$\{\{ inputs\.release_environment == 'staging' \}\}/);
});

test('human Store summary and host-permission explanation match the canonical listing contract', async () => {
  const [listingSource, handoff] = await Promise.all([
    read('store-assets/store-listing.json'),
    read('docs/CHROMEWEBSTORE.md'),
  ]);
  const listing = JSON.parse(listingSource);
  const shortDescription = handoff.match(/\*\*Short Description\*\*\s+([^\n]+)/)?.[1];
  assert.equal(shortDescription, listing.listing.summary);
  assert.match(listing.permissionJustifications['<all_urls>'], /either <all_urls> or a temporary activeTab grant/);
  assert.match(handoff, /either `<all_urls>` or a temporary `activeTab` grant/);
  assert.doesNotMatch(handoff, /only grants to the literal `<all_urls>` pattern/);
});
