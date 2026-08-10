import { assertPublicUrl, blockedHostname } from './ssrf.js';
import { sourceIdentity } from './source-identity.js';

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'youtu.be', 'www.youtu.be']);
const PODCAST_HOST_HINTS = ['podcast', 'overcast', 'spotify', 'soundcloud', 'transistor.fm', 'simplecast'];
const PODCAST_PATH_HINTS = /(?:^|\/)(?:feed|rss|atom)(?:\.[a-z0-9]+)?$/i;
const VIDEO_EXTENSIONS = /\.(?:mp4|webm|mov|m3u8)(?:$|\?)/i;
const AUDIO_EXTENSIONS = /\.(?:mp3|m4a|wav|ogg|aac|flac)(?:$|\?)/i;
const maxSourceBytes = 2 * 1024 * 1024;
export const maxSourceRedirects = 3;

const decodeHtmlEntities = (value) => String(value || '')
  .replace(/&#x([0-9a-f]+);/gi, (_, code) => {
    const point = Number.parseInt(code, 16);
    return Number.isFinite(point) && point <= 0x10ffff ? String.fromCodePoint(point) : '';
  })
  .replace(/&#(\d+);/g, (_, code) => {
    const point = Number.parseInt(code, 10);
    return Number.isFinite(point) && point <= 0x10ffff ? String.fromCodePoint(point) : '';
  })
  .replace(/&nbsp;/gi, ' ')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&amp;/gi, '&');

export function parseSourceUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Enter a valid source URL.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only http and https sources are supported.');
  if (blockedHostname(url.hostname)) throw new Error('That source host is not allowed.');
  return url;
}

export function classifySource(value) {
  const url = parseSourceUrl(value);
  const hostname = url.hostname.toLowerCase();
  if (YOUTUBE_HOSTS.has(hostname) || VIDEO_EXTENSIONS.test(url.pathname)) return 'video';
  if (PODCAST_HOST_HINTS.some((hint) => hostname.includes(hint)) || PODCAST_PATH_HINTS.test(url.pathname) || AUDIO_EXTENSIONS.test(url.pathname)) return 'podcast';
  return 'article';
}

const meta = (html, name, attribute = 'property') => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`<meta[^>]+${attribute}=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, 'i');
  const reversePattern = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+${attribute}=["']${escaped}["'][^>]*>`, 'i');
  const value = (html.match(pattern) || html.match(reversePattern))?.[1];
  return value ? decodeHtmlEntities(value.trim()) : null;
};

const titleFromHTML = (html) => {
  const value = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return value ? decodeHtmlEntities(value.replace(/\s+/g, ' ').trim()) : null;
};

const canonicalFromHTML = (html, pageUrl) => {
  const raw = html.match(/<link[^>]+rel=["'][^"']*canonical[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>/i)?.[1]
    || html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*canonical[^"']*["'][^>]*>/i)?.[1];
  if (!raw) return null;
  try { const resolved = new URL(decodeHtmlEntities(raw), pageUrl); parseSourceUrl(resolved.toString()); return resolved.toString(); } catch { return null; }
};

const stripMarkup = (value) => decodeHtmlEntities(value
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/<style[\s\S]*?<\/style>/gi, '')
  .replace(/<[^>]+>/g, ' '))
  .replace(/\s+/g, ' ')
  .trim();

const decodeXmlEntities = (value) => String(value || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
  .replace(/&#x([0-9a-f]+);/gi, (_, code) => {
    const point = Number.parseInt(code, 16);
    return Number.isFinite(point) && point <= 0x10ffff ? String.fromCodePoint(point) : '';
  })
  .replace(/&#(\d+);/g, (_, code) => {
    const point = Number.parseInt(code, 10);
    return Number.isFinite(point) && point <= 0x10ffff ? String.fromCodePoint(point) : '';
  })
  .replace(/&apos;/gi, "'")
  .replace(/&quot;/gi, '"')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&amp;/gi, '&');

const xmlTag = (tag) => tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const xmlBlock = (value, tag) => {
  const escaped = xmlTag(tag);
  return String(value || '').match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, 'i'))?.[1] || '';
};

