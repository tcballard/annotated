import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import pg from 'pg';
import { createPostgresStore } from '../server/store.js';

// Gate 1's contract, proven against a real PostgreSQL — these run in CI
// (the workflow provides a postgres:16 service) and anywhere DATABASE_URL
// points at a database we may truncate. The budgets are the point: the
// old engine rewrote the whole dataset per write (measured 1.6 s at 500k
// rows); the row ops must stay flat as the dataset grows.
const url = process.env.DATABASE_URL;
const gated = { skip: url ? false : 'DATABASE_URL not set' };

const SEED_ANNOTATIONS = 5_000;
const SEED_LIKES = 50_000;

// Test files run in parallel and CI shares one DATABASE_URL — a TRUNCATE
// here while another suite holds rows in the same tables would wipe its
// state mid-flight (it did: the production-services marker vanished). So
// this suite claims its own database and stomps only there.
const HOT_DB = 'annotated_hot_path_tests';
let databaseReady;
const ensureDatabase = async () => {
  databaseReady ||= (async () => {
    const admin = new pg.Pool({ connectionString: url, max: 1, ssl: process.env.PGSSL === 'disable' ? false : undefined });
    await admin.query(`CREATE DATABASE ${HOT_DB}`).catch((error) => { if (error.code !== '42P04') throw error; });
    await admin.end();
  })();
  await databaseReady;
};
const hotDatabaseUrl = () => {
  const parsed = new URL(url);
  parsed.pathname = `/${HOT_DB}`;
  return parsed.toString();
};

const withDatabase = async (work) => {
  await ensureDatabase();
  const pool = new pg.Pool({ connectionString: hotDatabaseUrl(), max: 6, ssl: process.env.PGSSL === 'disable' ? false : undefined });
  const repository = createPostgresStore({ pool });
  try {
    await pool.query('CREATE TABLE IF NOT EXISTS annotated_schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    await repository.read(); // ensures schema
    const indexes = await readFile(new URL('../server/migrations/005_hot_path_indexes.sql', import.meta.url), 'utf8');
    await pool.query(indexes);
    await pool.query('TRUNCATE annotated_records');
    await pool.query('DELETE FROM annotated_state');
    await work(repository, pool);
  } finally {
    await pool.query('TRUNCATE annotated_records').catch(() => {});
    await repository.close();
  }
};

const seed = async (pool) => {
  const values = [];
  for (let i = 0; i < SEED_ANNOTATIONS; i += 1) {
    values.push(`('annotations', 'a-${i}', '{"id":"a-${i}","slug":"slug-${i}","visibility":"public","openCount":0,"createdAt":"2026-08-01T00:00:00.000Z"}')`);
  }
  for (let i = 0; i < SEED_LIKES; i += 1) {
    values.push(`('likes', 'seed-like-${i}', '{"id":"seed-like-${i}","annotationId":"a-${i % SEED_ANNOTATIONS}","userId":"seed-u-${i}","createdAt":"2026-08-01T00:00:00.000Z"}')`);
  }
  for (let offset = 0; offset < values.length; offset += 5_000) {
    await pool.query(`INSERT INTO annotated_records (collection, record_id, payload) VALUES ${values.slice(offset, offset + 5_000).join(',')}`);
  }
};

const median = (samples) => [...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)];

test('row ops are correct: toggle semantics, race-safe identity, real increments', gated, async () => {
  await withDatabase(async (repository, pool) => {
    await pool.query(`INSERT INTO annotated_records (collection, record_id, payload) VALUES ('annotations', 'a-1', '{"id":"a-1","slug":"s-1","openCount":0}')`);
    // like twice → one row; unlike → zero rows
    await repository.toggleLike('a-1', 'u-1', true);
    await repository.toggleLike('a-1', 'u-1', true);
    let count = await pool.query(`SELECT count(*) FROM annotated_records WHERE collection = 'likes'`);
    assert.equal(Number(count.rows[0].count), 1, 'double-like stays one row');
    await repository.toggleLike('a-1', 'u-1', false);
    count = await pool.query(`SELECT count(*) FROM annotated_records WHERE collection = 'likes'`);
    assert.equal(Number(count.rows[0].count), 0, 'unlike removes it');
    // concurrent likes from the same user collapse onto the unique index
    await Promise.all(Array.from({ length: 8 }, () => repository.toggleLike('a-1', 'u-2', true)));
    count = await pool.query(`SELECT count(*) FROM annotated_records WHERE collection = 'likes'`);
    assert.equal(Number(count.rows[0].count), 1, 'eight concurrent likes are still one row');
    // follows share the shape
    await repository.toggleFollow('u-1', 'u-2', true);
    await repository.toggleFollow('u-1', 'u-2', true);
    count = await pool.query(`SELECT count(*) FROM annotated_records WHERE collection = 'follows'`);
    assert.equal(Number(count.rows[0].count), 1);
    // the counter increments the row, not the world
    assert.equal(await repository.incrementOpenCount('a-1'), true);
    assert.equal(await repository.incrementOpenCount('a-1'), true);
    assert.equal(await repository.incrementOpenCount('missing'), false);
    const row = await pool.query(`SELECT payload->>'openCount' AS opens FROM annotated_records WHERE record_id = 'a-1'`);
    assert.equal(Number(row.rows[0].opens), 2);
  });
});

