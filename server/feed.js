const searchableFields = (annotation, users = []) => {
  const author = users.find((user) => user.id === annotation.authorId);
  return [
    annotation.sourceTitle,
    annotation.sourceHost,
    annotation.sourceUrl,
    annotation.sourceExcerpt,
    annotation.commentary,
    author?.handle,
    author?.displayName,
  ].filter(Boolean).join(' ').toLocaleLowerCase();
};

export const normalizeFeedQuery = (value) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 80);

const normalizeInteger = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
};

export const normalizeFeedLimit = (value) => Math.min(50, Math.max(1, normalizeInteger(value, 20)));

export const normalizeFeedCursor = (value) => Math.max(0, normalizeInteger(value, 0));

export const followingFeedRequiresAuth = ({ requested, required, viewer }) => Boolean(requested && required && !viewer);

export const matchesFeedQuery = (annotation, users, query) => {
  const normalized = normalizeFeedQuery(query).toLocaleLowerCase();
  return !normalized || searchableFields(annotation, users).includes(normalized);
};

// "This page" in the side panel filters the feed to annotations of the URL the
// user is looking at. Comparison ignores hash, trailing slash, and www.
export const normalizeSourceUrlKey = (value) => {
  try {
    const url = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    url.hash = '';
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const pathname = url.pathname.replace(/\/+$/, '') || '/';
    return `${host}${pathname}${url.search}`;
  } catch {
    return '';
  }
};

export const matchesFeedUrl = (annotation, urlKey) => {
  if (!urlKey) return true;
  return [annotation.sourceUrl, annotation.canonicalUrl].some((candidate) => normalizeSourceUrlKey(candidate) === urlKey);
};
