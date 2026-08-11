import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const panelJs = await readFile(new URL('../extension/sidepanel.js', import.meta.url), 'utf8');
const panelHtml = await readFile(new URL('../extension/sidepanel.html', import.meta.url), 'utf8');

// The margin sits NEXT TO the page it annotates. A row about the page you
// are on must act on that page — highlight the passage, play the clip —
// not open a duplicate tab; and a snip must say what it actually kept.

test('a same-page row jumps in place instead of opening a duplicate tab', () => {
  assert.match(panelJs, /matchesCurrentTab\(item\) && Number\.isInteger\(currentTabId\)/, 'the open handler must check whether the row is about the current tab');
  assert.match(panelJs, /void showOnPage\(item\);/, 'same-page articles highlight their passage in place');
  assert.match(panelJs, /void seekPageToClip\(item\);/, 'same-page media plays its clip on the page\'s own player');
  assert.match(panelJs, /func: previewRangeInPage,\s*\n\s*args: \[Number\(item\.clipStart\)/, 'the clip jump reuses the bay\'s seek-play-pause injection');
  assert.match(panelJs, /window\.open\(openOriginalHref\(item\), '_blank', 'noopener'\)/, 'pages that refuse injection keep the deep-linked tab');
  assert.match(panelJs, /'Show on this page' : openOriginalLabel\(item\)/, 'the action names the in-place behaviour');
});

test('the snip card says what was captured, and restored drafts keep their preview', () => {
  assert.match(panelJs, /screenshotKind = region \? 'snip' : 'tab';/, 'capture must record whether a region was drawn');
  assert.match(panelJs, /`\$\{Math\.round\(region\.w\)\}×\$\{Math\.round\(region\.h\)\}`/, 'a snip records its dimensions');
  assert.match(panelJs, /The region you drew/, 'the card names the drawn region');
  assert.match(panelJs, /'Full visible tab'/, 'the card names the full-tab fallback');
  assert.match(panelJs, /screenshotKind,\s*\n\s*screenshotDims,/, 'the draft persists what kind of screenshot it holds');
  assert.match(panelJs, /if \(screenshotAssetId && !screenshotPreviewUrl\) syncScreenshot\(\);/, 'a restored draft repaints its preview once the backend origin resolves');
  assert.match(panelHtml, /id="shotKindChip"/, 'the chip is addressable');
  assert.match(panelHtml, /id="shotLabel"/, 'the label is addressable');
});