test('the diff engine writes what changed, never the dataset', gated, async () => {
  await withDatabase(async (repository, pool) => {
    await seed(pool);
    const before = await pool.query(`SELECT max(updated_at) AS at FROM annotated_records WHERE record_id LIKE 'seed-like-%'`);
    await repository.update((store) => ({
      ...store,
      annotations: store.annotations.map((item) => item.id === 'a-1' ? { ...item, sourceTitle: 'edited' } : item),
    }));
    // untouched rows keep their timestamps — they were not rewritten
    const after = await pool.query(`SELECT max(updated_at) AS at FROM annotated_records WHERE record_id LIKE 'seed-like-%'`);
    assert.equal(String(after.rows[0].at), String(before.rows[0].at), 'a one-row edit must not rewrite unrelated rows');
    const edited = await pool.query(`SELECT payload->>'sourceTitle' AS title FROM annotated_records WHERE record_id = 'a-1'`);
    assert.equal(edited.rows[0].title, 'edited');
  });
});

test(`the write path stays flat at ${SEED_LIKES.toLocaleString()} rows — the Gate 1 budget`, gated, async () => {
  await withDatabase(async (repository, pool) => {
    await seed(pool);
    const timeOp = async (op) => {
      const samples = [];
      for (let i = 0; i < 15; i += 1) {
        const start = performance.now();
        await op(i);
        samples.push(performance.now() - start);
      }
      return median(samples);
    };
    const like = await timeOp((i) => repository.toggleLike(`a-${i}`, 'bench-user', true));
    const open = await timeOp((i) => repository.incrementOpenCount(`a-${i}`));
    const follow = await timeOp((i) => repository.toggleFollow('bench-user', `seed-u-${i}`, true));
    console.log(`      hot-path medians at ${SEED_LIKES.toLocaleString()} rows: like ${like.toFixed(1)}ms · open ${open.toFixed(1)}ms · follow ${follow.toFixed(1)}ms`);
    // Budgets are generous for shared CI runners; the old engine measured
    // ~150-300ms here and 1.6s at 500k rows, growing linearly.
    assert.ok(like < 25, `a like must stay under 25ms at ${SEED_LIKES} rows (got ${like.toFixed(1)}ms)`);
    assert.ok(open < 25, `an open increment must stay under 25ms (got ${open.toFixed(1)}ms)`);
    assert.ok(follow < 25, `a follow must stay under 25ms (got ${follow.toFixed(1)}ms)`);
  });
});

test('sessions are rows: create sweeps the expired, sign-out deletes one', gated, async () => {
  await withDatabase(async (repository, pool) => {
    const expired = { id: 's-old', tokenHash: 'hash-old', userId: 'u-1', createdAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-01-02T00:00:00.000Z' };
    await pool.query(`INSERT INTO annotated_records (collection, record_id, payload) VALUES ('sessions', $1, $2::jsonb)`, [expired.id, JSON.stringify(expired)]);
    const live = { id: 's-new', tokenHash: 'hash-new', userId: 'u-1', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86_400_000).toISOString() };
    await repository.putSession(live);
    let rows = await pool.query(`SELECT record_id FROM annotated_records WHERE collection = 'sessions' ORDER BY record_id`);
    assert.deepEqual(rows.rows.map((row) => row.record_id), ['s-new'], 'creating a session sweeps expired ones');
    await repository.deleteSessionByTokenHash('hash-new');
    rows = await pool.query(`SELECT count(*) FROM annotated_records WHERE collection = 'sessions'`);
    assert.equal(Number(rows.rows[0].count), 0, 'sign-out removes exactly the session');
  });
});

test('every write path NOTIFYs so other instances drop their cache', gated, async () => {
  await withDatabase(async (repository, pool) => {
    const listener = await pool.connect();
    const heard = [];
    listener.on('notification', (message) => heard.push(message.payload));
    await listener.query('LISTEN annotated_changed');
    try {
      await repository.toggleLike('a-notify', 'u-1', true);          // shared-lock row op
      await repository.update((store) => ({ ...store }));            // exclusive whole-state op
      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.ok(heard.length >= 2, `both write paths must notify (heard ${heard.length})`);
      assert.ok(heard.every((payload) => payload && payload.length > 10), 'the payload names the writing instance');
    } finally {
      listener.release();
    }
  });
});
