# Storage boundary

Annotated has two different storage problems: keeping a capture usable in the browser, and storing the product permanently. They must not share a storage layer.

## Current local slice

| Data | Current location | Role |
| --- | --- | --- |
| Extension preferences and bounded capture drafts | `chrome.storage.local` | Small, extension-local recovery state |
| Last published extension result | `chrome.storage.local` | A compact ID/URL/status convenience record |
| In-progress recorded audio | IndexedDB (`media-drafts` in the web app; `annotated-extension-media/audio-drafts` in the extension) | Temporary Blob staging before upload/retry |
| Web capture draft fields | `localStorage` | UI continuity only; never the product source of truth |
| Annotation metadata and comments | `data/store.json` | Local development adapter |
| Uploaded and derived media | `data/media/` | Local development adapter; production uses the configured S3-compatible store |

The extension never stores audio/video Blobs in `chrome.storage`. The web app never treats its local draft as proof that an annotation was published: published state is reloaded from the API.

## Production target

- PostgreSQL for users, annotations, comments, claims, follows, likes, sessions, media, and media-job records. The repository now persists each API collection as a durable entity record in `annotated_records`, reconstructs the stable store contract, and keeps the legacy state document as a compatibility fallback during migration. Updates use an advisory transaction lock; versioned SQL migrations are tracked in `annotated_schema_migrations`.
- S3/R2-compatible object storage for uploaded audio and derived clips. The web process streams uploads to S3, serves signed/public delivery URLs, and deletes derived objects when a cancelled or failed job has already uploaded them; it does not persist production media under `data/media/`.
- Signed or public CDN URLs for playback; the API acknowledges uploads without proxying large media through the web process.
- `chrome.storage.local` only for small draft metadata, preferences, and pending IDs.
- `chrome.storage.session` for ephemeral runtime state; no long-lived provider secrets in extension storage.
- The extension's bearer session token is ephemeral `chrome.storage.session` state; pending capture payloads are bounded metadata in `chrome.storage.local` and are retried by the service worker. A successful media upload is recorded as an asset ID before the annotation retry; eight failed or non-retryable attempts become a metadata-only blocked item for explicit recovery instead of an infinite loop.
- IndexedDB or OPFS for short-lived offline media staging in the extension/web capture flow.

## Invariants

1. No media Blob, base64 media payload, or published feed is stored in `chrome.storage` or `localStorage`.
2. Local browser state can improve recovery, but the server remains authoritative for published product data.
3. A media upload may be retried from local staging; a successful upload is represented locally by an asset ID, not by a second copy of the media.
4. Replacing the JSON/file adapter with PostgreSQL/object storage must not change the capture API contract.
5. `NODE_ENV=production` selects PostgreSQL and S3 by default and fails fast when the required configuration is missing.

## Migration and local verification

```bash
cp .env.example .env
# Set DATABASE_URL and S3 values for a production-shaped environment.
npm run db:migrate
ANNOTATED_STORAGE=postgres ANNOTATED_ASSET_STORAGE=s3 NODE_ENV=production npm start
```

The migration runner applies every ordered SQL file once and records the version in `annotated_schema_migrations`; it is safe to rerun during deploys.

The local adapter remains the default for `npm run dev:server`, tests, and offline UI work. Do not claim production readiness from a file-backed run.

Production operations should call `/api/ready` after migrations and object-store credentials are loaded. A 200 response proves the latest migration is recorded, the configured repository can query, and the object store can answer a bucket health check; it does not replace a live provider, backup, or browser acceptance run.
