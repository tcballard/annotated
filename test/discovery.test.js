import assert from 'node:assert/strict';
import test from 'node:test';
import { annotationHost, matchesPersonQuery, normalizeHost, publicAnnotationsForHost, rankAnnotators } from '../server/discovery.js';

const annotation = (overrides = {}) => ({ status: 'published', authorId: 'a1', sourceHost: 'example.com', sourceUrl: 'https://example.com/x', ...overrides });

test('hosts normalize consistently for hub lookups', () => {
  assert.equal(normalizeHost('YouTube.com'), 'youtube.com');
  assert.equal(normalizeHost('www.youtube.com'), 'youtube.com');
  assert.equal(normalizeHost('https://www.youtube.com/watch?v=abc'), 'youtube.com');
  assert.equal(normalizeHost(''), '');
  assert.equal(annotationHost({ sourceUrl: 'https://www.theverge.com/a' }), 'theverge.com');
  assert.equal(annotationHost({ sourceHost: 'Overcast.fm', sourceUrl: 'https://x.test/a' }), 'overcast.fm');
});

test('source hubs list only public annotations of the host', () => {
  const annotations = [
    annotation({ id: '1' }),
    annotation({ id: '2', visibility: 'unlisted' }),
    annotation({ id: '3', visibility: 'private' }),
    annotation({ id: '4', sourceHost: 'other.com', sourceUrl: 'https://other.com/y' }),
    annotation({ id: '5', status: 'draft' }),
  ];
  const hub = publicAnnotationsForHost(annotations, 'example.com');
  assert.deepEqual(hub.map((item) => item.id), ['1']);
});

test('annotators rank by opens of the original, then by volume', () => {
  const annotations = [
    annotation({ authorId: 'quiet', openCount: 0 }),
    annotation({ authorId: 'quiet', openCount: 0 }),
    annotation({ authorId: 'quiet', openCount: 0 }),
    annotation({ authorId: 'driver', openCount: 12 }),
    annotation({ authorId: 'steady', openCount: 4 }),
    annotation({ authorId: 'steady', openCount: 3 }),
  ];
  const users = [{ id: 'driver', handle: 'driver' }, { id: 'steady', handle: 'steady' }, { id: 'quiet', handle: 'quiet' }];
  const ranked = rankAnnotators(annotations, users);
  assert.deepEqual(ranked.map((entry) => entry.authorId), ['driver', 'steady', 'quiet']);
  assert.equal(ranked[0].opens, 12);
  assert.equal(ranked[1].opens, 7);
  assert.equal(ranked[2].count, 3);
  assert.equal(ranked[0].user.handle, 'driver');
});

test('people search matches handle or display name, case-insensitively', () => {
  const user = { handle: 'tcballard', displayName: 'Tom Ballard' };
  assert.equal(matchesPersonQuery(user, 'ball'), true);
  assert.equal(matchesPersonQuery(user, 'TOM'), true);
  assert.equal(matchesPersonQuery(user, 'reader'), false);
  assert.equal(matchesPersonQuery(user, ''), true);
});
