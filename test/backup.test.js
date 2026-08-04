import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  archiveBackupFiles,
  buildBackupManifest,
  listObjectManifest,
  normalizeBackupConfig,
  runPgDump,
} from '../scripts/backup-production.mjs';

const productionEnv = {
  NODE_ENV: 'production',
  ANNOTATED_STORAGE: 'postgres',
  ANNOTATED_ASSET_STORAGE: 's3',
  DATABASE_URL: 'postgresql://backup-user:secret@example.test/annotated',
  S3_BUCKET: 'annotated-media',
  S3_REGION: 'auto',
  S3_ACCESS_KEY_ID: 'access-key',
  S3_SECRET_ACCESS_KEY: 'secret-key',
};

test('backup configuration requires explicit production adapters and credentials', () => {
  assert.throws(() => normalizeBackupConfig({ env: { ...productionEnv, NODE_ENV: 'development' } }), /NODE_ENV=production/);
  assert.throws(() => normalizeBackupConfig({ env: { ...productionEnv, DATABASE_URL: '' } }), /DATABASE_URL/);
  const config = normalizeBackupConfig({ env: { ...productionEnv, BACKUP_OUTPUT_DIR: '/tmp/annotated-backup-test' }, now: new Date('2026-08-04T12:00:00.000Z') });
  assert.equal(config.outputDir, '/tmp/annotated-backup-test');
  assert.equal(config.createdAt, '2026-08-04T12:00:00.000Z');
  assert.equal(config.maxObjects, 100000);
});

test('backup archive configuration requires a distinct bucket and creates a dated prefix', () => {
  assert.throws(() => normalizeBackupConfig({ env: { ...productionEnv, BACKUP_ARCHIVE_REQUIRED: 'true' } }), /BACKUP_ARCHIVE_BUCKET/);
  assert.throws(() => normalizeBackupConfig({ env: { ...productionEnv, BACKUP_ARCHIVE_BUCKET: productionEnv.S3_BUCKET } }), /must differ/);
  const config = normalizeBackupConfig({
    env: { ...productionEnv, BACKUP_ARCHIVE_REQUIRED: 'true', BACKUP_ARCHIVE_BUCKET: 'annotated-backups', BACKUP_ARCHIVE_PREFIX: 'daily' },
    now: new Date('2026-08-04T12:00:00.000Z'),
  });
  assert.deepEqual(config.archive, {
    bucket: 'annotated-backups',
    region: 'auto',
    endpoint: undefined,
    forcePathStyle: false,
    accessKeyId: 'access-key',
    secretAccessKey: 'secret-key',
    prefix: 'daily/2026-08-04T12-00-00-000Z/',
    requireVersioning: false,
    requireLifecycle: false,
  });
});

test('object manifest paginates, normalizes metadata, and totals bytes', async () => {
  const inputs = [];
  const client = {
    async send(command) {
      inputs.push(command.input);
      if (!command.input.ContinuationToken) return {
        Contents: [{ Key: 'clips/b.mp4', Size: 7, ETag: '"b"', LastModified: new Date('2026-08-04T00:00:00Z') }],
        IsTruncated: true,
        NextContinuationToken: 'next',
      };
      return { Contents: [{ Key: 'audio/a.webm', Size: 3, ETag: '"a"', LastModified: '2026-08-03T00:00:00Z' }], IsTruncated: false };
    },
  };
  const result = await listObjectManifest({ client, bucket: 'annotated-media' });
  assert.deepEqual(inputs, [{ Bucket: 'annotated-media', ContinuationToken: undefined }, { Bucket: 'annotated-media', ContinuationToken: 'next' }]);
  assert.deepEqual(result.objects.map((item) => item.key), ['audio/a.webm', 'clips/b.mp4']);
  assert.equal(result.objectCount, 2);
  assert.equal(result.totalBytes, 10);
});

test('object manifest refuses an unbounded inventory', async () => {
  const client = { async send() { return { Contents: [{ Key: 'one', Size: 1 }], IsTruncated: false }; } };
  await assert.rejects(() => listObjectManifest({ client, bucket: 'annotated-media', maxObjects: 0 }), /positive integer/);
});

test('pg_dump is invoked without a shell and reports failures without outputting credentials', async () => {
  const child = new EventEmitter();
  child.stderr = new EventEmitter();
  let invocation;
  const spawnImpl = (command, args, options) => {
    invocation = { command, args, options };
    queueMicrotask(() => child.emit('close', 0, null));
    return child;
  };
  await runPgDump({ databaseUrl: productionEnv.DATABASE_URL, outputPath: '/tmp/annotated.dump', command: 'pg_dump', spawnImpl });
  assert.equal(invocation.command, 'pg_dump');
  assert.equal(invocation.options.shell, undefined);
  assert.deepEqual(invocation.args.slice(0, 5), ['--format=custom', '--no-owner', '--no-privileges', '--file', '/tmp/annotated.dump']);
  assert.equal(invocation.args.includes(productionEnv.DATABASE_URL), false);
  assert.equal(invocation.options.env.DATABASE_URL, undefined);
  assert.equal(invocation.options.env.PGPASSWORD, 'secret');
  assert.equal(invocation.options.env.PGDATABASE, 'annotated');
});

test('backup manifest records restore commands and object inventory without secrets', () => {
  const config = normalizeBackupConfig({ env: { ...productionEnv, BACKUP_OUTPUT_DIR: '/tmp/annotated-backup-test' }, now: new Date('2026-08-04T12:00:00.000Z') });
  const manifest = buildBackupManifest({
    config,
    database: { latestMigration: '004_rate_limit_buckets', collections: { annotations: 2 } },
    dump: { path: 'postgres.dump', bytes: 42, sha256: 'a'.repeat(64) },
    objectManifest: { objectCount: 1, totalBytes: 8 },
    gitSha: 'abc123',
  });
  assert.equal(manifest.database.dump.sha256.length, 64);
  assert.match(manifest.recovery.restoreDatabaseWith, /pg_restore/);
  assert.equal(manifest.objectStore.objectCount, 1);
  assert.equal(manifest.archive, null);
  assert.equal(JSON.stringify(manifest).includes('secret-key'), false);
  assert.equal(JSON.stringify(manifest).includes('backup-user'), false);
});

test('backup archive uploads only the three verified artifacts', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'annotated-backup-archive-'));
  const calls = [];
  try {
    for (const name of ['postgres.dump', 'objects.json', 'manifest.json']) await writeFile(path.join(directory, name), name);
    const result = await archiveBackupFiles({
      outputDir: directory,
      archive: { bucket: 'annotated-backups', prefix: 'daily/run-1/' },
      client: { async send(command) { calls.push(command.input); command.input.Body.destroy(); } },
    });
    assert.deepEqual(result, {
      bucket: 'annotated-backups',
      prefix: 'daily/run-1/',
      files: ['daily/run-1/postgres.dump', 'daily/run-1/objects.json', 'daily/run-1/manifest.json'],
    });
    assert.deepEqual(calls.map(({ Bucket, Key, ContentType }) => ({ Bucket, Key, ContentType })), [
      { Bucket: 'annotated-backups', Key: 'daily/run-1/postgres.dump', ContentType: 'application/octet-stream' },
      { Bucket: 'annotated-backups', Key: 'daily/run-1/objects.json', ContentType: 'application/json' },
      { Bucket: 'annotated-backups', Key: 'daily/run-1/manifest.json', ContentType: 'application/json' },
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
