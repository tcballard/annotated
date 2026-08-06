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

test('annotations match by source or canonical URL, and no key matches everything', () => {
  const annotation = { sourceUrl: 'https://www.youtube.com/watch?v=abc', canonicalUrl: 'https://youtu.be/abc' };
  assert.equal(matchesFeedUrl(annotation, normalizeSourceUrlKey('https://youtube.com/watch?v=abc')), true);
  assert.equal(matchesFeedUrl(annotation, normalizeSourceUrlKey('https://youtu.be/abc')), true);
  assert.equal(matchesFeedUrl(annotation, normalizeSourceUrlKey('https://example.com/other')), false);
  assert.equal(matchesFeedUrl(annotation, ''), true);
});
