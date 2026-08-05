# The mobile app (Expo)

`mobile/` is a hybrid app with a fully native reading surface: **native
chrome and timeline, web everywhere the desk work happens**. Navigation is
a real bottom tab bar (expo-router: Timeline · Capture · Library) with
haptic feedback and safe-area handling. The Timeline tab is native React
Native — FlatList physics, pull-to-refresh, cursor paging — built on the
shared core packages; Capture and Library host the deployed web app in
*shell mode* (`?shell=1`), where the page renders content only. Annotation
pages, profiles, and source hubs push over the tabs as web surfaces under
a native header. On top of that the app does the things the web cannot do
alone on a phone: **the native share sheet** (an iOS Share Extension and an
Android intent filter via `expo-share-intent`) and **OAuth through the
system browser** (Google refuses to run OAuth inside WebViews).

One identity, one domain: `mobile/lib/tokens.ts` is generated from the web
stylesheet's `:root` tokens (`node scripts/generate-mobile-tokens.mjs`),
and `mobile/lib/core/` is generated from `packages/core`
(`node scripts/build-core.mjs`) — the same TypeScript domain model, API
client, and deep-link builders the web, server, and extension use. The
test suite fails if either goes stale.

## Layout

- `app/_layout.tsx` — root stack: the tab bar plus pushed web surfaces;
  share-intent routing and the session epoch that keeps sign-in consistent
  across surfaces.
- `app/(tabs)/_layout.tsx` — the tab bar, painted with the web's tokens.
- `app/(tabs)/index.tsx` → `components/Timeline.tsx` — the native feed.
- `app/(tabs)/capture.tsx` · `app/(tabs)/library.tsx` — web surfaces in
  shell mode.
- `app/web/[...path].tsx` — any internal page (permalink `/a/…`, profile
  `/u/…`, hub `/s/…`) pushed under a native header.
- `components/WebScreen.tsx` — the WebView wrapper: shell-mode URL, OAuth
  interception, open-originals-out policy, Android back handling.
- `lib/core/` — GENERATED from `packages/core`; `lib/tokens.ts` —
  GENERATED from the web stylesheet. Do not edit either by hand.
- `lib/api.ts` — the shared API client aimed at the deployed origin;
  `lib/native-auth.ts` — sign-in from native surfaces; `lib/shell.ts` —
  pure helpers (asserted directly by the repo test suite).

## How it works

- **Native timeline.** Recent · Trending · Following as native panes with
  haptic switches, topic chips on Trending (live counts from the same feed
  API), pull-to-refresh, infinite scroll on the feed cursor. Cards carry
  the byline verb, note, serif source card, posters/screenshots, and peak
  waveforms. Tapping a card pushes the annotation's web page; media plays
  there. Native fetches share the system cookie jar with the WebViews, so
  the timeline is signed in the moment any surface is.
- **Share → Capture tab.** Sharing a page/video into annotated routes to
  the Capture tab and loads `/capture?text=<shared payload>` — the same
  contract the PWA share target uses. Cold start and warm share both work;
  sharing the same link twice still reloads the desk.
- **Sign in.** From a WebView, tapped sign-in links are intercepted; from
  the native timeline (e.g. a follow while signed out), the same flow is
  driven directly: system browser → `annotated://auth` with a one-time
  ticket → `/auth/mobile/session?ticket=…&next=<surface>` exchanges it for
  the normal cookie session and returns to the surface the reader left.
  `next` is honoured only as a local path. The session epoch then reloads
  every other mounted surface — one sign-in serves the whole app.
- **Shell mode.** Web-hosted surfaces load with `?shell=1`; the web app
  persists the flag, drops its own chrome and footer, and returns the feed
  switcher to the top. Sign-out lives on the Library surface. The regular
  mobile web keeps its bottom-docked switcher — nothing is shoehorned in
  either direction.
- **Originals open OUT.** From native cards and WebViews alike, any other
  origin opens in the real browser — the product's point, kept on mobile.

## Building it (requires your accounts; not runnable from CI)

One-time setup:

```bash
cd mobile
npm ci
npx eas-cli login                 # your Expo account
npx eas-cli build:configure       # links the EAS project id into app.json
```

Set the deployment origin if it differs from staging: edit
`expo.extra.origin` in `app.json`.

**iOS** (Apple Developer account required; EAS manages certificates and the
share-extension provisioning profile automatically):

```bash
npx eas-cli build --platform ios --profile preview   # installable via TestFlight
npx eas-cli submit --platform ios                    # push to TestFlight
```

**Android:**

```bash
npx eas-cli build --platform android --profile preview   # .apk for direct install
```

Development build with hot reload on a real device:

```bash
npx eas-cli build --profile development --platform ios
npx expo start --dev-client
```

## What to test on the device

1. Install, open — a native timeline with the pill pane switcher, native
   scroll feel, pull-to-refresh; tabs along the bottom tick on switch.
2. Trending pane — topic chips filter with live counts.
3. Tap a card — its page pushes under a native header; media plays there;
   swipe back returns to your scroll position.
4. In YouTube/Safari/Substack: Share → **annotated** (behind "More" the
   first time; pin it) → the Capture tab opens with the source resolved.
5. Follow someone signed out — the sign-in sheet appears, the system
   browser round-trips, and you land back followed; every tab is now
   signed in.
6. Publish; tap Open original — it opens in the real browser.
7. Android hardware back walks the current surface's history first.

## Boundaries

- `expo-share-intent` requires a real build (dev build or TestFlight); the
  share extension does not exist inside Expo Go.
- The timeline is native; every other product surface stays web, so a web
  deploy updates them instantly. Chrome-level changes (tabs, timeline,
  share sheet, auth plumbing) need an app release.
- Timeline media playback happens on the pushed annotation page (the web
  player) — native inline playback is a deliberate later step.
