# Performance architecture

Annotated should be fast at the point of capture and resilient when media work is expensive. The performance-critical boundary is the API and media pipeline, not the HTML sidebar.

## Recommended stack

- Browser UI and Chrome APIs: small vanilla JavaScript bundle. Browser extension APIs, DOM selection, and side-panel lifecycle remain JavaScript-native.
- API: Rust with Axum and Tokio once the service needs sustained concurrency. The current Node API is deliberately kept behind the same JSON contract so the migration is a replaceable server boundary.
- Media: FFmpeg in isolated workers. The worker runs today as a standalone Node process (`npm run worker`) behind a job-lease contract; a Rust implementation of that same seam should schedule jobs, enforce the 90-second/240p policy, and stream progress — it should not reimplement codecs.
- Persistence: PostgreSQL for metadata and object storage for source derivatives and audio notes. The current JSON file store is a local development adapter only.
- Delivery: signed object URLs and a CDN. The API should acknowledge a capture quickly and never proxy large media through the web process.

## Budgets

- Side panel first paint: under 100 ms after the extension is already loaded.
- Metadata API p95: under 150 ms when the source is cached.
- Publish acknowledgement: under 300 ms after metadata and commentary validation.
- Media processing: asynchronous, with an explicit `queued`, `processing`, `ready`, or `failed` state.
- API memory: bounded by request limits; no full media buffering in the web process.

The local worker uses `ffmpeg` for direct media URLs and accepts `YTDLP_BIN` for an optional provider adapter. Provider extraction failures are stored as a visible `failed` media state rather than being presented as playable media.

The browser capture path stages recorded audio in IndexedDB before upload. This keeps media out of extension key/value storage and lets a failed upload retry without re-recording; the server still owns the durable asset after acknowledgement.

## Migration order

Steps 1–3 have landed:

1. API paths and validation semantics stayed stable throughout.
2. PostgreSQL replaced the JSON adapter behind the same store contract. Hot-path writes are row-native — a like lands in about a millisecond at fifty thousand rows, with a 25 ms budget enforced in CI ([`test/hot-path.integration.test.js`](../test/hot-path.integration.test.js)) — feeds page by keyset cursor, share cards and the notification badge revalidate with ETags, and deploys run migrations before they serve.
3. Source metadata fetching and media extraction run as bounded worker jobs, recoverable by lease, in a standalone process (`npm run worker`) whose read cache is invalidated cross-instance over LISTEN/NOTIFY.

Still deliberately ahead, gated on real traffic:

4. Implement the API in Rust behind the existing paths and run contract tests against both servers. The worker process is the documented seam.
5. Add CDN-backed playback, tracing, and load tests before switching production traffic; server-side rate limits already ship.

Rust remains a good fit for the high-concurrency service and worker orchestration. It was never the first lever: the old bottleneck — every write re-serializing one JSON document — is gone now that writes are row-native PostgreSQL, so the next measurable wins are CDN delivery and worker throughput, which is exactly where the Rust seam sits.
