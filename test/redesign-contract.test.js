import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [html, main, styles] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
]);

test('muted 2006 tokens stay flat, system-font-only, and light-only', () => {
  assert.match(styles, /--chrome: #5C6B87/u);
  assert.match(styles, /--paper: #F3F1EA/u);
  assert.match(styles, /--orange: #B0674D/u);
  assert.match(styles, /--sans: "Lucida Grande", "Lucida Sans Unicode", Tahoma, Verdana, sans-serif/u);
  assert.doesNotMatch(`${html}\n${styles}`, /fonts\.googleapis|fonts\.gstatic|@import\s+url/u);
  assert.doesNotMatch(styles, /(?:linear|radial|conic)-gradient/u);
  assert.doesNotMatch(styles, /border-radius\s*:\s*(?!0(?:\D|$))[^;]+/u);
  assert.doesNotMatch(styles, /box-shadow\s*:\s*(?!none(?:\D|$))[^;]+/u);
  assert.doesNotMatch(styles, /prefers-color-scheme\s*:\s*dark/u);
});

test('the responsive shell hides the workspace rail while preserving permalink provenance', () => {
  const mobile = styles.match(/@media \(max-width: 820px\) \{[\s\S]*?\n\}/u)?.[0] || '';
  assert.match(styles, /grid-template-columns: 160px minmax\(0, 1fr\)/u);
  assert.match(styles, /\.permalink-grid \{[^}]*grid-template-columns: minmax\(0, 1fr\) 220px/u);
  assert.match(mobile, /\.app-rail, \.leftnav \{ display: none; \}/u);
  assert.match(mobile, /\.permalink-grid \{ grid-template-columns: 1fr; \}/u);
});

test('timeline, capture, library, and permalink retain their route-specific contracts', () => {
  assert.match(main, /state\.user \? '<button data-action="feed-filter" data-following="true">Following<\/button>' : ''/u);
  assert.match(main, /class="module capture-module"/u);
  assert.match(main, /data-action="clip-start-time"/u);
  assert.match(main, /data-action="clip-end-time"/u);
  assert.doesNotMatch(main, /type="number"[^>]*data-action="clip-(?:start|end)/u);
  assert.match(main, /state\.activeView === 'published' && !state\.user/u);
  assert.match(main, /state\.activeView = 'permalink'/u);
  assert.match(main, /class="permalink-grid"/u);
  assert.match(main, /class="provenance-table"/u);
});
