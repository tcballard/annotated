# Annotated deployment boundary

The container is deliberately configuration-only: it does not contain provider credentials, database credentials, source media, or a local production data directory.

Before starting a production container:

1. Load `DATABASE_URL`, `ANNOTATED_STORAGE=postgres`, and the enabled OAuth provider values from the deployment secret manager. Start with `OAUTH_PROVIDERS=google` and Google credentials; add `x` only after its client, callback, and secrets are configured.
2. Load `ANNOTATED_ASSET_STORAGE=s3`, the S3/R2 bucket/endpoint/credentials, `PUBLIC_ORIGIN`, `APP_ORIGIN`, and a non-wildcard `CORS_ORIGIN`.
3. Run `npm run db:migrate` from the same release artifact against the target database.
4. Start the container (the image binds `HOST=0.0.0.0`) and require `/api/ready` to return 200 before routing traffic; readiness now verifies the latest migration, performs a database health query, checks the S3-compatible bucket, and probes `ffmpeg`, `ffprobe`, and the configured `YTDLP_BIN` provider extractor. A missing or non-executable media runtime returns 503 instead of allowing provider jobs to fail after deployment. Forward structured `http_request` logs and `/api/health` telemetry to the deployment's log/metrics sink.
5. Verify a real OAuth callback, source resolution, media upload, feed write, and claim review in the deployed environment.

## Cloudflare R2 staging

Use Cloudflare R2 as the private object store for
`staging.annotated.tcballard.dev`. The app already speaks the S3-compatible
API, so no Cloudflare SDK or extension credential is required.

1. Create one staging bucket (recommended name: `annotated-staging-media`).
   Select the jurisdiction deliberately if data residency matters; the API
   endpoint is still configured with `S3_REGION=auto`.
2. Create an **Object Read & Write** R2 API token scoped to that bucket only.
   Copy its access-key ID and secret directly into the staging host's secret
   manager. The secret is shown once and must never enter Git, the extension,
   browser storage, or an application log.
3. Configure the host with:

   ```dotenv
   ANNOTATED_ASSET_STORAGE=s3
   S3_BUCKET=annotated-staging-media
   S3_REGION=auto
   S3_ENDPOINT=https://<cloudflare-account-id>.r2.cloudflarestorage.com
   S3_FORCE_PATH_STYLE=false
   S3_ACCESS_KEY_ID=<r2-access-key-id>
   S3_SECRET_ACCESS_KEY=<r2-secret-access-key>
   S3_URL_TTL_SECONDS=900
   ```

4. Leave `S3_PUBLIC_BASE_URL` unset and leave the bucket's `r2.dev` public
   development URL disabled. Annotated's `/media/:id` endpoint issues a
   short-lived signed S3 API URL, so staging does not need a public bucket,
   browser-to-R2 CORS, or a CDN hostname. Do not point a CNAME at `r2.dev`.
5. Run migrations from the release artifact, deploy, and require
   `https://staging.annotated.tcballard.dev/api/ready` to return `200` before
   trying the media acceptance flow. It confirms the R2 bucket can be reached
   with the deployed credentials.

R2's normal `https://<account-id>.r2.cloudflarestorage.com` endpoint and
`auto` region are required by Cloudflare's S3 API. The server validates those
two R2-specific settings at startup. A public asset domain can be considered
later only with a deliberate public-read/cache policy; it is not part of this
private staging profile.

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

The Docker image installs FFmpeg. It intentionally does not pretend that a provider extractor is present; install/pin `yt-dlp` in a reviewed worker-image extension and verify the actual runtime before enabling YouTube/podcast jobs.

The image builds with dev dependencies present so Vite can produce the bundle, prunes them before runtime, excludes local state/secrets through `.dockerignore`, and runs as the unprivileged `annotated` user. It installs the pinned [yt-dlp 2026.06.09 standalone release](https://github.com/yt-dlp/yt-dlp/releases/tag/2026.06.09) with architecture-specific SHA-256 verification from the release's [`SHA2-256SUMS`](https://github.com/yt-dlp/yt-dlp/releases/download/2026.06.09/SHA2-256SUMS) (`yt-dlp_linux` for amd64 and `yt-dlp_linux_aarch64` for arm64) before setting `YTDLP_BIN`. Build it from a clean checkout and fail the release if the image build or `/api/ready` health check fails.
