# Acceptance evidence

Last run: 2026-08-02

This record supplements [`BRIEF_ACCEPTANCE.md`](./BRIEF_ACCEPTANCE.md). It is
evidence from the current stacked branch, not a claim that the external
production gates are complete.

## Clean-checkout validation

The baseline acceptance checks passed from a fresh clone of the prior stack tip
(`agent/brief-37-identity-evidence`); the PR39 extension checks below were then
rerun from `agent/brief-39-capture-reliability`:

```text
npm ci
npm run build
npm test                         # 61 passing, one explicit service-integration skip without local services
node --check server/*.js src/*.js extension/*.js test/*.js scripts/*.js
git diff --check
```

The local API and Vite app were run together at `http://localhost:8787` and
`http://127.0.0.1:5173`.

The clean-checkout API acceptance test started an isolated local server and
verified `/api/health`, `/api/ready`, restricted-origin rejection, provider
configuration reporting, the development identity boundary, idempotent
annotation publishing, public annotation reload, feed loading, comments,
active-claim deduplication, reporter claim status, and owner moderation
transitions. It passed as part of the 62-test local run. The Docker daemon was not
available in this environment, so the production image was validated through
the hosted smoke workflow recorded below; the Dockerfile build order, non-root
user, and context boundary are also covered by static tests.

## Browser acceptance run

The local browser run exercised the user-facing flows below:

- Capture desk loaded with the local API, Article mode selected, and a
  highlighted passage visible for a `theverge.com` source.
- A text annotation was published. The public page showed a stable `/a/:slug`
  link, the canonical source link, the success state, and `File a claim`.
- The claim dialog accepted a reason and returned `Claim received. We’ll
  review the source.`.
- A comment was posted from the public page and appeared in the conversation
  with the author identity and an updated comment count.
- Discover loaded the server-backed public feed. `For you` rendered feed
  entries with source links, author controls, follow controls, and like/comment
  counts.
- Video mode showed the YouTube source fixture, start/end controls, `1:30 max`,
  and the `video downscaled to 240p` boundary copy.
- Podcast mode showed the podcast source fixture, the same 90-second boundary,
  and its source link.
- Audio commentary mode showed `Start recording`, `Record a 90-second take`,
  and the empty `0:00` state. Microphone permission and an actual recording
  were not requested in this run.
- The source-change control accepted a loopback URL; the API rejected it with
  `That source host is not allowed`. The form stayed open and rendered an ARIA
  `alert` with the resolver error while keeping the existing preview visible.
  The valid source was restored afterward.
- Discover search opened a labeled search form, returned matching server-backed
  annotations for `Rights smoke`, and showed a recoverable empty state for
  `unmatched phrase` with a clear-search action.
- Media-policy tests cover cancellation checks before both a late successful
  publish and a retry update, preventing a cancelled job from being revived by
  a child-process completion.
- Media-policy tests cover the FFprobe boundary for duration, required audio,
  audio-only outputs, and the 240px video-height limit; the generated artifact
  is inspected before the worker marks it ready.
- The pinned yt-dlp 2026.06.09 host-compatible release resolved the public
  YouTube fixture `jNQXAC9IVRw` with the production format selector, downloaded
  the real 240p/audio source, and transcoded a 10-second MP4 using the worker's
  production FFmpeg arguments. FFprobe reported duration `10.000000`, a video
  height of `240`, and an audio stream. This is real provider/media evidence,
  but not yet a deployed PostgreSQL/S3 worker run.
- A local FFmpeg fixture using the worker's `scale=-2:240` policy produced an
  MP4 whose FFprobe report showed duration `1.266667`, a video height of `240`,
  and an audio stream.
- The owner-only Moderation view loaded persisted claims, showed each source
  and reporter, and changed the first claim from `open` to `in review`; the UI
  displayed `Claim marked in review.` and the API recorded the audit transition.
- Extension storage tests prove draft/pending payloads remain metadata-only,
  the pending queue cap remains five captures, deployed API origins require
  HTTPS, expired session tokens are discarded before use, uploaded audio IDs
  survive annotation retries, and repeated failures become bounded blocked
  items with a reset path.
