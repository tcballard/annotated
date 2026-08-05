import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
const panel = await readFile(new URL('../extension/sidepanel.js', import.meta.url), 'utf8');
const panelCss = await readFile(new URL('../extension/sidepanel.css', import.meta.url), 'utf8');

test('publishing gets its moment: the check draws over the already-loaded permalink', () => {
  assert.match(main, /state\.publishMoment = \{ title:/);
  assert.match(main, /publishMomentTimer = setTimeout\(dismissPublishMoment, 1600\)/, 'it gets out of the way on its own');
  assert.match(main, /data-action="dismiss-publish-moment"/, 'a tap dismisses it early');
  assert.match(main, /prefers-reduced-motion: reduce/, 'reduced motion keeps the quiet toast');
  assert.match(main, /Published<span class="dot">\.<\/span>/);
  assert.match(css, /\.pub-check \.ring/);
  assert.match(css, /\.pub-check \.tick/);
  assert.match(css, /stroke-dashoffset: 233/, 'the ring draws itself');
});

test('the panel publish button confirms in place', () => {
  assert.match(panel, /publishButton\.classList\.add\('is-published'\)/);
  assert.match(panel, /pub-check-mini/);
  assert.match(panel, /publishButton\.textContent = 'Publish';\s*\n\s*\}, 1600\)/, 'and reverts');
  assert.match(panelCss, /\.pub-check-mini \{/);
});
