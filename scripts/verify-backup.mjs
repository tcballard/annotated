import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  inspectDatabase,
  runPgRestore,
  runPgRestoreList,
  sha256File,
} from './backup-production.mjs';

const readJson = async (filePath, label) => {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read ${label}: ${error.message}`);
  }
};

const artifactPath = (backupDir, relativePath, expectedName) => {
  if (relativePath !== expectedName) throw new Error(`Backup manifest must reference ${expectedName}.`);
  const root = path.resolve(backupDir);
  const candidate = path.resolve(root, relativePath);
  if (!candidate.startsWith(`${root}${path.sep}`)) throw new Error(`Backup artifact path escapes ${root}.`);
  return candidate;
};

export const validateObjectManifest = ({ objectManifest, expected } = {}) => {
  if (!Array.isArray(objectManifest?.objects)) throw new Error('Object manifest must contain an objects array.');
  const objects = objectManifest.objects;
  const keys = objects.map((item) => String(item.key || ''));
  if (keys.some((key) => !key)) throw new Error('Object manifest contains an empty key.');
  if (new Set(keys).size !== keys.length) throw new Error('Object manifest contains duplicate keys.');
  const sorted = [...keys].sort((a, b) => a.localeCompare(b));
  if (JSON.stringify(keys) !== JSON.stringify(sorted)) throw new Error('Object manifest keys must be sorted.');
  if (objects.some((item) => !Number.isSafeInteger(Number(item.size)) || Number(item.size) < 0)) throw new Error('Object manifest contains an invalid object size.');
  const totalBytes = objects.reduce((total, item) => total + Number(item.size), 0);
  if (Number(objectManifest.objectCount) !== objects.length || Number(objectManifest.totalBytes) !== totalBytes) throw new Error('Object manifest totals do not match its entries.');
  if (expected && (Number(expected.objectCount) !== objects.length || Number(expected.totalBytes) !== totalBytes)) throw new Error('Backup manifest totals do not match objects.json.');
  return { objectCount: objects.length, totalBytes, keys };
};

export const assertIsolatedRecoveryTarget = (databaseUrl, prefix = 'annotated_recovery') => {
  let url;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error('RECOVERY_DATABASE_URL must be a PostgreSQL URL.');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('RECOVERY_DATABASE_URL must use the postgres or postgresql scheme.');
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!databaseName || !databaseName.startsWith(prefix)) throw new Error(`Recovery target database must start with ${prefix}; refusing an ambiguous target.`);
  return { host: url.hostname, databaseName };
};

export const verifyBackupArtifact = async ({ backupDir, listDump = runPgRestoreList } = {}) => {
  if (!backupDir) throw new Error('BACKUP_DIR is required.');
  const root = path.resolve(backupDir);
  const manifest = await readJson(path.join(root, 'manifest.json'), 'manifest.json');
  if (manifest.formatVersion !== 1) throw new Error(`Unsupported backup manifest format: ${manifest.formatVersion}.`);
  const dumpPath = artifactPath(root, manifest.database?.dump?.path, 'postgres.dump');
  const objectsPath = artifactPath(root, manifest.objectStore?.manifestPath, 'objects.json');
  const objectManifest = await readJson(objectsPath, 'objects.json');
  const dump = await sha256File(dumpPath);
  if (dump.bytes < 1) throw new Error('PostgreSQL dump is empty.');
  if (dump.sha256 !== manifest.database?.dump?.sha256 || dump.bytes !== Number(manifest.database?.dump?.bytes)) throw new Error('PostgreSQL dump checksum or size does not match manifest.json.');
  const objects = validateObjectManifest({ objectManifest, expected: manifest.objectStore });
  await listDump({ dumpPath });
  return {
    status: 'verified',
    formatVersion: manifest.formatVersion,
    releaseVersion: manifest.releaseVersion,
    database: { ...manifest.database, dump },
    objects: { ...objects, retention: manifest.objectStore?.retention || { status: 'not-recorded' } },
  };
};

export const runRecoveryDrill = async ({ backupDir, recoveryDatabaseUrl, restore = runPgRestore, inspect = inspectDatabase } = {}) => {
  assertIsolatedRecoveryTarget(recoveryDatabaseUrl);
  if (!backupDir) throw new Error('BACKUP_DIR is required.');
  const root = path.resolve(backupDir);
  const manifest = await readJson(path.join(root, 'manifest.json'), 'manifest.json');
  const dumpPath = artifactPath(root, manifest.database?.dump?.path, 'postgres.dump');
  await restore({ databaseUrl: recoveryDatabaseUrl, dumpPath });
  const database = await inspect({ databaseUrl: recoveryDatabaseUrl });
  if (database.latestMigration !== manifest.database?.latestMigration) throw new Error(`Recovery migration ${database.latestMigration || 'none'} does not match ${manifest.database?.latestMigration || 'none'}.`);
  return { status: 'restored', database };
};

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMainModule) {
  const run = async () => {
    const verification = await verifyBackupArtifact({ backupDir: process.env.BACKUP_DIR });
    let recovery;
    if (process.env.RUN_RECOVERY_DRILL === 'true') {
      if (!process.env.RECOVERY_DATABASE_URL) throw new Error('RUN_RECOVERY_DRILL=true requires RECOVERY_DATABASE_URL.');
      recovery = await runRecoveryDrill({ backupDir: process.env.BACKUP_DIR, recoveryDatabaseUrl: process.env.RECOVERY_DATABASE_URL });
    }
    console.log(JSON.stringify({ ...verification, ...(recovery ? { recovery } : {}) }, null, 2));
  };
  run().catch((error) => {
    console.error(`Backup verification failed: ${error.message}`);
    process.exitCode = 1;
  });
}
