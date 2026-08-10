import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  deriveExtensionId,
  liveReleaseMatches,
  readPngDimensions,
  requiredOnlineReceiptChecks,
  storeReceiptStatus,
  validateListingState,
  validateStoreReadiness,
  verifyPublishedStoreListing,
  writeStoreReadinessReceipt,
} from '../scripts/check-store-readiness.mjs';

const root = path.resolve(import.meta.dirname, '..');
const listing = JSON.parse(await readFile(path.join(root, 'store-assets/store-listing.json'), 'utf8'));
const manifest = JSON.parse(await readFile(path.join(root, 'extension/manifest.json'), 'utf8'));
const extensionId = 'omlikcdpcdhfmdojdalfdeihgjmgikkg';

test('Store record is exact, versioned, and covers every requested permission', () => {
  assert.equal(listing.schemaVersion, 1);
  assert.equal(listing.listingState.status, 'not-submitted');
  assert.equal(listing.listingState.publicUrl, null);
  assert.equal(listing.listing.name, manifest.name);
  assert.equal(listing.listing.summary, manifest.description);
  assert.ok(listing.listing.summary.length <= 132);
  assert.equal(listing.release.version, manifest.version);
  assert.equal(listing.verification.receiptPath, 'store-assets/store-readiness-receipt.json');
  assert.equal(listing.verification.requiresOnline, true);
  assert.equal(listing.extensionIdentity.expectedId, deriveExtensionId(manifest.key));
  assert.equal(listing.extensionIdentity.expectedId, extensionId);
  assert.deepEqual(
    Object.keys(listing.permissionJustifications).sort(),
    [...manifest.permissions, ...manifest.host_permissions].sort(),
  );
  assert.equal(listing.privacy.usesRemoteCode, false);
  assert.equal(listing.privacy.limitedUseCertified, true);
  assert.deepEqual(listing.privacy.dataTypes.map((item) => item.dashboardLabel), [
    'Personally identifiable information',
    'Authentication information',
    'Personal communications',
    'Web history',
    'User activity',
    'Website content',
  ]);
  assert.ok(listing.reviewerInstructions.steps.length >= 4);
  assert.match(listing.reviewerInstructions.credentialPlacement, /dashboard/i);
});

test('checked-in Store graphics have the declared Chrome Web Store dimensions', async () => {
  for (const asset of listing.assets.filter((item) => item.status === 'ready')) {
    assert.deepEqual(await readPngDimensions(path.join(root, asset.path)), { width: asset.width, height: asset.height });
    assert.equal(asset.submittable, true);
  }
  const screenshots = listing.assets.filter((item) => item.kind === 'screenshot');
  assert.ok(screenshots.length >= 1 && screenshots.length <= 5);
  for (const asset of screenshots) {
    assert.match(asset.brief, /packaged|v0\.1\.0/i);
    assert.equal(asset.submittable, true);
    assert.notEqual(asset.status, 'placeholder');
  }
});

test('listing-state contract cannot imply publication without a matching Store identity', () => {
  assert.deepEqual(validateListingState({ status: 'not-submitted', itemId: null, publicUrl: null, publicUrlVerifiedAt: null }), []);
  assert.ok(validateListingState({ status: 'published', itemId: extensionId, publicUrl: null, publicUrlVerifiedAt: null }).length > 0);
  assert.ok(validateListingState({
    status: 'published',
    itemId: extensionId,
    publicUrl: 'https://chromewebstore.google.com/detail/annotated/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    publicUrlVerifiedAt: '2026-08-10T00:00:00.000Z',
  }).some((issue) => /does not match/i.test(issue)));
  assert.deepEqual(validateListingState({
    status: 'published',
    itemId: extensionId,
    publicUrl: `https://chromewebstore.google.com/detail/annotated/${extensionId}`,
    publicUrlVerifiedAt: '2026-08-10T00:00:00.000Z',
  }), []);
});

test('published state requires a live Store URL that resolves to the same item', async () => {
  const state = {
    status: 'published',
    itemId: extensionId,
    publicUrl: `https://chromewebstore.google.com/detail/annotated/${extensionId}`,
    publicUrlVerifiedAt: '2026-08-10T00:00:00.000Z',
  };
  const matching = await verifyPublishedStoreListing(state, async () => ({
    ok: true,
    status: 200,
    url: state.publicUrl,
    text: async () => '<html>annotated</html>',
  }), listing.listing.name);
  assert.equal(matching.passed, true);

  const redirected = await verifyPublishedStoreListing(state, async () => ({
    ok: true,
    status: 200,
    url: 'https://chromewebstore.google.com/detail/another/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    text: async () => '<html>another item</html>',
  }), listing.listing.name);
  assert.equal(redirected.passed, false);

  const unavailable = await verifyPublishedStoreListing(state, async () => ({
    ok: false,
    status: 404,
    url: state.publicUrl,
    text: async () => 'not found',
  }), listing.listing.name);
  assert.equal(unavailable.passed, false);

  const unavailableInterstitial = await verifyPublishedStoreListing(state, async () => ({
    ok: true,
    status: 200,
    url: state.publicUrl,
    text: async () => '<html>annotated extension is unavailable</html>',
  }), listing.listing.name);
  assert.equal(unavailableInterstitial.passed, false);
});

