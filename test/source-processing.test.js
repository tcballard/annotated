import assert from 'node:assert/strict';
import test from 'node:test';
import { classifySource, parseSourceUrl, resolveSource } from '../server/source-resolver.js';
import { resolveInput } from '../server/media-worker.js';
import { matchesFeedQuery, normalizeFeedQuery } from '../server/feed.js';

test('source classification covers the three brief source categories', () => {
  assert.equal(classifySource('https://www.youtube.com/watch?v=abc'), 'video');
  assert.equal(classifySource('https://podcasts.example/show/episode'), 'podcast');
  assert.equal(classifySource('https://news.example/story'), 'article');
});

test('source parsing blocks private hosts and non-web schemes', () => {
  assert.throws(() => parseSourceUrl('http://169.254.169.254/latest/meta-data'), /not allowed/);
  assert.throws(() => parseSourceUrl('http://[::1]/metadata'), /not allowed/);
  assert.throws(() => parseSourceUrl('file:///tmp/article'), /Only http and https/);
});

test('article resolution is bounded and preserves the page canonical URL', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => Buffer.from('<html><head><title>Example</title><link rel="canonical" href="https://news.example/canonical"></head><body><article><p>This is a sufficiently long article passage that should be extracted as bounded source context for the annotation landing page.</p></article></body></html>'),
  });
  try {
    const source = await resolveSource('https://news.example/story?utm_source=test');
    assert.equal(source.sourceType, 'article');
    assert.equal(source.canonicalUrl, 'https://news.example/canonical');
    assert.match(source.excerpt, /sufficiently long article passage/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('direct media worker inputs remain SSRF-safe', async () => {
  assert.equal(await resolveInput({ sourceUrl: 'https://cdn.example/audio.mp3', sourceType: 'podcast' }), 'https://cdn.example/audio.mp3');
  await assert.rejects(() => resolveInput({ sourceUrl: 'http://127.0.0.1/audio.mp3', sourceType: 'podcast' }), /not allowed/);
});

test('feed search matches source and author context with a bounded query', () => {
  const annotation = { sourceTitle: 'A useful essay', sourceHost: 'news.example', sourceExcerpt: 'Context travels with the moment.', commentary: 'Keep the source attached.', authorId: 'u1' };
  const users = [{ id: 'u1', handle: 'reader', displayName: 'A. Reader' }];
  assert.equal(matchesFeedQuery(annotation, users, '  CONTEXT  '), true);
  assert.equal(matchesFeedQuery(annotation, users, 'reader'), true);
  assert.equal(matchesFeedQuery(annotation, users, 'unrelated'), false);
  assert.equal(normalizeFeedQuery('  one   two '), 'one two');
  assert.equal(normalizeFeedQuery('x'.repeat(100)).length, 80);
});
