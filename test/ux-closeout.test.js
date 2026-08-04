import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [mainSource, styles] = await Promise.all([
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
]);

test('contextual authentication prompts clear when the user changes views', () => {
  const setView = mainSource.match(/if \(action === 'set-view'\) \{[\s\S]*?\n  \}/u)?.[0] || '';
  assert.match(setView, /state\.authPrompt = '';/u);
  assert.match(mainSource, /document\.querySelector\('\.nav-link\.is-active'\)\?\.focus\(\)/u);
});

test('unavailable capture and published media do not present fake play buttons', () => {
  const videoCanvas = mainSource.match(/const videoCanvas = \(\) => `[\s\S]*?`;/u)?.[0] || '';
  assert.match(videoCanvas, /class="preview-unavailable" role="status"/u);
  assert.doesNotMatch(videoCanvas, /data-action="toggle-preview"/u);
  assert.doesNotMatch(mainSource, /if \(action === 'toggle-preview'\)/u);
});

test('claim dialog has modal isolation, keyboard escape, focus trapping, and restoration', () => {
  assert.match(mainSource, /aria-modal="true"/u);
  assert.match(mainSource, /element\.inert = state\.claimOpen/u);
  assert.match(mainSource, /event\.key === 'Escape'/u);
  assert.match(mainSource, /event\.key !== 'Tab'/u);
  assert.match(mainSource, /restoreClaimFocus/u);
  assert.match(mainSource, /class="claim-error"[^>]*role="alert"/u);
  assert.match(mainSource, /class="claim-success" role="status"/u);
});

test('anonymous timeline copy does not masquerade as a local profile', () => {
  assert.match(mainSource, /class="aside-card profile-card signed-out-card"/u);
  assert.match(mainSource, /Build your public library\./u);
  assert.doesNotMatch(mainSource, /profile-stamp">\$\{state\.user \? 'SIGNED IN' : 'LOCAL'\}/u);
});

test('mobile capture compresses the preview and keeps primary targets at least 44px', () => {
  assert.match(mainSource, /class="mobile-source-summary"/u);
  assert.match(mainSource, /aria-expanded="\$\{state\.showMobileSourcePreview\}"/u);
  assert.match(styles, /\.browser-frame \{ display: none; \}/u);
  assert.match(styles, /\.browser-frame\.is-mobile-expanded \{ display: block; \}/u);
  assert.match(styles, /\.brand-mark \{ min-width: 44px; min-height: 44px; \}/u);
  assert.match(styles, /\.nav-link \{ min-width: 44px; min-height: 44px;/u);
});
