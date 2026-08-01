# Extension surface map

This record applies the `chrome-plugin` workflow to the Manifest V3 extension. It is a
design and boundary contract for the unpacked extension; it does not claim Chrome Web
Store or deployed-browser readiness.

## Surfaces and ownership

| Surface | User task | Owner | State that must be visible |
| --- | --- | --- | --- |
| Side panel | Read the current tab, select a media range, add text or audio context, and publish | `extension/sidepanel.html`, `sidepanel.js`, `sidepanel.css` | initial, source loaded, selected text, text/audio mode, recording, staged/uploading, offline, queued, error, success |
| Extension action | Open the side panel beside the active tab | `extension/background.js` | opened, unavailable tab, service-worker error logged |
| Service worker | Retry bounded metadata captures and audio uploads after suspension or network loss | `extension/background.js` | scheduled, retrying, blocked, completed; state is persisted rather than held in worker variables |
| Options page | Set and validate the API origin | `extension/options.html`, `options.js`, `storage.js` | loading, saved, invalid origin, loopback development fallback |
| IndexedDB staging | Keep recorded audio recoverable while upload is delayed | `extension/media-draft-store.js` | staged, read, deleted after upload, unavailable/corrupt draft |

The side panel is the primary contextual workspace. The toolbar action is intentionally a
single entry point and has no popup. The options page owns durable configuration; it is not
part of the capture flow.

## Data and permission boundary

- `tabs` and `scripting` read the active tab URL/title and the current text selection. A
  restricted browser page produces a recoverable message that points to the web capture desk.
- `sidePanel` and `action` open the panel from the browser chrome. `alarms` schedules retry
  work so the service worker does not depend on timers or in-memory state.
- `storage.local` contains bounded draft metadata only. Audio `Blob` data lives in IndexedDB
  until the server accepts it; published media is server-side.
- `identity` is used only for configured OAuth handoff. No provider credential is shipped in
  the extension.
- `http://*/*` is retained for loopback development and `https://*/*` for deployed source
  pages. The API origin is validated before use; non-loopback HTTP origins are rejected.

## Visual and interaction contract

The panel uses an editorial capture-desk direction: a dark status-bearing header, paper-like
surface, orange publish action, mint recovery/success states, a compact mono metadata voice,
and a serif annotation field. Inline SVGs provide one coherent line-icon language for source,
annotation mode, recording, publish, and success states. The product's signature element is
the state-bearing source frame: the current page, source type, selection, and backend status
remain visible while the user adds context.

All controls have visible `:focus-visible` treatment and touch-friendly hit areas. Hidden
components use an explicit `[hidden]` contract so loading and success states cannot leak into
the initial view. Recording animation is disabled under `prefers-reduced-motion`.

## Verification contract

Automated checks cover the MV3 manifest, action-to-side-panel trigger, permission/documentation
parity, CSP-safe runtime source, storage-origin fallback, and package contents. A real Chrome
run must still verify loading the unpacked extension, side-panel opening, selection on a
representative page, audio permission/recovery, service-worker retry after suspension, and
the deployed API origin. Store icon artwork, screenshots, a public privacy URL, publisher
contact, and production browser evidence remain external release gates in
[`CHROMEWEBSTORE.md`](CHROMEWEBSTORE.md).
