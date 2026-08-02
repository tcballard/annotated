const runtimeOrigin = () => globalThis.location?.origin || '';

export const publicAnnotationUrl = (annotation = {}, origin = runtimeOrigin()) => {
  if (annotation.url) return String(annotation.url);
  if (!annotation.slug || !origin) return '';
  return `${String(origin).replace(/\/$/, '')}/a/${encodeURIComponent(annotation.slug)}`;
};
