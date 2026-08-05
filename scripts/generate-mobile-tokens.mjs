// Derives the mobile theme from the web stylesheet's :root tokens — one
// source of truth for the identity on every platform. Committed output;
// test/mobile-shell.test.js fails if this file goes stale.
//
// Run: node scripts/generate-mobile-tokens.mjs

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

export const parseRootTokens = (css) => {
  const root = css.match(/:root\s*\{([\s\S]*?)\}/);
  if (!root) throw new Error('No :root block found in the stylesheet.');
  const tokens = {};
  for (const [, name, value] of root[1].matchAll(/--([a-z-]+):\s*([^;]+);/g)) {
    tokens[name] = value.trim();
  }
  return tokens;
};

export const renderTokensModule = (tokens) => {
  // JSON-encoded on both sides: values like the serif stack carry quotes.
  const entry = ([name, value]) => `  ${JSON.stringify(name)}: ${JSON.stringify(value)},`;
  return `// GENERATED from src/styles.css by scripts/generate-mobile-tokens.mjs — do
// not edit by hand. The web stylesheet is the single source of truth for
// the identity; this file carries the same tokens to the native shell.

export const tokens = {
${Object.entries(tokens).map(entry).join('\n')}
} as const;

export const chrome = tokens['chrome'];
export const paper = tokens['paper'];
export const card = tokens['card'];
export const ink = tokens['ink'];
export const accent = tokens['accent'];
export const meta = tokens['meta'];
`;
};

const css = await readFile(path.join(repoRoot, 'src/styles.css'), 'utf8');
const output = renderTokensModule(parseRootTokens(css));
await writeFile(path.join(repoRoot, 'mobile/lib/tokens.ts'), output);
console.log('mobile/lib/tokens.ts regenerated from src/styles.css');
