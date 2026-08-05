# The mobile shell (Expo)

`mobile/` is a native shell around the deployed web app: a WebView pointed at
the production origin, plus the two things the web cannot do alone on a
phone — **the native share sheet** (an iOS Share Extension and an Android
intent filter via `expo-share-intent`) and **OAuth through the system
browser** (Google refuses to run OAuth inside WebViews).

## How it works

- **Share → capture.** Sharing a page/video into annotated opens
  `/capture?text=<shared payload>` — the same contract the PWA share target
  uses, so the web app's own extractor finds the URL and resolves it. Cold
  start and warm share are both handled.
- **Sign in.** The shell intercepts `/api/auth/*/start` navigations, rewrites
  `return_to` to `annotated://auth`, and opens the system browser. The OAuth
  callback mints the same one-time ticket the Chrome extension uses and
  returns through the app scheme; the shell then loads
  `/auth/mobile/session?ticket=…`, which exchanges the ticket for the normal
  cookie session inside the WebView. Tickets are single-use and expire in
  two minutes.
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

1. Install, open — the deployed app renders full-screen with the ink chrome.
2. In YouTube/Safari/Substack: Share → **annotated** (behind "More" the first
   time; pin it) → capture opens with the source resolved.
3. Sign in with X or Google → system browser opens → returns to the app
   signed in (cookie session in the WebView).
4. Publish; tap Open original — it opens in the real browser.

## Boundaries

- `expo-share-intent` requires a real build (dev build or TestFlight); the
  share extension does not exist inside Expo Go.
- The web app remains the source of truth — the shell ships no product UI
  and needs no release when web surfaces change.
