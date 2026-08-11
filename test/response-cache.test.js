import assert from 'node:assert/strict';
import test from 'node:test';
import { createResponseCache } from '../server/response-cache.js';

// The micro-TTL cache trades one second of staleness on anonymous reads for
// an order of magnitude of capacity. These tests hold its three contracts:
// entries die on time, memory stays bounded with least-recently-USED
// eviction, and a cleared cache forgets everything.

test('entries expire at the TTL, not before and not after', () => {
  let clock = 0;
  const cache = createResponseCache({ ttlMs: 1_000, now: () => clock });
  cache.set('/api/feed?limit=20', 'page-one');
  clock = 999;
  assert.equal(cache.get('/api/feed?limit=20'), 'page-one', 'inside the TTL the page serves from cache');
  clock = 1_001;
  assert.equal(cache.get('/api/feed?limit=20'), null, 'past the TTL the entry is gone');
  assert.equal(cache.size(), 0, 'expiry removes the entry rather than leaking it');
});

test('the cache is bounded and evicts the least recently used entry', () => {
  const cache = createResponseCache({ ttlMs: 60_000, maxEntries: 3, now: () => 0 });
  cache.set('a', '1');
  cache.set('b', '2');
  cache.set('c', '3');
  assert.equal(cache.get('a'), '1', 'touching a refreshes its recency');
  cache.set('d', '4');
  assert.equal(cache.size(), 3);
  assert.equal(cache.get('b'), null, 'the coldest entry (b) was evicted, not the oldest-inserted (a)');
  assert.equal(cache.get('a'), '1');
  assert.equal(cache.get('d'), '4');
});

test('set replaces an existing key and clear forgets everything', () => {
  const cache = createResponseCache({ ttlMs: 60_000, now: () => 0 });
  cache.set('k', 'stale');
  cache.set('k', 'fresh');
  assert.equal(cache.get('k'), 'fresh');
  assert.equal(cache.size(), 1);
  cache.clear();
  assert.equal(cache.get('k'), null);
  assert.equal(cache.size(), 0);
});
