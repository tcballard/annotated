import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

test('feed screenshots enlarge in a lightbox with keyboard and inert handling', () => {
  assert.match(main, /data-action="open-lightbox"/);
  assert.match(main, /class="shot-open"/);
  assert.match(main, /Click to enlarge/);
  assert.match(main, /state\.lightbox && event\.key === 'Escape'/);
  assert.match(main, /state\.claimOpen \|\| Boolean\(state\.lightbox\)/, 'lightbox must inert the page behind it');
  assert.match(main, /class="lightbox-open"/, 'the lightbox keeps the original one click away');
  assert.match(css, /\.lightbox \{/);
  assert.match(css, /\.shot-open .shot-hint/);
});

test('audio notes carry their duration on the card', () => {
  assert.match(main, /audioDuration: Number\(annotation\.audioDuration\) \|\| 0/);
  assert.match(main, /srcaudio-time/);
  assert.match(main, /Audio note\$\{item\.audioDuration \? ` · \$\{escapeHTML\(formatTime\(item\.audioDuration\)\)\}` : ''\}/);
  assert.match(css, /\.srcaudio-time/);
});

test('the timeline offers Trending, and the rail sends readers to trending hubs', () => {
  assert.match(main, /data-sort="trending"[^>]*>Trending</);
  assert.match(main, /state\.feedSort === 'trending' && !state\.feedFollowing\) params\.set\('sort', 'trending'\)/);
  assert.match(main, /Trending sources<\/h2>/);
  assert.match(main, /data-action="open-hub" data-host="\$\{escapeHTML\(source\.host\)\}"/, 'trending rows are hub destinations');
  assert.match(main, /Nothing is trending yet\./);
  assert.match(css, /\.trend-row/);
});

test('hosted audio renders a seekable waveform from server peaks', () => {
  assert.match(main, /const waveform = \(peaks\)/);
  assert.match(main, /audioPeaks: Array\.isArray\(annotation\.audioPeaks\)/);
  assert.match(main, /clipPeaks: Array\.isArray\(annotation\.clipPeaks\)/);
  assert.match(main, /data-action="wave-seek"/);
  assert.match(main, /addEventListener\('timeupdate'/, 'progress paints without re-render');
  assert.match(main, /audio\.currentTime = ratio \* audio\.duration/);
  assert.match(css, /\.wave-played span \{ background: var\(--ink-soft\); \}/, 'played fill stays ink — terracotta is not for chrome');
});
