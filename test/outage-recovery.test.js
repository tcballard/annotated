import assert from 'node:assert/strict';
import test from 'node:test';
import { createPostgresStore } from '../server/store.js';
import { createPostgresRateLimiter } from '../server/rate-limit.js';

// A transient database outage must stay transient. Both the store's schema
// gate and the limiter's readiness probe memoize their first check; caching a
// REJECTED first check turned one connection blip into a permanent outage —
// the process kept serving the original ECONNREFUSED until it was restarted,
// while PostgreSQL sat healthy underneath it. These tests hold the recovery
// contract: fail while down, retry and succeed once the database is back.

const refused = () => Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' });

test('postgres store recovers after a transient outage instead of caching the failure', async () => {
  let down = true;
  const statements = [];
  const pool = {
    async query(sql) {
      if (down) throw refused();
      statements.push(String(sql));
      if (String(sql).startsWith('SELECT state FROM annotated_state')) return { rows: [] };
      return { rows: [] };
    },
    async connect() { return { async query() { return { rows: [] }; }, release() {} }; },
    async end() {},
  };
  const repository = createPostgresStore({ pool });

  await assert.rejects(() => repository.read(), /ECONNREFUSED/, 'while the database is down, reads fail — honestly');
  await assert.rejects(() => repository.read(), /ECONNREFUSED/, 'still down, still failing');

  down = false;
  const state = await repository.read();
  assert.ok(Array.isArray(state.annotations), 'first read after recovery succeeds without a process restart');
  assert.ok(statements.some((sql) => sql.includes('CREATE TABLE') || sql.includes('annotated_records') || sql.includes('annotated_state')), 'the schema gate actually re-ran after recovery rather than reusing a cached rejection');
});

test('postgres rate limiter recovers after a transient outage instead of failing closed forever', async () => {
  let down = true;
  const pool = {
    async query(sql) {
      if (down) throw refused();
      if (String(sql).includes('annotated_rate_limit_buckets')) {
        return { rows: [{ count: 1, expires_ms: Date.now() + 60_000 }] };
      }
      return { rows: [] };
    },
    async end() {},
  };
  const limiter = createPostgresRateLimiter({ pool });

  await assert.rejects(() => limiter.limit('outage-recovery-test'), /ECONNREFUSED/, 'while down, the probe fails and the caller fails closed — correct');

  down = false;
  const verdict = await limiter.limit('outage-recovery-test');
  assert.equal(verdict.allowed, true, 'first mutation after recovery is allowed again — no permanent 429');
  assert.equal(verdict.shared, true);
});
