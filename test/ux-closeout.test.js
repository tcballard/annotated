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

test('capture does not render a mock browser or fake media player', () => {
  assert.doesNotMatch(mainSource, /browser-chrome|media-canvas|preview-unavailable/u);
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
  assert.match(mainSource, /Build your public library/u);
  assert.match(mainSource, /Capture now\. Sign in with X when you are ready/u);
  assert.doesNotMatch(mainSource, />LOCAL</u);
  assert.match(mainSource, /state\.activeView === 'published' && !state\.user/u);
});

test('the chrome and capture form keep practical mobile targets', () => {
  assert.match(mainSource, /class="chrome-search"/u);
  assert.match(mainSource, /class="tabstrip"/u);
  assert.match(styles, /\.nav-link/u);
  assert.match(styles, /\.tabstrip/u);
});

test('clip timer presents a full-duration scrubber with mm:ss fields', () => {
  assert.match(mainSource, /class="moment-track"/u);
  assert.match(mainSource, /class="ticks"/u);
  assert.match(mainSource, /class="moment-fields"/u);
  assert.match(mainSource, /data-range-duration/u);
  assert.match(mainSource, /type="range"[^>]*data-action="clip-start"/u);
  assert.match(mainSource, /type="range"[^>]*data-action="clip-end"/u);
  assert.match(mainSource, /data-action="clip-start-time"/u);
  assert.match(mainSource, /data-action="clip-end-time"/u);
  assert.match(styles, /\.moment-track/u);
});
