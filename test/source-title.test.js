import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { cleanSourceTitle } from '../src/source-title.js';

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');

test('a tab title is cleaned down to the work it names', () => {
  // the real broken share: YouTube's notification counter kept as the title
  assert.equal(cleanSourceTitle('(47) YouTube'), 'YouTube');
  assert.equal(cleanSourceTitle('[3] Inbox'), 'Inbox');
  // counters stack when tabs sit unread; every layer goes
  assert.equal(cleanSourceTitle('(2) (14) How Rockets Land - YouTube'), 'How Rockets Land');
  // known site suffixes are tab dressing, whatever the dash flavour
  assert.equal(cleanSourceTitle('How Rockets Land - YouTube'), 'How Rockets Land');
  assert.equal(cleanSourceTitle('Deep Work, Explained – YouTube'), 'Deep Work, Explained');
  assert.equal(cleanSourceTitle('Why We Sleep | YouTube'), 'Why We Sleep');
  // whitespace collapses to single spaces
  assert.equal(cleanSourceTitle('  The   future \n of work  '), 'The future of work');
});

test('cleaning is narrow: real titles pass through untouched', () => {
  // a title that merely mentions the counter shape mid-string is left alone
  assert.equal(cleanSourceTitle('The (47) problem in statistics'), 'The (47) problem in statistics');
  // dashes and pipes that are part of the title survive — only known site
  // suffixes are dressing
  assert.equal(cleanSourceTitle('Notion – the all-in-one workspace'), 'Notion – the all-in-one workspace');
  assert.equal(cleanSourceTitle('Work | Life | Balance'), 'Work | Life | Balance');
  // stripping the suffix must leave a real title behind, or it stays
  assert.equal(cleanSourceTitle('AB - YouTube'), 'AB - YouTube');
  // and nothing invents a title that was never there
  assert.equal(cleanSourceTitle('(2)'), '');
  assert.equal(cleanSourceTitle(null), '');
  assert.equal(cleanSourceTitle(undefined), '');
});

test('every surface cleans the title at its chokepoint', async () => {
  const [validation, ogCard, meta, server, feedItem, panel] = await Promise.all([
    read('server/validation.js'),
    read('server/og-card.js'),
    read('server/permalink-meta.js'),
    read('server/index.js'),
    read('packages/core/src/feed-item.ts'),
    read('extension/sidepanel.js'),
  ]);
  // publish: whatever surface captured it, the stored title is clean
  assert.match(validation, /sourceTitle: cleanSourceTitle\(input\.sourceTitle\)/, 'the validator cleans on the way in');
  // render: data stored before the cleaner existed is cleaned on the way out
  assert.match(ogCard, /cleanSourceTitle\(annotation\.sourceTitle\) \|\| annotation\.sourceHost/, 'the OG card never draws tab furniture');
  assert.match(meta, /cleanSourceTitle\(annotation\.sourceTitle\) \|\| annotation\.sourceHost/, 'the unfurl title is the work, not the tab');
  assert.match(server, /title: cleanSourceTitle\(annotation\.sourceTitle\)/, 'oEmbed names the work');
  assert.match(feedItem, /cleanSourceTitle\(annotation\.sourceTitle\) \|\| annotation\.sourceHost/, 'feed cards clean stored titles');
  assert.match(panel, /cleanSourceTitle\(annotation\.sourceTitle\) \|\| annotation\.sourceHost/, 'the panel timeline cleans stored titles');
  // capture: the panel cleans what it reads from the tab, live and on publish
  assert.match(panel, /cleanSourceTitle\(currentTab\.title\) \|\| 'Reading this tab…'/, 'the live header shows the cleaned title');
  assert.equal((panel.match(/sourceTitle: cleanSourceTitle\(currentTab\.title\)/g) || []).length, 2, 'both capture payloads send the cleaned title');
});
