import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { rateLimit, requestId, securityHeaders } from '../server/hardening.js';

test('request IDs accept safe caller IDs and replace unsafe values', () => {
  assert.equal(requestId({ headers: { 'x-request-id': 'capture-1' } }), 'capture-1');
  assert.match(requestId({ headers: { 'x-request-id': 'bad value' } }), /^[0-9a-f-]{36}$/);
});

test('in-memory mutation limits expose an explicit denial boundary', () => {
  const key = `test-${Date.now()}`;
  assert.equal(rateLimit(key, { limit: 1, windowMs: 60_000 }).allowed, true);
  assert.equal(rateLimit(key, { limit: 1, windowMs: 60_000 }).allowed, false);
});

test('static security headers include a restrictive policy', () => {
  assert.match(securityHeaders()['content-security-policy'], /frame-ancestors 'none'/);
  assert.equal(securityHeaders()['x-content-type-options'], 'nosniff');
  assert.equal(securityHeaders()['permissions-policy'], 'camera=(), geolocation=(), payment=()');
});

test('production hardening rejects wildcard CORS', () => {
  const result = spawnSync(process.execPath, ['-e', "import('./server/hardening.js').then((hardening) => hardening.assertHardeningConfiguration())"], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://annotated.example.com', CORS_ORIGIN: '*' },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stderr}${result.stdout}`, /restricted CORS_ORIGINS/);
});

test('production hardening rejects origins with paths', () => {
  const result = spawnSync(process.execPath, ['-e', "import('./server/hardening.js').then((hardening) => hardening.assertHardeningConfiguration())"], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://annotated.example.com/app', CORS_ORIGIN: 'https://annotated.example.com' },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stderr}${result.stdout}`, /PUBLIC_ORIGIN to be an origin/);
});
