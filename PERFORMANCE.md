# Performance architecture

Annotated should be fast at the point of capture and resilient when media work is expensive. The performance-critical boundary is the API and media pipeline, not the HTML sidebar.

## Recommended stack

- Browser UI and Chrome APIs: small vanilla JavaScript bundle. Browser extension APIs, DOM selection, and side-panel lifecycle remain JavaScript-native.
- API: Rust with Axum and Tokio once the service needs sustained concurrency. The current Node API is deliberately kept behind the same JSON contract so the migration is a replaceable server boundary.
- Media: FFmpeg in isolated workers. Rust should schedule jobs, enforce the 90-second/240p policy, and stream progress; it should not reimplement codecs.
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

1. Keep the current API paths and validation semantics stable.
2. Replace the local JSON adapter with PostgreSQL and add indexes for public slugs and feed ordering.
3. Move source metadata fetching and media extraction into bounded worker jobs.
4. Implement the API in Rust behind the existing paths and run contract tests against both servers.
5. Add CDN-backed playback, tracing, rate limits, and load tests before switching production traffic.

Rust is a good fit for the high-concurrency service and worker orchestration. It is not expected to make a measurable difference to a low-volume metadata prototype, and it would not improve the main bottleneck if the product still stores media synchronously or serializes every write through one JSON file.
