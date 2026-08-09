// Generates the welcome screen's lower wash — the soft warm bloom that
// sits under the onboarding copy.
//
//   mobile/assets/welcome/lower-wash.png  — 640×1265, our own artwork
//
// Original composition in annotated's palette (paper #F5F4F0 ground, a
// terracotta #B0674D bloom at 14%, a cool #52678F counter-bloom at 8%),
// rendered from an SVG so it stays reproducible and reviewable in the
// diff as source rather than binary intent.
//
// Run: node scripts/generate-welcome-assets.mjs

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const outDir = path.join(repoRoot, 'mobile/assets/welcome');

const { Resvg } = await import('@resvg/resvg-js');

const WIDTH = 640;
const HEIGHT = 1265;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <radialGradient id="warm" cx="22%" cy="76%" r="72%">
      <stop offset="0%" stop-color="#B0674D" stop-opacity="0.14" />
      <stop offset="55%" stop-color="#B0674D" stop-opacity="0.05" />
      <stop offset="100%" stop-color="#B0674D" stop-opacity="0" />
    </radialGradient>
    <radialGradient id="cool" cx="88%" cy="94%" r="58%">
      <stop offset="0%" stop-color="#52678F" stop-opacity="0.08" />
      <stop offset="100%" stop-color="#52678F" stop-opacity="0" />
    </radialGradient>
    <linearGradient id="settle" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#F5F4F0" stop-opacity="0" />
      <stop offset="100%" stop-color="#F5F4F0" stop-opacity="0.55" />
    </linearGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#FFFFFF" />
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#warm)" />
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#cool)" />
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#settle)" />
</svg>`;

await mkdir(outDir, { recursive: true });
const png = new Resvg(svg, { fitTo: { mode: 'width', value: WIDTH } }).render().asPng();
await writeFile(path.join(outDir, 'lower-wash.png'), png);
console.log(`mobile/assets/welcome/lower-wash.png regenerated (${WIDTH}×${HEIGHT}, ${(png.length / 1024).toFixed(1)} kB)`);
