// The annotation domain model as every surface renders it: the raw server
// record mapped to a display-ready feed item, plus the small vocabulary
// (verbs, chips, times) that keeps web, extension, and native describing
// the same thing the same way.

import { isTopic } from './topics.js';

export const VISIBILITIES: readonly string[] = ['public', 'unlisted', 'private'];

export const formatTime = (seconds: unknown): string => {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const mins = Math.floor(total / 60);
  const secs = String(total % 60).padStart(2, '0');
  return `${mins}:${secs}`;
};

// Accepts "62", "1:02", or "1:02:03" and returns whole seconds.
export const parseTimeInput = (value: unknown): number | null => {
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (!/^\d+(?::[0-5]?\d){0,2}$/.test(text)) return null;
  return text.split(':').reduce((total, part) => total * 60 + Number(part), 0);
};

export const relTime = (iso: unknown): string => {
  const stamp = Date.parse(String(iso || ''));
  if (!Number.isFinite(stamp)) return 'just now';
  const seconds = Math.max(0, (Date.now() - stamp) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 7 * 86_400) return `${Math.floor(seconds / 86_400)}d`;
  return new Date(stamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

export const sourceLabels: Record<string, string> = { video: 'video', article: 'article', podcast: 'podcast' };

export const annotationVerb = (type: string): string =>
  type === 'article' ? 'annotated an article' : `annotated a ${sourceLabels[type] || 'source'}`;

export const hostOf = (url: unknown): string => {
  try { return new URL(String(url)).hostname.replace(/^www\./, ''); } catch { return ''; }
};

// The raw annotation record as the API returns it. Loose on purpose: the
// mapper below is the normalization boundary.
export type AnnotationRecord = Record<string, any>;

export type FeedItem = {
  type: string;
  initials: string;
  displayName: string;
  avatarUrl: string;
  handle: string;
  time: string;
  host: string;
  sourceUrl: string;
  canonicalUrl: string;
  sourceTitle: string;
  slug: string | undefined;
  url: string | undefined;
  clipStart: number;
  clipEnd: number;
  anchorParagraph: number | string | null;
  anchorPrefix: string;
  anchorSuffix: string;
  quote: string;
  commentary: string;
  commentaryMode: string;
  audioUrl: string;
  audioDuration: number;
  audioPeaks: number[] | null;
  clipPeaks: number[] | null;
  posterUrl: string;
  clipUrl: string;
  mediaStatus: string;
  opens: number;
  comments: number;
  likes: number;
  likedByMe: boolean;
  authorId: string;
  visibility: string;
  topic: string | null;
  screenshotUrl: string;
  editedAt: string;
  createdAt: string;
};

export const annotationToFeedItem = (annotation: AnnotationRecord): FeedItem => ({
  type: annotation.sourceType || 'article',
  initials: (annotation.author?.displayName || annotation.author?.handle || 'A').slice(0, 1).toUpperCase(),
  displayName: annotation.author?.displayName || '',
  avatarUrl: annotation.author?.avatarUrl || '',
  handle: annotation.author?.handle || annotation.authorId || 'user',
  time: relTime(annotation.createdAt),
  host: annotation.sourceHost || hostOf(annotation.sourceUrl),
  sourceUrl: annotation.sourceUrl,
  canonicalUrl: annotation.canonicalUrl || annotation.sourceUrl,
  sourceTitle: annotation.sourceTitle || annotation.sourceHost || 'Source',
  slug: annotation.slug,
  url: annotation.url,
  clipStart: Number(annotation.clipStart) || 0,
  clipEnd: Number(annotation.clipEnd) || 0,
  anchorParagraph: annotation.anchorParagraph || null,
  anchorPrefix: annotation.anchorPrefix || '',
  anchorSuffix: annotation.anchorSuffix || '',
  quote: annotation.sourceExcerpt || '',
  commentary: annotation.commentary || '',
  commentaryMode: annotation.commentaryMode || 'text',
  audioUrl: annotation.audioUrl || '',
  audioDuration: Number(annotation.audioDuration) || 0,
  audioPeaks: Array.isArray(annotation.audioPeaks) ? annotation.audioPeaks : null,
  clipPeaks: Array.isArray(annotation.clipPeaks) ? annotation.clipPeaks : null,
  posterUrl: annotation.posterUrl || '',
  clipUrl: annotation.clipUrl || '',
  mediaStatus: annotation.mediaStatus || 'not-applicable',
  opens: Number(annotation.opens) || 0,
  comments: Array.isArray(annotation.comments) ? annotation.comments.length : 0,
  likes: Number(annotation.likes) || 0,
  likedByMe: Boolean(annotation.likedByMe),
  authorId: annotation.author?.id || annotation.authorId || '',
  visibility: VISIBILITIES.includes(annotation.visibility) ? annotation.visibility : 'public',
  topic: isTopic(annotation.topic) ? annotation.topic : null,
  screenshotUrl: annotation.screenshotUrl || '',
  editedAt: annotation.editedAt || '',
  createdAt: annotation.createdAt || '',
});

export const chipFor = (item: Pick<FeedItem, 'type' | 'anchorParagraph' | 'clipStart' | 'clipEnd'>): string =>
  item.type === 'article'
    ? (item.anchorParagraph ? `¶ ${item.anchorParagraph}` : '¶')
    : `${formatTime(item.clipStart)}–${formatTime(item.clipEnd)}`;
