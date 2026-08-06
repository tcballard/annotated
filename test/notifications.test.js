import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir as systemTmpdir } from 'node:os';
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
    resolve();
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.once('exit', (code, signal) => {
    clearTimeout(timeout);
    reject(new Error(`API server exited before ready (code=${code}, signal=${signal}).\n${output}`));
  });
});

test('notifications derive from responses, likes, and follows, with a seen watermark', async () => {
  const dataDirectory = await mkdtemp(path.join(systemTmpdir(), 'annotated-notifications-'));
  // The store is seeded before boot: me (the dev identity), an actor, my
  // annotation, and the three event kinds aimed at me — plus noise that
  // must not notify (my own like on my own annotation).
  const store = {
    users: [
      { id: 'local-tom', handle: 'tom', displayName: 'Tom', provider: 'local', providerId: 'local-tom' },
      { id: 'actor-1', handle: 'priya', displayName: 'Priya Sharma', provider: 'x', providerId: 'a1' },
    ],
    annotations: [
      { id: 'ann-1', slug: 'story-abc123', status: 'published', authorId: 'local-tom', sourceUrl: 'https://example.com/story', sourceType: 'article', sourceTitle: 'A story', sourceExcerpt: 'Passage.', commentaryMode: 'text', commentary: 'Note.', visibility: 'public', createdAt: '2026-08-01T10:00:00.000Z' },
    ],
    comments: [
      { id: 'c1', annotationId: 'ann-1', authorId: 'actor-1', body: 'Sharp note.', createdAt: '2026-08-01T11:00:00.000Z' },
    ],
    likes: [
      { id: 'l1', annotationId: 'ann-1', userId: 'actor-1', createdAt: '2026-08-01T12:00:00.000Z' },
      { id: 'l2', annotationId: 'ann-1', userId: 'local-tom', createdAt: '2026-08-01T12:30:00.000Z' },
    ],
    follows: [
      { id: 'f1', followerId: 'actor-1', followingId: 'local-tom', createdAt: '2026-08-01T13:00:00.000Z' },
    ],
  };
  await mkdir(dataDirectory, { recursive: true });
  await writeFile(path.join(dataDirectory, 'store.json'), JSON.stringify(store));

  const port = await freePort();
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: repoRoot,
    env: { ...process.env, PORT: String(port), ANNOTATED_DATA_DIR: dataDirectory, NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await waitForServer(child, port);
    const base = `http://localhost:${port}`;

    const first = await fetch(`${base}/api/notifications`).then((r) => r.json());
    assert.equal(first.notifications.length, 3, 'one response, one like, one follow — own actions never notify');
    assert.deepEqual(first.notifications.map((item) => item.type), ['follow', 'like', 'response'], 'newest first');
    assert.equal(first.notifications[2].body, 'Sharp note.');
    assert.equal(first.notifications[2].annotation.slug, 'story-abc123');
    assert.equal(first.notifications[0].actor.handle, 'priya');
    assert.equal(first.unseenCount, 3);

    const seen = await fetch(`${base}/api/notifications/seen`, { method: 'POST' }).then((r) => r.json());
    assert.ok(seen.seenAt);
    const second = await fetch(`${base}/api/notifications`).then((r) => r.json());
    assert.equal(second.notifications.length, 3, 'the list keeps its history');
    assert.equal(second.unseenCount, 0, 'the watermark clears the badge');
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
    await rm(dataDirectory, { recursive: true, force: true });
  }
});
