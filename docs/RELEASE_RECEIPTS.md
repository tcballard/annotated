# Release receipts

A release receipt is the machine-readable evidence behind Annotated's browser-
verified capability state. It binds one full Git commit to the exact extension
ZIP, a production-shaped integration run, browser artifacts, retry history, and
the fixed release budgets. A final Playwright pass after a failed attempt is still a
failed release receipt.

The generator is deliberately fail-closed. It writes the receipt even when the
gate fails, so CI can retain the reason, then exits non-zero. The checker reads
that receipt, recomputes every budget, and re-hashes every referenced file.

## Authoritative CI flow

Generate the extension artifact before collecting evidence. Then run the
browser suite with Playwright's JSON and JUnit reporters and keep its console,
network, screenshot, video, and trace files under `artifacts/e2e/`.

The production adapter JUnit, standalone-worker JSON, and redacted worker log
come from the fail-closed, service-backed production evidence runner. Its JUnit
must contain no skipped tests:

```sh
mkdir -p artifacts/e2e artifacts/production artifacts/release
export RELEASE_ENVIRONMENT=staging
export RELEASE_ORIGIN=https://annotated-staging.up.railway.app
npm run build
npx playwright install --with-deps chromium
xvfb-run -a env ANNOTATED_E2E_HEADED=1 ANNOTATED_E2E_ARTIFACTS="$PWD/artifacts/e2e" npm run test:e2e
npm run release:evidence
npm run release:evidence:compose

node scripts/generate-release-receipt.mjs \
  --input artifacts/release/evidence-manifest.json \
  --output artifacts/release/receipt.json \
  --base-dir "$PWD"

node scripts/check-release-slo.mjs \
  --receipt artifacts/release/receipt.json \
  --base-dir "$PWD"
```

The receipt defaults to `artifacts/release/receipt.json`, so `--output` and
`--receipt` may be omitted. `RELEASE_EVIDENCE_MANIFEST` and
`RELEASE_RECEIPT_PATH` are equivalent CI environment inputs.

When the release build publishes a receipt, pass the checked path through the
build's `ANNOTATED_RELEASE_RECEIPT` input. A published receipt is evidence only
when its commit and extension checksum still match the release metadata.

## Evidence manifest

Paths are resolved against `--base-dir`, which defaults to the current working
directory. Every referenced file must remain inside that directory (including
after resolving symlinks), and the receipt stores it as a canonical relative
POSIX path. This keeps downloaded receipts portable and independently
re-verifiable. The standard Playwright JSON report is primary evidence; an
optional `browser.attempts` array is accepted only when it exactly matches the
attempts in that report.

```json
{
  "gitSha": "0123456789abcdef0123456789abcdef01234567",
  "environment": "staging",
  "origin": "https://annotated-staging.up.railway.app",
  "startedAt": "2026-08-10T05:00:00.000Z",
  "completedAt": "2026-08-10T05:04:12.000Z",
  "artifact": {
    "version": "0.1.0",
    "path": "dist/release/annotated-extension-v0.1.0.zip",
    "sha256": "64-lowercase-hex-characters",
    "bytes": 165914
  },
  "productionShape": {
    "browserExtension": true,
    "runtimeMode": "production",
    "persistence": "postgres",
    "objectStorage": "s3",
    "mediaWorker": "standalone",
    "realMediaTranscode": true
  },
  "browser": {
    "engine": "chromium",
    "playwrightJson": "artifacts/e2e/playwright-report.json",
    "junit": "artifacts/e2e/junit.xml",
    "logs": [
      "artifacts/e2e/console.jsonl",
      "artifacts/e2e/network.jsonl"
    ],
    "screenshots": [
      "artifacts/e2e/test-results/release/annotated.png"
    ],
    "videos": [
      "artifacts/e2e/test-results/release/video.webm"
    ],
    "traces": [
      "artifacts/e2e/test-results/release/trace.zip"
    ]
  },
  "productionEvidence": {
    "integrationJunit": "artifacts/production/integration-junit.xml",
    "mediaWorkerJson": "artifacts/production/media-worker.json"
  },
  "capabilityIds": [
    "side-panel",
    "capture",
    "commentary",
    "source-links",
    "landing-pages",
    "claims"
  ]
}
```

`artifact.sha256` and `artifact.bytes` may be omitted and will be computed. If
provided, they must match. Screenshots, videos, traces, console/network logs,
and the `duration-samples` JSON discovered in the Playwright attachments are
added automatically; explicit arrays make the intended release evidence easier
to audit. At least one screenshot, video, and trace, named console and network logs,
and a duration-samples attachment are mandatory. An empty console-errors log is
valid evidence that no browser errors were observed.

The production JUnit must name and pass real PostgreSQL and S3/object-storage
coverage. Caller-supplied `productionShape` flags do not satisfy that gate on
their own.

## Standalone worker proof

The Playwright-attached duration-samples artifact supplies panel usability,
source resolution, and publish acknowledgement. The hashed `mediaWorkerJson`
artifact supplies pickup, lease-recovery, and playback timing samples. None of
the six measurements can therefore be replaced by values in the evidence
manifest.

