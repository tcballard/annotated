import { randomUUID } from 'node:crypto';
import { validateCorsConfiguration } from './cors.js';

const buckets = new Map();
const production = process.env.NODE_ENV === 'production';

export const assertHardeningConfiguration = () => {
  if (!production) return;
  if (!process.env.PUBLIC_ORIGIN) throw new Error('Production requires PUBLIC_ORIGIN.');
  validateCorsConfiguration();
  for (const [name, value] of [['PUBLIC_ORIGIN', process.env.PUBLIC_ORIGIN]]) {
    let origin;
    try { origin = new URL(value); } catch { throw new Error(`Production requires a valid ${name}.`); }
    if (!['http:', 'https:'].includes(origin.protocol) || origin.pathname !== '/' || origin.search || origin.hash) throw new Error(`Production requires ${name} to be an origin without a path.`);
  }
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
  'permissions-policy': 'camera=(), geolocation=(), payment=()',
  'cross-origin-resource-policy': api ? 'same-site' : 'same-origin',
  ...(api ? {} : { 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; media-src 'self' https:; connect-src 'self' https:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" }),
});

export { production };
