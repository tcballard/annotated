# Annotated deployment boundary

The container is deliberately configuration-only: it does not contain provider credentials, database credentials, source media, or a local production data directory.

Before starting a production container:

1. Load `DATABASE_URL`, `ANNOTATED_STORAGE=postgres`, and the enabled OAuth provider values from the deployment secret manager. The brief requires X **and** Google sign-in, so the default is `OAUTH_PROVIDERS=x,google` and production fails fast at boot unless `X_CLIENT_ID`/`X_CLIENT_SECRET` **and** `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are all present (callbacks default to `PUBLIC_ORIGIN/api/auth/<provider>/callback`; override with `X_REDIRECT_URI`/`GOOGLE_REDIRECT_URI` if the app origin differs). A deploy that boots without Google credentials is a checklist failure, not a working configuration.
2. Load `ANNOTATED_ASSET_STORAGE=s3`, the S3/R2 bucket/endpoint/credentials, `PUBLIC_ORIGIN`, `APP_ORIGIN`, a non-wildcard `CORS_ORIGINS`, and `CHROME_EXTENSION_IDS` for packaged extension builds.
3. Run `npm run db:migrate` and then `npm run check:relational-integrity` from the same release artifact against the target database. This includes the shared production rate-limit ledger introduced by migration `004_rate_limit_buckets` and the normalized relational projection in `006_relational_core`. Follow [RELATIONAL_MIGRATION.md](RELATIONAL_MIGRATION.md); do not route traffic or select the rollback journal after a failed comparison.
4. Start the API container (the image binds `HOST=0.0.0.0`) and a separate worker service from the same image with `npm run worker` (Railway can use `railway.worker.json`). The production API is queue-only and refuses nonzero transcode concurrency. Both processes use the same PostgreSQL and object-storage configuration. `/api/ready` proves the API's migration/database/object-store boundary and reports the media runtime as external. Separately require the worker's `media_worker_started` event, which is emitted only after the worker verifies PostgreSQL, `ffmpeg`, `ffprobe`, and `YTDLP_BIN`. Audio uploads accept only supported MIME types, enforce the 25 MB cap, and use PostgreSQL-backed rate limits. Provider extraction, FFmpeg, and FFprobe are killed after `MEDIA_WORKER_PROCESS_TIMEOUT_MS` (300 seconds by default); keep it below the lease. Jobs expose queue age/status through the token-protected `/api/operator/metrics` endpoint and emit trace-linked claim/provider/probe/object/ready/retry/dead-letter events without source content. Set a random `OPERATOR_METRICS_TOKEN` of at least 24 characters and keep that route behind operator access.

   YouTube extraction also has an explicit egress configuration boundary. The
   image defaults `YTDLP_JS_RUNTIME=node`; if the hosting provider challenges
   shared egress, configure a managed `YTDLP_PROXY` and/or a secret-mounted
   `YTDLP_COOKIES_FILE` (absolute path). The image also installs the pinned
   bgutil PO-token plugin. Run its HTTP provider as a separate private service
   and set `YTDLP_POT_PROVIDER_URL` (for example,
   `http://pot-provider.railway.internal:4416`); the worker then uses yt-dlp's
   recommended `mweb` client and dynamically fetched tokens. Override that
   client only with `YTDLP_PLAYER_CLIENT` when deployed evidence requires it.
   These values are passed as argument arrays to `yt-dlp`, never through a
   shell. A configured cookie path is checked during readiness, and the
   cookie file must stay outside the image and repository. A proxy or cookie
   is an operational dependency, not proof of successful extraction; run the
   bounded provider smoke before calling YouTube complete. A PO token can help
   with YouTube attestation, but does not cure an IP-level 429: managed egress
   remains a separate requirement.

   Worker pickup defaults to two seconds (`MEDIA_WORKER_POLL_MS=2000`). Each
   provider, transcode, probe, object-store, database, and background-poster
   stage emits a `durationMs` field. Video uses the bounded `superfast` x264
   preset by default; compare `ultrafast`, `superfast`, and `veryfast` on the
   target worker CPU with `npm run benchmark:media` before changing
   `MEDIA_WORKER_VIDEO_PRESET`. Poster extraction is cosmetic and occurs after
   the verified clip is marked ready, so it no longer extends publish latency.
