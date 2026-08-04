import assert from 'node:assert/strict';
import test from 'node:test';
import { createPostgresRateLimiter, hashKey, rateLimitAsync } from '../server/rate-limit.js';

test('shared rate-limit keys are hashed before persistence', () => {
  assert.match(hashKey('203.0.113.4:local-tom:claim'), /^[0-9a-f]{64}$/);
  assert.equal(hashKey('same-key'), hashKey('same-key'));
  assert.notEqual(hashKey('same-key'), hashKey('different-key'));
});

test('postgres rate limiter uses an atomic bucket upsert and prunes expired rows periodically', async () => {
  const calls = [];
  let count = 0;
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql === 'SELECT 1') return { rows: [{ '?column?': 1 }] };
      if (sql.includes('INSERT INTO annotated_rate_limit_buckets')) return { rows: [{ count: String(++count), expires_ms: String(Date.now() + 60_000) }] };
      if (sql.startsWith('DELETE FROM annotated_rate_limit_buckets')) return { rows: [] };
      throw new Error(`unexpected query: ${sql}`);
    },
    async end() {},
  };
  const limiter = createPostgresRateLimiter({ pool, pruneEvery: 2 });
  assert.equal((await limiter.limit('actor:claim', { limit: 2, windowMs: 60_000 })).allowed, true);
  assert.equal((await limiter.limit('actor:claim', { limit: 2, windowMs: 60_000 })).allowed, true);
  assert.equal((await limiter.limit('actor:claim', { limit: 2, windowMs: 60_000 })).allowed, false);
  assert.equal(calls.filter(({ sql }) => sql.includes('ON CONFLICT (bucket_key, window_start)')).length, 3);
  assert.equal(calls.filter(({ sql }) => sql.startsWith('DELETE FROM annotated_rate_limit_buckets')).length, 1);
  assert.equal(calls[1].params[0], hashKey('actor:claim'));
  await limiter.close();
});

test('development rate-limit calls retain the local fallback', async () => {
  const key = `rate-limit-fallback-${Date.now()}`;
  const first = await rateLimitAsync(key, { limit: 1, windowMs: 60_000 });
  const second = await rateLimitAsync(key, { limit: 1, windowMs: 60_000 });
  assert.equal(first.shared, false);
  assert.equal(first.allowed, true);
  assert.equal(second.allowed, false);
});
