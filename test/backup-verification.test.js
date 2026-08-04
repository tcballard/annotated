import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  assertObjectRetention,
  auditObjectRetention,
  runPgRestoreList,
  runPgRestore,
} from '../scripts/backup-production.mjs';
import {
  assertIsolatedRecoveryTarget,
  runRecoveryDrill,
  validateObjectManifest,
  verifyBackupArtifact,
} from '../scripts/verify-backup.mjs';
import { applyObjectRetention, describeRetentionProviderError, normalizeIncompleteUploadDays, retentionConfiguration } from '../scripts/configure-object-retention.mjs';

const makeArtifact = async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'annotated-backup-'));
  const dumpBytes = Buffer.from('deterministic custom-format fixture');
  const dumpSha = createHash('sha256').update(dumpBytes).digest('hex');
  const objectManifest = {
    formatVersion: 1,
    objectCount: 2,
    totalBytes: 10,
    objects: [
      { key: 'audio/a.webm', size: 3, etag: 'a', lastModified: '2026-08-04T00:00:00.000Z' },
      { key: 'clips/b.mp4', size: 7, etag: 'b', lastModified: '2026-08-04T00:00:00.000Z' },
    ],
  };
  const manifest = {
    formatVersion: 1,
    releaseVersion: '0.1.0',
    database: { latestMigration: '004_rate_limit_buckets', dump: { path: 'postgres.dump', bytes: dumpBytes.length, sha256: dumpSha } },
    objectStore: { manifestPath: 'objects.json', objectCount: 2, totalBytes: 10, retention: { versioning: { status: 'Enabled' }, lifecycle: { status: 'configured', ruleCount: 1 } } },
  };
  await writeFile(path.join(directory, 'postgres.dump'), dumpBytes, { mode: 0o600 });
  await writeFile(path.join(directory, 'objects.json'), `${JSON.stringify(objectManifest)}\n`, { mode: 0o600 });
  await writeFile(path.join(directory, 'manifest.json'), `${JSON.stringify(manifest)}\n`, { mode: 0o600 });
  return { directory, manifest };
};

test('retention audit records versioning and lifecycle rules without secrets', async () => {
  let call = 0;
  const retention = await auditObjectRetention({
    bucket: 'annotated-media',
    client: { async send() {
      call += 1;
      if (call === 1) return { Status: 'Enabled', MFADelete: 'Disabled' };
      return { Rules: [{ ID: 'published-retention', Status: 'Enabled', Prefix: 'clips/', Expiration: { Days: 365 } }] };
    } },
  });
  assert.equal(retention.versioning.status, 'Enabled');
  assert.equal(retention.lifecycle.status, 'configured');
  assert.equal(retention.lifecycle.rules[0].expiration.days, 365);
  assertObjectRetention({ retention, requireVersioning: true, requireLifecycle: true });
});

test('strict retention gates fail closed when provider policy is absent', () => {
  const retention = { versioning: { status: 'Disabled' }, lifecycle: { status: 'not-configured' } };
  assert.throws(() => assertObjectRetention({ retention, requireVersioning: true }), /versioning is required/);
  assert.throws(() => assertObjectRetention({ retention, requireLifecycle: true }), /lifecycle retention is required/);
});

test('missing lifecycle configuration is distinguished from an unavailable provider', async () => {
  let call = 0;
  const retention = await auditObjectRetention({
    bucket: 'annotated-media',
    client: { async send() {
      call += 1;
      if (call === 1) return { Status: 'Enabled' };
      const error = new Error('No lifecycle');
      error.name = 'NoSuchLifecycleConfiguration';
      throw error;
    } },
  });
  assert.equal(retention.lifecycle.status, 'not-configured');
  assert.equal(retention.lifecycle.ruleCount, 0);
});

test('object retention configuration enables versioning and only aborts incomplete uploads', async () => {
  assert.equal(normalizeIncompleteUploadDays('7'), 7);
  assert.throws(() => normalizeIncompleteUploadDays('0'), /between 1 and 365/);
  assert.throws(() => normalizeIncompleteUploadDays('366'), /between 1 and 365/);
  assert.deepEqual(retentionConfiguration({ incompleteUploadDays: 7 }).lifecycle.Rules[0].AbortIncompleteMultipartUpload, { DaysAfterInitiation: 7 });

  const calls = [];
  const result = await applyObjectRetention({
    bucket: 'annotated-media',
    incompleteUploadDays: 7,
    client: { async send(command) {
      calls.push(command.input);
      if (calls.length === 1) return {};
      if (calls.length === 2) return {};
      if (calls.length === 3) return { Status: 'Enabled' };
      return { Rules: [{ ID: 'annotated-incomplete-upload-cleanup', Status: 'Enabled', AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 } }] };
    } },
  });
  assert.deepEqual(calls[0].VersioningConfiguration, { Status: 'Enabled' });
  assert.equal(calls[1].LifecycleConfiguration.Rules[0].ID, 'annotated-incomplete-upload-cleanup');
  assert.equal(calls[1].LifecycleConfiguration.Rules[0].Expiration, undefined);
  assert.equal(result.retention.versioning.status, 'Enabled');
  assert.equal(result.retention.lifecycle.status, 'configured');
});

