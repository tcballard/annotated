# The 90-second demo

A judge comparing dozens of entries gives each one about ninety seconds.
This script spends them deliberately: five beats, one differentiation
claim per beat, every claim shown rather than said. Record it in one
take if you can — the product's pacing is part of the pitch.

## Setup (before recording)

- Chrome with the extension loaded and pinned, side panel closed.
- Signed in as your demo account; staging seeded with the personas
  (`npm run seed:personas`) so the feed, follows, and responses are alive.
- The personas aimed at YOUR account, so notifications and the bell badge
  read lived-in. Sign in on staging once, publish at least one
  annotation, then run against staging's database (your drawer shows
  your handle):

  ```sh
  ANNOTATED_STORAGE=postgres DATABASE_URL=… ANNOTATED_SEED_PERSONAS=allow \
  ANNOTATED_SEED_TARGET=<your-handle> npm run seed:personas
  ```

  Idempotent — safe to re-run after publishing more. Follows land even
  with no annotations; likes and responses need at least one.
- Three tabs ready, in order:
  1. A YouTube video with a strong claim mid-video (know your in/out
     points in advance).
  2. A long-form article worth quoting.
  3. The annotated web timeline, signed in.
- iOS Simulator pre-arranged screen-right with the native app on its
  timeline, signed in as the same account. Easiest path is
  [Expo Orbit](https://expo.dev/orbit): sign in, pick
  **tcballard-oss / annotated**, and install the latest `simulator`
  profile build straight into a simulator — one click, no Xcode build,
  no dev server, no Apple credentials (simulator builds are unsigned by
  design). The build runs standalone against staging with the JS
  embedded.

  Fallback if you'd rather build locally:

  ```sh
  cd mobile && npm ci
  EXPO_PUBLIC_ORIGIN=https://annotated-staging.up.railway.app npx expo run:ios
  ```

  (A physical phone with the dev build works too, but on a screen
  recording the simulator reads better anyway.)
- OS in light mode, reduced motion off, notifications silenced.
- One practice run for the marks: the demo lives or dies on beat 1's
  confidence.

## The beats

### Beat 1 — Four capture modes, one panel (0:00–0:20)

**VO:** "This is annotated — it lives beside the page. Capture the exact
moment: mark a clip from the player, highlight a passage, or snip the
screen."

- On the YouTube tab, press `Alt+A`. The panel opens on Capture, reading
  the tab — title, favicon, live dot.
- Press `I`, let it play two seconds, press `O`. The marks flash, the
  duration chip ticks.
- Switch to the article tab. Highlight a sentence — the grabber arms
  itself with the quoted words. Click it: the passage lands as a card.
- Click "Snip part of the page," drag the marquee over a figure. The
  snip develops in the panel.

### Beat 2 — Real clip artifacts (0:20–0:40)

**VO:** "Publishing makes a real artifact — the clip is transcoded and
hosted, ninety seconds max, and it plays right in the feed. Not an
embed. Not a link that rots."

- Back on the YouTube tab: type one sharp sentence in the note, press
  Ctrl/⌘ Enter.
- Let the publish moment play — the ring draws, the page is live.
- Click "View page": the annotation page with the playable clip, the
  CLIP tag, the duration badge. Play two seconds of it.

### Beat 3 — A public margin, not a private vault (0:40–0:55)

**VO:** "It's social the way reading used to be — follow people whose
context you want, respond, like. The read-later apps deleted this loop.
It's the whole point here."

- Switch to the timeline tab: the feed with personas' annotations —
  clips, quotes, screenshots, avatars.
- Like one. Open one and post a one-line response.
- Point at the notifications digest in the panel: "Since you last
  looked."

### Beat 4 — Round-trip receipts (0:55–1:10)

**VO:** "Every annotation sends readers back. Open original lands on the
exact second — or the exact sentence — and opens of the original are the
number we rank by."

- On a media annotation, click "Open original at 0:14" — YouTube opens
  at 0:14. Two seconds there, come back.
- On an article annotation in the panel's This page tab, click the
  highlight action — the quoted passage lights up terracotta on the live
  page.
- Hover the opens count on Open original: "N opens of the original."

### Beat 5 — Rights as a surface, one identity everywhere (1:10–1:30)

**VO:** "Fair use has an interface: dispute it on any page, takedowns
are public, and the whole thing is one account — extension, web, and the
native app."

- On any annotation page, point at the bordered **Dispute fair use**
  button. Click it, show the form, close it.
- Flash the /transparency page: dispute counts, the takedown record.
- Pan to the simulator sitting screen-right: the same feed, native, same
  account. Scroll one flick.
- End on the wordmark. **VO:** "annotated. Keep the moment — with the
  source attached."

## Cutting-room rules

- Never scroll aimlessly; every second on screen is a claim.
- If a beat runs long, cut beat 3's response, then beat 4's hover — the
  clip artifact and the dispute button are non-negotiable.
- No browser chrome besides the side panel; hide bookmarks bar.
- Capture the full screen with Chrome sized left and the simulator
  screen-right, so beat 5 is a pan, not a cut; the panel at its default
  width.
