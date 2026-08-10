import { publicAnnotationUrl } from './share-links.js';

export const SHARE_TYPES = ['copy', 'native', 'excerpt', 'image', 'embed'] as const;

export const attributedExcerpt = (annotation: Record<string, any>, origin?: string): string => {
  const quote = String(annotation.sourceExcerpt || annotation.commentary || '').trim().slice(0, 240);
  const author = annotation.author?.handle || annotation.handle || annotation.authorId || 'annotator';
  return `${quote ? `“${quote}” — ` : ''}@${author} on Annotated\n${publicAnnotationUrl(annotation, origin)}`;
};

export const citationEmbed = (annotation: Record<string, any>, origin?: string): string => {
  const url = publicAnnotationUrl(annotation, origin);
  const title = String(annotation.sourceTitle || 'Source annotation').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] as string));
  return `<blockquote class="annotated-citation" data-annotated-version="1"><a href="${url}">${title}</a> <span>— exact source context on Annotated</span></blockquote>`;
};

export const shareDescriptor = (annotation: Record<string, any>, origin?: string) => ({
  url: publicAnnotationUrl(annotation, origin),
  title: `${annotation.sourceTitle || 'Source annotation'} — Annotated`,
  text: attributedExcerpt(annotation, origin),
  imageUrl: annotation.slug ? `${String(origin || '').replace(/\/$/, '')}/og/${encodeURIComponent(annotation.slug)}.png` : '',
  embed: citationEmbed(annotation, origin),
});
