# Annotated acceptance-gap audit — 2026-08-04

Audit baseline: `58d368c` on `main`, reconciled with `origin/main` on
2026-08-04. Acceptance contract: <https://annotated.lovable.app/>. This audit
also inspected `README.md`, `BRIEF_ACCEPTANCE.md`, `ACCEPTANCE_EVIDENCE.md`,
`PRODUCT.md`, `STORAGE.md`, `DEPLOYMENT.md`, and the current server, web,
extension, and test implementation.

Status meanings:

- `done`: the scoped boundary has current direct evidence.
- `partial`: a working implementation exists, but some required runtime or
  user-journey evidence is absent.
- `missing`: no implementation or evidence exists for the named boundary.
- `blocked`: the repository cannot currently advance the boundary safely.
- `externally gated`: completion requires credentials, a browser/store surface,
  deployment authority, provider capability, or operational infrastructure.

## Re-verified evidence

| Boundary | Status | Evidence from this audit |
| --- | --- | --- |
| Clean local baseline | done | `npm ci` completed with no audit findings. The final branch run of `npm test` passed 134 tests with one intentionally skipped PostgreSQL/S3 integration test. `npm run build`, extension packaging, JavaScript syntax checks, and `git diff --check` passed. |
| Public staging boundary | done | `npm run acceptance:staging` returned ready PostgreSQL persistence, X enabled and Google disabled, successful X start/cancellation preflight redirects, working YouTube/article/podcast resolution, public app/privacy/feed responses, and expected `401` identity/claims responses. |
| Production-service adapters in this local run | externally gated | The PostgreSQL/S3 integration test was skipped because this checkout was not given live service credentials. Hosted and staging evidence exists, but was not substituted for a fresh local integration run. |
| Docked Chrome and microphone behavior | externally gated | Chrome was deliberately not launched under the safe operating rule. No packaged-browser, microphone, service-worker restart, offline recovery, or visual source-switch claim was made. |

## Live-brief requirement matrix

| Requirement | Status | Current boundary and remaining gap |
| --- | --- | --- |
| Chrome side-panel extension is the primary surface | partial | Manifest V3 side panel, trigger, recovery queue, bounded storage, and packaging checks pass. A docked packaged-browser run and store listing evidence remain externally gated. |
| Clip text, audio, and video from websites | partial | All three source categories are represented in web, extension, API, and resolver code. End-to-end extension capture against real providers is not freshly proven. |
| Text and recorded-audio commentary | partial | Text/audio composition, IndexedDB media staging, upload, publish, and playback paths exist. Packaged microphone and deployed playback evidence remain externally gated. |
| Public annotation landing page | partial | Stable public routes and API reload behavior are tested. Authenticated deployed publishing and a durable browser reload were not performed in this audit. |
| Every annotation links to its source | partial | API and render tests preserve source and canonical URLs across detail/feed surfaces. A deployed browser follow-through remains externally gated. |
| Public social feed | partial | Server-backed feed, profiles, pagination, search, likes, follows, comments, and share/claim actions exist and test cleanly. Fresh multi-user deployed browser evidence is absent. |
| Follow users | partial | Persistent endpoints and counts are tested; multi-user X sessions and abuse behavior need deployed browser evidence. |
| Comment on annotations | partial | Persistence and UI reload paths are tested; multi-user deployed browser evidence remains externally gated. |
| X or Google OAuth only | partial | The POC intentionally enables X only; Google remains an extension point. X configuration and start/cancellation redirects passed without exposing credentials. Real consent, callback success, expiry, and extension handoff require an owner-controlled browser session. |
| Paste a URL or use the active page | partial | Web URL resolution and active-tab extension capture exist. Unified docked-browser proof remains externally gated. |
| YouTube support | partial | Staging resolves the public fixture and the worker/container policies are tested. Authenticated deployed extraction, transcode, playback, and failure recovery remain unproven. |
| News article support | partial | Bounded metadata/excerpt extraction and editable selected passage exist. Broader real-site coverage and packaged selection behavior remain unproven. |
| Podcast support | partial | Direct audio and RSS/Atom enclosure paths exist; staging resolves a direct-audio fixture. Provider extraction and docked playback remain unproven. |
| Choose exact range or passage | partial | Shared 90-second range guards and editable 2,000-character passage controls pass. Source-type switching still lacks fresh visual browser evidence. |
| Generate clip and landing page | partial | Queueing, retry, cancellation, inspection, cleanup, and public-page states exist. Authenticated deployed YouTube generation and browser playback remain externally gated. |
| Maximum 90-second clips | partial | Validation, worker clamping, real local FFmpeg output inspection, and guarded staging audio evidence exist. Deployed video artifact evidence remains externally gated. |
| Video output at 240p and below 480p | partial | FFmpeg arguments and FFprobe inspection pass locally and in recorded hosted-image evidence. A fresh deployed video artifact/playback run is absent. |
| Visible `File a claim` on every annotation | partial | Detail, feed, and profile surfaces route to persisted claims with moderation states and shared rate limits. Authenticated deployed moderation and multi-instance edge behavior remain externally gated. |

No live-brief capability is wholly missing from `main`. The important gaps are
runtime proof and operational durability rather than another broad feature
stack.

## Release and operational gaps

| Gap | Status | Why it remains |
| --- | --- | --- |
| Source-switch repaint/flicker | partial | `main` avoids replacing the whole app, but still reconstructs the browser chrome, large preview, footer, and range editor. This is the highest-value locally actionable gap selected below. |
| Real X consent and callback journey | externally gated | Requires the owner-controlled X account, deployed callback, and a safe browser session. Credentials must remain outside the repository and chat and should be rotated separately. |
| Packaged extension acceptance | externally gated | Requires a controlled Chrome run covering docked layout, active-tab capture, microphone permission, OAuth ticket exchange, offline/restart recovery, and screenshots. |
| Durable media retention and restore | externally gated | Railway Buckets do not provide the required versioning/lifecycle capabilities. A retained archive destination, scheduler, object-byte recovery, and isolated deployed restore drill are still required. |
| Chrome Web Store publication assets | missing | Screenshots, promotional art, publisher contact details, review submission, and store approval are not present as completed release evidence. |
| Production readiness | blocked | Public production claims are blocked until deployment, storage durability, auth/browser, security, backup/restore, monitoring, and operational gates have direct evidence. Staging success does not clear them. |

## Selected single gap

The source-switch repaint/flicker is the highest-value gap that can be improved
inside one small repository PR without credentials, destructive infrastructure
changes, or unsafe browser automation. The implementation on
`codex/source-switch-continuity` keeps all three source previews and both range
modes mounted, then updates only text, attributes, values, and `hidden` state.
This removes the remaining large DOM replacement path while preserving the
existing source-first visual direction, keyboard semantics, and reduced-motion
behavior.

The change is statically regression-tested and build-tested. Its status stays
`partial` until a safe fresh browser run confirms the visual result; this audit
does not claim the flicker is fully solved.