- Chrome extension contract tests verify Manifest V3, the explicit side-panel
  trigger, the minimum Chrome version, local runtime files, no remote-code or
  service-worker timer patterns, complete Chrome Web Store permission coverage,
  hidden-state rendering, the inline SVG icon system, reduced-motion support,
  and accessible mode/status state. `npm run package:extension` produced a
  clean runtime-only ZIP whose archive contains only the extension files.
- An isolated headless Chrome DevTools MCP run loaded the unpacked extension
  (`annotated — keep the moment` v0.1.0), opened the live
  `chrome-extension://…/sidepanel.html` page, and produced an accessibility
  snapshot with `LIVE` backend state, labeled sliders, text/audio buttons, the
  publish action, and no page or service-worker console errors. The extension
  action was also triggered against `https://example.com`; the service worker
  remained error-free. The audio-mode interaction was clicked in the live page,
  showing the staged-recording state and `Start recording` control. This does not
  prove a user-facing docked side panel, microphone permission, offline replay,
  or a deployed API origin.
- Source-processing tests prove redirects are bounded and each redirect target
  is revalidated against the private-host SSRF policy; DNS lookup tests reject
  private answers before a fetch or provider input is used.
- Storage tests exercise repository health queries and the local/S3 object-store
  readiness checks used by `/api/ready`, including rejection of an outdated
  migration ledger.
- Media-runtime tests verify that production readiness probes `ffmpeg`,
  `ffprobe`, and the configured `YTDLP_BIN` provider extractor, and returns an
  explicit unavailable-runtime failure. Development readiness reports the
  deliberate non-provider `development` media-runtime status.
- Storage tests cover reconstruction from collection records and the write path
  that persists entity records while retaining the compatibility state row.
- Source/media tests revalidate provider-returned URLs before FFmpeg use, and
  object-store tests cover deletion of abandoned derived objects.
- Auth tests cover malformed cookie handling and exact OAuth return-origin
  checks; ownership tests reject attaching another account's audio asset.
- Hardening tests cover origin validation, security headers, and bounded request
  telemetry; the server emits request IDs and structured `http_request` logs.
- Annotation validation and idempotency tests cover bounded client request IDs
  and author-scoped retry lookup; web and extension drafts preserve the key.
- Moderation tests cover active-claim deduplication and restricted terminal
  reopening; new claims and status changes append audit records in the store.
- Deployment tests verify Vite builds before production pruning, the container
  runs as an unprivileged user, local state/secrets are excluded from its build
  context, and the Dockerfile pins the official yt-dlp 2026.06.09 amd64/arm64
  assets with SHA-256 verification before probing the executable. The two
  official release assets were independently downloaded and matched the
  committed checksums. Docker daemon execution was unavailable in this
  environment, so the image build remains an external gate.
