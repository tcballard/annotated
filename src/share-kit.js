// GENERATED from packages/core/src/share-kit.ts by scripts/build-core.mjs — do
// not edit by hand. The TypeScript module is the single source of truth
// shared by web, server, extension, and the native app.

import { publicAnnotationUrl } from './share-links.js';
export const SHARE_TYPES = ['copy', 'native', 'excerpt', 'image', 'embed'];
export const attributedExcerpt = (annotation, origin) => {
    const quote = String(annotation.sourceExcerpt || annotation.commentary || '').trim().slice(0, 240);
    const author = annotation.author?.handle || annotation.handle || annotation.authorId || 'annotator';
    return `${quote ? `“${quote}” — ` : ''}@${author} on Annotated\n${publicAnnotationUrl(annotation, origin)}`;
};
export const citationEmbed = (annotation, origin) => {
    const url = publicAnnotationUrl(annotation, origin);
    const title = String(annotation.sourceTitle || 'Source annotation').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
    return `<blockquote class="annotated-citation" data-annotated-version="1"><a href="${url}">${title}</a> <span>— exact source context on Annotated</span></blockquote>`;
};
export const shareDescriptor = (annotation, origin) => ({
    url: publicAnnotationUrl(annotation, origin),
    title: `${annotation.sourceTitle || 'Source annotation'} — Annotated`,
    text: attributedExcerpt(annotation, origin),
    imageUrl: annotation.slug ? `${String(origin || '').replace(/\/$/, '')}/og/${encodeURIComponent(annotation.slug)}.png` : '',
    embed: citationEmbed(annotation, origin),
});
export const shareTargets = (descriptor) => {
    const summary = descriptor.text.replace(descriptor.url, '').trim();
    return [
        { id: 'x', label: 'Post to X', href: `https://x.com/intent/post?text=${encodeURIComponent(summary)}&url=${encodeURIComponent(descriptor.url)}` },
        { id: 'whatsapp', label: 'WhatsApp', href: `https://wa.me/?text=${encodeURIComponent(descriptor.text)}` },
        { id: 'bluesky', label: 'Bluesky', href: `https://bsky.app/intent/compose?text=${encodeURIComponent(descriptor.text)}` },
        { id: 'email', label: 'Email', href: `mailto:?subject=${encodeURIComponent(descriptor.title)}&body=${encodeURIComponent(descriptor.text)}` },
    ];
};
