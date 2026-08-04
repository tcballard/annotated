import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { annotationCard } from './og-template.js';

const fontDirectory = process.env.OG_FONT_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), 'fonts');
const cacheLimit = 100;
const cards = new Map();

const fontFiles = [
  ['CardSans', 'DejaVuSans.ttf', 400],
  ['CardSans', 'DejaVuSans-Bold.ttf', 700],
  ['CardMono', 'DejaVuSansMono.ttf', 400],
  ['CardMono', 'DejaVuSansMono-Bold.ttf', 700],
];

let fonts;
const loadFonts = async () => {
  fonts ||= Promise.all(fontFiles.map(async ([name, file, weight]) => ({
    name, data: await readFile(path.join(fontDirectory, file)), weight, style: 'normal',
  })));
  return fonts;
};

const cacheKey = (annotation) => String(annotation.id || annotation.slug);

export async function renderCard(annotation) {
  const key = cacheKey(annotation);
  const cached = cards.get(key);
  if (cached) {
    cards.delete(key);
    cards.set(key, cached);
    return cached;
  }
  const [{ default: satori }, { Resvg }, loadedFonts] = await Promise.all([
    import('satori'),
    import('@resvg/resvg-js'),
    loadFonts(),
  ]);
  const svg = await satori(annotationCard(annotation), { width: 1200, height: 630, fonts: loadedFonts });
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng();
  cards.set(key, png);
  if (cards.size > cacheLimit) cards.delete(cards.keys().next().value);
  return png;
}

export const clearCardCache = () => cards.clear();
