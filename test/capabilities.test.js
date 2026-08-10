import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { proofWorldStatus, requiredProvidersAvailable, storeInstallReady } from '../server/capabilities.js';

test('proof-world readiness requires every labelled proof class', () => {
  const users = Array.from({ length: 4 }, (_, index) => ({ id: `u${index}`, provider: 'demo', isDemo: true }));
  const annotations = [
    { id: 'article', authorId: 'u0', sourceType: 'article', status: 'published', isDemo: true, screenshotAssetId: 'shot' },
    { id: 'video', authorId: 'u1', sourceType: 'video', status: 'published', isDemo: true, mediaStatus: 'ready', mediaAssetId: 'video-clip' },
    { id: 'podcast', authorId: 'u2', sourceType: 'podcast', status: 'published', isDemo: true, mediaStatus: 'ready', mediaAssetId: 'podcast-clip', audioAssetId: 'audio' },
  ];
  const result = proofWorldStatus({ users, annotations, comments: [{ annotationId: 'article' }], follows: [{}], likes: [{}], claims: [{ isDemo: true }] });
  assert.equal(result.ready, true);
  assert.deepEqual(result.missing, []);
  assert.match(result.label, /not real user activity/i);
});

test('public product claims are manifest-driven and avoid premature Store language', async () => {
  const root = path.resolve(import.meta.dirname, '..');
  const manifest = JSON.parse(await readFile(path.join(root, 'config/capabilities.json'), 'utf8'));
  const storeManifest = JSON.parse(await readFile(path.join(root, manifest.distribution.store.manifestPath), 'utf8'));
  const source = await readFile(path.join(root, 'src/main.js'), 'utf8');
  assert.equal(storeManifest.listingState.status, 'not-submitted');
  assert.equal(manifest.distribution.store.status, undefined, 'Store state has one source of truth');
  assert.match(source, /state\.capabilities/);
  assert.doesNotMatch(source, /listing is (?:in|awaiting) review/i);
  assert.doesNotMatch(source, /Every requirement below is live/i);
  assert.match(source, /store\?\.installReady && store\.publicUrl/, 'the Store CTA requires runtime publication evidence');
  assert.match(source, /const install = storeInstall \|\| directInstall/, 'the checksummed artifact remains primary until the Store gate passes');
});

test('provider configuration is availability, not credentialed OAuth verification', async () => {
  const source = await readFile(new URL('../server/capabilities.js', import.meta.url), 'utf8');
  assert.match(source, /providerAvailable/);
  assert.match(source, /item\.id === 'oauth' \? oauthProviderVerified : Boolean\(item\.providerVerified\)/);
  assert.doesNotMatch(source, /const providerVerified = item\.id === 'oauth'/);
});

test('Store installation fails closed when either promised identity provider drifts offline', () => {
  const base = { canonical: true, listingStatus: 'published', storeEvidenceValid: true, extensionIdentityConfigured: true };
  assert.equal(requiredProvidersAvailable({ google: true, x: true }), true);
  assert.equal(storeInstallReady({ ...base, providers: { google: true, x: true } }), true);
  assert.equal(storeInstallReady({ ...base, providers: { google: true, x: false } }), false);
  assert.equal(storeInstallReady({ ...base, providers: { google: false, x: true } }), false);
});

test('Store installation proof is rechecked for expiry on every capabilities response', async () => {
  const source = await readFile(new URL('../server/capabilities.js', import.meta.url), 'utf8');
  assert.match(source, /assertFreshStoreReceipt\(receipt, \{ now \}\)/);
  assert.match(source, /expiresAt: storeEvidence\.receipt\.expiresAt/);
});

test('proof seeding is canonical, idempotent and transparently labelled by construction', async () => {
  const source = await readFile(new URL('../scripts/seed-proof-world.mjs', import.meta.url), 'utf8');
  assert.match(source, /deploymentOrigin === canonicalOrigin/);
  assert.match(source, /ANNOTATED_SEED_PROOF_WORLD === 'allow'/);
  assert.match(source, /isDemo: true/g);
  assert.match(source, /Demonstration claim used to prove/);
  assert.match(source, /\['failed', 'cancelled', 'superseded'\]/, 'terminal proof jobs must be retryable on redeploy');
});
