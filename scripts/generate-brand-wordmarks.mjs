// The horizontal wordmark, outlined to paths.
//
// The previous logo-primary/logo-inverse were live <text> in system-ui:
// whatever font the viewer's OS resolves draws the mark, and the metrics
// drift with it. "annotated." needs ~102 units of a 88-unit viewBox under
// Linux's DejaVu — the mark clipped mid-"d" and the terracotta full stop,
// the identity's signature, fell outside the canvas entirely. A logo may
// not depend on the reader's fonts.
//
// This outlines the lockup once, with the same face and tracking the app's
// BrandMark uses (Inter ExtraBold, -2.1% letter-spacing), so the mark is
// the same drawing on every OS — and the same lockup on every surface.
// Inter ships under the SIL OFL; outlined glyphs in a logo are within its
// terms. The generated SVGs are committed; this script only needs to run
// again if the lockup itself changes.

import { readFile, writeFile } from 'node:fs/promises';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

const FONT_PATH = new URL(
  '../mobile/node_modules/@expo-google-fonts/inter/800ExtraBold/Inter_800ExtraBold.ttf',
  import.meta.url,
);

// The chrome bar's line box: 17px type on a 24px line, exactly what the
// old <text> version declared (font-size 17, viewBox height 24).
const FONT_SIZE = 17;
const BOX_HEIGHT = 24;
const CANVAS_WIDTH = 200; // roomy; trimmed to the ink's true right edge
const TRACKING = `${(FONT_SIZE * -0.021).toFixed(3)}px`;

const wordmark = (letterColor, dotColor) => ({
  type: 'div',
  props: {
    style: { display: 'flex', alignItems: 'center', width: '100%', height: '100%' },
    children: [
      {
        type: 'span',
        props: {
          style: {
            fontFamily: 'Inter',
            fontSize: FONT_SIZE,
            fontWeight: 800,
            letterSpacing: TRACKING,
            lineHeight: `${BOX_HEIGHT}px`,
            color: letterColor,
          },
          children: 'annotated',
        },
      },
      {
        type: 'span',
        props: {
          style: {
            fontFamily: 'Inter',
            fontSize: FONT_SIZE,
            fontWeight: 800,
            lineHeight: `${BOX_HEIGHT}px`,
            color: dotColor,
            // the span boundary loses the tracked advance before the dot;
            // put it back so the full stop sits as tight as the letters
            marginLeft: TRACKING,
          },
          children: '.',
        },
      },
    ],
  },
});

const renderPaths = async (fontData, letterColor, dotColor) => {
  const svg = await satori(wordmark(letterColor, dotColor), {
    width: CANVAS_WIDTH,
    height: BOX_HEIGHT,
    fonts: [{ name: 'Inter', data: fontData, weight: 800, style: 'normal' }],
  });
  const paths = [...svg.matchAll(/<path[^>]*\/>/g)].map((m) => m[0]);
  if (paths.length < 2) throw new Error(`expected letter and dot paths, got ${paths.length}`);
  return paths;
};

// The ink's true right edge, found by rendering and scanning pixels —
// glyph paths are opaque to arithmetic, but not to a rasterizer.
const measureInkWidth = (paths) => {
  const SCALE = 8;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS_WIDTH} ${BOX_HEIGHT}">${paths.join('')}</svg>`;
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: CANVAS_WIDTH * SCALE } }).render();
  const { width, height } = png;
  const pixels = png.pixels; // RGBA
  let right = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = width - 1; x > right; x -= 1) {
      if (pixels[(y * width + x) * 4 + 3] > 0) { right = x; break; }
    }
  }
  return (right + 1) / SCALE;
};

const file = (name, desc, paths, inkWidth) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${inkWidth} ${BOX_HEIGHT}" role="img" aria-labelledby="title desc">
  <title id="title">annotated.</title>
  <desc id="desc">${desc}</desc>
  ${paths.join('\n  ')}
</svg>
`;

const fontData = await readFile(FONT_PATH).catch(() => {
  throw new Error(
    'Inter ExtraBold not found — run `npm install` in mobile/ first; the wordmark is outlined from the same face the app renders.',
  );
});

// One geometry, two colourways: ink-with-terracotta on light paper, and
// paper-with-tint on the permanently dark chrome bar — the same pairing
// the app and the panel already use for the dot.
const primaryPaths = await renderPaths(fontData, '#26292F', '#B0674D');
const inversePaths = await renderPaths(fontData, '#FFFFFF', '#E0A48E');
const inkWidth = Math.ceil(measureInkWidth(primaryPaths) * 2) / 2 + 0.5;

await writeFile(
  new URL('../public/brand/logo-primary.svg', import.meta.url),
  file('logo-primary', 'The Annotated wordmark in ink with a terracotta full stop, outlined to paths.', primaryPaths, inkWidth),
);
await writeFile(
  new URL('../public/brand/logo-inverse.svg', import.meta.url),
  file('logo-inverse', 'The Annotated wordmark in white with a terracotta full stop, outlined to paths.', inversePaths, inkWidth),
);

console.log(`wordmarks outlined: viewBox 0 0 ${inkWidth} ${BOX_HEIGHT} (was 0 0 88 24, ink needed ~102)`);
