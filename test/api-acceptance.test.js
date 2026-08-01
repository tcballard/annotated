import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});

const waitForServer = (child, port) => new Promise((resolve, reject) => {
  let output = '';
  const timeout = setTimeout(() => {
    child.kill('SIGTERM');
    reject(new Error(`Timed out waiting for API server on port ${port}.\n${output}`));
  }, 10_000);
  const onData = (chunk) => {
    output += chunk.toString();
    if (!output.includes(`annotated server listening on http://localhost:${port}`)) return;
    clearTimeout(timeout);
    child.stdout.off('data', onData);
    child.stderr.off('data', onData);
    resolve();
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.once('exit', (code, signal) => {
    clearTimeout(timeout);
    reject(new Error(`API server exited before becoming ready (code=${code}, signal=${signal}).\n${output}`));
  });
});

const request = async (baseUrl, pathname, { method = 'GET', body, origin } = {}) => {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (origin) headers.origin = origin;
  const response = await fetch(`${baseUrl}${pathname}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const payload = response.status === 204 ? null : await response.json();
  return { response, payload };
};

test('local API serves the acceptance-critical health, identity, publish, social, and moderation paths', async (t) => {
  const port = await freePort();
  const dataDirectory = await mkdtemp('/private/tmp/annotated-api-');
  const allowedOrigin = 'http://127.0.0.1:5173';
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(port),
      PUBLIC_ORIGIN: `http://localhost:${port}`,
      CORS_ORIGIN: allowedOrigin,
      ANNOTATED_STORAGE: 'file',
      ANNOTATED_ASSET_STORAGE: 'local',
      ANNOTATED_DATA_DIR: dataDirectory,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await new Promise((resolve) => child.once('exit', resolve));
    }
    await rm(dataDirectory, { recursive: true, force: true });
  });
  await waitForServer(child, port);

  const health = await request(baseUrl, '/api/health', { origin: allowedOrigin });
  assert.equal(health.response.status, 200);
  assert.equal(health.payload.status, 'ok');
  assert.equal(health.payload.persistence, 'file');
  assert.equal(health.response.headers.get('access-control-allow-origin'), allowedOrigin);
  assert.ok(health.response.headers.get('x-request-id'));

  const ready = await request(baseUrl, '/api/ready', { origin: allowedOrigin });
  assert.equal(ready.response.status, 200);
  assert.equal(ready.payload.status, 'ready');

  const denied = await request(baseUrl, '/api/health', { origin: 'https://not-annotated.example' });
  assert.equal(denied.response.status, 403);
  assert.match(denied.payload.error, /origin is not allowed/i);

  const providers = await request(baseUrl, '/api/auth/providers');
  assert.equal(providers.response.status, 200);
  assert.equal(providers.payload.required, false);
  assert.deepEqual(providers.payload.providers, { google: false, x: false });

  const me = await request(baseUrl, '/api/me');
  assert.equal(me.response.status, 200);
  assert.equal(me.payload.user.id, 'local-tom');

  const annotationPayload = {
    sourceUrl: 'https://example.com/acceptance-source',
    sourceType: 'article',
    sourceTitle: 'Acceptance source',
    commentaryMode: 'text',
    commentary: 'A durable publish should be safe to retry.',
    clientRequestId: 'acceptance-publish-1',
  };
  const published = await request(baseUrl, '/api/annotations', { method: 'POST', body: annotationPayload });
  assert.equal(published.response.status, 201);
  assert.ok(published.payload.annotation.id);
  assert.ok(published.payload.annotation.slug);

  const retried = await request(baseUrl, '/api/annotations', { method: 'POST', body: annotationPayload });
  assert.equal(retried.response.status, 200);
  assert.equal(retried.payload.annotation.id, published.payload.annotation.id);

  const detail = await request(baseUrl, `/api/annotations/${published.payload.annotation.slug}`);
  assert.equal(detail.response.status, 200);
  assert.equal(detail.payload.annotation.id, published.payload.annotation.id);

  const feed = await request(baseUrl, '/api/feed?limit=10');
  assert.equal(feed.response.status, 200);
  assert.equal(feed.payload.annotations.length, 1);

  const comment = await request(baseUrl, `/api/annotations/${published.payload.annotation.slug}/comments`, { method: 'POST', body: { body: 'The retry boundary is covered.' } });
  assert.equal(comment.response.status, 201);
  assert.equal(comment.payload.annotation.comments.length, 1);

  const claimPath = `/api/annotations/${published.payload.annotation.slug}/claims`;
  const claim = await request(baseUrl, claimPath, { method: 'POST', body: { reason: 'Acceptance test claim.' } });
  assert.equal(claim.response.status, 201);
  assert.equal(claim.payload.status, 'received');
  assert.ok(claim.payload.claim.id);

  const duplicateClaim = await request(baseUrl, claimPath, { method: 'POST', body: { reason: 'Duplicate should not create a second report.' } });
  assert.equal(duplicateClaim.response.status, 200);
  assert.equal(duplicateClaim.payload.status, 'already-received');
  assert.equal(duplicateClaim.payload.claim.id, claim.payload.claim.id);

  const reporterClaims = await request(baseUrl, '/api/claims');
  assert.equal(reporterClaims.response.status, 200);
  assert.equal(reporterClaims.payload.claims.length, 1);
  assert.equal(reporterClaims.payload.claims[0].status, 'open');

  const moderationClaims = await request(baseUrl, '/api/moderation/claims');
  assert.equal(moderationClaims.response.status, 200);
  assert.equal(moderationClaims.payload.claims.length, 1);
  const moderated = await request(baseUrl, `/api/moderation/claims/${claim.payload.claim.id}`, { method: 'POST', body: { status: 'in_review', note: 'Queued for review.' } });
  assert.equal(moderated.response.status, 200);
  assert.equal(moderated.payload.claim.status, 'in_review');

  const updatedReporterClaims = await request(baseUrl, '/api/claims');
  assert.equal(updatedReporterClaims.payload.claims[0].status, 'in_review');
});
