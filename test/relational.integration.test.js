import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';
import pg from 'pg';
import { atomicClaimSql } from '../server/media-job-repository.js';

const rootUrl = process.env.DATABASE_URL;
const gated = { skip: rootUrl ? false : 'DATABASE_URL not set' };
const databaseName = 'annotated_relational_tests';

const databaseUrl = () => {
  const parsed = new URL(rootUrl);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
};

const prepare = async () => {
  const admin = new pg.Pool({ connectionString: rootUrl, max: 1, ssl: process.env.PGSSL === 'disable' ? false : undefined });
  await admin.query(`CREATE DATABASE ${databaseName}`).catch((error) => { if (error.code !== '42P04') throw error; });
  await admin.end();
  const migrated = spawnSync(process.execPath, ['scripts/migrate.js'], { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: databaseUrl(), PGSSL: process.env.PGSSL || 'disable' }, encoding: 'utf8' });
  assert.equal(migrated.status, 0, `${migrated.stdout}\n${migrated.stderr}`);
};

const startApi = async (url) => {
  const port = 23_000 + (process.pid % 1_000);
  let logs = '';
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', PUBLIC_ORIGIN: `http://127.0.0.1:${port}`, APP_ORIGIN: `http://127.0.0.1:${port}`, AUTH_REQUIRED: 'false', ANNOTATED_STORAGE: 'postgres', DATABASE_URL: url, PGSSL: process.env.PGSSL || 'disable', ANNOTATED_ASSET_STORAGE: 'local', NODE_ENV: 'test', MEDIA_WORKER_CONCURRENCY: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => { logs += chunk; });
  child.stderr.on('data', (chunk) => { logs += chunk; });
  const origin = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Relational API exited before ready.\n${logs}`);
    try { if ((await fetch(`${origin}/api/health`)).ok) return { child, origin, logs: () => logs }; } catch { /* retry */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  child.kill('SIGTERM');
  throw new Error(`Relational API did not become ready.\n${logs}`);
};

test('migration, query-native API, integrity, and SKIP LOCKED claims work on real PostgreSQL', gated, async (t) => {
  await prepare();
  const pool = new pg.Pool({ connectionString: databaseUrl(), max: 6, ssl: process.env.PGSSL === 'disable' ? false : undefined });
  try {
    await pool.query('TRUNCATE annotated_records,annotated_sources,annotated_users CASCADE');
    const now = new Date().toISOString();
    const records = [
      ['users', 'owner', { id: 'owner', handle: 'owner', displayName: 'Owner', role: 'owner', createdAt: now }],
      ['users', 'reader', { id: 'reader', handle: 'reader', displayName: 'Reader', createdAt: now }],
      ['annotations', 'a-1', { id: 'a-1', slug: 'bounded-query', authorId: 'owner', sourceUrl: 'https://example.com/story', canonicalUrl: 'https://example.com/story', sourceHost: 'example.com', sourceType: 'article', sourceTitle: 'Bounded PostgreSQL query', sourceExcerpt: 'Exact source evidence', commentaryMode: 'text', commentary: 'indexed', visibility: 'public', status: 'published', mediaStatus: 'not-applicable', clipStart: 0, clipEnd: 0, audioDuration: 0, openCount: 0, createdAt: now }],
      ['comments', 'c-1', { id: 'c-1', annotationId: 'a-1', authorId: 'reader', body: 'bounded response', createdAt: now }],
      ['likes', 'like-a-1-reader', { id: 'like-a-1-reader', annotationId: 'a-1', userId: 'reader', createdAt: now }],
      ['follows', 'follow-reader-owner', { id: 'follow-reader-owner', followerId: 'reader', followingId: 'owner', createdAt: now }],
      ['mediaJobs', 'job-1', { id: 'job-1', annotationId: 'a-1', ownerId: 'owner', sourceUrl: 'https://example.com/source.mp4', mediaUrl: 'https://example.com/source.mp4', provider: 'direct', sourceType: 'video', clipStart: 0, clipEnd: 10, status: 'queued', attempts: 0, traceId: 'trace-1', createdAt: now }],
    ];
    for (const [collection, id, payload] of records) await pool.query('INSERT INTO annotated_records(collection,record_id,payload) VALUES($1,$2,$3::jsonb)', [collection, id, JSON.stringify(payload)]);

    const projected = await pool.query(`SELECT a.slug,u.handle,
      (SELECT count(*) FROM annotated_comments WHERE annotation_id=a.id)::integer comments,
      (SELECT count(*) FROM annotated_likes WHERE annotation_id=a.id)::integer likes
      FROM annotated_annotations a JOIN annotated_users u ON u.id=a.author_id WHERE a.id='a-1'`);
    assert.deepEqual(projected.rows[0], { slug: 'bounded-query', handle: 'owner', comments: 1, likes: 1 });
    const exact = await pool.query("SELECT id FROM annotated_annotations WHERE source_url_key=annotated_url_key('https://www.example.com/story#quote')");
    assert.deepEqual(exact.rows.map((row) => row.id), ['a-1']);
    const search = await pool.query("SELECT id FROM annotated_annotations WHERE search_document @@ websearch_to_tsquery('simple','PostgreSQL evidence')");
    assert.deepEqual(search.rows.map((row) => row.id), ['a-1']);

    const api = await startApi(databaseUrl());
    t.after(() => { if (api.child.exitCode === null) api.child.kill('SIGTERM'); });
    for (const [path, assertion] of [
      ['/api/feed', (body) => assert.equal(body.annotations[0].slug, 'bounded-query')],
      ['/api/feed?q=PostgreSQL%20evidence', (body) => assert.equal(body.annotations.length, 1)],
      ['/api/feed?url=https%3A%2F%2Fwww.example.com%2Fstory%23quote', (body) => assert.equal(body.annotations.length, 1)],
      ['/api/feed?sort=trending', (body) => assert.equal(body.annotations.length, 1)],
      ['/api/sources/example.com', (body) => assert.equal(body.source.annotationCount, 1)],
      ['/api/people', (body) => assert.equal(body.people[0].handle, 'owner')],
      ['/api/profiles/owner', (body) => assert.equal(body.profile.annotationCount, 1)],
      ['/api/annotations/bounded-query', (body) => assert.equal(body.annotation.comments.length, 1)],
    ]) {
      const response = await fetch(`${api.origin}${path}`);
      const body = await response.json();
      assert.equal(response.status, 200, `${path}: ${JSON.stringify(body)}\n${api.logs()}`);
      assertion(body);
    }

    const integrity = spawnSync(process.execPath, ['scripts/check-relational-integrity.mjs'], { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: databaseUrl(), PGSSL: process.env.PGSSL || 'disable' }, encoding: 'utf8' });
    assert.equal(integrity.status, 0, `${integrity.stdout}\n${integrity.stderr}`);
    assert.equal(JSON.parse(integrity.stdout).status, 'passed');

    const [first, second] = await Promise.all([
      pool.query(atomicClaimSql, [null, 'worker-a', 60_000, 3]),
      pool.query(atomicClaimSql, [null, 'worker-b', 60_000, 3]),
    ]);
    assert.equal(first.rowCount + second.rowCount, 1, 'one queued row is leased once across workers');
    const claimed = first.rows[0] || second.rows[0];
    assert.ok(['worker-a', 'worker-b'].includes(claimed.worker_id));
    await pool.query("UPDATE annotated_media_jobs SET lease_until=now()-interval '1 second' WHERE id='job-1'");
    const recovered = await pool.query(atomicClaimSql, ['job-1', 'worker-after-death', 60_000, 3]);
    assert.equal(recovered.rowCount, 1, 'an expired worker lease is recoverable');
    assert.equal(recovered.rows[0].worker_id, 'worker-after-death');
    const duplicate = await pool.query(atomicClaimSql, ['job-1', 'duplicate-worker', 60_000, 3]);
    assert.equal(duplicate.rowCount, 0, 'an active recovered lease rejects duplicate delivery');

    const plan = await pool.query("EXPLAIN (FORMAT JSON) SELECT id FROM annotated_annotations WHERE status='published' AND visibility='public' ORDER BY created_at DESC,id DESC LIMIT 20");
    assert.equal(plan.rows[0]['QUERY PLAN'][0].Plan['Node Type'], 'Limit');

  } finally {
    await pool.end();
  }
});
