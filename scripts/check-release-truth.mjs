import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { assertExactStoreExternalGateIds, assertFreshStoreReceipt } from '../server/store-contract.js';

const root = path.resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await readFile(path.join(root, 'config/capabilities.json'), 'utf8'));
const releaseConfig = JSON.parse(await readFile(path.join(root, 'config/release.json'), 'utf8'));
assert.equal(manifest.schemaVersion, 1);
assert.equal(releaseConfig.schemaVersion, 1);
assert.match(manifest.reviewedAt, /^\d{4}-\d{2}-\d{2}$/);
assert.equal(new URL(manifest.canonicalOrigin).protocol, 'https:');
const storeManifestBytes = await readFile(path.join(root, manifest.distribution.store.manifestPath));
const storeManifest = JSON.parse(storeManifestBytes.toString('utf8'));
assert.equal(storeManifest.schemaVersion, 1);
assert.ok(['not-submitted', 'draft', 'submitted', 'in-review', 'staged', 'published', 'rejected', 'unpublished'].includes(storeManifest.listingState.status));
assertExactStoreExternalGateIds((storeManifest.externalGates || []).map((gate) => gate?.id), 'Store manifest external gate IDs');
assert.ok(manifest.capabilities.length >= 10);
assert.equal(new Set(manifest.capabilities.map((item) => item.id)).size, manifest.capabilities.length);
for (const item of manifest.capabilities) {
  assert.ok(item.label && item.summary && item.evidenceUrl, `${item.id} lacks evidence-backed copy`);
  assert.equal(typeof item.implemented, 'boolean');
}

const publicSources = await Promise.all(['src/main.js', 'config/capabilities.json'].map((file) => readFile(path.join(root, file), 'utf8')));
const bannedClaims = [/store listing is in review/i, /store listing is awaiting review/i, /every requirement below is live/i];
for (const pattern of bannedClaims) for (const source of publicSources) assert.doesNotMatch(source, pattern);

const release = JSON.parse(await readFile(path.join(root, 'dist/release/release.json'), 'utf8'));
if (process.env.ANNOTATED_REQUIRE_RELEASE_EVIDENCE === '1') {
  assert.ok(release.evidence?.browser, 'The deployable release must embed authoritative browser and production evidence.');
}
if (process.env.ANNOTATED_REQUIRE_STORE_EVIDENCE === '1') {
  assert.ok(release.evidence?.store, 'A published Store release must embed live Store verification evidence.');
}
assert.equal(manifest.distribution.directArtifact.path, release.artifactPath);
assert.equal(manifest.distribution.directArtifact.checksumPath, release.checksumPath);
const bytes = await readFile(path.join(root, 'dist', release.artifactPath));
assert.equal(createHash('sha256').update(bytes).digest('hex'), release.sha256);
assert.equal(release.version, JSON.parse(await readFile(path.join(root, 'extension/manifest.json'), 'utf8')).version);
assert.equal(releaseConfig.version, release.version);
assert.ok(Number.isSafeInteger(releaseConfig.sourceDateEpoch) && releaseConfig.sourceDateEpoch >= 315_532_800);
assert.equal(storeManifest.release.version, release.version);
if (release.evidence?.browser) {
  const receiptBytes = await readFile(path.join(root, 'dist', release.evidence.browser.receiptPath.replace(/^\/+/, '')));
  assert.equal(createHash('sha256').update(receiptBytes).digest('hex'), release.evidence.browser.sha256);
  assert.equal(receiptBytes.length, release.evidence.browser.bytes);
  const receipt = JSON.parse(receiptBytes.toString('utf8'));
  assert.equal(receipt.kind, 'annotated.release-receipt');
  assert.equal(receipt.authoritative, true);
  assert.equal(receipt.status, 'passed');
  assert.equal(receipt.gitSha, release.gitSha);
  assert.equal(receipt.artifact.version, release.version);
  assert.equal(receipt.artifact.sha256, release.sha256);
}
if (release.evidence?.store) {
  assert.ok(release.evidence.browser, 'Store verification cannot exist without browser release evidence.');
  const receiptBytes = await readFile(path.join(root, 'dist', release.evidence.store.receiptPath.replace(/^\/+/, '')));
  assert.equal(createHash('sha256').update(receiptBytes).digest('hex'), release.evidence.store.sha256);
  assert.equal(receiptBytes.length, release.evidence.store.bytes);
  const receipt = JSON.parse(receiptBytes.toString('utf8'));
  assert.equal(receipt.status, 'verified');
  assert.equal(receipt.listingState, 'published');
  assertFreshStoreReceipt(receipt);
  assert.equal(receipt.gitSha, release.gitSha);
  assert.equal(receipt.version, release.version);
  assert.equal(receipt.artifactSha256, release.sha256);
  assert.equal(receipt.listingManifestSha256, createHash('sha256').update(storeManifestBytes).digest('hex'));
  assertExactStoreExternalGateIds(receipt.externalGateIds, 'Store receipt external gate IDs');
  assert.equal(receipt.itemId, storeManifest.listingState.itemId);
  assert.equal(receipt.publicUrl, storeManifest.listingState.publicUrl);
}
console.log(`Release truth verified: v${release.version}, ${release.sha256}, ${bytes.length} bytes.`);
