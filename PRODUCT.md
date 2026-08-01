# Annotated product contract

Annotated is a Chrome-sidebar-first tool for clipping a moment from a page, adding personal context, and publishing a durable page that always points back to the original source.

## Readiness gates

The product is not ready until these are real end-to-end flows, not local UI simulations:

1. A user can sign in with Google or X and keep a stable account.
2. The sidebar can read the active tab, capture a text selection, and choose a bounded media range.
3. Articles resolve to title, author, selected passage, metadata, and canonical source URL.
4. YouTube and podcast sources produce a playable clip no longer than 90 seconds and store the required 240p video/audio asset.
5. A user can add text or recorded audio commentary and publish a public, stable annotation URL.
6. Every public annotation visibly links to its source and exposes “File a claim”.
7. The feed, follows, likes, comments, and claims are persisted server-side and have basic abuse controls.
8. The extension, web app, worker, storage, database, and auth are deployable from documented environment configuration.
9. Critical flows have automated API tests and a browser smoke test.

## Delivery slices

- Slice 1: server-backed local vertical slice — source resolution, persistence, public slugs, comments, claims.
- Slice 2: real capture — active-tab context, text selection, and media source adapters.
- Slice 3: media worker — extraction, 90-second enforcement, 240p transcode, object storage, processing states.
- Slice 4: accounts — Google/X OAuth, sessions, ownership, rate limits, and claim moderation.
- Slice 5: social product — persisted feed, follow, like, comment, profiles, and public sharing.
- Slice 6: production — extension API configuration, deployment, observability, security review, and end-to-end tests.

Each slice stays on the existing draft PR branch until the product is ready for a single reviewable merge.
