# Annotated deployment boundary

The container is deliberately configuration-only: it does not contain provider credentials, database credentials, source media, or a local production data directory.

Before starting a production container:

1. Load `DATABASE_URL`, `ANNOTATED_STORAGE=postgres`, and the enabled OAuth provider values from the deployment secret manager. Start with `OAUTH_PROVIDERS=google` and Google credentials; add `x` only after its client, callback, and secrets are configured.
2. Load `ANNOTATED_ASSET_STORAGE=s3`, the S3/R2 bucket/endpoint/credentials, `PUBLIC_ORIGIN`, `APP_ORIGIN`, and a non-wildcard `CORS_ORIGIN`.
3. Run `npm run db:migrate` from the same release artifact against the target database. Migration `004_rate_limit_buckets` creates the shared abuse-control ledger; do not route production traffic until it is applied.
4. Start the container (the image binds `HOST=0.0.0.0`) and require `/api/ready` to return 200 before routing traffic; readiness now verifies the latest migration, performs a database health query, checks the S3-compatible bucket, and probes `ffmpeg`, `ffprobe`, and the configured `YTDLP_BIN` provider extractor. A missing or non-executable media runtime returns 503 instead of allowing provider jobs to fail after deployment. Audio uploads accept only the supported recorder/media MIME types, enforce the 25 MB payload cap, and use PostgreSQL-backed rate-limit buckets when production is configured with PostgreSQL; local development and tests retain the bounded in-process fallback. Provider extraction, FFmpeg, and FFprobe commands are killed after `MEDIA_WORKER_PROCESS_TIMEOUT_MS` (300 seconds by default), then persisted as retryable failures; keep that deadline below the worker lease. Forward structured `http_request` logs and `/api/health` telemetry to the deployment's log/metrics sink.

   YouTube extraction also has an explicit egress configuration boundary. The
   image defaults `YTDLP_JS_RUNTIME=node`; if the hosting provider challenges
   shared egress, configure a managed `YTDLP_PROXY` and/or a secret-mounted
   `YTDLP_COOKIES_FILE` (absolute path), with an optional `YTDLP_PLAYER_CLIENT`.
   These values are passed as argument arrays to `yt-dlp`, never through a
   shell. A configured cookie path is checked during readiness, and the
   cookie file must stay outside the image and repository. A proxy or cookie
   is an operational dependency, not proof of successful extraction; run the
   bounded provider smoke before calling YouTube complete.
5. Verify a real OAuth callback, source resolution, media upload, feed write, and claim review in the deployed environment.

## Railway POC staging

Use one Railway project for the POC: an Annotated app service, Railway
PostgreSQL, and a private Railway Storage Bucket named `media`. Railway Buckets
are S3-compatible, so the app needs no provider-specific SDK or extension
credential.

1. Create the project in the closest suitable region (Amsterdam is the default
   POC choice for this UK staging environment), add PostgreSQL, then create the
   `media` bucket in the same environment. The bucket region cannot be changed
   later.
2. Map Railway's PostgreSQL and Bucket variable references into the app service:

   ```dotenv
   NODE_ENV=production
   ANNOTATED_STORAGE=postgres
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   ANNOTATED_ASSET_STORAGE=s3
   S3_BUCKET=${{media.BUCKET}}
   S3_REGION=${{media.REGION}}
   S3_ENDPOINT=${{media.ENDPOINT}}
   S3_FORCE_PATH_STYLE=false
   S3_ACCESS_KEY_ID=${{media.ACCESS_KEY_ID}}
   S3_SECRET_ACCESS_KEY=${{media.SECRET_ACCESS_KEY}}
   S3_URL_TTL_SECONDS=900
   ```

3. Leave `S3_PUBLIC_BASE_URL` unset. Railway Buckets are private, and
   Annotated's `/media/:id` endpoint issues a short-lived signed S3 URL; staging
   does not need a public bucket, browser-to-bucket CORS, or a CDN hostname.
4. Generate Railway's temporary HTTPS domain first and use it consistently for
   `PUBLIC_ORIGIN`, `APP_ORIGIN`, `CORS_ORIGIN`, and the Google callback. Add
   `staging.annotated.tcballard.dev` later at the current DNS provider once the
   POC works; no Cloudflare zone transfer is required.
