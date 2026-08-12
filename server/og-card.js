import { readFile } from 'node:fs/promises';
import { OG_WORDMARK } from './og-wordmark.js';

// OG card (1200x630) for annotation permalinks. Built for the size X
// actually renders it at: full-bleed ink ground, the source speaking in
// large serif paper, terracotta only on the moment (the chip, the quote
// mark, the CLIP/SHOT tags, the closing line). A timeline card has half a
// second to earn a stop — contrast and scale do the arguing, not chrome.
// Fonts are server-side only; the no-webfont rule for the browser surfaces
// is unaffected.

const T = {
  ink: '#26292F', inkPanel: '#33383F', player: '#141518',
  paper: '#F5F4F0', text: '#E9EAEC', soft: '#B9BEC6', meta: '#9AA0A8',
  accent: '#B0674D', accentBright: '#E0A48E',
  hair: 'rgba(255,255,255,0.12)',
};

const el = (type, style, children) => ({ type, props: { style, children } });
const txt = (style, value) => el('div', style, value);

// The lockup rides in as the finished drawing — the same outlined paths the
// web header ships — because satori would otherwise draw "annotated." in
// whatever font the container carries (DejaVu, in production): a fourth
// rendering of the brand on its most-shared surface.
const wordmark = (height) => ({
  type: 'img',
  props: {
    src: `data:image/svg+xml;base64,${Buffer.from(OG_WORDMARK.svg).toString('base64')}`,
    width: Math.round((OG_WORDMARK.width / OG_WORDMARK.height) * height),
    height,
  },
});

const clip = (value, max) => {
  const text = String(value || '').trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
};

const quoteSize = (quote, hasClipFrame) => {
  const budget = hasClipFrame ? 0 : 10;
  if (quote.length <= 70) return 56 + budget;
  if (quote.length <= 120) return 46 + budget;
  if (quote.length <= 180) return 38 + budget;
  return 32 + budget;
};

// The thumbnail beside the source: the visual the card is not already
// spending its body on. A screenshot shown large upstairs is not repeated
// here; a clip's poster is, because the band crops it to a strip.
const sourceThumb = (dataUri) => el('div', {
  display: 'flex', width: 96, height: 96, borderRadius: 12, overflow: 'hidden',
  backgroundColor: T.player, border: `2px solid ${T.hair}`, marginRight: 22, flexShrink: 0,
}, [{ type: 'img', props: { src: dataUri, width: 96, height: 96, style: { objectFit: 'cover' } } }]);

export const formatClipTime = (seconds) => {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

// Maps a stored annotation (+ author) onto the card's fields.
export const ogCardData = (annotation, author = null) => {
  const isArticle = annotation.sourceType === 'article';
  const duration = Math.max(0, Number(annotation.clipEnd) - Number(annotation.clipStart));
  const paragraph = Number(annotation.anchorParagraph);
  return {
    quote: annotation.sourceExcerpt || annotation.sourceTitle || 'A kept moment',
    note: annotation.commentary || 'An audio annotation — listen on the page.',
    author: author?.handle || 'annotated',
    sourceName: annotation.sourceTitle || annotation.sourceHost || 'Source',
    sourceDomain: annotation.sourceHost || '',
    sourceType: annotation.sourceType || 'source',
    momentLabel: isArticle
      ? (Number.isInteger(paragraph) && paragraph > 0 ? `¶ ${paragraph}` : '¶')
      : `${formatClipTime(annotation.clipStart)}–${formatClipTime(annotation.clipEnd)}`,
    clipBadge: isArticle ? '' : `${formatClipTime(duration)} · ${annotation.sourceType === 'video' ? '240p' : 'audio'}`,
  };
};

// A captured page region: the screenshot itself, big, SHOT tag top-left.
// Rendered when the visual is the kept moment, in place of the serif block.
const shotFrame = (dataUri) => el('div', {
  height: 302, backgroundColor: T.player, borderRadius: 14, border: `2px solid ${T.hair}`,
  display: 'flex', position: 'relative', overflow: 'hidden',
}, [
  { type: 'img', props: { src: dataUri, style: { width: '100%', height: 298, objectFit: 'cover' } } },
  txt({
    position: 'absolute', top: 14, left: 16, fontSize: 18, fontWeight: 700,
    letterSpacing: 1.5, color: '#FFFFFF', backgroundColor: T.accent,
    borderRadius: 6, padding: '4px 14px',
  }, 'SHOT'),
]);

// The provider thumbnail for a clip with no hosted poster yet — YouTube
// only, rebuilt from the extracted video ID so the fetch can never follow a
// user-supplied path. Returns null for everything else.
export const youtubeThumbnailUrl = (annotation = {}) => {
  for (const candidate of [annotation.mediaUrl, annotation.canonicalUrl, annotation.sourceUrl]) {
    if (!candidate) continue;
    try {
      const url = new URL(candidate);
      const host = url.hostname.toLowerCase().replace(/^www\./, '');
      let id = '';
      if (host === 'youtu.be') [id] = url.pathname.slice(1).split('/');
      else if (['youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(host)) {
        id = url.searchParams.get('v') || (url.pathname.match(/^\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})/) || [])[1] || '';
      }
      if (/^[A-Za-z0-9_-]{11}$/.test(id)) return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
    } catch { /* try the next candidate */ }
  }
  return null;
};

