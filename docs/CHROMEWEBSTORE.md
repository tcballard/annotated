# Chrome Web Store Listing — annotated — keep the moment

> Last Updated: 2026-08-10
>
> Status: v0.1.0 pre-submission draft. It has not been submitted, reviewed, or
> published. The machine-checked source of truth for copy, state, identity,
> assets, URLs, and external gates is `store-assets/store-listing.json`; this
> document is the human operator handoff and cannot promote the public CTA.

## Store Listing

**Extension Name**

annotated — keep the moment

**Short Description**

Clip a moment from the page you are on, add your context, and keep the source attached.

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
The extension reads the URL, title, and selected text from the active page so it can show and publish the source you choose. While the Capture surface is open, the current tab's address is sent to the Annotated backend to resolve the source's title, duration, and thumbnail — that is how the capture desk describes the page before you capture it. Switch to a feed and that stops. It does not publish anything until you choose Publish annotation. Draft metadata stays in the browser; a recorded audio note is held locally until upload or deletion. Published annotations and media are sent to the configured Annotated backend. There is no advertising or analytics collection.

PERMISSIONS
• Active-page access — needed to show the current source, read a selected passage, and let you choose a media range from any site you visit.
• Storage — needed to preserve bounded drafts, retry metadata, and the temporary sign-in session.
• Identity — needed to complete the configured X or Google sign-in handoff
  and receive the one-time extension callback.
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
| Screenshot 1 | 1280×800 | 🟡 Native-host capture required | `store-assets/screenshot-1-capture.png` |
| Screenshot 2 | 1280×800 | 🟡 Native-host capture required | `store-assets/screenshot-2-media-range.png` |
| Screenshot 3 | 1280×800 | 🟡 Native-host capture required | `store-assets/screenshot-3-published.png` |
| Small Promo Tile | 440×280 | ✅ Ready | `store-assets/promo-440x280.png` |
| Marquee Promo Tile | 1400×560 | ✅ Ready | `store-assets/marquee-1400x560.png` |

### Screenshot Notes

Screenshot 1 should show the sidebar open beside a real article with a selected
passage and the text annotation editor visible. Screenshot 2 should show a
video or podcast range with the 90-second boundary. Screenshot 3 should show a
successful published annotation link. Screenshots must be captured from the
current extension version in Chrome's native side-panel host and must not imply
that unverified provider or production integrations are available. The Gate B
automation-tab screenshots are engineering evidence, not Store assets.

## Permissions Justification

