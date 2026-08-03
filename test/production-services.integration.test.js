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

  const fixturePrefix = `full-surface-${randomUUID()}`;
  const annotationId = `${fixturePrefix}-annotation`;
  const claimId = `${fixturePrefix}-claim`;
  const records = {
    annotations: { id: annotationId, slug: `${fixturePrefix}-slug`, authorId: markerId, sourceUrl: 'https://example.com/article', sourceType: 'article', status: 'published', commentary: 'production persistence fixture', commentaryMode: 'text', createdAt: new Date().toISOString() },
    comments: { id: `${fixturePrefix}-comment`, annotationId, authorId: markerId, body: 'persisted comment', createdAt: new Date().toISOString() },
    claims: { id: claimId, annotationId, reporterId: markerId, reason: 'persistence fixture', status: 'open', createdAt: new Date().toISOString() },
    follows: { id: `${fixturePrefix}-follow`, followerId: markerId, followingId: 'local-tom', createdAt: new Date().toISOString() },
    likes: { id: `${fixturePrefix}-like`, annotationId, userId: markerId, createdAt: new Date().toISOString() },
    media: { id: `${fixturePrefix}-media`, annotationId, ownerId: markerId, key: `${fixturePrefix}/source.mp4`, status: 'ready' },
    mediaJobs: { id: `${fixturePrefix}-job`, annotationId, ownerId: markerId, status: 'processing', attempts: 0, workerId: `${fixturePrefix}-worker`, leaseUntil: new Date(Date.now() + 60_000).toISOString() },
    sessions: { id: `${fixturePrefix}-session`, userId: markerId, tokenHash: `${fixturePrefix}-session-hash`, expiresAt: new Date(Date.now() + 60_000).toISOString() },
    extensionTickets: { id: `${fixturePrefix}-ticket`, userId: markerId, tokenHash: `${fixturePrefix}-ticket-hash`, expiresAt: new Date(Date.now() + 60_000).toISOString() },
    moderationAudit: { id: `${fixturePrefix}-audit`, claimId, actorId: markerId, from: null, to: 'open', note: 'fixture', createdAt: new Date().toISOString() },
  };
  await repository.update((store) => ({
    ...store,
    ...Object.fromEntries(
      Object.entries(records).map(([collection, record]) => [collection, [...(store[collection] || []), record]]),
    ),
  }));
  const fullSurface = await repository.read();
  for (const [collection, record] of Object.entries(records)) {
    assert.deepEqual(fullSurface[collection].find((item) => item.id === record.id), record, `${collection} record did not round-trip`);
  }
  const entityRows = await pool.query(
    'SELECT collection, count(*)::int AS count FROM annotated_records WHERE record_id LIKE $1 GROUP BY collection ORDER BY collection',
    [`${fixturePrefix}%`],
  );
  assert.deepEqual(entityRows.rows.map((row) => row.collection), Object.keys(records).sort());
  assert.ok(entityRows.rows.every((row) => row.count === 1));

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
