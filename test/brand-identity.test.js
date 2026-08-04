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
  assert.match(index, /\/brand\/favicon\.svg/);
  assert.match(index, /\/brand\/favicon-16\.png/);
  assert.match(main, /src="\/brand\/app-icon-light-128\.png"/);
  assert.match(main, /class="empty-symbol" src="\/brand\/app-icon-light-128\.png"/);
  assert.match(panel, /src="icons\/icon-128\.png"/);
});

test('repository entry-point assets are byte-identical to the approved kit', async () => {
  const pairs = [
    ['assets/brand/annotated-brand-kit/favicon/favicon.svg', 'public/brand/favicon.svg'],
    ['assets/brand/annotated-brand-kit/favicon/favicon-16.png', 'public/brand/favicon-16.png'],
    ['assets/brand/annotated-brand-kit/png/app-icon/app-icon-light-128.png', 'public/brand/app-icon-light-128.png'],
    ['assets/brand/annotated-brand-kit/chrome-extension/icons/icon-128.png', 'extension/icons/icon-128.png'],
    ['assets/brand/annotated-brand-kit/chrome-web-store/promo-440x280.png', 'store-assets/promo-440x280.png'],
  ];
  for (const [source, destination] of pairs) {
    assert.deepEqual(await readFile(new URL(`../${destination}`, import.meta.url)), await readFile(new URL(`../${source}`, import.meta.url)));
  }
});
