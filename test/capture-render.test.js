import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

test('source tabs update capture regions without replacing the app shell', () => {
  const setSource = source.match(/const setSource = \(type\) => \{[\s\S]*?\n\};/u)?.[0] || '';
  assert.match(setSource, /renderCapture\(\);/u);
  assert.doesNotMatch(setSource, /\n\s*render\(\);/u);

  const renderCapture = source.match(/const renderCapture = \(\) => \{[\s\S]*?\n\};/u)?.[0] || '';
  assert.match(renderCapture, /browser\.replaceWith\(nextBrowser\)/u);
  assert.match(renderCapture, /browserPage\.innerHTML = sourceCanvasMarkup\(\)/u);
  assert.match(renderCapture, /currentRange\.replaceWith\(nextRange\)/u);
});
