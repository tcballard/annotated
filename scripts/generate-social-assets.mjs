// Generates the committed social/head assets:
//   public/brand/og-default.png     — 1200x630 brand card for pages without
//                                     their own OG image (home, feed, docs)
//   public/brand/apple-touch-icon.png — 180x180 full-bleed home-screen icon
//
// Run: node scripts/generate-social-assets.mjs   (requires the DejaVu fonts
// used by the OG pipeline; override the directory with OG_FONT_DIR)

import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OG_WORDMARK } from '../server/og-wordmark.js';

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

// The outlined lockup rides in as the finished drawing — retyping the brand
// in DejaVu is exactly the fourth-rendering mistake the OG pipeline retired.
const wordmark = (height) => ({
  type: 'img',
  props: {
    src: `data:image/svg+xml;base64,${Buffer.from(OG_WORDMARK.svg).toString('base64')}`,
    width: Math.round((OG_WORDMARK.width / OG_WORDMARK.height) * height),
    height,
  },
});

// The default card: the identity in one frame, in the same dark grammar as
// the annotation cards — ink ground, the lockup large, the rule in serif
// paper, terracotta only on the closing line.
const card = el('div', {
  width: 1200, height: 630, display: 'flex', flexDirection: 'column',
  backgroundColor: '#26292F', fontFamily: 'CardSans', color: '#E9EAEC',
}, [
  el('div', { height: 84, backgroundColor: '#33383F', display: 'flex', alignItems: 'center', padding: '0 56px', flexShrink: 0 }, [
    wordmark(32),
    txt({ fontSize: 17, color: '#B9BEC6', marginLeft: 22, letterSpacing: 3 }, 'SOURCE-FIRST NOTES'),
  ]),
  el('div', {
    display: 'flex', flexDirection: 'column', flexGrow: 1, padding: '0 56px',
    alignItems: 'flex-start', justifyContent: 'center',
  }, [
    wordmark(92),
    txt({ fontFamily: 'CardSerif', fontSize: 44, color: '#F5F4F0', marginTop: 34, lineHeight: 1.25 },
      '“A clip without its source is just a rumour.”'),
    txt({ fontSize: 25, color: '#B9BEC6', marginTop: 20, lineHeight: 1.45 },
      'Keep the moment — a passage, a bounded clip, a screenshot — with your context and a live link back to the original.'),
  ]),
  el('div', {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    borderTop: '2px solid rgba(255,255,255,0.12)', margin: '0 56px', padding: '22px 0', flexShrink: 0,
  }, [
    txt({ fontFamily: 'CardMono', fontSize: 15, color: '#9AA0A8', letterSpacing: 1.5 }, 'CLIPS ≤ 90s · 240p · ALWAYS LINKED'),
    txt({ fontFamily: 'CardMono', fontSize: 15, color: '#E0A48E', letterSpacing: 1.5 }, 'THE ORIGINAL IS ONE CLICK AWAY'),
  ]),
]);

const svg = await satori(card, { width: 1200, height: 630, fonts });
const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng();
await writeFile(path.join(brandDir, 'og-default.png'), png);
console.log(`og-default.png: ${png.length} bytes`);

// Apple touch icon + PWA icons: the favicon mark composed onto a full-bleed
// ground so no platform fills transparent corners with black. The maskable
// variant scales the mark into the central 80% safe zone.
const favicon = await readFile(path.join(brandDir, 'favicon.svg'), 'utf8');
const inner = favicon.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const fullBleed = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000"><rect width="1000" height="1000" fill="#F3F1ED"/>${inner}</svg>`;
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000"><rect width="1000" height="1000" fill="#F3F1ED"/><g transform="translate(100 100) scale(0.8)">${inner}</g></svg>`;
for (const [file, svgSource, size] of [
  ['apple-touch-icon.png', fullBleed, 180],
  ['pwa-192.png', fullBleed, 192],
  ['pwa-512.png', fullBleed, 512],
  ['pwa-maskable-512.png', maskable, 512],
]) {
  const png = new Resvg(svgSource, { fitTo: { mode: 'width', value: size } }).render().asPng();
  await writeFile(path.join(brandDir, file), png);
  console.log(`${file}: ${png.length} bytes`);
}

// Mobile shell icons (only when the Expo project is present): the app icon
// full-bleed at 1024, and the Android adaptive foreground with the mark held
// inside the safe zone.
const mobileAssets = path.join(repoRoot, 'mobile/assets');
if (await access(mobileAssets).then(() => true).catch(() => false)) {
  for (const [file, svgSource, size] of [
    ['icon.png', fullBleed, 1024],
    ['adaptive-icon.png', maskable, 1024],
    ['splash-icon.png', maskable, 512],
    ['favicon.png', fullBleed, 48],
  ]) {
    const png = new Resvg(svgSource, { fitTo: { mode: 'width', value: size } }).render().asPng();
    await writeFile(path.join(mobileAssets, file), png);
    console.log(`mobile/${file}: ${png.length} bytes`);
  }
}
