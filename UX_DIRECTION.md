# Annotated UX direction — handoff v2 identity

Annotated is a source-first social notebook. The interface is a quiet paper
ground on which exactly one thing glows: the moment someone kept. These are
laws, not suggestions; `test/terracotta-audit.test.js` enforces the first one.

## Tokens

`--chrome #33383F` · `--chrome-dark #26292F` · `--paper #F5F4F0` ·
`--card #FFFFFF` · `--soft #F0F1F3` · `--border #DDDEE2` · `--hair #E8E9EC` ·
`--ink #26292F` · `--ink-soft #3E444E` · `--meta #666C74` · `--link #52678F` ·
`--accent #B0674D` · `--accent-soft rgba(176,103,77,.10)`

## Laws

1. **Terracotta means THE MOMENT.** The accent appears only on: moment chips,
   the live source dot, mark-selection state, the CLIP tag, active-tab
   underlines, the primary "Open original" action, the pull-quote rule,
   section-header full stops, focus rings, the claim hover, and the logo dot.
   Never on generic buttons, links, alerts, or decoration. This single rule is
   the brand.
2. **Two voices.** The SOURCE speaks in Georgia italic (every quoted passage,
   the rule quote). The ANNOTATOR and the interface speak in system-ui. The
   only third face is `ui-monospace` for chips and timestamps, always with
   `font-variant-numeric: tabular-nums`.
3. **The full stop.** Section headers take a terracotta trailing period via
   `::after` ("Timeline**.**"). h1/h2-level headers only.
4. **The chip** is the atomic identity unit: mono, tabular, accent-tinted
   pill, formats `0:14–1:02` (temporal) / `¶ 6` (text). It is the identical
   component in the panel, the feed, the permalink, and the OG card.
5. **Radii** 3px chips · 6px inputs/source cards · 8–10px cards · 99px
   buttons/pills. Borders 1px `--border`, separators `--hair`. **No shadows** —
   elevation is border + background shift. Muted warm palette only; no pure
   blues, no greens, no gradients.
6. **OG cards** are miniature permalinks: ink chrome bar, white module, the
   chip, the serif quote over the terracotta rule, and the 240p CLIP framing
   as visible spec compliance. Rendered server-side by the satori pipeline in
   `server/og-card.js`; fonts never ship to the browser.

## Standards ("crisp" is enforced, not aspired to)

- Motion: 120ms ease-out on hover/press; 60ms translateY(1px) on `:active`;
  `prefers-reduced-motion` is respected. Nothing animates that is not
  responding to the user.
- Focus: `:focus-visible` 2px accent ring, offset 2, on every interactive
  element. Full keyboard path: tab through the panel; I/O set marks;
  Cmd/Ctrl+Enter publishes; Esc clears the selection.
- States are shipped, not implied: skeleton rows for feed loads, inline error
  on unresolvable sources, disabled-with-reason on Publish, recording state,
  publish success toast with the permalink, claim-filed confirmation. Every
  fetch has a loading, empty, error, and success rendering.
- Targets ≥ 40px in the panel. Text ≥ 12.5px. `--meta` on white ≥ 4.5:1.
  Empty states name the next action.
- Copy: sentence case, active voice, the interface never apologizes. Buttons
  say what happens: "Publish", "File a claim", "Open original at 0:14".

## Surfaces

- **Chrome side panel** (`extension/`) is the primary surface: ink header,
  pinned capture widget (live source strip → marks or passage → note →
  publish), then the in-panel timeline with Recent · Following · This page.
- **Web timeline** (`/`): 600px feed + 300px rail; annotation-first posts with
  the embedded source card (quote-tweet grammar); bylines carry the verb
  ("annotated a video").
- **Permalink** (`/a/:slug`) is the judged surface: byline → note → hosted
  240p clip with CLIP tag and duration badge → source strip with the chip and
  "Open original at 0:14 ↗" → serif pull-quote → action bar with
  Open original · Respond · Share · **File a claim** always above the fold →
  responses.
- **Capture** (`/capture`): the paste-a-URL fallback for step 02 — one card,
  URL + Resolve, polymorphic selection row, note, Publish.
- **Library** (`/library`): signed-in list of published annotations with
  per-annotation stats (opens of the original), the local draft, and a
  share-library card.
