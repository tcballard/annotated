# Storage boundary

Annotated has two different storage problems: keeping a capture usable in the browser, and storing the product permanently. They must not share a storage layer.

## Current local slice

| Data | Current location | Role |
| --- | --- | --- |
| Extension preferences and bounded capture drafts | `chrome.storage.local` | Small, extension-local recovery state |
| Last published extension result | `chrome.storage.local` | A compact ID/URL/status convenience record |
| In-progress recorded audio | IndexedDB `media-drafts` store | Temporary Blob staging before upload/retry |
| Web capture draft fields | `localStorage` | UI continuity only; never the product source of truth |
| Annotation metadata and comments | `data/store.json` | Local development adapter |
| Uploaded and derived media | `data/media/` | Local development adapter |

The extension never stores audio/video Blobs in `chrome.storage`. The web app never treats its local draft as proof that an annotation was published: published state is reloaded from the API.

## Production target

- PostgreSQL for users, annotations, comments, claims, follows, likes, and media-job records.
- S3/R2-compatible object storage for uploaded audio and derived clips.
- Signed or public CDN URLs for playback; the API acknowledges uploads without proxying large media through the web process.
- `chrome.storage.local` only for small draft metadata, preferences, and pending IDs.
- `chrome.storage.session` for ephemeral runtime state; no long-lived provider secrets in extension storage.
- IndexedDB or OPFS for short-lived offline media staging in the extension/web capture flow.

## Invariants

1. No media Blob, base64 media payload, or published feed is stored in `chrome.storage` or `localStorage`.
2. Local browser state can improve recovery, but the server remains authoritative for published product data.
3. A media upload may be retried from local staging; a successful upload is represented locally by an asset ID, not by a second copy of the media.
4. Replacing the JSON/file adapter with PostgreSQL/object storage must not change the capture API contract.