// The 240p player at card scale: CLIP tag top-left, play affordance, badge
// bottom-right. Only rendered for hosted media annotations. With a poster —
// the transcode's own frame, or the provider thumbnail while the clip is
// still processing — the frame shows the actual video under a scrim that
// keeps the overlays legible.
const clipFrame = (badge, poster = null) => el('div', {
  height: 148, backgroundColor: T.player, borderRadius: 14, border: `2px solid ${T.hair}`,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  position: 'relative', marginBottom: 30, overflow: 'hidden',
}, [
  ...(poster ? [
    { type: 'img', props: { src: poster, style: { position: 'absolute', top: 0, left: 0, width: 1084, height: 144, objectFit: 'cover' } } },
    el('div', { position: 'absolute', top: 0, left: 0, width: 1084, height: 144, backgroundColor: 'rgba(20, 21, 24, 0.38)' }, ' '),
  ] : []),
  txt({
    position: 'absolute', top: 12, left: 16, fontSize: 18, fontWeight: 700,
    letterSpacing: 1.5, color: '#FFFFFF', backgroundColor: T.accent,
    borderRadius: 6, padding: '4px 14px',
  }, 'CLIP'),
  el('div', {
    width: 64, height: 64, borderRadius: 64, border: '3px solid rgba(255,255,255,0.75)',
    backgroundColor: 'rgba(255,255,255,0.12)', display: 'flex',
    alignItems: 'center', justifyContent: 'center',
  }, [txt({ fontSize: 24, color: '#FFFFFF', marginLeft: 5 }, '▶')]),
  txt({
    position: 'absolute', bottom: 12, right: 16, fontFamily: 'CardMono',
    fontSize: 18, color: T.text, backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 6, padding: '3px 12px',
  }, badge),
]);

