# Annotated acceptance closeout — 2026-08-04

Acceptance contract: <https://annotated.lovable.app/>. Repository baseline:
merged `main` commit `d276f4c`. Staging project: `annotated-poc`, environment
`staging`, service `annotated`.

This closeout separates three boundaries that must not be conflated:

- `done`: direct code, CI, or deployed server-side evidence now exists.
- `browser open`: the implementation exists, but the remaining proof requires
  an installed Chrome extension or an authenticated browser journey.
- `external infrastructure`: completion requires a provider, credential,
  scheduler, retained archive, or deployment capability that is not available
  in the current Railway POC. It is not a browser-validation task.

## Closed without Chrome

| Boundary | Status | Current evidence |
| --- | --- | --- |
| Merged source-continuity fix | done | PR #89 passed CI without review threads and was squash-merged as `d276f4c`. The large source-switch DOM replacement path is gone; visual confirmation remains in the browser checklist. |
| Clean local verification | done | `npm ci` reported no audit findings. The merged branch passed 134 tests with one credential-gated PostgreSQL/S3 integration skip, the production build, extension packaging, JavaScript syntax checks, and `git diff --check`. Hosted CI covers the production adapters against PostgreSQL and MinIO. |
| Deployed staging baseline | done | Railway deployment `8a15f3d9-6bc2-463d-9532-0aa9a11beb7c` deployed merged `main`; `/api/health`, `/api/ready`, providers, feed, app root, and privacy returned the expected statuses with PostgreSQL persistence and a ready FFmpeg/FFprobe/provider runtime. |
| X-only POC configuration | done | Staging reported X enabled and Google disabled. X authorization start and explicit cancellation both completed the expected PKCE redirect boundary without exposing credentials. |
| Source resolution | done | The deployed API resolved the YouTube fixture as `video`/`youtube`/`ready-for-range`, the article fixture as `article`/`text-ready`, and the direct podcast fixture as `podcast`/`ready-for-range`. |
| PostgreSQL persistence and shared limiting | done | The guarded staging limiter returned `shared: true`, `allowed: [true, true, false]`, and a positive `Retry-After`, then deleted its temporary bucket. |
| Private audio/video media pipeline | done | Guarded Railway smoke `85273eab-46f5-4ba3-8cd1-8765f16531c7` drove audio and direct video through the production worker, PostgreSQL, private object storage, signed delivery, and cleanup. Both jobs and annotations reached `ready`, and both signed objects returned HTTP 200. |
| 90-second output policy | done | API validation and worker arguments cap output at 90 seconds; local real-FFmpeg tests reject over-limit output. The enhanced deployed smoke downloaded the delivered objects and re-ran FFprobe/`validateMediaProbe` against them. |
| 240p video output policy | done | The delivered staging MP4 measured 1.003 seconds, 428×240, and contained audio. The delivered podcast object measured 1.008 seconds, contained audio, and contained no video stream. |
| Server-side product contract | done | Automated API coverage closes publishing, public detail, source citations, feed filters/search/pagination, profiles, follows, comments, likes, claims, moderation transitions, media retries, ownership, auth recovery, rate limits, SSRF guards, request bounds, and hardening behavior. |
| Bounded extension storage contract | done | Static/runtime tests enforce metadata-only `chrome.storage.local`, ephemeral `chrome.storage.session`, IndexedDB media staging, bounded retries, idempotent publish IDs, expired-session removal, and HTTPS-only deployed API origins. |
| Build and release artifact boundaries | done | The production Vite build and extension ZIP complete from a clean install; hosted CI builds amd64/arm64 non-root images and exercises the production PostgreSQL/S3, migration, backup artifact, and isolated database-restore paths. |

## Live-brief requirements still open only in a browser

| Requirement | Status | Exact browser evidence required |
| --- | --- | --- |
| Chrome side panel is the primary surface | browser open | Load the packaged extension, open the docked panel, and confirm its trigger, layout, API settings, focus order, and active-tab updates. |
| Capture text, audio, and video from websites | browser open | Capture a selected article passage and media ranges from real tabs, then publish from the installed extension. |
| Text and recorded-audio commentary | browser open | Grant microphone permission, record/replace/replay a note, publish it, and confirm permission-denial recovery. |
| Public annotation page and source link | browser open | Publish through X, reload the public route, follow the original-source link, and verify clip/note rendering. |
| Public feed, profiles, follows, likes, and comments | browser open | Exercise at least two authenticated identities and verify persisted interaction state after reload. |
| X sign-in and extension handoff | browser open | Complete real consent, callback success, cancellation, expiry recovery, logout, and one-time extension-ticket exchange. |
| Paste URL or use active page | browser open | Compare pasted-source capture with active-tab capture in the installed side panel. |
| News selection and podcast playback | browser open | Confirm selected-passage fidelity and play the delivered podcast clip from public/feed surfaces. |
| Choose range and switch source type | browser open | Drag both handles, switch video/article/podcast repeatedly, and visually confirm focus, values, scroll position, and absence of repaint/flicker. |
| Generate clip and landing page | browser open | Publish an authenticated clip, observe queued/processing/ready states, reload the landing page, and play the result. |
| Visible `File a claim` | browser open | Verify the action on detail, feed, and profile cards; submit while authenticated and inspect the moderation result. |
| Chrome Web Store presentation | browser open | Capture screenshots and promotional art from the packaged extension, then supply publisher contact and complete store review. |

The source-switch repaint issue remains open here because static DOM continuity
and passing CI cannot prove a visual outcome. It must not be described as fully
solved until the repeated switch sequence above is observed in Chrome.

## External infrastructure gates — not Chrome work

These cannot be closed by more local tests or by relabelling them as browser
validation:

| Gate | Current evidence and required decision |
| --- | --- |
| Real deployed YouTube extraction | Resolution is deployed, but the Railway egress path has received YouTube HTTP 429/bot verification. Completion requires an owner-approved managed proxy and/or secret-mounted provider cookies, followed by a guarded extraction smoke. No such credential is present in staging. |
| Durable object retention | The guarded configuration command failed closed because Railway Buckets do not expose `PutBucketVersioning`; the provider interpreted it as bucket creation. A storage/archive provider with versioning and incomplete-upload lifecycle controls is required. |
| Scheduled retained backups | The backup, verification, archive, and isolated database-restore commands are CI-tested, but staging has no `BACKUP_ARCHIVE_*`/`ANNOTATED_PRODUCTION_BACKUP_*` configuration, archive-required flag, or scheduler. An owner-approved retained destination and secret scope are required. |
| Production operations | Multi-replica limiting, edge volumetric controls, alerting, scheduled backups, object-byte recovery, rollback rehearsal, and a deployed-service restore drill require production infrastructure and operational authority. Staging and CI evidence do not make the product production-ready. |

No OAuth credential value was read into this audit or written to the repository.
Previously shared OAuth credentials should still be rotated separately.
