import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('the wordmark leads the web while the supplied mark owns compact entry points', async () => {
  const [index, main, styles, wordmarkPrimary, wordmarkInverse, panelHtml, panelRuntime] = await Promise.all([
    read('index.html'),
    read('src/main.js'),
    read('src/styles.css'),
    read('public/brand/logo-primary.svg'),
    read('public/brand/logo-inverse.svg'),
    read('extension/sidepanel.html'),
    read('extension/sidepanel.js'),
  ]);
  assert.match(index, /\/brand\/favicon\.svg/);
  assert.match(index, /\/brand\/favicon-16\.png/);
  assert.match(main, /class="logo"[\s\S]*src="\/brand\/logo-inverse\.svg"/);
  assert.match(styles, /\.chrome \.logo img[\s\S]*width: 88px/);
  assert.match(wordmarkPrimary, />annotated<tspan[^>]*>\.<\/tspan><\/text>/);
  assert.match(wordmarkPrimary, /fill="#26292F"/);
  assert.match(wordmarkInverse, /fill="#FFFFFF"/);
  assert.match(wordmarkInverse, /fill="#E0A48E"/);
  assert.match(main, /src="\/brand\/app-icon-light-128\.png"/);
  assert.match(main, /class="empty-symbol" src="\/brand\/app-icon-light-128\.png"/);
  // Chrome's side-panel bar shows the icon and product name above the panel,
  // so the panel itself carries the mark only in its timeline empty states.
  assert.match(panelRuntime, /src="icons\/icon-128\.png"/);
  assert.doesNotMatch(panelHtml, /class="logo"/);
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
