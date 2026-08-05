# Extension surface map

This record applies the `chrome-plugin` workflow to the Manifest V3 extension. It is a
design and boundary contract for the unpacked extension; it does not claim Chrome Web
Store or deployed-browser readiness.

## Surfaces and ownership

| Surface | User task | Owner | State that must be visible |
| --- | --- | --- | --- |
| Side panel | Read the current tab, mark the moment (player time or typed), capture a highlighted passage, add text or audio context, publish, and browse the Recent · Following · This page timeline | `extension/sidepanel.html`, `sidepanel.js`, `sidepanel.css` | initial, source detected, marks set, passage captured, text/audio mode, recording, staged/uploading, offline, queued, error, publish toast, timeline loading/empty/error |
| Extension action | Open the side panel beside the active tab | `extension/background.js` | opened, unavailable tab, service-worker error logged |
| Service worker | Retry bounded metadata captures and audio uploads after suspension or network loss | `extension/background.js` | scheduled, retrying, needs sign-in, blocked, completed; state is persisted rather than held in worker variables |
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
- `storage.local` contains bounded draft and retry metadata only. Audio `Blob` data lives in
  IndexedDB until the server accepts it; published media is server-side. A stale 401 session
  moves a capture to an explicit `needs-auth` state instead of deleting it.
- `identity` is used only for configured OAuth handoff. No provider credential is shipped in
  the extension.
- `http://*/*` is retained for loopback development and `https://*/*` for deployed source
  pages. The API origin is validated before use; non-loopback HTTP origins are rejected.

## Visual and interaction contract

The panel follows the handoff v2 identity (see `UX_DIRECTION.md`): ink chrome header, paper
ground, white capture card, and terracotta reserved for the moment — the live source dot,
the marks once set, the duration chip, the active timeline tab, and the primary Open action.
The capture widget is pinned first; the timeline scrolls beneath a sticky sub-header with
Recent · Following · This page tabs. Marks read the page's player (`I`/`O` when the panel is
focused); pages with no reachable player fall back to typed mono time fields. Article capture
grabs the on-page highlight along with its paragraph number and text-quote context so the
landing page can deep-link with `#:~:text=`. Unsaved marks and notes persist per tab in
`chrome.storage.session`, so switching tabs re-binds the panel without losing either side.

All controls have visible `:focus-visible` treatment and ≥40px hit areas. Hidden components
use an explicit `[hidden]` contract so loading and success states cannot leak into the
initial view. Recording and skeleton animation are disabled under `prefers-reduced-motion`;
a dark scheme maps the same tokens for `prefers-color-scheme: dark`.

## Verification contract

Automated checks cover the MV3 manifest, action-to-side-panel trigger, permission/documentation
parity, CSP-safe runtime source, storage-origin fallback, and package contents. A real Chrome
run must still verify loading the unpacked extension, side-panel opening, selection on a
representative page, audio permission/recovery, service-worker retry after suspension, and
the deployed API origin. Store icon artwork, screenshots, a public privacy URL, publisher
contact, and production browser evidence remain external release gates in
[`CHROMEWEBSTORE.md`](CHROMEWEBSTORE.md).
