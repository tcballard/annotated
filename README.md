# annotated

A Chrome-sidebar-first product for keeping a moment, adding the meaning, and preserving the link back to the source.

## Run it

```bash
npm install
npm run dev:server # in a second terminal
npm run dev
```

Then open the local Vite URL. The Vite dev server proxies `/api` to `http://localhost:8787`. `npm run build` produces the production bundle; `npm start` serves the built app and API together.

## Current product slice

- Capture desk with a browser/source preview and sidebar capture flow
- Video, article, and podcast source modes
- 90-second clip selection for media sources
- Text annotation and browser-recorded audio commentary with bounded uploads
- Published annotation page with source citation and visible “File a claim” flow
- Public discovery feed with bounded server-backed search, follow, like,
  comment, and share interactions
- Responsive desktop/mobile layouts with reduced-motion support
- Server-backed local persistence for annotations, comments, and claims in `data/store.json` during development
- Source URL resolver with URL validation, source classification, metadata extraction, and SSRF-safe host checks
- Public annotation slugs and source citations
- Streamed audio asset storage with playable public audio-note URLs
- Asynchronous source-clip jobs with explicit queued, processing, ready, and failed states
- A Manifest V3 Chrome side panel in `extension/` that reads the active tab, captures a text selection, records bounded audio commentary, and publishes annotations through the local API
- Bounded extension drafts in `chrome.storage.local` and browser-local audio staging in IndexedDB; media is never stored in extension key/value storage

OAuth, durable object storage, social graph persistence, moderation operations, and production hosting are being added as separate product slices. Direct-media source clips now run through the FFmpeg worker; YouTube/podcast provider extraction requires an installed `yt-dlp` adapter and remains explicit when unavailable. To try the extension, start `npm run dev:server`, open `chrome://extensions`, enable Developer mode, choose “Load unpacked”, and select the `extension/` folder. See [STORAGE.md](STORAGE.md) for the storage boundary and [PERFORMANCE.md](PERFORMANCE.md) for the Rust/media-worker migration plan.

For a production-shaped run, copy `.env.example`, set `ANNOTATED_STORAGE=postgres` and `ANNOTATED_ASSET_STORAGE=s3`, provide `DATABASE_URL`, the S3 credentials, and Google/X OAuth credentials, run `npm run db:migrate`, and then start the server. Production refuses to start without durable storage and both identity-provider configurations; local file storage and the local account remain explicit development adapters.

The unpacked extension's options page controls its API origin. Local HTTP origins are allowed only for loopback development; deployed origins must use HTTPS. The panel reloads the active source when tabs navigate, expires bearer sessions from `chrome.storage.session`, stores only bounded draft metadata in `chrome.storage.local`, stages audio Blobs in IndexedDB, and retries failed text or audio publishes from a five-item metadata queue through the service worker. Successful audio uploads persist their server asset ID before the annotation retry, and repeated or non-retryable failures become an explicit blocked queue item rather than looping forever. Configure the deployed API origin before loading the extension; do not put provider credentials in the extension.

Source processing uses bounded HTML metadata extraction, safe three-hop redirect handling, DNS-rebinding checks at every fetched hop, and canonical-link preservation. Direct media and configured `yt-dlp` provider streams are transcoded asynchronously; FFprobe inspects duration, audio streams, and video height before a clip is marked ready. Active provider/FFmpeg processes can be cancelled by the owner, and late completions cannot revive a cancelled job. Set `YTDLP_BIN`, `MEDIA_WORKER_MAX_ATTEMPTS`, and `MEDIA_WORKER_RETRY_DELAY_MS` explicitly for a deployed worker. A provider binary or credential is not assumed merely because the adapter exists.

Production also requires an explicit non-wildcard `CORS_ORIGIN` and `PUBLIC_ORIGIN`; `/api/ready` performs a repository health query and an object-store bucket check before declaring the service ready. Claims are reviewed through the owner/moderator **Moderation** queue and `/api/moderation/claims`, using the IDs in `MODERATOR_USER_IDS`, with status transitions and append-only audit records.

See [DEPLOYMENT.md](DEPLOYMENT.md) for the container, migration, readiness, backup, and rollback boundary.
