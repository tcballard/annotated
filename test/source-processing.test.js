import assert from 'node:assert/strict';
import test from 'node:test';
import { classifySource, parseSourceUrl, resolveSource } from '../server/source-resolver.js';
import { resolveInput, validatePlayableInput } from '../server/media-worker.js';
import { followingFeedRequiresAuth, matchesFeedQuery, normalizeFeedCursor, normalizeFeedLimit, normalizeFeedQuery } from '../server/feed.js';
import { findIdempotentAnnotation } from '../server/idempotency.js';
import { findActiveClaim, validateClaimTransition } from '../server/moderation.js';

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

test('source classification covers the three brief source categories', () => {
  assert.equal(classifySource('https://www.youtube.com/watch?v=abc'), 'video');
  assert.equal(classifySource('https://podcasts.example/show/episode'), 'podcast');
  assert.equal(classifySource('https://radio.example/feed.xml'), 'podcast');
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
    const source = await resolveSource('https://news.example/story?utm_source=test', { lookup: publicLookup });
    assert.equal(source.sourceType, 'article');
    assert.equal(source.canonicalUrl, 'https://news.example/canonical');
    assert.match(source.excerpt, /sufficiently long article passage/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('article metadata decodes HTML entities in titles, descriptions, excerpts, and canonical links', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => Buffer.from(`<html><head>
      <title>Reading &amp; noticing</title>
      <meta property="og:title" content="Reading &amp; noticing">
      <meta property="og:description" content="A &quot;useful&quot; note about attention.">
      <link rel="canonical" href="https://news.example/story?topic=craft&amp;view=full">
    </head><body><article><p>This passage contains a &amp; sign and a &quot;quoted&quot; phrase so the public annotation can preserve the original article context.</p></article></body></html>`),
  });
  try {
    const source = await resolveSource('https://news.example/story', { lookup: publicLookup });
    assert.equal(source.title, 'Reading & noticing');
    assert.equal(source.description, 'A "useful" note about attention.');
    assert.equal(source.canonicalUrl, 'https://news.example/story?topic=craft&view=full');
    assert.match(source.excerpt, /contains a & sign and a "quoted" phrase/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('article resolution falls back to the submitted URL when no canonical tag exists', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => Buffer.from('<html><head><title>Example Domain</title></head><body><main><p>This page has no canonical link, so the submitted URL remains the source citation.</p></main></body></html>'),
  });
  try {
    const source = await resolveSource('https://news.example/story', { lookup: publicLookup });
    assert.equal(source.canonicalUrl, 'https://news.example/story');
    assert.equal(source.processing, 'text-ready');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('podcast RSS resolution extracts the first episode, enclosure, and show metadata', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => Buffer.from(`<?xml version="1.0"?>
      <rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
        <channel>
          <title>Signal FM</title>
          <link>https://radio.example/show</link>
          <itunes:author>Signal FM team</itunes:author>
          <description><![CDATA[Long-form conversations about attention &amp; craft.]]></description>
          <item>
            <title>The quiet advantage &amp; the long view</title>
            <itunes:author>Rhea Cole</itunes:author>
            <description><![CDATA[A concise episode description for the source preview.]]></description>
            <enclosure url="https://cdn.example/quiet-advantage.mp3" type="audio/mpeg" />
          </item>
        </channel>
      </rss>`),
  });
  try {
    const source = await resolveSource('https://radio.example/feed.xml', { lookup: publicLookup });
    assert.equal(source.sourceType, 'podcast');
    assert.equal(source.provider, 'podcast');
    assert.equal(source.title, 'The quiet advantage & the long view');
    assert.equal(source.author, 'Rhea Cole');
    assert.equal(source.description, 'A concise episode description for the source preview.');
    assert.equal(source.mediaUrl, 'https://cdn.example/quiet-advantage.mp3');
    assert.equal(source.canonicalUrl, 'https://radio.example/show');
    assert.equal(source.processing, 'ready-for-range');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('podcast Atom resolution accepts enclosure links with either attribute order', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => Buffer.from(`<feed xmlns="http://www.w3.org/2005/Atom">
      <title>Field Notes</title>
      <author><name>Field Notes studio</name></author>
      <entry>
        <title>Listening for signal</title>
        <summary>How a small habit changes the way we notice.</summary>
        <link href="https://cdn.example/listening.m4a" rel="enclosure" type="audio/mp4" />
      </entry>
    </feed>`),
  });
  try {
    const source = await resolveSource('https://feeds.example/atom', { lookup: publicLookup });
    assert.equal(source.provider, 'podcast');
    assert.equal(source.title, 'Listening for signal');
    assert.equal(source.author, 'Field Notes studio');
    assert.equal(source.mediaUrl, 'https://cdn.example/listening.m4a');
    assert.equal(source.description, 'How a small habit changes the way we notice.');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('source resolution follows a bounded safe redirect and rejects private redirect targets', async () => {
  const originalFetch = globalThis.fetch;
  const html = '<html><head><title>Redirected article</title></head><body><article><p>This redirected article has enough content to exercise the bounded resolver path safely.</p></article></body></html>';
  let calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    if (calls.length === 1) return { ok: false, status: 302, headers: { get: () => '/story-final' } };
    return { ok: true, status: 200, arrayBuffer: async () => Buffer.from(html) };
  };
  try {
    const source = await resolveSource('https://news.example/story-start', { lookup: publicLookup });
    assert.equal(source.title, 'Redirected article');
    assert.deepEqual(calls, ['https://news.example/story-start', 'https://news.example/story-final']);
  } finally {
    globalThis.fetch = originalFetch;
  }

  globalThis.fetch = async () => ({ ok: false, status: 302, headers: { get: () => 'http://127.0.0.1/private' } });
  try {
    const source = await resolveSource('https://news.example/private-redirect', { lookup: publicLookup });
    assert.match(source.error, /not allowed/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('source resolution rejects DNS answers that enter private address space', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls += 1; return { ok: true, status: 200, arrayBuffer: async () => Buffer.from('') }; };
  try {
    const source = await resolveSource('https://rebinding.example/story', { lookup: async () => [{ address: '10.0.0.8', family: 4 }] });
    assert.match(source.error, /not allowed/);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('direct media worker inputs remain SSRF-safe', async () => {
  assert.equal(await resolveInput({ sourceUrl: 'https://cdn.example/audio.mp3', sourceType: 'podcast' }, { lookup: publicLookup }), 'https://cdn.example/audio.mp3');
  assert.equal(await resolveInput({ sourceUrl: 'https://radio.example/feed.xml', sourceType: 'podcast', provider: 'podcast', mediaUrl: 'https://cdn.example/stream?episode=1' }, { lookup: publicLookup }), 'https://cdn.example/stream?episode=1');
  await assert.rejects(() => resolveInput({ sourceUrl: 'http://127.0.0.1/audio.mp3', sourceType: 'podcast' }), /not allowed/);
  await assert.rejects(() => resolveInput({ sourceUrl: 'https://cdn.example/audio.mp3', sourceType: 'podcast' }, { lookup: async () => [{ address: '192.168.1.9', family: 4 }] }), /not allowed/);
});

test('provider-returned playable URLs are revalidated before FFmpeg use', async () => {
  assert.equal(await validatePlayableInput('https://stream.example/episode.m4a', { lookup: publicLookup }), 'https://stream.example/episode.m4a');
  await assert.rejects(() => validatePlayableInput('https://stream.example/episode.m4a', { lookup: async () => [{ address: '10.0.0.9', family: 4 }] }), /not allowed/);
  await assert.rejects(() => validatePlayableInput('file:///tmp/private-media', { lookup: publicLookup }), /Only http and https/);
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

test('feed pagination bounds reject malformed values without producing invalid slices', () => {
  assert.equal(normalizeFeedLimit(undefined), 20);
  assert.equal(normalizeFeedLimit(''), 20);
  assert.equal(normalizeFeedLimit('bad'), 20);
  assert.equal(normalizeFeedLimit('0'), 1);
  assert.equal(normalizeFeedLimit('500'), 50);
  assert.equal(normalizeFeedLimit('2.5'), 20);
  assert.equal(normalizeFeedCursor(undefined), 0);
  assert.equal(normalizeFeedCursor('bad'), 0);
  assert.equal(normalizeFeedCursor('-4'), 0);
  assert.equal(normalizeFeedCursor('3'), 3);
  assert.equal(normalizeFeedCursor('2.5'), 0);
});

test('following feed requires identity only when requested in an authenticated deployment', () => {
  assert.equal(followingFeedRequiresAuth({ requested: true, required: true, viewer: null }), true);
  assert.equal(followingFeedRequiresAuth({ requested: true, required: true, viewer: { id: 'reader-1' } }), false);
  assert.equal(followingFeedRequiresAuth({ requested: false, required: true, viewer: null }), false);
  assert.equal(followingFeedRequiresAuth({ requested: true, required: false, viewer: null }), false);
});

test('idempotent annotation lookup is scoped to the author and request ID', () => {
  const annotations = [{ id: 'a1', authorId: 'u1', clientRequestId: 'capture-1' }];
  assert.equal(findIdempotentAnnotation(annotations, 'u1', 'capture-1')?.id, 'a1');
  assert.equal(findIdempotentAnnotation(annotations, 'u2', 'capture-1'), null);
  assert.equal(findIdempotentAnnotation(annotations, 'u1', 'capture-2'), null);
});

test('moderation claims deduplicate active reports and restrict terminal reopening', () => {
  const claims = [{ id: 'c1', annotationId: 'a1', reporterId: 'u1', status: 'in_review' }];
  assert.equal(findActiveClaim(claims, 'a1', 'u1')?.id, 'c1');
  assert.equal(findActiveClaim(claims, 'a1', 'u2'), null);
  assert.equal(validateClaimTransition('open', 'in_review'), null);
  assert.equal(validateClaimTransition('resolved', 'rejected')?.includes('cannot move'), true);
});