```json
{
  "schemaVersion": 1,
  "kind": "annotated.media-worker-integration",
  "status": "passed",
  "gitSha": "0123456789abcdef0123456789abcdef01234567",
  "environment": "staging",
  "runtimeMode": "production",
  "persistence": "postgres",
  "objectStorage": "s3",
  "workerMode": "standalone",
  "transcoder": "ffmpeg",
  "realMediaTranscode": true,
  "apiProcess": {
    "executable": "server/index.js",
    "processRole": "api",
    "mediaWorkerConcurrency": 0,
    "readyStatus": 200,
    "mediaRuntimeStatus": "ready",
    "oauthProviderVerification": false
  },
  "apiQueue": {
    "status": "passed",
    "endpoint": "POST /api/annotations",
    "publishStatus": 201,
    "authenticatedBy": "isolated PostgreSQL bearer session",
    "annotationId": "api-created-annotation-id",
    "jobId": "api-created-media-job-id",
    "initialStatus": "queued",
    "attempts": 0,
    "observedBeforeWorkerStart": true
  },
  "workerProcess": {
    "processRole": "media-worker",
    "concurrency": 2,
    "mediaJobMaxAttempts": 1,
    "s3MaxAttempts": 1
  },
  "retryPolicy": {
    "maxAttempts": 1,
    "retriesAllowed": false,
    "observedRetries": 0,
    "allJobsFirstAttempt": true
  },
  "s3RetryPolicy": {
    "maxAttempts": 1,
    "retriesAllowed": false,
    "runnerClientMaxAttempts": 1,
    "workerClientMaxAttempts": 1
  },
  "pickup": {
    "status": "passed",
    "observed": true,
    "jobId": "api-created-media-job-id",
    "initialStatus": "queued",
    "samplesMs": [840]
  },
  "recovery": {
    "status": "passed",
    "recoveredLease": true,
    "samplesMs": [1120]
  },
  "playback": {
    "status": "passed",
    "audioReady": true,
    "videoReady": true,
    "samplesMs": [930, 1014]
  },
  "fixtures": [
    {
      "sourceType": "podcast",
      "jobStatus": "ready",
      "mediaStatus": "ready",
      "jobAttempts": 0,
      "deliveryStatus": 200,
      "transcoded": true,
      "hasAudio": true
    },
    {
      "sourceType": "video",
      "jobStatus": "ready",
      "mediaStatus": "ready",
      "jobAttempts": 0,
      "deliveryStatus": 200,
      "transcoded": true,
      "hasAudio": true,
      "videoHeight": 240
    }
  ],
  "evidence": {
    "junit": "artifacts/production/integration-junit.xml",
    "log": "artifacts/production/production-evidence.log"
  }
}
```

The commit and environment must match the evidence manifest. The JUnit and
non-empty redacted log named by the proof are both hashed into the receipt.
The production API must run with zero worker concurrency, pass readiness,
authenticate through PostgreSQL, and persist the pristine queued job before
the worker starts. Pickup must show the standalone process claiming that exact
API-created job; recovery must exercise an
expired lease; both an audio and bounded video transcode must reach signed
HTTP-200 delivery. Authoritative proof also requires the worker to report
one permitted media-job attempt, one permitted AWS SDK attempt for both the
runner and worker S3 clients, zero observed media-job retries, and a zero
attempt count for each completed fixture. Those fields are copied into the receipt summary and
compared again with the hashed worker proof by the independent checker.

## Fixed release budgets

These are fail-closed maximums for the observed release run, not production
tail-latency SLOs. The browser measurements come from the deterministic
loopback behavior gate and prove regression ceilings, not deployed network or
database scalability. Worker measurements come from the protected PostgreSQL,
S3, and standalone-worker run, but remain single-run release observations. A
real production p95/p99 claim requires repeated deployed traffic or telemetry
and is deliberately outside this receipt.

| Measurement | Budget |
| --- | ---: |
| Side panel first usable | 2,000 ms |
| Source resolution | 1,500 ms |
| Publish acknowledgement | 1,000 ms |
| Media job pickup | 5,000 ms |
| Expired-lease recovery | 5,000 ms |
| Playback readiness | 3,000 ms |

The thresholds are defined in the generator and checker, not in the caller's
manifest. Missing samples and budget breaches both fail the release.

## Receipt shape

The generated JSON has stable top-level release fields for runtime capability
verification:

```text
schemaVersion, kind, authoritative, status, generatedAt
gitSha, environment, origin, startedAt, completedAt, durationMs
artifact { version, path, sha256, bytes }
productionShape
browser { runner, engine, testSummary, reliabilityStatus, junitSummary }
performance { status, classification, productionLatencySlo:false, results[] }
evidence {
  playwright, junit, browserGate, logs[], screenshots[], videos[], traces[], browserMetrics[],
  productionIntegration { junit, summary },
  mediaWorker { report, log, summary }
}
capabilityEvidence { status, verifiedAt, gitSha, artifactSha256, capabilityIds[] }
failures[]
```

The Playwright-attached Gate B receipt supplies the only browser capability
IDs and is hashed as `evidence.browserGate`; its IDs must exactly match
`capabilityEvidence.capabilityIds`. Every file reference has
`{ path, sha256, bytes }`. An authoritative receipt is
green only when `authoritative` is `true`, `status` is `passed`, retry and flake
counts are zero, every fixed release budget passes, and `failures` is empty.

## Local diagnostics

Local or non-release origins must be explicit and can never emit a passing
release receipt:

```sh
node scripts/generate-release-receipt.mjs \
  --non-authoritative \
  --input artifacts/e2e/release-evidence.json

node scripts/check-release-slo.mjs \
  --allow-non-authoritative \
  --receipt artifacts/release/receipt.json
```

Non-authoritative mode relaxes only the release environment/HTTPS authority.
It does not waive missing files, skipped tests, retries, production adapter
proof, worker recovery, or release-budget breaches.
