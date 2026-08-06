// GENERATED from packages/core/src/deep-link.ts by scripts/build-core.mjs — do
// not edit by hand. The TypeScript module is the single source of truth
// shared by web, server, extension, and the native app.

// Deep links back to the original source: timestamped URLs for media
// (`&t=14s` on YouTube, `#t=14` media fragments elsewhere) and W3C text
// fragments (`#:~:text=`) for article passages. Every clip links back to the
// exact moment, not just the page.
const formatTime = (seconds) => {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};
const encodeFragmentText = (value) => encodeURIComponent(value).replace(/-/g, '%2D');
// Builds a `#:~:text=` fragment. Long passages use the start,end form so the
// fragment stays short enough for browsers to match reliably.
export const textFragment = (excerpt, { prefix = '', suffix = '' } = {}) => {
    const text = String(excerpt || '').replace(/\s+/g, ' ').trim();
    if (!text)
        return '';
    const bounded = (value) => String(value || '').replace(/\s+/g, ' ').trim().slice(-64);
    const parts = [];
    if (prefix)
        parts.push(`${encodeFragmentText(bounded(prefix))}-`);
    if (text.length <= 150) {
        parts.push(encodeFragmentText(text));
    }
    else {
        const words = text.split(' ');
        const head = [];
        while (head.join(' ').length < 40 && words.length)
            head.push(words.shift());
        const tail = [];
        while (tail.join(' ').length < 40 && words.length)
            tail.unshift(words.pop());
        if (!tail.length)
            parts.push(encodeFragmentText(head.join(' ')));
        else
            parts.push(`${encodeFragmentText(head.join(' '))},${encodeFragmentText(tail.join(' '))}`);
    }
    if (suffix)
        parts.push(`-${encodeFragmentText(String(suffix || '').replace(/\s+/g, ' ').trim().slice(0, 64))}`);
    return `#:~:text=${parts.join(',')}`;
};
export const mediaTimestampUrl = (url, seconds) => {
    const start = Math.max(0, Math.round(Number(seconds) || 0));
    let parsed;
    try {
        parsed = new URL(url);
    }
    catch {
        return url;
    }
    if (!start)
        return parsed.toString();
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
        parsed.searchParams.set('t', `${start}s`);
        return parsed.toString();
    }
    if (host === 'youtu.be') {
        parsed.searchParams.set('t', String(start));
        return parsed.toString();
    }
    // Media fragment (RFC: media fragments URI) — understood by direct media
    // URLs and harmless on pages that ignore unknown hashes.
    parsed.hash = `t=${start}`;
    return parsed.toString();
};
export const articleFragmentUrl = (url, excerpt, anchors = {}) => {
    let parsed;
    try {
        parsed = new URL(url);
    }
    catch {
        return url;
    }
    const fragment = textFragment(excerpt, anchors);
    if (!fragment)
        return parsed.toString();
    parsed.hash = '';
    return `${parsed.toString()}${fragment}`;
};
export const openOriginalHref = (item = {}) => {
    const type = item.type || item.sourceType || 'article';
    const url = item.canonicalUrl || item.sourceUrl || '';
    if (!url)
        return '#';
    if (type === 'article')
        return articleFragmentUrl(url, item.quote || item.sourceExcerpt || '', { prefix: item.anchorPrefix, suffix: item.anchorSuffix });
    return mediaTimestampUrl(url, item.clipStart);
};
export const openOriginalLabel = (item = {}) => {
    const type = item.type || item.sourceType || 'article';
    if (type === 'article')
        return item.anchorParagraph ? `Open original at ¶ ${item.anchorParagraph}` : 'Open original';
    const start = Math.max(0, Math.round(Number(item.clipStart) || 0));
    return start ? `Open original at ${formatTime(start)}` : 'Open original';
};
