import { createHash } from 'node:crypto';
import pg from 'pg';
import { rateLimit } from './hardening.js';

const { Pool } = pg;
const production = process.env.NODE_ENV === 'production';
const postgresConfigured = (process.env.ANNOTATED_STORAGE || (production ? 'postgres' : 'file')) === 'postgres' && Boolean(process.env.DATABASE_URL);
const defaultPoolOptions = {
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PG_RATE_LIMIT_POOL_MAX || 4),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  ssl: process.env.PGSSL === 'disable' ? false : undefined,
};

const hashKey = (key) => createHash('sha256').update(String(key)).digest('hex');

export const createPostgresRateLimiter = ({ pool = new Pool(defaultPoolOptions), pruneEvery = 100 } = {}) => {
  let ready;
  let calls = 0;
  // Same rule as the store's pool: an idle client dying during a database
  // restart must not crash the process via an unhandled 'error' event.
  if (typeof pool.on === 'function') pool.on('error', (error) => console.error(`PostgreSQL pool error (rate limit): ${error.message}`));
  const ensureReady = async () => {
    // Same recovery rule as the store's schema check: never cache a rejected
    // readiness probe. The limiter fails closed while the database is down —
    // correct — but a cached rejection kept it failing closed forever, which
    // turns one blip into a permanent 429 on every mutation.
    ready ||= pool.query('SELECT 1').catch((error) => {
      ready = undefined;
      throw error;
    });
    await ready;
  };
  const limit = async (key, { limit: maximum = 60, windowMs = 60_000 } = {}) => {
    const now = Date.now();
    const normalizedWindowMs = Math.max(1_000, Number(windowMs) || 60_000);
    const normalizedLimit = Math.max(1, Number(maximum) || 1);
    const windowStart = Math.floor(now / normalizedWindowMs) * normalizedWindowMs;
    const expiresAt = windowStart + normalizedWindowMs;
    await ensureReady();
    const result = await pool.query(`
      INSERT INTO annotated_rate_limit_buckets (bucket_key, window_start, count, expires_at)
      VALUES ($1, to_timestamp($2 / 1000.0), 1, to_timestamp($3 / 1000.0))
      ON CONFLICT (bucket_key, window_start)
      DO UPDATE SET count = annotated_rate_limit_buckets.count + 1
      RETURNING count, extract(epoch FROM expires_at) * 1000 AS expires_ms
    `, [hashKey(key), windowStart, expiresAt]);
    if (!result.rows[0]) throw new Error('Rate-limit bucket update returned no row.');
    calls += 1;
    if (calls % pruneEvery === 0) await pool.query('DELETE FROM annotated_rate_limit_buckets WHERE expires_at < now()');
    const count = Number(result.rows[0].count);
    const expiry = Number(result.rows[0].expires_ms) || expiresAt;
    return { allowed: count <= normalizedLimit, retryAfter: Math.max(1, Math.ceil((expiry - now) / 1000)), shared: true };
  };
  return { limit, close: () => pool.end(), mode: 'postgres' };
};

const sharedLimiter = postgresConfigured ? createPostgresRateLimiter() : null;

export const rateLimitAsync = async (key, options = {}) => {
  if (!sharedLimiter) return { ...rateLimit(key, options), shared: false };
  try {
    return await sharedLimiter.limit(key, options);
  } catch (error) {
    // Fail closed in production when the shared ledger is unavailable. Falling
    // back to a process-local bucket would silently lose the multi-instance
    // guarantee this boundary is meant to provide.
    console.error(`Distributed rate limit unavailable: ${error.message}`);
    return { allowed: false, retryAfter: 60, shared: true, unavailable: true };
  }
};

export const closeRateLimitStore = async () => {
  if (sharedLimiter) await sharedLimiter.close();
};

export { hashKey, postgresConfigured };
