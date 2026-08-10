import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { packageExtension, releaseSourceEpoch } from '../scripts/package-extension.js';

test('extension packages use the committed release epoch, never the current Git commit', async (t) => {
  const manifest = JSON.parse(await readFile(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
  const release = JSON.parse(await readFile(new URL('../config/release.json', import.meta.url), 'utf8'));
  const source = await readFile(new URL('../scripts/package-extension.js', import.meta.url), 'utf8');
  assert.equal(await releaseSourceEpoch(manifest.version, {}), release.sourceDateEpoch);
  assert.doesNotMatch(source, /git['"], \['log'|git log/u);
  await assert.rejects(() => releaseSourceEpoch(manifest.version, { SOURCE_DATE_EPOCH: String(release.sourceDateEpoch + 1) }), /must equal the committed release epoch/);

  const first = path.join('artifacts/test-package', `first-v${manifest.version}.zip`);
  const second = path.join('artifacts/test-package', `second-v${manifest.version}.zip`);
  const originalTimezone = process.env.TZ;
  t.after(async () => rm(new URL('../artifacts/test-package', import.meta.url), { recursive: true, force: true }));
  t.after(() => { if (originalTimezone === undefined) delete process.env.TZ; else process.env.TZ = originalTimezone; });
  process.env.TZ = 'Pacific/Honolulu';
  const left = await packageExtension(first);
  process.env.TZ = 'Asia/Tokyo';
  const right = await packageExtension(second);
  assert.equal(left.sha256, right.sha256);
  assert.deepEqual(await readFile(left.outputPath), await readFile(right.outputPath));
});
