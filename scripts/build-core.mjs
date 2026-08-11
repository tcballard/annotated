// Builds packages/core — the TypeScript source of truth for the domain
// logic every surface shares — into the exact places each platform consumes
// it from:
//
//   web + server + extension  →  transpiled plain-ESM .js at their existing
//                                paths (no bundler forced anywhere; the
//                                extension keeps shipping readable files)
//   native app                →  verbatim .ts under mobile/lib/core (metro
//                                and tsc consume TypeScript directly)
//
// Committed output; test/core-parity.test.js fails if any copy goes stale.
//
// Run: node scripts/build-core.mjs

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

export const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

// module name → the .js consumer paths it is emitted to. Every module is
// additionally copied verbatim (as .ts) into mobile/lib/core.
export const CORE_MODULES = {
  'topics': ['src/topics.js', 'server/topics.js', 'extension/topics.js'],
  'feed-item': ['src/feed-item.js'],
  'api-client': ['src/api-client.js'],
  'deep-link': ['src/deep-link.js', 'extension/deep-link.js'],
  'clip-range': ['src/clip-range.js', 'extension/clip-range.js'],
  'share-links': ['src/share-links.js'],
  'share-capture': ['src/share-capture.js'],
  'auth-ui': ['src/auth-ui.js'],
  'avatar': ['src/avatar.js', 'extension/avatar.js'],
  'capture-state': ['src/capture-state.js', 'extension/capture-state.js'],
  'share-kit': ['src/share-kit.js', 'extension/share-kit.js'],
  'icons': ['src/icons.js', 'extension/icons.js'],
};

export const MOBILE_CORE_DIR = 'mobile/lib/core';

export const generatedHeader = (name) => `// GENERATED from packages/core/src/${name}.ts by scripts/build-core.mjs — do
// not edit by hand. The TypeScript module is the single source of truth
// shared by web, server, extension, and the native app.

`;

export const transpileCoreModule = (name, source) => {
  const { outputText } = ts.transpileModule(source, {
    fileName: `${name}.ts`,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      verbatimModuleSyntax: true,
      newLine: ts.NewLineKind.LineFeed,
    },
  });
  return generatedHeader(name) + outputText;
};

// Metro resolves extensionless relative imports; the .js specifiers the
// browser/node builds need would miss the sibling .ts files there.
export const mobileCopy = (name, source) => generatedHeader(name) + source.replace(/(from\s+'\.\/[a-z-]+)\.js(')/g, '$1$2');

const main = async () => {
  await mkdir(path.join(repoRoot, MOBILE_CORE_DIR), { recursive: true });
  for (const [name, destinations] of Object.entries(CORE_MODULES)) {
    const source = await readFile(path.join(repoRoot, `packages/core/src/${name}.ts`), 'utf8');
    const emitted = transpileCoreModule(name, source);
    for (const destination of destinations) {
      await writeFile(path.join(repoRoot, destination), emitted);
    }
    await writeFile(path.join(repoRoot, MOBILE_CORE_DIR, `${name}.ts`), mobileCopy(name, source));
    console.log(`${name}.ts → ${destinations.join(', ')}, ${MOBILE_CORE_DIR}/${name}.ts`);
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
