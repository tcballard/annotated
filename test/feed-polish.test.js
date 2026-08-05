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