5. Verify a real OAuth callback, source resolution, media upload, feed write, and claim review in the deployed environment.

For public CDN delivery, set `S3_PUBLIC_BASE_URL` to the delivery origin and
configure an HTTPS `MEDIA_CDN_PURGE_ENDPOINT` plus a random
`MEDIA_CDN_PURGE_TOKEN` of at least 24 characters. Annotated then uploads
UUID-addressed objects with immutable cache metadata and fails a takedown if the
exact delivery URL cannot be purged after origin deletion. Without purge
credentials, public objects use a five-minute revalidating cache instead. Private
signed-object delivery remains `private, no-store` and needs no CDN purge.

## Railway POC staging

Use one Railway project for the POC: an Annotated API service, an Annotated
worker service from the same image, Railway PostgreSQL, and a private Railway Storage Bucket named `media`. Railway Buckets
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
   `PUBLIC_ORIGIN`, `APP_ORIGIN`, `CORS_ORIGINS`, `CHROME_EXTENSION_IDS`, and the Google callback. Add
   `staging.annotated.tcballard.dev` later at the current DNS provider once the
   POC works; no Cloudflare zone transfer is required.
5. Set the real X **and** Google OAuth credentials before production startup
   (the server refuses to boot with either pair missing), run migrations from
   the release artifact, deploy, and require `/api/ready` to return 200 before
   trying the media acceptance flow. It confirms PostgreSQL and the private
   bucket are usable; require the worker startup event for media-runtime proof.
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
build, test, syntax, diff, Store-inventory, and extension-package check; a
no-retry headed-Chromium run of the checksummed extension; then production image
builds for both `linux/amd64` and `linux/arm64`. Each image executes the
pin-verified `/usr/local/bin/yt-dlp --version` check before the workflow can pass.

The Node job also runs the production adapters against ephemeral PostgreSQL 16
and an S3-compatible MinIO service. The integration test applies the checked-in
migrations, exercises the transactional repository, creates and checks the
media bucket, uploads a fixture, verifies its signed delivery URL, and deletes
the object. Local `npm test` skips that test unless `DATABASE_URL` and the
required `S3_*` values are present; it never substitutes the file/local
adapters for this production-service evidence.

The manually dispatched `.github/workflows/release-evidence.yml` is the only
authoritative receipt lane. It is intentionally staging-only while the
capability manifest has a single staging canonical origin. Protect the GitHub
environment named `staging`, require reviewer approval, and provide
`DATABASE_URL`, optional `PGSSL`, `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, optional
`S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, and optional
`S3_PUBLIC_BASE_URL`. Those credentials need migration/read/write/delete access
to an isolated evidence database and bucket prefix. When the Store manifest is
published, also provide `CWS_ITEM_ID` and `CHROME_EXTENSION_IDS`; the workflow
then performs the live Store/endpoints/CORS check before embedding its receipt.
That Store receipt is valid for at most 24 hours. The capabilities endpoint
checks its expiry on every request and removes the **Add to Chrome** promotion
when it is stale; rerun the protected verification and deploy the refreshed
evidence bundle to restore it.
Add a production workflow option only after an environment-specific production
canonical origin is modeled and validated in the release contract.
Artifacts and evidence logs are excluded from the ordinary Docker build
context.

The workflow finishes by overlaying the validated `dist/` tree onto the exact
production image it exercised, verifies the embedded browser/production receipt
(and the live Store receipt when published), and exports
`artifacts/release/annotated-authoritative-image.tar.gz` plus its SHA-256. Deploy
that image archive (or publish the loaded image through the approved registry
process); do not rebuild the source checkout after the receipt is generated,
because an ordinary build intentionally has no authority to copy protected
evidence into a release.

```bash
cd artifacts/release
sha256sum --check annotated-authoritative-image.tar.gz.sha256
gzip --decompress --stdout annotated-authoritative-image.tar.gz | docker load
```

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

