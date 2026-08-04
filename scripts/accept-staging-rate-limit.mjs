import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { closeRateLimitStore, hashKey, rateLimitAsync } from '../server/rate-limit.js';

const { Pool } = pg;

if (process.env.ACCEPTANCE_RATE_LIMIT_SMOKE !== '1') throw new Error('Set ACCEPTANCE_RATE_LIMIT_SMOKE=1 to run the guarded rate-limit smoke.');
if (process.env.NODE_ENV !== 'production' || process.env.ANNOTATED_STORAGE !== 'postgres' || !process.env.DATABASE_URL) throw new Error('The rate-limit smoke requires production PostgreSQL configuration.');
const origin = new URL(process.env.PUBLIC_ORIGIN || '');
if (origin.hostname !== 'annotated-staging.up.railway.app') throw new Error(`Refusing rate-limit smoke outside Railway staging: ${origin.hostname}`);

const key = `acceptance:rate-limit:${randomUUID()}`;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === 'disable' ? false : undefined });
const results = [];
let cleanupError;
try {
  for (let attempt = 0; attempt < 3; attempt += 1) results.push(await rateLimitAsync(key, { limit: 2, windowMs: 60_000 }));
  assert.ok(results.every((result) => result.shared), 'the staging smoke must use the shared limiter');
  assert.deepEqual(results.map((result) => result.allowed), [true, true, false]);
  assert.ok(results[2].retryAfter >= 1);
  console.log(JSON.stringify({ status: 'passed', shared: true, allowed: results.map((result) => result.allowed), retryAfter: results[2].retryAfter }));
} finally {
  try { await pool.query('DELETE FROM annotated_rate_limit_buckets WHERE bucket_key = $1', [hashKey(key)]); } catch (error) { cleanupError = error; }
  await pool.end().catch((error) => { cleanupError ||= error; });
  await closeRateLimitStore().catch((error) => { cleanupError ||= error; });
  if (cleanupError) throw new Error(`Rate-limit smoke cleanup failed: ${cleanupError.message}`);
}
