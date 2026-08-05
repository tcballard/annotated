# The mobile app (Expo)

`mobile/` is a hybrid app: **native chrome, web surfaces**. Navigation is a
real bottom tab bar (expo-router: Timeline · Capture · Library) with haptic
feedback and safe-area handling; each tab hosts one deployed web surface in
*shell mode* (`?shell=1`), where the page renders content only — no web nav
bar, no footer — because navigation belongs to the native tabs. On top of
that the app does the things the web cannot do alone on a phone: **the
native share sheet** (an iOS Share Extension and an Android intent filter
via `expo-share-intent`) and **OAuth through the system browser** (Google
refuses to run OAuth inside WebViews).

One identity everywhere: `mobile/lib/tokens.ts` is generated from the web
stylesheet's `:root` tokens (`node scripts/generate-mobile-tokens.mjs`), so
the tab bar and native surfaces use the exact colors the web uses. The test
suite fails if the generated file goes stale.

## Layout

- `app/_layout.tsx` — the tab bar, haptics, share-intent routing, and the
  session epoch that keeps sign-in consistent across tabs.
- `app/index.tsx` · `app/capture.tsx` · `app/library.tsx` — one web surface
  per tab.
- `components/WebScreen.tsx` — the WebView wrapper: shell-mode URL, OAuth
  interception, open-originals-out policy, Android back handling, loading
  state.
- `lib/shell.ts` — pure helpers (asserted directly by the repo test suite).
- `lib/tokens.ts` — GENERATED; do not edit by hand.

## How it works

- **Share → Capture tab.** Sharing a page/video into annotated routes to the
  Capture tab and loads `/capture?text=<shared payload>` — the same contract
  the PWA share target uses, so the web app's own extractor finds the URL
  and resolves it. Cold start and warm share are both handled; sharing the
  same link twice still reloads the desk.
- **Sign in.** A tapped sign-in link (`/api/auth/*/start`) is intercepted,
  `return_to` is rewritten to `annotated://auth`, and the system browser
  opens. The OAuth callback mints the same one-time ticket the Chrome
  extension uses and returns through the app scheme; the tab then loads
  `/auth/mobile/session?ticket=…&next=<its surface>`, which exchanges the
  ticket for the normal cookie session and lands back on the surface the
  reader left. `next` is honoured only as a local path. Other mounted tabs
  reload automatically so the whole app is signed in at once. Tickets are
  single-use and expire in two minutes.
- **Shell mode.** Every tab loads its surface with `?shell=1`; the web app
  persists the flag in `sessionStorage`, drops its own chrome and footer,
  and returns the feed switcher to the top (the bottom of the screen belongs
  to the native tab bar). Sign-out moves onto the Library surface. The
  regular mobile web keeps its bottom-docked switcher — nothing is
  shoehorned in either direction.
- **Originals open OUT.** Navigation to any other origin opens the system
  browser — the product's point, kept on mobile.

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

1. Install, open — native tabs along the bottom, the timeline chromeless
   above them, pill switcher at the top. Tab switches tick (haptics).
2. In YouTube/Safari/Substack: Share → **annotated** (behind "More" the first
   time; pin it) → the Capture tab opens with the source resolved.
3. Sign in with X or Google → system browser opens → returns to the surface
   you left, signed in; switch tabs — they are signed in too.
4. Publish; tap Open original — it opens in the real browser.
5. Android hardware back walks the current tab's history before leaving.

## Boundaries

- `expo-share-intent` requires a real build (dev build or TestFlight); the
  share extension does not exist inside Expo Go.
- The web app remains the source of truth — product surfaces ship no native
  duplicate, so a web deploy updates the app's content instantly; only
  chrome-level changes (tabs, share sheet, auth plumbing) need a release.
