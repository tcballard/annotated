// Discovery reads the public record only: source hubs list a host's public
// annotations and the people who annotate it, ranked by the traffic they send
// back to the source — opens, not likes. Unlisted and private notes never
// feed any discovery surface.

import { isPubliclyListed } from './visibility.js';

export const normalizeHost = (value) => {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return '';
  try {
    return new URL(text.includes('://') ? text : `https://${text}`).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

export const annotationHost = (annotation) => normalizeHost(annotation?.sourceHost) || normalizeHost(annotation?.sourceUrl);

export const publicAnnotationsForHost = (annotations = [], host) => annotations.filter(
  (annotation) => annotation.status === 'published' && isPubliclyListed(annotation) && annotationHost(annotation) === host,
);

// Curators are ranked by opens of the original first — the product's own
// currency — with annotation count as the tiebreak.
export const rankAnnotators = (annotations = [], users = [], limit = 5) => {
  const byAuthor = new Map();
  for (const annotation of annotations) {
    const entry = byAuthor.get(annotation.authorId) || { count: 0, opens: 0 };
    entry.count += 1;
    entry.opens += Number(annotation.openCount) || 0;
    byAuthor.set(annotation.authorId, entry);
  }
  return [...byAuthor.entries()]
    .map(([authorId, stats]) => ({ authorId, ...stats, user: users.find((user) => user.id === authorId) || null }))
    .sort((a, b) => b.opens - a.opens || b.count - a.count)
    .slice(0, limit);
};

export const matchesPersonQuery = (user, query) => {
  const normalized = String(query || '').trim().toLowerCase();
  if (!normalized) return true;
  return String(user?.handle || '').toLowerCase().includes(normalized)
    || String(user?.displayName || '').toLowerCase().includes(normalized);
};
