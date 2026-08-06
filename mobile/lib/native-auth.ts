// Sign-in from native surfaces: the same system-browser OAuth hop the
// WebView shells use, driven directly. The one-time ticket becomes the
// normal cookie session via /auth/mobile/session — fetched natively, so
// the shared cookie jar picks it up for WebViews and API calls alike.

import { Alert } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { enabledProviders, oauthStartUrl, providerLabel } from './core/auth-ui';
import { sessionExchangeUrl, ticketFromCallback, withMobileReturn } from './shell';
import { ORIGIN } from './origin';
import { api } from './api';

// The one door, in the platform's native shape: same voice as the web and
// extension modals, spoken through the system alert.
const pickProvider = (providers: string[]): Promise<string | null> => {
  if (providers.length === 1) return Promise.resolve(providers[0]);
  return new Promise((resolve) => {
    Alert.alert('Add your name to the margin', 'One account across the extension, the web, and the app.', [
      ...providers.map((provider) => ({ text: `Continue with ${providerLabel(provider)}`, onPress: () => resolve(provider) })),
      { text: 'Not now', style: 'cancel' as const, onPress: () => resolve(null) },
    ]);
  });
};

export const signInNatively = async (): Promise<boolean> => {
  const { providers } = await api.providers().catch(() => ({ providers: {} }));
  const enabled = enabledProviders(providers);
  if (!enabled.length) return false;
  const provider = await pickProvider(enabled);
  if (!provider) return false;
  const startUrl = new URL(oauthStartUrl(provider, undefined), ORIGIN).toString();
  const result = await WebBrowser.openAuthSessionAsync(withMobileReturn(startUrl), 'annotated://auth');
  const ticket = ticketFromCallback(result.type === 'success' ? result.url : null);
  if (!ticket) return false;
  await fetch(sessionExchangeUrl(ORIGIN, ticket, '/'), { credentials: 'include' }).catch(() => {});
  return true;
};
