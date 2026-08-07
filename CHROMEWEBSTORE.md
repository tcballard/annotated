# Chrome Web Store Listing — annotated — keep the moment

> Last Updated: 2026-08-04
>
> Status: v0.1.0 pre-submission draft. It has not been submitted, reviewed, or
> published. This document is the source of truth for a future Chrome Web Store
> submission; the unchecked external gates are not represented as shipped
> features.

## Store Listing

**Extension Name**

annotated — keep the moment

**Short Description**

Capture a moment from the page you are on, add context, and keep the source attached.

**Detailed Description**

Keep the moment before it disappears. Annotated lives in Chrome's side panel, beside the page you are reading: capture the exact moment — a passage, a bounded video or podcast clip, or a snip of the page — add your context, and publish a page that keeps the original source attached.

WHAT MAKES IT DIFFERENT
• Real clip artifacts: the excerpt is transcoded and hosted (at most 90 seconds), and it plays right in the feed — not an embed, not a link that rots.
• Four capture modes in one panel: passage, video clip, podcast clip, screenshot — with the player's own timestamps.
• A public margin, not a private vault: follow, respond, like — a reading feed, not a read-later pile.
• Round-trip receipts: every published page's prominent action is Open original, deep-linked to the exact second or sentence, and opens of the original are the number that matters.
• Rights as a surface: a clearly visible Dispute fair use button on every annotation page, with public takedown records.

FEATURES
• Capture selected text from the active page — or right-click any selection to annotate it.
• Paste another source and resolve its canonical metadata through Annotated.
• Choose a bounded video or podcast moment, with a 90-second maximum.
• Add a short written note or a recorded audio note, and review the take before publishing.
• Save a draft when the service is unavailable and retry it later.
• Keep queued captures safe when a sign-in session expires, then retry after sign-in.
• Open the published annotation page and share its source-backed link.
• Follow the operating system's light or dark appearance automatically.

HOW TO USE
1. Load the extension; the release build connects to Annotated staging by default.
2. Open a page and click the Annotated toolbar icon to open the sidebar.
3. Select text or adjust the moment controls, then add your context.
4. Choose Publish annotation when you are ready to share it.

PRIVACY
The extension reads the URL, title, and selected text from the active page so it can show and publish the source you choose. It does not publish anything until you choose Publish annotation. Draft metadata stays in the browser; a recorded audio note is held locally until upload or deletion. Published annotations and media are sent to the configured Annotated backend. There is no advertising or analytics collection.

PERMISSIONS
• Active-page access — needed to show the current source, read a selected passage, and let you choose a media range from any site you visit.
• Storage — needed to preserve bounded drafts, retry metadata, and the temporary sign-in session.
• Identity — needed to complete the configured X sign-in handoff (the Google
  adapter remains available for a future release).
• Alarms — needed to retry queued captures when the browser service resumes.

SUPPORT
Report a problem or request a feature at https://github.com/tcballard/annotated/issues.

Version 0.1.0 — initial capture and source-backed publishing workflow.

**Category**

Productivity

**Single Purpose**

Capture a moment from the current webpage and publish it with personal context and a source link.

**Primary Language**

English

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|-----------:|--------|----------|
| Store Icon | 128×128 PNG | ✅ In extension package | `extension/icons/icon-128.png` |
| Screenshot 1 | 1280×800 or 640×400 | 🟡 Needs capture | `store-assets/screenshot-1.png` |
| Screenshot 2 | 1280×800 or 640×400 | ⬜ Not created | `store-assets/screenshot-2.png` |
| Screenshot 3 | 1280×800 or 640×400 | ⬜ Not created | `store-assets/screenshot-3.png` |
| Small Promo Tile | 440×280 | ✅ Ready | `store-assets/promo-440x280.png` |
| Marquee Promo Tile | 1400×560 | ✅ Ready | `store-assets/marquee-1400x560.png` |

### Screenshot Notes

Screenshot 1 should show the sidebar open beside a real article with a selected
passage and the text annotation editor visible. Screenshot 2 should show a
video or podcast range with the 90-second boundary. Screenshot 3 should show a
successful published annotation link. Screenshots must be captured from the
current extension version and must not imply that unverified provider or
production integrations are available.

## Permissions Justification

