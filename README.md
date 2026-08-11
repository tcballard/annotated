<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/brand/logo-inverse.svg">
    <img src="public/brand/logo-primary.svg" alt="annotated wordmark" width="178">
  </picture>
</p>

<p align="center">
  <a href="https://github.com/tcballard/annotated/actions/workflows/ci.yml"><img src="https://github.com/tcballard/annotated/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="License: Apache-2.0"></a>
  <a href="extension/"><img src="https://img.shields.io/badge/chrome-Manifest%20V3-informational" alt="Chrome extension: Manifest V3"></a>
</p>

<p align="center">
  <a href="https://annotated.lovable.app/"><b>The brief</b></a> ·
  <a href="https://annotated-staging.up.railway.app"><b>Live staging</b></a> ·
  <a href="docs/BRIEF_ACCEPTANCE.md"><b>Acceptance map</b></a> ·
  <a href="#for-reviewers"><b>For reviewers</b></a>
</p>

**A Chrome side panel that captures a passage, a bounded clip, or a snip of
the page, adds your context, and publishes a page that keeps the original
source attached.** A bookmark saves an address; Annotated saves the moment
itself — the ninety seconds that mattered, the paragraph worth arguing with —
transcoded, hosted, and playing right in the feed, with **Open original**
deep-linked to the exact second or sentence. Not an embed. Not a link that
rots.

> **v0.1.0 is a draft release baseline.** Local development and a
> Railway POC staging service are real and evidenced; a public production
> release and a Chrome Web Store submission are not.
> [RELEASE.md](docs/RELEASE.md) names every gate still open.

## Try it in two minutes

```bash
npm ci
npm run dev:server   # API on :8787
npm run dev          # web app — open the Vite URL it prints; /api proxies to the server
```

