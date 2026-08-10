import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { composeReleaseEvidence, parseComposeArguments } from '../scripts/compose-release-evidence.mjs';

const writeJson = (filePath, value) => writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);

test('release evidence composition binds browser and production proof to one artifact', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'annotated-compose-evidence-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await Promise.all(['config', 'dist/release', 'artifacts/e2e/results', 'artifacts/production'].map((directory) => mkdir(path.join(root, directory), { recursive: true })));
  const sha = 'a'.repeat(40);
  const artifactHash = 'b'.repeat(64);
  await writeFile(path.join(root, 'dist/release/extension.zip'), 'zip');
  await writeJson(path.join(root, 'dist/release/release.json'), { version: '0.1.0', gitSha: sha, artifactPath: '/release/extension.zip', sha256: artifactHash, bytes: 3 });
  await writeJson(path.join(root, 'config/capabilities.json'), { canonicalOrigin: 'https://staging.example.test', capabilities: [{ id: 'side-panel' }, { id: 'capture' }] });
  await writeJson(path.join(root, 'artifacts/e2e/results/gate-b-browser-receipt.json'), {
    schemaVersion: 1,
    gate: 'gate-b-packaged-extension-browser',
    release: { version: '0.1.0', sha256: artifactHash },
    nativeHost: { openedEvent: { path: 'sidepanel.html' } },
    metrics: { 'extension.side_panel.native_opened': 1 },
    capabilities: { browserVerified: ['side-panel', 'capture'] },
  });
  await writeJson(path.join(root, 'artifacts/e2e/playwright-report.json'), {
    stats: { startTime: '2026-08-10T09:00:00.000Z', duration: 2_000 },
    suites: [{ specs: [{ tests: [{ results: [{ attachments: [{ name: 'gate-b-browser-receipt', path: path.join(root, 'artifacts/e2e/results/gate-b-browser-receipt.json') }] }] }] }] }],
  });
  await writeFile(path.join(root, 'artifacts/e2e/playwright-junit.xml'), '<testsuites/>');
  await writeJson(path.join(root, 'artifacts/production/media-worker.json'), {
    kind: 'annotated.media-worker-integration',
    status: 'passed',
    gitSha: sha,
    environment: 'staging',
    startedAt: '2026-08-10T08:59:00.000Z',
    completedAt: '2026-08-10T09:01:00.000Z',
    evidence: { junit: 'artifacts/production/integration-junit.xml', log: 'artifacts/production/production-evidence.log' },
  });

  const manifest = await composeReleaseEvidence({ root, environment: 'staging', origin: 'https://staging.example.test' });
  assert.equal(manifest.gitSha, sha);
  assert.equal(manifest.artifact.path, 'dist/release/extension.zip');
  assert.deepEqual(manifest.capabilityIds, ['side-panel', 'capture']);
  assert.equal(manifest.startedAt, '2026-08-10T08:59:00.000Z');
  assert.equal(manifest.completedAt, '2026-08-10T09:01:00.000Z');
  assert.equal(manifest.productionEvidence.integrationJunit, 'artifacts/production/integration-junit.xml');
});

test('composition arguments fail closed on unsupported input', () => {
  const defaults = parseComposeArguments([]);
  assert.equal(defaults.output, 'artifacts/release/evidence-manifest.json');
  assert.throws(() => parseComposeArguments(['--unknown']), /Unknown argument/u);
});
