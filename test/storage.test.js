import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { createPostgresStore, fileStore, storageDescription } from '../server/store.js';
import { LocalObjectStore, S3ObjectStore } from '../server/object-store.js';

test('development defaults to the explicit file adapter', () => {
  assert.equal(storageDescription(), 'file');
  assert.equal(fileStore.mode, 'file');
});

test('postgres repository serializes the existing store contract transactionally', async () => {
  const state = { annotations: [], comments: [], claims: [], media: [], mediaJobs: [], users: [] };
  const statements = [];
  const pool = {
    async query(sql) {
      statements.push(sql);
      if (sql.startsWith('SELECT state FROM annotated_state')) return { rows: [{ state }] };
      if (sql.startsWith('SELECT version FROM annotated_schema_migrations')) return { rows: [{ version: '003_idempotency_index' }] };
      return { rows: [] };
    },
    async connect() {
      return {
        async query(sql) {
          statements.push(sql);
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
  await repository.check();
  const next = await repository.update((current) => ({ ...current, users: [{ id: 'u1' }] }));
  assert.deepEqual(next.users, [{ id: 'u1' }]);
  assert.ok(statements.some((sql) => sql.startsWith('INSERT INTO annotated_records')));
  await repository.close();
});

test('postgres repository reconstructs the API store contract from entity records', async () => {
  const rows = [
    { collection: 'users', record_id: 'local-tom', payload: { id: 'local-tom', handle: 'tcballard', role: 'owner' } },
    { collection: 'users', record_id: 'u1', payload: { id: 'u1', handle: 'reader' } },
    { collection: 'annotations', record_id: 'a1', payload: { id: 'a1', status: 'published' } },
  ];
  const pool = {
    async query(sql) {
      if (sql.startsWith('SELECT collection, record_id, payload')) return { rows };
      return { rows: [] };
    },
    async end() {},
  };
  const repository = createPostgresStore({ pool });
  const result = await repository.read();
  assert.ok(result.users.some((user) => user.id === 'u1' && user.handle === 'reader'));
  assert.equal(result.users.filter((user) => user.id === 'local-tom').length, 1);
  assert.deepEqual(result.annotations, [{ id: 'a1', status: 'published' }]);
  assert.deepEqual(result.comments, []);
  await repository.close();
});

test('postgres readiness rejects an unapplied migration set', async () => {
  const pool = {
    async query(sql) {
      if (sql.startsWith('SELECT version FROM annotated_schema_migrations')) return { rows: [{ version: '001_initial' }] };
      return { rows: [] };
    },
    async end() {},
  };
  const repository = createPostgresStore({ pool });
  await assert.rejects(() => repository.check(), /migrations are not current/);
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

test('local and S3 object stores expose explicit readiness checks', async () => {
  await new LocalObjectStore().check();
  const saved = { ...process.env };
  Object.assign(process.env, {
    S3_BUCKET: 'annotated-test',
    S3_REGION: 'auto',
    S3_ACCESS_KEY_ID: 'test-key',
    S3_SECRET_ACCESS_KEY: 'test-secret',
  });
  const inputs = [];
  try {
    const store = new S3ObjectStore({ client: { async send(command) { inputs.push(command.input); } } });
    await store.check();
    await store.remove({ key: 'clips/old.mp4' });
    assert.deepEqual(inputs, [{ Bucket: 'annotated-test' }, { Bucket: 'annotated-test', Key: 'clips/old.mp4' }]);
  } finally {
    for (const name of Object.keys(process.env)) if (!(name in saved)) delete process.env[name];
    for (const [name, value] of Object.entries(saved)) process.env[name] = value;
  }
});
