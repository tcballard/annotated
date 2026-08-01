import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { createPostgresStore, fileStore, storageDescription } from '../server/store.js';
import { S3ObjectStore } from '../server/object-store.js';

test('development defaults to the explicit file adapter', () => {
  assert.equal(storageDescription(), 'file');
  assert.equal(fileStore.mode, 'file');
});

test('postgres repository serializes the existing store contract transactionally', async () => {
  const state = { annotations: [], comments: [], claims: [], media: [], mediaJobs: [], users: [] };
  const pool = {
    async query(sql) {
      if (sql.startsWith('SELECT state FROM annotated_state')) return { rows: [{ state }] };
      return { rows: [] };
    },
    async connect() {
      return {
        async query(sql) {
          if (sql.startsWith('SELECT state FROM annotated_state')) return { rows: [{ state }] };
          return { rows: [] };
        },
        release() {},
      };
    },
    async end() {},
  };
  const repository = createPostgresStore({ pool });
  const read = await repository.read();
  assert.deepEqual(read.annotations, []);
  const next = await repository.update((current) => ({ ...current, users: [{ id: 'u1' }] }));
  assert.deepEqual(next.users, [{ id: 'u1' }]);
  await repository.close();
});

test('production import fails fast without DATABASE_URL', () => {
  const result = spawnSync(process.execPath, ['-e', "import('./server/store.js')"], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: 'production', ANNOTATED_STORAGE: 'postgres', DATABASE_URL: '' },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stderr}${result.stdout}`, /requires DATABASE_URL/);
});

test('production S3 configuration is validated before serving media', () => {
  const saved = { ...process.env };
  for (const name of ['S3_BUCKET', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']) delete process.env[name];
  assert.throws(() => new S3ObjectStore(), /requires S3_BUCKET/);
  for (const [name, value] of Object.entries(saved)) process.env[name] = value;
  for (const name of Object.keys(process.env)) if (!(name in saved)) delete process.env[name];
});