5. Set the real Google OAuth credentials before production startup, run
   migrations from the release artifact, deploy, and require `/api/ready` to
   return 200 before trying the media acceptance flow. It confirms PostgreSQL,
   the private bucket, and the media runtime are usable with deployed settings.
6. From a clean checkout, run `STAGING_ORIGIN=https://<railway-domain>
   npm run acceptance:staging`. The command is non-mutating: it verifies health,
   readiness, provider configuration shape, the public root/brand asset, the
   privacy policy, an empty server-backed feed, and the expected unauthenticated
   identity and claims responses.
7. For a controlled worker/object-delivery smoke, run the guarded script inside
   the deployed app container after confirming the target is staging:

   ```bash
   railway ssh --service annotated --environment staging -- env \
     ACCEPTANCE_MEDIA_SMOKE=1 node scripts/accept-staging-media.mjs
   ```

   It creates direct-audio and direct-video fixtures, waits for the production
   worker to transcode them (including the video 240p/90-second guard), verifies
   each private `/media/:id` redirect and signed object response, then removes
   the fixtures and objects. It is not a substitute for authenticated OAuth
   publishing or browser playback.

8. For a controlled shared-rate-limit smoke, run the guarded script inside the
   same staging app container after confirming the target is staging:

   ```bash
   railway ssh --service annotated --environment staging -- env \
     ACCEPTANCE_RATE_LIMIT_SMOKE=1 node scripts/accept-staging-rate-limit.mjs
   ```

   It consumes three unique PostgreSQL buckets, proves the first two attempts
   are allowed and the third is denied by the shared ledger, then deletes the
   temporary bucket. It does not exercise a second live replica or claim edge
   WAF coverage.

9. Configure the POC bucket's durable object boundary only after confirming the
   target is staging. The guarded command enables bucket versioning and adds an
   incomplete-multipart-upload cleanup rule; it does not expire or delete
   published objects:

   ```bash
   railway ssh --service annotated --environment staging \
     "env APPLY_OBJECT_RETENTION=1 OBJECT_RETENTION_INCOMPLETE_UPLOAD_DAYS=7 npm run configure:object-retention"
   ```

   The command is restricted to `annotated-staging.up.railway.app`, requires
   production PostgreSQL/S3 configuration, and re-reads both policies before
   reporting success. It is a staging POC guard, not a substitute for a
   scheduled database backup or isolated restore drill.

   Railway Buckets currently expose the read-side retention calls but reject
   `PutBucketVersioning` and only accept expiration-style lifecycle rules. The
   command therefore fails closed with an explicit provider-capability error;
   do not treat a failed run as durable retention evidence. Use an S3-compatible
   provider that supports versioning and incomplete-upload lifecycle controls
   before enabling the strict backup retention gates.

Railway Buckets use virtual-hosted URLs at `https://storage.railway.app` with
the `auto` region. The generic adapter still validates a Cloudflare R2 endpoint
if one is configured later, but R2 is not part of this POC deployment.

Every push and pull request runs `.github/workflows/ci.yml`: a clean Node install,
build, test, syntax, diff, and extension-package check, followed by production
image builds for both `linux/amd64` and `linux/arm64`. Each image executes the
pin-verified `/usr/local/bin/yt-dlp --version` check before the workflow can pass.

The Node job also runs the production adapters against ephemeral PostgreSQL 16
and an S3-compatible MinIO service. The integration test applies the checked-in
migrations, exercises the transactional repository, creates and checks the
media bucket, uploads a fixture, verifies its signed delivery URL, and deletes
the object. Local `npm test` skips that test unless `DATABASE_URL` and the
required `S3_*` values are present; it never substitutes the file/local
adapters for this production-service evidence.

Backups and recovery are external operational gates: take a PostgreSQL snapshot before migrations, retain object-store versioning/retention for published assets, and keep the prior image available for rollback. Media job records, retry state, and worker leases live in the configured repository; a restarted process re-queues queued jobs and processing jobs whose lease has expired, while an active lease prevents a second instance from claiming the same job. Set `MEDIA_WORKER_LEASE_MS` longer than the longest expected provider download/transcode, and send worker logs to the deployment's operational sink. This persisted lease is a recovery boundary, not a substitute for a managed queue when independent worker scaling is required. Source and provider requests re-check DNS answers for private/link-local address space at each input or redirect hop; keep egress controls at the deployment boundary as a second layer. A failed readiness check must remove the instance from service; do not fall back to the file adapter in production.

