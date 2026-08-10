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
- Media processing: asynchronous, with explicit `queued`, `processing`, `ready`, `dead-letter`, and owner-cancelled states.
- API memory: bounded by request limits; no full media buffering in the web process.

The local worker uses `ffmpeg` for direct media URLs and accepts `YTDLP_BIN` for an optional provider adapter. Provider extraction failures are stored as a visible `failed` media state rather than being presented as playable media.

The browser capture path stages recorded audio in IndexedDB before upload. This keeps media out of extension key/value storage and lets a failed upload retry without re-recording; the server still owns the durable asset after acknowledgement.

## Migration order

Steps 1–4 have landed:

1. API paths and validation semantics stayed stable throughout.
2. Query-native PostgreSQL tables replaced EAV reads for feeds, search, source hubs, profiles, notifications, claims, auth sessions, and media jobs. Keyset feed reads and full-text search use partial/GIN indexes; hot mutations take row or per-idempotency-key locks, never the product-wide compatibility lock.
3. Source metadata fetching and media extraction run only in standalone workers (`npm run worker`). Jobs use atomic `FOR UPDATE SKIP LOCKED` leases, bounded retries, dead letters, per-provider concurrency/circuit breaking, and trace-linked structured events.
4. CI applies the real migration, runs multi-worker claim and adapter integration tests, and fails if the rollback journal differs from relational tables. The guarded `npm run load:relational` command seeds an isolated database with 100,000 annotations and 1,000,000 interactions and enforces database regression budgets.

Still deliberately ahead, gated on real traffic:

5. Implement the API in Rust only if deployed traces show Node is the next constraint; run contract tests against both servers. The worker process is the documented seam.

The load budgets are database regression thresholds, not claims about deployed
API p95. Authoritative latency needs repeated samples against the exact staging
image, PostgreSQL, object store, and network path. Run the load suite only on an
isolated disposable database:

```bash
LOAD_DATABASE_URL=postgresql://.../annotated_load \
ALLOW_DESTRUCTIVE_LOAD=true PGSSL=disable \
npm run load:relational -- --output relational-load-report.json
```

Rust remains a possible high-concurrency service implementation. It is not a substitute for measuring the current indexed queries, object delivery, and worker throughput first.
