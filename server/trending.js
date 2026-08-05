import { annotationHost } from './discovery.js';

// Trending, in this product's terms. The metric that matters here is opens of
// the original — likes are the weakest signal, not the ranking. Scores decay
// with age (hot-ranking gravity) so the surface reflects what readers are
// engaging with NOW, and everything is computed on read from fields we
// already store: no counters to maintain, nothing to drift.

export const HOT_GRAVITY = 1.5;
export const OPEN_WEIGHT = 3;
export const COMMENT_WEIGHT = 2;
export const LIKE_WEIGHT = 1;

const ageHours = (createdAt, now) => {
  const created = Date.parse(createdAt || '');
  if (!Number.isFinite(created)) return null;
  return Math.max(0, (now - created) / 3_600_000);
};

export const trendingScore = (annotation, { likes = 0, comments = 0 } = {}, now = Date.now()) => {
  const age = ageHours(annotation?.createdAt, now);
  if (age === null) return 0;
  const engagement = (Number(annotation.openCount) || 0) * OPEN_WEIGHT + comments * COMMENT_WEIGHT + likes * LIKE_WEIGHT;
  return engagement / ((age + 2) ** HOT_GRAVITY);
};

export const sortByTrending = (annotations, store, now = Date.now()) => {
  const likesByAnnotation = new Map();
  for (const like of store.likes || []) likesByAnnotation.set(like.annotationId, (likesByAnnotation.get(like.annotationId) || 0) + 1);
  const commentsByAnnotation = new Map();
  for (const comment of store.comments || []) commentsByAnnotation.set(comment.annotationId, (commentsByAnnotation.get(comment.annotationId) || 0) + 1);
  return [...annotations]
    .map((annotation) => ({
      annotation,
      score: trendingScore(annotation, {
        likes: likesByAnnotation.get(annotation.id) || 0,
        comments: commentsByAnnotation.get(annotation.id) || 0,
      }, now),
    }))
    .sort((a, b) => b.score - a.score || b.annotation.createdAt.localeCompare(a.annotation.createdAt))
    .map((entry) => entry.annotation);
};

// Sources trend by the decayed attention their annotations are gathering:
// opens dominate, and each annotation counts for one on its own so a newly
// annotated source can surface before its opens arrive.
export const rankTrendingSources = (annotations, now = Date.now(), limit = 5) => {
  const byHost = new Map();
  for (const annotation of annotations || []) {
    const host = annotationHost(annotation);
    if (!host) continue;
    const age = ageHours(annotation.createdAt, now);
    if (age === null) continue;
    const opens = Number(annotation.openCount) || 0;
    const score = (opens * OPEN_WEIGHT + 1) / ((age + 2) ** HOT_GRAVITY);
    const entry = byHost.get(host) || { host, opens: 0, annotationCount: 0, score: 0 };
    entry.opens += opens;
    entry.annotationCount += 1;
    entry.score += score;
    byHost.set(host, entry);
  }
  return [...byHost.values()].sort((a, b) => b.score - a.score || b.opens - a.opens).slice(0, limit);
};