## Non-destructive production backup audit

The repository includes `npm run backup:production` for a trusted operations
runner with `pg_dump` installed. It requires the production PostgreSQL and
S3-compatible credentials, writes a `0600` custom-format `postgres.dump`, a
sorted `objects.json` inventory, and a SHA-256/count `manifest.json` under a
new `BACKUP_OUTPUT_DIR`. It reads the database and bucket only; it never deletes
or overwrites production data, uploads credentials, or copies secret values into
the manifest. The manifest also records S3-compatible bucket versioning and
lifecycle state. Set `BACKUP_REQUIRE_OBJECT_VERSIONING=true` and/or
`BACKUP_REQUIRE_OBJECT_LIFECYCLE=true` when the provider policy is configured;
the command then fails closed if that policy is absent or unavailable. Refuse
to run it against the file/local adapters.

```bash
NODE_ENV=production \
  ANNOTATED_STORAGE=postgres \
  ANNOTATED_ASSET_STORAGE=s3 \
  BACKUP_OUTPUT_DIR=/secure/annotated-backups/$(date -u +%Y%m%dT%H%M%SZ) \
  npm run backup:production
```

Run this before every migration and on the agreed POC schedule. Preserve the
previous container image alongside the backup. For a recovery drill, create a
new isolated PostgreSQL database, restore `postgres.dump` with the command in
`manifest.json`, configure the restored app with the same private bucket (or a
provider-supported versioned copy), run `npm run db:migrate`, and require
`/api/ready` plus the staging acceptance command to pass. Never point
`pg_restore` at the live database. The script's object inventory is evidence of
what must be retained; it does not replace provider-side object versioning,
retention, or a completed restore drill.

Verify a completed artifact before scheduling a restore:

```bash
BACKUP_DIR=/secure/annotated-backups/20260804T120000Z npm run backup:verify
```

This checks the dump size and SHA-256, validates sorted/unique object keys and
totals, and runs `pg_restore --list` without connecting to a database. For an
explicit recovery drill, first create a new empty database whose name begins
with `annotated_recovery`, then run:

```bash
BACKUP_DIR=/secure/annotated-backups/20260804T120000Z \
  RUN_RECOVERY_DRILL=true \
  RECOVERY_DATABASE_URL=postgresql://user:password@db.example/annotated_recovery_20260804 \
  npm run backup:verify
```

The guarded drill restores without `--clean`, checks the restored migration
ledger, and never accepts an ambiguous database name. It does not delete or
repoint a database, and it does not copy object bytes; use the provider's
versioned/retained bucket or an isolated copy for media recovery.

The PostgreSQL rate-limit ledger stores only a SHA-256 bucket key, the fixed
window count, and expiry. Audio uploads, publishing, follows, comments, likes,
claims, moderation changes, and OAuth starts use the same atomic bucket
boundary, so multiple app instances cannot each reset an independent counter.
If the ledger is unavailable in production, the application fails closed for
the limited action rather than silently falling back to a process-local limit;
use an edge limiter as an additional first-mile control for volumetric abuse.

The Docker image includes the pinned provider extractor described below, and
`/api/ready` probes `ffmpeg`, `ffprobe`, and `YTDLP_BIN` before the instance can
receive traffic. That proves the runtime is present; it does not claim a
deployed provider transcode or browser playback run. The optional
`YTDLP_PROXY`, `YTDLP_COOKIES_FILE`, and `YTDLP_PLAYER_CLIENT` settings are
deliberately deployment configuration rather than image contents.

The image builds with dev dependencies present so Vite can produce the bundle, prunes them before runtime, excludes local state/secrets through `.dockerignore`, and runs as the unprivileged `annotated` user. It installs the pinned [yt-dlp 2026.06.09 standalone release](https://github.com/yt-dlp/yt-dlp/releases/tag/2026.06.09) with architecture-specific SHA-256 verification from the release's [`SHA2-256SUMS`](https://github.com/yt-dlp/yt-dlp/releases/download/2026.06.09/SHA2-256SUMS) (`yt-dlp_linux` for amd64 and `yt-dlp_linux_aarch64` for arm64) before setting `YTDLP_BIN`. Build it from a clean checkout and fail the release if the image build or `/api/ready` health check fails.
