import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import pg from 'pg';
import {
  CreateBucketCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { createPostgresStore, latestMigrationVersion } from '../server/store.js';
import { S3ObjectStore } from '../server/object-store.js';

const integrationEnabled = Boolean(
  process.env.DATABASE_URL
  && process.env.S3_ENDPOINT
  && process.env.S3_BUCKET
  && process.env.S3_ACCESS_KEY_ID
  && process.env.S3_SECRET_ACCESS_KEY,
);

test('production PostgreSQL and S3 adapters work against real services', {
  skip: integrationEnabled ? false : 'set DATABASE_URL and S3_* values to run production-service integration',
}, async (t) => {
  const migration = spawnSync(process.execPath, ['scripts/migrate.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PGSSL: process.env.PGSSL || 'disable' },
    encoding: 'utf8',
  });
  assert.equal(migration.status, 0, `${migration.stdout}\n${migration.stderr}`);

  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === 'disable' ? false : undefined,
  });
  const repository = createPostgresStore({ pool });
  t.after(() => repository.close());

  await repository.check();
  const markerId = `integration-${randomUUID()}`;
  await repository.update((store) => ({
    ...store,
    users: [...(store.users || []), { id: markerId, provider: 'integration', handle: markerId }],
  }));
  const persisted = await repository.read();
  assert.ok(persisted.users.some((user) => user.id === markerId));
  assert.equal(latestMigrationVersion, '003_idempotency_index');

  const objectStore = new S3ObjectStore();
  try {
    await objectStore.client.send(new CreateBucketCommand({ Bucket: objectStore.bucket }));
  } catch (error) {
    assert.ok(['BucketAlreadyOwnedByYou', 'BucketAlreadyExists'].includes(error.Code), `unexpected bucket setup failure: ${error.message}`);
  }
  await objectStore.check();

  const fixtureDirectory = await mkdtemp(path.join(tmpdir(), 'annotated-s3-integration-'));
  t.after(() => rm(fixtureDirectory, { recursive: true, force: true }));
  const fixturePath = path.join(fixtureDirectory, 'fixture.txt');
  const fixture = 'a real object-store integration fixture\n';
  await writeFile(fixturePath, fixture);
  const key = `integration/${randomUUID()}.txt`;
  const uploaded = await objectStore.putFile(fixturePath, { key, mimeType: 'text/plain' });
  assert.equal(uploaded.fileName, key);
  assert.equal(uploaded.bytes, Buffer.byteLength(fixture));
  await objectStore.client.send(new HeadObjectCommand({ Bucket: objectStore.bucket, Key: key }));
  assert.match(await objectStore.url({ key }), /X-Amz-Signature=/);

  await objectStore.remove({ key });
  await assert.rejects(
    () => objectStore.client.send(new HeadObjectCommand({ Bucket: objectStore.bucket, Key: key })),
    (error) => ['NotFound', 'NoSuchKey', '404'].includes(error.name) || error.$metadata?.httpStatusCode === 404,
  );
});
