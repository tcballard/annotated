// GENERATED from packages/core/src/auth-ui.ts by scripts/build-core.mjs — do
// not edit by hand. The TypeScript module is the single source of truth
// shared by web, server, extension, and the native app.

export type LocationLike = {
  origin?: string;
  pathname?: string;
  search?: string;
  hash?: string;
};

const providerLabels: Record<string, string> = Object.freeze({ x: 'X', google: 'Google' });
const providerNames = Object.freeze(Object.keys(providerLabels));

export const enabledProviders = (providers: Record<string, unknown> = {}): string[] =>
  providerNames.filter((name) => providers[name] === true);

export const providerLabel = (provider: string): string => providerLabels[provider] || 'sign-in provider';

export const oauthReturnUrl = (location: LocationLike | undefined = (globalThis as any).location): string => {
  if (!location?.origin) return '';
  return `${location.origin}${location.pathname || '/'}${location.search || ''}${location.hash || ''}`;
};

export const oauthStartUrl = (provider: string, location: LocationLike | undefined = (globalThis as any).location): string => {
  if (!providerLabels[provider]) return '';
  const returnTo = oauthReturnUrl(location);
  return `/api/auth/${encodeURIComponent(provider)}/start${returnTo ? `?return_to=${encodeURIComponent(returnTo)}` : ''}`;
};

export const authNoticeFromSearch = (search = ''): string => {
  const value = new URLSearchParams(search).get('auth');
  return ['success', 'error', 'cancelled'].includes(value as string) ? (value as string) : '';
};