test('object retention reports unsupported provider capabilities without secrets', () => {
  assert.match(describeRetentionProviderError({ name: 'BucketAlreadyExists', Code: 'BucketAlreadyExists', $metadata: { httpStatusCode: 409 }, message: 'bucket abc-secret is not available' }), /does not expose bucket versioning/);
  assert.match(describeRetentionProviderError({ name: 'InvalidRequest', Code: 'InvalidRequest', message: 'Lifecycle only supports expiration rule.' }), /only accepts expiration lifecycle rules/);
});

test('object manifest validation rejects duplicate, unsorted, and mismatched entries', () => {
  const valid = { objectCount: 2, totalBytes: 10, objects: [{ key: 'a', size: 3 }, { key: 'b', size: 7 }] };
  assert.deepEqual(validateObjectManifest({ objectManifest: valid }), { objectCount: 2, totalBytes: 10, keys: ['a', 'b'] });
  assert.throws(() => validateObjectManifest({ objectManifest: { ...valid, objects: [{ key: 'b', size: 7 }, { key: 'a', size: 3 }] } }), /sorted/);
  assert.throws(() => validateObjectManifest({ objectManifest: { ...valid, objects: [{ key: 'a', size: 3 }, { key: 'a', size: 7 }] } }), /duplicate/);
  assert.throws(() => validateObjectManifest({ objectManifest: { ...valid, totalBytes: 9 } }), /totals/);
});

test('backup verifier checks the dump checksum, object inventory, and offline restore listing', async () => {
  const { directory } = await makeArtifact();
  try {
    const result = await verifyBackupArtifact({ backupDir: directory, listDump: async ({ dumpPath }) => assert.match(dumpPath, /postgres\.dump$/) });
    assert.equal(result.status, 'verified');
    assert.equal(result.database.latestMigration, '004_rate_limit_buckets');
    assert.equal(result.objects.objectCount, 2);
    assert.equal(result.objects.retention.versioning.status, 'Enabled');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('backup verifier rejects a tampered dump before any restore command', async () => {
  const { directory } = await makeArtifact();
  try {
    await writeFile(path.join(directory, 'postgres.dump'), 'tampered');
    await assert.rejects(() => verifyBackupArtifact({ backupDir: directory, listDump: async () => { throw new Error('must not run'); } }), /checksum or size/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('recovery drills require an explicitly named isolated database', () => {
  assert.deepEqual(assertIsolatedRecoveryTarget('postgresql://u:p@db.example/annotated_recovery_20260804'), { host: 'db.example', databaseName: 'annotated_recovery_20260804' });
  assert.throws(() => assertIsolatedRecoveryTarget('postgresql://u:p@db.example/annotated'), /annotated_recovery/);
  assert.throws(() => assertIsolatedRecoveryTarget('postgresql://u:p@db.example/prod'), /annotated_recovery/);
});

test('recovery drill restores only the isolated target and checks the migration ledger', async () => {
  const { directory } = await makeArtifact();
  const calls = [];
  try {
    const result = await runRecoveryDrill({
      backupDir: directory,
      recoveryDatabaseUrl: 'postgresql://u:p@db.example/annotated_recovery_20260804',
      restore: async (args) => calls.push({ type: 'restore', ...args }),
      inspect: async (args) => { calls.push({ type: 'inspect', ...args }); return { latestMigration: '004_rate_limit_buckets', collections: {} }; },
    });
    assert.equal(result.status, 'restored');
    assert.equal(calls[0].type, 'restore');
    assert.match(calls[0].dumpPath, /postgres\.dump$/);
    assert.equal(calls[1].type, 'inspect');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('offline pg_restore listing receives no database URL or shell', async () => {
  const child = new EventEmitter();
  child.stderr = new EventEmitter();
  let invocation;
  const spawnImpl = (command, args, options) => {
    invocation = { command, args, options };
    queueMicrotask(() => child.emit('close', 0, null));
    return child;
  };
  await runPgRestoreList({ dumpPath: '/tmp/postgres.dump', spawnImpl });
  assert.equal(invocation.command, 'pg_restore');
  assert.deepEqual(invocation.args, ['--list', '/tmp/postgres.dump']);
  assert.equal(invocation.options.shell, undefined);
  assert.equal(invocation.options.env.DATABASE_URL, undefined);
});

test('pg_restore targets the parsed recovery database without exposing the URL in arguments', async () => {
  const child = new EventEmitter();
  child.stderr = new EventEmitter();
  let invocation;
  const spawnImpl = (command, args, options) => {
    invocation = { command, args, options };
    queueMicrotask(() => child.emit('close', 0, null));
    return child;
  };
  await runPgRestore({ databaseUrl: 'postgresql://user:secret@db.example/annotated_recovery_ci', dumpPath: '/tmp/postgres.dump', spawnImpl });
  assert.equal(invocation.command, 'pg_restore');
  assert.deepEqual(invocation.args, ['--exit-on-error', '--no-owner', '--no-privileges', '--dbname', 'annotated_recovery_ci', '/tmp/postgres.dump']);
  assert.doesNotMatch(invocation.args.join(' '), /secret/);
  assert.equal(invocation.options.env.PGDATABASE, 'annotated_recovery_ci');
  assert.equal(invocation.options.env.PGPASSWORD, 'secret');
});
