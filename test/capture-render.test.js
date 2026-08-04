import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

test('source tabs preserve mounted capture regions and only update stateful content', () => {
  const setSource = source.match(/const setSource = \(type\) => \{[\s\S]*?\n\};/u)?.[0] || '';
  assert.match(setSource, /renderCapture\(\);/u);
  assert.doesNotMatch(setSource, /\n\s*render\(\);/u);

  const renderCapture = source.match(/const renderCapture = \(\) => \{[\s\S]*?\n\};/u)?.[0] || '';
  assert.match(renderCapture, /querySelectorAll\('\[data-source-canvas\]'\)/u);
  assert.match(renderCapture, /canvas\.hidden = canvas\.dataset\.sourceCanvas !== state\.sourceType/u);
  assert.match(renderCapture, /clipEditor\.hidden = state\.sourceType === 'article'/u);
  assert.match(renderCapture, /highlightPreview\.hidden = state\.sourceType !== 'article'/u);
  assert.doesNotMatch(renderCapture, /replaceWith|innerHTML = sourceCanvasMarkup/u);
});

test('all source previews and both range modes mount once for paint continuity', () => {
  const sourceCanvasMarkup = source.match(/const sourceCanvasMarkup = \(\) => [^;]+;/u)?.[0] || '';
  assert.match(sourceCanvasMarkup, /videoCanvas\(\)/u);
  assert.match(sourceCanvasMarkup, /articleCanvas\(\)/u);
  assert.match(sourceCanvasMarkup, /podcastCanvas\(\)/u);

  const timeRange = source.match(/const timeRange = \(\) => \{[\s\S]*?\n\};/u)?.[0] || '';
  assert.match(timeRange, /class="clip-editor"/u);
  assert.match(timeRange, /class="highlight-preview"/u);
});
