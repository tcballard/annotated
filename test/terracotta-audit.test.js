import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Identity law §1.1: terracotta means THE MOMENT. The accent may appear only
// on moment chips, the live source dot, mark-selection state, the CLIP tag,
// active-tab underlines, the primary "Open original" action, the pull-quote
// rule, section-header full stops, the claim hover (mockup), and the logo
// dot. Never on generic buttons, links, alerts, focus rings, or decoration —
// focus is navigation, not a moment, so its ring is ink.

// The whole terracotta ramp is the accent, not just the base swatch:
// --accent-soft is its wash and --accent-ink is the contrast-safe text tone
// (#8F5039 light / #E0A48E dark). A literal hex is the same paint as the
// token, so the audit reads both spellings — otherwise a hardcoded #E0A48E
// sails straight through a law written about var(--accent).
const ACCENT_PATTERN = /var\(--accent(?:-soft|-ink)?\)|#B0674D|#8F5039|#E0A48E/i;

const ALLOWED_SELECTORS = [
  /^:root$/,
  /\.chip\b/,
  /\.livedot\b/,
  // The clip band's selection fill and live tail ARE the mark-selection
  // state — the same clause of law 1 that covered the old set-mark time
  // readouts. The playhead stays ink (navigation), the rail stays hair.
  /\.band-(sel|tail)$/,
  /\.cliptag\b/,
  /\.tab\.is-active::after$/,
  /\.nav-link\.is-active$/,
  /\.act\.primary(?::hover)?$/,
  /\.act\.claim:hover$/,
  /\.srcstrip \.open$/, // "Open original at 0:14 ↗" — the primary open action

  /::after$/, // section-header full stops (h1/h2-level only)
  /\.pull$/,  // the pull-quote's terracotta rule
  /\.bell \.n$/, // the unseen-notifications dot — new activity IS a moment
  /\.notif-digest \.n$/, // the panel's digest count — same law, same moment
  /\.pub-check \.(ring|tick)$/, // the publish celebration — publishing IS the moment
  /\.pub-moment \.dot$/, // its full stop
  // keyframe stops carry accent values only on behalf of animations that are
  // themselves applied via whitelisted selectors (mark-flash on .just-set,
  // the publish wash) — the accent still lands only where the law allows
  // A live selection arms the grabber — the terracotta rule on its left
  // edge is the mark-selection state, the same clause that covers the
  // clip band's fill. The armed field's BORDER stays the shared hairline.
  /\.grabber\.is-armed(?::hover)?$/,
  /^(from|to|\d+%)$/,
];

const auditStylesheet = (rawCss, file) => {
  const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, '');
  const violations = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const body = match[2];
    if (!ACCENT_PATTERN.test(body)) continue;
    const selectors = match[1].split(',').map((selector) => selector.trim().split('\n').pop().trim()).filter(Boolean);
    for (const selector of selectors) {
      if (selector.startsWith('@')) continue;
      if (!ALLOWED_SELECTORS.some((allowed) => allowed.test(selector))) {
        violations.push(`${file}: "${selector}" uses the accent`);
      }
    }
  }
  return violations;
};

test('terracotta appears only on the moment, on every surface', async () => {
  const [web, panel] = await Promise.all([
    readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
    readFile(new URL('../extension/sidepanel.css', import.meta.url), 'utf8'),
  ]);
  const violations = [...auditStylesheet(web, 'src/styles.css'), ...auditStylesheet(panel, 'extension/sidepanel.css')];
  assert.deepEqual(violations, [], `Accent used outside §1.1 locations:\n${violations.join('\n')}`);
});

test('the accent is the one true terracotta and the logo dot is its tint', async () => {
  for (const file of ['../src/styles.css', '../extension/sidepanel.css']) {
    const css = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.match(css, /--accent: #B0674D/);
    // no stray oranges or reds from earlier design systems
    assert.doesNotMatch(css, /#fa6336|#e85d3d|#d84c27/i);
  }
});

// #B0674D is the moment's colour, not a legible one: as chip text it measures
// 3.81:1 on paper and 2.37:1 on the dark card — both below AA for the small,
// uppercase, letter-spaced type it is set in. --accent-ink is the same hue
// darkened (light) and lightened (dark) until it passes: 5.52:1 and 4.77:1.
// Both surfaces must carry both stops, or the identity chip silently regresses
// on whichever one gets edited alone.
test('the accent has a contrast-safe ink stop on both surfaces', async () => {
  for (const file of ['../src/styles.css', '../extension/sidepanel.css']) {
    const css = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.match(css, /--accent-ink: #8F5039/, `${file} is missing the light accent-ink stop`);
    assert.match(css, /--accent-ink: #E0A48E/, `${file} is missing the dark accent-ink stop`);
    // and the chip — the identity component, on every surface — must use it
    const chip = css.match(/(^|\n)\.chip\s*\{[^}]*\}/)?.[0] || '';
    assert.match(chip, /color: var\(--accent-ink\)/, `${file}: .chip must use --accent-ink, not --accent`);
  }
});