test('live Store proof is bound to the exact deployed commit, version, and ZIP', () => {
  const release = { gitSha: 'a'.repeat(40), version: manifest.version, sha256: 'b'.repeat(64) };
  const live = {
    canonicalOrigin: listing.urls.homepage.replace(/\/$/u, ''),
    release: { gitSha: release.gitSha, version: release.version },
    distribution: { store: { status: 'published' }, directArtifact: { sha256: release.sha256 } },
  };
  const input = { live, canonicalOrigin: live.canonicalOrigin, listingStatus: 'published', release, extensionVersion: manifest.version };
  assert.equal(liveReleaseMatches(input), true);
  assert.equal(liveReleaseMatches({ ...input, live: { ...live, release: { ...live.release, gitSha: 'c'.repeat(40) } } }), false);
  assert.equal(liveReleaseMatches({ ...input, live: { ...live, distribution: { ...live.distribution, directArtifact: { sha256: 'd'.repeat(64) } } } }), false);
});

test('only a complete online endpoint set can create a verified publication receipt', () => {
  const passed = requiredOnlineReceiptChecks.map((id) => ({ id, passed: true }));
  assert.equal(storeReceiptStatus({ listingState: 'published', ready: true, online: true, endpointChecks: passed }), 'verified');
  assert.equal(storeReceiptStatus({ listingState: 'published', ready: true, online: false, endpointChecks: passed }), 'blocked');
  assert.equal(storeReceiptStatus({ listingState: 'published', ready: true, online: true, endpointChecks: passed.slice(1) }), 'blocked');
  assert.equal(storeReceiptStatus({ listingState: 'not-submitted', ready: true, online: false, endpointChecks: [] }), 'ready-not-published');
  assert.equal(storeReceiptStatus({ listingState: 'published', ready: false, online: true, endpointChecks: passed }), 'blocked');
});

test('readiness inventory fails only on explicit release inputs, real captures, and external gates', async () => {
  const checkedAt = new Date('2026-08-10T12:00:00.000Z');
  const result = await validateStoreReadiness({ root, now: () => checkedAt });
  const allowed = /^(?:release-|asset:screenshot-|publisher-contact-email|external:)/;
  assert.equal(result.blockers.filter((blocker) => !allowed.test(blocker.id)).length, 0, JSON.stringify(result.blockers, null, 2));
  assert.equal(result.receipt.status, result.ready ? 'ready-not-published' : 'blocked');
  assert.equal(result.receipt.itemId, null);
  assert.equal(result.receipt.publicUrl, null);
  assert.equal(result.receipt.version, manifest.version);
  assert.equal(result.receipt.checkedAt, checkedAt.toISOString());
  assert.equal(result.receipt.expiresAt, '2026-08-11T12:00:00.000Z');
});

test('receipt writer preserves the auditable release and endpoint fields', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'annotated-store-receipt-'));
  try {
    const output = path.join(directory, 'receipt.json');
    const result = {
      receipt: {
        schemaVersion: 1,
        status: 'verified',
        checkedAt: '2026-08-10T00:00:00.000Z',
        expiresAt: '2026-08-11T00:00:00.000Z',
        listingState: 'published',
        itemId: extensionId,
        publicUrl: `https://chromewebstore.google.com/detail/annotated/${extensionId}`,
        version: manifest.version,
        gitSha: 'a'.repeat(40),
        artifactSha256: 'b'.repeat(64),
        listingManifestSha256: 'c'.repeat(64),
        externalGateIds: ['oauth-round-trip'],
        endpoints: [{ id: 'public-store-url', passed: true, detail: 'matched' }],
      },
    };
    await writeStoreReadinessReceipt(result, output);
    assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), result.receipt);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('privacy policy includes the Chrome Web Store Limited Use boundary', async () => {
  const policy = await readFile(path.join(root, 'public/privacy.html'), 'utf8');
  assert.match(policy, /Chrome Web Store limited use/i);
  assert.match(policy, /personalized or interest-based advertising/i);
  assert.match(policy, /human review/i);
  assert.match(policy, /security or legal compliance/i);
});
