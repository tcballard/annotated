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

export const matchesFeedQuery = (annotation, users, query) => {
  const normalized = normalizeFeedQuery(query).toLocaleLowerCase();
  return !normalized || searchableFields(annotation, users).includes(normalized);
};
