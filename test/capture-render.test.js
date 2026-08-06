import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

// The v2 capture page is a single card: URL + Resolve, a polymorphic
// selection row, the note, and Publish. The old fake-browser preview canvas
// is gone for good — nothing on this surface pretends to be a player.

test('capture is resolve-first with a polymorphic selection row and no fake preview', () => {
  assert.match(source, /data-action="resolve-form"/u);
  assert.match(source, /publishBlocker/u);
  assert.match(source, /Resolve a source URL first\./u);
  // media types mark In/Out; articles carry a serif passage with the ¶ chip
  assert.match(source, /const marksRow = /u);
  assert.match(source, /const passageRow = /u);
  assert.match(source, /data-action="clip-in"/u);
  assert.match(source, /data-action="clip-out"/u);
  // the demo browser chrome and mounted preview canvases no longer exist
  assert.doesNotMatch(source, /browserChrome|videoCanvas|articleCanvas|podcastCanvas/u);
  assert.doesNotMatch(source, /class="browser-frame"/u);
});

test('mark fields update the duration chip and publish gate without a full re-render', () => {
  assert.match(source, /const refreshCaptureBits = /u);
  assert.match(source, /data-duration-chip/u);
  assert.match(source, /data-publish-hint/u);
  assert.match(source, /chipEl\.classList\.toggle\('is-over'/u);
  // typed times accept mm:ss or seconds, and invalid entries are reverted
  assert.match(source, /parseTimeInput/u);
  assert.match(source, /Times accept 1:02 or plain seconds\./u);
});

test('native range scrubbers are gone from every capture surface', () => {
  assert.doesNotMatch(source, /type="range"/u);
  const panel = fs.readFileSync(new URL('../extension/sidepanel.html', import.meta.url), 'utf8');
  assert.doesNotMatch(panel, /type="range"/u);
});
