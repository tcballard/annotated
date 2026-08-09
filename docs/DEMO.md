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

## The claims ledger

The demo's own receipts. Every claim the VO makes, and where this
repository proves it — a claim that loses its take gets cut from the
script, not promoted on faith.

| ID | Claim (VO wording) | Evidence | Status |
| --- | --- | --- | --- |
| C01 | "It lives beside the page" | `extension/manifest.json` (`side_panel`), `extension/sidepanel.html` | Verified |
| C02 | "Mark a clip from the player, highlight a passage, or snip the screen" | Player-read marks, armed grabber, and snip overlay in `extension/sidepanel.js`; locked by `test/chrome-extension.test.js` | Verified |
| C03 | "The clip is transcoded and hosted, ninety seconds max" | 91-second range → 422 in `test/api-acceptance.test.js`; probe gates in `test/media-policy.test.js`, `test/media-probe.test.js`, `test/clip-range.test.js` | Verified |
| C04 | "It plays right in the feed. Not an embed. Not a link that rots." | Hosted 240p artifact with inline players; `test/media-presentation.test.js` | Verified — a failed provider extraction shows a visible `failed` state, never a fake playable clip |
| C05 | "Follow people whose context you want, respond, like" | Persisted social routes; `test/api-acceptance.test.js`, `test/hot-path.integration.test.js` | Verified |
| C06 | "Open original lands on the exact second — or the exact sentence" | Timestamped media links and `#:~:text=` anchoring; `test/deep-link.test.js`; persona seeds land on the quoted words | Verified |
| C07 | "Opens of the original are the number we rank by" | `server/trending.js` — `OPEN_WEIGHT 3` over comments 2 and likes 1; curators rail ranks by opens | Verified — decayed by age (hot gravity), not a raw count |
| C08 | "Fair use has an interface: dispute it on any page" | Dispute button on every `/a/:slug`; no-JS form at `/a/:slug/claim`; `test/claim-ui.test.js` | Verified |
| C09 | "Takedowns are public" | `/transparency` page and tombstone records; `test/doc-pages.test.js` | Verified |
| C10 | "The whole thing is one account — extension, web, and the native app" | One-door OAuth with extension ticket exchange and mobile ticket sessions in `server/auth.js`; `test/auth.test.js` | Verified |

## Shot list

All shots: full-display capture (Chrome left, simulator right), 1–2 s
of stillness as handles either side, VO overdubbed on the cut unless
you deliberately choose live narration. A take is unusable the moment
a gate fails — re-record it, don't rescue it in the edit.

| ID | Beat | Action → visible result | Usability gate | Claims |
| --- | --- | --- | --- | --- |
| S01 | 1 | `Alt+A` on the YouTube tab → panel opens on Capture, title/favicon/live dot reading the tab | Panel opens within the beat; tab metadata legible | C01 |
| S02 | 1 | `I`, two seconds of playback, `O` → marks flash, duration chip ticks | The player's own timestamps visible in the chip | C02 |
| S03 | 1 | Highlight a sentence on the article tab → grabber arms with the quoted words; click → passage card | Quoted words readable in the grabber before the click | C02 |
| S04 | 1 | Drag the snip marquee over a figure → snip develops in the panel | Marquee visible from first pixel; snip renders before the cut | C02 |
| S05 | 2 | One-line note, `Ctrl/⌘ Enter` → publish ring draws, page is live | The ring completes on camera — no cut mid-publish | C03 |
| S06 | 2 | "View page" → annotation page; play two seconds of the clip | `CLIP` tag and `· 240p` duration badge in frame while playing | C03, C04 |
| S07 | 3 | Timeline tab → like one annotation, open one, post a one-line response | Personas' avatars and media visible; the response lands on camera | C05 |
| S08 | 3 | Point at the panel's notifications digest | "Since you last looked" copy legible | C05 |
| S09 | 4 | "Open original at 0:14" → YouTube opens at 0:14, two seconds, return | The timestamp in the button matches where YouTube lands | C06 |
| S10 | 4 | Panel This page tab → highlight action → passage lights terracotta on the live page | The wash lands on the quoted words, nowhere else | C06 |
| S11 | 4 | Hover the opens count on Open original | "N opens of the original" tooltip readable | C07 |
| S12 | 5 | Point at **Dispute fair use**, click, show the form, close | The bordered button is unmistakable before the click | C08 |
| S13 | 5 | Flash `/transparency` | Dispute counts and takedown record visible | C09 |
| S14 | 5 | Pan right to the simulator: same feed, native, same account; one scroll flick | Same handle visible in both surfaces during the pan | C10 |
| S15 | 5 | End on the wordmark | Clean hold — the last frame is the wordmark, not a stray window | — |

## Recording discipline

The setup list above covers fixtures, tabs, and the simulator. While
recording:

- Hold one to two seconds of stillness before the first action and
  after the verified result — the edit needs handles.
- Decide the audio before S01: overdub the VO on the cut (default — the
  take stays silent), or narrate live and record ten seconds of room
  tone first.
- Re-record after any notification, hesitation, accidental hover, or
  unclear state. Keep every take until the final export is accepted,
  named by shot (`S05-t2`).
- Inspect the first and last frame of each keeper take before calling
  it done.

## Validate the export

```sh
ffprobe -v error -show_entries format=duration \
  -show_entries stream=width,height,r_frame_rate,codec_name \
  -of default=noprint_wrappers=1 demo.mp4
```

Hard gates — fix and re-export, don't ship a miss:

- Duration at or under 1:35 (the script budgets 1:30; the margin
  protects against encoding drift and platform rounding).
- 1080p or better, stable frame rate, audio stream present.
- Plays start to finish; the final frame is S15's wordmark hold.
- Every ledger claim stays verified or visibly qualified in the cut —
  no edit hides a wait, a failure, or a state change that alters what
  the viewer believes happened.
- No notification, personal account, or credential in any frame: check
  the first frame, every transition, and the last frame before
  submitting.
