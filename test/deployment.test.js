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
  assert.match(dockerfile, /ENV YTDLP_JS_RUNTIME=node/);
});

test('docker build context excludes local state and secrets', async () => {
  const ignore = await readFile(new URL('../.dockerignore', import.meta.url), 'utf8');
  assert.match(ignore, /^data$/m);
  assert.match(ignore, /^\.env$/m);
  assert.match(ignore, /^node_modules$/m);
  assert.match(ignore, /^\*\.cookies$/m);
  assert.match(ignore, /^\*\.cookiejar$/m);
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
  assert.match(deployment, /MEDIA_WORKER_PROCESS_TIMEOUT_MS/);
  assert.match(env, /MEDIA_WORKER_LEASE_MS=600000/);
  assert.match(env, /MEDIA_WORKER_PROCESS_TIMEOUT_MS=300000/);
});

test('deployment documents the shared production rate-limit ledger', async () => {
  const deployment = await readFile(new URL('../DEPLOYMENT.md', import.meta.url), 'utf8');
  const storage = await readFile(new URL('../STORAGE.md', import.meta.url), 'utf8');
  const migration = await readFile(new URL('../server/migrations/004_rate_limit_buckets.sql', import.meta.url), 'utf8');
  const env = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
  assert.match(deployment, /004_rate_limit_buckets/);
  assert.match(deployment, /fails closed/);
  assert.match(storage, /annotated_rate_limit_buckets/);
  assert.match(migration, /PRIMARY KEY \(bucket_key, window_start\)/);
  assert.match(env, /PG_RATE_LIMIT_POOL_MAX=4/);
});

test('deployment documents the non-destructive production backup audit', async () => {
  const deployment = await readFile(new URL('../DEPLOYMENT.md', import.meta.url), 'utf8');
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const backup = await readFile(new URL('../scripts/backup-production.mjs', import.meta.url), 'utf8');
  const verifier = await readFile(new URL('../scripts/verify-backup.mjs', import.meta.url), 'utf8');
  assert.equal(packageJson.scripts['backup:production'], 'node scripts/backup-production.mjs');
  assert.equal(packageJson.scripts['backup:verify'], 'node scripts/verify-backup.mjs');
  assert.match(deployment, /## Non-destructive production backup audit/);
  assert.match(deployment, /custom-format `postgres\.dump`/);
  assert.match(deployment, /never deletes\n?or overwrites production data/);
  assert.match(deployment, /Never point\n?`pg_restore` at the live database/);
  assert.match(backup, /--format=custom/);
  assert.match(backup, /ListObjectsV2Command/);
  assert.match(backup, /GetBucketVersioningCommand/);
  assert.match(backup, /BACKUP_REQUIRE_OBJECT_LIFECYCLE/);
  assert.match(backup, /Refusing to overwrite existing backup file/);
  assert.match(verifier, /annotated_recovery/);
  assert.match(verifier, /runPgRestoreList/);
});

test('deployment documents the private Railway Buckets POC profile', async () => {
  const deployment = await readFile(new URL('../DEPLOYMENT.md', import.meta.url), 'utf8');
  const storage = await readFile(new URL('../STORAGE.md', import.meta.url), 'utf8');
  const env = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
  assert.match(deployment, /## Railway POC staging/);
  assert.match(deployment, /S3_REGION=\$\{\{media\.REGION\}\}/);
  assert.match(deployment, /storage\.railway\.app/);
  assert.match(deployment, /S3_PUBLIC_BASE_URL.*unset/);
  assert.match(storage, /## Railway Buckets POC profile/);
  assert.match(storage, /S3_PUBLIC_BASE_URL[\s\S]*unset/);
  assert.match(env, /S3_ENDPOINT=https:\/\/storage\.railway\.app/);
});

test('release docs distinguish verified Railway staging from public release', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  const release = await readFile(new URL('../RELEASE.md', import.meta.url), 'utf8');
  const deployment = await readFile(new URL('../DEPLOYMENT.md', import.meta.url), 'utf8');
  assert.match(readme, /Railway POC staging/);
  assert.match(readme, /annotated-staging\.up\.railway\.app/);
  assert.match(release, /Railway POC staging is deployed and\s+> evidenced/);
  assert.match(release, /not tagged, submitted to the Chrome Web Store/);
  assert.match(deployment, /pinned provider extractor described below/);
  assert.doesNotMatch(deployment, /does not pretend that a provider extractor is present/);
  assert.match(deployment, /YTDLP_PROXY/);
  assert.match(deployment, /YTDLP_COOKIES_FILE/);
  assert.match(deployment, /passed as argument arrays/);
});

test('provider egress settings are visible in the local configuration contract', async () => {
  const env = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
  assert.match(env, /YTDLP_JS_RUNTIME=node/);
  assert.match(env, /YTDLP_PROXY=https:\/\/proxy\.example/);
  assert.match(env, /YTDLP_COOKIES_FILE=\/run\/secrets\/youtube\.cookies/);
  assert.match(env, /YTDLP_PLAYER_CLIENT=web_safari/);
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
