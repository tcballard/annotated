# Acceptance evidence

Last run: 2026-08-01

This record supplements [`BRIEF_ACCEPTANCE.md`](./BRIEF_ACCEPTANCE.md). It is
evidence from the current stacked branch, not a claim that the external
production gates are complete.

## Clean-checkout validation

The following checks passed on `agent/brief-16-source-redirects`:

```text
npm ci
npm run build
npm test                         # 46 passing tests
node --check server/*.js src/*.js extension/*.js test/*.js scripts/*.js
git diff --check
```

The local API and Vite app were run together at `http://localhost:8787` and
`http://127.0.0.1:5173`.

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
- Source-processing tests prove redirects are bounded and each redirect target
  is revalidated against the private-host SSRF policy; DNS lookup tests reject
  private answers before a fetch or provider input is used.
- Storage tests exercise repository health queries and the local/S3 object-store
  readiness checks used by `/api/ready`, including rejection of an outdated
  migration ledger.
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
- Installed Chrome side-panel acceptance, extension audio capture, offline
  queue recovery, and service-worker/sidebar lifecycle checks.
- Multi-user production feed, follow, comment, claims, and moderation evidence.
- Production observability, deployment, security, and readiness checks.
