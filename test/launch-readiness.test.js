import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir as systemTmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { envLimit, permalinkCacheControl, staticCacheControl } from '../server/edge-cache.js';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

// The launch posture in three rules: public permalinks may sit at the edge,
// nothing visibility-gated ever may, and the per-IP crowd limits are
// tunable without being disableable.

test('public permalink HTML is edge-cacheable; unlisted and private never are', () => {
  const publicRule = permalinkCacheControl('public');
  assert.match(publicRule, /public/);
  assert.match(publicRule, /s-maxage=60/);
  assert.match(publicRule, /stale-while-revalidate/);
  assert.equal(permalinkCacheControl('unlisted'), 'no-store', 'an unlisted page: its existence is the secret');
  assert.equal(permalinkCacheControl('private'), 'no-store');
  assert.equal(permalinkCacheControl(undefined), 'no-store', 'unknown visibility fails closed');
});

test('hashed assets are immutable, release artifacts revalidate, the shell is untouched', () => {
  assert.equal(staticCacheControl('/assets/index-Bx1z2.js'), 'public, max-age=31536000, immutable');
  assert.equal(staticCacheControl('/release/annotated-extension-v0.1.0.zip'), 'public, max-age=300, must-revalidate');
  assert.equal(staticCacheControl('/index.html'), undefined);
  assert.equal(staticCacheControl('/manifest.webmanifest'), undefined);
});

test('crowd limits accept env overrides, bounded so a typo cannot disable the limiter', () => {
  delete process.env.RATE_LIMIT_OPEN_ORIGINAL;
  assert.equal(envLimit('open-original', 120), 120, 'default holds without the env var');
  process.env.RATE_LIMIT_OPEN_ORIGINAL = '2400';
  assert.equal(envLimit('open-original', 120), 2400, 'a launch crowd behind carrier NAT gets headroom');
  process.env.RATE_LIMIT_OPEN_ORIGINAL = '0';
  assert.equal(envLimit('open-original', 120), 120, 'zero cannot switch the limiter off');
  process.env.RATE_LIMIT_OPEN_ORIGINAL = 'unlimited';
  assert.equal(envLimit('open-original', 120), 120, 'garbage falls back');
  process.env.RATE_LIMIT_OPEN_ORIGINAL = '9999999';
  assert.equal(envLimit('open-original', 120), 100_000, 'even a generous override stays bounded');
  delete process.env.RATE_LIMIT_OPEN_ORIGINAL;
});

// End to end: a spawned server serves a real public permalink with the edge
// header and keeps an unlisted one private, exactly as the unit rules say.
test('spawned server applies the permalink edge rules end to end', async () => {
  const dataDir = await mkdtemp(path.join(systemTmpdir(), 'annotated-launch-'));
  const port = await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => { const { port: found } = probe.address(); probe.close(() => resolve(found)); });
  });
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: repoRoot,
    env: { ...process.env, PORT: String(port), ANNOTATED_STORAGE: 'file', ANNOTATED_DATA_DIR: dataDir, NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await new Promise((resolve, reject) => {
      let output = '';
      const timeout = setTimeout(() => reject(new Error(`server did not start\n${output}`)), 10_000);
      const onData = (chunk) => {
        output += chunk;
        if (output.includes(`listening on http://localhost:${port}`)) { clearTimeout(timeout); resolve(); }
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.once('exit', () => { clearTimeout(timeout); reject(new Error(`server exited early\n${output}`)); });
    });
    const base = `http://127.0.0.1:${port}`;
    const publish = async (visibility) => {
      const response = await fetch(`${base}/api/annotations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sourceUrl: `https://example.com/launch-${visibility}`, sourceType: 'article', sourceTitle: `Launch ${visibility}`, sourceExcerpt: 'A passage.', commentaryMode: 'text', commentary: 'Edge rules.', visibility }),
      });
      assert.equal(response.status, 201);
      return (await response.json()).annotation.slug;
    };
    const publicSlug = await publish('public');
    const unlistedSlug = await publish('unlisted');
    const publicPage = await fetch(`${base}/a/${publicSlug}`);
    assert.equal(publicPage.status, 200);
    assert.match(publicPage.headers.get('cache-control') || '', /s-maxage=60/, 'public permalink carries the edge header');
    const unlistedPage = await fetch(`${base}/a/${unlistedSlug}`);
    assert.equal(unlistedPage.status, 200);
    assert.equal(unlistedPage.headers.get('cache-control'), 'no-store', 'unlisted permalink stays uncacheable');
  } finally {
    child.kill('SIGTERM');
    await rm(dataDir, { recursive: true, force: true });
  }
});
