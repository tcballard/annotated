// Annotation visibility: who can see a published annotation, and where.
//
//   public   — listed everywhere: feeds, This page, profiles, OG unfurls.
//   unlisted — the permalink and share card work for anyone holding the link
//              (with a noindex hint for crawlers), but the annotation never
//              appears in feeds, This page, search, or a public profile.
//   private  — the author only. Every other viewer gets the same not-found
//              as a nonexistent slug, so existence is not disclosed.
//
// Annotations created before this field existed are public.

export const VISIBILITIES = ['public', 'unlisted', 'private'];

export const normalizeVisibility = (value) => VISIBILITIES.includes(value) ? value : null;

export const effectiveVisibility = (annotation) => normalizeVisibility(annotation?.visibility) || 'public';

export const isPubliclyListed = (annotation) => effectiveVisibility(annotation) === 'public';

// Link-holders may view public and unlisted; private is author-only.
export const canViewAnnotation = (annotation, viewerId = '') => {
  if (!annotation) return false;
  if (effectiveVisibility(annotation) !== 'private') return true;
  return Boolean(viewerId && annotation.authorId === viewerId);
};

// Crawlers may index public permalinks only.
export const allowsIndexing = (annotation) => effectiveVisibility(annotation) === 'public';
