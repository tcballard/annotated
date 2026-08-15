// GENERATED from packages/core/src/source-title.ts by scripts/build-core.mjs — do
// not edit by hand. The TypeScript module is the single source of truth
// shared by web, server, extension, and the native app.

// A tab title is not a source title. Browsers decorate <title> with
// notification counters — "(47) YouTube", "[3] Inbox" — and sites append
// their own name after the real title. Captures keep what the reader
// meant: the work's name, not the tab furniture around it.
//
// Cleaning is deliberately narrow. Prefix counters are unambiguous junk
// and always go. Site-name suffixes are stripped only for patterns known
// to be tab dressing (YouTube's "Video Title - YouTube"), and only when a
// real title remains in front — "Notion – the all-in-one workspace" is a
// whole title, not a suffix, and a generic rule would eat it.

const COUNTER_PREFIX = /^[([]\d+[)\]]\s*/;
const KNOWN_SUFFIX = /\s*[-–—|·]\s*YouTube\s*$/;

export const cleanSourceTitle = (value: unknown): string => {
  let title = String(value ?? '').replace(/\s+/g, ' ').trim();
  while (COUNTER_PREFIX.test(title)) title = title.replace(COUNTER_PREFIX, '');
  const withoutSuffix = title.replace(KNOWN_SUFFIX, '').trim();
  if (withoutSuffix.length >= 3) title = withoutSuffix;
  return title;
};
