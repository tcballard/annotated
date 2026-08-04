# Acceptance evidence

Last run: 2026-08-04

This record supplements [`BRIEF_ACCEPTANCE.md`](./BRIEF_ACCEPTANCE.md). It is
evidence from the current stacked branch, not a claim that the external
production gates are complete.

## Railway staging acceptance

The current distributed-limits stack was deployed to the existing Railway
staging service (`annotated-poc`, environment `staging`) as deployment
`35651b01-9801-4a04-b2b2-46d29a2d4d06` at
`https://annotated-staging.up.railway.app`. The non-mutating acceptance command
below passed on 2026-08-04:

```text
npm run acceptance:staging
{
  "origin": "https://annotated-staging.up.railway.app",
  "version": "0.1.0",
  "persistence": "postgres",
  "providerState": { "google": false, "x": true },
  "oauthPreflight": [{ "provider": "x", "startStatus": 302, "cancellationStatus": 302 }],
  "feedAnnotations": 0
}
```

It verifies `/api/health`, `/api/ready`, `/api/auth/providers`, the root brand
asset, `/privacy.html`, an empty server-backed feed, and the expected `401`
identity and claims boundaries. This is deployed API evidence; it does not
replace live OAuth consent, docked Chrome, microphone, offline replay, or
provider fixture/browser playback evidence.

The distributed-limits layer adds migration `004_rate_limit_buckets` and routes
mutation/OAuth limits through an atomic PostgreSQL bucket ledger in production.
Keys are SHA-256 hashed, the production path fails closed if the ledger cannot
be reached, and local development/tests retain the explicit in-process
fallback. `node --test test/rate-limit.test.js test/hardening.test.js
test/storage.test.js` passed this contract. On deployment
`35651b01-9801-4a04-b2b2-46d29a2d4d06`, the guarded
`accept-staging-rate-limit.mjs` smoke returned `shared: true`, allowed the
first two attempts, denied the third, and removed its temporary bucket. This
is single-instance PostgreSQL evidence; multi-replica and edge WAF coverage
remain external.

The backup/recovery layer adds a non-destructive `npm run backup:production`
command for a trusted runner. It refuses development adapters, invokes
`pg_dump` without a shell, captures the latest migration and per-collection
counts, inventories the private S3-compatible bucket with bounded pagination,
and writes a `0600` custom-format dump, sorted object manifest, bucket
versioning/lifecycle audit, and SHA-256 manifest without mutating production.
`npm run backup:verify` checks the artifact offline with `pg_restore --list`,
and its guarded recovery mode requires an `annotated_recovery*` database name
before restoring and checking the migration ledger. `node --test
test/backup.test.js test/backup-verification.test.js` covers the configuration
guard, pagination, retention contract, command boundary, and secret-free
manifest verification. A provider-side retention policy and isolated restore
drill have not been run, so durable recovery remains an external gate.

On 2026-08-04, a read-only Railway CLI audit against the existing staging
bucket reported `versioning: Disabled`, `lifecycle: not-configured`, and an
empty object inventory (`count: 0`, `bytes: 0`). The strict retention flags
therefore correctly remain off for this POC and would fail closed if enabled.
The current workstation has neither a `pg_dump` binary nor a running Docker
daemon, so no custom-format staging dump was claimed; run the backup command
from a trusted PostgreSQL-client runner before the next migration.

The source-citation acceptance contract now publishes article, video, and
podcast fixtures and verifies that both `sourceUrl` and `canonicalUrl` survive
publish, public detail, and source-type-filtered feed responses. The API test
passed locally; deployed browser evidence that each public surface follows the
source link remains external.

The same API acceptance test now seeds a second local profile and verifies
follow/unfollow persistence, follower counts, the following-feed filter,
comment persistence, and idempotent like/unlike counts. This proves the local
social interaction contract; OAuth-backed multi-user and deployed evidence
remain external.

Article capture now has an editable, persisted selected-passage field in the
web desk, and the extension refuses to publish an article until page text is
selected. The server bounds `sourceExcerpt` at 2,000 characters and requires
it for article annotations; validation and extension contract tests pass.
This closes the local selection contract while real-page selection evidence
remains external.

Failed media jobs now retain an explicit bounded error and expose an
owner-scoped retry endpoint. The public landing page renders the error and a
`Retry clip` action; retrying supersedes the failed job before queueing a fresh
attempt, and duplicate retries are rejected. The API acceptance fixture and
media-policy tests cover this recovery contract; deployed provider recovery
remains external.

The claim-surface deployment also serves the feed/profile card contract from
the same PostgreSQL-backed staging service. The claim action preserves the
selected annotation slug and submits through the persisted claim endpoint;
staging smoke confirms the route is live while authenticated moderation and
multi-user browser evidence remain external.

For each enabled provider it also starts an OAuth request, verifies the PKCE
state/verifier cookies and provider authorize host, then exercises an ephemeral
`access_denied` callback and verifies the same-origin return. This proves the
deployed start/cancellation boundary, not successful user consent or identity
creation.