For the side panel, download the
[checksummed staging build](https://annotated-staging.up.railway.app/release/annotated-extension-v0.1.0.zip),
unzip it, open `chrome://extensions`, enable Developer mode, choose **Load
unpacked**, and select that folder. Repository contributors can select
[`extension/`](extension/) directly. It talks to Railway staging by default;
point it at `http://localhost:8787` in the extension options only when you want
the local backend.

Staging is live at
[`annotated-staging.up.railway.app`](https://annotated-staging.up.railway.app),
on Railway PostgreSQL and a private storage bucket. Smoke it from a clean
checkout — the check mutates nothing:

```bash
STAGING_ORIGIN=https://annotated-staging.up.railway.app npm run acceptance:staging
```

Staging is evidence for the API, readiness, source resolution, and the
configured OAuth boundaries. It is not a promise of provider consent flows,
docked-Chrome behaviour, microphone capture, or production traffic.

## The panel is the primary surface

A Manifest V3 side panel with four full-height modes — Capture · Recent ·
Following · This page. Marks read the player: press `I` and `O` and the
in/out points take the video's own timestamps. Drafts live per tab, captures
queue when the service is unreachable, and recorded audio stays staged in the
browser until upload.

## What the build does

- **Captures four ways from one panel** — article passage, video clip, podcast
  clip, or screenshot — with text-quote anchoring (`#:~:text=` deep links),
  timestamped media links, and the 90-second boundary enforced three times:
  in the UI, at the API, and by the transcode probe. Clips are real hosted
  artifacts: 240p video or audio segments wearing the `CLIP` tag and a
  duration badge, playing inline.
- **Treats rights as a surface, not fine print.** A clearly visible **Dispute
  fair use** button on every annotation page, a no-JS dispute form at
  `/a/:slug/claim`, and a moderation pipeline that can resolve a dispute into
  a real takedown — public tombstone, media deleted.
- **Gives the author real controls.** Text or browser-recorded audio
  commentary; public · unlisted · private visibility; delete outright, edit
  the note within 30 minutes, change visibility anytime.
- **Runs a public margin, not a private vault.** A persisted feed with inline
  media, follows, responses, source hubs (`/s/:host`), people search, open
  counts, profiles, a signed-in Library, and a curators rail ranked by the
  number that matters here: opens of the original.
- **Publishes pages worth sharing.** Server-rendered OG cards and injected
  social meta on every permalink; X and Google sign-in both on by default,
  and production refuses to boot unless both are configured.

Under the hood the write path is row-native PostgreSQL: a like lands in about
a millisecond at fifty thousand rows, and CI fails the build if it crosses 25.
[docs/PERFORMANCE.md](docs/PERFORMANCE.md) has the architecture and what
deliberately waits for real traffic.

## For reviewers

Judging against the brief? Each requirement maps to a place you can click:

| Brief requirement | Where to verify |
| --- | --- |
| Sidebar extension as primary surface | Load [`extension/`](extension/) unpacked (`chrome://extensions` → Load unpacked). Open any YouTube page → Mark in/out read the player (`I`/`O` keys) |
| Dispute fair use on every annotation page | Any `/a/:slug` page — the bordered **Dispute fair use** button in the action bar; `/a/:slug/claim` works with no JS and no account |
| Clips link back to the original | "Open original at 0:14 ↗" on media pages; "Open original at ¶ n ↗" deep-links article passages via `#:~:text=` |
| Max 90-second clips, server-side | `POST /api/annotations` with a 91-second range → 422; audio uploads are ffprobe-checked too |
| 240p video / audio segments | The `0:48 · 240p` badge on every player state; transcode output is probe-verified ≤240p/≤90s before it can publish |
| Auth: X or Google only | Both sign-in buttons on the timeline and panel; production fails fast unless both are configured |
| Public feed, follow, comment | `/` timeline (Recent/Following), responses on every permalink |
| Text and recorded audio commentary | The Text · Audio toggle in the panel and `/capture` |
| Landing page per clip | `curl -s <permalink> \| grep og:` — injected and escaped; the share card lives at `/og/:slug.png` |
| Works from a phone | Installable PWA; Android share sheet lands on `/capture?url=…` pre-resolved; iOS uses the Paste link button |

To make a fresh deployment read lived-in: `ANNOTATED_ORIGIN=<origin> npm run
seed:demo` fills the operator slots
([`scripts/seed-demo.json`](scripts/seed-demo.json)), and `npm run
seed:personas` adds four demo annotators with real-source annotations — every
`#:~:text=` deep link lands on the quoted words — plus cross-follows,
responses, and likes. Canonical staging runs `npm run seed:proof` during deploy
to add labelled screenshot, audio-note, video, podcast and claim-path proof.
These records are explicitly marked as demonstration data and do not inflate
real claim totals. All seeders are idempotent and guarded.

Public capability, provider, deployment and distribution claims come from
[`config/capabilities.json`](config/capabilities.json) and the runtime
[`/api/capabilities`](https://annotated-staging.up.railway.app/api/capabilities)
response. The Chrome Web Store status remains **not submitted**.

## Where the line is

[docs/RELEASE.md](docs/RELEASE.md) states the exact v0.1.0 status, the
repeatable checks, and the external gates that still prevent a public release.
The live brief comparison is
[docs/BRIEF_ACCEPTANCE.md](docs/BRIEF_ACCEPTANCE.md) — that document is the
acceptance source, not this README.

## Useful references

- [The 90-second demo script](docs/DEMO.md)
- [Approved brand kit](assets/brand/annotated-brand-kit/README.md)
- [Brand guidelines](assets/brand/annotated-brand-kit/guidelines/annotated-brand-guidelines.pdf)
- [Product contract](docs/PRODUCT.md)
- [Acceptance evidence](docs/ACCEPTANCE_EVIDENCE.md)
- [Extension surface map](docs/EXTENSION_SURFACE_MAP.md)
- [Mobile shell (Expo)](docs/MOBILE.md)
- [Chrome Web Store readiness](docs/CHROMEWEBSTORE.md)
- [Packaged Chrome Gate B](e2e/README.md)
- [Production evidence runner](docs/PRODUCTION_EVIDENCE.md)
- [Release receipts and fixed budgets](docs/RELEASE_RECEIPTS.md)
- [Storage boundary](docs/STORAGE.md)
- [Deployment boundary](docs/DEPLOYMENT.md)
- [Performance architecture](docs/PERFORMANCE.md)
- [Launch readiness](docs/LAUNCH.md)
- [Performance testing record](docs/PERFORMANCE_TESTING.md)
- [UX direction](docs/UX_DIRECTION.md)

For a production-shaped run, start from [`.env.example`](.env.example) and
follow [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Provider credentials never
belong in the extension, and local file storage is not production
persistence.

Found something slower, rougher, or less honest than this README claims?
[Open an issue](https://github.com/tcballard/annotated/issues) — specifics
beat applause.