Hosted CI also exercises the artifact path against ephemeral PostgreSQL and
MinIO: it runs `pg_dump`, inventories the real S3-compatible bucket, writes the
manifest, runs `npm run backup:verify` with `pg_restore --list`, and restores
the dump into a separately named `annotated_recovery_ci` database before
checking the migration ledger. This proves the command boundary, artifact
shape, and database recovery path; it is not a scheduled production backup,
provider retention policy, object-byte recovery, or isolated live recovery of
the deployed service.

## Operator-run production backup archive

`npm run backup:production` can archive a verified backup to a distinct
S3-compatible destination when `BACKUP_ARCHIVE_REQUIRED=true` is set. It
requires the production database/media secrets plus a distinct
`BACKUP_ARCHIVE_BUCKET` and archive credentials, uploads only `postgres.dump`,
`objects.json`, and `manifest.json` under a dated prefix, and then the operator
should run `npm run backup:verify`. Archive versioning and lifecycle are strict
gates: the command fails before upload if the archive provider does not report
both policies. Configure these secrets in the trusted runner or secret manager
before an owner-authorized run:

```text
ANNOTATED_PRODUCTION_DATABASE_URL
ANNOTATED_PRODUCTION_MEDIA_BUCKET
ANNOTATED_PRODUCTION_MEDIA_REGION
ANNOTATED_PRODUCTION_MEDIA_ENDPOINT
ANNOTATED_PRODUCTION_MEDIA_FORCE_PATH_STYLE
ANNOTATED_PRODUCTION_MEDIA_ACCESS_KEY_ID
ANNOTATED_PRODUCTION_MEDIA_SECRET_ACCESS_KEY
ANNOTATED_PRODUCTION_BACKUP_BUCKET
ANNOTATED_PRODUCTION_BACKUP_REGION
ANNOTATED_PRODUCTION_BACKUP_ENDPOINT
ANNOTATED_PRODUCTION_BACKUP_FORCE_PATH_STYLE
ANNOTATED_PRODUCTION_BACKUP_ACCESS_KEY_ID
ANNOTATED_PRODUCTION_BACKUP_SECRET_ACCESS_KEY
```

The source Railway bucket is not treated as the archive destination. A recurring
cron/GitHub Actions schedule is deliberately not enabled by this repository;
the owner must choose and authorize the scheduler and its production secret
scope after reviewing the archive destination.

The PostgreSQL rate-limit ledger stores only a SHA-256 bucket key, the fixed
window count, and expiry. Audio uploads, publishing, follows, comments, likes,
claims, moderation changes, and OAuth starts use the same atomic bucket
boundary, so multiple app instances cannot each reset an independent counter.
If the ledger is unavailable in production, the application fails closed for
the limited action rather than silently falling back to a process-local limit;
use an edge limiter as an additional first-mile control for volumetric abuse.

The Docker image includes the pinned provider extractor described below. The
standalone worker probes `ffmpeg`, `ffprobe`, and `YTDLP_BIN` before polling;
the API never executes those binaries. That proves the runtime is present; it
does not claim a deployed provider transcode or browser playback run. The optional
`YTDLP_PROXY`, `YTDLP_COOKIES_FILE`, `YTDLP_PLAYER_CLIENT`, and
`YTDLP_POT_PROVIDER_URL` settings are
deliberately deployment configuration rather than image contents.

The image builds with dev dependencies present so Vite can produce the bundle, prunes them before runtime, excludes local state/secrets through `.dockerignore`, and runs as the unprivileged `annotated` user. It installs the pinned [yt-dlp 2026.06.09 standalone release](https://github.com/yt-dlp/yt-dlp/releases/tag/2026.06.09) with architecture-specific SHA-256 verification from the release's [`SHA2-256SUMS`](https://github.com/yt-dlp/yt-dlp/releases/download/2026.06.09/SHA2-256SUMS) (`yt-dlp_linux` for amd64 and `yt-dlp_linux_aarch64` for arm64) before setting `YTDLP_BIN`. It also checksum-pins [bgutil-ytdlp-pot-provider 1.3.1](https://github.com/Brainicism/bgutil-ytdlp-pot-provider/releases/tag/1.3.1) and proves yt-dlp can discover the plugin during the image build. Build it from a clean checkout and fail the release if the image build or `/api/ready` health check fails.
