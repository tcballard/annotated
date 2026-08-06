// GENERATED from packages/core/src/topics.ts by scripts/build-core.mjs — do
// not edit by hand. The TypeScript module is the single source of truth
// shared by web, server, extension, and the native app.

// The topic taxonomy — author-picked at publish, never inferred. A small,
// curated list keeps chips meaningful and the trending surface honest; a
// topic is optional and an annotation without one is simply untagged.

export type Topic = { slug: string; label: string };

export const TOPICS: readonly Topic[] = Object.freeze([
  { slug: 'ai', label: 'AI' },
  { slug: 'tech', label: 'Tech' },
  { slug: 'startups', label: 'Startups' },
  { slug: 'business', label: 'Business' },
  { slug: 'science', label: 'Science' },
  { slug: 'culture', label: 'Culture' },
  { slug: 'media', label: 'Media' },
  { slug: 'politics', label: 'Politics' },
  { slug: 'legal', label: 'Legal' },
  { slug: 'sports', label: 'Sports' },
]);

export const TOPIC_SLUGS: readonly string[] = Object.freeze(TOPICS.map((topic) => topic.slug));

export const isTopic = (slug: unknown): boolean => TOPIC_SLUGS.includes(slug as string);

export const topicLabel = (slug: unknown): string => TOPICS.find((topic) => topic.slug === slug)?.label || '';
