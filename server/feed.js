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

// Keyset pagination for time-ordered feeds. The old cursor was an offset:
// deep pages cost O(offset), and an insert while someone scrolls shifts
// every later page — readers skip or double-see items. The cursor is now
// the last row's position in the sort ("createdAt|id", opaque to clients,
// who already round-trip nextCursor verbatim); resuming means "strictly
// after that position", which no concurrent insert can shift. Bare-digit
// cursors from clients that predate this stay valid as offsets — trending
// also keeps offsets, deliberately: it is a continuously reshuffling
// leaderboard, where a stable resume point does not exist.
export const parseKeysetCursor = (value) => {
  const raw = String(value || '');
  if (!raw || /^\d+$/.test(raw)) return null;
  const separatorIndex = raw.indexOf('|');
  if (separatorIndex < 1) return null;
  return { createdAt: raw.slice(0, separatorIndex), id: raw.slice(separatorIndex + 1) };
};

export const keysetCursorFor = (item) => `${item.createdAt}|${item.id}`;

// `sorted` is createdAt DESC with id DESC as the tie-break. If the cursor
// row still exists, resume after it; if it was deleted meanwhile, resume
// at the first row that sorts strictly after its position.
export const afterKeysetCursor = (sorted, cursor) => {
  if (!cursor) return sorted;
  const index = sorted.findIndex((item) => item.createdAt === cursor.createdAt && item.id === cursor.id);
  if (index >= 0) return sorted.slice(index + 1);
  return sorted.filter((item) => item.createdAt < cursor.createdAt || (item.createdAt === cursor.createdAt && item.id < cursor.id));
};

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
