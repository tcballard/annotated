// Edge-cacheability rules for the launch posture: what a CDN in front of the
// origin may cache, stated in one place and unit-tested. The principle is the
// same as the feed's micro-TTL cache — cache only what is identical for every
// viewer — plus one hard rule: nothing visibility-gated is ever edge-cacheable,
// because a CDN that caches an owner's 200 would serve it to strangers.

// Permalink HTML is a viewer-independent shell (personalisation happens
// client-side via /api/me), so PUBLIC annotation pages can sit at the edge
// for a minute. Unlisted and private pages stay no-store: their existence is
// the secret.
export const permalinkCacheControl = (visibility) => (
  visibility === 'public'
    ? 'public, max-age=0, s-maxage=60, stale-while-revalidate=300'
    : 'no-store'
);

// Vite emits content-hashed filenames under /assets/ — immutable by
// construction. Release artifacts keep their short revalidating window.
export const staticCacheControl = (pathname) => {
  if (pathname.startsWith('/assets/')) return 'public, max-age=31536000, immutable';
  if (pathname.startsWith('/release/')) return 'public, max-age=300, must-revalidate';
  return undefined;
};

// Per-IP crowd limits. The defaults are right for one reader on one
// connection; a launch crowd behind carrier NAT shares one address, so the
// per-IP anonymous actions accept env overrides (RATE_LIMIT_OPEN_ORIGINAL,
// RATE_LIMIT_ANNOTATION_EMBED, RATE_LIMIT_ANNOTATION_QR). Bounded so a typo
// cannot disable the limiter entirely.
export const envLimit = (name, fallback) => {
  const raw = Number(process.env[`RATE_LIMIT_${name.replace(/-/g, '_').toUpperCase()}`]);
  if (!Number.isFinite(raw) || raw < 1) return fallback;
  return Math.min(100_000, Math.floor(raw));
};
