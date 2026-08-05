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

## What the current build covers

- Article, video, podcast, and screenshot capture; text-quote anchoring with
  `#:~:text=` deep links, timestamped media deep links, and 90-second media
  boundaries enforced at the UI, the API, and the transcode probe.
- Hosted 240p clips and audio segments with the visible `CLIP` tag and
  duration · 240p badge; a **File a claim** action above the fold on every
  annotation page, with a moderation pipeline that can resolve a claim into a
  real takedown (public tombstone, media deleted).
- Text and browser-recorded audio commentary; public · unlisted · private
  visibility; author controls (delete outright, edit the note within 30
  minutes, change visibility anytime).
- A persisted public feed with inline media, follows, comments, source hubs
  (`/s/:host`), people search, a curators rail ranked by opens of the
  original, per-annotation open counts, profiles, and a signed-in Library.
- A Manifest V3 side panel — the primary surface — with four full-height
  modes (Capture · Recent · Following · This page), player-read marks with
  I/O keys, per-tab session drafts, offline capture queueing, and
  browser-local audio staging.
- Server-rendered OG cards and injected social meta on every permalink; X and
  Google OAuth both enabled by default, with production refusing to boot
  unless both are configured.

## For reviewers

Judging against the brief? Each requirement maps to a place you can click:

| Brief requirement | Where to verify |
| --- | --- |
| Sidebar extension as primary surface | Load [`extension/`](extension/) unpacked (`chrome://extensions` → Load unpacked). Open any YouTube page → Mark in/out read the player (`I`/`O` keys) |
| File a claim on every annotation page | Any `/a/:slug` page — right-aligned in the action bar, above the fold |
| Clips link back to the original | "Open original at 0:14 ↗" on media pages; "Open original at ¶ n ↗" deep-links article passages via `#:~:text=` |
| Max 90-second clips, server-side | `POST /api/annotations` with a 91-second range → 422; audio uploads are ffprobe-checked too |
| 240p video / audio segments | The `0:48 · 240p` badge on every player state; transcode output is probe-verified ≤240p/≤90s before it can publish |
| Auth: X or Google only | Both sign-in buttons on the timeline and panel; production fails fast unless both are configured |
| Public feed, follow, comment | `/` timeline (Recent/Following), responses on every permalink |
| Text and recorded audio commentary | The Text · Audio toggle in the panel and `/capture` |
| Landing page per clip | `curl -s <permalink> \| grep og:` — injected and escaped; the share card lives at `/og/:slug.png` |

To seed a fresh deployment with demo content: `ANNOTATED_ORIGIN=<origin> npm run seed:demo`
(see [`scripts/seed-demo.json`](scripts/seed-demo.json) for the operator slots). To make
the feed read like a lived-in place, `npm run seed:personas` adds four demo annotators
with real-source annotations (every `#:~:text=` deep link lands on the quoted words),
cross-follows, responses, and likes — idempotent, store-level, and refusing to run in
production without `ANNOTATED_SEED_PERSONAS=allow`.

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
