import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await readFile(path.join(root, 'config/capabilities.json'), 'utf8'));
assert.equal(manifest.schemaVersion, 1);
assert.match(manifest.reviewedAt, /^\d{4}-\d{2}-\d{2}$/);
assert.equal(new URL(manifest.canonicalOrigin).protocol, 'https:');
assert.equal(manifest.distribution.store.status, 'not-submitted');
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
assert.equal(manifest.distribution.directArtifact.path, release.artifactPath);
assert.equal(manifest.distribution.directArtifact.checksumPath, release.checksumPath);
const bytes = await readFile(path.join(root, 'dist', release.artifactPath));
assert.equal(createHash('sha256').update(bytes).digest('hex'), release.sha256);
assert.equal(release.version, JSON.parse(await readFile(path.join(root, 'extension/manifest.json'), 'utf8')).version);
console.log(`Release truth verified: v${release.version}, ${release.sha256}, ${bytes.length} bytes.`);
