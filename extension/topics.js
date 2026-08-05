// The topic taxonomy — author-picked at publish, never inferred. A small,
// curated list keeps chips meaningful and the trending surface honest; a
// topic is optional and an annotation without one is simply untagged.
//
// This module is the single source of truth: the web app imports it directly
// (pure data, bundler-safe) and the extension carries a byte-for-byte copy in
// extension/topics.js — a parity test keeps the two in lockstep.

export const TOPICS = Object.freeze([
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

export const TOPIC_SLUGS = Object.freeze(TOPICS.map((topic) => topic.slug));

export const isTopic = (slug) => TOPIC_SLUGS.includes(slug);

export const topicLabel = (slug) => TOPICS.find((topic) => topic.slug === slug)?.label || '';
