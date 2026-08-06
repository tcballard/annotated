import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { sharedUrlFromParams } from '../src/share-capture.js';

const manifest = JSON.parse(await readFile(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
const serviceWorker = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
const shell = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const server = await readFile(new URL('../server/index.js', import.meta.url), 'utf8');

test('the manifest is installable and registers the share target on /capture', () => {
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.theme_color, '#33383F');
  assert.equal(manifest.background_color, '#F5F4F0');
  assert.equal(manifest.share_target.action, '/capture');
  assert.equal(manifest.share_target.method, 'GET');
  assert.deepEqual(manifest.share_target.params, { url: 'url', text: 'text', title: 'title' });
  assert.equal(manifest.icons.length, 3);
  assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable'));
});

test('the PWA icons are committed real PNGs', async () => {
  for (const icon of manifest.icons) {
    const bytes = await readFile(new URL(`../public${icon.src}`, import.meta.url));
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${icon.src} must be a PNG`);
  }
});

test('the service worker stays out of the way of media, API, and OG requests', () => {
  assert.match(serviceWorker, /request\.mode !== 'navigate'\) return;/);
  assert.match(serviceWorker, /caches\.match\('\/'\)/);
});

test('the shell links the manifest and the app registers the worker', () => {
  assert.match(shell, /<link rel="manifest" href="\/manifest\.webmanifest" \/>/);
  assert.match(shell, /apple-mobile-web-app-title/);
  assert.match(main, /navigator\.serviceWorker\.register\('\/sw\.js'\)/);
  assert.match(main, /sharedUrlFromParams\(new URLSearchParams\(window\.location\.search\)\)/);
  assert.match(main, /data-action="paste-link"/);
  assert.match(server, /'\.webmanifest': 'application\/manifest\+json'/);
});

test('shared launches surface the URL wherever the sheet put it', () => {
  const from = (entries) => sharedUrlFromParams(new URLSearchParams(entries));
  assert.equal(from([['url', 'https://example.com/story']]), 'https://example.com/story');
  assert.equal(from([['text', 'Check this out https://paulgraham.com/ds.html!']]), 'https://paulgraham.com/ds.html');
  assert.equal(from([['title', 'Via https://en.wikipedia.org/wiki/Marginalia.']]), 'https://en.wikipedia.org/wiki/Marginalia');
  assert.equal(from([['url', 'not a link'], ['text', 'also nothing']]), null);
  assert.equal(from([['text', 'two https://a.example/one and https://b.example/two']]), 'https://a.example/one');
});