- `.github/workflows/ci.yml` now makes that external image gate reproducible in
  GitHub Actions: it runs the clean Node/package checks and builds both
  `linux/amd64` and `linux/arm64` images under QEMU, then executes the pinned
  provider binary in each image. Both the push and pull-request runs for PR32
  passed on 2026-08-01 (for example,
  [run 30721572499](https://github.com/tcballard/annotated/actions/runs/30721572499)).
- PR33’s hosted Node job ran all 58 tests with zero skips, including the real
  PostgreSQL migration/repository test and the S3-compatible object lifecycle
  test against an ephemeral MinIO service. The push and pull-request checks
  passed on 2026-08-01 ([push run 30722800219](https://github.com/tcballard/annotated/actions/runs/30722800219),
  [pull-request run 30722802311](https://github.com/tcballard/annotated/actions/runs/30722802311)).
- PR34 fixed the production container bind address: the app now accepts a
  configurable `HOST`, and the image defaults to `0.0.0.0` while local
  development remains loopback-bound. Its hosted push and pull-request runs
  build both `linux/amd64` and `linux/arm64` images, start PostgreSQL 16 and
  MinIO on an isolated network, run migrations inside the built image, start
  the production app with the pinned provider runtime, and verify `/api/ready`
  over that network reports `ready`, `persistence: postgres`, and a ready media
  runtime. Both runs passed on 2026-08-02 ([push run 30735263263](https://github.com/tcballard/annotated/actions/runs/30735263263),
  [pull-request run 30735425820](https://github.com/tcballard/annotated/actions/runs/30735425820)).
- PR35’s hosted Node job ran all 59 tests with zero skips. The real PostgreSQL
  and MinIO integration now round-trips one uniquely keyed record for every
  persisted product collection, checks the backing `annotated_records` rows,
  and exercises the reconstruction path that previously duplicated the default
  owner record. Both runs passed on 2026-08-02 ([push run 30735871840](https://github.com/tcballard/annotated/actions/runs/30735871840),
  [pull-request run 30735872999](https://github.com/tcballard/annotated/actions/runs/30735872999)).
- PR36 adds a persisted media-worker lease (`workerId` plus `leaseUntil`) and
  transactionally claims jobs before provider/FFmpeg work. Active leases block
  duplicate claims across app instances; queued and expired processing jobs are
  recovered on restart, retry timing is preserved, and completed/failed/
  cancelled jobs clear their lease. The hosted push and pull-request checks
  cover this code alongside the two production image architectures ([push run 30736186426](https://github.com/tcballard/annotated/actions/runs/30736186426),
  [pull-request run 30736193308](https://github.com/tcballard/annotated/actions/runs/30736193308)).
- PR37’s hosted Node job ran all 62 tests with zero skips. The callback fixture
  exercises PKCE state validation, Google profile exchange, session creation,
  one-time extension-ticket exchange, and replay rejection in an isolated
  temporary store. This is executable protocol evidence, not live provider
  credential or consent-screen evidence. Both architecture smoke jobs also
  passed ([push run 30736689346](https://github.com/tcballard/annotated/actions/runs/30736689346),
  [pull-request run 30736699060](https://github.com/tcballard/annotated/actions/runs/30736699060)).
- PR38’s UX pass was rendered in an isolated Chrome session at wide desktop,
  mobile, feed, and empty-published states. The capture desk now uses one warm
  surface, a restrained ink/coral token system, a source-first two-column grid,
  and a single primary publish action; the responsive layout collapses to one
  readable path below 840px. The Manifest V3 side panel adopts the same tokens
  and keeps selection, recording, retry, publish, and error states visible.
  A browser probe found no unlabeled controls, and reduced-motion emulation
  reduced the publish transition to `0.01ms` while preserving the static state.
  This is local rendered evidence; it does not replace docked extension,
  microphone, offline, or deployed production acceptance. PR38’s hosted push
  and pull-request checks also passed both Node and linux/amd64 + linux/arm64
  production-image jobs on 2026-08-02 ([push run 30738159687](https://github.com/tcballard/annotated/actions/runs/30738159687),
  [pull-request run 30738170634](https://github.com/tcballard/annotated/actions/runs/30738170634)).
- PR39 hardens the extension delivery boundary. A bounded `clientRequestId` now
  deduplicates local queue entries, a 401 clears the stale session while keeping
  the capture in a visible `needs-auth` state, blocked captures are retained for
  an explicit retry, and a session-backed retry lock prevents overlapping alarm,
  startup, and manual runs. The service worker retries on install, browser
  startup, alarms, and an authenticated side-panel request; the side panel
  listens for queue changes and exposes queued, sign-in, blocked, and retry-now
  states. The auth handoff rejects callbacks whose origin or path is not the
  extension's own Chromium redirect. `npm run build`,
  `npm run package:extension`, `node --check extension/*.js`, `git diff --check`,
  and the full local suite passed with 63 tests and one explicit PostgreSQL/S3
  integration skip. The runtime-only package contains 12 extension files and
  no repository or dependency content. The managed Chrome environment refused
  command-line unpacked-extension loading and the DevTools MCP default profile
  was not attachable, so docked side-panel, microphone, offline replay, and
  service-worker lifecycle proof remain external gates rather than being
  overstated. A separate isolated Chrome render probe with a controlled local
  queue state verified the `needs-auth` card at 360px and 600px widths, with
  labeled controls and no page errors; artifacts were saved at
  `/private/tmp/annotated-pr39-queue-narrow.png` and
  `/private/tmp/annotated-pr39-queue-desktop.png`. PR39's hosted push and
  pull-request checks passed Node plus linux/amd64 and linux/arm64 production
  image jobs on 2026-08-02 ([push run 30740346231](https://github.com/tcballard/annotated/actions/runs/30740346231),
  [pull-request run 30740347784](https://github.com/tcballard/annotated/actions/runs/30740347784)).
- PR40 adds a bounded podcast-feed metadata path. Podcast host URLs and generic
  `/feed`, `/rss`, and `/atom` paths are classified as podcast sources; RSS and
  Atom fixtures extract the first episode title, author, description, safe
  artwork/enclosure URLs, and canonical show link while preserving the existing
  source contract and worker handoff. `node --test test/source-processing.test.js`
  passed 12 tests, including RSS and Atom fixtures, entity decoding, enclosure
  links, source classification, redirect limits, and SSRF checks. The full local
  suite passed 65 tests with one explicit production-service integration skip;
  the Vite build, runtime-only extension package, JavaScript syntax checks, and
  `git diff --check` also passed. PR40's hosted push and pull-request workflows
  both passed Node plus linux/amd64 and linux/arm64 production-image smoke jobs
  on 2026-08-02 ([push run 30740952993](https://github.com/tcballard/annotated/actions/runs/30740952993),
  [pull-request run 30740968625](https://github.com/tcballard/annotated/actions/runs/30740968625)).
- PR41 adds `public/privacy.html`, a plain-language policy covering the extension
  data boundary, browser-local draft/audio staging, identity providers,
  configured backend/object storage, public publishing, retention, deletion
  requests, and contact routing. Vite copies it into `dist/privacy.html`, the
  deployment test checks its disclosures and the Web Store record links the
  intended `/privacy.html` path. Public deployment and URL verification remain
  external; no stable URL or publisher email is claimed by this PR. PR41's
  hosted push and pull-request workflows both passed Node plus linux/amd64 and
  linux/arm64 production-image smoke jobs on 2026-08-02
  ([push run 30741507755](https://github.com/tcballard/annotated/actions/runs/30741507755),
  [pull-request run 30741523491](https://github.com/tcballard/annotated/actions/runs/30741523491)).
- PR42 closes the RSS/Atom enclosure handoff: extensionless or signed podcast
  media URLs marked by the resolver now pass through the worker's existing
  public-URL/DNS safety checks and go directly to FFmpeg, while non-enclosure
  podcast sources retain the `yt-dlp` fallback. Source-processing tests cover a
  signed-style `?episode=1` enclosure and the existing SSRF boundaries. PR42's
  hosted push and pull-request workflows both passed Node plus linux/amd64 and
  linux/arm64 production-image smoke jobs on 2026-08-02
  ([push run 30742462533](https://github.com/tcballard/annotated/actions/runs/30742462533),
  [pull-request run 30742479386](https://github.com/tcballard/annotated/actions/runs/30742479386)).
- PR43 adds a deterministic extension icon source and real PNG variants at 16,
  48, and 128 pixels, wires them into both the manifest and toolbar action, and
  checks their PNG signatures/dimensions. `npm run generate:extension-icons`
  regenerates the files with Node built-ins only; the runtime-only package now
  includes the icon files (16 archive entries including the `icons/` directory).
  Screenshots and promo artwork remain external store gates. PR43's hosted push
  and pull-request workflows both passed Node plus linux/amd64 and linux/arm64
  production-image smoke jobs on 2026-08-02
  ([push run 30743106711](https://github.com/tcballard/annotated/actions/runs/30743106711),
  [pull-request run 30743109841](https://github.com/tcballard/annotated/actions/runs/30743109841)).

## Deliberately unverified external gates

These remain `partial` or unchecked in the matrix until real configuration and
evidence are available:

- Google/X OAuth callback, cancellation, logout, and expiry against real
  provider credentials.
- PostgreSQL and S3/R2/CDN deployment with migrations, cleanup, backups, and
  recovery against production-like services.
- Real YouTube/news/podcast extraction and FFmpeg output inspection, including
  a generated file proven to be no longer than 90 seconds and video proven to
  be 240p.
- Docked installed-Chrome side-panel acceptance, extension microphone capture,
  offline queue recovery, and service-worker/sidebar lifecycle checks. PR39's
  queue and auth recovery are covered by executable tests, but the managed
  Chrome environment still refused an unpacked install for live docked proof.
- Chrome Web Store screenshots/promo art, a public privacy-policy URL, and a
  monitored publisher contact address.
- Multi-user production feed, follow, comment, claims, and moderation evidence.
- Public deployment, production observability, durable-service backups and
  recovery, and live external traffic remain unverified. PR34 now covers the
  image-to-service networking and readiness boundary in hosted CI; PR36's
  persisted lease is not a managed queue or a live deployment.
