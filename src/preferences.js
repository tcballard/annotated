// GENERATED from packages/core/src/preferences.ts by scripts/build-core.mjs — do
// not edit by hand. The TypeScript module is the single source of truth
// shared by web, server, extension, and the native app.

// What a reader has chosen about their own feed, defined once for every
// surface that reads or writes it: the web app, the server that stores
// it, the extension panel, and the native app.
//
// Preferences follow the account, not the device — sign in anywhere and
// the same choices apply. A signed-out reader still gets to choose; that
// copy simply lives on whichever surface they are using.
//
// Everything is validated on the way in. A stored record, a request body,
// and a response payload are all input: anything unexpected maps back to
// the default rather than reaching a query string or a filter.
export const DEFAULT_PREFERENCES = {
    exploreSort: 'trending',
    hideDemo: false,
    mutedTopics: [],
    followingOrder: 'recent',
};
// A muted topic is a slug from the product's taxonomy; the bound keeps a
// hostile or corrupted record from growing without limit.
export const MAX_MUTED_TOPICS = 40;
const TOPIC_SLUG = /^[a-z0-9][a-z0-9-]{0,31}$/;
export const parsePreferences = (raw) => {
    const value = (raw && typeof raw === 'object' ? raw : {});
    return {
        exploreSort: value.exploreSort === 'recent' ? 'recent' : 'trending',
        hideDemo: value.hideDemo === true,
        mutedTopics: Array.isArray(value.mutedTopics)
            ? [...new Set(value.mutedTopics.filter((topic) => typeof topic === 'string' && TOPIC_SLUG.test(topic)))].slice(0, MAX_MUTED_TOPICS)
            : [],
        followingOrder: value.followingOrder === 'popular' ? 'popular' : 'recent',
    };
};
// True when two records say the same thing — used to skip pointless
// writes when a surface adopts what the account already holds.
export const samePreferences = (a, b) => a.exploreSort === b.exploreSort
    && a.hideDemo === b.hideDemo
    && a.followingOrder === b.followingOrder
    && a.mutedTopics.length === b.mutedTopics.length
    && a.mutedTopics.every((topic, index) => topic === b.mutedTopics[index]);
