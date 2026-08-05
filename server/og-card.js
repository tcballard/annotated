import { readFile } from 'node:fs/promises';

// OG card (1200x630) for annotation permalinks — a miniature permalink page.
// Identity rules: ink chrome bar, paper ground, bordered white module, the
// source speaks in serif, terracotta only on the moment (chip, quote rule,
// CLIP tag, logo dot), and hosted clips show the 240p CLIP framing as visible
// spec compliance. Fonts are server-side only; the no-webfont rule for the
// browser surfaces is unaffected.

const T = {
  chrome: '#33383F', chromeDark: '#26292F', chromeText: '#B9BEC6',
  paper: '#F5F4F0', card: '#FFFFFF', soft: '#F0F1F3', headerStrip: '#FBFBF9',
  border: '#DDDEE2', hair: '#E8E9EC',
  ink: '#26292F', inkSoft: '#3E444E', meta: '#666C74',
  accent: '#B0674D', accentSoft: 'rgba(176,103,77,0.10)', logoDot: '#E0A48E',
  player: '#141518',
};

const el = (type, style, children) => ({ type, props: { style, children } });
const txt = (style, value) => el('div', style, value);

const clip = (value, max) => {
  const text = String(value || '').trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
};

const quoteSize = (quote, hasClipFrame) => {
  const budget = hasClipFrame ? 0 : 6;
  if (quote.length <= 70) return 42 + budget;
  if (quote.length <= 120) return 36 + budget;
  if (quote.length <= 180) return 30 + budget;
  return 26 + budget;
};

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

// The miniature 240p player: CLIP tag top-left, play affordance, badge
// bottom-right. Only rendered for hosted media annotations.
const clipFrame = (badge) => el('div', {
  height: 108, backgroundColor: T.player, borderRadius: 10,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  position: 'relative', marginBottom: 20,
}, [
  txt({
    position: 'absolute', top: 10, left: 12, fontSize: 15, fontWeight: 700,
    letterSpacing: 1, color: '#FFFFFF', backgroundColor: T.accent,
    borderRadius: 4, padding: '2px 10px',
  }, 'CLIP'),
  el('div', {
    width: 46, height: 46, borderRadius: 46, border: '2px solid rgba(255,255,255,0.7)',
    backgroundColor: 'rgba(255,255,255,0.14)', display: 'flex',
    alignItems: 'center', justifyContent: 'center',
  }, [txt({ fontSize: 16, color: '#FFFFFF', marginLeft: 4 }, '▶')]),
  txt({
    position: 'absolute', bottom: 10, right: 12, fontFamily: 'CardMono',
    fontSize: 15, color: '#E9EAEC', backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 4, padding: '2px 8px',
  }, badge),
]);

export function annotationCard(data) {
  const quote = clip(data.quote, 220);
  const note = clip(data.note, 150);
  const hasClipFrame = Boolean(data.clipBadge);

  return el('div', {
    width: 1200, height: 630, display: 'flex', flexDirection: 'column',
    backgroundColor: T.paper, fontFamily: 'CardSans', color: T.ink,
  }, [
    // ink chrome bar
    el('div', {
      height: 62, backgroundColor: T.chrome, display: 'flex',
      alignItems: 'center', padding: '0 34px', flexShrink: 0,
    }, [
      txt({ fontSize: 29, fontWeight: 700, color: '#FFFFFF', letterSpacing: -0.5 }, 'annotated'),
      txt({ fontSize: 29, fontWeight: 700, color: T.logoDot }, '.'),
      txt({ fontSize: 16, color: T.chromeText, marginLeft: 18, letterSpacing: 2 }, 'SOURCE-FIRST NOTES'),
    ]),

    // the module — a miniature permalink card
    el('div', {
      display: 'flex', flexDirection: 'column', flexGrow: 1, margin: 26,
      backgroundColor: T.card, border: `2px solid ${T.border}`, borderRadius: 14,
    }, [
      // header strip: the moment chip + provenance
      el('div', {
        backgroundColor: T.headerStrip, borderBottom: `2px solid ${T.hair}`,
        borderRadius: '12px 12px 0 0', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', padding: '13px 24px',
      }, [
        el('div', { display: 'flex', alignItems: 'center' }, [
          txt({
            fontFamily: 'CardMono', fontSize: 19, fontWeight: 700, color: T.accent,
            backgroundColor: T.accentSoft, borderRadius: 5, padding: '3px 12px',
          }, data.momentLabel),
          txt({ fontSize: 19, fontWeight: 700, color: T.inkSoft, marginLeft: 14 }, clip(data.sourceName, 48)),
          txt({ fontSize: 19, color: T.meta, marginLeft: 10 },
            `· ${data.sourceType}${data.sourceDomain ? ` · ${data.sourceDomain}` : ''}`),
        ]),
      ]),

      // body
      el('div', {
        display: 'flex', flexDirection: 'column', flexGrow: 1,
        padding: '22px 28px', justifyContent: 'space-between',
      }, [
        el('div', { display: 'flex', flexDirection: 'column' }, [
          ...(hasClipFrame ? [clipFrame(data.clipBadge)] : []),
          // the source speaks in serif over the terracotta rule
          el('div', {
            display: 'flex', borderLeft: `6px solid ${T.accent}`,
            backgroundColor: T.soft, borderRadius: '0 10px 10px 0', padding: '16px 24px',
          }, [
            txt({
              fontFamily: 'CardSerif', fontSize: quoteSize(quote, hasClipFrame),
              lineHeight: 1.3, color: T.inkSoft,
            }, `“${quote}”`),
          ]),
          // the annotator speaks in sans
          txt({ fontSize: 23, lineHeight: 1.4, marginTop: 18, color: T.ink }, note),
        ]),

        // footer
        el('div', {
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderTop: `2px solid ${T.hair}`, paddingTop: 14,
        }, [
          el('div', { display: 'flex', fontSize: 18 }, [
            txt({ fontWeight: 700 }, `@${data.author}`),
            txt({ color: T.meta, marginLeft: 8 }, 'on annotated'),
          ]),
          txt({ fontFamily: 'CardMono', fontSize: 15, color: T.meta, letterSpacing: 1 },
            'THE ORIGINAL IS ONE CLICK AWAY'),
        ]),
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

// Small keyed cache so repeated crawler fetches do not re-render.
const cache = new Map();
const CACHE_LIMIT = 100;
export async function renderOgCardCached(cacheKey, data) {
  const cached = cache.get(cacheKey);
  if (cached) return cached;
  const png = await renderOgCard(data);
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
  cache.set(cacheKey, png);
  return png;
}
