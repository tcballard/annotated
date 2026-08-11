// A micro-TTL cache for anonymous read responses.
//
// The feed is the product's hottest path (70% of modelled traffic) and its
// page costs real work per request. For signed-out readers the page is
// identical for everyone, so at high request rates the honest trade is one
// second of staleness for an order of magnitude of capacity: a viral read
// spike collapses onto one backend build per page-shape per second. Signed-in
// requests never touch this cache — their payloads carry viewer state.
//
// Deliberately TTL-only: no cross-instance invalidation to get wrong, no
// unbounded growth (LRU cap), and staleness is bounded by the clock, not by
// the correctness of a listener. One second is imperceptible on a public
// commons; it is also the difference between ~150 req/s and thousands.

const DEFAULT_TTL_MS = 1_000;
const DEFAULT_MAX_ENTRIES = 512;

export const createResponseCache = ({ ttlMs = DEFAULT_TTL_MS, maxEntries = DEFAULT_MAX_ENTRIES, now = Date.now } = {}) => {
  const entries = new Map();
  const get = (key) => {
    const entry = entries.get(key);
    if (!entry) return null;
    if (now() - entry.storedAt > ttlMs) {
      entries.delete(key);
      return null;
    }
    // Refresh recency so the LRU eviction below drops the coldest key.
    entries.delete(key);
    entries.set(key, entry);
    return entry.value;
  };
  const set = (key, value) => {
    if (entries.has(key)) entries.delete(key);
    entries.set(key, { value, storedAt: now() });
    if (entries.size > maxEntries) entries.delete(entries.keys().next().value);
  };
  const clear = () => entries.clear();
  return { get, set, clear, size: () => entries.size };
};
