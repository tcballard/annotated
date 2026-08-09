# The mobile app (Expo)

`mobile/` is a hybrid app with a fully native reading surface and X-anatomy
navigation in annotated's identity: your avatar top-left opens **the
drawer** (swipe right works too), the wordmark sits center, and five tabs
sit in a **floating pill** padded off the screen edges above the home
indicator — **Home · Search · Capture (the pen, center) · Notifications ·
Profile** — with the feeds scrolling behind it, the same floating-pill
language as the web's mobile dock. Home's feed menu scrolls horizontally:
Recent · Trending · Following, then every topic as its own feed. The
timeline and search results are native React Native (FlatList physics,
pull-to-refresh, cursor paging) built on the shared core packages; the
capture desk, your profile, the library, and every pushed page (permalinks,
profiles, hubs, doc pages) stay the deployed web app in *shell mode*
(`?shell=1`). Notifications are served by the API (responses, likes, and
follows aimed at you, derived on read; a last-seen watermark powers the
bell badge). On top of that the app does the things the web cannot do
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

- `app/_layout.tsx` — root stack: the drawer-wrapped tabs plus pushed
  screens; share-intent routing, the session epoch, and the signed-in
  account (with the notifications badge) live here.
- `app/(drawer)/_layout.tsx` + `components/DrawerPanel.tsx` — the slide-out
  panel: account card, Library, Moderation (moderators), the public pages,
  sign out.
- `app/(drawer)/(tabs)/_layout.tsx` — the header (avatar → drawer,
  wordmark) and the floating pill bar with its five tabs, painted with the
  web's tokens.
- `app/(drawer)/(tabs)/index.tsx` → `components/Timeline.tsx` — the native
  feed; `search.tsx` → `components/SearchScreen.tsx`; `notifications.tsx` →
  `components/NotificationsScreen.tsx`; `profile.tsx` — your public page
  in shell mode.
- `app/(drawer)/(tabs)/capture.tsx` — the capture desk: the center pen
  tab, and where a share-sheet arrival lands.
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

- **Native timeline.** The scrollable menu is the feed switcher: Recent ·
  Trending · Following, then a feed per topic (trending scoped to the
  topic), with haptic switches, pull-to-refresh, and infinite scroll on
  the feed cursor. Cards carry the name/handle byline, note, serif source
  card, posters/screenshots, and peak waveforms. Tapping a card pushes the
  annotation's web page; media plays there. Native fetches share the
  system cookie jar with the WebViews, so the timeline is signed in the
  moment any surface is.
- **Share → capture desk.** Sharing a page/video into annotated lands on
  the Capture tab with `/capture?text=<shared payload>` — the same contract
  the PWA share target uses. Cold start and warm share both work; sharing
  the same link twice still reloads the desk.
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

## Sorting out EAS (requires your accounts; not runnable from CI)

**Accounts first — one is instant, one has a wait.** Start the Apple one
today even if you build next week:

1. **Apple Developer Program** — enroll at
   developer.apple.com/programs ($99/year). Approval is usually fast but
   can take 24–48 hours; it gates everything iOS, so it's the long pole.
2. **Expo account** — sign up free at expo.dev (2 minutes). The free tier
   builds iOS apps; you only queue behind paid builds at busy times.

One-time link-up once both exist:

```bash
cd mobile
npm ci
npx eas-cli login                 # your Expo account
npx eas-cli build:configure       # writes the EAS projectId into app.json — commit that
```

**What's already configured in this repo** (no clicking around required):
the bundle id `co.armytage.annotated`, remote build numbering
(`autoIncrement` — no manual version bumps), the microphone permission
string for voice notes, the branded splash screen, and
`ITSAppUsesNonExemptEncryption: false` so TestFlight never stops you with
the export-compliance question. EAS generates and stores certificates and
provisioning profiles itself, including the share-extension target — say
yes when it offers.

**Fast lane — on your phone tonight, no App Store Connect involved.**
`preview` builds are ad-hoc: they install over the air on registered
devices only.

```bash
npx eas-cli device:create                            # register your iPhone's UDID (once)
npx eas-cli build --platform ios --profile preview   # ~15 min; open the build URL on the phone
```

**TestFlight lane — shareable with anyone.** TestFlight requires an App
Store distribution build, which is the `production` profile (ad-hoc
`preview` builds cannot be submitted):

```bash
npx eas-cli build --platform ios --profile production
npx eas-cli submit --platform ios
```

The submit wizard signs into your Apple account, creates the App Store
Connect app record and an API key for you, and uploads. Then in App Store
Connect → TestFlight, add yourself (and J-Cal's crew) to an **internal
testing** group — internal testers skip Beta App Review entirely; builds
are installable ~10 minutes after processing.

**Where the app points.** Each `eas.json` build profile pins the API
origin via `EXPO_PUBLIC_ORIGIN` (all three currently aim at the Railway
staging URL). When the real domain exists, change it there — one line per
profile; `expo.extra.origin` in `app.json` is only the fallback for local
development.

**Android:** `npx eas-cli build --platform android --profile preview`
produces an installable `.apk`. Google Play (separate $25 one-time
account) can wait — TestFlight is the demo path.

Development build with hot reload on a real device:

```bash
npx eas-cli build --profile development --platform ios
npx expo start --dev-client
```

No device to hand? The app also runs in a browser via react-native-web —
same components, DOM-rendered (WebView surfaces become iframes; grant the
local server `ANNOTATED_DEV_ALLOW_FRAMING=1` so shell pages allow it):

```bash
EXPO_PUBLIC_ORIGIN=http://localhost:8787 npx expo start --web
```

## What to test on the device

1. Install, open — avatar top-left, wordmark center, the floating pill
   bar below with the pen at its center; the feed menu scrolls sideways,
   switches tick, and the feed scrolls behind the bar.
2. Swipe right from the left edge (or tap your avatar) — the drawer slides
   out with your account card and the public pages.
3. Notifications — the bell badge counts unseen; opening the tab clears it.
4. Tap a card — its page pushes under a native header; media plays there;
   swipe back returns to your scroll position.
5. In YouTube/Safari/Substack: Share → **annotated** (behind "More" the
   first time; pin it) → the Capture tab opens with the source resolved.
6. Follow someone signed out — the sign-in sheet appears, the system
   browser round-trips, and you land back followed; every tab is now
   signed in.
7. Publish; tap Open original — it opens in the real browser.
8. Android hardware back walks the current surface's history first.

## Boundaries

- `expo-share-intent` requires a real build (dev build or TestFlight); the
  share extension does not exist inside Expo Go.
- The timeline, search, and notifications are native; the desk-work
  surfaces stay web, so a web deploy updates them instantly. Chrome-level
  changes (tabs, timeline, share sheet, auth plumbing) need an app
  release.
- Clips and audio play inline in the feed (players mounted on tap); the
  pushed annotation page remains the full playback surface.