const xmlText = (value, tag) => {
  const raw = xmlBlock(value, tag);
  return raw ? stripMarkup(decodeXmlEntities(raw)) : null;
};

const xmlAttribute = (value, tag, attribute) => {
  const escapedTag = xmlTag(tag);
  const escapedAttribute = xmlTag(attribute);
  const match = String(value || '').match(new RegExp(`<${escapedTag}\\b[^>]*\\b${escapedAttribute}\\s*=\\s*["']([^"']+)["']`, 'i'));
  return match?.[1] ? decodeXmlEntities(match[1].trim()) : null;
};

const safeResolvedUrl = (value, pageUrl) => {
  if (!value) return null;
  try {
    const resolved = new URL(value, pageUrl).toString();
    parseSourceUrl(resolved);
    return resolved;
  } catch {
    return null;
  }
};

const firstFeedBlock = (html) => html.match(/<(?:item|entry)\b[^>]*>[\s\S]*?<\/(?:item|entry)>/i)?.[0] || '';

export const parsePodcastFeed = (html, pageUrl) => {
  const episode = firstFeedBlock(html);
  if (!episode) return null;
  const feed = xmlBlock(html, 'channel') || html;
  const atomFeed = xmlBlock(html, 'feed') || html;
  const feedScope = feed === html ? atomFeed : feed;
  const title = xmlText(episode, 'title') || xmlText(feedScope, 'title') || 'Podcast episode';
  const author = xmlText(episode, 'itunes:author')
    || xmlText(episode, 'author')
    || xmlText(episode, 'dc:creator')
    || xmlText(feedScope, 'itunes:author')
    || xmlText(feedScope, 'author')
    || xmlText(feedScope, 'dc:creator')
    || null;
  const description = xmlText(episode, 'description')
    || xmlText(episode, 'summary')
    || xmlText(episode, 'content:encoded')
    || xmlText(feedScope, 'description')
    || xmlText(feedScope, 'subtitle')
    || null;
  const enclosureTag = episode.match(/<enclosure\b[^>]*>/i)?.[0] || '';
  const atomEnclosure = [...episode.matchAll(/<link\b[^>]*>/gi)].map((match) => match[0]).find((tag) => /\brel\s*=\s*["']enclosure["']/i.test(tag)) || '';
  const mediaUrl = safeResolvedUrl(xmlAttribute(enclosureTag, 'enclosure', 'url') || xmlAttribute(atomEnclosure, 'link', 'href'), pageUrl);
  const imageTag = episode.match(/<itunes:image\b[^>]*>/i)?.[0] || feedScope.match(/<itunes:image\b[^>]*>/i)?.[0] || '';
  const imageUrl = safeResolvedUrl(xmlAttribute(imageTag, 'itunes:image', 'href') || xmlText(episode, 'image') || xmlText(feedScope, 'image'), pageUrl);
  const feedLink = xmlText(feedScope, 'link');

  return {
    title,
    author,
    description,
    imageUrl,
    mediaUrl,
    canonicalUrl: safeResolvedUrl(feedLink, pageUrl) || pageUrl,
    processing: 'ready-for-range',
    provider: 'podcast',
  };
};

const articleExcerpt = (html) => {
  const candidates = [...html.matchAll(/<(?:article|main|p)[^>]*>([\s\S]*?)<\/(?:article|main|p)>/gi)]
    .map((match) => stripMarkup(match[1]))
    .filter((text) => text.length > 80)
    .sort((a, b) => b.length - a.length);
  return candidates[0]?.slice(0, 420) || null;
};

const mediaUrlFromHTML = (html, pageUrl) => {
  const candidates = [
    meta(html, 'og:audio'),
    meta(html, 'og:video'),
    meta(html, 'twitter:player:stream'),
    html.match(/<(?:audio|video|source)[^>]+src=["']([^"']+)["']/i)?.[1],
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const resolved = new URL(decodeHtmlEntities(candidate), pageUrl).toString();
      parseSourceUrl(resolved);
      return resolved;
    } catch { /* ignore unusable embedded media URLs */ }
  }
  return null;
};

const fetchText = async (url, timeoutMs = 8000, { lookup } = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let currentUrl = (await assertPublicUrl(url, { lookup })).toString();
    for (let redirectCount = 0; redirectCount <= maxSourceRedirects; redirectCount += 1) {
      const response = await fetch(currentUrl, {
        signal: controller.signal,
        headers: { 'user-agent': 'annotated/0.1 source-resolver (+https://github.com/tcballard/annotated)' },
        redirect: 'manual',
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirectCount === maxSourceRedirects) throw new Error('Source redirected too many times.');
        const location = response.headers?.get?.('location') || response.headers?.location;
        if (!location) throw new Error('Source redirect did not include a location.');
        currentUrl = (await assertPublicUrl(new URL(location, currentUrl).toString(), { lookup })).toString();
        continue;
      }
      if (!response.ok) throw new Error(`Source returned ${response.status}.`);
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > maxSourceBytes) throw new Error('Source metadata is too large.');
      return Buffer.from(bytes).toString('utf8');
    }
    throw new Error('Source redirected too many times.');
  } finally {
    clearTimeout(timeout);
  }
};

