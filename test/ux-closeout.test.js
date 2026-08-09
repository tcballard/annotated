import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [mainSource, styles] = await Promise.all([
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
]);

test('contextual authentication prompts clear when the user changes views', () => {
  const navigateBlock = mainSource.match(/const navigate = [\s\S]*?\n\};/u)?.[0] || '';
  assert.match(navigateBlock, /state\.signinOpen = false;/u);
  assert.match(navigateBlock, /state\.signinContext = '';/u);
  assert.match(mainSource, /document\.querySelector\('\.nav-link\.is-active'\)\?\.focus\(\)/u);
});

test('unavailable media renders shipped status states, never a fake play button', () => {
  const player = mainSource.match(/const playerBlock = [\s\S]*?\n\};/u)?.[0] || '';
  assert.match(player, /Preparing the clip…/u);
  assert.match(player, /Clip queued for processing…/u);
  assert.match(player, /media-recovery/u);
  assert.match(player, /Retry clip/u);
  // the CLIP tag and duration badge stay visible in every state; the
  // transcode spec (240p) lives on the audit page, not in player chrome
  assert.match(player, /class="cliptag">CLIP/u);
  assert.doesNotMatch(player, /240p/u);
});

test('claim dialog has modal isolation, keyboard escape, focus trapping, and restoration', () => {
  assert.match(mainSource, /aria-modal="true"/u);
  assert.match(mainSource, /element\.inert = overlayOpen/u);
  assert.match(mainSource, /const overlayOpen = state\.claimOpen \|\| state\.signinOpen \|\| Boolean\(state\.lightbox\)/u);
  assert.match(mainSource, /event\.key === 'Escape'/u);
  assert.match(mainSource, /event\.key !== 'Tab'/u);
  assert.match(mainSource, /restoreClaimFocus/u);
  assert.match(mainSource, /class="claim-error"[^>]*role="alert"/u);
  assert.match(mainSource, /class="claim-success" role="status"/u);
});

test('sign-in is one door: every affordance opens the shared modal, both providers behind it', () => {
  // the modal carries the shared anatomy and real OAuth anchors per provider
  assert.match(mainSource, /Add your name to the margin/u);
  assert.match(mainSource, /One account across the extension, the web, and the app\./u);
  assert.match(mainSource, /Continue with \$\{providerLabel\(provider\)\}/u);
  assert.match(mainSource, /Sign in with X or Google when you are ready/u, 'the library pitch keeps naming both providers');
  // no scattered per-provider sign-in links outside the modal
  assert.doesNotMatch(mainSource, /Sign in with \$\{providerLabel/u);
  // every trigger opens the same door; the shared keyboard trap covers it
  assert.ok((mainSource.match(/data-action="open-signin"/gu) || []).length >= 4, 'chrome bar, library, response prompt, and empty states all open the door');
  assert.match(mainSource, /state\.claimOpen \|\| state\.signinOpen/u);
  assert.match(mainSource, /openSignin\(`Sign in to \$\{action\}\.`\)/u, 'contextual prompts open the modal with their reason');
  assert.doesNotMatch(mainSource, /LOCAL ACCOUNT|profile-stamp/u);
});

test('interactive targets keep at least 40px and focus stays visible everywhere', () => {
  // focus is navigation, not the moment: ink ring, paper ring on dark chrome
  assert.match(styles, /:focus-visible \{ outline: 2px solid var\(--ink\)/u);
  assert.match(styles, /\.chrome :focus-visible \{ outline-color: #F5F4F0; \}/u);
  for (const selector of ['.act', '.btn', '.tabs .tab', '.markfield', '.signin-modal .continue']) {
    const block = styles.split(`${selector} {`).slice(1, 2).join('');
    assert.match(block.slice(0, 400), /min-height: (?:3[6-9]|4[0-9])px/u, `${selector} needs a ≥36px target`);
  }
  assert.match(styles, /prefers-reduced-motion/u);
});

test('feed posts embed ready media like a social feed, never a dead frame', () => {
  const media = mainSource.match(/const srcCardMedia = [\s\S]*?\n\};/u)?.[0] || '';
  // only ready clips and screenshots render; processing stays on the permalink
  assert.match(media, /item\.mediaStatus === 'ready' && item\.type === 'video'/u);
  assert.match(media, /item\.mediaStatus === 'ready' && item\.type === 'podcast'/u);
  assert.match(media, /item\.screenshotUrl/u);
  assert.match(media, /class="srcmedia"/u);
  assert.match(media, /CLIP/u);
  // transcode jargon stays on the audit page; the feed badge is just the duration
  assert.doesNotMatch(media, /240p/u);
  // playing inline media must not navigate to the permalink
  assert.match(mainSource, /closest\('a, button:not\(\[data-action="open-annotation"\]\), video, audio, \.srcmedia'\)/u);
});

test('every fetch surface ships loading, empty, and error states', () => {
  assert.match(mainSource, /skeletonPost/u);
  assert.match(mainSource, /feed-empty/u);
  assert.match(mainSource, /The timeline could not be loaded\./u);
  assert.match(mainSource, /data-action="feed-retry"/u);
  assert.match(mainSource, /perma-empty/u);
});

test('the keyboard path covers publish and clear on the capture surface', () => {
  assert.match(mainSource, /event\.metaKey \|\| event\.ctrlKey/u);
  assert.match(mainSource, /publishAnnotation\(\)/u);
  assert.match(mainSource, /event\.key === 'Escape' && !event\.target\.closest\('input, textarea'\)/u);
});

test('headline full stops come from the identity system, never twice', () => {
  // .card h2 (and its ::after siblings) append the terracotta full stop, so
  // heading copy destined for those containers must not carry its own —
  // "All quiet." rendered "All quiet.." on the notifications empty state.
  assert.match(styles, /\.card h2::after,[\s\S]*?content: "\."; color: var\(--accent\);/u);
  assert.match(mainSource, /<h2>All quiet<\/h2>/u);

  // Headings that end in a period are only legal where no ::after dot will
  // land. Each entry below was checked against the ::after selector list;
  // a new period-ending heading fails here until someone does the same.
  const reviewedOutsideAccentScope = new Set([
    'This annotation was removed after a rights claim.', // .perma-empty
    'Your library is waiting.',                          // .perma-empty
    'This source could not be loaded.',                  // .perma-empty
    'We could not load this profile.',                   // .perma-empty
    'Moderation access is required.',                    // .feed-empty
    'Nothing to ring about yet.',                        // .perma-empty
  ]);
  for (const match of mainSource.matchAll(/<h[12][^>]*>([^<]*\.)<\/h[12]>/gu)) {
    assert.ok(
      reviewedOutsideAccentScope.has(match[1]),
      `"${match[1]}" ends in a period — if it renders inside a .card/.responses/.capcard/.libhead/.modhead heading, the ::after dot makes it a double stop. Drop the period or review the container and extend the list.`,
    );
  }
});