| Permission | Type | Justification |
|------------|------|---------------|
| `sidePanel` | permissions | Opens Annotated's persistent capture workspace beside the page. |
| `tabs` | permissions | Reads the active tab's URL and title, detects tab changes, and supplies the tab context required for selected-text capture. |
| `scripting` | permissions | Injects into the active tab only while the sidebar's **Capture** surface is open. Two injections are automatic there, because the capture surface exists to describe the page you are on: a read of the page's media element (to detect the source type and show the player's position) and a text-selection watcher (so the capture button can offer the passage you highlighted). The rest happen only on an explicit action — drawing the drag-to-snip overlay, and highlighting a chosen annotation's quoted passage. Nothing is injected while you are reading a feed, and no injected code sends page content anywhere on its own. |
| `storage` | permissions | Stores bounded drafts, API configuration, retry metadata, compact published-result metadata, and the temporary browser session. It never stores media Blobs in key/value storage. |
| `identity` | permissions | Opens the configured X or Google sign-in handoff and receives the one-time extension callback. |
| `alarms` | permissions | Wakes the extension periodically to retry queued captures without relying on a persistent background page. |
| `contextMenus` | permissions | Adds a single right-click item on selected text — "Annotate …" — that opens the side panel with that selection captured. Created once at install; no other menu surfaces are touched. |
| `favicon` | permissions | Reads Chrome's local favicon cache (the `_favicon/` extension endpoint) so each source in the panel's timeline shows its site icon. No network requests are made and no browsing data leaves the browser — the icons come from Chrome's own cache. |
| `<all_urls>` | host_permissions | The product is intentionally source-agnostic: while the **Capture** surface is open, it follows the active page on any site the user chooses and reads only the URL/title, media position, and current selection needed to prepare that capture. Chrome permits `tabs.captureVisibleTab` with either `<all_urls>` or a temporary `activeTab` grant; Annotated does not request `activeTab` because the persistent side panel must keep working after tab switches rather than relying on a one-invocation grant. Drawing a snip or highlight still requires an explicit action, and nothing is uploaded or published without one. Production API origins are separately restricted to HTTPS in settings. |

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

Implemented in the web build at `/privacy.html`; the current canonical URL is
`https://annotated-staging.up.railway.app/privacy.html`. Verify that exact URL
before submitting to the Chrome Web Store. The policy explains local draft retention,
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

**Homepage URL**: https://annotated-staging.up.railway.app/

## Version History

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 0.1.0 | 2026-08-04 | Initial sidebar capture plus deployed staging default, stable extension identity, server-resolved source switching, bounded retry queue, sign-in/sign-out recovery, selected-text capture, system light/dark appearance, the chronograph range control shared with the web capture desk, written/audio notes, and source-backed publishing flow. | Draft |

## Review Notes

### Known Issues / Limitations

- Native-host screenshots, public endpoint verification, and a monitored publisher email are still required before submission. The approved, checksummed brand kit is preserved at `assets/brand/annotated-brand-kit/`; the extension icons are copied verbatim from its Chrome-specific exports by `scripts/generate-extension-icons.mjs`, and the supplied promo artwork is staged in `store-assets/`. The policy source is included in `public/privacy.html` and copied into `dist/` by the Vite build.
- The release build defaults to `https://annotated-staging.up.railway.app`; local development may use `http://localhost:8787`, and other deployed API origins must be HTTPS.
- The packaged Gate B suite now covers native-host opening, selection, permission denial, local OAuth cancellation, direct/offline publishing, and real service-worker recovery without retries. An authoritative receipt still requires that suite to pass together with the protected PostgreSQL/S3/standalone-worker evidence workflow. Deployed Google and X consent/callback/logout, a successful real microphone recording, real provider fixture extraction, and Store-native screenshots remain external acceptance gates.
- The broad page host permission is intentional because the persistent Capture surface follows the user-selected active page across tab switches. It performs the disclosed URL/title, media, and selection probes while Capture is open; snips, highlights, uploads, and publishing still require explicit user actions.
- Google and X return to server-owned OAuth callbacks. After the first draft upload, reconcile the Store-assigned item ID/public key with `extension/manifest.json`, then put that final ID in the deployed `CHROME_EXTENSION_IDS` CORS and OAuth-return allowlist before packaged sign-in proof. This architecture does not use a Chrome Extension OAuth client.

### Packaging

Run `npm run package:extension` from the repository root. The deterministic
script packages only the `extension/` runtime directory, normalizes timestamps,
excludes `.DS_Store`, and writes `annotated-extension-v0.1.0.zip` plus its
`.sha256` checksum outside the extension source. `npm run build` publishes the
same versioned pair under `dist/release/` with `release.json` metadata. It does
not include the repository, dependencies, tests, or this document. The ZIP
timestamp is the committed epoch in `config/release.json`, so lifecycle and
documentation commits after the draft upload reproduce the uploaded bytes
instead of changing the Store artifact underneath its pinned SHA.

After the listing is genuinely public, set the machine manifest lifecycle to
`published`, pin its item ID, public URL, verification time, and exact artifact
SHA, then run the protected `Authoritative release evidence` workflow against
the already deployed commit. It performs the online Store/endpoints/CORS check
and embeds the verified Store receipt. Until that final bundle is deployed,
the checksummed ZIP remains the primary install action; source metadata alone
cannot promote **Add to Chrome**. Live Store receipts expire after 24 hours;
the runtime then falls back to the checksummed ZIP until the protected online
verification is rerun and a fresh evidence-bearing bundle is deployed.

### Rejection History

No submission has been made.
