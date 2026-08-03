# Annotated deployment boundary

The container is deliberately configuration-only: it does not contain provider credentials, database credentials, source media, or a local production data directory.

Before starting a production container:

1. Load `DATABASE_URL`, `ANNOTATED_STORAGE=postgres`, and the Google/X OAuth values from the deployment secret manager.
2. Load `ANNOTATED_ASSET_STORAGE=s3`, the S3/R2 bucket/endpoint/credentials, `PUBLIC_ORIGIN`, `APP_ORIGIN`, and a non-wildcard `CORS_ORIGIN`.
3. Run `npm run db:migrate` from the same release artifact against the target database.
4. Start the container (the image binds `HOST=0.0.0.0`) and require `/api/ready` to return 200 before routing traffic; readiness now verifies the latest migration, performs a database health query, checks the S3-compatible bucket, and probes `ffmpeg`, `ffprobe`, and the configured `YTDLP_BIN` provider extractor. A missing or non-executable media runtime returns 503 instead of allowing provider jobs to fail after deployment. Forward structured `http_request` logs and `/api/health` telemetry to the deployment's log/metrics sink.
5. Verify a real OAuth callback, source resolution, media upload, feed write, and claim review in the deployed environment.

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
