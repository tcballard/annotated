const runtimeOrigin = (): string => (globalThis as any).location?.origin || '';

export const publicAnnotationUrl = (annotation: { url?: string; slug?: string } = {}, origin: string = runtimeOrigin()): string => {
  if (annotation.url) return String(annotation.url);
  if (!annotation.slug || !origin) return '';
  return `${String(origin).replace(/\/$/, '')}/a/${encodeURIComponent(annotation.slug)}`;
};
