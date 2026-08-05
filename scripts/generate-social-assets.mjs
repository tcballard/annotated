// Generates the committed social/head assets:
//   public/brand/og-default.png     — 1200x630 brand card for pages without
//                                     their own OG image (home, feed, docs)
//   public/brand/apple-touch-icon.png — 180x180 full-bleed home-screen icon
//
// Run: node scripts/generate-social-assets.mjs   (requires the DejaVu fonts
// used by the OG pipeline; override the directory with OG_FONT_DIR)

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const brandDir = path.join(repoRoot, 'public/brand');
const fontDir = process.env.OG_FONT_DIR || '/usr/share/fonts/truetype/dejavu';

const [{ default: satori }, { Resvg }] = await Promise.all([import('satori'), import('@resvg/resvg-js')]);
const [sans, sansBold, mono, serif] = await Promise.all([
  readFile(`${fontDir}/DejaVuSans.ttf`), readFile(`${fontDir}/DejaVuSans-Bold.ttf`),
  readFile(`${fontDir}/DejaVuSansMono.ttf`), readFile(`${fontDir}/DejaVuSerif.ttf`),
]);
const fonts = [
  { name: 'CardSans', data: sans, weight: 400, style: 'normal' },
  { name: 'CardSans', data: sansBold, weight: 700, style: 'normal' },
  { name: 'CardMono', data: mono, weight: 400, style: 'normal' },
  { name: 'CardSerif', data: serif, weight: 400, style: 'normal' },
];

const el = (type, style, children) => ({ type, props: { style, children } });
const txt = (style, value) => el('div', style, value);

// The default card: the identity in one frame — ink chrome, paper ground,
// the wordmark with its terracotta full stop, and the rule in serif.
const card = el('div', {
  width: 1200, height: 630, display: 'flex', flexDirection: 'column',
  backgroundColor: '#F5F4F0', fontFamily: 'CardSans', color: '#26292F',
}, [
  el('div', { height: 62, backgroundColor: '#33383F', display: 'flex', alignItems: 'center', padding: '0 34px', flexShrink: 0 }, [
    txt({ fontSize: 29, fontWeight: 700, color: '#FFFFFF', letterSpacing: -0.5 }, 'annotated'),
    txt({ fontSize: 29, fontWeight: 700, color: '#E0A48E' }, '.'),
    txt({ fontSize: 16, color: '#B9BEC6', marginLeft: 18, letterSpacing: 2 }, 'SOURCE-FIRST NOTES'),
  ]),
  el('div', {
    display: 'flex', flexDirection: 'column', flexGrow: 1, margin: 26, padding: '0 56px',
    backgroundColor: '#FFFFFF', border: '2px solid #DDDEE2', borderRadius: 14,
    alignItems: 'flex-start', justifyContent: 'center',
  }, [
    el('div', { display: 'flex', alignItems: 'flex-end' }, [
      txt({ fontSize: 110, fontWeight: 700, letterSpacing: -3, color: '#26292F' }, 'annotated'),
      txt({ fontSize: 110, fontWeight: 700, color: '#B0674D' }, '.'),
    ]),
    txt({ fontFamily: 'CardSerif', fontSize: 38, color: '#3E444E', marginTop: 10, lineHeight: 1.3 },
      '“A clip without its source is just a rumour.”'),
    txt({ fontSize: 24, color: '#666C74', marginTop: 22, lineHeight: 1.45 },
      'Keep the moment — a passage, a bounded clip, a screenshot — with your context and a live link back to the original.'),
    el('div', {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', alignSelf: 'stretch',
      borderTop: '2px solid #E8E9EC', marginTop: 34, paddingTop: 18, paddingBottom: 6,
    }, [
      txt({ fontFamily: 'CardMono', fontSize: 15, color: '#666C74', letterSpacing: 1 }, 'CLIPS ≤ 90s · 240p · ALWAYS LINKED'),
      txt({ fontFamily: 'CardMono', fontSize: 15, color: '#666C74', letterSpacing: 1 }, 'THE ORIGINAL IS ONE CLICK AWAY'),
    ]),
  ]),
]);

const svg = await satori(card, { width: 1200, height: 630, fonts });
const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng();
await writeFile(path.join(brandDir, 'og-default.png'), png);
console.log(`og-default.png: ${png.length} bytes`);

// Apple touch icon: the favicon mark composed onto a full-bleed ground so
// iOS never fills transparent corners with black.
const favicon = await readFile(path.join(brandDir, 'favicon.svg'), 'utf8');
const inner = favicon.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const touch = new Resvg(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000"><rect width="1000" height="1000" fill="#F3F1ED"/>${inner}</svg>`,
  { fitTo: { mode: 'width', value: 180 } },
).render().asPng();
await writeFile(path.join(brandDir, 'apple-touch-icon.png'), touch);
console.log(`apple-touch-icon.png: ${touch.length} bytes`);
