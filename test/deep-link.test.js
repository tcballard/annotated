import assert from 'node:assert/strict';
import test from 'node:test';
import { articleFragmentUrl, mediaTimestampUrl, openOriginalHref, openOriginalLabel, textFragment } from '../src/deep-link.js';

test('media deep links land on the marked moment', () => {
  assert.equal(mediaTimestampUrl('https://www.youtube.com/watch?v=abc', 14), 'https://www.youtube.com/watch?v=abc&t=14s');
  assert.equal(mediaTimestampUrl('https://youtu.be/abc', 74), 'https://youtu.be/abc?t=74');
  assert.equal(mediaTimestampUrl('https://example.com/episode.mp3', 30), 'https://example.com/episode.mp3#t=30');
  assert.equal(mediaTimestampUrl('https://example.com/talk', 0), 'https://example.com/talk');
});

test('article deep links use W3C text fragments with dash escaping', () => {
  const short = textFragment('Metadata stays attached to the original link.');
  assert.equal(short, `#:~:text=${encodeURIComponent('Metadata stays attached to the original link.')}`);
  assert.match(textFragment('self-driving futures'), /%2Ddriving/);
  const long = textFragment('a'.repeat(60) + ' middle words that get elided entirely from the fragment ' + 'z'.repeat(60));
  assert.match(long, /,/, 'long passages use the textStart,textEnd form');
  const anchored = textFragment('the exact passage', { prefix: 'before it', suffix: 'after it' });
  assert.match(anchored, /^#:~:text=before%20it-,the%20exact%20passage,-after%20it$/);
  assert.equal(articleFragmentUrl('https://example.com/a#old-hash', 'passage'), 'https://example.com/a#:~:text=passage');
});

test('open-original labels name the exact moment', () => {
  assert.equal(openOriginalLabel({ type: 'video', clipStart: 74 }), 'Open original at 1:14');
  assert.equal(openOriginalLabel({ type: 'article', anchorParagraph: 6 }), 'Open original at ¶ 6');
  assert.equal(openOriginalLabel({ type: 'article' }), 'Open original');
  const href = openOriginalHref({ type: 'video', sourceUrl: 'https://www.youtube.com/watch?v=abc', clipStart: 14 });
  assert.match(href, /t=14s/);
});
