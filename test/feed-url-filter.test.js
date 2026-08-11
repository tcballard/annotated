import assert from 'node:assert/strict';
import test from 'node:test';
import { matchesFeedUrl, normalizeSourceUrlKey } from '../server/feed.js';

test('the This page filter matches URLs regardless of hash, www, and trailing slash', () => {
  const key = normalizeSourceUrlKey('https://www.youtube.com/watch?v=abc#t=14');
  assert.equal(key, 'youtube.com/watch?v=abc');
  assert.equal(normalizeSourceUrlKey('https://youtube.com/watch?v=abc'), key);
  assert.equal(normalizeSourceUrlKey('https://example.com/post/'), normalizeSourceUrlKey('https://example.com/post'));
  assert.equal(normalizeSourceUrlKey('not a url'), '');
  assert.equal(normalizeSourceUrlKey('ftp://example.com/x'), '');
});

test('paths and query values keep their case — only the host folds', () => {
  // Video IDs and wiki titles are case-sensitive; folding them collided
  // nothing in dev (JS on both sides) while the SQL twin folded everything,
  // which permanently emptied This page on PostgreSQL deployments.
  assert.equal(normalizeSourceUrlKey('https://EN.Wikipedia.org/wiki/Web_annotation'), 'en.wikipedia.org/wiki/Web_annotation');
  assert.equal(normalizeSourceUrlKey('https://youtube.com/watch?v=dQw4w9WgXcQ'), 'youtube.com/watch?v=dQw4w9WgXcQ');
});

test('tracking and position params carry no identity; structural params do', () => {
  const bare = normalizeSourceUrlKey('https://example.com/story');
  assert.equal(normalizeSourceUrlKey('https://example.com/story?utm_source=x&utm_campaign=launch'), bare);
  assert.equal(normalizeSourceUrlKey('https://example.com/story?fbclid=abc123'), bare);
  const video = normalizeSourceUrlKey('https://youtube.com/watch?v=abc');
  assert.equal(normalizeSourceUrlKey('https://youtube.com/watch?v=abc&t=304&si=share-junk'), video, 'a timestamped share is the same video');
  assert.notEqual(normalizeSourceUrlKey('https://youtube.com/watch?v=other'), video, '?v= is the identity and survives');
  assert.equal(normalizeSourceUrlKey('https://example.com/search?s=maker+schedule'), 'example.com/search?s=maker+schedule', 'bare ?s= (WordPress search) is not a tracker');
});

test('annotations match by source or canonical URL, and no key matches everything', () => {
  const annotation = { sourceUrl: 'https://www.youtube.com/watch?v=abc', canonicalUrl: 'https://youtu.be/abc' };
  assert.equal(matchesFeedUrl(annotation, normalizeSourceUrlKey('https://youtube.com/watch?v=abc')), true);
  assert.equal(matchesFeedUrl(annotation, normalizeSourceUrlKey('https://youtu.be/abc')), true);
  assert.equal(matchesFeedUrl(annotation, normalizeSourceUrlKey('https://example.com/other')), false);
  assert.equal(matchesFeedUrl(annotation, ''), true);
});
