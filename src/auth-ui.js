const providerLabels = Object.freeze({ x: 'X', google: 'Google' });
const providerNames = Object.freeze(Object.keys(providerLabels));

export const enabledProviders = (providers = {}) => providerNames.filter((name) => providers[name] === true);

export const providerLabel = (provider) => providerLabels[provider] || 'sign-in provider';

export const oauthReturnUrl = (location = globalThis.location) => {
  if (!location?.origin) return '';
  return `${location.origin}${location.pathname || '/'}${location.search || ''}${location.hash || ''}`;
};

export const oauthStartUrl = (provider, location = globalThis.location) => {
  if (!providerLabels[provider]) return '';
  const returnTo = oauthReturnUrl(location);
  return `/api/auth/${encodeURIComponent(provider)}/start${returnTo ? `?return_to=${encodeURIComponent(returnTo)}` : ''}`;
};

export const authNoticeFromSearch = (search = '') => {
  const value = new URLSearchParams(search).get('auth');
  return ['success', 'error', 'cancelled'].includes(value) ? value : '';
};
