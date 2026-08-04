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
- Google-first OAuth configuration with an explicitly configured X provider
  path; no provider credential is embedded in the repository or extension.

The detailed product contract is in [PRODUCT.md](PRODUCT.md), and the live
brief comparison is in [BRIEF_ACCEPTANCE.md](BRIEF_ACCEPTANCE.md).

## Evidence held by this repository

Run the following from a clean checkout:

```bash
npm ci
npm run build
npm test
npm run package:extension
for file in server/*.js src/*.js extension/*.js test/*.js scripts/*.js; do node --check "$file" || exit 1; done
git diff --check
```

The test suite covers the local API, release metadata alignment, source and
media policy, identity boundaries, social and moderation paths, extension
contracts, and production-adapter integration when PostgreSQL/S3-compatible
services are configured. [ACCEPTANCE_EVIDENCE.md](ACCEPTANCE_EVIDENCE.md)
records the current results and their limits.

## What remains outside the v0.1.0 draft

These are release gates, not features to imply through versioning or copy:

- Complete deployed Google/X OAuth consent/callback/logout/expiry proof and a
  configured public application origin.
- A production-grade PostgreSQL/object-storage/CDN environment with operational
  backup and recovery evidence; Railway staging is a POC boundary, not that
  production environment.
- Installed-Chrome evidence for a docked side panel, microphone capture,
  offline retry, and service-worker lifecycle recovery.
- Real public source/provider runs and deployed playback for YouTube, news, and
  podcast captures.
- Chrome Web Store screenshots/promo artwork, a verified public privacy-policy
  URL, and a monitored publisher contact before any submission.

See [CHROMEWEBSTORE.md](CHROMEWEBSTORE.md) for the store checklist and
[DEPLOYMENT.md](DEPLOYMENT.md) for the production configuration boundary.

## Release authority

Only Tom Ballard may approve a tag, GitHub release, deployment, Chrome Web
Store submission, or merge of this stacked draft. Clear the relevant evidence
above first; a passing local build or CI run is not publication authority.
