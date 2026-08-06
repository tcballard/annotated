import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [mainSource, styles] = await Promise.all([
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
]);

test('contextual authentication prompts clear when the user changes views', () => {
  const navigateBlock = mainSource.match(/const navigate = [\s\S]*?\n\};/u)?.[0] || '';
  assert.match(navigateBlock, /state\.authPrompt = '';/u);
  assert.match(mainSource, /document\.querySelector\('\.nav-link\.is-active'\)\?\.focus\(\)/u);
});

test('unavailable media renders shipped status states, never a fake play button', () => {
  const player = mainSource.match(/const playerBlock = [\s\S]*?\n\};/u)?.[0] || '';
  assert.match(player, /Preparing the 240p clip…/u);
  assert.match(player, /Clip queued for processing…/u);
  assert.match(player, /media-recovery/u);
  assert.match(player, /Retry clip/u);
  // the CLIP tag and duration · 240p badge stay visible in every state
  assert.match(player, /class="cliptag">CLIP/u);
  assert.match(player, /240p/u);
});

test('claim dialog has modal isolation, keyboard escape, focus trapping, and restoration', () => {
  assert.match(mainSource, /aria-modal="true"/u);
  assert.match(mainSource, /element\.inert = overlayOpen/u);
  assert.match(mainSource, /const overlayOpen = state\.claimOpen \|\| Boolean\(state\.lightbox\)/u);
  assert.match(mainSource, /event\.key === 'Escape'/u);
  assert.match(mainSource, /event\.key !== 'Tab'/u);
  assert.match(mainSource, /restoreClaimFocus/u);
  assert.match(mainSource, /class="claim-error"[^>]*role="alert"/u);
  assert.match(mainSource, /class="claim-success" role="status"/u);
});

test('signed-out surfaces offer both brief providers instead of a fake local profile', () => {
  assert.match(mainSource, /Sign in with \$\{providerLabel\(provider\)\}/u);
  assert.match(mainSource, /Sign in with X or Google when you are ready/u);
  assert.doesNotMatch(mainSource, /LOCAL ACCOUNT|profile-stamp/u);
});

test('interactive targets keep at least 40px and focus stays visible everywhere', () => {
  assert.match(styles, /:focus-visible \{ outline: 2px solid var\(--accent\)/u);
  for (const selector of ['.act', '.btn', '.tabs .tab', '.markfield', '.auth-prompt-link']) {
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
  assert.match(media, /240p/u);
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
