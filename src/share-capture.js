// GENERATED from packages/core/src/share-capture.ts by scripts/build-core.mjs — do
// not edit by hand. The TypeScript module is the single source of truth
// shared by web, server, extension, and the native app.

// Extracts the shared source URL from a Web Share Target launch (or pasted
// clipboard text). Android share sheets put the link in `url`, in `text`
// (often wrapped in prose), or occasionally in `title` — take the first
// http(s) URL found, in that order, and trim trailing punctuation that
// sentence-style shares drag along.
export const sharedUrlFromParams = (params) => {
    for (const key of ['url', 'text', 'title']) {
        const value = String(params.get(key) || '');
        const match = value.match(/https?:\/\/[^\s"'<>)\]]+/i);
        if (match)
            return match[0].replace(/[.,;:!?]+$/, '');
    }
    return null;
};
