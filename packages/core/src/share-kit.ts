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

// The doors a share can walk through, one list for every surface. The
// descriptor's text already ends with the public URL (the attributed
// excerpt carries its own receipt), so intents that take a separate url
// parameter get the text without it.
export type ShareTarget = { id: 'x' | 'whatsapp' | 'bluesky' | 'email'; label: string; href: string };

export const shareTargets = (descriptor: { url: string; title: string; text: string }): ShareTarget[] => {
  const summary = descriptor.text.replace(descriptor.url, '').trim();
  return [
    { id: 'x', label: 'Post to X', href: `https://x.com/intent/post?text=${encodeURIComponent(summary)}&url=${encodeURIComponent(descriptor.url)}` },
    { id: 'whatsapp', label: 'WhatsApp', href: `https://wa.me/?text=${encodeURIComponent(descriptor.text)}` },
    { id: 'bluesky', label: 'Bluesky', href: `https://bsky.app/intent/compose?text=${encodeURIComponent(descriptor.text)}` },
    { id: 'email', label: 'Email', href: `mailto:?subject=${encodeURIComponent(descriptor.title)}&body=${encodeURIComponent(descriptor.text)}` },
  ];
};