export async function resolveSource(value, { lookup } = {}) {
  const url = parseSourceUrl(value);
  const kind = classifySource(value);
  const initialIdentity = sourceIdentity(url.toString());
  const base = { sourceId: initialIdentity.id, sourceUrl: url.toString(), canonicalUrl: initialIdentity.canonicalUrl, sourceType: kind, host: initialIdentity.host };
  if (VIDEO_EXTENSIONS.test(url.pathname) || AUDIO_EXTENSIONS.test(url.pathname)) base.mediaUrl = url.toString();

  if (base.mediaUrl) return { ...base, title: base.host, author: base.host, description: null, imageUrl: null, excerpt: null, processing: 'ready-for-range' };

  if (kind === 'video' && YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) {
    try {
      const oembed = await fetchText(`https://www.youtube.com/oembed?url=${encodeURIComponent(url.toString())}&format=json`, 8000, { lookup });
      const data = JSON.parse(oembed);
      return { ...base, title: data.title || 'YouTube video', author: data.author_name || 'YouTube', thumbnailUrl: data.thumbnail_url || null, processing: 'ready-for-range', provider: 'youtube' };
    } catch {
      return { ...base, title: 'YouTube video', author: 'YouTube', thumbnailUrl: null, processing: 'metadata-unavailable' };
    }
  }

  try {
    const html = await fetchText(url.toString(), 8000, { lookup });
    if (kind === 'podcast' && /<(?:rss|feed|channel|item|entry|enclosure)\b/i.test(html)) {
      const feed = parsePodcastFeed(html, url.toString());
      if (feed) {
        const resolved = { ...base, ...feed };
        const identity = sourceIdentity(resolved.canonicalUrl);
        return { ...resolved, sourceId: identity.id, canonicalUrl: identity.canonicalUrl, host: identity.host };
      }
    }
    const identity = sourceIdentity(canonicalFromHTML(html, url.toString()) || base.canonicalUrl);
    return {
      ...base,
      sourceId: identity.id,
      canonicalUrl: identity.canonicalUrl,
      host: identity.host,
      title: meta(html, 'og:title') || titleFromHTML(html) || 'Untitled source',
      author: meta(html, 'author', 'name') || meta(html, 'article:author') || meta(html, 'og:site_name') || base.host,
      description: meta(html, 'og:description') || meta(html, 'description', 'name') || null,
      imageUrl: meta(html, 'og:image') || null,
      excerpt: kind === 'article' ? articleExcerpt(html) : null,
      mediaUrl: base.mediaUrl || mediaUrlFromHTML(html, url.toString()),
      processing: kind === 'article' ? 'text-ready' : 'ready-for-range',
      provider: kind === 'podcast' ? 'podcast' : undefined,
    };
  } catch (error) {
    return { ...base, title: base.host, author: base.host, description: null, imageUrl: null, excerpt: null, processing: 'metadata-unavailable', error: error.message };
  }
}
