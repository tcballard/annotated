import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('production image builds before pruning dev dependencies and runs non-root', async () => {
  const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
  assert.match(dockerfile, /RUN npm ci\n/);
  assert.match(dockerfile, /RUN npm run build && npm prune --omit=dev/);
  assert.match(dockerfile, /USER annotated/);
  assert.match(dockerfile, /ENV HOST=0\.0\.0\.0/);
  assert.match(dockerfile, /ARG YTDLP_VERSION=2026\.06\.09/);
  assert.match(dockerfile, /YTDLP_SHA256_AMD64=[0-9a-f]{64}/);
  assert.match(dockerfile, /YTDLP_SHA256_ARM64=[0-9a-f]{64}/);
  assert.match(dockerfile, /releases\/download\/\$\{YTDLP_VERSION\}\/\$\{asset\}/);
  assert.match(dockerfile, /sha256sum --check --strict/);
  assert.match(dockerfile, /\/usr\/local\/bin\/yt-dlp --version/);
  assert.match(dockerfile, /ENV YTDLP_BIN=\/usr\/local\/bin\/yt-dlp/);
});

test('docker build context excludes local state and secrets', async () => {
  const ignore = await readFile(new URL('../.dockerignore', import.meta.url), 'utf8');
  assert.match(ignore, /^data$/m);
  assert.match(ignore, /^\.env$/m);
  assert.match(ignore, /^node_modules$/m);
});

test('production server bind host is configurable for container networking', async () => {
  const server = await readFile(new URL('../server/index.js', import.meta.url), 'utf8');
  assert.match(server, /const host = process\.env\.HOST \|\| '127\.0\.0\.1'/);
  assert.match(server, /server\.listen\(port, host,/);
});

test('deployment documents persisted media-worker leases', async () => {
  const deployment = await readFile(new URL('../DEPLOYMENT.md', import.meta.url), 'utf8');
  const env = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
  assert.match(deployment, /worker leases live in the configured repository/);
  assert.match(deployment, /managed queue when independent worker scaling is required/);
  assert.match(env, /MEDIA_WORKER_LEASE_MS=600000/);
});

test('deployment documents the private Cloudflare R2 staging profile', async () => {
  const deployment = await readFile(new URL('../DEPLOYMENT.md', import.meta.url), 'utf8');
  const storage = await readFile(new URL('../STORAGE.md', import.meta.url), 'utf8');
  const env = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
  assert.match(deployment, /## Cloudflare R2 staging/);
  assert.match(deployment, /S3_REGION=auto/);
  assert.match(deployment, /r2\.cloudflarestorage\.com/);
  assert.match(deployment, /r2\.dev[\s\S]*disabled/);
  assert.match(storage, /## Cloudflare R2 staging profile/);
  assert.match(storage, /S3_PUBLIC_BASE_URL.*unset/);
  assert.match(env, /S3_REGION=auto/);
});

test('web build includes a privacy policy with the extension data boundary', async () => {
  const policy = await readFile(new URL('../public/privacy.html', import.meta.url), 'utf8');
  const listing = await readFile(new URL('../CHROMEWEBSTORE.md', import.meta.url), 'utf8');
  assert.match(policy, /Privacy policy/);
  assert.match(policy, /browser-local IndexedDB/);
  assert.match(policy, /Google or X/);
  assert.match(policy, /deletion request/i);
  assert.match(listing, /`\/privacy\.html`/);
  assert.match(listing, /public deployment and URL verification[\s\S]*external gates/i);
});
