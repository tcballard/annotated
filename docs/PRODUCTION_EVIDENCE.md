# Production-shaped release evidence

`scripts/run-production-evidence.mjs` is the fail-closed backend half of the
release gate. It does not accept a flag that converts local substitutes or
skips into passing evidence.

The runner requires:

- `NODE_ENV=production`
- `ANNOTATED_STORAGE=postgres`
- `ANNOTATED_ASSET_STORAGE=s3`
- `RELEASE_ENVIRONMENT=staging` or `production`
- `DATABASE_URL`
- `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, and
  `S3_SECRET_ACCESS_KEY`
- the production `ffmpeg`, `ffprobe`, and configured `YTDLP_BIN` executables

The authoritative runner always starts its standalone worker with
`MEDIA_WORKER_MAX_ATTEMPTS=1`, regardless of the caller's environment. This
makes every passing fixture a first-attempt observation: a transient failure
fails the evidence run instead of being hidden by an automatic retry.

Run it from the repository root:

```sh
node scripts/run-production-evidence.mjs
```

The configured bucket must make the runner's generated input keys available
through a publicly routable signed URL, or through the optional
`S3_PUBLIC_BASE_URL` CDN mapping. A localhost/private MinIO URL is deliberately
rejected: the production worker's SSRF policy must reject that URL too, and the
evidence runner will not bypass the policy or claim that an unobserved job ran.
Use an isolated staging database and bucket prefix for authoritative release
evidence.

On success, the runner has directly observed all of the following:

1. current migrations and a PostgreSQL record round trip;
2. an S3 PUT/HEAD/GET byte-for-byte round trip;
3. controlled audio/video source generation with real FFmpeg and FFprobe;
4. `server/index.js` starting in production mode with
   `MEDIA_WORKER_CONCURRENCY=0`, passing `/api/ready`, authenticating an
   isolated PostgreSQL bearer session, and accepting the controlled video at
   `POST /api/annotations`;
5. the API-created media job persisted with `status=queued`, `attempts=0`, and
   no worker ID before the standalone worker process is started;
6. `server/media-worker-main.js` starting as a separate child process;
7. that worker ID claiming the exact API-created queued job and recovering an expired lease, with
   a one-attempt retry policy reported by the worker startup event;
8. ready video and podcast outputs stored in S3, returned over HTTP 200, and
   passing FFprobe stream/duration constraints; and
9. explicit removal of the generated PostgreSQL and S3 fixtures.

Only the expired-lease recovery branch is inserted directly. The normal video
path must cross the real production HTTP/auth/validation/persistence/enqueue
boundary, so an API-to-job schema regression cannot be hidden by a runner-side
fixture. Controlled placeholder OAuth configuration satisfies production boot
without making or recording a Google/X provider-verification claim.

It writes three non-empty artifacts under `artifacts/production/`:

- `media-worker.json`, consumed as `productionEvidence.mediaWorkerJson` by the
  release-receipt generator;
- `integration-junit.xml`, consumed as
  `productionEvidence.integrationJunit`; and
- `production-evidence.log`, a redacted JSONL execution log.

A failed run still writes JSON, JUnit, and log artifacts, but reports a nonzero
exit status and at least one JUnit failure. A passing JUnit report always has
zero failures and zero skips. The JSON binds the API queue observation, the worker's media-job attempt
limit and both AWS SDK S3 clients to `maxAttempts: 1`, zero observed media-job
retries, and each fixture's attempt count into
the proof consumed by the release receipt. It also includes measured
`media_job_pickup_ms`, `media_job_recovery_ms`, and backend playback-readiness
samples. Packaged-extension Playwright evidence remains the authority for
actual end-user browser playback.
