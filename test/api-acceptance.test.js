import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir as systemTmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const packageVersion = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8')).version;

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
  const dataDirectory = await mkdtemp(path.join(systemTmpdir(), 'annotated-api-'));
  await writeFile(path.join(dataDirectory, 'store.json'), JSON.stringify({
    users: [
      { id: 'local-tom', handle: 'tcballard', displayName: 'Tom Ballard', role: 'owner' },
      { id: 'reader-1', handle: 'reader', displayName: 'Avid Reader', role: 'member' },
    ],
    annotations: [{
      id: 'failed-annotation',
      slug: 'failed-clip',
      status: 'published',
      createdAt: '2026-08-01T00:00:00.000Z',
      authorId: 'local-tom',
      sourceUrl: 'https://example.com/failed-video-source',
      canonicalUrl: 'https://example.com/failed-video-source',
      sourceTitle: 'Failed video fixture',
      sourceHost: 'example.com',
      sourceType: 'video',
      mediaStatus: 'failed',
      mediaError: 'Provider request was rate limited.',
      clipStart: 0,
      clipEnd: 1,
      commentaryMode: 'text',
      commentary: 'A failed media job remains retryable by its owner.',
    }],
    mediaJobs: [{
      id: 'failed-job',
      annotationId: 'failed-annotation',
      sourceUrl: 'https://example.com/failed-video-source',
      sourceType: 'video',
      sourceMediaUrl: 'https://example.com/failed-video.mp4',
      mediaUrl: 'https://example.com/failed-video.mp4',
      provider: 'youtube',
      clipStart: 0,
      clipEnd: 1,
      attempts: 3,
      status: 'failed',
      error: 'Provider request was rate limited.',
      createdAt: '2026-08-01T00:00:00.000Z',
    }],
  }));
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
      MEDIA_WORKER_CONCURRENCY: '0',
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
  assert.equal(health.payload.version, packageVersion);
  assert.equal(health.payload.persistence, 'file');
  assert.equal(health.response.headers.get('access-control-allow-origin'), allowedOrigin);
  assert.ok(health.response.headers.get('x-request-id'));

  const ready = await request(baseUrl, '/api/ready', { origin: allowedOrigin });
  assert.equal(ready.response.status, 200);
  assert.equal(ready.payload.status, 'ready');
  assert.equal(ready.payload.mediaRuntime.status, 'development');

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

  const unsupportedAudioResponse = await fetch(`${baseUrl}/api/media/audio`, { method: 'POST', headers: { 'content-type': 'video/mp4' }, body: Buffer.from('not audio') });
  const unsupportedAudio = await unsupportedAudioResponse.json();
  assert.equal(unsupportedAudioResponse.status, 415);
  assert.match(unsupportedAudio.error, /Unsupported audio content type/);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const audioResponse = await fetch(`${baseUrl}/api/media/audio`, { method: 'POST', headers: { 'content-type': 'audio/webm;codecs=opus' }, body: Buffer.from(`audio fixture ${attempt}`) });
    assert.equal(audioResponse.status, 201);
  }
  const audioLimitResponse = await fetch(`${baseUrl}/api/media/audio`, { method: 'POST', headers: { 'content-type': 'audio/webm' }, body: Buffer.from('rate limit boundary') });
  const audioLimit = await audioLimitResponse.json();
  assert.equal(audioLimitResponse.status, 429);
  assert.equal(audioLimitResponse.headers.get('retry-after'), '60');

  const annotationPayload = {
    sourceUrl: 'https://example.com/acceptance-source',
    sourceType: 'article',
    sourceTitle: 'Acceptance source',
    sourceExcerpt: 'A selected passage from the acceptance article.',
    commentaryMode: 'text',
    commentary: 'A durable publish should be safe to retry.',
    clientRequestId: 'acceptance-publish-1',
  };
  const published = await request(baseUrl, '/api/annotations', { method: 'POST', body: annotationPayload });
  assert.equal(published.response.status, 201);
  assert.ok(published.payload.annotation.id);
  assert.ok(published.payload.annotation.slug);
  assert.equal(published.payload.annotation.sourceUrl, annotationPayload.sourceUrl);
  assert.equal(published.payload.annotation.canonicalUrl, annotationPayload.sourceUrl);

  const retried = await request(baseUrl, '/api/annotations', { method: 'POST', body: annotationPayload });
  assert.equal(retried.response.status, 200);
  assert.equal(retried.payload.annotation.id, published.payload.annotation.id);

  const detail = await request(baseUrl, `/api/annotations/${published.payload.annotation.slug}`);
  assert.equal(detail.response.status, 200);
  assert.equal(detail.payload.annotation.id, published.payload.annotation.id);
  assert.equal(detail.payload.annotation.sourceUrl, annotationPayload.sourceUrl);
  assert.equal(detail.payload.annotation.canonicalUrl, annotationPayload.sourceUrl);

  const feed = await request(baseUrl, '/api/feed?limit=10');
  assert.equal(feed.response.status, 200);
  assert.equal(feed.payload.annotations.length, 2);
  const publishedFeedItem = feed.payload.annotations.find((item) => item.sourceUrl === annotationPayload.sourceUrl);
  assert.ok(publishedFeedItem);
  assert.equal(publishedFeedItem.canonicalUrl, annotationPayload.sourceUrl);

  const profile = await request(baseUrl, '/api/profiles/tcballard');
  assert.equal(profile.response.status, 200);
  assert.equal(profile.payload.profile.handle, 'tcballard');
  assert.equal(profile.payload.profile.annotationCount, 2);
  assert.equal(profile.payload.profile.annotations.length, 2);
  assert.equal('email' in profile.payload.profile, false);

  const readerBeforeFollow = await request(baseUrl, '/api/profiles/reader');
  assert.equal(readerBeforeFollow.response.status, 200);
  assert.equal(readerBeforeFollow.payload.profile.isFollowing, false);
  assert.equal(readerBeforeFollow.payload.profile.followers, 0);

  const followed = await request(baseUrl, '/api/users/reader-1/follow', { method: 'POST' });
  assert.equal(followed.response.status, 200);
  assert.equal(followed.payload.following, true);

  const readerAfterFollow = await request(baseUrl, '/api/profiles/reader');
  assert.equal(readerAfterFollow.payload.profile.isFollowing, true);
  assert.equal(readerAfterFollow.payload.profile.followers, 1);

  const followingFeed = await request(baseUrl, '/api/feed?following=true');
  assert.equal(followingFeed.response.status, 200);
  assert.equal(followingFeed.payload.annotations.length, 2);
  assert.ok(followingFeed.payload.annotations.every((item) => item.authorId === 'local-tom'));

  const unfollowed = await request(baseUrl, '/api/users/reader-1/unfollow', { method: 'POST' });
  assert.equal(unfollowed.response.status, 200);
  assert.equal(unfollowed.payload.following, false);

  const comment = await request(baseUrl, `/api/annotations/${published.payload.annotation.slug}/comments`, { method: 'POST', body: { body: 'The retry boundary is covered.' } });
  assert.equal(comment.response.status, 201);
  assert.equal(comment.payload.annotation.comments.length, 1);

  const liked = await request(baseUrl, `/api/annotations/${published.payload.annotation.slug}/like`, { method: 'POST' });
  assert.equal(liked.response.status, 200);
  assert.equal(liked.payload.annotation.likes, 1);
  assert.equal(liked.payload.annotation.likedByMe, true);

  const duplicateLike = await request(baseUrl, `/api/annotations/${published.payload.annotation.slug}/like`, { method: 'POST' });
  assert.equal(duplicateLike.response.status, 200);
  assert.equal(duplicateLike.payload.annotation.likes, 1);

  const unliked = await request(baseUrl, `/api/annotations/${published.payload.annotation.slug}/unlike`, { method: 'POST' });
  assert.equal(unliked.response.status, 200);
  assert.equal(unliked.payload.annotation.likes, 0);
  assert.equal(unliked.payload.annotation.likedByMe, false);

  const retry = await request(baseUrl, '/api/annotations/failed-clip/media/retry', { method: 'POST' });
  assert.equal(retry.response.status, 202);
  assert.equal(retry.payload.annotation.mediaStatus, 'queued');
  assert.equal(retry.payload.annotation.mediaError, null);
  assert.equal(retry.payload.job.status, 'queued');

  const duplicateRetry = await request(baseUrl, '/api/annotations/failed-clip/media/retry', { method: 'POST' });
  assert.equal(duplicateRetry.response.status, 409);

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

  for (let attempt = 0; attempt < 59; attempt += 1) {
    const nextStatus = attempt % 2 === 0 ? 'in_review' : 'open';
    const repeated = await request(baseUrl, `/api/moderation/claims/${claim.payload.claim.id}`, { method: 'POST', body: { status: nextStatus, note: 'Repeated moderation attempt.' } });
    assert.equal(repeated.response.status, 200);
  }
  const moderationLimit = await request(baseUrl, `/api/moderation/claims/${claim.payload.claim.id}`, { method: 'POST', body: { status: 'in_review', note: 'Rate limit boundary.' } });
  assert.equal(moderationLimit.response.status, 429);
  assert.equal(moderationLimit.response.headers.get('retry-after'), '60');

  const updatedReporterClaims = await request(baseUrl, '/api/claims');
  assert.equal(updatedReporterClaims.payload.claims[0].status, 'in_review');

  // The public contract must preserve the original source for every brief-supported
  // source type. The UI uses this field for its “Open source” citation link.
  const sourceCitationFixtures = [
    {
      sourceType: 'video',
      sourceUrl: 'https://example.com/acceptance-video-source',
      sourceTitle: 'Acceptance video source',
      mediaUrl: 'https://example.com/acceptance-video.mp4',
      clientRequestId: 'acceptance-source-video',
    },
    {
      sourceType: 'podcast',
      sourceUrl: 'https://example.com/acceptance-podcast-source',
      sourceTitle: 'Acceptance podcast source',
      mediaUrl: 'https://example.com/acceptance-podcast.mp3',
      clientRequestId: 'acceptance-source-podcast',
    },
  ];
  for (const fixture of sourceCitationFixtures) {
    const created = await request(baseUrl, '/api/annotations', {
      method: 'POST',
      body: {
        ...fixture,
        commentaryMode: 'text',
        commentary: `Source citation contract for ${fixture.sourceType}.`,
        clipStart: 0,
        clipEnd: 0,
      },
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.payload.annotation.sourceUrl, fixture.sourceUrl);
    assert.equal(created.payload.annotation.canonicalUrl, fixture.sourceUrl);
    assert.match(created.payload.annotation.url, /\/a\/[a-z0-9-]+$/);

    const publicDetail = await request(baseUrl, `/api/annotations/${created.payload.annotation.slug}`);
    assert.equal(publicDetail.response.status, 200);
    assert.equal(publicDetail.payload.annotation.sourceUrl, fixture.sourceUrl);
    assert.equal(publicDetail.payload.annotation.canonicalUrl, fixture.sourceUrl);

    const filteredFeed = await request(baseUrl, `/api/feed?sourceType=${fixture.sourceType}`);
    assert.equal(filteredFeed.response.status, 200);
    const filteredItem = filteredFeed.payload.annotations.find((item) => item.sourceUrl === fixture.sourceUrl);
    assert.ok(filteredItem);
    assert.equal(filteredItem.canonicalUrl, fixture.sourceUrl);
  }
});
