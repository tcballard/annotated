// Derives the mobile theme from the web stylesheet's :root tokens — one
// source of truth for the identity on every platform. Committed output;
// test/mobile-shell.test.js fails if this file goes stale.
//
// Dark mode rides the same source: the web's prefers-color-scheme block
// provides the dark values, and on iOS every color token becomes a
// DynamicColorIOS pair so the whole native shell follows the system
// setting with no per-component plumbing. Tokens the dark block does not
// override (the chrome, the accent, type stacks, radii) stay constant —
// exactly the web's behavior.
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

export const parseDarkTokens = (css) => {
  const scheme = css.match(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([\s\S]*?)\}/);
  if (!scheme) throw new Error('No dark-scheme :root block found in the stylesheet.');
  const tokens = {};
  for (const [, name, value] of scheme[1].matchAll(/--([a-z-]+):\s*([^;]+);/g)) {
    tokens[name] = value.trim();
  }
  return tokens;
};

const isColor = (value) => /^#|^rgba?\(/.test(value);

export const renderTokensModule = (tokens, dark = {}) => {
  // JSON-encoded on both sides: values like the serif stack carry quotes.
  const entry = ([name, value]) => `  ${JSON.stringify(name)}: ${JSON.stringify(value)},`;
  const darkColorEntries = Object.entries(dark).filter(([name, value]) => isColor(value) && isColor(tokens[name] || ''));
  return `// GENERATED from src/styles.css by scripts/generate-mobile-tokens.mjs — do
// not edit by hand. The web stylesheet is the single source of truth for
// the identity; this file carries the same tokens to the native shell.
// On iOS, tokens the web's dark scheme overrides become DynamicColorIOS
// pairs, so the native chrome follows the system setting by itself.

import { DynamicColorIOS, Platform, type ColorValue } from 'react-native';

const light = {
${Object.entries(tokens).map(entry).join('\n')}
} as const;

const dark = {
${darkColorEntries.map(entry).join('\n')}
} as const;

const dynamic = (name: keyof typeof light): ColorValue | string =>
  Platform.OS === 'ios' && name in dark
    ? DynamicColorIOS({ light: light[name], dark: dark[name as keyof typeof dark] })
    : light[name];

export const tokens = Object.fromEntries(
  (Object.keys(light) as Array<keyof typeof light>).map((name) => [name, dynamic(name)]),
) as Record<keyof typeof light, ColorValue | string>;

export const chrome = tokens['chrome'];
export const paper = tokens['paper'];
export const card = tokens['card'];
export const ink = tokens['ink'];
export const accent = tokens['accent'];
export const meta = tokens['meta'];
`;
};

const css = await readFile(path.join(repoRoot, 'src/styles.css'), 'utf8');
const output = renderTokensModule(parseRootTokens(css), parseDarkTokens(css));
await writeFile(path.join(repoRoot, 'mobile/lib/tokens.ts'), output);
console.log('mobile/lib/tokens.ts regenerated from src/styles.css');
