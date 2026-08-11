// Sign-in from native surfaces: the same system-browser OAuth hop the
// WebView shells use, driven directly. The one-time ticket becomes the
// normal cookie session via /auth/mobile/session — fetched natively, so
// the shared cookie jar picks it up for WebViews and API calls alike.

import * as WebBrowser from 'expo-web-browser';
import { oauthStartUrl } from './core/auth-ui';
import { sessionExchangeUrl, ticketFromCallback, withMobileReturn } from './shell';
import { ORIGIN } from './origin';

export const signInWithProvider = async (provider: string): Promise<boolean> => {
  const authPath = oauthStartUrl(provider, undefined);
  if (!authPath) return false;
  const startUrl = new URL(authPath, ORIGIN).toString();
  const result = await WebBrowser.openAuthSessionAsync(withMobileReturn(startUrl), 'annotated://auth');
  const ticket = ticketFromCallback(result.type === 'success' ? result.url : null);
  if (!ticket) return false;
  await fetch(sessionExchangeUrl(ORIGIN, ticket, '/'), { credentials: 'include' }).catch(() => {});
  return true;
};
