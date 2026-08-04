# annotated

**A Chrome side panel for keeping a specific moment from the web — a passage or
short clip — with your context and the original source attached.**

Annotated is for readers who want to preserve more than a bookmark. Capture a
selected passage or a bounded media moment, add a written or recorded-audio
note, and publish a source-backed annotation that can be discussed, followed,
or challenged.

> **v0.1.0 is a draft release baseline.** Local development and a Railway POC
> staging service are available with automated evidence; this is not a public
> production release or a Chrome Web Store submission.

## Try it locally

```bash
npm ci
npm run dev:server
```

In a second terminal, run `npm run dev` and open the Vite URL it prints. The
web app proxies `/api` to `http://localhost:8787`.

To load the Chrome side panel, open `chrome://extensions`, enable Developer
mode, choose **Load unpacked**, select [`extension/`](extension/), and set its
API origin defaults to Railway staging. Set it to `http://localhost:8787` in
the extension options only when testing against a local backend.

## Railway POC staging

The current staging build is available at
[`annotated-staging.up.railway.app`](https://annotated-staging.up.railway.app).
It uses Railway PostgreSQL and a private Railway Storage Bucket for the
production-shaped persistence boundary. From a clean checkout, run the
non-mutating public smoke with:

```bash
STAGING_ORIGIN=https://annotated-staging.up.railway.app npm run acceptance:staging
```

Staging is evidence for the API, readiness, source-resolution, and configured
OAuth boundaries. It is not a promise of successful provider consent, docked
Chrome behavior, microphone capture, or production traffic.

## What the v0.1.0 draft covers

- Article, video, and podcast capture modes; text selection and 90-second media
  boundaries.
- Text and browser-recorded audio commentary, public source-backed pages, and
  a visible **File a claim** path.
- A persisted public feed, profiles, follows, likes, comments, and sharing.
- A Manifest V3 side panel with bounded local recovery metadata and
  browser-local audio staging.
- Production-shaped PostgreSQL/S3, OAuth, media-worker, and deployment
  boundaries that are configured separately from local development. The
  current Railway POC enables X sign-in only; Google remains an optional
  adapter for a later release.

## Release boundary

Read [RELEASE.md](RELEASE.md) for the exact v0.1.0 status, repeatable checks,
and the external gates that still prevent a public release. The detailed live
brief comparison is in [BRIEF_ACCEPTANCE.md](BRIEF_ACCEPTANCE.md); it is the
acceptance source, not this README.

## Useful references

- [Approved brand kit](assets/brand/annotated-brand-kit/README.md)
- [Brand guidelines](assets/brand/annotated-brand-kit/guidelines/annotated-brand-guidelines.pdf)
- [Product contract](PRODUCT.md)
- [Acceptance evidence](ACCEPTANCE_EVIDENCE.md)
- [Dated acceptance-gap audit](ACCEPTANCE_GAP_AUDIT_2026-08-04.md)
- [Extension surface map](EXTENSION_SURFACE_MAP.md)
- [Chrome Web Store readiness](CHROMEWEBSTORE.md)
- [Storage boundary](STORAGE.md)
- [Deployment boundary](DEPLOYMENT.md)
- [Performance architecture](PERFORMANCE.md)

For a production-shaped run, start with [`.env.example`](.env.example), then
follow [DEPLOYMENT.md](DEPLOYMENT.md). Do not put provider credentials in the
extension or treat local file storage as production persistence.
