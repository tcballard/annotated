// Pure helpers for the shell — kept free of React Native imports so the
// repo's node test-suite can assert their behaviour directly.

export type ShareIntentLike = { webUrl?: string | null; text?: string | null };

// A share lands on the same /capture contract the PWA share target uses:
// the web app's own extractor pulls the first URL out of whatever the sheet
// sent, so no URL parsing is duplicated here.
export const captureUrlFromShare = (origin: string, share: ShareIntentLike): string | null => {
  const payload = (share.webUrl || share.text || '').trim();
  if (!payload) return null;
  return `${origin}/capture?text=${encodeURIComponent(payload)}`;
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

export const sessionExchangeUrl = (origin: string, ticket: string): string =>
  `${origin}/auth/mobile/session?ticket=${encodeURIComponent(ticket)}`;

// Navigation policy: annotated stays in the shell; the whole point of the
// product is that originals open OUT — in the real browser.
export const isInternalNavigation = (url: string, origin: string): boolean =>
  url.startsWith(origin) || url.startsWith('about:');
