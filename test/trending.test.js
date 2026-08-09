import assert from 'node:assert/strict';
import test from 'node:test';
import { rankTrendingSources, sortByTrending, trendingScore } from '../server/trending.js';

const NOW = Date.parse('2026-08-05T12:00:00.000Z');
const hoursAgo = (hours) => new Date(NOW - hours * 3_600_000).toISOString();

test('recency matters: equal engagement ranks the newer annotation higher', () => {
  const fresh = trendingScore({ createdAt: hoursAgo(2), openCount: 10 }, {}, NOW);
  const stale = trendingScore({ createdAt: hoursAgo(120), openCount: 10 }, {}, NOW);
  assert.ok(fresh > stale);
  assert.equal(trendingScore({ createdAt: 'not-a-date', openCount: 99 }, {}, NOW), 0);
});

test('opens outweigh likes — the product metric leads the ranking', () => {
  const opened = trendingScore({ createdAt: hoursAgo(5), openCount: 2 }, { likes: 0 }, NOW);
  const liked = trendingScore({ createdAt: hoursAgo(5), openCount: 0 }, { likes: 5 }, NOW);
  assert.ok(opened > liked, '2 opens beat 5 likes at equal age');
});

test('sortByTrending counts likes and comments from the store and breaks ties by recency', () => {
  const annotations = [
    { id: 'a-quiet', createdAt: hoursAgo(3), openCount: 0 },
    { id: 'b-discussed', createdAt: hoursAgo(3), openCount: 0 },
    { id: 'c-opened-old', createdAt: hoursAgo(200), openCount: 40 },
  ];
  const store = {
    likes: [{ annotationId: 'b-discussed', userId: 'u1' }],
    comments: [{ annotationId: 'b-discussed' }, { annotationId: 'b-discussed' }],
  };
  const sorted = sortByTrending(annotations, store, NOW).map((item) => item.id);
  assert.equal(sorted[0], 'b-discussed', 'live discussion beats decayed opens');
  assert.deepEqual(sorted, ['b-discussed', 'c-opened-old', 'a-quiet']);
});

test('trending sources aggregate by host with decay and a bounded list', () => {
  const annotations = [
    { sourceHost: 'wikipedia.org', createdAt: hoursAgo(4), openCount: 10 },
    { sourceHost: 'wikipedia.org', createdAt: hoursAgo(30), openCount: 5 },
    { sourceHost: 'paulgraham.com', createdAt: hoursAgo(2), openCount: 1 },
    { sourceHost: 'quiet.example', createdAt: hoursAgo(500), openCount: 100 },
    { sourceHost: '', sourceUrl: 'not a url', createdAt: hoursAgo(1), openCount: 50 },
  ];
  const ranked = rankTrendingSources(annotations, NOW, 2);
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].host, 'wikipedia.org');
  assert.equal(ranked[0].opens, 15);
  assert.equal(ranked[0].annotationCount, 2);
  assert.equal(ranked[1].host, 'paulgraham.com', 'a fresh source outranks decayed volume');
});

test('engagement counts memoize on state identity and refresh on change', async () => {
  const { engagementCounts } = await import('../server/trending.js');
  const store = { likes: [{ annotationId: 'a1', userId: 'u1' }], comments: [] };
  const first = engagementCounts(store);
  assert.equal(engagementCounts(store), first, 'same state object must reuse the maps');
  assert.equal(first.likesByAnnotation.get('a1'), 1);
  const next = { ...store, likes: [...store.likes, { annotationId: 'a1', userId: 'u2' }] };
  const fresh = engagementCounts(next);
  assert.notEqual(fresh, first, 'a new state object recomputes');
  assert.equal(fresh.likesByAnnotation.get('a1'), 2);
});