| Permission | Type | Justification |
|------------|------|---------------|
| `sidePanel` | permissions | Opens Annotated's persistent capture workspace beside the page. |
| `tabs` | permissions | Reads the active tab's URL and title, detects tab changes, and supplies the tab context required for selected-text capture. |
| `scripting` | permissions | Injects only on explicit user actions while the sidebar is open: reads the current text selection, draws the drag-to-snip overlay when the user chooses a region screenshot, and highlights a chosen annotation's quoted passage on its page. |
| `storage` | permissions | Stores bounded drafts, API configuration, retry metadata, compact published-result metadata, and the temporary browser session. It never stores media Blobs in key/value storage. |
| `identity` | permissions | Opens the configured X sign-in handoff and receives the one-time extension callback; the Google adapter remains available for a future release. |
| `alarms` | permissions | Wakes the extension periodically to retry queued captures without relying on a persistent background page. |
| `contextMenus` | permissions | Adds a single right-click item on selected text — "Annotate …" — that opens the side panel with that selection captured. Created once at install; no other menu surfaces are touched. |
| `favicon` | permissions | Reads Chrome's local favicon cache (the `_favicon/` extension endpoint) so each source in the panel's timeline shows its site icon. No network requests are made and no browsing data leaves the browser — the icons come from Chrome's own cache. |
| `<all_urls>` | host_permissions | The product is intentionally source-agnostic: it must read the active page and selected passage on any site the user chooses, and the user-drawn snip screenshot uses `tabs.captureVisibleTab`, which Chrome only grants to the literal `<all_urls>` pattern (narrower http/https host patterns are rejected for capture). It does not inject code until the user opens the sidebar, captures nothing without an explicit user action, and does not publish without one either. Production API origins are separately restricted to HTTPS in settings. |

## Privacy & Data Use

**Does the extension collect user data?** Yes.

| Data Type | Collected? | Transmitted Off-Device? | Purpose | Shared with Third Parties? |
|-----------|-----------|-------------------------|---------|---------------------------|
| Personally identifiable info | Yes, when the user signs in | Yes, to the configured Annotated backend | Account ownership and author identity | Only with the configured identity/storage providers; never sold |
| Authentication info | Yes, as a short-lived session token | Yes, to authenticate backend requests | Sign-in and owned publishing | Not sold or used for advertising |
| Personal communications | Yes, written notes and recorded audio the user chooses to publish | Yes, when publishing | User-authored annotation context | Stored by the configured Annotated backend |
| Web history | Current tab URL and title only | Yes, when resolving or publishing that source | Keep the source attached to the annotation | Not sold; no browsing-history analytics |
| User activity | Publish/retry actions needed to complete captures | Yes, as part of API requests | Deliver the requested capture | No advertising or analytics sharing |
| Website content | Selected passage from the active tab only | Yes, when the user publishes it | Include the user's chosen excerpt | Not sold; sent only to the configured backend |
| Health info | No | No | Not applicable | No |
| Financial info | No | No | Not applicable | No |
| Location | No | No | Not applicable | No |

### Data Use Certification

- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

## Privacy Policy

**Privacy Policy URL**

Implemented in the web build at `/privacy.html`; the intended deployed URL is
`https://annotated.com/privacy.html`. Publish and verify that URL before
submitting to the Chrome Web Store. The policy explains local draft retention,
published annotation/media retention, identity providers, backend storage,
deletion requests, and contact details. Public deployment and URL verification
remain external gates.

## Distribution

**Visibility**: Unlisted until production browser and service evidence is complete

**Regions**: All regions, subject to provider and deployment availability

## Developer Info

**Publisher Name**: Tom Ballard

**Contact Email**: TBD — provide a monitored publisher address before submission

**Support URL**: https://github.com/tcballard/annotated/issues

**Homepage URL**: https://annotated.com/

## Version History

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 0.1.0 | 2026-08-04 | Initial sidebar capture plus deployed staging default, stable extension identity, server-resolved source switching, bounded retry queue, sign-in/sign-out recovery, selected-text capture, system light/dark appearance, the chronograph range control shared with the web capture desk, written/audio notes, and source-backed publishing flow. | Draft |

## Review Notes

### Known Issues / Limitations

- Current screenshots, public privacy-policy URL verification, and a monitored publisher email are still required before submission. The approved, checksummed brand kit is preserved at `assets/brand/annotated-brand-kit/`; the extension icons are copied verbatim from its Chrome-specific exports by `scripts/generate-extension-icons.mjs`, and the supplied promo artwork is staged in `store-assets/`. The policy source is included in `public/privacy.html` and copied into `dist/` by the Vite build.
- The release build defaults to `https://annotated-staging.up.railway.app`; local development may use `http://localhost:8787`, and other deployed API origins must be HTTPS.
- X OAuth, PostgreSQL/S3 media delivery, real provider fixture extraction, packaged Chrome microphone capture, and offline/service-worker browser evidence remain production acceptance gates. Google is intentionally disabled for this POC. Queued captures now remain visible when authentication expires and can be retried after sign-in. The production image now includes a pinned, SHA-256-verified `yt-dlp` runtime, but that does not replace a real provider fixture run.
- The broad page host permissions are intentional because the product works on the user-selected active page, but the sidebar only reads and publishes data after an explicit user action.
- If Google sign-in is enabled for the extension, update the OAuth client with the Chrome Web Store-assigned extension ID after publishing.

### Packaging

Run `npm run package:extension` from the repository root. The script packages only
the `extension/` runtime directory, excludes `.DS_Store`, and writes
`annotated-extension-v0.1.0.zip` outside the extension source. It does not include
the repository, dependencies, tests, or this document.

### Rejection History

No submission has been made.
