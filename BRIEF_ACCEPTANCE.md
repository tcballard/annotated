# Annotated brief acceptance

Last verified: 2026-08-01 against <https://annotated.lovable.app/>.

Status meanings: `done` has current code and direct validation evidence; `partial` has a working slice but misses part of the brief or production boundary; `missing` has no working implementation; `blocked` requires owner credentials or external access for final proof.

| Requirement | Status | Current evidence | Completion evidence still required |
| --- | --- | --- | --- |
| Chrome side-panel extension is the primary capture surface | partial | Manifest V3 side panel reads the active tab and selected text, reloads on tab activation/navigation, uses an HTTPS-required deployed API origin, expires session tokens, exchanges OAuth tickets for bearer sessions, records bounded audio in IndexedDB, uploads server-side media, and queues retryable publishes in bounded local metadata; uploaded audio IDs survive annotation retries and repeated/non-retryable failures become bounded blocked items. | Packaged-browser acceptance and a real deployed-origin run. |
| Clip media, text, audio, or video from a website | partial | Web capture handles all three source categories; extension captures selected text and media ranges. | End-to-end provider clips from the extension for YouTube and podcasts. |
| Text and recorded-audio commentary | partial | Web capture and the extension record, stage, upload, publish, and replay audio; extension audio drafts stay in IndexedDB and queued metadata contains no Blob. | Packaged extension audio browser evidence and production media delivery. |
| Public annotation landing page | partial | Stable `/a/:slug` route reloads published state from the API. | Durable production persistence and clean-checkout browser evidence. |
| Every annotation links to its original source | partial | API preserves `sourceUrl`; public pages render the source citation. | Contract tests across every supported source and deployed browser evidence. |
| Public social feed | partial | Published annotations, author profiles, like counts, comments, filters, bounded server-backed search, and cursor pagination load from the server store. | Durable production database, authorization, and deployed evidence. |
| Follow other users | partial | Follow/unfollow endpoints persist a social graph and profile responses expose follower/following counts. | Multi-user OAuth browser evidence, abuse controls, and production database run. |
| Comment on annotations | partial | Comments persist with author metadata and the UI reloads them from the API. | Identity, authorization, abuse controls, and durable production tests. |
| Sign up with X or Google OAuth only | partial | Configurable Google/X OAuth starts and callbacks use PKCE; sessions, logout, expiry, owner IDs, and one-time extension tickets are server-backed. Local mode retains the development user. | Real provider credentials and callback success/cancellation/expiry browser evidence. |
| Paste a URL or use the active page | partial | Web app resolves pasted URLs; extension reads the active tab. | Unified production API configuration and browser coverage. |
| Support YouTube videos | partial | Metadata uses YouTube oEmbed; worker validates source URLs and invokes the configured `yt-dlp` adapter with a 240p-safe format. | Installed/configured provider adapter, failure/retry coverage, playable output evidence. |
| Support news articles with selected passage and metadata | partial | Resolver bounds response size, follows at most three redirects with URL and DNS-answer SSRF checks at every hop, extracts metadata/excerpts, preserves canonical URLs, and extension reads the user's selection. | Robust extraction across real article fixtures and selected-passage browser evidence. |
| Support podcasts | partial | Resolver recognizes podcast sources/direct audio; worker validates inputs and invokes the configured `yt-dlp` audio adapter. | Provider extraction, retry/recovery, and browser playback evidence. |
| Choose media start/end or exact text passage | partial | Web/extension range controls enforce bounds; active-tab text selection is captured. | Extension provider playback alignment and browser evidence. |
| Generate clip and public landing page | partial | Publishing creates the page immediately and queues FFmpeg processing; jobs now have bounded retries, recovery, owner cancellation, provider URL revalidation, object cleanup on abandoned output, and FFprobe inspection before readiness. | Durable queue/object storage, real provider fixtures, cleanup exercise, and browser evidence. |
| Maximum 90-second video/audio clips | partial | API validation rejects longer ranges and worker clamps duration. | Automated boundary tests and output-duration inspection. |
| Video output is 240p and below 480p | partial | Worker passes `scale=-2:240` to FFmpeg and rejects inspected output above 240px high. | Automated FFprobe inspection of a generated video fixture. |
| Clearly visible `File a claim` on every annotation | partial | Public-page claim card submits a persisted claim; owner/moderator web queue exposes source context, reporter, status transitions, and audit-backed updates. | Authenticated production moderation, abuse controls, and durable storage. |

## Production readiness gates

- [ ] PostgreSQL is the production metadata repository; migrations and integration tests cover annotations, users, comments, claims, follows, likes, and media jobs.
- [ ] Published media uses configured S3/R2-compatible object storage and a delivery URL; local files remain development-only.
- [ ] Google and X OAuth, secure sessions, ownership, logout, expiry, and extension authentication are real and tested.
- [ ] Extension API origin, offline queueing, retry states, and service-worker/side-panel recovery are production-configurable and browser-tested.
- [ ] Provider extraction and FFmpeg processing enforce duration/resolution, retries, cancellation/recovery, cleanup, and visible failures.
- [ ] Feed, profiles, follows, likes, comments, sharing, pagination, and authorization persist server-side.
- [ ] Claims have review states, audit records, rate limits, and user-visible reporting outcomes.
- [ ] CORS, secure headers, request limits, URL and DNS-answer SSRF defenses, observability, health/readiness, migrations, backups, and recovery are documented and tested.
- [ ] A clean-checkout automated suite and Chrome browser acceptance run pass with evidence linked from the final draft PR.

## Explicit non-goals from the brief

- Email/password authentication is not required.
- Only Google and X are required identity providers.
- Required source categories are YouTube, news articles, and podcasts; other providers are optional unless the brief changes.
