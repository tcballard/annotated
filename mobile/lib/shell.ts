// Pure helpers for the shell — kept free of React Native imports so the
// repo's node test-suite can assert their behaviour directly.

export type ShareIntentLike = { webUrl?: string | null; text?: string | null };

// Every surface the app hosts loads in shell mode: the web page renders
// content only, because navigation chrome belongs to the native tab bar.
export const shellUrl = (origin: string, path: string): string => {
  const url = new URL(path, origin);
  url.searchParams.set('shell', '1');
  return url.toString();
};

// A share lands on the same /capture contract the PWA share target uses:
// the web app's own extractor pulls the first URL out of whatever the sheet
// sent, so no URL parsing is duplicated here.
export const captureUrlFromShare = (origin: string, share: ShareIntentLike): string | null => {
  const payload = (share.webUrl || share.text || '').trim();
  if (!payload) return null;
  const url = new URL('/capture', origin);
  url.searchParams.set('text', payload);
  url.searchParams.set('shell', '1');
  return url.toString();
};

export const isOauthStartUrl = (url: string, origin: string): boolean =>
  url.startsWith(`${origin}/api/auth/`) && url.includes('/start');

// Google refuses OAuth inside WebViews, so sign-in hops to the system
// browser and returns through the app scheme with a one-time ticket.
export const withMobileReturn = (url: string): string => {
  const parsed = new URL(url);
  parsed.searchParams.set('return_to', 'annotated://auth');
  return parsed.toString();
};

export const ticketFromCallback = (url: string | null | undefined): string | null => {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'annotated:' || parsed.hostname !== 'auth') return null;
    return parsed.searchParams.get('ticket');
  } catch {
    return null;
  }
};

// `next` sends the signed-in reader back to the surface the tab was on —
// the server only honours it as a local path, never another origin.
export const sessionExchangeUrl = (origin: string, ticket: string, next?: string): string => {
  const url = new URL('/auth/mobile/session', origin);
  url.searchParams.set('ticket', ticket);
  if (next) url.searchParams.set('next', next);
  return url.toString();
};

// Navigation policy: annotated stays in the shell; the whole point of the
// product is that originals open OUT — in the real browser.
export const isInternalNavigation = (url: string, origin: string): boolean =>
  url.startsWith(origin) || url.startsWith('about:');
