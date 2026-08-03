import { randomUUID } from 'node:crypto';

const buckets = new Map();
const production = process.env.NODE_ENV === 'production';

export const assertHardeningConfiguration = () => {
  if (!production) return;
  if (!process.env.PUBLIC_ORIGIN) throw new Error('Production requires PUBLIC_ORIGIN.');
  if (!process.env.CORS_ORIGIN || process.env.CORS_ORIGIN === '*') throw new Error('Production requires a restricted CORS_ORIGIN.');
};

export const requestId = (request) => {
  const supplied = String(request.headers['x-request-id'] || '');
  return /^[A-Za-z0-9._-]{1,80}$/.test(supplied) ? supplied : randomUUID();
};

export const rateLimit = (key, { limit = 60, windowMs = 60_000 } = {}) => {
  const now = Date.now();
  const current = buckets.get(key) || { count: 0, resetAt: now + windowMs };
  if (current.resetAt <= now) { current.count = 0; current.resetAt = now + windowMs; }
  current.count += 1;
  buckets.set(key, current);
  if (buckets.size > 10_000) for (const [bucketKey, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(bucketKey);
  return { allowed: current.count <= limit, retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
};

export const securityHeaders = ({ api = false } = {}) => ({
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  ...(api ? {} : { 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; media-src 'self' https:; connect-src 'self' https:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" }),
});

export { production };