The same deployed API resolved the public YouTube fixture
`https://www.youtube.com/watch?v=jNQXAC9IVRw` as `video`, `youtube`, and
`ready-for-range`, and resolved `https://example.com/` as an `article` with
`text-ready` metadata. A direct-audio podcast worker smoke is also recorded
below; YouTube extraction and browser playback remain intentionally unclaimed.

The repository also contains a guarded `accept-staging-media.mjs` command for
the Railway container. It is explicitly restricted to the staging host and
production PostgreSQL/S3 settings; when run, it creates and cleans one direct
audio podcast fixture while checking the worker output, private media redirect,
signed object delivery, and object/database cleanup. This does not claim
authenticated OAuth publishing or YouTube extraction.

On 2026-08-04, deployment `3e0dddde-4edd-465d-b596-8977668f1789` passed the
guarded command. It reached `jobStatus: ready` and `mediaStatus: ready`, served
the private redirect and signed object with HTTP 200, and delivered 10,037 bytes
of `audio/webm` before cleaning the fixture.

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

The 2026-08-04 docs-boundary update corrects the README, release record, and
deployment runbook to describe the verified Railway POC staging service without
calling it a public production release. `node --test test/deployment.test.js`
and the full local suite cover the wording and release-boundary contract.

The deployed image's read-only YouTube provider probe reached the pinned
extractor but received HTTP 429/bot verification from YouTube; this is recorded
as an unverified provider gate, not treated as a passing extraction claim.

The provider boundary now makes the operational remedy explicit and testable:
`YTDLP_JS_RUNTIME` defaults to `node`, while `YTDLP_PROXY`,
`YTDLP_COOKIES_FILE`, and `YTDLP_PLAYER_CLIENT` are validated configuration
inputs. Proxy/cookie values are passed to `yt-dlp` as argument-array options;
cookie files must be absolute secret-mounted paths and are excluded from the
Docker build context. Readiness rejects a configured-but-unmounted cookie file.
This is deployment plumbing, not successful provider evidence: staging has no
proxy or cookie configured and the bounded client probes still receive YouTube
429/sign-in challenges.

## Browser acceptance run

The local browser run exercised the user-facing flows below:

- On 2026-08-03 the capture desk received a focused scroll pass in the local
  Vite app. The duplicate web-shell branding and repeated source block were
  removed from the note rail, the publish action now sits in a compact sticky
  rail on desktop, and the source preview height responds to short viewports
  without introducing a nested scroll region. A DOM/layout probe at 1280×720
  measured one document scroll (`scrollHeight` 989, no element-level vertical
  overflow); the 390px mobile probe had no horizontal overflow. Article and
  Podcast mode switches were also exercised after the layout change. This is
  rendered local evidence, not docked-extension or deployed-browser proof.

- A second 2026-08-03 local render focused on the highlighted clip selector.
  The range editor is now a compact grouped control: the timeline remains the
  primary gesture, the duration is a visible status beside its label, and
  start/end fields are equal-width, keyboard-labelled numeric fallbacks. The
  state rendered at 1280×720 and 390×844 with no horizontal overflow; the
  source-type tabs and text/audio controls remained reachable in both layouts.

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
- PR55 adds a bounded process deadline for provider extraction, FFmpeg, and
  FFprobe commands. A timed-out child is terminated and recorded through the
  existing retry/failure path; the timeout is configurable with
  `MEDIA_WORKER_PROCESS_TIMEOUT_MS` and defaults to 300 seconds, below the
  default persisted lease. The targeted timeout test and full local suite pass.
- Media-policy tests cover the FFprobe boundary for duration, required audio,
  audio-only outputs, and the 240px video-height limit; the generated artifact
  is inspected before the worker marks it ready.
