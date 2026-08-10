import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { packageExtension } from './package-extension.js';
import { validateReleaseReceipt, verifyReceiptFiles } from './check-release-slo.mjs';
import { assertExactStoreExternalGateIds, assertFreshStoreReceipt } from '../server/store-contract.js';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(import.meta.dirname, '..');
const releaseDirectory = path.join(projectRoot, 'public/release');
await rm(releaseDirectory, { recursive: true, force: true });
await mkdir(releaseDirectory, { recursive: true });
let gitSha = process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GITHUB_SHA || null;
if (!gitSha) {
  try { gitSha = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot })).stdout.trim(); } catch { /* Docker excludes .git. */ }
}
const manifest = JSON.parse(await readFile(path.join(projectRoot, 'extension/manifest.json'), 'utf8'));
const fileName = `annotated-extension-v${manifest.version}.zip`;
const artifact = await packageExtension(path.join('public/release', fileName));
const builtAt = process.env.SOURCE_DATE_EPOCH ? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString() : new Date().toISOString();
const evidence = {};
const evidenceDirectory = path.join(releaseDirectory, 'evidence');
if (process.env.ANNOTATED_RELEASE_RECEIPT) {
  const receiptPath = path.resolve(projectRoot, process.env.ANNOTATED_RELEASE_RECEIPT);
  const receiptBytes = await readFile(receiptPath);
  const receipt = JSON.parse(receiptBytes.toString('utf8'));
  const receiptErrors = validateReleaseReceipt(receipt);
  receiptErrors.push(...await verifyReceiptFiles(receipt, { baseDirectory: projectRoot }));
  if (receiptErrors.length) {
    const summary = receiptErrors.slice(0, 8).map((item) => `${item.code}: ${item.message}`).join('; ');
    throw new Error(`Release receipt failed independent validation: ${summary}`);
  }
  if (receipt.schemaVersion !== 1 || receipt.kind !== 'annotated.release-receipt') throw new Error('Release receipt has an unsupported schema.');
  if (!receipt.authoritative || receipt.status !== 'passed') throw new Error('Only an authoritative passed receipt can be embedded in a release.');
  if (receipt.artifact?.version !== artifact.version || receipt.artifact?.sha256 !== artifact.sha256) throw new Error('Release receipt does not describe the packaged extension artifact.');
  if (gitSha && receipt.gitSha !== gitSha) throw new Error('Release receipt git SHA does not match the release build.');
  const expectedShape = { browserExtension: true, runtimeMode: 'production', persistence: 'postgres', objectStorage: 's3', mediaWorker: 'standalone', realMediaTranscode: true };
  for (const [key, value] of Object.entries(expectedShape)) if (receipt.productionShape?.[key] !== value) throw new Error(`Release receipt is not production-shaped: ${key}.`);
  await mkdir(evidenceDirectory, { recursive: true });
  const publicReceiptPath = path.join(evidenceDirectory, 'receipt.json');
  await writeFile(publicReceiptPath, receiptBytes);
  evidence.browser = {
    receiptPath: '/release/evidence/receipt.json',
    sha256: createHash('sha256').update(receiptBytes).digest('hex'),
    bytes: receiptBytes.length,
    authoritative: true,
    status: receipt.status,
    gitSha: receipt.gitSha,
  };
}
if (process.env.ANNOTATED_STORE_RECEIPT) {
  if (!evidence.browser) throw new Error('Store verification cannot be embedded without an authoritative browser release receipt.');
  const receiptPath = path.resolve(projectRoot, process.env.ANNOTATED_STORE_RECEIPT);
  const receiptBytes = await readFile(receiptPath);
  const receipt = JSON.parse(receiptBytes.toString('utf8'));
  if (receipt.schemaVersion !== 1 || receipt.status !== 'verified' || receipt.listingState !== 'published') throw new Error('Store receipt is not a verified published listing.');
  assertFreshStoreReceipt(receipt);
  if (receipt.version !== artifact.version || receipt.artifactSha256 !== artifact.sha256) throw new Error('Store receipt does not describe the packaged extension artifact.');
  if (gitSha && receipt.gitSha !== gitSha) throw new Error('Store receipt git SHA does not match the release build.');
  if (!receipt.itemId || !receipt.publicUrl) throw new Error('Store receipt lacks its assigned item identity and public URL.');
  const storeManifestBytes = await readFile(path.join(projectRoot, 'store-assets/store-listing.json'));
  const storeManifest = JSON.parse(storeManifestBytes.toString('utf8'));
  if (receipt.listingManifestSha256 !== createHash('sha256').update(storeManifestBytes).digest('hex')) throw new Error('Store receipt does not bind the current Store manifest.');
  assertExactStoreExternalGateIds((storeManifest.externalGates || []).map((gate) => gate?.id), 'Store manifest external gate IDs');
  assertExactStoreExternalGateIds(receipt.externalGateIds, 'Store receipt external gate IDs');
  const requiredEndpoints = ['homepage', 'privacy', 'rights', 'support', 'capabilities', 'providers', 'extension-cors', 'public-store-url'];
  for (const id of requiredEndpoints) if (!receipt.endpoints?.some((item) => item.id === id && item.passed)) throw new Error(`Store receipt did not pass ${id}.`);
  await mkdir(evidenceDirectory, { recursive: true });
  const publicReceiptPath = path.join(evidenceDirectory, 'store.json');
  await writeFile(publicReceiptPath, receiptBytes);
  evidence.store = {
    receiptPath: '/release/evidence/store.json',
    sha256: createHash('sha256').update(receiptBytes).digest('hex'),
    bytes: receiptBytes.length,
    status: receipt.status,
    gitSha: receipt.gitSha,
    itemId: receipt.itemId,
  };
}
await writeFile(path.join(releaseDirectory, 'release.json'), `${JSON.stringify({ schemaVersion: 1, version: artifact.version, gitSha, builtAt, artifactPath: `/release/${fileName}`, checksumPath: `/release/${fileName}.sha256`, sha256: artifact.sha256, bytes: artifact.bytes, ...(Object.keys(evidence).length ? { evidence } : {}) }, null, 2)}\n`);
console.log(`Release artifact ready: ${fileName}`);
