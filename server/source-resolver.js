const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'youtu.be', 'www.youtu.be']);
const PODCAST_HOST_HINTS = ['podcast', 'overcast', 'spotify', 'soundcloud', 'transistor.fm', 'simplecast'];
const VIDEO_EXTENSIONS = /\.(?:mp4|webm|mov|m3u8)(?:$|\?)/i;
const AUDIO_EXTENSIONS = /\.(?:mp3|m4a|wav|ogg|aac|flac)(?:$|\?)/i;
const maxSourceBytes = 2 * 1024 * 1024;

const blockedHostname = (hostname) => {
  const value = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (value === 'localhost' || value === '::1' || value.endsWith('.localhost')) return true;
  if (/^127\./.test(value) || /^10\./.test(value) || /^192\.168\./.test(value)) return true;
  const private172 = value.match(/^172\.(\d+)\./);
  if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return true;
  return value === '169.254.169.254' || value.endsWith('.internal') || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80:');
};

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
  if (PODCAST_HOST_HINTS.some((hint) => hostname.includes(hint)) || AUDIO_EXTENSIONS.test(url.pathname)) return 'podcast';
  return 'article';
}

const meta = (html, name, attribute = 'property') => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`<meta[^>]+${attribute}=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, 'i');
  const reversePattern = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+${attribute}=["']${escaped}["'][^>]*>`, 'i');
  return (html.match(pattern) || html.match(reversePattern))?.[1]?.trim() || null;
};

const titleFromHTML = (html) => html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim() || null;

const canonicalFromHTML = (html, pageUrl) => {
  const raw = html.match(/<link[^>]+rel=["'][^"']*canonical[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>/i)?.[1]
    || html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*canonical[^"']*["'][^>]*>/i)?.[1];
  if (!raw) return null;
  try { const resolved = new URL(raw, pageUrl); parseSourceUrl(resolved.toString()); return resolved.toString(); } catch { return null; }
};

const stripMarkup = (value) => value
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/<style[\s\S]*?<\/style>/gi, '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;/gi, "'")
  .replace(/\s+/g, ' ')
  .trim();

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
      const resolved = new URL(candidate, pageUrl).toString();
      parseSourceUrl(resolved);
      return resolved;
    } catch { /* ignore unusable embedded media URLs */ }
  }
  return null;
};

const fetchText = async (url, timeoutMs = 8000) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': 'annotated/0.1 source-resolver (+https://github.com/tcballard/annotated)' },
      redirect: 'manual',
    });
    if (!response.ok) throw new Error(`Source returned ${response.status}.`);
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > maxSourceBytes) throw new Error('Source metadata is too large.');
    return Buffer.from(bytes).toString('utf8');
  } finally {
    clearTimeout(timeout);
  }
};

export async function resolveSource(value) {
  const url = parseSourceUrl(value);
  const kind = classifySource(value);
  const base = { sourceUrl: url.toString(), canonicalUrl: url.toString(), sourceType: kind, host: url.hostname.replace(/^www\./, '') };
  if (VIDEO_EXTENSIONS.test(url.pathname) || AUDIO_EXTENSIONS.test(url.pathname)) base.mediaUrl = url.toString();

  if (base.mediaUrl) return { ...base, title: base.host, author: base.host, description: null, imageUrl: null, excerpt: null, processing: 'ready-for-range' };

  if (kind === 'video' && YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) {
    try {
      const oembed = await fetchText(`https://www.youtube.com/oembed?url=${encodeURIComponent(url.toString())}&format=json`);
      const data = JSON.parse(oembed);
      return { ...base, title: data.title || 'YouTube video', author: data.author_name || 'YouTube', thumbnailUrl: data.thumbnail_url || null, processing: 'ready-for-range', provider: 'youtube' };
    } catch {
      return { ...base, title: 'YouTube video', author: 'YouTube', thumbnailUrl: null, processing: 'metadata-unavailable' };
    }
  }

  try {
    const html = await fetchText(url.toString());
    const canonicalUrl = canonicalFromHTML(html, url.toString());
    return {
      ...base,
      canonicalUrl,
      title: meta(html, 'og:title') || titleFromHTML(html) || 'Untitled source',
      author: meta(html, 'author', 'name') || meta(html, 'article:author') || meta(html, 'og:site_name') || base.host,
      description: meta(html, 'og:description') || meta(html, 'description', 'name') || null,
      imageUrl: meta(html, 'og:image') || null,
      excerpt: kind === 'article' ? articleExcerpt(html) : null,
      mediaUrl: base.mediaUrl || mediaUrlFromHTML(html, url.toString()),
      processing: kind === 'article' ? 'text-ready' : 'ready-for-range',
    };
  } catch (error) {
    return { ...base, title: base.host, author: base.host, description: null, imageUrl: null, excerpt: null, processing: 'metadata-unavailable', error: error.message };
  }
}
