# annotated v0.1.0 release boundary

> **Status:** draft release baseline. Railway POC staging is deployed and
> evidenced, but this release is not tagged, submitted to the Chrome Web Store,
> or declared production-ready.

`package.json`, `package-lock.json`, and `extension/manifest.json` all identify
the current code as `0.1.0`. The API health response reads that package version
rather than carrying a separate release number.

## What this draft establishes

- A local web capture desk and a Manifest V3 Chrome side panel for preserving a
  selected passage or a bounded media moment with text or recorded-audio
  commentary.
- Public source-backed annotation pages, a visible claim path, and server-backed
  feed, profile, follow, like, comment, and sharing flows.
- Local development adapters plus tested PostgreSQL/S3-compatible production
  boundaries, asynchronous media-job states, and deployment configuration.
- X and Google OAuth both enabled by default (`OAUTH_PROVIDERS=x,google`),
  with production refusing to boot unless credentials for every enabled
  provider are configured; no provider credential is embedded in the
  repository or extension.

The detailed product contract is in [PRODUCT.md](PRODUCT.md), and the live
brief comparison is in [BRIEF_ACCEPTANCE.md](BRIEF_ACCEPTANCE.md).

## Evidence held by this repository

Run the following from a clean checkout:

```bash
npm ci
npm run build
npm run check:release-truth
npm run check:store:inventory
npm test
npm run package:extension
for file in server/*.js src/*.js extension/*.js test/*.js scripts/*.js scripts/*.mjs e2e/*.mjs e2e/lib/*.mjs; do node --check "$file" || exit 1; done
git diff --check
```

The build also emits a deterministic, checksummed extension at
`dist/release/annotated-extension-v0.1.0.zip`; staging serves that exact file.
ZIP entry times come from the versioned `config/release.json` epoch, not the
current commit time, so a later Store-state or documentation commit cannot
silently change the uploaded package checksum. A version bump must deliberately
advance that release record.
`config/capabilities.json` is the versioned claim record, while
`/api/capabilities` overlays runtime deployment, provider and proof-world
evidence. The test suite covers the local API, release metadata alignment, source and
media policy, identity boundaries, social and moderation paths, extension
contracts, and production-adapter integration when PostgreSQL/S3-compatible
services are configured. [ACCEPTANCE_EVIDENCE.md](ACCEPTANCE_EVIDENCE.md)
records the current results and their limits.

CI also runs the checksummed ZIP in headed Chromium with no retries. The
protected `Authoritative release evidence` workflow combines that browser run
with PostgreSQL, public S3 delivery, a standalone media worker, real FFmpeg
transcodes, expired-lease recovery, and fixed release budgets. Browser timings
are deterministic loopback regression ceilings; protected service timings are
single-run production observations. Neither is mislabeled as a production
tail-latency SLO. The workflow emits a hashed
receipt tied to one commit and one extension ZIP, embeds it in the final web
bundle, and archives the exact evidence-bearing deployment image. A subsequent
source rebuild is not an equivalent release because it intentionally omits the
protected receipts. The draft baseline does not claim a receipt until the
protected workflow actually passes.

## What remains outside the v0.1.0 draft

These are release gates, not features to imply through versioning or copy:

- Complete deployed OAuth consent/callback/logout/expiry proof for both X and
  Google, plus a configured public application origin. Both providers are
  configured and reported live on staging; the deployed round-trip evidence
  is what remains.
- A production-grade PostgreSQL/object-storage/CDN environment with operational
  backup and recovery evidence; Railway staging is a POC boundary, not that
  production environment.
- A green authoritative release receipt from the protected staging or
  production evidence workflow. The repository contains the gate; source code
  or a local pass is not the receipt.
- Successful real-provider OAuth and microphone-recording evidence. Gate B
  covers the Chrome identity window cancellation and microphone-denial paths,
  but does not mislabel those as provider consent or successful audio capture.
- Real public source/provider runs and deployed playback for YouTube, news, and
  podcast captures.
- Three native-host Chrome Web Store screenshots, a verified public
  privacy-policy URL, the assigned item-ID/public-key reconciliation, and a
  monitored publisher contact before any submission. Promo artwork is ready.

See [CHROMEWEBSTORE.md](CHROMEWEBSTORE.md) for the store checklist and
[DEPLOYMENT.md](DEPLOYMENT.md) for the production configuration boundary.

## Release authority

Only Tom Ballard may approve a tag, GitHub release, deployment, Chrome Web
Store submission, or merge of this stacked draft. Clear the relevant evidence
above first; a passing local build or CI run is not publication authority.
