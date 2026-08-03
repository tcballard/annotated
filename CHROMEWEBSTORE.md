# Chrome Web Store Listing — annotated — keep the moment

> Last Updated: 2026-08-02
>
> Status: pre-submission draft. This document is the source of truth for a
> future Chrome Web Store submission; the unchecked external gates are not
> represented as shipped features.

## Store Listing

**Extension Name**

annotated — keep the moment

**Short Description**

Capture a moment from the page you are on, add context, and keep the source attached.

**Detailed Description**

Keep the moment before it disappears. Annotated lets you capture a passage or a bounded moment from the page you are reading, add your own context, and publish a page that keeps the original source attached.

FEATURES
• Capture selected text from the active page.
• Choose a bounded video or podcast moment, with a 90-second maximum.
• Add a short written note or a recorded audio note.
• Save a draft when the service is unavailable and retry it later.
• Keep queued captures safe when a sign-in session expires, then retry after sign-in.
• Open the published annotation page and share its source-backed link.

HOW TO USE
1. Load the extension and set the Annotated API origin in its settings.
2. Open a page and click the Annotated toolbar icon to open the sidebar.
3. Select text or adjust the moment controls, then add your context.
4. Choose Publish annotation when you are ready to share it.

PRIVACY
The extension reads the URL, title, and selected text from the active page so it can show and publish the source you choose. It does not publish anything until you choose Publish annotation. Draft metadata stays in the browser; a recorded audio note is held locally until upload or deletion. Published annotations and media are sent to the configured Annotated backend. There is no advertising or analytics collection.

PERMISSIONS
• Active-page access — needed to show the current source, read a selected passage, and let you choose a media range from any site you visit.
• Storage — needed to preserve bounded drafts, retry metadata, and the temporary sign-in session.
• Identity — needed to complete the optional Google or X sign-in handoff.
• Alarms — needed to retry queued captures when the browser service resumes.

SUPPORT
Report a problem or request a feature at https://github.com/tcballard/annotated/issues.

Version 0.1.0 — initial pre-submission release.

**Category**

Productivity

**Single Purpose**

Capture a moment from the current webpage and publish it with personal context and a source link.

**Primary Language**

English

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|-----------:|--------|----------|
| Store Icon | 128×128 PNG | 🟡 Needs creation | `store-assets/icon-128.png` |
| Screenshot 1 | 1280×800 or 640×400 | 🟡 Needs capture | `store-assets/screenshot-1.png` |
| Screenshot 2 | 1280×800 or 640×400 | ⬜ Not created | `store-assets/screenshot-2.png` |
| Screenshot 3 | 1280×800 or 640×400 | ⬜ Not created | `store-assets/screenshot-3.png` |
| Small Promo Tile | 440×280 | ⬜ Not created | `store-assets/promo-440x280.png` |

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
| `scripting` | permissions | Reads the user's current text selection from the active page when the sidebar is open. |
| `storage` | permissions | Stores bounded drafts, API configuration, retry metadata, compact published-result metadata, and the temporary browser session. It never stores media Blobs in key/value storage. |
| `identity` | permissions | Opens the configured Google or X sign-in handoff and receives the one-time extension callback. |
| `alarms` | permissions | Wakes the extension periodically to retry queued captures without relying on a persistent background page. |
| `http://*/*` | host_permissions | Supports local HTTP development and lets the sidebar read a source page selected by the user. Production API origins are separately restricted to HTTPS in settings. |
| `https://*/*` | host_permissions | The product is intentionally source-agnostic: it must read the active page and selected passage on any HTTPS site the user chooses. It does not inject code until the user opens the sidebar and does not publish without an explicit action. |

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

TBD — publish and verify a stable public policy URL before submitting to the
Chrome Web Store. The URL must match the disclosures above and explain local
draft retention, published annotation/media retention, identity providers,
backend storage, deletion requests, and contact details.

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
| 0.1.0 | 2026-08-02 | Initial sidebar capture plus bounded retry queue, session-expiry recovery, selected-text capture, media controls, written/audio notes, and source-backed publishing flow. | Draft |

## Review Notes

### Known Issues / Limitations

- The icon, screenshots, promo artwork, public privacy-policy URL, and monitored publisher email are still required before submission.
- The extension requires a configured Annotated backend. Local development uses `http://localhost:8787`; deployed API origins must be HTTPS.
- Google/X OAuth, PostgreSQL/S3 media delivery, real provider fixture extraction, packaged Chrome microphone capture, and offline/service-worker browser evidence remain production acceptance gates. Queued captures now remain visible when authentication expires and can be retried after sign-in. The production image now includes a pinned, SHA-256-verified `yt-dlp` runtime, but that does not replace a real provider fixture run.
- The broad page host permissions are intentional because the product works on the user-selected active page, but the sidebar only reads and publishes data after an explicit user action.
- If Google sign-in is enabled for the extension, update the OAuth client with the Chrome Web Store-assigned extension ID after publishing.

### Packaging

Run `npm run package:extension` from the repository root. The script packages only
the `extension/` runtime directory, excludes `.DS_Store`, and writes
`annotated-extension-v0.1.0.zip` outside the extension source. It does not include
the repository, dependencies, tests, or this document.

### Rejection History

No submission has been made.
