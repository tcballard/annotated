// GENERATED from packages/core/src/share-links.ts by scripts/build-core.mjs — do
// not edit by hand. The TypeScript module is the single source of truth
// shared by web, server, extension, and the native app.

const runtimeOrigin = () => globalThis.location?.origin || '';
export const publicAnnotationUrl = (annotation = {}, origin = runtimeOrigin()) => {
    if (annotation.url)
        return String(annotation.url);
    if (!annotation.slug || !origin)
        return '';
    return `${String(origin).replace(/\/$/, '')}/a/${encodeURIComponent(annotation.slug)}`;
};