- The 2026-08-03 media-policy run now generates a 640×360 local fixture,
  transcodes a 1.5-second clip with the production worker arguments, and
  validates the real FFprobe report: duration under 90 seconds, 240px video
  height, width no greater than 480px, and an audio stream. The test skips only
  when `ffmpeg` or `ffprobe` is unavailable; the current run passed without a
  skip.
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
- The 2026-08-04 claim UI contract test verifies that feed/profile annotation
  cards render a visible `File a claim` action, preserve the card slug, and
  submit through the existing persisted claim endpoint. The public landing
  page keeps its existing claim card. The same branch is deployed to Railway
  staging and passed `npm run acceptance:staging`; live authenticated browser
  interaction remains an external gate.
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
  provider binary in each image. It also runs the generated-media/FFprobe
  fixture contract inside each image after the container-network readiness
  smoke. Both the push and pull-request runs for PR32
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
- PR44 decodes bounded HTML entities before exposing article titles,
  descriptions, excerpts, media URLs, and canonical links, so real publisher
  metadata does not leak `&amp;` or quoted entities into public annotations.
  The fixture suite covers title, description, excerpt, and query-string
  canonical decoding. PR44's hosted push and pull-request workflows both
  passed Node plus linux/amd64 and linux/arm64 production-image smoke jobs on
  2026-08-02
  ([push run 30743790449](https://github.com/tcballard/annotated/actions/runs/30743790449),
  [pull-request run 30743793770](https://github.com/tcballard/annotated/actions/runs/30743793770)).
- PR45 replaces feed-card prototype play buttons with native browser video/audio
  controls whenever a server-backed media URL is ready, renders uploaded audio
  commentary as playable feed media, and keeps queued, failed, and unsafe URLs
  visible as explicit non-playable states. The presentation contract has unit
  coverage. PR45's hosted push and pull-request workflows both passed Node plus
  linux/amd64 and linux/arm64 production-image smoke jobs on 2026-08-02
  ([push run 30744374874](https://github.com/tcballard/annotated/actions/runs/30744374874),
  [pull-request run 30744377907](https://github.com/tcballard/annotated/actions/runs/30744377907)).
- PR46 adds the public `/u/:handle` profile route, bounded server-backed
  annotation lists, follow state, and a public-user projection that excludes
  provider IDs, email addresses, and other private identity fields. The local
  API acceptance test covers profile lookup and the annotation list. Its
  hosted push and pull-request workflows both passed Node plus linux/amd64 and
  linux/arm64 production-image smoke jobs on 2026-08-02 ([push run
  30745156997](https://github.com/tcballard/annotated/actions/runs/30745156997),
  [pull-request run
  30745158643](https://github.com/tcballard/annotated/actions/runs/30745158643)).
- PR47 makes feed sharing card-specific instead of falling back to the
  currently open annotation, adds a bounded URL helper with unit coverage, and
  links public annotation bylines to `/u/:handle` profiles. The local build,
  full suite (72 passing, one explicit production-service skip), syntax checks,
  and diff check pass. Its hosted push and pull-request workflows both passed
  Node plus linux/amd64 and linux/arm64 production-image smoke jobs on
  2026-08-02 ([push run
  30745677620](https://github.com/tcballard/annotated/actions/runs/30745677620),
  [pull-request run
  30745739976](https://github.com/tcballard/annotated/actions/runs/30745739976)).
- PR48 removes fabricated fallback feed posts and the hard-coded following
  metric. Empty, following, and search states now explain what is missing and
  point to a real capture/profile action; anonymous and signed-in feed rails
  use only the identity available from the backend. The local build, full
  suite, syntax checks, and diff check pass. Its hosted push and pull-request
  workflows both passed Node plus linux/amd64 and linux/arm64 production-image
  smoke jobs on 2026-08-02 ([push run
  30746493180](https://github.com/tcballard/annotated/actions/runs/30746493180),
  [pull-request run
  30746502118](https://github.com/tcballard/annotated/actions/runs/30746502118)).
- PR49 makes Google the first explicitly enabled production OAuth provider and
  keeps X as a provider-neutral sibling enabled with `OAUTH_PROVIDERS=google,x`.
  Provider-scoped startup validation, availability reporting, PKCE setup, and
  profile adapters are covered by the full local suite: 75 tests, 74 passing,
  with one explicit PostgreSQL/S3 service-integration skip. The build, all
  JavaScript syntax checks, and diff check also pass. Its hosted push and
  pull-request workflows both passed Node plus linux/amd64 and linux/arm64
  production-image smoke jobs on 2026-08-02 ([push run
  30747195804](https://github.com/tcballard/annotated/actions/runs/30747195804),
  [pull-request run
  30747199116](https://github.com/tcballard/annotated/actions/runs/30747199116)).
- PR50 makes the web identity boundary actionable. Sign-in links preserve the
  current app path/query/hash, successful web callbacks return to that page
  without an extension ticket, and protected publish/like/follow/comment/claim
  actions show a provider-aware recovery banner instead of failing silently.
  The full local suite passed 79 tests with one explicit PostgreSQL/S3
  service-integration skip; build, syntax, and diff checks also pass. A live
  Chrome DevTools session was unavailable in this environment, so browser
  success/error/cancellation rendering remains unverified. PR50's hosted push
  and pull-request workflows both passed Node plus linux/amd64 and linux/arm64
  production-image smoke jobs on 2026-08-02 ([push run
  30748473132](https://github.com/tcballard/annotated/actions/runs/30748473132),
  [pull-request run
  30748478973](https://github.com/tcballard/annotated/actions/runs/30748478973)).
- The v0.1.0 cleanup makes the release boundary explicit without claiming a
  release: package, lockfile, and extension manifest versions agree; `/api/health`
  reads the package version; the CI package check derives its archive path from
  the manifest; and the README, release record, and store record all state that
  the build is a draft, not a deployed or submitted product. The local suite
  passed 79 tests with one explicit PostgreSQL/S3 service-integration skip;
  build, runtime-only extension package, JavaScript syntax, README link audit,
  and diff checks also passed. This is metadata and documentation evidence, not
  authority to tag, deploy, submit, or merge the stack.

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
