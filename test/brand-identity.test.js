import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('the supplied mark is wired into the web and extension entry points', async () => {
  const [index, main, panel] = await Promise.all([
    read('index.html'),
    read('src/main.js'),
    read('extension/sidepanel.html'),
  ]);
  assert.match(index, /annotated-mark-32\.png/);
  assert.match(main, /src="\/brand\/annotated-mark-32\.png"/);
  assert.match(main, /class="empty-symbol" src="\/brand\/annotated-mark-32\.png"/);
  assert.match(panel, /src="icons\/icon-128\.png"/);
});
