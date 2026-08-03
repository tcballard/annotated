# Annotated deployment boundary

The container is deliberately configuration-only: it does not contain provider credentials, database credentials, source media, or a local production data directory.

Before starting a production container:

1. Load `DATABASE_URL`, `ANNOTATED_STORAGE=postgres`, and the enabled OAuth provider values from the deployment secret manager. Start with `OAUTH_PROVIDERS=google` and Google credentials; add `x` only after its client, callback, and secrets are configured.
2. Load `ANNOTATED_ASSET_STORAGE=s3`, the S3/R2 bucket/endpoint/credentials, `PUBLIC_ORIGIN`, `APP_ORIGIN`, and a non-wildcard `CORS_ORIGIN`.
3. Run `npm run db:migrate` from the same release artifact against the target database.
4. Start the container (the image binds `HOST=0.0.0.0`) and require `/api/ready` to return 200 before routing traffic; readiness now verifies the latest migration, performs a database health query, checks the S3-compatible bucket, and probes `ffmpeg`, `ffprobe`, and the configured `YTDLP_BIN` provider extractor. A missing or non-executable media runtime returns 503 instead of allowing provider jobs to fail after deployment. Audio uploads accept only the supported recorder/media MIME types, enforce the 25 MB payload cap, and have a per-actor process-local mutation limit; use a distributed edge or service limiter for multi-instance abuse protection. Provider extraction, FFmpeg, and FFprobe commands are killed after `MEDIA_WORKER_PROCESS_TIMEOUT_MS` (300 seconds by default), then persisted as retryable failures; keep that deadline below the worker lease. Forward structured `http_request` logs and `/api/health` telemetry to the deployment's log/metrics sink.
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

   It creates one direct-audio podcast fixture, waits for the production
   worker to transcode it, verifies the private `/media/:id` redirect and
   signed object response, then removes the fixture and object. It is not a
   substitute for authenticated OAuth publishing or browser playback.

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

The Docker image includes the pinned provider extractor described below, and
`/api/ready` probes `ffmpeg`, `ffprobe`, and `YTDLP_BIN` before the instance can
receive traffic. That proves the runtime is present; it does not claim a
deployed provider transcode or browser playback run.

The image builds with dev dependencies present so Vite can produce the bundle, prunes them before runtime, excludes local state/secrets through `.dockerignore`, and runs as the unprivileged `annotated` user. It installs the pinned [yt-dlp 2026.06.09 standalone release](https://github.com/yt-dlp/yt-dlp/releases/tag/2026.06.09) with architecture-specific SHA-256 verification from the release's [`SHA2-256SUMS`](https://github.com/yt-dlp/yt-dlp/releases/download/2026.06.09/SHA2-256SUMS) (`yt-dlp_linux` for amd64 and `yt-dlp_linux_aarch64` for arm64) before setting `YTDLP_BIN`. Build it from a clean checkout and fail the release if the image build or `/api/ready` health check fails.
