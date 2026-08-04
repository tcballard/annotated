import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

test('source tabs retain their real resolver and use the single-form capture layout', () => {
  const setSource = source.match(/const setSource = \(type\) => \{[\s\S]*?\n\};/u)?.[0] || '';
  assert.match(setSource, /renderCapture\(\);/u);
  assert.match(source, /class="module capture-module"/u);
  assert.match(source, /class="tabstrip"/u);
  assert.match(source, /data-action="load-source"/u);
  assert.match(source, /class="srcprev"/u);
  assert.doesNotMatch(source, /browser-chrome|STEP 01|01 \/ 03/u);
});

test('capture retains native range accessibility while exposing mm:ss inputs', () => {
  const timeRange = source.match(/const timeRange = \(\) => \{[\s\S]*?\n\};/u)?.[0] || '';
  assert.match(timeRange, /class="clip-editor"/u);
  assert.match(timeRange, /class="highlight-preview"/u);
  assert.match(timeRange, /class="moment-track"/u);
  assert.match(timeRange, /data-action="clip-start-time"/u);
  assert.match(timeRange, /data-action="clip-end-time"/u);
  assert.doesNotMatch(timeRange, /type="number"/u);
  assert.match(source, /const parseTime/u);
});