export function annotationCard(data) {
  const quote = clip(data.quote, 200);
  const note = clip(data.note, 140);
  const hasClipFrame = Boolean(data.clipBadge);
  // For screenshot captures the source speaks visually: the shot replaces the
  // serif quote block. Hosted media keeps its CLIP framing either way.
  const hasShotFrame = Boolean(data.screenshot) && !hasClipFrame;
  // What the source line can show beside itself: never the image the body
  // is already spending its space on.
  const thumb = hasShotFrame ? null : (data.screenshot || data.poster || null);

  return el('div', {
    width: 1200, height: 630, display: 'flex', flexDirection: 'column',
    backgroundColor: T.ink, fontFamily: 'CardSans', color: T.text,
  }, [
    // ink chrome bar: the brand on the left, the moment chip on the right
    el('div', {
      height: 84, backgroundColor: T.inkPanel, display: 'flex', alignItems: 'center',
      justifyContent: 'space-between', padding: '0 56px', flexShrink: 0,
    }, [
      el('div', { display: 'flex', alignItems: 'center' }, [wordmark(32)]),
      txt({
        fontFamily: 'CardMono', fontSize: 25, fontWeight: 700, color: '#FFFFFF',
        backgroundColor: T.accent, borderRadius: 8, padding: '6px 18px',
      }, data.momentLabel),
    ]),

    // body: the source speaks first — huge serif, a clip frame, or the shot
    el('div', {
      display: 'flex', flexDirection: 'column', flexGrow: 1, overflow: 'hidden',
      padding: '42px 56px 14px',
    }, [
      ...(hasClipFrame ? [clipFrame(data.clipBadge, data.poster || null)] : []),
      hasShotFrame
        ? shotFrame(data.screenshot)
        : el('div', { display: 'flex' }, [
          txt({ fontFamily: 'CardSerif', fontSize: 68, lineHeight: 1, color: T.accentBright, marginRight: 18, marginTop: -4 }, '“'),
          txt({
            fontFamily: 'CardSerif', fontSize: quoteSize(quote, hasClipFrame),
            lineHeight: 1.28, color: T.paper,
          }, quote),
        ]),
      // the annotator answers in sans, softer
      txt({ fontSize: 26, lineHeight: 1.45, marginTop: 24, color: T.soft }, note),
    ]),

    // the source, given its own line rather than a clipped meta string:
    // what was read, where it lives, and who kept it — the shape a link
    // preview is read in. No slogan sits here: the card's argument is the
    // quote standing next to its source, and a marketing line in this row
    // both crowded the title and risked colliding with it.
    el('div', {
      display: 'flex', alignItems: 'center',
      borderTop: `2px solid ${T.hair}`, margin: '0 56px', padding: '24px 0 26px',
      flexShrink: 0,
    }, [
      ...(thumb ? [sourceThumb(thumb)] : []),
      el('div', { display: 'flex', flexDirection: 'column', flexGrow: 1, overflow: 'hidden' }, [
        txt({ fontSize: 31, fontWeight: 700, color: '#FFFFFF', lineHeight: 1.2 }, clip(data.sourceName, 54)),
        txt({ fontSize: 22, color: T.meta, marginTop: 8 },
          clip(`${data.sourceDomain || data.sourceType} · kept by @${data.author}`, 48)),
      ]),
    ]),
  ]);
}

const fontDirectory = () => process.env.OG_FONT_DIR || '/usr/share/fonts/truetype/dejavu';

let fontsPromise;
const loadFonts = () => {
  fontsPromise ||= (async () => {
    const dir = fontDirectory();
    const load = (file) => readFile(`${dir}/${file}`);
    const [sans, sansBold, mono, serif] = await Promise.all([
      load('DejaVuSans.ttf'), load('DejaVuSans-Bold.ttf'), load('DejaVuSansMono.ttf'), load('DejaVuSerif.ttf'),
    ]);
    return [
      { name: 'CardSans', data: sans, weight: 400, style: 'normal' },
      { name: 'CardSans', data: sansBold, weight: 700, style: 'normal' },
      { name: 'CardMono', data: mono, weight: 400, style: 'normal' },
      { name: 'CardMono', data: mono, weight: 700, style: 'normal' },
      { name: 'CardSerif', data: serif, weight: 400, style: 'normal' },
    ];
  })();
  return fontsPromise;
};

export async function renderOgCard(data) {
  const [{ default: satori }, { Resvg }, fonts] = await Promise.all([
    import('satori'), import('@resvg/resvg-js'), loadFonts(),
  ]);
  const svg = await satori(annotationCard(data), { width: 1200, height: 630, fonts });
  return new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng();
}

// Small keyed cache so repeated crawler fetches do not re-render. `data` may
// be an async factory so expensive inputs (screenshot bytes) load on miss only.
const cache = new Map();
const CACHE_LIMIT = 100;
export async function renderOgCardCached(cacheKey, data) {
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const png = await renderOgCard(typeof data === 'function' ? await data() : data);
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
  cache.set(cacheKey, png);
  return png;
}
